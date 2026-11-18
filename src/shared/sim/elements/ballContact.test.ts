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
import { PINCH_RECOVERY_SPEED } from './elementData'

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
  it('끼인 행은 반발 두 단계 없이 이력 스프링: 눌릴 때 탄성선(peak를 적음), 풀릴 때 k/e² 선(peak에서 힘이 같음), 떨어지면 주기 끝', () => {
    const k = 6000
    const c = 2 * Math.sqrt(k * 0.0249)
    const h = 0.001
    // 빠르게 다가와도 튀지 않는다. 앞 하위 단계보다 깊어지면(눌림을 봤다) 주기를 시작한다
    const loading = normalRow({
      ...base,
      separation: -2e-3,
      approach: -1,
      pinched: true,
      previous: 1e-3
    })
    expect(loading).toMatchObject({ bounced: false, crushed: false, peak: 2e-3 })
    expect(loading.target).toBeCloseTo((k * 2e-3) / (h * k + c), 15)
    // 더 깊어지면 peak가 따라간다
    expect(normalRow({ ...base, separation: -3e-3, pinched: true, peak: 2e-3 }).peak).toBe(3e-3)
    // 풀릴 때: peak는 하위 단계마다 PINCH_RECOVERY_SPEED·h만큼 줄어(모양을 되찾음) p이고, k_U = k/e², δ₀ = p(1 − e²).
    // 정지 상태 힘 = k_U(δ − δ₀)
    const e2 = base.restitution ** 2
    const unload = k / e2
    const p = 3e-3 - PINCH_RECOVERY_SPEED * h
    const rest = p * (1 - e2)
    const back = normalRow({ ...base, separation: -2.9e-3, pinched: true, peak: 3e-3 })
    expect(back.peak).toBeCloseTo(p, 15)
    expect(back.target / back.compliance).toBeCloseTo(h * unload * (2.9e-3 - rest), 12)
    // peak 바로 아래에서 두 선의 힘이 같다(이어진다)
    const top = normalRow({ ...base, separation: -(p - 1e-12), pinched: true, peak: 3e-3 })
    expect(top.target / top.compliance).toBeCloseTo(h * k * p, 9)
    // δ₀ 아래는 힘이 없고 δ₀까지 예측 목표
    const slack = normalRow({ ...base, separation: -1e-4, pinched: true, peak: 3e-3 })
    expect(slack.target).toBeCloseTo(-(rest - 1e-4) / h, 12)
    // 떨어지면 주기가 끝난다(peak 없음, 보통 예측 목표)
    const apart = normalRow({ ...base, separation: 1e-4, pinched: true, peak: 3e-3 })
    expect(apart.peak).toBeUndefined()
    expect(apart.target).toBeCloseTo(-0.1, 12)
    // 끼임이 풀려도 주기 안이면 이력 스프링(빠르게 다가와도 튀지 않는다)
    const freed = normalRow({ ...base, separation: -2.9e-3, approach: -1, peak: 3e-3 })
    expect(freed).toMatchObject({ bounced: false })
    expect(freed.peak).toBeCloseTo(p, 15)
    // peak는 지금 깊이 아래로 줄지 않는다: 깊이에 닿으면 탄성선이고 주기는 떨어질 때까지 이어진다
    const met = normalRow({ ...base, separation: -2.9999e-3, peak: 3e-3 })
    expect(met.peak).toBe(2.9999e-3)
    expect(met.target / met.compliance).toBeCloseTo(h * k * 2.9999e-3, 12)
    // 심은 그대로 강체이고 눌리는 중이면 peak를 적는다
    expect(
      normalRow({ ...base, separation: -0.3 * R - 1e-6, pinched: true, previous: 0.3 * R })
    ).toMatchObject({
      target: 0,
      compliance: 0,
      crushed: true,
      peak: 0.3 * R + 1e-6
    })
  })
  it('처음 나온 짝(시작 겹침, 잠에서 깬 공)이나 깊어지지 않는 짝은 끼여도 이력 주기를 시작하지 않는다(탄성선)', () => {
    const k = 6000
    const h = 0.001
    for (const previous of [undefined, 2e-3, 2.5e-3]) {
      const row = normalRow({ ...base, separation: -2e-3, pinched: true, previous })
      expect(row.peak).toBeUndefined()
      expect(row.bounced).toBe(false)
      expect(row.target / row.compliance).toBeCloseTo(h * k * 2e-3, 12)
    }
    // 심도 같다(강체, peak 없음)
    expect(normalRow({ ...base, separation: -0.3 * R - 1e-6, pinched: true }).peak).toBeUndefined()
    // 떨어져 있다가(분리 > 0) 닿으며 깊어지면 시작한다
    expect(normalRow({ ...base, separation: -1e-4, pinched: true, previous: -2e-4 }).peak).toBe(
      1e-4
    )
  })
  // 6a 리뷰 3: 누르던 몸체가 떠난 뒤에도 심 행(목표 0)이 밀어내지 않아 공이 심 깊이(반지름의 30 %)에 박힌 채 잠들었다
  it('붙드는 것이 없는 심 행(free)은 강체로 버티지 않고 눌린 모양을 되찾는다: 쉼 깊이를 지금 깊이로 다시 잡고 줄여 간다', () => {
    const k = 6000
    const h = 0.001
    const e2 = base.restitution ** 2
    const unload = k / e2
    const depth = 0.3 * R + 1e-3
    // 붙들린 심 행(기본)은 강체 그대로다
    expect(normalRow({ ...base, separation: -depth, peak: depth })).toMatchObject({
      target: 0,
      compliance: 0,
      crushed: true
    })
    // 풀린 첫 하위 단계: 눌린 최대 깊이(peak = 깊이)의 탄성 힘 k·δ(약 70 N, 공이 튀어 나간다)를 쓰지 않고 쉼 깊이 = 지금 깊이
    // (힘 0)로 다시 잡는다: peak = 깊이/(1 − e²)
    const first = normalRow({ ...base, separation: -depth, peak: depth, free: true })
    expect(first).toMatchObject({ crushed: true, bounced: false, restoring: true })
    expect(first.target).toBeCloseTo(0, 12)
    expect(first.compliance).toBeGreaterThan(0)
    expect(first.peak).toBeCloseTo(depth / (1 - e2), 15)
    // 다음 하위 단계: peak가 PINCH_RECOVERY_SPEED·h만큼 줄어 쉼 깊이가 그 (1 − e²)배만큼 물러나고, 풀림 선이 그만큼만 민다
    const next = normalRow({
      ...base,
      separation: -depth,
      peak: first.peak,
      restoring: true,
      free: true
    })
    const p = (first.peak as number) - PINCH_RECOVERY_SPEED * h
    expect(next).toMatchObject({ crushed: true, restoring: true })
    expect(next.peak).toBeCloseTo(p, 15)
    const force = next.target / next.compliance / h
    expect(force).toBeCloseTo(unload * PINCH_RECOVERY_SPEED * h * (1 - e2), 9)
    // 공 무게(0.24 N)보다 작은 힘에서 시작한다(튀어 나가지 않는다)
    expect(force).toBeLessThan(0.0249 * 9.80665)
    // 눌린 최대 깊이로 넘겨받은 peak(restoring 아님)나 peak 없는 짝도 풀리면 쉼 깊이를 지금 깊이로 잡는다
    for (const peak of [undefined, depth, depth + 2e-3])
      expect(normalRow({ ...base, separation: -depth, peak, free: true }).peak).toBeCloseTo(
        depth / (1 - e2),
        15
      )
    // 심 아래로 나오면 같은 풀림 선이 이어진다(힘이 뛰지 않는다)
    const core = 0.3 * R
    const carried = core / (1 - e2) + 2 * PINCH_RECOVERY_SPEED * h
    const above = normalRow({
      ...base,
      separation: -core,
      peak: carried,
      restoring: true,
      free: true
    })
    const below = normalRow({ ...base, separation: -(core - 1e-9), peak: carried, restoring: true })
    expect(below).toMatchObject({ crushed: false, restoring: true })
    expect(below.target / below.compliance).toBeCloseTo(above.target / above.compliance, 6)
    // 되찾는 중에 다시 붙들리면(받침·끼임) 강체이고, 그 peak는 다시 눌린 최대 깊이다(restoring을 버린다)
    const held = normalRow({
      ...base,
      separation: -depth,
      peak: first.peak,
      restoring: true,
      pinched: true
    })
    expect(held).toMatchObject({ target: 0, compliance: 0, crushed: true })
    expect(held.restoring).toBeUndefined()
    // 되찾기가 끝나면(peak가 깊이에 닿음) 탄성선이고 restoring이 아니다
    const done = normalRow({ ...base, separation: -1e-4, peak: 1e-4, restoring: true })
    expect(done.restoring).toBeUndefined()
    expect(done.target / done.compliance).toBeCloseTo(h * k * 1e-4, 12)
  })
})
