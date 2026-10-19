import { describe, expect, it } from 'vitest'
import {
  displayTunableLiteral,
  formatTunableLiteral,
  isLiteralSpanText,
  isWritableLiteral,
  javaString,
  literalFitsType,
  normalizeLiteral
} from './javaLiteral'
import type { TunableValueType } from './tunableTypes'

const TYPES: TunableValueType[] = ['boolean', 'int', 'long', 'float', 'double', 'String']

describe('formatTunableLiteral', () => {
  it('int: 10진 정수, 범위는 BigInt로(음수 최솟값 포함)', () => {
    const cases: [string, string | null][] = [
      ['42', '42'],
      [' -7 ', '-7'],
      ['+3', '3'],
      ['007', '7'],
      ['-0', '0'],
      ['1_000', '1000'],
      ['2147483647', '2147483647'],
      ['-2147483648', '-2147483648'],
      ['2147483648', null],
      ['-2147483649', null],
      ['99999999999999999999999', null],
      ['1.5', null],
      ['5L', null],
      ['0x10', null],
      ['1__0', '10'],
      ['_1', null],
      ['1_', null],
      ['abc', null],
      ['', null],
      ['- 1', null]
    ]
    for (const [input, output] of cases)
      expect(formatTunableLiteral('int', input), input).toBe(output)
  })

  it('long: 늘 L을 붙인다(Long에 5는 컴파일되지 않는다)', () => {
    expect(formatTunableLiteral('long', '5')).toBe('5L')
    expect(formatTunableLiteral('long', '5l')).toBe('5L')
    expect(formatTunableLiteral('long', '-12L')).toBe('-12L')
    expect(formatTunableLiteral('long', '9223372036854775807')).toBe('9223372036854775807L')
    expect(formatTunableLiteral('long', '-9223372036854775808')).toBe('-9223372036854775808L')
    expect(formatTunableLiteral('long', '9223372036854775808')).toBeNull()
    expect(formatTunableLiteral('long', '1.0')).toBeNull()
  })

  it('double: . 이나 지수가 없으면 .0을 붙인다', () => {
    const cases: [string, string | null][] = [
      ['1', '1.0'],
      ['1.5', '1.5'],
      ['.5', '0.5'],
      ['5.', '5.0'],
      ['-0.25', '-0.25'],
      ['-0.0', '-0.0'],
      ['00.50', '0.50'],
      ['1e5', '1e5'],
      ['1E+5', '1e5'],
      ['1.5e-3', '1.5e-3'],
      ['2e05', '2e5'],
      ['1.5d', '1.5'],
      ['4.9e-324', '4.9e-324'],
      ['1.7976931348623157e308', '1.7976931348623157e308'],
      ['0e999', '0e999'],
      ['1e400', null],
      ['1.8e308', null],
      ['2e-324', null],
      ['1e-400', null],
      ['1.5f', null],
      ['NaN', null],
      ['Infinity', null],
      ['0x1p3', null],
      ['1,5', null],
      ['', null]
    ]
    for (const [input, output] of cases)
      expect(formatTunableLiteral('double', input), input).toBe(output)
  })

  it('float: f를 붙이고 Math.fround로 범위를 본다', () => {
    const cases: [string, string | null][] = [
      ['1.5', '1.5f'],
      ['2', '2.0f'],
      ['2f', '2.0f'],
      ['-0.1F', '-0.1f'],
      ['3.4e38', '3.4e38f'],
      ['1.4e-45', '1.4e-45f'],
      ['3.5e38', null],
      ['1e-46', null],
      ['1.5d', null]
    ]
    for (const [input, output] of cases)
      expect(formatTunableLiteral('float', input), input).toBe(output)
  })

  it('boolean', () => {
    expect(formatTunableLiteral('boolean', 'true')).toBe('true')
    expect(formatTunableLiteral('boolean', ' FALSE ')).toBe('false')
    expect(formatTunableLiteral('boolean', 'yes')).toBeNull()
    expect(formatTunableLiteral('boolean', '1')).toBeNull()
  })

  it('String: 입력 그대로가 값이고, \\u 없이 제어 문자는 8진, ASCII 밖은 그대로 쓴다', () => {
    expect(formatTunableLiteral('String', 'abc')).toBe('"abc"')
    expect(formatTunableLiteral('String', '  spaced  ')).toBe('"  spaced  "')
    expect(formatTunableLiteral('String', '')).toBe('""')
    expect(formatTunableLiteral('String', 'a"b\\c')).toBe(String.raw`"a\"b\\c"`)
    expect(formatTunableLiteral('String', 'a\nb\tc\r\b\f')).toBe(String.raw`"a\nb\tc\r\b\f"`)
    expect(formatTunableLiteral('String', '\u0001\u001f\u007f1')).toBe(String.raw`"\001\037\1771"`)
    // C1 제어 문자(U+0080~009F)도 8진으로 쓴다(메인은 날것을 받지 않는다)
    expect(formatTunableLiteral('String', '\u0085\u009f ')).toBe('"\\205\\237 "')
    expect(isWritableLiteral('"\u0085"')).toBe(false)
    expect(formatTunableLiteral('String', '한글 °')).toBe('"한글 °"')
    expect(formatTunableLiteral('String', '😀')).toBe('"😀"')
    expect(formatTunableLiteral('String', '\\u0041')).toBe(String.raw`"\\u0041"`)
    // 짝 없는 서로게이트는 UTF-8로 쓸 수 없다
    expect(formatTunableLiteral('String', 'a\uD800b')).toBeNull()
    expect(formatTunableLiteral('String', '\uDC00')).toBeNull()
  })

  it('나온 리터럴은 모두 메인의 검사(쓸 수 있는 모양, 형식, 바꿀 자리)를 통과한다', () => {
    const inputs = [
      '0',
      '-1',
      '42',
      '2147483647',
      '-2147483648',
      '9223372036854775807',
      '1.5',
      '.5',
      '1e5',
      '-1.5e-3',
      '3.4e38',
      'true',
      'false',
      'abc',
      'a"b\\c\n\u0001',
      '한글'
    ]
    for (const type of TYPES) {
      for (const input of inputs) {
        const literal = formatTunableLiteral(type, input)
        if (literal === null) continue
        expect(isWritableLiteral(literal), `${type} ${input}`).toBe(true)
        expect(literalFitsType(type, literal), `${type} ${input}`).toBe(true)
        expect(isLiteralSpanText(literal), `${type} ${input}`).toBe(true)
        // 다시 넣으면 그대로다
        expect(formatTunableLiteral(type, displayTunableLiteral(type, literal))).toBe(literal)
      }
    }
  })
})

