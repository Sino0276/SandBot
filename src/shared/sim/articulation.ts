import { GRAVITY } from './physics'
import type { SimJointSpec, Vec3 } from './worldSpec'

// 메커니즘 관절 동역학(3b): 움직이지 않는 로봇 몸체(뿌리) 위의 관절 나무를 감소 좌표로 푼다(Unity ArticulationBody·PhysX
// articulation처럼 Featherstone 계열). 순수 TS이고 결정적이다(배열 순서만 쓰고, 벽시계·난수·Map 순서를 쓰지 않는다).
//
// 좌표: 관절 변위 q(회전 rad, 직선 m, 편집 자세가 0)는 독립 좌표 z의 선형 함수 q = S·z다(다단 슬라이드 리깅의 전달 행렬).
//   - 따로 움직이는 관절(구동 없음·서보·CR 서보)은 z가 곧 q다.
//   - 모터 구동 관절은 z가 모터 출력축 각 φ(rad, 인스펙터 방향 기준 "앞")이고 q = ratio·φ다. 회전자 관성(armature)과
//     엔코더가 이 좌표에 붙는다.
//   - cascade 리깅: 위 단들이 아래 단과 같은 상대 이동을 한다(q_k = ratio·φ, 자유도 1).
//   - continuous 리깅: 줄 길이 하나 Σq = ratio·φ다. z = (φ, 맨 위 단을 뺀 단들의 q)이고 맨 위 단 q = ratio·φ − Σ(나머지 q).
//     어느 단이 먼저 움직일지는 중력·마찰·한계가 정한다.
//
// 동역학(하위 단계 h마다):
//   1. 운동학: q → 몸체 자세(로봇 좌표), 관절 운동 부분공간 s_i(공간 6-벡터, 로봇 좌표 원점 기준 Plücker [ω; v_O]).
//   2. CRBA: 합성 관성(로봇 좌표라 변환 없이 더한다)으로 관절 질량 행렬 M_q. RNEA(q̈ = 0, 기저 가속 −g): 중력·코리올리 c_q.
//      M = SᵀM_qS + diag(armature), c = Sᵀc_q.
//   3. 속도 암시 오일러(MuJoCo implicitfast·discrete, https://mujoco.readthedocs.io/en/stable/computation/index.html):
//      (M + hD + h²K)·v⁺ = M·v + h·(f − c) + Jᵀλ, z⁺ = z + h·v⁺. D는 역기전력·BRAKE·점성·서보 D, K는 서보 P·스프링(대각 또는
//      SᵀdiagS). f는 지금 z에서의 힘(−K(z − 기준) 포함).
//   4. 구속(Jᵀλ): 한계(반발 0, 예측 간격 J·v⁺ ≥ −간격/h)와 쿨롱 마찰(상자 |λ| ≤ h·F)을 한 상자 LCP로 정확히 푼다
//      (solveBoxLcp: 블록 주축 전환 + Murty 대체). 한계 행은 한계 근처면 늘 넣는다(결합 관절에서 행을 v*로 고르면
//      떨린다 — 3b 비평 §2.5). 풀고 난 뒤 빠진 한계가 넘으면 그 행을 더해 다시 푼다.
//   5. 위치 자르기는 z 공간에서만 한다: 한계 관절의 S 행이 z 성분 하나일 때만 그 z를 한계로 자른다(리깅 구속을 깨지 않게).
//   힘이 영역(모터 회생 자르기·서보 포화)에 따라 다르면 지금 v로 정한 영역으로 풀고, v⁺의 영역이 다르면 그 영역으로 한 번 더
//   푼다(많아야 두 번, 결정적).

// 하위 단계마다 관절 좌표 하나에 걸리는 구동 힘(world.ts가 모터·서보 모델로 만든다). 모두 z 좌표 단위다.
export type DriveForces = {
  // 지금 z에서의 일반화 힘(N·m 또는 N, 강성의 −K(z − 기준)을 포함)
  force: number[]
  // 암시 감쇠·강성 대각(N·m·s/rad, N·m/rad 등)
  damping: number[]
  stiffness: number[]
  // 그 좌표 속도에 걸리는 마찰 상자(힘): 마찰 힘 ∈ [boxLo, boxHi], 목표 속도 0. 둘 다 0이면 없음
  boxLo: number[]
  boxHi: number[]
  // 영역 서명(같으면 다시 풀지 않는다)
  regions: string
}

// z(지금 위치)와 v(영역을 정할 속도)로 구동 힘을 만든다
export type DriveModel = (z: readonly number[], v: readonly number[]) => DriveForces

export type Coordinate = { kind: 'joint' | 'motor'; joint: number }

