import { lstat, readFile, realpath, stat } from 'fs/promises'
import path from 'path'
import { GENERATED_XML_DIR, isAllowedGeneratedPath } from '../../shared/generatedFiles'
import { parseOpModes } from '../../shared/java/opModes'
import type { OpModeFlavor, PlayInitRequest, PlayInitResult, PlaySettings } from '../../shared/play'
import {
  DEFAULT_STALL_MILLIS,
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type RunRequest
} from '../../shared/sidecarProtocol'
import {
  isLinkableJavaPath,
  JAVA_SOURCE_PREFIX,
  normalizeLinkPath,
  TEAMCODE_DIR
} from '../../shared/teamCodePaths'
import { isTrustedRoot } from '../projectRoots'
import { containedIn, locateJavaFile } from '../teamCodeJava'
import { isValidSpeed, type SourceMapper } from './session'

// 실행 준비: 렌더러가 보낸 요청(믿지 않는 입력)을 확인하고, 사이드카 빌드 결과를 찾고, JVM 명령과 RunRequest를 만든다.
// 경로 규칙은 다른 TeamCode IPC와 같다: 열거나 저장한 프로젝트만(projectRoots.ts), OpMode 소스는 teamCodePaths.ts 규칙과
// 링크를 푼 위치가 TeamCode/src/main/java 안(teamCodeJava.ts의 locateJavaFile), 로봇 구성은 generatedFiles.ts의
// res/xml/sandbot_*.xml이고 링크를 푼 위치가 TeamCode 안. 사이드카는 이 파일들을 읽기만 한다.

export type Failure = Extract<PlayInitResult, { ok: false }>

function failure(code: Failure['code'], detail: string): Failure {
  return { ok: false, code, detail }
}

// ---- 사이드카 위치 ----

export type SidecarFiles = { dir: string; runtimeJar: string; sdkJar: string }

export const RUNTIME_JAR = 'sandbot-runtime.jar'
export const SDK_JAR = 'sandbot-sdk.jar'
export const SIDECAR_INFO = 'sidecar.json'

async function isFile(target: string): Promise<boolean> {
  return (await stat(target).catch(() => null))?.isFile() ?? false
}

async function isDirectory(target: string): Promise<boolean> {
  return (await stat(target).catch(() => null))?.isDirectory() ?? false
}

// 빌드 결과 폴더(pnpm build:sidecar가 쓴다). sidecar.json의 protocol이 지금 호스트와 같아야 한다.
export async function readSidecarFiles(dir: string): Promise<SidecarFiles | Failure> {
  let info: unknown
  try {
    info = JSON.parse(await readFile(path.join(dir, SIDECAR_INFO), 'utf8'))
  } catch {
    return failure('noSidecar', `${SIDECAR_INFO} not found in ${dir}`)
  }
  const protocol = (info as Record<string, unknown> | null)?.protocol
  if (protocol !== SIDECAR_PROTOCOL_VERSION)
    return failure(
      'noSidecar',
      `sidecar protocol ${String(protocol)}, expected ${SIDECAR_PROTOCOL_VERSION}`
    )
  const runtimeJar = path.join(dir, RUNTIME_JAR)
  const sdkJar = path.join(dir, SDK_JAR)
  for (const jar of [runtimeJar, sdkJar])
    if (!(await isFile(jar))) return failure('noSidecar', `${path.basename(jar)} not found`)
  return { dir, runtimeJar, sdkJar }
}

// ---- 요청 확인 ----

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/
// 바이너리 이름 세그먼트(Java 식별자, teamCodePaths.ts와 같은 범주)
const IDENTIFIER = /^[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]*$/u

export type ValidRequest = {
  runId: string
  root: string
  opMode: { className: string; path: string; flavor: OpModeFlavor }
  configPath: string | null
  settings: PlaySettings
}

