import type { Matrix4, Object3D } from 'three'
import {
  displayRootOverride,
  runningRobotId,
  simJointValue,
  simPoseOf,
  type PlayData
} from '../../play/playStore'
import { clampJointValue, jointMotionMatrix } from '../../scene/jointMotion'
import {
  findRobotId,
  subtreeIds,
  worldMatrix,
  type JointSettings,
  type SceneObjects
} from '../../scene/model'
import { jointPreviewValue, type JointPreviewState } from '../joint/jointPreviewStore'

// 실행 중 씬 뷰의 로봇 자세(SceneObjectsView). 시뮬레이터 자세(playStore.simPose, 약 60 Hz)는 React로 다시 그리지 않고
// 로봇 노드를 감싼 바깥 그룹에 명령형으로 쓴다(큰 CAD는 노드가 수천 개다). 그동안 안쪽 로봇 노드는 항등 변환이고,
// 바깥 그룹은 R3F가 props로 관리하지 않으므로 끝날 때 여기서 직접 항등으로 되돌린다(R3F는 이전 props와만 비교한다).

type Pose = { x: number; y: number; yaw: number }

type PoseSource = {
  getState: () => Pick<PlayData, 'run' | 'simPose'>
  subscribe: (
    listener: (
      state: Pick<PlayData, 'run' | 'simPose'>,
      previous: Pick<PlayData, 'run' | 'simPose'>
    ) => void
  ) => () => void
}

// 최상위 로봇의 자세(바닥 위, 요만). 회전 순서는 씬 전체와 같은 'ZYX'다.
export function applyPose(object: Object3D, pose: Pose): void {
  object.position.set(pose.x, pose.y, 0)
  object.rotation.set(0, 0, pose.yaw, 'ZYX')
}

export function resetPose(object: Object3D): void {
  object.position.set(0, 0, 0)
  object.rotation.set(0, 0, 0, 'ZYX')
}

// 바깥 그룹을 그 로봇의 시뮬레이터 자세에 묶는다. 붙자마자 지금 자세를 적용하고(StrictMode가 정리한 뒤 다시 붙여도
// 같은 자세), 자세가 올 때마다 적용하고 다시 그리기를 요청한다(frameloop demand). 돌려준 함수는 구독을 풀고 항등으로
// 되돌린다.
export function bindPoseDisplay(
  object: Object3D,
  robotId: string,
  source: PoseSource,
  invalidate: () => void
): () => void {
  const current = simPoseOf(source.getState())
  if (current && current.robotId === robotId) applyPose(object, current)
  invalidate()
  const unsubscribe = source.subscribe((state, previous) => {
    if (state.simPose === previous.simPose) return
    const pose = simPoseOf(state)
    if (!pose || pose.robotId !== robotId) return
    applyPose(object, pose)
    invalidate()
  })
  return () => {
    unsubscribe()
    resetPose(object)
    invalidate()
  }
}

// 잔상으로 메시를 하나씩 다시 그리는 한도. 넘으면(큰 CAD) 외곽선 상자만 그린다(그리는 양이 두 배가 되지 않게).
export const GHOST_MESH_LIMIT = 500

// 하위 트리의 CAD 메시 수
export function meshCount(objects: SceneObjects, id: string): number {
  if (!objects[id]) return 0
  let count = 0
  for (const objectId of subtreeIds(objects, id))
    if (objects[objectId].visual?.type === 'mesh') count++
  return count
}

// ---- 관절(3b): 관절 오브젝트 노드 안쪽 그룹의 자세 ----
// 씬 뷰는 관절이 있는 오브젝트의 형상·자식을 안쪽 그룹으로 한 번 더 감싸고(SceneObjectsView의 JointMotionGroup), 그 그룹에
// A·M(q)·A⁻¹(scene/jointMotion.ts)을 명령형으로 쓴다. q는 실행 중이면 시뮬레이터 값(pose 이벤트 joints), 아니면 관절 카드의
// 미리보기 값이고, 둘 다 없으면 항등(편집 자세)이다. 씬 문서는 바꾸지 않는다.

type Store<S> = {
  getState: () => S
  subscribe: (listener: (state: S, previous: S) => void) => () => void
}

// 관절 값 하나를 읽고 바뀔 때 알리는 곳(null = 편집 자세)
export type JointValueSource = {
  get: () => number | null
  subscribe: (listener: () => void) => () => void
}

export function applyJointMotion(object: Object3D, joint: JointSettings, q: number): void {
  jointMotionMatrix(joint, q).decompose(object.position, object.quaternion, object.scale)
}

export function resetJointMotion(object: Object3D): void {
  object.position.set(0, 0, 0)
  object.quaternion.identity()
  object.scale.set(1, 1, 1)
}

