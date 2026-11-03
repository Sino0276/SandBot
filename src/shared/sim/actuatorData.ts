import { MOTOR_TYPES, UNSPECIFIED_MOTOR_TAG } from './motorTypes'
import type { SimMotorParams, SimServoParams } from './worldSpec'

// 관절 구동기(기어모터·서보)의 물리 값 표(3b). 렌더러가 세계 설명을 만들 때 모터 컴포넌트의 형식(구성 태그)·기어박스와
// 서보 컴포넌트의 servoModel로 SimMotorParams·SimServoParams를 풀어 넣는다. SDK 값이 아니라 제조사 데이터시트 값이고
// 생성 코드와 관계없다. 순수 TS(결정적).
//
// 근거는 3b 조사(scratchpad p10mass/research/actuators.md = [ACT], p11joint/research/data.md = [DATA])다.
// - 기어모터 출력의 정지 토크·무부하 속도는 제조사 표 값이다(감속비별, spec-3b 결정 1). 정지·무부하 전류도 제조사 값이다.
//   정지 토크는 기어 손실을 포함한 출력축 값이다. 제조사가 맨 모터 × 감속비(효율 1의 이론값)로 공개하는 계열(REV HD Hex·
//   UltraPlanetary, NeveRest)은 그 값에 기어 효율을 곱한다([ACT] §2.2).
//   gm0 다이노 값(https://gm0.org/en/latest/_sources/docs/power-and-electronics/motor-guide/motor-power.rst.txt,
//   goBILDA 0.19 N·m·11 A, HD Hex 0.18 N·m·11 A, NeveRest 0.17 N·m·9.8 A)은 쓰지 않는다(데이터시트보다 1.3–2.7배 크다).
// - 단위 환산: 1 kg·cm = 0.0980665 N·m, 1 oz-in = 0.00706155 N·m, 1 rpm = 2π/60 rad/s.

const KGCM = 0.0980665
const OZIN = 0.00706155
const RPM = (2 * Math.PI) / 60
const DEG = Math.PI / 180

// ---- 기어모터 ----

// RS-555급 맨 모터(goBILDA·REV HD Hex·NeveRest·TorqueNADO 공통)의 회전자 관성(kg·m²). 제조사가 공개하지 않아 같은 급
// 철심 모터(Pittman 8224S006 1.62e-6, 9234S006 4.17e-6)의 지름 축척과 기하 추정의 가운데로 정한 가정이다(범위 2–5e-6,
// [DATA] §1.3).
const RS555_ROTOR_INERTIA = 3.0e-6
// Core Hex 맨 모터 회전자 관성(가정: 크기를 380급 Ø24 × 30 mm로 보고 Pittman 축척, 범위 2e-7–1e-6, [DATA] §1.4)
const CORE_HEX_ROTOR_INERTIA = 5e-7
// 모터축 역구동(정지) 마찰(N·m). NeveRest Classic 40·60의 출력축 역구동 토크(0.067 ft-lb = 0.0908 N·m, 0.1 ft-lb =
// 0.1356 N·m, https://www.andymark.com/products/neverest-classic-40-gearmotor , …-60-gearmotor)를 감속비로 나누면
// 2.27·2.26 mN·m로 거의 같아 모터 쪽 쿨롱 마찰로 본다([DATA] §3.2, critique §1.3). goBILDA·REV도 같은 RS-555라 같이 쓴다
// (가정). 회전 중 손실(무부하 전류)은 시뮬레이터가 이 값과 무부하 전류에서 점성 항으로 더한다.
const RS555_BACKDRIVE_FRICTION = 2.3e-3
// Core Hex 모터축 역구동 마찰(가정: 모터축 정지 토크 3.2/72 = 0.044 N·m가 goBILDA 맨 모터 0.144 N·m의 0.31배라 그
// 비율로 줄인 값)
const CORE_HEX_BACKDRIVE_FRICTION = 0.7e-3
// 기어 효율(spec-3b 결정 2): 유성 단당 0.95(gm0 gearbox-anatomy "two stage planetary gearboxes are 94% efficient"와
// goBILDA 표에서 파생한 2단 ≈0.90의 가운데, [DATA] §3.1), 평기어 박스 0.85(gm0 "two-stage spur gearbox is about 85%"),
// Core Hex 0.7(가정: 90° 단의 기어 형식이 공개되지 않음)
const PLANETARY_STAGE_EFFICIENCY = 0.95
const SPUR_EFFICIENCY = 0.85
const CORE_HEX_EFFICIENCY = 0.7
// 표의 감속비로 볼 허용 오차(로그 거리, ±1.5 %): goBILDA의 반올림한 감속비(5.2 대 5.1818, 188 대 188.61)를 받는다
const RATIO_TOLERANCE = Math.log(1.015)

