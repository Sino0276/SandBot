// 손으로 쓴 Java 8 렉서. 튜닝 값 파서(tunables.ts)와 리터럴 검사(javaLiteral.ts)가 같이 쓰고, 메인 프로세스와
// 렌더러가 같은 코드를 쓴다. 어떤 입력에도 예외를 던지지 않고, 끝나지 않은 문자열·주석은 표시만 하고 파일 끝까지 본다.
//
// - 위치(start·end)는 받은 글자 그대로의 UTF-16 오프셋이다. 맨 앞의 BOM(U+FEFF)도 한 글자로 센다(메인이
//   Buffer.toString('utf8')로 읽으면 BOM이 남는다).
// - 공백과 주석은 토큰에 넣지 않는다(주석은 comments에 따로 둔다).
// - '>'는 늘 한 글자씩 토큰으로 낸다('>='는 하나). 그래서 제네릭의 '>>'·'>>>'가 닫는 괄호 둘·셋이 된다.
//   시프트 연산자가 필요하면 붙어 있는(end === 다음 start) '>' 토큰을 다시 묶으면 된다.
// - 텍스트 블록(""")은 Java 8에는 없지만 받아 둔다(textBlock 토큰).
// - javac는 \uXXXX 이스케이프를 토큰을 나누기 전에 먼저 글자로 바꾼다(JLS 3.3). 이 렉서는 바꾸지 않고 원래 글자로
//   나누므로, 리터럴 밖의 이스케이프(주석 안의 \u000a 등)나 리터럴의 구조를 바꾸는 이스케이프(문자열 안의 " 등)가
//   있으면 토큰 경계를 믿을 수 없다. 그런 이스케이프가 있으면 unsafeUnicodeEscape로 알린다(파서가 파일 전체를 읽기
//   전용으로 둔다).

export type JavaTokenKind =
  | 'identifier'
  | 'keyword'
  | 'integer'
  | 'floating'
  | 'boolean'
  | 'null'
  | 'char'
  | 'string'
  | 'textBlock'
  | 'operator'
  // 알 수 없는 글자, 숫자 뒤에 붙은 글자(123abc) 등
  | 'invalid'

export type JavaToken = {
  kind: JavaTokenKind
  start: number
  end: number
  // 문자열·문자·텍스트 블록이 닫히지 않았다
  unterminated?: true
  // 리터럴 안에 \u 이스케이프가 있다
  unicodeEscape?: true
}

export type JavaComment = { start: number; end: number; block: boolean; unterminated?: true }

// \u 이스케이프 하나. char는 풀어 쓴 글자(16진 네 자리가 아니면 null, javac는 오류로 본다).
export type UnicodeEscape = { start: number; end: number; char: string | null; inLiteral: boolean }

export type JavaLexResult = {
  tokens: JavaToken[]
  comments: JavaComment[]
  // 줄마다 시작 오프셋(0번은 0). 줄 끝은 LF, CR, CRLF다.
  lineStarts: number[]
  unicodeEscapes: UnicodeEscape[]
  // 리터럴 밖의 이스케이프, 또는 리터럴 안에서 따옴표·역슬래시·줄바꿈이 되는(구조를 바꾸는) 이스케이프가 있다
  unsafeUnicodeEscape: boolean
}

// Java 8 키워드(true·false·null은 리터럴이라 따로). var·record 등 문맥 키워드는 식별자로 둔다.
const KEYWORDS = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'try',
  'void',
  'volatile',
  'while',
  '_'
])

// 길이가 긴 것부터 맞춘다. '>'로 시작하는 연산자는 따로 다룬다.
const OPERATORS = [
  '<<=',
  '...',
  '::',
  '->',
  '==',
  '<=',
  '!=',
  '&&',
  '||',
  '++',
  '--',
  '<<',
  '+=',
  '-=',
  '*=',
  '/=',
  '&=',
  '|=',
  '^=',
  '%='
]
const SINGLE_OPERATORS = '(){}[];,.@=<!~?:+-*/&|^%'

