import type { SimNoticeCode } from '../play'
import type { DeviceValues } from '../sidecarProtocol'
import { compose, inverse, twistBetween, wrapAngle, type Twist } from './drivetrain'
import {
  DcGearMotor,
  DEFAULT_POSITION_PIDF,
  DEFAULT_VELOCITY_PIDF,
  FLOAT,
  HUB_CONTROL_PERIOD_NANOS,
  HubMotorController,
  readPidf,
  SERVO_CENTER_US,
  servoCommand,
  servoTerms,
  type PowerStage,
  type ServoCommand
} from './actuators'
import {
  Articulation,
  type ContactFrames,
  type ContactRow,
  type ContactSet,
  type DriveForces
} from './articulation'
import { BodyCollision, bodyCollisionNeeded } from './bodyCollision'
import { ElementWorld, type ElementWorldOptions } from './elements/elementWorld'
import type { GameState } from './elements/gameState'
import {
  isBlockingNormal,
  ROLLER_RESISTANCE,
  SupportMonitor,
  wallRows,
  wheelContact,
  wheelCoordinateFriction,
  wheelLoads,
  wheelRows,
  type RollerResistance,
  type WheelContact
} from './contact'
import { HubVelocityWindow } from './encoderVelocity'
import {
  fieldCollision,
  structureContactState,
  structureRows,
  type FieldCollision,
  type StructureContactState
} from './fieldContact'
import { FieldCameras } from './fieldCameras'
import { FieldSensors, type SensorModels } from './fieldSensors'
import { isEncoderMode, readMotorOutputs, type MotorOutputs } from './motorOutputs'
import { jointEncoderTicksPerOutputRev } from './actuatorData'
import { motorType, rotationSign, ticksPerOutputRev } from './motorTypes'
import { GRAVITY } from './physics'
import type { FieldSpec } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { composeFrames, planarFrame, type Frame3 } from './sensorFrame'
import { LOAD_FILTER_TAU, ROLLING_RESISTANCE } from './wheelData'
import type {
  Pose2,
  SimDeadWheelSpec,
  SimMotorSpec,
  SimOtosSpec,
  SimElementState,
  SimPinpointSpec,
  SimPose,
  SimServoParams,
  Vec2,
  WorldSpec
} from './worldSpec'

// 시뮬레이터(메인 프로세스가 사이드카 틱마다 부른다, src/main/sidecar/world.ts의 SimWorld). 로봇과 메커니즘을 한 동역학 풀이
// (articulation.ts, 감소 좌표 관절 나무 + 상자 LCP)로 계산하고, 그 자세로 센서 값(엔코더, IMU, 데드휠, Pinpoint, OTOS, 리밋
// 스위치)을 만든다. 결과는 입력열(틱 시각과 장치 출력)에만 달려 있다(벽시계·난수·순서가 정해지지 않은 자료 구조를 쓰지 않는다).
//
// 시간: step(t, outputs)는 [이전 t, t] 구간을 **이전 틱의 출력**으로 적분한다(사이드카는 틱 경계에서 그 틱의 출력을 보내고,
// 답의 입력은 그 뒤부터 보이므로 구간 동안 장치가 따른 명령은 앞 틱의 것이다). 하위 단계 경계는 0 ns부터의 절대 1 ms 격자와 틱
// 경계다. 허브 제어 표본(10 ms 격자)이 그 격자 위에 있어 틱 간격이 달라도 같은 시각에 표본을 뜬다. 첫 호출은 적분하지 않고 상태만
// 만든 뒤 모든 입력을 보낸다. 그 뒤는 값이 바뀐 키만 보낸다.
//
// 부호: 모터 power·velocity·position은 허브 부호다(사이드카 package-info.java). 인스펙터 방향(spec.directionSign)은
// "+power면 바퀴가 앞으로 구른다"는 뜻이므로, 모터 좌표(출력축 각 φ, "앞") = 허브 각 × 형식 회전 부호 × 인스펙터 방향 부호다.
// 그래서 팀 코드가 인스펙터와 같은 setDirection을 쓰면 getCurrentPosition은 앞으로 갈 때 는다.
//
// 모터(모두 동역학, spec-3c §1.2): DC 기어모터 + 허브 전력단 + 허브 펌웨어 제어(actuators.ts). 좌표는 셋 중 하나다.
//   - 관절 모터: 관절 좌표(3b). 엔코더는 모터축 카운트 × 실제 감속비(actuatorData.ts jointEncoderTicksPerOutputRev).
//   - 바퀴 모터: 장치마다 출력축 각 φ 하나(armature J_rotor·G² + Σ J_wheel/G_ext²). 그 모터가 구동하는 바퀴들의 접촉 행이 r/G_ext로
//     이 좌표에 걸린다. 토크·전류·관성은 SimMotorSpec.params(실제 감속비), 엔코더는 SDK 규칙(ticksPerRev ÷ gearing ×
//     spec.gearbox: 팀의 RR·Pedro 틱/in이 2단계와 같다).
//   - 관절도 바퀴도 아닌 모터(인테이크 등): armature만 있는 좌표(회전자 + 기어 손실, 부하 없음), 엔코더는 SDK 규칙.
// 모든 모터가 단자 전류(current)를 보낸다.
//
// 구동계(바퀴가 하나라도 있는 로봇, spec-3c §1.1): 평면 부유 기저(필드 X·Y 직선 + Z 회전 가상 관절, 섀시 = robot.body)에 바퀴
// 접촉 마찰·벽 행(contact.ts)을 걸어 같은 LCP로 푼다. 법선 하중은 하위 단계마다 섀시 관절의 RNEA 렌치(가속은 걸러진 앞 하위 단계
// 값)를 나눈 것이고, 바퀴가 오래 뜨거나 받쳐지지 않으면 wheelLift·tipping을 한 번 알린다(넘어지지는 않는다). 오도메트리(데드휠·
// Pinpoint)는 하위 단계마다 실제 자세 변화 twistBetween(전, 후)로 센다. 바퀴가 없는 로봇은 3b처럼 기저가 고정이다(프레임이 바닥에
// 놓여 있다).
//
// 필드(spec-4ab §1.10): 벽 반폭은 시즌 FieldSpec(spec.field.season)의 perimeter.innerHalf이고, 시즌의 solid 고정 구조물(발판
// 막대·다리·FLOWER)은 외곽 × [0, robot.height] 프리즘과 접촉 행(fieldContact.ts)을 벽 행 뒤에 붙인다. 평면 경로의 벽·구조물 행은
// 부유 기저에만 계산한다. 'none' 시즌은 벽 반폭이 field.ts 값 그대로이고 구조물이 없어 3c와 바이트까지 같다.
//
// 몸체 충돌(spec-5 §4.3): 세계 설명에 충돌 형상이 있으면(robot.colliders 칸이 있거나 관절 하나라도 colliders가 있으면) 몸체
// 충돌 행(bodyCollision.ts)을 바퀴·벽 행 뒤에 붙이고, 바퀴 없는 로봇도 관절 몸체 충돌을 받는다. 섀시가 3D(robot.colliders 칸이
// 있음)면 평면 프리즘 행은 없다. 형상이 없는 세계는 5 전의 연산 그대로다(기준 해시 일곱).
//
// 엔코더 속도(모터 포트의 velocity, 데드휠 포함): 허브 펌웨어처럼 지난 50 ms 동안의 원시 틱 변화 × 20이다(encoderVelocity.ts:
// 늘 20 틱/s의 배수, 약 25 ms 늦음, 처음 50 ms는 시작 position부터 셈). 원시 틱은 하위 단계마다 기록한다.
//
// 풀이가 실패하면(LCP가 수렴하지 않음 등, Articulation은 상태를 바꾸기 전에 던진다) 그 하위 단계의 모든 속도를 0으로 하고 위치는
// 그대로 둔 채 다음 하위 단계에서 다시 푼다(worldError, 같은 detail은 실행마다 한 번).
// 관절 하위의 센서(IMU·OTOS·데드휠·Pinpoint)는 섀시에 붙은 것으로 계산한다(3b 한계, 렌더러가 경고한다).
//
// 거리·컬러 센서(spec-4c §1.7): 틱 경계 상태(그 틱까지 적분한 기저·관절 자세)에서 틱마다 한 번 몸체 틀을 만들고
// (fieldSensors.ts) 시즌 필드 기본형에 광선을 쏴서 칩 원래 값을 보낸다. 하위 단계에서는 계산하지 않는다(칩 측정 주기 33 ms·
// 100 ms보다 훨씬 짧은 5 ms 틱이라 충분하다). 관절 하위 센서는 관절 몸체에 붙는다. 센서가 없으면 아무것도 넣지 않아 기존
// 입력열이 바이트 그대로다. 자기 로봇 형상은 광선을 가리지 않는다(시뮬레이터에 로봇 형상이 없다, 렌더러가 경고한다).
//
// 움직이는 경기 요소(6a, spec-6a §1): 세계 설명에 elements가 있을 때만 공(elements/elementWorld.ts)을 만든다. 공은 관절 나무 밖의
// 6자유도 몸체이고 같은 하위 단계 격자에서 돈다. 로봇에 닿은 공의 행은 몸체 충돌 행 뒤에 붙여(blocked 거르기 뒤: 공은 blocked를
// 켜지 않는다) art.step이 Schur 보수로 함께 풀고, 나머지 공 섬은 그 뒤에 따로 푼다. 동역학이 없는 로봇이면 공만 하위 단계를 돈다.
// elements가 없으면 공 코드가 하나도 돌지 않아 6 전의 연산 그대로다(기준 해시 여덟).

