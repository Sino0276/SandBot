// 튜닝 값 리터럴의 형식·검사. 렌더러(입력 → 리터럴)와 메인(쓰기 전 검사)이 같은 규칙을 쓴다.
//
// javac 21로 확인한 규칙(review-tunables.md "Literal formatting per type"):
// - float 필드에 1.5(double)는 "possible lossy conversion", long에 3000000000은 "integer number too large"다.
// - 박싱 형식은 형식이 정확히 맞는 리터럴만 받는다(Double에 1, Long에 5, Float에 2·2.5는 오류).
//   그래서 long은 늘 L을, double은 늘 '.0'이나 지수를, float는 늘 f를 붙인다(기본형·박싱 모두 맞는다).
// - \u 이스케이프는 토큰을 나누기 전에 바뀐다("a\u000ab"는 "unclosed string literal"). 쓰는 문자열에는 \u를 넣지 않고,
//   제어 문자는 8진 이스케이프로, ASCII 밖의 글자는 그대로 쓴다(파일은 UTF-8이다).
// - 입력은 JS 숫자를 거치지 않는다(범위 확인은 BigInt로 정확히 한다).
// - 쓰기 검사(literalFitsType)는 정규 모양뿐 아니라 javac가 받는 리터럴 토큰을 모두 받는다(저장 뒤 실행 취소한 값을
//   디스크의 원래 글자 그대로 되돌려 쓰려고). javac --release 8과 비교하는 차등 테스트로 확인했다.
import { decodeJavaQuoted, lexJava, type JavaToken } from './lexer'
import type { TunableValueType } from './tunableTypes'

// 메인이 받는 글자 길이 한도(문자열 리터럴도 이보다 길면 받지 않는다)
const MAX_LITERAL_LENGTH = 65536
// 숫자 입력 길이 한도
const MAX_NUMBER_LENGTH = 400

const INT_MIN = -(2n ** 31n)
const INT_MAX = 2n ** 31n - 1n
const LONG_MIN = -(2n ** 63n)
const LONG_MAX = 2n ** 63n - 1n

