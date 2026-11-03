import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  componentDef,
  deadWheelTicksPerMeter,
  isComponentType,
  isMotorModel,
  isPropertyVisible,
  MIN_GEARBOX,
  MOTOR_MODEL_TAGS,
  motorGearbox,
  motorOutput,
  PORT_RANGES,
  type ComponentType,
  type ObjectPick,
  type PropertyDef
} from '../../hardware/catalog'
import { componentCodePath } from '../../hardware/codeScopes'
import {
  robotHardwareSettings,
  sharesPortClass,
  type ComponentEntry
} from '../../hardware/components'
import {
  hasHint,
  looseT,
  optionLabelKey,
  propertyHintKey,
  propertyLabelKey
} from '../../hardware/labels'
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
  type JointType,
  type SceneObjects
} from '../../scene/model'
import { DEG } from '../../scene/coordinates'
import { motorDrivesJoint } from '../../scene/joint'
import { motorComponentParams } from '../../play/worldJoints'
import { jointEncoderTicksPerOutputRev } from '../../../../shared/sim/actuatorData'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import {
  ANGLE_DIGITS,
  formatNumber,
  fromDisplayLength,
  LENGTH_DIGITS,
  parseAngle,
  parseLength,
  toDisplayLength
} from '../../units/units'
import NumberField from '../NumberField'
import TextField from '../TextField'
import UsageSection from '../usages/UsageSection'
import IssueList from './IssueList'
import type { ObjectOption } from './objectOptions'

const HUBS: HubId[] = ['controlHub', 'expansionHub']

