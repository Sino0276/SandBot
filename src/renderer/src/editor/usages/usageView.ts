// 사용처 카드의 보기 모델(spec §6.6, §8). 순수 함수라 Vitest가 DOM 없이 확인한다(UsageSection·UsageTree가 그린다).
// - 장치·그룹·로봇 카드마다 머리줄 개수(코드·이름·하위 장치·문제)와 부분(코드, 이름으로, 이전 이름 …)을 만든다.
// - 이름 바꾸기는 상태 없이 기준 씬(마지막으로 열거나 생성 코드를 맞춘 저장의 씬)의 범위와 비교해 바꾼 카드에 "이전 이름"으로 붙인다.
//   생성 코드의 이름은 codeScopes(buildCodeScopes)에서, 찾기 이름은 usageSymbols의 lookupNamesOf에서만 읽고
//   다시 만들지 않는다(맞추기가 쓴 이름과 달라지면 이전 이름을 붙이지 못한다).
// - 행은 파일별로 묶고(파일마다 50개, 부분마다 200개까지), 코드 조각은 맞은 토큰 앞을 12자까지만 남긴다.
import {
  allScopes,
  buildCodeScopes,
  deviceKey,
  type CodeScope,
  type DeviceMember,
  type RobotCodeScopes
} from '../../hardware/codeScopes'
import { lookupNamesOf, usageSymbols } from '../../java/usages/usageSymbols'
import {
  deviceUsageKey,
  groupUsageKey,
  MISSING_GENERATED_TYPE,
  robotUsageKey,
  usageKeyObjectId,
  type UsageHit,
  type UsageKey,
  type UsageKind,
  type UsageResult
} from '../../java/usages/usageTypes'
import {
  childrenInDocument,
  findRobotId,
  subtreeIds,
  type HardwareComponent,
  type SceneObjects
} from '../../scene/model'

export type UsageTarget =
  | { kind: 'device'; objectId: string; componentId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'robot'; robotId: string }

export type UsageCardKind = UsageTarget['kind']

// renamedCode·renamedName: 이전 이름을 쓰는 곳(바꾼 카드에 붙인다)
// unresolved: 로봇의 생성 코드에 없는 이름 전체, unresolvedInClass: 그룹 클래스에 없는 이름
// constructs: 로봇을 만드는 곳(new), code: 코드 사용처, byName: 구성 이름으로 찾는 문자열
// sameText: 같은 글자의 다른 문자열, unknownNames: 구성에 없는 장치 이름(둘 다 접어 두고 세지 않는다)
export type UsageSectionId =
  | 'renamedCode'
  | 'renamedName'
  | 'unresolved'
  | 'unresolvedInClass'
  | 'constructs'
  | 'code'
  | 'byName'
  | 'sameText'
  | 'unknownNames'

// warning: 문제(⚠, 머리줄의 문제 개수에 들어간다), main: 코드·이름 사용처, folded: 접어 두고 세지 않는 것
export type UsageSectionTone = 'warning' | 'main' | 'folded'

export type UsageSectionView = {
  id: UsageSectionId
  tone: UsageSectionTone
  // 이 부분 행의 기본 종류. 다른 종류의 행에만 배지를 단다(장치·그룹은 필드, 로봇은 형식).
  defaultKind: UsageKind
  // (path, line, col) 순서
  hits: UsageHit[]
  // 한도로 자르기 전의 개수(hits보다 많으면 끝에 '외 N곳')
  total: number
  // 결과 한도로 뒤가 잘렸을 수 있는 파일(그 묶음의 개수는 전체 수가 아니라 'N+'로 보인다)
  cut: readonly string[]
  // 이전 이름 부분: 사용처가 쓰는 이전 이름(robot.lift.liftLeft, MyBot.Lift.PAR_X_MM 등, 쉼표로 이음)
  old?: string
}

export type UsageHeaderCounts = {
  // 코드 사용처(장치: 필드·상수, 그룹: 필드·형식·생성, 로봇: 생성·형식·상수)
  code: number
  // 구성 이름으로 찾는 문자열(장치만)
  byName: number
  // 하위 장치의 코드·이름 사용처가 있는 곳 수(그룹·로봇). 같은 줄을 두 번 늘어놓지 않도록 개수만 보인다.
  descendants: number
  // 문제(이전 이름, 생성 코드에 없는 이름)
  warnings: number
}

