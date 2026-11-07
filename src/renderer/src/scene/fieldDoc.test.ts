import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_FIELD_DOC, fieldSeasonId, isSeasonString } from './fieldDoc'
import { useSceneStore } from './sceneStore'

// K11(spec-4ab §5): 씬 문서의 필드 칸

describe('fieldDoc', () => {
  it('기본 시즌은 BIOBUZZ이고 얼려 있다', () => {
    expect(DEFAULT_FIELD_DOC).toEqual({ season: 'biobuzz' })
    expect(Object.isFrozen(DEFAULT_FIELD_DOC)).toBe(true)
  })

  it('시즌 문자열 모양(1–64자, ^[a-z][A-Za-z0-9]*$)', () => {
    expect(isSeasonString('biobuzz')).toBe(true)
    expect(isSeasonString('decode2027')).toBe(true)
    expect(isSeasonString('a'.repeat(64))).toBe(true)
    expect(isSeasonString('a'.repeat(65))).toBe(false)
    expect(isSeasonString('')).toBe(false)
    expect(isSeasonString('Biobuzz')).toBe(false)
    expect(isSeasonString('bio-buzz')).toBe(false)
    expect(isSeasonString(1)).toBe(false)
  })

  it('알려진 시즌만 SeasonId', () => {
    expect(fieldSeasonId({ season: 'none' })).toBe('none')
    expect(fieldSeasonId({ season: 'decode2027' })).toBeNull()
  })
})

describe('sceneStore field', () => {
  beforeEach(() => {
    useSceneStore.getState().replaceObjects({}, DEFAULT_FIELD_DOC)
  })

  it('setFieldSeason: 같은 값·틀린 문자열은 state 그대로, 아니면 새 객체', () => {
    const before = useSceneStore.getState()
    before.setFieldSeason('biobuzz')
    expect(useSceneStore.getState()).toBe(before)
    before.setFieldSeason('Bad Season')
    expect(useSceneStore.getState()).toBe(before)
    before.setFieldSeason('decode2027')
    const after = useSceneStore.getState()
    expect(after.field).toEqual({ season: 'decode2027' })
    expect(after.field).not.toBe(before.field)
    expect(after.objects).toBe(before.objects)
  })

  it('replaceObjects(objects)는 field를 두고 replaceObjects(objects, field)는 바꾼다', () => {
    const { replaceObjects, setFieldSeason } = useSceneStore.getState()
    setFieldSeason('none')
    const field = useSceneStore.getState().field
    replaceObjects({})
    expect(useSceneStore.getState().field).toBe(field)
    replaceObjects({}, { season: 'biobuzz' })
    expect(useSceneStore.getState().field).toEqual({ season: 'biobuzz' })
  })
})
