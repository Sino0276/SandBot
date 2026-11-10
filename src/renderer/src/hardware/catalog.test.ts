import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import * as catalog from './catalog'
import {
  AIM_PITCH_LEVEL,
  angleInputValue,
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
import type { JointType } from '../scene/model'

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

  it('모터의 정지 토크·무부하 속도 덮어쓰기는 모든 모터에 보인다(모든 모터가 데이터시트 기어모터로 돈다)', () => {
    const properties: readonly PropertyDef[] = COMPONENT_TYPES.motor.properties
    const visible = properties
      .filter((property) => isPropertyVisible(property, propertyDefaults('motor')))
      .map((property) => property.key)
    expect(visible).toContain('gearbox')
    expect(visible).toContain('stallTorque')
    expect(visible).toContain('freeSpeed')
  })

  it('리밋 스위치는 관절을 연결해야 끝·범위가 보이고, 범위 칸은 관절 형식(직선 길이, 회전 각도)을 따른다', () => {
    const jointTypes: Record<string, JointType> = { lift: 'prismatic', arm: 'revolute' }
    const jointTypeOf = (id: string): JointType | null => jointTypes[id] ?? null
    for (const type of ['touchSensor', 'digitalDevice'] as const) {
      const properties: readonly PropertyDef[] = COMPONENT_TYPES[type].properties.filter(
        (property: PropertyDef) => property.key.startsWith('limit')
      )
      const visible = (limitJoint: string): string[] =>
        properties
          .filter((property) =>
            isPropertyVisible(property, { ...propertyDefaults(type), limitJoint }, jointTypeOf)
          )
          .map((property) => property.key)
      expect(visible('')).toEqual(['limitJoint'])
      // 지운 오브젝트·관절 없는 오브젝트
      expect(visible('gone')).toEqual(['limitJoint'])
      expect(visible('lift')).toEqual(['limitJoint', 'limitAt', 'limitDistance'])
      expect(visible('arm')).toEqual(['limitJoint', 'limitAt', 'limitAngle'])
      // 관절 형식을 모르면(기본 jointTypeOf) 연결 칸만
      expect(
        properties
          .filter((property) =>
            isPropertyVisible(property, { ...propertyDefaults(type), limitJoint: 'lift' })
          )
          .map((property) => property.key)
      ).toEqual(['limitJoint'])
      const kinds = Object.fromEntries(properties.map((p) => [p.key, p.kind]))
      expect(kinds.limitDistance).toBe('length')
      expect(kinds.limitAngle).toBe('angle')
    }
  })
})

// 거리·컬러 센서 조준(4c, spec-4c §1.1 K1·K1a)
describe('센서 조준 속성', () => {
  const DEG = Math.PI / 180
  const aim = (type: 'distanceSensor' | 'colorSensor'): Record<string, PropertyDef> =>
    Object.fromEntries(
      (COMPONENT_TYPES[type].properties as readonly PropertyDef[])
        .filter((property) => property.key.startsWith('aim'))
        .map((property) => [property.key, property])
    )

  it('두 센서에 aimYaw·aimPitch가 시뮬레이터 전용 각도로 있다', () => {
    for (const type of ['distanceSensor', 'colorSensor'] as const) {
      const { aimYaw, aimPitch } = aim(type)
      expect(aimYaw).toMatchObject({
        kind: 'angle',
        default: 0,
        min: -Math.PI,
        max: Math.PI,
        wrap: true,
        hint: true,
        simulation: true
      })
      expect(aimPitch).toMatchObject({
        kind: 'angle',
        min: -Math.PI / 2,
        max: Math.PI / 2,
        hint: true,
        simulation: true
      })
      expect('wrap' in aimPitch).toBe(false)
    }
    expect(aim('distanceSensor').aimPitch.default).toBe(0)
    expect(aim('colorSensor').aimPitch.default).toBe(-Math.PI / 2)
    // 컬러는 생성 코드가 쓰는 gain 뒤에 조준이 온다
    expect(COMPONENT_TYPES.colorSensor.properties.map((property) => property.key)).toEqual([
      'gain',
      'aimYaw',
      'aimPitch'
    ])
    expect(COMPONENT_TYPES.distanceSensor.properties.map((property) => property.key)).toEqual([
      'aimYaw',
      'aimPitch'
    ])
  })

  it('wrap 칸은 (−π, π]로 감고, 아닌 칸은 범위로 자른다', () => {
    const { aimYaw, aimPitch } = aim('distanceSensor')
    const deg = (property: PropertyDef, input: number): number =>
      angleInputValue(property as { min: number; max: number; wrap?: true }, input * DEG) / DEG
    expect(deg(aimYaw, 270)).toBeCloseTo(-90, 12)
    expect(deg(aimYaw, -180)).toBe(180)
    expect(deg(aimYaw, 180)).toBe(180)
    expect(deg(aimYaw, -200)).toBeCloseTo(160, 12)
    expect(deg(aimYaw, 720)).toBeCloseTo(0, 12)
    expect(deg(aimYaw, -45)).toBeCloseTo(-45, 12)
    expect(Object.is(angleInputValue({ min: -Math.PI, max: Math.PI, wrap: true }, -0), 0)).toBe(
      true
    )
    // 자르는 칸(지금 규칙): 높이각, 리밋 스위치 각
    expect(deg(aimPitch, 120)).toBeCloseTo(90, 12)
    expect(deg(aimPitch, -120)).toBeCloseTo(-90, 12)
    const limitAngle = COMPONENT_TYPES.touchSensor.properties.find(
      (property) => property.key === 'limitAngle'
    ) as PropertyDef & { min: number; max: number }
    expect(angleInputValue(limitAngle, -0.5)).toBe(0)
    expect(angleInputValue(limitAngle, 5)).toBe(limitAngle.max)
    expect(angleInputValue(limitAngle, 0.3)).toBe(0.3)
  })
})

