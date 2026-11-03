import type { DeviceValues } from '../sidecarProtocol'
import { NOMINAL_VOLTAGE, type MotorOutputs } from './motorModel'
import {
  MAX_SERVO_PULSE_US,
  MIN_SERVO_PULSE_US,
  type SimMotorParams,
  type SimServoParams
} from './worldSpec'

// 메커니즘 관절의 구동기(3b): 브러시 DC 기어모터, 허브 전력단(VNH5050 H-브리지), 허브 펌웨어 제어 루프, 서보·CR 서보.
// 모두 순수 함수·작은 상태라 결정적이다. 서보 포트의 모터 컨트롤러(SPARK Mini)로 도는 관절은 3b에 없다(세계 설명 v2의 관절 구동이
// 그 모터를 나타내지 못한다: 모터 컴포넌트가 아니라 형식·감속비가 없다). 구동계 바퀴 모터는 지금처럼 motorModel.ts(운동학 1차 지연)를 쓴다.
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

// 허브 H-브리지(VNH5050) 본체 다이오드의 순방향 강하(V). 가정: 실리콘 본체 다이오드의 보통 값 0.7 V(이 세션에서 VNH5050A-E
// 데이터시트(ST DocID 16009)의 free-wheeling diode 순방향 전압 표를 열지 못했다 — 회생 전류 몇 A에서 0.7–1 V 범위로 본다).
// 회생 전류가 레일로 돌아가려면 단자 전압이 레일보다 이만큼(FLOAT·듀티 0은 두 번) 높아야 한다.
export const BODY_DIODE_DROP = 0.7

// [p, i, d, f]
export type Pidf = [number, number, number, number]
// 허브 LegacyPID 기본 계수(spec-3b §3): 속도 P10·I3·D0, 위치 P10·I0.05·D0. SDK 12.0 RevRoboticsCoreHexMotor의
// @ExpansionHubMotorControllerVelocityParams·PositionParams와 SDK 6.0 노트 "reverted to the default PID values"(data §4.1).
export const DEFAULT_VELOCITY_PIDF: Pidf = [10, 3, 0, 0]
export const DEFAULT_POSITION_PIDF: Pidf = [10, 0.05, 0, 0]

// 서보 펄스: SDK 기본 범위 600–2400 µs의 가운데와 반폭(PwmControl.PwmRange 기본, [ACT] §5.1). 허브 출력은 500–2500 µs(REV
// Control Hub 서보 포트 사양, worldSpec.ts MIN·MAX_SERVO_PULSE_US)라 그 밖은 자른다. CR 서보는 power −1..1이 600–2400 µs다
// (CRServoImpl).
export const SERVO_CENTER_US = 1500
const SERVO_HALF_SPAN_US = 900

