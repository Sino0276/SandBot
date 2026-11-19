import type { SimNoticeCode } from '../../play'
import type {
  Articulation,
  ContactFrames,
  ContactRow,
  CoupledElements,
  ElementPart,
  LcpState
} from '../articulation'
import { COLLISION_MARGIN, frictionTangent, OVERLAP_NOTICE_DEPTH } from '../bodyCollision'
import {
  bodyShape,
  placeShape,
  shapeBounds,
  shapeSeparation,
  staticShapes,
  type BodyShape,
  type PlacedShape,
  type StaticShape
} from '../collision3d'
import { prismHull, type Hull } from '../hull'
import { GRAVITY } from '../physics'
import { circlePolygonSeparation, placeFootprint } from '../seasons/fieldGeometry'
import type { FieldElementType, FieldSpec } from '../seasons/fieldSpec'
import { planarFrame, type Frame3 } from '../sensorFrame'
import {
  DEFAULT_COLLIDER_FRICTION,
  type Pose2,
  type SimCollider,
  type SimElementKind,
  type SimElementState,
  type SimHiveState,
  type Vec3,
  type WorldSpec
} from '../worldSpec'
import {
  normalRow,
  sphereBox,
  sphereCapsule,
  sphereCylinder,
  sphereFloor,
  sphereHull,
  sphereSphere,
  springRow,
  type BallContact,
  type V3
} from './ballContact'
import { DENSE_LCP_DECOUPLED, DENSE_LCP_REGULARIZATION } from '../denseLcp'
import { BallGrid } from './broadPhase'
import {
  AIR_DENSITY,
  CONTACT_DAMPING_RATIO,
  CONTACT_STIFFNESS_PER_PLATE,
  ISLAND_DENSE_ROWS,
  MAX_COUPLED_ROWS,
  OUT_OF_FIELD_Z,
  PINCH_NORMAL_DOT,
  REENTRY_DELAY_NANOS,
  SLEEP_SPEED,
  SLEEP_TIME,
  SLOT_GAP,
  TANGENT_COMPLIANCE_RATIO,
  V_BOUNCE
} from './elementData'
import {
  ELEMENT_FLAG_ASLEEP,
  ELEMENT_FLAG_OUT,
  GAME_POSE_SCALE,
  GAME_POSE_STRIDE,
  type GameState
} from './gameState'
import { solveIsland, UnionFind, type IslandRow } from './islands'
import {
  elementSpawns,
  nearestReentryZone,
  reentryZones,
  restBodyFrames,
  type ReentryZone
} from './spawn'

// 움직이는 경기 요소(6a: POLLEN·NECTAR 공)의 물리(spec-6a §1–§2). 순수 TS이고 결정적이다(배열 순서만 쓰고, Map은 키로 찾기만
// 한다. 벽시계·난수가 없다).
//
// 공은 관절 나무 밖의 6자유도 몸체다(대각 질량 m·1₃, 등방 관성 I·1₃). 하위 단계 h마다(로봇과 같은 1 ms 절대 격자)
//   1. prepare: 넓은 단계(정수 격자) → 깨우기(깨어 있는 공·움직이는 로봇에 닿은 잠든 공, 공끼리 퍼짐) → 자유 예측 u* = u + h·(g +
//      항력 + Magnus)와 굴림·회전 저항(앞 하위 단계 법선 충격으로 낸 상한 있는 각충격) → 접촉(바닥·벽·구조물·로봇 충돌체·다른 공)마다
//      법선 행(부드러운 법선·반발·딱딱한 심)과 마찰 상자 행 둘 → 섬(union-find). 로봇에 닿은 공의 섬은 로봇 LCP에 Schur 보수로 접어
//      (ContactRow.elements, ContactSet.elements) art.step이 함께 푼다(플라이휠 감속·롤러 반력이 저절로 나온다). 행이
//      MAX_COUPLED_ROWS를 넘으면 넘는 공은 로봇에 한쪽으로만 푼다(elementCouplingLimit).
//   2. finish: 로봇 섬 공의 u⁺(art.elementVelocities)를 읽고, 남은 섬을 작은 LCP(큰 섬은 PGS)로 푼 뒤 x⁺ = x + h·v⁺,
//      q⁺ = normalize(q + ½h·ω⁺⊗q)로 적분하고, 잠들기와 필드 밖을 본다.
// 틱 경계(tick)에서 나간 지 REENTRY_DELAY_NANOS가 지난 POLLEN을 가까운 LOADING ZONE 벽 자리에 다시 넣는다(빈 자리가 없으면 다음
// 틱에 다시 본다).
//
// 좌표: 공 상태는 필드 좌표다. 로봇과의 좁은 단계는 접촉 틀 C(Articulation.contactFrames: 부유 기저면 필드 축·원점 섀시, 고정
// 기저면 로봇 좌표)에서 하고 법선·점을 필드로 돌린다. 동역학이 없는(art null) 로봇은 시작 자세에 서 있는 정적 섀시다.
// 행 키는 'g'로 시작한다(gn·gt1·gt2 + '.' + 공 토큰 e<번호> + '/' + 상대: 로봇 r·j<i> + k<충돌체>, 정적 w0–w3·s<i>·fl, 공 e<번호>).

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const norm = (a: V3): number => Math.sqrt(dot(a, a))
const arr = (v: Vec3): V3 => [v.x, v.y, v.z]
const vec = (v: V3): Vec3 => ({ x: v[0] + 0, y: v[1] + 0, z: v[2] + 0 })
function apply(r: readonly number[], v: V3): V3 {
  return [
    r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
    r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
    r[6] * v[0] + r[7] * v[1] + r[8] * v[2]
  ]
}
function applyT(r: readonly number[], v: V3): V3 {
  return [
    r[0] * v[0] + r[3] * v[1] + r[6] * v[2],
    r[1] * v[0] + r[4] * v[1] + r[7] * v[2],
    r[2] * v[0] + r[5] * v[1] + r[8] * v[2]
  ]
}
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]
// 굴림·회전 저항을 걸 상대 각속도의 하한(rad/s) [결정: 보이는 회전보다 한참 작고 비정규 수(1e-308)보다 한참 크다]
const MIN_RESIST_RATE = 1e-30
// 공기 힘을 걸 속력 하한(m/s) [결정: 항력이 보이지 않는 속력. 비정규 수 근처의 나눗셈을 피한다]
const MIN_AIR_SPEED = 1e-9

export type ElementWorldOptions = {
  // 시작 상태(시험과 6d AUTO → TELEOP 이어 가기의 이음새). 없으면 elementSpawns(시즌 배치 → 프리로드)
  initial?: readonly SimElementState[]
  // 항력·Magnus(기본 켬, 해석 시험이 끈다)
  air?: boolean
  // 잠들기(기본 켬, 해석 시험이 끈다)
  sleep?: boolean
}

export type ElementNotice = { code: SimNoticeCode; params: Record<string, string> }

// 6c 이음새: 센서·카메라가 볼 구 층(필드 좌표, 공 순서)
export type ElementTickState = {
  count: number
  centers: Float64Array
  radii: Float64Array
  kinds: readonly SimElementKind[]
  // 비트 1 잠듦, 2 필드 밖(gameState.ts 표식과 같다)
  flags: Uint8Array
}

// 로봇 충돌체 하나: 공이 아닌 짝과 같은 BodyShape(원기둥은 외접 32각 기둥), 원기둥이면 정확한 끝점·반지름(공 짝, 몸체 틀)
type RobotShape = {
  shape: BodyShape
  cylinder: { a: V3; b: V3; r: number } | null
  friction: number
}
type RobotBody = { body: number; shapes: RobotShape[]; rMax: number; token: string }

// 이번 하위 단계에 C에 놓은 로봇 충돌체
type PlacedRobotShape = {
  placed: PlacedShape
  cylinder: { a: V3; b: V3; r: number } | null
  min: V3
  max: V3
}

// 하위 단계의 로봇 자리: C → 필드(R, o), 몸체 틀(C), 움직임
type RobotContext = {
  art: Articulation | null
  frames: ContactFrames | null
  rotation: readonly number[]
  origin: V3
  floating: boolean
  // C에 놓은 충돌체(쓸 때 한 번, 몸체 순서)
  placed: (PlacedRobotShape[] | null)[]
}

// 접촉 하나(짝마다 점 하나: 공은 구)
type Contact = {
  e: number
  // 다른 공(공끼리 짝) 또는 −1
  f: number
  // 로봇 몸체(−1 섀시, ≥ 0 관절) 또는 −2(로봇 아님)
  body: number
  // 로봇 몸체가 움직이는지(j 행이 있음)
  dynamic: boolean
  // 짝 토큰과 행 키(짝마다 한 번 만든 같은 문자열)
  keys: PairKeys
  normal: V3
  point: V3
  separation: number
  // 로봇 짝의 C 좌표(점·법선)
  pointC: V3 | null
  normalC: V3 | null
  // 다른 몸체의 각속도(필드 축, 굴림·회전 저항)
  otherOmega: V3
  mu: number
  restitution: number
  stiffness: number
  mass: number
  core: number
}

// 짝 하나의 토큰(e<번호>/<상대>)과 행 키(gn·gt1·gt2 + '.' + 토큰). 짝 번호마다 한 번 만들어 다시 쓴다: 하위 단계마다 새로 이어
// 붙인 문자열을 Map 키로 쓰면 매번 펴고 해시해야 한다(성능)
type PairKeys = { token: string; normal: string; t1: string; t2: string }

// 행 하나(필드 축 공 부분, 로봇 z 공간 j)
type BallRow = {
  key: string
  contact: number
  parts: { ball: number; a: number[] }[]
  j: number[] | null
  target: number
  lo: number
  hi: number
  compliance: number
  friction?: { normal: string; mu: number }
}

type Island = { root: number; balls: number[]; rows: number[] }

type Pending = {
  h: number
  uStar: Float64Array
  contacts: Contact[]
  rows: BallRow[]
  // 로봇 섬에 묶은 공(ContactSet.elements 순서)과 그 행
  coupled: number[]
  robotRows: number[]
  // 로봇에 닿지 않은(또는 한도로 빠진) 섬(뿌리 오름차순)
  islands: Island[]
  // 움직이는 로봇에 닿은 공(잠들지 않는다)
  robotTouch: Uint8Array
  // 이력 스프링 풀림 선에서 모양을 되찾는 중인 행이 있는 공(잠들기 시간을 세지 않는다)
  recovering: Uint8Array
}

const kindOf = (types: readonly FieldElementType[], kind: SimElementKind): FieldElementType => {
  const t = types.find((x) => x.kind === kind)
  if (!t) throw new RangeError(`elements: unknown kind ${kind}`)
  return t
}

