import i18n, { type TFunction } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ko from '../../i18n/locales/ko'
import { MATERIALS } from '../../mass/materials'
import {
  MATERIAL_KEYS,
  type MassModel,
  type CadMassSummary,
  type MassNotice,
  type ObjectMass,
  type RobotMass
} from '../../mass/types'
import { canHaveMass } from '../../scene/massSettings'
import type { SceneObject, SceneObjects, Transform } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { KG_PER_LB, KG_PER_OZ } from '../../units/units'
import HardwareComponentsSection from '../hardware/HardwareComponentsSection'
import MassCard from './MassCard'
import {
  acceptMass,
  bareMassSymbol,
  canAddMass,
  cadSummaryRows,
  cadSummaryText,
  cleanMass,
  cleanRigidbody,
  cotsText,
  DEFAULT_DESCRIBERS,
  estimateLine,
  formatInertia,
  inheritedInfill,
  inheritedMaterial,
  infillReachesPrinted,
  inheritedOptionText,
  isPrintedMaterial,
  MATERIAL_GROUPS,
  localCenterOfMass,
  massCardView,
  loadingCad,
  massInputTitles,
  massText,
  noticeText,
  resultLine,
  optionalCommit,
  parseMassInput,
  objectNotices,
  cardNotices,
  ownsDatasheetMass,
  parseInfillPercent,
  robotMassBreakdown,
  sourceText,
  warningText,
  type MassDescribers
} from './massCardModel'
import RigidbodyCard from './RigidbodyCard'
import { beginChange, endChange } from '../history'
import { cadSummaryFor, DRAG_REFRESH_MS, massModelFor } from './useMassModel'
import { beginCadLoad } from '../../scene/geometryRegistry'

// 질량 모델 계산은 갈래 B가 채운다. 여기서는 정해 둔 가짜 결과로 카드의 문구와 입력만 본다.
const fake = vi.hoisted(() => ({
  model: { objects: {}, robots: {} } as MassModel,
  calls: 0
}))
vi.mock('../../mass/massModel', () => ({
  computeMassModel: () => {
    fake.calls++
    return fake.model
  }
}))

// 단위 스토어는 불러올 때 localStorage를 읽는다(Node 테스트에는 없다)
vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다(wheelCardModel.test.tsx와 같은 방법)
type TestStore<T> = { getInitialState: () => T; setState: (patch: Partial<T>) => void }
const restores: (() => void)[] = []
function setStore<T extends object>(store: TestStore<T>, patch: Partial<T>): void {
  const initial = store.getInitialState()
  const saved = { ...initial }
  restores.push(() => Object.assign(initial, saved))
  Object.assign(initial, patch)
  store.setState(patch)
}
afterEach(() => {
  while (restores.length > 0) restores.pop()!()
  fake.model = { objects: {}, robots: {} }
})

let t: TFunction
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
  t = i18n.t
})

const at = (x: number, y: number, z = 0, yaw = 0): Transform => ({
  position: [x, y, z],
  rotation: [0, 0, yaw]
})

// 로봇 → CAD 루트 → 리프트 그룹(강철) → 볼트·판, CAD 밖 빈 그룹(배터리 자리), 로봇 밖 상자
function scene(): SceneObjects {
  return {
    R: { id: 'R', name: 'Robot', kind: 'robot', parentId: null, transform: at(1, 0) },
    cad: {
      id: 'cad',
      name: 'robot.step',
      kind: 'assembly',
      parentId: 'R',
      transform: at(0, 0),
      cad: {
        fileName: 'robot.step',
        absolutePath: '/robot.step',
        upAxis: '+Z',
        forwardAxis: '+X',
        bounds: { min: [-0.2, -0.2, 0], max: [0.2, 0.2, 0.3] },
        meshCount: 2
      }
    },
    lift: {
      id: 'lift',
      name: 'Lift',
      kind: 'group',
      parentId: 'cad',
      transform: at(0.1, 0, 0.05),
      mass: { material: 'steel' }
    },
    bolt: {
      id: 'bolt',
      name: 'Bolt',
      kind: 'part',
      parentId: 'lift',
      transform: at(0, 0.02, 0.01),
      visual: { type: 'mesh', geometryId: 'cad:0', color: [1, 1, 1] }
    },
    plate: {
      id: 'plate',
      name: 'Plate',
      kind: 'part',
      parentId: 'cad',
      transform: at(-0.1, 0, 0.02),
      visual: { type: 'mesh', geometryId: 'cad:1', color: [1, 1, 1] }
    },
    battery: {
      id: 'battery',
      name: 'Battery',
      kind: 'group',
      parentId: 'R',
      transform: at(-0.05, 0, 0.03, Math.PI / 2),
      mass: { mass: 0.597 }
    },
    box: { id: 'box', name: 'Box', kind: 'part', parentId: null, transform: at(3, 3) }
  }
}

const objectMass = (patch: Partial<ObjectMass>): ObjectMass => ({
  mass: 0.437,
  centerOfMass: [0.1, 0, 0.05],
  source: 'material',
  detail: 'steel',
  inheritedFrom: null,
  scaled: false,
  ...patch
})

const robotMass = (patch: Partial<RobotMass> = {}): RobotMass => ({
  robotId: 'R',
  mass: 12.3,
  centerOfMass: [0.01, -0.02, 0.09],
  inertia: [0.3, 0.4, 0.5, 0, 0, 0],
  principalMoments: [0.3, 0.4, 0.5],
  fixedMass: 2.1,
  estimatedMass: 10.2,
  scale: 1,
  warnings: [],
  ...patch
})

// 갈래 B의 표 대신 쓰는 출처 이름
const DESCRIBERS: MassDescribers = {
  cots: (key) =>
    ({
      'motor:goBilda5203:19.2': { product: 'goBILDA 5203', ratio: 19.2 },
      'motor:revUltraPlanetary:2': { product: 'REV UltraPlanetary', cartridges: 2 },
      pinpoint: { product: 'goBILDA Pinpoint' },
      'motor:revHdHex:1': { product: 'REV HD Hex', ratio: 1 }
    })[key],
  nameRuleMaterial: (rule) => (rule === 'screw' ? 'steel' : rule === 'label' ? null : undefined)
}

