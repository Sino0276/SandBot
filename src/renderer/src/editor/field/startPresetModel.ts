import type { FieldSpec, FieldStartPreset } from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import {
  matchingPreset,
  presetRect,
  presetTarget,
  presetWallFrame,
  snapRobotToStart,
  startConflicts,
  type StartConflict,
  type StartFacing,
  type StartSnap
} from '../../../../shared/sim/seasons/startPose'
import type { Pose2, Vec2 } from '../../../../shared/sim/worldSpec'
import { usePlayStore } from '../../play/playStore'
import { robotOutline } from '../../play/worldSpec'
import { fieldSeasonId, type FieldDoc } from '../../scene/fieldDoc'
import { findRobotId, type SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { isRecentHandleInteraction, useEditorStore } from '../editorStore'
import { isChangeOpen } from '../history'
import { runLocksField } from './fieldDisplay'

// 시작 위치 프리셋(spec-4ab §1.7·§1.9): 로봇 인스펙터 "시작 위치"와 씬 뷰 시작 표시가 같이 쓰는 보기 모델과 쓰기. 계산은
// seasons/startPose.ts(순수·결정적)이고, 여기서는 지금 문서(로봇 외곽·자세·시즌)에 맞춰 묶는다.

// R102 시작 크기 18 in(m). 외곽이 이것을 넘으면 정보 줄로 알린다
export const START_SIZE_LIMIT = 0.4572
// 18 in와 같다고 보는 허용(m, startPose의 겹침 허용과 같다)
const SIZE_TOLERANCE = 1e-6
// 쓰기 전에 지금 자세와 같다고 보는 차(spec-4ab §1.7 "쓰기"): 위치 1e-9 m, 요 1e-12 rad. 같으면 실행 취소 단계를 만들지 않는다
const SAME_POSITION = 1e-9
const SAME_YAW = 1e-12

// 문서 시즌이 프리셋을 가진 알려진 시즌이면 그 FieldSpec, 아니면 null('none'·모르는 시즌)
export function presetSeason(doc: FieldDoc): FieldSpec | null {
  const id = fieldSeasonId(doc)
  if (id === null) return null
  const spec = resolveSeason(id)
  return spec.startPresets.length > 0 ? spec : null
}

// 시작 표시·"시작 위치"의 대상 로봇: 활성 오브젝트가 속한 최상위 로봇(Create Empty 기본 부모와 같은 규칙). 씬 뷰 클릭은
// 가장 안쪽 파트를 고르므로 파트가 활성이어도 그 로봇이다.
export function startTargetRobotId(objects: SceneObjects, activeId: string | null): string | null {
  return activeId !== null && objects[activeId] ? findRobotId(objects, activeId) : null
}

export function robotPose(objects: SceneObjects, robotId: string): Pose2 {
  const { position, rotation } = objects[robotId].transform
  return { x: position[0], y: position[1], yaw: rotation[2] }
}

export type PresetOption = {
  preset: FieldStartPreset
  // 지금 facing과 target(지금 외곽이 그 사각형 안이면 외곽 중심, 아니면 구간 가운데)으로 스냅한 결과
  snap: StartSnap
  // 스냅 결과의 충돌(tooWide면 [])
  conflicts: StartConflict[]
  // 비활성 이유: tooWide·conflict, 쓸 수 있으면 null
  disabled: 'tooWide' | 'conflict' | null
}

export type StartPresetModel = {
  spec: FieldSpec
  robotId: string
  footprint: Vec2[]
  height: number
  pose: Pose2
  // 지금 자세가 맞는 프리셋·면(없으면 null)
  match: { key: string; facing: StartFacing } | null
  // 계산에 쓴 면(맞는 프리셋의 면, 없으면 넘겨받은 면)
  facing: StartFacing
  options: PresetOption[]
  // 너무 넓어 쓸 수 없는 프리셋 요약(없으면 null). available은 그 가운데 가장 넓은 구간, width는 그 프리셋에서의 외곽 폭
  tooWide: { count: number; width: number; available: number } | null
  // 겹쳐 쓸 수 없는 프리셋 요약(없으면 null). conflicts는 그 프리셋들의 충돌을 프리셋 순서로 이은 것
  conflict: { count: number; conflicts: StartConflict[] } | null
  // 로봇 좌표 축 정렬 외곽 상자(W: 로봇 X, D: 로봇 Y)
  size: { width: number; depth: number }
  // 어느 쪽이든 18 in를 넘는가(R102)
  oversize: boolean
}

function presetOption(
  spec: FieldSpec,
  preset: FieldStartPreset,
  footprint: readonly Vec2[],
  height: number,
  pose: Pose2,
  facing: StartFacing
): PresetOption {
  const innerHalf = spec.perimeter.innerHalf
  const target = presetTarget(preset, innerHalf, footprint, pose)
  const snap = snapRobotToStart(footprint, preset, innerHalf, target, facing)
  if (!snap.ok) return { preset, snap, conflicts: [], disabled: 'tooWide' }
  const conflicts = startConflicts(spec, footprint, snap.pose, height)
  return { preset, snap, conflicts, disabled: conflicts.length > 0 ? 'conflict' : null }
}

// 로봇 하나의 시작 위치 보기 모델. 문서 시즌에 프리셋이 없거나 로봇이 없으면 null.
// fallbackFacing: 맞는 프리셋이 없을 때의 면(인스펙터는 마지막으로 고른 값, 시작 표시는 'default')
export function startPresetModel(
  objects: SceneObjects,
  robotId: string,
  doc: FieldDoc,
  fallbackFacing: StartFacing
): StartPresetModel | null {
  const spec = presetSeason(doc)
  if (!spec || objects[robotId]?.kind !== 'robot') return null
  const { footprint, height } = robotOutline(objects, robotId)
  const pose = robotPose(objects, robotId)
  const match = matchingPreset(spec, footprint, pose)
  const facing = match?.facing ?? fallbackFacing
  const options = spec.startPresets.map((preset) =>
    presetOption(spec, preset, footprint, height, pose, facing)
  )
  // 너무 넓은 것: 가장 넓은 구간의 프리셋(같으면 앞의 것)
  const wide = options.flatMap((option) => (option.snap.ok ? [] : [option.snap]))
  const widest = wide.reduce<(typeof wide)[number] | null>(
    (best, snap) => (best === null || snap.available > best.available ? snap : best),
    null
  )
  const tooWide: StartPresetModel['tooWide'] = widest
    ? { count: wide.length, width: widest.width, available: widest.available }
    : null
  const conflicting = options.filter((option) => option.disabled === 'conflict')
  const conflict: StartPresetModel['conflict'] =
    conflicting.length > 0
      ? {
          count: conflicting.length,
          conflicts: conflicting.flatMap((option) => option.conflicts)
        }
      : null
  const xs = footprint.map((p) => p.x)
  const ys = footprint.map((p) => p.y)
  const size = {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys)
  }
  return {
    spec,
    robotId,
    footprint,
    height,
    pose,
    match,
    facing,
    options,
    tooWide,
    conflict,
    size,
    oversize:
      size.width > START_SIZE_LIMIT + SIZE_TOLERANCE ||
      size.depth > START_SIZE_LIMIT + SIZE_TOLERANCE
  }
}