// OpMode 바이너리 이름이 그 파일의 것인지: 최상위 클래스 이름은 파일 이름과 같다(public 최상위 클래스만 OpMode가
// 될 수 있고, javac는 public 최상위 클래스의 파일 이름을 강제한다). 중첩 클래스는 Outer$Inner.
export function isBinaryNameOf(className: string, relPath: string): boolean {
  if (className.length > 1024) return false
  const segments = className.split('.')
  if (!segments.every((segment) => segment.split('$').every((part) => IDENTIFIER.test(part))))
    return false
  const stem = relPath.slice(relPath.lastIndexOf('/') + 1).replace(/\.java$/, '')
  return segments[segments.length - 1].split('$')[0] === stem
}

// 모양 확인. 틀리면 notAllowed(렌더러 오류).
export function validateRequest(input: unknown): ValidRequest | Failure {
  const bad = (what: string): Failure => failure('notAllowed', `invalid request: ${what}`)
  if (typeof input !== 'object' || input === null) return bad('not an object')
  const request = input as Partial<Record<keyof PlayInitRequest, unknown>>
  const { runId, root, opMode, configPath, settings } = request
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) return bad('runId')
  if (typeof root !== 'string' || root === '') return bad('root')
  if (typeof opMode !== 'object' || opMode === null) return bad('opMode')
  const { className, path: relPath, flavor } = opMode as Record<string, unknown>
  if (typeof relPath !== 'string' || !isLinkableJavaPath(relPath)) return bad('opMode.path')
  if (typeof className !== 'string' || !isBinaryNameOf(className, relPath))
    return bad('opMode.className')
  if (flavor !== 'TeleOp' && flavor !== 'Autonomous') return bad('opMode.flavor')
  if (
    configPath !== null &&
    (typeof configPath !== 'string' ||
      !configPath.startsWith(`${GENERATED_XML_DIR}/`) ||
      !isAllowedGeneratedPath(configPath))
  )
    return bad('configPath')
  if (typeof settings !== 'object' || settings === null) return bad('settings')
  const { speed, jitter, seed, autoStopAutonomous } = settings as Record<string, unknown>
  if (!isValidSpeed(speed)) return bad('settings.speed')
  // HubTiming: 0 이상 1 미만
  if (typeof jitter !== 'number' || !(jitter >= 0 && jitter < 1)) return bad('settings.jitter')
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) return bad('settings.seed')
  if (typeof autoStopAutonomous !== 'boolean') return bad('settings.autoStopAutonomous')
  return {
    runId,
    root,
    opMode: { className, path: relPath, flavor },
    configPath: configPath ?? null,
    settings: { speed, jitter, seed, autoStopAutonomous }
  }
}

// ---- 실행 준비(파일 시스템) ----

export type PreparedRun = {
  projectRoot: string
  sourceRoots: string[]
  opModeSource: string
  configXml: string | null
  preselectTeleOp: string
}

const PRESELECT_READ_LIMIT = 1024 * 1024

// Autonomous의 preselectTeleOp(목록과 같은 파서로 그 파일을 읽는다)
async function preselectOf(file: string, className: string): Promise<string> {
  try {
    const info = await stat(file)
    if (info.size > PRESELECT_READ_LIMIT) return ''
    const opModes = parseOpModes(await readFile(file, 'utf8'))
    return opModes.find((opMode) => opMode.className === className)?.preselectTeleOp ?? ''
  } catch {
    return ''
  }
}

