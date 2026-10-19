import { createHash } from 'crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, posix, win32 } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GENERATED_MARKER } from '../shared/generatedFiles'
import type { JavaLiteralEdit, OpenJavaFileResult, ReadJavaFileResult } from '../shared/ipc'
import { formatTunableLiteral } from '../shared/java/javaLiteral'
import { parseTunables } from '../shared/java/tunables'
import type { TunableNode } from '../shared/java/tunableTypes'
import { clearTrustedRoots, trustRoot } from './projectRoots'
import {
  classifyEntry,
  containedIn,
  listJavaFiles,
  listTrustedJavaFiles,
  MAX_JAVA_FILE_BYTES,
  openJavaFile,
  readJavaFile,
  renameWithRetry,
  writeJavaLiterals,
  type EditorOpener
} from './teamCodeJava'

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

    it('열거나 저장하지 않은 프로젝트는 목록을 주지 않는다', async () => {
      await put(java('Lift.java'))
      await expect(listTrustedJavaFiles(root)).rejects.toThrow(/notAllowed/)
      await expect(listTrustedJavaFiles(42)).rejects.toThrow(/notAllowed/)
      trustRoot(root)
      expect((await listTrustedJavaFiles(root)).files.map((file) => file.path)).toEqual([
        `${PKG}/Lift.java`
      ])
    })

    it('링크로 나온 항목은 lstat로 다시 본다(Windows 재분석 지점은 보통 파일·폴더, 진짜 링크는 건너뜀)', async () => {
      // Windows의 readdir는 OneDrive 주문형 파일 같은 재분석 지점도 링크로 알려 준다. 그런 항목을 흉내 낸다.
      const asLink = (name: string): Parameters<typeof classifyEntry>[1] => ({
        name,
        isSymbolicLink: () => true,
        isDirectory: () => false,
        isFile: () => false
      })
      await put(java('Placeholder.java'), 'class Placeholder {}')
      await mkdir(java('cloudpkg'), { recursive: true })
      await put(join(outside, 'Evil.java'))
      await symlink(join(outside, 'Evil.java'), java('Linked.java'))
      expect(await classifyEntry(java(), asLink('Placeholder.java'))).toMatchObject({
        name: 'Placeholder.java',
        kind: 'file'
      })
      expect(await classifyEntry(java(), asLink('cloudpkg'))).toMatchObject({
        name: 'cloudpkg',
        kind: 'dir'
      })
      expect(await classifyEntry(java(), asLink('Linked.java'))).toBeNull()
      // 그사이 없어진 항목
      expect(await classifyEntry(java(), asLink('Gone.java'))).toBeNull()
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

    it('디스크 이름이 NFD여도(macOS에서 압축한 한글 이름) 목록의 NFC 경로로 연다', async () => {
      trustRoot(root)
      const folder = '리프트'.normalize('NFD')
      const name = `${'팔'.normalize('NFD')}.java`
      await put(java(folder, name))
      const listed = (await listJavaFiles(root)).files.map((file) => file.path)
      const nfcPath = `${PKG}/리프트/팔.java`
      expect(listed).toContain(nfcPath)
      expect(await openJavaFile(root, nfcPath, undefined, opener)).toEqual({ ok: true })
      expect(opened).toEqual([[java(folder, name), root, undefined]])
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

describe('튜닝 값 읽기·쓰기', () => {
  let root: string
  let outside: string
  const rel = (name: string): string => `${PKG}/${name}`
  const java = (...parts: string[]): string => join(root, 'TeamCode', ...PKG.split('/'), ...parts)
  const put = async (target: string, content: string | Buffer): Promise<void> => {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
  const tempFiles = async (): Promise<string[]> =>
    (await readdir(java())).filter((name) => name.endsWith('.sandbot.tmp'))

  // BOM + CRLF + 한국어 주석·문자열
  const LIFT = [
    '﻿package org.firstinspires.ftc.teamcode;',
    '',
    'import com.acmerobotics.dashboard.config.Config;',
    '',
    '// 리프트 PID 값 — 한국어 주석',
    '@Config',
    'public class Lift {',
    '    public static double kP = 0.5; // 비례',
    '    public static int TARGET = 100;',
    '    public static String NAME = "리프트";',
    '    public void loop() { double local = 3.0; }',
    '}',
    ''
  ].join('\r\n')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sandbot-tunable-'))
    outside = await mkdtemp(join(tmpdir(), 'sandbot-outside-'))
    trustRoot(root)
  })
  afterEach(async () => {
    clearTrustedRoots()
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  async function readOk(path: string): Promise<Extract<ReadJavaFileResult, { ok: true }>> {
    const result = await readJavaFile(root, path)
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
    return result
  }

  function findNode(text: string, id: string): Extract<TunableNode, { kind: 'value' }> {
    for (const block of parseTunables(text).blocks) {
      for (const field of block.fields) {
        if (field.id === id && field.kind === 'value') return field
      }
    }
    throw new Error(`no ${id}`)
  }

  // 렌더러가 하듯 같은 파서로 자리를 정한다
  function editFor(text: string, id: string, literal: string): JavaLiteralEdit {
    const span = findNode(text, id).span
    if (!span) throw new Error(`no span ${id}`)
    return {
      start: span.start,
      end: span.end,
      expected: text.slice(span.start, span.end),
      text: literal
    }
  }

  it('BOM·CRLF·한국어 주석 파일: 바꾼 자리 밖의 바이트는 그대로다', async () => {
    const original = Buffer.from(LIFT, 'utf8')
    await put(java('Lift.java'), original)
    if (process.platform !== 'win32') await chmod(java('Lift.java'), 0o640)

    const read = await readOk(rel('Lift.java'))
    expect(read.text).toBe(LIFT)
    expect(read.text.charCodeAt(0)).toBe(0xfeff)
    expect(read.editable).toBe(true)
    expect(read.reason).toBeUndefined()
    expect(read.hash).toBe(sha256(original))

    const name = formatTunableLiteral('String', '리프트 "2"') as string
    const edits = [
      editFor(read.text, 'Lift#kP', '0.25'),
      editFor(read.text, 'Lift#TARGET', '120'),
      editFor(read.text, 'Lift#NAME', name)
    ]
    const result = await writeJavaLiterals(root, rel('Lift.java'), read.hash, edits)
    expect(result.status).toBe('written')
    if (result.status !== 'written') return

    const disk = await readFile(java('Lift.java'))
    expect(result.text).toBe(disk.toString('utf8'))
    expect(result.hash).toBe(sha256(disk))
    // 원래 바이트 조각 + 새 리터럴로 다시 만든 것과 바이트 단위로 같다
    const byteAt = (offset: number): number => Buffer.byteLength(LIFT.slice(0, offset), 'utf8')
    const pieces: Buffer[] = []
    let cursor = 0
    for (const edit of edits) {
      pieces.push(original.subarray(byteAt(cursor), byteAt(edit.start)))
      pieces.push(Buffer.from(edit.text, 'utf8'))
      cursor = edit.end
    }
    pieces.push(original.subarray(byteAt(cursor)))
    expect(disk.equals(Buffer.concat(pieces))).toBe(true)
    expect(disk.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true)
    expect(result.text.split('\r\n').length).toBe(LIFT.split('\r\n').length)
    expect(result.text).toContain('public static double kP = 0.25; // 비례')
    expect(findNode(result.text, 'Lift#NAME').literal).toBe(name)
    expect(await tempFiles()).toEqual([])
    if (process.platform !== 'win32')
      expect((await stat(java('Lift.java'))).mode & 0o777).toBe(0o640)

    // 돌려받은 내용·해시로 바로 다시 쓸 수 있다
    const again = await writeJavaLiterals(root, rel('Lift.java'), result.hash, [
      editFor(result.text, 'Lift#kP', '-1.0')
    ])
    expect(again.status).toBe('written')
  })

  it('읽은 뒤 파일이 바뀌었으면(해시 불일치) changed이고 파일은 그대로다', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    const external = LIFT.replace('TARGET = 100', 'TARGET = 200')
    await writeFile(java('Lift.java'), external)
    expect(
      await writeJavaLiterals(root, rel('Lift.java'), read.hash, [
        editFor(read.text, 'Lift#kP', '0.25')
      ])
    ).toEqual({ status: 'changed' })
    expect(await readFile(java('Lift.java'), 'utf8')).toBe(external)
  })

  it('안전하지 않은 편집은 거부하고 파일을 건드리지 않는다', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    const kP = editFor(read.text, 'Lift#kP', '0.25')
    const target = editFor(read.text, 'Lift#TARGET', '120')
    const name = editFor(read.text, 'Lift#NAME', '"x"')
    const localStart = read.text.indexOf('3.0')
    const local: JavaLiteralEdit = {
      start: localStart,
      end: localStart + 3,
      expected: '3.0',
      text: '4.0'
    }
    const declStart = read.text.indexOf('kP = 0.5')
    const cases: [string, JavaLiteralEdit[]][] = [
      ['expected mismatch', [{ ...kP, expected: '0.6' }]],
      ['expression', [{ ...kP, text: '1; x()' }]],
      ['text block', [{ ...name, text: '"""' }]],
      ['newline', [{ ...kP, text: '1\n' }]],
      ['unicode escape', [{ ...name, text: '"\\u0041"' }]],
      ['wrong type', [{ ...target, text: '0.25' }]],
      ['long literal in int', [{ ...target, text: '120L' }]],
      ['malformed literal', [{ ...kP, text: '1_' }]],
      ['not a tunable', [local]],
      [
        'not a literal span',
        [{ start: declStart, end: declStart + 8, expected: 'kP = 0.5', text: '0.25' }]
      ],
      ['unsorted', [target, kP]],
      ['overlap', [kP, { ...kP, text: '0.3' }]],
      ['out of range', [{ ...kP, start: read.text.length, end: read.text.length + 1 }]],
      ['empty span', [{ ...kP, end: kP.start }]]
    ]
    for (const [label, edits] of cases) {
      const result = await writeJavaLiterals(root, rel('Lift.java'), read.hash, edits)
      expect(result.status, label).toBe('refused')
    }
    expect(await readFile(java('Lift.java'), 'utf8')).toBe(LIFT)
    expect(await tempFiles()).toEqual([])
  })

  it('박싱 형식 필드에는 형식이 정확히 맞는 리터럴만, 기본형에는 javac가 받는 리터럴을 원래 모양 그대로 쓴다', async () => {
    const source = [
      'import com.acmerobotics.dashboard.config.Config;',
      '@Config',
      'public class Boxed {',
      '    public static Double kD = 0.1;',
      '    public static Long COUNT = 5L;',
      '    public static double kS = 0.5;',
      '    public static long MASK = 1L;',
      '}',
      ''
    ].join('\n')
    await put(java('Boxed.java'), source)
    const read = await readOk(rel('Boxed.java'))
    for (const [id, text] of [
      ['Boxed#kD', '1'],
      ['Boxed#kD', '0.5f'],
      ['Boxed#COUNT', '5'],
      ['Boxed#kS', '0.5L'],
      ['Boxed#MASK', '0x1_']
    ]) {
      const result = await writeJavaLiterals(root, rel('Boxed.java'), read.hash, [
        editFor(read.text, id, text)
      ])
      expect(result.status, `${id} ${text}`).toBe('refused')
    }
    expect(await readFile(java('Boxed.java'), 'utf8')).toBe(source)
    const edits = [
      editFor(read.text, 'Boxed#kD', '0.0'),
      editFor(read.text, 'Boxed#COUNT', '0x10L'),
      editFor(read.text, 'Boxed#kS', '0'),
      editFor(read.text, 'Boxed#MASK', '0xFFFFFFFF')
    ]
    const result = await writeJavaLiterals(root, rel('Boxed.java'), read.hash, edits)
    expect(result.status).toBe('written')
    expect(await readFile(java('Boxed.java'), 'utf8')).toBe(
      source
        .replace('kD = 0.1', 'kD = 0.0')
        .replace('COUNT = 5L', 'COUNT = 0x10L')
        .replace('kS = 0.5', 'kS = 0')
        .replace('MASK = 1L', 'MASK = 0xFFFFFFFF')
    )
  })

  it('인자 모양이 틀리면 거부한다', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    const kP = editFor(read.text, 'Lift#kP', '0.25')
    for (const [hash, edits] of [
      ['abc', [kP]],
      [read.hash.toUpperCase(), [kP]],
      [read.hash, 'nope'],
      [read.hash, [{ ...kP, start: 1.5 }]],
      [read.hash, [{ ...kP, text: 42 }]],
      [read.hash, [null]]
    ] as [unknown, unknown][]) {
      expect((await writeJavaLiterals(root, rel('Lift.java'), hash, edits)).status).toBe('refused')
    }
  })

  it('편집이 없으면 쓰지 않는다', async () => {
    await put(java('Lift.java'), LIFT)
    const before = await stat(java('Lift.java'))
    const read = await readOk(rel('Lift.java'))
    expect(await writeJavaLiterals(root, rel('Lift.java'), read.hash, [])).toEqual({
      status: 'written',
      text: LIFT,
      hash: read.hash
    })
    expect((await stat(java('Lift.java'))).mtimeMs).toBe(before.mtimeMs)
  })

  it('생성 표식이 있는 파일은 보여 주기만 하고 쓰지 않는다', async () => {
    const text = `// ${GENERATED_MARKER} 0123456789abcd\n${LIFT}`
    await put(java('Copied.java'), text)
    const read = await readOk(rel('Copied.java'))
    expect(read).toMatchObject({ editable: false, reason: 'generated', text })
    expect(
      await writeJavaLiterals(root, rel('Copied.java'), read.hash, [
        editFor(read.text, 'Lift#kP', '0.25')
      ])
    ).toEqual({ status: 'refused', reason: 'generated' })
  })

  it('UTF-8로 그대로 되돌릴 수 없는 파일(CP949)은 쓰지 않는다', async () => {
    // "// 리프트"를 CP949로 쓴 바이트 + 평범한 ASCII
    const bytes = Buffer.concat([
      Buffer.from([0x2f, 0x2f, 0x20, 0xb8, 0xae, 0xc7, 0xc1, 0xc6, 0xae, 0x0a]),
      Buffer.from(LIFT.slice(1), 'utf8')
    ])
    await put(java('Lift.java'), bytes)
    const read = await readOk(rel('Lift.java'))
    expect(read).toMatchObject({ editable: false, reason: 'encoding', hash: sha256(bytes) })
    expect(
      await writeJavaLiterals(root, rel('Lift.java'), read.hash, [
        editFor(read.text, 'Lift#kP', '0.25')
      ])
    ).toEqual({ status: 'refused', reason: 'encoding' })
    expect((await readFile(java('Lift.java'))).equals(bytes)).toBe(true)
  })

  it('1 MB를 넘으면 내용 없이 tooLarge로 알리고 쓰지 않는다', async () => {
    await put(java('Big.java'), `${LIFT}//${'x'.repeat(MAX_JAVA_FILE_BYTES)}`)
    expect(await readJavaFile(root, rel('Big.java'))).toEqual({
      ok: true,
      text: '',
      hash: '',
      editable: false,
      reason: 'tooLarge'
    })
    expect(
      await writeJavaLiterals(root, rel('Big.java'), 'a'.repeat(64), [
        { start: 0, end: 1, expected: 'x', text: '1' }
      ])
    ).toEqual({ status: 'refused', reason: 'tooLarge' })
  })

  it('열거나 저장하지 않은 프로젝트, 규칙에 맞지 않는 경로, 없는 파일', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    const kP = editFor(read.text, 'Lift#kP', '0.25')
    expect(await readJavaFile(root, rel('Missing.java'))).toMatchObject({
      ok: false,
      code: 'missing'
    })
    expect(await writeJavaLiterals(root, rel('Missing.java'), read.hash, [kP])).toEqual({
      status: 'missing'
    })
    expect(await readJavaFile(root, `${PKG}/../Lift.java`)).toMatchObject({ code: 'notAllowed' })
    expect(await readJavaFile(root, `${PKG}/sandbot/RobotHardware.java`)).toMatchObject({
      code: 'notAllowed'
    })
    clearTrustedRoots()
    expect(await readJavaFile(root, rel('Lift.java'))).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
    expect((await writeJavaLiterals(root, rel('Lift.java'), read.hash, [kP])).status).toBe(
      'refused'
    )
    expect(await readFile(java('Lift.java'), 'utf8')).toBe(LIFT)
  })

  it('링크가 TeamCode/src/main/java 밖이나 생성 패키지를 가리키면 읽지도 쓰지도 않는다', async () => {
    await put(join(outside, 'Evil.java'), LIFT)
    await put(java('sandbot', 'Lift.java'), LIFT)
    await mkdir(java(), { recursive: true })
    await symlink(join(outside, 'Evil.java'), java('Escape.java'))
    await symlink(java('sandbot', 'Lift.java'), java('Gen.java'))
    await symlink(outside, java('outpkg'), 'dir')
    const hash = sha256(Buffer.from(LIFT, 'utf8'))
    const kP = editFor(LIFT, 'Lift#kP', '0.25')
    for (const path of [rel('Escape.java'), rel('Gen.java'), rel('outpkg/Evil.java')]) {
      expect(await readJavaFile(root, path), path).toMatchObject({ ok: false, code: 'notAllowed' })
      expect(await writeJavaLiterals(root, path, hash, [kP]), path).toMatchObject({
        status: 'refused'
      })
    }
    expect(await readFile(join(outside, 'Evil.java'), 'utf8')).toBe(LIFT)
    expect(await readFile(java('sandbot', 'Lift.java'), 'utf8')).toBe(LIFT)
  })

  it('안쪽 링크(별칭)로 쓰면 실제 파일을 고치고 링크는 남긴다', async () => {
    await put(java('Lift.java'), LIFT)
    await symlink(java('Lift.java'), java('Alias.java'))
    const read = await readOk(rel('Alias.java'))
    const result = await writeJavaLiterals(root, rel('Alias.java'), read.hash, [
      editFor(read.text, 'Lift#kP', '0.75')
    ])
    expect(result.status).toBe('written')
    expect((await lstat(java('Alias.java'))).isSymbolicLink()).toBe(true)
    expect(await readFile(java('Lift.java'), 'utf8')).toContain('kP = 0.75;')
  })

  it('rename이 실패하면 임시 파일을 지우고 예외로 알린다', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    const failing = async (): Promise<void> => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    }
    await expect(
      writeJavaLiterals(
        root,
        rel('Lift.java'),
        read.hash,
        [editFor(read.text, 'Lift#kP', '0.25')],
        { rename: failing }
      )
    ).rejects.toThrow('disk full')
    expect(await tempFiles()).toEqual([])
    expect(await readFile(java('Lift.java'), 'utf8')).toBe(LIFT)
  })

  it('임시 파일을 쓰는 동안 다른 편집기가 저장하면(같은 크기여도) changed이고 그 내용을 남긴다', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    const external = LIFT.replace('kP = 0.5', 'kP = 0.6')
    expect(external.length).toBe(LIFT.length)
    const result = await writeJavaLiterals(
      root,
      rel('Lift.java'),
      read.hash,
      [editFor(read.text, 'Lift#kP', '0.25')],
      {
        afterTempWrite: async () => {
          expect(await tempFiles()).toEqual(['.Lift.java.sandbot.tmp'])
          await writeFile(java('Lift.java'), external)
        }
      }
    )
    expect(result).toEqual({ status: 'changed' })
    expect(await tempFiles()).toEqual([])
    expect(await readFile(java('Lift.java'), 'utf8')).toBe(external)
  })

  it('이전 실행이 남긴 임시 파일이 있어도 쓴다', async () => {
    await put(java('Lift.java'), LIFT)
    await put(java('.Lift.java.sandbot.tmp'), 'leftover')
    const read = await readOk(rel('Lift.java'))
    const result = await writeJavaLiterals(root, rel('Lift.java'), read.hash, [
      editFor(read.text, 'Lift#kP', '0.25')
    ])
    expect(result.status).toBe('written')
    expect(await tempFiles()).toEqual([])
  })

  it.skipIf(process.platform === 'win32')(
    '읽기 전용 파일은 보여 주기만 하고(readOnly) 쓰지 않는다',
    async () => {
      await put(java('Lift.java'), LIFT)
      const writable = await readOk(rel('Lift.java'))
      expect(writable.editable).toBe(true)
      const edits = [editFor(writable.text, 'Lift#kP', '0.25')]
      await chmod(java('Lift.java'), 0o444)
      // 읽기: 내용은 주되 고칠 수 없다(쓰기와 같은 규칙)
      const read = await readOk(rel('Lift.java'))
      expect(read).toEqual({
        ok: true,
        text: LIFT,
        hash: writable.hash,
        editable: false,
        reason: 'readOnly'
      })
      // 쓸 수 있을 때 읽고 그 뒤 읽기 전용이 됐어도 쓰지 않는다
      expect(await writeJavaLiterals(root, rel('Lift.java'), writable.hash, edits)).toEqual({
        status: 'refused',
        reason: 'readOnly'
      })
      expect(await readFile(java('Lift.java'), 'utf8')).toBe(LIFT)
      expect(await tempFiles()).toEqual([])
      // 인코딩·생성 표식이 먼저다
      const generated = `// ${GENERATED_MARKER} 0123456789abcd\n${LIFT}`
      await put(java('Copied.java'), generated)
      await chmod(java('Copied.java'), 0o444)
      expect(await readOk(rel('Copied.java'))).toMatchObject({
        editable: false,
        reason: 'generated'
      })
      // 쓰기 가능하게 되돌리면 다시 고칠 수 있다
      await chmod(java('Lift.java'), 0o644)
      await chmod(java('Copied.java'), 0o644)
      expect(await readOk(rel('Lift.java'))).toMatchObject({ editable: true })
      expect((await writeJavaLiterals(root, rel('Lift.java'), writable.hash, edits)).status).toBe(
        'written'
      )
    }
  )

  // root는 권한 비트와 관계없이 쓸 수 있으므로 이 검사는 보통 사용자로 돌 때만 한다(CI 등)
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '이 사용자가 쓸 수 없는 폴더의 파일은 쓰기 비트가 있어도 읽기 전용이다(바꿔치기하지 않는다)',
    async () => {
      await put(java('Lift.java'), LIFT)
      const writable = await readOk(rel('Lift.java'))
      const edits = [editFor(writable.text, 'Lift#kP', '0.25')]
      await chmod(java(), 0o555)
      try {
        expect(await readOk(rel('Lift.java'))).toMatchObject({
          editable: false,
          reason: 'readOnly'
        })
        expect(await writeJavaLiterals(root, rel('Lift.java'), writable.hash, edits)).toEqual({
          status: 'refused',
          reason: 'readOnly'
        })
        expect(await readFile(java('Lift.java'), 'utf8')).toBe(LIFT)
      } finally {
        await chmod(java(), 0o755)
      }
    }
  )

  it('Windows에서 rename을 다시 하기 전에 파일이 바뀌면 changed이고 그 내용을 남긴다', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    const external = LIFT.replace('TARGET = 100', 'TARGET = 200')
    let renames = 0
    const result = await writeJavaLiterals(
      root,
      rel('Lift.java'),
      read.hash,
      [editFor(read.text, 'Lift#kP', '0.25')],
      {
        platform: 'win32',
        // 백신이 파일을 잡고 있는 동안(EPERM) 다른 편집기가 저장했다
        rename: async () => {
          renames++
          await writeFile(java('Lift.java'), external)
          throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
        }
      }
    )
    expect(result).toEqual({ status: 'changed' })
    expect(renames).toBe(1)
    expect(await readFile(java('Lift.java'), 'utf8')).toBe(external)
    expect(await tempFiles()).toEqual([])
  })

  it('Windows에서 rename을 다시 할 때 파일이 그대로면 쓴다', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    let renames = 0
    const result = await writeJavaLiterals(
      root,
      rel('Lift.java'),
      read.hash,
      [editFor(read.text, 'Lift#kP', '0.25')],
      {
        platform: 'win32',
        rename: async (from, to) => {
          if (renames++ < 2) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
          await rename(from, to)
        }
      }
    )
    expect(result.status).toBe('written')
    expect(renames).toBe(3)
    expect(await readFile(java('Lift.java'), 'utf8')).toContain('kP = 0.25;')
    expect(await tempFiles()).toEqual([])
  })

  it('같은 루트의 쓰기는 차례로 한다(둘째는 첫째가 바꾼 해시를 본다)', async () => {
    await put(java('Lift.java'), LIFT)
    const read = await readOk(rel('Lift.java'))
    const [first, second] = await Promise.all([
      writeJavaLiterals(root, rel('Lift.java'), read.hash, [editFor(read.text, 'Lift#kP', '0.25')]),
      writeJavaLiterals(root, rel('Lift.java'), read.hash, [editFor(read.text, 'Lift#TARGET', '7')])
    ])
    expect(first.status).toBe('written')
    expect(second).toEqual({ status: 'changed' })
    expect(await readFile(java('Lift.java'), 'utf8')).toContain('kP = 0.25;')
  })
})

