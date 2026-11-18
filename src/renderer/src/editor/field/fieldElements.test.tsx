import i18n from 'i18next'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { newRun, usePlayStore } from '../../play/playStore'
import type { SceneObject, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useSceneVisibilityStore } from '../sceneVisibility'
import FieldElementsSection from './FieldElementsSection'
import FieldInspector from './FieldInspector'

// Field 인스펙터 '경기 요소' 구역(6a): 공 켜기(개인 실행 설정), 묶음별 공 수(6b·6d 묶음은 단계), 실행의 공 수, 로봇 프리로드 출처.

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

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

const t = (key: string, params?: Record<string, unknown>): string =>
  (i18n.t as unknown as (key: string, params?: Record<string, unknown>) => string)(key, params)

const node = (
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  position: [number, number, number] = [0, 0, 0],
  extra: Partial<SceneObject> = {}
): SceneObject => ({
  id,
  name: id,
  kind,
  parentId,
  transform: { position, rotation: [0, 0, 0] },
  ...extra
})
const SCENE: SceneObjects = {
  Alpha: node('Alpha', 'robot', null, [-0.9, -0.9, 0]),
  Beta: node('Beta', 'robot', null, [0.9, 0.9, 0]),
  hopper: node('hopper', 'group', 'Beta', [0, 0, 0.1], {
    preload: { kind: 'pollen', center: [0, 0, 0] }
  })
}

beforeEach(() => {
  setStore(useSceneStore, { objects: SCENE, field: { season: 'biobuzz' } })
  setStore(usePlayStore, { run: null, settings: DEFAULT_PLAY_SETTINGS })
  setStore(useSceneVisibilityStore, { fieldHidden: false, isolated: null })
})

afterEach(() => {
  while (restores.length > 0) restores.pop()!()
})

const html = (season: 'biobuzz' | 'none' = 'biobuzz'): string =>
  renderToStaticMarkup(<FieldElementsSection spec={resolveSeason(season)} />)

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

describe("Field 인스펙터 '경기 요소'", () => {
  it('BIOBUZZ: GARDEN POLLEN 8개, 6b·6d 묶음은 단계, 로봇마다 프리로드 출처(문서 순서)', () => {
    const text = html()
    expect(text).toContain(t('field.inspector.elements.title'))
    expect(text).toContain(t('field.inspector.elements.enabled'))
    expect(text).toContain(
      `${t('field.inspector.elements.groups.garden')}</span><output class="field-inspector-value">${t('field.inspector.elements.count', { count: 8 })}`
    )
    expect(text).toContain(t('field.inspector.elements.deferred', { stage: '6b' }))
    expect(text).toContain(t('field.inspector.elements.deferred', { stage: '6d' }))
    const alpha = text.indexOf(
      t('field.inspector.elements.robotLine', {
        robot: 'Alpha',
        source: t('preload.source.auto', { count: 4, face: t('preload.faces.front') })
      })
    )
    const beta = text.indexOf(
      t('field.inspector.elements.robotLine', {
        robot: 'Beta',
        source: t('preload.source.slots', { count: 1 })
      })
    )
    expect(alpha).toBeGreaterThan(0)
    expect(beta).toBeGreaterThan(alpha)
    expect(text).not.toContain(t('field.inspector.elements.off'))
  })

  it("'none'은 경기 요소가 없다고만, 끄면 다음 실행에 공이 없다고 알린다", () => {
    const none = html('none')
    expect(none).toContain(t('field.inspector.elements.none'))
    expect(none).not.toContain(t('field.inspector.elements.preloads'))
    setStore(usePlayStore, { settings: { ...DEFAULT_PLAY_SETTINGS, gameElements: false } })
    expect(html()).toContain(t('field.inspector.elements.off'))
  })

  it('확인란은 개인 설정 gameElements를 바꾼다', () => {
    const updateSettings = vi.fn()
    setStore(usePlayStore, { updateSettings })
    const box = capture(() => FieldElementsSection({ spec: resolveSeason('biobuzz') })).find(
      (element) => element.props['data-field-elements'] === 'enabled'
    )!
    expect(box.props.checked).toBe(true)
    ;(box.props.onChange as (event: unknown) => void)({ target: { checked: false } })
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ gameElements: false })
  })

  it('실행이 잠그면 그 실행의 공 수(경기 요소 없이 실행했으면 그 사실)', () => {
    const opMode: OpModeInfo = {
      className: 'a.B',
      path: 'B.java',
      line: 1,
      flavor: 'TeleOp',
      name: 'B',
      group: '',
      preselectTeleOp: ''
    }
    const base = newRun({
      runId: 'r',
      root: '/p',
      opMode,
      robotId: 'Alpha',
      configPath: null,
      speed: 1,
      paused: false
    })
    setStore(usePlayStore, {
      run: {
        ...base,
        phase: 'running',
        elements: { kinds: Array(12).fill('pollen'), spawns: [] }
      }
    })
    expect(html()).toContain(t('field.inspector.elements.running', { count: 12 }))
    setStore(usePlayStore, { run: { ...base, phase: 'running' } })
    expect(html()).toContain(t('field.inspector.elements.runningOff'))
  })

  it('Field 인스펙터에 구역이 HIVE 상태 다음에 있다', () => {
    const text = renderToStaticMarkup(<FieldInspector />)
    const hive = text.indexOf(t('field.inspector.hiveState'))
    const section = text.indexOf(t('field.inspector.elements.title'))
    expect(hive).toBeGreaterThan(0)
    expect(section).toBeGreaterThan(hive)
  })
})
