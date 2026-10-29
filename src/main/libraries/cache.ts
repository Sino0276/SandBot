import { createHash, randomBytes } from 'crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LibraryIntegrity } from '../../shared/libraries'

// SandBot 라이브러리 캐시(개인 PC의 userData/library-cache, 프로젝트·git 밖). 메시 캐시(meshCache.ts)와 같은 방식:
// - blobs/<sha256>.<ext>: 받은 파일과 AAR에서 꺼낸 jar(내용 주소, 임시 파일에 쓰고 바꿔치기)
// - index/<키 해시>.json: 'g:a:v/파일' → blob(sha256)과 무결성. 릴리스 파일은 바뀌지 않으므로 다시 받지 않는다.
// - jars/<원본 sha256>.json: 받은 jar·AAR에서 만든 클래스패스 jar 목록과 패키지(다시 풀지 않게)
// - resolutions/<선언·정책 해시>.json: 해석 잠금(이것과 blob이 모두 있으면 네트워크·메타데이터 없이 끝난다)
// - first-use.json: 체크섬이 없는 저장소(maven.brott.dev)에서 처음 받은 파일의 sha256(다음부터 다르면 checksumMismatch).
//   읽고-고치고-쓰기는 캐시 폴더마다 한 줄로 한다(동시에 받은 파일이 서로의 기록을 덮지 않게).
// 용량을 넘으면 오래 쓰지 않은 blob부터 지운다(이번 해석이 쓰는 것은 남긴다). 색인이 가리키는 blob이 없으면 없는 것으로 본다.
// Windows에서 백신·색인기가 막 쓴 파일을 잡고 있으면 rename이 실패하므로 잠시 뒤 다시 한다(platformJar.ts와 같은 방식).

export const MAX_LIBRARY_CACHE_BYTES = 1024 * 1024 * 1024
const STALE_TEMP_MS = 10 * 60 * 1000
// 이만큼 쓰지 않은 해석 잠금은 지운다(Gradle 파일을 고칠 때마다 새 잠금이 생긴다)
const STALE_LOCK_MS = 60 * 24 * 60 * 60 * 1000
const SHA256 = /^[0-9a-f]{64}$/
const EXTENSIONS = new Set(['jar', 'aar', 'pom', 'module', 'txt'])

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

// 임시 파일에 쓰고 바꿔치기한다. sameContent(내용의 sha256)를 주면 내용 주소 파일이라, 바꿔치기가 안 되어도 같은 내용의
// 파일이 이미 있으면(다른 창이 먼저 썼고 열려 있음) 그것을 쓴다.
export async function writeAtomic(
  target: string,
  bytes: Uint8Array | string,
  sameContent?: string
): Promise<void> {
  const temp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, bytes)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      const present =
        sameContent !== undefined &&
        (await readFile(target)
          .then((existing) => sha256Hex(existing) === sameContent)
          .catch(() => false))
      if (present || attempt >= 5 || !RETRY_CODES.has(code)) {
        await unlink(temp).catch(() => undefined)
        if (present) return
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
}

// first-use.json 고치기를 캐시 폴더마다 한 줄로(이 프로세스의 모든 창)
const firstUseQueues = new Map<string, Promise<unknown>>()

function serialized<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const run = (firstUseQueues.get(dir) ?? Promise.resolve()).then(task)
  const tail = run.catch(() => undefined)
  firstUseQueues.set(dir, tail)
  void tail.then(() => {
    if (firstUseQueues.get(dir) === tail) firstUseQueues.delete(dir)
  })
  return run
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const INTEGRITIES: readonly LibraryIntegrity[] = ['checksum', 'pinned', 'firstUse', 'gradleCache']

export type IndexRecord = {
  key: string
  sha256: string
  ext: string
  size: number
  integrity: LibraryIntegrity
}

export type JarSet = { jars: { name: string; sha256: string; packages: string[] }[] }

export class LibraryCache {
  constructor(readonly dir: string) {}

