// 사이드카 컴파일 기준 테스트: 팀 코드는 Android Studio처럼 프로젝트 compileSdk의 Android 플랫폼 API(bootClasspath)로
// -source 8 -target 8 컴파일된다. CI에는 Android SDK가 없어 시험 플랫폼 jar(호스트 java.base의 java.*·javax.*,
// sidecar/tests/platform.ts)를 쓴다. 환경 변수 SANDBOT_ANDROID_SDK(SDK 폴더, compileSdk는 SANDBOT_ANDROID_API의 N 또는
// N.M, 없으면 가장 높은 플랫폼)가 있으면 실제 android.jar로도 시험한다(메인의 androidSdk.ts가 고른 플랫폼을 platformJar.ts가
// 거른 jar, FtcRobotController 샘플 포함).
// JDK가 없으면 모두 건너뛴다.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureFtcSamples, FetchError } from '../../scripts/fetch-ftc-sdk.mjs'
import { nodeAndroidSdkFs, resolveAndroidPlatform } from '../../src/main/androidSdk'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type CompileDiagnostic,
  type HostMessage,
  type RunRequest,
  type SidecarMessage
} from '../../src/shared/sidecarProtocol'
import { testPlatformJar } from './platform'
import { runProcess, sidecarBuild, testTempDir, type SidecarBuild } from './support'

const OPMODES = resolve(__dirname, 'opmodes-platform')
const PACKAGE = 'org.firstinspires.ftc.teamcode'
const TIMEOUT = 10 * 60 * 1000

// android.jar(30·34)에 없는 람다 바탕 클래스
const ANDROID_MISSING = ['LambdaMetafactory', 'SerializedLambda'].map(
  (name) => `java/lang/invoke/${name}.class`
)
// Android Gradle 플러그인이 core-lambda-stubs.jar로 덧붙이는 클래스 전부(android-26 전의 플랫폼에는 모두 없다)
const LAMBDA_SUPPORT = [
  'CallSite',
  'LambdaConversionException',
  'LambdaMetafactory',
  'MethodHandle',
  'MethodHandles',
  'MethodHandles$Lookup',
  'MethodType',
  'SerializedLambda'
].map((name) => `java/lang/invoke/${name}.class`)

const build = await sidecarBuild()

type Run = { messages: SidecarMessage[]; stderr: string }