export const SUBSTEP_NANOS = 1_000_000
// 한 번에 이보다 많은 하위 단계로 나누지 않는다(아주 긴 구간은 하위 단계가 1 ms보다 길어진다)
const MAX_SUBSTEPS = 10_000
// OTOS 가속도 레지스터 범위: SparkFun OTOS 드라이버의 int16 변환이 선가속 ±16 g, 각가속 ±1000π rad/s²다
// (sidecar/sdk/com/qualcomm/hardware/sparkfun/SparkFunOTOS.java:119-141의 MPSS_TO_INT16 = 32768 / (16·9.80665),
// RPSS_TO_INT16 = 32768 / (π·1000), 칩 흉내 OtosChip.java:50의 int16 포화). 동역학에서는 벽 충돌 하위 단계에 수십 g가
// 나오므로 칩처럼 그 범위로 자른다(spec-3c §1.8).
const OTOS_MAX_LINEAR_ACCEL = 16 * GRAVITY
const OTOS_MAX_ANGULAR_ACCEL = 1000 * Math.PI
// 하위 단계 하나의 포드 이동이 이보다 작으면(틱) 반올림 잡음으로 보고 세지 않는다. 가정: 동역학 풀이의 좌우 비대칭 반올림이
// 곧게 달리는 로봇에 1e-16 m 수준의 옆 이동을 남기는데, 그것을 floor가 −1틱으로 세지 않게 한다(1e-9틱/ms는 1e-6틱/s라 실제
// 이동으로는 보이지 않는다).
const POD_NOISE_TICKS = 1e-9

type Notice = { code: SimNoticeCode; params: Record<string, string> }

type DeadWheel = {
  spec: SimDeadWheelSpec
  // 원시 허브 틱(소수)과 허브 속도 측정
  raw: number
  hubVelocity: HubVelocityWindow
}

// 모터 하나의 동역학 상태. 좌표(관절 φ·바퀴 φ·자유 좌표)를 Articulation이 가진다.
type DynamicMotor = {
  // Articulation 좌표 순번
  coordinate: number
  dc: DcGearMotor
  // 출력축 1 rad의 엔코더 틱(관절 모터는 3b 규칙, 바퀴·자유 모터는 SDK 규칙)
  ticksPerRad: number
  controller: HubMotorController
  // 제어기가 보는 축 엔코더의 50 ms 창(포드와 포트를 함께 써도 펌웨어는 축 엔코더로 돈다고 가정한다)
  control: HubVelocityWindow
  // 이번 구간의 사이드카 출력
  out: MotorOutputs
  velocityPidf: [number, number, number, number]
  positionPidf: [number, number, number, number]
  // 이번 하위 단계의 전력단("앞" 부호)
  stage: PowerStage
  // 원시 허브 틱(소수, 축 엔코더)
  raw: number
  // 단자 전류 크기(A)
  current: number
}

// 서보·CR 서보로 구동하는 관절 하나(관절 좌표 z = q)
type JointServo = {
  coordinate: number
  device: string
  // 서보 출력축 rad당 관절 rad 또는 m(부호 포함)
  ratio: number
  params: SimServoParams
  continuous: boolean
  // 편집 자세의 펄스(위치 서보)와 +펄스의 관절 방향(servoCommand)
  zeroPulseUs: number
  direction: 1 | -1
  command: ServoCommand
}

type Motor = {
  spec: SimMotorSpec
  dyn: DynamicMotor
  // 허브 각 → 모터 좌표("앞") 부호
  forwardSign: number
  // 같은 장치 이름의 데드휠(실제 배선: 그 포트의 엔코더는 포드다)
  pod: DeadWheel | null
  // 축 엔코더의 허브 속도 측정(포드와 포트를 함께 쓰면 포드의 것을 보내므로 없다)
  hubVelocity: HubVelocityWindow | null
  // RUN_TO_POSITION의 원시 목표를 만드는 기준(축 틱). 포드와 포트를 함께 쓰지 않으면 encoderOffset 그대로다.
  shaftOffset: number
  // 지난 구간에 본 사이드카의 리셋 횟수(encoderResets)
  lastEncoderResets: number
}

