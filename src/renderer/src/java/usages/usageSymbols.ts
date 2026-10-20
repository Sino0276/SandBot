// 씬 → 사용처 워커에 넘길 생성 클래스 기호표(spec §6.1). 클래스·필드·상수 이름은 codeScopes가 정한 것을 그대로
// 옮기고 여기서 다시 만들지 않는다(코드 생성과 다른 이름을 보면 javac와 다른 곳을 사용처로 보인다).
// 키는 오브젝트·컴포넌트 id로 지어 이름을 바꿔도 같다. 오브젝트를 옮기기만 하면 signature가 그대로라 다시 맞추지 않는다.
import { childrenInDocument, type SceneObjects } from '../../scene/model'
import { buildCodeScopes, type CodeScope, type RobotCodeScopes } from '../../hardware/codeScopes'
import { robotComponents } from '../../hardware/components'
import { deadWheelDeviceName } from '../../hardware/javaCodegen'
import { sceneIssues } from '../../hardware/sceneIssues'
import {
  deviceUsageKey,
  groupUsageKey,
  robotUsageKey,
  type SymbolClass,
  type UsageKey,
  type UsageSymbols
} from './usageTypes'

// 클래스 이름 때문에 형식으로 맞출 수 없는 로봇(검증 오류 코드). 두 로봇이 모두 기본 이름 RobotHardware면
// 어느 쪽 클래스인지 알 수 없다.
type UnavailableReason = UsageSymbols['unavailable'][number]['reason']
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set<UnavailableReason>([
  'invalidClassName',
  'duplicateClassName'
])

// 코드 생성(generate.ts)과 같은 기준으로 하드웨어 클래스를 만드는 로봇. 프로젝트 파일은 카탈로그에 없는 종류를
// 받지 않으므로 "카탈로그 컴포넌트가 하나 이상"과 같다.
function generatedRobotIds(objects: SceneObjects): string[] {
  return childrenInDocument(objects, null)
    .filter((object) => object.kind === 'robot' && robotComponents(objects, object.id).length > 0)
    .map((object) => object.id)
}

// 범위 하나 → 생성 클래스. 장치 필드·상수는 그 장치의 키, 그룹 필드는 그룹 키와 그 그룹의 클래스다.
function classOf(scope: CodeScope, robotId: string | null): SymbolClass {
  const fields: SymbolClass['fields'] = []
  // 생성 코드와 같은 순서로 CONFIGURATION_NAME이 먼저다
  const constants: SymbolClass['constants'] = robotId
    ? [{ name: 'CONFIGURATION_NAME', key: robotUsageKey(robotId) }]
    : []
  for (const member of scope.members) {
    if (member.kind === 'device') {
      const key = deviceUsageKey(member.objectId, member.component.id)
      fields.push({ name: member.field, key, group: null })
      for (const name of member.constants) constants.push({ name, key })
    } else {
      fields.push({
        name: member.field,
        key: groupUsageKey(member.objectId),
        group: classOf(member.scope, null)
      })
    }
  }
  return {
    key: robotId ? robotUsageKey(robotId) : groupUsageKey(scope.objectId),
    name: scope.className,
    fields,
    constants
  }
}

// 장치의 찾기 이름(hardwareMap.get이 받는 구성 이름, 앞뒤 공백을 뺀 것). SDK도 장치 이름을 trim한다.
// 데드휠은 같은 포트 모터가 있으면 그 모터의 구성 항목으로 엔코더를 읽는다(javaCodegen·configXml과 같다).
function addLookupNames(scopes: RobotCodeScopes, names: Map<string, UsageKey[]>): void {
  for (const entry of scopes.entries) {
    const raw =
      entry.component.type === 'deadWheel'
        ? deadWheelDeviceName(entry, scopes.entries)
        : entry.component.name
    const name = raw.trim()
    if (!name) continue
    const key = deviceUsageKey(entry.objectId, entry.component.id)
    const keys = names.get(name)
    if (keys) keys.push(key)
    else names.set(name, [key])
  }
}

function lookupNameMap(objects: SceneObjects, robotIds: string[]): Map<string, UsageKey[]> {
  const names = new Map<string, UsageKey[]>()
  for (const robotId of robotIds) addLookupNames(buildCodeScopes(objects, robotId), names)
  return names
}

// 문서(불변)마다 한 번 만든다. 씬 구독이 끌기 중에도 부르지만 같은 문서면 다시 계산하지 않는다.
const symbolCache = new WeakMap<SceneObjects, UsageSymbols>()
const lookupCache = new WeakMap<SceneObjects, Map<string, UsageKey[]>>()

// 씬 → 워커에 넘길 생성 클래스 기호표. objects마다 한 번 만든다(WeakMap). 이름은 codeScopes에서만 가져온다.
export function usageSymbols(objects: SceneObjects): UsageSymbols {
  const cached = symbolCache.get(objects)
  if (cached) return cached

  const robotIds = generatedRobotIds(objects)
  const issues = sceneIssues(objects)
  const robots: SymbolClass[] = []
  const unavailable: UsageSymbols['unavailable'] = []
  for (const robotId of robotIds) {
    const scopes = buildCodeScopes(objects, robotId)
    const problem = issues.find(
      (issue) =>
        issue.robotId === robotId && !issue.componentId && UNAVAILABLE_CODES.has(issue.code)
    )
    if (problem) {
      unavailable.push({
        key: robotUsageKey(robotId),
        className: scopes.root.className,
        reason: problem.code as UnavailableReason
      })
    } else {
      robots.push(classOf(scopes.root, robotId))
    }
  }
  const names = lookupCache.get(objects) ?? lookupNameMap(objects, robotIds)
  lookupCache.set(objects, names)
  const lookupNames = [...names].map(([name, keys]) => ({ name, keys: [...keys] }))
  const symbols: UsageSymbols = {
    robots,
    unavailable,
    lookupNames,
    signature: JSON.stringify({ robots, unavailable, lookupNames })
  }
  symbolCache.set(objects, symbols)
  return symbols
}

// 모든 로봇 장치의 찾기 이름(앞뒤 공백 뺀 구성 이름, 데드휠은 같은 포트 모터의 이름) → 장치 키들.
// 저장 확인(checkUsagesAfterSave)이 이전·지금 씬의 이름을 비교한다. 돌려준 표는 캐시라 고치지 않는다.
export function lookupNamesOf(objects: SceneObjects): Map<string, UsageKey[]> {
  let names = lookupCache.get(objects)
  if (!names) {
    names = lookupNameMap(objects, generatedRobotIds(objects))
    lookupCache.set(objects, names)
  }
  return names
}
