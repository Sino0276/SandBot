import { describe, expect, it } from 'vitest'
import { boxHull } from '../hull'
import {
  normalRow,
  sphereBox,
  sphereCapsule,
  sphereCylinder,
  sphereFloor,
  sphereHull,
  sphereSphere,
  type V3
} from './ballContact'

// 공의 좁은 단계와 법선 행 값(6a, spec-6a §2.2–§2.3)

const R = 0.03555
const close = (a: readonly number[], b: readonly number[], digits = 12): void =>
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i], digits))

describe('공 좁은 단계(6a)', () => {
  it('바닥: 법선 +z, 분리 z − r, 점은 두 표면 가운데', () => {
    const c = sphereFloor([0.1, 0.2, R - 0.001], R, 1e-3)!
    close(c.normal, [0, 0, 1])
    expect(c.separation).toBeCloseTo(-0.001, 15)
    close(c.point, [0.1, 0.2, -0.0005])
    expect(sphereFloor([0, 0, R + 0.002], R, 1e-3)).toBeNull()
  })

  describe('정확한 구–원기둥(뚜껑 중심 a·b, 반지름 0.05, 축 y)', () => {
    const a: V3 = [0, -0.1, 0]
    const b: V3 = [0, 0.1, 0]
    const cyl = (c: V3, band = 1e-3): ReturnType<typeof sphereCylinder> =>
      sphereCylinder(c, R, a, b, 0.05, band)
    it('옆면: 축에서 바깥으로', () => {
      const c = cyl([0, 0, 0.05 + R - 0.002])!
      close(c.normal, [0, 0, 1])
      expect(c.separation).toBeCloseTo(-0.002, 14)
    })
    it('뚜껑 면: ±축', () => {
      const c = cyl([0.01, 0.1 + R + 0.0005, 0.02])!
      close(c.normal, [0, 1, 0])
      expect(c.separation).toBeCloseTo(0.0005, 14)
      const d = cyl([0.01, -0.1 - R + 0.003, 0])!
      close(d.normal, [0, -1, 0])
      expect(d.separation).toBeCloseTo(-0.003, 14)
    })
    it('모서리(뚜껑 테두리): 테두리 위 가장 가까운 점에서', () => {
      // 테두리 점 (0, 0.1, 0.05)에서 (1, 1)/√2 방향으로 r − 1 mm
      const s = Math.SQRT1_2 * (R - 0.001)
      const c = cyl([0, 0.1 + s, 0.05 + s])!
      close(c.normal, [0, Math.SQRT1_2, Math.SQRT1_2])
      expect(c.separation).toBeCloseTo(-0.001, 12)
    })
    it('중심이 안: 가장 얕은 면(옆면)으로 빼낸다', () => {
      const c = cyl([0.04, 0, 0])!
      close(c.normal, [1, 0, 0])
      expect(c.separation).toBeCloseTo(-(0.01 + R), 14)
      // 축 위면 정해진 수직 축
      const d = cyl([0, 0, 0])!
      expect(Math.abs(d.normal[1])).toBe(0)
      expect(Math.hypot(...d.normal)).toBeCloseTo(1, 14)
    })
    it('멀면 null', () => {
      expect(cyl([0, 0, 0.2])).toBeNull()
    })
    it('64점 외접 기둥 껍질보다 정확하다(껍질은 변 가운데에서 r/cos(π/32) 차이만큼 덜 떨어짐)', () => {
      const hullSep = sphereHull(
        [0, 0, 0.05 + R + 0.0005],
        R,
        boxHull({ x: 0, y: 0, z: 0 }, [1, 0, 0, 0, 1, 0, 0, 0, 1], { x: 0.05, y: 0.1, z: 0.05 }),
        1e-3
      )
      expect(hullSep?.separation).toBeCloseTo(0.0005, 12)
      expect(cyl([0, 0, 0.05 + R + 0.0005])?.separation).toBeCloseTo(0.0005, 14)
    })
  })

  it('축 정렬 상자: 밖은 최근접점, 안은 가장 얕은 면, 껍질 GJK와 같은 값', () => {
    const min: V3 = [1.79, -2, -0.05]
    const max: V3 = [1.82, 2, 0.3]
    const hull = boxHull({ x: 1.805, y: 0, z: 0.125 }, [1, 0, 0, 0, 1, 0, 0, 0, 1], {
      x: 0.015,
      y: 2,
      z: 0.175
    })
    for (const c of [
      [1.79 - R + 0.001, 0.3, 0.1],
      [1.79 - 0.01, 0.3, 0.3 + 0.02],
      [1.795, 0.1, 0.1]
    ] as V3[]) {
      const box = sphereBox(c, R, min, max, 1e-3)!
      const gjk = sphereHull(c, R, hull, 1e-3)!
      expect(box.separation).toBeCloseTo(gjk.separation, 12)
      close(box.normal, gjk.normal, 9)
    }
    expect(sphereBox([1.5, 0, 0.1], R, min, max, 1e-3)).toBeNull()
  })

  it('캡슐: 선분 최근접, 법선은 캡슐 → 공', () => {
    const c = sphereCapsule(
      [0, 0, 0.02 + R - 0.001],
      R,
      { a: { x: -0.1, y: 0, z: 0 }, b: { x: 0.1, y: 0, z: 0 }, r: 0.02, sphere: false },
      1e-3
    )!
    close(c.normal, [0, 0, 1])
    expect(c.separation).toBeCloseTo(-0.001, 14)
  })

  it('공끼리: f → e 법선, 중심 거리 − 반지름 합, 중심이 겹치면 +z', () => {
    const c = sphereSphere([0.07, 0, R], R, [0, 0, R], R, 1e-3)!
    close(c.normal, [1, 0, 0])
    expect(c.separation).toBeCloseTo(0.07 - 2 * R, 15)
    close(sphereSphere([0, 0, 0], R, [0, 0, 0], R, 1e-3)!.normal, [0, 0, 1])
  })
})

