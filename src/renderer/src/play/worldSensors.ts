import { Euler, Matrix4, Vector3 } from 'three'
import { readColorSensor } from '../../../shared/sim/colorSensor'
import { raycasterFor, SURFACE_TOLERANCE } from '../../../shared/sim/fieldRaycast'
import { readRangeSensor, TOF_WHITE_RANGE } from '../../../shared/sim/rangeSensor'
import type { SeasonId } from '../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../shared/sim/seasons/seasons'
import { planarFrame, sensorPose } from '../../../shared/sim/sensorFrame'
import {
  MAX_WORLD_SENSORS,
  type SensorMount,
  type SimColorSensorSpec,
  type SimDistanceSensorSpec,
  type WorldSpec
} from '../../../shared/sim/worldSpec'
import { NOMINAL_VOLTAGE } from '../../../shared/sim/motorOutputs'
import { robotComponents, type ComponentEntry } from '../hardware/components'
import {
  robotFramePose,
  SENSOR_HOUSING_WARN,
  sensorAim,
  sensorMountInRobot,
  type LocalBoundsLookup,
  type SensorComponentType,
  type SensorMountInRobot
} from '../hardware/mounting'
import { sidecarDeviceName } from '../hardware/naming'
import type { SelfHit } from '../editor/hardware/sensorSelfHit'
import { findRobotId, matrixToTransform, type SceneObjects } from '../scene/model'
import type { JointBuildResult } from './worldJoints'
import { buildWorldSpec, type WorldWarning, type WorldSpecResult } from './worldSpec'

// 세계 설명의 거리·컬러 센서 목록(4c, spec-4c §1.2·§3). 빌더(buildWorldSensors)와 인스펙터 값 줄·씬 뷰 기즈모가 같은
// 거르기(sensorExclusions)를 쓴다(빠진 센서를 정상처럼 보이지 않게, U9).
//
// 장착은 로봇 좌표 장착(hardware/mounting.ts sensorMountInRobot: 하우징 앞면, 로봇 좌표 조준)을 센서가 속한 몸체 틀로 옮긴
// 것이다. 몸체는 세계 설명 관절과 같은 규칙(buildWorldJoints의 bodyOf: 가장 가까운 자신·상위 관절, 한도로 뺀 관절의 하위는
// 가까운 남은 관절)이고, 관절 하위 센서는 그 관절 몸체에 붙어 관절과 함께 움직인다.

// 세계 설명에서 빠지는 이유: 장치 이름이 비었음, 이미 쓴 장치 이름(모터·허브·다른 장치·앞 센서), 목록마다
// MAX_WORLD_SENSORS를 넘음, 로봇 밖
export type SensorExclusion = 'emptyName' | 'duplicateName' | 'tooMany' | 'outsideRobot'

export type WorldSensorKind = 'distance' | 'color'

const SENSOR_KINDS: Readonly<Record<SensorComponentType, WorldSensorKind>> = {
  distanceSensor: 'distance',
  colorSensor: 'color'
}

const isSensorType = (type: string): type is SensorComponentType =>
  type === 'distanceSensor' || type === 'colorSensor'

// 세계 설명에 들어간 센서 하나(세계 설명 목록 순서: distanceSensors 다음 colorSensors). inRobot은 로봇 좌표 장착(편집 자세,
// 하우징 판단·경고·자기 가림에 쓴다), mount는 세계 설명에 넣은 몸체 틀 장착이다.
export type WorldSensorEntry = {
  objectId: string
  componentId: string
  kind: WorldSensorKind
  // 컴포넌트의 구성 이름(Console 경고에 그대로 보인다)
  name: string
  device: string
  // 하이어라키 순번(로봇 컴포넌트 중 센서끼리의 순서, Console 경고를 이 순서로 낸다)
  order: number
  body: number
  mount: SensorMount
  inRobot: SensorMountInRobot
}

// 거르기 결과: 목록마다 받아들인 센서(하이어라키 순서)와 빠진 것, 그 경고
type Classified = {
  accepted: Record<WorldSensorKind, ComponentEntry[]>
  // 받아들인 컴포넌트 id → 센서끼리의 하이어라키 순번
  order: Map<string, number>
  exclusions: Map<string, SensorExclusion>
  warnings: WorldWarning[]
}

