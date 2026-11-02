import { createHash } from 'crypto'
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, win32 } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlayInitRequest } from '../../shared/play'
import { clearTrustedRoots, trustRoot } from '../projectRoots'
import {
  buildListRequest,
  buildRunRequest,
  isBinaryNameOf,
  javaArgs,
  prepareRun,
  readSidecarFiles,
  simFirstFolder,
  sourceMapper,
  sourceRootsOf,
  validateRequest,
  type ValidRequest
} from './launch'

const PKG = 'src/main/java/org/firstinspires/ftc/teamcode'
const CONFIG = 'src/main/res/xml/sandbot_robot.xml'

function request(overrides: Partial<PlayInitRequest> = {}): PlayInitRequest {
  return {
    runId: 'run-1',
    root: '/proj',
    opMode: {
      className: 'org.firstinspires.ftc.teamcode.Drive',
      path: `${PKG}/Drive.java`,
      flavor: 'TeleOp'
    },
    configPath: null,
    settings: { speed: 1, jitter: 0, seed: 0, autoStopAutonomous: true, batteryVoltage: 12.5 },
    world: null,
    ...overrides
  }
}

function valid(input: PlayInitRequest): ValidRequest {
  const result = validateRequest(input)
  if ('ok' in result) throw new Error(result.detail)
  return result
}

describe('validateRequest', () => {
  it('맞는 요청은 그대로 받는다', () => {
    const base = request()
    // registeredName이 없으면 null로 채운다(annotated OpMode)
    expect(valid(base)).toEqual({ ...base, opMode: { ...base.opMode, registeredName: null } })
    const registered = request({
      opMode: {
        className: 'org.firstinspires.ftc.teamcode.TuningOpModes',
        path: `${PKG}/TuningOpModes.java`,
        flavor: 'TeleOp',
        registeredName: 'AngularRampLogger'
      }
    })
    expect(valid(registered)).toEqual(registered)
    for (const registeredName of ['', 'a\nb', 'x'.repeat(201), 3])
      expect(
        validateRequest(
          request({
            opMode: {
              ...registered.opMode,
              registeredName: registeredName as unknown as string
            }
          })
        )
      ).toMatchObject({ ok: false, code: 'notAllowed' })
  })

  it('모양이 틀리면 notAllowed', () => {
    const bad: unknown[] = [
      null,
      'x',
      request({ runId: '' }),
      request({ runId: 'a/b' }),
      request({ root: '' }),
      request({
        opMode: { className: 'org.x.Drive', path: `${PKG}/../Drive.java`, flavor: 'TeleOp' }
      }),
      request({ opMode: { className: 'Drive', path: `${PKG}/Drive.txt`, flavor: 'TeleOp' } }),
      request({ opMode: { className: 'Gen', path: `${PKG}/sandbot/Gen.java`, flavor: 'TeleOp' } }),
      request({
        opMode: { className: 'org.x.Other', path: `${PKG}/Drive.java`, flavor: 'TeleOp' }
      }),
      request({
        opMode: {
          className: 'org.x.Drive',
          path: `${PKG}/Drive.java`,
          flavor: 'Utility' as 'TeleOp'
        }
      }),
      request({ configPath: 'src/main/res/xml/other.xml' }),
      request({ configPath: 'src/main/res/xml/../../../../x/sandbot_a.xml' }),
      request({ configPath: `${PKG}/sandbot/RobotHardware.java` }),
      request({
        settings: { speed: 0, jitter: 0, seed: 0, autoStopAutonomous: true, batteryVoltage: 12.5 }
      }),
      request({
        settings: { speed: 1, jitter: 1, seed: 0, autoStopAutonomous: true, batteryVoltage: 12.5 }
      }),
      request({
        settings: { speed: 1, jitter: 0, seed: 0.5, autoStopAutonomous: true, batteryVoltage: 12.5 }
      }),
      request({
        settings: {
          speed: 1,
          jitter: 0,
          seed: 0,
          autoStopAutonomous: 'yes' as unknown as boolean,
          batteryVoltage: 12.5
        }
      })
    ]
    for (const input of bad) {
      const result = validateRequest(input)
      expect(result).toMatchObject({ ok: false, code: 'notAllowed' })
    }
  })

  it('바이너리 이름의 최상위 클래스는 파일 이름이다(중첩은 Outer$Inner)', () => {
    expect(isBinaryNameOf('org.x.Drive', `${PKG}/Drive.java`)).toBe(true)
    expect(isBinaryNameOf('Drive', `${PKG}/Drive.java`)).toBe(true)
    expect(isBinaryNameOf('org.x.Drive$Fast', `${PKG}/Drive.java`)).toBe(true)
    expect(isBinaryNameOf('org.x.Fast$Drive', `${PKG}/Drive.java`)).toBe(false)
    expect(isBinaryNameOf('org..Drive', `${PKG}/Drive.java`)).toBe(false)
    expect(isBinaryNameOf('org.x.Drive$', `${PKG}/Drive.java`)).toBe(false)
    expect(isBinaryNameOf('org.x.Drive;', `${PKG}/Drive.java`)).toBe(false)
  })
})

