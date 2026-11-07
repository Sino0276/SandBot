import type { ContactRow, ContactSet } from './articulation'
import { tractionDirection } from './drivetrain'
import {
  mecanumRollerFriction,
  ROLLER_COULOMB,
  ROLLER_VISCOUS,
  ROLLING_RESISTANCE,
  rollerResistanceScale,
  SUPPORT_NOTICE_DELAY,
  WALL_FRICTION,
  WHEEL_BEARING_FRICTION
} from './wheelData'
import { distributeWheelLoads, type WheelLoads } from './wheelLoads'
import type { MecanumRollers, Pose2, SimWheelSpec, Vec2, WheelKind } from './worldSpec'

// 구동계 동역학(3c)의 접촉: 바퀴–타일 마찰 행, 필드 벽 행, 바퀴 법선 하중과 받침 알림(순수·결정적, 배열 순서만 쓴다).
// world.ts가 하위 단계마다 부르고, 행은 Articulation(부유 기저)의 상자 LCP에 들어간다(spec-3c §1.3–1.5).
//
// 좌표: z의 앞 셋은 기저(필드 축 vx·vy, 요 속도 ω)이고, 바퀴는 자기 좌표 k(구동 모터의 출력축 각 φ, 인스펙터 "앞" 부호, 또는
// 구동하지 않는 바퀴의 각 ψ)를 갖는다. 바퀴 i의 접점 p(로봇 좌표, 바닥), 굴림 u, 방향 d(로봇 좌표)의 미끄럼 속도는
//   g_d = d_f·(v + ω ẑ × R·p) − (d·u)·(r/G)·φ̇_k,  d_f = R(요)·d
// 이고, 행 J_d = [d_f.x, d_f.y, d·(ẑ × p) | … | −(d·u)·r/G (k)]다(로봇 좌표에서 d·(ẑ × p)는 요와 관계없다, method §4).
//
// 바퀴 종류별 행(정확한 쿨롱 마찰: 법선 하중을 먼저 정하고 그 하중으로 상자를 정한다, 미끄럼 곡선·정칙화 마찰 없음):
//   - 메카넘: 견인은 롤러 축 a(tractionDirection)에 상자 ±h·μ_r·N(μ_r = √2·μ − c_r, 잠근 바퀴의 겉보기 μ에서), 롤러 자유 방향
//     f = ẑ × a는 롤러 저항: 점성 행 감쇠(힘 −k·ROLLER_VISCOUS·N·g_f)와 쿨롱 상자 ±h·k·ROLLER_COULOMB·N(점성 하나로는 Pedro의
//     옆걸음 속도 비와 옆 관성 감속을 함께 맞추지 못한다, wheelData.ts). 직진에서는 g_f = 0이라 손실이 없다. k는
//     rollerResistanceScale(종류, μ)(기본 μ 이상 1, 아래는 μ에 비례: 낮은 μ에서 롤러 저항이 견인을 넘지 않게, 메카넘은 옆걸음이
//     거꾸로 가고 옴니는 축 방향 미끄럼이 멈췄다).
//   - 옴니: 견인 a = u, ±h·μ·N, 축 방향(ẑ × u)은 메카넘과 같은 롤러 저항(점성 + 쿨롱 상자). 맞춤은 메카넘 로봇으로 했고,
//     옴니 롤러도 같은 고무 롤러 구름이라 같은 값을 쓴다(가정).
//   - 일반 바퀴: 마찰 원을 고정 팔각형으로: u 기준 0°·45°·90°·135° 행 넷, 상자마다 ±h·μ·N / (2(cos 22.5° + sin 22.5°))
//     (민코프스키 합이 원에 내접하는 팔각형, 반지름 오차 최대 7.6 %, 늘 안쪽). 반복 없이 결정적이다.
//   - 모든 바퀴: 굴림 저항은 바퀴 좌표의 쿨롱 상자 ±ROLLING_RESISTANCE·N·r/G(world.ts가 구동 상자에 더한다: 성분 하나인 행이라
//     정지한 바퀴의 엔코더가 깜빡이지 않는다), 구동하지 않는 바퀴는 베어링 마찰 WHEEL_BEARING_FRICTION을 더한다.
// 법선 하중 N_i는 Articulation.baseWrench(걸러진 가속)를 wheelLoads.ts로 나눈 값이다(하중이 0이면 행을 넣지 않는다).

