// 파일마다의 사실(usageFacts.ts, 씬과 관계없음)과 씬 기호표(usageSymbols.ts) → 사용처(spec §6.3–6.5).
// 순수 함수이고 결정적이다(같은 입력이면 같은 결과). 이름을 바꾸면 파일을 다시 읽지 않고 이것만 다시 부른다.
//
// - 형식 표: 생성 패키지가 아닌 파일의 이름 있는 최상위 클래스를 pkg.Name으로 두고(패키지는 경로가 아니라 package
//   선언에서), 중첩 클래스는 그 멤버 형식으로 찾는다. 지역·익명 클래스는 이름으로 풀지 않는다. 생성 클래스는 기호표만
//   정의한다(팀 파일이 생성 패키지를 선언해도 형식을 보태지 않는다).
// - 형식 이름(JLS 6.4.1, 7.5): 형식 범위를 안쪽부터(형식 매개변수 → 감싸는 클래스의 멤버 형식, 상속 포함) → 파일
//   (최상위 클래스 → 단일 import → 단일 static import의 멤버 형식) → 같은 패키지 → on-demand(후보가 하나일 때만)
//   → 전체 이름. 나머지 이름은 멤버 형식이다(선언 → 상속).
// - 변수 이름(JLS 6.5.2): 감싸는 클래스를 안쪽부터(선언 필드 → 상속 필드 → 지역·익명 클래스가 잡은 지역 변수) →
//   단일 static import → static on-demand(한 형식만) → 형식 → 패키지. 그래서 변수가 형식을 가린다.
// - 상속(JLS 8.2): private은 물려받지 않고, package-private는 하위 클래스가 같은 패키지일 때만 물려받는다. 알 수 없는
//   상위 형식(SDK·라이브러리)은 아무것도 보태지 않는다(그 필드는 없는 것으로 본다, spec §12).
// - 연쇄: 마지막 생성 멤버만 사용처다(robot.lift.liftLeft는 liftLeft). 생성 클래스에 없는 멤버는 생성 코드에 없는
//   이름이고, 찾지 못한 범위의 키(r:·g:)에 둔다. 생성 패키지에 없는 형식은 '*'다.
// - 문자열: 찾기(lookup)는 구성 이름이 있으면 그 장치들, 없으면 구성에 없는 이름이다. 같은 글자(text)는 맞는 장치에만
//   두고 세지 않는다. 다른 파일의 상수(Constants.LF)를 찾기 인자로 쓰면 그 초기값 리터럴 자리가 찾기 사용처다.
//
// 이름을 바꿀 때마다 모든 연쇄를 다시 맞추므로 할당을 줄인다: 머리·필드·메서드·멤버 형식은 (클래스, 이름)마다 한 번
// 풀고, 사용처는 가벼운 기록으로 모았다가 한도 안에 남는 것만 스니펫을 만든다.
// 어떤 사실에도 예외를 던지지 않게 쓴다(퍼즈 테스트). 상속·형식 풀이의 재귀는 방문 표시와 깊이 한도로 막는다.
import { GENERATED_JAVA_PACKAGE } from '../../hardware/naming'
import type {
  Chain,
  ClassFacts,
  FieldFacts,
  FileFacts,
  Head,
  MethodFacts,
  TypeRef,
  TypeUse
} from './usageFacts'
import {
  MAX_HITS_PER_KEY,
  MAX_HITS_PER_UNKNOWN_NAME,
  MAX_UNKNOWN_NAMES,
  MISSING_GENERATED_TYPE,
  type SymbolClass,
  type UsageCounts,
  type UsageHit,
  type UsageKey,
  type UsageKind,
  type UsageResult,
  type UsageSymbols
} from './usageTypes'

const GENERATED_SEGMENTS = GENERATED_JAVA_PACKAGE.split('.')

// 생성 클래스에는 메서드가 없다. Object의 메서드는 생성 코드에 없는 이름이 아니다(clone·finalize는 protected라
// javac가 다른 오류로 알린다).
const OBJECT_METHODS: ReadonlySet<string> = new Set([
  'getClass',
  'hashCode',
  'equals',
  'toString',
  'notify',
  'notifyAll',
  'wait',
  'clone',
  'finalize'
])

// 스니펫 길이 한도(usageTypes의 UsageHit)
const MAX_SNIPPET = 96
// 맞은 토큰 앞에 남기는 글자 수(화면은 12자까지 보인다)
const SNIPPET_LEAD = 24
// 상속·형식 풀이의 재귀 깊이 한도(실제 코드는 열 단계도 되지 않는다)
const MAX_DEPTH = 64
// 한도를 넘을 때 먼저 남기는 종류(코드 → 이름으로 → 같은 글자). 같은 글자 문자열이 코드 사용처를 밀어내지 않게 한다.
const KIND_RANK: Record<UsageKind, number> = {
  field: 0,
  constant: 0,
  type: 0,
  new: 0,
  unresolved: 0,
  lookup: 1,
  text: 2
}

// ───────────────────────────── 모델 ─────────────────────────────

type GenField = SymbolClass['fields'][number]

// 생성 클래스(기호표의 클래스 하나). 같은 이름의 필드가 둘이면(fieldNameCollision 오류) 둘 다 둔다.
// members는 이름 → 필드(같은 이름이면 필드가 상수보다 먼저). inst·stat은 이 형식의 받는 쪽 상태(만들어 둔 것).
type GenClass = {
  gen: true
  key: UsageKey
  name: string
  nested: Map<string, GenClass>
  fields: Map<string, GenField[]>
  constants: Map<string, UsageKey[]>
  members: Map<string, Member>
  inst?: WalkState
  stat?: WalkState
}

// 팀 클래스 하나(파일의 ClassFacts). 상위 형식은 처음 쓸 때 푼다. *Memo는 (이 클래스, 이름)마다 한 번 푼 결과다.
type TeamClass = {
  gen: false
  file: FileCtx
  idx: number
  facts: ClassFacts
  resolved: boolean
  superclass: Ty | null
  supers: Cls[]
  fieldMemo: Map<string, Member | null>
  methodMemo: Map<string, WalkState | typeof NO_METHODS>
  typeMemo: Map<string, Cls | null>
  inst?: WalkState
  stat?: WalkState
}

type Cls = GenClass | TeamClass

// 푼 참조 형식(배열 차원 포함).
// param은 형식 매개변수를 그 경계로 푼 것이다(<T extends RobotHardware>의 T). 멤버는 경계의 것이지만 T라고 쓴 자리는
// 생성 형식의 사용처가 아니다.
type Ty = { cls: Cls; dims: number; param?: true }

