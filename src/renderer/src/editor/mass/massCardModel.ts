import type { TFunction } from 'i18next'
import { Vector3 } from 'three'
import {
  DEFAULT_ROBOT_MASS,
  MATERIAL_KEYS,
  type CadMassSummary,
  type MassSettings,
  type MassWarning,
  type MaterialKey,
  type ObjectMass,
  type RigidbodySettings,
  type RobotMass
} from '../../mass/types'
import {
  findRobotId,
  frameMatrix,
  subtreeIds,
  worldMatrix,
  type SceneObject,
  type SceneObjects,
  type Vec3
} from '../../scene/model'
import { formatMass, formatNumber, type LengthUnit } from '../../units/units'

// 인스펙터 질량 카드·Rigidbody 카드·추정 한 줄의 보기 계산(그리기와 나눠 시험한다). 계산 자체는 mass/massModel.ts의
// computeMassModel이 하고, 여기서는 그 결과(MassModel)를 문구로 바꾸고 입력을 설정으로 바꾸기만 한다.

// 로봇에 기본 재질이 없을 때의 재질(mass/types.ts RigidbodySettings.defaultMaterial의 "없으면 aluminum6061")
export const ROBOT_DEFAULT_MATERIAL: MaterialKey = 'aluminum6061'
// 채움률을 쓰는 3D 출력 재질(spec-3a §4.1의 printed: true)
export const PRINTED_MATERIALS: readonly MaterialKey[] = ['pla', 'petg', 'abs', 'tpu']
// 입력 범위(spec-3a §2. scene/massSettings.ts의 정리와 같은 범위라, 넘는 입력은 버리고 이전 값을 둔다)
export const MAX_OVERRIDE_MASS = 100
export const MAX_WEIGHED_MASS = 200
export const MAX_CENTER_OF_MASS = 10

export function isPrintedMaterial(key: MaterialKey | undefined): boolean {
  return key !== undefined && PRINTED_MATERIALS.includes(key)
}

// 재질 고르기의 묶음(재료, 3D 출력). 순서는 MATERIAL_KEYS 그대로다.
export const MATERIAL_GROUPS: readonly { key: 'stock' | 'printed'; materials: MaterialKey[] }[] = [
  { key: 'stock', materials: MATERIAL_KEYS.filter((key) => !isPrintedMaterial(key)) },
  { key: 'printed', materials: MATERIAL_KEYS.filter((key) => isPrintedMaterial(key)) }
]

// Add Component의 "질량"을 고를 수 있는지: assembly·part·group·CAD 루트(로봇은 Rigidbody 카드), 이미 있으면 비활성
export function canAddMass(object: SceneObject): boolean {
  return object.kind !== 'robot' && !object.mass
}

// 정의하지 않은 키를 빼고 늘 같은 순서(material, infill, mass, centerOfMass)로 둔다. 빈 설정 {}은 "카드만 붙임"이다.
export function cleanMass(settings: MassSettings): MassSettings {
  const result: MassSettings = {}
  if (settings.material !== undefined) result.material = settings.material
  if (settings.infill !== undefined) result.infill = settings.infill
  if (settings.mass !== undefined) result.mass = settings.mass
  if (settings.centerOfMass !== undefined) result.centerOfMass = settings.centerOfMass
  return result
}

// Rigidbody는 로봇이면 늘 보이므로 정한 것이 없으면 필드를 뗀다(null)
export function cleanRigidbody(settings: RigidbodySettings): RigidbodySettings | null {
  const result: RigidbodySettings = {}
  if (settings.weighedMass !== undefined) result.weighedMass = settings.weighedMass
  if (settings.defaultMaterial !== undefined) result.defaultMaterial = settings.defaultMaterial
  return result.weighedMass === undefined && result.defaultMaterial === undefined ? null : result
}

const sameVec3 = (a: Vec3 | undefined, b: Vec3 | undefined): boolean =>
  a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2])

// 입력이 바꾼 것이 없는지(실행 취소에 빈 단계가 생기지 않게 스토어에 보내지 않는다)
export function sameMassSettings(a: MassSettings, b: MassSettings): boolean {
  return (
    a.material === b.material &&
    a.infill === b.infill &&
    a.mass === b.mass &&
    sameVec3(a.centerOfMass, b.centerOfMass)
  )
}

// 질량 입력(kg)이 범위 안인지(0 < m ≤ max)
export function acceptMass(kg: number, max: number): boolean {
  return Number.isFinite(kg) && kg > 0 && kg <= max
}

