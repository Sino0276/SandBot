import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection
} from 'three'
import { describe, expect, it } from 'vitest'
import { cadMeshRaycast } from './meshBvh'

function hits(mesh: Mesh, origin: Vector3, direction: Vector3): Intersection[] {
  const raycaster = new Raycaster(origin, direction.normalize())
  return raycaster.intersectObject(mesh)
}

describe('cadMeshRaycast', () => {
  it('기본 레이캐스트와 같은 교점을 낸다', () => {
    const plain = new Mesh(new SphereGeometry(1, 32, 16), new MeshBasicMaterial())
    plain.position.set(0.3, -0.2, 0.1)
    plain.rotation.set(0.4, 0.2, -0.7)
    plain.updateMatrixWorld()
    const fast = new Mesh(plain.geometry.clone(), plain.material)
    fast.position.copy(plain.position)
    fast.rotation.copy(plain.rotation)
    fast.updateMatrixWorld()
    fast.raycast = cadMeshRaycast

    const indexBefore = Array.from(fast.geometry.index!.array)
    for (const [origin, direction] of [
      [new Vector3(-5, 0, 0), new Vector3(1, 0, 0)],
      [new Vector3(0.5, 5, 0.2), new Vector3(-0.1, -1, 0)],
      [new Vector3(3, 3, 3), new Vector3(-1, -1, -1)]
    ]) {
      const expected = hits(plain, origin, direction.clone())
      const actual = hits(fast, origin, direction.clone())
      expect(actual.map((hit) => hit.faceIndex)).toEqual(expected.map((hit) => hit.faceIndex))
      actual.forEach((hit, i) => expect(hit.distance).toBeCloseTo(expected[i].distance, 9))
    }
    expect(fast.geometry.boundsTree).toBeDefined()
    // 인덱스 순서를 바꾸지 않는다(메시 캐시에 쓰는 형상 데이터)
    expect(Array.from(fast.geometry.index!.array)).toEqual(indexBefore)
  })

  it('경계 구에 닿지 않으면 BVH를 만들지 않는다', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    mesh.updateMatrixWorld()
    mesh.raycast = cadMeshRaycast
    expect(hits(mesh, new Vector3(-5, 3, 0), new Vector3(1, 0, 0))).toEqual([])
    expect(mesh.geometry.boundsTree).toBeUndefined()
  })
})
