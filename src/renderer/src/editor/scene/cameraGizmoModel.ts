import { Matrix4, Vector3 } from 'three'
import type { CameraModelId, TrueIntrinsics } from '../../../../shared/sim/cameraData'
import type { FieldSpec } from '../../../../shared/sim/seasons/fieldSpec'
import { tagFieldPose } from '../../../../shared/sim/seasons/tagPoses'
import { sensorPoseFromMatrix } from '../../../../shared/sim/sensorFrame'
import type { TagObservation } from '../../../../shared/sim/vision'
import type { Vec3 as SimVec3 } from '../../../../shared/sim/worldSpec'
import { cameraModelOf, type LocalBoundsLookup } from '../../hardware/mounting'
import { runningRobotId, type PlayData, type PlayRunCamera } from '../../play/playStore'
import { cameraMountInRobot } from '../../play/worldCameras'
import {
  ancestorIds,
  findRobotId,
  worldMatrix,
  type HardwareComponent,
  type SceneObjects
} from '../../scene/model'
import { runLocksField } from '../field/fieldDisplay'
import type { JointPreviewState } from '../joint/jointPreviewStore'
import { isHiddenInScene } from '../sceneVisibility'
import { mountMatrix, sensorDisplayOverride, type GizmoSegment } from './sensorGizmoModel'

type VisibilityState = Parameters<typeof isHiddenInScene>[0]

// 씬 뷰의 웹캠 기즈모(4d, spec-4d §1.15)의 순수 모델. Unity가 고른 Camera의 절두체를 그리듯, 고른 오브젝트(다중 선택이면
// 전체)나 그 상위를 고르면 그 하위의 웹캠을 그린다(4c 센서 기즈모와 같은 규칙). 렌즈(하우징 앞면)에서 VisionPortal 기본
// 해상도의 참 렌즈 값으로 영상 네 모서리 방향을 역투영해 절두체를 그리고, 편집 자세에서 보이는 태그의 검은 테두리를 같은 색,
// 가려진 태그를 경고 주황 점선으로 그린다.
//
// 색(겹치지 않는 표시 색 목록, 4c sensorGizmoModel.ts 머리 주석과 같은 표): 청록 #22d3ee(색상각 188°)는 거리 센서 보라
// 258°·축 색 350°·84°·213°·IMU 292°·38°·관절 48°와 떨어진다. 로봇 무게중심 172°(#2dd4bf)와는 16°라 선(절두체)과 점(무게중심
// 표시) 모양으로 구분한다. 경고·빠짐 색은 4c 그대로다.
export const CAMERA_GIZMO_COLOR = '#22d3ee'

// 절두체를 그리는 길이(m, 광축 방향 깊이) [결정: 표시 길이 1.0 m, spec-4d §1.15 — 필드 안 태그 거리(약 1–2 m)를 덮지 않고
// 방향을 읽을 수 있는 길이]
export const CAMERA_FRUSTUM_LENGTH = 1.0
// 영상 위쪽 표시 삼각형: 끝 사각형 위 변 가운데 이 비율의 폭을 밑변으로, 사각형 높이의 이 비율만큼 위로 [가정: Unity Camera
// 기즈모의 위쪽 삼각형과 비슷하게 보이는 크기]
export const CAMERA_UP_MARK_BASE = 0.4
export const CAMERA_UP_MARK_HEIGHT = 0.2

// VisionPortal 기본 해상도(Vision 12.0 VisionPortal.java:157 cameraResolution = new Size(640, 480)). 인스펙터 편집 자세
// 줄·기즈모가 이 해상도로 본다(데시메이션은 AprilTagProcessorImpl.java:129의 기본 3, vision.ts DEFAULT_DECIMATION)
export const PREVIEW_WIDTH = 640
export const PREVIEW_HEIGHT = 480

// ---- 픽셀 방향 ----

