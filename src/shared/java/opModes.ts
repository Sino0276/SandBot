// Java 소스 → Driver Station이 보이는 OpMode 목록(@TeleOp·@Autonomous 클래스). 컴파일하지 않고 글자로 정한다.
// 메인 프로세스(src/main/opModes.ts)가 TeamCode를 훑을 때와 실행할 때(Autonomous의 preselectTeleOp) 쓴다.
//
// 고르는 규칙은 FTC SDK 12의 AnnotatedOpModeClassFilter와 같다:
// - filterClass: @TeleOp·@Autonomous·@Utility 중 둘 이상이면 버린다(설정 오류). @Utility만 있으면 목록 밖(SandBot은
//   TeleOp·Autonomous만 실행한다). @Disabled가 있으면 버린다.
// - checkOpModeClassConstraints: public이 아니거나 static이 아닌 중첩 클래스(inner class)면 버린다. OpMode를
//   상속했는지는 글자로 알 수 없어 보지 않는다(아니면 사이드카가 load 오류로 알린다).
// - getOpModeName: 애너테이션 name이 비었거나 공백뿐이면 클래스 단순 이름. group이 비면 기본 그룹('').
// - checkUserOpModeName: 그 이름이 '$'로 시작하고 끝나면(시스템 OpMode 이름) 버린다.
// SandBot에서 정한 것: abstract 클래스는 만들 수 없으므로 뺀다. name·group·preselectTeleOp는 글자 리터럴(+로 이은 것
// 포함)일 때만 읽고, 상수 이름 같은 식이면 기본값(name은 단순 이름, 나머지는 '')을 쓴다. 메서드 안의 지역 클래스·익명
// 클래스는 public일 수 없으므로 보지 않는다.
//
// 애너테이션 이름은 javac처럼 푼다: 전체 이름(com.qualcomm.robotcore.eventloop.opmode.TeleOp), 또는 단순 이름을 단일
// import·패키지 import(.*)로 들여왔거나 같은 패키지일 때. 이 파일의 형식이 같은 단순 이름으로 가리면 그 형식이다.
//
// \u 이스케이프: javac는 토큰을 나누기 전에 \uXXXX를 글자로 바꾼다(JLS 3.3). 리터럴 밖이나 리터럴의 구조를 바꾸는
// 이스케이프가 있으면(lexer의 unsafeUnicodeEscape) 먼저 바꾼 글자로 다시 나눠 javac가 보는 토큰으로 읽는다(주석 안의
// \u000a 뒤에 있는 애너테이션도 javac처럼 본다). 줄 번호는 원래 글자의 줄이다. 읽기만 하므로 튜닝 값(tunables.ts)처럼
// 파일 전체를 거부할 필요가 없다.
import type { OpModeFlavor, OpModeInfo } from '../play'
import { decodeJavaQuoted, lexJava, lineAt, type JavaToken, type UnicodeEscape } from './lexer'

export type ParsedOpMode = Omit<OpModeInfo, 'path'>

const OPMODE_PACKAGE = 'com.qualcomm.robotcore.eventloop.opmode'
const TELEOP = `${OPMODE_PACKAGE}.TeleOp`
const AUTONOMOUS = `${OPMODE_PACKAGE}.Autonomous`
const UTILITY = `${OPMODE_PACKAGE}.Utility`
const DISABLED = `${OPMODE_PACKAGE}.Disabled`

const MODIFIER_KEYWORDS = new Set([
  'public',
  'protected',
  'private',
  'static',
  'final',
  'abstract',
  'native',
  'synchronized',
  'transient',
  'volatile',
  'strictfp',
  'default'
])

type TypeKind = 'class' | 'interface' | 'enum' | 'annotation' | 'record'

type Annotation = {
  name: string
  // '@' 토큰 위치
  at: number
  // 괄호 안 토큰 범위 [start, end), 괄호가 없으면 null
  args: { start: number; end: number } | null
}

type Modifiers = { keywords: Set<string>; annotations: Annotation[] }

type TypeDecl = {
  kind: TypeKind
  name: string
  modifiers: Modifiers
  parent: TypeDecl | null
  nested: TypeDecl[]
}

type Imports = { single: Map<string, string>; onDemand: Set<string> }

// ---- \u 이스케이프 바꾸기 ----

