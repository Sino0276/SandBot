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
