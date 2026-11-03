import type { DeviceValues } from '../sidecarProtocol'
import { NOMINAL_VOLTAGE, type MotorOutputs } from './motorModel'
import type { SimMotorParams, SimServoParams } from './worldSpec'

// 메커니즘 관절의 구동기(3b): 브러시 DC 기어모터, 허브 전력단(VNH5050 H-브리지), 허브 펌웨어 제어 루프, 서보·CR 서보,
// SPARK Mini. 모두 순수 함수·작은 상태라 결정적이다. 구동계 바퀴 모터는 지금처럼 motorModel.ts(운동학 1차 지연)를 쓴다.
//
// 근거(scratchpad p10mass/research/actuators.md = [ACT], p11joint/research/{data,critique}.md, spec-3b §1):
//   - DC 모터 식(인덕턴스 무시, [ACT] §3.1): V = I·R + Ke·ω_m, τ_m = Kt·I. 데이터시트 기본값(사용자 결정, spec-3b §1.1):
//     R = V/I_stall, Kt = τ_stall/(I_stall·G·η), Ke = (V − I_free·R)/ω_free(모터축). τ_stall·ω_free는 12 V 출력축 제조사 값.
//   - 기어 효율은 힘이 흐르는 방향에 따라 다르다(spec-3b §1.2): 모터가 밀면 출력 = η·G·τ_m, 부하가 역구동하면 G·τ_m(손실은 역구동
//     마찰이 맡는다). 그래서 출력 토크를 G·τ_m(선형, 암시 감쇠)으로 두고, 모터가 미는 쪽으로 움직임을 막는 한쪽 마찰 상자
//     (1 − η)·G·|τ_m|를 더한다. 움직이면 상자가 차서 η·G·τ_m이 되고, 역구동이면 상자가 힘을 내지 않으며, 멈춰 있으면 그 사이(기어
//     정지 마찰)다. 영역을 나눠 바꾸지 않으므로 경계에서 떨지 않는다.
//   - 모터축 마찰은 한 번만 센다(3b 비평 C9): 쿨롱 τ_c = backdriveFriction(NeveRest 40·60 역구동 0.09·0.14 N·m ÷ 감속비 ≈
//     2.3 mN·m, data §3.2)과 점성 b = (η·Kt·I_free − τ_c)/ω_free(무부하 전류에 맞춤, 음수면 0). 출력축에서 G·τ_c(상자), G²·b(감쇠).

// 허브 PWM 듀티의 내부 전체 값(gm0 sdk-motors: "a two byte short from -32767 to 32767", [ACT] §3.3)
export const DUTY_FULL_SCALE = 32767
// 허브 펌웨어 제어 주기(ns). 가정: 공개 출처 없음. gm0 "a 5 value ring buffer, which has a new value added to it every 10 ms"와
// WPILib ExpansionHubVelocityConstants "The motor control period is 10ms"에 맞춘다(data §4.2). 0 ns부터 고정 격자에서 표본을 뜬다.
export const HUB_CONTROL_PERIOD_NANOS = 10_000_000

// [p, i, d, f]
export type Pidf = [number, number, number, number]
// 허브 LegacyPID 기본 계수(spec-3b §3): 속도 P10·I3·D0, 위치 P10·I0.05·D0. SDK 12.0 RevRoboticsCoreHexMotor의
// @ExpansionHubMotorControllerVelocityParams·PositionParams와 SDK 6.0 노트 "reverted to the default PID values"(data §4.1).
export const DEFAULT_VELOCITY_PIDF: Pidf = [10, 3, 0, 0]
export const DEFAULT_POSITION_PIDF: Pidf = [10, 0.05, 0, 0]

// SPARK Mini: SDK RevSPARKMini 펄스 500–2500 µs(1500 중앙, 1000 µs가 최대 듀티), 중립 1490–1510 µs(REV 문서, data §8.1)
const SPARK_CENTER_US = 1500
const SPARK_SPAN_US = 1000
const SPARK_NEUTRAL_US = 10
// 서보 펄스: SDK 기본 범위 600–2400 µs의 가운데와 반폭(PwmControl.PwmRange 기본, [ACT] §5.1). 허브 출력은 500–2500 µs(REV
// Control Hub 서보 포트 사양)라 그 밖은 자른다. CR 서보는 power −1..1이 600–2400 µs다(CRServoImpl).
const SERVO_CENTER_US = 1500
const SERVO_HALF_SPAN_US = 900
const HUB_PULSE_MIN_US = 500
const HUB_PULSE_MAX_US = 2500

