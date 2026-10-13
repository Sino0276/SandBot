export const SUPPORTED_LANGUAGES = ['ko', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'ko'

// 언어 이름은 현재 UI 언어와 관계없이 각 언어의 자기 이름으로 표시하므로 번역 리소스에 넣지 않는다.
export const LANGUAGE_NAMES: Record<Language, string> = {
  ko: '한국어',
  en: 'English'
}

const STORAGE_KEY = 'sandbot:language'

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

export function loadLanguage(storage: Pick<Storage, 'getItem'>): Language {
  const saved = storage.getItem(STORAGE_KEY)
  return isLanguage(saved) ? saved : DEFAULT_LANGUAGE
}

export function saveLanguage(storage: Pick<Storage, 'setItem'>, language: Language): void {
  storage.setItem(STORAGE_KEY, language)
}
