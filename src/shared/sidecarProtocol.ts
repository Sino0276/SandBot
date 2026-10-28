// JVM 사이드카(sidecar/) ↔ 호스트(메인 프로세스 src/main/sidecar/) stdio 프로토콜.
// - 한 줄에 JSON 객체 하나(UTF-8, '\n'). 사이드카의 stdout은 이 프로토콜 전용이다. 팀 코드의 System.out·System.err는
//   사이드카가 가로채 log 메시지로 보낸다. stderr는 JVM 자체 출력(시작 안내, 치명적 오류)이라 진단용으로만 모은다.
// - 시간은 가상 시계(SimClock의 VirtualClock)다. 팀 코드가 보는 System.nanoTime·Thread.sleep 등은 사이드카가 정하고,
//   하드웨어 호출마다 Hub 타이밍 표의 비용만큼 흐른다. 가상 시간이 틱 경계(tickNanos의 배수)를 넘을 때마다 사이드카는
//   tick을 보내고 tickReply를 받을 때까지 OpMode 스레드를 멈춘다. 호스트는 답하는 때를 벽시계 × 속도에 맞춰
//   실행 속도·일시 정지·한 단계를 정한다(사이드카는 벽시계를 모른다).
// - 실시간 실행(진짜 시계 + 하드웨어 호출에서 실제로 기다림)은 구현하지 않고 길만 열어 둔다: RunRequest.clock에
//   다른 값을 더하고 사이드카에 SimClock 구현을 하나 더 두면 된다. 지금 사이드카는 'virtual'이 아니면 거부한다.

export const SIDECAR_PROTOCOL_VERSION = 2

// 틱 길이(가상 나노초). 틱 경계마다 장치 출력을 내보내고 입력(게임패드·센서)과 DS 사건(START·STOP)을 받는다.
// 실제 Robot Controller의 이벤트 루프 한 바퀴에 해당한다(LinearOpMode.waitForStart가 깨어나는 때, 게임패드가 바뀌는 때).
export const DEFAULT_TICK_NANOS = 5_000_000

// 실시간 감시: OpMode 스레드가 이만큼(실제 밀리초) 가상 시계를 부르지 않고 돌면 stall 오류를 보낸다(무한 루프 등)
export const DEFAULT_STALL_MILLIS = 2000

export type SimClockKind = 'virtual'

// Hub 타이밍 표(밀리초). 하드웨어 호출 하나가 가상 시간을 얼마나 쓰는지. 기본값은 사이드카(org.sandbot.sim.HubTiming)에
// 있고, 여기 값은 덮어쓸 것만 담는다(측정으로 보정한 값). 키 이름은 HubTiming과 같아야 한다.
export const HUB_TIMING_KEYS = [
  // Lynx 명령 하나(모터 출력·모드·목표 위치 쓰기, 캐시 없이 엔코더 읽기 등)
  'lynxCommandControl',
  'lynxCommandExpansion',
  // bulk read 하나(LynxModule BulkCachingMode AUTO·MANUAL)
  'bulkReadControl',
  'bulkReadExpansion',
  // I2C 트랜잭션 하나(IMU·거리·색 센서, Pinpoint, OTOS 등)
  'i2cControl',
  'i2cExpansion',
  // 시계 읽기(System.nanoTime 등). 0이면 바쁜 대기 루프에서 시간이 흐르지 않으므로 아주 작은 값을 둔다.
  'clockRead',
  // 루프 표시(opModeIsActive·opModeInInit·idle) 한 번
  'loopMarker',
  // telemetry.update가 실제로 보낼 때
  'telemetryUpdate'
] as const
export type HubTimingKey = (typeof HUB_TIMING_KEYS)[number]
export type HubTimingOverrides = Partial<Record<HubTimingKey, number>>

// ---- 호스트 → 사이드카 ----

