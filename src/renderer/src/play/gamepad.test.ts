import { describe, expect, it } from 'vitest'
import {
  arrangePads,
  createGamepadPoller,
  emptyGamepadState,
  KEYBOARD_PAD_INFO,
  keyboardSlotFor,
  gamepadState,
  padInfo,
  padSlots,
  readGamepads,
  samePadSlots,
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

describe('키보드 게임패드 자리(실행 동안 고정)', () => {
  function setup(): {
    poller: ReturnType<typeof createGamepadPoller>
    pads: (GamepadLike | null)[]
    sent: GamepadPair[]
    slots: PadSlots[]
    keyboardSlot: () => 0 | 1 | null
    press: (patch: Partial<ReturnType<typeof emptyGamepadState>>) => void
    tick: () => void
  } {
    const pads: (GamepadLike | null)[] = []
    const sent: GamepadPair[] = []
    const slots: PadSlots[] = []
    let callback: (() => void) | null = null
    let slot: 0 | 1 | null = null
    let state = emptyGamepadState()
    const poller = createGamepadPoller({
      getGamepads: () => pads,
      send: (pair) => sent.push(pair),
      onSlots: (next) => slots.push(next),
      setInterval: (fn) => {
        callback = fn
        return 1
      },
      clearInterval: () => {
        callback = null
      },
      keyboard: {
        state: () => state,
        releaseAll: () => (state = emptyGamepadState()),
        setSlot: (next) => (slot = next)
      }
    })
    return {
      poller,
      pads,
      sent,
      slots,
      keyboardSlot: () => slot,
      press: (patch) => (state = { ...emptyGamepadState(), ...patch }),
      tick: () => callback?.()
    }
  }

  it('물리 패드가 없는 첫 자리', () => {
    expect(keyboardSlotFor([])).toBe(0)
    expect(keyboardSlotFor([pad(0)])).toBe(1)
    expect(keyboardSlotFor([pad(0), pad(1)])).toBeNull()
    // 끊긴 패드는 자리를 차지하지 않는다
    expect(keyboardSlotFor([pad(0, { connected: false })])).toBe(0)
    expect(arrangePads([pad(3)], 0).map((p) => (p === 'keyboard' ? p : p?.index))).toEqual([
      'keyboard',
      3
    ])
    expect(arrangePads([pad(3), pad(4)], 1).map((p) => (p === 'keyboard' ? p : p?.index))).toEqual([
      3,
      'keyboard'
    ])
  })

  it('패드가 없으면 키보드가 gamepad1이고, 실행 도중 나타난 패드는 남은 자리로 간다(키보드 자리는 그대로)', () => {
    const { poller, pads, sent, slots, keyboardSlot, tick } = setup()
    poller.start()
    expect(keyboardSlot()).toBe(0)
    // 포커스가 없어도 null이 아니라 모두 뗀 상태
    expect(sent).toEqual([[emptyGamepadState(), null]])
    expect(slots.at(-1)).toEqual([KEYBOARD_PAD_INFO, null])
    // Chromium은 버튼을 눌러야 패드를 보인다: 실행 도중 나타나도 키보드 자리를 뺏지 않는다
    pads.push(pad(0, { pressed: [0] }))
    tick()
    expect(keyboardSlot()).toBe(0)
    expect(slots.at(-1)).toEqual([KEYBOARD_PAD_INFO, { id: 'Pad 0', standard: true }])
    expect(sent.at(-1)![0]).toEqual(emptyGamepadState())
    expect(sent.at(-1)![1]!.a).toBe(true)
  })

  it('패드가 하나 있으면 키보드는 gamepad2, 둘이면 자리가 없다', () => {
    const one = setup()
    one.pads.push(pad(0))
    one.poller.start()
    expect(one.keyboardSlot()).toBe(1)
    expect(one.slots.at(-1)).toEqual([{ id: 'Pad 0', standard: true }, KEYBOARD_PAD_INFO])
    expect(one.sent.at(-1)![1]).toEqual(emptyGamepadState())

    const two = setup()
    two.pads.push(pad(0), pad(1))
    two.poller.start()
    expect(two.keyboardSlot()).toBeNull()
    expect(two.sent.at(-1)).toEqual([emptyGamepadState(), emptyGamepadState()])
  })

  it('키를 누르면 바뀔 때만 보내고, 멈추면 뗀 상태를 한 번 보내고 자리를 비운다', () => {
    const { poller, sent, slots, keyboardSlot, press, tick } = setup()
    poller.start()
    press({ left_stick_y: -1 })
    tick()
    tick()
    expect(sent).toHaveLength(2)
    expect(sent.at(-1)![0]!.left_stick_y).toBe(-1)
    poller.stop()
    expect(sent).toHaveLength(3)
    expect(sent.at(-1)).toEqual([emptyGamepadState(), null])
    expect(keyboardSlot()).toBeNull()
    expect(samePadSlots(slots.at(-1)!, [null, null])).toBe(true)
    // 뗀 상태였으면 다시 보내지 않는다
    poller.start()
    poller.stop()
    expect(sent).toHaveLength(4)
  })

  it('pollNow는 다음 읽기를 기다리지 않고 바뀐 상태를 보낸다(실행 중일 때만, 같으면 보내지 않는다)', () => {
    const { poller, sent, press } = setup()
    poller.pollNow()
    expect(sent).toHaveLength(0)
    poller.start()
    press({ left_stick_y: -1 })
    poller.pollNow()
    expect(sent).toHaveLength(2)
    expect(sent.at(-1)![0]!.left_stick_y).toBe(-1)
    poller.pollNow()
    expect(sent).toHaveLength(2)
    poller.stop()
    expect(sent).toHaveLength(3)
    press({ a: true })
    poller.pollNow()
    expect(sent).toHaveLength(3)
  })
})
