import { describe, expect, it } from 'vitest'
import {
  applyMatrix3,
  partInsideShape,
  rotationMatrix,
  spherePartSeparation
} from './fieldGeometry'
import {
  CELL_BACK_SKIN_PART_KEY,
  CELL_FLOOR_PART_KEY,
  checkFieldSpec,
  FIELD_PART_KEYS,
  fieldPartOwner,
  isFieldPartKey,
  PART_ENVELOPE_EXCEPTIONS,
  placementActive,
  placementFieldPosition,
  type FieldElementPlacement,
  type FieldHive,
  type FieldPart,
  type FieldSpec,
  type FieldStructure
} from './fieldSpec'
import { resolveSeason } from './seasons'
import {
  mirrorElementPlacement,
  mirrorHive,
  mirrorPart,
  mirrorStructure,
  mirrorVec3,
  wrapPi
} from './symmetry'
import { tagFieldPose } from './tagPoses'

// 6b 계약(spec-6b §1.1·§1.2): 구조물·HIVE 부품의 모양·거울·데이터 검사, 시작 배치의 carrier·when(placementActive·
// placementFieldPosition), 묶음별 배치 검사(flower·hiveCell). 규칙만 보려고 BIOBUZZ에서 6b 데이터(구조물·HIVE 부품, HIVE 동역학,
// flower·hiveCell 배치)를 뺀 판에 시험이 만든 부품·배치를 얹는다. 실제 6b 데이터는 seasons6b.test.ts가 본다.

function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const out = { ...value }
  for (const key of keys) delete out[key]
  return out
}
const resolved = resolveSeason('biobuzz')
const biobuzz: FieldSpec = {
  ...resolved,
  structures: resolved.structures.map((s) => without(s, 'parts')),
  hives: resolved.hives.map((h) => without(h, 'dynamics', 'parts')),
  elements: {
    ...resolved.elements!,
    layout: resolved.elements!.layout.filter((p) => p.group === 'garden')
  }
}
const POLLEN_R = biobuzz.elements!.types.find((t) => t.kind === 'pollen')!.radius
const NECTAR_R = biobuzz.elements!.types.find((t) => t.kind === 'nectarRed')!.radius
const FLOWER = 9
const FLOWER_MIRROR = 10
const CELL = 14
const CELL_MIRROR = 16
// FLOWER 9 축(spec-6b 부록 A.2)
const AXIS = { x: -1.728254, y: -0.59418 }
const START: readonly [boolean, boolean] = [false, false]

const zero = { x: 0, y: 0, z: 0 }

// FLOWER 9 관 넷(세운 원기둥, 공 전용 부품, 부록 A.2): 축에서 (±0.043815, ±0.043815), 반지름 0.013343, w ∈ [0.108052, 0.539852]
const PIPES: FieldPart[] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1]
].map(([su, sv]) => ({
  shape: {
    kind: 'cylinder',
    center: { x: AXIS.x + su * 0.043815, y: AXIS.y + sv * 0.043815, z: 0.323952 },
    rotation: zero,
    radius: 0.013343,
    height: 0.4318
  },
  robots: true,
  balls: true,
  key: 'flowerPipe'
}))
// 로봇 전용 아래 고리 판(구멍을 채운 볼록 기둥, 반시계 정사각형)
const BOTTOM_PLATE: FieldPart = {
  shape: {
    kind: 'prism',
    center: { x: AXIS.x, y: AXIS.y, z: 0.004496 },
    rotation: zero,
    polygon: [
      { x: -0.05, y: -0.05 },
      { x: 0.05, y: -0.05 },
      { x: 0.05, y: 0.05 },
      { x: -0.05, y: 0.05 }
    ],
    height: 0.008992
  },
  robots: true,
  balls: false,
  key: 'flowerRingBottom'
}

function withParts(index: number, parts: readonly FieldPart[]): FieldStructure {
  return { ...biobuzz.structures[index], parts }
}

// FLOWER 9에 parts를 두고 그 짝 10은 거울로 만든 판(elements는 그대로)
function flowerSpec(parts: readonly FieldPart[], mirrorParts = parts.map(mirrorPart)): FieldSpec {
  const structures = biobuzz.structures.map((s, i) => {
    if (i === FLOWER) return withParts(FLOWER, parts)
    if (i === FLOWER_MIRROR)
      return { ...mirrorStructure(withParts(FLOWER, parts)), parts: mirrorParts }
    return s
  })
  return { ...biobuzz, structures }
}