type GearmotorRow = {
  // 실제 감속비
  ratio: number
  // 팀이 흔히 쓰는 이름의 감속비(UltraPlanetary 카트리지 20:1 = 실제 18.93:1), 없으면 ratio
  nominal: number
  // N·m, 12 V 출력축 정지 토크(제조사)
  stallTorque: number
  // rpm, 12 V 출력축 무부하 속도(제조사)
  freeRpm: number
  // 유성 기어 단 수(평기어·Core Hex 계열은 쓰지 않음)
  stages: number
}

type MotorFamily = {
  rows: readonly GearmotorRow[]
  // 모터 gearbox 속성이 0(모델 기본)일 때의 실제 감속비. SDK gearing이 실제와 다른 형식(Core Hex 36.25 대 72, UltraPlanetary
  // 20 대 18.93)은 실제 값이다.
  defaultRatio: number
  // 모터축 1회전의 엔코더 카운트(쿼드러처, 제조사 값). SDK 형식의 ticksPerRev ÷ gearing은 쓰지 않는다: 그 비가 모터축 값과
  // 같은 형식(goBILDA 2786 ÷ 99.5 = 28, HD Hex·UltraPlanetary·NeveRest 560 ÷ 20 = 28)도 있지만, SDK gearing이 실제 감속비가
  // 아니거나(goBILDA 5201 1500 ÷ 54 = 27.78, Core Hex 288 ÷ 36.25 = 7.9) 옛 모터 값인(TETRIX 1440 ÷ 52, NeveRest 3.7 44.4 ÷
  // 3.7 = 12) 형식이 있어서다.
  encoderCountsPerMotorRev: number
  // A, 12 V
  stallCurrent: number
  freeCurrent: number
  rotorInertia: number
  backdriveFriction: number
  // 고정 효율(평기어·Core Hex). 없으면 유성 단당 효율
  efficiency?: number
  // 유성 한 단의 가장 큰 감속비(표에 없는 감속비의 단 수를 셀 때)
  maxStageRatio: number
}

const row = (
  ratio: number,
  stallTorque: number,
  freeRpm: number,
  stages: number,
  nominal = ratio
): GearmotorRow => ({ ratio, nominal, stallTorque, freeRpm, stages })

// goBILDA Yellow Jacket 5202/5203/5204(구성 태그 하나). 감속비는 goBILDA 식(1+46/17, 1+46/11의 곱), 토크·속도는 5203 상품
// 페이지 Specs 표([ACT] §2.1, 예: https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-19-2-1-ratio-24mm-length-8mm-rex-shaft-312-rpm-3-3-5v-encoder/ ).
// 12 V 정지 9.2 A, 무부하 0.25 A(모든 감속비 공통).
const S17 = 1 + 46 / 17
const S11 = 1 + 46 / 11
const GOBILDA: MotorFamily = {
  rows: [
    row(1, 1.47 * KGCM, 6000, 0),
    row(S17, 5.4 * KGCM, 1620, 1),
    row(S11, 7.9 * KGCM, 1150, 1),
    row(S17 * S17, 18.7 * KGCM, 435, 2),
    row(S17 * S11, 24.3 * KGCM, 312, 2),
    row(S11 * S11, 38.0 * KGCM, 223, 2),
    row(S17 ** 3, 68.4 * KGCM, 117, 3),
    row(S17 * S17 * S11, 93.6 * KGCM, 84, 3),
    row(S17 * S11 * S11, 133.2 * KGCM, 60, 3),
    row(S11 ** 3, 185 * KGCM, 43, 3),
    row(S17 ** 4, 250 * KGCM, 30, 4)
  ],
  // SDK goBILDA5202Series gearing 99.5
  defaultRatio: S17 * S11 * S11,
  // 엔코더 28 카운트(모터축, goBILDA 5203 Specs "Encoder Countable Events Per Revolution (Encoder Shaft)", [ACT] §2.1)
  encoderCountsPerMotorRev: 28,
  stallCurrent: 9.2,
  freeCurrent: 0.25,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  maxStageRatio: S11
}