// 팔각형 행 상자의 분모 2(cos 22.5° + sin 22.5°) = 2.6131: 네 방향 상자 b의 합(지지 함수)이 22.5°에서 2.6131·b로 가장 크다
const OCTAGON_DIVISOR = 2 * (Math.cos(Math.PI / 8) + Math.sin(Math.PI / 8))
// 행 방향은 u 기준 0°·45°·90°·135°다. 굴림·옆 방향 견인은 원의 cos 22.5° = 0.924배(원 안 7.6 %, 가정 μ의 불확실성보다 작다)
const OCTAGON_ANGLES = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]

// 벽 행을 넣는 근방: 간격 ≤ |접근 속도|·h + WALL_MARGIN(m). 가정: 3b 관절 한계 근방(LIMIT_MARGIN 1 mm)과 같은 크기
export const WALL_MARGIN = 1e-3
// 받쳐지지 않은 모멘트가 F_z × 이 길이(m)를 넘으면 넘어짐으로 센다. 가정: ZMP가 바퀴 껍질 밖으로 1 mm(반올림 잡음보다 훨씬 크고
// 넘어짐을 놓치지 않을 만큼 작다, spec-3c §1.4)
const TIPPING_ARM = 1e-3

// 벽 순서(+x, −x, +y, −y)와 바깥 법선 축·부호
const WALLS: readonly { name: string; axis: 0 | 1; sign: 1 | -1 }[] = [
  { name: 'x+', axis: 0, sign: 1 },
  { name: 'x-', axis: 0, sign: -1 },
  { name: 'y+', axis: 1, sign: 1 },
  { name: 'y-', axis: 1, sign: -1 }
]

// 바퀴 하나의 접촉 상수
export type WheelContact = {
  spec: SimWheelSpec
  // 바퀴 좌표(Articulation z 순번)
  coordinate: number
  // 바퀴 좌표 1 rad당 바퀴 면 이동(m): 구동 바퀴는 r / 외부 감속비, 구동하지 않는 바퀴는 r
  rollPerRad: number
  driven: boolean
  // 견인 방향(로봇 좌표)과 그 행의 마찰 계수(메카넘은 롤러 축 μ_r)
  traction: Vec2
  tractionFriction: number
  // 롤러 자유 방향 저항(점성·쿨롱)의 배율(메카넘·옴니 rollerResistanceScale, 일반 바퀴는 쓰지 않음)
  rollerScale: number
}

// rollerCoulomb: 롤러 자유 방향 쿨롱 계수. 잠근 메카넘 바퀴를 끌면 접점이 롤러 축 a와 자유 방향 f로 같은 크기(cos 45°)만큼
// 미끄러지므로 앞·옆으로 끄는 힘은 (μ_r + k·c_r)·N·cos 45°다(k = rollerResistanceScale). 그래서 견인 계수를 μ_r = √2·μ − k·c_r로
// 두어 잠근 바퀴의 겉보기 계수가 바퀴 설정 μ 그대로이게 한다(spec-3c §1.3 "입력 μ는 잠근 바퀴의 겉보기 계수", 롤러 쿨롱은
// 맞춤이 더한 항이다). 옴니의 자유
// 방향은 굴림 방향과 수직이라 굴림 방향 견인에 더해지지 않는다.
export function wheelContact(
  spec: SimWheelSpec,
  coordinate: number,
  driven: boolean,
  rollerCoulomb = ROLLER_COULOMB
): WheelContact {
  return {
    spec,
    coordinate,
    rollPerRad: driven ? spec.radius / spec.gearRatio : spec.radius,
    driven,
    traction: tractionDirection(spec),
    tractionFriction:
      spec.kind === 'mecanum' ? mecanumRollerFriction(spec.friction, rollerCoulomb) : spec.friction,
    rollerScale: spec.kind === 'traction' ? 1 : rollerResistanceScale(spec.kind, spec.friction)
  }
}

