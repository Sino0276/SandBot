import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

export type Vec3 = [number, number, number]

// 회전은 X(롤)·Y(피치)·Z(요) 라디안. 요 → 피치 → 롤 순으로 적용한다(Three.js Euler 순서 'ZYX').
export type Transform = { position: Vec3; rotation: Vec3 }

// group은 하이어라키에서 만든 빈 오브젝트(Unity의 Create Empty)다. 하드웨어가 있으면 생성 코드의 중첩 클래스가 된다.
export type SceneObjectKind = 'robot' | 'assembly' | 'part' | 'group'

// 씬에 그릴 모양. 없으면 보이지 않는 그룹이다.
export type ObjectVisual =
  // CAD에서 불러온 메시. 형상 데이터는 geometryRegistry에 있고(id는 cadGeometryId), 색은 0~1 sRGB.
  | { type: 'mesh'; geometryId: string; color: Vec3 }
  // CAD가 없을 때 쓰는 임시 모양
  | { type: 'placeholder'; shape: 'robot' | 'webcam' }

export type AxisDirection = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'

// CAD 루트 노드에만 있다. 이 노드의 transform은 CAD 좌표 → 로봇 좌표 정렬이다.
export type CadSource = {
  fileName: string
  // 이 PC에서의 원본 STEP 경로. 프로젝트 파일에는 프로젝트 기준 상대 경로도 함께 저장한다.
  absolutePath: string
  // CAD 좌표에서 로봇의 위쪽·앞쪽에 해당하는 축
  upAxis: AxisDirection
  forwardAxis: AxisDirection
  // CAD 좌표(미터)의 전체 경계 상자. 노드의 피벗은 이 상자의 중심이다.
  bounds: { min: Vec3; max: Vec3 }
  // 불러왔을 때의 메시 수. 다시 읽은 파일과 다르면 CAD가 바뀐 것이다.
  // meshIndexing이 'source'면 occt-import-js의 전체 메시 수(빈 메시 포함), 없으면 삼각형이 있는 메시 수.
  meshCount: number
  // 형상 id(cadGeometryId)의 메시 순번 방식. 'source'는 원래 순번(PROJECT_VERSION 3부터 새로 불러온 CAD).
  // 없으면 예전 방식(빈 메시를 빼고 다시 매긴 순번)이다.
  meshIndexing?: MeshIndexing
}

export type MeshIndexing = 'source' | 'packed'

// 장치를 꽂는 허브. Control Hub(주소 173)와 RS485로 연결한 Expansion Hub.
export type HubId = 'controlHub' | 'expansionHub'

// 파트에 붙이는 하드웨어 컴포넌트(모터, 서보, 센서 등). 종류별 정의는 hardware/catalog.ts에 있다.
export type HardwareComponent = {
  id: string
  // 카탈로그의 ComponentType
  type: string
  // 로봇 구성(Configuration) 이름. hardwareMap.get(..., name)과 구성 XML에 그대로 쓴다.
  name: string
  hub: HubId
  // 모터·서보·디지털·아날로그·엔코더 포트 번호, I2C 장치는 버스 번호. USB 장치는 쓰지 않는다.
  port: number
  // 종류별 속성(방향, 런 모드 등). 키와 값의 범위는 카탈로그가 정한다.
  props: Record<string, string | number>
}

// 로봇(최상위 robot 오브젝트)의 코드 생성 설정
export type RobotHardwareSettings = {
  // 생성할 Java 클래스 이름
  className: string
  // Driver Station에 보이는 로봇 구성 이름
  configName: string
  expansionHub: { enabled: boolean; address: number }
}

export type SceneObject = {
  id: string
  name: string
  kind: SceneObjectKind
  parentId: string | null
  // 부모 기준 로컬 변환. 부모가 없으면 필드 좌표계 기준이다.
  transform: Transform
  visual?: ObjectVisual
  cad?: CadSource
  components?: HardwareComponent[]
  // robot 오브젝트에만 있다. 없으면 기본값(robotHardwareSettings)을 쓴다.
  hardware?: RobotHardwareSettings
  // CAD에서 온 노드(assembly·part)를 그 CAD 루트 밖으로 옮겼을 때만 그 CAD 루트 id. group·robot에는 두지 않는다.
  // CAD 루트를 지우면 함께 지우고, CAD 루트의 변환(정렬)이 바뀌면 함께 움직인다.
  cadOrigin?: string
  // group에만 있다. 생성 코드의 중첩 클래스 이름(없으면 이름에서 만든다). 한글 이름 그룹처럼 이름을 클래스로 바꿀 수 없을 때 쓴다.
  codeClassName?: string
}

