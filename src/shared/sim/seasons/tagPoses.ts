// AprilTag 필드 자세와 SDK 묶음 원점(4d, spec-4d §1.6). 시뮬레이터 비전(vision.ts)의 판정 자세, Field 인스펙터의 묶음
// 원점 줄, 4ab 태그 참값 시험(tags.test.ts)이 같이 쓴다. 순수·결정적이고 ../worldSpec에서는 형식만 들여온다(4ab 규칙, 순환).

import type { Vec3 } from '../worldSpec'
import { applyMatrix3, matMul3, rotationMatrix } from './fieldGeometry'
import type { FieldCarrier, FieldSpec, FieldTag } from './fieldSpec'

// 필드 자세: 위치(m, 필드 좌표)와 행 우선 3×3 회전(열 = 요소 축의 필드 좌표)
export type FieldPose3 = { position: Vec3; rotation: readonly number[] }

// carrier 틀의 필드 각(+Y축 둘레, rad). 'field'는 0, HIVE는 hiveTipped([빨강, 파랑])로 시작·넘어간 각
export function carrierAngle(
  field: FieldSpec,
  carrier: FieldCarrier,
  hiveTipped: readonly [boolean, boolean]
): number {
  if (carrier === 'field') return 0
  const hive = field.hives.find((h) => h.key === carrier)
  if (!hive) throw new Error(`carrier ${carrier}가 시즌 데이터에 없다`)
  const tipped = carrier === 'hiveRed' ? hiveTipped[0] : hiveTipped[1]
  return tipped ? hive.tippedAngle : hive.startAngle
}

// carrier 위 요소의 필드 자세: T(pivot)·R_y(θ)·T(position)·R_zyx(rotation)(4ab 규칙, 행렬 곱이고 Euler 각을 더하지 않는다)
export function tagFieldPose(
  field: FieldSpec,
  tag: FieldTag,
  hiveTipped: readonly [boolean, boolean]
): FieldPose3 {
  const local = rotationMatrix(tag.rotation)
  if (tag.carrier === 'field') return { position: { ...tag.position }, rotation: local }
  const hive = field.hives.find((h) => h.key === tag.carrier)
  if (!hive) throw new Error(`carrier ${tag.carrier}가 시즌 데이터에 없다`)
  const carrier = rotationMatrix({ x: 0, y: carrierAngle(field, tag.carrier, hiveTipped), z: 0 })
  const p = applyMatrix3(carrier, tag.position)
  return {
    position: { x: hive.pivot.x + p.x, y: hive.pivot.y + p.y, z: hive.pivot.z + p.z },
    rotation: matMul3(carrier, local)
  }
}

// SDK getBioBuzzTagLibrary의 묶음 멤버 위치(in, Vision 12.0 AprilTagGameDatabase.java:198–216): x는 첫 id부터
// −6.50·−2.75·2.75·6.50, y 7.1874f, z −5.622f(Java float 리터럴이라 Math.fround). 묶음 틀 축은 멤버 태그 축과 같다.
export const SDK_BIOBUZZ_CLUSTER_MEMBER_X: readonly number[] = [-6.5, -2.75, 2.75, 6.5]
export const SDK_BIOBUZZ_CLUSTER_OFFSET_Y: number = Math.fround(7.1874)
export const SDK_BIOBUZZ_CLUSTER_OFFSET_Z: number = Math.fround(-5.622)

// SDK 라이브러리의 묶음 순서(AprilTagGameDatabase.getBioBuzzTagLibrary)
const SDK_CLUSTER_ORDER = ['RED SCORING', 'RED AUDIENCE', 'BLUE AUDIENCE', 'BLUE SCORING'] as const

const METERS_PER_INCH = 0.0254

// 묶음 하나의 필드 자세. quaternion은 [w, x, y, z](Hamilton, RobotCore Quaternion.toMatrix가 쓰는 능동 회전 묶음 틀 →
// 필드, w ≥ 0으로 정규화)이고 팀이 new Quaternion(w, x, y, z, 0)에 넣는 값이다.
export type ClusterFieldPose = {
  name: string
  firstId: number
  position: Vec3
  rotation: readonly number[]
  quaternion: [number, number, number, number]
}

// 행 우선 회전 행렬 → 단위 사원수 [w, x, y, z](Shepperd: 대각합과 대각 원소 중 가장 큰 것으로 나눠 수치 안정), w ≥ 0
function matrixQuaternion(m: readonly number[]): [number, number, number, number] {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m
  const trace = m00 + m11 + m22
  let q: [number, number, number, number]
  if (trace >= m00 && trace >= m11 && trace >= m22) {
    const s = 2 * Math.sqrt(1 + trace)
    q = [s / 4, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s]
  } else if (m00 >= m11 && m00 >= m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = [(m21 - m12) / s, s / 4, (m01 + m10) / s, (m02 + m20) / s]
  } else if (m11 >= m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = [(m02 - m20) / s, (m01 + m10) / s, s / 4, (m12 + m21) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, s / 4]
  }
  const norm = Math.hypot(q[0], q[1], q[2], q[3])
  const sign = q[0] < 0 ? -1 : 1
  return [
    (sign * q[0]) / norm + 0,
    (sign * q[1]) / norm + 0,
    (sign * q[2]) / norm + 0,
    (sign * q[3]) / norm + 0
  ]
}

// 묶음 멤버(id 오름차순) k의 묶음 틀 위치(m)
function memberOffset(k: number): Vec3 {
  return {
    x: SDK_BIOBUZZ_CLUSTER_MEMBER_X[k] * METERS_PER_INCH,
    y: SDK_BIOBUZZ_CLUSTER_OFFSET_Y * METERS_PER_INCH,
    z: SDK_BIOBUZZ_CLUSTER_OFFSET_Z * METERS_PER_INCH
  }
}

// 멤버 태그 하나로 낸 묶음 원점 = 태그 중심 − R_tag·(x_k, offY, offZ)·0.0254(k = 묶음 안 id 오름차순 순번)
export function clusterOriginFromMember(
  field: FieldSpec,
  tag: FieldTag,
  member: number,
  hiveTipped: readonly [boolean, boolean]
): FieldPose3 {
  const pose = tagFieldPose(field, tag, hiveTipped)
  const offset = applyMatrix3(pose.rotation, memberOffset(member))
  return {
    position: {
      x: pose.position.x - offset.x,
      y: pose.position.y - offset.y,
      z: pose.position.z - offset.z
    },
    rotation: pose.rotation
  }
}

// 묶음마다 필드 자세(SDK 라이브러리 순서, 그 시즌에 있는 묶음만). 첫 id 태그와 그 SDK 멤버 위치로 낸다.
export function clusterFieldPoses(
  field: FieldSpec,
  hiveTipped: readonly [boolean, boolean]
): ClusterFieldPose[] {
  const out: ClusterFieldPose[] = []
  for (const name of SDK_CLUSTER_ORDER) {
    const members = field.aprilTags.tags
      .filter((tag) => tag.cluster === name)
      .sort((a, b) => a.id - b.id)
    if (members.length === 0) continue
    const { position, rotation } = clusterOriginFromMember(field, members[0], 0, hiveTipped)
    out.push({
      name,
      firstId: members[0].id,
      position,
      rotation,
      quaternion: matrixQuaternion(rotation)
    })
  }
  return out
}
