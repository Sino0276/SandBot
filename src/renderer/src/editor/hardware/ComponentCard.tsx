import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  componentDef,
  isComponentType,
  PORT_RANGES,
  type ComponentType,
  type PropertyDef
} from '../../hardware/catalog'
import { componentCodePath } from '../../hardware/codeScopes'
import {
  robotHardwareSettings,
  sharesPortClass,
  type ComponentEntry
} from '../../hardware/components'
import { hasHint, looseT, optionLabelKey, propertyLabelKey } from '../../hardware/labels'
import {
  MM_PER_METER,
  otosOffsetInchDeg,
  pinpointComponentOffsetsMm,
  robotFramePose
} from '../../hardware/mounting'
import type { Issue } from '../../hardware/validation'
import {
  findRobotId,
  type HardwareComponent,
  type HubId,
  type SceneObjects
} from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import NumberField from '../NumberField'
import TextField from '../TextField'
import IssueList from './IssueList'

const HUBS: HubId[] = ['controlHub', 'expansionHub']

function FieldRow({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="hw-row">
      <span className="hw-row-label">{label}</span>
      {children}
    </div>
  )
}

type ComponentCardProps = {
  objects: SceneObjects
  objectId: string
  component: HardwareComponent
  // 같은 로봇의 모든 컴포넌트(포트 사용 표시). 로봇 밖이면 이 오브젝트의 컴포넌트만.
  siblings: ComponentEntry[]
  // 포드 파트로 고를 수 있는 오브젝트(같은 로봇의 파트·어셈블리)
  pickableObjects: { id: string; label: string }[]
  expansionHubEnabled: boolean
  issues: Issue[]
}

// 생성 코드에 들어갈 계산값(CAD 위치에서 구한 오프셋)
function derivedText(
  t: ReturnType<typeof looseT>,
  objects: SceneObjects,
  objectId: string,
  component: HardwareComponent
): string | null {
  const props = component.props
  switch (component.type) {
    case 'pinpoint': {
      const offsets = pinpointComponentOffsetsMm(objects, objectId, props)
      return offsets
        ? t('hardware.derived.pinpoint', { x: offsets.x.toFixed(1), y: offsets.y.toFixed(1) })
        : null
    }
    case 'otos': {
      const offset = otosOffsetInchDeg(objects, objectId, Number(props.mountingAngle))
      return offset
        ? t('hardware.derived.otos', {
            x: offset.x.toFixed(2),
            y: offset.y.toFixed(2),
            h: offset.h.toFixed(1)
          })
        : null
    }
    case 'deadWheel': {
      const pose = robotFramePose(objects, objectId)
      return pose
        ? t('hardware.derived.deadWheel', {
            x: (pose.x * MM_PER_METER).toFixed(1),
            y: (pose.y * MM_PER_METER).toFixed(1)
          })
        : null
    }
    default:
      return null
  }
}