export class ElementWorld {
  // 시험 훅: 로봇에 닿지 않은 섬을 풀기 전에 뿌리 번호로 부른다(던지면 그 섬만 실패, 제품 코드는 쓰지 않는다)
  static islandHook: ((root: number) => void) | null = null

  readonly count: number
  readonly kinds: readonly SimElementKind[]
  private readonly types: readonly FieldElementType[]
  // 공마다 시즌 종류 값과 시즌 공 가운데 가장 큰 반지름(넓은 단계 여유)
  private readonly typeOf: readonly FieldElementType[]
  private readonly largestRadius: number
  private readonly radius: Float64Array
  private readonly mass: Float64Array
  private readonly inertia: Float64Array
  private readonly air: boolean
  private readonly sleepEnabled: boolean
  // 상태(SoA, 필드 좌표)
  private readonly pos: Float64Array
  private readonly quat: Float64Array
  private readonly vel: Float64Array
  private readonly omega: Float64Array
  private readonly asleep: Uint8Array
  private readonly out: Uint8Array
  private readonly sleepTimer: Float64Array
  private readonly outSince: Float64Array
  private readonly exitPoint: Float64Array

  private readonly field: FieldSpec
  // box: 축 정렬 상자(벽, 꼭짓점이 경계 그대로라 sphereBox로 정확하다)
  private readonly statics: {
    shape: StaticShape
    min: V3 | null
    max: V3 | null
    box: boolean
  }[]
  private readonly robotBodies: RobotBody[]
  // 로봇 몸체마다 첫 충돌체의 짝 번호 오프셋과 전체 충돌체 수(짝 번호: 정적 → 로봇 충돌체 → 공)
  private readonly robotShapeOffset: number[]
  private readonly robotShapeCount: number
  private readonly pairKeys = new Map<number, PairKeys>()
  private readonly start: Pose2
  private readonly footprint: readonly { x: number; y: number }[]
  private readonly height: number
  private readonly grid: BallGrid
  private readonly zones = new Map<SimElementKind, ReentryZone[]>()

  // 앞 하위 단계의 행 충격(키 → λ)과 그 길이, LCP 상태, 짝 접선
  private impulses = new Map<string, number>()
  private lastH = 0
  private states = new Map<string, LcpState>()
  private tangents = new Map<string, V3>()
  private nextTangents = new Map<string, V3>()
  // 앞 하위 단계에 표면까지 와서 멈춘 짝의 접근 속도(두 단계 반발, ballContact.ts normalRow)
  private arrivals = new Map<string, number>()
  private nextArrivals = new Map<string, number>()
  // 끼인 행의 이력 스프링 최대 깊이(짝 토큰 → m, ballContact.ts pinchedSpringRow). 이번 하위 단계에 나온 짝만 다음으로 넘긴다
  private peaks = new Map<string, number>()
  private nextPeaks = new Map<string, number>()
  // 짝마다 앞 하위 단계의 깊이(짝 토큰 → m, −분리): 이력 스프링 주기는 깊어지는 것을 본 때만 시작한다(ballContact.ts normalRow)
  private depths = new Map<string, number>()
  private nextDepths = new Map<string, number>()
  // peak가 심에서 되찾기를 시작하며 다시 잡은 값인 짝(짝 토큰, ballContact.ts coreRecoveryRow). peaks와 같이 넘긴다
  private restoring = new Set<string>()
  private nextRestoring = new Set<string>()
  // 이번 하위 단계에 이력 스프링 풀림 선에서 모양을 되찾는 중인 행이 있는 공(Pending.recovering)
  private recovering = new Uint8Array(0)
  // 시작 겹침(실행의 첫 하위 단계)에서 이미 심 이상 눌린 짝의 깊이(짝 토큰 → m). 그 짝의 심 행은 elementCrushed를 내지 않는다:
  // 시작 겹침은 INIT 경고(worldPreloadEmbedded)가 맡는다(5 collisionOverlap과 같은 규칙). 그보다 OVERLAP_NOTICE_DEPTH 넘게
  // 깊어지면 메커니즘이 누른 것이라 알리고, 심 아래로 풀리면 지운다(그 뒤의 눌림은 진짜 눌림이다)
  private readonly startCrush = new Map<string, number>()
  private started = false
  // 이번 하위 단계의 깨어 있는 공 가운데 가장 빠른 속력(m/s, 넓은 단계 여유)
  private maxSpeed = 0
  private pending: Pending | null = null
  private readonly notices: ElementNotice[] = []
  // 표시 상태(틱마다 updateDisplay)
  private display: GameState
  private revision = 0
  // 지난 updateDisplay 뒤 공 상태(자세·표식)가 바뀌었을 수 있는지
  private moved = false

  constructor(spec: WorldSpec, field: FieldSpec, options: ElementWorldOptions = {}) {
    if (!field.elements) throw new RangeError('elements: season has no elements')
    this.field = field
    this.types = field.elements.types
    this.air = options.air ?? true
    this.sleepEnabled = options.sleep ?? true
    const initial =
      options.initial ??
      elementSpawns(
        field,
        spec.elements,
        spec.robot.start,
        restBodyFrames(spec.joints),
        spec.field.hiveTipped
      )
    const n = initial.length
    this.count = n
    this.kinds = initial.map((s) => s.kind)
    this.typeOf = initial.map((s) => kindOf(this.types, s.kind))
    this.largestRadius = this.types.reduce((m, t) => Math.max(m, t.radius), 0)
    this.radius = new Float64Array(n)
    this.mass = new Float64Array(n)
    this.inertia = new Float64Array(n)
    this.pos = new Float64Array(3 * n)
    this.quat = new Float64Array(4 * n)
    this.vel = new Float64Array(3 * n)
    this.omega = new Float64Array(3 * n)
    this.asleep = new Uint8Array(n)
    this.out = new Uint8Array(n)
    this.sleepTimer = new Float64Array(n)
    this.outSince = new Float64Array(n)
    this.exitPoint = new Float64Array(2 * n)
    initial.forEach((s, i) => {
      const t = this.typeOf[i]
      this.radius[i] = t.radius
      this.mass[i] = t.mass
      this.inertia[i] = t.inertia
      this.pos.set([s.position.x, s.position.y, s.position.z], 3 * i)
      this.quat.set(s.orientation, 4 * i)
      this.vel.set([s.velocity.x, s.velocity.y, s.velocity.z], 3 * i)
      this.omega.set([s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z], 3 * i)
      this.asleep[i] = s.asleep ? 1 : 0
      this.out[i] = s.out ? 1 : 0
      this.outSince[i] = s.out ? 0 : -1
      this.exitPoint[2 * i] = s.position.x
      this.exitPoint[2 * i + 1] = s.position.y
    })
    // 공이 부딪히는 정적 형상: 벽 넷, carrier field이고 solid ∨ occludes인 구조물(관절 몸체와 같은 집합), 바닥
    this.statics = staticShapes(field)
      .filter((s) => s.joints)
      .map((shape) => {
        if (!shape.hull) return { shape, min: null, max: null, box: false }
        const b = shapeBounds({ kind: 'hull', hull: shape.hull })
        return { shape, min: b.min, max: b.max, box: shape.target.kind === 'wall' }
      })
    this.start = spec.robot.start
    this.footprint = spec.robot.footprint
    this.height = spec.robot.height
    this.robotBodies = robotBodies(spec)
    let offset = 0
    this.robotShapeOffset = this.robotBodies.map((body) => {
      const start = offset
      offset += body.shapes.length
      return start
    })
    this.robotShapeCount = offset
    this.grid = new BallGrid(n)
    this.display = this.quantized(0)
  }

  // ---- 하위 단계 ----

