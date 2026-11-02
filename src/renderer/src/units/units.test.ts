import { describe, expect, it } from 'vitest'
import {
  formatLength,
  formatMass,
  formatNumber,
  fromDisplayLength,
  KG_PER_LB,
  loadLengthUnit,
  massDisplay,
  parseAngle,
  parseMass,
  parseLength,
  saveLengthUnit,
  toDisplayLength
} from './units'

function createStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value)
  }
}

describe('길이 단위', () => {
  it('미터와 표시 단위를 오간다', () => {
    expect(toDisplayLength(0.4572, 'in')).toBeCloseTo(18, 9)
    expect(toDisplayLength(0.12, 'mm')).toBeCloseTo(120, 9)
    expect(fromDisplayLength(30, 'cm')).toBeCloseTo(0.3, 9)
    expect(formatLength(0.4572, 'in')).toBe('18.000')
    expect(formatLength(-0.00001, 'mm')).toBe('0.0')
  })

  it('단위를 붙인 입력을 받고, 없으면 표시 단위로 읽는다', () => {
    expect(parseLength('12in', 'mm')).toBeCloseTo(0.3048, 9)
    expect(parseLength('30 cm', 'in')).toBeCloseTo(0.3, 9)
    expect(parseLength('0.5M', 'in')).toBeCloseTo(0.5, 9)
    expect(parseLength('6"', 'mm')).toBeCloseTo(0.1524, 9)
    expect(parseLength('1ft', 'mm')).toBeCloseTo(0.3048, 9)
    expect(parseLength('-1.5', 'in')).toBeCloseTo(-0.0381, 9)
    expect(parseLength('.5', 'm')).toBeCloseTo(0.5, 9)
    expect(parseLength(' 120 ', 'mm')).toBeCloseTo(0.12, 9)
    expect(parseLength('1e2mm', 'm')).toBeCloseTo(0.1, 9)
  })

  it('읽을 수 없는 입력은 null', () => {
    expect(parseLength('', 'mm')).toBeNull()
    expect(parseLength('abc', 'mm')).toBeNull()
    expect(parseLength('12 km', 'mm')).toBeNull()
    expect(parseLength('1 2', 'mm')).toBeNull()
    expect(parseLength('12in3', 'mm')).toBeNull()
  })

  it('각도는 도가 기본이고 rad도 받는다', () => {
    expect(parseAngle('90')).toBeCloseTo(Math.PI / 2, 9)
    expect(parseAngle('90°')).toBeCloseTo(Math.PI / 2, 9)
    expect(parseAngle('-45 deg')).toBeCloseTo(-Math.PI / 4, 9)
    expect(parseAngle('1rad')).toBeCloseTo(1, 9)
    expect(parseAngle('90mm')).toBeNull()
    expect(formatNumber(-0.04, 1)).toBe('0.0')
  })

  it('개인 설정에 저장하고, 고르지 않았으면 null', () => {
    const storage = createStorage()
    expect(loadLengthUnit(storage)).toBeNull()
    saveLengthUnit(storage, 'cm')
    expect(loadLengthUnit(storage)).toBe('cm')
    storage.setItem('sandbot:lengthUnit', 'km')
    expect(loadLengthUnit(storage)).toBeNull()
  })
})

describe('질량 단위', () => {
  it('미터법 표시 단위는 1 kg 미만이면 g(정수), 그 위는 kg(소수 셋)', () => {
    for (const unit of ['mm', 'cm', 'm'] as const) {
      expect(formatMass(0.437, unit)).toBe('437 g')
      expect(formatMass(13.6, unit)).toBe('13.600 kg')
    }
    expect(formatMass(0, 'mm')).toBe('0 g')
    expect(formatMass(0.0004, 'mm')).toBe('0 g')
    // 반올림하면 1000 g이 되는 값은 kg로
    expect(formatMass(0.9996, 'cm')).toBe('1.000 kg')
    expect(formatMass(0.9994, 'cm')).toBe('999 g')
    expect(massDisplay(1.2346, 'm')).toEqual({ value: '1.235', symbol: 'kg' })
  })

  it('in 표시 단위는 lb(소수 둘), 0.1 lb 미만이면 oz(소수 하나)', () => {
    expect(formatMass(13.6, 'in')).toBe('29.98 lb')
    expect(formatMass(KG_PER_LB * 30, 'in')).toBe('30.00 lb')
    expect(formatMass(0.06, 'in')).toBe('0.13 lb')
    expect(formatMass(0.04, 'in')).toBe('1.4 oz')
    // 반올림해 0.10 lb가 되는 값은 lb, 0은 0.00 lb
    expect(formatMass(KG_PER_LB * 0.0996, 'in')).toBe('0.10 lb')
    expect(formatMass(0, 'in')).toBe('0.00 lb')
  })

  it('kg·g·lb·oz를 붙인 값과 단위 없는 값(미터법은 kg, in은 lb)을 받는다', () => {
    expect(parseMass('437g', 'mm')).toBeCloseTo(0.437, 15)
    expect(parseMass('1.2 kg', 'in')).toBeCloseTo(1.2, 15)
    expect(parseMass('30lb', 'mm')).toBeCloseTo(13.6077711, 7)
    expect(parseMass('30 LBS', 'mm')).toBeCloseTo(13.6077711, 7)
    expect(parseMass('8 oz', 'cm')).toBeCloseTo(0.226796185, 9)
    expect(parseMass('12.5', 'm')).toBe(12.5)
    expect(parseMass('30', 'in')).toBeCloseTo(13.6077711, 7)
    expect(parseMass(' .5 kg ', 'mm')).toBe(0.5)
  })

  it('읽을 수 없는 입력은 null', () => {
    for (const text of ['', 'kg', '12 stone', '1,5 kg', '3 m', 'abc'])
      expect(parseMass(text, 'mm')).toBeNull()
  })
})
