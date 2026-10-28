import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACHIEVEABLE_MAX_RPM_FRACTION,
  hubMaxTicksPerSecond,
  MOTOR_TYPES,
  motorType,
  noLoadOutputRadPerSec,
  rotationSign,
  ticksPerOutputRev
} from './motorTypes'

const JAVA = join(
  __dirname,
  '../../../sidecar/sdk/com/qualcomm/robotcore/hardware/configuration/typecontainers/MotorConfigurationType.java'
)

// builtIn("클래스", "태그", "이름", ticksPerRev, gearing, maxRPM, Rotation.CW|CCW, ...)
function javaTable(): Record<string, [number, number, number, string]> {
  const source = readFileSync(JAVA, 'utf8')
  const table: Record<string, [number, number, number, string]> = {}
  const pattern =
    /builtIn\((?:"[^"]+"|UNSPECIFIED_MOTOR_CLASS), "([^"]+)", "[^"]*", ([\d.]+), ([\d.]+), ([\d.]+), Rotation\.(CW|CCW)/g
  for (const m of source.matchAll(pattern))
    table[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4]), m[5]]
  return table
}

describe('모터 형식 표', () => {
  it('사이드카 MotorConfigurationType.java의 표와 같다', () => {
    const java = javaTable()
    expect(Object.keys(java).length).toBeGreaterThanOrEqual(14)
    const ours = Object.fromEntries(
      Object.entries(MOTOR_TYPES).map(([tag, t]) => [
        tag,
        [t.ticksPerRev, t.gearing, t.maxRPM, t.orientation]
      ])
    )
    expect(ours).toEqual(java)
    expect(readFileSync(JAVA, 'utf8')).toContain(
      `achieveableMaxRPMFraction = ${ACHIEVEABLE_MAX_RPM_FRACTION};`
    )
  })

  it('모르는 태그는 Motor(Unspecified), CCW 형식은 회전 부호 −1', () => {
    expect(motorType('FancyMotor')).toBe(MOTOR_TYPES.Motor)
    expect(motorType('toString')).toBe(MOTOR_TYPES.Motor)
    expect(rotationSign(motorType('goBILDA5202SeriesMotor'))).toBe(-1)
    expect(rotationSign(motorType('TetrixMotor'))).toBe(1)
    expect(rotationSign(motorType('RevRoboticsUltraplanetaryHDHexMotor'))).toBe(1)
  })

  it('goBILDA 5203 312 RPM(기어박스 19.2): 출력축 537.6 틱, 무부하 약 311 RPM, 허브 최대 2368 틱/s', () => {
    const type = motorType('goBILDA5202SeriesMotor')
    expect(ticksPerOutputRev(type, 19.2)).toBeCloseTo(537.6, 9)
    expect((noLoadOutputRadPerSec(type, 19.2) * 60) / (2 * Math.PI)).toBeCloseTo(310.9375, 9)
    expect(hubMaxTicksPerSecond(type)).toBe(2368)
    // 형식 기어비 그대로면 SDK의 값
    expect(ticksPerOutputRev(type, 99.5)).toBeCloseTo(2786, 9)
    expect((noLoadOutputRadPerSec(type, 99.5) * 60) / (2 * Math.PI)).toBeCloseTo(60, 9)
    // 사이드카와 같은 반올림(UltraPlanetary: 560 × 300 × 0.85 / 60 = 2380)
    expect(hubMaxTicksPerSecond(motorType('RevRoboticsUltraplanetaryHDHexMotor'))).toBe(2380)
  })
})
