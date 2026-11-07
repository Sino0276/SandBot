import i18n from 'i18next'
import { describe, expect, it, vi } from 'vitest'

// 모듈 머리의 languageChanged 리스너: 모듈이 다시 평가되어도(pnpm dev의 HMR) 이전 인스턴스의 리스너를 떼고 하나만 남긴다
// (4ab 리뷰 수정). i18next 내부 observers로 붙은 리스너를 센다.

type Observers = { observers: Record<string, Map<unknown, number> | undefined> }
const listeners = (): Map<unknown, number> =>
  (i18n as unknown as Observers).observers.languageChanged ?? new Map()

describe('fieldActions languageChanged 리스너', () => {
  it('모듈을 다시 평가하면 이전 인스턴스의 리스너를 떼고 새 것 하나만 붙인다', async () => {
    vi.resetModules()
    const first = await import('./fieldActions')
    const before = listeners().size
    expect(listeners().has(first.relabelFieldNotices)).toBe(true)

    vi.resetModules()
    const second = await import('./fieldActions')
    expect(second.relabelFieldNotices).not.toBe(first.relabelFieldNotices)
    expect(listeners().has(first.relabelFieldNotices)).toBe(false)
    expect(listeners().has(second.relabelFieldNotices)).toBe(true)
    expect(listeners().size).toBe(before)
  })
})
