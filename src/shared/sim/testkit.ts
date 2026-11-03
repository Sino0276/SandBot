import { resolveMotorParams } from './actuatorData'
import { DEFAULT_WHEEL_FRICTION, wheelSpinInertia } from './wheelData'
import type { SimBody, SimMotorParams, WheelKind } from './worldSpec'

// 시험용 세계 설명 조각(3c 세계 설명 v3의 필드). 시뮬레이터·메인·사이드카 통합 시험이 같이 쓴다(제품 코드는 쓰지 않는다).

// 모터 형식·감속비의 데이터시트 값(렌더러 motorComponentParams와 같은 풀이)
export function testMotorParams(modelTag: string, gearbox: number | 'default'): SimMotorParams {
  return resolveMotorParams(modelTag, gearbox)
}

// 기준 섀시: 13.6 kg(3a DEFAULT_ROBOT_MASS)를 18 in 정사각(0.4572 m)·높이 0.2 m 직육면체에 고르게 둠, 무게중심 높이 0.1 m
export const TEST_CHASSIS_MASS = 13.6
export const TEST_CHASSIS_SIDE = 0.4572
export const TEST_CHASSIS_HEIGHT = 0.2
export function testChassis(
  mass = TEST_CHASSIS_MASS,
  side = TEST_CHASSIS_SIDE,
  height = TEST_CHASSIS_HEIGHT
): SimBody {
  const lateral = (mass * (side * side + height * height)) / 12
  return {
    mass,
    centerOfMass: { x: 0, y: 0, z: height / 2 },
    inertia: [lateral, lateral, (mass * 2 * side * side) / 12, 0, 0, 0]
  }
}

// 바퀴의 3c 필드(종류 기본 질량의 회전 관성, 종류 기본 마찰)
export function testWheelPhysics(
  kind: WheelKind,
  radius: number
): { spinInertia: number; friction: number } {
  return {
    spinInertia: wheelSpinInertia(kind, radius, null),
    friction: DEFAULT_WHEEL_FRICTION[kind]
  }
}
