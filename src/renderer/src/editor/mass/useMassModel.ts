import { useSyncExternalStore } from 'react'
import { computeMassModel } from '../../mass/massModel'
import type { CadMassSummary, MassLookup, MassModel } from '../../mass/types'
import { cadMassSummary, meshMassProps, meshSourcePath } from '../../scene/geometryRegistry'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { isChangeOpen } from '../history'

// 질량 모델(spec-3a §6). 인스펙터 카드·추정 한 줄·씬 뷰 무게중심 표시가 같은 결과를 쓰도록 마지막 계산을 기억한다
// (sceneIssues와 같은 방식). 씬 문서(objects)가 바뀌거나 형상이 등록·해제되면(geometryRevision, 메시 질량 성질도 같이
// 등록된다) 다시 계산한다. 결과는 문서 밖 값이라 실행 취소·dirty와 관계없다.
//
// 핸들 드래그처럼 묶는 중인 변경(history의 isChangeOpen) 동안에는 문서가 프레임마다 바뀐다. 큰 CAD(메시 1761개)에서
// 한 번 계산이 한 프레임보다 길어(약 40 ms) 드래그가 끊기므로, 그동안은 마지막 결과를 쓰고 DRAG_REFRESH_MS마다만
// 다시 계산한다. 묶음이 닫히면 다음 새로 고침에서 마지막 문서로 다시 계산한다(보기만 늦을 뿐 결과는 같다).

export const REGISTRY_MASS_LOOKUP: MassLookup = {
  props: meshMassProps,
  sourcePath: meshSourcePath
}

// 형상의 메시 질량 성질이 등록됐는지(카드의 읽는 중 표시가 질량 모델과 같은 형상을 본다)
export const hasMassProps = (geometryId: string): boolean => meshMassProps(geometryId) !== undefined

// 드래그 중 다시 계산하는 간격(ms). 무게중심 표시가 따라오는 것이 보일 만큼 짧고, 계산이 드래그 시간의 일부만 쓰게 길다.
export const DRAG_REFRESH_MS = 250

// 마지막 계산. CAD 루트 요약(cadMassSummary)도 그 계산과 같은 문서(objects)로 구해 모델이 바뀔 때까지 기억한다.
let cache: {
  objects: SceneObjects
  revision: number
  model: MassModel
  at: number
  summaries: Map<string, CadMassSummary | undefined>
} | null = null

// 미뤄 둔 계산을 다시 하라고 구독자(useMassModel)에게 알린다
let refreshVersion = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function scheduleRefresh(delay: number): void {
  if (refreshTimer !== null) return
  refreshTimer = setTimeout(
    () => {
      refreshTimer = null
      refreshVersion++
      for (const listener of [...listeners]) listener()
    },
    Math.max(0, delay)
  )
}

function subscribeRefresh(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const refreshSnapshot = (): number => refreshVersion

export function massModelFor(
  objects: SceneObjects,
  revision: number,
  now: number = performance.now()
): MassModel {
  if (cache?.objects === objects && cache.revision === revision) return cache.model
  if (cache && isChangeOpen() && now - cache.at < DRAG_REFRESH_MS) {
    scheduleRefresh(DRAG_REFRESH_MS - (now - cache.at))
    return cache.model
  }
  cache = {
    objects,
    revision,
    model: computeMassModel(objects, REGISTRY_MASS_LOOKUP),
    at: now,
    summaries: new Map()
  }
  return cache.model
}

// CAD 루트마다 메시 상태 요약(열린·표면·읽는 중). 질량 모델을 계산한 문서를 cadMassSummary에 넘겨(그 문서가 쓰는 형상만
// 센다) 카드·추정 한 줄이 모델과 같은 문서의 요약을 본다. 드래그 중 미룬 계산이면 요약도 그 계산의 문서다.
export function cadSummaryFor(
  objects: SceneObjects,
  revision: number,
  now: number = performance.now()
): (cadRootId: string) => CadMassSummary | undefined {
  massModelFor(objects, revision, now)
  const entry = cache!
  return (cadRootId) => {
    if (!entry.summaries.has(cadRootId))
      entry.summaries.set(cadRootId, cadMassSummary(cadRootId, entry.objects))
    return entry.summaries.get(cadRootId)
  }
}

export function useMassModel(): MassModel {
  const objects = useSceneStore((state) => state.objects)
  const revision = useSceneStore((state) => state.geometryRevision)
  // 드래그 중 미룬 계산을 새로 고칠 때 다시 그린다(값은 쓰지 않는다)
  useSyncExternalStore(subscribeRefresh, refreshSnapshot, refreshSnapshot)
  return massModelFor(objects, revision)
}

export function useCadMassSummary(): (cadRootId: string) => CadMassSummary | undefined {
  const objects = useSceneStore((state) => state.objects)
  const revision = useSceneStore((state) => state.geometryRevision)
  useSyncExternalStore(subscribeRefresh, refreshSnapshot, refreshSnapshot)
  return cadSummaryFor(objects, revision)
}
