import { Sphere, type BufferGeometry, type Intersection, type Mesh, type Raycaster } from 'three'
import { acceleratedRaycast, MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh'

// 큰 CAD(삼각형 수백만 개)는 기본 레이캐스트가 클릭할 때마다(R3F는 누르기·떼기·클릭마다) 광선이 경계 구에 닿은
// 메시의 삼각형을 모두 검사한다. CAD 메시는 형상마다 BVH를 만들어 그것으로 검사한다.
// indirect: 인덱스 버퍼의 삼각형 순서를 바꾸지 않는다(형상 데이터는 메시 캐시에도 쓰인다).
const BVH_OPTIONS = { indirect: true } as MeshBVHOptions

function buildBvh(geometry: BufferGeometry): void {
  if (!geometry.boundsTree) geometry.boundsTree = new MeshBVH(geometry, BVH_OPTIONS)
}

const sphere = new Sphere()

// CAD 메시의 raycast. BVH가 아직 없으면 광선이 경계 구에 닿을 때 만든다(닿지 않으면 바로 빠진다).
export function cadMeshRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
  const geometry = this.geometry
  if (!geometry.boundsTree) {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    sphere.copy(geometry.boundingSphere!).applyMatrix4(this.matrixWorld)
    if (!raycaster.ray.intersectsSphere(sphere)) return
    buildBvh(geometry)
  }
  acceleratedRaycast.call(this, raycaster, intersects)
}

// 등록한 형상의 BVH를 쉬는 시간에 미리 만든다(첫 클릭이 멈추지 않게)
const pending: BufferGeometry[] = []
let scheduled = false

function buildPending(deadline: IdleDeadline): void {
  scheduled = false
  while (pending.length && deadline.timeRemaining() > 2) buildBvh(pending.pop()!)
  if (pending.length) schedule()
}

function schedule(): void {
  if (scheduled || typeof requestIdleCallback !== 'function') return
  scheduled = true
  requestIdleCallback(buildPending)
}

export function prepareBvh(geometry: BufferGeometry): void {
  pending.push(geometry)
  schedule()
}

// 해제한 형상은 미리 만들지 않는다
export function forgetBvh(geometry: BufferGeometry): void {
  const index = pending.indexOf(geometry)
  if (index >= 0) pending.splice(index, 1)
}

export function forgetAllBvh(): void {
  pending.length = 0
}
