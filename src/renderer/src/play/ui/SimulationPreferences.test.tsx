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