// 질량 행렬 대각의 바닥(kg·m² 또는 kg). 가정: 1 g 점질량이 1 mm 떨어진 관성. 몸체 관성이 축 둘레로 0이고 회전자도 없는
// 관절(서보·구동 없음)에서 질량 행렬이 특이해지지 않게 한다.
export const MIN_COORDINATE_INERTIA = 1e-9
// 한계 근처(행을 늘 넣는 범위): 간격 ≤ |q̇|·h + LIMIT_MARGIN. 가정: FTC 관절이 한 하위 단계(1 ms)에 움직이는 양(1 m/s·10 rad/s
// 에서 1 mm·0.01 rad)과 같은 크기. 이 밖의 행은 풀이 뒤 넘을 때만 더한다.
export const LIMIT_MARGIN = 1e-3
// 풀고 난 위치가 한계를 이만큼(m 또는 rad) 넘으면 빠진 행을 더해 다시 푼다(반올림 잡음은 z 자르기가 맡는다)
const LIMIT_TOLERANCE = 1e-12

type V3 = [number, number, number]
// 3×3 행렬(행 우선 9개)
type M3 = number[]
// 공간 6-벡터 [각; 선]과 6×6 행렬(행 우선 36개)
type S6 = number[]
type M66 = number[]

const IDENTITY3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

// ---- 작은 선형 대수(사칙연산과 Math.sin·cos·sqrt만) ----

const v3 = (v: Vec3): V3 => [v.x, v.y, v.z]
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
function mul3(a: M3, b: M3): M3 {
  const r = new Array<number>(9)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  return r
}

function apply3(a: M3, v: V3): V3 {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2]
  ]
}

function transpose3(a: M3): M3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
}

// 회전 행렬: X(롤)·Y(피치)·Z(요) 라디안, Three.js Euler 'ZYX'와 같은 R = Rz·Ry·Rx(CLAUDE.md "회전은 … 'ZYX'")
export function rotationZYX(r: Vec3): number[] {
  const cx = Math.cos(r.x)
  const sx = Math.sin(r.x)
  const cy = Math.cos(r.y)
  const sy = Math.sin(r.y)
  const cz = Math.cos(r.z)
  const sz = Math.sin(r.z)
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx
  ]
}

// 단위 축 a 둘레 각 θ의 회전(로드리게스)
function axisRotation(a: V3, theta: number): M3 {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const t = 1 - c
  const [x, y, z] = a
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c
  ]
}

// 관성 [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] → 3×3
function inertiaMatrix(i: readonly number[]): M3 {
  return [i[0], i[3], i[4], i[3], i[1], i[5], i[4], i[5], i[2]]
}

// [c]×
function skew(c: V3): M3 {
  return [0, -c[2], c[1], c[2], 0, -c[0], -c[1], c[0], 0]
}

// 무게중심 c(로봇 좌표), 질량 m, 무게중심 기준 관성 Ic(로봇 축)의 원점 기준 공간 관성(운동 [ω; v_O] → 운동량 [L_O; p]):
// [[Ic − m[c]×[c]×, m[c]×], [−m[c]×, m·1]]
function spatialInertia(m: number, c: V3, ic: M3): M66 {
  const cx = skew(c)
  const cxcx = mul3(cx, cx)
  const out = new Array<number>(36).fill(0)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      out[i * 6 + j] = ic[i * 3 + j] - m * cxcx[i * 3 + j]
      out[i * 6 + 3 + j] = m * cx[i * 3 + j]
      out[(3 + i) * 6 + j] = -m * cx[i * 3 + j]
    }
  for (let i = 0; i < 3; i++) out[(3 + i) * 6 + 3 + i] = m
  return out
}

function apply66(a: M66, v: S6): S6 {
  const r = new Array<number>(6)
  for (let i = 0; i < 6; i++) {
    let s = 0
    for (let j = 0; j < 6; j++) s += a[i * 6 + j] * v[j]
    r[i] = s
  }
  return r
}

const dot6 = (a: S6, b: S6): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4] + a[5] * b[5]

// 운동 벡터의 외적 v ×ₘ m
function crossMotion(v: S6, m: S6): S6 {
  const w: V3 = [v[0], v[1], v[2]]
  const u: V3 = [v[3], v[4], v[5]]
  const mw: V3 = [m[0], m[1], m[2]]
  const mu: V3 = [m[3], m[4], m[5]]
  return [...cross3(w, mw), ...add3(cross3(w, mu), cross3(u, mw))]
}

// 힘 벡터의 외적 v ×* f
function crossForce(v: S6, f: S6): S6 {
  const w: V3 = [v[0], v[1], v[2]]
  const u: V3 = [v[3], v[4], v[5]]
  const n: V3 = [f[0], f[1], f[2]]
  const lin: V3 = [f[3], f[4], f[5]]
  return [...add3(cross3(w, n), cross3(u, lin)), ...cross3(w, lin)]
}

