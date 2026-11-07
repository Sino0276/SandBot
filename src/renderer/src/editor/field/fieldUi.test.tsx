import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { chooseFieldSeason } from '../../field/fieldActions'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { newRun, usePlayStore, type PlayRun, type PlayRunField } from '../../play/playStore'
import type { SceneObject, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { useDialogStore } from '../dialogStore'
import { useNoticeStore } from '../noticeStore'
import { useEditorStore } from '../editorStore'
import { useHierarchyDragStore } from '../hierarchyDnd'
import { useHierarchyViewStore } from '../hierarchyTree'
import HierarchyPanel from '../panels/HierarchyPanel'
import InspectorPanel from '../panels/InspectorPanel'
import { useSceneVisibilityStore } from '../sceneVisibility'
import { setHiveSide } from './fieldDisplay'
import { handleFieldRowEvent } from './fieldRowEvents'
import StartPresetSection from './StartPresetSection'

// 하이어라키 Field 줄(C11·C12·C15), Field 인스펙터(C9), 로봇 "시작 위치"(C7의 그리기) 그리기 확인. renderToStaticMarkup은
// DOM이 없어 사건을 보낼 수 없으므로, 영역 처리기의 Field 줄 갈래(handleFieldRowEvent)는 가짜 사건으로 따로 확인한다.

// 단위 스토어는 불러올 때 localStorage를 읽는다(Node 테스트에는 없다)
vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다(UsageSection.test.tsx와 같은 방법)
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
})

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

function node(
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  extra: Partial<SceneObject> = {}
): SceneObject {
  return {
    id,
    name: id,
    kind,
    parentId,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    ...extra
  }
}

