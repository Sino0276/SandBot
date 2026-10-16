import { create } from 'zustand'

// 앱 안에서 띄우는 확인 대화상자. 네이티브 대화상자 대신 써서 문구를 i18n으로 번역한다.
export type DialogButton = { id: string; label: string; primary?: boolean }
type DialogRequest = { message: string; buttons: DialogButton[]; cancelId: string }

type DialogState = {
  request: (DialogRequest & { resolve: (id: string) => void }) | null
  answer: (id: string) => void
}

export const useDialogStore = create<DialogState>()((set, get) => ({
  request: null,
  answer: (id) => {
    get().request?.resolve(id)
    set({ request: null })
  }
}))

// 대화상자를 띄우고 누른 버튼 id를 돌려준다. Esc는 cancelId.
export function showDialog(request: DialogRequest): Promise<string> {
  return new Promise((resolve) => {
    useDialogStore.getState().request?.resolve(request.cancelId)
    useDialogStore.setState({ request: { ...request, resolve } })
  })
}

// 우클릭 메뉴(editor/ContextMenu.tsx가 그린다). 항목의 문구와 단축키 표시는 연 쪽이 번역해 넣는다.
export type ContextMenuEntry =
  | {
      type: 'item'
      id: string
      label: string
      // 표시용 단축키(editor/shortcuts.ts의 shortcutLabel)와 aria-keyshortcuts 값
      shortcut?: string
      ariaKeyShortcuts?: string
      disabled?: boolean
      onSelect: () => void
    }
  | { type: 'separator'; id: string }

export type ContextMenuRequest = {
  // 화면(client) 좌표. 메뉴가 창 밖으로 나가면 ContextMenu가 안쪽으로 옮긴다.
  x: number
  y: number
  label: string
  entries: ContextMenuEntry[]
  // 메뉴를 닫을 때 포커스를 돌려줄 요소(우클릭한 행)
  returnFocus: HTMLElement | null
}

type ContextMenuState = { menu: ContextMenuRequest | null }

export const useContextMenuStore = create<ContextMenuState>()(() => ({ menu: null }))

export function openContextMenu(menu: ContextMenuRequest): void {
  useContextMenuStore.setState({ menu })
}

// 메뉴를 닫는다. restoreFocus면 연 요소에 포커스를 돌려준다(Esc, 항목 실행. 바깥 클릭은 클릭한 곳이 포커스를 갖는다).
export function closeContextMenu(restoreFocus = false): void {
  const { menu } = useContextMenuStore.getState()
  if (!menu) return
  useContextMenuStore.setState({ menu: null })
  if (restoreFocus && menu.returnFocus?.isConnected) menu.returnFocus.focus({ preventScroll: true })
}

// 대화상자나 메뉴처럼 화면 위에 떠서 키보드를 차지하는 것이 있는지. 창 단축키와 파일 드롭은 이때 쓰지 않는다
// (메뉴가 떠 있는 동안 Delete가 뒤의 선택을 지우거나 Ctrl+Z가 메뉴 뒤에서 되돌리지 않게).
export function isModalOpen(): boolean {
  return useDialogStore.getState().request !== null || useContextMenuStore.getState().menu !== null
}