// 대칭 양정치 행렬의 LDLᵀ(피벗 없음). 피벗이 minPivot 이하면(양정치가 아니거나 거의 특이) 예외다.
export function ldlFactor(
  a: readonly (readonly number[])[],
  minPivot = 0
): { l: number[][]; d: number[] } {
  const n = a.length
  const l = a.map(() => new Array<number>(n).fill(0))
  const d = new Array<number>(n).fill(0)
  for (let j = 0; j < n; j++) {
    let dj = a[j][j]
    for (let k = 0; k < j; k++) dj -= l[j][k] * l[j][k] * d[k]
    if (!(dj > minPivot)) throw new Error('joint dynamics: matrix not positive definite')
    d[j] = dj
    l[j][j] = 1
    for (let i = j + 1; i < n; i++) {
      let s = a[i][j]
      for (let k = 0; k < j; k++) s -= l[i][k] * l[j][k] * d[k]
      l[i][j] = s / dj
    }
  }
  return { l, d }
}

export function ldlSolve(f: { l: number[][]; d: number[] }, rhs: readonly number[]): number[] {
  const n = rhs.length
  const y = rhs.slice()
  for (let i = 0; i < n; i++) for (let k = 0; k < i; k++) y[i] -= f.l[i][k] * y[k]
  for (let i = 0; i < n; i++) y[i] /= f.d[i]
  for (let i = n - 1; i >= 0; i--) for (let k = i + 1; k < n; k++) y[i] -= f.l[k][i] * y[k]
  return y
}

// ---- 상자 LCP ----

// 블록 주축 전환이 감염 수를 줄이지 못한 채 모두 바꾸기를 허락하는 횟수(Júdice–Pires의 p̄, 가정: 문헌의 보통 값 3–10)
const BPP_TRIES = 3
// 자유 행의 부분 행렬이 거의 특이할 때(같은 방향의 행: 한계와 마찰, continuous 리깅의 세 행) 대각에 더하는 정칙화(대각 최대의
// 이 비율)와 그 판정 피벗(같은 비율). 가정: 결과 속도에 주는 차이가 1e-10 상대 아래라 위치·엔코더에 보이지 않는다.
const LCP_REGULARIZATION = 1e-10
const LCP_MIN_PIVOT = 1e-12
// 반복 상한(넘으면 마지막 값을 상자로 자른다). 가정: Murty 단일 주축은 P 행렬에서 유한하고, 행이 50개 아래면 이만큼 들지 않는다.
const LCP_MAX_ITERATIONS = 2000

// 행의 끝 상태: 아래 경계, 자유(w = 0), 위 경계
export type LcpState = 'lower' | 'free' | 'upper'

