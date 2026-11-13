import i18n from 'i18next'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveElementType } from '../../../../shared/sim/elements/elementData'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { usePlayStore } from '../../play/playStore'
import { disposeAllGeometry } from '../../scene/geometryRegistry'
import type { SceneObjects } from '../../scene/model'
import { canAddPreload, type PreloadSettings } from '../../scene/preload'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { LengthVector } from '../collider/ColliderCard'
import {
  colliderScene,
  registerSceneMeshes,
  resetCollisionModels,
  sceneObject
} from '../collider/colliderTestkit'
import HardwareComponentsSection from '../hardware/HardwareComponentsSection'
import { PreloadSourceLine } from '../hardware/RobotHardwareSection'
import PreloadCard from './PreloadCard'
import { preloadAddBlock, preloadCardView } from './preloadCardModel'

// Preload Slot 카드·Add Component 항목·로봇 카드 출처 줄(6a, spec-6a §3). DOM이 없어 요소 나무를 함수로 불러 처리기를 직접
// 부르고(colliderCard.test.tsx와 같은 방법), 글자는 renderToStaticMarkup으로 본다.

vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

type TestStore<T> = { getInitialState: () => T; setState: (patch: Partial<T>) => void }
const restores: (() => void)[] = []
function setStore<T extends object>(store: TestStore<T>, patch: Partial<T>): void {
  const initial = store.getInitialState()
  const saved = { ...initial }
  restores.push(() => Object.assign(initial, saved))
  Object.assign(initial, patch)
  store.setState(patch)
}

const POLLEN_R = resolveElementType(resolveSeason('biobuzz'), 'pollen')!.radius

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

beforeEach(() => {
  resetCollisionModels()
  registerSceneMeshes()
  setStore(useUnitStore, { lengthUnit: 'mm' })
  setStore(usePlayStore, { run: null, settings: DEFAULT_PLAY_SETTINGS })
  scene(colliderScene())
})

afterEach(() => {
  while (restores.length > 0) restores.pop()!()
  disposeAllGeometry()
})

function scene(objects: SceneObjects, season = 'biobuzz'): void {
  setStore(useSceneStore, {
    objects,
    field: { season },
    geometryRevision: useSceneStore.getState().geometryRevision + 1
  })
}
const objectsNow = (): SceneObjects => useSceneStore.getState().objects
const withPreload = (
  objects: SceneObjects,
  id: string,
  preload: PreloadSettings
): SceneObjects => ({
  ...objects,
  [id]: { ...objects[id], preload }
})
const slot = (center: [number, number, number] = [0, 0, 0]): PreloadSettings => ({
  kind: 'pollen',
  center
})

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function capture(render: () => ReactNode): Element[] {
  let captured: ReactNode = null
  function Capture(): null {
    captured = render()
    return null
  }
  renderToStaticMarkup(<Capture />)
  return elements(captured)
}
const t = (key: string, params?: Record<string, unknown>): string =>
  (i18n.t as unknown as (key: string, params?: Record<string, unknown>) => string)(key, params)

const cardTree = (id: string): Element[] => capture(() => PreloadCard({ object: objectsNow()[id] }))
const cardHtml = (id: string): string =>
  renderToStaticMarkup(<PreloadCard object={objectsNow()[id]} />)
const byData = (list: Element[], name: string): Element | undefined =>
  list.find((element) => element.props['data-preload'] === name)

function countChanges(): () => number {
  let count = 0
  const stop = useSceneStore.subscribe((state, previous) => {
    if (state.objects !== previous.objects) count++
  })
  restores.push(stop)
  return () => count
}

// 호퍼 자리(섀시 판 base 위, 로봇 좌표 z 0.15)를 둔 씬
const hopper = (): SceneObjects => ({
  ...colliderScene(),
  hopper: sceneObject('hopper', 'R', [-0.1, 0, 0.15], {
    kind: 'group',
    name: 'Hopper',
    preload: slot()
  })
})