export type RunRequest = {
  type: 'run'
  protocol: typeof SIDECAR_PROTOCOL_VERSION
  clock: SimClockKind
  tickNanos: number
  // 컴파일(사이드카 안에서 javax.tools로, 결과는 메모리에만 둔다). 경로는 모두 절대 경로.
  // sourceRoots: TeamCode/src/main/java와, 있으면 FtcRobotController/src/main/java(-sourcepath 순서대로)
  sourceRoots: string[]
  // 고른 OpMode의 소스 파일. 이 파일에서 시작해 -sourcepath로 필요한 것만 컴파일한다.
  opModeSource: string
  // 바이너리 이름(중첩 클래스는 Outer$Inner)
  opModeClass: string
  // javac -bootclasspath: 팀 프로젝트 compileSdk의 Android 플랫폼 API(android.jar에서 java.*·javax.*·org.w3c.*·
  // org.xml.*·android.annotation.*만 고른 jar, 메인의 androidSdk.ts). 팀 코드는 Android Studio처럼 Java 8 문법(-source 8
  // -target 8)과 Android API로 컴파일한다. 비어 있으면 javac --release 8(호스트 JDK의 Java 8 API)이고, 이것은 사이드카
  // 시험만 쓴다(메인은 늘 플랫폼 jar를 보낸다).
  bootClasspath: string[]
  // javac -classpath: sandbot-sdk.jar(가짜 FTC SDK) 다음에 컴파일용 라이브러리 jar(팀 Gradle의 컴파일 클래스패스,
  // androidx.annotation, SandBot이 대체하는 라이브러리는 실제 jar). 순서대로 찾는다.
  compileClasspath: string[]
  // 실행 때 LibraryClassLoader가 읽는 라이브러리 jar(팀 Gradle의 실행 클래스패스, 시간 API를 패치해 정의한다).
  // 가짜 SDK(sandbot-sdk.jar)는 JVM -cp에 있어 먼저 찾는다. 메인의 라이브러리 캐시 안 경로만.
  libraryClasspath: string[]
  // 로봇 구성: 생성한 구성 XML(TeamCode/src/main/res/xml/sandbot_*.xml). DS에서 활성화하는 구성과 같다.
  // null이면 장치 없는 hardwareMap이다.
  configXml: string | null
  timing: HubTimingOverrides
  // 하드웨어 비용 오차(0이면 끔. 0.1이면 각 비용을 ±10% 안에서 고르게 뽑는다). seed가 같으면 같은 순서로 뽑는다.
  jitter: number
  seed: number
  // 팀 코드의 System.currentTimeMillis() 시작값(가상 시간 0의 벽시계 시각)
  startEpochMillis: number
  stallMillis: number
}

// 이 틱 경계에서 적용할 Driver Station 사건. INIT은 run 자체다(run을 받으면 init 단계로 시작한다).
export type DsEvent = 'start' | 'stop'

// FTC Gamepad 필드 이름 그대로(com.qualcomm.robotcore.hardware.Gamepad). 스틱 y는 위로 밀면 음수다(SDK와 같음).
// PS 이름(cross·circle·square·triangle·share·options·ps)은 SDK가 같은 값을 보이므로 따로 보내지 않는다.
export type GamepadState = {
  left_stick_x: number
  left_stick_y: number
  right_stick_x: number
  right_stick_y: number
  left_trigger: number
  right_trigger: number
  dpad_up: boolean
  dpad_down: boolean
  dpad_left: boolean
  dpad_right: boolean
  a: boolean
  b: boolean
  x: boolean
  y: boolean
  guide: boolean
  start: boolean
  back: boolean
  left_bumper: boolean
  right_bumper: boolean
  left_stick_button: boolean
  right_stick_button: boolean
  touchpad: boolean
}

// 장치 하나의 값. 키는 장치 종류마다 정한다(sidecar의 org.sandbot.sdk.devices 문서). 숫자는 SDK 단위 그대로다
// (모터 power −1..1, 엔코더 tick, 서보 position 0..1 등). null은 값이 없음(예: 한 번도 쓰지 않은 서보).
export type DeviceValues = Record<string, number | boolean | string | null>

export type TickReply = {
  type: 'tickReply'
  tick: number
  events: DsEvent[]
  // 연결되지 않은 게임패드는 null(모든 값 0)
  gamepads: [GamepadState | null, GamepadState | null]
  // 장치 이름 → 센서 값. 1단계(시뮬레이터 없음)는 비어 있고 장치는 기본값(0 등)을 쓴다. 보낸 키만 바꾼다.
  inputs: Record<string, DeviceValues>
}

// 정리하고 끝내라(정지 시간 초과, 창 닫기). 사이드카는 바로 finished(shutdown)를 보내고 끝낸다.
export type ShutdownRequest = { type: 'shutdown' }

export type HostMessage = RunRequest | TickReply | ShutdownRequest

// ---- 사이드카 → 호스트 ----

export type CompileDiagnostic = {
  kind: 'error' | 'warning' | 'note'
  // 절대 경로(소스 파일이 없는 진단은 null)
  file: string | null
  // 1부터. 모르면 0.
  line: number
  column: number
  // javac 영어 메시지(Locale.ENGLISH)
  message: string
  // javac 진단 코드(compiler.err.cant.resolve.location 등)
  code: string
}

// 사이드카가 보는 OpMode 단계: init(INIT 뒤 START 전), running(START 뒤), stopping(STOP·종료 요청 뒤 끝날 때까지)
export type OpModePhase = 'init' | 'running' | 'stopping'

export type StackFrame = {
  className: string
  method: string
  // SourceFile 속성(예: 'Lift.java'). 모르면 null.
  file: string | null
  // 모르면 0 이하
  line: number
  // 팀 코드(이번에 컴파일한 소스)면 그 소스의 절대 경로
  source: string | null
}

// - exception: 팀 코드가 던진 예외(OpMode는 끝난다)
// - unsupported: 사이드카가 아직 지원하지 않는 SDK API를 불렀다(가짜 SDK 껍데기가 던짐)
// - thread: OpMode 스레드가 아닌 스레드가 가상 시계·하드웨어를 썼다(1단계는 한 스레드만)
// - stall: OpMode 스레드가 stallMillis 동안 가상 시계를 부르지 않았다(무한 루프 등, 한 번만 보낸다)
// - stuckInStop: STOP 뒤 SDK의 정지 대기 시간(가상) 안에 끝나지 않았다
// - load: OpMode 클래스를 찾거나 만들지 못했다(OpMode가 아님, public 인수 없는 생성자 없음 등)
// - config: 로봇 구성 XML을 읽지 못했거나 지원하지 않는 장치가 있다
// - internal: 사이드카 자체 오류
export type SimErrorKind =
  'exception' | 'unsupported' | 'thread' | 'stall' | 'stuckInStop' | 'load' | 'config' | 'internal'

