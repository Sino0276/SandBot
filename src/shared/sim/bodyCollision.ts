import type { Articulation, ContactFrames, ContactRow } from './articulation'
import {
  bodyShape,
  collideShapes,
  placeShape,
  shapeBounds,
  staticShapes,
  type BodyShape,
  type Manifold,
  type ManifoldPoint,
  type PlacedShape,
  type SatCache,
  type StaticShape
} from './collision3d'
import { transformHull, type Hull } from './hull'
import { GRAVITY } from './physics'
import type { FieldSpec } from './seasons/fieldSpec'
import { SUPPORT_NOTICE_DELAY } from './wheelData'
import type { SimCollider, Vec3, WorldSpec } from './worldSpec'

// 몸체 충돌 행(spec-5 §4.2): 섀시·관절 몸체의 3D 충돌체가 필드 벽(높이까지, 윗면)·고정 구조물·바닥(관절 몸체)·같은 로봇의 다른
// 몸체와 부딪히는 행을 하위 단계마다 만든다. 행은 벽·구조물과 같은 규칙이다(예측 간격 목표 −max(gap, 0)/h, 반발·위치 보정
// 없음, 마찰은 짝마다 패치: 접선 둘 + 비틀림). 새 행 키는 모두 'c'로 시작한다(부록 B).
//
// 접촉 틀 C(Articulation.contactFrames): 축은 관절 나무 틀(부유 기저면 필드 축, 고정 기저면 로봇 축), 원점은 지금 섀시 원점이다.
// 정적 형상은 부유 기저면 하위 단계마다 −O만큼 옮기고(transformHull, 넓은 단계를 지난 것만), 고정 기저면 생성자에서 시작 자세로
// 로봇 좌표에 한 번 옮긴다. 얼린 원본(staticShapes)은 고치지 않는다.
//
// 섀시–정적 짝(바퀴가 있을 때만)은 기저에 z·롤·피치가 없으므로 법선을 수평으로 투영하고(§1.7), 같은 수평 자리의 점을 접선 위의 두
// 끝으로 합치고, 4ab structureRows의 곡률 조이기를 같은 식으로 옮긴다. 그래서 형상이 섀시 외곽 × [0, H] 상자면 4ab 평면 경로와
// 같은 수의 행이다(4ab 시험을 3D 섀시로 지킨다).
//
// DEFAULT_COLLIDER_FRICTION·FLOOR_FRICTION은 worldSpec.ts에 둔다(렌더러와 함께 쓴다).

// 좁은 단계 상수는 collision3d.ts가 정하고 같은 이름으로 다시 내보낸다(그 파일이 쓰므로, 거꾸로 import하면 순환이 된다)
export {
  FEATURE_TOLERANCE,
  MAX_MANIFOLD_POINTS,
  PARALLEL_EDGE_TOLERANCE,
  WALL_BASE_DEPTH
} from './collision3d'

// 예측 띠의 여유(m) = contact.ts WALL_MARGIN
export const COLLISION_MARGIN = 1e-3
// 섀시–정적 짝의 수평 자리 합치기 공차(m, spec-5 §1.7) = FEATURE_TOLERANCE(5e-4, collision3d.ts)
export const CHASSIS_MERGE_TOLERANCE = 5e-4
// 짝마다 행(법선 4 + 접선 둘 + 비틀림 하나)
export const MAX_PAIR_ROWS = 7
// 한 하위 단계의 충돌 행 [P-M10, 결정: 4짝 × 7. LCP 측정에서 행 ~70이면 한 풀이가 수십 ms]
export const MAX_COLLISION_ROWS = 28
// 이보다 작은 ‖j‖²의 행은 넣지 않는다(solveBoxLcp는 대각 ≤ 0이면 던진다, M§5 함정 5)
export const MIN_ROW_NORM2 = 1e-12
// 섀시–정적 짝의 수평 법선 성분 하한 [가정: 75.5° 넘게 누운 면은 섀시에 행이 없다. BIOBUZZ 다리 면 |n_h| ≈ 0.89, M§5 함정 4]
export const MIN_HORIZONTAL_NORMAL = 0.25
// 미끄러짐 방향으로 접선을 고르는 상대 속도 문턱(m/s, Bullet 속도 방향 마찰, M§5 함정 7)
export const SLIP_DIRECTION_SPEED = 1e-3
// 지난 t1을 새 접선 평면에 투영한 길이가 이 이상이면 그 방향을 이어 쓴다 [P-L22, 결정: M§5 함정 7 중간 단계]
export const TANGENT_KEEP_MIN = 0.5
// 패치 중심 무게 하한 [가정: Box3D relax 무게, spec-5 §1.6]
export const PATCH_WEIGHT_MIN = 1e-3
// 바닥·윗면 마찰 하중 상한(h·W)을 거는 정적 법선의 z 하한 [P-M8, 가정]
export const UPWARD_NORMAL_Z = 0.5
// 실행 중 겹침 알림(collisionOverlap) 깊이(m) [사용자 결정 11/10]
export const OVERLAP_NOTICE_DEPTH = 1e-3

