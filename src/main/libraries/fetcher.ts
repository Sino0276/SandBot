import { createHash } from 'crypto'
import type { LibraryIntegrity, LibraryProgress, LibrarySource } from '../../shared/libraries'
import { LibraryCache } from './cache'
import { findInGradleCache } from './gradleCache'
import {
  CancelledError,
  downloadFile,
  FetchFailure,
  type DownloadTimeouts,
  type HttpGet,
  type Sleep
} from './http'
import { fileKey, PINNED_SHA256 } from './pins'
import {
  modulePath,
  repositoryFor,
  type DeclaredRepositories,
  type RepositoryId
} from './repositories'

// 파일 하나 얻기: SandBot 라이브러리 캐시 → Gradle 캐시(폴더 이름 sha1 = 내용 sha1) → 허용 저장소에서 받기.
// 무결성(강한 것부터): SandBot이 아는 해시(pins.ts) → .module에 적힌 sha256·sha512·sha1 → 저장소의 .sha256·.sha512·.sha1
// 파일 → Gradle 캐시의 sha1 → 체크섬이 없는 저장소(maven.brott.dev)는 처음 받은 해시를 기록(first-use.json, 다음부터 다르면
// checksumMismatch). 새로 얻은 파일은 무결성과 내용(요청의 check: POM·.module을 읽고 jar·AAR을 푼다)을 확인한 뒤에만
// 처음 받은 해시로 기록하고 라이브러리 캐시에 넣는다(다음부터 네트워크 없이). 200으로 온 차단 페이지 같은 잘못된 내용은
// 남기지 않아 고쳐진 뒤 다시 받는다. 캐시에 넣지 못해도(디스크) 받은 파일은 그대로 쓴다.

export const MAX_METADATA_BYTES = 1024 * 1024
export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024
// 동시에 받는 파일 수(Maven Central은 429를 자주 준다)
const CONCURRENCY = 4

export class IntegrityFailure extends Error {}

// 그 그룹을 받는 저장소를 팀이 선언하지 않았다
export class RepositoryFailure extends Error {
  constructor(
    readonly code: 'repositoryNotAllowed' | 'notFound',
    message: string
  ) {
    super(message)
  }
}

export type ExpectedHashes = {
  sha256: string | null
  sha512: string | null
  sha1: string | null
  size: number | null
}

export type FileRequest = {
  group: string
  artifact: string
  version: string
  file: string
  kind: 'metadata' | 'artifact'
  // 캐시 blob의 확장자
  ext: 'pom' | 'module' | 'jar' | 'aar'
  expected?: ExpectedHashes
  // 새로 얻은 내용을 확인한다(잘못되었으면 던진다). 라이브러리 캐시에서 읽은 것은 넣을 때 확인했으므로 부르지 않는다.
  check?: (bytes: Buffer) => void
}

export type FetchedFile = {
  bytes: Buffer
  sha256: string
  source: LibrarySource
  integrity: LibraryIntegrity
}

// 진행 알림(10 Hz 이하). 처음으로 네트워크에 닿을 때부터 보낸다(캐시만 쓰면 보내지 않는다).
export class ProgressTracker {
  private active = false
  private last = -Infinity
  private phase: LibraryProgress['phase'] = 'resolving'
  private done = 0
  private total = 0
  private bytes = 0

  constructor(
    private readonly report: (progress: LibraryProgress) => void,
    private readonly now: () => number = Date.now,
    private readonly intervalMs = 100
  ) {}

  private emit(force = false): void {
    if (!this.active) return
    const now = this.now()
    if (!force && now - this.last < this.intervalMs) return
    this.last = now
    this.report({ phase: this.phase, done: this.done, total: this.total, bytes: this.bytes })
  }

  network(): void {
    if (this.active) return
    this.active = true
    this.emit()
  }

  setPhase(phase: LibraryProgress['phase'], total: number): void {
    const changed = phase !== this.phase
    this.phase = phase
    this.done = 0
    this.total = total
    // 단계가 바뀌면 간격 안에서도 한 번 보내되, 너무 잦지 않게 앞의 시각을 지킨다
    if (changed && this.now() - this.last >= this.intervalMs) this.emit(true)
  }

  begin(): void {
    this.total++
    this.emit()
  }

  step(): void {
    this.done++
    this.emit()
  }

  addBytes(count: number): void {
    this.bytes += count
    this.emit()
  }
}

type Semaphore = <T>(task: () => Promise<T>) => Promise<T>

