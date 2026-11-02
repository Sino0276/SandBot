import { describe, expect, it } from 'vitest'
import { MATERIAL_KEYS } from '../mass/types'
import {
  canHaveMass,
  canHaveRigidbody,
  isMaterialKey,
  sameMass,
  sameRigidbody,
  sanitizeMass,
  sanitizeRigidbody
} from './massSettings'
import type { SceneObject } from './model'

const object = (kind: SceneObject['kind'], cad = false): SceneObject => ({
  id: 'o',
  name: 'o',
  kind,
  parentId: null,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
  ...(cad
    ? {
        cad: {
          fileName: 'a.step',
          absolutePath: '/a.step',
          upAxis: '+Z',
          forwardAxis: '+X',
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          meshCount: 1
        }
      }
    : {})
})

describe('질량 설정 정리', () => {
  it('질량 설정은 로봇이 아닌 오브젝트(CAD 루트 포함)에, Rigidbody는 로봇에만', () => {
    expect(canHaveMass(object('part'))).toBe(true)
    expect(canHaveMass(object('group'))).toBe(true)
    expect(canHaveMass(object('assembly', true))).toBe(true)
    expect(canHaveMass(object('robot'))).toBe(false)
    expect(canHaveRigidbody(object('robot'))).toBe(true)
    expect(canHaveRigidbody(object('group'))).toBe(false)
  })

  it('재질 키는 목록에 있는 것만', () => {
    for (const key of MATERIAL_KEYS) expect(isMaterialKey(key)).toBe(true)
    for (const value of ['Steel', 'wood', '', 3, null]) expect(isMaterialKey(value)).toBe(false)
  })

  it('범위 안 값은 남기고 범위 밖·형식이 틀린 필드만 버린다(빈 설정도 남긴다)', () => {
    expect(
      sanitizeMass({ material: 'petg', infill: 0.2, mass: 0.25, centerOfMass: [0, 0.01, -0.02] })
    ).toEqual({ material: 'petg', infill: 0.2, mass: 0.25, centerOfMass: [0, 0.01, -0.02] })
    expect(sanitizeMass({})).toEqual({})
    // 경계: infill 0·1, 질량 100 kg, 무게중심 ±10 m
    expect(sanitizeMass({ infill: 0, mass: 100, centerOfMass: [10, -10, 0] })).toEqual({
      infill: 0,
      mass: 100,
      centerOfMass: [10, -10, 0]
    })
    expect(sanitizeMass({ infill: 1 })).toEqual({ infill: 1 })
    for (const bad of [
      { material: 'adamantium' },
      { infill: -0.01 },
      { infill: 1.01 },
      { infill: '0.2' },
      { mass: 0 },
      { mass: -1 },
      { mass: 100.5 },
      { mass: Number.NaN },
      { mass: Number.POSITIVE_INFINITY },
      { centerOfMass: [0, 0] },
      { centerOfMass: [0, 0, 10.1] },
      { centerOfMass: [0, 0, Number.NaN] },
      { centerOfMass: 'here' }
    ]) {
      expect(sanitizeMass(bad)).toEqual({})
    }
  })

  it('키 순서가 늘 같고 무게중심은 복사한다', () => {
    const center: [number, number, number] = [1, 2, 3]
    const result = sanitizeMass({ centerOfMass: center, mass: 1, infill: 0.5, material: 'pla' })
    expect(Object.keys(result)).toEqual(['material', 'infill', 'mass', 'centerOfMass'])
    expect(result.centerOfMass).not.toBe(center)
  })

  it('Rigidbody: 저울 무게 0 < m ≤ 200 kg, 정한 것이 없으면 null', () => {
    expect(sanitizeRigidbody({ weighedMass: 13.2, defaultMaterial: 'pla' })).toEqual({
      weighedMass: 13.2,
      defaultMaterial: 'pla'
    })
    expect(sanitizeRigidbody({ weighedMass: 200 })).toEqual({ weighedMass: 200 })
    expect(sanitizeRigidbody({})).toBeNull()
    expect(sanitizeRigidbody({ weighedMass: 0, defaultMaterial: 'gold' })).toBeNull()
    expect(sanitizeRigidbody({ weighedMass: 200.1 })).toBeNull()
    expect(sanitizeRigidbody({ weighedMass: '12' })).toBeNull()
  })

  it('같은 설정인지 비교한다', () => {
    expect(sameMass(undefined, undefined)).toBe(true)
    expect(sameMass({}, undefined)).toBe(false)
    expect(sameMass({}, {})).toBe(true)
    expect(sameMass({ centerOfMass: [1, 2, 3] }, { centerOfMass: [1, 2, 3] })).toBe(true)
    expect(sameMass({ centerOfMass: [1, 2, 3] }, { centerOfMass: [1, 2, 4] })).toBe(false)
    expect(sameMass({ mass: 1 }, { mass: 1, infill: 0.1 })).toBe(false)
    expect(sameRigidbody({ weighedMass: 1 }, { weighedMass: 1 })).toBe(true)
    expect(sameRigidbody({ weighedMass: 1 }, { defaultMaterial: 'pla' })).toBe(false)
    expect(sameRigidbody(undefined, { weighedMass: 1 })).toBe(false)
  })
})
