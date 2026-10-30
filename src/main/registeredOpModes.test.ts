import { existsSync } from 'fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JdkInfo, ListOpModesResult, OpModeInfo } from '../shared/play'
import type {
  ErrorMessage,
  ListRequest,
  RegisteredOpMode,
  SidecarMessage
} from '../shared/sidecarProtocol'
import { clearOpModeCache, scanOpModes } from './opModes'
import { clearTrustedRoots, trustRoot } from './projectRoots'
import {
  RegisteredOpModes,
  registeredInfos,
  registrarOfError,
  type RegisteredOpModesDeps
} from './registeredOpModes'
import { javaArgs, simFirstFolder, type SidecarFiles } from './sidecar/launch'
import { FakeProcess } from './sidecar/testkit'

const PKG = 'src/main/java/org/firstinspires/ftc/teamcode'
const TEAM = 'org.firstinspires.ftc.teamcode'
const JDK: JdkInfo = { home: '/fake/jdk', version: '21.0.4', major: 21, source: 'path' }
const FILES: SidecarFiles = {
  dir: '/fake/sidecar',
  runtimeJar: '/fake/sidecar/sandbot-runtime.jar',
  sdkJar: '/fake/sidecar/sandbot-sdk.jar',
  dashboardJar: null
}

const TUNING = [
  `package ${TEAM};`,
  'import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;',
  'import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;',
  'public final class TuningOpModes {',
  '    @OpModeRegistrar',
  '    public static void register(OpModeManager manager) {}',
  '    @OpModeRegistrar public static void more(OpModeManager manager) {}',
  '}',
  ''
].join('\n')

const OTHER = [
  `package ${TEAM}.b;`,
  'import com.qualcomm.robotcore.eventloop.opmode.*;',
  'public class Other {',
  '  @OpModeRegistrar public static void register(OpModeManager m) {}',
  '}',
  ''
].join('\n')

const DRIVE = [
  `package ${TEAM};`,
  'import com.qualcomm.robotcore.eventloop.opmode.*;',
  '@TeleOp(name = "Drive")',
  'public class Drive extends LinearOpMode { @Override public void runOpMode() {} }',
  ''
].join('\n')

const op = (overrides: Partial<RegisteredOpMode>): RegisteredOpMode => ({
  name: 'X',
  group: '$$$$$$$',
  flavor: 'TeleOp',
  className: `${TEAM}.X`,
  instance: true,
  registrar: `${TEAM}.TuningOpModes`,
  transitionTarget: '',
  ...overrides
})

type Script = (request: ListRequest, proc: FakeProcess) => void

// 사이드카처럼 답하는 가짜(요청을 받으면 다음 마이크로태스크에 hello → … → finished → 종료)
function answer(messages: (SidecarMessage | Record<string, unknown>)[]): Script {
  return (_request, proc) => {
    proc.line({ type: 'hello', protocol: 3, runtime: 'test', java: '21' })
    for (const message of messages) proc.line(message)
    proc.exit(0)
  }
}

const listed = (opModes: RegisteredOpMode[], extra: Record<string, unknown>[] = []): Script =>
  answer([
    { type: 'compiled', ok: true, diagnostics: [], millis: 1 },
    ...extra,
    { type: 'registered', opModes },
    { type: 'finished', tNanos: 0, reason: 'listed' }
  ])