type Pinpoint = {
  spec: SimPinpointSpec
  // 원시 포드 틱(소수, 방향 적용 전)
  encX: number
  encY: number
  // 펌웨어가 적분한 자세(mm, 전원 켠 뒤 틀: X 앞·Y 왼쪽)와 앞 틱의 값(속도)
  x: number
  y: number
  xAtTick: number
  yAtTick: number
}

type Otos = {
  spec: SimOtosSpec
  // 물리 센서 틀(로봇 좌표): 위치 + (장착 각 − 90°). SDK 샘플 축(X 오른쪽·Y 앞)이 로봇 X 앞·Y 왼쪽에서 −90°다.
  mount: Pose2
  // 전원을 켤 때(실행 시작, 로봇 시작 자세)의 센서 자세(필드)
  sensorAtStart: Pose2
  // 앞 틱의 센서 자세(필드)와 원시 속도(가속도)
  sensorAtTick: Pose2
  velocity: { vx: number; vy: number; vh: number }
}

// 장치 → 키 → 값. null은 거리 센서의 범위 밖(칩 8190 mm)이다(입력이 합쳐지므로 키를 빼지 않고 null을 보낸다). 문자열은
// 웹캠 model, 숫자 배열은 웹캠 tags(4d, sidecarProtocol isTagsInput)다.
type InputValue = number | boolean | null | string | readonly number[]
type State = Map<string, Map<string, InputValue>>

// 보낸 값과 같은지: 수·불·null·문자열은 ===, 배열은 길이와 원소 ===(배열 원소의 −0은 JSON이 0으로 쓰므로 정규화하지 않는다)
function sameInput(a: InputValue | undefined, b: InputValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  return a === b
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const clamp = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value))

// 장치 이름으로 출력을 찾는다(자기 속성만: 이름이 '__proto__'여도 프로토타입을 읽지 않게)
function own(outputs: Record<string, DeviceValues>, device: string): DeviceValues | undefined {
  return Object.prototype.hasOwnProperty.call(outputs, device) ? outputs[device] : undefined
}

// 시험·맞춤용 물리 값 덮어쓰기(제품 코드는 쓰지 않는다: wheelData.ts 값 그대로)
export type PhysicsWorldOptions = {
  // 롤러 자유 방향 점성(s/m, ROLLER_VISCOUS)과 쿨롱 계수(ROLLER_COULOMB)
  rollerViscous?: number
  rollerCoulomb?: number
  // 굴림 저항 계수(ROLLING_RESISTANCE)
  rollingResistance?: number
  // 시즌 필드(시험 전용: 구조물을 뺀 판 등). 없으면 resolveSeason(spec.field.season)
  field?: FieldSpec
  // 거리·컬러 센서 모델(시험 전용: 비유한 값 방어 시험 이중). 없으면 rangeSensor.ts·colorSensor.ts
  sensorModels?: SensorModels
  // 경기 요소(시험 전용: 시작 상태·공기·잠들기 덮어쓰기, 6d 이어 가기의 이음새). 세계 설명에 elements가 있어야 쓴다
  elements?: ElementWorldOptions
}

// src/main/sidecar/world.ts의 SimWorld를 구조적으로 구현한다(shared는 main을 가져오지 않는다. 형식 확인은 그 파일의
// simulationWorld가 한다).
export class PhysicsWorld {
  private readonly spec: WorldSpec
  private readonly motors: Motor[]
  private readonly deadWheels: DeadWheel[]
  private readonly pinpoints: Pinpoint[]
  private readonly otos: Otos[]
  // 동역학(모터·관절·바퀴가 하나도 없으면 null: 아무것도 움직이지 않는다)
  private readonly articulation: Articulation | null
  private readonly servos: JointServo[]
  // 바퀴 접촉(spec.wheels 순서). 비어 있으면 기저가 고정이다.
  private readonly wheels: WheelContact[]
  // 이번 하위 단계의 바퀴 법선 하중(N)
  private loads: number[]
  private readonly support = new SupportMonitor()
  private readonly roller: RollerResistance
  private readonly rollingResistance: number
  // 시즌 벽 반폭과 solid 구조물 단면(생성자에서 한 번, 로봇 높이 spec.robot.height의 [0, H] 슬랩), 구조물 기준 면 기억
  private readonly collision: FieldCollision
  private readonly structureState: StructureContactState
  // 거리·컬러 센서(하나라도 있을 때만)
  private readonly sensors: FieldSensors | null
  // 웹캠(하나라도 있을 때만, 4d)
  private readonly cameras: FieldCameras | null
  // 몸체 충돌(5: 충돌 형상이 있고 동역학이 있을 때만)
  private readonly bodyCollision: BodyCollision | null
  // 움직이는 경기 요소(6a: 세계 설명에 elements가 있을 때만)
  private readonly elements: ElementWorld | null
  // 다음 허브 제어 표본 시각(ns)
  private nextSample = 0

  private tPrev: number | null = null
  private outputsPrev: Record<string, DeviceValues> = {}
  private poseNow: Pose2
  private blocked = false
  private readonly sent: State = new Map()
  private readonly notices: Notice[] = []
  private readonly noticeKeys = new Set<string>()

