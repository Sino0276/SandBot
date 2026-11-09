import type { TFunction } from 'i18next'
import {
  PROXIMITY_A,
  PROXIMITY_C,
  readColorSensor,
  type ColorReading
} from '../../../../shared/sim/colorSensor'
import {
  raycasterFor,
  SURFACE_TOLERANCE,
  type SurfaceRef
} from '../../../../shared/sim/fieldRaycast'
import { readRangeSensor, type RangeReading } from '../../../../shared/sim/rangeSensor'
import type { FieldSpec, SeasonId } from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { planarFrame, sensorPose, type SensorPose } from '../../../../shared/sim/sensorFrame'
import { sensorSurfaceLabel } from '../../field/fieldLabels'
import { looseT } from '../../hardware/labels'
import {
  SENSOR_HOUSING_WARN,
  sensorAim,
  sensorMountInRobot,
  type LocalBoundsLookup,
  type SensorComponentType,
  type SensorMountInRobot
} from '../../hardware/mounting'
import type { SensorExclusion } from '../../play/worldSensors'
import { findRobotId, type HardwareComponent, type SceneObjects } from '../../scene/model'
import { wrapAngle } from '../../scene/wheel'
import { formatLength, formatNumber, type LengthUnit } from '../../units/units'
import type { SelfHit } from './sensorSelfHit'

// 거리·컬러 센서 카드의 "편집 자세 값" 줄(4c, spec-4c §1.9). 고른 시즌 필드에서 편집 자세(로봇 시작 자세, 관절 q = 0)로
// 시뮬레이터와 같은 함수(readRangeSensor·readColorSensor, 잡음 끔)를 부른다. 시즌은 문서 시즌이다(실행 잠금과 관계없이,
// Field 인스펙터 afterRun 줄과 같은 구분). Unity에는 이 줄에 해당하는 것이 없다(임시 편차): 조준을 바꾸면 바로 결과를
// 보이고, 시뮬레이터가 재현하지 못하는 실수(자기 로봇 가림 등)를 알린다.

const INCH = 0.0254
// 범위 밖일 때 칩이 내는 값(VL53L0X 8190 mm, 사이드카 VL53L0XChip.OUT_OF_RANGE_MM)
export const DISTANCE_OUT_OF_RANGE = 8.19
// 자기 가림 reach의 기본(값 줄에 거리가 없을 때): 거리 센서는 흰 88% 최대 1.2 m(rangeSensor.ts TOF_WHITE_RANGE와 같은
// 출처), 컬러 센서는 REV getDistance 상한 6 in(RevColorSensorV3 maxDist)
export const SELF_HIT_DISTANCE_REACH = 1.2
export const SELF_HIT_COLOR_REACH = 6 * INCH

// RevColorSensorV3 거리 공식(getDistance): ((PS − c)/a)^b in, PS ≤ c면 6 in, 6 in에서 자른다
const REV_BINV = -0.75934
const REV_MAX_DISTANCE_IN = 6
// BroadcomColorSensorImpl의 드라이버 보정 곱(red × 1.07, blue × 1.55)과 colorSaturation(Parameters 기본 65535)
const DRIVER_RED = 1.07
const DRIVER_BLUE = 1.55
const COLOR_SATURATION = 65535

export type SensorReadingTail =
  | { key: 'onRobot' }
  | { key: 'pivotLoading' }
  | { key: 'pivot' }
  | { key: 'farHousing'; distance: number }
  | { key: 'belowFloor' }
  | { key: 'outsideField' }
  | { key: 'selfHit'; partId: string; distance: number }
  | { key: 'selfHitPartial' }

export type SensorReadingModel =
  | { kind: 'excluded'; type: SensorComponentType; reason: SensorExclusion }
  | {
      kind: 'distance'
      reading: RangeReading
      mount: SensorMountInRobot
      pose: SensorPose
      spec: FieldSpec
      tails: SensorReadingTail[]
    }
  | {
      kind: 'color'
      reading: ColorReading
      mount: SensorMountInRobot
      pose: SensorPose
      spec: FieldSpec
      // 카드의 gain(소프트웨어 이득, 생성 코드의 setGain): 정규화 값에만 쓴다
      gain: number
      tails: SensorReadingTail[]
    }

