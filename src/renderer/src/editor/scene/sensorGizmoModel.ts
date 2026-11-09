import { Euler, Matrix4, Vector3 } from 'three'
import type { ColorReading } from '../../../../shared/sim/colorSensor'
import { COLOR_FOOTPRINT_SPREAD, COLOR_WHITE_BALANCE } from '../../../../shared/sim/colorSensor'
import type { FieldRaycaster } from '../../../../shared/sim/fieldRaycast'
import { TOF_RAYS, TOF_WHITE_RANGE, type RangeReading } from '../../../../shared/sim/rangeSensor'
import { sensorPoseFromMatrix, type SensorPose } from '../../../../shared/sim/sensorFrame'
import type { SensorMount, Vec3 as SimVec3 } from '../../../../shared/sim/worldSpec'
import {
  sensorAim,
  sensorMountInRobot,
  type LocalBoundsLookup,
  type SensorComponentType
} from '../../hardware/mounting'
import {
  displayRootOverride,
  runningRobotId,
  type PlayData,
  type PlayRunSensor
} from '../../play/playStore'
import { clampJointValue, jointMotionMatrix } from '../../scene/jointMotion'
import {
  ancestorIds,
  findRobotId,
  worldMatrix,
  type HardwareComponent,
  type RootOverride,
  type SceneObjects
} from '../../scene/model'
import { runLocksField } from '../field/fieldDisplay'
import { jointPreviewValue, type JointPreviewState } from '../joint/jointPreviewStore'
import { isHiddenInScene } from '../sceneVisibility'

type VisibilityState = Parameters<typeof isHiddenInScene>[0]

// 씬 뷰의 거리·컬러 센서 기즈모(4c, spec-4c §1.9)의 순수 모델. Unity가 고른 Light(spot)·Camera의 원뿔·절두체를 그리듯,
// 고른 오브젝트(다중 선택이면 전체)나 그 상위를 고르면 그 하위의 거리·컬러 센서를 그린다(ImuIndicators와 같은 규칙).
//
// 색(겹치지 않는 표시 색 목록, 색상각): 축 X·Y·Z 350°·84°·213°, 선택 220°, 로봇 무게중심 172°(#2dd4bf), IMU 292°(#d946ef)·
// 38°(#f59e0b), 관절 48°(#facc15). 거리 센서는 보라 258°, 컬러 센서 선은 중립(Unity Camera 절두체처럼 흰 회색)이고 발자국은
// 예측 색, 경고(자기 가림 점선)는 주황 19°(명세의 #f97316 25°는 관절 48°와 23°라 축 X 351°·관절 사이로 옮겼다. IMU USB
// 38°와는 19°라 점선 모양으로 구분), 빠진 센서는 회색 50% 불투명이다.
export const SENSOR_DISTANCE_COLOR = '#8b5cf6'
export const SENSOR_COLOR_LINE_COLOR = '#e2e8f0'
export const SENSOR_WARNING_COLOR = '#f9601a'
export const SENSOR_EXCLUDED_COLOR = '#64748b'
export const SENSOR_EXCLUDED_OPACITY = 0.5

const INCH = 0.0254
// 컬러 센서 축선의 길이 상한: REV RevColorSensorV3 getDistance의 maxDist 6 in(RevColorSensorV3.java)
export const COLOR_GIZMO_REACH = 6 * INCH
// 거리 센서 모선: 바깥 고리 중심각(TOF_RAYS의 마지막 고리, 11.1988°), 방위각 0°, 45°, …, 315°(센서 +Z부터 +Y 쪽)
export const GIZMO_GENERATRICES = 8
export const GIZMO_OUTER_THETA = TOF_RAYS[TOF_RAYS.length - 1].theta
// 컬러 센서 발자국 6광선: 축에서 atan(0.6) 기울고 방위각 0°, 60°, …, 300°(colorSensor.ts의 7점 발자국과 같은 배치)
export const COLOR_FOOTPRINT_RAYS = 6
export const COLOR_FOOTPRINT_THETA = Math.atan(COLOR_FOOTPRINT_SPREAD)

// 센서 틀 방향(ψ = 0이 +Z, +Y 쪽으로 감, rangeSensor.ts TOF_RAYS와 같은 규칙)
function coneDirection(theta: number, psi: number): SimVec3 {
  const s = Math.sin(theta)
  return { x: Math.cos(theta), y: s * Math.sin(psi), z: s * Math.cos(psi) }
}