// 한 곳의 거르기 규칙(빌더와 sensorExclusions가 같이 쓴다). 센서는 하이어라키 순서로 보며, 장치 이름(sidecarDeviceName)이
// 비었으면 emptyName, usedDevices나 앞 센서와 같으면 duplicateName(둘 다 worldDuplicateSensor), 로봇 밖이면 outsideRobot,
// 그 목록이 이미 MAX_WORLD_SENSORS개면 tooMany(목록마다 경고 한 번, 그 이름은 차지하지 않는다). 받아들인 센서의 이름은
// 뒤 센서의 usedDevices에 더한다(세계 설명 검사 parseWorldSpec의 두 목록 이름 유일과 같다).
function classifySensors(
  objects: SceneObjects,
  robotId: string,
  entries: readonly ComponentEntry[],
  usedDevices: ReadonlySet<string>
): Classified {
  const used = new Set(usedDevices)
  const accepted: Classified['accepted'] = { distance: [], color: [] }
  const order = new Map<string, number>()
  const exclusions = new Map<string, SensorExclusion>()
  const warnings: WorldWarning[] = []
  const warnedFull = new Set<WorldSensorKind>()
  let index = 0
  for (const entry of entries) {
    const { component, objectId } = entry
    if (!isSensorType(component.type)) continue
    const kind = SENSOR_KINDS[component.type]
    const device = sidecarDeviceName(component.name)
    if (!device || used.has(device)) {
      exclusions.set(component.id, device ? 'duplicateName' : 'emptyName')
      warnings.push({ key: 'worldDuplicateSensor', params: { name: component.name } })
      continue
    }
    if (findRobotId(objects, objectId) !== robotId || robotFramePose(objects, objectId) === null) {
      exclusions.set(component.id, 'outsideRobot')
      continue
    }
    if (accepted[kind].length === MAX_WORLD_SENSORS) {
      exclusions.set(component.id, 'tooMany')
      if (!warnedFull.has(kind))
        warnings.push({
          key: kind === 'distance' ? 'worldTooManyDistanceSensors' : 'worldTooManyColorSensors',
          params: { max: MAX_WORLD_SENSORS }
        })
      warnedFull.add(kind)
      continue
    }
    used.add(device)
    accepted[kind].push(entry)
    order.set(component.id, index++)
  }
  return { accepted, order, exclusions, warnings }
}

// 문서·로봇마다 거르기 결과(씬 문서는 불변이라 문서로 캐시한다, 인스펙터 값 줄·기즈모가 그릴 때마다 부른다)
const exclusionCache = new WeakMap<
  SceneObjects,
  Map<string, ReadonlyMap<string, SensorExclusion>>
>()

