// Java 소스 → 튜닝 값 묶음. 어떤 필드를 보이는지는 FTC Dashboard 0.6.0과 같다(tunableTypes.ts 머리말).
// - 묶음: FtcDashboard.addConfigClasses의 "if (!configClass.isAnnotationPresent(Config.class) ||
//   configClass.isAnnotationPresent(Disabled.class)) continue;"와 "name = getSimpleName(); if (!altName.isEmpty())
//   name = altName". 중첩 클래스도 따로 본다(Config는 @Inherited가 아니다). 메서드 안·익명 클래스는 보지 않는다.
// - 필드: ReflectionConfig의 "for (Field field : configClass.getFields()) { if (!isStatic || isFinal) continue;"
//   (public static이고 final이 아닌 것). 선언 하나에 이름이 여럿이면(a = 1, b = 2) 줄마다 따로 둔다.
// - 값 형식: VariableType.fromClass의 boolean·int·long·float·double(박싱 포함)·String·enum. 그 밖(short·byte·char·
//   배열·제네릭 포함)은 CUSTOM이고, 그 형식의 public 인스턴스 필드를 펼친다(ReflectionConfig 104-133). 펼친 자식은
//   바깥 필드가 final인지만 보므로 자식의 final 필드도 보인다(Dashboard의 특이점, 그대로 따른다).
//
// SandBot에서만 정한 것(고칠 수 있는 범위):
// - 고칠 수 있는 것은 초기값이 부호 하나와 리터럴 하나뿐인 필드다. 식·초기값 없음·null·텍스트 블록·문자열 안의 \u는
//   이유와 원래 글자를 붙여 읽기 전용으로 둔다. 리터럴 밖에 \u 이스케이프가 있으면 파일 전체가 읽기 전용이다.
// - 객체는 초기값이 정확히 `new T()`이고 T가 이 파일에 선언되고 생성자·인스턴스 초기화 블록이 없을 때만 펼친다
//   (그래야 필드 초기값이 실제 값이다). 자식 id는 T의 선언 위치로 짓는다(같은 형식의 static 필드 둘은 자식을 나눠 쓴다).
//   깊이는 4단계까지, 같은 형식이 다시 나오면 멈춘다.
// - enum은 읽기 전용이다(SDK enum의 상수 목록은 SDK 소스 없이 알 수 없다).
//
// 한계: 다른 파일의 상위 클래스에서 물려받은 public static 필드는 보이지 않는다(Dashboard는 getFields로 보인다).
// 다른 파일에 선언된 형식은 펼치지 않는다. static 블록에서 다시 대입하는 필드도 초기값만 보인다.
import { decodeJavaQuoted, lexJava, lineAt, type JavaToken } from './lexer'
import { isLiteralSpanText } from './javaLiteral'
import type {
  TunableBlock,
  TunableFile,
  TunableNode,
  TunableReadOnlyReason,
  TunableValueType
} from './tunableTypes'

const CONFIG_ANNOTATION = 'com.acmerobotics.dashboard.config.Config'
const DISABLED_ANNOTATION = 'com.qualcomm.robotcore.eventloop.opmode.Disabled'

// 객체를 펼치는 깊이 한도
const MAX_OBJECT_DEPTH = 4

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

const PRIMITIVES = new Set(['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double'])

const LEAF_PRIMITIVES: Readonly<Record<string, TunableValueType>> = {
  boolean: 'boolean',
  int: 'int',
  long: 'long',
  float: 'float',
  double: 'double'
}

// java.lang의 박싱 형식과 String(이 파일에 같은 이름의 형식이 있으면 그 형식이다)
const LEAF_BOXED: Readonly<Record<string, TunableValueType>> = {
  Boolean: 'boolean',
  Integer: 'int',
  Long: 'long',
  Float: 'float',
  Double: 'double',
  String: 'String'
}

const UNSUPPORTED_BOXED = new Set(['Short', 'Byte', 'Character'])

type TypeKind = 'class' | 'interface' | 'enum' | 'annotation' | 'record'

type Annotation = {
  // 이름(점으로 이은 글자, 공백 없음)
  name: string
  // 괄호 안 토큰 범위 [start, end), 괄호가 없으면 null
  args: { start: number; end: number } | null
}

type Modifiers = { keywords: Set<string>; annotations: Annotation[] }

