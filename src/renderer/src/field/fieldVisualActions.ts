import i18n from 'i18next'
import type { StepReadResult } from '../../../shared/ipc'
import { confirmLargeImport, fileNameOf, LARGE_STEP_BYTES } from '../cad/importStep'
import { canStartImport } from '../cad/importStore'
import { isImportedModel, MESH_CACHE_TAG } from '../cad/stepImport'
import { rewriteFieldHistory } from '../editor/history'
import { showNotice } from '../editor/noticeStore'
import type { StoredCadFile } from '../project/projectFile'
import { replaceProjectNotice } from '../project/projectNotices'
import { setFieldVisualStatus, useProjectStore } from '../project/projectStore'
import { DEFAULT_FIELD_VISUAL_ALIGNMENT, withFieldVisualFile } from '../scene/fieldDoc'
import { useSceneStore } from '../scene/sceneStore'
import { applyFieldVisualStatus, loadFieldVisualWithProgress } from './fieldVisualLoad'

// Field 인스펙터 "필드 CAD (보기용)" 구역의 동작과 열기의 읽기(spec-4e §3.3). 모두 시작할 때 projectStore.session을 잡고
// await 뒤마다 다르면 아무것도 하지 않는다(relinkCad·reloadCad와 같은 꼴). 로봇 CAD의 마지막 방향 기억
// (sandbot:cadAlignment)은 읽지도 쓰지도 않는다(§1.3). projectActions를 import하지 않는다(순환 없음).

// 열 때 찾지 못한 필드 CAD의 파일 값(상대·절대 경로, spec-4e §2.3·§2.5). 저장이 serializeProject에 넘겨, 그 절대 경로가
// 지금 visual의 절대 경로와 같으면 file을 이 값 그대로 쓴다(못 찾은 팀원이 다른 일로 저장해도 원래 맞던 상대 경로를
// 지킨다). 다시 찾기·새 불러오기 성공에서 null, 프로젝트를 열 때 그 프로젝트의 값이다. [지우기]에서는 두어 지우기 → 실행
// 취소로 같은 경로가 돌아와도 파일 값을 지킨다. 다시 찾기(이 모듈)와 열기·저장(projectActions)이 함께 쓰므로 여기에 둔다.
let unresolvedFile: StoredCadFile | null = null

export function unresolvedFieldVisualFile(): StoredCadFile | null {
  return unresolvedFile
}

export function setUnresolvedFieldVisualFile(file: StoredCadFile | null): void {
  unresolvedFile = file
    ? { relativePath: file.relativePath, absolutePath: file.absolutePath }
    : null
}

const sessionNow = (): number => useProjectStore.getState().session

// 고른 STEP의 캐시 결과(크기만, 내용은 받지 않음)를 확인한다. 읽지 못하면 알리고 null, 캐시에 없는 큰 파일은 묻고 취소하면
// null(relinkCad와 같은 순서).
async function checkStep(path: string): Promise<StepReadResult | null> {
  const fileName = fileNameOf(path)
  let lookup: StepReadResult | null
  try {
    lookup = await window.api.readStepCached(path, MESH_CACHE_TAG, false)
  } catch (error) {
    console.error('STEP 확인 실패', error)
    showNotice('error', 'importFailed', { fileName })
    return null
  }
  if (!lookup) {
    showNotice('error', 'importReadFailed', { fileName })
    return null
  }
  if (
    !isImportedModel(lookup.model) &&
    lookup.size > LARGE_STEP_BYTES &&
    !(await confirmLargeImport([{ name: fileName, size: lookup.size }]))
  )
    return null
  return lookup
}

// 파일을 골라 확인하고 읽는다. 끝까지 같은 세션이고 읽었으면 그 경로, 아니면 null.
async function chooseAndLoad(session: number, defaultPath?: string): Promise<string | null> {
  const path = await window.api.chooseStepFile(
    i18n.t('field.inspector.cad.chooseTitle'),
    defaultPath
  )
  if (!path || sessionNow() !== session || !canStartImport()) return null
  const lookup = await checkStep(path)
  if (!lookup || sessionNow() !== session || !canStartImport()) return null
  const result = await loadFieldVisualWithProgress(path, lookup)
  if (sessionNow() !== session) return null
  if (result === 'missing') showNotice('error', 'importReadFailed', { fileName: fileNameOf(path) })
  return result === 'loaded' ? path : null
}

