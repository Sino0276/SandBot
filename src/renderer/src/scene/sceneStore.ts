import { create } from 'zustand'
import { cadRootTransform, isValidAlignment, type CadAlignment } from '../cad/alignment'
import { DEG, ROBOT_SIZE, TILE_SIZE } from './coordinates'
import {
  constrainTransform,
  subtreeIds,
  type HardwareComponent,
  type RobotHardwareSettings,
  type SceneObject,
  type SceneObjects,
  type Transform
} from './model'

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

// 임시 씬(임시 모양만 있고 하드웨어를 붙이지 않은 상태). 이때만 첫 STEP 임포트가 씬을 비우고, 변경도 저장 대상으로 치지 않는다.
export function isPlaceholderScene(objects: SceneObjects): boolean {
  return Object.values(objects).every(
    (object) =>
      object.visual?.type === 'placeholder' && !object.components?.length && !object.hardware
  )
}

// 오브젝트 하나만 바꾼 새 objects. 없는 오브젝트면 null.
function updateObject(
  objects: SceneObjects,
  id: string,
  update: (object: SceneObject) => SceneObject
): SceneObjects | null {
  const object = objects[id]
  return object ? { ...objects, [id]: update(object) } : null
}

type SceneState = {
  objects: SceneObjects
  // geometryRegistry에 형상이 새로 등록될 때마다 올린다. CAD 메시가 이 값을 구독해 다시 그린다.
  geometryRevision: number
  bumpGeometryRevision: () => void
  // 씬 전체를 바꾼다(프로젝트 열기).
  // 형상(geometryRegistry)은 여기서 해제하지 않는다. 실행 취소 기록이 지운 오브젝트를 되살릴 수 있으므로
  // 어떤 기록에서도 쓰지 않게 된 형상을 editor/history.ts가 해제한다.
  replaceObjects: (objects: SceneObjects) => void
  // CAD 원본 파일 위치를 바꾼다(파일 다시 찾기).
  setCadFile: (id: string, absolutePath: string, fileName: string) => void
  // 저장용 로컬 변환을 설정한다. 오브젝트 종류별 제약(예: 로봇은 바닥 평면)을 적용한다.
  setLocalTransform: (id: string, transform: Transform) => void
  // 오브젝트들을 추가한다. 씬에 임시 오브젝트만 있으면 그것들은 지운다.
  addObjects: (objects: SceneObjects) => void
  // 오브젝트와 그 하위를 지운다(형상 해제는 editor/history.ts).
  removeObject: (id: string) => void
  // CAD 루트의 방향(위·앞 축)을 바꾸고 바닥 중심 맞춤을 다시 계산한다.
  setCadAlignment: (id: string, alignment: CadAlignment) => void
  // 하드웨어 컴포넌트. 변경할 때마다 새 objects를 만들어야 변경 추적(dirty)과 다시 그리기가 동작한다.
  addComponent: (objectId: string, component: HardwareComponent) => void
  updateComponent: (
    objectId: string,
    componentId: string,
    patch: Partial<HardwareComponent>
  ) => void
  removeComponent: (objectId: string, componentId: string) => void
  setRobotHardware: (robotId: string, settings: RobotHardwareSettings) => void
}

export const useSceneStore = create<SceneState>()((set) => ({
  objects: PLACEHOLDER_SCENE,
  geometryRevision: 0,
  bumpGeometryRevision: () => set((state) => ({ geometryRevision: state.geometryRevision + 1 })),
  replaceObjects: (objects) => set({ objects }),
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
    }),
  addComponent: (objectId, component) =>
    set((state) => {
      const objects = updateObject(state.objects, objectId, (object) => ({
        ...object,
        components: [...(object.components ?? []), component]
      }))
      return objects ? { objects } : state
    }),
  updateComponent: (objectId, componentId, patch) =>
    set((state) => {
      const objects = updateObject(state.objects, objectId, (object) => ({
        ...object,
        components: (object.components ?? []).map((component) =>
          component.id === componentId
            ? { ...component, ...patch, props: { ...component.props, ...patch.props } }
            : component
        )
      }))
      return objects ? { objects } : state
    }),
  removeComponent: (objectId, componentId) =>
    set((state) => {
      const objects = updateObject(state.objects, objectId, (object) => ({
        ...object,
        components: (object.components ?? []).filter((component) => component.id !== componentId)
      }))
      return objects ? { objects } : state
    }),
  setRobotHardware: (robotId, settings) =>
    set((state) => {
      const objects = updateObject(state.objects, robotId, (object) =>
        object.kind === 'robot' ? { ...object, hardware: settings } : object
      )
      return objects ? { objects } : state
    })
}))