// 부품 검사 오류만(배치 검사 오류와 섞지 않게)
const partErrors = (spec: FieldSpec): string[] =>
  checkFieldSpec(spec).filter((e) => e.includes('parts') || e.startsWith('hives'))

describe('placementActive·placementFieldPosition', () => {
  const garden = biobuzz.elements!.layout[0]
  const cellRed: FieldElementPlacement = {
    group: 'hiveCell',
    kind: 'nectarRed',
    position: { x: 0.4, y: 0.1, z: 0.05 },
    carrier: 'hiveRed',
    when: 'start'
  }

  it('carrier·when이 없으면 늘 생기고, 있으면 그 HIVE의 시작 상태가 when과 같을 때만', () => {
    for (const tipped of [
      [false, false],
      [true, false],
      [false, true],
      [true, true]
    ] as const) {
      expect(placementActive(garden, tipped)).toBe(true)
      expect(placementActive({ ...cellRed, when: undefined }, tipped)).toBe(true)
      expect(placementActive(cellRed, tipped)).toBe(!tipped[0])
      expect(placementActive({ ...cellRed, when: 'tipped' }, tipped)).toBe(tipped[0])
      const blue = mirrorElementPlacement(cellRed)
      expect(placementActive(blue, tipped)).toBe(!tipped[1])
    }
  })

  it('필드 배치는 위치의 복사본이다', () => {
    const p = placementFieldPosition(biobuzz, garden, START)
    expect(p).toEqual(garden.position)
    expect(p).not.toBe(garden.position)
  })

  it('HIVE 몸체 틀 배치는 T(pivot)·R_y(시작 각)·position(태그 자세와 같은 연산, 비트까지)', () => {
    const hive = biobuzz.hives[0]
    for (const tipped of [START, [true, false] as const]) {
      const angle = tipped[0] ? hive.tippedAngle : hive.startAngle
      const q = applyMatrix3(rotationMatrix({ x: 0, y: angle, z: 0 }), cellRed.position)
      const expected = { x: hive.pivot.x + q.x, y: hive.pivot.y + q.y, z: hive.pivot.z + q.z }
      const actual = placementFieldPosition(biobuzz, cellRed, tipped)
      expect(actual).toEqual(expected)
      // 같은 carrier·위치의 태그 필드 자세와 같다(seasons/tagPoses.ts와 같은 호출 순서)
      const tag = {
        ...biobuzz.aprilTags.tags[0],
        carrier: 'hiveRed' as const,
        position: cellRed.position,
        rotation: zero
      }
      expect(tagFieldPose(biobuzz, tag, tipped).position).toEqual(actual)
    }
  })

  it('파랑 배치는 빨강 배치의 필드 자세를 Rz(π)로 돌린 것이다(HIVE 상태도 짝으로)', () => {
    const blue = mirrorElementPlacement(cellRed)
    for (const [red, other] of [
      [false, false],
      [true, false],
      [false, true]
    ] as const) {
      const a = mirrorVec3(placementFieldPosition(biobuzz, cellRed, [red, other]))
      const b = placementFieldPosition(biobuzz, blue, [other, red])
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-12)
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-12)
      expect(Math.abs(a.z - b.z)).toBeLessThan(1e-12)
    }
  })

  it('시즌에 없는 HIVE는 던진다', () => {
    expect(() => placementFieldPosition({ ...biobuzz, hives: [] }, cellRed, START)).toThrow()
  })
})

