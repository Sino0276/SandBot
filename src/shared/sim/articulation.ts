import { GRAVITY } from './physics'
import type { Pose2, SimBody, SimJointSpec, Vec3 } from './worldSpec'
import type { Frame3 } from './sensorFrame'

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
//      (solveBoxLcp: 정칙화한 행렬로 블록 주축 전환 + Murty 대체, 근접점 반복으로 원래 문제에 맞춤). 한계 행은 한계
//      근처면 늘 넣는다(결합 관절에서 행을 v*로 고르면 떨린다 — 3b 비평 §2.5). 풀고 난 뒤 빠진 한계가 넘으면 그 행을 더해
//      다시 푼다.
//   5. 위치 자르기는 z 공간에서만 한다: 한계 관절의 S 행이 z 성분 하나일 때만 그 z를 한계로 자른다(리깅 구속을 깨지 않게).
//      그 좌표의 바깥 속도는 M̂⁻¹을 거친 결합 충격으로 지운다(결합된 자식 관절의 일반화 운동량을 지킨다). 여러 성분 S 행의
//      한계(continuous 맨 위 단)도 한계에 있으면 그 충격의 한쪽 구속 행이고, 충격 뒤 다시 적분한 위치가 넘지 않게 한계에 놓는다.
//   힘이 영역(모터 회생 자르기·서보 포화)에 따라 다르면 지금 v로 정한 영역으로 풀고, v⁺의 영역이 다르면 그 영역으로 한 번 더
//   푼다(많아야 두 번, 결정적).
//
// 구동계 동역학(3c, 옵션. 모두 꺼져 있으면 위 3b와 연산이 같다):
//   - 평면 부유 기저: 가상 관절 셋(필드 X 직선, 필드 Y 직선, Z 회전, 원점은 시작 자세)을 관절 나무 앞에 둔다. 섀시 몸체는 Z 회전에
//     달고, 부모가 −1(로봇)인 관절은 섀시의 자식이 된다. 필드 축 직선이라 q̇ = v가 정확해서 CRBA·RNEA·암시 오일러·상자 LCP를
//     그대로 쓰고, 팔이 기저 가속에서 받는 관성력·팔의 반력·무게중심 이동은 질량 행렬의 비대각과 바이어스로 저절로 들어간다
//     (spec-3c §1.1). 공개 관절 순번과 q()는 세계 설명 joints 순번 그대로이고, 기저 상태는 basePose()·baseVelocity()로 읽는다.
//     몸체 틀은 필드 좌표(원점 필드 중앙 바닥)가 되고, 바퀴가 없으면(기저 고정) 지금처럼 로봇 좌표다.
//   - 관절에 묶이지 않은 좌표(free): armature만 있는 좌표(바퀴 모터의 출력축 각, 구동하지 않는 바퀴, 부하 없는 모터). S 열이 0이라
//     몸체와는 밖에서 주는 접촉 행으로만 묶인다.
//   - 밖에서 주는 구속 행(ContactSet.rows): 바퀴 견인·벽 법선·벽 마찰을 3b 행과 같은 상자 LCP에 넣는다. 마찰 행은 법선 행의 충격에
//     기대는 상자(±μ·λ_n)이고, λ_n은 고정 2회 엇갈림(1회차는 앞 하위 단계의 같은 키 법선 힘, 2회차는 1회차 값)으로 정한다.
//     5의 한계 충격 풀이에도 같은 행을 넣는다(벽에 붙은 기저를 한계 충격이 벽 안으로 밀지 않게, clampLimits).
//   - 행 점성 감쇠(ContactSet.damping): 힘 −c·J·v(롤러 자유 방향)를 암시로 M̂에 h·c·JᵀJ로 더한다.
//   - 기저 렌치(baseWrench): 바닥이 받쳐야 할 (F_z, M_x, M_y)(로봇 좌표 원점 = 로봇 중심 바닥, 로봇 축)를 섀시 관절의 RNEA 공간
//     힘에서 얻는다. 중력·위치·속도는 지금 값이고, 가속(기저 + 관절)은 앞 하위 단계 가속을 1차 저역 통과한 값이다(spec-3c §1.4).

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

// joint: 세계 설명 joints 순번(기저·자유 좌표는 −1)
export type Coordinate = { kind: 'joint' | 'motor' | 'base' | 'free'; joint: number }

// 마찰 행의 상자(spec-5 §2.4): 지금 모양은 법선 행 하나의 충격 × mu, 패치 모양(5 몸체 충돌)은 법선 행 여럿의
// Σ weight·max(0, λ) × mu이고 cap이 있으면 min(합, cap) × mu다(cap: 바닥·윗면 마찰 하중 상한 h·W, spec-5 §1.6)
export type ContactFriction =
  | { normal: string; mu: number }
  | { patch: readonly { normal: string; weight: number }[]; mu: number; cap?: number }

// 밖에서 주는 구속 행(z 공간). lo·hi는 충격(힘 × h)이다. friction이 있으면 상자를 ±(ContactFriction 상자)로 정한다(lo·hi 무시).
export type ContactRow = {
  key: string
  j: number[]
  target: number
  lo: number
  hi: number
  friction?: ContactFriction
}

// 하위 단계 하나의 밖에서 주는 행과 행 점성 감쇠(힘 = −c·(j·v), c > 0)
export type ContactSet = {
  rows: readonly ContactRow[]
  damping: readonly { j: readonly number[]; c: number }[]
}

export type ArticulationOptions = {
  gravity?: number
  // 평면 부유 기저(3c): 섀시 몸체(로봇 좌표, 무게중심 기준 관성)와 시작 자세(필드)
  base?: { body: SimBody; start: Pose2 }
  // 관절에 묶이지 않은 좌표마다 armature(kg·m²). 좌표 순번은 freeCoordinates
  free?: readonly number[]
  // 기저 렌치 가속의 저역 통과 시간 상수(s), 기저가 있을 때만 쓴다
  loadFilterTau?: number
}

// 바닥이 받쳐야 할 렌치(로봇 좌표 원점 기준, 로봇 축): 수직 힘(N)과 롤·피치 모멘트(N·m)
export type BaseWrench = { fz: number; mx: number; my: number }