// 형상이 있는 세계인지: 섀시 충돌체 칸이 있거나(빈 배열도) 관절 하나라도 충돌체가 있다. 아니면 5 전과 같은 경로다(바이트 보존)
export function bodyCollisionNeeded(spec: WorldSpec): boolean {
  return (
    spec.robot.colliders !== undefined || spec.joints.some((j) => (j.colliders?.length ?? 0) > 0)
  )
}

export type BodyCollisionNotice = {
  code: 'collisionOverlap' | 'collisionLimit' | 'collisionLift' | 'worldError'
  params: Record<string, string>
}

type V3 = [number, number, number]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const arr = (v: Vec3): V3 => [v.x, v.y, v.z]
const vec = (v: V3): Vec3 => ({ x: v[0] + 0, y: v[1] + 0, z: v[2] + 0 })
const norm = (a: V3): number => Math.sqrt(dot(a, a))
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]

type Bounds = { min: V3; max: V3 }

// 두 상자가 margin(≥ 0) 안으로 다가왔는지(축마다 겹친 폭 > −margin)
function near(a: Bounds, b: Bounds, margin: number): boolean {
  for (let k = 0; k < 3; k++)
    if (!(Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > -margin)) return false
  return true
}

// 몸체 하나의 충돌체(생성자에서 한 번)
type BodyEntry = {
  // −1 섀시, ≥ 0 관절
  body: number
  shapes: BodyShape[]
  // 충돌체 radius의 최대(넓은 단계 여유)
  rMax: number
  token: string
}

// 짝 하나(배열 순서가 행 순서다)
type Pair = {
  a: number
  ka: number
  // 다른 몸체(정적이면 null)와 그 충돌체, 또는 정적 형상 순번
  b: number | null
  kb: number
  staticIndex: number
  token: string
  chassisStatic: boolean
  mu: number
  // 공통 조상 몸체(자기 짝, 넓은 단계 상대 속도)
  ancestor: number
  // 짝의 기억: SAT 특징, 지난 t1(접선), t = 0 시작 겹침 깊이(그 뒤로 바꾸지 않는다, P-M9)
  cache: SatCache
  t1: V3 | null
  baseline: number
}

// 하위 단계에서 만든 짝 하나의 행(한도 고르기 전)
type PairRows = {
  pair: Pair
  rows: ContactRow[]
  normals: ContactRow[]
  rank: number
  upward: boolean
}

export class BodyCollision {
  // 섀시가 3D 경로인지(spec.robot.colliders !== undefined)
  readonly chassis3d: boolean
  // 시험 훅: 매니폴드가 생기면 짝 토큰과 함께 부른다(제품 코드는 쓰지 않는다, spec-5 §11 A20 감시)
  static manifoldHook: ((token: string, manifold: Manifold) => void) | null = null

