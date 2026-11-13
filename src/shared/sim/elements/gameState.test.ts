import { describe, expect, it } from 'vitest'
import type { SimElementState } from '../worldSpec'
import {
  ELEMENT_FLAG_ASLEEP,
  ELEMENT_FLAG_OUT,
  elementDisplayPose,
  elementFlags,
  GAME_POSE_STRIDE,
  isValidGameState,
  quantizeElements
} from './gameState'

// 6a 계약: gameState 이벤트 몸통(줄인 자세 7칸 + 표식)

const ball = (change: Partial<SimElementState> = {}): SimElementState => ({
  kind: 'pollen',
  position: { x: 1.23456, y: -0.00004, z: 0.03555 },
  orientation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  velocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  asleep: false,
  out: false,
  ...change
})

describe('quantizeElements', () => {
  it('위치·사원수 × 1e4 정수(−0 없음), 표식 비트', () => {
    const { poses, flags } = quantizeElements([
      ball(),
      ball({ asleep: true }),
      ball({ out: true, asleep: true })
    ])
    expect(poses).toHaveLength(3 * GAME_POSE_STRIDE)
    expect(poses.slice(0, 7)).toEqual([12346, 0, 356, 7071, 0, 0, 7071])
    expect(poses.every((v) => Number.isInteger(v) && !Object.is(v, -0))).toBe(true)
    expect(flags).toEqual([0, ELEMENT_FLAG_ASLEEP, ELEMENT_FLAG_ASLEEP | ELEMENT_FLAG_OUT])
  })

  it('표시 자세는 m와 다시 맞춘 단위 사원수, 표식 칸이 없으면 0', () => {
    const { poses } = quantizeElements([ball()])
    const pose = elementDisplayPose(poses, 0)
    expect(pose.position).toEqual({ x: 1.2346, y: 0, z: 0.0356 })
    const [w, x, y, z] = pose.orientation
    expect(Math.hypot(w, x, y, z)).toBeCloseTo(1, 15)
    expect(elementDisplayPose([0, 0, 0, 0, 0, 0, 0], 0).orientation).toEqual([1, 0, 0, 0])
    expect(elementFlags(undefined, 3)).toBe(0)
    expect(elementFlags([0, 2], 1)).toBe(2)
  })
})

describe('isValidGameState', () => {
  const { poses, flags } = quantizeElements([ball(), ball()])
  it('맞는 모양', () => {
    expect(isValidGameState({ revision: 0, poses, flags })).toBe(true)
    expect(isValidGameState({ revision: 3, poses })).toBe(true)
    expect(isValidGameState({ revision: 3, poses, flags }, 2)).toBe(true)
  })
  it.each([
    ['revision 음수', { revision: -1, poses }],
    ['revision 소수', { revision: 0.5, poses }],
    ['길이가 7의 배수가 아님', { revision: 0, poses: poses.slice(1) }],
    ['정수 아님', { revision: 0, poses: [0.5, ...poses.slice(1)] }],
    ['유한하지 않음', { revision: 0, poses: [NaN, ...poses.slice(1)] }],
    ['표식 길이', { revision: 0, poses, flags: [0] }],
    ['표식 범위', { revision: 0, poses, flags: [0, 4] }],
    ['공 65개', { revision: 0, poses: new Array(65 * 7).fill(0) }]
  ])('%s는 받지 않는다', (_, value) => {
    expect(isValidGameState(value)).toBe(false)
  })
  it('공 수가 실행과 다르면 받지 않는다', () => {
    expect(isValidGameState({ revision: 0, poses }, 3)).toBe(false)
  })
})
