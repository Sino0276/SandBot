import { describe, expect, it } from 'vitest'
import {
  goBildaSkus,
  matchAncestorRule,
  matchNameRule,
  nameRuleMaterial,
  nameWords,
  WORD_RULES
} from './nameRules'
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
    expect(rule('Side Plates')).toBe('plate')
    expect(material('Side Plates')).toBe('aluminum6061')
  })

  it('규칙 이름은 맞은 낱말열이다(규칙의 첫 낱말이 아니라)', () => {
    expect(rule('tires')).toBe('tire')
    expect(rule('PLATE')).toBe('plate')
    expect(rule('Axles')).toBe('axle')
    expect(rule('M4 Bolt')).toBe('bolt')
    expect(rule('Snap Ring')).toBe('snap ring')
    expect(rule('Carbon Fiber Plate')).toBe('carbon fiber')
    // 중심 명사(가장 오른쪽 낱말)의 낱말열이다
    expect(rule('Tire Belt')).toBe('belt')
    expect(nameRuleMaterial('tire')).toBe('rubber')
    expect(nameRuleMaterial('snap ring')).toBe('steel')
  })

  it('재질 이름이 먼저이고, 긴 낱말열이 짧은 것보다 먼저다', () => {
    // 재질 이름이 부품 종류보다 먼저
    expect(material('Aluminum Shaft')).toBe('aluminum6061')
    expect(material('PLA Bracket')).toBe('pla')
    expect(material('Plastic Spacer')).toBe('polycarbonate')
    // carbon steel은 탄소섬유가 아니다
    expect(material('Carbon Steel Pin')).toBe('steel')
    expect(material('Carbon Fiber Plate')).toBe('carbonFiber')
    // servo shaft(알루미늄)가 shaft(강철)보다 먼저
    expect(rule('8mm REX Servo Shaft')).toBe('servo shaft')
    expect(material('8mm REX Servo Shaft')).toBe('aluminum6061')
    expect(material('REX Shaft')).toBe('steel')
    // 세트 스크루 칼라는 set screw collar(강철), 클램핑 칼라는 알루미늄
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

  it('부품 종류 낱말은 중심 명사(가장 오른쪽 낱말)일 때만 맞고, 수식어는 정하지 않는다', () => {
    // 중심 명사가 규칙에 없으면 앞의 수식어(nut·chain·roller·bearing·shaft·belt)로 정하지 않는다
    for (const name of [
      'Nut Strip',
      'Chain Guard',
      'RollerCore',
      'Roller Arm',
      'Intake Roller Arm',
      'Bearing Housing',
      'Shaft Support',
      'Belt Tensioner',
      'Belt Guard'
    ])
      expect(rule(name), name).toBeNull()
    // 뒤에 붙은 치수·번호·판·자리 낱말은 건너뛰고 그 앞이 중심 명사다
    expect(rule('Shaft 8mm')).toBe('shaft')
    expect(rule('Bracket (1)')).toBe('bracket')
    expect(rule('Plate v2')).toBe('plate')
    expect(rule('Side Plate Left')).toBe('plate')
    expect(rule('Gusset Plate B')).toBe('plate')
  })

  it('가정한 일반 낱말(mount·block·hub)은 규칙이 아니다(로봇 기본 재질을 따른다)', () => {
    for (const name of [
      'Camera Mount',
      'Motor Mount',
      'Battery Mount',
      'Bearing Block',
      'Sensor Block',
      'Servo Hub',
      'Tire Hub'
    ])
      expect(rule(name), name).toBeNull()
    // 출처가 있는 긴 낱말열은 그대로다
    expect(material('Control Hub')).toBe('polycarbonate')
  })

  it('어셈블리 이름(상위 노드)은 재질 낱말·라벨·SKU 시리즈만 보고 부품 종류 낱말은 보지 않는다', () => {
    const ancestor = (name: string): string | null => matchAncestorRule(name)?.name ?? null
    for (const name of ['Roller Intake', 'Chain Lift', 'Belt Drive', 'Shaft Assy', 'Screw Kit'])
      expect(ancestor(name), name).toBeNull()
    expect(ancestor('Steel Frame')).toBe('steel')
    expect(matchAncestorRule('Labels')).toEqual({ name: 'label', material: null })
    expect(ancestor('1611-0514-0006')).toBe('gobilda-1611')
    // 재질 낱말은 SKU 시리즈보다 먼저다(이름 하나의 규칙과 같은 순서)
    expect(matchAncestorRule('1120-0001-0048 PLA')?.material).toBe('pla')
  })

  it('부품 종류 낱말이 여럿이면 가장 오른쪽 낱말(영어 이름의 중심 명사)의 규칙이다', () => {
    // 수식어(bearing·shaft·belt·roller)보다 뒤의 부품 종류가 재질을 정한다
    expect(rule('Bearing Plate')).toBe('plate')
    expect(material('Bearing Plate')).toBe('aluminum6061')
    expect(rule('Shaft Collar')).toBe('collar')
    expect(material('Shaft Collar')).toBe('aluminum6061')
    expect(rule('Belt Pulley')).toBe('pulley')
    expect(material('Belt Pulley')).toBe('aluminum6061')
    expect(rule('Roller Bracket')).toBe('bracket')
    expect(rule('Shaft Spacer')).toBe('spacer')
    expect(rule('Axle Plate')).toBe('plate')
    // 뒤에 치수 낱말이 와도 그 앞의 중심 명사다
    expect(rule('Screw M4x10')).toBe('screw')
    expect(rule('Bearing 8mm ID')).toBe('bearing')
    // 같은 자리에서 끝나는 낱말열은 긴 것이 먼저다(set screw collar는 강철, pinion gear는 강철)
    expect(material('Set Screw Collar')).toBe('steel')
    expect(material('Pinion Gear')).toBe('steel')
    expect(material('Control Hub')).toBe('polycarbonate')
    // 재질 이름은 자리와 관계없이 먼저다
    expect(material('Steel Bearing Plate')).toBe('steel')
    expect(material('Plate Aluminum')).toBe('aluminum6061')
    expect(material('Plastic Belt Pulley')).toBe('polycarbonate')
    expect(material('Bracket Label')).toBeNull()
  })

  it('라벨은 질량 0(재질 null)이다', () => {
    expect(material('5203-2402-0019 Label')).toBeNull()
    expect(material('Top Sticker')).toBeNull()
  })

  it('오인하기 쉬운 짧은 낱말은 쓰지 않는다(키트 이름의 치수 약어 OR·IR·OD·ID 등)', () => {
    for (const name of ['OR', 'IR', 'OD', 'ID', 'PC', 'SS', 'CF', 'Ply', 'Alu', 'POM', 'EVA'])
      expect(rule(name)).toBeNull()
    expect(rule('Pin')).toBe('pin')
    expect(rule('Lock Nut')).toBe('nut')
  })

  it('낱말이 없으면 goBILDA SKU 시리즈로 재질을 정한다(바퀴·롤러는 고무, COTS 시리즈는 없음)', () => {
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

  it('낱말열은 규칙 사이에 겹치지 않고 재질은 재질 목록에 있다', () => {
    const phrases = WORD_RULES.flatMap((wordRule) => wordRule.phrases)
    expect(new Set(phrases).size).toBe(phrases.length)
    for (const wordRule of WORD_RULES) {
      if (wordRule.material !== null) expect(MATERIAL_KEYS).toContain(wordRule.material)
      for (const phrase of wordRule.phrases) {
        expect(nameRuleMaterial(phrase)).toBe(wordRule.material)
        // 규칙 낱말열 그대로인 이름은 그 낱말열로 맞는다(앞 규칙이 가로채지 않는다)
        expect(matchNameRule([phrase])?.name, phrase).toBe(phrase)
      }
    }
    expect(nameRuleMaterial('gobilda-2800')).toBe('steel')
    expect(nameRuleMaterial('nope')).toBeUndefined()
  })
})