const BOOLEAN = /^(?:true|false)$/
// 따옴표 안: 따옴표·역슬래시·제어 문자(Cc: C0·DEL·C1, 줄바꿈 포함)가 아닌 글자, 또는 \b \t \n \f \r \" \' \\ 와
// 8진 이스케이프. \u와 \s(Java 15)는 받지 않는다.
const STRING = /^"(?:[^"\\\p{Cc}]|\\[btnfr"'\\]|\\[0-3][0-7]{0,2}|\\[4-7][0-7]?)*"$/u

// 숫자 리터럴(JLS 3.10.1·3.10.2). 밑줄은 숫자 사이에만 온다(1_, 0x_1, 1._5, 1_.5는 오류).
const DIGITS = '[0-9](?:_*[0-9])*'
const HEX_DIGITS = '[0-9a-fA-F](?:_*[0-9a-fA-F])*'
// 정수: 10진(0이거나 0이 아닌 숫자로 시작), 16진, 8진(0 뒤에 밑줄·8진 숫자: 00, 0_7), 2진. L이면 long.
// 08은 어느 것도 아니다(09.5는 부동소수다).
const INTEGER_LITERAL = new RegExp(
  `^(?:(0|[1-9](?:_*[0-9])*)|0[xX](${HEX_DIGITS})|0(_*[0-7](?:_*[0-7])*)|0[bB]([01](?:_*[01])*))([lL]?)$`
)
// 10진 부동소수: 정수부·점·소수부·지수·접미사(1.e5, .5, 5d, 09.5). 숫자는 정수부나 소수부에 있어야 하고,
// 점·지수·접미사 중 하나가 있어야 부동소수다.
const DECIMAL_FLOATING = new RegExp(
  `^(${DIGITS})?(\\.(${DIGITS})?)?(?:[eE]([-+]?${DIGITS}))?([fFdD]?)$`
)
// 16진 부동소수: 2진 지수(p)가 꼭 있다(0x1p3, 0x1.8p1f, 0x.8p0)
const HEX_FLOATING = new RegExp(
  `^0[xX](${HEX_DIGITS})?(?:\\.(${HEX_DIGITS})?)?[pP]([-+]?${DIGITS})([fFdD]?)$`
)

// 짝이 없는 서로게이트가 있으면 UTF-8로 쓸 때 U+FFFD로 바뀐다
function isWellFormedText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      i++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function isWritableString(text: string): boolean {
  return STRING.test(text) && isWellFormedText(text)
}

const clean = (digits: string): string => digits.replace(/_/g, '')

// m × 2^exp2 × 10^exp10과 t × 2^tExp2를 정확히 비교한다(-1, 0, 1). 지수는 정수이고 크지 않아야 한다.
function compareScaled(m: bigint, exp2: number, exp10: number, t: bigint, tExp2: number): number {
  let left = m
  let right = t
  const shift = exp2 - tExp2
  if (shift >= 0) left <<= BigInt(shift)
  else right <<= BigInt(-shift)
  if (exp10 >= 0) left *= 10n ** BigInt(exp10)
  else right *= 10n ** BigInt(-exp10)
  return left < right ? -1 : left > right ? 1 : 0
}

// 부동소수 리터럴의 값(m × 2^exp2 × 10^exp10)이 그 리터럴의 형식(float·double)으로 반올림해 유한하고, 0이 아닌 숫자가
// 있으면 0이 되지 않는지("floating-point number too large/small"). JS 숫자를 거치면 double을 거친 두 번 반올림이
// float 경계에서 틀리므로 정확히 비교한다. 가장 가까운 짝수로 반올림하므로 가장 큰 유한 값과 2^max의 중간은 무한대,
// 가장 작은 비정규 값의 절반은 0이 된다.
function floatingFits(m: bigint, exp2: number, exp10: number, single: boolean): boolean {
  if (m === 0n) return true
  const precision = single ? 24 : 53
  const maxExponent = single ? 128 : 1024
  // 가장 작은 비정규 값(2^-149, 2^-1074)의 절반
  const minExponent = single ? -150 : -1075
  // 대략의 크기(log2 아래쪽 경계)로 먼저 거른다(큰 지수로 큰 수를 만들지 않게)
  const log2 = m.toString(2).length - 1 + exp2 + exp10 * Math.log2(10)
  if (!(log2 <= maxExponent + 1)) return false
  if (!(log2 >= minExponent - 2)) return false
  const halfwayToInfinity = (1n << BigInt(precision + 1)) - 1n
  if (compareScaled(m, exp2, exp10, halfwayToInfinity, maxExponent - precision - 1) >= 0)
    return false
  return compareScaled(m, exp2, exp10, 1n, minExponent) > 0
}

type NumericLiteralType = 'int' | 'long' | 'float' | 'double'

// 부호 하나(바로 붙은 '-'·'+')와 숫자 리터럴 토큰 하나로 된 글자가 javac에서 컴파일되면 그 리터럴의 형식, 아니면 null.
// 정수의 범위: 10진은 부호 있는 범위(2147483648·9223372036854775808L은 '-' 뒤에서만), 16진·8진·2진은 32·64비트에
// 들어가면 된다. 부동소수는 floatingFits.
function numericLiteralType(text: string): NumericLiteralType | null {
  const sign = text[0] === '-' || text[0] === '+' ? text[0] : ''
  const body = text.slice(sign.length)
  const integer = INTEGER_LITERAL.exec(body)
  if (integer) {
    const [, decimal, hex, octal, binary, suffix] = integer
    const long = suffix !== ''
    const bits = long ? 64n : 32n
    let value: bigint
    let limit: bigint
    if (decimal !== undefined) {
      value = BigInt(clean(decimal))
      limit = (1n << (bits - 1n)) - (sign === '-' ? 0n : 1n)
    } else {
      value =
        hex !== undefined
          ? BigInt(`0x${clean(hex)}`)
          : octal !== undefined
            ? BigInt(`0o${clean(octal)}`)
            : BigInt(`0b${clean(binary)}`)
      limit = (1n << bits) - 1n
    }
    if (value > limit) return null
    return long ? 'long' : 'int'
  }
  const decimal = DECIMAL_FLOATING.exec(body)
  if (decimal) {
    const [, whole = '', dot, fraction = '', exponent, suffix] = decimal
    if (whole === '' && fraction === '') return null
    if (dot === undefined && exponent === undefined && suffix === '') return null
    const single = suffix === 'f' || suffix === 'F'
    const digits = clean(whole) + clean(fraction)
    const exp10 = Number(clean(exponent ?? '0')) - clean(fraction).length
    if (!floatingFits(BigInt(digits), 0, exp10, single)) return null
    return single ? 'float' : 'double'
  }
  const hexFloating = HEX_FLOATING.exec(body)
  if (hexFloating) {
    const [, whole = '', fraction = '', exponent, suffix] = hexFloating
    if (whole === '' && fraction === '') return null
    const single = suffix === 'f' || suffix === 'F'
    const digits = clean(whole) + clean(fraction)
    const exp2 = Number(clean(exponent)) - 4 * clean(fraction).length
    if (!floatingFits(BigInt(`0x${digits}`), exp2, 0, single)) return null
    return single ? 'float' : 'double'
  }
  return null
}

// 그 형식의 필드가 받는 리터럴 형식. 기본형은 넓히는 변환(int → long → float → double)을 받고,
// 박싱 형식은 형식이 정확히 맞는 리터럴만 받는다(Double에 1, Long에 5, Float에 2·2.5는 오류).
const WIDENING: readonly NumericLiteralType[] = ['int', 'long', 'float', 'double']

// 글자(normalizeLiteral로 맞춘 것)가 리터럴 토큰 하나(정수·부동소수는 바로 붙은 '-'·'+' 하나를 받는다)이고,
// javac(--release 8)가 그 형식(기본형 또는 박싱) 필드의 초기값으로 받는지. 디스크의 원래 리터럴(0, 5, 0x10, 1_000.5,
// +5, 1.5F, .5, 010)도 받아, 저장 뒤 실행 취소한 값을 원래 글자 그대로 되돌려 쓸 수 있다. 문자열은 쓸 수 있는 모양만
// 받는다(\u·제어 문자 없음, isWritableString). 렌더러(저장 계획)와 메인(쓰기 전)이 같이 쓴다.
export function literalFitsType(type: TunableValueType, text: string, boxed = false): boolean {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_LITERAL_LENGTH)
    return false
  switch (type) {
    case 'boolean':
      return BOOLEAN.test(text)
    case 'String':
      return isWritableString(text)
    default: {
      if (text.length > MAX_NUMBER_LENGTH) return false
      const literal = numericLiteralType(text)
      if (literal === null) return false
      if (boxed) return literal === type
      return WIDENING.indexOf(literal) <= WIDENING.indexOf(type)
    }
  }
}

