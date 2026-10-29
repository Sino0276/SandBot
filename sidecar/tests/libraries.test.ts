// 라이브러리 통합 시험(진짜 JVM, 라이브러리 L1 갈래 D): 사이드카(org.sandbot.runtime.Main)에 실제 FTC 라이브러리 jar(scripts/
// fetch-test-libraries.mjs가 고정 해시로 받은 sidecar/build/test-libs/)를 libraryClasspath·compileClasspath로 주고, 팀 코드처럼 쓴
// 시험 OpMode(sidecar/tests/opmodes-libs/)를 돌린다. 호스트는 sim.test.ts처럼 작은 결정적 호스트(틱마다 바로 답, 정한 틱에 START)이고,
// 세계 설명을 주면 운동학 시뮬레이터(KinematicWorld)를 붙인다(SidecarSession과 같은 순서로 그 틱의 답에 입력을 싣는다).
//  - 결정성: 해시 순서 컬렉션(enum·Object 키 HashMap·HashSet, Collectors.toSet·toMap, HashMap::new)이 두 JVM에서 같은 순서
//  - Pedro Pathing 3.0.2: 메카넘 + Pinpoint 로컬라이저로 Follower가 짧은 경로를 따라가 끝나고, 두 번 돌리면 같은 자세열·메시지
//  - FTCLib 2.1.1: CommandOpMode + ParallelCommandGroup·MotorEx(두 JVM에서 같은 메시지), RevIMU(BNO055 구성,
//    BHI260AP면 실패와 SDK 안내 경고), command.old.CommandOpMode의 스레드 풀 오류 안내
//  - Ivy 1.1.1: parallel(두 JVM에서 같은 메시지)
//  - 라이브러리 클래스의 System.nanoTime이 가상 시계(패치), 링크 검사(linkReport: 일부러 없는 멤버를 참조하는 작은 jar, 실제 라이브러리)
//  - List.of·Set.of·Map.of를 쓰는 OpMode가 시험 플랫폼 jar(bootClasspath)로 컴파일되고(없으면 --release 8로 컴파일 오류)
// JDK가 없으면 모두 건너뛴다. 라이브러리를 받지 못하면(오프라인) 라이브러리 시험만 이유를 출력하고 건너뛴다
// (SANDBOT_TEST_LIBRARIES_REQUIRED=1이면 실패).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type CompiledMessage,
  type DsEvent,
  type ErrorMessage,
  type HostMessage,
  type LinkReportMessage,
  type RunRequest,
  type SidecarMessage
} from '../../src/shared/sidecarProtocol'
import { KinematicWorld } from '../../src/shared/sim/world'
import { WORLD_SPEC_VERSION, type SimPose, type WorldSpec } from '../../src/shared/sim/worldSpec'
import {
  compileJavaTests,
  repoRoot,
  runJavaTests,
  runProcess,
  SIDECAR_TEST_TIMEOUT,
  sidecarBuild,
  testTempDir,
  type SidecarBuild
} from './support'

const build = await sidecarBuild()

const OPMODES = resolve(__dirname, 'opmodes-libs')
const FIXTURES = resolve(__dirname, 'fixtures')
const PACKAGE = 'org.firstinspires.ftc.teamcode'
const LIB_BOT = join(OPMODES, 'sandbot_lib_bot.xml')
const BNO055_BOT = join(OPMODES, 'sandbot_bno055_bot.xml')
const START_TICK = 4

// ---- 실제 라이브러리(scripts/fetch-test-libraries.mjs) ----

type TestLibraries = { dir: string; jars: Record<string, string> }

const SETS = {
  pedro: ['pedroCore', 'pedroRevhub'],
  ivy: ['ivyCore', 'ivyPedro', 'pedroCore', 'pedroRevhub'],
  ftclib: [
    'ftclibCore',
    'ejmlSimple',
    'ejmlCore',
    'ejmlFdense',
    'ejmlDdense',
    'ejmlCdense',
    'ejmlZdense',
    'ejmlDsparse',
    'ejmlFsparse',
    'jsr305'
  ]
} as const