describe('isWritableLiteral', () => {
  it('어느 형식에든 컴파일되는 리터럴 하나를 받는다(정규 모양이 아닌 디스크 리터럴도)', () => {
    for (const text of [
      'true',
      'false',
      '0',
      '-1',
      '1L',
      '-9223372036854775808L',
      '1.5',
      '1.5f',
      '2f',
      '1e5',
      '1.5e-3f',
      '-0.0',
      '012',
      '0x10',
      '0b1',
      '1_000',
      '+1',
      '1.',
      '.5',
      '5d',
      '0x1p3',
      '""',
      '"a\\tb"',
      '"\\012"',
      '"\\7"',
      '"한글"',
      '"😀"'
    ]) {
      expect(isWritableLiteral(text), text).toBe(true)
    }
  })

  it('식·공백·줄바꿈·\\u·텍스트 블록·잘못된 리터럴은 받지 않는다', () => {
    for (const text of [
      '',
      '1; x()',
      '"""',
      '"""\na"""',
      '1\n',
      '"a\nb"',
      '"a\rb"',
      '"\\u0041"',
      '"\\s"',
      '"\\q"',
      '"abc',
      'abc"',
      '"a"b"',
      '08',
      '1_',
      '0x',
      '1.5L',
      '1e5L',
      '2147483648',
      '9223372036854775808L',
      '1e999',
      '- 1',
      '--1',
      '+true',
      'TRUE',
      'null',
      "'c'",
      '"\uD800"',
      '"\u0001"',
      ' 1',
      '1 '
    ]) {
      expect(isWritableLiteral(text), JSON.stringify(text)).toBe(false)
    }
  })
})

// 필드 Java 형식 → (형식, 박싱)
const FIELD: Record<string, [TunableValueType, boolean]> = {
  boolean: ['boolean', false],
  Boolean: ['boolean', true],
  int: ['int', false],
  Integer: ['int', true],
  long: ['long', false],
  Long: ['long', true],
  float: ['float', false],
  Float: ['float', true],
  double: ['double', false],
  Double: ['double', true],
  String: ['String', false]
}

