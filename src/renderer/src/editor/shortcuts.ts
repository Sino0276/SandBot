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
  | 'selectAll'
  | 'cut'
  | 'paste'
  | 'pasteAsChild'
  | 'search'
  | 'toggleVisibility'
  | 'isolate'
  | 'play'
  | 'pause'
  | 'step'

// 표시용 조합. ctrl은 macOS에서 Cmd다(키 처리도 Ctrl·Cmd를 같이 받는다).
type Chord = { ctrl?: boolean; alt?: boolean; shift?: boolean; key: string }

// Unity와 같은 키(UnityCsReference GOCreationCommands.cs: Create Empty %#n, Create Empty Child &#n,
// Create Empty Parent %#g). 잘라내기·붙여넣기·자식으로 붙여넣기(Paste As Child %#v)·전체 선택·검색(Ctrl+F)과
// 보이기·숨기기(H)·고립 보기(Shift+H)도 Unity와 같다. 실행(Play %p: INIT → START → STOP), 일시 정지(Pause %#p),
// 한 단계(Step %&p)도 Unity의 Edit 메뉴 키다.
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
  delete: { key: 'Delete' },
  selectAll: { ctrl: true, key: 'A' },
  cut: { ctrl: true, key: 'X' },
  paste: { ctrl: true, key: 'V' },
  pasteAsChild: { ctrl: true, shift: true, key: 'V' },
  search: { ctrl: true, key: 'F' },
  toggleVisibility: { key: 'H' },
  isolate: { shift: true, key: 'H' },
  play: { ctrl: true, key: 'P' },
  pause: { ctrl: true, shift: true, key: 'P' },
  step: { ctrl: true, alt: true, key: 'P' }
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
  // 실행 중 씬 뷰에 포커스가 있어 키보드가 게임패드다(play/keyboardGamepad.ts의 keyboardPadActive). 수정키 없는
  // 편집 단축키(F2·F·Q/W/E·X·H·Shift+H·Delete/Backspace)는 쓰지 않고 기본 동작만 막는다. Ctrl·Alt 조합은 그대로다.
  keyboardGamepad: boolean
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
// 1. 대화상자·메뉴·비행 중이면 무시 2. 저장·열기, 검색(Ctrl+F), 실행(Ctrl+P·Ctrl+Shift+P·Ctrl+Alt+P) 3. 실행 취소
// 4. 새 조합키(Create Empty 등), 잘라내기·붙여넣기·전체 선택(입력칸 안에서는 입력칸의 것)
// 5. 입력칸·Ctrl·Alt·핸들 드래그 중이면 여기서 끝 6. F2, F, Q/W/E, X, H·Shift+H, Delete
//    (키보드 게임패드 중이면 6의 명령은 쓰지 않고 기본 동작만 막는다)
export function shortcutCommand(event: ShortcutKeyEvent, state: ShortcutState): ShortcutResult {
  if (state.blocked) return NONE
  const command = event.ctrlKey || event.metaKey
  const { code } = event

  // 실행 키는 Unity처럼 포커스가 어디 있든(입력칸·Console·인스펙터 안에서도) 받는다. 입력칸에는 Ctrl+P의 뜻이 없다.
  // 누르고 있어 반복되면 INIT → START → STOP을 연달아 하지 않도록 한 번만(한 단계는 반복해 여러 루프를 진행한다).
  // INIT은 저장을 물을 수 있으므로 핸들을 드래그하는 중에는 하지 않는다.
  if (command && code === 'KeyP') {
    if (event.altKey && !event.shiftKey) return run('step')
    if (event.repeat) return SWALLOW
    if (event.shiftKey && !event.altKey) return run('pause')
    if (!event.shiftKey && !event.altKey) return state.dragging ? SWALLOW : run('play')
    return SWALLOW
  }

  // Ctrl/Cmd+S 저장, Ctrl/Cmd+O 열기
  if (command && !event.altKey && (code === 'KeyS' || code === 'KeyO'))
    return run(code === 'KeyS' ? 'save' : 'open')
  // Ctrl/Cmd+F: 하이어라키 검색칸으로(입력칸에 있어도)
  if (command && !event.altKey && !event.shiftKey && code === 'KeyF')
    return event.repeat ? SWALLOW : run('search')

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
    if (code === 'KeyV') return event.repeat ? SWALLOW : run('pasteAsChild')
  }
  // Ctrl+X 잘라내기, Ctrl+V 붙여넣기, Ctrl+A 전체 선택. 입력칸 안에서는 입력칸의 잘라내기·전체 선택이다.
  if (!state.handlesOwnKeys && command && !event.shiftKey && !event.altKey) {
    if (code === 'KeyA') return run('selectAll')
    if (code === 'KeyX' || code === 'KeyV') {
      if (state.dragging || event.repeat) return SWALLOW
      return run(code === 'KeyX' ? 'cut' : 'paste')
    }
  }

  if (state.handlesOwnKeys || command || event.altKey || state.dragging) return NONE

  const result = plainKeyCommand(event)
  return state.keyboardGamepad && result.command ? SWALLOW : result
}

// 수정키 없는(Shift만 붙을 수 있는) 편집 단축키
function plainKeyCommand(event: ShortcutKeyEvent): ShortcutResult {
  const { code } = event
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
  // H: 선택 숨기기·보이기, Shift+H: 고립 보기
  if (code === 'KeyH') return run(event.shiftKey ? 'isolate' : 'toggleVisibility')
  if (isDelete) return run('delete')
  return NONE
}