describe('RegisteredOpModes', () => {
  let dir: string
  let root: string
  let simRoot: string
  let script: Script
  let requests: ListRequest[]
  let spawned: { command: string; args: string[]; cwd: string }[]
  let hashed: string[]
  let jarHash: string
  let deps: RegisteredOpModesDeps

  const write = async (rel: string, text: string): Promise<string> => {
    const file = join(root, 'TeamCode', rel)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
    return file
  }

  beforeEach(async () => {
    clearTrustedRoots()
    clearOpModeCache()
    dir = await mkdtemp(join(tmpdir(), 'sandbot-registered-'))
    root = join(dir, 'project')
    simRoot = join(dir, 'sim-files')
    await write(`${PKG}/TuningOpModes.java`, TUNING)
    await write(`${PKG}/b/Other.java`, OTHER)
    await write(`${PKG}/Drive.java`, DRIVE)
    trustRoot(root)
    requests = []
    spawned = []
    hashed = []
    jarHash = 'h1'
    script = listed([])
    deps = {
      scan: scanOpModes,
      resolveJdk: async () => JDK,
      locateSidecar: async () => FILES,
      spawn: async (command, args, options) => {
        spawned.push({ command, args, cwd: options.cwd })
        const proc = new FakeProcess()
        const send = proc.send.bind(proc)
        proc.send = (message) => {
          send(message)
          if (message.type === 'list') {
            requests.push(message)
            queueMicrotask(() => script(message, proc))
          }
        }
        return proc
      },
      makeRunDir: () => mkdtemp(join(dir, 'run-')),
      removeRunDir: (path) => rm(path, { recursive: true, force: true }),
      makeFirstFolder: (projectRoot) => simFirstFolder(simRoot, projectRoot),
      platform: 'linux',
      env: {},
      epochMillis: () => 1234,
      hashFile: async (file) => {
        hashed.push(file)
        return jarHash
      }
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('JVM에 list를 보내 등록 결과를 목록 항목으로 바꾼다(TeleOp·Autonomous만, 기본 그룹은 "", 등록기 줄, 정렬)', async () => {
    script = listed([
      op({ name: 'Zeta', group: 'quickstart', className: 'com.acmerobotics.roadrunner.ftc.X' }),
      op({ name: 'Auto', flavor: 'Autonomous', transitionTarget: 'Zeta' }),
      op({ name: 'Util', flavor: 'Utility' }),
      op({ name: 'Sys', flavor: 'System' }),
      op({ name: 'Alpha', registrar: `${TEAM}.b.Other` }),
      // annotated OpMode 클래스의 인스턴스를 그 이름 그대로 등록한 것은 빼고, 다른 이름은 둔다(annotated를 가리지 않는다)
      op({ name: 'Drive', className: `${TEAM}.Drive` }),
      op({ name: 'Drive2', className: `${TEAM}.Drive` })
    ])
    const lister = new RegisteredOpModes(deps)
    const result = await lister.list(root)
    const registered = (registrar: string): { registrar: string } => ({ registrar })
    expect(result).toEqual({
      ok: true,
      replaced: [],
      diagnostics: [],
      errors: [],
      opModes: [
        {
          className: `${TEAM}.X`,
          path: `${PKG}/b/Other.java`,
          line: 4,
          flavor: 'TeleOp',
          name: 'Alpha',
          group: '',
          preselectTeleOp: '',
          registered: registered(`${TEAM}.b.Other`)
        },
        {
          className: `${TEAM}.Drive`,
          path: `${PKG}/TuningOpModes.java`,
          line: 5,
          flavor: 'TeleOp',
          name: 'Drive2',
          group: '',
          preselectTeleOp: '',
          registered: registered(`${TEAM}.TuningOpModes`)
        },
        {
          className: 'com.acmerobotics.roadrunner.ftc.X',
          path: `${PKG}/TuningOpModes.java`,
          line: 5,
          flavor: 'TeleOp',
          name: 'Zeta',
          group: 'quickstart',
          preselectTeleOp: '',
          registered: registered(`${TEAM}.TuningOpModes`)
        },
        {
          className: `${TEAM}.X`,
          path: `${PKG}/TuningOpModes.java`,
          line: 5,
          flavor: 'Autonomous',
          name: 'Auto',
          group: '',
          preselectTeleOp: 'Zeta',
          registered: registered(`${TEAM}.TuningOpModes`)
        }
      ]
    })
    // 요청: 등록기마다 하나(클래스 이름 순, 링크를 확인한 절대 경로), INIT과 같은 클래스패스, 모의 저장소
    const javaRoot = join(root, 'TeamCode', 'src', 'main', 'java')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({
      type: 'list',
      protocol: 3,
      clock: 'virtual',
      tickNanos: 5_000_000,
      sourceRoots: [javaRoot],
      registrars: [
        {
          className: `${TEAM}.TuningOpModes`,
          source: join(root, 'TeamCode', PKG, 'TuningOpModes.java')
        },
        { className: `${TEAM}.b.Other`, source: join(root, 'TeamCode', PKG, 'b', 'Other.java') }
      ],
      bootClasspath: [],
      compileClasspath: [FILES.sdkJar],
      libraryClasspath: [],
      firstFolder: await simFirstFolder(simRoot, root),
      startEpochMillis: 1234,
      stallMillis: 2000
    })
    expect(requests[0].firstFolder).toMatch(/[/\\][0-9a-f]{16}[/\\]FIRST$/)
    expect(existsSync(requests[0].firstFolder)).toBe(true)
    expect(spawned[0].command).toBe('/fake/jdk/bin/java')
    expect(spawned[0].args).toEqual(javaArgs(FILES, 'linux'))
    // 작업 폴더는 끝나면 지운다
    expect(existsSync(spawned[0].cwd)).toBe(false)
    // INIT의 preselectTeleOp은 마지막 목록에서
    expect(lister.preselectTeleOp(root, 'Auto')).toBe('Zeta')
    expect(lister.preselectTeleOp(root, 'Nobody')).toBe('')
  })

  it('등록기 오류는 등록기 클래스와 함께, 다른 등록은 그대로', async () => {
    const error: ErrorMessage = {
      type: 'error',
      tNanos: 0,
      kind: 'registrar',
      message: `The @OpModeRegistrar method ${TEAM}.b.Other.register threw IllegalStateException: no`,
      exception: 'java.lang.IllegalStateException',
      stack: [],
      thread: 'OpModeThread'
    }
    script = listed([op({ name: 'A' })], [error])
    const result = await new RegisteredOpModes(deps).list(root)
    expect(result).toMatchObject({
      ok: true,
      opModes: [{ name: 'A' }],
      errors: [{ registrar: `${TEAM}.b.Other`, message: error.message }]
    })
  })

  it('같은 입력이면 JVM을 다시 띄우지 않고, Java 파일·jar 내용이 바뀌면 다시 읽는다', async () => {
    script = listed([op({ name: 'A' })])
    const lister = new RegisteredOpModes(deps)
    const first = await lister.list(root)
    expect(await lister.list(root)).toBe(first)
    expect(spawned).toHaveLength(1)
    // jar 해시는 크기·수정 시각이 같으면 기억한다(사이드카 jar가 없으면 'missing'이라 묻지 않는다)
    expect(hashed).toEqual([])

    // 등록기가 아닌 파일이라도 바뀌면(컴파일 결과가 달라질 수 있다) 다시
    const drive = join(root, 'TeamCode', PKG, 'Drive.java')
    await utimes(drive, new Date(), new Date(Date.now() + 5000))
    script = listed([op({ name: 'B' })])
    expect(await lister.list(root)).toMatchObject({ opModes: [{ name: 'B' }] })
    expect(spawned).toHaveLength(2)

    // jar 내용 해시
    const jar = join(dir, 'lib.jar')
    await writeFile(jar, 'jar')
    deps.resolveLibraries = async (request) => ({
      ok: true,
      report: {
        entries: [],
        gradle: [],
        compileSdk: request.gradle.compileSdk,
        compileSdkMinor: null,
        platform: null
      },
      compileClasspath: [jar],
      libraryClasspath: [jar],
      jarCoordinates: {},
      diagnosticHint: () => null
    })
    const withJar = new RegisteredOpModes(deps)
    await withJar.list(root)
    await withJar.list(root)
    expect(spawned).toHaveLength(3)
    expect(hashed).toEqual([jar])
    await utimes(jar, new Date(), new Date(Date.now() + 9000))
    await withJar.list(root)
    // 시각이 바뀌어 다시 쟀지만 내용(해시)이 같으면 그대로
    expect(hashed).toEqual([jar, jar])
    expect(spawned).toHaveLength(3)
    jarHash = 'h2'
    await utimes(jar, new Date(), new Date(Date.now() + 19000))
    await withJar.list(root)
    expect(spawned).toHaveLength(4)
    expect(requests.at(-1)).toMatchObject({
      compileClasspath: [FILES.sdkJar, jar],
      libraryClasspath: [jar]
    })
  })

  it('같은 루트의 겹친 요청은 하나만 돌고 같은 결과를 기다린다', async () => {
    script = listed([op({ name: 'A' })])
    const lister = new RegisteredOpModes(deps)
    const [a, b] = await Promise.all([lister.list(root), lister.list(root)])
    expect(a).toBe(b)
    expect(spawned).toHaveLength(1)
  })

  it('컴파일 오류는 오류 진단만(TeamCode 기준 경로)으로 캐시하고, 실패는 캐시하지 않는다', async () => {
    const source = join(root, 'TeamCode', PKG, 'TuningOpModes.java')
    script = answer([
      {
        type: 'compiled',
        ok: false,
        millis: 1,
        diagnostics: [
          { kind: 'warning', file: source, line: 1, column: 1, message: 'w', code: 'c.w' },
          { kind: 'error', file: source, line: 6, column: 9, message: 'nope', code: 'c.e' }
        ]
      },
      { type: 'finished', tNanos: 0, reason: 'compileFailed' }
    ])
    const lister = new RegisteredOpModes(deps)
    expect(await lister.list(root)).toEqual({
      ok: true,
      opModes: [],
      replaced: [],
      errors: [],
      diagnostics: [
        {
          kind: 'error',
          path: `${PKG}/TuningOpModes.java`,
          file: `${PKG}/TuningOpModes.java`,
          line: 6,
          column: 9,
          message: 'nope',
          code: 'c.e',
          hint: null
        }
      ]
    })
    await lister.list(root)
    expect(spawned).toHaveLength(1)

    const failing = new RegisteredOpModes({
      ...deps,
      spawn: async () => {
        throw new Error('spawn java ENOENT')
      }
    })
    expect(await failing.list(root)).toEqual({
      ok: false,
      code: 'failed',
      detail: 'spawn java ENOENT'
    })
    script = answer([{ type: 'finished', tNanos: 0, reason: 'terminated' }])
    const terminated = new RegisteredOpModes(deps)
    expect(await terminated.list(root)).toMatchObject({ ok: false, code: 'failed' })
    script = listed([op({ name: 'A' })])
    expect(await terminated.list(root)).toMatchObject({ ok: true, opModes: [{ name: 'A' }] })
  })

  it('열지 않은 루트·TeamCode 없음·사이드카·JDK 없음, 등록기가 없으면 JVM 없이 빈 목록', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'sandbot-registered-outside-'))
    try {
      expect(await new RegisteredOpModes(deps).list(outside)).toEqual({
        ok: false,
        code: 'notAllowed',
        detail: 'not an opened project'
      })
      trustRoot(outside)
      expect(await new RegisteredOpModes(deps).list(outside)).toEqual({
        ok: false,
        code: 'missing',
        detail: 'TeamCode'
      })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
    expect(
      await new RegisteredOpModes({
        ...deps,
        locateSidecar: async () => ({ ok: false, code: 'noSidecar', detail: 'x' })
      }).list(root)
    ).toEqual({ ok: false, code: 'noSidecar', detail: 'x' })
    expect(
      await new RegisteredOpModes({ ...deps, resolveJdk: async () => null }).list(root)
    ).toEqual({ ok: false, code: 'noJdk', detail: '' })
    expect(
      await new RegisteredOpModes({
        ...deps,
        resolvePlatform: async () => ({ ok: false, code: 'noAndroidSdk', detail: '' })
      }).list(root)
    ).toEqual({ ok: false, code: 'noAndroidSdk', detail: '' })

    await rm(join(root, 'TeamCode', PKG, 'TuningOpModes.java'))
    await rm(join(root, 'TeamCode', PKG, 'b'), { recursive: true })
    expect(await new RegisteredOpModes(deps).list(root)).toEqual({
      ok: true,
      opModes: [],
      replaced: [],
      diagnostics: [],
      errors: []
    })
    expect(spawned).toHaveLength(0)
  })

  it('INIT의 등록기: 클래스마다 하나(이름 순), 소스는 절대 경로', async () => {
    const lister = new RegisteredOpModes(deps)
    expect(await lister.registrarsFor(root)).toEqual([
      {
        className: `${TEAM}.TuningOpModes`,
        source: join(root, 'TeamCode', PKG, 'TuningOpModes.java')
      },
      { className: `${TEAM}.b.Other`, source: join(root, 'TeamCode', PKG, 'b', 'Other.java') }
    ])
    clearTrustedRoots()
    expect(await lister.registrarsFor(root)).toEqual([])
  })
})

describe('registeredInfos', () => {
  const annotated = (overrides: Partial<OpModeInfo>): OpModeInfo => ({
    className: `${TEAM}.Drive`,
    path: `${PKG}/Drive.java`,
    line: 3,
    flavor: 'TeleOp',
    name: 'Drive',
    group: '',
    preselectTeleOp: '',
    ...overrides
  })
  const listedOf = (opModes: OpModeInfo[]): ListOpModesResult => ({
    ok: true,
    opModes,
    registrars: [
      { className: `${TEAM}.TuningOpModes`, path: `${PKG}/TuningOpModes.java`, line: 5 }
    ],
    truncated: false,
    hasTeamCode: true
  })
  const names = (result: { opModes: OpModeInfo[] }): string[] => result.opModes.map((i) => i.name)

  it('annotated 클래스를 클래스로 다시 등록하면 실제 SDK처럼 등록 쪽만 보인다(replaced), 같은 항목이면 annotated를 둔다', () => {
    const list = listedOf([
      annotated({}),
      annotated({
        className: `${TEAM}.Auto`,
        path: `${PKG}/Auto.java`,
        name: 'Auto',
        flavor: 'Autonomous'
      })
    ])
    // register(Class): 애너테이션에서 읽은 같은 항목(기본 그룹은 '$$$$$$$' → '')
    expect(
      registeredInfos([op({ name: 'Drive', className: `${TEAM}.Drive`, instance: false })], list)
    ).toEqual({ opModes: [], replaced: [] })
    // 다른 이름·group·flavor로 등록: 등록이 annotated를 대신한다(UTILITY라 목록 밖이어도)
    const result = registeredInfos(
      [
        op({ name: 'Renamed', className: `${TEAM}.Drive`, instance: false }),
        op({ name: 'AutoUtility', className: `${TEAM}.Auto`, flavor: 'Utility', instance: false })
      ],
      list
    )
    expect(names(result)).toEqual(['Renamed'])
    expect(result.replaced).toEqual([`${TEAM}.Auto`, `${TEAM}.Drive`])
    expect(
      registeredInfos(
        [op({ name: 'Drive', group: 'tuning', className: `${TEAM}.Drive`, instance: false })],
        list
      )
    ).toMatchObject({ opModes: [{ name: 'Drive', group: 'tuning' }], replaced: [`${TEAM}.Drive`] })
  })

  it('인스턴스 등록은 annotated를 가리지 않는다(같은 클래스·이름만 뺀다), annotated가 아닌 클래스는 그대로', () => {
    const list = listedOf([annotated({})])
    const result = registeredInfos(
      [
        op({ name: 'Drive', className: `${TEAM}.Drive` }),
        op({ name: 'Other', className: `${TEAM}.Drive` }),
        op({ name: 'Plain', className: `${TEAM}.Plain`, instance: false })
      ],
      list
    )
    expect(names(result)).toEqual(['Other', 'Plain'])
    expect(result.replaced).toEqual([])
    expect(registeredInfos([op({})], { ok: false, code: 'notAllowed', detail: '' })).toEqual({
      opModes: [],
      replaced: []
    })
  })
})

describe('registrarOfError', () => {
  const refs = [
    { className: 'a.Outer', source: '/a/Outer.java' },
    { className: 'a.Outer$Inner', source: '/a/Outer.java' },
    { className: 'a.Out', source: '/a/Out.java' }
  ]

  it('메시지가 가리키는 등록기 클래스(겹치면 가장 긴 것), 없으면 ""', () => {
    expect(registrarOfError('The @OpModeRegistrar method a.Outer.register threw X', refs)).toBe(
      'a.Outer'
    )
    expect(registrarOfError('The @OpModeRegistrar method a.Outer$Inner.r threw X', refs)).toBe(
      'a.Outer$Inner'
    )
    expect(registrarOfError('The registrar class a.Out could not be loaded: y', refs)).toBe('a.Out')
    expect(registrarOfError('The registrar class a.Out', refs)).toBe('a.Out')
    expect(registrarOfError('something else', refs)).toBe('')
  })
})
