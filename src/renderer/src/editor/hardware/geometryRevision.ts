import { useSceneStore } from '../../scene/sceneStore'

// 형상 판(geometryRevision)에 기대는 하드웨어 카드: 웹캠 setCameraPose 줄은 렌즈(하우징 앞면)를 형상 경계 상자로 구한다
// (hardware/mounting.ts의 sensorMountInRobot). 형상은 씬 문서 밖이라 CAD를 읽거나 다시 찾아도 objects가 바뀌지 않으므로, 이
// 카드는 형상 판을 구독해 다시 그린다. 다른 종류는 0을 골라 형상이 바뀌어도 다시 그리지 않는다.
export function useComponentGeometryRevision(type: string): number {
  return useSceneStore((state) => (type === 'webcam' ? state.geometryRevision : 0))
}
