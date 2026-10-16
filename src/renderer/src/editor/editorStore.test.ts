import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editorStore'

const state = (): ReturnType<typeof useEditorStore.getState> => useEditorStore.getState()
const selection = (): { active: string | null; ids: readonly string[] } => ({
  active: state().selectedId,
  ids: state().selectedIds
})

// 보이는 행 순서
const ROWS = ['a', 'b', 'c', 'd', 'e']

describe('다중 선택(Unity 방식)', () => {
  beforeEach(() => {
    state().select(null)
    state().setRenaming(null)
  })

  it('클릭은 하나만 선택하고 활성 오브젝트로 삼는다', () => {
    state().select('b')
    expect(selection()).toEqual({ active: 'b', ids: ['b'] })
    state().select(null)
    expect(selection()).toEqual({ active: null, ids: [] })
  })

  it('Ctrl+클릭은 넣거나 빼고, 활성 오브젝트를 빼면 남은 것 중 마지막이 활성이 된다', () => {
    state().select('a')
    state().toggleSelect('c')
    state().toggleSelect('e')
    expect(selection()).toEqual({ active: 'e', ids: ['a', 'c', 'e'] })
    state().toggleSelect('a')
    expect(selection()).toEqual({ active: 'e', ids: ['c', 'e'] })
    state().toggleSelect('e')
    expect(selection()).toEqual({ active: 'c', ids: ['c'] })
    state().toggleSelect('c')
    expect(selection()).toEqual({ active: null, ids: [] })
  })

  it('Shift+클릭은 시작점부터 보이는 행 순서로 범위를 고르고, 시작점은 그대로 둔다', () => {
    state().select('b')
    state().selectRange('d', ROWS)
    expect(selection()).toEqual({ active: 'd', ids: ['b', 'c', 'd'] })
    // 다시 Shift+클릭하면 처음 시작점(b)부터 다시 고른다
    state().selectRange('a', ROWS)
    expect(selection()).toEqual({ active: 'a', ids: ['a', 'b'] })
    // 시작점이 보이지 않으면 하나만 고른다
    state().selectRange('c', ['c', 'd'])
    expect(selection()).toEqual({ active: 'c', ids: ['c'] })
  })

  it('setSelection은 활성 오브젝트가 없으면 마지막을 활성으로 한다', () => {
    state().setSelection(['a', 'c', 'a'], 'c')
    expect(selection()).toEqual({ active: 'c', ids: ['a', 'c'] })
    state().setSelection(['d', 'b'])
    expect(selection()).toEqual({ active: 'b', ids: ['d', 'b'] })
  })

  it('없어진 오브젝트를 선택과 이름 바꾸기에서 뺀다', () => {
    state().setSelection(['a', 'b', 'c'], 'b')
    state().setRenaming('b')
    state().pruneSelection((id) => id !== 'b')
    expect(selection()).toEqual({ active: 'c', ids: ['a', 'c'] })
    expect(state().renamingId).toBeNull()
    const before = state()
    state().pruneSelection(() => true)
    expect(state()).toBe(before)
  })

  it('활성 오브젝트가 바뀌면 이름 바꾸기를 끝낸다', () => {
    state().select('a')
    state().setRenaming('a')
    state().toggleSelect('b')
    expect(state().renamingId).toBeNull()
    state().setRenaming('b')
    state().select('b')
    expect(state().renamingId).toBe('b')
  })
})

describe('카메라 포커스 요청', () => {
  beforeEach(() => {
    state().select(null)
    useEditorStore.setState({ focusRequest: null })
  })

  it('focus(id)는 그 오브젝트 하나, 같은 대상도 매번 새 요청이다', () => {
    state().focus('a')
    const first = state().focusRequest
    expect(first).toEqual({ ids: ['a'] })
    state().focus('a')
    expect(state().focusRequest).not.toBe(first)
  })

  it('focusSelection은 선택 전체를 맞추고, 선택이 없으면 요청하지 않는다', () => {
    state().focusSelection()
    expect(state().focusRequest).toBeNull()
    state().setSelection(['a', 'b', 'c'], 'b')
    state().focusSelection()
    expect(state().focusRequest).toEqual({ ids: ['a', 'b', 'c'] })
  })
})
