import { BoxGeometry } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bodyShape, type BodyShape } from '../../../shared/sim/collision3d'
import { boxHull, canonicalHull, type Hull } from '../../../shared/sim/hull'
import { PhysicsWorld } from '../../../shared/sim/world'
import { parseWorldSpec, type SimCollider, type WorldSpec } from '../../../shared/sim/worldSpec'
import { meshHullOf } from '../cad/stepImport'
import { colliderSegments } from '../editor/collider/colliderGizmoModel'
import { disposeGeometry, registerGeometry } from '../scene/geometryRegistry'
import { defaultJoint } from '../scene/joint'
import { objectHullPoints } from '../scene/meshHull'
import type { SceneObject, SceneObjects } from '../scene/model'
import type { WorldColliderBody } from './worldColliders'
import { buildWorldSpec, type WorldSpecResult } from './worldSpec'

// 5 통합 I1·I2(spec-5 §10): 렌더러 빌더(buildWorldSpec, 진짜 메시 껍질 조회 objectHullPoints와 진짜 앞 계산 editPoseOverlaps) →
// JSON → 메인과 같은 parseWorldSpec → PhysicsWorld. 시뮬레이터가 만든 형상(BodyCollision이 부르는 bodyShape의 결과)이 렌더러
// 정규 껍질(canonicalHull(V), 인스펙터 개수·기즈모 윤곽)과 꼭짓점·면·모서리까지 같고, 기즈모 선분이 그 껍질의 모서리다.

// BodyCollision이 만든 형상을 엿본다(진짜 함수 그대로 부른다)
vi.mock('../../../shared/sim/collision3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/sim/collision3d')>()
  return { ...actual, bodyShape: vi.fn(actual.bodyShape) }
})

const SETTINGS = { batteryVoltage: 12 }
type V3 = [number, number, number]

const part = (
  id: string,
  parentId: string,
  position: V3,
  rotation: V3,
  extra: Partial<SceneObject> = {}
): SceneObject => ({
  id,
  name: extra.name ?? id,
  kind: 'part',
  parentId,
  transform: { position, rotation },
  visual: { type: 'mesh', geometryId: `g:i:${id}`, color: [1, 1, 1] },
  ...extra
})

// 상자 메시(STEP 워커가 내는 메시 껍질과 함께, cad/importStep.ts와 같은 등록)
const MESHES: Record<string, V3> = {
  base: [0.4, 0.36, 0.12],
  plate: [0.05, 0.18, 0.12],
  tube: [0.22, 0.03, 0.035],
  // I2: 섀시 껍질 안에 접혀 있는 팔
  folded: [0.12, 0.04, 0.04]
}

beforeEach(() => {
  for (const [id, size] of Object.entries(MESHES)) {
    const geometry = new BoxGeometry(...size)
    geometry.computeBoundingBox()
    registerGeometry(`g:i:${id}`, geometry, {
      hull: meshHullOf(geometry.getAttribute('position').array)
    })
  }
  vi.mocked(bodyShape).mockClear()
})
afterEach(() => {
  for (const id of Object.keys(MESHES)) disposeGeometry(`g:i:${id}`)
})

// 로봇(돌린 자세) → 섀시 판 base(메시, 자동 볼록 껍질) · 리프트 관절 lift(Box Collider) → 판 plate · 팔 관절 arm(Capsule
// Collider) → 관 tube(Mesh Collider). 회전을 섞어 몸체 틀 변환을 거치게 한다
function firstTickScene(): SceneObjects {
  return {
    R: {
      id: 'R',
      name: 'Robot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0.3, -0.2, 0], rotation: [0, 0, 0.4] }
    },
    base: part('base', 'R', [0, 0, 0.08], [0, 0, 0.1]),
    lift: {
      id: 'lift',
      name: 'Lift',
      kind: 'group',
      parentId: 'R',
      transform: { position: [0.12, 0.01, 0.2], rotation: [0, 0, 0.05] },
      joint: { ...defaultJoint('prismatic'), axis: 'z' },
      colliders: [{ id: 'lb', kind: 'box', center: [0, 0, 0.05], size: [0.04, 0.2, 0.12] }]
    },
    plate: part('plate', 'lift', [0, 0, 0.05], [0, 0, 0]),
    arm: {
      id: 'arm',
      name: 'Arm',
      kind: 'group',
      parentId: 'lift',
      transform: { position: [0.04, 0, 0.18], rotation: [0, 0.3, 0] },
      joint: { ...defaultJoint('revolute'), axis: 'y' },
      colliders: [
        {
          id: 'ac',
          kind: 'capsule',
          center: [0.1, 0, 0],
          radius: 0.02,
          height: 0.25,
          direction: 'x',
          friction: 0.7
        }
      ]
    },
    tube: part('tube', 'arm', [0.12, 0, 0.01], [0.2, 0, 0.1], {
      colliders: [{ id: 'tm', kind: 'mesh', vertexLimit: 16 }]
    })
  }
}

function build(objects: SceneObjects): WorldSpecResult {
  return buildWorldSpec(objects, 'R', SETTINGS, null, null, (id) => objectHullPoints(objects, id))
}

