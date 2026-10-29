import { describe, expect, it } from 'vitest'
import type { AndroidSdkState } from '../../../shared/play'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import {
  ANDROID_SDK_BROWSE,
  androidSdkChoice,
  androidSdkOptions,
  androidSdkValue,
  platformList
} from './androidSdkOptions'

const sdkA = {
  home: '/opt/sdk',
  platforms: ['android-30', 'android-34'],
  source: 'localProperties' as const
}
const sdkB = { home: '/home/me/Android/Sdk', platforms: [], source: 'default' as const }

describe('Android SDK 선택 상자', () => {
  it('자동, 찾은 SDK(같은 폴더는 한 번), 찾아보기 순이다', () => {
    const state: AndroidSdkState = {
      choice: { kind: 'auto' },
      active: sdkA,
      detected: [sdkA, sdkB, { ...sdkA, source: 'env' }]
    }
    expect(androidSdkValue(state)).toBe('auto')
    expect(androidSdkOptions(state).map((o) => [o.kind, o.value])).toEqual([
      ['auto', 'auto'],
      ['sdk', 'home:/opt/sdk'],
      ['sdk', 'home:/home/me/Android/Sdk'],
      ['browse', ANDROID_SDK_BROWSE]
    ])
  })

  it('목록에 없는 직접 고른 폴더도 보인다', () => {
    const state: AndroidSdkState = {
      choice: { kind: 'custom', home: '/gone' },
      active: null,
      detected: [sdkA]
    }
    expect(androidSdkValue(state)).toBe('home:/gone')
    expect(androidSdkOptions(state).map((o) => o.kind)).toEqual(['auto', 'sdk', 'custom', 'browse'])
  })

  it('고른 값 → 선택(지금과 같으면 null)', () => {
    const state: AndroidSdkState = { choice: { kind: 'auto' }, active: sdkA, detected: [sdkA] }
    expect(androidSdkChoice('auto', state, 't')).toBeNull()
    expect(androidSdkChoice(ANDROID_SDK_BROWSE, state, 'title')).toEqual({
      kind: 'browse',
      title: 'title'
    })
    expect(androidSdkChoice('home:/opt/sdk', state, 't')).toEqual({
      kind: 'detected',
      home: '/opt/sdk'
    })
    expect(androidSdkChoice('home:', state, 't')).toBeNull()
    expect(androidSdkChoice('junk', state, 't')).toBeNull()
    const custom: AndroidSdkState = { ...state, choice: { kind: 'custom', home: '/opt/sdk' } }
    expect(androidSdkChoice('home:/opt/sdk', custom, 't')).toBeNull()
    expect(androidSdkChoice('auto', custom, 't')).toEqual({ kind: 'auto' })
  })

  it('플랫폼 목록 글자(부 버전 폴더도 이름 그대로, 메인이 정한 순서)', () => {
    expect(platformList(['android-30', 'android-34'])).toBe('android-30, android-34')
    expect(platformList(['android-36', 'android-36.1', 'android-37.0'])).toBe(
      'android-36, android-36.1, android-37.0'
    )
    expect(platformList([])).toBe('')
  })
})

describe('Android SDK가 없을 때의 INIT 실패 안내', () => {
  it('환경 설정에서 고른 폴더를 쓸 수 없게 된 경우도 말하고, 자동으로 찾는다고 하지 않는다', () => {
    // 고른 폴더를 쓸 수 없으면 메인은 자동으로 넘어가지 않으므로(androidSdk.ts) 다시 고르거나 자동으로 바꾸게 한다
    expect(ko.notice.playNoAndroidSdk).toContain('환경 설정에서 고른 SDK 폴더')
    expect(ko.notice.playNoAndroidSdk).toContain('자동으로 바꾸')
    expect(ko.notice.playNoAndroidSdk).not.toMatch(/자동으로 찾습니다/)
    expect(en.notice.playNoAndroidSdk).toContain('chosen in Preferences')
    expect(en.notice.playNoAndroidSdk).toContain('switch to Automatic')
    expect(en.notice.playNoAndroidSdk).not.toMatch(/found automatically/)
  })
})