// 웹캠 시뮬레이터 전용 속성(4d, spec-4d §1.1 K1). 생성 파일이 바이트 그대로인지는 generatedOutput.test.ts가 본다
describe('웹캠 카메라 모델·조준', () => {
  const props = COMPONENT_TYPES.webcam.properties as readonly PropertyDef[]
  const byKey = (key: string): PropertyDef => {
    const property = props.find((p) => p.key === key)
    if (!property) throw new Error(key)
    return property
  }

  it('serialNumber 다음 cameraModel·aimYaw·aimPitch·aimRoll 순서다', () => {
    expect(props.map((property) => property.key)).toEqual([
      'serialNumber',
      'cameraModel',
      'aimYaw',
      'aimPitch',
      'aimRoll'
    ])
    expect(byKey('serialNumber').simulation).toBeUndefined()
  })

  it('종류·범위·기본·도움말·감기', () => {
    expect(byKey('cameraModel')).toMatchObject({
      kind: 'enum',
      options: ['logitechC920', 'logitechC270', 'logitechC310', 'lifecamHd3000', 'gobilda3122'],
      default: 'logitechC920',
      hint: true,
      simulation: true
    })
    expect(byKey('aimYaw')).toMatchObject({
      kind: 'angle',
      default: 0,
      min: -Math.PI,
      max: Math.PI,
      wrap: true,
      hint: true,
      simulation: true
    })
    const pitch = byKey('aimPitch')
    expect(pitch).toMatchObject({
      kind: 'angle',
      default: 0,
      min: -Math.PI / 2,
      max: Math.PI / 2,
      hint: true,
      simulation: true
    })
    expect('wrap' in pitch).toBe(false)
    expect(byKey('aimRoll')).toMatchObject({
      kind: 'angle',
      default: 0,
      min: -Math.PI,
      max: Math.PI,
      wrap: true,
      hint: true,
      simulation: true
    })
    // 4c 거리·컬러 센서 기본은 그대로
    expect(
      COMPONENT_TYPES.distanceSensor.properties.find((p) => p.key === 'aimPitch')?.default
    ).toBe(0)
    expect(propertyDefaults('webcam')).toMatchObject({
      serialNumber: '',
      cameraModel: 'logitechC920',
      aimYaw: 0,
      aimPitch: 0,
      aimRoll: 0
    })
  })

  // B1(spec-4e §1.1): 시뮬레이터 전용 기본값은 중립값이다(수평). 거리 센서와 같은 정의 객체를 쓴다
  it('웹캠 aimPitch는 AIM_PITCH_LEVEL 그 객체이고 CAMERA_AIM_PITCH는 없다', () => {
    expect(byKey('aimPitch')).toBe(AIM_PITCH_LEVEL)
    expect(AIM_PITCH_LEVEL.default).toBe(0)
    expect('CAMERA_AIM_PITCH' in catalog).toBe(false)
    expect(propertyDefaults('webcam').aimPitch).toBe(0)
  })
})
