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
  dragging: false,
  keyboardGamepad: false
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
    expect(command(key('KeyQ', { ctrlKey: true }))).toBeNull()
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

describe('하이어라키 보강 단축키', () => {
  it('Ctrl+X·V·Shift+V·A는 입력칸 밖에서만, Ctrl+F는 어디서나 검색칸으로', () => {
    expect(command(key('KeyX', { ctrlKey: true }))).toBe('cut')
    expect(command(key('KeyV', { ctrlKey: true }))).toBe('paste')
    expect(command(key('KeyV', { ctrlKey: true, shiftKey: true }))).toBe('pasteAsChild')
    expect(command(key('KeyA', { metaKey: true }))).toBe('selectAll')
    for (const code of ['KeyX', 'KeyV', 'KeyA'])
      expect(command(key(code, { ctrlKey: true }), { handlesOwnKeys: true })).toBeNull()
    expect(command(key('KeyF', { ctrlKey: true }))).toBe('search')
    expect(command(key('KeyF', { ctrlKey: true }), { handlesOwnKeys: true })).toBe('search')
    // 핸들을 끄는 중에는 옮기지 않는다
    expect(command(key('KeyV', { ctrlKey: true }), { dragging: true })).toBeNull()
  })

  it('H는 보이기·숨기기, Shift+H는 고립 보기(입력칸 안에서는 글자)', () => {
    expect(command(key('KeyH'))).toBe('toggleVisibility')
    expect(command(key('KeyH', { shiftKey: true }))).toBe('isolate')
    expect(command(key('KeyH'), { handlesOwnKeys: true })).toBeNull()
    expect(shortcutLabel('isolate', false)).toBe('Shift+H')
    expect(shortcutLabel('pasteAsChild', true)).toBe('⇧⌘V')
  })
})

