import {
  AUTONOMOUS_SECONDS,
  type GamepadState,
  type OpModeFlavor,
  type PlayCommand,
  type PlayDiagnostic,
  type PlayEvent,
  type PlayPhase,
  type PlaySpeed,
  type PlayStackFrame
} from '../../shared/play'
import {
  SIDECAR_PROTOCOL_VERSION,
  type DeviceValues,
  type DsEvent,
  type FinishReason,
  type LogMessage,
  type RunRequest,
  type SidecarMessage,
  type TelemetryMessage,
  type TickMessage
} from '../../shared/sidecarProtocol'
import type { ProcessExit, SidecarProcess } from './process'
import { LineSplitter, parseSidecarLine, ProtocolError } from './protocol'
import { EMPTY_WORLD, type SimWorld } from './world'

// 사이드카 실행 하나(호스트 쪽). 사이드카는 가상 시계로 돌고, 가상 시간이 틱 경계를 넘을 때마다 tick을 보내고
// tickReply를 받을 때까지 멈춘다. 호스트는 답하는 때로 실행 속도·일시 정지·한 단계(Step)를 정한다(Unity의 Time.timeScale·
// Pause·Step). 사이드카는 벽시계를 모른다.
//
// 상태:
//   preparing ─hello─▶ compiling ─state init─▶ init ─state running─▶ running ─state stopping─▶ stopping ─finished─▶ finished
//   (사이드카가 보내는 state가 단계를 정한다. 어느 단계에서든 finished·프로세스 종료로 finished가 된다.)
// 페이스: 틱 k(가상 tNanos)는 벽시계로 wallAnchor + (tNanos − virtualAnchor)/speed 에 답한다(늦었으면 바로).
//   기준점은 첫 틱, 속도를 바꿀 때, 일시 정지를 풀 때 다시 잡는다(그동안 흐른 실제 시간을 따라잡지 않는다). 사이드카가
//   MAX_LAG_MS보다 늦으면 그 틱에서 기준점을 다시 잡는다(긴 GC·느린 init 뒤에 빨리 감기처럼 몰아서 돌지 않게, Unity의
//   Maximum Allowed Timestep과 같은 생각). 'max'는 바로 답한다.
// 일시 정지: 받은 틱에 답하지 않고 둔다(사이드카는 그 틱 경계에서 멈춰 있다).
// Step: 일시 정지 중에만. 둔 틱에 답하고, 그 뒤 틱은 바로 답하다가 loops(루프 표시 수)가 시작 때보다 커진 틱(또는
//   가상 1초가 지난 틱)을 다시 둔다. 틱(5 ms)보다 짧은 루프는 한 틱 안에 여러 번 돌 수 있다(Step의 단위는 틱 경계다).
// START·STOP: 다음 tickReply의 events에 싣는다. 일시 정지 중이면 일시 정지를 푼다(DS 버튼은 바로 동작해야 한다).
//   Autonomous는 START 뒤 가상 30초가 된 틱의 답에 STOP을 싣는다(설정). STOP 뒤 kill 시간(실제, 일시 정지로 둔 동안은
//   세지 않는다) 안에 끝나지 않거나, stall(무한 루프)을 받은 뒤 STOP이면 JVM을 끝낸다(killed). 틱을 주고받기 전
//   (preparing·compiling)의 STOP은 shutdown을 보낸다.
// 렌더러 이벤트: phase·status(10 Hz와 바뀔 때)·compiled·telemetry(최신만, 30 Hz 이하)·log(50 ms 묶음)·error·devices(20 Hz,
//   바뀔 때)·finished. 순서가 중요한 이벤트(phase·compiled·error·finished) 전에는 모아 둔 로그를 먼저 보낸다.

export type HostClock = {
  // 단조 증가하는 밀리초
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export const systemClock: HostClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
}

export type SessionTimeouts = {
  // STOP 뒤 이만큼(실제 밀리초) 안에 finished가 없으면 JVM을 끝낸다
  stopKillMs: number
  // shutdown(창 닫기·앱 종료·다른 실행) 뒤 기다리는 시간
  shutdownGraceMs: number
  // finished 뒤 프로세스가 스스로 끝나기를 기다리는 시간(사이드카는 Runtime.halt로 바로 끝난다)
  exitAfterFinishedMs: number
  // JVM이 hello를 보내기까지
  helloMs: number
}

