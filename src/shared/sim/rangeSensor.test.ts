import { describe, expect, it } from 'vitest'
import { FieldRaycaster, MIRROR_HALF_ANGLE } from './fieldRaycast'
import {
  readRangeSensor,
  TOF_GREY_RANGE,
  TOF_HALF_ANGLE,
  TOF_RAYS,
  TOF_WHITE_RANGE,
  tofMaxRange,
  tofNoiseSigma
} from './rangeSensor'
import { resolveSeason } from './seasons/seasons'
import type { SensorPose } from './sensorFrame'
import { aimedPose, DEG, emptyField, material, sensedBox, testField } from './testkit'

// REV 2m 거리 센서 모델(4c, spec-4c §1.4 시험 A3–A10·A7). 기대 수치는 부록 A(s4c2/tables.py, Python)이고 V8과 ulp 단위로
// 다를 수 있다. 시험 필드는 checkFieldSpec를 거치지 않는 얕은 복사다.

const read = (
  field: ReturnType<typeof testField>,
  pose: SensorPose
): ReturnType<typeof readRangeSensor> => readRangeSensor(new FieldRaycaster(field), pose)

// 빈 필드에 정면 확산 평면(ρ 0.5): 앞면이 x = D, 원점 (0, 0, 1)
function frontalPlane(D: number, yaw = 0): ReturnType<typeof testField> {
  const n = { x: Math.cos(yaw), y: Math.sin(yaw) }
  // 면 중심이 축 위 (D, 0, 1)에 오도록: 상자 중심 = 면 점 + 0.5·n
  return emptyField({
    structures: [
      sensedBox({ x: D + 0.5 * n.x, y: 0.5 * n.y, z: 1 }, { x: 1, y: 4, z: 4 }, yaw, material(0.5))
    ]
  })
}

const NONE = resolveSeason('none')
const IH = NONE.perimeter.innerHalf
const INSET = NONE.perimeter.panelInset
// 'none' +x 벽 판 안쪽 면에서 D_p 앞의 센서(필드 중앙 선 y = 0)
const facingWall = (Dp: number, h: number, yaw = 0, y = 0): SensorPose =>
  aimedPose({ x: IH + INSET - Dp, y, z: h }, yaw)