// 감은 각 차(−π, π]
function angleDifference(a: number, b: number): number {
  const d = a - b
  return d - 2 * Math.PI * Math.round(d / (2 * Math.PI))
}

// 로봇을 프리셋에 스냅해 쓴다(setLocalTransform 한 번, constrainTransform을 거쳐 실행 취소 한 단계). 결과가 지금 자세와
// 같으면 쓰지 않는다(실행 취소 단계를 만들지 않음). target이 없으면 presetTarget(지금 외곽이 사각형 안이면 그 중심).
// 썼으면 true, 같거나 tooWide·로봇 없음이면 false.
export function snapRobotToPreset(
  robotId: string,
  presetKey: string,
  facing: StartFacing,
  target?: number
): boolean {
  const scene = useSceneStore.getState()
  const { objects } = scene
  const spec = presetSeason(scene.field)
  const preset = spec?.startPresets.find((candidate) => candidate.key === presetKey)
  if (!spec || !preset || objects[robotId]?.kind !== 'robot') return false
  const { footprint } = robotOutline(objects, robotId)
  const pose = robotPose(objects, robotId)
  const innerHalf = spec.perimeter.innerHalf
  const snap = snapRobotToStart(
    footprint,
    preset,
    innerHalf,
    target ?? presetTarget(preset, innerHalf, footprint, pose),
    facing
  )
  if (!snap.ok) return false
  const next = snap.pose
  if (
    Math.abs(next.x - pose.x) <= SAME_POSITION &&
    Math.abs(next.y - pose.y) <= SAME_POSITION &&
    Math.abs(angleDifference(next.yaw, pose.yaw)) <= SAME_YAW
  )
    return false
  scene.setLocalTransform(robotId, { position: [next.x, next.y, 0], rotation: [0, 0, next.yaw] })
  return true
}

