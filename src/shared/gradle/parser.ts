// Gradle 빌드 스크립트의 작은 구문 트리. Groovy·Kotlin DSL의 선언적 부분(블록 호출, 명령식, 대입, def·val, 문자열 보간,
// 목록·맵, + ·?: 정도)만 식으로 읽고, 나머지(조건문, 메서드 정의, 연산 대부분)는 그 문장 전체를 건너뛴다(control·unknown).
// 읽지 못한 문장은 그 문장만 버리고 다음 문장부터 계속 읽는다(괄호 짝을 맞춰 건너뛴다). 중첩이 한도를 넘으면 그 파일을
// 읽지 않는다(tooDeep).
import {
  lexGradle,
  type GradleDialect,
  type GradleToken,
  type LexProblem,
  type StringPart
} from './lexer'

type Span = { start: number; end: number; line: number }

export type Arg = { name: string | null; value: Expr }

export type Expr =
  | (Span & { kind: 'string'; parts: Array<string | Expr> })
  | (Span & { kind: 'number'; text: string })
  | (Span & { kind: 'name'; name: string })
  | (Span & { kind: 'member'; target: Expr; name: string })
  | (Span & { kind: 'index'; target: Expr; index: Expr })
  | (Span & { kind: 'call'; callee: Expr; args: Arg[]; closure: ClosureExpr | null })
  | ClosureExpr
  | (Span & { kind: 'list'; items: Expr[] })
  | (Span & { kind: 'map'; entries: Array<{ key: string | null; value: Expr }> })
  | (Span & { kind: 'binary'; op: string; left: Expr; right: Expr })
  | (Span & { kind: 'unary'; op: string; operand: Expr })
  | (Span & { kind: 'cast'; expr: Expr; type: string })
  // 값으로 읽지 않는 식(삼항, new, 메서드 참조 등)
  | (Span & { kind: 'other' })

export type ClosureExpr = Span & { kind: 'closure'; body: Stmt[] }

export type Stmt =
  | (Span & { kind: 'expr'; expr: Expr })
  | (Span & { kind: 'assign'; target: Expr; op: string; value: Expr })
  // def x = …, String x = …, val x = …, val x by extra(…)(by가 있으면 value 대신 by)
  | (Span & { kind: 'decl'; name: string; value: Expr | null; by: Expr | null })
  // if·for·while·try·switch 등과 읽지 못한 문장. idents는 그 안의 이름(선언이 숨어 있는지 볼 때 쓴다).
  | (Span & { kind: 'control' | 'unknown'; keyword: string; idents: string[] })
  // import·package·메서드·클래스 정의·return 등(조용히 넘긴다)
  | (Span & { kind: 'skip' })

export type ParsedScript = {
  statements: Stmt[]
  problems: LexProblem[]
  tooDeep: boolean
}

// 블록·괄호 중첩 한도
export const MAX_NESTING = 64

const GROOVY_MODIFIERS = new Set([
  'def',
  'final',
  'static',
  'private',
  'public',
  'protected',
  'var'
])
const KOTLIN_DECL = new Set(['val', 'var'])
const KOTLIN_MODIFIERS = new Set([
  'private',
  'public',
  'internal',
  'protected',
  'const',
  'lateinit',
  'override'
])
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'try', 'do', 'synchronized', 'when'])
const SKIP_TO_END = new Set([
  'import',
  'package',
  'return',
  'throw',
  'assert',
  'break',
  'continue'
])
const TYPE_DEFS = new Set(['class', 'interface', 'enum', 'trait', 'object'])
// 명령식 인자가 될 수 없는 이름(이항 연산자 낱말)
const OPERATOR_WORDS = new Set(['as', 'in', 'instanceof', 'is', 'to', 'by', 'else'])