export const DEFAULT_TIMEOUTS: SessionTimeouts = {
  stopKillMs: 5000,
  shutdownGraceMs: 1000,
  exitAfterFinishedMs: 2000,
  helloMs: 30_000
}

// killed의 detail(렌더러가 번역한다)
// - stopTimeout: STOP 뒤 시간 안에 끝나지 않음, stalled: 멈춘(무한 루프) 스레드에 STOP, shutdownTimeout: shutdown에 답하지 않음
export type KillReason = 'stopTimeout' | 'stalled' | 'shutdownTimeout'

// 절대 경로 → TeamCode 기준 경로(외부 편집기로 열 수 있는 팀 코드만, 아니면 null)와 보일 이름
export type SourceMapper = (absolute: string) => { path: string | null; file: string }

export type SessionOptions = {
  runId: string
  flavor: OpModeFlavor
  speed: PlaySpeed
  autoStopAutonomous: boolean
  // 이 OpMode의 @Autonomous(preselectTeleOp). TeleOp이면 ''.
  preselectTeleOp: string
  mapSource: SourceMapper
  emit: (event: PlayEvent) => void
  clock?: HostClock
  world?: SimWorld
  timeouts?: Partial<SessionTimeouts>
}

const STATUS_INTERVAL_MS = 100
const TELEMETRY_INTERVAL_MS = 34
const DEVICES_INTERVAL_MS = 50
const LOG_FLUSH_MS = 50
const LOG_BATCH_MAX = 500
const MAX_LOG_TEXT = 64 * 1024
// 이보다 늦으면 따라잡지 않고 기준점을 다시 잡는다
export const MAX_LAG_MS = 100
const REALTIME_WINDOW_MS = 1000
const REALTIME_MIN_SPAN_MS = 200
const SAMPLE_GAP_MS = 20
export const STEP_MAX_NANOS = 1_000_000_000
const STDERR_TAIL_LINES = 30
const DETAIL_LIMIT = 2000
// JVM이 환경 변수를 읽었다는 안내(JAVA_TOOL_OPTIONS 등). 오류가 아니므로 crashed detail에 넣지 않는다.
const JVM_NOTICE = /^(?:NOTE: )?Picked up (?:JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS):/

export function isValidSpeed(speed: unknown): speed is PlaySpeed {
  return speed === 'max' || (typeof speed === 'number' && Number.isFinite(speed) && speed > 0)
}

// 일정 간격보다 자주 보내지 않는다. 사이에 온 요청은 간격이 지난 때 한 번(최신 값으로) 보낸다.
class Throttle {
  private last = -Infinity
  private timer: unknown = null

  constructor(
    private readonly clock: HostClock,
    private readonly interval: number,
    private readonly fire: () => void
  ) {}

  request(): void {
    if (this.timer !== null) return
    const now = this.clock.now()
    const wait = this.last + this.interval - now
    if (wait <= 0) {
      this.last = now
      this.fire()
      return
    }
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      this.last = this.clock.now()
      this.fire()
    }, wait)
  }

  // 기다리는 것이 있으면 지금 보낸다
  flush(): void {
    if (this.timer === null) return
    this.clock.clearTimeout(this.timer)
    this.timer = null
    this.last = this.clock.now()
    this.fire()
  }
}

type Anchor = { wall: number; virt: number }

export class SidecarSession {
  readonly runId: string
  // 프로세스가 끝나면(그리고 finished를 보낸 뒤) 풀린다
  readonly done: Promise<void>

  private readonly clock: HostClock
  private readonly world: SimWorld
  private readonly timeouts: SessionTimeouts
  private readonly splitter = new LineSplitter()

  private phase: PlayPhase = 'preparing'
  private helloSeen = false
  private paused = false
  private speed: PlaySpeed
  private pending: TickMessage | null = null
  private replyTimer: unknown = null
  private anchor: Anchor | null = null
  private lastRepliedNanos: number | null = null
  private latestNanos = 0
  private lastLoops = 0
  private queued: DsEvent[] = []
  private startQueued = false
  private startNanos: number | null = null
  private stopRequested = false
  private stalled = false
  private step: { baseLoops: number; deadline: number } | null = null
  private gamepads: [GamepadState | null, GamepadState | null] = [null, null]
  private samples: Anchor[] = []

