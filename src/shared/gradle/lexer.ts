// Gradle 빌드 스크립트(Groovy DSL·Kotlin DSL) 토크나이저. 팀 Gradle 파일은 git에서 온 믿지 않는 입력이라, 어떤 입력에도
// 예외를 던지지 않고 끝까지 본다(닫히지 않은 문자열·주석은 problems에 남긴다). Gradle·Groovy를 실행하지 않고 글자로만
// 나눈다.
//
// - 주석(//, /* */, 맨 앞의 #!)과 공백은 토큰에 넣지 않는다. 줄바꿈은 문장 경계라 newline 토큰 하나로 남긴다(연속은 하나).
// - 문자열: Groovy '…'·'''…'''(보간 없음), "…"·"""…"""·/…/(슬래시 문자열)·$/…/$(보간), Kotlin "…"·"""…"""(보간, 세 겹은
//   이스케이프 없음)·'c'. 보간은 parts에 글자와 식으로 나눠 둔다. Groovy의 $a.b.c는 점으로 이은 속성 경로 전체, Kotlin의 $a는
//   이름 하나다. ${…} 안은 같은 규칙으로 다시 나눈 토큰 목록이다.
// - 위치(start·end)는 받은 글자 그대로의 UTF-16 오프셋, line은 1부터다(LF·CR·CRLF).

export type GradleDialect = 'groovy' | 'kotlin'

export type StringPart =
  | { kind: 'text'; text: string }
  // ${…}: 안의 토큰(끝에 eof 없음)
  | { kind: 'expr'; tokens: GradleToken[]; start: number; end: number; line: number }
  // $a.b.c(Groovy) / $a(Kotlin)
  | { kind: 'path'; names: string[]; start: number; end: number; line: number }

export type GradleTokenKind =
  'ident' | 'number' | 'string' | 'punct' | 'newline' | 'invalid' | 'eof'

export type GradleToken = {
  kind: GradleTokenKind
  // ident·number·punct·invalid의 글자(문자열은 '')
  text: string
  start: number
  end: number
  line: number
  // string만
  parts?: StringPart[]
}

export type LexProblem = { line: number; detail: string }

export type LexResult = {
  tokens: GradleToken[]
  problems: LexProblem[]
  // ${…} 중첩이 한도를 넘었다(읽지 않는다)
  tooDeep: boolean
}

// ${ "${ … }" } 중첩 한도
export const MAX_INTERPOLATION_DEPTH = 16

// 긴 것부터(최장 일치)
const GROOVY_PUNCTS = [
  '==~',
  '..<',
  '<=>',
  '?.',
  '*.',
  '.&',
  '..',
  '->',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+=',
  '-=',
  '*=',
  '/=',
  '=~',
  '?:',
  '<<',
  '++',
  '--',
  '**'
]
const KOTLIN_PUNCTS = [
  '?.',
  '..',
  '->',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+=',
  '-=',
  '*=',
  '/=',
  '?:',
  '!!',
  '::',
  '++',
  '--'
]
const SINGLE_PUNCTS = new Set('(){}[],.:;=+-*/%<>!?&|^~@'.split(''))

// 이 뒤의 '/'는 나눗셈이 아니라 Groovy 슬래시 문자열의 시작이다(식이 올 자리)
const SLASHY_AFTER = new Set([
  '(',
  ',',
  '=',
  '[',
  ':',
  '{',
  '!',
  '&&',
  '||',
  '=~',
  '==~',
  '+',
  '?',
  '->',
  '==',
  '!=',
  ';',
  '+=',
  '?:'
])

function isIdentStart(ch: string): boolean {
  return /[\p{L}\p{Nl}_$]/u.test(ch)
}

function isIdentPart(ch: string): boolean {
  return /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]/u.test(ch)
}

function isKotlinIdentStart(ch: string): boolean {
  return /[\p{L}\p{Nl}_]/u.test(ch)
}

function isKotlinIdentPart(ch: string): boolean {
  return /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}]/u.test(ch)
}

class TooDeep extends Error {}

class Lexer {
  pos: number
  line = 1
  readonly problems: LexProblem[] = []

  constructor(
    readonly text: string,
    readonly dialect: GradleDialect
  ) {
    this.pos = text.charCodeAt(0) === 0xfeff ? 1 : 0
  }

