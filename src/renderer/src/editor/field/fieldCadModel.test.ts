import { describe, expect, it } from 'vitest'
import { ALIGNMENT_PRESETS } from '../../cad/alignment'
import { DEFAULT_FIELD_VISUAL_ALIGNMENT } from '../../scene/fieldDoc'
import {
  alignedFieldCadBounds,
  fieldCadAlignmentSuspect,
  fieldCadBoundsParams,
  type FieldCadBounds
} from './fieldCadModel'

// 필드 CAD 정렬 확인(spec-4e §4.1, B11)

// 공식 BIOBUZZ 필드 STEP의 경계 상자(CAD 좌표, m, cad/bbox.json)
const OFFICIAL: FieldCadBounds = { min: [-3.192, -0.043, -1.824], max: [3.192, 1.677, 1.824] }

describe('fieldCadAlignmentSuspect (B11)', () => {
  it('공식 파일 + Y-up(기본)은 경고 없음: 필드 (X, Y, Z) = (CAD z, x, y)', () => {
    expect(DEFAULT_FIELD_VISUAL_ALIGNMENT).toEqual(ALIGNMENT_PRESETS.yUp)
    const aligned = alignedFieldCadBounds(OFFICIAL, DEFAULT_FIELD_VISUAL_ALIGNMENT)
    expect(aligned).toEqual({ min: [-1.824, -3.192, -0.043], max: [1.824, 3.192, 1.677] })
    expect(fieldCadAlignmentSuspect(OFFICIAL, DEFAULT_FIELD_VISUAL_ALIGNMENT)).toBe(false)
  })

  it('같은 상자 + Z-up은 경고(위 축: Z 폭 3.65 m ≥ X 폭 1.72 m)', () => {
    const aligned = alignedFieldCadBounds(OFFICIAL, ALIGNMENT_PRESETS.zUp)
    // zUp: 필드 = (−CAD y, CAD x, CAD z)
    expect(aligned).toEqual({ min: [-1.677, -3.192, -1.824], max: [0.043, 3.192, 1.824] })
    expect(fieldCadAlignmentSuspect(OFFICIAL, ALIGNMENT_PRESETS.zUp)).toBe(true)
  })

  it('정렬한 Z가 0을 품지 않으면 경고(원점이 바닥이 아님)', () => {
    const lifted: FieldCadBounds = { min: [-3.192, 0.5, -1.824], max: [3.192, 2.2, 1.824] }
    expect(fieldCadAlignmentSuspect(lifted, DEFAULT_FIELD_VISUAL_ALIGNMENT)).toBe(true)
    const sunk: FieldCadBounds = { min: [-3.192, -1.8, -1.824], max: [3.192, -0.1, 1.824] }
    expect(fieldCadAlignmentSuspect(sunk, DEFAULT_FIELD_VISUAL_ALIGNMENT)).toBe(true)
    // 바닥이 정확히 0이면 품는다
    const flush: FieldCadBounds = { min: [-3.192, 0, -1.824], max: [3.192, 1.677, 1.824] }
    expect(fieldCadAlignmentSuspect(flush, DEFAULT_FIELD_VISUAL_ALIGNMENT)).toBe(false)
  })

  it('경계 상자 줄의 글자는 −0 없이 최소..최대 단위', () => {
    const flat: FieldCadBounds = { min: [-1, 0, -2], max: [1, 0.5, 2] }
    const params = fieldCadBoundsParams(flat, ALIGNMENT_PRESETS.zUp, (m) => String(m), 'm')
    // zUp: X = −CAD y ∈ [−0.5, −0](−0은 0으로)
    expect(params).toEqual({ x: '-0.5..0 m', y: '-1..1 m', z: '-2..2 m' })
  })
})
