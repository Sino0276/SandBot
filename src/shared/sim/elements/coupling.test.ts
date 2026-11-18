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
  each?: (rows: readonly ContactRow[]) => void,
  h = 0.001
): void {
  for (let k = 0; k < steps; k++) {
    const frames = art.contactFrames()
    const made = ew.prepare(art, frames, h)
    art.step(h, zeroDrive, { rows: made.rows, damping: [], elements: made.coupled })
    ew.finish(art, h, false, (k + 1) * Math.round(h * 1e9))
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

  it('행을 만든 뒤 섬 나누기가 던진 하위 단계는 다음 하위 단계로 넘길 짝 상태를 남기지 않는다(failSubstep)', () => {
    // 고정 기저 로봇의 가벼운 판(직선 관절, 중력)이 바닥의 공 위에 얹혀 누른다: 판–공·바닥–공 행이 끼인 채 이력 주기에 있다
    const lid: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: { x: 0, y: 0, z: 2 * r + 0.0005 }, rotation: ZERO },
      axis: { x: 0, y: 0, z: -1 },
      limits: null,
      body: { mass: 0.5, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [box({ x: 0, y: 0, z: 0.05 }, { x: 0.1, y: 0.1, z: 0.05 })]
    }
    const spec = rig([lid])
    const world = new PhysicsWorld(spec, {
      field: WIDE,
      elements: { initial: [ball('pollen', { x: 0, y: 0, z: r })], air: false, sleep: false }
    })
    // 1 ms 틱 = 하위 단계 하나
    let k = 0
    const tick = (): void => {
      world.step(k++ * 1_000_000, {})
    }
    for (let i = 0; i < 300; i++) tick()
    world.drainNotices()
    type Carried = Record<
      'nextTangents' | 'nextArrivals' | 'nextPeaks' | 'nextDepths' | 'nextRestoring' | 'depths',
      { size: number; has(key: string): boolean }
    >
    const state = (world as unknown as { elements: Carried }).elements
    // 보통 하위 단계 뒤: 앞 깊이에 두 짝이 있다
    expect(state.depths.has('e0/j0k0')).toBe(true)
    expect(state.depths.has('e0/fl')).toBe(true)
    const proto = ElementWorld.prototype as unknown as { islands: (...args: unknown[]) => unknown }
    vi.spyOn(proto, 'islands').mockImplementationOnce(() => {
      throw new Error('island boom')
    })
    tick()
    vi.restoreAllMocks()
    expect(world.drainNotices()).toContainEqual({
      code: 'worldError',
      params: { detail: 'island boom' }
    })
    // 던지기 전에 만든 행이 적어 둔 것(접선·도착 속도·peak·앞 깊이·되찾기 표시)을 모두 버린다. 고친 전에는 앞 깊이만 남아, 다음
    // 하위 단계에 접촉이 없던 짝도 그다음에는 '앞 하위 단계에 있었다'로 보였다(시작 겹침이 아닌 것처럼 이력 주기를 연다)
    for (const name of [
      'nextTangents',
      'nextArrivals',
      'nextPeaks',
      'nextDepths',
      'nextRestoring'
    ] as const)
      expect([name, state[name].size]).toEqual([name, 0])
    // 다음 하위 단계는 보통대로 다시 푼다
    tick()
    expect(world.drainNotices()).toEqual([])
    expect(state.depths.has('e0/j0k0')).toBe(true)
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
    const floor = POLLEN.contact.restitution.floor
    const returned = Math.sqrt((e * e + floor * floor) / 2)
    // 0.1–0.3 m/s에서 −0.40·−0.38·−0.38배(평균 0.41). 0.05 m/s는 −0.431배로 평균 + 0.02에 0.001 차이라 넣지 않는다: 그보다
    // 느리면 눌리는 동안 이력 스프링이 모양을 되찾아(PINCH_RECOVERY_SPEED) 더 되튄다(0.02 m/s −0.52배, 0.01 m/s −0.65배)
    for (const v0 of [0.1, 0.2, 0.3]) {
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
      stepRig(art, ew, 900)
      // 공 질량 기준 임계 감쇠만이면 −0.89배였다
      expect(art.v[0] / v0).toBeLessThan(-0.6 * returned)
      expect(art.v[0] / v0).toBeGreaterThan(-returned - 0.02)
    }
  })

  // 6a 최종 확인: 이력 스프링이 눌린 모양을 되찾는다(이번 주기 최대 깊이 peak가 PINCH_RECOVERY_SPEED로 줄어든다. 행은 끼임이
  // 풀려도 떨어질 때(δ ≤ 0)까지 이력 스프링 그대로다). 전에는 peak가 줄지 않아, 바닥에 눌렸다 놓인 공이 바닥과 떨어지지 않으니
  // 풀림 선의 쉼 깊이 peak·(1 − e²)에 박힌 채 잠들었다(실제 앱 E2E: 롤러가 놓은 GARDEN 공이 1.5 mm 가라앉음)
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

// 6a 리뷰 3: 심(반지름의 30 %)까지 눌린 공은 누르던 몸체가 떠난 뒤에도 심 행(강체, 목표 0)이 밀어내지 않아 그 깊이에 박힌 채
// 잠들었다(잔상과 final에도 남음). 붙드는 것(반대쪽의 로봇·정적 형상, 그런 것에 받쳐진 공)이 없는 심 행은 쉼 깊이를 지금 깊이로
// 다시 잡고 PINCH_RECOVERY_SPEED로 모양을 되찾아 탄성 평형(mg/k)으로 돌아온다. 튀어 나가지 않는다
describe('로봇–공 결합: 심까지 눌린 공의 되찾기(6a 리뷰 3)', () => {
  const core = POLLEN.contact.coreDepthRatio * r
  const rest = (m * GRAVITY) / K
  const heavy = (
    colliders: SimCollider[],
    axis: { x: number; y: number; z: number },
    origin = ZERO
  ): SimJointSpec => ({
    parent: -1,
    type: 'prismatic',
    origin: { position: origin, rotation: ZERO },
    axis,
    limits: null,
    body: { mass: 13.6, centerOfMass: ZERO, inertia: [0.1, 0.1, 0.1, 0, 0, 0] },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: [],
    colliders
  })

  // 13.6 kg 판(중력 없음)이 v0로 내려와 바닥의 공을 누르고, 멈추면 0.2 m/s로 물러난다. recovered: 공이 쉬는 깊이(mg/k + 10 µm
  // 안)로 돌아온 시각(s)
  function pressFloor(
    v0: number,
    steps: number,
    h = 0.001
  ): {
    deepest: number
    highest: number
    fastest: number
    recovered: number
    ball: SimElementState
    notices: string[]
  } {
    const spec = rig([
      heavy(
        [box({ x: 0, y: 0, z: 0.05 }, { x: 0.1, y: 0.1, z: 0.05 })],
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 0, z: 2 * r + 0.001 }
      )
    ])
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = v0
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: 0, y: 0, z: r })],
      air: false
    })
    let deepest = 0
    let highest = -Infinity
    let fastest = 0
    let retract = false
    let recovered = -1
    let k = 0
    const notices: string[] = []
    stepRig(
      art,
      ew,
      steps,
      () => {
        k++
        const s = ew.snapshot()[0]
        deepest = Math.max(deepest, r - s.position.z)
        if (art.v[0] <= 1e-9) retract = true
        if (retract) art.v[0] = -0.2
        // 판이 공에서 떨어진 뒤(판 아랫면 z = 2r + 0.001 − q): 되찾기만으로 움직이는 공
        if (2 * r + 0.001 - art.z[0] > 2 * r + 0.01) {
          highest = Math.max(highest, s.position.z)
          fastest = Math.max(fastest, speed(s.velocity))
          if (recovered < 0 && r - s.position.z < rest + 1e-5) recovered = k * h
        }
        for (const n of ew.drainNotices()) notices.push(n.code)
      },
      h
    )
    return { deepest, highest, fastest, recovered, ball: ew.snapshot()[0], notices }
  }

  it('판이 바닥의 공을 심까지 눌렀다 물러나면 공은 박혀 남지 않고 mg/k로 돌아와 잠든다(튀어 오르지 않는다)', () => {
    for (const v0 of [0.34, 0.4, 0.6, 1.0]) {
      // 심(10.7 mm)에서 바닥 행의 쉼 깊이가 PINCH_RECOVERY_SPEED·(1 − e²) = 1.82 mm/s로 물러난다: 약 5.9 s + 잠들기 0.5 s
      const run = pressFloor(v0, 8000)
      expect(run.deepest).toBeGreaterThan(core)
      expect(run.notices).toContain('elementCrushed')
      // 고친 전: 10.68–10.76 mm 가라앉은 채 0.6 s 뒤 잠들었다
      expect(r - run.ball.position.z).toBeCloseTo(rest, 5)
      expect(run.ball.asleep).toBe(true)
      // 바닥에서 뜨지 않고, 되찾는 빠르기는 PINCH_RECOVERY_SPEED 안팎이다(튀어 나가지 않는다)
      expect(run.highest).toBeLessThan(r)
      expect(run.fastest).toBeLessThan(0.05)
    }
  })

  it('되찾는 빠르기는 하위 단계 길이와 관계없다: h 1 ms와 0.5 ms의 되찾는 시간이 같다(±2 %)', () => {
    const coarse = pressFloor(0.6, 8000, 0.001)
    const fine = pressFloor(0.6, 16000, 0.0005)
    // 심 10.7 mm에서 1.82 mm/s: 약 5.9 s
    expect(coarse.recovered).toBeGreaterThan(5)
    expect(coarse.recovered).toBeLessThan(7)
    expect(Math.abs(fine.recovered / coarse.recovered - 1)).toBeLessThan(0.02)
    expect(r - fine.ball.position.z).toBeCloseTo(rest, 5)
  })

  it('판이 누른 채 멈춰 있으면 심 행은 되찾지 않는다: 공은 심에 머물고 판은 밀려나지 않는다', () => {
    const face = 0.1 + 2 * r
    const spec = rig(
      [heavy([box({ x: -0.05, y: 0, z: 0.1 }, { x: 0.05, y: 0.1, z: 0.1 })], { x: 1, y: 0, z: 0 })],
      [box({ x: face + 0.1, y: 0, z: 0.1 }, { x: 0.1, y: 0.1, z: 0.1 })]
    )
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = 0.6
    art.z[0] = 0.1 - 0.002
    const ew = new ElementWorld(spec, WIDE, {
      initial: [ball('pollen', { x: face - r, y: 0, z: r })],
      air: false,
      sleep: false
    })
    stepRig(art, ew, 200)
    // 판은 심에서 멈췄다(심 넘는 충돌은 소성: 되튀지 않는다)
    expect(Math.abs(art.v[0])).toBeLessThan(1e-9)
    const stopped = art.z[0]
    const x = ew.snapshot()[0].position.x
    stepRig(art, ew, 3000)
    // 3 s 뒤에도 판과 공은 그 자리다(누르는 몸체에 에너지를 주지 않는다)
    expect(Math.abs(art.v[0])).toBeLessThan(1e-9)
    expect(art.z[0]).toBeCloseTo(stopped, 9)
    expect(ew.snapshot()[0].position.x).toBeCloseTo(x, 9)
    expect(x + r - face).toBeGreaterThan(core - 1e-6)
  })

  // 공 n개를 한 줄로 벽(+x)에 놓고 13.6 kg 판이 v0로 민 뒤 0.2 m/s로 물러난다. 공 0이 벽 쪽이다
  function pressRow(
    n: number,
    v0: number,
    steps: number
  ): {
    wall: number
    pairs: number[]
    deepest: number[]
    fastest: number
    balls: SimElementState[]
  } {
    const WALL = 10
    const front = WALL - 2 * r * n - 0.001
    const spec = rig([
      heavy(
        [box({ x: -0.05, y: 0, z: 0.1 }, { x: 0.05, y: 0.1, z: 0.1 })],
        { x: 1, y: 0, z: 0 },
        { x: front, y: 0, z: 0 }
      )
    ])
    const art = new Articulation(spec.joints, { gravity: 0 })
    art.v[0] = v0
    const initial = Array.from({ length: n }, (_, i) =>
      ball('pollen', { x: WALL - r - 2 * r * i, y: 0, z: r })
    )
    const ew = new ElementWorld(spec, WIDE, { initial, air: false })
    const overlaps = (s: SimElementState[]): number[] => [
      s[0].position.x + r - WALL,
      ...s.slice(1).map((b, i) => 2 * r - (s[i].position.x - b.position.x))
    ]
    const deepest = Array.from({ length: n }, () => 0)
    let fastest = 0
    let retract = false
    stepRig(art, ew, steps, () => {
      const s = ew.snapshot()
      overlaps(s).forEach((d, i) => (deepest[i] = Math.max(deepest[i], d)))
      if (art.v[0] <= 1e-9) retract = true
      if (retract) art.v[0] = -0.2
      // 판 앞면이 맨 뒤 공에서 1 cm 넘게 떨어진 뒤
      if (s[n - 1].position.x - r - (front + art.z[0]) > 0.01)
        for (const b of s) fastest = Math.max(fastest, speed(b.velocity))
    })
    const s = ew.snapshot()
    const [wall, ...pairs] = overlaps(s)
    return { wall, pairs, deepest, fastest, balls: s }
  }

  it('판이 공 두 개·세 개의 줄을 벽에 심까지 눌렀다 물러나면 공끼리도 벽에서도 떨어진다(뒤에 받치는 것이 없는 공은 붙들지 않는다)', () => {
    for (const [n, v0] of [
      [2, 0.5],
      [3, 1]
    ] as const) {
      // 공끼리 심(두 공 합 21.3 mm)은 1.5 mm/s로 물러난다: 약 14.2 s + 잠들기
      const run = pressRow(n, v0, 17000)
      // 벽 행과 공끼리 행이 모두 심까지 눌렸다
      expect(run.deepest[0]).toBeGreaterThan(core)
      for (const d of run.deepest.slice(1)) expect(d).toBeGreaterThan(2 * core)
      // 고친 전: 벽 10.8–11.5 mm, 공끼리 21.35 mm 겹친 채 잠들었다
      expect(run.wall).toBeLessThan(1e-4)
      for (const overlap of run.pairs) expect(overlap).toBeLessThan(1e-4)
      for (const b of run.balls) {
        expect(b.asleep).toBe(true)
        expect(r - b.position.z).toBeCloseTo(rest, 5)
      }
      expect(run.fastest).toBeLessThan(0.05)
    }
  })

  it('전출력·0.6 출력 메카넘이 GARDEN 공 넷을 관중석 벽에 심까지 박고 물러나면 넷 모두 벽 밖으로 돌아와 mg/k로 잠든다', () => {
    const ih = resolveSeason('biobuzz').perimeter.innerHalf
    // 빨강 벽에서 4 mm 띄운 시작(시작 겹침 없음)
    const start = { x: 0.9, y: -1.56, yaw: 0 }
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
    for (const power of [0.6, 1]) {
      const world = new PhysicsWorld(spec)
      const deepest = [0, 0, 0, 0]
      let fastest = 0
      // 1.5 s 앞으로, 1.5 s 뒤로(0.4), 멈춤. 벽 행(e 0.64)의 쉼 깊이는 1.18 mm/s로 물러난다: 약 9.6 s + 잠들기
      for (let k = 0; k <= 3000; k++) {
        const t = k * 0.005
        const drive = t < 1.5 ? mecanum(power, 0, 0) : t < 3 ? mecanum(-0.4, 0, 0) : {}
        world.step(k * 5_000_000, outputs(drive))
        world.drainNotices()
        const reds = world.elementSnapshot()!.slice(0, 4)
        reds.forEach((s, i) => (deepest[i] = Math.max(deepest[i], s.position.x + r - ih)))
        // 로봇이 물러나 멈춘 뒤: 되찾기만으로 움직이는 공
        if (t > 3.5) for (const s of reds) fastest = Math.max(fastest, speed(s.velocity))
      }
      // 적어도 한 공은 심까지 박혔다(전출력은 넷 모두)
      expect(Math.max(...deepest)).toBeGreaterThan(core)
      if (power === 1) for (const d of deepest) expect(d).toBeGreaterThan(core)
      const reds = world.elementSnapshot()!.slice(0, 4)
      for (const s of reds) {
        // 고친 전: 전출력은 넷 모두 10.95–11.28 mm(반지름의 31–32 %) 벽 안에 잠든 채 남았다
        expect(s.position.x + r - ih).toBeLessThan(1e-4)
        expect(r - s.position.z).toBeCloseTo(rest, 5)
        expect(s.asleep).toBe(true)
      }
      expect(fastest).toBeLessThan(0.05)
    }
  }, 120_000)

  it('되찾는 중인 공 상태는 틱을 달리 나눠도(같은 1 ms 하위 단계 격자) 바이트까지 같고 두 번 돌려도 같다', () => {
    const start = { x: 0.9, y: -1.56, yaw: 0 }
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
    const ih = resolveSeason('biobuzz').perimeter.innerHalf
    // 틱 간격(ms)의 되풀이: 합이 20 ms라 출력이 바뀌는 1.5 s·3 s는 어느 나눔에서도 틱 경계다
    const play = (pattern: readonly number[]): SimElementState[] => {
      const world = new PhysicsWorld(spec)
      let t = 0
      for (let k = 0; t <= 5000; k++) {
        const drive = t < 1500 ? mecanum(1, 0, 0) : t < 3000 ? mecanum(-0.4, 0, 0) : {}
        world.step(t * 1_000_000, outputs(drive))
        world.drainNotices()
        t += pattern[k % pattern.length]
      }
      return world.elementSnapshot()!
    }
    const even = play([5])
    // 5 s: 벽 행이 심 아래로 나와 되찾는 중이다
    const embed = even[3].position.x + r - ih
    expect(embed).toBeGreaterThan(5e-3)
    expect(embed).toBeLessThan(core)
    expect(even[3].asleep).toBe(false)
    expect(play([2, 3, 5, 10])).toEqual(even)
    expect(play([5])).toEqual(even)
  }, 120_000)
})
