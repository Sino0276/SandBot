import type { WheelKind } from './worldSpec'

// 구동계 동역학(3c)의 바퀴·타일·벽 물리 값(순수, 렌더러 세계 설명·인스펙터와 시뮬레이터가 같이 쓴다). 근거는 3c 조사
// scratchpad/p12drive/research/{data,method,critique}.md(명세 spec-3c §1.3–1.6)이고, 측정이 없는 값은 가정이다
// (FTC 타일 마찰을 공개한 제조사 값은 AndyMark SD 메카넘 하나뿐이다).

// 잠근 바퀴를 FTC 타일에서 끌 때의 겉보기 마찰 계수(정지 = 운동, 로봇이 미끄러지며 내는 가속 ≈ μ·g). 가정:
// - 메카넘 0.6: AndyMark 4" SD 메카넘 "Forward / Reverse Coefficient of Friction: 0.51 on FTC Soft-tile", "Sideways CoF:
//   0.67"(https://www.andymark.com/am-2626)의 사이. goBILDA GripForce(40A)는 숫자를 공개하지 않는다.
// - 옴니 0.8, 일반(트랙션) 0.9: 타일 값 출처 없음. VEX 폼 타일 당김 시험 0.84, AndyMark Wedgetop 트레드 후기 1.1 사이
//   (data §2.3).
export const DEFAULT_WHEEL_FRICTION: Record<WheelKind, number> = {
  mecanum: 0.6,
  omni: 0.8,
  traction: 0.9
}

// 바퀴 설정 friction(scene/wheel.ts)의 겉보기 μ: 0이면 종류 기본값
export function effectiveWheelFriction(kind: WheelKind, setting: number): number {
  return setting > 0 ? setting : DEFAULT_WHEEL_FRICTION[kind]
}

// 메카넘 견인 행(땅에 닿은 롤러의 축 방향)의 마찰 계수. 자유 롤러는 축 방향으로만 힘을 전하므로 잠근 바퀴를 앞이나 옆으로
// 끌 때 바퀴 하나가 받는 힘은 μ_r·N·cos 45°다(method §4.1, Ether 해석). 그래서 겉보기 μ에서 μ_r = √2·μ다.
export function mecanumRollerFriction(apparent: number): number {
  return Math.SQRT2 * apparent
}

// 롤러 자유 방향(메카넘 ẑ × 롤러 축, 옴니 축 방향)의 점성 저항: 힘 = −ROLLER_VISCOUS · N · 미끄럼 속도(s/m, 하중 1 N당).
// 가정(시작값): Pedro Pathing 2.1.2 기본값(옆/앞 속도 비 0.804, 옆 FLOAT 감속 1.985 m/s²)을 13.7:1·104 mm·10.65 kg 로봇으로
// 맞춘 값(비평 §2.5: 0.068–0.124). 쿨롱 하나로는 두 목표를 함께 맞추지 못한다. 시뮬레이터 구현 뒤 다시 맞춘다(spec-3c §1.3).
export const ROLLER_VISCOUS = 0.08

// 굴림 저항 계수(바퀴 좌표의 쿨롱 상자 c_rr·N·r/G). 폼 타일·바퀴 고무 변형과 데드휠 포드 끌림이 섞인 값이다.
// 가정(시작값): Pedro 2.1.2 forwardZeroPowerAcceleration −34.63 in/s²(0.880 m/s², FLOAT)에 3b 모터 역구동 손실과 회전
// 관성을 넣어 맞춘 값(비평 §2.4: 0.068–0.073, 둘째 비평 §2.1: 0.08). Matsinos 자유 굴림 0.084(https://arxiv.org/pdf/1211.2323)와
// 같은 크기다. 시뮬레이터 구현 뒤 다시 맞춘다.
export const ROLLING_RESISTANCE = 0.07

// 로봇 ↔ 필드 벽 운동 마찰 계수. 가정: 벽은 알루미늄 틀 + 3 mm 폴리카보네이트(AndyMark am-0481), 알루미늄–알루미늄 운동
// 0.4(Engineering Toolbox), 폴리카보네이트–강철 0.50–0.55의 가운데 쪽(data §7).
export const WALL_FRICTION = 0.4

// 바퀴 축 회전 관성 J = 계수 · m · R². goBILDA GripForce 104 mm(236 g)·96 mm 메카넘(207 g) STEP을 재질 밀도로 적분하면
// 회전 반지름이 R의 0.72–0.73배라 0.72² ≈ 0.53이다(data §5.1, 3.34e-4·2.55e-4 kg·m²).
export const WHEEL_SPIN_INERTIA_FACTOR = 0.53

// 질량 모델이 바퀴 질량을 모를 때의 바퀴 하나 질량(kg): goBILDA GripForce 104 mm 메카넘 236 g, 96 mm 옴니 119 g,
// 96 mm Hogback 트랙션 82 g(제조사 상품 페이지, data §2.2–2.3)
export const DEFAULT_WHEEL_MASS: Record<WheelKind, number> = {
  mecanum: 0.236,
  omni: 0.119,
  traction: 0.082
}

// 바퀴 질량으로 쓸 범위(kg): 질량 모델의 바퀴 하위가 구조물을 품었을 때 회전 관성이 터무니없이 커지지 않게
export const MIN_WHEEL_MASS = 0.01
export const MAX_WHEEL_MASS = 2

// 바퀴 회전 관성(kg·m²). mass가 유한한 양수가 아니면 종류 기본 질량을 쓰고, 범위로 자른다.
export function wheelSpinInertia(kind: WheelKind, radius: number, mass: number | null): number {
  const m =
    mass !== null && Number.isFinite(mass) && mass > 0
      ? Math.min(MAX_WHEEL_MASS, Math.max(MIN_WHEEL_MASS, mass))
      : DEFAULT_WHEEL_MASS[kind]
  return WHEEL_SPIN_INERTIA_FACTOR * m * radius * radius
}

// 구동하지 않는 바퀴 좌표의 베어링 쿨롱 마찰(N·m). 가정: 볼 베어링 바퀴 축(굴림 저항이 주된 손실이다).
export const WHEEL_BEARING_FRICTION = 0.002

// 법선 하중 계산에 쓰는 가속의 1차 저역 통과 시간 상수(s). 가정: 폼 타일·차대 피치 순응(Unity WheelCollider 서스펜션
// 스프링·댐퍼의 역할). 벽 충돌·관절 한계 충격이 한 하위 단계 동안 수천 N의 하중 이동을 만들지 않게 한다(비평 §2.8).
export const LOAD_FILTER_TAU = 0.02

// 바퀴 뜸·넘어짐 알림을 내기 전에 그 상태가 이어져야 하는 시간(s). 가정: 급정거 한 번마다 알리지 않게.
export const SUPPORT_NOTICE_DELAY = 0.1
