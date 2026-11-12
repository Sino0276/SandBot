// 사이드카 런타임 테스트: 진짜 JVM 사이드카를 띄우고 테스트가 호스트 역할(틱마다 바로 답, 지정한 틱에 START·STOP)을 한다.
// 테스트 OpMode는 sidecar/tests/opmodes/(package org.firstinspires.ftc.teamcode)에 있고, 결과를 "RESULT 이름=값" 줄로 쓴다.
// Java 단위 테스트(패처·JSON·가상 시계 등)는 sidecar/tests/java/org/sandbot/runtime/에 있다. JDK가 없으면 모두 건너뛴다.
import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type DeviceValues,
  type DsEvent,
  type ErrorMessage,
  type GamepadState,
  type HostMessage,
  type RunRequest,
  type SidecarMessage,
  type TelemetryMessage
} from '../../src/shared/sidecarProtocol'
import { MAX_LINE_CHARS } from '../../src/main/sidecar/protocol'
import { ensureFtcSamples, FetchError } from '../../scripts/fetch-ftc-sdk.mjs'
import {
  compileJavaTests,
  runJavaTests,
  sidecarBuild,
  testTempDir,
  type SidecarBuild
} from './support'

const OPMODES = resolve(__dirname, 'opmodes')
const PACKAGE = 'org.firstinspires.ftc.teamcode'
const TIMEOUT = 10 * 60 * 1000
// HardwareMap의 OpMode 수명 리스너가 onOpModePreInit에서 쓰는 디버그 줄(RobotLog.dd)
const HARDWARE_MAP_PRE_INIT = 'D/HardwareMap: Clearing which device instances have been retrieved'

const build = await sidecarBuild()

type Script = {
  // sidecar/tests/opmodes/org/firstinspires/ftc/teamcode/<opMode>.java
  opMode: string
  // 그 틱의 tickReply에 실을 DS 사건
  events?: Record<number, DsEvent[]>
  gamepads?: (tick: number) => [GamepadState | null, GamepadState | null]
  // 그 틱의 tickReply에 실을 장치 입력(없으면 {})
  inputs?: (tick: number) => Record<string, DeviceValues>
  request?: Partial<RunRequest>
  // 메시지를 받을 때마다. true를 돌려주면 shutdown을 보낸다(틱이면 답하지 않고).
  shutdownWhen?: (message: SidecarMessage) => boolean
}

type RunResult = {
  messages: SidecarMessage[]
  // stdout의 줄 그대로(JSON이 아닌 줄이 없어야 한다)
  raw: string[]
  stderr: string
  exitCode: number | null
  // state init을 받은 때부터 finished를 받은 때까지의 실제 밀리초
  realMillisAfterInit: number
}

function runRequest(b: SidecarBuild, script: Script): RunRequest {
  return {
    type: 'run',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots: [OPMODES],
    opModeSource: join(OPMODES, ...PACKAGE.split('.'), `${script.opMode}.java`),
    opModeClass: `${PACKAGE}.${script.opMode}`,
    registeredName: null,
    registrars: [],
    firstFolder: testTempDir('first'),
    bootClasspath: [],
    compileClasspath: [b.sdkJar],
    libraryClasspath: [],
    configXml: null,
    timing: {},
    jitter: 0,
    seed: 0,
    startEpochMillis: 1_700_000_000_000,
    stallMillis: 2000,
    teamCalibrations: null,
    ...script.request
  }
}