  blobPath(sha256: string, ext: string): string {
    if (!SHA256.test(sha256) || !EXTENSIONS.has(ext))
      throw new Error(`bad blob name ${sha256}.${ext}`)
    return join(this.dir, 'blobs', `${sha256}.${ext}`)
  }

  private indexPath(key: string): string {
    return join(this.dir, 'index', `${sha256Hex(key)}.json`)
  }

  async storeBlob(bytes: Buffer, ext: string): Promise<{ sha256: string; path: string }> {
    const sha256 = sha256Hex(bytes)
    const path = this.blobPath(sha256, ext)
    const existing = await stat(path).catch(() => null)
    if (existing?.isFile() && existing.size === bytes.length) {
      await this.touch([path])
      return { sha256, path }
    }
    await mkdir(join(this.dir, 'blobs'), { recursive: true })
    await writeAtomic(path, bytes, sha256)
    return { sha256, path }
  }

  // blob을 읽어 내용 해시를 확인한다(디스크가 깨졌으면 지우고 null)
  async readBlob(sha256: string, ext: string): Promise<Buffer | null> {
    const path = this.blobPath(sha256, ext)
    const bytes = await readFile(path).catch(() => null)
    if (!bytes) return null
    if (sha256Hex(bytes) !== sha256) {
      await unlink(path).catch(() => undefined)
      return null
    }
    await this.touch([path])
    return bytes
  }

  async hasBlob(sha256: string, ext: string, size?: number): Promise<boolean> {
    const info = await stat(this.blobPath(sha256, ext)).catch(() => null)
    return !!info?.isFile() && (size === undefined || info.size === size)
  }

  async lookup(key: string): Promise<{ record: IndexRecord; bytes: Buffer } | null> {
    const value = await readJson(this.indexPath(key))
    if (!isObject(value) || value.key !== key) return null
    const { sha256, ext, size, integrity } = value
    if (
      typeof sha256 !== 'string' ||
      !SHA256.test(sha256) ||
      typeof ext !== 'string' ||
      !EXTENSIONS.has(ext) ||
      typeof size !== 'number' ||
      !INTEGRITIES.includes(integrity as LibraryIntegrity)
    )
      return null
    const bytes = await this.readBlob(sha256, ext)
    if (!bytes || bytes.length !== size) return null
    return { record: { key, sha256, ext, size, integrity: integrity as LibraryIntegrity }, bytes }
  }

  async store(
    key: string,
    bytes: Buffer,
    ext: string,
    integrity: LibraryIntegrity
  ): Promise<IndexRecord> {
    const { sha256 } = await this.storeBlob(bytes, ext)
    const record: IndexRecord = { key, sha256, ext, size: bytes.length, integrity }
    await mkdir(join(this.dir, 'index'), { recursive: true })
    await writeAtomic(this.indexPath(key), JSON.stringify(record))
    return record
  }

  async readJarSet(sourceSha256: string): Promise<JarSet | null> {
    if (!SHA256.test(sourceSha256)) return null
    const value = await readJson(join(this.dir, 'jars', `${sourceSha256}.json`))
    if (!isObject(value) || !Array.isArray(value.jars)) return null
    const jars: JarSet['jars'] = []
    for (const jar of value.jars) {
      if (
        !isObject(jar) ||
        typeof jar.name !== 'string' ||
        typeof jar.sha256 !== 'string' ||
        !SHA256.test(jar.sha256) ||
        !Array.isArray(jar.packages) ||
        !jar.packages.every((p) => typeof p === 'string')
      )
        return null
      if (!(await this.hasBlob(jar.sha256, 'jar'))) return null
      jars.push({ name: jar.name, sha256: jar.sha256, packages: jar.packages as string[] })
    }
    return { jars }
  }

  async writeJarSet(sourceSha256: string, set: JarSet): Promise<void> {
    await mkdir(join(this.dir, 'jars'), { recursive: true })
    await writeAtomic(join(this.dir, 'jars', `${sourceSha256}.json`), JSON.stringify(set))
  }

  async readLock(key: string): Promise<unknown> {
    if (!SHA256.test(key)) return null
    const path = join(this.dir, 'resolutions', `${key}.json`)
    const lock = await readJson(path)
    if (lock !== null) await this.touch([path])
    return lock
  }