const SCENE: SceneObjects = {
  bot: node('bot', 'robot', null),
  part: node('part', 'part', 'bot')
}
const WIDE: SceneObjects = {
  wide: node('wide', 'robot', null),
  wideCad: node('wideCad', 'assembly', 'wide', {
    cad: {
      fileName: 'wide.step',
      absolutePath: '/cad/wide.step',
      upAxis: '+Z',
      forwardAxis: '+X',
      bounds: { min: [-0.4, -0.35, 0], max: [0.4, 0.35, 0.3] },
      meshCount: 0,
      meshIndexing: 'source'
    }
  })
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

function scene(objects: SceneObjects, season = 'biobuzz'): void {
  setStore(useSceneStore, { objects, field: { season } })
}

function editor(patch: Partial<ReturnType<typeof useEditorStore.getState>>): void {
  setStore(useEditorStore, {
    selectedId: null,
    selectedIds: [],
    rangeAnchorId: null,
    renamingId: null,
    fieldSelected: false,
    ...patch
  })
}

beforeEach(() => {
  setStore(usePlayStore, { run: null, settings: DEFAULT_PLAY_SETTINGS })
  setStore(useSceneVisibilityStore, { hidden: new Set(), isolated: null, fieldHidden: false })
  setStore(useHierarchyViewStore, { query: '', overrides: {} })
  setStore(useUnitStore, { lengthUnit: 'mm' })
  editor({})
})

// 여는 태그 하나의 속성 글자
const tagOf = (html: string, marker: string): string => {
  const at = html.indexOf(marker)
  expect(at).toBeGreaterThanOrEqual(0)
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}
const count = (html: string, text: string): number => html.split(text).length - 1

describe('하이어라키 Field 줄 그리기(C11·C12·C15)', () => {
  it('빈 씬에도 트리와 Field 줄이 있고, 안내는 그 아래다', () => {
    scene({})
    const html = renderToStaticMarkup(<HierarchyPanel />)
    expect(html).toContain('role="tree"')
    const row = tagOf(html, 'data-field-row')
    expect(row).toContain('role="treeitem"')
    expect(row).toContain('aria-level="1"')
    expect(row).not.toContain('aria-setsize')
    expect(html).toContain('Field — BIOBUZZ (2026-27)')
    expect(html.indexOf('data-field-row')).toBeLessThan(html.indexOf('씬에 오브젝트가 없습니다'))
    // 행이 없으면 Field 줄이 탭 정지
    expect(row).toContain('tabindex="0"')
    expect(count(html, 'tabindex="0"')).toBe(1)
  })

  it('검색 중에는 Field 줄이 없다', () => {
    scene(SCENE)
    setStore(useHierarchyViewStore, { query: 'bot' })
    const html = renderToStaticMarkup(<HierarchyPanel />)
    expect(html).not.toContain('data-field-row')
    expect(count(html, 'tabindex="0"')).toBe(1)
  })

  it('탭 정지는 늘 하나다: Field 선택이면 Field 줄, 아니면 활성 오브젝트 또는 첫 행', () => {
    scene(SCENE)
    let html = renderToStaticMarkup(<HierarchyPanel />)
    expect(count(html, 'tabindex="0"')).toBe(1)
    expect(tagOf(html, 'data-object-id="bot"')).toContain('tabindex="0"')
    editor({ fieldSelected: true })
    html = renderToStaticMarkup(<HierarchyPanel />)
    expect(count(html, 'tabindex="0"')).toBe(1)
    const row = tagOf(html, 'data-field-row')
    expect(row).toContain('tabindex="0"')
    expect(row).toContain('aria-selected="true"')
    expect(row).toContain('is-selected')
    editor({ selectedId: 'part', selectedIds: ['part'] })
    html = renderToStaticMarkup(<HierarchyPanel />)
    expect(count(html, 'tabindex="0"')).toBe(1)
    expect(tagOf(html, 'data-object-id="part"')).toContain('tabindex="0"')
  })

  it('모르는 시즌의 이름과 긴 문자열 title', () => {
    const season = 'decode2027' + 'x'.repeat(50)
    scene(SCENE, season)
    const html = renderToStaticMarkup(<HierarchyPanel />)
    expect(tagOf(html, 'data-field-row')).toContain(`title="Field — 알 수 없는 시즌 (${season})"`)
  })

  it('고립 중 Field 줄 눈 아이콘은 mixed, 숨기면 hidden', () => {
    scene(SCENE)
    setStore(useSceneVisibilityStore, { isolated: ['bot'] })
    let html = renderToStaticMarkup(<HierarchyPanel />)
    const eyeAfter = (text: string): string => {
      const start = html.indexOf(text)
      return tagOf(html.slice(start), 'tree-eye')
    }
    expect(eyeAfter('data-field-row')).toContain('is-mixed')
    setStore(useSceneVisibilityStore, { isolated: null, fieldHidden: true })
    html = renderToStaticMarkup(<HierarchyPanel />)
    expect(eyeAfter('data-field-row')).toContain('is-hidden')
  })
})

// 가짜 사건: target.closest가 Field 줄을 찾는다
type FakeEvent = {
  target: EventTarget
  preventDefault: Mock<() => void>
  dataTransfer: { dropEffect: string }
  ctrlKey: boolean
}

function fieldEvent(onField: boolean): FakeEvent {
  const preventDefault = vi.fn<() => void>()
  const dataTransfer = { dropEffect: 'move' }
  return {
    target: {
      closest: (selector: string) => (onField && selector === '[data-field-row]' ? {} : null)
    } as unknown as EventTarget,
    preventDefault,
    dataTransfer,
    ctrlKey: true
  }
}

describe('Field 줄 사건(C11)', () => {
  beforeEach(() => {
    useEditorStore.getState().select('bot')
    useDialogStore.setState({ request: null })
  })

  it('클릭(Ctrl+클릭도) → Field 선택, 영역의 빈 공간 처리로 내려가지 않는다', () => {
    const event = fieldEvent(true)
    expect(handleFieldRowEvent('click', event)).toBe(true)
    expect(useEditorStore.getState().fieldSelected).toBe(true)
    expect(useEditorStore.getState().selectedIds).toEqual([])
    // Field 줄 밖이면 처리하지 않는다(영역이 빈 공간·행으로 처리)
    expect(handleFieldRowEvent('click', fieldEvent(false))).toBe(false)
  })

  it('우클릭 → 기본 메뉴만 막고 메뉴를 열지 않으며 선택은 그대로', () => {
    const event = fieldEvent(true)
    expect(handleFieldRowEvent('contextMenu', event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(useDialogStore.getState().request).toBeNull()
    expect(useEditorStore.getState().selectedIds).toEqual(['bot'])
    expect(useEditorStore.getState().fieldSelected).toBe(false)
  })

  it('더블클릭은 아무것도 하지 않는다', () => {
    expect(handleFieldRowEvent('doubleClick', fieldEvent(true))).toBe(true)
    expect(useEditorStore.getState().focusRequest).toBeNull()
  })

  it('끌기: preventDefault 안 함, dropEffect none, 표시선 없음', () => {
    useHierarchyDragStore.setState({ indicator: { id: null, position: 'end' } })
    const event = fieldEvent(true)
    expect(handleFieldRowEvent('dragOver', event)).toBe(true)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.dataTransfer.dropEffect).toBe('none')
    expect(useHierarchyDragStore.getState().indicator).toBeNull()
    expect(handleFieldRowEvent('drop', fieldEvent(true))).toBe(true)
    expect(useEditorStore.getState().selectedIds).toEqual(['bot'])
  })
})

describe('Field 인스펙터(C9)', () => {
  const inspector = (): string => {
    editor({ fieldSelected: true })
    return renderToStaticMarkup(<InspectorPanel />)
  }

  it('Field를 고르면 인스펙터가 Field 인스펙터다: 시즌 선택, 축 안내, 반폭, HIVE 칸(BIOBUZZ만)', () => {
    scene(SCENE)
    const html = inspector()
    expect(html).toContain('<option value="biobuzz" selected="">')
    expect(html).toContain('+X 관중석 벽, +Y 파랑 벽')
    // 벽 안쪽 반폭 1.79286 m(표시 단위 mm)
    expect(html).toContain('1792.9 mm')
    expect(html).toContain('HIVE 상태')
    expect(count(html, '<option value="tipped"')).toBe(2)
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('type="checkbox" checked=""')
    scene(SCENE, 'none')
    expect(inspector()).not.toContain('HIVE 상태')
  })

  it('모르는 시즌은 흐린 항목이고 공칭 필드 안내', () => {
    scene(SCENE, 'decode2027')
    const html = inspector()
    expect(html).toContain(
      '<option value="decode2027" disabled="" selected="">알 수 없는 시즌 (decode2027)'
    )
    expect(html).toContain('공칭 12 ft')
    expect(html).not.toContain('HIVE 상태')
  })

  it('잠기면 실행의 시즌·HIVE 상태를 비활성으로 보이고, 문서 시즌이 다르면 afterRun 줄', () => {
    scene(SCENE, 'none')
    setStore(usePlayStore, { run: run({ season: 'biobuzz', hiveTipped: [true, false] }) })
    const html = inspector()
    expect(html).toContain('<option value="biobuzz" selected="">')
    expect(html).toContain('실행 중')
    expect(html).toContain('실행이 끝나면 없음 (공칭 12 ft) 필드로 돌아갑니다.')
    expect(count(html, '<select class="field-select" disabled=""')).toBe(3)
    expect(html).toContain('<option value="tipped" selected="">')
    // 떼어 놓은 실행은 잠그지 않는다
    setStore(usePlayStore, {
      run: run({ season: 'biobuzz', hiveTipped: [true, false] }, { detached: true })
    })
    const free = inspector()
    expect(free).not.toContain('disabled=""')
    expect(free).toContain('<option value="none" selected="">')
  })

  it('모르는 문서 시즌의 실행(run.field.season은 none)은 실행 중이어도 afterRun 줄이 없다(푼 시즌으로 비교)', () => {
    scene(SCENE, 'decode2027')
    setStore(usePlayStore, { run: run({ season: 'none', hiveTipped: [false, false] }) })
    const html = inspector()
    expect(html).toContain('실행 중')
    expect(html).not.toContain('실행이 끝나면')
    // 실행 취소로 문서가 BIOBUZZ가 되면 돌아갈 필드가 달라지므로 보인다
    scene(SCENE, 'biobuzz')
    expect(inspector()).toContain('실행이 끝나면 BIOBUZZ')
  })

  it('시즌 선택은 chooseFieldSeason, HIVE 칸은 개인 실행 설정', () => {
    useSceneStore.setState({ objects: SCENE, field: { season: 'biobuzz' } })
    chooseFieldSeason('none')
    expect(useSceneStore.getState().field).toEqual({ season: 'none' })
    // 인스펙터의 시즌 선택은 갈래 B의 chooseFieldSeason(notifyFieldState('choose'))까지 간다: 'none' 벽에 붙인
    // 18 in 로봇은 BIOBUZZ(벽 안쪽 반폭 1.79286 m)로 바꾸면 겹침 알림이 뜬다
    useNoticeStore.setState({ notices: [] })
    const atNoneWall: SceneObjects = {
      bot: node('bot', 'robot', null, {
        transform: { position: [0, -(1.8163 - 0.2286), 0], rotation: [0, 0, 0] }
      })
    }
    useSceneStore.setState({ objects: atNoneWall, field: { season: 'none' } })
    chooseFieldSeason('biobuzz')
    expect(useNoticeStore.getState().notices.map((notice) => notice.key)).toEqual([
      'fieldStartOverlap'
    ])
    useNoticeStore.setState({ notices: [] })
    usePlayStore.setState({ settings: DEFAULT_PLAY_SETTINGS })
    setHiveSide('red', 'tipped')
    expect(usePlayStore.getState().settings.hiveState).toEqual({ red: 'tipped', blue: 'start' })
    // 기본값 객체는 그대로
    expect(DEFAULT_PLAY_SETTINGS.hiveState).toEqual({ red: 'start', blue: 'start' })
  })
})

describe('로봇 "시작 위치" 그리기(C7)', () => {
  it('맞는 프리셋이 없으면 —, 얼라이언스 묶음과 면 선택칸, 외곽·충돌 높이 줄', () => {
    scene(SCENE)
    const html = renderToStaticMarkup(<StartPresetSection robot={SCENE.bot} />)
    expect(html).toContain('<option value="" disabled="" selected="">—</option>')
    expect(html).toContain('<optgroup label="빨강">')
    expect(html).toContain('<optgroup label="파랑">')
    expect(html).toContain('<option value="default" selected="">')
    expect(html).toContain('외곽 457.2 mm × 457.2 mm')
    expect(html).toContain('충돌 높이 457.2 mm')
    expect(html).not.toContain('is-reason')
  })

  it('너무 넓거나 충돌하는 프리셋은 비활성이고 이유가 선택칸 아래 한 줄이다', () => {
    scene(WIDE)
    const html = renderToStaticMarkup(<StartPresetSection robot={WIDE.wide} />)
    expect(html).toContain('<option value="redWallScoring" disabled="">')
    expect(html).toContain('<option value="scoringWallCorner" disabled="">')
    expect(count(html, 'inspector-note is-reason')).toBe(2)
    expect(html).toContain('LOADING ZONE')
    expect(html).toContain('18 in 넘음')
  })

  it("실행 중 잠기고, 'none'·모르는 시즌은 흐린 한 줄", () => {
    scene(SCENE)
    setStore(usePlayStore, { run: run({ season: 'biobuzz', hiveTipped: [false, false] }) })
    const locked = renderToStaticMarkup(<StartPresetSection robot={SCENE.bot} />)
    expect(count(locked, '<select class="field-select" disabled=""')).toBe(2)
    expect(locked).toContain('실행 중')
    // 실행 중 실행 취소로 문서 시즌이 프리셋 없는 시즌이 되어도 잠김 표시는 남는다(씬 뷰는 실행의 시즌)
    scene(SCENE, 'none')
    const undone = renderToStaticMarkup(<StartPresetSection robot={SCENE.bot} />)
    expect(undone).toContain('이 시즌에는 시작 위치 프리셋이 없습니다.')
    expect(undone).toContain('실행 중')
    setStore(usePlayStore, { run: null })
    for (const season of ['none', 'decode2027']) {
      scene(SCENE, season)
      const html = renderToStaticMarkup(<StartPresetSection robot={SCENE.bot} />)
      expect(html).toContain('이 시즌에는 시작 위치 프리셋이 없습니다.')
      expect(html).not.toContain('<select')
      expect(html).not.toContain('실행 중')
    }
  })
})
