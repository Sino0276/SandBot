// 사용처 카드의 보기 모델(spec §6.6, §8). 순수 함수라 Vitest가 DOM 없이 확인한다(UsageSection·UsageTree가 그린다).
// - 장치·그룹·로봇 카드마다 머리줄 개수(코드·이름·하위 장치·문제)와 부분(코드, 이름으로, 이전 이름 …)을 만든다.
// - 이름 바꾸기는 상태 없이 기준 씬(마지막으로 열거나 저장한 씬)의 범위와 비교해 바꾼 카드에 "이전 이름"으로 붙인다.
//   생성 코드의 이름은 codeScopes(buildCodeScopes)에서만 읽고 다시 만들지 않는다.
// - 행은 파일별로 묶고(파일마다 50개, 부분마다 200개까지), 코드 조각은 맞은 토큰 앞을 12자까지만 남긴다.
import {
  allScopes,
  buildCodeScopes,
  deviceKey,
  type CodeScope,
  type DeviceMember,
  type RobotCodeScopes
} from '../../hardware/codeScopes'
import type { ComponentEntry } from '../../hardware/components'
import { deadWheelDeviceName } from '../../hardware/javaCodegen'
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
import { childrenInDocument, findRobotId, subtreeIds, type SceneObjects } from '../../scene/model'

export type UsageTarget =
  | { kind: 'device'; objectId: string; componentId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'robot'; robotId: string }

export type UsageCardKind = UsageTarget['kind']

// renamedCode·renamedName: 이전 이름을 쓰는 곳(바꾼 카드에 붙인다)
// unresolved: 로봇의 생성 코드에 없는 이름 전체, unresolvedInClass: 그룹 클래스에 없는 이름
// constructs: 로봇을 만드는 곳(new), code: 코드 사용처, byName: 구성 이름으로 찾는 문자열
// sameText: 같은 글자의 다른 문자열(접고 세지 않음), unknownNames: 구성에 없는 장치 이름(접고 ⚠에 넣지 않음)
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

export type UsageSectionView = {
  id: UsageSectionId
  // 이 부분 행의 기본 종류. 다른 종류의 행에만 배지를 단다(장치·그룹은 필드, 로봇은 형식).
  defaultKind: UsageKind
  // (path, line, col) 순서
  hits: UsageHit[]
  // 한도로 자르기 전의 개수(hits보다 많으면 끝에 '외 N곳')
  total: number
  // 문제(⚠) 부분. 머리줄의 문제 개수에 들어간다.
  warning: boolean
  // 접어 두는 부분(같은 글자의 다른 문자열, 구성에 없는 이름). 개수에 넣지 않는다.
  collapsible: boolean
  // 이전 이름 부분의 이전 이름(robot.lift.liftLeft, RobotHardware 등)
  old?: string
}

export type UsageCounts = {
  // 코드 사용처(장치: 필드·상수, 그룹: 필드·형식·생성, 로봇: 생성·형식·상수)
  code: number
  // 구성 이름으로 찾는 문자열(장치만)
  byName: number
  // 하위 장치의 사용처 합(그룹·로봇). 같은 줄을 두 번 늘어놓지 않도록 개수만 보인다.
  descendants: number
  // 문제(이전 이름, 생성 코드에 없는 이름)
  warnings: number
}

export type UsageView = {
  // 목록 이름(장치 이름, 그룹 이름, 로봇 이름)
  name: string
  counts: UsageCounts
  // 문제 부분이 먼저, 그다음 코드·이름 순서. 빈 부분은 넣지 않는다.
  sections: UsageSectionView[]
  // 이 구성 이름을 다른 로봇의 장치도 써서 이름으로 찾은 곳이 그 로봇의 것일 수도 있다
  sharedName: boolean
  // 찾은 것(빈 머리줄의 도움말): robot.lift.liftLeft, RobotHardware.Lift.LIFT_LEFT_X_MM, "liftLeft"
  terms: string[]
  // 보일 것이 하나도 없다(부분 없음, 하위 장치 0). 일부만 찾았는지·클래스 이름 문제는 화면이 따로 본다.
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

const total = (result: UsageResult, key: UsageKey, kinds: readonly UsageKind[]): number => {
  const counts = result.totals.get(key)
  return counts ? kinds.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0) : 0
}

