import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CodeTrustStore,
  codeTrustKey,
  grantCodeTrustFor,
  MAX_TRUSTED_PROJECTS,
  parseCodeTrust
} from './codeTrust'
import { clearTrustedRoots, trustRoot } from './projectRoots'

describe('codeTrustKey·parseCodeTrust', () => {
  it('키는 NFC이고, Windows는 대소문자를 접는다', () => {
    const nfd = '/work/\u1100\u1161팀'
    expect(codeTrustKey(nfd, 'linux')).toBe('/work/가팀')
    expect(codeTrustKey('C:\\Work\\FtcRobotController', 'win32')).toBe(
      'c:\\work\\ftcrobotcontroller'
    )
    expect(codeTrustKey('C:\\Work\\FtcRobotController', 'win32')).toBe(
      codeTrustKey('c:\\WORK\\ftcRobotController', 'win32')
    )
    // 대소문자를 구분하는 파일 시스템은 다른 폴더다
    expect(codeTrustKey('/Work/A', 'linux')).not.toBe(codeTrustKey('/work/a', 'linux'))
  })

  it('깨졌거나 모양이 다른 파일은 빈 것, 문자열이 아닌 항목은 버리고 같은 키는 하나만', () => {
    expect(parseCodeTrust('')).toEqual([])
    expect(parseCodeTrust('{"version":1,"projects":')).toEqual([])
    expect(parseCodeTrust('null')).toEqual([])
    expect(parseCodeTrust('[]')).toEqual([])
    expect(parseCodeTrust('{"version":2,"projects":["/a"]}')).toEqual([])
    expect(parseCodeTrust('{"version":1,"projects":"/a"}')).toEqual([])
    expect(
      parseCodeTrust(
        JSON.stringify({ version: 1, projects: ['/a', 3, '', null, '/b', '/a', 'x'.repeat(5000)] })
      )
    ).toEqual(['/b', '/a'])
    const many = Array.from({ length: MAX_TRUSTED_PROJECTS + 5 }, (_, i) => `/p${i}`)
    const kept = parseCodeTrust(JSON.stringify({ version: 1, projects: many }))
    expect(kept).toHaveLength(MAX_TRUSTED_PROJECTS)
    expect(kept[0]).toBe('/p5')
  })
})