export type UsageView = {
  // 목록 이름(장치의 구성 이름, 그룹·로봇의 이름)
  name: string
  counts: UsageHeaderCounts
  // 문제 부분이 먼저, 그다음 코드·이름, 접어 두는 부분 순서. 빈 부분은 넣지 않는다.
  sections: UsageSectionView[]
  // 다른 로봇에도 이 구성 이름의 장치가 있어 이름으로 찾은 곳이 그 로봇의 것일 수도 있다
  sharedName: boolean
  // 같은 포트의 모터와 데드휠이 이 구성 이름을 함께 쓴다(데드휠은 모터 이름으로 엔코더를 읽는다)
  samePortName: boolean
  // 로봇 클래스 이름 문제(잘못됐거나 겹침)로 코드 사용처를 찾을 수 없다(이름으로 찾기는 한다)
  unavailable: boolean
  // 찾은 것(빈 머리줄의 도움말): robot.lift.liftLeft, MyBot.Lift.LIFT_LEFT_X_MM, "liftLeft"
  terms: string[]
  // 보일 것이 하나도 없다(부분 없음, 하위 장치 0, 클래스 이름 문제 없음). 일부만 찾았는지는 화면이 따로 본다.
  empty: boolean
}

// 파일마다 보이는 행 수, 부분마다 그리는 행 수(인스펙터의 MAX_LISTED와 같음)
export const MAX_ROWS_PER_FILE = 50
export const MAX_ROWS_PER_SECTION = 200
// 부분의 행이 이 수 이하면 파일 묶음을 펼쳐서 시작한다
export const EXPAND_ROWS_LIMIT = 20
// 코드 조각에서 맞은 토큰 앞에 남기는 글자 수(인스펙터 폭이 341 px 정도라 뒤는 CSS가 줄인다)
export const SNIPPET_BEFORE_CHARS = 12

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function compareHits(a: UsageHit, b: UsageHit): number {
  return compare(a.path, b.path) || a.line - b.line || a.col - b.col
}

// 한도로 자르기 전의 개수(totals)
const total = (result: UsageResult, key: UsageKey, kinds: readonly UsageKind[]): number => {
  const counts = result.totals.get(key)
  return counts ? kinds.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0) : 0
}

// 결과 한도로 자른 키에서 개수가 모자랄 수 있는 파일. 맞추기는 같은 등급(코드·찾기·같은 글자) 안에서 자리 순서로
// 앞의 것을 남기므로 마지막으로 남은 행의 파일만 뒤가 잘렸을 수 있다(그 뒤 파일은 행이 하나도 없다).
// 파일마다 전체 수를 보이려면 맞추기가 자르기 전의 파일별 개수를 넘겨야 한다.
function cutPaths(hits: readonly UsageHit[], count: number): string[] {
  return count > hits.length && hits.length > 0 ? [hits[hits.length - 1].path] : []
}

// 키의 사용처 중 이 종류들. 개수는 한도 전 개수(totals)와 남은 행 수 중 큰 것이다.
function kindSection(
  result: UsageResult,
  key: UsageKey,
  id: UsageSectionId,
  kinds: readonly UsageKind[],
  defaultKind: UsageKind,
  tone: UsageSectionTone = 'main'
): UsageSectionView {
  const hits = (result.hits.get(key) ?? []).filter((hit) => kinds.includes(hit.kind))
  const count = Math.max(hits.length, total(result, key, kinds))
  return { id, tone, defaultKind, hits, total: count, cut: cutPaths(hits, count) }
}

function warningSection(
  id: UsageSectionId,
  hits: UsageHit[],
  count = hits.length,
  defaultKind: UsageKind = 'unresolved',
  old?: string,
  cut: readonly string[] = []
): UsageSectionView {
  return {
    id,
    tone: 'warning',
    defaultKind,
    hits,
    total: Math.max(count, hits.length),
    cut,
    ...(old !== undefined ? { old } : {})
  }
}

// 범위(로봇 클래스 또는 그룹 중첩 클래스)의 사용처 키
function scopeKey(scope: CodeScope, robotId: string): UsageKey {
  return scope.objectId === robotId ? robotUsageKey(robotId) : groupUsageKey(scope.objectId)
}

const robotPath = (fieldPath: readonly string[]): string => ['robot', ...fieldPath].join('.')

// 장치 키 → 찾기 이름(앞뒤 공백 뺀 구성 이름, 데드휠은 같은 포트 모터의 이름). lookupNamesOf를 뒤집어 문서마다 한 번.
const lookupNameCache = new WeakMap<SceneObjects, Map<UsageKey, string>>()

function lookupNameByKey(objects: SceneObjects): Map<UsageKey, string> {
  let byKey = lookupNameCache.get(objects)
  if (!byKey) {
    byKey = new Map()
    for (const [name, keys] of lookupNamesOf(objects))
      for (const key of keys) if (!byKey.has(key)) byKey.set(key, name)
    lookupNameCache.set(objects, byKey)
  }
  return byKey
}

// 대상의 로봇이 클래스 이름 문제로 기호표에서 빠졌는지(usageSymbols가 정한 것을 읽는다)
function robotUnavailable(objects: SceneObjects, robotId: string): boolean {
  const key = robotUsageKey(robotId)
  return usageSymbols(objects).unavailable.some((entry) => entry.key === key)
}

