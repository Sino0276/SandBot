import { useTranslation } from 'react-i18next'
import {
  AUTONOMOUS_SECONDS,
  MAX_BATTERY_VOLTAGE,
  MIN_BATTERY_VOLTAGE
} from '../../../../shared/play'
import NumberField from '../../editor/NumberField'
import { clampBatteryVoltage, clampJitter, clampSeed, JITTER_CHOICES } from '../playSettings'
import { usePlayStore } from '../playStore'

// HIVE 상태 칸 순서(빨강, 파랑: 세계 설명 field.hiveTipped의 순서)
const HIVE_SIDES = ['red', 'blue'] as const

const percent = (jitter: number): number => Math.round(jitter * 1000) / 10

function parseSeed(text: string): number | null {
  const trimmed = text.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  return clampSeed(Number(trimmed))
}

// 배터리 전압 입력: 수(뒤에 V를 붙여도 됨)를 받아 설정 범위로 자른다
function parseVoltage(text: string): number | null {
  const trimmed = text.trim().replace(/\s*[vV]$/, '')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? clampBatteryVoltage(value) : null
}

// 환경 설정 > 시뮬레이션: Hub 타이밍 오차·시드, 배터리 전압, Autonomous 30초 자동 정지, HIVE 상태. 개인 설정(localStorage)이고
// 다음 INIT부터 쓴다(HIVE 상태는 실행 중이 아니면 씬 뷰가 바로 따른다).
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
      <div className="preferences-row has-unit">
        <span className="preferences-row-label">{t('preferences.simulation.battery')}</span>
        <NumberField
          ariaLabel={t('preferences.simulation.battery')}
          value={settings.batteryVoltage}
          digits={2}
          parse={parseVoltage}
          title={t('preferences.simulation.batteryHint', {
            min: MIN_BATTERY_VOLTAGE,
            max: MAX_BATTERY_VOLTAGE
          })}
          onCommit={(volts) => updateSettings({ batteryVoltage: clampBatteryVoltage(volts) })}
        />
        <span className="preferences-row-unit">{t('preferences.simulation.batteryUnit')}</span>
      </div>
      <p className="inspector-note">
        {t('preferences.simulation.batteryHint', {
          min: MIN_BATTERY_VOLTAGE,
          max: MAX_BATTERY_VOLTAGE
        })}
      </p>
      <label className="preferences-check">
        <input
          type="checkbox"
          checked={settings.autoStopAutonomous}
          onChange={(event) => updateSettings({ autoStopAutonomous: event.target.checked })}
        />
        {t('preferences.simulation.autoStop', { seconds: AUTONOMOUS_SECONDS })}
      </label>
      <p className="inspector-note">{t('preferences.simulation.nextRun')}</p>
      {/* HIVE 상태(spec-4ab §2.3): Field 인스펙터의 같은 칸과 같은 값(개인 실행 설정, 프로젝트·실행 취소와 무관) */}
      <section className="preferences-subsection" aria-labelledby="preferences-hive">
        <h3 id="preferences-hive" className="preferences-subtitle">
          {t('preferences.simulation.hiveState')}
        </h3>
        {HIVE_SIDES.map((side) => (
          <label className="preferences-row" key={side}>
            <span className="preferences-row-label">
              {t(
                side === 'red'
                  ? 'preferences.simulation.hiveRed'
                  : 'preferences.simulation.hiveBlue'
              )}
            </span>
            <select
              className="field-select"
              value={settings.hiveState[side]}
              onChange={(event) =>
                updateSettings({
                  hiveState: {
                    ...settings.hiveState,
                    [side]: event.target.value === 'tipped' ? 'tipped' : 'start'
                  }
                })
              }
            >
              <option value="start">{t('preferences.simulation.hiveStart')}</option>
              <option value="tipped">{t('preferences.simulation.hiveTipped')}</option>
            </select>
          </label>
        ))}
        <p className="inspector-note">{t('preferences.simulation.hiveHint')}</p>
      </section>
    </section>
  )
}

export default SimulationPreferences
