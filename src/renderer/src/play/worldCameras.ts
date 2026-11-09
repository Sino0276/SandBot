import type { CameraModelId } from '../../../shared/sim/cameraData'
import {
  MAX_WORLD_CAMERAS,
  type SensorMount,
  type SimCameraSpec
} from '../../../shared/sim/worldSpec'
import { NOMINAL_VOLTAGE } from '../../../shared/sim/motorOutputs'
import { isInConfiguration, robotComponents, type ComponentEntry } from '../hardware/components'
import {
  cameraAim,
  cameraAimRotation,
  cameraModelOf,
  robotFramePose,
  SENSOR_HOUSING_WARN,
  sensorMountInRobot,
  type LocalBoundsLookup,
  type SensorMountInRobot
} from '../hardware/mounting'
import { sidecarDeviceName } from '../hardware/naming'
import type { SelfHit } from '../editor/hardware/sensorSelfHit'
import { findRobotId, type SceneObjects } from '../scene/model'
import type { JointBuildResult } from './worldJoints'
import { mountInJoint } from './worldSensors'
import { buildWorldSpec, type WorldSpecResult, type WorldWarning } from './worldSpec'

// 세계 설명의 웹캠 목록(4d, spec-4d §4 C). 빌더(buildWorldCameras)와 인스펙터 편집 자세 줄·씬 뷰 기즈모가 같은 거르기
// (cameraExclusions)를 쓴다(4c sensorExclusions와 같은 꼴, 빠진 웹캠을 정상처럼 보이지 않게).
//
// 장착은 4c와 같다: 렌즈 위치는 하우징 앞면(hardware/mounting.ts sensorMountInRobot, 광축 투영은 롤과 관계없다)이고
// 회전만 롤까지 넓힌 cameraAimRotation이다. 몸체는 세계 설명 관절과 같은 규칙(buildWorldJoints의 bodyOf)이고 관절 하위
// 웹캠(터렛·팔)은 그 관절 몸체에 붙는다(play/worldSensors.ts mountInJoint).

// 세계 설명에서 빠지는 이유: 시리얼이 없어 구성 XML에 들어가지 않음, 장치 이름이 비었음, 이미 쓴 장치 이름(모터·허브·다른
// 장치·센서·앞 웹캠), MAX_WORLD_CAMERAS를 넘음, 로봇 밖
export type CameraExclusion =
  'notConfigured' | 'emptyName' | 'duplicateName' | 'tooMany' | 'outsideRobot'

// 세계 설명에 들어간 웹캠 하나(세계 설명 cameras 순서 = 하이어라키 순서). inRobot은 로봇 좌표 장착(편집 자세, 회전은
// cameraAimRotation — 하우징 판단·경고·자기 가림에 쓴다), mount는 세계 설명에 넣은 몸체 틀 장착이다.
export type WorldCameraEntry = {
  objectId: string
  componentId: string
  // 컴포넌트의 구성 이름(Console 경고에 그대로 보인다)
  name: string
  device: string
  body: number
  mount: SensorMount
  inRobot: SensorMountInRobot
  model: CameraModelId
}

type Classified = {
  // 받아들인 웹캠(하이어라키 순서)
  accepted: ComponentEntry[]
  exclusions: Map<string, CameraExclusion>
  warnings: WorldWarning[]
}

// 한 곳의 거르기 규칙(빌더와 cameraExclusions가 같이 쓴다). 웹캠은 하이어라키 순서로 이 순서로 본다:
// - notConfigured: 시리얼이 없어 구성 XML에 들어가지 않음(isInConfiguration, 경고 worldCameraNotConfigured). 사이드카
//   hardwareMap에 그 장치가 없으므로 이름을 차지하지 않는다
// - emptyName·duplicateName: 장치 이름(sidecarDeviceName)이 비었거나 usedDevices·앞 웹캠과 같음(경고 worldDuplicateCamera)
// - outsideRobot: 로봇 밖(경고 없음, 4c와 같음)
// - tooMany: 이미 MAX_WORLD_CAMERAS개(경고 worldTooManyCameras 한 번, 이름을 차지하지 않는다)
function classifyCameras(
  objects: SceneObjects,
  robotId: string,
  entries: readonly ComponentEntry[],
  usedDevices: ReadonlySet<string>
): Classified {
  const used = new Set(usedDevices)
  const accepted: ComponentEntry[] = []
  const exclusions = new Map<string, CameraExclusion>()
  const warnings: WorldWarning[] = []
  let warnedFull = false
  for (const entry of entries) {
    const { component, objectId } = entry
    if (component.type !== 'webcam') continue
    if (!isInConfiguration(component)) {
      exclusions.set(component.id, 'notConfigured')
      warnings.push({ key: 'worldCameraNotConfigured', params: { name: component.name } })
      continue
    }
    const device = sidecarDeviceName(component.name)
    if (!device || used.has(device)) {
      exclusions.set(component.id, device ? 'duplicateName' : 'emptyName')
      warnings.push({ key: 'worldDuplicateCamera', params: { name: component.name } })
      continue
    }
    if (findRobotId(objects, objectId) !== robotId || robotFramePose(objects, objectId) === null) {
      exclusions.set(component.id, 'outsideRobot')
      continue
    }
    if (accepted.length === MAX_WORLD_CAMERAS) {
      exclusions.set(component.id, 'tooMany')
      if (!warnedFull)
        warnings.push({ key: 'worldTooManyCameras', params: { max: MAX_WORLD_CAMERAS } })
      warnedFull = true
      continue
    }
    used.add(device)
    accepted.push(entry)
  }
  return { accepted, exclusions, warnings }
}