describe('prepareRun', () => {
  let root: string
  let outside: string

  const write = async (rel: string, text = ''): Promise<string> => {
    const file = join(root, 'TeamCode', rel)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
    return file
  }

  beforeEach(async () => {
    clearTrustedRoots()
    root = await mkdtemp(join(tmpdir(), 'sandbot-launch-'))
    outside = await mkdtemp(join(tmpdir(), 'sandbot-launch-outside-'))
    trustRoot(root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('열지 않은 프로젝트·TeamCode 없음·OpMode 없음', async () => {
    expect(await prepareRun(valid(request({ root: outside })))).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
    expect(await prepareRun(valid(request({ root })))).toMatchObject({
      ok: false,
      code: 'missing',
      detail: 'TeamCode/src/main/java'
    })
    await write(`${PKG}/Other.java`)
    expect(await prepareRun(valid(request({ root })))).toMatchObject({ ok: false, code: 'missing' })
  })

  it('TeamCode 밖을 가리키는 링크는 받지 않는다', async () => {
    await write(`${PKG}/Real.java`)
    await writeFile(join(outside, 'Drive.java'), '')
    await symlink(join(outside, 'Drive.java'), join(root, 'TeamCode', PKG, 'Drive.java'))
    expect(await prepareRun(valid(request({ root })))).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
  })

  it('소스 루트, OpMode 절대 경로, 구성(없으면 null)', async () => {
    const source = await write(`${PKG}/Drive.java`)
    const prepared = await prepareRun(valid(request({ root, configPath: CONFIG })))
    expect(prepared).toEqual({
      projectRoot: root,
      sourceRoots: [join(root, 'TeamCode', 'src', 'main', 'java')],
      opModeSource: source,
      configXml: null,
      configMissing: true,
      preselectTeleOp: ''
    })
    const config = await write(CONFIG, '<Robot/>')
    await mkdir(join(root, 'FtcRobotController', 'src', 'main', 'java'), { recursive: true })
    const withConfig = await prepareRun(valid(request({ root, configPath: CONFIG })))
    expect(withConfig).toMatchObject({
      configXml: config,
      configMissing: false,
      sourceRoots: [
        join(root, 'TeamCode', 'src', 'main', 'java'),
        join(root, 'FtcRobotController', 'src', 'main', 'java')
      ]
    })
  })

  it('구성이 밖을 가리키는 링크이거나 파일이 아니면 notAllowed', async () => {
    await write(`${PKG}/Drive.java`)
    await mkdir(join(root, 'TeamCode', 'src', 'main', 'res', 'xml'), { recursive: true })
    await writeFile(join(outside, 'x.xml'), '<Robot/>')
    await symlink(join(outside, 'x.xml'), join(root, 'TeamCode', CONFIG))
    expect(await prepareRun(valid(request({ root, configPath: CONFIG })))).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
    await rm(join(root, 'TeamCode', CONFIG))
    await mkdir(join(root, 'TeamCode', CONFIG))
    expect(await prepareRun(valid(request({ root, configPath: CONFIG })))).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
  })

  it('Autonomous면 그 클래스의 preselectTeleOp를 읽는다', async () => {
    await write(
      `${PKG}/Red.java`,
      [
        'package org.firstinspires.ftc.teamcode;',
        'import com.qualcomm.robotcore.eventloop.opmode.Autonomous;',
        '@Autonomous(preselectTeleOp = "Drive")',
        'public class Red {',
        '  @Autonomous(preselectTeleOp = "Other") public static class Blue {}',
        '}'
      ].join('\n')
    )
    const red = await prepareRun(
      valid(
        request({
          root,
          opMode: {
            className: 'org.firstinspires.ftc.teamcode.Red',
            path: `${PKG}/Red.java`,
            flavor: 'Autonomous'
          }
        })
      )
    )
    expect(red).toMatchObject({ preselectTeleOp: 'Drive' })
    const blue = await prepareRun(
      valid(
        request({
          root,
          opMode: {
            className: 'org.firstinspires.ftc.teamcode.Red$Blue',
            path: `${PKG}/Red.java`,
            flavor: 'Autonomous'
          }
        })
      )
    )
    expect(blue).toMatchObject({ preselectTeleOp: 'Other' })
    // 등록기 OpMode는 그 파일(등록기)의 애너테이션을 읽지 않는다(controller가 등록 결과에서 찾는다)
    const registered = await prepareRun(
      valid(
        request({
          root,
          opMode: {
            className: 'org.firstinspires.ftc.teamcode.Red',
            path: `${PKG}/Red.java`,
            flavor: 'Autonomous',
            registeredName: 'RedLike'
          }
        })
      )
    )
    expect(registered).toMatchObject({ preselectTeleOp: '' })
  })
})

describe('모의 저장소와 목록 요청', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-simfiles-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('프로젝트마다 <sim-files>/<sha256(링크를 푼 루트) 앞 16자>/FIRST를 만든다(링크로 연 같은 루트는 같은 폴더)', async () => {
    const project = join(dir, 'project')
    await mkdir(project)
    const simRoot = join(dir, 'sim-files')
    const first = await simFirstFolder(simRoot, project)
    const key = createHash('sha256')
      .update(await realpath(project))
      .digest('hex')
      .slice(0, 16)
    expect(first).toBe(join(simRoot, key, 'FIRST'))
    expect((await stat(first)).isDirectory()).toBe(true)
    // 다시 불러도(INIT마다) 그대로
    expect(await simFirstFolder(simRoot, project)).toBe(first)
    const link = join(dir, 'link')
    await symlink(project, link)
    expect(await simFirstFolder(simRoot, link)).toBe(first)
    expect(await simFirstFolder(simRoot, join(dir, 'other'))).not.toBe(first)
  })

  it('소스 루트는 TeamCode와, 있으면 FtcRobotController', async () => {
    const project = join(dir, 'p')
    const teamCode = join(project, 'TeamCode', 'src', 'main', 'java')
    expect(await sourceRootsOf(project)).toEqual([teamCode])
    const controller = join(project, 'FtcRobotController', 'src', 'main', 'java')
    await mkdir(controller, { recursive: true })
    expect(await sourceRootsOf(project)).toEqual([teamCode, controller])
  })

  it('ListRequest', () => {
    expect(
      buildListRequest(
        ['/proj/TeamCode/src/main/java'],
        [{ className: 'a.R', source: '/proj/TeamCode/src/main/java/a/R.java' }],
        {
          bootClasspath: ['/p.jar'],
          compileClasspath: ['/s/sdk.jar', '/l.jar'],
          libraryClasspath: ['/l.jar']
        },
        '/u/sim-files/abc/FIRST',
        77
      )
    ).toEqual({
      type: 'list',
      protocol: 3,
      clock: 'virtual',
      tickNanos: 5_000_000,
      sourceRoots: ['/proj/TeamCode/src/main/java'],
      registrars: [{ className: 'a.R', source: '/proj/TeamCode/src/main/java/a/R.java' }],
      bootClasspath: ['/p.jar'],
      compileClasspath: ['/s/sdk.jar', '/l.jar'],
      libraryClasspath: ['/l.jar'],
      firstFolder: '/u/sim-files/abc/FIRST',
      startEpochMillis: 77,
      stallMillis: 2000
    })
  })
})

describe('사이드카 빌드 결과와 명령', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-sidecar-files-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('sidecar.json이 없거나 protocol이 다르거나 jar가 없으면 noSidecar', async () => {
    expect(await readSidecarFiles(dir)).toMatchObject({ ok: false, code: 'noSidecar' })
    await writeFile(join(dir, 'sidecar.json'), JSON.stringify({ protocol: 1 }))
    expect(await readSidecarFiles(dir)).toMatchObject({
      ok: false,
      code: 'noSidecar',
      detail: 'sidecar protocol 1, expected 3'
    })
    await writeFile(join(dir, 'sidecar.json'), JSON.stringify({ protocol: 3, sourceHash: 'x' }))
    await writeFile(join(dir, 'sandbot-runtime.jar'), '')
    expect(await readSidecarFiles(dir)).toMatchObject({ ok: false, code: 'noSidecar' })
    await writeFile(join(dir, 'sandbot-sdk.jar'), '')
    // FTC Dashboard 대체 jar는 없어도 된다(그것을 쓰는 실행만 controller가 막는다)
    expect(await readSidecarFiles(dir)).toEqual({
      dir,
      runtimeJar: join(dir, 'sandbot-runtime.jar'),
      sdkJar: join(dir, 'sandbot-sdk.jar'),
      dashboardJar: null
    })
    await writeFile(join(dir, 'sandbot-dashboard.jar'), '')
    expect(await readSidecarFiles(dir)).toMatchObject({
      dashboardJar: join(dir, 'sandbot-dashboard.jar')
    })
  })

  it('JVM 인자와 RunRequest', () => {
    const files = {
      dir: '/s',
      runtimeJar: '/s/sandbot-runtime.jar',
      sdkJar: '/s/sandbot-sdk.jar',
      dashboardJar: '/s/sandbot-dashboard.jar'
    }
    expect(javaArgs(files, 'linux')).toEqual([
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
      '/s/sandbot-runtime.jar:/s/sandbot-sdk.jar',
      'org.sandbot.runtime.Main'
    ])
    expect(javaArgs(files, 'win32')[10]).toBe('/s/sandbot-runtime.jar;/s/sandbot-sdk.jar')
    const run = buildRunRequest(
      {
        projectRoot: '/proj',
        sourceRoots: ['/proj/TeamCode/src/main/java'],
        opModeSource: '/proj/TeamCode/src/main/java/Drive.java',
        configXml: null,
        configMissing: false,
        preselectTeleOp: ''
      },
      valid(
        request({
          settings: {
            speed: 2,
            jitter: 0.1,
            seed: 42,
            autoStopAutonomous: true,
            batteryVoltage: 12.5
          }
        })
      ),
      {
        bootClasspath: ['/p/android-platform.jar'],
        compileClasspath: [files.sdkJar],
        libraryClasspath: []
      },
      { registrars: [], firstFolder: '/u/sim-files/abc/FIRST' },
      1234
    )
    expect(run).toEqual({
      type: 'run',
      protocol: 3,
      clock: 'virtual',
      tickNanos: 5_000_000,
      sourceRoots: ['/proj/TeamCode/src/main/java'],
      opModeSource: '/proj/TeamCode/src/main/java/Drive.java',
      opModeClass: 'org.firstinspires.ftc.teamcode.Drive',
      registeredName: null,
      registrars: [],
      firstFolder: '/u/sim-files/abc/FIRST',
      bootClasspath: ['/p/android-platform.jar'],
      compileClasspath: ['/s/sandbot-sdk.jar'],
      libraryClasspath: [],
      configXml: null,
      timing: {},
      jitter: 0.1,
      seed: 42,
      startEpochMillis: 1234,
      stallMillis: 2000
    })
  })

  it('경로 바꾸기(Windows)', () => {
    const map = sourceMapper('C:\\proj', win32)
    expect(map('C:\\proj\\TeamCode\\src\\main\\java\\org\\x\\Drive.java')).toEqual({
      path: 'src/main/java/org/x/Drive.java',
      file: 'src/main/java/org/x/Drive.java'
    })
    expect(map('D:\\other\\Drive.java')).toEqual({ path: null, file: 'Drive.java' })
    expect(map('C:\\proj\\FtcRobotController\\src\\main\\java\\S.java')).toEqual({
      path: null,
      file: 'S.java'
    })
  })
})
