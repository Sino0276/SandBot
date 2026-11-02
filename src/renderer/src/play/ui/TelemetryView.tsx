import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatVirtualTime, htmlToText, telemetryLines } from '../playFormat'
import { dashTelemetryRows, usePlayStore, type DashTelemetry } from '../playStore'

// FTC Dashboard 텔레메트리(Dashboard 웹 클라이언트의 Telemetry 패널처럼): 키와 마지막 값(키 정렬), 그 아래 마지막 로그.
// Dashboard는 DS 표시 형식과 관계없이 키·값·로그를 늘 HTML로 그린다. SandBot은 DS 화면의 HTML 형식처럼 태그를 뺀
// 글자로 보인다(팀 코드의 HTML을 그리지 않는다).
function DashboardTelemetry({ dash }: { dash: DashTelemetry }): React.JSX.Element {
  const { t } = useTranslation()
  // 줄의 React key는 원래 키다(글자로 바꾸면 다른 키가 같아질 수 있다)
  const rows = useMemo(
    () =>
      dashTelemetryRows(dash).map(([key, value]) => ({
        key,
        label: htmlToText(key),
        text: htmlToText(value)
      })),
    [dash]
  )
  const log = useMemo(() => dash.log.map(htmlToText), [dash])
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
          {rows.map(({ key, label, text }) => (
            <div key={key} className="telemetry-line">
              <span className="telemetry-key">{label}: </span>
              {text}
            </div>
          ))}
          {log.length > 0 && (
            <div className="telemetry-log" aria-label={t('telemetry.dashboardLog')}>
              {log.map((line, index) => (
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
