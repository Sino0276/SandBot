import type { TFunction } from 'i18next'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_JOINT_MOTORS } from '../../../../shared/sim/worldSpec'
import { usePlayStore } from '../../play/playStore'
import { DEG } from '../../scene/coordinates'
import type {
  JointAxis,
  JointDrive,
  JointSettings,
  JointType,
  SceneObject,
  SceneObjects
} from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import {
  ANGLE_DIGITS,
  formatNumber,
  fromDisplayLength,
  LENGTH_DIGITS,
  parseAngle,
  parseLength,
  toDisplayLength,
  type LengthUnit
} from '../../units/units'
import { EditableVector } from '../mass/MassVector'
import { useMassModel } from '../mass/useMassModel'
import NumberField from '../NumberField'
import {
  driveOptions,
  jointCardView,
  previewRange,
  robotAxisName,
  stageOptions,
  withLimit,
  type DriveOption,
  type JointCardView,
  type JointWarning
} from './jointCardModel'
import {
  defaultJointDrive,
  jointTypePatch,
  MAX_JOINT_ANCHOR,
  MAX_JOINT_GEAR_RATIO,
  MAX_PRISMATIC_LIMIT,
  MAX_REVOLUTE_LIMIT,
  MAX_SPOOL_DIAMETER,
  MIN_JOINT_GEAR_RATIO,
  MIN_SPOOL_DIAMETER
} from './jointDefaults'
import { clearJointPreview, setJointPreview, useJointPreviewStore } from './jointPreviewStore'
import { INTERIM_RATINGS } from './jointRatings'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))
const nonNegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0)

const JOINT_TYPES: readonly JointType[] = ['revolute', 'prismatic']
const JOINT_AXES: readonly JointAxis[] = ['x', 'y', 'z']
const DRIVE_KINDS: readonly JointDrive['kind'][] = ['none', 'motor', 'servo', 'crServo', 'stage']
const RIGGING_KINDS = ['direct', 'cascade', 'continuous'] as const
const SPRING_KINDS = ['none', 'constantForce', 'linear'] as const

// 관절 값(위치) 칸의 단위: 회전은 °(입력은 rad도), 직선은 표시 길이 단위(단위를 붙인 입력도)
type ValueUnit = {
  symbol: string
  digits: number
  toDisplay: (value: number) => number
  fromDisplay: (value: number) => number
  parse: (text: string) => number | null
  hint: string
}

function useValueUnit(type: JointType, lengthUnit: LengthUnit): ValueUnit {
  const { t } = useTranslation()
  if (type === 'revolute')
    return {
      symbol: '°',
      digits: ANGLE_DIGITS,
      toDisplay: (rad) => rad / DEG,
      fromDisplay: (deg) => deg * DEG,
      parse: (text) => {
        const rad = parseAngle(text)
        return rad === null ? null : rad / DEG
      },
      hint: t('units.angleInputHint')
    }
  const unit = t(`units.symbols.${lengthUnit}`)
  return {
    symbol: unit,
    digits: LENGTH_DIGITS[lengthUnit],
    toDisplay: (m) => toDisplayLength(m, lengthUnit),
    fromDisplay: (value) => fromDisplayLength(value, lengthUnit),
    parse: (text) => {
      const meters = parseLength(text, lengthUnit)
      return meters === null ? null : toDisplayLength(meters, lengthUnit)
    },
    hint: t('units.lengthInputHint', { unit })
  }
}

// 이름이 같은 장치가 있으면 붙은 오브젝트 이름으로 나눈다(바퀴 카드와 같음)
function optionLabel(options: readonly DriveOption[], option: DriveOption): string {
  return options.filter((o) => o.name === option.name).length > 1
    ? `${option.name} (${option.objectName})`
    : option.name
}

