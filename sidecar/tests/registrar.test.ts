// 등록기 OpMode 시험(진짜 JVM, 라이브러리 L2 갈래 A): @OpModeRegistrar 목록(ListRequest → registered → finished listed)과 등록한
// OpMode 실행(RunRequest.registeredName: 클래스면 새 인스턴스, 인스턴스면 그 인스턴스), 던지는 등록기(error registrar, 다음으로),
// OpMode 수명 알림(OpModeManagerImpl.registerListener, 등록 순서), AppUtil 폴더(모의 저장소 RunRequest.firstFolder), 그리고 실제
// Road Runner jar(scripts/fetch-test-libraries.mjs)로 튜닝 OpMode 인스턴스 목록과 TuningFiles 폴더·notice rrTuningSaved.
// 시험 OpMode는 sidecar/tests/opmodes-rr/(package org.firstinspires.ftc.teamcode). JDK가 없으면 모두 건너뛰고, 라이브러리를 받지
// 못하면 Road Runner 시험만 건너뛴다(SANDBOT_TEST_LIBRARIES_REQUIRED=1이면 실패).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type DsEvent,
  type ErrorMessage,
  type HostMessage,
  type ListRequest,
  type RegisteredOpMode,
  type RunRequest,
  type SidecarMessage
} from '../../src/shared/sidecarProtocol'
import {
  repoRoot,
  runProcess,
  SIDECAR_TEST_TIMEOUT,
  sidecarBuild,
  testTempDir,
  type SidecarBuild
} from './support'

const build = await sidecarBuild()

const OPMODES = resolve(__dirname, 'opmodes-rr')
const PACKAGE = 'org.firstinspires.ftc.teamcode'
const source = (name: string): string => join(OPMODES, ...PACKAGE.split('.'), `${name}.java`)
const registrar = (name: string): { className: string; source: string } => ({
  className: `${PACKAGE}.${name}`,
  source: source(name)
})

type Run = { messages: SidecarMessage[]; raw: string[]; stderr: string; exitCode: number | null }

const JAVA_ARGS = (b: SidecarBuild): string[] => [
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
]

/** 첫 메시지를 보내고, 틱이면 바로 답한다(events의 틱에 DS 사건). maxTicks를 넘으면 shutdown. */
function runSidecar(
  b: SidecarBuild,
  first: RunRequest | ListRequest,
  events: Record<number, DsEvent[]> = {},
  maxTicks = 4000
): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn(b.java, JAVA_ARGS(b), { stdio: ['pipe', 'pipe', 'pipe'] })
    const run: Run = { messages: [], raw: [], stderr: '', exitCode: null }
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
      if (message.tick > maxTicks) {
        send({ type: 'shutdown' })
        return
      }
      send({
        type: 'tickReply',
        tick: message.tick,
        events: events[message.tick] ?? [],
        gamepads: [null, null],
        inputs: {},
        configSet: []
      })
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
    child.on('close', (code) => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      run.exitCode = code
      done(run)
    })
    send(first)
  })
}

type Classpaths = Pick<RunRequest, 'compileClasspath' | 'libraryClasspath'>

function listRequest(
  b: SidecarBuild,
  registrars: string[],
  extra: Partial<ListRequest> = {}
): ListRequest {
  return {
    type: 'list',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots: [OPMODES],
    registrars: registrars.map(registrar),
    bootClasspath: [],
    compileClasspath: [b.sdkJar],
    libraryClasspath: [],
    firstFolder: testTempDir('first'),
    startEpochMillis: 1_700_000_000_000,
    stallMillis: 3000,
    ...extra
  }
}

function runRequest(b: SidecarBuild, extra: Partial<RunRequest>): RunRequest {
  return {
    type: 'run',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots: [OPMODES],
    opModeSource: source('TuningLike'),
    opModeClass: null,
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
    ...extra
  }
}

const errors = (run: Run): ErrorMessage[] =>
  run.messages.filter((m): m is ErrorMessage => m.type === 'error')
const finishedReason = (run: Run): string | undefined => {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}
const registered = (run: Run): RegisteredOpMode[] =>
  run.messages.flatMap((m) => (m.type === 'registered' ? m.opModes : []))
