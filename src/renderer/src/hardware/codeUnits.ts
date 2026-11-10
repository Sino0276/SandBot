import type { CodeUnits } from '../scene/projectSettings'
import { INCH_PER_METER, MM_PER_METER } from './mounting'

// 생성 Java 상수의 단위(프로젝트 설정 codeUnits). 상수 이름 꼬리·리터럴 자릿수·SDK enum을 여기 한곳에서 정하고
// 코드 생성(javaCodegen)·상수 이름(naming.generatedConstantNames)·인스펙터 계산값 줄이 같이 쓴다.
// 'sdk'는 장치마다 그 SDK API가 받는 단위다(코드 단위 설정 전과 바이트 단위로 같은 출력).

export type LengthCodeUnit = 'mm' | 'cm' | 'm' | 'in'
export type AngleCodeUnit = 'deg' | 'rad'

type LengthInfo = {
  suffix: string
  perMeter: number
  digits: number
  // org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit 상수
  distanceUnit: string
}

// 자릿수: mm 2·in 3은 코드 단위 전과 같다. cm·m는 mm 2자리와 같은 0.01 mm 분해능이다.
export const LENGTH_CODE_UNITS: Record<LengthCodeUnit, LengthInfo> = {
  mm: { suffix: 'MM', perMeter: MM_PER_METER, digits: 2, distanceUnit: 'MM' },
  cm: { suffix: 'CM', perMeter: 100, digits: 3, distanceUnit: 'CM' },
  m: { suffix: 'M', perMeter: 1, digits: 5, distanceUnit: 'METER' },
  in: { suffix: 'IN', perMeter: INCH_PER_METER, digits: 3, distanceUnit: 'INCH' }
}

type AngleInfo = {
  suffix: string
  // 도 → 이 단위
  perDegree: number
  digits: number
  // org.firstinspires.ftc.robotcore.external.navigation.AngleUnit 상수
  angleUnit: string
}

// 자릿수: ° 2는 코드 단위 전과 같다. rad 5는 0.01°(1.7e-4 rad)보다 촘촘하다.
export const ANGLE_CODE_UNITS: Record<AngleCodeUnit, AngleInfo> = {
  deg: { suffix: 'DEG', perDegree: 1, digits: 2, angleUnit: 'DEGREES' },
  rad: { suffix: 'RAD', perDegree: Math.PI / 180, digits: 5, angleUnit: 'RADIANS' }
}

// 장치 API가 받는 단위('sdk'일 때 쓰는 단위)
const SDK_LENGTH: Record<string, LengthCodeUnit> = { pinpoint: 'mm', otos: 'in' }
const SDK_ANGLE: Record<string, AngleCodeUnit> = { otos: 'deg' }

// 장치의 길이 상수 단위. 데드휠은 SDK API가 없어 'sdk'면 mm와 in을 함께 낸다(코드 단위 전 출력).
export function deviceLengthUnits(type: string, units: CodeUnits): LengthCodeUnit[] {
  if (units.length !== 'sdk') return [units.length]
  if (type === 'deadWheel') return ['mm', 'in']
  const sdk = SDK_LENGTH[type]
  return sdk ? [sdk] : []
}

export function deviceAngleUnit(type: string, units: CodeUnits): AngleCodeUnit {
  return units.angle === 'sdk' ? (SDK_ANGLE[type] ?? 'deg') : units.angle
}

// 장치 하나가 생성 코드에 만드는 상수의 이름 꼬리(상수 이름 = constantName(필드) + 꼬리). 생성 순서와 같다.
// 검증이 로봇 안의 상수 이름 충돌을 찾고 사용처가 상수를 찾는 데도 쓴다.
export function constantSuffixes(type: string, units: CodeUnits): string[] {
  switch (type) {
    case 'pinpoint': {
      const u = LENGTH_CODE_UNITS[deviceLengthUnits(type, units)[0]].suffix
      return [`_X_OFFSET_${u}`, `_Y_OFFSET_${u}`]
    }
    case 'otos': {
      const u = LENGTH_CODE_UNITS[deviceLengthUnits(type, units)[0]].suffix
      const a = ANGLE_CODE_UNITS[deviceAngleUnit(type, units)].suffix
      return [`_OFFSET_X_${u}`, `_OFFSET_Y_${u}`, `_OFFSET_H_${a}`]
    }
    case 'deadWheel': {
      // 'sdk'는 _X_MM, _Y_MM, _X_IN, _Y_IN 순서다(코드 단위 전 출력)
      const pairs = deviceLengthUnits(type, units).flatMap((unit) => {
        const u = LENGTH_CODE_UNITS[unit].suffix
        return [`_X_${u}`, `_Y_${u}`]
      })
      return [...pairs, '_MEASURES_FORWARD', '_REVERSED']
    }
    default:
      return []
  }
}

// Java double 리터럴: 반올림 후 끝의 0을 지우되 소수점은 남긴다(12 → 12.0)
export function javaDouble(value: number, digits: number): string {
  const fixed = (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '.0') : `${fixed}.0`
  return trimmed === '-0.0' ? '0.0' : trimmed
}

// 미터 → 그 단위의 생성 리터럴(인스펙터 계산값 줄도 같은 글자를 보인다)
export function lengthLiteral(meters: number, unit: LengthCodeUnit): string {
  const info = LENGTH_CODE_UNITS[unit]
  return javaDouble(meters * info.perMeter, info.digits)
}

// 도 → 그 단위의 생성 리터럴
export function angleLiteral(degrees: number, unit: AngleCodeUnit): string {
  const info = ANGLE_CODE_UNITS[unit]
  return javaDouble(degrees * info.perDegree, info.digits)
}
