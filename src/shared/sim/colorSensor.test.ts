import { describe, expect, it } from 'vitest'
import {
  COLOR_BACKGROUND_READING,
  COLOR_FOOTPRINT,
  COLOR_FOOTPRINT_SPREAD,
  COLOR_MIN_DISTANCE,
  PROXIMITY_NONE,
  readColorSensor,
  type ColorReading
} from './colorSensor'
import { FieldRaycaster } from './fieldRaycast'
import type { FieldMaterial, FieldSpec } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { aimedPose, DEG, emptyField } from './testkit'

// REV Color Sensor V3 모델(4c, spec-4c §1.5 시험 A12–A14·A7·A23). 기대 정수는 부록 A(s4c2/ctab.py, Python)와 같다.

const NONE = resolveSeason('none')
const BIOBUZZ = resolveSeason('biobuzz')
const TILE = BIOBUZZ.floor.material
const RED = BIOBUZZ.tape[0].material
const BLUE = BIOBUZZ.tape[7].material

// 넓은 바닥 재질(빈 필드에 바닥을 덮는 테이프 하나)
function floorOf(mat: FieldMaterial): FieldSpec {
  return emptyField(
    mat === TILE
      ? {}
      : { tape: [{ key: 'garden', alliance: 'red', rect: [-9, -9, 9, 9], material: mat }] }
  )
}

const down = (field: FieldSpec, x: number, y: number, d: number, yaw = 0): ColorReading =>
  readColorSensor(new FieldRaycaster(field), aimedPose({ x, y, z: d }, yaw, -90 * DEG))

const values = (r: ColorReading): number[] => [r.red, r.green, r.blue, r.proximity]

const HEIGHTS = [0.005, 0.01, 0.015, 0.025, 0.05]
const TABLE: [FieldMaterial, number[][]][] = [
  [
    TILE,
    [
      [843, 902, 582, 836],
      [486, 520, 336, 472],
      [309, 331, 213, 288],
      [190, 203, 131, 160],
      [119, 128, 82, 80]
    ]
  ],
  [
    RED,
    [
      [1896, 766, 378, 2047],
      [1094, 442, 218, 1362],
      [696, 281, 139, 810],
      [428, 173, 85, 426],
      [269, 109, 54, 187]
    ]
  ],
  [
    BLUE,
    [
      [421, 1262, 1280, 2047],
      [243, 728, 738, 1139],
      [155, 463, 470, 679],
      [95, 285, 289, 360],
      [60, 179, 181, 161]
    ]
  ]
]