export type SceneObjects = Record<string, SceneObject>

// 계산용 기준 좌표계(로봇 중심 기준 위치, 센서 오프셋). 로봇 좌표계는 X 앞, Y 왼쪽, Z 위이고 원점은 로봇 중심 바닥이다.
export type ReferenceFrame = 'field' | 'robot'

const EULER_ORDER = 'ZYX'

export function transformToMatrix(transform: Transform): Matrix4 {
  const [rx, ry, rz] = transform.rotation
  const quaternion = new Quaternion().setFromEuler(new Euler(rx, ry, rz, EULER_ORDER))
  return new Matrix4().compose(new Vector3(...transform.position), quaternion, new Vector3(1, 1, 1))
}

// cos(피치)가 이보다 작으면 피치가 ±90°(짐벌 잠금)라 롤과 요를 나눌 수 없으므로 롤을 0으로 둔다(Three.js와 같은 값).
const GIMBAL_EPSILON = 1e-12

// ZYX 오일러 각을 직접 구한다. Three.js Euler.setFromRotationMatrix는 |m31| ≥ 0.9999999이면 짐벌 식으로 바꿔
// 피치 ±90° 근처에서 1.6e-4까지 틀린다(부모 바꾸기·CAD 정렬이 자주 지나는 영역).
// - 피치는 asin 대신 atan2로 구해 극 근처에서도 정확하다.
// - 요는 atan2(m21, m11)이다. 극 근처에서는 두 값이 작아 요가 덜 정확하지만, 롤을 "요를 되돌린 나머지 회전"
//   Rz(-요)·R = Ry(피치)·Rx(롤)의 크기 1짜리 원소에서 구하므로 요의 오차를 롤이 메워 행렬은 정확히 되돌아온다.
// 극에서 먼 곳에서는 Three.js와 반올림 오차 안에서 같은 값이다.
export function matrixToTransform(matrix: Matrix4): Transform {
  const position = new Vector3()
  const quaternion = new Quaternion()
  matrix.decompose(position, quaternion, new Vector3())
  // 열 우선 배열: m11 = e[0], m21 = e[1], m31 = e[2], m12 = e[4], m22 = e[5], m13 = e[8], m23 = e[9]
  const e = new Matrix4().makeRotationFromQuaternion(quaternion).elements
  const cosPitch = Math.hypot(e[0], e[1])
  const pitch = Math.atan2(-e[2], cosPitch)
  let rotation: Vec3
  if (cosPitch < GIMBAL_EPSILON) {
    rotation = [0, pitch, Math.atan2(-e[4], e[5])]
  } else {
    const yaw = Math.atan2(e[1], e[0])
    const cosYaw = Math.cos(yaw)
    const sinYaw = Math.sin(yaw)
    const roll = Math.atan2(sinYaw * e[8] - cosYaw * e[9], cosYaw * e[5] - sinYaw * e[4])
    rotation = [roll, pitch, yaw]
  }
  return { position: [position.x, position.y, position.z], rotation }
}

export function childrenOf(objects: SceneObjects, parentId: string | null): SceneObject[] {
  return Object.values(objects).filter((object) => object.parentId === parentId)
}

// 씬 문서마다 한 번 만드는 부모 id → 자식 목록(childrenOf와 같은 순서). 씬 뷰·하이어라키가 오브젝트마다
// childrenOf로 전체를 훑으면 큰 CAD(파트 수천 개)에서 씬이 바뀔 때마다 N²이 된다.
// 스토어의 objects처럼 바꾸지 않는(불변) 문서에만 쓴다. 만든 뒤 고친 문서에는 고치기 전 목록이 남는다.
const childIndexes = new WeakMap<SceneObjects, Map<string | null, SceneObject[]>>()
const NO_CHILDREN: readonly SceneObject[] = []

