import type { JavaFileProblem, JavaLiteralEdit, ReadJavaFileResult } from '../../../shared/ipc'
import {
  displayTunableLiteral,
  literalFitsType,
  normalizeLiteral
} from '../../../shared/java/javaLiteral'
import { parseTunables } from '../../../shared/java/tunables'
import type { TunableFile, TunableNode } from '../../../shared/java/tunableTypes'
import { dismissNotice, showNotice } from '../editor/noticeStore'
import { replaceCurrentTunables, rewriteTunableHistory } from '../editor/history'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import { ipcErrorDetail } from './ipcError'
import { putJavaSource } from './javaSources'
import {
  isEditableValue,
  rebaseAfterWrite,
  sameLiteralKey,
  tunableFieldLabel,
  tunableInputLiteral,
  tunableNodes,
  withoutTunable,
  type TunableEdit,
  type TunableEdits,
  type TunableFileEdits,
  type TunableValueNode,
  type TunableWrite
} from './tunableEdits'

// 저장(Ctrl+S) 때 튜닝 값을 Java 파일에 쓴다. project.json을 쓴 뒤, 생성 코드보다 먼저 한다(생성 코드는 다시 만들 수
// 있지만 튜닝 값은 사용자 값이다). 하드웨어 검증 오류와 관계없이 쓴다.
// 파일마다: 다시 읽고 파싱해 필드마다 편집할 때 본 값(base)과 지금 디스크 값을 비교한다. 다른 줄의 변경은 상관없다
// (필드를 위치가 아니라 이름으로 찾는다). 그 필드의 값이 SandBot 밖에서 바뀌었으면 쓰지 않고 파일 값을 따른다(알림).
// 파일 자체를 쓸 수 없는 상태(읽기 전용, 1 MB 초과, 다른 인코딩, 생성 표식, 리터럴 밖의 \u, TeamCode 밖을 가리키는
// 링크 등)면 그 파일의 편집은 모두 저장하지 않은 채로 남긴다(실패. 파일을 고친 뒤 다시 저장하면 쓴다).
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
export type TunableFailure =
  // 파일 상태 때문에 쓸 수 없다(읽기 전용, 1 MB 초과, 다른 인코딩, 생성 표식, 리터럴 밖의 \u, 메인이 받지 않는
  // 경로: 밖을 가리키는 링크·보통 파일 아님). 사용자가 파일을 바꿔야 풀린다.
  | { path: string; reason: JavaFileProblem | 'unicodeEscape' | 'notAllowed' }
  // 저장하는 동안 파일이 계속 바뀌었다
  | { path: string; reason: 'changed' }
  // 그 밖의 입출력 오류·거부(detail은 메인이 준 이유 그대로)
  | { path: string; reason: 'error'; detail: string }

const FILE_PROBLEMS: ReadonlySet<string> = new Set<JavaFileProblem>([
  'encoding',
  'generated',
  'readOnly',
  'tooLarge'
])

const isFileProblem = (reason: string): reason is JavaFileProblem => FILE_PROBLEMS.has(reason)

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

// 저장 뒤 실행 취소하면 되돌려 쓸 리터럴(TunableWrite.restore). 쓰기 직전 디스크 글자(raw: 바꿀 자리의 원래 글자,
// 모르면 base)를 그 필드에 쓸 수 있으면 그대로(원래 글자로 돌아간다. '- 5'처럼 비교용 글자와 다른 것도), 아니면 같은
// 값의 정규 리터럴이다.
function restoreLiteral(node: TunableValueNode, raw: string): string {
  if (literalFitsType(node.type, raw, node.boxed)) return raw
  return tunableInputLiteral(node.type, displayTunableLiteral(node.type, raw)) ?? raw
}