type Translated = { text: string; toRaw: (offset: number) => number }

// 유효한 이스케이프를 글자로 바꾼 글자와, 바꾼 글자의 위치 → 원래 위치. 16진 네 자리가 아닌 것(javac 오류)은 그대로 둔다.
function translateEscapes(text: string, escapes: readonly UnicodeEscape[]): Translated {
  // [바꾼 글자의 시작, 원래 시작] 구간들(위치 순서)
  const marks: [number, number][] = [[0, 0]]
  let out = ''
  let raw = 0
  for (const escape of escapes) {
    if (escape.char === null) continue
    out += text.slice(raw, escape.start)
    marks.push([out.length, escape.start])
    out += escape.char
    marks.push([out.length, escape.end])
    raw = escape.end
  }
  out += text.slice(raw)
  const toRaw = (offset: number): number => {
    let low = 0
    let high = marks.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (marks[mid][0] <= offset) low = mid
      else high = mid - 1
    }
    return marks[low][1] + (offset - marks[low][0])
  }
  return { text: out, toRaw }
}

// ---- 파서(tunables.ts와 같은 방식, 형식 선언과 애너테이션만 본다) ----

class Parser {
  readonly types: TypeDecl[] = []
  readonly imports: Imports = { single: new Map(), onDemand: new Set() }
  packageName = ''
  private readonly texts: string[]

  constructor(
    text: string,
    readonly tokens: JavaToken[]
  ) {
    this.texts = tokens.map((token) => text.slice(token.start, token.end))
  }

  get length(): number {
    return this.tokens.length
  }

  tx(i: number): string {
    return this.texts[i] ?? ''
  }

  kind(i: number): JavaToken['kind'] | undefined {
    return this.tokens[i]?.kind
  }

  isIdent(i: number): boolean {
    return this.kind(i) === 'identifier'
  }

  isOp(i: number, op: string): boolean {
    return this.kind(i) === 'operator' && this.tx(i) === op
  }

  isKeyword(i: number, word: string): boolean {
    return this.kind(i) === 'keyword' && this.tx(i) === word
  }

  // 여는 괄호(i)와 짝인 닫는 괄호 다음 위치. 짝이 없으면 끝.
  skipBalanced(i: number): number {
    const open = this.tx(i)
    const close = open === '(' ? ')' : open === '[' ? ']' : '}'
    let depth = 0
    for (let j = i; j < this.length; j++) {
      if (this.kind(j) !== 'operator') continue
      const t = this.tx(j)
      if (t === open) depth++
      else if (t === close) {
        depth--
        if (depth === 0) return j + 1
      }
    }
    return this.length
  }

  // ';'까지(괄호는 건너뛴다). ';' 다음 위치.
  skipStatement(i: number): number {
    let j = i
    while (j < this.length) {
      if (this.isOp(j, ';')) return j + 1
      if (this.isOp(j, '(') || this.isOp(j, '[') || this.isOp(j, '{')) {
        j = this.skipBalanced(j)
        continue
      }
      j++
    }
    return j
  }

  // 점으로 이은 이름(i부터). 이름과 다음 위치.
  qualifiedName(i: number): { name: string; next: number } {
    const parts: string[] = []
    let j = i
    while (this.isIdent(j)) {
      parts.push(this.tx(j))
      if (this.isOp(j + 1, '.') && this.isIdent(j + 2)) j += 2
      else {
        j++
        break
      }
    }
    return { name: parts.join('.'), next: j }
  }

  parseAnnotation(i: number): { next: number; annotation: Annotation } {
    const { name, next } = this.qualifiedName(i + 1)
    let j = next
    let args: Annotation['args'] = null
    if (this.isOp(j, '(')) {
      const end = this.skipBalanced(j)
      args = { start: j + 1, end: end - 1 }
      j = end
    }
    return { next: Math.max(j, i + 1), annotation: { name, at: i, args } }
  }

