// 시뮬레이터의 세계 설명(렌더러 → 메인). 렌더러가 INIT 때 씬에서 고른 로봇의 바퀴·모터·오도메트리를 이 모양으로
// 만들어 PlayInitRequest.world로 보내고, 메인의 PhysicsWorld(src/shared/sim/world.ts)가 틱마다 이것으로 센서 값을 만든다.
// 메인은 렌더러를 믿지 않고 parseWorldSpec으로 모양·유한 수·한도를 확인한다.
// 단위는 미터·라디안이다. 로봇 좌표는 X 앞·Y 왼쪽, 각은 반시계 +(로봇 위에서 볼 때). 필드 좌표는 원점 필드 중앙 타일 윗면,
// Z 위, 축은 시즌 공식 좌표계(seasons/, 'none' 시즌은 축의 뜻이 없고 타일 두께가 없어 바닥과 같은 평면).

import { isCameraModelId, type CameraModelId } from './cameraData'
import { symmetricEigen3 } from './drivetrain'
import { canonicalHull, HULL_MAX_COORD, MAX_HULL_POINTS } from './hull'
import type { SeasonId } from './seasons/fieldSpec'
import { isSeasonId } from './seasons/seasons'

// 4: 시즌 field({ season, hiveTipped }), robot.height, 거리·컬러 센서 목록(4c), 잡음(4c·4d)을 더함(spec-4ab §3)
// 5: 웹캠 cameras(4d)를 더함(spec-4d §3.1)
// 6: 3D 충돌 형상 robot.colliders·joints[i].colliders, 자기 충돌 무시 collisionIgnore(spec-5 §2.2). 셋 다 선택 칸이고,
//    없으면 5와 같은 경로(섀시 평면 프리즘, 관절 몸체는 충돌 없음)다.
export const WORLD_SPEC_VERSION = 6

// 한도(메인 검증)
export const MAX_WORLD_MOTORS = 64
export const MAX_WORLD_WHEELS = 32
export const MAX_WORLD_SENSORS = 32
// 웹캠 목록 한도 [결정: Control Hub USB 포트 둘(USB 2·3)과 허브를 넘는 수. 보통 1–2, spec-4d §3.1]
export const MAX_WORLD_CAMERAS = 4
export const MAX_FOOTPRINT_POINTS = 64
// 관절(3b, 메커니즘). FTC 로봇은 보통 2–8개(리프트 2–3단, 팔, 손목, 집게)
export const MAX_WORLD_JOINTS = 16
// 한 관절을 같이 구동하는 모터(양쪽 리프트 등)
export const MAX_JOINT_MOTORS = 4
// 서보 펄스(µs): 허브 서보 포트 출력 범위(REV Control Hub 서보 포트 사양 500–2500 µs, actuators.ts와 같다)
export const MIN_SERVO_PULSE_US = 500
export const MAX_SERVO_PULSE_US = 2500
// 몸체 하나의 충돌체 수, 세계 전체 충돌체 수 [결정: LCP·넓은 단계 비용, spec-5 부록 A], 무시 짝 수(몸체 17개 = 섀시 + 관절
// 16의 짝 17·16/2)
export const MAX_BODY_COLLIDERS = 16
export const MAX_WORLD_COLLIDERS = 64
export const MAX_COLLISION_IGNORE = 136
// 캡슐 반지름(m) [결정]·충돌체 마찰 한도 [결정: Unity Physics Material 칸과 같은 0 이상, FTC 재질에는 2면 넉넉하다]·기본
// 마찰. 렌더러 scene/collider.ts와 시뮬레이터 bodyCollision.ts가 여기서 가져간다(한곳, spec-5 C-H2)
export const MIN_CAPSULE_RADIUS = 5e-4
export const MAX_CAPSULE_RADIUS = 1
export const MAX_COLLIDER_FRICTION = 2
// [가정: 사용자 결정 11/10, 3c WALL_FRICTION(wheelData.ts)과 같다]
export const DEFAULT_COLLIDER_FRICTION = 0.4
// [가정: 사용자 결정 11/10, 타일 위 알루미늄·PLA, 실측 없음]
export const FLOOR_FRICTION = 0.4
// 상자 충돌체 크기 하한(m, 각 축). 세계 설명의 반 크기는 MIN_BOX_SIZE/2 이상이다(렌더러 scene/collider.ts가 다시 내보낸다)
// [결정: spec-5 §2.1]
export const MIN_BOX_SIZE = 1e-3
// 상자 회전 행렬 검사 공차(|RᵀR − I| 원소 최대, det > 0) [결정: three Matrix4 곱 사슬의 반올림 ~1e-15보다 넉넉히]
export const BOX_ROTATION_TOLERANCE = 1e-9

export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }
// 관성 행렬 성분 [Ixx, Iyy, Izz, Ixy, Ixz, Iyz](행렬 값 그대로, Ixy = −∫xy dm), kg·m²
export type SimInertia = [number, number, number, number, number, number]

// 필드 좌표의 로봇 자세(최상위 로봇 transform의 x·y와 요)
export type Pose2 = { x: number; y: number; yaw: number }

// 강체 하나의 질량 성질: 질량(kg), 무게중심(기준 틀), 무게중심 기준 관성(기준 틀의 축). 관절 몸체는 관절 틀, 섀시는 로봇 좌표다.
export type SimBody = { mass: number; centerOfMass: Vec3; inertia: SimInertia }

// 모터 하나(구성의 모터 장치). 바퀴든 메커니즘이든 모든 모터 컴포넌트가 들어간다(엔코더 값을 만들려고).
export type SimMotorSpec = {
  // 구성 이름(hardwareMap 이름 = 사이드카 장치 이름)
  device: string
  // 구성 XML 태그(hardware/catalog.ts의 MOTOR_MODEL_TAGS 값, 예: 'goBILDA5202SeriesMotor').
  // 형식의 ticksPerRev·gearing·maxRPM·회전 방향은 src/shared/sim/motorTypes.ts(사이드카 MotorConfigurationType과 같음).
  modelTag: string
  // 실제로 단 기어박스 감속비(예: goBILDA 312 RPM은 19.2). SDK 형식은 계열당 한 비만 알아서(5202 계열 99.5,
  // UltraPlanetary 20) 출력축 1회전 틱 = ticksPerRev ÷ gearing × gearbox, 무부하 출력축 RPM = maxRPM × gearing ÷ gearbox.
  gearbox: number
  // 인스펙터의 방향(생성 코드의 setDirection): forward 1, reverse −1. "+power면 바퀴가 앞으로 구르는 방향"으로 본다.
  directionSign: 1 | -1
  // 기어모터 물리 값(3c): 렌더러가 실제 감속비로 데이터시트 표에서 푼 값(play/worldJoints.ts motorComponentParams). 토크·
  // 전류·관성은 이것으로 계산하고, 엔코더 틱은 위 SDK 규칙(gearbox)으로 센다(감속비 칸이 0인 Core Hex 등은 둘이 다르다).
  // 관절 구동 모터는 관절 drive.params(3b)를 쓴다.
  params: SimMotorParams
}

