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
  hierarchyMenuState,
  renameSelection
} from './sceneCommands'

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
  useHierarchyViewStore.setState({ overrides: {} })
  editor().select(null)
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
      { item: 'rename', enabled: false },
      { item: 'delete', enabled: true },
      { item: 'createEmpty', enabled: true, separatorBefore: true },
      { item: 'createEmptyParent', enabled: true }
    ])
    expect(hierarchyMenuState(SCENE, ['partA1'], true)[0]).toEqual({
      item: 'rename',
      enabled: true
    })
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