// 관절 카드(Unity ArticulationBody). 하드웨어 컴포넌트 카드와 같은 모양이고 시뮬레이터 설정이라 생성 코드·구성 XML과
// 관계없다. 칸 이름은 Unity를 따르고, 구동(Drive)만 FTC에 맞게 허브의 모터·서보를 고른다(목표·이득은 팀 코드와 허브
// 펌웨어가 정한다). 고칠 때마다 setJoint 한 번(실행 취소 한 단계). 미리보기 슬라이더는 씬 뷰만 움직이는 보기 상태다.
function JointCard({ object }: { object: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const setJoint = useSceneStore((state) => state.setJoint)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const batteryVoltage = usePlayStore((state) => state.settings.batteryVoltage)
  const masses = useMassModel().objects
  const joint = object.joint
  const view = useMemo(
    () => jointCardView(objects, object.id, masses, INTERIM_RATINGS, batteryVoltage),
    [objects, object.id, masses, batteryVoltage]
  )
  const valueUnit = useValueUnit(joint?.type ?? 'revolute', lengthUnit)
  // 카드가 사라지면(선택이 바뀜, 카드 떼기) 미리보기를 지운다(씬 뷰가 편집 자세로 돌아간다)
  useEffect(() => () => clearJointPreview(object.id), [object.id])
  if (!joint || !view) return null

  const update = (next: JointSettings): void => setJoint(object.id, next)
  const title = t('joint.title')
  const lengthSymbol = t(`units.symbols.${lengthUnit}`)
  const prismatic = joint.type === 'prismatic'
  const forceUnit = prismatic ? t('joint.units.force') : t('joint.units.torque')
  const limitMax = prismatic ? MAX_PRISMATIC_LIMIT : MAX_REVOLUTE_LIMIT
  const parseDisplayLength = (text: string): number | null => {
    const meters = parseLength(text, lengthUnit)
    return meters === null ? null : toDisplayLength(meters, lengthUnit)
  }

  return (
    <li className="hw-card" data-component-type="joint">
      <header className="hw-card-header">
        <span className="hw-card-type">{title}</span>
        <button
          type="button"
          className="hw-card-remove"
          title={t('hardware.remove')}
          aria-label={t('hardware.removeLabel', { name: title })}
          onClick={() => setJoint(object.id, null)}
        >
          ×
        </button>
      </header>
      {!view.inRobot && <p className="inspector-note">{t('joint.orphan')}</p>}
      <div className="hw-row">
        <span className="hw-row-label">{t('joint.type')}</span>
        <select
          className="field-select"
          aria-label={t('joint.type')}
          value={joint.type}
          onChange={(event) => {
            const type = event.target.value as JointType
            // 값의 뜻(rad ↔ m)이 바뀌므로 미리보기를 지운다
            clearJointPreview(object.id)
            update(jointTypePatch(joint, type))
          }}
        >
          {JOINT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`joint.types.${type}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="mass-vector" title={t('joint.anchorHint')}>
        <span className="hw-row-label">
          {t('joint.anchor')} <span className="vector-row-unit">{lengthSymbol}</span>
        </span>
        <div className="hw-inline">
          <EditableVector
            values={[
              toDisplayLength(joint.anchor[0], lengthUnit),
              toDisplayLength(joint.anchor[1], lengthUnit),
              toDisplayLength(joint.anchor[2], lengthUnit)
            ]}
            digits={LENGTH_DIGITS[lengthUnit]}
            parse={parseDisplayLength}
            title={t('units.lengthInputHint', { unit: lengthSymbol })}
            onCommit={(axis, value) => {
              const anchor: [number, number, number] = [...joint.anchor]
              anchor[axis] = clamp(
                fromDisplayLength(value, lengthUnit),
                -MAX_JOINT_ANCHOR,
                MAX_JOINT_ANCHOR
              )
              update({ ...joint, anchor })
            }}
          />
          <button
            type="button"
            className="panel-button"
            title={t('joint.anchorResetHint')}
            disabled={joint.anchor.every((x) => x === 0)}
            onClick={() => update({ ...joint, anchor: [0, 0, 0] })}
          >
            {t('joint.anchorReset')}
          </button>
        </div>
      </div>
      <div className="hw-row" title={t('joint.axisHint')}>
        <span className="hw-row-label">{t('joint.axis')}</span>
        <div className="hw-inline">
          <select
            className="field-select"
            aria-label={t('joint.axisSign')}
            value={joint.axisSign}
            onChange={(event) =>
              update({ ...joint, axisSign: Number(event.target.value) === -1 ? -1 : 1 })
            }
          >
            <option value={1}>+</option>
            <option value={-1}>−</option>
          </select>
          <select
            className="field-select"
            aria-label={t('joint.axis')}
            value={joint.axis}
            onChange={(event) => update({ ...joint, axis: event.target.value as JointAxis })}
          >
            {JOINT_AXES.map((axis) => (
              <option key={axis} value={axis}>
                {axis.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="hw-derived">{robotAxisText(t, view)}</p>
      {!prismatic && (
        <div className="hw-row" title={t('joint.limitedHint')}>
          <span className="hw-row-label">{t('joint.limits')}</span>
          <label className="hw-check">
            <input
              type="checkbox"
              checked={joint.limits !== null}
              onChange={(event) =>
                update({
                  ...joint,
                  limits: event.target.checked ? { lower: -Math.PI / 2, upper: Math.PI / 2 } : null
                })
              }
            />
            {t('joint.limited')}
          </label>
        </div>
      )}
      {joint.limits &&
        (['lower', 'upper'] as const).map((edge) => (
          <div key={edge} className="hw-row" title={t('joint.limitsHint')}>
            <span className="hw-row-label">{`${t(`joint.${edge}`)} (${valueUnit.symbol})`}</span>
            <NumberField
              ariaLabel={t(`joint.${edge}`)}
              value={valueUnit.toDisplay(joint.limits![edge])}
              digits={valueUnit.digits}
              parse={valueUnit.parse}
              title={valueUnit.hint}
              onCommit={(input) =>
                update({
                  ...joint,
                  limits: withLimit(
                    joint.limits!,
                    edge,
                    clamp(valueUnit.fromDisplay(input), -limitMax, limitMax)
                  )
                })
              }
            />
          </div>
        ))}
      <div className="hw-row" title={t('joint.frictionHint')}>
        <span className="hw-row-label">{`${t('joint.friction')} (${forceUnit})`}</span>
        <NumberField
          ariaLabel={t('joint.friction')}
          value={joint.friction.coulomb}
          digits={3}
          onCommit={(input) =>
            update({ ...joint, friction: { ...joint.friction, coulomb: nonNegative(input) } })
          }
        />
      </div>
      <div className="hw-row" title={t('joint.dampingHint')}>
        <span className="hw-row-label">
          {`${t('joint.damping')} (${prismatic ? t('joint.units.linearDamping') : t('joint.units.rotaryDamping')})`}
        </span>
        <NumberField
          ariaLabel={t('joint.damping')}
          value={joint.friction.viscous}
          digits={4}
          onCommit={(input) =>
            update({ ...joint, friction: { ...joint.friction, viscous: nonNegative(input) } })
          }
        />
      </div>
      <SpringRows joint={joint} valueUnit={valueUnit} forceUnit={forceUnit} update={update} />
      <DriveRows
        objects={objects}
        object={object}
        joint={joint}
        view={view}
        lengthUnit={lengthUnit}
        update={update}
      />
      <DerivedLines joint={joint} view={view} valueUnit={valueUnit} volts={batteryVoltage} />
      <PreviewRow objectId={object.id} joint={joint} valueUnit={valueUnit} />
      <p className="inspector-note">{t('joint.hint')}</p>
      {view.warnings.length > 0 && (
        <ul className="hw-issues">
          {view.warnings.map((warning, index) => (
            <li key={`${warning.key}-${index}`} className="hw-issue is-warning">
              {warningText(t, warning)}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function robotAxisText(t: TFunction, view: JointCardView): string {
  const name = robotAxisName(view.robotAxis)
  const axis =
    name !== null
      ? t(`joint.robotAxes.${name}`)
      : t('joint.robotAxisVector', {
          x: formatNumber(view.robotAxis[0], 2),
          y: formatNumber(view.robotAxis[1], 2),
          z: formatNumber(view.robotAxis[2], 2)
        })
  return view.inRobot ? t('joint.robotAxis', { axis }) : t('joint.fieldAxis', { axis })
}

function warningText(t: TFunction, warning: JointWarning): string {
  switch (warning.key) {
    case 'motorOnWheel':
      return t('joint.warnings.motorOnWheel', { motor: warning.motor })
    case 'motorShared':
      return t('joint.warnings.motorShared', { motor: warning.motor, joint: warning.joint })
    case 'stageInvalid':
      return t('joint.warnings.stageInvalid', { stage: warning.stage })
    case 'massPending':
      return t('joint.warnings.massPending', { count: warning.count })
    default:
      return t(`joint.warnings.${warning.key}`)
  }
}

function SpringRows({
  joint,
  valueUnit,
  forceUnit,
  update
}: {
  joint: JointSettings
  valueUnit: ValueUnit
  forceUnit: string
  update: (next: JointSettings) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const spring = joint.spring
  const prismatic = joint.type === 'prismatic'
  return (
    <>
      <div className="hw-row" title={t('joint.springHint')}>
        <span className="hw-row-label">{t('joint.spring')}</span>
        <select
          className="field-select"
          aria-label={t('joint.spring')}
          value={spring?.kind ?? 'none'}
          onChange={(event) => {
            const kind = event.target.value as (typeof SPRING_KINDS)[number]
            update({
              ...joint,
              spring:
                kind === 'none'
                  ? null
                  : kind === 'constantForce'
                    ? { kind, force: 0 }
                    : { kind, stiffness: 0, rest: 0 }
            })
          }}
        >
          {SPRING_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`joint.springKinds.${kind}`)}
            </option>
          ))}
        </select>
      </div>
      {spring?.kind === 'constantForce' && (
        <div className="hw-row" title={t('joint.springForceHint')}>
          <span className="hw-row-label">{`${t('joint.springForce')} (${forceUnit})`}</span>
          <NumberField
            ariaLabel={t('joint.springForce')}
            value={spring.force}
            digits={2}
            onCommit={(input) => update({ ...joint, spring: { ...spring, force: input } })}
          />
        </div>
      )}
      {spring?.kind === 'linear' && (
        <>
          <div className="hw-row" title={t('joint.springStiffnessHint')}>
            <span className="hw-row-label">
              {`${t('joint.springStiffness')} (${prismatic ? t('joint.units.linearStiffness') : t('joint.units.rotaryStiffness')})`}
            </span>
            <NumberField
              ariaLabel={t('joint.springStiffness')}
              value={spring.stiffness}
              digits={3}
              onCommit={(input) =>
                update({ ...joint, spring: { ...spring, stiffness: nonNegative(input) } })
              }
            />
          </div>
          <div className="hw-row" title={t('joint.springRestHint')}>
            <span className="hw-row-label">{`${t('joint.springRest')} (${valueUnit.symbol})`}</span>
            <NumberField
              ariaLabel={t('joint.springRest')}
              value={valueUnit.toDisplay(spring.rest)}
              digits={valueUnit.digits}
              parse={valueUnit.parse}
              title={valueUnit.hint}
              onCommit={(input) =>
                update({ ...joint, spring: { ...spring, rest: valueUnit.fromDisplay(input) } })
              }
            />
          </div>
        </>
      )}
    </>
  )
}

function GearRatioRow({
  value,
  onCommit
}: {
  value: number
  onCommit: (value: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="hw-row" title={t('joint.gearRatioHint')}>
      <span className="hw-row-label">{t('joint.gearRatio')}</span>
      <NumberField
        ariaLabel={t('joint.gearRatio')}
        value={value}
        digits={2}
        onCommit={(input) => onCommit(clamp(input, MIN_JOINT_GEAR_RATIO, MAX_JOINT_GEAR_RATIO))}
      />
    </div>
  )
}

function SpoolRow({
  value,
  lengthUnit,
  onCommit
}: {
  value: number
  lengthUnit: LengthUnit
  onCommit: (value: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const unit = t(`units.symbols.${lengthUnit}`)
  return (
    <div className="hw-row" title={t('joint.spoolDiameterHint')}>
      <span className="hw-row-label">{`${t('joint.spoolDiameter')} (${unit})`}</span>
      <NumberField
        ariaLabel={t('joint.spoolDiameter')}
        value={toDisplayLength(value, lengthUnit)}
        digits={LENGTH_DIGITS[lengthUnit]}
        title={t('units.lengthInputHint', { unit })}
        parse={(text) => {
          const meters = parseLength(text, lengthUnit)
          return meters === null ? null : toDisplayLength(meters, lengthUnit)
        }}
        onCommit={(input) =>
          onCommit(
            clamp(fromDisplayLength(input, lengthUnit), MIN_SPOOL_DIAMETER, MAX_SPOOL_DIAMETER)
          )
        }
      />
    </div>
  )
}

function DriveRows({
  objects,
  object,
  joint,
  view,
  lengthUnit,
  update
}: {
  objects: SceneObjects
  object: SceneObject
  joint: JointSettings
  view: JointCardView
  lengthUnit: LengthUnit
  update: (next: JointSettings) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const drive = joint.drive
  const prismatic = joint.type === 'prismatic'
  const motorOptions = useMemo(
    () => driveOptions(objects, object.id, 'motor'),
    [objects, object.id]
  )
  const servoKind = drive.kind === 'servo' || drive.kind === 'crServo' ? drive.kind : null
  const servoOptions = useMemo(
    () => (servoKind ? driveOptions(objects, object.id, servoKind) : []),
    [objects, object.id, servoKind]
  )
  const stages = useMemo(() => stageOptions(objects, object.id), [objects, object.id])
  const setDrive = (next: JointDrive): void => update({ ...joint, drive: next })

  return (
    <>
      <div className="hw-row" title={t('joint.driveHint')}>
        <span className="hw-row-label">{t('joint.drive')}</span>
        <select
          className="field-select"
          aria-label={t('joint.drive')}
          value={drive.kind}
          onChange={(event) =>
            setDrive(defaultJointDrive(event.target.value as JointDrive['kind']))
          }
        >
          {DRIVE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`joint.driveKinds.${kind}`)}
            </option>
          ))}
        </select>
      </div>
      {drive.kind === 'motor' && (
        <>
          <div className="hw-row" title={t('joint.motorsHint', { max: MAX_JOINT_MOTORS })}>
            <span className="hw-row-label">{t('joint.motors')}</span>
            <div className="joint-device-list" role="group" aria-label={t('joint.motors')}>
              {motorOptions.length === 0 && (
                <span className="hw-static">{t('joint.noMotorOptions')}</span>
              )}
              {motorOptions.map((option) => {
                const checked = drive.motors.includes(option.id)
                return (
                  <label key={option.id} className="hw-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && drive.motors.length >= MAX_JOINT_MOTORS}
                      onChange={(event) =>
                        setDrive({
                          ...drive,
                          motors: event.target.checked
                            ? [...drive.motors, option.id]
                            : drive.motors.filter((id) => id !== option.id)
                        })
                      }
                    />
                    {optionLabel(motorOptions, option)}
                  </label>
                )
              })}
              {/* 지웠거나 다른 로봇의 모터: 참조는 남기고(실행 취소로 되살아날 수 있다) 뗄 수 있게 보인다 */}
              {drive.motors
                .filter((id) => !motorOptions.some((option) => option.id === id))
                .map((id) => (
                  <label key={id} className="hw-check">
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setDrive({ ...drive, motors: drive.motors.filter((m) => m !== id) })
                      }
                    />
                    {t('joint.motorMissing')}
                  </label>
                ))}
            </div>
          </div>
          <GearRatioRow
            value={drive.gearRatio}
            onCommit={(gearRatio) => setDrive({ ...drive, gearRatio })}
          />
          {prismatic && (
            <SpoolRow
              value={drive.spoolDiameter}
              lengthUnit={lengthUnit}
              onCommit={(spoolDiameter) => setDrive({ ...drive, spoolDiameter })}
            />
          )}
          {prismatic && (
            <div className="hw-row" title={t('joint.riggingHint')}>
              <span className="hw-row-label">{t('joint.rigging')}</span>
              <select
                className="field-select"
                aria-label={t('joint.rigging')}
                value={drive.rigging.kind}
                onChange={(event) => {
                  const kind = event.target.value as (typeof RIGGING_KINDS)[number]
                  const kept = drive.rigging.kind === 'direct' ? [] : drive.rigging.stages
                  setDrive({
                    ...drive,
                    rigging: kind === 'direct' ? { kind } : { kind, stages: kept }
                  })
                }}
              >
                {RIGGING_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`joint.riggingKinds.${kind}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {prismatic && drive.rigging.kind !== 'direct' && (
            <StageList
              objects={objects}
              stages={drive.rigging.stages}
              options={stages}
              onChange={(next) =>
                drive.rigging.kind !== 'direct' &&
                setDrive({ ...drive, rigging: { kind: drive.rigging.kind, stages: next } })
              }
            />
          )}
        </>
      )}
      {servoKind && (drive.kind === 'servo' || drive.kind === 'crServo') && (
        <>
          <div className="hw-row">
            <span className="hw-row-label">{t('joint.device')}</span>
            <select
              className="field-select"
              aria-label={t('joint.device')}
              value={drive.servo}
              onChange={(event) => setDrive({ ...drive, servo: event.target.value })}
            >
              <option value="">{t('joint.deviceNone')}</option>
              {drive.servo !== '' && !servoOptions.some((option) => option.id === drive.servo) && (
                <option value={drive.servo}>{t('joint.deviceMissing')}</option>
              )}
              {servoOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {optionLabel(servoOptions, option)}
                </option>
              ))}
            </select>
          </div>
          <GearRatioRow
            value={drive.gearRatio}
            onCommit={(gearRatio) => setDrive({ ...drive, gearRatio })}
          />
          {drive.kind === 'crServo' && prismatic && (
            <SpoolRow
              value={drive.spoolDiameter}
              lengthUnit={lengthUnit}
              onCommit={(spoolDiameter) => setDrive({ ...drive, spoolDiameter })}
            />
          )}
        </>
      )}
      {drive.kind === 'stage' && view.stageOf && objects[view.stageOf] && (
        <p className="hw-derived">{t('joint.stageOf', { name: objects[view.stageOf].name })}</p>
      )}
    </>
  )
}

