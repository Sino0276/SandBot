import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

export type Vec3 = [number, number, number]

// 회전은 X(롤)·Y(피치)·Z(요) 라디안. 요 → 피치 → 롤 순으로 적용한다(Three.js Euler 순서 'ZYX').
export type Transform = { position: Vec3; rotation: Vec3 }

export type SceneObjectKind = 'robot' | 'assembly' | 'part'

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
  meshCount: number
}

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
}

export type SceneObjects = Record<string, SceneObject>

// 보기 기준 좌표계. 로봇 좌표계는 X 앞, Y 왼쪽, Z 위이고 원점은 로봇 중심 바닥이다.
export type ReferenceFrame = 'field' | 'robot'

const EULER_ORDER = 'ZYX'

export function transformToMatrix(transform: Transform): Matrix4 {
  const [rx, ry, rz] = transform.rotation
  const quaternion = new Quaternion().setFromEuler(new Euler(rx, ry, rz, EULER_ORDER))
  return new Matrix4().compose(new Vector3(...transform.position), quaternion, new Vector3(1, 1, 1))
}

export function matrixToTransform(matrix: Matrix4): Transform {
  const position = new Vector3()
  const quaternion = new Quaternion()
  matrix.decompose(position, quaternion, new Vector3())
  const euler = new Euler().setFromQuaternion(quaternion, EULER_ORDER)
  return { position: [position.x, position.y, position.z], rotation: [euler.x, euler.y, euler.z] }
}

export function childrenOf(objects: SceneObjects, parentId: string | null): SceneObject[] {
  return Object.values(objects).filter((object) => object.parentId === parentId)
}

export function worldMatrix(objects: SceneObjects, id: string): Matrix4 {
  const object = objects[id]
  const local = transformToMatrix(object.transform)
  return object.parentId ? worldMatrix(objects, object.parentId).multiply(local) : local
}

// 오브젝트가 속한 로봇(자기 자신 포함)의 id. 로봇에 속하지 않으면 null.
export function findRobotId(objects: SceneObjects, id: string): string | null {
  let current: SceneObject | undefined = objects[id]
  while (current) {
    if (current.kind === 'robot') return current.id
    current = current.parentId ? objects[current.parentId] : undefined
  }
  return null
}

// 로봇 기준 보기에서 따라갈 로봇: 선택한 오브젝트의 로봇, 없으면 씬의 첫 로봇.
export function activeRobotId(objects: SceneObjects, selectedId: string | null): string | null {
  const fromSelection = selectedId && objects[selectedId] ? findRobotId(objects, selectedId) : null
  return fromSelection ?? Object.values(objects).find((o) => o.kind === 'robot')?.id ?? null
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

// 기준 좌표계로 표현한 변환을 저장용 로컬 변환으로 바꾼다.
export function localTransformFromFrame(
  objects: SceneObjects,
  id: string,
  frame: ReferenceFrame,
  value: Transform
): Transform {
  return localTransformFromWorld(
    objects,
    id,
    frameMatrix(objects, id, frame).multiply(transformToMatrix(value))
  )
}

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

// 자기 자신과 모든 하위 오브젝트의 id
export function subtreeIds(objects: SceneObjects, id: string): string[] {
  return [id, ...childrenOf(objects, id).flatMap((child) => subtreeIds(objects, child.id))]
}

// 부모부터 최상위까지의 id(자기 자신 제외)
export function ancestorIds(objects: SceneObjects, id: string): string[] {
  const parentId = objects[id]?.parentId
  return parentId ? [parentId, ...ancestorIds(objects, parentId)] : []
}
