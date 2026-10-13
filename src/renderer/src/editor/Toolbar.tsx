import { useTranslation } from 'react-i18next'
import { changeLanguage } from '../i18n'
import { isLanguage, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../i18n/language'
import { openProjectFolder, saveProject } from '../project/projectActions'
import { useProjectStore } from '../project/projectStore'

function Toolbar(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const root = useProjectStore((state) => state.root)
  const name = useProjectStore((state) => state.name)
  const dirty = useProjectStore((state) => state.dirty)
  const busy = useProjectStore((state) => state.busy)

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
      </div>
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
    </header>
  )
}

export default Toolbar
