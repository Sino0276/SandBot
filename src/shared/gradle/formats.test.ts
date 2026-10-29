import { describe, expect, it } from 'vitest'
import { parseNotation } from './notation'
import { isSafeProjectPath, resolveProjectPath } from './paths'
import { parseGradleProperties } from './properties'
import { catalogAccessor, parseVersionCatalog } from './toml'

describe('parseNotation', () => {
  it('g:a:v[:classifier][@ext]', () => {
    expect(parseNotation('g.x:a-b:1.0')).toEqual({
      group: 'g.x',
      artifact: 'a-b',
      version: '1.0',
      classifier: null,
      extension: null
    })
    expect(parseNotation('g:a:1:c@aar')).toMatchObject({ classifier: 'c', extension: 'aar' })
    expect(parseNotation('g:a:1@jar')).toMatchObject({ classifier: null, extension: 'jar' })
  })

  it('동적 버전과 범위는 받고, 경로·공백·빈 칸은 받지 않는다', () => {
    for (const version of [
      '+',
      '1.+',
      'latest.release',
      '[1.0,2.0)',
      '1.0-SNAPSHOT',
      '3.0.2-beta.1'
    ])
      expect(parseNotation(`g:a:${version}`)).toMatchObject({ version })
    for (const bad of [
      'g:a',
      'g:a:',
      ':a:1',
      'g::1',
      'g/x:a:1',
      '..:a:1',
      'g:a b:1',
      'g:a:1 ',
      'g:a:1:',
      'g:a:1@',
      'g:a:1@a.b',
      'g:a:1:c:d'
    ])
      expect(typeof parseNotation(bad), bad).toBe('string')
  })
})

describe('paths', () => {
  it('폴더 기준으로 풀고 프로젝트 밖·원격은 막는다', () => {
    expect(resolveProjectPath('TeamCode', '../build.common.gradle')).toEqual({
      ok: true,
      path: 'build.common.gradle'
    })
    expect(resolveProjectPath('TeamCode', './a/./b.gradle')).toEqual({
      ok: true,
      path: 'TeamCode/a/b.gradle'
    })
    expect(resolveProjectPath('', 'gradle\\deps.gradle')).toEqual({
      ok: true,
      path: 'gradle/deps.gradle'
    })
    expect(resolveProjectPath('TeamCode', '../../x')).toMatchObject({
      ok: false,
      code: 'outsideProject'
    })
    expect(resolveProjectPath('', '/abs')).toMatchObject({ ok: false, code: 'outsideProject' })
    expect(resolveProjectPath('', '\\\\server\\share\\x')).toMatchObject({
      ok: false,
      code: 'outsideProject'
    })
    expect(resolveProjectPath('', 'D:x.gradle')).toMatchObject({
      ok: false,
      code: 'outsideProject'
    })
    expect(resolveProjectPath('', 'HTTPS://x/y')).toMatchObject({ ok: false, code: 'remoteScript' })
    expect(resolveProjectPath('', 'file:///x')).toMatchObject({
      ok: false,
      code: 'unsupportedSyntax'
    })
    expect(resolveProjectPath('', '..')).toMatchObject({ ok: false, code: 'outsideProject' })
    expect(resolveProjectPath('', '.')).toMatchObject({ ok: false, code: 'unsupportedSyntax' })
  })

  it('Windows에서 다른 파일을 가리킬 수 있는 이름은 받지 않는다', () => {
    for (const bad of [
      'con.gradle',
      'a/NUL',
      'aux.txt',
      'a./b',
      'a /b',
      'a\u0001b',
      'a"b',
      'a*b',
      'x\\y'
    ])
      expect(isSafeProjectPath(bad), bad).toBe(false)
    expect(isSafeProjectPath('TeamCode/build.gradle')).toBe(true)
    expect(isSafeProjectPath('gradle/libs.versions.toml')).toBe(true)
    expect(isSafeProjectPath('')).toBe(false)
    expect(isSafeProjectPath('a//b')).toBe(false)
    expect(isSafeProjectPath(`${'a/'.repeat(40)}b`)).toBe(false)
  })
})

