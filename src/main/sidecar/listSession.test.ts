import { describe, expect, it } from 'vitest'
import type { ListRequest, RegisteredOpMode } from '../../shared/sidecarProtocol'
import { runListSidecar, type ListOutcome } from './listSession'
import { MAX_REGISTERED_OPMODES, parseSidecarLine, ProtocolError } from './protocol'
import { FakeClock, FakeProcess, settle } from './testkit'

const REQUEST: ListRequest = {
  type: 'list',
  protocol: 3,
  clock: 'virtual',
  tickNanos: 5_000_000,
  sourceRoots: ['/proj/TeamCode/src/main/java'],
  registrars: [
    {
      className: 'org.firstinspires.ftc.teamcode.TuningOpModes',
      source: '/proj/TeamCode/src/main/java/org/firstinspires/ftc/teamcode/TuningOpModes.java'
    }
  ],
  bootClasspath: [],
  compileClasspath: ['/sidecar/sandbot-sdk.jar'],
  libraryClasspath: [],
  firstFolder: '/u/sim-files/abc/FIRST',
  startEpochMillis: 0,
  stallMillis: 2000
}

const OPMODE: RegisteredOpMode = {
  name: 'ForwardRampLogger',
  group: 'quickstart',
  flavor: 'TeleOp',
  className: 'com.acmerobotics.roadrunner.ftc.ForwardRampLogger',
  registrar: 'org.firstinspires.ftc.teamcode.TuningOpModes',
  transitionTarget: ''
}

function start(): { clock: FakeClock; proc: FakeProcess; result: Promise<ListOutcome> } {
  const clock = new FakeClock()
  const proc = new FakeProcess()
  const result = runListSidecar(proc, REQUEST, { clock })
  return { clock, proc, result }
}

function hello(proc: FakeProcess): void {
  proc.line({ type: 'hello', protocol: 3, runtime: 'test', java: '21' })
}

const registrarError = {
  type: 'error',
  tNanos: 0,
  kind: 'registrar',
  message:
    'The @OpModeRegistrar method org.firstinspires.ftc.teamcode.Broken.register threw IllegalStateException: x',
  exception: 'java.lang.IllegalStateException',
  stack: [],
  thread: 'OpModeThread'
} as const

describe('runListSidecar', () => {
  it('요청을 보내고 registered → finished listed를 결과로 준다(로그·링크 검사는 버린다, 프로세스가 끝난 뒤)', async () => {
    const { proc, result } = start()
    expect(proc.sent).toEqual([REQUEST])
    hello(proc)
    proc.line({ type: 'linkReport', warnings: [] })
    proc.line({ type: 'compiled', ok: true, diagnostics: [], millis: 3 })
    proc.line({ type: 'log', tNanos: 0, stream: 'robotLog', text: 'W/RegisteredOpModes: dup' })
    proc.line(registrarError)
    proc.line({ type: 'registered', opModes: [OPMODE] })
    proc.line({ type: 'finished', tNanos: 0, reason: 'listed' })
    let settled = false
    void result.then(() => (settled = true))
    await settle()
    expect(settled).toBe(false)
    proc.exit(0)
    expect(await result).toEqual({ kind: 'listed', opModes: [OPMODE], errors: [registrarError] })
  })

  it('컴파일 오류는 compileFailed와 진단', async () => {
    const { proc, result } = start()
    hello(proc)
    const diagnostic = {
      kind: 'error',
      file: REQUEST.registrars[0].source,
      line: 3,
      column: 9,
      message: "';' expected",
      code: 'compiler.err.expected'
    } as const
    proc.line({ type: 'compiled', ok: false, diagnostics: [diagnostic], millis: 3 })
    proc.line({ type: 'finished', tNanos: 0, reason: 'compileFailed' })
    proc.exit(0)
    expect(await result).toEqual({ kind: 'compileFailed', diagnostics: [diagnostic] })
  })

  it('javac가 없어 compiled 없이 끝난 것, 등록기의 System.exit·멈춤은 failed(오류 문장)', async () => {
    for (const [reason, message] of [
      ['compileFailed', 'no Java compiler'],
      ['exception', 'An @OpModeRegistrar method has not used the simulator clock for 2000 ms'],
      ['terminated', '']
    ] as const) {
      const { proc, result } = start()
      hello(proc)
      if (message)
        proc.line({
          type: 'error',
          tNanos: 0,
          kind: reason === 'exception' ? 'stall' : 'internal',
          message,
          exception: null,
          stack: [],
          thread: 'OpModeThread'
        })
      proc.line({ type: 'finished', tNanos: 0, reason })
      proc.exit(0)
      expect(await result).toEqual({ kind: 'failed', detail: message || reason })
    }
  })

  it('finished listed인데 registered가 없거나, 목록에 없는 메시지(tick)·두 번째 registered는 failed', async () => {
    {
      const { proc, result } = start()
      hello(proc)
      proc.line({ type: 'finished', tNanos: 0, reason: 'listed' })
      proc.exit(0)
      expect(await result).toEqual({ kind: 'failed', detail: 'no registered message' })
    }
    for (const bad of [
      { type: 'tick', tick: 0, tNanos: 0, phase: 'init', loops: 0, outputs: {} },
      { type: 'registered', opModes: [] }
    ]) {
      const { proc, result } = start()
      hello(proc)
      proc.line({ type: 'registered', opModes: [] })
      proc.line(bad)
      expect(proc.killed).toBe(true)
      await settle()
      const outcome = await result
      expect(outcome.kind).toBe('failed')
      if (outcome.kind === 'failed') expect(outcome.detail).toMatch(/^protocol error: /)
    }
  })

  it('hello 전 메시지·다른 프로토콜·JSON이 아닌 줄은 프로토콜 오류로 끝낸다(stderr 끝을 붙인다)', async () => {
    const cases: [string, RegExp][] = [
      [JSON.stringify({ type: 'compiled', ok: true, diagnostics: [], millis: 1 }), /before hello/],
      [JSON.stringify({ type: 'hello', protocol: 2, runtime: 't', java: '21' }), /protocol 2/],
      ['not json', /invalid JSON/]
    ]
    for (const [line, expected] of cases) {
      const { proc, result } = start()
      proc.err('boom on stderr\n')
      proc.raw(`${line}\n`)
      await settle()
      const outcome = await result
      expect(outcome.kind).toBe('failed')
      if (outcome.kind === 'failed') {
        expect(outcome.detail).toMatch(expected)
        expect(outcome.detail).toContain('boom on stderr')
      }
    }
  })

  it('hello가 늦거나 전체 시간을 넘으면 JVM을 끝내고 failed, finished 없이 끝난 프로세스도 failed', async () => {
    {
      const { clock, proc, result } = start()
      clock.advance(30_000)
      expect(proc.killed).toBe(true)
      await settle()
      expect(await result).toEqual({ kind: 'failed', detail: 'no hello from the sidecar' })
    }
    {
      const { clock, proc, result } = start()
      hello(proc)
      proc.line({ type: 'compiled', ok: true, diagnostics: [], millis: 3 })
      clock.advance(119_999)
      expect(proc.killed).toBe(false)
      clock.advance(1)
      expect(proc.killed).toBe(true)
      await settle()
      expect(await result).toEqual({ kind: 'failed', detail: 'listing did not finish in 120 s' })
    }
    {
      const { proc, result } = start()
      hello(proc)
      proc.raw('{"type":"regis')
      proc.exit(1)
      expect(await result).toEqual({ kind: 'failed', detail: 'exit code 1; truncated output' })
    }
  })

  it('finished 뒤 스스로 끝나지 않는 프로세스는 잠시 뒤 끝내고, 결과는 finished로 정한다', async () => {
    const clock = new FakeClock()
    const proc = new FakeProcess()
    const result = runListSidecar(proc, REQUEST, { clock, timeouts: { exitAfterFinishedMs: 50 } })
    hello(proc)
    proc.line({ type: 'registered', opModes: [OPMODE] })
    proc.line({ type: 'finished', tNanos: 0, reason: 'listed' })
    clock.advance(50)
    expect(proc.killed).toBe(true)
    await settle()
    expect(await result).toEqual({ kind: 'listed', opModes: [OPMODE], errors: [] })
    expect(clock.pendingTimers).toBe(0)
  })
})

