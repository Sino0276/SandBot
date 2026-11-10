import i18n from 'i18next'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { BoxGeometry } from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { useImportStore } from '../../cad/importStore'
import * as actions from '../../field/fieldVisualActions'
import { setLoadedFieldVisual, useFieldVisualStore } from '../../field/fieldVisualStore'
import en from '../../i18n/locales/en'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { newRun, usePlayStore, type PlayRun, type PlayRunField } from '../../play/playStore'
import { useProjectStore, type FieldVisualStatusEntry } from '../../project/projectStore'
import type { FieldVisual } from '../../scene/fieldDoc'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { useSceneVisibilityStore } from '../sceneVisibility'
import FieldCadSection from './FieldCadSection'
import FieldInspector from './FieldInspector'

// Field 인스펙터 "필드 CAD (보기용)" 구역(spec-4e §4.1, B2·B3·B4·B10). renderToStaticMarkup으로 글자를 보고, 처리기는 감싼
// 컴포넌트의 렌더 안에서 FieldCadSection을 함수로 불러 나온 요소 나무에서 찾아 부른다(DOM이 없다, 훅은 감싼 컴포넌트의 것).

vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

vi.mock('../../field/fieldVisualActions', () => ({
  importFieldVisual: vi.fn(async () => {}),
  reloadFieldVisual: vi.fn(async () => {}),
  relinkFieldVisual: vi.fn(async () => {}),
  clearFieldVisual: vi.fn(),
  loadProjectFieldVisual: vi.fn(async () => {})
}))

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다(fieldUi.test.tsx와 같은 방법)
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
  vi.clearAllMocks()
})

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko }, en: { translation: en } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

const PATH = '/team/field/field-cad-step.step'
const VISUAL: FieldVisual = {
  fileName: 'field-cad-step.step',
  absolutePath: PATH,
  upAxis: '+Y',
  forwardAxis: '+Z'
}
// 공식 필드 STEP의 경계 상자(CAD 좌표, m, spec-4e B11·부록 A)
const OFFICIAL_BOUNDS = {
  min: [-3.192, -0.043, -1.824] as [number, number, number],
  max: [3.192, 1.677, 1.824] as [number, number, number]
}

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}
function run(field: PlayRunField, patch: Partial<PlayRun> = {}): PlayRun {
  return {
    ...newRun({
      runId: 'r',
      root: '/p',
      opMode: OP_MODE,
      robotId: 'bot',
      configPath: null,
      speed: 1,
      paused: false,
      field
    }),
    phase: 'running',
    ...patch
  }
}

function doc(season = 'biobuzz', visual: FieldVisual | null = VISUAL): void {
  setStore(useSceneStore, { objects: {}, field: visual ? { season, visual } : { season } })
}

// 형상 칸에 작은 형상을 넣는다(path가 문서 visual과 같으면 그려져 있음)
function loadShape(path = PATH, bounds = OFFICIAL_BOUNDS): void {
  setLoadedFieldVisual(path, {
    groups: [
      {
        key: 'g0',
        color: [0.5, 0.5, 0.5],
        vertexColors: false,
        glass: false,
        decal: false,
        geometry: new BoxGeometry()
      }
    ],
    meshCount: 993,
    triangleCount: 1526368,
    glassMeshCount: 12,
    bounds
  })
  setStore(useFieldVisualStore, { loaded: useFieldVisualStore.getState().loaded })
}

function status(entry: FieldVisualStatusEntry | null): void {
  setStore(useProjectStore, { fieldVisualStatus: entry })
}

beforeEach(async () => {
  await i18n.changeLanguage('ko')
  setStore(usePlayStore, { run: null, settings: DEFAULT_PLAY_SETTINGS })
  setStore(useSceneVisibilityStore, {
    hidden: new Set(),
    isolated: null,
    fieldHidden: false,
    fieldShapesShown: false
  })
  setStore(useUnitStore, { lengthUnit: 'm' })
  setStore(useImportStore, { running: 0 })
  setStore(useProjectStore, { busy: false, fieldVisualStatus: null })
  setStore(useFieldVisualStore, { loaded: null })
  doc()
})

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