// REV UltraPlanetary + HD Hex 맨 모터(REV-41-1291: 12 V, 6000 rpm, 0.105 N·m, 정지 8.5 A, 무부하 0.4 A,
// https://docs.revrobotics.com/duo-build/motion/motors/hd-hex-motor ). 카트리지 실제 감속비는 3:1 = 84/29, 4:1 = 76/21,
// 5:1 = 68/13(https://docs.revrobotics.com/rev-crossover-products/ultraplanetary/cartridge-details.md). REV는 토크를
// 맨 모터 × 감속비(효율 1의 이론값)로 공개하므로 같은 식으로 만든다(견본 표 5.23:1 0.55 N·m·1147 rpm, 18.9:1 1.98 N·m·
// 317 rpm, 54.8:1 5.75 N·m·109.5 rpm과 맞는다, [ACT] §2.2). 출력 정지 토크는 기어 손실을 포함한 값이라야 하므로(SimMotorParams,
// 시뮬레이터가 τ_stall/(G·η)로 모터 상수를 되돌린다) 이 이론값에 기어 효율을 곱한다([ACT] §2.2 "REV 기어박스에 η를 따로
// 곱해야 실제에 가깝다"). 그래야 맨 모터 토크가 REV-41-1291의 0.105 N·m로 돌아온다. 무부하 속도는 이론값 그대로다
// (무부하 손실은 무부하 전류가 나타낸다).
const HD_HEX_STALL = 0.105
const HD_HEX_FREE_RPM = 6000
const UP_CARTRIDGES = [
  { nominal: 3, ratio: 84 / 29 },
  { nominal: 4, ratio: 76 / 21 },
  { nominal: 5, ratio: 68 / 13 }
] as const
const UP_MAX_CARTRIDGES = 3

function ultraPlanetaryRows(): GearmotorRow[] {
  const rows: GearmotorRow[] = [row(1, HD_HEX_STALL, HD_HEX_FREE_RPM, 0)]
  // 카트리지 조합(같은 것을 여러 번 쓸 수 있고 순서는 관계없다: 작은 것부터 고른 중복 조합)
  const visit = (start: number, ratio: number, nominal: number, count: number): void => {
    if (count > 0)
      rows.push(
        row(
          ratio,
          HD_HEX_STALL * ratio * PLANETARY_STAGE_EFFICIENCY ** count,
          HD_HEX_FREE_RPM / ratio,
          count,
          nominal
        )
      )
    if (count === UP_MAX_CARTRIDGES) return
    for (let i = start; i < UP_CARTRIDGES.length; i++)
      visit(i, ratio * UP_CARTRIDGES[i].ratio, nominal * UP_CARTRIDGES[i].nominal, count + 1)
  }
  visit(0, 1, 1, 0)
  return rows.sort((a, b) => a.ratio - b.ratio)
}

const ULTRA_PLANETARY: MotorFamily = {
  rows: ultraPlanetaryRows(),
  // SDK RevRoboticsUltraplanetaryHDHexMotor gearing 20 = 4:1 + 5:1 카트리지(실제 18.93:1)
  defaultRatio: (76 / 21) * (68 / 13),
  // REV motor-based-encoders "At the motor - 28 counts/revolution"
  encoderCountsPerMotorRev: 28,
  stallCurrent: 8.5,
  freeCurrent: 0.4,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  maxStageRatio: 68 / 13
}

// REV HD Hex 20:1·40:1(같은 맨 모터, 20:1 2.1 N·m·300 rpm, 40:1 Spur 4.2 N·m·150 rpm, REV 문서 위와 같은 곳).
// 20:1은 유성(REV-41-1211)과 평기어(REV-41-1298)가 같은 값이고 SDK 형식은 하나라, 효율은 평기어로 가정한다.
// 표 토크는 0.105 N·m × 감속비(효율 1의 이론값)라 UltraPlanetary처럼 효율을 곱한다.
const hdHex = (ratio: number, stallTorque: number, freeRpm: number): MotorFamily => ({
  rows: [row(ratio, stallTorque * SPUR_EFFICIENCY, freeRpm, 0)],
  defaultRatio: ratio,
  // HD Hex 맨 모터의 엔코더 28 카운트(REV 표의 출력축 560·1120 = 28 × 20·40)
  encoderCountsPerMotorRev: 28,
  stallCurrent: 8.5,
  freeCurrent: 0.4,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  efficiency: SPUR_EFFICIENCY,
  maxStageRatio: ratio
})

// REV Core Hex(REV-41-1300): 72:1, 125 rpm, 3.2 N·m, 정지 4.4 A
// (https://docs.revrobotics.com/duo-build/motion/motors/core-hex-motor). REV 페이지에 무부하 전류가 없어 gm0 motor-power
// 표의 Core Hex 줄(제품 값, 0.2 A)을 쓴다.
// 엔코더는 모터축 4 카운트, 출력축 288(같은 REV 페이지 "Encoder Counts per Revolution"). SDK 형식(288, gearing 36.25)의
// 288 ÷ 36.25 = 7.9는 모터축 값이 아니다.
const CORE_HEX: MotorFamily = {
  rows: [row(72, 3.2, 125, 0)],
  defaultRatio: 72,
  encoderCountsPerMotorRev: 4,
  stallCurrent: 4.4,
  freeCurrent: 0.2,
  rotorInertia: CORE_HEX_ROTOR_INERTIA,
  backdriveFriction: CORE_HEX_BACKDRIVE_FRICTION,
  efficiency: CORE_HEX_EFFICIENCY,
  maxStageRatio: 72
}

