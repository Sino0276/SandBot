import { describe, expect, it } from 'vitest'
import type { JdkInfo, JdkState } from '../../../shared/play'
import { jdkChoice, jdkOptions, jdkValue } from './jdkOptions'
import {
  autonomousRemainingNanos,
  formatDeviceValue,
  formatVirtualTime,
  htmlToText,
  isRunningSlow,
  telemetryLines,
  toolbarClock
} from './playFormat'
import {
  CONSOLE_PREFS_KEY,
  DEFAULT_CONSOLE_PREFS,
  DEFAULT_PLAY_SETTINGS,
  loadConsolePrefs,
  loadDockTab,
  loadLastOpMode,
  loadPlaySettings,
  parsePlaySettings,
  PLAY_SETTINGS_KEY,
  saveConsolePrefs,
  saveDockTab,
  saveLastOpMode,
  savePlaySettings
} from './playSettings'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key)
  }
}

// 접근이 막힌 저장소(개인 정보 보호 설정 등): 읽기·쓰기가 모두 던진다
const throwing: Storage = {
  length: 0,
  clear: () => {},
  key: () => null,
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {}
}

describe('실행 설정(localStorage)', () => {
  it('저장하고 다시 읽는다', () => {
    const storage = memoryStorage()
    expect(loadPlaySettings(storage)).toEqual(DEFAULT_PLAY_SETTINGS)
    const settings = { speed: 'max' as const, jitter: 0.1, seed: 42, autoStopAutonomous: false }
    savePlaySettings(settings, storage)
    expect(loadPlaySettings(storage)).toEqual(settings)
  })

  it('깨진 값·맞지 않는 항목은 기본값으로(항목마다)', () => {
    const storage = memoryStorage()
    storage.setItem(PLAY_SETTINGS_KEY, '{not json')
    expect(loadPlaySettings(storage)).toEqual(DEFAULT_PLAY_SETTINGS)
    expect(
      parsePlaySettings({ speed: 3, jitter: 9, seed: 1.7, autoStopAutonomous: 'yes' })
    ).toEqual({ ...DEFAULT_PLAY_SETTINGS, jitter: 0.5, seed: 1 })
    expect(parsePlaySettings({ jitter: -1, seed: 2 ** 40 })).toEqual({
      ...DEFAULT_PLAY_SETTINGS,
      jitter: 0,
      seed: 2 ** 31 - 1
    })
    expect(parsePlaySettings(null)).toEqual(DEFAULT_PLAY_SETTINGS)
  })

  it('저장소가 없거나 막혀 있어도 던지지 않는다', () => {
    expect(loadPlaySettings(null)).toEqual(DEFAULT_PLAY_SETTINGS)
    expect(loadPlaySettings(throwing)).toEqual(DEFAULT_PLAY_SETTINGS)
    expect(() => savePlaySettings(DEFAULT_PLAY_SETTINGS, throwing)).not.toThrow()
    expect(() => saveLastOpMode('/p', 'a.B', throwing)).not.toThrow()
    expect(loadLastOpMode('/p', throwing)).toBeNull()
    expect(loadConsolePrefs(throwing)).toEqual(DEFAULT_CONSOLE_PREFS)
    expect(loadDockTab(throwing)).toBe('console')
  })

  it('마지막 OpMode는 프로젝트 루트마다 따로', () => {
    const storage = memoryStorage()
    saveLastOpMode('C:\\team\\a', 'org.a.Drive', storage)
    saveLastOpMode('/home/b', 'org.b.Auto', storage)
    expect(loadLastOpMode('C:\\team\\a', storage)).toBe('org.a.Drive')
    expect(loadLastOpMode('/home/b', storage)).toBe('org.b.Auto')
    saveLastOpMode('/home/b', null, storage)
    expect(loadLastOpMode('/home/b', storage)).toBeNull()
    expect(loadLastOpMode('C:\\team\\a', storage)).toBe('org.a.Drive')
  })

  it('Console 토글과 아래 패널 탭', () => {
    const storage = memoryStorage()
    expect(loadConsolePrefs(storage).clearOnPlay).toBe(true)
    saveConsolePrefs(
      { clearOnPlay: false, show: { info: false, warning: true, error: true } },
      storage
    )
    expect(loadConsolePrefs(storage)).toEqual({
      clearOnPlay: false,
      show: { info: false, warning: true, error: true }
    })
    storage.setItem(CONSOLE_PREFS_KEY, JSON.stringify({ show: { error: 'no' } }))
    expect(loadConsolePrefs(storage)).toEqual(DEFAULT_CONSOLE_PREFS)
    saveDockTab('devices', storage)
    expect(loadDockTab(storage)).toBe('devices')
  })
})