// w = A·λ + b, lo ≤ λ ≤ hi에서 λ = lo면 w ≥ 0, λ = hi면 w ≤ 0, 그 사이면 w = 0인 λ(상자 혼합 LCP). A는 대칭 양반정치다.
// 블록 주축 전환(Júdice & Pires 1994, 상자 제약)으로 풀고, 감염 수가 줄지 않으면 Murty의 최소 첨자 규칙(가장 큰 첨자 하나만
// 바꿈)으로 바꾼다. 자유 행의 부분 행렬이 거의 특이하면 그 풀이만 정칙화한다(그러면 P 행렬이라 끝난다). 사칙연산만이라 결정적이다.
// start는 행마다 처음 상태(앞 하위 단계의 답, 없으면 λ = 0에 가까운 상태)다. 해는 시작과 관계없고 반복 수만 줄어든다.
export function solveBoxLcp(
  a: readonly (readonly number[])[],
  b: readonly number[],
  lo: readonly number[],
  hi: readonly number[],
  start: readonly (LcpState | undefined)[] = []
): { lambda: number[]; states: LcpState[] } {
  const n = b.length
  if (n === 0) return { lambda: [], states: [] }
  let maxDiag = 0
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, a[i][i])
  const scale = maxDiag > 0 ? maxDiag : 1
  const eps = LCP_REGULARIZATION * scale
  const solveFree = (free: number[], rhs: number[]): number[] => {
    const sub = free.map((i) => free.map((j) => a[i][j]))
    try {
      return ldlSolve(ldlFactor(sub, LCP_MIN_PIVOT * scale), rhs)
    } catch {
      return ldlSolve(
        ldlFactor(sub.map((row, k) => row.map((x, l) => (k === l ? x + eps : x)))),
        rhs
      )
    }
  }
  let bScale = 1
  let lScale = 1
  for (let i = 0; i < n; i++) {
    bScale = Math.max(bScale, Math.abs(b[i]))
    if (Number.isFinite(lo[i])) lScale = Math.max(lScale, Math.abs(lo[i]))
    if (Number.isFinite(hi[i])) lScale = Math.max(lScale, Math.abs(hi[i]))
  }
  const tolW = 1e-12 * bScale
  const tolL = 1e-12 * lScale
  // 0 = 아래 경계, 1 = 자유(w = 0), 2 = 위 경계
  const state = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const given = start[i]
    if (given === 'lower' && Number.isFinite(lo[i])) state[i] = 0
    else if (given === 'upper' && Number.isFinite(hi[i])) state[i] = 2
    else if (given === 'free') state[i] = 1
    else state[i] = lo[i] === 0 ? 0 : hi[i] === 0 ? 2 : 1
  }
  const lambda = new Array<number>(n).fill(0)
  let best = n + 1
  let tries = BPP_TRIES
  for (let iteration = 0; iteration < LCP_MAX_ITERATIONS; iteration++) {
    const free: number[] = []
    for (let i = 0; i < n; i++) {
      if (state[i] === 1) free.push(i)
      else lambda[i] = state[i] === 0 ? lo[i] : hi[i]
    }
    if (free.length > 0) {
      const rhs = free.map((i) => {
        let s = -b[i]
        for (let j = 0; j < n; j++) if (state[j] !== 1) s -= a[i][j] * lambda[j]
        return s
      })
      const x = solveFree(free, rhs)
      free.forEach((i, k) => (lambda[i] = x[k]))
    }
    const bad: number[] = []
    for (let i = 0; i < n; i++) {
      if (state[i] === 1) {
        if (lambda[i] < lo[i] - tolL || lambda[i] > hi[i] + tolL) bad.push(i)
        continue
      }
      let w = b[i]
      for (let j = 0; j < n; j++) w += a[i][j] * lambda[j]
      if ((state[i] === 0 && w < -tolW) || (state[i] === 2 && w > tolW)) bad.push(i)
    }
    if (bad.length === 0) break
    let flip = bad
    if (bad.length < best) {
      best = bad.length
      tries = BPP_TRIES
    } else if (tries > 0) {
      tries--
    } else {
      flip = [bad[bad.length - 1]]
    }
    for (const i of flip) {
      if (state[i] === 1) state[i] = lambda[i] < lo[i] ? 0 : 2
      else state[i] = 1
    }
  }
  for (let i = 0; i < n; i++) lambda[i] = Math.min(hi[i], Math.max(lo[i], lambda[i]))
  const names: LcpState[] = ['lower', 'free', 'upper']
  return { lambda, states: state.map((s) => names[s]) }
}

// ---- 관절 나무 ----

type Body = {
  // 몸체 틀(로봇 좌표): 회전과 원점
  rotation: M3
  origin: V3
  // 관절 운동 부분공간(로봇 좌표 원점 기준)
  motion: S6
  // 공간 관성(로봇 좌표 원점 기준)
  inertia: M66
}

// 구속 행. key는 하위 단계 사이에서 같은 행을 알아보는 이름(LCP를 앞 답에서 시작한다)
type Row = { key: string; j: number[]; target: number; lo: number; hi: number }

export class Articulation {
  readonly joints: readonly SimJointSpec[]
  // z 좌표마다 무엇인지(관절 q 또는 그 관절 모터 구동의 φ)
  readonly coordinates: readonly Coordinate[]
  // q = S·z (관절 수 × 좌표 수)
  readonly s: readonly (readonly number[])[]
  // 좌표마다 회전자 반사 관성(모터 수 × J_r × 감속비²)
  readonly armature: readonly number[]
  z: number[]
  v: number[]
  // 직선 관절 축(관절 틀 단위 벡터)·회전 관절 축
  private readonly axes: V3[]
  private readonly origins: { rotation: M3; position: V3 }[]
  private readonly gravity: number
  // 앞 하위 단계 LCP의 행 상태(이름으로 찾기만 한다)
  private lcpStates = new Map<string, LcpState>()

