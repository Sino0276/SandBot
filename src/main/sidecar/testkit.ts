// 호스트 테스트 도구(session.test.ts·controller.test.ts가 쓴다. 앱 코드는 쓰지 않는다).
// - FakeClock: 손으로 돌리는 시계(advance로 그 사이 타이머를 차례로 부른다)
// - FakeProcess: 메모리 안의 사이드카 프로세스(보낸 메시지를 모으고, 사이드카 출력·종료를 흉내 낸다)
// - FAKE_SIDECAR_SCRIPT: node로 돌리는 가짜 사이드카(진짜 파이프·프로세스로 프로토콜의 사이드카 쪽을 흉내 낸다)
import type { HostMessage, SidecarMessage, TickReply } from '../../shared/sidecarProtocol'
import type { ProcessExit, SidecarProcess } from './process'
import type { HostClock } from './session'

type Timer = { at: number; id: number; fn: () => void }

export class FakeClock implements HostClock {
  time = 0
  private timers = new Map<number, Timer>()
  private nextId = 1

  now = (): number => this.time

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++
    this.timers.set(id, { at: this.time + Math.max(0, ms), id, fn })
    return id
  }

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }

  // ms만큼 시간을 보낸다. 그 사이에 된 타이머를 시각 순서(같으면 만든 순서)로 부른다.
  advance(ms: number): void {
    const target = this.time + ms
    for (;;) {
      let next: Timer | null = null
      for (const timer of this.timers.values()) {
        if (timer.at > target) continue
        if (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id))
          next = timer
      }
      if (!next) break
      this.timers.delete(next.id)
      this.time = Math.max(this.time, next.at)
      next.fn()
    }
    this.time = target
  }

  get pendingTimers(): number {
    return this.timers.size
  }
}

export class FakeProcess implements SidecarProcess {
  readonly sent: HostMessage[] = []
  killed = false
  exited = false
  private stdout: ((chunk: string) => void)[] = []
  private stderr: ((chunk: string) => void)[] = []
  private exits: ((exit: ProcessExit) => void)[] = []

  // kill하면 진짜처럼 조금 뒤(마이크로태스크) 끝난다. false면 테스트가 exit을 부른다(끝나지 않는 프로세스).
  constructor(private readonly exitOnKill = true) {}

  send(message: HostMessage): void {
    if (!this.exited) this.sent.push(message)
  }

  kill(): void {
    if (this.exited) return
    this.killed = true
    if (this.exitOnKill) queueMicrotask(() => this.exit(null, 'SIGKILL'))
  }

  onStdout(listener: (chunk: string) => void): void {
    this.stdout.push(listener)
  }

  onStderr(listener: (chunk: string) => void): void {
    this.stderr.push(listener)
  }

  onExit(listener: (exit: ProcessExit) => void): void {
    this.exits.push(listener)
  }

  // 사이드카가 stdout에 메시지 한 줄을 쓴다
  line(message: SidecarMessage | Record<string, unknown>): void {
    this.raw(`${JSON.stringify(message)}\n`)
  }

  raw(chunk: string): void {
    for (const listener of this.stdout) listener(chunk)
  }

  err(chunk: string): void {
    for (const listener of this.stderr) listener(chunk)
  }

  exit(code: number | null, signal: string | null = null): void {
    if (this.exited) return
    this.exited = true
    for (const listener of this.exits) listener({ code, signal })
  }

  replies(): TickReply[] {
    return this.sent.filter((message): message is TickReply => message.type === 'tickReply')
  }
}

// 마이크로태스크(가짜 kill의 종료)를 흘려보낸다
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

