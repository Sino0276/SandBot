import { useSyncExternalStore } from 'react'
import { computeMassModel } from '../../mass/massModel'
import type { MassLookup, MassModel } from '../../mass/types'
import { meshMassProps, meshSourceName } from '../../scene/geometryRegistry'
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
  sourceName: meshSourceName
}

// 드래그 중 다시 계산하는 간격(ms). 무게중심 표시가 따라오는 것이 보일 만큼 짧고, 계산이 드래그 시간의 일부만 쓰게 길다.
export const DRAG_REFRESH_MS = 250

let cache: { objects: SceneObjects; revision: number; model: MassModel; at: number } | null = null

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
  cache = { objects, revision, model: computeMassModel(objects, REGISTRY_MASS_LOOKUP), at: now }
  return cache.model
}

export function useMassModel(): MassModel {
  const objects = useSceneStore((state) => state.objects)
  const revision = useSceneStore((state) => state.geometryRevision)
  // 드래그 중 미룬 계산을 새로 고칠 때 다시 그린다(값은 쓰지 않는다)
  useSyncExternalStore(subscribeRefresh, refreshSnapshot, refreshSnapshot)
  return massModelFor(objects, revision)
}
