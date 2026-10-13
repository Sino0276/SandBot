import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { importStepFile } from '../../cad/importStep'
import { ancestorIds, childrenOf, type SceneObject, type SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import NoticeList from '../NoticeList'
import { useNoticeStore } from '../noticeStore'
import PanelFrame from '../PanelFrame'

type TreeContext = {
  objects: SceneObjects
  isOpen: (id: string, depth: number) => boolean
  toggle: (id: string, depth: number) => void
}

function TreeItem({
  object,
  depth,
  context
}: {
  object: SceneObject
  depth: number
  context: TreeContext
}): React.JSX.Element {
  const { t } = useTranslation()
  const selected = useEditorStore((state) => state.selectedId === object.id)
  const select = useEditorStore((state) => state.select)
  const focus = useEditorStore((state) => state.focus)
  const rowRef = useRef<HTMLDivElement>(null)
  const children = childrenOf(context.objects, object.id)
  const open = context.isOpen(object.id, depth)

  // 씬에서 선택하면 하이어라키에서도 보이게 스크롤한다
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <li role="treeitem" aria-selected={selected} aria-expanded={children.length ? open : undefined}>
      <div
        ref={rowRef}
        className={selected ? 'tree-row is-selected' : 'tree-row'}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => select(object.id)}
        onDoubleClick={() => focus(object.id)}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="tree-twisty"
            aria-label={open ? t('hierarchy.collapse') : t('hierarchy.expand')}
            onClick={(event) => {
              event.stopPropagation()
              context.toggle(object.id, depth)
            }}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-twisty" />
        )}
        <span className="tree-name">{object.name}</span>
        <span className="tree-kind">{t(`objectKind.${object.kind}`)}</span>
      </div>
      {open && children.length > 0 && (
        <ul role="group" className="tree">
          {children.map((child) => (
            <TreeItem key={child.id} object={child} depth={depth + 1} context={context} />
          ))}
        </ul>
      )}
    </li>
  )
}

function HierarchyPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const selectedId = useEditorStore((state) => state.selectedId)
  const importing = useNoticeStore((state) => state.notices.some((n) => n.key === 'importing'))
  const fileInput = useRef<HTMLInputElement>(null)
  // 사용자가 직접 접거나 편 항목. 나머지는 깊이 2 미만만 펼친다.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})

  const selectedAncestors = useMemo(
    () => new Set(selectedId && objects[selectedId] ? ancestorIds(objects, selectedId) : []),
    [objects, selectedId]
  )

  const context: TreeContext = {
    objects,
    // 선택한 오브젝트의 상위 항목은 항상 펼친다
    isOpen: (id, depth) => selectedAncestors.has(id) || (openOverrides[id] ?? depth < 2),
    toggle: (id, depth) =>
      setOpenOverrides((current) => ({ ...current, [id]: !(current[id] ?? depth < 2) }))
  }

  const roots = childrenOf(objects, null)

  const actions = (
    <>
      <button
        type="button"
        className="panel-button"
        disabled={importing}
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
          if (file) void importStepFile(file)
        }}
      />
    </>
  )

  return (
    <PanelFrame title={t('panels.hierarchy')} actions={actions}>
      <NoticeList />
      {roots.length === 0 ? (
        <p className="panel-empty">
          {t('hierarchy.empty')}
          <br />
          {t('hierarchy.emptyHint')}
        </p>
      ) : (
        <ul role="tree" className="tree" aria-label={t('panels.hierarchy')}>
          {roots.map((object) => (
            <TreeItem key={object.id} object={object} depth={0} context={context} />
          ))}
        </ul>
      )}
    </PanelFrame>
  )
}

export default HierarchyPanel