function ComponentCard({
  objects,
  objectId,
  component,
  siblings,
  pickableObjects,
  expansionHubEnabled,
  issues
}: ComponentCardProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const tl = looseT(t)
  const updateComponent = useSceneStore((state) => state.updateComponent)
  const removeComponent = useSceneStore((state) => state.removeComponent)
  if (!isComponentType(component.type)) return null
  const type: ComponentType = component.type
  const def = componentDef(type)

  const update = (patch: Partial<HardwareComponent>): void =>
    updateComponent(objectId, component.id, patch)
  const setProp = (key: string, value: string | number): void => update({ props: { [key]: value } })

  // 포트 번호 옆에 같은 자리를 쓰는 다른 장치 이름을 보여 준다
  const portLabel = (port: number): string => {
    const users = siblings
      .filter(
        (e) =>
          e.component.id !== component.id &&
          e.component.hub === component.hub &&
          e.component.port === port &&
          sharesPortClass(e.component.type, type)
      )
      .map((e) => e.component.name)
    return users.length ? t('hardware.portUsedBy', { port, names: users.join(', ') }) : String(port)
  }

  const propertyControl = (property: PropertyDef): ReactNode => {
    const label = tl(propertyLabelKey(property.key))
    const value = component.props[property.key]
    switch (property.kind) {
      case 'enum':
        return (
          <select
            className="field-select"
            aria-label={label}
            value={String(value)}
            onChange={(event) => setProp(property.key, event.target.value)}
          >
            {property.options.map((option) => (
              <option key={option} value={option}>
                {tl(optionLabelKey(property.key, option))}
              </option>
            ))}
          </select>
        )
      case 'number':
        return (
          <NumberField
            ariaLabel={label}
            value={Number(value)}
            digits={property.digits}
            onCommit={(input) =>
              setProp(
                property.key,
                Math.min(property.max ?? Infinity, Math.max(property.min ?? -Infinity, input))
              )
            }
          />
        )
      case 'text':
        return (
          <TextField
            label={label}
            value={String(value ?? '')}
            onCommit={(input) => setProp(property.key, input.trim())}
          />
        )
      case 'object':
        return (
          <select
            className="field-select"
            aria-label={label}
            value={String(value ?? '')}
            onChange={(event) => setProp(property.key, event.target.value)}
          >
            <option value="">{t('hardware.objectNone')}</option>
            {pickableObjects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.label}
              </option>
            ))}
          </select>
        )
    }
  }

  const derived = derivedText(tl, objects, objectId, component)
  const typeLabel = t(`hardware.types.${type}`)
  // 생성 코드에서 이 장치를 쓰는 식(robot.lift.liftLeft)과 상수의 형식 경로(MyBotHardware.Lift.PAR_X_MM).
  // 이름은 codeScopes가 정한 그대로다. 변수 이름 robot은 생성 Javadoc의 사용 예와 같다.
  const codePath = componentCodePath(objects, objectId, component.id)
  const robotId = codePath ? findRobotId(objects, objectId) : null
  const robotClassName = robotId ? robotHardwareSettings(objects, robotId).className : ''

  return (
    <li className="hw-card" data-component-type={type}>
      <header className="hw-card-header">
        <span className="hw-card-type">{typeLabel}</span>
        <button
          type="button"
          className="hw-card-remove"
          title={t('hardware.remove')}
          aria-label={t('hardware.removeLabel', { name: component.name || typeLabel })}
          onClick={() => removeComponent(objectId, component.id)}
        >
          ×
        </button>
      </header>
      <FieldRow label={t('hardware.deviceName')}>
        <TextField
          label={t('hardware.deviceName')}
          value={component.name}
          invalid={!component.name.trim()}
          onCommit={(name) => update({ name })}
        />
      </FieldRow>
      {codePath && (
        <div className="hw-row" title={t('hardware.javaPathHint', { className: robotClassName })}>
          <span className="hw-row-label">{t('hardware.javaPath')}</span>
          <code className="hw-path hw-code">{['robot', ...codePath.fieldPath].join('.')}</code>
        </div>
      )}
      {def.portKind === 'usb' ? (
        <FieldRow label={t('hardware.portKinds.usb')}>
          <span className="hw-static">{t('hardware.usb')}</span>
        </FieldRow>
      ) : (
        <>
          <FieldRow label={t('hardware.hub')}>
            <select
              className="field-select"
              aria-label={t('hardware.hub')}
              value={component.hub}
              onChange={(event) => {
                const hub = event.target.value as HubId
                // Expansion Hub의 내장 IMU는 BNO055뿐이다
                if (type === 'imu' && hub === 'expansionHub')
                  update({ hub, props: { chip: 'bno055' } })
                else update({ hub })
              }}
            >
              {HUBS.map((hub) => (
                <option key={hub} value={hub}>
                  {hub === 'expansionHub' && !expansionHubEnabled
                    ? t('hardware.hubOff', { hub: t(`hardware.hubs.${hub}`) })
                    : t(`hardware.hubs.${hub}`)}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label={t(`hardware.portKinds.${def.portKind}`)}>
            <select
              className="field-select"
              aria-label={t(`hardware.portKinds.${def.portKind}`)}
              value={component.port}
              // 내장 IMU는 허브의 I2C 버스 0에 고정되어 있다
              disabled={type === 'imu'}
              onChange={(event) => update({ port: Number(event.target.value) })}
            >
              {Array.from({ length: PORT_RANGES[def.portKind] }, (_, port) => (
                <option key={port} value={port}>
                  {portLabel(port)}
                </option>
              ))}
            </select>
          </FieldRow>
        </>
      )}
      {def.properties.map((property) => (
        <FieldRow key={property.key} label={tl(propertyLabelKey(property.key))}>
          {propertyControl(property)}
        </FieldRow>
      ))}
      {codePath && codePath.constants.length > 0 && (
        <div className="hw-row">
          <span className="hw-row-label">{t('hardware.javaConstants')}</span>
          <span className="hw-code-list">
            {codePath.constants.map((constant) => (
              <code key={constant} className="hw-path hw-code">
                {`${codePath.typeName}.${constant}`}
              </code>
            ))}
          </span>
        </div>
      )}
      {derived && <p className="hw-derived">{derived}</p>}
      {hasHint(type) && <p className="inspector-note">{t(`hardware.hints.${type}`)}</p>}
      <IssueList issues={issues} />
    </li>
  )
}

export default ComponentCard