function semaphore(limit: number): Semaphore {
  let running = 0
  const waiting: (() => void)[] = []
  return async (task) => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    running++
    try {
      return await task()
    } finally {
      running--
      waiting.shift()?.()
    }
  }
}

function hash(algorithm: 'sha1' | 'sha256' | 'sha512', bytes: Buffer): string {
  return createHash(algorithm).update(bytes).digest('hex')
}

// 체크섬 파일의 hex: 첫 낱말(파일 이름이 뒤따를 수 있다), 아니면 오래된 OpenSSL 꼴 'SHA1(파일)= hex'
function checksumText(bytes: Buffer, length: number): string | null {
  const text = bytes.toString('utf8').trim().toLowerCase()
  const first = text.split(/\s+/)[0] ?? ''
  if (first.length === length && /^[0-9a-f]+$/.test(first)) return first
  const openssl = /^[a-z0-9-]+\([^)\n]*\)\s*=\s*([0-9a-f]+)$/.exec(text)
  return openssl && openssl[1].length === length ? openssl[1] : null
}

const CHECKSUM_FILES: Record<
  FileRequest['kind'],
  readonly ['sha256' | 'sha512' | 'sha1', number][]
> = {
  // 메타데이터는 요청을 줄이려고 sha1만(Central·Google은 늘 준다)
  metadata: [['sha1', 40]],
  artifact: [
    ['sha256', 64],
    ['sha512', 128],
    ['sha1', 40]
  ]
}

export type FetcherOptions = {
  cache: LibraryCache
  // Gradle 사용자 폴더(없으면 Gradle 캐시를 보지 않는다)
  gradleHome: string | null
  http: HttpGet
  signal: AbortSignal
  declared: DeclaredRepositories
  progress: ProgressTracker
  sleep?: Sleep
  timeouts?: DownloadTimeouts
}

export class FileFetcher {
  private readonly limit = semaphore(CONCURRENCY)
  // 닿지 못한 저장소(어느 주소도 응답하지 않음, 다시 해 봐도). 이번 해석에서는 그 저장소에 다시 묻지 않는다(파일마다
  // 기다리지 않게). 다른 저장소는 그대로 받는다.
  private readonly unreachable = new Map<RepositoryId, string>()

  constructor(private readonly options: FetcherOptions) {}

  private checkCancelled(): void {
    if (this.options.signal.aborted) throw new CancelledError()
  }

  async fetch(request: FileRequest): Promise<FetchedFile> {
    return this.limit(async () => {
      this.checkCancelled()
      const key = fileKey(request.group, request.artifact, request.version, request.file)
      const cached = await this.options.cache.lookup(key)
      if (cached && this.matchesExpected(cached.bytes, request.expected))
        return {
          bytes: cached.bytes,
          sha256: cached.record.sha256,
          source: 'libraryCache',
          integrity: cached.record.integrity
        }
      const limit = request.kind === 'metadata' ? MAX_METADATA_BYTES : MAX_ARTIFACT_BYTES
      if (this.options.gradleHome) {
        const hit = await findInGradleCache(
          this.options.gradleHome,
          request.group,
          request.artifact,
          request.version,
          request.file,
          limit
        )
        this.checkCancelled()
        if (hit) return this.accept(request, key, hit.bytes, 'gradleCache')
      }
      const bytes = await this.download(request, request.file, limit)
      return this.accept(request, key, bytes, 'download')
    })
  }

  // 새로 얻은 파일: 무결성 → 내용 → 처음 받은 해시 기록 → 캐시
  private async accept(
    request: FileRequest,
    key: string,
    bytes: Buffer,
    source: 'gradleCache' | 'download'
  ): Promise<FetchedFile> {
    const sha256 = hash('sha256', bytes)
    const { integrity, firstUse } = await this.verify(request, key, bytes, sha256, source)
    request.check?.(bytes)
    if (firstUse) {
      let recorded: string | null = null
      try {
        recorded = await this.options.cache.recordFirstUse(key, sha256)
      } catch {
        // 기록하지 못했다(디스크): 이번에는 그대로 쓴다(다음에 받으면 다시 처음 받은 것)
      }
      // 그사이 같은 파일의 다른 내용이 먼저 기록되었다
      if (recorded !== null)
        throw new IntegrityFailure(
          `${key}: SHA-256 ${sha256} differs from the first download ${recorded}`
        )
    }
    // 캐시는 다음을 위한 것이다: 넣지 못해도 받은 파일로 계속한다
    await this.options.cache.store(key, bytes, request.ext, integrity).catch(() => undefined)
    return { bytes, sha256, source, integrity }
  }

