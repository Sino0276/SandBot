import { describe, expect, it } from 'vitest'
import { lexGradle, MAX_STEPS_PER_CHAR, type GradleToken } from './lexer'
import { parseGradleScript, type Expr, type Stmt } from './parser'

function kinds(tokens: GradleToken[]): string[] {
  return tokens.map((t) => (t.kind === 'punct' || t.kind === 'ident' ? t.text : t.kind))
}

describe('lexGradle', () => {
  it('주석을 버리고 줄바꿈을 하나로 모은다', () => {
    const { tokens } = lexGradle('a // x\n\n/* y\n z */ b\n', 'groovy')
    expect(kinds(tokens)).toEqual(['a', 'newline', 'b', 'newline', 'eof'])
    expect(tokens.find((t) => t.text === 'b')?.line).toBe(4)
  })

  it('Groovy 문자열: 작은따옴표는 보간하지 않고 큰따옴표는 $a.b·${…}를 나눈다', () => {
    const { tokens } = lexGradle(`'$a' "x$a.b-\${c}" '''t$''' """u$v"""`, 'groovy')
    const strings = tokens.filter((t) => t.kind === 'string').map((t) => t.parts)
    expect(strings[0]).toEqual([{ kind: 'text', text: '$a' }])
    expect(
      strings[1]?.map((p) => (p.kind === 'text' ? p.text : p.kind === 'path' ? p.names : 'expr'))
    ).toEqual(['x', ['a', 'b'], '-', 'expr'])
    expect(strings[2]).toEqual([{ kind: 'text', text: 't$' }])
    expect(strings[3]?.[1]).toMatchObject({ kind: 'path', names: ['v'] })
  })

  it('Kotlin 문자열 보간은 이름 하나만, 세 겹 문자열은 이스케이프를 풀지 않는다', () => {
    const { tokens } = lexGradle('"$a.b" """\\n$c"""', 'kotlin')
    const strings = tokens.filter((t) => t.kind === 'string').map((t) => t.parts)
    expect(strings[0]).toEqual([
      expect.objectContaining({ kind: 'path', names: ['a'] }),
      { kind: 'text', text: '.b' }
    ])
    expect(strings[1]?.[0]).toEqual({ kind: 'text', text: '\\n' })
  })

  it('이스케이프', () => {
    const { tokens } = lexGradle(`"a\\"b\\\\c\\u0041\\$d\\n"`, 'groovy')
    expect(tokens[0].parts).toEqual([{ kind: 'text', text: 'a"b\\cA$d\n' }])
  })

  it('슬래시 문자열은 식 자리에서만, 나눗셈은 그대로', () => {
    const slashy = lexGradle('x = /a{b}\\/c/', 'groovy').tokens
    expect(kinds(slashy)).toEqual(['x', '=', 'string', 'eof'])
    expect(slashy[2].parts).toEqual([{ kind: 'text', text: 'a{b}/c' }])
    expect(kinds(lexGradle('x = a / b / c', 'groovy').tokens)).toEqual([
      'x',
      '=',
      'a',
      '/',
      'b',
      '/',
      'c',
      'eof'
    ])
  })

  it('닫히지 않은 문자열·주석은 problems에 남기고 끝까지 본다', () => {
    const string = lexGradle("a 'b\nc", 'groovy')
    expect(kinds(string.tokens)).toEqual(['a', 'invalid', 'newline', 'c', 'eof'])
    expect(string.problems).toEqual([{ line: 1, detail: 'unterminated string' }])
    const comment = lexGradle('a /* b', 'groovy')
    expect(kinds(comment.tokens)).toEqual(['a', 'eof'])
    expect(comment.problems).toEqual([{ line: 1, detail: 'unterminated comment' }])
  })

  it('CR·CRLF·BOM과 #! 줄', () => {
    const { tokens } = lexGradle('﻿#!/usr/bin/env groovy\r\na\rb\r\nc', 'groovy')
    expect(tokens.filter((t) => t.kind === 'ident').map((t) => [t.text, t.line])).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 4]
    ])
  })

  it('${…} 중첩이 한도를 넘으면 tooDeep', () => {
    expect(lexGradle(`"${'${"'.repeat(30)}${'"}'.repeat(30)}"`, 'groovy').tooDeep).toBe(true)
    expect(lexGradle(`"\${"\${"x"}"}"`, 'groovy').tooDeep).toBe(false)
  })

  it('Kotlin의 블록 주석은 중첩되고 Groovy는 처음 */에서 끝난다', () => {
    const text = 'a /* b /* c */ d */ e'
    expect(kinds(lexGradle(text, 'kotlin').tokens)).toEqual(['a', 'e', 'eof'])
    expect(kinds(lexGradle(text, 'groovy').tokens)).toEqual(['a', 'd', '*', '/', 'e', 'eof'])
    expect(kinds(lexGradle('a /**/ b /*/ c */ d', 'kotlin').tokens)).toEqual(['a', 'b', 'd', 'eof'])
    const open = lexGradle('a /* /* */ b', 'kotlin')
    expect(kinds(open.tokens)).toEqual(['a', 'eof'])
    expect(open.problems).toEqual([{ line: 1, detail: 'unterminated comment' }])
  })

  it('닫히지 않은 슬래시 문자열 시도는 나눗셈으로 다시 읽고, 그 시도의 problems는 남기지 않는다', () => {
    // 보간이 닫는 /를 삼킨 시도는 버리고 글자로 다시 읽는다
    const lexed = lexGradle('x = (/${ a\ny /', 'groovy')
    expect(kinds(lexed.tokens)).toEqual([
      'x',
      '=',
      '(',
      '/',
      '$',
      '{',
      'a',
      'newline',
      'y',
      '/',
      'eof'
    ])
    expect(lexed.problems).toEqual([])
    expect(lexed.tooDeep).toBe(false)
  })

  it('실패한 슬래시 문자열 시도를 되풀이하지 않는다(겹친 시도·닫는 글자 없는 시작이 많아도 빨리 끝난다)', () => {
    const filler = 'x '.repeat(2000)
    for (const text of [
      // 시도마다 보간이 파일 끝까지 가서 실패하고, 실패한 시도가 겹친다(예전에는 2^k)
      Array.from({ length: 12 }, () => `(/\${ ${filler}`).join('\n'),
      Array.from({ length: 16 }, () => `(/\${ ${filler}`).join('\n'),
      `${Array.from({ length: 7 }, () => '(/${ ').join('\n')}\n${'x '.repeat(120000)}`,
      // 닫는 /$를 찾아 매번 끝까지 훑었다(예전에는 제곱)
      '$/ '.repeat(85000)
    ]) {
      const started = performance.now()
      const lexed = lexGradle(text, 'groovy')
      expect(performance.now() - started).toBeLessThan(1000)
      // 한도를 넘어도 토큰 하나만큼만 더 센다
      expect(lexed.steps).toBeLessThanOrEqual((MAX_STEPS_PER_CHAR + 1) * (text.length + 1))
    }
  })

  it('도는 횟수가 한도(글자당, 또는 부른 쪽이 준 한도)를 넘으면 tooDeep', () => {
    const plain = lexGradle('a b c', 'groovy')
    expect(plain).toMatchObject({ tooDeep: false, steps: 5 })
    expect(lexGradle('a b c', 'groovy', 4)).toMatchObject({ tooDeep: true, tokens: [], steps: 5 })
  })
})

