import { computeMassModel } from '../../mass/massModel'
import type { MassLookup, MassModel } from '../../mass/types'
import { meshMassProps, meshSourceName } from '../../scene/geometryRegistry'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'

// 질량 모델(spec-3a §6). 인스펙터 카드·추정 한 줄·씬 뷰 무게중심 표시가 같은 결과를 쓰도록 마지막 계산을 기억한다
// (sceneIssues와 같은 방식). 씬 문서(objects)가 바뀌거나 형상이 등록·해제되면(geometryRevision, 메시 질량 성질도 같이
// 등록된다) 다시 계산한다. 결과는 문서 밖 값이라 실행 취소·dirty와 관계없다.

export const REGISTRY_MASS_LOOKUP: MassLookup = {
  props: meshMassProps,
  sourceName: meshSourceName
}

let cache: { objects: SceneObjects; revision: number; model: MassModel } | null = null

export function massModelFor(objects: SceneObjects, revision: number): MassModel {
  if (cache?.objects !== objects || cache.revision !== revision)
    cache = { objects, revision, model: computeMassModel(objects, REGISTRY_MASS_LOOKUP) }
  return cache.model
}

export function useMassModel(): MassModel {
  const objects = useSceneStore((state) => state.objects)
  const revision = useSceneStore((state) => state.geometryRevision)
  return massModelFor(objects, revision)
}
