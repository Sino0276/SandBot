import i18n, { type TFunction } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ko from '../../i18n/locales/ko'
import type { MassModel, ObjectMass, RobotMass } from '../../mass/types'
import type { SceneObject, SceneObjects, Transform } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { formatMass } from '../../units/units'
import HardwareComponentsSection from '../hardware/HardwareComponentsSection'
import MassCard from './MassCard'
import {
  acceptMass,
  canAddMass,
  cadSummaryRows,
  cadSummaryText,
  cleanMass,
  cleanRigidbody,
  cotsText,
  estimateLine,
  formatInertia,
  inheritedInfill,
  inheritedMaterial,
  inheritedOptionText,
  localCenterOfMass,
  massCardView,
  parseInfillPercent,
  robotMassBreakdown,
  sourceText,
  warningText,
  type MassDescribers
} from './massCardModel'
import RigidbodyCard from './RigidbodyCard'
import { massModelFor } from './useMassModel'

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

  it('채움률 칸은 출력 재질(자기·상속·로봇 기본)이거나 이미 정했을 때, 채움률도 위에서 물려받는다', () => {
    let objects = scene()
    expect(massCardView(objects, 'lift', undefined).showInfill).toBe(false)
    objects = { ...objects, lift: { ...objects.lift, mass: { material: 'petg', infill: 0.4 } } }
    expect(massCardView(objects, 'lift', undefined).showInfill).toBe(true)
    objects = { ...objects, bolt: { ...objects.bolt, mass: {} } }
    const bolt = massCardView(objects, 'bolt', undefined)
    expect(bolt.material).toBe('petg')
    expect(bolt.showInfill).toBe(true)
    expect(bolt.inheritedInfill).toBe(0.4)
    expect(inheritedInfill(objects, 'plate')).toBeUndefined()
    // 출력 재질이 아니어도 정해 둔 채움률은 지울 수 있게 보인다
    objects = { ...objects, plate: { ...objects.plate, mass: { infill: 0.2 } } }
    expect(massCardView(objects, 'plate', undefined).showInfill).toBe(true)
  })

  it('무게중심 칸은 질량을 덮어썼거나 이 오브젝트의 데이터시트 질량이거나 이미 정했을 때', () => {
    const objects = scene()
    expect(massCardView(objects, 'battery', undefined).showCenterOfMass).toBe(true)
    expect(massCardView(objects, 'lift', objectMass({})).showCenterOfMass).toBe(false)
    const cots = objectMass({ source: 'cots', detail: 'pinpoint' })
    expect(massCardView(objects, 'lift', cots).showCenterOfMass).toBe(true)
    // 위 오브젝트의 데이터시트 질량에 덮인 파트에는 쓰이지 않는다
    expect(massCardView(objects, 'lift', { ...cots, inheritedFrom: 'cad' }).showCenterOfMass).toBe(
      false
    )
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
      `질량(추정) ${formatMass(0.437, 'mm')} · 데이터시트: goBILDA 5203 19.2:1`
    )
    expect(estimateLine(t, objects, { ...mass, scaled: true }, 'in', DESCRIBERS)).toBe(
      `질량(추정) ${formatMass(0.437, 'in')} · 데이터시트: goBILDA 5203 19.2:1 (저울 무게에 맞춤)`
    )
  })

  it('재질 고르기의 빈 값: 위 오브젝트 → 이름 규칙(모델 결과) → 로봇 기본 → 기본', () => {
    let objects = scene()
    const option = (id: string, result?: ObjectMass): string =>
      inheritedOptionText(t, objects, massCardView(objects, id, result))
    expect(option('bolt')).toBe('상속: 강철 (Lift)')
    expect(option('plate')).toBe('상속: 알루미늄 6061 (로봇 기본)')
    expect(option('plate', objectMass({ source: 'nameRule', detail: 'screw' }))).toBe(
      '상속: 이름 규칙 ‘screw’'
    )
    // 위 오브젝트가 정한 재질은 이름 규칙보다 먼저다
    expect(option('bolt', objectMass({ source: 'nameRule', detail: 'screw' }))).toBe(
      '상속: 강철 (Lift)'
    )
    expect(option('box')).toBe('상속: 알루미늄 6061 (기본)')
    objects = { ...objects, R: { ...objects.R, rigidbody: { defaultMaterial: 'carbonFiber' } } }
    expect(option('plate')).toBe('상속: 탄소섬유 (로봇 기본)')
  })

  it('로봇 경고·합계·관성 형식', () => {
    expect(warningText(t, { kind: 'scaleUnusual', scale: 1.734 }, 'mm')).toContain('1.73배')
    expect(warningText(t, { kind: 'scaleImpossible', fixed: 15, weighed: 12 }, 'mm')).toContain(
      `(${formatMass(15, 'mm')})이 저울 무게(${formatMass(12, 'mm')})`
    )
    expect(warningText(t, { kind: 'defaultMass' }, 'mm')).toContain(
      `기본값 ${formatMass(13.6, 'mm')}(30 lb`
    )
    expect(warningText(t, { kind: 'pending', meshes: 3 }, 'mm')).toBe(
      '형상을 읽는 중인 메시 3개는 아직 계산에 들어가지 않았습니다.'
    )
    expect(robotMassBreakdown(t, robotMass(), 'cm')).toBe(
      `직접 입력·데이터시트 ${formatMass(2.1, 'cm')} + 추정 ${formatMass(10.2, 'cm')}`
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

describe('질량 모델 기억', () => {
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
    expect(html).toContain(`placeholder="추정 ${formatMass(0.437, 'mm')}"`)
    expect(html).toContain(`결과: ${formatMass(0.437, 'mm')} · 재질: 강철 (Lift)`)
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
    expect(html).toContain(`value="${formatMass(0.597, 'mm')}"`)
    expect(html).toContain('무게중심')
    expect(html).toMatch(/<input type="checkbox"\/>자동/)
    expect(html).toContain('value="10.0"')
    expect(html).toContain('아직 계산한 질량이 없습니다.')
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
      `질량(추정) ${formatMass(0.437, 'mm')} · 로봇 기본 재질: 알루미늄 6061</button>`
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
    expect(html).toContain(formatMass(12.3, 'mm'))
    expect(html).toContain(
      `직접 입력·데이터시트 ${formatMass(2.1, 'mm')} + 추정 ${formatMass(10.2, 'mm')}`
    )
    expect(html).toContain('추정에 ×1.250 (저울 무게에 맞춤)')
    expect(html).toContain(`value="${formatMass(14, 'mm')}"`)
    expect(html).toContain('<option value="pla" selected="">PLA</option>')
    expect(html).toContain('<option value="">알루미늄 6061 (기본)</option>')
    expect(html).toContain('<output>-20.0</output>')
    expect(html).toContain('kg·m²')
    expect(html).toContain('<output>0.500</output>')
    expect(html).toContain('1.70배')
    expect(html).toContain('형상을 읽는 중인 메시 2개')
    expect(html).toContain('빈 그룹을 만들고(Create Empty)')
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
    expect(fallback).toContain(`질량 정보가 없어 기본값 ${formatMass(13.6, 'mm')}(30 lb`)
  })
})
