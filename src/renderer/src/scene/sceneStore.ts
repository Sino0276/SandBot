import { create } from 'zustand'
import { cadRootTransform, isValidAlignment, type CadAlignment } from '../cad/alignment'
import { DEG, ROBOT_SIZE, TILE_SIZE } from './coordinates'
import { disposeGeometry } from './geometryRegistry'
import { constrainTransform, subtreeIds, type SceneObjects, type Transform } from './model'

// CAD를 불러오기 전까지 보여 주는 임시 씬: 18 in 상자 로봇과 앞쪽에 달린 웹캠
const PLACEHOLDER_SCENE: SceneObjects = {
  robot: {
    id: 'robot',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [-1.5 * TILE_SIZE, -1.5 * TILE_SIZE, 0], rotation: [0, 0, 30 * DEG] },
    visual: { type: 'placeholder', shape: 'robot' }
  },
  webcam: {
    id: 'webcam',
    name: 'Webcam',
    kind: 'part',
    parentId: 'robot',
    transform: { position: [ROBOT_SIZE / 2, 0.05, 0.3], rotation: [0, 15 * DEG, 0] },
    visual: { type: 'placeholder', shape: 'webcam' }
  }
}

function isPlaceholderScene(objects: SceneObjects): boolean {
  return Object.values(objects).every((object) => object.visual?.type === 'placeholder')
}

type SceneState = {
  objects: SceneObjects
  // 저장용 로컬 변환을 설정한다. 오브젝트 종류별 제약(예: 로봇은 바닥 평면)을 적용한다.
  setLocalTransform: (id: string, transform: Transform) => void
  // 오브젝트들을 추가한다. 씬에 임시 오브젝트만 있으면 그것들은 지운다.
  addObjects: (objects: SceneObjects) => void
  // 오브젝트와 그 하위를 지우고 형상을 해제한다.
  removeObject: (id: string) => void
  // CAD 루트의 방향(위·앞 축)을 바꾸고 바닥 중심 맞춤을 다시 계산한다.
  setCadAlignment: (id: string, alignment: CadAlignment) => void
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
    }),
  addObjects: (objects) =>
    set((state) => ({
      objects: { ...(isPlaceholderScene(state.objects) ? {} : state.objects), ...objects }
    })),
  removeObject: (id) =>
    set((state) => {
      if (!state.objects[id]) return state
      const objects = { ...state.objects }
      for (const removedId of subtreeIds(state.objects, id)) {
        const visual = objects[removedId].visual
        if (visual?.type === 'mesh') disposeGeometry(visual.geometryId)
        delete objects[removedId]
      }
      return { objects }
    }),
  setCadAlignment: (id, alignment) =>
    set((state) => {
      const object = state.objects[id]
      if (!object?.cad || !isValidAlignment(alignment)) return state
      return {
        objects: {
          ...state.objects,
          [id]: {
            ...object,
            transform: cadRootTransform(object.cad.bounds, alignment),
            cad: { ...object.cad, ...alignment }
          }
        }
      }
    })
}))
