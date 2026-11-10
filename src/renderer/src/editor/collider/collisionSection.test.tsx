import i18n from 'i18next'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { editPoseOverlaps } from '../../../../shared/sim/collision3d'
import type { OpModeInfo } from '../../../../shared/play'
import ko from '../../i18n/locales/ko'
import { newRun, usePlayStore } from '../../play/playStore'
import type { ColliderSettings } from '../../scene/collider'
import { disposeAllGeometry } from '../../scene/geometryRegistry'
import { defaultWheel } from '../../scene/wheel'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { useEditorStore } from '../editorStore'
import CollisionSection from './CollisionSection'
import {
  colliderScene,
  registerSceneMeshes,
  resetCollisionModels,
  sceneObject
} from './colliderTestkit'

// Rigidbody·Articulation Body 카드의 충돌 구역(spec-5 §6.3, B13). 앞 계산은 시험 이중(리프트 ↔ 팔이 2 mm 겹침, 둘 다 섀시의
// 자식이라 인접이 아니다)이다.

vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})
vi.mock('../../../../shared/sim/collision3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/sim/collision3d')>()
  return { ...actual, editPoseOverlaps: vi.fn(actual.editPoseOverlaps) }
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
  setStore(useEditorStore, { selectedId: null, selectedIds: [] })
  scene(colliderScene())
  vi.mocked(editPoseOverlaps).mockImplementation((bodies) => {
    // 몸체 둘이 리프트(관절 0)와 팔(관절 1)이면 2 mm 겹침
    const ids = bodies.map((body) => body.body)
    return ids.includes(0) && ids.includes(1) ? [{ a: 0, b: 1, depth: 0.002 }] : []
  })
})

afterEach(() => {
  while (restores.length > 0) restores.pop()!()
  disposeAllGeometry()
  vi.mocked(editPoseOverlaps).mockReset()
})

function scene(objects: SceneObjects): void {
  setStore(useSceneStore, {
    objects,
    geometryRevision: useSceneStore.getState().geometryRevision + 1
  })
}
const objectsNow = (): SceneObjects => useSceneStore.getState().objects
// 처리기가 바꾼 스토어 상태를 서버 스냅숏(그리기가 읽는 처음 상태)에도 옮긴다
const sync = (): void => {
  Object.assign(useSceneStore.getInitialState(), { objects: objectsNow() })
}
const t = (key: string, params?: Record<string, unknown>): string =>
  (i18n.t as unknown as (key: string, params?: Record<string, unknown>) => string)(key, params)
const html = (bodyObjectId: string): string =>
  renderToStaticMarkup(<CollisionSection robotId="R" bodyObjectId={bodyObjectId} />)

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function tree(bodyObjectId: string): Element[] {
  let captured: ReactNode = null
  function Capture(): null {
    captured = CollisionSection({ robotId: 'R', bodyObjectId })
    return null
  }
  renderToStaticMarkup(<Capture />)
  return elements(captured)
}

const OFF: ColliderSettings = {
  id: 'off',
  kind: 'box',
  enabled: false,
  center: [0, 0, 0],
  size: [0.1, 0.1, 0.1]
}

describe('B13 몸체 충돌 줄', () => {
  it('B13 섀시: 자동 껍질 줄(점·오차, 도움말), 바퀴가 없으면 고정 기저 안내, 인접 안내', () => {
    const text = html('R')
    expect(text).toMatch(/충돌 형상: 자동 볼록 껍질 \d+점 · 오차 약 [\d.]+ mm/)
    expect(text).toContain(`title="${t('collider.body.autoHint')}"`)
    expect(text).toContain(t('collider.body.fixedBase'))
    expect(text).toContain(t('collider.self.adjacentHint'))
    // 바퀴가 있으면 고정 기저 안내가 없다
    scene({
      ...objectsNow(),
      wheel: sceneObject('wheel', 'R', [0.1, 0.1, 0.05], { kind: 'group', wheel: defaultWheel() })
    })
    expect(html('R')).not.toContain(t('collider.body.fixedBase'))
  })

  it('B13 Collider·꺼짐·대체·없음 줄과 읽는 중 메시 수', () => {
    scene({
      ...objectsNow(),
      base: { ...objectsNow().base, colliders: [{ ...OFF, enabled: undefined }] }
    })
    expect(html('R')).toContain(t('collider.body.colliders', { count: 1 }))
    scene({ ...objectsNow(), base: { ...objectsNow().base, colliders: [OFF] } })
    expect(html('R')).toContain(t('collider.body.disabled'))
    // 섀시 메시를 아무것도 읽지 않았으면 대체 상자
    scene(colliderScene())
    disposeAllGeometry()
    resetCollisionModels()
    const fallback = html('R')
    expect(fallback).toContain(t('collider.body.fallback'))
    expect(fallback).toContain(t('collider.body.pending', { count: 2 }))
    // 메시 없는 관절 몸체
    scene({
      ...colliderScene(),
      empty: sceneObject('empty', 'R', [0, 0, 0.5], {
        kind: 'group',
        name: 'Empty',
        joint: {
          type: 'revolute',
          anchor: [0, 0, 0],
          axis: 'z',
          axisSign: 1,
          limits: null,
          friction: { coulomb: 0.02, viscous: 0 },
          spring: null,
          drive: { kind: 'none' }
        }
      })
    })
    expect(html('empty')).toContain(t('collider.body.none'))
  })

  it('B13 관절: 부모 몸체 안내와 바닥 닿음 줄', () => {
    const arm = html('arm')
    expect(arm).toContain(t('collider.self.adjacentParent', { name: 'Robot' }))
    expect(arm).not.toContain(t('collider.body.floorTouch'))
    // 관을 바닥에 내린다(팔 틀 z 0.2 − 0.2 = 0, 관 반 두께 0.01 → min z −0.01)
    scene({
      ...objectsNow(),
      tube: { ...objectsNow().tube, transform: { position: [0.1, 0, -0.2], rotation: [0, 0, 0] } }
    })
    expect(html('arm')).toContain(t('collider.body.floorTouch'))
  })
})

