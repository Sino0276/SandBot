import { create } from 'zustand'
import type { Messages } from '../i18n/locales/ko'

// 하이어라키 위에 띄우는 진행·경고·오류 알림. 문구는 표시할 때 번역한다(언어를 바꿔도 따라 바뀜).
export type NoticeKey = keyof Messages['notice']
export type NoticeLevel = 'progress' | 'warning' | 'error'
// 진행 알림에 덧붙이는 단계(importPhase.*)
export type ImportPhase = keyof Messages['importPhase']
// 알림의 행동 버튼 문구(noticeAction.*, 예: 실행할 JDK가 없을 때 [JDK 설정 열기])
export type NoticeActionKey = keyof Messages['noticeAction']

export type Notice = {
  id: number
  level: NoticeLevel
  key: NoticeKey
  params: Record<string, string | number>
  // 진행 알림의 시작 시각(performance.now). 경과 시간을 보여 준다.
  startedAt?: number
  // [취소] 버튼을 보일지. 처리기는 스토어 밖(cancelHandlers)에 둔다(스토어에는 직렬화할 수 있는 값만).
  cancellable?: boolean
  // 행동 버튼(처리기는 cancelHandlers처럼 스토어 밖 actionHandlers). 누르면 알림을 닫고 처리기를 부른다.
  action?: NoticeActionKey
  phase?: ImportPhase
  // 단계 안의 진행률(0~1). 모르면 없다.
  fraction?: number
}

type ShowOptions = {
  onCancel?: () => void
  action?: { label: NoticeActionKey; run: () => void }
}

type NoticeState = {
  notices: Notice[]
  show: (
    level: NoticeLevel,
    key: NoticeKey,
    params?: Record<string, string | number>,
    options?: ShowOptions
  ) => number
  setPhase: (id: number, phase: ImportPhase | undefined, fraction?: number | null) => void
  dismiss: (id: number) => void
}

let nextId = 1
const cancelHandlers = new Map<number, () => void>()
const actionHandlers = new Map<number, () => void>()

export const useNoticeStore = create<NoticeState>()((set) => ({
  notices: [],
  show: (level, key, params = {}, options = {}) => {
    const id = nextId++
    const notice: Notice = { id, level, key, params }
    if (level === 'progress') notice.startedAt = performance.now()
    if (options.onCancel) {
      cancelHandlers.set(id, options.onCancel)
      notice.cancellable = true
    }
    if (options.action) {
      actionHandlers.set(id, options.action.run)
      notice.action = options.action.label
    }
    set((state) => ({ notices: [...state.notices, notice] }))
    return id
  },
  setPhase: (id, phase, fraction) =>
    set((state) => ({
      notices: state.notices.map((notice) =>
        notice.id === id ? { ...notice, phase, fraction: fraction ?? undefined } : notice
      )
    })),
  dismiss: (id) => {
    cancelHandlers.delete(id)
    actionHandlers.delete(id)
    set((state) => ({ notices: state.notices.filter((n) => n.id !== id) }))
  }
}))

export const showNotice = (...args: Parameters<NoticeState['show']>): number =>
  useNoticeStore.getState().show(...args)
export const dismissNotice = (id: number): void => useNoticeStore.getState().dismiss(id)
export const setNoticePhase = (
  id: number,
  phase: ImportPhase | undefined,
  fraction?: number | null
): void => useNoticeStore.getState().setPhase(id, phase, fraction)

// 진행 알림의 [취소]. 처리기는 한 번만 부르고, 알림은 작업이 끝나면서 닫힌다.
export function cancelNotice(id: number): void {
  const handler = cancelHandlers.get(id)
  cancelHandlers.delete(id)
  useNoticeStore.setState((state) => ({
    notices: state.notices.map((notice) =>
      notice.id === id ? { ...notice, cancellable: false } : notice
    )
  }))
  handler?.()
}

// 알림의 행동 버튼. 알림을 닫고 처리기를 부른다.
export function runNoticeAction(id: number): void {
  const handler = actionHandlers.get(id)
  dismissNotice(id)
  handler?.()
}

// 경과 시간 m:ss(한 시간을 넘으면 h:mm:ss)
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}