  // STOP 뒤 kill까지 남은 시간(STOP 전에는 null)
  private killRemaining: number | null = null
  private killTimer: unknown = null
  private killStartedAt = 0
  private killReason: KillReason | null = null
  private protocolError: string | null = null
  private shutdownSent = false
  private disposeTimer: unknown = null
  private helloTimer: unknown = null
  private exitTimer: unknown = null
  private statusTimer: unknown = null
  private lastStatusKey = ''

  private finishedEmitted = false
  private exitedFlag = false
  private resolveDone: () => void = () => {}

  private stderrLines: string[] = []
  private stderrPending = ''
  private logs: { tNanos: number; stream: LogMessage['stream']; text: string }[] = []
  private logTimer: unknown = null
  private telemetry: TelemetryMessage | null = null
  private readonly telemetryThrottle: Throttle
  private outputs: { tNanos: number; outputs: Record<string, DeviceValues> } | null = null
  private lastDevicesKey = ''
  private readonly devicesThrottle: Throttle

  constructor(
    private readonly process: SidecarProcess,
    request: RunRequest,
    private readonly options: SessionOptions
  ) {
    this.runId = options.runId
    this.clock = options.clock ?? systemClock
    this.world = options.world ?? EMPTY_WORLD
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts }
    this.speed = isValidSpeed(options.speed) ? options.speed : 1
    this.telemetryThrottle = new Throttle(this.clock, TELEMETRY_INTERVAL_MS, () =>
      this.sendTelemetry()
    )
    this.devicesThrottle = new Throttle(this.clock, DEVICES_INTERVAL_MS, () => this.sendDevices())
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve
    })

    process.onStdout((chunk) => this.onStdout(chunk))
    process.onStderr((chunk) => this.onStderr(chunk))
    process.onExit((exit) => this.onExit(exit))

    this.emit({ type: 'phase', runId: this.runId, phase: 'preparing' })
    this.emitStatus(true)
    this.statusTimer = this.clock.setTimeout(() => this.statusTick(), STATUS_INTERVAL_MS)
    this.helloTimer = this.clock.setTimeout(() => {
      this.helloTimer = null
      this.protocolFail('no hello from the sidecar')
    }, this.timeouts.helloMs)
    // 사이드카는 hello를 보낸 뒤 stdin에서 run을 읽는다(먼저 보내도 쌓여 있다)
    process.send(request)
  }

  get finished(): boolean {
    return this.finishedEmitted
  }

  get exited(): boolean {
    return this.exitedFlag
  }

  // ---- 렌더러 명령 ----

  command(command: PlayCommand): void {
    if (this.finishedEmitted) return
    switch (command.type) {
      case 'start':
        this.requestStart()
        break
      case 'stop':
        this.requestStop(true)
        break
      case 'pause':
        this.setPaused(command.paused)
        break
      case 'step':
        this.startStep()
        break
      case 'speed':
        this.setSpeed(command.speed)
        break
    }
  }

  setGamepads(gamepads: [GamepadState | null, GamepadState | null]): void {
    this.gamepads = gamepads
  }

  // 정리: shutdown을 보내고 잠깐 기다린 뒤 끝낸다(창 닫기·앱 종료·다른 실행). 끝나면 풀린다.
  dispose(): Promise<void> {
    if (this.exitedFlag) return this.done
    this.cancelReply()
    if (!this.finishedEmitted && !this.shutdownSent) {
      this.shutdownSent = true
      this.process.send({ type: 'shutdown' })
    }
    if (this.disposeTimer === null) {
      this.disposeTimer = this.clock.setTimeout(() => {
        this.disposeTimer = null
        this.killNow('shutdownTimeout')
      }, this.timeouts.shutdownGraceMs)
    }
    return this.done
  }

  private requestStart(): void {
    if (this.phase !== 'init' || this.startQueued || this.stopRequested) return
    this.startQueued = true
    this.queued.push('start')
    if (this.paused) this.setPaused(false)
  }

  // unpause: 렌더러의 STOP은 일시 정지를 푼다. Autonomous 자동 정지는 그 틱의 답에 싣기만 한다(일시 정지는 그대로).
  private requestStop(unpause: boolean): void {
    if (this.finishedEmitted || this.stopRequested) return
    this.stopRequested = true
    this.killRemaining = this.timeouts.stopKillMs
    if (this.stalled) {
      this.killNow('stalled')
      return
    }
    if (this.phase === 'preparing' || this.phase === 'compiling') {
      if (!this.shutdownSent) {
        this.shutdownSent = true
        this.process.send({ type: 'shutdown' })
      }
    } else {
      this.queued.push('stop')
    }
    if (unpause && this.paused) this.setPaused(false)
    this.updateKillTimer()
  }

  private setPaused(paused: boolean): void {
    if (paused === this.paused) return
    this.paused = paused
    this.step = null
    if (paused) {
      this.cancelReply()
      this.samples = []
    } else {
      this.reanchor()
      this.schedule()
    }
    this.updateKillTimer()
    this.emitStatus(true)
  }

  private startStep(): void {
    if (!this.paused || this.step) return
    const from = this.pending?.tNanos ?? this.lastRepliedNanos ?? this.latestNanos
    this.step = {
      baseLoops: this.pending?.loops ?? this.lastLoops,
      deadline: from + STEP_MAX_NANOS
    }
    if (this.pending) this.reply()
    this.updateKillTimer()
  }

  private setSpeed(speed: PlaySpeed): void {
    if (!isValidSpeed(speed) || speed === this.speed) return
    this.speed = speed
    this.samples = []
    this.reanchor()
    if (this.pending && !this.paused && !this.step) {
      this.cancelReply()
      this.schedule()
    }
    this.emitStatus(true)
  }

  // ---- 페이스 ----

  private reanchor(): void {
    this.anchor =
      this.lastRepliedNanos === null
        ? null
        : { wall: this.clock.now(), virt: this.lastRepliedNanos }
  }

  private cancelReply(): void {
    if (this.replyTimer === null) return
    this.clock.clearTimeout(this.replyTimer)
    this.replyTimer = null
  }

  private schedule(): void {
    const tick = this.pending
    if (!tick || this.paused || this.step || this.replyTimer !== null || this.finishedEmitted)
      return
    if (this.speed === 'max') {
      this.reply()
      return
    }
    const now = this.clock.now()
    this.anchor ??= { wall: now, virt: this.lastRepliedNanos ?? tick.tNanos }
    const due = this.anchor.wall + (tick.tNanos - this.anchor.virt) / (1e6 * this.speed)
    if (due <= now) {
      if (now - due > MAX_LAG_MS) this.anchor = { wall: now, virt: tick.tNanos }
      this.reply()
      return
    }
    this.replyTimer = this.clock.setTimeout(() => {
      this.replyTimer = null
      this.reply()
    }, due - now)
  }

  private reply(): void {
    const tick = this.pending
    if (!tick || this.finishedEmitted) return
    this.cancelReply()
    this.pending = null
    const events = this.queued
    this.queued = []
    if (events.includes('start')) this.startNanos = tick.tNanos
    let inputs: Record<string, DeviceValues> = {}
    try {
      inputs = this.world.step(tick.tNanos, tick.outputs)
    } catch {
      // 세계(시뮬레이터)의 오류로 실행을 멈추지 않는다
    }
    this.process.send({
      type: 'tickReply',
      tick: tick.tick,
      events,
      gamepads: this.gamepads,
      inputs
    })
    this.lastRepliedNanos = tick.tNanos
    this.addSample(tick.tNanos)
    if (events.length > 0) this.emitStatus(true)
    this.updateKillTimer()
  }

  private onTick(tick: TickMessage): void {
    this.observe(tick.tNanos)
    // 틱이 왔다 = OpMode 스레드가 다시 가상 시계를 쓴다(stall이 풀렸다)
    this.stalled = false
    this.lastLoops = tick.loops
    this.outputs = { tNanos: tick.tNanos, outputs: tick.outputs }
    this.devicesThrottle.request()
    // 답하지 않은 틱이 있는데 새 틱이 오면(사이드카가 답을 기다리지 않은 틱) 앞의 것은 답 없이 넘긴다
    this.cancelReply()
    this.pending = tick
    if (
      this.options.flavor === 'Autonomous' &&
      this.options.autoStopAutonomous &&
      this.startNanos !== null &&
      tick.tNanos - this.startNanos >= AUTONOMOUS_SECONDS * 1e9
    )
      this.requestStop(false)
    if (this.finishedEmitted || this.exitedFlag) return
    if (this.step) {
      if (tick.loops > this.step.baseLoops || tick.tNanos >= this.step.deadline) {
        this.step = null
        this.updateKillTimer()
        this.emitStatus(true)
      } else {
        this.reply()
      }
      return
    }
    if (this.paused) {
      this.updateKillTimer()
      return
    }
    this.schedule()
  }

  // ---- STOP 시간 초과 ----

  // 일시 정지로 틱을 두고 있는 동안은 세지 않는다(사이드카가 멈춘 것은 호스트 때문이다)
  private updateKillTimer(): void {
    if (
      this.killRemaining === null ||
      this.exitedFlag ||
      this.finishedEmitted ||
      this.killReason !== null
    ) {
      this.clearKillTimer()
      return
    }
    const holding = this.paused && this.pending !== null && this.step === null
    const now = this.clock.now()
    if (holding) {
      if (this.killTimer !== null) {
        this.killRemaining -= now - this.killStartedAt
        this.clearKillTimer()
      }
      return
    }
    if (this.killTimer !== null) return
    this.killStartedAt = now
    this.killTimer = this.clock.setTimeout(
      () => {
        this.killTimer = null
        this.killNow('stopTimeout')
      },
      Math.max(0, this.killRemaining)
    )
  }

  private clearKillTimer(): void {
    if (this.killTimer === null) return
    this.clock.clearTimeout(this.killTimer)
    this.killTimer = null
  }

  private killNow(reason: KillReason): void {
    if (this.exitedFlag) return
    this.killReason ??= reason
    this.clearKillTimer()
    this.cancelReply()
    this.process.kill()
  }

  private protocolFail(what: string): void {
    if (this.exitedFlag || this.protocolError !== null) return
    this.protocolError = what
    this.cancelReply()
    this.process.kill()
  }

  // ---- 사이드카 출력 ----

  private onStdout(chunk: string): void {
    if (this.protocolError !== null || this.exitedFlag) return
    try {
      for (const line of this.splitter.push(chunk)) {
        if (this.protocolError !== null) return
        if (line.trim() === '') continue
        // finished 뒤의 출력은 보지 않는다(프로세스가 곧 끝난다)
        if (this.finishedEmitted) continue
        this.handle(parseSidecarLine(line))
      }
    } catch (error) {
      this.protocolFail(error instanceof ProtocolError ? error.message : String(error))
    }
  }

  private onStderr(chunk: string): void {
    const lines = (this.stderrPending + chunk).split(/\r?\n/)
    this.stderrPending = (lines.pop() ?? '').slice(-DETAIL_LIMIT)
    for (const line of lines) this.pushStderr(line)
  }

  private pushStderr(line: string): void {
    if (line.trim() === '' || JVM_NOTICE.test(line)) return
    this.stderrLines.push(line.slice(0, DETAIL_LIMIT))
    if (this.stderrLines.length > STDERR_TAIL_LINES) this.stderrLines.shift()
  }

  private handle(message: SidecarMessage): void {
    if (!this.helloSeen && message.type !== 'hello') throw new ProtocolError('message before hello')
    switch (message.type) {
      case 'hello':
        if (this.helloSeen) throw new ProtocolError('second hello')
        this.helloSeen = true
        if (this.helloTimer !== null) {
          this.clock.clearTimeout(this.helloTimer)
          this.helloTimer = null
        }
        if (message.protocol !== SIDECAR_PROTOCOL_VERSION)
          throw new ProtocolError(
            `protocol ${message.protocol} (host speaks ${SIDECAR_PROTOCOL_VERSION})`
          )
        this.setPhase('compiling')
        break
      case 'compiled':
        this.flushLogs()
        this.emit({
          type: 'compiled',
          runId: this.runId,
          ok: message.ok,
          millis: message.millis,
          diagnostics: message.diagnostics.map((d): PlayDiagnostic => {
            const mapped =
              d.file === null ? { path: null, file: '' } : this.options.mapSource(d.file)
            return {
              kind: d.kind,
              path: mapped.path,
              file: mapped.file,
              line: d.line,
              column: d.column,
              message: d.message,
              code: d.code
            }
          })
        })
        break
      case 'state':
        this.observe(message.tNanos)
        this.setPhase(message.phase)
        break
      case 'tick':
        this.onTick(message)
        break
      case 'telemetry':
        this.observe(message.tNanos)
        this.telemetry = message
        this.telemetryThrottle.request()
        break
      case 'log':
        this.observe(message.tNanos)
        this.pushLog(message)
        break
      case 'error':
        this.observe(message.tNanos)
        if (message.kind === 'stall') {
          this.stalled = true
          if (this.stopRequested) this.killNow('stalled')
        }
        this.flushLogs()
        this.emit({
          type: 'error',
          runId: this.runId,
          tNanos: message.tNanos,
          kind: message.kind,
          message: message.message,
          exception: message.exception,
          thread: message.thread,
          stack: message.stack.map((frame): PlayStackFrame => ({
            className: frame.className,
            method: frame.method,
            file: frame.file,
            line: frame.line,
            path: frame.source === null ? null : this.options.mapSource(frame.source).path
          }))
        })
        break
      case 'finished':
        this.observe(message.tNanos)
        this.finish(message.reason, '')
        this.exitTimer = this.clock.setTimeout(() => {
          this.exitTimer = null
          if (!this.exitedFlag) this.process.kill()
        }, this.timeouts.exitAfterFinishedMs)
        break
    }
  }

  private observe(tNanos: number): void {
    if (tNanos > this.latestNanos) this.latestNanos = tNanos
  }

  private setPhase(phase: PlayPhase): void {
    if (phase === this.phase || this.finishedEmitted) return
    this.phase = phase
    this.flushLogs()
    this.emit({ type: 'phase', runId: this.runId, phase })
    this.emitStatus(true)
  }

  // ---- 프로세스 종료 ----

  private onExit(exit: ProcessExit): void {
    if (this.exitedFlag) return
    this.exitedFlag = true
    if (this.stderrPending) this.pushStderr(this.stderrPending)
    this.stderrPending = ''
    for (const timer of [this.helloTimer, this.exitTimer, this.disposeTimer, this.statusTimer])
      if (timer !== null) this.clock.clearTimeout(timer)
    this.helloTimer = this.exitTimer = this.disposeTimer = this.statusTimer = null
    this.clearKillTimer()
    this.cancelReply()
    if (!this.finishedEmitted) {
      const how = exit.code !== null ? `exit code ${exit.code}` : `signal ${exit.signal ?? '?'}`
      if (this.protocolError !== null)
        this.finish('crashed', this.detail(`protocol error: ${this.protocolError}`))
      else if (this.killReason !== null) this.finish('killed', this.killReason)
      else
        this.finish(
          'crashed',
          this.detail(this.splitter.hasPartial ? `${how}; truncated output` : how)
        )
    }
    this.resolveDone()
  }

  // 머리줄 + stderr 끝부분(JVM 안내 줄은 뺀다)
  private detail(head: string): string {
    const text = [head, ...this.stderrLines].join('\n')
    return text.length > DETAIL_LIMIT ? `…${text.slice(-DETAIL_LIMIT)}` : text
  }

  private finish(reason: FinishReason | 'killed' | 'crashed', detail: string): void {
    if (this.finishedEmitted) return
    this.cancelReply()
    this.pending = null
    this.step = null
    this.clearKillTimer()
    this.flushLogs()
    this.telemetryThrottle.flush()
    this.devicesThrottle.flush()
    this.emitStatus(true)
    this.finishedEmitted = true
    if (this.statusTimer !== null) {
      this.clock.clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    if (this.helloTimer !== null) {
      this.clock.clearTimeout(this.helloTimer)
      this.helloTimer = null
    }
    this.phase = 'finished'
    this.emit({ type: 'phase', runId: this.runId, phase: 'finished' })
    // Autonomous가 제대로 끝났을 때만 DS처럼 다음 TeleOp을 고르게 한다
    const ended = reason === 'stopped' || reason === 'returned' || reason === 'terminated'
    this.emit({
      type: 'finished',
      runId: this.runId,
      tNanos: this.latestNanos,
      reason,
      detail,
      preselectTeleOp:
        this.options.flavor === 'Autonomous' && ended ? this.options.preselectTeleOp : ''
    })
  }

  // ---- 렌더러로 ----

  private emit(event: PlayEvent): void {
    this.options.emit(event)
  }

  private pushLog(message: LogMessage): void {
    const text =
      message.text.length > MAX_LOG_TEXT ? `${message.text.slice(0, MAX_LOG_TEXT)}…` : message.text
    this.logs.push({ tNanos: message.tNanos, stream: message.stream, text })
    if (this.logs.length >= LOG_BATCH_MAX) {
      this.flushLogs()
      return
    }
    this.logTimer ??= this.clock.setTimeout(() => {
      this.logTimer = null
      this.flushLogs()
    }, LOG_FLUSH_MS)
  }

  private flushLogs(): void {
    if (this.logTimer !== null) {
      this.clock.clearTimeout(this.logTimer)
      this.logTimer = null
    }
    if (this.logs.length === 0) return
    const entries = this.logs
    this.logs = []
    this.emit({ type: 'log', runId: this.runId, entries })
  }

  private sendTelemetry(): void {
    const message = this.telemetry
    if (!message) return
    this.telemetry = null
    this.emit({
      type: 'telemetry',
      runId: this.runId,
      tNanos: message.tNanos,
      frame: message.frame
    })
  }

  private sendDevices(): void {
    const latest = this.outputs
    if (!latest) return
    const key = JSON.stringify(latest.outputs)
    if (key === this.lastDevicesKey) return
    this.lastDevicesKey = key
    this.emit({
      type: 'devices',
      runId: this.runId,
      tNanos: latest.tNanos,
      outputs: latest.outputs,
      // 2단계(A): 세계가 보낸 센서 값의 누적 상태
      inputs: {}
    })
  }

  private addSample(virt: number): void {
    const now = this.clock.now()
    const last = this.samples[this.samples.length - 1]
    if (last && now - last.wall < SAMPLE_GAP_MS) return
    this.samples.push({ wall: now, virt })
  }

  // 최근 1초 동안 가상 시간이 실제 시간보다 몇 배 흘렀나. 일시 정지 중이면 0, 잴 만큼 쌓이지 않았으면 설정한 속도
  // (최대면 0).
  private realtime(): number {
    if (this.paused) return 0
    const now = this.clock.now()
    while (this.samples.length > 1 && this.samples[1].wall <= now - REALTIME_WINDOW_MS)
      this.samples.shift()
    const first = this.samples[0]
    const nominal = this.speed === 'max' ? 0 : this.speed
    if (!first || this.lastRepliedNanos === null) return nominal
    const span = now - first.wall
    if (span < REALTIME_MIN_SPAN_MS) return nominal
    return Math.round(((this.lastRepliedNanos - first.virt) / 1e6 / span) * 1000) / 1000
  }

  private emitStatus(force: boolean): void {
    if (this.finishedEmitted) return
    const event: PlayEvent = {
      type: 'status',
      runId: this.runId,
      tNanos: this.latestNanos,
      paused: this.paused,
      speed: this.speed,
      realtime: this.realtime(),
      startedNanos:
        this.startNanos === null ? null : Math.max(0, this.latestNanos - this.startNanos)
    }
    const key = JSON.stringify(event)
    if (!force && key === this.lastStatusKey) return
    this.lastStatusKey = key
    this.emit(event)
  }

  private statusTick(): void {
    this.statusTimer = null
    if (this.finishedEmitted || this.exitedFlag) return
    this.emitStatus(false)
    this.statusTimer = this.clock.setTimeout(() => this.statusTick(), STATUS_INTERVAL_MS)
  }
}