// FieldCadSection의 요소 나무(감싼 컴포넌트의 렌더 안에서 함수로 부른다)
function tree(): Element[] {
  let captured: ReactNode = null
  function Capture(): null {
    captured = FieldCadSection()
    return null
  }
  renderToStaticMarkup(<Capture />)
  return elements(captured)
}
const byData = (list: Element[], name: string): Element | undefined =>
  list.find((element) => element.props['data-field-cad'] === name)

const html = (): string => renderToStaticMarkup(<FieldCadSection />)
// 여는 태그 하나(marker를 품는)
const tagOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  expect(at).toBeGreaterThanOrEqual(0)
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>', at) + 1)
}

describe('필드 CAD 구역 상태별(B2)', () => {
  it('visual 없음: [필드 CAD 불러오기…]와 도움말만', () => {
    doc('biobuzz', null)
    const text = html()
    expect(text).toContain('필드 CAD (보기용)')
    expect(text).toContain('필드 CAD 불러오기…')
    expect(text).toContain(ko.field.inspector.cad.hint)
    expect(text).not.toContain(ko.inspector.cad.reload)
    expect(text).not.toContain(ko.inspector.cad.relink)
    expect(tagOf(text, 'data-field-cad="import"')).not.toContain('disabled')
    expect(text).not.toContain('frame-badge')
    // 누르면 불러오기
    ;(byData(tree(), 'import')!.props.onClick as () => void)()
    expect(actions.importFieldVisual).toHaveBeenCalledTimes(1)
  })

  it('불러오는 중·바쁨·잠그는 실행이면 비활성, 실행이면 "실행 중" 배지와 이유', () => {
    doc('biobuzz', null)
    setStore(useImportStore, { running: 1 })
    expect(tagOf(html(), 'data-field-cad="import"')).toContain('disabled')
    setStore(useImportStore, { running: 0 })
    setStore(useProjectStore, { busy: true })
    expect(tagOf(html(), 'data-field-cad="import"')).toContain('disabled')
    setStore(useProjectStore, { busy: false })
    setStore(usePlayStore, { run: run({ season: 'biobuzz', hiveTipped: [false, false] }) })
    const text = html()
    const button = tagOf(text, 'data-field-cad="import"')
    expect(button).toContain('disabled')
    expect(button).toContain(`title="${ko.field.inspector.cad.runningHint}"`)
    expect(text).toContain('frame-badge is-running')
    expect(text).toContain(`>${ko.inspector.running}<`)
    // 떼어 놓은 실행은 잠그지 않는다
    setStore(usePlayStore, {
      run: run({ season: 'biobuzz', hiveTipped: [false, false] }, { detached: true })
    })
    expect(tagOf(html(), 'data-field-cad="import"')).not.toContain('disabled')
  })

  it('shown: 파일 줄·[다시 불러오기]·[파일 다시 찾기]·[지우기]·요약·경계 상자, 배지 없음', () => {
    loadShape()
    const text = html()
    expect(text).toContain(`title="${PATH}"`)
    expect(text).toContain('field-cad-step.step')
    expect(text).toContain(`>${ko.inspector.cad.reload}<`)
    expect(text).toContain(`>${ko.inspector.cad.relink}<`)
    expect(text).toContain(`>${ko.field.inspector.cad.clear}<`)
    expect(text).not.toContain('data-field-cad-state')
    expect(text).toContain('메시 993개 · 삼각형 1,526,368개 · 투명판 12개')
    // yUp: 필드 X = CAD z, Y = CAD x, Z = CAD y
    expect(text).toContain(
      '필드 좌표 범위: X -1.8240..1.8240 m · Y -3.1920..3.1920 m · Z -0.0430..1.6770 m'
    )
    expect(text).not.toContain('data-field-cad="alignSuspect"')
  })

  it('요약 숫자는 UI 언어 형식(영어도 1,526,368)', async () => {
    loadShape()
    await i18n.changeLanguage('en')
    expect(html()).toContain('993 meshes · 1,526,368 triangles · 12 glass panels')
  })

  it('failed·cancelled·unloaded·missing·loading 배지와 [다시 불러오기]', () => {
    const cases: [FieldVisualStatusEntry | null, string, string][] = [
      [{ path: PATH, status: 'failed' }, 'failed', ko.inspector.cad.failed],
      [{ path: PATH, status: 'cancelled' }, 'cancelled', ko.inspector.cad.cancelled],
      [null, 'unloaded', ko.field.inspector.cad.unloaded],
      [{ path: PATH, status: 'missing' }, 'missing', ko.inspector.cad.missing],
      [{ path: PATH, status: 'loading' }, 'loading', ko.inspector.cad.loading],
      // 다른 경로의 상태는 무시한다(지우기 → 다른 파일 → 되살림)
      [{ path: '/other.step', status: 'missing' }, 'unloaded', ko.field.inspector.cad.unloaded]
    ]
    for (const [entry, state, label] of cases) {
      status(entry)
      const text = html()
      const badge = tagOf(text, `data-field-cad-state="${state}"`)
      expect(badge).toContain(state === 'loading' ? 'cad-file-status' : 'cad-file-missing')
      expect(text).toContain(`data-field-cad-state="${state}">${label}<`)
      expect(text).toContain(`>${ko.inspector.cad.reload}<`)
      // 그려져 있지 않으면 요약이 없다
      expect(text).not.toContain('data-field-cad="stats"')
    }
    // 그려져 있어도 내 경로 missing이면 missing
    loadShape()
    status({ path: PATH, status: 'missing' })
    expect(html()).toContain('data-field-cad-state="missing"')
  })

  it('버튼이 액션을 부른다(다시 불러오기·다시 찾기·지우기), 잠그는 실행이면 세 불러오기 비활성이고 지우기는 된다', () => {
    loadShape()
    const list = tree()
    ;(byData(list, 'reload')!.props.onClick as () => void)()
    ;(byData(list, 'relink')!.props.onClick as () => void)()
    ;(byData(list, 'clear')!.props.onClick as () => void)()
    expect(actions.reloadFieldVisual).toHaveBeenCalledTimes(1)
    expect(actions.relinkFieldVisual).toHaveBeenCalledTimes(1)
    expect(actions.clearFieldVisual).toHaveBeenCalledTimes(1)
    setStore(usePlayStore, { run: run({ season: 'biobuzz', hiveTipped: [false, false] }) })
    const locked = tree()
    expect(byData(locked, 'reload')!.props.disabled).toBe(true)
    expect(byData(locked, 'relink')!.props.disabled).toBe(true)
    expect(byData(locked, 'clear')!.props.disabled).toBeUndefined()
    expect(byData(locked, 'preset')!.props.disabled).toBeUndefined()
  })

  it('정렬이 의심스러우면 경고 줄(Z-up을 고른 공식 파일)', () => {
    doc('biobuzz', { ...VISUAL, upAxis: '+Z', forwardAxis: '-Y' })
    loadShape()
    expect(html()).toContain('data-field-cad="alignSuspect"')
  })
})