  private readonly bodies: BodyEntry[]
  // 정적 형상과 그 껍질(고정 기저면 로봇 좌표, 부유 기저면 필드 좌표)·상자
  private readonly statics: { shape: StaticShape; hull: Hull | null; bounds: Bounds | null }[]
  private readonly pairs: Pair[]
  private readonly floating: boolean
  // 로봇 무게(N): 섀시 + 관절 몸체 질량 × g(§1.6 바닥·윗면 마찰 하중 상한)
  private readonly weight: number
  private first = true
  private overlapNotified = false
  private liftTime = 0
  private liftNotified = false
  private upward: string[] = []

  constructor(spec: WorldSpec, field: FieldSpec) {
    this.chassis3d = spec.robot.colliders !== undefined
    this.floating = spec.wheels.length > 0
    this.weight =
      (spec.robot.body.mass + spec.joints.reduce((sum, j) => sum + j.body.mass, 0)) * GRAVITY
    const entry = (body: number, colliders: readonly SimCollider[]): BodyEntry => {
      const shapes: BodyShape[] = []
      for (const c of colliders) {
        const shape = bodyShape(c)
        if (shape) shapes.push(shape)
      }
      return {
        body,
        shapes,
        rMax: shapes.reduce((m, s) => Math.max(m, s.radius), 0),
        token: body < 0 ? 'r' : `j${body}`
      }
    }
    this.bodies = [
      entry(-1, this.chassis3d ? (spec.robot.colliders ?? []) : []),
      ...spec.joints.map((j, i) => entry(i, j.colliders ?? []))
    ]
    // 정적 형상: 고정 기저면 시작 자세의 역으로 로봇 좌표에 한 번 옮긴다(면 법선·offset도 함께, P-L18)
    const start = spec.robot.start
    const c = Math.cos(start.yaw)
    const s = Math.sin(start.yaw)
    // Rz(yaw)ᵀ와 −Rz(yaw)ᵀ·(x, y, 0)
    const rotation = [c, s, 0, -s, c, 0, 0, 0, 1]
    const translation = {
      x: -(c * start.x + s * start.y),
      y: -(-s * start.x + c * start.y),
      z: 0
    }
    this.statics = staticShapes(field).map((shape) => {
      if (!shape.hull) return { shape, hull: null, bounds: null }
      const hull = this.floating ? shape.hull : transformHull(shape.hull, rotation, translation)
      const b = shapeBounds({ kind: 'hull', hull })
      return { shape, hull, bounds: { min: b.min, max: b.max } }
    })
    // 부모 몸체(−1 섀시), 조상 목록(자기부터 섀시까지)
    const parent = (body: number): number => (body < 0 ? -2 : spec.joints[body].parent)
    const ancestors = (body: number): number[] => {
      const out: number[] = []
      for (let k = body; k >= -1; k = parent(k)) out.push(k)
      return out
    }
    const ignored = new Set((spec.collisionIgnore ?? []).map(([a, b]) => `${a},${b}`))
    this.pairs = []
    const memory = (): Pick<Pair, 'cache' | 't1' | 'baseline'> => ({
      cache: null,
      t1: null,
      baseline: 0
    })
    // 1. 몸체 × 정적(몸체 −1, 0, …, 충돌체 k, 정적 staticShapes 순서): 섀시는 3D 경로이고 부유 기저일 때만
    for (const body of this.bodies) {
      if (body.body < 0 && !this.floating) continue
      body.shapes.forEach((shape, k) => {
        this.statics.forEach((st, index) => {
          if (body.body < 0 ? !st.shape.chassis : !st.shape.joints) return
          this.pairs.push({
            a: body.body,
            ka: k,
            b: null,
            kb: -1,
            staticIndex: index,
            token: `${body.token}k${k}/${st.shape.token}`,
            chassisStatic: body.body < 0,
            mu: (shape.friction + st.shape.friction) / 2,
            ancestor: -1,
            ...memory()
          })
        })
      })
    }
    // 2. 자기 짝(a < b, 바로 붙은 부모–자식 아님, collisionIgnore 아님), ka, kb 순
    for (let i = 0; i < this.bodies.length; i++)
      for (let j = i + 1; j < this.bodies.length; j++) {
        const x = this.bodies[i]
        const y = this.bodies[j]
        if (parent(x.body) === y.body || parent(y.body) === x.body) continue
        if (ignored.has(`${x.body},${y.body}`)) continue
        const up = ancestors(x.body)
        const ancestor = ancestors(y.body).find((k) => up.includes(k)) ?? -1
        x.shapes.forEach((sa, ka) =>
          y.shapes.forEach((sb, kb) =>
            this.pairs.push({
              a: x.body,
              ka,
              b: y.body,
              kb,
              staticIndex: -1,
              token: `${x.token}k${ka}/${y.token}k${kb}`,
              chassisStatic: false,
              mu: (sa.friction + sb.friction) / 2,
              ancestor,
              ...memory()
            })
          )
        )
      }
  }

