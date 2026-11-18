import { describe, expect, it } from 'vitest'
import type { FieldSpec } from '../seasons/fieldSpec'
import { resolveSeason } from '../seasons/seasons'
import { mirrorVec3 } from '../seasons/symmetry'
import type { SimJointSpec, SimElementsSpec, Vec2, Vec3 } from '../worldSpec'
import { MAX_PRELOADS, SLOT_GAP } from './elementData'
import {
  autoPreloadSlots,
  elementSpawns,
  nearestReentryZone,
  reentryZones,
  restBodyFrames
} from './spawn'

// 6a 계약: 공이 생기는 자리(시뮬레이터와 렌더러가 같이 쓰는 순수 함수)

const biobuzz = resolveSeason('biobuzz')
const R = biobuzz.elements!.types[0].radius
const H = biobuzz.perimeter.innerHalf
// 구조물 없는 BIOBUZZ(벽·공 자리만 보는 시험)
const open: FieldSpec = { ...biobuzz, structures: [] }
// 18 in 정사각형 외곽(로봇 좌표, 반시계)
const SQUARE: Vec2[] = [
  { x: 0.2286, y: 0.2286 },
  { x: -0.2286, y: 0.2286 },
  { x: -0.2286, y: -0.2286 },
  { x: 0.2286, y: -0.2286 }
]
const zero = { x: 0, y: 0, z: 0 }

function joint(parent: number, position: Vec3, rotation: Vec3): SimJointSpec {
  return {
    parent,
    type: 'revolute',
    origin: { position, rotation },
    axis: { x: 0, y: 1, z: 0 },
    limits: null,
    body: { mass: 0.1, centerOfMass: zero, inertia: [1e-4, 1e-4, 1e-4, 0, 0, 0] },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: []
  }
}

describe('restBodyFrames', () => {
  it('−1은 로봇 좌표, 관절 몸체는 부모 틀 ∘ (위치, ZYX 회전)', () => {
    const frames = restBodyFrames([
      joint(-1, { x: 0.1, y: 0, z: 0.05 }, { x: 0, y: 0, z: Math.PI / 2 }),
      joint(0, { x: 0.2, y: 0, z: 0 }, zero)
    ])
    expect(frames(-1)).toEqual({ rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: zero })
    const child = frames(1)
    expect(child.origin.x).toBeCloseTo(0.1, 15)
    expect(child.origin.y).toBeCloseTo(0.2, 15)
    expect(child.origin.z).toBeCloseTo(0.05, 15)
    expect(() => frames(2)).toThrow(RangeError)
  })
})

describe('elementSpawns', () => {
  const start = { x: 0.5, y: -1, yaw: Math.PI / 2 }

  it('경기 요소가 없으면 []', () => {
    expect(elementSpawns(biobuzz, undefined, start)).toEqual([])
    expect(elementSpawns(resolveSeason('none'), { groups: [], preloads: [] }, start)).toEqual([])
  })

  it('순서는 배치(고른 묶음, 잠듦) → 프리로드(깨어 있음), 프리로드는 시작 자세로 옮긴다', () => {
    const elements: SimElementsSpec = {
      groups: ['garden'],
      preloads: [
        { kind: 'pollen', body: -1, position: { x: 0.3, y: 0, z: R } },
        { kind: 'pollen', body: 0, position: { x: 0, y: 0.1, z: 0 } }
      ]
    }
    const joints = [joint(-1, { x: 0.1, y: 0, z: 0.2 }, { x: 0, y: 0, z: Math.PI / 2 })]
    const spawned = elementSpawns(biobuzz, elements, start, restBodyFrames(joints))
    expect(spawned).toHaveLength(10)
    spawned.slice(0, 8).forEach((s, i) => {
      expect(s.kind).toBe('pollen')
      expect(s.position).toEqual(biobuzz.elements!.layout[i].position)
      expect(s.position).not.toBe(biobuzz.elements!.layout[i].position)
      expect(s.asleep).toBe(true)
    })
    const [a, b] = spawned.slice(8)
    expect(a.asleep).toBe(false)
    expect(a.out).toBe(false)
    expect(a.orientation).toEqual([1, 0, 0, 0])
    expect(a.velocity).toEqual(zero)
    expect(a.angularVelocity).toEqual(zero)
    // 로봇 +X는 필드 +Y(요 90°)
    expect(a.position.x).toBeCloseTo(0.5, 15)
    expect(a.position.y).toBeCloseTo(-0.7, 15)
    expect(a.position.z).toBe(R)
    // 관절 틀(로봇 (0.1, 0, 0.2), 요 90°)의 (0, 0.1, 0) → 로봇 (0, 0, 0.2) → 필드 (0.5, −1, 0.2)
    expect(b.position.x).toBeCloseTo(0.5, 15)
    expect(b.position.y).toBeCloseTo(-1, 15)
    expect(b.position.z).toBeCloseTo(0.2, 15)
  })

  it('묶음을 고르지 않으면 프리로드만, 결과는 새 객체(−0 없음)', () => {
    const spawned = elementSpawns(
      biobuzz,
      { groups: [], preloads: [{ kind: 'pollen', body: -1, position: { x: -0, y: -0, z: R } }] },
      { x: 0, y: 0, yaw: 0 }
    )
    expect(spawned).toHaveLength(1)
    expect(Object.is(spawned[0].position.x, -0)).toBe(false)
    expect(Object.is(spawned[0].position.y, -0)).toBe(false)
  })
})