export type WheelKind = 'mecanum' | 'omni' | 'traction'

// 메카넘 롤러 형(위에서 볼 때 롤러가 X를 이루는 표준 배치에서): flbr = 앞왼쪽·뒤오른쪽 자리의 바퀴,
// frbl = 앞오른쪽·뒤왼쪽 자리의 바퀴. 구동 방향은 flbr이 R(−45°)·u, frbl이 R(+45°)·u(u = 굴림 방향 단위 벡터).
export type MecanumRollers = 'flbr' | 'frbl'

export type SimWheelSpec = {
  // 바퀴 중심(로봇 좌표, 바닥 평면)
  position: Vec2
  // 굴림 방향(앞으로 구를 때 바퀴가 미는 방향)의 각, 로봇 +X 기준 반시계
  angle: number
  kind: WheelKind
  // 메카넘만(렌더러가 auto를 풀어서 보낸다), 나머지는 null
  rollers: MecanumRollers | null
  radius: number
  // 모터 출력축 → 바퀴 외부 감속비(> 0, 1이면 직결)
  gearRatio: number
  // 구동 모터의 장치 이름(motors 중 하나). null이면 구동하지 않는 바퀴(자유롭게 구른다)
  motor: string | null
  // kg·m², 바퀴 축 둘레 회전 관성(바퀴 쪽, 외부 감속 전. src/shared/sim/wheelData.ts wheelSpinInertia)
  spinInertia: number
  // 잠근 바퀴를 타일에서 끌 때의 겉보기 마찰 계수(제조사 표기 CoF, 정지 = 운동). 렌더러가 기본값을 풀어 넣는다
  // (wheelData.ts effectiveWheelFriction). 메카넘 롤러 축 계수는 √2·μ − ROLLER_COULOMB다(mecanumRollerFriction: 잠근 바퀴를
  // 끌 때 롤러 쿨롱 저항이 더해져도 겉보기 계수가 이 값과 같게).
  friction: number
}

// 데드휠(엔코더 포트의 오도메트리 포드). 장치 이름은 javaCodegen의 deadWheelDeviceName(같은 포트의 모터가 있으면 그 이름).
export type SimDeadWheelSpec = {
  device: string
  // 포드 바퀴 접점(로봇 좌표)
  position: Vec2
  // forward: 로봇 +X 이동을 잰다, strafe: 로봇 +Y(왼쪽) 이동을 잰다
  measures: 'forward' | 'strafe'
  // 원시 허브 틱이 반대로 센다(인스펙터 reversed, DcMotor 방향 적용 전)
  reversed: boolean
  ticksPerMeter: number
}

// goBILDA Pinpoint. 펌웨어처럼 포드 틱과 팀이 쓴 설정(ticksPerMm·방향·오프셋)으로 자세를 계산한다.
export type SimPinpointSpec = {
  device: string
  // X 포드(앞 이동을 잼)·Y 포드(왼쪽 이동을 잼)의 접점(로봇 좌표). 지정하지 않았으면 null(그 포드는 0)
  xPod: Vec2 | null
  yPod: Vec2 | null
  // 포드 실제 해상도(인스펙터 podType: fourBar 19.89436789, swingarm 13.26291192 틱/mm)
  podTicksPerMm: number
  // 원시 포드 틱이 반대로 센다(인스펙터 xDirection·yDirection이 reversed). setEncoderDirections를 인스펙터대로 하면 앞·왼쪽이 +.
  xReversed: boolean
  yReversed: boolean
}

// SparkFun OTOS. 물리 센서 틀 = 장착 위치 + 장착 각(SDK 샘플 축: X 오른쪽·Y 앞·반시계 +).
export type SimOtosSpec = {
  device: string
  position: Vec2
  // 인스펙터 mountingAngle(라디안, 반시계 +)
  mountingAngle: number
}

export type SimImuSpec = { device: string }

// 센서 장착(4c·4d). body −1 = 섀시(로봇 좌표), ≥ 0 = 그 관절 몸체(관절 틀, joints 순번).
// position: 그 몸체 틀의 하우징 앞면(광선 원점, spec-4c §1.2). 렌더러가 형상 경계 상자를 조준 축에 투영해 정하고,
// 형상을 모르면 피벗이다. rotation: ZYX이고 장치 +X가 보는 방향(광선 축), +Z가 광선 방위각의 기준이다.
export type SensorMount = { body: number; position: Vec3; rotation: Vec3 }
// device: 구성 이름을 Java String.trim과 같게 자른 사이드카 장치 이름(hardware/naming.ts sidecarDeviceName)
export type SimDistanceSensorSpec = { device: string; mount: SensorMount }
export type SimColorSensorSpec = { device: string; mount: SensorMount }
// 웹캠 하나(4d). device: 구성 이름을 Java trim한 장치 이름(구성 XML에 들어간 웹캠만: 시리얼이 있어야 구성에 들어간다).
// mount: 4c SensorMount 그대로(position = 렌즈 = 하우징 앞면, rotation ZYX, +X 광축, +Z 영상 위). model: 렌즈·SDK 보정의
// 카메라(cameraData.ts)
export type SimCameraSpec = { device: string; mount: SensorMount; model: CameraModelId }

// 충돌체 하나(5, 몸체 틀: 섀시는 로봇 좌표, 관절 몸체는 관절 틀, m). friction: [0, MAX_COLLIDER_FRICTION], 짝의 마찰은 두 면의
// 평균(Unity Friction Combine Average).
// convex: 볼록 껍질을 만들 점(메인이 hull.ts canonicalHull로 다시 만든다, 4–MAX_HULL_POINTS개, |좌표| ≤ HULL_MAX_COORD, 퇴화
//   아님). 렌더러가 보내는 점은 buildHull(…).vertices라 이미 0.1 mm 격자 위다
// box: 몸체 틀의 중심, 회전 행렬(행 우선 9개, 정규 직교·det > 0), 반 크기(각 ≥ MIN_BOX_SIZE/2). 정확한 상자 위상(boxHull,
//   양자화 없음)
// capsule: 선분 a–b와 반지름(|a − b| < MIN_CAPSULE_SEGMENT(collision3d.ts)면 구)
export type SimCollider =
  | { kind: 'convex'; points: Vec3[]; friction: number }
  | { kind: 'box'; center: Vec3; rotation: number[]; half: Vec3; friction: number }
  | { kind: 'capsule'; a: Vec3; b: Vec3; radius: number; friction: number }

// 무시할 몸체 짝 [a, b](−1 ≤ a < b < joints.length, −1 = 섀시). 바로 붙은 부모–자식은 적지 않아도 늘 무시한다
export type SimBodyPair = [number, number]