// 그룹 범위를 멤버로 가진 범위(바로 위 클래스)와 그 필드
function parentScopeOf(
  root: CodeScope,
  groupId: string
): { parent: CodeScope; field: string } | null {
  for (const scope of allScopes(root))
    for (const member of scope.members)
      if (member.kind === 'group' && member.objectId === groupId)
        return { parent: scope, field: member.field }
  return null
}

// 기준 씬에서 이 오브젝트가 있던 로봇. 기준 씬이 없거나 그때 없던 오브젝트·로봇 밖이었으면 null.
function baselineRobotId(baseline: SceneObjects | null, objectId: string): string | null {
  return baseline && baseline[objectId] ? findRobotId(baseline, objectId) : null
}

// 저장한 범위 중 지금 씬에도 클래스가 있는 가장 가까운 것(자신 또는 상위, 로봇 클래스는 늘 있다)과 그 바로 아래의
// 사라진 범위. 장치가 하나뿐인 그룹에서 장치를 꺼내면 그 그룹은 클래스를 잃고, javac는 robot.lift.liftLeft의
// liftLeft가 아니라 지금도 있는 MyBot에서 lift(형식은 MyBot.Lift)를 찾지 못한다.
function nearestSurviving(
  saved: RobotCodeScopes,
  scope: CodeScope,
  current: RobotCodeScopes
): { scope: CodeScope; vanished: CodeScope | null } {
  let at = scope
  let vanished: CodeScope | null = null
  while (at.objectId !== saved.root.objectId && !current.groups.has(at.objectId)) {
    const parent = parentScopeOf(saved.root, at.objectId)
    if (!parent) break
    vanished = at
    at = parent.parent
  }
  return { scope: at, vanished }
}

// 사라진 범위의 이전 이름: 부모 범위의 필드(robot.lift)와 멤버 형식(MyBot.Lift, 상수 MyBot.Lift.X도 여기서 깨진다)
function vanishedForms(vanished: CodeScope): Map<string, string> {
  return new Map([
    [vanished.fieldPath[vanished.fieldPath.length - 1], robotPath(vanished.fieldPath)],
    [vanished.className, vanished.classPath.join('.')]
  ])
}

// 이전 이름 부분. 저장한 범위의 생성 코드에 없는 이름 중 이전 이름(멤버 → 보일 글자)인 것이고, 제목에는 사용처가
// 실제로 쓰는 이전 이름만 넣는다.
function renamedCodeSection(
  result: UsageResult,
  savedScopeKey: UsageKey,
  oldForms: ReadonlyMap<string, string>
): UsageSectionView | null {
  if (oldForms.size === 0) return null
  const hits = (result.unresolved.get(savedScopeKey) ?? []).filter(
    (hit) => hit.member !== undefined && oldForms.has(hit.member)
  )
  if (hits.length === 0) return null
  const used = new Set(hits.map((hit) => hit.member))
  const old = [...oldForms]
    .filter(([member]) => used.has(member))
    .map(([, form]) => form)
    .join(', ')
  return warningSection('renamedCode', hits, hits.length, 'unresolved', old)
}

// 장치의 이름 바꾸기(spec §6.6). 저장한 범위·필드(상수)와 지금 것이 다르면 저장한 범위의 생성 코드에 없는 이름 중
// 이전 필드·상수인 것. 저장한 범위가 클래스를 잃었으면 지금도 있는 상위 범위에서 사라진 범위의 이름을 찾지 못한
// 곳이다. 구성 이름이 바뀌었으면 이전 이름을 찾는 구성에 없는 이름(javac는 모르고 실행할 때 깨진다).
function deviceRenames(
  objects: SceneObjects,
  result: UsageResult,
  baseline: SceneObjects | null,
  objectId: string,
  componentId: string,
  current: { scope: CodeScope; member: DeviceMember },
  lookupName: string
): UsageSectionView[] {
  const robotId = baselineRobotId(baseline, objectId)
  if (!baseline || !robotId) return []
  const sections: UsageSectionView[] = []
  const savedScopes = buildCodeScopes(baseline, robotId)
  const saved = savedScopes.devices.get(deviceKey(objectId, componentId))
  if (saved) {
    const from = nearestSurviving(savedScopes, saved.scope, buildCodeScopes(objects, robotId))
    let oldForms = new Map<string, string>()
    if (from.vanished) {
      oldForms = vanishedForms(from.vanished)
    } else {
      const scopeChanged = saved.scope.objectId !== current.scope.objectId
      if (scopeChanged || saved.member.field !== current.member.field)
        oldForms.set(saved.member.field, robotPath([...saved.scope.fieldPath, saved.member.field]))
      // 상수도 장치 이름(과 종류)에서 만들므로 이름을 바꾸면 함께 바뀐다(MyBot.Lift.LIFT_LEFT_X_MM)
      const typeName = saved.scope.classPath.join('.')
      for (const constant of saved.member.constants)
        if (scopeChanged || !current.member.constants.includes(constant))
          oldForms.set(constant, `${typeName}.${constant}`)
    }
    const section = renamedCodeSection(result, scopeKey(from.scope, robotId), oldForms)
    if (section) sections.push(section)
  }
  const oldName = lookupNameByKey(baseline).get(deviceUsageKey(objectId, componentId)) ?? ''
  if (oldName && oldName !== lookupName) {
    const hits = result.unknownNames.get(oldName) ?? []
    if (hits.length > 0)
      sections.push(warningSection('renamedName', hits, hits.length, 'lookup', oldName))
  }
  return sections
}

