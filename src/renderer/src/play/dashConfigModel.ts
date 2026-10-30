import type { DashConfigNode, DashFieldSource, DashVariableType } from '../../../shared/dashboard'
import type { TunableReadOnlyReason, TunableValueType } from '../../../shared/java/tunableTypes'
import { isLinkableJavaPath, JAVA_SOURCE_PREFIX } from '../../../shared/teamCodePaths'
import type { JavaSource } from '../java/javaSources'
import {
  diskLiteralKey,
  isEditableValue,
  sameLiteralKey,
  tunableEditValue,
  tunableNodes,
  type TunableEdit
} from '../java/tunableEdits'

// Config 탭(FTC Dashboard 설정 패널, 라이브러리 L2)의 순수 모델: 트리 펼치기, 형식별 입력 확인, 시작 값(baseline)과의
// 차이, [파일에 반영]이 쓸 TeamCode 튜닝 값 찾기. 실행 중 바꾼 값은 STOP하면 되돌아간다(JVM이 끝난다, Unity Play 모드).
// [파일에 반영]은 그 값을 인스펙터 튜닝 값(저장하지 않은 변경)으로 옮겨 Ctrl+S에 리터럴로 쓴다.

// 경로(루트부터의 이름들) → 키. 이름에는 어떤 글자든 올 수 있어 JSON으로 묶는다.
export function configPathKey(path: readonly string[]): string {
  return JSON.stringify(path)
}

// Dashboard의 withHardwareRoot 묶음(실제 Dashboard는 설정 패널이 아니라 하드웨어 패널에 보인다)
export const HARDWARE_CATEGORY = '__hardware__'

// 트리의 값 칸마다 경로 키 → 값(시작 값을 기억할 때)
export function configValues(root: DashConfigNode): Map<string, string> {
  const values = new Map<string, string>()
  const visit = (node: DashConfigNode, path: string[]): void => {
    if (node.kind === 'value') {
      values.set(configPathKey(path), node.value)
      return
    }
    for (const child of node.children) visit(child.node, [...path, child.name])
  }
  visit(root, [])
  return values
}

// 실행의 시작 값: 처음 받은 트리의 값. 나중에 생긴 변수(OpMode가 addConfigVariable 등으로 더한 것)는 처음 보인 값이다.
export function extendBaseline(
  baseline: ReadonlyMap<string, string> | null,
  root: DashConfigNode
): ReadonlyMap<string, string> {
  const values = configValues(root)
  if (!baseline) return values
  let next: Map<string, string> | null = null
  for (const [key, value] of values)
    if (!baseline.has(key)) {
      next ??= new Map(baseline)
      next.set(key, value)
    }
  return next ?? baseline
}

export type ConfigRow = {
  key: string
  path: string[]
  name: string
  depth: number
  node: DashConfigNode
}

// 보이는 행(펼친 묶음의 자식까지, 문서 순서). 루트의 자식이 첫 줄(깊이 0)이다. withHardwareRoot 묶음은 맨 뒤다.
export function configRows(
  root: DashConfigNode,
  isExpanded: (key: string) => boolean
): ConfigRow[] {
  const rows: ConfigRow[] = []
  const visit = (node: DashConfigNode, path: string[], depth: number): void => {
    if (node.kind !== 'custom') return
    const children = [...node.children]
    if (depth === 0) {
      const hardware = children.findIndex((child) => child.name === HARDWARE_CATEGORY)
      if (hardware >= 0) children.push(...children.splice(hardware, 1))
    }
    for (const child of children) {
      const childPath = [...path, child.name]
      const key = configPathKey(childPath)
      rows.push({ key, path: childPath, name: child.name, depth, node: child.node })
      if (child.node.kind === 'custom' && isExpanded(key)) visit(child.node, childPath, depth + 1)
    }
  }
  visit(root, [], 0)
  return rows
}

// 묶음 안의 값 칸 중 시작 값과 다른 것이 있는지(접힌 묶음에 표시)
export function hasChangedValue(
  node: DashConfigNode,
  path: readonly string[],
  baseline: ReadonlyMap<string, string>
): boolean {
  if (node.kind === 'value') {
    const start = baseline.get(configPathKey(path))
    return start !== undefined && start !== node.value
  }
  return node.children.some((child) => hasChangedValue(child.node, [...path, child.name], baseline))
}

const INT_RANGE = { min: -(2n ** 31n), max: 2n ** 31n - 1n }
const LONG_RANGE = { min: -(2n ** 63n), max: 2n ** 63n - 1n }
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

// 입력 → 사이드카에 보낼 값 글자(받을 수 없으면 null). 사이드카가 형식에 맞는지 다시 본다(B4).
// boolean은 true/false, 정수는 범위 안의 10진, float·double은 유한한 10진 수, 글자는 그대로, enum은 상수 이름.
export function configInputValue(
  type: DashVariableType,
  input: string,
  enumValues: readonly string[]
): string | null {
  switch (type) {
    case 'boolean':
      return input === 'true' || input === 'false' ? input : null
    case 'int':
    case 'long': {
      const text = input.trim()
      if (!/^[+-]?\d+$/.test(text) || text.length > 40) return null
      const value = BigInt(text)
      const range = type === 'int' ? INT_RANGE : LONG_RANGE
      return value < range.min || value > range.max ? null : value.toString()
    }
    case 'float':
    case 'double': {
      const text = input.trim()
      if (!DECIMAL.test(text) || text.length > 64) return null
      const value = Number(text)
      if (!Number.isFinite(value)) return null
      // float 범위를 넘으면 Float.parseFloat이 무한대가 된다
      if (type === 'float' && Math.abs(value) > 3.4028234663852886e38) return null
      return text.replace(/^\+/, '')
    }
    case 'string':
      return input
    case 'enum':
      return enumValues.includes(input) ? input : null
    case 'readonlyString':
      return null
  }
}

