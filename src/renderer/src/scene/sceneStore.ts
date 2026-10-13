import { create } from 'zustand'
import { DEG, ROBOT_SIZE, TILE_SIZE } from './coordinates'
import { constrainTransform, type SceneObjects, type Transform } from './model'

// CAD 임포트와 프로젝트 파일이 생기기 전까지 쓰는 임시 씬: 18 in 상자 로봇과 앞쪽에 달린 웹캠
const PLACEHOLDER_SCENE: SceneObjects = {
  robot: {
    id: 'robot',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [-1.5 * TILE_SIZE, -1.5 * TILE_SIZE, 0], rotation: [0, 0, 30 * DEG] }
  },
  webcam: {
    id: 'webcam',
    name: 'Webcam',
    kind: 'part',
    parentId: 'robot',
    transform: { position: [ROBOT_SIZE / 2, 0.05, 0.3], rotation: [0, 15 * DEG, 0] }
  }
}

type SceneState = {
  objects: SceneObjects
  // 저장용 로컬 변환을 설정한다. 오브젝트 종류별 제약(예: 로봇은 바닥 평면)을 적용한다.
  setLocalTransform: (id: string, transform: Transform) => void
}

export const useSceneStore = create<SceneState>()((set) => ({
  objects: PLACEHOLDER_SCENE,
  setLocalTransform: (id, transform) =>
    set((state) => {
      const object = state.objects[id]
      if (!object) return state
      return {
        objects: {
          ...state.objects,
          [id]: { ...object, transform: constrainTransform(object, transform) }
        }
      }
    })
}))
