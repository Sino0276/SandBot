import { useTranslation } from 'react-i18next'
import { changeLanguage } from '../i18n'
import { isLanguage, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../i18n/language'
import { openProjectFolder, saveProject } from '../project/projectActions'
import { useProjectStore } from '../project/projectStore'
import { useUnitStore } from '../units/unitStore'
import { openPreferences } from './dialogStore'
import { redo, undo, useHistoryStore } from './history'
import { isLengthUnit, LENGTH_UNITS } from '../units/units'

function Toolbar(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const root = useProjectStore((state) => state.root)
  const name = useProjectStore((state) => state.name)
  const dirty = useProjectStore((state) => state.dirty)
  const busy = useProjectStore((state) => state.busy)
  const canUndo = useHistoryStore((state) => state.canUndo)
  const canRedo = useHistoryStore((state) => state.canRedo)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const setLengthUnit = useUnitStore((state) => state.setLengthUnit)

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <span className="toolbar-title">SandBot</span>
        <span className="toolbar-project" title={root ?? undefined}>
          {name ?? t('toolbar.noProject')}
          {dirty && <span className="toolbar-dirty"> *</span>}
        </span>
        <button
          type="button"
          className="panel-button"
          disabled={busy}
          title={t('toolbar.openShortcut')}
          onClick={() => void openProjectFolder()}
        >
          {t('toolbar.open')}
        </button>
        <button
          type="button"
          className="panel-button"
          disabled={busy}
          title={t('toolbar.saveShortcut')}
          onClick={() => void saveProject()}
        >
          {t('toolbar.save')}
        </button>
        <button
          type="button"
          className="panel-button"
          disabled={!canUndo}
          title={t('toolbar.undoShortcut')}
          onClick={() => undo()}
        >
          {t('toolbar.undo')}
        </button>
        <button
          type="button"
          className="panel-button"
          disabled={!canRedo}
          title={t('toolbar.redoShortcut')}
          onClick={() => redo()}
        >
          {t('toolbar.redo')}
        </button>
      </div>
      <div className="toolbar-group">
        <button
          type="button"
          className="panel-button"
          title={t('toolbar.preferencesTooltip')}
          aria-haspopup="dialog"
          // 창이 포커스를 가져가고, 닫으면 이 버튼으로 돌려준다
          onClick={openPreferences}
        >
          {t('toolbar.preferences')}
        </button>
        <select
          className="toolbar-select"
          aria-label={t('toolbar.lengthUnit')}
          title={t('toolbar.lengthUnit')}
          value={lengthUnit}
          onChange={(event) => {
            if (isLengthUnit(event.target.value)) setLengthUnit(event.target.value)
          }}
        >
          {LENGTH_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`units.names.${unit}`)}
            </option>
          ))}
        </select>
        <select
          className="toolbar-select"
          aria-label={t('toolbar.language')}
          title={t('toolbar.language')}
          value={i18n.language}
          onChange={(event) => {
            if (isLanguage(event.target.value)) void changeLanguage(event.target.value)
          }}
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {LANGUAGE_NAMES[language]}
            </option>
          ))}
        </select>
      </div>
    </header>
  )
}

export default Toolbar
