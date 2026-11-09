import { applyMatrix3, matMul3, rotationMatrix } from './seasons/fieldGeometry'
import type { Pose2, SensorMount, Vec3 } from './worldSpec'

// 센서의 필드 자세(spec-4c §1.2, 순수·결정적). 세계(world.ts)가 틱마다 몸체 틀을 만들고 센서 장착(SensorMount)을 곱해
// 광선 원점·방향을 얻는다. 렌더러 기즈모·인스펙터와 4d 카메라도 같은 함수를 쓴다.
// 회전은 3×3 행 우선 9원소 배열이고, 장착 회전은 ZYX(R = Rz·Ry·Rx, seasons/fieldGeometry.ts rotationMatrix)다.

// 몸체 틀(필드 좌표): 회전과 원점. 섀시는 planarFrame(로봇 자세), 관절 몸체는 Articulation의 몸체 자세다.
export type Frame3 = { rotation: readonly number[]; origin: Vec3 }

// 센서의 필드 자세: 원점(하우징 앞면, 광선 원점)과 회전(센서 +X = 보는 방향, +Z = 광선 방위각의 기준)
export type SensorPose = { origin: Vec3; rotation: readonly number[] }

// 바닥 위 평면 자세 → 몸체 틀: Rz(yaw), 원점 (x, y, 0)
export function planarFrame(pose: Pose2): Frame3 {
  const c = Math.cos(pose.yaw)
  const s = Math.sin(pose.yaw)
  return { rotation: [c, -s, 0, s, c, 0, 0, 0, 1], origin: { x: pose.x, y: pose.y, z: 0 } }
}

// a ∘ b: b 틀의 점 p를 a 틀 밖으로 옮기면 a.R·(b.R·p + b.o) + a.o
export function composeFrames(a: Frame3, b: Frame3): Frame3 {
  const moved = applyMatrix3(a.rotation, b.origin)
  return {
    rotation: matMul3(a.rotation, b.rotation),
    origin: { x: a.origin.x + moved.x, y: a.origin.y + moved.y, z: a.origin.z + moved.z }
  }
}

// 몸체 틀 위의 장착 → 센서의 필드 자세(mount.body는 쓰지 않는다: 부르는 쪽이 그 몸체의 틀을 넘긴다)
export function sensorPose(body: Frame3, mount: SensorMount): SensorPose {
  const frame = composeFrames(body, {
    rotation: rotationMatrix(mount.rotation),
    origin: mount.position
  })
  return { origin: frame.origin, rotation: frame.rotation }
}

// 센서가 보는 방향(필드 좌표 단위 벡터) = rotation·x̂(행렬의 첫 열)
export function sensorAxis(pose: SensorPose): Vec3 {
  return { x: pose.rotation[0], y: pose.rotation[3], z: pose.rotation[6] }
}

// 렌더러 표시용: 필드 좌표 4×4 행렬(three Matrix4.elements, 열 우선)에서 센서 자세를 꺼낸다. 표시 행렬에는 척도가 없다고
// 본다(씬 오브젝트 transform은 위치·회전뿐이다).
export function sensorPoseFromMatrix(elements: readonly number[]): SensorPose {
  const e = elements
  return {
    origin: { x: e[12], y: e[13], z: e[14] },
    rotation: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]
  }
}