// "15", "15%", "15 %" → 0.15. 0–100 밖이거나 읽지 못하면 null
export function parseInfillPercent(text: string): number | null {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*%?$/.exec(text.trim())
  if (!match) return null
  const percent = Number(match[1])
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent / 100 : null
}

// 재질을 어디서 물려받는지: 위 오브젝트의 질량 카드, 로봇의 기본 재질(정하지 않았으면 알루미늄 6061), 로봇 밖이면 기본
export type MaterialOrigin =
  | { kind: 'object'; objectId: string }
  | { kind: 'robot'; robotId: string; set: boolean }
  | { kind: 'none' }

export type InheritedMaterial = { material: MaterialKey; origin: MaterialOrigin }

// 자기 자신을 빼고 위로 가장 가까운 재질. 질량 모델(spec-3a §3.1)의 상속과 같은 길이다(이름 규칙은 모델 결과로 본다).
export function inheritedMaterial(objects: SceneObjects, objectId: string): InheritedMaterial {
  const visited = new Set([objectId])
  let current = objects[objectId]?.parentId ? objects[objects[objectId].parentId!] : undefined
  while (current && !visited.has(current.id)) {
    if (current.kind === 'robot') {
      const set = current.rigidbody?.defaultMaterial
      return {
        material: set ?? ROBOT_DEFAULT_MATERIAL,
        origin: { kind: 'robot', robotId: current.id, set: set !== undefined }
      }
    }
    if (current.mass?.material)
      return { material: current.mass.material, origin: { kind: 'object', objectId: current.id } }
    visited.add(current.id)
    current = current.parentId ? objects[current.parentId] : undefined
  }
  return { material: ROBOT_DEFAULT_MATERIAL, origin: { kind: 'none' } }
}

// 자기 자신을 빼고 위로 가장 가까운 채움률(질량 모델처럼 채움률도 하위로 물려준다). 없으면 undefined(기본값)
export function inheritedInfill(objects: SceneObjects, objectId: string): number | undefined {
  const visited = new Set([objectId])
  let current = objects[objectId]?.parentId ? objects[objects[objectId].parentId!] : undefined
  while (current && !visited.has(current.id) && current.kind !== 'robot') {
    if (current.mass?.infill !== undefined) return current.mass.infill
    visited.add(current.id)
    current = current.parentId ? objects[current.parentId] : undefined
  }
  return undefined
}

// 질량 카드 하나의 보기 값
export type MassCardView = {
  inRobot: boolean
  settings: MassSettings
  inherited: InheritedMaterial
  // 이 오브젝트가 쓰는 재질(자기 것 또는 물려받은 것, 이름 규칙은 빼고)
  material: MaterialKey
  // 채움률 칸을 보일지: 출력 재질이거나 이미 채움률을 정했을 때
  showInfill: boolean
  // 위에서 물려받은 채움률(없으면 undefined = 기본값)
  inheritedInfill: number | undefined
  // 무게중심 칸을 보일지: 질량을 덮어썼거나(덩어리), 이 오브젝트의 데이터시트 질량이거나, 이미 정했을 때.
  // 그 밖의 무게중심은 형상에서 나오므로 덮어쓰기가 쓰이지 않는다(spec-3a §2 MassSettings.centerOfMass).
  showCenterOfMass: boolean
  result: ObjectMass | undefined
}

export function massCardView(
  objects: SceneObjects,
  objectId: string,
  result: ObjectMass | undefined
): MassCardView {
  const settings = objects[objectId]?.mass ?? {}
  const inherited = inheritedMaterial(objects, objectId)
  const material = settings.material ?? inherited.material
  const ownCots = result?.source === 'cots' && result.inheritedFrom === null
  return {
    inRobot: findRobotId(objects, objectId) !== null,
    settings,
    inherited,
    material,
    showInfill: isPrintedMaterial(material) || settings.infill !== undefined,
    inheritedInfill: inheritedInfill(objects, objectId),
    showCenterOfMass: settings.mass !== undefined || ownCots || settings.centerOfMass !== undefined,
    result
  }
}

