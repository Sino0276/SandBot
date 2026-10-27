import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleCounts, formatCount } from '../consoleModel'
import type { PadInfo } from '../gamepad'
import { DOCK_TABS, type DockTab } from '../playSettings'
import { usePlayStore } from '../playStore'
import ConsoleView from './ConsoleView'
import DevicesView from './DevicesView'
import { LevelIcon, PlayIcon } from './PlayIcons'
import TelemetryView from './TelemetryView'

// 게임패드 1·2 연결 상태. Chromium은 버튼을 한 번 누르기 전에는 패드를 보이지 않는다.
function GamepadStatus(): React.JSX.Element {
  const { t } = useTranslation()
  const pads = usePlayStore((state) => state.gamepads)
  const describe = (pad: PadInfo | null, slot: number): string =>
    !pad
      ? t('play.gamepad.disconnected', { slot })
      : pad.standard
        ? t('play.gamepad.connected', { slot, id: pad.id })
        : t('play.gamepad.nonStandard', { slot, id: pad.id })
  const title = [describe(pads[0], 1), describe(pads[1], 2), t('play.gamepad.hint')].join('\n')
  return (
    <span className="gamepad-status" title={title} aria-label={title} role="img">
      <PlayIcon name="gamepad" size={16} />
      {pads.map((pad, index) => (
        <span
          key={index}
          className={
            !pad ? 'gamepad-slot' : pad.standard ? 'gamepad-slot is-on' : 'gamepad-slot is-odd'
          }
        >
          {index + 1}
        </span>
      ))}
    </span>
  )
}

// 씬 뷰 아래 패널(Unity의 Console 자리): [콘솔] [텔레메트리] [장치] 탭. 안에 포커스가 있으면 씬 단축키(F·Delete·
// Q/W/E 등)는 쓰지 않는다(인스펙터와 같은 localKeys). 실행 단축키(Ctrl+P 등)는 그대로 받는다.
function PlayDock(): React.JSX.Element {
  const { t } = useTranslation()
  const tab = usePlayStore((state) => state.dockTab)
  const setDockTab = usePlayStore((state) => state.setDockTab)
  const entries = usePlayStore((state) => state.entries)
  const counts = useMemo(() => consoleCounts(entries), [entries])

  const onKeyDown = (event: React.KeyboardEvent, current: DockTab): void => {
    const index = DOCK_TABS.indexOf(current)
    let next: DockTab | null = null
    if (event.key === 'ArrowRight') next = DOCK_TABS[(index + 1) % DOCK_TABS.length]
    else if (event.key === 'ArrowLeft')
      next = DOCK_TABS[(index + DOCK_TABS.length - 1) % DOCK_TABS.length]
    else if (event.key === 'Home') next = DOCK_TABS[0]
    else if (event.key === 'End') next = DOCK_TABS[DOCK_TABS.length - 1]
    if (!next) return
    event.preventDefault()
    setDockTab(next)
    document.getElementById(`play-dock-tab-${next}`)?.focus()
  }

  return (
    <section className="panel play-dock" data-local-keys aria-label={t('panels.dock')}>
      <header className="panel-header play-dock-header">
        <div className="dock-tabs" role="tablist" aria-label={t('panels.dock')}>
          {DOCK_TABS.map((id) => (
            <button
              key={id}
              id={`play-dock-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={id === tab}
              aria-controls="play-dock-panel"
              tabIndex={id === tab ? 0 : -1}
              className={id === tab ? 'dock-tab is-active' : 'dock-tab'}
              onClick={() => setDockTab(id)}
              onKeyDown={(event) => onKeyDown(event, id)}
            >
              {t(`panels.${id}`)}
              {/* 다른 탭을 보는 동안에도 오류·경고가 쌓이면 보인다 */}
              {id === 'console' && tab !== 'console' && counts.error > 0 && (
                <span className="dock-tab-badge is-error">
                  <LevelIcon level="error" />
                  {formatCount(counts.error)}
                </span>
              )}
              {id === 'console' &&
                tab !== 'console' &&
                counts.error === 0 &&
                counts.warning > 0 && (
                  <span className="dock-tab-badge is-warning">
                    <LevelIcon level="warning" />
                    {formatCount(counts.warning)}
                  </span>
                )}
            </button>
          ))}
        </div>
        <div className="panel-actions">
          <GamepadStatus />
        </div>
      </header>
      <div
        id="play-dock-panel"
        className="panel-body panel-body--fill"
        role="tabpanel"
        aria-labelledby={`play-dock-tab-${tab}`}
      >
        {tab === 'console' && <ConsoleView />}
        {tab === 'telemetry' && (
          <div className="play-dock-scroll">
            <TelemetryView />
          </div>
        )}
        {tab === 'devices' && (
          <div className="play-dock-scroll">
            <DevicesView />
          </div>
        )}
      </div>
    </section>
  )
}

export default PlayDock
