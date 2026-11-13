import { readFileSync } from 'node:fs'
import i18n from 'i18next'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import ko from '../../i18n/locales/ko'
import { newRun, usePlayStore } from '../../play/playStore'
import { jointBodyFrames } from '../../play/worldJoints'
import type { ColliderSettings } from '../../scene/collider'
import { disposeAllGeometry } from '../../scene/geometryRegistry'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import HardwareComponentsSection from '../hardware/HardwareComponentsSection'
import OptionalField from '../mass/OptionalField'
import ColliderCard from './ColliderCard'
import {
  canAddCollider,
  colliderFitBounds,
  colliderLengthParser,
  newCollider,
  robotUpAxis
} from './colliderCardModel'
import {
  colliderScene,
  registerBox,
  registerSceneMeshes,
  resetCollisionModels
} from './colliderTestkit'

// Add Component의 Collider 항목과 Collider 카드(spec-5 §6.1·6.2, B11·B12). DOM이 없어 요소 나무를 함수로 불러 처리기를
// 직접 부르고(fieldCad.test.tsx와 같은 방법), 글자는 renderToStaticMarkup으로 본다.

// 단위 스토어는 불러올 때 localStorage를 읽는다(Node 테스트에는 없다)
vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다(sensorCard.test.tsx와 같은 방법)
type TestStore<T> = { getInitialState: () => T; setState: (patch: Partial<T>) => void }
const restores: (() => void)[] = []
function setStore<T extends object>(store: TestStore<T>, patch: Partial<T>): void {
  const initial = store.getInitialState()
  const saved = { ...initial }
  restores.push(() => Object.assign(initial, saved))
  Object.assign(initial, patch)
  store.setState(patch)
}

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
  setStore(usePlayStore, { run: null })
  scene(colliderScene())
})

afterEach(() => {
  while (restores.length > 0) restores.pop()!()
  disposeAllGeometry()
})

function scene(objects: SceneObjects): void {
  setStore(useSceneStore, {
    objects,
    geometryRevision: useSceneStore.getState().geometryRevision + 1
  })
}
const objectsNow = (): SceneObjects => useSceneStore.getState().objects
const withColliders = (id: string, colliders: ColliderSettings[]): void =>
  scene({ ...objectsNow(), [id]: { ...objectsNow()[id], colliders } })

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

const cardTree = (id: string, index = 0): Element[] => {
  const object = objectsNow()[id]
  return capture(() => ColliderCard({ object, collider: object.colliders![index] }))
}
const cardHtml = (id: string, index = 0): string => {
  const object = objectsNow()[id]
  return renderToStaticMarkup(<ColliderCard object={object} collider={object.colliders![index]} />)
}
const byData = (list: Element[], name: string): Element | undefined =>
  list.find((element) => element.props['data-collider'] === name)
const byLabel = (list: Element[], label: string): Element | undefined =>
  list.find((element) => element.props.ariaLabel === label || element.props.label === label)

// 스토어 변경 수(실행 취소 단계 = 문서 변경 한 번)
function countChanges(): () => number {
  let count = 0
  const stop = useSceneStore.subscribe((state, previous) => {
    if (state.objects !== previous.objects) count++
  })
  restores.push(stop)
  return () => count
}

const BOX: ColliderSettings = { id: 'b', kind: 'box', center: [0, 0, 0], size: [0.1, 0.1, 0.1] }