describe('literalFitsType', () => {
  // [필드 형식, 글자, javac --release 8이 그 필드의 초기값으로 받는지]. 모두 javac로 확인했다('- 1'만 빼고: 공백이 든
  // 글자는 normalizeLiteral 출력이 아니라 받지 않는다. javac는 단항 식으로 받는다).
  const CASES: [string, string, boolean][] = [
    // JLS 3.10.1·3.10.2 모양: 받는 것
    ['int', '1_000', true],
    ['int', '1__2', true],
    ['double', '09.5', true],
    ['int', '0_7', true],
    ['int', '00', true],
    ['int', '010', true],
    ['int', '0x10', true],
    ['int', '0b101', true],
    ['double', '0x1p3', true],
    ['float', '0x1.8p1f', true],
    ['double', '0x.8p0', true],
    ['double', '0x1.p1', true],
    ['double', '1e10', true],
    ['double', '1.e5', true],
    ['double', '.5', true],
    ['double', '5.', true],
    ['double', '5d', true],
    ['float', '5f', true],
    ['double', '5e1_0', true],
    ['double', '1__2.3__4', true],
    ['double', '1_000.5', true],
    // 받지 않는 것
    ['int', '1_', false],
    ['int', '_1', false],
    ['int', '0x_1', false],
    ['double', '1._5', false],
    ['double', '1_.5', false],
    ['int', '08', false],
    ['int', '09', false],
    ['int', '0b2', false],
    ['double', '0x1.8', false],
    ['double', '0x1p', false],
    ['double', '0x.p1', false],
    ['double', '0x1_.8p1', false],
    ['int', '0x', false],
    ['int', '0b', false],
    ['int', '0_', false],
    ['double', '.', false],
    ['double', '1e', false],
    ['double', '1e+', false],
    ['double', '1e_5', false],
    ['double', '1.5L', false],
    ['double', '1fL', false],
    // 부호: 바로 붙은 '-'·'+' 하나만
    ['int', '+5', true],
    ['int', '-5', true],
    ['double', '-.5', true],
    ['double', '+0.0', true],
    ['int', '--1', false],
    ['int', '- 1', false],
    ['boolean', '-true', false],
    ['String', '-"a"', false],
    // int
    ['int', '2147483647', true],
    ['int', '2147483648', false],
    ['int', '-2147483648', true],
    ['int', '+2147483648', false],
    ['int', '-2147483649', false],
    ['int', '0xFFFFFFFF', true],
    ['int', '-0xFFFFFFFF', true],
    ['int', '0x100000000', false],
    ['int', '037777777777', true],
    ['int', '040000000000', false],
    ['int', `0b${'1'.repeat(32)}`, true],
    ['int', `0b${'1'.repeat(33)}`, false],
    ['int', '5L', false],
    ['int', '5.0', false],
    ['Integer', '5', true],
    ['Integer', '5L', false],
    // long
    ['long', '5', true],
    ['long', '0x10', true],
    ['long', '2147483648', false],
    ['long', '2147483648L', true],
    ['long', '9223372036854775807L', true],
    ['long', '9223372036854775808L', false],
    ['long', '-9223372036854775808L', true],
    ['long', '0xFFFFFFFFFFFFFFFFL', true],
    ['long', '0x10000000000000000L', false],
    ['long', '5l', true],
    ['long', '1.0', false],
    ['Long', '5L', true],
    ['Long', '5', false],
    // float: 정수는 넓혀지고, 부동소수는 f가 있어야 한다. 범위는 float로 정확히 반올림해 본다
    ['float', '1', true],
    ['float', '5L', true],
    ['float', '16777217', true],
    ['float', '1.5F', true],
    ['float', '1.5', false],
    ['float', '1.5d', false],
    ['float', '0x1p3', false],
    ['float', '0x1p3f', true],
    ['float', '3.4028235e38f', true],
    ['float', '3.4028236e38f', false],
    // 가장 큰 float과 2^128의 중간: 바로 아래는 가장 큰 float, 정확히 중간은 무한대(double을 거치면 둘 다 무한대)
    ['float', '340282356779733661637539395458142568447f', true],
    ['float', '340282356779733661637539395458142568448f', false],
    ['float', '1.4e-45f', true],
    ['float', '1e-46f', false],
    // 2^-150(가장 작은 float의 절반): 정확히 그 값은 0, 조금 위는 2^-149
    [
      'float',
      '7.00649232162408535461864791644958065640130970938257885878534141944895541342930300743319094181060791015625e-46f',
      false
    ],
    [
      'float',
      '7.0064923216240853546186479164495806564013097093825788587853414194489554134293030074331909418106079101563e-46f',
      true
    ],
    ['float', '0x1p-150f', false],
    ['float', '0x1.0000000001p-150f', true],
    ['float', '0e999f', true],
    ['Float', '1.5f', true],
    ['Float', '1', false],
    ['Float', '1.5', false],
    // double
    ['double', '0', true],
    ['double', '5L', true],
    ['double', '0.1f', true],
    ['double', '1.7976931348623157e308', true],
    ['double', '1.7976931348623159e308', false],
    ['double', '4.9e-324', true],
    ['double', '2.4703282292062327e-324', false],
    ['double', '2.4703282292062328e-324', true],
    ['double', '0x1p-1075', false],
    ['double', '0x1.000001p-1075', true],
    ['double', '1e-9999999999999999999999', false],
    ['double', '0e9999999999999999999999', true],
    ['Double', '0.0', true],
    ['Double', '2.5d', true],
    ['Double', '5d', true],
    ['Double', '1e5', true],
    ['Double', '0x1p3', true],
    ['Double', '0x1p3d', true],
    ['Double', '0', false],
    ['Double', '0.1f', false],
    ['Double', '5L', false],
    // boolean·String
    ['boolean', 'true', true],
    ['Boolean', 'false', true],
    ['boolean', 'TRUE', false],
    ['boolean', '1', false],
    ['String', '"a\\tb"', true],
    ['String', '"\\377"', true],
    ['String', '"\\s"', false],
    ['String', 'true', false],
    ['int', '"5"', false]
  ]

  it('javac가 받는 리터럴 토큰(부호 하나 포함)을 형식·박싱별로 받는다', () => {
    for (const [java, text, expected] of CASES) {
      const [type, boxed] = FIELD[java]
      expect(literalFitsType(type, text, boxed), `${java} ${text}`).toBe(expected)
    }
  })

  it('박싱 여부를 넘기지 않으면 기본형이다', () => {
    expect(literalFitsType('double', '1')).toBe(true)
    expect(literalFitsType('double', '1', true)).toBe(false)
    expect(literalFitsType('long', '5')).toBe(true)
    expect(literalFitsType('long', '5', true)).toBe(false)
  })
})

