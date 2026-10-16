import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneObject, SceneObjects, Vec3 } from '../scene/model'
import {
  createHoverExpander,
  draggedIdsFor,
  dropPosition,
  evaluateEmptySpaceDrop,
  evaluateRowDrop,
  resolveDrop,
  resolveEmptySpaceDrop,
  setDropIndicator,
  useHierarchyDragStore
} from './hierarchyDnd'

const BOUNDS: { min: Vec3; max: Vec3 } = { min: [-0.1, 0, -0.1], max: [0.1, 0.2, 0.1] }

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

const cad: SceneObject['cad'] = {
  fileName: 'a.step',
  absolutePath: '/cad/a.step',
  upAxis: '+Y',
  forwardAxis: '+Z',
  bounds: BOUNDS,
  meshCount: 2,
  meshIndexing: 'source'
}

// robotA ─ cadA(CAD 루트) ─ partA1, partA2
//        └ groupG
// robotB ─ partB1
const SCENE: SceneObjects = {
  robotA: node('robotA', 'robot', null),
  cadA: node('cadA', 'assembly', 'robotA', { cad }),
  partA1: node('partA1', 'part', 'cadA'),
  partA2: node('partA2', 'part', 'cadA'),
  groupG: node('groupG', 'group', 'robotA'),
  robotB: node('robotB', 'robot', null),
  partB1: node('partB1', 'part', 'robotB')
}

const ROW = 24

describe('dropPosition', () => {
  it('자식을 받을 수 있으면 위·아래 25%는 형제 사이, 가운데는 자식이다', () => {
    expect(dropPosition(0, ROW, true)).toBe('before')
    expect(dropPosition(5.9, ROW, true)).toBe('before')
    expect(dropPosition(6, ROW, true)).toBe('into')
    expect(dropPosition(17.9, ROW, true)).toBe('into')
    expect(dropPosition(18, ROW, true)).toBe('after')
    expect(dropPosition(23.9, ROW, true)).toBe('after')
  })

  it('자식을 받을 수 없으면 반으로 나눈다', () => {
    expect(dropPosition(11.9, ROW, false)).toBe('before')
    expect(dropPosition(12, ROW, false)).toBe('after')
  })
})

describe('resolveDrop', () => {
  it('앞·뒤는 그 행의 형제 자리, 자식은 마지막이다', () => {
    expect(resolveDrop(SCENE, ['groupG'], 'partA2', 'before')).toEqual({
      parentId: 'cadA',
      beforeId: 'partA2'
    })
    expect(resolveDrop(SCENE, ['groupG'], 'partA1', 'after')).toEqual({
      parentId: 'cadA',
      beforeId: 'partA2'
    })
    expect(resolveDrop(SCENE, ['groupG'], 'partA2', 'after')).toEqual({
      parentId: 'cadA',
      beforeId: null
    })
    expect(resolveDrop(SCENE, ['partA1'], 'groupG', 'into')).toEqual({
      parentId: 'groupG',
      beforeId: null
    })
  })

  it('기준 형제가 끄는 오브젝트면 그다음 형제 앞에 넣는다', () => {
    expect(resolveDrop(SCENE, ['partA2'], 'partA1', 'after')).toEqual({
      parentId: 'cadA',
      beforeId: null
    })
    expect(resolveDrop(SCENE, ['partA1', 'partA2'], 'partA1', 'before')).toEqual({
      parentId: 'cadA',
      beforeId: null
    })
  })

  it('펼친 부모의 뒤는 첫 자식 앞이고, 접힌 부모의 뒤는 다음 형제 앞이다', () => {
    expect(resolveDrop(SCENE, ['groupG'], 'cadA', 'after', true)).toEqual({
      parentId: 'cadA',
      beforeId: 'partA1'
    })
    expect(resolveDrop(SCENE, ['partA1'], 'cadA', 'after', true)).toEqual({
      parentId: 'cadA',
      beforeId: 'partA2'
    })
    expect(resolveDrop(SCENE, ['partA1'], 'cadA', 'after', false)).toEqual({
      parentId: 'robotA',
      beforeId: 'groupG'
    })
  })

  it('없는 행이면 null', () => {
    expect(resolveDrop(SCENE, ['partA1'], 'missing', 'into')).toBeNull()
  })
})

describe('빈 공간에 놓기', () => {
  it('같은 로봇의 오브젝트는 그 로봇의 마지막 자식이 된다', () => {
    expect(resolveEmptySpaceDrop(SCENE, ['partA1', 'groupG'])).toEqual({
      parentId: 'robotA',
      beforeId: null
    })
    expect(evaluateEmptySpaceDrop(SCENE, ['partA1', 'groupG'])).toEqual({
      parentId: 'robotA',
      beforeId: null
    })
  })

  it('로봇은 최상위 마지막으로 가고, 하위가 함께 선택되어도 같다', () => {
    expect(resolveEmptySpaceDrop(SCENE, ['robotA', 'partA1'])).toEqual({
      parentId: null,
      beforeId: null
    })
  })

  it('여러 로봇에 걸치면 놓을 수 없다', () => {
    expect(resolveEmptySpaceDrop(SCENE, ['partA1', 'partB1'])).toBeNull()
    expect(resolveEmptySpaceDrop(SCENE, ['robotA', 'partB1'])).toBeNull()
    expect(resolveEmptySpaceDrop(SCENE, [])).toBeNull()
  })

  it('CAD 루트는 지금 부모(로봇) 안에서 마지막으로 옮길 수 있다', () => {
    expect(evaluateEmptySpaceDrop(SCENE, ['cadA'])).toEqual({ parentId: 'robotA', beforeId: null })
  })
})