// AndyMark NeveRest. 맨 모터 12 V, 6000 rpm, 0.062 N·m, 정지 11.5 A, 무부하 0.4 A
// (https://www.andymark.com/products/neverest-classic-motor-only ). AndyMark의 Kt(0.0054 N·m/A)는 같은 급 모터의 1/3이라
// 신뢰도가 낮지만 데이터시트 값을 그대로 쓴다([ACT] §2.4).
const NEVEREST_STALL = 0.062
// Classic 40(am-2964a): 160 rpm, 2.472 N·m(1.823 ft-lb), 정지 11.5 A, 무부하 0.4 A
// (https://www.andymark.com/products/neverest-classic-40-gearmotor ). Classic 60(am-3103): 105 rpm, 3.707 N·m
// (…/neverest-classic-60-gearmotor, 무부하 전류는 같은 맨 모터라 40과 같게 가정). Classic은 평기어 박스다.
// 표 토크는 맨 모터 × 감속비(0.062 × 40 = 2.48, × 60 = 3.72, 효율 1의 이론값, [ACT] §2.4)와 거의 같아 효율을 곱한다.
const neverestClassic = (ratio: number, stallTorque: number, freeRpm: number): MotorFamily => ({
  rows: [row(ratio, stallTorque * SPUR_EFFICIENCY, freeRpm, 0)],
  defaultRatio: ratio,
  // NeveRest 맨 모터의 엔코더 7 ppr × 4 = 28 카운트([ACT] §2.4, AndyMark neverest-classic-motor-only)
  encoderCountsPerMotorRev: 28,
  stallCurrent: 11.5,
  freeCurrent: 0.4,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  efficiency: SPUR_EFFICIENCY,
  maxStageRatio: ratio
})
// Orbital(유성) 20 = 19.2:1 ~344 rpm, 3.7:1 ~1784 rpm, 정지 11 A(https://www.andymark.com/products/neverest-orbital-20-gearmotor ).
// 감속비별 토크가 페이지에 없어 맨 모터 × 감속비 × 유성 단 효율로 만든다(파생, Classic과 같이 손실을 포함한 값).
const neverestOrbital = (ratio: number, freeRpm: number, stages: number): MotorFamily => ({
  rows: [
    row(ratio, NEVEREST_STALL * ratio * PLANETARY_STAGE_EFFICIENCY ** stages, freeRpm, stages)
  ],
  defaultRatio: ratio,
  // 같은 NeveRest 맨 모터·엔코더(7 ppr × 4 = 28). SDK NeveRest3.7v1Gearmotor의 ticksPerRev 44.4(= 12 × 3.7)는 이 엔코더와
  // 맞지 않아 쓰지 않는다(가정: AndyMark Orbital 3.7 페이지의 출력축 카운트는 이 세션에서 열지 못했다)
  encoderCountsPerMotorRev: 28,
  stallCurrent: 11,
  freeCurrent: 0.4,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  maxStageRatio: 5.2
})

// TETRIX MAX TorqueNADO(Pitsco 44260, 지금 파는 TETRIX 모터): 20:1 300 rpm 233 oz-in, 40:1 150 rpm 466 oz-in, 60:1 100 rpm
// 700 oz-in, 정지 8.7 A(https://cdn.shopify.com/s/files/1/0869/9363/3572/files/torquenado_dcmotorspecs.pdf ). SDK
// TetrixMotor(옛 W39530, 52:1 165 rpm)의 데이터시트는 찾지 못해 모델 기본은 60:1로 둔다(가정). 무부하 전류는 공개되지
// 않아 0.3 A(가정: 같은 급 goBILDA 0.25 A와 NeveRest 0.4 A 사이, gm0 다이노는 0.2 A), 기어 형식도 공개되지 않아 평기어
// 효율로 가정한다.
// 엔코더는 같은 데이터시트의 출력축 480·960·1440 cpr(20·40·60:1)이라 모터축 24다(SDK TetrixMotor 1440 ÷ 52 = 27.7은 옛 모터 값).
const TETRIX: MotorFamily = {
  rows: [row(20, 233 * OZIN, 300, 0), row(40, 466 * OZIN, 150, 0), row(60, 700 * OZIN, 100, 0)],
  defaultRatio: 60,
  encoderCountsPerMotorRev: 24,
  stallCurrent: 8.7,
  freeCurrent: 0.3,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  efficiency: SPUR_EFFICIENCY,
  maxStageRatio: 60
}

