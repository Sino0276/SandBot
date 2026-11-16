import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceValues } from '../../sidecarProtocol'
import { resolveServoParams } from '../actuatorData'
import { Articulation, type ContactRow, type DriveForces } from '../articulation'
import { cylinderColliderPoints } from '../collision3d'
import { HALF, HUB_SIGN, mecanum, outputs, robotSpec, TAG } from '../driveTestkit'
import { GRAVITY } from '../physics'
import { resolveSeason } from '../seasons/seasons'
import { testMotorParams } from '../testkit'
import type { SimCollider, SimElementState, SimJointSpec, WorldSpec } from '../worldSpec'
import { BodyCollision } from '../bodyCollision'
import { PhysicsWorld } from '../world'
import { CONTACT_STIFFNESS_PER_PLATE, MAX_COUPLED_ROWS } from './elementData'
import {
  ball,
  ballField,
  ballWorldSpec,
  BallRunner,
  speed,
  withElementType
} from './elementTestkit'
import { ElementWorld } from './elementWorld'

// 로봇과 공의 양방향 결합(6a, spec-6a §2.5·§6): 섀시가 미는 공, CR 서보 롤러 인테이크, 플라이휠 + 고정 면(원기둥과 64점 볼록 비교),
// 모터 플라이휠 회복, 섬 실패 가두기, 결합 한도.

const POLLEN = resolveSeason('biobuzz').elements!.types.find((t) => t.kind === 'pollen')!
const r = POLLEN.radius
const m = POLLEN.mass
const K = CONTACT_STIFFNESS_PER_PLATE * POLLEN.contact.plateStiffness
const ZERO = { x: 0, y: 0, z: 0 }
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const WIDE = ballField({}, 10)

afterEach(() => {
  ElementWorld.islandHook = null
  vi.restoreAllMocks()
})

const zeroDrive = (z: readonly number[]): DriveForces => ({
  force: z.map(() => 0),
  damping: z.map(() => 0),
  stiffness: z.map(() => 0),
  boxLo: z.map(() => 0),
  boxHi: z.map(() => 0),
  regions: ''
})

// 고정 기저 로봇(원점, 요 0)과 관절·섀시 충돌체
function rig(
  joints: SimJointSpec[],
  colliders: SimCollider[] = [],
  change: Partial<WorldSpec> = {}
): WorldSpec {
  const base = ballWorldSpec()
  return ballWorldSpec({
    robot: { ...base.robot, start: { x: 0, y: 0, yaw: 0 }, colliders },
    joints,
    ...change
  })
}

const box = (center: { x: number; y: number; z: number }, half: typeof center): SimCollider => ({
  kind: 'box',
  center,
  rotation: I3,
  half,
  friction: 0.4
})

// Articulation과 ElementWorld만으로 하위 단계를 돈다(world.ts와 같은 순서: 접촉 틀 → 공 행 → art.step → 공 마무리). each는 공
// 마무리 뒤(공·로봇 자세가 같은 하위 단계 끝)에 부른다
function stepRig(
  art: Articulation,
  ew: ElementWorld,
  steps: number,
  each?: (rows: readonly ContactRow[]) => void
): void {
  const h = 0.001
  for (let k = 0; k < steps; k++) {
    const frames = art.contactFrames()
    const made = ew.prepare(art, frames, h)
    art.step(h, zeroDrive, { rows: made.rows, damping: [], elements: made.coupled })
    ew.finish(art, h, false, (k + 1) * 1e6)
    each?.(made.rows)
  }
}

