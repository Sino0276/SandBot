import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  COMPONENT_CATEGORIES,
  COMPONENT_TYPE_KEYS,
  componentDef,
  isComponentType,
  type ObjectPick
} from '../../hardware/catalog'
import {
  createComponent,
  robotComponents,
  robotHardwareSettings,
  type ComponentEntry
} from '../../hardware/components'
import { useSceneIssues } from '../../hardware/sceneIssues'
import { findRobotId, type SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { openScriptPicker } from '../dialogStore'
import JointCard from '../joint/JointCard'
import { canAddJoint, newJoint } from '../joint/jointCardModel'
import MassCard from '../mass/MassCard'
import { canAddMass } from '../mass/massCardModel'
import MassEstimateLine from '../mass/MassEstimateLine'
import ScriptCard from '../scripts/ScriptCard'
import ColliderCard from '../collider/ColliderCard'
import { canAddCollider, newCollider } from '../collider/colliderCardModel'
import { jointBodyFrames } from '../../play/worldJoints'
import { canHaveColliders, MAX_OBJECT_COLLIDERS, type ColliderKind } from '../../scene/collider'
import ComponentCard from './ComponentCard'
import { objectOptions, objectPicksOf, type ObjectOption } from './objectOptions'
import { canAddWheel, newWheel } from './wheelCardModel'
import WheelCard from './WheelCard'

// Add Component 선택 상자에서 스크립트 선택창을 여는 항목·바퀴·관절·질량 항목의 값(컴포넌트 종류 이름과 겹치지 않는다)
const SCRIPT_OPTION = '#script'
const WHEEL_OPTION = '#wheel'
const JOINT_OPTION = '#joint'
const MASS_OPTION = '#mass'
// 충돌체(spec-5 §6.1): Box·Capsule·Mesh Collider와 Cylinder Collider(6a, Unity에 없음: 임시 편차, 도움말이 알린다)
const COLLIDER_OPTIONS = {
  '#boxCollider': 'box',
  '#capsuleCollider': 'capsule',
  '#meshCollider': 'mesh',
  '#cylinderCollider': 'cylinder'
} as const satisfies Record<string, ColliderKind>
const isColliderOption = (value: string): value is keyof typeof COLLIDER_OPTIONS =>
  Object.hasOwn(COLLIDER_OPTIONS, value)

// 선택한 오브젝트의 컴포넌트 목록(Unity의 컴포넌트 목록과 같은 방식). 하드웨어 컴포넌트 카드 뒤에 바퀴·관절·질량 카드
// (시뮬레이터 설정), 그 뒤에 연결한 스크립트 카드가 온다. [컴포넌트 추가]에서 하드웨어 종류, 바퀴, 관절, 질량, TeamCode
// 스크립트(검색 선택창)를 고른다. 질량 카드가 없으면 맨 아래에 추정 질량 한 줄을 보인다(누르면 카드를 붙인다).
function HardwareComponentsSection({ object }: { object: SceneObject }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const addComponent = useSceneStore((state) => state.addComponent)
  const setWheel = useSceneStore((state) => state.setWheel)
  const setJoint = useSceneStore((state) => state.setJoint)
  const setObjectMass = useSceneStore((state) => state.setObjectMass)
  const setColliders = useSceneStore((state) => state.setColliders)
  const issues = useSceneIssues()

  const robotId = findRobotId(objects, object.id)
  const components = object.components ?? []
  const scripts = object.scripts ?? []
  const colliders = object.colliders ?? []
  // 이름·포트는 로봇 전체에서 겹치지 않아야 한다
  const siblings: ComponentEntry[] = robotId
    ? robotComponents(objects, robotId)
    : components.map((component) => ({ objectId: object.id, component }))
  const expansionHubEnabled = robotId
    ? robotHardwareSettings(objects, robotId).expansionHub.enabled
    : false
  // object 속성으로 고를 수 있는 오브젝트: Pinpoint 포드는 같은 로봇의 오브젝트, 리밋 스위치는 같은 로봇의 관절 오브젝트
  const picks = objectPicksOf(components.map((component) => component.type)).join(',')
  const pickable = useMemo(() => {
    const result: Partial<Record<ObjectPick, ObjectOption[]>> = {}
    for (const pick of picks ? (picks.split(',') as ObjectPick[]) : [])
      result[pick] = objectOptions(objects, robotId, pick)
    return result
  }, [objects, robotId, picks])

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
      {components.length === 0 &&
      scripts.length === 0 &&
      !object.wheel &&
      !object.joint &&
      !object.mass &&
      !object.colliders?.length ? (
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
              objectOptions={pickable}
              expansionHubEnabled={expansionHubEnabled}
              issues={issues.filter((issue) => issue.componentId === component.id)}
            />
          ))}
          {object.wheel && <WheelCard object={object} />}
          {object.joint && <JointCard object={object} />}
          {object.mass && <MassCard object={object} />}
          {colliders.map((collider) => (
            <ColliderCard key={collider.id} object={object} collider={collider} />
          ))}
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
          else if (event.target.value === JOINT_OPTION) {
            if (canAddJoint(object)) setJoint(object.id, newJoint())
          } else if (event.target.value === MASS_OPTION) {
            if (canAddMass(object)) setObjectMass(object.id, {})
          } else if (isColliderOption(event.target.value)) {
            if (canHaveColliders(object) && canAddCollider(object))
              setColliders(object.id, [
                ...colliders,
                newCollider(
                  objects,
                  object.id,
                  COLLIDER_OPTIONS[event.target.value],
                  // 새 Collider의 기본 크기는 같은 몸체 하위 메시의 경계 상자다(몸체 나누기는 충돌 모델과 같은
                  // jointBodyFrames, 고를 때만 계산한다)
                  robotId ? jointBodyFrames(objects, robotId) : null,
                  () => crypto.randomUUID()
                )
              ])
          } else add(event.target.value)
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
        {/* 바퀴는 오브젝트마다 하나, 로봇·CAD 루트에는 붙이지 않는다. 관절도 하나, 로봇·바퀴 오브젝트에는 붙이지 않는다.
            질량도 하나, 로봇에는 붙이지 않는다(Rigidbody 카드) */}
        <optgroup label={t('hardware.wheel.addGroup')}>
          <option value={WHEEL_OPTION} disabled={!canAddWheel(object)}>
            {t('hardware.wheel.addOption')}
          </option>
          <option value={JOINT_OPTION} disabled={!canAddJoint(object)}>
            {t('joint.addOption')}
          </option>
          <option value={MASS_OPTION} disabled={!canAddMass(object)}>
            {t('mass.addOption')}
          </option>
          {/* Collider는 Unity처럼 여러 개(한 오브젝트 MAX_OBJECT_COLLIDERS개까지) */}
          {(Object.keys(COLLIDER_OPTIONS) as (keyof typeof COLLIDER_OPTIONS)[]).map((option) => (
            <option
              key={option}
              value={option}
              disabled={!canHaveColliders(object) || !canAddCollider(object)}
              title={
                !canAddCollider(object)
                  ? t('collider.tooMany', { max: MAX_OBJECT_COLLIDERS })
                  : COLLIDER_OPTIONS[option] === 'cylinder'
                    ? t('collider.cylinderHint')
                    : undefined
              }
            >
              {t(`collider.addOptions.${COLLIDER_OPTIONS[option]}`)}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('scripts.addGroup')}>
          <option value={SCRIPT_OPTION}>{t('scripts.addOption')}</option>
        </optgroup>
      </select>
      <MassEstimateLine object={object} />
    </section>
  )
}

export default HardwareComponentsSection