  constructor(joints: readonly SimJointSpec[], gravity = GRAVITY) {
    this.joints = joints
    this.gravity = gravity
    const coordinates: Coordinate[] = []
    const rows: number[][] = joints.map(() => [])
    const armature: number[] = []
    const add = (kind: 'joint' | 'motor', joint: number, inertia: number): number => {
      coordinates.push({ kind, joint })
      armature.push(inertia)
      return coordinates.length - 1
    }
    const entry = (joint: number, coordinate: number, value: number): void => {
      rows[joint][coordinate] = (rows[joint][coordinate] ?? 0) + value
    }
    joints.forEach((joint, i) => {
      const drive = joint.drive
      if (drive.kind === 'stage') return
      if (drive.kind !== 'motor') {
        entry(i, add('joint', i, 0), 1)
        return
      }
      const p = drive.params
      const phi = add('motor', i, drive.devices.length * p.rotorInertia * p.gearbox * p.gearbox)
      const rigging = drive.rigging
      if (rigging.kind === 'direct') {
        entry(i, phi, drive.ratio)
      } else if (rigging.kind === 'cascade') {
        entry(i, phi, drive.ratio)
        for (const stage of rigging.stages) entry(stage, phi, drive.ratio)
      } else {
        const chain = [i, ...rigging.stages]
        const top = chain[chain.length - 1]
        entry(top, phi, drive.ratio)
        for (const member of chain.slice(0, -1)) {
          entry(member, add('joint', member, 0), 1)
          entry(top, coordinates.length - 1, -1)
        }
      }
    })
    // 단은 parseWorldSpec가 구동 관절 하나에 들어 있음을 확인한다(아니면 그 관절의 행이 0이라 움직이지 않는다)
    const m = coordinates.length
    this.coordinates = coordinates
    this.s = rows.map((row) => Array.from({ length: m }, (_, c) => row[c] ?? 0))
    this.armature = armature
    this.z = new Array<number>(m).fill(0)
    this.v = new Array<number>(m).fill(0)
    this.axes = joints.map((j) => v3(j.axis))
    this.origins = joints.map((j) => ({
      rotation: rotationZYX(j.origin.rotation),
      position: v3(j.origin.position)
    }))
  }

  // 관절 변위 q = S·z
  q(z: readonly number[] = this.z): number[] {
    return this.s.map((row) => row.reduce((sum, value, c) => sum + value * z[c], 0))
  }

  // 관절 속도 q̇ = S·v
  qd(v: readonly number[] = this.v): number[] {
    return this.q(v)
  }

  // 몸체 자세와 운동 부분공간(로봇 좌표)
  private bodies(q: readonly number[]): Body[] {
    const bodies: Body[] = []
    this.joints.forEach((joint, i) => {
      const parent = joint.parent >= 0 ? bodies[joint.parent] : null
      const pr = parent ? parent.rotation : IDENTITY3
      const po: V3 = parent ? parent.origin : [0, 0, 0]
      const o = this.origins[i]
      const r0 = mul3(pr, o.rotation)
      const p0 = add3(po, apply3(pr, o.position))
      const axis = apply3(r0, this.axes[i])
      let rotation = r0
      let origin = p0
      let motion: S6
      if (joint.type === 'revolute') {
        rotation = mul3(r0, axisRotation(this.axes[i], q[i]))
        motion = [...axis, ...cross3(p0, axis)]
      } else {
        origin = add3(p0, scale3(axis, q[i]))
        motion = [0, 0, 0, ...axis]
      }
      const body = joint.body
      const com = add3(origin, apply3(rotation, v3(body.centerOfMass)))
      const ic = mul3(mul3(rotation, inertiaMatrix(body.inertia)), transpose3(rotation))
      bodies.push({ rotation, origin, motion, inertia: spatialInertia(body.mass, com, ic) })
    })
    return bodies
  }

  // CRBA: 관절 질량 행렬 M_q(q)
  massMatrix(q: readonly number[] = this.q()): number[][] {
    return this.crba(this.bodies(q))
  }

  private crba(bodies: Body[]): number[][] {
    const n = bodies.length
    const composite = bodies.map((b) => b.inertia.slice())
    for (let i = n - 1; i >= 0; i--) {
      const parent = this.joints[i].parent
      if (parent >= 0) for (let k = 0; k < 36; k++) composite[parent][k] += composite[i][k]
    }
    const m = bodies.map(() => new Array<number>(n).fill(0))
    for (let i = 0; i < n; i++) {
      const force = apply66(composite[i], bodies[i].motion)
      m[i][i] = dot6(bodies[i].motion, force)
      for (let j = this.joints[i].parent; j >= 0; j = this.joints[j].parent) {
        const value = dot6(bodies[j].motion, force)
        m[i][j] = value
        m[j][i] = value
      }
    }
    return m
  }

  // RNEA(q̈ = 0, 기저 가속 −g): 중력과 코리올리·원심력의 관절 일반화 힘 c_q(q, q̇). M·q̈ + c = τ
  bias(q: readonly number[] = this.q(), qd: readonly number[] = this.qd()): number[] {
    return this.rnea(this.bodies(q), qd)
  }

