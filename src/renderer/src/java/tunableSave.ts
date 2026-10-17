import type { JavaLiteralEdit, ReadJavaFileResult } from '../../../shared/ipc'
import { literalFitsType, normalizeLiteral } from '../../../shared/java/javaLiteral'
import { parseTunables } from '../../../shared/java/tunables'
import type { TunableNode } from '../../../shared/java/tunableTypes'
import { dismissNotice, showNotice } from '../editor/noticeStore'
import { replaceCurrentTunables, rewriteTunableHistory } from '../editor/history'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import { ipcErrorDetail } from './ipcError'
import { putJavaSource } from './javaSources'
import {
  isEditableValue,
  rebaseAfterWrite,
  tunableFieldLabel,
  tunableNodes,
  withoutTunable,
  type TunableEdit,
  type TunableEdits,
  type TunableFileEdits,
  type TunableWrite
} from './tunableEdits'

// 저장(Ctrl+S) 때 튜닝 값을 Java 파일에 쓴다. project.json을 쓴 뒤, 생성 코드보다 먼저 한다(생성 코드는 다시 만들 수
// 있지만 튜닝 값은 사용자 값이다). 하드웨어 검증 오류와 관계없이 쓴다.
// 파일마다: 다시 읽고 파싱해 필드마다 편집할 때 본 값(base)과 지금 디스크 값을 비교한다. 다른 줄의 변경은 상관없다
// (필드를 위치가 아니라 이름으로 찾는다). 그 필드의 값이 SandBot 밖에서 바뀌었으면 쓰지 않고 파일 값을 따른다(알림).
// 쓰기는 파일 하나씩 원자적이다(메인이 해시·바꿀 자리 글자를 확인하고 임시 파일에 쓴 뒤 바꿔치기). 여러 파일을 함께
// 묶지는 못한다.

// 파일 값이 이긴 필드(쓰지 않음). 파일 값과 SandBot 값은 리터럴 글자다.
export type TunableConflict = { path: string; fieldId: string; fileValue: string; value: string }
// 파일이나 필드가 없어 쓰지 않은 편집(이름이 바뀌었을 수 있다. 따라가지 않는다)
export type TunableMissing = {
  path: string
  file: boolean
  fields: { fieldId: string; value: string }[]
}
// 쓰지 못한 파일(편집은 저장하지 않은 채로 남긴다)
export type TunableFailure = { path: string; detail: string; changed?: boolean }

export type TunableSaveOutcome = {
  // 파일에 썼거나 이미 그 값이던 필드(기록 전체를 새 디스크 값 기준으로 옮긴다)
  writes: TunableWrite[]
  // 지금 문서에서 뺄 편집(충돌·없음). 저장을 시작할 때 잡은 그 항목일 때만 뺀다(저장하는 동안 다시 고친 값은 남김).
  drops: { path: string; fieldId: string; entry: TunableEdit }[]
  conflicts: TunableConflict[]
  missing: TunableMissing[]
  failed: TunableFailure[]
  // 다시 읽거나 쓴 파일 내용(캐시에 넣는다)
  sources: { path: string; result: ReadJavaFileResult }[]
}

const emptyOutcome = (): TunableSaveOutcome => ({
  writes: [],
  drops: [],
  conflicts: [],
  missing: [],
  failed: [],
  sources: []
})

// 충돌·없음·실패가 없으면 true(이때만 저장이 끝난 것으로 쳐 창 닫기·다른 프로젝트 열기를 이어 간다)
export function isCompleteTunableSave(outcome: TunableSaveOutcome): boolean {
  return (
    outcome.conflicts.length === 0 && outcome.missing.length === 0 && outcome.failed.length === 0
  )
}

// 알림에 보일 지금 파일 값
function nodeText(node: TunableNode): string {
  if (node.kind === 'value') return node.literal ?? '—'
  return node.text ?? '—'
}

