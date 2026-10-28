import { describe, expect, it } from 'vitest'
import type { AndroidSdkState } from '../../../shared/play'
import {
  ANDROID_SDK_BROWSE,
  androidSdkChoice,
  androidSdkOptions,
  androidSdkValue,
  platformList
} from './androidSdkOptions'

const sdkA = { home: '/opt/sdk', platforms: [30, 34], source: 'localProperties' as const }
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

  it('플랫폼 목록 글자', () => {
    expect(platformList([30, 34])).toBe('android-30, android-34')
    expect(platformList([])).toBe('')
  })
})
