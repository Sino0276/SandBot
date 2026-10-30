// 렌더러 ↔ 메인 프로세스의 실행(Play) API 타입. 메인이 JDK를 찾고 사이드카(JVM)를 띄워 팀의 OpMode를
// 가상 시계로 실행한다(프로토콜은 sidecarProtocol.ts). 렌더러는 Driver Station처럼 OpMode를 고르고 INIT → START → STOP을
// 보내며, Unity처럼 일시 정지·한 단계·속도를 바꾼다.
import type { DashConfigNode, DashOp } from './dashboard'
import type {
  DeviceValues,
  FinishReason,
  GamepadState,
  SidecarNoticeCode,
  SimErrorKind,
  TelemetryFrame
} from './sidecarProtocol'
import type { LibraryProgress, LibraryReason, LibraryReport } from './libraries'
import type { SimPose, WorldSpec } from './sim/worldSpec'

// ---- OpMode 목록 ----

export type OpModeFlavor = 'TeleOp' | 'Autonomous'

// TeamCode의 @TeleOp·@Autonomous 클래스 하나(@Disabled·abstract 제외, 소스를 읽어 정한다, 컴파일하지 않음), 또는
// @OpModeRegistrar가 등록한 OpMode 하나(registered, 사이드카가 등록기를 실행해 정한다).
export type OpModeInfo = {
  // 바이너리 이름(중첩 클래스는 Outer$Inner)
  className: string
  // TeamCode 기준 소스 경로('src/main/java/…', teamCodePaths.ts 규칙)
  path: string
  // 애너테이션이 있는 줄(1부터, 외부 편집기로 열 때)
  line: number
  flavor: OpModeFlavor
  // DS에 보이는 이름: 애너테이션 name, 없거나 비었거나 글자 리터럴이 아니면 클래스 단순 이름(SDK와 같음)
  name: string
  // 애너테이션 group. 없으면 ''(SDK 기본 그룹)
  group: string
  // @Autonomous(preselectTeleOp = …). 없으면 ''
  preselectTeleOp: string
  // 등록기 OpMode: className은 등록한 OpMode 클래스, path·line은 등록기 소스와 그 메서드 줄, preselectTeleOp은
  // OpModeMeta의 transitionTarget. 고르는 키는 'registered:' + name(DS 이름은 유일하다), annotated는 className.
  registered?: { registrar: string }
}

// TeamCode의 @OpModeRegistrar 메서드 하나(소스를 읽어 찾는다). 사이드카가 실제 SDK 규칙으로 다시 거른다.
export type RegistrarInfo = {
  // 메서드가 있는 클래스의 바이너리 이름
  className: string
  path: string
  // 애너테이션이 있는 줄
  line: number
}

export type ListOpModesResult =
  | {
      ok: true
      opModes: OpModeInfo[]
      // 이 목록이 비어 있지 않으면 렌더러가 listRegisteredOpModes로 등록기 OpMode를 읽는다
      registrars: RegistrarInfo[]
      truncated: boolean
      hasTeamCode: boolean
    }
  | { ok: false; code: 'notAllowed'; detail: string }

// 등록기 OpMode 목록(메인이 INIT 준비와 같은 Gradle·라이브러리·플랫폼을 쓰고 JVM에서 등록기를 실행한다, 결과는 캐시).
// diagnostics에 오류가 있으면 컴파일하지 못했다(opModes 빈 목록). errors는 던진 등록기(그 등록기의 OpMode만 빠진다).
// UTILITY·SYSTEM flavor는 넣지 않는다.
export type ListRegisteredResult =
  | {
      ok: true
      opModes: OpModeInfo[]
      // 등록기가 클래스로 다시 등록한 annotated OpMode 클래스(바이너리 이름, 정렬). 실제 SDK는 그 클래스를 등록기가 준
      // 이름·flavor·group으로만 보이므로(AnnotatedOpModeClassFilter의 classNameOverrides·isKnown) 렌더러는 이 클래스를
      // listOpModes의 annotated 목록에서 뺀다. 등록이 애너테이션과 같은 항목(register(Class))이면 넣지 않는다(annotated를 둔다).
      replaced: string[]
      diagnostics: PlayDiagnostic[]
      errors: { registrar: string; message: string }[]
    }
  | {
      ok: false
      code: Exclude<PlayInitFailureCode, 'busy' | 'cancelled'>
      detail: string
    }

// ---- JDK ----

// source: 어디서 찾았나(setting: 환경 설정에서 직접 고름, androidStudio: Android Studio의 jbr, javaHome: JAVA_HOME, path: PATH)
export type JdkInfo = {
  home: string
  // release 파일의 JAVA_VERSION(예: '21.0.4')
  version: string
  major: number
  source: 'setting' | 'androidStudio' | 'javaHome' | 'path'
}