  // 이번 하위 단계의 행(z 공간, 길이 m). blocking: 섀시–정적 법선 행(blocked 판정). upward: §1.6 상한 대상 법선 행 키
  rows(
    art: Articulation,
    h: number,
    m: number
  ): {
    rows: ContactRow[]
    blocking: ContactRow[]
    upward: string[]
    notices: BodyCollisionNotice[]
  } {
    const notices: BodyCollisionNotice[] = []
    const frames = art.contactFrames()
    const origin = arr(frames.origin)
    // 몸체 충돌체를 C로 옮기고 상자·여유를 잰다
    const placed = this.bodies.map((body) => {
      const frame = frames.bodies[body.body + 1]
      const shapes = body.shapes.map((shape) => {
        const p = placeShape(shape, frame)
        return { shape: p, bounds: shapeBounds(p) as Bounds }
      })
      const velocity = frames.velocities[body.body + 1]
      const margin =
        (norm(arr(velocity.linear)) + norm(arr(velocity.omega)) * body.rMax) * h + COLLISION_MARGIN
      return { shapes, margin }
    })
    // 부유 기저의 정적 형상은 하위 단계마다 −O만큼(넓은 단계를 지난 것만, 이 하위 단계 안에서 한 번)
    const moved = new Map<number, { hull: Hull; bounds: Bounds }>()
    const staticBounds = (index: number): Bounds | null => {
      const st = this.statics[index]
      if (!st.bounds) return null
      if (!this.floating) return st.bounds
      return {
        min: sub(st.bounds.min, origin),
        max: sub(st.bounds.max, origin)
      }
    }
    const staticHull = (index: number): Hull => {
      const st = this.statics[index]
      if (!this.floating) return st.hull as Hull
      let found = moved.get(index)
      if (!found) {
        const hull = transformHull(st.hull as Hull, IDENTITY, {
          x: -origin[0],
          y: -origin[1],
          z: -origin[2]
        })
        found = { hull, bounds: staticBounds(index) as Bounds }
        moved.set(index, found)
      }
      return found.hull
    }
    const produced: PairRows[] = []
    for (const pair of this.pairs) {
      const A = placed[pair.a + 1].shapes[pair.ka]
      let margin: number
      let other: PlacedShape | null
      let reached: boolean
      if (pair.b === null) {
        margin = placed[pair.a + 1].margin
        const st = this.statics[pair.staticIndex]
        if (st.shape.kind === 'floor') {
          reached = A.bounds.min[2] <= margin
          other = null
        } else {
          reached = near(A.bounds, staticBounds(pair.staticIndex) as Bounds, margin)
          other = reached ? { kind: 'hull', hull: staticHull(pair.staticIndex) } : null
        }
      } else {
        // 자기 짝: 공통 조상 기준 상대 속도로 여유를 낸다(P-L20: 같이 달리는 로봇의 기저 속도가 여유를 늘리지 않게)
        margin = this.relativeMargin(frames, pair, h)
        const B = placed[pair.b + 1].shapes[pair.kb]
        reached = near(A.bounds, B.bounds, margin)
        other = B.shape
      }
      if (!reached) {
        pair.cache = null
        pair.t1 = null
        continue
      }
      const result = collideShapes(A.shape, other, margin, pair.cache)
      pair.cache = result.cache
      const manifold = result.manifold
      // 깊이는 투영·빼기 전 매니폴드로 잰다(P-L21)
      let deepest = Infinity
      if (manifold) for (const p of manifold.points) deepest = Math.min(deepest, p.separation)
      const depth = manifold ? Math.max(0, -deepest) : 0
      if (this.first) pair.baseline = depth
      else if (!this.overlapNotified && depth - pair.baseline > OVERLAP_NOTICE_DEPTH) {
        this.overlapNotified = true
        notices.push({
          code: 'collisionOverlap',
          params: { body: String(pair.a), target: this.targetOf(pair) }
        })
      }
      if (!manifold) {
        pair.t1 = null
        continue
      }
      BodyCollision.manifoldHook?.(pair.token, manifold)
      const built = this.pairRows(art, frames, pair, manifold, h, m)
      if (!built) continue
      const finite = built.rows.every(
        (row) => Number.isFinite(row.target) && row.j.every((x) => Number.isFinite(x))
      )
      if (!finite) {
        notices.push({ code: 'worldError', params: { detail: `collision ${pair.token}` } })
        pair.t1 = null
        continue
      }
      produced.push({ ...built, rank: deepest + pair.baseline })
    }
    this.first = false
    // 8. 한도: 넘으면 섀시–정적 짝 먼저, 그다음 (짝 깊이 기준 분리 + baseline) 오름차순(같으면 짝 순서)으로 통째로 넣다가 넘기 전에
    // 멈추고 짝 순서로 되돌린다(P-L19)
    let chosen = produced
    const total = produced.reduce((sum, p) => sum + p.rows.length, 0)
    if (total > MAX_COLLISION_ROWS) {
      const order = produced
        .map((p, index) => ({ p, index }))
        .sort(
          (x, y) =>
            Number(y.p.pair.chassisStatic) - Number(x.p.pair.chassisStatic) ||
            x.p.rank - y.p.rank ||
            x.index - y.index
        )
      const keep = new Set<number>()
      let used = 0
      for (const { p, index } of order) {
        if (used + p.rows.length > MAX_COLLISION_ROWS) break
        used += p.rows.length
        keep.add(index)
      }
      chosen = produced.filter((_, index) => keep.has(index))
      notices.push({ code: 'collisionLimit', params: {} })
    }
    const rows: ContactRow[] = []
    const blocking: ContactRow[] = []
    const upward: string[] = []
    for (const p of chosen) {
      rows.push(...p.rows)
      if (p.pair.chassisStatic) blocking.push(...p.normals)
      if (p.upward) for (const row of p.normals) upward.push(row.key)
    }
    this.upward = upward
    return { rows, blocking, upward, notices }
  }