export type SensorReadingInput = {
  objects: SceneObjects
  objectId: string
  component: HardwareComponent
  season: SeasonId
  bounds: LocalBoundsLookup | null
  // 세계 설명에서 빠지는 이유(play/worldSensors.ts sensorExclusions), 없으면 null
  exclusion: SensorExclusion | null
  // 하우징 형상을 읽는 중(cadStatus loading)
  loading: boolean
  // 자기 가림(편집 자세 값의 거리 reach로). 없으면 보지 않는다(시험·로봇 밖)
  selfHit?: (mount: SensorMountInRobot, reachM: number) => SelfHit | null
}

// 로봇 시작 자세(play/worldSpec.ts의 robot.start와 같게: 위치, 요는 wrapAngle)의 섀시 틀에 장착을 놓은 센서 자세
export function sensorEditPose(
  objects: SceneObjects,
  robotId: string,
  mount: SensorMountInRobot
): SensorPose {
  const robot = objects[robotId]
  const [x, y] = robot.transform.position
  const frame = planarFrame({ x, y, yaw: wrapAngle(robot.transform.rotation[2]) })
  return sensorPose(frame, { body: -1, position: mount.position, rotation: mount.rotation })
}

function isSensorType(type: string): type is SensorComponentType {
  return type === 'distanceSensor' || type === 'colorSensor'
}

export function sensorReadingModel(input: SensorReadingInput): SensorReadingModel | null {
  const { objects, objectId, component } = input
  if (!isSensorType(component.type)) return null
  const type = component.type
  if (input.exclusion) return { kind: 'excluded', type, reason: input.exclusion }
  const robotId = findRobotId(objects, objectId)
  const mount = robotId
    ? sensorMountInRobot(objects, objectId, sensorAim(type, component.props), input.bounds)
    : null
  if (!robotId || !mount) return { kind: 'excluded', type, reason: 'outsideRobot' }
  const spec = resolveSeason(input.season)
  const caster = raycasterFor(spec)
  const pose = sensorEditPose(objects, robotId, mount)
  const tails: SensorReadingTail[] = []
  const object = objects[objectId]
  if (object.kind === 'robot' || object.cad) tails.push({ key: 'onRobot' })
  else if (mount.housing === 'pivot') tails.push({ key: input.loading ? 'pivotLoading' : 'pivot' })
  if (mount.pivotOffset > SENSOR_HOUSING_WARN)
    tails.push({ key: 'farHousing', distance: mount.pivotOffset })
  if (pose.origin.z < -SURFACE_TOLERANCE) tails.push({ key: 'belowFloor' })
  const half = spec.perimeter.innerHalf
  if (Math.abs(pose.origin.x) > half || Math.abs(pose.origin.y) > half)
    tails.push({ key: 'outsideField' })
  const selfHit = (reach: number): void => {
    const hit = input.selfHit?.(mount, reach) ?? null
    if (hit?.kind === 'axis')
      tails.push({ key: 'selfHit', partId: hit.partId, distance: hit.distance })
    else if (hit?.kind === 'partial') tails.push({ key: 'selfHitPartial' })
  }
  if (type === 'distanceSensor') {
    const reading = readRangeSensor(caster, pose)
    selfHit(reading.distance ?? SELF_HIT_DISTANCE_REACH)
    return { kind: 'distance', reading, mount, pose, spec, tails }
  }
  const reading = readColorSensor(caster, pose)
  selfHit(reading.distance ?? SELF_HIT_COLOR_REACH)
  const gain = Number(component.props.gain)
  return {
    kind: 'color',
    reading,
    mount,
    pose,
    spec,
    gain: Number.isFinite(gain) ? gain : 1,
    tails
  }
}

// 팀 코드가 읽는 컬러 값(BroadcomColorSensorImpl.updateColors·RevColorSensorV3.getDistance와 같은 계산)
export type ColorDriverValues = {
  red: number
  green: number
  blue: number
  // getNormalizedColors: min(1, 값·gain/65535)
  normalized: [number, number, number]
  // getNormalizedColors().alpha = 1 − 65535/(avg² + 65535), avg = (red + green + blue)/3
  alpha: number
  // getDistance(m): ((PS − 26.98)/325.961)^(−0.75934) in, 6 in 상한
  getDistance: number
}

