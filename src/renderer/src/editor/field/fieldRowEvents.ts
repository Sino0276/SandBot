import { useEditorStore } from '../editorStore'
import { setDropIndicator } from '../hierarchyDnd'

// 하이어라키 맨 위 Field 줄의 사건(spec-4ab §1.9). HierarchyPanel은 클릭·우클릭·끌기를 영역 하나에서 받고 줄을
// [data-object-id]로 찾는다. Field 줄은 오브젝트 id가 없어 그대로면 "빈 공간"(선택 해제·만들기 메뉴·로봇 끝에 놓기)이 되므로,
// 영역의 처리기가 맨 앞에서 이것으로 가른다.

export const FIELD_ROW_ATTRIBUTE = 'data-field-row'

type Closest = { closest: (selector: string) => Element | null }

// 사건 대상을 품은 Field 줄(없으면 null)
export function fieldRowOf(target: EventTarget | null): Element | null {
  const element = target as Partial<Closest> | null
  return element && typeof element.closest === 'function'
    ? element.closest(`[${FIELD_ROW_ATTRIBUTE}]`)
    : null
}

export type FieldRowEventKind = 'click' | 'doubleClick' | 'contextMenu' | 'dragOver' | 'drop'

// 처리기가 쓰는 부분
export type FieldRowEvent = {
  target: EventTarget | null
  preventDefault: () => void
  dataTransfer?: { dropEffect: string } | null
}

// Field 줄 위의 사건이면 처리하고 true(영역 처리기는 거기서 끝낸다), 아니면 false.
// - 클릭: Field를 고른다(Ctrl·Shift 등 수식 키는 무시). 영역의 select(null)로 내려가지 않는다
// - 더블클릭: 아무것도 하지 않는다(Unity 씬 머리 줄에는 맞추기가 없다)
// - 우클릭(Shift+F10·메뉴 키 포함): 기본 메뉴만 막는다. 선택을 바꾸지 않고 메뉴를 열지 않는다
// - 끌기: 놓을 자리가 아니다. dropEffect none, 표시선 없음, preventDefault하지 않는다(빈 공간 놓기로 가지 않는다)
export function handleFieldRowEvent(kind: FieldRowEventKind, event: FieldRowEvent): boolean {
  if (!fieldRowOf(event.target)) return false
  switch (kind) {
    case 'click':
      useEditorStore.getState().selectField()
      return true
    case 'doubleClick':
      return true
    case 'contextMenu':
      event.preventDefault()
      return true
    case 'dragOver':
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
      setDropIndicator(null)
      return true
    case 'drop':
      setDropIndicator(null)
      return true
  }
}