const FIELD_TYPES: readonly TunableValueType[] = [
  'boolean',
  'int',
  'long',
  'float',
  'double',
  'String'
]

// 메인이 받는 새 리터럴(형식과 관계없는 안전 검사): 어느 형식(기본형·박싱)의 필드에든 컴파일되는 리터럴 하나.
// 식·줄바꿈·주석·\u·텍스트 블록은 받지 않는다. 필드 형식과 맞는지는 literalFitsType으로 따로 본다.
export function isWritableLiteral(text: string): boolean {
  return FIELD_TYPES.some(
    (type) => literalFitsType(type, text, false) || literalFitsType(type, text, true)
  )
}

const LITERAL_KINDS = new Set<JavaToken['kind']>(['integer', 'floating', 'boolean', 'string'])

// 바꿀 자리(expected)로 받는 글자: 부호가 붙을 수 있는 리터럴 토큰 하나(주석·줄바꿈 없음)
export function isLiteralSpanText(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_LITERAL_LENGTH)
    return false
  if (/[\r\n]/.test(text)) return false
  const lexed = lexJava(text)
  if (lexed.comments.length > 0 || lexed.unicodeEscapes.length > 0) return false
  const { tokens } = lexed
  const last = tokens.at(-1)
  // 앞뒤 공백·BOM 없이 토큰으로 꽉 차야 한다
  if (!last || tokens[0].start !== 0 || last.end !== text.length) return false
  if (last.unterminated || !LITERAL_KINDS.has(last.kind)) return false
  if (tokens.length === 1) return true
  if (tokens.length !== 2) return false
  const sign = text.slice(tokens[0].start, tokens[0].end)
  return (
    tokens[0].kind === 'operator' &&
    (sign === '-' || sign === '+') &&
    (last.kind === 'integer' || last.kind === 'floating')
  )
}

// Java 문자열 리터럴로 쓴다. \u는 쓰지 않고, 제어 문자(C0·DEL·C1)는 세 자리 8진(뒤 숫자와 붙어 뜻이 바뀌지 않게),
// ASCII 밖의 글자는 그대로 둔다. 짝 없는 서로게이트는 UTF-8로 쓸 수 없으므로 null.
export function javaString(value: string): string | null {
  if (!isWellFormedText(value)) return null
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\b') out += '\\b'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\f') out += '\\f'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f))
      out += `\\${code.toString(8).padStart(3, '0')}`
    else out += ch
  }
  return `${out}"`
}