// ---- DC 기어모터 ----

// 전력단 상태(모터 단자에서). duty는 −1..1(부호는 쓰는 쪽의 기준: 허브 제어기는 허브 부호, 관절 좌표는 "앞"),
// brake는 단자 단락, float는 단자 열림.
export type PowerStage = { kind: 'duty'; duty: number } | { kind: 'brake' } | { kind: 'float' }

export const FLOAT: PowerStage = { kind: 'float' }
export const BRAKE: PowerStage = { kind: 'brake' }

// 출력축 일반화 힘(선형): τ = force − damping·ω. region은 영역 서명용.
export type MotorTerms = { force: number; damping: number; region: string }

export class DcGearMotor {
  readonly gearbox: number
  readonly efficiency: number
  // Ω, N·m/A, V·s/rad(모터축)
  readonly resistance: number
  readonly torqueConstant: number
  readonly backEmfConstant: number
  // 모터축 마찰: 쿨롱(N·m), 점성(N·m·s/rad)
  readonly coulomb: number
  readonly viscous: number

  constructor(params: SimMotorParams) {
    const g = params.gearbox
    const eta = params.efficiency
    this.gearbox = g
    this.efficiency = eta
    this.resistance = NOMINAL_VOLTAGE / params.stallCurrent
    this.torqueConstant = params.stallTorque / (params.stallCurrent * g * eta)
    const freeMotor = params.freeSpeed * g
    this.backEmfConstant = (NOMINAL_VOLTAGE - params.freeCurrent * this.resistance) / freeMotor
    this.coulomb = params.backdriveFriction
    this.viscous = Math.max(
      0,
      (eta * this.torqueConstant * params.freeCurrent - params.backdriveFriction) / freeMotor
    )
  }

  // 출력축 전기 토크(효율 없이 G·τ_m)를 출력축 각속도 ω에 대해 선형으로. 회생 없음: 0 < |d| < 1이면 PWM 꺼짐 구간에 H-브리지가
  // 제동하지 않으므로(gm0 control-system-internals "does not brake the H-bridge during the PWM off cycle", [ACT] §3.3) 토크가
  // 명령과 반대가 되면 0으로 자른다. |d| = 1은 꺼짐 구간이 없어 그대로다(가정: 브리지가 늘 켜져 역전류가 흐른다).
  terms(stage: PowerStage, voltage: number, omega: number): MotorTerms {
    const g = this.gearbox
    const k = (this.torqueConstant * this.backEmfConstant) / this.resistance
    if (stage.kind === 'float') return { force: 0, damping: 0, region: 'f' }
    if (stage.kind === 'brake') return { force: 0, damping: g * g * k, region: 'b' }
    const d = stage.duty
    if (d === 0) return { force: 0, damping: 0, region: '0' }
    const drive = d * voltage - this.backEmfConstant * g * omega
    if (Math.abs(d) < 1 && drive * d <= 0) return { force: 0, damping: 0, region: 'c' }
    return {
      force: (g * this.torqueConstant * d * voltage) / this.resistance,
      damping: g * g * k,
      region: 'l'
    }
  }

  // 단자 전류(A, 부호 있음): 선형 영역 (dV − Ke·ω_m)/R, BRAKE −Ke·ω_m/R, 자른 영역·FLOAT 0
  current(stage: PowerStage, voltage: number, omega: number): number {
    const ke = this.backEmfConstant * this.gearbox * omega
    if (stage.kind === 'float') return 0
    if (stage.kind === 'brake') return -ke / this.resistance
    const d = stage.duty
    if (d === 0) return 0
    const drive = d * voltage - ke
    if (Math.abs(d) < 1 && drive * d <= 0) return 0
    return drive / this.resistance
  }
}

// ---- 허브 펌웨어 모터 제어 ----

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

// 사이드카 motor 출력의 PIDF 계수([p, i, d, f], spec-3b §3). 없거나 모양이 틀리면 fallback.
export function readPidf(values: DeviceValues | undefined, key: string, fallback: Pidf): Pidf {
  const value: unknown = values?.[key]
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finiteNumber)) return fallback
  return [value[0], value[1], value[2], value[3]]
}

export type ControlInputs = {
  out: MotorOutputs
  velocityPidf: Pidf
  positionPidf: Pidf
  // 허브가 센 원시 엔코더 틱(정수)과 50 ms 창 속도(틱/s)
  position: number
  velocity: number
  // RUN_TO_POSITION의 원시 목표(targetPosition + 리셋 기준), 목표가 없으면 null
  rawTarget: number | null
}