  private rnea(bodies: Body[], qd: readonly number[]): number[] {
    const n = bodies.length
    const velocity: S6[] = []
    const accel: S6[] = []
    const force: S6[] = []
    // 고정 기저를 위로 g만큼 가속하면 모든 몸체에 중력이 걸린다(Featherstone의 표준 처리)
    const baseAccel: S6 = [0, 0, 0, 0, 0, this.gravity]
    for (let i = 0; i < n; i++) {
      const parent = this.joints[i].parent
      const vp: S6 = parent >= 0 ? velocity[parent] : [0, 0, 0, 0, 0, 0]
      const ap: S6 = parent >= 0 ? accel[parent] : baseAccel
      const s = bodies[i].motion
      const vi = vp.map((x, k) => x + s[k] * qd[i])
      const sd = crossMotion(vi, s)
      const ai = ap.map((x, k) => x + sd[k] * qd[i])
      const inertia = bodies[i].inertia
      const momentum = apply66(inertia, vi)
      const ia = apply66(inertia, ai)
      const vxf = crossForce(vi, momentum)
      velocity.push(vi)
      accel.push(ai)
      force.push(ia.map((x, k) => x + vxf[k]))
    }
    const tau = new Array<number>(n).fill(0)
    for (let i = n - 1; i >= 0; i--) {
      tau[i] = dot6(bodies[i].motion, force[i])
      const parent = this.joints[i].parent
      if (parent >= 0) for (let k = 0; k < 6; k++) force[parent][k] += force[i][k]
    }
    return tau
  }

  // 몸체 i의 자세(로봇 좌표, 시험·표시용)
  bodyPose(i: number, q: readonly number[] = this.q()): { rotation: number[]; origin: number[] } {
    const b = this.bodies(q)[i]
    return { rotation: b.rotation.slice(), origin: b.origin.slice() }
  }

  // 위치 에너지(J, 로봇 좌표 z = 0 기준, 시험용)
  potentialEnergy(q: readonly number[] = this.q()): number {
    let energy = 0
    this.bodies(q).forEach((b, i) => {
      const body = this.joints[i].body
      const com = add3(b.origin, apply3(b.rotation, v3(body.centerOfMass)))
      energy += body.mass * this.gravity * com[2]
    })
    return energy
  }

  // 운동 에너지(J, 회전자 포함, 시험용)
  kineticEnergy(): number {
    const mz = this.coordinateMass(this.massMatrix())
    let energy = 0
    for (let i = 0; i < this.v.length; i++)
      for (let j = 0; j < this.v.length; j++) energy += 0.5 * this.v[i] * mz[i][j] * this.v[j]
    return energy
  }

  // M_z = SᵀM_qS + diag(armature) + 바닥
  private coordinateMass(mq: number[][]): number[][] {
    const s = this.s
    const n = s.length
    const m = this.coordinates.length
    const out = Array.from({ length: m }, () => new Array<number>(m).fill(0))
    for (let a = 0; a < m; a++)
      for (let b = a; b < m; b++) {
        let sum = 0
        for (let i = 0; i < n; i++) {
          if (s[i][a] === 0) continue
          for (let k = 0; k < n; k++) sum += s[i][a] * mq[i][k] * s[k][b]
        }
        out[a][b] = sum
        out[b][a] = sum
      }
    for (let a = 0; a < m; a++) out[a][a] += this.armature[a] + MIN_COORDINATE_INERTIA
    return out
  }