describe('실행 단축키(Unity Play·Pause·Step)', () => {
  it('Ctrl+P 실행, Ctrl+Shift+P 일시 정지, Ctrl+Alt+P 한 단계(Cmd도 같다)', () => {
    expect(command(key('KeyP', { ctrlKey: true }))).toBe('play')
    expect(command(key('KeyP', { metaKey: true }))).toBe('play')
    expect(command(key('KeyP', { ctrlKey: true, shiftKey: true }))).toBe('pause')
    expect(command(key('KeyP', { ctrlKey: true, altKey: true }))).toBe('step')
    // 한글 입력 상태에서도 키 위치로
    expect(command(key('KeyP', { key: 'ㅔ', ctrlKey: true }))).toBe('play')
    // Ctrl 없는 P나 Ctrl+Alt+Shift+P는 아니다(기본 동작만 막는다)
    expect(command(key('KeyP'))).toBeNull()
    expect(
      shortcutCommand(key('KeyP', { ctrlKey: true, altKey: true, shiftKey: true }), IDLE)
    ).toEqual({ command: null, preventDefault: true })
  })

  it('입력칸·인스펙터·Console 안에서도 받고, 대화상자·메뉴·비행 중에는 받지 않는다', () => {
    const play = key('KeyP', { ctrlKey: true })
    expect(command(play, { handlesOwnKeys: true })).toBe('play')
    expect(command(play, { pendingTextEdit: true, handlesOwnKeys: true })).toBe('play')
    expect(command(key('KeyP', { ctrlKey: true, shiftKey: true }), { handlesOwnKeys: true })).toBe(
      'pause'
    )
    expect(shortcutCommand(play, { ...IDLE, blocked: true })).toEqual({
      command: null,
      preventDefault: false
    })
  })

  it('누르고 있으면 실행·일시 정지는 한 번만, 한 단계는 반복한다. 핸들 드래그 중에는 INIT하지 않는다', () => {
    expect(shortcutCommand(key('KeyP', { ctrlKey: true, repeat: true }), IDLE)).toEqual({
      command: null,
      preventDefault: true
    })
    expect(command(key('KeyP', { ctrlKey: true, shiftKey: true, repeat: true }))).toBeNull()
    expect(command(key('KeyP', { ctrlKey: true, altKey: true, repeat: true }))).toBe('step')
    expect(shortcutCommand(key('KeyP', { ctrlKey: true }), { ...IDLE, dragging: true })).toEqual({
      command: null,
      preventDefault: true
    })
    expect(command(key('KeyP', { ctrlKey: true, shiftKey: true }), { dragging: true })).toBe(
      'pause'
    )
  })

  it('툴팁·aria 표기', () => {
    expect(shortcutLabel('play', false)).toBe('Ctrl+P')
    expect(shortcutLabel('pause', false)).toBe('Ctrl+Shift+P')
    expect(shortcutLabel('step', false)).toBe('Ctrl+Alt+P')
    expect(shortcutLabel('play', true)).toBe('⌘P')
    expect(shortcutLabel('pause', true)).toBe('⇧⌘P')
    expect(shortcutLabel('step', true)).toBe('⌥⌘P')
    expect(ariaKeyShortcut('step', false)).toBe('Control+Alt+P')
    expect(ariaKeyShortcut('pause', true)).toBe('Meta+Shift+P')
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

describe('키보드 게임패드 중(실행 중 씬 뷰 포커스)', () => {
  const pad = { keyboardGamepad: true }
  const SWALLOWED = { command: null, preventDefault: true }

  it('수정키 없는 편집 단축키는 쓰지 않고 기본 동작만 막는다(Shift+H도)', () => {
    for (const event of [
      key('F2', { key: 'F2' }),
      key('KeyF'),
      key('KeyQ'),
      key('KeyW'),
      key('KeyE'),
      key('KeyX'),
      key('KeyH'),
      key('KeyH', { shiftKey: true }),
      key('Delete', { key: 'Delete' }),
      key('Backspace', { key: 'Backspace' }),
      key('Delete', { key: 'Delete', repeat: true })
    ])
      expect(shortcutCommand(event, { ...IDLE, ...pad })).toEqual(SWALLOWED)
  })

  it('단축키가 아닌 키(Tab·방향키 등)는 그대로 둔다(패드 리스너가 따로 막는다)', () => {
    for (const code of ['Tab', 'ArrowUp', 'Enter', 'KeyK', 'Escape'])
      expect(shortcutCommand(key(code, { key: code }), { ...IDLE, ...pad })).toEqual({
        command: null,
        preventDefault: false
      })
  })

  it('Ctrl·Alt 조합(저장·실행 취소·실행·만들기·잘라내기)은 그대로 받는다', () => {
    expect(command(key('KeyS', { ctrlKey: true }), pad)).toBe('save')
    expect(command(key('KeyZ', { ctrlKey: true }), pad)).toBe('undo')
    expect(command(key('KeyP', { ctrlKey: true }), pad)).toBe('play')
    expect(command(key('KeyP', { ctrlKey: true, shiftKey: true }), pad)).toBe('pause')
    expect(command(key('KeyP', { ctrlKey: true, altKey: true }), pad)).toBe('step')
    expect(command(key('KeyN', { altKey: true, shiftKey: true }), pad)).toBe('createEmptyChild')
    expect(command(key('KeyX', { ctrlKey: true }), pad)).toBe('cut')
    // Ctrl+W 같은 조합은 단순 키가 아니라 막지 않는다
    expect(shortcutCommand(key('KeyW', { ctrlKey: true }), { ...IDLE, ...pad })).toEqual({
      command: null,
      preventDefault: false
    })
  })

  it('대화상자·비행 중에는 여전히 아무것도 하지 않는다', () => {
    expect(shortcutCommand(key('KeyF'), { ...IDLE, ...pad, blocked: true })).toEqual({
      command: null,
      preventDefault: false
    })
  })
})