// Studica Maverick(75001): 61:1, 무부하 100 rpm·0.6 A, 정지 11 A, 708 oz-in(표의 Min 칸)
// (https://studica-docs-worldskills.readthedocs.io/en/latest/docs/Motors/maverick-dc-motor.html ). 기어 형식은 공개되지
// 않아 평기어 효율로 가정한다.
const MAVERICK: MotorFamily = {
  rows: [row(61, 708 * OZIN, 100, 0)],
  defaultRatio: 61,
  // 6 펄스 × 4 = 24 카운트(SDK StudicaMaverick 1464 = 24 × 61과 같다)
  encoderCountsPerMotorRev: 24,
  stallCurrent: 11,
  freeCurrent: 0.6,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  efficiency: SPUR_EFFICIENCY,
  maxStageRatio: 61
}

// MATRIX 12V(SDK Matrix12vMotor): 맨 모터는 goBILDA 맨 모터와 같은 값(6000 rpm, 1.47 kg·cm, 9.2 A, 0.25 A, [ACT] §2.7).
// 옛 MR 기어모터 키트의 기어비·토크는 출처가 없어 SDK gearing 52.8과 평기어 효율로 만든다(가정).
const MATRIX_RATIO = 52.8
const MATRIX: MotorFamily = {
  rows: [row(MATRIX_RATIO, 1.47 * KGCM * MATRIX_RATIO * SPUR_EFFICIENCY, 6000 / MATRIX_RATIO, 0)],
  defaultRatio: MATRIX_RATIO,
  // goBILDA와 같은 맨 모터·엔코더 28 카운트(SDK Matrix12vMotor 1478.4 = 28 × 52.8과 같다)
  encoderCountsPerMotorRev: 28,
  stallCurrent: 9.2,
  freeCurrent: 0.25,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  efficiency: SPUR_EFFICIENCY,
  maxStageRatio: MATRIX_RATIO
}

// goBILDA 5201(단종, SKU 5201-0002-0053): 53.475:1 평기어, 105 rpm, 51.8 kg·cm, 정지 9.2 A, 무부하 0.25 A
// (https://www.gobilda.com/5201-series-53-1-ratio-105-rpm-spur-gear-motor-w-encoder ). 엔코더는 같은 페이지 Specs의
// "Encoder Countable Events Per Revolution" 엔코더축 28, 출력축 1,497.325(= 28 × 53.475)다(SDK 형식 1500 ÷ 54 = 27.78이 아니다).
const GOBILDA_5201: MotorFamily = {
  rows: [row(53.475, 51.8 * KGCM, 105, 0)],
  defaultRatio: 53.475,
  encoderCountsPerMotorRev: 28,
  stallCurrent: 9.2,
  freeCurrent: 0.25,
  rotorInertia: RS555_ROTOR_INERTIA,
  backdriveFriction: RS555_BACKDRIVE_FRICTION,
  efficiency: SPUR_EFFICIENCY,
  maxStageRatio: 53.475
}

// 구성 태그 → 계열. 형식을 모르는 모터(구성 Motor 태그)는 FTC에서 가장 흔한 goBILDA 계열로 보고, 모델 기본 감속비는 SDK
// Motor 형식의 gearing(52)으로 둔다(가정).
const MOTOR_FAMILIES: Readonly<Record<string, MotorFamily>> = {
  goBILDA5201SeriesMotor: GOBILDA_5201,
  goBILDA5202SeriesMotor: GOBILDA,
  Matrix12vMotor: MATRIX,
  NeveRest20Gearmotor: neverestOrbital(19.2, 344, 2),
  'NeveRest3.7v1Gearmotor': neverestOrbital(3.7, 1784, 1),
  NeveRest40Gearmotor: neverestClassic(40, 2.472, 160),
  NeveRest60Gearmotor: neverestClassic(60, 3.707, 105),
  RevRobotics20HDHexMotor: hdHex(20, 2.1, 300),
  RevRobotics40HDHexMotor: hdHex(40, 4.2, 150),
  RevRoboticsCoreHexMotor: CORE_HEX,
  RevRoboticsUltraplanetaryHDHexMotor: ULTRA_PLANETARY,
  StudicaMaverick: MAVERICK,
  TetrixMotor: TETRIX,
  [UNSPECIFIED_MOTOR_TAG]: { ...GOBILDA, defaultRatio: MOTOR_TYPES[UNSPECIFIED_MOTOR_TAG].gearing }
}