// 읽은 내용(file은 그 파싱 결과)으로 필드마다 할 일을 정한다(파일을 쓸 수 있을 때만 부른다)
function planFile(
  path: string,
  read: Extract<ReadJavaFileResult, { ok: true }>,
  file: TunableFile,
  entries: TunableFileEdits
): FilePlan {
  const plan: FilePlan = { edits: [], writes: [], drops: [], conflicts: [], missingFields: [] }
  const nodes = tunableNodes(file)
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
    // 리터럴이 아니게 됐거나(식), 형식이 바뀌어 값이 맞지 않으면(double → float) 파일 값을 따른다
    if (!isEditableValue(node) || !literalFitsType(node.type, entry.value, node.boxed)) {
      plan.conflicts.push({ path, fieldId, fileValue: nodeText(node), value: entry.value })
      drop()
      continue
    }
    const literal = normalizeLiteral(node.literal)
    // 이미 그 값이다(다른 편집기에서 같은 값으로 고침): 쓰지 않고 기록만 새 디스크 값 기준으로 옮긴다
    if (sameLiteralKey(entry.value, literal)) {
      plan.writes.push({
        path,
        fieldId,
        before: entry.base,
        after: literal,
        restore: restoreLiteral(node, entry.base)
      })
      continue
    }
    if (literal !== entry.base) {
      plan.conflicts.push({ path, fieldId, fileValue: node.literal, value: entry.value })
      drop()
      continue
    }
    const { start, end } = node.span
    plan.edits.push({ start, end, expected: read.text.slice(start, end), text: entry.value })
    plan.writes.push({
      path,
      fieldId,
      before: entry.base,
      after: normalizeLiteral(entry.value),
      // 지금 디스크 글자가 base 그대로이므로 그 글자를 되돌린다
      restore: restoreLiteral(node, node.literal)
    })
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
      outcome.failed.push({ path, reason: 'error', detail: ipcErrorDetail(error) })
      return
    }
    outcome.sources.push({ path, result: read })
    if (!read.ok) {
      if (read.code === 'missing') fileMissing(outcome, path, entries)
      else if (read.code === 'notAllowed') outcome.failed.push({ path, reason: 'notAllowed' })
      else outcome.failed.push({ path, reason: 'error', detail: read.detail || read.code })
      return
    }
    // 파일을 쓸 수 없는 상태면(읽기 전용 등) 필드를 보지 않고 모두 남긴다. 파일 값을 따르는 충돌이 아니다(파일을
    // 쓰기 가능하게 바꾸면 다음 저장이 쓴다). tooLarge는 내용이 없어 필드를 찾을 수도 없다.
    if (!read.editable) {
      outcome.failed.push({ path, reason: read.reason ?? 'encoding' })
      return
    }
    let plan: FilePlan
    try {
      const file = parseTunables(read.text)
      // 리터럴 밖에 \u가 생겼으면 모든 값이 읽기 전용이다. 필드가 바뀐 것(충돌)이 아니라 파일 상태라 편집을 남긴다.
      if (file.unicodeEscapes) {
        outcome.failed.push({ path, reason: 'unicodeEscape' })
        return
      }
      plan = planFile(path, read, file, entries)
    } catch (error) {
      console.error('튜닝 값을 읽지 못했다', error)
      outcome.failed.push({ path, reason: 'error', detail: ipcErrorDetail(error) })
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
      outcome.failed.push({ path, reason: 'error', detail: ipcErrorDetail(error) })
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
        // 읽은 뒤 파일 상태가 바뀌었으면(읽기 전용이 됨 등) 읽을 때 걸린 것과 같이 다룬다
        outcome.failed.push(
          isFileProblem(result.reason)
            ? { path, reason: result.reason }
            : result.reason.startsWith('notAllowed')
              ? { path, reason: 'notAllowed' }
              : { path, reason: 'error', detail: result.reason }
        )
        return
    }
  }
  outcome.failed.push({ path, reason: 'changed' })
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

// 실패 이유 → 알림 문구. 파일 상태는 무엇을 바꿔야 하는지 알리고, 그 밖의 오류만 메인의 이유를 그대로 보인다.
const FAILURE_NOTICES = {
  readOnly: 'tunableFileReadOnly',
  tooLarge: 'tunableFileTooLarge',
  encoding: 'tunableFileEncoding',
  generated: 'tunableFileGenerated',
  unicodeEscape: 'tunableFileUnicodeEscape',
  notAllowed: 'tunableFileNotAllowed',
  changed: 'tunableFileBusy'
} as const satisfies Record<Exclude<TunableFailure['reason'], 'error'>, string>

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
  for (const failure of outcome.failed) {
    const file = fileNameOfPath(failure.path)
    notices.push(
      failure.reason === 'error'
        ? ['error', 'tunableWriteFailed', { file, detail: failure.detail }]
        : ['error', FAILURE_NOTICES[failure.reason], { file }]
    )
  }
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
