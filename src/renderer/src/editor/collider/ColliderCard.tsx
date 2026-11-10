import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  COLLIDER_DIRECTIONS,
  colliderEnabled,
  DEFAULT_COLLIDER_FRICTION,
  HULL_ERROR_WARN,
  MAX_CAPSULE_RADIUS,
  MAX_COLLIDER_EXTENT,
  MAX_COLLIDER_FRICTION,
  MAX_VERTEX_LIMIT,
  MIN_BOX_SIZE,
  MIN_CAPSULE_RADIUS,
  MIN_VERTEX_LIMIT,
  type ColliderDirection,
  type ColliderSettings
} from '../../scene/collider'
import { findRobotId, type SceneObject, type Vec3 } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { usePlayStore } from '../../play/playStore'
import { useUnitStore } from '../../units/unitStore'
import {
  formatLength,
  formatNumber,
  fromDisplayLength,
  LENGTH_DIGITS,
  toDisplayLength,
  type LengthUnit
} from '../../units/units'
import { runLocksField } from '../field/fieldDisplay'
import { ownCadAxes } from '../inspectorInfo'
import OptionalField from '../mass/OptionalField'
import NumberField from '../NumberField'
import {
  colliderCardView,
  colliderFitBounds,
  colliderLengthParser as lengthParser,
  fitCollider
} from './colliderCardModel'
import { useCollisionModel } from './useCollisionModel'

// Collider 카드(Unity Box·Capsule·Mesh Collider, spec-5 §6.2). 하드웨어 컴포넌트 카드와 같은 모양이고 시뮬레이터 설정이라 생성
// 코드·구성 XML과 관계없다. 머리줄은 Unity처럼 확인란(Collider.enabled)·제목·[제거], 칸은 Unity 순서(Material 자리의 마찰이
// Center 앞)다. 칸 하나를 확정할 때마다 setColliders 한 번(실행 취소 한 단계). 끈 카드는 칸을 흐리게 보이되 편집은 된다(Unity와
// 같음). 길이는 표시 단위로 보이고 단위를 붙인 입력도 받으며, 받지 않는 값은 지우지 않고 틀렸다고 보인다.

const AXES = ['x', 'y', 'z'] as const