function motorFamily(tag: string): MotorFamily {
  return Object.prototype.hasOwnProperty.call(MOTOR_FAMILIES, tag)
    ? MOTOR_FAMILIES[tag]
    : MOTOR_FAMILIES[UNSPECIFIED_MOTOR_TAG]
}

const logDistance = (a: number, b: number): number => Math.abs(Math.log(a / b))

// 표에 없는 감속비의 유성 단 수: 한 단의 가장 큰 감속비로 몇 단이 드는지(1:1은 0단)
function stagesFor(family: MotorFamily, ratio: number): number {
  if (ratio <= 1) return 0
  return Math.max(1, Math.ceil(Math.log(ratio) / Math.log(family.maxStageRatio) - 1e-9))
}

function efficiencyOf(family: MotorFamily, stages: number): number {
  return family.efficiency ?? PLANETARY_STAGE_EFFICIENCY ** stages
}

// 모터 컴포넌트에서 팀이 덮어쓴 값(0이면 데이터시트). 출력축 기준, 12 V.
export type MotorOverrides = { stallTorque: number; freeSpeedRpm: number }

// 덮어쓰기로 받는 범위. 밖의 값(0, 음수, NaN, 손으로 고친 프로젝트 파일의 너무 크거나 작은 값)은 데이터시트를 쓴다.
// 하한은 인스펙터 표시 자릿수 한 칸(0.001 N·m, 1 rpm)이라 0처럼 보이는 값이 데이터시트와 다르게 돌지 않고, 세계 설명이
// 받는 하한(정지 토크 1e-6 N·m, 무부하 속도 1e-3 rad/s ≈ 0.0095 rpm)보다 커서 덮어쓰기가 세계 설명을 깨지 않는다.
// 상한은 goBILDA 188:1 정지 24.5 N·m, 맨 모터 6000 rpm을 넉넉히 넘고 세계 설명 상한(1e3 N·m, 1e5 rad/s)보다 작다.
export const MIN_STALL_TORQUE_OVERRIDE = 0.001
export const MAX_STALL_TORQUE_OVERRIDE = 100
export const MIN_FREE_SPEED_OVERRIDE_RPM = 1
export const MAX_FREE_SPEED_OVERRIDE_RPM = 20000

const overrideOr = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) && value >= min && value <= max ? value : fallback

// 기어모터의 물리 값. gearbox는 모터 gearbox 속성(실제 감속비), 'default'면 그 형식의 모델 기본(실제 감속비).
// 표의 감속비(실제 값이나 팀이 흔히 쓰는 이름, ±1.5 %)면 그 줄의 제조사 값을, 아니면 가장 가까운 줄(로그 거리)에서 감속비와
// 효율 비율로 늘이거나 줄인다(같은 맨 모터: 토크 ∝ 감속비 × 효율, 속도 ∝ 1/감속비).
export function resolveMotorParams(
  modelTag: string,
  gearbox: number | 'default',
  overrides: MotorOverrides = { stallTorque: 0, freeSpeedRpm: 0 }
): SimMotorParams {
  const family = motorFamily(modelTag)
  const wanted = gearbox === 'default' ? family.defaultRatio : gearbox
  let nearest = family.rows[0]
  for (const candidate of family.rows) {
    const d = Math.min(logDistance(candidate.ratio, wanted), logDistance(candidate.nominal, wanted))
    const best = Math.min(logDistance(nearest.ratio, wanted), logDistance(nearest.nominal, wanted))
    if (d < best) nearest = candidate
  }
  const matched =
    Math.min(logDistance(nearest.ratio, wanted), logDistance(nearest.nominal, wanted)) <=
    RATIO_TOLERANCE
  let ratio: number
  let stallTorque: number
  let freeRpm: number
  let stages: number
  if (matched) {
    ratio = nearest.ratio
    stallTorque = nearest.stallTorque
    freeRpm = nearest.freeRpm
    stages = nearest.stages
  } else {
    ratio = wanted
    stages = stagesFor(family, ratio)
    stallTorque =
      nearest.stallTorque *
      (ratio / nearest.ratio) *
      (efficiencyOf(family, stages) / efficiencyOf(family, nearest.stages))
    freeRpm = (nearest.freeRpm * nearest.ratio) / ratio
  }
  return {
    stallTorque: overrideOr(
      overrides.stallTorque,
      MIN_STALL_TORQUE_OVERRIDE,
      MAX_STALL_TORQUE_OVERRIDE,
      stallTorque
    ),
    freeSpeed:
      overrideOr(
        overrides.freeSpeedRpm,
        MIN_FREE_SPEED_OVERRIDE_RPM,
        MAX_FREE_SPEED_OVERRIDE_RPM,
        freeRpm
      ) * RPM,
    stallCurrent: family.stallCurrent,
    freeCurrent: family.freeCurrent,
    gearbox: ratio,
    efficiency: efficiencyOf(family, stages),
    rotorInertia: family.rotorInertia,
    backdriveFriction: family.backdriveFriction
  }
}

