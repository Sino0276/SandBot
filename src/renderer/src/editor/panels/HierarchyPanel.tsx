import { memo, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { importStepFiles } from '../../cad/importStep'
import { useImportStore } from '../../cad/importStore'
import { severityByObject, useSceneIssues } from '../../hardware/sceneIssues'
import type { IssueSeverity } from '../../hardware/validation'
import { simpleNameOfPath } from '../../java/javaIndex'
import { useProjectStore } from '../../project/projectStore'
import { ancestorIds, childrenInDocument, subtreeIds, type SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { openContextMenu, type ContextMenuEntry } from '../dialogStore'
import { useEditorStore } from '../editorStore'
import {
  beginObjectDrag,
  createHoverExpander,
  draggedIdsFor,
  dropPosition,
  endObjectDrag,
  evaluateEmptySpaceDrop,
  evaluateRowDrop,
  getDraggedIds,
  OBJECT_DRAG_TYPE,
  setDropIndicator,
  useHierarchyDragStore,
  type DropDestination
} from '../hierarchyDnd'
import {
  revealObjects,
  searchRows,
  selectionSet,
  treeKeyAction,
  useHierarchyViewStore,
  visibleRows,
  type TreeRow
} from '../hierarchyTree'
import { isChangeOpen } from '../history'
import NoticeList from '../NoticeList'
import PanelFrame from '../PanelFrame'
import {
  createEmpty,
  createEmptyParent,
  createEmptyUnder,
  cutSelection,
  deleteSelection,
  hierarchyMenuState,
  pasteCut,
  renameSelection,
  selectChildren,
  type HierarchyMenuItem
} from '../sceneCommands'
import {
  rowVisibilities,
  toggleRowVisibility,
  useSceneVisibilityStore,
  type RowVisibility
} from '../sceneVisibility'
import { ariaKeyShortcut, shortcutLabel, type ShortcutCommand } from '../shortcuts'
import { useDraft } from '../useDraft'

// 들여쓰기(px): 행 왼쪽 여백 + 깊이마다
const INDENT_BASE = 4
const INDENT_STEP = 14
// 접힌 행 위에 이만큼(ms) 머물면 펼친다(Unity와 비슷한 값)
const HOVER_EXPAND_DELAY = 600

const indentOf = (depth: number): number => INDENT_BASE + depth * INDENT_STEP

// 펼치기·접기. Alt+클릭이면 하위 전체를 함께 펼치거나 접는다(Unity와 같음).
function setRowOpen(id: string, open: boolean, recursive: boolean): void {
  const { objects } = useSceneStore.getState()
  const ids = recursive
    ? subtreeIds(objects, id).filter((sub) => childrenInDocument(objects, sub).length > 0)
    : [id]
  useHierarchyViewStore.getState().setOpen(ids, open)
}

// 드래그 중 자동으로 펼친 행. 놓지 않고 끝나면 다시 접는다(Unity와 같음).
let autoExpanded: string[] = []
let dropped = false
const hoverExpander = createHoverExpander(HOVER_EXPAND_DELAY, (id) => {
  autoExpanded.push(id)
  useHierarchyViewStore.getState().setOpen([id], true)
})

function finishDrag(): void {
  hoverExpander.cancel()
  endObjectDrag()
  if (!dropped && autoExpanded.length > 0)
    useHierarchyViewStore.getState().setOpen(autoExpanded, false)
  autoExpanded = []
  dropped = false
}

function rowElementOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-object-id]') : null
}

// 이름 바꾸기 입력칸. Enter나 포커스 이동으로 확정하고 Esc는 취소한다. 끝나면 이름 바꾸기 상태를 푼다.
function RenameField({
  object,
  onReturnFocus
}: {
  object: SceneObject
  onReturnFocus: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useDraft()
  const inputRef = useRef<HTMLInputElement>(null)
  // Esc로 끝냈는지, Enter·Esc로 끝내 행에 포커스를 돌려줄지
  const cancelled = useRef(false)
  const returnFocus = useRef(false)

  // 새 그룹·F2·메뉴로 시작하면 바로 입력할 수 있게 전체를 고른다
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const finish = (): void => {
    if (!cancelled.current && draft !== null)
      useSceneStore.getState().renameObject(object.id, draft)
    setDraft(null)
    const editor = useEditorStore.getState()
    if (editor.renamingId === object.id) editor.setRenaming(null)
    if (returnFocus.current) onReturnFocus()
    cancelled.current = false
    returnFocus.current = false
  }

  return (
    <input
      ref={inputRef}
      type="text"
      className="text-field tree-rename"
      aria-label={t('hierarchy.renameLabel')}
      spellCheck={false}
      value={draft ?? object.name}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return
        cancelled.current = event.key === 'Escape'
        returnFocus.current = true
        event.currentTarget.blur()
      }}
      // 행의 선택·카메라 맞추기·드래그로 넘어가지 않게 한다
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    />
  )
}

