import { describe, expect, it } from 'vitest'
import { elementSpawns, restBodyFrames } from '../elements/spawn'
import { parseWorldSpec, type Vec2, type Vec3 } from '../worldSpec'
import { ballWorldSpec } from '../elements/elementTestkit'
import {
  isConvexCcwPolygon,
  partInsideShape,
  partVertices,
  spherePartSeparation
} from './fieldGeometry'
import {
  checkFieldSpec,
  PART_ENVELOPE_TOLERANCE,
  placementActive,
  placementFieldPosition,
  type FieldPart,
  type FieldPartShape,
  type FieldSpec
} from './fieldSpec'
import { RING_SECTORS, rotateQuarter, sectorDirection } from './partShapes'
import { resolveSeason } from './seasons'
import { mirrorElementPlacement, mirrorPart, mirrorStructure, mirrorVec3 } from './symmetry'

// 6b BIOBUZZ 시즌 데이터(spec-6b §1.3·§5·부록 A): FLOWER 케이지 부품(공·로봇 조각), CELL 트레이, HIVE 축 조립체·동역학, flower·
// hiveCell 배치. 값은 공식 필드 CAD에서 쟀다(docs/research/6b/cad-scripts/flower.py·cell.py·inertia.py, cad-geometry-notes.txt).

const BIOBUZZ = resolveSeason('biobuzz')
const POLLEN_R = 0.03555
const NECTAR_R = 0.0457
const FLOWERS = [9, 10, 11, 12]
const AXIS_9: Vec2 = { x: -1.728254, y: -0.59418 }
const AXIS_11: Vec2 = { x: 0.59418, y: -1.728254 }
const CELL_PLUS_X = 14
const CELL_MINUS_X = 13

const keyCount = (parts: readonly FieldPart[], use: 'robots' | 'balls'): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const p of parts) if (p[use]) out[p.key] = (out[p.key] ?? 0) + 1
  return out
}

