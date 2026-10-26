import { beforeEach, describe, expect, it } from 'vitest'
import { moveObjects } from '../scene/hierarchy'
import { childrenInDocument, type SceneObject, type SceneObjects, type Vec3 } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { useDialogStore } from './dialogStore'
import { useEditorStore } from './editorStore'
import { useHierarchyViewStore } from './hierarchyTree'
import { beginChange, endChange } from './history'
import {
  createEmpty,
  createEmptyChild,
  createEmptyParent,
  createEmptyUnder,
  defaultParentId,
  deletePlan,
  deleteSelection,
  cutSelection,
  hierarchyMenuState,
  pasteCut,
  pasteTarget,
  renameSelection,
  selectAll,
  selectChildren,
  toggleSelectedIsolation,
  toggleSelectedVisibility
} from './sceneCommands'
import { useNoticeStore } from './noticeStore'
import { resetSceneVisibility, useSceneVisibilityStore } from './sceneVisibility'

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

const motor = (id: string): NonNullable<SceneObject['components']>[number] => ({
  id,
  type: 'motor',
  name: id,
  hub: 'controlHub',
  port: 0,
  props: {}
})

// robotA ─ cadA(CAD 루트) ─ partA1(모터), partA2
//        └ groupG
// robotB ─ partB1
const SCENE: SceneObjects = {
  robotA: node('robotA', 'robot', null),
  cadA: node('cadA', 'assembly', 'robotA', {
    cad: {
      fileName: 'a.step',
      absolutePath: '/cad/a.step',
      upAxis: '+Y',
      forwardAxis: '+Z',
      bounds: BOUNDS,
      meshCount: 2,
      meshIndexing: 'source'
    }
  }),
  partA1: node('partA1', 'part', 'cadA', { components: [motor('m1'), motor('m2')] }),
  partA2: node('partA2', 'part', 'cadA'),
  groupG: node('groupG', 'group', 'robotA'),
  robotB: node('robotB', 'robot', null),
  partB1: node('partB1', 'part', 'robotB')
}

// partA1을 CAD 밖 그룹으로 옮긴 씬(CAD 루트를 지우면 함께 지워진다)
const MOVED = moveObjects(SCENE, ['partA1'], 'groupG')

const scene = (): SceneObjects => useSceneStore.getState().objects
const editor = (): ReturnType<typeof useEditorStore.getState> => useEditorStore.getState()
const childIds = (parentId: string | null): string[] =>
  childrenInDocument(scene(), parentId).map((object) => object.id)

beforeEach(() => {
  useSceneStore.setState({ objects: SCENE })
  useDialogStore.setState({ request: null })
  useHierarchyViewStore.setState({ overrides: {}, query: '' })
  useNoticeStore.setState({ notices: [] })
  resetSceneVisibility()
  editor().select(null)
  editor().setCut([])
})

describe('defaultParentId', () => {
  it('활성 오브젝트의 로봇, 없으면 첫 로봇, 로봇이 없으면 최상위', () => {
    expect(defaultParentId(SCENE, 'partB1')).toBe('robotB')
    expect(defaultParentId(SCENE, 'robotB')).toBe('robotB')
    expect(defaultParentId(SCENE, null)).toBe('robotA')
    expect(defaultParentId(SCENE, 'missing')).toBe('robotA')
    expect(defaultParentId({ g: node('g', 'group', null) }, 'g')).toBeNull()
  })
})