describe('evaluateRowDrop', () => {
  it('그룹 가운데에 놓으면 자식이 된다', () => {
    expect(evaluateRowDrop(SCENE, ['partA1'], 'groupG', 12, ROW, false)).toEqual({
      position: 'into',
      parentId: 'groupG',
      beforeId: null
    })
  })

  it('다른 로봇으로는 옮길 수 없다', () => {
    for (const offset of [2, 12, 22])
      expect(evaluateRowDrop(SCENE, ['partA1'], 'partB1', offset, ROW, false)).toBeNull()
  })

  it('로봇 행은 자식을 받지 않으므로 반으로 나눠 최상위 순서만 바꾼다', () => {
    expect(evaluateRowDrop(SCENE, ['robotB'], 'robotA', 11, ROW, true)).toEqual({
      position: 'before',
      parentId: null,
      beforeId: 'robotA'
    })
    // 펼친 로봇의 아래 절반도 첫 자식 앞이 아니라 그 로봇의 뒤다
    expect(evaluateRowDrop(SCENE, ['robotB'], 'robotA', 13, ROW, true)).toEqual({
      position: 'after',
      parentId: null,
      beforeId: null
    })
  })

  it('CAD 루트는 다른 부모 안으로 넣을 수 없고 형제 사이로는 옮길 수 있다', () => {
    expect(evaluateRowDrop(SCENE, ['cadA'], 'groupG', 2, ROW, false)).toEqual({
      position: 'before',
      parentId: 'robotA',
      beforeId: 'groupG'
    })
    expect(evaluateRowDrop(SCENE, ['cadA'], 'groupG', 13, ROW, false)?.position).toBe('after')
    expect(evaluateRowDrop(SCENE, ['cadA'], 'partA1', 12, ROW, false)).toBeNull()
  })

  it('자기 자신이나 하위로는 놓을 수 없다', () => {
    expect(evaluateRowDrop(SCENE, ['cadA'], 'cadA', 12, ROW, true)).toBeNull()
    expect(evaluateRowDrop(SCENE, ['cadA'], 'partA1', 2, ROW, false)).toBeNull()
  })
})

describe('draggedIdsFor', () => {
  const visible = ['robotA', 'cadA', 'partA1', 'partA2', 'groupG']

  it('선택한 행을 끌면 선택 전체를 보이는 순서로 끈다', () => {
    expect(draggedIdsFor('partA1', ['groupG', 'partA1', 'hidden'], visible)).toEqual([
      'partA1',
      'groupG',
      'hidden'
    ])
  })

  it('선택하지 않은 행을 끌면 그 행만 끈다', () => {
    expect(draggedIdsFor('partA2', ['groupG', 'partA1'], visible)).toEqual(['partA2'])
  })
})

describe('드롭 표시', () => {
  it('같은 표시면 스토어를 바꾸지 않는다(행이 다시 그려지지 않게)', () => {
    setDropIndicator({ id: 'a', position: 'into', nested: false })
    const first = useHierarchyDragStore.getState().indicator
    setDropIndicator({ id: 'a', position: 'into', nested: false })
    expect(useHierarchyDragStore.getState().indicator).toBe(first)
    setDropIndicator({ id: 'a', position: 'after', nested: true })
    expect(useHierarchyDragStore.getState().indicator).toEqual({
      id: 'a',
      position: 'after',
      nested: true
    })
    setDropIndicator(null)
    expect(useHierarchyDragStore.getState().indicator).toBeNull()
  })
})

describe('createHoverExpander', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('같은 행 위에 delay만큼 머물면 펼치고, 다른 행으로 옮기거나 취소하면 펼치지 않는다', () => {
    vi.useFakeTimers()
    const expand = vi.fn()
    const expander = createHoverExpander(600, expand)
    expander.hover('a')
    vi.advanceTimersByTime(400)
    // 같은 행 위의 dragover가 계속 와도 타이머를 다시 시작하지 않는다
    expander.hover('a')
    vi.advanceTimersByTime(200)
    expect(expand).toHaveBeenCalledWith('a')
    expander.hover('b')
    vi.advanceTimersByTime(500)
    expander.hover('c')
    vi.advanceTimersByTime(500)
    expander.cancel()
    vi.advanceTimersByTime(1000)
    expect(expand).toHaveBeenCalledTimes(1)
  })
})
