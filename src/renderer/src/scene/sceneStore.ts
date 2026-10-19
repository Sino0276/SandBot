import { create } from 'zustand'
import { isLinkableJavaPath, normalizeLinkPath } from '../../../shared/teamCodePaths'
import { cadRootTransform, isValidAlignment, type CadAlignment } from '../cad/alignment'
import { NO_TUNABLE_EDITS, withTunable, type TunableEdits } from '../java/tunableEdits'
import { DEG, ROBOT_SIZE, TILE_SIZE } from './coordinates'
import {
  carryCadDependents,
  createEmptyParent,
  createGroup,
  defaultGroupName,
  moveObjects,
  removeObjects,
  renameObject
} from './hierarchy'
import {
  constrainTransform,
  isCodeGroup,
  type HardwareComponent,
  type RobotHardwareSettings,
  type SceneObject,
  type SceneObjects,
  type ScriptLink,
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

// 임시 씬(임시 모양과 빈 그룹만 있고 하드웨어를 붙이지 않은 상태). 이때만 첫 STEP 임포트가 씬을 비우고,
// 변경도 저장 대상으로 치지 않는다.
export function isPlaceholderScene(objects: SceneObjects): boolean {
  return Object.values(objects).every(
    (object) =>
      (object.visual?.type === 'placeholder' || isCodeGroup(object)) &&
      !object.components?.length &&
      !object.scripts?.length &&
      !object.hardware
  )
}

// 스크립트 연결 목록을 바꾼 오브젝트. 목록이 비면 필드를 지운다(프로젝트 파일에 빈 배열을 쓰지 않게).
function withScripts(object: SceneObject, scripts: ScriptLink[]): SceneObject {
  const next: SceneObject = { ...object, scripts }
  if (scripts.length === 0) delete next.scripts
  return next
}

// 스토어에 넣을 연결(경로는 NFC). 연결할 수 없는 경로(TeamCode/src/main/java 밖, 생성 파일 폴더 등)면 null.
function linkToStore(link: ScriptLink): ScriptLink | null {
  const path = normalizeLinkPath(link.path)
  return isLinkableJavaPath(path) ? { path, className: link.className } : null
}

// STEP 임포트가 씬을 비우는 경우: 기본 임시 씬(임시 모양이 남아 있음)이나 빈 씬일 때만.
// 사용자가 만든 빈 그룹만 남은 씬(로봇을 모두 지운 뒤 등)은 비우지 않는다.
function replacesOnImport(objects: SceneObjects): boolean {
  const values = Object.values(objects)
  return (
    isPlaceholderScene(objects) &&
    (values.length === 0 || values.some((object) => object.visual?.type === 'placeholder'))
  )
}

// CAD 원본 위치를 바꾼 objects. CAD 루트가 없으면 그대로 돌려준다(실행 취소 기록 전체에도 적용한다).
export function withCadFile(
  objects: SceneObjects,
  id: string,
  absolutePath: string,
  fileName: string
): SceneObjects {
  const object = objects[id]
  if (!object?.cad) return objects
  return { ...objects, [id]: { ...object, cad: { ...object.cad, absolutePath, fileName } } }
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
  // 저장하지 않은 튜닝 값(java/tunableEdits.ts). 씬 문서의 일부라 실행 취소·dirty에 들어가지만 project.json에는
  // 쓰지 않는다(원본은 Java 파일이고, 저장할 때 그 파일에 쓴다). 연결을 지우거나 오브젝트를 지워도 남긴다
  // (실행 취소로 되살아날 수 있고, 저장이 없는 파일·필드를 처리한다).
  tunables: TunableEdits
  // geometryRegistry에 형상이 새로 등록될 때마다 올린다. CAD 메시가 이 값을 구독해 다시 그린다.
  geometryRevision: number
  bumpGeometryRevision: () => void
  // 씬 전체를 바꾼다(프로젝트 열기). 저장하지 않은 튜닝 값도 같은 set()에서 버린다.
  // 형상(geometryRegistry)은 여기서 해제하지 않는다. 실행 취소 기록이 지운 오브젝트를 되살릴 수 있으므로
  // 어떤 기록에서도 쓰지 않게 된 형상을 editor/history.ts가 해제한다.
  replaceObjects: (objects: SceneObjects) => void
  // 튜닝 값 하나를 바꾼다(인스펙터). value는 쓸 리터럴, diskLiteral은 인스펙터가 보여 준 지금 디스크 리터럴이고
  // 편집의 base가 된다(둘 다 normalizeLiteral로 맞춘 글자). value가 디스크 값과 같으면 항목을 지운다.
  // 바뀐 것이 없으면 그대로 둔다(실행 취소에 빈 단계가 생기지 않게).
  setTunable: (path: string, fieldId: string, value: string, diskLiteral: string) => void
  // CAD 원본 파일 위치를 바꾼다(파일 다시 찾기).
  setCadFile: (id: string, absolutePath: string, fileName: string) => void
  // 저장용 로컬 변환을 설정한다. 오브젝트 종류별 제약(예: 로봇은 바닥 평면)을 적용한다.
  // CAD 루트면 그 CAD에서 밖으로 옮긴 노드도 같은 만큼 따라 움직인다(carryCadDependents).
  setLocalTransform: (id: string, transform: Transform) => void
  // 오브젝트들을 추가한다. 씬에 임시 오브젝트만 있으면 그것들은 지운다.
  addObjects: (objects: SceneObjects) => void
  // 오브젝트들과 그 하위를 지운다. CAD 루트를 지우면 그 CAD에서 다른 곳으로 옮긴 노드도 지운다
  // (scene/hierarchy.ts removalIds). 형상 해제는 editor/history.ts가 한다.
  removeObjects: (ids: readonly string[]) => void
  removeObject: (id: string) => void
  // 하이어라키 편집(scene/hierarchy.ts). 각각 set() 한 번이라 실행 취소 한 단계다.
  // ids를 parentId 아래 beforeId 앞(없으면 마지막)으로 옮긴다. 월드 자세는 유지한다. 옮겼으면 true.
  moveObjects: (
    ids: readonly string[],
    parentId: string | null,
    beforeId?: string | null
  ) => boolean
  // 빈 그룹(Create Empty)을 만들고 id를 돌려준다. 이름이 없으면 defaultGroupName. 만들지 못하면 null.
  createGroup: (options: {
    parentId: string | null
    name?: string
    afterId?: string | null
    id?: string
  }) => string | null
  // 선택을 새 그룹으로 묶는다(Create Empty Parent). 새 그룹 id, 묶을 수 없으면 null.
  createEmptyParent: (
    ids: readonly string[],
    activeId: string | null,
    options?: { name?: string; id?: string }
  ) => string | null
  // 앞뒤 공백을 자른 이름으로 바꾼다. 빈 이름이면 바꾸지 않는다.
  renameObject: (id: string, name: string) => void
  // 그룹의 Java 클래스 이름 덮어쓰기(codeClassName). 앞뒤 공백을 자르고, 비었거나 null이면 지워 이름에서 만든다.
  // 그룹이 아니거나 바뀐 것이 없으면 그대로 둔다(실행 취소에 빈 단계가 생기지 않게).
  setCodeClassName: (id: string, className: string | null) => void
  // CAD 루트의 방향(위·앞 축)을 바꾸고 바닥 중심 맞춤을 다시 계산한다. 밖으로 옮긴 그 CAD의 노드도 따라 움직인다.
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
  // 스크립트 연결(인스펙터의 스크립트 카드). 각각 set() 한 번이라 실행 취소 한 단계이고, 바뀐 것이 없으면
  // (없는 오브젝트, 이미 있는 경로, 없는 연결, 연결할 수 없는 경로) 씬을 그대로 둔다(실행 취소에 빈 단계가 생기지 않게).
  // 같은 경로를 이미 연결했으면 더하지 않는다. 경로는 NFC로 바꿔 둔다(프로젝트 파일 읽기와 같은 규칙).
  addScriptLink: (objectId: string, link: ScriptLink) => void
  removeScriptLink: (objectId: string, path: string) => void
  // 경로를 못 찾은 연결을 새 파일로 바꾼다(같은 자리). 새 경로가 이미 다른 연결에 있으면 이전 연결만 지운다.
  relinkScript: (objectId: string, oldPath: string, link: ScriptLink) => void
}

export const useSceneStore = create<SceneState>()((set, get) => ({
  objects: PLACEHOLDER_SCENE,
  tunables: NO_TUNABLE_EDITS,
  geometryRevision: 0,
  bumpGeometryRevision: () => set((state) => ({ geometryRevision: state.geometryRevision + 1 })),
  replaceObjects: (objects) => set({ objects, tunables: NO_TUNABLE_EDITS }),
  setTunable: (path, fieldId, value, diskLiteral) =>
    set((state) => {
      const tunables = withTunable(state.tunables, path, fieldId, value, diskLiteral)
      return tunables === state.tunables ? state : { tunables }
    }),
  setCadFile: (id, absolutePath, fileName) =>
    set((state) => {
      const objects = withCadFile(state.objects, id, absolutePath, fileName)
      return objects === state.objects ? state : { objects }
    }),
  setLocalTransform: (id, transform) =>
    set((state) => {
      const object = state.objects[id]
      if (!object) return state
      const objects = {
        ...state.objects,
        [id]: { ...object, transform: constrainTransform(object, transform) }
      }
      return { objects: object.cad ? carryCadDependents(state.objects, objects, id) : objects }
    }),
  addObjects: (objects) =>
    set((state) => ({
      objects: { ...(replacesOnImport(state.objects) ? {} : state.objects), ...objects }
    })),
  removeObjects: (ids) =>
    set((state) => {
      const objects = removeObjects(state.objects, ids)
      return objects === state.objects ? state : { objects }
    }),
  removeObject: (id) => get().removeObjects([id]),
  moveObjects: (ids, parentId, beforeId = null) => {
    const before = get().objects
    const objects = moveObjects(before, ids, parentId, beforeId)
    if (objects === before) return false
    set({ objects })
    return true
  },
  createGroup: ({ parentId, name, afterId = null, id = crypto.randomUUID() }) => {
    const before = get().objects
    const objects = createGroup(before, {
      id,
      parentId,
      name: name?.trim() || defaultGroupName(before, parentId),
      afterId
    })
    if (objects === before) return null
    set({ objects })
    return id
  },
  createEmptyParent: (ids, activeId, { name, id = crypto.randomUUID() } = {}) => {
    const before = get().objects
    const parentId = ids.length > 0 ? (before[ids[0]]?.parentId ?? null) : null
    const objects = createEmptyParent(
      before,
      ids,
      activeId,
      id,
      name?.trim() || defaultGroupName(before, parentId, undefined, ids)
    )
    if (objects === before) return null
    set({ objects })
    return id
  },
  renameObject: (id, name) =>
    set((state) => {
      const objects = renameObject(state.objects, id, name)
      return objects === state.objects ? state : { objects }
    }),
  setCodeClassName: (id, className) =>
    set((state) => {
      const object = state.objects[id]
      const trimmed = className?.trim() || undefined
      if (!object || !isCodeGroup(object) || object.codeClassName === trimmed) return state
      const next: SceneObject = { ...object, codeClassName: trimmed }
      if (trimmed === undefined) delete next.codeClassName
      return { objects: { ...state.objects, [id]: next } }
    }),
  setCadAlignment: (id, alignment) =>
    set((state) => {
      const object = state.objects[id]
      if (!object?.cad || !isValidAlignment(alignment)) return state
      const objects = {
        ...state.objects,
        [id]: {
          ...object,
          transform: cadRootTransform(object.cad.bounds, alignment),
          cad: { ...object.cad, ...alignment }
        }
      }
      return { objects: carryCadDependents(state.objects, objects, id) }
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
    }),
  addScriptLink: (objectId, input) =>
    set((state) => {
      const object = state.objects[objectId]
      const scripts = object?.scripts ?? []
      const link = linkToStore(input)
      if (!object || !link || scripts.some((script) => script.path === link.path)) return state
      const next = withScripts(object, [...scripts, link])
      return { objects: { ...state.objects, [objectId]: next } }
    }),
  removeScriptLink: (objectId, path) =>
    set((state) => {
      const object = state.objects[objectId]
      const scripts = object?.scripts ?? []
      if (!object || !scripts.some((script) => script.path === path)) return state
      const next = withScripts(
        object,
        scripts.filter((script) => script.path !== path)
      )
      return { objects: { ...state.objects, [objectId]: next } }
    }),
  relinkScript: (objectId, oldPath, input) =>
    set((state) => {
      const object = state.objects[objectId]
      const scripts = object?.scripts ?? []
      const index = scripts.findIndex((script) => script.path === oldPath)
      const link = linkToStore(input)
      if (!object || index < 0 || !link) return state
      const current = scripts[index]
      if (current.path === link.path && current.className === link.className) return state
      const duplicate = scripts.some((script, i) => i !== index && script.path === link.path)
      const updated = duplicate
        ? scripts.filter((_, i) => i !== index)
        : scripts.map((script, i) => (i === index ? link : script))
      return { objects: { ...state.objects, [objectId]: withScripts(object, updated) } }
    })
}))