describe('isLiteralSpanText', () => {
  it('부호가 붙을 수 있는 리터럴 토큰 하나', () => {
    for (const text of [
      '1',
      '- 1',
      '-1.5f',
      '+2',
      '0x1F',
      '1_000L',
      '017',
      '0x1.8p1',
      '"a b"',
      '"\\""',
      'true',
      '-\t1'
    ]) {
      expect(isLiteralSpanText(text), text).toBe(true)
    }
  })

  it('식·주석·줄바꿈·앞뒤 공백·\\u·닫히지 않은 리터럴은 받지 않는다', () => {
    for (const text of [
      '',
      '1 + 2',
      'a',
      'Math.PI',
      '(1)',
      '- /*c*/ 1',
      '1 // c',
      '-\n1',
      ' 1',
      '1 ',
      '"\\u0041"',
      '"""\na"""',
      'null',
      "'c'",
      '--1',
      '-true',
      '-"a"',
      '"abc',
      '﻿1',
      '123abc'
    ]) {
      expect(isLiteralSpanText(text), JSON.stringify(text)).toBe(false)
    }
  })
})

describe('displayTunableLiteral', () => {
  it('접미사를 빼고 문자열은 풀며, 정수는 10진 값으로 보인다', () => {
    const cases: [TunableValueType, string, string][] = [
      ['double', '1.5', '1.5'],
      ['double', '1', '1'],
      ['double', '+1.5', '1.5'],
      ['double', '- 2.5', '-2.5'],
      ['double', '1e5d', '1e5'],
      ['double', '1_000.5', '1000.5'],
      ['double', '0x1.8p1', '3'],
      ['double', '0x.8p0', '0.5'],
      ['double', '0x10', '16'],
      ['float', '2.0f', '2.0'],
      ['float', '0x1p-3f', '0.125'],
      ['float', '0x1.99999ap-4f', '0.1'],
      ['long', '5L', '5'],
      ['long', '0b101L', '5'],
      ['long', '0xFFFFFFFFFFFFFFFFL', '-1'],
      ['int', '- 1', '-1'],
      ['int', '0x1F', '31'],
      ['int', '0xFFFFFFFF', '-1'],
      ['int', '-0x80000000', '-2147483648'],
      ['int', '010', '8'],
      ['int', '1_000', '1000'],
      // 리터럴의 형식이 필드 형식과 다르면 Java처럼 넓힌 값(정수 리터럴의 형식은 접미사로 정해진다)
      ['long', '0xFFFFFFFF', '-1'],
      ['long', '037777777777', '-1'],
      ['long', '0xFFFFFFFFL', '4294967295'],
      ['double', '0xFFFFFFFF', '-1'],
      ['double', '-0xFFFFFFFF', '1'],
      ['float', '037777777777', '-1'],
      ['double', '0.1f', '0.10000000149011612'],
      ['double', '-0.1F', '-0.10000000149011612'],
      ['double', '0x1.99999ap-4f', '0.10000000149011612'],
      ['double', '2.5f', '2.5'],
      ['float', '16777217', '16777216'],
      ['float', '2147483647', '2147483600'],
      ['float', '-16777217L', '-16777216'],
      ['double', '9007199254740993L', '9007199254740992'],
      ['double', '9223372036854775807L', '9223372036854776000'],
      ['double', '9007199254740991L', '9007199254740991'],
      ['double', '0x1p-1075', '0'],
      ['double', '0x1.000001p-1075', '5e-324'],
      ['double', '0x0p999999', '0'],
      ['String', '"a\\tb"', 'a\tb'],
      ['String', '"\\u00B0"', '°'],
      ['boolean', 'true', 'true'],
      ['double', 'Math.PI', 'Math.PI'],
      ['double', 'inPerTick * 2', 'inPerTick*2']
    ]
    for (const [type, literal, display] of cases) {
      expect(displayTunableLiteral(type, literal), `${type} ${literal}`).toBe(display)
    }
  })

  it('디스크의 리터럴(고칠 수 있는 모양)을 보인 글자는 그대로 다시 넣을 수 있다', () => {
    const cases: [TunableValueType, string][] = [
      ['int', '0x1F'],
      ['int', '010'],
      ['int', '- 7'],
      ['int', '0b1010'],
      ['long', '1_000L'],
      ['long', '0xFFFFFFFFFFFFFFFFL'],
      ['double', '0x1.8p1'],
      ['double', '1e5d'],
      ['double', '.5'],
      ['double', '5.'],
      ['double', '1_000.5'],
      ['double', '1'],
      ['double', '2L'],
      ['float', '1.5F'],
      ['float', '0x1.99999ap-4f'],
      ['float', '3'],
      ['boolean', 'true'],
      ['String', String.raw`"a\\b\u00e9\t"`],
      ['String', String.raw`"\0\101"`]
    ]
    for (const [type, literal] of cases) {
      const shown = displayTunableLiteral(type, literal)
      expect(formatTunableLiteral(type, shown), `${type} ${literal} → ${shown}`).not.toBeNull()
    }
  })
})

describe('normalizeLiteral', () => {
  it('토큰 사이 공백·주석을 지우고 낱말 사이에만 한 칸을 둔다', () => {
    expect(normalizeLiteral('- 1')).toBe('-1')
    expect(normalizeLiteral('-1')).toBe('-1')
    expect(normalizeLiteral(' "a  b" ')).toBe('"a  b"')
    expect(normalizeLiteral('new  Params( )')).toBe('new Params()')
    expect(normalizeLiteral('-/*c*/1')).toBe('-1')
    expect(normalizeLiteral('')).toBe('')
  })
})

describe('javaString', () => {
  it('제어 문자는 세 자리 8진이라 뒤 숫자와 붙어도 뜻이 같다', () => {
    expect(javaString('\u00001')).toBe(String.raw`"\0001"`)
  })
})