// 가짜 사이드카(Node CommonJS). RunRequest.opModeClass의 단순 이름으로 동작을 고른다:
// - Normal: 틱마다 텔레메트리·로그·장치 출력, start → running, stop → stopping → 2틱 뒤 finished stopped
// - SlowLoop: loops가 4틱마다 하나 는다
// - Crash: 3틱 뒤 stderr에 오류를 쓰고 exit 1
// - Stall: START 뒤 error stall을 보내고 틱을 멈춘다(stdin은 계속 읽는다)
// - NeverStop: stop을 받아도 끝나지 않는다
// - Garbage: JSON이 아닌 줄을 쓴다
// - Truncated: 줄 중간에 끝난다
// - CompileError: 컴파일 진단과 finished compileFailed
// - Returns: running 5틱 뒤 finished returned(START 전이면 init 5틱 뒤)
// - Errors: 팀 코드 스택이 있는 error exception과 finished exception
// - IgnoreShutdown: shutdown에 답하지 않는다
// 시작할 때 stderr에 JVM 안내(Picked up JAVA_TOOL_OPTIONS)를 쓰고, robotLog로 argv와 받은 RunRequest를 알린다.
export const FAKE_SIDECAR_SCRIPT = String.raw`
const readline = require('readline')
const TICK = 5000000
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n')
process.stderr.write('Picked up JAVA_TOOL_OPTIONS: -Dfake=1\n')
out({ type: 'hello', protocol: Number(process.env.FAKE_PROTOCOL || 1), runtime: 'fake', java: '21' })
let request = null
let waiting = null
let t = 0
let mode = ''
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.type === 'shutdown') {
    if (mode === 'IgnoreShutdown') return
    out({ type: 'finished', tNanos: t, reason: 'shutdown' })
    process.exit(0)
  }
  if (msg.type === 'run') {
    request = msg
    mode = msg.opModeClass.split('.').pop()
    main()
  }
  if (msg.type === 'tickReply') {
    const resolve = waiting
    waiting = null
    if (resolve) resolve(msg)
  }
})
rl.on('close', () => process.exit(0))
const hang = () => setInterval(() => {}, 1000)
async function main() {
  out({ type: 'log', tNanos: 0, stream: 'robotLog', text: 'argv ' + JSON.stringify(process.argv.slice(2)) })
  out({ type: 'log', tNanos: 0, stream: 'robotLog', text: 'request ' + JSON.stringify(request) })
  if (mode === 'Garbage') { process.stdout.write('this is not json\n'); return hang() }
  if (mode === 'Truncated') { process.stdout.write('{"type":"tick","tick":0'); process.exit(0) }
  if (mode === 'CompileError') {
    out({ type: 'compiled', ok: false, millis: 3, diagnostics: [{ kind: 'error', file: request.opModeSource, line: 3, column: 9, message: "';' expected", code: 'compiler.err.expected' }] })
    out({ type: 'finished', tNanos: 0, reason: 'compileFailed' })
    process.exit(0)
  }
  out({ type: 'compiled', ok: true, millis: 3, diagnostics: [] })
  out({ type: 'state', tNanos: 0, phase: 'init' })
  let phase = 'init'
  let loops = 0
  let stopAt = -1
  let runningTicks = 0
  for (let k = 0; ; k++) {
    t = k * TICK
    if (mode === 'Crash' && k === 3) {
      process.stderr.write('Exception in thread "main" java.lang.OutOfMemoryError: Java heap space\n')
      process.exit(1)
    }
    if (mode === 'SlowLoop' ? k % 4 === 0 : true) loops++
    out({ type: 'telemetry', tNanos: t, frame: { lines: ['tick : ' + k], log: [], format: 'classic' } })
    out({ type: 'log', tNanos: t, stream: 'out', text: 'loop ' + k })
    out({ type: 'tick', tick: k, tNanos: t, phase, loops, outputs: { motor: { power: phase === 'running' ? 0.5 : 0 } } })
    const reply = await new Promise((resolve) => { waiting = resolve })
    if (reply.tick !== k) { process.stderr.write('bad reply ' + reply.tick + '\n'); process.exit(9) }
    for (const event of reply.events) {
      if (event === 'start' && phase === 'init') { phase = 'running'; out({ type: 'state', tNanos: t, phase }) }
      if (event === 'stop' && phase !== 'stopping') { phase = 'stopping'; stopAt = k; out({ type: 'state', tNanos: t, phase }) }
    }
    if (phase === 'running') runningTicks++
    if (mode === 'Stall' && phase === 'running') {
      out({ type: 'error', tNanos: t, kind: 'stall', message: 'OpMode thread did not use the clock', exception: null, stack: [], thread: 'OpModeThread' })
      return hang()
    }
    if (mode === 'Errors' && k === 2) {
      out({ type: 'error', tNanos: t, kind: 'exception', message: 'boom', exception: 'java.lang.IllegalStateException', thread: 'OpModeThread',
        stack: [{ className: request.opModeClass, method: 'runOpMode', file: 'Errors.java', line: 12, source: request.opModeSource },
                { className: 'com.qualcomm.robotcore.eventloop.opmode.LinearOpMode', method: 'internalRunOpMode', file: 'LinearOpMode.java', line: 40, source: null }] })
      out({ type: 'finished', tNanos: t, reason: 'exception' })
      process.exit(0)
    }
    if (mode === 'Returns' && (runningTicks >= 5 || (phase === 'init' && k >= 5))) {
      out({ type: 'finished', tNanos: t, reason: 'returned' })
      process.exit(0)
    }
    if (stopAt >= 0 && mode !== 'NeverStop' && k >= stopAt + 2) {
      out({ type: 'finished', tNanos: t, reason: 'stopped' })
      process.exit(0)
    }
  }
}
`
