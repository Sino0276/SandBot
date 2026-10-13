import { describe, expect, it } from 'vitest'
import { DEFAULT_LANGUAGE, loadLanguage, saveLanguage } from './language'

function createStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value)
  }
}

describe('loadLanguage', () => {
  it('저장된 값이 없으면 기본 언어(한국어)를 쓴다', () => {
    expect(loadLanguage(createStorage())).toBe(DEFAULT_LANGUAGE)
    expect(DEFAULT_LANGUAGE).toBe('ko')
  })

  it('저장한 언어를 다시 읽는다', () => {
    const storage = createStorage()
    saveLanguage(storage, 'en')
    expect(loadLanguage(storage)).toBe('en')
  })

  it('지원하지 않는 값이 저장되어 있으면 기본 언어로 돌아간다', () => {
    const storage = createStorage()
    storage.setItem('sandbot:language', 'fr')
    expect(loadLanguage(storage)).toBe(DEFAULT_LANGUAGE)
  })
})
