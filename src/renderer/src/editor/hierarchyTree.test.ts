import { beforeEach, describe, expect, it } from 'vitest'
import type { SceneObject, SceneObjects } from '../scene/model'
import {
  revealObjects,
  selectionSet,
  treeKeyAction,
  useHierarchyViewStore,
  visibleRows
} from './hierarchyTree'

function node(id: string, kind: SceneObject['kind'], parentId: string | null): SceneObject {
  return {
    id,
    name: id,
    kind,
    parentId,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  }
}

// robot ─ cad ─ asm ─ part
//       └ group
// other
const SCENE: SceneObjects = {
  robot: node('robot', 'robot', null),
  cad: node('cad', 'assembly', 'robot'),
  asm: node('asm', 'assembly', 'cad'),
  part: node('part', 'part', 'asm'),
  group: node('group', 'group', 'robot'),
  other: node('other', 'robot', null)
}

const ids = (rows: { id: string }[]): string[] => rows.map((row) => row.id)

describe('visibleRows', () => {
  it('기본으로 깊이 2 미만만 펼치고 화면 순서로 나열한다', () => {
    const rows = visibleRows(SCENE, {})
    expect(ids(rows)).toEqual(['robot', 'cad', 'asm', 'group', 'other'])
    expect(rows.find((row) => row.id === 'asm')).toMatchObject({
      depth: 2,
      parentId: 'cad',
      hasChildren: true,
      open: false,
      posInSet: 1,
      setSize: 1
    })
    expect(rows.find((row) => row.id === 'group')).toMatchObject({ posInSet: 2, setSize: 2 })
    expect(rows.find((row) => row.id === 'other')).toMatchObject({
      hasChildren: false,
      open: false
    })
  })

  it('사용자가 펴거나 접은 행을 따른다', () => {
    expect(ids(visibleRows(SCENE, { asm: true }))).toEqual([
      'robot',
      'cad',
      'asm',
      'part',
      'group',
      'other'
    ])
    expect(ids(visibleRows(SCENE, { robot: false }))).toEqual(['robot', 'other'])
  })

  it('부모 순환이 있어도 끝난다', () => {
    const cyclic: SceneObjects = { a: node('a', 'group', 'b'), b: node('b', 'group', 'a') }
    expect(visibleRows(cyclic, {})).toEqual([])
  })
})

describe('treeKeyAction', () => {
  const rows = visibleRows(SCENE, {})

  it('위/아래·Home/End는 보이는 행으로 선택을 옮기고 Shift는 범위를 늘린다', () => {
    expect(treeKeyAction(rows, 'cad', 'ArrowDown', false)).toEqual({
      type: 'select',
      id: 'asm',
      extend: false
    })
    expect(treeKeyAction(rows, 'cad', 'ArrowUp', true)).toEqual({
      type: 'select',
      id: 'robot',
      extend: true
    })
    expect(treeKeyAction(rows, 'other', 'ArrowDown', false)).toBeNull()
    expect(treeKeyAction(rows, null, 'ArrowDown', false)).toMatchObject({ id: 'robot' })
    expect(treeKeyAction(rows, 'cad', 'End', false)).toMatchObject({ id: 'other' })
    expect(treeKeyAction(rows, 'cad', 'Home', false)).toMatchObject({ id: 'robot' })
  })

  it('오른쪽은 접힌 행을 펴고, 펴진 행이면 첫 자식으로 간다', () => {
    expect(treeKeyAction(rows, 'asm', 'ArrowRight', false)).toEqual({
      type: 'setOpen',
      id: 'asm',
      open: true
    })
    expect(treeKeyAction(rows, 'cad', 'ArrowRight', false)).toEqual({
      type: 'select',
      id: 'asm',
      extend: false
    })
    expect(treeKeyAction(rows, 'group', 'ArrowRight', false)).toBeNull()
  })

  it('왼쪽은 펴진 행을 접고, 접혔거나 자식이 없으면 부모로 간다', () => {
    expect(treeKeyAction(rows, 'cad', 'ArrowLeft', false)).toEqual({
      type: 'setOpen',
      id: 'cad',
      open: false
    })
    expect(treeKeyAction(rows, 'asm', 'ArrowLeft', false)).toEqual({
      type: 'select',
      id: 'cad',
      extend: false
    })
    expect(treeKeyAction(rows, 'other', 'ArrowLeft', false)).toBeNull()
  })

  it('다른 키는 처리하지 않는다', () => {
    expect(treeKeyAction(rows, 'cad', 'Enter', false)).toBeNull()
    expect(treeKeyAction([], 'cad', 'ArrowDown', false)).toBeNull()
  })
})

describe('펼침 상태', () => {
  beforeEach(() => {
    useHierarchyViewStore.setState({ overrides: {} })
  })

  it('revealObjects는 상위 행을 모두 펼친다', () => {
    revealObjects(SCENE, ['part', 'missing'])
    expect(useHierarchyViewStore.getState().overrides).toEqual({
      asm: true,
      cad: true,
      robot: true
    })
    expect(ids(visibleRows(SCENE, useHierarchyViewStore.getState().overrides))).toContain('part')
  })

  it('바뀐 것이 없으면 상태를 바꾸지 않는다', () => {
    useHierarchyViewStore.getState().setOpen(['cad'], false)
    const overrides = useHierarchyViewStore.getState().overrides
    useHierarchyViewStore.getState().setOpen(['cad'], false)
    expect(useHierarchyViewStore.getState().overrides).toBe(overrides)
  })
})

describe('selectionSet', () => {
  it('같은 선택 배열이면 같은 집합을 돌려준다', () => {
    const selected = ['a', 'b']
    expect(selectionSet(selected)).toBe(selectionSet(selected))
    expect(selectionSet(selected).has('b')).toBe(true)
  })
})