// 범위들의 장치 코드·이름 사용처가 있는 곳 수(그룹·로봇의 "하위 장치 N곳"). 같은 글자의 다른 문자열은 넣지 않는다.
// 같은 포트의 모터와 데드휠은 한 찾기 문자열을 둘 다 가지므로 자리로 한 번만 센다. 한도로 잘린 것은 자리를 알 수
// 없어 그대로 더한다.
function deviceTotals(result: UsageResult, scopes: readonly CodeScope[]): number {
  const places = new Set<string>()
  let beyond = 0
  for (const scope of scopes)
    for (const member of scope.members)
      if (member.kind === 'device') {
        const key = deviceUsageKey(member.objectId, member.component.id)
        const hits = (result.hits.get(key) ?? []).filter((hit) => hit.kind !== 'text')
        for (const hit of hits) places.add(`${hit.path}\n${hit.line}\n${hit.col}`)
        beyond += Math.max(0, total(result, key, ['field', 'constant', 'lookup']) - hits.length)
      }
  return places.size + beyond
}

// 찾기 이름을 함께 쓰는 다른 장치가 다른 로봇에 있는지, 같은 로봇의 같은 포트 모터·데드휠인지. 같은 로봇에서 그 밖에
// 이름이 겹치면 검증 오류(duplicateName)가 이미 알린다.
function nameSharing(
  objects: SceneObjects,
  robotId: string,
  key: UsageKey,
  lookupName: string
): { otherRobot: boolean; samePort: boolean } {
  const sharing = { otherRobot: false, samePort: false }
  const self = componentOfKey(objects, key)
  for (const other of lookupNamesOf(objects).get(lookupName) ?? []) {
    if (other === key) continue
    const objectId = usageKeyObjectId(other)
    if (objectId === null || findRobotId(objects, objectId) !== robotId) {
      sharing.otherRobot = true
      continue
    }
    const peer = componentOfKey(objects, other)
    if (
      self &&
      peer &&
      [self.type, peer.type].sort().join() === 'deadWheel,motor' &&
      self.hub === peer.hub &&
      self.port === peer.port
    )
      sharing.samePort = true
  }
  return sharing
}

// 장치 키의 컴포넌트(지금 씬에 없으면 null)
function componentOfKey(objects: SceneObjects, key: UsageKey): HardwareComponent | null {
  const objectId = usageKeyObjectId(key)
  const componentId = key.slice(key.indexOf('\n') + 1)
  const object = objectId !== null ? objects[objectId] : undefined
  return object?.components?.find((component) => component.id === componentId) ?? null
}

const TONE_ORDER: Record<UsageSectionTone, number> = { warning: 0, main: 1, folded: 2 }

function finish(
  base: Pick<UsageView, 'name' | 'terms' | 'sharedName' | 'samePortName' | 'unavailable'>,
  sections: UsageSectionView[],
  counts: Omit<UsageHeaderCounts, 'warnings'>
): UsageView {
  // 문제가 먼저(정렬은 안정적이라 같은 무리 안의 순서는 그대로다)
  const shown = sections
    .filter((section) => section.total > 0 || section.hits.length > 0)
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
  const warnings = shown
    .filter((section) => section.tone === 'warning')
    .reduce((sum, section) => sum + section.total, 0)
  return {
    ...base,
    counts: { ...counts, warnings },
    sections: shown,
    empty: shown.length === 0 && counts.descendants === 0 && !base.unavailable
  }
}