// [필드 CAD 불러오기…]. 읽었을 때만 visual을 정한다(고른 파일 + 기본 정렬 Y-up, 실행 취소 한 단계). 실패·취소면 문서는
// 그대로다(알림만).
export async function importFieldVisual(): Promise<void> {
  if (!canStartImport()) return
  const session = sessionNow()
  const path = await chooseAndLoad(session)
  if (!path) return
  useSceneStore.getState().setFieldVisual({
    fileName: fileNameOf(path),
    absolutePath: path,
    ...DEFAULT_FIELD_VISUAL_ALIGNMENT
  })
  setFieldVisualStatus(null)
  replaceProjectNotice('fieldCadMissing', null)
  setUnresolvedFieldVisualFile(null)
}

// [다시 불러오기]. 상태와 관계없이(그려져 있어도) 저장된 경로를 다시 읽는다. 성공하면 형상을 바꿔 끼우고(같은 경로에 고친
// 파일), 실패·취소면 이전 형상을 둔다.
export async function reloadFieldVisual(): Promise<void> {
  const visual = useSceneStore.getState().field.visual
  if (!visual || !canStartImport()) return
  const session = sessionNow()
  const path = visual.absolutePath
  setFieldVisualStatus({ path, status: 'loading' })
  const result = await loadFieldVisualWithProgress(path)
  applyFieldVisualStatus(path, result, session)
}

// [파일 다시 찾기]. 새 파일을 다 읽었을 때만 경로를 바꾸고, 실행 취소 기록 전체에서 이전 경로인 visual만 새 경로로 바꾼다
// (형상은 새 파일에서 읽었으므로 실행 취소로 경로만 되돌아가지 않게). 정렬은 그대로다. 실패·취소면 이전 파일·형상·상태를
// 그대로 둔다(알림만).
export async function relinkFieldVisual(): Promise<void> {
  const visual = useSceneStore.getState().field.visual
  if (!visual || !canStartImport()) return
  const session = sessionNow()
  const previous = visual.absolutePath
  const path = await chooseAndLoad(session, previous || undefined)
  if (!path) return
  const fileName = fileNameOf(path)
  rewriteFieldHistory((field) => withFieldVisualFile(field, previous, path, fileName))
  setFieldVisualStatus(null)
  replaceProjectNotice('fieldCadMissing', null)
  setUnresolvedFieldVisualFile(null)
}

// [지우기]. visual을 뗀다(실행 취소 한 단계). 상태·형상·못 찾은 파일 값은 그대로 둔다(경로를 든 상태라 실행 취소로 되살리면
// 그 경로의 상태·형상이 그대로 보인다).
export function clearFieldVisual(): void {
  useSceneStore.getState().setFieldVisual(null)
  replaceProjectNotice('fieldCadMissing', null)
}

// 프로젝트 열기가 로봇 CAD를 읽은 뒤 부른다. 세션이 다르면 하지 않는다. 그사이 [지우기]로 visual을 없앴거나 바꿨으면 읽지
// 않고 상태를 비운다(공식 파일 WASM 변환에 몇 분·메모리 수 GB를 쓸 이유가 없다, 비평 M7). 그 뒤 실행 취소로 되살리면
// 'unloaded'([다시 불러오기])다.
export async function loadProjectFieldVisual(path: string, session: number): Promise<void> {
  if (sessionNow() !== session) return
  if (useSceneStore.getState().field.visual?.absolutePath !== path) {
    if (useProjectStore.getState().fieldVisualStatus?.path === path) setFieldVisualStatus(null)
    return
  }
  const result = await loadFieldVisualWithProgress(path)
  applyFieldVisualStatus(path, result, session)
}
