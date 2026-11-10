import { BoxGeometry } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import type { FieldVisualStatusEntry } from '../project/projectStore'
import type { FieldVisual } from '../scene/fieldDoc'
import type { BuiltFieldVisual } from './fieldVisualModel'
import {
  clearLoadedFieldVisual,
  fieldCadReady,
  fieldVisualGroups,
  fieldVisualState,
  setLoadedFieldVisual,
  useFieldVisualStore,
  type FieldVisualInfo
} from './fieldVisualStore'

// spec-4e §6 계약 시험 K5·K6·K8

const PATH = '/teams/field/field.step'
const VISUAL: FieldVisual = {
  fileName: 'field.step',
  absolutePath: PATH,
  upAxis: '+Y',
  forwardAxis: '+Z'
}

function built(): BuiltFieldVisual {
  const geometry = new BoxGeometry(1, 1, 1)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return {
    groups: [
      {
        key: '1,1,1|0|0|0',
        color: [1, 1, 1],
        vertexColors: false,
        glass: false,
        decal: false,
        geometry
      }
    ],
    meshCount: 1,
    triangleCount: 12,
    glassMeshCount: 0,
    bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }
  }
}

function info(path: string): FieldVisualInfo {
  return {
    path,
    revision: 1,
    meshCount: 1,
    triangleCount: 12,
    glassMeshCount: 0,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] }
  }
}

const entry = (status: FieldVisualStatusEntry['status'], path = PATH): FieldVisualStatusEntry => ({
  path,
  status
})

afterEach(() => clearLoadedFieldVisual())

describe('K5 fieldVisualState', () => {
  it('여섯 단계', () => {
    const shown = info(PATH)
    expect(fieldVisualState(undefined, entry('loading'), shown)).toBe('none')
    expect(fieldVisualState(VISUAL, entry('loading'), shown)).toBe('loading')
    // 못 찾음은 그려져 있어도 보인다
    expect(fieldVisualState(VISUAL, entry('missing'), shown)).toBe('missing')
    expect(fieldVisualState(VISUAL, entry('missing'), null)).toBe('missing')
    // 그려져 있으면 실패·취소보다 먼저
    expect(fieldVisualState(VISUAL, entry('failed'), shown)).toBe('shown')
    expect(fieldVisualState(VISUAL, entry('cancelled'), shown)).toBe('shown')
    expect(fieldVisualState(VISUAL, null, shown)).toBe('shown')
    expect(fieldVisualState(VISUAL, entry('failed'), null)).toBe('failed')
    expect(fieldVisualState(VISUAL, entry('cancelled'), null)).toBe('cancelled')
    expect(fieldVisualState(VISUAL, null, null)).toBe('unloaded')
    // 다른 파일의 형상은 이 visual의 것이 아니다
    expect(fieldVisualState(VISUAL, null, info('/other.step'))).toBe('unloaded')
  })

  it('다른 경로의 상태는 무시한다(지우기 → 다른 파일 → 되살림)', () => {
    for (const status of ['loading', 'missing', 'failed', 'cancelled'] as const) {
      expect(fieldVisualState(VISUAL, entry(status, '/other.step'), null)).toBe('unloaded')
      expect(fieldVisualState(VISUAL, entry(status, '/other.step'), info(PATH))).toBe('shown')
    }
  })

  it('fieldCadReady는 상태와 관계없이 경로만 본다', () => {
    expect(fieldCadReady(VISUAL, info(PATH))).toBe(true)
    expect(fieldCadReady(VISUAL, info('/other.step'))).toBe(false)
    expect(fieldCadReady(VISUAL, null)).toBe(false)
    expect(fieldCadReady(undefined, info(PATH))).toBe(false)
  })
})

describe('K6 fieldVisualStore', () => {
  it('바꿔 끼우면 revision이 오르고 set 뒤에 이전 형상을 해제한다', () => {
    const first = built()
    setLoadedFieldVisual(PATH, first)
    const loaded1 = useFieldVisualStore.getState().loaded
    expect(loaded1).toMatchObject({
      path: PATH,
      meshCount: 1,
      triangleCount: 12,
      glassMeshCount: 0
    })
    expect(fieldVisualGroups()).toBe(first.groups)

    const second = built()
    const seen: (FieldVisualInfo | null)[] = []
    const dispose = vi
      .spyOn(first.groups[0].geometry, 'dispose')
      .mockImplementation(() => seen.push(useFieldVisualStore.getState().loaded))
    // 같은 경로로 다시 넣어도 이전 것을 해제한다
    setLoadedFieldVisual(PATH, second)
    const loaded2 = useFieldVisualStore.getState().loaded
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([loaded2])
    expect(loaded2?.revision).toBe((loaded1?.revision ?? 0) + 1)
    expect(fieldVisualGroups()).toBe(second.groups)
  })

  it('clearLoadedFieldVisual도 loaded null 뒤에 해제한다', () => {
    const one = built()
    setLoadedFieldVisual(PATH, one)
    const seen: (FieldVisualInfo | null)[] = []
    vi.spyOn(one.groups[0].geometry, 'dispose').mockImplementation(() =>
      seen.push(useFieldVisualStore.getState().loaded)
    )
    clearLoadedFieldVisual()
    expect(seen).toEqual([null])
    expect(useFieldVisualStore.getState().loaded).toBeNull()
    expect(fieldVisualGroups()).toEqual([])
  })
})

describe('K8 i18n', () => {
  it('알림의 버튼 이름이 그 버튼 글자와 같다', () => {
    expect(en.notice.fieldCadMissing).toContain(en.inspector.cad.relink)
    expect(ko.notice.fieldCadMissing).toContain(ko.inspector.cad.relink)
  })

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
    for (const locale of [ko, en]) {
      for (const key of keys) expect(locale.field.inspector.cad[key]).toBeTruthy()
      expect(locale.field.inspector.showElementsCadHint).toBeTruthy()
      expect(locale.notice.fieldCadDropped).toBeTruthy()
      expect(locale.field.inspector.cad.stats).toMatch(
        /\{\{meshes\}\}.*\{\{triangles\}\}.*\{\{glass\}\}/
      )
      expect(locale.field.inspector.cad.bounds).toMatch(/\{\{x\}\}.*\{\{y\}\}.*\{\{z\}\}/)
      expect(locale.notice.fieldCadMissing).toContain('{{fileName}}')
    }
  })
})