export type WorldSpec = {
  version: typeof WORLD_SPEC_VERSION
  // 시즌(메인이 seasons/resolveSeason으로 FieldSpec을 푼다, 렌더러가 보낸 형상은 받지 않는다)과 HIVE 상태 [빨강, 파랑]
  // (4d 카메라가 씀: 태그 필드 자세, seasons/tagPoses.ts)
  field: { season: SeasonId; hiveTipped: [boolean, boolean] }
  robot: {
    // 시작 자세(필드 좌표)
    start: Pose2
    // 바닥 외곽(로봇 좌표, 단순 볼록 반시계 다각형, 보통 사각형 4점). 필드 벽·구조물 접촉에 쓴다.
    footprint: Vec2[]
    // 높이(m): 편집 자세 CAD 경계 상자 꼭짓점 z의 최대값, CAD가 없으면 0.4572. 구조물 [0, H] 단면에 쓴다
    // [가정: 높이는 편집 자세 CAD 최대 z, 없으면 18 in]
    height: number
    // 섀시(로봇 전체 − 관절 몸체, 3a 질량 모델): 로봇 좌표, 무게중심 기준 관성. 늘 있고, 바퀴가 없는 세계는 기저가
    // 고정이라 쓰지 않는다(3c).
    body: SimBody
    // 섀시 충돌체(5, 로봇 좌표). 있으면(빈 배열도) 섀시는 3D 경로이고 footprint·height는 시뮬레이터 접촉에 쓰지 않는다(빈
    // 배열이면 섀시는 아무것과도 충돌하지 않는다). 없으면 지금의 평면 프리즘 경로다(spec-5 §1.4)
    colliders?: SimCollider[]
  }
  // 배터리 전압(V). 모터 무부하 속도 비율(전압 ÷ 12)과 허브 voltage 입력.
  batteryVoltage: number
  // 허브 장치 이름(구성의 LynxModule 이름: 'Control Hub', 'Expansion Hub 2' …), voltage 입력을 보낸다
  hubs: string[]
  motors: SimMotorSpec[]
  wheels: SimWheelSpec[]
  deadWheels: SimDeadWheelSpec[]
  pinpoints: SimPinpointSpec[]
  otos: SimOtosSpec[]
  imus: SimImuSpec[]
  // 메커니즘 관절(3b). 부모가 먼저 온다. 비면 관절이 없다.
  joints: SimJointSpec[]
  // 거리·컬러 센서(4c): 그 로봇의 distanceSensor·colorSensor 컴포넌트(하이어라키 순서, 이름이 비었거나 겹치거나 한도를
  // 넘은 것은 뺌). 시뮬레이터가 틱 경계마다 필드 기본형에 광선을 쏴서 거리 distance(m 또는 null)와 컬러 red·green·blue·
  // proximity(칩 원래 값)를 보낸다(spec-4c §1.7). 4ab는 늘 []였다.
  distanceSensors: SimDistanceSensorSpec[]
  colorSensors: SimColorSensorSpec[]
  // 센서 잡음(spec-4c §1.6): 켜면 거리 센서만 장치 고정 오프셋과 측정마다 잡음을 시드 해시로 더한다(같은 시드면 같은
  // 값). 컬러에는 잡음이 없다. 시드는 Hub 타이밍과 같은 실행 설정 칸이다.
  noise: { enabled: boolean; seed: number }
  // 웹캠(4d): 그 로봇의 구성에 들어간 webcam 컴포넌트(하이어라키 순서, 이름이 비었거나 겹치거나 한도를 넘은 것은 뺌).
  // 시뮬레이터가 30 fps 격자의 틱 경계에서 스트리밍 중인 웹캠의 자세로 태그 꼭짓점을 투영해 tags 입력을 보낸다
  // (spec-4d §1.5·§1.8). 4c까지는 없었다.
  cameras: SimCameraSpec[]
  // 자기 충돌에서 무시할 몸체 짝(5, 편집 자세에서 겹친 짝, 렌더러 빌더가 앞 계산). 없으면 바로 붙은 부모–자식만 무시한다
  collisionIgnore?: SimBodyPair[]
}

// ---- 관절(3b, spec-3b §4, Unity ArticulationBody 하나 = 관절 하나 = 움직이는 몸체 하나) ----

// 기어모터 하나의 물리 값(렌더러가 데이터시트 표에서 풀어 넣는다). 출력축 기준 토크·속도·전류, 모터축 기준 관성·마찰.
export type SimMotorParams = {
  // N·m, 12 V 정지 토크(출력축, 기어 효율 포함한 제조사 값)
  stallTorque: number
  // rad/s, 12 V 무부하 속도(출력축)
  freeSpeed: number
  // A
  stallCurrent: number
  freeCurrent: number
  // 모터축 → 출력축 감속비(실제 기어박스)
  gearbox: number
  // 0–1, 모터가 밀 때의 기어 효율
  efficiency: number
  // kg·m², 모터축 회전자 관성
  rotorInertia: number
  // N·m, 모터축 역구동 마찰(쿨롱)
  backdriveFriction: number
}

export type SimServoParams = {
  // N·m, 정지 토크(서보 출력축)
  stallTorque: number
  // rad/s, 무부하 속도
  freeSpeed: number
  // rad, SDK 기본 PWM 범위(600–2400 µs) 전체의 서보 각(CR 서보는 0)
  rangeAngle: number
  // µs
  deadbandUs: number
  // 내부 위치 제어 근사(N·m/rad, N·m·s/rad)
  kp: number
  kd: number
  // CR 서보가 최대 속도에 닿는 |power|(SDK 범위 기준), 위치 서보는 1
  crFullPower: number
  // N·m, PWM이 꺼졌을 때 남는 기어 마찰
  limpFriction: number
}

export type SimJointDriveSpec =
  | { kind: 'none' }
  // devices: motors의 장치 이름(1–MAX_JOINT_MOTORS). ratio: 회전 관절은 모터 출력축 rad당 관절 rad(부호 포함),
  // 직선 관절은 출력축 rad당 m(스풀 반지름 × 외부 감속). rigging: 다단 슬라이드(stages는 위 단 관절 순번, 아래에서 위)
  | {
      kind: 'motor'
      devices: string[]
      ratio: number
      params: SimMotorParams
      rigging: { kind: 'direct' } | { kind: 'cascade' | 'continuous'; stages: number[] }
    }
  // 서보: ratio는 서보 출력축 rad당 관절 rad 또는 m(양수), direction은 +펄스가 관절 +축(1)·−축(−1)으로 도는지,
  // zeroPulseUs는 편집 자세(q = 0)의 펄스(위치 서보만, 허브 출력 범위 500–2500 µs). CR 서보의 정지 펄스는 늘 1500 µs다.
  | {
      kind: 'servo'
      device: string
      ratio: number
      params: SimServoParams
      zeroPulseUs: number
      direction: 1 | -1
    }
  | { kind: 'crServo'; device: string; ratio: number; params: SimServoParams; direction: 1 | -1 }
  // 다단 슬라이드의 위 단(아래 단 구동의 rigging.stages에 들어 있다)
  | { kind: 'stage' }

