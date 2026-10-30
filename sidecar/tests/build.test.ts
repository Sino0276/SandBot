import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { readZip } from '../../scripts/fetch-ftc-sdk.mjs'
import { SIDECAR_PROTOCOL_VERSION } from '../../src/shared/sidecarProtocol'
import {
  compileJavaTests,
  hasJdk,
  lenientBuild,
  repoRoot,
  runJavaTests,
  runProcess,
  SIDECAR_TEST_TIMEOUT,
  sidecarBuild,
  sidecarReport,
  testTempDir,
  type SidecarBuild
} from './support'

// 가짜 SDK 빌드(scripts/build-sidecar.mjs → org.sandbot.tools.SdkBuild)의 결과를 확인한다. JDK가 없으면 건너뛴다.
// SANDBOT_SIDECAR_LENIENT=1(--allow-missing) 빌드에서는 반드시 있어야 할 클래스·runtime Main 확인을 건너뛴다.

const sdkDir = join(repoRoot, 'sidecar', 'build', 'ftc-sdk')
// 빌드가 들여오기·stub에 쓰는 실제 jar(build-sidecar.mjs의 liftableJars와 같다)
const realJars = [
  ...['RobotCore', 'Hardware', 'FtcCommon', 'Vision'].map((n) =>
    join(sdkDir, '12.0.0', `${n}.jar`)
  ),
  ...['gson-2.8.0', 'gson-extras-0.2.1'].map((n) => join(sdkDir, '12.0.0', 'libs', `${n}.jar`))
]
const androidJar = join(sdkDir, 'android-4.1.1.4.jar')
// FTC Dashboard 층의 기준(scripts/fetch-ftc-sdk.mjs의 ensureFtcDashboard: core jar, AAR의 classes.jar)
const dashboardRealJars = ['core', 'dashboard'].map((n) =>
  join(sdkDir, 'dashboard', '0.6.0', `${n}-0.6.0.jar`)
)
const tools = join(repoRoot, 'sidecar', 'build', 'tools-classes')
const fixtures = join(repoRoot, 'sidecar', 'tests', 'fixtures')

function javaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.java'))
    .map((e) => join(e.parentPath, e.name))
    .sort()
}

function jarEntries(jar: string): string[] {
  return readZip(readFileSync(jar)).names()
}

