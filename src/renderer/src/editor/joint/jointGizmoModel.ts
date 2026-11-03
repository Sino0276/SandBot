import { BufferGeometry, Float32BufferAttribute, Quaternion, Vector3 } from 'three'
import { jointAxisVector } from '../../scene/jointMotion'
import {
  transformToMatrix,
  worldMatrix,
  type JointSettings,
  type RootOverride,
  type SceneObjects
} from '../../scene/model'

// 씬 뷰 관절 표시(JointGizmo.tsx)의 선과 틀 계산(그리기와 나눠 시험한다)

// 크기(m, 가정: FTC 메커니즘 크기에 보기 좋은 값)
const AXIS_LENGTH = 0.12
const ARC_RADIUS = 0.06
const ZERO_TICK = 0.015
// 호 하나의 선분 수(한 바퀴 기준)
const ARC_SEGMENTS = 96

// 축에 수직인 기준 방향(q = 0의 눈금): 로컬 축을 x → y → z → x 순으로 돌린 것
const PERPENDICULAR = { x: 'y', y: 'z', z: 'x' } as const

type Lines = { axis: BufferGeometry; limits: BufferGeometry; ends: Vector3[]; cone: Vector3 }

function lineGeometry(points: Vector3[]): BufferGeometry {
  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(
      points.flatMap((p) => [p.x, p.y, p.z]),
      3
    )
  )
}

// 관절 틀(오브젝트 로컬)의 선. 회전 관절의 호는 축 둘레 오른손 방향으로 아래 → 위 한계(한계가 없으면 한 바퀴).
export function jointGizmoLines(joint: JointSettings): Lines {
  const anchor = new Vector3(...joint.anchor)
  const axis = jointAxisVector(joint)
  const tip = anchor.clone().addScaledVector(axis, AXIS_LENGTH)
  const axisLine = lineGeometry([anchor, tip])
  if (joint.type === 'prismatic') {
    const lower = anchor.clone().addScaledVector(axis, joint.limits?.lower ?? 0)
    const upper = anchor.clone().addScaledVector(axis, joint.limits?.upper ?? 0)
    return { axis: axisLine, limits: lineGeometry([lower, upper]), ends: [lower, upper], cone: tip }
  }
  const e1 = jointAxisVector({ axis: PERPENDICULAR[joint.axis], axisSign: 1 })
  const e2 = axis.clone().cross(e1)
  const at = (angle: number, radius = ARC_RADIUS): Vector3 =>
    anchor
      .clone()
      .addScaledVector(e1, radius * Math.cos(angle))
      .addScaledVector(e2, radius * Math.sin(angle))
  const span = joint.limits ? joint.limits.upper - joint.limits.lower : 2 * Math.PI
  const start = joint.limits ? joint.limits.lower : 0
  const count = Math.max(2, Math.ceil((Math.min(span, 2 * Math.PI) / (2 * Math.PI)) * ARC_SEGMENTS))
  const points: Vector3[] = []
  // 선분 목록(LineSegments): 호의 이웃한 점 쌍과 0 자리 눈금
  for (let i = 0; i < count; i++) {
    points.push(at(start + (span * i) / count), at(start + (span * (i + 1)) / count))
  }
  points.push(at(0, ARC_RADIUS - ZERO_TICK), at(0, ARC_RADIUS + ZERO_TICK))
  const ends = joint.limits ? [at(joint.limits.lower), at(joint.limits.upper)] : []
  return { axis: axisLine, limits: lineGeometry(points), ends, cone: tip }
}

// 관절 틀의 월드 자세: 부모 월드(표시 덮어쓰기) · 오브젝트 로컬(자기 관절의 움직임은 빼고)
export function jointFrameMatrix(
  objects: SceneObjects,
  id: string,
  override: RootOverride | null
): { position: Vector3; quaternion: Quaternion } {
  const object = objects[id]
  const local = transformToMatrix(object.transform)
  // 로봇에는 관절을 두지 않으므로 최상위 관절 오브젝트(로봇 밖)는 덮어쓰기와 관계없다
  const matrix = object.parentId
    ? worldMatrix(objects, object.parentId, override).multiply(local)
    : local
  const position = new Vector3()
  const quaternion = new Quaternion()
  matrix.decompose(position, quaternion, new Vector3())
  return { position, quaternion }
}
