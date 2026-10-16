import { describe, expect, it } from 'vitest'
import {
  ariaKeyShortcut,
  shortcutCommand,
  shortcutLabel,
  type ShortcutKeyEvent,
  type ShortcutState
} from './shortcuts'

function key(code: string, options: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    code,
    key: options.key ?? code.replace(/^Key/, '').toLowerCase(),
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...options
  }
}

const IDLE: ShortcutState = {
  blocked: false,
  handlesOwnKeys: false,
  pendingTextEdit: false,
  dragging: false
}

const command = (event: ShortcutKeyEvent, state: Partial<ShortcutState> = {}): string | null =>
  shortcutCommand(event, { ...IDLE, ...state }).command

describe('shortcutCommand', () => {
  it('대화상자·메뉴·비행 중에는 아무 키도 받지 않는다(기본 동작도 막지 않는다)', () => {
    for (const event of [
      key('KeyS', { ctrlKey: true }),
      key('KeyZ', { ctrlKey: true }),
      key('KeyN', { ctrlKey: true, shiftKey: true }),
      key('Delete', { key: 'Delete' }),
      key('KeyF')
    ]) {
      expect(shortcutCommand(event, { ...IDLE, blocked: true })).toEqual({
        command: null,
        preventDefault: false
      })
    }
  })

  it('저장·열기는 입력칸 안에서도 받는다(Ctrl·Cmd)', () => {
    expect(command(key('KeyS', { ctrlKey: true }), { handlesOwnKeys: true })).toBe('save')
    expect(command(key('KeyO', { metaKey: true }))).toBe('open')
    expect(command(key('KeyS', { ctrlKey: true, altKey: true }))).toBeNull()
  })

  it('실행 취소는 확정하지 않은 입력칸에 맡기고, 핸들 드래그 중에는 기본 동작만 막는다', () => {
    expect(command(key('KeyZ', { ctrlKey: true }))).toBe('undo')
    expect(command(key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('redo')
    expect(command(key('KeyY', { ctrlKey: true }))).toBe('redo')
    expect(
      shortcutCommand(key('KeyZ', { ctrlKey: true }), { ...IDLE, pendingTextEdit: true })
    ).toEqual({ command: null, preventDefault: false })
    expect(shortcutCommand(key('KeyZ', { ctrlKey: true }), { ...IDLE, dragging: true })).toEqual({
      command: null,
      preventDefault: true
    })
  })

  it('Create Empty·Create Empty Child·Create Empty Parent(Unity 키)', () => {
    expect(command(key('KeyN', { ctrlKey: true, shiftKey: true }))).toBe('createEmpty')
    expect(command(key('KeyN', { metaKey: true, shiftKey: true }))).toBe('createEmpty')
    expect(command(key('KeyN', { altKey: true, shiftKey: true }))).toBe('createEmptyChild')
    expect(command(key('KeyG', { ctrlKey: true, shiftKey: true }))).toBe('createEmptyParent')
    // Shift가 없거나 조합이 다르면 아니다
    expect(command(key('KeyN', { ctrlKey: true }))).toBeNull()
    expect(command(key('KeyN', { ctrlKey: true, altKey: true, shiftKey: true }))).toBeNull()
    expect(command(key('KeyG', { altKey: true, shiftKey: true }))).toBeNull()
  })

  it('한글 입력 상태에서도 키 위치(code)로 받는다', () => {
    expect(command(key('KeyN', { key: 'ㅜ', ctrlKey: true, shiftKey: true }))).toBe('createEmpty')
    expect(command(key('KeyQ', { key: 'ㅂ' }))).toBe('toolView')
    expect(command(key('KeyF', { key: 'ㄹ' }))).toBe('focus')
  })

  it('새 조합키는 입력칸 안이나 핸들 드래그 중에는 쓰지 않고, 누르고 있어 반복되면 하나만 만든다', () => {
    const createEmpty = key('KeyN', { ctrlKey: true, shiftKey: true })
    expect(command(createEmpty, { handlesOwnKeys: true })).toBeNull()
    expect(command(createEmpty, { dragging: true })).toBeNull()
    expect(shortcutCommand({ ...createEmpty, repeat: true }, IDLE)).toEqual({
      command: null,
      preventDefault: true
    })
  })

  it('F2, F, Q/W/E, X, Delete', () => {
    expect(command(key('F2', { key: 'F2' }))).toBe('rename')
    expect(command(key('KeyF'))).toBe('focus')
    expect(command(key('KeyQ'))).toBe('toolView')
    expect(command(key('KeyW'))).toBe('toolTranslate')
    expect(command(key('KeyE'))).toBe('toolRotate')
    expect(command(key('KeyX'))).toBe('toggleHandleSpace')
    expect(command(key('Delete', { key: 'Delete' }))).toBe('delete')
    expect(command(key('Backspace', { key: 'Backspace' }))).toBe('delete')
    // Shift가 붙은 도구 키는 쓰지 않는다
    expect(command(key('KeyW', { shiftKey: true }))).toBeNull()
  })

  it('입력칸·Ctrl·Alt·핸들 드래그 중에는 한 글자 단축키를 쓰지 않는다', () => {
    expect(command(key('KeyF'), { handlesOwnKeys: true })).toBeNull()
    expect(command(key('Delete', { key: 'Delete' }), { handlesOwnKeys: true })).toBeNull()
    expect(command(key('KeyF', { ctrlKey: true }))).toBeNull()
    expect(command(key('KeyQ', { altKey: true }))).toBeNull()
    expect(command(key('Delete', { key: 'Delete' }), { dragging: true })).toBeNull()
    expect(command(key('F2', { key: 'F2' }), { dragging: true })).toBeNull()
  })

  it('누르고 있어 반복되는 입력은 Delete만 받는다', () => {
    expect(command(key('KeyQ', { repeat: true }))).toBeNull()
    expect(command(key('F2', { key: 'F2', repeat: true }))).toBeNull()
    expect(command(key('Delete', { key: 'Delete', repeat: true }))).toBe('delete')
  })
})

describe('단축키 표시', () => {
  it('Windows·Linux와 macOS 표기', () => {
    expect(shortcutLabel('createEmpty', false)).toBe('Ctrl+Shift+N')
    expect(shortcutLabel('createEmptyChild', false)).toBe('Alt+Shift+N')
    expect(shortcutLabel('createEmptyParent', false)).toBe('Ctrl+Shift+G')
    expect(shortcutLabel('rename', false)).toBe('F2')
    expect(shortcutLabel('delete', false)).toBe('Delete')
    expect(shortcutLabel('undo', false)).toBe('Ctrl+Z')
    expect(shortcutLabel('createEmpty', true)).toBe('⇧⌘N')
    expect(shortcutLabel('createEmptyChild', true)).toBe('⌥⇧N')
    expect(shortcutLabel('delete', true)).toBe('⌫')
  })

  it('aria-keyshortcuts 형식', () => {
    expect(ariaKeyShortcut('createEmpty', false)).toBe('Control+Shift+N')
    expect(ariaKeyShortcut('createEmpty', true)).toBe('Meta+Shift+N')
    expect(ariaKeyShortcut('createEmptyChild', false)).toBe('Alt+Shift+N')
    expect(ariaKeyShortcut('rename', false)).toBe('F2')
  })
})
