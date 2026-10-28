import { describe, expect, it } from 'vitest'
import type { PlayEvent } from '../../shared/play'
import type { RunRequest, TickMessage } from '../../shared/sidecarProtocol'
import { sourceMapper } from './launch'
import { MAX_LINE_CHARS } from './protocol'
import { MAX_LAG_MS, SidecarSession, type SessionOptions } from './session'
import { FakeClock, FakeProcess, settle } from './testkit'

const ROOT = '/proj'
const SOURCE = `${ROOT}/TeamCode/src/main/java/org/firstinspires/ftc/teamcode/Drive.java`

const REQUEST: RunRequest = {
  type: 'run',
  protocol: 1,
  clock: 'virtual',
  tickNanos: 5_000_000,
  sourceRoots: [`${ROOT}/TeamCode/src/main/java`],
  opModeSource: SOURCE,
  opModeClass: 'org.firstinspires.ftc.teamcode.Drive',
  sdkClasspath: ['/sidecar/sandbot-sdk.jar'],
  configXml: null,
  timing: {},
  jitter: 0,
  seed: 0,
  startEpochMillis: 0,
  stallMillis: 2000
}

const MS = 1_000_000

function setup(
  options: Partial<SessionOptions> = {},
  exitOnKill = true
): {
  clock: FakeClock
  proc: FakeProcess
  events: PlayEvent[]
  session: SidecarSession
  of: <T extends PlayEvent['type']>(type: T) => Extract<PlayEvent, { type: T }>[]
} {
  const clock = new FakeClock()
  const proc = new FakeProcess(exitOnKill)
  const events: PlayEvent[] = []
  const session = new SidecarSession(proc, REQUEST, {
    runId: 'run-1',
    flavor: 'TeleOp',
    speed: 1,
    autoStopAutonomous: true,
    preselectTeleOp: '',
    mapSource: sourceMapper(ROOT),
    emit: (event) => events.push(event),
    clock,
    ...options
  })
  const of = <T extends PlayEvent['type']>(type: T): Extract<PlayEvent, { type: T }>[] =>
    events.filter((event): event is Extract<PlayEvent, { type: T }> => event.type === type)
  return { clock, proc, events, session, of }
}

function boot(proc: FakeProcess): void {
  proc.line({ type: 'hello', protocol: 1, runtime: 'test', java: '21' })
  proc.line({ type: 'compiled', ok: true, diagnostics: [], millis: 4 })
  proc.line({ type: 'state', tNanos: 0, phase: 'init' })
}

function tick(k: number, options: Partial<TickMessage> = {}): TickMessage {
  return {
    type: 'tick',
    tick: k,
    tNanos: k * 5 * MS,
    phase: 'init',
    loops: k,
    outputs: {},
    ...options
  }
}

function replyTicks(proc: FakeProcess): number[] {
  return proc.replies().map((reply) => reply.tick)
}

