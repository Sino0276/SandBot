import { describe, expect, it } from 'vitest'
import {
  FieldRaycaster,
  MIN_RAY_T,
  PANEL_HAZE,
  raycasterFor,
  SURFACE_TOLERANCE
} from './fieldRaycast'
import { readRangeSensor } from './rangeSensor'
import { applyMatrix3, rotationMatrix } from './seasons/fieldGeometry'
import type { FieldStructure } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { aimedPose, DEG, emptyField, material, sensedBox } from './testkit'
import type { Vec3 } from './worldSpec'

// 필드 기본형 광선(4c, spec-4c §1.3 시험 A11·A23, 바닥·벽·구조물 규칙). 시험 필드는 얕은 복사다.

const NONE = resolveSeason('none')
const BIOBUZZ = resolveSeason('biobuzz')
const IH = NONE.perimeter.innerHalf
const INSET = NONE.perimeter.panelInset

const X: Vec3 = { x: 1, y: 0, z: 0 }
const DOWN: Vec3 = { x: 0, y: 0, z: -1 }
const UP: Vec3 = { x: 0, y: 0, z: 1 }
const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z })
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => ({
  x: a.x + s * b.x,
  y: a.y + s * b.y,
  z: a.z + s * b.z
})

describe('필드 기본형 광선', () => {
  it('raycasterFor는 FieldSpec마다 하나', () => {
    expect(raycasterFor(NONE)).toBe(raycasterFor(NONE))
    expect(raycasterFor(BIOBUZZ)).not.toBe(raycasterFor(NONE))
  })

  it('바닥: 필드 안만, 테이프는 닫힌 사각형, 공차 아래 원점', () => {
    const caster = new FieldRaycaster(BIOBUZZ)
    const tile = caster.cast({ x: 0.3, y: 0.3, z: 0.1 }, DOWN, 2.5)
    expect(tile).toMatchObject({ t: 0.1, cosIncidence: 1, nir: 0.2, surface: { kind: 'floor' } })
    // 빨강 LOADING ZONE 앞 테이프(FieldSpec.tape 2) 가장자리 위 점은 테이프다
    const edge = caster.cast({ x: -0.9, y: -1.51346, z: 0.1 }, DOWN, 2.5)
    expect(edge?.surface).toEqual({ kind: 'tape', index: 2 })
    expect(edge?.rgb).toEqual([0.45, 0.17, 0.13])
    // 파랑(대칭 생성) 테이프
    expect(caster.cast({ x: 0.9, y: 1.52, z: 0.1 }, DOWN, 2.5)?.surface).toEqual({
      kind: 'tape',
      index: 9
    })
    // 필드 밖 바닥과 필드 밖 테이프(offField)는 없다
    expect(caster.cast({ x: 0, y: -1.9, z: 0.1 }, DOWN, 2.5)).toBeNull()
    // 원점이 바닥 위·공차 안이면 MIN_RAY_T, 공차보다 깊으면 없다
    expect(caster.cast({ x: 0, y: 0, z: 0 }, DOWN, 2.5)?.t).toBe(MIN_RAY_T)
    expect(caster.cast({ x: 0, y: 0, z: -0.001 }, DOWN, 2.5)?.t).toBe(MIN_RAY_T)
    expect(caster.cast({ x: 0, y: 0, z: -0.003 }, DOWN, 2.5)).toBeNull()
    // maxT 밖
    expect(caster.cast({ x: 0, y: 0, z: 0.1 }, DOWN, 0.05)).toBeNull()
  })

  it('벽: 레일, 판(헤이즈, 판 안쪽 면), 이음, 위 레일 위, 모서리', () => {
    const caster = new FieldRaycaster(NONE)
    const x0 = IH - 0.5
    const rail = caster.cast({ x: x0, y: 0, z: 0.005 }, X, 2.5)
    expect(rail).toMatchObject({
      cosIncidence: 1,
      nir: 0.3,
      surface: { kind: 'rail', wall: 'plusX' }
    })
    expect(rail?.t).toBeCloseTo(0.5, 12)
    const panel = caster.cast({ x: x0, y: 0, z: 0.14 }, X, 2.5)
    expect(panel?.surface).toEqual({ kind: 'panel', wall: 'plusX' })
    expect(panel?.t).toBeCloseTo(0.5 + INSET, 12)
    expect(panel?.rgb).toEqual([PANEL_HAZE, PANEL_HAZE, PANEL_HAZE])
    expect(panel?.nir).toBe(PANEL_HAZE)
    // 판 이음(벽 방향 s 0.594)과 위 레일 위는 지나간다
    expect(caster.cast({ x: x0, y: 0.594, z: 0.14 }, X, 2.5)).toBeNull()
    expect(caster.cast({ x: x0, y: 0.594, z: 0.28 }, X, 2.5)?.surface).toEqual({
      kind: 'rail',
      wall: 'plusX'
    })
    expect(caster.cast({ x: x0, y: 0, z: 0.35 }, X, 2.5)).toBeNull()
    // 네 벽
    expect(caster.cast({ x: 0, y: 0, z: 0.005 }, neg(X), 2.5)?.surface).toEqual({
      kind: 'rail',
      wall: 'minusX'
    })
    expect(caster.cast({ x: 0, y: 0, z: 0.005 }, { x: 0, y: 1, z: 0 }, 2.5)?.surface).toEqual({
      kind: 'rail',
      wall: 'plusY'
    })
    expect(caster.cast({ x: 0, y: 0, z: 0.005 }, { x: 0, y: -1, z: 0 }, 2.5)?.surface).toEqual({
      kind: 'rail',
      wall: 'minusY'
    })
    // 모서리를 정확히 보면 같은 t라 앞 벽(+x)
    const corner = caster.cast(
      { x: 0, y: 0, z: 0.005 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 },
      2.6
    )
    expect(corner?.surface).toEqual({ kind: 'rail', wall: 'plusX' })
  })

  it('A23 벽면 위·밖·안 원점: 유한하고 0.01 m 이하', () => {
    const caster = new FieldRaycaster(NONE)
    for (const x of [IH, IH + 1e-6, IH - 1e-6]) {
      const hit = caster.cast({ x, y: 0, z: 0.14 }, X, 2.5)
      expect(hit?.surface).toEqual({ kind: 'panel', wall: 'plusX' })
      const r = readRangeSensor(caster, aimedPose({ x, y: 0, z: 0.14 }))
      expect(Number.isFinite(r.distance)).toBe(true)
      expect(r.distance as number).toBeLessThanOrEqual(0.01)
      const low = readRangeSensor(caster, aimedPose({ x, y: 0, z: 0.005 }))
      expect(Number.isFinite(low.distance)).toBe(true)
      expect(low.distance as number).toBeLessThanOrEqual(0.01)
    }
    // 공차보다 밖이면 벽을 보지 않는다
    expect(caster.cast({ x: IH + SURFACE_TOLERANCE + 1e-4, y: 0, z: 0.005 }, X, 2.5)).toBeNull()
  })

  it('A23 FLOWER 면 위·1e-6 m 안·1 mm 안은 FLOWER, 3 mm 안이면 무시', () => {
    const caster = new FieldRaycaster(BIOBUZZ)
    const flower = BIOBUZZ.structures[9].shape
    if (flower.kind !== 'box') throw new Error('box')
    const face = flower.center.x + flower.size.x / 2
    for (const inside of [0, 1e-6, 0.001]) {
      const origin = { x: face - inside, y: -0.594, z: 0.14 }
      const hit = caster.cast(origin, neg(X), 2.5)
      expect(hit).toMatchObject({ t: MIN_RAY_T, surface: { kind: 'structure', index: 9 } })
      const r = readRangeSensor(caster, aimedPose(origin, Math.PI))
      expect(Number.isFinite(r.distance)).toBe(true)
      expect(r.distance as number).toBeLessThanOrEqual(0.01)
    }
    // 1e-6 m 밖은 들어가는 면
    const outside = caster.cast({ x: face + 1e-6, y: -0.594, z: 0.14 }, neg(X), 2.5)
    expect(outside?.t).toBe(MIN_RAY_T)
    expect(outside?.surface).toEqual({ kind: 'structure', index: 9 })
    const deep = caster.cast({ x: face - 0.003, y: -0.594, z: 0.14 }, neg(X), 2.5)
    expect(deep?.surface).not.toEqual({ kind: 'structure', index: 9 })
    // 안에서 밖으로 보면 그 면을 보지 않는다
    expect(caster.cast({ x: face - 1e-6, y: -0.594, z: 0.14 }, X, 0.5)).toBeNull()
  })

  it('A11 구조물: 발판 막대·기운 다리·로고 판에 해석 거리', () => {
    const caster = new FieldRaycaster(BIOBUZZ)
    // 발판 막대 0: 앞면 y = −0.60303 − 0.05037/2
    const foot = caster.cast({ x: 0.1, y: -1, z: 0.03 }, { x: 0, y: 1, z: 0 }, 2.5)
    expect(foot?.surface).toEqual({ kind: 'structure', index: 0 })
    expect(Math.abs((foot?.t as number) - (1 - 0.60303 - 0.05037 / 2))).toBeLessThan(1e-12)
    expect(foot?.cosIncidence).toBeCloseTo(1, 12)
    // 기운 다리 2·3·4·5: 자기 +x 면 법선을 따라 0.3 m 밖에서 그 면을 본다
    for (const index of [2, 3, 4, 5]) {
      const shape = BIOBUZZ.structures[index].shape
      if (shape.kind !== 'box') throw new Error('box')
      const n = applyMatrix3(rotationMatrix(shape.rotation), X)
      const origin = add(shape.center, n, shape.size.x / 2 + 0.3)
      const hit = caster.cast(origin, neg(n), 2.5)
      expect(hit?.surface).toEqual({ kind: 'structure', index })
      expect(Math.abs((hit?.t as number) - 0.3)).toBeLessThan(1e-12)
      expect(hit?.cosIncidence).toBeCloseTo(1, 12)
    }
    // 로고 판 7(24° 기움)을 아래에서 위로 본다: 아래 면(바깥 법선 −n) 평면까지
    const logo = BIOBUZZ.structures[7].shape
    if (logo.kind !== 'box') throw new Error('box')
    const n = applyMatrix3(rotationMatrix(logo.rotation), X)
    const origin = { x: logo.center.x, y: 0.1, z: 0.5 }
    const rel = add(origin, logo.center, -1)
    const expected = (-logo.size.x / 2 - (n.x * rel.x + n.y * rel.y + n.z * rel.z)) / n.z
    const hit = caster.cast(origin, UP, 2.5)
    expect(hit?.surface).toEqual({ kind: 'structure', index: 7 })
    expect(Math.abs((hit?.t as number) - expected)).toBeLessThan(1e-12)
    expect(hit?.cosIncidence).toBeCloseTo(Math.abs(n.z), 12)
  })

  it('A11 HIVE CELL(sensed false, HIVE 몸체 틀)은 맞지 않는다', () => {
    const origin = { x: 0.3, y: -0.32385, z: 0.5 }
    expect(new FieldRaycaster(BIOBUZZ).cast(origin, UP, 2.5)).toBeNull()
    // 같은 자리에 field carrier sensed로 바꾼 CELL(빨강 HIVE 시작 자세를 필드에 펼친 상자)이 있으면 맞는다
    const cell = BIOBUZZ.structures[14]
    const hive = BIOBUZZ.hives[0]
    if (cell.shape.kind !== 'box') throw new Error('box')
    const r = rotationMatrix({ x: 0, y: hive.startAngle, z: 0 })
    const center = add(hive.pivot, applyMatrix3(r, cell.shape.center))
    const asField: FieldStructure = {
      ...cell,
      shape: { ...cell.shape, center, rotation: { x: 0, y: hive.startAngle, z: 0 } },
      sensed: true,
      carrier: 'field'
    }
    const field = { ...BIOBUZZ, structures: [...BIOBUZZ.structures, asField] }
    expect(new FieldRaycaster(field).cast(origin, UP, 2.5)?.surface).toEqual({
      kind: 'structure',
      index: BIOBUZZ.structures.length
    })
  })

  it('blocked: 플래그를 고르고, (0, maxT)만, 원점이 안인 상자는 가리지 않는다', () => {
    const field = emptyField({
      structures: [
        sensedBox({ x: 1, y: 0, z: 0.5 }, { x: 0.2, y: 0.2, z: 0.2 }, 0, material(0.5), {
          sensed: false,
          occludes: true
        }),
        sensedBox({ x: 2, y: 0, z: 0.5 }, { x: 0.2, y: 0.2, z: 0.2 }, 0, material(0.5), {
          sensed: true,
          occludes: false
        })
      ]
    })
    const caster = new FieldRaycaster(field)
    const o = { x: 0, y: 0, z: 0.5 }
    expect(caster.blocked(o, X, 1.5, 'occludes')).toBe(true)
    expect(caster.blocked(o, X, 1.5, 'sensed')).toBe(false)
    expect(caster.blocked(o, X, 2.5, 'sensed')).toBe(true)
    expect(caster.blocked(o, X, 0.9, 'occludes')).toBe(false)
    expect(caster.blocked({ x: 1, y: 0, z: 0.5 }, X, 2.5, 'occludes')).toBe(false)
    // cast는 sensed만 본다
    expect(caster.cast(o, X, 2.5)?.surface).toEqual({ kind: 'structure', index: 1 })
  })

  it('A11 원점이 상자 안: 공차 안·안쪽으로만 맞고 더 깊으면 무시', () => {
    const field = emptyField({
      structures: [sensedBox({ x: 1, y: 0, z: 0.5 }, { x: 0.2, y: 0.2, z: 0.2 })]
    })
    const caster = new FieldRaycaster(field)
    // −x 면(x 0.9) 1 mm 안에서 +x(안쪽)로
    expect(caster.cast({ x: 0.901, y: 0, z: 0.5 }, X, 2.5)).toMatchObject({
      t: MIN_RAY_T,
      cosIncidence: 1,
      surface: { kind: 'structure', index: 0 }
    })
    expect(caster.cast({ x: 0.903, y: 0, z: 0.5 }, X, 2.5)).toBeNull()
    expect(caster.cast({ x: 0.901, y: 0, z: 0.5 }, neg(X), 2.5)).toBeNull()
  })

  it('A11 세운 원기둥: 옆면·뚜껑·안 원점', () => {
    const cylinder: FieldStructure = {
      ...sensedBox({ x: 1, y: 0, z: 0.5 }, { x: 1, y: 1, z: 1 }),
      shape: {
        kind: 'cylinder',
        center: { x: 1, y: 0, z: 0.5 },
        rotation: { x: 0, y: 0, z: 0.3 },
        radius: 0.1,
        height: 0.4
      }
    }
    const caster = new FieldRaycaster(emptyField({ structures: [cylinder] }))
    const side = caster.cast({ x: 0, y: 0, z: 0.5 }, X, 2.5)
    expect(side?.t).toBeCloseTo(0.9, 12)
    expect(side?.cosIncidence).toBeCloseTo(1, 12)
    const offset = caster.cast({ x: 0.5, y: 0.05, z: 0.5 }, X, 2.5)
    expect(offset?.t).toBeCloseTo(0.5 - Math.sqrt(0.01 - 0.0025), 12)
    expect(offset?.cosIncidence).toBeCloseTo(Math.sqrt(0.01 - 0.0025) / 0.1, 12)
    const cap = caster.cast({ x: 1.05, y: 0, z: 1 }, DOWN, 2.5)
    expect(cap?.t).toBeCloseTo(0.3, 12)
    expect(cap?.cosIncidence).toBeCloseTo(1, 12)
    expect(caster.cast({ x: 1.05, y: 0, z: 0 }, UP, 2.5)?.t).toBeCloseTo(0.3, 12)
    // 비스듬히 위에서 옆면을 스치지 않고 뚜껑으로
    expect(
      caster.cast({ x: 1.2, y: 0, z: 0.8 }, { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 }, 2.5)?.t
    ).toBeCloseTo(0.1 * Math.SQRT2, 12)
    // 안: 위 뚜껑 1 mm 아래에서 아래로(안쪽) 맞고 위로(밖) 무시, 옆면 1 mm 안, 3 mm 안 무시
    expect(caster.cast({ x: 1, y: 0, z: 0.699 }, DOWN, 2.5)?.t).toBe(MIN_RAY_T)
    expect(caster.cast({ x: 1, y: 0, z: 0.699 }, UP, 2.5)).toBeNull()
    expect(caster.cast({ x: 1.099, y: 0, z: 0.5 }, neg(X), 2.5)?.t).toBe(MIN_RAY_T)
    expect(caster.cast({ x: 1.097, y: 0, z: 0.5 }, neg(X), 2.5)).toBeNull()
    expect(caster.blocked({ x: 0, y: 0, z: 0.5 }, X, 2.5, 'sensed')).toBe(true)
    expect(caster.blocked({ x: 1, y: 0, z: 0.5 }, X, 2.5, 'sensed')).toBe(false)
  })

  it('panelMirrors: 창 12.5°, 판 안쪽 면까지 D, 판 구간·2.5 m', () => {
    const caster = new FieldRaycaster(NONE)
    const o = { x: IH + INSET - 0.5, y: 0, z: 0.14 }
    const yawed = (deg: number): Vec3 => ({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG), z: 0 })
    const m = caster.panelMirrors(o, yawed(12))
    expect(m).toHaveLength(1)
    expect(m[0].wall).toBe('plusX')
    expect(m[0].distance).toBeCloseTo(0.5, 12)
    expect(m[0].angle).toBeCloseTo(12 * DEG, 12)
    expect(caster.panelMirrors(o, yawed(13))).toEqual([])
    expect(caster.panelMirrors({ ...o, z: 0.005 }, X)).toEqual([])
    expect(caster.panelMirrors({ x: IH + INSET - 2.6, y: 0, z: 0.14 }, X)).toEqual([])
  })
})
