import { describe, expect, it } from 'vitest'
import {
  canHaveColliders,
  canHaveRobotCollision,
  colliderEnabled,
  colliderFriction,
  defaultBox,
  COLLIDER_KINDS,
  defaultCapsule,
  defaultCylinder,
  defaultMesh,
  DEFAULT_COLLIDER_FRICTION,
  isWellFormedCollider,
  MIN_CYLINDER_HEIGHT,
  forceCollideKey,
  MAX_OBJECT_COLLIDERS,
  sameColliders,
  sameRobotCollision,
  sanitizeCollider,
  sanitizeColliders,
  sanitizeRobotCollision,
  type BoxColliderSettings,
  type CapsuleColliderSettings,
  type ColliderSettings,
  type CylinderColliderSettings
} from './collider'
import type { SceneObject } from './model'

// 충돌체 정리(spec-5 §2.1, K5)

const box = (change: Partial<BoxColliderSettings> = {}): BoxColliderSettings => ({
  id: 'b',
  kind: 'box',
  center: [0, 0, 0.1],
  size: [0.2, 0.3, 0.4],
  ...change
})
const capsule = (change: Partial<CapsuleColliderSettings> = {}): CapsuleColliderSettings => ({
  id: 'c',
  kind: 'capsule',
  center: [0, 0, 0],
  radius: 0.02,
  height: 0.3,
  direction: 'x',
  ...change
})

describe('sanitizeCollider', () => {
  it('범위 밖 center·size·radius·height를 자르고 vertexLimit은 반올림해 자른다', () => {
    expect(sanitizeCollider(box({ center: [11, -12, 3], size: [0, 20, 1e-4] }))).toEqual(
      box({ center: [10, -10, 3], size: [1e-3, 10, 1e-3] })
    )
    expect(sanitizeCollider(capsule({ radius: 0, height: -1 }))).toEqual(
      capsule({ radius: 5e-4, height: 0 })
    )
    expect(sanitizeCollider(capsule({ radius: 3, height: 25 }))).toEqual(
      capsule({ radius: 1, height: 20 })
    )
    expect(sanitizeCollider({ ...defaultMesh('m'), vertexLimit: 7.6 })).toEqual({
      id: 'm',
      kind: 'mesh',
      vertexLimit: 8
    })
    expect(sanitizeCollider({ ...defaultMesh('m'), vertexLimit: 70 })).toMatchObject({
      vertexLimit: 64
    })
  })

  it('범위 밖 friction은 키를 지우고, enabled는 false일 때만 남긴다', () => {
    expect(sanitizeCollider(box({ friction: 3 }))).not.toHaveProperty('friction')
    expect(sanitizeCollider(box({ friction: -0.1 }))).not.toHaveProperty('friction')
    expect(sanitizeCollider(box({ friction: 2 }))).toMatchObject({ friction: 2 })
    expect(sanitizeCollider(box({ friction: 0 }))).toMatchObject({ friction: 0 })
    const on = { ...box(), enabled: true } as unknown as ColliderSettings
    expect(sanitizeCollider(on)).not.toHaveProperty('enabled')
    expect(sanitizeCollider(box({ enabled: false }))).toMatchObject({ enabled: false })
  })

  it('−0을 0으로 바꾸고 키 순서가 고정이다', () => {
    const out = sanitizeCollider({
      size: [0.1, 0.1, 0.1],
      friction: 0.5,
      center: [-0, -0, 0],
      enabled: false,
      kind: 'box',
      id: 'x'
    })
    expect(Object.keys(out)).toEqual(['id', 'kind', 'enabled', 'center', 'size', 'friction'])
    expect((out as BoxColliderSettings).center.every((c) => Object.is(c, 0))).toBe(true)
    expect(Object.keys(sanitizeCollider(capsule({ friction: 1 })))).toEqual([
      'id',
      'kind',
      'center',
      'radius',
      'height',
      'direction',
      'friction'
    ])
    expect(
      Object.keys(sanitizeCollider({ friction: 1, vertexLimit: 9, kind: 'mesh', id: 'm' }))
    ).toEqual(['id', 'kind', 'vertexLimit', 'friction'])
    expect(JSON.stringify(sanitizeCollider(box()))).toBe(JSON.stringify(box()))
  })

  it('목록: 같은 id는 앞의 것만, 9개는 8개로', () => {
    expect(sanitizeColliders([box({ id: 'a' }), capsule({ id: 'a' }), box({ id: 'b' })])).toEqual([
      box({ id: 'a' }),
      box({ id: 'b' })
    ])
    const nine = Array.from({ length: 9 }, (_, i) => box({ id: `k${i}` }))
    expect(sanitizeColliders(nine)).toHaveLength(MAX_OBJECT_COLLIDERS)
    expect(sanitizeColliders(nine).at(-1)?.id).toBe('k7')
  })

  it('sameColliders는 값 비교이고 없음 = []', () => {
    expect(sameColliders(undefined, [])).toBe(true)
    expect(sameColliders([box()], [box()])).toBe(true)
    expect(sameColliders([box()], [box({ size: [0.2, 0.3, 0.5] })])).toBe(false)
    expect(sameColliders([box()], [box({ friction: 0.4 })])).toBe(false)
    expect(sameColliders([box()], [box({ enabled: false })])).toBe(false)
    expect(sameColliders([capsule()], [capsule({ direction: 'y' })])).toBe(false)
    expect(sameColliders([box(), capsule()], [capsule(), box()])).toBe(false)
  })

  it('기본 마찰·켬 상태', () => {
    expect(colliderFriction(box())).toBe(DEFAULT_COLLIDER_FRICTION)
    expect(colliderFriction(box({ friction: 1.2 }))).toBe(1.2)
    expect(colliderEnabled(box())).toBe(true)
    expect(colliderEnabled(box({ enabled: false }))).toBe(false)
  })
})

