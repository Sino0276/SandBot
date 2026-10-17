import type {
  ExternalEditorChoice,
  ExternalEditorError,
  ExternalEditorState
} from '../../../shared/ipc'
import { fileNameOf } from '../cad/importStep'
import type { NoticeKey } from './noticeStore'

// 환경 설정 > External Tools > External Script Editor 선택 상자(PreferencesWindow)의 항목과 값.
// 설정은 메인 프로세스가 갖고(실행 파일 경로), 렌더러는 항목을 고른 결과만 setExternalEditor로 보낸다.

const SYSTEM = 'system'
const CUSTOM = 'custom'
// 찾아보기 항목의 값(선택 상자가 키 입력으로 이 값에 닿았는지 볼 때도 쓴다)
export const EXTERNAL_EDITOR_BROWSE = 'browse'
const DETECTED_PREFIX = 'detected:'

// labelKey는 preferences.externalTools.* 번역 키, text는 번역하지 않는 이름(편집기 제품 이름, 실행 파일 이름)
export type ExternalEditorOption =
  { value: string; labelKey: 'openByExtension' | 'browse' } | { value: string; text: string }

// 메인이 선택을 받지 않은 이유 → 알림 문구(notice.*)
export const EXTERNAL_EDITOR_ERROR_NOTICES: Record<ExternalEditorError, NoticeKey> = {
  unsupportedFile: 'externalEditorUnsupportedFile',
  invalidArgs: 'externalEditorInvalidArgs'
}

// 지금 설정에 해당하는 선택 상자 값
export function externalEditorValue(state: ExternalEditorState): string {
  if (state.kind === 'detected' && state.detectedId) return DETECTED_PREFIX + state.detectedId
  return state.kind === 'custom' ? CUSTOM : SYSTEM
}

// Unity 순서: 확장자로 열기(기본), 찾은 편집기, (직접 고른 편집기), 찾아보기…
export function externalEditorOptions(state: ExternalEditorState): ExternalEditorOption[] {
  const options: ExternalEditorOption[] = [{ value: SYSTEM, labelKey: 'openByExtension' }]
  for (const editor of state.detected)
    options.push({ value: DETECTED_PREFIX + editor.id, text: editor.name })
  // 저장된 편집기를 이번에 찾지 못했으면(지웠거나 옮김) 실행 파일 이름으로 보인다
  if (
    state.kind === 'detected' &&
    state.detectedId &&
    !state.detected.some((editor) => editor.id === state.detectedId)
  )
    options.push({
      value: DETECTED_PREFIX + state.detectedId,
      text: state.exe ? fileNameOf(state.exe) : state.detectedId
    })
  if (state.kind === 'custom' && state.exe)
    options.push({ value: CUSTOM, text: fileNameOf(state.exe) })
  options.push({ value: EXTERNAL_EDITOR_BROWSE, labelKey: 'browse' })
  return options
}

// 고른 값 → 메인에 보낼 선택. 찾아보기는 메인이 파일 대화상자를 띄운다(제목은 번역해서 넘긴다).
// 지금 쓰는 직접 고른 편집기(custom)처럼 바꿀 것이 없으면 null.
export function externalEditorChoice(
  value: string,
  browseTitle: string
): ExternalEditorChoice | null {
  if (value === EXTERNAL_EDITOR_BROWSE) return { kind: 'browse', title: browseTitle }
  if (value === SYSTEM) return { kind: 'system' }
  if (value.startsWith(DETECTED_PREFIX) && value.length > DETECTED_PREFIX.length)
    return { kind: 'detected', id: value.slice(DETECTED_PREFIX.length) }
  return null
}
