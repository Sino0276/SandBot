import { useTranslation } from 'react-i18next'
import { formatVirtualTime, telemetryLines } from '../playFormat'
import { usePlayStore } from '../playStore'

// Driver Station 텔레메트리 화면: 머리줄(OpMode 이름·단계), telemetry.update가 보낸 줄, 그 아래 telemetry.log()의 줄.
// DisplayFormat.MONOSPACE면 고정폭, HTML이면 태그를 뺀 글자로 보인다(팀 코드의 HTML을 그리지 않는다).
function TelemetryView(): React.JSX.Element {
  const { t } = useTranslation()
  const run = usePlayStore((state) => state.run)

  if (!run) return <p className="panel-empty">{t('telemetry.noRun')}</p>
  const telemetry = run.telemetry
  const shown = telemetry ? telemetryLines(telemetry.frame) : null
  const monospace = telemetry?.frame.format === 'monospace'

  return (
    <div className="telemetry">
      <div className="telemetry-header">
        <span className="telemetry-opmode">{run.opMode.name}</span>
        <span className="telemetry-phase">{t(`play.phase.${run.phase}`)}</span>
        {telemetry && (
          <span className="telemetry-time" title={t('telemetry.sentAt')}>
            {formatVirtualTime(telemetry.tNanos)}
          </span>
        )}
      </div>
      {!shown ? (
        <p className="panel-empty">{t('telemetry.empty')}</p>
      ) : (
        <div className={monospace ? 'telemetry-body is-monospace' : 'telemetry-body'}>
          {shown.lines.map((line, index) => (
            <div key={index} className="telemetry-line">
              {line === '' ? ' ' : line}
            </div>
          ))}
          {shown.log.length > 0 && (
            <div className="telemetry-log" aria-label={t('telemetry.log')}>
              {shown.log.map((line, index) => (
                <div key={index} className="telemetry-line">
                  {line === '' ? ' ' : line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TelemetryView
