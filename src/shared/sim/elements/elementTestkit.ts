import type { DeviceValues } from '../../sidecarProtocol'
import { resolveServoParams } from '../actuatorData'
import { mecanum, outputs, robotSpec, TAG } from '../driveTestkit'
import type { FieldSpec } from '../seasons/fieldSpec'
import { resolveSeason } from '../seasons/seasons'
import { TEST_ROBOT_HEIGHT, testChassis, testMotorParams, worldV4Defaults } from '../testkit'
import { PhysicsWorld, type PhysicsWorldOptions } from '../world'
import {
  WORLD_SPEC_VERSION,
  type SimCollider,
  type SimElementKind,
  type SimElementState,
  type SimJointSpec,
  type Vec3,
  type WorldSpec
} from '../worldSpec'
import type { ElementWorldOptions } from './elementWorld'

// 경기 요소(6a) 시험의 세계·공 도구(시험 전용, 제품 코드는 쓰지 않는다).

export const TICK = 5_000_000
const HALF = 0.2286

// BIOBUZZ의 얕은 복사: 구조물 없음(벽·바닥·공 종류만), 반폭을 바꿀 수 있다(넓은 빈 바닥). 경기 요소 값은 시즌 그대로다
export function ballField(change: Partial<FieldSpec> = {}, innerHalf?: number): FieldSpec {
  const biobuzz = resolveSeason('biobuzz')
  return {
    ...biobuzz,
    structures: [],
    perimeter: innerHalf === undefined ? biobuzz.perimeter : { ...biobuzz.perimeter, innerHalf },
    ...change
  }
}

// 공 종류 하나의 물리 값을 바꾼 필드(시험: 마찰 0 등)
export function withElementType(
  field: FieldSpec,
  kind: SimElementKind,
  change: (
    t: NonNullable<FieldSpec['elements']>['types'][number]
  ) => NonNullable<FieldSpec['elements']>['types'][number]
): FieldSpec {
  const elements = field.elements as NonNullable<FieldSpec['elements']>
  return {
    ...field,
    elements: {
      ...elements,
      types: elements.types.map((t) => (t.kind === kind ? change(t) : t))
    }
  }
}

// 동역학 없는 로봇(시작 자세 구석, 충돌체 없음)과 경기 요소 칸(시작 상태는 options.elements.initial로 준다)
export function ballWorldSpec(change: Partial<WorldSpec> = {}): WorldSpec {
  return {
    version: WORLD_SPEC_VERSION,
    ...worldV4Defaults(),
    field: { season: 'biobuzz', hiveTipped: [false, false] },
    robot: {
      start: { x: -1.5, y: 1.5, yaw: 0 },
      footprint: [
        { x: HALF, y: HALF },
        { x: -HALF, y: HALF },
        { x: -HALF, y: -HALF },
        { x: HALF, y: -HALF }
      ],
      height: TEST_ROBOT_HEIGHT,
      body: testChassis(),
      colliders: []
    },
    batteryVoltage: 12,
    hubs: [],
    motors: [],
    wheels: [],
    deadWheels: [],
    pinpoints: [],
    otos: [],
    imus: [],
    joints: [],
    elements: { groups: [], preloads: [] },
    ...change
  }
}

export function ball(
  kind: SimElementKind,
  position: Vec3,
  change: Partial<Omit<SimElementState, 'kind' | 'position'>> = {}
): SimElementState {
  return {
    kind,
    position,
    orientation: [1, 0, 0, 0],
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    asleep: false,
    out: false,
    ...change
  }
}

// 세계를 틱으로 돌리며 공 상태를 모은다
export class BallRunner {
  readonly world: PhysicsWorld
  k = 0
  readonly snapshots: SimElementState[][] = []
  readonly notices: ReturnType<PhysicsWorld['drainNotices']> = []

  constructor(
    spec: WorldSpec,
    options: PhysicsWorldOptions & { elements?: ElementWorldOptions } = {},
    readonly tick = TICK
  ) {
    this.world = new PhysicsWorld(spec, options)
  }

  run(
    seconds: number,
    out: (k: number) => Record<string, DeviceValues> = () => ({}),
    each?: (k: number) => void
  ): this {
    const last = this.k + Math.round((seconds * 1e9) / this.tick)
    for (; this.k < last; this.k++) {
      this.world.step(this.k * this.tick, out(this.k))
      this.snapshots.push(this.world.elementSnapshot() ?? [])
      this.notices.push(...this.world.drainNotices())
      each?.(this.k)
    }
    return this
  }

  last(): SimElementState[] {
    return this.snapshots[this.snapshots.length - 1]
  }
}

export const speed = (v: Vec3): number => Math.hypot(v.x, v.y, v.z)