type FilePlan = {
  edits: JavaLiteralEdit[]
  writes: TunableWrite[]
  drops: TunableSaveOutcome['drops']
  conflicts: TunableConflict[]
  missingFields: TunableMissing['fields']
}

// 읽은 내용으로 필드마다 할 일을 정한다
function planFile(
  path: string,
  read: Extract<ReadJavaFileResult, { ok: true }>,
  entries: TunableFileEdits
): FilePlan {
  const plan: FilePlan = { edits: [], writes: [], drops: [], conflicts: [], missingFields: [] }
  const nodes = tunableNodes(parseTunables(read.text))
  for (const [fieldId, entry] of Object.entries(entries)) {
    const node = nodes.get(fieldId)
    const drop = (): void => {
      plan.drops.push({ path, fieldId, entry })
    }
    if (!node) {
      plan.missingFields.push({ fieldId, value: entry.value })
      drop()
      continue
    }
    // 파일을 쓸 수 없게 됐거나(인코딩 등), 리터럴이 아니게 됐거나(식), 형식이 바뀌어 값이 맞지 않으면(double → float)
    // 파일 값을 따른다
    if (!read.editable || !isEditableValue(node) || !literalFitsType(node.type, entry.value)) {
      plan.conflicts.push({ path, fieldId, fileValue: nodeText(node), value: entry.value })
      drop()
      continue
    }
    const literal = normalizeLiteral(node.literal)
    // 이미 그 값이다(다른 편집기에서 같은 값으로 고침): 쓰지 않고 기록만 새 디스크 값 기준으로 옮긴다
    if (literal === entry.value) {
      plan.writes.push({ path, fieldId, before: entry.base, after: entry.value })
      continue
    }
    if (literal !== entry.base) {
      plan.conflicts.push({ path, fieldId, fileValue: node.literal, value: entry.value })
      drop()
      continue
    }
    const { start, end } = node.span
    plan.edits.push({ start, end, expected: read.text.slice(start, end), text: entry.value })
    plan.writes.push({ path, fieldId, before: entry.base, after: entry.value })
  }
  plan.edits.sort((a, b) => a.start - b.start)
  return plan
}

function commitPlan(outcome: TunableSaveOutcome, path: string, plan: FilePlan): void {
  outcome.writes.push(...plan.writes)
  outcome.drops.push(...plan.drops)
  outcome.conflicts.push(...plan.conflicts)
  if (plan.missingFields.length > 0)
    outcome.missing.push({ path, file: false, fields: plan.missingFields })
}

// 파일이 없다: 모든 편집을 버리고 알린다
function fileMissing(outcome: TunableSaveOutcome, path: string, entries: TunableFileEdits): void {
  const fields = Object.entries(entries).map(([fieldId, entry]) => {
    outcome.drops.push({ path, fieldId, entry })
    return { fieldId, value: entry.value }
  })
  outcome.missing.push({ path, file: true, fields })
}

async function saveFile(
  root: string,
  path: string,
  entries: TunableFileEdits,
  outcome: TunableSaveOutcome
): Promise<void> {
  // 읽은 뒤 쓰기 전에 파일이 바뀌었으면(changed) 다시 읽어 한 번 더 해 본다
  for (let attempt = 0; attempt < 2; attempt++) {
    let read: ReadJavaFileResult
    try {
      read = await window.api.readJavaFile(root, path)
    } catch (error) {
      outcome.failed.push({ path, detail: ipcErrorDetail(error) })
      return
    }
    outcome.sources.push({ path, result: read })
    if (!read.ok) {
      if (read.code === 'missing') fileMissing(outcome, path, entries)
      else outcome.failed.push({ path, detail: read.detail || read.code })
      return
    }
    let plan: FilePlan
    try {
      plan = planFile(path, read, entries)
    } catch (error) {
      console.error('튜닝 값을 읽지 못했다', error)
      outcome.failed.push({ path, detail: ipcErrorDetail(error) })
      return
    }
    if (plan.edits.length === 0) {
      commitPlan(outcome, path, plan)
      return
    }
    let result
    try {
      result = await window.api.writeJavaLiterals(root, path, read.hash, plan.edits)
    } catch (error) {
      outcome.failed.push({ path, detail: ipcErrorDetail(error) })
      return
    }
    switch (result.status) {
      case 'written':
        outcome.sources.push({
          path,
          result: { ok: true, text: result.text, hash: result.hash, editable: true }
        })
        commitPlan(outcome, path, plan)
        return
      case 'changed':
        continue
      case 'missing':
        outcome.sources.push({ path, result: { ok: false, code: 'missing', detail: '' } })
        fileMissing(outcome, path, entries)
        return
      case 'refused':
        outcome.failed.push({ path, detail: result.reason })
        return
    }
  }
  outcome.failed.push({ path, detail: 'changed', changed: true })
}