// 생성 패키지에 없는 형식이나 생성 클래스에 없는 멤버 형식: key 범위(r:·g:·'*')에 member가 없다.
// index는 ref.names에서 그 이름의 자리(위치·표시용).
type Missing = { missing: true; key: UsageKey; member: string; index: number }

// 형식 풀이 결과. null은 알 수 없음(SDK·java.lang·기본형·경계 없는 형식 매개변수 등).
type TypeResult = Ty | Missing | null

// 첫 이름을 형식으로 찾지 못했다(패키지 이름일 수 있다)
const NOT_FOUND = Symbol('notFound')
// 그 이름의 메서드가 없다(methodMemo에서 '아직 모름'과 가른다)
const NO_METHODS = Symbol('noMethods')

type FileCtx = {
  path: string
  facts: FileFacts
  pkg: string
  classes: TeamClass[]
  // (범위, 이름들) → 형식, 같은 TypeRef 객체 → 형식(지역 변수 머리는 같은 객체를 여러 번 푼다)
  typeMemo: Map<string, TypeResult>
  refMemo: Map<TypeRef, TypeResult>
  // 클래스 번호 → 이름 → 이름·호출 머리
  nameMemo: Map<number, Map<string, HeadResult>>
  callMemo: Map<number, Map<string, WalkState>>
}

// 멤버 필드 하나: 팀 필드, 생성 필드(장치·그룹), 생성 상수
type Member =
  | { k: 'team'; field: FieldFacts; owner: TeamClass }
  | { k: 'gen'; owner: GenClass; fields: GenField[] }
  | { k: 'const'; owner: GenClass; keys: UsageKey[] }

// 연쇄를 따라가는 중의 받는 쪽: 형식(static이면 형식 이름으로 쓴 자리), 패키지 이름, 알 수 없음(null)
type WalkState =
  { k: 'type'; cls: Cls; dims: number; static: boolean } | { k: 'pkg'; names: string[] } | null

// 머리 하나를 푼 결과. member는 머리 자신이 가리키는 필드(상속한 생성 필드, static import한 생성 상수, 팀 필드),
// missing은 머리가 없는 생성 형식이다(깨진 단일 import로 들여온 이름).
type HeadResult = { state: WalkState; member: Member | null; missing: Missing | null }

const UNKNOWN_HEAD: HeadResult = { state: null, member: null, missing: null }

// 형식의 받는 쪽 상태. 차원이 없으면 클래스마다 만들어 둔 것을 쓴다(연쇄마다 새로 만들지 않게).
function typeState(cls: Cls, dims: number, isStatic: boolean): WalkState {
  if (dims !== 0) return { k: 'type', cls, dims, static: false }
  if (isStatic) return (cls.stat ??= { k: 'type', cls, dims: 0, static: true })
  return (cls.inst ??= { k: 'type', cls, dims: 0, static: false })
}

