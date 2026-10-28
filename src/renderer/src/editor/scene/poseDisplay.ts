import type { Object3D } from 'three'
import { simPoseOf, type PlayData } from '../../play/playStore'
import { subtreeIds, type SceneObjects } from '../../scene/model'

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