// 그 로봇의 distanceSensor·colorSensor 컴포넌트 중 세계 설명에서 빠지는 것(컴포넌트 id → 이유). usedDevices는 빌더가
// 실제로 낸 장치 이름(모터·데드휠·Pinpoint·OTOS·IMU·관절 구동·리밋 스위치·허브)이고, 생략하면 같은 목록을 빌더로 만든다
// (buildWorldSpec이 낸 거르기 그대로라 빌더와 결과가 늘 같다. 질량·형상은 이름과 관계없어 넘기지 않는다).
export function sensorExclusions(
  objects: SceneObjects,
  robotId: string,
  usedDevices?: ReadonlySet<string>
): Map<string, SensorExclusion> {
  if (usedDevices)
    return classifySensors(objects, robotId, robotComponents(objects, robotId), usedDevices)
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
      }).sensorExclusions
    } catch {
      // 세계 설명을 만들지 못하는 씬(예상하지 못한 오류)에서는 센서끼리만 거른다
      cached = classifySensors(
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

// 세계 설명에 실제로 들어간 장치 이름(센서 이름이 겹치면 안 되는 것): 모터, 데드휠·Pinpoint·OTOS·IMU(한도로 자른 뒤),
// 관절 서보·CR 서보, 리밋 스위치, 허브. parseWorldSpec은 허브를 보지 않지만 같은 이름이면 시뮬레이터 입력 State에서 허브
// 항목에 센서 키가 섞이고 사이드카 SimDevices.add가 던진다(SimDevices.java:14, spec-4c §3 O3).
export function worldUsedDevices(
  spec: Pick<WorldSpec, 'hubs' | 'motors' | 'deadWheels' | 'pinpoints' | 'otos' | 'imus' | 'joints'>
): Set<string> {
  const used = new Set<string>()
  for (const list of [spec.motors, spec.deadWheels, spec.pinpoints, spec.otos, spec.imus])
    for (const device of list) used.add(device.device)
  for (const joint of spec.joints) {
    if (joint.drive.kind === 'servo' || joint.drive.kind === 'crServo') used.add(joint.drive.device)
    if (joint.drive.kind === 'motor') for (const device of joint.drive.devices) used.add(device)
    for (const limit of joint.switches) used.add(limit.device)
  }
  for (const hub of spec.hubs) used.add(hub)
  return used
}

export type WorldSensorsInput = {
  objects: SceneObjects
  robotId: string
  // 로봇의 하드웨어 컴포넌트(카탈로그에 있는 종류만, 하이어라키 순서)
  entries: readonly ComponentEntry[]
  joints: Pick<JointBuildResult, 'bodyOf' | 'frames'>
  // 형상 조회. null이면 하우징 앞면 대신 피벗을 쓴다(로봇 카드 경로)
  bounds: LocalBoundsLookup | null
  usedDevices: ReadonlySet<string>
}

export type WorldSensorsResult = {
  distanceSensors: SimDistanceSensorSpec[]
  colorSensors: SimColorSensorSpec[]
  // 세계 설명 목록 순서(distanceSensors 다음 colorSensors)
  sensors: WorldSensorEntry[]
  exclusions: Map<string, SensorExclusion>
  warnings: WorldWarning[]
}

// −0을 0으로(세계 설명·기준 해시가 −0을 다른 글자로 쓰지 않게)
const plain = (value: number): number => value + 0

// 로봇 좌표 장착을 관절 몸체 틀로: position_j = T_j⁻¹·p, rotation_j = ZYX(R_j⁻¹·R_aim)(matrixToTransform: three
// Euler('ZYX')와 같은 분해, 짐벌(컬러 센서 −90°)에서는 롤을 0으로 두고 같은 회전 행렬을 낸다). 웹캠 빌더(4d
// worldCameras.ts)도 같이 쓴다.
export function mountInJoint(
  frame: Matrix4,
  inRobot: SensorMountInRobot
): Pick<SensorMount, 'position' | 'rotation'> {
  const { position: p, rotation: r } = inRobot
  const robotPose = new Matrix4()
    .makeRotationFromEuler(new Euler(r.x, r.y, r.z, 'ZYX'))
    .setPosition(new Vector3(p.x, p.y, p.z))
  const local = matrixToTransform(frame.clone().invert().multiply(robotPose))
  return {
    position: {
      x: plain(local.position[0]),
      y: plain(local.position[1]),
      z: plain(local.position[2])
    },
    rotation: {
      x: plain(local.rotation[0]),
      y: plain(local.rotation[1]),
      z: plain(local.rotation[2])
    }
  }
}

// 세계 설명의 센서 목록(spec-4c §3). 그 로봇의 거리·컬러 센서 컴포넌트를 하이어라키 순서로 거르고(classifySensors),
// 받아들인 것마다 로봇 좌표 장착(sensorMountInRobot)을 몸체 틀로 옮긴다(body −1은 로봇 좌표 그대로).
export function buildWorldSensors(input: WorldSensorsInput): WorldSensorsResult {
  const { objects, robotId, entries, joints, bounds, usedDevices } = input
  const classified = classifySensors(objects, robotId, entries, usedDevices)
  const sensors: WorldSensorEntry[] = []
  const exclusions = new Map(classified.exclusions)
  for (const kind of ['distance', 'color'] as const) {
    for (const { objectId, component } of classified.accepted[kind]) {
      const type = component.type as SensorComponentType
      const inRobot = sensorMountInRobot(
        objects,
        objectId,
        sensorAim(type, component.props),
        bounds
      )
      // classifySensors가 로봇 밖을 이미 뺐다(sensorMountInRobot도 같은 판단)
      if (!inRobot) {
        exclusions.set(component.id, 'outsideRobot')
        continue
      }
      const body = joints.bodyOf.get(objectId) ?? -1
      const frame = body >= 0 ? joints.frames[body] : undefined
      let mount: SensorMount
      if (frame) {
        mount = { body, ...mountInJoint(frame, inRobot) }
      } else {
        mount = {
          body: -1,
          position: { ...inRobot.position },
          rotation: { ...inRobot.rotation }
        }
      }
      sensors.push({
        objectId,
        componentId: component.id,
        kind,
        name: component.name,
        device: sidecarDeviceName(component.name),
        order: classified.order.get(component.id) ?? 0,
        body: mount.body,
        mount,
        inRobot
      })
    }
  }
  const spec = (kind: WorldSensorKind): { device: string; mount: SensorMount }[] =>
    sensors
      .filter((sensor) => sensor.kind === kind)
      .map((sensor) => ({
        device: sensor.device,
        mount: {
          body: sensor.mount.body,
          position: { ...sensor.mount.position },
          rotation: { ...sensor.mount.rotation }
        }
      }))
  return {
    distanceSensors: spec('distance'),
    colorSensors: spec('color'),
    sensors,
    exclusions,
    warnings: classified.warnings
  }
}

// 자기 가림 검사의 reach(m, spec-4c §1.9): 편집 자세 값의 거리. 없으면 거리 센서는 TOF_WHITE_RANGE(1.2 m, 기본 프로필
// 최대 거리), 컬러 센서는 6 in(REV getDistance 상한, RevColorSensorV3)이다. 편집 자세(관절 q = 0)는 로봇 좌표 장착을 시작
// 자세에 둔 것이고 잡음은 끈다(인스펙터 값 줄과 같은 계산).
// 6 in × 0.0254 m/in(RevColorSensorV3.getDistance가 돌려주는 최대값, spec-4c §1.9)
export const COLOR_REACH = 6 * 0.0254
export function sensorSelfHitReach(
  spec: Pick<WorldSpec, 'robot'>,
  season: SeasonId,
  sensor: Pick<WorldSensorEntry, 'kind' | 'inRobot'>
): number {
  const caster = raycasterFor(resolveSeason(season))
  const pose = sensorPose(planarFrame(spec.robot.start), {
    body: -1,
    position: sensor.inRobot.position,
    rotation: sensor.inRobot.rotation
  })
  if (sensor.kind === 'distance') return readRangeSensor(caster, pose).distance ?? TOF_WHITE_RANGE
  return readColorSensor(caster, pose).distance ?? COLOR_REACH
}

// 자기 가림 판정(INIT은 editor/hardware/sensorSelfHit.ts를 넘기고 시험은 이중을 넘긴다). axis만 Console에 알린다(partial은
// 인스펙터 값 줄만).
export type SensorSelfHitCheck = (sensor: WorldSensorEntry, reachM: number) => SelfHit | null

// INIT의 센서 Console 경고(spec-4c §3, playActions.worldFor). 형상 조회를 넘긴 빌더 결과에만 쓴다(로봇 카드 경로는 형상이
// 없어 내지 않는다). 센서는 하이어라키 순서이고 센서마다 이 순서다:
// - worldSensorNoHousing: 형상이 없거나 읽는 중이라 피벗에서 잼(robot·CAD 루트가 아닐 때)
// - worldSensorOnRobot: robot·CAD 루트에 붙음
// - worldSensorFarHousing { distance }: 하우징 앞면이 피벗에서 SENSOR_HOUSING_WARN보다 멂(distance는 표시 단위 글자)
// - worldSensorBelowFloor: 원점(하우징 앞면, 로봇 좌표 z) < −SURFACE_TOLERANCE
// - worldSensorSelfHit { part }: 자기 로봇 파트가 축 광선을 가림
// season은 자기 가림 reach를 잴 필드다. 빌더 결과의 시즌은 늘 'none'이고 실행의 시즌은 withRunField가 나중에 넣으므로,
// INIT은 실행의 시즌을 넘긴다(인스펙터 값 줄과 같은 필드라야 Console과 값 줄의 판정이 같다). 생략하면 결과의 시즌이다.
// spec이 없으면 그대로 둔다(시뮬레이터 없이 실행).
export function withSensorWarnings(
  result: WorldSpecResult,
  objects: SceneObjects,
  formatDistance: (meters: number) => string,
  selfHit: SensorSelfHitCheck,
  season?: SeasonId
): WorldSpecResult {
  if (!result.spec) return result
  const spec = result.spec
  const reachSeason = season ?? spec.field.season
  const warnings = [...result.warnings]
  const ordered = [...result.sensors].sort((a, b) => a.order - b.order)
  for (const sensor of ordered) {
    const object = objects[sensor.objectId]
    const name = sensor.name
    const onRobot = object?.kind === 'robot' || !!object?.cad
    if (onRobot) warnings.push({ key: 'worldSensorOnRobot', params: { name } })
    else if (sensor.inRobot.housing === 'pivot')
      warnings.push({ key: 'worldSensorNoHousing', params: { name } })
    if (sensor.inRobot.pivotOffset > SENSOR_HOUSING_WARN)
      warnings.push({
        key: 'worldSensorFarHousing',
        params: { name, distance: formatDistance(sensor.inRobot.pivotOffset) }
      })
    if (sensor.inRobot.position.z < -SURFACE_TOLERANCE)
      warnings.push({ key: 'worldSensorBelowFloor', params: { name } })
    const hit = selfHit(sensor, sensorSelfHitReach(spec, reachSeason, sensor))
    if (hit?.kind === 'axis')
      warnings.push({
        key: 'worldSensorSelfHit',
        params: { name, part: objects[hit.partId]?.name ?? hit.partId }
      })
  }
  return { ...result, warnings }
}

// 실행의 센서 잡음(spec-4c §1.6): 개인 실행 설정 sensorNoise와 Hub 타이밍과 같은 시드 칸. 빌더는 끔으로 두고 INIT의
// worldFor가 넣는다(시즌의 withRunField와 같은 방식). spec이 없으면 그대로 둔다.
export function withSensorNoise(
  result: WorldSpecResult,
  settings: { sensorNoise: boolean; seed: number }
): WorldSpecResult {
  if (!result.spec) return result
  return {
    ...result,
    spec: { ...result.spec, noise: { enabled: settings.sensorNoise, seed: settings.seed } }
  }
}