describe('B11 Add Component', () => {
  const section = (id: string): Element[] =>
    capture(() => HardwareComponentsSection({ object: objectsNow()[id] }))
  const select = (list: Element[]): Element =>
    list.find((element) => element.props['aria-label'] === t('hardware.add'))!

  it('B11 네 항목(6a Cylinder 포함)이 시뮬레이션 묶음의 질량 뒤에 있고, 8개면 비활성이다', () => {
    const list = section('base')
    const group = list.find((element) => element.props.label === t('hardware.wheel.addGroup'))!
    const values = elements(group.props.children as ReactNode)
      .filter((element) => element.type === 'option')
      .map((element) => element.props.value)
    expect(values).toEqual([
      '#wheel',
      '#joint',
      '#mass',
      '#boxCollider',
      '#capsuleCollider',
      '#meshCollider',
      '#cylinderCollider'
    ])
    // Cylinder는 Unity에 없는 임시 편차라 항목 도움말이 알린다
    const cylinder = elements(group.props.children as ReactNode).find(
      (element) => element.props.value === '#cylinderCollider'
    )!
    expect(cylinder.props.title).toBe(t('collider.cylinderHint'))
    expect(elements(cylinder.props.children as ReactNode).length).toBe(0)
    expect(cylinder.props.children).toBe(t('collider.addOptions.cylinder'))
    withColliders(
      'base',
      Array.from({ length: 8 }, (_, i) => ({ ...BOX, id: `c${i}` }))
    )
    expect(canAddCollider(objectsNow().base)).toBe(false)
    const full = elements(
      section('base').find((element) => element.props.label === t('hardware.wheel.addGroup'))!.props
        .children as ReactNode
    ).filter((element) => String(element.props.value).endsWith('Collider'))
    expect(full.every((option) => option.props.disabled === true)).toBe(true)
    expect(full[0].props.title).toBe(t('collider.tooMany', { max: 8 }))
  })

  it('B11 고르면 한 단계로 붙고, Box 기본은 하위 boundingBox 경계(없으면 0.1 m 정육면체)다', () => {
    const changes = countChanges()
    const pick = (id: string, value: string): void =>
      (select(section(id)).props.onChange as (event: unknown) => void)({
        target: { value },
        currentTarget: { blur: () => {}, getBoundingClientRect: () => ({}) }
      })
    pick('base', '#boxCollider')
    expect(changes()).toBe(1)
    const added = objectsNow().base.colliders!
    expect(added).toHaveLength(1)
    // 형상 boundingBox(Float32 꼭짓점)
    expect(added[0].kind).toBe('box')
    expect(added[0].kind === 'box' && added[0].size.map((v) => +v.toFixed(6))).toEqual([
      0.4, 0.4, 0.1
    ])
    expect(added[0].kind === 'box' && added[0].center.map((v) => Math.abs(v) < 1e-12)).toEqual([
      true,
      true,
      true
    ])
    // 형상 없는 그룹(하위도 없음): 0.1 m 정육면체
    pick('loose', '#boxCollider')
    expect(objectsNow().loose.colliders![0]).toMatchObject({
      center: [0, 0, 0],
      size: [0.1, 0.1, 0.1]
    })
    pick('base', '#meshCollider')
    expect(objectsNow().base.colliders![1]).toMatchObject({ kind: 'mesh', vertexLimit: 32 })
    expect(changes()).toBe(3)
  })

  it('B11 하위 경계는 같은 몸체 메시만(안쪽 관절 하위는 빼고), 읽는 중 메시는 세고 뺀다', () => {
    const objects = objectsNow()
    const joints = jointBodyFrames(objects, 'R')
    // 리프트 그룹: 판(z 0.05 ± 0.005, 0.1 × 0.2)
    const lift = colliderFitBounds(objects, 'lift', joints)
    expect(lift.pending).toBe(0)
    expect(lift.bounds!.min.map((v) => +v.toFixed(6))).toEqual([-0.05, -0.1, 0.045])
    expect(lift.bounds!.max.map((v) => +v.toFixed(6))).toEqual([0.05, 0.1, 0.055])
    // mech(섀시 몸체)의 하위 메시는 모두 팔 관절 몸체라 경계가 없다
    expect(colliderFitBounds(objects, 'mech', joints).bounds).toBeNull()
    disposeAllGeometry()
    registerBox('g:base', [0.4, 0.4, 0.1])
    const robot = colliderFitBounds(objects, 'R', joints)
    // 섀시 몸체의 part(읽는 중)는 빼고 센다. 판·관은 관절 몸체라 세지 않는다
    expect(robot.pending).toBe(1)
    expect(robot.bounds!.max[2]).toBeCloseTo(0.1, 7)
  })

  it('B11 Capsule 기본: 가장 긴 축, 경계가 없으면 로봇 위와 가장 나란한 로컬 축', () => {
    const objects = objectsNow()
    const joints = jointBodyFrames(objects, 'R')
    // part는 Y-up CAD 정렬(Rx 90°·Rz 90°) 아래, 크기 0.1 × 0.2 × 0.3 → 가장 긴 축 z(로컬)
    const capsule = newCollider(objects, 'part', 'capsule', joints, () => 'c')
    expect(capsule).toMatchObject({ kind: 'capsule', direction: 'z' })
    if (capsule.kind !== 'capsule') throw new Error('capsule')
    expect(capsule.height).toBeCloseTo(0.3, 7)
    expect(capsule.radius).toBeCloseTo(0.1, 7)
    // 경계 없는 오브젝트: 로컬 y가 로봇 +Z(Rx 90°)
    const tilted = {
      ...objects,
      loose2: { ...objects.mech, id: 'loose2', name: 'G', parentId: 'R' }
    }
    tilted.loose2 = {
      ...tilted.loose2,
      transform: { position: [0, 0, 0], rotation: [Math.PI / 2, 0, 0] }
    }
    expect(robotUpAxis(tilted, 'loose2')).toBe('y')
    const fallback = newCollider(
      tilted,
      'loose2',
      'capsule',
      jointBodyFrames(tilted, 'R'),
      () => 'c'
    )
    expect(fallback).toMatchObject({ direction: 'y', radius: 0.05, height: 0.2, center: [0, 0, 0] })
    // CAD 파트의 위 축(Y-up CAD면 로컬 Y가 로봇 위)
    expect(robotUpAxis(objects, 'part')).toBe('y')
  })

  it('6a Cylinder 기본: 나머지 두 길이가 가장 비슷한 축이 Direction, 높이 = 그 축 길이, 반지름 = 나머지 큰 쪽 절반', () => {
    const objects = objectsNow()
    const joints = jointBodyFrames(objects, 'R')
    // 리프트 판 0.1 × 0.2 × 0.01: y축(나머지 0.1·0.01이 가장 비슷)
    const plate = newCollider(objects, 'lift', 'cylinder', joints, () => 'c')
    expect(plate).toMatchObject({ id: 'c', kind: 'cylinder', direction: 'y' })
    if (plate.kind !== 'cylinder') throw new Error('cylinder')
    expect(plate.height).toBeCloseTo(0.2, 7)
    expect(plate.radius).toBeCloseTo(0.05, 7)
    // 경계 없는 그룹: 반지름 0.05, 높이 0.1, 로봇 위 축
    expect(newCollider(objects, 'loose', 'cylinder', joints, () => 'c')).toMatchObject({
      center: [0, 0, 0],
      radius: 0.05,
      height: 0.1,
      direction: 'z'
    })
  })

  it('B11 관절의 부모 그룹에 붙이면 하위 메시가 다른 몸체라는 경고', () => {
    withColliders('mech', [BOX])
    expect(cardHtml('mech')).toContain(t('collider.meshesInOtherBody', { name: 'Arm' }))
    withColliders('lift', [BOX])
    expect(cardHtml('lift')).not.toContain(ko.collider.meshesInOtherBody.slice(0, 6))
  })
})

