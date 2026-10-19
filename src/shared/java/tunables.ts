// Java 소스 → 튜닝 값 묶음. 어떤 필드를 보이는지는 FTC Dashboard 0.6.0과 같다(tunableTypes.ts 머리말).
// - 묶음: FtcDashboard.addConfigClasses의 "if (!configClass.isAnnotationPresent(Config.class) ||
//   configClass.isAnnotationPresent(Disabled.class)) continue;"와 "name = getSimpleName(); if (!altName.isEmpty())
//   name = altName". 중첩 클래스도 따로 본다(Config는 @Inherited가 아니다). 메서드 안·익명 클래스는 보지 않는다.
// - 필드: ReflectionConfig의 "for (Field field : configClass.getFields()) { if (!isStatic || isFinal) continue;"
//   (public static이고 final이 아닌 것). 선언 하나에 이름이 여럿이면(a = 1, b = 2) 줄마다 따로 둔다.
//   getFields()라 같은 파일의 상위 클래스(extends) 필드도 자기 필드 뒤에 둔다(id는 선언한 형식, Base#K). 가린 필드(같은
//   이름)는 getFields()가 둘 다 주고(HotSpot·ART 모두 자기 필드 다음 상위 클래스 순) Dashboard가 이름으로 HashMap에 넣으므로,
//   걸러진 것 중 가장 위 상위 클래스의 것이 남는다(javac + Dashboard 0.6.0 반사로 확인).
// - 값 형식: VariableType.fromClass의 boolean·int·long·float·double(박싱 포함)·String·enum. 그 밖(short·byte·char·
//   배열·제네릭 포함)은 CUSTOM이고, 그 형식의 public 인스턴스 필드(상위 클래스 것 포함)를 펼친다(ReflectionConfig
//   104-133). 펼친 자식은 바깥 필드가 final인지만 보므로 자식의 final 필드도 보인다(Dashboard의 특이점, 그대로 따른다).
//
// SandBot에서만 정한 것(고칠 수 있는 범위):
// - 고칠 수 있는 것은 초기값이 부호 하나와 리터럴 하나뿐인 필드다. 식·초기값 없음·null·텍스트 블록·문자열 안의 \u·
//   줄바꿈이 든 문자열(한 줄 입력칸이 지운다)은 이유와 원래 글자를 붙여 읽기 전용으로 둔다. 리터럴 밖에 \u 이스케이프가
//   있으면 파일 전체가 읽기 전용이다.
// - 객체는 초기값이 정확히 `new T()`이고 T가 이 파일의 class일 때만 펼친다. 자식 id는 그 필드를 선언한 형식으로 짓는다
//   (같은 형식의 static 필드 둘은 자식을 나눠 쓴다). 깊이는 4단계까지, 같은 형식이 다시 나오면 멈춘다.
// - new T()가 부르는 생성자(매개변수 없음·가변 인자, 본문이 비거나 super();뿐이면 뺀다)나 인스턴스 초기화 블록이 자식을
//   선언한 클래스나 그 아래(T 쪽 하위 클래스)에 있으면 그 자식의 초기값이 실제 값이 아닐 수 있으므로, 펼치되 그 자식 값은
//   읽기 전용이다(initializedInType, 그 안의 객체도 같다). 위(상위 클래스)의 것은 자식 필드 초기값보다 먼저 돌아 세지 않는다.
//   같은 id는 렌더러가 처음 것만 보므로 한 경로에서라도 그러면 모두 그렇게 둔다.
// - 클래스를 초기화할 때 도는 코드가 대입·증감하는 필드(객체 필드는 멤버를 읽기만 하는 것이 아니면 나오기만 해도 그
//   자식)도 읽기 전용이다(initializedInType). Dashboard는 클래스를 초기화한 뒤의 값을 보이므로 초기값을 고쳐도 소용이 없다.
//   보는 코드는 선언한 형식과, 묶음의 클래스에서 선언한 형식까지의 하위 클래스들의 static 블록과 static 필드 초기값, 그리고
//   거기서 부르는 같은 형식의 static 메서드와 new T(…)가 돌리는 그 형식의 생성자·인스턴스 초기화 블록(싱글턴, 차례로
//   따라간다)이다. 람다·익명 클래스 안도 보고, 같은 이름의 지역 변수 선언과 다른 이름으로 한정한 것(other.kP), 하위 클래스가
//   같은 이름의 필드로 가린 것은 뺀다. 애매하면 읽기 전용으로 둔다.
// - enum은 읽기 전용이다(SDK enum의 상수 목록은 SDK 소스 없이 알 수 없다).
//
// 한계: 다른 파일의 상위 클래스 필드는 보이지 않는다(Dashboard는 getFields로 보인다. 객체는 아는 필드만 펼친다).
// 다른 파일에 선언된 형식은 펼치지 않는다. 그 밖의 형식(묶음 사슬 밖의 하위 클래스, 중첩 클래스 등)의 static 블록과 다른
// 형식의 메서드(상위 클래스의 static 메서드, 메서드 참조 Lift::apply 포함)·인스턴스 메서드가 하는 대입은 보지 않는다.
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
  // class의 extends 형식 토큰 범위 [start, end)(없으면 null). implements·interface의 extends는 두지 않는다.
  superclass: { start: number; end: number } | null
  // new T()(하위 클래스의 암묵적 super() 포함)가 부를 수 있는 생성자(매개변수 없음·가변 인자) 중 본문이 비거나
  // super();뿐이 아닌 것이 있다
  hasConstructor: boolean
  hasInstanceInit: boolean
  // static 블록의 토큰 범위 [start, end)('{' 다음부터 닫는 '}'까지)
  staticBlocks: { start: number; end: number }[]
  // static 메서드 이름 → 본문의 토큰 범위들(오버로드는 여럿, 범위는 static 블록과 같은 모양)
  staticMethods: Map<string, { start: number; end: number }[]>
  // 모든 생성자 본문과 인스턴스 초기화 블록의 토큰 범위(클래스 초기화 중에 new T(…)가 돌리는 코드)
  instanceInits: { start: number; end: number }[]
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
      superclass: null,
      hasConstructor: false,
      hasInstanceInit: false,
      staticBlocks: [],
      staticMethods: new Map(),
      instanceInits: []
    }
    j++
    // 형식 매개변수(<T extends A>의 extends는 상위 클래스가 아니다). 읽지 못하면 extends를 두지 않는다.
    let headerKnown = true
    if (this.isOp(j, '<')) {
      const end = this.tryTypeArgs(j)
      headerKnown = end !== null
      j = end ?? j + 1
    }
    // 머리(extends·implements·permits, record 성분)를 건너뛴다. class의 extends 형식은 범위를 둔다.
    while (j < this.length && !this.isOp(j, '{')) {
      if (this.isOp(j, ';') || this.isOp(j, '}')) return { next: j, decl }
      if (this.isOp(j, '(')) {
        j = this.skipBalanced(j)
        continue
      }
      if (kind === 'class' && headerKnown && !decl.superclass && this.isKeyword(j, 'extends')) {
        const end = this.skipType(j + 1)
        if (end > j + 1) decl.superclass = { start: j + 1, end }
        j = Math.max(end, j + 1)
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
        const end = this.skipBalanced(i)
        decl.instanceInits.push({ start: i + 1, end })
        i = end
        continue
      }
      if (this.isKeyword(i, 'static') && this.isOp(i + 1, '{')) {
        const end = this.skipBalanced(i + 1)
        decl.staticBlocks.push({ start: i + 2, end })
        i = end
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
        if (this.isOp(j + 1, '(')) {
          if (this.constructorRunsOnNew(j + 1)) decl.hasConstructor = true
          i = this.skipMethodRest(j + 1, (body) => decl.instanceInits.push(body))
        } else {
          decl.hasConstructor = true
          const end = this.skipBalanced(j + 1)
          decl.instanceInits.push({ start: j + 2, end })
          i = end
        }
        continue
      }
      const typeStart = j
      const typeEnd = this.skipType(j)
      if (typeEnd === typeStart) {
        i = this.recover(Math.max(j, i + 1))
        continue
      }
      if (this.isIdent(typeEnd) && this.isOp(typeEnd + 1, '(')) {
        const name = this.tx(typeEnd)
        i = this.skipMethodRest(typeEnd + 1, (body) => {
          if (!modifiers.keywords.has('static')) return
          const bodies = decl.staticMethods.get(name)
          if (bodies) bodies.push(body)
          else decl.staticMethods.set(name, [body])
        })
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

  // 메서드의 나머지('(' 위치부터): 매개변수, throws, 본문이나 ';'(어노테이션 형식의 default 값 포함).
  // 본문이 있으면 그 토큰 범위('{' 다음부터 닫는 '}'까지)를 onBody에 넘긴다.
  skipMethodRest(i: number, onBody?: (body: { start: number; end: number }) => void): number {
    let j = this.skipBalanced(i)
    while (j < this.length) {
      if (this.isOp(j, '{')) {
        const end = this.skipBalanced(j)
        onBody?.({ start: j + 1, end })
        return end
      }
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

  // 생성자('(' 위치)를 new T()(또는 하위 클래스의 super())가 부르고 무언가 하는지: 매개변수가 없거나 가변 인자이고,
  // 본문이 비거나 super();뿐이 아니다
  constructorRunsOnNew(open: number): boolean {
    const close = this.skipBalanced(open)
    let noArgs = close === open + 2
    for (let j = open + 1; j < close - 1 && !noArgs; j++) noArgs = this.isOp(j, '...')
    if (!noArgs) return false
    // throws 절을 지나 본문을 찾는다
    let body = close
    while (body < this.length && !this.isOp(body, '{')) {
      if (this.isOp(body, ';') || this.isOp(body, '}')) return false
      body++
    }
    const start = body + 1
    const count = this.skipBalanced(body) - 1 - start
    if (count <= 0) return false
    return !(
      count === 4 &&
      this.isKeyword(start, 'super') &&
      this.isOp(start + 1, '(') &&
      this.isOp(start + 2, ')') &&
      this.isOp(start + 3, ';')
    )
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
    // 형식 인자(extends Base<Double>)는 이름이 아니다. 필드 형식은 typeInfoOf가 제네릭을 먼저 거른다.
    if (parser.isOp(j, '<')) {
      const close = parser.tryTypeArgs(j)
      if (close === null) return null
      j = close
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

// 같은 파일의 상위 클래스(extends). 이 파일에서 풀리지 않거나 class가 아니면 null. 선언마다 한 번 푼다.
const superclasses = new WeakMap<TypeDecl, TypeDecl | null>()

function superclassOf(ctx: Context, decl: TypeDecl): TypeDecl | null {
  const cached = superclasses.get(decl)
  if (cached !== undefined) return cached
  let found: TypeDecl | null = null
  if (decl.superclass) {
    const segments = typeNameSegments(ctx.parser, decl.superclass.start, decl.superclass.end)
    // extends 절은 선언을 감싼 범위에서 푼다(자신의 중첩 형식은 보지 않고, 같은 범위의 형제 형식은 본다)
    const resolved = segments ? resolveType(segments, decl.parent, ctx.topLevel) : null
    if (resolved?.kind === 'class') found = resolved
  }
  superclasses.set(decl, found)
  return found
}

// 형식과 같은 파일의 상위 클래스들(가까운 것부터). 순환(컴파일 오류)이면 멈춘다.
function classChain(ctx: Context, decl: TypeDecl): TypeDecl[] {
  const chain = [decl]
  for (
    let next = superclassOf(ctx, decl);
    next && !chain.includes(next);
    next = superclassOf(ctx, next)
  )
    chain.push(next)
  return chain
}

// Dashboard가 보는 필드(keep으로 거른 것). getFields()는 자기 필드, 그다음 상위 클래스의 필드 순이고, Dashboard는 이름을
// 키로 HashMap에 넣으므로 같은 이름이면 나중에 넣은 것(가장 위 상위 클래스의 것)이 남는다. 순서는 자기 필드부터다.
function chainFields(chain: readonly TypeDecl[], keep: (field: FieldDecl) => boolean): FieldDecl[] {
  const byName = new Map<string, FieldDecl>()
  for (const decl of chain) {
    for (const field of decl.fields) {
      if (!keep(field)) continue
      byName.delete(field.name)
      byName.set(field.name, field)
    }
  }
  return [...byName.values()]
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
  // 한 줄 입력칸은 CR·LF를 지우므로, 고치면 어떤 편집이든 줄바꿈이 빠진 문자열을 쓴다
  if (type === 'String' && /[\r\n]/.test(decodeJavaQuoted(parser.tx(last)) ?? ''))
    return { editable: false, reason: 'lineBreak' }
  return { editable: true }
}

// --- static 블록 ---

const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<='])

// 한정자 이름 조각(a.b, scope 안에서 푼다)이 가리킬 수 있는 targets의 순번(없으면 -1): 이 파일의 형식으로 풀리면 그
// 형식, 풀리지 않으면 마지막 조각과 이름이 같은 것(패키지로 한정한 이름). 지역 변수·다른 형식(other.kP)은 아니다.
function qualifierTarget(
  ctx: Context,
  scope: TypeDecl,
  targets: readonly TypeDecl[],
  segments: readonly string[]
): number {
  const resolved = resolveType(segments, scope, ctx.topLevel)
  if (resolved) return targets.indexOf(resolved)
  return targets.findIndex((target) => target.name === segments[segments.length - 1])
}

// 이름 토큰(i) 앞의 한정자(a.b.)를 모은다. start는 한정자의 첫 토큰이고, expression은 식으로 한정한 것(f().kP,
// a[0].kP)이라 무엇을 가리키는지 알 수 없다는 뜻이다.
function qualifierOf(
  parser: Parser,
  i: number
): { start: number; segments: string[]; expression: boolean } {
  let start = i
  const segments: string[] = []
  while (parser.isOp(start - 1, '.') && parser.isIdent(start - 2)) {
    segments.unshift(parser.tx(start - 2))
    start -= 2
  }
  return { start, segments, expression: parser.isOp(start - 1, '.') }
}

// 이름 토큰(i)이 지역 변수·매개변수 선언의 이름인지: 앞이 형식의 끝(이름, 기본형, '>', ']')이고 뒤가 선언이 이어지는 글자
function declaresLocal(parser: Parser, i: number): boolean {
  const before = i - 1
  const typeEnd =
    (parser.isIdent(before) && parser.tx(before) !== 'yield') ||
    (parser.kind(before) === 'keyword' && PRIMITIVES.has(parser.tx(before))) ||
    parser.isOp(before, '>') ||
    parser.isOp(before, ']')
  return typeEnd && ['=', ';', ',', ':', ')'].some((op) => parser.isOp(i + 1, op))
}

// 한정자 시작(start)부터 이름(i)까지가 대입·증감의 대상인지(괄호로 감싼 (kP) = 1 포함). 렉서는 '>'를 한 글자씩 내므로
// '>>='·'>>>='는 '>' 뒤의 '>='다.
function assignedAt(parser: Parser, start: number, i: number): boolean {
  let before = start - 1
  let after = i + 1
  while (parser.isOp(before, '(') && parser.isOp(after, ')')) {
    before--
    after++
  }
  if (parser.isOp(before, '++') || parser.isOp(before, '--')) return true
  if (parser.kind(after) !== 'operator') return false
  const op = parser.tx(after)
  if (ASSIGNMENT_OPERATORS.has(op) || op === '++' || op === '--') return true
  return (
    op === '>' &&
    (parser.isOp(after + 1, '>=') || (parser.isOp(after + 1, '>') && parser.isOp(after + 2, '>=')))
  )
}

// 형식마다 필드 이름 집합을 한 번 만든다(가림 확인이 이름이 나올 때마다 돈다)
const fieldNameSets = new WeakMap<TypeDecl, Set<string>>()

function declaresField(decl: TypeDecl, name: string): boolean {
  let names = fieldNameSets.get(decl)
  if (!names) {
    names = new Set(decl.fields.map((field) => field.name))
    fieldNameSets.set(decl, names)
  }
  return names.has(name)
}

// 한정자 시작(start)부터 이름(i)까지에 이어진 멤버 읽기(PARAMS.kS, PARAMS.pid.kP)인지: 뒤에 .이름이 하나 이상 있고,
// 마지막 멤버가 대입·증감·호출(.reset())·첨자([0])·메서드 참조(::)가 아니다. 객체를 읽기만 하는 코드(X = PARAMS.kS)는
// 객체의 값을 정하지 않는다.
function memberRead(parser: Parser, start: number, i: number): boolean {
  let j = i
  while (parser.isOp(j + 1, '.') && parser.isIdent(j + 2)) j += 2
  return (
    j !== i &&
    !parser.isOp(j + 1, '(') &&
    !parser.isOp(j + 1, '[') &&
    !parser.isOp(j + 1, '::') &&
    !assignedAt(parser, start, j)
  )
}

// 클래스를 초기화할 때 도는 코드(staticBlockNames)가 그 필드를 정하는지. 값 필드는 대입·증감, 객체 필드(anyUse)는 멤버를
// 읽기만 하는 것(X = PARAMS.kS)이 아니면 나오기만 해도(PARAMS.kS = 1, f(PARAMS), PARAMS.reset()) 정하는 것으로 본다. 람다·익명 클래스 안도 같다. 같은 이름의 지역 변수 선언과 다른 이름으로
// 한정한 것(other.kP)은 빼고, 식으로 한정한 것(f().kP)은 알 수 없으므로 넣는다. 지역 변수의 범위는 따지지 않으므로 그
// 지역 변수에 대입한 것도 필드로 본다(애매하면 읽기 전용).
// below는 선언한 형식의 하위 클래스들(묶음의 클래스부터 선언한 형식 바로 아래까지, classChain 순서)이고 그 static 블록도
// 본다. 하위 클래스 블록의 단순 이름은 그 클래스에서 선언한 형식까지 사이의 클래스가 같은 이름의 필드(static 여부·접근
// 한정자와 관계없음)로 가리지 않을 때만 이 필드다. 한정한 이름도 같다(DriveConstants.X, CompBot.X).
function setInStaticBlock(
  ctx: Context,
  field: FieldDecl,
  anyUse: boolean,
  below: readonly TypeDecl[] = []
): boolean {
  const { parser } = ctx
  const owner = field.owner
  for (let level = 0; level <= below.length; level++) {
    // 블록이 있는 형식부터 선언한 형식까지(가까운 것부터)
    const targets = [...below.slice(level), owner]
    const scope = targets[0]
    const occurrences = staticBlockNames(ctx, scope).get(field.name)
    if (!occurrences) continue
    // hidden[k]: targets[k]부터 선언한 형식 바로 위까지 사이의 클래스가 같은 이름의 필드로 가린다(한 번만 계산)
    const hidden: boolean[] = new Array(targets.length).fill(false)
    for (let k = targets.length - 2; k >= 0; k--)
      hidden[k] = hidden[k + 1] || declaresField(targets[k], field.name)
    const hiddenFrom = (index: number): boolean => hidden[index]
    for (const i of occurrences) {
      const { start, segments, expression } = qualifierOf(parser, i)
      if (!expression) {
        if (segments.length > 0) {
          const target = qualifierTarget(ctx, scope, targets, segments)
          if (target < 0 || hiddenFrom(target)) continue
        } else if (hiddenFrom(0) || declaresLocal(parser, i)) continue
      }
      if (anyUse ? !memberRead(parser, start, i) : assignedAt(parser, start, i)) return true
    }
  }
  return false
}

// 호출 이름 토큰(i, 뒤가 '(')이 decl의 메서드를 부를 수 있는지: 한정자가 없거나(new T()는 뺀다) decl로 한정한 것
function callsOwnMethod(ctx: Context, decl: TypeDecl, i: number): boolean {
  const { parser } = ctx
  const { segments, expression } = qualifierOf(parser, i)
  if (expression) return false
  if (segments.length === 0) return !parser.isKeyword(i - 1, 'new')
  return qualifierTarget(ctx, decl, [decl], segments) === 0
}

// 초기값·본문 안의 new 이름(위치 i, 뒤가 '(')이 decl을 만드는지(익명 하위 클래스 new T() {…}도 T의 생성자를 부른다)
function constructsOwnType(ctx: Context, decl: TypeDecl, i: number): boolean {
  const { parser } = ctx
  if (!parser.isKeyword(i, 'new')) return false
  const segments: string[] = []
  let j = i + 1
  while (parser.isIdent(j)) {
    segments.push(parser.tx(j))
    if (!parser.isOp(j + 1, '.')) break
    j += 2
  }
  if (segments.length === 0 || !parser.isOp(j + 1, '(')) return false
  return resolveType(segments, decl, ctx.topLevel) === decl
}

// 클래스를 초기화할 때 도는 코드의 토큰 범위: static 블록, static 필드 초기값, 그리고 이들이 부르는 같은 형식의 static
// 메서드 본문(그 본문이 부르는 것도 차례로 따라간다)과 new T(…)가 돌리는 T의 생성자·인스턴스 초기화 블록(싱글턴
// INSTANCE = new T()). 오버로드는 이름이 같으면 모두 보고, 생성자는 인자와 관계없이 모두 본다. 인스턴스 메서드·
// 메서드 참조·다른 형식의 메서드는 따라가지 않는다.
function staticInitRanges(ctx: Context, decl: TypeDecl): { start: number; end: number }[] {
  const { parser } = ctx
  const ranges = [
    ...decl.staticBlocks,
    ...decl.fields.flatMap((field) => (isStatic(field) && field.init ? [field.init] : []))
  ]
  const seeds = [...ranges]
  const followed = new Set<string>()
  let constructed = false
  for (let k = 0; k < seeds.length; k++) {
    const { start, end } = seeds[k]
    for (let i = start; i < end; i++) {
      if (!constructed && decl.instanceInits.length > 0 && constructsOwnType(ctx, decl, i)) {
        constructed = true
        ranges.push(...decl.instanceInits)
        seeds.push(...decl.instanceInits)
        continue
      }
      if (!parser.isIdent(i) || !parser.isOp(i + 1, '(')) continue
      const name = parser.tx(i)
      const bodies = decl.staticMethods.get(name)
      if (!bodies || followed.has(name) || !callsOwnMethod(ctx, decl, i)) continue
      followed.add(name)
      ranges.push(...bodies)
      seeds.push(...bodies)
    }
  }
  return ranges
}

// 클래스를 초기화할 때 도는 코드(staticInitRanges)에 나오는 이름 → 토큰 위치들(형식마다 한 번 만든 표)
const staticNameTables = new WeakMap<TypeDecl, Map<string, number[]>>()

function staticBlockNames(ctx: Context, decl: TypeDecl): Map<string, number[]> {
  const { parser } = ctx
  let table = staticNameTables.get(decl)
  if (table) return table
  table = new Map()
  for (const block of staticInitRanges(ctx, decl)) {
    for (let i = block.start; i < block.end; i++) {
      if (!parser.isIdent(i)) continue
      const name = parser.tx(i)
      const list = table.get(name)
      if (list) list.push(i)
      else table.set(name, [i])
    }
  }
  staticNameTables.set(decl, table)
  return table
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

// forced: 바깥 객체 형식의 생성자·초기화 블록이나 static 블록이 값을 정할 수 있다(자식 값을 모두 읽기 전용으로 둔다).
// below: 맨 위 필드를 보이는 묶음의 클래스 사슬에서 선언한 형식 아래의 클래스들(그 static 블록도 본다, setInStaticBlock)
function makeNode(
  ctx: Context,
  field: FieldDecl,
  depth: number,
  stack: readonly TypeDecl[],
  forced: boolean,
  below: readonly TypeDecl[] = []
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
    // 초기값을 고쳐도 실행할 때의 값이 바뀌지 않는다(다른 이유보다 먼저 보인다)
    if (forced || (isStatic(field) && setInStaticBlock(ctx, field, false, below))) {
      return { ...base, literal: initText, span, editable: false, reason: 'initializedInType' }
    }
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
  // 바깥 객체의 생성자 등이나 static 블록이 이 객체를 바꾸거나 만들 수 있다
  const initialized = forced || (isStatic(field) && setInStaticBlock(ctx, field, true, below))
  if (!field.init || !span) {
    return { ...object, children: [], reason: initialized ? 'initializedInType' : 'noInitializer' }
  }
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
    depth < MAX_OBJECT_DEPTH &&
    !stack.includes(decl)
  if (!expandable) return { ...object, children: [], reason: 'object' }
  const chain = classChain(ctx, decl)
  // 생성자·인스턴스 초기화 블록이 필드를 다시 정할 수 있다. new T()는 가장 위 상위 클래스부터 클래스마다 인스턴스
  // 초기화(필드 초기값·초기화 블록)와 생성자 본문을 차례로 돌리므로, 자식을 선언한 클래스와 그 아래(T 쪽) 클래스의 것만
  // 그 자식의 초기값을 덮어쓸 수 있다(위 클래스 생성자가 하위 메서드를 불러 정해도 뒤의 필드 초기값이 이긴다).
  const children = chainFields(
    chain,
    (child) => child.modifiers.keywords.has('public') && !isStatic(child)
  ).map((child) => {
    const upToOwner = chain.slice(0, chain.indexOf(child.owner) + 1)
    const byInit = upToOwner.some((type) => type.hasConstructor || type.hasInstanceInit)
    return makeNode(ctx, child, depth + 1, [...stack, decl], initialized || byInit)
  })
  return { ...object, children }
}

// 같은 id는 같은 선언이고 렌더러는 처음 것만 본다(tunableNodes). 생성자 등이 정하는 경로가 하나라도 있으면 그 값 칸을
// 모든 경로에서 읽기 전용으로 둔다(그 리터럴을 고쳐도 그 경로의 값은 바뀌지 않고, 칸마다 고칠 수 있는지가 달라지지 않게).
function unifyForced(blocks: TunableBlock[]): TunableBlock[] {
  const forcedIds = new Set<string>()
  const collect = (node: TunableNode): void => {
    if (node.kind === 'value' && node.reason === 'initializedInType') forcedIds.add(node.id)
    if (node.kind === 'object') node.children.forEach(collect)
  }
  blocks.forEach((block) => block.fields.forEach(collect))
  if (forcedIds.size === 0) return blocks
  const apply = (node: TunableNode): TunableNode => {
    if (node.kind === 'object') return { ...node, children: node.children.map(apply) }
    if (node.kind !== 'value' || !forcedIds.has(node.id) || node.reason === 'initializedInType')
      return node
    return { ...node, editable: false, reason: 'initializedInType' }
  }
  return blocks.map((block) => ({ ...block, fields: block.fields.map(apply) }))
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
    // 자기 필드 뒤에 같은 파일의 상위 클래스 필드(getFields). 물려받은 필드는 그 아래 클래스들의 static 블록도 본다.
    const chain = classChain(ctx, decl)
    const fields = chainFields(chain, isTopLevelTunable)
    blocks.push({
      classPath: decl.path,
      name: alternative ? alternative : decl.name,
      line: lineAt(ctx.lineStarts, parser.tokens[decl.nameToken].start),
      fields: fields.map((field) =>
        makeNode(ctx, field, 0, [], false, chain.slice(0, chain.indexOf(field.owner)))
      )
    })
  }
  return {
    blocks: unifyForced(blocks),
    unicodeEscapes: lexed.unsafeUnicodeEscape,
    staticFieldsWithoutConfig
  }
}
