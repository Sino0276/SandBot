import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cancelNotice, formatElapsed, useNoticeStore } from './noticeStore'

// 진행 알림의 경과 시간(1초마다 갱신)
function Elapsed({ startedAt }: { startedAt: number }): React.JSX.Element {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <span className="notice-elapsed">{formatElapsed(now - startedAt)}</span>
}

function NoticeList(): React.JSX.Element | null {
  const { t } = useTranslation()
  const notices = useNoticeStore((state) => state.notices)
  const dismiss = useNoticeStore((state) => state.dismiss)
  if (notices.length === 0) return null
  return (
    <div className="notice-list">
      {notices.map((notice) => (
        <p key={notice.id} className={`status-banner is-${notice.level}`} role="status">
          <span className="notice-text">
            {t(`notice.${notice.key}`, notice.params)}
            {notice.phase && (
              <span className="notice-phase">
                {' · '}
                {t(`importPhase.${notice.phase}`)}
                {notice.fraction !== undefined && ` ${Math.floor(notice.fraction * 100)}%`}
              </span>
            )}
          </span>
          {notice.startedAt !== undefined && <Elapsed startedAt={notice.startedAt} />}
          {notice.cancellable && (
            <button
              type="button"
              className="status-dismiss"
              onClick={() => cancelNotice(notice.id)}
            >
              {t('common.cancel')}
            </button>
          )}
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
