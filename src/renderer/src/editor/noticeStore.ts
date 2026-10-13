import { create } from 'zustand'
import type { Messages } from '../i18n/locales/ko'

// 하이어라키 위에 띄우는 진행·경고·오류 알림. 문구는 표시할 때 번역한다(언어를 바꿔도 따라 바뀜).
export type NoticeKey = keyof Messages['notice']
export type NoticeLevel = 'progress' | 'warning' | 'error'

export type Notice = {
  id: number
  level: NoticeLevel
  key: NoticeKey
  params: Record<string, string | number>
}

type NoticeState = {
  notices: Notice[]
  show: (level: NoticeLevel, key: NoticeKey, params?: Record<string, string | number>) => number
  dismiss: (id: number) => void
}

let nextId = 1

export const useNoticeStore = create<NoticeState>()((set) => ({
  notices: [],
  show: (level, key, params = {}) => {
    const id = nextId++
    set((state) => ({ notices: [...state.notices, { id, level, key, params }] }))
    return id
  },
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) }))
}))

export const showNotice = (...args: Parameters<NoticeState['show']>): number =>
  useNoticeStore.getState().show(...args)
export const dismissNotice = (id: number): void => useNoticeStore.getState().dismiss(id)