const outLines = (run: Run, prefix: string): string[] =>
  run.messages.flatMap((m) =>
    m.type === 'log' && m.stream === 'out' && m.text.startsWith(prefix) ? [m.text] : []
  )
const robotLog = (run: Run): string[] =>
  run.messages.flatMap((m) => (m.type === 'log' && m.stream === 'robotLog' ? [m.text] : []))

/** "RESULT a=1 b=2" 줄들 → { a: '1', b: '2' } */
function results(run: Run): Record<string, string> {
  const out: Record<string, string> = {}
  for (const text of outLines(run, 'RESULT ')) {
    for (const pair of text.slice('RESULT '.length).split(' ')) {
      const eq = pair.indexOf('=')
      if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
  }
  return out
}

/** 결정성 비교용: 실행마다 다른 값(JVM 버전, 컴파일 시간)만 뺀 메시지 줄 */
function normalized(run: Run): string[] {
  return run.raw.map((line) => {
    const m = JSON.parse(line) as SidecarMessage
    if (m.type === 'hello') return JSON.stringify({ ...m, java: '' })
    if (m.type === 'compiled') return JSON.stringify({ ...m, millis: 0 })
    return line
  })
}

const TUNING_LIKE: RegisteredOpMode[] = [
  {
    name: 'ForwardFactoryTuner',
    group: 'quickstart',
    flavor: 'TeleOp',
    className: `${PACKAGE}.FactoryTuner`,
    registrar: `${PACKAGE}.TuningLike`,
    transitionTarget: ''
  },
  {
    name: 'LateralFactoryTuner',
    group: 'quickstart',
    flavor: 'TeleOp',
    className: `${PACKAGE}.FactoryTuner`,
    registrar: `${PACKAGE}.TuningLike`,
    transitionTarget: ''
  },
  {
    name: 'SplineLike',
    group: 'quickstart',
    flavor: 'TeleOp',
    className: `${PACKAGE}.SplineLike`,
    registrar: `${PACKAGE}.TuningLike`,
    transitionTarget: ''
  },
  {
    name: 'LocalizationLike',
    group: 'quickstart',
    flavor: 'TeleOp',
    className: `${PACKAGE}.LocalizationLike`,
    registrar: `${PACKAGE}.TuningLike`,
    transitionTarget: ''
  },
  {
    name: 'AutoLike',
    group: '$$$$$$$',
    flavor: 'Autonomous',
    className: `${PACKAGE}.FactoryTuner`,
    registrar: `${PACKAGE}.TuningLike`,
    transitionTarget: 'SplineLike'
  },
  {
    name: 'UtilityLike',
    group: '$$$$$$$',
    flavor: 'Utility',
    className: `${PACKAGE}.UtilityLike`,
    registrar: `${PACKAGE}.TuningLike`,
    transitionTarget: ''
  },
  {
    name: 'Annotated',
    group: 'annotated',
    flavor: 'TeleOp',
    className: `${PACKAGE}.AnnotatedTuner`,
    registrar: `${PACKAGE}.TuningLike`,
    transitionTarget: ''
  },
  {
    name: 'WithContext-true',
    group: '$$$$$$$',
    flavor: 'TeleOp',
    className: `${PACKAGE}.FactoryTuner`,
    registrar: `${PACKAGE}.TuningLike`,
    transitionTarget: ''
  }
]

describe.skipIf(build === null)('등록기 OpMode', () => {
  const b = build as SidecarBuild

  it(
    '목록: 등록기를 실제 SDK 규칙으로 불러 등록 순서대로 알리고(이름 계산, 클래스·인스턴스, 겹침은 뒤를 버림) listed로 끝난다',
    async () => {
      const run = await runSidecar(b, listRequest(b, ['TuningLike']))
      expect(errors(run)).toEqual([])
      const types = run.messages.map((m) => m.type)
      expect(types.slice(0, 2)).toEqual(['hello', 'compiled'])
      expect(types.slice(-2)).toEqual(['registered', 'finished'])
      expect(types.filter((type) => type === 'registered')).toHaveLength(1)
      expect(registered(run)).toEqual(TUNING_LIKE)
      expect(finishedReason(run)).toBe('listed')
      // 틱·상태·하드웨어가 없다
      expect(run.messages.some((m) => m.type === 'tick' || m.type === 'state')).toBe(false)
      // 겹친 등록은 경고 로그
      const warnings = robotLog(run).filter((text) => text.includes('configuration error'))
      expect(warnings).toHaveLength(2)
      expect(warnings[0]).toContain('SplineLike is already registered')
      expect(warnings[1]).toContain("'SplineLike' is already registered")
      expect(run.exitCode).toBe(0)
      // 같은 입력이면 바이트 단위로 같은 메시지
      const again = await runSidecar(b, listRequest(b, ['TuningLike']))
      expect(normalized(again)).toEqual(normalized(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '던지는 등록기는 error registrar(스택 포함)로 알리고, 던지기 전의 등록과 다음 등록기는 남는다',
    async () => {
      const run = await runSidecar(b, listRequest(b, ['TuningLike', 'ThrowingRegistrar']))
      const failed = errors(run)
      expect(failed).toHaveLength(1)
      expect(failed[0]).toMatchObject({
        kind: 'registrar',
        exception: 'java.lang.IllegalStateException',
        thread: 'OpModeThread'
      })
      expect(failed[0].message).toContain(`${PACKAGE}.ThrowingRegistrar.register threw`)
      expect(failed[0].message).toContain('registrar broke')
      expect(failed[0].stack[0]).toMatchObject({
        className: `${PACKAGE}.ThrowingRegistrar`,
        method: 'register',
        source: source('ThrowingRegistrar')
      })
      // 클래스 이름 순: ThrowingRegistrar → TuningLike
      const names = registered(run).map((op) => op.name)
      expect(names[0]).toBe('BeforeThrow')
      expect(names.slice(1)).toEqual(TUNING_LIKE.map((op) => op.name))
      expect(finishedReason(run)).toBe('listed')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '목록의 등록기 sleep은 가상 시간만 보낸다(틱 답을 기다리지 않는다)',
    async () => {
      const run = await runSidecar(b, listRequest(b, ['SleepyRegistrar']))
      expect(errors(run)).toEqual([])
      expect(registered(run).map((op) => op.name)).toEqual(['Slept10'])
      expect(finishedReason(run)).toBe('listed')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '시계를 쓰지 않고 끝없이 도는 등록기는 감시가 stall로 알리고 끝낸다(registered 없음)',
    async () => {
      const run = await runSidecar(
        b,
        listRequest(b, ['SpinningRegistrar', 'TuningLike'], { stallMillis: 500 })
      )
      expect(errors(run)).toEqual([
        expect.objectContaining({ kind: 'stall', thread: 'OpModeThread' })
      ])
      expect(errors(run)[0].message).toContain('@OpModeRegistrar')
      expect(registered(run)).toEqual([])
      expect(finishedReason(run)).toBe('exception')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '등록기 소스가 깨지면 컴파일 오류로 끝난다(Android Studio와 같다)',
    async () => {
      const dir = testTempDir('broken-registrar')
      const pkg = join(dir, ...PACKAGE.split('.'))
      mkdirSync(pkg, { recursive: true })
      writeFileSync(
        join(pkg, 'Broken.java'),
        `package ${PACKAGE};\nimport com.qualcomm.robotcore.eventloop.opmode.*;\npublic class Broken {\n  @OpModeRegistrar public static void register(OpModeManager m) { m.register("X", nope()); }\n}\n`
      )
      const run = await runSidecar(
        b,
        listRequest(b, [], {
          sourceRoots: [dir],
          registrars: [{ className: `${PACKAGE}.Broken`, source: join(pkg, 'Broken.java') }]
        })
      )
      expect(run.messages[1]).toMatchObject({ type: 'compiled', ok: false })
      expect(finishedReason(run)).toBe('compileFailed')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '실행: 인스턴스로 등록한 OpMode는 등록기가 만든 그 인스턴스가, 클래스로 등록한 OpMode는 새 인스턴스가 돈다',
    async () => {
      const instance = await runSidecar(
        b,
        runRequest(b, {
          registeredName: 'LateralFactoryTuner',
          registrars: [registrar('TuningLike')]
        }),
        { 5: ['start'] }
      )
      expect(errors(instance)).toEqual([])
      expect(results(instance)).toMatchObject({
        label: 'Lateral',
        hardwareMap: 'true',
        started: 'Lateral'
      })
      expect(finishedReason(instance)).toBe('returned')

      const byClass = await runSidecar(
        b,
        runRequest(b, { registeredName: 'SplineLike', registrars: [registrar('TuningLike')] }),
        { 5: ['start'] }
      )
      expect(errors(byClass)).toEqual([])
      // 등록기는 클래스만 넘겼으므로 이 실행에서 만든 인스턴스는 하나다
      expect(results(byClass)).toMatchObject({ spline: '1' })
      expect(finishedReason(byClass)).toBe('returned')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '등록되지 않은 이름은 error load와 finished loadFailed',
    async () => {
      const run = await runSidecar(
        b,
        runRequest(b, { registeredName: 'Nobody', registrars: [registrar('TuningLike')] })
      )
      expect(errors(run)).toEqual([
        expect.objectContaining({
          kind: 'load',
          message: expect.stringContaining('No OpMode is registered as "Nobody"')
        })
      ])
      expect(finishedReason(run)).toBe('loadFailed')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'annotated OpMode를 실행할 때도 등록기가 먼저 돌고, 수명 알림은 등록 순서로 preInit → preStart → postStop',
    async () => {
      const run = await runSidecar(
        b,
        runRequest(b, {
          opModeSource: source('ListenerOpMode'),
          opModeClass: `${PACKAGE}.ListenerOpMode`,
          registrars: [registrar('ListenerRegistrar')]
        }),
        { 5: ['start'] }
      )
      expect(errors(run)).toEqual([])
      expect(results(run)).toMatchObject({ activeAtRegistrar: 'true', activeIsThis: 'true' })
      expect(outLines(run, 'LIFE ')).toEqual([
        'LIFE registrar preInit ListenerOpMode',
        'LIFE registrar preStart ListenerOpMode',
        'LIFE opMode preStart ListenerOpMode',
        'LIFE body done',
        'LIFE registrar postStop ListenerOpMode',
        'LIFE opMode postStop ListenerOpMode'
      ])
      expect(finishedReason(run)).toBe('returned')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'AppUtil의 폴더는 모의 저장소(firstFolder) 아래이고 Android 객체는 null, 화면 함수는 지원하지 않음',
    async () => {
      const first = testTempDir('first')
      const run = await runSidecar(
        b,
        runRequest(b, {
          opModeSource: source('FoldersOpMode'),
          opModeClass: `${PACKAGE}.FoldersOpMode`,
          firstFolder: first
        }),
        { 5: ['start'] }
      )
      expect(errors(run)).toEqual([])
      expect(results(run)).toMatchObject({
        root: first,
        sameFirst: 'true',
        data: 'data',
        settings: join('settings', 'pid.txt'),
        activity: 'null',
        rc: 'true',
        sdk: '12.0.0',
        readBack: '1.5,2.5',
        toast: 'SimUnsupportedException'
      })
      expect(readFileSync(join(first, 'data', 'pose.txt'), 'utf8')).toBe('1.5,2.5')
      expect(existsSync(join(first, 'settings'))).toBe(true)
      // Road Runner가 클래스패스에 없으면 튜닝 폴더를 만들지 않는다
      expect(existsSync(join(first, 'RoadRunner'))).toBe(false)
      expect(finishedReason(run)).toBe('returned')
    },
    SIDECAR_TEST_TIMEOUT
  )
})

// ---- 실제 Road Runner(scripts/fetch-test-libraries.mjs의 roadrunner·dashboard 묶음) ----

type TestLibraries = { dir: string; jars: Record<string, string>; sets: Record<string, string[]> }

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
  console.warn(`skipping the Road Runner registrar tests: ${reason}`)
  return null
}

const libraries = build ? await fetchLibraries() : null

const RR_RUN = [
  'rrFtc',
  'rrActions',
  'rrCore',
  'kotlinStdlib',
  'jacksonDatabind',
  'jacksonCore',
  'jacksonAnnotations'
]

function roadRunner(b: SidecarBuild): Classpaths {
  const run = RR_RUN.map((id) => libraries!.jars[id])
  return {
    // 팀 Gradle처럼 컴파일은 실제 Dashboard도(Road Runner ftc의 API가 Dashboard 형식을 쓴다)
    compileClasspath: [
      b.sdkJar,
      libraries!.jars.androidxAnnotation,
      ...run,
      libraries!.jars.dashboard,
      libraries!.jars.dashboardCore
    ],
    libraryClasspath: run
  }
}

describe.skipIf(build === null || libraries === null)('등록기 OpMode(실제 Road Runner)', () => {
  const b = build as SidecarBuild

  it(
    'Road Runner 튜닝 OpMode 인스턴스를 등록기로 목록에 넣는다(라이브러리 클래스 이름)',
    async () => {
      const run = await runSidecar(b, listRequest(b, ['RrTuners'], roadRunner(b)))
      expect(errors(run)).toEqual([])
      expect(registered(run)).toEqual([
        {
          name: 'ForwardRampLogger',
          group: 'quickstart',
          flavor: 'TeleOp',
          className: 'com.acmerobotics.roadrunner.ftc.ForwardRampLogger',
          registrar: `${PACKAGE}.RrTuners`,
          transitionTarget: ''
        },
        {
          name: 'LateralRampLogger',
          group: 'quickstart',
          flavor: 'TeleOp',
          className: 'com.acmerobotics.roadrunner.ftc.LateralRampLogger',
          registrar: `${PACKAGE}.RrTuners`,
          transitionTarget: ''
        }
      ])
      expect(finishedReason(run)).toBe('listed')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'TuningFiles 폴더를 실행 전에 만들고, 실행 뒤 새 결과 JSON을 notice rrTuningSaved로 알린다',
    async () => {
      const first = testTempDir('first')
      const request = runRequest(b, {
        opModeSource: source('RrSaveTuning'),
        opModeClass: `${PACKAGE}.RrSaveTuning`,
        firstFolder: first,
        ...roadRunner(b)
      })
      const run = await runSidecar(b, request, { 5: ['start'] })
      expect(errors(run)).toEqual([])
      expect(results(run)).toMatchObject({ saved: 'true' })
      for (const kind of ['forward-ramp', 'lateral-ramp', 'angular-ramp', 'accel'])
        expect(existsSync(join(first, 'RoadRunner', 'tuning', kind))).toBe(true)
      const notices = run.messages.filter((m) => m.type === 'notice')
      expect(notices).toHaveLength(1)
      const notice = notices[0]
      if (notice.type !== 'notice') throw new Error('unreachable')
      expect(notice.code).toBe('rrTuningSaved')
      // 파일 이름은 가상 시계의 currentTimeMillis
      expect(notice.params.path).toMatch(
        /^RoadRunner\/tuning\/forward-ramp\/1700000000\d{3}\.json$/
      )
      const saved = JSON.parse(readFileSync(join(first, ...notice.params.path.split('/')), 'utf8'))
      expect(saved).toEqual({ power: [0.1, 0.2], voltage: 12.5 })
      // notice는 finished 바로 앞
      expect(run.messages.at(-2)).toBe(notice)
      expect(finishedReason(run)).toBe('returned')

      // 두 번째 실행: 이미 있던 결과는 다시 알리지 않는다(같은 시각이면 같은 파일을 덮어써 새 파일이 없다)
      const again = await runSidecar(
        b,
        { ...request, startEpochMillis: 1_700_000_100_000 },
        { 5: ['start'] }
      )
      const second = again.messages.flatMap((m) => (m.type === 'notice' ? [m.params.path] : []))
      expect(second).toHaveLength(1)
      expect(second[0]).not.toBe(notice.params.path)
    },
    SIDECAR_TEST_TIMEOUT
  )
})
