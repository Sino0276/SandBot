import { Vector3 } from 'three'

// 기본 시점: 필드 모서리 위에서 필드 중앙을 본다
export const FIELD_VIEW_POSITION = new Vector3(-2.8, -3.6, 2.8)

// drei OrbitControls(three-stdlib) 중 여기서 쓰는 부분
export type OrbitControlsLike = {
  target: Vector3
  update: () => unknown
}

export function isOrbitControls(controls: unknown): controls is OrbitControlsLike {
  return typeof controls === 'object' && controls !== null && 'target' in controls
}