export function childrenInDocument(
  objects: SceneObjects,
  parentId: string | null
): readonly SceneObject[] {
  let index = childIndexes.get(objects)
  if (!index) {
    index = new Map()
    for (const object of Object.values(objects)) {
      const siblings = index.get(object.parentId)
      if (siblings) siblings.push(object)
      else index.set(object.parentId, [object])
    }
    childIndexes.set(objects, index)
  }
  return index.get(parentId) ?? NO_CHILDREN
}

export function worldMatrix(objects: SceneObjects, id: string): Matrix4 {
  const object = objects[id]
  const local = transformToMatrix(object.transform)
  return object.parentId ? worldMatrix(objects, object.parentId).multiply(local) : local
}

// 오브젝트가 속한 로봇(자기 자신 포함)의 id. 로봇에 속하지 않으면 null.
// 부모 순환은 프로젝트 파일 검증이 막지만, 여기서도 같은 오브젝트를 두 번 지나지 않는다.
export function findRobotId(objects: SceneObjects, id: string): string | null {
  const visited = new Set<string>()
  let current: SceneObject | undefined = objects[id]
  while (current && !visited.has(current.id)) {
    if (current.kind === 'robot') return current.id
    visited.add(current.id)
    current = current.parentId ? objects[current.parentId] : undefined
  }
  return null
}

// 기준 좌표계의 필드 기준 행렬. 로봇 기준인데 로봇에 속하지 않은 오브젝트는 필드 기준으로 대신한다.
export function frameMatrix(objects: SceneObjects, id: string, frame: ReferenceFrame): Matrix4 {
  const robotId = frame === 'robot' ? findRobotId(objects, id) : null
  return robotId ? worldMatrix(objects, robotId) : new Matrix4()
}

export function getTransformInFrame(
  objects: SceneObjects,
  id: string,
  frame: ReferenceFrame
): Transform {
  const relative = frameMatrix(objects, id, frame).invert().multiply(worldMatrix(objects, id))
  return matrixToTransform(relative)
}

// 필드 기준 행렬을 저장용(부모 기준) 로컬 변환으로 바꾼다
export function localTransformFromWorld(
  objects: SceneObjects,
  id: string,
  world: Matrix4
): Transform {
  const parentId = objects[id].parentId
  const local = parentId ? worldMatrix(objects, parentId).invert().multiply(world) : world
  return matrixToTransform(local)
}

// 최상위 로봇은 필드 바닥 위에서만 움직인다(높이·롤·피치 0).
export function constrainTransform(object: SceneObject, transform: Transform): Transform {
  if (object.kind !== 'robot' || object.parentId !== null) return transform
  return {
    position: [transform.position[0], transform.position[1], 0],
    rotation: [0, 0, transform.rotation[2]]
  }
}

// 자기 자신과 모든 하위 오브젝트의 id(불변 씬 문서에만. childrenInDocument 참고)
export function subtreeIds(objects: SceneObjects, id: string): string[] {
  return [id, ...childrenInDocument(objects, id).flatMap((child) => subtreeIds(objects, child.id))]
}

// 부모부터 최상위까지의 id(자기 자신 제외). 순환이 있으면 처음 다시 만나는 곳에서 멈춘다.
export function ancestorIds(objects: SceneObjects, id: string): string[] {
  const ids: string[] = []
  const visited = new Set([id])
  let parentId = objects[id]?.parentId
  while (parentId && !visited.has(parentId)) {
    ids.push(parentId)
    visited.add(parentId)
    parentId = objects[parentId]?.parentId
  }
  return ids
}

// id가 rootId 자신이거나 그 하위인지(부모를 따라 올라가며 확인하므로 childrenInDocument가 필요 없다)
export function isInSubtree(objects: SceneObjects, id: string, rootId: string): boolean {
  return id === rootId || ancestorIds(objects, id).includes(rootId)
}

// 생성 코드의 범위(중첩 클래스)가 되는 오브젝트인지. 지금은 group뿐이고, 나중에 어셈블리도 켤 수 있게 한곳에서 정한다.
export function isCodeGroup(object: SceneObject): boolean {
  return object.kind === 'group'
}
