import { useTranslation } from 'react-i18next'
import { changeLanguage } from '../i18n'
import { isLanguage, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../i18n/language'

function Toolbar(): React.JSX.Element {
  const { t, i18n } = useTranslation()

  return (
    <header className="toolbar">
      <span className="toolbar-title">SandBot</span>
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