describe('거리 센서 모델', () => {
  it('거울 창 반각은 원뿔 반각과 같다', () => {
    expect(MIRROR_HALF_ANGLE).toBe(TOF_HALF_ANGLE)
  })

  it('A3 정면 확산 평면: raw = D, ρ_eff = 0.5, d_max 1.0438', () => {
    for (const D of [0.05, 0.2, 0.5, 1.0]) {
      const r = read(frontalPlane(D), aimedPose({ x: 0, y: 0, z: 1 }))
      expect(Math.abs((r.raw as number) - D)).toBeLessThan(1e-12)
      expect(Math.abs(r.reflectance - 0.5)).toBeLessThan(1e-12)
      expect(r.maxRange).toBeCloseTo(1.0438, 4)
      expect(r.distance).toBe(Math.round(D * 1000) / 1000)
      expect(r.surface).toEqual({ kind: 'structure', index: 0 })
      expect(r.rays.every((t) => t !== null)).toBe(true)
    }
  })

  it('A4 30° 기운 평면: raw 0.4973, ρ_eff 0.4318, 가장 가까운 광선보다 길고 0.5보다 짧다', () => {
    const r = read(frontalPlane(0.5, 30 * DEG), aimedPose({ x: 0, y: 0, z: 1 }))
    const raw = r.raw as number
    expect(Math.abs(raw - 0.4973)).toBeLessThan(5e-4)
    expect(Math.abs(r.reflectance - 0.4318)).toBeLessThan(1e-3)
    const nearest = (0.5 * Math.cos(30 * DEG)) / Math.cos((30 - 11.1988) * DEG)
    expect(Math.min(...(r.rays as number[]))).toBeCloseTo(nearest, 4)
    expect(raw).toBeGreaterThan(nearest)
    expect(raw).toBeLessThan(0.5)
    expect(r.distance).toBe(0.497)
  })

  it('A5 바닥: 높이·각도마다 문턱(척도 불변)', () => {
    const field = emptyField()
    for (const h of [0.05, 0.1, 0.2]) {
      const r = read(field, aimedPose({ x: 0, y: 0, z: h }, 0, -90 * DEG))
      expect(Math.abs((r.raw as number) - h)).toBeLessThan(1e-12)
      expect(r.reflectance).toBeCloseTo(0.2, 12)
      expect(r.distance).toBe(Math.round(h * 1000) / 1000)
      expect(r.surface).toEqual({ kind: 'floor' })
    }
    const at = (h: number, pitch: number): ReturnType<typeof readRangeSensor> =>
      read(field, aimedPose({ x: 0, y: 0, z: h }, 0, pitch * DEG))
    expect(Math.abs((at(0.1, -30).raw as number) - 0.1907)).toBeLessThan(1e-3)
    expect(at(0.1, -30).distance).toBe(0.191)
    // −10°: h 0.05 유효 0.2026, h 0.08 유효, h 0.09·0.10 null(d > d_max 0.341)
    expect(Math.abs((at(0.05, -10).raw as number) - 0.2026)).toBeLessThan(1e-3)
    expect(at(0.05, -10).distance).toBe(0.203)
    expect(at(0.08, -10).distance).not.toBeNull()
    expect(at(0.09, -10).distance).toBeNull()
    expect(at(0.1, -10).distance).toBeNull()
    expect(at(0.1, -10).maxRange).toBeCloseTo(0.3412, 3)
    // 수평: h 0.02 유령 0.154, 더 높으면 null
    const ghost = at(0.02, 0)
    expect(Math.abs((ghost.raw as number) - 0.1538)).toBeLessThan(1e-3)
    expect(ghost.distance).toBe(0.154)
    expect(ghost.reflectance).toBeCloseTo(0.0064, 4)
    for (const h of [0.021, 0.03, 0.05, 0.1]) expect(at(h, 0).distance).toBeNull()
    // 위를 보면 아무것도 없다
    const up = at(0.1, 90)
    expect(up).toMatchObject({ distance: null, raw: null, reflectance: 0, surface: null })
    expect(up.rays.every((t) => t === null)).toBe(true)
  })

  it('A6 원뿔 가장자리와 얇은 막대', () => {
    // 반평면 표적(y ≥ y_e 쪽, ρ 0.5, 두께 2 mm 판)을 0.5 m 앞에: 가장자리 각 θ_e = atan(y_e / 0.5)
    const halfPlane = (thetaE: number): ReturnType<typeof testField> => {
      const ye = 0.5 * Math.tan(thetaE)
      return emptyField({
        structures: [sensedBox({ x: 0.501, y: ye + 2, z: 1 }, { x: 0.002, y: 4, z: 4 })]
      })
    }
    const pose = aimedPose({ x: 0, y: 0, z: 1 })
    const outside = read(halfPlane(12.6 * DEG), pose)
    expect(outside.raw).toBeNull()
    expect(outside.distance).toBeNull()
    const edge = read(halfPlane(11 * DEG), pose)
    expect(edge.raw).not.toBeNull()
    // 바깥 고리(θ 11.1988°)만 맞는다
    const outer = TOF_RAYS[TOF_RAYS.length - 1].theta
    TOF_RAYS.forEach((ray, k) => {
      if (edge.rays[k] !== null) expect(ray.theta).toBe(outer)
    })
    // 센서 +Z와 나란한 세운 막대(폭 w, y 방향 폭, 두께 1 cm, ρ 0.5) 0.5 m: 넓힐수록 ρ_eff가 단조 비감소
    let previous = -Infinity
    for (let w = 0.005; w <= 0.2001; w += 0.005) {
      const r = read(
        emptyField({ structures: [sensedBox({ x: 0.505, y: 0, z: 1 }, { x: 0.01, y: w, z: 4 })] }),
        pose
      )
      expect(r.reflectance).toBeGreaterThanOrEqual(previous)
      previous = r.reflectance
    }
    const thin = read(
      emptyField({ structures: [sensedBox({ x: 0.505, y: 0, z: 1 }, { x: 0.01, y: 0.01, z: 4 })] }),
      pose
    )
    expect(thin.distance).toBeNull()
  })

  it('A7 단조·연속', () => {
    let previous = 0
    for (let D = 0.05; D <= 1.0; D += 0.05) {
      const raw = read(frontalPlane(D), aimedPose({ x: 0, y: 0, z: 1 })).raw as number
      expect(raw).toBeGreaterThan(previous)
      previous = raw
    }
    let last = 0
    for (let rho = 0.001; rho <= 1.2; rho += 0.001) {
      const d = tofMaxRange(rho)
      expect(d).toBeGreaterThanOrEqual(last)
      last = d
    }
    expect(Math.abs(tofMaxRange(0.17 + 1e-12) - tofMaxRange(0.17 - 1e-12))).toBeLessThan(1e-9)
    expect(tofMaxRange(0.88)).toBeCloseTo(TOF_WHITE_RANGE, 14)
    expect(tofMaxRange(0.17)).toBeCloseTo(TOF_GREY_RANGE, 14)
  })

  it("A8 범위 밖: 'none' 중앙 수평 h 0.14, 정면 판 1.21 null·1.19 유효", () => {
    expect(read(NONE, aimedPose({ x: 0, y: 0, z: 0.14 })).distance).toBeNull()
    expect(read(NONE, facingWall(1.21, 0.14)).distance).toBeNull()
    expect(read(NONE, facingWall(1.19, 0.14)).distance).toBe(1.188)
  })

  it('A9 투명판: 거울·헤이즈·레일·이음', () => {
    const frontal = read(NONE, facingWall(0.5, 0.14))
    expect(frontal.distance).toBe(0.5)
    expect(Math.abs(frontal.reflectance - 1.036)).toBeLessThan(2e-3)
    expect(frontal.surface).toEqual({ kind: 'panel', wall: 'plusX' })
    expect(read(NONE, facingWall(0.5, 0.14, 8 * DEG)).distance).toBe(0.5)
    const yaw12 = read(NONE, facingWall(0.5, 0.14, 12 * DEG))
    expect(yaw12.distance).toBe(0.501)
    expect(yaw12.reflectance).toBeCloseTo(0.09, 2)
    expect(read(NONE, facingWall(0.5, 0.14, 20 * DEG)).distance).toBeNull()
    expect(read(NONE, facingWall(0.15, 0.14, 20 * DEG)).distance).toBe(0.159)
    // 위 레일 높이 z 0.28: 거울 없음
    const rail = (Dp: number): ReturnType<typeof readRangeSensor> =>
      read(NONE, facingWall(Dp, 0.28))
    expect(Math.abs((rail(0.1).distance as number) - 0.0977)).toBeLessThanOrEqual(1e-3)
    expect(Math.abs((rail(0.3).distance as number) - 0.297)).toBeLessThanOrEqual(1e-3)
    expect(rail(0.1).surface).toEqual({ kind: 'rail', wall: 'plusX' })
    const far = rail(0.5)
    expect(far.distance).toBeNull()
    expect(far.reflectance).toBeCloseTo(0.062, 2)
    // 수선의 발이 판 이음(s 0.594)이면 거울 없음
    expect(
      new FieldRaycaster(NONE).panelMirrors(facingWall(0.5, 0.14, 0, 0.594).origin, {
        x: 1,
        y: 0,
        z: 0
      })
    ).toEqual([])
    expect(read(NONE, facingWall(0.5, 0.14, 0, 0.594)).distance).toBeNull()
  })

  it('A10 BIOBUZZ FLOWER 가림: 앞은 FLOWER 면, 옆은 거울', () => {
    const field = resolveSeason('biobuzz')
    const caster = new FieldRaycaster(field)
    const front = aimedPose({ x: -1.59286, y: -0.594, z: 0.14 }, Math.PI)
    const r = readRangeSensor(caster, front)
    expect(Math.abs((r.raw as number) - 0.0741)).toBeLessThan(1e-4)
    expect(r.surface).toEqual({ kind: 'structure', index: 9 })
    expect(caster.panelMirrors(front.origin, { x: -1, y: 0, z: 0 })).toEqual([])
    expect(caster.blocked(front.origin, { x: -1, y: 0, z: 0 }, 0.3, 'sensed')).toBe(true)
    const side = readRangeSensor(caster, aimedPose({ x: -1.59286, y: -0.45, z: 0.14 }, Math.PI))
    expect(Math.abs((side.raw as number) - 0.2023)).toBeLessThan(1e-4)
    expect(side.surface).toEqual({ kind: 'panel', wall: 'minusX' })
  })

  it('잡음 σ 식: 흰 1.2 m 47.9 mm, 회 0.7 m 49.2 mm(√2로 나누기 전)', () => {
    expect(tofNoiseSigma(1.2, 0.88) * Math.SQRT2).toBeCloseTo(0.0479, 4)
    expect(tofNoiseSigma(0.7, 0.17) * Math.SQRT2).toBeCloseTo(0.0492, 4)
    expect(tofNoiseSigma(0.05, 0.5) * Math.SQRT2).toBe(0.002)
  })
})