describe('B13 자기 충돌 목록', () => {
  it('B13 무시 짝 줄(이름·겹침), [그래도 충돌] 확인란은 한 단계로 넣고 빼며, 줄을 누르면 상대 몸체를 고른다', () => {
    const pair = t('collider.self.pair', { a: 'Lift', b: 'Arm', depth: '2.0 mm' })
    // 섀시 구역은 모든 짝, 관절 구역은 그 몸체가 든 짝만
    expect(html('R')).toContain(pair)
    expect(html('arm')).toContain(pair)
    expect(html('lift')).toContain(pair)
    scene({
      ...objectsNow(),
      claw: sceneObject('claw', 'R', [0, 0, 0.6], {
        kind: 'group',
        name: 'Claw',
        joint: { ...objectsNow().arm.joint! },
        colliders: [{ id: 'k', kind: 'box', center: [0, 0, 0], size: [0.05, 0.05, 0.05] }]
      })
    })
    expect(html('claw')).toContain(t('collider.self.none'))
    expect(html('claw')).not.toContain(pair)
    let changes = 0
    restores.push(
      useSceneStore.subscribe((state, previous) => {
        if (state.objects !== previous.objects) changes++
      })
    )
    const checkbox = tree('R').find((element) => element.type === 'input')!
    ;(checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } })
    expect(objectsNow().R.collision).toEqual({ forceCollide: [['arm', 'lift']] })
    sync()
    expect(html('R')).toContain('checked=""')
    ;(
      tree('R').find((element) => element.type === 'input')!.props.onChange as (
        event: unknown
      ) => void
    )({ target: { checked: false } })
    expect('collision' in objectsNow().R).toBe(false)
    expect(changes).toBe(2)
    const link = (id: string): (() => void) =>
      tree(id).find((element) => element.props.className === 'hw-issue-link')!.props
        .onClick as () => void
    link('R')()
    expect(useEditorStore.getState().selectedId).toBe('arm')
    // 관절 구역에서 누르면 상대 몸체
    link('arm')()
    expect(useEditorStore.getState().selectedId).toBe('lift')
    link('lift')()
    expect(useEditorStore.getState().selectedId).toBe('arm')
  })

  it('B13 지금 겹치지 않는 [그래도 충돌] 설정은 흐린 줄과 [지우기](그 짝만, 한 단계), 끊긴 id는 세지 않는다', () => {
    scene({
      ...objectsNow(),
      R: {
        ...objectsNow().R,
        collision: {
          forceCollide: [
            ['arm', 'lift'],
            ['R', 'lift'],
            ['R', 'zz-deleted']
          ]
        }
      }
    })
    const text = html('R')
    expect(text).toContain(t('collider.self.staleForced', { count: 1 }))
    const clear = tree('R').find(
      (element) =>
        element.type === 'button' && element.props.children === t('collider.self.clearStale')
    )!
    ;(clear.props.onClick as () => void)()
    expect(objectsNow().R.collision).toEqual({
      forceCollide: [
        ['R', 'zz-deleted'],
        ['arm', 'lift']
      ]
    })
    sync()
    expect(html('R')).not.toContain(ko.collider.self.staleForced.slice(0, 10))
  })

  it('B13 실행이 그 로봇을 잠그면 구역 머리에 "실행 중" 배지', () => {
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
    expect(html('R')).not.toContain('frame-badge is-running')
    setStore(usePlayStore, { run: { ...run, phase: 'running' } })
    expect(html('R')).toContain('frame-badge is-running')
    expect(html('arm')).toContain('frame-badge is-running')
  })
})
