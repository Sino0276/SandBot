import { describe, expect, it } from 'vitest'
import { symmetricEigen3 } from '../../../shared/sim/drivetrain'
import { isValidInertia } from '../../../shared/sim/worldSpec'
import { floorInertia, subtractMassProps, type MassProps } from './chassis'
import type { SymMatrix3 } from './types'

// 점질량들의 질량 성질(무게중심 기준 관성)
function points(list: { m: number; p: [number, number, number] }[]): MassProps {
  const mass = list.reduce((sum, { m }) => sum + m, 0)
  const centerOfMass = [0, 1, 2].map(
    (k) => list.reduce((sum, { m, p }) => sum + m * p[k], 0) / mass
  ) as [number, number, number]
  const inertia: SymMatrix3 = [0, 0, 0, 0, 0, 0]
  for (const { m, p } of list) {
    const [dx, dy, dz] = [0, 1, 2].map((k) => p[k] - centerOfMass[k])
    inertia[0] += m * (dy * dy + dz * dz)
    inertia[1] += m * (dx * dx + dz * dz)
    inertia[2] += m * (dx * dx + dy * dy)
    inertia[3] -= m * dx * dy
    inertia[4] -= m * dx * dz
    inertia[5] -= m * dy * dz
  }
  return { mass, centerOfMass, inertia }
}

const eigen = (s: SymMatrix3): number[] =>
  symmetricEigen3([
    [s[0], s[3], s[4]],
    [s[3], s[1], s[5]],
    [s[4], s[5], s[2]]
  ]).values.sort((a, b) => a - b)

describe('섀시 빼기', () => {
  const A = { m: 4, p: [0.1, -0.05, 0.08] as [number, number, number] }
  const B = { m: 2.5, p: [-0.12, 0.07, 0.03] as [number, number, number] }
  const C = { m: 1.2, p: [0.2, 0.15, 0.3] as [number, number, number] }
  const D = { m: 0.7, p: [0.05, -0.2, 0.25] as [number, number, number] }

  it('전체에서 부분들을 빼면 나머지 점질량들의 질량 성질(평행축)', () => {
    const total = points([A, B, C, D])
    const rest = subtractMassProps(total, [points([C]), points([D])])
    const expected = points([A, B])
    expect(rest.mass).toBeCloseTo(expected.mass, 12)
    rest.centerOfMass.forEach((v, k) => expect(v).toBeCloseTo(expected.centerOfMass[k], 12))
    rest.inertia.forEach((v, k) => expect(v).toBeCloseTo(expected.inertia[k], 12))
    // 부분이 없으면 그대로
    const same = subtractMassProps(total, [])
    expect(same.mass).toBe(total.mass)
    same.inertia.forEach((v, k) => expect(v).toBeCloseTo(total.inertia[k], 14))
  })

  it('부분이 관성을 가진 몸체여도 같다(무게중심 기준 관성을 평행축으로 옮겨 뺀다)', () => {
    const total = points([A, B, C, D])
    // C와 D를 한 몸체로 뺀다
    const rest = subtractMassProps(total, [points([C, D])])
    const expected = points([A, B])
    rest.inertia.forEach((v, k) => expect(v).toBeCloseTo(expected.inertia[k], 12))
  })

  it('나머지 질량이 양수가 아니면 무게중심은 전체의 것, 관성은 0', () => {
    const total = points([A])
    const rest = subtractMassProps(total, [points([A]), points([B])])
    expect(rest.mass).toBeCloseTo(-2.5, 12)
    expect(rest.centerOfMass).toEqual(total.centerOfMass)
    expect(rest.inertia).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe('관성 하한', () => {
  it('고칠 것이 없으면 같은 배열(다시 만들지 않는다)', () => {
    const inertia = points([
      { m: 1, p: [0.1, 0, 0] },
      { m: 1, p: [0, 0.1, 0] },
      { m: 1, p: [0, 0, 0.1] }
    ]).inertia
    expect(floorInertia(inertia, 1e-6)).toBe(inertia)
  })

  it('하한보다 작은 주관성 값만 올리고(고유 벡터는 그대로) 검증을 통과한다', () => {
    // 점 둘: 선 방향 관성이 0
    const line = points([
      { m: 2, p: [0, 0, 0] },
      { m: 3, p: [0.1, 0.2, -0.05] }
    ]).inertia
    expect(eigen(line)[0]).toBeCloseTo(0, 15)
    const floored = floorInertia(line, 1e-6)
    const [small, middle, large] = eigen(floored)
    expect(small).toBeCloseTo(1e-6, 15)
    expect([middle, large]).toEqual(
      eigen(line)
        .slice(1)
        .map((v) => expect.closeTo(v, 15))
    )
    expect(isValidInertia(floored)).toBe(true)
    // 모두 0(점 하나)이면 등방 하한
    const zero = floorInertia([0, 0, 0, 0, 0, 0], 1e-6)
    zero.slice(0, 3).forEach((v) => expect(v).toBeCloseTo(1e-6, 18))
    zero.slice(3).forEach((v) => expect(v).toBeCloseTo(0, 18))
  })

  it('반올림으로 음수가 되거나 삼각 부등식이 깨진 관성도 유효하게 고친다', () => {
    // 주관성 값 (−1e-9, 0.01, 0.0102): 음수를 하한으로 올려도 0.000001 + 0.01 < 0.0102라 작은 두 값을 같이 올린다
    const bad: SymMatrix3 = [-1e-9, 0.01, 0.0102, 0, 0, 0]
    expect(isValidInertia(bad)).toBe(false)
    const fixed = floorInertia(bad, 1e-6)
    expect(isValidInertia(fixed)).toBe(true)
    const [a, b, c] = eigen(fixed)
    expect(a + b).toBeGreaterThanOrEqual(c - 1e-15)
    expect(c).toBeCloseTo(0.0102, 15)
    expect(b - a).toBeCloseTo(0.01 - 1e-6, 15)
  })
})
