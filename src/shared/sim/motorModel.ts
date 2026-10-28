import type { DeviceValues } from '../sidecarProtocol'
import {
  hubMaxTicksPerSecond,
  motorType,
  noLoadOutputRadPerSec,
  ticksPerOutputRev,
  type MotorType
} from './motorTypes'

// 모터 하나의 운동학 모델(질량·부하 없음): 출력축 각속도 ω(rad/s)와 원시 엔코더 틱(소수)을 허브 부호로 센다.
// 사이드카가 보낸 허브 출력(sidecar/sdk/org/sandbot/sdk/devices/package-info.java의 motor 행: power·velocity는 허브 부호)으로
// 목표 각속도 ω*와 시간 상수 τ를 정하고, 그 구간 동안 ω*가 일정하다고 보고 1차 응답을 정확히 적분한다:
//   Δθ = ω*·h + (ω0 − ω*)·τ·(1 − e^(−h/τ)),  ω1 = ω* + (ω0 − ω*)·e^(−h/τ)
// 펌웨어 규칙(허브 Lynx 펌웨어를 흉내 낸 것):
//   - RUN_WITHOUT_ENCODER: ω* = power × 무부하 × (전압/12)
//   - RUN_USING_ENCODER: ω* = 목표 속도(틱/s → rad/s), |ω*| ≤ 무부하 × 전압/12. 목표 0이면 능동 유지(BRAKE와 같은 τ)
//   - RUN_TO_POSITION: ω* = clamp(Kp·(원시 목표 − 원시 틱), ±|목표 속도|). 원시 목표 = targetPosition + encoderOffset.
//     허용 오차 안에서도 계속 위치를 잡는다(isBusy는 사이드카가 판단한다).
//   - power 0, STOP_AND_RESET_ENCODER, 꺼짐(enabled false): ω* = 0. τ는 BRAKE면 짧고, FLOAT·꺼짐이면 길다.

// 시간 상수·이득(근사. 측정 보정은 나중에 한다)
// - TAU_DRIVE: 구동할 때 목표 속도로 가는 시간 상수
// - TAU_BRAKE: BRAKE(전기자 단락)·엔코더 모드의 능동 유지로 멈출 때
// - TAU_FLOAT: FLOAT·꺼짐에서 마찰로 서서히 멈출 때
// - KP_POSITION: RUN_TO_POSITION 위치 이득(1/s, 오차 틱 → 목표 틱/s). 위치 루프는 τ_drive의 속도 응답 위에 있으므로
//   τ·e'' + e' + Kp·e = 0이고, Kp·τ ≤ 1/4이면 임계 감쇠 이상이라 넘치지 않는다(하위 단계의 지연을 생각해 0.24).
export const TAU_DRIVE = 0.1
export const TAU_BRAKE = 0.05
export const TAU_FLOAT = 0.5
export const KP_POSITION = 2.4

// 기준 배터리 전압(V): 형식의 maxRPM은 12 V 무부하 값이다
export const NOMINAL_VOLTAGE = 12

// 이보다 작은 속도(rad/s)는 목표가 0이면 0으로 둔다(지수 감쇠가 끝없이 작은 움직임을 만들지 않게)
const REST_OMEGA = 1e-9
// RUN_TO_POSITION에서 이만큼(틱) 안이고 거의 멈췄으면 목표에 붙인다
const REST_TICKS = 1e-6

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
    encoderOffset: finiteOr(values?.encoderOffset, 0)
  }
}

export function isEncoderMode(mode: MotorMode): boolean {
  return mode === 'RUN_USING_ENCODER' || mode === 'RUN_TO_POSITION'
}

// 한 구간의 명령. position이 있으면(RUN_TO_POSITION) 하위 단계마다 지금 틱으로 ω*를 다시 정한다.
export type MotorCommand = {
  // 목표 각속도(rad/s, 허브 부호)
  target: number
  tau: number
  position: { rawTarget: number; maxTicksPerSecond: number } | null
}