// 허브 한 포트의 펌웨어 흉내. 허브 부호(+power가 +틱)로 센다.
//   - RUN_WITHOUT_ENCODER: 듀티 = power(바로 적용). power 0이면 zeroPower(BRAKE 단락·FLOAT 열림).
//   - RUN_USING_ENCODER: 목표 속도 = 출력 velocity(setVelocity, 또는 power × 형식 최대 틱/s, 사이드카가 정함).
//   - RUN_TO_POSITION: 목표 속도 = clamp(P_pos·(원시 목표 − 위치), ±|velocity|)(SDK DcMotorEx: "calculates an on-the-fly velocity
//     goal on each control cycle, then (logically) runs the RUN_WITH_ENCODER logic"). 위치 루프는 P만 쓴다: SDK 주석 "only the
//     proportional ('p') coefficient makes logical sense", 3b 비평 §2.4(위치 I를 주기 합으로 넣으면 넘치고 흔들림). 허용 오차 안에서도
//     루프는 계속 돈다(data §4.3). isBusy는 사이드카가 판단한다.
//   - 속도 루프(LegacyPID 해석, 가정): 10 ms마다 e = 목표 − 측정(50 ms 창 값, 지금 시뮬레이터의 velocity 입력과 같은 것),
//     적분 += I·e(주기 합: 3b 비평 §2.3에서 목표에 닿는 유일한 해석), u = F·목표 + P·e + 적분 + D·(e − 앞 e), 듀티 = u ÷ 32767을
//     ±1로 자르고, 자르면 넘친 만큼 적분에서 뺀다(p11joint/tools/rtp_check.py와 같은 포화 방지, 펌웨어 공개 자료 없음).
//     표본 사이에는 듀티를 유지한다. 모드가 바뀌거나 꺼지면 적분을 지운다.
//   - STOP_AND_RESET_ENCODER는 zeroPower, 꺼짐(enabled false)은 FLOAT다(spec-3b §1.8).
export class HubMotorController {
  // 허브 부호 듀티(엔코더 모드의 마지막 표본 결과)
  duty = 0
  private integral = 0
  private lastError = 0
  private lastMode: string | null = null

  // 지금 전력단(허브 부호)
  stage(out: MotorOutputs): PowerStage {
    if (!out.enabled) return FLOAT
    const zero = out.zeroPower === 'FLOAT' ? FLOAT : BRAKE
    switch (out.mode) {
      case 'STOP_AND_RESET_ENCODER':
        return zero
      case 'RUN_WITHOUT_ENCODER':
        return out.power === 0 ? zero : { kind: 'duty', duty: out.power }
      default:
        return { kind: 'duty', duty: this.duty }
    }
  }

  // 제어 표본 시각에 부른다(엔코더 모드가 아니면 상태만 지운다)
  sample(input: ControlInputs): void {
    const out = input.out
    const encoder =
      out.enabled && (out.mode === 'RUN_USING_ENCODER' || out.mode === 'RUN_TO_POSITION')
    const mode = encoder ? out.mode : null
    if (mode !== this.lastMode) {
      this.integral = 0
      this.lastError = 0
      this.lastMode = mode
      if (!encoder) this.duty = 0
    }
    if (!encoder) return
    let goal: number
    if (out.mode === 'RUN_TO_POSITION') {
      const limit = Math.abs(out.velocity ?? 0)
      goal =
        input.rawTarget === null
          ? 0
          : Math.max(
              -limit,
              Math.min(limit, input.positionPidf[0] * (input.rawTarget - input.position))
            )
    } else {
      goal = out.velocity ?? 0
    }
    const [p, i, d, f] = input.velocityPidf
    const error = goal - input.velocity
    this.integral += i * error
    let u = f * goal + p * error + this.integral + d * (error - this.lastError)
    this.lastError = error
    if (Math.abs(u) > DUTY_FULL_SCALE) {
      const clamped = Math.sign(u) * DUTY_FULL_SCALE
      this.integral -= u - clamped
      u = clamped
    }
    this.duty = u / DUTY_FULL_SCALE
  }
}

// SPARK Mini(서보 포트의 모터 컨트롤러): 펄스 → 듀티(부호는 SDK가 방향을 적용한 power). PWM이 꺼졌거나 중립이면 FLOAT
// (브레이크·코스트는 기판 스위치라 소프트웨어가 모른다, spec-3b §1.9).
export function sparkMiniStage(values: DeviceValues | undefined): PowerStage {
  const pulse = values?.pulseUs
  if (values?.pwm !== true || !finiteNumber(pulse)) return FLOAT
  const offset = pulse - SPARK_CENTER_US
  if (Math.abs(offset) <= SPARK_NEUTRAL_US) return FLOAT
  return { kind: 'duty', duty: Math.max(-1, Math.min(1, offset / SPARK_SPAN_US)) }
}