  // art.step 뒤에 부른다: upward 법선 충격 합이 h·W를 넘는 하위 단계가 SUPPORT_NOTICE_DELAY 이어지면 collisionLift(§1.6,
  // contact.ts SupportMonitor와 같은 꼴: 반올림 여유로 하위 단계의 절반을 둔다). 넘지 않는 하위 단계에서 시간을 0으로 되돌린다
  afterStep(art: Articulation, h: number): BodyCollisionNotice[] {
    let sum = 0
    for (const key of this.upward) sum += art.contactImpulse(key)
    this.liftTime = sum > h * this.weight ? this.liftTime + h : 0
    if (!this.liftNotified && this.liftTime >= SUPPORT_NOTICE_DELAY - h / 2) {
      this.liftNotified = true
      return [{ code: 'collisionLift', params: {} }]
    }
    return []
  }

  // 자기 짝의 넓은 단계 여유: 두 몸체의 (|v_o − v_c(o)| + |ω − ω_c|·r_max)·h + COLLISION_MARGIN(c = 공통 조상 몸체)
  private relativeMargin(frames: ContactFrames, pair: Pair, h: number): number {
    const c = pair.ancestor
    const omegaC = arr(frames.velocities[c + 1].omega)
    const term = (body: number): number => {
      const entry = this.bodies[body + 1]
      const v = frames.velocities[body + 1]
      const o = frames.bodies[body + 1].origin
      const vc = arr(frames.velocities[c + 1].linear)
      // 공통 조상 몸체 위 점 o의 속도 v_c + ω_c × (o − o_c)
      const oc = frames.bodies[c + 1].origin
      const arm: V3 = [o.x - oc.x, o.y - oc.y, o.z - oc.z]
      const w = cross(omegaC, arm)
      const relative: V3 = [
        v.linear.x - (vc[0] + w[0]),
        v.linear.y - (vc[1] + w[1]),
        v.linear.z - (vc[2] + w[2])
      ]
      return (norm(relative) + norm(sub(arr(v.omega), omegaC)) * entry.rMax) * h
    }
    return term(pair.a) + term(pair.b as number) + COLLISION_MARGIN
  }