// 사이드카를 띄워 run을 보내고 틱마다 바로 답한다(시작 사건 없음: 시험 OpMode는 INIT 안에서 끝난다)
function runSidecar(
  b: SidecarBuild,
  opModeSource: string,
  opModeClass: string,
  request: Partial<RunRequest>
): Promise<Run> {
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
    const messages: SidecarMessage[] = []
    let stderr = ''
    let pending = ''
    let finished = false
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out\n${stderr}`))
    }, 300_000)
    const onLine = (line: string): void => {
      if (line.trim() === '') return
      const message = JSON.parse(line) as SidecarMessage
      messages.push(message)
      if (message.type === 'finished') finished = true
      if (!finished && message.type === 'tick')
        send({
          type: 'tickReply',
          tick: message.tick,
          events: [],
          gamepads: [null, null],
          inputs: {}
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
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', fail)
    child.on('close', () => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      done({ messages, stderr })
    })
    const run: RunRequest = {
      type: 'run',
      protocol: SIDECAR_PROTOCOL_VERSION,
      clock: 'virtual',
      tickNanos: DEFAULT_TICK_NANOS,
      sourceRoots: [OPMODES],
      opModeSource,
      opModeClass,
      bootClasspath: [],
      compileClasspath: [b.sdkJar],
      libraryClasspath: [],
      configXml: null,
      timing: {},
      jitter: 0,
      seed: 0,
      startEpochMillis: 1_700_000_000_000,
      stallMillis: 2000,
      ...request
    }
    send(run)
  })
}

function runOpMode(b: SidecarBuild, name: string, request: Partial<RunRequest>): Promise<Run> {
  return runSidecar(
    b,
    join(OPMODES, ...PACKAGE.split('.'), `${name}.java`),
    `${PACKAGE}.${name}`,
    request
  )
}

function compiled(run: Run): { ok: boolean; diagnostics: CompileDiagnostic[] } {
  const message = run.messages.find((m) => m.type === 'compiled')
  if (message?.type !== 'compiled') throw new Error(`no compiled message\n${run.stderr}`)
  return message
}

function resultLine(run: Run): string | undefined {
  for (const m of run.messages)
    if (m.type === 'log' && m.stream === 'out' && m.text.startsWith('RESULT ')) return m.text
  return undefined
}

function finishedReason(run: Run): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

const EXPECTED_RESULT = 'RESULT list=a,b lambda=7 ref=0 resource=line_one switch=second'

describe.skipIf(build === null)('컴파일 기준(Android 플랫폼 API)', () => {
  const b = build as SidecarBuild

  it(
    'bootClasspath를 주면 -source 8로 그 API로 컴파일한다(List.of·람다·직렬화 람다)',
    async () => {
      const platform = await testPlatformJar(b)
      const run = await runOpMode(b, 'PlatformApis', { bootClasspath: [platform] })
      expect(compiled(run)).toMatchObject({ ok: true })
      expect(compiled(run).diagnostics.filter((d) => d.kind === 'error')).toEqual([])
      expect(resultLine(run)).toBe(EXPECTED_RESULT)
      expect(finishedReason(run)).toBe('returned')
    },
    TIMEOUT
  )

  it(
    'Build.VERSION_CODES는 android.jar처럼 컴파일 시간 상수다(API 확인 관용구, 애너테이션 값, switch)',
    async () => {
      const platform = await testPlatformJar(b)
      const run = await runOpMode(b, 'PlatformApiGuard', { bootClasspath: [platform] })
      expect(compiled(run).diagnostics.filter((d) => d.kind === 'error')).toEqual([])
      expect(resultLine(run)).toBe(
        'RESULT sdk=25 branch=pre-O release=N_MR1 min=24 codes=30,35,36,10000'
      )
      expect(finishedReason(run)).toBe('returned')
    },
    TIMEOUT
  )

  it(
    'bootClasspath가 비면 지금처럼 --release 8(Java 9 API인 List.of는 컴파일 오류)',
    async () => {
      const run = await runOpMode(b, 'PlatformApis', { bootClasspath: [] })
      const result = compiled(run)
      expect(result.ok).toBe(false)
      expect(result.diagnostics[0]).toMatchObject({
        kind: 'error',
        code: 'compiler.err.cant.resolve.location.args',
        line: 23
      })
      expect(result.diagnostics[0].message).toContain('of(')
      expect(finishedReason(run)).toBe('compileFailed')
    },
    TIMEOUT
  )

  it(
    '플랫폼 API에 없는 패키지는 호스트 JDK에 있어도 컴파일 오류다',
    async () => {
      const platform = await testPlatformJar(b)
      const run = await runOpMode(b, 'PlatformMissingApi', { bootClasspath: [platform] })
      const result = compiled(run)
      expect(result.ok).toBe(false)
      expect(result.diagnostics[0]).toMatchObject({
        kind: 'error',
        code: 'compiler.err.doesnt.exist'
      })
      expect(result.diagnostics[0].message).toBe('package java.net.http does not exist')
      // --release 8도 java.net.http가 없다(Java 11 API)
      const release8 = compiled(await runOpMode(b, 'PlatformMissingApi', { bootClasspath: [] }))
      expect(release8.ok).toBe(false)
    },
    TIMEOUT
  )

  it(
    '플랫폼에 람다 바탕 클래스가 없으면(android.jar처럼) 호스트 JDK의 것으로 채운다',
    async () => {
      const platform = await testPlatformJar(b, { exclude: ANDROID_MISSING })
      // 그 jar만으로는 javac가 람다를 컴파일하지 못한다(이 시험이 뜻이 있다는 확인)
      const out = testTempDir('platform-javac')
      const plain = await runProcess(b.javac, [
        '-source',
        '8',
        '-target',
        '8',
        '-Xlint:-options',
        '-proc:none',
        '-bootclasspath',
        platform,
        '-cp',
        b.sdkJar,
        '-d',
        out,
        join(OPMODES, ...PACKAGE.split('.'), 'PlatformApis.java')
      ])
      expect(plain.code).not.toBe(0)
      expect(plain.output).toContain('method metafactory(')
      const run = await runOpMode(b, 'PlatformApis', { bootClasspath: [platform] })
      expect(compiled(run).diagnostics.filter((d) => d.kind === 'error')).toEqual([])
      expect(resultLine(run)).toBe(EXPECTED_RESULT)
      // java.lang.invoke가 통째로 없는 플랫폼도 채운다(core-lambda-stubs.jar의 여덟 클래스)
      const bare = await testPlatformJar(b, { exclude: LAMBDA_SUPPORT })
      const bareRun = await runOpMode(b, 'PlatformApis', { bootClasspath: [bare] })
      expect(compiled(bareRun).diagnostics.filter((d) => d.kind === 'error')).toEqual([])
      expect(resultLine(bareRun)).toBe(EXPECTED_RESULT)
    },
    TIMEOUT
  )

  it(
    'bootClasspath의 파일이 없으면 진단 하나(sandbot.platformMissing)로 알린다',
    async () => {
      const missing = join(testTempDir('platform-missing'), 'android.jar')
      const run = await runOpMode(b, 'PlatformApis', { bootClasspath: [missing] })
      const result = compiled(run)
      expect(result.ok).toBe(false)
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          kind: 'error',
          code: 'sandbot.platformMissing',
          message: `the Android platform API jar does not exist: ${missing}`
        })
      ])
      expect(finishedReason(run)).toBe('compileFailed')
    },
    TIMEOUT
  )
})

// ───────────────────────── 실제 Android SDK(있을 때만) ─────────────────────────

const androidSdk = process.env.SANDBOT_ANDROID_SDK

// 메인이 INIT 때 고르는 플랫폼(androidSdk.ts의 resolveAndroidPlatform)을 platformJar.ts로 거른 jar. SANDBOT_ANDROID_API가 N이면
// compileSdk N(android-N 또는 android-N.0, Android Gradle 플러그인이 찾는 이름 먼저), N.M이면 부 버전 M(minorApiLevel,
// android-N.M), 없으면 부 버전까지 가장 높은 것. api는 그 플랫폼의 주 버전이다.
async function realPlatform(
  folder: string
): Promise<{ jar: string; api: number; androidJar: string }> {
  // 메인은 절대 경로인 ANDROID_HOME만 쓰므로 작업 폴더 기준 경로도 받게 푼다
  const sdk = resolve(folder)
  const wanted = process.env.SANDBOT_ANDROID_API ?? ''
  const match = /^([1-9]\d*)(?:\.(0|[1-9]\d*))?$/.exec(wanted)
  if (wanted !== '' && !match) throw new Error(`SANDBOT_ANDROID_API is not N or N.M: ${wanted}`)
  const result = await resolveAndroidPlatform(
    testTempDir('platform-project'),
    match ? Number(match[1]) : null,
    match?.[2] === undefined ? null : Number(match[2]),
    {
      platform: process.platform,
      // 이 SDK만 본다(다른 후보는 빈 시험 폴더의 기본 위치뿐, 설정 파일 없음 = 자동)
      env: { ANDROID_HOME: sdk },
      home: testTempDir('platform-home'),
      fs: nodeAndroidSdkFs,
      settingsFile: join(testTempDir('platform-settings'), 'android-sdk.json'),
      cacheDir: testTempDir('platform-cache')
    }
  )
  if (!result.ok) throw new Error(`no platform in ${sdk}: ${result.code} ${result.detail}`)
  // 고른 플랫폼의 원래 android.jar(거른 jar에는 android.*가 없다): 부 버전이 있으면 android-N.M, 없으면 android-N 또는 android-N.0
  const api = result.api ?? 0
  const folders =
    result.minor !== null && result.minor > 0
      ? [`android-${api}.${result.minor}`]
      : [`android-${api}`, `android-${api}.0`]
  const androidJar = folders
    .map((folder) => join(sdk, 'platforms', folder, 'android.jar'))
    .find((jar) => existsSync(jar))
  if (!androidJar) throw new Error(`no android.jar for API ${api} in ${sdk}`)
  return { jar: result.bootClasspath[0], api, androidJar }
}

// 샘플을 패키지 폴더 구조로 옮기고, 모든 샘플 클래스를 참조하는 OpMode 하나를 만든다(-implicit:class로 한 번에 컴파일)
function sampleProject(files: string[]): {
  root: string
  opModeSource: string
  opModeClass: string
} {
  const root = testTempDir('platform-samples')
  const classes: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(text)?.[1]
    if (!pkg) continue
    const name = file
      .split(/[\\/]/)
      .pop()!
      .replace(/\.java$/, '')
    const dir = join(root, ...pkg.split('.'))
    mkdirSync(dir, { recursive: true })
    copyFileSync(file, join(dir, `${name}.java`))
    classes.push(`${pkg}.${name}`)
  }
  const dir = join(root, 'org', 'firstinspires', 'ftc', 'teamcode')
  mkdirSync(dir, { recursive: true })
  const opModeSource = join(dir, 'AllSamples.java')
  writeFileSync(
    opModeSource,
    [
      'package org.firstinspires.ftc.teamcode;',
      '',
      'public class AllSamples extends com.qualcomm.robotcore.eventloop.opmode.LinearOpMode {',
      '    static final Class<?>[] SAMPLES = {',
      ...classes.sort().map((name) => `        ${name}.class,`),
      '    };',
      '',
      '    @Override',
      '    public void runOpMode() {}',
      '}',
      ''
    ].join('\n')
  )
  return { root, opModeSource, opModeClass: 'org.firstinspires.ftc.teamcode.AllSamples' }
}

function errorFiles(diagnostics: CompileDiagnostic[]): string[] {
  return [
    ...new Set(diagnostics.filter((d) => d.kind === 'error').map((d) => d.file ?? '(none)'))
  ].sort()
}

describe.skipIf(build === null || !androidSdk)(
  '실제 Android SDK의 플랫폼 API(SANDBOT_ANDROID_SDK)',
  () => {
    const b = build as SidecarBuild

    it(
      '메인이 고른 플랫폼의 android.jar로 컴파일·실행되고, FtcRobotController 샘플도 --release 8보다 더 깨지지 않는다',
      async (ctx) => {
        const { jar: platform, api: level } = await realPlatform(androidSdk as string)
        const run = await runOpMode(b, 'PlatformApis', { bootClasspath: [platform] })
        expect(compiled(run).diagnostics.filter((d) => d.kind === 'error')).toEqual([])
        if (level >= 30) expect(resultLine(run)).toBe(EXPECTED_RESULT)
        const missing = compiled(
          await runOpMode(b, 'PlatformMissingApi', { bootClasspath: [platform] })
        )
        expect(missing.diagnostics[0]).toMatchObject({ code: 'compiler.err.doesnt.exist' })

        let samples: { dir: string; files: string[] }
        try {
          samples = await ensureFtcSamples({ log: () => {} })
        } catch (error) {
          if (error instanceof FetchError && !/SHA-256/.test((error as Error).message)) {
            ctx.skip()
            return
          }
          throw error
        }
        const project = sampleProject(samples.files)
        const withPlatform = compiled(
          await runSidecar(b, project.opModeSource, project.opModeClass, {
            sourceRoots: [project.root],
            bootClasspath: [platform]
          })
        )
        const withRelease8 = compiled(
          await runSidecar(b, project.opModeSource, project.opModeClass, {
            sourceRoots: [project.root],
            bootClasspath: []
          })
        )
        // 1단계 밖 샘플(비전·안드로이드 UI)은 둘 다 실패한다. 플랫폼 API로 바꿔 새로 깨지는 샘플은 없어야 한다.
        const extra = errorFiles(withPlatform.diagnostics).filter(
          (file) => !errorFiles(withRelease8.diagnostics).includes(file)
        )
        expect(
          extra,
          withPlatform.diagnostics
            .filter((d) => d.kind === 'error' && extra.includes(d.file ?? '(none)'))
            .map((d) => `${d.file}:${d.line}: ${d.message}`)
            .join('\n')
        ).toEqual([])
        expect(errorFiles(withRelease8.diagnostics).length).toBeLessThan(samples.files.length / 2)
      },
      TIMEOUT
    )

    it(
      '가짜 SDK의 Build.VERSION_CODES는 그 android.jar의 상수와 값이 같고, 더 있는 것은 그보다 새 API 번호다',
      async () => {
        const sdk = androidSdk as string
        const { androidJar, api: level } = await realPlatform(sdk)
        const javap = join(b.jdkHome, 'bin', process.platform === 'win32' ? 'javap.exe' : 'javap')
        const constants = async (jar: string): Promise<Map<string, number>> => {
          const result = await runProcess(javap, [
            '-constants',
            '-cp',
            jar,
            'android.os.Build$VERSION_CODES'
          ])
          expect(result.code, result.output).toBe(0)
          return new Map(
            [...result.stdout.matchAll(/public static final int (\w+) = (-?\d+);/g)].map((m) => [
              m[1],
              Number(m[2])
            ])
          )
        }
        const real = await constants(androidJar)
        const fake = await constants(b.sdkJar)
        expect(real.size).toBeGreaterThan(16)
        for (const [name, value] of real) expect(fake.get(name), name).toBe(value)
        for (const [name, value] of fake)
          if (!real.has(name)) expect(value, name).toBeGreaterThan(level)
      },
      TIMEOUT
    )
  }
)
