import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../shared/play'
import type { GamepadState } from '../../../shared/sidecarProtocol'
import { useContextMenuStore, useDialogStore } from '../editor/dialogStore'
import { useFlyStore } from '../editor/flyStore'
import { emptyGamepadState } from './gamepad'
import {
  createKeyboardPad,
  installKeyboardGamepad,
  KEYBOARD_PAD_BINDINGS,
  keyboardPadActive,
  keyboardPadState,
  SCENE_VIEW_ATTRIBUTE,
  useKeyboardPadStore,
  type PadKeyEvent
} from './keyboardGamepad'
import { newRun, usePlayStore } from './playStore'

function key(code: string, options: Partial<PadKeyEvent> = {}): PadKeyEvent {
  return {
    code,
    key: options.key ?? code.replace(/^Key/, '').toLowerCase(),
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...options
  }
}

const pressed = (...codes: string[]): GamepadState => keyboardPadState(codes)

describe('키보드 → FTC Gamepad 배치', () => {
  it('WASD는 왼쪽 스틱(위가 음수), 방향키는 오른쪽 스틱', () => {
    expect(pressed('KeyW').left_stick_y).toBe(-1)
    expect(pressed('KeyS').left_stick_y).toBe(1)
    expect(pressed('KeyA').left_stick_x).toBe(-1)
    expect(pressed('KeyD').left_stick_x).toBe(1)
    expect(pressed('ArrowUp').right_stick_y).toBe(-1)
    expect(pressed('ArrowDown').right_stick_y).toBe(1)
    expect(pressed('ArrowLeft').right_stick_x).toBe(-1)
    expect(pressed('ArrowRight').right_stick_x).toBe(1)
    // 다른 축·버튼은 그대로
    expect({ ...pressed('KeyW'), left_stick_y: 0 }).toEqual(emptyGamepadState())
  })

  it('I J K L = y x a b(패드 모양), U O 범퍼, Q E 트리거, T F G H 방향 패드, Enter start, Backspace back', () => {
    const only = (code: string, field: keyof GamepadState, value: number | boolean): void =>
      expect(pressed(code)).toEqual({ ...emptyGamepadState(), [field]: value })
    only('KeyI', 'y', true)
    only('KeyJ', 'x', true)
    only('KeyK', 'a', true)
    only('KeyL', 'b', true)
    only('KeyU', 'left_bumper', true)
    only('KeyO', 'right_bumper', true)
    only('KeyQ', 'left_trigger', 1)
    only('KeyE', 'right_trigger', 1)
    only('KeyT', 'dpad_up', true)
    only('KeyF', 'dpad_left', true)
    only('KeyG', 'dpad_down', true)
    only('KeyH', 'dpad_right', true)
    only('Enter', 'start', true)
    only('NumpadEnter', 'start', true)
    only('Backspace', 'back', true)
    // Space는 쓰지 않는다
    expect(KEYBOARD_PAD_BINDINGS.Space).toBeUndefined()
    expect(pressed('Space')).toEqual(emptyGamepadState())
  })

  it('반대 키는 상쇄하고, 대각선은 축마다 ±1', () => {
    expect(pressed('KeyW', 'KeyS').left_stick_y).toBe(0)
    expect(pressed('KeyA', 'KeyD').left_stick_x).toBe(0)
    expect(pressed('ArrowLeft', 'ArrowRight', 'ArrowUp')).toMatchObject({
      right_stick_x: 0,
      right_stick_y: -1
    })
    expect(pressed('KeyW', 'KeyD')).toMatchObject({ left_stick_x: 1, left_stick_y: -1 })
    expect(pressed()).toEqual(emptyGamepadState())
  })
})