// 루트 → OpMode 소스 → 로봇 구성 순서로 확인하고 사이드카에 넘길 절대 경로를 정한다
export async function prepareRun(request: ValidRequest): Promise<PreparedRun | Failure> {
  if (!isTrustedRoot(request.root)) return failure('notAllowed', 'not an opened project')
  const projectRoot = path.resolve(request.root)
  const teamCode = path.join(projectRoot, TEAMCODE_DIR)
  const javaRoot = path.join(teamCode, ...JAVA_SOURCE_PREFIX.split('/').filter(Boolean))
  if (!(await isDirectory(javaRoot))) return failure('missing', 'TeamCode/src/main/java')

  const located = await locateJavaFile(request.root, request.opMode.path)
  if (!located.ok) return failure(located.code, located.detail)

  let configXml: string | null = null
  if (request.configPath !== null) {
    const file = path.join(teamCode, ...request.configPath.split('/'))
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) =>
      error.code === 'ENOENT' || error.code === 'ENOTDIR' ? null : error
    )
    if (info instanceof Error) return failure('failed', `config: ${info.message}`)
    // 없으면 장치 없는 hardwareMap으로 실행한다(렌더러가 경고한다)
    if (info !== null) {
      if (!info.isFile()) return failure('notAllowed', 'config is not a regular file')
      const [realTeamCode, real] = await Promise.all([
        realpath(teamCode).catch(() => null),
        realpath(file).catch(() => null)
      ])
      if (!realTeamCode || !real || !containedIn(realTeamCode, real))
        return failure('notAllowed', 'config is outside TeamCode')
      configXml = file
    }
  }

  const sourceRoots = [javaRoot]
  const robotController = path.join(projectRoot, 'FtcRobotController', 'src', 'main', 'java')
  if (await isDirectory(robotController)) sourceRoots.push(robotController)

  return {
    projectRoot,
    sourceRoots,
    opModeSource: located.file,
    configXml,
    preselectTeleOp:
      request.opMode.flavor === 'Autonomous'
        ? await preselectOf(located.file, request.opMode.className)
        : ''
  }
}

export function buildRunRequest(
  prepared: PreparedRun,
  request: ValidRequest,
  files: SidecarFiles,
  now: number = Date.now()
): RunRequest {
  return {
    type: 'run',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots: prepared.sourceRoots,
    opModeSource: prepared.opModeSource,
    opModeClass: request.opMode.className,
    sdkClasspath: [files.sdkJar],
    configXml: prepared.configXml,
    // 1단계는 Hub 타이밍을 덮어쓰지 않는다(측정 보정은 나중)
    timing: {},
    jitter: request.settings.jitter,
    seed: request.settings.seed,
    startEpochMillis: now,
    stallMillis: DEFAULT_STALL_MILLIS
  }
}

// JVM 인자. 스택은 깊은 재귀(팀 코드·javac)를 위해 늘리고, GC는 작은 힙에 맞는 직렬 GC. 출력 인코딩은 UTF-8로 고정한다
// (Windows 기본 코드 페이지로 쓰면 한글 로그가 깨진다. stdout.encoding은 JDK 18부터 읽는다).
export function javaArgs(
  files: SidecarFiles,
  platform: NodeJS.Platform = process.platform
): string[] {
  const delimiter = platform === 'win32' ? ';' : ':'
  return [
    '-Xss4m',
    '-XX:+UseSerialGC',
    '-Dfile.encoding=UTF-8',
    '-Dstdout.encoding=UTF-8',
    '-Dstderr.encoding=UTF-8',
    '-Djava.awt.headless=true',
    '-cp',
    `${files.runtimeJar}${delimiter}${files.sdkJar}`,
    'org.sandbot.runtime.Main'
  ]
}

// 사이드카가 알려 준 절대 경로(진단·스택 프레임) → TeamCode 기준 경로. 외부 편집기로 열 수 있는 팀 코드
// (teamCodePaths.ts 규칙)만 path가 있고, TeamCode 안의 다른 파일(생성 코드 등)은 보일 이름만, 밖은 파일 이름만.
export function sourceMapper(
  projectRoot: string,
  api: Pick<typeof path, 'relative' | 'isAbsolute' | 'sep' | 'basename' | 'join'> = path
): SourceMapper {
  const teamCode = api.join(projectRoot, TEAMCODE_DIR)
  return (absolute) => {
    const rel = api.relative(teamCode, absolute)
    if (rel === '' || rel === '..' || rel.startsWith(`..${api.sep}`) || api.isAbsolute(rel))
      return { path: null, file: api.basename(absolute) }
    const relPath = normalizeLinkPath(rel.split(api.sep).join('/'))
    return { path: isLinkableJavaPath(relPath) ? relPath : null, file: relPath }
  }
}
