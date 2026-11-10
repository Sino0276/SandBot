// 프로젝트(팀) 설정(Unity Project Settings). 씬 문서의 일부라 project.json(v12 settings)·실행 취소·dirty에 들어간다.
// 개인 설정(표시 단위·언어 등)과 달리 같은 프로젝트를 여는 팀원 모두에게 같다. 지금은 생성 Java의 코드 단위뿐이다.

// 생성 Java 상수의 길이 단위. 'sdk'는 장치마다 그 SDK API가 받는 단위(Pinpoint mm, OTOS in, 데드휠 mm와 in 둘 다)이고
// 코드 단위 설정이 생기기 전의 출력과 바이트 단위로 같다.
export const CODE_LENGTH_UNITS = ['sdk', 'mm', 'cm', 'm', 'in'] as const
export type CodeLengthUnit = (typeof CODE_LENGTH_UNITS)[number]

// 생성 Java 상수의 각도 단위. 'sdk'는 장치 API가 받는 단위(OTOS °)다.
export const CODE_ANGLE_UNITS = ['sdk', 'deg', 'rad'] as const
export type CodeAngleUnit = (typeof CODE_ANGLE_UNITS)[number]

export type CodeUnits = { length: CodeLengthUnit; angle: CodeAngleUnit }

export type ProjectSettings = { codeUnits: CodeUnits }

export const DEFAULT_CODE_UNITS: CodeUnits = Object.freeze({ length: 'sdk', angle: 'sdk' })

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = Object.freeze({
  codeUnits: DEFAULT_CODE_UNITS
})

export function isCodeUnits(value: unknown): value is CodeUnits {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    (CODE_LENGTH_UNITS as readonly unknown[]).includes(v.length) &&
    (CODE_ANGLE_UNITS as readonly unknown[]).includes(v.angle)
  )
}

export function sameCodeUnits(a: CodeUnits, b: CodeUnits): boolean {
  return a.length === b.length && a.angle === b.angle
}

export function sameProjectSettings(a: ProjectSettings, b: ProjectSettings): boolean {
  return sameCodeUnits(a.codeUnits, b.codeUnits)
}

// 캐시 키(codeScopes·usageSymbols)
export function codeUnitsKey(units: CodeUnits): string {
  return `${units.length}|${units.angle}`
}
