import { create } from 'zustand'
import { isLinkableJavaPath, normalizeLinkPath } from '../../../shared/teamCodePaths'
import { cadRootTransform, isValidAlignment, type CadAlignment } from '../cad/alignment'
import { NO_TUNABLE_EDITS, withTunable, type TunableEdits } from '../java/tunableEdits'
import { DEG, ROBOT_SIZE, TILE_SIZE } from './coordinates'
import {
  DEFAULT_FIELD_DOC,
  isFieldVisual,
  isSeasonString,
  sameFieldVisual,
  withFieldVisualFile,
  type FieldDoc,
  type FieldVisual
} from './fieldDoc'
import {
  DEFAULT_PROJECT_SETTINGS,
  isCodeUnits,
  sameCodeUnits,
  type CodeUnits,
  type ProjectSettings
} from './projectSettings'
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
  type JointSettings,
  type RobotHardwareSettings,
  type SceneObject,
  type SceneObjects,
  type ScriptLink,
  type Transform,
  type WheelSettings
} from './model'
import type { MassSettings, RigidbodySettings } from '../mass/types'
import {
  canHaveMass,
  canHaveRigidbody,
  sameMass,
  sameRigidbody,
  sanitizeMass,
  sanitizeRigidbody
} from './massSettings'
import { canHaveJoint, sameJoint, sanitizeJoint } from './joint'
import {
  canHaveColliders,
  canHaveRobotCollision,
  isWellFormedCollider,
  sameColliders,
  sameRobotCollision,
  sanitizeColliders,
  sanitizeRobotCollision,
  type ColliderSettings,
  type RobotCollisionSettings
} from './collider'
import { canHaveWheel, sameWheel, sanitizeWheel } from './wheel'
import {
  canHavePreload,
  isWellFormedPreload,
  samePreload,
  sanitizePreload,
  type PreloadSettings
} from './preload'

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
      !object.hardware &&
      !object.wheel &&
      !object.mass &&
      !object.rigidbody &&
      !object.joint &&
      !object.colliders?.length &&
      !object.collision &&
      !object.preload
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
  // 필드 설정(시즌, scene/fieldDoc.ts). 프로젝트 설정이라 씬 문서의 일부다(바꿀 때마다 새 객체)
  field: FieldDoc
  // 프로젝트 설정(코드 단위, scene/projectSettings.ts). 씬 문서의 일부다(바꿀 때마다 새 객체)
  settings: ProjectSettings
  // geometryRegistry에 형상이 새로 등록될 때마다 올린다. CAD 메시가 이 값을 구독해 다시 그린다.
  geometryRevision: number
  bumpGeometryRevision: () => void
  // 씬 전체를 바꾼다(프로젝트 열기). 저장하지 않은 튜닝 값도 같은 set()에서 버린다.
  // 형상(geometryRegistry)은 여기서 해제하지 않는다. 실행 취소 기록이 지운 오브젝트를 되살릴 수 있으므로
  // 어떤 기록에서도 쓰지 않게 된 형상을 editor/history.ts가 해제한다.
  // field·settings를 넘기면 같은 set()에서 함께 바꾸고, 없으면 그대로 둔다(objects만 바꾸는 시험).
  replaceObjects: (objects: SceneObjects, field?: FieldDoc, settings?: ProjectSettings) => void
  // 생성 코드의 코드 단위를 고른다(프로젝트 설정 창). 모양이 틀리거나 같은 값이면 그대로 둔다(빈 실행 취소 단계가
  // 생기지 않게). set() 한 번이라 실행 취소 한 단계다.
  setCodeUnits: (units: CodeUnits) => void
  // 필드 시즌을 고른다(Field 인스펙터). 시즌 문자열 모양이 아니거나 같은 값이면 그대로 둔다(실행 취소에 빈 단계가 생기지
  // 않게). 모르는 시즌 문자열도 받는다(보존).
  setFieldSeason: (season: string) => void
  // 필드 CAD 보기 설정(spec-4e §2.2)을 정하거나 null이면 뗀다(visual 키를 뺀다). 같은 값, 없는데 null, 모양이 틀린 값
  // (isFieldVisual)이면 그대로 둔다(빈 실행 취소 단계와 틀린 값이 저장되는 길을 막는다). set() 한 번이라 실행 취소 한 단계다.
  setFieldVisual: (visual: FieldVisual | null) => void
  // 필드 CAD 정렬을 바꾼다. visual이 없거나, 같은 글자 축이거나, 같은 값이면 그대로 둔다. 다시 읽지 않는다.
  setFieldVisualAlignment: (alignment: CadAlignment) => void
  // 필드 CAD 원본 위치를 바꾼다(프로젝트를 열 때 상대 경로로 찾은 위치, spec-4e §2.2). visual이 없거나 같으면 그대로 둔다.
  // 정렬은 그대로다. 열기의 suspendHistory·loading 동안만 부른다(setCadFile과 같은 쓰임).
  setFieldVisualFile: (absolutePath: string, fileName: string) => void
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
  // 바퀴(시뮬레이터 설정, scene/wheel.ts)를 붙이거나 바꾸고, null이면 뗀다. set() 한 번이라 실행 취소 한 단계다.
  // robot·CAD 루트·관절 오브젝트에는 붙이지 않는다. 범위 밖 수는 기본값으로 바꾼다(sanitizeWheel). 바뀐 것이 없으면 그대로 둔다.
  setWheel: (id: string, settings: WheelSettings | null) => void
  // 질량 설정(시뮬레이터 설정, mass/types.ts)을 붙이거나 바꾸고, null이면 뗀다. set() 한 번이라 실행 취소 한 단계다.
  // robot에는 붙이지 않는다(로봇은 setRobotRigidbody). 모르는 재질·범위 밖 수는 그 필드만 버린다(sanitizeMass).
  // 빈 설정 {}은 "질량 카드만 붙임"이라 그대로 둔다. 바뀐 것이 없으면 그대로 둔다(실행 취소에 빈 단계가 생기지 않게).
  setObjectMass: (id: string, settings: MassSettings | null) => void
  // 로봇의 Rigidbody(저울 무게·기본 재질). robot에만, null이거나 정리한 결과가 비면 뗀다(sanitizeRigidbody).
  setRobotRigidbody: (id: string, settings: RigidbodySettings | null) => void
  // 관절(시뮬레이터 설정, scene/model.ts의 JointSettings)을 붙이거나 바꾸고, null이면 뗀다. set() 한 번이라 실행 취소 한 단계다.
  // 붙일 수 없는 오브젝트(로봇, 바퀴가 있는 오브젝트, scene/joint.ts canHaveJoint)면 그대로 두고, 범위 밖 수는 기본값으로
  // 바꾼다(sanitizeJoint). 바뀐 것이 없으면 씬을 그대로 둔다(실행 취소에 빈 단계가 생기지 않게).
  setJoint: (id: string, settings: JointSettings | null) => void
  // 충돌체(Unity Collider, scene/collider.ts) 목록을 바꾼다. 비거나 null이면 키를 지운다. set() 한 번이라 실행 취소 한 단계다.
  // 없는 오브젝트·붙일 수 없는 오브젝트(canHaveColliders)·형식이 틀린 값(isWellFormedCollider)이면 그대로 두고, 범위 밖 수는
  // 자른다(sanitizeColliders). 바뀐 것이 없으면 씬을 그대로 둔다(실행 취소에 빈 단계가 생기지 않게).
  setColliders: (id: string, colliders: readonly ColliderSettings[] | null) => void
  // 로봇의 자기 충돌 설정([그래도 충돌] 짝). robot에만, 정리(sanitizeRobotCollision)한 결과가 비거나 null이면 키를 지운다.
  // 바뀐 것이 없으면 그대로 둔다.
  setRobotCollision: (id: string, settings: RobotCollisionSettings | null) => void
  // 프리로드 자리(Preload Slot, scene/preload.ts)를 붙이거나 바꾸고, null이면 뗀다. set() 한 번이라 실행 취소 한 단계다.
  // 둘 수 없는 오브젝트(로봇·CAD 루트, canHavePreload)·형식이 틀린 값(isWellFormedPreload)이면 그대로 두고, 범위 밖 수는
  // 자른다(sanitizePreload). 로봇마다 4개 한도는 Add Component(canAddPreload)와 세계 설명 빌더가 지킨다(하이어라키 편집으로
  // 넘을 수 있다). 바뀐 것이 없으면 씬을 그대로 둔다(실행 취소에 빈 단계가 생기지 않게).
  setPreload: (id: string, settings: PreloadSettings | null) => void
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
  field: DEFAULT_FIELD_DOC,
  settings: DEFAULT_PROJECT_SETTINGS,
  geometryRevision: 0,
  bumpGeometryRevision: () => set((state) => ({ geometryRevision: state.geometryRevision + 1 })),
  replaceObjects: (objects, field, settings) =>
    set({
      objects,
      tunables: NO_TUNABLE_EDITS,
      ...(field ? { field } : {}),
      ...(settings ? { settings } : {})
    }),
  setCodeUnits: (units) =>
    set((state) =>
      !isCodeUnits(units) || sameCodeUnits(units, state.settings.codeUnits)
        ? state
        : {
            settings: { ...state.settings, codeUnits: { length: units.length, angle: units.angle } }
          }
    ),
  setFieldSeason: (season) =>
    set((state) =>
      !isSeasonString(season) || season === state.field.season
        ? state
        : { field: { ...state.field, season } }
    ),
  setFieldVisual: (visual) =>
    set((state) => {
      if (visual === null) {
        if (!state.field.visual) return state
        const next = { ...state.field }
        delete next.visual
        return { field: next }
      }
      if (!isFieldVisual(visual) || sameFieldVisual(visual, state.field.visual)) return state
      // 네 칸만 골라 새 객체로 둔다(부르는 쪽 객체를 문서에 두지 않는다)
      const { fileName, absolutePath, upAxis, forwardAxis } = visual
      return { field: { ...state.field, visual: { fileName, absolutePath, upAxis, forwardAxis } } }
    }),
  setFieldVisualAlignment: (alignment) =>
    set((state) => {
      const { visual } = state.field
      if (!visual) return state
      const next = { ...visual, upAxis: alignment.upAxis, forwardAxis: alignment.forwardAxis }
      // 축 방향 모양과 글자가 다른지(isValidAlignment)는 isFieldVisual이 함께 본다
      if (!isFieldVisual(next) || sameFieldVisual(next, visual)) return state
      return { field: { ...state.field, visual: next } }
    }),
  setFieldVisualFile: (absolutePath, fileName) =>
    set((state) => {
      const { visual } = state.field
      if (!visual) return state
      const field = withFieldVisualFile(state.field, visual.absolutePath, absolutePath, fileName)
      return field === state.field ? state : { field }
    }),
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
  setWheel: (id, settings) =>
    set((state) => {
      const object = state.objects[id]
      // 떼기는 늘 받는다(붙일 수 없는 오브젝트에 남은 바퀴도 뗄 수 있게)
      if (!object || (settings && !canHaveWheel(object))) return state
      const wheel = settings ? sanitizeWheel(settings) : undefined
      if (sameWheel(object.wheel, wheel)) return state
      const next: SceneObject = { ...object, wheel }
      if (!wheel) delete next.wheel
      return { objects: { ...state.objects, [id]: next } }
    }),
  setObjectMass: (id, settings) =>
    set((state) => {
      const object = state.objects[id]
      if (!object || !canHaveMass(object)) return state
      const mass = settings ? sanitizeMass(settings) : undefined
      if (sameMass(object.mass, mass)) return state
      const next: SceneObject = { ...object, mass }
      if (!mass) delete next.mass
      return { objects: { ...state.objects, [id]: next } }
    }),
  setRobotRigidbody: (id, settings) =>
    set((state) => {
      const object = state.objects[id]
      if (!object || !canHaveRigidbody(object)) return state
      const rigidbody = (settings && sanitizeRigidbody(settings)) ?? undefined
      if (sameRigidbody(object.rigidbody, rigidbody)) return state
      const next: SceneObject = { ...object, rigidbody }
      if (!rigidbody) delete next.rigidbody
      return { objects: { ...state.objects, [id]: next } }
    }),
  setJoint: (id, settings) =>
    set((state) => {
      const object = state.objects[id]
      // 떼기는 늘 받는다(붙일 수 없는 오브젝트에 남은 관절도 뗄 수 있게)
      if (!object || (settings && !canHaveJoint(object))) return state
      const joint = settings ? sanitizeJoint(settings) : undefined
      if (sameJoint(object.joint, joint)) return state
      const next: SceneObject = { ...object, joint }
      if (!joint) delete next.joint
      return { objects: { ...state.objects, [id]: next } }
    }),
  setColliders: (id, list) =>
    set((state) => {
      const object = state.objects[id]
      if (!object || !canHaveColliders(object)) return state
      // 형식이 틀린 값(유한하지 않은 수, 모르는 종류·방향)은 받지 않는다(정리는 범위만 자른다)
      if (list && !list.every(isWellFormedCollider)) return state
      const sanitized = list ? sanitizeColliders(list) : []
      const colliders = sanitized.length > 0 ? sanitized : undefined
      if (sameColliders(object.colliders, colliders)) return state
      const next: SceneObject = { ...object, colliders }
      if (!colliders) delete next.colliders
      return { objects: { ...state.objects, [id]: next } }
    }),
  setRobotCollision: (id, settings) =>
    set((state) => {
      const object = state.objects[id]
      if (!object || !canHaveRobotCollision(object)) return state
      const collision = (settings && sanitizeRobotCollision(settings)) ?? undefined
      if (sameRobotCollision(object.collision, collision)) return state
      const next: SceneObject = { ...object, collision }
      if (!collision) delete next.collision
      return { objects: { ...state.objects, [id]: next } }
    }),
  setPreload: (id, settings) =>
    set((state) => {
      const object = state.objects[id]
      // 떼기는 늘 받는다(둘 수 없는 오브젝트에 남은 자리도 뗄 수 있게)
      if (!object || (settings && (!canHavePreload(object) || !isWellFormedPreload(settings))))
        return state
      const preload = settings ? sanitizePreload(settings) : undefined
      if (samePreload(object.preload, preload)) return state
      const next: SceneObject = { ...object, preload }
      if (!preload) delete next.preload
      return { objects: { ...state.objects, [id]: next } }
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