// 방향 d(로봇 좌표)의 미끄럼 행(z 길이 m)
function slipRow(wheel: WheelContact, d: Vec2, yaw: number, m: number): number[] {
  const j = new Array<number>(m).fill(0)
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const p = wheel.spec.position
  j[0] = c * d.x - s * d.y
  j[1] = s * d.x + c * d.y
  j[2] = -d.x * p.y + d.y * p.x
  const u = { x: Math.cos(wheel.spec.angle), y: Math.sin(wheel.spec.angle) }
  j[wheel.coordinate] -= (d.x * u.x + d.y * u.y) * wheel.rollPerRad
  return j
}

// ẑ × d(반시계 90°). 구조물 접촉(fieldContact.ts)도 같은 것을 쓴다
export const perpendicular = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x })

// 롤러 자유 방향 저항(하중 1 N당): 점성(s/m)과 쿨롱 계수
export type RollerResistance = { viscous: number; coulomb: number }
export const ROLLER_RESISTANCE: RollerResistance = {
  viscous: ROLLER_VISCOUS,
  coulomb: ROLLER_COULOMB
}

// 바퀴마다 견인 행과 롤러 저항(하중 loads, 하위 단계 h)
export function wheelRows(
  wheels: readonly WheelContact[],
  loads: readonly number[],
  yaw: number,
  h: number,
  m: number,
  roller: RollerResistance = ROLLER_RESISTANCE
): ContactSet {
  const rows: ContactRow[] = []
  const damping: { j: number[]; c: number }[] = []
  wheels.forEach((wheel, i) => {
    const n = loads[i]
    if (!(n > 0)) return
    const kind = wheel.spec.kind
    if (kind === 'traction') {
      const bound = (h * wheel.tractionFriction * n) / OCTAGON_DIVISOR
      if (!(bound > 0)) return
      OCTAGON_ANGLES.forEach((angle, k) => {
        const a = wheel.spec.angle + angle
        rows.push({
          key: `w${i}o${k}`,
          j: slipRow(wheel, { x: Math.cos(a), y: Math.sin(a) }, yaw, m),
          target: 0,
          lo: -bound,
          hi: bound
        })
      })
      return
    }
    const bound = h * wheel.tractionFriction * n
    if (bound > 0)
      rows.push({
        key: `w${i}a`,
        j: slipRow(wheel, wheel.traction, yaw, m),
        target: 0,
        lo: -bound,
        hi: bound
      })
    const free = slipRow(wheel, perpendicular(wheel.traction), yaw, m)
    const viscous = wheel.rollerScale * roller.viscous
    if (viscous > 0) damping.push({ j: free, c: viscous * n })
    const coulomb = h * wheel.rollerScale * roller.coulomb * n
    if (coulomb > 0) rows.push({ key: `w${i}f`, j: free, target: 0, lo: -coulomb, hi: coulomb })
  })
  return { rows, damping }
}