// OpenCV 픽셀 (u, v)(첫 픽셀 중심 (0, 0), x 오른쪽, y 아래)를 지나는 광선의 센서 틀 단위 방향. OpenCV 카메라 틀
// (x_cv, y_cv, 1) = ((u − cx)/fx, (v − cy)/fy, 1)이고 센서 틀은 X = z_cv, Y = −x_cv, Z = −y_cv(vision.ts CV_FROM_SENSOR의
// 전치)다.
export function pixelDirection(
  lens: Pick<TrueIntrinsics, 'fx' | 'fy' | 'cx' | 'cy'>,
  u: number,
  v: number
): SimVec3 {
  const x = (u - lens.cx) / lens.fx
  const y = (v - lens.cy) / lens.fy
  const length = Math.hypot(x, y, 1)
  return { x: 1 / length, y: -x / length, z: -y / length }
}

// 영상 가장자리 네 모서리(OpenCV 좌표 (−0.5, −0.5)·(w − 0.5, −0.5)·(w − 0.5, h − 0.5)·(−0.5, h − 0.5): 첫·마지막 픽셀의
// 바깥 모서리라 시야 = 영상 전체)의 센서 틀 방향. 순서는 왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래(영상 기준)
export function frustumCornerDirections(
  lens: Pick<TrueIntrinsics, 'fx' | 'fy' | 'cx' | 'cy'>,
  width: number,
  height: number
): [SimVec3, SimVec3, SimVec3, SimVec3] {
  const l = -0.5
  const r = width - 0.5
  const t = -0.5
  const b = height - 0.5
  return [
    pixelDirection(lens, l, t),
    pixelDirection(lens, r, t),
    pixelDirection(lens, r, b),
    pixelDirection(lens, l, b)
  ]
}

// 자기 가림의 바깥 광선 8개(네 모서리 → 네 변 가운데, 센서 틀). 축(광축)은 castSelfHit이 따로 쏜다(spec-4d §1.15 9광선)
export function cameraOuterRays(
  lens: Pick<TrueIntrinsics, 'fx' | 'fy' | 'cx' | 'cy'>,
  width: number,
  height: number
): SimVec3[] {
  const l = -0.5
  const r = width - 0.5
  const t = -0.5
  const b = height - 0.5
  const mu = (l + r) / 2
  const mv = (t + b) / 2
  return [
    ...frustumCornerDirections(lens, width, height),
    pixelDirection(lens, mu, t),
    pixelDirection(lens, r, mv),
    pixelDirection(lens, mu, b),
    pixelDirection(lens, l, mv)
  ]
}

// ---- 대상 ----

export type CameraGizmoTarget = {
  // 컴포넌트 id(React key)
  key: string
  objectId: string
  robotId: string
  component: HardwareComponent
}

// 고른 오브젝트와 그 하위의 웹캠(문서 순서). 웹캠 오브젝트 자신이 씬 뷰에서 숨겨졌으면(숨김·고립 보기 밖) 그리지 않고,
// 로봇 밖 오브젝트의 웹캠은 장착이 없어 그리지 않는다(4c sensorGizmoTargets와 같은 규칙).
export function cameraGizmoTargets(
  objects: SceneObjects,
  selectedIds: readonly string[],
  visibility: VisibilityState
): CameraGizmoTarget[] {
  const selected = new Set(selectedIds.filter((id) => objects[id]))
  if (selected.size === 0) return []
  const targets: CameraGizmoTarget[] = []
  for (const object of Object.values(objects)) {
    const webcams = (object.components ?? []).filter((component) => component.type === 'webcam')
    if (webcams.length === 0) continue
    if (!selected.has(object.id) && !ancestorIds(objects, object.id).some((id) => selected.has(id)))
      continue
    if (isHiddenInScene(visibility, objects, object.id)) continue
    const robotId = findRobotId(objects, object.id)
    if (!robotId) continue
    for (const component of webcams)
      targets.push({ key: component.id, objectId: object.id, robotId, component })
  }
  return targets
}

// ---- 자세 원천 ----