// Character.isJavaIdentifierStart/Part(JLS 3.8)와 같은 범주. ASCII는 아래에서 먼저 보므로 이 식은 U+0080부터만 쓴다
// (그 범위의 무시 가능한 제어 문자는 C1, 곧 \p{Cc}다).
const IDENT_START = /[\p{L}\p{Nl}\p{Sc}\p{Pc}]/u
const IDENT_PART = /[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mn}\p{Mc}\p{Cf}\p{Cc}]/u

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57
}

function isHexDigit(code: number): boolean {
  return isAsciiDigit(code) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70)
}

function isIdentStart(cp: number): boolean {
  if (cp < 128) {
    return (cp >= 97 && cp <= 122) || (cp >= 65 && cp <= 90) || cp === 95 || cp === 36
  }
  return IDENT_START.test(String.fromCodePoint(cp))
}

function isIdentPart(cp: number): boolean {
  if (cp < 128) {
    return (
      (cp >= 97 && cp <= 122) ||
      (cp >= 65 && cp <= 90) ||
      isAsciiDigit(cp) ||
      cp === 95 ||
      cp === 36 ||
      (cp >= 0 && cp <= 8) ||
      (cp >= 0x0e && cp <= 0x1b) ||
      cp === 0x7f
    )
  }
  return IDENT_PART.test(String.fromCodePoint(cp))
}

function isLineBreak(code: number): boolean {
  return code === 10 || code === 13
}

// 줄 시작 오프셋 표
export function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 13) {
      if (text.charCodeAt(i + 1) === 10) i++
      starts.push(i + 1)
    } else if (code === 10) {
      starts.push(i + 1)
    }
  }
  return starts
}

