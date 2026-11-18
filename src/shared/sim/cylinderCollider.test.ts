import { describe, expect, it } from 'vitest'
import { bodyShape, CYLINDER_COLLIDER_SIDES, cylinderColliderPoints } from './collision3d'
import { WALL_INNER_HALF } from './field'
import { TEST_ROBOT_HEIGHT, testChassis, worldV4Defaults } from './testkit'
import { PhysicsWorld } from './world'
import {
  WORLD_SPEC_VERSION,
  type SimCollider,
  type SimJointSpec,
  type WorldSpec
} from './worldSpec'

// 원기둥 충돌체(6a, Unity에 없는 임시 편차): 공이 아닌 짝(바닥·벽·구조물·자기 충돌)은 외접 32각 기둥 껍질로 근사한다
// (collision3d.ts cylinderColliderPoints → prismHull). 공과의 짝은 elements/ballContact.ts sphereCylinder(정확)다.

const ZERO = { x: 0, y: 0, z: 0 }
const R = 0.05
// 외접 다각형 반지름(변이 원에 닿는다): R / cos(π/32)
const BIG = R / Math.cos(Math.PI / CYLINDER_COLLIDER_SIDES)

const cylinder = (a = { x: 0, y: -0.04, z: 0 }, b = { x: 0, y: 0.04, z: 0 }): SimCollider => ({
  kind: 'cylinder',
  a,
  b,
  radius: R,
  friction: 0.4
})

// 고정 기저 로봇(원점) + 직선 관절 하나(축 axis, 마찰 없음, 구동 없음)에 원기둥 충돌체
function rig(
  axis: { x: number; y: number; z: number },
  origin: { x: number; y: number; z: number }
): WorldSpec {
  const joint: SimJointSpec = {
    parent: -1,
    type: 'prismatic',
    origin: { position: origin, rotation: ZERO },
    axis,
    limits: null,
    body: { mass: 0.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: [],
    colliders: [cylinder()]
  }
  return {
    version: WORLD_SPEC_VERSION,
    ...worldV4Defaults(),
    robot: {
      start: { x: 0, y: 0, yaw: 0 },
      footprint: [
        { x: 0.1, y: 0.1 },
        { x: -0.1, y: 0.1 },
        { x: -0.1, y: -0.1 },
        { x: 0.1, y: -0.1 }
      ],
      height: TEST_ROBOT_HEIGHT,
      body: testChassis()
    },
    batteryVoltage: 12,
    hubs: [],
    motors: [],
    wheels: [],
    deadWheels: [],
    pinpoints: [],
    otos: [],
    imus: [],
    joints: [joint]
  }
}

describe('원기둥 충돌체(6a)', () => {
  it('외접 32각 기둥 64점: 고리마다 32점이 반지름 R/cos(π/32)이고 변 가운데는 R이다', () => {
    const points = cylinderColliderPoints({ x: 0, y: -0.04, z: 0 }, { x: 0, y: 0.04, z: 0 }, R)
    expect(points).toHaveLength(2 * CYLINDER_COLLIDER_SIDES)
    for (const p of points) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(BIG, 12)
      expect(Math.abs(p.y)).toBeCloseTo(0.04, 15)
    }
    const mid = { x: (points[0].x + points[1].x) / 2, z: (points[0].z + points[1].z) / 2 }
    expect(Math.hypot(mid.x, mid.z)).toBeCloseTo(R, 12)
    const shape = bodyShape(cylinder())
    expect(shape?.kind).toBe('hull')
    if (shape?.kind !== 'hull') return
    expect(shape.hull.vertices).toHaveLength(64)
    expect(shape.hull.faces).toHaveLength(2 + CYLINDER_COLLIDER_SIDES)
    expect(shape.radius).toBeCloseTo(Math.hypot(BIG, 0.04), 12)
  })

  it('떨어지는 원기둥(축 y) 몸체는 바닥에서 꼭짓점 높이 R/cos(π/32)로 멈춘다', () => {
    const world = new PhysicsWorld(rig({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0.2 }))
    for (let k = 0; k < 200; k++) world.step(k * 5_000_000, {})
    const q = world.pose().joints?.[0] ?? 0
    // 고리의 첫 꼭짓점이 아래(−z)라 중심 높이 = BIG
    expect(0.2 + q).toBeGreaterThan(BIG - 1e-4)
    expect(0.2 + q).toBeLessThan(BIG + 1e-3)
    expect(world.drainNotices().filter((n) => n.code === 'worldError')).toEqual([])
  })

  it('일정한 힘으로 벽(+x) 쪽으로 미는 원기둥(축 y)은 꼭짓점이 벽 안쪽 면에 닿아 멈춘다', () => {
    const start = WALL_INNER_HALF - 0.2
    const spec = rig({ x: 1, y: 0, z: 0 }, { x: start, y: 0, z: 0.2 })
    spec.joints[0].spring = { kind: 'constantForce', force: 5 }
    const world = new PhysicsWorld(spec)
    let farthest = -Infinity
    for (let k = 0; k < 300; k++) {
      world.step(k * 5_000_000, {})
      farthest = Math.max(farthest, start + (world.pose().joints?.[0] ?? 0))
    }
    // 고리의 +x 끝이 꼭짓점이라 중심 = 벽 − R/cos(π/32), 침투 없음
    const center = start + (world.pose().joints?.[0] ?? 0)
    expect(center).toBeCloseTo(WALL_INNER_HALF - BIG, 4)
    expect(farthest).toBeLessThan(WALL_INNER_HALF - BIG + 1e-6)
    expect(world.drainNotices().filter((n) => n.code === 'worldError')).toEqual([])
  })
})
