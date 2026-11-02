import { useTranslation } from 'react-i18next'
import { DEFAULT_INFILL, type MassSettings, type MaterialKey } from '../../mass/types'
import type { SceneObject, Vec3 } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import {
  formatLength,
  formatMass,
  fromDisplayLength,
  LENGTH_DIGITS,
  parseLength,
  parseMass,
  toDisplayLength
} from '../../units/units'
import {
  acceptMass,
  cleanMass,
  DEFAULT_DESCRIBERS,
  formatInfill,
  infillPlaceholder,
  inheritedOptionText,
  localCenterOfMass,
  massCardView,
  materialLabel,
  MATERIAL_GROUPS,
  MAX_CENTER_OF_MASS,
  MAX_OVERRIDE_MASS,
  parseInfillPercent,
  sameMassSettings,
  sourceText
} from './massCardModel'
import { EditableVector, ReadonlyVector } from './MassVector'
import OptionalField from './OptionalField'
import { useMassModel } from './useMassModel'

// 질량 카드(시뮬레이터 설정, spec-3a §6). 재질은 하위로 물려주고, 질량 덮어쓰기는 이 오브젝트 하위 전체를 한 덩어리로
// 정한다. 바퀴 카드처럼 생성 코드·구성 XML과 관계없고, 실행 중에도 고칠 수 있다(3b·3c에서 INIT 때 굳는다).
function MassCard({ object }: { object: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const setObjectMass = useSceneStore((state) => state.setObjectMass)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const model = useMassModel()
  if (!object.mass) return null

  const result = model.objects[object.id]
  const view = massCardView(objects, object.id, model.objects, DEFAULT_DESCRIBERS)
  const settings = view.settings
  const update = (patch: Partial<MassSettings>): void => {
    const next = cleanMass({ ...settings, ...patch })
    if (!sameMassSettings(next, settings)) setObjectMass(object.id, next)
  }
  const title = t('mass.title')
  const unit = t(`units.symbols.${lengthUnit}`)
  const parseDisplayLength = (text: string): number | null => {
    const meters = parseLength(text, lengthUnit)
    return meters === null ? null : toDisplayLength(meters, lengthUnit)
  }
  const centerOfMass = settings.centerOfMass

  return (
    <li className="hw-card" data-component-type="mass">
      <header className="hw-card-header">
        <span className="hw-card-type">{title}</span>
        <button
          type="button"
          className="hw-card-remove"
          title={t('hardware.remove')}
          aria-label={t('hardware.removeLabel', { name: title })}
          onClick={() => setObjectMass(object.id, null)}
        >
          ×
        </button>
      </header>
      {!view.inRobot && <p className="inspector-note">{t('mass.orphan')}</p>}
      <div className="hw-row" title={t('mass.materialHint')}>
        <span className="hw-row-label">{t('mass.material')}</span>
        <select
          className="field-select"
          aria-label={t('mass.material')}
          value={settings.material ?? ''}
          onChange={(event) =>
            update({ material: (event.target.value || undefined) as MaterialKey | undefined })
          }
        >
          <option value="">{inheritedOptionText(t, objects, view)}</option>
          {MATERIAL_GROUPS.map((group) => (
            <optgroup key={group.key} label={t(`mass.materialGroups.${group.key}`)}>
              {group.materials.map((key) => (
                <option key={key} value={key}>
                  {materialLabel(t, key)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {view.showInfill && (
        <div className="hw-row" title={t('mass.infillHint')}>
          <span className="hw-row-label">{t('mass.infill')}</span>
          <OptionalField
            ariaLabel={t('mass.infill')}
            value={settings.infill === undefined ? '' : formatInfill(settings.infill)}
            placeholder={infillPlaceholder(t, view.inheritedInfill, DEFAULT_INFILL)}
            parse={parseInfillPercent}
            onCommit={(infill) => update({ infill: infill ?? undefined })}
          />
        </div>
      )}
      <div className="hw-row" title={t('mass.overrideHint')}>
        <span className="hw-row-label">{t('mass.override')}</span>
        <OptionalField
          ariaLabel={t('mass.override')}
          value={settings.mass === undefined ? '' : formatMass(settings.mass, lengthUnit)}
          placeholder={
            result && settings.mass === undefined
              ? t('mass.overridePlaceholder', { mass: formatMass(result.mass, lengthUnit) })
              : undefined
          }
          title={t('mass.massInputHint')}
          parse={(text) => {
            const kg = parseMass(text, lengthUnit)
            return kg !== null && acceptMass(kg, MAX_OVERRIDE_MASS) ? kg : null
          }}
          onCommit={(mass) => update({ mass: mass ?? undefined })}
        />
      </div>
      {view.showCenterOfMass && (
        <div className="mass-center" title={t('mass.centerOfMassHint')}>
          <div className="hw-row">
            <span className="hw-row-label">
              {t('mass.centerOfMass')} <span className="vector-row-unit">{unit}</span>
            </span>
            <label className="hw-check">
              <input
                type="checkbox"
                checked={centerOfMass === undefined}
                onChange={(event) =>
                  update({
                    centerOfMass: event.target.checked
                      ? undefined
                      : localCenterOfMass(objects, object.id, result)
                  })
                }
              />
              {t('mass.centerOfMassAuto')}
            </label>
          </div>
          {view.centerOfMassUnused && (
            <p className="inspector-note">{t('mass.centerOfMassUnused')}</p>
          )}
          {centerOfMass && (
            <EditableVector
              values={centerOfMass.map((meters) => toDisplayLength(meters, lengthUnit)) as Vec3}
              digits={LENGTH_DIGITS[lengthUnit]}
              parse={parseDisplayLength}
              title={t('units.lengthInputHint', { unit })}
              onCommit={(axis, input) => {
                const next: Vec3 = [...centerOfMass]
                const meters = fromDisplayLength(input, lengthUnit)
                if (Math.abs(meters) > MAX_CENTER_OF_MASS) return
                next[axis] = meters
                update({ centerOfMass: next })
              }}
            />
          )}
        </div>
      )}
      {result ? (
        <>
          <p className="hw-derived">
            {t('mass.result', {
              mass: formatMass(result.mass, lengthUnit),
              source: sourceText(t, objects, result)
            })}
            {result.scaled && ` ${t('mass.scaledTag')}`}
          </p>
          {result.mass > 0 && (
            <ReadonlyVector
              label={view.inRobot ? t('mass.resultCenterRobot') : t('mass.resultCenterField')}
              unit={unit}
              values={
                result.centerOfMass.map((meters) => formatLength(meters, lengthUnit)) as [
                  string,
                  string,
                  string
                ]
              }
              title={t('mass.resultCenterHint')}
            />
          )}
        </>
      ) : (
        <p className="hw-derived">{t('mass.resultNone')}</p>
      )}
      <p className="inspector-note">{t('mass.hint')}</p>
    </li>
  )
}

export default MassCard