// 문서·로봇마다 거르기 결과(씬 문서는 불변이라 문서로 캐시한다, 인스펙터 줄·기즈모가 그릴 때마다 부른다)
const exclusionCache = new WeakMap<
  SceneObjects,
  Map<string, ReadonlyMap<string, CameraExclusion>>
>()

// 그 로봇의 webcam 컴포넌트 중 세계 설명에서 빠지는 것(컴포넌트 id → 이유). usedDevices는 빌더가 실제로 낸 장치 이름
// (worldUsedDevices + 받아들인 거리·컬러 센서)이고, 생략하면 같은 목록을 빌더로 만든다(buildWorldSpec이 낸 거르기 그대로라
// 빌더와 결과가 늘 같다).
export function cameraExclusions(
  objects: SceneObjects,
  robotId: string,
  usedDevices?: ReadonlySet<string>
): Map<string, CameraExclusion> {
  if (usedDevices)
    return classifyCameras(objects, robotId, robotComponents(objects, robotId), usedDevices)
      .exclusions
  let byRobot = exclusionCache.get(objects)
  if (!byRobot) {
    byRobot = new Map()
    exclusionCache.set(objects, byRobot)
  }
  let cached = byRobot.get(robotId)
  if (!cached) {
    try {
      cached = buildWorldSpec(objects, robotId, {
        batteryVoltage: NOMINAL_VOLTAGE
      }).cameraExclusions
    } catch {
      // 세계 설명을 만들지 못하는 씬(예상하지 못한 오류)에서는 웹캠끼리만 거른다
      cached = classifyCameras(
        objects,
        robotId,
        robotComponents(objects, robotId),
        new Set()
      ).exclusions
    }
    byRobot.set(robotId, cached)
  }
  return new Map(cached)
}

export type WorldCamerasInput = {
  objects: SceneObjects
  robotId: string
  // 로봇의 하드웨어 컴포넌트(카탈로그에 있는 종류만, 하이어라키 순서)
  entries: readonly ComponentEntry[]
  joints: Pick<JointBuildResult, 'bodyOf' | 'frames'>
  // 형상 조회. null이면 하우징 앞면 대신 피벗을 쓴다(로봇 카드 경로)
  bounds: LocalBoundsLookup | null
  // worldUsedDevices + 받아들인 거리·컬러 센서 장치 이름(빌더가 실제로 낸 목록)
  usedDevices: ReadonlySet<string>
}

export type WorldCamerasResult = {
  cameras: SimCameraSpec[]
  // 세계 설명 cameras 순서
  entries: WorldCameraEntry[]
  exclusions: Map<string, CameraExclusion>
  warnings: WorldWarning[]
}

// 로봇 좌표의 웹캠 장착(편집 자세): 렌즈 위치 = 하우징 앞면(광축 투영, 롤과 관계없음), 회전 = cameraAimRotation.
// 로봇 밖이면 null. 빌더·인스펙터 편집 자세 줄·기즈모가 같이 쓴다.
export function cameraMountInRobot(
  objects: SceneObjects,
  objectId: string,
  props: Parameters<typeof cameraAim>[0],
  bounds: LocalBoundsLookup | null
): SensorMountInRobot | null {
  const aim = cameraAim(props)
  const front = sensorMountInRobot(objects, objectId, { yaw: aim.yaw, pitch: aim.pitch }, bounds)
  return front ? { ...front, rotation: cameraAimRotation(aim) } : null
}

