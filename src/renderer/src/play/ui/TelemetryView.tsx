import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatVirtualTime, telemetryLines } from '../playFormat'
import { dashTelemetryRows, usePlayStore, type DashTelemetry } from '../playStore'

// FTC Dashboard 텔레메트리(Dashboard 웹 클라이언트의 Telemetry 패널처럼): 키와 마지막 값(키 정렬), 그 아래 마지막 로그.
// Dashboard는 값을 HTML로 그리지만 SandBot은 글자로만 보인다(팀 코드의 HTML을 그리지 않는다).
function DashboardTelemetry({ dash }: { dash: DashTelemetry }): React.JSX.Element {
  const { t } = useTranslation()
  const rows = useMemo(() => dashTelemetryRows(dash), [dash])
  return (
    <section className="telemetry-dashboard" aria-label={t('telemetry.dashboard')}>
      <div className="telemetry-header" title={t('telemetry.dashboardHint')}>
        <span className="telemetry-opmode">{t('telemetry.dashboard')}</span>
        <span className="telemetry-time" title={t('telemetry.sentAt')}>
          {formatVirtualTime(dash.tNanos)}
        </span>
      </div>
      {rows.length === 0 && dash.log.length === 0 ? (
        <p className="panel-empty">{t('telemetry.dashboardEmpty')}</p>
      ) : (
        <div className="telemetry-body">
          {rows.map(([key, value]) => (
            <div key={key} className="telemetry-line">
              <span className="telemetry-key">{key}: </span>
              {value}
            </div>
          ))}
          {dash.log.length > 0 && (
            <div className="telemetry-log" aria-label={t('telemetry.dashboardLog')}>
              {dash.log.map((line, index) => (
                <div key={index} className="telemetry-line">
                  {line === '' ? ' ' : line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// Driver Station 텔레메트리 화면: 머리줄(OpMode 이름·단계), telemetry.update가 보낸 줄, 그 아래 telemetry.log()의 줄.
// DisplayFormat.MONOSPACE면 고정폭, HTML이면 태그를 뺀 글자로 보인다(팀 코드의 HTML을 그리지 않는다).
// 실행에 FTC Dashboard 패킷이 한 번이라도 오면 그 아래에 Dashboard 텔레메트리를 함께 보인다.
function TelemetryView(): React.JSX.Element {
  const { t } = useTranslation()
  const run = usePlayStore((state) => state.run)
  const dash = usePlayStore((state) =>
    state.dash && state.dash.runId === state.run?.runId ? state.dash : null
  )

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
      {dash && <DashboardTelemetry dash={dash} />}
    </div>
  )
}

export default TelemetryView