// - stopped: STOP 뒤 정상적으로 끝남
// - returned: STOP 전에 OpMode가 스스로 끝남(runOpMode가 돌아옴, requestOpModeStop)
// - terminated: terminateOpModeNow 또는 System.exit
// - exception: 오류로 끝남(error 메시지가 먼저 온다)
// - compileFailed: 컴파일 오류(compiled.ok가 false)
// - loadFailed: OpMode·구성을 읽지 못함(error 메시지가 먼저 온다)
// - stuck: STOP 뒤 끝나지 않아 사이드카가 포기함
// - shutdown: 호스트가 shutdown을 보냄
export type FinishReason =
  | 'stopped'
  | 'returned'
  | 'terminated'
  | 'exception'
  | 'compileFailed'
  | 'loadFailed'
  | 'stuck'
  | 'shutdown'

// Driver Station이 보이는 텔레메트리 한 번(telemetry.update가 실제로 보낸 것). lines는 DS 화면의 줄 그대로
// (캡션·구분자·값을 합친 글자), log는 telemetry.log()의 줄(표시 순서대로).
export type TelemetryFrame = {
  lines: string[]
  log: string[]
  // Telemetry.DisplayFormat: CLASSIC·MONOSPACE·HTML
  format: 'classic' | 'monospace' | 'html'
}

export type HelloMessage = {
  type: 'hello'
  protocol: number
  // 사이드카 소스 해시(빌드 때 정함)
  runtime: string
  // 실행 중인 JVM 버전(System.getProperty('java.version'))
  java: string
}

export type CompiledMessage = {
  type: 'compiled'
  ok: boolean
  diagnostics: CompileDiagnostic[]
  millis: number
}

export type StateMessage = { type: 'state'; tNanos: number; phase: OpModePhase }

export type TickMessage = {
  type: 'tick'
  tick: number
  // 이 틱 경계의 가상 시간(tick × tickNanos)
  tNanos: number
  phase: OpModePhase
  // 지금까지의 루프 표시 수(LinearOpMode.opModeIsActive·opModeInInit·idle, 반복 OpMode의 init_loop·loop).
  // 호스트의 한 단계(Step)가 "루프 하나가 지날 때까지"를 정하는 데 쓴다.
  loops: number
  // 모든 장치의 지금 출력(장치 이름 → 값)
  outputs: Record<string, DeviceValues>
}

export type TelemetryMessage = { type: 'telemetry'; tNanos: number; frame: TelemetryFrame }

// stream: out(System.out), err(System.err), robotLog(RobotLog·android.util.Log)
export type LogMessage = {
  type: 'log'
  tNanos: number
  stream: 'out' | 'err' | 'robotLog'
  text: string
}

export type ErrorMessage = {
  type: 'error'
  tNanos: number
  kind: SimErrorKind
  // 사람이 읽는 영어 문장(예외 메시지 포함). 렌더러는 kind로 번역한 머리말과 함께 보인다.
  message: string
  // 예외 클래스 이름(예외가 있을 때)
  exception: string | null
  stack: StackFrame[]
  thread: string
}

export type FinishedMessage = { type: 'finished'; tNanos: number; reason: FinishReason }

// 라이브러리 jar의 링크 검사(libraryClasspath가 있으면 hello 뒤·compiled 전에 한 번). 라이브러리 바이트코드가 참조하는
// 클래스·멤버를 가짜 SDK와 JDK에 대어 본 결과다. 실행을 막지 않는다(그 코드에 닿으면 실행 중 오류가 난다).
// - missingClass: 참조한 클래스가 없다(NoClassDefFoundError가 난다)
// - missingMember: 클래스는 있지만 그 필드·메서드가 없다(NoSuchFieldError·NoSuchMethodError)
// - unsupported: 있지만 가짜 SDK가 아직 지원하지 않는다(부르면 SimUnsupportedException, error kind unsupported)
export type LinkWarningKind = 'missingClass' | 'missingMember' | 'unsupported'
export type LinkWarning = {
  // libraryClasspath의 jar 절대 경로
  jar: string
  kind: LinkWarningKind
  // 참조한 쪽(라이브러리 클래스, 바이너리 이름)
  from: string
  // 참조한 대상(클래스는 바이너리 이름, 멤버는 '클래스#이름(서술자)')
  target: string
}
export type LinkReportMessage = { type: 'linkReport'; warnings: LinkWarning[] }

export type SidecarMessage =
  | HelloMessage
  | CompiledMessage
  | StateMessage
  | TickMessage
  | TelemetryMessage
  | LogMessage
  | ErrorMessage
  | FinishedMessage
  | LinkReportMessage