  parseModifiers(i: number): { next: number; modifiers: Modifiers } {
    const modifiers: Modifiers = { keywords: new Set(), annotations: [] }
    let j = i
    for (;;) {
      if (this.isOp(j, '@') && !this.isKeyword(j + 1, 'interface')) {
        const parsed = this.parseAnnotation(j)
        modifiers.annotations.push(parsed.annotation)
        j = parsed.next
      } else if (this.kind(j) === 'keyword' && MODIFIER_KEYWORDS.has(this.tx(j))) {
        modifiers.keywords.add(this.tx(j))
        j++
      } else if (this.isIdent(j) && this.tx(j) === 'sealed' && this.startsType(j + 1)) {
        j++
      } else if (
        this.isIdent(j) &&
        this.tx(j) === 'non' &&
        this.isOp(j + 1, '-') &&
        this.tx(j + 2) === 'sealed'
      ) {
        j += 3
      } else {
        return { next: j, modifiers }
      }
    }
  }

  startsType(i: number): boolean {
    if (this.isKeyword(i, 'class') || this.isKeyword(i, 'interface') || this.isKeyword(i, 'enum'))
      return true
    if (this.isOp(i, '@') && this.isKeyword(i + 1, 'interface')) return true
    return (
      this.isIdent(i) &&
      this.tx(i) === 'record' &&
      this.isIdent(i + 1) &&
      (this.isOp(i + 2, '(') || this.isOp(i + 2, '<'))
    )
  }

  parseCompilationUnit(): void {
    let i = 0
    while (i < this.length) {
      if (this.isKeyword(i, 'import')) {
        i = this.parseImport(i)
        continue
      }
      if (this.isOp(i, ';')) {
        i++
        continue
      }
      const { next, modifiers } = this.parseModifiers(i)
      if (this.isKeyword(next, 'package')) {
        this.packageName = this.qualifiedName(next + 1).name
        i = this.skipStatement(next)
        continue
      }
      if (this.startsType(next)) {
        const parsed = this.parseTypeDecl(next, modifiers, null)
        if (parsed.decl) this.types.push(parsed.decl)
        i = parsed.next
        continue
      }
      i = Math.max(next, i + 1)
    }
  }

  parseImport(i: number): number {
    let j = i + 1
    const isStatic = this.isKeyword(j, 'static')
    if (isStatic) j++
    const parts: string[] = []
    let onDemand = false
    while (this.isIdent(j)) {
      parts.push(this.tx(j))
      j++
      if (!this.isOp(j, '.')) break
      j++
      if (this.isOp(j, '*')) {
        onDemand = true
        j++
        break
      }
    }
    if (!isStatic && parts.length > 0) {
      if (onDemand) this.imports.onDemand.add(parts.join('.'))
      else this.imports.single.set(parts[parts.length - 1], parts.join('.'))
    }
    return this.skipStatement(j)
  }

  parseTypeDecl(
    i: number,
    modifiers: Modifiers,
    parent: TypeDecl | null
  ): { next: number; decl: TypeDecl | null } {
    let kind: TypeKind
    let j = i
    if (this.isOp(j, '@')) {
      kind = 'annotation'
      j += 2
    } else {
      const word = this.tx(j)
      kind = word === 'record' ? 'record' : (word as TypeKind)
      j++
    }
    if (!this.isIdent(j)) return { next: j, decl: null }
    const decl: TypeDecl = { kind, name: this.tx(j), modifiers, parent, nested: [] }
    j++
    // 머리(형식 매개변수, extends·implements, record 성분)를 건너뛴다
    while (j < this.length && !this.isOp(j, '{')) {
      if (this.isOp(j, ';') || this.isOp(j, '}')) return { next: j, decl }
      if (this.isOp(j, '(') || this.isOp(j, '[')) {
        j = this.skipBalanced(j)
        continue
      }
      j++
    }
    if (j >= this.length) return { next: j, decl }
    return { next: this.parseBody(j, decl), decl }
  }

  // 형식 본문('{' 위치). 멤버 중 형식 선언만 보고 나머지는 건너뛴다. 닫는 '}' 다음 위치.
  parseBody(open: number, decl: TypeDecl): number {
    let i = open + 1
    if (decl.kind === 'enum') i = this.skipEnumConstants(i)
    while (i < this.length && !this.isOp(i, '}')) {
      if (this.isOp(i, ';')) {
        i++
        continue
      }
      if (this.isOp(i, '{')) {
        i = this.skipBalanced(i)
        continue
      }
      if (this.isKeyword(i, 'static') && this.isOp(i + 1, '{')) {
        i = this.skipBalanced(i + 1)
        continue
      }
      const { next, modifiers } = this.parseModifiers(i)
      if (this.startsType(next)) {
        const parsed = this.parseTypeDecl(next, modifiers, decl)
        if (parsed.decl) decl.nested.push(parsed.decl)
        i = Math.max(parsed.next, i + 1)
        continue
      }
      i = Math.max(this.skipMember(next), i + 1)
    }
    return Math.min(i + 1, this.length)
  }