// 사이드카에 필요한 가장 낮은 JDK 주 버전
export const MIN_JDK_MAJOR = 17

// Unity의 External Tools처럼 환경 설정에서 고른다. auto는 찾은 것 중 첫 번째(우선순위: Android Studio jbr → JAVA_HOME → PATH).
export type JdkState = {
  choice: { kind: 'auto' } | { kind: 'custom'; home: string }
  // 실행에 쓸 JDK(없으면 null: 찾지 못함, 또는 고른 폴더가 쓸 수 없게 됨)
  active: JdkInfo | null
  // 이 PC에서 찾은 JDK(17 미만도 보이되 major로 구분)
  detected: JdkInfo[]
  // setJdk가 이번 선택을 받지 않은 이유(설정은 그대로)
  // - notJdk: bin/java·bin/javac·release 파일이 없다(JRE이거나 JDK 폴더가 아님)
  // - tooOld: MIN_JDK_MAJOR 미만
  error?: 'notJdk' | 'tooOld'
}

export type JdkChoice =
  | { kind: 'auto' }
  | { kind: 'detected'; home: string }
  // 메인이 폴더 대화상자를 띄운다(제목은 렌더러가 번역). 취소하면 바뀌지 않는다.
  | { kind: 'browse'; title: string }

// ---- Android SDK ----

// 팀 코드는 Android Studio처럼 팀 프로젝트 compileSdk의 Android API로 컴파일한다(android.jar의 java.*·javax.* 등). 그래서
// 이 PC의 Android SDK(Android Studio가 설치함)가 필요하다. JDK처럼 환경 설정에서 고르고, 설정은 메인의 userData/android-sdk.json.
// source: setting(환경 설정에서 고름), localProperties(프로젝트 local.properties의 sdk.dir), env(ANDROID_HOME·ANDROID_SDK_ROOT),
// default(OS 기본 위치)
export type AndroidSdkInfo = {
  home: string
  // platforms/<이름>/android.jar가 있는 플랫폼 폴더 이름(android-30, 부 버전이 붙은 android-36.1·android-37.0 …,
  // 주 버전 → 부 버전 순). 메인(androidSdk.ts)이 이름을 확인하고 순서를 정한다.
  platforms: string[]
  source: 'setting' | 'localProperties' | 'env' | 'default'
}

export type AndroidSdkState = {
  choice: { kind: 'auto' } | { kind: 'custom'; home: string }
  // 실행에 쓸 SDK(없으면 null)
  active: AndroidSdkInfo | null
  detected: AndroidSdkInfo[]
  // setAndroidSdk가 이번 선택을 받지 않은 이유(platforms 폴더가 없음)
  error?: 'notSdk'
}

export type AndroidSdkChoice =
  | { kind: 'auto' }
  | { kind: 'detected'; home: string }
  // 메인이 폴더 대화상자를 띄운다(제목은 렌더러가 번역). 취소하면 바뀌지 않는다.
  | { kind: 'browse'; title: string }

// ---- 실행 ----

// 실행 속도(가상 시간 ÷ 실제 시간). max는 기다리지 않고 최대한 빨리.
export type PlaySpeed = number | 'max'
export const PLAY_SPEEDS: readonly PlaySpeed[] = [0.25, 0.5, 1, 2, 4, 'max']

// 개인 설정(렌더러 localStorage). jitter·seed는 Hub 타이밍 오차(sidecarProtocol.RunRequest).
export type PlaySettings = {
  speed: PlaySpeed
  jitter: number
  seed: number
  // Autonomous는 DS처럼 START 뒤 30초에 자동으로 멈춘다
  autoStopAutonomous: boolean
  // 시뮬레이터의 배터리 전압(V). 모터 무부하 속도(전압 ÷ 12)와 허브 voltage 입력. 사이드카 기본값과 같은 12.5가 기본.
  batteryVoltage: number
}

// 배터리 전압 설정 범위(V)와 기본값(sidecar SimHub.DEFAULT_BATTERY_VOLTS와 같음)
export const DEFAULT_BATTERY_VOLTAGE = 12.5
export const MIN_BATTERY_VOLTAGE = 9
export const MAX_BATTERY_VOLTAGE = 14.5

export const AUTONOMOUS_SECONDS = 30

export type PlayInitRequest = {
  // 렌더러가 정하는 실행 id. 이벤트를 이 실행의 것인지 가리는 데 쓴다.
  runId: string
  root: string
  // registeredName이 있으면 등록기 OpMode: className·path는 그것을 등록한 등록기 클래스와 소스다.
  opMode: { className: string; path: string; flavor: OpModeFlavor; registeredName?: string }
  // 로봇 구성 XML의 TeamCode 기준 경로(src/main/res/xml/sandbot_*.xml, generatedFiles.ts 규칙). 없으면 null.
  configPath: string | null
  settings: PlaySettings
  // 운동학 시뮬레이터의 세계(src/shared/sim/worldSpec.ts). 로봇이 없으면 null(센서는 사이드카 기본값).
  world: WorldSpec | null
}