// P6 쐐기: 실제 앱 E2E(6a)의 손 씬을 세계 설명으로 옮긴 것. 18 in 상자 섀시 메카넘이 빨강 GARDEN 앞(1.2, −1.55)에서 관중석
// 벽(+X)을 보고, 앞 아래에 원기둥 인테이크 롤러(CR 서보, μ 1), 위에 15° 경사 바구니(바닥판·옆벽·뒤판)의 프리로드 넷과 그 앞을
// 막는 게이트(위치 서보), 모터 플라이휠과 후드가 있다. 인테이크를 켜고 앞 0.3으로 몰면 GARDEN 공 넷이 섀시 앞면·롤러·벽·바닥·
// 이웃 공 사이에 끼여(공마다 짝 4–6개, 15–18행) 바구니 프리로드(24행)와 합친 로봇 섬 행이 MAX_COUPLED_ROWS를 넘는다
export function intakeWedge(): {
  spec: WorldSpec
  out: (k: number) => Record<string, DeviceValues>
} {
  const deg = Math.PI / 180
  const pollen = resolveSeason('biobuzz').elements?.types.find((type) => type.kind === 'pollen')
  if (!pollen) throw new Error('BIOBUZZ POLLEN')
  const r = pollen.radius
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const box = (center: Vec3, half: Vec3): SimCollider => ({
    kind: 'box',
    center,
    rotation: I3,
    half,
    friction: 0.4
  })
  const t = 0.01
  const lane = 0.045
  const rollerR = 0.03
  // 플라이휠 축(로봇 좌표)과 반지름, 바구니 끝 공이 플라이휠에 닿는 각 γ, 경사 ρ, 게이트 틈, 후드
  const W = { x: 0.17, y: 0, z: 0.26 }
  const R = 0.05
  const gamma = 15 * deg
  const rho = 15 * deg
  const gateGap = 0.07
  const hoodAngle = 50 * deg
  const hoodBack = 0.075
  type P3 = { x: number; y: number; z: number }
  const at = (p: P3, d: P3, s: number): P3 => ({
    x: p.x + s * d.x,
    y: p.y + s * d.y,
    z: p.z + s * d.z
  })
  const ry = (angle: number): number[] => [
    Math.cos(angle),
    0,
    Math.sin(angle),
    0,
    1,
    0,
    -Math.sin(angle),
    0,
    Math.cos(angle)
  ]
  const turn = (m: number[], p: P3): P3 => ({
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z,
    y: m[3] * p.x + m[4] * p.y + m[5] * p.z,
    z: m[6] * p.x + m[7] * p.y + m[8] * p.z
  })
  const rotated = (
    origin: P3,
    rotation: number[],
    center: P3,
    half: P3,
    friction = 0.4
  ): SimCollider => ({
    kind: 'box',
    center: at(origin, turn(rotation, center), 1),
    rotation,
    half,
    friction
  })
  // 경사로: 내리막 u, 법선 nr. 끝 공(Bend)은 플라이휠 뒤에 γ로 닿는 자리, 프리로드는 게이트 틈만큼 뒤에서 위로 한 줄
  const u = { x: Math.cos(rho), y: 0, z: -Math.sin(rho) }
  const nr = { x: Math.sin(rho), y: 0, z: Math.cos(rho) }
  const bend = { x: W.x - (R + r) * Math.cos(gamma), y: 0, z: W.z + (R + r) * Math.sin(gamma) }
  const first = at(bend, u, -gateGap)
  const pitch = 2 * r + 0.002
  const preloads = [0, 1, 2, 3].map((k) =>
    at(at(first, u, -k * pitch), { x: 0, y: 0, z: 1 }, 0.001)
  )
  const surface = (p: P3): P3 => at(p, nr, -r)
  const end = surface(bend)
  const back = surface(at(preloads[3], u, -0.05))
  const mid = at({ x: (end.x + back.x) / 2, y: 0, z: (end.z + back.z) / 2 }, u, 0.01)
  const len = Math.hypot(end.x - back.x, end.z - back.z) + 0.02
  const hopper = at(mid, nr, -t / 2)
  const tilt = ry(rho)
  const hopperColliders = [
    rotated(hopper, tilt, { x: 0, y: 0, z: 0 }, { x: len / 2, y: lane + 0.01, z: t / 2 }),
    rotated(hopper, tilt, { x: 0, y: lane + 0.005, z: 0.035 }, { x: len / 2, y: 0.005, z: 0.03 }),
    rotated(hopper, tilt, { x: 0, y: -lane - 0.005, z: 0.035 }, { x: len / 2, y: 0.005, z: 0.03 }),
    rotated(
      hopper,
      tilt,
      { x: -len / 2 - 0.005, y: 0, z: 0.035 },
      { x: 0.005, y: lane + 0.01, z: 0.03 }
    )
  ]
  const hoodNormal = { x: -Math.sin(hoodAngle), y: 0, z: Math.cos(hoodAngle) }
  const hoodAlong = { x: Math.cos(hoodAngle), y: 0, z: Math.sin(hoodAngle) }
  const hoodCenter = at(at(W, hoodNormal, R + 2 * r - 0.006 + t / 2), hoodAlong, hoodBack)
  const hood = rotated(
    hoodCenter,
    ry(-hoodAngle),
    { x: 0, y: 0, z: 0 },
    { x: 0.07, y: lane + 0.01, z: t / 2 },
    0.3
  )
  const start = { x: 1.2, y: -1.55, yaw: 0 }
  const base = robotSpec({ start }, { field: { season: 'biobuzz', hiveTipped: [false, false] } })
  const intake = resolveServoParams('gobildaSpeed', 'crServo')
  const flywheel = testMotorParams(TAG, 2)
  const joints: SimJointSpec[] = [
    {
      parent: -1,
      type: 'revolute',
      origin: {
        position: { x: HALF + rollerR + 0.002, y: 0, z: 2 * r + rollerR - 0.004 },
        rotation: { x: 0, y: 0, z: 0 }
      },
      axis: { x: 0, y: 1, z: 0 },
      limits: null,
      body: {
        mass: 0.04,
        centerOfMass: { x: 0, y: 0, z: 0 },
        inertia: [8e-6, 1.6e-5, 8e-6, 0, 0, 0]
      },
      friction: { coulomb: 0.02, viscous: 0.001 },
      spring: null,
      drive: { kind: 'crServo', device: 'intake', ratio: 1, params: intake, direction: 1 },
      switches: [],
      colliders: [
        {
          kind: 'cylinder',
          a: { x: 0, y: -0.2, z: 0 },
          b: { x: 0, y: 0.2, z: 0 },
          radius: rollerR,
          friction: 1
        }
      ]
    },
    {
      parent: -1,
      type: 'revolute',
      origin: { position: W, rotation: { x: 0, y: 0, z: 0 } },
      axis: { x: 0, y: 1, z: 0 },
      limits: null,
      body: {
        mass: 0.2,
        centerOfMass: { x: 0, y: 0, z: 0 },
        inertia: [1.6e-4, 3.2e-4, 1.6e-4, 0, 0, 0]
      },
      friction: { coulomb: 0.005, viscous: 0.0002 },
      spring: null,
      drive: {
        kind: 'motor',
        devices: ['shooter'],
        ratio: 1,
        params: flywheel,
        rigging: { kind: 'direct' }
      },
      switches: [],
      colliders: [
        {
          kind: 'cylinder',
          a: { x: 0, y: -0.04, z: 0 },
          b: { x: 0, y: 0.04, z: 0 },
          radius: R,
          friction: 0.8
        }
      ]
    },
    {
      parent: -1,
      type: 'revolute',
      origin: {
        position: { x: first.x + r + 0.006, y: 0, z: first.z + r + 0.02 },
        rotation: { x: 0, y: 0, z: 0 }
      },
      axis: { x: 0, y: 1, z: 0 },
      limits: { lower: -Math.PI / 2 - 0.2, upper: 0.1 },
      body: {
        mass: 0.02,
        centerOfMass: { x: 0, y: 0, z: -0.035 },
        inertia: [4e-8, 4e-8, 4e-8, 0, 0, 0]
      },
      friction: { coulomb: 0.02, viscous: 0.001 },
      spring: null,
      drive: {
        kind: 'servo',
        device: 'gate',
        ratio: 1,
        params: resolveServoParams('gobildaSpeed', 'servo'),
        zeroPulseUs: 1500,
        direction: 1
      },
      switches: [],
      colliders: [box({ x: 0, y: 0, z: -0.035 }, { x: 0.005, y: lane - 0.005, z: 0.035 })]
    }
  ]
  const spec: WorldSpec = {
    ...base,
    robot: {
      ...base.robot,
      start,
      colliders: [
        box({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 }),
        ...hopperColliders,
        hood
      ]
    },
    motors: [
      ...base.motors,
      { device: 'shooter', modelTag: TAG, gearbox: 2, directionSign: 1, params: flywheel }
    ],
    joints,
    elements: {
      groups: ['garden'],
      preloads: preloads.map((position) => ({ kind: 'pollen' as const, body: -1, position }))
    }
  }
  const shooter: DeviceValues = {
    mode: 'RUN_WITHOUT_ENCODER',
    power: 0,
    velocity: null,
    enabled: true,
    zeroPower: 'FLOAT',
    targetPosition: null,
    encoderOffset: 0,
    encoderResets: 0
  }
  const gate: DeviceValues = { position: 0.5, pulseUs: 1500, pwm: true }
  const roller = (on: boolean): DeviceValues => ({
    power: on ? 1 : 0,
    pulseUs: on ? 2400 : 1500,
    pwm: true,
    position: 0
  })
  // 0.1 s 가만히(프리로드가 바구니에 앉음) → 인테이크를 켜고 앞 0.3
  const out = (k: number): Record<string, DeviceValues> => ({
    ...outputs(k < 20 ? {} : mecanum(0.3, 0, 0)),
    shooter,
    intake: roller(k >= 20),
    gate
  })
  return { spec, out }
}