describe('추가할 때의 기본값(spec-5 §1.2)', () => {
  // 이진수로 정확한 값(합·차가 반올림 없이 맞게)
  const bounds = {
    min: [-0.125, 0, 0.25] as [number, number, number],
    max: [0.375, 0.125, 0.3125] as [number, number, number]
  }

  it('Box는 하위 경계 상자, 없으면 0.1 m 정육면체', () => {
    expect(defaultBox('b', bounds)).toEqual({
      id: 'b',
      kind: 'box',
      center: [0.125, 0.0625, 0.28125],
      size: [0.5, 0.125, 0.0625]
    })
    expect(defaultBox('b', null)).toEqual({
      id: 'b',
      kind: 'box',
      center: [0, 0, 0],
      size: [0.1, 0.1, 0.1]
    })
  })

  it('Capsule은 가장 긴 축(같으면 x → y → z), 없으면 반지름 0.05·높이 0.2·로봇 위 축', () => {
    expect(defaultCapsule('c', bounds, 'z')).toEqual({
      id: 'c',
      kind: 'capsule',
      center: [0.125, 0.0625, 0.28125],
      radius: 0.0625,
      height: 0.5,
      direction: 'x'
    })
    const cube = {
      min: [0, 0, 0] as [number, number, number],
      max: [0.2, 0.2, 0.2] as [number, number, number]
    }
    expect(defaultCapsule('c', cube, 'z').direction).toBe('x')
    const tall = {
      min: [0, 0, 0] as [number, number, number],
      max: [0.1, 0.3, 0.3] as [number, number, number]
    }
    expect(defaultCapsule('c', tall, 'z').direction).toBe('y')
    expect(defaultCapsule('c', null, 'y')).toEqual({
      id: 'c',
      kind: 'capsule',
      center: [0, 0, 0],
      radius: 0.05,
      height: 0.2,
      direction: 'y'
    })
  })

  it('Mesh는 꼭짓점 한도 32, 마찰 빈 칸', () => {
    expect(defaultMesh('m')).toEqual({ id: 'm', kind: 'mesh', vertexLimit: 32 })
  })
})