describe('B12 Collider 카드', () => {
  it('B12 칸 순서는 마찰 → 중심 → 크기 → [하위에 맞추기](Unity Material 자리), 확정마다 한 단계', () => {
    withColliders('plate', [BOX])
    const list = cardTree('plate')
    const order = [
      list.findIndex((e) => e.type === OptionalField),
      list.findIndex((e) => e.props.label === t('collider.center')),
      list.findIndex((e) => e.props.label === t('collider.size')),
      list.findIndex((e) => e.props['data-collider'] === 'fit')
    ]
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const changes = countChanges()
    const center = byLabel(list, t('collider.center'))!
    ;(center.props.onCommit as (axis: number, meters: number) => void)(1, 0.02)
    expect(objectsNow().plate.colliders![0]).toMatchObject({ center: [0, 0.02, 0] })
    const friction = cardTree('plate').find((e) => e.type === OptionalField)!
    ;(friction.props.onCommit as (value: number | null) => void)(0.9)
    expect(objectsNow().plate.colliders![0].friction).toBe(0.9)
    ;(
      cardTree('plate').find((e) => e.type === OptionalField)!.props.onCommit as (
        value: number | null
      ) => void
    )(null)
    expect('friction' in objectsNow().plate.colliders![0]).toBe(false)
    expect(changes()).toBe(3)
    // 크기 칸은 1 mm 아래를 받지 않고 틀렸다고 보인다(지우지 않음)
    expect(byLabel(cardTree('plate'), t('collider.size'))!.props.invalidTitle).toBe(
      t('collider.invalid.size')
    )
  })

  it('B12 길이 칸은 단위를 붙인 입력을 받고(12in) 범위 밖은 받지 않는다', () => {
    const parse = colliderLengthParser('mm', 1e-3, 10)
    expect(parse('12in')).toBeCloseTo(304.8, 9)
    expect(parse('30cm')).toBeCloseTo(300, 9)
    expect(parse('0.5')).toBeNull()
    expect(parse('11m')).toBeNull()
    expect(parse('abc')).toBeNull()
  })

  it('B12 머리줄 확인란은 한 단계로 끄고 켜며, 끈 카드는 흐리다', () => {
    withColliders('plate', [BOX])
    const changes = countChanges()
    ;(byData(cardTree('plate'), 'enabled')!.props.onChange as (event: unknown) => void)({
      target: { checked: false }
    })
    expect(objectsNow().plate.colliders![0].enabled).toBe(false)
    expect(cardHtml('plate')).toContain('hw-card is-disabled')
    ;(byData(cardTree('plate'), 'enabled')!.props.onChange as (event: unknown) => void)({
      target: { checked: true }
    })
    expect('enabled' in objectsNow().plate.colliders![0]).toBe(false)
    expect(changes()).toBe(2)
    ;(byData(cardTree('plate'), 'remove')!.props.onClick as () => void)()
    expect('colliders' in objectsNow().plate).toBe(false)
  })

  it('B12 [하위에 맞추기]는 경계 상자로 다시 맞추고(한 단계), 읽는 중 메시 수를 도움말에, 없으면 비활성', () => {
    withColliders('lift', [{ ...BOX, enabled: false, friction: 0.7 }])
    const fit = byData(cardTree('lift'), 'fit')!
    expect(fit.props.disabled).toBe(false)
    ;(fit.props.onClick as () => void)()
    const fitted = objectsNow().lift.colliders![0]
    expect(fitted).toMatchObject({ id: 'b', enabled: false, friction: 0.7 })
    expect(fitted.kind === 'box' && fitted.size.map((v) => +v.toFixed(6))).toEqual([0.1, 0.2, 0.01])
    // 읽는 중인 메시가 섞인 하위
    disposeAllGeometry()
    registerBox('g:base', [0.4, 0.4, 0.1])
    withColliders('R', [BOX])
    expect(byData(cardTree('R'), 'fit')!.props.title).toContain(
      t('collider.fitChildrenPending', { count: 1 })
    )
    withColliders('loose', [BOX])
    const none = byData(cardTree('loose'), 'fit')!
    expect(none.props.disabled).toBe(true)
    expect(none.props.title).toBe(t('collider.fitChildrenNone'))
  })

  it('B12 Mesh Collider 결과 줄과 오차 경고(Mesh만), 읽는 중·없음', () => {
    withColliders('plate', [{ id: 'm', kind: 'mesh', vertexLimit: 32 }])
    const html = cardHtml('plate')
    expect(html).toMatch(/볼록 껍질 8점 · 오차 약 [\d.]+ mm/)
    expect(html).not.toContain(ko.collider.hullErrorLarge.slice(0, 8))
    // 메시 껍질 오차 3 mm > 2 mm
    registerBox('g:plate', [0.1, 0.2, 0.01], 0.003)
    withColliders('plate', [{ id: 'm', kind: 'mesh', vertexLimit: 32 }])
    expect(cardHtml('plate')).toContain(t('collider.hullErrorLarge', { error: '3.0 mm' }))
    // 상자 카드는 결과 줄이 없다
    withColliders('plate', [BOX])
    expect(cardHtml('plate')).not.toMatch(/볼록 껍질 \d+점/)
    disposeAllGeometry()
    withColliders('plate', [{ id: 'm', kind: 'mesh', vertexLimit: 32 }])
    expect(cardHtml('plate')).toContain(t('collider.hullPending'))
    withColliders('loose', [{ id: 'm', kind: 'mesh', vertexLimit: 32 }])
    expect(cardHtml('loose')).toContain(t('collider.orphan'))
  })

  it('B12 몸체 틀에서 좌표 한도를 넘는 Collider는 경고 줄(시뮬레이터에 넣지 않음)', () => {
    // 판(리프트 몸체 z 0.05)의 중심 z 10 m 상자는 몸체 틀에서 10.05 m
    withColliders('plate', [{ ...BOX, center: [0, 0, 10] }])
    expect(cardHtml('plate')).toContain(t('collider.outOfRange'))
    withColliders('plate', [BOX])
    expect(cardHtml('plate')).not.toContain(t('collider.outOfRange'))
  })

  it('B12 축 줄(Y-up CAD 파트), 소속 줄(섀시·관절·밖), 자동 껍질 대체 안내', () => {
    withColliders('part', [BOX])
    const part = cardHtml('part')
    expect(part).toContain(t('collider.cadAxes', { up: '+Y', forward: '+Z' }))
    expect(part).toContain(t('collider.bodyOfChassis'))
    expect(part).toContain(t('collider.replacesAuto', { body: 'Robot' }))
    withColliders('plate', [BOX, { ...BOX, id: 'b2' }])
    const plate = cardHtml('plate')
    expect(plate).toContain(t('collider.bodyOf', { name: 'Lift' }))
    // Collider가 둘이면 대체 안내가 없다
    expect(plate).not.toContain(ko.collider.replacesAuto.slice(-12))
    // 그룹은 축 줄이 없다
    withColliders('mech', [BOX])
    expect(cardHtml('mech')).not.toContain('CAD 파일 축')
    withColliders('loose', [BOX])
    expect(cardHtml('loose')).toContain(t('collider.orphan'))
  })

  it('5 리뷰: 크기 칸 도움말은 중심 도움말이 아니라 자기 축 방향 전체 크기다', () => {
    withColliders('plate', [BOX])
    const list = cardTree('plate')
    expect(byLabel(list, t('collider.size'))!.props.title).toBe(t('collider.sizeHint'))
    expect(byLabel(list, t('collider.center'))!.props.title).toBe(t('collider.centerHint'))
    expect(t('collider.sizeHint')).not.toBe(t('collider.centerHint'))
  })

  it('5 리뷰: 몸체 한도로 시뮬레이터가 쓰지 않는 켠 Collider는 카드가 알린다(씬 뷰의 흐린 색과 같은 까닭)', () => {
    // 섀시에 6개씩 셋 = 18 > 16: 마지막 오브젝트의 뒤 둘이 빠진다
    const many = (prefix: string): ColliderSettings[] =>
      Array.from({ length: 6 }, (_, k) => ({ ...BOX, id: `${prefix}${k}` }))
    scene({
      ...objectsNow(),
      g0: { ...objectsNow().mech, id: 'g0', parentId: 'R', colliders: many('a') },
      g1: { ...objectsNow().mech, id: 'g1', parentId: 'R', colliders: many('b') },
      g2: { ...objectsNow().mech, id: 'g2', parentId: 'R', colliders: many('c') }
    })
    const capped = t('collider.capped', { body: 16, world: 64 })
    expect(cardHtml('g2', 5)).toContain(capped)
    expect(cardHtml('g2', 3)).not.toContain(capped)
    expect(cardHtml('g0', 0)).not.toContain(capped)
  })

  it('5 리뷰: 머리줄 "시뮬레이터" 배지는 줄어든 줄(.hw-inline) 안에서 잘리지 않는다(main.css)', () => {
    withColliders('plate', [BOX])
    expect(cardHtml('plate')).toMatch(
      /<span class="hw-inline">(?:(?!<\/span><\/header>).)*<span class="inspector-file">시뮬레이터<\/span>/
    )
    // .inspector-file의 max-width 60%는 줄어든 부모 폭 기준이라 "시뮬레..."로 잘렸다
    const css = readFileSync(new URL('../../assets/main.css', import.meta.url), 'utf8')
    const rule = /\n\.hw-inline > \.inspector-file\s*\{([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(rule![1]).toMatch(/max-width:\s*none/)
    expect(rule![1]).toMatch(/flex:\s*none/)
  })

  it('B12 실행이 그 로봇을 잠그면 "실행 중" 배지(편집은 막지 않음)', () => {
    withColliders('plate', [BOX])
    expect(cardHtml('plate')).not.toContain('frame-badge is-running')
    const op: OpModeInfo = {
      className: 'a.B',
      path: 'src/main/java/a/B.java',
      line: 1,
      flavor: 'TeleOp',
      name: 'B',
      group: '',
      preselectTeleOp: ''
    }
    const run = newRun({
      runId: 'r',
      root: '/p',
      opMode: op,
      robotId: 'R',
      configPath: null,
      speed: 1,
      paused: false
    })
    setStore(usePlayStore, { run: { ...run, phase: 'running' } })
    const html = cardHtml('plate')
    expect(html).toContain('frame-badge is-running')
    expect(html).toContain(`title="${t('collider.runningHint')}"`)
    // 칸은 그대로 편집된다
    expect(byLabel(cardTree('plate'), t('collider.center'))!.props.onCommit).toBeTypeOf('function')
  })
})

describe('6a Cylinder Collider 카드', () => {
  const CYLINDER: ColliderSettings = {
    id: 'y',
    kind: 'cylinder',
    center: [0, 0, 0],
    radius: 0.03,
    height: 0.08,
    direction: 'x'
  }

  it('제목은 번역하지 않고, 반지름·높이·방향 칸과 Unity 편차 안내가 있다', () => {
    withColliders('plate', [CYLINDER])
    const html = cardHtml('plate')
    expect(html).toContain('Cylinder Collider')
    expect(html).toContain(t('collider.cylinderHint'))
    const list = cardTree('plate')
    expect(byLabel(list, t('collider.radius'))).toBeDefined()
    const height = byLabel(list, t('collider.height'))!
    expect(height.props.title).toBe(t('collider.cylinderHeightHint'))
    // 높이 칸은 1 mm 아래를 받지 않는다(캡슐은 0이면 구라 받는다)
    const parse = height.props.parse as (text: string) => number | null
    expect(parse('0.5')).toBeNull()
    expect(parse('1')).toBe(1)
    expect(byData(list, 'direction')!.props.value).toBe('x')
    expect(byData(list, 'cylinderHint')).toBeDefined()
    withColliders('plate', [{ ...CYLINDER, kind: 'capsule' }])
    expect(
      (byLabel(cardTree('plate'), t('collider.height'))!.props.parse as (t: string) => unknown)('0')
    ).toBe(0)
    expect(cardHtml('plate')).not.toContain(t('collider.cylinderHint'))
  })

  it('칸을 확정하면 한 단계로 바뀌고 [하위에 맞추기]는 원기둥 규칙으로 맞춘다(id·켬·마찰은 그대로)', () => {
    withColliders('lift', [{ ...CYLINDER, enabled: false, friction: 0.9 }])
    const changes = countChanges()
    ;(byLabel(cardTree('lift'), t('collider.radius'))!.props.onCommit as (v: number) => void)(40)
    expect(objectsNow().lift.colliders![0]).toMatchObject({ radius: 0.04 })
    ;(byData(cardTree('lift'), 'direction')!.props.onChange as (event: unknown) => void)({
      target: { value: 'z' }
    })
    expect(objectsNow().lift.colliders![0]).toMatchObject({ direction: 'z' })
    ;(byData(cardTree('lift'), 'fit')!.props.onClick as () => void)()
    const fitted = objectsNow().lift.colliders![0]
    expect(fitted).toMatchObject({
      id: 'y',
      kind: 'cylinder',
      enabled: false,
      friction: 0.9,
      direction: 'y'
    })
    if (fitted.kind !== 'cylinder') throw new Error('cylinder')
    expect(fitted.height).toBeCloseTo(0.2, 7)
    expect(fitted.radius).toBeCloseTo(0.05, 7)
    expect(changes()).toBe(3)
  })
})
