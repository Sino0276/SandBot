// 파일 하나의 씬과 관계없는 사실(spec §4, §6.2). 워커 안에만 있고 stamp(size:mtimeMs)로 캐시한다.
// 씬 기호표(usageSymbols)와 맞추는 일(usageResolve.ts)은 이 사실만 읽으므로, 이름을 바꿔도 파일을 다시 읽지 않는다.
//
// 만드는 순서:
// - 렉서(lexJava). 리터럴 밖에 \u 이스케이프가 있으면 토큰을 믿을 수 없으므로 빈 사실 + skipped 'unicodeEscape'다.
//   주석은 토큰이 아니라 주석을 사이에 둔 연쇄(robot . /* c */ lift)도 이어지고, 주석 안 글자는 사용처가 아니다.
// - 패스 A(개요): 패키지·import, 형식 선언(클래스·인터페이스·enum·애너테이션)과 그 멤버(필드·메서드·멤버 형식)를
//   재귀로 읽는다(괄호 짝을 미리 구해 두어 몸통을 O(1)에 건너뛴다). 메서드 몸통·초기화 블록·필드 초기값·enum 상수
//   인자·애너테이션 인자는 패스 B 범위로 남긴다.
// - 패스 B(몸통): 범위마다 토큰을 한 번 훑으며 지역 변수 범위(프레임)를 쌓고, 연쇄(chains)·형식 사용(typeUses)·
//   문자열(strings)을 모은다. 익명·지역 클래스는 만나는 자리에서 패스 A로 개요를 만들고 그 멤버 몸통을 범위로 더한다.
//   재귀는 클래스 중첩만큼만 하고(MAX_CLASS_DEPTH), 블록·괄호 중첩은 스택으로 다룬다.
// - 지역 변수 범위(프레임): 블록 '{…}'(switch 블록은 모든 case에 걸친 하나), for 머리(몸통 끝까지, 중괄호 없는 몸통
//   포함), catch 매개변수(그 catch 블록만, finally는 밖), try 자원(try 블록까지), 람다 매개변수(몸통 끝까지, 식 몸통은
//   짝이 없는 첫 , ) ] } ;까지), 메서드 매개변수. 지역 변수 선언은 문장 자리에서만 알아보고([final|@A]* Type Ident 뒤가
//   = ; , [ 또는 for 머리의 :), 그 이름은 선언자에 이르면 보인다(자기 초기값 포함, 이어 쓴 선언자도 같은 형식).
//   형식 없는 람다 매개변수·합 형식 catch·기본형은 형식이 null이지만 같은 이름의 필드를 가린다.
//
// 메모리 규칙: 사실에는 파일 글자의 조각을 두지 않는다(V8의 잘린 문자열은 파일 전체를 붙잡는다, 71 MB 대 23 MB).
// 모든 이름·스니펫은 intern(복사)을 거치고, 줄·열은 만들 때 계산해 둔다. 커서(토큰 글자)는 끝나면 버린다.
//
// 어떤 입력에도 예외를 던지지 않는다(extractFacts가 마지막으로 감싸 capped로 둔다). 한도(MAX_FACTS 등)를 넘는
// 파일은 빈 사실 + skipped 'capped'다(찾지 않은 파일로 센다).
import { decodeJavaQuoted, lineAt } from '../../../../shared/java/lexer'
import {
  createInterner,
  isPrimitiveRef,
  UsageCursor,
  type ParsedType,
  type TypeRef
} from './usageCursor'

export type { TypeRef } from './usageCursor'

// ───────────────────────────── 사실의 모양 (usageResolve.ts가 읽는다) ─────────────────────────────

// 형식 이름을 푸는 범위 하나. TypeRef.scope와 ClassFacts.typeScope가 이 배열(FileFacts.typeScopes)의 번호다.
// - cls: 이 단계에서 멤버 형식·필드를 보여 주는 클래스 번호. -1이면 형식 매개변수만 있는 단계다(파일, 클래스 머리의
//   형식 매개변수, 메서드의 형식 매개변수, 블록 안의 지역 클래스 이름).
// - params: 이 단계의 형식 이름 → 첫 경계(<T extends RobotHardware>면 RobotHardware, 경계가 없으면 null).
//   null은 "알 수 없는 형식"이다: 경계 없는 형식 매개변수와, 블록 안에 선언된 지역 클래스 이름(바깥의 같은 이름을
//   가린다)이 여기에 들어간다.
// - parent: 바깥 단계(-1이면 없음). 0번은 늘 파일 단계({cls: -1, params: 빈 표, parent: -1})다.
// - more: 경계가 둘 이상인 형식 매개변수 → 둘째부터의 경계(<R extends RobotHardware & Runnable>의 R → Runnable).
//   첫 경계에 없는 멤버(r.run())는 그 경계의 것일 수 있다. 없으면 그런 매개변수가 없다.
// 풀 때는 안쪽부터 parent를 따라가며 params와 cls의 멤버 형식(선언·상속)을 차례로 보고, 그다음 파일·import·패키지
// 순서로 본다(JLS 6.4.1, 7.5). 클래스의 몸통 단계 부모는 그 클래스의 머리 단계(형식 매개변수)라, 상위 형식(extends)은
// 자기 멤버 형식이 보이지 않는 머리 단계(superRef.scope)에서 푼다.
export type TypeScope = {
  cls: number
  params: Map<string, TypeRef | null>
  parent: number
  more?: Map<string, TypeRef[]>
}

export type Access = 'public' | 'protected' | 'package' | 'private'

// 초기값이 문자열 리터럴 하나인 필드(static final String LF = "leftFront";)의 그 리터럴. 찾기 인자로 쓰인 이름
// (hardwareMap.get(…, LF))을 풀면 이 자리가 찾기 사용처가 된다. value는 푼 글자의 앞뒤 공백을 뺀 것(1..128자),
// snippet은 'LF = "leftFront"'처럼 그 줄에 보일 글자, mark는 snippet 안의 리터럴 [시작, 끝).
export type StringLit = {
  value: string
  line: number
  col: number
  snippet: string
  mark: [number, number]
}

// type: 선언한 형식(기본형과 그 배열은 null. 필드가 있다는 것만으로 바깥 이름을 가린다).
// 인터페이스 필드와 enum 상수는 public static이다.
export type FieldFacts = {
  type: TypeRef | null
  access: Access
  isStatic: boolean
  stringLit?: StringLit
}

// ret: 반환 형식(void·기본형은 null). 생성자는 넣지 않는다.
export type MethodFacts = { ret: TypeRef | null; access: Access; isStatic: boolean }

export type ClassFacts = {
  // null: 익명 클래스(enum 상수 몸통 포함)
  name: string | null
  kind: 'class' | 'interface' | 'enum' | 'annotation'
  // 감싸는 클래스 번호(최상위는 -1). 지역·익명 클래스는 그것이 있는 메서드·초기값의 클래스다.
  outer: number
  // 지역·익명 클래스: 이름으로 풀 수 없다(형식 표에 넣지 않는다). 바깥 클래스의 members에도 없다.
  local: boolean
  // class의 extends(머리 단계에서 푼다). 익명 클래스는 new T(…) {…}의 T(인터페이스일 수도 있다), enum 상수 몸통은
  // 그 enum. interface·enum·annotation은 null.
  superRef: TypeRef | null
  // class·enum의 implements, interface의 extends
  ifaceRefs: TypeRef[]
  // 선언한 필드(같은 이름이 둘이면 처음 것). 상속한 것은 resolver가 상위 형식에서 찾는다.
  fields: Map<string, FieldFacts>
  // 이름 → 오버로드들
  methods: Map<string, MethodFacts[]>
  // 선언한 멤버 형식 이름 → 클래스 번호
  members: Map<string, number>
  // 지역·익명 클래스: 선언한 자리에서 보이던 지역 변수(안쪽 것이 이긴다, 바깥 클래스 프레임까지). 그 밖은 null.
  // 이 클래스 안의 이름(name 머리)은 자기 필드(선언·상속) 다음에 이것을 보고, 그다음 outer로 간다(JLS 6.4.1).
  captured: Map<string, TypeRef | null> | null
  // 몸통 단계(cls가 이 클래스인 TypeScope)
  typeScope: number
}

// 연쇄의 머리. cls는 그 자리를 감싸는 가장 안쪽 클래스 번호다.
// - local: 지역 변수·매개변수(가장 안쪽 프레임부터 바깥 클래스 프레임까지 찾은 것). type null은 형식 없는 람다
//   매개변수, catch의 합 형식, 기본형이다(그래도 같은 이름의 필드를 가린다).
// - name: 지역이 아닌 이름. 필드 → 잡힌 지역(captured) → 바깥 클래스 → static import → 형식 → 패키지 순으로 푼다.
// - call: 한정 없는 메서드 호출 m(…)(그 반환 형식에서 이어진다)
// - this·super: this.f, super.f(Outer.this.f는 cls가 그 바깥 클래스인 this)
// - new: new T(…)(본문이 있으면 anon이 그 익명 클래스 번호)
// - cast: ((T) e).f 꼴만
export type Head =
  | { k: 'local'; type: TypeRef | null; name: string }
  | { k: 'name'; name: string; cls: number }
  | { k: 'call'; name: string; cls: number }
  | { k: 'this'; cls: number }
  | { k: 'super'; cls: number }
  | { k: 'new'; type: TypeRef; anon: number | null }
  | { k: 'cast'; type: TypeRef }

// 연쇄의 '.이름' 하나. call은 뒤에 (…)가 붙은 메서드 호출, index는 뒤에 붙은 […]의 수(배열 원소)다.
// line·col은 이름 토큰의 위치(1부터, 열은 UTF-16).
export type Seg = { name: string; line: number; col: number; call: boolean; index: number }

// 머리에서 '.이름'(·'.<T>이름(…)'·'[…]')으로 이어지는 연쇄 하나. '::'·'.new'·'.this'·'.class'·그 밖의 토큰에서
// 끝난다. headIndex는 머리 뒤의 […] 수(arr[0].liftLeft), line·col은 머리 토큰의 위치(name 머리가 곧 생성 필드일 때의
// 사용처 자리, MyRobot 안의 leftFront). text는 스니펫용 머리 글자('robot', 'getRobot(…)', 'this', 'new RobotHardware(…)',
// '((RobotHardware.Lift) …)')이고, resolver가 뒤에 '.name'·'(…)'·'[…]'를 붙여 스니펫을 만든다.
// 세그먼트는 MAX_SEGMENTS개까지만 둔다(그 뒤는 생성 멤버일 수 없다).
// 남기는 연쇄: name 머리는 세그먼트가 없어도(그 이름이 상속·static import한 생성 필드일 수 있다), 그 밖의 머리는
// 세그먼트가 있을 때만.
export type Chain = {
  head: Head
  headIndex: number
  line: number
  col: number
  segs: Seg[]
  text: string
}