// 서보 포트 장치의 출력인가(SPARK Mini를 모터 구동으로 쓸 때 허브 모터와 구별한다: 허브 모터는 mode가 있다)
export function isServoPortOutput(values: DeviceValues | undefined): boolean {
  return values !== undefined && !('mode' in values) && 'pwm' in values
}

// ---- 서보 ----

export type ServoCommand =
  | { kind: 'limp' }
  // 서보 출력축 목표 각(rad, 1500 µs가 0, 펄스가 늘면 +)
  | { kind: 'position'; angle: number }
  // CR 서보: 무부하 속도의 비율(−1..1)
  | { kind: 'speed'; fraction: number }

// 서보 출력(pulseUs·pwm)에서 이번 구간의 명령. 펄스로 정한다(팀이 setPwmRange로 범위를 바꿔도 실제 서보는 펄스만 본다).
export function servoCommand(
  values: DeviceValues | undefined,
  params: SimServoParams,
  continuous: boolean
): ServoCommand {
  const pulse = values?.pulseUs
  // PWM이 꺼지면 허브는 서보 5 V 전원도 끈다(gm0, data §4.4): 힘이 빠진다
  if (values?.pwm !== true || !finiteNumber(pulse)) return { kind: 'limp' }
  const offset = Math.max(HUB_PULSE_MIN_US, Math.min(HUB_PULSE_MAX_US, pulse)) - SERVO_CENTER_US
  if (!continuous)
    return { kind: 'position', angle: (offset / (2 * SERVO_HALF_SPAN_US)) * params.rangeAngle }
  if (Math.abs(offset) <= params.deadbandUs / 2) return { kind: 'speed', fraction: 0 }
  const full = SERVO_HALF_SPAN_US * params.crFullPower
  return { kind: 'speed', fraction: Math.max(-1, Math.min(1, offset / full)) }
}

// 서보 출력축 일반화 힘: τ = force − damping·ω − stiffness·Δθ(암시), friction은 쿨롱 상자(힘)
export type ServoTerms = {
  force: number
  damping: number
  stiffness: number
  friction: number
  region: string
}

// 서보 모델([ACT] §5.4, 가정): 내부 PD τ = kp·e − kd·ω를 모터 직선 τ ∈ [−τs(1 + ω/ωf), τs(1 − ω/ωf)]로 자른다(그래서 속도는
// 무부하 속도까지, 토크는 정지 토크까지). e는 목표 − 각에서 데드밴드 반폭(deadbandUs/2를 각으로)을 뺀 것이고, 데드밴드 안에서는
// D만 남는다. CR 서보는 DC 모터 직선 τ = τs·(u − ω/ωf)다. PWM이 꺼지면 힘 0에 기어 마찰(limpFriction)만 남는다.
export function servoTerms(
  command: ServoCommand,
  params: SimServoParams,
  theta: number,
  omega: number
): ServoTerms {
  const ts = params.stallTorque
  const slope = ts / params.freeSpeed
  if (command.kind === 'limp')
    return { force: 0, damping: 0, stiffness: 0, friction: params.limpFriction, region: 'x' }
  if (command.kind === 'speed')
    return { force: ts * command.fraction, damping: slope, stiffness: 0, friction: 0, region: 'r' }
  const deadband = (params.deadbandUs / 2) * (params.rangeAngle / (2 * SERVO_HALF_SPAN_US))
  const error = command.angle - theta
  if (Math.abs(error) <= deadband)
    return { force: 0, damping: params.kd, stiffness: 0, friction: 0, region: 'd' }
  const effective = error - Math.sign(error) * deadband
  const torque = params.kp * effective - params.kd * omega
  const high = ts * (1 - omega / params.freeSpeed)
  const low = -ts * (1 + omega / params.freeSpeed)
  if (torque > high) return { force: ts, damping: slope, stiffness: 0, friction: 0, region: 'h' }
  if (torque < low) return { force: -ts, damping: slope, stiffness: 0, friction: 0, region: 'n' }
  return {
    force: params.kp * effective,
    damping: params.kd,
    stiffness: params.kp,
    friction: 0,
    region: 'p'
  }
}
