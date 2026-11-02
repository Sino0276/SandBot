import type { BufferGeometry } from 'three'
import { meshMassState } from '../cad/meshMass'
import { cadRootIdOf } from '../cad/stepImport'
import type { CadMassSummary, MeshMassProps } from '../mass/types'
import { forgetAllBvh, forgetBvh, prepareBvh } from './meshBvh'

// CAD 메시 형상 보관소. 씬 스토어에는 직렬화할 수 있는 데이터만 두고, 큰 형상은 id로 여기서 찾는다.
const geometries = new Map<string, BufferGeometry>()

// 형상과 같은 id·수명으로 두는 메시 정보(spec-3a §1): 질량 성질과 원래 CAD 이름
export type MeshInfo = { mass?: MeshMassProps; sourceName?: string }
const meshInfo = new Map<string, MeshInfo>()
// CAD 루트 id → 그 CAD의 형상 id(cadGeometryId의 접두어로 묶는다, cadMassSummary용)
const cadMeshes = new Map<string, Set<string>>()
// 형상을 읽는 중인 CAD 루트 → 그 CAD의 메시 수(cad.meshCount). 읽기마다 다른 객체라 늦게 끝난 읽기가 지우지 않는다.
const loadingCads = new Map<string, { meshCount: number }>()

export function registerGeometry(id: string, geometry: BufferGeometry, info: MeshInfo = {}): void {
  release(geometries.get(id))
  geometries.set(id, geometry)
  meshInfo.set(id, info)
  const cadRootId = cadRootIdOf(id)
  if (cadRootId !== null) {
    let ids = cadMeshes.get(cadRootId)
    if (!ids) cadMeshes.set(cadRootId, (ids = new Set()))
    ids.add(id)
  }
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
  meshInfo.delete(id)
  const cadRootId = cadRootIdOf(id)
  const ids = cadRootId === null ? undefined : cadMeshes.get(cadRootId)
  if (ids) {
    ids.delete(id)
    if (ids.size === 0) cadMeshes.delete(cadRootId!)
  }
}

// 프로젝트를 새로 열 때 이전 씬의 형상을 모두 해제한다(같은 id로 다시 읽지 못한 형상이 남지 않게)
export function disposeAllGeometry(): void {
  for (const geometry of geometries.values()) geometry.dispose()
  geometries.clear()
  meshInfo.clear()
  cadMeshes.clear()
  loadingCads.clear()
  forgetAllBvh()
}

export function geometryIds(): string[] {
  return [...geometries.keys()]
}

// 메시의 질량 성질(spec-3a §1). 형상과 같은 id·수명이라 형상을 해제하면 함께 지워진다.
export function meshMassProps(id: string): MeshMassProps | undefined {
  return meshInfo.get(id)?.mass
}

// 원래 CAD 이름(이름 규칙용, cad/stepImport.ts의 meshSourceNames). 오브젝트 이름을 바꿔도 남는다.
export function meshSourceName(id: string): string | undefined {
  return meshInfo.get(id)?.sourceName
}

// CAD 루트의 형상을 읽기 시작한다(cadMassSummary의 pendingMeshes). 돌려준 함수로 끝낸다. 그사이 같은 CAD를 다시
// 읽기 시작했거나 프로젝트를 새로 열었으면(disposeAllGeometry) 끝내기는 아무것도 하지 않는다.
export function beginCadLoad(cadRootId: string, meshCount: number): () => void {
  const entry = { meshCount }
  loadingCads.set(cadRootId, entry)
  return () => {
    if (loadingCads.get(cadRootId) === entry) loadingCads.delete(cadRootId)
  }
}

// CAD 루트의 메시 상태 요약(열린·표면·읽는 중). 등록한 형상도 읽는 중도 없으면 undefined.
// openVolumeFraction은 질량에 쓰는 메시(닫힘·열림) 부피 가운데 열린 메시의 비율이다. 읽는 중이면 아직 등록하지 않은
// 메시 수를 pendingMeshes로 센다(다시 읽는 동안에는 이전 형상이 남아 있어 그만큼 빠진다).
export function cadMassSummary(cadRootId: string): CadMassSummary | undefined {
  const ids = cadMeshes.get(cadRootId)
  const loading = loadingCads.get(cadRootId)
  if (!ids && !loading) return undefined
  let openMeshes = 0
  let surfaceMeshes = 0
  let openVolume = 0
  let usedVolume = 0
  for (const id of ids ?? []) {
    const mass = meshInfo.get(id)?.mass
    if (!mass) continue
    const state = meshMassState(mass)
    if (state === 'surface') {
      surfaceMeshes++
      continue
    }
    usedVolume += mass.volume
    if (state === 'open') {
      openMeshes++
      openVolume += mass.volume
    }
  }
  const meshes = ids?.size ?? 0
  return {
    meshes,
    openMeshes,
    openVolumeFraction: usedVolume > 0 ? openVolume / usedVolume : 0,
    surfaceMeshes,
    pendingMeshes: loading ? Math.max(0, loading.meshCount - meshes) : 0
  }
}