// 키의 사용처 중 이 종류들. 개수는 한도 전 개수(totals)와 남은 행 수 중 큰 것이다.
function kindSection(
  result: UsageResult,
  key: UsageKey,
  id: UsageSectionId,
  kinds: readonly UsageKind[],
  defaultKind: UsageKind,
  collapsible = false
): UsageSectionView {
  const hits = (result.hits.get(key) ?? []).filter((hit) => kinds.includes(hit.kind))
  return {
    id,
    defaultKind,
    hits,
    total: Math.max(hits.length, total(result, key, kinds)),
    warning: false,
    collapsible
  }
}

function warningSection(
  id: UsageSectionId,
  hits: UsageHit[],
  count = hits.length,
  old?: string
): UsageSectionView {
  return {
    id,
    defaultKind: 'unresolved',
    hits,
    total: Math.max(count, hits.length),
    warning: true,
    collapsible: false,
    ...(old !== undefined ? { old } : {})
  }
}

// 이전 이름 부분은 이전 이름의 종류(필드·형식·찾기)가 섞여 있어 배지를 달지 않는다
function renamedNameSection(hits: UsageHit[], old: string): UsageSectionView {
  return { ...warningSection('renamedName', hits, hits.length, old), defaultKind: 'lookup' }
}

// 범위(로봇 클래스 또는 그룹 중첩 클래스)의 사용처 키
function scopeKey(scope: CodeScope, robotId: string): UsageKey {
  return scope.objectId === robotId ? robotUsageKey(robotId) : groupUsageKey(scope.objectId)
}

// 장치를 구성 이름으로 찾을 때의 이름(앞뒤 공백 뺀 것). 데드휠은 같은 포트 모터의 이름이다(usageSymbols와 같음).
function lookupNameOf(entry: ComponentEntry, entries: ComponentEntry[]): string {
  const name =
    entry.component.type === 'deadWheel'
      ? deadWheelDeviceName(entry, entries)
      : entry.component.name
  return name.trim()
}

function entryOf(
  scopes: RobotCodeScopes,
  objectId: string,
  componentId: string
): ComponentEntry | undefined {
  return scopes.entries.find(
    (entry) => entry.objectId === objectId && entry.component.id === componentId
  )
}

// 그룹 범위를 멤버로 가진 범위(바로 위 클래스)와 그 멤버
function parentScopeOf(
  root: CodeScope,
  groupId: string
): { parent: CodeScope; field: string } | null {
  for (const scope of allScopes(root)) {
    for (const member of scope.members)
      if (member.kind === 'group' && member.objectId === groupId)
        return { parent: scope, field: member.field }
  }
  return null
}

const robotPath = (fieldPath: readonly string[]): string => ['robot', ...fieldPath].join('.')

// 기준 씬에서 이 오브젝트가 있던 로봇의 범위. 기준 씬이 없거나 그때 로봇 밖이었으면 null.
function baselineScopes(
  baseline: SceneObjects | null,
  objectId: string
): { robotId: string; scopes: RobotCodeScopes } | null {
  if (!baseline || !baseline[objectId]) return null
  const robotId = findRobotId(baseline, objectId)
  return robotId ? { robotId, scopes: buildCodeScopes(baseline, robotId) } : null
}

// 장치의 이름 바꾸기(spec §6.6). 저장한 범위·필드와 지금 것이 다르면, 저장한 범위의 생성 코드에 없는 이름 중
// 이전 필드·상수 이름인 것. 구성 이름이 바뀌었으면 이전 이름을 찾는 구성에 없는 이름.
function deviceRenames(
  result: UsageResult,
  baseline: SceneObjects | null,
  objectId: string,
  componentId: string,
  current: { scope: CodeScope; member: DeviceMember },
  lookupName: string
): UsageSectionView[] {
  const saved = baselineScopes(baseline, objectId)
  if (!saved) return []
  const sections: UsageSectionView[] = []
  const found = saved.scopes.devices.get(deviceKey(objectId, componentId))
  if (found) {
    const scopeChanged = found.scope.objectId !== current.scope.objectId
    const fieldChanged = scopeChanged || found.member.field !== current.member.field
    const oldNames = new Set<string>()
    if (fieldChanged) oldNames.add(found.member.field)
    // 상수는 장치 이름에서 만들므로 이름을 바꾸면 함께 바뀐다(RobotHardware.Lift.LIFT_LEFT_X_MM)
    const oldConstants = found.member.constants.filter(
      (constant) => scopeChanged || !current.member.constants.includes(constant)
    )
    for (const constant of oldConstants) oldNames.add(constant)
    if (oldNames.size > 0) {
      const hits = (result.unresolved.get(scopeKey(found.scope, saved.robotId)) ?? []).filter(
        (hit) => hit.member !== undefined && oldNames.has(hit.member)
      )
      const old = fieldChanged
        ? robotPath([...found.scope.fieldPath, found.member.field])
        : `${found.scope.classPath.join('.')}.${oldConstants[0]}`
      if (hits.length > 0) sections.push(warningSection('renamedCode', hits, hits.length, old))
    }
  }
  // 구성 이름: SDK가 실행할 때 찾지 못하는 곳(javac는 모른다)
  const entry = entryOf(saved.scopes, objectId, componentId)
  const oldName = entry ? lookupNameOf(entry, saved.scopes.entries) : ''
  if (oldName && oldName !== lookupName) {
    const hits = result.unknownNames.get(oldName) ?? []
    if (hits.length > 0) sections.push(renamedNameSection(hits, oldName))
  }
  return sections
}

