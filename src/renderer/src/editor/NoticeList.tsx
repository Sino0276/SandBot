import { useTranslation } from 'react-i18next'
import { useNoticeStore } from './noticeStore'

function NoticeList(): React.JSX.Element | null {
  const { t } = useTranslation()
  const notices = useNoticeStore((state) => state.notices)
  const dismiss = useNoticeStore((state) => state.dismiss)
  if (notices.length === 0) return null
  return (
    <div className="notice-list">
      {notices.map((notice) => (
        <p key={notice.id} className={`status-banner is-${notice.level}`} role="status">
          <span>{t(`notice.${notice.key}`, notice.params)}</span>
          {notice.level !== 'progress' && (
            <button type="button" className="status-dismiss" onClick={() => dismiss(notice.id)}>
              {t('common.dismiss')}
            </button>
          )}
        </p>
      ))}
    </div>
  )
}

export default NoticeList
