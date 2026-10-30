import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { resolve } from 'path'
import type { JavaFileEntry } from '../shared/ipc'
import { compareOpModes } from '../shared/java/opModes'
import type {
  JdkInfo,
  ListOpModesResult,
  ListRegisteredResult,
  OpModeInfo,
  PlayDiagnostic
} from '../shared/play'
import type { ErrorMessage, RegisteredOpMode, RegistrarRef } from '../shared/sidecarProtocol'
import { isTrustedRoot } from './projectRoots'
import { EMPTY_GRADLE, noLibraries, type ControllerDeps } from './sidecar/controller'
import {
  buildListRequest,
  javaArgs,
  sourceMapper,
  sourceRootsOf,
  type Failure,
  type PlatformResolution,
  type SidecarFiles
} from './sidecar/launch'
import { runListSidecar, type ListOutcome, type ListTimeouts } from './sidecar/listSession'
import type { SidecarProcess } from './sidecar/process'
import type { HostClock } from './sidecar/session'
import { locateJavaFile } from './teamCodeJava'
import { javaTool } from './jdk'

// 등록기(@OpModeRegistrar)가 등록하는 OpMode 목록(IPC listRegisteredOpModes). 등록기는 실행해야 무엇을 등록하는지 알 수
// 있으므로(이름을 계산하고, 라이브러리의 튜닝 OpMode를 인스턴스로 등록한다 — Road Runner quickstart의 TuningOpModes) INIT
// 준비와 같은 것(열린 루트 확인, 사이드카·JDK, 팀 Gradle → Android 플랫폼 → 라이브러리, 진행은 보내지 않고 취소 없음)을 한 뒤
// JVM을 띄워 list를 보낸다(sidecar/listSession.ts). 실행(INIT)과는 별개의 JVM이다.
//
// - 캐시: 등록기 목록 + TeamCode 전체 Java 파일의 크기·수정 시각 + 클래스패스 jar(사이드카 jar 포함)의 내용 해시 + JDK가
//   같으면 JVM을 띄우지 않고 마지막 결과를 준다. 컴파일 오류도 같은 입력이면 같은 결과라 캐시한다. 실패(시간 초과·JVM 오류
//   등)는 캐시하지 않는다. FtcRobotController 쪽 소스(-sourcepath)의 변경은 보지 않는다(팀이 고치지 않는 곳).
// - 같은 루트는 한 번에 하나만 돈다(겹친 요청은 같은 결과를 기다린다).
// - 결과의 OpModeInfo: className은 등록한 OpMode 클래스(라이브러리 클래스일 수 있다), path·line은 등록기 소스와 그 클래스의
//   첫 등록기 메서드 줄, flavor는 TELEOP·AUTONOMOUS만(UTILITY·SYSTEM은 SandBot이 실행하지 않아 뺀다), group은 OpModeMeta의
//   기본 그룹('$$$$$$$')이면 ''(annotated 목록과 같다), preselectTeleOp은 transitionTarget, registered.registrar는 등록기
//   클래스. 등록기가 annotated OpMode 클래스를 그 이름 그대로 다시 등록한 것(실제 SDK는 한 번만 보인다)은 뺀다.
// - INIT은 실행마다 TeamCode의 등록기를 다시 찾고(registrarsFor, OpMode 목록의 캐시를 쓴다), 등록기 OpMode의
//   preselectTeleOp은 마지막 목록에서 찾는다(preselectTeleOp).

export type RegisteredOpModesDeps = Pick<
  ControllerDeps,
  | 'resolveJdk'
  | 'locateSidecar'
  | 'spawn'
  | 'makeRunDir'
  | 'removeRunDir'
  | 'platform'
  | 'env'
  | 'readGradle'
  | 'resolvePlatform'
  | 'resolveLibraries'
  | 'epochMillis'