  // 형식이 아닌 멤버(필드·메서드·생성자) 하나를 건너뛴다. 필드는 ';'에서, 메서드·생성자는 본문을 닫는 '}'에서 끝난다.
  // 초기값(=)이나 어노테이션 요소의 default 뒤의 '{'(배열 초기값, 익명 클래스, 람다 본문)는 멤버를 끝내지 않는다.
  // 본문을 닫는 '}'를 만나면 먹지 않고 멈춘다.
  skipMember(i: number): number {
    let value = false
    let j = i
    while (j < this.length) {
      if (this.isOp(j, ';')) return j + 1
      if (this.isOp(j, '}')) return j
      if (this.isOp(j, '(') || this.isOp(j, '[')) {
        j = this.skipBalanced(j)
        continue
      }
      if (this.isOp(j, '{')) {
        const end = this.skipBalanced(j)
        if (!value) return end
        j = end
        continue
      }
      if (this.isOp(j, '=') || this.isKeyword(j, 'default')) value = true
      j++
    }
    return j
  }

  skipEnumConstants(i: number): number {
    let j = i
    while (j < this.length) {
      if (this.isOp(j, ';')) return j + 1
      if (this.isOp(j, '}')) return j
      if (this.isOp(j, '(') || this.isOp(j, '{') || this.isOp(j, '[')) {
        j = this.skipBalanced(j)
        continue
      }
      j++
    }
    return j
  }
}

// ---- 이름 풀기 ----

function findNested(decl: TypeDecl, name: string): boolean {
  return decl.nested.some((nested) => nested.name === name)
}

// 선언에 붙은 애너테이션은 선언을 감싼 범위에서 풀린다: 감싸는 형식들(그 이름과 중첩 형식), 최상위 형식이 가린다
function shadowedAt(decl: TypeDecl, simple: string, topLevel: readonly TypeDecl[]): boolean {
  if (topLevel.some((top) => top.name === simple)) return true
  for (let scope = decl.parent; scope; scope = scope.parent) {
    if (scope.name === simple || findNested(scope, simple)) return true
  }
  return false
}

function annotationIs(
  name: string,
  fqn: string,
  parser: Parser,
  shadowed: (simple: string) => boolean
): boolean {
  if (name === fqn) return true
  const dot = fqn.lastIndexOf('.')
  const simple = fqn.slice(dot + 1)
  const pkg = fqn.slice(0, dot)
  if (name !== simple || shadowed(simple)) return false
  const single = parser.imports.single.get(simple)
  if (single !== undefined) return single === fqn
  // 같은 패키지의 형식이 on-demand import보다 먼저다
  if (parser.packageName === pkg) return true
  return parser.imports.onDemand.has(pkg)
}

// 애너테이션 요소 값(name = "…" + "…"). 글자 리터럴을 +로 이은 것만 읽는다. 그 밖(상수 이름, 식)이면 null.
function elementValues(parser: Parser, annotation: Annotation): Map<string, string | null> {
  const values = new Map<string, string | null>()
  if (!annotation.args) return values
  let i = annotation.args.start
  const end = annotation.args.end
  while (i < end) {
    // 요소 하나: 이름 = 값(괄호 밖의 ','까지)
    let stop = i
    while (stop < end && !parser.isOp(stop, ',')) {
      if (parser.isOp(stop, '(') || parser.isOp(stop, '[') || parser.isOp(stop, '{'))
        stop = Math.min(parser.skipBalanced(stop), end)
      else stop++
    }
    if (parser.isIdent(i) && parser.isOp(i + 1, '=')) {
      values.set(parser.tx(i), concatenatedLiteral(parser, i + 2, stop))
    }
    i = stop + 1
  }
  return values
}

