import { createHash } from 'crypto'
import { lstat, mkdir, readFile, realpath, stat } from 'fs/promises'
import path from 'path'
import { GENERATED_XML_DIR, isAllowedGeneratedPath } from '../../shared/generatedFiles'
import type { GradleProject } from '../../shared/gradle'
import { isTopLevelOfFile, parseOpModes } from '../../shared/java/opModes'
import type { LibraryProgress, LibraryReport } from '../../shared/libraries'
import {
  MAX_BATTERY_VOLTAGE,
  MIN_BATTERY_VOLTAGE,
  type DiagnosticHint,
  type OpModeFlavor,
  type PlayInitRequest,
  type PlayInitResult,
  type PlaySettings
} from '../../shared/play'
import { parseWorldSpec, type WorldSpec } from '../../shared/sim/worldSpec'
import {
  DEFAULT_STALL_MILLIS,
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type CompileDiagnostic,
  type ListRequest,
  type RegistrarRef,
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

// dashboardJar: FTC Dashboard 대체 jar(이 빌드에 없으면 null). Dashboard를 쓰는 실행에만 필요하다(controller가 확인한다).
export type SidecarFiles = {
  dir: string
  runtimeJar: string
  sdkJar: string
  dashboardJar: string | null
}

export const RUNTIME_JAR = 'sandbot-runtime.jar'
export const SDK_JAR = 'sandbot-sdk.jar'
// FTC Dashboard 대체(라이브러리 L2). 팀 Gradle이 Dashboard를 선언하면 라이브러리 해석이 실제 jar 대신 실행 클래스패스에 넣는다.
export const DASHBOARD_JAR = 'sandbot-dashboard.jar'
export const SIDECAR_INFO = 'sidecar.json'

// 사이드카 폴더의 FTC Dashboard 대체 jar(라이브러리 해석이 실행 클래스패스에 넣는 경로)
export function dashboardJarPath(dir: string): string {
  return path.join(dir, DASHBOARD_JAR)
}

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
  const dashboardJar = dashboardJarPath(dir)
  return {
    dir,
    runtimeJar,
    sdkJar,
    dashboardJar: (await isFile(dashboardJar)) ? dashboardJar : null
  }
}

// ---- 요청 확인 ----

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/
// 바이너리 이름 세그먼트(Java 식별자, teamCodePaths.ts와 같은 범주)
const IDENTIFIER = /^[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]*$/u

export type ValidRequest = {
  runId: string
  root: string
  // registeredName: 등록기 OpMode의 DS 이름(className·path는 그 등록기). 없으면 null.
  opMode: { className: string; path: string; flavor: OpModeFlavor; registeredName: string | null }
  configPath: string | null
  settings: PlaySettings
  world: WorldSpec | null
}

// 등록기 OpMode의 DS 이름: 1–200자, 제어 문자 없음(OpModeMeta는 이름을 그대로 쓴다)
export function isRegisteredName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length >= 1 &&
    name.length <= 200 &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(name)
  )
}

// OpMode 바이너리 이름이 그 파일의 것인지: 최상위 클래스 이름은 파일 이름과 같다(public 최상위 클래스만 OpMode가
// 될 수 있고, javac는 public 최상위 클래스의 파일 이름을 강제한다). 중첩 클래스는 Outer$Inner. OpMode 목록도 같은
// 규칙으로 거른다(src/shared/java/opModes.ts isTopLevelOfFile).
export function isBinaryNameOf(className: string, relPath: string): boolean {
  if (className.length > 1024) return false
  const segments = className.split('.')
  if (!segments.every((segment) => segment.split('$').every((part) => IDENTIFIER.test(part))))
    return false
  return isTopLevelOfFile(className, relPath)
}