describe('컬러 센서 모델', () => {
  it('발자국 7방향: 축 + atan(0.6) 기운 6광선', () => {
    expect(COLOR_FOOTPRINT).toHaveLength(7)
    expect(COLOR_FOOTPRINT[0]).toEqual({ x: 1, y: 0, z: 0 })
    for (const d of COLOR_FOOTPRINT.slice(1)) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 15)
      expect(Math.hypot(d.y, d.z) / d.x).toBeCloseTo(COLOR_FOOTPRINT_SPREAD, 14)
    }
  })

  it('A12 정면 균일 면: 부록 A 표와 정수로 같다', () => {
    for (const [mat, rows] of TABLE) {
      const field = floorOf(mat)
      HEIGHTS.forEach((d, i) => {
        const r = down(field, 0, 0, d)
        expect(values(r)).toEqual(rows[i])
        expect(r.distance).toBeCloseTo(d, 12)
        expect(r.footprint.every((t) => t !== null)).toBe(true)
        // 바깥 6점은 반경 0.6·d(정면 평면)
        for (const t of r.footprint.slice(1))
          expect(t as number).toBeCloseTo(d * Math.hypot(1, 0.6), 12)
      })
    }
  })

  it('A12 BIOBUZZ 빨강 GARDEN 2 in 테이프 중심', () => {
    expect(values(down(BIOBUZZ, 1.76746, -1.5, 0.015))).toEqual(TABLE[1][1][2])
    expect(values(down(BIOBUZZ, 1.76746, -1.5, 0.025))).toEqual(TABLE[1][1][3])
    expect(down(BIOBUZZ, 1.76746, -1.5, 0.015).surface).toEqual({ kind: 'tape', index: 3 })
  })

  it('A12 축 빗나감은 배경 79·85·55·27, 판 정면은 헤이즈 + 판 너머 배경', () => {
    const up = readColorSensor(
      new FieldRaycaster(NONE),
      aimedPose({ x: 0, y: 0, z: 0.14 }, 0, 90 * DEG)
    )
    expect(values(up)).toEqual([79, 85, 55, PROXIMITY_NONE])
    expect(up).toEqual(COLOR_BACKGROUND_READING)
    expect(up.distance).toBeNull()
    expect(up.surface).toBeNull()
    const ih = NONE.perimeter.innerHalf + NONE.perimeter.panelInset
    const panel = readColorSensor(
      new FieldRaycaster(NONE),
      aimedPose({ x: ih - 0.05, y: 0, z: 0.14 })
    )
    expect(values(panel)).toEqual([68, 73, 47, 30])
    expect(panel.surface).toEqual({ kind: 'panel', wall: 'plusX' })
  })

  it('A13 테이프 가장자리: 단조 비감소 309 → 696, 요 0° 네 수준·45° 여덟 수준', () => {
    const edge = -1.53886
    const levels = (yaw: number): number[] => {
      const seq: number[] = []
      for (let k = -30; k <= 25; k++)
        seq.push(down(BIOBUZZ, -0.9, edge + 1e-6 + k * 0.0005, 0.015, yaw).red)
      for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1])
      expect(seq[0]).toBe(309)
      expect(seq[seq.length - 1]).toBe(696)
      return [...new Set(seq)]
    }
    expect(levels(0)).toEqual([309, 420, 585, 696])
    expect(levels(45 * DEG)).toEqual([309, 364, 420, 475, 530, 585, 640, 696])
    // 가장자리 1e-6 m 안
    expect(down(BIOBUZZ, -0.9, edge + 1e-6, 0.015).red).toBe(585)
    expect(down(BIOBUZZ, -0.9, edge + 1e-6, 0.015, 45 * DEG).red).toBe(530)
  })

  it('A14 근거리는 0.25 in에서 자른다', () => {
    const field = floorOf(TILE)
    expect(values(down(field, 0, 0, 0.002))).toEqual(values(down(field, 0, 0, COLOR_MIN_DISTANCE)))
    expect(down(field, 0, 0, 0.002).distance).toBeCloseTo(0.002, 12)
  })

  it('A7 정면 타일 d 0.0064–0.10: raw·PS 단조 비증가', () => {
    const field = floorOf(TILE)
    let previous = values(down(field, 0, 0, 0.0064))
    for (let d = 0.0065; d <= 0.1; d += 0.0001) {
      const now = values(down(field, 0, 0, d))
      now.forEach((v, i) => expect(v).toBeLessThanOrEqual(previous[i]))
      previous = now
    }
  })

  it('A23 바닥 높이 하우징: o_z 0·−1e-6은 0.25 in 값, −3 mm는 축 빗나감', () => {
    const near = values(down(BIOBUZZ, 0.3, 0.3, COLOR_MIN_DISTANCE))
    expect(near).toEqual(TABLE[0][1][0])
    expect(values(down(BIOBUZZ, 0.3, 0.3, 0))).toEqual(near)
    expect(values(down(BIOBUZZ, 0.3, 0.3, -1e-6))).toEqual(near)
    expect(down(BIOBUZZ, 0.3, 0.3, -0.003)).toEqual(COLOR_BACKGROUND_READING)
  })

  it('모든 값이 범위 안 정수', () => {
    for (let d = 0.001; d < 0.3; d += 0.01) {
      const r = down(BIOBUZZ, -0.9, -1.52, d)
      for (const v of values(r)) expect(Number.isInteger(v)).toBe(true)
      expect(r.proximity).toBeLessThanOrEqual(2047)
      for (const v of [r.red, r.green, r.blue]) expect(v).toBeLessThanOrEqual(65535)
    }
  })
})