describe('FLOWER 케이지 부품', () => {
  const parts9 = BIOBUZZ.structures[9].parts!

  it('부품 수와 쓰임: 로봇 조각 15(고리 판 셋, 압출재 둘, 관 넷, 브래킷, 받침 둘, 백스톱 셋), 공 조각 66', () => {
    expect(parts9).toHaveLength(70)
    expect(keyCount(parts9, 'robots')).toEqual({
      flowerRingBottom: 1,
      flowerUpright: 2,
      flowerRingMiddle: 1,
      flowerPipe: 4,
      flowerWallBracket: 1,
      flowerRingTop: 1,
      flowerSpacer: 2,
      flowerBackstop: 3
    })
    expect(keyCount(parts9, 'balls')).toEqual({
      flowerRingBottom: RING_SECTORS,
      flowerUpright: 2,
      flowerRingMiddle: RING_SECTORS,
      flowerLip: 3,
      flowerPipe: 4,
      flowerWallBracket: 4,
      flowerRingTop: RING_SECTORS,
      flowerSpacer: 2,
      flowerBackstop: 3
    })
    // 고리는 로봇 판 하나(구멍 없음)와 공 조각이 따로다(같은 이름, 쓰임이 갈림)
    for (const key of ['flowerRingBottom', 'flowerRingMiddle', 'flowerRingTop'] as const) {
      const ring = parts9.filter((p) => p.key === key)
      expect(ring.filter((p) => p.robots && p.balls)).toEqual([])
    }
    for (const index of FLOWERS) expect(BIOBUZZ.structures[index].parts).toHaveLength(70)
  })

  it('봉투(FLOWER 상자) 안: Field Wall Bracket만 벽 레일 위·±v로 넘고, 가운데 고리 벽 쪽 탭은 벽 면에서 잘렸다', () => {
    for (const index of FLOWERS) {
      const s = BIOBUZZ.structures[index]
      s.parts!.forEach((part) => {
        const inside = partInsideShape(part.shape, s.shape, PART_ENVELOPE_TOLERANCE)
        if (part.key === 'flowerWallBracket') {
          // 로봇 조각(껍질 전체)은 봉투 밖으로 나간다
          if (part.robots) expect(inside).toBe(false)
        } else expect(inside).toBe(true)
      })
    }
    // 가운데 고리 로봇 판의 가장 벽 쪽 꼭짓점 = 벽 안쪽 면(−1.79286, 봉투 −X 면)
    const middle = parts9.find((p) => p.key === 'flowerRingMiddle' && p.robots)!
    const xs = partVertices(middle.shape)!.map((v) => v.x)
    expect(Math.min(...xs)).toBeCloseTo(-BIOBUZZ.perimeter.innerHalf, 5)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-BIOBUZZ.perimeter.innerHalf - 1e-6)
  })

  it('볼록 기둥은 모두 볼록 반시계, 원기둥은 세움, 회전 없음(FLOWER 9·11) 또는 Rz(π)(10·12)', () => {
    for (const index of FLOWERS)
      for (const part of BIOBUZZ.structures[index].parts!) {
        const shape = part.shape
        if (shape.kind === 'prism') expect(isConvexCcwPolygon(shape.polygon)).toBe(true)
        expect(shape.rotation.x).toBe(0)
        expect(shape.rotation.y).toBe(0)
        expect([0, Math.PI]).toContain(shape.rotation.z)
      }
  })

  it('고리 조각 각은 k·22.5°(제곱근 식, Math.cos·sin과 1e-16), 조각의 안쪽 현 꼭짓점은 구멍 원 위 r·d_k·r·d_(k+1)', () => {
    for (let k = 0; k < RING_SECTORS; k++) {
      const d = sectorDirection(k)
      // Math.cos(k·π/8)도 π의 반올림만큼 틀린다(k·π/8이 정확하지 않다)
      expect(Math.abs(d.x - Math.cos((k * Math.PI) / 8))).toBeLessThan(1e-15)
      expect(Math.abs(d.y - Math.sin((k * Math.PI) / 8))).toBeLessThan(1e-15)
      expect(Math.abs(Math.hypot(d.x, d.y) - 1)).toBeLessThan(3e-16)
      expect(Object.is(d.x, -0) || Object.is(d.y, -0)).toBe(false)
    }
    // FLOWER 9 자기 틀(축 기준)의 공 조각: 고리마다 16개, 조각 k는 두 현 꼭짓점을 갖고 나머지 꼭짓점은 현보다 바깥
    for (const [key, hole] of [
      ['flowerRingBottom', 0.0387],
      ['flowerRingMiddle', 0.0489],
      ['flowerRingTop', 0.0507]
    ] as const) {
      const sectors = parts9.filter((p) => p.key === key && p.balls)
      expect(sectors).toHaveLength(RING_SECTORS)
      sectors.forEach((part, k) => {
        if (part.shape.kind !== 'prism') throw new Error('prism')
        const polygon = part.shape.polygon
        for (const d of [sectorDirection(k), sectorDirection(k + 1)])
          expect(polygon.some((p) => Math.hypot(p.x - hole * d.x, p.y - hole * d.y) < 1e-12)).toBe(
            true
          )
        const chord = hole * Math.cos(Math.PI / 16)
        for (const p of polygon) expect(Math.hypot(p.x, p.y)).toBeGreaterThan(chord - 1e-12)
      })
    }
  })

  it('짝: FLOWER 10 = mirrorStructure(9), 11 = 9의 정확한 90° 회전(삼각함수 없음), 12 = mirrorStructure(11)', () => {
    expect(BIOBUZZ.structures[10]).toEqual(mirrorStructure(BIOBUZZ.structures[9]))
    expect(BIOBUZZ.structures[12]).toEqual(mirrorStructure(BIOBUZZ.structures[11]))
    const turn = (p: Vec2): Vec2 => rotateQuarter(p)
    const parts11 = BIOBUZZ.structures[11].parts!
    parts9.forEach((p9, j) => {
      const p11 = parts11[j]
      expect([p11.key, p11.robots, p11.balls]).toEqual([p9.key, p9.robots, p9.balls])
      const a = p9.shape
      const b = p11.shape
      // 중심: 축 기준 자기 수를 돌린 것(비트로 같다)
      const o9 = { x: a.center.x - AXIS_9.x, y: a.center.y - AXIS_9.y }
      const o11 = { x: b.center.x - AXIS_11.x, y: b.center.y - AXIS_11.y }
      const t = turn(o9)
      expect(Math.abs(o11.x - t.x)).toBeLessThan(1e-15)
      expect(Math.abs(o11.y - t.y)).toBeLessThan(1e-15)
      expect(b.center.z).toBe(a.center.z)
      if (a.kind === 'prism' && b.kind === 'prism') expect(b.polygon).toEqual(a.polygon.map(turn))
      if (a.kind === 'box' && b.kind === 'box')
        expect(b.size).toEqual({ x: a.size.y, y: a.size.x, z: a.size.z })
      if (a.kind === 'cylinder' && b.kind === 'cylinder')
        expect([b.radius, b.height]).toEqual([a.radius, a.height])
    })
    expect(checkFieldSpec(BIOBUZZ)).toEqual([])
  })

  it('부록 A.2 수: 관·고리·턱·압출재·브래킷·백스톱 높이와 반지름', () => {
    const pipes = parts9.filter((p) => p.key === 'flowerPipe')
    expect(pipes.map((p) => p.shape)).toEqual(
      [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1]
      ].map(([su, sv]) => ({
        kind: 'cylinder',
        center: {
          x: AXIS_9.x + su * 0.043815,
          y: AXIS_9.y + sv * 0.043815,
          z: (0.108052 + 0.539852) / 2
        },
        rotation: { x: 0, y: 0, z: 0 },
        radius: 0.013343,
        height: 0.539852 - 0.108052
      }))
    )
    const range = (key: FieldPart['key']): [number, number] => {
      const shape = parts9.find((p) => p.key === key)!.shape as Extract<
        FieldPartShape,
        { kind: 'prism' }
      >
      return [shape.center.z - shape.height / 2, shape.center.z + shape.height / 2]
    }
    const close = (a: [number, number], b: [number, number]): void => {
      expect(a[0]).toBeCloseTo(b[0], 12)
      expect(a[1]).toBeCloseTo(b[1], 12)
    }
    close(range('flowerRingBottom'), [0, 0.008992])
    close(range('flowerRingMiddle'), [0.099162, 0.133452])
    close(range('flowerRingTop'), [0.514452, 0.543662])
    close(range('flowerLip'), [0.104267, 0.10795])
    close(range('flowerUpright'), [0.008992, 0.104242])
    close(range('flowerWallBracket'), [0.2905, 0.30066])
    // 관 사이 자유 반지름 0.048621 > POLLEN 반지름이고, 관 사이 틈은 POLLEN 지름보다 좁다(FAC 2.11)
    expect(Math.hypot(0.043815, 0.043815) - 0.013343).toBeCloseTo(0.048621, 5)
    expect(2 * (0.043815 - 0.013343)).toBeLessThan(2 * POLLEN_R)
  })

  it('NECTAR 턱: 가운데 NECTAR가 쉬는 높이는 실제 모따기 아래 모서리와 같은 0.119947, POLLEN은 축 위로 지나간다', () => {
    const lips = parts9.filter((p) => p.key === 'flowerLip')
    const nectarGap = (z: number): number =>
      Math.min(
        ...lips.map((p) => spherePartSeparation({ x: AXIS_9.x, y: AXIS_9.y, z }, NECTAR_R, p.shape))
      )
    // 쉬는 높이(분리 0)를 이분법으로
    let lo = 0.11
    let hi = 0.13
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2
      if (nectarGap(mid) < 0) lo = mid
      else hi = mid
    }
    expect(hi).toBeCloseTo(0.119947, 5)
    // 턱 셋 모두 닿는다(현의 가운데가 같은 반지름 r_eq)
    for (const lip of lips)
      expect(
        spherePartSeparation({ x: AXIS_9.x, y: AXIS_9.y, z: hi }, NECTAR_R, lip.shape)
      ).toBeLessThan(1e-6)
    // POLLEN은 축 위 어느 높이에서도 공 조각에 닿지 않는다(기둥이 바닥까지 내려간다)
    for (let z = POLLEN_R; z < 0.55; z += 0.002)
      for (const part of parts9)
        if (part.balls)
          expect(
            spherePartSeparation({ x: AXIS_9.x, y: AXIS_9.y, z }, POLLEN_R, part.shape)
          ).toBeGreaterThan(0)
  })
})