  constructor(spec: WorldSpec, options: PhysicsWorldOptions = {}) {
    this.spec = spec
    this.roller = {
      viscous: options.rollerViscous ?? ROLLER_RESISTANCE.viscous,
      coulomb: options.rollerCoulomb ?? ROLLER_RESISTANCE.coulomb
    }
    this.rollingResistance = options.rollingResistance ?? ROLLING_RESISTANCE
    const field = options.field ?? resolveSeason(spec.field.season)
    this.collision = fieldCollision(field, spec.robot.height)
    this.sensors =
      spec.distanceSensors.length > 0 || spec.colorSensors.length > 0
        ? new FieldSensors(
            field,
            spec.distanceSensors,
            spec.colorSensors,
            spec.noise,
            options.sensorModels
          )
        : null
    // 웹캠은 HIVE 상태(세계 설명 field.hiveTipped)로 태그 자세를 한 번 푼다(4ab FieldSpec을 같이 쓴다)
    this.cameras =
      spec.cameras.length > 0
        ? new FieldCameras(field, spec.field.hiveTipped, spec.cameras, spec.noise)
        : null
    this.structureState = structureContactState(this.collision)
    this.poseNow = { ...spec.robot.start }
    this.deadWheels = spec.deadWheels.map((d) => ({
      spec: d,
      raw: 0,
      hubVelocity: new HubVelocityWindow()
    }))
    const podByName = new Map<string, DeadWheel>()
    for (const pod of this.deadWheels) podByName.set(pod.spec.device, pod)
    // 관절에 묶이지 않은 좌표의 armature: 관절 모터가 아닌 모터마다 회전자 반사 관성 + 그 모터가 구동하는 바퀴의 회전 관성(외부
    // 감속비 제곱으로 나눔), 그다음 구동하지 않는 바퀴마다 그 바퀴의 회전 관성(spec.motors 순서, spec.wheels 순서)
    const jointDevices = new Set<string>()
    for (const joint of spec.joints)
      if (joint.drive.kind === 'motor')
        for (const device of joint.drive.devices) jointDevices.add(device)
    const free: number[] = []
    const freeOfMotor = spec.motors.map((m) => {
      if (jointDevices.has(m.device)) return -1
      const p = m.params
      let inertia = p.rotorInertia * p.gearbox * p.gearbox
      for (const w of spec.wheels)
        if (w.motor === m.device) inertia += w.spinInertia / (w.gearRatio * w.gearRatio)
      free.push(inertia)
      return free.length - 1
    })
    const freeOfWheel = spec.wheels.map((w) => {
      if (w.motor !== null) return -1
      free.push(w.spinInertia)
      return free.length - 1
    })
    const floating = spec.wheels.length > 0
    this.articulation =
      spec.joints.length > 0 || free.length > 0
        ? new Articulation(spec.joints, {
            base: floating ? { body: spec.robot.body, start: spec.robot.start } : undefined,
            free,
            loadFilterTau: LOAD_FILTER_TAU
          })
        : null
    const art = this.articulation
    // 움직이는 것이 없으면(동역학 없음) 몸체 충돌도 없다
    this.bodyCollision = bodyCollisionNeeded(spec) && art ? new BodyCollision(spec, field) : null
    this.elements = spec.elements ? new ElementWorld(spec, field, options.elements) : null
    // 관절 모터 장치 → (좌표, 기어모터 값). parseWorldSpec가 한 모터를 한 관절에만 두고 바퀴와 겹치지 않음을 확인한다.
    const jointMotors = new Map<string, { coordinate: number; dc: DcGearMotor }>()
    this.servos = []
    art?.coordinates.forEach((coordinate, index) => {
      if (coordinate.joint < 0) return
      const drive = spec.joints[coordinate.joint].drive
      if (coordinate.kind === 'motor' && drive.kind === 'motor') {
        const dc = new DcGearMotor(drive.params)
        for (const device of drive.devices) jointMotors.set(device, { coordinate: index, dc })
      } else if (drive.kind === 'servo' || drive.kind === 'crServo') {
        this.servos.push({
          coordinate: index,
          device: drive.device,
          ratio: drive.ratio,
          params: drive.params,
          continuous: drive.kind === 'crServo',
          zeroPulseUs: drive.kind === 'servo' ? drive.zeroPulseUs : SERVO_CENTER_US,
          direction: drive.direction,
          command: { kind: 'limp' }
        })
      }
    })
    this.motors = spec.motors.map((m, i) => {
      const pod = podByName.get(m.device) ?? null
      const hubVelocity = pod ? null : new HubVelocityWindow()
      const driven = jointMotors.get(m.device)
      const dc = driven ? driven.dc : new DcGearMotor(m.params)
      const coordinate = driven
        ? driven.coordinate
        : (art as Articulation).freeCoordinates[freeOfMotor[i]]
      const ticksPerRev = driven
        ? jointEncoderTicksPerOutputRev(m.modelTag, dc.gearbox)
        : ticksPerOutputRev(motorType(m.modelTag), m.gearbox)
      return {
        spec: m,
        forwardSign: rotationSign(motorType(m.modelTag)) * m.directionSign,
        pod,
        hubVelocity,
        shaftOffset: 0,
        lastEncoderResets: 0,
        dyn: {
          coordinate,
          dc,
          ticksPerRad: ticksPerRev / (2 * Math.PI),
          controller: new HubMotorController(),
          control: hubVelocity ?? new HubVelocityWindow(),
          out: readMotorOutputs(undefined),
          velocityPidf: DEFAULT_VELOCITY_PIDF,
          positionPidf: DEFAULT_POSITION_PIDF,
          stage: FLOAT,
          raw: 0,
          current: 0
        }
      }
    })
    this.wheels = spec.wheels.map((w, i) => {
      if (w.motor === null)
        return wheelContact(
          w,
          (art as Articulation).freeCoordinates[freeOfWheel[i]],
          false,
          this.roller.coulomb
        )
      const motor = this.motors.find((m) => m.spec.device === w.motor) as Motor
      return wheelContact(w, motor.dyn.coordinate, true, this.roller.coulomb)
    })
    this.loads = spec.wheels.map(() => 0)
    this.pinpoints = spec.pinpoints.map((p) => ({
      spec: p,
      encX: 0,
      encY: 0,
      x: 0,
      y: 0,
      xAtTick: 0,
      yAtTick: 0
    }))
    this.otos = spec.otos.map((o) => {
      const mount = { x: o.position.x, y: o.position.y, yaw: o.mountingAngle - Math.PI / 2 }
      const sensor = compose(spec.robot.start, mount)
      return {
        spec: o,
        mount,
        sensorAtStart: sensor,
        sensorAtTick: sensor,
        velocity: { vx: 0, vy: 0, vh: 0 }
      }
    })
  }

  step(tNanos: number, outputs: Record<string, DeviceValues>): Record<string, DeviceValues> {
    const first = this.tPrev === null
    // 갱신 전 앞 틱 시각(웹캠 프레임 격자, 첫 step이면 null). 아래에서 this.tPrev를 이 틱으로 바꾼다
    const tPrevBefore = this.tPrev
    const dtNanos = first ? 0 : tNanos - (this.tPrev as number)
    this.blocked = false
    if (dtNanos > 0) this.integrate(this.tPrev as number, dtNanos)
    if (first) {
      this.recordEncoders(tNanos)
      this.nextSample = Math.ceil(tNanos / HUB_CONTROL_PERIOD_NANOS) * HUB_CONTROL_PERIOD_NANOS
    }
    if (dtNanos > 0 || first) this.tPrev = tNanos
    this.checkSharedPorts(outputs)
    this.outputsPrev = outputs
    return this.changed(this.inputs(Math.max(0, dtNanos) / 1e9, tNanos, tPrevBefore), first)
  }

  pose(): SimPose {
    const pose: SimPose = {
      x: this.poseNow.x,
      y: this.poseNow.y,
      yaw: this.poseNow.yaw,
      blocked: this.blocked
    }
    if (this.articulation && this.spec.joints.length > 0) pose.joints = this.articulation.q()
    return pose
  }

  // 경기 요소 표시 상태(6a, spec-6a §5: 공마다 줄인 자세 7칸과 표식, revision은 틱 끝에 줄인 값·표식이 바뀔 때만 늚). 세계
  // 설명에 경기 요소가 없으면 null
  gameState(): GameState | null {
    return this.elements ? this.elements.gameState() : null
  }

  // 경기 요소의 전체 정밀도 상태(6a, 6d AUTO → TELEOP 이어 가기·시험). 세계 설명에 경기 요소가 없으면 null
  elementSnapshot(): SimElementState[] | null {
    return this.elements ? this.elements.snapshot() : null
  }

  // 경기 요소의 구 층(6c 센서·카메라 이음새). 없으면 null
  elementTickState(): ReturnType<ElementWorld['tickState']> | null {
    return this.elements ? this.elements.tickState() : null
  }