// 장치 카드. 로봇 밖이거나 카탈로그에 없는 종류면 사용처가 없다(componentCodePath와 같은 조건).
export function deviceUsageView(
  objects: SceneObjects,
  result: UsageResult,
  baseline: SceneObjects | null,
  objectId: string,
  componentId: string
): UsageView | null {
  const robotId = findRobotId(objects, objectId)
  if (!robotId) return null
  const found = buildCodeScopes(objects, robotId).devices.get(deviceKey(objectId, componentId))
  if (!found) return null
  const key = deviceUsageKey(objectId, componentId)
  const lookupName = lookupNameByKey(objects).get(key) ?? ''

  const code = kindSection(result, key, 'code', ['field', 'constant'], 'field')
  const byName = kindSection(result, key, 'byName', ['lookup'], 'lookup')
  const sameText = kindSection(result, key, 'sameText', ['text'], 'text', 'folded')
  const renames = deviceRenames(objects, result, baseline, objectId, componentId, found, lookupName)
  const typeName = found.scope.classPath.join('.')
  const sharing = lookupName
    ? nameSharing(objects, robotId, key, lookupName)
    : { otherRobot: false, samePort: false }
  return finish(
    {
      name: found.member.component.name.trim() || objects[objectId].name,
      terms: [
        robotPath([...found.scope.fieldPath, found.member.field]),
        ...found.member.constants.map((constant) => `${typeName}.${constant}`),
        ...(lookupName ? [JSON.stringify(lookupName)] : [])
      ],
      sharedName: sharing.otherRobot,
      samePortName: sharing.samePort,
      unavailable: robotUnavailable(objects, robotId)
    },
    [...renames, code, byName, sameText],
    { code: code.total, byName: byName.total, descendants: 0 }
  )
}

// 그룹 카드. 장치가 없어 클래스를 만들지 않는 그룹이나 로봇 밖 그룹은 사용처가 없다.
export function groupUsageView(
  objects: SceneObjects,
  result: UsageResult,
  baseline: SceneObjects | null,
  groupId: string
): UsageView | null {
  const robotId = findRobotId(objects, groupId)
  if (!robotId) return null
  const scopes = buildCodeScopes(objects, robotId)
  const scope = scopes.groups.get(groupId)
  const parent = scope ? parentScopeOf(scopes.root, groupId) : null
  if (!scope || !parent) return null
  const key = groupUsageKey(groupId)

  const sections: UsageSectionView[] = []
  // 이름 바꾸기: 저장한 부모 범위·필드·클래스 이름 중 바뀐 것이 있으면, 저장한 부모 범위의 없는 이름 중 이전 것
  // (robot.lift는 부모 범위에서 필드 lift가, MyBot.Lift는 부모 클래스에서 멤버 형식 Lift가 없다). 저장한 부모가
  // 클래스를 잃었으면(장치 없는 Arm에서 Wrist를 꺼냄) 지금도 있는 상위 범위에서 사라진 부모의 이름(robot.arm)을 찾는다.
  const savedRobotId = baselineRobotId(baseline, groupId)
  const savedScopes = baseline && savedRobotId ? buildCodeScopes(baseline, savedRobotId) : null
  const savedScope = savedScopes?.groups.get(groupId)
  const savedParent = savedScopes && savedScope ? parentScopeOf(savedScopes.root, groupId) : null
  if (savedRobotId && savedScopes && savedScope && savedParent) {
    const from = nearestSurviving(
      savedScopes,
      savedParent.parent,
      buildCodeScopes(objects, savedRobotId)
    )
    let oldForms = new Map<string, string>()
    if (from.vanished) {
      oldForms = vanishedForms(from.vanished)
    } else {
      const parentChanged = savedParent.parent.objectId !== parent.parent.objectId
      if (parentChanged || savedParent.field !== parent.field)
        oldForms.set(savedParent.field, robotPath(savedScope.fieldPath))
      if (parentChanged || savedScope.className !== scope.className)
        oldForms.set(savedScope.className, savedScope.classPath.join('.'))
    }
    const section = renamedCodeSection(result, scopeKey(from.scope, savedRobotId), oldForms)
    if (section) sections.push(section)
  }
  const inClass = result.unresolved.get(key) ?? []
  const inClassCount = total(result, key, ['unresolved'])
  sections.push(
    warningSection(
      'unresolvedInClass',
      inClass,
      inClassCount,
      'unresolved',
      undefined,
      cutPaths(inClass, inClassCount)
    )
  )
  const code = kindSection(result, key, 'code', ['field', 'type', 'new'], 'field')
  sections.push(code)
  return finish(
    {
      name: objects[groupId].name,
      terms: [robotPath(scope.fieldPath), scope.classPath.join('.')],
      sharedName: false,
      samePortName: false,
      unavailable: robotUnavailable(objects, robotId)
    },
    sections,
    { code: code.total, byName: 0, descendants: deviceTotals(result, allScopes(scope)) }
  )
}