  private targetOf(pair: Pair): string {
    if (pair.b !== null) return `body:${pair.b}`
    const target = this.statics[pair.staticIndex].shape.target
    if (target.kind === 'wall') return `wall:${target.wall}`
    if (target.kind === 'structure') return `structure:${target.index}`
    return 'floor'
  }

  // 짝 하나의 행: 점마다 법선 행 하나, 그다음 패치 마찰(접선 둘 + 비틀림). 법선 행이 없으면 null
  private pairRows(
    art: Articulation,
    frames: ContactFrames,
    pair: Pair,
    manifold: Manifold,
    h: number,
    m: number
  ): { pair: Pair; rows: ContactRow[]; normals: ContactRow[]; upward: boolean } | null {
    const v = art.v
    const jdot = (j: readonly number[]): number => {
      let sum = 0
      for (let c = 0; c < m; c++) if (j[c] !== 0) sum += j[c] * v[c]
      return sum
    }
    const norm2 = (j: readonly number[]): number => {
      let sum = 0
      for (const x of j) sum += x * x
      return sum
    }
    const b = pair.b
    const prefix = `${pair.token}.${manifold.reference}`
    // 섀시–정적이면 §1.7 투영·합치기, 아니면 점 그대로(점마다 법선 n, 간격 g)
    type Kept = { point: ManifoldPoint; n: V3; gap: number; robotFace: boolean }
    let kept: Kept[]
    let patchNormal: V3
    if (pair.chassisStatic) {
      const projected: Kept[] = []
      for (const point of manifold.points) {
        const n = arr(point.normal)
        const lh = Math.hypot(n[0], n[1])
        if (lh < MIN_HORIZONTAL_NORMAL) continue
        const supplement = point.id.startsWith('+')
        projected.push({
          point,
          n: [n[0] / lh, n[1] / lh, 0],
          gap: point.separation / lh,
          robotFace: supplement ? point.id.startsWith('+fa') : manifold.reference.startsWith('fa')
        })
      }
      kept = mergeHorizontal(projected)
      if (kept.length === 0) return null
      const mn = arr(manifold.normal)
      const mh = Math.hypot(mn[0], mn[1])
      patchNormal = mh >= MIN_HORIZONTAL_NORMAL ? [mn[0] / mh, mn[1] / mh, 0] : kept[0].n
    } else {
      kept = manifold.points.map((point) => ({
        point,
        n: arr(point.normal),
        gap: point.separation,
        robotFace: false
      }))
      patchNormal = arr(manifold.normal)
    }
    const base = pair.chassisStatic ? art.baseVelocity() : null
    const normals: ContactRow[] = []
    const used: Kept[] = []
    for (const k of kept) {
      const p = k.point.position
      const d = vec(k.n)
      const j = art.relativeJacobian(frames, pair.a, b, p, d)
      if (norm2(j) < MIN_ROW_NORM2) continue
      const u = jdot(j)
      if (k.gap > Math.abs(u) * h + COLLISION_MARGIN) continue
      let tighten = 0
      if (base) {
        // 곡률 보정(4ab fieldContact.ts structureRows와 같은 식·같은 연산 순서, P-H1): 섀시 면이 기준(fa…)이면
        // g̈ = ω²·(n̂·r) + 2ω·(t·v), 그 밖(fb…·ee…·gv)이면 g̈ = −ω²·(n̂·r), 음수일 때만 목표를 (h/2)·|g̈|만큼 조인다
        // [결정: ee는 정적 법선 식으로 본다. 4ab에는 모서리 기준이 없다]
        const r = { x: p.x, y: p.y }
        const t = { x: -d.y, y: d.x }
        const nr = d.x * r.x + d.y * r.y
        const omega = base.omega
        const curvature = k.robotFace
          ? omega * omega * nr + 2 * omega * (t.x * base.vx + t.y * base.vy)
          : -omega * omega * nr
        tighten = (Math.max(0, -curvature) * h) / 2
      }
      normals.push({
        key: `cn.${prefix}.${k.point.id}`,
        j,
        target: -Math.max(k.gap, 0) / h + tighten,
        lo: 0,
        hi: Infinity
      })
      used.push(k)
    }
    if (normals.length === 0) return null
    const rows: ContactRow[] = [...normals]
    const upward = b === null && patchNormal[2] >= UPWARD_NORMAL_Z
    if (pair.mu > 0) {
      // 패치 중심: 분리에 따라 무게를 준 평균(Box3D relax 무게, P-L13). 띠 안이지만 아직 닿지 않은 점이 마찰 자리를 끌지 않게
      let wSum = 0
      const center: V3 = [0, 0, 0]
      for (const k of used) {
        const w = Math.min(1, Math.max(PATCH_WEIGHT_MIN, 2 - Math.max(k.gap, 0) / COLLISION_MARGIN))
        wSum += w
        const p = arr(k.point.position)
        for (let c = 0; c < 3; c++) center[c] += w * p[c]
      }
      for (let c = 0; c < 3; c++) center[c] /= wSum
      const n = patchNormal
      const t1 = pair.chassisStatic
        ? ([-n[1], n[0], 0] as V3)
        : this.tangent(art, frames, pair, center, n)
      pair.t1 = t1
      // 바닥·윗면 마찰 하중 상한(§1.6, P-M8): 정적 법선이 위를 향하면 접선은 μ·min(Σλₙ, h·W), 비틀림은 지렛대 최대를 곱한 값으로
      // 자른다 [결정: 비틀림 상자는 Σ rₖλₙ,ₖ라 같은 하중 상한에 가장 긴 지렛대를 곱해 단위를 맞춘다]
      const levers = used.map((k) => norm(sub(arr(k.point.position), center)))
      const capForce = upward ? h * this.weight : undefined
      const capTwist = upward ? h * this.weight * Math.max(0, ...levers) : undefined
      const patch = normals.map((row) => ({ normal: row.key, weight: 1 }))
      const friction = (key: string, j: number[], twist: boolean): void => {
        if (norm2(j) < MIN_ROW_NORM2) return
        const cap = twist ? capTwist : capForce
        rows.push({
          key,
          j,
          target: 0,
          lo: 0,
          hi: 0,
          friction: twist
            ? {
                patch: normals.map((row, i) => ({ normal: row.key, weight: levers[i] })),
                mu: pair.mu,
                ...(cap !== undefined ? { cap } : {})
              }
            : { patch, mu: pair.mu, ...(cap !== undefined ? { cap } : {}) }
        })
      }
      const c = vec(center)
      friction(`ct1.${prefix}`, art.relativeJacobian(frames, pair.a, b, c, vec(t1)), false)
      // 섀시–정적은 수직 접선·비틀림의 섀시 J가 0이라 빠진다(§1.6)
      if (!pair.chassisStatic) {
        const t2 = cross(n, t1)
        friction(`ct2.${prefix}`, art.relativeJacobian(frames, pair.a, b, c, vec(t2)), false)
        if (normals.length > 1 && levers.some((x) => x > 0))
          friction(`cw.${prefix}`, art.twistJacobian(frames, pair.a, b, vec(n)), true)
      }
    }
    return { pair, rows, normals, upward }
  }