// 모양 확인. 틀리면 notAllowed(렌더러 오류).
export function validateRequest(input: unknown): ValidRequest | Failure {
  const bad = (what: string): Failure => failure('notAllowed', `invalid request: ${what}`)
  if (typeof input !== 'object' || input === null) return bad('not an object')
  const request = input as Partial<Record<keyof PlayInitRequest, unknown>>
  const { runId, root, opMode, configPath, settings, world } = request
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) return bad('runId')
  if (typeof root !== 'string' || root === '') return bad('root')
  if (typeof opMode !== 'object' || opMode === null) return bad('opMode')
  const { className, path: relPath, flavor, registeredName } = opMode as Record<string, unknown>
  if (typeof relPath !== 'string' || !isLinkableJavaPath(relPath)) return bad('opMode.path')
  if (typeof className !== 'string' || !isBinaryNameOf(className, relPath))
    return bad('opMode.className')
  if (flavor !== 'TeleOp' && flavor !== 'Autonomous') return bad('opMode.flavor')
  if (registeredName !== undefined && !isRegisteredName(registeredName))
    return bad('opMode.registeredName')
  if (
    configPath !== null &&
    (typeof configPath !== 'string' ||
      !configPath.startsWith(`${GENERATED_XML_DIR}/`) ||
      !isAllowedGeneratedPath(configPath))
  )
    return bad('configPath')
  if (typeof settings !== 'object' || settings === null) return bad('settings')
  const { speed, jitter, seed, autoStopAutonomous, batteryVoltage } = settings as Record<
    string,
    unknown
  >
  if (!isValidSpeed(speed)) return bad('settings.speed')
  // HubTiming: 0 이상 1 미만
  if (typeof jitter !== 'number' || !(jitter >= 0 && jitter < 1)) return bad('settings.jitter')
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) return bad('settings.seed')
  if (typeof autoStopAutonomous !== 'boolean') return bad('settings.autoStopAutonomous')
  if (
    typeof batteryVoltage !== 'number' ||
    !(batteryVoltage >= MIN_BATTERY_VOLTAGE && batteryVoltage <= MAX_BATTERY_VOLTAGE)
  )
    return bad('settings.batteryVoltage')
  const parsedWorld = world === undefined || world === null ? null : parseWorldSpec(world)
  if (typeof parsedWorld === 'string') return bad(`world: ${parsedWorld}`)
  return {
    runId,
    root,
    opMode: { className, path: relPath, flavor, registeredName: registeredName ?? null },
    configPath: configPath ?? null,
    settings: { speed, jitter, seed, autoStopAutonomous, batteryVoltage },
    world: parsedWorld
  }
}

// ---- 실행 준비(파일 시스템) ----

export type PreparedRun = {
  projectRoot: string
  sourceRoots: string[]
  opModeSource: string
  configXml: string | null
  // 요청한 구성 XML이 없다(장치 없는 hardwareMap으로 실행)
  configMissing: boolean
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

  return {
    projectRoot,
    sourceRoots: await sourceRootsOf(projectRoot),
    opModeSource: located.file,
    configXml,
    configMissing: request.configPath !== null && configXml === null,
    // 등록기 OpMode의 preselectTeleOp은 등록 결과(OpModeMeta의 transitionTarget)다(controller가 목록 캐시에서 찾는다)
    preselectTeleOp:
      request.opMode.flavor === 'Autonomous' && request.opMode.registeredName === null
        ? await preselectOf(located.file, request.opMode.className)
        : ''
  }
}

// javac -sourcepath: TeamCode/src/main/java와, 있으면 FtcRobotController/src/main/java
export async function sourceRootsOf(projectRoot: string): Promise<string[]> {
  const javaRoot = path.join(
    projectRoot,
    TEAMCODE_DIR,
    ...JAVA_SOURCE_PREFIX.split('/').filter(Boolean)
  )
  const sourceRoots = [javaRoot]
  const robotController = path.join(projectRoot, 'FtcRobotController', 'src', 'main', 'java')
  if (await isDirectory(robotController)) sourceRoots.push(robotController)
  return sourceRoots
}

// ---- 모의 저장소(AppUtil.ROOT_FOLDER, 로봇의 /sdcard/FIRST) ----

export const SIM_FILES_DIR = 'sim-files'

// 프로젝트마다의 모의 저장소: <simRoot>/<sha256(링크를 푼 프로젝트 루트) 앞 16자>/FIRST. simRoot는 userData/sim-files라
// TeamCode·프로젝트 밖이다. 실행마다(INIT·등록기 목록) 만든다(mkdir -p, 지우지 않는다: Road Runner 튜닝 결과 등이 남는다).
export async function simFirstFolder(simRoot: string, projectRoot: string): Promise<string> {
  const real = await realpath(projectRoot).catch(() => path.resolve(projectRoot))
  const key = createHash('sha256').update(real, 'utf8').digest('hex').slice(0, 16)
  const dir = path.join(simRoot, key, 'FIRST')
  await mkdir(dir, { recursive: true })
  return dir
}

// ---- 컴파일 기준과 라이브러리(controller가 JVM을 띄우기 전에 정한다) ----

// 팀 프로젝트 compileSdk의 플랫폼 API jar(src/main/androidSdk.ts). bootClasspath가 비면 javac --release 8(시험만)이고
// api는 null. api·minor는 그 플랫폼의 주·부 버전(android-36.1이면 36·1, android-37.0이면 37·0, android-N이면 minor null).
// guessed: compileSdk를 몰라 설치된 플랫폼 중 가장 높은 것을 골랐다(의존성 보고에 경고로 보인다).
export type PlatformResolution = {
  ok: true
  bootClasspath: string[]
  api: number | null
  minor: number | null
  guessed: boolean
}

