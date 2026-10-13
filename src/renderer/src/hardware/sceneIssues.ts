import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { validateScene, type Issue, type IssueSeverity } from './validation'

// 하이어라키와 인스펙터가 같은 씬으로 검증을 두 번 하지 않게 마지막 결과를 기억한다
let cache: { objects: SceneObjects; issues: Issue[] } | null = null

export function sceneIssues(objects: SceneObjects): Issue[] {
  if (cache?.objects !== objects) cache = { objects, issues: validateScene(objects) }
  return cache.issues
}

export function useSceneIssues(): Issue[] {
  return sceneIssues(useSceneStore((state) => state.objects))
}

// 오브젝트별 가장 심각한 문제(하이어라키 표시용)
export function worstSeverityByObject(issues: Issue[]): Map<string, IssueSeverity> {
  const result = new Map<string, IssueSeverity>()
  for (const issue of issues) {
    if (!issue.objectId) continue
    if (result.get(issue.objectId) !== 'error') result.set(issue.objectId, issue.severity)
  }
  return result
}