function runSidecar(b: SidecarBuild, script: Script): Promise<RunResult> {
  return new Promise((done, fail) => {
    const child = spawn(
      b.java,
      [
        // 호스트(src/main/sidecar/launch.ts의 javaArgs)와 같은 인자
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
        [b.runtimeJar, b.sdkJar].join(delimiter),
        'org.sandbot.runtime.Main'
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const messages: SidecarMessage[] = []
    const raw: string[] = []
    let stderr = ''
    let pending = ''
    let initAt = 0
    let finishedAt = 0
    let finished = false
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out; last messages: ${raw.slice(-5).join('\n')}\n${stderr}`))
    }, 120_000)
    const onLine = (line: string): void => {
      raw.push(line)
      let message: SidecarMessage
      try {
        message = JSON.parse(line) as SidecarMessage
      } catch {
        return
      }
      messages.push(message)
      if (message.type === 'state' && message.phase === 'init' && initAt === 0) initAt = Date.now()
      if (message.type === 'finished') {
        finished = true
        finishedAt = Date.now()
      }
      if (finished) return
      if (script.shutdownWhen?.(message)) {
        send({ type: 'shutdown' })
        return
      }
      if (message.type === 'tick') {
        send({
          type: 'tickReply',
          tick: message.tick,
          events: script.events?.[message.tick] ?? [],
          gamepads: script.gamepads?.(message.tick) ?? [null, null],
          inputs: script.inputs?.(message.tick) ?? {},
          configSet: []
        })
      }
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        onLine(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', fail)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      done({
        messages,
        raw,
        stderr,
        exitCode: code,
        realMillisAfterInit: initAt && finishedAt ? finishedAt - initAt : -1
      })
    })
    send(runRequest(b, script))
  })
}

/** "RESULT a=1 b=2" 줄들 → { a: '1', b: '2' } */
function results(run: RunResult): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of run.messages) {
    if (m.type !== 'log' || m.stream !== 'out' || !m.text.startsWith('RESULT ')) continue
    for (const pair of m.text.slice('RESULT '.length).split(' ')) {
      const eq = pair.indexOf('=')
      if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
  }
  return out
}

function finishedReason(run: RunResult): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

function errors(run: RunResult): ErrorMessage[] {
  return run.messages.filter((m): m is ErrorMessage => m.type === 'error')
}

/** Control Hub 하나에 장치 줄(구성 XML 태그)을 붙인 구성 파일 */
function writeConfig(devices: string[]): string {
  const configXml = join(mkdtempSync(join(tmpdir(), 'sandbot-runtime-')), 'robot.xml')
  writeFileSync(
    configXml,
    [
      '<Robot type="FirstInspires-FTC" name="Test Bot">',
      '    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">',
      '        <LynxModule name="Control Hub" port="173">',
      ...devices.map((device) => `            ${device}`),
      '        </LynxModule>',
      '    </LynxUsbDevice>',
      '</Robot>',
      ''
    ].join('\n')
  )
  return configXml
}

type Tick = Extract<SidecarMessage, { type: 'tick' }>

function ticks(run: RunResult): Tick[] {
  return run.messages.flatMap((m) => (m.type === 'tick' ? [m] : []))
}

function states(run: RunResult): string[] {
  return run.messages.flatMap((m) => (m.type === 'state' ? [m.phase] : []))
}

/** 결정성 비교용: 실행마다 다른 값(JVM 버전, 컴파일 시간)만 뺀 메시지 줄 */
function normalized(run: RunResult): string[] {
  return run.raw.map((line) => {
    const m = JSON.parse(line) as SidecarMessage
    if (m.type === 'hello') return JSON.stringify({ ...m, java: '' })
    if (m.type === 'compiled') return JSON.stringify({ ...m, millis: 0 })
    return line
  })
}

const pad = (overrides: Partial<GamepadState>): GamepadState => ({
  left_stick_x: 0,
  left_stick_y: 0,
  right_stick_x: 0,
  right_stick_y: 0,
  left_trigger: 0,
  right_trigger: 0,
  dpad_up: false,
  dpad_down: false,
  dpad_left: false,
  dpad_right: false,
  a: false,
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
  touchpad: false,
  ...overrides
})

describe.skipIf(build === null)('사이드카 런타임', () => {
  const b = build as SidecarBuild

  it(
    'hello가 첫 줄이고 stdout은 모두 JSON이며, 틱은 0부터 차례로 tick × tickNanos에 온다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'WaitForStartLinear',
        events: { 10: ['start'], 30: ['stop'] }
      })
      expect(run.raw.length).toBe(run.messages.length)
      expect(run.messages[0]).toMatchObject({ type: 'hello', protocol: SIDECAR_PROTOCOL_VERSION })
      expect(run.messages[1]).toMatchObject({ type: 'compiled', ok: true })
      expect(run.messages[2]).toMatchObject({ type: 'state', phase: 'init', tNanos: 0 })
      const ticks = run.messages.flatMap((m) => (m.type === 'tick' ? [m] : []))
      ticks.forEach((t, i) => {
        expect(t.tick).toBe(i)
        expect(t.tNanos).toBe(i * DEFAULT_TICK_NANOS)
        if (i > 0) expect(t.loops).toBeGreaterThanOrEqual(ticks[i - 1].loops)
      })
      expect(ticks[ticks.length - 1].phase).toBe('stopping')
      expect(states(run)).toEqual(['init', 'running', 'stopping'])
      expect(finishedReason(run)).toBe('stopped')
      expect(run.exitCode).toBe(0)
    },
    TIMEOUT
  )

  it(
    '팀 코드의 시간 API는 모두 가상 시계다(실제 시간은 훨씬 짧다)',
    async () => {
      const run = await runSidecar(b, { opMode: 'TimeApis' })
      expect(errors(run)).toEqual([])
      const r = results(run)
      expect(r).toMatchObject({
        linearSleep: '1000',
        threadSleep: '250',
        threadSleepNanos: '20',
        elapsedTime: '300',
        objectWait: '100',
        objectWaitNanos: '31',
        timeUnitSleep: '70',
        parkNanos: '60',
        instantNow: '80',
        methodRef: '15',
        lambda: '35',
        subclassSleep: '45',
        runtime: '500',
        joinNotStarted: 'ok'
      })
      expect(['40', '41']).toContain(r.currentTimeMillis)
      expect(['89', '90']).toContain(r.parkUntil)
      const finished = run.messages[run.messages.length - 1]
      expect(finished).toMatchObject({ type: 'finished', reason: 'returned' })
      const virtualMillis = (finished as { tNanos: number }).tNanos / 1e6
      expect(virtualMillis).toBeGreaterThan(2600)
      expect(run.realMillisAfterInit).toBeLessThan(virtualMillis / 3)
    },
    TIMEOUT
  )

  it(
    'waitForStart는 START 사건까지 기다리고 opModeIsActive는 STOP 뒤 false다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'WaitForStartLinear',
        events: { 100: ['start'], 300: ['stop'] }
      })
      const r = results(run)
      expect(r.init).toBe('0')
      // START는 틱 100(500 ms) 경계에서 적용된다
      expect(Number(r.started)).toBeGreaterThanOrEqual(500)
      expect(Number(r.started)).toBeLessThan(510)
      expect(r.active).toBe('false')
      expect(Number(r.stopped)).toBeGreaterThanOrEqual(1500)
      expect(Number(r.stopped)).toBeLessThan(1520)
      expect(Number(r.loops)).toBeGreaterThan(90)
      expect(r.stopRequested).toBe('true')
      expect(finishedReason(run)).toBe('stopped')
    },
    TIMEOUT
  )

  it(
    '반복 OpMode는 init → init_loop → start → loop → stop 순서이고 루프 사이에 sleep(1)이 있다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'IterativeOrder',
        events: { 20: ['start'], 60: ['stop'] }
      })
      const r = results(run)
      // order는 공백이 있는 값이라 로그 줄 전체로 확인한다
      const orderLine = run.messages.find(
        (m) => m.type === 'log' && m.text.startsWith('RESULT order=')
      )
      expect(orderLine).toMatchObject({ text: 'RESULT order=init init_loop start loop stop' })
      expect(r['initLoops>0']).toBe('true')
      expect(r['loops>1']).toBe('true')
      expect(r.minGapAtLeast1ms).toBe('true')
      expect(finishedReason(run)).toBe('stopped')
    },
    TIMEOUT
  )

  it(
    '텔레메트리는 250 ms(가상)마다 보내고 줄은 DS 화면 모양이다',
    async () => {
      const run = await runSidecar(b, { opMode: 'TelemetryRate' })
      const frames = run.messages.filter((m): m is TelemetryMessage => m.type === 'telemetry')
      expect(frames.length).toBeGreaterThan(5)
      for (let i = 1; i < frames.length - 1; i++) {
        expect(frames[i].tNanos - frames[i - 1].tNanos).toBeGreaterThanOrEqual(250_000_000)
      }
      expect(frames[1].frame.lines).toEqual([
        expect.stringMatching(/^count : \d+$/),
        'pi : 3.14',
        'ratio : 0.125',
        'pose x : 1 | y : 2'
      ])
      expect(frames[1].frame.log).toEqual(['log line 1'])
      expect(frames[1].frame.format).toBe('classic')
      // 끝날 때 보내지 못한 마지막 update를 보낸다(실제 OpModeInternal의 finally)
      const last = frames[frames.length - 1]
      expect(last.frame.lines).toEqual(['done : true'])
      expect(last.frame.format).toBe('monospace')
      expect(finishedReason(run)).toBe('returned')
    },
    TIMEOUT
  )

  it(
    '팀 코드 예외는 error exception(팀 소스 경로가 있는 스택) 뒤 finished exception',
    async () => {
      const run = await runSidecar(b, { opMode: 'ThrowsException' })
      const [error] = errors(run)
      expect(error).toMatchObject({
        kind: 'exception',
        exception: 'java.lang.IllegalStateException',
        message: 'IllegalStateException: broken arm 3',
        thread: 'OpModeThread'
      })
      expect(error.stack[0]).toMatchObject({
        className: `${PACKAGE}.ThrowsException`,
        method: 'helper',
        file: 'ThrowsException.java',
        source: join(OPMODES, 'org/firstinspires/ftc/teamcode/ThrowsException.java')
      })
      expect(error.stack[0].line).toBe(16)
      expect(error.stack.some((f) => f.className.startsWith('org.sandbot.runtime'))).toBe(false)
      expect(finishedReason(run)).toBe('exception')
    },
    TIMEOUT
  )

  it(
    '지원하지 않는 SDK API는 error unsupported',
    async () => {
      const run = await runSidecar(b, { opMode: 'UnsupportedApi' })
      const [error] = errors(run)
      expect(error.kind).toBe('unsupported')
      expect(error.message).toContain('com.qualcomm.robotcore.util.RobotLog#getLogFilename()')
      expect(error.exception).toBe('org.sandbot.sim.SimUnsupportedException')
      expect(finishedReason(run)).toBe('exception')
    },
    TIMEOUT
  )

  it(
    'SDK를 부르지 않는 무한 루프는 error stall(그 스레드의 스택)을 보내고 shutdown으로 끝난다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'InfiniteLoop',
        events: { 2: ['start'] },
        request: { stallMillis: 500 },
        shutdownWhen: (m) => m.type === 'error' && m.kind === 'stall'
      })
      const stall = errors(run).find((e) => e.kind === 'stall')
      expect(stall).toBeDefined()
      expect(stall!.thread).toBe('OpModeThread')
      expect(stall!.stack.some((f) => f.method === 'spin' && f.source !== null)).toBe(true)
      expect(finishedReason(run)).toBe('shutdown')
    },
    TIMEOUT
  )

  it(
    '다른 스레드가 가상 시계를 쓰면 error thread 뒤 finished exception',
    async () => {
      const run = await runSidecar(b, { opMode: 'OtherThreadSleep' })
      const [error] = errors(run)
      expect(error).toMatchObject({ kind: 'thread', thread: 'Worker' })
      expect(error.stack[0]).toMatchObject({
        className: expect.stringContaining('OtherThreadSleep')
      })
      expect(finishedReason(run)).toBe('exception')
    },
    TIMEOUT
  )

  it(
    'System.exit는 JVM을 끝내지 않고 finished terminated',
    async () => {
      const run = await runSidecar(b, { opMode: 'CallsExit' })
      expect(results(run)).toEqual({})
      expect(errors(run)).toEqual([])
      expect(finishedReason(run)).toBe('terminated')
    },
    TIMEOUT
  )

  it(
    'terminateOpModeNow는 finished terminated',
    async () => {
      const run = await runSidecar(b, { opMode: 'Terminates', events: { 2: ['start'] } })
      expect(errors(run)).toEqual([])
      expect(finishedReason(run)).toBe('terminated')
    },
    TIMEOUT
  )

  it(
    'STOP 뒤 900 ms(가상) 안에 끝나지 않으면 error stuckInStop 뒤 finished stuck',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'StuckInStop',
        events: { 2: ['start'], 50: ['stop'] }
      })
      const [error] = errors(run)
      expect(error.kind).toBe('stuckInStop')
      const finished = run.messages[run.messages.length - 1] as { tNanos: number; reason: string }
      expect(finished.reason).toBe('stuck')
      expect(finished.tNanos).toBeGreaterThanOrEqual(50 * DEFAULT_TICK_NANOS + 900_000_000)
    },
    TIMEOUT
  )

  it(
    'START 전에 runOpMode가 돌아오면 finished returned와 waitForStart 경고',
    async () => {
      const run = await runSidecar(b, { opMode: 'ReturnsEarly' })
      expect(finishedReason(run)).toBe('returned')
      expect(
        run.messages.some(
          (m) =>
            m.type === 'log' &&
            m.stream === 'robotLog' &&
            m.text.startsWith(
              'W/GlobalWarning: The OpMode which was just initialized ended prematurely'
            )
        )
      ).toBe(true)
      expect(
        run.messages.some((m) => m.type === 'telemetry' && m.frame.lines[0] === 'status : done')
      ).toBe(true)
    },
    TIMEOUT
  )

  it(
    '반복 OpMode의 requestOpModeStop은 stop()까지 돈 뒤 finished returned',
    async () => {
      const run = await runSidecar(b, { opMode: 'RequestsStop', events: { 2: ['start'] } })
      expect(results(run)).toMatchObject({ stopCalled: 'true', loopsAtLeast5: 'true' })
      expect(states(run)).toEqual(['init', 'running', 'stopping'])
      expect(finishedReason(run)).toBe('returned')
    },
    TIMEOUT
  )

  it(
    'OpMode 정적 초기화는 OpMode 스레드에서 돌고, 그 예외는 원인으로 알린다',
    async () => {
      const run = await runSidecar(b, { opMode: 'ConstructorThrows' })
      expect(results(run)).toMatchObject({ staticInitThread: 'OpModeThread' })
      const [error] = errors(run)
      expect(error).toMatchObject({
        kind: 'exception',
        exception: 'java.lang.IllegalArgumentException',
        message: 'IllegalArgumentException: bad table'
      })
      expect(error.stack[0]).toMatchObject({ method: 'build', line: 14 })
      expect(finishedReason(run)).toBe('exception')
    },
    TIMEOUT
  )

  it(
    '가상 1초에 500줄을 넘는 출력은 버리고 한 번 알리며, 줄바꿈 없는 끝도 보낸다',
    async () => {
      const run = await runSidecar(b, { opMode: 'Spammer' })
      const logs = run.messages.flatMap((m) => (m.type === 'log' ? [m] : []))
      // INIT의 수명 알림(onOpModePreInit)에서 hardwareMap 리스너가 실제 SDK처럼 디버그 줄 하나를 쓴다(같은 한도를 쓴다)
      expect(logs[0]).toMatchObject({ stream: 'robotLog', text: HARDWARE_MAP_PRE_INIT })
      const lines = logs.filter((m) => m.text.startsWith('line '))
      expect(lines.length).toBe(499)
      expect(lines[498].text).toBe('line 498')
      const rest = logs.slice(logs.indexOf(lines[498]) + 1).map((m) => [m.stream, m.text])
      expect(rest.slice(0, 2)).toEqual([
        ['out', '\u2026 1501 lines dropped'],
        ['out', 'after']
      ])
      expect(rest).toContainEqual(['err', 'err'])
      expect(rest).toContainEqual(['out', 'partial'])
      // 알림은 다음 출력("after", 가상 1.1초)을 기다리지 않고 그 구간이 끝난 틱(가상 1초)에 온다
      const notice = logs.find((m) => m.text.endsWith('lines dropped'))
      expect(notice?.tNanos).toBe(1_000_000_000)
    },
    TIMEOUT
  )

  it(
    '컴파일 오류는 진단(파일·줄·열)과 finished compileFailed',
    async () => {
      const run = await runSidecar(b, { opMode: 'CompileError' })
      const compiled = run.messages.find((m) => m.type === 'compiled')
      expect(compiled).toMatchObject({ ok: false })
      const diagnostics = compiled!.type === 'compiled' ? compiled!.diagnostics : []
      expect(diagnostics[0]).toMatchObject({
        kind: 'error',
        file: join(OPMODES, 'org/firstinspires/ftc/teamcode/CompileError.java'),
        line: 11,
        column: 17,
        code: 'compiler.err.cant.resolve.location'
      })
      expect(diagnostics[0].message).toContain('cannot find symbol')
      expect(finishedReason(run)).toBe('compileFailed')
      expect(run.messages.some((m) => m.type === 'state')).toBe(false)
    },
    TIMEOUT
  )

  it(
    'STOP을 받으면 OpMode에 알리기 전에 허브가 fail safe로 가고, 그 뒤의 0이 아닌 power는 보내지 않는다',
    async () => {
      const configXml = writeConfig(['<goBILDA5202SeriesMotor name="drive" port="0" />'])
      const run = await runSidecar(b, {
        opMode: 'StopFailSafe',
        events: { 2: ['start'], 40: ['stop'] },
        request: { configXml }
      })
      expect(errors(run)).toEqual([])
      const ticks = run.messages.flatMap((m) => (m.type === 'tick' ? [m] : []))
      // 허브에 간 power(goBILDA 모터의 기본 방향과 15비트 양자화가 들어간 값)
      const power = (t: (typeof ticks)[number]): number => Number(t.outputs.drive?.power)
      expect(
        ticks.filter((t) => t.phase === 'running').some((t) => Math.abs(power(t)) > 0.49)
      ).toBe(true)
      const stopping = ticks.filter((t) => t.phase === 'stopping')
      // OpMode가 STOP 뒤 가상 100 ms 동안 0.8을 보내려 해도 허브에는 가지 않는다
      expect(stopping.length).toBeGreaterThan(10)
      expect(stopping.every((t) => power(t) === 0)).toBe(true)
      expect(finishedReason(run)).toBe('stopped')
    },
    TIMEOUT
  )

  // 허브 fail safe는 모터를 멈추고 끌 뿐 모드·목표 위치를 지우지 않는다(펌웨어 추론, SimDcMotorController의
  // Channel.targetPositionSet). 그래서 STOP 뒤의 setPower(0)이 모터를 다시 켜도 TargetPositionNotSetException이 나지 않는다
  // (실제 로봇과 같다).
  const STOP_TICK = 40
  for (const opMode of ['StopRunToPosition', 'StopRunToPositionIterative']) {
    it(
      `${opMode}: RUN_TO_POSITION 모터에 STOP 뒤 setPower(0)을 해도 fail safe가 목표 위치를 지켜 오류 없이 끝난다`,
      async () => {
        const script: Script = {
          opMode,
          events: { 2: ['start'], [STOP_TICK]: ['stop'] },
          request: { configXml: writeConfig(['<goBILDA5202SeriesMotor name="drive" port="0" />']) }
        }
        const run = await runSidecar(b, script)
        expect(errors(run), run.stderr).toEqual([])
        expect(finishedReason(run)).toBe('stopped')
        const all = ticks(run)
        const drive = (t: Tick): DeviceValues => t.outputs.drive ?? {}
        // START 뒤 RUN_TO_POSITION으로 돈다(goBILDA FORWARD는 허브 목표가 반대 부호)
        const running = all.filter((t) => t.phase === 'running' && t.tick < STOP_TICK)
        expect(
          running.some((t) => drive(t).enabled === true && Number(drive(t).power) > 0.49)
        ).toBe(true)
        expect(running.every((t) => drive(t).mode === 'RUN_TO_POSITION')).toBe(true)
        // STOP 뒤: power는 0이고 목표 위치·모드는 fail safe 뒤에도 그대로다
        const after = all.filter((t) => t.tick > STOP_TICK)
        expect(after.length).toBeGreaterThan(0)
        for (const t of after) {
          expect(drive(t)).toMatchObject({
            power: 0,
            targetPosition: -1000,
            mode: 'RUN_TO_POSITION'
          })
        }
        // STOP 뒤 하드웨어를 써도 같은 입력이면 바이트 단위로 같은 메시지
        const again = await runSidecar(b, script)
        expect(normalized(again)).toEqual(normalized(run))
      },
      TIMEOUT
    )
  }

  // STOP은 LinearOpMode 스레드를 끊는다. 실제 Lynx 명령은 보내기 전에 MessageKeyedLock.acquire(lockInterruptibly)를
  // 거치므로 끊긴 스레드의 명령은 허브에 가지 않고 읽기는 자리값이다(SimHub.acquireNetworkLock).
  it(
    'STOP으로 끊긴 LinearOpMode 스레드의 하드웨어 호출은 자리값이고, 팀 코드가 끊김을 지우면 다시 허브에 간다',
    async () => {
      const script: Script = {
        opMode: 'StopInterruptedHardware',
        events: { 2: ['start'], [STOP_TICK]: ['stop'] },
        request: { configXml: writeConfig(['<TetrixMotor name="drive" port="0" />']) }
      }
      const run = await runSidecar(b, script)
      expect(errors(run), run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('stopped')
      expect(results(run)).toEqual({
        interrupted: 'true',
        // 모드 캐시는 fail safe가 잊었고 모드 읽기의 자리값은 RUN_WITHOUT_ENCODER라 at-target을 묻지 않는다
        busyInterrupted: 'false',
        stillInterrupted: 'true',
        // 엔코더 입력이 없어 목표 1000에 닿지 않았다
        busyCleared: 'true'
      })
      // 끊긴 스레드의 setPower(0)은 모터를 다시 켜지 않는다
      for (const t of ticks(run).filter((t) => t.tick > STOP_TICK)) {
        expect(t.outputs.drive).toMatchObject({ power: 0, enabled: false })
      }
      const again = await runSidecar(b, script)
      expect(normalized(again)).toEqual(normalized(run))
    },
    TIMEOUT
  )

  // Lynx 컨트롤러 밖의 허브 트랜잭션(LynxModule ADC, I2C 장치)도 같다: 실제 LynxI2cDeviceSynch는 모두 0인 가짜 데이터를 주고
  // "placeholder: readTimestamped"를 한 번 남기며, 옮긴 실제 드라이버가 그 0을 해석한다.
  it(
    'STOP으로 끊긴 스레드의 엔코더·IMU·I2C 거리 센서·허브 전압 읽기는 실제 자리값이고 목표 위치 쓰기는 허브에 가지 않는다',
    async () => {
      // VL53L0X 초기화(hardwareMap.get, I2C 트랜잭션 100여 번)가 가상 수백 ms라 그 뒤에 START·STOP한다(초기화 도중의 STOP은
      // 그다음 명령을 모두 끊는다)
      const start = 150
      const stop = 180
      const script: Script = {
        opMode: 'StopInterruptedSensors',
        events: { [start]: ['start'], [stop]: ['stop'] },
        // 진짜 값이 자리값과 다르게: 엔코더 321틱, 요 30°, 거리 0.5 m
        inputs: (tick): Record<string, DeviceValues> =>
          tick === 1
            ? { drive: { position: 321 }, imu: { yaw: Math.PI / 6 }, distance: { distance: 0.5 } }
            : {},
        request: {
          configXml: writeConfig([
            '<TetrixMotor name="drive" port="0" />',
            '<ControlHubImuBHI260AP name="imu" port="0" bus="0" />',
            '<REV_VL53L0X_RANGE_SENSOR name="distance" port="0" bus="1" />'
          ])
        }
      }
      const run = await runSidecar(b, script)
      expect(errors(run), run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('stopped')
      expect(results(run)).toEqual({
        interrupted: 'true',
        position: '0',
        yaw: '0.0',
        distanceMm: '65535.0',
        volts: '0.0',
        stillInterrupted: 'true',
        positionCleared: '321',
        yawCleared: '30',
        voltsCleared: '12.5'
      })
      const robotLogs = run.messages.flatMap((m) =>
        m.type === 'log' && m.stream === 'robotLog' ? [m.text] : []
      )
      // I2C 클라이언트(IMU·거리 센서)마다 한 번, IMU 도우미의 경고
      expect(
        robotLogs.filter((t) => t === 'E/LynxI2cDeviceSynch: placeholder: readTimestamped')
      ).toHaveLength(2)
      expect(robotLogs).toContain(
        'W/BHI260IMU: getRobotOrientationAsQuaternion(): Failed to retrieve valid quaternion from IMU. Returning the identity quaternion.'
      )
      const all = ticks(run)
      // 초기화가 START 전에 끝나 RUN_TO_POSITION으로 돌았다
      expect(
        all.some(
          (t) =>
            t.tick < stop &&
            t.outputs.drive?.mode === 'RUN_TO_POSITION' &&
            Number(t.outputs.drive?.power) > 0.49
        )
      ).toBe(true)
      // STOP 뒤: 모터는 꺼진 채이고 목표 위치는 그대로다(끊긴 스레드의 setTargetPosition은 가지 않았다)
      const after = all.filter((t) => t.tick > stop)
      expect(after.length).toBeGreaterThan(0)
      for (const t of after) {
        expect(t.outputs.drive).toMatchObject({ power: 0, enabled: false, targetPosition: 1000 })
      }
      const again = await runSidecar(b, script)
      expect(normalized(again)).toEqual(normalized(run))
    },
    TIMEOUT
  )

  // 읽기 루프는 끊긴 스레드의 명령을 버리면서도 잠금 시도 비용을 청구하는지 지킨다(버리기 전에도 명령을 보내 시간이 흘렀다).
  // power 루프의 0이 아닌 쓰기는 버리기 전에는 STOP 뒤의 위험한 명령이라 비용 없이 취소되었다. 그래서 가상 시간이 멈춘 채
  // 하드웨어를 계속 불러 stall도 stuckInStop도 아니었다(호스트가 STOP 5초 뒤 JVM을 끝낼 때까지 돌았다, 여기서는 시간 제한).
  // 끊김을 지운 power 루프는 잠금은 잡히지만 위험한 명령이라 취소된다. 실제 send()가 그 안전 검사 전에 잡은 잠금 한 번도
  // CLOCK_READ로 청구해야 같은 까닭으로 멈추지 않는다.
  for (const opMode of [
    'StopIgnoredHardwareLoop',
    'StopIgnoredPowerLoop',
    'StopClearedInterruptPowerLoop'
  ]) {
    it(
      `${opMode}: STOP을 무시하고 하드웨어만 부르는 루프는 잠금 시도마다 가상 시간이 흘러 stall이 아니라 stuckInStop으로 끝난다`,
      async () => {
        const run = await runSidecar(b, {
          opMode,
          events: { 2: ['start'], 50: ['stop'] },
          request: {
            configXml: writeConfig(['<TetrixMotor name="drive" port="0" />']),
            stallMillis: 1000
          },
          // 회귀로 stall이 나면 호스트처럼 끝내 바로 실패하게(답을 기다리다 시간 제한에 걸리지 않게)
          shutdownWhen: (m) => m.type === 'error' && m.kind === 'stall'
        })
        expect(errors(run).map((e) => e.kind)).toEqual(['stuckInStop'])
        const finished = run.messages[run.messages.length - 1] as {
          tNanos: number
          reason: string
        }
        expect(finished.reason).toBe('stuck')
        expect(finished.tNanos).toBeGreaterThanOrEqual(50 * DEFAULT_TICK_NANOS + 900_000_000)
      },
      TIMEOUT
    )
  }

  it(
    '고치지 않은 SDK 샘플 RobotAutoDriveByEncoder_Linear를 첫 encoderDrive 중에 STOP해도 오류 없이 끝난다',
    async (ctx) => {
      let samples: { dir: string; files: string[] }
      try {
        samples = await ensureFtcSamples({ log: () => {} })
      } catch (error) {
        // 받지 못하면(오프라인) 건너뛴다. 해시가 다른 것은 실패다(compat.test.ts와 같다)
        if (error instanceof FetchError && !/SHA-256/.test((error as Error).message)) {
          ctx.skip()
          return
        }
        throw error
      }
      const sample = 'RobotAutoDriveByEncoder_Linear'
      const run = await runSidecar(b, {
        opMode: sample,
        // 첫 encoderDrive(48 in, 시간 제한 5 s)는 엔코더 입력이 없어 STOP 때까지 돈다
        events: { 2: ['start'], [STOP_TICK]: ['stop'] },
        request: {
          sourceRoots: [samples.dir],
          opModeSource: join(samples.dir, `${sample}.java`),
          opModeClass: `org.firstinspires.ftc.robotcontroller.external.samples.${sample}`,
          configXml: writeConfig([
            '<TetrixMotor name="left_drive" port="0" />',
            '<TetrixMotor name="right_drive" port="1" />'
          ])
        }
      })
      expect(errors(run), run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('stopped')
      const all = ticks(run)
      const running = all.filter((t) => t.phase === 'running' && t.tick < STOP_TICK)
      for (const name of ['left_drive', 'right_drive']) {
        expect(
          running.some(
            (t) =>
              t.outputs[name]?.mode === 'RUN_TO_POSITION' && Number(t.outputs[name]?.power) > 0.59
          )
        ).toBe(true)
        for (const t of all.filter((t) => t.tick > STOP_TICK)) {
          expect(t.outputs[name]?.power).toBe(0)
        }
      }
    },
    TIMEOUT
  )

  it(
    '탭으로 들여 쓴 줄의 진단 열은 글자 단위다(편집기의 열과 같다)',
    async () => {
      const run = await runSidecar(b, { opMode: 'TabCompileError' })
      const compiled = run.messages.find((m) => m.type === 'compiled')
      const diagnostics = compiled?.type === 'compiled' ? compiled.diagnostics : []
      // "\t\tString s = \"가나\"; int x = undefinedVariable;"의 undefinedVariable은 28번째 글자
      expect(diagnostics[0]).toMatchObject({ line: 11, column: 28 })
    },
    TIMEOUT
  )

  it(
    '아주 긴 글자도 호스트의 줄 한도 안에서 보내고, 긴 출력 줄은 UTF-8 글자를 가르지 않고 나눈다',
    async () => {
      const run = await runSidecar(b, { opMode: 'HugeOutput', events: { 1: ['start'] } })
      expect(Math.max(...run.raw.map((line) => line.length))).toBeLessThan(MAX_LINE_CHARS)
      const robotLog = run.messages.find(
        (m) => m.type === 'log' && m.stream === 'robotLog' && m.text !== HARDWARE_MAP_PRE_INIT
      )
      expect(robotLog?.type === 'log' && robotLog.text.length).toBe(64 * 1024)
      expect(robotLog?.type === 'log' && robotLog.text.endsWith('…')).toBe(true)
      const telemetry = run.messages.find((m): m is TelemetryMessage => m.type === 'telemetry')
      expect(telemetry?.frame.lines.length).toBeLessThan(21)
      expect(telemetry?.frame.lines[telemetry.frame.lines.length - 1]).toBe('…')
      const out = run.messages.flatMap((m) =>
        m.type === 'log' && m.stream === 'out' ? [m.text] : []
      )
      expect(out.length).toBeGreaterThan(1)
      expect(out.join('')).toBe('가'.repeat(70_000))
      const error = errors(run)[0]
      expect(error).toMatchObject({
        kind: 'exception',
        exception: 'java.lang.IllegalStateException'
      })
      expect(error.message.length).toBe(64 * 1024)
      expect(finishedReason(run)).toBe('exception')
    },
    TIMEOUT
  )

  it(
    '게임패드 상태가 gamepad1에 보이고 엣지 감지는 누를 때마다 한 번이다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'Gamepads',
        events: { 2: ['start'], 200: ['stop'] },
        gamepads: (tick) => {
          const a = (tick >= 20 && tick < 30) || (tick >= 50 && tick < 60)
          const y = tick >= 40 && tick < 45 ? -0.5 : 0
          return [pad({ a, left_stick_y: y }), null]
        }
      })
      expect(results(run)).toMatchObject({
        pressed: '2',
        minLeftY: '-0.5',
        cross: 'true',
        id: '1',
        pad2id: '-1'
      })
    },
    TIMEOUT
  )

  it(
    'OpMode 클래스가 없거나 clock이 virtual이 아니면 loadFailed',
    async () => {
      const missing = await runSidecar(b, {
        opMode: 'WaitForStartLinear',
        request: { opModeClass: `${PACKAGE}.NoSuchOpMode` }
      })
      expect(errors(missing)[0]).toMatchObject({ kind: 'load' })
      expect(finishedReason(missing)).toBe('loadFailed')

      const clock = await runSidecar(b, {
        opMode: 'WaitForStartLinear',
        request: { clock: 'realtime' as 'virtual' }
      })
      expect(errors(clock)[0]).toMatchObject({ kind: 'internal' })
      expect(errors(clock)[0].message).toContain('unsupported clock')
      expect(finishedReason(clock)).toBe('loadFailed')
      expect(clock.messages.some((m) => m.type === 'compiled')).toBe(false)
    },
    TIMEOUT
  )

  it(
    'tickReply를 기다리는 동안에도 shutdown을 바로 처리한다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'WaitForStartLinear',
        shutdownWhen: (m) => m.type === 'tick' && m.tick === 10
      })
      expect(finishedReason(run)).toBe('shutdown')
      const ticks = run.messages.filter((m) => m.type === 'tick')
      expect(ticks.length).toBe(11)
    },
    TIMEOUT
  )

  it(
    '같은 입력이면 메시지 열이 바이트 단위로 같다(오차를 켜도 같은 시드면 같다)',
    async () => {
      const script: Script = {
        opMode: 'WaitForStartLinear',
        events: { 40: ['start'], 120: ['stop'] },
        request: { jitter: 0.2, seed: 7 }
      }
      const first = await runSidecar(b, script)
      const second = await runSidecar(b, script)
      expect(normalized(second)).toEqual(normalized(first))

      const telemetry = await runSidecar(b, { opMode: 'TelemetryRate' })
      const telemetryAgain = await runSidecar(b, { opMode: 'TelemetryRate' })
      expect(normalized(telemetryAgain)).toEqual(normalized(telemetry))
    },
    TIMEOUT
  )

  it(
    '오차가 켜지면 시드마다 루프 시간이 다르고, 같은 시드면 같다',
    async () => {
      const loopNanos = async (jitter: number, seed: number): Promise<number> =>
        Number(
          results(await runSidecar(b, { opMode: 'LoopTiming', request: { jitter, seed } }))
            .loopNanos
        )
      const plain = await loopNanos(0, 0)
      const seed1 = await loopNanos(0.3, 1)
      const seed1Again = await loopNanos(0.3, 1)
      const seed2 = await loopNanos(0.3, 2)
      expect(seed1Again).toBe(seed1)
      expect(seed2).not.toBe(seed1)
      expect(seed1).not.toBe(plain)
      // 오차는 ±30% 안
      expect(Math.abs(seed1 - plain) / plain).toBeLessThan(0.3)
    },
    TIMEOUT
  )

  it(
    'Java 단위 테스트(패처·JSON·가상 시계·SDK 손 구현)',
    async () => {
      const classes = await compileJavaTests(b, [resolve(__dirname, 'java')])
      const result = await runJavaTests(b, classes, [
        'org.sandbot.runtime.JsonTest',
        'org.sandbot.runtime.OutputCaptureTest',
        'org.sandbot.runtime.patch.ClassPatcherTest',
        'org.sandbot.runtime.VirtualClockTest',
        'org.sandbot.runtime.SdkCoreTest'
      ])
      expect(result.failed).toEqual([])
      expect(result.passed.length).toBeGreaterThan(20)
    },
    TIMEOUT
  )
})