  // 이번 하위 단계의 바퀴 법선 하중(N, spec.wheels 순서, 시험·표시용)
  supportLoads(): readonly number[] {
    return this.loads.slice()
  }

  drainNotices(): Notice[] {
    return this.notices.splice(0, this.notices.length)
  }

  // ---- 적분 ----

  // [tStart, tStart + dtNanos] 구간
  private integrate(tStart: number, dtNanos: number): void {
    const voltage = this.spec.batteryVoltage
    for (const motor of this.motors) {
      const values = own(this.outputsPrev, motor.spec.device)
      const out = readMotorOutputs(values)
      // 포드와 포트를 함께 쓰면 사이드카의 encoderOffset은 포드 틱이다. 시뮬레이터는 축 엔코더로 제어하므로 리셋을
      // 본 때(사이드카의 리셋 횟수가 바뀐 때)의 축 틱을 기준으로 삼는다. 포드가 그대로면 encoderOffset도 그대로이고,
      // 한 루프에서 리셋 → RUN_TO_POSITION을 하면 틱 경계가 STOP_AND_RESET_ENCODER 모드를 보지 못할 수 있다.
      if (motor.pod) {
        if (out.encoderResets !== motor.lastEncoderResets)
          motor.shaftOffset = Math.floor(motor.dyn.raw)
      } else {
        motor.shaftOffset = out.encoderOffset
      }
      motor.lastEncoderResets = out.encoderResets
      motor.dyn.out = out
      motor.dyn.velocityPidf = readPidf(values, 'velocityPidf', DEFAULT_VELOCITY_PIDF)
      motor.dyn.positionPidf = readPidf(values, 'positionPidf', DEFAULT_POSITION_PIDF)
    }
    for (const servo of this.servos)
      servo.command = servoCommand(
        own(this.outputsPrev, servo.device),
        servo.params,
        servo.continuous,
        servo.zeroPulseUs,
        servo.direction
      )
    const { starts, ends, hs } = gridSubsteps(tStart, dtNanos)
    for (let s = 0; s < hs.length; s++) {
      if (this.articulation) this.substep(this.articulation, starts[s], hs[s], voltage, ends[s])
      else if (this.elements) this.elementSubstep(this.elements, hs[s], ends[s])
      this.recordEncoders(ends[s])
    }
    if (this.articulation) this.motorCurrents(this.articulation, voltage)
    const elements = this.elements
    if (elements) {
      // 틱 경계: 나간 공 다시 넣기(지금 로봇 자세·충돌체를 피한다)와 표시 상태
      const art = this.articulation
      elements.tick(tStart + dtNanos, {
        pose: this.poseNow,
        frames: () => (art ? art.contactFrames() : null),
        floating: art !== null && art.basePose() !== null
      })
      elements.updateDisplay()
      this.drainElements(elements)
    }
  }

  // 동역학이 없는 로봇의 하위 단계: 공만(로봇은 시작 자세의 정적 섀시)
  private elementSubstep(elements: ElementWorld, h: number, tEnd: number): void {
    try {
      elements.prepare(null, null, h)
    } catch (error) {
      this.notify('worldError', { detail: error instanceof Error ? error.message : String(error) })
    }
    elements.finish(null, h, false, tEnd)
    this.drainElements(elements)
  }

  private drainElements(elements: ElementWorld): void {
    for (const notice of elements.drainNotices()) this.notify(notice.code, notice.params)
  }

  // 하위 단계 하나: 표본 시각이면 허브 제어기를 돌리고, 전력단·서보 명령·바퀴 하중으로 동역학을 h만큼 푼 뒤 원시 틱과
  // 오도메트리를 센다
  private substep(art: Articulation, t: number, h: number, voltage: number, tEnd: number): void {
    if (t >= this.nextSample) {
      this.nextSample = (Math.floor(t / HUB_CONTROL_PERIOD_NANOS) + 1) * HUB_CONTROL_PERIOD_NANOS
      for (const motor of this.motors) {
        const dm = motor.dyn
        dm.controller.sample({
          out: dm.out,
          velocityPidf: dm.velocityPidf,
          positionPidf: dm.positionPidf,
          position: Math.floor(dm.raw),
          velocity: dm.control.ticksPerSecond(),
          rawTarget:
            dm.out.targetPosition === null ? null : dm.out.targetPosition + motor.shaftOffset
        })
      }
    }
    for (const motor of this.motors) {
      const dm = motor.dyn
      const stage = dm.controller.stage(dm.out)
      dm.stage =
        stage.kind === 'duty' ? { kind: 'duty', duty: stage.duty * motor.forwardSign } : stage
    }
    const from = art.basePose()
    let blocking: ContactRow[] = []
    let contacts: ContactSet | undefined
    if (from) {
      contacts = this.contacts(art, from, h)
      blocking = contacts.rows.filter(isBlockingNormal)
    }
    const elements = this.elements
    try {
      // 몸체 충돌 행은 art.step과 같은 try 안에서 만든다(껍질·NaN 버그로 던져도 아래 복구를 쓴다, C-M10). 바퀴·벽 행 뒤에 붙이고,
      // blocked는 섀시–정적 법선 행만 센다(관절 몸체·자기 충돌 행은 세지 않는다, spec-5 §1.1)
      const collision = this.bodyCollision
      // 접촉 틀은 몸체 충돌과 공이 같이 쓴다(한 번만 계산한다. 순수 함수라 따로 부른 것과 같은 값이다)
      const frames: ContactFrames | null = collision || elements ? art.contactFrames() : null
      if (collision) {
        const made = collision.rows(art, h, art.coordinates.length, frames as ContactFrames)
        for (const notice of made.notices) this.notify(notice.code, notice.params)
        if (made.rows.length > 0)
          contacts = contacts
            ? { rows: [...contacts.rows, ...made.rows], damping: contacts.damping }
            : { rows: made.rows, damping: [] }
        blocking = [...blocking, ...made.blocking]
      }
      // 공 행(6a)은 몸체 충돌 행 뒤, blocked 거르기 뒤에 붙인다(공은 blocked를 켜지 않는다)
      if (elements) {
        const made = elements.prepare(art, frames, h)
        if (made.rows.length > 0)
          contacts = contacts
            ? {
                rows: [...contacts.rows, ...made.rows],
                damping: contacts.damping,
                elements: made.coupled
              }
            : { rows: made.rows, damping: [], elements: made.coupled }
      }
      art.step(h, (z, v) => this.driveForces(z, v, voltage), contacts)
      if (collision) for (const n of collision.afterStep(art, h)) this.notify(n.code, n.params)
    } catch (error) {
      // 수치가 터지면(Articulation은 상태를 바꾸기 전에 던진다) 이 하위 단계는 모든 속도를 0으로 두고 위치는 그대로 둔다.
      // 다음 하위 단계에서 다시 푼다(같은 detail은 실행마다 한 번 알린다). 로봇 섬에 묶인 공도 속도 0이고, 다른 공 섬은 그대로
      // 푼다(spec-6a §2.7)
      art.v.fill(0)
      this.notify('worldError', { detail: error instanceof Error ? error.message : String(error) })
      if (elements) {
        elements.finish(art, h, true, tEnd)
        this.drainElements(elements)
      }
      return
    }
    if (elements) {
      elements.finish(art, h, false, tEnd)
      this.drainElements(elements)
    }
    for (const motor of this.motors) {
      const dm = motor.dyn
      dm.raw = motor.forwardSign * dm.ticksPerRad * art.z[dm.coordinate]
    }
    const to = art.basePose()
    if (from && to) {
      this.moveRobot(from, to)
      if (blocking.some((row) => art.contactImpulse(row.key) > 0)) this.blocked = true
    }
  }