describe('Add Component › Preload Slot', () => {
  const section = (id: string): Element[] =>
    capture(() => HardwareComponentsSection({ object: objectsNow()[id] }))
  const option = (id: string): Element =>
    section(id).find((element) => element.props.value === '#preload')!

  it('시뮬레이션 묶음의 Collider 뒤에 있고, 로봇·CAD 루트·이미 있음·로봇 한도면 비활성과 이유', () => {
    const group = section('base').find(
      (element) => element.props.label === t('hardware.wheel.addGroup')
    )!
    const values = elements(group.props.children as ReactNode)
      .filter((element) => element.type === 'option')
      .map((element) => element.props.value)
    expect(values.at(-1)).toBe('#preload')
    expect(values.indexOf('#preload')).toBeGreaterThan(values.indexOf('#cylinderCollider'))
    expect(option('base').props.disabled).toBe(false)
    expect(option('base').props.title).toBe(t('preload.help', { max: 4 }))
    expect(option('R').props).toMatchObject({
      disabled: true,
      title: t('preload.addNotAllowed')
    })
    expect(preloadAddBlock(objectsNow(), 'cad')).toBe('notAllowed')
    scene(hopper())
    expect(option('hopper').props).toMatchObject({ disabled: true, title: t('preload.addExists') })
    // 로봇 하위 자리 넷(끈 것도 셈)이면 한도
    let objects = hopper()
    for (const id of ['plate', 'tube']) objects = withPreload(objects, id, slot())
    objects = withPreload(objects, 'base', { kind: 'pollen', enabled: false, center: [0, 0, 0] })
    scene(objects)
    expect(option('part').props).toMatchObject({
      disabled: true,
      title: t('preload.addLimit', { max: 4 })
    })
    // 로봇 밖 오브젝트는 세지 않는다(붙일 수 있고 카드가 쓰지 않는다고 알린다)
    expect(preloadAddBlock(objects, 'loose')).toBeNull()
    // 계약의 canAddPreload(scene/preload.ts)와 같은 판단이다(이유만 더 알려 준다)
    for (const scenes of [objects, hopper(), colliderScene()])
      for (const id of Object.keys(scenes))
        expect(preloadAddBlock(scenes, id) === null).toBe(canAddPreload(scenes, id))
  })

  it('고르면 기본 자리(POLLEN, 중심 0)가 한 단계로 붙고 카드가 Collider 뒤·스크립트 앞에 보인다', () => {
    const changes = countChanges()
    const select = section('lift').find(
      (element) => element.props['aria-label'] === t('hardware.add')
    )!
    ;(select.props.onChange as (event: unknown) => void)({
      target: { value: '#preload' },
      currentTarget: { blur: () => {}, getBoundingClientRect: () => ({}) }
    })
    expect(changes()).toBe(1)
    expect(objectsNow().lift.preload).toEqual({ kind: 'pollen', center: [0, 0, 0] })
    const cards = section('lift').filter((element) => element.type === PreloadCard)
    expect(cards).toHaveLength(1)
  })
})

