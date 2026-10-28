import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  COMPONENT_TYPES,
  deadWheelTicksPerMeter,
  isPropertyVisible,
  MOTOR_MODEL_SDK,
  MOTOR_MODEL_TAGS,
  motorGearbox,
  motorOutput,
  pinpointPodTicksPerMm,
  propertyDefaults,
  type MotorModel,
  type PropertyDef
} from './catalog'

// 사이드카의 모터 형식 표(SDK 애너테이션 값을 옮긴 것). 카탈로그의 SDK 값이 이와 같아야 한다.
const MOTOR_TYPES_JAVA = resolve(
  __dirname,
  '../../../../sidecar/sdk/com/qualcomm/robotcore/hardware/configuration/typecontainers/MotorConfigurationType.java'
)

describe('모터 형식 값(시뮬레이터)', () => {
  it('사이드카 MotorConfigurationType 표(SDK @MotorType)와 같다', () => {
    const source = readFileSync(MOTOR_TYPES_JAVA, 'utf8')
    // builtIn("클래스", "태그", "이름", ticksPerRev, gearing, maxRPM, Rotation.…
    const table = new Map<string, { ticksPerRev: number; gearing: number; maxRPM: number }>()
    for (const match of source.matchAll(
      /builtIn\([^,]+,\s*"([^"]+)",\s*"[^"]*",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*Rotation/g
    )) {
      table.set(match[1], {
        ticksPerRev: Number(match[2]),
        gearing: Number(match[3]),
        maxRPM: Number(match[4])
      })
    }
    expect(table.size).toBeGreaterThan(10)
    for (const model of Object.keys(MOTOR_MODEL_TAGS) as MotorModel[]) {
      expect(table.get(MOTOR_MODEL_TAGS[model]), model).toEqual(MOTOR_MODEL_SDK[model])
    }
  })

  it('감속비 0은 모델 기본(SDK gearing), 그 밖의 값은 그대로', () => {
    expect(propertyDefaults('motor').gearbox).toBe(0)
    expect(motorGearbox({ motorModel: 'goBilda5202', gearbox: 0 })).toBe(99.5)
    expect(motorGearbox({ motorModel: 'revUltraPlanetary', gearbox: 0 })).toBe(20)
    expect(motorGearbox({ motorModel: 'goBilda5202', gearbox: 19.2 })).toBe(19.2)
    // 세계 설명이 받지 않는 아주 작은 값·모르는 모델
    expect(motorGearbox({ motorModel: 'goBilda5202', gearbox: 0.001 })).toBe(99.5)
    expect(motorGearbox({ motorModel: 'mystery', gearbox: 0 })).toBe(52)
  })

  it('goBILDA 5203 312 RPM(19.2:1): 출력축 무부하 RPM과 1회전 틱', () => {
    const output = motorOutput({ motorModel: 'goBilda5202', gearbox: 19.2 })
    expect(output.freeRpm).toBeCloseTo((60 * 99.5) / 19.2, 10)
    expect(output.freeRpm).toBeCloseTo(310.94, 2)
    // goBILDA가 적는 537.7(28 × 19.2 = 537.6)
    expect(output.ticksPerRev).toBeCloseTo(537.6, 6)
    // 모델 기본(99.5:1, 60 RPM)은 SDK 값 그대로
    expect(motorOutput({ motorModel: 'goBilda5202', gearbox: 0 })).toEqual({
      gearbox: 99.5,
      freeRpm: 60,
      ticksPerRev: 2786
    })
  })
})

describe('오도메트리 포드 해상도(시뮬레이터)', () => {
  it('데드휠 podType: goBILDA 포드, REV Through Bore(8192 CPR), 직접 입력', () => {
    expect(propertyDefaults('deadWheel')).toMatchObject({
      podType: 'fourBar',
      podDiameter: 0.035,
      podCpr: 8192
    })
    expect(deadWheelTicksPerMeter({ podType: 'fourBar' })).toBeCloseTo(19894.36789, 6)
    // 4-Bar 포드: 32 mm 바퀴에 2000 CPR
    expect(deadWheelTicksPerMeter({ podType: 'fourBar' })).toBeCloseTo(2000 / (Math.PI * 0.032), 3)
    expect(deadWheelTicksPerMeter({ podType: 'swingarm' })).toBeCloseTo(2000 / (Math.PI * 0.048), 3)
    expect(deadWheelTicksPerMeter({ podType: 'revThroughBore', podDiameter: 0.048 })).toBeCloseTo(
      8192 / (Math.PI * 0.048),
      6
    )
    // REV Through Bore는 CPR 칸을 쓰지 않는다
    expect(
      deadWheelTicksPerMeter({ podType: 'revThroughBore', podDiameter: 0.035, podCpr: 2000 })
    ).toBeCloseTo(8192 / (Math.PI * 0.035), 6)
    expect(
      deadWheelTicksPerMeter({ podType: 'custom', podDiameter: 0.06, podCpr: 4000 })
    ).toBeCloseTo(4000 / (Math.PI * 0.06), 6)
    // 범위 밖은 기본값
    expect(deadWheelTicksPerMeter({ podType: 'custom', podDiameter: 0, podCpr: -1 })).toBeCloseTo(
      8192 / (Math.PI * 0.035),
      6
    )
  })

  it('Pinpoint podType은 SDK setEncoderResolution의 틱/mm', () => {
    expect(pinpointPodTicksPerMm({ podType: 'fourBar' })).toBe(19.89436789)
    expect(pinpointPodTicksPerMm({ podType: 'swingarm' })).toBe(13.26291192)
  })

  it('지름은 REV Through Bore·직접 입력일 때만, CPR은 직접 입력일 때만 보인다', () => {
    const properties: readonly PropertyDef[] = COMPONENT_TYPES.deadWheel.properties
    const visible = (podType: string): string[] =>
      properties
        .filter((property) => property.key.startsWith('pod'))
        .filter((property) =>
          isPropertyVisible(property, { ...propertyDefaults('deadWheel'), podType })
        )
        .map((property) => property.key)
    expect(visible('fourBar')).toEqual(['podType'])
    expect(visible('swingarm')).toEqual(['podType'])
    expect(visible('revThroughBore')).toEqual(['podType', 'podDiameter'])
    expect(visible('custom')).toEqual(['podType', 'podDiameter', 'podCpr'])
  })
})