// 부유 기저의 가상 관절 수(필드 X 직선, 필드 Y 직선, Z 회전)
export const BASE_JOINTS = 3

// 질량 행렬 대각의 바닥(kg·m² 또는 kg). 가정: 1 g 점질량이 1 mm 떨어진 관성. 몸체 관성이 축 둘레로 0이고 회전자도 없는
// 관절(서보·구동 없음)에서 질량 행렬이 특이해지지 않게 한다.
export const MIN_COORDINATE_INERTIA = 1e-9
// 한계 근처(행을 늘 넣는 범위): 간격 ≤ |q̇|·h + LIMIT_MARGIN. 가정: FTC 관절이 한 하위 단계(1 ms)에 움직이는 양(1 m/s·10 rad/s
// 에서 1 mm·0.01 rad)과 같은 크기. 이 밖의 행은 풀이 뒤 넘을 때만 더한다.
export const LIMIT_MARGIN = 1e-3
// 풀고 난 위치가 한계를 이만큼(m 또는 rad) 넘으면 빠진 행을 더해 다시 푼다(반올림 잡음은 z 자르기가 맡는다). 가정: FTC
// 관절 값(1e-3–10 m·rad)의 배정밀도 반올림(상대 2.2e-16 × 그 크기 × 한 하위 단계의 연산 수십 번)보다 크고, 측정할 수 있는
// 침투(µm)보다 훨씬 작다.
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
// 구속 정칙화: 행마다 대각에 LCP_REGULARIZATION·A_ii를 더한 행렬로 주축 전환을 한다(ODE의 CFM, MuJoCo의 구속 정칙화 R과 같은
// 방식 — https://mujoco.readthedocs.io/en/stable/computation/index.html#soft-constraints). 같은 방향의 행(한 관절의 쿨롱
// 마찰과 한계, 단일 좌표 관절의 모터 손실 상자와 한계, continuous 리깅의 세 행)이 있으면 A가 특이한 양반정치라 주축 전환이
// 끝난다는 보장이 없다(Murty·블록 주축 전환은 P 행렬에서만 유한하다). 정칙화한 행렬은 대칭 양정치(P 행렬)라 끝나고 해가
// 하나다. 그 뒤 근접점 반복(Rockafellar 1976: LCP(A + E, b − E·λ_k), 단조 LCP에서 원래 해로 수렴)으로 정칙화가 남긴 차이를
// 지운다. 가정: 1e-9면 조건수 1e9라 배정밀도 LDLᵀ가 다루고, 근접점 반복은 한 번에 차이를 약 1e-9배로 줄인다.
export const LCP_REGULARIZATION = 1e-9
// 근접점 반복 상한. 가정: 특이하지 않은 방향의 차이가 한 번에 1e-9배로 줄어 2–3번이면 반올림 수준이다. 그래도 남으면 정칙화한
// 해(행마다 차이가 1e-9 × 그 행의 충격만으로 생기는 속도 변화 아래)를 쓴다.
const LCP_PROXIMAL_STEPS = 8
// 상자 LCP의 상대 허용 오차: 상보성 판정(w의 부호)은 1e-12 × max(1, |b|), 경계 판정(λ가 lo·hi에 닿음)은 1e-12 × max(1, |lo|,
// |hi|)로 본다. 가정(출처 없음): 배정밀도 반올림(2.2e-16)의 약 4500배라 몇십 행의 LDLᵀ 풀이에서 생기는 반올림만으로는 상태를
// 바꾸지 않고(바꾸면 주축 전환이 오갈 수 있다), 한 하위 단계 속도로 보면 1e-12 m/s 수준이라 침투·엔코더에 보이지 않는다.
// 근접점 반복도 원래 A에서 이 값 안이 될 때 멈춘다(시험의 무작위 특이 문제와 담아 둔 순환 사례가 이 수준까지 맞는다).
const LCP_RELATIVE_TOLERANCE = 1e-12
// 한 번의 주축 전환 반복 상한. 정칙화한 문제는 P 행렬이라 유한하지만 반올림으로 순환하면 여기서 멈추고 던진다(조용히 상자로
// 자르지 않는다 — world.ts가 그 하위 단계의 속도를 0으로 두고 다음 하위 단계에서 다시 풀며 worldError로 알린다). 가정: 행이 50개 아래면 보통 10번 안에 끝난다.
const LCP_MAX_ITERATIONS = 2000

// 행의 끝 상태: 아래 경계, 자유(w = 0), 위 경계
export type LcpState = 'lower' | 'free' | 'upper'