describe('만들기 명령', () => {
  it('Create Empty는 활성 오브젝트의 로봇 마지막 자식으로 만들고 선택해 이름 바꾸기를 시작한다', () => {
    editor().select('partB1')
    const id = createEmpty()!
    expect(scene()[id]).toMatchObject({ kind: 'group', parentId: 'robotB', name: 'Group' })
    expect(childIds('robotB')).toEqual(['partB1', id])
    expect(editor().selectedIds).toEqual([id])
    expect(editor().renamingId).toBe(id)
  })

  it('Create Empty Child는 활성 오브젝트의 자식, 선택이 없으면 Create Empty와 같다', () => {
    editor().select('partA2')
    const child = createEmptyChild()!
    expect(scene()[child].parentId).toBe('partA2')
    // 새 그룹이 보이도록 상위 행을 펼친다
    expect(useHierarchyViewStore.getState().overrides).toMatchObject({
      partA2: true,
      cadA: true,
      robotA: true
    })
    editor().select(null)
    const top = createEmptyChild()!
    expect(scene()[top].parentId).toBe('robotA')
  })

  it('우클릭한 행의 Create Empty는 그 행의 자식이다', () => {
    const id = createEmptyUnder('groupG')!
    expect(scene()[id].parentId).toBe('groupG')
    expect(editor().renamingId).toBe(id)
  })

  it('Create Empty Parent는 선택을 묶고 새 그룹을 펼쳐 이름 바꾸기를 시작한다', () => {
    editor().setSelection(['partA2', 'partA1'], 'partA1')
    const id = createEmptyParent()!
    expect(childIds(id)).toEqual(['partA1', 'partA2'])
    expect(editor().selectedIds).toEqual([id])
    expect(editor().renamingId).toBe(id)
    expect(useHierarchyViewStore.getState().overrides[id]).toBe(true)
  })

  it('부모가 다른 선택은 묶지 않는다', () => {
    editor().setSelection(['partA1', 'groupG'])
    expect(createEmptyParent()).toBeNull()
    expect(scene()).toBe(SCENE)
  })

  it('핸들을 드래그하는 중에는 아무것도 하지 않는다', () => {
    editor().setSelection(['partA1', 'partA2'])
    beginChange()
    try {
      expect(createEmpty()).toBeNull()
      expect(createEmptyChild()).toBeNull()
      expect(createEmptyParent()).toBeNull()
      expect(renameSelection()).toBe(false)
    } finally {
      endChange()
    }
    expect(scene()).toBe(SCENE)
  })
})

describe('이름 바꾸기', () => {
  it('하나만 선택했을 때만 시작한다', () => {
    editor().setSelection(['partA1', 'partA2'])
    expect(renameSelection()).toBe(false)
    expect(editor().renamingId).toBeNull()
    editor().select('partA2')
    expect(renameSelection()).toBe(true)
    expect(editor().renamingId).toBe('partA2')
  })
})

