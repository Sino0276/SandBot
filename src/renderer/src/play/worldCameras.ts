import type { SceneObjects } from '../scene/model'

// 세계 설명의 웹캠 목록(4d, spec-4d §4 C). 빌더(buildWorldCameras)와 인스펙터 편집 자세 줄·씬 뷰 기즈모가 같은 거르기
// (cameraExclusions)를 쓴다(4c sensorExclusions와 같은 꼴, 빠진 웹캠을 정상처럼 보이지 않게).
//
// 계약은 시그니처와 빈 Map 스텁만 둔다. 4d C가 빌더와 거르기를 구현한다.

// 세계 설명에서 빠지는 이유: 시리얼이 없어 구성 XML에 들어가지 않음, 장치 이름이 비었음, 이미 쓴 장치 이름(모터·허브·다른
// 장치·센서·앞 웹캠), MAX_WORLD_CAMERAS를 넘음, 로봇 밖
export type CameraExclusion =
  'notConfigured' | 'emptyName' | 'duplicateName' | 'tooMany' | 'outsideRobot'

// 그 로봇의 webcam 컴포넌트 중 세계 설명에서 빠지는 것(컴포넌트 id → 이유). usedDevices는 빌더가 실제로 낸 장치 이름
// (worldUsedDevices + 받아들인 거리·컬러 센서)이고, 생략하면 같은 목록을 빌더로 만든다. 계약 스텁: 늘 빈 Map.
export function cameraExclusions(
  objects: SceneObjects,
  robotId: string,
  usedDevices?: ReadonlySet<string>
): Map<string, CameraExclusion> {
  void objects
  void robotId
  void usedDevices
  return new Map()
}