  private peek(offset = 0): string {
    return this.text[this.pos + offset] ?? ''
  }

  // 줄바꿈 하나(CRLF는 하나)를 넘기고 줄 수를 센다. 줄바꿈이 아니면 false.
  private newline(): boolean {
    const ch = this.peek()
    if (ch === '\r') {
      this.pos += this.peek(1) === '\n' ? 2 : 1
      this.line++
      return true
    }
    if (ch === '\n') {
      this.pos++
      this.line++
      return true
    }
    return false
  }

  // 위치 하나를 넘긴다(줄바꿈이면 줄을 센다)
  private advance(): void {
    if (!this.newline()) this.pos++
  }

  private problem(line: number, detail: string): void {
    this.problems.push({ line, detail })
  }

  // 토큰 목록. untilBrace면 짝이 맞는 '}'에서 멈춘다(${…} 안). 그때는 그 '}'를 먹는다.
  tokens(depth: number, untilBrace: boolean): GradleToken[] {
    if (depth > MAX_INTERPOLATION_DEPTH) throw new TooDeep()
    const out: GradleToken[] = []
    let braces = 0
    const push = (token: GradleToken): void => {
      if (token.kind === 'newline' && (out.length === 0 || out[out.length - 1].kind === 'newline'))
        return
      out.push(token)
    }
    if (depth === 0 && this.text.startsWith('#!', this.pos)) this.skipLine()
    while (this.pos < this.text.length) {
      const ch = this.peek()
      const start = this.pos
      const line = this.line
      if (ch === '\n' || ch === '\r') {
        this.newline()
        push({ kind: 'newline', text: '', start, end: this.pos, line })
        continue
      }
      if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v' || ch === ' ') {
        this.pos++
        continue
      }
      // 줄 이음(Groovy·Kotlin 모두 식 안의 역슬래시 줄바꿈은 드물지만 Groovy는 받는다)
      if (ch === '\\' && (this.peek(1) === '\n' || this.peek(1) === '\r')) {
        this.pos++
        this.newline()
        continue
      }
      if (ch === '/' && this.peek(1) === '/') {
        this.skipLine()
        continue
      }
      if (ch === '/' && this.peek(1) === '*') {
        this.skipBlockComment()
        continue
      }
      if (untilBrace && ch === '}' && braces === 0) {
        this.pos++
        return out
      }
      if (ch === '"' || ch === "'") {
        push(this.quoted(depth))
        continue
      }
      if (this.dialect === 'groovy' && ch === '/' && this.slashyAllowed(out)) {
        const token = this.slashy(depth, '/', '/')
        if (token) {
          push(token)
          continue
        }
      }
      if (this.dialect === 'groovy' && ch === '$' && this.peek(1) === '/') {
        const token = this.slashy(depth, '$/', '/$')
        if (token) {
          push(token)
          continue
        }
      }
      if (this.dialect === 'kotlin' && ch === '`') {
        const end = this.text.indexOf('`', this.pos + 1)
        const close = this.text.slice(this.pos + 1, end)
        if (end > this.pos + 1 && !/[\r\n]/.test(close)) {
          this.pos = end + 1
          push({ kind: 'ident', text: close, start, end: this.pos, line })
          continue
        }
      }
      if (/[0-9]/.test(ch)) {
        push(this.number())
        continue
      }
      const identStart = this.dialect === 'kotlin' ? isKotlinIdentStart : isIdentStart
      const identPart = this.dialect === 'kotlin' ? isKotlinIdentPart : isIdentPart
      const cp = String.fromCodePoint(this.text.codePointAt(this.pos) ?? 0)
      if (identStart(cp)) {
        this.pos += cp.length
        while (this.pos < this.text.length) {
          const next = String.fromCodePoint(this.text.codePointAt(this.pos) ?? 0)
          if (!identPart(next)) break
          this.pos += next.length
        }
        push({ kind: 'ident', text: this.text.slice(start, this.pos), start, end: this.pos, line })
        continue
      }
      const punct = this.punct()
      if (punct) {
        if (punct === '{') braces++
        else if (punct === '}') braces--
        push({ kind: 'punct', text: punct, start, end: this.pos, line })
        continue
      }
      this.pos += cp.length
      push({ kind: 'invalid', text: cp, start, end: this.pos, line })
    }
    if (untilBrace) this.problem(this.line, 'unterminated ${ expression')
    return out
  }

  private skipLine(): void {
    while (this.pos < this.text.length && this.peek() !== '\n' && this.peek() !== '\r') this.pos++
  }

  private skipBlockComment(): void {
    const line = this.line
    this.pos += 2
    while (this.pos < this.text.length) {
      if (this.peek() === '*' && this.peek(1) === '/') {
        this.pos += 2
        return
      }
      this.advance()
    }
    this.problem(line, 'unterminated comment')
  }

  private punct(): string | null {
    const list = this.dialect === 'kotlin' ? KOTLIN_PUNCTS : GROOVY_PUNCTS
    for (const candidate of list) {
      if (this.text.startsWith(candidate, this.pos)) {
        this.pos += candidate.length
        return candidate
      }
    }
    const ch = this.peek()
    if (SINGLE_PUNCTS.has(ch)) {
      this.pos++
      return ch
    }
    return null
  }

  private number(): GradleToken {
    const start = this.pos
    const line = this.line
    const rest = this.text.slice(this.pos)
    const match =
      /^0[xX][0-9a-fA-F_]+[A-Za-z]*/.exec(rest) ??
      /^[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9]+)?[A-Za-z]*/.exec(rest)
    this.pos += match ? match[0].length : 1
    return { kind: 'number', text: this.text.slice(start, this.pos), start, end: this.pos, line }
  }

  private slashyAllowed(out: GradleToken[]): boolean {
    const next = this.peek(1)
    if (next === '' || next === '/' || next === '*' || next === ' ' || next === '=') return false
    for (let i = out.length - 1; i >= 0; i--) {
      const token = out[i]
      if (token.kind === 'newline') return true
      if (token.kind === 'punct') return SLASHY_AFTER.has(token.text)
      if (token.kind === 'ident') return token.text === 'return'
      return false
    }
    return true
  }

  // /…/ 또는 $/…/$. 닫는 글자가 없으면 null(나눗셈·글자로 다시 읽는다).
  private slashy(depth: number, open: string, close: string): GradleToken | null {
    const end = this.text.indexOf(close, this.pos + open.length)
    if (end < 0) return null
    const start = this.pos
    const line = this.line
    this.pos += open.length
    const parts = this.body(depth, (at) => this.text.startsWith(close, at), true, 'slashy')
    if (!this.text.startsWith(close, this.pos)) {
      this.pos = start
      this.line = line
      return null
    }
    this.pos += close.length
    return { kind: 'string', text: '', start, end: this.pos, line, parts }
  }

  private quoted(depth: number): GradleToken {
    const start = this.pos
    const line = this.line
    const quote = this.peek()
    const triple = this.text.startsWith(quote.repeat(3), this.pos)
    const delimiter = triple ? quote.repeat(3) : quote
    this.pos += delimiter.length
    // Groovy의 작은따옴표는 보간하지 않는다. Kotlin의 '…'는 글자 하나(문자 리터럴)다.
    const interpolate = quote === '"'
    const mode = this.dialect === 'kotlin' && triple ? 'raw' : 'escaped'
    const parts = this.body(
      depth,
      (at) => this.text.startsWith(delimiter, at),
      interpolate,
      mode,
      !triple
    )
    if (this.text.startsWith(delimiter, this.pos)) this.pos += delimiter.length
    else {
      // 닫히지 않은 문자열은 값으로 쓰지 않는다(그 문장은 읽지 못한 문장이 된다)
      this.problem(line, 'unterminated string')
      return { kind: 'invalid', text: quote, start, end: this.pos, line }
    }
    return { kind: 'string', text: '', start, end: this.pos, line, parts }
  }

  // 문자열 본문을 닫는 글자 앞까지 읽는다. singleLine이면 줄바꿈에서 멈춘다(닫히지 않은 문자열).
  private body(
    depth: number,
    closes: (at: number) => boolean,
    interpolate: boolean,
    mode: 'escaped' | 'raw' | 'slashy',
    singleLine = false
  ): StringPart[] {
    const parts: StringPart[] = []
    let text = ''
    const flush = (): void => {
      if (text !== '') parts.push({ kind: 'text', text })
      text = ''
    }
    while (this.pos < this.text.length && !closes(this.pos)) {
      const ch = this.peek()
      if (singleLine && (ch === '\n' || ch === '\r')) break
      if (ch === '\\' && mode !== 'raw') {
        const next = this.peek(1)
        if (mode === 'slashy') {
          if (next === '/') {
            text += '/'
            this.pos += 2
          } else {
            text += ch
            this.pos++
          }
          continue
        }
        if (next === '\n' || next === '\r') {
          // 줄 이음: 역슬래시와 줄바꿈을 지운다
          this.pos++
          this.newline()
          continue
        }
        const escaped = this.escape()
        text += escaped
        continue
      }
      if (ch === '$' && interpolate) {
        const part = this.interpolation(depth)
        if (part) {
          flush()
          parts.push(part)
          continue
        }
      }
      if (ch === '\n' || ch === '\r') {
        text += '\n'
        this.newline()
        continue
      }
      text += ch
      this.pos++
    }
    flush()
    return parts
  }

  // 역슬래시 이스케이프 하나를 풀어 글자로(모르는 이스케이프는 그 글자)
  private escape(): string {
    const next = this.peek(1)
    const simple: Record<string, string> = {
      n: '\n',
      t: '\t',
      r: '\r',
      b: '\b',
      f: '\f',
      s: ' ',
      '\\': '\\',
      "'": "'",
      '"': '"',
      $: '$'
    }
    if (next === 'u') {
      const hex = this.text.slice(this.pos + 2, this.pos + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        this.pos += 6
        return String.fromCharCode(parseInt(hex, 16))
      }
    }
    if (this.dialect === 'groovy' && /[0-7]/.test(next)) {
      const match = /^[0-3]?[0-7]{1,2}/.exec(this.text.slice(this.pos + 1, this.pos + 4)) ?? ['0']
      this.pos += 1 + match[0].length
      return String.fromCharCode(parseInt(match[0], 8))
    }
    if (next in simple && !(this.dialect === 'kotlin' && next === 's')) {
      this.pos += 2
      return simple[next]
    }
    if (next === '') {
      this.pos++
      return '\\'
    }
    this.pos += 2
    return next
  }

  // $이름, ${…}. 보간이 아니면(뒤에 이름도 {도 없음) null이고 $는 글자다.
  private interpolation(depth: number): StringPart | null {
    const start = this.pos
    const line = this.line
    if (this.peek(1) === '{') {
      this.pos += 2
      const tokens = this.tokens(depth + 1, true)
      return { kind: 'expr', tokens, start, end: this.pos, line }
    }
    const kotlin = this.dialect === 'kotlin'
    const identStart = kotlin ? isKotlinIdentStart : (ch: string): boolean => /[\p{L}_]/u.test(ch)
    const identPart = kotlin
      ? isKotlinIdentPart
      : (ch: string): boolean => /[\p{L}\p{Nd}_]/u.test(ch)
    const names: string[] = []
    let at = this.pos + 1
    for (;;) {
      if (!identStart(this.text[at] ?? '')) break
      let end = at + 1
      while (end < this.text.length && identPart(this.text[end])) end++
      names.push(this.text.slice(at, end))
      at = end
      // Groovy는 $a.b.c처럼 점 뒤의 이름까지 하나의 속성 경로로 읽는다
      if (kotlin || this.text[at] !== '.' || !identStart(this.text[at + 1] ?? '')) break
      at++
    }
    if (names.length === 0) return null
    this.pos = at
    return { kind: 'path', names, start, end: at, line }
  }
}

export function lexGradle(text: string, dialect: GradleDialect): LexResult {
  const lexer = new Lexer(text, dialect)
  try {
    const tokens = lexer.tokens(0, false)
    tokens.push({ kind: 'eof', text: '', start: text.length, end: text.length, line: lexer.line })
    return { tokens, problems: lexer.problems, tooDeep: false }
  } catch (error) {
    if (!(error instanceof TooDeep)) throw error
    return { tokens: [], problems: lexer.problems, tooDeep: true }
  }
}