// 저장을 시작할 때 잡은 튜닝 값을 파일마다 쓴다. 예외를 던지지 않는다(실패는 outcome.failed).
export async function saveTunables(
  root: string,
  tunables: TunableEdits
): Promise<TunableSaveOutcome> {
  const outcome = emptyOutcome()
  for (const [path, entries] of Object.entries(tunables)) {
    if (Object.keys(entries).length === 0) continue
    await saveFile(root, path, entries, outcome)
  }
  return outcome
}

// 튜닝 값 알림은 저장할 때마다 새로 띄운다(이전 저장의 알림을 지운다)
let tunableNotices: number[] = []

export function replaceTunableNotices(notices: Parameters<typeof showNotice>[]): void {
  for (const id of tunableNotices) dismissNotice(id)
  tunableNotices = notices.map((notice) => showNotice(...notice))
}

const fileNameOfPath = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export function tunableSaveNotices(outcome: TunableSaveOutcome): Parameters<typeof showNotice>[] {
  const notices: Parameters<typeof showNotice>[] = []
  for (const { path, fieldId, fileValue, value } of outcome.conflicts)
    notices.push([
      'warning',
      'tunableConflict',
      { file: fileNameOfPath(path), field: tunableFieldLabel(fieldId), fileValue, value }
    ])
  for (const { path, fields } of outcome.missing)
    notices.push([
      'warning',
      'tunableMissing',
      {
        file: fileNameOfPath(path),
        fields: fields
          .map(({ fieldId, value }) => `${tunableFieldLabel(fieldId)} = ${value}`)
          .join(', ')
      }
    ])
  for (const { path, detail, changed } of outcome.failed)
    notices.push(
      changed
        ? ['error', 'tunableFileBusy', { file: fileNameOfPath(path) }]
        : ['error', 'tunableWriteFailed', { file: fileNameOfPath(path), detail }]
    )
  return notices
}

// 저장 결과를 반영한다: 캐시에 새 내용을 넣고, 실행 취소 기록 전체를 새 디스크 값 기준으로 옮기고(rebase),
// 충돌·없음은 지금 문서에서 뺀다(파일 값을 따름. 기록의 이전 문서에는 남아, 되돌리면 다시 저장하지 않은 값이 된다).
// 캐시를 먼저 고쳐, 항목이 사라질 때 인스펙터가 이전 디스크 값으로 잠깐 돌아가지 않게 한다.
export function applyTunableSaveOutcome(root: string, outcome: TunableSaveOutcome): void {
  const { session } = useProjectStore.getState()
  for (const { path, result } of outcome.sources) putJavaSource(root, session, path, result)
  if (outcome.writes.length > 0)
    rewriteTunableHistory((tunables) => rebaseAfterWrite(tunables, outcome.writes))
  let current = useSceneStore.getState().tunables
  for (const { path, fieldId, entry } of outcome.drops)
    if (current[path]?.[fieldId] === entry) current = withoutTunable(current, path, fieldId)
  replaceCurrentTunables(current)
  replaceTunableNotices(tunableSaveNotices(outcome))
}
