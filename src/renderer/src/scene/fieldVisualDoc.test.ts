import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FIELD_DOC,
  DEFAULT_FIELD_VISUAL_ALIGNMENT,
  isFieldVisual,
  sameFieldDoc,
  sameFieldVisual,
  withFieldVisualFile,
  type FieldDoc,
  type FieldVisual
} from './fieldDoc'
import { useSceneStore } from './sceneStore'

// spec-4e §6 계약 시험 K1–K3: 필드 CAD 보기 설정(FieldDoc.visual)

const VISUAL: FieldVisual = {
  fileName: 'field.step',
  absolutePath: '/teams/field/field.step',
  upAxis: '+Y',
  forwardAxis: '+Z'
}

describe('K1 FieldDoc 비교·모양', () => {
  it('기본 정렬은 Y-up이고 DEFAULT_FIELD_DOC에는 visual 키가 없다', () => {
    expect(DEFAULT_FIELD_VISUAL_ALIGNMENT).toEqual({ upAxis: '+Y', forwardAxis: '+Z' })
    expect('visual' in DEFAULT_FIELD_DOC).toBe(false)
  })

  it('sameFieldDoc은 season과 visual 네 칸을 값으로 비교한다', () => {
    const a: FieldDoc = { season: 'biobuzz', visual: VISUAL }
    expect(sameFieldDoc(a, { season: 'biobuzz', visual: { ...VISUAL } })).toBe(true)
    expect(sameFieldDoc({ season: 'biobuzz' }, { season: 'biobuzz' })).toBe(true)
    expect(sameFieldDoc(a, { season: 'biobuzz' })).toBe(false)
    expect(sameFieldDoc({ season: 'biobuzz' }, a)).toBe(false)
    expect(sameFieldDoc(a, { season: 'none', visual: VISUAL })).toBe(false)
    for (const change of [
      { fileName: 'other.step' },
      { absolutePath: '/other/field.step' },
      { upAxis: '+Z' as const },
      { forwardAxis: '-Z' as const }
    ])
      expect(sameFieldDoc(a, { season: 'biobuzz', visual: { ...VISUAL, ...change } })).toBe(false)
    expect(sameFieldVisual(undefined, undefined)).toBe(true)
    expect(sameFieldVisual(VISUAL, undefined)).toBe(false)
  })

  it('isFieldVisual은 틀린 축·같은 글자 축·문자열 아닌 경로를 거부한다', () => {
    expect(isFieldVisual(VISUAL)).toBe(true)
    expect(isFieldVisual({ ...VISUAL, upAxis: 'Y' })).toBe(false)
    expect(isFieldVisual({ ...VISUAL, forwardAxis: '+W' })).toBe(false)
    expect(isFieldVisual({ ...VISUAL, upAxis: '+Y', forwardAxis: '-Y' })).toBe(false)
    expect(isFieldVisual({ ...VISUAL, absolutePath: 1 })).toBe(false)
    expect(isFieldVisual({ ...VISUAL, fileName: null })).toBe(false)
    expect(isFieldVisual(null)).toBe(false)
    expect(isFieldVisual('field.step')).toBe(false)
  })
})

describe('K2 withFieldVisualFile', () => {
  it('경로가 from이면 새 객체(정렬 그대로), 다르거나 visual이 없으면 같은 객체', () => {
    const field: FieldDoc = {
      season: 'biobuzz',
      visual: { ...VISUAL, upAxis: '+Z', forwardAxis: '-Y' }
    }
    const moved = withFieldVisualFile(field, VISUAL.absolutePath, '/new/f2.step', 'f2.step')
    expect(moved).not.toBe(field)
    expect(moved).toEqual({
      season: 'biobuzz',
      visual: { fileName: 'f2.step', absolutePath: '/new/f2.step', upAxis: '+Z', forwardAxis: '-Y' }
    })
    expect(field.visual?.absolutePath).toBe(VISUAL.absolutePath)
    expect(withFieldVisualFile(field, '/elsewhere.step', '/new/f2.step', 'f2.step')).toBe(field)
    const none: FieldDoc = { season: 'biobuzz' }
    expect(withFieldVisualFile(none, VISUAL.absolutePath, '/new/f2.step', 'f2.step')).toBe(none)
  })
})

describe('K3 sceneStore 필드 CAD 액션', () => {
  beforeEach(() => {
    useSceneStore.getState().replaceObjects({}, DEFAULT_FIELD_DOC)
  })

  it('setFieldSeason이 visual을 지킨다', () => {
    const { setFieldVisual, setFieldSeason } = useSceneStore.getState()
    setFieldVisual(VISUAL)
    setFieldSeason('none')
    expect(useSceneStore.getState().field).toEqual({ season: 'none', visual: VISUAL })
  })

  it('setFieldVisual: 같은 값·없는데 null·틀린 값이면 state 그대로, null이면 visual 키를 뺀다', () => {
    const start = useSceneStore.getState()
    start.setFieldVisual(null)
    expect(useSceneStore.getState()).toBe(start)
    start.setFieldVisual({ ...VISUAL, forwardAxis: '-Y' } as FieldVisual)
    expect(useSceneStore.getState()).toBe(start)
    start.setFieldVisual({ ...VISUAL, upAxis: 'up' } as unknown as FieldVisual)
    expect(useSceneStore.getState()).toBe(start)

    start.setFieldVisual(VISUAL)
    const set = useSceneStore.getState()
    expect(set.field).toEqual({ season: 'biobuzz', visual: VISUAL })
    expect(set.objects).toBe(start.objects)
    set.setFieldVisual({ ...VISUAL })
    expect(useSceneStore.getState()).toBe(set)

    set.setFieldVisual(null)
    const cleared = useSceneStore.getState().field
    expect('visual' in cleared).toBe(false)
    expect(cleared).toEqual({ season: 'biobuzz' })
  })

  it('setFieldVisualAlignment: visual 없음·같은 글자 축·같은 값이면 그대로', () => {
    const start = useSceneStore.getState()
    start.setFieldVisualAlignment({ upAxis: '+Z', forwardAxis: '-Y' })
    expect(useSceneStore.getState()).toBe(start)

    start.setFieldVisual(VISUAL)
    const set = useSceneStore.getState()
    set.setFieldVisualAlignment({ upAxis: '+Y', forwardAxis: '-Y' })
    expect(useSceneStore.getState()).toBe(set)
    set.setFieldVisualAlignment({ upAxis: '+Y', forwardAxis: '+Z' })
    expect(useSceneStore.getState()).toBe(set)

    set.setFieldVisualAlignment({ upAxis: '+Z', forwardAxis: '-Y' })
    expect(useSceneStore.getState().field).toEqual({
      season: 'biobuzz',
      visual: { ...VISUAL, upAxis: '+Z', forwardAxis: '-Y' }
    })
  })
})