describe('로봇–공 결합(6a)', () => {
  it('미는 판(마찰 없는 직선 관절)과 공의 운동량은 결합 풀이에서 그대로이고 로봇 반발 계수로 튄다', () => {
    const M = 2
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: M, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [box({ x: 0, y: 0, z: 0.3 }, { x: 0.05, y: 0.1, z: 0.3 })]
    }
    const spec = rig([pusher])
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = 1
    // 공중의 공(바닥 접촉 없음): 수평 운동량은 판과 공 사이 충격만 바꾼다
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: 0.1, y: 0, z: 0.3 })],
      air: false,
      sleep: false
    })
    const momentum = (): number => M * art.v[0] + m * ew.snapshot()[0].velocity.x
    const p0 = momentum()
    let deepest = Infinity
    stepRig(art, ew, 40, () => {
      const s = ew.snapshot()[0]
      deepest = Math.min(deepest, s.position.x - r - (0.05 + art.z[0]))
    })
    expect(Math.abs(momentum() / p0 - 1)).toBeLessThan(1e-9)
    // 판이 잃은 운동량 = 공이 얻은 운동량
    const ballV = ew.snapshot()[0].velocity.x
    expect(Math.abs((M * (1 - art.v[0])) / (m * ballV) - 1)).toBeLessThan(0.01)
    // 반발 e_robot: 상대 속도 1 → 뒤 상대 속도 e
    expect(ballV - art.v[0]).toBeCloseTo(POLLEN.contact.restitution.robot, 6)
    expect(deepest).toBeGreaterThan(-1e-3)
  })

  it('섀시가 미는 공은 로봇 속도로 구르고(ω = v/r) 1 mm보다 덜 파고든다', () => {
    const spec = robotSpec(
      { start: { x: -1.2, y: 0, yaw: 0 } },
      {
        field: { season: 'biobuzz', hiveTipped: [false, false] },
        robot: {
          ...robotSpec().robot,
          start: { x: -1.2, y: 0, yaw: 0 },
          colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 })]
        },
        elements: { groups: [], preloads: [] }
      }
    )
    const front = -1.2 + HALF
    const run = new BallRunner(spec, {
      field: ballField(),
      elements: { initial: [ball('pollen', { x: front + 0.1, y: 0, z: r })], sleep: false }
    })
    let deepest = Infinity
    run.run(
      1.5,
      () => outputs(mecanum(0.4, 0, 0)),
      () => {
        const pose = run.world.pose()
        const s = run.last()[0]
        deepest = Math.min(deepest, s.position.x - r - (pose.x + HALF))
      }
    )
    const a = run.k - 21
    const poses: number[] = []
    const xs: number[] = []
    // 마지막 0.1 s 평균 속도
    const robot = run.world.pose().x
    void robot
    const s = run.last()[0]
    const before = run.snapshots[a][0]
    const ballSpeed = (s.position.x - before.position.x) / (20 * 0.005)
    void poses
    void xs
    expect(ballSpeed).toBeGreaterThan(0.3)
    expect(Math.abs(s.velocity.x / ballSpeed - 1)).toBeLessThan(0.02)
    expect(Math.abs(s.angularVelocity.y / (s.velocity.x / r) - 1)).toBeLessThan(0.05)
    expect(deepest).toBeGreaterThan(-1e-3)
    // 공은 섀시 앞면에 붙어 있다(로봇과 같이 간다)
    expect(s.position.x - r - (run.world.pose().x + HALF)).toBeLessThan(1e-3)
  })

  it('CR 서보 롤러 인테이크가 공을 뒤판까지 끌어당기고 뒤판 법선 힘은 k·δ다(±5%)', () => {
    const R = 0.03
    const squeeze = 0.004
    const params = resolveServoParams('gobildaSpeed', 'crServo')
    const roller: SimJointSpec = {
      parent: -1,
      type: 'revolute',
      origin: { position: { x: 0, y: 0, z: 2 * r + R - squeeze }, rotation: ZERO },
      axis: { x: 0, y: 1, z: 0 },
      limits: null,
      body: { mass: 0.05, centerOfMass: ZERO, inertia: [2e-5, 2e-5, 2e-5, 0, 0, 0] },
      friction: { coulomb: 0.02, viscous: 0.001 },
      spring: null,
      drive: { kind: 'crServo', device: 'intake', ratio: 1, params, direction: 1 },
      switches: [],
      colliders: [
        {
          kind: 'cylinder',
          a: { x: 0, y: -0.06, z: 0 },
          b: { x: 0, y: 0.06, z: 0 },
          radius: R,
          friction: 1
        }
      ]
    }
    // 뒤판: 앞면 x = −0.04(바닥에서 0.2 m까지). 공이 뒤판에 닿아도 롤러 아래에 눌려 있다
    const back = -0.04
    const spec = rig(
      [roller],
      [box({ x: back - 0.01, y: 0, z: 0.1 }, { x: 0.01, y: 0.1, z: 0.1 })],
      {
        motors: []
      }
    )
    const keys: string[] = []
    const impulses: number[] = []
    const original = Articulation.prototype.step
    vi.spyOn(Articulation.prototype, 'step').mockImplementation(function (
      this: Articulation,
      h,
      drive,
      contacts
    ) {
      original.call(this, h, drive, contacts)
      keys.length = 0
      impulses.length = 0
      for (const row of contacts?.rows ?? []) {
        keys.push(row.key)
        impulses.push(this.contactImpulse(row.key) / h)
      }
    })
    const run = new BallRunner(spec, {
      field: WIDE,
      elements: {
        // 롤러 앞에 막 닿은 자리(가운데 거리 R + r)
        initial: [ball('pollen', { x: 0.022, y: 0, z: r })],
        sleep: false
      }
    })
    run.run(1.5, () => ({ intake: { position: 0, power: 0, pulseUs: 2400, pwm: true } }))
    const s = run.last()[0]
    const separation = s.position.x - r - back
    // 뒤판에 닿았다(로봇 섬: 롤러에 닿은 공의 뒤판 행이 로봇 LCP에 있다)
    expect(separation).toBeLessThan(0)
    expect(speed(s.velocity)).toBeLessThan(1e-3)
    const force = impulses[keys.indexOf('gn.e0/rk0')]
    expect(Math.abs(force / (K * -separation) - 1)).toBeLessThan(0.05)
    // 롤러가 공을 누르고 있다(롤러 접촉 법선 힘 > 0)
    expect(impulses[keys.indexOf('gn.e0/j0k0')]).toBeGreaterThan(0)
  })

  // 플라이휠(마찰 없는 자유 회전, 축 y)과 바닥(고정 면) 사이에 squeeze만큼 눌린 공. 공은 플라이휠 아래 축선 바로 앞에서 쉬는
  // 상태로 시작한다(축선 뒤에서 들어오면 눌린 법선 힘이 공을 뒤로 밀어 플라이휠이 더 느려진다: 이상 공식의 가정 밖)
  function flywheel(collider: 'cylinder' | 'mesh'): {
    w0: number
    w1: number
    exit: number
    generalized: number
    energy: [number, number]
  } {
    const field = withElementType(WIDE, 'pollen', (t) => ({
      ...t,
      contact: { ...t.contact, rollingResistance: 0, spinRadius: 0 }
    }))
    const R = 0.05
    const W = 0.04
    const If = 1e-4
    const squeeze = 0.006
    const a = { x: 0, y: -W / 2, z: 0 }
    const b = { x: 0, y: W / 2, z: 0 }
    const wheel: SimJointSpec = {
      parent: -1,
      type: 'revolute',
      origin: { position: { x: 0, y: 0, z: 2 * r - squeeze + R }, rotation: ZERO },
      axis: { x: 0, y: 1, z: 0 },
      limits: null,
      body: { mass: 0.2, centerOfMass: ZERO, inertia: [If, If, If, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [
        collider === 'cylinder'
          ? { kind: 'cylinder', a, b, radius: R, friction: 0.4 }
          : { kind: 'convex', points: cylinderColliderPoints(a, b, R), friction: 0.4 }
      ]
    }
    const spec = rig([wheel])
    const art = new Articulation(spec.joints)
    const w0 = -100
    art.v[0] = w0
    const ew = new ElementWorld(spec, field, {
      initial: [ball('pollen', { x: -0.01, y: 0, z: r })],
      air: false,
      sleep: false
    })
    const total = (): number => {
      const s = ew.snapshot()[0]
      const w = s.angularVelocity
      return (
        0.5 * If * art.v[0] ** 2 +
        0.5 * m * speed(s.velocity) ** 2 +
        0.5 * POLLEN.inertia * (w.x * w.x + w.y * w.y + w.z * w.z) +
        m * GRAVITY * s.position.z
      )
    }
    const e0 = total()
    let generalized = 0
    stepRig(art, ew, 80, (rows) => {
      for (const row of rows) generalized += row.j[0] * art.contactImpulse(row.key)
    })
    return {
      w0,
      w1: art.v[0],
      exit: ew.snapshot()[0].velocity.x,
      generalized,
      energy: [e0, total()]
    }
  }

  it('플라이휠 + 고정 면: ω₁ = ω₀/(1 + 0.4085·mR²/I)(±5%), 나가는 속도 ω₁R/2(±5%), 각충격 = IΔω(±1%), 에너지는 줄기만', () => {
    const R = 0.05
    const If = 1e-4
    const results = (['cylinder', 'mesh'] as const).map((kind) => {
      const f = flywheel(kind)
      const predicted = f.w0 / (1 + (0.4085 * m * R * R) / If)
      expect(Math.abs(f.w1 / predicted - 1)).toBeLessThan(0.05)
      expect(Math.abs(f.exit / ((-f.w1 * R) / 2) - 1)).toBeLessThan(0.05)
      expect(Math.abs(f.generalized / (If * (f.w1 - f.w0)) - 1)).toBeLessThan(0.01)
      expect(f.energy[1]).toBeLessThanOrEqual(f.energy[0])
      return f
    })
    // 64점 볼록(외접 32각 기둥 껍질)과 정확한 원기둥의 나가는 속도 차이
    const [cylinder, mesh] = results
    expect(Math.abs(mesh.exit / cylinder.exit - 1)).toBeLessThan(0.05)
    // 원기둥이 이상 공식에 더 가깝다
    const predicted = cylinder.w0 / (1 + (0.4085 * m * R * R) / If)
    expect(Math.abs(cylinder.w1 - predicted)).toBeLessThan(Math.abs(mesh.w1 - predicted))
  })

  it('모터 플라이휠은 공을 쏘면 느려졌다가 다시 원래 속도로 돌아온다', () => {
    const R = 0.05
    const squeeze = 0.006
    const params = testMotorParams(TAG, 1)
    const wheel: SimJointSpec = {
      parent: -1,
      type: 'revolute',
      origin: { position: { x: 0, y: 0, z: 2 * r - squeeze + R }, rotation: ZERO },
      axis: { x: 0, y: -1, z: 0 },
      limits: null,
      body: { mass: 0.2, centerOfMass: ZERO, inertia: [5e-5, 5e-5, 5e-5, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'motor', devices: ['shooter'], ratio: 1, params, rigging: { kind: 'direct' } },
      switches: [],
      colliders: [
        {
          kind: 'cylinder',
          a: { x: 0, y: -0.02, z: 0 },
          b: { x: 0, y: 0.02, z: 0 },
          radius: R,
          friction: 0.4
        }
      ]
    }
    const spec = rig([wheel], [], {
      hubs: ['Control Hub'],
      motors: [{ device: 'shooter', modelTag: TAG, gearbox: 1, directionSign: 1, params }]
    })
    const shooter: DeviceValues = {
      mode: 'RUN_WITHOUT_ENCODER',
      power: HUB_SIGN,
      velocity: null,
      enabled: true,
      zeroPower: 'FLOAT',
      targetPosition: null,
      encoderOffset: 0,
      encoderResets: 0
    }
    // 공은 굴러서 약 1.2 s 뒤(플라이휠이 정상 속도에 닿은 뒤) 플라이휠에 닿는다
    const v0 = 1
    const run = new BallRunner(spec, {
      field: WIDE,
      elements: {
        initial: [
          ball(
            'pollen',
            { x: -1, y: 0, z: r },
            { velocity: { x: v0, y: 0, z: 0 }, angularVelocity: { x: 0, y: v0 / r, z: 0 } }
          )
        ],
        sleep: false
      }
    })
    const rate: number[] = []
    let previous = 0
    run.run(
      3,
      () => ({ shooter }),
      () => {
        const q = run.world.pose().joints?.[0] ?? 0
        rate.push((q - previous) / 0.005)
        previous = q
      }
    )
    const touch = run.snapshots.findIndex((s) => s[0].position.x > -0.05)
    expect(touch).toBeGreaterThan(200)
    const steady = rate[touch - 1]
    // 닿기 전 0.1 s 동안 정상(1% 안)
    expect(Math.abs(rate[touch - 21] / steady - 1)).toBeLessThan(0.01)
    const dip = Math.min(...rate.slice(touch, touch + 40))
    expect(dip).toBeLessThan(steady * 0.9)
    // 다시 원래 속도로(정상 속도 아래 0.5% 안까지, 넘더라도 1% 안)
    const final = rate[rate.length - 1]
    expect(final).toBeGreaterThan(steady * 0.995)
    expect(final).toBeLessThan(steady * 1.01)
    // 공은 앞으로 쏘였다
    expect(run.last()[0].velocity.x).toBeGreaterThan(3)
  })

  it('공을 밀던 관절이 한계에 닿으면 한계 충격 풀이에도 공 블록이 들어가 공이 판에 파고들지 않는다', () => {
    // 위 한계 0.03 m의 직선 판이 1 m/s로 공(판에 붙어 있음)을 밀다 한계에 박힌다. 공은 판 앞에서 떨어져 나간다
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: { lower: -0.1, upper: 0.03 },
      body: { mass: 0.5, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [box({ x: 0, y: 0, z: 0.3 }, { x: 0.05, y: 0.1, z: 0.3 })]
    }
    const spec = rig([pusher])
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = 1
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: 0.05 + r, y: 0, z: 0.3 }, { velocity: { x: 1, y: 0, z: 0 } })],
      air: false,
      sleep: false
    })
    let deepest = Infinity
    let coupledAtLimit = false
    stepRig(art, ew, 60, (rows) => {
      if (rows.length > 0 && art.z[0] >= 0.03 - 1e-12) coupledAtLimit = true
      const s = ew.snapshot()[0]
      deepest = Math.min(deepest, s.position.x - r - (0.05 + art.z[0]))
    })
    expect(coupledAtLimit).toBe(true)
    expect(art.z[0]).toBeCloseTo(0.03, 12)
    expect(art.v[0]).toBe(0)
    expect(deepest).toBeGreaterThan(-1e-3)
    // 공은 판보다 빠르게 앞으로 간다(판은 멈췄다)
    expect(ew.snapshot()[0].velocity.x).toBeGreaterThan(0.5)
  })

  it('섬 하나가 던지면 그 섬만 멈추고(속도 0) 다른 섬과 로봇은 그대로 간다', () => {
    ElementWorld.islandHook = (root) => {
      if (root === 0) throw new Error('boom')
    }
    const run = new BallRunner(ballWorldSpec(), {
      field: WIDE,
      elements: {
        initial: [
          ball('pollen', { x: 0, y: 0, z: r }, { velocity: { x: 1, y: 0, z: 0 } }),
          ball('pollen', { x: 1, y: 0, z: r }, { velocity: { x: 1, y: 0, z: 0 } })
        ],
        air: false,
        sleep: false
      }
    }).run(0.1)
    const [stuck, moving] = run.last()
    expect(stuck.position.x).toBe(0)
    expect(stuck.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(moving.position.x).toBeGreaterThan(1.05)
    const errors = run.notices.filter((n) => n.code === 'worldError')
    expect(errors).toEqual([{ code: 'worldError', params: { detail: 'element island e0: boom' } }])
  })

  it('로봇 풀이가 던지면 로봇 섬의 공도 속도 0이고 다른 공은 그대로 간다', () => {
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: 2, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: 0.05, y: 0.1, z: 0.1 })]
    }
    const spec = rig([pusher], [], { motors: [] })
    const original = Articulation.prototype.step
    let calls = 0
    vi.spyOn(Articulation.prototype, 'step').mockImplementation(function (
      this: Articulation,
      h,
      drive,
      contacts
    ) {
      if (contacts?.elements) {
        calls++
        throw new Error('robot boom')
      }
      return original.call(this, h, drive, contacts)
    })
    const initial: SimElementState[] = [
      ball('pollen', { x: 0.05 + r, y: 0, z: r }, { velocity: { x: -0.5, y: 0, z: 0 } }),
      ball('pollen', { x: 1, y: 0, z: r }, { velocity: { x: 1, y: 0, z: 0 } })
    ]
    const run = new BallRunner(spec, {
      field: WIDE,
      elements: { initial, air: false, sleep: false }
    }).run(0.05)
    expect(calls).toBeGreaterThan(0)
    const [held, free] = run.last()
    expect(speed(held.velocity)).toBe(0)
    expect(free.position.x).toBeGreaterThan(1.03)
    expect(run.notices.some((n) => n.code === 'worldError')).toBe(true)
  })

  it('로봇에 닿은 공 행이 한도를 넘으면 넘는 공은 한쪽으로 풀고 알린다', () => {
    // 미는 판 앞에 바닥 공 20개(두 줄, 서로 닿음): 공마다 로봇·바닥·공 짝이라 로봇 섬 행이 MAX_COUPLED_ROWS를 넘는다
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: 3, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [box({ x: 0.15, y: 0, z: 0.1 }, { x: 0.05, y: 0.4, z: 0.1 })]
    }
    const withPusher = rig([pusher], [], {})
    const initial: SimElementState[] = []
    for (const row of [0, 1])
      for (let k = 0; k < 10; k++)
        initial.push(
          ball('pollen', { x: 0.2 + r + row * 2 * r, y: -0.35 + k * (2 * r + 5e-4), z: r })
        )
    const art = new Articulation(withPusher.joints, { gravity: GRAVITY })
    art.v[0] = 0.2
    const ew = new ElementWorld(withPusher, WIDE, { initial, air: false, sleep: false })
    let maxCoupled = 0
    stepRig(art, ew, 200, (rows) => {
      maxCoupled = Math.max(maxCoupled, rows.length)
    })
    expect(maxCoupled).toBeLessThanOrEqual(MAX_COUPLED_ROWS)
    expect(ew.drainNotices().some((n) => n.code === 'elementCouplingLimit')).toBe(true)
    // 모든 공이 판 앞으로 밀렸다(한쪽으로 푼 공도 판을 지나가지 않는다)
    for (const s of ew.snapshot()) expect(s.position.x - r).toBeGreaterThan(0.2 + art.z[0] - 1e-3)
  })
})

