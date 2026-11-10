import { useTranslation } from 'react-i18next'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import {
  ALIGNMENT_PRESETS,
  AXIS_DIRECTIONS,
  findPreset,
  isValidAlignment,
  type AlignmentPreset,
  type CadAlignment
} from '../../cad/alignment'
import { useImportStore } from '../../cad/importStore'
import {
  clearFieldVisual,
  importFieldVisual,
  relinkFieldVisual,
  reloadFieldVisual
} from '../../field/fieldVisualActions'
import {
  fieldCadReady,
  fieldVisualState,
  useFieldVisualStore,
  type FieldVisualState
} from '../../field/fieldVisualStore'
import { usePlayStore } from '../../play/playStore'
import { useProjectStore } from '../../project/projectStore'
import type { AxisDirection } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { formatLength } from '../../units/units'
import { fieldLayers } from '../scene/fieldLayers'
import { usesNominalFloor } from '../scene/fieldViewModel'
import {
  fieldElementsHidden,
  setFieldShapesShown,
  useSceneVisibilityStore
} from '../sceneVisibility'
import { fieldCadAlignmentSuspect, fieldCadBoundsParams } from './fieldCadModel'
import { displayedField, runLocksField } from './fieldDisplay'

// Field 인스펙터 "필드 CAD (보기용)" 구역(spec-4e §4.1). 공식 필드 STEP을 보기용으로 불러와 씬 뷰에 그린다(계산은 늘 단순
// 형상). 버튼·배지 글자는 로봇 CAD 행(inspector.cad.*)을 그대로 써서 알림 문구와 버튼 이름이 어긋나지 않는다. 불러오기 세
// 버튼은 불러오는 중·바쁨·잠그는 실행 동안 비활성이다(합치기·GPU 업로드 동안 렌더러가 멈추면 키보드 게임패드가 늦는다,
// 비평 U11). 정렬·지우기·단순 형상 보기는 실행 중에도 된다(시뮬레이터와 관계없다). 로봇 CadAlignmentSection과 같은 모양이지만
// 그것은 SceneObject와 로봇 방향 기억(sandbot:cadAlignment)에 묶여 있어 새로 쓴다(필드 CAD는 그 기억을 쓰지 않는다).

const PRESET_LABEL_KEYS = {
  yUp: 'inspector.cad.presetYUp',
  zUp: 'inspector.cad.presetZUp'
} as const satisfies Record<AlignmentPreset, string>

// 상태 배지(shown·none은 배지 없음)
const STATUS_LABEL_KEYS = {
  loading: 'inspector.cad.loading',
  failed: 'inspector.cad.failed',
  cancelled: 'inspector.cad.cancelled',
  missing: 'inspector.cad.missing',
  unloaded: 'field.inspector.cad.unloaded'
} as const satisfies Partial<Record<FieldVisualState, string>>