export type SimJointSpec = {
  // 부모 관절 순번(자기보다 앞), −1이면 로봇(움직이지 않는 뿌리)
  parent: number
  type: 'revolute' | 'prismatic'
  // q = 0(편집 자세)의 관절 틀: 부모 몸체 틀 기준(부모가 로봇이면 로봇 좌표). 회전은 ZYX 오일러 rad
  origin: { position: Vec3; rotation: Vec3 }
  // 관절 틀의 단위 축(회전은 오른손 +, 직선은 그 방향 +)
  axis: Vec3
  // q = 0 기준(rad 또는 m). null이면 제한 없음(회전 관절만)
  limits: { lower: number; upper: number } | null
  // 이 관절 몸체만(안쪽 관절 몸체 제외)의 질량 성질, 관절 틀 기준
  body: SimBody
  // 관절 좌표 단위: 쿨롱(N·m 또는 N), 점성(N·m·s/rad 또는 N·s/m)
  friction: { coulomb: number; viscous: number }
  spring:
    | null
    | { kind: 'constantForce'; force: number }
    | { kind: 'linear'; stiffness: number; rest: number }
  drive: SimJointDriveSpec
  // 한계 근처에서 눌리는 리밋 스위치: touch는 pressed true, digital은 state false
  switches: { device: string; kind: 'touch' | 'digital'; at: 'lower' | 'upper'; within: number }[]
  // 이 몸체의 충돌체(5, 관절 틀). 없거나 비면 그 몸체는 충돌하지 않는다
  colliders?: SimCollider[]
}

// 시뮬레이터가 렌더러에 보이는 로봇 자세(필드 좌표). blocked: 이번 틱에 섀시가 필드 벽이나 고정 구조물에 막혔다(관절
// 몸체·자기 충돌은 세지 않는다).
// joints: 관절 순번 순 q(rad 또는 m). 관절이 없는 세계는 키를 넣지 않는다.
export type SimPose = { x: number; y: number; yaw: number; blocked: boolean; joints?: number[] }

// ---- 검증(메인이 렌더러에서 받은 값을 확인한다) ----

const MAX_NAME = 256
// 바퀴 회전 관성 한도(kg·m²): FTC 바퀴는 1e-4–1e-3(data §5.1), 넉넉히
const MAX_SPIN_INERTIA = 1
// 바퀴 겉보기 마찰 계수 범위(scene/wheel.ts 설정 범위와 같다)
export const MIN_WHEEL_FRICTION = 0.05
export const MAX_WHEEL_FRICTION = 3
// 위치·크기 한도(m): 필드(3.66 m)보다 넉넉히
const MAX_COORD = 10

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const inRange = (value: unknown, min: number, max: number): value is number =>
  finite(value) && value >= min && value <= max
const name = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= MAX_NAME

class SpecError extends Error {}

function fail(what: string): never {
  throw new SpecError(what)
}

function vec2(value: unknown, what: string): Vec2 {
  if (!isRecord(value)) fail(what)
  const { x, y } = value
  if (!inRange(x, -MAX_COORD, MAX_COORD) || !inRange(y, -MAX_COORD, MAX_COORD)) fail(what)
  return { x, y }
}

function angle(value: unknown, what: string): number {
  if (!inRange(value, -4 * Math.PI, 4 * Math.PI)) fail(what)
  return value
}

function list<T>(
  value: unknown,
  max: number,
  what: string,
  item: (v: unknown, i: number) => T
): T[] {
  if (!Array.isArray(value) || value.length > max) fail(what)
  return value.map((v, i) => item(v, i))
}

function motor(value: unknown, i: number): SimMotorSpec {
  const what = `motors[${i}]`
  if (!isRecord(value)) fail(what)
  const { device, modelTag, gearbox, directionSign } = value
  if (!name(device)) fail(`${what}.device`)
  if (!name(modelTag)) fail(`${what}.modelTag`)
  if (!inRange(gearbox, 0.01, 10000)) fail(`${what}.gearbox`)
  if (directionSign !== 1 && directionSign !== -1) fail(`${what}.directionSign`)
  return {
    device,
    modelTag,
    gearbox,
    directionSign,
    params: motorParams(value.params, `${what}.params`)
  }
}

function wheel(value: unknown, i: number): SimWheelSpec {
  const what = `wheels[${i}]`
  if (!isRecord(value)) fail(what)
  const {
    position,
    kind,
    rollers,
    radius,
    gearRatio,
    motor: motorName,
    spinInertia,
    friction
  } = value
  if (kind !== 'mecanum' && kind !== 'omni' && kind !== 'traction') fail(`${what}.kind`)
  if (kind === 'mecanum' ? rollers !== 'flbr' && rollers !== 'frbl' : rollers !== null)
    fail(`${what}.rollers`)
  if (!inRange(radius, 0.001, 1)) fail(`${what}.radius`)
  if (!inRange(gearRatio, 0.001, 1000)) fail(`${what}.gearRatio`)
  if (motorName !== null && !name(motorName)) fail(`${what}.motor`)
  if (!inRange(spinInertia, 0, MAX_SPIN_INERTIA)) fail(`${what}.spinInertia`)
  if (!inRange(friction, MIN_WHEEL_FRICTION, MAX_WHEEL_FRICTION)) fail(`${what}.friction`)
  return {
    position: vec2(position, `${what}.position`),
    angle: angle(value.angle, `${what}.angle`),
    kind,
    rollers: rollers as MecanumRollers | null,
    radius,
    gearRatio,
    motor: motorName,
    spinInertia,
    friction
  }
}

function deadWheel(value: unknown, i: number): SimDeadWheelSpec {
  const what = `deadWheels[${i}]`
  if (!isRecord(value)) fail(what)
  const { device, position, measures, reversed, ticksPerMeter } = value
  if (!name(device)) fail(`${what}.device`)
  if (measures !== 'forward' && measures !== 'strafe') fail(`${what}.measures`)
  if (typeof reversed !== 'boolean') fail(`${what}.reversed`)
  if (!inRange(ticksPerMeter, 1, 1e8)) fail(`${what}.ticksPerMeter`)
  return { device, position: vec2(position, `${what}.position`), measures, reversed, ticksPerMeter }
}

function pinpoint(value: unknown, i: number): SimPinpointSpec {
  const what = `pinpoints[${i}]`
  if (!isRecord(value)) fail(what)
  const { device, xPod, yPod, podTicksPerMm, xReversed, yReversed } = value
  if (!name(device)) fail(`${what}.device`)
  if (!inRange(podTicksPerMm, 0.001, 1e5)) fail(`${what}.podTicksPerMm`)
  if (typeof xReversed !== 'boolean' || typeof yReversed !== 'boolean') fail(`${what}.reversed`)
  return {
    device,
    xPod: xPod === null ? null : vec2(xPod, `${what}.xPod`),
    yPod: yPod === null ? null : vec2(yPod, `${what}.yPod`),
    podTicksPerMm,
    xReversed,
    yReversed
  }
}

