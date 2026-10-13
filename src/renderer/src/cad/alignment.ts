import { Matrix4, Vector3 } from 'three'
import { matrixToTransform, type AxisDirection, type Transform, type Vec3 } from '../scene/model'

export const AXIS_DIRECTIONS: AxisDirection[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']

// CAD 프로그램별 기본 방향. "앞"은 각 프로그램의 Front 뷰에서 보이는 면이다.
export const ALIGNMENT_PRESETS = {
  yUp: { upAxis: '+Y', forwardAxis: '+Z' }, // Fusion 360 기본, SolidWorks, Inventor
  zUp: { upAxis: '+Z', forwardAxis: '-Y' } // Onshape, Z-up으로 설정한 Fusion 360
} as const satisfies Record<string, CadAlignment>

export type AlignmentPreset = keyof typeof ALIGNMENT_PRESETS

export type CadAlignment = { upAxis: AxisDirection; forwardAxis: AxisDirection }

export const DEFAULT_ALIGNMENT: CadAlignment = ALIGNMENT_PRESETS.yUp

export function axisVector(axis: AxisDirection): Vector3 {
  const sign = axis[0] === '-' ? -1 : 1
  const index = 'XYZ'.indexOf(axis[1])
  return new Vector3().setComponent(index, sign)
}

export function isValidAlignment({ upAxis, forwardAxis }: CadAlignment): boolean {
  return upAxis[1] !== forwardAxis[1]
}

export function findPreset(alignment: CadAlignment): AlignmentPreset | null {
  const entry = Object.entries(ALIGNMENT_PRESETS).find(
    ([, preset]) =>
      preset.upAxis === alignment.upAxis && preset.forwardAxis === alignment.forwardAxis
  )
  return entry ? (entry[0] as AlignmentPreset) : null
}

// CAD 좌표 → 로봇 좌표 회전. CAD의 앞쪽 축이 로봇 +X, 위쪽 축이 로봇 +Z가 된다.
export function alignmentRotation({ upAxis, forwardAxis }: CadAlignment): Matrix4 {
  const forward = axisVector(forwardAxis)
  const up = axisVector(upAxis)
  const left = new Vector3().crossVectors(up, forward)
  // 행이 각각 로봇 X(앞)·Y(왼쪽)·Z(위) 축을 CAD 좌표로 나타낸다
  // prettier-ignore
  return new Matrix4().set(
    forward.x, forward.y, forward.z, 0,
    left.x, left.y, left.z, 0,
    up.x, up.y, up.z, 0,
    0, 0, 0, 1
  )
}

export function boundsCenter(bounds: { min: Vec3; max: Vec3 }): Vec3 {
  return [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as Vec3
}

// CAD 루트 노드(피벗 = 경계 상자 중심)의 변환. 정렬한 모델의 바닥 면 중심이 로봇 원점(로봇 중심 바닥)에 오게 한다.
export function cadRootTransform(
  bounds: { min: Vec3; max: Vec3 },
  alignment: CadAlignment
): Transform {
  const rotation = alignmentRotation(alignment)
  const corners: Vector3[] = []
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]])
        corners.push(new Vector3(x, y, z).applyMatrix4(rotation))
  const min = corners.reduce((a, b) => a.clone().min(b))
  const max = corners.reduce((a, b) => a.clone().max(b))
  const offset = new Vector3(-(min.x + max.x) / 2, -(min.y + max.y) / 2, -min.z)

  const pivot = new Vector3(...boundsCenter(bounds)).applyMatrix4(rotation).add(offset)
  return matrixToTransform(rotation.clone().setPosition(pivot))
}
