import 'i18next'
import type { Messages } from './locales/ko'

// t('...')의 키를 ko 로케일 구조로 타입 검사한다. 없는 키를 쓰면 typecheck가 실패한다.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: Messages }
  }
}