function formatInteger(input: string, long: boolean): string | null {
  const match = (long ? /^([-+]?)([0-9](?:_*[0-9])*)[lL]?$/ : /^([-+]?)([0-9](?:_*[0-9])*)$/).exec(
    input
  )
  if (!match) return null
  const digits = match[2].replace(/_/g, '').replace(/^0+(?=[0-9])/, '')
  const sign = match[1] === '-' && digits !== '0' ? '-' : ''
  const value = BigInt(sign + digits)
  if (long ? value < LONG_MIN || value > LONG_MAX : value < INT_MIN || value > INT_MAX) return null
  return `${sign}${digits}${long ? 'L' : ''}`
}

function formatFloating(input: string, single: boolean): string | null {
  const suffix = single ? 'fF' : 'dD'
  const match = new RegExp(
    `^([-+]?)([0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE]([-+]?[0-9]+))?[${suffix}]?$`
  ).exec(input)
  if (!match) return null
  const [whole, fraction] = match[2].split('.')
  const hasDot = match[2].includes('.')
  const integer = whole.replace(/^0+(?=[0-9])/, '') || '0'
  let body = hasDot ? `${integer}.${fraction || '0'}` : integer
  if (match[3] !== undefined) {
    const negative = match[3].startsWith('-')
    const exponent = match[3].replace(/^[-+]/, '').replace(/^0+(?=[0-9])/, '')
    body += `e${negative ? '-' : ''}${exponent}`
  } else if (!hasDot) {
    body += '.0'
  }
  // 범위는 literalFitsType과 같은 정확한 비교로 본다(쓸 수 있는 리터럴만 낸다)
  if (numericLiteralType(single ? `${body}f` : body) === null) return null
  return `${match[1] === '-' ? '-' : ''}${body}${single ? 'f' : ''}`
}

// 사용자 입력 → 그 형식의 정규 리터럴(받을 수 없으면 null). JS 숫자를 거치지 않는다(범위 확인 제외).
// 숫자·boolean은 앞뒤 공백을 무시하고, 문자열은 입력 그대로가 값이다.
export function formatTunableLiteral(type: TunableValueType, input: string): string | null {
  if (typeof input !== 'string') return null
  if (type === 'String') {
    const literal = javaString(input)
    return literal !== null && literal.length <= MAX_LITERAL_LENGTH ? literal : null
  }
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_NUMBER_LENGTH) return null
  switch (type) {
    case 'boolean': {
      const lower = trimmed.toLowerCase()
      return lower === 'true' || lower === 'false' ? lower : null
    }
    case 'int':
      return formatInteger(trimmed, false)
    case 'long':
      return formatInteger(trimmed, true)
    case 'float':
      return formatFloating(trimmed, true)
    case 'double':
      return formatFloating(trimmed, false)
  }
}

// 정수 리터럴의 값(10진). 16진·8진·2진은 그 형식의 비트 수로 감싼다(0xFFFFFFFF는 int -1).
function integerValue(literal: string, bits: 32 | 64): string | null {
  const match = /^([-+]?)(.+?)[lL]?$/.exec(literal)
  if (!match) return null
  const body = match[2].replace(/_/g, '')
  let value: bigint
  let decimal = false
  try {
    if (/^0[xX][0-9a-fA-F]+$/.test(body)) value = BigInt(body)
    else if (/^0[bB][01]+$/.test(body)) value = BigInt(body)
    else if (/^0[0-7]+$/.test(body)) value = BigInt(`0o${body.slice(1)}`)
    else if (/^[0-9]+$/.test(body)) {
      value = BigInt(body)
      decimal = true
    } else return null
  } catch {
    return null
  }
  if (!decimal) value = BigInt.asIntN(bits, value)
  if (match[1] === '-') value = decimal ? -value : BigInt.asIntN(bits, -value)
  return value.toString()
}

// 부호 하나와 숫자 토큰 하나로 된 글자를 나눈다(아니면 null)
function splitNumber(text: string): { negative: boolean; token: JavaToken; body: string } | null {
  const { tokens } = lexJava(text)
  const last = tokens.at(-1)
  if (!last || (last.kind !== 'integer' && last.kind !== 'floating')) return null
  if (tokens.length > 2) return null
  let negative = false
  if (tokens.length === 2) {
    const sign = text.slice(tokens[0].start, tokens[0].end)
    if (sign !== '-' && sign !== '+') return null
    negative = sign === '-'
  }
  return { negative, token: last, body: text.slice(last.start, last.end) }
}

// float 값을 float로 다시 읽어도 같은 가장 짧은 10진 글자로
function shortestFloat(value: number): string {
  for (let digits = 1; digits <= 9; digits++) {
    const text = String(Number(value.toPrecision(digits)))
    if (Math.fround(Number(text)) === value) return text
  }
  return String(value)
}

