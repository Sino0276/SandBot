import { BufferGeometry } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { geometryIds, registerGeometry } from '../scene/geometryRegistry'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { useEditorStore } from './editorStore'
import {
  beginChange,
  clearHistory,
  collectGeometry,
  endChange,
  initHistory,
  redo,
  undo,
  useHistoryStore
} from './history'

const robot: SceneObjects = {
  r: {
    id: 'r',
    name: 'r',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  },
  p: {
    id: 'p',
    name: 'p',
    kind: 'part',
    parentId: 'r',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: 'g1', color: [0.5, 0.5, 0.5] }
  }
}

const x = (): number => useSceneStore.getState().objects.r.transform.position[0]
const move = (value: number): void =>
  useSceneStore.getState().setLocalTransform('r', { position: [value, 0, 0], rotation: [0, 0, 0] })

describe('실행 취소', () => {
  beforeEach(() => {
    initHistory()
    useSceneStore.getState().replaceObjects(robot)
    clearHistory()
  })

  it('변경을 한 단계씩 되돌리고 다시 실행한다', () => {
    move(1)
    move(2)
    expect(useHistoryStore.getState()).toEqual({ canUndo: true, canRedo: false })
    expect(undo()).toBe(true)
    expect(x()).toBe(1)
    expect(undo()).toBe(true)
    expect(x()).toBe(0)
    expect(undo()).toBe(false)
    expect(redo()).toBe(true)
    expect(x()).toBe(1)
    // 되돌린 뒤 새로 바꾸면 다시 실행 기록은 버린다
    move(5)
    expect(redo()).toBe(false)
    expect(useHistoryStore.getState().canRedo).toBe(false)
  })

  it('드래그처럼 묶은 변경은 한 단계다', () => {
    beginChange()
    for (const value of [0.1, 0.2, 0.3]) move(value)
    endChange()
    expect(undo()).toBe(true)
    expect(x()).toBe(0)
    expect(redo()).toBe(true)
    expect(x()).toBe(0.3)
  })

  it('지운 오브젝트를 되살리면 선택은 남기지 않은 채 형상도 그대로 있다', () => {
    registerGeometry('g1', new BufferGeometry())
    collectGeometry()
    useEditorStore.getState().select('p')
    useSceneStore.getState().removeObject('p')
    collectGeometry()
    // 기록에 남아 있으므로 형상을 해제하지 않는다
    expect(geometryIds()).toContain('g1')
    undo()
    expect(useSceneStore.getState().objects.p).toBeDefined()
    redo()
    expect(useEditorStore.getState().selectedId).toBeNull()
    // 기록을 버리면 더는 쓰지 않는 형상을 해제한다
    clearHistory()
    expect(geometryIds()).not.toContain('g1')
  })

  it('불러오는 중이라 아직 씬에 없는 형상은 해제하지 않는다', () => {
    registerGeometry('loading', new BufferGeometry())
    move(3)
    collectGeometry()
    expect(geometryIds()).toContain('loading')
  })
})