// 그룹(Create Empty) 아이콘: 빈 상자
const GROUP_ICON = (
  <svg
    className="tree-icon"
    viewBox="0 0 16 16"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeDasharray="2.2 1.6"
    aria-hidden="true"
  >
    <rect x="2" y="2" width="12" height="12" rx="1.5" />
  </svg>
)

// 눈 아이콘(보임·숨김·일부 숨김). Unity처럼 행 왼쪽 여백에 있고, 보일 때는 행에 마우스를 올려야 나타난다.
function EyeIcon({ state }: { state: RowVisibility }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      {state === 'hidden' ? (
        <path d="M3 13L13 3" />
      ) : (
        <circle
          cx="8"
          cy="8"
          r={state === 'mixed' ? 1 : 2}
          fill={state === 'mixed' ? 'currentColor' : 'none'}
        />
      )}
    </svg>
  )
}

type TreeRowProps = {
  object: SceneObject
  depth: number
  hasChildren: boolean
  open: boolean
  posInSet: number
  setSize: number
  // 키보드 Tab으로 들어오는 행(roving tabIndex): 보이는 활성 오브젝트, 없으면 첫 행
  tabStop: boolean
  severity: IssueSeverity | undefined
  // 문제가 이 오브젝트 자신에 있는지(false면 하위에 있음)
  severityOwn: boolean
  visibility: RowVisibility
  cut: boolean
  // 검색 결과에서 보이는 상위 경로(검색 중이 아니면 없음)
  path?: string
}