// 센서 틀의 바깥 광선(거리: 모선 8, 컬러: 발자국 6). 기즈모와 자기 가림(editor/hardware/sensorSelfHit.ts)이 같이 쓴다.
export function sensorOuterRays(type: SensorComponentType): SimVec3[] {
  const count = type === 'distanceSensor' ? GIZMO_GENERATRICES : COLOR_FOOTPRINT_RAYS
  const theta = type === 'distanceSensor' ? GIZMO_OUTER_THETA : COLOR_FOOTPRINT_THETA
  return Array.from({ length: count }, (_, j) => coneDirection(theta, (2 * Math.PI * j) / count))
}

// ---- 대상 ----

export type SensorGizmoKind = 'distance' | 'color'

export type SensorGizmoTarget = {
  // 컴포넌트 id(React key)
  key: string
  objectId: string
  robotId: string
  type: SensorComponentType
  component: HardwareComponent
}

// 고른 오브젝트와 그 하위의 거리·컬러 센서(문서 순서). 로봇을 고르면 그 로봇의 센서가 모두. 센서 오브젝트 자신이 씬 뷰에서
// 숨겨졌으면(숨김·고립 보기 밖, sceneVisibility) 그리지 않는다. 로봇 밖 오브젝트의 센서는 장착이 없어 그리지 않는다.
export function sensorGizmoTargets(
  objects: SceneObjects,
  selectedIds: readonly string[],
  visibility: VisibilityState
): SensorGizmoTarget[] {
  const selected = new Set(selectedIds.filter((id) => objects[id]))
  if (selected.size === 0) return []
  const targets: SensorGizmoTarget[] = []
  for (const object of Object.values(objects)) {
    const sensors = (object.components ?? []).filter(
      (component) => component.type === 'distanceSensor' || component.type === 'colorSensor'
    )
    if (sensors.length === 0) continue
    if (!selected.has(object.id) && !ancestorIds(objects, object.id).some((id) => selected.has(id)))
      continue
    if (isHiddenInScene(visibility, objects, object.id)) continue
    const robotId = findRobotId(objects, object.id)
    if (!robotId) continue
    for (const component of sensors)
      targets.push({
        key: component.id,
        objectId: object.id,
        robotId,
        type: component.type as SensorComponentType,
        component
      })
  }
  return targets
}

// ---- 자세 원천 ----

export type SensorGizmoPose = {
  // 센서 틀의 필드 좌표 표시 행렬(원점 = 하우징 앞면, +X = 보는 방향)
  matrix: Matrix4
  // 센서 오브젝트 피벗의 표시 위치(원점 → 피벗 선)
  pivot: Vector3
  // 'run': 실행이 잠근 그 로봇 — 시뮬레이터가 실제로 쓰는 run.sensors 장착. 'document': 문서 조준(편집·미리보기 자세)
  source: 'run' | 'document'
  // 값 표시(구·고리·발자국 채움). 실행 중인 로봇은 숨긴다(실시간 값은 장치 탭, 20 Hz 값과 60 Hz 자세가 어긋난다)
  showValues: boolean
}

// 장착(위치, ZYX 회전) → 4×4
export function mountMatrix(mount: Pick<SensorMount, 'position' | 'rotation'>): Matrix4 {
  const { position: p, rotation: r } = mount
  return new Matrix4()
    .makeRotationFromEuler(new Euler(r.x, r.y, r.z, 'ZYX'))
    .setPosition(p.x, p.y, p.z)
}

// 미리보기 자세: 그 로봇의 관절 중 미리보기 값이 있는 것(한계로 자름). 실행 중인 로봇은 미리보기를 쓰지 않는다
// (poseDisplay.ts jointValueSource와 같은 우선순위: 실행 값 → 실행 중인 로봇이면 없음 → 미리보기).
export function sensorDisplayOverride(
  objects: SceneObjects,
  robotId: string,
  play: Pick<PlayData, 'run' | 'simPose'>,
  preview: JointPreviewState
): RootOverride | null {
  const sim = displayRootOverride(play, objects)
  if (sim && sim.id === robotId) return sim
  if (runningRobotId(play) === robotId) return null
  const joints = new Map<string, Matrix4>()
  for (const id of Object.keys(preview.values)) {
    const joint = objects[id]?.joint
    const value = jointPreviewValue(preview, id)
    if (!joint || value === null || findRobotId(objects, id) !== robotId) continue
    joints.set(id, jointMotionMatrix(joint, clampJointValue(joint, value)))
  }
  return joints.size > 0 ? { id: robotId, transform: objects[robotId].transform, joints } : null
}

