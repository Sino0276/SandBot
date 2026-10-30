import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_USAGE_FILE_BYTES } from '../shared/ipc'
import { clearOpModeCache, listOpModes, scanOpModes } from './opModes'
import { clearTrustedRoots, trustRoot } from './projectRoots'

const PKG = 'src/main/java/org/firstinspires/ftc/teamcode'

function opMode(name: string, annotation: string): string {
  return [
    'package org.firstinspires.ftc.teamcode;',
    'import com.qualcomm.robotcore.eventloop.opmode.*;',
    annotation,
    `public class ${name} extends LinearOpMode {`,
    '  @Override public void runOpMode() {}',
    '}',
    ''
  ].join('\n')
}

describe('listOpModes', () => {
  let root: string
  let outside: string

  const write = async (rel: string, text: string): Promise<string> => {
    const file = join(root, 'TeamCode', rel)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
    return file
  }

  beforeEach(async () => {
    clearTrustedRoots()
    clearOpModeCache()
    root = await mkdtemp(join(tmpdir(), 'sandbot-opmodes-'))
    outside = await mkdtemp(join(tmpdir(), 'sandbot-opmodes-outside-'))
    trustRoot(root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('열지 않은 프로젝트는 거부한다', async () => {
    expect(await listOpModes(outside)).toEqual({
      ok: false,
      code: 'notAllowed',
      detail: 'not an opened project'
    })
    expect((await listOpModes(42)).ok).toBe(false)
  })

  it('TeamCode가 없으면 빈 목록과 hasTeamCode false', async () => {
    expect(await listOpModes(root)).toEqual({
      ok: true,
      opModes: [],
      registrars: [],
      truncated: false,
      hasTeamCode: false
    })
  })

  it('파일을 읽어 정렬하고, 큰 파일·생성 폴더·밖을 가리키는 링크는 건너뛴다', async () => {
    await write(`${PKG}/Drive.java`, opMode('Drive', '@TeleOp(name = "Drive", group = "B")'))
    await write(
      `${PKG}/auto/Red.java`,
      opMode('Red', '@Autonomous(preselectTeleOp = "Drive")').replace(
        'package org.firstinspires.ftc.teamcode;',
        'package org.firstinspires.ftc.teamcode.auto;'
      )
    )
    await write(`${PKG}/Arcade.java`, opMode('Arcade', '@TeleOp(group = "A")'))
    await write(`${PKG}/Util.java`, 'public class Util {}\n')
    await write(
      `${PKG}/Huge.java`,
      opMode('Huge', '@TeleOp') + `// ${'x'.repeat(MAX_USAGE_FILE_BYTES)}\n`
    )
    await write(`${PKG}/sandbot/Gen.java`, opMode('Gen', '@TeleOp'))
    await writeFile(join(outside, 'Evil.java'), opMode('Evil', '@TeleOp'))
    await symlink(join(outside, 'Evil.java'), join(root, 'TeamCode', PKG, 'Evil.java'))

    const result = await listOpModes(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.hasTeamCode).toBe(true)
    expect(result.opModes).toEqual([
      {
        className: 'org.firstinspires.ftc.teamcode.Arcade',
        path: `${PKG}/Arcade.java`,
        line: 3,
        flavor: 'TeleOp',
        name: 'Arcade',
        group: 'A',
        preselectTeleOp: ''
      },
      {
        className: 'org.firstinspires.ftc.teamcode.Drive',
        path: `${PKG}/Drive.java`,
        line: 3,
        flavor: 'TeleOp',
        name: 'Drive',
        group: 'B',
        preselectTeleOp: ''
      },
      {
        className: 'org.firstinspires.ftc.teamcode.auto.Red',
        path: `${PKG}/auto/Red.java`,
        line: 3,
        flavor: 'Autonomous',
        name: 'Red',
        group: '',
        preselectTeleOp: 'Drive'
      }
    ])
  })

  it('바뀐 파일만 다시 읽고, 지운 파일은 목록에서 빠진다', async () => {
    const drive = await write(`${PKG}/Drive.java`, opMode('Drive', '@TeleOp'))
    const other = await write(`${PKG}/Other.java`, opMode('Other', '@TeleOp'))
    const first = await listOpModes(root)
    expect(first.ok && first.opModes.map((op) => op.name)).toEqual(['Drive', 'Other'])

    await writeFile(drive, opMode('Drive', '@TeleOp(name = "Renamed")'))
    const later = new Date(Date.now() + 5000)
    await utimes(drive, later, later)
    await rm(other)
    const second = await listOpModes(root)
    expect(second.ok && second.opModes.map((op) => op.name)).toEqual(['Renamed'])
  })

  it('등록기(@OpModeRegistrar)를 클래스·경로·줄 순으로 함께 주고, 바뀐 파일은 다시 읽는다', async () => {
    const registrar = (pkg: string, name: string, methods: string[]): string =>
      [
        `package ${pkg};`,
        'import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;',
        'import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;',
        `public final class ${name} {`,
        ...methods.map((m) => `  @OpModeRegistrar public static void ${m}(OpModeManager m) {}`),
        '}',
        ''
      ].join('\n')
    const tuning = await write(
      `${PKG}/TuningOpModes.java`,
      registrar('org.firstinspires.ftc.teamcode', 'TuningOpModes', ['register', 'more'])
    )
    await write(`${PKG}/a/A.java`, registrar('org.firstinspires.ftc.teamcode.a', 'A', ['r']))
    await write(`${PKG}/Drive.java`, opMode('Drive', '@TeleOp'))
    const first = await scanOpModes(root)
    expect(first.result).toMatchObject({
      ok: true,
      opModes: [{ name: 'Drive' }],
      registrars: [
        {
          className: 'org.firstinspires.ftc.teamcode.TuningOpModes',
          path: `${PKG}/TuningOpModes.java`,
          line: 5
        },
        {
          className: 'org.firstinspires.ftc.teamcode.TuningOpModes',
          path: `${PKG}/TuningOpModes.java`,
          line: 6
        },
        { className: 'org.firstinspires.ftc.teamcode.a.A', path: `${PKG}/a/A.java`, line: 5 }
      ]
    })
    // 캐시 키에 쓰는 파일 목록(크기·수정 시각)
    expect(first.files.map((file) => file.path).sort()).toEqual([
      `${PKG}/Drive.java`,
      `${PKG}/TuningOpModes.java`,
      `${PKG}/a/A.java`
    ])

    await writeFile(tuning, registrar('org.firstinspires.ftc.teamcode', 'TuningOpModes', []))
    const later = new Date(Date.now() + 5000)
    await utimes(tuning, later, later)
    const second = await listOpModes(root)
    expect(second.ok && second.registrars.map((r) => r.className)).toEqual([
      'org.firstinspires.ftc.teamcode.a.A'
    ])
  })
})