// - notAllowed: 열린 프로젝트가 아니거나 허용하지 않는 경로
// - missing: OpMode 소스나 TeamCode가 없다
// - noJdk: 쓸 수 있는 JDK가 없다(환경 설정에서 고르게 안내)
// - noSidecar: 사이드카가 빌드되지 않았다(개발 중: pnpm build:sidecar)
// - busy: 다른 실행이 아직 끝나지 않았다
// - failed: JVM을 띄우지 못했다(detail에 이유)
// - noAndroidSdk: Android SDK를 찾지 못했다(환경 설정에서 고르게 안내)
// - noAndroidPlatform: SDK에 프로젝트 compileSdk의 플랫폼이 없다(detail: 설치할 패키지 이름 'android-30'·'android-37.0'·
//   'android-36.1' 등, Android Studio에서 설치)
// - cancelled: 라이브러리를 받는 중 사용자가 STOP으로 취소했다
// ok의 configMissing: 요청한 구성 XML이 디스크에 없어 장치 없는 hardwareMap으로 실행한다(렌더러가 Console에 경고)
export type PlayInitFailureCode =
  | 'notAllowed'
  | 'missing'
  | 'noJdk'
  | 'noSidecar'
  | 'busy'
  | 'failed'
  | 'noAndroidSdk'
  | 'noAndroidPlatform'
  | 'cancelled'

export type PlayInitResult =
  { ok: true; configMissing?: true } | { ok: false; code: PlayInitFailureCode; detail: string }

export type PlayCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'pause'; paused: boolean }
  // 일시 정지 중에 루프 하나가 지날 때까지 진행하고 다시 멈춘다(Unity의 Step)
  | { type: 'step' }
  | { type: 'speed'; speed: PlaySpeed }
  // Dashboard 설정 하나 바꾸기(Config 탭, 실행 중). 다음 틱 경계에서 적용한다(sidecarProtocol TickReply.configSet).
  | { type: 'config'; path: string[]; value: string }

// 실행 단계: preparing(JDK 확인·JVM 시작), compiling, init, running, stopping, finished
export type PlayPhase = 'preparing' | 'compiling' | 'init' | 'running' | 'stopping' | 'finished'

// 컴파일 진단. path는 TeamCode 기준 경로(TeamCode 밖 파일이면 null, 외부 편집기로 열 수 없음).
export type PlayDiagnostic = {
  kind: 'error' | 'warning' | 'note'
  path: string | null
  // 보일 파일 이름(TeamCode 기준 경로 또는 파일 이름)
  file: string
  line: number
  column: number
  message: string
  code: string
  // 라이브러리 패키지를 찾지 못한 오류(compiler.err.doesnt.exist 등)에 붙이는 안내. 없으면 null.
  hint: DiagnosticHint | null
}

// - libraryNotLoaded: 팀 Gradle에 선언했지만 불러오지 않은 라이브러리의 패키지(coordinate·reason은 의존성 보고와 같다)
// - dependencyNotLoaded: 팀이 선언한 라이브러리(requestedBy, 'g:a:v')가 끌어온 의존성 중 불러오지 않은 것의 패키지
// - undeclared: 어느 선언에도 속하지 않는 패키지(Android Studio에서도 컴파일되지 않는다)
// - maybeUndeclared: 읽은 선언에는 없지만, SandBot이 읽지 못한 Gradle 내용이나 담은 패키지를 모르는 불러오지 않은
//   라이브러리에 있을 수 있다(단정하지 않음)
export type DiagnosticHint =
  | { kind: 'libraryNotLoaded'; coordinate: string; reason: LibraryReason }
  | { kind: 'dependencyNotLoaded'; coordinate: string; reason: LibraryReason; requestedBy: string }
  | { kind: 'undeclared'; packageName: string }
  | { kind: 'maybeUndeclared'; packageName: string }

// 라이브러리 링크 검사 경고 하나(sidecarProtocol.LinkWarning을 좌표로 바꾼 것)
export type PlayLinkWarning = {
  // 'g:a:v'(jar를 좌표로 바꿀 수 없으면 파일 이름)
  library: string
  kind: 'missingClass' | 'missingMember' | 'unsupported'
  from: string
  target: string
}

// 스택 한 줄. path는 TeamCode 기준 소스 경로(팀 코드일 때만, 외부 편집기로 그 줄을 연다).
export type PlayStackFrame = {
  className: string
  method: string
  file: string | null
  line: number
  path: string | null
}

