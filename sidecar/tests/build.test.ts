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
  })

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

  it('sdk jar의 public·protected API가 실제 SDK와 같다(상수 값 포함)', async () => {
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
  })

  it('stub의 메서드·생성자는 SimUnsupportedException을 던지고 정적 초기화는 던지지 않는다', async () => {
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
  })

  it('상수는 컴파일 시간 상수로 남고, 상수가 아닌 static final은 상수가 되지 않는다', async () => {
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
  })

  it('API 대조가 실제와 다른 손 구현을 잡는다', async () => {
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
      'com.qualcomm.robotcore.util.ElapsedTime$Resolution: enum constants [SECONDS, MILLISECONDS] (real) vs [MILLISECONDS, SECONDS]'
    ]
    for (const message of expected)
      expect(
        errors.some((line) => line.includes(message)),
        message
      ).toBe(true)
    expect(errors).toHaveLength(expected.length)
  })

  it('Java 테스트를 컴파일하고 돌려 PASS·FAIL을 읽는다(support.ts)', async () => {
    const classes = await compileJavaTests(build, ['sidecar/tests/fixtures/javatest'])
    const result = await runJavaTests(build, classes, ['org.sandbot.fixture.SampleTests'])
    expect(result.passed).toEqual(['org.sandbot.fixture.SampleTests#testPasses'])
    expect(result.failed.map((f) => f.id)).toEqual(['org.sandbot.fixture.SampleTests#testFails'])
    // 실패 내용은 여러 줄(스택)이다
    expect(result.failed[0].detail).toContain('deliberate failure: expected <1> but was <2>')
    expect(result.failed[0].detail).toContain('at org.sandbot.fixture.SampleTests.testFails')
    expect(result.output).toContain('DONE tests=2 failures=1')
  })
})