function FieldRow({
  label,
  title,
  children
}: {
  label: string
  title?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="hw-row" title={title}>
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
  // object 속성으로 고를 수 있는 오브젝트(고르기 종류마다, editor/hardware/objectOptions.ts). 없는 종류는 빈 목록이다.
  objectOptions: Partial<Record<ObjectPick, ObjectOption[]>>
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

// 시뮬레이터 전용 속성에서 구한 값(모터 출력축 속도·틱, 데드휠 포드 해상도). 생성 코드와 관계없다. 관절을 구동하는 모터는
// 관절 시뮬레이션이 쓰는 값(데이터시트 기어모터 표의 실제 감속비·무부하 속도와 덮어쓰기, 출력축 틱 = 모터축 카운트 × 실제
// 감속비 — world.ts와 같은 jointEncoderTicksPerOutputRev)이고, 구동계 바퀴 규칙(SDK ticksPerRev ÷ gearing × gearbox)과
// 다를 수 있어(UltraPlanetary 560 → 530, Core Hex 72:1은 288) 실제 감속비를 함께 보인다.
function simulationText(
  t: ReturnType<typeof looseT>,
  component: HardwareComponent,
  drivesJoint: boolean
): string | null {
  switch (component.type) {
    case 'motor': {
      if (drivesJoint) {
        const params = motorComponentParams(component.props)
        const model = isMotorModel(component.props.motorModel)
          ? component.props.motorModel
          : 'unspecified'
        return t('hardware.derived.jointMotorOutput', {
          rpm: formatNumber((params.freeSpeed * 60) / (2 * Math.PI), 0),
          ticks: formatNumber(
            jointEncoderTicksPerOutputRev(MOTOR_MODEL_TAGS[model], params.gearbox),
            1
          ),
          ratio: formatNumber(params.gearbox, 2)
        })
      }
      const output = motorOutput(component.props)
      return t('hardware.derived.motorOutput', {
        rpm: formatNumber(output.freeRpm, 0),
        ticks: formatNumber(output.ticksPerRev, 1)
      })
    }
    case 'deadWheel':
      return t('hardware.derived.deadWheelPod', {
        ticks: formatNumber(deadWheelTicksPerMeter(component.props) / 1000, 3)
      })
    default:
      return null
  }
}

function ComponentCard({
  objects,
  objectId,
  component,
  siblings,
  objectOptions,
  expansionHubEnabled,
  issues
}: ComponentCardProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const tl = looseT(t)
  const updateComponent = useSceneStore((state) => state.updateComponent)
  const removeComponent = useSceneStore((state) => state.removeComponent)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  if (!isComponentType(component.type)) return null
  const type: ComponentType = component.type
  const def = componentDef(type)

  const update = (patch: Partial<HardwareComponent>): void =>
    updateComponent(objectId, component.id, patch)
  const setProp = (key: string, value: string | number): void => update({ props: { [key]: value } })
  // 정지 토크·무부하 속도 덮어쓰기는 관절 구동만 읽는다(visibleWhenDrivesJoint). 관절을 구동하는 모터의 감속비 "모델
  // 기본"과 출력축 줄은 관절 시뮬레이션의 값(데이터시트 실제 감속비)이다.
  const drivesJoint = type === 'motor' && motorDrivesJoint(objects, objectId, component.id)
  const simulated = simulationText(tl, component, drivesJoint)

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
        // 감속비 0은 모델 기본: 실제로 쓰는 값을 보이고, 아주 작은 값을 넣으면 모델 기본으로 돌린다. 구동계 바퀴는 SDK
        // gearing(motorGearbox), 관절 구동은 데이터시트 표의 실제 감속비(UltraPlanetary 18.93, Core Hex 72)다. 그래서 보이는
        // 값을 그대로 다시 넣어도 관절 물리가 같다(SDK gearing 36.25를 넣으면 Core Hex 관절이 36.25:1이 되던 함정).
        if (property.key === 'gearbox') {
          const modelDefault = Number(value) < MIN_GEARBOX
          return (
            <div className="hw-inline">
              <NumberField
                ariaLabel={label}
                value={
                  modelDefault && drivesJoint
                    ? motorComponentParams(component.props).gearbox
                    : motorGearbox(component.props)
                }
                digits={property.digits}
                onCommit={(input) =>
                  setProp(
                    property.key,
                    input < MIN_GEARBOX ? 0 : Math.min(property.max ?? Infinity, input)
                  )
                }
              />
              {modelDefault ? (
                <span className="hw-static">{t('hardware.gearboxModelDefault')}</span>
              ) : (
                <button
                  type="button"
                  className="panel-button"
                  title={t(
                    drivesJoint ? 'hardware.gearboxResetHintJoint' : 'hardware.gearboxResetHint'
                  )}
                  onClick={() => setProp(property.key, 0)}
                >
                  {t('hardware.gearboxReset')}
                </button>
              )}
            </div>
          )
        }
        return (
          <NumberField
            ariaLabel={label}
            value={Number(value)}
            digits={property.digits}
            onCommit={(input) =>
              setProp(
                property.key,
                // 0이 기본값인 덮어쓰기 칸은 아주 작은 값을 기본으로 돌린다(zeroBelow)
                input < (property.zeroBelow ?? -Infinity)
                  ? 0
                  : Math.min(property.max ?? Infinity, Math.max(property.min ?? -Infinity, input))
              )
            }
          />
        )
      case 'length': {
        const unit = t(`units.symbols.${lengthUnit}`)
        return (
          <NumberField
            ariaLabel={label}
            value={toDisplayLength(Number(value), lengthUnit)}
            digits={LENGTH_DIGITS[lengthUnit]}
            title={t('units.lengthInputHint', { unit })}
            parse={(text) => {
              const meters = parseLength(text, lengthUnit)
              return meters === null ? null : toDisplayLength(meters, lengthUnit)
            }}
            onCommit={(input) =>
              setProp(
                property.key,
                Math.min(property.max, Math.max(property.min, fromDisplayLength(input, lengthUnit)))
              )
            }
          />
        )
      }
      case 'angle':
        return (
          <NumberField
            ariaLabel={label}
            value={Number(value) / DEG}
            digits={ANGLE_DIGITS}
            title={t('units.angleInputHint')}
            parse={(text) => {
              const radians = parseAngle(text)
              return radians === null ? null : radians / DEG
            }}
            onCommit={(input) =>
              setProp(property.key, Math.min(property.max, Math.max(property.min, input * DEG)))
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
      case 'object': {
        const options = objectOptions[property.pick ?? 'any'] ?? []
        const current = String(value ?? '')
        return (
          <select
            className="field-select"
            aria-label={label}
            value={current}
            onChange={(event) => setProp(property.key, event.target.value)}
          >
            <option value="">{t('hardware.objectNone')}</option>
            {/* 지웠거나 고를 수 없게 된 오브젝트: 참조는 남기고(세계 설명이 경고한다) 그렇다고 보인다 */}
            {current !== '' && !options.some((object) => object.id === current) && (
              <option value={current}>{t('hardware.objectMissing')}</option>
            )}
            {options.map((object) => (
              <option key={object.id} value={object.id}>
                {object.label}
              </option>
            ))}
          </select>
        )
      }
    }
  }

  const derived = derivedText(tl, objects, objectId, component)
  const rowLabel = (property: PropertyDef): string =>
    property.kind === 'length'
      ? `${tl(propertyLabelKey(property.key))} (${t(`units.symbols.${lengthUnit}`)})`
      : property.kind === 'angle'
        ? `${tl(propertyLabelKey(property.key))} (°)`
        : tl(propertyLabelKey(property.key))
  // 리밋 스위치 칸은 연결한 관절의 형식을 따른다(visibleWhenJoint). 같은 로봇의 관절 오브젝트만 관절로 본다(세계 설명과 같다)
  const jointTypeOf = (id: string): JointType | null =>
    objectOptions.joint?.some((option) => option.id === id)
      ? (objects[id]?.joint?.type ?? null)
      : null
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
      {/* 이 장치를 TeamCode에서 쓰는 곳(생성 필드·상수, 구성 이름 문자열). 로봇 밖·카탈로그 밖 종류는 없다. */}
      {codePath && (
        <UsageSection target={{ kind: 'device', objectId, componentId: component.id }} />
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
      {def.properties
        .filter((property) =>
          isPropertyVisible(property, component.props, jointTypeOf, drivesJoint)
        )
        .map((property) => (
          <FieldRow
            key={property.key}
            label={rowLabel(property)}
            // 시뮬레이터 전용 속성은 생성 코드에 쓰지 않는다
            title={
              [
                property.hint ? tl(propertyHintKey(property.key)) : '',
                property.simulation ? t('hardware.simulationOnly') : ''
              ]
                .filter((text) => text !== '')
                .join(' ') || undefined
            }
          >
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
      {simulated && (
        <p className="hw-derived" title={t('hardware.simulationOnly')}>
          {simulated}
        </p>
      )}
      {hasHint(type) && <p className="inspector-note">{t(`hardware.hints.${type}`)}</p>}
      <IssueList issues={issues} />
    </li>
  )
}

export default ComponentCard
