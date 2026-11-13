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
import { CONTACT_STIFFNESS_PER_PLATE } from './elementData'
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

// Articulation과 ElementWorld만으로 하위 단계를 돈다(world.ts와 같은 순서: 접촉 틀 → 공 행 → art.step → 공 마무리)
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
    each?.(made.rows)
    ew.finish(art, h, false, (k + 1) * 1e6)
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
    // 미는 판 앞에 바닥 공 20개(두 줄, 서로 닿음): 공마다 로봇·바닥·공 짝이라 로봇 섬 행이 48을 넘는다
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
    expect(maxCoupled).toBeLessThanOrEqual(48)
    expect(ew.drainNotices().some((n) => n.code === 'elementCouplingLimit')).toBe(true)
    // 모든 공이 판 앞으로 밀렸다(한쪽으로 푼 공도 판을 지나가지 않는다)
    for (const s of ew.snapshot()) expect(s.position.x - r).toBeGreaterThan(0.2 + art.z[0] - 1e-3)
  })
})
