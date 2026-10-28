import type { Pose2, SimWheelSpec, Vec2 } from './worldSpec'

// 구동계 운동학: 바퀴마다 이번 하위 단계의 굴림 변위 s_i(m, 앞으로 구르면 +)에서 로봇 좌표 변위(Δx, Δy, Δθ)를 최소제곱으로
// 구한다(미끄럼 허용, 질량 없음). 로봇 좌표는 X 앞·Y 왼쪽, 각은 반시계 +.
//
// 바퀴 i의 굴림 단위 벡터 u_i = (cos angle, sin angle), 구속 방향 a_i(그 방향으로는 미끄러지지 않는다):
//   메카넘 flbr: a = R(−45°)·u, frbl: a = R(+45°)·u (롤러가 그 방향 성분만 바퀴 회전으로 받는다)
//   옴니: a = u (옆으로는 롤러가 자유롭다)
//   일반(traction): a = u 행과 옆(u⊥) 행(옆 변위 0)
// 행: a_i · (v + ω × p_i) = s_i · (u_i · a_i). 구동하지 않는 바퀴(모터 없음)는 일반 바퀴면 옆 행만, 메카넘·옴니는 행 없음.
// 정규 방정식(3×3)을 풀되 ω 성분은 바퀴들의 평균 반경 거리 L로 척도를 맞추고(ω·L, 단위가 m가 되게), AᵀA의 대칭
// 고유 분해(Jacobi)로 유사 역행렬을 만든다. 가장 큰 고유값의 1e-9배 아래인 방향은 버려서 특이한 배치(바퀴 하나, 평행한
// 옴니)에서 최소 노름 해를 고른다(여인수·행렬식 역행렬은 계수 1에서 행렬식이 반올림 잡음이라 쓰지 않는다). 행이 없으면
// 움직이지 않는다.
//
// 표준 메카넘 역기구학과 같다(바퀴가 (±lx, ±ly)에 있을 때, l = lx + ly):
//   v_fl = vx − vy − lω, v_fr = vx + vy + lω, v_bl = vx + vy − lω, v_br = vx − vy + lω
// 4륜 탱크(일반 바퀴)의 제자리 회전은 바퀴 굴림 Δ(왼쪽 −Δ, 오른쪽 +Δ)에 대해 ω = Δ·ly/(lx² + ly²)이다(옆 미끄럼 저항과
// 앞뒤 미끄럼 저항이 같다고 본 쿨롱 마찰 균형과 같다). 6륜 드롭센터처럼 바퀴마다 하중이 다른 경우는 다루지 않는다(한계).

// 유사 역행렬에서 버리는 고유값(가장 큰 고유값에 대한 비)
const RANK_TOLERANCE = 1e-9
// Jacobi 회전의 최대 순회 수(3×3은 보통 5번 안에 비대각이 0이 된다)
const MAX_SWEEPS = 50

type Row = {
  // 계수: [a_x, a_y, (a · (ẑ × p)) / L]
  coef: [number, number, number]
  // 이 행의 오른쪽 값 = s[wheel] × factor (wheel −1이면 0)
  wheel: number
  factor: number
}

export type Twist = { dx: number; dy: number; dTheta: number }

export class Drivetrain {
  private readonly rows: Row[]
  private readonly scale: number
  // x' = K · b (3 × 행 수), 행이 없으면 null
  private readonly solve: number[][] | null

  constructor(wheels: readonly SimWheelSpec[]) {
    const distances = wheels.map((w) => Math.hypot(w.position.x, w.position.y))
    const mean =
      distances.length === 0 ? 0 : distances.reduce((a, b) => a + b, 0) / distances.length
    this.scale = mean > 1e-6 ? mean : 1
    const rows: Row[] = []
    wheels.forEach((wheel, i) => {
      const u: Vec2 = { x: Math.cos(wheel.angle), y: Math.sin(wheel.angle) }
      const driven = wheel.motor !== null
      const add = (a: Vec2, index: number, factor: number): void => {
        // ẑ × p = (−p_y, p_x)
        const turn = (-a.x * wheel.position.y + a.y * wheel.position.x) / this.scale
        rows.push({ coef: [a.x, a.y, turn], wheel: index, factor })
      }
      switch (wheel.kind) {
        case 'mecanum': {
          if (!driven) break
          const angle = wheel.angle + (wheel.rollers === 'frbl' ? Math.PI / 4 : -Math.PI / 4)
          const a = { x: Math.cos(angle), y: Math.sin(angle) }
          add(a, i, a.x * u.x + a.y * u.y)
          break
        }
        case 'omni':
          if (driven) add(u, i, 1)
          break
        case 'traction':
          if (driven) add(u, i, 1)
          add({ x: -u.y, y: u.x }, -1, 0)
          break
      }
    })
    this.rows = rows
    this.solve = rows.length === 0 ? null : solveMatrix(rows)
  }

  // 바퀴마다 굴림 변위(wheels와 같은 순서) → 로봇 좌표 변위
  twist(rolls: readonly number[]): Twist {
    const k = this.solve
    if (!k) return { dx: 0, dy: 0, dTheta: 0 }
    let x = 0
    let y = 0
    let w = 0
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r]
      const b = row.wheel < 0 ? 0 : rolls[row.wheel] * row.factor
      if (b === 0) continue
      x += k[0][r] * b
      y += k[1][r] * b
      w += k[2][r] * b
    }
    return { dx: x, dy: y, dTheta: w / this.scale }
  }
}

