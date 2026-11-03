import { describe, expect, it } from 'vitest'
import type { HardwareComponent } from '../scene/model'
import { defaultWheel } from '../scene/wheel'
import {
  componentCotsKey,
  COTS_ENTRIES,
  cotsEntry,
  pinpointPodCotsKey,
  skuCotsKey,
  wheelCotsKey
} from './cotsTable'

const component = (
  type: string,
  props: Record<string, string | number> = {}
): HardwareComponent => ({ id: 'c', type, name: 'c', hub: 'controlHub', port: 0, props })
const motor = (motorModel: string, gearbox = 0): HardwareComponent =>
  component('motor', { motorModel, gearbox })
// 표 키의 질량(g, 소수 첫째 자리)
const grams = (key: string | null): number | null =>
  key === null ? null : Math.round((cotsEntry(key)?.mass ?? NaN) * 10000) / 10

describe('COTS 질량 표', () => {
  it('모든 항목이 유한한 양의 질량과 제품명을 갖는다', () => {
    for (const [key, entry] of Object.entries(COTS_ENTRIES)) {
      expect(entry.mass, key).toBeGreaterThan(0)
      expect(entry.mass, key).toBeLessThan(1)
      expect(entry.product.length, key).toBeGreaterThan(0)
    }
    expect(cotsEntry('nope')).toBeUndefined()
    expect(cotsEntry('toString')).toBeUndefined()
  })

  it('goBILDA 모터는 5203 열의 가장 가까운 감속비(기본 0은 SDK 감속비 99.5:1)', () => {
    expect(componentCotsKey(motor('goBilda5202', 19.2))).toBe('motor:goBilda5203:19.2')
    expect(grams(componentCotsKey(motor('goBilda5202', 19.2)))).toBe(437)
    expect(grams(componentCotsKey(motor('goBilda5202')))).toBe(486)
    expect(cotsEntry(componentCotsKey(motor('goBilda5202'))!)?.ratio).toBe(99.5)
    // 표에 없는 감속비는 로그 거리로 가장 가까운 것
    expect(componentCotsKey(motor('goBilda5202', 20))).toBe('motor:goBilda5203:19.2')
    expect(componentCotsKey(motor('goBilda5202', 1))).toBe('motor:goBilda5203:1')
    expect(componentCotsKey(motor('goBilda5202', 500))).toBe('motor:goBilda5203:188')
    expect(grams(componentCotsKey(motor('goBilda5202', 188)))).toBe(524)
  })

  it('REV 모터: HD Hex 스퍼 350 g·맨 모터 234 g, UltraPlanetary는 카트리지 수, Core Hex 7 oz', () => {
    expect(grams(componentCotsKey(motor('revHdHex20')))).toBe(350)
    expect(grams(componentCotsKey(motor('revHdHex40')))).toBe(350)
    expect(grams(componentCotsKey(motor('revHdHex20', 1)))).toBe(234)
    // 기본(SDK 20:1) → 카트리지 2개: 334 + 70 g(REV 표 405 g)
    expect(componentCotsKey(motor('revUltraPlanetary'))).toBe('motor:revUltraPlanetary:2')
    expect(grams(componentCotsKey(motor('revUltraPlanetary')))).toBe(404)
    expect(componentCotsKey(motor('revUltraPlanetary', 5.23))).toBe('motor:revUltraPlanetary:1')
    expect(componentCotsKey(motor('revUltraPlanetary', 2.89))).toBe('motor:revUltraPlanetary:1')
    expect(componentCotsKey(motor('revUltraPlanetary', 27))).toBe('motor:revUltraPlanetary:2')
    expect(componentCotsKey(motor('revUltraPlanetary', 54.8))).toBe('motor:revUltraPlanetary:3')
    expect(componentCotsKey(motor('revUltraPlanetary', 500))).toBe('motor:revUltraPlanetary:3')
    expect(grams(componentCotsKey(motor('revCoreHex')))).toBe(198.4)
    expect(grams(componentCotsKey(motor('neverest40')))).toBe(347.9)
  })

  it('질량을 찾지 못한 모델과 종류는 표에 없다(재질 추정으로 간다)', () => {
    for (const model of [
      'goBilda5201',
      'neverest20',
      'neverest60',
      'tetrix',
      'matrix12v',
      'studicaMaverick',
      'unspecified',
      'nope'
    ])
      expect(componentCotsKey(motor(model))).toBeNull()
    for (const type of ['otos', 'colorSensor', 'distanceSensor', 'webcam', 'imu', 'deadWheel'])
      expect(componentCotsKey(component(type))).toBeNull()
  })

  it('서보는 모델 속성이 없어 goBILDA 2000 Torque 60 g, Pinpoint 40 g, 포드, Limelight 93 g', () => {
    expect(grams(componentCotsKey(component('servo')))).toBe(60)
    expect(grams(componentCotsKey(component('crServo')))).toBe(60)
    expect(grams(componentCotsKey(component('pinpoint')))).toBe(40)
    expect(grams(componentCotsKey(component('limelight')))).toBe(93)
    expect(grams(pinpointPodCotsKey('fourBar'))).toBe(84)
    expect(grams(pinpointPodCotsKey('swingarm'))).toBe(121)
    expect(grams(pinpointPodCotsKey(undefined))).toBe(84)
  })

  it('메카넘 바퀴는 104 mm·96 mm ±1.5 mm만 맞는다', () => {
    expect(grams(wheelCotsKey(defaultWheel()))).toBe(236)
    expect(wheelCotsKey({ ...defaultWheel(), diameter: 0.1055 })).toBe('wheel:gripForce104')
    expect(wheelCotsKey({ ...defaultWheel(), diameter: 0.1025 })).toBe('wheel:gripForce104')
    expect(wheelCotsKey({ ...defaultWheel(), diameter: 0.106 })).toBeNull()
    expect(grams(wheelCotsKey({ ...defaultWheel(), diameter: 0.096 }))).toBe(207)
    expect(wheelCotsKey({ ...defaultWheel(), diameter: 0.1 })).toBeNull()
    expect(wheelCotsKey(defaultWheel('omni'))).toBeNull()
    expect(wheelCotsKey(defaultWheel('traction'))).toBeNull()
  })

  it('SKU로 찾는다(goBILDA 모터는 시리즈·축·감속비 코드)', () => {
    expect(grams(skuCotsKey('5203-2402-0019'))).toBe(437)
    expect(grams(skuCotsKey('5203-2402-0051'))).toBe(481)
    expect(grams(skuCotsKey('5204-8002-0019'))).toBe(458)
    expect(skuCotsKey('5204-8002-0001')).toBeNull()
    expect(grams(skuCotsKey('5202-0002-0019'))).toBe(420)
    expect(grams(skuCotsKey('5202-2402-0019'))).toBe(435)
    expect(grams(skuCotsKey('5202-0002-0001'))).toBe(383)
    expect(skuCotsKey('5203-2402-0099')).toBeNull()
    // 키트 STEP의 낱개 바퀴(좌우)
    expect(grams(skuCotsKey('3625-0100-0104'))).toBe(236)
    expect(grams(skuCotsKey('3625-0001-0104'))).toBe(236)
    expect(grams(skuCotsKey('3606-0100-0096 assembly'))).toBe(207)
    expect(grams(skuCotsKey('3100-0012-0020 part'))).toBe(597)
    expect(grams(skuCotsKey('3110-0002-0002'))).toBe(40)
    expect(grams(skuCotsKey('3110-0001-0001'))).toBe(121)
    expect(grams(skuCotsKey('3110-0001-0002 (0°)'))).toBe(84)
    expect(grams(skuCotsKey('3122-0002-0001'))).toBe(93)
    expect(grams(skuCotsKey('2000-0025-0003'))).toBe(58)
    expect(grams(skuCotsKey('2000-0025-0502'))).toBe(64)
    expect(grams(skuCotsKey('2004-0025-0002'))).toBe(78)
    // REV는 대소문자 무시, 뒤에 붙은 접미사를 견딘다
    expect(grams(skuCotsKey('REV-41-3334_RevB_UNLINKED'))).toBe(62)
    expect(grams(skuCotsKey('rev-31-1302'))).toBe(567)
    expect(grams(skuCotsKey('REV-41-1300'))).toBe(198.4)
    expect(grams(skuCotsKey('REV-31-1595 Control Hub'))).toBe(209)
    // 표에 없는 SKU·숫자가 이어진 것
    expect(skuCotsKey('1120-0015-0384')).toBeNull()
    expect(skuCotsKey('13100-0012-0020')).toBeNull()
    expect(skuCotsKey('XREV-41-1300')).toBeNull()
    expect(skuCotsKey('Bracket')).toBeNull()
    // 제품 STEP 안의 낱개 부품 이름("<SKU>-V1.0 …")은 그 제품이 아니다(실제 goBILDA 포드·Pinpoint STEP의 이름)
    expect(skuCotsKey('3110-0001-0002-V1.0 main body v2')).toBeNull()
    expect(skuCotsKey('3110-0001-0001-V1.1 Magnet v1')).toBeNull()
    expect(skuCotsKey('3110-0001-0001-PSYCHO')).toBeNull()
    expect(skuCotsKey('3110-0002-0001-V1.0 PCB')).toBeNull()
    // 뒤에 공백·괄호·밑줄이 오거나 '-' 뒤에 글자가 없으면 그대로 SKU다
    expect(grams(skuCotsKey('3110-0001-0002_step'))).toBe(84)
    expect(grams(skuCotsKey('3110-0001-0002 - pod'))).toBe(84)
  })
})