describe('부드러운 법선 행(6a)', () => {
  const base = {
    approach: 0,
    h: 0.001,
    stiffness: 6000,
    mass: 0.0249,
    dampingRatio: 1,
    coreDepth: 0.3 * R,
    restitution: 0.3,
    bounceSpeed: 0.25
  }
  it('침투: 목표 kδ/(hk + c), 순응 1/(h(hk + c)) — 정지 상태 충격 = h·k·δ', () => {
    const c = 2 * Math.sqrt(6000 * 0.0249)
    const row = normalRow({ ...base, separation: -1e-4 })
    expect(row.target).toBeCloseTo((6000 * 1e-4) / (0.001 * 6000 + c), 15)
    expect(row.compliance).toBeCloseTo(1 / (0.001 * (0.001 * 6000 + c)), 9)
    // v⁺ = 0이면 γλ = 목표 → λ = h·k·δ
    expect(row.target / row.compliance).toBeCloseTo(0.001 * 6000 * 1e-4, 15)
  })
  it('떨어짐: 예측 목표 −분리/h', () => {
    expect(normalRow({ ...base, separation: 5e-4 }).target).toBeCloseTo(-0.5, 15)
  })
  it('심: δ ≥ 0.3·r이면 강체(γ = 0, 목표 0)', () => {
    const row = normalRow({ ...base, separation: -0.3 * R - 1e-6 })
    expect(row).toMatchObject({ target: 0, compliance: 0, crushed: true })
  })
  it('반발 두 단계: 닿기 전 하위 단계는 표면까지 오고(접근 속도를 적음) 다음 하위 단계는 e·|v|로 튄다', () => {
    const arrive = normalRow({ ...base, separation: 0.002, approach: -3 })
    expect(arrive).toMatchObject({ target: -2, compliance: 0, bounced: false, arrival: -3 })
    const bounce = normalRow({ ...base, separation: 0, approach: -2, impact: -3 })
    expect(bounce.target).toBeCloseTo(0.9, 15)
    expect(bounce.bounced).toBe(true)
    // 이미 닿은 채 빠르게 다가오면 바로 튄다
    expect(normalRow({ ...base, separation: -1e-5, approach: -1 }).target).toBeCloseTo(0.3, 15)
    // 문턱보다 느리면 부드러운 행
    expect(normalRow({ ...base, separation: 0, approach: -0.2 }).compliance).toBeGreaterThan(0)
  })
})