describe('부품·배치 거울(symmetry.ts)', () => {
  it('부품은 중심 부호 반전·회전 Rz(π)·크기 그대로, 쓰임·이름·순서 그대로', () => {
    const prism = BOTTOM_PLATE
    const m = mirrorPart(prism)
    if (m.shape.kind !== 'prism' || prism.shape.kind !== 'prism') throw new Error('prism')
    expect(m.shape.center).toEqual(mirrorVec3(prism.shape.center))
    expect(m.shape.rotation).toEqual({ x: 0, y: 0, z: wrapPi(Math.PI) })
    expect(m.shape.polygon).toEqual(prism.shape.polygon)
    expect(m.shape.height).toBe(prism.shape.height)
    expect([m.robots, m.balls, m.key]).toEqual([true, false, 'flowerRingBottom'])
    expect(mirrorPart(PIPES[0])).toMatchObject({ robots: true, balls: true, key: 'flowerPipe' })

    const flower = mirrorStructure(withParts(FLOWER, [...PIPES, BOTTOM_PLATE]))
    expect(flower.parts).toHaveLength(5)
    expect(flower.parts!.map((p) => p.shape.kind)).toEqual([
      'cylinder',
      'cylinder',
      'cylinder',
      'cylinder',
      'prism'
    ])
    // 부품이 없으면 키도 없다(6a 이전 모양)
    expect(Object.hasOwn(mirrorStructure(biobuzz.structures[0]), 'parts')).toBe(false)
  })

  it('HIVE는 동역학 값을 그대로, 부품은 거울, 없으면 키가 없다', () => {
    const red: FieldHive = {
      ...biobuzz.hives[0],
      dynamics: { massMoment: 0.09, inertia: 0.35, pivotFriction: 0.005 },
      parts: [{ ...PIPES[0], robots: false, key: 'hivePivot' }]
    }
    const blue = mirrorHive(red)
    expect(blue.key).toBe('hiveBlue')
    expect(blue.dynamics).toEqual(red.dynamics)
    expect(blue.dynamics).not.toBe(red.dynamics)
    expect(blue.parts![0].shape.center).toEqual(mirrorVec3(red.parts![0].shape.center))
    const plain = mirrorHive(biobuzz.hives[0])
    expect(Object.hasOwn(plain, 'dynamics') || Object.hasOwn(plain, 'parts')).toBe(false)
  })

  it('배치는 carrier를 상대 HIVE로 바꾸고 when을 지킨다. 필드 배치에는 키를 더하지 않는다', () => {
    const cell: FieldElementPlacement = {
      group: 'hiveCell',
      kind: 'nectarRed',
      position: { x: 0.4, y: 0, z: 0.05 },
      carrier: 'hiveRed',
      when: 'tipped'
    }
    expect(mirrorElementPlacement(cell)).toEqual({
      group: 'hiveCell',
      kind: 'nectarBlue',
      position: { x: -0.4, y: 0, z: 0.05 },
      carrier: 'hiveBlue',
      when: 'tipped'
    })
    const garden = mirrorElementPlacement(biobuzz.elements!.layout[0])
    expect(Object.keys(garden)).toEqual(['group', 'kind', 'position'])
  })
})