  // 하위 단계 하나(h초). drive가 구동 힘을 준다.
  step(h: number, drive: DriveModel): void {
    const m = this.coordinates.length
    if (m === 0) return
    const n = this.joints.length
    const s = this.s
    const q = this.q()
    const qd = this.qd()
    const bodies = this.bodies(q)
    const mz = this.coordinateMass(this.crba(bodies))
    const cq = this.rnea(bodies, qd)

    // 관절 공간의 수동 힘(점성·스프링)과 쿨롱 상자
    const passiveForce = new Array<number>(n).fill(0)
    const passiveDamping = new Array<number>(n).fill(0)
    const passiveStiffness = new Array<number>(n).fill(0)
    this.joints.forEach((joint, i) => {
      passiveDamping[i] = joint.friction.viscous
      const spring = joint.spring
      if (spring?.kind === 'constantForce') passiveForce[i] = spring.force
      else if (spring?.kind === 'linear') {
        passiveForce[i] = -spring.stiffness * (q[i] - spring.rest)
        passiveStiffness[i] = spring.stiffness
      }
    })
    const toZ = (values: number[]): number[] => {
      const out = new Array<number>(m).fill(0)
      for (let i = 0; i < n; i++) {
        if (values[i] === 0) continue
        for (let c = 0; c < m; c++) out[c] += s[i][c] * values[i]
      }
      return out
    }
    const quadratic = (diag: number[]): number[][] => {
      const out = Array.from({ length: m }, () => new Array<number>(m).fill(0))
      for (let i = 0; i < n; i++) {
        if (diag[i] === 0) continue
        for (let a = 0; a < m; a++) {
          if (s[i][a] === 0) continue
          for (let b = 0; b < m; b++) out[a][b] += s[i][a] * diag[i] * s[i][b]
        }
      }
      return out
    }
    const baseForce = toZ(passiveForce)
    const cz = toZ(cq)
    const baseDamping = quadratic(passiveDamping)
    const baseStiffness = quadratic(passiveStiffness)
    const momentum = mz.map((row) => row.reduce((sum, x, c) => sum + x * this.v[c], 0))

    const solve = (forces: DriveForces): number[] => {
      const mhat = mz.map((row, a) =>
        row.map(
          (x, b) =>
            x +
            h * (baseDamping[a][b] + (a === b ? forces.damping[a] : 0)) +
            h * h * (baseStiffness[a][b] + (a === b ? forces.stiffness[a] : 0))
        )
      )
      const factor = ldlFactor(mhat)
      const rhs = momentum.map((p, c) => p + h * (baseForce[c] + forces.force[c] - cz[c]))
      const vStar = ldlSolve(factor, rhs)
      const friction = this.frictionRows(forces, h)
      const included = new Array<boolean>(2 * n).fill(false)
      this.joints.forEach((joint, i) => {
        if (!joint.limits) return
        const reach = Math.abs(qd[i]) * h + LIMIT_MARGIN
        included[2 * i] = q[i] - joint.limits.lower <= reach
        included[2 * i + 1] = joint.limits.upper - q[i] <= reach
      })
      for (;;) {
        const rows = [...friction, ...this.limitRows(q, h, included)]
        const v = this.constrained(factor, vStar, rows)
        // 빠진 한계가 넘으면 더해 다시 푼다
        const qNext = this.q(v).map((rate, i) => q[i] + h * rate)
        let added = false
        this.joints.forEach((joint, i) => {
          if (!joint.limits) return
          if (!included[2 * i] && qNext[i] < joint.limits.lower - LIMIT_TOLERANCE) {
            included[2 * i] = true
            added = true
          }
          if (!included[2 * i + 1] && qNext[i] > joint.limits.upper + LIMIT_TOLERANCE) {
            included[2 * i + 1] = true
            added = true
          }
        })
        if (!added) return v
      }
    }

    const first = drive(this.z, this.v)
    let v = solve(first)
    const second = drive(this.z, v)
    if (second.regions !== first.regions) v = solve(second)

    const z = this.z.map((x, c) => x + h * v[c])
    this.clampLimits(z, v)
    for (let c = 0; c < m; c++)
      if (!Number.isFinite(z[c]) || !Number.isFinite(v[c]))
        throw new Error('joint dynamics diverged')
    this.z = z
    this.v = v
  }

  // 마찰 상자 행: 관절 쿨롱(행 S_i)과 구동의 좌표 상자. 같은 방향의 행은 하나로 합친다(상자를 더함).
  private frictionRows(forces: DriveForces, h: number): Row[] {
    const m = this.coordinates.length
    const rows: Row[] = []
    const keys: string[] = []
    const addRow = (j: readonly number[], lo: number, hi: number): void => {
      if (lo === 0 && hi === 0) return
      // 첫 0이 아닌 성분으로 나눠 방향을 맞춘다(같은 방향이면 같은 글자, 성분 하나면 그 순번)
      const first = j.findIndex((x) => x !== 0)
      if (first < 0) return
      const lead = j[first]
      const unit = j.map((x) => x / lead)
      const single = unit.every((x, c) => c === first || x === 0)
      const key = single ? `${first}` : unit.join(',')
      // impulse on j = lead·(impulse on unit); 상자도 그만큼 늘리고 음수면 뒤집는다
      const a = lo * lead
      const b = hi * lead
      const low = h * Math.min(a, b)
      const high = h * Math.max(a, b)
      const at = keys.indexOf(key)
      if (at >= 0) {
        rows[at].lo += low
        rows[at].hi += high
        return
      }
      keys.push(key)
      rows.push({ key: `f${key}`, j: unit, target: 0, lo: low, hi: high })
    }
    this.joints.forEach((joint, i) => {
      const c = joint.friction.coulomb
      if (c > 0) addRow(this.s[i], -c, c)
    })
    for (let c = 0; c < m; c++) {
      const lo = forces.boxLo[c]
      const hi = forces.boxHi[c]
      if (lo === 0 && hi === 0) continue
      const j = new Array<number>(m).fill(0)
      j[c] = 1
      addRow(j, lo, hi)
    }
    return rows
  }

