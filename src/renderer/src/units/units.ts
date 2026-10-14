// 표시·입력 단위. 내부 값(씬 파일·씬 그래프)은 항상 미터·라디안이고, 변환은 UI 경계에서만 한다(CLAUDE.md 단위 규약).

export const LENGTH_UNITS = ['mm', 'cm', 'm', 'in'] as const
export type LengthUnit = (typeof LENGTH_UNITS)[number]

export const METERS_PER_UNIT: Record<LengthUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254
}

// 표시 소수 자릿수(대략 0.1 mm 정밀도)
export const LENGTH_DIGITS: Record<LengthUnit, number> = { mm: 1, cm: 2, m: 4, in: 3 }

export const ANGLE_DIGITS = 1
const DEG = Math.PI / 180

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === 'string' && (LENGTH_UNITS as readonly string[]).includes(value)
}

export function toDisplayLength(meters: number, unit: LengthUnit): number {
  return meters / METERS_PER_UNIT[unit]
}

export function fromDisplayLength(value: number, unit: LengthUnit): number {
  return value * METERS_PER_UNIT[unit]
}

// 입력칸에서 받는 단위 표기(대소문자 무시). 표시 단위에 없는 ft도 받는다.
const LENGTH_SUFFIXES: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  inch: 0.0254,
  inches: 0.0254,
  '"': 0.0254,
  '″': 0.0254,
  ft: 0.3048,
  feet: 0.3048,
  foot: 0.3048,
  "'": 0.3048,
  '′': 0.3048
}

const ANGLE_SUFFIXES: Record<string, number> = {
  '°': DEG,
  deg: DEG,
  rad: 1
}

const NUMBER_WITH_SUFFIX = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([^\d\s.+-][^\s]*)?$/i

function parseWithSuffix(
  text: string,
  suffixes: Record<string, number>,
  defaultScale: number
): number | null {
  const match = NUMBER_WITH_SUFFIX.exec(text.trim())
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  if (!match[2]) return value * defaultScale
  const scale = suffixes[match[2].toLowerCase()]
  return scale === undefined ? null : value * scale
}

// "12in", "30 cm", "0.5m", "6\"", "-1.5"(표시 단위) → 미터. 읽을 수 없으면 null.
export function parseLength(text: string, displayUnit: LengthUnit): number | null {
  return parseWithSuffix(text, LENGTH_SUFFIXES, METERS_PER_UNIT[displayUnit])
}

// "30", "30°", "30deg", "0.5rad" → 라디안. 단위가 없으면 도(°)로 본다.
export function parseAngle(text: string): number | null {
  return parseWithSuffix(text, ANGLE_SUFFIXES, DEG)
}

// 반올림한 값. -0.0 대신 0.0으로 보이게 한다.
export function formatNumber(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits))
  return (rounded === 0 ? 0 : rounded).toFixed(digits)
}

export function formatLength(meters: number, unit: LengthUnit): string {
  return formatNumber(toDisplayLength(meters, unit), LENGTH_DIGITS[unit])
}

const STORAGE_KEY = 'sandbot:lengthUnit'

// 개인 앱 설정(프로젝트 파일에는 넣지 않는다). 아직 고르지 않았으면 null.
export function loadLengthUnit(storage: Pick<Storage, 'getItem'>): LengthUnit | null {
  const saved = storage.getItem(STORAGE_KEY)
  return isLengthUnit(saved) ? saved : null
}

export function saveLengthUnit(storage: Pick<Storage, 'setItem'>, unit: LengthUnit): void {
  storage.setItem(STORAGE_KEY, unit)
}