describe('SidecarSession 시작과 이벤트', () => {
  it('run을 바로 보내고, hello → compiling, state → init, 모든 이벤트에 runId', () => {
    const { proc, events, of } = setup()
    expect(proc.sent[0]).toEqual(REQUEST)
    boot(proc)
    expect(of('phase').map((event) => event.phase)).toEqual(['preparing', 'compiling', 'init'])
    expect(of('compiled')).toEqual([
      { type: 'compiled', runId: 'run-1', ok: true, millis: 4, diagnostics: [] }
    ])
    expect(events.every((event) => event.runId === 'run-1')).toBe(true)
  })

  it('진단과 스택 프레임의 경로를 TeamCode 기준으로 바꾼다', () => {
    const { proc, of } = setup()
    proc.line({ type: 'hello', protocol: 1, runtime: 'test', java: '21' })
    proc.line({
      type: 'compiled',
      ok: false,
      millis: 1,
      diagnostics: [
        { kind: 'error', file: SOURCE, line: 3, column: 5, message: 'x', code: 'c' },
        {
          kind: 'warning',
          file: `${ROOT}/TeamCode/src/main/java/org/firstinspires/ftc/teamcode/sandbot/RobotHardware.java`,
          line: 1,
          column: 1,
          message: 'y',
          code: 'd'
        },
        {
          kind: 'note',
          file: `${ROOT}/FtcRobotController/src/main/java/a/Sample.java`,
          line: 0,
          column: 0,
          message: 'z',
          code: 'e'
        },
        { kind: 'note', file: null, line: 0, column: 0, message: 'w', code: 'f' }
      ]
    })
    expect(of('compiled')[0].diagnostics.map((d) => [d.path, d.file])).toEqual([
      [
        'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
        'src/main/java/org/firstinspires/ftc/teamcode/Drive.java'
      ],
      [null, 'src/main/java/org/firstinspires/ftc/teamcode/sandbot/RobotHardware.java'],
      [null, 'Sample.java'],
      [null, '']
    ])
    proc.line({
      type: 'error',
      tNanos: 0,
      kind: 'exception',
      message: 'boom',
      exception: 'java.lang.RuntimeException',
      thread: 'OpModeThread',
      stack: [
        {
          className: 'org.x.Drive',
          method: 'runOpMode',
          file: 'Drive.java',
          line: 9,
          source: SOURCE
        },
        { className: 'java.lang.Thread', method: 'run', file: null, line: -1, source: null }
      ]
    })
    expect(of('error')[0].stack.map((frame) => frame.path)).toEqual([
      'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
      null
    ])
  })
})