  // 이번 하위 단계(h초)의 접촉을 만들고, 로봇 섬 행(밖에서 주는 행으로 art.step에 넘긴다)과 묶인 공을 돌려준다. art가 null이면
  // 로봇이 정적이라 로봇 섬이 없다. frames는 art.contactFrames()(art가 있을 때, 몸체 충돌과 같은 값)
  prepare(
    art: Articulation | null,
    frames: ContactFrames | null,
    h: number
  ): { rows: ContactRow[]; coupled: CoupledElements | undefined } {
    this.pending = null
    const n = this.count
    if (n === 0) return { rows: [], coupled: undefined }
    const ctx = this.robotContext(art, frames)
    const first = !this.started
    this.started = true
    const live = (i: number): boolean => this.out[i] === 0
    this.grid.build(n, this.pos, live)
    let maxSpeed = 0
    for (let i = 0; i < n; i++)
      if (live(i) && !this.asleep[i]) maxSpeed = Math.max(maxSpeed, norm(this.velocityOf(i)))
    this.maxSpeed = maxSpeed
    // 한 공의 접촉을 만들다 던지면(공 쪽 버그) 그 공만 이 하위 단계에 멈춘다(속도 0, 위치 그대로, 그 공의 짝은 모두 뺀다). 다른
    // 공·로봇은 그대로 간다(spec-6a §2.7의 섬 단위 실패 가두기를 접촉 만들기까지 넓힌 것[결정: 6a 리뷰. 멀리 있는 공 하나의 버그가
    // 로봇을 멈추지 않게])
    const failed = new Uint8Array(n)
    // 1. 로봇 짝(잠든 공 포함, 몸체·충돌체 순서). 움직이는 로봇 몸체에 닿은 잠든 공은 깨운다
    const robotContacts: Contact[][] = Array.from({ length: n }, () => [])
    const queue: number[] = []
    for (let i = 0; i < n; i++) if (live(i) && !this.asleep[i]) queue.push(i)
    this.robotBodies.forEach((body, b) => {
      const candidates = this.robotCandidates(ctx, body, h)
      for (const e of candidates) {
        if (failed[e]) continue
        let found: Contact[]
        try {
          found = this.robotPairs(ctx, body, b, e, h)
        } catch (error) {
          this.failBall(e, error, failed)
          continue
        }
        if (found.length === 0) continue
        robotContacts[e].push(...found)
        if (this.asleep[e] && found.some((c) => c.dynamic)) {
          this.wake(e)
          queue.push(e)
        }
      }
    })
    if (first) for (const found of robotContacts) this.recordStartCrush(found)
    // 2. 깨어 있는 공에 닿은 잠든 공을 깨운다(퍼짐)
    for (let q = 0; q < queue.length; q++) {
      const e = queue[q]
      const band = norm(this.velocityOf(e)) * h + COLLISION_MARGIN
      const reach = this.radius[e] + this.maxRadius() + band
      const c = this.centerOf(e)
      this.grid.query(c[0] - reach, c[0] + reach, c[1] - reach, c[1] + reach, (f) => {
        if (f === e || !this.asleep[f]) return
        if (sphereSphere(c, this.radius[e], this.centerOf(f), this.radius[f], band) === null) return
        this.wake(f)
        queue.push(f)
      })
    }
    // 모두 잠들었고 움직이는 로봇에 닿은 공도 없으면 이번 하위 단계에는 할 일이 없다(잠든 공은 움직이지 않는다)
    if (queue.length === 0) {
      this.tangents = new Map()
      this.nextTangents = new Map()
      this.arrivals = new Map()
      this.nextArrivals = new Map()
      this.peaks = new Map()
      this.nextPeaks = new Map()
      this.depths = new Map()
      this.nextDepths = new Map()
      this.restoring = new Set()
      this.nextRestoring = new Set()
      return { rows: [], coupled: undefined }
    }
    // 3. 자유 예측(깨어 있는 공)
    const uStar = new Float64Array(6 * n)
    for (let i = 0; i < n; i++) if (live(i) && !this.asleep[i]) this.predict(i, h, uStar)
    // 4. 접촉(공 오름차순: 로봇 → 정적 → 뒤 번호 공)
    let contacts: Contact[] = []
    for (let e = 0; e < n; e++) {
      if (!live(e) || this.asleep[e] || failed[e]) continue
      const own = robotContacts[e].slice()
      try {
        this.staticPairs(e, h, own)
        this.ballPairs(e, h, own)
      } catch (error) {
        this.failBall(e, error, failed)
        continue
      }
      contacts.push(...own)
    }
    if (first) this.recordStartCrush(contacts)
    if (failed.includes(1)) {
      contacts = contacts.filter((c) => !failed[c.e] && (c.f < 0 || !failed[c.f]))
      for (let e = 0; e < n; e++) if (failed[e]) uStar.fill(0, 6 * e, 6 * e + 6)
    }
    // 5. 굴림·회전 저항(앞 하위 단계 법선 충격, 상한 있는 각충격)
    for (const contact of contacts) this.resist(contact, h, uStar)
    // 6. 행(끼인 행은 반발 두 단계 없이 이력 스프링, 붙드는 것이 없는 심 행은 되찾기)
    const { pinched, held } = this.pinchedContacts(contacts)
    this.recovering = new Uint8Array(n)
    const rows: BallRow[] = []
    const m = art ? art.coordinates.length : 0
    contacts.forEach((contact, index) => {
      let made: BallRow[] | null
      try {
        made = this.contactRows(ctx, contact, index, h, uStar, pinched, held)
      } catch (error) {
        // 비유한 값처럼 그 짝만 뺀다
        this.notify('worldError', { detail: `element ${contact.keys.token}: ${errorText(error)}` })
        made = null
      }
      if (made) rows.push(...made)
    })
    // 7. 섬
    const robotTouch = new Uint8Array(n)
    for (const c of contacts) if (c.dynamic) robotTouch[c.e] = 1
    const plan = this.islands(contacts, rows, robotTouch)
    this.softenOneWay(plan, contacts, rows, h)
    this.tangents = this.nextTangents
    this.nextTangents = new Map()
    this.arrivals = this.nextArrivals
    this.nextArrivals = new Map()
    this.peaks = this.nextPeaks
    this.nextPeaks = new Map()
    this.depths = this.nextDepths
    this.nextDepths = new Map()
    this.restoring = this.nextRestoring
    this.nextRestoring = new Set()
    const zeros = new Array<number>(m).fill(0)
    const coupledIndex = new Map<number, number>()
    plan.coupled.forEach((e, k) => coupledIndex.set(e, k))
    const contactRows: ContactRow[] = plan.robotRows.map((r) => {
      const row = rows[r]
      const out: ContactRow = {
        key: row.key,
        j: row.j ?? zeros,
        target: row.target,
        lo: row.lo,
        hi: row.hi,
        elements: row.parts.map((p): ElementPart => ({
          element: coupledIndex.get(p.ball) as number,
          a: p.a
        }))
      }
      if (row.friction) out.friction = row.friction
      if (row.compliance > 0) out.compliance = row.compliance
      return out
    })
    let coupled: CoupledElements | undefined
    if (plan.coupled.length > 0) {
      const velocity: number[] = []
      for (const e of plan.coupled) for (let k = 0; k < 6; k++) velocity.push(uStar[6 * e + k])
      coupled = {
        count: plan.coupled.length,
        invMass: plan.coupled.map((e) => 1 / this.mass[e]),
        invInertia: plan.coupled.map((e) => 1 / this.inertia[e]),
        velocity
      }
    }
    this.pending = {
      h,
      uStar,
      contacts,
      rows,
      coupled: plan.coupled,
      robotRows: plan.robotRows,
      islands: plan.islands,
      robotTouch,
      recovering: this.recovering
    }
    return { rows: contactRows, coupled }
  }

  // prepare가 던졌을 때(world.ts): 이 하위 단계에 필드 안의 깨어 있는 공을 모두 멈춘다(속도 0, 위치 그대로: 로봇 풀이가 실패한
  // 하위 단계와 같은 규칙). 다음 하위 단계에서 다시 푼다. 던지기 전에 만든 행이 다음 하위 단계로 넘기려고 적어 둔 짝 상태는
  // 모두 버린다(앞 깊이도: 남기면 다음 하위 단계에 접촉이 없던 짝이 그다음에 '앞 하위 단계에 있었다'로 보인다)
  failSubstep(): void {
    this.pending = null
    this.nextTangents = new Map()
    this.nextArrivals = new Map()
    this.nextPeaks = new Map()
    this.nextDepths = new Map()
    this.nextRestoring = new Set()
    for (let e = 0; e < this.count; e++) {
      if (this.out[e] || this.asleep[e]) continue
      this.vel.fill(0, 3 * e, 3 * e + 3)
      this.omega.fill(0, 3 * e, 3 * e + 3)
    }
  }

  // art.step 뒤(실패했으면 failed): 로봇 섬 공의 u⁺를 읽고 남은 섬을 풀어 적분·잠들기·필드 밖. tEnd: 이 하위 단계 끝 시각(ns)
  finish(art: Articulation | null, h: number, failed: boolean, tEnd: number): void {
    const p = this.pending
    this.pending = null
    if (!p) return
    const n = this.count
    const u = Float64Array.from(p.uStar)
    const impulses = new Map<string, number>()
    const nextStates = new Map<string, LcpState>()
    if (p.coupled.length > 0) {
      const solved = failed || !art ? null : art.elementVelocities()
      p.coupled.forEach((e, k) => {
        for (let i = 0; i < 6; i++) u[6 * e + i] = solved ? solved[6 * k + i] : 0
      })
      for (const r of p.robotRows) {
        const key = p.rows[r].key
        impulses.set(key, failed || !art ? 0 : art.contactImpulse(key))
      }
    }
    // 로봇에 한쪽으로만 푸는 행의 로봇 속도(풀이 뒤)
    const robotV = art ? art.v : null
    const previous = (key: string): number =>
      this.lastH > 0 ? ((this.impulses.get(key) ?? 0) * h) / this.lastH : 0
    // 섬이 던지면 그 섬만 멈춘다(위치 그대로, 속도 0). 다른 섬·로봇은 그대로 간다
    const fail = (island: Island, error: unknown): void => {
      for (const e of island.balls) for (let i = 0; i < 6; i++) u[6 * e + i] = 0
      for (const r of island.rows) impulses.set(p.rows[r].key, 0)
      this.notify('worldError', { detail: `element island e${island.root}: ${errorText(error)}` })
    }
    for (const island of p.islands) {
      try {
        ElementWorld.islandHook?.(island.root)
      } catch (error) {
        fail(island, error)
        continue
      }
      if (this.solveSingleContact(p, island, u, robotV, impulses)) continue
      // 공 하나뿐인 섬(가장 흔함)은 찾기 표 없이 slot 0
      const single = island.balls.length === 1 ? island.balls[0] : -1
      const slot = single >= 0 ? null : new Map<number, number>()
      island.balls.forEach((e, k) => slot?.set(e, k))
      let normalRow = -1
      const rows: IslandRow[] = island.rows.map((r, index) => {
        const row = p.rows[r]
        let fixed = 0
        const parts: { slot: number; a: readonly number[] }[] = []
        for (const part of row.parts) {
          const k = single >= 0 ? (part.ball === single ? 0 : undefined) : slot?.get(part.ball)
          if (k !== undefined) parts.push({ slot: k, a: part.a })
          else fixed += rate6(part.a, u, 6 * part.ball)
        }
        if (row.j && robotV) for (let c = 0; c < row.j.length; c++) fixed += row.j[c] * robotV[c]
        const out: IslandRow = {
          key: row.key,
          parts,
          fixed,
          target: row.target,
          lo: row.lo,
          hi: row.hi,
          compliance: row.compliance
        }
        // 짝의 행은 법선 → 접선 순으로 이어져 있다(contactRows)
        if (row.friction) {
          out.friction = row.friction
          out.normalRow = normalRow
        } else normalRow = index
        return out
      })
      const uIsland: number[] = []
      for (const e of island.balls) for (let k = 0; k < 6; k++) uIsland.push(u[6 * e + k])
      try {
        const solved = solveIsland(
          rows,
          {
            invMass: island.balls.map((e) => 1 / this.mass[e]),
            invInertia: island.balls.map((e) => 1 / this.inertia[e])
          },
          uIsland,
          previous,
          this.states,
          nextStates,
          rows.length <= ISLAND_DENSE_ROWS,
          impulses
        )
        if (!solved.every((x) => Number.isFinite(x))) throw new Error('diverged')
        island.balls.forEach((e, k) => {
          for (let i = 0; i < 6; i++) u[6 * e + i] = solved[6 * k + i]
        })
      } catch (error) {
        fail(island, error)
      }
      if (rows.length > ISLAND_DENSE_ROWS) this.notify('elementIslandLarge', {})
    }
    this.impulses = impulses
    this.states = nextStates
    this.lastH = h
    // 적분(깨어 있고 필드 안인 공)
    for (let e = 0; e < n; e++) {
      if (this.out[e] || this.asleep[e]) continue
      for (let i = 0; i < 3; i++) {
        this.vel[3 * e + i] = u[6 * e + i]
        this.omega[3 * e + i] = u[6 * e + 3 + i]
      }
      for (let i = 0; i < 3; i++) this.pos[3 * e + i] += h * this.vel[3 * e + i]
      this.rotate(e, h)
      this.moved = true
    }
    this.sleepStep(p, h)
    this.outOfField(tEnd)
  }