// 메인과 같은 경로: JSON 왕복 → parseWorldSpec
function reparse(spec: WorldSpec): WorldSpec {
  const parsed = parseWorldSpec(JSON.parse(JSON.stringify(spec)))
  if (typeof parsed === 'string') throw new Error(parsed)
  return parsed
}

// 시뮬레이터가 그 충돌체(받은 객체 그대로)로 만든 형상
function simulatorShape(collider: SimCollider): BodyShape {
  const calls = vi.mocked(bodyShape).mock
  const k = calls.calls.findIndex(([argument]) => argument === collider)
  expect(k, 'BodyCollision이 이 충돌체로 bodyShape를 불렀다').toBeGreaterThanOrEqual(0)
  const result = calls.results[k]
  if (result.type !== 'return' || !result.value) throw new Error('bodyShape failed')
  return result.value
}

const topology = (hull: Hull): Pick<Hull, 'vertices' | 'faces' | 'edges'> => ({
  vertices: hull.vertices,
  faces: hull.faces,
  edges: hull.edges
})

// 껍질 모서리의 선분(기즈모 hullSegments와 같은 꼴: 모서리 순서, 끝점 a → b)
function edgeSegments(hull: Hull): number[] {
  const out: number[] = []
  for (const edge of hull.edges) {
    const a = hull.vertices[edge.a]
    const b = hull.vertices[edge.b]
    out.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
  return out
}

describe('5 통합 I1: 첫 틱(렌더러 빌더 → JSON → parseWorldSpec → PhysicsWorld)', () => {
  it('시뮬레이터 껍질 = 렌더러 정규 껍질(꼭짓점·면·모서리), 기즈모 윤곽 = 빌더 껍질, 상자·캡슐은 같은 값', () => {
    const objects = firstTickScene()
    const result = build(objects)
    const spec = result.spec!
    expect(spec).not.toBeNull()
    expect(result.warnings.map((w) => w.key)).not.toContain('worldInvalid')
    expect(
      result.colliders.map((body) => [body.body, body.objectId, body.source, body.colliders.length])
    ).toEqual([
      [-1, 'R', 'auto', 1],
      [0, 'lift', 'colliders', 1],
      [1, 'arm', 'colliders', 2]
    ])
    // 섀시 자동 껍질은 base 메시만(리프트·팔 하위는 관절 몸체), 팔은 Capsule 다음 Mesh Collider(소속 오브젝트 문서 순서)
    expect(spec.robot.colliders!.map((c) => c.kind)).toEqual(['convex'])
    expect(spec.joints[0].colliders!.map((c) => c.kind)).toEqual(['box'])
    expect(spec.joints[1].colliders!.map((c) => c.kind)).toEqual(['capsule', 'convex'])
    // 바로 붙은 부모–자식뿐이라 무시 짝이 없다(섀시 ↔ 팔은 비인접이지만 편집 자세에서 떨어져 있다)
    expect(result.ignoredPairs).toEqual([])
    expect('collisionIgnore' in spec).toBe(false)

    const parsed = reparse(spec)
    const world = new PhysicsWorld(parsed)
    world.step(0, {})
    // 몇 틱 더 돌려도(팔은 구동 없이 중력으로 내려온다) 비유한·LCP 오류가 없다
    for (let k = 1; k <= 40; k++) world.step(k * 5_000_000, {})
    expect(world.drainNotices().filter((n) => n.code === 'worldError')).toEqual([])
    const pose = world.pose()
    expect(pose.joints?.every((q) => Number.isFinite(q))).toBe(true)

    const bodies: [WorldColliderBody, SimCollider[]][] = [
      [result.colliders[0], parsed.robot.colliders!],
      [result.colliders[1], parsed.joints[0].colliders!],
      [result.colliders[2], parsed.joints[1].colliders!]
    ]
    let convex = 0
    for (const [body, simulated] of bodies) {
      expect(simulated).toHaveLength(body.colliders.length)
      body.colliders.forEach((entry, k) => {
        const shape = simulatorShape(simulated[k])
        const rendered = entry.collider
        if (rendered.kind === 'convex') {
          convex++
          if (shape.kind !== 'hull') throw new Error('convex → hull')
          // 렌더러 정규 껍질(인스펙터 개수·기즈모)과 메인이 받은 V로 다시 만든 껍질이 같다(§1.11 정규 입력)
          expect(entry.hull).not.toBeNull()
          expect(topology(shape.hull)).toEqual(topology(entry.hull!))
          expect(entry.hullPoints).toBe(shape.hull.vertices.length)
          // JSON 왕복한 V라 다른 배열이다(같은 객체를 나눠 쓴 것이 아니라 같은 함수로 다시 만들었다)
          expect(simulated[k]).not.toBe(rendered)
          expect(canonicalHull(simulated[k].kind === 'convex' ? simulated[k].points : [])).toBe(
            shape.hull
          )
          // 기즈모 윤곽 = 빌더 껍질 모서리 = 시뮬레이터 껍질 모서리
          expect(colliderSegments(rendered, entry.hull)).toEqual(edgeSegments(shape.hull))
        } else if (rendered.kind === 'box') {
          if (shape.kind !== 'hull') throw new Error('box → hull')
          expect(topology(shape.hull)).toEqual(
            topology(boxHull(rendered.center, rendered.rotation, rendered.half))
          )
          expect(colliderSegments(rendered)).toEqual(edgeSegments(shape.hull))
        } else {
          if (shape.kind !== 'capsule') throw new Error('capsule → capsule')
          expect([shape.a, shape.b, shape.r, shape.friction]).toEqual([
            rendered.a,
            rendered.b,
            rendered.radius,
            rendered.friction
          ])
          expect(shape.sphere).toBe(false)
        }
      })
    }
    // 섀시 자동 껍질과 관의 Mesh Collider
    expect(convex).toBe(2)
    // 관 Mesh Collider의 꼭짓점 한도(16)는 V에서 지켜지고, 정규 껍질은 그 V의 껍질이다
    const tube = spec.joints[1].colliders![1]
    expect(tube.kind === 'convex' && tube.points.length).toBeLessThanOrEqual(16)
    // 캡슐 마찰은 Collider 칸 그대로, 자동 껍질은 기본 0.4
    expect(spec.joints[1].colliders![0].friction).toBe(0.7)
    expect(spec.robot.colliders![0].friction).toBe(0.4)
  })
})

describe('5 통합 I2: 앞 계산(진짜 editPoseOverlaps)', () => {
  // 로봇 → 섀시 판 base(큰 상자 메시) · 리프트 관절 lift → 팔 관절 arm → 접은 팔 메시 folded(섀시 판 안쪽)
  function foldedScene(): SceneObjects {
    return {
      R: {
        id: 'R',
        name: 'Robot',
        kind: 'robot',
        parentId: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
      },
      base: part('base', 'R', [0, 0, 0.08], [0, 0, 0]),
      lift: {
        id: 'lift',
        name: 'Lift',
        kind: 'group',
        parentId: 'R',
        transform: { position: [0.05, 0, 0.1], rotation: [0, 0, 0] },
        joint: { ...defaultJoint('prismatic'), axis: 'z' },
        colliders: [{ id: 'lb', kind: 'box', center: [0, 0, 0.2], size: [0.02, 0.02, 0.02] }]
      },
      arm: {
        id: 'arm',
        name: 'Arm',
        kind: 'group',
        parentId: 'lift',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        joint: { ...defaultJoint('revolute'), axis: 'y' }
      },
      folded: part('folded', 'arm', [-0.05, 0, 0], [0, 0, 0])
    }
  }

  it('접은 팔이 섀시 자동 껍질 안이면 무시 짝이고, 섀시에 접은 팔 자리를 비운 Box Collider를 붙이면 사라진다', () => {
    const objects = foldedScene()
    const result = build(objects)
    // 팔(관절 1, 부모는 리프트)과 섀시는 비인접이고, 접은 팔 메시(z 0.08–0.12)가 섀시 판(z 0.02–0.14) 안이다
    expect(result.colliders.map((body) => [body.body, body.source])).toEqual([
      [-1, 'auto'],
      [0, 'colliders'],
      [1, 'auto']
    ])
    expect(result.ignoredPairs).toHaveLength(1)
    const [pair] = result.ignoredPairs
    expect([pair.a, pair.b, pair.aObjectId, pair.bObjectId, pair.forced]).toEqual([
      -1,
      1,
      'R',
      'arm',
      false
    ])
    // 깊이: 섀시 판(z 0.02–0.14) 안의 팔 상자(z 0.08–0.12)를 가장 얕은 축(위)으로 빼내는 거리 0.14 − 0.08
    expect(pair.depth).toBeCloseTo(0.06, 9)
    expect(result.spec!.collisionIgnore).toEqual([[-1, 1]])
    // 메인이 다시 검사해도 그대로다
    expect(reparse(result.spec!).collisionIgnore).toEqual([[-1, 1]])

    // 섀시 뒤쪽만 덮는 Box Collider(x −0.2…−0.15, 접은 팔 x −0.06…0.06보다 뒤): 자동 껍질이 꺼지고 겹침이 없어 다시 충돌한다
    const separated: SceneObjects = {
      ...objects,
      R: {
        ...objects.R,
        colliders: [
          { id: 'back', kind: 'box', center: [-0.175, 0, 0.08], size: [0.05, 0.36, 0.12] }
        ]
      }
    }
    const after = build(separated)
    expect(after.colliders[0].source).toBe('colliders')
    expect(after.ignoredPairs).toEqual([])
    expect('collisionIgnore' in after.spec!).toBe(false)

    // [그래도 충돌]은 무시 목록에서만 빼고 짝은 인스펙터 목록에 남는다
    const forced = build({
      ...objects,
      R: { ...objects.R, collision: { forceCollide: [['R', 'arm']] } }
    })
    expect(forced.ignoredPairs.map((p) => p.forced)).toEqual([true])
    expect('collisionIgnore' in forced.spec!).toBe(false)
  })
})