// 로봇 카드. 장치가 없는 로봇도 보인다(마지막 장치를 지운 뒤에도 생성 패키지에 없는 형식이 보이게).
// 생성 코드에 없는 이름은 이 로봇 범위들의 것과 생성 패키지에 없는 형식('*', 모든 로봇 카드)을 모두 모아 보인다
// (장치·그룹 카드에 이전 이름으로 붙인 것도 여기 다시 보인다. 같은 카드에서 두 번 늘어놓지만 않는다).
export function robotUsageView(
  objects: SceneObjects,
  result: UsageResult,
  baseline: SceneObjects | null,
  robotId: string
): UsageView | null {
  if (objects[robotId]?.kind !== 'robot') return null
  const scopes = buildCodeScopes(objects, robotId)
  const key = robotUsageKey(robotId)
  const className = scopes.root.className
  const sections: UsageSectionView[] = []

  // 이름 바꾸기: 저장한 클래스 이름을 생성 패키지에 없는 형식으로 쓰는 곳
  const missingTypes = result.unresolved.get(MISSING_GENERATED_TYPE) ?? []
  const savedClassName =
    baseline && baseline[robotId]?.kind === 'robot'
      ? buildCodeScopes(baseline, robotId).root.className
      : null
  const renamed =
    savedClassName !== null && savedClassName !== className
      ? missingTypes.filter((hit) => hit.member === savedClassName)
      : []
  if (renamed.length > 0)
    sections.push(
      warningSection('renamedCode', renamed, renamed.length, 'unresolved', savedClassName!)
    )

  const listed = new Set(renamed)
  const unresolved: UsageHit[] = []
  let unresolvedTotal = 0
  const cut = new Set<string>()
  const keys = [
    ...allScopes(scopes.root).map((scope) => scopeKey(scope, robotId)),
    MISSING_GENERATED_TYPE
  ]
  for (const unresolvedKey of keys) {
    const hits = result.unresolved.get(unresolvedKey) ?? []
    const rest = hits.filter((hit) => !listed.has(hit))
    unresolved.push(...rest)
    // 한도로 잘랐으면 자르기 전의 개수에서 이전 이름 부분에 넣은 것을 뺀다
    const count = Math.max(hits.length, total(result, unresolvedKey, ['unresolved']))
    unresolvedTotal += count - (hits.length - rest.length)
    for (const path of cutPaths(hits, count)) cut.add(path)
  }
  unresolved.sort(compareHits)
  sections.push(
    warningSection('unresolved', unresolved, unresolvedTotal, 'unresolved', undefined, [...cut])
  )

  sections.push(
    kindSection(result, key, 'constructs', ['new'], 'new'),
    kindSection(result, key, 'code', ['type', 'constant'], 'type')
  )

  // 어느 로봇에도 없는 찾기 이름(접어 두고 ⚠에 넣지 않는다)
  const unknown = [...result.unknownNames.values()].flat().sort(compareHits)
  sections.push({
    id: 'unknownNames',
    tone: 'folded',
    defaultKind: 'lookup',
    hits: unknown,
    total: unknown.length,
    cut: []
  })

  const code = sections
    .filter((section) => section.id === 'constructs' || section.id === 'code')
    .reduce((sum, section) => sum + section.total, 0)
  return finish(
    {
      name: objects[robotId].name,
      terms: [className, `${className}.CONFIGURATION_NAME`],
      sharedName: false,
      samePortName: false,
      unavailable: robotUnavailable(objects, robotId)
    },
    sections,
    { code, byName: 0, descendants: deviceTotals(result, allScopes(scopes.root)) }
  )
}

export function usageView(
  objects: SceneObjects,
  result: UsageResult,
  baseline: SceneObjects | null,
  target: UsageTarget
): UsageView | null {
  switch (target.kind) {
    case 'device':
      return deviceUsageView(objects, result, baseline, target.objectId, target.componentId)
    case 'group':
      return groupUsageView(objects, result, baseline, target.groupId)
    case 'robot':
      return robotUsageView(objects, result, baseline, target.robotId)
  }
}

// 대상이 지금 씬에서 사용처 부분을 갖는지(결과가 아직 없어도 머리줄을 보일지 정한다). spec §8.1: 로봇 밖이거나
// 카탈로그에 없는 종류의 장치, 클래스를 만들지 않는 그룹은 없다. 로봇은 장치가 없어도 있다.
export function hasUsageSection(objects: SceneObjects, target: UsageTarget): boolean {
  switch (target.kind) {
    case 'device': {
      const robotId = findRobotId(objects, target.objectId)
      return (
        robotId !== null &&
        buildCodeScopes(objects, robotId).devices.has(
          deviceKey(target.objectId, target.componentId)
        )
      )
    }
    case 'group': {
      const robotId = findRobotId(objects, target.groupId)
      return robotId !== null && buildCodeScopes(objects, robotId).groups.has(target.groupId)
    }
    case 'robot':
      return objects[target.robotId]?.kind === 'robot'
  }
}

// 빈 머리줄의 도움말에 넣는 찾은 것
export function searchedTerms(view: Pick<UsageView, 'terms'>): string {
  return view.terms.join(', ')
}

// ---- 파일 묶음과 코드 조각 ----

export type UsageFileGroup = {
  path: string
  // 이 파일의 행 수(묶음 머리줄은 늘 이 수를 보인다. atLeast가 아니면 이 파일의 전체 수다)
  count: number
  // 결과 한도로 이 파일의 뒤가 잘렸을 수 있다(count는 그 아래 수라 머리줄은 'N+')
  atLeast: boolean
  // 이 파일의 첫 사용처(파일 행을 더블클릭하면 연다. 부분 한도로 행을 하나도 그리지 않아도 있다)
  first: UsageHit
  // 그릴 행(파일마다 perFile개, 부분 전체에서 perSection개까지)
  rows: UsageHit[]
  // 그리지 않은 행 수('외 N곳')
  more: number
}