// 이항 연산자 우선순위(클수록 먼저). 값으로 읽는 것은 +와 ?:뿐이고, 나머지는 구조만 맞춘다.
const BINARY_PRECEDENCE: Record<string, number> = {
  '?:': 1,
  '||': 2,
  '&&': 3,
  '|': 4,
  '^': 5,
  '&': 6,
  '==': 7,
  '!=': 7,
  '<=>': 7,
  '=~': 7,
  '==~': 7,
  '<': 8,
  '>': 8,
  '<=': 8,
  '>=': 8,
  in: 8,
  instanceof: 8,
  is: 8,
  '..': 9,
  '..<': 9,
  '<<': 10,
  '+': 11,
  '-': 11,
  '*': 12,
  '/': 12,
  '%': 12,
  '**': 13
}

class Bail extends Error {}
class TooDeep extends Error {}

class Parser {
  pos = 0
  depth = 0

  constructor(
    readonly tokens: GradleToken[],
    readonly dialect: GradleDialect
  ) {}

  private peek(offset = 0): GradleToken {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]
  }

  private next(): GradleToken {
    const token = this.peek()
    if (this.pos < this.tokens.length - 1) this.pos++
    return token
  }

  private is(text: string, offset = 0): boolean {
    const token = this.peek(offset)
    return (token.kind === 'punct' || token.kind === 'ident') && token.text === text
  }

  private isPunct(text: string, offset = 0): boolean {
    const token = this.peek(offset)
    return token.kind === 'punct' && token.text === text
  }

  private expect(text: string): GradleToken {
    if (!this.isPunct(text)) throw new Bail()
    return this.next()
  }

  private skipNewlines(): void {
    while (this.peek().kind === 'newline' || this.isPunct(';')) this.next()
  }

  private skipNewlinesOnly(): void {
    while (this.peek().kind === 'newline') this.next()
  }

  private enter(): void {
    if (++this.depth > MAX_NESTING) throw new TooDeep()
  }

  private leave(): void {
    this.depth--
  }

  private atStatementEnd(): boolean {
    const token = this.peek()
    return (
      token.kind === 'newline' ||
      token.kind === 'eof' ||
      (token.kind === 'punct' && (token.text === ';' || token.text === '}'))
    )
  }

  private span(start: GradleToken): Span {
    const last = this.tokens[Math.max(0, this.pos - 1)]
    return { start: start.start, end: Math.max(start.end, last.end), line: start.line }
  }

  // 블록 끝(closing이면 '}', 아니면 eof)까지의 문장들
  block(closing: boolean): Stmt[] {
    const statements: Stmt[] = []
    for (;;) {
      this.skipNewlines()
      const token = this.peek()
      if (token.kind === 'eof') {
        if (closing) throw new Bail()
        return statements
      }
      if (closing && token.kind === 'punct' && token.text === '}') return statements
      if (!closing && token.kind === 'punct' && token.text === '}') {
        // 짝 없는 닫는 괄호: 그 글자만 버린다
        const start = this.next()
        statements.push({ kind: 'unknown', keyword: '}', idents: [], ...this.span(start) })
        continue
      }
      statements.push(this.statement())
    }
  }

  private statement(): Stmt {
    const startPos = this.pos
    const start = this.peek()
    const depth = this.depth
    try {
      const stmt = this.statementInner()
      if (!this.atStatementEnd()) throw new Bail()
      return stmt
    } catch (error) {
      if (!(error instanceof Bail)) throw error
      this.depth = depth
      this.pos = startPos
      const idents = this.skipStatement()
      return { kind: 'unknown', keyword: start.text, idents, ...this.span(start) }
    }
  }

  private statementInner(): Stmt {
    const start = this.peek()
    if (start.kind === 'ident') {
      if (SKIP_TO_END.has(start.text)) {
        this.skipStatement(false)
        return { kind: 'skip', ...this.span(start) }
      }
      if (CONTROL.has(start.text)) return this.control()
      if (TYPE_DEFS.has(start.text) && this.peek(1).kind === 'ident') {
        this.skipStatement(false)
        return { kind: 'skip', ...this.span(start) }
      }
    }
    if (this.isPunct('@') && this.peek(1).kind === 'ident') {
      // 주석(annotation)을 넘기고 그 뒤 문장을 읽는다
      this.next()
      this.qualifiedName()
      if (this.isPunct('(')) this.skipBalanced()
      this.skipNewlinesOnly()
      return this.statementInner()
    }
    const decl = this.dialect === 'kotlin' ? this.kotlinDecl() : this.groovyDecl()
    if (decl) return decl
    const expr = this.expression(true)
    const op = this.peek()
    if (op.kind === 'punct' && ['=', '+=', '-=', '*=', '/='].includes(op.text)) {
      if (!['name', 'member', 'index'].includes(expr.kind)) throw new Bail()
      this.next()
      this.skipNewlinesOnly()
      const value = this.expression(true)
      return { kind: 'assign', target: expr, op: op.text, value, ...this.span(start) }
    }
    return { kind: 'expr', expr, ...this.span(start) }
  }

  // def x = …, final String x = …, String x = …(수식어 없는 형식 선언은 = 가 있을 때만), def foo(…) { }(메서드: 건너뜀)
  private groovyDecl(): Stmt | null {
    const start = this.peek()
    const save = this.pos
    let modifiers = 0
    while (this.peek().kind === 'ident' && GROOVY_MODIFIERS.has(this.peek().text)) {
      this.next()
      modifiers++
    }
    // def (a, b) = …
    if (modifiers > 0 && this.isPunct('(')) {
      this.skipStatement(false)
      return { kind: 'skip', ...this.span(start) }
    }
    const names: string[] = []
    const typeStart = this.pos
    if (this.peek().kind === 'ident') {
      names.push(this.next().text)
      // 형식: a.b.C<…>[]
      while (this.isPunct('.') && this.peek(1).kind === 'ident') {
        this.next()
        this.next()
      }
      if (this.isPunct('<')) {
        if (!this.skipAngles()) {
          this.pos = save
          return null
        }
      }
      while (this.isPunct('[') && this.isPunct(']', 1)) {
        this.next()
        this.next()
      }
      if (this.peek().kind === 'ident' && !OPERATOR_WORDS.has(this.peek().text)) {
        names.push(this.next().text)
      } else if (modifiers === 0) {
        this.pos = save
        return null
      } else {
        // def x(형식 없음): 처음 이름이 변수다
        this.pos = typeStart + 1
      }
    } else if (modifiers === 0) {
      this.pos = save
      return null
    }
    const name = names[names.length - 1]
    if (name === undefined) {
      this.pos = save
      return null
    }
    // 메서드 정의: def foo(…) { } / String foo(…) { }(수식어가 없으면 괄호 뒤에 본문이 있어야 한다.
    // implementation project(':x')는 명령식이다)
    if (this.isPunct('(') && (modifiers > 0 || names.length === 2)) {
      const paren = this.pos
      this.skipBalanced()
      const body = this.isPunct('{')
      this.pos = paren
      if (modifiers > 0 || body) {
        this.skipStatement(false)
        return { kind: 'skip', ...this.span(start) }
      }
      this.pos = save
      return null
    }
    if (this.isPunct('=')) {
      this.next()
      this.skipNewlinesOnly()
      const value = this.expression(true)
      return { kind: 'decl', name, value, by: null, ...this.span(start) }
    }
    if (modifiers > 0 && this.atStatementEnd()) {
      return { kind: 'decl', name, value: null, by: null, ...this.span(start) }
    }
    this.pos = save
    return null
  }

  // val x = …, val x: T = …, val x by extra(…), val x: String by project, fun …(건너뜀)
  private kotlinDecl(): Stmt | null {
    const start = this.peek()
    const save = this.pos
    while (this.peek().kind === 'ident' && KOTLIN_MODIFIERS.has(this.peek().text)) this.next()
    const keyword = this.peek()
    if (keyword.kind === 'ident' && keyword.text === 'fun') {
      this.skipStatement(false)
      return { kind: 'skip', ...this.span(start) }
    }
    if (keyword.kind !== 'ident' || !KOTLIN_DECL.has(keyword.text)) {
      this.pos = save
      return null
    }
    this.next()
    const nameToken = this.next()
    if (nameToken.kind !== 'ident') throw new Bail()
    if (this.isPunct(':')) {
      this.next()
      // 형식: a.b.C<…>?
      this.qualifiedName()
      if (this.isPunct('<') && !this.skipAngles()) throw new Bail()
      if (this.isPunct('?')) this.next()
    }
    if (this.isPunct('=')) {
      this.next()
      this.skipNewlinesOnly()
      const value = this.expression(false)
      return { kind: 'decl', name: nameToken.text, value, by: null, ...this.span(start) }
    }
    if (this.is('by')) {
      this.next()
      const by = this.expression(false)
      return { kind: 'decl', name: nameToken.text, value: null, by, ...this.span(start) }
    }
    if (this.atStatementEnd())
      return { kind: 'decl', name: nameToken.text, value: null, by: null, ...this.span(start) }
    throw new Bail()
  }

  private qualifiedName(): void {
    if (this.peek().kind !== 'ident') throw new Bail()
    this.next()
    while (this.isPunct('.') && this.peek(1).kind === 'ident') {
      this.next()
      this.next()
    }
  }

  // '<'에서 짝 맞는 '>'까지. 형식 인자가 아니면 false(위치는 그대로).
  private skipAngles(): boolean {
    const save = this.pos
    let depth = 0
    while (this.peek().kind !== 'eof') {
      const token = this.next()
      if (token.kind === 'newline') break
      if (token.kind === 'punct') {
        if (token.text === '<') depth++
        else if (token.text === '>') depth--
        else if (!['.', ',', '?', '[', ']', '*'].includes(token.text)) break
        if (depth === 0) return true
      } else if (token.kind !== 'ident') break
    }
    this.pos = save
    return false
  }

  // if (…) { … } else …, for (…) { … }, try { … } catch (…) { … } finally { … } 등을 통째로 넘긴다
  private control(): Stmt {
    const start = this.next()
    const from = this.pos
    const keyword = start.text
    const body = (): void => {
      this.skipNewlinesOnly()
      if (this.isPunct('{')) this.skipBalanced()
      else this.skipStatement(false)
    }
    if (keyword === 'do') {
      body()
      this.skipNewlinesOnly()
      if (this.is('while')) {
        this.next()
        if (this.isPunct('(')) this.skipBalanced()
      }
    } else if (keyword === 'try') {
      body()
      for (;;) {
        const save = this.pos
        this.skipNewlinesOnly()
        if (this.is('catch')) {
          this.next()
          if (this.isPunct('(')) this.skipBalanced()
          body()
        } else if (this.is('finally')) {
          this.next()
          body()
        } else {
          this.pos = save
          break
        }
      }
    } else {
      if (this.isPunct('(')) this.skipBalanced()
      body()
      if (keyword === 'if') {
        for (;;) {
          const save = this.pos
          this.skipNewlinesOnly()
          if (!this.is('else')) {
            this.pos = save
            break
          }
          this.next()
          if (this.is('if')) {
            this.next()
            if (this.isPunct('(')) this.skipBalanced()
          }
          body()
        }
      }
    }
    return {
      kind: 'control',
      keyword,
      idents: this.identsBetween(from, this.pos),
      ...this.span(start)
    }
  }

  private identsBetween(from: number, to: number): string[] {
    const names = new Set<string>()
    for (let i = from; i < to; i++) {
      const token = this.tokens[i]
      if (token.kind === 'ident') names.add(token.text)
      if (token.kind === 'string') for (const name of stringIdents(token.parts ?? [])) names.add(name)
    }
    return [...names]
  }

  // 지금 위치의 괄호에서 짝 맞는 닫는 괄호까지 넘긴다
  private skipBalanced(): void {
    const stack: string[] = []
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
    do {
      const token = this.next()
      if (token.kind === 'eof') return
      if (token.kind !== 'punct') continue
      if (token.text in pairs) stack.push(pairs[token.text])
      else if (token.text === stack[stack.length - 1]) stack.pop()
    } while (stack.length > 0)
  }

  // 문장 끝(괄호 밖의 줄바꿈·';', 또는 감싸는 블록의 '}' 앞)까지 넘기고 그 안의 이름들을 돌려준다.
  // consumeEnd면 끝의 줄바꿈·';'도 먹는다.
  private skipStatement(consumeEnd = true): string[] {
    const from = this.pos
    const stack: string[] = []
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
    for (;;) {
      const token = this.peek()
      if (token.kind === 'eof') break
      if (stack.length === 0) {
        if (token.kind === 'newline' || (token.kind === 'punct' && token.text === ';')) {
          // 다음 줄이 '.'으로 이어지면 같은 문장이다
          if (token.kind === 'newline' && this.continuesOnNextLine()) {
            this.next()
            continue
          }
          if (consumeEnd) this.next()
          break
        }
        if (token.kind === 'punct' && token.text === '}') break
      }
      this.next()
      if (token.kind !== 'punct') continue
      if (token.text in pairs) stack.push(pairs[token.text])
      else if (token.text === stack[stack.length - 1]) stack.pop()
    }
    return this.identsBetween(from, this.pos)
  }

  private continuesOnNextLine(): boolean {
    let offset = 0
    while (this.peek(offset).kind === 'newline') offset++
    return this.isPunct('.', offset) || this.isPunct('?.', offset)
  }

  // ---- 식 ----

  expression(command: boolean): Expr {
    this.enter()
    try {
      return this.binary(0, command)
    } finally {
      this.leave()
    }
  }

  private binaryOp(): string | null {
    const token = this.peek()
    if (token.kind === 'punct' && token.text in BINARY_PRECEDENCE) return token.text
    if (token.kind === 'ident' && ['in', 'instanceof', 'is'].includes(token.text)) return token.text
    return null
  }

  private binary(min: number, command: boolean): Expr {
    let left = this.unary(command)
    for (;;) {
      // as 형식(캐스트)
      if (this.is('as') && this.peek().kind === 'ident') {
        const start = this.next()
        const type = this.peek()
        if (type.kind !== 'ident') throw new Bail()
        this.qualifiedName()
        if (this.isPunct('<') && !this.skipAngles()) throw new Bail()
        if (this.isPunct('?')) this.next()
        left = {
          kind: 'cast',
          expr: left,
          type: type.text,
          start: left.start,
          end: this.span(start).end,
          line: left.line
        }
        continue
      }
      // 삼항 a ? b : c(값으로 읽지 않는다)
      if (min === 0 && this.isPunct('?')) {
        this.next()
        this.skipNewlinesOnly()
        this.expression(false)
        this.skipNewlinesOnly()
        this.expect(':')
        this.skipNewlinesOnly()
        const right = this.expression(false)
        left = { kind: 'other', start: left.start, end: right.end, line: left.line }
        continue
      }
      const op = this.binaryOp()
      if (op === null) return left
      const precedence = BINARY_PRECEDENCE[op]
      if (precedence <= min) return left
      this.next()
      this.skipNewlinesOnly()
      const right = this.binary(precedence, false)
      left = { kind: 'binary', op, left, right, start: left.start, end: right.end, line: left.line }
    }
  }

  private unary(command: boolean): Expr {
    const token = this.peek()
    if (token.kind === 'punct' && ['!', '-', '+', '~', '++', '--', '*'].includes(token.text)) {
      this.next()
      const operand = this.unary(false)
      return { kind: 'unary', op: token.text, operand, ...this.span(token) }
    }
    return this.postfix(this.primary(), command)
  }

  // 명령식 인자의 시작이 될 수 있는 토큰(같은 줄)
  private startsCommandArg(): boolean {
    const token = this.peek()
    if (token.kind === 'string' || token.kind === 'number') return true
    if (token.kind === 'ident') return !OPERATOR_WORDS.has(token.text)
    return false
  }

  private postfix(expr: Expr, command: boolean): Expr {
    for (;;) {
      const token = this.peek()
      if (token.kind === 'punct') {
        if (['.', '?.', '*.', '.&', '::'].includes(token.text)) {
          this.next()
          this.skipNewlinesOnly()
          const name = this.next()
          if (name.kind !== 'ident' && name.kind !== 'string') throw new Bail()
          if (token.text === '.&' || token.text === '::' || token.text === '*.') {
            expr = { kind: 'other', start: expr.start, end: name.end, line: expr.line }
            continue
          }
          const memberName = name.kind === 'ident' ? name.text : stringLiteralText(name)
          if (memberName === null) throw new Bail()
          expr = { kind: 'member', target: expr, name: memberName, ...this.spanFrom(expr) }
          continue
        }
        if (token.text === '(') {
          const args = this.parenArgs()
          let closure: ClosureExpr | null = null
          if (this.isPunct('{')) closure = this.closure()
          expr = { kind: 'call', callee: expr, args, closure, ...this.spanFrom(expr) }
          continue
        }
        if (token.text === '[') {
          this.next()
          this.skipNewlinesOnly()
          const index = this.expression(false)
          this.skipNewlinesOnly()
          this.expect(']')
          expr = { kind: 'index', target: expr, index, ...this.spanFrom(expr) }
          continue
        }
        if (token.text === '{' && (expr.kind === 'name' || expr.kind === 'member')) {
          const closure = this.closure()
          expr = { kind: 'call', callee: expr, args: [], closure, ...this.spanFrom(expr) }
          continue
        }
        if (token.text === '!!') {
          this.next()
          continue
        }
        if (token.text === '++' || token.text === '--') {
          this.next()
          expr = { kind: 'other', ...this.spanFrom(expr) }
          continue
        }
      }
      if (token.kind === 'newline' && this.continuesOnNextLine()) {
        this.skipNewlinesOnly()
        continue
      }
      // Groovy 명령식: name arg, arg { closure } [name arg …]
      if (
        command &&
        this.dialect === 'groovy' &&
        (expr.kind === 'name' || expr.kind === 'member') &&
        this.startsCommandArg()
      ) {
        expr = this.commandCall(expr)
        continue
      }
      return expr
    }
  }

  private spanFrom(expr: Expr): Span {
    const last = this.tokens[Math.max(0, this.pos - 1)]
    return { start: expr.start, end: Math.max(expr.end, last.end), line: expr.line }
  }

  // 명령식 하나: callee 뒤의 쉼표로 나눈 인자들(이름 붙은 인자 key: value 포함)과 같은 줄의 클로저.
  // 그 뒤에 이름과 인자가 또 오면(a b c d = a(b).c(d)) 이어 붙인다.
  private commandCall(callee: Expr): Expr {
    const args: Arg[] = []
    for (;;) {
      args.push(this.argument(':'))
      if (!this.isPunct(',')) break
      this.next()
      this.skipNewlinesOnly()
    }
    let closure: ClosureExpr | null = null
    if (this.isPunct('{')) closure = this.closure()
    let expr: Expr = { kind: 'call', callee, args, closure, ...this.spanFrom(callee) }
    while (this.peek().kind === 'ident' && !OPERATOR_WORDS.has(this.peek().text)) {
      const nameToken = this.next()
      const member: Expr = { kind: 'member', target: expr, name: nameToken.text, ...this.spanFrom(expr) }
      if (this.startsCommandArg()) {
        const chained: Arg[] = []
        for (;;) {
          chained.push(this.argument(':'))
          if (!this.isPunct(',')) break
          this.next()
          this.skipNewlinesOnly()
        }
        expr = { kind: 'call', callee: member, args: chained, closure: null, ...this.spanFrom(expr) }
      } else if (this.isPunct('(')) {
        const parenArgs = this.parenArgs()
        expr = { kind: 'call', callee: member, args: parenArgs, closure: null, ...this.spanFrom(expr) }
      } else {
        expr = member
      }
    }
    return expr
  }

  // 인자 하나. separator가 ':'(Groovy)면 key: value, '='(Kotlin)면 key = value를 이름 붙은 인자로 읽는다.
  private argument(separator: ':' | '='): Arg {
    const token = this.peek()
    const after = this.peek(1)
    if (
      (token.kind === 'ident' || (token.kind === 'string' && separator === ':')) &&
      after.kind === 'punct' &&
      after.text === separator
    ) {
      const name = token.kind === 'ident' ? token.text : stringLiteralText(token)
      if (name !== null) {
        this.next()
        this.next()
        this.skipNewlinesOnly()
        return { name, value: this.expression(false) }
      }
    }
    return { name: null, value: this.expression(false) }
  }

  private parenArgs(): Arg[] {
    this.enter()
    try {
      this.expect('(')
      const args: Arg[] = []
      this.skipNewlinesOnly()
      if (this.isPunct(')')) {
        this.next()
        return args
      }
      for (;;) {
        this.skipNewlinesOnly()
        args.push(this.argument(this.dialect === 'kotlin' ? '=' : ':'))
        this.skipNewlinesOnly()
        if (this.isPunct(',')) {
          this.next()
          this.skipNewlinesOnly()
          if (this.isPunct(')')) break
          continue
        }
        break
      }
      this.skipNewlinesOnly()
      this.expect(')')
      return args
    } finally {
      this.leave()
    }
  }

  private closure(): ClosureExpr {
    this.enter()
    try {
      const start = this.expect('{')
      // 매개변수: { a, b -> … } / { a: T -> … }
      const save = this.pos
      this.skipNewlinesOnly()
      let sawArrow = false
      for (let offset = 0; offset < 32; offset++) {
        const token = this.peek(offset)
        if (token.kind === 'punct' && token.text === '->') {
          sawArrow = true
          this.pos += offset + 1
          break
        }
        if (token.kind !== 'ident' && !(token.kind === 'punct' && [',', ':', '.', '<', '>', '?'].includes(token.text)))
          break
      }
      if (!sawArrow) this.pos = save
      const body = this.block(true)
      this.expect('}')
      return { kind: 'closure', body, ...this.span(start) }
    } finally {
      this.leave()
    }
  }

  private primary(): Expr {
    const token = this.peek()
    switch (token.kind) {
      case 'string': {
        this.next()
        return { kind: 'string', parts: this.stringParts(token), ...this.span(token) }
      }
      case 'number':
        this.next()
        return { kind: 'number', text: token.text, ...this.span(token) }
      case 'ident': {
        if (token.text === 'new') {
          this.next()
          this.qualifiedName()
          if (this.isPunct('<') && !this.skipAngles()) throw new Bail()
          if (this.isPunct('(')) this.parenArgs()
          if (this.isPunct('{')) this.closure()
          return { kind: 'other', ...this.span(token) }
        }
        if (CONTROL.has(token.text) || TYPE_DEFS.has(token.text) || token.text === 'fun')
          throw new Bail()
        this.next()
        return { kind: 'name', name: token.text, ...this.span(token) }
      }
      case 'punct': {
        if (token.text === '(') {
          this.enter()
          try {
            this.next()
            this.skipNewlinesOnly()
            const inner = this.expression(false)
            this.skipNewlinesOnly()
            this.expect(')')
            return { ...inner, ...this.span(token) }
          } finally {
            this.leave()
          }
        }
        if (token.text === '[') return this.listOrMap()
        if (token.text === '{') return this.closure()
        throw new Bail()
      }
      default:
        throw new Bail()
    }
  }

  private listOrMap(): Expr {
    this.enter()
    try {
      const start = this.expect('[')
      this.skipNewlinesOnly()
      // [:] 빈 맵
      if (this.isPunct(':') && this.isPunct(']', 1)) {
        this.next()
        this.next()
        return { kind: 'map', entries: [], ...this.span(start) }
      }
      const items: Expr[] = []
      const entries: Array<{ key: string | null; value: Expr }> = []
      let isMap: boolean | null = null
      while (!this.isPunct(']')) {
        this.skipNewlinesOnly()
        const key = this.peek()
        const keyed =
          (key.kind === 'ident' || key.kind === 'string' || key.kind === 'number') &&
          this.isPunct(':', 1)
        if (isMap === null) isMap = keyed
        if (keyed !== isMap) throw new Bail()
        if (keyed) {
          this.next()
          this.next()
          this.skipNewlinesOnly()
          const name =
            key.kind === 'string' ? stringLiteralText(key) : key.kind === 'ident' ? key.text : key.text
          entries.push({ key: name, value: this.expression(false) })
        } else {
          items.push(this.expression(false))
        }
        this.skipNewlinesOnly()
        if (this.isPunct(',')) {
          this.next()
          this.skipNewlinesOnly()
          continue
        }
        break
      }
      this.skipNewlinesOnly()
      this.expect(']')
      return isMap
        ? { kind: 'map', entries, ...this.span(start) }
        : { kind: 'list', items, ...this.span(start) }
    } finally {
      this.leave()
    }
  }

  private stringParts(token: GradleToken): Array<string | Expr> {
    const parts: Array<string | Expr> = []
    for (const part of token.parts ?? []) {
      if (part.kind === 'text') parts.push(part.text)
      else if (part.kind === 'path') parts.push(pathExpr(part))
      else parts.push(this.interpolated(part))
    }
    return parts
  }

  // ${…} 안의 토큰을 식 하나로(비었거나 읽지 못하면 other)
  private interpolated(part: Extract<StringPart, { kind: 'expr' }>): Expr {
    const eof: GradleToken = { kind: 'eof', text: '', start: part.end, end: part.end, line: part.line }
    const inner = new Parser([...part.tokens.filter((t) => t.kind !== 'newline'), eof], this.dialect)
    inner.depth = this.depth
    try {
      if (inner.peek().kind === 'eof') throw new Bail()
      const expr = inner.expression(false)
      if (inner.peek().kind !== 'eof') throw new Bail()
      return expr
    } catch (error) {
      if (!(error instanceof Bail)) throw error
      return { kind: 'other', start: part.start, end: part.end, line: part.line }
    }
  }
}

