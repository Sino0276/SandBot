import { useTranslation } from 'react-i18next'
import {
  ALIGNMENT_PRESETS,
  AXIS_DIRECTIONS,
  findPreset,
  isValidAlignment,
  type AlignmentPreset,
  type CadAlignment
} from '../cad/alignment'
import { saveAlignmentPreference } from '../cad/alignmentPreference'
import { useImportStore } from '../cad/importStore'
import { relinkCad, reloadCad } from '../project/projectActions'
import { useProjectStore, type CadGeometryStatus } from '../project/projectStore'
import type { AxisDirection, SceneObject } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'

const PRESET_LABEL_KEYS = {
  yUp: 'inspector.cad.presetYUp',
  zUp: 'inspector.cad.presetZUp'
} as const satisfies Record<AlignmentPreset, string>

const STATUS_LABEL_KEYS = {
  loading: 'inspector.cad.loading',
  failed: 'inspector.cad.failed',
  cancelled: 'inspector.cad.cancelled'
} as const satisfies Record<CadGeometryStatus, string>

// CAD 루트의 방향 맞춤. 프로그램마다 위·앞 축이 달라서 파일마다 고른다.
function CadAlignmentSection({ cadObject }: { cadObject: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const setCadAlignment = useSceneStore((state) => state.setCadAlignment)
  const missing = useProjectStore((state) => state.missingCad.includes(cadObject.id))
  const status = useProjectStore((state) => state.cadStatus[cadObject.id])
  // 불러오기는 한 번에 하나(큰 STEP은 메모리를 많이 쓴다)
  const importing = useImportStore((state) => state.running > 0)
  const busy = useProjectStore((state) => state.busy)
  const blocked = importing || busy
  const cad = cadObject.cad
  if (!cad) return null

  const current: CadAlignment = { upAxis: cad.upAxis, forwardAxis: cad.forwardAxis }
  const preset = findPreset(current) ?? 'custom'

  const apply = (alignment: CadAlignment): void => {
    if (!isValidAlignment(alignment)) return
    setCadAlignment(cadObject.id, alignment)
    // 다음에 불러올 파일의 기본 방향으로 기억한다
    saveAlignmentPreference(localStorage, alignment)
  }

  const changeUp = (upAxis: AxisDirection): void => {
    const forwardAxis = isValidAlignment({ upAxis, forwardAxis: cad.forwardAxis })
      ? cad.forwardAxis
      : AXIS_DIRECTIONS.find((axis) => axis[1] !== upAxis[1])!
    apply({ upAxis, forwardAxis })
  }

  return (
    <section className="inspector-section">
      <header className="inspector-section-header">
        <span>{t('inspector.cad.title')}</span>
        <span className="inspector-file" title={cad.fileName}>
          {cad.fileName}
        </span>
      </header>
      <div className="cad-file">
        <span className="cad-file-path" title={cad.absolutePath}>
          {/* 긴 경로는 앞쪽을 줄임표로 줄인다(rtl). 경로 자체는 ltr로 격리해 '/'가 끝으로 튀지 않게 한다 */}
          <bdi dir="ltr">{cad.absolutePath || cad.fileName}</bdi>
        </span>
        {missing && <span className="cad-file-missing">{t('inspector.cad.missing')}</span>}
        {!missing && status && (
          <span className={status === 'loading' ? 'cad-file-status' : 'cad-file-missing'}>
            {t(STATUS_LABEL_KEYS[status])}
          </span>
        )}
        {(status === 'failed' || status === 'cancelled') && (
          <button
            type="button"
            className="panel-button"
            disabled={blocked}
            onClick={() => void reloadCad(cadObject.id)}
          >
            {t('inspector.cad.reload')}
          </button>
        )}
        <button
          type="button"
          className="panel-button"
          disabled={blocked}
          onClick={() => void relinkCad(cadObject.id)}
        >
          {t('inspector.cad.relink')}
        </button>
      </div>
      <p className="inspector-note">{t('inspector.cad.hint')}</p>
      <label className="field-row">
        <span className="field-row-label">{t('inspector.cad.preset')}</span>
        <select
          className="field-select"
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
          value={cad.upAxis}
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
        <span className="field-row-label">{t('inspector.cad.forwardAxis')}</span>
        <select
          className="field-select"
          value={cad.forwardAxis}
          onChange={(event) =>
            apply({ upAxis: cad.upAxis, forwardAxis: event.target.value as AxisDirection })
          }
        >
          {AXIS_DIRECTIONS.filter((axis) => axis[1] !== cad.upAxis[1]).map((axis) => (
            <option key={axis} value={axis}>
              {axis}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}

export default CadAlignmentSection
