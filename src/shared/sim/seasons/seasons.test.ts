import { describe, expect, it } from 'vitest'
import { WALL_HEIGHT, WALL_INNER_HALF } from '../field'
import type { Vec3 } from '../worldSpec'
import { BIOBUZZ_STRUCTURE_PAIRS } from './biobuzz'
import { boxVertices } from './fieldGeometry'
import { checkFieldSpec, type FieldSpec, type FieldStructure } from './fieldSpec'
import { DEFAULT_PROJECT_SEASON, isSeasonId, resolveSeason, SEASON_IDS } from './seasons'
import { mirrorPreset, mirrorStructure, mirrorTag, mirrorVec3, neg, wrapPi } from './symmetry'

// K1·K4(spec-4ab §5): 시즌 데이터 검사, 구조물 순서·짝·대칭, 'none' 값

const biobuzz = resolveSeason('biobuzz')

// 데이터에 −0이 있는 경로
function negativeZeros(value: unknown, path = ''): string[] {
  if (typeof value === 'number') return Object.is(value, -0) ? [path] : []
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([k, v]) => negativeZeros(v, `${path}.${k}`))
}

function sameVertexSet(a: Vec3[], b: Vec3[], tol: number): boolean {
  const near = (p: Vec3, set: Vec3[]): boolean =>
    set.some(
      (q) => Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol && Math.abs(p.z - q.z) <= tol
    )
  return a.every((p) => near(p, b)) && b.every((p) => near(p, a))
}

function boxOf(s: FieldStructure): Extract<FieldStructure['shape'], { kind: 'box' }> {
  if (s.shape.kind !== 'box') throw new Error('box')
  return s.shape
}

describe('시즌 고르기', () => {
  it('UI 순서·기본 시즌·같은 객체', () => {
    expect(SEASON_IDS).toEqual(['biobuzz', 'none'])
    expect(DEFAULT_PROJECT_SEASON).toBe('biobuzz')
    expect(isSeasonId('biobuzz')).toBe(true)
    expect(isSeasonId('decode2027')).toBe(false)
    expect(isSeasonId(1)).toBe(false)
    expect(resolveSeason('biobuzz')).toBe(biobuzz)
    expect(Object.isFrozen(biobuzz)).toBe(true)
    expect(Object.isFrozen(biobuzz.structures[0].shape)).toBe(true)
    // 시험이 바꾼 판은 얕은 복사로
    const copy: FieldSpec = { ...biobuzz, structures: [] }
    expect(copy.structures).toEqual([])
    expect(biobuzz.structures).toHaveLength(17)
  })
})

