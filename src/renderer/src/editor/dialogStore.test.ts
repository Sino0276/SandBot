import { afterEach, describe, expect, it } from 'vitest'
import {
  closeContextMenu,
  closePreferences,
  closeScriptPicker,
  isModalOpen,
  openContextMenu,
  openPreferences,
  openScriptPicker,
  showDialog,
  useDialogStore
} from './dialogStore'

describe('isModalOpen', () => {
  afterEach(() => {
    useDialogStore.getState().answer('cancel')
    closeContextMenu()
    closePreferences()
    closeScriptPicker()
  })

  it('아무것도 떠 있지 않으면 false', () => {
    expect(isModalOpen()).toBe(false)
  })

  it('확인 대화상자·우클릭 메뉴·환경 설정 창·스크립트 선택창이 떠 있으면 true', () => {
    void showDialog({ message: 'm', buttons: [], cancelId: 'cancel' })
    expect(isModalOpen()).toBe(true)
    useDialogStore.getState().answer('cancel')
    expect(isModalOpen()).toBe(false)

    openContextMenu({ x: 0, y: 0, label: 'menu', entries: [], returnFocus: null })
    expect(isModalOpen()).toBe(true)
    closeContextMenu()

    openPreferences()
    expect(isModalOpen()).toBe(true)
    closePreferences()
    expect(isModalOpen()).toBe(false)

    openScriptPicker({ objectId: 'p', anchor: { left: 0, top: 0, bottom: 20, width: 100 } })
    expect(isModalOpen()).toBe(true)
    closeScriptPicker()
    expect(isModalOpen()).toBe(false)
  })
})
