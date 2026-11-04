import { tractionDirection } from '../../../../shared/sim/drivetrain'
import { mecanumRollerFriction, ROLLER_COULOMB } from '../../../../shared/sim/wheelData'
import type { MecanumRollers, WheelKind } from '../../../../shared/sim/worldSpec'

// contact.ts와 같은 팔각형(마찰 원에 내접): 분모 2(cos 22.5° + sin 22.5°) = 2.6131, 행 각 0°·45°·90°·135°
const OCTAGON_DIVISOR = 2 * (Math.cos(Math.PI / 8) + Math.sin(Math.PI / 8))
const OCTAGON_ANGLES = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]

// 바퀴 하나가 로봇 앞(+X)으로 미는 견인 한계(하중 1 N당, 로봇 카드 구동계 요약의 견인 한계 가속이 Σ 이 값 × 하중으로 쓴다).
// 렌더러 임시 사본이다: 시뮬레이터 갈래가 같은 이름·서명의 함수를 src/shared/sim/contact.ts에 더하므로 통합할 때 그것으로
// 바꾼다(같은 규칙이라 값이 같아야 한다).
// 시뮬레이터의 접촉 행(contact.ts wheelRows) 그대로다: 행 d(로봇 좌표)마다 상자 계수 b(메카넘 롤러 축 μ_r = √2·μ − c_r
// (wheelData.ts mecanumRollerFriction)·자유 방향 c_r, 옴니 굴림 μ·축 c_r, 일반 바퀴 팔각형 넷 μ / 2.6131). 바퀴가 헛돌며 미는
// 동안(바퀴 면 속도 ≫ 차대 속도) 굴림과 묶인 행(d·u ≠ 0)은 미끄럼 방향을 바퀴 회전이 정해 힘이 s·sign(d·u)·b·d이고(s = 회전
// 방향, 앞으로 미는 쪽을 고른다), 굴림과 수직인 행(d·u = 0: 옴니 축 방향, 팔각형 90° 행)은 바퀴 회전이 미끄럼을 만들지 않아
// 차대가 앞으로 움직이면 b·|d_x|만큼 거스른다. 그래서 견인 = max(0, |Σ_묶인 sign(d·u)·b·d_x| − Σ_수직 b·|d_x|)다.
//   - 표준 메카넘(굴림 0°): 자유 방향도 굴림과 45°라 롤러 쿨롱이 민다 → (μ_r + c_r)·cos 45° = μ(잠근 바퀴의 겉보기 계수).
//   - X 드라이브 옴니(±45°): 축 방향 롤러 쿨롱은 거스른다 → (μ − c_r)·cos 45°(리뷰 탐침의 시뮬레이터 값 약 0.64·μ와 같다).
//   - H 드라이브 옆 바퀴(옴니·일반 바퀴 90°): 앞으로 밀지 못해 0. 거스르는 끌림(−c_r 등)은 굴림 저항·구동하지 않는 바퀴처럼
//     이 추정에 넣지 않는다(0에서 자른다).
//   - 일반 바퀴 굴림 0°: 팔각형의 굴림 방향 지지 cos 22.5°·μ = 0.924·μ.
// 롤러 점성은 미끄럼 속도에 따라 달라 넣지 않는다(정지에서 미끄러지기 시작할 때의 값). rollers는 메카넘만 보고 null이면
// flbr(시뮬레이터 tractionDirection과 같다). friction은 겉보기 μ(effectiveWheelFriction으로 푼 값)다.
export function wheelForwardTraction(
  kind: WheelKind,
  angle: number,
  rollers: MecanumRollers | null,
  friction: number
): number {
  const u = { x: Math.cos(angle), y: Math.sin(angle) }
  const rows: { d: { x: number; y: number }; b: number }[] = []
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
    // 자유 방향(메카넘) 또는 축 방향(옴니) ẑ × a의 롤러 쿨롱 상자
    rows.push({ d: { x: -a.y, y: a.x }, b: ROLLER_COULOMB })
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