describe('parseSidecarLine registered', () => {
  const line = (opModes: unknown): string => JSON.stringify({ type: 'registered', opModes })

  it('모양을 확인해 읽는다', () => {
    expect(parseSidecarLine(line([OPMODE, { ...OPMODE, flavor: 'Utility', group: '' }]))).toEqual({
      type: 'registered',
      opModes: [OPMODE, { ...OPMODE, flavor: 'Utility', group: '' }]
    })
    // group·transitionTarget의 제어 문자는 받는다(실행할 이름만 실행 요청 규칙을 따른다)
    expect(parseSidecarLine(line([{ ...OPMODE, group: 'a\tb' }]))).toMatchObject({
      opModes: [{ group: 'a\tb' }]
    })
  })

  it('이름·group·flavor·클래스 이름·개수 한도를 넘거나 틀리면 프로토콜 오류', () => {
    const bad: unknown[] = [
      { ...OPMODE, name: '' },
      { ...OPMODE, name: 'x'.repeat(201) },
      { ...OPMODE, name: 'a\nb' },
      { ...OPMODE, group: 'g'.repeat(201) },
      { ...OPMODE, transitionTarget: 't'.repeat(201) },
      { ...OPMODE, flavor: 'teleop' },
      { ...OPMODE, className: 'c'.repeat(1025) },
      { ...OPMODE, registrar: '' },
      { ...OPMODE, transitionTarget: null },
      'not an object'
    ]
    for (const opMode of bad) expect(() => parseSidecarLine(line([opMode]))).toThrow(ProtocolError)
    expect(() => parseSidecarLine(JSON.stringify({ type: 'registered' }))).toThrow(ProtocolError)
    const many = Array.from({ length: MAX_REGISTERED_OPMODES + 1 }, (_, i) => ({
      ...OPMODE,
      name: `op${i}`
    }))
    expect(() => parseSidecarLine(line(many))).toThrow(ProtocolError)
    expect(() => parseSidecarLine(line(many.slice(1)))).not.toThrow()
  })

  it('오류 kind registrar와 끝 이유 listed를 받는다', () => {
    expect(parseSidecarLine(JSON.stringify(registrarError))).toMatchObject({ kind: 'registrar' })
    expect(
      parseSidecarLine(JSON.stringify({ type: 'finished', tNanos: 0, reason: 'listed' }))
    ).toEqual({ type: 'finished', tNanos: 0, reason: 'listed' })
  })
})
