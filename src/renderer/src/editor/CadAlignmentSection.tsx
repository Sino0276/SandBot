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
import { useEditorStore } from './editorStore'

const PRESET_LABEL_KEYS = {
  yUp: 'inspector.cad.presetYUp',
  zUp: 'inspector.cad.presetZUp'
} as const satisfies Record<AlignmentPreset, string>

const STATUS_LABEL_KEYS = {
  loading: 'inspector.cad.loading',
  failed: 'inspector.cad.failed',
  cancelled: 'inspector.cad.cancelled'
} as const satisfies Record<CadGeometryStatus, string>

// CAD 원본 파일 행: 경로, 상태 배지(못 찾음·불러오는 중·실패·취소), [다시 불러오기]·[파일 다시 찾기].
// CAD 정렬 칸과, CAD 밖 그룹으로 옮긴 파트의 인스펙터(CadOriginSection)가 같이 쓴다.
export function CadFileRow({ cadObject }: { cadObject: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const missing = useProjectStore((state) => state.missingCad.includes(cadObject.id))
  const status = useProjectStore((state) => state.cadStatus[cadObject.id])
  // 불러오기는 한 번에 하나(큰 STEP은 메모리를 많이 쓴다)
  const importing = useImportStore((state) => state.running > 0)
  const busy = useProjectStore((state) => state.busy)
  const blocked = importing || busy
  const cad = cadObject.cad
  if (!cad) return null

  return (
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
  )
}

// CAD 루트 밖(다른 그룹 등)으로 옮긴 파트: 어느 CAD에서 왔는지와 그 파일 상태. 형상이 없거나 못 불러왔을 때
// 루트를 고르지 않아도 알 수 있게 파일 행을 그대로 보인다. [CAD 루트 선택]은 Unity 프리팹 인스턴스의 Select와 같다.
export function CadOriginSection({
  cadObject
}: {
  cadObject: SceneObject
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const select = useEditorStore((state) => state.select)
  const cad = cadObject.cad
  if (!cad) return null

  return (
    <section className="inspector-section" aria-label={t('inspector.cadOrigin.title')}>
      <header className="inspector-section-header">
        <span>{t('inspector.cadOrigin.title')}</span>
        <span className="inspector-file" title={cad.fileName}>
          {cad.fileName}
        </span>
      </header>
      <p className="inspector-note">{t('inspector.cadOrigin.hint', { name: cadObject.name })}</p>
      <CadFileRow cadObject={cadObject} />
      <button type="button" className="panel-button" onClick={() => select(cadObject.id)}>
        {t('inspector.cadOrigin.select')}
      </button>
    </section>
  )
}

// CAD 루트의 방향 맞춤. 프로그램마다 위·앞 축이 달라서 파일마다 고른다.
function CadAlignmentSection({ cadObject }: { cadObject: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const setCadAlignment = useSceneStore((state) => state.setCadAlignment)
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
      <CadFileRow cadObject={cadObject} />
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
