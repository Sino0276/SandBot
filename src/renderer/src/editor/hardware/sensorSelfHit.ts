import type { SensorComponentType, SensorMountInRobot } from '../../hardware/mounting'
import type { SceneObjects } from '../../scene/model'

// 거리·컬러 센서의 자기 로봇 가림(4c, spec-4c §1.9). 편집 자세에서 축 광선과 바깥 광선(거리: 모선 8, 컬러: 발자국 6)을
// 그 로봇의 CAD 메시(숨김과 관계없음)에 쏜다. 센서 오브젝트 자신과 그 하위의 형상(하우징)은 뺀다. 시뮬레이터에는 로봇
// 형상이 없으므로 값은 바꾸지 않고 경고만 한다(인스펙터 값 줄, INIT Console worldSensorSelfHit).
//
// 계약 커밋: 시그니처와 null 스텁이다. 4c C가 구현한다.

// axis: 축 광선이 reach보다 가까이에서 그 파트에 맞음(distance m, 가장 가까운 파트). partial: 바깥 광선만 맞음.
export type SelfHit = { kind: 'axis'; partId: string; distance: number } | { kind: 'partial' }

// reachM: 편집 자세 값의 거리(없으면 거리 센서 1.2 m, 컬러 센서 6 in)
export function sensorSelfHit(
  objects: SceneObjects,
  robotId: string,
  sensorObjectId: string,
  mount: SensorMountInRobot,
  type: SensorComponentType,
  reachM: number
): SelfHit | null {
  void objects
  void robotId
  void sensorObjectId
  void mount
  void type
  void reachM
  return null
}