  // 공 하나·접촉 하나(법선 + 접선 0–2)의 섬(바닥에서 쉬거나 구르는 공, 가장 흔함)을 할당 없이 푼다. 법선 n과 접선 t1 ⟂ t2 ⟂ n이라
  // 공 질량이 대각이면 A가 대각이고(비대각이 denseLcp.ts DENSE_LCP_DECOUPLED 아래인지 확인한다), 그러면 엇갈림 두 회차를 거친
  // 일반 풀이(islands.ts solveIsland)의 해는 행마다 자른 값 λₙ = clamp(−bₙ/(Aₙₙ(1 + ε))), λₜ = clamp(−bₜ/(Aₜₜ(1 + ε)),
  // ±μ·max(0, λₙ))와 같다(같은 순서의 같은 연산). 해당하지 않으면 거짓(일반 풀이로)
  private solveSingleContact(
    p: Pending,
    island: Island,
    u: Float64Array,
    robotV: readonly number[] | null,
    impulses: Map<string, number>
  ): boolean {
    if (island.balls.length !== 1 || island.rows.length === 0 || island.rows.length > 3)
      return false
    const e = island.balls[0]
    const rows = island.rows.map((r) => p.rows[r])
    const first = rows[0]
    if (first.friction || first.parts.length !== 1) return false
    for (let k = 1; k < rows.length; k++)
      if (
        rows[k].contact !== first.contact ||
        rows[k].friction?.normal !== first.key ||
        rows[k].parts.length !== 1
      )
        return false
    const im = 1 / this.mass[e]
    const ii = 1 / this.inertia[e]
    const o = 6 * e
    const diagonal: number[] = []
    const b: number[] = []
    for (const row of rows) {
      const a = row.parts[0].a
      diagonal.push(
        im * (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) +
          ii * (a[3] * a[3] + a[4] * a[4] + a[5] * a[5]) +
          row.compliance
      )
      let fixed = 0
      if (row.j && robotV) for (let c = 0; c < row.j.length; c++) fixed += row.j[c] * robotV[c]
      // islands.ts rate()와 같은 결합 순서(정적 몫 + (a·u))
      b.push(
        fixed +
          (a[0] * u[o] +
            a[1] * u[o + 1] +
            a[2] * u[o + 2] +
            a[3] * u[o + 3] +
            a[4] * u[o + 4] +
            a[5] * u[o + 5]) -
          row.target
      )
    }
    for (let k = 0; k < rows.length; k++)
      for (let l = k + 1; l < rows.length; l++) {
        const a = rows[k].parts[0].a
        const c = rows[l].parts[0].a
        const off =
          im * (a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) +
          ii * (a[3] * c[3] + a[4] * c[4] + a[5] * c[5])
        if (!(Math.abs(off) <= DENSE_LCP_DECOUPLED * Math.sqrt(diagonal[k] * diagonal[l])))
          return false
      }
    const lambda: number[] = []
    rows.forEach((row, k) => {
      let lo = row.lo
      let hi = row.hi
      if (row.friction) {
        const bound = row.friction.mu * Math.max(0, lambda[0])
        if (!(bound > 0)) {
          lambda.push(0)
          return
        }
        lo = -bound
        hi = bound
      }
      const value = -b[k] / (diagonal[k] * (1 + DENSE_LCP_REGULARIZATION))
      lambda.push(value <= lo ? lo : value >= hi ? hi : value)
    })
    if (!lambda.every((x) => Number.isFinite(x))) return false
    rows.forEach((row, k) => {
      impulses.set(row.key, lambda[k])
      if (lambda[k] === 0) return
      const a = row.parts[0].a
      const linear = im * lambda[k]
      const angular = ii * lambda[k]
      for (let i = 0; i < 3; i++) {
        u[o + i] += linear * a[i]
        u[o + 3 + i] += angular * a[3 + i]
      }
    })
    return true
  }

  // ---- 틱 경계 ----

  // 다시 넣기(spec-6a §2.8): 나간 지 REENTRY_DELAY_NANOS가 지난 공(다시 넣는 종류)을 나간 자리에서 가장 가까운 LOADING ZONE의
  // 벽 자리 가운데 로봇(지금 외곽 프리즘과 충돌체)·다른 공과 겹치지 않는 첫 자리에 쉬는 상태(깨어 있음)로 넣는다. 빈 자리가 없으면
  // 다음 틱에 다시 본다. pose: 로봇의 지금 자세, frames: 지금 접촉 틀(관절 몸체 충돌체, 동역학이 없으면 null)
  tick(
    tNanos: number,
    robot: { pose: Pose2; frames: () => ContactFrames | null; floating: boolean }
  ): void {
    let ctx: RobotContext | null = null
    let outline: { x: number; y: number }[] | null = null
    for (let e = 0; e < this.count; e++) {
      if (!this.out[e] || tNanos - this.outSince[e] < REENTRY_DELAY_NANOS) continue
      const zones = this.reentryZonesOf(this.kinds[e])
      const zone = nearestReentryZone(zones, {
        x: this.exitPoint[2 * e],
        y: this.exitPoint[2 * e + 1]
      })
      if (!zone) continue
      outline ??= placeFootprint(this.footprint, robot.pose)
      ctx ??= this.robotContext(null, robot.frames(), robot.floating)
      const r = this.radius[e]
      const slot = zone.slots.find((s) => this.slotFree(ctx as RobotContext, outline ?? [], s, r))
      if (!slot) continue
      this.pos.set([slot.x, slot.y, slot.z], 3 * e)
      // [결정: 다시 넣은 공의 방향은 단위 사원수(공은 등방이라 물리에 영향이 없다)]
      this.quat.set([1, 0, 0, 0], 4 * e)
      this.vel.fill(0, 3 * e, 3 * e + 3)
      this.omega.fill(0, 3 * e, 3 * e + 3)
      this.out[e] = 0
      this.asleep[e] = 0
      this.sleepTimer[e] = 0
      this.outSince[e] = -1
      this.moved = true
      this.notify('elementReentered', { kind: this.kinds[e] })
    }
  }

  // 표시 상태를 다시 줄인다(틱마다). 줄인 값·표식이 바뀌었을 때만 revision이 는다. 지난번 뒤 아무 공도 움직이지 않았으면(모두
  // 잠들었거나 밖) 다시 줄이지 않는다
  updateDisplay(): void {
    if (!this.moved) return
    this.moved = false
    const next = this.quantized(this.revision)
    const same =
      next.poses.length === this.display.poses.length &&
      next.poses.every((x, i) => x === this.display.poses[i]) &&
      next.flags.every((x, i) => x === this.display.flags[i])
    if (same) return
    this.revision++
    this.display = { ...next, revision: this.revision }
  }

  gameState(): GameState {
    return {
      revision: this.display.revision,
      poses: this.display.poses.slice(),
      flags: this.display.flags.slice()
    }
  }

  // 전체 정밀도 상태(6d 이어 가기·시험)
  snapshot(): SimElementState[] {
    return Array.from({ length: this.count }, (_, i) => this.stateOf(i))
  }

  // 움직이는 HIVE 상태(6b 계약, spec-6b §2 Outputs: FieldSpec.hives 순서). HIVE 동역학을 넣기 전이라 아직 null(움직이는 HIVE
  // 없음)이다
  hiveSnapshot(): SimHiveState[] | null {
    return null
  }

  // 카메라가 태그 자세에 쓸 HIVE 각 [빨강, 파랑](6b 계약, spec-6b §6). 움직이는 HIVE가 없으면 null(시작 상태 태그 자세 그대로)
  hiveAngles(): readonly [number, number] | null {
    return null
  }

  tickState(): ElementTickState {
    const flags = new Uint8Array(this.count)
    for (let i = 0; i < this.count; i++) flags[i] = (this.asleep[i] ? 1 : 0) | (this.out[i] ? 2 : 0)
    return {
      count: this.count,
      centers: Float64Array.from(this.pos),
      radii: Float64Array.from(this.radius),
      kinds: this.kinds.slice(),
      flags
    }
  }

  drainNotices(): ElementNotice[] {
    return this.notices.splice(0, this.notices.length)
  }

  // ---- 안쪽 ----

  private notify(code: SimNoticeCode, params: Record<string, string>): void {
    this.notices.push({ code, params })
  }

  // 첫 하위 단계의 접촉 가운데 이미 심 이상 눌린 짝의 깊이를 적는다(startCrush)
  private recordStartCrush(contacts: readonly Contact[]): void {
    for (const c of contacts)
      if (-c.separation >= c.core) this.startCrush.set(c.keys.token, -c.separation)
  }

  // 공 e의 접촉 만들기가 던졌다(prepare의 공 단위 실패 가두기)
  private failBall(e: number, error: unknown, failed: Uint8Array): void {
    failed[e] = 1
    this.notify('worldError', { detail: `element e${e}: ${errorText(error)}` })
  }

  private stateOf(i: number): SimElementState {
    const p = this.pos
    const q = this.quat
    return {
      kind: this.kinds[i],
      position: { x: p[3 * i] + 0, y: p[3 * i + 1] + 0, z: p[3 * i + 2] + 0 },
      orientation: [q[4 * i] + 0, q[4 * i + 1] + 0, q[4 * i + 2] + 0, q[4 * i + 3] + 0],
      velocity: vec(this.velocityOf(i)),
      angularVelocity: vec(this.omegaOf(i)),
      asleep: this.asleep[i] === 1,
      out: this.out[i] === 1
    }
  }

  // gameState.ts quantizeElements(this.snapshot())와 같은 정수(공 객체를 만들지 않고 배열에서 바로)
  private quantized(revision: number): GameState {
    const n = this.count
    const poses = new Array<number>(GAME_POSE_STRIDE * n)
    const flags = new Array<number>(n)
    const q = (value: number): number => Math.round(value * GAME_POSE_SCALE) + 0
    for (let i = 0; i < n; i++) {
      const o = GAME_POSE_STRIDE * i
      poses[o] = q(this.pos[3 * i])
      poses[o + 1] = q(this.pos[3 * i + 1])
      poses[o + 2] = q(this.pos[3 * i + 2])
      for (let k = 0; k < 4; k++) poses[o + 3 + k] = q(this.quat[4 * i + k])
      flags[i] = (this.asleep[i] ? ELEMENT_FLAG_ASLEEP : 0) | (this.out[i] ? ELEMENT_FLAG_OUT : 0)
    }
    return { revision, poses, flags }
  }

