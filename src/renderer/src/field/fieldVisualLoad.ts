import type { StepReadResult } from '../../../shared/ipc'
import {
  fileNameOf,
  importErrorNotice,
  loadStepModel,
  notifyIncomplete,
  StepImportError,
  type LoadedStep
} from '../cad/importStep'
import { beginImport, endImport } from '../cad/importStore'
import { useEditorStore } from '../editor/editorStore'
import {
  dismissNotice,
  setNoticePhase,
  showNotice,
  type NoticeActionKey
} from '../editor/noticeStore'
import { replaceProjectNotice } from '../project/projectNotices'
import { setFieldVisualStatus, useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import { buildFieldVisual, type BuiltFieldVisual } from './fieldVisualModel'
import { setLoadedFieldVisual } from './fieldVisualStore'

// 필드 CAD 읽기(spec-4e §3.3). loadCadWithProgress(cad/importStep.ts) 꼴: 한 번에 하나, 진행 알림·취소, 메시 캐시·
// 네이티브/WASM 그대로. 이 모듈과 fieldVisualActions는 projectActions를 import하지 않는다(순환 없음).

export type FieldVisualLoad = 'loaded' | 'missing' | 'failed' | 'cancelled'

// 필드 쪽 알림의 행동 버튼: Field 줄을 고른다(그래야 Field 인스펙터의 버튼이 보인다, 비평 U5. 4ab fieldAssumedSeason과 같음)
export const SHOW_FIELD_ACTION: { label: NoticeActionKey; run: () => void } = {
  label: 'showField',
  run: () => useEditorStore.getState().selectField()
}

// 필드 CAD 하나를 진행 알림(경과 시간·[취소])과 함께 읽어 형상 칸에 넣는다. 파일이 없으면 missing, 읽지 못하면 failed(오류
// 알림을 띄움), 취소하거나 그사이 다른 프로젝트를 열었으면 cancelled(형상을 만들지 않는다). 로봇 CAD와 달리 엔티티를
// 건너뛰거나 삼각형을 만들지 못한 메시가 있는 결과도 받는다(보기용이라 형상 id가 없어 순번이 밀려도 깨질 것이 없다, §1.11).
// 입력 모델은 바꾸지 않는다(같은 객체가 나중에 메시 캐시에 쓰인다).
export async function loadFieldVisualWithProgress(
  path: string,
  lookup?: StepReadResult
): Promise<FieldVisualLoad> {
  const fileName = fileNameOf(path)
  const session = useProjectStore.getState().session
  const controller = beginImport()
  const progress = showNotice(
    'progress',
    'importing',
    { fileName },
    { onCancel: () => controller.abort() }
  )
  try {
    let loaded: LoadedStep | null
    try {
      loaded = await loadStepModel(path, fileName, {
        signal: controller.signal,
        onPhase: (phase, fraction) => setNoticePhase(progress, phase, fraction),
        lookup
      })
    } catch (error) {
      if (error instanceof StepImportError && error.code === 'cancelled') return 'cancelled'
      const key = importErrorNotice(error)
      if (!key) return 'cancelled'
      console.error('필드 CAD 불러오기 실패', error)
      showNotice('error', key, { fileName }, { action: SHOW_FIELD_ACTION })
      return 'failed'
    }
    if (controller.signal.aborted) return 'cancelled'
    if (useProjectStore.getState().session !== session) return 'cancelled'
    if (!loaded) return 'missing'
    // 합치기는 큰 형식 배열을 만든다(공식 파일 약 54 MB). 메모리가 모자라 던지면 읽는 중 상태가 남지 않게 실패로 알린다.
    let built: BuiltFieldVisual
    try {
      built = buildFieldVisual(loaded.model)
    } catch (error) {
      console.error('필드 CAD 형상 만들기 실패', error)
      showNotice('error', 'importFailed', { fileName }, { action: SHOW_FIELD_ACTION })
      return 'failed'
    }
    setLoadedFieldVisual(path, built)
    notifyIncomplete(loaded, fileName)
    return 'loaded'
  } finally {
    dismissNotice(progress)
    endImport(controller)
  }
}

// 읽은 결과를 그 경로의 상태 칸(projectStore.fieldVisualStatus)과 알림에 넣는다. 세션이 다르면 아무것도 하지 않는다.
// 지금 문서 visual의 경로가 아니면(그사이 지웠거나 바꿈) 알림은 띄우지 않고, 상태 칸이 그 경로의 것일 때만 상태를 고친다
// (상태는 경로를 든 칸이라, 읽는 중에 지운 뒤 실행 취소로 되살리면 그 경로의 결과가 보여야 한다. 아니면 'loading'이 남는다).
export function applyFieldVisualStatus(
  path: string,
  result: FieldVisualLoad,
  session: number
): void {
  if (useProjectStore.getState().session !== session) return
  const current = useSceneStore.getState().field.visual
  const mine = current?.absolutePath === path
  if (!mine && useProjectStore.getState().fieldVisualStatus?.path !== path) return
  const fileName = current && mine ? current.fileName : fileNameOf(path)
  if (result === 'loaded') {
    setFieldVisualStatus(null)
    if (mine) replaceProjectNotice('fieldCadMissing', null)
    return
  }
  setFieldVisualStatus({ path, status: result })
  if (!mine) return
  if (result === 'missing') replaceProjectNotice('fieldCadMissing', { fileName }, SHOW_FIELD_ACTION)
  else if (result === 'cancelled')
    showNotice('warning', 'cadLoadCancelled', { fileName }, { action: SHOW_FIELD_ACTION })
}