describe('CELL 트레이·HIVE', () => {
  const tray = BIOBUZZ.structures[CELL_PLUS_X].parts!

  it('부품: 밑판·옆벽 둘·지붕 둘·Back Skin·리브 열(입구 다섯, 뒤 다섯)·Base Tube·받침 둘, 공만, 봉투 검사 없음', () => {
    expect(tray.map((p) => p.key)).toEqual([
      'cellFloor',
      'cellWall',
      'cellWall',
      'cellRoof',
      'cellRoof',
      'cellBackSkin',
      ...Array(10).fill('cellRib'),
      'cellBaseTube',
      'cellStandoff',
      'cellStandoff'
    ])
    expect(tray.every((p) => p.balls && !p.robots)).toBe(true)
    // −X CELL은 같은 HIVE 몸체 틀의 (x, y) → (−x, −y) 상
    expect(BIOBUZZ.structures[CELL_MINUS_X].parts).toEqual(tray.map(mirrorPart))
    // 파랑 CELL은 거울(구조물 15·16)
    expect(BIOBUZZ.structures[15]).toEqual(mirrorStructure(BIOBUZZ.structures[13]))
    expect(BIOBUZZ.structures[16]).toEqual(mirrorStructure(BIOBUZZ.structures[14]))
    for (const part of tray)
      if (part.shape.kind === 'prism') expect(isConvexCcwPolygon(part.shape.polygon)).toBe(true)
  })

  it('안쪽 면(부록 A.1): 밑판 윗면 z −0.037287, Back Skin x 0.239725, 옆벽 |y| 0.256007, 지붕 z = 0.327137 − 0.6389·|y|, 입구는 열려 있다', () => {
    const extent = (part: FieldPart, axis: 'x' | 'y' | 'z'): [number, number] => {
      const vs = partVertices(part.shape)!
      return [Math.min(...vs.map((v) => v[axis])), Math.max(...vs.map((v) => v[axis]))]
    }
    expect(extent(tray[0], 'z')[1]).toBeCloseTo(-0.037287, 12)
    expect(extent(tray[5], 'x')[1]).toBeCloseTo(0.239725, 12)
    expect(extent(tray[1], 'y')[0]).toBeCloseTo(0.256007, 12)
    expect(extent(tray[2], 'y')[1]).toBeCloseTo(-0.256007, 12)
    // 지붕 안쪽 면: 안쪽 꼭짓점 둘(꼭대기, 옆벽 이음)
    const roof = partVertices(tray[3].shape)!
    expect(roof.some((v) => Math.abs(v.y) < 1e-12 && Math.abs(v.z - 0.327137) < 1e-12)).toBe(true)
    expect(
      roof.some((v) => Math.abs(v.y - 0.256007) < 1e-12 && Math.abs(v.z - 0.163576) < 1e-12)
    ).toBe(true)
    // 오각형 안 입구 바깥(x 0.6)과 입구 안쪽(x 0.5)의 공: 입구 바깥은 어느 부품에도 닿지 않는다(열린 끝)
    const free = (x: number): number =>
      Math.min(...tray.map((p) => spherePartSeparation({ x, y: 0, z: 0.1 }, POLLEN_R, p.shape)))
    expect(free(0.6)).toBeGreaterThan(0.01)
    expect(free(0.4)).toBeGreaterThan(0)
  })

  it('HIVE 동역학·축 조립체: massMoment 0.09(보정 창 가운데), 관성 0.386(inertia.py), 축 마찰 0.005, 파랑은 같은 값', () => {
    const [red, blue] = BIOBUZZ.hives
    expect(red.dynamics).toEqual({ massMoment: 0.09, inertia: 0.386, pivotFriction: 0.005 })
    expect(blue.dynamics).toEqual(red.dynamics)
    // 보정 창(부록 B) 가운데 0.044999 kg·m를 30° 멈춤에서 받친다
    expect(red.dynamics!.massMoment * Math.sin(Math.PI / 6)).toBeCloseTo(0.045, 4)
    // 축 마찰은 보정 창 반폭(0.00298 kg·m × g = 0.0292 N·m)보다 작다
    expect(red.dynamics!.pivotFriction).toBeLessThan(0.0292)
    expect(red.parts).toEqual([
      {
        shape: {
          kind: 'box',
          center: { x: 0, y: 0, z: -0.02335 },
          rotation: { x: 0, y: 0, z: 0 },
          size: { x: 0.35, y: 0.0382, z: 0.0911 }
        },
        robots: false,
        balls: true,
        key: 'hivePivot'
      }
    ])
    expect(blue.parts).toEqual(red.parts!.map(mirrorPart))
  })
})