type TypeDecl = {
  kind: TypeKind
  name: string
  path: string
  nameToken: number
  modifiers: Modifiers
  parent: TypeDecl | null
  nested: TypeDecl[]
  fields: FieldDecl[]
  hasConstructor: boolean
  hasInstanceInit: boolean
}

type FieldDecl = {
  owner: TypeDecl
  modifiers: Modifiers
  // 형식 토큰 범위 [start, end)
  typeStart: number
  typeEnd: number
  name: string
  nameToken: number
  // 이름 뒤의 [](C 방식 배열)
  extraDims: number
  // 초기값 토큰 범위 [start, end)
  init: { start: number; end: number } | null
}

type Imports = { single: Map<string, string>; onDemand: Set<string> }

class Parser {
  readonly tokens: JavaToken[]
  readonly types: TypeDecl[] = []
  readonly imports: Imports = { single: new Map(), onDemand: new Set() }
  // 토큰 글자(한 번만 자른다)
  private readonly texts: string[]

  constructor(
    readonly text: string,
    tokens: JavaToken[]
  ) {
    this.tokens = tokens
    this.texts = tokens.map((token) => text.slice(token.start, token.end))
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

  get length(): number {
    return this.tokens.length
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

  // '<'(i)부터 짝인 '>' 다음 위치. 형식 인자에 올 수 없는 토큰을 만나면 null.
  tryTypeArgs(i: number): number | null {
    let depth = 0
    for (let j = i; j < this.length; j++) {
      const kind = this.kind(j)
      const t = this.tx(j)
      if (kind === 'operator') {
        if (t === '<') depth++
        else if (t === '>') {
          depth--
          if (depth === 0) return j + 1
        } else if (t === '(') {
          // 형식 인자 안의 어노테이션 인자(List<@Size(max = 3) String>)
          if (!this.annotationNameEndsAt(j - 1)) return null
          j = this.skipBalanced(j) - 1
          continue
        } else if (!['.', ',', '?', '&', '[', ']', '@'].includes(t)) return null
      } else if (kind === 'keyword') {
        if (!PRIMITIVES.has(t) && t !== 'extends' && t !== 'super') return null
      } else if (kind !== 'identifier') {
        return null
      }
    }
    return null
  }

  // i가 어노테이션 이름(@a.b.C)의 마지막 이름인지
  annotationNameEndsAt(i: number): boolean {
    let j = i
    while (this.isIdent(j)) {
      if (this.isOp(j - 1, '@')) return true
      if (!this.isOp(j - 1, '.')) return false
      j -= 2
    }
    return false
  }

  // 어노테이션 하나('@' 위치). 끝 위치와 내용.
  parseAnnotation(i: number): { next: number; annotation: Annotation } {
    let j = i + 1
    const parts: string[] = []
    while (this.isIdent(j)) {
      parts.push(this.tx(j))
      if (this.isOp(j + 1, '.') && this.isIdent(j + 2)) j += 2
      else {
        j++
        break
      }
    }
    let args: Annotation['args'] = null
    if (this.isOp(j, '(')) {
      const end = this.skipBalanced(j)
      args = { start: j + 1, end: end - 1 }
      j = end
    }
    return { next: Math.max(j, i + 1), annotation: { name: parts.join('.'), args } }
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

  // 형식 선언이 시작되는 곳인지(class·interface·enum·@interface·record)
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
    const name = this.tx(j)
    const decl: TypeDecl = {
      kind,
      name,
      path: parent ? `${parent.path}.${name}` : name,
      nameToken: j,
      modifiers,
      parent,
      nested: [],
      fields: [],
      hasConstructor: false,
      hasInstanceInit: false
    }
    j++
    // 머리(형식 매개변수, extends·implements, record 성분)를 건너뛴다
    while (j < this.length && !this.isOp(j, '{')) {
      if (this.isOp(j, ';') || this.isOp(j, '}')) return { next: j, decl }
      if (this.isOp(j, '(')) {
        j = this.skipBalanced(j)
        continue
      }
      j++
    }
    if (j >= this.length) return { next: j, decl }
    return { next: this.parseBody(j, decl), decl }
  }

  // 형식 본문('{' 위치). 닫는 '}' 다음 위치.
  parseBody(open: number, decl: TypeDecl): number {
    let i = open + 1
    if (decl.kind === 'enum') i = this.skipEnumConstants(i)
    while (i < this.length && !this.isOp(i, '}')) {
      if (this.isOp(i, ';')) {
        i++
        continue
      }
      if (this.isOp(i, '{')) {
        decl.hasInstanceInit = true
        i = this.skipBalanced(i)
        continue
      }
      if (this.isKeyword(i, 'static') && this.isOp(i + 1, '{')) {
        i = this.skipBalanced(i + 1)
        continue
      }
      const { next, modifiers } = this.parseModifiers(i)
      let j = next
      if (this.startsType(j)) {
        const parsed = this.parseTypeDecl(j, modifiers, decl)
        if (parsed.decl) decl.nested.push(parsed.decl)
        i = parsed.next
        continue
      }
      // 제네릭 메서드·생성자의 형식 매개변수
      if (this.isOp(j, '<')) j = this.tryTypeArgs(j) ?? j + 1
      // 생성자(record의 간결한 생성자 포함)
      if (
        this.isIdent(j) &&
        this.tx(j) === decl.name &&
        (this.isOp(j + 1, '(') || (decl.kind === 'record' && this.isOp(j + 1, '{')))
      ) {
        decl.hasConstructor = true
        i = this.isOp(j + 1, '(') ? this.skipMethodRest(j + 1) : this.skipBalanced(j + 1)
        continue
      }
      const typeStart = j
      const typeEnd = this.skipType(j)
      if (typeEnd === typeStart) {
        i = this.recover(Math.max(j, i + 1))
        continue
      }
      if (this.isIdent(typeEnd) && this.isOp(typeEnd + 1, '(')) {
        i = this.skipMethodRest(typeEnd + 1)
        continue
      }
      if (this.isIdent(typeEnd)) {
        i = this.parseDeclarators(typeEnd, decl, modifiers, typeStart, typeEnd)
        continue
      }
      i = this.recover(typeEnd)
    }
    return Math.min(i + 1, this.length)
  }

  // enum 상수 목록(인자·본문 포함)을 ';'나 '}'까지 건너뛴다
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

  // 형식 하나(어노테이션, 기본형이나 점으로 이은 이름과 형식 인자, 배열 [])를 건너뛴다. 형식이 아니면 i 그대로.
  skipType(i: number): number {
    let j = i
    while (this.isOp(j, '@') && !this.isKeyword(j + 1, 'interface'))
      j = this.parseAnnotation(j).next
    if (this.kind(j) === 'keyword' && (PRIMITIVES.has(this.tx(j)) || this.tx(j) === 'void')) {
      j++
    } else if (this.isIdent(j)) {
      j++
      for (;;) {
        if (this.isOp(j, '<')) {
          const end = this.tryTypeArgs(j)
          if (end === null) return i
          j = end
        } else if (this.isOp(j, '.') && (this.isIdent(j + 1) || this.isOp(j + 1, '@'))) {
          j++
          while (this.isOp(j, '@')) j = this.parseAnnotation(j).next
          if (!this.isIdent(j)) return i
          j++
        } else break
      }
    } else {
      return i
    }
    for (;;) {
      while (this.isOp(j, '@')) j = this.parseAnnotation(j).next
      if (this.isOp(j, '[') && this.isOp(j + 1, ']')) j += 2
      else if (this.isOp(j, '...')) j++
      else break
    }
    return j
  }

  // 메서드의 나머지('(' 위치부터): 매개변수, throws, 본문이나 ';'(어노테이션 형식의 default 값 포함)
  skipMethodRest(i: number): number {
    let j = this.skipBalanced(i)
    while (j < this.length) {
      if (this.isOp(j, '{')) return this.skipBalanced(j)
      if (this.isOp(j, ';')) return j + 1
      if (this.isOp(j, '}')) return j
      if (this.isKeyword(j, 'default')) return this.skipStatement(j)
      if (this.isOp(j, '(') || this.isOp(j, '[')) {
        j = this.skipBalanced(j)
        continue
      }
      j++
    }
    return j
  }

  // 알 수 없는 멤버: ';'까지(먹는다) 또는 본문을 닫는 '}'까지(먹지 않는다)
  recover(i: number): number {
    let j = i
    while (j < this.length) {
      if (this.isOp(j, ';')) return j + 1
      if (this.isOp(j, '}')) return j
      if (this.isOp(j, '(') || this.isOp(j, '[') || this.isOp(j, '{')) {
        j = this.skipBalanced(j)
        continue
      }
      j++
    }
    return j
  }

  parseDeclarators(
    i: number,
    owner: TypeDecl,
    modifiers: Modifiers,
    typeStart: number,
    typeEnd: number
  ): number {
    let j = i
    for (;;) {
      if (!this.isIdent(j)) return this.recover(j)
      const nameToken = j
      j++
      let extraDims = 0
      while (this.isOp(j, '[') && this.isOp(j + 1, ']')) {
        extraDims++
        j += 2
      }
      let init: FieldDecl['init'] = null
      if (this.isOp(j, '=')) {
        const start = j + 1
        j = this.skipInitializer(start)
        init = { start, end: j }
      }
      owner.fields.push({
        owner,
        modifiers,
        typeStart,
        typeEnd,
        name: this.tx(nameToken),
        nameToken,
        extraDims,
        init
      })
      if (this.isOp(j, ',')) {
        j++
        continue
      }
      if (this.isOp(j, ';')) return j + 1
      return this.recover(j)
    }
  }

  // 초기값: 괄호 밖의 ','·';'(또는 본문을 닫는 '}') 앞까지. 형식 인자 안의 ','(new HashMap<A, B>(), Foo.<A, B>m(),
  // Map<A, B>::new)는 초기값을 나누지 않는다. 람다·익명 클래스·배열 초기값은 괄호로 건너뛴다.
  skipInitializer(i: number): number {
    let j = i
    while (j < this.length) {
      const kind = this.kind(j)
      const t = this.tx(j)
      if (kind === 'operator') {
        if (t === ',' || t === ';' || t === '}') return j
        if (t === '(' || t === '[' || t === '{') {
          j = this.skipBalanced(j)
          continue
        }
        if (t === '<') {
          const end = this.tryTypeArgs(j)
          // 형식 인자로 볼 수 있는 곳: '.<'(명시적 제네릭 호출), new 뒤 형식, 'Type<..>::'
          if (end !== null && (this.isOp(j - 1, '.') || this.isOp(end, '::') || this.afterNew(j))) {
            j = end
            continue
          }
        }
      }
      j++
    }
    return j
  }

  // '<'(i)가 new 뒤 형식 이름(점으로 이은 이름)의 형식 인자인지
  afterNew(i: number): boolean {
    let j = i - 1
    while (j >= 0) {
      if (!this.isIdent(j)) return false
      if (this.isOp(j - 1, '.')) {
        j -= 2
        continue
      }
      // 형식 인자 뒤의 '.'(Outer<A>.Inner)는 드물어 보지 않는다
      return this.isKeyword(j - 1, 'new')
    }
    return false
  }
}

// --- 이름 풀기 ---

function typeNameSegments(parser: Parser, start: number, end: number): string[] | null {
  const segments: string[] = []
  let j = start
  while (parser.isOp(j, '@') && j < end) j = parser.parseAnnotation(j).next
  while (j < end) {
    if (parser.isOp(j, '@')) {
      j = parser.parseAnnotation(j).next
      continue
    }
    const kind = parser.kind(j)
    if (kind === 'identifier' || (kind === 'keyword' && PRIMITIVES.has(parser.tx(j)))) {
      segments.push(parser.tx(j))
      j++
      continue
    }
    if (parser.isOp(j, '.')) {
      j++
      continue
    }
    return null
  }
  return segments.length > 0 ? segments : null
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

// 중첩 형식을 이름으로 찾는다(형식마다 한 번 만든 표)
const nestedTables = new WeakMap<TypeDecl, Map<string, TypeDecl>>()

function findNested(decl: TypeDecl, name: string): TypeDecl | null {
  let table = nestedTables.get(decl)
  if (!table) {
    table = new Map()
    // 같은 이름이 둘이면(컴파일 오류) 앞의 것
    for (const nested of decl.nested) if (!table.has(nested.name)) table.set(nested.name, nested)
    nestedTables.set(decl, table)
  }
  return table.get(name) ?? null
}

// 이름을 이 파일의 형식으로 푼다. 첫 이름은 from부터 바깥으로(각 범위의 중첩 형식, 그 범위 자신), 그다음 최상위 형식.
function resolveType(
  segments: readonly string[],
  from: TypeDecl | null,
  topLevel: readonly TypeDecl[]
): TypeDecl | null {
  const [first, ...rest] = segments
  let found: TypeDecl | null = null
  for (let scope = from; scope && !found; scope = scope.parent) {
    found = findNested(scope, first) ?? (scope.name === first ? scope : null)
  }
  found ??= topLevel.find((decl) => decl.name === first) ?? null
  for (const name of rest) {
    if (!found) return null
    found = findNested(found, name)
  }
  return found
}

// 형식 선언에 붙은 어노테이션의 단순 이름을 이 파일의 형식이 가리는지. 선언 자신의 어노테이션은 선언을 감싼 범위에서
// 풀리므로, 최상위 형식과 감싸는 형식들(그 이름과 중첩 형식)만 본다(자신의 중첩 형식은 보지 않는다).
function shadowedAt(decl: TypeDecl, simple: string, topLevel: readonly TypeDecl[]): boolean {
  if (topLevel.some((top) => top.name === simple)) return true
  for (let scope = decl.parent; scope; scope = scope.parent) {
    if (scope.name === simple || findNested(scope, simple)) return true
  }
  return false
}

// 어노테이션 이름이 그 정규 이름(fqn)을 가리키는지: 정규 이름 그대로, 또는 단순 이름을 단일 import나
// 패키지 import(.*)로 들여온 것. 이 파일의 형식이 같은 단순 이름으로 가리면 그 형식이다.
function annotationIs(
  name: string,
  fqn: string,
  imports: Imports,
  shadowed: (simple: string) => boolean
): boolean {
  if (name === fqn) return true
  const dot = fqn.lastIndexOf('.')
  const simple = fqn.slice(dot + 1)
  if (name !== simple || shadowed(simple)) return false
  const single = imports.single.get(simple)
  if (single !== undefined) return single === fqn
  return imports.onDemand.has(fqn.slice(0, dot))
}

// @Config("이름")·@Config(value = "이름")의 값. 상수 식 등 알 수 없으면 null.
function configValue(parser: Parser, annotation: Annotation): string | null {
  if (!annotation.args) return null
  let { start } = annotation.args
  const { end } = annotation.args
  if (parser.isIdent(start) && parser.tx(start) === 'value' && parser.isOp(start + 1, '='))
    start += 2
  if (end - start !== 1 || parser.kind(start) !== 'string') return null
  return decodeJavaQuoted(parser.tx(start))
}

// --- 노드 만들기 ---

type Context = {
  parser: Parser
  text: string
  lineStarts: number[]
  topLevel: TypeDecl[]
  unsafeFile: boolean
}

type TypeInfo =
  | { kind: 'leaf'; type: TunableValueType; boxed: boolean }
  | { kind: 'unsupported' }
  | { kind: 'declared'; decl: TypeDecl }
  | { kind: 'external' }

function typeInfoOf(ctx: Context, field: FieldDecl): TypeInfo {
  const { parser } = ctx
  for (let j = field.typeStart; j < field.typeEnd; j++) {
    // 배열, 제네릭, 가변 인자
    if (parser.isOp(j, '[') || parser.isOp(j, '<') || parser.isOp(j, '...'))
      return { kind: 'unsupported' }
  }
  if (field.extraDims > 0) return { kind: 'unsupported' }
  const segments = typeNameSegments(parser, field.typeStart, field.typeEnd)
  if (!segments) return { kind: 'unsupported' }
  if (segments.length === 1 && PRIMITIVES.has(segments[0])) {
    const leaf = LEAF_PRIMITIVES[segments[0]]
    return leaf ? { kind: 'leaf', type: leaf, boxed: false } : { kind: 'unsupported' }
  }
  const declared = resolveType(segments, field.owner, ctx.topLevel)
  if (declared) return { kind: 'declared', decl: declared }
  const simple =
    segments.length === 1
      ? segments[0]
      : segments.length === 3 && segments[0] === 'java' && segments[1] === 'lang'
        ? segments[2]
        : null
  // 이 파일의 형식이 가리면 위에서 그 형식으로 풀렸다
  if (simple !== null) {
    const leaf = LEAF_BOXED[simple]
    if (leaf) return { kind: 'leaf', type: leaf, boxed: simple !== 'String' }
    if (UNSUPPORTED_BOXED.has(simple)) return { kind: 'unsupported' }
  }
  return { kind: 'external' }
}

function spanOf(
  ctx: Context,
  range: { start: number; end: number }
): { start: number; end: number } {
  const { tokens } = ctx.parser
  return { start: tokens[range.start].start, end: tokens[range.end - 1].end }
}

// 초기값이 enum 상수처럼 보이는지(A.B, A.B.C: 점으로 이은 이름 둘 이상)
function looksLikeConstant(parser: Parser, range: { start: number; end: number }): boolean {
  const count = range.end - range.start
  if (count < 3 || count % 2 === 0) return false
  for (let j = range.start; j < range.end; j++) {
    const even = (j - range.start) % 2 === 0
    if (even ? !parser.isIdent(j) : !parser.isOp(j, '.')) return false
  }
  return true
}

// 리터럴 토큰이 그 형식의 초기값으로 맞는지(javac가 받는 모양, 박싱은 따로 보지 않는다)
function literalMatchesType(parser: Parser, token: number, type: TunableValueType): boolean {
  const kind = parser.kind(token)
  const t = parser.tx(token)
  switch (type) {
    case 'boolean':
      return kind === 'boolean'
    case 'String':
      return kind === 'string'
    case 'int':
      return kind === 'integer' && !/[lL]$/.test(t)
    case 'long':
      return kind === 'integer'
    case 'float':
      // 정수 리터럴은 float로 넓혀지고, 부동소수는 f 접미사가 있어야 한다(16진 부동소수도 지수 뒤의 f)
      return kind === 'integer' || (kind === 'floating' && /[fF]$/.test(t))
    case 'double':
      return kind === 'integer' || kind === 'floating'
  }
}

type ValueAnalysis = { editable: boolean; reason?: TunableReadOnlyReason }

function analyzeValue(
  ctx: Context,
  range: { start: number; end: number },
  type: TunableValueType
): ValueAnalysis {
  const { parser } = ctx
  const count = range.end - range.start
  const last = range.end - 1
  const lastKind = parser.kind(last)
  if (count === 1 && lastKind === 'null') return { editable: false, reason: 'null' }
  if (count === 1 && lastKind === 'textBlock') return { editable: false, reason: 'textBlock' }
  const signed =
    count === 2 &&
    (parser.isOp(range.start, '-') || parser.isOp(range.start, '+')) &&
    (lastKind === 'integer' || lastKind === 'floating')
  if (count !== 1 && !signed) return { editable: false, reason: 'expression' }
  const token = parser.tokens[last]
  if (token.unterminated || !literalMatchesType(parser, last, type))
    return { editable: false, reason: 'expression' }
  if (token.unicodeEscape) return { editable: false, reason: 'textBlock' }
  const span = spanOf(ctx, range)
  if (!isLiteralSpanText(ctx.text.slice(span.start, span.end)))
    return { editable: false, reason: 'expression' }
  if (ctx.unsafeFile) return { editable: false, reason: 'unicodeEscape' }
  return { editable: true }
}

// 초기값이 정확히 `new T()`이면 T의 이름 토큰들
function newNoArgs(parser: Parser, range: { start: number; end: number }): string[] | null {
  if (!parser.isKeyword(range.start, 'new')) return null
  if (range.end - range.start < 4) return null
  if (!parser.isOp(range.end - 2, '(') || !parser.isOp(range.end - 1, ')')) return null
  const names: string[] = []
  for (let j = range.start + 1; j < range.end - 2; j++) {
    const even = (j - range.start - 1) % 2 === 0
    if (even) {
      if (!parser.isIdent(j)) return null
      names.push(parser.tx(j))
    } else if (!parser.isOp(j, '.')) return null
  }
  // 이름은 점으로 끝나지 않는다
  return (range.end - 2 - (range.start + 1)) % 2 === 1 ? names : null
}

function makeNode(
  ctx: Context,
  field: FieldDecl,
  depth: number,
  stack: readonly TypeDecl[]
): TunableNode {
  const { parser, text } = ctx
  const id = `${field.owner.path}#${field.name}`
  const name = field.name
  const line = lineAt(ctx.lineStarts, parser.tokens[field.nameToken].start)
  const span = field.init && field.init.end > field.init.start ? spanOf(ctx, field.init) : null
  const initText = span ? text.slice(span.start, span.end) : null
  const typeText = text.slice(
    parser.tokens[field.typeStart].start,
    parser.tokens[field.typeEnd - 1].end
  )
  const info = typeInfoOf(ctx, field)

  if (info.kind === 'leaf') {
    const base = { kind: 'value' as const, id, name, type: info.type, boxed: info.boxed, line }
    if (!field.init || !span) {
      return { ...base, literal: null, span: null, editable: false, reason: 'noInitializer' }
    }
    const analysis = analyzeValue(ctx, field.init, info.type)
    return { ...base, literal: initText, span, ...analysis }
  }
  if (info.kind === 'unsupported') {
    return { kind: 'other', id, name, typeText, text: initText, reason: 'unsupportedType', line }
  }
  if (info.kind === 'declared' && info.decl.kind === 'enum') {
    return { kind: 'other', id, name, typeText, text: initText, reason: 'enum', line }
  }
  if (info.kind === 'external' && field.init && looksLikeConstant(parser, field.init)) {
    return { kind: 'other', id, name, typeText, text: initText, reason: 'enum', line }
  }
  const object = { kind: 'object' as const, id, name, typeName: typeText, text: initText, line }
  if (!field.init || !span) return { ...object, children: [], reason: 'noInitializer' }
  if (info.kind !== 'declared') return { ...object, children: [], reason: 'object' }
  const decl = info.decl
  const created = newNoArgs(parser, field.init)
  // Dashboard는 펼친 객체의 자식을 고를 때 바깥 필드가 final인지 본다. 펼친 객체 안의 final 객체 필드는 빈 묶음이다.
  const expandable =
    !field.modifiers.keywords.has('final') &&
    created !== null &&
    resolveType(created, field.owner, ctx.topLevel) === decl &&
    decl.kind === 'class' &&
    !decl.modifiers.keywords.has('abstract') &&
    !decl.hasConstructor &&
    !decl.hasInstanceInit &&
    depth < MAX_OBJECT_DEPTH &&
    !stack.includes(decl)
  if (!expandable) return { ...object, children: [], reason: 'object' }
  const children = decl.fields
    .filter((child) => child.modifiers.keywords.has('public') && !isStatic(child))
    .map((child) => makeNode(ctx, child, depth + 1, [...stack, decl]))
  return { ...object, children }
}

// 인터페이스·어노테이션 형식의 필드는 public static final이다
function isInterfaceLike(decl: TypeDecl): boolean {
  return decl.kind === 'interface' || decl.kind === 'annotation'
}

function isStatic(field: FieldDecl): boolean {
  return field.modifiers.keywords.has('static') || isInterfaceLike(field.owner)
}

// Dashboard의 맨 위 필드: public static이고 final이 아님
function isTopLevelTunable(field: FieldDecl): boolean {
  if (isInterfaceLike(field.owner)) return false
  const { keywords } = field.modifiers
  return keywords.has('public') && keywords.has('static') && !keywords.has('final')
}

export function parseTunables(text: string): TunableFile {
  const lexed = lexJava(text)
  const parser = new Parser(text, lexed.tokens)
  parser.parseCompilationUnit()
  const types = allTypes(parser.types)
  const ctx: Context = {
    parser,
    text,
    lineStarts: lexed.lineStarts,
    topLevel: parser.types,
    unsafeFile: lexed.unsafeUnicodeEscape
  }

  const blocks: TunableBlock[] = []
  let staticFieldsWithoutConfig = false
  for (const decl of types) {
    const { annotations } = decl.modifiers
    const shadowed = (simple: string): boolean => shadowedAt(decl, simple, parser.types)
    const config = annotations.find((annotation) =>
      annotationIs(annotation.name, CONFIG_ANNOTATION, parser.imports, shadowed)
    )
    const tunableFields = decl.fields.filter(isTopLevelTunable)
    if (!config) {
      if (tunableFields.length > 0) staticFieldsWithoutConfig = true
      continue
    }
    const disabled = annotations.some((annotation) =>
      annotationIs(annotation.name, DISABLED_ANNOTATION, parser.imports, shadowed)
    )
    if (disabled) continue
    const alternative = configValue(parser, config)
    blocks.push({
      classPath: decl.path,
      name: alternative ? alternative : decl.name,
      line: lineAt(ctx.lineStarts, parser.tokens[decl.nameToken].start),
      fields: tunableFields.map((field) => makeNode(ctx, field, 0, []))
    })
  }
  return { blocks, unicodeEscapes: lexed.unsafeUnicodeEscape, staticFieldsWithoutConfig }
}