// 오프셋이 있는 줄(1부터)
export function lineAt(lineStarts: readonly number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (lineStarts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}

// 역슬래시 앞에 붙은 역슬래시가 짝수 개일 때만 이스케이프가 시작된다(JLS 3.3). 'u'는 여러 개 올 수 있다.
function findUnicodeEscapes(text: string): Omit<UnicodeEscape, 'inLiteral'>[] {
  const escapes: Omit<UnicodeEscape, 'inLiteral'>[] = []
  let backslashes = 0
  let i = text.indexOf('\\')
  if (i < 0) return escapes
  for (; i < text.length; i++) {
    if (text.charCodeAt(i) !== 92) {
      backslashes = 0
      continue
    }
    if (backslashes % 2 === 0 && text.charCodeAt(i + 1) === 117) {
      let j = i + 1
      while (text.charCodeAt(j) === 117) j++
      const hex = text.slice(j, j + 4)
      const valid = /^[0-9a-fA-F]{4}$/.test(hex)
      const end = valid ? j + 4 : j
      escapes.push({ start: i, end, char: valid ? String.fromCharCode(parseInt(hex, 16)) : null })
      backslashes = 0
      i = end - 1
      continue
    }
    backslashes++
  }
  return escapes
}

// 리터럴 안에서도 따옴표·역슬래시·줄바꿈이 되는 이스케이프는 리터럴의 끝을 바꾼다
const STRUCTURAL_IN_LITERAL = new Set(['"', "'", '\\', '\n', '\r'])

export function lexJava(text: string): JavaLexResult {
  const tokens: JavaToken[] = []
  const comments: JavaComment[] = []
  const n = text.length
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  const push = (kind: JavaTokenKind, start: number, end: number): JavaToken => {
    const token: JavaToken = { kind, start, end }
    tokens.push(token)
    return token
  }

  // 따옴표 리터럴(문자열·문자). 줄바꿈이나 파일 끝에서 닫히지 않은 것으로 끝낸다.
  const lexQuoted = (start: number, quote: number, kind: 'string' | 'char'): number => {
    let j = start + 1
    while (j < n) {
      const code = text.charCodeAt(j)
      if (code === quote) {
        push(kind, start, j + 1)
        return j + 1
      }
      if (isLineBreak(code)) break
      if (code === 92) {
        if (j + 1 < n && isLineBreak(text.charCodeAt(j + 1))) {
          j++
          break
        }
        j += 2
        continue
      }
      j++
    }
    const end = Math.min(j, n)
    push(kind, start, end).unterminated = true
    return end
  }

  const lexTextBlock = (start: number): number => {
    let j = start + 3
    while (j < n) {
      const code = text.charCodeAt(j)
      if (code === 92) {
        j += 2
        continue
      }
      if (code === 34 && text.startsWith('"""', j)) {
        push('textBlock', start, j + 3)
        return j + 3
      }
      j++
    }
    push('textBlock', start, n).unterminated = true
    return n
  }

  const skipDigits = (j: number, hex: boolean): number => {
    while (j < n) {
      const code = text.charCodeAt(j)
      if (code === 95 || (hex ? isHexDigit(code) : isAsciiDigit(code))) j++
      else break
    }
    return j
  }

  // 정수·부동소수 리터럴(JLS 3.10.1·3.10.2). 밑줄과 접미사를 받고, 올바른지는 javaLiteral.ts가 따로 본다.
  const lexNumber = (start: number): number => {
    let j = start
    let floating = false
    const c0 = text.charCodeAt(j)
    const c1 = text.charCodeAt(j + 1)
    if (c0 === 48 && (c1 === 120 || c1 === 88)) {
      // 16진(부동소수는 p 지수가 있어야 한다)
      j = skipDigits(j + 2, true)
      if (text.charCodeAt(j) === 46) {
        floating = true
        j = skipDigits(j + 1, true)
      }
      const p = text.charCodeAt(j)
      if (p === 112 || p === 80) {
        floating = true
        j++
        const sign = text.charCodeAt(j)
        if (sign === 43 || sign === 45) j++
        j = skipDigits(j, false)
      }
      const suffix = text[j]
      if (floating && suffix !== undefined && 'fFdD'.includes(suffix)) j++
      else if (!floating && (suffix === 'l' || suffix === 'L')) j++
    } else if (c0 === 48 && (c1 === 98 || c1 === 66)) {
      j = skipDigits(j + 2, false)
      const suffix = text[j]
      if (suffix === 'l' || suffix === 'L') j++
    } else {
      j = skipDigits(j, false)
      if (text.charCodeAt(j) === 46 && text.charCodeAt(j + 1) !== 46) {
        floating = true
        j = skipDigits(j + 1, false)
      }
      const e = text.charCodeAt(j)
      if (e === 101 || e === 69) {
        const next = text.charCodeAt(j + 1)
        const afterSign = text.charCodeAt(j + 2)
        if (isAsciiDigit(next) || ((next === 43 || next === 45) && isAsciiDigit(afterSign))) {
          floating = true
          j = skipDigits(j + (isAsciiDigit(next) ? 1 : 2), false)
        }
      }
      const suffix = text[j]
      if (suffix !== undefined && 'fFdD'.includes(suffix)) {
        floating = true
        j++
      } else if (!floating && (suffix === 'l' || suffix === 'L')) {
        j++
      }
    }
    // 숫자에 바로 붙은 식별자 글자(123abc)는 javac 오류다. 한 토큰으로 묶어 invalid로 둔다.
    let invalid = false
    while (j < n) {
      const cp = text.codePointAt(j) ?? 0
      if (!isIdentPart(cp)) break
      invalid = true
      j += cp > 0xffff ? 2 : 1
    }
    push(invalid ? 'invalid' : floating ? 'floating' : 'integer', start, j)
    return j
  }

  while (i < n) {
    const code = text.charCodeAt(i)
    // 공백: 스페이스, 탭, FF, 줄바꿈. 파일 끝의 Ctrl+Z(SUB)도 javac처럼 넘긴다.
    if (code === 32 || code === 9 || code === 12 || code === 10 || code === 13 || code === 0x1a) {
      i++
      continue
    }
    if (code === 47) {
      const next = text.charCodeAt(i + 1)
      if (next === 47) {
        let j = i + 2
        while (j < n && !isLineBreak(text.charCodeAt(j))) j++
        comments.push({ start: i, end: j, block: false })
        i = j
        continue
      }
      if (next === 42) {
        const close = text.indexOf('*/', i + 2)
        if (close < 0) {
          comments.push({ start: i, end: n, block: true, unterminated: true })
          i = n
        } else {
          comments.push({ start: i, end: close + 2, block: true })
          i = close + 2
        }
        continue
      }
    }
    if (code === 34) {
      i = text.startsWith('"""', i) ? lexTextBlock(i) : lexQuoted(i, 34, 'string')
      continue
    }
    if (code === 39) {
      i = lexQuoted(i, 39, 'char')
      continue
    }
    if (isAsciiDigit(code) || (code === 46 && isAsciiDigit(text.charCodeAt(i + 1)))) {
      i = lexNumber(i)
      continue
    }
    const cp = text.codePointAt(i) ?? code
    if (isIdentStart(cp)) {
      let j = i + (cp > 0xffff ? 2 : 1)
      while (j < n) {
        const part = text.codePointAt(j) ?? 0
        if (!isIdentPart(part)) break
        j += part > 0xffff ? 2 : 1
      }
      const word = text.slice(i, j)
      const kind: JavaTokenKind =
        word === 'true' || word === 'false'
          ? 'boolean'
          : word === 'null'
            ? 'null'
            : KEYWORDS.has(word)
              ? 'keyword'
              : 'identifier'
      push(kind, i, j)
      i = j
      continue
    }
    if (code === 62) {
      // '>'는 한 글자씩(제네릭을 닫는 '>>'·'>>>'가 따로 나오게). 뒤에 '='가 붙으면 '>='.
      const end = text.charCodeAt(i + 1) === 61 ? i + 2 : i + 1
      push('operator', i, end)
      i = end
      continue
    }
    const operator = OPERATORS.find((op) => text.startsWith(op, i))
    if (operator) {
      push('operator', i, i + operator.length)
      i += operator.length
      continue
    }
    if (SINGLE_OPERATORS.includes(text[i])) {
      push('operator', i, i + 1)
      i++
      continue
    }
    const size = cp > 0xffff ? 2 : 1
    push('invalid', i, i + size)
    i += size
  }

  // 이스케이프가 리터럴 안인지 본다(둘 다 오프셋 순서)
  const found = findUnicodeEscapes(text)
  const unicodeEscapes: UnicodeEscape[] = []
  let unsafeUnicodeEscape = false
  let t = 0
  for (const escape of found) {
    while (t < tokens.length && tokens[t].end <= escape.start) t++
    const token = tokens[t]
    const inLiteral =
      token !== undefined &&
      token.start <= escape.start &&
      escape.end <= token.end &&
      (token.kind === 'string' || token.kind === 'char' || token.kind === 'textBlock')
    if (inLiteral) token.unicodeEscape = true
    if (!inLiteral || escape.char === null || STRUCTURAL_IN_LITERAL.has(escape.char))
      unsafeUnicodeEscape = true
    unicodeEscapes.push({ ...escape, inLiteral })
  }

  return { tokens, comments, lineStarts: lineStartsOf(text), unicodeEscapes, unsafeUnicodeEscape }
}

export function tokenText(text: string, token: Pick<JavaToken, 'start' | 'end'>): string {
  return text.slice(token.start, token.end)
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  s: ' ',
  '"': '"',
  "'": "'",
  '\\': '\\'
}

// 문자열·문자 리터럴의 글자를 푼다(Java 이스케이프와 \u 이스케이프). 따옴표가 없거나 이스케이프가 틀리면 null.
export function decodeJavaQuoted(literal: string): string | null {
  const quote = literal[0]
  if ((quote !== '"' && quote !== "'") || literal.length < 2 || literal.at(-1) !== quote)
    return null
  const body = literal.slice(1, -1)
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = body[i + 1]
    if (next === undefined) return null
    const simple = SIMPLE_ESCAPES[next]
    if (simple !== undefined) {
      out += simple
      i++
      continue
    }
    if (next === 'u') {
      let j = i + 1
      while (body[j] === 'u') j++
      const hex = body.slice(j, j + 4)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null
      out += String.fromCharCode(parseInt(hex, 16))
      i = j + 3
      continue
    }
    const octal = /^(?:[0-3][0-7]{0,2}|[4-7][0-7]?)/.exec(body.slice(i + 1))
    if (!octal) return null
    out += String.fromCharCode(parseInt(octal[0], 8))
    i += octal[0].length
  }
  return out
}
