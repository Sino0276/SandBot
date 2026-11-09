import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../playSettings'
import { usePlayStore } from '../playStore'
import SimulationPreferences from './SimulationPreferences'

// 환경 설정 › 시뮬레이션의 HIVE 상태 칸(spec-4ab §2.3, renderToStaticMarkup, DOM 없음)

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다. 그 객체에도 같은 값을 넣고 끝나면 되돌린다.
const initial = usePlayStore.getInitialState()
const saved = { ...initial }

afterEach(() => {
  Object.assign(initial, saved)
})

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

describe('SimulationPreferences HIVE 상태', () => {
  it('빨강·파랑 선택칸이 실행 설정 hiveState를 보이고 도움말이 있다', () => {
    Object.assign(initial, {
      settings: { ...DEFAULT_PLAY_SETTINGS, hiveState: { red: 'tipped', blue: 'start' } }
    })
    const html = renderToStaticMarkup(<SimulationPreferences />)
    expect(html).toContain(ko.preferences.simulation.hiveState)
    expect(html).toContain(ko.preferences.simulation.hiveRed)
    expect(html).toContain(ko.preferences.simulation.hiveBlue)
    expect(html).toContain(ko.preferences.simulation.hiveHint)
    // 고른 값(option selected): 빨강 넘어감, 파랑 시작
    const selected = [...html.matchAll(/<option value="(\w+)" selected="">/g)].map((m) => m[1])
    expect(selected.slice(-2)).toEqual(['tipped', 'start'])
  })
})

describe('SimulationPreferences 센서 잡음', () => {
  // B8(spec-4c §1.6): 체크 칸 하나와 도움말(거리 센서만, 시드가 같으면 같은 값)
  it('체크 칸이 실행 설정 sensorNoise를 보이고 도움말이 있다', () => {
    const label = (html: string): string => {
      const end = html.indexOf(`${ko.preferences.simulation.sensorNoise}</label>`)
      expect(end).toBeGreaterThan(0)
      return html.slice(html.lastIndexOf('<label', end), end)
    }
    Object.assign(initial, { settings: { ...DEFAULT_PLAY_SETTINGS, sensorNoise: true } })
    const on = renderToStaticMarkup(<SimulationPreferences />)
    expect(on).toContain(ko.preferences.simulation.sensorNoiseHint)
    expect(label(on)).toContain('checked=""')
    Object.assign(initial, { settings: { ...DEFAULT_PLAY_SETTINGS, sensorNoise: false } })
    expect(label(renderToStaticMarkup(<SimulationPreferences />))).not.toContain('checked=""')
  })

  // 4c 리뷰: 잡음은 Hub 타이밍 시드 칸을 함께 쓰므로 오차(기본 끔)가 꺼져도 잡음을 켰으면 시드를 고칠 수 있다
  it('시드 칸은 오차와 잡음이 모두 꺼졌을 때만 비활성이다', () => {
    const seedInput = (settings: object): string => {
      Object.assign(initial, { settings: { ...DEFAULT_PLAY_SETTINGS, ...settings } })
      const html = renderToStaticMarkup(<SimulationPreferences />)
      const match = html.match(/<input[^>]*aria-label="시드"[^>]*>/)
      expect(match).not.toBeNull()
      return match![0]
    }
    expect(seedInput({ jitter: 0, sensorNoise: false })).toContain('disabled=""')
    expect(seedInput({ jitter: 0, sensorNoise: true })).not.toContain('disabled=""')
    expect(seedInput({ jitter: 0.1, sensorNoise: false })).not.toContain('disabled=""')
    expect(ko.preferences.simulation.seedHint).toContain('센서 잡음')
  })
})
