import { useTranslation } from 'react-i18next'
import { childrenOf, type SceneObject, type SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import PanelFrame from '../PanelFrame'

type TreeItemProps = {
  object: SceneObject
  objects: SceneObjects
  depth: number
}

function TreeItem({ object, objects, depth }: TreeItemProps): React.JSX.Element {
  const { t } = useTranslation()
  const selected = useEditorStore((state) => state.selectedId === object.id)
  const select = useEditorStore((state) => state.select)
  const children = childrenOf(objects, object.id)

  return (
    <li role="treeitem" aria-selected={selected}>
      <button
        type="button"
        className={selected ? 'tree-row is-selected' : 'tree-row'}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => select(object.id)}
      >
        <span className="tree-name">{object.name}</span>
        <span className="tree-kind">{t(`objectKind.${object.kind}`)}</span>
      </button>
      {children.length > 0 && (
        <ul role="group" className="tree">
          {children.map((child) => (
            <TreeItem key={child.id} object={child} objects={objects} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function HierarchyPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const roots = childrenOf(objects, null)

  return (
    <PanelFrame title={t('panels.hierarchy')}>
      {roots.length === 0 ? (
        <p className="panel-empty">{t('hierarchy.empty')}</p>
      ) : (
        <ul role="tree" className="tree" aria-label={t('panels.hierarchy')}>
          {roots.map((object) => (
            <TreeItem key={object.id} object={object} objects={objects} depth={0} />
          ))}
        </ul>
      )}
    </PanelFrame>
  )
}

export default HierarchyPanel