function sameNames(a: readonly string[], b: readonly string[], length: number): boolean {
  if (a.length < length || b.length < length) return false
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameTy(a: Ty, b: Ty): boolean {
  return a.cls === b.cls && a.dims === b.dims
}

function isTy(result: TypeResult | typeof NOT_FOUND): result is Ty {
  return result !== null && result !== NOT_FOUND && !('missing' in result)
}

function isMissing(result: TypeResult | typeof NOT_FOUND): result is Missing {
  return result !== null && result !== NOT_FOUND && 'missing' in result
}

// ───────────────────────────── 결과 모으기 ─────────────────────────────

// 모은 사용처 하나(스니펫은 한도 안에 남을 때만 만든다). chain이면 seg번째 세그먼트(-1은 머리)가 맞은 자리이고,
// 아니면 text·mark가 사실이 만들어 둔 스니펫이다.
type RawHit = {
  path: string
  line: number
  col: number
  kind: UsageKind
  member: string | undefined
  chain: Chain | null
  seg: number
  text: string
  mark: [number, number]
}

// 문자열 자리 하나(같은 자리의 text는 lookup에 진다). src는 사실의 StringUse 또는 필드의 stringLit.
type StringSite = {
  path: string
  tier: 'lookup' | 'text'
  src: { value: string; line: number; col: number; snippet: string; mark: [number, number] }
}

const comparePath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function compareHits(a: { path: string; line: number; col: number }, b: typeof a): number {
  return comparePath(a.path, b.path) || a.line - b.line || a.col - b.col
}

function emptyCounts(): UsageCounts {
  return { field: 0, constant: 0, type: 0, new: 0, lookup: 0, text: 0, unresolved: 0 }
}

// 스니펫을 한도 안으로 자른다. 맞은 토큰(mark)은 남기고 앞뒤를 '…'로 줄인다.
function clipSnippet(
  text: string,
  mark: [number, number]
): { snippet: string; mark: [number, number] } {
  if (text.length <= MAX_SNIPPET) return { snippet: text, mark }
  let start = 0
  let prefix = ''
  if (mark[0] > SNIPPET_LEAD) {
    start = Math.min(mark[0] - SNIPPET_LEAD, Math.max(0, text.length - MAX_SNIPPET + 1))
    prefix = '…'
  }
  let body = prefix + text.slice(start)
  const shift = prefix.length - start
  const newMark: [number, number] = [mark[0] + shift, mark[1] + shift]
  if (body.length > MAX_SNIPPET) {
    body = body.slice(0, MAX_SNIPPET - 1) + '…'
    if (newMark[1] > body.length - 1) newMark[1] = body.length - 1
    if (newMark[0] > newMark[1]) newMark[0] = newMark[1]
  }
  return { snippet: body, mark: newMark }
}

// 연쇄의 글자: 머리, 세그먼트(호출은 '(…)', 첨자는 '[…]'), 맞은 자리 다음 세그먼트 하나까지
function chainSnippet(chain: Chain, hitSeg: number): { snippet: string; mark: [number, number] } {
  let text = chain.text + '[…]'.repeat(chain.headIndex)
  let mark: [number, number] = [0, chain.text.length]
  const lastSeg = Math.min(chain.segs.length - 1, hitSeg + 1)
  for (let i = 0; i <= lastSeg; i++) {
    const seg = chain.segs[i]
    text += '.'
    if (i === hitSeg) mark = [text.length, text.length + seg.name.length]
    text += seg.name
    if (seg.call) text += '(…)'
    text += '[…]'.repeat(seg.index)
  }
  if (lastSeg < chain.segs.length - 1) text += '…'
  return clipSnippet(text, mark)
}

function materialize(raw: RawHit): UsageHit {
  const { snippet, mark } = raw.chain
    ? chainSnippet(raw.chain, raw.seg)
    : clipSnippet(raw.text, raw.mark)
  const hit: UsageHit = {
    path: raw.path,
    line: raw.line,
    col: raw.col,
    kind: raw.kind,
    snippet,
    mark
  }
  if (raw.member !== undefined) hit.member = raw.member
  return hit
}

// 정렬한 목록에서 같은 자리(경로, 줄, 열)가 겹친 것을 지운다
function dedupe(list: RawHit[]): RawHit[] {
  const result: RawHit[] = []
  for (const raw of list) {
    const last = result[result.length - 1]
    if (last && last.path === raw.path && last.line === raw.line && last.col === raw.col) continue
    result.push(raw)
  }
  return result
}

class Collector {
  private readonly hits = new Map<UsageKey, RawHit[]>()
  private readonly unresolved = new Map<UsageKey, RawHit[]>()
  // 경로 → (줄, 열) → 문자열 자리
  private readonly strings = new Map<string, Map<number, StringSite>>()
  // 앞뒤 공백 뺀 구성 이름 → 장치 키들
  readonly names = new Map<string, UsageKey[]>()

  constructor(symbols: UsageSymbols) {
    for (const { name, keys } of symbols.lookupNames) {
      const list = this.names.get(name)
      if (list) list.push(...keys)
      else this.names.set(name, [...keys])
    }
  }

  private static push(map: Map<UsageKey, RawHit[]>, key: UsageKey, raw: RawHit): void {
    const list = map.get(key)
    if (list) list.push(raw)
    else map.set(key, [raw])
  }

  hit(key: UsageKey, raw: RawHit): void {
    Collector.push(this.hits, key, raw)
  }

  unresolvedHit(key: UsageKey, raw: RawHit): void {
    Collector.push(this.unresolved, key, raw)
  }

  // 같은 글자(text)는 구성 이름이 맞을 때만 남는다. 다른 파일에서 찾기 인자로 쓴 상수의 초기값(lookup)이 같은 자리의
  // text를 이긴다.
  string(site: StringSite): void {
    if (site.tier === 'text' && !this.names.has(site.src.value)) return
    let byPos = this.strings.get(site.path)
    if (!byPos) {
      byPos = new Map()
      this.strings.set(site.path, byPos)
    }
    // 파일은 256 KB까지라 열은 2^20보다 작다
    const pos = site.src.line * 1048576 + site.src.col
    const previous = byPos.get(pos)
    if (previous && !(previous.tier === 'text' && site.tier === 'lookup')) return
    byPos.set(pos, site)
  }

  finish(files: UsageResult['files']): UsageResult {
    const unknown = new Map<string, RawHit[]>()
    for (const byPos of this.strings.values()) {
      for (const { path, tier, src } of byPos.values()) {
        const raw: RawHit = {
          path,
          line: src.line,
          col: src.col,
          kind: tier,
          member: undefined,
          chain: null,
          seg: -1,
          text: src.snippet,
          mark: src.mark
        }
        const keys = this.names.get(src.value)
        if (keys) for (const key of keys) this.hit(key, raw)
        else if (tier === 'lookup') Collector.push(unknown, src.value, raw)
      }
    }

    const totals = new Map<UsageKey, UsageCounts>()
    const counts = (key: UsageKey): UsageCounts => {
      let entry = totals.get(key)
      if (!entry) {
        entry = emptyCounts()
        totals.set(key, entry)
      }
      return entry
    }
    const hits = new Map<UsageKey, UsageHit[]>()
    for (const key of [...this.hits.keys()].sort(comparePath)) {
      const list = dedupe(this.hits.get(key)!.sort(compareHits))
      const entry = counts(key)
      for (const raw of list) entry[raw.kind]++
      let kept = list
      if (list.length > MAX_HITS_PER_KEY) {
        kept = [...list]
          .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || compareHits(a, b))
          .slice(0, MAX_HITS_PER_KEY)
          .sort(compareHits)
      }
      hits.set(key, kept.map(materialize))
    }
    const unresolved = new Map<UsageKey, UsageHit[]>()
    for (const key of [...this.unresolved.keys()].sort(comparePath)) {
      const list = dedupe(this.unresolved.get(key)!.sort(compareHits))
      counts(key).unresolved += list.length
      unresolved.set(key, list.slice(0, MAX_HITS_PER_KEY).map(materialize))
    }
    const unknownNames = new Map<string, UsageHit[]>()
    for (const name of [...unknown.keys()].sort(comparePath).slice(0, MAX_UNKNOWN_NAMES)) {
      const list = dedupe(unknown.get(name)!.sort(compareHits))
      unknownNames.set(name, list.slice(0, MAX_HITS_PER_UNKNOWN_NAME).map(materialize))
    }
    const sortedTotals = new Map([...totals].sort(([a], [b]) => comparePath(a, b)))
    return { hits, totals: sortedTotals, unresolved, unknownNames, files }
  }
}

// ───────────────────────────── 풀이 ─────────────────────────────

class Resolver {
  private readonly collector: Collector
  private readonly files: FileCtx[] = []
  // 최상위 팀 클래스: 전체 이름 → 클래스(같은 이름이 둘이면 경로 순서로 처음 것)
  private readonly topLevel = new Map<string, TeamClass>()
  // 패키지 → 최상위 클래스의 단순 이름 → 클래스
  private readonly packages = new Map<string, Map<string, TeamClass>>()
  // 생성 로봇 클래스: 단순 이름 → 클래스
  private readonly robots = new Map<string, GenClass>()
  // 키 → 생성 클래스
  private readonly genByKey = new Map<UsageKey, GenClass>()
  // 클래스 이름이 잘못됐거나 겹치는 로봇의 클래스 이름(없는 형식으로 알리지 않는다)
  private readonly unavailableNames = new Set<string>()
  // 전체 이름(점으로 이은 것) → 형식
  private readonly qualifiedMemo = new Map<string, TypeResult>()
  private readonly skipped: string[] = []
  private readonly capped: string[] = []

