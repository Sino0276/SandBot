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

// 질량 표시·입력. 내부 값은 kg이고, 개인 설정을 따로 늘리지 않고 길이 표시 단위를 따른다:
// mm·cm·m는 1 kg 미만이면 g(정수), 그 위는 kg(소수 셋). in은 lb(소수 둘), 0.1 lb 미만이면 oz(소수 하나).
export type MassSymbol = 'g' | 'kg' | 'lb' | 'oz'

// 1 lb = 0.45359237 kg, 1 oz = 1/16 lb(국제 야드·파운드 정의)
export const KG_PER_LB = 0.45359237
export const KG_PER_OZ = KG_PER_LB / 16

// 표시할 수와 기호 키(기호 글자는 길이 기호 units.symbols처럼 i18n 리소스에서 가져오도록 키만 준다)
export function massDisplay(kg: number, unit: LengthUnit): { value: string; symbol: MassSymbol } {
  if (unit === 'in') {
    const lb = kg / KG_PER_LB
    // 반올림해 0.10 lb가 되는 값은 lb로, 0은 0.00 lb로 보인다
    if (lb !== 0 && Math.abs(Number(lb.toFixed(2))) < 0.1)
      return { value: formatNumber(kg / KG_PER_OZ, 1), symbol: 'oz' }
    return { value: formatNumber(lb, 2), symbol: 'lb' }
  }
  const grams = Math.round(kg * 1000)
  // 999.6 g처럼 반올림하면 1000 g이 되는 값도 kg로 보인다
  if (Math.abs(grams) < 1000) return { value: formatNumber(grams, 0), symbol: 'g' }
  return { value: formatNumber(kg, 3), symbol: 'kg' }
}

// 기호 글자의 기본값: 국제 단위 기호(SI의 g·kg, 국제 야드·파운드의 lb·oz)라 한국어·영어 표기가 같다. 길이 기호처럼
// i18n 리소스(units.massSymbols)에 기호를 두면 쓰는 쪽이 그것을 symbols로 넘긴다. 기본값은 갈래 사이 계약의
// formatMass(kg, unit) 호출을 그대로 받기 위한 것이다.
export const MASS_SYMBOLS: Readonly<Record<MassSymbol, string>> = {
  g: 'g',
  kg: 'kg',
  lb: 'lb',
  oz: 'oz'
}

// "437 g"처럼 수와 기호를 붙인다
export function formatMass(
  kg: number,
  unit: LengthUnit,
  symbols: Readonly<Record<MassSymbol, string>> = MASS_SYMBOLS
): string {
  const { value, symbol } = massDisplay(kg, unit)
  return `${value} ${symbols[symbol]}`
}

// 입력칸에서 받는 질량 단위(대소문자 무시) → kg
const MASS_SUFFIXES: Record<string, number> = {
  g: 0.001,
  gram: 0.001,
  grams: 0.001,
  kg: 1,
  kgs: 1,
  lb: KG_PER_LB,
  lbs: KG_PER_LB,
  pound: KG_PER_LB,
  pounds: KG_PER_LB,
  oz: KG_PER_OZ,
  ounce: KG_PER_OZ,
  ounces: KG_PER_OZ
}

// "437g", "1.2 kg", "3lb", "8 oz" → kg. 단위가 없으면 표시 단위의 큰 단위로 읽는다(mm·cm·m는 kg, in은 lb).
// 읽을 수 없으면 null. 범위(0 초과 등)는 쓰는 쪽이 본다.
export function parseMass(text: string, unit: LengthUnit): number | null {
  return parseWithSuffix(text, MASS_SUFFIXES, unit === 'in' ? KG_PER_LB : 1)
}
