import { describe, expect, it, vi } from 'vitest'
import { cancelAllImports, beginImport, endImport, isImporting } from '../cad/importStore'
import {
  cancelNotice,
  dismissNotice,
  formatElapsed,
  setNoticePhase,
  showNotice,
  useNoticeStore
} from './noticeStore'

describe('진행 알림', () => {
  it('경과 시간 형식', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_400)).toBe('1:05')
    expect(formatElapsed(3_725_000)).toBe('1:02:05')
  })

  it('[취소]는 처리기를 한 번만 부르고 버튼을 감춘다', () => {
    const onCancel = vi.fn()
    const id = showNotice('progress', 'importing', { fileName: 'a.step' }, { onCancel })
    const notice = (): ReturnType<typeof useNoticeStore.getState>['notices'][number] =>
      useNoticeStore.getState().notices.find((n) => n.id === id)!
    expect(notice()).toMatchObject({ cancellable: true })
    expect(notice().startedAt).toBeTypeOf('number')
    setNoticePhase(id, 'transfer', 0.42)
    expect(notice()).toMatchObject({ phase: 'transfer', fraction: 0.42 })
    cancelNotice(id)
    cancelNotice(id)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(notice().cancellable).toBe(false)
    dismissNotice(id)
    expect(useNoticeStore.getState().notices.some((n) => n.id === id)).toBe(false)
  })
})

describe('진행 중인 불러오기', () => {
  it('시작·끝을 세고, 모두 취소할 수 있다', () => {
    const a = beginImport()
    const b = beginImport()
    expect(isImporting()).toBe(true)
    cancelAllImports()
    expect(a.signal.aborted && b.signal.aborted).toBe(true)
    endImport(a)
    endImport(a)
    expect(isImporting()).toBe(true)
    endImport(b)
    expect(isImporting()).toBe(false)
  })
})