describe('SidecarSession 페이스', () => {
  it('1×: 첫 틱은 바로, 다음 틱은 가상 5 ms 뒤(실제 5 ms)', () => {
    const { clock, proc } = setup()
    boot(proc)
    proc.line(tick(0))
    expect(replyTicks(proc)).toEqual([0])
    proc.line(tick(1))
    clock.advance(4.9)
    expect(replyTicks(proc)).toEqual([0])
    clock.advance(0.1)
    expect(replyTicks(proc)).toEqual([0, 1])
  })

  it('2×는 절반, 0.25×는 네 배의 실제 시간', () => {
    const fast = setup({ speed: 2 })
    boot(fast.proc)
    fast.proc.line(tick(0))
    fast.proc.line(tick(1))
    fast.clock.advance(2.4)
    expect(replyTicks(fast.proc)).toEqual([0])
    fast.clock.advance(0.1)
    expect(replyTicks(fast.proc)).toEqual([0, 1])

    const slow = setup({ speed: 0.25 })
    boot(slow.proc)
    slow.proc.line(tick(0))
    slow.proc.line(tick(1))
    slow.clock.advance(19.9)
    expect(replyTicks(slow.proc)).toEqual([0])
    slow.clock.advance(0.1)
    expect(replyTicks(slow.proc)).toEqual([0, 1])
  })

  it('max는 기다리지 않는다', () => {
    const { proc } = setup({ speed: 'max' })
    boot(proc)
    for (let k = 0; k < 10; k++) proc.line(tick(k))
    expect(replyTicks(proc)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('사이드카가 조금 늦으면 따라잡고, 많이 늦으면 기준점을 다시 잡는다(몰아서 돌지 않는다)', () => {
    const { clock, proc } = setup()
    boot(proc)
    proc.line(tick(0))
    // 틱 1이 3 ms 늦게 온다(5 ms 예정 → 8 ms): 바로 답하고, 틱 2는 원래 예정(10 ms)대로
    clock.advance(8)
    proc.line(tick(1))
    expect(replyTicks(proc)).toEqual([0, 1])
    proc.line(tick(2))
    clock.advance(1.9)
    expect(replyTicks(proc)).toEqual([0, 1])
    clock.advance(0.1)
    expect(replyTicks(proc)).toEqual([0, 1, 2])
    // 긴 지연(GC 등): 틱 3이 MAX_LAG_MS보다 늦게 온다 → 바로 답하고 그 시각부터 다시 5 ms 간격
    clock.advance(MAX_LAG_MS + 50)
    proc.line(tick(3))
    expect(replyTicks(proc)).toEqual([0, 1, 2, 3])
    proc.line(tick(4))
    clock.advance(4.9)
    expect(replyTicks(proc)).toEqual([0, 1, 2, 3])
    clock.advance(0.1)
    expect(replyTicks(proc)).toEqual([0, 1, 2, 3, 4])
  })

  it('속도를 바꾸면 기준점을 다시 잡는다', () => {
    const { clock, proc, session, of } = setup()
    boot(proc)
    proc.line(tick(0))
    proc.line(tick(1))
    clock.advance(2)
    session.command({ type: 'speed', speed: 0.5 })
    // 기준점 = (지금, 틱 0) → 틱 1은 지금부터 10 ms 뒤
    clock.advance(9.9)
    expect(replyTicks(proc)).toEqual([0])
    clock.advance(0.1)
    expect(replyTicks(proc)).toEqual([0, 1])
    expect(of('status').at(-1)?.speed).toBe(0.5)
    session.command({ type: 'speed', speed: 'max' })
    proc.line(tick(2))
    expect(replyTicks(proc)).toEqual([0, 1, 2])
  })
})

describe('SidecarSession 일시 정지와 Step', () => {
  it('일시 정지 중에는 답하지 않고, 풀면 그때부터 다시 잰다(따라잡기 폭주 없음)', () => {
    const { clock, proc, session, of } = setup()
    boot(proc)
    proc.line(tick(0))
    session.command({ type: 'pause', paused: true })
    expect(of('status').at(-1)).toMatchObject({ paused: true, realtime: 0 })
    proc.line(tick(1))
    clock.advance(10_000)
    expect(replyTicks(proc)).toEqual([0])
    session.command({ type: 'pause', paused: false })
    expect(of('status').at(-1)?.paused).toBe(false)
    // 기준점 = (지금, 틱 0): 틱 1은 5 ms 뒤, 틱 2는 10 ms 뒤(한꺼번에 보내지 않는다)
    clock.advance(4.9)
    expect(replyTicks(proc)).toEqual([0])
    clock.advance(0.1)
    expect(replyTicks(proc)).toEqual([0, 1])
    proc.line(tick(2))
    clock.advance(4.9)
    expect(replyTicks(proc)).toEqual([0, 1])
    clock.advance(0.1)
    expect(replyTicks(proc)).toEqual([0, 1, 2])
  })

  it('Step: 둔 틱에 답하고, loops가 는 틱에서 다시 멈춘다', () => {
    const { clock, proc, session } = setup()
    boot(proc)
    proc.line(tick(0, { loops: 3 }))
    session.command({ type: 'pause', paused: true })
    proc.line(tick(1, { loops: 3 }))
    // 일시 정지가 아니면 Step은 무시
    session.command({ type: 'step' })
    session.command({ type: 'step' })
    expect(replyTicks(proc)).toEqual([0, 1])
    // loops가 그대로인 틱은 바로 답한다(페이스 없이)
    proc.line(tick(2, { loops: 3 }))
    proc.line(tick(3, { loops: 3 }))
    expect(replyTicks(proc)).toEqual([0, 1, 2, 3])
    // loops가 늘었다 → 그 틱에서 멈춘다
    proc.line(tick(4, { loops: 4 }))
    clock.advance(1000)
    expect(replyTicks(proc)).toEqual([0, 1, 2, 3])
    // 다음 Step은 그 틱부터
    session.command({ type: 'step' })
    expect(replyTicks(proc)).toEqual([0, 1, 2, 3, 4])
    proc.line(tick(5, { loops: 5 }))
    expect(replyTicks(proc)).toEqual([0, 1, 2, 3, 4])
  })

  it('Step: 가상 1초 안에 루프가 없으면 거기서 멈춘다', () => {
    const { proc, session } = setup()
    boot(proc)
    session.command({ type: 'pause', paused: true })
    proc.line(tick(0, { loops: 0 }))
    session.command({ type: 'step' })
    for (let k = 1; k < 200; k++) proc.line(tick(k, { loops: 0 }))
    expect(proc.replies().length).toBe(200)
    // 틱 200 = 가상 1초
    proc.line(tick(200, { loops: 0 }))
    expect(proc.replies().length).toBe(200)
  })

  it('일시 정지 중 START·STOP은 일시 정지를 풀고 다음 답에 싣는다', () => {
    const { clock, proc, session, of } = setup()
    boot(proc)
    proc.line(tick(0))
    session.command({ type: 'pause', paused: true })
    proc.line(tick(1))
    session.command({ type: 'start' })
    expect(of('status').at(-1)?.paused).toBe(false)
    clock.advance(5)
    expect(proc.replies().at(-1)).toMatchObject({ tick: 1, events: ['start'] })
    proc.line({ type: 'state', tNanos: 5 * MS, phase: 'running' })
    session.command({ type: 'pause', paused: true })
    proc.line(tick(2, { phase: 'running' }))
    session.command({ type: 'stop' })
    clock.advance(5)
    expect(proc.replies().at(-1)).toMatchObject({ tick: 2, events: ['stop'] })
    expect(of('status').at(-1)?.paused).toBe(false)
  })

  it('START는 init 단계에서 한 번만, STOP 뒤에는 받지 않는다', () => {
    const { clock, proc, session } = setup()
    proc.line({ type: 'hello', protocol: 1, runtime: 'test', java: '21' })
    session.command({ type: 'start' })
    proc.line({ type: 'state', tNanos: 0, phase: 'init' })
    proc.line(tick(0))
    expect(proc.replies()[0].events).toEqual([])
    session.command({ type: 'start' })
    session.command({ type: 'start' })
    proc.line(tick(1))
    clock.advance(5)
    expect(proc.replies()[1].events).toEqual(['start'])
  })

  it('START 전 STOP은 stop만 보낸다', () => {
    const { proc, session } = setup({ speed: 'max' })
    boot(proc)
    session.command({ type: 'stop' })
    session.command({ type: 'start' })
    proc.line(tick(0))
    expect(proc.replies()[0].events).toEqual(['stop'])
  })
})

describe('SidecarSession Autonomous 30초', () => {
  const run = (options: Partial<SessionOptions>): { events: string[][]; status: PlayEvent[] } => {
    const { proc, session, of } = setup({ speed: 'max', ...options })
    boot(proc)
    proc.line(tick(0))
    session.command({ type: 'start' })
    proc.line(tick(1, { tNanos: 100 * MS }))
    proc.line({ type: 'state', tNanos: 100 * MS, phase: 'running' })
    // START 틱(0.1초)부터 30초가 되는 틱
    proc.line(tick(2, { tNanos: 20_000 * MS, phase: 'running' }))
    proc.line(tick(3, { tNanos: 30_099 * MS, phase: 'running' }))
    proc.line(tick(4, { tNanos: 30_100 * MS, phase: 'running' }))
    proc.line(tick(5, { tNanos: 30_105 * MS, phase: 'running' }))
    return { events: proc.replies().map((reply) => reply.events), status: of('status') }
  }

  it('START 뒤 가상 30초가 된 틱의 답에 STOP을 싣는다', () => {
    const { events, status } = run({ flavor: 'Autonomous' })
    expect(events).toEqual([[], ['start'], [], [], ['stop'], []])
    // STOP을 실은 답 때의 status: START(0.1초) 뒤 30초
    expect(status.at(-1)).toMatchObject({ startedNanos: 30_000 * MS })
  })

  it('TeleOp이거나 설정을 끄면 멈추지 않는다', () => {
    expect(run({ flavor: 'TeleOp' }).events.flat()).toEqual(['start'])
    expect(run({ flavor: 'Autonomous', autoStopAutonomous: false }).events.flat()).toEqual([
      'start'
    ])
  })
})

describe('SidecarSession 끝내기', () => {
  it('사이드카의 finished를 그대로 알리고, Autonomous면 preselectTeleOp', async () => {
    const { proc, of } = setup({ flavor: 'Autonomous', preselectTeleOp: 'Drive' })
    boot(proc)
    proc.line({ type: 'finished', tNanos: 7 * MS, reason: 'stopped' })
    expect(of('finished')).toEqual([
      {
        type: 'finished',
        runId: 'run-1',
        tNanos: 7 * MS,
        reason: 'stopped',
        detail: '',
        preselectTeleOp: 'Drive'
      }
    ])
    expect(of('phase').at(-1)?.phase).toBe('finished')
    proc.exit(0)
    expect(of('finished').length).toBe(1)
  })

  it('오류로 끝난 Autonomous는 preselectTeleOp를 주지 않는다', () => {
    const { proc, of } = setup({ flavor: 'Autonomous', preselectTeleOp: 'Drive' })
    boot(proc)
    proc.line({ type: 'finished', tNanos: 0, reason: 'exception' })
    expect(of('finished')[0].preselectTeleOp).toBe('')
  })

  it('finished 뒤 스스로 끝나지 않으면 조용히 kill한다', async () => {
    const { clock, proc, session, of } = setup()
    boot(proc)
    proc.line({ type: 'finished', tNanos: 0, reason: 'returned' })
    clock.advance(2000)
    await settle()
    expect(proc.killed).toBe(true)
    expect(session.exited).toBe(true)
    expect(of('finished').map((event) => event.reason)).toEqual(['returned'])
  })

  it('STOP 뒤 5초(실제) 안에 끝나지 않으면 kill → killed stopTimeout. 일시 정지로 둔 시간은 세지 않는다', async () => {
    const { clock, proc, session, of } = setup()
    boot(proc)
    proc.line(tick(0))
    session.command({ type: 'stop' })
    clock.advance(5)
    proc.line(tick(1))
    clock.advance(1000)
    // 다음 틱을 두고 일시 정지
    session.command({ type: 'pause', paused: true })
    proc.line(tick(2))
    clock.advance(60_000)
    expect(proc.killed).toBe(false)
    session.command({ type: 'pause', paused: false })
    clock.advance(3900)
    expect(proc.killed).toBe(false)
    clock.advance(100)
    expect(proc.killed).toBe(true)
    await settle()
    expect(of('finished')).toMatchObject([{ reason: 'killed', detail: 'stopTimeout' }])
    expect(session.exited).toBe(true)
  })

  it('stall 뒤 STOP, STOP 뒤 stall이면 바로 kill → killed stalled', async () => {
    for (const order of ['stallFirst', 'stopFirst']) {
      const { proc, session, of } = setup()
      boot(proc)
      proc.line(tick(0))
      const stall = (): void =>
        proc.line({
          type: 'error',
          tNanos: 0,
          kind: 'stall',
          message: 'stalled',
          exception: null,
          stack: [],
          thread: 'OpModeThread'
        })
      if (order === 'stallFirst') {
        stall()
        expect(proc.killed).toBe(false)
        session.command({ type: 'stop' })
      } else {
        session.command({ type: 'stop' })
        expect(proc.killed).toBe(false)
        stall()
      }
      expect(proc.killed).toBe(true)
      await settle()
      expect(of('finished')).toMatchObject([{ reason: 'killed', detail: 'stalled' }])
      expect(of('error')).toMatchObject([{ kind: 'stall' }])
    }
  })

  it('stall 뒤 틱이 다시 오면 stall이 풀린 것이다(STOP은 보통대로)', () => {
    const { proc, session } = setup({ speed: 'max' })
    boot(proc)
    proc.line({
      type: 'error',
      tNanos: 0,
      kind: 'stall',
      message: 's',
      exception: null,
      stack: [],
      thread: 'OpModeThread'
    })
    proc.line(tick(0))
    session.command({ type: 'stop' })
    expect(proc.killed).toBe(false)
    proc.line(tick(1))
    expect(proc.replies().at(-1)?.events).toEqual(['stop'])
  })

  it('finished 없이 끝나면 crashed(stderr 끝부분, JVM 안내 줄은 뺀다)', () => {
    const { proc, of } = setup()
    proc.err('Picked up JAVA_TOOL_OPTIONS: -Dx=1\nNOTE: Picked up JDK_JAVA_OPTIONS: -Dy\n')
    boot(proc)
    proc.err('Exception in thread "main" java.lang.OutOfMemoryError\n\tat Foo.bar(Foo.java:1)')
    proc.exit(1)
    const [finished] = of('finished')
    expect(finished.reason).toBe('crashed')
    expect(finished.detail).toBe(
      'exit code 1\nException in thread "main" java.lang.OutOfMemoryError\n\tat Foo.bar(Foo.java:1)'
    )
  })

  it('JSON이 아닌 줄, 모양이 틀린 메시지, 너무 긴 줄, 잘린 줄 → crashed', async () => {
    const cases: [string, (proc: FakeProcess) => void, string][] = [
      ['garbage', (proc) => proc.raw('not json\n'), 'protocol error: invalid JSON'],
      ['shape', (proc) => proc.line({ type: 'tick', tick: 'x' }), 'protocol error: tick.tick'],
      ['unknown', (proc) => proc.line({ type: 'mystery' }), 'protocol error: unknown message'],
      ['long', (proc) => proc.raw('x'.repeat(MAX_LINE_CHARS + 1)), 'protocol error: line too long'],
      [
        'beforeHello',
        (proc) => proc.line({ type: 'state', tNanos: 0, phase: 'init' }),
        'protocol error: message before hello'
      ],
      [
        'protocol',
        (proc) => proc.line({ type: 'hello', protocol: 2, runtime: 'x', java: '21' }),
        'protocol error: protocol 2'
      ]
    ]
    for (const [, act, detail] of cases) {
      const { proc, of } = setup()
      act(proc)
      expect(proc.killed).toBe(true)
      await settle()
      expect(of('finished')[0].reason).toBe('crashed')
      expect(of('finished')[0].detail.startsWith(detail)).toBe(true)
    }
    const { proc, of } = setup()
    boot(proc)
    proc.raw('{"type":"tick","tick":0')
    proc.exit(0)
    expect(of('finished')[0]).toMatchObject({
      reason: 'crashed',
      detail: 'exit code 0; truncated output'
    })
  })

  it('조각난 줄과 CRLF를 이어 읽는다', () => {
    const { proc, of } = setup()
    const text = JSON.stringify({ type: 'hello', protocol: 1, runtime: 'x', java: '21' })
    proc.raw(text.slice(0, 5))
    proc.raw(`${text.slice(5)}\r\n`)
    expect(of('phase').at(-1)?.phase).toBe('compiling')
  })

  it('hello가 오지 않으면 crashed', async () => {
    const { clock, proc, of } = setup()
    clock.advance(30_000)
    await settle()
    expect(proc.killed).toBe(true)
    expect(of('finished')[0].detail).toMatch(/^protocol error: no hello/)
  })

  it('compiling 중 STOP은 shutdown을 보낸다', () => {
    const { proc, session, of } = setup()
    proc.line({ type: 'hello', protocol: 1, runtime: 'x', java: '21' })
    session.command({ type: 'stop' })
    expect(proc.sent.at(-1)).toEqual({ type: 'shutdown' })
    proc.line({ type: 'finished', tNanos: 0, reason: 'shutdown' })
    expect(of('finished')[0].reason).toBe('shutdown')
  })

  it('dispose: shutdown을 보내고, 답이 없으면 잠깐 뒤 kill(killed shutdownTimeout)', async () => {
    const answered = setup()
    boot(answered.proc)
    const done = answered.session.dispose()
    expect(answered.proc.sent.at(-1)).toEqual({ type: 'shutdown' })
    answered.proc.line({ type: 'finished', tNanos: 0, reason: 'shutdown' })
    answered.proc.exit(0)
    await done
    expect(answered.of('finished')[0].reason).toBe('shutdown')

    const silent = setup()
    boot(silent.proc)
    const waiting = silent.session.dispose()
    silent.clock.advance(999)
    expect(silent.proc.killed).toBe(false)
    silent.clock.advance(1)
    await waiting
    expect(silent.of('finished')[0]).toMatchObject({ reason: 'killed', detail: 'shutdownTimeout' })
  })
})

describe('SidecarSession 이벤트 묶기', () => {
  it('텔레메트리는 최신만, 34 ms에 한 번', () => {
    const { clock, proc, of } = setup()
    boot(proc)
    const frame = (n: number): Record<string, unknown> => ({
      type: 'telemetry',
      tNanos: n,
      frame: { lines: [`n : ${n}`], log: [], format: 'classic' }
    })
    proc.line(frame(1))
    proc.line(frame(2))
    proc.line(frame(3))
    expect(of('telemetry').map((event) => event.tNanos)).toEqual([1])
    clock.advance(33)
    expect(of('telemetry').length).toBe(1)
    clock.advance(1)
    expect(of('telemetry').map((event) => event.tNanos)).toEqual([1, 3])
    clock.advance(100)
    expect(of('telemetry').length).toBe(2)
  })

  it('로그는 50 ms 묶음이고, 오류·단계·끝 전에 먼저 보낸다', () => {
    const { clock, proc, events } = setup()
    proc.line({ type: 'hello', protocol: 1, runtime: 'x', java: '21' })
    const log = (text: string): void => proc.line({ type: 'log', tNanos: 0, stream: 'out', text })
    log('a')
    log('b')
    clock.advance(49)
    expect(events.filter((event) => event.type === 'log')).toEqual([])
    clock.advance(1)
    log('c')
    proc.line({
      type: 'error',
      tNanos: 0,
      kind: 'exception',
      message: 'm',
      exception: null,
      stack: [],
      thread: 't'
    })
    log('d')
    proc.line({ type: 'finished', tNanos: 0, reason: 'exception' })
    const order = events
      .filter((event) => ['log', 'error', 'finished'].includes(event.type))
      .map((event) =>
        event.type === 'log' ? event.entries.map((entry) => entry.text).join('') : event.type
      )
    expect(order).toEqual(['ab', 'c', 'error', 'd', 'finished'])
  })

  it('장치 출력은 20 Hz 이하이고 바뀔 때만', () => {
    const { clock, proc, of } = setup({ speed: 'max' })
    boot(proc)
    proc.line(tick(0, { outputs: { m: { power: 0 } } }))
    proc.line(tick(1, { outputs: { m: { power: 0.1 } } }))
    proc.line(tick(2, { outputs: { m: { power: 0.2 } } }))
    expect(of('devices').map((event) => event.outputs.m.power)).toEqual([0])
    clock.advance(50)
    expect(of('devices').map((event) => event.outputs.m.power)).toEqual([0, 0.2])
    proc.line(tick(3, { outputs: { m: { power: 0.2 } } }))
    clock.advance(100)
    expect(of('devices').length).toBe(2)
  })

  it('status는 10 Hz로 보내되 바뀐 것만, realtime은 최근 1초의 실제 속도', () => {
    const { clock, proc, of } = setup({ speed: 1 })
    boot(proc)
    let k = 0
    proc.line(tick(k++))
    // 사이드카가 실제 시간의 절반 속도밖에 못 낸다: 틱(5 ms)마다 10 ms 걸린다
    for (let i = 0; i < 150; i++) {
      clock.advance(10)
      proc.line(tick(k++))
    }
    const last = of('status').at(-1)!
    expect(last.realtime).toBeGreaterThan(0.45)
    expect(last.realtime).toBeLessThan(0.55)
    const count = of('status').length
    expect(count).toBeGreaterThanOrEqual(15)
    expect(count).toBeLessThanOrEqual(20)
  })

  it('게임패드와 세계(SimWorld)의 입력을 답에 싣는다', () => {
    const seen: number[] = []
    const { proc, session } = setup({
      speed: 'max',
      world: {
        step: (tNanos) => {
          seen.push(tNanos)
          return { imu: { yaw: tNanos / 1e9 } }
        },
        pose: () => null,
        drainNotices: () => []
      }
    })
    boot(proc)
    const pad = {
      left_stick_x: 0.5,
      left_stick_y: -1,
      right_stick_x: 0,
      right_stick_y: 0,
      left_trigger: 0,
      right_trigger: 1,
      dpad_up: false,
      dpad_down: false,
      dpad_left: false,
      dpad_right: false,
      a: true,
      b: false,
      x: false,
      y: false,
      guide: false,
      start: false,
      back: false,
      left_bumper: false,
      right_bumper: false,
      left_stick_button: false,
      right_stick_button: false,
      touchpad: false
    }
    session.setGamepads([pad, null])
    proc.line(tick(2))
    expect(proc.replies()[0]).toEqual({
      type: 'tickReply',
      tick: 2,
      events: [],
      gamepads: [pad, null],
      inputs: { imu: { yaw: 0.01 } }
    })
    expect(seen).toEqual([10 * MS])
  })
})
