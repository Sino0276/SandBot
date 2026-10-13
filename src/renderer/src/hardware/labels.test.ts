import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en'
import ko, { type Messages } from '../i18n/locales/ko'
import { COMPONENT_TYPE_KEYS, componentDef } from './catalog'
import { HINT_TYPES, optionLabelKey, propertyLabelKey } from './labels'

function lookup(messages: Messages, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  }, messages)
}

// 카탈로그에서 만든 번역 키는 t()의 타입 검사를 받지 못하므로 여기서 확인한다
describe('하드웨어 카탈로그 번역', () => {
  const keys: string[] = []
  for (const type of COMPONENT_TYPE_KEYS) {
    for (const property of componentDef(type).properties) {
      keys.push(propertyLabelKey(property.key))
      if (property.kind === 'enum') {
        for (const option of property.options) keys.push(optionLabelKey(property.key, option))
      }
    }
  }
  for (const type of HINT_TYPES) keys.push(`hardware.hints.${type}`)

  it.each([
    ['ko', ko],
    ['en', en]
  ])('%s에 모든 속성·선택지 이름이 있다', (_, messages) => {
    const missing = keys.filter((key) => typeof lookup(messages, key) !== 'string')
    expect(missing).toEqual([])
  })
})
