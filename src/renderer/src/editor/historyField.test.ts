import { beforeEach, describe, expect, it } from 'vitest'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import {
  beginChange,
  clearHistory,
  endChange,
  initHistory,
  redo,
  undo,
  useHistoryStore
} from './history'

// spec-4ab §2.2 B5: 시즌 고르기는 실행 취소 한 단계이고 씬 편집과 같은 기록이다

const robot: SceneObjects = {
  r: {
    id: 'r',
    name: 'r',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  }
}

const x = (): number => useSceneStore.getState().objects.r.transform.position[0]
const move = (value: number): void =>
  useSceneStore.getState().setLocalTransform('r', { position: [value, 0, 0], rotation: [0, 0, 0] })
const season = (): string => useSceneStore.getState().field.season

describe('실행 취소: 필드 시즌', () => {
  beforeEach(() => {
    initHistory()
    useSceneStore.getState().replaceObjects(robot, { season: 'biobuzz' })
    clearHistory()
  })

  it('시즌 바꾸기가 한 단계이고 undo·redo로 돌아온다', () => {
    useSceneStore.getState().setFieldSeason('none')
    expect(season()).toBe('none')
    expect(useHistoryStore.getState()).toEqual({ canUndo: true, canRedo: false })
    const objects = useSceneStore.getState().objects
    expect(undo()).toBe(true)
    expect(season()).toBe('biobuzz')
    // 시즌만 바꾼 단계는 objects를 바꾸지 않는다(같은 참조)
    expect(useSceneStore.getState().objects).toBe(objects)
    expect(undo()).toBe(false)
    expect(redo()).toBe(true)
    expect(season()).toBe('none')
    expect(redo()).toBe(false)
  })

  it('같은 값·틀린 문자열은 단계를 만들지 않는다', () => {
    useSceneStore.getState().setFieldSeason('biobuzz')
    useSceneStore.getState().setFieldSeason('Not A Season')
    expect(useHistoryStore.getState().canUndo).toBe(false)
  })

  it('씬 편집과 시즌 고르기가 고친 순서대로 되돌아간다', () => {
    move(1)
    useSceneStore.getState().setFieldSeason('none')
    move(2)
    expect(undo()).toBe(true)
    expect([x(), season()]).toEqual([1, 'none'])
    expect(undo()).toBe(true)
    expect([x(), season()]).toEqual([1, 'biobuzz'])
    expect(undo()).toBe(true)
    expect([x(), season()]).toEqual([0, 'biobuzz'])
  })

  it('묶음(핸들 드래그) 안에서 시즌만 바꿔도 한 단계로 기록한다', () => {
    beginChange()
    useSceneStore.getState().setFieldSeason('none')
    endChange()
    expect(useHistoryStore.getState().canUndo).toBe(true)
    expect(undo()).toBe(true)
    expect(season()).toBe('biobuzz')
  })
})