describe('checkFieldSpec: 부품(6b)', () => {
  it('봉투 안의 상자·볼록 기둥·원기둥 부품과 거울 짝은 통과한다', () => {
    const box: FieldPart = {
      shape: {
        kind: 'box',
        center: { x: AXIS.x, y: AXIS.y, z: 0.12 },
        rotation: { x: 0, y: 0, z: Math.PI / 8 },
        size: { x: 0.08, y: 0.08, z: 0.03 }
      },
      robots: false,
      balls: true,
      key: 'flowerRingMiddle'
    }
    expect(checkFieldSpec(flowerSpec([...PIPES, BOTTOM_PLATE, box]))).toEqual([])
  })

  it('크기·볼록 반시계·세운 원기둥·쓰임을 본다', () => {
    const at = `structures[${FLOWER}].parts[0]`
    const flat: FieldPart = {
      ...BOTTOM_PLATE,
      shape: { ...BOTTOM_PLATE.shape, height: 0 } as FieldPart['shape']
    }
    expect(partErrors(flowerSpec([flat]))).toContain(`${at}: size`)
    if (BOTTOM_PLATE.shape.kind !== 'prism') throw new Error('prism')
    const clockwise: FieldPart = {
      ...BOTTOM_PLATE,
      shape: { ...BOTTOM_PLATE.shape, polygon: [...BOTTOM_PLATE.shape.polygon].reverse() }
    }
    expect(partErrors(flowerSpec([clockwise]))).toContain(`${at}: polygon not convex CCW`)
    const line: FieldPart = {
      ...BOTTOM_PLATE,
      shape: {
        ...BOTTOM_PLATE.shape,
        polygon: [
          { x: 0, y: 0 },
          { x: 0.01, y: 0 },
          { x: 0.02, y: 0 }
        ]
      }
    }
    expect(partErrors(flowerSpec([line]))).toContain(`${at}: polygon not convex CCW`)
    const tilted: FieldPart = {
      ...PIPES[0],
      shape: { ...PIPES[0].shape, rotation: { x: 0.1, y: 0, z: 0 } }
    }
    expect(partErrors(flowerSpec([tilted]))).toContain(`${at}: tilted cylinder`)
    expect(partErrors(flowerSpec([{ ...PIPES[0], robots: false, balls: false }]))).toContain(
      `${at}: unused`
    )
  })

  it('봉투 밖(1 mm 넘게)은 오류이고 1 mm 안은 받는다', () => {
    const at = `structures[${FLOWER}].parts[0]`
    // 관 +u 바깥 끝은 봉투 +x 면 안쪽 4.0 mm(부록 A.2)
    const shifted = (dx: number): FieldPart => ({
      ...PIPES[0],
      shape: {
        ...PIPES[0].shape,
        center: { ...PIPES[0].shape.center, x: PIPES[0].shape.center.x + dx }
      }
    })
    expect(partErrors(flowerSpec([shifted(0.0045)]))).toEqual([])
    expect(partErrors(flowerSpec([shifted(0.0055)]))).toContain(`${at}: outside envelope`)
    // 예외 목록(Field Wall Bracket)의 이름만 봉투 밖으로 나가도 된다
    expect(partErrors(flowerSpec([{ ...shifted(0.05), key: 'flowerWallBracket' }]))).toEqual([])
  })

  it('봉투 예외 목록은 아는 이름(Field Wall Bracket)만이다', () => {
    expect([...PART_ENVELOPE_EXCEPTIONS]).toEqual(['flowerWallBracket'])
    expect([...PART_ENVELOPE_EXCEPTIONS].every(isFieldPartKey)).toBe(true)
    expect([CELL_FLOOR_PART_KEY, CELL_BACK_SKIN_PART_KEY].every(isFieldPartKey)).toBe(true)
  })

  it('부품 이름: 계약 낱말(유일)이고 앞 낱말이 주인(FLOWER·HIVE CELL·HIVE 몸체)이다', () => {
    expect(new Set(FIELD_PART_KEYS).size).toBe(FIELD_PART_KEYS.length)
    expect(FIELD_PART_KEYS.map(fieldPartOwner)).toEqual(
      FIELD_PART_KEYS.map((key) =>
        key.startsWith('flower') ? 'flower' : key.startsWith('cell') ? 'hiveCell' : 'hive'
      )
    )
    expect(isFieldPartKey('pipe')).toBe(false)
    const at = `structures[${FLOWER}].parts[0]`
    const unknown = { ...PIPES[0], key: 'pipe' } as unknown as FieldPart
    expect(partErrors(flowerSpec([unknown]))).toContain(`${at}: unknown key pipe`)
    expect(partErrors(flowerSpec([{ ...PIPES[0], key: 'cellRib' }]))).toContain(
      `${at}: key cellRib not for flower`
    )
  })

  // 6b 계약 리뷰: 봉투 안은 carrier field 구조물만 본다. HIVE carrier CELL 상자는 표시만이고 트레이(부록 A.1)가 넘는다
  it('HIVE carrier CELL의 트레이 부품은 봉투(표시 상자) 밖이어도 된다', () => {
    // Cell Base Tube(부록 A.1): x_b [0.119532, 0.544982], |y_b| ≤ 0.0127, z_b [−0.068885, −0.043485]
    const baseTube: FieldPart = {
      shape: {
        kind: 'box',
        center: { x: 0.332257, y: 0, z: -0.056185 },
        rotation: zero,
        size: { x: 0.42545, y: 0.0254, z: 0.0254 }
      },
      robots: false,
      balls: true,
      key: 'cellBaseTube'
    }
    const spec: FieldSpec = {
      ...biobuzz,
      structures: biobuzz.structures.map((s, i) => {
        if (i === CELL) return withParts(CELL, [baseTube])
        if (i === CELL_MIRROR) return mirrorStructure(withParts(CELL, [baseTube]))
        return s
      })
    }
    expect(checkFieldSpec(spec)).toEqual([])
    // 부품은 실제로 그 상자 밖이다(carrier field 구조물이었으면 outside envelope)
    expect(partInsideShape(baseTube.shape, biobuzz.structures[CELL].shape, 1e-3)).toBe(false)
  })

  it('유한하지 않은 크기는 크기 오류, NaN이 든 부품은 봉투 안이 아니다', () => {
    const at = `structures[${FLOWER}].parts[0]`
    const huge: FieldPart = {
      ...PIPES[0],
      shape: { ...PIPES[0].shape, radius: Infinity } as FieldPart['shape']
    }
    expect(partErrors(flowerSpec([huge]))).toContain(`${at}: size`)
    const envelope = biobuzz.structures[FLOWER].shape
    const lost = (center: { x: number; y: number; z: number }): FieldPart['shape'] => ({
      ...PIPES[0].shape,
      center
    })
    expect(partInsideShape(PIPES[0].shape, envelope, 1e-3)).toBe(true)
    expect(partInsideShape(lost({ ...PIPES[0].shape.center, x: NaN }), envelope, 1e-3)).toBe(false)
    if (BOTTOM_PLATE.shape.kind !== 'prism') throw new Error('prism')
    const nanPrism = {
      ...BOTTOM_PLATE.shape,
      polygon: [...BOTTOM_PLATE.shape.polygon.slice(1), { x: NaN, y: 0 }]
    }
    expect(partInsideShape(BOTTOM_PLATE.shape, envelope, 1e-3)).toBe(true)
    expect(partInsideShape(nanPrism, envelope, 1e-3)).toBe(false)
  })

  it('짝의 부품이 다르면 둘 다 짝을 잃는다', () => {
    const other = PIPES.map(mirrorPart)
    other[1] = { ...other[1], shape: { ...other[1].shape, radius: 0.014 } as FieldPart['shape'] }
    const errors = checkFieldSpec(flowerSpec(PIPES, other))
    expect(errors).toContain(`structures[${FLOWER}]: no Rz(pi) counterpart`)
    expect(errors).toContain(`structures[${FLOWER_MIRROR}]: no Rz(pi) counterpart`)
    // 한쪽만 부품이 있어도 짝이 아니다
    const one = {
      ...biobuzz,
      structures: biobuzz.structures.map((s, i) => (i === FLOWER ? withParts(FLOWER, PIPES) : s))
    }
    expect(checkFieldSpec(one)).toContain(`structures[${FLOWER}]: no Rz(pi) counterpart`)
  })

  it('HIVE: 동역학은 양수(축 마찰은 0 이상), 몸체 틀 부품은 로봇이 쓰지 않는다, 짝은 같은 동역학', () => {
    const dynamics = { massMoment: 0.09, inertia: 0.35, pivotFriction: 0.005 }
    const pivot: FieldPart = {
      shape: { kind: 'box', center: zero, rotation: zero, size: { x: 0.35, y: 0.038, z: 0.09 } },
      robots: false,
      balls: true,
      key: 'hivePivot'
    }
    const hives = (red: FieldHive): FieldSpec => ({ ...biobuzz, hives: [red, mirrorHive(red)] })
    const red = { ...biobuzz.hives[0], dynamics, parts: [pivot] }
    expect(checkFieldSpec(hives(red))).toEqual([])
    expect(checkFieldSpec(hives({ ...red, dynamics: { ...dynamics, pivotFriction: 0 } }))).toEqual(
      []
    )
    expect(checkFieldSpec(hives({ ...red, dynamics: { ...dynamics, massMoment: 0 } }))).toContain(
      'hives[0]: dynamics'
    )
    expect(checkFieldSpec(hives({ ...red, dynamics: { ...dynamics, inertia: -1 } }))).toContain(
      'hives[1]: dynamics'
    )
    // 유한하지 않은 값(checkNumbers도 따로 알린다)
    for (const bad of [
      { massMoment: Infinity },
      { inertia: Number.NaN },
      { pivotFriction: Infinity }
    ])
      expect(checkFieldSpec(hives({ ...red, dynamics: { ...dynamics, ...bad } }))).toContain(
        'hives[0]: dynamics'
      )
    expect(checkFieldSpec(hives({ ...red, parts: [{ ...pivot, key: 'flowerPipe' }] }))).toContain(
      'hives[0].parts[0]: key flowerPipe not for hive'
    )
    expect(checkFieldSpec(hives({ ...red, parts: [{ ...pivot, robots: true }] }))).toContain(
      'hives[0].parts[0]: robots on carrier hiveRed'
    )
    // 짝의 동역학이 다르면 짝이 아니다
    const blue = { ...mirrorHive(red), dynamics: { ...dynamics, inertia: 0.4 } }
    expect(checkFieldSpec({ ...biobuzz, hives: [red, blue] })).toContain(
      'hives[0]: no Rz(pi) counterpart'
    )
  })
})