  // 이번 하위 단계의 바퀴 하중(걸러진 가속의 기저 렌치를 나눔)·받침 알림·바퀴 행·벽 행·고정 구조물 행(벽 행 뒤에만 붙인다:
  // 'none' 시즌은 구조물이 0개라 행 목록이 3c와 원소 단위로 같다). 섀시가 3D 경로면(robot.colliders 칸이 있음, 5) 벽·구조물 행은
  // 몸체 충돌(bodyCollision.ts)이 맡고 여기서는 바퀴 행만이다
  private contacts(art: Articulation, pose: Pose2, h: number): ContactSet {
    const m = art.coordinates.length
    const wrench = art.baseWrench() as { fz: number; mx: number; my: number }
    const result = wheelLoads(this.wheels, wrench)
    this.loads = result.loads
    const alerts = this.support.update(result, wrench.fz, h)
    if (alerts.wheelLift) this.notify('wheelLift', {})
    if (alerts.tipping) this.notify('tipping', {})
    const wheel = wheelRows(this.wheels, this.loads, pose.yaw, h, m, this.roller)
    if (this.spec.robot.colliders !== undefined) return wheel
    const velocity = art.baseVelocity() as { vx: number; vy: number; omega: number }
    const footprint = this.spec.robot.footprint
    const walls = wallRows(footprint, pose, velocity, h, m, this.collision.innerHalf)
    const structures = structureRows(
      this.collision,
      footprint,
      pose,
      velocity,
      h,
      m,
      this.structureState
    )
    return { rows: [...wheel.rows, ...walls, ...structures], damping: wheel.damping }
  }

  // 좌표마다 구동 힘(모터: 전기 토크 + 기어 손실·마찰 상자, 바퀴 좌표: 굴림 저항·베어링 마찰 상자, 서보: PD·포화·풀림)
  private driveForces(z: readonly number[], v: readonly number[], voltage: number): DriveForces {
    const m = z.length
    const forces: DriveForces = {
      force: new Array<number>(m).fill(0),
      damping: new Array<number>(m).fill(0),
      stiffness: new Array<number>(m).fill(0),
      boxLo: new Array<number>(m).fill(0),
      boxHi: new Array<number>(m).fill(0),
      regions: ''
    }
    for (const motor of this.motors) {
      const dm = motor.dyn
      const c = dm.coordinate
      const dc = dm.dc
      const g = dc.gearbox
      const omega = v[c]
      const terms = dc.terms(dm.stage, voltage, omega)
      forces.force[c] += terms.force
      forces.damping[c] += terms.damping + g * g * dc.viscous
      // 모터가 미는 쪽으로 움직임을 막는 기어 손실(1 − η)·|τ|(한쪽 상자)와 모터축 쿨롱 마찰 G·τ_c(양쪽)
      const torque = terms.force - terms.damping * omega
      const loss = (1 - dc.efficiency) * Math.abs(torque)
      const coulomb = g * dc.coulomb
      forces.boxLo[c] -= coulomb + (torque > 0 ? loss : 0)
      forces.boxHi[c] += coulomb + (torque < 0 ? loss : 0)
      forces.regions += terms.region
    }
    this.wheels.forEach((wheel, i) => {
      const friction = wheelCoordinateFriction(wheel, this.loads[i], this.rollingResistance)
      forces.boxLo[wheel.coordinate] -= friction
      forces.boxHi[wheel.coordinate] += friction
    })
    for (const servo of this.servos) {
      const c = servo.coordinate
      const r = servo.ratio
      const terms = servoTerms(servo.command, servo.params, z[c] / r, v[c] / r)
      forces.force[c] += terms.force / r
      forces.damping[c] += terms.damping / (r * r)
      forces.stiffness[c] += terms.stiffness / (r * r)
      forces.boxLo[c] -= terms.friction / Math.abs(r)
      forces.boxHi[c] += terms.friction / Math.abs(r)
      forces.regions += terms.region
    }
    return forces
  }

  // 구간 끝의 단자 전류(크기). 허브 전류 측정(VNH5050 전류 감지)은 크기만 보고한다고 본다(가정).
  private motorCurrents(art: Articulation, voltage: number): void {
    for (const motor of this.motors) {
      const dm = motor.dyn
      dm.current = Math.abs(dm.dc.current(dm.stage, voltage, art.v[dm.coordinate]))
    }
  }

  // 하위 단계 끝(과 첫 틱)의 원시 엔코더 틱을 허브 속도 측정에 기록한다
  private recordEncoders(tNanos: number): void {
    for (const motor of this.motors) {
      const raw = motor.dyn.raw
      motor.hubVelocity?.record(tNanos, raw)
      // 포드와 포트를 함께 쓰는 모터는 제어기 창을 따로 둔다(아니면 hubVelocity와 같은 창이다)
      if (motor.dyn.control !== motor.hubVelocity) motor.dyn.control.record(tNanos, raw)
    }
    for (const pod of this.deadWheels) pod.hubVelocity.record(tNanos, pod.raw)
  }

  // 기저가 from에서 to로 움직였다: 실제 변위(로봇 좌표 twist)로 오도메트리를 센다
  private moveRobot(from: Pose2, to: Pose2): void {
    const actual = twistBetween(from, to)
    this.poseNow = to
    for (const pod of this.deadWheels)
      pod.raw += significant(
        podTravel(actual, pod.spec.position, pod.spec.measures) * podScale(pod.spec)
      )
    for (const pinpoint of this.pinpoints) this.pinpointStep(pinpoint, actual, from.yaw, to.yaw)
  }