export type PlayEvent =
  | { type: 'phase'; runId: string; phase: PlayPhase }
  // 진행 상태(약 10 Hz, 그리고 바뀔 때). realtime은 최근 실제 속도(가상 ÷ 실제, 따라가지 못하면 speed보다 작다).
  | {
      type: 'status'
      runId: string
      tNanos: number
      paused: boolean
      speed: PlaySpeed
      realtime: number
      // START 뒤 흐른 가상 시간(아직이면 null). Autonomous 30초 표시에 쓴다.
      startedNanos: number | null
    }
  | { type: 'compiled'; runId: string; ok: boolean; millis: number; diagnostics: PlayDiagnostic[] }
  | { type: 'telemetry'; runId: string; tNanos: number; frame: TelemetryFrame }
  // Dashboard 패킷 묶음(약 30 Hz). 메인이 묶음 사이도 같은 규칙으로 합친다: cleared는 OR, data는 cleared 뒤부터 키마다
  // 마지막 값(키 정렬), log·ops는 마지막 null 아닌 것(sidecarProtocol DashMessage). cleared 묶음의 log는 null이 아니다
  // (실제 웹 화면처럼 clearTelemetry가 로그도 지우므로 뒤에 로그가 없으면 []). 그래서 cleared면 data를 비우고, null 아닌
  // log로 바꾸면 실제 화면과 같다(그림은 cleared에 지우지 않는다).
  | {
      type: 'dash'
      runId: string
      tNanos: number
      cleared: boolean
      data: [string, string][]
      log: string[] | null
      ops: DashOp[] | null
    }
  // Dashboard 설정 트리(마지막 것)
  | { type: 'dashConfig'; runId: string; tNanos: number; root: DashConfigNode }
  // 여러 줄을 묶어 보낸다
  | {
      type: 'log'
      runId: string
      entries: { tNanos: number; stream: 'out' | 'err' | 'robotLog'; text: string }[]
    }
  | {
      type: 'error'
      runId: string
      tNanos: number
      kind: SimErrorKind
      message: string
      exception: string | null
      stack: PlayStackFrame[]
      thread: string
    }
  // 장치 출력과 시뮬레이터가 보낸 센서 값(누적, 허브 원시 값)(약 20 Hz, 마지막 값)
  | {
      type: 'devices'
      runId: string
      tNanos: number
      outputs: Record<string, DeviceValues>
      inputs: Record<string, DeviceValues>
    }
  // INIT 중 라이브러리 받기 진행(약 10 Hz). 받을 것이 없으면 오지 않는다.
  | ({ type: 'libraryProgress'; runId: string } & LibraryProgress)
  // 라이브러리 의존성 보고(INIT마다 JVM을 띄우기 전에 한 번, Gradle 파일이 없어도 빈 보고)
  | { type: 'libraryReport'; runId: string; report: LibraryReport }
  // 라이브러리 링크 검사(라이브러리가 있을 때 컴파일 전에 한 번)
  | { type: 'linkWarnings'; runId: string; warnings: PlayLinkWarning[] }
  // 시뮬레이터의 로봇 자세(필드 좌표, 약 60 Hz와 일시 정지·Step·끝에 바로). 렌더러는 씬 문서를 바꾸지 않고 그린다.
  | ({ type: 'pose'; runId: string; tNanos: number } & SimPose)
  // 시뮬레이터 안내(Console 경고 한 줄, 같은 code·params는 실행마다 한 번). code는 렌더러가 번역한다.
  | {
      type: 'simNotice'
      runId: string
      tNanos: number
      code: SimNoticeCode
      params: Record<string, string>
    }
  // 끝. killed: 호스트가 JVM을 끝냄(STOP 뒤 시간 초과, 멈춘 스레드), crashed: 사이드카가 finished 없이 끝남
  // (detail에 stderr 끝부분 등). preselectTeleOp: Autonomous가 끝나면 DS처럼 그 TeleOp을 고른다('' 없음).
  | {
      type: 'finished'
      runId: string
      tNanos: number
      reason: FinishReason | 'killed' | 'crashed'
      detail: string
      preselectTeleOp: string
    }

// - sharedEncoderMode: 데드휠과 포트를 함께 쓰는 모터를 엔코더 모드로 돌린다(실제로는 포드 엔코더로 제어되지만
//   시뮬레이터는 축 엔코더로 제어한다고 가정), params.device
// - worldError: 시뮬레이터 계산 중 오류(이전 센서 값을 계속 보낸다), params.detail
// - 사이드카 안내(sidecarProtocol SidecarNoticeCode): dashCamera, dashImage, rrTuningSaved(params.path)
export type SimNoticeCode = 'sharedEncoderMode' | 'worldError' | SidecarNoticeCode

export type { GamepadState }