describe('autoPreloadSlots', () => {
  it('앞 면: 외곽 앞에서 r + 0.5 mm, 2r + 0.5 mm 간격, 바닥 위', () => {
    const result = autoPreloadSlots(SQUARE, open, { x: 0, y: -1, yaw: 0 })
    expect(result?.face).toBe('front')
    expect(result?.slots).toHaveLength(MAX_PRELOADS)
    const pitch = 2 * R + SLOT_GAP
    result!.slots.forEach((p, k) => {
      expect(p.x).toBeCloseTo(0.2286 + R + SLOT_GAP, 15)
      expect(p.y).toBeCloseTo((k - 1.5) * pitch, 15)
      expect(p.z).toBe(R)
    })
  })

  it('앞이 벽에 막히면 뒤, 앞·뒤가 막히면 왼쪽, 넷 다 막히면 null', () => {
    const atWall = { x: H - 0.2286, y: 0, yaw: 0 }
    expect(autoPreloadSlots(SQUARE, open, atWall)?.face).toBe('back')
    const long: Vec2[] = [
      { x: 1.75, y: 0.2 },
      { x: -1.75, y: 0.2 },
      { x: -1.75, y: -0.2 },
      { x: 1.75, y: -0.2 }
    ]
    const left = autoPreloadSlots(long, open, { x: 0, y: 0, yaw: 0 })
    expect(left?.face).toBe('left')
    expect(left!.slots.every((p) => Math.abs(p.y - (0.2 + R + SLOT_GAP)) < 1e-15)).toBe(true)
    const narrowLeft = autoPreloadSlots(long, open, { x: 0, y: H - 0.2, yaw: 0 })
    expect(narrowLeft?.face).toBe('right')
    const huge: Vec2[] = [
      { x: 1.75, y: 1.75 },
      { x: -1.75, y: 1.75 },
      { x: -1.75, y: -1.75 },
      { x: 1.75, y: -1.75 }
    ]
    expect(autoPreloadSlots(huge, open, { x: 0, y: 0, yaw: 0 })).toBeNull()
  })

  it('고른 묶음의 시즌 공(GARDEN)과 겹치는 면은 막힌다', () => {
    // 앞 자리가 빨강 GARDEN POLLEN 위에 놓이는 자세
    const pose = { x: 1.49, y: -1.6, yaw: 0 }
    expect(autoPreloadSlots(SQUARE, open, pose)?.face).toBe('front')
    expect(autoPreloadSlots(SQUARE, open, pose, ['garden'])?.face).toBe('back')
  })

  it('공이 부딪히는 구조물(빨강 벽 FLOWER <3>)에 걸치는 면은 막힌다', () => {
    // 앞(−Y)이 FLOWER <3>에 닿는 자세
    const pose = { x: 0.594, y: -1.4, yaw: -Math.PI / 2 }
    expect(autoPreloadSlots(SQUARE, open, pose)?.face).toBe('front')
    expect(autoPreloadSlots(SQUARE, biobuzz, pose)?.face).toBe('back')
  })

  it('시즌에 POLLEN이 없으면 null', () => {
    expect(autoPreloadSlots(SQUARE, resolveSeason('none'), { x: 0, y: 0, yaw: 0 })).toBeNull()
  })
})

describe('reentryZones', () => {
  it('BIOBUZZ POLLEN: LOADING ZONE 둘(빨강 → 파랑), 벽에 붙인 7자리를 가운데부터, Rz(π) 대칭', () => {
    const zones = reentryZones(biobuzz, 'pollen')
    expect(zones.map((z) => [z.zone, z.alliance])).toEqual([
      [0, 'red'],
      [2, 'blue']
    ])
    const [red, blue] = zones
    const rect = biobuzz.zones[0].rect
    expect(red.center).toEqual({ x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 })
    expect(red.slots).toHaveLength(7)
    const pitch = 2 * R + SLOT_GAP
    const offsets = [0, -1, 1, -2, 2, -3, 3]
    red.slots.forEach((p, i) => {
      // 빨강 벽(−Y)을 필드 안에서 볼 때 왼쪽은 −X
      expect(p.x).toBeCloseTo(red.center.x + offsets[i] * pitch, 15)
      expect(p.y).toBeCloseTo(-H + R + SLOT_GAP, 15)
      expect(p.z).toBe(R)
      expect(p.x - R).toBeGreaterThanOrEqual(rect[0])
      expect(p.x + R).toBeLessThanOrEqual(rect[2])
    })
    blue.slots.forEach((p, i) => expect(p).toEqual(mirrorVec3(red.slots[i])))
  })

  it('다시 넣지 않는 종류·경기 요소 없는 시즌은 []', () => {
    expect(reentryZones(biobuzz, 'nectarRed')).toEqual([])
    expect(reentryZones(resolveSeason('none'), 'pollen')).toEqual([])
  })

  it('nearestReentryZone: 가운데가 가장 가까운 구역, 같으면 앞(빨강)', () => {
    const zones = reentryZones(biobuzz, 'pollen')
    expect(nearestReentryZone(zones, { x: -1, y: -2 })?.alliance).toBe('red')
    expect(nearestReentryZone(zones, { x: 1, y: 2 })?.alliance).toBe('blue')
    expect(nearestReentryZone(zones, { x: 0, y: 0 })?.alliance).toBe('red')
    expect(nearestReentryZone([], { x: 0, y: 0 })).toBeNull()
  })
})
