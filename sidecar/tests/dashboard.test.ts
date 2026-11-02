// FTC Dashboard 대체 통합 시험(진짜 JVM, 라이브러리 L2 갈래 B): 사이드카에 실제 Road Runner 1.0 jar와 SandBot Dashboard 대체
// (sandbot-dashboard.jar)를 실행 클래스패스로, 실제 FTC Dashboard 0.6.0 jar를 컴파일 클래스패스로 주고(메인의 라이브러리 해석과 같다)
// 시험 OpMode(sidecar/tests/opmodes-dash/)를 돌린다. 호스트는 libraries.test.ts처럼 작은 결정적 호스트(틱마다 바로 답, 정한 틱에
// START, 정한 틱에 configSet)다.
//  - Actions.runBlocking이 dash 패킷(data·log·ops)을 전송 간격(가상 100 ms)마다 보내고, 두 번 돌리면 바이트가 같다
//  - @Config 트리(이름순, 형식·enum 상수·source, final·@Disabled 제외, @Config 이름, addConfigVariable·autoRemove)와 configSet이
//    다음 루프에 보이고 dashConfig가 다시 온다(받지 않는 값은 경고 로그). public이 아닌 @Config 클래스도 로봇(ART)처럼 읽고 고친다
//  - MultipleTelemetry(DS + Dashboard)의 실제 예외·null, clear의 cleared, 카메라·이미지 안내 한 번, 한도
// JDK가 없으면 모두 건너뛴다. 라이브러리를 받지 못하면(오프라인) 이유를 출력하고 건너뛴다(SANDBOT_TEST_LIBRARIES_REQUIRED=1이면 실패).
import { spawn } from 'node:child_process'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DashConfigChild, DashConfigNode, DashConfigSet } from '../../src/shared/dashboard'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type DashConfigMessage,
  type DashMessage,
  type DsEvent,
  type ErrorMessage,
  type HostMessage,
  type NoticeMessage,
  type RunRequest,
  type SidecarMessage
} from '../../src/shared/sidecarProtocol'
import {
  repoRoot,
  SIDECAR_TEST_TIMEOUT,
  runProcess,
  sidecarBuild,
  testTempDir,
  type SidecarBuild
} from './support'

const build = await sidecarBuild()

const OPMODES = resolve(__dirname, 'opmodes-dash')
const LIBRARY_SOURCES = resolve(__dirname, 'libs-dash')
const PACKAGE = 'org.firstinspires.ftc.teamcode'
const START_TICK = 4

type TestLibraries = { dir: string; jars: Record<string, string> }

// scripts/fetch-test-libraries.mjs의 묶음: 실행용 Road Runner와 컴파일용 실제 Dashboard
const SETS = {
  roadrunner: [
    'rrFtc',
    'rrActions',
    'rrCore',
    'kotlinStdlib',
    'jacksonDatabind',
    'jacksonCore',
    'jacksonAnnotations'
  ],
  dashboard: ['dashboard', 'dashboardCore']
} as const