function otos(value: unknown, i: number): SimOtosSpec {
  const what = `otos[${i}]`
  if (!isRecord(value)) fail(what)
  const { device, position, mountingAngle } = value
  if (!name(device)) fail(`${what}.device`)
  return {
    device,
    position: vec2(position, `${what}.position`),
    mountingAngle: angle(mountingAngle, `${what}.mountingAngle`)
  }
}

function imu(value: unknown, i: number): SimImuSpec {
  const what = `imus[${i}]`
  if (!isRecord(value) || !name(value.device)) fail(what)
  return { device: value.device }
}

// ---- 관절 검증 ----

// 관절 값 한도(가정: FTC 메커니즘보다 넉넉히 두고 틀린 단위·폭주 값만 막는다)
// 몸체 질량(kg)·관성 성분(kg·m²)
const MAX_BODY_MASS = 1000
const MAX_INERTIA = 1000
// 관절 마찰·스프링 힘(N 또는 N·m), 점성(N·s/m 또는 N·m·s/rad), 강성(N/m 또는 N·m/rad)
const MAX_JOINT_FORCE = 1e4
const MAX_JOINT_DAMPING = 1e4
const MAX_JOINT_STIFFNESS = 1e6
// 전달 비 |ratio|(rad/rad 또는 m/rad)
const MIN_RATIO = 1e-6
const MAX_RATIO = 1e3
// 관절 하나의 리밋 스위치 수
const MAX_JOINT_SWITCHES = 8
// 단위 축 길이 허용(받으면 정규화한다)
const AXIS_TOLERANCE = 1e-3
// 관성 유효성 허용(주관성 값의 음수·삼각 부등식, 대각 합에 대한 비율)
const INERTIA_TOLERANCE = 1e-9

function vec3(value: unknown, what: string, max = MAX_COORD): Vec3 {
  if (!isRecord(value)) fail(what)
  const { x, y, z } = value
  if (!inRange(x, -max, max) || !inRange(y, -max, max) || !inRange(z, -max, max)) fail(what)
  return { x, y, z }
}

function unitAxis(value: unknown, what: string): Vec3 {
  const a = vec3(value, what, 2)
  const length = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
  if (!(Math.abs(length - 1) <= AXIS_TOLERANCE)) fail(what)
  return { x: a.x / length, y: a.y / length, z: a.z / length }
}

// 무게중심 기준 관성: 유한·한도 안이고, 대칭 양반정치(주관성 값 ≥ 0)이며 주관성 값이 삼각 부등식(I1 + I2 ≥ I3)을 지킨다.
// 렌더러 세계 설명 빌더(섀시 몸체, play/worldSpec.ts)도 이것으로 보내기 전에 확인한다.
export function isValidInertia(value: unknown): value is SimInertia {
  if (!Array.isArray(value) || value.length !== 6) return false
  const v: unknown[] = value
  if (!v.every((x) => inRange(x, -MAX_INERTIA, MAX_INERTIA))) return false
  const [xx, yy, zz, xy, xz, yz] = v as number[]
  const { values } = symmetricEigen3([
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz]
  ])
  const tol = INERTIA_TOLERANCE * (Math.abs(xx) + Math.abs(yy) + Math.abs(zz))
  if (values.some((x) => x < -tol)) return false
  const [a, b, c] = values
  return !(a + b < c - tol || a + c < b - tol || b + c < a - tol)
}

function inertia(value: unknown, what: string): SimInertia {
  if (!isValidInertia(value)) fail(what)
  const [xx, yy, zz, xy, xz, yz] = value
  return [xx, yy, zz, xy, xz, yz]
}

function motorParams(value: unknown, what: string): SimMotorParams {
  if (!isRecord(value)) fail(what)
  const p = value
  if (!inRange(p.stallTorque, 1e-6, 1e3)) fail(`${what}.stallTorque`)
  if (!inRange(p.freeSpeed, 1e-3, 1e5)) fail(`${what}.freeSpeed`)
  if (!inRange(p.stallCurrent, 1e-3, 1e3)) fail(`${what}.stallCurrent`)
  // 무부하 전류 < 정지 전류여야 역기전력 상수가 양수다(actuators.ts DcGearMotor)
  if (!inRange(p.freeCurrent, 0, 1e3) || !(p.freeCurrent < p.stallCurrent))
    fail(`${what}.freeCurrent`)
  if (!inRange(p.gearbox, 0.01, 10000)) fail(`${what}.gearbox`)
  if (!inRange(p.efficiency, 0.01, 1)) fail(`${what}.efficiency`)
  if (!inRange(p.rotorInertia, 0, 1)) fail(`${what}.rotorInertia`)
  if (!inRange(p.backdriveFriction, 0, 10)) fail(`${what}.backdriveFriction`)
  return {
    stallTorque: p.stallTorque,
    freeSpeed: p.freeSpeed,
    stallCurrent: p.stallCurrent,
    freeCurrent: p.freeCurrent,
    gearbox: p.gearbox,
    efficiency: p.efficiency,
    rotorInertia: p.rotorInertia,
    backdriveFriction: p.backdriveFriction
  }
}

function servoParams(value: unknown, what: string): SimServoParams {
  if (!isRecord(value)) fail(what)
  const p = value
  if (!inRange(p.stallTorque, 1e-6, 1e3)) fail(`${what}.stallTorque`)
  if (!inRange(p.freeSpeed, 1e-3, 1e4)) fail(`${what}.freeSpeed`)
  if (!inRange(p.rangeAngle, 0, 4 * Math.PI)) fail(`${what}.rangeAngle`)
  if (!inRange(p.deadbandUs, 0, 100)) fail(`${what}.deadbandUs`)
  if (!inRange(p.kp, 0, 1e6)) fail(`${what}.kp`)
  if (!inRange(p.kd, 0, 1e4)) fail(`${what}.kd`)
  if (!inRange(p.crFullPower, 0.01, 1)) fail(`${what}.crFullPower`)
  if (!inRange(p.limpFriction, 0, 1e3)) fail(`${what}.limpFriction`)
  return {
    stallTorque: p.stallTorque,
    freeSpeed: p.freeSpeed,
    rangeAngle: p.rangeAngle,
    deadbandUs: p.deadbandUs,
    kp: p.kp,
    kd: p.kd,
    crFullPower: p.crFullPower,
    limpFriction: p.limpFriction
  }
}

const ratio = (value: unknown): value is number =>
  finite(value) && Math.abs(value) >= MIN_RATIO && Math.abs(value) <= MAX_RATIO

type MotorRigging = Extract<SimJointDriveSpec, { kind: 'motor' }>['rigging']

function rigging(value: unknown, what: string): MotorRigging {
  if (!isRecord(value)) fail(what)
  if (value.kind === 'direct') return { kind: 'direct' }
  if (value.kind !== 'cascade' && value.kind !== 'continuous') fail(what)
  const stages = list(value.stages, MAX_WORLD_JOINTS - 1, `${what}.stages`, (v, k) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fail(`${what}.stages[${k}]`)
  )
  if (stages.length === 0) fail(`${what}.stages`)
  return { kind: value.kind, stages }
}

