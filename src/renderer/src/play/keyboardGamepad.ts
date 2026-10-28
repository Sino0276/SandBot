import { create } from 'zustand'
import type { GamepadState } from '../../../shared/sidecarProtocol'
import {
  isModalOpen,
  useContextMenuStore,
  useDialogStore,
  usePreferencesStore,
  useScriptPickerStore
} from '../editor/dialogStore'
import { isFlying, useFlyStore } from '../editor/flyStore'
import { emptyGamepadState } from './gamepad'
import { isRunActive, usePlayStore } from './playStore'

// 키보드 게임패드. 실행 중 씬 뷰에 포커스가 있을 때만 키보드가 게임패드 하나(물리 패드가 없는 첫 자리, 실행을 시작할 때
// 정해 끝날 때까지 유지)가 된다. 그동안 단순 편집 단축키(F·Q/W/E·H·Delete 등)는 쓰지 않고(shortcuts.ts의
// keyboardGamepad), Ctrl·Alt·Meta 조합(저장·실행 취소·Ctrl+P)은 그대로 단축키다. 키는 위치(event.code)로 받는다
// (한글 입력 상태에서도 같은 키).
//
// 배치(아래 KEYBOARD_PAD_BINDINGS):
// - W A S D: 왼쪽 스틱(W는 left_stick_y = −1: 위로 밀면 음수, 브라우저·SDK와 같다), 방향키: 오른쪽 스틱
// - I J K L: y x a b(패드의 버튼 모양 그대로), U O: 왼쪽·오른쪽 범퍼, Q E: 왼쪽·오른쪽 트리거(1)
// - T F G H: 방향 패드 위·왼쪽·아래·오른쪽, Enter: start, Backspace: back
// - Space는 쓰지 않는다(한 버튼에 한 키. 실수로 눌리기 쉽고 K가 이미 a다).
// 반대 키(W+S 등)는 서로 상쇄해 0이다. 대각선은 축마다 ±1이다(Unity 키보드 축처럼 원으로 줄이지 않는다).
//
// 키 상태: 누르고 있어 반복되는 keydown은 무시하고, keyup은 늘 받는다(수정키를 누른 채 떼도). macOS는 Cmd를 누른
// 동안 다른 키의 keyup을 보내지 않으므로 Meta를 떼면 모두 뗀다. 씬 뷰에서 포커스가 나가거나, 창이 포커스를 잃거나,
// 대화상자·메뉴가 뜨거나(isModalOpen), 카메라 비행(우클릭+WASD)을 시작하면 모두 뗀다(다시 눌러야 한다). 뗀 상태는
// 다음 읽기를 기다리지 않고 바로 보낸다(창을 내리면 Chromium이 interval을 1초에 한 번으로 늦춘다).
// 게임패드로 누른 키의 반복 keydown은 그 키를 뗄 때까지 패드가 꺼져도 막는다(Backspace(back)를 누른 채 실행이
// 끝나거나 포커스가 나가도 반복 입력이 편집기의 Delete가 되지 않게).

type AxisField = 'left_stick_x' | 'left_stick_y' | 'right_stick_x' | 'right_stick_y'
type TriggerField = 'left_trigger' | 'right_trigger'
type ButtonField = {
  [K in keyof GamepadState]: GamepadState[K] extends boolean ? K : never
}[keyof GamepadState]

export type PadBinding =
  | { kind: 'axis'; field: AxisField; value: 1 | -1 }
  | { kind: 'trigger'; field: TriggerField }
  | { kind: 'button'; field: ButtonField }

const axis = (field: AxisField, value: 1 | -1): PadBinding => ({ kind: 'axis', field, value })
const button = (field: ButtonField): PadBinding => ({ kind: 'button', field })
const trigger = (field: TriggerField): PadBinding => ({ kind: 'trigger', field })