// 기즈모를 그릴 자세(spec-4c §1.9 U1·U2). null이면 그리지 않는다.
// - 그 로봇이 실행 중이고 실행이 필드를 잠갔으면(떼어 놓지 않은 실행) run.sensors의 장착을 표시 자세의 몸체 틀로 그린다
//   (섀시는 로봇의 표시 행렬, 관절 몸체 j는 run.joints[j] 오브젝트의 표시 행렬 · 앵커). 실행에 없는 센서(빠졌거나 INIT 뒤에
//   붙임)는 문서 장착을 표시 자세로 그린다(simulated false로 회색).
// - 아니면 문서 장착(편집 자세 로봇 좌표)을 센서 오브젝트 로컬로 바꿔 둔 뒤(worldMatrix(obj)⁻¹·로봇·장착) 표시 행렬에 곱한다
//   (관절 미리보기를 따른다).
export function sensorGizmoPose(
  objects: SceneObjects,
  target: SensorGizmoTarget,
  play: Pick<PlayData, 'run' | 'simPose'>,
  preview: JointPreviewState,
  bounds: LocalBoundsLookup | null
): (SensorGizmoPose & { runSensor: PlayRunSensor | null }) | null {
  const { objectId, robotId } = target
  if (!objects[objectId] || !objects[robotId]) return null
  const override = sensorDisplayOverride(objects, robotId, play, preview)
  const display = worldMatrix(objects, objectId, override)
  const pivot = new Vector3().setFromMatrixPosition(display)
  const run = play.run
  if (runLocksField(run) && run.robotId === robotId) {
    const entry = run.sensors.find(
      (sensor) => sensor.componentId === target.key && sensor.objectId === objectId
    )
    if (entry) {
      let body: Matrix4
      if (entry.body < 0) body = worldMatrix(objects, robotId, override)
      else {
        const jointId = run.joints[entry.body]
        const joint = jointId !== undefined ? objects[jointId]?.joint : undefined
        if (!joint) return null
        const [ax, ay, az] = joint.anchor
        body = worldMatrix(objects, jointId, override).multiply(
          new Matrix4().makeTranslation(ax, ay, az)
        )
      }
      return {
        matrix: body.multiply(mountMatrix(entry.mount)),
        pivot,
        source: 'run',
        showValues: false,
        runSensor: entry
      }
    }
  }
  const mount = sensorMountInRobot(
    objects,
    objectId,
    sensorAim(target.type, target.component.props),
    bounds
  )
  if (!mount) return null
  // 문서 장착을 센서 오브젝트 로컬로(편집 자세)
  const local = worldMatrix(objects, objectId)
    .invert()
    .multiply(worldMatrix(objects, robotId))
    .multiply(mountMatrix(mount))
  return {
    matrix: display.multiply(local),
    pivot,
    source: 'document',
    showValues: runningRobotId(play) !== robotId,
    runSensor: null
  }
}

// ---- 형상 ----

export type GizmoSegment = { from: SimVec3; to: SimVec3 }

export type SensorGizmoGeometry = {
  kind: SensorGizmoKind
  // 시뮬레이터에서 빠짐(회색 50%, 값 없음)
  excluded: boolean
  // 하우징 앞면(광선 원점)
  origin: SimVec3
  pivot: SimVec3
  // 실선(광선이 맞은 데까지)과 점선(빗나감: 거리 1.2 m, 컬러 6 in까지). 발자국 폐곡선은 두 끝이 모두 맞았으면 실선
  solid: GizmoSegment[]
  dashed: GizmoSegment[]
  // 자기 가림 경고 점선(그 지점부터 축 끝까지)
  warning: GizmoSegment[]
  // 거리 값: 유효하면 구, 문턱 아래(신호는 있음)면 속 빈 고리(축에 수직)
  value: { kind: 'sphere' | 'ring'; at: SimVec3; normal: SimVec3 } | null
  // 컬러 발자국: 축 교차에서 축에 수직인 반경 0.6·d 원, 예측 색(드라이버 값 r·g·b를 최댓값으로 나눈 sRGB)
  disc: { center: SimVec3; normal: SimVec3; radius: number; color: string } | null
}

const along = (o: SimVec3, d: SimVec3, t: number): SimVec3 => ({
  x: o.x + d.x * t,
  y: o.y + d.y * t,
  z: o.z + d.z * t
})