async function fetchLibraries(): Promise<TestLibraries | null> {
  const result = await runProcess(
    process.execPath,
    [join(repoRoot, 'scripts', 'fetch-test-libraries.mjs'), '--json'],
    { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' }
  )
  const last = result.stdout.trim().split('\n').at(-1) ?? ''
  if (result.code === 0 && last.startsWith('{')) return JSON.parse(last) as TestLibraries
  const reason = `cannot fetch the test libraries (scripts/fetch-test-libraries.mjs exit ${result.code}):\n${result.output.trim().split('\n').slice(-5).join('\n')}`
  if (process.env.SANDBOT_TEST_LIBRARIES_REQUIRED === '1') throw new Error(reason)
  console.warn(`skipping the Dashboard integration tests: ${reason}`)
  return null
}

const libraries = build ? await fetchLibraries() : null

/** 메인의 해석처럼: 컴파일은 가짜 SDK + androidx.annotation + RR + 실제 Dashboard, 실행은 RR + Dashboard 대체 */
function classpaths(b: SidecarBuild, extraLibraries: string[]): Partial<RunRequest> {
  const rr = SETS.roadrunner.map((id) => libraries!.jars[id])
  const dashboard = SETS.dashboard.map((id) => libraries!.jars[id])
  return {
    compileClasspath: [b.sdkJar, libraries!.jars.androidxAnnotation, ...rr, ...dashboard],
    libraryClasspath: [...rr, ...extraLibraries, b.dashboardJar]
  }
}

// @Config 클래스가 든 작은 라이브러리 jar(sidecar/tests/libs-dash, 실제 Dashboard에 대고 컴파일)
async function configLibraryJar(b: SidecarBuild): Promise<string> {
  const dir = testTempDir('dash-lib')
  const classes = join(dir, 'classes')
  const sources = ['org/example/lib/LibTuning.java', 'com/google/example/Ignored.java'].map((f) =>
    join(LIBRARY_SOURCES, f)
  )
  const compiled = await runProcess(b.javac, [
    '--release',
    '8',
    '-Xlint:-options',
    '-cp',
    SETS.dashboard.map((id) => libraries!.jars[id]).join(delimiter),
    '-d',
    classes,
    ...sources
  ])
  if (compiled.code !== 0) throw new Error(compiled.output)
  const jar = join(dir, 'config-lib.jar')
  const packed = await runProcess(join(b.jdkHome, 'bin', 'jar'), [
    '--create',
    '--file',
    jar,
    '-C',
    classes,
    '.'
  ])
  if (packed.code !== 0) throw new Error(packed.output)
  return jar
}

type Host = {
  opMode: string
  events?: Record<number, DsEvent[]>
  configSet?: Record<number, DashConfigSet[]>
  maxTicks?: number
  // 실행 클래스패스에 더할 라이브러리 jar
  extraLibraries?: string[]
  // 일시 정지처럼 이 틱의 답을 벽시계로 미룬다(session.ts가 일시 정지 중 답을 보류하듯)
  hold?: { tick: number; millis: number }
}

// held: 미룬 틱을 받은 때까지 온 메시지 종류(호스트가 일시 정지 중 가진 것)
type Run = { messages: SidecarMessage[]; raw: string[]; stderr: string; held?: string[] }

function runRequest(b: SidecarBuild, host: Host): RunRequest {
  return {
    type: 'run',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots: [OPMODES],
    opModeSource: join(OPMODES, ...PACKAGE.split('.'), `${host.opMode}.java`),
    opModeClass: `${PACKAGE}.${host.opMode}`,
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
    stallMillis: 5000,
    ...classpaths(b, host.extraLibraries ?? [])
  }
}

function runSidecar(b: SidecarBuild, host: Host): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn(
      b.java,
      [
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
    const run: Run = { messages: [], raw: [], stderr: '' }
    let pending = ''
    let finished = false
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out; last: ${run.raw.slice(-5).join('\n')}\n${run.stderr}`))
    }, 240_000)
    const onLine = (line: string): void => {
      run.raw.push(line)
      let message: SidecarMessage
      try {
        message = JSON.parse(line) as SidecarMessage
      } catch {
        return
      }
      run.messages.push(message)
      if (message.type === 'finished') finished = true
      if (finished || message.type !== 'tick') return
      if (host.maxTicks !== undefined && message.tick > host.maxTicks) {
        send({ type: 'shutdown' })
        return
      }
      const reply: HostMessage = {
        type: 'tickReply',
        tick: message.tick,
        events: host.events?.[message.tick] ?? (message.tick === START_TICK ? ['start'] : []),
        gamepads: [null, null],
        inputs: {},
        configSet: host.configSet?.[message.tick] ?? []
      }
      if (host.hold?.tick === message.tick) {
        run.held = run.messages.map((m) => m.type)
        setTimeout(() => send(reply), host.hold.millis)
      } else {
        send(reply)
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
    child.stderr.on('data', (chunk: string) => (run.stderr += chunk))
    child.on('error', fail)
    child.on('close', () => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      done(run)
    })
    send(runRequest(b, host))
  })
}

function results(run: Run): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of run.messages) {
    if (m.type !== 'log' || m.stream !== 'out' || !m.text.startsWith('RESULT ')) continue
    const fields: Record<string, string> = {}
    for (const pair of m.text.slice('RESULT '.length).split(' ')) {
      const eq = pair.indexOf('=')
      if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
    out.push(fields)
  }
  return out
}

function errors(run: Run): ErrorMessage[] {
  return run.messages.filter((m): m is ErrorMessage => m.type === 'error')
}

function dashes(run: Run): DashMessage[] {
  return run.messages.filter((m): m is DashMessage => m.type === 'dash')
}

function configs(run: Run): DashConfigMessage[] {
  return run.messages.filter((m): m is DashConfigMessage => m.type === 'dashConfig')
}

function robotLog(run: Run): string[] {
  return run.messages.flatMap((m) => (m.type === 'log' && m.stream === 'robotLog' ? [m.text] : []))
}

function finishedReason(run: Run): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

function explain(run: Run): string {
  const compiled = run.messages.find((m) => m.type === 'compiled')
  return JSON.stringify({
    compiled: compiled?.type === 'compiled' ? compiled.diagnostics.slice(0, 5) : null,
    errors: errors(run),
    stderr: run.stderr.slice(-2000)
  })
}

function normalized(run: Run): string[] {
  return run.raw.map((line) => {
    const m = JSON.parse(line) as SidecarMessage
    if (m.type === 'hello') return JSON.stringify({ ...m, java: '' })
    if (m.type === 'compiled') return JSON.stringify({ ...m, millis: 0 })
    return line
  })
}

/** 트리에서 경로의 노드 */
function nodeAt(root: DashConfigNode, path: string[]): DashConfigNode | undefined {
  let node: DashConfigNode | undefined = root
  for (const name of path) {
    if (node?.kind !== 'custom') return undefined
    node = node.children.find((child: DashConfigChild) => child.name === name)?.node
  }
  return node
}

function names(node: DashConfigNode | undefined): string[] {
  return node?.kind === 'custom' ? node.children.map((c) => c.name) : []
}

describe.skipIf(build === null)('FTC Dashboard 대체: Road Runner Actions.runBlocking', () => {
  const b = build as SidecarBuild

  it.skipIf(libraries === null)(
    '실제 Road Runner jar로 runBlocking이 dash 패킷(data·log·ops)을 전송 간격마다 보내고, 두 번 돌리면 바이트가 같다',
    async () => {
      const first = await runSidecar(b, { opMode: 'DashRunBlocking' })
      expect(errors(first), explain(first)).toEqual([])
      expect(finishedReason(first)).toBe('returned')
      expect(results(first)).toEqual([{ loops: '60', instance: 'true' }])
      // 링크 검사: Road Runner가 쓰는 Dashboard 클래스·멤버는 모두 대체에 있다(남는 경고는 Road Runner의 웹 처리기·AppUtil 쪽)
      const link = first.messages.find((m) => m.type === 'linkReport')
      expect(link?.type).toBe('linkReport')
      const warnings = link?.type === 'linkReport' ? link.warnings : []
      expect(warnings.filter((w) => w.target.startsWith('com.acmerobotics.dashboard.'))).toEqual([])
      expect(warnings.filter((w) => w.jar === b.dashboardJar)).toEqual([])

      const packets = dashes(first)
      // 루프 60번 × 20 ms ≈ 1.2 s, 전송 간격 100 ms → 묶음 10여 개(루프마다가 아니다)
      expect(packets.length).toBeGreaterThan(8)
      expect(packets.length).toBeLessThan(30)
      // 처음은 INIT의 clearTelemetry(빈 cleared, 다음 경계), 마지막은 끝낼 때 남은 것. 그 사이 묶음은 틱 경계에서 전송 간격
      // (100 ms) 이상 떨어져 있다. 액션이 그리기 전(SleepAction)의 패킷은 빈 overlay라 ops가 null이다.
      expect(packets[0]).toMatchObject({
        tNanos: DEFAULT_TICK_NANOS,
        cleared: true,
        data: [],
        log: [],
        ops: null
      })
      const batches = packets.slice(1, -1)
      for (const p of batches) expect(p.tNanos % DEFAULT_TICK_NANOS).toBe(0)
      for (let i = 1; i < batches.length; i++)
        expect(batches[i].tNanos - batches[i - 1].tNanos).toBeGreaterThanOrEqual(100_000_000)
      expect(batches[0].ops).toBeNull()
      const last = packets.at(-1)!
      expect(last.tNanos).toBeGreaterThan(batches.at(-1)!.tNanos)
      expect(last.cleared).toBe(false)
      expect(last.data).toEqual([
        ['loop', '60'],
        ['x', '30.0']
      ])
      expect(last.log).toEqual(['step 60'])
      // 기본 필드(그림 + 격자, page frame) 뒤에 runBlocking이 보낸 overlay
      expect(last.ops?.slice(0, 4)).toEqual([
        { type: 'alpha', alpha: 0.4 },
        {
          type: 'image',
          path: '/dash/decode.webp',
          x: 0,
          y: 0,
          width: 144,
          height: 144,
          theta: 0,
          pivotX: 0,
          pivotY: 0,
          usePageFrame: true
        },
        { type: 'alpha', alpha: 1 },
        {
          type: 'grid',
          x: 0,
          y: 0,
          width: 144,
          height: 144,
          numTicksX: 7,
          numTicksY: 7,
          theta: 0,
          pivotX: 0,
          pivotY: 0,
          usePageFrame: true
        }
      ])
      expect(last.ops?.slice(4)).toEqual([
        { type: 'stroke', color: '#3F51B5' },
        { type: 'strokeWidth', width: 1 },
        { type: 'circle', x: 30, y: 0, radius: 9, stroke: true },
        { type: 'polyline', xPoints: [0, 60], yPoints: [0, 60] }
      ])
      const second = await runSidecar(b, { opMode: 'DashRunBlocking' })
      expect(normalized(second)).toEqual(normalized(first))
    },
    SIDECAR_TEST_TIMEOUT
  )
})

describe.skipIf(build === null)('FTC Dashboard 대체: @Config와 Config 탭', () => {
  const b = build as SidecarBuild
  const SET_TICK = START_TICK + 20
  const STOP_TICK = START_TICK + 40
  const loop = (field: string): string[] => ['DashConfigLoop', field]

  it.skipIf(libraries === null)(
    '@Config 트리를 이름순으로 보내고, configSet이 다음 루프에 보이며 dashConfig가 다시 온다(받지 않는 값은 경고)',
    async () => {
      const host: Host = {
        opMode: 'DashConfigLoop',
        extraLibraries: [await configLibraryJar(b)],
        events: { [START_TICK]: ['start'], [STOP_TICK]: ['stop'] },
        configSet: {
          [SET_TICK]: [
            { path: loop('SPEED'), value: '0.75' },
            { path: loop('MODE'), value: 'SLOW' },
            { path: [...loop('GAINS'), 'kP'], value: '0.3' },
            { path: ['Renamed', 'GAIN'], value: '4.5' },
            { path: loop('COUNT'), value: 'abc' },
            { path: loop('COUNT'), value: '2147483648' },
            { path: loop('ENABLED'), value: 'yes' },
            { path: loop('MODE'), value: 'OLDER' },
            { path: ['Nope', 'x'], value: '1' },
            { path: loop('GAINS'), value: '1' }
          ]
        }
      }
      const run = await runSidecar(b, host)
      expect(errors(run), explain(run)).toEqual([])
      expect(finishedReason(run)).toBe('stopped')

      const trees = configs(run)
      expect(trees.length).toBeGreaterThanOrEqual(3)
      const initial = trees[0].root
      // INIT 전 스캔(팀 클래스와 라이브러리 jar의 @Config, @Disabled 제외, @Config 이름, com.google 등 이름 접두는 건너뜀)
      expect(names(initial)).toEqual(['DashConfigLoop', 'LibTuning', 'Renamed'])
      expect(nodeAt(initial, ['LibTuning', 'RAMP'])).toEqual({
        kind: 'value',
        type: 'int',
        value: '4',
        enumValues: [],
        source: { declaringClass: 'org.example.lib.LibTuning', field: 'RAMP' }
      })
      expect(names(nodeAt(initial, ['DashConfigLoop']))).toEqual([
        'ARRAY',
        'COUNT',
        'ENABLED',
        'GAINS',
        'LABEL',
        'MODE',
        'SPEED'
      ])
      const source = (cls: string, field: string): { declaringClass: string; field: string } => ({
        declaringClass: `${PACKAGE}.${cls}`,
        field
      })
      expect(nodeAt(initial, loop('SPEED'))).toEqual({
        kind: 'value',
        type: 'double',
        value: '0.5',
        enumValues: [],
        source: source('DashConfigLoop', 'SPEED')
      })
      expect(nodeAt(initial, loop('MODE'))).toEqual({
        kind: 'value',
        type: 'enum',
        value: 'FAST',
        enumValues: ['SLOW', 'FAST'],
        source: source('DashConfigLoop', 'MODE')
      })
      expect(nodeAt(initial, [...loop('GAINS'), 'kP'])).toMatchObject({
        type: 'double',
        value: '0.1',
        source: source('DashConfigLoop$Gains', 'kP')
      })
      expect(nodeAt(initial, [...loop('ARRAY'), '1'])).toEqual({
        kind: 'value',
        type: 'double',
        value: '2.0',
        enumValues: [],
        source: null
      })
      expect(nodeAt(initial, ['Renamed', 'GAIN'])).toMatchObject({ type: 'float', value: '2.5' })
      expect(nodeAt(initial, ['Renamed', 'TICKS'])).toMatchObject({
        type: 'long',
        value: String(2 ** 40)
      })
      expect(nodeAt(initial, loop('LABEL'))).toMatchObject({ type: 'string', value: 'lift' })

      // runOpMode의 addConfigVariable
      const running = trees.find((t) => names(t.root).includes('Runtime'))!
      expect(names(nodeAt(running.root, ['Runtime']))).toEqual(['scale', 'temp'])
      expect(nodeAt(running.root, ['Runtime', 'scale'])).toEqual({
        kind: 'value',
        type: 'double',
        value: '2.0',
        enumValues: [],
        source: null
      })

      // configSet 다음 루프
      const lines = results(run)
      expect(lines[0]).toEqual({
        speed: '0.5',
        mode: 'FAST',
        kP: '0.1',
        count: '3',
        gain: '2.5'
      })
      expect(lines[1]).toEqual({
        speed: '0.75',
        mode: 'SLOW',
        kP: '0.3',
        count: '3',
        gain: '4.5'
      })
      const setAt = SET_TICK * DEFAULT_TICK_NANOS
      const after = trees.find((t) => t.tNanos >= setAt)!
      expect(after.tNanos).toBe(setAt)
      expect(nodeAt(after.root, loop('SPEED'))).toMatchObject({ value: '0.75' })
      expect(nodeAt(after.root, loop('MODE'))).toMatchObject({ value: 'SLOW' })
      expect(nodeAt(after.root, loop('COUNT'))).toMatchObject({ value: '3' })
      const warnings = robotLog(run).filter((line) => line.includes('Dashboard config'))
      expect(warnings).toEqual([
        expect.stringContaining('DashConfigLoop/COUNT: not an int: abc'),
        expect.stringContaining('DashConfigLoop/COUNT: not an int: 2147483648'),
        expect.stringContaining('DashConfigLoop/ENABLED: not a boolean: yes'),
        expect.stringContaining('DashConfigLoop/MODE: not a constant of the enum: OLDER'),
        expect.stringContaining('no variable at Nope/x'),
        expect.stringContaining('no variable at DashConfigLoop/GAINS')
      ])

      // 끝: autoRemove 변수는 onOpModePostStop이 지운다(마지막 트리)
      const final = trees.at(-1)!
      expect(names(nodeAt(final.root, ['Runtime']))).toEqual(['scale'])

      // 같은 입력이면 dash·dashConfig를 포함해 바이트가 같다(설정 트리는 이름순, HashMap 순서가 들어가지 않는다)
      const again = await runSidecar(b, host)
      expect(normalized(again)).toEqual(normalized(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it.skipIf(libraries === null)(
    'INIT에서 일시 정지해도(tick 0의 답을 미룸) 설정 트리가 이미 호스트에 있고, 그동안 고친 값은 OpMode를 만들기 전에 들어간다',
    async () => {
      const host: Host = {
        opMode: 'DashConfigLoop',
        events: { [START_TICK]: ['start'], [STOP_TICK]: ['stop'] },
        hold: { tick: 0, millis: 300 },
        // 일시 정지 중에 고친 값은 미룬 답(tick 0)에 실린다
        configSet: { 0: [{ path: loop('SPEED'), value: '0.9' }] }
      }
      const run = await runSidecar(b, host)
      expect(errors(run), explain(run)).toEqual([])
      expect(finishedReason(run)).toBe('stopped')
      // tick 0을 받았을 때(호스트가 답을 미루는 동안) INIT 전 스캔의 트리가 이미 와 있다
      expect(run.held).toContain('dashConfig')
      const first = configs(run)[0]
      expect(first.tNanos).toBe(0)
      expect(nodeAt(first.root, loop('SPEED'))).toMatchObject({ value: '0.5' })
      // 미룬 답의 configSet은 tick 0 경계에서 적용되고 트리를 다시 보낸다(OpMode를 만들기 전, 첫 루프부터 새 값)
      const applied = configs(run)[1]
      expect(applied.tNanos).toBe(0)
      expect(nodeAt(applied.root, loop('SPEED'))).toMatchObject({ value: '0.9' })
      expect(results(run)[0]).toMatchObject({ speed: '0.9' })
      // 틱 경계의 패킷 묶음과 바뀐 트리는 그 경계의 tick보다 먼저, configSet을 적용한 뒤의 트리는 그 tick 뒤에 온다
      const tickIndex = new Map<number, number>()
      run.messages.forEach((m, i) => {
        if (m.type === 'tick') tickIndex.set(m.tNanos, i)
      })
      run.messages.forEach((m, i) => {
        if (m.type !== 'dash' && m.type !== 'dashConfig') return
        const tick = tickIndex.get(m.tNanos)
        if (tick === undefined) return
        if (m.type === 'dashConfig' && m === applied) expect(i).toBeGreaterThan(tick)
        else expect(i, JSON.stringify(m).slice(0, 120)).toBeLessThan(tick)
      })
      // 같은 입력이면 바이트가 같다(답을 미룬 벽시계 시간은 메시지에 들어가지 않는다)
      const again = await runSidecar(b, { ...host, hold: undefined })
      expect(normalized(again)).toEqual(normalized(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it.skipIf(libraries === null)(
    'public이 아닌 @Config 클래스(패키지 전용 최상위·중첩, 패키지 전용 상위 클래스의 필드)도 로봇(ART)처럼 읽고 고친다(final만 거부)',
    async () => {
      const at = (...path: string[]): string[] => path
      const host: Host = {
        opMode: 'DashNonPublicConfig',
        events: { [START_TICK]: ['start'], [STOP_TICK]: ['stop'] },
        configSet: {
          [SET_TICK]: [
            { path: at('PkgConstants', 'KP'), value: '0.5' },
            { path: at('Nested', 'TICKS'), value: '7' },
            { path: at('PkgConstants', 'POSITIONS', '1'), value: '3.5' },
            { path: at('PkgConstants', 'GAINS', 'kP'), value: '0.2' },
            { path: at('Derived', 'BASE'), value: '2.5' },
            { path: at('PkgConstants', 'GAINS', 'kI'), value: '1' }
          ]
        }
      }
      const run = await runSidecar(b, host)
      // 객체·배열 필드가 있는 패키지 전용 클래스도 INIT 전 스캔에서 실패하지 않는다
      expect(errors(run), explain(run)).toEqual([])
      expect(finishedReason(run)).toBe('stopped')

      const trees = configs(run)
      const initial = trees[0].root
      expect(names(initial)).toEqual(['Derived', 'Nested', 'PkgConstants'])
      const source = (cls: string, field: string): { declaringClass: string; field: string } => ({
        declaringClass: `${PACKAGE}.${cls}`,
        field
      })
      expect(nodeAt(initial, at('PkgConstants', 'KP'))).toEqual({
        kind: 'value',
        type: 'double',
        value: '0.25',
        enumValues: [],
        source: source('PkgConstants', 'KP')
      })
      expect(nodeAt(initial, at('Nested', 'TICKS'))).toEqual({
        kind: 'value',
        type: 'int',
        value: '42',
        enumValues: [],
        source: source('DashNonPublicConfig$Nested', 'TICKS')
      })
      expect(nodeAt(initial, at('PkgConstants', 'POSITIONS', '1'))).toMatchObject({
        type: 'double',
        value: '2.0',
        source: null
      })
      expect(nodeAt(initial, at('PkgConstants', 'GAINS', 'kP'))).toMatchObject({
        type: 'double',
        value: '0.1',
        source: source('PkgGains', 'kP')
      })
      expect(nodeAt(initial, at('PkgConstants', 'GAINS', 'kI'))).toMatchObject({ value: '0.0' })
      expect(nodeAt(initial, at('Derived', 'BASE'))).toMatchObject({
        type: 'double',
        value: '1.5',
        source: source('PkgBase', 'BASE')
      })

      // configSet 다음 루프(final 필드는 로봇처럼 쓰지 못한다)
      expect(results(run)).toEqual([
        { kp: '0.25', ticks: '42', pos1: '2.0', gainP: '0.1', base: '1.5', fixedI: '0.0' },
        { kp: '0.5', ticks: '7', pos1: '3.5', gainP: '0.2', base: '2.5', fixedI: '0.0' }
      ])
      const after = trees.find((t) => t.tNanos >= SET_TICK * DEFAULT_TICK_NANOS)!
      expect(nodeAt(after.root, at('PkgConstants', 'KP'))).toMatchObject({ value: '0.5' })
      expect(nodeAt(after.root, at('Nested', 'TICKS'))).toMatchObject({ value: '7' })
      expect(nodeAt(after.root, at('PkgConstants', 'GAINS', 'kI'))).toMatchObject({ value: '0.0' })
      const log = robotLog(run).filter((line) => line.includes('Dashboard config'))
      expect(log).toEqual([
        expect.stringMatching(
          /PkgConstants\/GAINS\/kI could not be set: java\.lang\.RuntimeException: java\.lang\.IllegalAccessException: Cannot set public final field/
        )
      ])
      expect(robotLog(run).filter((line) => line.includes('could not be read'))).toEqual([])

      const again = await runSidecar(b, host)
      expect(normalized(again)).toEqual(normalized(run))
    },
    SIDECAR_TEST_TIMEOUT
  )
})

describe.skipIf(build === null)('FTC Dashboard 대체: 텔레메트리', () => {
  const b = build as SidecarBuild

  it.skipIf(libraries === null)(
    'MultipleTelemetry(DS + Dashboard)는 실제처럼 null·예외를 내고, clear는 cleared, 카메라·이미지는 안내 한 번, 한도로 자른다',
    async () => {
      const run = await runSidecar(b, { opMode: 'DashTelemetryQuirks' })
      expect(errors(run), explain(run)).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      expect(results(run)).toEqual([
        {
          retained: 'NullPointerException',
          func: 'UnsupportedOperationException',
          dashItem: 'null',
          dashLine: 'null',
          interval: '100',
          enabled: 'true'
        }
      ])
      const packets = dashes(run)
      // onOpModePreInit의 clearTelemetry 뒤 INIT에서 보낸 것(MultipleTelemetry·Dashboard 텔레메트리, 로그 줄)
      expect(packets[0]).toEqual({
        type: 'dash',
        tNanos: expect.any(Number),
        cleared: true,
        data: [
          ['direct', '2'],
          ['speed', '1.5']
        ],
        log: ['line', 'logged'],
        ops: null
      })
      // clear 뒤의 묶음. 실제 웹 화면처럼 로그도 지우므로 cleared 묶음의 log는 null이 아니다
      const cleared = packets.filter((p) => p.cleared)
      expect(cleared.length).toBe(2)
      for (const p of cleared) expect(p.log).not.toBeNull()
      expect(packets.some((p) => p.data.some(([k, v]) => k === 'after' && v === 'clear'))).toBe(
        true
      )
      // 600개 키 → 500개, NaN 원은 버리고 나머지 원은 그린다
      const big = packets.find((p) => p.data.length > 100)!
      expect(big.data.length).toBe(500)
      expect(big.data[0]).toEqual(['k000', '0'])
      expect(big.ops).toEqual([{ type: 'circle', x: 1, y: 2, radius: 3, stroke: false }])
      const notices = run.messages.filter((m): m is NoticeMessage => m.type === 'notice')
      expect(notices.map((n) => [n.code, n.params])).toEqual([
        ['dashCamera', {}],
        ['dashImage', {}]
      ])
      const log = robotLog(run)
      expect(log.filter((line) => line.includes('more than 500 keys'))).toHaveLength(1)
      expect(log.filter((line) => line.includes('NaN, infinite or missing'))).toHaveLength(1)
    },
    SIDECAR_TEST_TIMEOUT
  )
})

describe.skipIf(build === null)('FTC Dashboard 대체: 팀 코드의 오류', () => {
  const b = build as SidecarBuild

  it.skipIf(libraries === null)(
    '기본 형식 필드만 있는 @Config 클래스의 정적 초기화 오류는 Dashboard가 없을 때처럼 error exception(팀 줄)이다',
    async () => {
      const run = await runSidecar(b, { opMode: 'DashBadConfigInit' })
      const [error, ...rest] = errors(run)
      expect(rest).toEqual([])
      expect(error).toMatchObject({
        kind: 'exception',
        exception: 'java.lang.NumberFormatException',
        message: expect.stringContaining('For input string: "fast"'),
        thread: 'OpModeThread'
      })
      expect(error.stack).toContainEqual(
        expect.objectContaining({
          className: `${PACKAGE}.DashBadConfigInit`,
          method: '<clinit>',
          source: join(OPMODES, ...PACKAGE.split('.'), 'DashBadConfigInit.java')
        })
      )
      expect(finishedReason(run)).toBe('exception')
      // 시작하지 못했으므로 트리·패킷을 보내지 않는다(초기화에 실패한 클래스를 다시 읽지 않는다)
      expect(configs(run)).toEqual([])
      expect(dashes(run)).toEqual([])
      expect(robotLog(run).filter((line) => line.includes('Dashboard config'))).toEqual([])
    },
    SIDECAR_TEST_TIMEOUT
  )

  it.skipIf(libraries === null)(
    '팀 ValueProvider의 get·set이 Error를 던져도 OpMode는 그대로 돌고 경고 로그만 남는다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'DashProviderErrors',
        configSet: { [START_TICK + 10]: [{ path: ['Faulty', 'set'], value: '3' }] }
      })
      expect(errors(run), explain(run)).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      expect(results(run)).toEqual([{ loops: '40' }])
      const final = configs(run).at(-1)!.root
      expect(nodeAt(final, ['Faulty', 'get'])).toMatchObject({ type: 'double', value: 'null' })
      expect(nodeAt(final, ['Faulty', 'set'])).toMatchObject({ type: 'double', value: '2.0' })
      const log = robotLog(run)
      expect(log.filter((line) => line.includes('could not be read'))).toEqual([
        expect.stringContaining('java.lang.AssertionError: get failed')
      ])
      expect(log.filter((line) => line.includes('could not be set'))).toEqual([
        expect.stringContaining(
          'Faulty/set could not be set: java.lang.StackOverflowError: set failed'
        )
      ])
    },
    SIDECAR_TEST_TIMEOUT
  )

  it.skipIf(libraries === null)(
    '다른 스레드의 startCameraStream은 다른 Dashboard 호출처럼 error thread이고 안내를 보내지 않는다',
    async () => {
      const run = await runSidecar(b, { opMode: 'DashCameraThread' })
      const [error] = errors(run)
      expect(error).toMatchObject({ kind: 'thread', thread: 'Camera' })
      expect(run.messages.filter((m) => m.type === 'notice')).toEqual([])
      expect(finishedReason(run)).toBe('exception')
    },
    SIDECAR_TEST_TIMEOUT
  )
})