// w = A·λ + b, lo ≤ λ ≤ hi에서 λ = lo면 w ≥ 0, λ = hi면 w ≤ 0, 그 사이면 w = 0인 λ(상자 혼합 LCP). A는 대각이 양수인 대칭
// 양반정치다(특이해도 된다). 정칙화한 행렬로 블록 주축 전환(Júdice & Pires 1994, 상자 제약)을 하고, 감염 수가 줄지 않으면
// Murty의 최소 첨자 규칙(가장 큰 첨자 하나만 바꿈)으로 바꾼다. 그 뒤 근접점 반복으로 원래 A의 해에 맞춘다(위 주석). 사칙연산만이라
// 결정적이다. start는 행마다 처음 상태(앞 하위 단계의 답, 없으면 λ = 0에 가까운 상태)다. w(따라서 속도)는 시작과 관계없고
// 반복 수만 줄어든다. 주축 전환이 반복 상한을 넘으면 던진다.
export function solveBoxLcp(
  a: readonly (readonly number[])[],
  b: readonly number[],
  lo: readonly number[],
  hi: readonly number[],
  start: readonly (LcpState | undefined)[] = []
): { lambda: number[]; states: LcpState[] } {
  const n = b.length
  if (n === 0) return { lambda: [], states: [] }
  for (let i = 0; i < n; i++)
    if (!(a[i][i] > 0)) throw new Error('joint dynamics: constraint row has no effect')
  const shift = a.map((row, i) => row[i] * LCP_REGULARIZATION)
  let bScale = 1
  let lScale = 1
  for (let i = 0; i < n; i++) {
    bScale = Math.max(bScale, Math.abs(b[i]))
    if (Number.isFinite(lo[i])) lScale = Math.max(lScale, Math.abs(lo[i]))
    if (Number.isFinite(hi[i])) lScale = Math.max(lScale, Math.abs(hi[i]))
  }
  const tolW = LCP_RELATIVE_TOLERANCE * bScale
  const tolL = LCP_RELATIVE_TOLERANCE * lScale
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
  // 정칙화한 LCP(A + E, c)를 state에서 시작해 푼다(lambda·state를 바꾼다)
  const pivot = (c: readonly number[]): void => {
    let best = n + 1
    let tries = BPP_TRIES
    for (let iteration = 0; ; iteration++) {
      if (iteration >= LCP_MAX_ITERATIONS)
        throw new Error('joint dynamics: constraint solve did not converge')
      const free: number[] = []
      for (let i = 0; i < n; i++) {
        if (state[i] === 1) free.push(i)
        else lambda[i] = state[i] === 0 ? lo[i] : hi[i]
      }
      if (free.length > 0) {
        const sub = free.map((i) => free.map((j) => (i === j ? a[i][j] + shift[i] : a[i][j])))
        const rhs = free.map((i) => {
          let s = -c[i]
          for (let j = 0; j < n; j++) if (state[j] !== 1) s -= a[i][j] * lambda[j]
          return s
        })
        const x = ldlSolve(ldlFactor(sub), rhs)
        free.forEach((i, k) => (lambda[i] = x[k]))
      }
      const bad: number[] = []
      for (let i = 0; i < n; i++) {
        if (state[i] === 1) {
          if (lambda[i] < lo[i] - tolL || lambda[i] > hi[i] + tolL) bad.push(i)
          continue
        }
        let w = c[i] + shift[i] * lambda[i]
        for (let j = 0; j < n; j++) w += a[i][j] * lambda[j]
        if ((state[i] === 0 && w < -tolW) || (state[i] === 2 && w > tolW)) bad.push(i)
      }
      if (bad.length === 0) return
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
  }
  // 원래 A에서 상보성을 어기는 가장 큰 양(w 단위)
  const violation = (): number => {
    let worst = 0
    for (let i = 0; i < n; i++) {
      let w = b[i]
      for (let j = 0; j < n; j++) w += a[i][j] * lambda[j]
      const v = state[i] === 1 ? Math.abs(w) : state[i] === 0 ? -w : w
      worst = Math.max(worst, v)
    }
    return worst
  }
  pivot(b)
  for (let step = 0; step < LCP_PROXIMAL_STEPS && violation() > tolW; step++)
    pivot(b.map((x, i) => x - shift[i] * lambda[i]))
  // 자유 행의 λ가 허용 오차 안에서 상자를 살짝 넘은 것만 경계로 맞춘다(반올림)
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
export type Row = { key: string; j: number[]; target: number; lo: number; hi: number }

// ---- 몸체 충돌(5, spec-5 §4.1)의 접촉 틀 ----

// 몸체 하나의 속도(C 축): 각속도와 몸체 원점의 속도
export type BodyVelocity = { omega: Vec3; linear: Vec3 }
// 하위 단계의 접촉 틀 C: 축은 관절 나무 틀(부유 기저면 필드 축, 고정 기저면 로봇 축), 원점은 지금 섀시 원점
// (부유: (basePose.x, basePose.y, 0), 고정: 로봇 원점). bodies[0] = 섀시, bodies[i + 1] = 세계 설명 관절 i
export type ContactFrames = {
  readonly origin: Vec3
  readonly bodies: readonly Frame3[]
  readonly velocities: readonly BodyVelocity[]
  // 나무 관절 축·앵커(C 좌표, 행렬 연산 없이 bodies() 한 번에서 꺼낸 것). Articulation만 읽는다
  readonly tree: readonly { axis: Vec3; anchor: Vec3 }[]
}

export class Articulation {
  // 세계 설명의 관절(공개 순번)
  readonly joints: readonly SimJointSpec[]
  // z 좌표마다 무엇인지(기저, 관절 q, 그 관절 모터 구동의 φ, 관절에 묶이지 않은 좌표)
  readonly coordinates: readonly Coordinate[]
  // 나무 관절 변위 = S·z (나무 관절 수 × 좌표 수). 기저가 있으면 앞 BASE_JOINTS 행이 가상 관절이다.
  readonly s: readonly (readonly number[])[]
  // 좌표마다 회전자 반사 관성(모터 수 × J_r × 감속비²) 또는 밖에서 준 armature
  readonly armature: readonly number[]
  // 관절에 묶이지 않은 좌표의 순번(options.free 순서)
  readonly freeCoordinates: readonly number[]
  // 기저 좌표의 순번(필드 X, 필드 Y, 요), 기저가 없으면 빈 배열
  readonly baseCoordinates: readonly number[]
  z: number[]
  v: number[]
  // 계산에 쓰는 관절 나무(기저 가상 관절 + 세계 설명 관절, 부모 순번을 옮긴 것)
  private readonly tree: readonly SimJointSpec[]
  // 세계 설명 관절 i의 나무 순번 = i + offset
  private readonly offset: number
  private readonly start: Pose2 | null
  // 직선 관절 축(관절 틀 단위 벡터)·회전 관절 축
  private readonly axes: V3[]
  private readonly origins: { rotation: M3; position: V3 }[]
  private readonly gravity: number
  // 앞 하위 단계 LCP의 행 상태(이름으로 찾기만 한다)
  private lcpStates = new Map<string, LcpState>()
  // 앞 하위 단계의 밖에서 준 행 충격(키 → λ)과 그 하위 단계 길이(벽 마찰 엇갈림의 1회차가 쓴다)
  private contactImpulses = new Map<string, number>()
  private lastH = 0
  // 기저 렌치에 쓰는 좌표 가속(저역 통과)과 그 시간 상수
  private readonly loadFilterTau: number
  private filteredAccel: number[]

  constructor(joints: readonly SimJointSpec[], options: ArticulationOptions = {}) {
    this.joints = joints
    this.gravity = options.gravity ?? GRAVITY
    const base = options.base ?? null
    const offset = base ? BASE_JOINTS : 0
    this.offset = offset
    this.start = base ? { ...base.start } : null
    this.loadFilterTau = options.loadFilterTau ?? 0
    const tree: SimJointSpec[] = base ? baseJoints(base.body, base.start) : []
    for (const joint of joints)
      tree.push(
        offset === 0
          ? joint
          : { ...joint, parent: joint.parent >= 0 ? joint.parent + offset : offset - 1 }
      )
    this.tree = tree
    const coordinates: Coordinate[] = []
    const rows: number[][] = tree.map(() => [])
    const armature: number[] = []
    const add = (kind: Coordinate['kind'], joint: number, inertia: number): number => {
      coordinates.push({ kind, joint })
      armature.push(inertia)
      return coordinates.length - 1
    }
    const entry = (joint: number, coordinate: number, value: number): void => {
      rows[joint + offset][coordinate] = (rows[joint + offset][coordinate] ?? 0) + value
    }
    const baseCoordinates: number[] = []
    for (let k = 0; k < offset; k++) {
      const c = add('base', -1, 0)
      rows[k][c] = 1
      baseCoordinates.push(c)
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
    this.freeCoordinates = (options.free ?? []).map((inertia) => add('free', -1, inertia))
    this.baseCoordinates = baseCoordinates
    // 단은 parseWorldSpec가 구동 관절 하나에 들어 있음을 확인한다(아니면 그 관절의 행이 0이라 움직이지 않는다)
    const m = coordinates.length
    this.coordinates = coordinates
    this.s = rows.map((row) => Array.from({ length: m }, (_, c) => row[c] ?? 0))
    this.armature = armature
    this.z = new Array<number>(m).fill(0)
    this.v = new Array<number>(m).fill(0)
    this.filteredAccel = new Array<number>(m).fill(0)
    this.axes = tree.map((j) => v3(j.axis))
    this.origins = tree.map((j) => ({
      rotation: rotationZYX(j.origin.rotation),
      position: v3(j.origin.position)
    }))
  }

  // 부유 기저의 필드 자세(시작 자세 + 기저 좌표, 요는 감지 않음). 기저가 없으면 null
  basePose(z: readonly number[] = this.z): Pose2 | null {
    if (!this.start) return null
    return { x: this.start.x + z[0], y: this.start.y + z[1], yaw: this.start.yaw + z[2] }
  }

  // 부유 기저의 속도(필드 축 vx·vy m/s, 요 속도 rad/s). 기저가 없으면 null
  baseVelocity(): { vx: number; vy: number; omega: number } | null {
    if (!this.start) return null
    return { vx: this.v[0], vy: this.v[1], omega: this.v[2] }
  }

  // 앞 하위 단계에서 밖에서 준 행 key의 충격(N·s 또는 N·m·s), 그 행이 없었으면 0
  contactImpulse(key: string): number {
    return this.contactImpulses.get(key) ?? 0
  }

  // 관절 변위 q = S·z(세계 설명 관절 순번)
  q(z: readonly number[] = this.z): number[] {
    const all = this.treeQ(z)
    return this.offset === 0 ? all : all.slice(this.offset)
  }

  // 관절 속도 q̇ = S·v
  qd(v: readonly number[] = this.v): number[] {
    return this.q(v)
  }

  // 나무 관절(기저 가상 관절 포함) 변위
  private treeQ(z: readonly number[]): number[] {
    return this.s.map((row) => row.reduce((sum, value, c) => sum + value * z[c], 0))
  }

  // 몸체 자세와 운동 부분공간(로봇 좌표, 부유 기저면 필드 좌표). q는 나무 관절 변위
  private bodies(q: readonly number[]): Body[] {
    const bodies: Body[] = []
    this.tree.forEach((joint, i) => {
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

  // CRBA: 나무 관절 질량 행렬 M_q(q)(q는 나무 관절 변위, 기저가 없으면 세계 설명 관절 그대로)
  massMatrix(q: readonly number[] = this.treeQ(this.z)): number[][] {
    return this.crba(this.bodies(q))
  }

  private crba(bodies: Body[]): number[][] {
    const n = bodies.length
    const composite = bodies.map((b) => b.inertia.slice())
    for (let i = n - 1; i >= 0; i--) {
      const parent = this.tree[i].parent
      if (parent >= 0) for (let k = 0; k < 36; k++) composite[parent][k] += composite[i][k]
    }
    const m = bodies.map(() => new Array<number>(n).fill(0))
    for (let i = 0; i < n; i++) {
      const force = apply66(composite[i], bodies[i].motion)
      m[i][i] = dot6(bodies[i].motion, force)
      for (let j = this.tree[i].parent; j >= 0; j = this.tree[j].parent) {
        const value = dot6(bodies[j].motion, force)
        m[i][j] = value
        m[j][i] = value
      }
    }
    return m
  }

  // RNEA(q̈ = 0, 기저 가속 −g): 중력과 코리올리·원심력의 나무 관절 일반화 힘 c_q(q, q̇). M·q̈ + c = τ
  bias(
    q: readonly number[] = this.treeQ(this.z),
    qd: readonly number[] = this.treeQ(this.v)
  ): number[] {
    return this.rnea(this.bodies(q), qd).tau
  }

  // qdd가 있으면 그 가속을 넣는다(기저 렌치용). root는 섀시 관절(나무 순번 BASE_JOINTS − 1)이 자식을 모두 더한 공간 힘(기저가 없으면 null)
  private rnea(
    bodies: Body[],
    qd: readonly number[],
    qdd?: readonly number[]
  ): { tau: number[]; root: S6 | null } {
    const n = bodies.length
    const velocity: S6[] = []
    const accel: S6[] = []
    const force: S6[] = []
    // 고정 기저를 위로 g만큼 가속하면 모든 몸체에 중력이 걸린다(Featherstone의 표준 처리)
    const baseAccel: S6 = [0, 0, 0, 0, 0, this.gravity]
    for (let i = 0; i < n; i++) {
      const parent = this.tree[i].parent
      const vp: S6 = parent >= 0 ? velocity[parent] : [0, 0, 0, 0, 0, 0]
      const ap: S6 = parent >= 0 ? accel[parent] : baseAccel
      const s = bodies[i].motion
      const vi = vp.map((x, k) => x + s[k] * qd[i])
      const sd = crossMotion(vi, s)
      const ai = qdd
        ? ap.map((x, k) => x + sd[k] * qd[i] + s[k] * qdd[i])
        : ap.map((x, k) => x + sd[k] * qd[i])
      const inertia = bodies[i].inertia
      const momentum = apply66(inertia, vi)
      const ia = apply66(inertia, ai)
      const vxf = crossForce(vi, momentum)
      velocity.push(vi)
      accel.push(ai)
      force.push(ia.map((x, k) => x + vxf[k]))
    }
    const tau = new Array<number>(n).fill(0)
    let root: S6 | null = null
    for (let i = n - 1; i >= 0; i--) {
      tau[i] = dot6(bodies[i].motion, force[i])
      if (this.offset > 0 && i === this.offset - 1) root = force[i].slice()
      const parent = this.tree[i].parent
      if (parent >= 0) for (let k = 0; k < 6; k++) force[parent][k] += force[i][k]
    }
    return { tau, root }
  }

  // 바닥이 받쳐야 할 렌치(로봇 좌표 원점 기준, 로봇 축). 섀시 관절이 자식을 모두 더한 공간 힘 f = [n_O; f](필드 원점 기준)을
  // 로봇 원점 P로 옮기고(n_P = n_O − P × f) 로봇 축으로 돌린다. 바퀴 마찰·벽 힘은 바닥 높이의 수평 힘이라 P 둘레에 z 모멘트만
  // 내므로 (F_z, M_x, M_y)는 바퀴 법선 하중만 받친다(method §5.1). 중력·q·q̇는 지금 값, 가속은 저역 통과한 앞 하위 단계 값이다.
  // 기저가 없으면 null.
  baseWrench(): BaseWrench | null {
    if (this.offset === 0) return null
    const bodies = this.bodies(this.treeQ(this.z))
    const { root } = this.rnea(bodies, this.treeQ(this.v), this.treeQ(this.filteredAccel))
    const f = root as S6
    const chassis = bodies[this.offset - 1]
    const n = add3([f[0], f[1], f[2]], scale3(cross3(chassis.origin, [f[3], f[4], f[5]]), -1))
    const local = apply3(transpose3(chassis.rotation), n)
    return { fz: f[5], mx: local[0], my: local[1] }
  }

  // ---- 몸체 충돌(5, spec-5 §4.1). 계약: 서명만, 5 A가 구현한다(부르는 곳이 아직 없다) ----

  // 하위 단계의 접촉 틀(지금 z·v)
  contactFrames(): ContactFrames {
    throw new Error('5-A')
  }

  // 점 p(C 좌표)에서 방향 d(단위)의 상대 속도 행 J_a − J_b(z 공간, 길이 = coordinates.length). body −1 = 섀시,
  // b = null이면 정적(J_a만). 두 경로에 다 있는 나무 관절(공통 조상)은 더하지 않는다(정확한 0)
  relativeJacobian(frames: ContactFrames, a: number, b: number | null, p: Vec3, d: Vec3): number[] {
    void frames
    void a
    void b
    void p
    void d
    throw new Error('5-A')
  }

  // = relativeJacobian(frames, body, null, p, d)
  pointJacobian(frames: ContactFrames, body: number, p: Vec3, d: Vec3): number[] {
    return this.relativeJacobian(frames, body, null, p, d)
  }

  // 축 n 둘레 상대 각속도(비틀림) 행: 경로의 회전 관절 a_i·n(직선 0), 기저 요 열은 n.z. 공통 조상은 뺀다
  twistJacobian(frames: ContactFrames, a: number, b: number | null, n: Vec3): number[] {
    void frames
    void a
    void b
    void n
    throw new Error('5-A')
  }

  // 점 p(C)의 속도(C 축): v_o + ω × (p − o)
  pointVelocity(frames: ContactFrames, body: number, p: Vec3): Vec3 {
    void frames
    void body
    void p
    throw new Error('5-A')
  }

  // 세계 설명 관절 i 몸체의 자세(로봇 좌표, 부유 기저면 필드 좌표, 시험·표시용). q는 나무 관절 변위
  bodyPose(
    i: number,
    q: readonly number[] = this.treeQ(this.z)
  ): { rotation: number[]; origin: number[] } {
    const b = this.bodies(q)[i + this.offset]
    return { rotation: b.rotation.slice(), origin: b.origin.slice() }
  }

  // 세계 설명 관절 몸체들의 자세(세계 설명 관절 순번 순, 로봇 좌표, 부유 기저면 필드 좌표). 지금 z로 모든 몸체를 한 번만
  // 계산한다(센서·4d 카메라가 틱마다 부른다, spec-4c §1.2). 회전은 행 우선 9원소 사본이다
  bodyPoses(): Frame3[] {
    return this.bodies(this.treeQ(this.z))
      .slice(this.offset)
      .map((b) => ({
        rotation: b.rotation.slice(),
        origin: { x: b.origin[0], y: b.origin[1], z: b.origin[2] }
      }))
  }

  // 위치 에너지(J, 바닥 z = 0 기준, 섀시 포함, 시험용). q는 나무 관절 변위
  potentialEnergy(q: readonly number[] = this.treeQ(this.z)): number {
    let energy = 0
    this.bodies(q).forEach((b, i) => {
      const body = this.tree[i].body
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

  // 하위 단계 하나(h초). drive가 구동 힘을, contacts가 밖에서 주는 행·행 감쇠를 준다(없으면 3b와 같은 연산).
  step(h: number, drive: DriveModel, contacts?: ContactSet): void {
    const m = this.coordinates.length
    if (m === 0) return
    const tree = this.tree
    const n = tree.length
    const s = this.s
    const q = this.treeQ(this.z)
    const qd = this.treeQ(this.v)
    const bodies = this.bodies(q)
    const mz = this.coordinateMass(this.crba(bodies))
    const cq = this.rnea(bodies, qd).tau

    // 관절 공간의 수동 힘(점성·스프링)과 쿨롱 상자
    const passiveForce = new Array<number>(n).fill(0)
    const passiveDamping = new Array<number>(n).fill(0)
    const passiveStiffness = new Array<number>(n).fill(0)
    tree.forEach((joint, i) => {
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
    // 행 점성 감쇠 Σ c·JᵀJ(롤러 자유 방향)는 감쇠와 같이 h를 곱해 M̂에 더한다
    for (const term of contacts?.damping ?? []) {
      const j = term.j
      for (let a = 0; a < m; a++) {
        if (j[a] === 0) continue
        for (let b = 0; b < m; b++) if (j[b] !== 0) baseDamping[a][b] += term.c * j[a] * j[b]
      }
    }
    const momentum = mz.map((row) => row.reduce((sum, x, c) => sum + x * this.v[c], 0))
    const contactRows = contacts?.rows ?? []
    // 마찰 행이 있으면 엇갈림 2회(1회차 법선은 앞 하위 단계의 같은 키 힘을 이번 h로 바꾼 것)
    const staggered = contactRows.some((row) => row.friction)
    const previous = (key: string): number =>
      this.lastH > 0 ? ((this.contactImpulses.get(key) ?? 0) * h) / this.lastH : 0

    type Solution = {
      v: number[]
      factor: { l: number[][]; d: number[] }
      impulses: Map<string, number>
      // 마지막 풀이의 밖에서 준 행(마찰 상자를 정한 것)과 그 충격(한계 충격 풀이가 이어 쓴다)
      external: Row[]
      externalLambda: number[]
    }
    const solve = (forces: DriveForces): Solution => {
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
      tree.forEach((joint, i) => {
        if (!joint.limits) return
        const reach = Math.abs(qd[i]) * h + LIMIT_MARGIN
        included[2 * i] = q[i] - joint.limits.lower <= reach
        included[2 * i + 1] = joint.limits.upper - q[i] <= reach
      })
      const pass = (normal: (key: string) => number): Solution => {
        const external = externalRows(contactRows, normal)
        for (;;) {
          const rows = [...friction, ...this.limitRows(q, h, included), ...external]
          const { v, lambda } = this.constrained(factor, vStar, rows)
          // 빠진 한계가 넘으면 더해 다시 푼다
          const qNext = this.treeQ(v).map((rate, i) => q[i] + h * rate)
          let added = false
          tree.forEach((joint, i) => {
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
          if (added) continue
          const impulses = new Map<string, number>()
          const first = rows.length - external.length
          const externalLambda = external.map((_, k) => lambda[first + k])
          external.forEach((row, k) => impulses.set(row.key, externalLambda[k]))
          return { v, factor, impulses, external, externalLambda }
        }
      }
      const once = pass(previous)
      if (!staggered) return once
      return pass((key) => once.impulses.get(key) ?? 0)
    }

    const first = drive(this.z, this.v)
    let solution = solve(first)
    const second = drive(this.z, solution.v)
    if (second.regions !== first.regions) solution = solve(second)

    const v = solution.v
    const z = this.z.map((x, c) => x + h * v[c])
    const impulses = this.clampLimits(z, v, solution.factor, h, solution)
    for (let c = 0; c < m; c++)
      if (!Number.isFinite(z[c]) || !Number.isFinite(v[c]))
        throw new Error('joint dynamics diverged')
    if (this.offset > 0 && this.loadFilterTau > 0) {
      // 기저 렌치에 쓰는 가속: 이번 하위 단계 가속 (v⁺ − v)/h의 1차 저역 통과(정확한 이산화 α = 1 − e^(−h/τ))
      const alpha = 1 - Math.exp(-h / this.loadFilterTau)
      this.filteredAccel = this.filteredAccel.map(
        (a, c) => a + alpha * ((v[c] - this.v[c]) / h - a)
      )
    }
    this.z = z
    this.v = v
    this.contactImpulses = impulses
    this.lastH = h
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
    this.tree.forEach((joint, i) => {
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
    this.tree.forEach((joint, i) => {
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

  // v⁺ = v* + M̂⁻¹Jᵀλ, λ는 상자 LCP의 해(행 순서)
  private constrained(
    factor: { l: number[][]; d: number[] },
    vStar: number[],
    rows: Row[]
  ): { v: number[]; lambda: number[] } {
    if (rows.length === 0) return { v: vStar, lambda: [] }
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
    return { v, lambda }
  }

  // z 공간 자르기: S 행이 성분 하나(s·z_c)인 한계 관절은 z_c를 [lo, hi]/s 안에 둔다(리깅으로 묶인 관절은 정확한 LCP가 맡는다).
  // 한계에 닿은(넘은) 좌표는 한계에 두고 바깥 속도를 지운다(반발 0: 다음 하위 단계는 멈춘 채 시작한다). 속도를 지우는 것은
  // 한계 위 행들에만 거는 충격 Jᵀλ다: v⁺ = v + M̂⁻¹Jᵀλ. 그래서 결합된 다른 좌표(한계에 닿은 단이 실은 팔, 리깅으로 묶인 단)도
  // 같은 충격을 받아 그 일반화 운동량이 그대로다(예전에는 v_C만 0으로 바꿔 자식이 마지막 하위 단계가 한계와 어떻게 맞았는지에
  // 따라 운동량을 0–100 % 잃었다). 행은 두 가지다.
  //   - 성분 하나인 한계: J = ±e_c(안쪽이 +).
  //   - S 행이 여러 성분인 한계(continuous 리깅의 맨 위 단 q = r·φ − Σq): 적분한 뒤 한계에 있거나 LIMIT_TOLERANCE 안이면
  //     J = ±S_i. 이 행이 없으면 다른 좌표를 멈추는 충격이 M̂로 묶인 φ를 바꿔 그 단을 한계 밖으로 밀고(다음 하위 단계의 간격
  //     항이 그 침투를 바깥 속도로 바꿔 단이 튀어 오른다), 수평 리프트에서는 정확한 비탄성 충돌보다 운동 에너지가 늘었다.
  // 한계는 한쪽 구속이라 행마다 상자 LCP다: λ ≥ 0, w = J·v⁺ ≥ 0, 상보(λ ≠ 0이면 w = 0). 그래서 다른 좌표를 멈추는 충격이 한계에
  // 멈춰 있던 좌표를 안쪽으로 밀면 그것은 한계에서 떨어지고(두 방향 구속으로 묶으면 그 운동량을 잃는다), 바깥으로 밀면 멈춘
  // 채다. M̂은 이번 하위 단계의 암시 행렬(LCP와 같은 계)이고, 멈추지 않은 좌표의 위치는 바뀐 속도로 다시 적분한다. 그 뒤 걸린
  // 여러 성분 행이나 한계를 넘은 여러 성분 관절은 멈추지 않은 좌표만 움직여(그 행 방향의 최소 이동) 한계에 놓는다.
  // 밖에서 준 행(3c: 바퀴 견인·롤러 상자, 벽 법선·마찰)도 같은 충격 LCP에 넣는다. 넣지 않으면 부유 기저에서 한계 충격 M̂⁻¹Jᵀλ가
  // 벽 구속을 푼 뒤의 기저를 벽 쪽으로 옮겨(z += h·Δv), 벽에 붙어 민 채 슬라이드를 한계에 박을 때마다 침투가 쌓인다(걸친 꼭짓점의
  // 목표가 0이라 되돌아오지 않는다, 3c 리뷰). 본 LCP와 같은 계를 이어 푸는 것이라 행마다 합 λ_본 + λ_충격이 본 LCP의 상자
  // [lo, hi](마찰 상자는 본 풀이에서 정한 것) 안이고 목표도 같다: 충격 λ ∈ [lo − λ_본, hi − λ_본], w = J·v⁺ − 목표. 벽 법선은
  // 걸친 꼭짓점 목표 0, 아니면 −간격/h, 합 λ ≥ 0이다(벽이 미는 힘을 줄일 수는 있어도 당기지 않는다). 3b 마찰 상자(관절 쿨롱,
  // 구동 상자)는 넣지 않는다(3b와 같다). 밖에서 준 행이 없으면(기저 고정) 연산이 3b와 같다. 돌려주는 값은 행마다 이 하위
  // 단계의 합 충격이다.
  private clampLimits(
    z: number[],
    v: number[],
    factor: { l: number[][]; d: number[] },
    h: number,
    contacts: {
      impulses: Map<string, number>
      external: readonly Row[]
      externalLambda: readonly number[]
    }
  ): Map<string, number> {
    const m = this.coordinates.length
    const low = new Array<number>(m).fill(-Infinity)
    const high = new Array<number>(m).fill(Infinity)
    // 여러 성분 한계 관절: 관절 순번, 안쪽 방향(+1 = 아래 한계, −1 = 위 한계)과 그 한계 값
    const coupled: { joint: number; sign: number; limit: number }[] = []
    this.tree.forEach((joint, i) => {
      if (!joint.limits) return
      const nonzero = this.s[i].flatMap((x, c) => (x !== 0 ? [c] : []))
      if (nonzero.length > 1) {
        coupled.push({ joint: i, sign: 1, limit: joint.limits.lower })
        coupled.push({ joint: i, sign: -1, limit: joint.limits.upper })
        return
      }
      if (nonzero.length !== 1) return
      const c = nonzero[0]
      const k = this.s[i][c]
      const a = joint.limits.lower / k
      const b = joint.limits.upper / k
      low[c] = Math.max(low[c], Math.min(a, b))
      high[c] = Math.min(high[c], Math.max(a, b))
    })
    const dot = (j: readonly number[], x: readonly number[]): number => {
      let sum = 0
      for (let c = 0; c < m; c++) if (j[c] !== 0) sum += j[c] * x[c]
      return sum
    }
    // 여러 성분 행의 간격(안쪽이 +): sign·(S_i·z − 한계)
    const gap = (row: (typeof coupled)[number]): number =>
      row.sign * (dot(this.s[row.joint], z) - row.limit)
    // 구속 행 후보: 성분 하나면 coordinate ≥ 0(그 좌표를 한계에 둔다), 여러 성분이면 coupled 순번
    const rows: { j: number[]; coordinate: number; coupled: number }[] = []
    for (let c = 0; c < m; c++) {
      const j = new Array<number>(m).fill(0)
      if (z[c] <= low[c]) {
        z[c] = low[c]
        j[c] = 1
      } else if (z[c] >= high[c]) {
        z[c] = high[c]
        j[c] = -1
      } else continue
      // 한계에 멈춰 있는 좌표는 정확히 +0(반올림의 −0 없이)
      if (v[c] === 0) v[c] = 0
      rows.push({ j, coordinate: c, coupled: -1 })
    }
    coupled.forEach((row, k) => {
      if (gap(row) > LIMIT_TOLERANCE * Math.max(1, Math.abs(row.limit))) return
      rows.push({ j: this.s[row.joint].map((x) => row.sign * x), coordinate: -1, coupled: k })
    })
    // 바깥으로 움직이는 한계 행이 없으면 충격이 없다(λ = 0이 해: 밖에서 준 행은 본 LCP가 이미 맞췄다)
    if (rows.every((row) => dot(row.j, v) >= 0)) {
      this.placeCoupled(z, coupled, rows, [], new Array<boolean>(m).fill(false), gap, low, high)
      return contacts.impulses
    }
    // 한계 행 뒤에 밖에서 준 행을 둔다. y_k = M̂⁻¹J_kᵀ, A = J·M̂⁻¹·Jᵀ(양반정치), w = A·λ + J·v − 목표 = J·v⁺ − 목표
    const external = contacts.external
    const all = [...rows.map((row) => row.j), ...external.map((row) => row.j)]
    const y = all.map((j) => ldlSolve(factor, j))
    const a = all.map((j) => y.map((col) => dot(j, col)))
    const { lambda, states } = solveBoxLcp(
      a,
      [...rows.map((row) => dot(row.j, v)), ...external.map((row) => dot(row.j, v) - row.target)],
      [...rows.map(() => 0), ...external.map((row, k) => row.lo - contacts.externalLambda[k])],
      [
        ...rows.map(() => Infinity),
        ...external.map((row, k) => row.hi - contacts.externalLambda[k])
      ]
    )
    const held = new Array<boolean>(m).fill(false)
    const active: number[] = []
    rows.forEach((row, k) => {
      // 구속이 걸린(λ ≠ 0) 행이나, 바깥 속도를 정확히 지운(w = 0) 행은 멈춘다
      if (states[k] !== 'free' && lambda[k] === 0) return
      if (row.coordinate >= 0) held[row.coordinate] = true
      else active.push(row.coupled)
    })
    for (let c = 0; c < m; c++) {
      let dv = 0
      y.forEach((col, k) => (dv += col[c] * lambda[k]))
      if (held[c]) {
        // 멈춘 좌표는 정확히 +0(반올림 잡음·−0 없이)
        v[c] = 0
        continue
      }
      if (dv === 0) continue
      v[c] += dv
      z[c] += h * dv
      if (z[c] < low[c]) z[c] = low[c]
      else if (z[c] > high[c]) z[c] = high[c]
    }
    this.placeCoupled(z, coupled, rows, active, held, gap, low, high)
    if (external.length === 0) return contacts.impulses
    const impulses = new Map(contacts.impulses)
    external.forEach((row, k) => {
      const extra = lambda[rows.length + k]
      if (extra !== 0) impulses.set(row.key, contacts.externalLambda[k] + extra)
    })
    return impulses
  }

  // 걸린 여러 성분 행(active)과 한계를 넘은 여러 성분 관절을 한계에 놓는다. 멈춘 좌표(held)와 한계에 닿은 성분 하나 좌표는
  // 움직이지 않고, 나머지 좌표를 그 행 방향(J를 그 좌표로 제한한 것)으로 최소만큼 옮긴다(성분 하나 한계 안에서). 다른 행을
  // 넘게 하면 다시 본다(많아야 네 번, 결정적).
  private placeCoupled(
    z: number[],
    coupled: readonly { joint: number; sign: number; limit: number }[],
    rows: readonly { coordinate: number; coupled: number }[],
    active: readonly number[],
    held: readonly boolean[],
    gap: (row: { joint: number; sign: number; limit: number }) => number,
    low: readonly number[],
    high: readonly number[]
  ): void {
    if (coupled.length === 0) return
    const fixed = held.slice()
    for (const row of rows) if (row.coordinate >= 0) fixed[row.coordinate] = true
    const target = new Set(active)
    for (let pass = 0; pass < 4; pass++) {
      let moved = false
      coupled.forEach((row, k) => {
        const g = gap(row)
        const tolerance = LIMIT_TOLERANCE * Math.max(1, Math.abs(row.limit))
        if (!(g < -tolerance || (target.has(k) && Math.abs(g) > tolerance))) return
        const j = this.s[row.joint].map((x, c) => (fixed[c] ? 0 : row.sign * x))
        let norm = 0
        for (const x of j) norm += x * x
        if (norm === 0) return
        // sign·S_i·(z + α·j) = sign·한계 → α = −g / |j|²
        const alpha = -g / norm
        for (let c = 0; c < z.length; c++) {
          if (j[c] === 0) continue
          z[c] = Math.min(high[c], Math.max(low[c], z[c] + alpha * j[c]))
        }
        moved = true
      })
      if (!moved) return
    }
  }
}

// 부유 기저의 가상 관절: 필드 X 직선(원점 = 시작 위치) → 필드 Y 직선 → Z 회전(시작 요). 섀시 몸체는 Z 회전에 달고, 직선 관절
// 몸체는 질량이 없다(MIN_COORDINATE_INERTIA가 특이를 막고, 섀시·자식 질량이 CRBA로 그 대각에 들어온다).
function baseJoints(body: SimBody, start: Pose2): SimJointSpec[] {
  const empty: SimBody = {
    mass: 0,
    centerOfMass: { x: 0, y: 0, z: 0 },
    inertia: [0, 0, 0, 0, 0, 0]
  }
  const joint = (
    parent: number,
    type: 'revolute' | 'prismatic',
    position: Vec3,
    yaw: number,
    axis: Vec3,
    mass: SimBody
  ): SimJointSpec => ({
    parent,
    type,
    origin: { position, rotation: { x: 0, y: 0, z: yaw } },
    axis,
    limits: null,
    body: mass,
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: []
  })
  return [
    joint(-1, 'prismatic', { x: start.x, y: start.y, z: 0 }, 0, { x: 1, y: 0, z: 0 }, empty),
    joint(0, 'prismatic', { x: 0, y: 0, z: 0 }, 0, { x: 0, y: 1, z: 0 }, empty),
    joint(1, 'revolute', { x: 0, y: 0, z: 0 }, start.yaw, { x: 0, y: 0, z: 1 }, body)
  ]
}

// 밖에서 준 행을 LCP 행으로(마찰 행은 법선 충격 normal(key)로 상자를 정하고, 상자가 0이면 넣지 않는다). 시험용으로 내보낸다.
// 지금 모양(normal)의 식과 연산 순서는 5 전과 같다(기준 해시, spec-5 §2.4 K4)
export function externalRows(rows: readonly ContactRow[], normal: (key: string) => number): Row[] {
  const out: Row[] = []
  for (const row of rows) {
    const f = row.friction
    if (f) {
      const bound =
        'normal' in f
          ? f.mu * Math.max(0, normal(f.normal))
          : f.mu *
            Math.min(
              f.patch.reduce((sum, p) => sum + p.weight * Math.max(0, normal(p.normal)), 0),
              f.cap ?? Infinity
            )
      if (!(bound > 0)) continue
      out.push({ key: row.key, j: row.j, target: row.target, lo: -bound, hi: bound })
    } else out.push({ key: row.key, j: row.j, target: row.target, lo: row.lo, hi: row.hi })
  }
  return out
}

// 시험·표시용: 점 p(몸체 틀)의 로봇 좌표
export function bodyPoint(pose: { rotation: number[]; origin: number[] }, p: Vec3): number[] {
  return add3([pose.origin[0], pose.origin[1], pose.origin[2]], apply3(pose.rotation, v3(p)))
}