// 씬 뷰 점(필드 좌표)을 품는 첫 프리셋(배열 순서). 같은 얼라이언스 사각형이 모서리에서 겹치므로 앞의 것이 이긴다.
export function presetAt(
  spec: FieldSpec,
  point: { x: number; y: number }
): FieldStartPreset | null {
  const innerHalf = spec.perimeter.innerHalf
  for (const preset of spec.startPresets) {
    const [x0, y0, x1, y1] = presetRect(preset, innerHalf)
    if (point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1) return preset
  }
  return null
}

// 누른 점의 벽 방향 좌표(target)
export function alongCoordinate(preset: FieldStartPreset, point: { x: number; y: number }): number {
  const { along } = presetWallFrame(preset.wall)
  return point.x * along.x + point.y * along.y
}

// ---- 씬 뷰 시작 표시 누르기(spec-4ab §1.9) ----

// R3F 클릭 사건에서 쓰는 부분
export type StartMarkerClick = {
  // 누른 뒤 움직인 거리(px). 2보다 크면 끈 것(SceneObjectsView와 같은 규칙)
  delta: number
  altKey: boolean
  // 누른 점(필드 좌표)
  point: { x: number; y: number }
  stopPropagation: () => void
}

// 시작 표시 클릭. 늘 전파를 막는다(흐린 표시·Field 선택 중에도: 빗나간 클릭이 되어 select(null)로 선택과 표시가 사라지지
// 않게). 다음을 모두 만족할 때만 대상 로봇을 누른 점의 벽 방향 좌표로 스냅한다: 끈 클릭 아님, Alt 없음(Alt 궤도), 핸들 직후
// 아님, 핸들 드래그 중 아님, 실행이 필드를 잠그지 않음, 대상 로봇 있음, 그 프리셋이 흐리지 않음. 프리셋은 누른 점을 품는
// 첫 프리셋이다(R3F가 같은 클릭을 겹친 표시 여럿에 보내도 첫 처리기가 정하고 전파를 막는다). 선택은 바꾸지 않는다.
// 스냅해 썼으면 true.
export function handleStartMarkerClick(event: StartMarkerClick): boolean {
  event.stopPropagation()
  if (event.delta > 2 || event.altKey || isRecentHandleInteraction() || isChangeOpen()) return false
  if (runLocksField(usePlayStore.getState().run)) return false
  const scene = useSceneStore.getState()
  const robotId = startTargetRobotId(scene.objects, useEditorStore.getState().selectedId)
  if (robotId === null) return false
  const model = startPresetModel(scene.objects, robotId, scene.field, 'default')
  if (!model) return false
  const preset = presetAt(model.spec, event.point)
  if (!preset) return false
  const option = model.options.find((candidate) => candidate.preset.key === preset.key)
  if (!option || option.disabled !== null) return false
  return snapRobotToPreset(robotId, preset.key, model.facing, alongCoordinate(preset, event.point))
}