describe('삭제', () => {
  it('deletePlan은 선택 subtree 밖에서 함께 지워지는 파트와 그 컴포넌트 수를 센다', () => {
    expect(deletePlan(MOVED, ['cadA', 'partA2'])).toEqual({
      ids: ['cadA'],
      extraIds: ['partA1'],
      extraComponents: 2
    })
    expect(deletePlan(SCENE, ['cadA'])).toEqual({ ids: ['cadA'], extraIds: [], extraComponents: 0 })
  })

  it('함께 지워지는 것이 없으면 묻지 않고 지운 뒤 선택을 푼다', async () => {
    editor().setSelection(['groupG', 'partB1'])
    expect(await deleteSelection()).toBe(true)
    expect(scene().groupG).toBeUndefined()
    expect(scene().partB1).toBeUndefined()
    expect(editor().selectedIds).toEqual([])
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('옮긴 CAD 파트가 함께 지워지면 묻고, 취소하면 지우지 않고 선택도 그대로 둔다', async () => {
    useSceneStore.setState({ objects: MOVED })
    editor().select('cadA')
    const pending = deleteSelection()
    expect(useDialogStore.getState().request?.cancelId).toBe('cancel')
    useDialogStore.getState().answer('cancel')
    expect(await pending).toBe(false)
    expect(scene()).toBe(MOVED)
    expect(editor().selectedIds).toEqual(['cadA'])
  })

  it('확인하면 옮긴 파트까지 지운다', async () => {
    useSceneStore.setState({ objects: MOVED })
    editor().select('cadA')
    const pending = deleteSelection()
    useDialogStore.getState().answer('delete')
    expect(await pending).toBe(true)
    expect(scene().cadA).toBeUndefined()
    expect(scene().partA1).toBeUndefined()
    expect(scene().groupG).toBeDefined()
    expect(editor().selectedIds).toEqual([])
  })

  it('선택이 없으면 아무것도 하지 않는다', async () => {
    expect(await deleteSelection()).toBe(false)
    expect(scene()).toBe(SCENE)
  })
})

describe('hierarchyMenuState', () => {
  it('행 메뉴는 Unity 순서이고, 이름 바꾸기는 하나만 선택했을 때만 쓸 수 있다', () => {
    expect(hierarchyMenuState(SCENE, ['partA1', 'partA2'], true)).toEqual([
      { item: 'cut', enabled: true },
      { item: 'paste', enabled: false },
      { item: 'pasteAsChild', enabled: false },
      { item: 'rename', enabled: false, separatorBefore: true },
      { item: 'delete', enabled: true },
      { item: 'selectChildren', enabled: false, separatorBefore: true },
      { item: 'createEmpty', enabled: true, separatorBefore: true },
      { item: 'createEmptyParent', enabled: true }
    ])
    expect(hierarchyMenuState(SCENE, ['partA1'], true).find((e) => e.item === 'rename')).toEqual({
      item: 'rename',
      enabled: true,
      separatorBefore: true
    })
    // 하위가 있으면 Select Children
    expect(
      hierarchyMenuState(SCENE, ['cadA'], true).find((e) => e.item === 'selectChildren')!.enabled
    ).toBe(true)
  })

  it('붙여넣기는 이동 규칙으로 옮길 수 있는 자리에서만 쓸 수 있다', () => {
    const state = (cut: string[], active: string): Record<string, boolean> =>
      Object.fromEntries(
        hierarchyMenuState(SCENE, [active], true, cut, active)
          .filter((e) => e.item === 'paste' || e.item === 'pasteAsChild')
          .map((e) => [e.item, e.enabled])
      )
    // 그룹으로(자식) 되고, 그룹의 형제(로봇 바로 아래)로도 된다
    expect(state(['partA2'], 'groupG')).toEqual({ paste: true, pasteAsChild: true })
    // 다른 로봇으로는 안 된다
    expect(state(['partA2'], 'partB1')).toEqual({ paste: false, pasteAsChild: false })
    // CAD 루트는 다른 부모로 안 된다
    expect(state(['cadA'], 'groupG')).toEqual({ paste: true, pasteAsChild: false })
  })

  it('부모가 다르거나 로봇이 들어 있으면 Create Empty Parent를 쓸 수 없다', () => {
    const enabled = (ids: string[]): boolean =>
      hierarchyMenuState(SCENE, ids, true).find((entry) => entry.item === 'createEmptyParent')!
        .enabled
    expect(enabled(['partA1', 'groupG'])).toBe(false)
    expect(enabled(['robotA'])).toBe(false)
    expect(enabled(['cadA'])).toBe(false)
    expect(enabled(['groupG'])).toBe(true)
  })

  it('빈 공간 메뉴는 만들기만 있다', () => {
    expect(hierarchyMenuState(SCENE, [], false)).toEqual([{ item: 'createEmpty', enabled: true }])
  })
})

describe('선택 명령', () => {
  it('Ctrl+A는 모든 오브젝트(문서 순서), 검색 중이면 결과만', () => {
    editor().select('partA2')
    expect(selectAll()).toBe(true)
    expect(editor().selectedIds).toEqual([
      'robotA',
      'cadA',
      'partA1',
      'partA2',
      'groupG',
      'robotB',
      'partB1'
    ])
    // 활성 오브젝트는 그대로
    expect(editor().selectedId).toBe('partA2')
    useHierarchyViewStore.getState().setQuery('part')
    selectAll()
    expect(editor().selectedIds).toEqual(['partA1', 'partA2', 'partB1'])
  })

  it('Select Children은 선택과 그 하위 전체를 고르고 펼친다', () => {
    editor().select('robotA')
    expect(selectChildren()).toBe(true)
    expect(editor().selectedIds).toEqual(['robotA', 'cadA', 'partA1', 'partA2', 'groupG'])
    expect(editor().selectedId).toBe('robotA')
    expect(useHierarchyViewStore.getState().overrides.cadA).toBe(true)
  })
})

describe('잘라내기·붙여넣기', () => {
  it('잘라내도 씬은 그대로이고, 붙이면 활성 오브젝트 다음 형제로 옮긴다(월드 자세 유지는 moveObjects)', () => {
    editor().setSelection(['partA1', 'cadA'])
    expect(cutSelection()).toBe(true)
    // 다른 선택(cadA)의 하위는 함께 옮겨지므로 뺀다
    expect(editor().cutIds).toEqual(['cadA'])
    expect(scene()).toBe(SCENE)

    editor().setSelection(['partA2'])
    editor().setCut(['partA2'])
    editor().select('groupG')
    expect(pasteCut(false)).toBe(true)
    expect(childIds('robotA')).toEqual(['cadA', 'groupG', 'partA2'])
    expect(editor().cutIds).toEqual([])
    expect(editor().selectedIds).toEqual(['partA2'])
  })

  it('자식으로 붙이기(Ctrl+Shift+V)는 활성 오브젝트의 마지막 자식', () => {
    editor().setCut(['partA2'])
    editor().select('groupG')
    expect(pasteCut(true)).toBe(true)
    expect(childIds('groupG')).toEqual(['partA2'])
  })

  it('옮길 수 없으면 이유를 알리고 잘라낸 것을 그대로 둔다', () => {
    editor().setCut(['partA2'])
    editor().select('partB1')
    expect(pasteCut(false)).toBe(false)
    expect(scene()).toBe(SCENE)
    expect(editor().cutIds).toEqual(['partA2'])
    expect(useNoticeStore.getState().notices.map((n) => n.key)).toEqual(['pasteRejectedOtherRobot'])
  })

  it('붙일 자리: 옮기는 오브젝트는 기준 형제가 되지 않는다', () => {
    expect(pasteTarget(SCENE, 'partA1', ['partA2'], false)).toEqual({
      parentId: 'cadA',
      beforeId: null
    })
    expect(pasteTarget(SCENE, 'cadA', ['partA1'], false)).toEqual({
      parentId: 'robotA',
      beforeId: 'groupG'
    })
    expect(pasteTarget(SCENE, 'cadA', ['groupG'], false)).toEqual({
      parentId: 'robotA',
      beforeId: null
    })
    expect(pasteTarget(SCENE, 'missing', ['groupG'], false)).toBeNull()
  })

  it('실행 취소로 잘라낸 오브젝트가 사라지면 잘라낸 목록에서도 빠진다', () => {
    editor().setCut(['partA2', 'groupG'])
    editor().pruneSelection((id) => id !== 'groupG')
    expect(editor().cutIds).toEqual(['partA2'])
  })
})

describe('보이기·숨기기', () => {
  it('H는 선택(과 하위)을 숨기고, 다시 누르면 보인다', () => {
    editor().select('cadA')
    expect(toggleSelectedVisibility()).toBe(true)
    expect([...useSceneVisibilityStore.getState().hidden]).toEqual(['cadA', 'partA1', 'partA2'])
    toggleSelectedVisibility()
    expect(useSceneVisibilityStore.getState().hidden.size).toBe(0)
    // 씬 문서는 바뀌지 않는다(실행 취소·저장에 들어가지 않는다)
    expect(scene()).toBe(SCENE)
  })

  it('Shift+H는 고립 보기를 켜고 끈다(선택이 없으면 켜지 않는다)', () => {
    expect(toggleSelectedIsolation()).toBe(false)
    editor().select('groupG')
    expect(toggleSelectedIsolation()).toBe(true)
    expect(useSceneVisibilityStore.getState().isolated).toEqual(['groupG'])
    editor().select(null)
    expect(toggleSelectedIsolation()).toBe(true)
    expect(useSceneVisibilityStore.getState().isolated).toBeNull()
  })
})
