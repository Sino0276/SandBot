import { describe, expect, it } from 'vitest'
import { decodeJavaQuoted, lexJava, lineAt, lineStartsOf, tokenText, type JavaToken } from './lexer'

function kinds(text: string): [string, string][] {
  return lexJava(text).tokens.map((token) => [token.kind, tokenText(text, token)])
}

function texts(text: string): string[] {
  return lexJava(text).tokens.map((token) => tokenText(text, token))
}

describe('lexJava', () => {
  it('BOM은 한 글자로 세고 토큰에 넣지 않는다', () => {
    const text = '\uFEFFclass A {}'
    const { tokens } = lexJava(text)
    expect(tokens[0]).toEqual({ kind: 'keyword', start: 1, end: 6 })
    expect(texts(text)).toEqual(['class', 'A', '{', '}'])
  })

  it('주석은 토큰이 아니고 따로 담는다', () => {
    const text = 'a // x = 1;\nb /* c\n d */ c /** doc */'
    expect(texts(text)).toEqual(['a', 'b', 'c'])
    expect(lexJava(text).comments.map((c) => text.slice(c.start, c.end))).toEqual([
      '// x = 1;',
      '/* c\n d */',
      '/** doc */'
    ])
  })

  it('문자열·문자 리터럴의 이스케이프를 건너뛴다', () => {
    expect(kinds(String.raw`"a\"b" 'c' '\'' "\\" x`)).toEqual([
      ['string', String.raw`"a\"b"`],
      ['char', "'c'"],
      ['char', String.raw`'\''`],
      ['string', String.raw`"\\"`],
      ['identifier', 'x']
    ])
    expect(kinds('"/* not a comment */" // "not a string"')).toEqual([
      ['string', '"/* not a comment */"']
    ])
  })

  it('닫히지 않은 문자열은 줄 끝에서, 블록 주석은 파일 끝에서 끝난다', () => {
    const text = 'a = "open\nb = 1; /* never closed\nc'
    const { tokens, comments } = lexJava(text)
    const open = tokens.find((token) => token.kind === 'string') as JavaToken
    expect(tokenText(text, open)).toBe('"open')
    expect(open.unterminated).toBe(true)
    expect(texts(text)).toEqual(['a', '=', '"open', 'b', '=', '1', ';'])
    expect(comments.at(-1)).toMatchObject({ end: text.length, unterminated: true })
    // 역슬래시 뒤 줄바꿈도 문자열을 닫지 못한다
    expect(texts('"a\\\nb"')).toEqual(['"a\\', 'b', '"'])
  })

  it('텍스트 블록(""")을 한 토큰으로 받는다', () => {
    const text = 's = """\n  a "quoted" \\""" b\n  """; t = 1'
    const tokens = lexJava(text).tokens
    expect(tokens[2]).toMatchObject({ kind: 'textBlock' })
    expect(tokenText(text, tokens[2])).toBe('"""\n  a "quoted" \\""" b\n  """')
    expect(texts(text).slice(3)).toEqual([';', 't', '=', '1'])
    expect(lexJava('"""\nnever').tokens[0]).toMatchObject({ kind: 'textBlock', unterminated: true })
  })

  it('숫자 리터럴(밑줄·16진·2진·8진·지수·16진 부동소수·접미사)', () => {
    const cases: [string, string][] = [
      ['0', 'integer'],
      ['1_000_000', 'integer'],
      ['0x1F', 'integer'],
      ['0xFFL', 'integer'],
      ['0b1010L', 'integer'],
      ['017', 'integer'],
      ['5L', 'integer'],
      ['1.5', 'floating'],
      ['.5', 'floating'],
      ['5.', 'floating'],
      ['1e10', 'floating'],
      ['1.5e-3f', 'floating'],
      ['2E+5D', 'floating'],
      ['2f', 'floating'],
      ['3d', 'floating'],
      ['0x1.8p1', 'floating'],
      ['0x1p-3f', 'floating'],
      ['123abc', 'invalid']
    ]
    for (const [text, kind] of cases) {
      expect(kinds(text), text).toEqual([[kind, text]])
    }
    expect(texts('1.e5 a.b 1...')).toEqual(['1.e5', 'a', '.', 'b', '1', '...'])
  })

  it('식별자는 Java 규칙(유니코드 글자·$·_)을 따르고, true·false·null은 리터럴이다', () => {
    expect(kinds('변수 $x _y π 𝑥1 var record true null class')).toEqual([
      ['identifier', '변수'],
      ['identifier', '$x'],
      ['identifier', '_y'],
      ['identifier', 'π'],
      ['identifier', '𝑥1'],
      ['identifier', 'var'],
      ['identifier', 'record'],
      ['boolean', 'true'],
      ['null', 'null'],
      ['keyword', 'class']
    ])
  })

  it('제네릭의 >>·>>>는 > 여러 개로 나눈다', () => {
    expect(texts('Map<String, List<Integer>> m')).toEqual([
      'Map',
      '<',
      'String',
      ',',
      'List',
      '<',
      'Integer',
      '>',
      '>',
      'm'
    ])
    expect(texts('a >>> b >= c >>= d')).toEqual([
      'a',
      '>',
      '>',
      '>',
      'b',
      '>=',
      'c',
      '>',
      '>=',
      'd'
    ])
    expect(texts('a <<= b << c -> d :: e')).toEqual([
      'a',
      '<<=',
      'b',
      '<<',
      'c',
      '->',
      'd',
      '::',
      'e'
    ])
  })

  it('어노테이션', () => {
    expect(texts('@Config("X") @interface A')).toEqual([
      '@',
      'Config',
      '(',
      '"X"',
      ')',
      '@',
      'interface',
      'A'
    ])
  })

  it('알 수 없는 글자는 invalid 토큰 하나다', () => {
    expect(kinds('a # b')).toEqual([
      ['identifier', 'a'],
      ['invalid', '#'],
      ['identifier', 'b']
    ])
  })

  it('줄 표는 LF·CR·CRLF를 줄 끝으로 본다', () => {
    const text = 'a\r\nb\rc\nd'
    const starts = lineStartsOf(text)
    expect(starts).toEqual([0, 3, 5, 7])
    expect(lexJava(text).lineStarts).toEqual(starts)
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((offset) => lineAt(starts, offset))).toEqual([
      1, 1, 1, 2, 2, 3, 3, 4, 4
    ])
  })

  describe('\\u 이스케이프', () => {
    it('리터럴 밖의 이스케이프(주석 안 포함)는 위험하다', () => {
      const text = '// \\u000a public static double kI = 1.25;'
      const result = lexJava(text)
      expect(result.unicodeEscapes).toEqual([{ start: 3, end: 9, char: '\n', inLiteral: false }])
      expect(result.unsafeUnicodeEscape).toBe(true)
      expect(lexJava('double k\\u0050 = 1;').unsafeUnicodeEscape).toBe(true)
    })

    it('리터럴 안의 평범한 이스케이프는 그 토큰에만 표시한다', () => {
      const text = 's = "\\u00B0"; c = \'\\u0041\';'
      const result = lexJava(text)
      expect(result.unsafeUnicodeEscape).toBe(false)
      expect(result.unicodeEscapes.map((escape) => escape.inLiteral)).toEqual([true, true])
      expect(result.tokens.filter((token) => token.unicodeEscape).map((t) => t.kind)).toEqual([
        'string',
        'char'
      ])
    })

    it('리터럴 안에서 따옴표·역슬래시·줄바꿈이 되는 이스케이프는 위험하다', () => {
      for (const escape of ['\\u0022', '\\u005c', '\\u000a', '\\u000D', '\\u0027']) {
        expect(lexJava(`s = "a${escape}b";`).unsafeUnicodeEscape, escape).toBe(true)
      }
      // 16진 네 자리가 아니면 javac 오류다
      expect(lexJava('s = "\\u00G0";').unsafeUnicodeEscape).toBe(true)
    })

    it('역슬래시가 홀수 개 앞에 있으면 이스케이프가 아니고, u는 여러 개 올 수 있다', () => {
      expect(lexJava('s = "\\\\u0041";').unicodeEscapes).toEqual([])
      expect(lexJava('s = "\\\\\\u0041";').unicodeEscapes).toHaveLength(1)
      expect(lexJava('\\uuuu0041 x').unicodeEscapes).toEqual([
        { start: 0, end: 9, char: 'A', inLiteral: false }
      ])
    })
  })

  it('어떤 입력에도 예외 없이 순서대로 겹치지 않는 토큰을 낸다', () => {
    const alphabet = [
      'a',
      '1',
      '.',
      '"',
      "'",
      '\\',
      'u',
      '/',
      '*',
      '\n',
      '\r',
      ' ',
      '<',
      '>',
      '=',
      '@',
      'x',
      '0',
      'e',
      '-',
      '한',
      '\uD835',
      '\uDC65',
      '\uFEFF',
      '#',
      '"""'
    ]
    let seed = 7
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let round = 0; round < 300; round++) {
      let text = ''
      const length = Math.floor(random() * 60)
      for (let i = 0; i < length; i++) text += alphabet[Math.floor(random() * alphabet.length)]
      const { tokens, comments } = lexJava(text)
      let previous = 0
      for (const token of [...tokens, ...comments].sort((a, b) => a.start - b.start)) {
        expect(token.start, text).toBeGreaterThanOrEqual(previous)
        expect(token.end, text).toBeGreaterThan(token.start)
        expect(token.end, text).toBeLessThanOrEqual(text.length)
        previous = token.end
      }
    }
  })
})

describe('decodeJavaQuoted', () => {
  it('Java 이스케이프와 \\u를 푼다', () => {
    expect(decodeJavaQuoted(String.raw`"a\tb\n\"q\" \\ \101\0 \u00B0"`)).toBe('a\tb\n"q" \\ A\0 °')
    expect(decodeJavaQuoted(String.raw`'\''`)).toBe("'")
    expect(decodeJavaQuoted(String.raw`"\\u0041"`)).toBe('\\u0041')
    expect(decodeJavaQuoted('"한글"')).toBe('한글')
  })

  it('따옴표가 맞지 않거나 이스케이프가 틀리면 null', () => {
    expect(decodeJavaQuoted('abc')).toBeNull()
    expect(decodeJavaQuoted('"abc')).toBeNull()
    expect(decodeJavaQuoted(String.raw`"\q"`)).toBeNull()
    expect(decodeJavaQuoted(String.raw`"\u12"`)).toBeNull()
  })
})