// 서보 위치(setPosition 0..1, SDK 기본 PWM 범위)의 펄스(µs): 0 → 600, 0.5 → 1500, 1 → 2400(ServoImpl·PwmRange 기본)
export function servoPositionPulseUs(position: number): number {
  return SERVO_CENTER_US + (2 * position - 1) * SERVO_HALF_SPAN_US
}

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

  // 전력단(H-브리지와 본체 다이오드)이 모터 단자에 거는 평균 전압(V), 전류가 흐르지 않으면 null. e는 역기전력 Ke·G·ω(V).
  // 모델(가정, 인덕턴스는 무시한다, 다이오드 강하는 BODY_DIODE_DROP 하나로 둔다):
  //   - VNH5050은 비동기(asynchronous)로 PWM한다: 켜짐 구간은 FET가 단자를 ±V_bat에 잇고(전류는 양쪽으로 흐른다), 꺼짐 구간은
  //     FET를 끄고 본체 다이오드로만 환류한다(gm0 control-system-internals "does not brake the H-bridge during the PWM off
  //     cycle", [ACT] §3.3). 다이오드는 단자 전압이 레일을 다이오드 강하만큼 넘을 때만 전도한다.
  //   - 0 < |d| < 1의 평균 단자 전압은 d·V다(연속 전도의 평균, 3b 비평 §4.3-14). 역기전력이 명령 쪽으로 d·V를 넘으면 전류가
  //     역전해야 하는데 꺼짐 구간의 다이오드가 그 길을 막으므로 전류 0으로 자른다(회생 없음). 역기전력이 더 커서(중력이
  //     리프트를 끌어내림, 큰 관성이 명령보다 빨리 돎) 켜짐 구간에는 FET가 단자를 sign(d)·V_bat에, 꺼짐 구간에는 반대쪽 다리의
  //     켜진 아래 FET와 본체 다이오드 하나가 sign(d)·(V_bat + Vf)에 묶으면 회생 전류가 흐르며 제동한다. 평균 단자 전압은
  //     u = sign(d)·(V_bat + (1 − |d|)·Vf)이고 sign(d)·e가 그것을 넘을 때 흐른다(경계에서 전류 0이라 토크가 연속이다).
  //     |d| = 1은 꺼짐 구간이 없어 직선 d·V 그대로이고 |d| → 1에서 연속이다(d = 0.99와 1.0의 차이는 0.01·Vf).
  //   - FLOAT(단자 열림)·듀티 0: FET가 모두 꺼져 회생 전류는 본체 다이오드 둘을 거친다. |e| ≤ V_bat + 2·Vf이면 전류 0,
  //     넘으면 단자가 sign(e)·(V_bat + 2·Vf)에 묶인다(p10mass actuators.md §3.3 "역기전력이 V_bat + 다이오드 강하를 넘을 때만
  //     다이오드로 회생한다"). 1.4 V는 무부하 속도의 역기전력(≈ 11.7 V)의 약 12 %라 FLOAT로 내리는 속도를 어느 부하에서나
  //     약 0.12·ω_free 올린다(무시하면 시뮬레이터가 실제보다 느리게 내린다).
  //   - BRAKE: 단자 단락(0 V). 결정적이다(영역은 지금 ω만으로 정한다).
  private terminal(
    stage: PowerStage,
    voltage: number,
    e: number
  ): { u: number | null; region: string } {
    if (stage.kind === 'brake') return { u: 0, region: 'b' }
    const d = stage.kind === 'duty' ? stage.duty : 0
    if (d === 0) {
      const open = stage.kind === 'float' ? 'f' : '0'
      const clamp = voltage + 2 * BODY_DIODE_DROP
      if (Math.abs(e) <= clamp) return { u: null, region: open }
      return { u: Math.sign(e) * clamp, region: stage.kind === 'float' ? 'F' : 'z' }
    }
    const s = Math.sign(d)
    const ahead = s * e
    if (Math.abs(d) >= 1 || ahead <= Math.abs(d) * voltage) return { u: d * voltage, region: 'l' }
    const clamp = voltage + (1 - Math.abs(d)) * BODY_DIODE_DROP
    if (ahead > clamp) return { u: s * clamp, region: 'g' }
    return { u: null, region: 'c' }
  }

  // 출력축 전기 토크(효율 없이 G·τ_m)를 출력축 각속도 ω에 대해 선형으로: τ = G·Kt·(u − Ke·G·ω)/R. 단자 전압 u는 전력단 모델
  // (terminal)이 정하고, 전류가 흐르지 않는 구간(자름·FLOAT 아래)은 힘·감쇠 0이다.
  terms(stage: PowerStage, voltage: number, omega: number): MotorTerms {
    const g = this.gearbox
    const { u, region } = this.terminal(stage, voltage, this.backEmfConstant * g * omega)
    if (u === null) return { force: 0, damping: 0, region }
    const k = (this.torqueConstant * this.backEmfConstant) / this.resistance
    return { force: (g * this.torqueConstant * u) / this.resistance, damping: g * g * k, region }
  }

  // 단자 전류(A, 부호 있음): (u − Ke·ω_m)/R, 전류가 흐르지 않는 구간은 0
  current(stage: PowerStage, voltage: number, omega: number): number {
    const e = this.backEmfConstant * this.gearbox * omega
    const { u } = this.terminal(stage, voltage, e)
    return u === null ? 0 : (u - e) / this.resistance
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

// ---- 서보 ----

export type ServoCommand =
  | { kind: 'limp' }
  // 서보 출력축 목표 각(rad, 관절 +축 기준, 편집 자세가 0)
  | { kind: 'position'; angle: number }
  // CR 서보: 무부하 속도의 비율(−1..1)
  | { kind: 'speed'; fraction: number }

// 서보 출력(pulseUs·pwm)에서 이번 구간의 명령. 펄스로 정한다(팀이 setPwmRange로 범위를 바꿔도 실제 서보는 펄스만 본다).
// 서보 혼이 어느 각에 끼워졌는지는 팀마다 다르므로 편집 자세(관절 q = 0)의 펄스 zeroPulseUs(관절 카드의 "편집 자세의 서보
// 위치", 기본 0.5 = 1500 µs)를 기준으로 재고, direction은 +펄스가 관절 +축(1)·−축(−1)으로 도는지다(데이터시트는 펄스가
// 늘면 혼이 시계 방향으로 돈다고 하지만 관절 축을 어느 쪽으로 잡았는지에 따라 다르다). 그래서 위치 서보 각 =
// direction × (펄스 − zeroPulseUs) × rangeAngle/1800 µs. CR 서보의 정지(데드밴드 가운데)는 서보 회로가 정하므로 늘
// 1500 µs이고 direction만 쓴다.
export function servoCommand(
  values: DeviceValues | undefined,
  params: SimServoParams,
  continuous: boolean,
  zeroPulseUs = SERVO_CENTER_US,
  direction: 1 | -1 = 1
): ServoCommand {
  const pulse = values?.pulseUs
  // PWM이 꺼지면 허브는 서보 5 V 전원도 끈다(gm0, data §4.4): 힘이 빠진다
  if (values?.pwm !== true || !finiteNumber(pulse)) return { kind: 'limp' }
  const clamped = Math.max(MIN_SERVO_PULSE_US, Math.min(MAX_SERVO_PULSE_US, pulse))
  if (!continuous)
    return {
      kind: 'position',
      angle: direction * ((clamped - zeroPulseUs) / (2 * SERVO_HALF_SPAN_US)) * params.rangeAngle
    }
  const offset = clamped - SERVO_CENTER_US
  if (Math.abs(offset) <= params.deadbandUs / 2) return { kind: 'speed', fraction: 0 }
  const full = SERVO_HALF_SPAN_US * params.crFullPower
  return { kind: 'speed', fraction: direction * Math.max(-1, Math.min(1, offset / full)) }
}

// 서보 출력축 일반화 힘: τ = force − damping·ω − stiffness·Δθ(암시), friction은 쿨롱 상자(힘)
export type ServoTerms = {
  force: number
  damping: number
  stiffness: number
  friction: number
  region: string
}

// 정지 토크로 자른 출력: 모터 직선 τs·(u − ω/ωf)는 부하가 서보를 명령 반대로 돌리면(역구동, ω가 미는 방향과 반대) τs를
// 넘는다(맨 DC 모터라면 역기전력이 더해져 정지 전류보다 큰 전류가 흐른다). 서보 출력은 정지 토크까지로 자른다(spec-3b §1.9
// "토크는 정지 토크까지 … CR 서보도 토크로 자른다". 가정: 서보 내부 구동 회로가 정지 전류를 넘기지 않는다 — 공개 출처 없음,
// [ACT] §5.4의 포화 모델).
// 역구동 구간(영역 'H'·'N')은 잘린 토크 ±τs를 지금 속도 ω₀에서 선형화한다: τ = ±τs − (τs/ωf)·(ω − ω₀). 감쇠를 암시 D 항에
// 그대로 두므로 한 하위 단계의 속도 변화가 많아야 ωf 남짓이고(감쇠 없는 일정 토크였을 때는 관성이 작은 몸체에서 한 하위
// 단계에 영을 넘어 반대 포화 구간으로 튀고, 그 둘을 오가며 (τs − 마찰)/점성까지 폭주했다), ω₀에서는 정확히 ±τs, 직선과
// 만나는 경계에서는 직선과 같다(연속). 명령 쪽으로 도는 포화(영역 'h'·'n', 위치 서보의 큰 오차)는 모터 직선의 끝 ±τs − (τs/ωf)·ω다.
function saturatedServo(sign: 1 | -1, ts: number, slope: number, omega: number): ServoTerms {
  if (sign * omega < 0)
    return {
      force: sign * ts + slope * omega,
      damping: slope,
      stiffness: 0,
      friction: 0,
      region: sign > 0 ? 'H' : 'N'
    }
  return {
    force: sign * ts,
    damping: slope,
    stiffness: 0,
    friction: 0,
    region: sign > 0 ? 'h' : 'n'
  }
}

// 서보 모델([ACT] §5.4, 가정): 내부 PD τ = kp·e − kd·ω를 모터 직선 τ ∈ [−τs(1 + ω/ωf), τs(1 − ω/ωf)]와 정지 토크 ±τs로
// 자른다(그래서 속도는 무부하 속도까지, 토크는 정지 토크까지). e는 목표 − 각에서 데드밴드 반폭(deadbandUs/2를 각으로)을 뺀
// 것이고, 데드밴드 안에서는 D만 남는다. CR 서보는 DC 모터 직선 τ = τs·(u − ω/ωf)를 ±τs로 자른 것이다. PWM이 꺼지면 힘 0에
// 기어 마찰(limpFriction)만 남는다.
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
  if (command.kind === 'speed') {
    const torque = ts * command.fraction - slope * omega
    if (torque > ts) return saturatedServo(1, ts, slope, omega)
    if (torque < -ts) return saturatedServo(-1, ts, slope, omega)
    return { force: ts * command.fraction, damping: slope, stiffness: 0, friction: 0, region: 'r' }
  }
  const deadband = (params.deadbandUs / 2) * (params.rangeAngle / (2 * SERVO_HALF_SPAN_US))
  const error = command.angle - theta
  if (Math.abs(error) <= deadband)
    return { force: 0, damping: params.kd, stiffness: 0, friction: 0, region: 'd' }
  const effective = error - Math.sign(error) * deadband
  const torque = params.kp * effective - params.kd * omega
  const high = Math.min(ts, ts * (1 - omega / params.freeSpeed))
  const low = Math.max(-ts, -ts * (1 + omega / params.freeSpeed))
  if (torque > high) return saturatedServo(1, ts, slope, omega)
  if (torque < low) return saturatedServo(-1, ts, slope, omega)
  return {
    force: params.kp * effective,
    damping: params.kd,
    stiffness: params.kp,
    friction: 0,
    region: 'p'
  }
}