  // Pinpoint 펌웨어: 포드 틱(정수, 팀이 정한 방향 적용)과 팀이 쓴 해상도·오프셋, 내장 IMU 요(진짜 요)로 추적점의 이동을
  // 전원 켠 뒤 틀(X 앞·Y 왼쪽, mm)에 적분한다. X 포드(옆 위치 xOffset, 왼쪽 +)는 앞 이동 − Δh·xOffset을,
  // Y 포드(앞 위치 yOffset)는 옆 이동 + Δh·yOffset을 재므로 그만큼 되돌린다. heading은 감지 않는다.
  // 팀이 해상도(ticksPerMm)를 아직 정하지 않았으면 x·y는 그대로 둔다(heading은 내장 IMU라 inputs가 따로 보낸다).
  private pinpointStep(p: Pinpoint, actual: Twist, yawFrom: number, yawTo: number): void {
    const scale = p.spec.podTicksPerMm * 1000
    const oldX = Math.floor(p.encX)
    const oldY = Math.floor(p.encY)
    if (p.spec.xPod)
      p.encX += significant(
        podTravel(actual, p.spec.xPod, 'forward') * scale * (p.spec.xReversed ? -1 : 1)
      )
    if (p.spec.yPod)
      p.encY += significant(
        podTravel(actual, p.spec.yPod, 'strafe') * scale * (p.spec.yReversed ? -1 : 1)
      )
    const out = own(this.outputsPrev, p.spec.device)
    const ticksPerMm = finite(out?.ticksPerMm, 0)
    if (!(ticksPerMm > 0)) return
    const xSign = out?.xDirection === 'REVERSED' ? -1 : 1
    const ySign = out?.yDirection === 'REVERSED' ? -1 : 1
    const podX = ((Math.floor(p.encX) - oldX) * xSign) / ticksPerMm
    const podY = ((Math.floor(p.encY) - oldY) * ySign) / ticksPerMm
    const start = this.spec.robot.start.yaw
    const h0 = yawFrom - start
    const h1 = yawTo - start
    const dh = h1 - h0
    const dx = podX + dh * finite(out?.xOffsetMm, 0)
    const dy = podY - dh * finite(out?.yOffsetMm, 0)
    const mid = (h0 + h1) / 2
    p.x += dx * Math.cos(mid) - dy * Math.sin(mid)
    p.y += dx * Math.sin(mid) + dy * Math.cos(mid)
  }

  // 데드휠과 포트를 함께 쓰는 모터를 엔코더 모드로 돌리면 한 번 알린다
  private checkSharedPorts(outputs: Record<string, DeviceValues>): void {
    for (const motor of this.motors) {
      if (!motor.pod) continue
      if (isEncoderMode(readMotorOutputs(own(outputs, motor.spec.device)).mode))
        this.notify('sharedEncoderMode', { device: motor.spec.device })
    }
  }

  private notify(code: SimNoticeCode, params: Record<string, string>): void {
    const key = JSON.stringify([code, params])
    if (this.noticeKeys.has(key)) return
    this.noticeKeys.add(key)
    this.notices.push({ code, params })
  }

  // ---- 입력 ----

  // 지금 상태의 모든 입력(장치 → 키 → 값). dt: 이번 구간(초, 첫 호출은 0), tNanos: 이 틱 경계 시각, tPrev: 앞 틱 경계
  // 시각(첫 step이면 null, 웹캠 프레임 격자).
  private inputs(dt: number, tNanos: number, tPrev: number | null): State {
    const state: State = new Map()
    const put = (device: string, key: string, value: InputValue): void => {
      let values = state.get(device)
      if (!values) {
        values = new Map()
        state.set(device, values)
      }
      values.set(key, value)
    }
    const rate = (now: number, then: number): number => (dt > 0 ? (now - then) / dt : 0)

    for (const hub of this.spec.hubs) put(hub, 'voltage', this.spec.batteryVoltage)

    for (const motor of this.motors) {
      // 포드와 포트를 함께 쓰면 그 포트의 엔코더는 포드다(아래)
      if (motor.hubVelocity) {
        put(motor.spec.device, 'position', Math.floor(motor.dyn.raw))
        put(motor.spec.device, 'velocity', motor.hubVelocity.ticksPerSecond())
      }
      put(motor.spec.device, 'current', motor.dyn.current)
    }
    for (const pod of this.deadWheels) {
      put(pod.spec.device, 'position', Math.floor(pod.raw))
      put(pod.spec.device, 'velocity', pod.hubVelocity.ticksPerSecond())
    }

    // 리밋 스위치: 그 끝에서 within 안이면 눌림. touch는 pressed true, digital은 state false(풀업 핀이 LOW)
    if (this.articulation && this.spec.joints.length > 0) {
      const q = this.articulation.q()
      this.spec.joints.forEach((joint, i) => {
        const limits = joint.limits
        if (!limits) return
        for (const s of joint.switches) {
          const pressed =
            s.at === 'lower' ? q[i] <= limits.lower + s.within : q[i] >= limits.upper - s.within
          if (s.kind === 'touch') put(s.device, 'pressed', pressed)
          else put(s.device, 'state', !pressed)
        }
      })
    }

    const start = this.spec.robot.start.yaw
    const yaw = this.poseNow.yaw - start
    // 요 속도: 기저의 지금 각속도(바퀴가 없으면 기저가 고정이라 0)
    const yawRate = this.articulation?.baseVelocity()?.omega ?? 0

    for (const p of this.pinpoints) {
      put(p.spec.device, 'x', p.x)
      put(p.spec.device, 'y', p.y)
      put(p.spec.device, 'heading', yaw)
      put(p.spec.device, 'vx', rate(p.x, p.xAtTick))
      put(p.spec.device, 'vy', rate(p.y, p.yAtTick))
      put(p.spec.device, 'headingVelocity', yawRate)
      put(p.spec.device, 'encoderX', Math.floor(p.encX))
      put(p.spec.device, 'encoderY', Math.floor(p.encY))
      p.xAtTick = p.x
      p.yAtTick = p.y
    }

    for (const o of this.otos) this.otosInputs(o, dt, put)

    for (const imu of this.spec.imus) {
      put(imu.device, 'yaw', wrapAngle(yaw))
      put(imu.device, 'pitch', 0)
      put(imu.device, 'roll', 0)
      put(imu.device, 'yawRate', yawRate)
      put(imu.device, 'pitchRate', 0)
      put(imu.device, 'rollRate', 0)
    }

    // 거리·컬러 센서는 IMU 뒤에, 웹캠은 그 뒤에 넣는다(장치 순서가 결과 객체 키 순서라 바뀌면 바이트가 바뀐다). 몸체 틀은
    // 둘이 같은 닫힘을 쓴다(관절 bodyPoses()를 틱마다 한 번만 푼다)
    if (this.sensors || this.cameras) {
      const frames = this.sensorFrames()
      const notify = (detail: string): void => this.notify('worldError', { detail })
      this.sensors?.read(frames, tNanos, put, notify)
      this.cameras?.read(frames, tPrev, tNanos, this.outputsPrev, put, notify)
    }
    return state
  }

