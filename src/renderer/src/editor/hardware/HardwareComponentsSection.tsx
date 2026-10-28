import { useMemo } from 'react'
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
import { openScriptPicker } from '../dialogStore'
import ScriptCard from '../scripts/ScriptCard'
import ComponentCard from './ComponentCard'
import { canAddWheel, newWheel } from './wheelCard'
import WheelCard from './WheelCard'

// Add Component 선택 상자에서 스크립트 선택창을 여는 항목·바퀴 항목의 값(컴포넌트 종류 이름과 겹치지 않는다)
const SCRIPT_OPTION = '#script'
const WHEEL_OPTION = '#wheel'

// 선택한 오브젝트의 컴포넌트 목록(Unity의 컴포넌트 목록과 같은 방식). 하드웨어 컴포넌트 카드 뒤에 바퀴 카드
// (시뮬레이터 설정), 그 뒤에 연결한 스크립트 카드가 온다. [컴포넌트 추가]에서 하드웨어 종류, 바퀴, TeamCode
// 스크립트(검색 선택창)를 고른다.
function HardwareComponentsSection({ object }: { object: SceneObject }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const addComponent = useSceneStore((state) => state.addComponent)
  const setWheel = useSceneStore((state) => state.setWheel)
  const issues = useSceneIssues()

  const robotId = findRobotId(objects, object.id)
  const components = object.components ?? []
  const scripts = object.scripts ?? []
  // 이름·포트는 로봇 전체에서 겹치지 않아야 한다
  const siblings: ComponentEntry[] = robotId
    ? robotComponents(objects, robotId)
    : components.map((component) => ({ objectId: object.id, component }))
  const expansionHubEnabled = robotId
    ? robotHardwareSettings(objects, robotId).expansionHub.enabled
    : false
  // 포드로 고를 수 있는 파트: 같은 로봇의 파트·어셈블리(깊이만큼 들여 쓴다). Pinpoint 카드만 쓴다.
  const needsPicker = components.some((component) => component.type === 'pinpoint')
  const pickableObjects = useMemo(
    () =>
      robotId && needsPicker
        ? subtreeIds(objects, robotId)
            .filter((id) => id !== robotId)
            .map((id) => ({
              id,
              label: `${'\u00a0\u00a0'.repeat(ancestorIds(objects, id).length - 1)}${objects[id].name}`
            }))
        : [],
    [objects, robotId, needsPicker]
  )

  const add = (type: string): void => {
    if (!isComponentType(type)) return
    const existing = siblings.map((entry) => entry.component)
    addComponent(
      object.id,
      createComponent(type, existing, () => crypto.randomUUID())
    )
  }

  return (
    <section className="inspector-section" aria-label={t('inspector.components')}>
      <header className="inspector-section-header">
        <span>{t('inspector.components')}</span>
      </header>
      {!robotId && components.length > 0 && (
        <p className="inspector-note">{t('hardware.orphan')}</p>
      )}
      {components.length === 0 && scripts.length === 0 && !object.wheel ? (
        <p className="inspector-note">{t('inspector.componentsEmpty')}</p>
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
          {object.wheel && <WheelCard object={object} />}
          {scripts.map((link) => (
            <ScriptCard key={link.path} objectId={object.id} link={link} />
          ))}
        </ul>
      )}
      <select
        className="field-select hw-add"
        aria-label={t('hardware.add')}
        value=""
        onChange={(event) => {
          const select = event.currentTarget
          if (event.target.value === SCRIPT_OPTION) {
            // 선택창이 검색 입력칸으로 포커스를 가져간다
            const rect = select.getBoundingClientRect()
            openScriptPicker({
              objectId: object.id,
              anchor: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width }
            })
            return
          }
          if (event.target.value === WHEEL_OPTION) setWheel(object.id, newWheel(objects, object.id))
          else add(event.target.value)
          // 포커스가 남아 있으면 방향키가 값을 바꿔 컴포넌트가 또 추가된다
          select.blur()
        }}
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
        {/* 바퀴는 오브젝트마다 하나, 로봇·CAD 루트에는 붙이지 않는다 */}
        <optgroup label={t('hardware.wheel.addGroup')}>
          <option value={WHEEL_OPTION} disabled={!canAddWheel(object)}>
            {t('hardware.wheel.addOption')}
          </option>
        </optgroup>
        <optgroup label={t('scripts.addGroup')}>
          <option value={SCRIPT_OPTION}>{t('scripts.addOption')}</option>
        </optgroup>
      </select>
    </section>
  )
}

export default HardwareComponentsSection