  // 한계 행(넣기로 한 것만): 아래 J = S_i, J·v ≥ −(q − lo)/h; 위 J = −S_i, J·v ≥ −(hi − q)/h. 충격은 0 이상.
  private limitRows(q: readonly number[], h: number, included: readonly boolean[]): Row[] {
    const rows: Row[] = []
    this.joints.forEach((joint, i) => {
      const limits = joint.limits
      if (!limits) return
      if (included[2 * i])
        rows.push({
          key: `l${i}`,
          j: this.s[i].slice(),
          target: -(q[i] - limits.lower) / h,
          lo: 0,
          hi: Infinity
        })
      if (included[2 * i + 1])
        rows.push({
          key: `u${i}`,
          j: this.s[i].map((x) => -x),
          target: -(limits.upper - q[i]) / h,
          lo: 0,
          hi: Infinity
        })
    })
    return rows
  }

  // v⁺ = v* + M̂⁻¹Jᵀλ, λ는 상자 LCP의 해
  private constrained(
    factor: { l: number[][]; d: number[] },
    vStar: number[],
    rows: Row[]
  ): number[] {
    if (rows.length === 0) return vStar
    const m = vStar.length
    const dot = (j: readonly number[], x: readonly number[]): number => {
      let sum = 0
      for (let c = 0; c < m; c++) if (j[c] !== 0) sum += j[c] * x[c]
      return sum
    }
    const y = rows.map((row) => ldlSolve(factor, row.j))
    const a = rows.map((row) => y.map((col) => dot(row.j, col)))
    const b = rows.map((row) => dot(row.j, vStar) - row.target)
    const { lambda, states } = solveBoxLcp(
      a,
      b,
      rows.map((r) => r.lo),
      rows.map((r) => r.hi),
      rows.map((r) => this.lcpStates.get(r.key))
    )
    this.lcpStates = new Map(rows.map((r, k) => [r.key, states[k]]))
    const v = vStar.slice()
    rows.forEach((_, k) => {
      if (lambda[k] === 0) return
      for (let c = 0; c < v.length; c++) v[c] += y[k][c] * lambda[k]
    })
    // 자유 행(w = 0)이 좌표 하나에만 걸리면 그 속도를 목표에 정확히 맞춘다(반올림 잡음을 지운다: 정지 마찰로 멈춘 관절의
    // 엔코더가 0과 −1 사이에서 깜빡이지 않게)
    rows.forEach((row, k) => {
      if (states[k] !== 'free') return
      let only = -1
      for (let c = 0; c < row.j.length; c++) {
        if (row.j[c] === 0) continue
        if (only >= 0) return
        only = c
      }
      if (only >= 0) v[only] = row.target / row.j[only]
    })
    return v
  }

  // z 공간 자르기: S 행이 성분 하나(s·z_c)인 한계 관절은 z_c를 [lo, hi]/s 안에 둔다(리깅으로 묶인 관절은 정확한 LCP가 맡는다)
  private clampLimits(z: number[], v: number[]): void {
    const m = this.coordinates.length
    const low = new Array<number>(m).fill(-Infinity)
    const high = new Array<number>(m).fill(Infinity)
    this.joints.forEach((joint, i) => {
      if (!joint.limits) return
      const nonzero = this.s[i].flatMap((x, c) => (x !== 0 ? [c] : []))
      if (nonzero.length !== 1) return
      const c = nonzero[0]
      const k = this.s[i][c]
      const a = joint.limits.lower / k
      const b = joint.limits.upper / k
      low[c] = Math.max(low[c], Math.min(a, b))
      high[c] = Math.min(high[c], Math.max(a, b))
    })
    // 한계에 닿은(넘은) 좌표는 한계에 두고 바깥 속도를 지운다(반발 0: 다음 하위 단계는 멈춘 채 시작한다)
    for (let c = 0; c < m; c++) {
      if (z[c] <= low[c] && v[c] <= 0) {
        z[c] = low[c]
        v[c] = 0
      } else if (z[c] >= high[c] && v[c] >= 0) {
        z[c] = high[c]
        v[c] = 0
      } else if (z[c] < low[c]) z[c] = low[c]
      else if (z[c] > high[c]) z[c] = high[c]
    }
  }
}

// 시험·표시용: 점 p(몸체 틀)의 로봇 좌표
export function bodyPoint(pose: { rotation: number[]; origin: number[] }, p: Vec3): number[] {
  return add3([pose.origin[0], pose.origin[1], pose.origin[2]], apply3(pose.rotation, v3(p)))
}