// 관절 모터의 출력축 1회전 엔코더 틱: 모터축 카운트(encoderCountsPerMotorRev, 제조사 값) × 물리 감속비(resolveMotorParams의
// gearbox, 토크·속도와 같은 값). 구동계 바퀴의 규칙(ticksPerRev ÷ SDK gearing × gearbox, motorTypes.ts)과 같이 "엔코더는
// 모터축에 있다"이고, 카운트와 감속비만 관절 동역학이 쓰는 실제 값이다. 그래서 UltraPlanetary 기본(실제 18.93:1)은 530,
// NeveRest Orbital 20(19.2:1)은 537.6, Core Hex 72:1은 288, goBILDA 5201 53:1은 1,497.3으로 제조사 출력축 카운트와 같다.
export function jointEncoderTicksPerOutputRev(modelTag: string, gearbox: number): number {
  return motorFamily(modelTag).encoderCountsPerMotorRev * gearbox
}

// ---- 서보 ----

// 서보 모델(서보·CR 서보 컴포넌트의 시뮬레이터 전용 속성 servoModel). 구성 태그 Servo·ServoFullRange·CRServo에는
// 제조사가 없어 팀이 고른다. 기본은 goBILDA 2000 Torque(25-2)다.
export const SERVO_MODEL_KEYS = [
  'gobildaTorque',
  'gobildaSpeed',
  'gobildaSuperSpeed',
  'axonMax',
  'axonMini',
  'axonMicro',
  'revSmartServo'
] as const
export type ServoModelKey = (typeof SERVO_MODEL_KEYS)[number]
export const DEFAULT_SERVO_MODEL: ServoModelKey = 'gobildaTorque'

type ServoModel = {
  // N·m, rad/s: 허브 서보 포트 5 V에서의 정지 토크·무부하 속도. 데이터시트 4.8 V·6.0 V 값의 선형 보간이다([ACT] §5.2
  // "허브 5 V 보간값", Control Hub 서보 전원 5 V https://docs.revrobotics.com/duo-control/control-system-overview/control-hub-basics ).
  stallTorque: number
  freeSpeed: number
  // °, SDK 기본 PWM 범위(600–2400 µs) 전체의 각([ACT] §5.3)
  rangeDegrees: number
  // µs
  deadbandUs: number
  // µs, 연속 회전 모드에서 1500 µs부터 최고 속도에 닿는 펄스까지
  crHalfRangeUs: number
}

// goBILDA 2000 Dual Mode: 0.150°/µs → 600–2400 µs가 270°, 데드밴드 4 µs, 연속 회전 펄스 900–2100 µs(25-2)·1000–2000 µs
// (25-3·25-4)(https://www.gobilda.com/2000-series-dual-mode-servo-25-2-torque/ , …-25-3-speed/ , …-25-4-super-speed/ ).
// Axon MK2: 0.175°/µs → 315°, 데드밴드 2 µs, 연속 회전 1050–1950 µs(https://docs.axon-robotics.com/servos/max ,
// …/servos/mini). Axon MICRO+(단종, https://docs.axon-robotics.com/archive/micro.md)는 펄스 범위·데드밴드가 문서에 없어 MK2와
// 같게 가정한다. REV Smart Robot Servo V2 Balanced: 500–2500 µs가 270°라 600–2400 µs는 243°, 연속 모드는 같은 펄스 범위를
// 속도에 대응(https://docs.revrobotics.com/rev-crossover-products/servo/srs.md ), 데드밴드는 문서에 없어 goBILDA와 같게
// 가정한다. SRS는 4.8 V 값이 없어 6 V 값(7.48 rad/s, 1.324 N·m,
// https://docs.revrobotics.com/rev-crossover-products/servo/smart-robot-servo-v2/srs-v2-specifications ) × 5/6이다(DC
// 모터 직선 가정, [ACT] §5.2).
const SERVO_MODELS: Readonly<Record<ServoModelKey, ServoModel>> = {
  gobildaTorque: {
    stallTorque: 1.76,
    freeSpeed: 4.33,
    rangeDegrees: 270,
    deadbandUs: 4,
    crHalfRangeUs: 600
  },
  gobildaSpeed: {
    stallTorque: 0.8,
    freeSpeed: 9.82,
    rangeDegrees: 270,
    deadbandUs: 4,
    crHalfRangeUs: 500
  },
  gobildaSuperSpeed: {
    stallTorque: 0.4,
    freeSpeed: 19.8,
    rangeDegrees: 270,
    deadbandUs: 4,
    crHalfRangeUs: 500
  },
  axonMax: {
    stallTorque: 2.84,
    freeSpeed: 7.71,
    rangeDegrees: 315,
    deadbandUs: 2,
    crHalfRangeUs: 450
  },
  axonMini: {
    stallTorque: 2.04,
    freeSpeed: 9.82,
    rangeDegrees: 315,
    deadbandUs: 2,
    crHalfRangeUs: 450
  },
  axonMicro: {
    stallTorque: 0.66,
    freeSpeed: 12.6,
    rangeDegrees: 315,
    deadbandUs: 2,
    crHalfRangeUs: 450
  },
  revSmartServo: {
    stallTorque: (1.324 * 5) / 6,
    freeSpeed: (7.48 * 5) / 6,
    rangeDegrees: 243,
    deadbandUs: 4,
    crHalfRangeUs: 1000
  }
}