// 형식 사용의 자리:
// - decl: 필드·지역 변수·매개변수(람다·catch·for 포함)·반환 형식·throws, 배열 생성(new T[n])의 원소 형식
// - new: new T(…)(생성자 호출. 익명 클래스 포함)
// - cast, instanceof, classLit(T.class), methodRef(T::m, T::new)
// - extends: extends·implements, 형식 매개변수의 경계
// - typeArg: 다른 형식·호출의 형식 인자(List<RobotHardware.Lift>, Foo.<RobotHardware>bar())
// - import: import 선언(importUses에만, 풀리지 않을 때만 보인다)
export type TypeUseContext =
  | 'decl'
  | 'new'
  | 'cast'
  | 'extends'
  | 'instanceof'
  | 'typeArg'
  | 'classLit'
  | 'methodRef'
  | 'import'

// 형식 하나의 사용. ref.names의 k번째 이름은 positions[k](줄, 열)에 있고 snippet의 marks[k]([시작, 끝))에 보인다.
// line·col은 마지막 이름의 위치(보통의 사용처 자리)다. snippet 예: 'RobotHardware.Lift lift', 'new RobotHardware(…)',
// '(RobotHardware.Lift) …', 'extends RobotHardware', 'RobotHardware.Lift.class', 'import org.…RobotHardware'.
// 형식 인자는 같은 자리의 typeArg 사용으로 따로 둔다(스니펫에서는 '<…>'로 줄인다).
// importKind는 import에만: single(import a.B), onDemand(import a.*), static(import static a.B.m),
// staticOnDemand(import static a.B.*). ref.names는 '*' 없는 전체 이름이다.
export type TypeUse = {
  ref: TypeRef
  ctx: TypeUseContext
  line: number
  col: number
  snippet: string
  positions: [number, number][]
  marks: [number, number][]
  importKind?: 'single' | 'onDemand' | 'static' | 'staticOnDemand'
}

// 문자열 리터럴 하나(애너테이션 괄호 안은 빼고). value는 푼 글자의 앞뒤 공백을 뺀 것(1..128자, 빈 것·긴 것은 버린다).
// - lookup: 구성 이름으로 장치를 찾는 인자. 호출의 온전한 인자이고, 메서드 이름이 Name으로 끝나거나, 받는 쪽 연쇄에
//   HardwareMap 식이 있거나, 같은 호출의 다른 온전한 인자가 HardwareMap 식이다(spec §1.3). 그런 인자로 쓴 이름이
//   같은 파일의 String 지역 변수·필드(초기값이 리터럴 하나)면 그 초기값 리터럴도 lookup이다.
// - text: 그 밖의 같은 글자(세지 않고 접어 둔다)
// 다른 파일의 상수(Constants.LF)는 resolver가 lookupRefs를 풀어 그 파일의 text 리터럴 자리에 lookup을 낸다. 같은
// 자리의 text와 lookup은 lookup이 이긴다.
// snippet 예: 'hardwareMap.get(…, "liftLeft")', 'new MotorEx(…, "fl")', 'LF = "leftFront"', '"arm"'. mark는 그 안의
// 리터럴 [시작, 끝).
export type StringUse = {
  value: string
  tier: 'lookup' | 'text'
  line: number
  col: number
  snippet: string
  mark: [number, number]
}

export type FileFacts = {
  // package 선언(없으면 '')
  pkg: string
  imports: {
    // 단순 이름 → 전체 이름(같은 단순 이름이 둘이면 처음 것)
    single: Map<string, string[]>
    // import a.b.*; → ['a', 'b'] (패키지일 수도 형식일 수도 있다)
    onDemand: string[][]
    // import static a.B.m; → m → [['a', 'B', 'm'], …](같은 이름이 여러 형식에서 올 수 있다)
    staticSingle: Map<string, string[][]>
    // import static a.B.*; → ['a', 'B']
    staticOnDemand: string[][]
  }
  // import마다 하나(ctx 'import'). 풀리지 않는 import만 보인다.
  importUses: TypeUse[]
  classes: ClassFacts[]
  typeScopes: TypeScope[]
  chains: Chain[]
  typeUses: TypeUse[]
  strings: StringUse[]
  // 찾기 호출의 인자인 이름(LF, Constants.LF, this.LF). 같은 파일에서 풀린 것(지역 변수, 감싸는 클래스의 필드)은 이미
  // strings의 lookup이 됐고, 남은 것만 있다. resolver가 연쇄로 풀어 끝이 stringLit이 있는 팀 필드면 그 리터럴 자리에
  // lookup을 낸다. 같은 연쇄 객체가 chains에도 있을 수 있다.
  lookupRefs: Chain[]
  // unicodeEscape: 리터럴 밖 \u(토큰을 믿을 수 없음), capped: 한도를 넘음. 둘 다 나머지 칸은 비어 있다.
  skipped?: 'unicodeEscape' | 'capped'
}

// ───────────────────────────── 한도 ─────────────────────────────

// 연쇄 하나의 세그먼트 수. 넘는 세그먼트는 버린다(빌더 연쇄 drive.actionBuilder(…).…는 길어도 생성 멤버는 앞쪽뿐).
export const MAX_SEGMENTS = 32
// 파일 하나의 연쇄·형식 사용·문자열·클래스 수. 넘으면 파일 전체를 capped로 둔다.
export const MAX_FACTS = 20_000
// 익명·지역 클래스가 잡은 지역 변수 수의 합(지역 변수 수 × 익명 클래스 수가 제곱으로 커지지 않게)
const MAX_CAPTURED = 100_000
// 클래스 중첩(재귀) 깊이
const MAX_CLASS_DEPTH = 48
// 문자열 값의 길이 한도(구성 이름은 짧다)
const MAX_STRING_LENGTH = 128
// 스니펫의 받는 쪽 글자 한도(넘으면 앞을 '…'로 줄인다)
const MAX_RECEIVER_TEXT = 48

class CapError extends Error {}

export function emptyFacts(skipped?: FileFacts['skipped']): FileFacts {
  return {
    pkg: '',
    imports: { single: new Map(), onDemand: [], staticSingle: new Map(), staticOnDemand: [] },
    importUses: [],
    classes: [],
    typeScopes: [{ cls: -1, params: new Map(), parent: -1 }],
    chains: [],
    typeUses: [],
    strings: [],
    lookupRefs: [],
    ...(skipped ? { skipped } : {})
  }
}

// Java 소스 → 사실. 예외를 던지지 않는다. 리터럴 밖 \u가 있으면 빈 사실 + skipped 'unicodeEscape'.
// intern을 넘기면 여러 파일이 같은 표를 쓴다. 넘기지 않으면 파일마다 새 표다(기본). 표를 오래 나눠 쓰면 같은 이름이
// 한 번만 남지만, 바뀐 파일의 옛 스니펫도 표에 계속 남는다.
export function extractFacts(text: string, intern?: (value: string) => string): FileFacts {
  try {
    return extractFactsOrThrow(text, intern)
  } catch {
    // 여기까지 오면 안 된다(퍼즈 테스트가 extractFactsOrThrow로 확인한다). 와도 파일 하나만 빠진다.
    return emptyFacts('capped')
  }
}

// 테스트용: 한도 밖(capped)이 아닌 예외를 그대로 던진다
export function extractFactsOrThrow(text: string, intern?: (value: string) => string): FileFacts {
  const cursor = new UsageCursor(text, intern ?? createInterner())
  if (cursor.lex.unsafeUnicodeEscape) return emptyFacts('unicodeEscape')
  try {
    return new Extractor(cursor, text.charCodeAt(0) === 0xfeff).run()
  } catch (error) {
    if (error instanceof CapError) return emptyFacts('capped')
    throw error
  }
}

// ───────────────────────────── 구현 ─────────────────────────────