// 6a 리뷰 수정: 끼인 공의 반발, 결합 한도로 한쪽에 푼 공, 공·로봇 실패 가두기
describe('로봇–공 결합: 끼임·한쪽 섬·실패 가두기(6a 리뷰)', () => {
  // 공 하나가 심까지 눌릴 때 접촉 둘(양쪽)에 담기는 탄성 에너지(J): 끼인 공이 무거운 몸체에 돌려줄 수 있는 에너지의 위
  const elasticCapacity = 2 * 0.5 * K * (POLLEN.contact.coreDepthRatio * r) ** 2

  // 무거운(13.6 kg) 직선 관절 판이 고정 기저 섀시 충돌체(움직이지 않는 면)에 붙은 공을 1.5 m/s로 민다
  function pinchRig(): { art: Articulation; ew: ElementWorld; M: number } {
    const M = 13.6
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: M, centerOfMass: ZERO, inertia: [0.1, 0.1, 0.1, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [box({ x: -0.05, y: 0, z: 0.1 }, { x: 0.05, y: 0.1, z: 0.1 })]
    }
    const face = 0.1 + 2 * r
    const spec = rig([pusher], [box({ x: face + 0.1, y: 0, z: 0.1 }, { x: 0.1, y: 0.1, z: 0.1 })])
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = 1.5
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: face - r, y: 0, z: r })],
      air: false,
      sleep: false
    })
    return { art, ew, M }
  }

  it('면에 붙은 공을 무거운 판이 밀면 공은 끼여 반발하지 않고 판은 공 변형 에너지보다 세게 되밀리지 않는다', () => {
    const { art, ew, M } = pinchRig()
    let slowest = Infinity
    stepRig(art, ew, 400, () => {
      slowest = Math.min(slowest, art.v[0])
    })
    // 반발 두 단계가 끼인 공의 양쪽에 강체 목표를 두면 판이 1 ms에 −1 m/s로 되튀었다(공 25 g이 트램펄린)
    expect(slowest).toBeGreaterThan(-Math.sqrt((2 * elasticCapacity) / M))
    // 공은 판과 면 사이에 남는다(튀어 나가지 않는다)
    expect(speed(ew.snapshot()[0].velocity)).toBeLessThan(2)
  })

  it('바닥의 자유로운 공을 판이 치면 반발로 튀어 나간다(바닥과 판은 직각이라 끼임이 아니다)', () => {
    const M = 13.6
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: M, centerOfMass: ZERO, inertia: [0.1, 0.1, 0.1, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [box({ x: -0.05, y: 0, z: 0.1 }, { x: 0.05, y: 0.1, z: 0.1 })]
    }
    const spec = rig([pusher])
    const art = new Articulation(spec.joints, { gravity: GRAVITY })
    art.v[0] = 1
    // 판 앞 1 cm, 바닥에서 쉬는 공
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: 0.01 + r, y: 0, z: r })],
      air: false,
      sleep: false
    })
    // 튀어 나간 직후의 공 속도(그 뒤에는 바닥 마찰로 준다)
    let kicked = 0
    stepRig(art, ew, 30, () => {
      kicked = Math.max(kicked, ew.snapshot()[0].velocity.x)
    })
    // 판 속도 v의 (1 + e)배 안팎(판이 공보다 훨씬 무겁다)
    const e = POLLEN.contact.restitution.robot
    expect(kicked / ((1 + e) * art.v[0])).toBeCloseTo(1, 1)
  })

  it('BIOBUZZ 관중석 벽에 붙은 GARDEN 공으로 전출력 메카넘이 달려들어도 공 변형 에너지보다 세게 되밀리지 않는다', () => {
    const start = { x: 0.9, y: -1.55, yaw: 0 }
    const base = robotSpec({ start }, { field: { season: 'biobuzz', hiveTipped: [false, false] } })
    const spec: WorldSpec = {
      ...base,
      robot: {
        ...base.robot,
        start,
        colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 })]
      },
      elements: { groups: ['garden'], preloads: [] }
    }
    const world = new PhysicsWorld(spec)
    let previous = world.pose().x
    let fastest = 0
    let slowest = Infinity
    for (let k = 0; k < 400; k++) {
      world.step(k * 5_000_000, outputs(mecanum(1, 0, 0)))
      world.drainNotices()
      const x = world.pose().x
      const v = (x - previous) / 0.005
      previous = x
      fastest = Math.max(fastest, v)
      if (fastest > 0.5) slowest = Math.min(slowest, v)
    }
    expect(fastest).toBeGreaterThan(1.4)
    // 앞에 닿은 공 넷이 심까지 눌려 담은 에너지를 모두 돌려줘도 넘지 않는 되밀림(고친 전에는 −1.31 m/s)
    const bound = Math.sqrt((2 * 4 * elasticCapacity) / spec.robot.body.mass)
    expect(slowest).toBeGreaterThan(-bound)
  }, 60_000)

  it('프리로드가 섀시 충돌체와 심보다 얕게 겹치면 시작하면 밀려나고 심 이상이면 박힌 채 남는다(worldPreloadOverlap·worldPreloadEmbedded 문구의 규칙)', () => {
    const core = POLLEN.contact.coreDepthRatio * r
    const top = 0.2
    const spec = ballWorldSpec({
      robot: {
        ...ballWorldSpec().robot,
        colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 })]
      },
      elements: {
        groups: [],
        preloads: [
          { kind: 'pollen', body: -1, position: { x: -0.1, y: 0, z: top + r - 0.5 * core } },
          { kind: 'pollen', body: -1, position: { x: 0.1, y: 0, z: top + r - 1.4 * core } }
        ]
      }
    })
    const run = new BallRunner(spec, { field: ballField() }).run(1)
    const [shallow, deep] = run.last()
    // 얕은 공은 섀시 윗면에 얹힌 쉬는 공(침하 mg/k만)이다
    expect(shallow.position.z - r - top).toBeGreaterThan(-1e-3)
    // 깊은 공은 심 행(목표 0)이 밀어내지 않아 처음 깊이 그대로다
    expect(top + r - deep.position.z).toBeGreaterThan(core)
    // 시작 겹침은 INIT 경고(worldPreloadEmbedded)가 맡는다: 심 행이 '롤러 간격을 넓히세요' 알림(elementCrushed)을 다시 내지 않는다
    // (6a 리뷰 2: 첫 하위 단계에 냈고, 실행마다 한 번이라 뒤의 진짜 눌림 알림도 막았다)
    expect(run.notices.map((n) => n.code)).not.toContain('elementCrushed')
  })

  it('시작부터 심 이상 박힌 공이 있어도 실행 중 메커니즘이 심까지 누른 공은 elementCrushed로 알린다', () => {
    const core = POLLEN.contact.coreDepthRatio * r
    // 고정 기저 섀시 상자 윗면(z 0.2)에 1.4·심 박힌 공과, 무거운 판이 1.5 m/s로 면에 눌러 심까지 짜는 공(pinchRig와 같은 기하)
    const face = 0.1 + 2 * r
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: 13.6, centerOfMass: ZERO, inertia: [0.1, 0.1, 0.1, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [box({ x: -0.05, y: 0, z: 0.1 }, { x: 0.05, y: 0.1, z: 0.1 })]
    }
    const spec = rig(
      [pusher],
      [
        box({ x: face + 0.1, y: 0, z: 0.1 }, { x: 0.1, y: 0.1, z: 0.1 }),
        box({ x: 1, y: 0, z: 0.1 }, { x: 0.2, y: 0.2, z: 0.1 })
      ]
    )
    const crushedAt = (embedded: boolean, push: number): number => {
      const art = new Articulation(spec.joints, { gravity: GRAVITY })
      art.v[0] = push
      art.z[0] = -0.05
      const initial = [ball('pollen', { x: face - r, y: 0, z: r })]
      if (embedded) initial.push(ball('pollen', { x: 1, y: 0, z: 0.2 + r - 1.4 * core }))
      const ew = new ElementWorld(spec, WIDE, { initial, air: false, sleep: false })
      let at = -1
      for (let k = 0; k < 300 && at < 0; k++) {
        stepRig(art, ew, 1)
        if (ew.drainNotices().some((n) => n.code === 'elementCrushed')) at = k
      }
      return at
    }
    // 박힌 공만이면(판이 공에 닿지 않음) 알림이 없다
    expect(crushedAt(true, 0)).toBe(-1)
    // 판이 짜는 공은 박힌 공이 있어도 같은 하위 단계에 알린다(첫 하위 단계가 아니라 판이 심까지 누른 때)
    const alone = crushedAt(false, 1.5)
    expect(alone).toBeGreaterThan(10)
    expect(crushedAt(true, 1.5)).toBe(alone)
  })

  it('결합 한도를 넘어 한쪽으로 푼 공이 벽과 로봇 사이에 끼여도 튀어 나가지 않는다', () => {
    // 관중석 벽에 붙인 공 20개(4 × 5)를 전출력 메카넘이 민다: 로봇 섬 행이 한도를 넘는다
    const ih = resolveSeason('biobuzz').perimeter.innerHalf
    const start = { x: 0.9, y: 0, yaw: 0 }
    const base = robotSpec({ start }, { field: { season: 'biobuzz', hiveTipped: [false, false] } })
    const spec: WorldSpec = {
      ...base,
      robot: {
        ...base.robot,
        start,
        colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 })]
      },
      elements: { groups: [], preloads: [] }
    }
    const initial: SimElementState[] = []
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 5; j++)
        initial.push(
          ball('pollen', { x: ih - r - i * (2 * r + 0.001), y: (j - 2) * (2 * r + 0.001), z: r })
        )
    const run = new BallRunner(spec, { elements: { initial } }).run(3, () =>
      outputs(mecanum(1, 0, 0))
    )
    expect(run.notices.some((n) => n.code === 'elementCouplingLimit')).toBe(true)
    let fastest = 0
    let highest = 0
    for (const tick of run.snapshots)
      for (const s of tick) {
        fastest = Math.max(fastest, speed(s.velocity))
        highest = Math.max(highest, s.position.z)
      }
    // 한쪽 섬이 정해진 속도의 몸체와 벽 사이에 강체 행을 두면 풀 수 없는 LCP가 되어 수백 m/s로 날았다
    expect(fastest).toBeLessThan(10)
    expect(highest).toBeLessThan(0.3)
    expect(run.notices.some((n) => n.code === 'elementOutOfField')).toBe(false)
  }, 60_000)

  it('몸체 충돌 행이 던져도 로봇에 닿지 않은 공은 그대로 날아간다(로봇만 그 하위 단계에 멈춤)', () => {
    const start = { x: -0.6, y: -0.9, yaw: 0 }
    const spec: WorldSpec = {
      ...robotSpec({ start }, { field: { season: 'biobuzz', hiveTipped: [false, false] } }),
      elements: { groups: [], preloads: [] }
    }
    spec.robot = {
      ...spec.robot,
      colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 })]
    }
    const thrown = ball('pollen', { x: 0.8, y: 0.8, z: 0.6 }, { velocity: { x: 0.5, y: 0, z: 1 } })
    const flight = (fault: boolean): SimElementState => {
      const original = BodyCollision.prototype.rows
      let calls = 0
      vi.spyOn(BodyCollision.prototype, 'rows').mockImplementation(function (
        this: BodyCollision,
        ...args
      ) {
        calls++
        if (fault && calls > 50 && calls <= 250) throw new Error('hull boom')
        return original.apply(this, args)
      })
      const run = new BallRunner(spec, {
        elements: { initial: [thrown], air: false, sleep: false }
      }).run(0.3)
      vi.restoreAllMocks()
      if (fault)
        expect(run.notices).toContainEqual({ code: 'worldError', params: { detail: 'hull boom' } })
      return run.last()[0]
    }
    expect(flight(true)).toEqual(flight(false))
  })

  it('공 접촉 만들기 전체가 던지면 공은 그 하위 단계에 멈추고 로봇은 공 행 없이 그대로 간다', () => {
    const start = { x: -0.6, y: -0.9, yaw: 0 }
    const spec: WorldSpec = {
      ...robotSpec({ start }, { field: { season: 'biobuzz', hiveTipped: [false, false] } }),
      elements: { groups: [], preloads: [] }
    }
    // 로봇에서 먼 공 하나(로봇 짝이 없어 로봇 길은 공과 관계없다)
    const initial = [ball('pollen', { x: 1.2, y: 1.2, z: r })]
    const run = (fault: boolean): BallRunner => {
      const original = ElementWorld.prototype.prepare
      let calls = 0
      vi.spyOn(ElementWorld.prototype, 'prepare').mockImplementation(function (
        this: ElementWorld,
        ...args
      ) {
        calls++
        if (fault && calls > 10 && calls <= 100) throw new Error('prepare boom')
        return original.apply(this, args)
      })
      const out = new BallRunner(spec, {
        elements: { initial, air: false, sleep: false }
      }).run(0.5, () => outputs(mecanum(0.5, 0, 0)))
      vi.restoreAllMocks()
      return out
    }
    const healthy = run(false)
    const faulty = run(true)
    // 고친 전에는 공 접촉 만들기가 던진 하위 단계마다 로봇 속도도 0이 되어 로봇이 덜 갔다
    expect(faulty.world.pose()).toEqual(healthy.world.pose())
    expect(faulty.notices).toContainEqual({
      code: 'worldError',
      params: { detail: 'prepare boom' }
    })
  })

  it('공 하나의 접촉 만들기가 던지면 그 공만 멈추고 로봇·다른 공은 그대로 간다', () => {
    const start = { x: -0.6, y: -0.9, yaw: 0 }
    const spec: WorldSpec = {
      ...robotSpec({ start }, { field: { season: 'biobuzz', hiveTipped: [false, false] } }),
      elements: { groups: [], preloads: [] }
    }
    const initial = [
      ball('pollen', { x: 1.2, y: 1.2, z: r }),
      ball('pollen', { x: 0.5, y: 0.8, z: r }, { velocity: { x: 0.5, y: 0, z: 0 } })
    ]
    const run = (fault: boolean): BallRunner => {
      const proto = ElementWorld.prototype as unknown as {
        staticPairs: (e: number, ...rest: unknown[]) => void
      }
      const original = proto.staticPairs
      vi.spyOn(proto, 'staticPairs').mockImplementation(function (this: unknown, e, ...rest) {
        if (fault && e === 0) throw new Error('pair boom')
        return original.call(this, e, ...rest)
      })
      const out = new BallRunner(spec, {
        elements: { initial, air: false, sleep: false }
      }).run(0.5, () => outputs(mecanum(0.5, 0, 0)))
      vi.restoreAllMocks()
      return out
    }
    const healthy = run(false)
    const faulty = run(true)
    // 로봇은 공 0의 버그와 관계없이 같은 길을 간다(고친 전에는 로봇이 시작 자리에 멈췄다)
    expect(faulty.world.pose()).toEqual(healthy.world.pose())
    expect(faulty.world.pose().x).toBeGreaterThan(start.x + 0.1)
    // 공 0은 멈추고(위치 그대로, 속도 0) 공 1은 그대로
    expect(faulty.last()[0].position).toEqual(initial[0].position)
    expect(faulty.last()[0].velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(faulty.last()[1]).toEqual(healthy.last()[1])
    expect(faulty.notices).toContainEqual({
      code: 'worldError',
      params: { detail: 'element e0: pair boom' }
    })
  })
})

