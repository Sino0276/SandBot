import type { GamepadState } from '../../../shared/sidecarProtocol'

// 게임패드(브라우저 Gamepad API → FTC Gamepad 필드). 실행 중에만 약 60 Hz로 읽고, 바뀌었을 때만 메인에 보낸다.
// 표준 배치(mapping === 'standard', W3C Gamepad의 Standard Gamepad)만 FTC 필드로 옮긴다. 연결된 첫·둘째 패드가
// gamepad1·gamepad2다. 표준 배치가 아닌 패드는 자리만 차지하고 값은 보내지 않는다(null, SDK의 모두 0).
// 키보드 대체는 2단계.

// 테스트가 가짜 객체를 넣을 수 있게 쓰는 필드만 둔다
export type GamepadLike = {
  id: string
  index: number
  connected: boolean
  mapping: string
  axes: readonly number[]
  buttons: readonly { pressed: boolean; value: number }[]
}

export type GamepadPair = [GamepadState | null, GamepadState | null]

// 연결 상태(툴바·Console 표시). standard가 아니면 값을 보내지 않는다.
export type PadInfo = { id: string; standard: boolean }
export type PadSlots = [PadInfo | null, PadInfo | null]

// Standard Gamepad 버튼 번호 → FTC 필드(6·7 트리거는 값으로 따로)
const BUTTONS: readonly (keyof GamepadState | null)[] = [
  'a',
  'b',
  'x',
  'y',
  'left_bumper',
  'right_bumper',
  null,
  null,
  'back',
  'start',
  'left_stick_button',
  'right_stick_button',
  'dpad_up',
  'dpad_down',
  'dpad_left',
  'dpad_right',
  'guide',
  'touchpad'
]

// 축 값을 -1..1 안의 유한한 수로(드라이버가 가끔 범위를 조금 넘는 값을 준다)
function axis(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

function trigger(button: { value: number; pressed: boolean } | undefined): number {
  if (!button) return 0
  const value = Number.isFinite(button.value) ? button.value : button.pressed ? 1 : 0
  return Math.max(0, Math.min(1, value))
}

export function emptyGamepadState(): GamepadState {
  return {
    left_stick_x: 0,
    left_stick_y: 0,
    right_stick_x: 0,
    right_stick_y: 0,
    left_trigger: 0,
    right_trigger: 0,
    dpad_up: false,
    dpad_down: false,
    dpad_left: false,
    dpad_right: false,
    a: false,
    b: false,
    x: false,
    y: false,
    guide: false,
    start: false,
    back: false,
    left_bumper: false,
    right_bumper: false,
    left_stick_button: false,
    right_stick_button: false,
    touchpad: false
  }
}

// 표준 배치 패드 하나 → FTC Gamepad. 스틱 y는 위로 밀면 음수(브라우저와 SDK가 같다). 표준이 아니면 null.
export function gamepadState(pad: GamepadLike): GamepadState | null {
  if (pad.mapping !== 'standard') return null
  const state = emptyGamepadState()
  state.left_stick_x = axis(pad.axes[0])
  state.left_stick_y = axis(pad.axes[1])
  state.right_stick_x = axis(pad.axes[2])
  state.right_stick_y = axis(pad.axes[3])
  state.left_trigger = trigger(pad.buttons[6])
  state.right_trigger = trigger(pad.buttons[7])
  BUTTONS.forEach((field, index) => {
    if (field !== null) (state[field] as boolean) = pad.buttons[index]?.pressed ?? false
  })
  return state
}

// navigator.getGamepads()의 빈 자리·끊긴 패드를 빼고 앞의 둘
export function padSlots(
  pads: readonly (GamepadLike | null)[]
): [GamepadLike | null, GamepadLike | null] {
  const connected = pads.filter((pad): pad is GamepadLike => pad !== null && pad.connected)
  return [connected[0] ?? null, connected[1] ?? null]
}

export function padInfo(pads: readonly (GamepadLike | null)[]): PadSlots {
  const [first, second] = padSlots(pads)
  const info = (pad: GamepadLike | null): PadInfo | null =>
    pad ? { id: pad.id, standard: pad.mapping === 'standard' } : null
  return [info(first), info(second)]
}

export function readGamepads(pads: readonly (GamepadLike | null)[]): GamepadPair {
  const [first, second] = padSlots(pads)
  return [first ? gamepadState(first) : null, second ? gamepadState(second) : null]
}

function sameState(a: GamepadState | null, b: GamepadState | null): boolean {
  if (a === null || b === null) return a === b
  return (Object.keys(a) as (keyof GamepadState)[]).every((key) => a[key] === b[key])
}

export function samePair(a: GamepadPair, b: GamepadPair): boolean {
  return sameState(a[0], b[0]) && sameState(a[1], b[1])
}

export function samePadSlots(a: PadSlots, b: PadSlots): boolean {
  const same = (x: PadInfo | null, y: PadInfo | null): boolean =>
    x === null || y === null ? x === y : x.id === y.id && x.standard === y.standard
  return same(a[0], b[0]) && same(a[1], b[1])
}

export const GAMEPAD_POLL_MS = 16

export type GamepadPollerDeps = {
  getGamepads: () => readonly (GamepadLike | null)[]
  send: (pair: GamepadPair) => void
  // 연결 상태가 바뀌면(표시용)
  onSlots: (slots: PadSlots) => void
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

// 실행 중에만 도는 읽기. start할 때 지금 상태를 한 번 보내고(새 실행이 이전 값을 쓰지 않게), 그 뒤로는 바뀔 때만 보낸다.
export function createGamepadPoller(deps: GamepadPollerDeps): {
  start: () => void
  stop: () => void
  running: () => boolean
} {
  let handle: unknown = null
  let lastSent: GamepadPair | null = null
  let lastSlots: PadSlots = [null, null]

  const poll = (): void => {
    let pads: readonly (GamepadLike | null)[]
    try {
      pads = deps.getGamepads()
    } catch {
      pads = []
    }
    const slots = padInfo(pads)
    if (!samePadSlots(slots, lastSlots)) {
      lastSlots = slots
      deps.onSlots(slots)
    }
    const pair = readGamepads(pads)
    if (lastSent && samePair(pair, lastSent)) return
    lastSent = pair
    deps.send(pair)
  }

  return {
    start: () => {
      if (handle !== null) return
      lastSent = null
      poll()
      handle = deps.setInterval(poll, GAMEPAD_POLL_MS)
    },
    stop: () => {
      if (handle === null) return
      deps.clearInterval(handle)
      handle = null
    },
    running: () => handle !== null
  }
}

// 브라우저 Gamepad API. Chromium은 버튼을 한 번 누르기 전에는 패드를 보이지 않는다(지문 방지).
export function browserGamepads(): readonly (GamepadLike | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return []
  return navigator.getGamepads()
}
