import { Euler, Matrix4, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { EditPoseBody, EditPoseOverlap } from '../../../shared/sim/collision3d'
import { HULL_DEFAULT_VERTEX_LIMIT, MAX_HULL_POINTS, canonicalHull } from '../../../shared/sim/hull'
import {
  DEFAULT_COLLIDER_FRICTION,
  MAX_BODY_COLLIDERS,
  MAX_WORLD_COLLIDERS,
  type Vec3
} from '../../../shared/sim/worldSpec'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import type { ColliderSettings } from '../scene/collider'
import { defaultJoint } from '../scene/joint'
import type { ColliderShapeLookup, ObjectHullPoints } from '../scene/meshHull'
import type { SceneObject, SceneObjects } from '../scene/model'
import {
  buildCollisionModel,
  createCollisionModelCache,
  staleForcePairs,
  type CollisionModel,
  type CollisionModelCache
} from './worldColliders'
import { jointBodyFrames } from './worldJoints'
import type { WorldWarning, WorldWarningKey } from './worldSpec'

// 몸체마다 충돌 형상(spec-5 §5.4, B5–B7·B16). 메시 껍질 점은 가짜 조회(STEP 워커가 만드는 meshHull 대신)이고, 편집 자세 앞
// 계산은 가짜 overlaps(갈래 A의 editPoseOverlaps 대신)다.

// 타입 검사: 아래 키가 WorldWarningKey가 아니면 pnpm typecheck가 실패한다(K7)
const COLLIDER_WARNINGS: WorldWarningKey[] = [
  'worldColliderPending',
  'worldColliderDegenerate',
  'worldTooManyColliders',
  'worldTooManyWorldColliders',
  'worldJointStartOverlap'
]

describe('충돌 경고 키', () => {
  it('ko·en에 비어 있지 않은 문장이 있다', () => {
    for (const key of COLLIDER_WARNINGS) {
      expect(ko.console.notices[key].length).toBeGreaterThan(0)
      expect(en.console.notices[key].length).toBeGreaterThan(0)
    }
    for (const code of ['collisionOverlap', 'collisionLimit', 'collisionLift'] as const) {
      expect(ko.console.notices.sim[code].length).toBeGreaterThan(0)
      expect(en.console.notices.sim[code].length).toBeGreaterThan(0)
    }
    const warning: WorldWarning = { key: 'worldColliderPending', params: { name: 'Arm', count: 2 } }
    expect(warning.key).toBe('worldColliderPending')
  })
})

// ---- 씬 ----

type V3 = [number, number, number]
const object = (
  id: string,
  parentId: string | null,
  position: V3,
  extra: Partial<SceneObject> = {},
  rotation: V3 = [0, 0, 0]
): SceneObject => ({
  id,
  name: extra.name ?? id,
  kind: extra.kind ?? 'part',
  parentId,
  transform: { position, rotation },
  ...extra
})
const mesh = (id: string): Partial<SceneObject> => ({
  visual: { type: 'mesh', geometryId: `g:${id}`, color: [1, 1, 1] }
})

// 로봇(필드에 돌려 둠: 로봇 자세는 몸체 틀 안의 형상을 바꾸지 않는다) → 섀시 판 base, 리프트(직선 z) → 판 plate, 팔(회전 y) → 관 tube
function robotScene(): SceneObjects {
  return {
    R: object('R', null, [0.5, -0.3, 0], { kind: 'robot', name: 'Robot' }, [0, 0, 0.7]),
    base: object('base', 'R', [0, 0, 0.05], mesh('base')),
    lift: object('lift', 'R', [0.1, 0, 0.1], {
      kind: 'group',
      name: 'Lift',
      joint: { ...defaultJoint('prismatic'), axis: 'z', anchor: [0, 0, 0.02] }
    }),
    plate: object('plate', 'lift', [0, 0.05, 0.05], mesh('plate'), [0, 0, Math.PI / 6]),
    arm: object('arm', 'lift', [0.05, 0, 0.2], {
      kind: 'group',
      name: 'Arm',
      joint: { ...defaultJoint('revolute'), axis: 'y' }
    }),
    tube: object('tube', 'arm', [0.15, 0, 0], mesh('tube'))
  }
}

// 상자 8꼭짓점(오브젝트 로컬, 반 크기)
function box(hx: number, hy: number, hz: number, error = 0): ObjectHullPoints {
  const points: Vec3[] = []
  for (let k = 0; k < 8; k++)
    points.push({ x: k & 1 ? hx : -hx, y: k & 2 ? hy : -hy, z: k & 4 ? hz : -hz })
  return { kind: 'points', points, error }
}

// 두께 없는 판(퇴화)
const flatPlate = (): ObjectHullPoints => box(0.1, 0.1, 0)

const SHAPES: Record<string, ObjectHullPoints> = {
  base: box(0.2, 0.2, 0.05, 0.0005),
  plate: box(0.05, 0.1, 0.005, 0.0002),
  tube: box(0.15, 0.01, 0.01, 0.0001)
}
const shapesOf =
  (table: Record<string, ObjectHullPoints>): ColliderShapeLookup =>
  (id) =>
    table[id] ?? { kind: 'none' }

const OUTLINE = {
  footprint: [
    { x: 0.2, y: -0.2 },
    { x: 0.2, y: 0.2 },
    { x: -0.2, y: 0.2 },
    { x: -0.2, y: -0.2 }
  ],
  height: 0.4
}

function model(
  objects: SceneObjects,
  options: {
    shapes?: ColliderShapeLookup
    overlaps?: (bodies: readonly EditPoseBody[], tolerance?: number) => EditPoseOverlap[]
    cache?: CollisionModelCache
  } = {}
): CollisionModel {
  return buildCollisionModel({
    objects,
    robotId: 'R',
    joints: jointBodyFrames(objects, 'R'),
    shapes: options.shapes ?? shapesOf(SHAPES),
    outline: OUTLINE,
    overlaps: options.overlaps ?? (() => []),
    cache: options.cache
  })
}

const withColliders = (
  objects: SceneObjects,
  id: string,
  colliders: ColliderSettings[]
): SceneObjects => ({ ...objects, [id]: { ...objects[id], colliders } })

const keys = (warnings: readonly WorldWarning[]): string[] => warnings.map((w) => w.key)

// 로컬 변환 행렬(Euler ZYX)
const local = (position: V3, rotation: V3): Matrix4 =>
  new Matrix4()
    .makeRotationFromEuler(new Euler(rotation[0], rotation[1], rotation[2], 'ZYX'))
    .setPosition(position[0], position[1], position[2])

describe('B5 Collider → 세계 설명 충돌체(몸체 틀)', () => {
  it('B5 회전한 오브젝트의 Box는 중심·회전·반 크기가 해석값이고 회전은 정규 직교다', () => {
    const objects = withColliders(robotScene(), 'plate', [
      { id: 'b', kind: 'box', center: [0.01, 0.02, -0.003], size: [0.12, 0.2, 0.01], friction: 0.8 }
    ])
    const lift = model(objects).bodies.find((body) => body.objectId === 'lift')!
    expect(lift.source).toBe('colliders')
    const collider = lift.colliders[0].collider
    if (collider.kind !== 'box') throw new Error('box')
    // 관절 몸체 틀 = 리프트 틀 · 앵커: 판의 몸체 틀 행렬 = T(앵커)⁻¹ · 판의 로컬
    const toBody = new Matrix4()
      .makeTranslation(0, 0, -0.02)
      .multiply(local([0, 0.05, 0.05], [0, 0, Math.PI / 6]))
    const center = new Vector3(0.01, 0.02, -0.003).applyMatrix4(toBody)
    expect(collider.center.x).toBeCloseTo(center.x, 12)
    expect(collider.center.y).toBeCloseTo(center.y, 12)
    expect(collider.center.z).toBeCloseTo(center.z, 12)
    expect(collider.half).toEqual({ x: 0.06, y: 0.1, z: 0.005 })
    expect(collider.friction).toBe(0.8)
    const c = Math.cos(Math.PI / 6)
    const s = Math.sin(Math.PI / 6)
    const expected = [c, -s, 0, s, c, 0, 0, 0, 1]
    collider.rotation.forEach((value, k) => expect(value).toBeCloseTo(expected[k], 12))
    // RᵀR = I(1e-12)
    const r = collider.rotation
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let dot = 0
        for (let k = 0; k < 3; k++) dot += r[3 * k + i] * r[3 * k + j]
        expect(Math.abs(dot - (i === j ? 1 : 0))).toBeLessThan(1e-12)
      }
  })

  it('B5 Capsule 끝점은 중심 ± (높이/2 − 반지름)·방향이고 반지름은 그대로다(빈 마찰은 기본값)', () => {
    const objects = withColliders(robotScene(), 'tube', [
      {
        id: 'c',
        kind: 'capsule',
        center: [0.01, 0, 0],
        radius: 0.02,
        height: 0.3,
        direction: 'x'
      }
    ])
    const arm = model(objects).bodies.find((body) => body.objectId === 'arm')!
    const collider = arm.colliders[0].collider
    if (collider.kind !== 'capsule') throw new Error('capsule')
    // 팔 앵커 0: 관의 몸체 틀 = 관의 로컬
    expect(collider.a.x).toBeCloseTo(0.15 + 0.01 - 0.13, 12)
    expect(collider.b.x).toBeCloseTo(0.15 + 0.01 + 0.13, 12)
    // 몸체 틀은 로봇 좌표 관절 틀의 역을 곱한 것이라 반올림만 남는다
    for (const value of [collider.a.y, collider.a.z, collider.b.y, collider.b.z])
      expect(Math.abs(value)).toBeLessThan(1e-12)
    expect(collider.radius).toBe(0.02)
    expect(collider.friction).toBe(DEFAULT_COLLIDER_FRICTION)
  })

  it('B5 Mesh Collider는 같은 몸체 메시만 모은다(안쪽 관절 하위의 메시는 빠진다), 끈 Collider는 세계 설명에 없다', () => {
    const objects = withColliders(robotScene(), 'lift', [
      { id: 'm', kind: 'mesh', vertexLimit: 16, friction: 1 },
      { id: 'off', kind: 'box', enabled: false, center: [0, 0, 0], size: [1, 1, 1] }
    ])
    const lift = model(objects).bodies.find((body) => body.objectId === 'lift')!
    expect(lift.colliders).toHaveLength(1)
    const collider = lift.colliders[0].collider
    if (collider.kind !== 'convex') throw new Error('convex')
    // 판(몸체 틀 y 0.05 둘레, 0.1 × 0.2 판을 30° 돌림)만: 관(팔 몸체, x 0.05 + 0.15 ± 0.15)의 점이 없다
    for (const p of collider.points) {
      expect(Math.hypot(p.x, p.y - 0.05)).toBeLessThan(0.12)
      // 판 중심 몸체 틀 z = 0.05 − 앵커 0.02, 반 두께 0.005
      expect(Math.abs(p.z - 0.03)).toBeLessThanOrEqual(0.0051)
    }
    expect(collider.points.length).toBeLessThanOrEqual(16)
    expect(collider.friction).toBe(1)
    // 정규 껍질이 같은 점에서 나온다(§1.11)
    expect(lift.colliders[0].hull).toEqual(canonicalHull(collider.points))
    expect(lift.colliders[0].hullPoints).toBe(lift.colliders[0].hull!.vertices.length)
    // 오차는 max(몸체 껍질, 메시 껍질 최대)
    expect(lift.colliders[0].error).toBeGreaterThanOrEqual(0.0002)
    // 끈 상자는 상태에만(기즈모가 흐리게 그린다)
    expect(lift.states.map((state) => [state.colliderId, state.enabled, state.status])).toEqual([
      ['m', true, 'ok'],
      ['off', false, 'ok']
    ])
    expect(lift.states[1].entry?.collider.kind).toBe('box')
  })
})

