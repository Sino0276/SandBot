import type { TFunction } from 'i18next'
import { trueIntrinsics, type TrueIntrinsics } from '../../../../shared/sim/cameraData'
import type { FieldSpec, SeasonId } from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import type { SensorPose } from '../../../../shared/sim/sensorFrame'
import { DEFAULT_DECIMATION, FieldVision, type TagObservation } from '../../../../shared/sim/vision'
import { looseT } from '../../hardware/labels'
import {
  cameraModelOf,
  SENSOR_HOUSING_WARN,
  type LocalBoundsLookup,
  type SensorMountInRobot
} from '../../hardware/mounting'
import { cameraMountInRobot, type CameraExclusion } from '../../play/worldCameras'
import { findRobotId, type HardwareComponent, type SceneObjects } from '../../scene/model'
import { formatLength, formatNumber, type LengthUnit } from '../../units/units'
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from '../scene/cameraGizmoModel'
import { sensorEditPose } from './sensorReading'
import type { SelfHit } from './sensorSelfHit'

// 웹캠 카드의 "편집 자세" 줄(4d, spec-4d §1.15). 문서 시즌(모르면 'none')·개인 실행 설정의 HIVE 상태·편집 자세(로봇 시작
// 자세, 관절 q = 0)에서 VisionPortal 기본 640×480·데시메이션 3으로 시뮬레이터와 같은 판정(vision.ts FieldVision.observe)을
// 부른다. Unity에는 이 줄에 해당하는 것이 없다(4c 센서 값 줄과 같은 임시 편차): 조준·위치를 바꾸면 보이는 태그를 바로
// 보이고, 시뮬레이터가 재현하지 못하는 실수(자기 로봇 가림 등)를 알린다.

export type CameraReadingTail =
  | { key: 'onRobot' }
  | { key: 'pivot' }
  | { key: 'farHousing'; distance: number }
  | { key: 'selfHit'; partId: string; distance: number }
  | { key: 'selfHitPartial' }
  // 시리얼이 없어 구성 XML에 들어가지 않음: 시뮬레이터에서 빠지지만 값은 보인다(새 웹캠의 시리얼은 비어 있다)
  | { key: 'notConfigured' }

// 보이는 태그 묶음(SDK 묶음 이름, 묶음이 없는 태그는 null): 첫 태그 id 순
export type VisibleTagGroup = { cluster: string | null; ids: number[] }

export type CameraReadingModel =
  | { kind: 'excluded'; reason: CameraExclusion }
  | {
      kind: 'camera'
      lens: TrueIntrinsics
      mount: SensorMountInRobot
      pose: SensorPose
      spec: FieldSpec
      // FieldVision.observe 결과(id 오름차순, 모든 태그)
      observations: TagObservation[]
      visible: VisibleTagGroup[]
      // 놓친 이유가 가림·작음·스침인 태그 수(꼬리)
      rejected: { occluded: number; tooSmall: number; grazing: number }
      tails: CameraReadingTail[]
    }

export type CameraReadingInput = {
  objects: SceneObjects
  objectId: string
  component: HardwareComponent
  season: SeasonId
  // 개인 실행 설정의 HIVE 상태 [빨강, 파랑]이 넘어감인지
  hiveTipped: readonly [boolean, boolean]
  bounds: LocalBoundsLookup | null
  // 세계 설명에서 빠지는 이유(play/worldCameras.ts cameraExclusions), 없으면 null
  exclusion: CameraExclusion | null
  // 자기 가림. 없으면 보지 않는다(시험·로봇 밖)
  selfHit?: (mount: SensorMountInRobot) => SelfHit | null
}

// 시즌·HIVE 상태마다 판정기 하나(FieldVision은 생성자에서 태그 자세를 푼다). 시즌 판(resolveSeason)은 모듈 상수라 WeakMap
// 열쇠로 쓴다.
const visionCache = new WeakMap<FieldSpec, Map<string, FieldVision>>()

export function fieldVisionFor(
  spec: FieldSpec,
  hiveTipped: readonly [boolean, boolean]
): FieldVision {
  let bySpec = visionCache.get(spec)
  if (!bySpec) visionCache.set(spec, (bySpec = new Map()))
  const key = `${hiveTipped[0]}|${hiveTipped[1]}`
  let vision = bySpec.get(key)
  if (!vision) bySpec.set(key, (vision = new FieldVision(spec, hiveTipped)))
  return vision
}

// 보이는 태그를 SDK 묶음으로 나눈다(묶음은 그 묶음의 첫 보이는 id 순, 묶음 안은 id 오름차순)
export function visibleTagGroups(
  spec: FieldSpec,
  observations: readonly TagObservation[]
): VisibleTagGroup[] {
  const groups: VisibleTagGroup[] = []
  const visible = observations.filter((o) => o.visible).sort((a, b) => a.id - b.id)
  for (const observation of visible) {
    const cluster = spec.aprilTags.tags.find((tag) => tag.id === observation.id)?.cluster ?? null
    const group =
      cluster === null ? undefined : groups.find((candidate) => candidate.cluster === cluster)
    if (group) group.ids.push(observation.id)
    else groups.push({ cluster, ids: [observation.id] })
  }
  return groups
}