describe.skipIf(!hasJdk())('사이드카 빌드', () => {
  let build: SidecarBuild

  beforeAll(async () => {
    const result = await sidecarBuild()
    if (!result) throw new Error('JDK disappeared')
    build = result
  }, SIDECAR_TEST_TIMEOUT)

  it('jar·sidecar.json·NOTICE를 쓴다', () => {
    const info = JSON.parse(readFileSync(join(build.dir, 'sidecar.json'), 'utf8'))
    expect(info).toMatchObject({
      sdkVersion: '12.0.0',
      protocol: SIDECAR_PROTOCOL_VERSION,
      javaRelease: 8
    })
    expect(info.sourceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(join(build.dir, 'NOTICE.txt'), 'utf8')).toContain('FIRST')
    // 사이드카는 이 해시를 hello.runtime으로 보낸다
    const runtime = readZip(readFileSync(build.runtimeJar))
    expect(runtime.read('org/sandbot/runtime/source-hash.txt').toString('utf8').trim()).toBe(
      info.sourceHash
    )
    if (!lenientBuild) {
      expect(info.incomplete).toBeUndefined()
      expect(runtime.read('META-INF/MANIFEST.MF').toString('utf8')).toContain(
        'Main-Class: org.sandbot.runtime.Main'
      )
    }
    // sdk jar에는 sim 계약과 SDK가 있고, 빌드 도구는 없다
    const entries = jarEntries(build.sdkJar)
    expect(entries).toContain('org/sandbot/sim/SimUnsupportedException.class')
    expect(entries).toContain('com/qualcomm/robotcore/eventloop/opmode/LinearOpMode.class')
    expect(entries.some((e) => e.startsWith('org/sandbot/tools/'))).toBe(false)
    // FTC Dashboard 대체는 가짜 SDK에 넣지 않고 따로 둔다(팀 Gradle이 Dashboard를 선언할 때만 실행 클래스패스에)
    expect(entries.some((e) => e.startsWith('com/acmerobotics/'))).toBe(false)
    const dashboard = jarEntries(build.dashboardJar).filter((e) => e.endsWith('.class'))
    expect(dashboard).toContain('com/acmerobotics/dashboard/FtcDashboard.class')
    expect(dashboard).toContain('com/acmerobotics/dashboard/telemetry/TelemetryPacket.class')
    expect(dashboard.every((e) => e.startsWith('com/acmerobotics/dashboard/'))).toBe(true)
    const notice = readFileSync(join(build.dir, 'NOTICE.txt'), 'utf8')
    expect(notice).toContain('FTC Dashboard 0.6.0')
    expect(notice).toContain('Copyright (c) 2018-2022 ACME Robotics')
  })

  it.skipIf(lenientBuild)(
    'FTC Dashboard 층: 반드시 있어야 할 형식은 손 구현이거나 들여온 것이고, 스레드를 띄우는 것은 stub이다',
    () => {
      const { dashboard } = sidecarReport(build)
      expect(
        Object.entries(dashboard.mustProvide).filter(
          ([, kind]) => kind !== 'hand' && kind !== 'lifted'
        )
      ).toEqual([])
      expect(dashboard.mustProvide['com.acmerobotics.dashboard.FtcDashboard']).toBe('hand')
      expect(dashboard.mustProvide['com.acmerobotics.dashboard.telemetry.MultipleTelemetry']).toBe(
        'lifted'
      )
      expect(Object.keys(dashboard.stubs)).toEqual(
        expect.arrayContaining([
          'com.acmerobotics.dashboard.DashboardCore',
          'com.acmerobotics.dashboard.hardware.HardwareOpMode',
          'com.acmerobotics.dashboard.limelight.LimelightProxyManager'
        ])
      )
      // SDK 패키지에 더한 손 구현은 Sandbot으로 시작한다
      for (const name of dashboard.hand.filter(
        (n) => n !== 'com.acmerobotics.dashboard.FtcDashboard'
      ))
        expect(name.split('.').at(-1)).toMatch(/^Sandbot/)
      const entries = new Set(jarEntries(build.dashboardJar))
      for (const name of Object.keys(dashboard.mustProvide))
        expect(entries.has(`${name.replace(/\./g, '/')}.class`), name).toBe(true)
    }
  )

  it(
    'FTC Dashboard 대체의 public·protected API가 실제 Dashboard 0.6.0과 같다',
    async () => {
      const result = await runProcess(build.java, [
        '-cp',
        tools,
        'org.sandbot.tools.ApiCheck',
        '--real',
        dashboardRealJars.join(delimiter),
        '--android',
        androidJar,
        '--sdk',
        build.dashboardJar
      ])
      expect(result.output.match(/^error: .*/gm)?.slice(0, 20) ?? []).toEqual([])
      expect(result.code).toBe(0)
      const summary = /checked (\d+) classes, (\d+) constants, 0 errors/.exec(result.output)
      expect(Number(summary?.[1])).toBeGreaterThan(60)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'FTC Dashboard 대체: 들여온 클래스와 손 구현은 JVM에서 불러오고 초기화되며 멤버 참조가 풀리고, stub은 던진다',
    async () => {
      const { dashboard } = sidecarReport(build)
      const classes = jarEntries(build.dashboardJar)
        .filter((e) => e.endsWith('.class'))
        .map((e) => e.slice(0, -'.class'.length).replace(/\//g, '.'))
      const stubTops = new Set(Object.keys(dashboard.stubs))
      const linked = classes.filter((name) => !stubTops.has(name.split('$')[0]))
      const stubs = classes.filter((name) => stubTops.has(name.split('$')[0]))
      expect(linked.length).toBeGreaterThan(dashboard.lifted.length)
      // 보이지 않는(package-private) 묶음은 stub도 없다(limelight의 Forwarder)
      expect(stubs).toEqual(
        expect.arrayContaining([
          'com.acmerobotics.dashboard.DashboardCore',
          'com.acmerobotics.dashboard.hardware.HardwareOpMode',
          'com.acmerobotics.dashboard.limelight.LimelightProxyManager'
        ])
      )
      const dir = testTempDir('dashboard-probe')
      writeFileSync(join(dir, 'linked.txt'), `${linked.join('\n')}\n`)
      writeFileSync(join(dir, 'stubs.txt'), `${stubs.join('\n')}\n`)
      for (const probe of [
        join(fixtures, 'link', 'LinkProbe.java'),
        join(fixtures, 'stub', 'StubProbe.java')
      ]) {
        const compiled = await runProcess(build.javac, [
          '--release',
          '17',
          '-cp',
          build.sdkJar,
          '-d',
          dir,
          probe
        ])
        expect(compiled.code, compiled.output).toBe(0)
      }
      const cp = [dir, build.dashboardJar, build.sdkJar].join(delimiter)
      const link = await runProcess(build.java, ['-cp', cp, 'LinkProbe', join(dir, 'linked.txt')])
      expect(link.output.match(/^FAIL .*/gm)?.slice(0, 20) ?? []).toEqual([])
      expect(link.code).toBe(0)
      expect(Number(/LINKED classes=(\d+)/.exec(link.output)?.[1])).toBe(linked.length)
      const stub = await runProcess(build.java, ['-cp', cp, 'StubProbe', join(dir, 'stubs.txt')])
      expect(stub.output.match(/^FAIL .*/gm)?.slice(0, 20) ?? []).toEqual([])
      expect(stub.code).toBe(0)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it.skipIf(lenientBuild)('반드시 있어야 할 클래스는 손 구현이거나 들여온 것이다', () => {
    const report = sidecarReport(build)
    const notProvided = Object.entries(report.mustProvide).filter(
      ([, kind]) => kind !== 'hand' && kind !== 'lifted'
    )
    expect(notProvided).toEqual([])
    const entries = new Set(jarEntries(build.sdkJar))
    for (const name of Object.keys(report.mustProvide))
      expect(entries.has(`${name.replace(/\./g, '/')}.class`), name).toBe(true)
  })

  it(
    'sdk jar의 public·protected API가 실제 SDK와 같다(상수 값 포함)',
    async () => {
      const result = await runProcess(build.java, [
        '-cp',
        tools,
        'org.sandbot.tools.ApiCheck',
        '--real',
        realJars.join(delimiter),
        '--android',
        androidJar,
        '--sdk',
        build.sdkJar
      ])
      expect(result.output.match(/^error: .*/gm)?.slice(0, 20) ?? []).toEqual([])
      expect(result.code).toBe(0)
      const summary = /checked (\d+) classes, (\d+) constants, 0 errors/.exec(result.output)
      expect(summary).not.toBeNull()
      expect(Number(summary![1])).toBeGreaterThan(1000)
      expect(Number(summary![2])).toBeGreaterThan(500)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'stub의 메서드·생성자는 SimUnsupportedException을 던지고 정적 초기화는 던지지 않는다',
    async () => {
      const report = sidecarReport(build)
      const stubTops = new Set(Object.keys(report.stubs))
      const stubClasses = jarEntries(build.sdkJar)
        .filter((e) => e.endsWith('.class'))
        .map((e) => e.slice(0, -'.class'.length).replace(/\//g, '.'))
        .filter((name) => stubTops.has(name.split('$')[0]))
      expect(stubClasses.length).toBeGreaterThan(100)
      const dir = testTempDir('stub-probe')
      const list = join(dir, 'stubs.txt')
      writeFileSync(list, `${stubClasses.join('\n')}\n`)
      const compiled = await runProcess(build.javac, [
        '--release',
        '8',
        '-Xlint:-options',
        '-cp',
        build.sdkJar,
        '-d',
        dir,
        join(fixtures, 'stub', 'StubProbe.java')
      ])
      expect(compiled.code, compiled.output).toBe(0)
      const run = await runProcess(build.java, [
        '-cp',
        [dir, build.sdkJar].join(delimiter),
        'StubProbe',
        list
      ])
      expect(run.output.match(/^FAIL .*/gm)?.slice(0, 20) ?? []).toEqual([])
      expect(run.code).toBe(0)
      const checked = /CHECKED classes=(\d+) methods=(\d+) constructors=(\d+)/.exec(run.output)
      expect(checked).not.toBeNull()
      expect(Number(checked![2])).toBeGreaterThan(100)
      expect(Number(checked![3])).toBeGreaterThan(100)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '들여온 클래스와 손 구현은 JVM에서 불러오고 초기화되며 모든 멤버 참조가 풀린다',
    async () => {
      // 빌드의 링크 확인(Lifter)과 따로, 실제 JVM으로 확인한다: 실행하지 않은 길의 NoSuchMethodError 등도 미리 찾는다
      const report = sidecarReport(build)
      const tops = new Set([...report.lifted, ...report.hand])
      const classes = jarEntries(build.sdkJar)
        .filter((e) => e.endsWith('.class') && !e.endsWith('package-info.class'))
        .map((e) => e.slice(0, -'.class'.length).replace(/\//g, '.'))
        .filter((name) => tops.has(name.split('$')[0]))
      expect(classes.length).toBeGreaterThan(report.lifted.length)
      const dir = testTempDir('link-probe')
      const list = join(dir, 'classes.txt')
      writeFileSync(list, `${classes.join('\n')}\n`)
      const compiled = await runProcess(build.javac, [
        '--release',
        '17',
        '-d',
        dir,
        join(fixtures, 'link', 'LinkProbe.java')
      ])
      expect(compiled.code, compiled.output).toBe(0)
      const run = await runProcess(build.java, [
        '-cp',
        [dir, build.sdkJar].join(delimiter),
        'LinkProbe',
        list
      ])
      expect(run.output.match(/^FAIL .*/gm)?.slice(0, 20) ?? []).toEqual([])
      expect(run.code).toBe(0)
      const linked = /LINKED classes=(\d+) refs=(\d+)/.exec(run.output)
      expect(Number(linked?.[1])).toBe(classes.length)
      expect(Number(linked?.[2])).toBeGreaterThan(5000)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '상수는 컴파일 시간 상수로 남고, 상수가 아닌 static final은 상수가 되지 않는다',
    async () => {
      const dir = testTempDir('constants')
      const javac = (file: string): ReturnType<typeof runProcess> =>
        runProcess(build.javac, [
          '--release',
          '8',
          '-Xlint:-options',
          '-cp',
          build.sdkJar,
          '-d',
          dir,
          join(fixtures, 'constants', file)
        ])
      const ok = await javac('ConstantUse.java')
      expect(ok.code, ok.output).toBe(0)
      const run = await runProcess(build.java, [
        '-cp',
        [dir, build.sdkJar].join(delimiter),
        'ConstantUse'
      ])
      expect(run.stdout.trim()).toBe('1 1')
      const notConstant = await javac('NotConstant.java')
      expect(notConstant.code).not.toBe(0)
      expect(notConstant.output).toMatch(/constant expression required/)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'API 대조가 실제와 다른 손 구현을 잡는다',
    async () => {
      const check = async (fixture: string): Promise<{ code: number; output: string }> => {
        const dir = testTempDir(`apicheck-${fixture}`)
        const compiled = await runProcess(build.javac, [
          '--release',
          '8',
          '-Xlint:-options',
          '-proc:none',
          '-cp',
          realJars.join(delimiter),
          '-d',
          dir,
          ...javaFiles(join(fixtures, 'apicheck', fixture))
        ])
        expect(compiled.code, compiled.output).toBe(0)
        return runProcess(build.java, [
          '-cp',
          tools,
          'org.sandbot.tools.ApiCheck',
          '--real',
          realJars.join(delimiter),
          '--android',
          androidJar,
          '--hand',
          dir
        ])
      }
      const good = await check('good')
      expect(good.output).toMatch(/checked \d+ classes, \d+ constants, 0 errors/)
      expect(good.code).toBe(0)

      const bad = await check('bad')
      expect(bad.code).toBe(1)
      const errors = bad.output.match(/^error: .*/gm) ?? []
      const expected = [
        'com.qualcomm.robotcore.util.Range#scale(DDDDD)D: modifiers [public static] (real) vs [public]',
        'com.qualcomm.robotcore.util.Range#clip(BBB)B: missing method',
        'com.qualcomm.robotcore.util.Range#throwIfRangeIsInvalid(DDD)V: throws [java/lang/IllegalArgumentException] (real) vs []',
        'com.qualcomm.robotcore.util.Range#extra()I: method not in the real API',
        'com.qualcomm.robotcore.util.RangeHelper: not a class of the FTC SDK',
        'com.qualcomm.robotcore.util.ElapsedTime.SECOND_IN_NANO: constant value long 1000000000 (real) vs long 1000000001',
        'com.qualcomm.robotcore.util.ElapsedTime$Resolution: enum constants [SECONDS, MILLISECONDS] (real) vs [MILLISECONDS, SECONDS]',
        // 기준 android.jar(API 16)보다 새 상수는 ApiCheck의 표(실제 android.jar API 37에서 옮김)와 대조한다
        'android.os.Build$VERSION_CODES.S: constant value integer 31 (Android API 37) vs integer 32',
        'android.os.Build$VERSION_CODES.TIRAMISU: constant value integer 33 (Android API 37) vs none',
        'android.os.Build$VERSION_CODES.NOT_A_CODE: field not in the real API'
      ]
      for (const message of expected)
        expect(
          errors.some((line) => line.includes(message)),
          message
        ).toBe(true)
      expect(errors).toHaveLength(expected.length)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'Java 테스트를 컴파일하고 돌려 PASS·FAIL을 읽는다(support.ts)',
    async () => {
      const classes = await compileJavaTests(build, ['sidecar/tests/fixtures/javatest'])
      const result = await runJavaTests(build, classes, ['org.sandbot.fixture.SampleTests'])
      expect(result.passed).toEqual(['org.sandbot.fixture.SampleTests#testPasses'])
      expect(result.failed.map((f) => f.id)).toEqual(['org.sandbot.fixture.SampleTests#testFails'])
      // 실패 내용은 여러 줄(스택)이다
      expect(result.failed[0].detail).toContain('deliberate failure: expected <1> but was <2>')
      expect(result.failed[0].detail).toContain('at org.sandbot.fixture.SampleTests.testFails')
      expect(result.output).toContain('DONE tests=2 failures=1')
    },
    SIDECAR_TEST_TIMEOUT
  )
})