describe('정렬 칸(B3)', () => {
  const alignment = vi.fn()
  beforeEach(() => {
    alignment.mockClear()
    setStore(useSceneStore, { setFieldVisualAlignment: alignment })
  })

  it('프리셋 yUp이면 yUp, 사용자 축이면 custom', () => {
    expect(byData(tree(), 'preset')!.props.value).toBe('yUp')
    doc('biobuzz', { ...VISUAL, upAxis: '+Z', forwardAxis: '-Y' })
    expect(byData(tree(), 'preset')!.props.value).toBe('zUp')
    doc('biobuzz', { ...VISUAL, upAxis: '+X', forwardAxis: '+Y' })
    expect(byData(tree(), 'preset')!.props.value).toBe('custom')
  })

  it('위 축을 앞 축과 같은 글자로 바꾸면 앞 축이 다른 축으로, 고르면 setFieldVisualAlignment 한 번', () => {
    const change = (name: string, value: string): void =>
      (byData(tree(), name)!.props.onChange as (event: unknown) => void)({ target: { value } })
    change('upAxis', '+Z')
    expect(alignment).toHaveBeenCalledExactlyOnceWith({ upAxis: '+Z', forwardAxis: '+X' })
    alignment.mockClear()
    change('upAxis', '-Y')
    expect(alignment).toHaveBeenCalledExactlyOnceWith({ upAxis: '-Y', forwardAxis: '+Z' })
    alignment.mockClear()
    change('forwardAxis', '-X')
    expect(alignment).toHaveBeenCalledExactlyOnceWith({ upAxis: '+Y', forwardAxis: '-X' })
    alignment.mockClear()
    change('preset', 'zUp')
    expect(alignment).toHaveBeenCalledExactlyOnceWith({ upAxis: '+Z', forwardAxis: '-Y' })
    alignment.mockClear()
    change('preset', 'custom')
    expect(alignment).not.toHaveBeenCalled()
    // 앞 축 목록은 위 축과 다른 글자만
    const options = elements(byData(tree(), 'forwardAxis')!.props.children as ReactNode)
      .filter((element) => element.type === 'option')
      .map((element) => element.props.value)
    expect(options).toEqual(['+X', '-X', '+Z', '-Z'])
  })

  it('잠그는 실행 중에도 고칠 수 있다', () => {
    setStore(usePlayStore, { run: run({ season: 'biobuzz', hiveTipped: [false, false] }) })
    const list = tree()
    for (const name of ['preset', 'upAxis', 'forwardAxis'])
      expect(byData(list, name)!.props.disabled).toBeUndefined()
    ;(byData(list, 'upAxis')!.props.onChange as (event: unknown) => void)({
      target: { value: '+Z' }
    })
    expect(alignment).toHaveBeenCalledTimes(1)
  })
})

