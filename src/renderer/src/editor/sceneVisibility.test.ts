import { beforeEach, describe, expect, it } from 'vitest'
import type { SceneObject, SceneObjects } from '../scene/model'
import {
  exitIsolation,
  isHiddenInScene,
  resetSceneVisibility,
  rowVisibilities,
  toggleIsolation,
  toggleRowVisibility,
  toggleSelectionVisibility,
  useSceneVisibilityStore
} from './sceneVisibility'

function node(id: string, parentId: string | null): SceneObject {
  return {
    id,
    name: id,
    kind: parentId === null ? 'robot' : 'part',
    parentId,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  }
}

// robot ─ cad ─ a, b
//       └ c
const SCENE: SceneObjects = {
  robot: node('robot', null),
  cad: node('cad', 'robot'),
  a: node('a', 'cad'),
  b: node('b', 'cad'),
  c: node('c', 'robot')
}

const hidden = (): string[] => [...useSceneVisibilityStore.getState().hidden].sort()
const shownInScene = (): string[] =>
  Object.keys(SCENE).filter((id) => !isHiddenInScene(useSceneVisibilityStore.getState(), SCENE, id))

beforeEach(resetSceneVisibility)

describe('눈 아이콘(Unity Scene Visibility)', () => {
  it('클릭은 하위 전체에 같은 값을 두고, Alt+클릭은 그 오브젝트만', () => {
    toggleRowVisibility(SCENE, 'cad', false)
    expect(hidden()).toEqual(['a', 'b', 'cad'])
    expect(shownInScene()).toEqual(['robot', 'c'])
    toggleRowVisibility(SCENE, 'a', true)
    expect(hidden()).toEqual(['b', 'cad'])
    toggleRowVisibility(SCENE, 'cad', false)
    expect(hidden()).toEqual([])
  })

  it('행 표시: 숨김, 일부 숨김(자신은 보이고 하위 중 숨긴 것이 있음), 나머지는 보임(표에 없음)', () => {
    toggleRowVisibility(SCENE, 'a', true)
    const rows = rowVisibilities(SCENE, useSceneVisibilityStore.getState().hidden)
    expect(Object.fromEntries(rows)).toEqual({ a: 'hidden', cad: 'mixed', robot: 'mixed' })
    // 같은 문서·같은 숨김이면 다시 계산하지 않는다
    expect(rowVisibilities(SCENE, useSceneVisibilityStore.getState().hidden)).toBe(rows)
  })

  it('H: 선택이 모두 보이면 숨기고, 하나라도 숨겼으면 모두 보인다', () => {
    toggleRowVisibility(SCENE, 'a', true)
    expect(toggleSelectionVisibility(SCENE, ['a', 'c'])).toBe(true)
    expect(hidden()).toEqual([])
    toggleSelectionVisibility(SCENE, ['a', 'c'])
    expect(hidden()).toEqual(['a', 'c'])
    expect(toggleSelectionVisibility(SCENE, ['missing'])).toBe(false)
  })
})

describe('고립 보기(Shift+H)', () => {
  it('선택과 그 하위만 보이고, 다시 누르면 나간다', () => {
    expect(toggleIsolation(SCENE, ['cad'])).toBe(true)
    expect(shownInScene()).toEqual(['cad', 'a', 'b'])
    // 고립 중에도 숨긴 것은 숨긴다
    toggleRowVisibility(SCENE, 'b', true)
    expect(shownInScene()).toEqual(['cad', 'a'])
    expect(toggleIsolation(SCENE, [])).toBe(true)
    expect(useSceneVisibilityStore.getState().isolated).toBeNull()
    expect(toggleIsolation(SCENE, [])).toBe(false)
    toggleIsolation(SCENE, ['c'])
    exitIsolation()
    expect(shownInScene()).toEqual(['robot', 'cad', 'a', 'c'])
  })
})
