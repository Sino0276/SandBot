import { describe, expect, it } from 'vitest'
import {
  formatLength,
  formatNumber,
  fromDisplayLength,
  loadLengthUnit,
  parseAngle,
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