// 6a 리뷰 2: 끼임은 행마다(그 행의 법선과 반대쪽 접촉이 있을 때만), 끼인 행은 이력 스프링이라 무거운 몸체도 공의 반발 계수 안팎으로
// 되튄다
describe('로봇–공 결합: 행마다 끼임·이력 스프링(6a 리뷰 2)', () => {
  // 마찰 없는 x 직선 관절 판(관절 원점 0, 판 앞면 x = 0)
  const plate = (
    M: number,
    colliders: SimCollider[],
    axis = { x: 1, y: 0, z: 0 }
  ): SimJointSpec => ({
    parent: -1,
    type: 'prismatic',
    origin: { position: ZERO, rotation: ZERO },
    axis,
    limits: null,
    body: { mass: M, centerOfMass: ZERO, inertia: [0.1, 0.1, 0.1, 0, 0, 0] },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: [],
    colliders
  })
  const e = POLLEN.contact.restitution.robot

  it('y로 붙어 놓인 공 셋을 무거운 판이 x로 치면 가운데 공도 (1 + e)배로 튀어 나간다(이웃 때문에 끼이지 않는다)', () => {
    for (const gap of [0, 0.0005]) {
      const spec = rig([
        plate(13.6, [box({ x: -0.05, y: 0, z: 0.1 }, { x: 0.05, y: 0.3, z: 0.1 })])
      ])
      const art = new Articulation(spec.joints, { gravity: GRAVITY })
      art.v[0] = 1
      const initial = [-1, 0, 1].map((j) =>
        ball('pollen', { x: 0.01 + r, y: j * (2 * r + gap), z: r })
      )
      const ew = new ElementWorld(spec, WIDE, { initial, air: false, sleep: false })
      const peak = [0, 0, 0]
      stepRig(art, ew, 30, () => {
        ew.snapshot().forEach((s, i) => (peak[i] = Math.max(peak[i], s.velocity.x)))
      })
      // 공마다 끼임을 보면 가운데 공은 ±y 이웃 때문에 판 행의 반발을 잃어 판 속도(1.08배)로만 밀렸다
      for (const p of peak) expect(p / (1 + e)).toBeCloseTo(1, 1)
    }
  })

  it('다른 공이 얹힌 아래 공도 판이 옆에서 치면 (1 + e)배로 튀어 나간다', () => {
    const spec = rig([
      plate(13.6, [box({ x: -0.05, y: 0, z: 0.02 }, { x: 0.05, y: 0.3, z: 0.02 })])
    ])
    const art = new Articulation(spec.joints, { gravity: GRAVITY })
    art.v[0] = 1
    const initial = [
      ball('pollen', { x: 0.01 + r, y: 0, z: r }),
      ball('pollen', { x: 0.01 + r, y: 0, z: 3 * r })
    ]
    const ew = new ElementWorld(spec, WIDE, { initial, air: false, sleep: false })
    let bottom = 0
    stepRig(art, ew, 20, () => {
      bottom = Math.max(bottom, ew.snapshot()[0].velocity.x)
    })
    // 공마다 끼임을 보면 바닥(+z)과 위 공(−z)이 반대쪽이라 1.09배였다
    expect(bottom / (1 + e)).toBeCloseTo(1, 1)
  })

  // 무거운 판(13.6 kg, 중력 없음)이 v0로 미끄러져 고정 면(고정 기저 섀시 상자)에 붙은 공을 누른다. 판 행·면 행 모두 로봇 반발
  // e = 0.5인 끼인 행이다
  function coast(v0: number): { final: number; ball: SimElementState } {
    const M = 13.6
    const face = 0.1 + 2 * r
    const spec = rig(
      [plate(M, [box({ x: -0.05, y: 0, z: 0.1 }, { x: 0.05, y: 0.1, z: 0.1 })])],
      [box({ x: face + 0.1, y: 0, z: 0.1 }, { x: 0.1, y: 0.1, z: 0.1 })]
    )
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = v0
    art.z[0] = 0.1 - 0.002
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: face - r, y: 0, z: r })],
      air: false,
      sleep: false
    })
    stepRig(art, ew, 600)
    return { final: art.v[0] / v0, ball: ew.snapshot()[0] }
  }

  it('무거운 판이 면에 붙은 공을 심보다 얕게 누르면 판은 공의 반발 계수 안팎으로 되튄다(질량과 관계없이 변형 에너지의 e²)', () => {
    for (const v0 of [0.05, 0.15, 0.25, 0.3]) {
      const { final } = coast(v0)
      // 공 질량 기준 임계 감쇠만이면 무거운 판의 유효 감쇠비가 약 0.03이라 −0.89배였다(변형 에너지의 79 %)
      expect(final).toBeLessThan(-0.6 * e)
      expect(final).toBeGreaterThan(-e - 0.02)
    }
  })

  it('판이 공을 바닥에 내리누르면 판 행(e 0.5)과 바닥 행(e 0.3)의 되돌림 에너지 평균 안팎으로 되튄다', () => {
    const v0 = 0.3
    const spec = rig([
      {
        ...plate(13.6, [box({ x: 0, y: 0, z: 0.05 }, { x: 0.1, y: 0.1, z: 0.05 })], {
          x: 0,
          y: 0,
          z: -1
        }),
        origin: { position: { x: 0, y: 0, z: 2 * r + 0.001 }, rotation: ZERO }
      }
    ])
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = v0
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: 0, y: 0, z: r })],
      air: false,
      sleep: false
    })
    stepRig(art, ew, 600)
    const floor = POLLEN.contact.restitution.floor
    const returned = Math.sqrt((e * e + floor * floor) / 2)
    // 공 질량 기준 임계 감쇠만이면 −0.89배였다
    expect(art.v[0] / v0).toBeLessThan(-0.6 * returned)
    expect(art.v[0] / v0).toBeGreaterThan(-returned - 0.02)
  })

  // 6a 최종 확인: 끼임이 풀린 행은 이력 주기를 마친다. 전에는 떨어질 때(δ ≤ 0)까지 이력 스프링이라, 바닥에 눌렸다 놓인 공이
  // 바닥과 떨어지지 않아 풀림 선의 쉼 깊이 peak·(1 − e²)에 박힌 채 잠들었다(실제 앱 E2E: 롤러가 놓은 GARDEN 공이 1.5 mm 가라앉음)
  it('판이 바닥에 누른 공을 놓으면 공은 바닥에 박혀 남지 않고 쉬는 깊이 mg/k로 돌아온다(튀어 오르지 않는다)', () => {
    const spec = rig([
      {
        ...plate(13.6, [box({ x: 0, y: 0, z: 0.05 }, { x: 0.1, y: 0.1, z: 0.05 })], {
          x: 0,
          y: 0,
          z: -1
        }),
        origin: { position: { x: 0, y: 0, z: 2 * r + 0.001 }, rotation: ZERO }
      }
    ])
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = 0.3
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: 0, y: 0, z: r })],
      air: false
    })
    let deepest = 0
    let highest = -Infinity
    let released = false
    // 심 가까이(약 8.7 mm) 눌린 바닥 행은 PINCH_RECOVERY_SPEED로 약 4.4 s에 되찾고 0.5 s 뒤 잠든다
    stepRig(art, ew, 6000, () => {
      const z = ew.snapshot()[0].position.z
      deepest = Math.max(deepest, r - z)
      // 판이 공에서 떨어진 뒤(판 아랫면 z = 2r + 0.001 − q)
      if (2 * r + 0.001 - art.z[0] > 2 * r + 0.01) released = true
      if (released) highest = Math.max(highest, z)
    })
    expect(released).toBe(true)
    // 판이 공을 꽤 눌렀다(이력 주기에 들어감)
    expect(deepest).toBeGreaterThan(1e-3)
    const rest = (m * GRAVITY) / K
    const final = ew.snapshot()[0]
    expect(r - final.position.z).toBeCloseTo(rest, 5)
    expect(final.asleep).toBe(true)
    // 되찾는 동안 바닥에서 뜨지 않는다(탄성선으로 한 번에 바꾸면 눌린 깊이만큼 튀어 올랐다)
    expect(highest).toBeLessThan(r)
  })
})
