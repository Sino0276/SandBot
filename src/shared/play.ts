// 렌더러 ↔ 메인 프로세스의 실행(Play) API 타입. 메인이 JDK를 찾고 사이드카(JVM)를 띄워 팀의 OpMode를
// 가상 시계로 실행한다(프로토콜은 sidecarProtocol.ts). 렌더러는 Driver Station처럼 OpMode를 고르고 INIT → START → STOP을
// 보내며, Unity처럼 일시 정지·한 단계·속도를 바꾼다.
import type {
  DeviceValues,
  FinishReason,
  GamepadState,
  SimErrorKind,
  TelemetryFrame
} from './sidecarProtocol'

// ---- OpMode 목록 ----

export type OpModeFlavor = 'TeleOp' | 'Autonomous'

// TeamCode의 @TeleOp·@Autonomous 클래스 하나(@Disabled·abstract 제외). 소스를 읽어 정한다(컴파일하지 않음).
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
}

export type ListOpModesResult =
  | { ok: true; opModes: OpModeInfo[]; truncated: boolean; hasTeamCode: boolean }
  | { ok: false; code: 'notAllowed'; detail: string }

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
}

export const AUTONOMOUS_SECONDS = 30

export type PlayInitRequest = {
  // 렌더러가 정하는 실행 id. 이벤트를 이 실행의 것인지 가리는 데 쓴다.
  runId: string
  root: string
  opMode: { className: string; path: string; flavor: OpModeFlavor }
  // 로봇 구성 XML의 TeamCode 기준 경로(src/main/res/xml/sandbot_*.xml, generatedFiles.ts 규칙). 없으면 null.
  configPath: string | null
  settings: PlaySettings
}

// - notAllowed: 열린 프로젝트가 아니거나 허용하지 않는 경로
// - missing: OpMode 소스나 TeamCode가 없다
// - noJdk: 쓸 수 있는 JDK가 없다(환경 설정에서 고르게 안내)
// - noSidecar: 사이드카가 빌드되지 않았다(개발 중: pnpm build:sidecar)
// - busy: 다른 실행이 아직 끝나지 않았다
// - failed: JVM을 띄우지 못했다(detail에 이유)
export type PlayInitResult =
  | { ok: true }
  | {
      ok: false
      code: 'notAllowed' | 'missing' | 'noJdk' | 'noSidecar' | 'busy' | 'failed'
      detail: string
    }

export type PlayCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'pause'; paused: boolean }
  // 일시 정지 중에 루프 하나가 지날 때까지 진행하고 다시 멈춘다(Unity의 Step)
  | { type: 'step' }
  | { type: 'speed'; speed: PlaySpeed }

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
  // 장치 출력(약 20 Hz, 마지막 값)
  | { type: 'devices'; runId: string; tNanos: number; outputs: Record<string, DeviceValues> }
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

export type { GamepadState }