describe('renameWithRetry', () => {
  const error = (code: string): Error => Object.assign(new Error(code), { code })

  it('Windows에서 EPERM·EACCES·EBUSY는 늘려 가며 다시 한다', async () => {
    const codes = ['EPERM', 'EBUSY', 'EACCES']
    const sleeps: number[] = []
    let calls = 0
    await renameWithRetry('a', 'b', {
      platform: 'win32',
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      rename: async () => {
        const code = codes[calls++]
        if (code) throw error(code)
      }
    })
    expect(calls).toBe(4)
    expect(sleeps).toEqual([10, 20, 40])
  })

  it('다시 하기 전마다(기다린 뒤) beforeRetry를 부르고, false면 그만두고 false를 돌려준다', async () => {
    const order: string[] = []
    let checks = 0
    const result = await renameWithRetry('a', 'b', {
      platform: 'win32',
      sleep: async (ms) => {
        order.push(`sleep ${ms}`)
      },
      beforeRetry: async () => {
        order.push('check')
        return ++checks < 2
      },
      rename: async () => {
        order.push('rename')
        throw error('EPERM')
      }
    })
    expect(result).toBe(false)
    expect(order).toEqual(['rename', 'sleep 10', 'check', 'rename', 'sleep 20', 'check'])
    // 처음에 바로 바꾸면 부르지 않는다
    expect(
      await renameWithRetry('a', 'b', {
        platform: 'win32',
        beforeRetry: async () => {
          throw new Error('not called')
        },
        rename: async () => undefined
      })
    ).toBe(true)
  })

  it('다른 오류나 다른 OS는 바로 실패하고, 2초쯤 지나면 그만둔다', async () => {
    const noSleep = async (): Promise<void> => undefined
    await expect(
      renameWithRetry('a', 'b', {
        platform: 'win32',
        sleep: noSleep,
        rename: async () => {
          throw error('ENOENT')
        }
      })
    ).rejects.toThrow('ENOENT')
    await expect(
      renameWithRetry('a', 'b', {
        platform: 'linux',
        sleep: noSleep,
        rename: async () => {
          throw error('EPERM')
        }
      })
    ).rejects.toThrow('EPERM')
    let total = 0
    await expect(
      renameWithRetry('a', 'b', {
        platform: 'win32',
        sleep: async (ms) => {
          total += ms
        },
        rename: async () => {
          throw error('EBUSY')
        }
      })
    ).rejects.toThrow('EBUSY')
    expect(total).toBeGreaterThanOrEqual(2000)
    expect(total).toBeLessThan(2200)
  })
})