function only(text: string, dialect: 'groovy' | 'kotlin' = 'groovy'): Stmt {
  const parsed = parseGradleScript(text, dialect)
  expect(parsed.statements).toHaveLength(1)
  return parsed.statements[0]
}

function shape(expr: Expr): unknown {
  switch (expr.kind) {
    case 'name':
      return expr.name
    case 'string':
      return expr.parts.map((part) => (typeof part === 'string' ? part : shape(part)))
    case 'number':
      return Number(expr.text)
    case 'member':
      return { member: [shape(expr.target), expr.name] }
    case 'call':
      return {
        call: shape(expr.callee),
        args: expr.args.map((a) => (a.name ? { [a.name]: shape(a.value) } : shape(a.value))),
        ...(expr.closure ? { closure: expr.closure.body.length } : {})
      }
    default:
      return expr.kind
  }
}

describe('parseGradleScript', () => {
  it('Groovy 명령식: 인자, 이름 붙은 인자, 클로저, 사슬', () => {
    const stmt = only("implementation 'a:b:1', 'c:d:2'")
    expect(stmt.kind === 'expr' && shape(stmt.expr)).toEqual({
      call: 'implementation',
      args: [['a:b:1'], ['c:d:2']]
    })
    const named = only("exclude group: 'x', module: 'y'")
    expect(named.kind === 'expr' && shape(named.expr)).toEqual({
      call: 'exclude',
      args: [{ group: ['x'] }, { module: ['y'] }]
    })
    const block = only('maven {\n  url "u"\n}')
    expect(block.kind === 'expr' && shape(block.expr)).toEqual({
      call: 'maven',
      args: [],
      closure: 1
    })
    const chain = only("id 'x' version '1' apply false")
    expect(chain.kind === 'expr' && shape(chain.expr)).toEqual({
      call: {
        member: [
          { call: { member: [{ call: 'id', args: [['x']] }, 'version'] }, args: [['1']] },
          'apply'
        ]
      },
      args: ['false']
    })
  })

  it('괄호 호출과 뒤따르는 클로저, 다음 줄의 .으로 잇기', () => {
    const stmt = only("implementation('a:b:1') {\n  transitive = false\n}")
    expect(stmt.kind === 'expr' && shape(stmt.expr)).toEqual({
      call: 'implementation',
      args: [['a:b:1']],
      closure: 1
    })
    const chained = only('a.b()\n  .c()')
    expect(chained.kind === 'expr' && shape(chained.expr)).toEqual({
      call: { member: [{ call: { member: ['a', 'b'] }, args: [] }, 'c'] },
      args: []
    })
  })

  it('선언: def·형식·수식어(Groovy), val·by(Kotlin), 메서드 정의는 넘김', () => {
    expect(only("def x = 'v'")).toMatchObject({ kind: 'decl', name: 'x' })
    expect(only("final String x = 'v'")).toMatchObject({ kind: 'decl', name: 'x' })
    expect(only('Map<String, String> m = [:]')).toMatchObject({ kind: 'decl', name: 'm' })
    expect(only('def foo(a) {\n  return a\n}')).toMatchObject({ kind: 'skip' })
    expect(only("implementation project(':x')")).toMatchObject({ kind: 'expr' })
    expect(only('val x: String = "v"', 'kotlin')).toMatchObject({ kind: 'decl', name: 'x' })
    expect(only('val x: String by project', 'kotlin')).toMatchObject({
      kind: 'decl',
      name: 'x',
      value: null
    })
    expect(only('fun f(): Int {\n  return 1\n}', 'kotlin')).toMatchObject({ kind: 'skip' })
  })

  it('대입과 Kotlin 이름 붙은 인자', () => {
    expect(only("ext.x = 'v'")).toMatchObject({ kind: 'assign', op: '=' })
    expect(only('extra["x"] = "v"', 'kotlin')).toMatchObject({ kind: 'assign' })
    const stmt = only('implementation(group = "g", name = "a")', 'kotlin')
    expect(stmt.kind === 'expr' && shape(stmt.expr)).toEqual({
      call: 'implementation',
      args: [{ group: ['g'] }, { name: ['a'] }]
    })
  })

  it('조건문은 통째로 건너뛰고 안의 이름을 모은다', () => {
    const stmt = only(
      "if (a) {\n  implementation 'x'\n} else if (b) {\n  api 'y'\n} else {\n  c()\n}"
    )
    expect(stmt).toMatchObject({ kind: 'control', keyword: 'if' })
    expect(stmt.kind === 'control' && stmt.idents).toEqual(
      expect.arrayContaining(['implementation', 'api', 'c'])
    )
    expect(only('try {\n  a()\n} catch (e) {\n  b()\n} finally {\n  c()\n}')).toMatchObject({
      kind: 'control'
    })
  })

  it('읽지 못한 문장은 그 문장만 버리고 다음 문장을 읽는다', () => {
    const parsed = parseGradleScript("a = = b\nimplementation 'ok'\n} stray\nc 'd'", 'groovy')
    // 짝 없는 '}'만 버리고, 뒤의 stray는 이름 하나짜리 문장이다
    expect(parsed.statements.map((s) => s.kind)).toEqual([
      'unknown',
      'expr',
      'unknown',
      'expr',
      'expr'
    ])
  })

  it('import·package·주석(annotation)', () => {
    const parsed = parseGradleScript(
      "import java.util.regex.Pattern\n@Suppress('x')\ndef a = 1",
      'groovy'
    )
    expect(parsed.statements.map((s) => s.kind)).toEqual(['skip', 'decl'])
  })

  it('중첩이 한도를 넘으면 tooDeep', () => {
    expect(parseGradleScript(`${'a { '.repeat(100)}${'} '.repeat(100)}`, 'groovy').tooDeep).toBe(
      true
    )
    expect(parseGradleScript(`x = ${'('.repeat(100)}1${')'.repeat(100)}`, 'groovy').tooDeep).toBe(
      true
    )
    expect(parseGradleScript(`${'a { '.repeat(20)}${'} '.repeat(20)}`, 'groovy').tooDeep).toBe(
      false
    )
  })
})