function concatenatedLiteral(parser: Parser, start: number, end: number): string | null {
  if (start >= end) return null
  let out = ''
  for (let j = start; j < end; j++) {
    const expectLiteral = (j - start) % 2 === 0
    if (expectLiteral) {
      if (parser.kind(j) !== 'string' || parser.tokens[j].unterminated) return null
      const decoded = decodeJavaQuoted(parser.tx(j))
      if (decoded === null) return null
      out += decoded
    } else if (!parser.isOp(j, '+')) {
      return null
    }
  }
  // '+'로 끝나면 식이 아니다
  return (end - start) % 2 === 1 ? out : null
}

function allTypes(roots: readonly TypeDecl[]): TypeDecl[] {
  const out: TypeDecl[] = []
  const visit = (decl: TypeDecl): void => {
    out.push(decl)
    decl.nested.forEach(visit)
  }
  roots.forEach(visit)
  return out
}

function binaryName(parser: Parser, decl: TypeDecl): string {
  const names: string[] = []
  for (let scope: TypeDecl | null = decl; scope; scope = scope.parent) names.unshift(scope.name)
  const local = names.join('$')
  return parser.packageName ? `${parser.packageName}.${local}` : local
}

// 인터페이스·어노테이션 형식 안의 형식은 늘 public static이다
function enclosedByInterface(decl: TypeDecl): boolean {
  return (
    decl.parent !== null && (decl.parent.kind === 'interface' || decl.parent.kind === 'annotation')
  )
}

export function parseOpModes(text: string): ParsedOpMode[] {
  const raw = lexJava(text)
  let tokens = raw.tokens
  let source = text
  let toRaw = (offset: number): number => offset
  if (raw.unsafeUnicodeEscape) {
    const translated = translateEscapes(text, raw.unicodeEscapes)
    source = translated.text
    toRaw = translated.toRaw
    tokens = lexJava(source).tokens
  }
  const parser = new Parser(source, tokens)
  parser.parseCompilationUnit()

  const found: ParsedOpMode[] = []
  for (const decl of allTypes(parser.types)) {
    if (decl.kind !== 'class') continue
    const { annotations, keywords } = decl.modifiers
    const shadowed = (simple: string): boolean => shadowedAt(decl, simple, parser.types)
    const find = (fqn: string): Annotation | undefined =>
      annotations.find((annotation) => annotationIs(annotation.name, fqn, parser, shadowed))
    const teleOp = find(TELEOP)
    const autonomous = find(AUTONOMOUS)
    const utility = find(UTILITY)
    const marked = [teleOp, autonomous, utility].filter(Boolean).length
    if (marked !== 1 || utility) continue
    if (find(DISABLED)) continue
    if (keywords.has('abstract')) continue
    const isPublic = keywords.has('public') || enclosedByInterface(decl)
    const isStatic = keywords.has('static') || enclosedByInterface(decl)
    if (!isPublic || (decl.parent !== null && !isStatic)) continue

    const annotation = (teleOp ?? autonomous)!
    const flavor: OpModeFlavor = teleOp ? 'TeleOp' : 'Autonomous'
    const values = elementValues(parser, annotation)
    const value = values.get('name') ?? null
    const name = value !== null && value.trim() !== '' ? value : decl.name
    // checkUserOpModeName: '$'로 시작하고 끝나는 이름은 SDK 시스템 OpMode의 것이라 버린다(OpModeMeta.isSystemName)
    if (name.startsWith('$') && name.endsWith('$')) continue
    found.push({
      className: binaryName(parser, decl),
      line: lineAt(raw.lineStarts, toRaw(tokens[annotation.at].start)),
      flavor,
      name,
      group: values.get('group') ?? '',
      preselectTeleOp: flavor === 'Autonomous' ? (values.get('preselectTeleOp') ?? '') : ''
    })
  }
  return found
}

const FLAVOR_ORDER: Record<OpModeFlavor, number> = { TeleOp: 0, Autonomous: 1 }

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// 목록 순서: TeleOp → Autonomous, 그 안에서 group(기본 그룹 '' 먼저) → name → 클래스 이름
export function compareOpModes(a: OpModeInfo, b: OpModeInfo): number {
  return (
    FLAVOR_ORDER[a.flavor] - FLAVOR_ORDER[b.flavor] ||
    compareText(a.group, b.group) ||
    compareText(a.name, b.name) ||
    compareText(a.className, b.className)
  )
}
