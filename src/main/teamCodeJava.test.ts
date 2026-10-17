import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, posix, win32 } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenJavaFileResult } from '../shared/ipc'
import { clearTrustedRoots, trustRoot } from './projectRoots'
import { containedIn, listJavaFiles, openJavaFile, type EditorOpener } from './teamCodeJava'

const PKG = 'src/main/java/org/firstinspires/ftc/teamcode'

describe('containedIn', () => {
  it('폴더 안만 받고, 폴더 자신과 바깥은 받지 않는다', () => {
    const root = '/proj/TeamCode/src/main/java'
    expect(containedIn(root, `${root}/org/Lift.java`, posix)).toBe(true)
    expect(containedIn(root, `${root}/..foo/Lift.java`, posix)).toBe(true)
    expect(containedIn(root, root, posix)).toBe(false)
    expect(containedIn(root, '/proj/TeamCode/src/main', posix)).toBe(false)
    expect(containedIn(root, '/proj/TeamCode/src/main/javax/Lift.java', posix)).toBe(false)
    expect(containedIn(root, '/etc/passwd', posix)).toBe(false)
  })

  it('Windows에서 다른 드라이브는 바깥이다(relative가 절대 경로를 돌려준다)', () => {
    const root = 'C:\\proj\\TeamCode\\src\\main\\java'
    expect(win32.relative(root, 'D:\\evil\\X.java')).toBe('D:\\evil\\X.java')
    expect(containedIn(root, 'D:\\evil\\X.java', win32)).toBe(false)
    expect(containedIn(root, '\\\\server\\share\\X.java', win32)).toBe(false)
    expect(containedIn(root, 'C:\\proj\\TeamCode\\src\\main\\java\\org\\Lift.java', win32)).toBe(
      true
    )
    // 대소문자만 다른 같은 폴더
    expect(containedIn(root, 'c:\\PROJ\\TeamCode\\src\\main\\java\\Lift.java', win32)).toBe(true)
    expect(containedIn(root, 'C:\\proj\\TeamCode\\src\\main\\Lift.java', win32)).toBe(false)
  })
})