describe('Preload Slot 카드', () => {
  it('제목은 번역하지 않고 시뮬레이터 배지, 경기 요소는 POLLEN 하나(고를 수 없음)', () => {
    scene(hopper())
    const html = cardHtml('hopper')
    expect(html).toContain('Preload Slot')
    expect(html).toContain(t('collider.simulationOnly'))
    const kind = byData(cardTree('hopper'), 'kind')!
    expect(kind.props).toMatchObject({ disabled: true, value: 'pollen' })
    expect(html).toContain('POLLEN')
  })

  it('중심 칸·확인란·[제거]가 각각 한 단계로 바꾼다', () => {
    scene(hopper())
    const changes = countChanges()
    const center = cardTree('hopper').find((element) => element.type === LengthVector)!
    ;(center.props.onCommit as (axis: number, meters: number) => void)(2, 0.02)
    expect(objectsNow().hopper.preload).toEqual({ kind: 'pollen', center: [0, 0, 0.02] })
    ;(byData(cardTree('hopper'), 'enabled')!.props.onChange as (event: unknown) => void)({
      target: { checked: false }
    })
    expect(objectsNow().hopper.preload).toEqual({
      kind: 'pollen',
      enabled: false,
      center: [0, 0, 0.02]
    })
    // renderToStaticMarkup은 스토어의 처음 상태를 읽으므로 바뀐 문서를 그 상태에도 넣는다
    scene(objectsNow())
    expect(cardHtml('hopper')).toContain('hw-card is-disabled')
    expect(cardHtml('hopper')).toContain(t('preload.excluded.disabled'))
    ;(byData(cardTree('hopper'), 'enabled')!.props.onChange as (event: unknown) => void)({
      target: { checked: true }
    })
    expect(objectsNow().hopper.preload).toEqual({ kind: 'pollen', center: [0, 0, 0.02] })
    ;(byData(cardTree('hopper'), 'remove')!.props.onClick as () => void)()
    expect('preload' in objectsNow().hopper).toBe(false)
    expect(changes()).toBe(4)
  })

  it('쓰이는 자리는 순서와 몸체(섀시·관절 이름), 섀시 껍질과 겹치면 경고', () => {
    let objects = hopper()
    objects = withPreload(objects, 'plate', slot([0, 0, 0.1]))
    // 섀시 판(0.4 × 0.4 × 0.1, z 0–0.1) 안의 자리
    objects = withPreload(objects, 'base', slot([0, 0, 0]))
    scene(objects)
    // 하이어라키 순서: base(섀시) → plate(리프트) → hopper(맨 뒤에 더한 오브젝트)
    expect(cardHtml('base')).toContain(
      `${t('preload.slot', { index: 1, max: 4 })} · ${t('preload.bodyChassis')}`
    )
    expect(cardHtml('hopper')).toContain(
      `${t('preload.slot', { index: 3, max: 4 })} · ${t('preload.bodyChassis')}`
    )
    expect(cardHtml('plate')).toContain(t('preload.bodyJoint', { name: 'Lift' }))
    expect(cardHtml('base')).toContain(t('preload.overlap', { target: 'Robot' }))
    expect(cardHtml('plate')).not.toContain(ko.preload.overlap.slice(0, 10))
  })

  it('로봇 밖·시즌에 없음·한도 뒤·바닥 아래·개인 설정 끔을 알린다', () => {
    scene(withPreload(colliderScene(), 'loose', slot()))
    expect(cardHtml('loose')).toContain(t('preload.orphan'))
    scene(hopper(), 'none')
    expect(cardHtml('hopper')).toContain(t('preload.season'))
    let objects = hopper()
    for (const id of ['plate', 'tube', 'part'])
      objects = withPreload(objects, id, slot([0, 0, 0.3]))
    objects = withPreload(objects, 'mech', slot([0, 0, POLLEN_R - 0.01]))
    scene(objects)
    // 하이어라키 순서: hopper는 맨 뒤라 한도 뒤
    expect(preloadCardView(objectsNow(), 'hopper', resolveSeason('biobuzz'), null)).toMatchObject({
      status: 'excluded',
      exclusion: 'tooMany'
    })
    expect(cardHtml('hopper')).toContain(t('preload.excluded.tooMany', { max: 4 }))
    scene({ ...colliderScene(), mech: objects.mech })
    expect(cardHtml('mech')).toContain(t('preload.excluded.belowFloor'))
    scene(hopper())
    setStore(usePlayStore, { settings: { ...DEFAULT_PLAY_SETTINGS, gameElements: false } })
    expect(cardHtml('hopper')).toContain(t('preload.off'))
  })
})

describe('로봇 카드 프리로드 출처', () => {
  const html = (): string => renderToStaticMarkup(<PreloadSourceLine robotId="R" />)

  it('Preload Slot 수, 자리가 없으면 자동 면, 경기 요소 없는 시즌', () => {
    scene(hopper())
    expect(html()).toContain(t('preload.source.slots', { count: 1 }))
    scene(
      withPreload(colliderScene(), 'base', { kind: 'pollen', enabled: false, center: [0, 0, 0] })
    )
    expect(html()).toContain(t('preload.source.slotsNone'))
    // 빈 타일에 둔 로봇: 앞 면 자동
    const open = colliderScene()
    open.R = { ...open.R, transform: { position: [-0.9, -0.9, 0], rotation: [0, 0, 0] } }
    scene(open)
    expect(html()).toContain(t('preload.source.auto', { count: 4, face: t('preload.faces.front') }))
    scene(hopper(), 'none')
    expect(html()).toContain(t('preload.source.season'))
  })
})