export type LibraryRequest = {
  projectRoot: string
  gradle: GradleProject
  // STOP(INIT 취소)으로 멈춘다. 멈추면 cancelled 실패를 돌려준다.
  signal: AbortSignal
  progress: (progress: LibraryProgress) => void
}

// 팀 Gradle의 라이브러리(src/main/libraries). 클래스패스는 라이브러리 캐시 안의 절대 경로.
export type LibraryResolution = {
  ok: true
  report: LibraryReport
  // javac -classpath에 sandbot-sdk.jar 다음으로 넣을 jar(순서대로)
  compileClasspath: string[]
  // 실행 때 LibraryClassLoader가 읽는 jar(순서대로)
  libraryClasspath: string[]
  // jar 절대 경로 → 'g:a:v'(링크 검사 경고를 좌표로 보이려고)
  jarCoordinates: Record<string, string>
  // 컴파일 진단에 붙일 안내(라이브러리 패키지를 찾지 못한 오류). 없으면 null.
  diagnosticHint: (diagnostic: CompileDiagnostic) => DiagnosticHint | null
}

export type RunClasspaths = {
  bootClasspath: string[]
  compileClasspath: string[]
  libraryClasspath: string[]
}

// 등록기와 모의 저장소(라이브러리 L2). registrars: TeamCode의 모든 등록기(절대 경로 소스), firstFolder: AppUtil.ROOT_FOLDER.
export type RunRegistrars = {
  registrars: RegistrarRef[]
  firstFolder: string
}

export function buildRunRequest(
  prepared: PreparedRun,
  request: ValidRequest,
  classpaths: RunClasspaths,
  registrars: RunRegistrars,
  now: number = Date.now()
): RunRequest {
  return {
    type: 'run',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots: prepared.sourceRoots,
    opModeSource: prepared.opModeSource,
    // 등록기 OpMode면 className은 등록기이고 실행할 것은 이름으로 고른다
    opModeClass: request.opMode.registeredName === null ? request.opMode.className : null,
    registeredName: request.opMode.registeredName,
    registrars: registrars.registrars,
    firstFolder: registrars.firstFolder,
    bootClasspath: classpaths.bootClasspath,
    compileClasspath: classpaths.compileClasspath,
    libraryClasspath: classpaths.libraryClasspath,
    configXml: prepared.configXml,
    // 1단계는 Hub 타이밍을 덮어쓰지 않는다(측정 보정은 나중)
    timing: {},
    jitter: request.settings.jitter,
    seed: request.settings.seed,
    startEpochMillis: now,
    stallMillis: DEFAULT_STALL_MILLIS
  }
}

// 등록기 OpMode 목록 요청(registeredOpModes.ts). 클래스패스·플랫폼은 INIT과 같게 정한 것이다.
export function buildListRequest(
  sourceRoots: string[],
  registrars: RegistrarRef[],
  classpaths: RunClasspaths,
  firstFolder: string,
  now: number = Date.now()
): ListRequest {
  return {
    type: 'list',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots,
    registrars,
    bootClasspath: classpaths.bootClasspath,
    compileClasspath: classpaths.compileClasspath,
    libraryClasspath: classpaths.libraryClasspath,
    firstFolder,
    startEpochMillis: now,
    stallMillis: DEFAULT_STALL_MILLIS
  }
}

// JVM 인자. 스택은 깊은 재귀(팀 코드·javac)를 위해 늘리고, GC는 작은 힙에 맞는 직렬 GC. 출력 인코딩은 UTF-8로 고정한다
// (Windows 기본 코드 페이지로 쓰면 한글 로그가 깨진다. stdout.encoding은 JDK 18부터 읽는다).
// stdout은 프로토콜 전용이라 JVM 자신의 출력은 stderr로 보낸다: 통합 로깅(-Xlog)의 기본 설정은 경고를 stdout에 쓰고
// (스레드를 더 만들지 못함, 코드 캐시 가득 참, 큰 페이지 없음 등), tty 출력(치명적 오류 안내 등)도 stdout이다. 섞이면
// 호스트가 프로토콜 오류로 실행을 끝낸다. stderr로 보내면 crashed의 detail에 보인다.
export function javaArgs(
  files: SidecarFiles,
  platform: NodeJS.Platform = process.platform
): string[] {
  const delimiter = platform === 'win32' ? ';' : ':'
  return [
    '-Xlog:disable',
    '-Xlog:all=warning:stderr',
    '-XX:+DisplayVMOutputToStderr',
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
