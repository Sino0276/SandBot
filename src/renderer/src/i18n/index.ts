import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LANGUAGE, loadLanguage, saveLanguage, type Language } from './language'
import en from './locales/en'
import ko from './locales/ko'

const initialLanguage = loadLanguage(localStorage)

i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en }
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  // 리소스를 번들에 포함하므로 동기 초기화해 첫 렌더부터 번역이 적용되게 한다.
  initAsync: false,
  // React가 이미 이스케이프하므로 i18next의 이스케이프는 끈다.
  interpolation: { escapeValue: false }
})

document.documentElement.lang = initialLanguage

export async function changeLanguage(language: Language): Promise<void> {
  saveLanguage(localStorage, language)
  await i18n.changeLanguage(language)
  document.documentElement.lang = language
}
