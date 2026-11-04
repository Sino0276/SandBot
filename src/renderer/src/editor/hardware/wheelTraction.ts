import { mecanumRollerFriction, ROLLER_COULOMB } from '../../../../shared/sim/wheelData'
import type { MecanumRollers, WheelKind } from '../../../../shared/sim/worldSpec'

// contact.ts와 같은 팔각형(마찰 원에 내접): 분모 2(cos 22.5° + sin 22.5°) = 2.6131, 행 각 0°·45°·90°·135°
const OCTAGON_DIVISOR = 2 * (Math.cos(Math.PI / 8) + Math.sin(Math.PI / 8))
const OCTAGON_ANGLES = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]

// 바퀴 하나가 로봇 앞(+X)으로 받을 수 있는 견인 힘(하중 1 N당, 로봇 카드 구동계 요약의 견인 한계 가속). 시뮬레이터의 접촉
// 행(src/shared/sim/contact.ts wheelRows)이 그 바퀴에 허락하는 힘 집합(행마다 상자의 민코프스키 합)의 +X 지지 함수다.
// 렌더러 임시 사본이다: 시뮬레이터 갈래가 같은 이름·서명의 함수를 src/shared/sim/contact.ts에 더하면 통합할 때 그것으로
// 바꾼다(값이 같아야 한다).
//   - 메카넘: 롤러 축 a = R(∓45°)·u(flbr −45°, frbl +45°, drivetrain.ts tractionDirection)의 상자 ±μ_r(μ_r = √2·μ − c_r,
//     wheelData.ts mecanumRollerFriction)와 자유 방향 f = ẑ × a의 롤러 쿨롱 상자 ±c_r → μ_r·|a_x| + c_r·|f_x|.
//     표준 배치(굴림 0°)면 (μ_r + c_r)·cos 45° = μ(잠근 바퀴의 겉보기 계수 그대로)다.
//   - 옴니: 굴림 u의 상자 ±μ와 축 방향 ẑ × u의 롤러 쿨롱 상자 ±c_r → μ·|u_x| + c_r·|(ẑ × u)_x|.
//   - 일반 바퀴: u 기준 0°·45°·90°·135° 행 넷, 상자마다 ±μ / (2(cos 22.5° + sin 22.5°)) → Σ 상자·|cos(굴림 + 행 각)|
//     (굴림 0°면 0.924·μ).
// rollers는 메카넘만 본다(null이면 flbr, 시뮬레이터와 같다).
export function wheelForwardTraction(
  kind: WheelKind,
  angle: number,
  rollers: MecanumRollers | null,
  friction: number
): number {
  const u = { x: Math.cos(angle), y: Math.sin(angle) }
  switch (kind) {
    case 'mecanum': {
      const a = angle + (rollers === 'frbl' ? Math.PI / 4 : -Math.PI / 4)
      // f = ẑ × a = (−a_y, a_x)
      return (
        mecanumRollerFriction(friction) * Math.abs(Math.cos(a)) +
        ROLLER_COULOMB * Math.abs(Math.sin(a))
      )
    }
    case 'omni':
      // 축 방향 ẑ × u = (−u_y, u_x)
      return friction * Math.abs(u.x) + ROLLER_COULOMB * Math.abs(u.y)
    case 'traction': {
      const bound = friction / OCTAGON_DIVISOR
      return OCTAGON_ANGLES.reduce((sum, row) => sum + bound * Math.abs(Math.cos(angle + row)), 0)
    }
  }
}
