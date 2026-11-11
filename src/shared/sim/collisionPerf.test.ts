import { describe, expect, it, vi } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { resolveServoParams } from './actuatorData'
import { Articulation, type ContactSet } from './articulation'
import { BodyCollision } from './bodyCollision'
import {
  bodyShape,
  collideShapes,
  editPoseOverlaps,
  placeShape,
  type EditPoseBody
} from './collision3d'
import { HALF, HUB_SIGN, mecanum, outputs, robotSpec, TAG, TICK, ZERO } from './driveTestkit'
import { resolveSeason } from './seasons/seasons'
import { testMotorParams } from './testkit'
import { PhysicsWorld } from './world'
import {
  parseWorldSpec,
  type SimCollider,
  type SimJointSpec,
  type SimMotorSpec,
  type Vec3,
  type WorldSpec
} from './worldSpec'

// 5 성능(spec-5 §12, A21): 로그(중앙값·p99·행 수 분포)와 CI 상한. 목표는 로그로만 본다(CI 기계가 느릴 수 있다).

const BIOBUZZ = resolveSeason('biobuzz')
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const LIFT_PARAMS = testMotorParams(TAG, 19.2)

// 렌더러가 보내는 꼴의 유사 볼록 점 n개(0.1 mm 격자): 초타원체 |x/a|^p + |y/b|^p + |z/c|^p = 1(p = 1/0.3, 상자에 가까운
// 둥근 상자) 위의 피보나치 점. 모두 껍질 꼭짓점이다
function roundedBox(center: Vec3, half: Vec3, n: number, friction = 0.4): SimCollider {
  const points: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  const shape = (v: number): number => Math.sign(v) * Math.abs(v) ** 0.3
  const grid = (v: number): number => Math.round(v * 10000) / 10000
  for (let k = 0; k < n; k++) {
    const z = 1 - (2 * (k + 0.5)) / n
    const r = Math.sqrt(1 - z * z)
    const t = golden * k
    points.push({
      x: grid(center.x + half.x * shape(r * Math.cos(t))),
      y: grid(center.y + half.y * shape(r * Math.sin(t))),
      z: grid(center.z + half.z * shape(z))
    })
  }
  return { kind: 'convex', points, friction }
}

const quantile = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