describe('배치(flower·hiveCell)', () => {
  const layout = BIOBUZZ.elements!.layout

  it('순서: GARDEN 8(공 번호 0–7 그대로) → FLOWER 9·10·11·12 × 4(아래부터) → hiveCell 빨강 시작·넘어감·파랑 시작·넘어감 × 3', () => {
    expect(layout.map((p) => p.group)).toEqual([
      ...Array(8).fill('garden'),
      ...Array(16).fill('flower'),
      ...Array(12).fill('hiveCell')
    ])
    const flower = layout.slice(8, 24)
    const axes = [
      AXIS_9,
      mirrorVec3({ ...AXIS_9, z: 0 }),
      AXIS_11,
      mirrorVec3({ ...AXIS_11, z: 0 })
    ]
    flower.forEach((p, i) => {
      const axis = axes[Math.floor(i / 4)]
      const k = i % 4
      expect(p.kind).toBe('pollen')
      expect(p.position).toEqual({ x: axis.x, y: axis.y, z: POLLEN_R * (1 + 2 * k) })
    })
    const cells = layout.slice(24)
    expect(cells.map((p) => [p.kind, p.carrier, p.when])).toEqual([
      ...Array(3).fill(['nectarRed', 'hiveRed', 'start']),
      ...Array(3).fill(['nectarRed', 'hiveRed', 'tipped']),
      ...Array(3).fill(['nectarBlue', 'hiveBlue', 'start']),
      ...Array(3).fill(['nectarBlue', 'hiveBlue', 'tipped'])
    ])
    // 빨강 시작: +X CELL, Back Skin·밑판에 닿고 빨강 벽(−y_b) 쪽 옆벽부터 한 줄
    cells.slice(0, 3).forEach((p, k) =>
      expect(p.position).toEqual({
        x: 0.239725 + NECTAR_R,
        y: -0.256007 + NECTAR_R * (1 + 2 * k),
        z: -0.037287 + NECTAR_R
      })
    )
    // 넘어간 시작: −X CELL의 (x, y) → (−x, y)(두 시작 상태 모두 빨강 벽 −y_b 쪽 옆벽, CM 10.3.1), 파랑: mirrorElementPlacement
    cells.slice(3, 6).forEach((p, k) => {
      const s = cells[k].position
      expect(p.position).toEqual({ x: -s.x, y: s.y, z: s.z })
      expect(p.position.y).toBeLessThan(0)
    })
    cells.slice(6).forEach((p, k) => expect(p).toEqual(mirrorElementPlacement(cells[k])))
    // 필드 좌표로: 빨강 NECTAR는 두 시작 상태 모두 빨강 벽(−Y) 쪽, 파랑은 파랑 벽(+Y) 쪽 옆벽에 붙는다(6b 리뷰)
    const red = BIOBUZZ.hives[0].pivot.y
    const blue = BIOBUZZ.hives[1].pivot.y
    for (const [i, hiveTipped] of [
      [3, [true, false]],
      [0, [false, false]]
    ] as const)
      for (const p of cells.slice(i, i + 3))
        expect(placementFieldPosition(BIOBUZZ, p, [...hiveTipped]).y).toBeLessThan(red)
    for (const [i, hiveTipped] of [
      [9, [false, true]],
      [6, [false, false]]
    ] as const)
      for (const p of cells.slice(i, i + 3))
        expect(placementFieldPosition(BIOBUZZ, p, [...hiveTipped]).y).toBeGreaterThan(blue)
  })

  it('hiveCell NECTAR는 CELL 밑판·Back Skin에 닿고 트레이에 파고들지 않는다(몸체 틀, ±1e-9)', () => {
    const red = layout.filter((p) => p.carrier === 'hiveRed')
    const parts = [
      ...BIOBUZZ.structures[CELL_MINUS_X].parts!,
      ...BIOBUZZ.structures[CELL_PLUS_X].parts!,
      ...BIOBUZZ.hives[0].parts!
    ]
    for (const p of red) {
      const gaps = parts.map((part) => spherePartSeparation(p.position, NECTAR_R, part.shape))
      expect(Math.min(...gaps)).toBeGreaterThan(-1e-9)
      const touching = parts.filter((_, i) => Math.abs(gaps[i]) <= 1e-9).map((part) => part.key)
      expect(touching).toContain('cellFloor')
      expect(touching).toContain('cellBackSkin')
    }
  })

  it('HIVE 시작 상태마다 생기는 공: GARDEN 8 + FLOWER 16 + 위 CELL마다 NECTAR 3, 필드 자리는 그 각, 세계 설명 검사와 같은 수', () => {
    for (const tipped of [
      [false, false],
      [true, false],
      [false, true],
      [true, true]
    ] as const) {
      const spawns = elementSpawns(
        BIOBUZZ,
        { groups: ['garden', 'flower', 'hiveCell'], preloads: [] },
        { x: 0, y: 0, yaw: 0 },
        restBodyFrames([]),
        tipped
      )
      const active = layout.filter((p) => placementActive(p, tipped))
      expect(spawns).toHaveLength(8 + 16 + 6)
      expect(active).toHaveLength(30)
      spawns.forEach((s, i) => {
        expect(s.position).toEqual(placementFieldPosition(BIOBUZZ, active[i], tipped))
        expect(s.asleep).toBe(true)
      })
      // CELL NECTAR는 위로 향한 CELL 안(피벗 1.116 m보다 높다)
      for (const s of spawns.slice(24)) expect(s.position.z).toBeGreaterThan(1.116)
      // 세계 설명: 묶음 셋과 프리로드 넷(34 ≤ 64)을 받는다
      const spec = ballWorldSpec({
        field: { season: 'biobuzz', hiveTipped: [tipped[0], tipped[1]] },
        elements: {
          groups: ['garden', 'flower', 'hiveCell'],
          preloads: [0, 1, 2, 3].map((k) => ({
            kind: 'pollen' as const,
            body: -1,
            position: { x: 0, y: 0.08 * k, z: 0.3 }
          }))
        }
      })
      expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(spec)))).toBe('object')
    }
  })

  it('일부러 깬 판: FLOWER 11 부품 하나를 1 mm 옮기면 FLOWER 11·12 둘 다 짝을 잃는다, 기둥 공을 1 mm 띄우면 알린다', () => {
    const broken = (change: (spec: FieldSpec) => FieldSpec): string[] =>
      checkFieldSpec(change(BIOBUZZ))
    const moved = broken((spec) => ({
      ...spec,
      structures: spec.structures.map((s, i) => {
        if (i !== 11) return s
        const parts = s.parts!.map((p, j) => {
          if (j !== 40) return p
          const c: Vec3 = { ...p.shape.center, x: p.shape.center.x + 1e-3 }
          return { ...p, shape: { ...p.shape, center: c } as FieldPartShape }
        })
        return { ...s, parts }
      })
    }))
    expect(moved).toContain('structures[11]: no Rz(pi) counterpart')
    expect(moved).toContain('structures[12]: no Rz(pi) counterpart')
    const lifted = broken((spec) => ({
      ...spec,
      elements: {
        ...spec.elements!,
        layout: spec.elements!.layout.map((p, i) =>
          i === 9 || i === 13 ? { ...p, position: { ...p.position, z: p.position.z + 1e-3 } } : p
        )
      }
    }))
    expect(lifted).toContain('elements.layout[9]: not touching the ball below')
  })
})
