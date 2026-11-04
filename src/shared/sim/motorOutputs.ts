import type { DeviceValues } from '../sidecarProtocol'

// 사이드카 motor 출력의 해석(sidecar/sdk/org/sandbot/sdk/devices/package-info.java의 motor 행: power·velocity는 허브 부호).
// 시뮬레이터의 모든 모터(구동계·관절·자유 모터)가 같은 해석으로 허브 펌웨어 흉내(actuators.ts HubMotorController)를 돌린다.

// 기준 배터리 전압(V): 형식의 maxRPM은 12 V 무부하 값이다
export const NOMINAL_VOLTAGE = 12

export type MotorMode =
  'RUN_WITHOUT_ENCODER' | 'RUN_USING_ENCODER' | 'RUN_TO_POSITION' | 'STOP_AND_RESET_ENCODER'

// 사이드카 motor 출력에서 시뮬레이터가 쓰는 것(없거나 형식이 틀리면 꺼진 모터로 본다)
export type MotorOutputs = {
  mode: MotorMode
  // 허브 power(−1..1): 엔코더 없음이면 정전력 값
  power: number
  // 엔코더 모드의 목표 속도(틱/s, 허브 부호), 아니면 null
  velocity: number | null
  enabled: boolean
  zeroPower: 'BRAKE' | 'FLOAT'
  // 허브 틱(리셋 기준), 받은 적 없으면 null
  targetPosition: number | null
  // 마지막 STOP_AND_RESET_ENCODER 때의 원시 틱
  encoderOffset: number
  // 허브에 보낸 STOP_AND_RESET_ENCODER 횟수(리셋마다 1씩, 원시 틱이 그대로여도 는다)
  encoderResets: number
}

const MODES: readonly MotorMode[] = [
  'RUN_WITHOUT_ENCODER',
  'RUN_USING_ENCODER',
  'RUN_TO_POSITION',
  'STOP_AND_RESET_ENCODER'
]

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function readMotorOutputs(values: DeviceValues | undefined): MotorOutputs {
  const mode = values?.mode
  const velocity = values?.velocity
  const target = values?.targetPosition
  return {
    mode: MODES.includes(mode as MotorMode) ? (mode as MotorMode) : 'RUN_WITHOUT_ENCODER',
    power: Math.max(-1, Math.min(1, finiteOr(values?.power, 0))),
    velocity: typeof velocity === 'number' && Number.isFinite(velocity) ? velocity : null,
    enabled: values?.enabled === true,
    zeroPower: values?.zeroPower === 'FLOAT' ? 'FLOAT' : 'BRAKE',
    targetPosition: typeof target === 'number' && Number.isFinite(target) ? target : null,
    encoderOffset: finiteOr(values?.encoderOffset, 0),
    encoderResets: finiteOr(values?.encoderResets, 0)
  }
}

export function isEncoderMode(mode: MotorMode): boolean {
  return mode === 'RUN_USING_ENCODER' || mode === 'RUN_TO_POSITION'
}
