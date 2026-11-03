import type { BufferGeometry } from 'three'
import { meshMassState } from '../cad/meshMass'
import { cadRootIdOf } from '../cad/stepImport'
import type { CadMassSummary, MeshMassProps, SourceNode } from '../mass/types'
import { forgetAllBvh, forgetBvh, prepareBvh } from './meshBvh'
import type { SceneObjects } from './model'
import { useSceneStore } from './sceneStore'

// CAD 메시 형상 보관소. 씬 스토어에는 직렬화할 수 있는 데이터만 두고, 큰 형상은 id로 여기서 찾는다.
const geometries = new Map<string, BufferGeometry>()

// 형상과 같은 id·수명으로 두는 메시 정보(spec-3a §1): 질량 성질과 원래 이름 경로(cad/stepImport.ts의 meshSourcePaths)
export type MeshInfo = { mass?: MeshMassProps; sourcePath?: readonly SourceNode[] }
const meshInfo = new Map<string, MeshInfo>()
// 형상을 읽는 중이거나 읽을 차례를 기다리는 CAD 루트 → 그 읽기의 표식. 읽기마다 다른 객체라 늦게 끝난 읽기가 새
// 읽기의 상태를 지우지 않는다.
const loadingCads = new Map<string, object>()

export function registerGeometry(id: string, geometry: BufferGeometry, info: MeshInfo = {}): void {
  release(geometries.get(id))
  geometries.set(id, geometry)
  meshInfo.set(id, info)
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
}

// 프로젝트를 새로 열 때 이전 씬의 형상을 모두 해제한다(같은 id로 다시 읽지 못한 형상이 남지 않게)
export function disposeAllGeometry(): void {
  for (const geometry of geometries.values()) geometry.dispose()
  geometries.clear()
  meshInfo.clear()
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

// 원래 이름 경로(질량 모델의 이름 규칙·SKU용): CAD 루트 노드부터 이 메시의 파트 노드까지 불러올 때의 이름. 오브젝트
// 이름을 바꾸거나 옮겨도 남는다.
export function meshSourcePath(id: string): readonly SourceNode[] | undefined {
  return meshInfo.get(id)?.sourcePath
}

// CAD 루트를 읽는 중으로 둔다(cadMassSummary의 pendingMeshes). 형상을 읽는 동안과, 프로젝트를 열 때 차례를 기다리는
// 동안(projectActions) 부른다. 돌려준 함수로 끝낸다. 그사이 같은 CAD를 다시 읽기 시작했거나 프로젝트를 새로
// 열었으면(disposeAllGeometry) 끝내기는 아무것도 하지 않는다. 요약이 바뀌므로 시작·끝마다 형상 revision을 올린다
// (useMassModel이 다시 계산한다).
export function beginCadLoad(cadRootId: string): () => void {
  const token = {}
  loadingCads.set(cadRootId, token)
  useSceneStore.getState().bumpGeometryRevision()
  return () => {
    if (loadingCads.get(cadRootId) !== token) return
    loadingCads.delete(cadRootId)
    useSceneStore.getState().bumpGeometryRevision()
  }
}

// 씬 문서가 쓰는 CAD 형상 id를 CAD 루트(cadGeometryId의 접두어)마다 모은다. 불변 문서마다 한 번 만든다.
// 다른 그룹으로 옮긴 파트(cadOrigin)도 형상 id 접두어가 그 CAD 루트다.
const sceneCadMeshes = new WeakMap<SceneObjects, Map<string, Set<string>>>()

function cadMeshesInScene(objects: SceneObjects): Map<string, Set<string>> {
  let index = sceneCadMeshes.get(objects)
  if (index) return index
  index = new Map()
  for (const object of Object.values(objects)) {
    if (object.visual?.type !== 'mesh') continue
    const cadRootId = cadRootIdOf(object.visual.geometryId)
    if (cadRootId === null) continue
    let ids = index.get(cadRootId)
    if (!ids) index.set(cadRootId, (ids = new Set()))
    ids.add(object.visual.geometryId)
  }
  sceneCadMeshes.set(objects, index)
  return index
}

// CAD 루트의 메시 상태 요약(열린·표면·읽는 중). 지금 씬 문서(기본은 sceneStore)의 오브젝트가 쓰는 형상만 센다.
// 지운 파트의 형상은 실행 취소 기록이 들고 있거나(history), 저장 뒤 다시 열 때 STEP 전체를 등록해 남지만 세지 않는다.
// 씬이 그 CAD의 형상을 하나도 쓰지 않으면 undefined.
// - meshes: 형상이 등록된 메시 수(다시 읽는 동안에는 이전 형상)
// - openVolumeFraction: 질량에 쓰는 메시(닫힘·열림) 부피 가운데 열린 메시의 비율
// - pendingMeshes: 그 CAD를 읽는 중이거나 읽을 차례를 기다리면 씬이 쓰는 그 CAD의 메시 수, 아니면 0. 형상은 읽기가
//   끝난 뒤 한꺼번에 등록하므로 다시 읽는 동안에는 이전 형상(meshes)과 겹쳐 센다. 읽기가 끝나면(실패·취소 포함) 0이고,
//   실패·못 찾음은 projectStore.cadStatus·missingCad가 알린다.
export function cadMassSummary(
  cadRootId: string,
  objects: SceneObjects = useSceneStore.getState().objects
): CadMassSummary | undefined {
  const ids = cadMeshesInScene(objects).get(cadRootId)
  if (!ids) return undefined
  const pendingMeshes = loadingCads.has(cadRootId) ? ids.size : 0
  let meshes = 0
  let openMeshes = 0
  let surfaceMeshes = 0
  let openVolume = 0
  let usedVolume = 0
  for (const id of ids) {
    if (!geometries.has(id)) continue
    meshes++
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
  return {
    meshes,
    openMeshes,
    openVolumeFraction: usedVolume > 0 ? openVolume / usedVolume : 0,
    surfaceMeshes,
    pendingMeshes
  }
}