// 리터럴 → 입력칸에 보일 글자(형식 접미사 L·f 없이, 문자열은 풀어서). 정수는 10진 값으로 보인다(16진·8진·2진도).
// 리터럴의 형식이 필드 형식과 다르면 Java처럼 넓힌 값을 보인다(Dashboard·로봇이 쓰는 값과 같게):
// - 정수 리터럴의 형식은 접미사로 정해진다(L이 없으면 int라 long 필드의 0xFFFFFFFF도 -1).
// - float 필드의 정수는 float로 반올림한 값(16777217 → 16777216), double 필드의 2^53을 넘는 long은 double로 반올림한 값.
// - double 필드의 float 리터럴(0.1f)은 float 값을 넓힌 값(0.10000000149011612).
// 리터럴이 아니면(식 등) 정규화한 글자 그대로다.
export function displayTunableLiteral(type: TunableValueType, literal: string): string {
  const normalized = normalizeLiteral(literal)
  if (type === 'boolean') return normalized
  if (type === 'String') {
    if (!normalized.startsWith('"')) return normalized
    return decodeJavaQuoted(normalized) ?? normalized
  }
  const number = splitNumber(normalized)
  if (!number) return normalized
  const sign = number.negative ? '-' : ''
  if (number.token.kind === 'integer') {
    const value = integerValue(`${sign}${number.body}`, /[lL]$/.test(number.body) ? 64 : 32)
    if (value === null) return normalized
    if (type === 'float') return shortestFloat(Math.fround(Number(value)))
    if (type === 'double' && !Number.isSafeInteger(Number(value))) return String(Number(value))
    return value
  }
  // 부동소수: 접미사와 밑줄을 뺀다. 16진 부동소수(0x1.8p1)는 10진 값으로 보인다(입력칸은 10진만 받는다).
  const single = /[fF]$/.test(number.body)
  const body = number.body.replace(/[fFdD]$/, '').replace(/_/g, '')
  if (/^0[xX]/.test(body)) {
    const value = hexFloatValue(body, single)
    if (value === null) return normalized
    return `${sign}${type === 'float' ? shortestFloat(Math.fround(value)) : String(value)}`
  }
  if (type === 'double' && single) {
    const value = Math.fround(Number(body))
    return Number.isFinite(value) ? `${sign}${String(value)}` : normalized
  }
  return `${sign}${body}`
}

// 16진 부동소수(0x1.8p1, 접미사·밑줄 뺀 것)의 값. single이면 float로 반올림한다(f 접미사). 무한대면 null.
function hexFloatValue(body: string, single: boolean): number | null {
  const match = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([-+]?[0-9]+)$/.exec(body)
  if (!match || (match[1] + (match[2] ?? '')).length === 0) return null
  const fraction = match[2] ?? ''
  let mantissa = BigInt(`0x${match[1]}${fraction}`)
  if (mantissa === 0n) return 0
  let exponent = Number(match[3]) - 4 * fraction.length
  // 표시용이라 53비트를 넘는 가수는 반올림돼도 된다(64비트로 자른다). 2의 거듭제곱은 나눠 곱해 지수만 따로 넘치거나
  // 0이 되지 않게 한다(0xF0p-1078: 2^-1078만 구하면 0이지만 값은 7.4e-323이다).
  const extra = mantissa.toString(2).length - 64
  if (extra > 0) {
    mantissa >>= BigInt(extra)
    exponent += extra
  }
  let value = Number(mantissa)
  while (exponent > 960 && Number.isFinite(value)) {
    value *= 2 ** 960
    exponent -= 960
  }
  while (exponent < -960 && value !== 0) {
    value *= 2 ** -960
    exponent += 960
  }
  value *= 2 ** exponent
  const rounded = single ? Math.fround(value) : value
  return Number.isFinite(rounded) ? rounded : null
}

function isWordToken(token: JavaToken): boolean {
  return token.kind !== 'operator' && token.kind !== 'string' && token.kind !== 'char'
}

// 비교용 정규화('- 1'과 '-1'은 같다). 토큰 사이의 공백·주석을 지우고, 낱말끼리 붙는 곳(new Params)에만 한 칸을 둔다.
export function normalizeLiteral(text: string): string {
  const { tokens } = lexJava(text)
  if (tokens.length === 0) return text.trim()
  let out = ''
  let previous: JavaToken | null = null
  for (const token of tokens) {
    if (previous && isWordToken(previous) && isWordToken(token)) out += ' '
    out += text.slice(token.start, token.end)
    previous = token
  }
  return out
}