function jointDrive(value: unknown, what: string): SimJointDriveSpec {
  if (!isRecord(value)) fail(what)
  switch (value.kind) {
    case 'none':
      return { kind: 'none' }
    case 'stage':
      return { kind: 'stage' }
    case 'servo':
    case 'crServo': {
      if (!name(value.device)) fail(`${what}.device`)
      if (!ratio(value.ratio)) fail(`${what}.ratio`)
      if (value.direction !== 1 && value.direction !== -1) fail(`${what}.direction`)
      const params = servoParams(value.params, `${what}.params`)
      if (value.kind === 'crServo')
        return {
          kind: 'crServo',
          device: value.device,
          ratio: value.ratio,
          params,
          direction: value.direction
        }
      if (!inRange(value.zeroPulseUs, MIN_SERVO_PULSE_US, MAX_SERVO_PULSE_US))
        fail(`${what}.zeroPulseUs`)
      return {
        kind: 'servo',
        device: value.device,
        ratio: value.ratio,
        params,
        zeroPulseUs: value.zeroPulseUs,
        direction: value.direction
      }
    }
    case 'motor': {
      const devices = list(value.devices, MAX_JOINT_MOTORS, `${what}.devices`, (v, k) =>
        name(v) ? v : fail(`${what}.devices[${k}]`)
      )
      if (devices.length === 0) fail(`${what}.devices`)
      if (!ratio(value.ratio)) fail(`${what}.ratio`)
      return {
        kind: 'motor',
        devices,
        ratio: value.ratio,
        params: motorParams(value.params, `${what}.params`),
        rigging: rigging(value.rigging, `${what}.rigging`)
      }
    }
    default:
      fail(`${what}.kind`)
  }
}

type JointSwitch = SimJointSpec['switches'][number]

function jointSwitch(value: unknown, what: string, limits: SimJointSpec['limits']): JointSwitch {
  if (!isRecord(value)) fail(what)
  const { device, kind, at, within } = value
  if (!name(device)) fail(`${what}.device`)
  if (kind !== 'touch' && kind !== 'digital') fail(`${what}.kind`)
  // 한계가 없는 관절(제한 없는 회전)에는 끝이 없다
  if ((at !== 'lower' && at !== 'upper') || limits === null) fail(`${what}.at`)
  if (!inRange(within, 0, 1)) fail(`${what}.within`)
  return { device, kind, at, within }
}

// 몸체 질량 성질(관절 몸체·섀시): 질량 범위, 무게중심 한도, 관성 유효성
function body(value: unknown, what: string, minMass: number): SimBody {
  if (!isRecord(value) || !inRange(value.mass, minMass, MAX_BODY_MASS)) fail(what)
  return {
    mass: value.mass,
    centerOfMass: vec3(value.centerOfMass, `${what}.centerOfMass`),
    inertia: inertia(value.inertia, `${what}.inertia`)
  }
}

function joint(value: unknown, i: number): SimJointSpec {
  const what = `joints[${i}]`
  if (!isRecord(value)) fail(what)
  const { parent, type, origin, friction } = value
  // 부모가 먼저 온다(순환 없음)
  if (typeof parent !== 'number' || !Number.isInteger(parent) || parent < -1 || parent >= i)
    fail(`${what}.parent`)
  if (type !== 'revolute' && type !== 'prismatic') fail(`${what}.type`)
  if (!isRecord(origin)) fail(`${what}.origin`)
  let limits: SimJointSpec['limits'] = null
  const l = value.limits
  if (l !== null) {
    const range = type === 'revolute' ? 4 * Math.PI : MAX_COORD
    // 편집 자세(q = 0)가 한계 안이어야 시작부터 튀지 않는다
    if (!isRecord(l) || !inRange(l.lower, -range, 0) || !inRange(l.upper, 0, range))
      fail(`${what}.limits`)
    limits = { lower: l.lower, upper: l.upper }
  } else if (type === 'prismatic') fail(`${what}.limits`)
  if (
    !isRecord(friction) ||
    !inRange(friction.coulomb, 0, MAX_JOINT_FORCE) ||
    !inRange(friction.viscous, 0, MAX_JOINT_DAMPING)
  )
    fail(`${what}.friction`)
  let spring: SimJointSpec['spring'] = null
  const s = value.spring
  if (s !== null) {
    if (isRecord(s) && s.kind === 'constantForce' && inRange(s.force, 0, MAX_JOINT_FORCE))
      spring = { kind: 'constantForce', force: s.force }
    else if (
      isRecord(s) &&
      s.kind === 'linear' &&
      inRange(s.stiffness, 0, MAX_JOINT_STIFFNESS) &&
      inRange(s.rest, -4 * Math.PI, 4 * Math.PI)
    )
      spring = { kind: 'linear', stiffness: s.stiffness, rest: s.rest }
    else fail(`${what}.spring`)
  }
  return {
    parent,
    type,
    origin: {
      position: vec3(origin.position, `${what}.origin.position`),
      rotation: vec3(origin.rotation, `${what}.origin.rotation`, 4 * Math.PI)
    },
    axis: unitAxis(value.axis, `${what}.axis`),
    limits,
    body: body(value.body, `${what}.body`, 1e-9),
    friction: { coulomb: friction.coulomb, viscous: friction.viscous },
    spring,
    drive: jointDrive(value.drive, `${what}.drive`),
    switches: list(value.switches, MAX_JOINT_SWITCHES, `${what}.switches`, (v, k) =>
      jointSwitch(v, `${what}.switches[${k}]`, limits)
    )
  }
}

// 관절 사이의 참조. 구동 모터는 motors에 있고 바퀴·다른 관절과 겹치지 않는다. 서보·스위치 장치는 한 곳에서만 쓴다.
// 다단 리깅의 단은 drive 'stage'인 직선 관절이고 구동 관절(직선) 하나에만 들어 있다.
// 돌려주는 값: 관절 서보·리밋 스위치 장치 이름(센서 이름 겹침 검사에 쓴다)
function checkJointReferences(spec: WorldSpec, motorNames: Set<string>): Set<string> {
  const wheelMotors = new Set(spec.wheels.flatMap((w) => (w.motor === null ? [] : [w.motor])))
  const usedMotors = new Set<string>()
  const usedDevices = new Set<string>()
  const stageOwners = new Set<number>()
  spec.joints.forEach((j, i) => {
    const what = `joints[${i}].drive`
    const drive = j.drive
    if (drive.kind === 'motor') {
      drive.devices.forEach((device, k) => {
        if (!motorNames.has(device)) fail(`${what}.devices[${k}]: unknown device`)
        if (wheelMotors.has(device)) fail(`${what}.devices[${k}]: wheel motor`)
        if (usedMotors.has(device)) fail(`${what}.devices[${k}]: duplicate device`)
        usedMotors.add(device)
      })
      if (drive.rigging.kind === 'direct') return
      if (j.type !== 'prismatic') fail(`${what}.rigging`)
      drive.rigging.stages.forEach((stage, k) => {
        const target = stage < spec.joints.length ? spec.joints[stage] : undefined
        if (
          stage === i ||
          target === undefined ||
          target.drive.kind !== 'stage' ||
          target.type !== 'prismatic' ||
          stageOwners.has(stage)
        )
          fail(`${what}.rigging.stages[${k}]`)
        stageOwners.add(stage)
      })
    } else if (drive.kind === 'servo' || drive.kind === 'crServo') {
      if (usedDevices.has(drive.device)) fail(`${what}.device: duplicate device`)
      usedDevices.add(drive.device)
    }
  })
  spec.joints.forEach((j, i) => {
    if (j.drive.kind === 'stage' && !stageOwners.has(i)) fail(`joints[${i}].drive: unused stage`)
    j.switches.forEach((s, k) => {
      if (usedDevices.has(s.device) || motorNames.has(s.device))
        fail(`joints[${i}].switches[${k}].device: duplicate device`)
      usedDevices.add(s.device)
    })
  })
  return usedDevices
}