const REST: MotorCommand = { target: 0, tau: TAU_FLOAT, position: null }

export class MotorModel {
  readonly type: MotorType
  // 출력축 1 rad의 엔코더 틱
  readonly ticksPerRad: number
  // 12 V 무부하 출력축 각속도(rad/s)
  readonly noLoad: number
  // 허브 최대 속도(틱/s, SDK 반올림). 엔코더 모드의 power ↔ velocity 환산과 같다.
  readonly hubMaxTicksPerSecond: number
  omega = 0
  raw = 0

  constructor(modelTag: string, gearbox: number) {
    this.type = motorType(modelTag)
    this.ticksPerRad = ticksPerOutputRev(this.type, gearbox) / (2 * Math.PI)
    this.noLoad = noLoadOutputRadPerSec(this.type, gearbox)
    this.hubMaxTicksPerSecond = hubMaxTicksPerSecond(this.type)
  }

  // 출력 → 이번 구간의 명령. positionOffset은 targetPosition에 더해 원시 목표를 만드는 값(보통 encoderOffset).
  command(out: MotorOutputs, voltage: number, positionOffset: number): MotorCommand {
    if (!out.enabled) return REST
    const limit = this.noLoad * (voltage / NOMINAL_VOLTAGE)
    const zeroTau = out.zeroPower === 'BRAKE' ? TAU_BRAKE : TAU_FLOAT
    switch (out.mode) {
      case 'STOP_AND_RESET_ENCODER':
        return { target: 0, tau: zeroTau, position: null }
      case 'RUN_WITHOUT_ENCODER':
        if (out.power === 0) return { target: 0, tau: zeroTau, position: null }
        return { target: out.power * limit, tau: TAU_DRIVE, position: null }
      case 'RUN_USING_ENCODER': {
        const velocity = out.velocity ?? 0
        if (velocity === 0) return { target: 0, tau: TAU_BRAKE, position: null }
        const target = velocity / this.ticksPerRad
        return { target: Math.max(-limit, Math.min(limit, target)), tau: TAU_DRIVE, position: null }
      }
      case 'RUN_TO_POSITION': {
        const speed = Math.min(Math.abs(out.velocity ?? 0), limit * this.ticksPerRad)
        if (out.targetPosition === null || speed === 0)
          return { target: 0, tau: TAU_BRAKE, position: null }
        return {
          target: 0,
          tau: TAU_DRIVE,
          position: { rawTarget: out.targetPosition + positionOffset, maxTicksPerSecond: speed }
        }
      }
    }
  }

  // h초 동안 명령대로 돌린다. 출력축이 돈 각(rad, 허브 부호)을 돌려준다.
  advance(command: MotorCommand, h: number): number {
    let target = command.target
    const position = command.position
    if (position) {
      const ticksPerSecond = KP_POSITION * (position.rawTarget - this.raw)
      target =
        Math.max(
          -position.maxTicksPerSecond,
          Math.min(position.maxTicksPerSecond, ticksPerSecond)
        ) / this.ticksPerRad
    }
    const tau = command.tau
    const diff = this.omega - target
    const dTheta = target * h - diff * tau * Math.expm1(-h / tau)
    this.omega = target + diff * Math.exp(-h / tau)
    this.raw += dTheta * this.ticksPerRad
    if (target === 0 && Math.abs(this.omega) < REST_OMEGA) this.omega = 0
    if (
      position &&
      Math.abs(position.rawTarget - this.raw) < REST_TICKS &&
      Math.abs(this.omega * this.ticksPerRad) < REST_TICKS
    ) {
      this.raw = position.rawTarget
      this.omega = 0
    }
    return dTheta
  }

  // 엔코더 속도(틱/s, 허브 부호)
  get ticksPerSecond(): number {
    return this.omega * this.ticksPerRad
  }
}