  async writeLock(key: string, lock: unknown): Promise<void> {
    await mkdir(join(this.dir, 'resolutions'), { recursive: true })
    await writeAtomic(join(this.dir, 'resolutions', `${key}.json`), JSON.stringify(lock))
  }

  // ---- 처음 받은 해시 ----

  private firstUsePath(): string {
    return join(this.dir, 'first-use.json')
  }

  // 없으면 빈 기록, 깨졌으면(읽을 수 없는 JSON) 처음부터. 읽지 못하면(잠김 등) 던진다: 기록이 있는지 모르므로 처음 받은
  // 것으로 보지 않는다.
  private async readFirstUse(): Promise<Map<string, string>> {
    let text: string
    try {
      text = await readFile(this.firstUsePath(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return new Map()
    }
    const records = new Map<string, string>()
    if (isObject(value))
      for (const [name, hash] of Object.entries(value))
        if (typeof hash === 'string' && SHA256.test(hash)) records.set(name, hash)
    return records
  }

  async firstUse(key: string): Promise<string | null> {
    return serialized(this.dir, async () => (await this.readFirstUse()).get(key) ?? null)
  }

  // 기록이 없으면 이 해시를 기록하고 null. 이미 있으면 덮지 않고, 다른 해시면 그 해시를 돌려준다(같으면 null).
  async recordFirstUse(key: string, sha256: string): Promise<string | null> {
    return serialized(this.dir, async () => {
      const records = await this.readFirstUse()
      const recorded = records.get(key)
      if (recorded !== undefined) return recorded === sha256 ? null : recorded
      records.set(key, sha256)
      await mkdir(this.dir, { recursive: true })
      await writeAtomic(this.firstUsePath(), JSON.stringify(Object.fromEntries(records), null, 1))
      return null
    })
  }

  async touch(paths: Iterable<string>): Promise<void> {
    const now = new Date()
    for (const path of paths) await utimes(path, now, now).catch(() => undefined)
  }

  // 용량을 넘으면 오래 쓰지 않은 blob부터 지운다(keep은 남긴다). 쓰다 멈춘 임시 파일도 지운다.
  async prune(
    keep: ReadonlySet<string>,
    maxBytes: number = MAX_LIBRARY_CACHE_BYTES
  ): Promise<void> {
    const now = Date.now()
    for (const sub of ['blobs', 'index', 'jars', 'resolutions']) {
      const dir = join(this.dir, sub)
      for (const name of (await readdir(dir).catch(() => [] as string[])).filter((n) =>
        n.endsWith('.tmp')
      )) {
        const info = await stat(join(dir, name)).catch(() => null)
        if (info && now - info.mtimeMs > STALE_TEMP_MS)
          await unlink(join(dir, name)).catch(() => undefined)
      }
    }
    const locks = join(this.dir, 'resolutions')
    for (const name of await readdir(locks).catch(() => [] as string[])) {
      const info = await stat(join(locks, name)).catch(() => null)
      if (info && now - info.mtimeMs > STALE_LOCK_MS)
        await unlink(join(locks, name)).catch(() => undefined)
    }
    const dir = join(this.dir, 'blobs')
    const names = (await readdir(dir).catch(() => [] as string[])).filter(
      (n) => !n.endsWith('.tmp')
    )
    const blobs: { path: string; size: number; time: number }[] = []
    for (const name of names) {
      const path = join(dir, name)
      const info = await stat(path).catch(() => null)
      if (info?.isFile()) blobs.push({ path, size: info.size, time: info.mtimeMs })
    }
    let total = blobs.reduce((sum, blob) => sum + blob.size, 0)
    if (total <= maxBytes) return
    for (const blob of blobs.sort((a, b) => a.time - b.time || (a.path < b.path ? -1 : 1))) {
      if (total <= maxBytes) break
      if (keep.has(blob.path)) continue
      await unlink(blob.path).catch(() => undefined)
      total -= blob.size
    }
  }
}