describe('TeamCode Java', () => {
  let root: string
  let outside: string
  const java = (...parts: string[]): string => join(root, 'TeamCode', ...PKG.split('/'), ...parts)
  const put = async (target: string, content = 'class X {}'): Promise<void> => {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sandbot-java-'))
    outside = await mkdtemp(join(tmpdir(), 'sandbot-outside-'))
  })
  afterEach(async () => {
    clearTrustedRoots()
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  describe('listJavaFiles', () => {
    it('TeamCode가 없으면 빈 목록이다', async () => {
      expect(await listJavaFiles(root)).toEqual({ files: [], truncated: false, hasTeamCode: false })
      await mkdir(join(root, 'TeamCode'))
      expect(await listJavaFiles(root)).toEqual({ files: [], truncated: false, hasTeamCode: true })
    })

    it('연결할 수 있는 .java만 담고, 숨김·build·생성 폴더와 링크는 건너뛴다', async () => {
      await put(java('Lift.java'), 'public class Lift {}')
      await put(java('subsystems', 'Arm.java'))
      await put(java('리프트', '팔.java'))
      await put(java('.idea', 'Hidden.java'))
      await put(java('build', 'Built.java'))
      await put(java('sandbot', 'RobotHardware.java'))
      await put(java('SandBot', 'Copy.java'))
      await put(java('my-folder', 'Bad.java'))
      await put(java('Bad Name.java'))
      await put(java('CON.java'))
      await put(java('Notes.txt'))
      await put(java('Lift.kt'))
      await mkdir(java('Folder.java'))
      await put(join(root, 'TeamCode', 'src', 'test', 'java', 'Test.java'))
      await put(join(root, 'TeamCode', 'build', 'Generated.java'))
      // TeamCode 밖을 가리키는 링크
      await put(join(outside, 'Evil.java'))
      await put(join(outside, 'pkg', 'Deep.java'))
      await symlink(join(outside, 'Evil.java'), java('Linked.java'))
      await symlink(join(outside, 'pkg'), java('linkedpkg'), 'dir')

      const list = await listJavaFiles(root)
      expect(list.hasTeamCode).toBe(true)
      expect(list.truncated).toBe(false)
      expect(list.files.map((file) => file.path)).toEqual([
        `${PKG}/Lift.java`,
        `${PKG}/subsystems/Arm.java`,
        `${PKG}/리프트/팔.java`
      ])
      expect(list.files[0].size).toBe('public class Lift {}'.length)
      expect(list.files[0].mtimeMs).toBeGreaterThan(0)
    })

    it('한도를 넘으면 앞의 것만 담고 truncated로 알린다', async () => {
      for (const name of ['A', 'B', 'C', 'D', 'E']) await put(java(`${name}.java`))
      const list = await listJavaFiles(root, 3)
      expect(list.truncated).toBe(true)
      expect(list.files.map((file) => file.path)).toEqual([
        `${PKG}/A.java`,
        `${PKG}/B.java`,
        `${PKG}/C.java`
      ])
      expect((await listJavaFiles(root, 5)).truncated).toBe(false)
    })
  })

  describe('openJavaFile', () => {
    const opened: Parameters<EditorOpener>[] = []
    const opener: EditorOpener = async (file, projectRoot, line): Promise<OpenJavaFileResult> => {
      opened.push([file, projectRoot, line])
      return { ok: true }
    }
    beforeEach(() => {
      opened.length = 0
    })

    it('열거나 저장하지 않은 프로젝트는 열지 않는다', async () => {
      await put(java('Lift.java'))
      expect(await openJavaFile(root, `${PKG}/Lift.java`, 3, opener)).toMatchObject({
        ok: false,
        code: 'notAllowed'
      })
      expect(opened).toEqual([])
    })

    it('믿는 프로젝트의 연결 파일을 편집기로 연다', async () => {
      trustRoot(root)
      await put(java('Lift.java'))
      expect(await openJavaFile(root, `${PKG}/Lift.java`, 12, opener)).toEqual({ ok: true })
      expect(opened).toEqual([[java('Lift.java'), root, 12]])
    })

    it('줄 번호는 1 이상 정수만 넘긴다', async () => {
      trustRoot(root)
      await put(java('Lift.java'))
      for (const line of [0, -1, 1.5, '3', null, Number.NaN, 1e12]) {
        await openJavaFile(root, `${PKG}/Lift.java`, line, opener)
      }
      expect(opened.map((args) => args[2])).toEqual(Array(7).fill(undefined))
    })

    it('규칙에 맞지 않는 경로, 없는 파일, 폴더는 열지 않는다', async () => {
      trustRoot(root)
      await mkdir(java('Folder.java'), { recursive: true })
      await put(java('sandbot', 'RobotHardware.java'))
      expect(await openJavaFile(root, `${PKG}/../Lift.java`, undefined, opener)).toMatchObject({
        code: 'notAllowed'
      })
      expect(
        await openJavaFile(root, `${PKG}/sandbot/RobotHardware.java`, 1, opener)
      ).toMatchObject({ code: 'notAllowed' })
      expect(await openJavaFile(root, 42, 1, opener)).toMatchObject({ code: 'notAllowed' })
      expect(await openJavaFile(root, `${PKG}/Missing.java`, 1, opener)).toMatchObject({
        code: 'missing'
      })
      expect(await openJavaFile(root, `${PKG}/Folder.java`, 1, opener)).toMatchObject({
        code: 'notAllowed'
      })
      expect(opened).toEqual([])
    })

    it('링크가 TeamCode/src/main/java 밖이나 .java가 아닌 파일을 가리키면 열지 않는다', async () => {
      trustRoot(root)
      await put(join(outside, 'Evil.java'))
      await put(java('tool.sh'), '#!/bin/sh\n')
      await put(join(root, 'TeamCode', 'build.gradle'))
      await mkdir(java(), { recursive: true })
      await symlink(join(outside, 'Evil.java'), java('Escape.java'))
      await symlink(java('tool.sh'), java('Script.java'))
      await symlink(join(root, 'TeamCode', 'build.gradle'), java('Gradle.java'))
      await symlink(outside, java('outpkg'), 'dir')
      for (const path of [
        `${PKG}/Escape.java`,
        `${PKG}/Script.java`,
        `${PKG}/Gradle.java`,
        `${PKG}/outpkg/Evil.java`
      ]) {
        expect(await openJavaFile(root, path, 1, opener), path).toMatchObject({
          code: 'notAllowed'
        })
      }
      // 안쪽 .java를 가리키는 링크는 괜찮다
      await put(java('Real.java'))
      await symlink(java('Real.java'), java('Alias.java'))
      expect(await openJavaFile(root, `${PKG}/Alias.java`, 1, opener)).toEqual({ ok: true })
      expect(opened).toEqual([[java('Alias.java'), root, 1]])
    })
  })
})