  constructor(files: ReadonlyMap<string, FileFacts>, symbols: UsageSymbols) {
    this.collector = new Collector(symbols)
    for (const robot of symbols.robots) {
      const cls = this.genClass(robot)
      if (!this.robots.has(cls.name)) this.robots.set(cls.name, cls)
    }
    for (const { className } of symbols.unavailable) this.unavailableNames.add(className)
    for (const [path, facts] of files) {
      if (facts.skipped === 'unicodeEscape') {
        this.skipped.push(path)
        continue
      }
      if (facts.skipped) {
        this.capped.push(path)
        continue
      }
      const file: FileCtx = {
        path,
        facts,
        pkg: facts.pkg,
        classes: [],
        typeMemo: new Map(),
        refMemo: new Map(),
        nameMemo: new Map(),
        callMemo: new Map()
      }
      file.classes = facts.classes.map((cls, idx) => ({
        gen: false,
        file,
        idx,
        facts: cls,
        resolved: false,
        superclass: null,
        supers: [],
        fieldMemo: new Map(),
        methodMemo: new Map(),
        typeMemo: new Map()
      }))
      this.files.push(file)
      // 생성 패키지를 선언한 팀 파일은 형식을 보태지 않는다(생성 형식은 기호표만 정의한다)
      if (facts.pkg === GENERATED_JAVA_PACKAGE) continue
      for (const cls of file.classes) {
        if (cls.facts.outer !== -1 || cls.facts.local || cls.facts.name === null) continue
        const qname = facts.pkg ? `${facts.pkg}.${cls.facts.name}` : cls.facts.name
        if (!this.topLevel.has(qname)) this.topLevel.set(qname, cls)
        let byName = this.packages.get(facts.pkg)
        if (!byName) {
          byName = new Map()
          this.packages.set(facts.pkg, byName)
        }
        if (!byName.has(cls.facts.name)) byName.set(cls.facts.name, cls)
      }
    }
  }

  private genClass(symbol: SymbolClass): GenClass {
    const cls: GenClass = {
      gen: true,
      key: symbol.key,
      name: symbol.name,
      nested: new Map(),
      fields: new Map(),
      constants: new Map(),
      members: new Map()
    }
    if (!this.genByKey.has(cls.key)) this.genByKey.set(cls.key, cls)
    for (const field of symbol.fields) {
      const list = cls.fields.get(field.name)
      if (list) list.push(field)
      else cls.fields.set(field.name, [field])
      if (field.group && !cls.nested.has(field.group.name)) {
        cls.nested.set(field.group.name, this.genClass(field.group))
      }
    }
    for (const constant of symbol.constants) {
      const list = cls.constants.get(constant.name)
      if (list) list.push(constant.key)
      else cls.constants.set(constant.name, [constant.key])
    }
    for (const [name, fields] of cls.fields) cls.members.set(name, { k: 'gen', owner: cls, fields })
    for (const [name, keys] of cls.constants) {
      if (!cls.members.has(name)) cls.members.set(name, { k: 'const', owner: cls, keys })
    }
    return cls
  }

  run(): UsageResult {
    for (const file of this.files) {
      this.importUses(file)
      for (const use of file.facts.typeUses) this.typeUse(file, use)
      for (const chain of file.facts.chains) this.walk(file, chain, true)
      for (const use of file.facts.strings) {
        this.collector.string({ path: file.path, tier: use.tier, src: use })
      }
      for (const chain of file.facts.lookupRefs) this.lookupRef(file, chain)
    }
    return this.collector.finish({
      scanned: this.files.length,
      // 한도를 넘어 사실을 만들지 않은 파일(capped)은 너무 큰 파일로 센다(워커가 읽기 결과의 tooLarge와 합친다)
      tooLarge: [...this.capped],
      unicodeEscape: [...this.skipped],
      failed: []
    })
  }

  // ── 상위 형식 ──

  // 상위 형식(클래스 먼저, 그다음 인터페이스). 처음 쓸 때 푼다. 깊이 우선으로 찾는다(spec §6.3).
  private superTypes(cls: TeamClass): Cls[] {
    if (cls.resolved) return cls.supers
    // 풀기 전에 표시해 순환 상속(쓰는 중인 코드)에서 멈춘다
    cls.resolved = true
    const ref = cls.facts.superRef
    if (ref) {
      const t = this.resolveType(cls.file, ref)
      if (isTy(t) && t.dims === 0 && t.cls !== cls) {
        cls.superclass = t
        cls.supers.push(t.cls)
      }
    }
    for (const iface of cls.facts.ifaceRefs) {
      const t = this.resolveType(cls.file, iface)
      if (isTy(t) && t.dims === 0 && t.cls !== cls) cls.supers.push(t.cls)
    }
    return cls.supers
  }

  // ── 멤버 형식 ──

  // cls의 멤버 형식 name(선언 → 상속)
  private memberType(cls: Cls, name: string): Cls | null {
    if (cls.gen) return cls.nested.get(name) ?? null
    const memo = cls.typeMemo.get(name)
    if (memo !== undefined) return memo
    cls.typeMemo.set(name, null)
    const found = this.memberTypeIn(cls, name, 0, new Set())
    cls.typeMemo.set(name, found)
    return found
  }

  private memberTypeIn(cls: Cls, name: string, depth: number, visiting: Set<Cls>): Cls | null {
    if (cls.gen) return cls.nested.get(name) ?? null
    const idx = cls.facts.members.get(name)
    if (idx !== undefined) return cls.file.classes[idx] ?? null
    if (depth > MAX_DEPTH || visiting.has(cls)) return null
    visiting.add(cls)
    for (const sup of this.superTypes(cls)) {
      const found = this.memberTypeIn(sup, name, depth + 1, visiting)
      if (found) return found
    }
    return null
  }

  // names[from..]를 차례로 start의 멤버 형식으로 푼다. 생성 클래스에 없으면 Missing.
  private memberTypes(start: Cls, names: readonly string[], from: number): TypeResult {
    let cls = start
    for (let k = from; k < names.length; k++) {
      const next = this.memberType(cls, names[k])
      if (!next) {
        return cls.gen ? { missing: true, key: cls.key, member: names[k], index: k } : null
      }
      cls = next
    }
    return { cls, dims: 0 }
  }

  // ── 형식 이름 ──

  // 전체 이름(패키지부터). 생성 패키지는 기호표의 로봇 클래스만 있다. 형식이 아니면(패키지·알 수 없음) null.
  private resolveQualified(names: readonly string[]): TypeResult {
    const memoKey = names.join('.')
    const memo = this.qualifiedMemo.get(memoKey)
    if (memo !== undefined) return memo
    this.qualifiedMemo.set(memoKey, null)
    const result = this.qualified(names)
    this.qualifiedMemo.set(memoKey, result)
    return result
  }

