// 편집기 단축키 표와 키 → 명령 대응. 키 처리(EditorLayout)와 메뉴·툴팁의 단축키 표시가 이 표 하나를 읽는다.
// 문자 키는 키 위치(event.code)로 받는다. 한글 입력 상태에서도 같은 키로 동작한다.

export type ShortcutCommand =
  | 'save'
  | 'open'
  | 'undo'
  | 'redo'
  | 'createEmpty'
  | 'createEmptyChild'
  | 'createEmptyParent'
  | 'rename'
  | 'focus'
  | 'toolView'
  | 'toolTranslate'
  | 'toolRotate'
  | 'toggleHandleSpace'
  | 'delete'

// 표시용 조합. ctrl은 macOS에서 Cmd다(키 처리도 Ctrl·Cmd를 같이 받는다).
type Chord = { ctrl?: boolean; alt?: boolean; shift?: boolean; key: string }

// Unity와 같은 키(UnityCsReference GOCreationCommands.cs: Create Empty %#n, Create Empty Child &#n,
// Create Empty Parent %#g)
export const SHORTCUTS: Readonly<Record<ShortcutCommand, Chord>> = {
  save: { ctrl: true, key: 'S' },
  open: { ctrl: true, key: 'O' },
  undo: { ctrl: true, key: 'Z' },
  redo: { ctrl: true, shift: true, key: 'Z' },
  createEmpty: { ctrl: true, shift: true, key: 'N' },
  createEmptyChild: { alt: true, shift: true, key: 'N' },
  createEmptyParent: { ctrl: true, shift: true, key: 'G' },
  rename: { key: 'F2' },
  focus: { key: 'F' },
  toolView: { key: 'Q' },
  toolTranslate: { key: 'W' },
  toolRotate: { key: 'E' },
  toggleHandleSpace: { key: 'X' },
  delete: { key: 'Delete' }
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

// 메뉴·툴팁에 붙이는 단축키 글자(Windows·Linux는 'Ctrl+Shift+N', macOS는 '⇧⌘N')
export function shortcutLabel(command: ShortcutCommand, mac: boolean = isMacPlatform()): string {
  const chord = SHORTCUTS[command]
  if (mac) {
    const key = chord.key === 'Delete' ? '⌫' : chord.key
    return `${chord.alt ? '⌥' : ''}${chord.shift ? '⇧' : ''}${chord.ctrl ? '⌘' : ''}${key}`
  }
  return [chord.ctrl && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', chord.key]
    .filter(Boolean)
    .join('+')
}

// aria-keyshortcuts 값(WAI-ARIA 형식: 'Control+Shift+N')
export function ariaKeyShortcut(command: ShortcutCommand, mac: boolean = isMacPlatform()): string {
  const chord = SHORTCUTS[command]
  return [chord.ctrl && (mac ? 'Meta' : 'Control'), chord.alt && 'Alt', chord.shift && 'Shift']
    .filter(Boolean)
    .concat(chord.key)
    .join('+')
}

export type ShortcutKeyEvent = {
  code: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
}

export type ShortcutState = {
  // 대화상자·우클릭 메뉴가 떠 있거나(isModalOpen) 씬 뷰에서 비행 중이면 모든 단축키를 무시한다
  blocked: boolean
  // 포커스가 입력칸이나 키를 직접 쓰는 패널(인스펙터) 안에 있다
  handlesOwnKeys: boolean
  // 포커스가 확정하지 않은 글자가 있는 입력칸에 있다(Ctrl+Z는 입력칸에 맡긴다)
  pendingTextEdit: boolean
  // 핸들을 드래그하는 중(history.isChangeOpen)
  dragging: boolean
}

export type ShortcutResult = { command: ShortcutCommand | null; preventDefault: boolean }

const NONE: ShortcutResult = { command: null, preventDefault: false }
const run = (command: ShortcutCommand): ShortcutResult => ({ command, preventDefault: true })
// 기본 동작만 막는다(핸들을 드래그하는 중의 실행 취소 등)
const SWALLOW: ShortcutResult = { command: null, preventDefault: true }

const TOOL_COMMANDS: Partial<Record<string, ShortcutCommand>> = {
  KeyQ: 'toolView',
  KeyW: 'toolTranslate',
  KeyE: 'toolRotate'
}

// 키 입력 → 명령. 처리 순서:
// 1. 대화상자·메뉴·비행 중이면 무시 2. 저장·열기 3. 실행 취소 4. 새 조합키(Create Empty 등)
// 5. 입력칸·Ctrl·Alt·핸들 드래그 중이면 여기서 끝 6. F2, F, Q/W/E, X, Delete
export function shortcutCommand(event: ShortcutKeyEvent, state: ShortcutState): ShortcutResult {
  if (state.blocked) return NONE
  const command = event.ctrlKey || event.metaKey
  const { code } = event

  // Ctrl/Cmd+S 저장, Ctrl/Cmd+O 열기
  if (command && !event.altKey && (code === 'KeyS' || code === 'KeyO'))
    return run(code === 'KeyS' ? 'save' : 'open')

  // Ctrl/Cmd+Z 실행 취소, Ctrl/Cmd+Shift+Z·Ctrl+Y 다시 실행.
  // 입력칸에 확정하지 않은 글자가 있을 때만 입력칸 자체의 실행 취소에 맡긴다.
  if (command && !event.altKey && (code === 'KeyZ' || code === 'KeyY')) {
    if (state.pendingTextEdit) return NONE
    if (state.dragging) return SWALLOW
    return run(code === 'KeyY' || event.shiftKey ? 'redo' : 'undo')
  }

  // Create Empty(Ctrl+Shift+N), Create Empty Child(Alt+Shift+N), Create Empty Parent(Ctrl+Shift+G).
  // 아래 조기 반환(Ctrl·Alt)보다 앞에서 받는다. 입력칸 안이나 핸들 드래그 중에는 쓰지 않는다.
  if (!state.handlesOwnKeys && !state.dragging && event.shiftKey && code === 'KeyN') {
    if (command && !event.altKey) return event.repeat ? SWALLOW : run('createEmpty')
    if (event.altKey && !command) return event.repeat ? SWALLOW : run('createEmptyChild')
  }
  if (!state.handlesOwnKeys && !state.dragging && command && event.shiftKey && !event.altKey) {
    if (code === 'KeyG') return event.repeat ? SWALLOW : run('createEmptyParent')
  }

  if (state.handlesOwnKeys || command || event.altKey || state.dragging) return NONE

  const isDelete =
    code === 'Delete' || code === 'Backspace' || event.key === 'Delete' || event.key === 'Backspace'
  // 키를 누르고 있어 반복되는 입력(예: 비행 중 Q를 누른 채 우클릭을 먼저 놓은 경우)은 도구를 바꾸지 않는다
  if (event.repeat && !isDelete) return NONE

  if (code === 'F2' && !event.shiftKey) return run('rename')
  // F: 선택에 카메라 맞추기
  if (code === 'KeyF') return run('focus')
  const tool = TOOL_COMMANDS[code]
  if (tool && !event.shiftKey) return run(tool)
  if (code === 'KeyX' && !event.shiftKey) return run('toggleHandleSpace')
  if (isDelete) return run('delete')
  return NONE
}