// K = (AᵀA)⁺ Aᵀ: 최소제곱 해 중 노름이 가장 작은 것(A⁺b)
function solveMatrix(rows: readonly Row[]): number[][] {
  const n: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]
  for (const { coef } of rows)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) n[i][j] += coef[i] * coef[j]
  const pinv = pseudoInverse3(n)
  return [0, 1, 2].map((i) =>
    rows.map(({ coef }) => pinv[i][0] * coef[0] + pinv[i][1] * coef[1] + pinv[i][2] * coef[2])
  )
}

// 대칭 반양정치 3×3 행렬의 유사 역행렬 V·Λ⁺·Vᵀ(가장 큰 고유값의 RANK_TOLERANCE배 이하인 고유값은 0으로 본다)
function pseudoInverse3(m: readonly number[][]): number[][] {
  const { values, vectors } = symmetricEigen3(m)
  const max = Math.max(values[0], values[1], values[2])
  const result: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]
  if (!(max > 0)) return result
  for (let k = 0; k < 3; k++) {
    if (values[k] <= RANK_TOLERANCE * max) continue
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) result[i][j] += (vectors[i][k] * vectors[j][k]) / values[k]
  }
  return result
}

// 순환 Jacobi 고유 분해: values[k]와 vectors의 k열이 짝이다. 사칙연산과 제곱근만 써서 결정적이다(실행·기계마다 같은 값).
function symmetricEigen3(m: readonly number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((row) => row.slice())
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ]
  const pairs: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2]
  ]
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    if (a[0][1] === 0 && a[0][2] === 0 && a[1][2] === 0) break
    for (const [p, q] of pairs) {
      const apq = a[p][q]
      if (apq === 0) continue
      const app = a[p][p]
      const aqq = a[q][q]
      // 대각에 견줘 반올림 아래인 비대각은 0으로 둔다(순회가 끝나게)
      const g = 100 * Math.abs(apq)
      if (sweep > 3 && Math.abs(app) + g === Math.abs(app) && Math.abs(aqq) + g === Math.abs(aqq)) {
        a[p][q] = 0
        a[q][p] = 0
        continue
      }
      // 회전각의 tan t: a'pq = 0이 되는 두 근 중 작은 것(|회전| ≤ 45°)
      const h = aqq - app
      let t: number
      if (Math.abs(h) + g === Math.abs(h)) {
        t = apq / h
      } else {
        const theta = h / (2 * apq)
        t = 1 / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        if (theta < 0) t = -t
      }
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      a[p][p] = app - t * apq
      a[q][q] = aqq + t * apq
      a[p][q] = 0
      a[q][p] = 0
      const r = 3 - p - q
      const arp = a[r][p]
      const arq = a[r][q]
      a[r][p] = a[p][r] = c * arp - s * arq
      a[r][q] = a[q][r] = s * arp + c * arq
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p]
        const vkq = v[k][q]
        v[k][p] = c * vkp - s * vkq
        v[k][q] = s * vkp + c * vkq
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v }
}

// ---- SE(2) ----

// 로봇 좌표의 일정한 변위(twist)를 필드 자세에 적용한다: P ∘ exp(ξ)
export function applyTwist(pose: Pose2, twist: Twist): Pose2 {
  const { dx, dy, dTheta } = twist
  let a: number
  let b: number
  if (Math.abs(dTheta) < 1e-6) {
    const t2 = dTheta * dTheta
    a = 1 - t2 / 6
    b = dTheta / 2 - (dTheta * t2) / 24
  } else {
    a = Math.sin(dTheta) / dTheta
    b = (1 - Math.cos(dTheta)) / dTheta
  }
  // 로봇 좌표의 평행 이동 V·(dx, dy)
  const tx = a * dx - b * dy
  const ty = b * dx + a * dy
  const cos = Math.cos(pose.yaw)
  const sin = Math.sin(pose.yaw)
  return {
    x: pose.x + cos * tx - sin * ty,
    y: pose.y + sin * tx + cos * ty,
    yaw: pose.yaw + dTheta
  }
}

// 두 필드 자세 사이의 로봇 좌표 변위: log(P0⁻¹ ∘ P1). yaw는 감지 않은 차이를 쓴다.
export function twistBetween(from: Pose2, to: Pose2): Twist {
  const dTheta = to.yaw - from.yaw
  const cos = Math.cos(from.yaw)
  const sin = Math.sin(from.yaw)
  const gx = to.x - from.x
  const gy = to.y - from.y
  const tx = cos * gx + sin * gy
  const ty = -sin * gx + cos * gy
  let a: number
  let b: number
  if (Math.abs(dTheta) < 1e-6) {
    const t2 = dTheta * dTheta
    a = 1 - t2 / 6
    b = dTheta / 2 - (dTheta * t2) / 24
  } else {
    a = Math.sin(dTheta) / dTheta
    b = (1 - Math.cos(dTheta)) / dTheta
  }
  const det = a * a + b * b
  return { dx: (a * tx + b * ty) / det, dy: (-b * tx + a * ty) / det, dTheta }
}

// 2D 강체 변환(평행 이동 + 회전) 합성·역(OTOS 틀 계산)
export function compose(p: Pose2, q: Pose2): Pose2 {
  const cos = Math.cos(p.yaw)
  const sin = Math.sin(p.yaw)
  return { x: p.x + cos * q.x - sin * q.y, y: p.y + sin * q.x + cos * q.y, yaw: p.yaw + q.yaw }
}

export function inverse(p: Pose2): Pose2 {
  const cos = Math.cos(p.yaw)
  const sin = Math.sin(p.yaw)
  return { x: -(cos * p.x + sin * p.y), y: sin * p.x - cos * p.y, yaw: -p.yaw }
}

// (−π, π]로 감는다
export function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI
  let r = angle % turn
  if (r > Math.PI) r -= turn
  else if (r <= -Math.PI) r += turn
  return r
}
