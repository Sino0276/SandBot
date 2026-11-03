import { Matrix4, Vector3 } from 'three'
import type { JointSettings } from './model'

// 관절 하나가 관절 값 q만큼 움직였을 때 그 오브젝트 로컬 좌표에서의 변환 A·M(q)·A⁻¹(spec-3b §5 D). A는 오브젝트
// 로컬의 앵커 틀(앵커 위치로 옮기기만, 축은 오브젝트 로컬 축 그대로라 회전이 없다), M(q)는 축 둘레 q rad 회전(회전 관절,
// 오른손 +) 또는 축 방향 q m 이동(직선 관절)이다. 씬 뷰는 이 행렬을 오브젝트 노드 안쪽(자기 형상과 자식을 감싼 그룹)에 두므로
// 월드 = 부모 월드 · 로컬 · A·M(q)·A⁻¹이다(scene/model.ts worldMatrix의 관절 덮어쓰기와 같은 순서). 씬 문서는 바꾸지 않는다.

type JointFrame = Pick<JointSettings, 'type' | 'anchor' | 'axis' | 'axisSign'>

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const

// 관절 축(오브젝트 로컬, 단위 벡터, 부호 포함)
export function jointAxisVector(joint: Pick<JointSettings, 'axis' | 'axisSign'>): Vector3 {
  const axis = new Vector3()
  axis.setComponent(AXIS_INDEX[joint.axis], joint.axisSign)
  return axis
}

// q = 0이면 항등이다(편집 자세)
export function jointMotionMatrix(joint: JointFrame, q: number): Matrix4 {
  const axis = jointAxisVector(joint)
  if (joint.type === 'prismatic') return new Matrix4().makeTranslation(axis.multiplyScalar(q))
  const [ax, ay, az] = joint.anchor
  return new Matrix4()
    .makeTranslation(ax, ay, az)
    .multiply(new Matrix4().makeRotationAxis(axis, q))
    .multiply(new Matrix4().makeTranslation(-ax, -ay, -az))
}

// 한계 안으로 자른다(한계가 없는 회전 관절은 그대로). 미리보기 값이 한계를 고친 뒤에도 한계 밖에 보이지 않게.
export function clampJointValue(joint: Pick<JointSettings, 'limits'>, q: number): number {
  if (!joint.limits) return q
  return Math.min(joint.limits.upper, Math.max(joint.limits.lower, q))
}