describe('K1 데이터 검사', () => {
  it.each(SEASON_IDS)('%s는 checkFieldSpec을 통과한다', (id) => {
    expect(checkFieldSpec(resolveSeason(id))).toEqual([])
  })

  it('구조물 순서·key·carrier·solid가 §1.4 표와 같다', () => {
    expect(biobuzz.structures.map((s) => s.key)).toEqual([
      'footBar',
      'footBar',
      'leg',
      'leg',
      'leg',
      'leg',
      'topBar',
      'logoPlate',
      'logoPlate',
      'flower',
      'flower',
      'flower',
      'flower',
      'hiveCell',
      'hiveCell',
      'hiveCell',
      'hiveCell'
    ])
    expect(biobuzz.structures.map((s) => s.carrier)).toEqual([
      ...Array(13).fill('field'),
      'hiveRed',
      'hiveRed',
      'hiveBlue',
      'hiveBlue'
    ])
    expect(biobuzz.structures.map((s) => s.solid)).toEqual([
      ...Array(6).fill(true),
      false,
      false,
      false,
      ...Array(4).fill(true),
      ...Array(4).fill(false)
    ])
    expect(biobuzz.structures.every((s) => s.friction === 0.4)).toBe(true)
    // 표의 계산값(반올림 표시)
    const centers = biobuzz.structures.map((s) => boxOf(s).center)
    const table: [number, number, number][] = [
      [0, -0.60303, 0.02728],
      [0, 0.60303, 0.02728],
      [0.24216, 0.46404, 0.52853],
      [-0.24216, 0.46404, 0.52853],
      [-0.24216, -0.46404, 0.52853],
      [0.24216, -0.46404, 0.52853],
      [0, 0, 1.05283],
      [0.07407, 0, 0.94097],
      [-0.07407, 0, 0.94097],
      [-1.72993, -0.59417, 0.287705],
      [1.72993, 0.59417, 0.287705],
      [0.59417, -1.72993, 0.287705],
      [-0.59417, 1.72993, 0.287705],
      [-0.392175, 0, 0.139825],
      [0.392175, 0, 0.139825],
      [0.392175, 0, 0.139825],
      [-0.392175, 0, 0.139825]
    ]
    centers.forEach((c, i) => expect([c.x, c.y, c.z]).toEqual(table[i]))
    const rotations = biobuzz.structures.map((s) => boxOf(s).rotation)
    const rotationTable: [number, number, number][] = [
      [0, 0, 0],
      [0, 0, Math.PI],
      [0.43065, 0.2265, -1.46769],
      [-0.43065, 0.2265, -1.6739],
      [0.43065, 0.2265, 1.6739],
      [-0.43065, 0.2265, 1.46769],
      [0, 0, 0],
      [0, -0.41888, 0],
      [0, -0.41888, Math.PI],
      [0, 0, 0],
      [0, 0, Math.PI],
      [0, 0, 0],
      [0, 0, Math.PI],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, Math.PI],
      [0, 0, Math.PI]
    ]
    rotations.forEach((r, i) => {
      expect(r.x).toBeCloseTo(rotationTable[i][0], 12)
      expect(r.y).toBeCloseTo(rotationTable[i][1], 12)
      // 표는 5자리 반올림 표시
      expect(r.z).toBeCloseTo(rotationTable[i][2], 4)
    })
  })

  it('짝은 원본의 mirrorStructure이고 형상이 Rz(π) 상이다(1e-12), 생성된 쪽에 −0이 없다', () => {
    for (const [generated, original] of BIOBUZZ_STRUCTURE_PAIRS) {
      const g = biobuzz.structures[generated]
      const o = biobuzz.structures[original]
      expect(g).toEqual(mirrorStructure(o))
      expect(
        sameVertexSet(boxVertices(boxOf(g)), boxVertices(boxOf(o)).map(mirrorVec3), 1e-12)
      ).toBe(true)
      expect(negativeZeros(g)).toEqual([])
    }
    // 자기 짝(위 막대 6)도 형상으로
    const top = boxOf(biobuzz.structures[6])
    expect(sameVertexSet(boxVertices(top), boxVertices(top).map(mirrorVec3), 1e-12)).toBe(true)
    // 로고 판 7 → 8은 (0, −0.41888, π)(표의 옛 값 (0, +0.41888, 0)과 형상은 같다)
    expect(boxOf(biobuzz.structures[8]).rotation).toEqual({ x: 0, y: -0.41888, z: Math.PI })
    expect(
      sameVertexSet(
        boxVertices(boxOf(biobuzz.structures[8])),
        boxVertices({ ...boxOf(biobuzz.structures[8]), rotation: { x: 0, y: 0.41888, z: 0 } }),
        1e-12
      )
    ).toBe(true)
  })

  it('태그·테이프·구역·HIVE·프리셋 짝', () => {
    const tags = biobuzz.aprilTags.tags
    expect(tags.map((t) => t.id)).toEqual(Array.from({ length: 16 }, (_, i) => 30 + i))
    for (let i = 0; i < 8; i++) expect(tags[i + 8]).toEqual(mirrorTag(tags[i]))
    expect(tags.map((t) => t.cluster)).toEqual([
      ...Array(4).fill('RED SCORING'),
      ...Array(4).fill('RED AUDIENCE'),
      ...Array(4).fill('BLUE AUDIENCE'),
      ...Array(4).fill('BLUE SCORING')
    ])
    expect(tags[8].rotation.z).toBeCloseTo(Math.PI / 2, 15)
    expect(tags[12].rotation.z).toBeCloseTo(-Math.PI / 2, 15)
    expect(biobuzz.tape).toHaveLength(14)
    for (let i = 0; i < 7; i++) {
      const red = biobuzz.tape[i]
      const blue = biobuzz.tape[i + 7]
      expect(blue.key).toBe(red.key)
      expect(blue.alliance).toBe('blue')
      expect(blue.rect).toEqual([
        neg(red.rect[2]),
        neg(red.rect[3]),
        neg(red.rect[0]),
        neg(red.rect[1])
      ])
      expect(blue.material.display).toBe('#1565c0')
      expect(blue.offField).toBe(red.offField)
    }
    expect(biobuzz.zones.map((z) => [z.key, z.alliance])).toEqual([
      ['loadingZone', 'red'],
      ['garden', 'red'],
      ['loadingZone', 'blue'],
      ['garden', 'blue']
    ])
    expect(biobuzz.hives).toEqual([
      {
        key: 'hiveRed',
        pivot: { x: 0, y: -0.32385, z: 1.11633 },
        startAngle: -Math.PI / 6,
        tippedAngle: Math.PI / 6
      },
      {
        key: 'hiveBlue',
        pivot: { x: 0, y: 0.32385, z: 1.11633 },
        startAngle: Math.PI / 6,
        tippedAngle: -Math.PI / 6
      }
    ])
    const presets = biobuzz.startPresets
    expect(presets.map((p) => p.key)).toEqual([
      'redWallScoring',
      'redWallCenter',
      'redWallAudience',
      'audienceWall',
      'scoringWallCorner',
      'scoringWallCenter',
      'blueWallAudience',
      'blueWallCenter',
      'blueWallScoring',
      'scoringWall',
      'audienceWallCorner',
      'audienceWallCenter'
    ])
    for (let i = 0; i < 6; i++)
      expect(presets[i + 6]).toEqual(mirrorPreset(presets[i], presets[i + 6].key))
    // 파랑 yaw = wrapPi(빨강 yaw + π): (π/2 + π) − 2π
    expect(presets[6].yaw).toBe(-1.5707963267948966)
    expect(presets[9]).toMatchObject({ wall: 'scoring', along: [0, 1.50404], yaw: 0 })
    expect(wrapPi(Math.PI)).toBe(Math.PI)
    expect(wrapPi(-Math.PI)).toBe(Math.PI)
    expect(negativeZeros(biobuzz)).toEqual([])
  })

  describe('일부러 깬 판을 잡는다', () => {
    const errorsOf = (spec: FieldSpec): string[] => checkFieldSpec(spec)

    it('프리셋 key 중복', () => {
      const presets = biobuzz.startPresets.map((p, i) =>
        i === 1 ? { ...p, key: 'redWallScoring' } : p
      )
      expect(errorsOf({ ...biobuzz, startPresets: presets })).toContain(
        'startPresets[1]: duplicate key redWallScoring'
      )
    })

    it('프리셋이 LOADING ZONE에 걸침', () => {
      const presets = biobuzz.startPresets.map((p, i) =>
        i === 0 ? { ...p, along: [-1.79286, -1.0] as [number, number] } : p
      )
      expect(errorsOf({ ...biobuzz, startPresets: presets })).toContain('startPresets[0]: zones[0]')
    })

    it('프리셋이 다리 29 in 껍질에 걸침', () => {
      // 벽을 0.8 m로 당기면 빨강 벽 가운데 프리셋(깊이 18 in)이 HIVE 다리에 닿는다
      const spec = { ...biobuzz, perimeter: { ...biobuzz.perimeter, innerHalf: 0.8 } }
      const errors = errorsOf(spec)
      expect(errors.some((e) => /^startPresets\[1\]: structures\[(4|5)\]$/.test(e))).toBe(true)
    })

    it('프리셋이 상대 진영에 걸침', () => {
      const presets = biobuzz.startPresets.map((p, i) =>
        i === 3 ? { ...p, along: [-1.0, 0.2] as [number, number] } : p
      )
      expect(errorsOf({ ...biobuzz, startPresets: presets })).toContain(
        'startPresets[3]: outside own half'
      )
    })

    it('짝 하나를 1 mm 옮기면 대칭이 깨진다', () => {
      const moved = biobuzz.structures.map((s, i) => {
        if (i !== 10) return s
        const shape = boxOf(s)
        return { ...s, shape: { ...shape, center: { ...shape.center, x: shape.center.x + 0.001 } } }
      })
      const errors = errorsOf({ ...biobuzz, structures: moved })
      expect(errors).toContain('structures[9]: no Rz(pi) counterpart')
      expect(errors).toContain('structures[10]: no Rz(pi) counterpart')
      const tags = biobuzz.aprilTags.tags.map((t, i) =>
        i === 3 ? { ...t, position: { ...t.position, y: t.position.y + 0.001 } } : t
      )
      expect(errorsOf({ ...biobuzz, aprilTags: { family: 'tag36h11', tags } })).toContain(
        'aprilTags.tags[3]: no Rz(pi) counterpart'
      )
    })

    it('수·크기·사각형·이음 순서·HIVE carrier·원기둥 기울기·태그 id', () => {
      const s0 = biobuzz.structures[0]
      const bad: FieldSpec = {
        ...biobuzz,
        floor: { ...biobuzz.floor, seams: [0, -1] },
        tape: [{ ...biobuzz.tape[0], rect: [1, 0, 0, 1] }],
        structures: [
          { ...s0, shape: { ...boxOf(s0), size: { x: 0, y: 1, z: 1 } } },
          { ...biobuzz.structures[13], solid: true },
          {
            ...s0,
            shape: {
              kind: 'cylinder',
              center: { x: 0, y: 0, z: 0.1 },
              rotation: { x: 0.1, y: 0, z: 0 },
              radius: 0.1,
              height: 0.2
            }
          },
          { ...s0, friction: NaN }
        ],
        aprilTags: {
          family: 'tag36h11',
          tags: [biobuzz.aprilTags.tags[0], biobuzz.aprilTags.tags[0]]
        }
      }
      const errors = errorsOf(bad)
      expect(errors).toEqual(
        expect.arrayContaining([
          'floor.seams[1]: not ascending',
          'tape[0]: empty rect',
          'structures[0]: size',
          'structures[1]: carrier hiveRed must be display only',
          'structures[2]: tilted cylinder',
          'spec.structures.3.friction: not finite',
          'aprilTags.tags[1]: duplicate id 30'
        ])
      )
    })
  })
})

describe("K4 'none' 값", () => {
  const none = resolveSeason('none')
  it('3c 벽과 같은 double, 요소 없음', () => {
    expect(none.perimeter.innerHalf).toBe(WALL_INNER_HALF)
    expect(none.perimeter.height).toBe(WALL_HEIGHT)
    expect(none.perimeter.railBands[1][0]).toBe(WALL_HEIGHT - (0.29576 - 0.26604))
    expect(none.perimeter.railBands[1][1]).toBe(WALL_HEIGHT)
    expect(none.walls).toBeNull()
    expect(none.structures).toEqual([])
    expect(none.aprilTags.tags).toEqual([])
    expect(none.startPresets).toEqual([])
    expect(none.tape).toEqual([])
    expect(none.hives).toEqual([])
    const seams = [-1.2192, -0.6096, 0, 0.6096, 1.2192]
    none.floor.seams.forEach((v, i) => expect(v).toBeCloseTo(seams[i], 15))
    expect(none.floor.material.display).toBe('#3b3e45')
    expect(none.perimeter.panel.optics).toBe('polycarbonate')
  })
})
