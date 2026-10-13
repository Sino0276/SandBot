import { useTranslation } from 'react-i18next'
import {
  COMPONENT_CATEGORIES,
  COMPONENT_TYPE_KEYS,
  componentDef,
  isComponentType
} from '../../hardware/catalog'
import {
  createComponent,
  robotComponents,
  robotHardwareSettings,
  type ComponentEntry
} from '../../hardware/components'
import { useSceneIssues } from '../../hardware/sceneIssues'
import { ancestorIds, findRobotId, subtreeIds, type SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import ComponentCard from './ComponentCard'

// 선택한 오브젝트에 붙은 하드웨어 컴포넌트(Unity의 컴포넌트 목록과 같은 방식)
function HardwareComponentsSection({ object }: { object: SceneObject }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const addComponent = useSceneStore((state) => state.addComponent)
  const issues = useSceneIssues()

  const robotId = findRobotId(objects, object.id)
  const components = object.components ?? []
  // 이름·포트는 로봇 전체에서 겹치지 않아야 한다
  const siblings: ComponentEntry[] = robotId
    ? robotComponents(objects, robotId)
    : components.map((component) => ({ objectId: object.id, component }))
  const expansionHubEnabled = robotId
    ? robotHardwareSettings(objects, robotId).expansionHub.enabled
    : false
  // 포드로 고를 수 있는 파트: 같은 로봇의 파트·어셈블리(깊이만큼 들여 쓴다)
  const pickableObjects = robotId
    ? subtreeIds(objects, robotId)
        .filter((id) => id !== robotId)
        .map((id) => ({
          id,
          label: `${'\u00a0\u00a0'.repeat(ancestorIds(objects, id).length - 1)}${objects[id].name}`
        }))
    : []

  const add = (type: string): void => {
    if (!isComponentType(type)) return
    const existing = siblings.map((entry) => entry.component)
    addComponent(
      object.id,
      createComponent(type, existing, () => crypto.randomUUID())
    )
  }

  return (
    <section className="inspector-section" aria-label={t('hardware.title')}>
      <header className="inspector-section-header">
        <span>{t('hardware.title')}</span>
      </header>
      {!robotId && components.length > 0 && (
        <p className="inspector-note">{t('hardware.orphan')}</p>
      )}
      {components.length === 0 ? (
        <p className="inspector-note">{t('hardware.empty')}</p>
      ) : (
        <ul className="hw-cards">
          {components.map((component) => (
            <ComponentCard
              key={component.id}
              objects={objects}
              objectId={object.id}
              component={component}
              siblings={siblings}
              pickableObjects={pickableObjects}
              expansionHubEnabled={expansionHubEnabled}
              issues={issues.filter((issue) => issue.componentId === component.id)}
            />
          ))}
        </ul>
      )}
      <select
        className="field-select hw-add"
        aria-label={t('hardware.add')}
        value=""
        onChange={(event) => add(event.target.value)}
      >
        <option value="" disabled>
          {t('hardware.add')}
        </option>
        {COMPONENT_CATEGORIES.map((category) => (
          <optgroup key={category} label={t(`hardware.categories.${category}`)}>
            {COMPONENT_TYPE_KEYS.filter((type) => componentDef(type).category === category).map(
              (type) => (
                <option key={type} value={type}>
                  {t(`hardware.types.${type}`)}
                </option>
              )
            )}
          </optgroup>
        ))}
      </select>
    </section>
  )
}

export default HardwareComponentsSection
