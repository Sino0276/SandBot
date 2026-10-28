// 모터 형식 표(구성 XML 태그 → 엔코더·기어·속도·회전 방향). 사이드카의 MotorConfigurationType
// (sidecar/sdk/com/qualcomm/robotcore/hardware/configuration/typecontainers/MotorConfigurationType.java, SDK 12.0의
// @MotorType 값)과 같은 표다. motorTypes.test.ts가 그 Java 파일을 읽어 값이 같은지 확인한다.
//
// SDK는 계열마다 기어비 하나만 안다(goBILDA 5202 계열 99.5, UltraPlanetary 20 등). 엔코더는 모터 축에 있으므로
// 엔코더 틱/s와 허브 최대 속도는 기어박스와 관계없고, 출력축 1회전의 틱과 출력축 속도만 실제 기어박스(spec.gearbox)로 바꾼다.

export type MotorType = {
  // 형식 기어비에서 출력축 1회전의 엔코더 틱
  ticksPerRev: number
  // 형식이 가정하는 감속비
  gearing: number
  // 형식 기어비에서 출력축 무부하 RPM
  maxRPM: number
  // 출력축이 +power에 도는 방향. CCW 형식은 DcMotorImpl이 FORWARD를 뒤집는다(getOperationalDirection).
  orientation: 'CW' | 'CCW'
}

// SDK @MotorType의 achieveableMaxRPMFraction 기본값(모든 내장 형식)
export const ACHIEVEABLE_MAX_RPM_FRACTION = 0.85

const t = (
  ticksPerRev: number,
  gearing: number,
  maxRPM: number,
  orientation: 'CW' | 'CCW'
): MotorType => ({ ticksPerRev, gearing, maxRPM, orientation })

// 구성 태그 → 형식(MotorConfigurationType의 builtIn 순서)
export const MOTOR_TYPES: Readonly<Record<string, MotorType>> = {
  goBILDA5201SeriesMotor: t(1500, 54, 104, 'CCW'),
  goBILDA5202SeriesMotor: t(2786, 99.5, 60, 'CCW'),
  Matrix12vMotor: t(1478.4, 52.8, 190, 'CW'),
  NeveRest20Gearmotor: t(560, 20, 315, 'CW'),
  'NeveRest3.7v1Gearmotor': t(44.4, 3.7, 1784, 'CCW'),
  NeveRest40Gearmotor: t(1120, 40, 160, 'CCW'),
  NeveRest60Gearmotor: t(1680, 60, 105, 'CCW'),
  RevRobotics20HDHexMotor: t(560, 20, 300, 'CCW'),
  RevRobotics40HDHexMotor: t(1120, 40, 150, 'CCW'),
  RevRoboticsCoreHexMotor: t(288, 36.25, 137, 'CCW'),
  RevRoboticsUltraplanetaryHDHexMotor: t(560, 20, 300, 'CW'),
  StudicaMaverick: t(1464, 61, 100, 'CW'),
  TetrixMotor: t(1440, 52, 165, 'CW'),
  // 구성의 Motor 태그(UnspecifiedMotor). 모르는 태그도 이것으로 본다(SDK와 같음).
  Motor: t(1440, 52, 165, 'CW')
}

export const UNSPECIFIED_MOTOR_TAG = 'Motor'

export function motorType(tag: string): MotorType {
  return Object.prototype.hasOwnProperty.call(MOTOR_TYPES, tag)
    ? MOTOR_TYPES[tag]
    : MOTOR_TYPES[UNSPECIFIED_MOTOR_TAG]
}

// 형식 회전 부호: 허브 power +가 "형식의 FORWARD"와 같은 방향이면 1, CCW 형식이면 −1(실제 DcMotorImpl이 CCW 형식의
// FORWARD를 뒤집어 허브에 보낸다).
export function rotationSign(type: MotorType): 1 | -1 {
  return type.orientation === 'CCW' ? -1 : 1
}

// 실제 기어박스(gearbox)를 단 출력축 1회전의 엔코더 틱(goBILDA 312 RPM: 2786 ÷ 99.5 × 19.2 = 537.6)
export function ticksPerOutputRev(type: MotorType, gearbox: number): number {
  return (type.ticksPerRev / type.gearing) * gearbox
}

// 12 V 무부하 출력축 각속도(rad/s): maxRPM × gearing ÷ gearbox × 2π/60
export function noLoadOutputRadPerSec(type: MotorType, gearbox: number): number {
  return (((type.maxRPM * type.gearing) / gearbox) * 2 * Math.PI) / 60
}

// 허브의 최대 엔코더 속도(틱/s): SDK getAchieveableMaxTicksPerSecondRounded와 같은 반올림. 엔코더 모드에서 setPower(p)는
// 목표 속도 p × 이 값이다(사이드카 SimDcMotorController). 엔코더는 모터 축에 있으므로 기어박스와 관계없다.
export function hubMaxTicksPerSecond(type: MotorType): number {
  return Math.round((type.ticksPerRev * type.maxRPM * ACHIEVEABLE_MAX_RPM_FRACTION) / 60)
}