// 행 하나. 선택·이름 바꾸기·드롭 표시는 좁은 선택자로 읽어, 선택이 바뀌면 바뀐 행만 다시 그린다(큰 CAD에서 행 수천 개).
// 클릭·키보드·드래그 처리는 트리 전체(HierarchyPanel)가 맡는다.
const TreeRowView = memo(function TreeRowView({
  object,
  depth,
  hasChildren,
  open,
  posInSet,
  setSize,
  tabStop,
  severity,
  severityOwn,
  visibility,
  cut,
  path
}: TreeRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const id = object.id
  const selected = useEditorStore((state) => selectionSet(state.selectedIds).has(id))
  const active = useEditorStore((state) => state.selectedId === id)
  const renaming = useEditorStore((state) => state.renamingId === id)
  const drop = useHierarchyDragStore((state) => {
    const indicator = state.indicator
    return indicator !== null && indicator.id !== null && indicator.id === id ? indicator : null
  })
  const rowRef = useRef<HTMLDivElement>(null)
  const componentCount = object.components?.length ?? 0
  // 연결한 스크립트(행이 이미 받는 오브젝트에서 읽으므로 따로 구독하지 않는다)
  const scripts = object.scripts ?? []

  // 활성 오브젝트가 되면(씬에서 선택, 새 그룹 등) 하이어라키에서도 보이게 스크롤한다
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const classes = ['tree-row']
  if (selected) classes.push('is-selected')
  if (active) classes.push('is-active')
  if (drop?.position === 'into') classes.push('is-drop-into')
  if (cut) classes.push('is-cut')
  if (visibility === 'hidden') classes.push('is-hidden')
  const eyeAction = visibility === 'hidden' ? t('hierarchy.show') : t('hierarchy.hide')
  const severityLabel =
    severity &&
    (severityOwn ? t(`hardware.severity.${severity}`) : t(`hardware.severityBelow.${severity}`))

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={depth + 1}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      data-object-id={id}
      tabIndex={tabStop ? 0 : -1}
      draggable={!renaming}
      className={classes.join(' ')}
      style={{ paddingLeft: indentOf(depth) }}
      title={
        cut
          ? t('hierarchy.cutTitle', {
              paste: shortcutLabel('paste'),
              child: shortcutLabel('pasteAsChild')
            })
          : path
      }
    >
      <button
        type="button"
        tabIndex={-1}
        className={`tree-eye is-${visibility}`}
        aria-label={eyeAction}
        aria-pressed={visibility === 'hidden'}
        title={t('hierarchy.visibilityTitle', { action: eyeAction })}
        onClick={(event) => {
          event.stopPropagation()
          toggleRowVisibility(useSceneStore.getState().objects, id, event.altKey)
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <EyeIcon state={visibility} />
      </button>
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          className="tree-twisty"
          aria-label={open ? t('hierarchy.collapse') : t('hierarchy.expand')}
          onClick={(event) => {
            event.stopPropagation()
            setRowOpen(id, !open, event.altKey)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {open ? '▾' : '▸'}
        </button>
      ) : (
        <span className="tree-twisty" />
      )}
      {object.kind === 'group' && GROUP_ICON}
      {renaming ? (
        <RenameField object={object} onReturnFocus={() => rowRef.current?.focus()} />
      ) : (
        <span className="tree-name">{object.name}</span>
      )}
      {path && <span className="tree-path">{path}</span>}
      {severity && (
        <span
          className={`tree-issue is-${severity}${severityOwn ? '' : ' is-below'}`}
          role="img"
          aria-label={severityLabel}
          title={severityLabel}
        >
          !
        </span>
      )}
      {componentCount > 0 && (
        <span
          className="tree-components"
          title={object.components!.map((component) => component.name).join(', ')}
        >
          {t('hardware.badge', { count: componentCount })}
        </span>
      )}
      {scripts.length > 0 && (
        <span
          className="tree-scripts"
          title={t('scripts.badgeTitle', {
            names: scripts.map((script) => simpleNameOfPath(script.path)).join(', ')
          })}
        >
          {t('scripts.badge')}
        </span>
      )}
      <span className="tree-kind">{t(`objectKind.${object.kind}`)}</span>
      {drop && drop.position !== 'into' && (
        <span
          className={`tree-drop-line is-${drop.position}`}
          style={{ left: indentOf(drop.nested ? depth + 1 : depth) }}
        />
      )}
    </div>
  )
})

// 메뉴 항목 → 단축키 표(editor/shortcuts.ts). Select Children은 Unity에도 단축키가 없다.
const MENU_SHORTCUTS: Record<HierarchyMenuItem, ShortcutCommand | null> = {
  cut: 'cut',
  paste: 'paste',
  pasteAsChild: 'pasteAsChild',
  selectChildren: null,
  rename: 'rename',
  delete: 'delete',
  createEmpty: 'createEmpty',
  createEmptyParent: 'createEmptyParent'
}

function HierarchyPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const overrides = useHierarchyViewStore((state) => state.overrides)
  const query = useHierarchyViewStore((state) => state.query)
  const hidden = useSceneVisibilityStore((state) => state.hidden)
  const cutIds = useEditorStore((state) => state.cutIds)
  // 활성 오브젝트만 구독한다(roving tabIndex). 선택 표시는 행마다 따로 읽는다.
  const activeId = useEditorStore((state) => state.selectedId)
  const endLine = useHierarchyDragStore((state) => state.indicator?.position === 'end')
  // 한 번에 하나만 불러온다(큰 STEP은 메모리를 많이 쓴다). 창에 끌어다 놓기도 같은 조건으로 막힌다.
  const importing = useImportStore((state) => state.running > 0)
  const busy = useProjectStore((state) => state.busy)
  const fileInput = useRef<HTMLInputElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const issues = useSceneIssues()
  const severities = useMemo(() => severityByObject(objects, issues), [objects, issues])
  // 검색어가 있으면 Unity처럼 계층 없이 맞는 오브젝트만 보인다
  const results = useMemo(() => searchRows(objects, query), [objects, query])
  const rows = useMemo(
    () => results ?? visibleRows(objects, overrides),
    [results, objects, overrides]
  )
  const visibilities = useMemo(() => rowVisibilities(objects, hidden), [objects, hidden])
  const cutSet = useMemo(() => new Set(cutIds), [cutIds])
  const searching = results !== null
  const searchRef = useRef<HTMLInputElement>(null)
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const tabStopId = activeId !== null && rowById.has(activeId) ? activeId : (rows[0]?.id ?? null)

  // 씬 뷰 등에서 새로 선택한 오브젝트가 보이도록 상위 행을 펼친다(Unity와 같음). 이미 선택된 것은 다시 펼치지 않아,
  // 선택한 오브젝트의 부모도 접을 수 있다.
  useEffect(() => {
    revealObjects(useSceneStore.getState().objects, useEditorStore.getState().selectedIds)
    return useEditorStore.subscribe((state, previous) => {
      if (state.selectedIds === previous.selectedIds) return
      const before = selectionSet(previous.selectedIds)
      const added = state.selectedIds.filter((id) => !before.has(id))
      if (added.length > 0) revealObjects(useSceneStore.getState().objects, added)
    })
  }, [])

  // 패널이 내려가면 드래그 표시·타이머를 정리한다
  useEffect(() => () => finishDrag(), [])

  const visibleIds = (): string[] => rows.map((row) => row.id)

  const focusRow = (id: string): void => {
    const element = treeRef.current?.querySelector<HTMLElement>(
      `[data-object-id="${CSS.escape(id)}"]`
    )
    element?.focus()
  }

  const menuEntries = (onRow: boolean, rowId: string | null): ContextMenuEntry[] => {
    const { selectedIds, cutIds: cut, selectedId } = useEditorStore.getState()
    const actions: Record<HierarchyMenuItem, () => void> = {
      cut: () => void cutSelection(),
      paste: () => void pasteCut(false),
      pasteAsChild: () => void pasteCut(true),
      selectChildren: () => void selectChildren(),
      rename: () => void renameSelection(),
      delete: () => void deleteSelection(),
      createEmpty: () => void (rowId !== null ? createEmptyUnder(rowId) : createEmpty()),
      createEmptyParent: () => void createEmptyParent()
    }
    return hierarchyMenuState(
      useSceneStore.getState().objects,
      selectedIds,
      onRow,
      cut,
      selectedId
    ).flatMap(({ item, enabled, separatorBefore }): ContextMenuEntry[] => {
      const shortcut = MENU_SHORTCUTS[item]
      return [
        ...(separatorBefore ? [{ type: 'separator' as const, id: `separator-${item}` }] : []),
        {
          type: 'item',
          id: item,
          label: t(`hierarchy.menu.${item}`),
          shortcut: shortcut ? shortcutLabel(shortcut) : undefined,
          ariaKeyShortcuts: shortcut ? ariaKeyShortcut(shortcut) : undefined,
          disabled: !enabled,
          onSelect: actions[item]
        }
      ]
    })
  }

  // 우클릭(Shift+F10·메뉴 키도 포커스된 행에 contextmenu를 보낸다). 선택에 없는 행이면 먼저 그 행만 선택한다(Unity와 같음).
  // 빈 공간이면 선택을 풀고 만들기 메뉴를 띄운다.
  const onContextMenu = (event: React.MouseEvent): void => {
    if (event.target instanceof HTMLInputElement) return
    event.preventDefault()
    const editor = useEditorStore.getState()
    const rowElement = rowElementOf(event.target)
    if (!rowElement) {
      editor.select(null)
      openContextMenu({
        x: event.clientX,
        y: event.clientY,
        label: t('hierarchy.menu.label'),
        entries: menuEntries(false, null),
        returnFocus: null
      })
      return
    }
    const id = rowElement.dataset.objectId!
    if (!selectionSet(editor.selectedIds).has(id)) editor.select(id)
    // 키보드로 열면 좌표가 행 밖(0, 0 등)이므로 행 아래에 띄운다
    const rect = rowElement.getBoundingClientRect()
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom &&
      (event.clientX !== 0 || event.clientY !== 0)
    const depth = rowById.get(id)?.depth ?? 0
    openContextMenu({
      x: inside ? event.clientX : rect.left + indentOf(depth + 1),
      y: inside ? event.clientY : rect.bottom,
      label: t('hierarchy.menu.label'),
      entries: menuEntries(true, id),
      returnFocus: rowElement
    })
  }

  // 클릭 = 선택, Ctrl/Cmd+클릭 = 넣기·빼기, Shift+클릭 = 보이는 행 범위(Unity와 같음). 빈 공간 클릭은 선택 해제.
  const onClick = (event: React.MouseEvent): void => {
    const editor = useEditorStore.getState()
    const rowElement = rowElementOf(event.target)
    if (!rowElement) {
      editor.select(null)
      return
    }
    const id = rowElement.dataset.objectId!
    if (event.ctrlKey || event.metaKey) editor.toggleSelect(id)
    else if (event.shiftKey) editor.selectRange(id, visibleIds())
    else editor.select(id)
  }

  const onDoubleClick = (event: React.MouseEvent): void => {
    const rowElement = rowElementOf(event.target)
    if (rowElement) useEditorStore.getState().focus(rowElement.dataset.objectId!)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const rowElement = rowElementOf(event.target)
    const action = treeKeyAction(
      rows,
      rowElement?.dataset.objectId ?? activeId,
      event.key,
      event.shiftKey
    )
    if (!action) return
    event.preventDefault()
    if (action.type === 'setOpen') {
      useHierarchyViewStore.getState().setOpen([action.id], action.open)
      return
    }
    const editor = useEditorStore.getState()
    if (action.extend) editor.selectRange(action.id, visibleIds())
    else editor.select(action.id)
    focusRow(action.id)
  }

  // ---- 드래그 앤 드롭: 내부 형식일 때만 처리한다. 파일 드래그는 건드리지 않고 창(EditorLayout)으로 올려 보낸다.
  const isObjectDrag = (event: React.DragEvent): boolean =>
    event.dataTransfer.types.includes(OBJECT_DRAG_TYPE)

  const onDragStart = (event: React.DragEvent): void => {
    // 이름 바꾸기 입력칸 안의 글자 끌기는 입력칸에 맡긴다
    if (event.target instanceof HTMLInputElement) return
    const rowElement = rowElementOf(event.target)
    // 검색 결과는 계층이 없어 놓을 자리를 보일 수 없다(검색을 지우고 끈다)
    if (!rowElement || isChangeOpen() || searching) {
      event.preventDefault()
      return
    }
    const ids = draggedIdsFor(
      rowElement.dataset.objectId!,
      useEditorStore.getState().selectedIds,
      visibleIds()
    )
    event.dataTransfer.setData(OBJECT_DRAG_TYPE, ids.join('\n'))
    event.dataTransfer.effectAllowed = 'move'
    autoExpanded = []
    dropped = false
    beginObjectDrag(ids)
  }

  // 지금 커서 위치에 놓을 자리. 놓을 수 없으면 null.
  const dropAt = (event: React.DragEvent, ids: readonly string[]): DropDestination | null => {
    const rowElement = rowElementOf(event.target)
    if (!rowElement) {
      hoverExpander.hover(null)
      const destination = evaluateEmptySpaceDrop(objects, ids)
      setDropIndicator(
        destination === null
          ? null
          : destination.parentId === null
            ? { id: null, position: 'end' }
            : { id: destination.parentId, position: 'into', nested: false }
      )
      return destination
    }
    const id = rowElement.dataset.objectId!
    const row: TreeRow | undefined = rowById.get(id)
    const rect = rowElement.getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    // 접힌 행의 가운데에 머물면 펼친다(놓을 수 없는 행이어도 그 안으로 들어갈 수 있게)
    const collapsed = !!row?.hasChildren && !row.open
    hoverExpander.hover(
      collapsed && dropPosition(offsetY, rect.height, true) === 'into' ? id : null
    )
    const drop = evaluateRowDrop(
      objects,
      ids,
      id,
      offsetY,
      rect.height,
      !!row?.hasChildren && row.open
    )
    setDropIndicator(
      drop && {
        id,
        position: drop.position,
        nested: drop.position === 'after' && drop.parentId === id
      }
    )
    return drop
  }

  const onDragOver = (event: React.DragEvent): void => {
    if (!isObjectDrag(event)) return
    const ids = getDraggedIds()
    if (!ids) return
    if (dropAt(event, ids)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }

  const onDragLeave = (event: React.DragEvent): void => {
    if (!isObjectDrag(event)) return
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    hoverExpander.cancel()
    setDropIndicator(null)
  }

  const onDrop = (event: React.DragEvent): void => {
    if (!isObjectDrag(event)) return
    event.preventDefault()
    const ids = getDraggedIds()
    const destination = ids && !isChangeOpen() ? dropAt(event, ids) : null
    hoverExpander.cancel()
    setDropIndicator(null)
    if (!ids || !destination) return
    dropped = true
    const scene = useSceneStore.getState()
    scene.moveObjects(ids, destination.parentId, destination.beforeId)
    // 옮긴 오브젝트를 선택한 채로 보이게 한다(Unity와 같음)
    revealObjects(useSceneStore.getState().objects, ids)
    const { selectedId, setSelection } = useEditorStore.getState()
    setSelection(ids, selectedId !== null && ids.includes(selectedId) ? selectedId : ids[0])
  }

  const roots = childrenInDocument(objects, null)

  // 검색 결과 행에 보일 상위 경로(로봇 › 그룹)
  const pathOf = (id: string): string =>
    ancestorIds(objects, id)
      .reverse()
      .map((ancestor) => objects[ancestor]?.name ?? '')
      .join(' › ')

  // 검색어를 지우면 선택한 오브젝트가 트리에 보이게 펼친다(Unity와 같음)
  const setQuery = (next: string): void => {
    useHierarchyViewStore.getState().setQuery(next)
    if (!next.trim())
      revealObjects(useSceneStore.getState().objects, useEditorStore.getState().selectedIds)
  }

  const actions = (
    <>
      <button
        type="button"
        className="panel-button panel-icon-button"
        aria-label={t('hierarchy.create')}
        aria-keyshortcuts={ariaKeyShortcut('createEmpty')}
        title={t('hierarchy.createTooltip', { shortcut: shortcutLabel('createEmpty') })}
        onClick={() => createEmpty()}
      >
        +
      </button>
      <button
        type="button"
        className="panel-button"
        disabled={importing || busy}
        onClick={() => fileInput.current?.click()}
      >
        {t('hierarchy.importStep')}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".step,.stp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importStepFiles([file])
        }}
      />
    </>
  )

  return (
    <PanelFrame title={t('panels.hierarchy')} actions={actions}>
      <NoticeList />
      <div className="hierarchy-search">
        <input
          ref={searchRef}
          type="search"
          className="text-field hierarchy-search-input"
          data-hierarchy-search=""
          aria-label={t('hierarchy.search')}
          placeholder={t('hierarchy.searchPlaceholder', { shortcut: shortcutLabel('search') })}
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Esc: 지우기(Unity와 같음). 아래 화살표: 첫 결과로
            if (event.key === 'Escape' && query) {
              event.preventDefault()
              setQuery('')
            } else if (event.key === 'ArrowDown' && rows.length > 0) {
              event.preventDefault()
              const first = rows[0].id
              useEditorStore.getState().select(first)
              requestAnimationFrame(() => focusRow(first))
            }
          }}
        />
      </div>
      <div
        className="hierarchy-area"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onDragStart={onDragStart}
        // 다른 행으로 넘어갈 때 Chromium은 dragenter만 보내므로 dragenter에서도 같은 판단을 한다
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={finishDrag}
      >
        {roots.length === 0 ? (
          <p className="panel-empty">
            {t('hierarchy.empty')}
            <br />
            {t('hierarchy.emptyHint')}
          </p>
        ) : searching && rows.length === 0 ? (
          <p className="panel-empty">{t('hierarchy.searchNoResults', { query: query.trim() })}</p>
        ) : (
          <div
            ref={treeRef}
            role="tree"
            aria-multiselectable="true"
            className="tree"
            aria-label={t('panels.hierarchy')}
          >
            {rows.map((row) => {
              const severity = severities.get(row.id)
              return (
                <TreeRowView
                  key={row.id}
                  object={objects[row.id]}
                  depth={row.depth}
                  hasChildren={row.hasChildren}
                  open={row.open}
                  posInSet={row.posInSet}
                  setSize={row.setSize}
                  tabStop={row.id === tabStopId}
                  severity={severity?.severity}
                  severityOwn={severity?.own ?? false}
                  visibility={visibilities.get(row.id) ?? 'visible'}
                  cut={cutSet.has(row.id)}
                  path={searching ? pathOf(row.id) : undefined}
                />
              )
            })}
          </div>
        )}
        {/* 행 아래 빈 공간: 클릭하면 선택 해제, 놓으면 로봇의 마지막 자식, 우클릭하면 만들기 메뉴 */}
        <div className={endLine ? 'tree-filler is-drop-end' : 'tree-filler'} />
      </div>
    </PanelFrame>
  )
}

export default HierarchyPanel