  private matchesExpected(bytes: Buffer, expected: ExpectedHashes | undefined): boolean {
    if (!expected) return true
    if (expected.sha256) return hash('sha256', bytes) === expected.sha256
    if (expected.sha512) return hash('sha512', bytes) === expected.sha512
    if (expected.sha1) return hash('sha1', bytes) === expected.sha1
    return true
  }

  private async download(request: FileRequest, file: string, limit: number): Promise<Buffer> {
    const repository = repositoryFor(request.group)
    const { declared } = this.options
    if (!declared.allowed.has(repository.id)) {
      if (declared.notAllowed.length > 0)
        throw new RepositoryFailure(
          'repositoryNotAllowed',
          `${request.group} is fetched from ${repository.base}, which the Gradle files do not declare; SandBot does not use ${declared.notAllowed.join(', ')}`
        )
      throw new RepositoryFailure(
        'notFound',
        `${request.group} is fetched from ${repository.base}, which the Gradle files do not declare`
      )
    }
    const unreachable = this.unreachable.get(repository.id)
    if (unreachable !== undefined) throw new FetchFailure('offline', unreachable, true)
    try {
      const { bytes } = await downloadFile(
        repository,
        modulePath(request.group, request.artifact, request.version, file),
        {
          http: this.options.http,
          signal: this.options.signal,
          limit,
          sleep: this.options.sleep,
          onRequest: () => this.options.progress.network(),
          onBytes: (count) => this.options.progress.addBytes(count),
          timeouts: this.options.timeouts
        }
      )
      return bytes
    } catch (error) {
      if (
        error instanceof FetchFailure &&
        error.unreachable &&
        !this.unreachable.has(repository.id)
      )
        this.unreachable.set(repository.id, error.message)
      throw error
    }
  }

  // firstUse: 확인할 체크섬이 없어 처음 받은 해시로 기록해야 한다(내용을 확인한 뒤 accept가 기록한다)
  private async verify(
    request: FileRequest,
    key: string,
    bytes: Buffer,
    sha256: string,
    source: 'gradleCache' | 'download'
  ): Promise<{ integrity: LibraryIntegrity; firstUse: boolean }> {
    const pinned = PINNED_SHA256[key]
    if (pinned !== undefined) {
      if (pinned !== sha256)
        throw new IntegrityFailure(`${key}: SHA-256 ${sha256} is not the known ${pinned}`)
      return { integrity: 'pinned', firstUse: false }
    }
    const expected = request.expected
    if (expected && (expected.sha256 || expected.sha512 || expected.sha1)) {
      if (!this.matchesExpected(bytes, expected))
        throw new IntegrityFailure(
          `${key}: the file does not match the hash in the Gradle module metadata`
        )
      if (expected.size !== null && expected.size !== bytes.length)
        throw new IntegrityFailure(
          `${key}: the file size does not match the Gradle module metadata`
        )
      return { integrity: 'checksum', firstUse: false }
    }
    const repository = repositoryFor(request.group)
    if (repository.checksums && source === 'download') {
      let unreadable: string | null = null
      for (const [algorithm, length] of CHECKSUM_FILES[request.kind]) {
        const file = `${request.file}.${algorithm}`
        let text: Buffer
        try {
          text = await this.download(request, file, 1024)
        } catch (error) {
          if (error instanceof FetchFailure && error.code === 'notFound') continue
          throw error
        }
        const value = checksumText(text, length)
        if (value === null) {
          unreadable ??= file
          continue
        }
        if (value !== hash(algorithm, bytes))
          throw new IntegrityFailure(`${key}: ${algorithm.toUpperCase()} does not match ${file}`)
        return { integrity: 'checksum', firstUse: false }
      }
      // 체크섬 파일이 왔지만 체크섬이 아니다(차단 페이지 등): 확인하지 못한 파일을 처음 받은 것으로 보지 않는다
      if (unreadable !== null) throw new IntegrityFailure(`${key}: ${unreadable} is not a checksum`)
    }
    if (source === 'gradleCache' && repository.checksums)
      return { integrity: 'gradleCache', firstUse: false }
    // 체크섬이 없다: 처음 본 해시와 같아야 한다(기록이 없으면 내용을 확인한 뒤 기록한다)
    const recorded = await this.options.cache.firstUse(key)
    if (recorded !== null && recorded !== sha256)
      throw new IntegrityFailure(
        `${key}: SHA-256 ${sha256} differs from the first download ${recorded}`
      )
    return {
      integrity: source === 'gradleCache' ? 'gradleCache' : 'firstUse',
      firstUse: recorded === null
    }
  }
}
