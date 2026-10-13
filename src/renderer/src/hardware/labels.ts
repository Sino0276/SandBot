import type { TFunction } from 'i18next'
import type { ComponentType } from './catalog'

// 카탈로그에서 오는 번역 키(속성·선택지 이름)는 문자열이라 t()의 키 타입 검사를 받지 못한다.
// 대신 labels.test.ts가 카탈로그의 모든 키가 ko·en에 있는지 확인한다.
type LooseT = (key: string, options?: Record<string, unknown>) => string
export const looseT = (t: TFunction): LooseT => t as unknown as LooseT

// 같은 선택지를 쓰는 속성은 번역 묶음 하나를 같이 쓴다(hardware.options.*)
const OPTION_GROUPS: Record<string, string> = {
  logoFacing: 'hubDirection',
  usbFacing: 'hubDirection',
  xDirection: 'encoderDirection',
  yDirection: 'encoderDirection'
}

export function optionLabelKey(propertyKey: string, option: string): string {
  return `hardware.options.${OPTION_GROUPS[propertyKey] ?? propertyKey}.${option}`
}

export function propertyLabelKey(propertyKey: string): string {
  return `hardware.props.${propertyKey}`
}

// 설명(hardware.hints.*)과 계산값(hardware.derived.*)이 있는 종류
export const HINT_TYPES = [
  'imu',
  'webcam',
  'limelight',
  'pinpoint',
  'otos',
  'deadWheel'
] as const satisfies readonly ComponentType[]
export type HintType = (typeof HINT_TYPES)[number]

export function hasHint(type: string): type is HintType {
  return (HINT_TYPES as readonly string[]).includes(type)
}