function pathExpr(part: Extract<StringPart, { kind: 'path' }>): Expr {
  const span = { start: part.start, end: part.end, line: part.line }
  let expr: Expr = { kind: 'name', name: part.names[0], ...span }
  for (const name of part.names.slice(1)) expr = { kind: 'member', target: expr, name, ...span }
  return expr
}

// 보간 없는 문자열 토큰의 글자(보간이 있으면 null)
export function stringLiteralText(token: GradleToken): string | null {
  let text = ''
  for (const part of token.parts ?? []) {
    if (part.kind !== 'text') return null
    text += part.text
  }
  return text
}

function stringIdents(parts: StringPart[]): string[] {
  const names: string[] = []
  for (const part of parts) {
    if (part.kind === 'path') names.push(...part.names)
    else if (part.kind === 'expr')
      for (const token of part.tokens) {
        if (token.kind === 'ident') names.push(token.text)
        if (token.kind === 'string') names.push(...stringIdents(token.parts ?? []))
      }
  }
  return names
}

export function parseGradleScript(text: string, dialect: GradleDialect): ParsedScript {
  const lexed = lexGradle(text, dialect)
  if (lexed.tooDeep) return { statements: [], problems: lexed.problems, tooDeep: true }
  const parser = new Parser(lexed.tokens, dialect)
  try {
    return { statements: parser.block(false), problems: lexed.problems, tooDeep: false }
  } catch (error) {
    if (error instanceof TooDeep) return { statements: [], problems: lexed.problems, tooDeep: true }
    throw error
  }
}