// 바퀴 하나가 로봇 +X(앞)로 미는 견인 한계(하중 1 N당 N, 인스펙터 로봇 카드의 견인 한계 가속이 Σ 이 값 × 하중으로 쓴다).
// wheelRows의 행 그대로다: 행 d(로봇 좌표)마다 상자 계수 b(메카넘 롤러 축 μ_r·자유 방향 k·c_r, 옴니 굴림 μ·축 k·c_r, 일반 바퀴
// 팔각형 넷 μ / 2.6131). 바퀴가 헛돌며 미는 동안(바퀴 면 속도 ≫ 차대 속도) 굴림과 묶인 행(d·u ≠ 0)은 미끄럼 방향이 바퀴
// 회전으로 정해져 힘이 s·sign(d·u)·b·d이고(s = 회전 방향, 앞으로 미는 쪽을 고른다), 굴림과 수직인 행(d·u = 0: 옴니 축 방향,
// 팔각형 90° 행)은 바퀴 회전이 미끄럼을 만들지 않아 차대가 앞으로 움직이면 b·|d_x|만큼 거스른다. 그래서
// 견인 = max(0, |Σ_묶인 sign(d·u)·b·d_x| − Σ_수직 b·|d_x|)다. 표준 메카넘(angle 0)은 (μ_r + k·c_r)·cos 45° = μ, 일반 바퀴
// angle 0은 팔각형 지지 cos 22.5°·μ, X 드라이브 옴니(±45°)는 (μ − k·c_r)·cos 45°, H 드라이브 옆 바퀴(90°)는 0이다(앞으로 밀지
// 못하는 바퀴는 0: 거스르는 끌림은 굴림 저항·구동하지 않는 바퀴처럼 이 추정에 넣지 않는다). 롤러 점성은 미끄럼 속도에 따라
// 달라 넣지 않는다(정지에서 미끄러지기 시작할 때의 값). friction은 겉보기 μ(effectiveWheelFriction으로 푼 값)다.
export function wheelForwardTraction(
  kind: WheelKind,
  angle: number,
  rollers: MecanumRollers | null,
  friction: number
): number {
  const u: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) }
  const rows: { d: Vec2; b: number }[] = []
  if (kind === 'traction') {
    for (const offset of OCTAGON_ANGLES)
      rows.push({
        d: { x: Math.cos(angle + offset), y: Math.sin(angle + offset) },
        b: friction / OCTAGON_DIVISOR
      })
  } else {
    const a = tractionDirection({ kind, angle, rollers })
    const mecanum = kind === 'mecanum'
    rows.push({ d: a, b: mecanum ? mecanumRollerFriction(friction) : friction })
    rows.push({
      d: perpendicular(a),
      b: rollerResistanceScale(kind, friction) * ROLLER_COULOMB
    })
  }
  let push = 0
  let drag = 0
  for (const { d, b } of rows) {
    const coupling = d.x * u.x + d.y * u.y
    // 팔각형 90° 행의 cos·sin 반올림(1e-16)을 수직으로 본다
    if (Math.abs(coupling) < 1e-9) drag += b * Math.abs(d.x)
    else push += Math.sign(coupling) * b * d.x
  }
  return Math.max(0, Math.abs(push) - drag)
}

// 바퀴 좌표의 쿨롱 상자(좌표 단위 힘, N·m): 굴림 저항 c_rr·N·r/G, 구동하지 않는 바퀴는 베어링 마찰을 더한다
export function wheelCoordinateFriction(
  wheel: WheelContact,
  load: number,
  rollingResistance = ROLLING_RESISTANCE
): number {
  const rolling = load > 0 ? rollingResistance * load * wheel.rollPerRad : 0
  return wheel.driven ? rolling : rolling + WHEEL_BEARING_FRICTION
}