function rotate(pose: SensorPose, d: SimVec3): SimVec3 {
  const r = pose.rotation
  return {
    x: r[0] * d.x + r[1] * d.y + r[2] * d.z,
    y: r[3] * d.x + r[4] * d.y + r[5] * d.z,
    z: r[6] * d.x + r[7] * d.y + r[8] * d.z
  }
}

const hex = (v: number): string =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')

// 예측 색: 드라이버가 보는 값(red × 1.07, blue × 1.55 — 칩 원래 값의 COLOR_WHITE_BALANCE를 되돌림)을 최댓값으로 나눈 sRGB.
// 모두 0이면 검정
export function predictedColor(reading: Pick<ColorReading, 'red' | 'green' | 'blue'>): string {
  const channels = [
    reading.red / COLOR_WHITE_BALANCE[0],
    reading.green / COLOR_WHITE_BALANCE[1],
    reading.blue / COLOR_WHITE_BALANCE[2]
  ]
  const max = Math.max(...channels)
  if (!(max > 0)) return '#000000'
  return `#${channels.map((c) => hex(c / max)).join('')}`
}

export type SensorGizmoInput = {
  kind: SensorGizmoKind
  // 센서 틀 표시 행렬(three Matrix4.elements, 열 우선)
  matrix: readonly number[]
  pivot: SimVec3
  caster: Pick<FieldRaycaster, 'cast'>
  // 값 표시에 쓰는 읽기(같은 자세로 readRangeSensor·readColorSensor). null이면 값을 그리지 않는다
  reading: RangeReading | ColorReading | null
  excluded: boolean
  // 자기 가림: 축 광선이 그 거리(m)에서 자기 로봇에 맞음(sensorSelfHit axis), 없으면 null
  selfHitDistance: number | null
}

export function sensorGizmoGeometry(input: SensorGizmoInput): SensorGizmoGeometry {
  const pose = sensorPoseFromMatrix(input.matrix)
  const o = pose.origin
  const axis = rotate(pose, { x: 1, y: 0, z: 0 })
  const solid: GizmoSegment[] = []
  const dashed: GizmoSegment[] = []
  const warning: GizmoSegment[] = []
  const reach = input.kind === 'distance' ? TOF_WHITE_RANGE : COLOR_GIZMO_REACH
  // 한 광선: 맞으면 그 자리까지 실선, 아니면 reach까지 점선
  const ray = (dir: SimVec3): { end: SimVec3; hit: boolean; t: number } => {
    const hit = input.caster.cast(o, dir, reach)
    if (hit && hit.t <= reach) return { end: along(o, dir, hit.t), hit: true, t: hit.t }
    return { end: along(o, dir, reach), hit: false, t: reach }
  }
  const axisRay = ray(axis)
  ;(axisRay.hit ? solid : dashed).push({ from: o, to: axisRay.end })
  if (input.selfHitDistance !== null && input.selfHitDistance < axisRay.t)
    warning.push({ from: along(o, axis, input.selfHitDistance), to: axisRay.end })

  let value: SensorGizmoGeometry['value'] = null
  let disc: SensorGizmoGeometry['disc'] = null
  if (input.kind === 'distance') {
    const ends = sensorOuterRays('distanceSensor').map((d) => ray(rotate(pose, d)))
    for (const end of ends) (end.hit ? solid : dashed).push({ from: o, to: end.end })
    ends.forEach((end, j) => {
      const next = ends[(j + 1) % ends.length]
      ;(end.hit && next.hit ? solid : dashed).push({ from: end.end, to: next.end })
    })
    const reading = !input.excluded ? (input.reading as RangeReading | null) : null
    if (reading) {
      if (reading.distance !== null)
        value = { kind: 'sphere', at: along(o, axis, reading.distance), normal: axis }
      else if (reading.raw !== null)
        value = { kind: 'ring', at: along(o, axis, reading.raw), normal: axis }
    }
  } else {
    const reading = !input.excluded ? (input.reading as ColorReading | null) : null
    if (reading && axisRay.hit) {
      const d = axisRay.t
      disc = {
        center: axisRay.end,
        normal: axis,
        radius: COLOR_FOOTPRINT_SPREAD * d,
        color: predictedColor(reading)
      }
    }
  }
  return {
    kind: input.kind,
    excluded: input.excluded,
    origin: o,
    pivot: input.pivot,
    solid,
    dashed,
    warning,
    value,
    disc
  }
}
