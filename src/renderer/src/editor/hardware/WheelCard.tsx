import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlayStore } from '../../play/playStore'
import { wheelTopSpeed } from '../../play/worldSpec'
import { DEG } from '../../scene/coordinates'
import type { SceneObject, WheelKind, WheelRollers, WheelSettings } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import {
  MAX_WHEEL_DIAMETER,
  MAX_WHEEL_GEAR_RATIO,
  MIN_WHEEL_DIAMETER,
  MIN_WHEEL_GEAR_RATIO,
  WHEEL_KINDS,
  WHEEL_ROLLERS
} from '../../scene/wheel'
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
import {
  suggestWheelDiameter,
  wheelCardView,
  wheelKindPatch,
  wheelMotorOptions
} from './wheelCardModel'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

// 바퀴 카드(Unity WheelCollider처럼 바퀴 파트에 붙이는 시뮬레이터 설정). 하드웨어 컴포넌트 카드와 같은 모양이다.
// 생성 코드·구성 XML과 관계없다. 위치는 이 오브젝트(그룹이면 하위 파트들의 중심)에서 세계 설명이 정한다.
function WheelCard({ object }: { object: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  // 형상을 다 읽은 뒤에야 [파트 크기로]가 잴 수 있으므로 형상이 등록될 때마다 다시 그린다
  useSceneStore((state) => state.geometryRevision)
  const setWheel = useSceneStore((state) => state.setWheel)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const batteryVoltage = usePlayStore((state) => state.settings.batteryVoltage)
  const view = useMemo(() => wheelCardView(objects, object.id), [objects, object.id])
  const motorOptions = useMemo(() => wheelMotorOptions(objects, object.id), [objects, object.id])
  const suggested = suggestWheelDiameter(objects, object.id)
  const wheel = object.wheel
  if (!wheel) return null

  const update = (patch: Partial<WheelSettings>): void =>
    setWheel(object.id, { ...wheel, ...patch })
  const unit = t(`units.symbols.${lengthUnit}`)
  const title = t('hardware.wheel.title')
  const motorKnown = wheel.motor === '' || motorOptions.some((m) => m.id === wheel.motor)
  // 이름이 같은 모터가 있으면 붙은 오브젝트 이름으로 나눈다
  const motorLabel = (option: { name: string; objectName: string }): string =>
    motorOptions.filter((m) => m.name === option.name).length > 1
      ? `${option.name} (${option.objectName})`
      : option.name
  const topSpeed =
    view.motorState === 'ok' && view.motor
      ? wheelTopSpeed(wheel, view.motor.props, batteryVoltage)
      : null
  const rollerLabel = (rollers: WheelRollers): string =>
    rollers === 'auto' && view.rollers
      ? t('hardware.wheel.rollersAuto', {
          type: t(`hardware.wheel.rollerOptions.${view.rollers}`)
        })
      : t(`hardware.wheel.rollerOptions.${rollers}`)

  return (
    <li className="hw-card" data-component-type="wheel">
      <header className="hw-card-header">
        <span className="hw-card-type">{title}</span>
        <button
          type="button"
          className="hw-card-remove"
          title={t('hardware.remove')}
          aria-label={t('hardware.removeLabel', { name: title })}
          onClick={() => setWheel(object.id, null)}
        >
          ×
        </button>
      </header>
      {!view.inRobot && <p className="inspector-note">{t('hardware.wheel.orphan')}</p>}
      <div className="hw-row">
        <span className="hw-row-label">{t('hardware.wheel.kind')}</span>
        <select
          className="field-select"
          aria-label={t('hardware.wheel.kind')}
          value={wheel.kind}
          onChange={(event) => update(wheelKindPatch(wheel, event.target.value as WheelKind))}
        >
          {WHEEL_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`hardware.wheel.kinds.${kind}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="hw-row">
        <span className="hw-row-label">{`${t('hardware.wheel.diameter')} (${unit})`}</span>
        <div className="hw-inline">
          <NumberField
            ariaLabel={t('hardware.wheel.diameter')}
            value={toDisplayLength(wheel.diameter, lengthUnit)}
            digits={LENGTH_DIGITS[lengthUnit]}
            title={t('units.lengthInputHint', { unit })}
            parse={(text) => {
              const meters = parseLength(text, lengthUnit)
              return meters === null ? null : toDisplayLength(meters, lengthUnit)
            }}
            onCommit={(input) =>
              update({
                diameter: clamp(
                  fromDisplayLength(input, lengthUnit),
                  MIN_WHEEL_DIAMETER,
                  MAX_WHEEL_DIAMETER
                )
              })
            }
          />
          <button
            type="button"
            className="panel-button"
            disabled={suggested === null}
            title={
              suggested === null ? t('hardware.wheel.fitSizeNone') : t('hardware.wheel.fitSizeHint')
            }
            onClick={() => suggested !== null && update({ diameter: suggested })}
          >
            {t('hardware.wheel.fitSize')}
          </button>
        </div>
      </div>
      <div className="hw-row">
        <span className="hw-row-label">{t('hardware.wheel.motor')}</span>
        <select
          className="field-select"
          aria-label={t('hardware.wheel.motor')}
          value={wheel.motor}
          onChange={(event) => update({ motor: event.target.value })}
        >
          <option value="">{t('hardware.wheel.motorNone')}</option>
          {/* 지웠거나 다른 로봇의 모터: 참조는 남기고(실행 취소로 되살아날 수 있다) 그대로 보인다 */}
          {!motorKnown && <option value={wheel.motor}>{t('hardware.wheel.motorMissing')}</option>}
          {motorOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {motorLabel(option)}
            </option>
          ))}
        </select>
      </div>
      <div className="hw-row" title={t('hardware.wheel.gearRatioHint')}>
        <span className="hw-row-label">{t('hardware.wheel.gearRatio')}</span>
        <NumberField
          ariaLabel={t('hardware.wheel.gearRatio')}
          value={wheel.gearRatio}
          digits={2}
          onCommit={(input) =>
            update({ gearRatio: clamp(input, MIN_WHEEL_GEAR_RATIO, MAX_WHEEL_GEAR_RATIO) })
          }
        />
      </div>
      <div className="hw-row" title={t('hardware.wheel.angleHint')}>
        <span className="hw-row-label">{t('hardware.wheel.angle')}</span>
        <NumberField
          ariaLabel={t('hardware.wheel.angle')}
          value={wheel.angle / DEG}
          digits={ANGLE_DIGITS}
          parse={(text) => {
            const radians = parseAngle(text)
            return radians === null ? null : radians / DEG
          }}
          onCommit={(input) => update({ angle: input * DEG })}
        />
      </div>
      {wheel.kind === 'mecanum' && (
        <div className="hw-row" title={t('hardware.wheel.rollersHint')}>
          <span className="hw-row-label">{t('hardware.wheel.rollers')}</span>
          <select
            className="field-select"
            aria-label={t('hardware.wheel.rollers')}
            value={wheel.rollers}
            onChange={(event) => update({ rollers: event.target.value as WheelRollers })}
          >
            {WHEEL_ROLLERS.map((rollers) => (
              <option key={rollers} value={rollers}>
                {rollerLabel(rollers)}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="hw-derived">
        {topSpeed !== null
          ? t('hardware.wheel.topSpeed', {
              speed: formatNumber(
                toDisplayLength(topSpeed, lengthUnit),
                lengthUnit === 'm' ? 2 : 1
              ),
              unit,
              volts: formatNumber(batteryVoltage, 1)
            })
          : t('hardware.wheel.topSpeedNoMotor')}
      </p>
      <p className="inspector-note">{t('hardware.wheel.hint')}</p>
      {(view.motorState === 'missing' || view.rollersAmbiguous) && (
        <ul className="hw-issues">
          {view.motorState === 'missing' && (
            <li className="hw-issue is-warning">{t('hardware.wheel.motorMissingWarning')}</li>
          )}
          {view.rollersAmbiguous && (
            <li className="hw-issue is-warning">{t('hardware.wheel.rollersAmbiguousWarning')}</li>
          )}
        </ul>
      )}
    </li>
  )
}

export default WheelCard