  private qualified(names: readonly string[]): TypeResult {
    const g = GENERATED_SEGMENTS.length
    if (names.length > g && sameNames(names, GENERATED_SEGMENTS, g)) {
      const name = names[g]
      const robot = this.robots.get(name)
      if (!robot) {
        // 잘못됐거나 겹치는 로봇 클래스는 디스크에 그대로 있다(검증 오류가 이미 알린다)
        if (this.unavailableNames.has(name)) return null
        return { missing: true, key: MISSING_GENERATED_TYPE, member: name, index: g }
      }
      return this.memberTypes(robot, names, g + 1)
    }
    let qname = ''
    for (let i = 0; i < names.length; i++) {
      qname = i === 0 ? names[0] : `${qname}.${names[i]}`
      const top = this.topLevel.get(qname)
      if (top) return this.memberTypes(top, names, i + 1)
    }
    return null
  }

  // ref의 형식(차원 포함). (범위, 이름들)마다 한 번 푼다.
  private resolveType(file: FileCtx, ref: TypeRef | null): TypeResult {
    if (!ref || ref.names.length === 0) return null
    const memo = file.refMemo.get(ref)
    if (memo !== undefined) return memo
    let result = this.resolveTypeNames(file, ref.scope, ref.names)
    if (isTy(result) && ref.dims > 0) result = { ...result, dims: result.dims + ref.dims }
    file.refMemo.set(ref, result)
    return result
  }

  private resolveTypeNames(file: FileCtx, scope: number, names: readonly string[]): TypeResult {
    const memoKey = `${scope}\u0000${names.join('.')}`
    const memo = file.typeMemo.get(memoKey)
    if (memo !== undefined) return memo
    // 풀기 전에 알 수 없음으로 둔다(경계·상위 형식이 자기 자신을 다시 부르는 쓰는 중인 코드에서 멈춘다)
    file.typeMemo.set(memoKey, null)
    const first = this.resolveFirst(file, scope, names[0])
    let result: TypeResult
    if (first === NOT_FOUND) result = this.resolveQualified(names)
    else if (first === null || isMissing(first)) result = first
    // 형식 매개변수의 멤버 형식(T.Inner)은 Java에 없다
    else if (first.param) result = names.length === 1 ? first : null
    else result = this.memberTypes(first.cls, names, 1)
    file.typeMemo.set(memoKey, result)
    return result
  }

  // 단순 형식 이름 하나(JLS 6.4.1, 7.5). 형식이 아니면 NOT_FOUND(패키지 이름일 수 있다).
  private resolveFirst(file: FileCtx, scope: number, name: string): TypeResult | typeof NOT_FOUND {
    const scopes = file.facts.typeScopes
    // 1·2. 형식 범위를 안쪽부터: 형식 매개변수(첫 경계), 그 단계 클래스의 멤버 형식(선언 → 상속)
    for (let s = scope; s >= 0 && s < scopes.length;) {
      const level = scopes[s]
      if (level.params.has(name)) {
        const bound = level.params.get(name) ?? null
        if (!bound) return null
        const t = this.resolveType(file, bound)
        return isTy(t) ? { cls: t.cls, dims: t.dims, param: true } : null
      }
      if (level.cls >= 0) {
        const cls = file.classes[level.cls]
        const member = cls ? this.memberType(cls, name) : null
        if (member) return { cls: member, dims: 0 }
      }
      // 바깥 단계는 앞 번호다(쓰는 중인 코드에서도 끝나게)
      if (level.parent >= s) break
      s = level.parent
    }
    // 3. 파일: 최상위 클래스 → 단일 import → 단일 static import의 멤버 형식
    for (const cls of file.classes) {
      if (cls.facts.outer === -1 && !cls.facts.local && cls.facts.name === name) {
        return { cls, dims: 0 }
      }
    }
    const imports = file.facts.imports
    const single = imports.single.get(name)
    if (single) {
      const t = this.resolveQualified(single)
      // 깨진 import로 들여온 이름은 쓰는 자리마다 javac가 그 이름을 알린다
      if (isMissing(t)) return { missing: true, key: t.key, member: name, index: 0 }
      return t
    }
    const statics = imports.staticSingle.get(name)
    if (statics) {
      for (const entry of statics) {
        const owner = this.resolveQualified(entry.slice(0, -1))
        if (isMissing(owner)) return { missing: true, key: owner.key, member: name, index: 0 }
        // 들여온 형식을 알 수 없으면 그 멤버 형식일 수 있다
        if (!isTy(owner)) return null
        const member = this.memberType(owner.cls, name)
        if (member) return { cls: member, dims: 0 }
        // 생성 클래스에 그런 static 멤버가 없으면 import가 깨졌다(쓰는 자리마다 javac가 알린다)
        if (owner.cls.gen && !owner.cls.members.has(name)) {
          return { missing: true, key: owner.cls.key, member: name, index: 0 }
        }
      }
    }
    // 4. 같은 패키지(on-demand보다 먼저). 생성 패키지는 로봇 클래스다.
    if (file.pkg === GENERATED_JAVA_PACKAGE) {
      const robot = this.robots.get(name)
      if (robot) return { cls: robot, dims: 0 }
    } else {
      const same = this.packages.get(file.pkg)?.get(name)
      if (same) return { cls: same, dims: 0 }
    }
    // 5. on-demand: 후보가 하나일 때만(둘 이상이면 javac가 모호하다고 알린다). 알 수 없는 패키지는 보태지 않는다.
    const candidates = new Set<Cls>()
    for (const names of imports.onDemand) {
      if (
        names.length === GENERATED_SEGMENTS.length &&
        sameNames(names, GENERATED_SEGMENTS, names.length)
      ) {
        const robot = this.robots.get(name)
        if (robot) candidates.add(robot)
        continue
      }
      const owner = this.resolveQualified(names)
      if (isTy(owner)) {
        const member = this.memberType(owner.cls, name)
        if (member) candidates.add(member)
        continue
      }
      if (owner === null) {
        const inPackage = this.packages.get(names.join('.'))?.get(name)
        if (inPackage) candidates.add(inPackage)
      }
    }
    for (const names of imports.staticOnDemand) {
      const owner = this.resolveQualified(names)
      if (!isTy(owner)) continue
      const member = this.memberType(owner.cls, name)
      if (member) candidates.add(member)
    }
    if (candidates.size === 1) return { cls: [...candidates][0], dims: 0 }
    if (candidates.size > 1) return null
    return NOT_FOUND
  }

  // ── 필드·메서드 ──