// ---- [파일에 반영] ----

// FieldProvider의 선언 클래스(바이너리 이름)·필드 → TeamCode 튜닝 값의 파일(TeamCode 기준 경로)과 필드 id.
// 경로는 패키지 폴더 + 최상위 클래스(바이너리 이름의 '$' 앞) + .java, 필드 id는 중첩 경로(Outer.Inner) + '#' + 필드 이름
// (shared/java/tunableTypes.ts). 연결할 수 있는 경로가 아니면(생성 패키지 등) null.
export function tunableTarget(source: DashFieldSource): { path: string; fieldId: string } | null {
  const binary = source.declaringClass
  if (typeof binary !== 'string' || binary === '' || source.field === '') return null
  const dot = binary.lastIndexOf('.')
  const packageName = dot < 0 ? '' : binary.slice(0, dot)
  const nested = binary.slice(dot + 1).split('$')
  if (nested.some((name) => name === '')) return null
  const folder = packageName === '' ? '' : `${packageName.split('.').join('/')}/`
  const path = `${JAVA_SOURCE_PREFIX}${folder}${nested[0]}.java`
  if (!isLinkableJavaPath(path)) return null
  return { path, fieldId: `${nested.join('.')}#${source.field}` }
}

const TUNABLE_TYPE: Readonly<Record<DashVariableType, TunableValueType | null>> = {
  boolean: 'boolean',
  int: 'int',
  long: 'long',
  float: 'float',
  double: 'double',
  string: 'String',
  readonlyString: null,
  enum: null
}

// [파일에 반영]을 쓸 수 없는 이유(play.config.applyBlocked.* 번역 키, 튜닝 값 칸의 이유는 그 키를 그대로)
export type ApplyBlock =
  // FieldProvider가 아님(addConfigVariable, 배열 원소 등)
  | 'noSource'
  // TeamCode 연결 경로가 될 수 없음(생성 패키지, 이름 규칙)
  | 'notTeamCode'
  | 'loading'
  | 'missing'
  | 'readFailed'
  // 파일 자체를 쓸 수 없음
  | 'file'
  // 파일에서 그 필드의 튜닝 값을 찾지 못함(다른 파일의 상위 클래스 필드, 지운 필드 등)
  | 'noField'
  // 파일의 형식이 Dashboard 형식과 다름
  | 'typeChanged'
  // 그 값을 리터럴로 쓸 수 없음(NaN·무한대, 범위)
  | 'value'
  // 이미 파일 값이다
  | 'inFile'
  // 이미 반영했다(저장하지 않은 튜닝 값)
  | 'applied'
  // 튜닝 값 칸의 고칠 수 없는 이유
  | { readOnly: TunableReadOnlyReason }

export type ApplyCheck =
  | { ok: true; path: string; fieldId: string; value: string; base: string }
  | { ok: false; block: ApplyBlock }

// 값 칸 하나의 [파일에 반영] 판정. source는 그 파일의 읽은 결과(아직 없으면 undefined), pending은 그 필드의 저장하지
// 않은 튜닝 값. 통과하면 sceneStore.setTunable(path, fieldId, value, base)로 옮긴다(인스펙터 ValueRow.commit과 같은 길).
export function checkApply(
  node: Extract<DashConfigNode, { kind: 'value' }>,
  target: { path: string; fieldId: string } | null,
  source: JavaSource | undefined,
  pending: TunableEdit | undefined
): ApplyCheck {
  if (!node.source) return { ok: false, block: 'noSource' }
  if (!target) return { ok: false, block: 'notTeamCode' }
  if (!source) return { ok: false, block: 'loading' }
  if (source.status === 'missing') return { ok: false, block: 'missing' }
  if (source.status === 'failed') return { ok: false, block: 'readFailed' }
  if (!source.editable || source.tunables.unicodeEscapes) return { ok: false, block: 'file' }
  const field = tunableNodes(source.tunables).get(target.fieldId)
  if (!field) return { ok: false, block: 'noField' }
  if (field.kind !== 'value')
    return { ok: false, block: { readOnly: field.reason ?? 'unsupportedType' } }
  const type = TUNABLE_TYPE[node.type]
  if (type === null) return { ok: false, block: { readOnly: field.reason ?? 'unsupportedType' } }
  if (!isEditableValue(field))
    return { ok: false, block: { readOnly: field.reason ?? 'expression' } }
  if (field.type !== type) return { ok: false, block: 'typeChanged' }
  const base = diskLiteralKey(field)
  const value = tunableEditValue(field, node.value)
  if (value === null || base === null) return { ok: false, block: 'value' }
  if (pending ? sameLiteralKey(pending.value, value) : sameLiteralKey(value, base))
    return { ok: false, block: pending ? 'applied' : 'inFile' }
  return { ok: true, path: target.path, fieldId: target.fieldId, value, base }
}
