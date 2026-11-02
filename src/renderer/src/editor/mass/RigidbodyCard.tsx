import { useTranslation } from 'react-i18next'
import { DEFAULT_MATERIAL } from '../../mass/materials'
import type { MaterialKey, RigidbodySettings } from '../../mass/types'
import { cadMassSummary } from '../../scene/geometryRegistry'
import { MAX_WEIGHED_MASS } from '../../scene/massSettings'
import type { SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { formatLength, formatNumber, parseMass } from '../../units/units'
import {
  acceptMass,
  cadSummaryRows,
  cadSummaryText,
  cleanRigidbody,
  formatInertia,
  hasPendingMeshes,
  materialLabel,
  MATERIAL_GROUPS,
  massText,
  noticeText,
  robotMassBreakdown,
  warningText
} from './massCardModel'
import { ReadonlyVector } from './MassVector'
import OptionalField from './OptionalField'
import { useMassModel } from './useMassModel'

// 로봇 전체의 질량(Unity Rigidbody처럼 로봇이면 늘 보인다, spec-3a §6). 추정 질량과 출처별 합계, 저울 무게(넣으면 추정
// 파트에 비율을 곱해 맞춘다), 기본 재질, 계산한 무게중심·주관성, 경고와 CAD 메시 상태를 보인다. 시뮬레이터 설정이라
// 생성 코드와 관계없다.
function RigidbodyCard({ robot }: { robot: SceneObject }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const setRobotRigidbody = useSceneStore((state) => state.setRobotRigidbody)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const model = useMassModel()
  const mass = model.robots[robot.id]
  const settings = robot.rigidbody ?? {}
  const unit = t(`units.symbols.${lengthUnit}`)
  const cadRows = cadSummaryRows(objects, robot.id, cadMassSummary)
  const principalNames: [string, string, string] = [
    t('mass.rigidbody.principal1'),
    t('mass.rigidbody.principal2'),
    t('mass.rigidbody.principal3')
  ]

  const update = (patch: Partial<RigidbodySettings>): void => {
    const next = cleanRigidbody({ ...settings, ...patch })
    if (
      next?.weighedMass !== settings.weighedMass ||
      next?.defaultMaterial !== settings.defaultMaterial
    )
      setRobotRigidbody(robot.id, next)
  }

  return (
    <section className="inspector-section" aria-label={t('mass.rigidbody.title')}>
      <header className="inspector-section-header">
        <span>{t('mass.rigidbody.title')}</span>
        <span className="inspector-file">{t('mass.rigidbody.simulationOnly')}</span>
      </header>
      <div className="hw-row">
        <span className="hw-row-label">{t('mass.rigidbody.mass')}</span>
        <span className="hw-static">
          {mass ? massText(t, mass.mass, lengthUnit) : t('mass.rigidbody.massNone')}
        </span>
      </div>
      {mass && (
        <p className="hw-derived">
          {robotMassBreakdown(t, mass, lengthUnit, settings.weighedMass)}
          {mass.scale !== 1 &&
            ` ${t('mass.rigidbody.scaled', { scale: formatNumber(mass.scale, 3) })}`}
        </p>
      )}
      <div className="hw-row" title={t('mass.rigidbody.weighedHint')}>
        <span className="hw-row-label">{t('mass.rigidbody.weighed')}</span>
        <OptionalField
          ariaLabel={t('mass.rigidbody.weighed')}
          value={
            settings.weighedMass === undefined ? '' : massText(t, settings.weighedMass, lengthUnit)
          }
          placeholder={t('mass.rigidbody.weighedPlaceholder')}
          title={t('mass.massInputHint')}
          parse={(text) => {
            const kg = parseMass(text, lengthUnit)
            return kg !== null && acceptMass(kg, MAX_WEIGHED_MASS) ? kg : null
          }}
          onCommit={(weighedMass) => update({ weighedMass: weighedMass ?? undefined })}
        />
      </div>
      <div className="hw-row" title={t('mass.rigidbody.defaultMaterialHint')}>
        <span className="hw-row-label">{t('mass.rigidbody.defaultMaterial')}</span>
        <select
          className="field-select"
          aria-label={t('mass.rigidbody.defaultMaterial')}
          value={settings.defaultMaterial ?? ''}
          onChange={(event) =>
            update({
              defaultMaterial: (event.target.value || undefined) as MaterialKey | undefined
            })
          }
        >
          <option value="">
            {t('mass.rigidbody.defaultMaterialBuiltIn', {
              material: materialLabel(t, DEFAULT_MATERIAL)
            })}
          </option>
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
      {mass && mass.mass > 0 && (
        <>
          <ReadonlyVector
            label={t('mass.rigidbody.centerOfMass')}
            unit={unit}
            values={
              mass.centerOfMass.map((meters) => formatLength(meters, lengthUnit)) as [
                string,
                string,
                string
              ]
            }
            title={t('mass.rigidbody.centerOfMassHint')}
          />
          <ReadonlyVector
            label={t('mass.rigidbody.principalMoments')}
            unit={t('mass.rigidbody.inertiaUnit')}
            values={mass.principalMoments.map(formatInertia) as [string, string, string]}
            names={principalNames}
            title={t('mass.rigidbody.principalMomentsHint')}
          />
        </>
      )}
      {mass && mass.warnings.length > 0 && (
        <ul className="hw-issues">
          {mass.warnings.map((warning, index) => (
            <li
              key={index}
              className={warning.kind === 'pending' ? 'hw-issue is-info' : 'hw-issue is-warning'}
            >
              {warningText(t, warning, lengthUnit, settings.weighedMass, hasPendingMeshes(mass))}
            </li>
          ))}
        </ul>
      )}
      {mass?.notices && mass.notices.length > 0 && (
        <ul className="hw-issues" aria-label={t('mass.rigidbody.notices')}>
          {mass.notices.map((notice, index) => (
            <li key={index} className="hw-issue is-info">
              {noticeText(t, objects, notice, lengthUnit)}
            </li>
          ))}
        </ul>
      )}
      {cadRows.length > 0 && (
        <ul className="hw-issues">
          {cadRows.map((row) => (
            <li key={row.id} className="hw-issue is-info">
              {cadSummaryText(t, row)}
            </li>
          ))}
        </ul>
      )}
      <p className="inspector-note">{t('mass.rigidbody.hint')}</p>
    </section>
  )
}

export default RigidbodyCard
