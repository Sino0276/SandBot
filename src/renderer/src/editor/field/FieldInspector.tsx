import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SEASON_IDS, isSeasonId, resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { chooseFieldSeason } from '../../field/fieldActions'
import type { HiveSide } from '../../play/playSettings'
import { usePlayStore } from '../../play/playStore'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { formatLength } from '../../units/units'
import { setFieldHidden, useSceneVisibilityStore } from '../sceneVisibility'
import { clusterLines, type ClusterLine } from './clusterLines'
import {
  displayedField,
  documentSeasonId,
  runLocksField,
  seasonName,
  setHiveSide
} from './fieldDisplay'

// Field 인스펙터(spec-4ab §1.9): 하이어라키 Field 줄을 고르면 보인다. 시즌 선택(문서, 실행 취소 한 단계), 축 안내, 벽 안쪽
// 반폭, HIVE 상태(개인 실행 설정), 필드 요소 보이기(보기 상태). 실행이 필드를 잠그면(runLocksField) 실행의 시즌·HIVE 상태를
// 보이고 고칠 수 없다.

const HIVE_SIDES: readonly HiveSide[] = ['start', 'tipped']
const HIVE_KEYS = ['red', 'blue'] as const
// [복사] 뒤 "복사함"을 보이는 시간(ms) [가정: 눈에 띄고 다음 복사를 막지 않는 길이]
const COPIED_MS = 1500

// "AprilTag 묶음(SDK 라이브러리용)" 줄 하나와 [복사](4d, spec-4d §1.15)
function ClusterRow({ line }: { line: ClusterLine }): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  const text = t('field.inspector.clusters.line', line.params)
  return (
    <div className="field-row field-cluster-row" data-cluster={line.name}>
      <code className="field-inspector-value field-cluster-text" title={line.copyText}>
        {text}
      </code>
      <button
        type="button"
        className="panel-button"
        title={line.copyText}
        onClick={() => {
          // 클립보드를 쓸 수 없으면(권한 없음) 조용히 둔다: 글자는 줄에서 고를 수 있다
          void navigator.clipboard
            ?.writeText(line.copyText)
            .then(() => setCopied(true))
            .catch(() => {})
        }}
      >
        {copied ? t('field.inspector.clusters.copied') : t('field.inspector.clusters.copy')}
      </button>
    </div>
  )
}

function FieldInspector(): React.JSX.Element {
  const { t } = useTranslation()
  const doc = useSceneStore((state) => state.field)
  const run = usePlayStore((state) => state.run)
  const hiveState = usePlayStore((state) => state.settings.hiveState)
  const fieldHidden = useSceneVisibilityStore((state) => state.fieldHidden)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const locked = runLocksField(run)
  const shown = displayedField(run, doc, hiveState)
  const spec = resolveSeason(shown.season)
  const known = isSeasonId(doc.season)
  // 잠겼으면 실행의 시즌을 보인다(실행 중 실행 취소로 문서 시즌이 달라질 수 있다)
  const seasonValue = locked ? run.field.season : doc.season
  // 푼 시즌끼리 비교한다(모르는 시즌 문자열은 실행에서 'none'이라 그대로 두면 늘 다르다)
  const afterRun = locked && documentSeasonId(doc) !== run.field.season
  // 축 안내: BIOBUZZ 같은 시즌 필드는 시즌 축, 'none'·모르는 시즌은 공칭
  const seasonAxes = shown.season !== 'none'

  const hiveValue = (index: 0 | 1): HiveSide => (shown.hiveTipped[index] ? 'tipped' : 'start')
  // AprilTag 묶음 원점(4d): 보이는 시즌·HIVE 상태(잠기면 실행의 것). 묶음이 없는 시즌은 구역이 없다
  const [redTipped, blueTipped] = shown.hiveTipped
  const clusters = useMemo(
    () => clusterLines(spec, [redTipped, blueTipped]),
    [spec, redTipped, blueTipped]
  )

  return (
    <>
      <div className="inspector-object">
        <span className="inspector-name">{t('field.inspector.title')}</span>
      </div>
      <section className="inspector-section">
        <header className="inspector-section-header">
          <span className="inspector-section-title">
            {t('field.inspector.season')}
            {locked && (
              <span className="frame-badge is-running" title={t('inspector.runningHint')}>
                {t('field.inspector.locked')}
              </span>
            )}
          </span>
        </header>
        <label className="field-row">
          <span className="field-row-label">{t('field.inspector.season')}</span>
          <select
            className="field-select"
            value={seasonValue}
            disabled={locked}
            onChange={(event) => chooseFieldSeason(event.target.value)}
          >
            {!locked && !known && (
              // 모르는 시즌(새 SandBot이 더한 시즌): 흐린 항목으로 보이고 다른 시즌을 고를 수 있다
              <option value={doc.season} disabled>
                {t('field.unknownSeason', { season: doc.season })}
              </option>
            )}
            {SEASON_IDS.map((id) => (
              <option key={id} value={id}>
                {seasonName(id, t)}
              </option>
            ))}
          </select>
        </label>
        {afterRun && (
          <p className="inspector-note">
            {t('field.inspector.afterRun', { season: seasonName(doc.season, t) })}
          </p>
        )}
        <p className="inspector-note">
          {seasonAxes ? t('field.inspector.axesBiobuzz') : t('field.inspector.axesNone')}
        </p>
        {seasonAxes && <p className="inspector-note">{t('field.inspector.axesNoDiagram')}</p>}
        <div className="field-row">
          <span className="field-row-label">{t('field.inspector.innerHalf')}</span>
          <output className="field-inspector-value">
            {formatLength(spec.perimeter.innerHalf, lengthUnit)} {t(`units.symbols.${lengthUnit}`)}
          </output>
        </div>
        <label className="field-check">
          <input
            type="checkbox"
            checked={!fieldHidden}
            onChange={(event) => setFieldHidden(!event.target.checked)}
          />
          {t('field.inspector.showElements')}
        </label>
      </section>
      {spec.hives.length > 0 && (
        <section className="inspector-section">
          <header className="inspector-section-header">
            <span className="inspector-section-title">{t('field.inspector.hiveState')}</span>
          </header>
          {HIVE_KEYS.map((key, index) => (
            <label key={key} className="field-row">
              <span className="field-row-label">
                {index === 0 ? t('field.inspector.hiveRed') : t('field.inspector.hiveBlue')}
              </span>
              <select
                className="field-select"
                value={hiveValue(index as 0 | 1)}
                disabled={locked}
                onChange={(event) => setHiveSide(key, event.target.value as HiveSide)}
              >
                {HIVE_SIDES.map((side) => (
                  <option key={side} value={side}>
                    {side === 'start'
                      ? t('field.inspector.hiveStart')
                      : t('field.inspector.hiveTipped')}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="inspector-note">{t('field.inspector.hiveHint')}</p>
        </section>
      )}
      {clusters.length > 0 && (
        <section className="inspector-section" aria-label={t('field.inspector.clusters.title')}>
          <header className="inspector-section-header">
            <span className="inspector-section-title">{t('field.inspector.clusters.title')}</span>
          </header>
          {clusters.map((line) => (
            <ClusterRow key={line.name} line={line} />
          ))}
          <p className="inspector-note">{t('field.inspector.clusters.hint')}</p>
        </section>
      )}
    </>
  )
}

export default FieldInspector
