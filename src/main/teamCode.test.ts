import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GENERATED_MARKER, stampGenerated } from '../shared/generatedFiles'
import { syncGeneratedFiles } from './teamCode'

const JAVA = 'src/main/java/org/firstinspires/ftc/teamcode/sandbot'
const XML = 'src/main/res/xml'
const generated = (body: string): string => stampGenerated(`// ${GENERATED_MARKER}\n${body}`)

describe('syncGeneratedFiles', () => {
  let root: string
  const teamCode = (...parts: string[]): string => join(root, 'TeamCode', ...parts)

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sandbot-teamcode-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('TeamCode 폴더가 없으면 아무것도 쓰지 않는다', async () => {
    const result = await syncGeneratedFiles(root, [
      { path: `${JAVA}/RobotHardware.java`, content: generated('a') }
    ])
    expect(result).toEqual({ status: 'noTeamCode' })
    expect(await readdir(root)).toEqual([])
  })

  it('생성 파일을 쓰고, 이전 생성 파일은 지우고, 사람이 만든 파일은 그대로 둔다', async () => {
    await mkdir(teamCode(JAVA), { recursive: true })
    await mkdir(teamCode(XML), { recursive: true })
    await writeFile(teamCode(JAVA, 'OldHardware.java'), generated('old'))
    await writeFile(teamCode(JAVA, 'Manual.java'), 'public class Manual {}')
    await writeFile(teamCode(XML, 'sandbot_manual.xml'), '<Robot />')
    await writeFile(teamCode(XML, 'sandbot_old_hardware.xml'), generated('old'))

    const result = await syncGeneratedFiles(root, [
      { path: `${JAVA}/RobotHardware.java`, content: generated('java') },
      { path: `${XML}/sandbot_robot_hardware.xml`, content: generated('xml') },
      { path: `${JAVA}/Manual.java`, content: generated('would overwrite') }
    ])

    expect(result).toEqual({
      status: 'synced',
      written: [`${JAVA}/RobotHardware.java`, `${XML}/sandbot_robot_hardware.xml`],
      unchanged: [],
      deleted: [`${JAVA}/OldHardware.java`, `${XML}/sandbot_old_hardware.xml`],
      skipped: [`${JAVA}/Manual.java`],
      modified: [],
      caseRenamed: []
    })
    expect((await readdir(teamCode(JAVA))).sort()).toEqual(['Manual.java', 'RobotHardware.java'])
    expect((await readdir(teamCode(XML))).sort()).toEqual([
      'sandbot_manual.xml',
      'sandbot_robot_hardware.xml'
    ])
    expect(await readFile(teamCode(JAVA, 'Manual.java'), 'utf8')).toBe('public class Manual {}')
    expect(await readFile(teamCode(JAVA, 'RobotHardware.java'), 'utf8')).toBe(generated('java'))

    // 다시 저장해도 내용이 같으면 쓰지 않는다
    const again = await syncGeneratedFiles(root, [
      { path: `${JAVA}/RobotHardware.java`, content: generated('java') },
      { path: `${XML}/sandbot_robot_hardware.xml`, content: generated('xml') }
    ])
    expect(again).toMatchObject({
      written: [],
      unchanged: [`${JAVA}/RobotHardware.java`, `${XML}/sandbot_robot_hardware.xml`],
      deleted: []
    })
  })

  it('생성 위치 밖의 경로는 쓰지 않는다', async () => {
    await mkdir(teamCode(), { recursive: true })
    await expect(
      syncGeneratedFiles(root, [{ path: `${JAVA}/../Evil.java`, content: generated('x') }])
    ).rejects.toThrow()
    expect(await readdir(teamCode())).toEqual([])
  })
})
