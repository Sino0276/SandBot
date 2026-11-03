import i18n from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import en from '../../i18n/locales/en'
import ko from '../../i18n/locales/ko'
import { massText } from './massCardModel'

// units.ts의 formatMass는 기호 글자를 쓰는 쪽에게서 받는다(갈래 B). 계약의 빈 구현은 기호를 쓰지 않으므로, 기호를 쓰는
// 구현으로 바꿔 massText가 i18n 기호를 넘기는지 본다.
vi.mock('../../units/units', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../units/units')>()),
  formatMass: (kg: number, unit: string, symbols: Record<string, string>) =>
    `${kg} ${unit === 'in' ? symbols.lb : symbols.kg}`
}))

describe('massText', () => {
  it.each([
    ['ko', ko],
    ['en', en]
  ] as const)('%s 리소스의 질량 기호를 formatMass에 넘긴다', async (lng, messages) => {
    const instance = i18n.createInstance()
    await instance.init({
      resources: { [lng]: { translation: messages } },
      lng,
      initAsync: false,
      interpolation: { escapeValue: false }
    })
    expect(massText(instance.t, 2, 'mm')).toBe(`2 ${messages.units.massSymbols.kg}`)
    expect(massText(instance.t, 2, 'in')).toBe(`2 ${messages.units.massSymbols.lb}`)
  })
})