// 다단 슬라이드의 위 단 목록(아래에서 위 순서). 후보는 이 관절 하위의 직선 관절이다.
function StageList({
  objects,
  stages,
  options,
  onChange
}: {
  objects: SceneObjects
  stages: readonly string[]
  options: readonly { id: string; name: string }[]
  onChange: (stages: string[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const addable = options.filter((option) => !stages.includes(option.id))
  return (
    <div className="hw-row" title={t('joint.stagesHint')}>
      <span className="hw-row-label">{t('joint.stages')}</span>
      <div className="joint-device-list">
        {stages.map((id, index) => {
          const name = objects[id]?.name ?? t('joint.stageMissing')
          return (
            <span key={id} className="joint-stage">
              <span className="joint-stage-name">{`${index + 1}. ${name}`}</span>
              <button
                type="button"
                className="hw-card-remove"
                title={t('joint.stageRemove')}
                aria-label={t('joint.stageRemoveLabel', { name })}
                onClick={() => onChange(stages.filter((stage) => stage !== id))}
              >
                ×
              </button>
            </span>
          )
        })}
        {options.length === 0 ? (
          <span className="hw-static">{t('joint.stageNone')}</span>
        ) : (
          <select
            className="field-select"
            aria-label={t('joint.stageAdd')}
            value=""
            disabled={addable.length === 0}
            onChange={(event) => {
              if (event.target.value) onChange([...stages, event.target.value])
              event.currentTarget.blur()
            }}
          >
            <option value="" disabled>
              {t('joint.stageAdd')}
            </option>
            {addable.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

// 계산값: 최고 속도(무부하), 편집 자세의 중력 부하와 장치 정지 토크, 여유
function DerivedLines({
  joint,
  view,
  valueUnit,
  volts
}: {
  joint: JointSettings
  view: JointCardView
  valueUnit: ValueUnit
  volts: number
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (joint.drive.kind === 'none' || joint.drive.kind === 'stage') return null
  const prismatic = joint.type === 'prismatic'
  const speedUnit = `${valueUnit.symbol}/s`
  const speedDigits = prismatic ? valueUnit.digits : 0
  const speed = (value: number): string => formatNumber(valueUnit.toDisplay(value), speedDigits)
  const forceUnit = prismatic ? t('joint.units.force') : t('joint.units.torque')
  const force = (value: number): string => formatNumber(value, prismatic ? 1 : 2)
  const motor = joint.drive.kind === 'motor'
  return (
    <>
      <p className="hw-derived">
        {view.maxSpeed === null
          ? t('joint.maxSpeedUnknown')
          : t(motor ? 'joint.maxSpeedMotor' : 'joint.maxSpeedServo', {
              speed: speed(view.maxSpeed),
              unit: speedUnit,
              volts: formatNumber(volts, 1)
            })}
      </p>
      {view.endSpeed !== null && (
        <p className="hw-derived">
          {t('joint.endSpeed', { speed: speed(view.endSpeed), unit: speedUnit })}
        </p>
      )}
      <p className="hw-derived" title={t('joint.loadHint')}>
        {view.load > 0
          ? t('joint.load', { load: force(view.load), unit: forceUnit })
          : t('joint.loadNone')}
      </p>
      <p className="hw-derived" title={t('joint.capacityHint')}>
        {view.capacity === null
          ? t('joint.capacityUnknown')
          : t(view.margin === null ? 'joint.capacity' : 'joint.capacityMargin', {
              capacity: force(view.capacity),
              unit: forceUnit,
              margin: view.margin === null ? '' : formatNumber(view.margin, 1)
            })}
      </p>
    </>
  )
}

// 미리보기 슬라이더(Unity에는 없는 편의 기능): 씬 뷰에서 관절을 움직여 보기만 한다(씬 문서·실행 취소와 관계없음)
function PreviewRow({
  objectId,
  joint,
  valueUnit
}: {
  objectId: string
  joint: JointSettings
  valueUnit: ValueUnit
}): React.JSX.Element {
  const { t } = useTranslation()
  const stored = useJointPreviewStore((state) => state.values[objectId])
  const range = previewRange(joint)
  const value = stored === undefined ? 0 : clamp(stored, range.min, range.max)
  // 슬라이더 한 칸: 회전 0.5°, 직선 1 mm(가정: 손으로 끌기에 충분히 잘다)
  const step = joint.type === 'revolute' ? 0.5 * DEG : 0.001
  return (
    <div className="hw-row" title={t('joint.previewHint')}>
      <span className="hw-row-label">{t('joint.preview')}</span>
      <div className="hw-inline">
        <input
          type="range"
          className="joint-preview"
          aria-label={t('joint.preview')}
          min={range.min}
          max={range.max}
          step={step}
          value={value}
          onChange={(event) => setJointPreview(objectId, Number(event.target.value))}
        />
        <output className="hw-static">{`${formatNumber(valueUnit.toDisplay(value), valueUnit.digits)} ${valueUnit.symbol}`}</output>
        <button
          type="button"
          className="panel-button"
          disabled={stored === undefined}
          onClick={() => clearJointPreview(objectId)}
        >
          {t('joint.previewReset')}
        </button>
      </div>
    </div>
  )
}

export default JointCard
