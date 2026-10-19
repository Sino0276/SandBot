import {
  displayTunableLiteral,
  formatTunableLiteral,
  normalizeLiteral
} from '../../../shared/java/javaLiteral'
import type { TunableFile, TunableNode, TunableValueType } from '../../../shared/java/tunableTypes'

// 저장하지 않은 튜닝 값(씬 문서의 sceneStore.tunables). 원본은 Java 파일이고, SandBot은 디스크 값과 다른 필드만
// {value, base}로 든다. value는 쓸 리터럴, base는 편집할 때 본 디스크 리터럴이다(둘 다 normalizeLiteral로 맞춘 글자).
// 디스크와 같아지면(value === base) 항목을 지우므로, 튜닝 값의 dirty는 "비어 있지 않음"이다.
// 저장(project.json과 함께 Ctrl+S)할 때만 파일에 쓰고, project.json에는 넣지 않는다.

export type TunableEdit = { readonly value: string; readonly base: string }
// 필드 id('Lift#kP', 'MecanumDrive.Params#kS') → 편집
export type TunableFileEdits = Readonly<Record<string, TunableEdit>>
// TeamCode 기준 경로 → 그 파일의 편집
export type TunableEdits = Readonly<Record<string, TunableFileEdits>>

// 빈 문서. 같은 객체를 써서, 비어 있는 것을 다시 비울 때 참조가 바뀌지 않게 한다(실행 취소에 빈 단계가 생기지 않음).
export const NO_TUNABLE_EDITS: TunableEdits = Object.freeze({})