export type FileGroupCaps = { perFile: number; perSection: number }

export const FILE_GROUP_CAPS: FileGroupCaps = {
  perFile: MAX_ROWS_PER_FILE,
  perSection: MAX_ROWS_PER_SECTION
}

// 행을 파일별로 묶는다(경로 순서, 파일 안은 줄·열 순서). cut은 부분의 결과 한도로 잘렸을 수 있는 파일이다.
export function fileGroups(
  hits: readonly UsageHit[],
  caps: FileGroupCaps = FILE_GROUP_CAPS,
  cut: readonly string[] = []
): UsageFileGroup[] {
  const byPath = new Map<string, UsageHit[]>()
  for (const hit of hits) {
    const list = byPath.get(hit.path)
    if (list) list.push(hit)
    else byPath.set(hit.path, [hit])
  }
  let budget = caps.perSection
  return [...byPath.keys()].sort(compare).map((path) => {
    const all = byPath.get(path)!.sort(compareHits)
    const shown = Math.max(0, Math.min(all.length, caps.perFile, budget))
    budget -= shown
    return {
      path,
      count: all.length,
      atLeast: cut.includes(path),
      first: all[0],
      rows: all.slice(0, shown),
      more: all.length - shown
    }
  })
}

// 파일 묶음을 펼쳐서 시작할지(부분의 행이 적을 때만)
export function groupsStartOpen(rowCount: number): boolean {
  return rowCount <= EXPAND_ROWS_LIMIT
}

export type SnippetWindow = {
  // 앞을 잘랐다(앞에 …를 붙인다)
  lead: boolean
  before: string
  mark: string
  after: string
}

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

// 맞은 토큰 앞은 maxBefore자까지만 남긴다(뒤는 CSS 말줄임이 자른다). 범위가 어긋나도 던지지 않는다.
export function snippetWindow(
  snippet: string,
  mark: readonly [number, number],
  maxBefore = SNIPPET_BEFORE_CHARS
): SnippetWindow {
  const start = Math.min(Math.max(0, Math.trunc(mark[0]) || 0), snippet.length)
  const end = Math.min(Math.max(start, Math.trunc(mark[1]) || 0), snippet.length)
  let from = 0
  if (start > maxBefore) {
    from = start - maxBefore
    // 서로게이트 쌍의 가운데에서 자르지 않는다
    if (isLowSurrogate(snippet.charCodeAt(from))) from++
  }
  return {
    lead: from > 0,
    before: snippet.slice(from, start),
    mark: snippet.slice(start, end),
    after: snippet.slice(end)
  }
}

// ---- 스크립트 카드의 "이 스크립트가 쓰는 하드웨어" ----

export type ScriptHardwareChip = {
  key: UsageKey
  // 누르면 고를 오브젝트(장치는 컴포넌트가 붙은 오브젝트, 그룹·로봇은 그 오브젝트)
  objectId: string
  // 장치는 구성 이름(비었으면 오브젝트 이름), 그룹·로봇은 오브젝트 이름
  label: string
}

// 결과에서 이 파일에 사용처(코드, 이름으로 찾기)가 있는 키를 하이어라키 순서로 한 번씩. 같은 글자의 다른 문자열과
// 생성 코드에 없는 이름은 넣지 않는다. 지금 씬에 없는 키(이전 결과의 것)는 뺀다.
export function scriptUsesHardware(
  result: UsageResult,
  path: string,
  objects: SceneObjects
): ScriptHardwareChip[] {
  const order = new Map<string, number>()
  for (const root of childrenInDocument(objects, null))
    for (const id of subtreeIds(objects, root.id)) if (!order.has(id)) order.set(id, order.size)

  const chips: { chip: ScriptHardwareChip; rank: [number, number] }[] = []
  for (const [key, hits] of result.hits) {
    if (!hits.some((hit) => hit.path === path && hit.kind !== 'text')) continue
    const objectId = usageKeyObjectId(key)
    const object = objectId !== null ? objects[objectId] : undefined
    const rank = object ? order.get(object.id) : undefined
    if (!object || rank === undefined) continue
    if (key.startsWith('d:')) {
      const componentId = key.slice(key.indexOf('\n') + 1)
      const components = object.components ?? []
      const index = components.findIndex((component) => component.id === componentId)
      if (index < 0) continue
      chips.push({
        chip: { key, objectId: object.id, label: components[index].name.trim() || object.name },
        rank: [rank, index]
      })
    } else {
      // 오브젝트 자신(그룹·로봇)이 그 오브젝트에 붙은 장치보다 먼저
      chips.push({ chip: { key, objectId: object.id, label: object.name }, rank: [rank, -1] })
    }
  }
  return chips
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map(({ chip }) => chip)
}