function FieldCadSection(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const visual = useSceneStore((state) => state.field.visual)
  const season = useSceneStore((state) => state.field.season)
  const setAlignment = useSceneStore((state) => state.setFieldVisualAlignment)
  const status = useProjectStore((state) => state.fieldVisualStatus)
  const busy = useProjectStore((state) => state.busy)
  const loaded = useFieldVisualStore((state) => state.loaded)
  // 불러오기는 한 번에 하나(로봇 CAD와 함께 센다)
  const importing = useImportStore((state) => state.running > 0)
  const run = usePlayStore((state) => state.run)
  const hiveState = usePlayStore((state) => state.settings.hiveState)
  const shapesShown = useSceneVisibilityStore((state) => state.fieldShapesShown)
  const elementsHidden = useSceneVisibilityStore(fieldElementsHidden)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)

  const locked = runLocksField(run)
  const canLoad = !importing && !busy && !locked
  const loadTitle = locked ? t('field.inspector.cad.runningHint') : undefined
  const ready = fieldCadReady(visual, loaded)
  const state = fieldVisualState(visual, status, loaded)
  const layers = fieldLayers({ cadReady: ready, shapesShown, elementsHidden })
  // 실행이 잠그면 실행의 시즌·HIVE 상태(씬 뷰와 같다)
  const shown = displayedField(run, { season }, hiveState)
  // CAD 층이 그려질 때만(숨김·고립 보기면 CAD도 단순 CELL·태그도 그리지 않아 안내가 틀린다)
  const hiveTipped =
    layers.cad &&
    resolveSeason(shown.season).hives.length > 0 &&
    (shown.hiveTipped[0] || shown.hiveTipped[1])
  // 숫자는 UI 언어의 형식으로(인자 없는 toLocaleString은 OS 로캘을 따른다, 비평 U12)
  const language = i18n.resolvedLanguage ?? i18n.language
  const count = (value: number): string => value.toLocaleString(language)

  const header = (
    <header className="inspector-section-header">
      <span className="inspector-section-title">
        {t('field.inspector.cad.title')}
        {locked && (
          <span className="frame-badge is-running" title={t('field.inspector.cad.runningHint')}>
            {t('inspector.running')}
          </span>
        )}
      </span>
      {visual && (
        <span className="inspector-file" title={visual.absolutePath}>
          {visual.fileName}
        </span>
      )}
    </header>
  )
  const runningLine = locked && (
    <p className="inspector-note is-reason">{t('field.inspector.cad.runningHint')}</p>
  )

  if (!visual)
    return (
      <section className="inspector-section" aria-label={t('field.inspector.cad.title')}>
        {header}
        <button
          type="button"
          className="panel-button"
          data-field-cad="import"
          disabled={!canLoad}
          title={loadTitle}
          onClick={() => void importFieldVisual()}
        >
          {t('field.inspector.cad.import')}
        </button>
        {runningLine}
        <p className="inspector-note">{t('field.inspector.cad.hint')}</p>
      </section>
    )

  const current: CadAlignment = { upAxis: visual.upAxis, forwardAxis: visual.forwardAxis }
  const preset = findPreset(current) ?? 'custom'
  const apply = (alignment: CadAlignment): void => {
    if (isValidAlignment(alignment)) setAlignment(alignment)
  }
  const changeUp = (upAxis: AxisDirection): void => {
    const forwardAxis = isValidAlignment({ upAxis, forwardAxis: visual.forwardAxis })
      ? visual.forwardAxis
      : AXIS_DIRECTIONS.find((axis) => axis[1] !== upAxis[1])!
    apply({ upAxis, forwardAxis })
  }
  const badge = state === 'shown' || state === 'none' ? null : STATUS_LABEL_KEYS[state]
  const symbol = t(`units.symbols.${lengthUnit}`)

  return (
    <section className="inspector-section" aria-label={t('field.inspector.cad.title')}>
      {header}
      <div className="cad-file">
        <span className="cad-file-path" title={visual.absolutePath}>
          {/* 긴 경로는 앞쪽을 줄임표로 줄인다(rtl). 경로 자체는 ltr로 격리한다(로봇 CadFileRow와 같다) */}
          <bdi dir="ltr">{visual.absolutePath || visual.fileName}</bdi>
        </span>
        {badge && (
          <span
            className={state === 'loading' ? 'cad-file-status' : 'cad-file-missing'}
            data-field-cad-state={state}
          >
            {t(badge)}
          </span>
        )}
      </div>
      {/* 버튼은 경로 아래 줄에 둔다(좁은 인스펙터에서 경로가 사라지지 않게, 4e-B 점검) */}
      <div className="cad-file">
        {/* [다시 불러오기]는 늘 보인다(Unity 에셋 Reimport: 같은 경로에 고친 파일을 덮어쓴 경우, 비평 U6) */}
        <button
          type="button"
          className="panel-button"
          data-field-cad="reload"
          disabled={!canLoad}
          title={loadTitle}
          onClick={() => void reloadFieldVisual()}
        >
          {t('inspector.cad.reload')}
        </button>
        <button
          type="button"
          className="panel-button"
          data-field-cad="relink"
          disabled={!canLoad}
          title={loadTitle}
          onClick={() => void relinkFieldVisual()}
        >
          {t('inspector.cad.relink')}
        </button>
        {/* 지우기는 늘 된다(읽는 중에 지워도 결과는 상태를 바꾸지 않는다) */}
        <button
          type="button"
          className="panel-button"
          data-field-cad="clear"
          onClick={() => clearFieldVisual()}
        >
          {t('field.inspector.cad.clear')}
        </button>
      </div>
      {runningLine}
      {ready && loaded && (
        <>
          <p className="inspector-note" data-field-cad="stats">
            {t('field.inspector.cad.stats', {
              meshes: count(loaded.meshCount),
              triangles: count(loaded.triangleCount),
              glass: count(loaded.glassMeshCount)
            })}
          </p>
          <p className="inspector-note" data-field-cad="bounds">
            {t(
              'field.inspector.cad.bounds',
              fieldCadBoundsParams(
                loaded.bounds,
                current,
                (meters) => formatLength(meters, lengthUnit),
                symbol
              )
            )}
          </p>
          {fieldCadAlignmentSuspect(loaded.bounds, current) && (
            <p className="inspector-note is-reason" data-field-cad="alignSuspect">
              {`⚠ ${t('field.inspector.cad.alignSuspect')}`}
            </p>
          )}
        </>
      )}
      <label className="field-row">
        <span className="field-row-label">{t('inspector.cad.preset')}</span>
        <select
          className="field-select"
          data-field-cad="preset"
          value={preset}
          onChange={(event) => {
            const value = event.target.value
            if (value in ALIGNMENT_PRESETS) apply(ALIGNMENT_PRESETS[value as AlignmentPreset])
          }}
        >
          {(Object.keys(ALIGNMENT_PRESETS) as AlignmentPreset[]).map((key) => (
            <option key={key} value={key}>
              {t(PRESET_LABEL_KEYS[key])}
            </option>
          ))}
          <option value="custom" disabled>
            {t('inspector.cad.presetCustom')}
          </option>
        </select>
      </label>
      <label className="field-row">
        <span className="field-row-label">{t('inspector.cad.upAxis')}</span>
        <select
          className="field-select"
          data-field-cad="upAxis"
          value={visual.upAxis}
          onChange={(event) => changeUp(event.target.value as AxisDirection)}
        >
          {AXIS_DIRECTIONS.map((axis) => (
            <option key={axis} value={axis}>
              {axis}
            </option>
          ))}
        </select>
      </label>
      <label className="field-row">
        <span className="field-row-label">{t('field.inspector.cad.forwardAxis')}</span>
        <select
          className="field-select"
          data-field-cad="forwardAxis"
          value={visual.forwardAxis}
          onChange={(event) =>
            apply({ upAxis: visual.upAxis, forwardAxis: event.target.value as AxisDirection })
          }
        >
          {AXIS_DIRECTIONS.filter((axis) => axis[1] !== visual.upAxis[1]).map((axis) => (
            <option key={axis} value={axis}>
              {axis}
            </option>
          ))}
        </select>
      </label>
      <p className="inspector-note">{t('field.inspector.cad.alignHint')}</p>
      <label className="field-check" title={t('field.inspector.cad.showShapesHint')}>
        <input
          type="checkbox"
          data-field-cad="showShapes"
          checked={shapesShown}
          disabled={!layers.cad}
          onChange={(event) => setFieldShapesShown(event.target.checked)}
        />
        {t('field.inspector.cad.showShapes')}
      </label>
      <p className="inspector-note">{t('field.inspector.cad.showShapesHint')}</p>
      {hiveTipped && (
        <p className="inspector-note" data-field-cad="hiveTipped">
          {t('field.inspector.cad.hiveTippedNote')}
        </p>
      )}
      {ready && elementsHidden && (
        <p className="inspector-note" data-field-cad="hidden">
          {t('field.inspector.cad.hiddenNote')}
        </p>
      )}
      {usesNominalFloor(shown.season) && (
        <p className="inspector-note" data-field-cad="simpleSeason">
          {t('field.inspector.cad.simpleSeasonNote')}
        </p>
      )}
    </section>
  )
}

export default FieldCadSection