// 벽 행: 외곽 꼭짓점 k와 벽 w(+x, −x, +y, −y)마다 간격 gap = innerHalf − s_w·P_k를 재고, 근방(간격 ≤ |접근 속도|·h +
// WALL_MARGIN)인 쌍만 넣는다. innerHalf는 시즌 외곽의 접촉 기준면 반폭(FieldSpec.perimeter.innerHalf, 'none'은 field.ts의
// WALL_INNER_HALF와 같은 double이라 3c와 바이트까지 같다). 법선 행은 한쪽(λ ≥ 0)이고 목표 J_n·v⁺ ≥ −max(gap, 0)/h라 이미
// 걸쳐 있으면 밀어내지 않는다(반발 0, 위치 자르기 없음). 접선 행은 상자 ±WALL_FRICTION·λ_n(Articulation이 고정 2회 엇갈림으로
// 푼다). 벽 힘은 바닥 높이에 작용한다고 본다(하중 이동 없음, 한계).
export function wallRows(
  footprint: readonly Vec2[],
  pose: Pose2,
  velocity: { vx: number; vy: number; omega: number },
  h: number,
  m: number,
  innerHalf: number
): ContactRow[] {
  const rows: ContactRow[] = []
  const c = Math.cos(pose.yaw)
  const s = Math.sin(pose.yaw)
  const offsets = footprint.map((p) => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y }))
  for (const wall of WALLS) {
    offsets.forEach((r, k) => {
      const position = wall.axis === 0 ? pose.x + r.x : pose.y + r.y
      const gap = innerHalf - wall.sign * position
      const speed =
        wall.axis === 0 ? velocity.vx - velocity.omega * r.y : velocity.vy + velocity.omega * r.x
      if (gap > Math.abs(speed) * h + WALL_MARGIN) return
      // 안쪽 법선 n = −s_w·e_축, 접선 t = ẑ × n
      const n: Vec2 = wall.axis === 0 ? { x: -wall.sign, y: 0 } : { x: 0, y: -wall.sign }
      const t = perpendicular(n)
      const row = (d: Vec2): number[] => {
        const j = new Array<number>(m).fill(0)
        j[0] = d.x
        j[1] = d.y
        j[2] = -d.x * r.y + d.y * r.x
        return j
      }
      const key = `${wall.name}${k}`
      rows.push({ key: `n${key}`, j: row(n), target: -Math.max(gap, 0) / h, lo: 0, hi: Infinity })
      rows.push({
        key: `t${key}`,
        j: row(t),
        target: 0,
        lo: 0,
        hi: 0,
        friction: { normal: `n${key}`, mu: WALL_FRICTION }
      })
    })
  }
  return rows
}

// 막는 법선 행인지(blocked 판정): 마찰 없는 한쪽 행(hi = ∞)은 벽 법선과 고정 구조물 법선(fieldContact.ts)뿐이다
export function isBlockingNormal(row: ContactRow): boolean {
  return row.friction === undefined && row.hi === Infinity
}

// 받침 알림: 바퀴가 활성 집합 밖(하중 0)인 상태(wheelLift)나 받쳐지지 않은 모멘트가 F_z·TIPPING_ARM을 넘는 상태(tipping)가
// SUPPORT_NOTICE_DELAY 이어지면 참을 돌려준다(실행마다 한 번 알리는 것은 world.ts의 notify가 맡는다).
export class SupportMonitor {
  private liftTime = 0
  private tipTime = 0

  update(result: WheelLoads, fz: number, h: number): { wheelLift: boolean; tipping: boolean } {
    // 활성 집합 밖(하중 0)인 바퀴: 껍질 대체 경로·반올림이 남기는 잡음(F_z의 1e-9배 아래)도 0으로 본다
    const lifted = fz > 0 && result.loads.some((n) => n <= fz * 1e-9)
    const tipping = fz > 0 && result.unsupported > fz * TIPPING_ARM
    this.liftTime = lifted ? this.liftTime + h : 0
    this.tipTime = tipping ? this.tipTime + h : 0
    // 반올림(0.1 s를 1 ms 하위 단계로 더하면 0.09999…)을 넘지 않게 하위 단계의 절반 여유를 둔다
    return {
      wheelLift: this.liftTime >= SUPPORT_NOTICE_DELAY - h / 2,
      tipping: this.tipTime >= SUPPORT_NOTICE_DELAY - h / 2
    }
  }
}

// 바퀴 접점(로봇 좌표)으로 하중을 나눈다
export function wheelLoads(
  wheels: readonly WheelContact[],
  wrench: { fz: number; mx: number; my: number }
): WheelLoads {
  return distributeWheelLoads(
    wheels.map((w) => w.spec.position),
    wrench.fz,
    wrench.mx,
    wrench.my
  )
}
