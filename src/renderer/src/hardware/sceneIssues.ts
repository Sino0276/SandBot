import { ancestorIds, type SceneObjects } from '../scene/model'
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

// 오브젝트 자신이 받은 문제 중 컴포넌트에 붙지 않은 것(그룹의 클래스 이름·필드 충돌, 로봇 설정 등).
// 그룹 이슈는 objectId가 그룹이고 componentId가 없다.
export function objectLevelIssues(issues: Issue[], objectId: string): Issue[] {
  return issues.filter((issue) => issue.objectId === objectId && !issue.componentId)
}

export type ObjectSeverity = { severity: IssueSeverity; own: boolean }

// 오브젝트별 가장 심각한 문제(하이어라키 표시용). 접힌 어셈블리 안의 파트도 찾을 수 있게
// 상위 오브젝트에도 표시한다(own=false: 하위에 문제가 있음).
export function severityByObject(
  objects: SceneObjects,
  issues: Issue[]
): Map<string, ObjectSeverity> {
  const result = new Map<string, ObjectSeverity>()
  const mark = (id: string, severity: IssueSeverity, own: boolean): void => {
    const current = result.get(id)
    result.set(id, {
      severity: current?.severity === 'error' ? 'error' : severity,
      own: (current?.own ?? false) || own
    })
  }
  for (const issue of issues) {
    if (!issue.objectId || !objects[issue.objectId]) continue
    mark(issue.objectId, issue.severity, true)
    for (const ancestor of ancestorIds(objects, issue.objectId))
      mark(ancestor, issue.severity, false)
  }
  return result
}