describe('키 상태(createKeyboardPad)', () => {
  let active = true
  const pad = createKeyboardPad(() => active)
  beforeEach(() => {
    active = true
    pad.releaseAll()
  })

  it('패드 키만 받고, 반복 keydown은 막기만 하고 상태를 바꾸지 않는다', () => {
    expect(pad.keyDown(key('KeyW'))).toBe(true)
    expect(pad.state().left_stick_y).toBe(-1)
    pad.keyUp(key('KeyW'))
    // 뗀 뒤 반복 입력이 와도(브라우저가 늦게 보낸 반복) 다시 누르지 않는다
    expect(pad.keyDown(key('KeyW', { repeat: true }))).toBe(true)
    expect(pad.state().left_stick_y).toBe(0)
    // 패드 키가 아니면 받지 않는다
    expect(pad.keyDown(key('Tab', { key: 'Tab' }))).toBe(false)
    expect(pad.keyDown(key('KeyZ'))).toBe(false)
  })

  it('Ctrl·Alt·Meta 조합은 받지 않고(단축키), Shift만 붙은 키는 받는다', () => {
    expect(pad.keyDown(key('KeyS', { ctrlKey: true }))).toBe(false)
    expect(pad.keyDown(key('KeyW', { altKey: true }))).toBe(false)
    expect(pad.keyDown(key('KeyD', { metaKey: true }))).toBe(false)
    expect(pad.held().size).toBe(0)
    expect(pad.keyDown({ ...key('KeyW'), shiftKey: true } as PadKeyEvent)).toBe(true)
    expect(pad.held().has('KeyW')).toBe(true)
  })

  it('keyup은 수정키를 누른 채여도 뗀다(W를 누른 채 Ctrl+S로 저장)', () => {
    pad.keyDown(key('KeyW'))
    pad.keyDown(key('KeyS', { ctrlKey: true }))
    expect(pad.state().left_stick_y).toBe(-1)
    pad.keyUp(key('KeyW', { ctrlKey: true }))
    pad.keyUp(key('KeyS', { ctrlKey: true }))
    expect(pad.state()).toEqual(emptyGamepadState())
  })

  it('Meta를 떼면 모두 뗀다(macOS는 Cmd를 누른 동안 다른 키의 keyup을 보내지 않는다)', () => {
    pad.keyDown(key('KeyW'))
    pad.keyDown(key('KeyK'))
    pad.keyUp(key('MetaLeft', { key: 'Meta' }))
    expect(pad.held().size).toBe(0)
  })

  it('활성이 아니면 받지 않고, 상태를 읽을 때 남은 키를 모두 뗀다', () => {
    pad.keyDown(key('KeyW'))
    active = false
    expect(pad.keyDown(key('KeyD'))).toBe(false)
    expect(pad.state()).toEqual(emptyGamepadState())
    // 다시 활성이 되어도 누르고 있던 키는 다시 눌러야 한다(반복 입력은 무시)
    active = true
    pad.keyDown(key('KeyW', { repeat: true }))
    expect(pad.state()).toEqual(emptyGamepadState())
  })
})

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

function startRun(): void {
  usePlayStore.setState({
    run: newRun({
      runId: 'r1',
      root: '/p',
      opMode: OP_MODE,
      robotId: null,
      configPath: null,
      speed: 1,
      paused: false
    })
  })
}

type Listener = (event: never) => void

// 창 대신 리스너를 모아 두는 가짜(Node에는 DOM이 없다)
function fakeWindow(): {
  target: Pick<Window, 'addEventListener'>
  fire: (type: string, event: object) => { prevented: boolean }
} {
  const listeners = new Map<string, Listener[]>()
  return {
    target: {
      addEventListener: ((type: string, listener: Listener) =>
        listeners.set(type, [
          ...(listeners.get(type) ?? []),
          listener
        ])) as unknown as Window['addEventListener']
    },
    fire: (type, event) => {
      let prevented = false
      const full = { ...event, preventDefault: () => (prevented = true) }
      for (const listener of listeners.get(type) ?? []) listener(full as never)
      return { prevented }
    }
  }
}