  private centerOf(i: number): V3 {
    return [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]]
  }
  private velocityOf(i: number): V3 {
    return [this.vel[3 * i], this.vel[3 * i + 1], this.vel[3 * i + 2]]
  }
  private omegaOf(i: number): V3 {
    return [this.omega[3 * i], this.omega[3 * i + 1], this.omega[3 * i + 2]]
  }
  private maxRadius(): number {
    return this.largestRadius
  }

  // 공 e와 상대(code: 정적 순번 → 로봇 충돌체 → 공)의 짝 키(처음 쓸 때 한 번 만든다)
  private keysFor(e: number, code: number, token: () => string): PairKeys {
    const id = e * (this.statics.length + this.robotShapeCount + this.count) + code
    let keys = this.pairKeys.get(id)
    if (!keys) {
      const t = token()
      keys = { token: t, normal: `gn.${t}`, t1: `gt1.${t}`, t2: `gt2.${t}` }
      this.pairKeys.set(id, keys)
    }
    return keys
  }

  private wake(e: number): void {
    this.asleep[e] = 0
    this.sleepTimer[e] = 0
    this.moved = true
  }

  // 자유 예측 u* = u + h·(g + (항력 + Magnus)/m)(명시적). 항력 −½ρC_dA|v|v, Magnus ½ρA·min(C_Lmax, s·r|ω|/|v|)·|v|²·(ω̂ × v̂)
  private predict(e: number, h: number, uStar: Float64Array): void {
    const v = this.velocityOf(e)
    const w = this.omegaOf(e)
    let force: V3 = [0, 0, 0]
    if (this.air) {
      const t = this.typeOf[e]
      const r = this.radius[e]
      const area = Math.PI * r * r
      const speed = norm(v)
      if (speed > MIN_AIR_SPEED) {
        const drag = -0.5 * AIR_DENSITY * t.air.dragCoefficient * area * speed
        force = scale(v, drag)
        const spin = norm(w)
        if (spin > MIN_RESIST_RATE) {
          const lift = Math.min(t.air.magnusMax, (t.air.magnusSlope * r * spin) / speed)
          const axis = cross(w, v)
          const l = norm(axis)
          if (l > MIN_RESIST_RATE)
            force = add(force, scale(axis, (0.5 * AIR_DENSITY * area * lift * speed * speed) / l))
        }
      }
    }
    const im = 1 / this.mass[e]
    uStar[6 * e] = v[0] + h * force[0] * im
    uStar[6 * e + 1] = v[1] + h * force[1] * im
    uStar[6 * e + 2] = v[2] + h * (force[2] * im - GRAVITY)
    uStar[6 * e + 3] = w[0]
    uStar[6 * e + 4] = w[1]
    uStar[6 * e + 5] = w[2]
  }

  // q⁺ = normalize(q + ½h·(0, ω)⊗q)(제곱근만)
  private rotate(e: number, h: number): void {
    const o = 4 * e
    const w = this.omegaOf(e)
    if (w[0] === 0 && w[1] === 0 && w[2] === 0) return
    const q0 = this.quat[o]
    const qv: V3 = [this.quat[o + 1], this.quat[o + 2], this.quat[o + 3]]
    const half = 0.5 * h
    const d0 = -dot(w, qv)
    const dv = add(scale(w, q0), cross(w, qv))
    const n0 = q0 + half * d0
    const n1 = qv[0] + half * dv[0]
    const n2 = qv[1] + half * dv[1]
    const n3 = qv[2] + half * dv[2]
    const l = Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2 + n3 * n3)
    this.quat[o] = n0 / l
    this.quat[o + 1] = n1 / l
    this.quat[o + 2] = n2 / l
    this.quat[o + 3] = n3 / l
  }

  // C → 필드 변환과 몸체 틀. 부유 기저: 축은 필드, 원점 = 섀시 원점. 고정 기저·동역학 없음: C = 로봇 좌표(시작 자세, 섀시가
  // 움직이지 않는다). floating을 주지 않으면 art의 기저로 정한다(틱 경계 검사는 art 없이 틀만 받는다)
  private robotContext(
    art: Articulation | null,
    frames: ContactFrames | null,
    floating: boolean = art !== null && art.basePose() !== null
  ): RobotContext {
    if (floating && frames)
      return {
        art,
        frames,
        rotation: IDENTITY,
        origin: arr(frames.origin),
        floating,
        placed: this.robotBodies.map(() => null)
      }
    const frame = planarFrame(this.start)
    return {
      art,
      frames,
      rotation: frame.rotation,
      origin: arr(frame.origin),
      floating: false,
      placed: this.robotBodies.map(() => null)
    }
  }

  // 몸체 b의 C 틀(동역학이 없으면 섀시만, 단위 틀)
  private bodyFrame(ctx: RobotContext, body: number): Frame3 | null {
    if (ctx.frames) return ctx.frames.bodies[body + 1] ?? null
    return body < 0 ? { rotation: IDENTITY, origin: { x: 0, y: 0, z: 0 } } : null
  }

  private placedBody(ctx: RobotContext, b: number): PlacedRobotShape[] {
    const cached = ctx.placed[b]
    if (cached) return cached
    const body = this.robotBodies[b]
    const frame = this.bodyFrame(ctx, body.body)
    const out: PlacedRobotShape[] = []
    if (frame) {
      const o = arr(frame.origin)
      for (const s of body.shapes) {
        const placed = placeShape(s.shape, frame)
        const bounds = shapeBounds(placed)
        out.push({
          placed,
          cylinder: s.cylinder
            ? {
                a: add(apply(frame.rotation, s.cylinder.a), o),
                b: add(apply(frame.rotation, s.cylinder.b), o),
                r: s.cylinder.r
              }
            : null,
          min: bounds.min,
          max: bounds.max
        })
      }
    }
    ctx.placed[b] = out
    return out
  }

  // 로봇 몸체 하나의 근처 공(번호 오름차순): 몸체 원점 둘레 rMax + 공 반지름 + 여유 안
  private robotCandidates(ctx: RobotContext, body: RobotBody, h: number): number[] {
    const maxSpeed = this.maxSpeed
    if (body.shapes.length === 0) return []
    const frame = this.bodyFrame(ctx, body.body)
    if (!frame) return []
    const center = add(apply(ctx.rotation, arr(frame.origin)), ctx.origin)
    let speed = 0
    if (ctx.frames) {
      const velocity = ctx.frames.velocities[body.body + 1]
      speed = norm(arr(velocity.linear)) + norm(arr(velocity.omega)) * body.rMax
    }
    const reach = body.rMax + this.maxRadius() + (speed + maxSpeed) * h + COLLISION_MARGIN
    const found: number[] = []
    this.grid.query(
      center[0] - reach,
      center[0] + reach,
      center[1] - reach,
      center[1] + reach,
      (e) => {
        const c = this.centerOf(e)
        if (norm(sub(c, center)) <= reach) found.push(e)
      }
    )
    return found.sort((x, y) => x - y)
  }

  // 공 e와 로봇 몸체 b의 접촉(충돌체 순서)
  private robotPairs(
    ctx: RobotContext,
    body: RobotBody,
    b: number,
    e: number,
    h: number
  ): Contact[] {
    const r = this.radius[e]
    const cF = this.centerOf(e)
    const cC = applyT(ctx.rotation, sub(cF, ctx.origin))
    const dynamic = ctx.art !== null && (body.body >= 0 || ctx.floating)
    // 로봇 몸체 점(공 중심 자리)의 속도(필드 축)
    let robotV: V3 = [0, 0, 0]
    let robotW: V3 = [0, 0, 0]
    if (dynamic && ctx.art && ctx.frames) {
      robotV = apply(ctx.rotation, arr(ctx.art.pointVelocity(ctx.frames, body.body, vec(cC))))
      robotW = apply(ctx.rotation, arr(ctx.frames.velocities[body.body + 1].omega))
    }
    const band = norm(sub(this.velocityOf(e), robotV)) * h + COLLISION_MARGIN
    const t = this.typeOf[e]
    const out: Contact[] = []
    this.placedBody(ctx, b).forEach((shape, k) => {
      for (let i = 0; i < 3; i++)
        if (cC[i] + r + band < shape.min[i] || cC[i] - r - band > shape.max[i]) return
      let found: BallContact | null
      if (shape.cylinder)
        found = sphereCylinder(cC, r, shape.cylinder.a, shape.cylinder.b, shape.cylinder.r, band)
      else if (shape.placed.kind === 'hull') found = sphereHull(cC, r, shape.placed.hull, band)
      else found = sphereCapsule(cC, r, shape.placed, band)
      if (!found) return
      const friction = body.shapes[k].friction
      out.push({
        e,
        f: -1,
        body: body.body,
        dynamic,
        keys: this.keysFor(
          e,
          this.statics.length + this.robotShapeOffset[b] + k,
          () => `e${e}/${body.token}k${k}`
        ),
        normal: apply(ctx.rotation, found.normal),
        point: add(apply(ctx.rotation, found.point), ctx.origin),
        separation: found.separation,
        pointC: found.point,
        normalC: found.normal,
        otherOmega: robotW,
        mu: (t.contact.friction + friction) / 2,
        restitution: t.contact.restitution.robot,
        stiffness: CONTACT_STIFFNESS_PER_PLATE * t.contact.plateStiffness,
        mass: this.mass[e],
        core: t.contact.coreDepthRatio * r
      })
    })
    return out
  }

  // 공 e와 정적 형상(벽 넷 → 구조물 → 바닥)
  private staticPairs(e: number, h: number, out: Contact[]): void {
    const r = this.radius[e]
    const c = this.centerOf(e)
    const band = norm(this.velocityOf(e)) * h + COLLISION_MARGIN
    const t = this.typeOf[e]
    for (let index = 0; index < this.statics.length; index++) {
      const st = this.statics[index]
      let found: BallContact | null
      if (st.shape.kind === 'floor') found = sphereFloor(c, r, band)
      else {
        const min = st.min as V3
        const max = st.max as V3
        let near = true
        for (let i = 0; i < 3; i++)
          if (c[i] + r + band < min[i] || c[i] - r - band > max[i]) near = false
        if (!near) continue
        found = st.box
          ? sphereBox(c, r, min, max, band)
          : sphereHull(c, r, st.shape.hull as Hull, band)
      }
      if (!found) continue
      const floor = st.shape.kind === 'floor'
      out.push({
        e,
        f: -1,
        body: -2,
        dynamic: false,
        keys: this.keysFor(e, index, () => `e${e}/${st.shape.token}`),
        normal: found.normal,
        point: found.point,
        separation: found.separation,
        pointC: null,
        normalC: null,
        otherOmega: [0, 0, 0],
        mu: (t.contact.friction + st.shape.friction) / 2,
        restitution: floor ? t.contact.restitution.floor : t.contact.restitution.hard,
        stiffness: CONTACT_STIFFNESS_PER_PLATE * t.contact.plateStiffness,
        mass: this.mass[e],
        core: t.contact.coreDepthRatio * r
      })
    }
  }

  // 공 e와 뒤 번호의 깨어 있는 공(번호 오름차순). 스프링은 두 접촉 스프링의 직렬, 질량은 환산 질량
  private ballPairs(e: number, h: number, out: Contact[]): void {
    const r = this.radius[e]
    const c = this.centerOf(e)
    const v = this.velocityOf(e)
    const reach = r + this.maxRadius() + 2 * this.maxSpeed * h + COLLISION_MARGIN
    const others: number[] = []
    this.grid.query(c[0] - reach, c[0] + reach, c[1] - reach, c[1] + reach, (f) => {
      if (f > e && !this.asleep[f]) others.push(f)
    })
    others.sort((x, y) => x - y)
    const te = this.typeOf[e]
    for (const f of others) {
      const band = norm(sub(v, this.velocityOf(f))) * h + COLLISION_MARGIN
      const found = sphereSphere(c, r, this.centerOf(f), this.radius[f], band)
      if (!found) continue
      const tf = this.typeOf[f]
      const ke = CONTACT_STIFFNESS_PER_PLATE * te.contact.plateStiffness
      const kf = CONTACT_STIFFNESS_PER_PLATE * tf.contact.plateStiffness
      out.push({
        e,
        f,
        body: -2,
        dynamic: false,
        keys: this.keysFor(e, this.statics.length + this.robotShapeCount + f, () => `e${e}/e${f}`),
        normal: found.normal,
        point: found.point,
        separation: found.separation,
        pointC: null,
        normalC: null,
        otherOmega: this.omegaOf(f),
        // 마찰은 Unity Average 결합, 반발은 두 공의 공끼리 값 평균[결정], 스프링은 두 접촉 스프링의 직렬
        mu: (te.contact.friction + tf.contact.friction) / 2,
        restitution: (te.contact.restitution.element + tf.contact.restitution.element) / 2,
        stiffness: (ke * kf) / (ke + kf),
        mass: (this.mass[e] * this.mass[f]) / (this.mass[e] + this.mass[f]),
        // [결정: 두 공이 같이 눌리므로 심 깊이는 두 반지름 비의 합]
        core: te.contact.coreDepthRatio * r + tf.contact.coreDepthRatio * this.radius[f]
      })
    }
  }

  // 굴림·회전 저항(spec-6a §2.1): 앞 하위 단계 이 짝 법선 충격 λ′로 상대 각속도의 접선 성분을 min(μ_rr·r·λ′, |ω_t|/Σ(1/I))만큼,
  // 법선 성분을 min(μ·r_s·λ′, |ω_n|/Σ(1/I))만큼 줄이는 각충격(공 둘이면 서로 반대로). 로봇 몸체는 반작용을 받지 않는다
  // [가정: 공 굴림 저항 토크(μ_rr·r·N, 1 N에 약 2 mN·m)는 로봇 동역학에 보이지 않는다. 명시적 근사라 LCP 행을 늘리지 않는다].
  // 공끼리 짝은 두 공 값의 평균 계수·반지름 [결정]
  private resist(contact: Contact, h: number, uStar: Float64Array): void {
    if (this.lastH <= 0) return
    const lambda = ((this.impulses.get(contact.keys.normal) ?? 0) * h) / this.lastH
    if (!(lambda > 0)) return
    const e = contact.e
    const f = contact.f
    const te = this.typeOf[e]
    const we: V3 = [uStar[6 * e + 3], uStar[6 * e + 4], uStar[6 * e + 5]]
    const wo: V3 =
      f >= 0 ? [uStar[6 * f + 3], uStar[6 * f + 4], uStar[6 * f + 5]] : contact.otherOmega
    const rel = sub(we, wo)
    const n = contact.normal
    const wn = dot(rel, n)
    const along = scale(n, wn)
    const tangent = sub(rel, along)
    const ie = this.inertia[e]
    const inverse = 1 / ie + (f >= 0 ? 1 / this.inertia[f] : 0)
    let rolling = te.contact.rollingResistance
    let spinRadius = te.contact.spinRadius
    let r = this.radius[e]
    if (f >= 0) {
      const tf = this.typeOf[f]
      rolling = (rolling + tf.contact.rollingResistance) / 2
      spinRadius = (spinRadius + tf.contact.spinRadius) / 2
      r = (r + this.radius[f]) / 2
    }
    const change = (axis: V3, size: number, limit: number): void => {
      // 아주 작은(비정규 수 근처) 상대 각속도는 다루지 않는다: 1/size가 무한대가 되어 0·∞ = NaN이 생긴다
      if (!(size > MIN_RESIST_RATE)) return
      const impulse = Math.min(limit, size / inverse)
      const unit: V3 = [axis[0] / size, axis[1] / size, axis[2] / size]
      for (let i = 0; i < 3; i++) {
        uStar[6 * e + 3 + i] -= (impulse / ie) * unit[i]
        if (f >= 0) uStar[6 * f + 3 + i] += (impulse / this.inertia[f]) * unit[i]
      }
    }
    change(tangent, norm(tangent), rolling * r * lambda)
    change(along, Math.abs(wn), contact.mu * spinRadius * lambda)
  }

  // 끼인 행(spec-6a §2.3 반발의 예외, ballContact.ts normalRow): 접촉마다, 그 법선(공 쪽으로)이 같은 공의 다른 접촉 법선과의
  // 내적이 PINCH_NORMAL_DOT보다 작으면(서로 반대쪽: 로봇과 벽 사이, 롤러와 후드 사이, 공을 바닥에 누르는 팔 아래) 그 공 쪽에서
  // 끼였다. 공끼리 짝은 두 공 모두 끼였을 때만 끼인 행이다(f 쪽 법선은 −n, 한 공이라도 튀어 나갈 수 있으면 반발한다). 행마다
  // 본다[결정: 6a 리뷰. 공마다 보면 y로 붙은 이웃이나 위에 얹힌 공 때문에 그 축과 직각으로 로봇이 쳐 내는 행까지 반발을 잃었다]
  //
  // 붙들림(held, 6a 리뷰 3: 심 행이 되찾아도 되는지, ballContact.ts normalRow free): 끼임과 같은 꼴이지만 반대쪽 접촉이 단단할
  // 때만 센다. 단단한 접촉은 로봇·정적 형상과의 접촉이거나, 그 너머의 공이 다시 단단한 것에 받쳐진 공끼리 접촉이다(받침을 공
  // 사슬로 따라가는 가장 작은 고정점: 판 → 공 → 공 → 벽은 모두 붙들리고, 판이 떠나면 벽 쪽 공까지 모두 풀린다). 공끼리 짝은 두 공
  // 모두 받쳐졌을 때만 붙들린다[결정: 반대쪽에 닿기만 한 자유로운 공(되찾은 뒤 옆에 붙어 쉬는 공, 위에 얹힌 공)까지 세면 그 공이
  // 닿아 있는 동안 벽 쪽 공이 심에 남는다. 가벼운 공은 되찾기에 밀려도 에너지가 문제 되지 않는다. 로봇은 닿아 있기만 해도 센다:
  // 멈춰 있는 로봇을 되찾기가 밀면 안 된다]. 심 이상 눌린 접촉이 없으면 계산하지 않는다(held는 모두 0)
  private pinchedContacts(contacts: readonly Contact[]): { pinched: Uint8Array; held: Uint8Array } {
    const n = this.count
    const start = new Int32Array(n + 1)
    for (const c of contacts) {
      start[c.e + 1]++
      if (c.f >= 0) start[c.f + 1]++
    }
    for (let i = 0; i < n; i++) start[i + 1] += start[i]
    const next = start.slice(0, n)
    const total = start[n]
    const normals = new Float64Array(3 * total)
    // 칸마다 접촉 번호와 쪽(0: e, 1: f)
    const owner = new Int32Array(total)
    const side = new Uint8Array(total)
    const put = (ball: number, normal: V3, sign: number, k: number, f: number): void => {
      const slot = next[ball]++
      const o = 3 * slot
      normals[o] = sign * normal[0]
      normals[o + 1] = sign * normal[1]
      normals[o + 2] = sign * normal[2]
      owner[slot] = k
      side[slot] = f
    }
    contacts.forEach((c, k) => {
      put(c.e, c.normal, 1, k, 0)
      if (c.f >= 0) put(c.f, c.normal, -1, k, 1)
    })
    // 쪽마다 끼였는지(비트 1: e 쪽, 2: f 쪽)
    const blocked = new Uint8Array(contacts.length)
    const deep = contacts.some((c) => -c.separation >= c.core)
    // 서로 반대쪽인 칸 짝(붙들림 계산에만 쓴다)
    const opposed: number[] = []
    for (let i = 0; i < n; i++)
      for (let a = start[i]; a < start[i + 1]; a++)
        for (let b = a + 1; b < start[i + 1]; b++)
          if (
            normals[3 * a] * normals[3 * b] +
              normals[3 * a + 1] * normals[3 * b + 1] +
              normals[3 * a + 2] * normals[3 * b + 2] <
            PINCH_NORMAL_DOT
          ) {
            blocked[owner[a]] |= side[a] === 0 ? 1 : 2
            blocked[owner[b]] |= side[b] === 0 ? 1 : 2
            if (deep) opposed.push(a, b)
          }
    const pinched = new Uint8Array(contacts.length)
    contacts.forEach((c, k) => {
      if (blocked[k] & 1 && (c.f < 0 || blocked[k] & 2)) pinched[k] = 1
    })
    const held = new Uint8Array(contacts.length)
    if (opposed.length > 0) {
      // 쪽마다 받쳐졌는지(비트 1: e 쪽, 2: f 쪽): 그 공의 반대쪽 접촉 가운데 단단한 것이 있다
      const backed = new Uint8Array(contacts.length)
      const bit = (slot: number): number => (side[slot] === 0 ? 1 : 2)
      // 칸의 접촉이 그 공에게 단단한지: 공끼리가 아니거나, 너머의 공이 이 접촉 쪽으로 받쳐졌다
      const firm = (slot: number): boolean =>
        contacts[owner[slot]].f < 0 || (backed[owner[slot]] & (3 - bit(slot))) !== 0
      for (let changed = true; changed;) {
        changed = false
        for (let p = 0; p < opposed.length; p += 2) {
          const a = opposed[p]
          const b = opposed[p + 1]
          if (!(backed[owner[a]] & bit(a)) && firm(b)) {
            backed[owner[a]] |= bit(a)
            changed = true
          }
          if (!(backed[owner[b]] & bit(b)) && firm(a)) {
            backed[owner[b]] |= bit(b)
            changed = true
          }
        }
      }
      contacts.forEach((c, k) => {
        if (backed[k] & 1 && (c.f < 0 || backed[k] & 2)) held[k] = 1
      })
    }
    return { pinched, held }
  }

  // 접촉 하나의 행: 법선(부드러운 법선·반발·심) → 접선 둘(마찰 상자, 접선 순응). 비유한 값이면 빼고 알린다. 반발 두 단계는 끼인
  // 행(pinchedContacts)이 아닐 때만이다(그 쪽 공이 튀어 나갈 수 있다)
  private contactRows(
    ctx: RobotContext,
    contact: Contact,
    index: number,
    h: number,
    uStar: Float64Array,
    pinched: Uint8Array,
    held: Uint8Array
  ): BallRow[] | null {
    const { e, f, normal: n } = contact
    const art = ctx.art
    const robot = contact.dynamic && art && ctx.frames ? art : null
    // 공 중심에서 접촉점까지(e는 −s_e·n, f는 +s_f·n)
    const se = this.radius[e] + contact.separation / 2
    const sf = f >= 0 ? this.radius[f] + contact.separation / 2 : 0
    const partsFor = (d: V3, isNormal: boolean): { ball: number; a: number[] }[] => {
      const ae = [d[0], d[1], d[2], 0, 0, 0]
      if (!isNormal) {
        const w = cross(scale(n, -se), d)
        ae[3] = w[0]
        ae[4] = w[1]
        ae[5] = w[2]
      }
      const parts = [{ ball: e, a: ae }]
      if (f >= 0) {
        const af = [-d[0], -d[1], -d[2], 0, 0, 0]
        if (!isNormal) {
          const w = cross(scale(n, sf), d)
          af[3] = -w[0]
          af[4] = -w[1]
          af[5] = -w[2]
        }
        parts.push({ ball: f, a: af })
      }
      return parts
    }
    const robotRow = (d: V3): number[] | null => {
      if (!robot || !ctx.frames) return null
      const dC = applyT(ctx.rotation, d)
      const j = robot.relativeJacobian(
        ctx.frames,
        contact.body,
        null,
        vec(contact.pointC as V3),
        vec(dC)
      )
      for (let c = 0; c < j.length; c++) j[c] = -j[c] + 0
      return j
    }
    const rateOf = (parts: { ball: number; a: number[] }[], j: number[] | null): number => {
      let sum = 0
      for (const p of parts) sum += rate6(p.a, uStar, 6 * p.ball)
      if (j && robot) for (let c = 0; c < j.length; c++) sum += j[c] * robot.v[c]
      return sum
    }
    const nParts = partsFor(n, true)
    const nJ = robotRow(n)
    const made = normalRow({
      separation: contact.separation,
      approach: rateOf(nParts, nJ),
      h,
      stiffness: contact.stiffness,
      mass: contact.mass,
      coreDepth: contact.core,
      restitution: contact.restitution,
      bounceSpeed: V_BOUNCE,
      dampingRatio: CONTACT_DAMPING_RATIO,
      impact: this.arrivals.get(contact.keys.token),
      pinched: pinched[index] === 1,
      peak: this.peaks.get(contact.keys.token),
      previous: this.depths.get(contact.keys.token),
      // 시작부터 심 이상 겹친 짝은 붙든다(INIT 경고 worldPreloadEmbedded가 맡는다)
      free: held[index] === 0 && !this.startCrush.has(contact.keys.token),
      restoring: this.restoring.has(contact.keys.token)
    })
    if (made.arrival !== undefined) this.nextArrivals.set(contact.keys.token, made.arrival)
    if (made.peak !== undefined) this.nextPeaks.set(contact.keys.token, made.peak)
    if (made.restoring) this.nextRestoring.add(contact.keys.token)
    const depth = -contact.separation
    this.nextDepths.set(contact.keys.token, depth)
    // 풀림 선(peak > 깊이)에서 모양을 되찾는 중이면 그 공은 잠들지 않는다(되찾기는 잠들기 문턱보다 느릴 수 있다). 붙들린 심
    // 행은 되찾지 않는다
    if (made.peak !== undefined && made.peak > depth && (!made.crushed || made.restoring)) {
      this.recovering[e] = 1
      if (f >= 0) this.recovering[f] = 1
    }
    if (made.crushed) {
      const start = this.startCrush.get(contact.keys.token)
      if (start === undefined || depth > start + OVERLAP_NOTICE_DEPTH)
        this.notify('elementCrushed', {})
    } else if (depth < contact.core) this.startCrush.delete(contact.keys.token)
    const compliance = made.compliance
    const normalKey = contact.keys.normal
    const rows: BallRow[] = [
      {
        key: normalKey,
        contact: index,
        parts: nParts,
        j: nJ,
        target: made.target,
        lo: 0,
        hi: Infinity,
        compliance
      }
    ]
    if (contact.mu > 0) {
      // 상대 미끄럼(지금 속도, 필드 축)으로 접선 t1을 고른다(bodyCollision.ts frictionTangent, 지난 t1을 이어 쓴다)
      const pe = this.velocityAt(e, contact.point)
      let other: V3 = [0, 0, 0]
      if (f >= 0) other = this.velocityAt(f, contact.point)
      else if (robot && ctx.frames)
        other = apply(
          ctx.rotation,
          arr(robot.pointVelocity(ctx.frames, contact.body, vec(contact.pointC as V3)))
        )
      const t1 = frictionTangent(n, sub(pe, other), this.tangents.get(contact.keys.token) ?? null)
      this.nextTangents.set(contact.keys.token, t1)
      const t2 = cross(n, t1)
      const tangentCompliance = TANGENT_COMPLIANCE_RATIO / contact.mass
      for (const [key, d] of [
        [contact.keys.t1, t1],
        [contact.keys.t2, t2]
      ] as const)
        rows.push({
          key,
          contact: index,
          parts: partsFor(d, false),
          j: robotRow(d),
          target: 0,
          lo: 0,
          hi: 0,
          compliance: tangentCompliance,
          friction: { normal: normalKey, mu: contact.mu }
        })
    }
    const finite = rows.every(
      (row) =>
        Number.isFinite(row.target) &&
        row.parts.every((p) => p.a.every((x) => Number.isFinite(x))) &&
        (row.j === null || row.j.every((x) => Number.isFinite(x)))
    )
    if (!finite) {
      this.notify('worldError', { detail: `element ${contact.keys.token}` })
      return null
    }
    return rows
  }

  // 공 e 위 점 p의 속도(필드 축) v + ω × (p − x)
  private velocityAt(e: number, p: V3): V3 {
    return add(this.velocityOf(e), cross(this.omegaOf(e), sub(p, this.centerOf(e))))
  }

  // 섬 나누기(spec-6a §2.6·§2.7): 움직이는 로봇에 닿은 공과 공끼리 이어진 공은 로봇 섬(art.step이 Schur 보수로 함께 푼다). 그
  // 행이 MAX_COUPLED_ROWS를 넘으면 로봇에 직접 닿은 공 먼저, 그다음 깊은 짝(분리 오름차순), 그다음 번호 순으로 한도에 들어가는
  // 공을 넣는다(들어가지 않는 공은 건너뛰고 뒤의 더 싼 공을 계속 본다[결정: 6a 리뷰. 첫 공에서 멈추면 남은 행으로 담을 수 있는
  // 바구니 프리로드가 한쪽 섬이 되었다]). 넣는 공은 로봇에 직접 닿았거나 이미 넣은 공에 닿은 공뿐이다(넣은 공이 늘면 차례를 다시
  // 돈다)[결정: 6a 리뷰 2. 건너뛴 공 너머의 공을 넣으면 그 공은 로봇 풀이에 바닥 행만 들고 들어가고, 건너뛴 공의 한쪽 섬은 그
  // 공을 정해진 속도로 봐서 사슬로 미는 힘이 이어지지 않았다]. 나머지는 로봇·넣은 공을 정해진 속도로 보는 한쪽 섬이 된다
  // (elementCouplingLimit, softenOneWay). 나머지 공은 공끼리 이어진 섬(뿌리 = 가장 작은 번호)이다
  private islands(
    contacts: readonly Contact[],
    rows: readonly BallRow[],
    robotTouch: Uint8Array
  ): { coupled: number[]; robotRows: number[]; islands: Island[]; limited: boolean } {
    const n = this.count
    const awake = (i: number): boolean => !this.out[i] && !this.asleep[i]
    const all = new UnionFind(n)
    for (const c of contacts) if (c.f >= 0) all.union(c.e, c.f)
    // 행 수·깊이(공마다)
    const rowCount = new Int32Array(contacts.length)
    for (const row of rows) rowCount[row.contact]++
    const robotRoots = new Set<number>()
    for (let i = 0; i < n; i++) if (robotTouch[i]) robotRoots.add(all.find(i))
    const candidates: number[] = []
    for (let i = 0; i < n; i++) if (awake(i) && robotRoots.has(all.find(i))) candidates.push(i)
    const total = contacts.reduce(
      (sum, c, k) => sum + (robotRoots.has(all.find(c.e)) ? rowCount[k] : 0),
      0
    )
    let admitted = new Set(candidates)
    const limited = total > MAX_COUPLED_ROWS
    if (limited) {
      const depth = new Float64Array(n).fill(Infinity)
      for (const c of contacts) {
        depth[c.e] = Math.min(depth[c.e], c.separation)
        if (c.f >= 0) depth[c.f] = Math.min(depth[c.f], c.separation)
      }
      const order = candidates
        .slice()
        .sort((x, y) => robotTouch[y] - robotTouch[x] || depth[x] - depth[y] || x - y)
      admitted = new Set()
      // 공마다 접촉 번호(번호 순)
      const byBall: number[][] = Array.from({ length: n }, () => [])
      contacts.forEach((c, k) => {
        byBall[c.e].push(k)
        if (c.f >= 0) byBall[c.f].push(k)
      })
      let used = 0
      for (let grew = true; grew;) {
        grew = false
        for (const e of order) {
          if (admitted.has(e)) continue
          // 이 공의 로봇·정적 행과 넣은 공과의 행. 로봇에 닿았거나 넣은 공에 닿아야 넣는다
          let linked = robotTouch[e] === 1
          let cost = 0
          for (const k of byBall[e]) {
            const c = contacts[k]
            if (c.f < 0) cost += rowCount[k]
            else if (admitted.has(c.e === e ? c.f : c.e)) {
              cost += rowCount[k]
              linked = true
            }
          }
          if (!linked || used + cost > MAX_COUPLED_ROWS) continue
          admitted.add(e)
          used += cost
          grew = true
        }
      }
      this.notify('elementCouplingLimit', {})
    }
    const coupled = candidates.filter((e) => admitted.has(e))
    // 나머지 공의 섬(넣은 공과의 짝은 잇지 않는다)
    const rest = new UnionFind(n)
    for (const c of contacts)
      if (c.f >= 0 && !admitted.has(c.e) && !admitted.has(c.f)) rest.union(c.e, c.f)
    const byRoot = new Map<number, Island>()
    const islands: Island[] = []
    for (let i = 0; i < n; i++) {
      if (!awake(i) || admitted.has(i)) continue
      const root = rest.find(i)
      let island = byRoot.get(root)
      if (!island) {
        island = { root, balls: [], rows: [] }
        byRoot.set(root, island)
        islands.push(island)
      }
      island.balls.push(i)
    }
    const robotRows: number[] = []
    rows.forEach((row, r) => {
      const free = row.parts.find((p) => !admitted.has(p.ball))
      if (!free) robotRows.push(r)
      else (byRoot.get(rest.find(free.ball)) as Island).rows.push(r)
    })
    islands.sort((x, y) => x.root - y.root)
    return { coupled, robotRows, islands, limited }
  }

  // 한쪽 행(spec-6a §2.7의 결합 한도로 로봇 섬에서 빠진 공): 그 공의 섬은 로봇(풀이 뒤 속도)·로봇 섬에 넣은 공(풀린 속도)을 정해진
  // 속도로 본다. 그런 몸체와 잇는 법선 행이 강체(심·반발·도착)이면 반대쪽 강체 행(벽 쪽 심 등)과 함께 풀 수 없는 문제가 되어
  // 정칙화한 LCP가 큰 충격(8.6e4 N·s)을 내 공이 수백 m/s로 날았다[결정: 6a 리뷰]. 정해진 속도의 몸체는 공에 밀려나지 않으므로 그
  // 행은 늘 부드러운 법선(springRow: 침투만큼 스프링 힘, 심·반발 없음)이다. 공은 정해진 몸체에 밀리고 끼이면 눌릴 뿐 튀어 나가지
  // 않는다(로봇은 그 공을 느끼지 못한다: 결합 한도의 한계 그대로)
  private softenOneWay(
    plan: { coupled: readonly number[]; islands: readonly Island[]; limited: boolean },
    contacts: readonly Contact[],
    rows: BallRow[],
    h: number
  ): void {
    // 한도 안이면 로봇에 닿은 공과 그 공끼리 이어진 공은 모두 로봇 섬이라 한쪽 행이 없다
    if (!plan.limited) return
    const admitted = new Set(plan.coupled)
    for (const island of plan.islands)
      for (const r of island.rows) {
        const row = rows[r]
        if (row.friction || row.compliance > 0) continue
        if (row.j === null && !row.parts.some((part) => admitted.has(part.ball))) continue
        const contact = contacts[row.contact]
        const soft = springRow({
          separation: contact.separation,
          h,
          stiffness: contact.stiffness,
          mass: contact.mass,
          dampingRatio: CONTACT_DAMPING_RATIO
        })
        row.target = soft.target
        row.compliance = soft.compliance
        this.nextArrivals.delete(contact.keys.token)
      }
  }

  // 잠들기(spec-6a §2.6): 공마다 |v|·|ω|r가 SLEEP_SPEED 아래인 시간을 세고, 움직이는 로봇에 닿지 않은 섬(공끼리 이어진 묶음)의
  // 모든 공이 SLEEP_TIME 이상이면 함께 잠든다(속도 정확히 0). 이력 스프링 풀림 선에서 모양을 되찾는 중인 공은 세지 않는다
  // [결정: 6a 최종 확인. 되찾기(PINCH_RECOVERY_SPEED)가 잠들기 문턱보다 느려 가라앉은 채 잠들었다]
  private sleepStep(p: Pending, h: number): void {
    const n = this.count
    const awake = (i: number): boolean => !this.out[i] && !this.asleep[i]
    for (let e = 0; e < n; e++) {
      if (!awake(e)) continue
      const slow =
        norm(this.velocityOf(e)) < SLEEP_SPEED &&
        norm(this.omegaOf(e)) * this.radius[e] < SLEEP_SPEED &&
        p.recovering[e] === 0
      this.sleepTimer[e] = slow ? this.sleepTimer[e] + h : 0
    }
    if (!this.sleepEnabled) return
    const groups = new UnionFind(n)
    for (const c of p.contacts) if (c.f >= 0) groups.union(c.e, c.f)
    const blocked = new Uint8Array(n)
    for (let e = 0; e < n; e++) {
      if (!awake(e)) continue
      const root = groups.find(e)
      if (p.robotTouch[e] || this.sleepTimer[e] < SLEEP_TIME) blocked[root] = 1
    }
    for (let e = 0; e < n; e++) {
      if (!awake(e) || blocked[groups.find(e)]) continue
      this.asleep[e] = 1
      this.vel.fill(0, 3 * e, 3 * e + 3)
      this.omega.fill(0, 3 * e, 3 * e + 3)
      this.moved = true
    }
  }

  // 필드 밖(spec-6a §2.8): 중심이 벽 바깥면을 r 넘게 지났거나 OUT_OF_FIELD_Z 아래. 물리에서 빼고 나간 자리·시각을 적는다
  private outOfField(tEnd: number): void {
    const { innerHalf, thickness } = this.field.perimeter
    const outer = innerHalf + thickness
    for (let e = 0; e < this.count; e++) {
      if (this.out[e]) continue
      const r = this.radius[e]
      const x = this.pos[3 * e]
      const y = this.pos[3 * e + 1]
      const z = this.pos[3 * e + 2]
      if (!(Math.abs(x) > outer + r || Math.abs(y) > outer + r || z < OUT_OF_FIELD_Z)) continue
      this.out[e] = 1
      this.asleep[e] = 0
      this.sleepTimer[e] = 0
      this.vel.fill(0, 3 * e, 3 * e + 3)
      this.omega.fill(0, 3 * e, 3 * e + 3)
      this.outSince[e] = tEnd
      this.exitPoint[2 * e] = x
      this.exitPoint[2 * e + 1] = y
      this.moved = true
      this.notify('elementOutOfField', { kind: this.kinds[e] })
    }
  }

  private reentryZonesOf(kind: SimElementKind): ReentryZone[] {
    let zones = this.zones.get(kind)
    if (!zones) {
      zones = reentryZones(this.field, kind)
      this.zones.set(kind, zones)
    }
    return zones
  }

  // 다시 넣을 자리(공 중심, 반지름 r)가 비었는지: 로봇 외곽 프리즘(높이 안이면 원–다각형), 로봇 충돌체, 다른 필드 안 공과 닿지
  // 않는다(SLOT_GAP 여유)
  private slotFree(
    ctx: RobotContext,
    outline: readonly { x: number; y: number }[],
    slot: Vec3,
    r: number
  ): boolean {
    if (outline.length > 0 && slot.z - r < this.height)
      if (circlePolygonSeparation(slot, r, outline) < SLOT_GAP) return false
    const cC = applyT(ctx.rotation, sub(arr(slot), ctx.origin))
    const sphere: PlacedShape = { kind: 'capsule', a: vec(cC), b: vec(cC), r, sphere: true }
    for (let b = 0; b < this.robotBodies.length; b++)
      for (const shape of this.placedBody(ctx, b)) {
        if (shape.cylinder) {
          const found = sphereCylinder(
            cC,
            r,
            shape.cylinder.a,
            shape.cylinder.b,
            shape.cylinder.r,
            SLOT_GAP
          )
          if (found) return false
        } else if (shapeSeparation(sphere, shape.placed) < SLOT_GAP) return false
      }
    for (let f = 0; f < this.count; f++) {
      if (this.out[f]) continue
      const d = norm(sub(this.centerOf(f), arr(slot)))
      if (d - this.radius[f] - r < SLOT_GAP) return false
    }
    return true
  }
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// 6-벡터 a와 u(offset부터 6개)의 내적
function rate6(a: readonly number[], u: ArrayLike<number>, o: number): number {
  return (
    a[0] * u[o] +
    a[1] * u[o + 1] +
    a[2] * u[o + 2] +
    a[3] * u[o + 3] +
    a[4] * u[o + 4] +
    a[5] * u[o + 5]
  )
}