  // cls의 필드 name(선언 → 상속). 상속은 JLS 8.2: private은 물려받지 않고, package-private는 지나온 하위 클래스가
  // 모두 같은 패키지일 때만. 찾지 못하면 null. (클래스, 이름)마다 한 번 푼다.
  private findField(cls: Cls, name: string): Member | null {
    if (cls.gen) return cls.members.get(name) ?? null
    const memo = cls.fieldMemo.get(name)
    if (memo !== undefined) return memo
    cls.fieldMemo.set(name, null)
    const found = this.fieldIn(cls, name, false, cls.file.pkg, 0, new Set())
    cls.fieldMemo.set(name, found)
    return found
  }

  private fieldIn(
    cls: Cls,
    name: string,
    inherited: boolean,
    pathPkg: string | null,
    depth: number,
    visiting: Set<Cls>
  ): Member | null {
    if (cls.gen) return cls.members.get(name) ?? null
    const field = cls.facts.fields.get(name)
    if (field) {
      // 물려받지 못하는 선언도 그 위의 같은 이름을 가린다
      if (inherited && field.access === 'private') return null
      if (inherited && field.access === 'package' && pathPkg !== cls.file.pkg) return null
      return { k: 'team', field, owner: cls }
    }
    if (depth > MAX_DEPTH || visiting.has(cls)) return null
    visiting.add(cls)
    // 이 클래스를 지나 위로 가면, 지나온 하위 클래스가 모두 같은 패키지일 때만 package-private를 물려받는다
    const nextPkg = !inherited || pathPkg === cls.file.pkg ? cls.file.pkg : null
    for (const sup of this.superTypes(cls)) {
      const found = this.fieldIn(sup, name, true, nextPkg, depth + 1, visiting)
      if (found) return found
    }
    return null
  }

  // cls의 메서드 name(선언·상속한 오버로드 모두)의 반환 형식. 오버로드가 모두 같은 형식을 돌려줄 때만 그 형식이다
  // (spec §6.3, A2·H18). 메서드가 없으면 undefined(생성 클래스는 늘 없다).
  private methodState(cls: Cls, name: string): WalkState | undefined {
    if (cls.gen) return undefined
    const memo = cls.methodMemo.get(name)
    if (memo !== undefined) return memo === NO_METHODS ? undefined : memo
    cls.methodMemo.set(name, null)
    const methods: { method: MethodFacts; owner: TeamClass }[] = []
    this.methodsIn(cls, name, false, cls.file.pkg, 0, new Set(), methods)
    if (!methods.length) {
      cls.methodMemo.set(name, NO_METHODS)
      return undefined
    }
    const state = this.methodType(methods)
    cls.methodMemo.set(name, state)
    return state
  }

  private methodsIn(
    cls: TeamClass,
    name: string,
    inherited: boolean,
    pathPkg: string | null,
    depth: number,
    visiting: Set<Cls>,
    result: { method: MethodFacts; owner: TeamClass }[]
  ): void {
    if (depth > MAX_DEPTH || visiting.has(cls)) return
    visiting.add(cls)
    for (const method of cls.facts.methods.get(name) ?? []) {
      if (inherited && method.access === 'private') continue
      if (inherited && method.access === 'package' && pathPkg !== cls.file.pkg) continue
      result.push({ method, owner: cls })
    }
    const nextPkg = !inherited || pathPkg === cls.file.pkg ? cls.file.pkg : null
    for (const sup of this.superTypes(cls)) {
      if (!sup.gen) this.methodsIn(sup, name, true, nextPkg, depth + 1, visiting, result)
    }
  }

  private methodType(methods: { method: MethodFacts; owner: TeamClass }[]): WalkState {
    let type: Ty | null = null
    for (const { method, owner } of methods) {
      const t = this.resolveType(owner.file, method.ret)
      if (!isTy(t)) return null
      if (type && !sameTy(type, t)) return null
      type = t
    }
    return type ? typeState(type.cls, type.dims, false) : null
  }

  private memberState(member: Member): WalkState {
    if (member.k === 'team') {
      const t = this.resolveType(member.owner.file, member.field.type)
      return isTy(t) ? typeState(t.cls, t.dims, false) : null
    }
    if (member.k === 'gen') {
      for (const field of member.fields) {
        const cls = field.group ? member.owner.nested.get(field.group.name) : undefined
        if (cls) return typeState(cls, 0, false)
      }
    }
    return null
  }

  // ── 머리 ──

  private head(file: FileCtx, head: Head): HeadResult {
    switch (head.k) {
      case 'local':
        return this.typeHead(this.resolveType(file, head.type))
      case 'name': {
        let byName = file.nameMemo.get(head.cls)
        if (!byName) {
          byName = new Map()
          file.nameMemo.set(head.cls, byName)
        }
        let result = byName.get(head.name)
        if (!result) {
          byName.set(head.name, UNKNOWN_HEAD)
          result = this.nameHead(file, head.cls, head.name)
          byName.set(head.name, result)
        }
        return result
      }
      case 'call': {
        let byName = file.callMemo.get(head.cls)
        if (!byName) {
          byName = new Map()
          file.callMemo.set(head.cls, byName)
        }
        let state = byName.get(head.name)
        if (state === undefined) {
          byName.set(head.name, null)
          state = this.callHead(file, head.cls, head.name)
          byName.set(head.name, state)
        }
        return { state, member: null, missing: null }
      }
      case 'this': {
        const cls = file.classes[head.cls]
        return cls ? { state: typeState(cls, 0, false), member: null, missing: null } : UNKNOWN_HEAD
      }
      case 'super': {
        const cls = file.classes[head.cls]
        if (!cls) return UNKNOWN_HEAD
        this.superTypes(cls)
        const sup = cls.superclass
        return sup
          ? { state: typeState(sup.cls, 0, false), member: null, missing: null }
          : UNKNOWN_HEAD
      }
      case 'new': {
        if (head.anon !== null) {
          const cls = file.classes[head.anon]
          return cls
            ? { state: typeState(cls, 0, false), member: null, missing: null }
            : UNKNOWN_HEAD
        }
        return this.typeHead(this.resolveType(file, head.type))
      }
      case 'cast':
        return this.typeHead(this.resolveType(file, head.type))
      default:
        return UNKNOWN_HEAD
    }
  }

  // 지역 변수·new·캐스트의 형식. 없는 생성 형식은 그 선언(형식 사용)이 이미 알렸으므로 알 수 없음이다.
  private typeHead(t: TypeResult): HeadResult {
    return isTy(t)
      ? { state: typeState(t.cls, t.dims, false), member: null, missing: null }
      : UNKNOWN_HEAD
  }

  private fromMember(member: Member): HeadResult {
    return { state: this.memberState(member), member, missing: null }
  }