// §11 장면의 판: 섀시·리프트·팔·손목 모두 32점 둥근 상자, 손목(팔 끝, 축 팔 x)
function perfScene(): { spec: WorldSpec; out: (k: number) => Record<string, DeviceValues> } {
  const base = robotSpec(
    { start: { x: 0.25, y: -(BIOBUZZ.perimeter.innerHalf - HALF - 0.4), yaw: -Math.PI / 2 } },
    { field: { season: 'biobuzz', hiveTipped: [false, false] } }
  )
  const lift: SimJointSpec = {
    parent: -1,
    type: 'prismatic',
    origin: { position: { x: 0, y: 0, z: 0.1 }, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: { lower: 0, upper: 0.4 },
    body: { mass: 1.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
    friction: { coulomb: 1, viscous: 0 },
    spring: null,
    drive: {
      kind: 'motor',
      devices: ['lift'],
      ratio: 0.112 / (2 * Math.PI),
      params: LIFT_PARAMS,
      rigging: { kind: 'direct' }
    },
    switches: [],
    colliders: [roundedBox(ZERO, { x: 0.02, y: 0.15, z: 0.09 }, 32)]
  }
  const arm: SimJointSpec = {
    parent: 0,
    type: 'revolute',
    origin: { position: { x: 0.27, y: 0, z: 0.15 }, rotation: ZERO },
    axis: { x: 0, y: 1, z: 0 },
    limits: { lower: -0.6, upper: 1.4 },
    body: {
      mass: 0.3,
      centerOfMass: { x: 0.125, y: 0, z: 0 },
      inertia: [2e-5, 1.6e-3, 1.6e-3, 0, 0, 0]
    },
    friction: { coulomb: 0.02, viscous: 0.001 },
    spring: null,
    drive: {
      kind: 'servo',
      device: 'armServo',
      ratio: 1,
      params: resolveServoParams('gobildaTorque', 'servo'),
      zeroPulseUs: 1500,
      direction: 1
    },
    switches: [],
    colliders: [roundedBox({ x: 0.13, y: 0, z: 0 }, { x: 0.15, y: 0.02, z: 0.02 }, 32)]
  }
  const wrist: SimJointSpec = {
    parent: 1,
    type: 'revolute',
    origin: { position: { x: 0.26, y: 0, z: 0 }, rotation: ZERO },
    axis: { x: 1, y: 0, z: 0 },
    limits: { lower: -0.5, upper: 0.5 },
    body: {
      mass: 0.1,
      centerOfMass: { x: 0.03, y: 0, z: 0 },
      inertia: [1e-5, 1e-5, 1e-5, 0, 0, 0]
    },
    friction: { coulomb: 0.02, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: [],
    colliders: [roundedBox({ x: 0.02, y: 0, z: 0 }, { x: 0.02, y: 0.025, z: 0.025 }, 32)]
  }
  const spec: WorldSpec = {
    ...base,
    robot: {
      ...base.robot,
      colliders: [roundedBox({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 }, 32)]
    },
    motors: [...base.motors, liftMotor('lift')],
    joints: [lift, arm, wrist]
  }
  const on: DeviceValues = { position: 0.5, pulseUs: 1500, pwm: true }
  const out = (k: number): Record<string, DeviceValues> => {
    if (k < 80)
      return { ...outputs({}), lift: liftOut(0), armServo: { ...on, pulseUs: null, pwm: false } }
    if (k < 140) return { ...outputs({}), lift: liftOut(0), armServo: on }
    if (k < 260) return { ...outputs(mecanum(0.3, 0, 0)), lift: liftOut(0), armServo: on }
    if (k < 360) return { ...outputs(mecanum(0.1, 0, 0)), lift: liftOut(0.8), armServo: on }
    if (k < 540) return { ...outputs(mecanum(0.6, 0, 0)), lift: liftOut(-0.1), armServo: on }
    if (k < 640) return { ...outputs(mecanum(0, -0.5, 0)), lift: liftOut(0), armServo: on }
    return { ...outputs({}), lift: liftOut(0), armServo: on }
  }
  return { spec, out }
}
function liftMotor(device: string): SimMotorSpec {
  return { device, modelTag: TAG, gearbox: 19.2, directionSign: 1, params: LIFT_PARAMS }
}
function liftOut(power: number): DeviceValues {
  return {
    mode: 'RUN_WITHOUT_ENCODER',
    power: power * HUB_SIGN,
    velocity: null,
    enabled: true,
    zeroPower: 'BRAKE',
    targetPosition: null,
    encoderOffset: 0
  }
}

describe('A21 성능', () => {
  it('A21 하위 단계(형상 있음): 메카넘 4 + 관절 3, 32점 볼록 넷, 빨강 벽 + FLOWER + 팔 바닥·벽 윗면(목표 중앙값 0.5 ms·p99 2 ms, CI 5·10 ms)', () => {
    const { spec, out } = perfScene()
    const keys = new Set<string>()
    const rowCounts: number[] = []
    const original = Articulation.prototype.step
    vi.spyOn(Articulation.prototype, 'step').mockImplementation(function (
      this: Articulation,
      h: number,
      drive: Parameters<Articulation['step']>[1],
      contacts?: ContactSet
    ) {
      const collision = (contacts?.rows ?? []).filter((r) => r.key.startsWith('c'))
      rowCounts.push(collision.length)
      for (const row of collision)
        if (row.key.startsWith('cn.')) keys.add(row.key.split('.').slice(0, 2).join('.'))
      return original.call(this, h, drive, contacts)
    })
    const world = new PhysicsWorld(spec)
    const times: number[] = []
    for (let k = 0; k < 680; k++) {
      const start = performance.now()
      world.step(k * TICK, out(k))
      // 5 ms 틱 = 하위 단계 다섯
      if (k > 0) times.push((performance.now() - start) / 5)
    }
    vi.restoreAllMocks()
    expect(world.drainNotices().filter((n) => n.code === 'worldError')).toEqual([])
    times.sort((a, b) => a - b)
    const median = quantile(times, 0.5)
    const p99 = quantile(times, 0.99)
    const histogram = new Map<number, number>()
    for (const n of rowCounts) {
      const bucket = Math.floor(n / 4) * 4
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1)
    }
    const distribution = [...histogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, c]) => `${b}–${b + 3}:${c}`)
      .join(' ')
    console.info(
      `5 성능: 하위 단계 중앙값 ${median.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, 충돌 행 수 분포 ${distribution} (메카넘 4 + 관절 3, 32점 볼록 넷)`
    )
    // 덮으려는 접촉: 팔·손목의 바닥과 벽(판·윗면), 섀시의 벽과 FLOWER <3>
    const has = (pattern: RegExp): boolean => [...keys].some((k) => pattern.test(k))
    expect(has(/^cn\.j[12]k0\/fl$/)).toBe(true)
    expect(has(/^cn\.j[12]k0\/w3$/)).toBe(true)
    expect(keys.has('cn.rk0/w3')).toBe(true)
    expect(keys.has('cn.rk0/s11')).toBe(true)
    expect(Math.max(...rowCounts)).toBeLessThanOrEqual(28)
    expect(median).toBeLessThan(5)
    expect(p99).toBeLessThan(10)
  })

  it('A21 좁은 단계: 32점 껍질 둘 전체 SAT(목표 0.3 ms), 64점 둘(기록)', () => {
    const time = (n: number): number => {
      const a = bodyShape(roundedBox(ZERO, { x: 0.1, y: 0.06, z: 0.04 }, n))!
      const b = bodyShape(roundedBox(ZERO, { x: 0.08, y: 0.08, z: 0.05 }, n))!
      // b를 조금 돌려 a 위에 걸친다(면·모서리 질의가 모두 돈다)
      const c = Math.cos(0.4)
      const s = Math.sin(0.4)
      const pa = placeShape(a, { rotation: I, origin: ZERO })
      const pb = placeShape(b, {
        rotation: [c, -s, 0, s, c, 0, 0, 0, 1],
        origin: { x: 0.05, y: 0.02, z: 0.088 }
      })
      const samples: number[] = []
      for (let k = 0; k < 300; k++) {
        const start = performance.now()
        const result = collideShapes(pa, pb, 1e-3, null)
        samples.push(performance.now() - start)
        expect(result.manifold).not.toBeNull()
      }
      samples.sort((x, y) => x - y)
      return quantile(samples, 0.5)
    }
    const t32 = time(32)
    const t64 = time(64)
    console.info(
      `5 성능: 좁은 단계 전체 SAT 중앙값 32점 ${t32.toFixed(4)} ms, 64점 ${t64.toFixed(4)} ms`
    )
    expect(t32).toBeLessThan(3)
  })

  it('A21 생성자: 충돌체 64개(64점) 검사(parseWorldSpec) + 생성(BodyCollision)(목표 30 ms, CI 300 ms)', () => {
    const base = robotSpec(
      { start: { x: 0, y: 0, yaw: 0 } },
      { field: { season: 'biobuzz', hiveTipped: [false, false] } }
    )
    // 관절 15개 × 4 + 섀시 4 = 64
    const joints: SimJointSpec[] = Array.from({ length: 15 }, (_, i) => ({
      parent: i - 1,
      type: 'revolute',
      origin: { position: { x: 0.02, y: 0, z: 0.01 }, rotation: ZERO },
      axis: { x: 0, y: 0, z: 1 },
      limits: null,
      body: { mass: 0.1, centerOfMass: ZERO, inertia: [1e-4, 1e-4, 1e-4, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [0, 1, 2, 3].map((c) =>
        roundedBox({ x: 0.01 * c, y: 0, z: 0.3 }, { x: 0.02, y: 0.015, z: 0.01 }, 64)
      )
    }))
    const spec: WorldSpec = {
      ...base,
      robot: {
        ...base.robot,
        colliders: [0, 1, 2, 3].map((c) =>
          roundedBox({ x: 0, y: 0.05 * c - 0.075, z: 0.1 }, { x: HALF, y: 0.03, z: 0.1 }, 64)
        )
      },
      joints
    }
    const text = JSON.parse(JSON.stringify(spec))
    const samples: number[] = []
    for (let k = 0; k < 5; k++) {
      const start = performance.now()
      const parsed = parseWorldSpec(text)
      if (typeof parsed === 'string') throw new Error(parsed)
      new BodyCollision(parsed, BIOBUZZ)
      samples.push(performance.now() - start)
    }
    samples.sort((x, y) => x - y)
    const median = quantile(samples, 0.5)
    console.info(`5 성능: 충돌체 64개(64점) 검사 + 생성 중앙값 ${median.toFixed(2)} ms`)
    expect(median).toBeLessThan(300)
  })

  it('A21 앞 계산: editPoseOverlaps 몸체 16 × 충돌체 4(목표 20 ms, CI 200 ms)', () => {
    // 고리처럼 이어진 몸체 16개(이웃만 부모–자식), 충돌체는 서로 조금씩 겹치는 둥근 상자 넷
    const bodies: EditPoseBody[] = Array.from({ length: 16 }, (_, i) => {
      const angle = (2 * Math.PI * i) / 16
      return {
        body: i - 1,
        parent: i - 2,
        frame: {
          rotation: [
            Math.cos(angle),
            -Math.sin(angle),
            0,
            Math.sin(angle),
            Math.cos(angle),
            0,
            0,
            0,
            1
          ],
          origin: { x: 0.25 * Math.cos(angle), y: 0.25 * Math.sin(angle), z: 0.2 }
        },
        colliders: [0, 1, 2, 3].map((c) =>
          roundedBox({ x: 0.03 * c, y: 0, z: 0 }, { x: 0.05, y: 0.05, z: 0.04 }, 32)
        )
      }
    })
    const samples: number[] = []
    let found = 0
    for (let k = 0; k < 5; k++) {
      const start = performance.now()
      found = editPoseOverlaps(bodies).length
      samples.push(performance.now() - start)
    }
    samples.sort((x, y) => x - y)
    const median = quantile(samples, 0.5)
    console.info(
      `5 성능: editPoseOverlaps 16 × 4 중앙값 ${median.toFixed(2)} ms (겹친 짝 ${found})`
    )
    expect(found).toBeGreaterThan(0)
    expect(median).toBeLessThan(200)
  })
})
