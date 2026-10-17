// 튜닝 값 리터럴의 형식·검사. 렌더러(입력 → 리터럴)와 메인(쓰기 전 검사)이 같은 규칙을 쓴다.
//
// javac 21로 확인한 규칙(review-tunables.md "Literal formatting per type"):
// - float 필드에 1.5(double)는 "possible lossy conversion", long에 3000000000은 "integer number too large"다.
// - 박싱 형식은 형식이 정확히 맞는 리터럴만 받는다(Double에 1, Long에 5, Float에 2·2.5는 오류).
//   그래서 long은 늘 L을, double은 늘 '.0'이나 지수를, float는 늘 f를 붙인다(기본형·박싱 모두 맞는다).
// - \u 이스케이프는 토큰을 나누기 전에 바뀐다("a\u000ab"는 "unclosed string literal"). 쓰는 문자열에는 \u를 넣지 않고,
//   제어 문자는 8진 이스케이프로, ASCII 밖의 글자는 그대로 쓴다(파일은 UTF-8이다).
// - 입력은 JS 숫자를 거치지 않는다(범위 확인만 BigInt·Number로 한다).
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

// 쓸 수 있는 리터럴의 정규 모양
const BOOLEAN = /^(?:true|false)$/
const INTEGER = /^-?(?:0|[1-9][0-9]*)L?$/
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?f?$/
// 따옴표 안: 따옴표·역슬래시·제어 문자(Cc: C0·DEL·C1, 줄바꿈 포함)가 아닌 글자, 또는 \b \t \n \f \r \" \' \\ 와
// 8진 이스케이프. \u와 \s(Java 15)는 받지 않는다.
const STRING = /^"(?:[^"\\\p{Cc}]|\\[btnfr"'\\]|\\[0-3][0-7]{0,2}|\\[4-7][0-7]?)*"$/u

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

// 메인이 받는 새 리터럴: true|false, -?정수·소수[지수][L|f], \u·줄바꿈 없는 문자열
export function isWritableLiteral(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_LITERAL_LENGTH)
    return false
  if (text[0] === '"') return isWritableString(text)
  if (text.length > MAX_NUMBER_LENGTH) return false
  return BOOLEAN.test(text) || INTEGER.test(text) || DECIMAL.test(text)
}

// 부동소수 리터럴(접미사 없이)이 그 형식에서 0이 아닌데 0으로 반올림되거나(underflow) 무한대가 되면(overflow)
// javac가 받지 않는다("floating-point number too small/large").
function floatingInRange(body: string, single: boolean): boolean {
  const value = single ? Math.fround(Number(body)) : Number(body)
  if (!Number.isFinite(value)) return false
  const mantissa = body.replace(/^-/, '').split(/[eE]/)[0]
  return value !== 0 || !/[1-9]/.test(mantissa)
}

// 새 리터럴(isWritableLiteral)이 그 형식의 필드 초기값으로 컴파일되는지. 박싱 형식에도 맞도록 formatTunableLiteral이
// 내는 모양만 받는다(long은 L, double은 '.'이나 지수, float는 f). 메인이 쓰기 전에 필드 형식과 맞춰 본다.
export function literalFitsType(type: TunableValueType, text: string): boolean {
  if (!isWritableLiteral(text)) return false
  switch (type) {
    case 'boolean':
      return BOOLEAN.test(text)
    case 'String':
      return text[0] === '"'
    case 'int': {
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(text)) return false
      const value = BigInt(text)
      return value >= INT_MIN && value <= INT_MAX
    }
    case 'long': {
      if (!/^-?(?:0|[1-9][0-9]*)L$/.test(text)) return false
      const value = BigInt(text.slice(0, -1))
      return value >= LONG_MIN && value <= LONG_MAX
    }
    case 'double':
      return (
        DECIMAL.test(text) &&
        !text.endsWith('f') &&
        /[.eE]/.test(text) &&
        floatingInRange(text, false)
      )
    case 'float':
      return DECIMAL.test(text) && text.endsWith('f') && floatingInRange(text.slice(0, -1), true)
  }
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
  if (!floatingInRange(body, single)) return null
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

// 리터럴 → 입력칸에 보일 글자(형식 접미사 L·f 없이, 문자열은 풀어서). 정수는 10진 값으로 보인다(16진·8진·2진도).
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
    const bits = type === 'int' ? 32 : 64
    return integerValue(`${sign}${number.body}`, bits) ?? normalized
  }
  // 부동소수: 접미사와 밑줄을 뺀다. 16진 부동소수(0x1.8p1)는 10진 값으로 보인다(입력칸은 10진만 받는다).
  const body = number.body.replace(/[fFdD]$/, '').replace(/_/g, '')
  if (/^0[xX]/.test(body)) {
    const decimal = hexFloatDecimal(body, type === 'float')
    return decimal === null ? normalized : `${sign}${decimal}`
  }
  return `${sign}${body}`
}

// 16진 부동소수(0x1.8p1, 접미사·밑줄 뺀 것)의 값을 그 형식으로 다시 읽어도 같은 가장 짧은 10진 글자로
function hexFloatDecimal(body: string, single: boolean): string | null {
  const match = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([-+]?[0-9]+)$/.exec(body)
  if (!match || (match[1] + (match[2] ?? '')).length === 0) return null
  const fraction = match[2] ?? ''
  // 표시용이라 53비트를 넘는 가수는 반올림돼도 된다
  const mantissa = Number(BigInt(`0x${match[1]}${fraction}`))
  const value = mantissa * 2 ** (Number(match[3]) - 4 * fraction.length)
  const rounded = single ? Math.fround(value) : value
  if (!Number.isFinite(rounded)) return null
  if (!single) return String(rounded)
  for (let digits = 1; digits <= 9; digits++) {
    const text = String(Number(rounded.toPrecision(digits)))
    if (Math.fround(Number(text)) === rounded) return text
  }
  return String(rounded)
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
