import { useTranslation } from 'react-i18next'
import { AUTONOMOUS_SECONDS } from '../../../../shared/play'
import NumberField from '../../editor/NumberField'
import { clampJitter, clampSeed, JITTER_CHOICES } from '../playSettings'
import { usePlayStore } from '../playStore'

const percent = (jitter: number): number => Math.round(jitter * 1000) / 10

function parseSeed(text: string): number | null {
  const trimmed = text.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  return clampSeed(Number(trimmed))
}

// 환경 설정 > 시뮬레이션: Hub 타이밍 오차·시드, Autonomous 30초 자동 정지. 개인 설정(localStorage)이고 다음 INIT부터 쓴다.
function SimulationPreferences(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = usePlayStore((state) => state.settings)
  const updateSettings = usePlayStore((state) => state.updateSettings)
  const choices = JITTER_CHOICES.includes(settings.jitter)
    ? JITTER_CHOICES
    : [...JITTER_CHOICES, settings.jitter].sort((a, b) => a - b)

  return (
    <section className="preferences-page" aria-labelledby="preferences-simulation">
      <h2 id="preferences-simulation" className="preferences-page-title">
        {t('preferences.simulation.title')}
      </h2>
      <label className="preferences-row">
        <span className="preferences-row-label">{t('preferences.simulation.jitter')}</span>
        <select
          className="field-select"
          value={String(settings.jitter)}
          onChange={(event) => updateSettings({ jitter: clampJitter(Number(event.target.value)) })}
        >
          {choices.map((jitter) => (
            <option key={jitter} value={String(jitter)}>
              {jitter === 0
                ? t('preferences.simulation.jitterOff')
                : t('preferences.simulation.jitterValue', { percent: percent(jitter) })}
            </option>
          ))}
        </select>
      </label>
      <p className="inspector-note">{t('preferences.simulation.jitterHint')}</p>
      <div className="preferences-row">
        <span className="preferences-row-label">{t('preferences.simulation.seed')}</span>
        <NumberField
          ariaLabel={t('preferences.simulation.seed')}
          value={settings.seed}
          digits={0}
          disabled={settings.jitter === 0}
          parse={parseSeed}
          title={t('preferences.simulation.seedHint')}
          onCommit={(seed) => updateSettings({ seed: clampSeed(seed) })}
        />
      </div>
      <label className="preferences-check">
        <input
          type="checkbox"
          checked={settings.autoStopAutonomous}
          onChange={(event) => updateSettings({ autoStopAutonomous: event.target.checked })}
        />
        {t('preferences.simulation.autoStop', { seconds: AUTONOMOUS_SECONDS })}
      </label>
      <p className="inspector-note">{t('preferences.simulation.nextRun')}</p>
    </section>
  )
}

export default SimulationPreferences