export type CameraGizmoPose = {
  // 카메라 틀(센서 틀: +X 광축, +Z 영상 위)의 필드 좌표 표시 행렬(원점 = 렌즈)
  matrix: Matrix4
  // 웹캠 오브젝트 피벗의 표시 위치(렌즈 → 피벗 선)
  pivot: Vector3
  // 'run': 실행이 잠근 그 로봇 — 시뮬레이터가 실제로 쓰는 run.cameras 장착. 'document': 문서 조준(편집·미리보기 자세)
  source: 'run' | 'document'
  // 태그 표시. 실행 중인 로봇은 숨긴다(실시간 값은 장치 탭, 4c와 같은 이유)
  showTags: boolean
  model: CameraModelId
  // 'run'이면 실행의 웹캠
  runCamera: PlayRunCamera | null
}

// 기즈모를 그릴 자세(4c sensorGizmoPose와 같은 규칙). null이면 그리지 않는다.
// - 그 로봇이 실행 중이고 실행이 필드를 잠갔으면 run.cameras의 장착을 표시 자세의 몸체 틀로 그린다(섀시는 로봇의 표시 행렬,
//   관절 몸체 j는 run.joints[j] 오브젝트의 표시 행렬 · 앵커). 실행에 없는 웹캠은 문서 장착을 표시 자세로 그린다.
// - 아니면 문서 장착(편집 자세 로봇 좌표)을 웹캠 오브젝트 로컬로 바꿔 둔 뒤 표시 행렬에 곱한다(관절 미리보기를 따른다).
export function cameraGizmoPose(
  objects: SceneObjects,
  target: CameraGizmoTarget,
  play: Pick<PlayData, 'run' | 'simPose'>,
  preview: JointPreviewState,
  bounds: LocalBoundsLookup | null
): CameraGizmoPose | null {
  const { objectId, robotId } = target
  if (!objects[objectId] || !objects[robotId]) return null
  const override = sensorDisplayOverride(objects, robotId, play, preview)
  const display = worldMatrix(objects, objectId, override)
  const pivot = new Vector3().setFromMatrixPosition(display)
  const run = play.run
  if (runLocksField(run) && run.robotId === robotId) {
    const entry = run.cameras.find(
      (camera) => camera.componentId === target.key && camera.objectId === objectId
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
        showTags: false,
        model: entry.model,
        runCamera: entry
      }
    }
  }
  const mount = cameraMountInRobot(objects, objectId, target.component.props, bounds)
  if (!mount) return null
  const local = worldMatrix(objects, objectId)
    .invert()
    .multiply(worldMatrix(objects, robotId))
    .multiply(mountMatrix(mount))
  return {
    matrix: display.multiply(local),
    pivot,
    source: 'document',
    showTags: runningRobotId(play) !== robotId,
    model: cameraModelOf(target.component.props),
    runCamera: null
  }
}

// ---- 형상 ----

export type CameraGizmoGeometry = {
  // 시뮬레이터에서 빠짐(회색 50%, 태그 없음)
  excluded: boolean
  // 렌즈(하우징 앞면)
  origin: SimVec3
  pivot: SimVec3
  // 절두체: 렌즈 → 네 모서리 4개 + 끝 사각형 4개 + 위쪽 표시 삼각형 3개
  frustum: GizmoSegment[]
  // 보이는 태그의 검은 테두리(실선, 같은 색)와 가려진 태그(경고 점선)
  visibleTags: GizmoSegment[]
  occludedTags: GizmoSegment[]
}

export type CameraGizmoInput = {
  // 카메라 틀 표시 행렬(three Matrix4.elements, 열 우선)
  matrix: readonly number[]
  pivot: SimVec3
  lens: Pick<TrueIntrinsics, 'fx' | 'fy' | 'cx' | 'cy'>
  width: number
  height: number
  excluded: boolean
  // 태그 표시(편집 자세 판정 결과와 그 필드). null이면 그리지 않는다
  tags: {
    field: FieldSpec
    hiveTipped: readonly [boolean, boolean]
    observations: readonly TagObservation[]
  } | null
}

