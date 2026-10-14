import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { importStepFiles } from '../../cad/importStep'
import { useImportStore } from '../../cad/importStore'
import { useProjectStore } from '../../project/projectStore'
import { severityByObject, useSceneIssues, type ObjectSeverity } from '../../hardware/sceneIssues'
import {
  ancestorIds,
  childrenInDocument,
  type SceneObject,
  type SceneObjects
} from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import NoticeList from '../NoticeList'
import PanelFrame from '../PanelFrame'

type TreeContext = {
  objects: SceneObjects
  // 오브젝트별 가장 심각한 하드웨어 문제(하위 오브젝트의 문제 포함)
  severities: Map<string, ObjectSeverity>
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
  const children = childrenInDocument(context.objects, object.id)
  const open = context.isOpen(object.id, depth)
  const severity = context.severities.get(object.id)
  const componentCount = object.components?.length ?? 0

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
        {severity && (
          <span
            className={`tree-issue is-${severity.severity}${severity.own ? '' : ' is-below'}`}
            role="img"
            aria-label={
              severity.own
                ? t(`hardware.severity.${severity.severity}`)
                : t(`hardware.severityBelow.${severity.severity}`)
            }
            title={
              severity.own
                ? t(`hardware.severity.${severity.severity}`)
                : t(`hardware.severityBelow.${severity.severity}`)
            }
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
  // 한 번에 하나만 불러온다(큰 STEP은 메모리를 많이 쓴다). 창에 끌어다 놓기도 같은 조건으로 막힌다.
  const importing = useImportStore((state) => state.running > 0)
  const busy = useProjectStore((state) => state.busy)
  const fileInput = useRef<HTMLInputElement>(null)
  // 사용자가 직접 접거나 편 항목. 나머지는 깊이 2 미만만 펼친다.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})

  const issues = useSceneIssues()
  const severities = useMemo(() => severityByObject(objects, issues), [objects, issues])
  const selectedAncestors = useMemo(
    () => new Set(selectedId && objects[selectedId] ? ancestorIds(objects, selectedId) : []),
    [objects, selectedId]
  )

  const context: TreeContext = {
    objects,
    severities,
    // 선택한 오브젝트의 상위 항목은 항상 펼친다
    isOpen: (id, depth) => selectedAncestors.has(id) || (openOverrides[id] ?? depth < 2),
    toggle: (id, depth) =>
      setOpenOverrides((current) => ({ ...current, [id]: !(current[id] ?? depth < 2) }))
  }

  const roots = childrenInDocument(objects, null)

  const actions = (
    <>
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