describe('checkFieldSpec: 묶음별 배치(6b)', () => {
  // FLOWER 9 축에 쌓은 POLLEN 넷(바닥부터 서로 닿음)과 그 거울
  const column = (z0 = POLLEN_R, step = 2 * POLLEN_R): FieldElementPlacement[] =>
    [0, 1, 2, 3].map((k) => ({
      group: 'flower',
      kind: 'pollen',
      position: { x: AXIS.x, y: AXIS.y, z: z0 + k * step }
    }))
  const flowerLayout = (balls: FieldElementPlacement[]): FieldSpec => {
    const spec = flowerSpec(PIPES)
    const layout = [...biobuzz.elements!.layout, ...balls, ...balls.map(mirrorElementPlacement)]
    return { ...spec, elements: { ...biobuzz.elements!, layout } }
  }
  const at = (k: number): string => `elements.layout[${8 + k}]`

  it('flower: 봉투 안, 공 부품과 겹치지 않고, 바닥부터 서로 닿게 쌓이면 통과', () => {
    expect(checkFieldSpec(flowerLayout(column()))).toEqual([])
  })

  it('flower: 바닥에서 뜬 맨 아래 공, 아래 공에 닿지 않는 공, FLOWER 밖, 관과 겹침', () => {
    expect(checkFieldSpec(flowerLayout(column(POLLEN_R + 0.001)))).toContain(
      `${at(0)}: not resting on floor`
    )
    const gap = column()
    gap[3] = { ...gap[3], position: { ...gap[3].position, z: gap[3].position.z + 0.001 } }
    expect(checkFieldSpec(flowerLayout(gap))).toContain(`${at(3)}: not touching the ball below`)
    const outside = column()
    outside[0] = { ...outside[0], position: { x: 0, y: -1, z: POLLEN_R } }
    expect(checkFieldSpec(flowerLayout(outside))).toContain(`${at(0)}: not inside a FLOWER`)
    // 관 쪽으로 2 cm: 관(반지름 13.3 mm, 축에서 62 mm)과 겹친다
    const near = column().map((p) => ({
      ...p,
      position: { ...p.position, x: p.position.x + 0.02, y: p.position.y + 0.02 }
    }))
    expect(checkFieldSpec(flowerLayout(near)).some((e) => e.includes('.parts['))).toBe(true)
  })

  it('carrier·when은 hiveCell만 쓴다', () => {
    const balls = column()
    balls[0] = { ...balls[0], carrier: 'hiveRed', when: 'start' }
    expect(checkFieldSpec(flowerLayout(balls))).toContain(`${at(0)}: carrier`)
  })

  // CELL 14(빨강 +X)에 밑판·Back Skin(공 전용 얇은 판, 부록 A.1)과 그 거울 16. NECTAR 셋이 밑판과 Back Skin에 닿고 한 줄
  const floor: FieldPart = {
    shape: {
      kind: 'box',
      center: { x: 0.392175, y: 0, z: -0.037541 },
      rotation: zero,
      size: { x: 0.30581, y: 0.512, z: 0.000508 }
    },
    robots: false,
    balls: true,
    key: CELL_FLOOR_PART_KEY
  }
  const backSkin: FieldPart = {
    shape: {
      kind: 'box',
      center: { x: 0.239519, y: 0, z: 0.131 },
      rotation: zero,
      size: { x: 0.000508, y: 0.512, z: 0.336 }
    },
    robots: false,
    balls: true,
    key: CELL_BACK_SKIN_PART_KEY
  }
  const nectar = (y: number, dx = 0): FieldElementPlacement => ({
    group: 'hiveCell',
    kind: 'nectarRed',
    position: { x: 0.239773 + NECTAR_R + dx, y, z: -0.037287 + NECTAR_R },
    carrier: 'hiveRed',
    when: 'start'
  })
  const cellLayout = (balls: FieldElementPlacement[]): FieldSpec => {
    const structures = biobuzz.structures.map((s, i) => {
      if (i === CELL) return withParts(CELL, [floor, backSkin])
      if (i === CELL_MIRROR) return mirrorStructure(withParts(CELL, [floor, backSkin]))
      return s
    })
    const layout = [...biobuzz.elements!.layout, ...balls, ...balls.map(mirrorElementPlacement)]
    return { ...biobuzz, structures, elements: { ...biobuzz.elements!, layout } }
  }
  const row = (): FieldElementPlacement[] => [-1, 0, 1].map((k) => nectar(k * 2 * NECTAR_R))

  it('hiveCell: 몸체 틀에서 밑판·Back Skin에 닿고 겹치지 않으면 통과(틀이 같은 공끼리만 겹침을 본다)', () => {
    expect(checkFieldSpec(cellLayout(row()))).toEqual([])
    // 넘어간 상태의 공은 같은 자리여도 시작 상태 공과 틀이 달라 겹침이 아니다
    const both = [...row(), ...row().map((p) => ({ ...p, when: 'tipped' as const }))]
    expect(checkFieldSpec(cellLayout(both))).toEqual([])
  })

  it('hiveCell: Back Skin에서 떨어짐, 밑판에 파고듦, carrier·when 없음, 아는 HIVE 아님', () => {
    const off = row()
    off[0] = nectar(-2 * NECTAR_R, 0.001)
    expect(checkFieldSpec(cellLayout(off))).toContain(`${at(0)}: not against a CELL Back Skin`)
    const sunk = row()
    sunk[1] = { ...sunk[1], position: { ...sunk[1].position, z: sunk[1].position.z - 0.001 } }
    const errors = checkFieldSpec(cellLayout(sunk))
    expect(errors).toContain(`${at(1)}: structures[${CELL}].parts[0]`)
    expect(errors).toContain(`${at(1)}: not resting on a CELL floor`)
    const loose = row()
    loose[2] = { ...loose[2], when: undefined }
    expect(checkFieldSpec(cellLayout(loose))).toContain(`${at(2)}: hiveCell needs carrier and when`)
    expect(
      checkFieldSpec({ ...cellLayout(row()), hives: [biobuzz.hives[1]] }).some((e) =>
        e.endsWith('unknown carrier hiveRed')
      )
    ).toBe(true)
  })

  it('hiveCell 짝은 상대 HIVE·같은 when이어야 한다', () => {
    const spec = cellLayout(row())
    const layout = spec.elements!.layout.map((p) =>
      p.carrier === 'hiveBlue' ? { ...p, when: 'tipped' as const } : p
    )
    expect(checkFieldSpec({ ...spec, elements: { ...spec.elements!, layout } })).toContain(
      `${at(0)}: no Rz(pi) counterpart`
    )
  })
})