describe('CodeTrustStore', () => {
  let dir: string
  let file: string
  let project: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-trust-'))
    file = join(dir, 'user', 'code-trust.json')
    await mkdir(join(dir, 'user'))
    project = join(dir, 'FtcRobotController')
    await mkdir(project)
  })

  afterEach(async () => {
    clearTrustedRoots()
    await rm(dir, { recursive: true, force: true })
  })

  const store = (): CodeTrustStore => new CodeTrustStore({ file, platform: 'linux' })

  it('믿기 전에는 false, 믿으면 파일에 남아 다음 실행(새 저장소)에도 믿는다', async () => {
    const trust = store()
    expect(await trust.isTrusted(project)).toBe(false)
    expect(await trust.grant(project)).toBe(true)
    expect(await trust.isTrusted(project)).toBe(true)
    expect(await trust.isTrusted(`${project}/`)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, projects: [project] })
    expect(await store().isTrusted(project)).toBe(true)
    // 안쪽·바깥 폴더는 다른 프로젝트다
    expect(await store().isTrusted(dir)).toBe(false)
    await mkdir(join(project, 'TeamCode'))
    expect(await store().isTrusted(join(project, 'TeamCode'))).toBe(false)
    // 임시 파일은 남지 않는다
    expect(await readdir(join(dir, 'user'))).toEqual(['code-trust.json'])
  })

  it('키는 링크를 푼 실제 경로다(링크로 연 같은 폴더는 같은 프로젝트), 없는 폴더는 믿지 않는다', async () => {
    const link = join(dir, 'link')
    await symlink(project, link, 'dir')
    const trust = store()
    expect(await trust.grant(link)).toBe(true)
    expect(await trust.isTrusted(project)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8')).projects).toEqual([project])

    expect(await trust.grant(join(dir, 'gone'))).toBe(false)
    expect(await trust.isTrusted(join(dir, 'gone'))).toBe(false)
    expect(await trust.isTrusted('')).toBe(false)
    // 폴더를 지우면 맞지 않는다(다시 묻는다)
    await rm(link)
    await rm(project, { recursive: true })
    expect(await trust.isTrusted(project)).toBe(false)
  })

  it('Windows 키: 대소문자만 다른 경로도 같은 프로젝트(realpath를 바꿔 흉내)', async () => {
    const windows = new CodeTrustStore({
      file,
      platform: 'win32',
      realpath: async (target) => target.replace(/\//g, '\\')
    })
    expect(await windows.grant('/Work/FTC')).toBe(true)
    expect(await windows.isTrusted('/work/ftc')).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8')).projects).toEqual(['\\work\\ftc'])
  })

  it('깨진 파일은 빈 것으로 보고, 다음 동의가 고쳐 쓴다', async () => {
    await writeFile(file, '{ not json')
    const trust = store()
    expect(await trust.isTrusted(project)).toBe(false)
    expect(await trust.grant(project)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, projects: [project] })
  })

  it('너무 큰 파일은 읽지 않는다', async () => {
    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [project, 'x'.repeat(5 * 1024 * 1024)] })
    )
    expect(await store().isTrusted(project)).toBe(false)
  })

  it('이미 믿은 프로젝트는 다시 쓰지 않고, 한도를 넘으면 먼저 믿은 것부터 버린다', async () => {
    const keys = Array.from({ length: MAX_TRUSTED_PROJECTS }, (_, i) => `/old/p${i}`)
    await writeFile(file, JSON.stringify({ version: 1, projects: keys }))
    const trust = store()
    expect(await trust.grant(project)).toBe(true)
    const saved = JSON.parse(await readFile(file, 'utf8')).projects as string[]
    expect(saved).toHaveLength(MAX_TRUSTED_PROJECTS)
    expect(saved[0]).toBe('/old/p1')
    expect(saved.at(-1)).toBe(project)

    await writeFile(file, 'changed elsewhere')
    expect(await trust.grant(project)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('changed elsewhere')
  })

  it('쓸 때 파일을 다시 읽어 다른 실행이 그사이 기억한 프로젝트를 지우지 않는다', async () => {
    const trust = store()
    expect(await trust.isTrusted(project)).toBe(false)
    // 다른 SandBot이 그사이 기억했다
    await writeFile(file, JSON.stringify({ version: 1, projects: ['/elsewhere'] }))
    expect(await trust.grant(project)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8')).projects).toEqual(['/elsewhere', project])
  })

  it('동시에 믿은 프로젝트는 모두 남는다', async () => {
    const other = join(dir, 'Other')
    await mkdir(other)
    const trust = store()
    await Promise.all([trust.grant(project), trust.grant(other)])
    const saved = JSON.parse(await readFile(file, 'utf8')).projects as string[]
    expect([...saved].sort()).toEqual([other, project].sort())
  })

  it('파일을 쓰지 못해도 이 실행 동안은 믿는다', async () => {
    const trust = new CodeTrustStore({
      file: join(dir, 'missing', 'code-trust.json'),
      platform: 'linux'
    })
    expect(await trust.grant(project)).toBe(true)
    expect(await trust.isTrusted(project)).toBe(true)
  })

  it('IPC grantCodeTrust: 열거나 저장한 프로젝트만 받는다', async () => {
    const trust = store()
    expect(await grantCodeTrustFor(trust, project)).toEqual({
      ok: false,
      code: 'notAllowed',
      detail: 'not an opened project'
    })
    expect(await grantCodeTrustFor(trust, 42)).toMatchObject({ ok: false, code: 'notAllowed' })
    expect(await grantCodeTrustFor(trust, '')).toMatchObject({ ok: false, code: 'notAllowed' })
    expect(await trust.isTrusted(project)).toBe(false)

    trustRoot(project)
    expect(await grantCodeTrustFor(trust, project)).toEqual({ ok: true })
    expect(await trust.isTrusted(project)).toBe(true)
    // 열린 루트지만 그사이 폴더가 사라졌다
    const gone = join(dir, 'gone')
    trustRoot(gone)
    expect(await grantCodeTrustFor(trust, gone)).toMatchObject({ ok: false, code: 'failed' })
  })
})