// 지금 로봇의 사용처 키인지(지난 결과의 키도 오브젝트의 로봇으로 판단한다)
function belongsToRobot(objects: SceneObjects, key: UsageKey, robotId: string): boolean {
  const id = usageKeyObjectId(key)
  if (id === null || !objects[id]) return false
  return id === robotId || findRobotId(objects, id) === robotId
}

// 장치 사용처 키들의 코드·이름 사용처 합(그룹·로봇의 "하위 장치 N곳")
function deviceTotals(result: UsageResult, scopes: readonly CodeScope[]): number {
  let sum = 0
  for (const scope of scopes)
    for (const member of scope.members)
      if (member.kind === 'device')
        sum += total(result, deviceUsageKey(member.objectId, member.component.id), [
          'field',
          'constant',
          'lookup'
        ])
  return sum
}

function finish(
  name: string,
  sections: UsageSectionView[],
  counts: Omit<UsageCounts, 'warnings'>,
  terms: string[],
  sharedName = false
): UsageView {
  const shown = sections.filter((section) => section.total > 0 || section.hits.length > 0)
  const warnings = shown
    .filter((section) => section.warning)
    .reduce((sum, section) => sum + section.total, 0)
  return {
    name,
    counts: { ...counts, warnings },
    sections: shown,
    sharedName,
    terms,
    empty: shown.length === 0 && counts.descendants === 0
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
  const scopes = buildCodeScopes(objects, robotId)
  const found = scopes.devices.get(deviceKey(objectId, componentId))
  const entry = entryOf(scopes, objectId, componentId)
  if (!found || !entry) return null
  const key = deviceUsageKey(objectId, componentId)
  const lookupName = lookupNameOf(entry, scopes.entries)

  const code = kindSection(result, key, 'code', ['field', 'constant'], 'field')
  const byName = kindSection(result, key, 'byName', ['lookup'], 'lookup')
  const sameText = kindSection(result, key, 'sameText', ['text'], 'text', true)
  const renames = deviceRenames(result, baseline, objectId, componentId, found, lookupName)
  const typeName = found.scope.classPath.join('.')
  const terms = [
    robotPath([...found.scope.fieldPath, found.member.field]),
    ...found.member.constants.map((constant) => `${typeName}.${constant}`),
    ...(lookupName ? [JSON.stringify(lookupName)] : [])
  ]
  return finish(
    found.member.component.name,
    [...renames, code, byName, sameText],
    { code: code.total, byName: byName.total, descendants: 0 },
    terms,
    sharedLookupName(objects, lookupName, key)
  )
}

// 이 구성 이름을 쓰는 다른 장치가 있는지(다른 로봇의 장치. 같은 로봇 안에서 겹치는 것은 검증 오류 duplicateName이다).
// 그 장치를 찾는 문자열도 같은 글자라 어느 로봇의 것인지 가릴 수 없다.
function sharedLookupName(objects: SceneObjects, name: string, key: UsageKey): boolean {
  if (!name) return false
  for (const robot of childrenInDocument(objects, null)) {
    if (robot.kind !== 'robot') continue
    const scopes = buildCodeScopes(objects, robot.id)
    for (const entry of scopes.entries) {
      if (deviceUsageKey(entry.objectId, entry.component.id) === key) continue
      if (lookupNameOf(entry, scopes.entries) === name) return true
    }
  }
  return false
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
  const parent = parentScopeOf(scopes.root, groupId)
  if (!scope || !parent) return null
  const key = groupUsageKey(groupId)

  const sections: UsageSectionView[] = []
  // 이름 바꾸기: 저장한 부모 범위·필드·클래스 이름 중 바뀐 것이 있으면, 저장한 부모 범위의 없는 이름 중 이전 것
  const saved = baselineScopes(baseline, groupId)
  const savedScope = saved?.scopes.groups.get(groupId)
  const savedParent = saved && savedScope ? parentScopeOf(saved.scopes.root, groupId) : null
  if (saved && savedScope && savedParent) {
    const parentChanged = savedParent.parent.objectId !== parent.parent.objectId
    const fieldChanged = parentChanged || savedParent.field !== parent.field
    const classChanged = parentChanged || savedScope.className !== scope.className
    const oldNames = new Set<string>()
    const old: string[] = []
    if (fieldChanged) {
      oldNames.add(savedParent.field)
      old.push(robotPath(savedScope.fieldPath))
    }
    if (classChanged) {
      oldNames.add(savedScope.className)
      old.push(savedScope.classPath.join('.'))
    }
    if (oldNames.size > 0) {
      const hits = (
        result.unresolved.get(scopeKey(savedParent.parent, saved.robotId)) ?? []
      ).filter((hit) => hit.member !== undefined && oldNames.has(hit.member))
      sections.push(warningSection('renamedCode', hits, hits.length, old.join(', ')))
    }
  }
  const inClass = result.unresolved.get(key) ?? []
  sections.push(
    warningSection(
      'unresolvedInClass',
      inClass,
      Math.max(inClass.length, total(result, key, ['unresolved']))
    )
  )
  const code = kindSection(result, key, 'code', ['field', 'type', 'new'], 'field')
  sections.push(code)
  return finish(
    objects[groupId].name,
    sections,
    { code: code.total, byName: 0, descendants: deviceTotals(result, allScopes(scope)) },
    [robotPath(scope.fieldPath), scope.classPath.join('.')]
  )
}

// 로봇 카드. 장치가 없는 로봇도 보인다(마지막 장치를 지운 뒤에도 생성 패키지에 없는 형식이 보이게).
export function robotUsageView(
  objects: SceneObjects,
  result: UsageResult,
  baseline: SceneObjects | null,
  robotId: string
): UsageView {
  const scopes = buildCodeScopes(objects, robotId)
  const key = robotUsageKey(robotId)
  const className = scopes.root.className
  const sections: UsageSectionView[] = []

  // 이름 바꾸기: 저장한 클래스 이름을 생성 패키지에 없는 형식으로 쓰는 곳
  const missingTypes = result.unresolved.get(MISSING_GENERATED_TYPE) ?? []
  const savedClassName =
    baseline && baseline[robotId] ? buildCodeScopes(baseline, robotId).root.className : null
  const renamed =
    savedClassName !== null && savedClassName !== className
      ? missingTypes.filter((hit) => hit.member === savedClassName)
      : []
  if (renamed.length > 0)
    sections.push(warningSection('renamedCode', renamed, renamed.length, savedClassName!))

  // 이 로봇 범위들의 생성 코드에 없는 이름 전부와 생성 패키지에 없는 형식(모든 로봇 카드). 이전 이름 행은 뺀다.
  const listed = new Set(renamed)
  const unresolved: UsageHit[] = []
  let unresolvedTotal = 0
  for (const [unresolvedKey, hits] of result.unresolved) {
    if (unresolvedKey !== MISSING_GENERATED_TYPE && !belongsToRobot(objects, unresolvedKey, robotId))
      continue
    const rest = hits.filter((hit) => !listed.has(hit))
    unresolved.push(...rest)
    unresolvedTotal +=
      Math.max(hits.length, total(result, unresolvedKey, ['unresolved'])) -
      (hits.length - rest.length)
  }
  unresolved.sort(compareHits)
  sections.push(warningSection('unresolved', unresolved, unresolvedTotal))

  const constructs = kindSection(result, key, 'constructs', ['new'], 'new')
  const code = kindSection(result, key, 'code', ['type', 'constant', 'field'], 'type')
  sections.push(constructs, code)

  // 어느 로봇에도 없는 찾기 이름(접어 두고 ⚠에 넣지 않는다)
  const unknown = [...result.unknownNames.values()].flat().sort(compareHits)
  sections.push({
    id: 'unknownNames',
    defaultKind: 'lookup',
    hits: unknown,
    total: unknown.length,
    warning: false,
    collapsible: true
  })

  return finish(
    objects[robotId]?.name ?? className,
    sections,
    {
      code: constructs.total + code.total,
      byName: 0,
      descendants: deviceTotals(result, allScopes(scopes.root))
    },
    [className, `${className}.CONFIGURATION_NAME`]
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

// 대상이 지금 씬에서 사용처 부분을 갖는지(결과가 아직 없어도 머리줄을 보일지 정한다)
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

// ---- 파일 묶음과 코드 조각 ----

export type UsageFileGroup = {
  path: string
  // 이 파일의 행 수(묶음 머리줄은 늘 전체 수를 보인다)
  count: number
  // 그릴 행(파일마다 MAX_ROWS_PER_FILE개, 부분 전체에서 MAX_ROWS_PER_SECTION개까지)
  rows: UsageHit[]
  // 그리지 않은 행 수('외 N곳')
  more: number
}

export type FileGroupCaps = { perFile: number; perSection: number }

// 행을 파일별로 묶는다(경로 순서, 파일 안은 줄·열 순서)
export function fileGroups(
  hits: readonly UsageHit[],
  caps: FileGroupCaps = { perFile: MAX_ROWS_PER_FILE, perSection: MAX_ROWS_PER_SECTION }
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
    return { path, count: all.length, rows: all.slice(0, shown), more: all.length - shown }
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

// 빈 머리줄의 도움말에 넣는 찾은 것
export function searchedTerms(view: UsageView): string {
  return view.terms.join(', ')
}

// ---- 스크립트 카드의 "이 스크립트가 쓰는 하드웨어" ----

export type ScriptHardwareChip = {
  key: UsageKey
  // 누르면 고를 오브젝트(장치는 컴포넌트가 붙은 파트, 그룹·로봇은 그 오브젝트)
  objectId: string
  // 장치는 구성 이름, 그룹·로봇은 오브젝트 이름
  label: string
}

// 결과에서 이 파일에 사용처(코드·이름으로 찾기)가 있는 키를 하이어라키 순서로, 한 번씩. 같은 글자의 다른 문자열과
// 생성 코드에 없는 이름은 넣지 않는다. 지금 씬에 없는 키(지난 결과)는 뺀다.
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
    if (!object || !order.has(object.id)) continue
    if (key.startsWith('d:')) {
      const componentId = key.slice(key.indexOf('\n') + 1)
      const index = (object.components ?? []).findIndex((c) => c.id === componentId)
      if (index < 0) continue
      const component = object.components![index]
      chips.push({
        chip: { key, objectId: object.id, label: component.name.trim() || object.name },
        rank: [order.get(object.id)!, index]
      })
    } else {
      // 오브젝트 자신(그룹·로봇)이 그 오브젝트의 장치보다 먼저
      chips.push({
        chip: { key, objectId: object.id, label: object.name },
        rank: [order.get(object.id)!, -1]
      })
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

// 보이는 행(펼친 파일의 줄만), 화면 순서. id는 경로와 파일 안 순번이라 결과가 바뀌어도 같은 줄을 가리키기 쉽다.
export function usageTreeRows(
  groups: readonly UsageFileGroup[],
  isOpen: (path: string) => boolean
): UsageTreeRow[] {
  const rows: UsageTreeRow[] = []
  groups.forEach((group, index) => {
    const id = fileRowId(group.path)
    const open = isOpen(group.path)
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
export function usageRowTarget(row: UsageTreeRow): UsageHit | null {
  return row.type === 'line' ? row.hit : (row.group.rows[0] ?? null)
}

export type UsageTreeAction =
  | { type: 'focus'; id: string }
  | { type: 'setOpen'; path: string; open: boolean }
  | { type: 'open'; hit: UsageHit }

// 트리 키보드(WAI-ARIA 트리와 하이어라키와 같음): 위/아래·Home/End 이동, 오른쪽은 펼치기(펼쳐 있으면 첫 줄로),
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
      if (row.type !== 'file' || row.group.rows.length === 0) return null
      return row.open ? focus(rows[index + 1]) : { type: 'setOpen', path: row.group.path, open: true }
    case 'ArrowLeft':
      if (row.type === 'line') return { type: 'focus', id: row.parentId }
      return row.open ? { type: 'setOpen', path: row.group.path, open: false } : null
    case 'Enter': {
      const hit = usageRowTarget(row)
      return hit ? { type: 'open', hit } : null
    }
  }
  return null
}
