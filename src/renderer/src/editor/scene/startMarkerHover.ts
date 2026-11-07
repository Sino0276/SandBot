import type { Object3D, Raycaster } from 'three'

// 시작 표시 위 커서의 가림 판정(spec-4ab §1.9 시작 표시, 4ab 리뷰 수정). R3F는 포인터 이동 때 이동·들어감·나감 처리기가 있는
// 오브젝트만 광선과 맞춰 보므로, 클릭 처리기만 있는 로봇 파트는 표시를 가리지 못해 표시 위 커서가 로봇 너머로도 손가락이
// 된다. 클릭은 처리기가 있는 모든 오브젝트를 거리순으로 보므로 앞의 파트가 받고(전파를 막는다) 스냅하지 않는다. 그래서
// 표시 위에 있을 때만 R3F의 사건 오브젝트 목록(internal.interaction)을 같은 광선으로 맞춰, 표시보다 가까운 것이 있으면 가린
// 것으로 본다.

// 같은 거리로 보는 차(m). [가정: 표시는 바닥에서 띄운 평면이고 로봇 파트가 그와 1 µm 안에 겹칠 일은 없다]
const OCCLUSION_EPSILON = 1e-6

function isWithin(object: Object3D, root: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) if (node === root) return true
  return false
}

// markers(표시 묶음) 밖의 사건 오브젝트가 광선을 따라 distance(표시까지)보다 가까이 있는가
export function markerOccluded(
  raycaster: Raycaster,
  interaction: readonly Object3D[],
  markers: Object3D,
  distance: number
): boolean {
  for (const object of interaction) {
    if (isWithin(object, markers)) continue
    const nearest = raycaster.intersectObject(object, true)[0]
    if (nearest && nearest.distance < distance - OCCLUSION_EPSILON) return true
  }
  return false
}