describe('단순 형상 확인란·안내 줄(B4)', () => {
  it('CAD가 그려질 때만 켤 수 있고 fieldShapesShown을 바꾼다', () => {
    expect(byData(tree(), 'showShapes')!.props.disabled).toBe(true)
    loadShape()
    const input = byData(tree(), 'showShapes')!
    expect(input.props.disabled).toBe(false)
    ;(input.props.onChange as (event: unknown) => void)({ target: { checked: true } })
    expect(useSceneVisibilityStore.getState().fieldShapesShown).toBe(true)
    // 숨김이면 CAD 층이 그려지지 않아 비활성(값은 남는다)
    setStore(useSceneVisibilityStore, { fieldHidden: true, fieldShapesShown: true })
    const hidden = byData(tree(), 'showShapes')!
    expect(hidden.props.disabled).toBe(true)
    expect(hidden.props.checked).toBe(true)
  })

  it('숨김 줄: 그려져 있고 fieldHidden·고립 보기일 때만', () => {
    setStore(useSceneVisibilityStore, { fieldHidden: true })
    expect(html()).not.toContain('data-field-cad="hidden"')
    loadShape()
    expect(html()).toContain('data-field-cad="hidden"')
    setStore(useSceneVisibilityStore, { fieldHidden: false, isolated: ['bot'] })
    expect(html()).toContain(ko.field.inspector.cad.hiddenNote)
    setStore(useSceneVisibilityStore, { isolated: null })
    expect(html()).not.toContain('data-field-cad="hidden"')
  })

  it('넘어간 HIVE 줄: 그려져 있고 보이는 HIVE 상태가 넘어감(잠근 실행이면 run.field.hiveTipped)', () => {
    loadShape()
    expect(html()).not.toContain('data-field-cad="hiveTipped"')
    setStore(usePlayStore, {
      settings: { ...DEFAULT_PLAY_SETTINGS, hiveState: { red: 'start', blue: 'tipped' } }
    })
    expect(html()).toContain(ko.field.inspector.cad.hiveTippedNote)
    // 숨김·고립 보기면 CAD 층을 그리지 않아 안내가 없다
    setStore(useSceneVisibilityStore, { fieldHidden: true })
    expect(html()).not.toContain('data-field-cad="hiveTipped"')
    setStore(useSceneVisibilityStore, { fieldHidden: false })
    // 잠근 실행은 실행의 상태(시작 상태)
    setStore(usePlayStore, { run: run({ season: 'biobuzz', hiveTipped: [false, false] }) })
    expect(html()).not.toContain('data-field-cad="hiveTipped"')
    setStore(usePlayStore, {
      run: run({ season: 'biobuzz', hiveTipped: [true, false] }),
      settings: DEFAULT_PLAY_SETTINGS
    })
    expect(html()).toContain('data-field-cad="hiveTipped"')
  })

  it("단순 시즌 줄: visual이 있고 'none'·모르는 시즌(잠근 실행이면 실행의 시즌)", () => {
    expect(html()).not.toContain('data-field-cad="simpleSeason"')
    doc('none')
    expect(html()).toContain(ko.field.inspector.cad.simpleSeasonNote)
    doc('decode2027')
    expect(html()).toContain('data-field-cad="simpleSeason"')
    doc('none', null)
    expect(html()).not.toContain('data-field-cad="simpleSeason"')
    doc('biobuzz')
    setStore(usePlayStore, { run: run({ season: 'none', hiveTipped: [false, false] }) })
    expect(html()).toContain('data-field-cad="simpleSeason"')
  })

  it('"필드 요소 보이기"는 visual이 있을 때만 CAD 도움말(title·줄)', () => {
    doc('biobuzz', null)
    let text = renderToStaticMarkup(<FieldInspector />)
    expect(text).not.toContain(ko.field.inspector.showElementsCadHint)
    doc()
    text = renderToStaticMarkup(<FieldInspector />)
    expect(text).toContain(`title="${ko.field.inspector.showElementsCadHint}"`)
    expect(text).toContain('data-field-cad="showElementsHint"')
    // 시즌 구역 다음, HIVE 구역 앞
    const cad = text.indexOf('필드 CAD (보기용)')
    expect(cad).toBeGreaterThan(text.indexOf(ko.field.inspector.showElements))
    expect(cad).toBeLessThan(text.indexOf(ko.field.inspector.hiveState))
  })
})

describe('i18n(B10·B1)', () => {
  it('새 키가 ko·en에 있다', () => {
    const keys = [
      'title',
      'import',
      'chooseTitle',
      'hint',
      'clear',
      'unloaded',
      'runningHint',
      'forwardAxis',
      'alignHint',
      'stats',
      'bounds',
      'alignSuspect',
      'showShapes',
      'showShapesHint',
      'hiveTippedNote',
      'hiddenNote',
      'simpleSeasonNote'
    ] as const
    for (const key of keys) {
      expect(ko.field.inspector.cad[key]).toBeTruthy()
      expect(en.field.inspector.cad[key]).toBeTruthy()
    }
    expect(en.field.inspector.showElementsCadHint).toBeTruthy()
    expect(ko.field.inspector.showElementsCadHint).toBeTruthy()
  })

  it('웹캠 편집 자세 도움말에 기울이라는 안내가 없다(spec-4e §1.1)', () => {
    for (const hint of [ko.hardware.cameraReading.hint, en.hardware.cameraReading.hint]) {
      expect(hint).not.toContain('25–35')
      expect(hint).not.toContain('30°')
      expect(hint).not.toContain('default 30')
      // 사실 문장은 둔다
      expect(hint).toContain('640×480')
    }
  })
})
