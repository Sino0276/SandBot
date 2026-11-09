import type { SceneObjects } from '../scene/model'

// 세계 설명의 거리·컬러 센서 목록(4c, spec-4c §1.2·§3). 빌더(buildWorldSensors)와 인스펙터 값 줄·씬 뷰 기즈모가 같은
// 거르기(sensorExclusions)를 쓴다(빠진 센서를 정상처럼 보이지 않게, U9).
//
// 계약 커밋: sensorExclusions의 시그니처와 빈 Map 스텁이다. 4c B가 구현한다(buildWorldSensors도 B가 더한다).

// 세계 설명에서 빠지는 이유: 장치 이름이 비었음, 이미 쓴 장치 이름(모터·허브·다른 장치·앞 센서), 목록마다
// MAX_WORLD_SENSORS를 넘음, 로봇 밖
export type SensorExclusion = 'emptyName' | 'duplicateName' | 'tooMany' | 'outsideRobot'

// 그 로봇의 distanceSensor·colorSensor 컴포넌트 중 세계 설명에서 빠지는 것(컴포넌트 id → 이유). usedDevices는 빌더가
// 실제로 낸 장치 이름(모터·데드휠·Pinpoint·OTOS·IMU·관절 구동·리밋 스위치·허브)이고, 생략하면 같은 목록을 안에서 만든다.
export function sensorExclusions(
  objects: SceneObjects,
  robotId: string,
  usedDevices?: ReadonlySet<string>
): Map<string, SensorExclusion> {
  void objects
  void robotId
  void usedDevices
  return new Map()
}
