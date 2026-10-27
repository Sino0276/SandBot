import { useTranslation } from 'react-i18next'
import { PLAY_SPEEDS, type PlaySpeed } from '../../../../shared/play'
import { ariaKeyShortcut, shortcutLabel } from '../../editor/shortcuts'
import { useProjectStore } from '../../project/projectStore'
import {
  canStep,
  initBlock,
  playButton,
  setPlaySpeed,
  stepPlay,
  stopPlay,
  togglePause
} from '../playActions'
import { findOpMode } from '../opModeList'
import { formatRatio, formatVirtualTime, isRunningSlow, toolbarClock } from '../playFormat'
import { isPlaySpeed } from '../playSettings'
import { isRunActive, usePlayStore } from '../playStore'
import OpModePicker from './OpModePicker'
import { PlayIcon } from './PlayIcons'

const speedValue = (speed: PlaySpeed): string => String(speed)

function parseSpeed(value: string): PlaySpeed | null {
  const speed = value === 'max' ? 'max' : Number(value)
  return isPlaySpeed(speed) ? speed : null
}

// 툴바 가운데의 실행 버튼(Unity의 Play·Pause·Step 자리). FTC에 맞게 OpMode 선택과 INIT → START → STOP 한 버튼(DS)을 둔다.
function PlayControls(): React.JSX.Element {
  const { t } = useTranslation()
  const root = useProjectStore((state) => state.root)
  const busy = useProjectStore((state) => state.busy)
  const run = usePlayStore((state) => state.run)
  const opModeList = usePlayStore((state) => state.opModeList)
  const selectedClass = usePlayStore((state) => state.selectedClass)
  const paused = usePlayStore((state) => state.paused)
  const speed = usePlayStore((state) => state.settings.speed)

  const active = isRunActive(run)
  const block = initBlock({ root, busy }, { opModeList, selectedClass, run })
  const stepEnabled = canStep({ run, paused })
  const stopping = active && (run.stopRequested || run.phase === 'stopping')
  // 한 버튼: INIT(실행 없음) → START(init) → STOP(그 밖의 실행 중)
  const mode: 'init' | 'start' | 'stop' = !active
    ? 'init'
    : run.phase === 'init' && !run.startRequested && !run.stopRequested
      ? 'start'
      : 'stop'
  const mainLabel = t(`play.${mode}`)
  const mainTooltip =
    mode === 'init'
      ? block
        ? t(`play.disabled.${block}`)
        : t('play.initTooltip', { shortcut: shortcutLabel('play') })
      : stopping
        ? t('play.stoppingTooltip')
        : t(mode === 'start' ? 'play.startTooltip' : 'play.stopTooltip', {
            shortcut: shortcutLabel('play')
          })
  const mainDisabled = mode === 'init' ? block !== null : stopping

  // 시간: 실행이 있으면(끝난 실행도) 그 실행의 가상 시간(Autonomous는 30초에서 거꾸로), 없으면 고른 OpMode의 0
  // (Autonomous는 DS처럼 30초)
  const flavor = run?.opMode.flavor ?? null
  const selectedFlavor =
    opModeList.root === root ? findOpMode(opModeList.opModes, selectedClass)?.flavor : undefined
  const clock = run
    ? toolbarClock(run.opMode.flavor, run.status.tNanos, run.status.startedNanos)
    : toolbarClock(selectedFlavor ?? 'TeleOp', 0, null)
  const clockTitle = run
    ? flavor === 'Autonomous'
      ? t('play.autonomousTooltip', { time: formatVirtualTime(run.status.tNanos) })
      : t('play.timeTooltip', { time: clock.text })
    : t('play.timeIdleTooltip')
  const phaseText =
    active && (run.phase === 'preparing' || run.phase === 'compiling' || stopping)
      ? t(`play.phase.${stopping ? 'stopping' : run.phase}`)
      : null
  const slow =
    active &&
    (run.phase === 'init' || run.phase === 'running') &&
    isRunningSlow(speed, run.status.realtime, run.status.paused)

  return (
    <div className="toolbar-group toolbar-play" role="group" aria-label={t('play.controls')}>
      <OpModePicker />
      <div className={active ? 'play-buttons is-playing' : 'play-buttons'}>
        <button
          type="button"
          className={
            active ? `play-button play-main is-${mode} is-active` : 'play-button play-main'
          }
          title={mainTooltip}
          aria-label={mainLabel}
          aria-keyshortcuts={ariaKeyShortcut('play')}
          disabled={mainDisabled}
          onClick={playButton}
        >
          {mode !== 'init' && <PlayIcon name={mode === 'start' ? 'play' : 'stop'} size={12} />}
          <span>{mainLabel}</span>
        </button>
        {mode === 'start' && (
          // DS처럼 INIT 중에는 START하지 않고 멈출 수 있다
          <button
            type="button"
            className="play-button play-icon-button"
            title={t('play.stopInitTooltip')}
            aria-label={t('play.stopInit')}
            onClick={stopPlay}
          >
            <PlayIcon name="stop" size={10} />
          </button>
        )}
        <button
          type="button"
          className={
            paused ? 'play-button play-icon-button is-pressed' : 'play-button play-icon-button'
          }
          title={t('play.pauseTooltip', { shortcut: shortcutLabel('pause') })}
          aria-label={t('play.pause')}
          aria-pressed={paused}
          aria-keyshortcuts={ariaKeyShortcut('pause')}
          onClick={togglePause}
        >
          <PlayIcon name="pause" size={12} />
        </button>
        <button
          type="button"
          className="play-button play-icon-button"
          title={t('play.stepTooltip', { shortcut: shortcutLabel('step') })}
          aria-label={t('play.step')}
          aria-keyshortcuts={ariaKeyShortcut('step')}
          disabled={!stepEnabled}
          onClick={stepPlay}
        >
          <PlayIcon name="step" size={12} />
        </button>
      </div>
      <select
        className="toolbar-select play-speed"
        aria-label={t('play.speed')}
        title={t('play.speedTooltip')}
        value={speedValue(speed)}
        onChange={(event) => {
          const next = parseSpeed(event.target.value)
          if (next !== null) setPlaySpeed(next)
        }}
      >
        {PLAY_SPEEDS.map((option) => (
          <option key={speedValue(option)} value={speedValue(option)}>
            {option === 'max' ? t('play.speedMax') : t('play.speedValue', { speed: option })}
          </option>
        ))}
      </select>
      <span
        className={['play-clock', clock.countdown && 'is-countdown', !active && 'is-idle']
          .filter(Boolean)
          .join(' ')}
        title={clockTitle}
        role="timer"
        aria-label={clockTitle}
      >
        {clock.text}
      </span>
      {phaseText && (
        <span className="play-phase" role="status">
          {phaseText}
        </span>
      )}
      {slow && run && (
        <span
          className="play-slow"
          role="status"
          title={t('play.slowTooltip', {
            speed: typeof speed === 'number' ? formatRatio(speed) : '',
            ratio: formatRatio(run.status.realtime)
          })}
        >
          {t('play.slow', { ratio: formatRatio(run.status.realtime) })}
        </span>
      )}
    </div>
  )
}

export default PlayControls