// 단순 볼록 반시계 다각형: 모든 변 i(P_i → P_i+1)와 그 변의 끝점이 아닌 모든 꼭짓점 k에 대해 cross > 0. 연속 세 점만 보면
// 오각별(두 바퀴 감김)이 통과하므로 모두 본다(n ≤ MAX_FOOTPRINT_POINTS라 O(n²)도 싸다). 구조물 접촉의 SAT·자르기가 가정한다.
function isConvexCounterClockwise(points: readonly Vec2[]): boolean {
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    for (let k = 0; k < n; k++) {
      if (k === i || k === (i + 1) % n) continue
      const p = points[k]
      if (!((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0)) return false
    }
  }
  return true
}

function field(value: unknown): WorldSpec['field'] {
  if (!isRecord(value) || !isSeasonId(value.season)) fail('field')
  const tipped = value.hiveTipped
  if (
    !Array.isArray(tipped) ||
    tipped.length !== 2 ||
    typeof tipped[0] !== 'boolean' ||
    typeof tipped[1] !== 'boolean'
  )
    fail('field.hiveTipped')
  return { season: value.season, hiveTipped: [tipped[0], tipped[1]] }
}

function noise(value: unknown): WorldSpec['noise'] {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.seed))
    fail('noise')
  return { enabled: value.enabled, seed: value.seed as number }
}

// 거리·컬러 센서 하나(4c). body는 −1(섀시) 또는 관절 순번
function sensor(
  value: unknown,
  what: string,
  jointCount: number
): { device: string; mount: SensorMount } {
  if (!isRecord(value) || !isRecord(value.mount)) fail(what)
  if (!name(value.device)) fail(`${what}.device`)
  const { body: mountBody, position, rotation } = value.mount
  if (
    typeof mountBody !== 'number' ||
    !Number.isInteger(mountBody) ||
    mountBody < -1 ||
    mountBody >= jointCount
  )
    fail(`${what}.mount.body`)
  return {
    device: value.device,
    mount: {
      body: mountBody,
      position: vec3(position, `${what}.mount.position`),
      rotation: vec3(rotation, `${what}.mount.rotation`, 4 * Math.PI)
    }
  }
}

// 웹캠 하나(4d): 장착은 거리·컬러 센서와 같은 검사, 모델은 cameraData.ts의 id
function camera(value: unknown, what: string, jointCount: number): SimCameraSpec {
  const { device, mount } = sensor(value, what, jointCount)
  const model = (value as Record<string, unknown>).model
  if (!isCameraModelId(model)) fail(`${what}.model`)
  return { device, mount, model }
}

// ---- 충돌 형상 검증(5, spec-5 §2.2) ----

// 상자 회전: 길이 9의 유한 수, |RᵀR − I| 원소 최대 ≤ BOX_ROTATION_TOLERANCE, det > 0
function boxRotation(value: unknown, what: string): number[] {
  if (!Array.isArray(value) || value.length !== 9) fail(what)
  const r: unknown[] = value
  // 정규 직교 행렬의 원소는 |x| ≤ 1이다. 2는 곱을 재기 전에 터무니없는 수를 거르는 넉넉한 한도다 [결정]
  if (!r.every((x) => finite(x) && Math.abs(x) <= 2)) fail(what)
  const m = r as number[]
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const product = m[i] * m[j] + m[3 + i] * m[3 + j] + m[6 + i] * m[6 + j]
      if (!(Math.abs(product - (i === j ? 1 : 0)) <= BOX_ROTATION_TOLERANCE)) fail(what)
    }
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  if (!(det > 0)) fail(what)
  return m.slice()
}

// 충돌체 하나. 받은 값의 다른 키는 버리고 받은 수를 그대로 돌려준다(껍질은 PhysicsWorld가 다시 만든다)
function collider(value: unknown, what: string): SimCollider {
  if (!isRecord(value)) fail(what)
  let shape: SimCollider
  switch (value.kind) {
    case 'convex': {
      // 껍질 양자화가 받는 좌표 한도(HULL_MAX_COORD) 안의 점만 받는다
      const points = list(value.points, MAX_HULL_POINTS, `${what}.points`, (v, k) =>
        vec3(v, `${what}.points[${k}]`, HULL_MAX_COORD)
      )
      if (points.length < 4) fail(`${what}.points`)
      if (canonicalHull(points) === null) fail(`${what}.points: degenerate`)
      shape = { kind: 'convex', points, friction: 0 }
      break
    }
    case 'box': {
      const center = vec3(value.center, `${what}.center`)
      const half = value.half
      if (
        !isRecord(half) ||
        ![half.x, half.y, half.z].every((h) => inRange(h, MIN_BOX_SIZE / 2, MAX_COORD))
      )
        fail(`${what}.half`)
      const rotation = boxRotation(value.rotation, `${what}.rotation`)
      shape = {
        kind: 'box',
        center,
        rotation,
        half: { x: half.x as number, y: half.y as number, z: half.z as number },
        friction: 0
      }
      break
    }
    case 'capsule': {
      const a = vec3(value.a, `${what}.a`)
      const b = vec3(value.b, `${what}.b`)
      if (!inRange(value.radius, MIN_CAPSULE_RADIUS, MAX_CAPSULE_RADIUS)) fail(`${what}.radius`)
      shape = { kind: 'capsule', a, b, radius: value.radius, friction: 0 }
      break
    }
    default:
      fail(`${what}.kind`)
  }
  if (!inRange(value.friction, 0, MAX_COLLIDER_FRICTION)) fail(`${what}.friction`)
  shape.friction = value.friction
  return shape
}

const colliderList = (value: unknown, what: string): SimCollider[] =>
  list(value, MAX_BODY_COLLIDERS, what, (v, k) => collider(v, `${what}[${k}]`))