  // 지역이 아닌 이름(JLS 6.5.2, 6.4.1): 감싸는 클래스(필드 → 잡힌 지역) → static import → 형식 → 패키지
  private nameHead(file: FileCtx, cls: number, name: string): HeadResult {
    for (let c = cls; c >= 0 && c < file.classes.length;) {
      const C = file.classes[c]
      const member = this.findField(C, name)
      if (member) return this.fromMember(member)
      const captured = C.facts.captured
      if (captured?.has(name))
        return this.typeHead(this.resolveType(file, captured.get(name) ?? null))
      // 감싸는 클래스는 앞 번호다(쓰는 중인 코드에서도 끝나게)
      if (C.facts.outer >= c) break
      c = C.facts.outer
    }
    const imports = file.facts.imports
    // 4. 단일 static import의 필드
    const statics = imports.staticSingle.get(name)
    if (statics) {
      let unknownOwner = false
      for (const entry of statics) {
        const owner = this.resolveQualified(entry.slice(0, -1))
        if (isMissing(owner)) {
          // 깨진 static import로 들여온 이름은 쓰는 자리마다 javac가 알린다
          return {
            state: null,
            member: null,
            missing: { missing: true, key: owner.key, member: name, index: 0 }
          }
        }
        if (!isTy(owner)) {
          unknownOwner = true
          continue
        }
        const member = this.findField(owner.cls, name)
        if (member) return this.fromMember(member)
        if (owner.cls.gen && !owner.cls.nested.has(name)) {
          return {
            state: null,
            member: null,
            missing: { missing: true, key: owner.cls.key, member: name, index: 0 }
          }
        }
      }
      if (unknownOwner) return UNKNOWN_HEAD
    }
    // 5. static on-demand의 필드: 한 형식에만 있을 때
    let found: Member | null = null
    let owners = 0
    for (const entry of imports.staticOnDemand) {
      const owner = this.resolveQualified(entry)
      if (!isTy(owner)) continue
      const member = this.findField(owner.cls, name)
      if (member) {
        found = member
        owners++
      }
    }
    if (owners === 1) return this.fromMember(found!)
    if (owners > 1) return UNKNOWN_HEAD
    // 6. 형식 이름(이어지는 연쇄는 static 자리). 알 수 없는 형식(SDK 등)이면 거기서 멈춘다.
    const scope = file.classes[cls]?.facts.typeScope ?? 0
    const first = this.resolveFirst(file, scope >= 0 ? scope : 0, name)
    const t = first === NOT_FOUND ? this.resolveQualified([name]) : first
    if (isMissing(t)) return { state: null, member: null, missing: t }
    if (isTy(t)) return { state: typeState(t.cls, 0, true), member: null, missing: null }
    if (first !== NOT_FOUND) return UNKNOWN_HEAD
    // 7. 패키지 이름
    return { state: { k: 'pkg', names: [name] }, member: null, missing: null }
  }

  // 한정 없는 메서드 호출 m(…): 감싸는 클래스의 메서드(선언·상속) → 단일 static import → static on-demand
  private callHead(file: FileCtx, cls: number, name: string): WalkState {
    for (let c = cls; c >= 0 && c < file.classes.length;) {
      const C = file.classes[c]
      const state = this.methodState(C, name)
      if (state !== undefined) return state
      if (C.facts.outer >= c) break
      c = C.facts.outer
    }
    const imports = file.facts.imports
    const statics = imports.staticSingle.get(name)
    if (statics) {
      for (const entry of statics) {
        const owner = this.resolveQualified(entry.slice(0, -1))
        if (!isTy(owner)) return null
        const state = this.methodState(owner.cls, name)
        if (state !== undefined) return state
      }
    }
    let found: WalkState = null
    let owners = 0
    for (const entry of imports.staticOnDemand) {
      const owner = this.resolveQualified(entry)
      if (!isTy(owner)) continue
      const state = this.methodState(owner.cls, name)
      if (state !== undefined) {
        found = state
        owners++
      }
    }
    return owners === 1 ? found : null
  }

  // ── 연쇄 ──

