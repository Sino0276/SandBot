import { describe, expect, it } from 'vitest'
import {
  createGamepadPoller,
  emptyGamepadState,
  gamepadState,
  padInfo,
  padSlots,
  readGamepads,
  samePair,
  type GamepadLike,
  type GamepadPair,
  type PadSlots
} from './gamepad'

// 가짜 Standard Gamepad(버튼 18개, 축 4개)
function pad(
  index: number,
  options: {
    pressed?: number[]
    axes?: number[]
    triggers?: [number, number]
    mapping?: string
    connected?: boolean
  } = {}
): GamepadLike {
  const buttons = Array.from({ length: 18 }, (_, i) => ({
    pressed: options.pressed?.includes(i) ?? false,
    value: options.pressed?.includes(i) ? 1 : 0
  }))
  if (options.triggers) {
    buttons[6] = { pressed: options.triggers[0] > 0.5, value: options.triggers[0] }
    buttons[7] = { pressed: options.triggers[1] > 0.5, value: options.triggers[1] }
  }
  return {
    id: `Pad ${index}`,
    index,
    connected: options.connected ?? true,
    mapping: options.mapping ?? 'standard',
    axes: options.axes ?? [0, 0, 0, 0],
    buttons
  }
}

describe('표준 배치 → FTC Gamepad', () => {
  it('버튼 번호와 FTC 필드', () => {
    const fields = [
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
    ] as const
    fields.forEach((field, index) => {
      if (field === null) return
      const state = gamepadState(pad(0, { pressed: [index] }))!
      expect({ ...emptyGamepadState(), [field]: true }).toEqual(state)
    })
  })

  it('스틱(위로 밀면 y 음수, 범위를 넘으면 자름)과 트리거 값', () => {
    const state = gamepadState(pad(0, { axes: [0.5, -1.2, -0.25, 0.75], triggers: [0.3, 1] }))!
    expect(state.left_stick_x).toBe(0.5)
    expect(state.left_stick_y).toBe(-1)
    expect(state.right_stick_x).toBe(-0.25)
    expect(state.right_stick_y).toBe(0.75)
    expect(state.left_trigger).toBe(0.3)
    expect(state.right_trigger).toBe(1)
    expect(gamepadState(pad(0, { axes: [NaN] }))!.left_stick_x).toBe(0)
  })

  it('표준 배치가 아니면 값을 보내지 않는다(null)', () => {
    expect(gamepadState(pad(0, { mapping: '' }))).toBeNull()
  })

  it('빈 자리와 끊긴 패드를 빼고 앞의 둘이 gamepad1·gamepad2', () => {
    const pads = [null, pad(1, { connected: false }), pad(2, { mapping: '' }), pad(3), pad(4)]
    const [first, second] = padSlots(pads)
    expect([first?.index, second?.index]).toEqual([2, 3])
    expect(padInfo(pads)).toEqual([
      { id: 'Pad 2', standard: false },
      { id: 'Pad 3', standard: true }
    ])
    const [one, two] = readGamepads(pads)
    expect(one).toBeNull()
    expect(two).toEqual(emptyGamepadState())
    expect(readGamepads([])).toEqual([null, null])
  })
})

describe('게임패드 읽기(실행 중에만)', () => {
  function setup(): {
    poller: ReturnType<typeof createGamepadPoller>
    pads: (GamepadLike | null)[]
    sent: GamepadPair[]
    slots: PadSlots[]
    tick: () => void
    intervals: () => number
  } {
    const pads: (GamepadLike | null)[] = []
    const sent: GamepadPair[] = []
    const slots: PadSlots[] = []
    let callback: (() => void) | null = null
    let active = 0
    const poller = createGamepadPoller({
      getGamepads: () => pads,
      send: (pair) => sent.push(pair),
      onSlots: (next) => slots.push(next),
      setInterval: (fn) => {
        callback = fn
        active++
        return active
      },
      clearInterval: () => {
        callback = null
        active--
      }
    })
    return { poller, pads, sent, slots, tick: () => callback?.(), intervals: () => active }
  }

  it('시작할 때 한 번 보내고, 그 뒤로는 바뀔 때만 보낸다', () => {
    const { poller, pads, sent, slots, tick, intervals } = setup()
    poller.start()
    expect(sent).toEqual([[null, null]])
    tick()
    tick()
    expect(sent).toHaveLength(1)
    pads.push(pad(0))
    tick()
    expect(sent).toHaveLength(2)
    expect(slots.at(-1)).toEqual([{ id: 'Pad 0', standard: true }, null])
    pads[0] = pad(0, { pressed: [0] })
    tick()
    expect(sent.at(-1)![0]!.a).toBe(true)
    tick()
    expect(sent).toHaveLength(3)
    expect(samePair(sent[2], sent[2])).toBe(true)
    // 멈춘 뒤 다시 시작하면 지금 상태를 다시 보낸다(새 실행)
    poller.stop()
    expect(intervals()).toBe(0)
    expect(poller.running()).toBe(false)
    poller.start()
    expect(sent).toHaveLength(4)
    poller.start()
    expect(intervals()).toBe(1)
  })

  it('getGamepads가 던지면 연결 없음으로 본다', () => {
    const poller = createGamepadPoller({
      getGamepads: () => {
        throw new Error('blocked')
      },
      send: (pair) => expect(pair).toEqual([null, null]),
      onSlots: () => {},
      setInterval: () => 1,
      clearInterval: () => {}
    })
    poller.start()
    expect(poller.running()).toBe(true)
  })
})