// 무시 짝 [a, b]: 정수 −1 ≤ a < b < joints.length
function bodyPair(value: unknown, what: string, jointCount: number): SimBodyPair {
  if (!Array.isArray(value) || value.length !== 2) fail(what)
  const [a, b]: unknown[] = value
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < -1 ||
    !(a < b) ||
    b >= jointCount
  )
    fail(what)
  return [a, b]
}

// 거리·컬러 센서·웹캠 장치 이름: 세 목록을 합쳐 유일하고, 모터·데드휠·Pinpoint·OTOS·IMU·관절 서보·리밋 스위치와 겹치지 않는다
// (데드휠은 모터 이름을 함께 쓰므로 모터·데드휠끼리는 보지 않는다)
function checkSensorNames(
  spec: WorldSpec,
  motorNames: Set<string>,
  jointDevices: Set<string>
): void {
  const others = new Set<string>([
    ...motorNames,
    ...spec.deadWheels.map((d) => d.device),
    ...spec.pinpoints.map((p) => p.device),
    ...spec.otos.map((o) => o.device),
    ...spec.imus.map((i) => i.device),
    ...jointDevices
  ])
  const seen = new Set<string>()
  const check = (list: { device: string }[], what: string): void =>
    list.forEach((s, i) => {
      if (seen.has(s.device) || others.has(s.device)) fail(`${what}[${i}].device: duplicate device`)
      seen.add(s.device)
    })
  check(spec.distanceSensors, 'distanceSensors')
  check(spec.colorSensors, 'colorSensors')
  check(spec.cameras, 'cameras')
}

// 모양이 맞으면 새 객체(받은 값의 다른 키는 버린다), 아니면 무엇이 틀렸는지 글자로 돌려준다
export function parseWorldSpec(value: unknown): WorldSpec | string {
  try {
    if (!isRecord(value)) fail('not an object')
    if (value.version !== WORLD_SPEC_VERSION) fail('version')
    const robot = value.robot
    if (!isRecord(robot) || !isRecord(robot.start)) fail('robot')
    const start = robot.start
    const footprint = list(robot.footprint, MAX_FOOTPRINT_POINTS, 'robot.footprint', (v, i) =>
      vec2(v, `robot.footprint[${i}]`)
    )
    if (footprint.length < 3 || !isConvexCounterClockwise(footprint)) fail('robot.footprint')
    const { height } = robot
    if (!(finite(height) && height > 0 && height <= MAX_COORD)) fail('robot.height')
    const { batteryVoltage } = value
    if (!inRange(batteryVoltage, 1, 30)) fail('batteryVoltage')
    // 3c까지의 칸을 같은 순서로 먼저 읽고(오류 순서 그대로), v4 칸은 그 뒤에 읽는다
    const robotSpec: WorldSpec['robot'] = {
      start: {
        x: vec2({ x: start.x, y: start.y }, 'robot.start').x,
        y: vec2({ x: start.x, y: start.y }, 'robot.start').y,
        yaw: angle(start.yaw, 'robot.start.yaw')
      },
      footprint,
      height,
      // 섀시 질량 하한(kg): 렌더러는 0.1 kg 아래를 기본 질량으로 대신한다(spec-3c §1.7). 1 g 아래는 잘못된 값이다.
      body: body(robot.body, 'robot.body', 1e-3)
    }
    const hubs = list(value.hubs, 16, 'hubs', (v, i) => (name(v) ? v : fail(`hubs[${i}]`)))
    const motors = list(value.motors, MAX_WORLD_MOTORS, 'motors', motor)
    const wheels = list(value.wheels, MAX_WORLD_WHEELS, 'wheels', wheel)
    const deadWheels = list(value.deadWheels, MAX_WORLD_SENSORS, 'deadWheels', deadWheel)
    const pinpoints = list(value.pinpoints, MAX_WORLD_SENSORS, 'pinpoints', pinpoint)
    const otosList = list(value.otos, MAX_WORLD_SENSORS, 'otos', otos)
    const imus = list(value.imus, MAX_WORLD_SENSORS, 'imus', imu)
    const joints = list(value.joints, MAX_WORLD_JOINTS, 'joints', joint)
    const spec: WorldSpec = {
      version: WORLD_SPEC_VERSION,
      field: field(value.field),
      robot: robotSpec,
      batteryVoltage,
      hubs,
      motors,
      wheels,
      deadWheels,
      pinpoints,
      otos: otosList,
      imus,
      joints,
      // 목록마다 MAX_WORLD_SENSORS(따로 센다, synthesis §9.10-4). body는 관절 수 안
      distanceSensors: list(value.distanceSensors, MAX_WORLD_SENSORS, 'distanceSensors', (v, i) =>
        sensor(v, `distanceSensors[${i}]`, joints.length)
      ),
      colorSensors: list(value.colorSensors, MAX_WORLD_SENSORS, 'colorSensors', (v, i) =>
        sensor(v, `colorSensors[${i}]`, joints.length)
      ),
      noise: noise(value.noise),
      // v5(4d): noise 뒤, 이름 검사 전
      cameras: list(value.cameras, MAX_WORLD_CAMERAS, 'cameras', (v, i) =>
        camera(v, `cameras[${i}]`, joints.length)
      )
    }
    // v6(5): 충돌 형상은 지금 칸을 모두 읽은 뒤 이 순서로 읽는다(지금 칸의 오류가 먼저 나온다). 받은 값에 없으면 결과에도
    // 키를 두지 않는다(형상 없는 세계는 v5와 키·값이 같다)
    let colliderCount = 0
    if (robot.colliders !== undefined) {
      spec.robot.colliders = colliderList(robot.colliders, 'robot.colliders')
      colliderCount += spec.robot.colliders.length
    }
    const jointValues = value.joints as Record<string, unknown>[]
    spec.joints.forEach((j, i) => {
      const received = jointValues[i].colliders
      if (received === undefined) return
      j.colliders = colliderList(received, `joints[${i}].colliders`)
      colliderCount += j.colliders.length
    })
    if (value.collisionIgnore !== undefined) {
      const pairs = list(value.collisionIgnore, MAX_COLLISION_IGNORE, 'collisionIgnore', (v, i) =>
        bodyPair(v, `collisionIgnore[${i}]`, joints.length)
      )
      const seen = new Set<string>()
      for (const [a, b] of pairs) {
        const key = `${a},${b}`
        if (seen.has(key)) fail('collisionIgnore: duplicate')
        seen.add(key)
      }
      spec.collisionIgnore = pairs
    }
    if (colliderCount > MAX_WORLD_COLLIDERS) fail('colliders: too many')
    const motorNames = new Set(spec.motors.map((m) => m.device))
    if (motorNames.size !== spec.motors.length) fail('motors: duplicate device')
    spec.wheels.forEach((w, i) => {
      if (w.motor !== null && !motorNames.has(w.motor)) fail(`wheels[${i}].motor: unknown device`)
    })
    const jointDevices = checkJointReferences(spec, motorNames)
    checkSensorNames(spec, motorNames, jointDevices)
    return spec
  } catch (error) {
    if (error instanceof SpecError) return error.message
    throw error
  }
}
