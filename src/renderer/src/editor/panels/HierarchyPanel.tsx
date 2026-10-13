import { useTranslation } from 'react-i18next'
import PanelFrame from '../PanelFrame'

function HierarchyPanel(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <PanelFrame title={t('panels.hierarchy')}>
      <p className="panel-empty">{t('hierarchy.empty')}</p>
    </PanelFrame>
  )
}

export default HierarchyPanel
