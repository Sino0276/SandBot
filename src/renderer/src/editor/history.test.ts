import { BufferGeometry } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { geometryIds, registerGeometry } from '../scene/geometryRegistry'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { useEditorStore } from './editorStore'
import { withCadFile } from '../scene/sceneStore'
import {
  beginChange,
  clearHistory,
  collectGeometry,
  endChange,
  initHistory,
  isChangeOpen,
  redo,
  resumeHistory,
  rewriteHistory,
  suspendHistory,
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

  it('프로젝트를 여는 동안에는 기록하지 않고 실행 취소도 막는다', () => {
    move(1)
    suspendHistory()
    expect(useHistoryStore.getState().canUndo).toBe(false)
    move(2)
    expect(undo()).toBe(false)
    expect(x()).toBe(2)
    resumeHistory()
    // 여는 동안의 변경(2)은 기록되지 않았으므로 되돌리면 그 전(0)으로 간다
    expect(undo()).toBe(true)
    expect(x()).toBe(0)
  })

  it('기록 전체 고치기: 되돌려도 다시 찾은 CAD 경로가 유지된다', () => {
    useSceneStore.getState().replaceObjects({
      ...robot,
      c: {
        id: 'c',
        name: 'c',
        kind: 'assembly',
        parentId: 'r',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        cad: {
          fileName: 'old.step',
          absolutePath: '/gone/old.step',
          upAxis: '+Y',
          forwardAxis: '+Z',
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          meshCount: 1
        }
      }
    })
    clearHistory()
    move(1)
    rewriteHistory((objects) => withCadFile(objects, 'c', '/new/new.step', 'new.step'))
    // 다시 찾기는 실행 취소 단계가 아니다: 한 번 되돌리면 이동만 되돌아간다
    expect(undo()).toBe(true)
    expect(x()).toBe(0)
    expect(useSceneStore.getState().objects.c.cad?.absolutePath).toBe('/new/new.step')
    expect(undo()).toBe(false)
  })

  it('부모 바꾸기·정렬 변경은 각각 한 단계이고, 되돌리면 사라진 오브젝트만 다중 선택에서 뺀다', () => {
    const cadScene: SceneObjects = {
      ...robot,
      c: {
        id: 'c',
        name: 'c',
        kind: 'assembly',
        parentId: 'r',
        transform: { position: [0, 0, 0.1], rotation: [Math.PI / 2, 0, Math.PI / 2] },
        cad: {
          fileName: 'robot.step',
          absolutePath: '/cad/robot.step',
          upAxis: '+Y',
          forwardAxis: '+Z',
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          meshCount: 1,
          meshIndexing: 'source'
        }
      },
      q: {
        id: 'q',
        name: 'q',
        kind: 'part',
        parentId: 'c',
        transform: { position: [0.1, 0, 0], rotation: [0, 0, 0] },
        visual: { type: 'mesh', geometryId: 'c:0', color: [0.5, 0.5, 0.5] }
      }
    }
    useSceneStore.getState().replaceObjects(cadScene)
    clearHistory()
    const scene = useSceneStore.getState()
    const groupId = scene.createGroup({ parentId: 'r', id: 'g' })
    expect(groupId).toBe('g')
    expect(useSceneStore.getState().moveObjects(['q', 'p'], 'g')).toBe(true)
    const moved = useSceneStore.getState().objects
    useSceneStore.getState().setCadAlignment('c', { upAxis: '+Z', forwardAxis: '-Y' })
    // 정렬 변경과 옮긴 파트가 따라간 것이 한 단계다
    expect(useSceneStore.getState().objects.q).not.toBe(moved.q)
    expect(undo()).toBe(true)
    expect(useSceneStore.getState().objects).toBe(moved)

    useEditorStore.getState().setSelection(['p', 'g', 'q'], 'g')
    useEditorStore.getState().setRenaming('g')
    // 옮기기를 되돌린다(그룹은 남는다)
    expect(undo()).toBe(true)
    expect(useSceneStore.getState().objects.q.parentId).toBe('c')
    expect(useEditorStore.getState().selectedIds).toEqual(['p', 'g', 'q'])
    // 그룹 만들기를 되돌리면 그룹만 선택에서 빠지고 남은 것 중 마지막이 활성이 된다
    expect(undo()).toBe(true)
    expect(useSceneStore.getState().objects).toBe(cadScene)
    expect(useEditorStore.getState().selectedIds).toEqual(['p', 'q'])
    expect(useEditorStore.getState().selectedId).toBe('q')
    expect(useEditorStore.getState().renamingId).toBeNull()
    expect(undo()).toBe(false)
  })

  it('드래그 묶음이 열려 있는지 알 수 있다', () => {
    expect(isChangeOpen()).toBe(false)
    beginChange()
    expect(isChangeOpen()).toBe(true)
    endChange()
    expect(isChangeOpen()).toBe(false)
  })
})