export function cameraReadingModel(input: CameraReadingInput): CameraReadingModel | null {
  const { objects, objectId, component } = input
  if (component.type !== 'webcam') return null
  // 구성에 없는 웹캠(notConfigured)은 값을 보이고 꼬리로 알린다(시리얼을 넣기 전에도 조준을 맞출 수 있게). 나머지 이유는
  // 값 대신 한 줄이다(4c와 같음)
  if (input.exclusion && input.exclusion !== 'notConfigured')
    return { kind: 'excluded', reason: input.exclusion }
  const robotId = findRobotId(objects, objectId)
  const mount = robotId
    ? cameraMountInRobot(objects, objectId, component.props, input.bounds)
    : null
  if (!robotId || !mount) return { kind: 'excluded', reason: 'outsideRobot' }
  const model = cameraModelOf(component.props)
  const lens = trueIntrinsics(model, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  const spec = resolveSeason(input.season)
  const pose = sensorEditPose(objects, robotId, mount)
  const observations = fieldVisionFor(spec, input.hiveTipped).observe(
    pose,
    model,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
    DEFAULT_DECIMATION
  )
  const rejected = { occluded: 0, tooSmall: 0, grazing: 0 }
  for (const observation of observations) {
    const reason = observation.rejection
    if (reason === 'occluded' || reason === 'tooSmall' || reason === 'grazing') rejected[reason]++
  }
  const tails: CameraReadingTail[] = []
  const object = objects[objectId]
  if (object.kind === 'robot' || object.cad) tails.push({ key: 'onRobot' })
  else if (mount.housing === 'pivot') tails.push({ key: 'pivot' })
  if (mount.pivotOffset > SENSOR_HOUSING_WARN)
    tails.push({ key: 'farHousing', distance: mount.pivotOffset })
  const hit = input.selfHit?.(mount) ?? null
  if (hit?.kind === 'axis')
    tails.push({ key: 'selfHit', partId: hit.partId, distance: hit.distance })
  else if (hit?.kind === 'partial') tails.push({ key: 'selfHitPartial' })
  if (input.exclusion === 'notConfigured') tails.push({ key: 'notConfigured' })
  return {
    kind: 'camera',
    lens,
    mount,
    pose,
    spec,
    observations,
    visible: visibleTagGroups(spec, observations),
    rejected,
    tails
  }
}

export type CameraReadingText = { lines: string[]; tails: string[] }

// 묶음 하나의 글자: "RED AUDIENCE 34·35·36·37"(묶음이 없으면 id만)
const groupText = (group: VisibleTagGroup): string => {
  const ids = group.ids.join('·')
  return group.cluster === null ? ids : `${group.cluster} ${ids}`
}

// 카드에 보일 글자(렌즈 줄, 보이는 태그 줄과 놓친 태그 꼬리, 경고 꼬리). 길이는 표시 단위, 부품 이름은 오브젝트 이름이다.
// 렌즈 값은 OpenCV 좌표 px(소수 첫째)다.
export function cameraReadingText(
  model: CameraReadingModel,
  t: TFunction,
  unit: LengthUnit,
  objects: SceneObjects
): CameraReadingText {
  const tt = looseT(t)
  if (model.kind === 'excluded')
    return { lines: [tt(`hardware.cameraReading.excluded.${model.reason}`)], tails: [] }
  const length = (meters: number): string =>
    `${formatLength(meters, unit)} ${t(`units.symbols.${unit}`)}`
  const { lens } = model
  const from = `${lens.from[0]}×${lens.from[1]}`
  const source =
    lens.source === 'exact'
      ? t('hardware.cameraReading.sources.exact')
      : t(`hardware.cameraReading.sources.${lens.source}`, { from })
  const lines = [
    t('hardware.cameraReading.lens', {
      fx: formatNumber(lens.fx, 1),
      cx: formatNumber(lens.cx, 1),
      cy: formatNumber(lens.cy, 1),
      source
    })
  ]
  const counts = (['occluded', 'tooSmall', 'grazing'] as const)
    .filter((reason) => model.rejected[reason] > 0)
    .map((reason) =>
      t(`hardware.cameraReading.rejectedParts.${reason}`, { count: model.rejected[reason] })
    )
  const rejected =
    counts.length > 0 ? ` ${t('hardware.cameraReading.rejected', { list: counts.join(', ') })}` : ''
  lines.push(
    (model.visible.length > 0
      ? t('hardware.cameraReading.visible', { tags: model.visible.map(groupText).join(', ') })
      : t('hardware.cameraReading.none')) + rejected
  )
  const tails = model.tails.map((tail) => {
    switch (tail.key) {
      case 'farHousing':
        return t('hardware.cameraReading.tails.farHousing', { distance: length(tail.distance) })
      case 'selfHit':
        return t('hardware.cameraReading.tails.selfHit', {
          part: objects[tail.partId]?.name ?? tail.partId
        })
      default:
        return t(`hardware.cameraReading.tails.${tail.key}`)
    }
  })
  return { lines, tails }
}
