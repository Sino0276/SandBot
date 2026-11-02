import { describe, expect, it } from 'vitest'
import { goBildaSkus, matchNameRule, nameRuleMaterial, nameWords, WORD_RULES } from './nameRules'
import { MATERIAL_KEYS } from './types'

const rule = (...names: string[]): string | null => matchNameRule(names)?.name ?? null
const material = (...names: string[]): string | null | undefined =>
  matchNameRule(names) ? matchNameRule(names)!.material : undefined

describe('이름 규칙', () => {
  it('이름을 낱말로 나눈다(camelCase·기호·SKU 빼기)', () => {
    expect(nameWords('RollerTire')).toEqual(['roller', 'tire'])
    expect(nameWords('5103 Gearbox Barrel (simple)')).toEqual([
      '5103',
      'gearbox',
      'barrel',
      'simple'
    ])
    expect(nameWords('99461A915_Phillips Rounded Head Thread-Forming Screws (1)')).toContain(
      'screws'
    )
    // SKU 자리의 숫자는 재질 낱말(6061·7075)로 읽지 않는다
    expect(nameWords('2106-6061-7075 shaft')).toEqual(['shaft'])
    expect(goBildaSkus('2000-0025-0002 Top Label')).toEqual(['2000-0025-0002'])
    expect(goBildaSkus('12000-0025-0002')).toEqual([])
  })

  it('대소문자를 무시하고 낱말 경계·복수형으로 맞춘다', () => {
    expect(rule('M4 SCREW')).toBe('screw')
    expect(rule('Screws')).toBe('screw')
    expect(rule('Labels')).toBe('label')
    expect(rule('Washers 4mm')).toBe('washer')
    // 낱말 안의 글자는 맞추지 않는다(Spinner의 pin, Gearbox의 gear, plate의 pla)
    expect(rule('Spinner')).toBeNull()
    expect(rule('5103 Gearbox Base')).toBeNull()
    expect(rule('Side Plates')).toBe('channel')
    expect(material('Side Plates')).toBe('aluminum6061')
  })

  it('위에서 첫 맞는 규칙을 쓴다(재질 이름이 먼저, 긴 낱말열이 짧은 것보다 먼저)', () => {
    // 재질 이름이 부품 종류보다 먼저
    expect(material('Aluminum Shaft')).toBe('aluminum6061')
    expect(material('PLA Bracket')).toBe('pla')
    expect(material('Plastic Spacer')).toBe('polycarbonate')
    // carbon steel은 탄소섬유가 아니다
    expect(material('Carbon Steel Pin')).toBe('steel')
    expect(material('Carbon Fiber Plate')).toBe('carbonFiber')
    // servo shaft(알루미늄)가 shaft(강철)보다 먼저
    expect(rule('8mm REX Servo Shaft')).toBe('servo-shaft')
    expect(material('8mm REX Servo Shaft')).toBe('aluminum6061')
    expect(material('REX Shaft')).toBe('steel')
    // 세트 스크루 칼라는 screw(강철), 클램핑 칼라는 알루미늄
    expect(material('Set Screw Collar')).toBe('steel')
    expect(material('Clamping Collar')).toBe('aluminum6061')
    expect(material('Threaded Plate')).toBe('stainless')
    expect(material('Plastic Chain')).toBe('acetal')
    expect(material('Chain')).toBe('steel')
    expect(material('HTD Belt')).toBe('rubber')
    expect(material('RollerTire')).toBe('rubber')
    expect(material('Zip Tie')).toBe('nylon')
    expect(material('Bearing')).toBe('steel')
  })

  it('라벨은 질량 0(재질 null)이다', () => {
    expect(material('5203-2402-0019 Label')).toBeNull()
    expect(material('Top Sticker')).toBeNull()
  })

  it('오인하기 쉬운 짧은 낱말은 쓰지 않는다(비평 E12)', () => {
    for (const name of ['OR', 'IR', 'OD', 'ID', 'PC', 'SS', 'CF', 'Ply', 'Alu', 'POM', 'EVA'])
      expect(rule(name)).toBeNull()
    expect(rule('Pin')).toBe('pin')
    expect(rule('Lock Nut')).toBe('nut')
  })

  it('낱말이 없으면 goBILDA SKU 시리즈로 재질을 정한다(비평 정정 포함)', () => {
    expect(matchNameRule(['1120-0015-0384'])).toEqual({
      name: 'gobilda-1120',
      material: 'aluminum6061'
    })
    expect(material('2800-0004-0010')).toBe('steel')
    expect(material('2803-0007-0024')).toBe('stainless')
    expect(material('1611-0514-0006 2')).toBe('steel')
    expect(material('2106-4008-2640')).toBe('stainless')
    expect(material('2909-0102-0250 (Installed_1209-0001-0001)')).toBe('nylon')
    // 바퀴·롤러는 COTS 질량을 못 찾아 고무로 근사(알루미늄 아님)
    expect(material('3613-0014-0072')).toBe('rubber')
    expect(material('3618-4008-0016 (Stretched over 8 REX)')).toBe('rubber')
    expect(material('3626-0014-0096')).toBe('rubber')
    // COTS 질량 표로 가는 시리즈(메카넘·배터리·모터·서보)는 재질 규칙이 없다
    for (const sku of ['3625-0100-0104', '3100-0012-0020', '5203-2402-0019', '2000-0025-0002'])
      expect(matchNameRule([sku])).toBeNull()
    // 내보낸 시각 이름은 정보가 없다
    expect(matchNameRule(['2026-09-03-14-28-26-685'])).toBeNull()
  })

  it('한 묶음의 모든 이름에 낱말 규칙을 먼저 본 뒤 SKU를 본다', () => {
    // 원래 CAD 이름은 SKU, 사용자가 바꾼 이름에 재질 낱말
    expect(material('1120-0001-0048', 'PLA Arm')).toBe('pla')
    expect(material('1120-0001-0048', 'Left Arm')).toBe('aluminum6061')
  })

  it('규칙 이름은 서로 다르고 재질은 재질 목록에 있다', () => {
    const names = WORD_RULES.map((wordRule) => wordRule.name)
    expect(new Set(names).size).toBe(names.length)
    for (const wordRule of WORD_RULES) {
      if (wordRule.material !== null) expect(MATERIAL_KEYS).toContain(wordRule.material)
      expect(nameRuleMaterial(wordRule.name)).toBe(wordRule.material)
    }
    expect(nameRuleMaterial('gobilda-2800')).toBe('steel')
    expect(nameRuleMaterial('nope')).toBeUndefined()
  })
})