// 세계 설명의 웹캠 목록(spec-4d §4 C 빌더). 그 로봇의 webcam 컴포넌트를 하이어라키 순서로 거르고(classifyCameras), 받아들인
// 것마다 로봇 좌표 장착을 몸체 틀로 옮긴다(body −1은 로봇 좌표 그대로). 모델은 cameraModelOf(틀리면 C920).
export function buildWorldCameras(input: WorldCamerasInput): WorldCamerasResult {
  const { objects, robotId, entries, joints, bounds, usedDevices } = input
  const classified = classifyCameras(objects, robotId, entries, usedDevices)
  const exclusions = new Map(classified.exclusions)
  const result: WorldCameraEntry[] = []
  for (const { objectId, component } of classified.accepted) {
    const inRobot = cameraMountInRobot(objects, objectId, component.props, bounds)
    // classifyCameras가 로봇 밖을 이미 뺐다(sensorMountInRobot도 같은 판단)
    if (!inRobot) {
      exclusions.set(component.id, 'outsideRobot')
      continue
    }
    const body = joints.bodyOf.get(objectId) ?? -1
    const frame = body >= 0 ? joints.frames[body] : undefined
    const mount: SensorMount = frame
      ? { body, ...mountInJoint(frame, inRobot) }
      : { body: -1, position: { ...inRobot.position }, rotation: { ...inRobot.rotation } }
    result.push({
      objectId,
      componentId: component.id,
      name: component.name,
      device: sidecarDeviceName(component.name),
      body: mount.body,
      mount,
      inRobot,
      model: cameraModelOf(component.props)
    })
  }
  return {
    cameras: result.map((camera) => ({
      device: camera.device,
      mount: {
        body: camera.mount.body,
        position: { ...camera.mount.position },
        rotation: { ...camera.mount.rotation }
      },
      model: camera.model
    })),
    entries: result,
    exclusions,
    warnings: classified.warnings
  }
}

// 자기 가림 판정(INIT은 editor/hardware/cameraSelfHit.ts를 넘기고 시험은 이중을 넘긴다). axis만 Console에 알린다(partial은
// 인스펙터 줄만).
export type CameraSelfHitCheck = (camera: WorldCameraEntry) => SelfHit | null

// INIT의 웹캠 Console 경고(spec-4d §4 C, playActions.worldFor가 센서 경고 뒤에). 형상 조회를 넘긴 빌더 결과에만 쓴다(로봇
// 카드 경로는 형상이 없어 내지 않는다). 웹캠은 하이어라키 순서(세계 설명 cameras 순서)이고 웹캠마다 이 순서다:
// - worldCameraOnRobot: robot·CAD 루트에 붙음(피벗을 렌즈로)
// - worldCameraNoHousing: 형상이 없거나 읽는 중이라 피벗을 렌즈로(robot·CAD 루트가 아닐 때)
// - worldCameraFarHousing { distance }: 렌즈(하우징 앞면)가 피벗에서 SENSOR_HOUSING_WARN보다 멂(distance는 표시 단위 글자)
// - worldCameraSelfHit { part }: 자기 로봇 파트가 광축을 가림
// spec이 없으면 그대로 둔다(시뮬레이터 없이 실행).
export function withCameraWarnings(
  result: WorldSpecResult,
  objects: SceneObjects,
  formatDistance: (meters: number) => string,
  selfHit: CameraSelfHitCheck
): WorldSpecResult {
  if (!result.spec) return result
  const warnings = [...result.warnings]
  for (const camera of result.cameras) {
    const object = objects[camera.objectId]
    const name = camera.name
    if (object?.kind === 'robot' || !!object?.cad)
      warnings.push({ key: 'worldCameraOnRobot', params: { name } })
    else if (camera.inRobot.housing === 'pivot')
      warnings.push({ key: 'worldCameraNoHousing', params: { name } })
    if (camera.inRobot.pivotOffset > SENSOR_HOUSING_WARN)
      warnings.push({
        key: 'worldCameraFarHousing',
        params: { name, distance: formatDistance(camera.inRobot.pivotOffset) }
      })
    const hit = selfHit(camera)
    if (hit?.kind === 'axis')
      warnings.push({
        key: 'worldCameraSelfHit',
        params: { name, part: objects[hit.partId]?.name ?? hit.partId }
      })
  }
  return { ...result, warnings }
}

// 실행 상태 run.cameras(세계 설명 cameras 순서, spec-4d §2)
export function runCamerasOf(result: Pick<WorldSpecResult, 'spec' | 'cameras'>): {
  objectId: string
  componentId: string
  body: number
  mount: SensorMount
  model: CameraModelId
}[] {
  return (result.spec ? result.cameras : []).map((camera) => ({
    objectId: camera.objectId,
    componentId: camera.componentId,
    body: camera.body,
    mount: camera.mount,
    model: camera.model
  }))
}