  // 연쇄 하나를 따라간다. emit이면 마지막 생성 멤버를 사용처로, 생성 클래스에 없는 멤버를 생성 코드에 없는 이름으로
  // 둔다. 돌려주는 것은 연쇄가 끝난 자리의 필드(끝까지 따라갔을 때만, 찾기 인자의 상수용)다.
  private walk(file: FileCtx, chain: Chain, emit: boolean): Member | null {
    const head = this.head(file, chain.head)
    if (head.missing) {
      if (emit) this.unresolvedAt(file, chain, -1, head.missing.key, head.missing.member)
      return null
    }
    // 마지막 생성 멤버(seg -1은 머리 자신)
    let pending: Member | null = head.member && head.member.k !== 'team' ? head.member : null
    let pendingSeg = -1
    let last: Member | null = head.member
    let state = this.index(head.state, chain.headIndex)
    let complete = true
    const segs = chain.segs
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      last = null
      if (!state) {
        complete = false
        break
      }
      if (state.k === 'pkg') {
        if (seg.call) {
          state = null
          complete = false
          break
        }
        const next = this.packageStep(state.names, seg.name)
        if (next && 'missing' in next) {
          if (emit) this.unresolvedAt(file, chain, i, next.key, seg.name)
          state = null
          complete = false
          break
        }
        state = this.index(next, seg.index)
        continue
      }
      // 배열: length와 Object의 메서드만 있다
      if (state.dims > 0) {
        state = null
        complete = false
        break
      }
      const cls = state.cls
      if (seg.call) {
        if (cls.gen) {
          if (emit && !OBJECT_METHODS.has(seg.name))
            this.unresolvedAt(file, chain, i, cls.key, seg.name)
          state = null
          complete = false
          break
        }
        state = this.methodState(cls, seg.name) ?? null
      } else {
        const member = this.findField(cls, seg.name)
        if (member) {
          last = member
          if (member.k !== 'team') {
            pending = member
            pendingSeg = i
          }
          state = this.memberState(member)
        } else {
          const nested = state.static ? this.memberType(cls, seg.name) : null
          if (nested) {
            // 형식 이름의 한정자(RobotHardware.Lift.X의 Lift)는 사용처가 아니다
            state = typeState(nested, 0, true)
          } else {
            if (emit && cls.gen) this.unresolvedAt(file, chain, i, cls.key, seg.name)
            state = null
            complete = false
            break
          }
        }
      }
      state = this.index(state, seg.index)
    }
    if (emit && pending) this.emitMember(file, chain, pendingSeg, pending)
    return complete ? last : null
  }

  private index(state: WalkState, count: number): WalkState {
    if (!state || count === 0) return state
    if (state.k !== 'type' || state.dims < count) return null
    return typeState(state.cls, state.dims - count, false)
  }

  // 패키지 이름 뒤의 이름 하나: 형식(static 자리), 더 긴 패키지, 없는 생성 형식
  private packageStep(pkg: string[], name: string): WalkState | Missing {
    const names = [...pkg, name]
    const g = GENERATED_SEGMENTS.length
    if (names.length === g + 1 && sameNames(names, GENERATED_SEGMENTS, g)) {
      const t = this.resolveQualified(names)
      if (isMissing(t)) return t
      return isTy(t) ? typeState(t.cls, 0, true) : null
    }
    const top = this.topLevel.get(names.join('.'))
    if (top) return typeState(top, 0, true)
    return { k: 'pkg', names }
  }

  // ── 사용처 ──

  private emitMember(file: FileCtx, chain: Chain, segIndex: number, member: Member): void {
    const seg = segIndex >= 0 ? chain.segs[segIndex] : null
    const line = seg ? seg.line : chain.line
    const col = seg ? seg.col : chain.col
    if (member.k === 'gen') {
      for (const field of member.fields) {
        this.collector.hit(field.key, this.chainHit(file, chain, segIndex, line, col, 'field'))
      }
    } else if (member.k === 'const') {
      for (const key of member.keys) {
        this.collector.hit(key, this.chainHit(file, chain, segIndex, line, col, 'constant'))
      }
    }
  }

  private chainHit(
    file: FileCtx,
    chain: Chain,
    seg: number,
    line: number,
    col: number,
    kind: UsageKind,
    member?: string
  ): RawHit {
    return { path: file.path, line, col, kind, member, chain, seg, text: '', mark: [0, 0] }
  }

  private unresolvedAt(
    file: FileCtx,
    chain: Chain,
    segIndex: number,
    key: UsageKey,
    name: string
  ): void {
    const seg = segIndex >= 0 ? chain.segs[segIndex] : null
    this.collector.unresolvedHit(
      key,
      this.chainHit(
        file,
        chain,
        segIndex,
        seg ? seg.line : chain.line,
        seg ? seg.col : chain.col,
        'unresolved',
        name
      )
    )
  }

  // 형식 사용 하나: 생성 클래스면 그 키의 형식·생성 사용처, 없는 생성 형식이면 생성 코드에 없는 이름
  private typeUse(file: FileCtx, use: TypeUse): void {
    const t = this.resolveType(file, use.ref)
    if (isMissing(t)) {
      // X.f::m·X.f.class의 이름들은 식일 수 있다(생성 클래스의 필드·상수면 연쇄가 따로 본다)
      if ((use.ctx === 'methodRef' || use.ctx === 'classLit') && this.isValueMember(t)) return
      this.unresolvedType(file, use, t)
      return
    }
    if (!isTy(t) || !t.cls.gen || t.param) return
    const last = use.ref.names.length - 1
    this.collector.hit(t.cls.key, {
      path: file.path,
      line: use.line,
      col: use.col,
      kind: use.ctx === 'new' ? 'new' : 'type',
      member: undefined,
      chain: null,
      seg: -1,
      text: use.snippet,
      mark: use.marks[last] ?? [0, use.snippet.length]
    })
  }

  private isValueMember(missing: Missing): boolean {
    const owner = this.genByKey.get(missing.key)
    return !!owner && owner.members.has(missing.member)
  }

  private unresolvedType(file: FileCtx, use: TypeUse, missing: Missing): void {
    const index = Math.min(missing.index, use.positions.length - 1)
    const [line, col] = use.positions[index] ?? [use.line, use.col]
    this.collector.unresolvedHit(missing.key, {
      path: file.path,
      line,
      col,
      kind: 'unresolved',
      member: missing.member,
      chain: null,
      seg: -1,
      text: use.snippet,
      mark: use.marks[index] ?? [0, use.snippet.length]
    })
  }

  // import는 보이지 않고, 풀리지 않을 때만 생성 코드에 없는 이름이다
  private importUses(file: FileCtx): void {
    const g = GENERATED_SEGMENTS.length
    for (const use of file.facts.importUses) {
      const names = use.ref.names
      let missing: Missing | null = null
      switch (use.importKind) {
        case 'single':
        case 'staticOnDemand': {
          const t = this.resolveQualified(names)
          if (isMissing(t)) missing = t
          break
        }
        case 'onDemand': {
          // 생성 패키지 자신이나 그 위 패키지는 형식이 아니다
          if (names.length <= g) break
          const t = this.resolveQualified(names)
          if (isMissing(t)) missing = t
          break
        }
        case 'static': {
          const owner = this.resolveQualified(names.slice(0, -1))
          if (isMissing(owner)) missing = owner
          else if (isTy(owner) && owner.cls.gen) {
            const name = names[names.length - 1]
            // static으로 들여올 수 있는 것은 상수와 중첩 클래스뿐이다(필드는 인스턴스 필드)
            if (!owner.cls.constants.has(name) && !owner.cls.nested.has(name)) {
              missing = { missing: true, key: owner.cls.key, member: name, index: names.length - 1 }
            }
          }
          break
        }
        default:
          break
      }
      if (missing) this.unresolvedType(file, use, missing)
    }
  }

  // ── 찾기 인자인 이름 ──

  // 찾기 호출의 인자인 이름(LF, Constants.LF)을 풀어, 끝이 초기값이 리터럴 하나인 팀 필드면 그 리터럴 자리를 찾기로 둔다
  private lookupRef(file: FileCtx, chain: Chain): void {
    const member = this.walk(file, chain, false)
    if (!member || member.k !== 'team' || !member.field.stringLit) return
    this.collector.string({
      path: member.owner.file.path,
      tier: 'lookup',
      src: member.field.stringLit
    })
  }
}

// 파일마다의 사실(경로 → 사실)과 씬 기호표 → 사용처. 순수 함수이고 결정적이다(같은 입력이면 같은 결과).
// files.tooLarge에는 한도를 넘어 사실을 만들지 않은 파일(capped)만 둔다(워커가 읽기 결과의 tooLarge와 합친다).
// failed는 빈 배열이다(워커가 채운다). unicodeEscape는 리터럴 밖 \u 때문에 건너뛴 파일이다.
export function resolveUsages(
  files: ReadonlyMap<string, FileFacts>,
  symbols: UsageSymbols
): UsageResult {
  return new Resolver(files, symbols).run()
}