export const KEYBOARD_PAD_BINDINGS: Readonly<Record<string, PadBinding>> = {
  KeyW: axis('left_stick_y', -1),
  KeyS: axis('left_stick_y', 1),
  KeyA: axis('left_stick_x', -1),
  KeyD: axis('left_stick_x', 1),
  ArrowUp: axis('right_stick_y', -1),
  ArrowDown: axis('right_stick_y', 1),
  ArrowLeft: axis('right_stick_x', -1),
  ArrowRight: axis('right_stick_x', 1),
  KeyI: button('y'),
  KeyJ: button('x'),
  KeyK: button('a'),
  KeyL: button('b'),
  KeyU: button('left_bumper'),
  KeyO: button('right_bumper'),
  KeyQ: trigger('left_trigger'),
  KeyE: trigger('right_trigger'),
  KeyT: button('dpad_up'),
  KeyF: button('dpad_left'),
  KeyG: button('dpad_down'),
  KeyH: button('dpad_right'),
  Enter: button('start'),
  NumpadEnter: button('start'),
  Backspace: button('back')
}

export function isPadKey(code: string): boolean {
  return Object.hasOwn(KEYBOARD_PAD_BINDINGS, code)
}

// Ctrl·Alt·Meta 조합은 단축키다(키보드 패드가 받지 않는다). Shift만 붙은 키는 패드가 받는다.
export function hasCommandModifier(event: {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  return event.ctrlKey || event.metaKey || event.altKey
}

// 눌린 키들 → FTC Gamepad 상태
export function keyboardPadState(held: Iterable<string>): GamepadState {
  const state = emptyGamepadState()
  for (const code of held) {
    const binding = KEYBOARD_PAD_BINDINGS[code]
    if (!binding) continue
    if (binding.kind === 'axis') state[binding.field] += binding.value
    else if (binding.kind === 'trigger') state[binding.field] = 1
    else state[binding.field] = true
  }
  return state
}

export type PadKeyEvent = {
  code: string
  key: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export type KeyboardPad = {
  // 이 keydown을 패드가 받았으면 true(호출한 쪽이 기본 동작을 막는다. 반복 입력도 막기만 한다)
  keyDown: (event: PadKeyEvent) => boolean
  keyUp: (event: PadKeyEvent) => void
  releaseAll: () => void
  // 지금 상태. 패드가 활성이 아니면(포커스·대화상자·비행·실행 끝) 먼저 모두 뗀다.
  state: () => GamepadState
  held: () => ReadonlySet<string>
  // 게임패드로 누른 키(아직 떼지 않음)의 반복 keydown인가. 패드가 꺼져도 그 키를 뗄 때까지 true다.
  isPadRepeat: (event: PadKeyEvent) => boolean
}

const isMetaKey = (event: PadKeyEvent): boolean =>
  event.key === 'Meta' || event.code === 'MetaLeft' || event.code === 'MetaRight'

// isActive: 지금 키보드가 게임패드인가(keyboardPadActive와 같은 판단을 단축키 리스너도 쓴다).
// onRelease: releaseAll이 눌린 키를 뗐을 때(폴러가 바로 보낸다)
export function createKeyboardPad(
  isActive: () => boolean,
  onRelease: () => void = () => {}
): KeyboardPad {
  const held = new Set<string>()
  // 게임패드로 누른 뒤 아직 떼지 않은 키. releaseAll은 지우지 않는다(키는 아직 눌려 있고, 반복 입력이 온다).
  const pressed = new Set<string>()
  return {
    keyDown: (event) => {
      if (hasCommandModifier(event) || !isPadKey(event.code)) return false
      if (!isActive()) {
        // 패드가 꺼진 뒤 새로 누른 키는 패드의 것이 아니다. 패드로 누른 키의 반복은 막기만 한다.
        if (!event.repeat) pressed.delete(event.code)
        return event.repeat && pressed.has(event.code)
      }
      if (!event.repeat) {
        held.add(event.code)
        pressed.add(event.code)
      }
      return true
    },
    keyUp: (event) => {
      if (isMetaKey(event)) {
        held.clear()
        pressed.clear()
      } else {
        held.delete(event.code)
        pressed.delete(event.code)
      }
    },
    releaseAll: () => {
      if (held.size === 0) return
      held.clear()
      onRelease()
    },
    state: () => {
      if (held.size > 0 && !isActive()) held.clear()
      return keyboardPadState(held)
    },
    held: () => held,
    isPadRepeat: (event) => event.repeat && pressed.has(event.code)
  }
}

// ---- 화면 상태(씬 뷰 머리 표시·Dock 머리 표시) ----

type KeyboardPadView = {
  // 실행을 시작할 때 정한 자리(0 = gamepad1). 실행 중이 아니거나 물리 패드가 두 자리를 다 쓰면 null.
  slot: 0 | 1 | null
  // 씬 뷰에 포커스가 있다
  focused: boolean
}

export const useKeyboardPadStore = create<KeyboardPadView>()(() => ({ slot: null, focused: false }))

// 씬 뷰(캔버스를 감싼 요소, tabIndex 0)의 표시
export const SCENE_VIEW_ATTRIBUTE = 'data-scene-view'

export function isSceneViewElement(target: EventTarget | null): boolean {
  const element = target as { hasAttribute?: unknown } | null
  return (
    typeof element?.hasAttribute === 'function' &&
    (target as Element).hasAttribute(SCENE_VIEW_ATTRIBUTE)
  )
}

// 키보드가 지금 게임패드인가: 실행이 활성(INIT 포함)이고, 키보드 자리가 있고, 씬 뷰에 포커스가 있고, 대화상자·메뉴가
// 없고, 비행 중이 아니다. 단축키 리스너(EditorLayout)와 키보드 패드 리스너가 같은 함수를 부른다(리스너 순서와 무관).
export function keyboardPadActive(): boolean {
  const { slot, focused } = useKeyboardPadStore.getState()
  return (
    slot !== null &&
    focused &&
    isRunActive(usePlayStore.getState().run) &&
    !isModalOpen() &&
    !isFlying()
  )
}

// Unity의 Play Focused: START하면 씬 뷰에 포커스를 준다(툴바 버튼에 남은 포커스로 Enter가 STOP을 누르지 않게)
export function focusSceneView(): void {
  if (typeof document === 'undefined') return
  document.querySelector<HTMLElement>(`[${SCENE_VIEW_ATTRIBUTE}]`)?.focus({ preventScroll: true })
}

// 씬 뷰 위 표시(키보드 게임패드 표시·배치 도움말)를 누를 때: 포커스를 옮기는 기본 동작은 막고(씬 뷰에서 포커스가
// 나가면 키를 모두 뗀다), 씬 뷰에 포커스를 준다("씬 뷰를 누르면" 안내를 눌러도 씬 뷰를 누른 것과 같게).
export function keepSceneViewFocus(event: { preventDefault: () => void }): void {
  event.preventDefault()
  focusSceneView()
}

// 창 리스너: 키, 포커스(씬 뷰 안팎), 창 blur, 비행 시작, 대화상자·메뉴 열림. 앱 시작 때 한 번(initPlaySession).
export function installKeyboardGamepad(
  pad: KeyboardPad,
  target: Pick<Window, 'addEventListener'>
): void {
  target.addEventListener('keydown', (event: KeyboardEvent) => {
    if (pad.keyDown(event)) event.preventDefault()
  })
  target.addEventListener('keyup', (event: KeyboardEvent) => pad.keyUp(event))
  target.addEventListener('blur', () => pad.releaseAll())
  target.addEventListener('focusin', (event: FocusEvent) => {
    if (isSceneViewElement(event.target)) useKeyboardPadStore.setState({ focused: true })
  })
  target.addEventListener('focusout', (event: FocusEvent) => {
    if (!isSceneViewElement(event.target)) return
    pad.releaseAll()
    useKeyboardPadStore.setState({ focused: false })
  })
  useFlyStore.subscribe((state, previous) => {
    if (state.flying && !previous.flying) pad.releaseAll()
  })
  const onModal = (): void => {
    if (isModalOpen()) pad.releaseAll()
  }
  useDialogStore.subscribe(onModal)
  useContextMenuStore.subscribe(onModal)
  usePreferencesStore.subscribe(onModal)
  useScriptPickerStore.subscribe(onModal)
}
