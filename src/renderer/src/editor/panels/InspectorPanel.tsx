import { useTranslation } from 'react-i18next'
import PanelFrame from '../PanelFrame'

function InspectorPanel(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <PanelFrame title={t('panels.inspector')}>
      <p className="panel-empty">{t('inspector.empty')}</p>
    </PanelFrame>
  )
}

export default InspectorPanel