  // 접선 t1(§4.2 5): 상대 미끄럼 방향 → 지난 t1의 투영 → normalize(n × e_k)(|n_k| 최소 필드 축, 같으면 작은 k).
  // Duff·Frisvad 기저는 n_z = 0(모든 벽 법선)에서 뛰므로 쓰지 않는다(M§5 함정 7)
  private tangent(art: Articulation, frames: ContactFrames, pair: Pair, center: V3, n: V3): V3 {
    const c = vec(center)
    const vA = arr(art.pointVelocity(frames, pair.a, c))
    const vB: V3 = pair.b === null ? [0, 0, 0] : arr(art.pointVelocity(frames, pair.b, c))
    const w = sub(vA, vB)
    const wn = dot(w, n)
    const wt: V3 = [w[0] - wn * n[0], w[1] - wn * n[1], w[2] - wn * n[2]]
    const speed = norm(wt)
    if (speed > SLIP_DIRECTION_SPEED) return [wt[0] / speed, wt[1] / speed, wt[2] / speed]
    if (pair.t1) {
      const t = pair.t1
      const tn = dot(t, n)
      const tau: V3 = [t[0] - tn * n[0], t[1] - tn * n[1], t[2] - tn * n[2]]
      const l = norm(tau)
      if (l >= TANGENT_KEEP_MIN) return [tau[0] / l, tau[1] / l, tau[2] / l]
    }
    let k = 0
    if (Math.abs(n[1]) < Math.abs(n[k])) k = 1
    if (Math.abs(n[2]) < Math.abs(n[k])) k = 2
    const e: V3 = [0, 0, 0]
    e[k] = 1
    const t = cross(n, e)
    const l = norm(t)
    return [t[0] / l, t[1] / l, t[2] / l]
  }
}