// 저장 때 파일에 쓴(또는 이미 그 값이던) 필드. before는 그 편집의 base(쓰기 직전 디스크 값), after는 새 디스크 값.
// restore는 before를 되돌려 쓸 리터럴이다. before가 그 필드에 쓸 수 있는 리터럴이면(literalFitsType) before 그대로라
// 저장 뒤 실행 취소하고 다시 저장하면 파일이 원래 글자로 돌아간다(git diff가 비게). 쓸 수 없으면(제어 문자가 든 문자열
// 등) 같은 값의 정규 리터럴이다.
export type TunableWrite = {
  path: string
  fieldId: string
  before: string
  after: string
  restore: string
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

// 필드 하나를 value로 둔 문서. value가 base(디스크 값)와 같으면 항목을 지운다(파일의 마지막 항목이면 파일 키도).
// 바뀐 것이 없으면 같은 참조를 돌려준다.
export function withTunable(
  edits: TunableEdits,
  path: string,
  fieldId: string,
  value: string,
  base: string
): TunableEdits {
  const file = edits[path]
  const current = file?.[fieldId]
  if (value === base) {
    if (!current) return edits
    const rest = without(file, fieldId)
    return Object.keys(rest).length === 0 ? without(edits, path) : { ...edits, [path]: rest }
  }
  if (current && current.value === value && current.base === base) return edits
  return { ...edits, [path]: { ...file, [fieldId]: { value, base } } }
}

// 필드 하나의 항목을 지운 문서(없으면 같은 참조)
export function withoutTunable(edits: TunableEdits, path: string, fieldId: string): TunableEdits {
  const file = edits[path]
  if (!file?.[fieldId]) return edits
  const rest = without(file, fieldId)
  return Object.keys(rest).length === 0 ? without(edits, path) : { ...edits, [path]: rest }
}

export function hasTunableEdits(edits: TunableEdits): boolean {
  return Object.values(edits).some((file) => Object.keys(file).length > 0)
}

// 저장해 파일에 쓴 뒤 문서 하나(현재 문서와 실행 취소 기록의 모든 스냅샷)를 새 디스크 값 기준으로 옮긴다.
// 항목이 없는 스냅샷은 "그때 디스크 값(before)"을 뜻했으므로, 이제는 {value: restore, base: after}가 된다. 그래서 저장한
// 뒤 실행 취소하면 dirty가 되고, 다시 저장하면 파일이 이전 값으로 돌아간다. base가 before와 다른 항목은 다른 디스크
// 값을 보고 한 편집이라 그대로 둔다(저장할 때 충돌로 처리된다). 다만 그 값이 이미 새 디스크 값이면 지운다(디스크와
// 같은데 저장하지 않은 값·⚠ 파일 값으로 남지 않게). 저장하는 동안의 편집·실행 취소도 같은 식으로 맞는다.
export function rebaseAfterWrite(
  edits: TunableEdits,
  writes: readonly TunableWrite[]
): TunableEdits {
  let next = edits
  for (const { path, fieldId, before, after, restore } of writes) {
    const entry = next[path]?.[fieldId]
    if (entry && entry.base !== before) {
      if (entry.value === after) next = withoutTunable(next, path, fieldId)
      continue
    }
    next = withTunable(next, path, fieldId, entry ? entry.value : restore, after)
  }
  return next
}

// ---- 인스펙터 표시 ----

export type TunableValueNode = Extract<TunableNode, { kind: 'value' }>

// 파일의 모든 노드(객체의 자식 포함)를 id로 찾는 표. 파일 결과마다 한 번 만든다.
// 같은 형식의 static 필드 둘은 자식 id를 나눠 쓰므로, 같은 id면 처음 것을 둔다(같은 선언이라 위치도 같다).
const nodeMaps = new WeakMap<TunableFile, Map<string, TunableNode>>()

export function tunableNodes(file: TunableFile): Map<string, TunableNode> {
  let map = nodeMaps.get(file)
  if (map) return map
  map = new Map()
  const visit = (node: TunableNode): void => {
    if (!map!.has(node.id)) map!.set(node.id, node)
    if (node.kind === 'object') for (const child of node.children) visit(child)
  }
  for (const block of file.blocks) for (const field of block.fields) visit(field)
  nodeMaps.set(file, map)
  return map
}

// 고칠 수 있는 값 칸인지(파일 자체를 쓸 수 있는지는 따로 본다)
export function isEditableValue(
  node: TunableNode
): node is TunableValueNode & { literal: string; span: { start: number; end: number } } {
  return node.kind === 'value' && node.editable && node.literal !== null && node.span !== null
}

// 디스크 리터럴의 비교용 글자(편집의 base)
export function diskLiteralKey(node: TunableValueNode): string | null {
  return node.literal === null ? null : normalizeLiteral(node.literal)
}

// 입력칸 글자 → 쓸 리터럴(normalizeLiteral로 맞춘 글자). 그 형식으로 받을 수 없으면 null(입력을 버린다).
export function tunableInputLiteral(type: TunableValueType, input: string): string | null {
  const literal = formatTunableLiteral(type, input)
  return literal === null ? null : normalizeLiteral(literal)
}

// 인스펙터 입력(입력칸 글자, 체크박스 'true'/'false') → setTunable에 넘길 값. 받을 수 없으면 null.
// 디스크 리터럴과 같은 값이면(double의 2와 2.0, int의 0x10과 16) 디스크 리터럴을 돌려준다(항목이 없어진다).
// 그러지 않으면 같은 값을 다른 글자로 입력한 것만으로 dirty가 되고, 저장이 파일의 글자를 바꾼다.
export function tunableEditValue(node: TunableValueNode, input: string): string | null {
  const literal = tunableInputLiteral(node.type, input)
  const disk = diskLiteralKey(node)
  if (literal === null || node.literal === null || disk === null) return literal
  let canonicalDisk: string | null = null
  try {
    canonicalDisk = tunableInputLiteral(node.type, displayTunableLiteral(node.type, node.literal))
  } catch {
    canonicalDisk = null
  }
  return canonicalDisk === literal ? disk : literal
}

// 리터럴을 입력칸 글자로(고칠 수 없는 칸은 원래 글자 그대로)
function shownLiteral(node: TunableValueNode, literal: string, asValue: boolean): string {
  if (!asValue) return literal
  try {
    return displayTunableLiteral(node.type, literal)
  } catch {
    return literal
  }
}

export type TunableDisplay = {
  // 칸에 보일 글자: 저장하지 않은 값이 있으면 그것, 없으면 디스크 값
  text: string
  // 저장하지 않은 값이 있다
  pending: boolean
  // 편집할 때 본 값과 지금 디스크 값이 다르면 그 디스크 값(⚠ 파일 값: x). 같거나, 디스크 값이 이미 저장하지 않은
  // 값과 같으면(다음 저장이 항목을 지운다) null.
  fileValue: string | null
}

export function displayTunable(
  node: TunableValueNode,
  entry: TunableEdit | undefined,
  editable: boolean
): TunableDisplay {
  const disk = diskLiteralKey(node)
  const diskText = node.literal === null ? '' : shownLiteral(node, node.literal, editable)
  if (!entry) return { text: diskText, pending: false, fileValue: null }
  return {
    // 저장하지 않은 값은 쓸 수 있는 리터럴(SandBot이 만든 정규 리터럴, 실행 취소로 되돌릴 디스크 글자)이라 형식대로
    // 풀어 보인다
    text: shownLiteral(node, entry.value, true),
    pending: true,
    fileValue:
      entry.base === disk || entry.value === disk ? null : node.literal === null ? '—' : diskText
  }
}

// 알림에 쓰는 필드 이름('Lift.Pid#kD' → 'Lift.Pid.kD')
export function tunableFieldLabel(fieldId: string): string {
  return fieldId.replace('#', '.')
}