describe('parseGradleProperties', () => {
  it('key=value, key:value, key value, 주석, 줄 잇기, 이스케이프, 뒤의 것이 이긴다', () => {
    const props = parseGradleProperties(
      '# c\n! c\na=1\nb : 2\nc 3\n  d=x\\\n    y\ne=\\u0041\\t\nf=1\nf=2\ng\\:h=i\nempty=\n'
    )
    expect(Object.fromEntries([...props].map(([k, v]) => [k, v.value]))).toEqual({
      a: '1',
      b: '2',
      c: '3',
      d: 'xy',
      e: 'A\t',
      f: '2',
      'g:h': 'i',
      empty: ''
    })
    expect(props.get('d')?.line).toBe(6)
  })

  it('줄 잇기는 줄마다 끝의 역슬래시 개수로 정한다(Properties.load와 같다)', () => {
    const props = parseGradleProperties(
      // a: 짝수(\\)는 잇지 않는다, b: 홀수 셋은 잇는다, c: 역슬래시만 있는 줄도 홀수면 다시 잇는다
      'a=x\\\\\nb=x\\\\\\\n  y\nc=x\\\n\\\nz\nd=1'
    )
    expect(Object.fromEntries([...props].map(([k, v]) => [k, v.value]))).toEqual({
      a: 'x\\',
      b: 'x\\y',
      c: 'xz',
      d: '1'
    })
    expect(props.get('d')?.line).toBe(7)
  })
})

describe('parseVersionCatalog', () => {
  it('[versions]·[libraries]·[bundles]와 별칭의 -·_·. 정규화', () => {
    const catalog = parseVersionCatalog(
      [
        '[versions]',
        'a = "1.0"',
        'b = { require = "2.0" }',
        'c = { strictly = "3.0" }',
        '[libraries]',
        'x-core = { module = "g:x", version.ref = "a" }',
        "y_core = { group = 'g', name = 'y', version = \"9\" }",
        'z = "g:z:1"',
        'w = "g:w"',
        'bad = 3',
        '[bundles]',
        'all = ["x-core", "y.core"]',
        '[plugins]',
        'p = { id = "x", version = "1" }'
      ].join('\n')
    )
    expect(catalog.problems).toEqual([])
    expect([...catalog.versions]).toEqual([
      ['a', { version: '1.0', problem: null, line: 2 }],
      ['b', { version: '2.0', problem: null, line: 3 }],
      ['c', { version: null, problem: "rich version 'strictly' is not supported", line: 4 }]
    ])
    expect(catalog.libraries.get('x.core')).toMatchObject({
      group: 'g',
      artifact: 'x',
      versionRef: 'a'
    })
    expect(catalog.libraries.get('y.core')).toMatchObject({
      group: 'g',
      artifact: 'y',
      version: '9'
    })
    expect(catalog.libraries.get('z')).toMatchObject({ version: '1' })
    expect(catalog.libraries.get('w')).toMatchObject({ version: null, problem: null })
    expect(catalog.libraries.get('bad')?.problem).toBe('library is not a string or table')
    expect(catalog.bundles.get('all')?.aliases).toEqual(['x.core', 'y.core'])
    expect(catalogAccessor('a-b_c.d')).toBe('a.b.c.d')
  })

  it('읽지 못한 줄은 problems에 남기고 다음 줄부터 계속한다', () => {
    const catalog = parseVersionCatalog(
      '[versions]\na = \nb = "2"\nc = "unterminated\nd = "4" junk\ne = "5"'
    )
    expect(catalog.problems.map((p) => p.line)).toEqual([2, 4, 5])
    expect([...catalog.versions.keys()]).toEqual(['b', 'e'])
  })
})
