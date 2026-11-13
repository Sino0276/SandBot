import type { DeviceValues } from '../../sidecarProtocol'
import type { FieldSpec } from '../seasons/fieldSpec'
import { resolveSeason } from '../seasons/seasons'
import { TEST_ROBOT_HEIGHT, testChassis, worldV4Defaults } from '../testkit'
import { PhysicsWorld, type PhysicsWorldOptions } from '../world'
import {
  WORLD_SPEC_VERSION,
  type SimElementKind,
  type SimElementState,
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