async function fetchLibraries(): Promise<TestLibraries | null> {
  // 프록시 뒤에서도 받게(Node의 fetch는 NODE_USE_ENV_PROXY가 있어야 HTTPS_PROXY를 쓴다): 새 프로세스로 부른다
  const result = await runProcess(
    process.execPath,
    [join(repoRoot, 'scripts', 'fetch-test-libraries.mjs'), '--json'],
    { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' }
  )
  const last = result.stdout.trim().split('\n').at(-1) ?? ''
  if (result.code === 0 && last.startsWith('{')) return JSON.parse(last) as TestLibraries
  const reason = `cannot fetch the test libraries (scripts/fetch-test-libraries.mjs exit ${result.code}):\n${result.output.trim().split('\n').slice(-5).join('\n')}`
  if (process.env.SANDBOT_TEST_LIBRARIES_REQUIRED === '1') throw new Error(reason)
  console.warn(`skipping the library integration tests: ${reason}`)
  return null
}

const libraries = build ? await fetchLibraries() : null

function jars(...sets: (keyof typeof SETS)[]): string[] {
  const out: string[] = []
  for (const set of sets)
    for (const id of SETS[set])
      if (!out.includes(libraries!.jars[id])) out.push(libraries!.jars[id])
  return out
}

/** 팀 Gradle처럼: 컴파일은 가짜 SDK + androidx.annotation + 라이브러리, 실행은 라이브러리 */
function withLibraries(b: SidecarBuild, ...sets: (keyof typeof SETS)[]): Partial<RunRequest> {
  const libs = jars(...sets)
  return {
    compileClasspath: [b.sdkJar, libraries!.jars.androidxAnnotation, ...libs],
    libraryClasspath: libs
  }
}

// ---- 로봇(sim.test.ts와 같은 메카넘 + Pinpoint + 내장 IMU) ----

const LX = 0.168
const LY = 0.18
const RADIUS = 0.052
const HALF = 0.2286

const SPEC: WorldSpec = {
  version: WORLD_SPEC_VERSION,
  robot: {
    start: { x: -0.5, y: 0.2, yaw: 0 },
    footprint: [
      { x: HALF, y: HALF },
      { x: -HALF, y: HALF },
      { x: -HALF, y: -HALF },
      { x: HALF, y: -HALF }
    ]
  },
  batteryVoltage: 12.5,
  hubs: ['Control Hub'],
  motors: [
    { device: 'frontLeft', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: -1 },
    { device: 'frontRight', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: 1 },
    { device: 'backLeft', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: -1 },
    { device: 'backRight', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: 1 }
  ],
  wheels: (
    [
      ['frontLeft', LX, LY, 'flbr'],
      ['frontRight', LX, -LY, 'frbl'],
      ['backLeft', -LX, LY, 'frbl'],
      ['backRight', -LX, -LY, 'flbr']
    ] as const
  ).map(([motor, x, y, rollers]) => ({
    position: { x, y },
    angle: 0,
    kind: 'mecanum' as const,
    rollers,
    radius: RADIUS,
    gearRatio: 1,
    motor
  })),
  deadWheels: [],
  pinpoints: [
    {
      device: 'pinpoint',
      xPod: { x: 0.03, y: 0.1 },
      yPod: { x: -0.08, y: -0.02 },
      podTicksPerMm: 19.89436789,
      xReversed: false,
      yReversed: false
    }
  ],
  otos: [],
  imus: [{ device: 'imu' }]
}

// ---- 결정적 호스트 ----

type Host = {
  opMode: string
  request?: Partial<RunRequest>
  // 시뮬레이터(없으면 입력 없이 답한다)
  world?: WorldSpec
  events?: Record<number, DsEvent[]>
  // 이 틱 수를 넘으면 shutdown(끝나지 않는 OpMode의 안전장치)
  maxTicks?: number
}

type Run = {
  messages: SidecarMessage[]
  raw: string[]
  // 틱마다 step 뒤의 자세
  poses: { tNanos: number; pose: SimPose }[]
  // 메시지 종류 → 처음 받은 실제 시각(ms)
  arrivedAt: Record<string, number>
  stderr: string
}

function runRequest(b: SidecarBuild, host: Host): RunRequest {
  return {
    type: 'run',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots: [OPMODES],
    opModeSource: join(OPMODES, ...PACKAGE.split('.'), `${host.opMode}.java`),
    opModeClass: `${PACKAGE}.${host.opMode}`,
    bootClasspath: [],
    compileClasspath: [b.sdkJar],
    libraryClasspath: [],
    configXml: null,
    timing: {},
    jitter: 0,
    seed: 0,
    startEpochMillis: 1_700_000_000_000,
    stallMillis: 5000,
    ...host.request
  }
}

function runSidecar(b: SidecarBuild, host: Host): Promise<Run> {
  return new Promise((done, fail) => {
    const world = host.world ? new KinematicWorld(host.world) : null
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
    const run: Run = { messages: [], raw: [], poses: [], arrivedAt: {}, stderr: '' }
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
      run.arrivedAt[message.type] ??= Date.now()
      if (message.type === 'finished') finished = true
      if (finished || message.type !== 'tick') return
      if (host.maxTicks !== undefined && message.tick > host.maxTicks) {
        send({ type: 'shutdown' })
        return
      }
      const inputs = world ? world.step(message.tNanos, message.outputs) : {}
      if (world) run.poses.push({ tNanos: message.tNanos, pose: world.pose() })
      send({
        type: 'tickReply',
        tick: message.tick,
        events: host.events?.[message.tick] ?? (message.tick === START_TICK ? ['start'] : []),
        gamepads: [null, null],
        inputs
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
    child.on('close', () => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      done(run)
    })
    send(runRequest(b, host))
  })
}

/** "RESULT a=1 b=2" 줄들 → { a: '1', b: '2' } */
function results(run: Run): Record<string, string> {
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

function resultAt(run: Run): number {
  const line = run.messages.find(
    (m) => m.type === 'log' && m.stream === 'out' && m.text.startsWith('RESULT ')
  )
  if (!line || line.type !== 'log')
    throw new Error(`no RESULT line\n${run.raw.slice(-5).join('\n')}`)
  return line.tNanos
}

function finishedReason(run: Run): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

function errors(run: Run): ErrorMessage[] {
  return run.messages.filter((m): m is ErrorMessage => m.type === 'error')
}

function compiled(run: Run): CompiledMessage | undefined {
  return run.messages.find((m): m is CompiledMessage => m.type === 'compiled')
}

function linkReport(run: Run): LinkReportMessage | undefined {
  return run.messages.find((m): m is LinkReportMessage => m.type === 'linkReport')
}

/** 실패했을 때 보일 것(컴파일 진단·오류·stderr 끝) */
function explain(run: Run): string {
  const diagnostics = compiled(run)?.diagnostics.slice(0, 5) ?? []
  return JSON.stringify({ diagnostics, errors: errors(run), stderr: run.stderr.slice(-2000) })
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

function poseAt(run: Run, tNanos: number): SimPose {
  const before = run.poses.filter((p) => p.tNanos <= tNanos)
  return before[before.length - 1].pose
}

const INCH = 0.0254
const ALL_PARTS =
  'ARM,CLAW,LIFT,WRIST,DRIVE,INTAKE,SHOOTER,TURRET,HOOD,FEEDER,CLIMBER,LED,CAMERA,GATE,SPINNER,PUSHER'

// ---- 시험 ----

describe.skipIf(build === null)('결정성: 해시 순서 컬렉션', () => {
  const b = build as SidecarBuild

  it(
    '팀 코드의 enum·Object 키 HashMap·HashSet, Collectors.toSet·toMap, HashMap::new가 두 JVM에서 같은 순서다(삽입 순서)',
    async () => {
      const first = await runSidecar(b, { opMode: 'HashOrder' })
      expect(compiled(first)?.ok, explain(first)).toBe(true)
      expect(errors(first), explain(first)).toEqual([])
      expect(finishedReason(first)).toBe('returned')
      const r = results(first)
      // 삽입 순서(LinkedHashMap·LinkedHashSet)
      expect(r.enumMap).toBe(ALL_PARTS)
      const ids = Array.from({ length: 24 }, (_, i) => `c${i}`).join(',')
      expect(r.objectSet).toBe(ids)
      expect(r.collectorsToSet).toBe(ids)
      expect(r.collectorsToMap).toBe(ids)
      expect(r.constructorRef).toBe(ALL_PARTS)
      const second = await runSidecar(b, { opMode: 'HashOrder' })
      expect(normalized(second)).toEqual(normalized(first))
    },
    SIDECAR_TEST_TIMEOUT
  )
})

describe.skipIf(build === null)('결정성 패치·라이브러리 로더(Java 단위 시험)', () => {
  const b = build as SidecarBuild

  it(
    'OrderedCollections가 JDK와 같은 내용·예외이고 삽입 순서다, ClassPatcher 대상 표, LibraryClassLoader(패치·멀티 릴리스·리소스·서명·부모 우선)',
    async () => {
      const classes = await compileJavaTests(b, [resolve(__dirname, 'java')])
      const result = await runJavaTests(b, classes, [
        'org.sandbot.runtime.patch.OrderedCollectionsTest',
        'org.sandbot.runtime.patch.ClassPatcherTest',
        'org.sandbot.runtime.LibraryLoaderTest'
      ])
      expect(result.failed).toEqual([])
      for (const name of ['OrderedCollectionsTest', 'ClassPatcherTest', 'LibraryLoaderTest'])
        expect(result.passed.filter((id) => id.includes(`.${name}#`)).length, name).toBeGreaterThan(
          4
        )
    },
    SIDECAR_TEST_TIMEOUT
  )
})

describe.skipIf(build === null)('컴파일 기준: Android 플랫폼 API(bootClasspath)', () => {
  const b = build as SidecarBuild

  // 갈래 A의 시험 플랫폼 jar(sidecar/build/test-platform.jar)가 있으면 그것, 없으면 같은 것(java.base의 java/**·javax/**)을 만든다
  async function platformJar(): Promise<string> {
    const shared = join(repoRoot, 'sidecar', 'build', 'test-platform.jar')
    if (existsSync(shared)) return shared
    const out = join(testTempDir('platform'), 'test-platform.jar')
    const made = await runProcess(b.java, [join(FIXTURES, 'platform', 'MakePlatformJar.java'), out])
    if (made.code !== 0) throw new Error(`MakePlatformJar failed:\n${made.output}`)
    return out
  }

  it(
    'List.of·Set.of·Map.of를 쓰는 OpMode가 플랫폼 jar로 -source 8 컴파일되고(Set.of·Map.of는 삽입 순서), 없으면 --release 8 오류다',
    async () => {
      const platform = await platformJar()
      const run = await runSidecar(b, {
        opMode: 'Java9Apis',
        request: { bootClasspath: [platform] }
      })
      expect(compiled(run)?.ok, explain(run)).toBe(true)
      expect(errors(run)).toEqual([])
      expect(results(run)).toEqual({
        list: 'x,y,z',
        set: 'lift,arm,claw,wrist,intake,hood,turret,gate',
        map: 'one,two,three,four,five'
      })

      const release8 = await runSidecar(b, { opMode: 'Java9Apis' })
      expect(compiled(release8)?.ok).toBe(false)
      expect(compiled(release8)?.diagnostics[0]).toMatchObject({
        kind: 'error',
        code: expect.stringMatching(/^compiler\.err\.cant\.resolve/)
      })
      expect(finishedReason(release8)).toBe('compileFailed')
    },
    SIDECAR_TEST_TIMEOUT
  )
})

describe.skipIf(build === null)('링크 검사(linkReport)', () => {
  const b = build as SidecarBuild

  async function javac(out: string, classpath: string[], sources: string): Promise<void> {
    const files = readdirSync(sources, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.java'))
      .map((e) => join(e.parentPath, e.name))
    const result = await runProcess(b.javac, [
      '--release',
      '8',
      '-Xlint:-options',
      '-proc:none',
      '-cp',
      classpath.join(delimiter),
      '-d',
      out,
      ...files
    ])
    if (result.code !== 0) throw new Error(`javac failed:\n${result.output}`)
  }

  // User(v1 Api·Gone에 대고 컴파일) + gone()이 없는 v2 Api만 담은 jar
  async function brokenJar(): Promise<string> {
    const dir = testTempDir('linkcheck')
    const v1 = join(dir, 'v1')
    const v2 = join(dir, 'v2')
    const stage = join(dir, 'stage')
    for (const d of [v1, v2, stage]) mkdirSync(d, { recursive: true })
    await javac(v1, [b.sdkJar], join(FIXTURES, 'linkcheck', 'api-v1'))
    await javac(v1, [b.sdkJar, v1], join(FIXTURES, 'linkcheck', 'user'))
    await javac(v2, [b.sdkJar], join(FIXTURES, 'linkcheck', 'api-v2'))
    const jarTool = join(b.jdkHome, 'bin', process.platform === 'win32' ? 'jar.exe' : 'jar')
    const out = join(dir, 'broken-lib.jar')
    const made = await runProcess(jarTool, [
      'cf',
      out,
      '-C',
      v1,
      'linkdemo/User.class',
      '-C',
      v2,
      'linkdemo/Api.class'
    ])
    if (made.code !== 0) throw new Error(`jar failed:\n${made.output}`)
    return out
  }

  it(
    '없는 클래스·멤버, 가짜 SDK가 지원하지 않는 멤버를 알리고(있는 것은 알리지 않는다) 실행은 막지 않는다. 두 번 돌리면 같다',
    async () => {
      const jar = await brokenJar()
      const host: Host = {
        opMode: 'HashOrder',
        request: { libraryClasspath: [jar] }
      }
      const run = await runSidecar(b, host)
      const types = run.messages.map((m) => m.type)
      // hello 뒤·compiled 전
      expect(types.slice(0, 3)).toEqual(['hello', 'linkReport', 'compiled'])
      const warnings = linkReport(run)!.warnings
      expect(warnings).toEqual([
        { jar, kind: 'missingMember', from: 'linkdemo.User', target: 'linkdemo.Api#gone()I' },
        { jar, kind: 'missingClass', from: 'linkdemo.User', target: 'linkdemo.Gone' },
        {
          jar,
          kind: 'unsupported',
          from: 'linkdemo.User',
          target: 'org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta$Builder#<init>()V'
        },
        {
          jar,
          kind: 'unsupported',
          from: 'linkdemo.User',
          target: 'com.qualcomm.robotcore.util.RobotLog#getLogFilename()Ljava/lang/String;'
        }
      ])
      expect(finishedReason(run)).toBe('returned')
      const again = await runSidecar(b, host)
      expect(normalized(again)).toEqual(normalized(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '라이브러리 jar가 없으면 loadFailed(internal)',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'HashOrder',
        request: { libraryClasspath: [join(testTempDir('missing'), 'nope.jar')] }
      })
      expect(errors(run)[0]).toMatchObject({ kind: 'internal' })
      expect(errors(run)[0].message).toContain('library jar not found')
      expect(finishedReason(run)).toBe('loadFailed')
    },
    SIDECAR_TEST_TIMEOUT
  )
})

describe.skipIf(build === null || libraries === null)('실제 라이브러리', () => {
  const b = build as SidecarBuild

  it(
    '라이브러리 클래스의 System.nanoTime·ElapsedTime도 가상 시계다(LibraryClassLoader가 패치), Build.VERSION.SDK_INT는 25',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'LibraryClock',
        request: withLibraries(b, 'pedro', 'ftclib')
      })
      expect(compiled(run)?.ok, explain(run)).toBe(true)
      expect(errors(run), explain(run)).toEqual([])
      const r = results(run)
      expect(Number(r.pedro)).toBe(400)
      expect(Number(r.ftclib)).toBe(400)
      expect(r.sdk).toBe('25')
      expect(r.loader).toBe('LibraryClassLoader')
      expect(r.team).toBe('TeamClassLoader')
      expect(finishedReason(run)).toBe('returned')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'Pedro 3.0.2: 메카넘 + Pinpoint로 Follower가 앞으로 24 in 경로를 따라가 끝난다. 두 번 돌리면 같은 자세열·메시지',
    async () => {
      const host: Host = {
        opMode: 'PedroFollow',
        world: SPEC,
        request: { ...withLibraries(b, 'pedro'), configXml: LIB_BOT },
        maxTicks: 4000
      }
      const run = await runSidecar(b, host)
      expect(compiled(run)?.ok, explain(run)).toBe(true)
      expect(errors(run), explain(run)).toEqual([])
      expect(linkReport(run)?.warnings).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      const r = results(run)
      expect(r.busy).toBe('false')
      // Pedro가 본 자세(Pinpoint, in)
      expect(Number(r.x)).toBeGreaterThan(22)
      expect(Number(r.x)).toBeLessThan(26)
      expect(Math.abs(Number(r.y))).toBeLessThan(1.5)
      const heading = Number(r.h)
      expect(Math.min(heading, 2 * Math.PI - heading)).toBeLessThan(0.05)
      expect(Number(r.millis)).toBeLessThan(8000)
      // 시뮬레이터의 실제 자세(Pinpoint는 펌웨어처럼 포드 틱으로 적분하므로 거의 같다)
      const end = poseAt(run, resultAt(run))
      expect((end.x - SPEC.robot.start.x) / INCH).toBeCloseTo(Number(r.x), 0)
      expect(Math.abs(end.y - SPEC.robot.start.y) / INCH).toBeLessThan(1.5)

      const again = await runSidecar(b, host)
      expect(JSON.stringify(again.poses)).toBe(JSON.stringify(run.poses))
      expect(normalized(again)).toEqual(normalized(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'FTCLib 2.1.1: CommandOpMode + ParallelCommandGroup·MotorEx가 넣은 순서로 돌고, 두 JVM에서 메시지가 같다',
    async () => {
      const host: Host = {
        opMode: 'FtcLibCommands',
        world: SPEC,
        request: { ...withLibraries(b, 'ftclib'), configXml: LIB_BOT },
        maxTicks: 4000
      }
      const run = await runSidecar(b, host)
      expect(compiled(run)?.ok, explain(run)).toBe(true)
      expect(errors(run), explain(run)).toEqual([])
      const r = results(run)
      expect(r.order).toBe('fl,fr,bl,br,fl2,fr2')
      expect(Number(r.waited)).toBeGreaterThanOrEqual(500)
      expect(Number(r.waited)).toBeLessThan(560)
      expect(finishedReason(run)).toBe('returned')
      // 모터가 실제로 돌았다(앞으로)
      expect(poseAt(run, resultAt(run)).x - SPEC.robot.start.x).toBeGreaterThan(0.05)
      const again = await runSidecar(b, host)
      expect(normalized(again)).toEqual(normalized(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'FTCLib RevIMU: BNO055 구성에서는 옛 BNO055IMU로 같은 칩을 읽고(칩 축 방향 = IMU 요), BHI260AP 구성에서는 실제처럼 실패한다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'FtcLibRevImu',
        world: SPEC,
        request: { ...withLibraries(b, 'ftclib'), configXml: BNO055_BOT },
        maxTicks: 4000
      })
      expect(compiled(run)?.ok, explain(run)).toBe(true)
      expect(errors(run), explain(run)).toEqual([])
      const r = results(run)
      const yawDeg = (poseAt(run, resultAt(run)).yaw * 180) / Math.PI
      expect(yawDeg).toBeGreaterThan(20)
      // 칩 축(허브 로고 위·USB 앞) = 로봇 축: 옛 API의 방향과 IMU 요가 같은 칩 값이고 시뮬레이터 요와 맞다(로봇은 BRAKE로 섰다)
      expect(Math.abs(Number(r.heading) - Number(r.yaw))).toBeLessThan(0.01)
      expect(Math.abs(Number(r.heading) - yawDeg)).toBeLessThan(0.01)
      expect(r.status).toBe('RUNNING_FUSION')
      expect(r.unit).toBe('DEGREES')
      expect(r.maker).toBe('Lynx')

      const bhi = await runSidecar(b, {
        opMode: 'FtcLibRevImu',
        request: { ...withLibraries(b, 'ftclib'), configXml: LIB_BOT }
      })
      const [error] = errors(bhi)
      expect(error).toMatchObject({
        kind: 'exception',
        exception: 'java.lang.IllegalArgumentException'
      })
      expect(error.message).toContain('BNO055IMU')
      // 실제 HardwareMap.tryGet처럼 IMU 인터페이스로 바꾸라고 알린다(BHI260AP만 있는 지도)
      expect(
        bhi.messages.some(
          (m) =>
            m.type === 'log' &&
            m.text.startsWith('W/GlobalWarning: You attempted to use the BNO055 interface')
        )
      ).toBe(true)
      expect(finishedReason(bhi)).toBe('exception')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'FTCLib command.old.CommandOpMode: 스레드 풀이 모터를 쓰면 error thread와 지금 CommandOpMode를 쓰라는 안내',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'FtcLibOldCommand',
        request: { ...withLibraries(b, 'ftclib'), configXml: LIB_BOT },
        maxTicks: 4000
      })
      const thread = errors(run).find((e) => e.kind === 'thread')
      expect(thread, explain(run)).toBeDefined()
      expect(thread!.thread).toMatch(/^pool-/)
      expect(thread!.message).toContain('com.arcrobotics.ftclib.command.old.CommandOpMode')
      expect(thread!.message).toContain('use com.arcrobotics.ftclib.command.CommandOpMode')
      expect(finishedReason(run)).toBe('exception')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'Ivy 1.1.1: parallel(Map<Command, Boolean>)이 넣은 순서로 돌고 waitMs는 가상 시계, 두 JVM에서 메시지가 같다',
    async () => {
      const host: Host = {
        opMode: 'IvyParallel',
        request: { ...withLibraries(b, 'ivy'), configXml: LIB_BOT },
        maxTicks: 4000
      }
      const run = await runSidecar(b, host)
      expect(compiled(run)?.ok, explain(run)).toBe(true)
      expect(errors(run), explain(run)).toEqual([])
      const r = results(run)
      expect(r.order).toBe('a,b,c,d')
      expect(Number(r.waited)).toBeGreaterThanOrEqual(250)
      expect(Number(r.waited)).toBeLessThan(300)
      expect(finishedReason(run)).toBe('returned')
      expect(linkReport(run)?.warnings).toEqual([])
      const again = await runSidecar(b, host)
      expect(normalized(again)).toEqual(normalized(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '실제 라이브러리의 링크 검사: Pedro·Ivy는 경고 없음, FTCLib은 가짜 SDK에 대어 빠르게(실행을 늦추지 않게) 끝난다',
    async () => {
      const run = await runSidecar(b, {
        opMode: 'HashOrder',
        request: { libraryClasspath: jars('ftclib', 'ivy') }
      })
      const report = linkReport(run)
      expect(report).toBeDefined()
      // FTCLib의 SDK 참조(108개)는 모두 가짜 SDK에 있다(조사 보고 libs-ftclib §4, Build.VERSION.SDK_INT 포함)
      const sdk = report!.warnings.filter((w) =>
        /^(com\.qualcomm|org\.firstinspires|android)\./.test(w.target)
      )
      expect(sdk).toEqual([])
      for (const w of report!.warnings) expect(w.jar).toBe(libraries!.jars.ftclibCore)
      // 링크 검사(hello → linkReport)는 jar 1.6 MB 남짓에 수 초를 넘지 않는다
      const millis = run.arrivedAt.linkReport - run.arrivedAt.hello
      console.log(`link check of ${jars('ftclib', 'ivy').length} jars: ${millis} ms`)
      expect(millis).toBeLessThan(5000)
      expect(finishedReason(run)).toBe('returned')
    },
    SIDECAR_TEST_TIMEOUT
  )
})

// 받은 라이브러리가 sidecar/build/test-libs 안에 있는지(gitignore된 곳)
describe.skipIf(libraries === null)('시험용 라이브러리 받기', () => {
  it('sidecar/build/test-libs(gitignore) 안에 받은 jar가 있다', () => {
    for (const path of Object.values(libraries!.jars)) {
      expect(relative(join(repoRoot, 'sidecar', 'build', 'test-libs'), path).startsWith('..')).toBe(
        false
      )
      expect(statSync(path).size).toBeGreaterThan(1000)
    }
  })
})
