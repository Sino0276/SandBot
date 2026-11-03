import { motorOutput } from '../../hardware/catalog'
import type { HardwareComponent } from '../../scene/model'

// 관절 카드 계산값(최고 속도·정지 하중)에 쓰는 구동 장치 정격: 출력축 기준 12 V 정지 토크(N·m)와 무부하 속도(rad/s).
// 모르면 null(카드가 "—"로 보인다). 카드 보기 모델은 이 모양만 받으므로 시험에서 값을 바꿀 수 있다.
export type ActuatorRating = { stallTorque: number | null; freeSpeed: number | null }

export type ActuatorRatings = {
  motor: (component: HardwareComponent) => ActuatorRating
  servo: (component: HardwareComponent, kind: 'servo' | 'crServo') => ActuatorRating
}

const RPM = (2 * Math.PI) / 60

// 덮어쓴 값(모터 컴포넌트의 시뮬레이터 전용 속성 stallTorque·freeSpeed, spec-3b §1-1, 0이면 데이터시트)
function override(component: HardwareComponent, key: string): number | null {
  const value = Number(component.props[key])
  return Number.isFinite(value) && value > 0 ? value : null
}

// 지금 쓰는 정격(갈래 C 통합 전). 통합 때 src/shared/sim/actuatorData.ts의 resolveMotorParams(모터: 형식 태그·실제
// 감속비·덮어쓰기)·resolveServoParams(서보 모델)로 바꾼다(세계 설명과 같은 값을 보이게).
// - 모터 무부하 속도: 팀이 덮어쓴 값, 아니면 SDK 형식의 maxRPM × gearing ÷ 실제 감속비(바퀴 카드 최고 속도와 같은 값,
//   hardware/catalog.ts motorOutput)
// - 모터 정지 토크: 팀이 덮어쓴 값만(데이터시트 표는 갈래 C가 둔다)
// - 서보: 모델 표가 아직 없어 모른다
export const INTERIM_RATINGS: ActuatorRatings = {
  motor: (component) => ({
    stallTorque: override(component, 'stallTorque'),
    freeSpeed: (override(component, 'freeSpeed') ?? motorOutput(component.props).freeRpm) * RPM
  }),
  servo: () => ({ stallTorque: null, freeSpeed: null })
}