describe('실행 화면의 값 글자', () => {
  it('가상 시간 mm:ss.mmm', () => {
    expect(formatVirtualTime(0)).toBe('00:00.000')
    expect(formatVirtualTime(1_234_567_890)).toBe('00:01.234')
    expect(formatVirtualTime(61_005_000_000)).toBe('01:01.005')
    expect(formatVirtualTime(-5)).toBe('00:00.000')
    expect(formatVirtualTime(3_600_000_000_000)).toBe('60:00.000')
  })

  it('Autonomous는 START 뒤 30초에서 거꾸로(START 전에는 30초)', () => {
    expect(autonomousRemainingNanos(null)).toBe(30_000_000_000)
    expect(autonomousRemainingNanos(12_500_000_000)).toBe(17_500_000_000)
    expect(autonomousRemainingNanos(31_000_000_000)).toBe(0)
    expect(toolbarClock('Autonomous', 99_000_000_000, 2_000_000_000)).toEqual({
      text: '00:28.000',
      countdown: true
    })
    expect(toolbarClock('TeleOp', 2_000_000_000, 1_000_000_000)).toEqual({
      text: '00:02.000',
      countdown: false
    })
  })

  it('실제 속도가 설정의 80% 아래면 느림(일시 정지·최대·모름은 아님)', () => {
    expect(isRunningSlow(1, 0.7, false)).toBe(true)
    expect(isRunningSlow(1, 0.85, false)).toBe(false)
    expect(isRunningSlow(4, 2, false)).toBe(true)
    expect(isRunningSlow(1, 0.1, true)).toBe(false)
    expect(isRunningSlow('max', 0.1, false)).toBe(false)
    expect(isRunningSlow(1, 0, false)).toBe(false)
  })

  it('장치 값', () => {
    expect(formatDeviceValue(null)).toBe('—')
    expect(formatDeviceValue(true)).toBe('true')
    expect(formatDeviceValue(-1)).toBe('-1')
    expect(formatDeviceValue(0.123456)).toBe('0.1235')
    expect(formatDeviceValue(0.5)).toBe('0.5')
    expect(formatDeviceValue('RUN_TO_POSITION')).toBe('RUN_TO_POSITION')
  })

  it('HTML 텔레메트리는 태그를 빼고 글자로(그리지 않는다)', () => {
    expect(htmlToText('<b>Arm</b>: 5<br/>next &amp; &lt;x&gt; &#65;&#x42;')).toBe(
      'Arm: 5\nnext & <x> AB'
    )
    expect(htmlToText('<script>alert(1)</script>ok')).toBe('alert(1)ok')
    expect(htmlToText('&unknown; &#0;')).toBe('&unknown; &#0;')
    const frame = { lines: ['<i>a</i>'], log: ['<b>b</b>'], format: 'html' as const }
    expect(telemetryLines(frame)).toEqual({ lines: ['a'], log: ['b'] })
    const classic = { ...frame, format: 'classic' as const }
    expect(telemetryLines(classic)).toEqual({ lines: ['<i>a</i>'], log: ['<b>b</b>'] })
  })
})

describe('JDK 선택 상자', () => {
  const jdk = (home: string, major: number, source: JdkInfo['source']): JdkInfo => ({
    home,
    version: `${major}.0.1`,
    major,
    source
  })
  const studio = jdk('C:/Program Files/Android/Android Studio/jbr', 21, 'androidStudio')
  const old = jdk('C:/Java/jdk1.8.0_301', 8, 'javaHome')
  const auto: JdkState = {
    choice: { kind: 'auto' },
    active: studio,
    detected: [studio, old, studio]
  }

  it('자동, 찾은 JDK(17 미만은 고를 수 없음, 겹치면 한 번), 찾아보기', () => {
    expect(jdkValue(auto)).toBe('auto')
    expect(
      jdkOptions(auto).map((option) => [option.kind, option.kind === 'jdk' ? option.usable : null])
    ).toEqual([
      ['auto', null],
      ['jdk', true],
      ['jdk', false],
      ['browse', null]
    ])
  })

  it('직접 고른 폴더가 목록에 없으면 따로 보이고, 같은 값을 다시 고르면 바꾸지 않는다', () => {
    const custom: JdkState = {
      choice: { kind: 'custom', home: 'D:/jdk-17' },
      active: null,
      detected: [studio]
    }
    const options = jdkOptions(custom)
    expect(options.at(-2)).toEqual({ value: 'home:D:/jdk-17', kind: 'custom', home: 'D:/jdk-17' })
    expect(jdkChoice('home:D:/jdk-17', custom, 'title')).toBeNull()
    expect(jdkChoice('auto', custom, 'title')).toEqual({ kind: 'auto' })
    expect(jdkChoice(`home:${studio.home}`, custom, 'title')).toEqual({
      kind: 'detected',
      home: studio.home
    })
    expect(jdkChoice('browse', custom, 'Choose')).toEqual({ kind: 'browse', title: 'Choose' })
    expect(jdkChoice('auto', auto, 'title')).toBeNull()
  })
})