  // 몸체 틀(필드 좌표, 틱 경계 상태): −1 섀시는 지금 자세(부유 기저면 기저 자세, 고정 기저·동역학 없음이면 시작 자세),
  // j ≥ 0은 관절 몸체(부유 기저면 Articulation이 필드 좌표로 주고, 고정 기저면 로봇 좌표라 시작 자세와 합성한다). 관절 몸체
  // 자세는 처음 쓸 때 한 번만 계산한다(parseWorldSpec가 body를 joints 순번 안으로 확인하므로 관절이 있으면 동역학이 있다)
  private sensorFrames(): (body: number) => Frame3 {
    const chassis = planarFrame(this.poseNow)
    let joints: Frame3[] | null = null
    return (body) => {
      if (body < 0) return chassis
      if (joints === null) {
        const art = this.articulation as Articulation
        const poses = art.bodyPoses()
        joints = art.basePose() !== null ? poses : poses.map((pose) => composeFrames(chassis, pose))
      }
      return joints[body]
    }
  }

  // OTOS: 물리 센서 틀 S와 팀이 쓴 오프셋 O(SDK 샘플 축)로 가상 로봇 틀 V = S∘O⁻¹, 원시 자세 = V(0)⁻¹∘V(t)
  // = O∘S(0)⁻¹∘S(t)∘O⁻¹. 오프셋이 SDK 샘플 규약(X 오른쪽·Y 앞)이든 Road Runner식(X 앞·Y 왼쪽, h = −90°)이든 그 틀의
  // 로봇 중심 자세가 된다. 속도·가속도는 원시 틀에서 틱 사이의 차이다.
  private otosInputs(
    o: Otos,
    dt: number,
    put: (device: string, key: string, value: number) => void
  ): void {
    const out = own(this.outputsPrev, o.spec.device)
    const offset: Pose2 = {
      x: finite(out?.offsetX, 0),
      y: finite(out?.offsetY, 0),
      yaw: finite(out?.offsetH, 0)
    }
    const sensor = compose(this.poseNow, o.mount)
    const relative = (s: Pose2): Pose2 =>
      compose(compose(offset, compose(inverse(o.sensorAtStart), s)), inverse(offset))
    const raw = relative(sensor)
    let velocity = { vx: 0, vy: 0, vh: 0 }
    if (dt > 0) {
      const before = relative(o.sensorAtTick)
      velocity = {
        vx: (raw.x - before.x) / dt,
        vy: (raw.y - before.y) / dt,
        vh: (raw.yaw - before.yaw) / dt
      }
    }
    const prev = o.velocity
    const device = o.spec.device
    put(device, 'x', raw.x)
    put(device, 'y', raw.y)
    put(device, 'h', raw.yaw)
    put(device, 'vx', velocity.vx)
    put(device, 'vy', velocity.vy)
    put(device, 'vh', velocity.vh)
    // 가속도는 칩 레지스터 범위로 자른다(OTOS_MAX_LINEAR_ACCEL)
    const accel = (now: number, then: number, limit: number): number =>
      dt > 0 ? clamp((now - then) / dt, limit) : 0
    put(device, 'ax', accel(velocity.vx, prev.vx, OTOS_MAX_LINEAR_ACCEL))
    put(device, 'ay', accel(velocity.vy, prev.vy, OTOS_MAX_LINEAR_ACCEL))
    put(device, 'ah', accel(velocity.vh, prev.vh, OTOS_MAX_ANGULAR_ACCEL))
    o.sensorAtTick = sensor
    o.velocity = velocity
  }

  // 지난번에 보낸 값과 다른 키만(첫 호출은 전부, null 포함). 유한하지 않은 값(과 그런 원소가 있는 배열)은 보내지 않는다.
  // null은 보내고 같은 null은 다시 보내지 않는다. 문자열·배열도 같으면 다시 보내지 않는다(같은 tags가 이어지면 frameNanos만
  // 간다. 사이드카는 받은 키만 바꾸므로 남은 tags가 그 프레임 값이다). 배열은 복사해 둔다. 장치 이름은 팀 구성에서 오므로
  // ('__proto__' 등) 객체 키로 바로 쓰지 않고 Object.fromEntries로 만든다.
  private changed(state: State, all: boolean): Record<string, DeviceValues> {
    const result: [string, DeviceValues][] = []
    for (const [device, values] of state) {
      let sent = this.sent.get(device)
      if (!sent) {
        sent = new Map()
        this.sent.set(device, sent)
      }
      const entries: [string, InputValue][] = []
      for (const [key, value] of values) {
        if (typeof value === 'number' && !Number.isFinite(value)) continue
        if (Array.isArray(value)) {
          if (!value.every((v) => Number.isFinite(v))) continue
          if (!all && sameInput(sent.get(key), value)) continue
          // 보낸 값과 기억은 따로 복사한다(받는 쪽이 배열을 바꿔도 다음 비교가 흔들리지 않게)
          sent.set(key, [...value])
          entries.push([key, [...value]])
          continue
        }
        // −0은 0으로(JSON은 같지만 비교를 단순하게)
        const v = value === 0 ? 0 : value
        if (!all && sameInput(sent.get(key), v)) continue
        sent.set(key, v)
        entries.push([key, v])
      }
      if (entries.length > 0) result.push([device, Object.fromEntries(entries)])
    }
    return Object.fromEntries(result)
  }
}

type Substeps = { starts: number[]; ends: number[]; hs: number[] }

// 하위 단계: 0 ns부터의 절대 격자(1 ms, 허브 제어 표본 10 ms를 포함)와 구간 끝에서 끊는다. 아주 긴 구간은
// MAX_SUBSTEPS를 넘지 않게 격자를 10배씩 넓힌다(그때 제어 표본은 격자를 지난 첫 하위 단계에서 뜬다).
function gridSubsteps(tStart: number, dtNanos: number): Substeps {
  const tEnd = tStart + dtNanos
  let cell = SUBSTEP_NANOS
  while (dtNanos / cell > MAX_SUBSTEPS - 2) cell *= 10
  const starts: number[] = [tStart]
  const ends: number[] = []
  for (let t = (Math.floor(tStart / cell) + 1) * cell; t < tEnd; t += cell) {
    ends.push(t)
    starts.push(t)
  }
  ends.push(tEnd)
  return { starts, ends, hs: starts.map((t, s) => (ends[s] - t) / 1e9) }
}

// 포드 접점이 잰 이동(m): 로봇 좌표 변위 ξ에서 그 점의 이동 성분. forward는 로봇 +X, strafe는 +Y(왼쪽).
// 점 p의 이동 = (dx − dθ·p_y, dy + dθ·p_x)(일정한 변위 동안 로봇 좌표에서 일정하다)
function podTravel(twist: Twist, p: Vec2, measures: 'forward' | 'strafe'): number {
  return measures === 'forward' ? twist.dx - twist.dTheta * p.y : twist.dy + twist.dTheta * p.x
}

// 포드 틱 증가(반올림 잡음 POD_NOISE_TICKS 아래는 0)
function significant(ticks: number): number {
  return Math.abs(ticks) < POD_NOISE_TICKS ? 0 : ticks
}

function podScale(spec: SimDeadWheelSpec): number {
  return spec.ticksPerMeter * (spec.reversed ? -1 : 1)
}