> & {
  // TeamCode의 OpMode·등록기와 Java 파일 목록(src/main/opModes.ts의 scanOpModes)
  scan: (root: unknown) => Promise<{ result: ListOpModesResult; files: JavaFileEntry[] }>
  // 프로젝트의 모의 저장소(launch.ts simFirstFolder). 등록기도 로봇처럼 그 저장소를 본다.
  makeFirstFolder: (projectRoot: string) => Promise<string>
  clock?: HostClock
  timeouts?: Partial<ListTimeouts>
  // jar 내용 해시(캐시 키). 없으면 sha256(크기·수정 시각이 같으면 기억한 값).
  hashFile?: (file: string) => Promise<string>
}

type CacheEntry = { key: string; result: Extract<ListRegisteredResult, { ok: true }> }

const DEFAULT_GROUP = '$$$$$$$'
const MESSAGE_LIMIT = 2000

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clip(text: string): string {
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT)}…` : text
}

function isFailure(value: object): value is Failure {
  return 'ok' in value && value.ok === false
}

function listFailure(failure: Failure): ListRegisteredResult {
  // 목록에는 바쁨·취소가 없다(INIT과 따로 돌고 취소하지 않는다)
  const code = failure.code === 'busy' || failure.code === 'cancelled' ? 'failed' : failure.code
  return { ok: false, code, detail: failure.detail }
}

// 등록기 오류 메시지(사이드카 RegistrarRunner: "The registrar class X …", "The @OpModeRegistrar method X.m …")가 가리키는
// 등록기 클래스. 이름이 겹치면(중첩 클래스) 가장 긴 것.
export function registrarOfError(message: string, registrars: readonly RegistrarRef[]): string {
  let best = ''
  for (const { className } of registrars) {
    const at = message.indexOf(className)
    if (at < 0 || className.length <= best.length) continue
    const next = message.charAt(at + className.length)
    if (next === '.' || next === ' ' || next === '') best = className
  }
  return best
}

// 사이드카가 등록한 것 → 렌더러 목록 항목(UTILITY·SYSTEM·등록기 줄을 모르는 것은 null)
export function registeredInfo(
  registered: RegisteredOpMode,
  registrarLines: ReadonlyMap<string, { path: string; line: number }>
): OpModeInfo | null {
  if (registered.flavor !== 'TeleOp' && registered.flavor !== 'Autonomous') return null
  const at = registrarLines.get(registered.registrar)
  if (!at) return null
  return {
    className: registered.className,
    path: at.path,
    line: at.line,
    flavor: registered.flavor,
    name: registered.name,
    group: registered.group === DEFAULT_GROUP ? '' : registered.group,
    preselectTeleOp: registered.flavor === 'Autonomous' ? registered.transitionTarget : '',
    registered: { registrar: registered.registrar }
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export class RegisteredOpModes {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly running = new Map<string, Promise<ListRegisteredResult>>()
  private readonly hashes = new Map<string, { size: number; mtimeMs: number; hash: string }>()

  constructor(private readonly deps: RegisteredOpModesDeps) {}

  list(root: unknown): Promise<ListRegisteredResult> {
    if (!isTrustedRoot(root))
      return Promise.resolve({ ok: false, code: 'notAllowed', detail: 'not an opened project' })
    const key = resolve(root)
    const running = this.running.get(key)
    if (running) return running
    const promise = this.listOnce(root, key)
      .catch((error): ListRegisteredResult => ({
        ok: false,
        code: 'failed',
        detail: errorText(error)
      }))
      .finally(() => this.running.delete(key))
    this.running.set(key, promise)
    return promise
  }

  // INIT: TeamCode의 모든 등록기(클래스마다 하나, 클래스 이름 순, 소스는 링크를 확인한 절대 경로)
  async registrarsFor(root: string): Promise<RegistrarRef[]> {
    const { result } = await this.deps.scan(root)
    return result.ok ? this.locate(root, result) : []
  }

  // INIT: 등록기 OpMode의 preselectTeleOp(마지막 목록, 없으면 '')
  preselectTeleOp(root: string, name: string): string {
    const entry = this.cache.get(resolve(root))
    return entry?.result.opModes.find((info) => info.name === name)?.preselectTeleOp ?? ''
  }

  // 테스트용
  clear(): void {
    this.cache.clear()
    this.hashes.clear()
  }

  private async locate(root: string, result: ListOpModesResult): Promise<RegistrarRef[]> {
    if (!result.ok) return []
    const refs: RegistrarRef[] = []
    const seen = new Set<string>()
    for (const registrar of result.registrars) {
      if (seen.has(registrar.className)) continue
      seen.add(registrar.className)
      const located = await locateJavaFile(root, registrar.path)
      if (located.ok) refs.push({ className: registrar.className, source: located.file })
    }
    return refs
  }

  private async hash(file: string): Promise<string> {
    const info = await stat(file).catch(() => null)
    if (!info) return 'missing'
    const known = this.hashes.get(file)
    if (known && known.size === info.size && known.mtimeMs === info.mtimeMs) return known.hash
    const hash = await (this.deps.hashFile ?? sha256File)(file).catch(() => 'unreadable')
    this.hashes.set(file, { size: info.size, mtimeMs: info.mtimeMs, hash })
    return hash
  }

  private async listOnce(root: string, rootKey: string): Promise<ListRegisteredResult> {
    const scanned = await this.deps.scan(root)
    const listed = scanned.result
    if (!listed.ok) return { ok: false, code: 'notAllowed', detail: listed.detail }
    if (!listed.hasTeamCode) return { ok: false, code: 'missing', detail: 'TeamCode' }
    const refs = await this.locate(root, listed)
    if (refs.length === 0) {
      const empty: CacheEntry['result'] = { ok: true, opModes: [], diagnostics: [], errors: [] }
      this.cache.set(rootKey, { key: '', result: empty })
      return empty
    }

    const projectRoot = rootKey
    const files = await this.deps.locateSidecar()
    if (isFailure(files)) return listFailure(files)
    const jdk = await this.deps.resolveJdk()
    if (!jdk) return { ok: false, code: 'noJdk', detail: '' }
    const gradle = await (this.deps.readGradle?.(projectRoot) ?? Promise.resolve(EMPTY_GRADLE))
    const platform = await (this.deps.resolvePlatform?.(
      projectRoot,
      gradle.compileSdk,
      gradle.compileSdkMinor
    ) ??
      Promise.resolve<PlatformResolution>({
        ok: true,
        bootClasspath: [],
        api: null,
        minor: null,
        guessed: false
      }))
    if (isFailure(platform)) return listFailure(platform)
    const libraries = await (this.deps.resolveLibraries ?? noLibraries)({
      projectRoot,
      gradle,
      signal: new AbortController().signal,
      progress: () => undefined
    })
    if (isFailure(libraries)) return listFailure(libraries)

    const sourceRoots = await sourceRootsOf(projectRoot)
    const classpaths = {
      bootClasspath: platform.bootClasspath,
      compileClasspath: [files.sdkJar, ...libraries.compileClasspath],
      libraryClasspath: libraries.libraryClasspath
    }
    const key = await this.cacheKey(jdk, files, sourceRoots, refs, scanned.files, classpaths)
    const cached = this.cache.get(rootKey)
    if (cached && cached.key === key) return cached.result

    let firstFolder: string
    try {
      firstFolder = await this.deps.makeFirstFolder(projectRoot)
    } catch (error) {
      return { ok: false, code: 'failed', detail: `sim files: ${errorText(error)}` }
    }
    const outcome = await this.runJvm(
      jdk,
      files,
      buildListRequest(
        sourceRoots,
        refs,
        classpaths,
        firstFolder,
        (this.deps.epochMillis ?? Date.now)()
      )
    )
    if (outcome.kind === 'failed') return { ok: false, code: 'failed', detail: outcome.detail }

    const mapSource = sourceMapper(projectRoot)
    let result: CacheEntry['result']
    if (outcome.kind === 'compileFailed') {
      const diagnostics = outcome.diagnostics
        .filter((d) => d.kind === 'error')
        .map((d): PlayDiagnostic => {
          const mapped = d.file === null ? { path: null, file: '' } : mapSource(d.file)
          return {
            kind: d.kind,
            path: mapped.path,
            file: mapped.file,
            line: d.line,
            column: d.column,
            message: d.message,
            code: d.code,
            hint: libraries.diagnosticHint(d)
          }
        })
      result = { ok: true, opModes: [], diagnostics, errors: [] }
    } else {
      result = {
        ok: true,
        opModes: this.toInfos(outcome.opModes, listed),
        diagnostics: [],
        errors: outcome.errors.map((error: ErrorMessage) => ({
          registrar: registrarOfError(error.message, refs),
          message: clip(error.message)
        }))
      }
    }
    this.cache.set(rootKey, { key, result })
    return result
  }

  private toInfos(registered: RegisteredOpMode[], listed: ListOpModesResult): OpModeInfo[] {
    if (!listed.ok) return []
    // 등록기 클래스 → 소스와 첫 등록기 메서드 줄(registrars는 클래스·경로·줄 순)
    const lines = new Map<string, { path: string; line: number }>()
    for (const registrar of listed.registrars)
      if (!lines.has(registrar.className))
        lines.set(registrar.className, { path: registrar.path, line: registrar.line })
    const annotated = new Set(listed.opModes.map((info) => `${info.className}\n${info.name}`))
    const out: OpModeInfo[] = []
    for (const one of registered) {
      const info = registeredInfo(one, lines)
      if (info && !annotated.has(`${info.className}\n${info.name}`)) out.push(info)
    }
    return out.sort(compareOpModes)
  }

  private async cacheKey(
    jdk: JdkInfo,
    files: SidecarFiles,
    sourceRoots: string[],
    refs: RegistrarRef[],
    javaFiles: JavaFileEntry[],
    classpaths: { bootClasspath: string[]; compileClasspath: string[]; libraryClasspath: string[] }
  ): Promise<string> {
    const jars = [
      files.runtimeJar,
      ...classpaths.bootClasspath,
      ...classpaths.compileClasspath,
      ...classpaths.libraryClasspath
    ]
    const hashes: string[] = []
    for (const jar of jars) hashes.push(`${jar}\n${await this.hash(jar)}`)
    const text = JSON.stringify({
      jdk: [jdk.home, jdk.version],
      sourceRoots,
      refs,
      files: javaFiles.map((file) => [file.path, file.size, file.mtimeMs]),
      classpaths,
      hashes
    })
    return createHash('sha256').update(text).digest('hex')
  }

  private async runJvm(
    jdk: JdkInfo,
    files: SidecarFiles,
    request: ReturnType<typeof buildListRequest>
  ): Promise<ListOutcome> {
    const runDir = await this.deps.makeRunDir()
    try {
      let process: SidecarProcess
      try {
        process = await this.deps.spawn(
          javaTool(jdk.home, 'java', this.deps.platform),
          javaArgs(files, this.deps.platform),
          { cwd: runDir, env: this.deps.env }
        )
      } catch (error) {
        return { kind: 'failed', detail: errorText(error) }
      }
      return await runListSidecar(process, request, {
        clock: this.deps.clock,
        timeouts: this.deps.timeouts
      })
    } finally {
      await this.deps.removeRunDir(runDir).catch(() => undefined)
    }
  }
}

// 앱의 목록 서비스(sidecar/index.ts의 registerPlayIpc가 실행과 같은 준비로 만든다). IPC 처리기는 src/main/opModes.ts.
let service: RegisteredOpModes | null = null

export function setRegisteredOpModes(next: RegisteredOpModes | null): void {
  service = next
}

export function listRegisteredOpModes(root: unknown): Promise<ListRegisteredResult> {
  if (!service)
    return Promise.resolve({ ok: false, code: 'failed', detail: 'the sidecar is not set up' })
  return service.list(root)
}
