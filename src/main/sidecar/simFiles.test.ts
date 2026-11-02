import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path, { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTrustedRoots, trustRoot } from '../projectRoots'
import { simFirstFolder } from './launch'
import { revealSimFile, simFilePath, simFirstFolderPath } from './simFiles'

// 모의 저장소(userData/sim-files/<프로젝트 해시>/FIRST)의 경로와 Console의 [폴더에서 보기](revealSimFile)

describe('simFilePath(사이드카가 알린 상대 경로 → 절대 경로)', () => {
  it('모의 저장소 안의 경로만 바꾼다', () => {
    expect(simFilePath('/u/sim/abc/FIRST', 'RoadRunner/tuning/forward-ramp/1.json')).toBe(
      '/u/sim/abc/FIRST/RoadRunner/tuning/forward-ramp/1.json'
    )
    for (const relative of [
      '',
      '../x.json',
      'a/../../x.json',
      './a.json',
      'a//b.json',
      'a/',
      '/etc/passwd',
      'a\\..\\..\\x.json',
      'C:x.json',
      'a\u0000.json',
      'a'.repeat(5000)
    ])
      expect(simFilePath('/u/sim/abc/FIRST', relative)).toBeNull()
  })

  it('Windows 경로 규칙으로도 밖을 가리키지 않는다', () => {
    expect(simFilePath('C:\\Users\\t\\sim\\abc\\FIRST', 'RoadRunner/x.json', path.win32)).toBe(
      'C:\\Users\\t\\sim\\abc\\FIRST\\RoadRunner\\x.json'
    )
    for (const relative of ['C:/x.json', '\\\\server\\share\\x.json', 'D:x.json', 'a\\..\\x.json'])
      expect(simFilePath('C:\\sim\\FIRST', relative, path.win32)).toBeNull()
  })
})

describe('revealSimFile', () => {
  let dir: string
  let simRoot: string
  let project: string
  let first: string
  let tuning: string
  const reveal = vi.fn()

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'sandbot-simfiles-')))
    simRoot = join(dir, 'sim-files')
    project = join(dir, 'project')
    await mkdir(project)
    trustRoot(project)
    first = await simFirstFolder(simRoot, project)
    await mkdir(join(first, 'RoadRunner', 'tuning', 'forward-ramp'), { recursive: true })
    tuning = join(first, 'RoadRunner', 'tuning', 'forward-ramp', '1793363559542.json')
    await writeFile(tuning, '{}')
    reveal.mockClear()
  })

  afterEach(async () => {
    clearTrustedRoots()
    await rm(dir, { recursive: true, force: true })
  })

  it('열린 프로젝트의 모의 저장소 안 파일을 파일 관리자에서 보인다', async () => {
    expect(await revealSimFile(simRoot, project, tuning, reveal)).toEqual({ ok: true })
    expect(reveal).toHaveBeenCalledWith(tuning)
  })

  it('열거나 저장하지 않은 프로젝트, 절대 경로가 아닌 것은 받지 않는다', async () => {
    const other = join(dir, 'other')
    await mkdir(other)
    expect(await revealSimFile(simRoot, other, tuning, reveal)).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
    for (const file of ['RoadRunner/x.json', 42, null, `${tuning}\u0000`])
      expect(await revealSimFile(simRoot, project, file, reveal)).toMatchObject({
        ok: false,
        code: 'notAllowed'
      })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('다른 프로젝트의 모의 저장소나 그 밖의 파일, 폴더는 받지 않는다', async () => {
    const other = join(dir, 'other')
    await mkdir(other)
    trustRoot(other)
    const otherFirst = await simFirstFolder(simRoot, other)
    const otherFile = join(otherFirst, 'x.json')
    await writeFile(otherFile, '{}')
    const outside = join(dir, 'secret.txt')
    await writeFile(outside, 'x')
    for (const file of [
      otherFile,
      outside,
      join(simRoot, 'x.json'),
      first,
      join(first, 'RoadRunner')
    ])
      expect(await revealSimFile(simRoot, project, file, reveal)).toMatchObject({
        ok: false,
        code: 'notAllowed'
      })
    // 그 프로젝트의 파일은 그 프로젝트로는 보인다
    expect(await revealSimFile(simRoot, other, otherFile, reveal)).toEqual({ ok: true })
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('모의 저장소 안에서 밖을 가리키는 링크는 링크를 풀어 확인한다', async () => {
    const outside = join(dir, 'secret.txt')
    await writeFile(outside, 'x')
    const link = join(first, 'link.json')
    await symlink(outside, link)
    expect(await revealSimFile(simRoot, project, link, reveal)).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
    // '..'로 나갔다 들어오는 경로는 풀린 곳으로 판단한다
    const roundTrip = join(
      first,
      'RoadRunner',
      '..',
      'RoadRunner',
      'tuning',
      'forward-ramp',
      '1793363559542.json'
    )
    expect(await revealSimFile(simRoot, project, roundTrip, reveal)).toEqual({ ok: true })
    expect(reveal).toHaveBeenLastCalledWith(tuning)
  })

  it('지웠거나 옮긴 파일은 missing', async () => {
    await rm(tuning)
    expect(await revealSimFile(simRoot, project, tuning, reveal)).toMatchObject({
      ok: false,
      code: 'missing'
    })
    // 모의 저장소가 아직 없는 프로젝트도(INIT한 적 없음)
    const fresh = join(dir, 'fresh')
    await mkdir(fresh)
    trustRoot(fresh)
    const freshFile = join(await simFirstFolderPath(simRoot, fresh), 'a.json')
    expect(await revealSimFile(simRoot, fresh, freshFile, reveal)).toMatchObject({
      ok: false,
      code: 'missing'
    })
    expect(reveal).not.toHaveBeenCalled()
  })
})
