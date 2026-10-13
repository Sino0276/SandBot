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

export function isPlaceholderScene(objects: SceneObjects): boolean {
  return Object.values(objects).every((object) => object.visual?.type === 'placeholder')
}

function disposeMeshes(objects: SceneObjects, ids: string[]): void {
  for (const id of ids) {
    const visual = objects[id]?.visual
    if (visual?.type === 'mesh') disposeGeometry(visual.geometryId)
  }
}

type SceneState = {
  objects: SceneObjects
  // geometryRegistry에 형상이 새로 등록될 때마다 올린다. CAD 메시가 이 값을 구독해 다시 그린다.
  geometryRevision: number
  bumpGeometryRevision: () => void
  // 씬 전체를 바꾼다(프로젝트 열기). 기존 형상은 해제한다.
  replaceObjects: (objects: SceneObjects) => void
  // CAD 원본 파일 위치를 바꾼다(파일 다시 찾기).
  setCadFile: (id: string, absolutePath: string, fileName: string) => void
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
  geometryRevision: 0,
  bumpGeometryRevision: () => set((state) => ({ geometryRevision: state.geometryRevision + 1 })),
  replaceObjects: (objects) =>
    set((state) => {
      disposeMeshes(state.objects, Object.keys(state.objects))
      return { objects }
    }),
  setCadFile: (id, absolutePath, fileName) =>
    set((state) => {
      const object = state.objects[id]
      if (!object?.cad) return state
      return {
        objects: {
          ...state.objects,
          [id]: { ...object, cad: { ...object.cad, absolutePath, fileName } }
        }
      }
    }),
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
      const removed = subtreeIds(state.objects, id)
      disposeMeshes(state.objects, removed)
      const objects = { ...state.objects }
      for (const removedId of removed) delete objects[removedId]
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