// ---- 트리 행과 키보드(UsageTree) ----

export type UsageTreeRow =
  | { type: 'file'; id: string; group: UsageFileGroup; open: boolean; posInSet: number }
  | {
      type: 'line'
      id: string
      hit: UsageHit
      parentId: string
      // groups 안의 순번(파일 묶음의 '외 N곳'을 찾는다)
      groupIndex: number
      posInSet: number
      setSize: number
    }

const fileRowId = (path: string): string => `f\n${path}`

// 펼칠 수 있는 파일 묶음(그릴 행이 있는 것)
export const canExpand = (group: UsageFileGroup): boolean => group.rows.length > 0

// 보이는 행(펼친 파일의 줄만), 화면 순서. id는 경로와 파일 안 순번이라 결과가 바뀌어도 같은 자리를 가리킨다.
export function usageTreeRows(
  groups: readonly UsageFileGroup[],
  isOpen: (path: string) => boolean
): UsageTreeRow[] {
  const rows: UsageTreeRow[] = []
  groups.forEach((group, index) => {
    const id = fileRowId(group.path)
    const open = canExpand(group) && isOpen(group.path)
    rows.push({ type: 'file', id, group, open, posInSet: index + 1 })
    if (!open) return
    group.rows.forEach((hit, line) =>
      rows.push({
        type: 'line',
        id: `l\n${group.path}\n${line}`,
        hit,
        parentId: id,
        groupIndex: index,
        posInSet: line + 1,
        setSize: group.rows.length
      })
    )
  })
  return rows
}

// 연다: 줄 행은 그 줄, 파일 행은 첫 사용처
export function usageRowTarget(row: UsageTreeRow): UsageHit {
  return row.type === 'line' ? row.hit : row.group.first
}

export type UsageTreeAction =
  | { type: 'focus'; id: string }
  | { type: 'setOpen'; path: string; open: boolean }
  | { type: 'open'; hit: UsageHit }

// 트리 키보드(WAI-ARIA 트리, 하이어라키와 같음): 위/아래·Home/End 이동, 오른쪽은 펼치기(펼쳐 있으면 첫 줄로),
// 왼쪽은 접기(줄이면 그 파일로), Enter는 열기
export function usageTreeKey(
  rows: readonly UsageTreeRow[],
  currentId: string | null,
  key: string
): UsageTreeAction | null {
  if (rows.length === 0) return null
  const index = currentId === null ? -1 : rows.findIndex((row) => row.id === currentId)
  const focus = (row: UsageTreeRow | undefined): UsageTreeAction | null =>
    row ? { type: 'focus', id: row.id } : null
  switch (key) {
    case 'ArrowDown':
      return focus(index < 0 ? rows[0] : rows[index + 1])
    case 'ArrowUp':
      return focus(index < 0 ? rows[0] : rows[index - 1])
    case 'Home':
      return focus(rows[0])
    case 'End':
      return focus(rows[rows.length - 1])
  }
  if (index < 0) return null
  const row = rows[index]
  switch (key) {
    case 'ArrowRight':
      if (row.type !== 'file' || !canExpand(row.group)) return null
      return row.open
        ? focus(rows[index + 1])
        : { type: 'setOpen', path: row.group.path, open: true }
    case 'ArrowLeft':
      if (row.type === 'line') return { type: 'focus', id: row.parentId }
      return row.open ? { type: 'setOpen', path: row.group.path, open: false } : null
    case 'Enter':
      return { type: 'open', hit: usageRowTarget(row) }
  }
  return null
}

// 포커스한 행이 사라졌을 때(다시 찾아 그 줄·파일이 없어짐, 행이 20개를 넘어 파일을 접음) 포커스를 옮길 행.
// 같은 id(같은 자리의 행)가 있으면 그 행, 줄이면 같은 파일의 마지막으로 보이는 줄, 그것도 없으면 그 파일 행이다.
// 파일이 통째로 사라졌으면 같은 순번의 파일(마지막 파일이었으면 이제 마지막 파일)이다. 행이 없으면 null.
export function usageFocusFallback(
  rows: readonly UsageTreeRow[],
  lost: UsageTreeRow
): string | null {
  if (rows.some((row) => row.id === lost.id)) return lost.id
  if (lost.type === 'line') {
    const siblings = rows.filter((row) => row.type === 'line' && row.parentId === lost.parentId)
    if (siblings.length > 0) return siblings[Math.min(lost.posInSet, siblings.length) - 1].id
    if (rows.some((row) => row.id === lost.parentId)) return lost.parentId
  }
  const files = rows.filter((row) => row.type === 'file')
  if (files.length === 0) return null
  const position = lost.type === 'file' ? lost.posInSet : lost.groupIndex + 1
  return files[Math.min(position, files.length) - 1].id
}