describe('자기 충돌 설정', () => {
  it('짝을 사전순으로 놓고 같은 짝·자기 짝을 빼며 비면 null', () => {
    expect(forceCollideKey('b', 'a')).toEqual(['a', 'b'])
    expect(
      sanitizeRobotCollision({
        forceCollide: [
          ['z', 'r'],
          ['a', 'q'],
          ['r', 'z'],
          ['a', 'a']
        ]
      })
    ).toEqual({
      forceCollide: [
        ['a', 'q'],
        ['r', 'z']
      ]
    })
    expect(sanitizeRobotCollision({ forceCollide: [] })).toBeNull()
    expect(sanitizeRobotCollision({ forceCollide: [['x', 'x']] })).toBeNull()
  })

  it('sameRobotCollision은 값 비교이고 없음 = 빈 목록', () => {
    expect(sameRobotCollision(undefined, { forceCollide: [] })).toBe(true)
    expect(sameRobotCollision({ forceCollide: [['a', 'b']] }, { forceCollide: [['a', 'b']] })).toBe(
      true
    )
    expect(sameRobotCollision({ forceCollide: [['a', 'b']] }, undefined)).toBe(false)
  })

  it('Collider는 모든 kind에, 자기 충돌은 robot에만', () => {
    const object = (kind: SceneObject['kind']): SceneObject => ({
      id: kind,
      name: kind,
      kind,
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
    })
    for (const kind of ['robot', 'assembly', 'part', 'group'] as const)
      expect(canHaveColliders(object(kind))).toBe(true)
    expect(canHaveRobotCollision(object('robot'))).toBe(true)
    expect(canHaveRobotCollision(object('group'))).toBe(false)
  })
})

// 6a 계약: Cylinder Collider(Unity에 없음, 임시 편차)
describe('Cylinder Collider', () => {
  const cylinder = (change: Partial<CylinderColliderSettings> = {}): CylinderColliderSettings => ({
    id: 'y',
    kind: 'cylinder',
    center: [0, 0, 0],
    radius: 0.024,
    height: 0.3,
    direction: 'y',
    ...change
  })

  it('정리: 반지름은 캡슐 한도, 높이는 [1 mm, 20 m], 키 순서는 Capsule과 같다', () => {
    expect(COLLIDER_KINDS).toContain('cylinder')
    expect(sanitizeCollider(cylinder({ radius: 2, height: 0, friction: 9 }))).toEqual(
      cylinder({ radius: 1, height: MIN_CYLINDER_HEIGHT })
    )
    expect(sanitizeCollider(cylinder({ center: [11, -0, 0], height: 30 }))).toEqual(
      cylinder({ center: [10, 0, 0], height: 20 })
    )
    expect(Object.keys(sanitizeCollider(cylinder({ enabled: false, friction: 1 })))).toEqual([
      'id',
      'kind',
      'enabled',
      'center',
      'radius',
      'height',
      'direction',
      'friction'
    ])
    expect(isWellFormedCollider(cylinder())).toBe(true)
    expect(isWellFormedCollider(cylinder({ height: Number.NaN }))).toBe(false)
    expect(sameColliders([cylinder()], [cylinder()])).toBe(true)
    expect(sameColliders([cylinder()], [{ ...cylinder(), kind: 'capsule' }])).toBe(false)
  })

  it('기본값: 나머지 두 길이가 가장 비슷한 축(롤러는 긴 축, 원판은 얇은 축), 없으면 upAxis', () => {
    const roller = { min: [-0.15, -0.02, -0.02], max: [0.15, 0.02, 0.02] } as const
    expect(defaultCylinder('y', { min: [...roller.min], max: [...roller.max] }, 'z')).toEqual({
      id: 'y',
      kind: 'cylinder',
      center: [0, 0, 0],
      radius: 0.02,
      height: 0.3,
      direction: 'x'
    })
    const disc = defaultCylinder('d', { min: [0, 0, 0], max: [0.1, 0.1, 0.02] }, 'x')
    expect(disc.direction).toBe('z')
    expect(disc.radius).toBeCloseTo(0.05, 15)
    expect(disc.height).toBeCloseTo(0.02, 15)
    expect(defaultCylinder('n', null, 'y')).toEqual({
      id: 'n',
      kind: 'cylinder',
      center: [0, 0, 0],
      radius: 0.05,
      height: 0.1,
      direction: 'y'
    })
  })
})