// [자동]을 끌 때 무게중심 덮어쓰기의 처음 값: 지금 계산한 무게중심을 이 오브젝트 로컬로(없으면 원점)
export function localCenterOfMass(
  objects: SceneObjects,
  objectId: string,
  result: ObjectMass | undefined
): Vec3 {
  if (!result || !(result.mass > 0) || !objects[objectId]) return [0, 0, 0]
  // ObjectMass.centerOfMass는 로봇 좌표(로봇 밖이면 필드 좌표)다. frameMatrix도 로봇 밖이면 필드(단위 행렬)다.
  const toLocal = worldMatrix(objects, objectId)
    .invert()
    .multiply(frameMatrix(objects, objectId, 'robot'))
  const local = new Vector3(...result.centerOfMass).applyMatrix4(toLocal)
  const clamp = (value: number): number =>
    Math.max(-MAX_CENTER_OF_MASS, Math.min(MAX_CENTER_OF_MASS, value))
  return [clamp(local.x), clamp(local.y), clamp(local.z)]
}

// ---- 문구 ----

// 출처를 사람이 읽는 이름으로 바꾸는 표(갈래 B의 mass/cotsTable.ts cotsEntry·mass/nameRules.ts nameRuleMaterial).
// 표를 모르면 키를 그대로 보인다.
export type CotsLabel = { product: string; ratio?: number; cartridges?: number }
export type MassDescribers = {
  cots: (key: string) => CotsLabel | undefined
  nameRuleMaterial: (rule: string) => MaterialKey | null | undefined
}

export const DEFAULT_DESCRIBERS: MassDescribers = {
  cots: () => undefined,
  nameRuleMaterial: () => undefined
}

const isMaterialKey = (value: string): value is MaterialKey =>
  (MATERIAL_KEYS as readonly string[]).includes(value)

export function materialLabel(t: TFunction, key: MaterialKey): string {
  return t(`mass.materials.${key}`)
}

// 데이터시트 출처: COTS 표 키(여럿이면 '+'로 이은 것) → "goBILDA 5203 19.2:1"
export function cotsText(t: TFunction, detail: string, describers: MassDescribers): string {
  return detail
    .split('+')
    .filter((key) => key !== '')
    .map((key) => {
      const label = describers.cots(key)
      if (!label) return key
      if (label.cartridges !== undefined)
        return t('mass.source.cartridges', { product: label.product, count: label.cartridges })
      if (label.ratio !== undefined && label.ratio !== 1)
        return t('mass.source.ratio', { product: label.product, ratio: String(label.ratio) })
      return label.product
    })
    .join(' + ')
}

const ownerName = (objects: SceneObjects, id: string | null): string | null =>
  id !== null && objects[id] ? objects[id].name : null

// 질량이 어디서 왔는지 한 마디(결과 칸·추정 한 줄). 위 오브젝트에서 온 것이면 그 이름을 붙인다.
export function sourceText(
  t: TFunction,
  objects: SceneObjects,
  mass: ObjectMass,
  describers: MassDescribers = DEFAULT_DESCRIBERS
): string {
  const owner = ownerName(objects, mass.inheritedFrom)
  const withOwner = (text: string): string =>
    owner === null ? text : t('mass.source.from', { text, owner })
  switch (mass.source) {
    case 'override':
      return withOwner(t('mass.source.override'))
    case 'cots':
      return withOwner(t('mass.source.cots', { product: cotsText(t, mass.detail, describers) }))
    case 'material':
      return withOwner(
        t('mass.source.material', {
          material: isMaterialKey(mass.detail) ? materialLabel(t, mass.detail) : mass.detail
        })
      )
    case 'nameRule': {
      const material = describers.nameRuleMaterial(mass.detail)
      const text =
        material === null
          ? t('mass.source.nameRuleZero', { rule: mass.detail })
          : material !== undefined
            ? t('mass.source.nameRuleMaterial', {
                rule: mass.detail,
                material: materialLabel(t, material)
              })
            : t('mass.source.nameRule', { rule: mass.detail })
      return withOwner(text)
    }
    case 'default':
      // 파트는 로봇 기본 재질, 로봇은 정보 없음 대체값(DEFAULT_ROBOT_MASS)
      return isMaterialKey(mass.detail)
        ? t('mass.source.robotDefault', { material: materialLabel(t, mass.detail) })
        : t('mass.source.defaultMass')
    case 'none':
      return t('mass.source.none')
  }
}

// 카드가 없는 오브젝트의 한 줄: "질량(추정) 437 g · 데이터시트: goBILDA 5203 19.2:1"
export function estimateLine(
  t: TFunction,
  objects: SceneObjects,
  mass: ObjectMass,
  unit: LengthUnit,
  describers: MassDescribers = DEFAULT_DESCRIBERS
): string {
  const text = t('mass.estimateLine', {
    mass: formatMass(mass.mass, unit),
    source: sourceText(t, objects, mass, describers)
  })
  return mass.scaled ? `${text} ${t('mass.scaledTag')}` : text
}