// 로봇 몸체(섀시 −1, 관절 0…)의 공 짝 충돌체. 섀시 충돌체 칸이 없으면(평면 경로) 외곽 × [0, 높이] 프리즘 하나(DEFAULT_COLLIDER_FRICTION)
// [결정: 평면 경로의 섀시는 5의 섀시 대체 상자처럼 외곽 프리즘이다. INIT은 늘 충돌체 칸을 보내므로 시험·로봇 카드 경로뿐이다].
// 원기둥은 공이 아닌 짝처럼 외접 32각 기둥 껍질을 두고, 공 짝에 쓸 정확한 끝점·반지름을 함께 둔다
function robotBodies(spec: WorldSpec): RobotBody[] {
  const entry = (body: number, colliders: readonly SimCollider[]): RobotBody => {
    const shapes: RobotShape[] = []
    for (const c of colliders) {
      const shape = bodyShape(c)
      if (!shape) continue
      shapes.push({
        shape,
        cylinder: c.kind === 'cylinder' ? { a: arr(c.a), b: arr(c.b), r: c.radius } : null,
        friction: c.friction
      })
    }
    return {
      body,
      shapes,
      rMax: shapes.reduce((m, s) => Math.max(m, s.shape.radius), 0),
      token: body < 0 ? 'r' : `j${body}`
    }
  }
  let chassis: readonly SimCollider[] = spec.robot.colliders ?? []
  const bodies: RobotBody[] = []
  if (spec.robot.colliders === undefined && spec.robot.footprint.length >= 3) {
    const ring = (z: number): Vec3[] => spec.robot.footprint.map((p) => ({ x: p.x, y: p.y, z }))
    const hull = prismHull([...ring(0), ...ring(spec.robot.height)])
    let radius = 0
    for (const v of hull.vertices) radius = Math.max(radius, Math.hypot(v.x, v.y, v.z))
    bodies.push({
      body: -1,
      shapes: [
        {
          shape: { kind: 'hull', hull, friction: DEFAULT_COLLIDER_FRICTION, radius },
          cylinder: null,
          friction: DEFAULT_COLLIDER_FRICTION
        }
      ],
      rMax: radius,
      token: 'r'
    })
    chassis = []
  } else bodies.push(entry(-1, chassis))
  spec.joints.forEach((j, i) => bodies.push(entry(i, j.colliders ?? [])))
  return bodies
}