describe('B6 몸체 규칙', () => {
  it('B6 Collider가 없으면 자동 볼록 껍질(점 ≤ 32), 관절 몸체에 메시가 없으면 none(경고 없음)', () => {
    const objects = robotScene()
    const result = model({
      ...objects,
      empty: object('empty', 'R', [0, 0, 0.3], { kind: 'group', joint: defaultJoint('revolute') })
    })
    const chassis = result.bodies[0]
    expect(chassis).toMatchObject({
      body: -1,
      objectId: 'R',
      name: 'Robot',
      parent: null,
      source: 'auto'
    })
    expect(chassis.colliders[0].colliderId).toBeNull()
    expect(chassis.colliders[0].hullPoints).toBeLessThanOrEqual(HULL_DEFAULT_VERTEX_LIMIT)
    // 섀시 판(로봇 좌표 z 0–0.1)
    const zs = (chassis.colliders[0].collider as { points: Vec3[] }).points.map((p) => p.z)
    expect(Math.min(...zs)).toBeCloseTo(0, 4)
    expect(Math.max(...zs)).toBeCloseTo(0.1, 4)
    const empty = result.bodies.find((body) => body.objectId === 'empty')!
    expect(empty.source).toBe('none')
    expect(empty.colliders).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('B6 Collider를 모두 끄면 disabled(충돌 없음, 자동 껍질을 쓰지 않음)', () => {
    const off: ColliderSettings = {
      id: 'off',
      kind: 'box',
      enabled: false,
      center: [0, 0, 0],
      size: [0.1, 0.1, 0.1]
    }
    const result = model(withColliders(withColliders(robotScene(), 'base', [off]), 'tube', [off]))
    expect(result.bodies[0]).toMatchObject({ source: 'disabled', colliders: [], pendingMeshes: 0 })
    expect(result.bodies.find((body) => body.objectId === 'arm')).toMatchObject({
      source: 'disabled',
      colliders: []
    })
  })

  it('B6 섀시 메시를 읽는 중이면 외곽 대체 상자와 worldColliderPending, 켠 Mesh Collider가 모두 읽는 중인 섀시도 대체 상자', () => {
    const pending = shapesOf({ ...SHAPES, base: { kind: 'pending' } })
    const result = model(robotScene(), { shapes: pending })
    const chassis = result.bodies[0]
    expect(chassis.source).toBe('fallback')
    expect(chassis.pendingMeshes).toBe(1)
    expect(chassis.colliders).toHaveLength(1)
    expect(chassis.colliders[0].collider).toEqual({
      kind: 'box',
      center: { x: 0, y: 0, z: 0.2 },
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      half: { x: 0.2, y: 0.2, z: 0.2 },
      friction: DEFAULT_COLLIDER_FRICTION
    })
    expect(result.warnings).toEqual([
      { key: 'worldColliderPending', params: { name: 'Robot', count: 1 } }
    ])
    // C-M6: 켠 Collider가 있는데 모두 빠지면 빈 배열이 아니라 대체 상자
    const meshCollider = withColliders(robotScene(), 'base', [
      { id: 'm', kind: 'mesh', vertexLimit: 32 }
    ])
    const withPending = model(meshCollider, { shapes: pending }).bodies[0]
    expect(withPending.source).toBe('fallback')
    expect(withPending.colliders).toHaveLength(1)
    expect(withPending.states[0]).toMatchObject({ status: 'pending', pendingMeshes: 1 })
  })

  it('B6 평평한 판만 있는 몸체는 worldColliderDegenerate, 메시 없는 Mesh Collider는 none 상태', () => {
    const flat = shapesOf({
      ...SHAPES,
      tube: flatPlate()
    })
    const result = model(robotScene(), { shapes: flat })
    const arm = result.bodies.find((body) => body.objectId === 'arm')!
    expect(arm).toMatchObject({ source: 'none', degenerate: 1 })
    expect(keys(result.warnings)).toEqual(['worldColliderDegenerate'])
    expect(result.warnings[0].params).toEqual({ name: 'Arm', count: 1 })
    const noMesh = withColliders(robotScene(), 'arm', [])
    const group = model({
      ...noMesh,
      g: object('g', 'arm', [0, 0, 0], {
        kind: 'group',
        colliders: [{ id: 'm', kind: 'mesh', vertexLimit: 32 }]
      })
    }).bodies.find((body) => body.objectId === 'arm')!
    expect(group.states[0].status).toBe('none')
  })

  it(`B6 몸체 한도 ${MAX_BODY_COLLIDERS}·세계 한도 ${MAX_WORLD_COLLIDERS}를 넘으면 앞의 것만 쓰고 경고한다`, () => {
    let objects = robotScene()
    const many = (prefix: string): ColliderSettings[] =>
      Array.from({ length: 6 }, (_, i) => ({
        id: `${prefix}${i}`,
        kind: 'box',
        center: [0, 0, 0],
        size: [0.01, 0.01, 0.01]
      }))
    // 섀시 18개(6 × 3), 관절 몸체 넷에 각 18개 → 몸체 한도 16, 합 80 > 64
    for (const parent of ['R', 'lift', 'arm']) {
      for (let k = 0; k < 3; k++)
        objects[`${parent}c${k}`] = object(`${parent}c${k}`, parent, [0, 0, 0], {
          kind: 'group',
          colliders: many(`${parent}${k}-`)
        })
    }
    for (const extra of ['x1', 'x2']) {
      objects[extra] = object(extra, 'R', [0, 0, 0.5], {
        kind: 'group',
        joint: defaultJoint('revolute')
      })
      for (let k = 0; k < 3; k++)
        objects[`${extra}c${k}`] = object(`${extra}c${k}`, extra, [0, 0, 0], {
          kind: 'group',
          colliders: many(`${extra}${k}-`)
        })
    }
    objects = { ...objects }
    const result = model(objects)
    expect(result.bodies.map((body) => body.colliders.length)).toEqual([16, 16, 16, 16, 0])
    expect(result.bodies.reduce((sum, body) => sum + body.colliders.length, 0)).toBe(
      MAX_WORLD_COLLIDERS
    )
    expect(keys(result.warnings).filter((key) => key === 'worldTooManyColliders')).toHaveLength(5)
    expect(keys(result.warnings).at(-1)).toBe('worldTooManyWorldColliders')
    expect(result.bodies[0].states.filter((state) => state.capped)).toHaveLength(2)
    expect(result.bodies[4].states.every((state) => state.capped)).toBe(true)
  })

  it('B6 같은 이름 몸체는 부모 이름을 괄호로, 그래도 같으면 #번호를 붙인다', () => {
    const objects: SceneObjects = {
      R: object('R', null, [0, 0, 0], { kind: 'robot', name: 'Arm (Side)' }),
      left: object('left', 'R', [0, 0.2, 0], { kind: 'group', name: 'Side' }),
      right: object('right', 'R', [0, -0.2, 0], { kind: 'group', name: 'Side' }),
      a1: object('a1', 'left', [0, 0, 0], {
        kind: 'group',
        name: 'Arm',
        joint: defaultJoint('revolute')
      }),
      a2: object('a2', 'right', [0, 0, 0], {
        kind: 'group',
        name: 'Arm',
        joint: defaultJoint('revolute')
      }),
      a3: object('a3', 'R', [0, 0, 0], {
        kind: 'group',
        name: 'Claw',
        joint: defaultJoint('revolute')
      })
    }
    // 관절 둘은 부모 이름을 붙여도 로봇 이름과 같아 셋 모두 #번호(섀시 #1), 이름이 하나뿐인 Claw는 그대로
    expect(model(objects).bodies.map((body) => body.name)).toEqual([
      'Arm (Side) #1',
      'Arm (Side) #2',
      'Arm (Side) #3',
      'Claw'
    ])
    // 부모 이름으로 나뉘면 번호를 붙이지 않는다
    const split = { ...objects, right: { ...objects.right, name: 'Other' } }
    expect(model(split).bodies.map((body) => body.name)).toEqual(
      ['Arm (Side)', 'Arm (Side)', 'Arm (Other)', 'Claw'].map((name, i) =>
        i < 2 ? `${name} #${i + 1}` : name
      )
    )
  })

  it('B6 관절 몸체의 편집 자세 바닥 간격(로봇 좌표 min z)', () => {
    const arm = model(robotScene()).bodies.find((body) => body.objectId === 'arm')!
    // 팔 오브젝트(리프트 오브젝트 z 0.1 + 0.2, 앵커 0) − 관 반 두께 0.01
    expect(arm.floorGap).toBeCloseTo(0.3 - 0.01, 12)
    expect(model(robotScene()).bodies[0].floorGap).toBeNull()
  })
})

describe('B7 편집 자세 겹침 무시 짝', () => {
  // 가짜 앞 계산: 받은 몸체 둘이 섀시와 팔이면 2 mm 겹침
  const fakeOverlaps = vi.fn(
    (bodies: readonly EditPoseBody[], tolerance?: number): EditPoseOverlap[] => {
      void tolerance
      const ids = bodies.map((body) => body.body)
      return ids.includes(-1) && ids.includes(1) ? [{ a: -1, b: 1, depth: 0.002 }] : []
    }
  )

  it('B7 가짜 overlaps의 짝이 무시 목록에, 바로 붙은 부모–자식 짝은 앞 계산에 보내지 않는다', () => {
    fakeOverlaps.mockClear()
    const result = model(robotScene(), { overlaps: fakeOverlaps })
    expect(result.pairs).toEqual([
      { a: -1, b: 1, aObjectId: 'R', bObjectId: 'arm', depth: 0.002, forced: false }
    ])
    // 몸체 셋(섀시·리프트·팔)의 짝 가운데 인접 둘(섀시–리프트, 리프트–팔)은 빼고 섀시–팔 하나만
    expect(fakeOverlaps).toHaveBeenCalledTimes(1)
    const [bodies, tolerance] = fakeOverlaps.mock.calls[0]
    expect(bodies.map((body) => [body.body, body.parent])).toEqual([
      [-1, -2],
      [1, 0]
    ])
    expect(tolerance).toBe(1e-3)
    // 섀시 틀은 단위, 팔 틀은 로봇 좌표 관절 틀
    expect(bodies[0].frame).toEqual({
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      origin: { x: 0, y: 0, z: 0 }
    })
    expect(bodies[1].frame.origin.z).toBeCloseTo(0.3, 12)
  })

  it('B7 forceCollide 짝은 forced(세계 설명 collisionIgnore에서 빠짐), 끊긴 id는 무시, 지금 겹치지 않는 짝은 staleForced', () => {
    const base = robotScene()
    const objects: SceneObjects = {
      ...base,
      R: {
        ...base.R,
        collision: {
          forceCollide: [
            ['R', 'arm'],
            ['R', 'lift'],
            ['deleted', 'R']
          ]
        }
      }
    }
    const result = model(objects, { overlaps: fakeOverlaps })
    expect(result.pairs.map((pair) => pair.forced)).toEqual([true])
    // R–lift는 지금 겹치지 않는다(인접이라 늘 무시), deleted는 몸체가 아니라 세지 않는다
    expect(result.staleForced).toBe(1)
    expect(staleForcePairs(objects, 'R', result)).toEqual([['R', 'lift']])
  })
})

describe('B16 몸체 단위 기억', () => {
  it('B16 이름 바꾸기·다른 몸체 편집 뒤 바뀌지 않은 몸체 결과는 같은 객체이고 앞 계산은 바뀐 몸체가 든 짝만 다시 한다', () => {
    const overlaps = vi.fn((): EditPoseOverlap[] => [])
    const cache = createCollisionModelCache()
    const objects: SceneObjects = robotScene()
    const first = model(objects, { overlaps, cache })
    expect(overlaps).toHaveBeenCalledTimes(1)
    // 섀시 판 이름 바꾸기: 형상 칸이 그대로라 모든 몸체가 같은 객체, 앞 계산 없음
    const renamed: SceneObjects = { ...objects, base: { ...objects.base, name: 'Base Plate' } }
    const second = model(renamed, { overlaps, cache })
    second.bodies.forEach((body, i) => expect(body).toBe(first.bodies[i]))
    expect(overlaps).toHaveBeenCalledTimes(1)
    // 팔 관을 옮기면 팔 몸체만 새로 만들고 섀시–팔 짝만 다시 잰다
    const moved: SceneObjects = {
      ...renamed,
      tube: {
        ...renamed.tube,
        transform: { ...renamed.tube.transform, position: [0.2, 0, 0] as V3 }
      }
    }
    const third = model(moved, { overlaps, cache })
    expect(third.bodies[0]).toBe(first.bodies[0])
    expect(third.bodies[1]).toBe(first.bodies[1])
    expect(third.bodies[2]).not.toBe(first.bodies[2])
    expect(overlaps).toHaveBeenCalledTimes(2)
    // 로봇을 옮겨도(몸체 틀 밖) 섀시 결과는 그대로
    const robotMoved = {
      ...moved,
      R: { ...moved.R, transform: { position: [1, 1, 0] as V3, rotation: [0, 0, 2] as V3 } }
    }
    expect(model(robotMoved, { overlaps, cache }).bodies[0]).toBe(first.bodies[0])
    // 기억 없이 계산한 값과 같다(결정적)
    expect(model(moved, { overlaps })).toEqual(third)
  })

  it('B16 메시 껍질 조회 결과가 바뀌면(형상 등록) 그 몸체만 다시 계산한다', () => {
    const cache = createCollisionModelCache()
    const objects = robotScene()
    const table = { ...SHAPES, plate: { kind: 'pending' } as ObjectHullPoints }
    const first = model(objects, { cache, shapes: shapesOf(table) })
    expect(first.bodies[1].source).toBe('none')
    table.plate = SHAPES.plate
    const second = model(objects, { cache, shapes: shapesOf(table) })
    expect(second.bodies[0]).toBe(first.bodies[0])
    expect(second.bodies[1].source).toBe('auto')
    expect(second.bodies[2]).toBe(first.bodies[2])
  })
})

describe('정규 껍질 한도', () => {
  it('자동 껍질은 32점, Mesh Collider 꼭짓점 한도는 64까지', () => {
    // 원기둥 옆면 점 구름(점 200)
    const points: Vec3[] = []
    for (let k = 0; k < 100; k++) {
      const a = (2 * Math.PI * k) / 100
      points.push({ x: 0.1 * Math.cos(a), y: 0.1 * Math.sin(a), z: 0 })
      points.push({ x: 0.1 * Math.cos(a), y: 0.1 * Math.sin(a), z: 0.2 })
    }
    const shapes = shapesOf({ ...SHAPES, base: { kind: 'points', points, error: 0 } })
    expect(model(robotScene(), { shapes }).bodies[0].colliders[0].hullPoints).toBe(
      HULL_DEFAULT_VERTEX_LIMIT
    )
    const objects = withColliders(robotScene(), 'base', [
      { id: 'm', kind: 'mesh', vertexLimit: 64 }
    ])
    const entry = model(objects, { shapes }).bodies[0].colliders[0]
    expect(entry.hullPoints).toBeLessThanOrEqual(MAX_HULL_POINTS)
    expect(entry.hullPoints).toBeGreaterThan(HULL_DEFAULT_VERTEX_LIMIT)
  })
})