// 재질 고르기의 빈 값(자기 재질 없음) 이름: 어디서 물려받는지. 위 오브젝트가 정하지 않았고 모델이 이름 규칙을 썼으면
// 이름 규칙을 보인다(질량 모델의 순서: 위 재질 → 이름 규칙 → 로봇 기본).
export function inheritedOptionText(
  t: TFunction,
  objects: SceneObjects,
  view: Pick<MassCardView, 'inherited' | 'result'>
): string {
  const { inherited, result } = view
  const material = materialLabel(t, inherited.material)
  if (inherited.origin.kind === 'object')
    return t('mass.inheritObject', {
      material,
      owner: ownerName(objects, inherited.origin.objectId) ?? ''
    })
  if (result?.source === 'nameRule') return t('mass.inheritNameRule', { rule: result.detail })
  return inherited.origin.kind === 'robot'
    ? t('mass.inheritRobot', { material })
    : t('mass.inheritBuiltIn', { material })
}

// 채움률 칸이 비었을 때 보일 값(물려받은 것 또는 기본값, %)
export function infillPlaceholder(
  t: TFunction,
  inherited: number | undefined,
  defaultInfill: number
): string {
  return inherited !== undefined
    ? t('mass.infillInherited', { percent: formatNumber(inherited * 100, 0) })
    : t('mass.infillDefault', { percent: formatNumber(defaultInfill * 100, 0) })
}

export function formatInfill(infill: number): string {
  return formatNumber(infill * 100, 0)
}

// 관성(kg·m²): 작은 값도 보이게 유효 숫자 세 자리
export function formatInertia(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0'
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(value))))
  return formatNumber(value, Math.min(digits, 8))
}

// 로봇 경고 문구
export function warningText(t: TFunction, warning: MassWarning, unit: LengthUnit): string {
  switch (warning.kind) {
    case 'scaleUnusual':
      return t('mass.warnings.scaleUnusual', { scale: formatNumber(warning.scale, 2) })
    case 'scaleImpossible':
      return t('mass.warnings.scaleImpossible', {
        fixed: formatMass(warning.fixed, unit),
        weighed: formatMass(warning.weighed, unit)
      })
    case 'defaultMass':
      return t('mass.warnings.defaultMass', { mass: formatMass(DEFAULT_ROBOT_MASS, unit) })
    case 'pending':
      return t('mass.warnings.pending', { count: warning.meshes })
  }
}

// Rigidbody 카드의 질량 줄: "12.300 kg (직접 입력·데이터시트 2.100 kg + 추정 10.200 kg)"
export function robotMassBreakdown(t: TFunction, robot: RobotMass, unit: LengthUnit): string {
  return t('mass.rigidbody.breakdown', {
    fixed: formatMass(robot.fixedMass, unit),
    estimated: formatMass(robot.estimatedMass, unit)
  })
}

export type CadSummaryRow = { id: string; name: string; summary: CadMassSummary }

// 로봇 안 CAD 루트 중 메시 상태를 알릴 것(열린·표면 메시가 있거나 읽는 중)
export function cadSummaryRows(
  objects: SceneObjects,
  robotId: string,
  summaryOf: (cadRootId: string) => CadMassSummary | undefined
): CadSummaryRow[] {
  if (!objects[robotId]) return []
  const rows: CadSummaryRow[] = []
  for (const id of subtreeIds(objects, robotId)) {
    if (!objects[id].cad) continue
    const summary = summaryOf(id)
    if (!summary) continue
    if (summary.openMeshes === 0 && summary.surfaceMeshes === 0 && summary.pendingMeshes === 0)
      continue
    rows.push({ id, name: objects[id].name, summary })
  }
  return rows
}

export function cadSummaryText(t: TFunction, row: CadSummaryRow): string {
  const { summary } = row
  const parts: string[] = []
  if (summary.openMeshes > 0)
    parts.push(
      t('mass.rigidbody.openMeshes', {
        count: summary.openMeshes,
        percent: formatNumber(summary.openVolumeFraction * 100, 1)
      })
    )
  if (summary.surfaceMeshes > 0)
    parts.push(t('mass.rigidbody.surfaceMeshes', { count: summary.surfaceMeshes }))
  if (summary.pendingMeshes > 0)
    parts.push(t('mass.rigidbody.pendingMeshes', { count: summary.pendingMeshes }))
  return t('mass.rigidbody.cadSummary', { name: row.name, parts: parts.join(' · ') })
}