const sceneView = { hasAttribute: (name: string) => name === SCENE_VIEW_ATTRIBUTE }
const otherElement = { hasAttribute: () => false }

describe('키보드 게임패드 활성 판단과 창 리스너', () => {
  beforeEach(() => {
    startRun()
    useKeyboardPadStore.setState({ slot: 0, focused: true })
    useFlyStore.setState({ flying: false })
    useDialogStore.setState({ request: null })
    useContextMenuStore.setState({ menu: null })
  })
  afterEach(() => {
    usePlayStore.setState({ run: null })
    useKeyboardPadStore.setState({ slot: null, focused: false })
  })

  it('실행 중·자리 있음·씬 뷰 포커스·대화상자 없음·비행 아님일 때만 활성(INIT 단계 포함)', () => {
    expect(usePlayStore.getState().run!.phase).toBe('preparing')
    expect(keyboardPadActive()).toBe(true)
    useKeyboardPadStore.setState({ focused: false })
    expect(keyboardPadActive()).toBe(false)
    useKeyboardPadStore.setState({ focused: true, slot: null })
    expect(keyboardPadActive()).toBe(false)
    useKeyboardPadStore.setState({ slot: 1 })
    useFlyStore.setState({ flying: true })
    expect(keyboardPadActive()).toBe(false)
    useFlyStore.setState({ flying: false })
    useContextMenuStore.setState({ menu: { x: 0, y: 0, entries: [] } as never })
    expect(keyboardPadActive()).toBe(false)
    useContextMenuStore.setState({ menu: null })
    usePlayStore.setState({ run: { ...usePlayStore.getState().run!, phase: 'finished' } })
    expect(keyboardPadActive()).toBe(false)
  })

  it('keydown은 패드 키의 기본 동작을 막고, 포커스가 나가거나 창이 blur되면 모두 뗀다', () => {
    const pad = createKeyboardPad(keyboardPadActive)
    const win = fakeWindow()
    installKeyboardGamepad(pad, win.target)
    expect(win.fire('keydown', key('ArrowUp', { key: 'ArrowUp' })).prevented).toBe(true)
    expect(win.fire('keydown', key('KeyS', { ctrlKey: true })).prevented).toBe(false)
    expect(pad.held().has('ArrowUp')).toBe(true)
    // 다른 요소의 focusout은 상관없다
    win.fire('focusout', { target: otherElement })
    expect(pad.held().size).toBe(1)
    win.fire('focusout', { target: sceneView })
    expect(pad.held().size).toBe(0)
    expect(useKeyboardPadStore.getState().focused).toBe(false)
    win.fire('focusin', { target: sceneView })
    expect(useKeyboardPadStore.getState().focused).toBe(true)
    win.fire('keydown', key('KeyK'))
    win.fire('blur', {})
    expect(pad.held().size).toBe(0)
    // keyup은 늘 받는다
    win.fire('keydown', key('KeyL'))
    win.fire('keyup', key('KeyL', { altKey: true }))
    expect(pad.held().size).toBe(0)
  })

  it('비행을 시작하거나 대화상자가 뜨면 모두 뗀다(비행 뒤에는 다시 눌러야 한다)', () => {
    const pad = createKeyboardPad(keyboardPadActive)
    const win = fakeWindow()
    installKeyboardGamepad(pad, win.target)
    win.fire('keydown', key('KeyW'))
    useFlyStore.setState({ flying: true })
    expect(pad.held().size).toBe(0)
    // 비행 중의 키는 카메라가 받는다
    expect(win.fire('keydown', key('KeyW')).prevented).toBe(false)
    useFlyStore.setState({ flying: false })
    win.fire('keydown', key('KeyW', { repeat: true }))
    expect(pad.held().size).toBe(0)

    win.fire('keydown', key('KeyD'))
    useDialogStore.setState({ request: { message: 'm', buttons: [], cancelId: 'c' } as never })
    expect(pad.held().size).toBe(0)
  })
})