export function colorDriverValues(
  reading: Pick<ColorReading, 'red' | 'green' | 'blue' | 'proximity'>,
  gain: number
): ColorDriverValues {
  const clip = (v: number): number => Math.min(COLOR_SATURATION, Math.max(0, Math.trunc(v)))
  const red = clip(DRIVER_RED * reading.red)
  const green = reading.green
  const blue = clip(DRIVER_BLUE * reading.blue)
  const norm = (v: number): number => Math.min(1, Math.max(0, (v * gain) / COLOR_SATURATION))
  const avg = (red + green + blue) / 3
  const alpha = 1 - COLOR_SATURATION / (avg * avg + COLOR_SATURATION)
  const ps = reading.proximity
  const inches =
    ps <= PROXIMITY_C
      ? REV_MAX_DISTANCE_IN
      : Math.min(REV_MAX_DISTANCE_IN, Math.pow((ps - PROXIMITY_C) / PROXIMITY_A, REV_BINV))
  return {
    red,
    green,
    blue,
    normalized: [norm(red), norm(green), norm(blue)],
    alpha,
    getDistance: inches * INCH
  }
}

export type SensorReadingText = { lines: string[]; tails: string[] }

// 카드에 보일 글자(값 줄과 꼬리). 길이는 표시 단위, 부품 이름은 오브젝트 이름이다.
export function sensorReadingText(
  model: SensorReadingModel,
  t: TFunction,
  unit: LengthUnit,
  objects: SceneObjects
): SensorReadingText {
  const tt = looseT(t)
  const length = (meters: number): string =>
    `${formatLength(meters, unit)} ${t(`units.symbols.${unit}`)}`
  if (model.kind === 'excluded')
    return { lines: [tt(`hardware.sensorReading.excluded.${model.reason}`)], tails: [] }
  const surface = (ref: SurfaceRef | null): string =>
    ref ? sensorSurfaceLabel(model.spec, ref, t) : ''
  const lines: string[] = []
  if (model.kind === 'distance') {
    const { reading } = model
    if (reading.distance !== null)
      lines.push(
        t('hardware.sensorReading.distance', {
          value: length(reading.distance),
          surface: surface(reading.surface)
        })
      )
    else if (reading.raw !== null)
      lines.push(
        t('hardware.sensorReading.distanceWeak', {
          reflectance: formatNumber(reading.reflectance, 3),
          maxRange: length(reading.maxRange)
        })
      )
    else lines.push(t('hardware.sensorReading.distanceOut', { max: length(DISTANCE_OUT_OF_RANGE) }))
  } else {
    const { reading } = model
    const driver = colorDriverValues(reading, model.gain)
    lines.push(
      t('hardware.sensorReading.color', {
        r: driver.red,
        g: driver.green,
        b: driver.blue,
        gain: String(Number(model.gain.toFixed(3))),
        nr: formatNumber(driver.normalized[0], 4),
        ng: formatNumber(driver.normalized[1], 4),
        nb: formatNumber(driver.normalized[2], 4),
        alpha: formatNumber(driver.alpha, 3)
      })
    )
    lines.push(
      reading.distance === null
        ? t('hardware.sensorReading.colorNothing')
        : t('hardware.sensorReading.colorDistance', {
            distance: length(driver.getDistance),
            actual: length(reading.distance),
            surface: surface(reading.surface)
          })
    )
  }
  const tails = model.tails.map((tail) => {
    switch (tail.key) {
      case 'farHousing':
        return t('hardware.sensorReading.tails.farHousing', { distance: length(tail.distance) })
      case 'selfHit':
        return t('hardware.sensorReading.tails.selfHit', {
          part: objects[tail.partId]?.name ?? tail.partId,
          distance: length(tail.distance)
        })
      default:
        return t(`hardware.sensorReading.tails.${tail.key}`)
    }
  })
  return { lines, tails }
}