const add = (a: SimVec3, b: SimVec3, scale = 1): SimVec3 => ({
  x: a.x + b.x * scale,
  y: a.y + b.y * scale,
  z: a.z + b.z * scale
})

const loop = (points: readonly SimVec3[]): GizmoSegment[] =>
  points.map((from, i) => ({ from, to: points[(i + 1) % points.length] }))

// 태그 검은 테두리 네 꼭짓점의 필드 좌표(apriltag 순서, 태그 틀 (−s/2, +s/2), (+s/2, +s/2), (+s/2, −s/2), (−s/2, −s/2),
// spec-4d §0)
export function tagCornersInField(
  field: FieldSpec,
  tagId: number,
  hiveTipped: readonly [boolean, boolean]
): SimVec3[] | null {
  const tag = field.aprilTags.tags.find((candidate) => candidate.id === tagId)
  if (!tag) return null
  const pose = tagFieldPose(field, tag, hiveTipped)
  const r = pose.rotation
  const h = tag.size / 2
  return (
    [
      [-h, h],
      [h, h],
      [h, -h],
      [-h, -h]
    ] as const
  ).map(([x, y]) => ({
    x: pose.position.x + r[0] * x + r[1] * y,
    y: pose.position.y + r[3] * x + r[4] * y,
    z: pose.position.z + r[6] * x + r[7] * y
  }))
}

export function cameraGizmoGeometry(input: CameraGizmoInput): CameraGizmoGeometry {
  const pose = sensorPoseFromMatrix(input.matrix)
  const o = pose.origin
  const r = pose.rotation
  const toField = (d: SimVec3): SimVec3 => ({
    x: r[0] * d.x + r[1] * d.y + r[2] * d.z,
    y: r[3] * d.x + r[4] * d.y + r[5] * d.z,
    z: r[6] * d.x + r[7] * d.y + r[8] * d.z
  })
  // 끝 사각형: 광축 깊이 CAMERA_FRUSTUM_LENGTH(센서 틀 x = 길이)까지 늘인 네 모서리
  const corners = frustumCornerDirections(input.lens, input.width, input.height).map((d) =>
    add(o, toField(d), CAMERA_FRUSTUM_LENGTH / d.x)
  )
  const frustum: GizmoSegment[] = corners.map((to) => ({ from: o, to }))
  frustum.push(...loop(corners))
  // 위쪽 표시: 위 변(왼쪽 위 → 오른쪽 위) 가운데 밑변과, 사각형 위쪽(왼쪽 아래 → 왼쪽 위 방향)으로 솟은 꼭짓점
  const [topLeft, topRight, , bottomLeft] = corners
  const across = { x: topRight.x - topLeft.x, y: topRight.y - topLeft.y, z: topRight.z - topLeft.z }
  const up = {
    x: topLeft.x - bottomLeft.x,
    y: topLeft.y - bottomLeft.y,
    z: topLeft.z - bottomLeft.z
  }
  const mid = add(topLeft, across, 0.5)
  const baseLeft = add(mid, across, -CAMERA_UP_MARK_BASE / 2)
  const baseRight = add(mid, across, CAMERA_UP_MARK_BASE / 2)
  const apex = add(mid, up, CAMERA_UP_MARK_HEIGHT)
  frustum.push(...loop([baseLeft, apex, baseRight]))

  const visibleTags: GizmoSegment[] = []
  const occludedTags: GizmoSegment[] = []
  if (input.tags && !input.excluded) {
    const { field, hiveTipped, observations } = input.tags
    for (const observation of observations) {
      const target = observation.visible
        ? visibleTags
        : observation.rejection === 'occluded'
          ? occludedTags
          : null
      if (!target) continue
      const tagCorners = tagCornersInField(field, observation.id, hiveTipped)
      if (tagCorners) target.push(...loop(tagCorners))
    }
  }
  return {
    excluded: input.excluded,
    origin: o,
    pivot: input.pivot,
    frustum,
    visibleTags,
    occludedTags
  }
}