// SDK 기본 PWM 범위의 절반(µs): 600–2400 µs, power 0 = 1500 µs(SDK PwmControl.PwmRange 기본값, CRServoImpl)
const SDK_HALF_RANGE_US = 900
// 내부 위치 제어 근사(가정, [ACT] §5.4): 오차 5°에서 정지 토크에 닿는 비례 이득, 감쇠는 서보 모터의 토크-속도 직선 기울기
// (정지 토크 ÷ 무부하 속도)
const SERVO_SATURATION_ERROR = 5 * DEG
// PWM이 꺼졌을 때(허브는 서보 5 V 전원도 끈다, gm0 control-system-internals) 남는 기어열 마찰: 정지 토크의 5 %(가정. 출처가
// 없다. goBILDA 감속비 300·135·67:1에 소형 모터 쿨롱 마찰 0.3 mN·m를 곱한 값 0.09·0.04·0.02 N·m와 비슷하다)
const SERVO_LIMP_FRACTION = 0.05

export function isServoModelKey(value: unknown): value is ServoModelKey {
  return typeof value === 'string' && (SERVO_MODEL_KEYS as readonly string[]).includes(value)
}

// 서보의 물리 값. kind 'crServo'는 각 범위를 쓰지 않고(0) crFullPower가 연속 회전 범위에서 나오며, 위치 서보는 crFullPower 1이다.
// 연속 회전 펄스 범위가 SDK 범위보다 넓은 모델(REV SRS 500–2500 µs)은 power 1(2400 µs)에서도 최고 속도에 닿지 않는다
// (900/1000 = 90 %). 세계 설명의 crFullPower는 1 이하라서, 그때는 crFullPower 1에 정지 토크·무부하 속도를 그 비율로 줄인다.
// CR 서보 모델 τ = τs·(u − ω/ωf)(u = |offset|/(900 µs·crFullPower)를 1로 자름)에서 두 표현은 SDK PWM 범위 안의 모든 power에서
// 같다(τs·(0.9·u′ − ω/ωf) = 0.9·τs·(u′ − ω/(0.9·ωf)), 기울기 τs/ωf와 kd도 같다). 팀이 PWM 범위를 SDK 기본보다 넓히면
// (2500 µs) 실제는 최고 속도에 닿지만 시뮬레이터는 90 %에서 멈춘다(한계). 기어 마찰(limpFriction)은 실제 정지 토크로 정한다.
export function resolveServoParams(model: unknown, kind: 'servo' | 'crServo'): SimServoParams {
  const servo = SERVO_MODELS[isServoModelKey(model) ? model : DEFAULT_SERVO_MODEL]
  const crFull = servo.crHalfRangeUs / SDK_HALF_RANGE_US
  const reach = kind === 'crServo' && crFull > 1 ? 1 / crFull : 1
  const stallTorque = servo.stallTorque * reach
  const freeSpeed = servo.freeSpeed * reach
  return {
    stallTorque,
    freeSpeed,
    rangeAngle: kind === 'servo' ? servo.rangeDegrees * DEG : 0,
    deadbandUs: servo.deadbandUs,
    kp: stallTorque / SERVO_SATURATION_ERROR,
    kd: stallTorque / freeSpeed,
    crFullPower: kind === 'crServo' ? Math.min(crFull, 1) : 1,
    limpFriction: servo.stallTorque * SERVO_LIMP_FRACTION
  }
}
