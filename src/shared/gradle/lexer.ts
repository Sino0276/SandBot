// Gradle 빌드 스크립트(Groovy DSL·Kotlin DSL) 토크나이저. 팀 Gradle 파일은 git에서 온 믿지 않는 입력이라, 어떤 입력에도
// 예외를 던지지 않고 끝까지 본다(닫히지 않은 문자열·주석은 problems에 남긴다). Gradle·Groovy를 실행하지 않고 글자로만
// 나눈다.
//
// - 주석(//, /* */, 맨 앞의 #!)과 공백은 토큰에 넣지 않는다. 줄바꿈은 문장 경계라 newline 토큰 하나로 남긴다(연속은 하나).
//   Kotlin의 블록 주석은 중첩된다(/* /* */ */). Groovy는 처음 */에서 끝난다.
// - 문자열: Groovy '…'·'''…'''(보간 없음), "…"·"""…"""·/…/(슬래시 문자열)·$/…/$(보간), Kotlin "…"·"""…"""(보간, 세 겹은
//   이스케이프 없음)·'c'. 보간은 parts에 글자와 식으로 나눠 둔다. Groovy의 $a.b.c는 점으로 이은 속성 경로 전체, Kotlin의 $a는
//   이름 하나다. ${…} 안은 같은 규칙으로 다시 나눈 토큰 목록이다.
// - 위치(start·end)는 받은 글자 그대로의 UTF-16 오프셋, line은 1부터다(LF·CR·CRLF).
// - 슬래시 문자열 시도가 실패하면(닫는 글자를 보간이 삼킴) 그 자리를 기억해 다시 시도하지 않고, 닫는 글자 찾기도 앞의
//   결과를 다시 쓴다(실패한 시도를 겹겹이 되풀이하면 지수 시간, 닫는 글자를 매번 끝까지 찾으면 제곱 시간이 된다). 그래도
//   지나간 글자 수(steps)가 한도(글자당 MAX_STEPS_PER_CHAR, 또는 부른 쪽이 준 한도)를 넘으면 tooDeep으로 멈춘다.

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
  // ${…} 중첩이나 도는 횟수가 한도를 넘었다(읽지 않는다)
  tooDeep: boolean
  // 지나간 글자 수(다시 읽은 것도 센다. 한도를 넘었으면 한도보다 크다)
  steps: number
}

// ${ "${ … }" } 중첩 한도
export const MAX_INTERPOLATION_DEPTH = 16
// 한 파일의 글자 하나당 일 한도(글자 나누기의 지나간 글자 수, parser.ts의 구문 나누기가 넘긴 토큰 수를 함께 센다).
// 올바른 Groovy·Kotlin은 글자당 한두 번이다. 실패한 슬래시 문자열 시도(올바른 Groovy에는 없다)가 겹치면 겹친 단계마다
// 남은 글자를 두 번쯤 더 읽는다.
export const MAX_STEPS_PER_CHAR = 16

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

// 첫 글자마다 그 글자로 시작하는 여러 글자 기호(긴 것부터). 기호마다 목록 전체를 맞춰 보지 않는다(기호만 이어 쓴 입력에서
// 토큰 하나의 일이 다른 토큰의 몇 배가 된다).
function byFirstChar(list: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const punct of list) map.set(punct[0], [...(map.get(punct[0]) ?? []), punct])
  return map
}
const GROOVY_PUNCTS_BY_FIRST = byFirstChar(GROOVY_PUNCTS)
const KOTLIN_PUNCTS_BY_FIRST = byFirstChar(KOTLIN_PUNCTS)

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

// 아래 이름 글자 판정은 ASCII를 유니코드 정규식 없이 먼저 본다(ASCII에서 \p{L}은 영문자, \p{Nd}는 숫자, \p{Pc}는 '_'이고
// \p{Nl}·\p{Mn}·\p{Mc}는 없다)
function isAsciiLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isIdentStart(ch: string): boolean {
  if (ch < '\x80') return isAsciiLetter(ch) || ch === '_' || ch === '$'
  return /[\p{L}\p{Nl}_$]/u.test(ch)
}

function isIdentPart(ch: string): boolean {
  if (ch < '\x80') return isAsciiLetter(ch) || isDigit(ch) || ch === '_' || ch === '$'
  return /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]/u.test(ch)
}

function isKotlinIdentStart(ch: string): boolean {
  if (ch < '\x80') return isAsciiLetter(ch) || ch === '_'
  return /[\p{L}\p{Nl}_]/u.test(ch)
}

function isKotlinIdentPart(ch: string): boolean {
  if (ch < '\x80') return isAsciiLetter(ch) || isDigit(ch) || ch === '_'
  return /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}]/u.test(ch)
}

class TooDeep extends Error {}

class Lexer {
  pos: number
  line = 1
  readonly problems: LexProblem[] = []
  // 실패한 슬래시 문자열 시도의 시작 위치(같은 자리에서 다시 시도해도 같은 결과다)
  private readonly failedSlashy = new Set<number>()
  // 닫는 글자(close)마다 마지막 찾기: from에서 찾은 첫 자리 at(-1은 없음). from 이후 at 전에는 그 글자가 없다.
  private readonly closeSearch = new Map<string, { from: number; at: number }>()
  private steps = 0
  private readonly maxSteps: number