// 관절 오브젝트(robotId는 그 로봇, 로봇 밖이면 null)의 표시 값. 실행 중 그 로봇이 자세를 받았으면 시뮬레이터 값이고,
// 실행 중인 로봇의 관절은 미리보기를 쓰지 않는다(시뮬레이터가 아직 자세를 보내지 않은 INIT 직후도 편집 자세). 그 밖에는
// 미리보기 값을 지금 한계 안으로 자른 것이다.
export function jointValueSource(
  objectId: string,
  robotId: string | null,
  joint: Pick<JointSettings, 'limits'>,
  play: Store<Pick<PlayData, 'run' | 'simPose'>>,
  preview: Store<JointPreviewState>
): JointValueSource {
  return {
    get: () => {
      const state = play.getState()
      const sim = simJointValue(state, objectId)
      if (sim !== null) return sim
      if (robotId !== null && runningRobotId(state) === robotId) return null
      const value = jointPreviewValue(preview.getState(), objectId)
      return value === null ? null : clampJointValue(joint, value)
    },
    subscribe: (listener) => {
      const stopPlay = play.subscribe((state, previous) => {
        if (state.simPose !== previous.simPose || state.run !== previous.run) listener()
      })
      const stopPreview = preview.subscribe((state, previous) => {
        if (state.values !== previous.values) listener()
      })
      return () => {
        stopPlay()
        stopPreview()
      }
    }
  }
}

// 안쪽 그룹을 관절 값에 묶는다(bindPoseDisplay와 같은 규칙): 붙자마자 지금 값을 적용하고(StrictMode가 정리한 뒤 다시
// 붙여도 같은 자세), 값이 바뀔 때만 적용하고 다시 그리기를 요청한다. 돌려준 함수는 구독을 풀고 항등으로 되돌린다.
export function bindJointDisplay(
  object: Object3D,
  joint: JointSettings,
  source: JointValueSource,
  invalidate: () => void
): () => void {
  let applied: number | null = null
  const apply = (): boolean => {
    const q = source.get()
    if (q === applied) return false
    applied = q
    if (q === null) resetJointMotion(object)
    else applyJointMotion(object, joint, q)
    return true
  }
  apply()
  invalidate()
  const unsubscribe = source.subscribe(() => {
    if (apply()) invalidate()
  })
  return () => {
    unsubscribe()
    resetJointMotion(object)
    invalidate()
  }
}

// 실행 중 관절이 오브젝트를 옮긴 만큼(로봇 좌표): D = (R⁻¹·W_관절(오브젝트))·(R⁻¹·W_문서(오브젝트))⁻¹. 로봇 좌표로 계산한
// 편집 자세의 점(무게중심 표시)에 곱하면 관절 자세의 자리다. 루트 자세는 넣지 않는다(로봇 틀은 바깥에서 따로 움직인다).
// 관절이 움직이지 않으면 null(항등).
export function jointDisplacement(
  objects: SceneObjects,
  objectId: string,
  data: Pick<PlayData, 'run' | 'simPose'>
): Matrix4 | null {
  const robotId = findRobotId(objects, objectId)
  const override = displayRootOverride(data, objects)
  if (!robotId || !override?.joints || override.id !== robotId) return null
  const robot = worldMatrix(objects, robotId)
  const stillRoot = { id: robotId, transform: objects[robotId].transform, joints: override.joints }
  const toRobot = robot.clone().invert()
  const moved = toRobot.clone().multiply(worldMatrix(objects, objectId, stillRoot))
  const edit = toRobot.multiply(worldMatrix(objects, objectId))
  return moved.multiply(edit.invert())
}

// 로봇 틀 안의 그룹을 jointDisplacement에 묶는다(무게중심 표시). 붙을 때와 자세가 올 때 적용하고, 떼면 항등이다.
export function bindJointDisplacement(
  object: Object3D,
  objectId: string,
  getObjects: () => SceneObjects,
  source: Store<Pick<PlayData, 'run' | 'simPose'>>,
  invalidate: () => void
): () => void {
  const apply = (state: Pick<PlayData, 'run' | 'simPose'>): void => {
    const displacement = jointDisplacement(getObjects(), objectId, state)
    if (displacement) displacement.decompose(object.position, object.quaternion, object.scale)
    else resetJointMotion(object)
  }
  apply(source.getState())
  invalidate()
  const unsubscribe = source.subscribe((state, previous) => {
    if (state.simPose === previous.simPose) return
    apply(state)
    invalidate()
  })
  return () => {
    unsubscribe()
    resetJointMotion(object)
    invalidate()
  }
}

// 잔상의 관절 오브젝트 안쪽 그룹의 정적 자세(끝날 때 한 번 정해진다). 값이 없으면 null(편집 자세).
export function ghostJointMatrix(
  joint: JointSettings | undefined,
  q: number | undefined
): Matrix4 | null {
  if (!joint || q === undefined || !Number.isFinite(q)) return null
  return jointMotionMatrix(joint, q)
}