// §1.7 수평 자리로 합치기: 법선이 같은 점 묶음(기준 점과 '+' 보충 점)마다 접선 t = ẑ × n̂ 위 s = t·p의 가장 작은 점과 가장 큰
// 점만 남긴다(같은 s는 CHASSIS_MERGE_TOLERANCE 안에서 같게 보고 그중 g′가 가장 작은 점, 같으면 작은 순번). 두 점의 s 차가 그
// 공차 이하면 g′가 작은 쪽 하나. 투영 뒤 같은 (x, y)의 점은 섀시 열에서 J가 같아 LCP를 특이하게 만든다(P-M5). 남긴 점은 원래
// 순서다 [결정: 보충 점은 기준 점과 법선이 달라 같은 행이 아니므로 따로 합친다]
function mergeHorizontal<T extends { point: ManifoldPoint; n: V3; gap: number }>(points: T[]): T[] {
  const groups: T[][] = []
  const groupOf = (p: T): number => (p.point.id.startsWith('+') ? 1 : 0)
  for (const p of points) (groups[groupOf(p)] ??= []).push(p)
  const keep = new Set<T>()
  for (const group of groups) {
    if (!group || group.length === 0) continue
    const n = group[0].n
    const s = group.map((p) => -n[1] * p.point.position.x + n[0] * p.point.position.y)
    const lo = Math.min(...s)
    const hi = Math.max(...s)
    const pick = (inside: (value: number) => boolean): number => {
      let best = -1
      group.forEach((p, i) => {
        if (!inside(s[i])) return
        if (best < 0 || p.gap < group[best].gap) best = i
      })
      return best
    }
    const first = pick((value) => value <= lo + CHASSIS_MERGE_TOLERANCE)
    const last = pick((value) => value >= hi - CHASSIS_MERGE_TOLERANCE)
    if (hi - lo <= CHASSIS_MERGE_TOLERANCE) {
      keep.add(group[group[first].gap <= group[last].gap ? first : last])
    } else {
      keep.add(group[first])
      keep.add(group[last])
    }
  }
  return points.filter((p) => keep.has(p))
}
