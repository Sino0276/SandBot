import { describe, expect, it } from 'vitest'
import { closestInHull, convexHull, distributeWheelLoads } from './wheelLoads'

// 정사각 4륜(앞왼·앞오른·뒤왼·뒤오른), a = b = 0.168 m
const A = 0.168
const SQUARE = [
  { x: A, y: A },
  { x: A, y: -A },
  { x: -A, y: A },
  { x: -A, y: -A }
]
const W = 13.6 * 9.80665

// 정지 상태(무게중심 (cx, cy))의 바닥 렌치: F_z = W, M_x = W·cy, M_y = −W·cx
const staticWrench = (cx: number, cy: number): [number, number, number] => [W, W * cy, -W * cx]

describe('distributeWheelLoads', () => {
  it('무게중심이 가운데면 네 바퀴가 같다', () => {
    const { loads, unsupported } = distributeWheelLoads(SQUARE, ...staticWrench(0, 0))
    for (const n of loads) expect(n).toBeCloseTo(W / 4, 9)
    expect(unsupported).toBe(0)
  })

  it('정사각 닫힌 꼴 N_i = (W/4)(1 + x_c·x_i/a² + y_c·y_i/b²)와 같다(method §5.2)', () => {
    const cx = 0.06
    const cy = -0.02
    const { loads } = distributeWheelLoads(SQUARE, ...staticWrench(cx, cy))
    SQUARE.forEach((p, i) => {
      expect(loads[i]).toBeCloseTo((W / 4) * (1 + (cx * p.x) / (A * A) + (cy * p.y) / (A * A)), 9)
    })
    // method §5.3 예: 13.6 kg, 무게중심 6 cm 앞 → 45.25, 21.43 N
    const ahead = distributeWheelLoads(SQUARE, ...staticWrench(0.06, 0)).loads
    expect(ahead[0]).toBeCloseTo(45.25, 1)
    expect(ahead[2]).toBeCloseTo(21.43, 1)
  })

  it('식을 지킨다: 합과 모멘트', () => {
    const points = [
      { x: 0.2, y: 0.15 },
      { x: 0.18, y: -0.16 },
      { x: -0.17, y: 0.14 },
      { x: -0.2, y: -0.15 },
      { x: 0, y: 0.15 },
      { x: 0, y: -0.15 }
    ]
    const [fz, mx, my] = staticWrench(0.03, 0.01)
    const { loads } = distributeWheelLoads(points, fz, mx, my)
    expect(loads.reduce((a, b) => a + b, 0)).toBeCloseTo(fz, 9)
    expect(points.reduce((a, p, i) => a + p.y * loads[i], 0)).toBeCloseTo(mx, 9)
    expect(points.reduce((a, p, i) => a - p.x * loads[i], 0)).toBeCloseTo(my, 9)
    for (const n of loads) expect(n).toBeGreaterThanOrEqual(0)
  })

  it('음수 하중은 활성 집합으로 뺀다(바퀴가 뜬다)', () => {
    // 무게중심 앞 7.5 cm·높이 0.12 m, −5 m/s² 감속: method §5.3은 뒷바퀴 6.31 N(거의 뜸). 더 세게 감속하면 0이 된다.
    const m = 13.6
    const h = 0.12
    const decel = (a: number): number[] =>
      distributeWheelLoads(SQUARE, m * 9.80665, 0, -m * 9.80665 * 0.075 - m * a * h).loads
    const mild = decel(5)
    expect(mild[0]).toBeCloseTo(60.37, 1)
    expect(mild[2]).toBeCloseTo(6.31, 1)
    const hard = decel(8)
    expect(hard[2]).toBe(0)
    expect(hard[3]).toBe(0)
    expect(hard[0] + hard[1]).toBeCloseTo(m * 9.80665, 9)
  })

  it('ZMP가 껍질 밖이면 가장 가까운 점으로 옮기고 받쳐지지 않은 모멘트를 돌려준다', () => {
    const [fz, mx, my] = staticWrench(0.3, 0)
    const { loads, unsupported } = distributeWheelLoads(SQUARE, fz, mx, my)
    expect(loads[2]).toBe(0)
    expect(loads[3]).toBe(0)
    expect(loads[0]).toBeCloseTo(fz / 2, 9)
    expect(loads[1]).toBeCloseTo(fz / 2, 9)
    expect(unsupported).toBeCloseTo(fz * (0.3 - A), 9)
  })

  it('바퀴 둘(일직선)·하나도 합을 지킨다', () => {
    const two = [
      { x: 0, y: 0.15 },
      { x: 0, y: -0.15 }
    ]
    const r2 = distributeWheelLoads(two, ...staticWrench(0.05, 0.05))
    expect(r2.loads[0] + r2.loads[1]).toBeCloseTo(W, 9)
    expect(r2.loads[0]).toBeGreaterThan(r2.loads[1])
    expect(r2.unsupported).toBeCloseTo(W * 0.05, 9)
    const r1 = distributeWheelLoads([{ x: 0.1, y: 0 }], ...staticWrench(0, 0))
    expect(r1.loads[0]).toBeCloseTo(W, 9)
    expect(r1.unsupported).toBeCloseTo(W * 0.1, 9)
  })

  it('F_z ≤ 0이면 모두 0', () => {
    expect(distributeWheelLoads(SQUARE, 0, 0, 0).loads).toEqual([0, 0, 0, 0])
    expect(distributeWheelLoads(SQUARE, -5, 0, 0).loads).toEqual([0, 0, 0, 0])
  })

  it('결정적이다(같은 입력 → 같은 비트)', () => {
    const args = [SQUARE, ...staticWrench(0.071, -0.033)] as const
    expect(distributeWheelLoads(...args)).toEqual(distributeWheelLoads(...args))
  })
})

describe('convexHull·closestInHull', () => {
  it('껍질은 반시계이고 안쪽 점·같은 점을 뺀다', () => {
    const hull = convexHull([...SQUARE, { x: 0, y: 0 }, { x: A, y: A }])
    expect(hull).toHaveLength(4)
    expect(closestInHull(hull, { x: 0.01, y: 0.02 })).toEqual({ x: 0.01, y: 0.02 })
    const outside = closestInHull(hull, { x: 1, y: 0 })
    expect(outside.x).toBeCloseTo(A, 12)
    expect(outside.y).toBeCloseTo(0, 12)
  })
})