// 세 축 길이 칸(Center·Size)
function LengthVector({
  label,
  title,
  values,
  unit,
  min,
  max,
  invalidTitle,
  onCommit
}: {
  label: string
  title: string
  values: Vec3
  unit: LengthUnit
  min: number
  max: number
  invalidTitle: string
  onCommit: (axis: 0 | 1 | 2, meters: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const symbol = t(`units.symbols.${unit}`)
  const parse = lengthParser(unit, min, max)
  return (
    <div className="mass-vector" title={title}>
      <span className="hw-row-label">
        {label} <span className="vector-row-unit">{symbol}</span>
      </span>
      <div className="hw-inline">
        <div className="vector-row-fields">
          {AXES.map((axis, index) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              axis={axis}
              value={toDisplayLength(values[index], unit)}
              digits={LENGTH_DIGITS[unit]}
              parse={parse}
              title={t('units.lengthInputHint', { unit: symbol })}
              invalidTitle={invalidTitle}
              onCommit={(value) => onCommit(index as 0 | 1 | 2, fromDisplayLength(value, unit))}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ColliderCard({
  object,
  collider
}: {
  object: SceneObject
  collider: ColliderSettings
}): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const revision = useSceneStore((state) => state.geometryRevision)
  const setColliders = useSceneStore((state) => state.setColliders)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const robotId = findRobotId(objects, object.id)
  const collision = useCollisionModel(robotId)
  // 실행이 이 로봇을 잠갔으면 "실행 중" 배지(시뮬레이터는 INIT 때의 형상을 쓴다, 편집은 막지 않는다)
  const running = usePlayStore((state) => runLocksField(state.run) && state.run.robotId === robotId)
  const view = colliderCardView(objects, object.id, collider.id, collision)
  const joints = collision?.joints ?? null
  const fit = useMemo(() => {
    void revision
    return colliderFitBounds(objects, object.id, joints)
  }, [objects, revision, object.id, joints])
  const cad = ownCadAxes(objects, object.id)
  const enabled = colliderEnabled(collider)
  const symbol = t(`units.symbols.${lengthUnit}`)
  const lengthText = (meters: number): string => `${formatLength(meters, lengthUnit)} ${symbol}`
  const title = t(`collider.titles.${collider.kind}`)

  const update = (next: ColliderSettings): void =>
    setColliders(
      object.id,
      (object.colliders ?? []).map((entry) => (entry.id === collider.id ? next : entry))
    )
  const remove = (): void =>
    setColliders(
      object.id,
      (object.colliders ?? []).filter((entry) => entry.id !== collider.id)
    )
  const setEnabled = (on: boolean): void => {
    const { enabled: _enabled, ...rest } = collider
    void _enabled
    update(on ? (rest as ColliderSettings) : ({ ...rest, enabled: false } as ColliderSettings))
  }

  const frictionRow = (
    <div className="hw-row" title={t('collider.frictionHint')}>
      <span className="hw-row-label">{t('collider.friction')}</span>
      <OptionalField
        ariaLabel={t('collider.friction')}
        value={collider.friction === undefined ? '' : formatNumber(collider.friction, 3)}
        placeholder={formatNumber(DEFAULT_COLLIDER_FRICTION, 1)}
        title={t('collider.frictionHint')}
        invalidTitle={t('collider.invalid.friction')}
        parse={(text) => {
          const value = Number(text.trim())
          return text.trim() !== '' &&
            Number.isFinite(value) &&
            value >= 0 &&
            value <= MAX_COLLIDER_FRICTION
            ? value
            : null
        }}
        onCommit={(friction) => {
          const { friction: _friction, ...rest } = collider
          void _friction
          update(friction === null ? (rest as ColliderSettings) : { ...collider, friction })
        }}
      />
    </div>
  )

  const fitButton = collider.kind !== 'mesh' && (
    <div className="hw-row">
      <span className="hw-row-label" />
      <div className="hw-inline">
        <button
          type="button"
          className="panel-button"
          data-collider="fit"
          disabled={!fit.bounds}
          title={
            !fit.bounds
              ? t('collider.fitChildrenNone')
              : fit.pending > 0
                ? `${t('collider.fitChildrenHint')} ${t('collider.fitChildrenPending', { count: fit.pending })}`
                : t('collider.fitChildrenHint')
          }
          onClick={() => {
            const next = fitCollider(objects, object.id, collider, joints)
            if (next) update(next)
          }}
        >
          {t('collider.fitChildren')}
        </button>
      </div>
    </div>
  )

  const state = view.state
  const entry = state?.entry ?? null

  return (
    <li
      className={enabled ? 'hw-card' : 'hw-card is-disabled'}
      data-component-type={`${collider.kind}Collider`}
    >
      <header className="hw-card-header">
        <span className="hw-check">
          <input
            type="checkbox"
            data-collider="enabled"
            checked={enabled}
            title={t('collider.enabled')}
            aria-label={`${title}: ${t('collider.enabled')}`}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span className="hw-card-type">{title}</span>
        </span>
        <span className="hw-inline">
          {running && (
            <span className="frame-badge is-running" title={t('collider.runningHint')}>
              {t('inspector.running')}
            </span>
          )}
          <span className="inspector-file">{t('collider.simulationOnly')}</span>
          <button
            type="button"
            className="hw-card-remove"
            data-collider="remove"
            title={t('collider.remove')}
            aria-label={t('hardware.removeLabel', { name: title })}
            onClick={remove}
          >
            ×
          </button>
        </span>
      </header>
      <div className="collider-fields">
        {collider.kind === 'mesh' && (
          <div className="hw-row" title={t('collider.convexHint')}>
            <span className="hw-row-label">{t('collider.convex')}</span>
            <input type="checkbox" checked disabled aria-label={t('collider.convex')} readOnly />
          </div>
        )}
        {frictionRow}
        {collider.kind !== 'mesh' && (
          <LengthVector
            label={t('collider.center')}
            title={t('collider.centerHint')}
            values={collider.center}
            unit={lengthUnit}
            min={-MAX_COLLIDER_EXTENT}
            max={MAX_COLLIDER_EXTENT}
            invalidTitle={t('collider.invalid.length')}
            onCommit={(axis, meters) => {
              const center: Vec3 = [...collider.center]
              center[axis] = meters
              update({ ...collider, center })
            }}
          />
        )}
        {collider.kind === 'box' && (
          <LengthVector
            label={t('collider.size')}
            title={t('collider.centerHint')}
            values={collider.size}
            unit={lengthUnit}
            min={MIN_BOX_SIZE}
            max={MAX_COLLIDER_EXTENT}
            invalidTitle={t('collider.invalid.size')}
            onCommit={(axis, meters) => {
              const size: Vec3 = [...collider.size]
              size[axis] = meters
              update({ ...collider, size })
            }}
          />
        )}
        {collider.kind === 'capsule' && (
          <>
            <div className="hw-row">
              <span className="hw-row-label">{`${t('collider.radius')} (${symbol})`}</span>
              <NumberField
                ariaLabel={t('collider.radius')}
                value={toDisplayLength(collider.radius, lengthUnit)}
                digits={LENGTH_DIGITS[lengthUnit]}
                parse={lengthParser(lengthUnit, MIN_CAPSULE_RADIUS, MAX_CAPSULE_RADIUS)}
                title={t('units.lengthInputHint', { unit: symbol })}
                invalidTitle={t('collider.invalid.length')}
                onCommit={(value) =>
                  update({ ...collider, radius: fromDisplayLength(value, lengthUnit) })
                }
              />
            </div>
            <div className="hw-row" title={t('collider.heightHint')}>
              <span className="hw-row-label">{`${t('collider.height')} (${symbol})`}</span>
              <NumberField
                ariaLabel={t('collider.height')}
                value={toDisplayLength(collider.height, lengthUnit)}
                digits={LENGTH_DIGITS[lengthUnit]}
                parse={lengthParser(lengthUnit, 0, 2 * MAX_COLLIDER_EXTENT)}
                title={t('collider.heightHint')}
                invalidTitle={t('collider.invalid.length')}
                onCommit={(value) =>
                  update({ ...collider, height: fromDisplayLength(value, lengthUnit) })
                }
              />
            </div>
            <div className="hw-row">
              <span className="hw-row-label">{t('collider.direction')}</span>
              <select
                className="field-select"
                data-collider="direction"
                aria-label={t('collider.direction')}
                value={collider.direction}
                onChange={(event) =>
                  update({ ...collider, direction: event.target.value as ColliderDirection })
                }
              >
                {COLLIDER_DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>
                    {t(`collider.directions.${direction}`)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {collider.kind === 'mesh' && (
          <div className="hw-row" title={t('collider.vertexLimitHint')}>
            <span className="hw-row-label">{t('collider.vertexLimit')}</span>
            <NumberField
              ariaLabel={t('collider.vertexLimit')}
              value={collider.vertexLimit}
              digits={0}
              parse={(text) => {
                const value = Number(text.trim())
                return text.trim() !== '' &&
                  Number.isInteger(value) &&
                  value >= MIN_VERTEX_LIMIT &&
                  value <= MAX_VERTEX_LIMIT
                  ? value
                  : null
              }}
              title={t('collider.vertexLimitHint')}
              invalidTitle={t('collider.invalid.vertexLimit')}
              onCommit={(vertexLimit) => update({ ...collider, vertexLimit })}
            />
          </div>
        )}
        {fitButton}
      </div>
      {cad && (
        <p className="inspector-note">
          {t('collider.cadAxes', { up: cad.upAxis, forward: cad.forwardAxis })}
        </p>
      )}
      {collider.kind === 'mesh' && state && (
        <p className="hw-derived">
          {state.status === 'ok' && entry
            ? t('collider.hull', { points: entry.hullPoints ?? 0, error: lengthText(entry.error) })
            : state.status === 'pending'
              ? t('collider.hullPending')
              : state.status === 'degenerate'
                ? t('collider.hullDegenerate')
                : t('collider.hullNone')}
        </p>
      )}
      <ul className="hw-issues">
        {collider.kind === 'mesh' && entry && entry.error > HULL_ERROR_WARN && (
          <li className="hw-issue is-warning">
            {t('collider.hullErrorLarge', { error: lengthText(entry.error) })}
          </li>
        )}
        {collider.kind === 'mesh' && state?.status === 'ok' && state.pendingMeshes > 0 && (
          <li className="hw-issue is-info">
            {t('collider.body.pending', { count: state.pendingMeshes })}
          </li>
        )}
        {view.meshesInOtherBody !== null && (
          <li className="hw-issue is-warning">
            {t('collider.meshesInOtherBody', { name: view.meshesInOtherBody })}
          </li>
        )}
        {view.replacesAuto !== null && (
          <li className="hw-issue is-info">
            {t('collider.replacesAuto', { body: view.replacesAuto })}
          </li>
        )}
      </ul>
      <p className="inspector-note">
        {view.membership.kind === 'chassis'
          ? t('collider.bodyOfChassis')
          : view.membership.kind === 'joint'
            ? t('collider.bodyOf', { name: view.membership.name })
            : t('collider.orphan')}
      </p>
    </li>
  )
}

export default ColliderCard