describe('질량 카드 보기 계산', () => {
  it('Add Component의 질량: assembly·part·group·CAD 루트에 붙고, 로봇·이미 있는 오브젝트는 비활성', () => {
    const objects = scene()
    expect(canAddMass(objects.cad)).toBe(true)
    expect(canAddMass(objects.plate)).toBe(true)
    expect(canAddMass(objects.bolt)).toBe(true)
    expect(canAddMass({ ...objects.lift, mass: undefined })).toBe(true)
    expect(canAddMass(objects.lift)).toBe(false)
    expect(canAddMass(objects.R)).toBe(false)
  })

  it('재질 상속: 가장 가까운 위 오브젝트의 재질, 없으면 로봇 기본 재질(정하지 않았으면 알루미늄 6061)', () => {
    let objects = scene()
    expect(inheritedMaterial(objects, 'bolt')).toEqual({
      material: 'steel',
      origin: { kind: 'object', objectId: 'lift' }
    })
    // 자기 재질은 상속이 아니다
    expect(inheritedMaterial(objects, 'lift')).toEqual({
      material: 'aluminum6061',
      origin: { kind: 'robot', robotId: 'R', set: false }
    })
    objects = { ...objects, R: { ...objects.R, rigidbody: { defaultMaterial: 'pla' } } }
    expect(inheritedMaterial(objects, 'plate')).toEqual({
      material: 'pla',
      origin: { kind: 'robot', robotId: 'R', set: true }
    })
    expect(inheritedMaterial(objects, 'box')).toEqual({
      material: 'aluminum6061',
      origin: { kind: 'none' }
    })
  })

  it('채움률 칸은 직접 정한 출력 재질(자기·상속)이거나 이미 정했을 때, 채움률도 위에서 물려받는다', () => {
    let objects = scene()
    expect(massCardView(objects, 'lift', {}).showInfill).toBe(false)
    objects = { ...objects, lift: { ...objects.lift, mass: { material: 'petg', infill: 0.4 } } }
    expect(massCardView(objects, 'lift', {}).showInfill).toBe(true)
    objects = { ...objects, bolt: { ...objects.bolt, mass: {} } }
    const bolt = massCardView(objects, 'bolt', {})
    expect(bolt.material).toBe('petg')
    expect(bolt.showInfill).toBe(true)
    expect(bolt.inheritedInfill).toBe(0.4)
    expect(inheritedInfill(objects, 'plate')).toBeUndefined()
    // 출력 재질이 아니어도 정해 둔 채움률은 지울 수 있게 보인다
    objects = { ...objects, plate: { ...objects.plate, mass: { infill: 0.2 } } }
    expect(massCardView(objects, 'plate', {}).showInfill).toBe(true)
  })

  it('이름 규칙이 출력 재질로 정한 파트(자기·하위)에도 채움률 칸, 채움률을 다시 정한 하위는 빼고', () => {
    const objects = scene()
    const describers: MassDescribers = {
      ...DESCRIBERS,
      nameRuleMaterial: (rule) => (rule === 'pla' ? 'pla' : undefined)
    }
    const pla = objectMass({ source: 'nameRule', detail: 'pla' })
    // 'PLA bracket' 같은 파트: 자기 결과가 이름 규칙 PLA
    expect(massCardView(objects, 'plate', { plate: pla }, describers).showInfill).toBe(true)
    // 기본 설명 표(nameRules.ts)도 'pla' 규칙을 PLA로 안다. 재질을 모르는 규칙이면 칸이 없다
    expect(massCardView(objects, 'plate', { plate: pla }).showInfill).toBe(true)
    const unknown: MassDescribers = { ...DESCRIBERS, nameRuleMaterial: () => undefined }
    expect(massCardView(objects, 'plate', { plate: pla }, unknown).showInfill).toBe(false)
    // 그룹: 하위 파트가 이름 규칙 PLA면 그룹의 채움률이 닿는다(그룹 결과의 출처가 다른 것이어도)
    const results = { lift: objectMass({}), bolt: pla }
    expect(massCardView(objects, 'lift', results, describers).showInfill).toBe(true)
    expect(infillReachesPrinted(objects, 'cad', results, describers)).toBe(true)
    // 하위가 자기 채움률을 정했으면 위 채움률은 닿지 않는다
    const own = { ...objects, bolt: { ...objects.bolt, mass: { infill: 0.3 } } }
    expect(infillReachesPrinted(own, 'lift', results, describers)).toBe(false)
    // 재질 상속·로봇 기본의 출력 재질도 결과로 본다
    expect(
      infillReachesPrinted(objects, 'cad', {
        plate: objectMass({ source: 'default', detail: 'petg', inheritedFrom: 'R' })
      })
    ).toBe(true)
    expect(infillReachesPrinted(objects, 'cad', { plate: objectMass({}) })).toBe(false)
  })

  it('로봇 기본 재질이 출력 재질이어도 이름 규칙이 강철로 정한 파트에는 채움률 칸이 없다(이름 규칙이 먼저)', () => {
    let objects = scene()
    objects = {
      ...objects,
      R: { ...objects.R, rigidbody: { defaultMaterial: 'pla' } },
      plate: { ...objects.plate, name: 'screw M3', mass: {} }
    }
    const describers: MassDescribers = {
      ...DESCRIBERS,
      nameRuleMaterial: (rule) => (rule === 'screw' ? 'steel' : undefined)
    }
    const screw = objectMass({ source: 'nameRule', detail: 'screw' })
    const view = massCardView(objects, 'plate', { plate: screw }, describers)
    expect(view.material).toBe('pla')
    expect(view.showInfill).toBe(false)
    // 같은 파트가 로봇 기본(PLA)으로 추정됐으면 채움률이 쓰인다
    const byDefault = objectMass({ source: 'default', detail: 'pla', inheritedFrom: 'R' })
    expect(massCardView(objects, 'plate', { plate: byDefault }, describers).showInfill).toBe(true)
    // 위 오브젝트가 직접 정한 출력 재질은 이름 규칙보다 먼저라 결과 없이도 보인다
    objects = { ...objects, cad: { ...objects.cad, mass: { material: 'petg' } } }
    expect(massCardView(objects, 'plate', {}, describers).showInfill).toBe(true)
  })

  it('무게중심 칸은 질량을 덮어썼거나 이 오브젝트가 데이터시트 질량을 정했거나 이미 정했을 때', () => {
    const objects = scene()
    expect(massCardView(objects, 'battery', {}).showCenterOfMass).toBe(true)
    expect(massCardView(objects, 'lift', { lift: objectMass({}) }).showCenterOfMass).toBe(false)
    const cots = objectMass({ source: 'cots', detail: 'pinpoint' })
    // 형상 없이(점질량) 또는 자기 형상에 정한 데이터시트 질량
    expect(massCardView(objects, 'bolt', { bolt: cots }).showCenterOfMass).toBe(true)
    expect(massCardView(objects, 'battery', { battery: cots }).showCenterOfMass).toBe(true)
    // 위 오브젝트의 데이터시트 질량에 덮인 파트에는 쓰이지 않는다
    expect(
      massCardView(objects, 'bolt', { bolt: { ...cots, inheritedFrom: 'cad' } }).showCenterOfMass
    ).toBe(false)
  })

  it('그룹의 결과가 데이터시트여도 그것을 하위 파트가 정했으면 무게중심 칸이 없다', () => {
    let objects = scene()
    objects = { ...objects, lift: { ...objects.lift, mass: {} } }
    const motor = objectMass({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
    // 하위(bolt)가 정한 모터 질량: 질량 모델은 그룹 결과의 inheritedFrom도 null로 둔다(하위가 정한 것)
    const childOwned = { lift: motor, bolt: motor }
    expect(ownsDatasheetMass(objects, 'lift', childOwned)).toBe(false)
    expect(massCardView(objects, 'lift', childOwned).showCenterOfMass).toBe(false)
    expect(ownsDatasheetMass(objects, 'bolt', childOwned)).toBe(true)
    // 그룹이 정한 데이터시트 질량은 하위 파트가 그룹에게서 받는다
    const groupOwned = { lift: motor, bolt: { ...motor, inheritedFrom: 'lift' } }
    expect(ownsDatasheetMass(objects, 'lift', groupOwned)).toBe(true)
    expect(massCardView(objects, 'lift', groupOwned).showCenterOfMass).toBe(true)
    // 하위 출처가 더 무거워 그룹 결과가 다른 출처여도 그룹이 정한 것은 안다
    const heavier = { lift: objectMass({ source: 'override', detail: '' }), bolt: groupOwned.bolt }
    expect(ownsDatasheetMass(objects, 'lift', heavier)).toBe(true)
    // 이미 정했지만 쓰이지 않는 무게중심은 지울 수 있게 칸을 보이고 알린다
    objects = { ...objects, lift: { ...objects.lift, mass: { centerOfMass: [0.5, 0, 0] } } }
    const unused = massCardView(objects, 'lift', childOwned)
    expect(unused.showCenterOfMass).toBe(true)
    expect(unused.centerOfMassUnused).toBe(true)
    expect(massCardView(objects, 'lift', groupOwned).centerOfMassUnused).toBe(false)
    expect(massCardView(scene(), 'battery', {}).centerOfMassUnused).toBe(false)
  })

  it('무게중심 [자동]을 끄면 계산한 무게중심(로봇 좌표)을 이 오브젝트 로컬로 옮겨 처음 값으로 쓴다', () => {
    const objects = scene()
    // battery는 로봇 (−0.05, 0, 0.03)에서 90° 돌아 있다: 로봇 (−0.05, 0.1, 0.03)은 로컬 (0.1, 0, 0)
    const local = localCenterOfMass(
      objects,
      'battery',
      objectMass({ centerOfMass: [-0.05, 0.1, 0.03] })
    )
    expect(local[0]).toBeCloseTo(0.1, 12)
    expect(local[1]).toBeCloseTo(0, 12)
    expect(local[2]).toBeCloseTo(0, 12)
    expect(localCenterOfMass(objects, 'battery', undefined)).toEqual([0, 0, 0])
    expect(localCenterOfMass(objects, 'battery', objectMass({ mass: 0 }))).toEqual([0, 0, 0])
    // 로봇 밖은 필드 좌표
    const box = localCenterOfMass(objects, 'box', objectMass({ centerOfMass: [3, 3.5, 0] }))
    expect(box.map((v) => Number(v.toFixed(12)))).toEqual([0, 0.5, 0])
  })

  it('입력 정리: 정의하지 않은 키를 빼고 같은 순서, Rigidbody는 비면 뗀다, 범위 밖 질량·채움률은 버린다', () => {
    expect(
      Object.keys(
        cleanMass({ centerOfMass: [0, 0, 0], mass: 1, infill: undefined, material: 'steel' })
      )
    ).toEqual(['material', 'mass', 'centerOfMass'])
    expect(cleanMass({ mass: undefined })).toEqual({})
    expect(cleanRigidbody({ weighedMass: undefined, defaultMaterial: undefined })).toBeNull()
    expect(cleanRigidbody({ weighedMass: 14 })).toEqual({ weighedMass: 14 })
    expect(acceptMass(0, 100)).toBe(false)
    expect(acceptMass(-1, 100)).toBe(false)
    expect(acceptMass(100, 100)).toBe(true)
    expect(acceptMass(100.1, 100)).toBe(false)
    expect(acceptMass(Number.NaN, 100)).toBe(false)
    expect(parseInfillPercent('15')).toBe(0.15)
    expect(parseInfillPercent(' 40 % ')).toBe(0.4)
    expect(parseInfillPercent('100')).toBe(1)
    expect(parseInfillPercent('101')).toBeNull()
    expect(parseInfillPercent('-1')).toBeNull()
    expect(parseInfillPercent('abc')).toBeNull()
  })
})

describe('질량 출처 문구', () => {
  it('기본 설명 표는 질량 모델의 COTS 표·이름 규칙이고, 출력 재질·Add Component 규칙도 모델 쪽을 따른다', () => {
    // mass/cotsTable.ts·mass/nameRules.ts의 실제 값
    expect(cotsText(t, 'motor:goBilda5203:19.2', DEFAULT_DESCRIBERS)).toBe('goBILDA 5203 19.2:1')
    expect(cotsText(t, 'battery:gobilda', DEFAULT_DESCRIBERS)).toBe('goBILDA 12V NiMH 3000mAh')
    expect(DEFAULT_DESCRIBERS.nameRuleMaterial('screw')).toBe('steel')
    expect(DEFAULT_DESCRIBERS.nameRuleMaterial('label')).toBeNull()
    expect(DEFAULT_DESCRIBERS.nameRuleMaterial('no such rule')).toBeUndefined()
    const objects = scene()
    expect(
      sourceText(
        t,
        objects,
        objectMass({ source: 'nameRule', detail: 'screw', inheritedFrom: null })
      )
    ).toBe('이름 규칙: ‘screw’ → 강철')
    // 출력 재질은 materials.ts의 printed
    for (const key of MATERIAL_KEYS) expect(isPrintedMaterial(key)).toBe(MATERIALS[key].printed)
    expect(MATERIAL_GROUPS[1].materials).toEqual(
      MATERIAL_KEYS.filter((key) => MATERIALS[key].printed)
    )
    // canHaveMass(scene/massSettings.ts)가 받지 않는 것은 Add Component도 막는다
    for (const id of Object.keys(objects))
      if (!canHaveMass(objects[id])) expect(canAddMass(objects[id])).toBe(false)
  })

  it('데이터시트: 표의 제품명·감속비·카트리지 수, 여럿이면 +로 잇고, 표를 모르면 키 그대로', () => {
    expect(cotsText(t, 'motor:goBilda5203:19.2', DESCRIBERS)).toBe('goBILDA 5203 19.2:1')
    expect(cotsText(t, 'motor:revHdHex:1', DESCRIBERS)).toBe('REV HD Hex')
    expect(cotsText(t, 'motor:revUltraPlanetary:2', DESCRIBERS)).toBe(
      'REV UltraPlanetary (카트리지 2개)'
    )
    expect(cotsText(t, 'motor:goBilda5203:19.2+pinpoint', DESCRIBERS)).toBe(
      'goBILDA 5203 19.2:1 + goBILDA Pinpoint'
    )
    expect(cotsText(t, 'unknown:key', DESCRIBERS)).toBe('unknown:key')
  })

  it('출처마다 문구, 위 오브젝트에서 온 것이면 그 이름을 붙인다', () => {
    const objects = scene()
    const text = (patch: Partial<ObjectMass>): string =>
      sourceText(t, objects, objectMass(patch), DESCRIBERS)
    expect(text({ source: 'override', detail: '' })).toBe('직접 입력')
    expect(text({ source: 'override', detail: '', inheritedFrom: 'battery' })).toBe(
      '직접 입력 (Battery)'
    )
    expect(text({ source: 'cots', detail: 'motor:goBilda5203:19.2' })).toBe(
      '데이터시트: goBILDA 5203 19.2:1'
    )
    expect(text({ source: 'material', detail: 'steel', inheritedFrom: 'lift' })).toBe(
      '재질: 강철 (Lift)'
    )
    expect(text({ source: 'nameRule', detail: 'screw' })).toBe('이름 규칙: ‘screw’ → 강철')
    expect(text({ source: 'nameRule', detail: 'label' })).toBe('이름 규칙: ‘label’ (질량 없음)')
    expect(text({ source: 'nameRule', detail: 'gobilda-1120' })).toBe('이름 규칙: ‘gobilda-1120’')
    // 로봇 기본 재질은 로봇에서 온 것이라 이름을 붙이지 않는다
    expect(text({ source: 'default', detail: 'aluminum6061', inheritedFrom: 'R' })).toBe(
      '로봇 기본 재질: 알루미늄 6061'
    )
    expect(text({ source: 'default', detail: '' })).toBe('기본값 (질량 정보 없음)')
    expect(text({ source: 'none', detail: '' })).toBe('질량 없음 (형상 없음 또는 표면 메시)')
    // 지운 오브젝트에서 왔으면 이름 없이
    expect(text({ source: 'override', detail: '', inheritedFrom: 'gone' })).toBe('직접 입력')
  })

  it('추정 한 줄: 질량(표시 단위)과 출처, 저울 무게에 맞췄으면 표시', () => {
    const objects = scene()
    const mass = objectMass({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
    expect(estimateLine(t, objects, mass, 'mm', DESCRIBERS)).toBe(
      `질량(추정) ${massText(t, 0.437, 'mm')} · 데이터시트: goBILDA 5203 19.2:1`
    )
    expect(estimateLine(t, objects, { ...mass, scaled: true }, 'in', DESCRIBERS)).toBe(
      `질량(추정) ${massText(t, 0.437, 'in')} · 데이터시트: goBILDA 5203 19.2:1 (저울 무게에 맞춤)`
    )
  })

  it('CAD를 읽는 중: 아직 질량이 없으면 "형상 없음"이 아니라 읽는 중, 일부를 셌으면 표시를 붙인다', () => {
    const objects = scene()
    const none = objectMass({ mass: 0, source: 'none', detail: '' })
    expect(estimateLine(t, objects, none, 'mm', DESCRIBERS, true)).toBe(
      '질량(추정) — · 형상을 읽는 중'
    )
    expect(estimateLine(t, objects, none, 'mm', DESCRIBERS)).toBe(
      `질량(추정) ${massText(t, 0, 'mm')} · 질량 없음 (형상 없음 또는 표면 메시)`
    )
    expect(resultLine(t, objects, none, 'mm', DESCRIBERS, true)).toBe('결과: — · 형상을 읽는 중')
    const partial = objectMass({ scaled: true })
    expect(resultLine(t, objects, partial, 'mm', DESCRIBERS, true)).toBe(
      `결과: ${massText(t, 0.437, 'mm')} · 재질: 강철 (저울 무게에 맞춤) (형상을 읽는 중, 일부만 셈)`
    )
    expect(resultLine(t, objects, partial, 'mm', DESCRIBERS)).toBe(
      `결과: ${massText(t, 0.437, 'mm')} · 재질: 강철 (저울 무게에 맞춤)`
    )
  })

  it('읽는 중인 CAD: 이 오브젝트와 하위 형상의 CAD 루트(형상 id 접두어) 요약에 읽는 중인 메시가 있으면', () => {
    const objects = scene()
    const summary = (pendingMeshes: number): CadMassSummary => ({
      meshes: 2,
      openMeshes: 0,
      openVolumeFraction: 0,
      surfaceMeshes: 0,
      pendingMeshes
    })
    const asked: string[] = []
    const loading = (id: string): CadMassSummary | undefined => {
      asked.push(id)
      return id === 'cad' ? summary(2) : undefined
    }
    expect(loadingCad(objects, 'bolt', loading)).toBe(true)
    expect(loadingCad(objects, 'lift', loading)).toBe(true)
    expect(loadingCad(objects, 'cad', loading)).toBe(true)
    // 형상이 없는 그룹·지운 오브젝트는 아니다
    expect(loadingCad(objects, 'battery', loading)).toBe(false)
    expect(loadingCad(objects, 'gone', loading)).toBe(false)
    expect(loadingCad(objects, 'bolt', () => summary(0))).toBe(false)
    // 다른 그룹(로봇 바로 아래)으로 옮긴 파트도 형상 id의 CAD 루트를 본다
    const moved = { ...objects, bolt: { ...objects.bolt, parentId: 'R' } }
    expect(loadingCad(moved, 'bolt', loading)).toBe(true)
    expect(new Set(asked)).toEqual(new Set(['cad']))
  })

  it('재질 고르기의 빈 값: 위 오브젝트 → 이름 규칙(모델 결과) → 로봇 기본 → 기본', () => {
    let objects = scene()
    const option = (id: string, result?: ObjectMass): string =>
      inheritedOptionText(t, objects, massCardView(objects, id, result ? { [id]: result } : {}))
    expect(option('bolt')).toBe('상속: 강철 (Lift)')
    expect(option('plate')).toBe('상속: 알루미늄 6061 (로봇 기본)')
    expect(option('plate', objectMass({ source: 'nameRule', detail: 'screw' }))).toBe(
      '상속: 이름 규칙 ‘screw’'
    )
    // 위 오브젝트가 정한 재질은 이름 규칙보다 먼저다
    expect(option('bolt', objectMass({ source: 'nameRule', detail: 'screw' }))).toBe(
      '상속: 강철 (Lift)'
    )
    // 하위가 있는 오브젝트의 결과 출처는 하위 중 가장 큰 것이라 이름 규칙을 물려받는다고 하지 않는다
    expect(option('cad', objectMass({ source: 'nameRule', detail: 'screw' }))).toBe(
      '상속: 알루미늄 6061 (로봇 기본)'
    )
    expect(option('box')).toBe('상속: 알루미늄 6061 (기본)')
    objects = { ...objects, R: { ...objects.R, rigidbody: { defaultMaterial: 'carbonFiber' } } }
    expect(option('plate')).toBe('상속: 탄소섬유 (로봇 기본)')
  })

  it('로봇 경고·합계·관성 형식', () => {
    expect(warningText(t, { kind: 'scaleUnusual', scale: 1.734 }, 'mm')).toContain('1.73배')
    expect(warningText(t, { kind: 'scaleImpossible', fixed: 15, weighed: 12 }, 'mm')).toContain(
      `(${massText(t, 15, 'mm')})이 저울 무게(${massText(t, 12, 'mm')})`
    )
    expect(warningText(t, { kind: 'defaultMass' }, 'mm')).toContain(
      `기본값 ${massText(t, 13.6, 'mm')}(FTC 대회 로봇에 흔한 무게)`
    )
    // 저울 무게가 있으면 기본값이 아니라 그 무게를 외곽 상자에 둔다고 알린다
    const weighed = warningText(t, { kind: 'defaultMass' }, 'in', 20)
    expect(weighed).toContain(`저울 무게 ${massText(t, 20, 'in')}를 로봇 외곽 상자에`)
    expect(weighed).not.toContain(massText(t, 13.6, 'in'))
    expect(weighed).not.toContain('저울 무게를 넣거나')
    expect(warningText(t, { kind: 'pending', meshes: 3 }, 'mm')).toBe(
      '형상을 읽는 중인 메시 3개는 아직 계산에 들어가지 않았습니다.'
    )
    expect(robotMassBreakdown(t, robotMass(), 'cm')).toBe(
      `직접 입력·데이터시트 ${massText(t, 2.1, 'cm')} + 추정 ${massText(t, 10.2, 'cm')}`
    )
    // 질량 정보 없음 대체값은 출처별 합계("추정")가 아니다
    const fallback = robotMass({
      fixedMass: 0,
      estimatedMass: 20,
      warnings: [{ kind: 'defaultMass' }]
    })
    expect(robotMassBreakdown(t, fallback, 'cm')).toBe('기본값 (질량 정보 없음)')
    expect(robotMassBreakdown(t, fallback, 'cm', 20)).toBe(
      '저울 무게 (형상 없음, 외곽 상자로 근사)'
    )
    // 저울 무게가 있고 형상을 모두 읽는 중이면(질량 모델이 저울 무게를 상자로 둔다) 읽는 중이라고 알린다
    const loading = robotMass({
      fixedMass: 0,
      estimatedMass: 20,
      warnings: [{ kind: 'defaultMass' }, { kind: 'pending', meshes: 4 }]
    })
    expect(robotMassBreakdown(t, loading, 'cm', 20)).toBe(
      '저울 무게 (형상을 읽는 중, 외곽 상자로 근사)'
    )
    expect(warningText(t, { kind: 'defaultMass' }, 'cm', 20, true)).toContain(
      `형상을 읽는 동안 저울 무게 ${massText(t, 20, 'cm')}를`
    )
    expect(formatInertia(0.31234)).toBe('0.312')
    expect(formatInertia(0.0012345)).toBe('0.00123')
    expect(formatInertia(12.345)).toBe('12.3')
    expect(formatInertia(0)).toBe('0')
  })

  it('CAD 루트 메시 상태: 열린·표면·읽는 중이 있는 CAD만, 순서는 하이어라키', () => {
    const objects = scene()
    const summaries = {
      cad: {
        meshes: 2,
        openMeshes: 1,
        openVolumeFraction: 0.0123,
        surfaceMeshes: 2,
        pendingMeshes: 0
      }
    }
    const rows = cadSummaryRows(objects, 'R', (id) => summaries[id as 'cad'])
    expect(rows.map((row) => row.id)).toEqual(['cad'])
    expect(cadSummaryText(t, rows[0])).toBe(
      'robot.step: 열린 메시 1개 (부피의 1.2%, 근사) · 표면 메시 2개 (질량 0)'
    )
    const clean = { ...summaries.cad, openMeshes: 0, surfaceMeshes: 0 }
    expect(cadSummaryRows(objects, 'R', () => clean)).toEqual([])
    expect(cadSummaryRows(objects, 'R', () => undefined)).toEqual([])
  })
})

describe('질량 입력', () => {
  it('단위 없는 숫자는 칸에 보이는 값의 단위, 빈 칸은 파트 g·로봇 kg(in이면 lb)', () => {
    // "437 g"을 보이는 칸에 친 450은 450 g(이전에는 450 kg로 읽고 범위 밖이라 버렸다)
    expect(massText(t, 0.437, 'mm')).toBe('437 g')
    expect(bareMassSymbol(0.437, 'mm', 'part')).toBe('g')
    expect(parseMassInput('450', 'mm', 0.437, 'part', 100)).toBeCloseTo(0.45, 15)
    expect(bareMassSymbol(2.5, 'cm', 'part')).toBe('kg')
    expect(parseMassInput('3', 'cm', 2.5, 'part', 100)).toBe(3)
    expect(bareMassSymbol(0.02, 'in', 'part')).toBe('oz')
    expect(parseMassInput('1.5', 'in', 0.02, 'part', 100)).toBeCloseTo(1.5 * KG_PER_OZ, 15)
    expect(bareMassSymbol(14, 'in', 'robot')).toBe('lb')
    // 빈 칸
    expect(bareMassSymbol(undefined, 'mm', 'part')).toBe('g')
    expect(parseMassInput('450', 'mm', undefined, 'part', 100)).toBeCloseTo(0.45, 15)
    expect(bareMassSymbol(undefined, 'm', 'robot')).toBe('kg')
    expect(parseMassInput('14', 'm', undefined, 'robot', 200)).toBe(14)
    expect(bareMassSymbol(undefined, 'in', 'part')).toBe('lb')
    expect(bareMassSymbol(undefined, 'in', 'robot')).toBe('lb')
    expect(parseMassInput('30', 'in', undefined, 'robot', 200)).toBeCloseTo(30 * KG_PER_LB, 12)
    // 단위를 붙이면 그 단위, 범위 밖·읽지 못함은 null
    expect(parseMassInput('1.2kg', 'mm', 0.437, 'part', 100)).toBe(1.2)
    expect(parseMassInput('101 kg', 'mm', 0.437, 'part', 100)).toBeNull()
    expect(parseMassInput('0', 'mm', 0.437, 'part', 100)).toBeNull()
    expect(parseMassInput('abc', 'mm', 0.437, 'part', 100)).toBeNull()
    expect(parseMassInput('250', 'mm', undefined, 'robot', 200)).toBeNull()
  })

  it('도움말은 단위 없는 숫자의 단위를, 받지 않은 입력의 설명은 범위를 말한다', () => {
    const part = massInputTitles(t, undefined, 'mm', 'part', 100)
    expect(part.title).toContain('단위가 없으면 g입니다.')
    expect(part.invalidTitle).toContain(`0보다 크고 ${massText(t, 100, 'mm')} 이하`)
    expect(massInputTitles(t, 14, 'in', 'robot', 200).title).toContain('단위가 없으면 lb입니다.')
  })

  it('비울 수 있는 칸의 확정: 빈 글자는 떼기, 같은 글자는 그대로, 받지 않은 입력은 값을 바꾸지 않는다', () => {
    const parse = (text: string): number | null => parseMassInput(text, 'mm', 0.437, 'part', 100)
    expect(optionalCommit('450', '437 g', parse)).toEqual({ kind: 'set', value: 0.45 })
    expect(optionalCommit(' 437 g ', '437 g', parse)).toEqual({ kind: 'unchanged' })
    expect(optionalCommit('  ', '437 g', parse)).toEqual({ kind: 'clear' })
    expect(optionalCommit('', '', parse)).toEqual({ kind: 'unchanged' })
    // 범위 밖은 지우지 않고 rejected(입력칸이 틀렸다고 보인다)
    expect(optionalCommit('450 kg', '437 g', parse)).toEqual({ kind: 'rejected' })
    expect(optionalCommit('heavy', '', parse)).toEqual({ kind: 'rejected' })
    expect(optionalCommit('101', '15', parseInfillPercent)).toEqual({ kind: 'rejected' })
  })
})

describe('쓰지 못한 질량 설정 알림', () => {
  const pod: Extract<MassNotice, { kind: 'podIgnored' }> = {
    kind: 'podIgnored',
    objectId: 'plate',
    pinpointId: 'bolt',
    reason: 'tooLarge'
  }
  const notices: MassNotice[] = [
    { kind: 'innerMassExceeds', objectId: 'battery', mass: 0.2, inner: 0.5 },
    { kind: 'centerOfMassIgnored', objectId: 'lift' },
    pod
  ]

  it('문구: 오브젝트 이름·표시 단위 질량·포드 이유, 지운 오브젝트는 id', () => {
    const objects = scene()
    expect(noticeText(t, objects, notices[0], 'mm')).toBe(
      `Battery 안의 질량 직접 입력 합(${massText(t, 0.5, 'mm')})이 Battery의 질량(${massText(t, 0.2, 'mm')})보다 커서 안쪽 값을 그대로 씁니다.`
    )
    expect(noticeText(t, objects, notices[1], 'mm')).toMatch(/^Lift의 무게중심 덮어쓰기는 쓰이지/)
    expect(noticeText(t, objects, notices[2], 'mm')).toBe(
      'Plate을(를) Bolt의 Pinpoint 포드로 볼 수 없어 포드 질량을 쓰지 않고 추정합니다(형상이 포드 하나로 보기에 너무 큼).'
    )
    for (const reason of ['otherRobot', 'containsPinpoint', 'containsCots', 'tooLarge'] as const) {
      const text = noticeText(t, objects, { ...pod, reason, objectId: 'gone' }, 'in')
      expect(text.startsWith('gone을(를) ')).toBe(true)
      expect(text).toContain(`(${ko.mass.notices.podReasons[reason]})`)
    }
  })

  it('오브젝트의 알림은 모든 로봇에서 모으고, 질량 카드는 칸 아래에 이미 알린 무게중심은 빼고 보인다', () => {
    const model: MassModel = {
      objects: {},
      robots: {
        R: robotMass({ notices }),
        S: robotMass({ robotId: 'S', notices: [notices[1]] }),
        T: robotMass({ robotId: 'T' })
      }
    }
    expect(objectNotices(model, 'lift')).toEqual([notices[1], notices[1]])
    expect(objectNotices(model, 'plate')).toEqual([notices[2]])
    expect(objectNotices(model, 'box')).toEqual([])
    expect(cardNotices(model, 'lift', { centerOfMassUnused: true })).toEqual([])
    expect(cardNotices(model, 'lift', { centerOfMassUnused: false })).toHaveLength(2)
    expect(cardNotices(model, 'battery', { centerOfMassUnused: true })).toEqual([notices[0]])
  })
})

describe('질량 모델 기억', () => {
  it('CAD 루트 요약은 모델을 계산한 문서로 구하고(스토어의 지금 문서가 아니라) 같은 계산 동안 기억한다', () => {
    const objects = scene()
    // 스토어에는 이 CAD를 쓰지 않는 문서가 있다
    setStore(useSceneStore, { objects: { R: objects.R } })
    const end = beginCadLoad('cad')
    try {
      const summaryOf = cadSummaryFor(objects, 1)
      const first = summaryOf('cad')
      // 이 문서가 쓰는 형상 2개(bolt·plate)가 읽는 중
      expect(first).toMatchObject({ pendingMeshes: 2 })
      expect(summaryOf('cad')).toBe(first)
      expect(cadSummaryFor(objects, 1)('cad')).toBe(first)
      expect(summaryOf('other')).toBeUndefined()
      // 형상 판이 바뀌면 다시 구한다
      end()
      expect(cadSummaryFor(objects, 2)('cad')).toMatchObject({ pendingMeshes: 0 })
    } finally {
      end()
    }
  })

  it('같은 문서·형상 판이면 다시 계산하지 않고, 어느 하나가 바뀌면 다시 계산한다', () => {
    const objects = scene()
    const before = fake.calls
    const first = massModelFor(objects, 7)
    expect(massModelFor(objects, 7)).toBe(first)
    expect(fake.calls).toBe(before + 1)
    massModelFor(objects, 8)
    expect(fake.calls).toBe(before + 2)
    massModelFor(scene(), 8)
    expect(fake.calls).toBe(before + 3)
  })

  it('핸들 드래그(묶는 중인 변경) 동안에는 간격마다만 다시 계산하고, 끝나면 마지막 문서로 계산한다', () => {
    vi.useFakeTimers()
    try {
      const start = 10_000
      massModelFor(scene(), 1, start)
      const before = fake.calls
      beginChange()
      // 첫 프레임은 바로 계산한다(마지막 계산이 간격보다 오래전)
      massModelFor(scene(), 1, start + DRAG_REFRESH_MS)
      expect(fake.calls).toBe(before + 1)
      // 간격 안의 프레임은 이전 결과
      const stale = fake.model
      fake.model = { objects: { x: objectMass({}) }, robots: {} }
      expect(massModelFor(scene(), 1, start + DRAG_REFRESH_MS + 16)).toBe(stale)
      expect(massModelFor(scene(), 2, start + DRAG_REFRESH_MS + 32)).toBe(stale)
      expect(fake.calls).toBe(before + 1)
      // 간격이 지나면 다시 계산한다
      expect(massModelFor(scene(), 2, start + 2 * DRAG_REFRESH_MS)).toBe(fake.model)
      expect(fake.calls).toBe(before + 2)
      massModelFor(scene(), 2, start + 2 * DRAG_REFRESH_MS + 16)
      expect(fake.calls).toBe(before + 2)
      endChange()
      // 묶음이 닫히면 간격 안이어도 바로 계산하고, 같은 문서는 다시 계산하지 않는다
      const last = scene()
      expect(massModelFor(last, 2, start + 2 * DRAG_REFRESH_MS + 20)).toBe(fake.model)
      expect(fake.calls).toBe(before + 3)
      massModelFor(last, 2, start + 2 * DRAG_REFRESH_MS + 30)
      expect(fake.calls).toBe(before + 3)
    } finally {
      endChange()
      vi.runAllTimers()
      vi.useRealTimers()
    }
  })
})

describe('질량 카드 그리기', () => {
  const render = (objects: SceneObjects, element: () => React.JSX.Element): string => {
    setStore(useSceneStore, { objects })
    setStore(useUnitStore, { lengthUnit: 'mm' })
    return renderToStaticMarkup(element())
  }

  it('재질(상속 표시)·질량 덮어쓰기(추정값)·결과·로봇 좌표 무게중심, [제거]', () => {
    const objects = scene()
    const withCard: SceneObject = { ...objects.bolt, mass: {} }
    const next = { ...objects, bolt: withCard }
    fake.model = {
      objects: { bolt: objectMass({ inheritedFrom: 'lift', centerOfMass: [0.1, 0.02, 0.06] }) },
      robots: {}
    }
    const html = render(next, () => <MassCard object={withCard} />)
    expect(html).toContain('data-component-type="mass"')
    expect(html).toContain('<option value="" selected="">상속: 강철 (Lift)</option>')
    expect(html).toContain('<optgroup label="3D 출력">')
    expect(html).not.toContain('채움률')
    expect(html).toContain(`placeholder="추정 ${massText(t, 0.437, 'mm')}"`)
    expect(html).toContain(`결과: ${massText(t, 0.437, 'mm')} · 재질: 강철 (Lift)`)
    expect(html).toContain('무게중심 (로봇 기준)')
    expect(html).toContain('<output>100.0</output><')
    expect(html).toContain('<output>20.0</output>')
    expect(html).toContain('aria-label="질량 제거"')
    // 무게중심 덮어쓰기는 덮어쓴 질량이 없으면 쓰이지 않으므로 보이지 않는다
    expect(html).not.toContain('자동')
  })

  it('출력 재질은 채움률(%), 덮어쓴 질량은 값과 무게중심 칸, 계산이 없으면 안내', () => {
    const objects = scene()
    const battery: SceneObject = {
      ...objects.battery,
      mass: { material: 'pla', infill: 0.25, mass: 0.597, centerOfMass: [0.01, 0, 0] }
    }
    const html = render({ ...objects, battery }, () => <MassCard object={battery} />)
    expect(html).toContain('<option value="pla" selected="">PLA</option>')
    expect(html).toContain('채움률 (%)')
    expect(html).toContain('value="25"')
    expect(html).toContain(`value="${massText(t, 0.597, 'mm')}"`)
    expect(html).toContain('무게중심')
    expect(html).toMatch(/<input type="checkbox"\/>자동/)
    expect(html).toContain('value="10.0"')
    expect(html).toContain('아직 계산한 질량이 없습니다.')
  })

  it('하위 파트가 정한 데이터시트 질량은 그룹 카드에 무게중심 칸이 없고, 정해 둔 것은 쓰이지 않는다고 알린다', () => {
    const objects = scene()
    const motor = objectMass({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
    fake.model = { objects: { lift: motor, bolt: motor }, robots: {} }
    const lift: SceneObject = { ...objects.lift, mass: {} }
    const html = render({ ...objects, lift }, () => <MassCard object={lift} />)
    expect(html).not.toContain('자동')
    const set: SceneObject = { ...objects.lift, mass: { centerOfMass: [0.5, 0, 0] } }
    const unused = render({ ...objects, lift: set }, () => <MassCard object={set} />)
    expect(unused).toMatch(/<input type="checkbox"\/>자동/)
    expect(unused).toContain('이 무게중심은 지금 쓰이지 않습니다.')
  })

  it('Add Component에 "시뮬레이션 › 질량", 로봇·이미 있는 오브젝트는 비활성, 카드가 없으면 추정 한 줄', () => {
    const objects = scene()
    fake.model = {
      objects: {
        plate: objectMass({ source: 'default', detail: 'aluminum6061', inheritedFrom: 'R' }),
        lift: objectMass({})
      },
      robots: {}
    }
    const option = (html: string): string => html.match(/<option value="#mass"[^>]*>/)![0]
    const plate = render(objects, () => <HardwareComponentsSection object={objects.plate} />)
    expect(plate).toMatch(/<optgroup label="시뮬레이션">.*<option value="#mass">질량<\/option>/)
    expect(plate).toContain(
      `질량(추정) ${massText(t, 0.437, 'mm')} · 로봇 기본 재질: 알루미늄 6061</button>`
    )
    expect(plate).toContain('컴포넌트가 없습니다')
    // 로봇에는 질량 카드가 없다(Rigidbody 카드), 추정 한 줄도 없다
    const robot = render(objects, () => <HardwareComponentsSection object={objects.R} />)
    expect(option(robot)).toContain('disabled')
    expect(robot).not.toContain('mass-estimate')
    // 카드가 있으면 비활성이고 한 줄 대신 카드, "컴포넌트 없음"도 아니다
    const lift = render(objects, () => <HardwareComponentsSection object={objects.lift} />)
    expect(option(lift)).toContain('disabled')
    expect(lift).toContain('data-component-type="mass"')
    expect(lift).not.toContain('mass-estimate')
    expect(lift).not.toContain('컴포넌트가 없습니다')
    // 계산 결과가 없으면(형상 없음 등) 한 줄도 없다
    const box = render(objects, () => <HardwareComponentsSection object={objects.box} />)
    expect(box).not.toContain('mass-estimate')
  })

  it('Rigidbody 카드: 질량과 출처별 합계, 저울 맞춤 비율, 기본 재질, 무게중심·주관성, 경고', () => {
    const objects = scene()
    const R: SceneObject = { ...objects.R, rigidbody: { weighedMass: 14, defaultMaterial: 'pla' } }
    fake.model = {
      objects: {},
      robots: {
        R: robotMass({
          scale: 1.25,
          warnings: [
            { kind: 'scaleUnusual', scale: 1.7 },
            { kind: 'pending', meshes: 2 }
          ]
        })
      }
    }
    const html = render({ ...objects, R }, () => <RigidbodyCard robot={R} />)
    expect(html).toContain('Rigidbody')
    expect(html).toContain(massText(t, 12.3, 'mm'))
    expect(html).toContain(
      `직접 입력·데이터시트 ${massText(t, 2.1, 'mm')} + 추정 ${massText(t, 10.2, 'mm')}`
    )
    expect(html).toContain('추정에 ×1.250 (저울 무게에 맞춤)')
    expect(html).toContain(`value="${massText(t, 14, 'mm')}"`)
    expect(html).toContain('<option value="pla" selected="">PLA</option>')
    expect(html).toContain('<option value="">알루미늄 6061 (기본)</option>')
    expect(html).toContain('<output>-20.0</output>')
    expect(html).toContain('kg·m²')
    expect(html).toContain('<output>0.500</output>')
    expect(html).toContain('1.70배')
    expect(html).toContain('형상을 읽는 중인 메시 2개')
    expect(html).toContain('빈 그룹을 만들고(Create Empty)')
  })

  it('CAD를 읽는 중이면 추정 한 줄·질량 카드가 "형상 없음" 대신 읽는 중이라고 한다', () => {
    const objects = scene()
    fake.model = {
      objects: { plate: objectMass({ mass: 0, source: 'none', detail: '' }) },
      robots: {}
    }
    const end = beginCadLoad('cad')
    try {
      const line = render(objects, () => <HardwareComponentsSection object={objects.plate} />)
      expect(line).toContain('질량(추정) — · 형상을 읽는 중</button>')
      const plate: SceneObject = { ...objects.plate, mass: {} }
      const card = render({ ...objects, plate }, () => <MassCard object={plate} />)
      expect(card).toContain('결과: — · 형상을 읽는 중')
      expect(card).not.toContain('형상 없음 또는 표면 메시')
    } finally {
      end()
    }
    const done = render({ ...objects }, () => <HardwareComponentsSection object={objects.plate} />)
    expect(done).toContain('질량 없음 (형상 없음 또는 표면 메시)')
  })

  it('쓰지 못한 설정 알림: Rigidbody 카드에 모두, 질량 카드·추정 한 줄에는 그 오브젝트의 것', () => {
    const objects = scene()
    const notices: MassNotice[] = [
      { kind: 'podIgnored', objectId: 'plate', pinpointId: 'bolt', reason: 'containsCots' },
      { kind: 'innerMassExceeds', objectId: 'battery', mass: 0.597, inner: 0.7 }
    ]
    fake.model = {
      objects: { plate: objectMass({}), battery: objectMass({ mass: 0.7 }) },
      robots: { R: robotMass({ notices }) }
    }
    const rigidbody = render(objects, () => <RigidbodyCard robot={objects.R} />)
    expect(rigidbody).toContain('aria-label="쓰지 못한 질량 설정"')
    expect(rigidbody).toContain('Plate을(를) Bolt의 Pinpoint 포드로 볼 수 없어')
    expect(rigidbody).toContain('Battery 안의 질량 직접 입력 합')
    const battery = render(objects, () => <MassCard object={objects.battery} />)
    expect(battery).toContain('Battery 안의 질량 직접 입력 합')
    expect(battery).not.toContain('Pinpoint 포드')
    // 카드가 없는 파트는 추정 한 줄 아래에 보인다
    const plate = render(objects, () => <HardwareComponentsSection object={objects.plate} />)
    expect(plate).toContain('mass-estimate')
    expect(plate).toContain('Plate을(를) Bolt의 Pinpoint 포드로 볼 수 없어')
    expect(plate).not.toContain('Battery 안의')
  })

  it('Rigidbody 카드: 계산이 없거나 기본값이면 그것을 알리고 저울 무게 칸은 비어 있다', () => {
    const objects = scene()
    const empty = render(objects, () => <RigidbodyCard robot={objects.R} />)
    expect(empty).toContain('—')
    expect(empty).toContain('placeholder="비우면 추정 그대로"')
    expect(empty).toContain('<option value="" selected="">알루미늄 6061 (기본)</option>')
    expect(empty).not.toContain('주관성')
    fake.model = {
      objects: {},
      robots: { R: robotMass({ warnings: [{ kind: 'defaultMass' }] }) }
    }
    const fallback = render(scene(), () => <RigidbodyCard robot={objects.R} />)
    expect(fallback).toContain(`질량 정보가 없어 기본값 ${massText(t, 13.6, 'mm')}(FTC`)
    expect(fallback).toContain('기본값 (질량 정보 없음)')
    expect(fallback).not.toContain('+ 추정')
    // 형상 없는 로봇에 저울 무게를 넣으면 그 무게를 쓴다고 알린다(질량 모델은 defaultMass 경고를 그대로 낸다)
    const R: SceneObject = { ...objects.R, rigidbody: { weighedMass: 20 } }
    fake.model = {
      objects: {},
      robots: {
        R: robotMass({
          mass: 20,
          fixedMass: 0,
          estimatedMass: 20,
          warnings: [{ kind: 'defaultMass' }]
        })
      }
    }
    const weighed = render({ ...scene(), R }, () => <RigidbodyCard robot={R} />)
    expect(weighed).toContain(massText(t, 20, 'mm'))
    expect(weighed).toContain('저울 무게 (형상 없음, 외곽 상자로 근사)')
    expect(weighed).toContain(`저울 무게 ${massText(t, 20, 'mm')}를 로봇 외곽 상자에`)
    expect(weighed).not.toContain(massText(t, 13.6, 'mm'))
  })
})
