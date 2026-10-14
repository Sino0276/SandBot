import type { BufferGeometry } from 'three'
import { forgetAllBvh, forgetBvh, prepareBvh } from './meshBvh'

// CAD 메시 형상 보관소. 씬 스토어에는 직렬화할 수 있는 데이터만 두고, 큰 형상은 id로 여기서 찾는다.
const geometries = new Map<string, BufferGeometry>()

export function registerGeometry(id: string, geometry: BufferGeometry): void {
  release(geometries.get(id))
  geometries.set(id, geometry)
  // 클릭 선택용 BVH를 쉬는 시간에 만든다(scene/meshBvh.ts)
  prepareBvh(geometry)
}

function release(geometry: BufferGeometry | undefined): void {
  if (!geometry) return
  forgetBvh(geometry)
  geometry.dispose()
}

export function getGeometry(id: string): BufferGeometry | undefined {
  return geometries.get(id)
}

export function disposeGeometry(id: string): void {
  release(geometries.get(id))
  geometries.delete(id)
}

// 프로젝트를 새로 열 때 이전 씬의 형상을 모두 해제한다(같은 id로 다시 읽지 못한 형상이 남지 않게)
export function disposeAllGeometry(): void {
  for (const geometry of geometries.values()) geometry.dispose()
  geometries.clear()
  forgetAllBvh()
}

export function geometryIds(): string[] {
  return [...geometries.keys()]
}