describe('spherePartSeparation: 볼록 기둥(정확)', () => {
  const prism: FieldPart['shape'] = {
    kind: 'prism',
    center: { x: 1, y: 2, z: 0.5 },
    rotation: { x: 0, y: 0, z: Math.PI / 2 },
    polygon: [
      { x: -0.1, y: -0.2 },
      { x: 0.1, y: -0.2 },
      { x: 0.1, y: 0.2 },
      { x: -0.1, y: 0.2 }
    ],
    height: 0.4
  }
  it('면 밖·모서리 밖·안(가장 가까운 면까지 음수)', () => {
    // 자기 틀이 z로 90° 돌아 자기 x(±0.1)는 필드 y, 자기 y(±0.2)는 필드 −x
    expect(spherePartSeparation({ x: 1, y: 2.3, z: 0.5 }, 0.05, prism)).toBeCloseTo(0.15, 12)
    expect(spherePartSeparation({ x: 1.5, y: 2, z: 0.5 }, 0, prism)).toBeCloseTo(0.3, 12)
    expect(spherePartSeparation({ x: 1, y: 2.4, z: 0.9 }, 0, prism)).toBeCloseTo(
      Math.hypot(0.3, 0.2),
      12
    )
    expect(spherePartSeparation({ x: 1, y: 2, z: 0.5 }, 0.01, prism)).toBeCloseTo(-0.11, 12)
    expect(spherePartSeparation({ x: 1, y: 2, z: 0.65 }, 0, prism)).toBeCloseTo(-0.05, 12)
  })
})