  constructor(
    readonly text: string,
    readonly dialect: GradleDialect,
    maxSteps: number
  ) {
    this.pos = text.charCodeAt(0) === 0xfeff ? 1 : 0
    this.maxSteps = Math.min(MAX_STEPS_PER_CHAR * (text.length + 1), maxSteps)
  }

  // 지나간 글자(토큰 하나, 문자열·주석·이름 글자 하나)를 센다. 한도를 넘으면 그 파일을 읽지 않는다.
  private step(count = 1): void {
    this.steps += count
    if (this.steps > this.maxSteps) throw new TooDeep()
  }

  get stepCount(): number {
    return this.steps
  }

  private peek(offset = 0): string {
    return this.text[this.pos + offset] ?? ''
  }

  // 지금 위치의 글자 하나(서로게이트 쌍은 함께). 글자 안이어야 한다.
  private codePoint(): string {
    const ch = this.text[this.pos]
    return ch < '\x80' ? ch : String.fromCodePoint(this.text.codePointAt(this.pos) ?? 0)
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
      this.step()
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
        this.step((end < 0 ? this.text.length : end) - this.pos)
        const close = end > this.pos + 1 ? this.text.slice(this.pos + 1, end) : ''
        if (close !== '' && !/[\r\n]/.test(close)) {
          this.pos = end + 1
          push({ kind: 'ident', text: close, start, end: this.pos, line })
          continue
        }
      }
      if (isDigit(ch)) {
        push(this.number())
        continue
      }
      const identStart = this.dialect === 'kotlin' ? isKotlinIdentStart : isIdentStart
      const identPart = this.dialect === 'kotlin' ? isKotlinIdentPart : isIdentPart
      const cp = this.codePoint()
      if (identStart(cp)) {
        this.pos += cp.length
        while (this.pos < this.text.length) {
          const next = this.codePoint()
          if (!identPart(next)) break
          this.step()
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
    while (this.pos < this.text.length && this.peek() !== '\n' && this.peek() !== '\r') {
      this.step()
      this.pos++
    }
  }

  private skipBlockComment(): void {
    const line = this.line
    this.pos += 2
    let depth = 1
    while (this.pos < this.text.length) {
      this.step()
      if (this.peek() === '*' && this.peek(1) === '/') {
        this.pos += 2
        if (--depth === 0) return
        continue
      }
      if (this.dialect === 'kotlin' && this.peek() === '/' && this.peek(1) === '*') {
        this.pos += 2
        depth++
        continue
      }
      this.advance()
    }
    this.problem(line, 'unterminated comment')
  }

  private punct(): string | null {
    const ch = this.peek()
    const list = (this.dialect === 'kotlin' ? KOTLIN_PUNCTS_BY_FIRST : GROOVY_PUNCTS_BY_FIRST).get(
      ch
    )
    for (const candidate of list ?? []) {
      if (this.text.startsWith(candidate, this.pos)) {
        this.pos += candidate.length
        return candidate
      }
    }
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
    this.step(this.pos - start)
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

  // /…/ 또는 $/…/$. 닫는 글자가 없거나 본문이 닫히지 않으면(보간이 닫는 글자를 삼킴) null(나눗셈·글자로 다시 읽는다).
  // 실패한 자리는 기억해 다시 시도하지 않고, 그 시도에서 생긴 problems는 버린다(다시 읽은 쪽의 것만 남긴다).
  private slashy(depth: number, open: string, close: string): GradleToken | null {
    const start = this.pos
    if (this.failedSlashy.has(start)) return null
    if (this.indexOfClose(close, start + open.length) < 0) return null
    const line = this.line
    const problems = this.problems.length
    this.pos += open.length
    const parts = this.body(depth, (at) => this.text.startsWith(close, at), true, 'slashy')
    if (!this.text.startsWith(close, this.pos)) {
      this.failedSlashy.add(start)
      this.problems.length = problems
      this.pos = start
      this.line = line
      return null
    }
    this.pos += close.length
    return { kind: 'string', text: '', start, end: this.pos, line, parts }
  }

  // from 이후 close가 처음 나오는 자리(없으면 -1). 앞으로 나아가며 찾으면 앞의 결과를 다시 쓴다
  // ('$/ $/ …'처럼 닫는 글자 없는 시작이 많아도 끝까지 다시 훑지 않는다).
  private indexOfClose(close: string, from: number): number {
    const last = this.closeSearch.get(close)
    if (last && from >= last.from && (last.at < 0 || from <= last.at)) return last.at
    const at = this.text.indexOf(close, from)
    this.closeSearch.set(close, { from, at })
    return at
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
      this.step()
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
    this.step(at - start)
    this.pos = at
    return { kind: 'path', names, start, end: at, line }
  }
}

// maxSteps: 부른 쪽의 남은 일(한 번 읽기 전체의 한도, src/shared/gradle/reader.ts)
export function lexGradle(text: string, dialect: GradleDialect, maxSteps = Infinity): LexResult {
  const lexer = new Lexer(text, dialect, maxSteps)
  try {
    const tokens = lexer.tokens(0, false)
    tokens.push({ kind: 'eof', text: '', start: text.length, end: text.length, line: lexer.line })
    return { tokens, problems: lexer.problems, tooDeep: false, steps: lexer.stepCount }
  } catch (error) {
    if (!(error instanceof TooDeep)) throw error
    return { tokens: [], problems: lexer.problems, tooDeep: true, steps: lexer.stepCount }
  }
}