const MODIFIERS = new Set([
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

// 지역 클래스 앞에 올 수 있는 수식어
const LOCAL_CLASS_MODIFIERS = new Set(['final', 'abstract', 'static', 'strictfp'])

// 식 자리에서 만나도 문장으로 읽는 키워드
const STATEMENT_KEYWORDS = new Set([
  'if',
  'while',
  'for',
  'do',
  'switch',
  'synchronized',
  'try',
  'catch',
  'finally',
  'else',
  'case',
  'break',
  'continue'
])

// 캐스트 뒤에 올 수 있는 피연산자의 첫 토큰 종류(+·-는 기본형 캐스트와 덧셈을 가를 수 없어 넣지 않는다)
const OPERAND_KINDS = new Set([
  'identifier',
  'string',
  'char',
  'integer',
  'floating',
  'boolean',
  'null'
])

type Modifiers = { access: Access | null; isStatic: boolean; end: number }

// 패스 B가 훑을 범위 [start, end). body면 '{'에서 시작하는 블록(문장 자리), 아니면 식(필드 초기값, enum 상수 인자).
// annotation이면 애너테이션 인자 '(…)'의 안이다(요소 이름과 문자열은 사실로 두지 않는다).
type Range = {
  start: number
  end: number
  cls: number
  scope: number
  params: Map<string, TypeRef | null> | null
  body: boolean
  annotation?: true
}

// 지역 변수 프레임. strs는 초기값이 문자열 리터럴 하나인 변수 → 그 리터럴 토큰(찾기 인자로 쓰이면 lookup).
// end에 이르면 닫힌다. scope는 이 프레임 안의 형식 범위(지역 클래스를 선언하면 바뀐다).
type Frame = {
  vars: Map<string, TypeRef | null>
  strs: Map<string, number> | null
  end: number
  scope: number
}

// 호출 하나의 인자 상태(스니펫과 문자열 등급용)
type CallInfo = { name: string; receiverText: string; receiverHw: boolean }
type CallState = CallInfo & {
  argStart: number
  argIndex: number
  hwArg: boolean
  literals: StringUse[]
  nameArgs: HeadInfo[]
}

type BracketRole =
  'block' | 'lambda' | 'array' | 'call' | 'header' | 'forHeader' | 'resources' | 'paren' | 'index'

type Bracket = { open: number; role: BracketRole; call?: CallState }

// 머리 토큰에서 읽은 연쇄(인자 분석용). end는 연쇄 다음 토큰, plain은 호출·첨자 없는 이름만의 연쇄,
// hwHead는 머리가 HardwareMap 식, hwLast는 마지막 세그먼트가 HardwareMap 식(hardwareMap 필드, this.hwMap).
type HeadInfo = {
  head: Head
  headTok: number
  chain: Chain | null
  segs: number
  end: number
  plain: boolean
  hwHead: boolean
  hwLast: boolean
  frame: Frame | null
}

type Decl = { type: TypeRef | null; depth: number }

function isHardwareMapType(type: TypeRef | null | undefined): boolean {
  return !!type && type.dims === 0 && type.names[type.names.length - 1] === 'HardwareMap'
}

function typeText(ref: TypeRef): string {
  return ref.names.join('.') + (ref.args.length ? '<…>' : '') + '[]'.repeat(ref.dims)
}

function clipLeft(value: string, max: number): string {
  return value.length <= max ? value : `…${value.slice(value.length - max + 1)}`
}

class Extractor {
  readonly c: UsageCursor
  readonly intern: (value: string) => string
  private readonly lineStarts: number[]
  private readonly facts = emptyFacts()
  private readonly ranges: Range[] = []
  private depth = 0
  private captured = 0
  // 연쇄 미리 보기가 정한 호출 괄호 → 호출 이름·받는 쪽
  readonly callAt = new Map<number, CallInfo>()
  // new T(…) 다음 '{' → 익명 클래스로 만들 정보
  readonly anonAt = new Map<number, { ref: TypeRef; head: Extract<Head, { k: 'new' }> }>()
  readonly lambdaBlockAt = new Set<number>()
  // 본 훑기가 이 토큰에 이르면 건너뛸 곳(미리 보기가 형식으로 읽은 토큰: List<String>::size의 <String>)
  readonly jumpAt = new Map<number, number>()
  readonly headAt = new Map<number, HeadInfo>()
  // 문자열 토큰 → 만든 사용, 아직 만들지 않았지만 lookup으로 둘 토큰
  readonly stringAt = new Map<number, StringUse>()
  readonly forcedLookup = new Set<number>()
  // 필드의 stringLit 토큰
  readonly fieldLitTok = new Map<FieldFacts, number>()

  constructor(cursor: UsageCursor, bom: boolean) {
    this.c = cursor
    this.intern = cursor.intern
    // BOM은 편집기가 열로 세지 않는다
    this.lineStarts = bom ? [1, ...cursor.lex.lineStarts.slice(1)] : cursor.lex.lineStarts
  }

  run(): FileFacts {
    this.parseFile()
    for (let r = 0; r < this.ranges.length; r++) new Walker(this, this.ranges[r]).run()
    return this.facts
  }

  // ── 공용 ──

  pos(tok: number): [number, number] {
    const offset = this.c.tokens[tok]?.start ?? 0
    const line = lineAt(this.lineStarts, offset)
    return [line, offset - this.lineStarts[line - 1] + 1]
  }

  budget(length: number): void {
    if (length >= MAX_FACTS) throw new CapError()
  }

  newScope(scope: TypeScope): number {
    this.budget(this.facts.typeScopes.length)
    this.facts.typeScopes.push(scope)
    return this.facts.typeScopes.length - 1
  }

  get classes(): ClassFacts[] {
    return this.facts.classes
  }

  pushChain(chain: Chain): void {
    this.budget(this.facts.chains.length)
    this.facts.chains.push(chain)
  }

  pushLookupRef(chain: Chain): void {
    this.budget(this.facts.lookupRefs.length)
    this.facts.lookupRefs.push(chain)
  }

  noteCaptured(count: number): void {
    this.captured += count
    if (this.captured > MAX_CAPTURED) throw new CapError()
  }

  // 형식 사용과 그 형식 인자들(typeArg). 기본형은 남기지 않는다.
  emitTypeUse(
    ref: TypeRef,
    ctx: TypeUseContext,
    prefix = '',
    suffix = '',
    importKind?: TypeUse['importKind']
  ): void {
    if (!isPrimitiveRef(ref)) {
      const tokens = this.c.nameTokens.get(ref) ?? []
      const positions: [number, number][] = []
      const marks: [number, number][] = []
      let offset = prefix.length
      for (let k = 0; k < ref.names.length; k++) {
        positions.push(tokens[k] === undefined ? [0, 0] : this.pos(tokens[k]))
        marks.push([offset, offset + ref.names[k].length])
        offset += ref.names[k].length + 1
      }
      const last = positions[positions.length - 1] ?? [0, 0]
      this.budget(this.facts.typeUses.length + this.facts.importUses.length)
      const use: TypeUse = {
        ref,
        ctx,
        line: last[0],
        col: last[1],
        snippet: this.intern(prefix + typeText(ref) + suffix),
        positions,
        marks,
        ...(importKind ? { importKind } : {})
      }
      if (ctx === 'import') this.facts.importUses.push(use)
      else this.facts.typeUses.push(use)
    }
    for (const arg of ref.args) this.emitTypeUse(arg, 'typeArg', '<', '>')
  }

  parseType(i: number, scope: number): ParsedType | null {
    return this.c.parseType(i, scope)
  }

  // 문자열 토큰 → 사용(앞뒤 공백을 뺀 값이 1..128자일 때만)
  stringValue(tok: number): string | null {
    const token = this.c.tokens[tok]
    if (token?.kind !== 'string' || token.unterminated) return null
    const decoded = decodeJavaQuoted(this.c.texts[tok])
    if (decoded === null) return null
    const value = decoded.trim()
    return value && value.length <= MAX_STRING_LENGTH ? value : null
  }

  pushString(tok: number, value: string, before: string, after: string): StringUse {
    const literal = this.c.texts[tok]
    const [line, col] = this.pos(tok)
    this.budget(this.facts.strings.length)
    const use: StringUse = {
      value: this.intern(value),
      tier: this.forcedLookup.has(tok) ? 'lookup' : 'text',
      line,
      col,
      snippet: this.intern(before + literal + after),
      mark: [before.length, before.length + literal.length]
    }
    this.facts.strings.push(use)
    this.stringAt.set(tok, use)
    return use
  }

  forceLookup(tok: number): void {
    const use = this.stringAt.get(tok)
    if (use) use.tier = 'lookup'
    else this.forcedLookup.add(tok)
  }

  // '@'에서 애너테이션 하나(@interface가 아닌 것) 다음. 인자 '(…)'가 있으면 그 안을 패스 B 범위로 남긴다. 요소 값의
  // 연쇄·클래스 리터럴(@TeleOp(group = RobotHardware.CONFIGURATION_NAME), @Uses(RobotHardware.class))은 javac가 묶는
  // 사용처이고, 요소 이름과 문자열은 사용처가 아니다(spec §1.3). cls·scope는 애너테이션이 붙은 자리다(클래스 선언에
  // 붙은 것은 그 바깥, 멤버에 붙은 것은 그 클래스 몸통).
  annotation(j: number, cls: number, scope: number): number {
    const c = this.c
    const end = c.skipAnnotation(j)
    let k = j + 1
    while (c.ident(k) && c.op(k + 1, '.') && c.ident(k + 2)) k += 2
    const open = k + 1
    if (end > open && c.op(open, '(')) {
      const close = c.pair[open]
      if (close > open + 1 && close < c.n && c.pair[close] === open) {
        this.ranges.push({
          start: open + 1,
          end: close,
          cls,
          scope,
          params: null,
          body: false,
          annotation: true
        })
      }
    }
    return end
  }

  // 이어진 애너테이션들 다음(annotation을 차례로)
  annotations(j: number, cls: number, scope: number): number {
    let k = j
    while (this.c.op(k, '@') && !this.c.kw(k + 1, 'interface')) k = this.annotation(k, cls, scope)
    return k
  }

  // 감싸는 클래스(같은 파일)에서 이름의 필드를 찾는다. 지역·익명 클래스가 잡은 같은 이름의 지역 변수를 먼저 만나면
  // 그 지역 변수다(captured). 못 찾으면 undefined.
  enclosingField(
    cls: number,
    name: string
  ): { field: FieldFacts } | { captured: TypeRef | null } | undefined {
    for (let k = cls; k >= 0; k = this.classes[k].outer) {
      const facts = this.classes[k]
      const field = facts.fields.get(name)
      if (field) return { field }
      if (facts.captured?.has(name)) return { captured: facts.captured.get(name) ?? null }
    }
    return undefined
  }

  // ── 패스 A: 개요 ──

  private parseFile(): void {
    const c = this.c
    // package 앞의 애너테이션(package-info.java)은 건너뛴다. package가 없으면 첫 형식 선언의 것이다.
    let i = c.skipAnnotations(0)
    if (c.kw(i, 'package')) {
      const q = this.qualified(i + 1)
      this.facts.pkg = this.intern(q.names.join('.'))
      i = q.end
      if (c.op(i, ';')) i++
    } else {
      i = 0
    }
    for (;;) {
      if (c.op(i, ';')) {
        i++
        continue
      }
      if (!c.kw(i, 'import')) break
      i = this.parseImport(i)
    }
    while (i < c.n) {
      if (c.op(i, ';')) {
        i++
        continue
      }
      const mods = this.parseModifiers(i, -1, 0)
      if (this.isTypeDeclStart(mods.end)) {
        i = this.parseClassDecl(mods.end, -1, 0, false, null).end
        continue
      }
      // 형식 선언이 아닌 것(쓰는 중인 코드): 건너뛴다
      i = Math.max(mods.end, i) + 1
    }
  }

  private qualified(j: number): { names: string[]; tokens: number[]; end: number } {
    const c = this.c
    const names: string[] = []
    const tokens: number[] = []
    let k = j
    while (c.ident(k)) {
      names.push(this.intern(c.texts[k]))
      tokens.push(k)
      k++
      if (c.op(k, '.') && c.ident(k + 1)) k++
      else break
    }
    return { names, tokens, end: k }
  }

  private parseImport(i: number): number {
    const c = this.c
    let j = i + 1
    const isStatic = c.kw(j, 'static')
    if (isStatic) j++
    const q = this.qualified(j)
    let end = q.end
    const star = c.op(end, '.') && c.op(end + 1, '*')
    if (star) end += 2
    if (q.names.length > 0) {
      const imports = this.facts.imports
      const last = q.names[q.names.length - 1]
      if (isStatic && star) imports.staticOnDemand.push(q.names)
      else if (isStatic) {
        const list = imports.staticSingle.get(last)
        if (list) list.push(q.names)
        else imports.staticSingle.set(last, [q.names])
      } else if (star) imports.onDemand.push(q.names)
      else if (!imports.single.has(last)) imports.single.set(last, q.names)
      const ref: TypeRef = { names: q.names, args: [], dims: 0, scope: 0 }
      this.c.nameTokens.set(ref, q.tokens)
      this.emitTypeUse(
        ref,
        'import',
        isStatic ? 'import static ' : 'import ',
        star ? '.*' : '',
        isStatic ? (star ? 'staticOnDemand' : 'static') : star ? 'onDemand' : 'single'
      )
    }
    // ';'까지(쓰는 중인 코드면 다음 줄의 선언을 먹지 않게 import·형식 선언 앞에서 멈춘다)
    while (end < c.n && !c.op(end, ';') && !c.kw(end, 'import') && !this.isTypeDeclStart(end)) end++
    return c.op(end, ';') ? end + 1 : end
  }

  // 수식어와 애너테이션. 애너테이션 인자는 cls·scope 자리의 범위로 남긴다(annotation).
  parseModifiers(i: number, cls: number, scope: number): Modifiers {
    const c = this.c
    let access: Access | null = null
    let isStatic = false
    let j = i
    for (;;) {
      if (c.op(j, '@') && !c.kw(j + 1, 'interface')) {
        j = this.annotation(j, cls, scope)
        continue
      }
      if (c.tokens[j]?.kind === 'keyword' && MODIFIERS.has(c.texts[j])) {
        const t = c.texts[j]
        if (t === 'public' || t === 'protected' || t === 'private') access ??= t
        if (t === 'static') isStatic = true
        j++
        continue
      }
      return { access, isStatic, end: j }
    }
  }

  isTypeDeclStart(k: number): boolean {
    const c = this.c
    return (
      c.kw(k, 'class') ||
      c.kw(k, 'interface') ||
      c.kw(k, 'enum') ||
      (c.op(k, '@') && c.kw(k + 1, 'interface'))
    )
  }

  // k: class·interface·enum 키워드 또는 @interface의 '@'. 끝(다음 토큰)과 클래스 번호(이름이 없으면 -1).
  parseClassDecl(
    k: number,
    outer: number,
    parentScope: number,
    local: boolean,
    captured: Map<string, TypeRef | null> | null
  ): { cls: number; end: number } {
    const c = this.c
    const annotation = c.op(k, '@')
    const keyword = annotation ? k + 1 : k
    const kind: ClassFacts['kind'] = annotation
      ? 'annotation'
      : (c.texts[keyword] as 'class' | 'interface' | 'enum')
    const nameTok = keyword + 1
    if (!c.ident(nameTok)) return { cls: -1, end: keyword + 1 }
    const name = this.intern(c.texts[nameTok])
    const cls = this.addClass({
      name,
      kind,
      outer,
      local,
      superRef: null,
      ifaceRefs: [],
      fields: new Map(),
      methods: new Map(),
      members: new Map(),
      captured,
      typeScope: -1
    })
    if (outer >= 0 && !local && !this.classes[outer].members.has(name))
      this.classes[outer].members.set(name, cls)

    let j = nameTok + 1
    let headerScope = parentScope
    if (c.op(j, '<')) {
      headerScope = this.newScope({ cls: -1, params: new Map(), parent: parentScope })
      j = this.parseTypeParams(j, headerScope)
    }
    const facts = this.classes[cls]
    for (;;) {
      if (c.kw(j, 'extends')) {
        const list = this.parseTypeList(j + 1, headerScope, 'extends ')
        if (kind === 'interface') facts.ifaceRefs.push(...list.refs)
        else if (list.refs.length) facts.superRef = list.refs[0]
        j = list.end
        continue
      }
      if (c.kw(j, 'implements')) {
        const list = this.parseTypeList(j + 1, headerScope, 'implements ')
        facts.ifaceRefs.push(...list.refs)
        j = list.end
        continue
      }
      break
    }
    // 몸통 '{'까지(쓰는 중인 코드의 다른 글자는 건너뛴다)
    while (j < c.n && !c.op(j, '{') && !c.op(j, ';') && !c.op(j, '}')) {
      j = c.op(j, '(') || c.op(j, '[') ? c.after(j) : j + 1
    }
    if (!c.op(j, '{')) return { cls, end: j }
    facts.typeScope = this.newScope({ cls, params: new Map(), parent: headerScope })
    this.parseClassBody(j, cls, facts.typeScope)
    return { cls, end: c.after(j) }
  }

  addClass(facts: ClassFacts): number {
    this.budget(this.classes.length)
    this.classes.push(facts)
    return this.classes.length - 1
  }

  // 익명 클래스(new T(…) {…}, enum 상수 몸통): open은 몸통 '{'
  outlineAnonymous(
    open: number,
    outer: number,
    parentScope: number,
    superRef: TypeRef,
    captured: Map<string, TypeRef | null> | null
  ): number {
    const cls = this.addClass({
      name: null,
      kind: 'class',
      outer,
      local: true,
      superRef,
      ifaceRefs: [],
      fields: new Map(),
      methods: new Map(),
      members: new Map(),
      captured,
      typeScope: -1
    })
    this.classes[cls].typeScope = this.newScope({ cls, params: new Map(), parent: parentScope })
    this.parseClassBody(open, cls, this.classes[cls].typeScope)
    return cls
  }

  // '<'에서 형식 매개변수 목록. 이름 → 첫 경계를 scope의 params에 넣고(둘째부터의 경계는 more에), 경계는 extends
  // 사용이다.
  private parseTypeParams(j: number, scope: number): number {
    const c = this.c
    const level = this.facts.typeScopes[scope]
    const params = level.params
    let k = j + 1
    for (;;) {
      k = c.skipAnnotations(k)
      if (!c.ident(k)) break
      const name = this.intern(c.texts[k])
      k++
      let bound: TypeRef | null = null
      const more: TypeRef[] = []
      if (c.kw(k, 'extends')) {
        let t = this.parseType(k + 1, scope)
        if (t) bound = t.ref
        while (t) {
          this.emitTypeUse(t.ref, 'extends', bound === t.ref ? 'extends ' : '& ')
          if (t.ref !== bound) more.push(t.ref)
          k = t.end
          t = c.op(k, '&') ? this.parseType(k + 1, scope) : null
        }
      }
      if (more.length && !params.has(name)) (level.more ??= new Map()).set(name, more)
      if (!params.has(name)) params.set(name, bound)
      if (c.op(k, ',')) {
        k++
        continue
      }
      break
    }
    if (c.op(k, '>')) return k + 1
    // 쓰는 중인 코드: 다음 '>'까지(몸통을 넘지 않게)
    while (k < c.n && !c.op(k, '>') && !c.op(k, '{') && !c.op(k, ';')) k++
    return c.op(k, '>') ? k + 1 : k
  }

  private parseTypeList(
    j: number,
    scope: number,
    prefix: string
  ): { refs: TypeRef[]; end: number } {
    const refs: TypeRef[] = []
    let k = j
    for (;;) {
      const t = this.parseType(k, scope)
      if (!t) break
      refs.push(t.ref)
      this.emitTypeUse(t.ref, prefix === 'throws ' ? 'decl' : 'extends', prefix)
      k = t.end
      if (!this.c.op(k, ',')) break
      k++
    }
    return { refs, end: k }
  }

  parseClassBody(open: number, cls: number, scope: number): void {
    const c = this.c
    if (++this.depth > MAX_CLASS_DEPTH) throw new CapError()
    const end = c.end(open)
    const facts = this.classes[cls]
    const iface = facts.kind === 'interface' || facts.kind === 'annotation'
    let j = open + 1
    if (facts.kind === 'enum') j = this.parseEnumConstants(j, end, cls, scope)
    while (j < end) {
      if (c.op(j, ';')) {
        j++
        continue
      }
      const mods = this.parseModifiers(j, cls, scope)
      let k = mods.end
      if (k >= end) break
      const access: Access = mods.access ?? (iface ? 'public' : 'package')
      if (c.op(k, '{')) {
        // 초기화 블록(static 포함)
        this.ranges.push({ start: k, end: c.after(k), cls, scope, params: null, body: true })
        j = c.after(k)
        continue
      }
      if (this.isTypeDeclStart(k)) {
        j = Math.max(this.parseClassDecl(k, cls, scope, false, null).end, k + 1)
        continue
      }
      let memberScope = scope
      if (c.op(k, '<')) {
        memberScope = this.newScope({ cls: -1, params: new Map(), parent: scope })
        k = this.parseTypeParams(k, memberScope)
      }
      // 생성자
      if (c.ident(k) && c.op(k + 1, '(') && c.texts[k] === facts.name) {
        const params = this.parseParams(k + 1, cls, memberScope)
        j = this.methodRest(c.after(k + 1), cls, memberScope, params, end)
        continue
      }
      let ret: TypeRef | null = null
      let nameTok: number
      if (c.kw(k, 'void')) {
        nameTok = k + 1
      } else {
        const t = this.parseType(k, memberScope)
        if (!t) {
          j = this.skipMember(k, end)
          continue
        }
        ret = t.ref
        nameTok = t.end
      }
      if (!c.ident(nameTok)) {
        j = this.skipMember(k, end)
        continue
      }
      const name = this.intern(c.texts[nameTok])
      if (c.op(nameTok + 1, '(')) {
        const params = this.parseParams(nameTok + 1, cls, memberScope)
        let m = c.after(nameTok + 1)
        let dims = 0
        while (c.op(m, '[') && c.op(m + 1, ']')) {
          dims++
          m += 2
        }
        let methodRet: TypeRef | null = null
        if (ret) {
          this.emitTypeUse(ret, 'decl', '', ` ${name}(…)`)
          if (!isPrimitiveRef(ret)) methodRet = dims ? { ...ret, dims: ret.dims + dims } : ret
        }
        const list = facts.methods.get(name)
        const method: MethodFacts = { ret: methodRet, access, isStatic: mods.isStatic }
        if (list) list.push(method)
        else facts.methods.set(name, [method])
        j = this.methodRest(m, cls, memberScope, params, end)
        continue
      }
      // void 필드는 없다
      if (!ret) {
        j = this.skipMember(k, end)
        continue
      }
      j = this.parseFields(ret, nameTok, cls, scope, access, iface || mods.isStatic, end)
    }
    if (facts.kind === 'enum' && facts.name !== null) this.addEnumMethods(facts, scope)
    this.depth--
  }

  // enum의 암묵 static 메서드 values()·valueOf(String)(JLS 8.9.3). 선언한 같은 이름의 오버로드(valueOf(int) 등) 뒤에
  // 둔다(두 메서드 자체는 다시 선언할 수 없다). 반환 형식은 몸통 단계에서 푸는 그 enum이다.
  private addEnumMethods(facts: ClassFacts, scope: number): void {
    const self: TypeRef = { names: [facts.name ?? ''], args: [], dims: 0, scope }
    const implicit: [string, TypeRef][] = [
      ['values', { ...self, dims: 1 }],
      ['valueOf', self]
    ]
    for (const [name, ret] of implicit) {
      const method: MethodFacts = { ret, access: 'public', isStatic: true }
      const list = facts.methods.get(name)
      if (list) list.push(method)
      else facts.methods.set(this.intern(name), [method])
    }
  }

  private parseEnumConstants(j: number, end: number, cls: number, scope: number): number {
    const c = this.c
    const facts = this.classes[cls]
    const self: TypeRef = { names: [facts.name ?? ''], args: [], dims: 0, scope }
    let k = j
    while (k < end) {
      if (c.op(k, ';')) return k + 1
      if (c.op(k, ',')) {
        k++
        continue
      }
      k = this.annotations(k, cls, scope)
      if (!c.ident(k)) return k
      const name = this.intern(c.texts[k])
      if (!facts.fields.has(name))
        facts.fields.set(name, { type: self, access: 'public', isStatic: true })
      k++
      if (c.op(k, '(')) {
        // 인자는 그 상수의 생성자 호출처럼 훑는다(괄호부터)
        this.ranges.push({ start: k, end: c.after(k), cls, scope, params: null, body: false })
        k = c.after(k)
      }
      if (c.op(k, '{')) {
        this.outlineAnonymous(k, cls, scope, self, null)
        k = c.after(k)
      }
    }
    return k
  }

  // open: 매개변수 '('. 이름 → 형식(기본형은 null, 가변 인자는 차원 +1)
  parseParams(open: number, cls: number, scope: number): Map<string, TypeRef | null> {
    const c = this.c
    const vars = new Map<string, TypeRef | null>()
    const close = c.end(open)
    let j = open + 1
    while (j < close) {
      while (c.kw(j, 'final') || (c.op(j, '@') && !c.kw(j + 1, 'interface')))
        j = c.kw(j, 'final') ? j + 1 : this.annotation(j, cls, scope)
      const t = this.parseType(j, scope)
      if (!t) break
      let k = t.end
      let dims = 0
      if (c.op(k, '...')) {
        dims++
        k++
      }
      // 받는 쪽 매개변수(Foo this)는 변수가 아니다
      if (c.kw(k, 'this')) {
        k++
      } else {
        if (!c.ident(k)) break
        const name = this.intern(c.texts[k])
        k++
        while (c.op(k, '[') && c.op(k + 1, ']')) {
          dims++
          k += 2
        }
        this.emitTypeUse(t.ref, 'decl', '', ` ${name}`)
        if (!vars.has(name))
          vars.set(
            name,
            isPrimitiveRef(t.ref) ? null : dims ? { ...t.ref, dims: t.ref.dims + dims } : t.ref
          )
      }
      if (!c.op(k, ',')) break
      j = k + 1
    }
    return vars
  }

  // 메서드·생성자의 매개변수 뒤: throws, 애너테이션 요소의 default, 몸통(범위로) 또는 ';'
  private methodRest(
    m: number,
    cls: number,
    scope: number,
    params: Map<string, TypeRef | null>,
    limit: number
  ): number {
    const c = this.c
    let k = m
    if (c.kw(k, 'throws')) k = this.parseTypeList(k + 1, scope, 'throws ').end
    if (c.op(k, '{')) {
      this.ranges.push({ start: k, end: c.after(k), cls, scope, params, body: true })
      return c.after(k)
    }
    if (c.op(k, ';')) return k + 1
    return this.skipMember(k, limit)
  }

  // 필드 선언자들: Type a [dims] [= init], b … ;
  private parseFields(
    ref: TypeRef,
    nameTok: number,
    cls: number,
    scope: number,
    access: Access,
    isStatic: boolean,
    limit: number
  ): number {
    const c = this.c
    const facts = this.classes[cls]
    const base = isPrimitiveRef(ref) ? null : ref
    this.emitTypeUse(ref, 'decl', '', ` ${c.texts[nameTok]}`)
    let k = nameTok
    for (;;) {
      if (!c.ident(k)) return this.skipMember(k, limit)
      const name = this.intern(c.texts[k])
      k++
      let dims = 0
      while (c.op(k, '[') && c.op(k + 1, ']')) {
        dims++
        k += 2
      }
      const field: FieldFacts = {
        type: base && dims ? { ...base, dims: base.dims + dims } : base,
        access,
        isStatic
      }
      if (c.op(k, '=')) {
        const start = k + 1
        const end = this.declaratorEnd(start, limit, scope)
        if (end === start + 1 && c.tokens[start].kind === 'string') {
          const value = this.stringValue(start)
          if (value !== null) {
            const before = `${name} = `
            const literal = c.texts[start]
            const [line, col] = this.pos(start)
            field.stringLit = {
              value: this.intern(value),
              line,
              col,
              snippet: this.intern(before + literal),
              mark: [before.length, before.length + literal.length]
            }
            this.fieldLitTok.set(field, start)
          }
        }
        if (end > start) this.ranges.push({ start, end, cls, scope, params: null, body: false })
        k = end
      }
      if (!facts.fields.has(name)) facts.fields.set(name, field)
      if (c.op(k, ',')) {
        k++
        continue
      }
      if (c.op(k, ';')) return k + 1
      return this.skipMember(k, limit)
    }
  }

  // 필드 초기값의 끝(같은 깊이의 ',' 또는 ';'). new HashMap<String, Integer>()·Foo.<A, B>m()의 ','는 형식 인자라
  // 건너뛴다(형식 인자로 읽히고 뒤가 '('·'::'이거나 앞이 '.'일 때만. a < b, c = d > e는 선언자 둘이다).
  private declaratorEnd(start: number, limit: number, scope: number): number {
    const c = this.c
    let k = start
    while (k < limit) {
      const token = c.tokens[k]
      if (token.kind === 'operator') {
        const t = c.texts[k]
        if (t === '(' || t === '[' || t === '{') {
          k = c.after(k)
          continue
        }
        if (t === ',' || t === ';' || t === ')' || t === ']' || t === '}') return k
        if (t === '<' && (c.op(k - 1, '.') || c.ident(k - 1))) {
          const args = c.typeArgs(k, scope, true)
          if (args && (c.op(k - 1, '.') || c.op(args.end, '(') || c.op(args.end, '::'))) {
            k = args.end
            continue
          }
        }
      }
      k++
    }
    return limit
  }

  // 알 수 없는 멤버: 같은 깊이의 ';' 다음이나 '{…}' 다음까지
  private skipMember(k: number, limit: number): number {
    const c = this.c
    let j = k
    while (j < limit) {
      if (c.op(j, ';')) return j + 1
      if (c.op(j, '{')) return c.after(j)
      j = c.op(j, '(') || c.op(j, '[') ? c.after(j) : j + 1
    }
    return limit
  }
}

// 패스 B: 범위 하나를 훑는다. 상태는 프레임(지역 변수), 괄호 스택(역할), 문장 자리 여부, 진행 중인 선언이다.
class Walker {
  private readonly c: UsageCursor
  private readonly frames: Frame[] = []
  private readonly brackets: Bracket[] = []
  // 지금 토큰이 문장의 시작 자리인가
  private stmt: boolean
  private decl: Decl | null = null
  // case 라벨을 읽는 중이면 그 괄호 깊이(':'에서 문장 자리가 된다)
  private caseDepth = -1
  // 괄호 → 머리 정보(if·while·for 등의 머리, try 자원)
  private readonly headerAt = new Map<number, BracketRole>()

  constructor(
    private readonly x: Extractor,
    private readonly range: Range
  ) {
    this.c = x.c
    this.stmt = range.body
    if (range.params) {
      this.frames.push({ vars: range.params, strs: null, end: range.end, scope: range.scope })
    }
  }

  private get scope(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].scope : this.range.scope
  }

  private get cls(): number {
    return this.range.cls
  }

  run(): void {
    let i = this.range.start
    while (i < this.range.end) {
      while (this.frames.length && this.frames[this.frames.length - 1].end <= i) this.frames.pop()
      const next = this.step(i)
      i = next > i ? next : i + 1
    }
    // 범위 끝까지 닫히지 않은 호출(쓰는 중인 코드)도 등급을 정한다
    while (this.brackets.length) this.finish(this.brackets.pop()!, -1)
  }

  private pushFrame(end: number, vars = new Map<string, TypeRef | null>()): Frame {
    const frame: Frame = { vars, strs: null, end, scope: this.scope }
    this.frames.push(frame)
    return frame
  }

  private innerFrame(): Frame {
    return this.frames[this.frames.length - 1] ?? this.pushFrame(this.range.end)
  }

  private lookupLocal(name: string): { type: TypeRef | null; frame: Frame } | undefined {
    for (let f = this.frames.length - 1; f >= 0; f--) {
      const frame = this.frames[f]
      if (frame.vars.has(name)) return { type: frame.vars.get(name) ?? null, frame }
    }
    return undefined
  }

  // 지금 보이는 지역 변수(안쪽 것이 이긴다). 익명·지역 클래스의 captured.
  private snapshot(): Map<string, TypeRef | null> {
    const result = new Map<string, TypeRef | null>()
    for (let f = this.frames.length - 1; f >= 0; f--) {
      for (const [name, type] of this.frames[f].vars) if (!result.has(name)) result.set(name, type)
    }
    this.x.noteCaptured(result.size)
    return result
  }

  private step(i: number): number {
    const jump = this.x.jumpAt.get(i)
    if (jump !== undefined) return jump
    if (this.stmt) {
      const next = this.statementStart(i)
      if (next >= 0) return next
      this.stmt = false
    }
    return this.expression(i)
  }

  // ── 문장 자리 ──

  // 문장으로 처리했으면 다음 토큰 번호, 식으로 넘기면 -1
  private statementStart(i: number): number {
    const c = this.c
    const token = c.tokens[i]
    if (token.kind === 'operator') {
      if (c.op(i, '{')) {
        this.openBlock(i, 'block')
        return i + 1
      }
      if (c.op(i, ';')) {
        this.decl = null
        return i + 1
      }
      if (c.op(i, '@') && !c.kw(i + 1, 'interface')) return this.declaration(i)
      return -1
    }
    if (token.kind === 'keyword') {
      switch (c.texts[i]) {
        case 'if':
        case 'while':
        case 'switch':
        case 'synchronized':
          if (c.op(i + 1, '(')) this.headerAt.set(i + 1, 'header')
          this.stmt = false
          return i + 1
        case 'for':
          if (c.op(i + 1, '(')) {
            // for 머리의 변수는 몸통 끝까지(중괄호 없는 몸통 포함)
            this.pushFrame(c.statementEnd(c.after(i + 1)))
            this.headerAt.set(i + 1, 'forHeader')
          }
          this.stmt = false
          return i + 1
        case 'do':
        case 'else':
        case 'finally':
          // 식 자리에서 왔어도(STATEMENT_KEYWORDS) 다음은 문장이다
          this.stmt = true
          return i + 1
        case 'try':
          if (c.op(i + 1, '(')) {
            // 자원 변수는 try 블록 끝까지(catch·finally 밖)
            const block = c.after(i + 1)
            this.pushFrame(c.op(block, '{') ? c.after(block) : block)
            this.headerAt.set(i + 1, 'resources')
            this.stmt = false
          } else {
            this.stmt = true
          }
          return i + 1
        case 'catch':
          return this.catchClause(i)
        case 'case':
          this.stmt = false
          // case RED: 의 RED는 enum 상수 이름이라 이름 풀이를 하지 않는다
          if (c.ident(i + 1) && c.op(i + 2, ':')) {
            this.stmt = true
            return i + 3
          }
          this.caseDepth = this.brackets.length
          return i + 1
        case 'default':
          if (!c.op(i + 1, ':')) return -1
          this.stmt = true
          return i + 2
        case 'break':
        case 'continue':
          this.stmt = false
          return c.ident(i + 1) ? i + 2 : i + 1
        case 'class':
        case 'interface':
        case 'enum':
        case 'final':
        case 'abstract':
        case 'static':
        case 'strictfp':
          return this.declaration(i)
        default:
          if (this.isPrimitiveKeyword(i)) return this.declaration(i)
          return -1
      }
    }
    if (token.kind === 'identifier') {
      // 이름표
      if (c.op(i + 1, ':')) return i + 2
      return this.declaration(i)
    }
    return -1
  }

  private isPrimitiveKeyword(i: number): boolean {
    const t = this.c.texts[i]
    return (
      t === 'boolean' ||
      t === 'byte' ||
      t === 'char' ||
      t === 'short' ||
      t === 'int' ||
      t === 'long' ||
      t === 'float' ||
      t === 'double'
    )
  }

  // 지역 클래스 또는 지역 변수 선언([final | @Ann]* Type Ident (= ; , [ 또는 for 머리의 :)). 아니면 -1.
  // 애너테이션 인자는 선언일 때만 범위로 남긴다(아니면 식 자리의 '@'가 남긴다).
  private declaration(i: number): number {
    const c = this.c
    let j = i
    const annotations: number[] = []
    for (;;) {
      if (c.op(j, '@') && !c.kw(j + 1, 'interface')) {
        annotations.push(j)
        j = c.skipAnnotation(j)
      } else if (c.tokens[j]?.kind === 'keyword' && LOCAL_CLASS_MODIFIERS.has(c.texts[j])) j++
      else break
    }
    const keep = (): void => {
      for (const at of annotations) this.x.annotation(at, this.cls, this.scope)
    }
    if (this.x.isTypeDeclStart(j)) {
      keep()
      return this.localClass(j)
    }
    const t = this.x.parseType(j, this.scope)
    if (!t || !c.ident(t.end)) return -1
    const nameTok = t.end
    const top = this.brackets[this.brackets.length - 1]
    const forHeader = top?.role === 'forHeader'
    const next = nameTok + 1
    if (!(
      c.op(next, '=') ||
      c.op(next, ';') ||
      c.op(next, ',') ||
      c.op(next, '[') ||
      (forHeader && c.op(next, ':'))
    )) {
      return -1
    }
    keep()
    this.x.emitTypeUse(t.ref, 'decl', '', ` ${c.texts[nameTok]}`)
    const type = isPrimitiveRef(t.ref) ? null : t.ref
    this.decl = { type, depth: this.brackets.length }
    this.stmt = false
    return this.declareVar(nameTok, type)
  }

  // 선언자 이름 하나(C 방식 배열 차원 포함)를 가장 안쪽 프레임에 넣는다. 이름 다음 토큰을 돌려준다.
  // 이름을 넣은 뒤라 자기 초기값에서도 보인다.
  private declareVar(nameTok: number, base: TypeRef | null): number {
    const c = this.c
    const name = this.x.intern(c.texts[nameTok])
    let j = nameTok + 1
    let dims = 0
    while (c.op(j, '[') && c.op(j + 1, ']')) {
      dims++
      j += 2
    }
    const frame = this.innerFrame()
    frame.vars.set(name, base && dims ? { ...base, dims: base.dims + dims } : base)
    if (
      c.op(j, '=') &&
      c.tokens[j + 1]?.kind === 'string' &&
      (c.op(j + 2, ';') || c.op(j + 2, ','))
    ) {
      ;(frame.strs ??= new Map()).set(name, j + 1)
    } else {
      frame.strs?.delete(name)
    }
    return j
  }

  // 지역 클래스: 이 블록 안에서는 그 이름이 알 수 없는 형식이다(바깥의 같은 이름 형식을 가린다)
  private localClass(k: number): number {
    const c = this.c
    const keyword = c.op(k, '@') ? k + 1 : k
    if (!c.ident(keyword + 1)) return keyword + 1
    const frame = this.innerFrame()
    frame.scope = this.x.newScope({
      cls: -1,
      params: new Map([[this.x.intern(c.texts[keyword + 1]), null]]),
      parent: frame.scope
    })
    const result = this.x.parseClassDecl(k, this.cls, frame.scope, true, this.snapshot())
    this.stmt = true
    return Math.max(result.end, k + 1)
  }

  private catchClause(i: number): number {
    const c = this.c
    const open = i + 1
    if (!c.op(open, '(')) return i + 1
    const close = c.end(open)
    const block = close + 1
    let j = open + 1
    while (c.kw(j, 'final') || (c.op(j, '@') && !c.kw(j + 1, 'interface')))
      j = c.kw(j, 'final') ? j + 1 : this.x.annotation(j, this.cls, this.scope)
    const types: TypeRef[] = []
    let t = this.x.parseType(j, this.scope)
    while (t) {
      types.push(t.ref)
      j = t.end
      t = c.op(j, '|') ? this.x.parseType(j + 1, this.scope) : null
    }
    const name = c.ident(j) ? c.texts[j] : null
    for (const ref of types) this.x.emitTypeUse(ref, 'decl', '', name ? ` ${name}` : '')
    // catch 매개변수는 catch 블록 안에서만 보인다(finally는 밖). 합 형식(A | B)은 형식을 모른다.
    const frame = this.pushFrame(c.op(block, '{') ? c.after(block) : block)
    if (name) frame.vars.set(this.x.intern(name), types.length === 1 ? types[0] : null)
    this.stmt = true
    return Math.min(close + 1, this.c.n)
  }

  private openBlock(i: number, role: 'block' | 'lambda'): void {
    this.brackets.push({ open: i, role })
    this.pushFrame(this.c.after(i))
    this.stmt = true
  }

  // ── 식 자리 ──

  private expression(i: number): number {
    const c = this.c
    const token = c.tokens[i]
    switch (token.kind) {
      case 'string':
        // 애너테이션 안의 문자열은 사용처가 아니다(@TeleOp(name = "arm"), spec §1.3)
        if (!this.range.annotation) this.stringLiteral(i)
        return i + 1
      case 'identifier':
        return this.identifier(i)
      case 'keyword':
        // 문장 자리를 놓친 제어문(이름표 뒤 등)도 문장으로 읽는다
        if (STATEMENT_KEYWORDS.has(c.texts[i])) {
          const next = this.statementStart(i)
          if (next >= 0) return next
        }
        switch (c.texts[i]) {
          case 'new':
            return this.newExpression(i)
          case 'this':
            return this.thisExpression(i)
          case 'super':
            return this.superExpression(i)
          case 'instanceof': {
            const t = this.x.parseType(i + 1, this.scope)
            if (!t) return i + 1
            this.x.emitTypeUse(t.ref, 'instanceof', 'instanceof ')
            return t.end
          }
          default:
            return i + 1
        }
      case 'operator':
        switch (c.texts[i]) {
          case '(':
            return this.openParen(i)
          case '[':
            this.brackets.push({ open: i, role: 'index' })
            return i + 1
          case '{':
            return this.openBrace(i)
          case ')':
          case ']':
          case '}':
            return this.close(i)
          case ';':
            return this.semicolon(i)
          case ',':
            return this.comma(i)
          case ':':
            if (this.caseDepth === this.brackets.length) {
              this.caseDepth = -1
              this.stmt = true
            }
            if (this.brackets[this.brackets.length - 1]?.role === 'forHeader') this.decl = null
            return i + 1
          case '@':
            return c.kw(i + 1, 'interface') ? i + 1 : this.x.annotation(i, this.cls, this.scope)
          case '.':
            // 명시한 메서드 형식 인자 a.<T>m(…): 형식 인자와 메서드 이름을 건너뛴다(연쇄 미리 보기가 이미 읽었다)
            if (c.op(i + 1, '<')) {
              const args = c.typeArgs(i + 1, this.scope)
              if (args) {
                for (const arg of args.args) this.x.emitTypeUse(arg, 'typeArg', '<', '>')
                return c.ident(args.end) ? args.end + 1 : args.end
              }
            }
            return i + 1
          default:
            return i + 1
        }
      default:
        return i + 1
    }
  }

  private identifier(i: number): number {
    const c = this.c
    // 세그먼트(머리의 미리 보기가 읽었다)와 메서드 참조 이름은 머리가 아니다
    if (c.op(i - 1, '.') || c.op(i - 1, '::')) return i + 1
    // 애너테이션 요소 이름(group = …)은 변수가 아니다
    if (this.range.annotation && c.op(i + 1, '=')) return i + 1
    // 형식 없는 람다 매개변수 하나(x -> …)
    if (c.op(i + 1, '->')) {
      const body = i + 2
      const vars = new Map<string, TypeRef | null>([[this.x.intern(c.texts[i]), null]])
      this.pushFrame(c.lambdaBodyEnd(body), vars)
      if (c.op(body, '{')) this.x.lambdaBlockAt.add(body)
      return body
    }
    const name = this.x.intern(c.texts[i])
    if (c.op(i + 1, '(')) {
      this.x.callAt.set(i + 1, { name, receiverText: name, receiverHw: false })
      this.lookahead(
        c.after(i + 1),
        { k: 'call', name, cls: this.cls },
        `${name}(…)`,
        false,
        i,
        null
      )
      return i + 1
    }
    const local = this.lookupLocal(name)
    if (local) {
      const hw = isHardwareMapType(local.type) || (local.type === null && name === 'hardwareMap')
      this.lookahead(i + 1, { k: 'local', type: local.type, name }, name, hw, i, local.frame)
    } else {
      this.lookahead(
        i + 1,
        { k: 'name', name, cls: this.cls },
        name,
        name === 'hardwareMap' || this.fieldIsHardwareMap(name),
        i,
        null
      )
    }
    return i + 1
  }

  // this.f·Outer.this.f의 f: 그 클래스(this의 클래스, 같은 파일)에 HardwareMap 형식으로 선언한 필드인가
  private thisFieldIsHardwareMap(cls: number, name: string): boolean {
    return isHardwareMapType(this.x.classes[cls]?.fields.get(name)?.type)
  }

  private fieldIsHardwareMap(name: string): boolean {
    const found = this.x.enclosingField(this.cls, name)
    if (!found) return false
    return isHardwareMapType('field' in found ? found.field.type : found.captured)
  }

  // 머리 다음(k)부터 세그먼트를 미리 읽어 연쇄를 남긴다. 토큰은 소비하지 않는다(본 훑기가 인자 안을 따로 훑고,
  // '.' 뒤의 이름은 머리로 보지 않는다). 세그먼트의 호출 괄호에는 호출 이름과 받는 쪽을 적어 둔다.
  private lookahead(
    start: number,
    head: Head,
    text: string,
    hwHead: boolean,
    headTok: number,
    frame: Frame | null
  ): HeadInfo {
    const c = this.c
    const segs: Seg[] = []
    // 이름만으로 된 연쇄의 이름과 토큰(형식으로 읽힐 때: T.class, T::new)
    const plainNames: string[] = head.k === 'name' ? [head.name] : []
    const plainTokens: number[] = head.k === 'name' ? [headTok] : []
    let plain = head.k === 'name' || head.k === 'local' || head.k === 'this'
    let receiverText = text
    let hw = hwHead
    let hwLast = false
    let emit = true
    let headIndex = 0
    let k = start
    // 머리 뒤의 첨자. X[]는 배열 형식(X[].class, X[]::new)이다.
    const arrayType = (at: number): number => {
      let dims = 0
      let j = at
      while (c.op(j, '[') && c.op(j + 1, ']')) {
        dims++
        j += 2
      }
      if (plain && head.k === 'name' && segs.every((s) => !s.call && s.index === 0)) {
        const member = c.op(j, '::') ? c.texts[j + 1] : null
        if ((c.op(j, '.') && c.kw(j + 1, 'class')) || member !== null) {
          this.emitNamedType(
            plainNames,
            plainTokens,
            dims,
            member === null ? 'classLit' : 'methodRef',
            member
          )
          emit = false
        }
      }
      return j
    }
    while (c.op(k, '[')) {
      if (c.op(k + 1, ']')) {
        k = arrayType(k)
        plain = false
        break
      }
      headIndex++
      plain = false
      receiverText += '[…]'
      k = c.after(k)
    }
    for (;;) {
      if (!plain && !emit) break
      if (c.op(k, '.')) {
        const n1 = k + 1
        let nameTok = -1
        if (c.ident(n1)) {
          nameTok = n1
        } else if (c.op(n1, '<')) {
          const args = c.typeArgs(n1, this.scope)
          if (args && c.ident(args.end) && c.op(args.end + 1, '(')) nameTok = args.end
        } else if (c.kw(n1, 'class')) {
          if (plain && head.k === 'name' && headIndex === 0) {
            this.emitNamedType(plainNames, plainTokens, 0, 'classLit', null)
            emit = false
          }
          break
        }
        if (nameTok < 0 || segs.length >= MAX_SEGMENTS) break
        const name = this.x.intern(c.texts[nameTok])
        const call = c.op(nameTok + 1, '(')
        const [line, col] = this.x.pos(nameTok)
        const seg: Seg = { name, line, col, call, index: 0 }
        let kk = nameTok + 1
        if (call) {
          this.x.callAt.set(kk, {
            name,
            receiverText: clipLeft(`${receiverText}.${name}`, MAX_RECEIVER_TEXT),
            receiverHw: hw
          })
          kk = c.after(kk)
          plain = false
          hwLast = false
          // 호출 결과는 HardwareMap 식이 아니다(hardwareMap.appContext.getResources().getIdentifier("x", …)는 찾기가 아니다)
          hw = false
          receiverText += `.${name}(…)`
        } else {
          plainNames.push(name)
          plainTokens.push(nameTok)
          // this.hwMap(그 클래스에 HardwareMap 형식으로 선언한 필드)도 hardwareMap처럼 HardwareMap 식이다
          hwLast =
            name === 'hardwareMap' ||
            (head.k === 'this' && segs.length === 0 && this.thisFieldIsHardwareMap(head.cls, name))
          if (hwLast) hw = true
          receiverText += `.${name}`
        }
        segs.push(seg)
        while (c.op(kk, '[')) {
          if (c.op(kk + 1, ']')) {
            kk = arrayType(kk)
            plain = false
            break
          }
          seg.index++
          plain = false
          hwLast = false
          receiverText += '[…]'
          kk = c.after(kk)
        }
        k = kk
        continue
      }
      if (c.op(k, '::')) {
        if (plain && head.k === 'name' && headIndex === 0) {
          this.emitNamedType(plainNames, plainTokens, 0, 'methodRef', c.texts[k + 1] ?? '')
          if (c.kw(k + 1, 'new')) emit = false
        }
        break
      }
      if (c.op(k, '<') && plain && head.k === 'name') {
        // 형식 인자가 붙은 메서드 참조(List<String>::size)
        const args = c.typeArgs(k, this.scope)
        if (args && c.op(args.end, '::')) {
          const ref = this.namedRef(plainNames, plainTokens, 0)
          ref.args.push(...args.args)
          this.x.emitTypeUse(ref, 'methodRef', '', `::${c.texts[args.end + 1] ?? ''}`)
          this.x.jumpAt.set(k, args.end)
          emit = false
        }
      }
      break
    }
    let chain: Chain | null = null
    if (emit && (segs.length > 0 || head.k === 'name')) {
      const [line, col] = this.x.pos(headTok)
      chain = { head, headIndex, line, col, segs, text: this.x.intern(text) }
      this.x.pushChain(chain)
    }
    const info: HeadInfo = {
      head,
      headTok,
      chain,
      segs: segs.length,
      end: k,
      plain,
      hwHead,
      hwLast,
      frame
    }
    this.x.headAt.set(headTok, info)
    return info
  }

  private namedRef(names: string[], tokens: number[], dims: number): TypeRef {
    const ref: TypeRef = { names: [...names], args: [], dims, scope: this.scope }
    this.c.nameTokens.set(ref, [...tokens])
    return ref
  }

  private emitNamedType(
    names: string[],
    tokens: number[],
    dims: number,
    ctx: 'classLit' | 'methodRef',
    member: string | null
  ): void {
    const ref = this.namedRef(names, tokens, dims)
    this.x.emitTypeUse(ref, ctx, '', ctx === 'classLit' ? '.class' : `::${member ?? ''}`)
  }

  private thisExpression(i: number): number {
    const c = this.c
    if (c.op(i - 1, '.')) {
      // Outer.this.f: 감싸는 클래스 중 그 이름의 클래스
      if (c.ident(i - 2) && !c.op(i - 3, '.') && c.op(i + 1, '.')) {
        const name = c.texts[i - 2]
        for (let k = this.cls; k >= 0; k = this.x.classes[k].outer) {
          if (this.x.classes[k].name === name) {
            this.lookahead(i + 1, { k: 'this', cls: k }, `${name}.this`, false, i, null)
            break
          }
        }
      }
      return i + 1
    }
    if (c.op(i + 1, '.'))
      this.lookahead(i + 1, { k: 'this', cls: this.cls }, 'this', false, i, null)
    else if (c.op(i + 1, '('))
      this.x.callAt.set(i + 1, { name: 'this', receiverText: 'this', receiverHw: false })
    return i + 1
  }

  private superExpression(i: number): number {
    const c = this.c
    if (c.op(i - 1, '.')) return i + 1
    if (c.op(i + 1, '.') && (c.ident(i + 2) || c.op(i + 2, '<')))
      this.lookahead(i + 1, { k: 'super', cls: this.cls }, 'super', false, i, null)
    else if (c.op(i + 1, '('))
      this.x.callAt.set(i + 1, { name: 'super', receiverText: 'super', receiverHw: false })
    return i + 1
  }

  // new T(…) [{…}] 또는 new T[…]. 형식 토큰은 건너뛰고 '('나 '['에서 다시 훑는다.
  private newExpression(i: number): number {
    const c = this.c
    // outer.new Inner(): Inner는 outer의 형식에서 풀어야 하므로 따라가지 않는다
    if (c.op(i - 1, '.')) return i + 1
    let j = i + 1
    if (c.op(j, '<')) {
      const args = c.typeArgs(j, this.scope)
      if (args) j = args.end
    }
    const t = this.x.parseType(j, this.scope)
    if (!t) return j
    let k = t.end
    // 다이아몬드(new ArrayList<>())
    if (c.op(k, '<') && c.op(k + 1, '>')) k += 2
    if (c.op(k, '(') && t.ref.dims === 0) {
      const text = typeText(t.ref)
      this.x.emitTypeUse(t.ref, 'new', 'new ', '(…)')
      this.x.callAt.set(k, { name: 'new', receiverText: `new ${text}`, receiverHw: false })
      const body = c.after(k)
      const anon = c.op(body, '{')
      const after = anon ? c.after(body) : body
      const head: Extract<Head, { k: 'new' }> = { k: 'new', type: t.ref, anon: null }
      if (anon) this.x.anonAt.set(body, { ref: t.ref, head })
      if (c.op(after, '.'))
        this.lookahead(after, head, `new ${text}(…)${anon ? ' {…}' : ''}`, false, i, null)
      return k
    }
    // 배열 생성: 원소 형식은 선언과 같은 형식 사용이다(만드는 곳이 아니다)
    if (c.op(k, '[') || t.ref.dims > 0)
      this.x.emitTypeUse(t.ref, 'decl', 'new ', c.op(k, '[') ? '[…]' : '')
    return k
  }

  private openParen(i: number): number {
    const c = this.c
    const header = this.headerAt.get(i)
    if (header) {
      this.brackets.push({ open: i, role: header })
      // for 머리의 첫 부분과 try 자원은 선언 자리다
      if (header === 'forHeader' || header === 'resources') this.stmt = true
      return i + 1
    }
    let call = this.x.callAt.get(i)
    // 미리 보기가 놓친 호출(세그먼트 한도 뒤 등): 앞의 이름이 호출 이름이다
    if (!call && c.ident(i - 1))
      call = { name: c.texts[i - 1], receiverText: c.texts[i - 1], receiverHw: false }
    if (call) {
      this.brackets.push({
        open: i,
        role: 'call',
        call: { ...call, argStart: i + 1, argIndex: 0, hwArg: false, literals: [], nameArgs: [] }
      })
      return i + 1
    }
    const close = c.end(i)
    if (c.op(close + 1, '->')) return this.lambdaParams(i, close)
    // ((T) e).f: 캐스트한 값에서 이어지는 연쇄
    if (c.op(i + 1, '(') && c.op(close + 1, '.')) {
      const inner = this.tryCast(i + 1)
      if (inner) {
        this.lookahead(
          close + 1,
          { k: 'cast', type: inner.types[0] },
          `((${typeText(inner.types[0])}) …)`,
          false,
          i,
          null
        )
      }
    }
    const cast = this.tryCast(i)
    if (cast) {
      for (const ref of cast.types) this.x.emitTypeUse(ref, 'cast', '(', ') …')
      return cast.end
    }
    this.brackets.push({ open: i, role: 'paren' })
    return i + 1
  }

  // ( Type [& Type]* ) 뒤에 피연산자가 오면 캐스트다. 캐스트를 지나 피연산자 앞을 돌려준다.
  private tryCast(open: number): { types: TypeRef[]; end: number } | null {
    const c = this.c
    if (!c.op(open, '(')) return null
    const close = c.end(open)
    let t = this.x.parseType(open + 1, this.scope)
    if (!t) return null
    const types = [t.ref]
    let j = t.end
    while (c.op(j, '&')) {
      t = this.x.parseType(j + 1, this.scope)
      if (!t) return null
      types.push(t.ref)
      j = t.end
    }
    if (j !== close || c.pair[close] !== open) return null
    const next = close + 1
    const kind = c.tokens[next]?.kind
    const operand =
      (kind !== undefined && OPERAND_KINDS.has(kind)) ||
      c.op(next, '(') ||
      c.op(next, '!') ||
      c.op(next, '~') ||
      c.kw(next, 'this') ||
      c.kw(next, 'new') ||
      c.kw(next, 'super')
    return operand ? { types, end: next } : null
  }

  // (a, b) -> … / (T a) -> …: 매개변수 프레임은 람다 몸통 끝까지. 형식 없는 매개변수는 null(필드를 가린다).
  private lambdaParams(open: number, close: number): number {
    const c = this.c
    const body = close + 2
    const vars = new Map<string, TypeRef | null>()
    let j = open + 1
    while (j < close) {
      while (c.kw(j, 'final') || (c.op(j, '@') && !c.kw(j + 1, 'interface')))
        j = c.kw(j, 'final') ? j + 1 : this.x.annotation(j, this.cls, this.scope)
      const t = this.x.parseType(j, this.scope)
      let nameTok: number
      let type: TypeRef | null = null
      if (t && c.ident(t.end)) {
        nameTok = t.end
        this.x.emitTypeUse(t.ref, 'decl', '', ` ${c.texts[nameTok]}`)
        type = isPrimitiveRef(t.ref) ? null : t.ref
      } else if (c.ident(j)) {
        nameTok = j
      } else break
      const name = this.x.intern(c.texts[nameTok])
      if (!vars.has(name)) vars.set(name, type)
      j = nameTok + 1
      if (!c.op(j, ',')) break
      j++
    }
    this.pushFrame(c.lambdaBodyEnd(body), vars)
    if (c.op(body, '{')) this.x.lambdaBlockAt.add(body)
    return body
  }

  private openBrace(i: number): number {
    const c = this.c
    const anon = this.x.anonAt.get(i)
    if (anon) {
      anon.head.anon = this.x.outlineAnonymous(i, this.cls, this.scope, anon.ref, this.snapshot())
      return c.after(i)
    }
    if (this.x.lambdaBlockAt.has(i)) {
      this.openBlock(i, 'lambda')
      return i + 1
    }
    // ')' 뒤의 '{'는 블록이다(머리를 놓친 경우). 가리는 지역 변수를 놓치지 않는 쪽으로 둔다.
    if (c.op(i - 1, ')') || c.op(i - 1, '->')) {
      this.openBlock(i, 'block')
      return i + 1
    }
    this.brackets.push({ open: i, role: 'array' })
    return i + 1
  }

  private close(i: number): number {
    const c = this.c
    const open = c.pair[i]
    if (open < 0) return i + 1
    let found = -1
    for (let b = this.brackets.length - 1; b >= 0; b--) {
      const role = this.brackets[b].role
      if (this.brackets[b].open === open) {
        found = b
        break
      }
      // '}'는 그 안의 닫히지 않은 괄호도 닫는다. ')'·']'는 블록 너머를 찾지 않는다.
      if (c.texts[i] !== '}' && (role === 'block' || role === 'lambda')) break
    }
    if (found < 0) return i + 1
    while (this.brackets.length > found + 1) this.finish(this.brackets.pop()!, -1)
    const bracket = this.brackets.pop()!
    this.finish(bracket, i)
    if (this.caseDepth > this.brackets.length) this.caseDepth = -1
    switch (bracket.role) {
      case 'header':
        this.stmt = true
        break
      case 'forHeader':
      case 'resources':
        this.decl = null
        this.stmt = true
        break
      case 'block': {
        const top = this.brackets[this.brackets.length - 1]
        this.stmt = top ? top.role === 'block' || top.role === 'lambda' : this.range.body
        break
      }
      default:
        this.stmt = false
    }
    return i + 1
  }

  private finish(bracket: Bracket, close: number): void {
    if (bracket.role !== 'call' || !bracket.call) return
    if (close >= 0) this.finishArg(bracket.call, close)
    this.finishCall(bracket.call)
  }

  private semicolon(i: number): number {
    const top = this.brackets[this.brackets.length - 1]
    if (this.decl && this.brackets.length === this.decl.depth) this.decl = null
    if (!top) this.stmt = this.range.body
    else if (top.role === 'block' || top.role === 'lambda' || top.role === 'resources')
      this.stmt = true
    else this.stmt = false
    return i + 1
  }

  private comma(i: number): number {
    const c = this.c
    const top = this.brackets[this.brackets.length - 1]
    if (top?.role === 'call' && top.call) {
      this.finishArg(top.call, i)
      top.call.argStart = i + 1
      top.call.argIndex++
    }
    // 선언자 이어 쓰기(Q4): , Ident [dims] (= , ; 또는 for 머리의 :)
    if (this.decl && this.brackets.length === this.decl.depth && c.ident(i + 1)) {
      let j = i + 2
      while (c.op(j, '[') && c.op(j + 1, ']')) j += 2
      if (
        c.op(j, '=') ||
        c.op(j, ',') ||
        c.op(j, ';') ||
        (top?.role === 'forHeader' && c.op(j, ':'))
      ) {
        return this.declareVar(i + 1, this.decl.type)
      }
    }
    return i + 1
  }

  // ── 문자열 ──

  private stringLiteral(i: number): void {
    const c = this.c
    const value = this.x.stringValue(i)
    if (value === null) return
    const top = this.brackets[this.brackets.length - 1]
    const call = top?.role === 'call' ? top.call : undefined
    // 호출의 온전한 인자: 앞이 그 호출의 '(' 또는 ',', 뒤가 ',' 또는 그 호출의 ')'
    const whole =
      call !== undefined &&
      ((c.op(i - 1, '(') && i - 1 === top!.open) || c.op(i - 1, ',')) &&
      (c.op(i + 1, ',') || (c.op(i + 1, ')') && c.pair[i + 1] === top!.open))
    if (whole) {
      const before = `${call.receiverText}(${call.argIndex === 0 ? '' : '…, '}`
      const after = c.op(i + 1, ',') ? ', …)' : ')'
      call.literals.push(this.x.pushString(i, value, before, after))
      return
    }
    // 선언자 초기값이면 그 이름을 붙인다('s = "arm"', 식의 일부면 's = "arm" …')
    const declarator = c.op(i - 1, '=') && c.ident(i - 2)
    const ends = c.op(i + 1, ';') || c.op(i + 1, ',') || c.op(i + 1, ')')
    this.x.pushString(
      i,
      value,
      declarator ? `${c.texts[i - 2]} = ` : '',
      declarator && !ends ? ' …' : ''
    )
  }

  // 인자 하나가 끝났다(end는 ',' 또는 ')'). HardwareMap 식인지, 이름만의 인자인지 적는다.
  private finishArg(call: CallState, end: number): void {
    const start = call.argStart
    if (end <= start) return
    const info = this.x.headAt.get(start)
    if (!info || info.end !== end) return
    if (info.segs === 0 ? info.hwHead : info.hwLast) {
      call.hwArg = true
      return
    }
    if (info.plain) call.nameArgs.push(info)
  }

  // 호출이 닫혔다: 찾기 호출이면 온전한 문자열 인자를 lookup으로 올리고, 이름 인자를 푼다
  private finishCall(call: CallState): void {
    const lookup = call.name.endsWith('Name') || call.receiverHw || call.hwArg
    if (!lookup) return
    for (const use of call.literals) use.tier = 'lookup'
    for (const info of call.nameArgs) this.lookupArg(info)
  }

  private lookupArg(info: HeadInfo): void {
    const head = info.head
    if (head.k === 'local') {
      // 같은 파일의 지역 변수: 초기값이 리터럴이면 그 리터럴이 찾기 사용처다
      if (info.segs === 0) {
        const tok = info.frame?.strs?.get(head.name)
        if (tok !== undefined) this.x.forceLookup(tok)
      } else if (info.chain) this.x.pushLookupRef(info.chain)
      return
    }
    if (head.k === 'name' && info.segs === 0) {
      const found = this.x.enclosingField(this.cls, head.name)
      if (found) {
        if ('field' in found) {
          const tok = this.x.fieldLitTok.get(found.field)
          if (tok !== undefined) this.x.forceLookup(tok)
        }
        return
      }
    }
    if (info.chain) this.x.pushLookupRef(info.chain)
  }
}
