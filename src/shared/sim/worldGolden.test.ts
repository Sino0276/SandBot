import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { resolveServoParams } from './actuatorData'
import { Articulation } from './articulation'
import {
  HALF,
  HUB_SIGN,
  mecanum,
  motorOut,
  outputs,
  robotSpec,
  TAG,
  TICK,
  ZERO
} from './driveTestkit'
import { WALL_INNER_HALF } from './field'
import type { SeasonId } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { snapRobotToStart } from './seasons/startPose'
import { testMotorParams } from './testkit'
import { PhysicsWorld } from './world'
import type { SimJointSpec, SimMotorSpec, SimPose, WorldSpec } from './worldSpec'

// 시뮬레이터 출력 기준 해시. 대표 시나리오 일곱(넷은 4단계 전 v3 기준, 다섯째는 4ab BIOBUZZ 기준, 여섯째는 4c 센서 기준, 일곱째는
// 4d 웹캠 기준)을 고정한 출력열로
// 돌려, 틱마다 step()이 돌려준 입력, pose()(기저 basePose()의 x·y·yaw, 관절 q(), blocked), supportLoads(),
// drainNotices()를 JSON으로 이어 sha256을 잰다.
//
// 'none' 시나리오 넷의 해시는 4단계(4ab: 시즌 필드·고정 경기 요소 충돌, 세계 설명 v4) 전의 코드로 잰 기준값이다. 4ab는
// 세계 설명에 field: { season: 'none', … }을 더해도 이 해시가 그대로임을 보여야 한다('none' 시즌은 3c와 바이트까지 같다,
// 계획의 "바이트 보존과 시험 고정"). 그러니 'none'으로 이 값이 바뀌면 시험을 고치지 말고 코드를 고친다. 4ab가 바꿀 곳은
// 각 시나리오의 세계 설명(spec)뿐이다: 거기에 field를 더하고 version을 올린다(계약 커밋이 robotSpec()에서 했다).
// 다섯째는 4ab의 BIOBUZZ 기준이고 4c·4d가 지킨다(BIOBUZZ 벽 반폭과 고정 구조물 접촉, 4ab 코드로 잰 값. 4ab 리뷰 수정의
// 참 분리 축 보충 행으로 다시 쟀다).
//
// 일곱째는 4d의 웹캠 기준이고 다음 단계가 지킨다(BIOBUZZ, 잡음 끔, 웹캠 출력 고정). 웹캠이 없는 세계의 입력열은 4d 전과 바이트
// 그대로라 앞의 여섯 해시는 4d가 바꾸지 않는다.
//
// 여섯째는 4c의 거리·컬러 센서 기준이고 4d가 지킨다(BIOBUZZ, 잡음 끔). 이 해시는 센서 계산의 Math.pow·acos·atan을 처음으로
// 기준 해시에 넣는다(잡음 끔이라 log는 없다). 기존 해시도 sin·cos·sqrt에 기대므로 같은 성질이지만, Node·Electron을 올릴 때 다시
// 볼 해시가 하나 는다.
//
// 해시는 물리 계산이 쓰는 Math.sin·exp 등의 결과에 기대고, V8은 이것을 fdlibm 이식으로 플랫폼과 관계없이 같게 낸다. Node를
// 올려 이 시험만 깨지면, 4단계 전 커밋의 코드로 같은 Node에서 다시 재어 확인한 뒤에만 값을 바꾼다. 출력열 자체는 초월 함수를
// 쓰지 않는다.

type Outputs = Record<string, DeviceValues>

type Scenario = {
  spec: WorldSpec
  ticks: number
  // 틱 k의 시각(ns, 늘어나기만)
  time: (k: number) => number
  out: (k: number) => Outputs
}

type Tick = {
  k: number
  input: Outputs
  pose: SimPose
  loads: readonly number[]
  notices: ReturnType<PhysicsWorld['drainNotices']>
}

// 틱마다 [k, 입력, 자세, 하중, 알림]을 모아 JSON의 sha256(hex)을 낸다
function trace(s: Scenario, season: SeasonId = 'none'): { ticks: Tick[]; hash: string } {
  return traceWith(s, season, (text) => text)
}

// nullable: JSON에서 허용한 null을 지운 글자(거리 센서의 범위 밖 distance: null만 허용한다)
function traceWith(
  s: Scenario,
  season: SeasonId,
  nullable: (text: string) => string
): { ticks: Tick[]; hash: string } {
  // 4ab 계약: 넷째까지는 driveTestkit robotSpec()으로 세계 설명 v4 + 'none' 시즌이다(해시는 v3 코드로 잰 값 그대로)
  expect(s.spec.version).toBe(5)
  expect(s.spec.field).toEqual({ season, hiveTipped: [false, false] })
  const world = new PhysicsWorld(s.spec)
  const ticks: Tick[] = []
  for (let k = 0; k < s.ticks; k++) {
    const input = world.step(s.time(k), s.out(k))
    ticks.push({
      k,
      input,
      pose: world.pose(),
      loads: world.supportLoads(),
      notices: world.drainNotices()
    })
  }
  const text = JSON.stringify(ticks.map((t) => [t.k, t.input, t.pose, t.loads, t.notices]))
  // 기준이 실패한 풀이를 담지 않게: LCP 실패 알림이 없고 모든 수가 유한하다(JSON에 null이 없다)
  expect(ticks.some((t) => t.notices.some((n) => n.code === 'worldError'))).toBe(false)
  expect(nullable(text)).not.toContain('null')
  return { ticks, hash: createHash('sha256').update(text).digest('hex') }
}

const evenly = (k: number): number => k * TICK
// 허브 타이밍처럼 고르지 않은 틱(하위 단계 격자와 어긋난 경계): 5 ms 틱마다 0·1.3·2.6 ms 늦게
const uneven = (k: number): number => k * TICK + (k % 3) * 1_300_000

// 리프트(직선, 위로 0–0.3 m, 1.5 kg)를 구동하는 goBILDA 312 모터와 아래 리밋 스위치(driveTestkit 기준 로봇과 같은 모터)
const LIFT_PARAMS = testMotorParams(TAG, 19.2)
const liftMotor = (device: string): SimMotorSpec => ({
  device,
  modelTag: TAG,
  gearbox: 19.2,
  directionSign: 1,
  params: LIFT_PARAMS
})
function liftJoint(): SimJointSpec {
  return {
    parent: -1,
    type: 'prismatic',
    origin: { position: { x: 0, y: 0, z: 0.1 }, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: { lower: 0, upper: 0.3 },
    body: { mass: 1.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
    friction: { coulomb: 1, viscous: 0 },
    spring: null,
    drive: {
      kind: 'motor',
      devices: ['lift'],
      ratio: 0.112 / (2 * Math.PI),
      params: LIFT_PARAMS,
      rigging: { kind: 'direct' }
    },
    switches: [{ device: 'liftDown', kind: 'touch', at: 'lower', within: 0.002 }]
  }
}
// 리프트 모터 출력(허브 부호, 인스펙터 forward)
const liftOut = (power: number, change: DeviceValues = {}): DeviceValues => ({
  mode: 'RUN_WITHOUT_ENCODER',
  power: power * HUB_SIGN,
  velocity: null,
  enabled: true,
  zeroPower: 'BRAKE',
  targetPosition: null,
  encoderOffset: 0,
  ...change
})

// 팀이 쓴 Pinpoint 설정(4-bar 포드, 오프셋 mm)
const PINPOINT_TICKS_PER_MM = 19.89436789
const pinpointOut: DeviceValues = {
  xOffsetMm: 100,
  yOffsetMm: -30,
  ticksPerMm: PINPOINT_TICKS_PER_MM,
  xDirection: 'FORWARD',
  yDirection: 'FORWARD',
  yawScalar: 1
}

// (1) 메카넘 4 + Pinpoint + OTOS + IMU + 모터 리프트(리밋 스위치). 2 s 동안 앞·옆·회전·정지를 섞고 리프트는 올린 뒤
// RUN_TO_POSITION으로 잡고 FLOAT로 내린다. 틱 간격은 고르지 않다.
function mecanumLift(): Scenario {
  const base = robotSpec({ start: { x: -1.2, y: 0.3, yaw: 0.25 } })
  const spec: WorldSpec = {
    ...base,
    motors: [...base.motors, liftMotor('lift')],
    pinpoints: [
      {
        device: 'pinpoint',
        xPod: { x: 0.02, y: 0.1 },
        yPod: { x: -0.08, y: -0.03 },
        podTicksPerMm: PINPOINT_TICKS_PER_MM,
        xReversed: false,
        yReversed: true
      }
    ],
    otos: [{ device: 'otos', position: { x: 0.1, y: -0.05 }, mountingAngle: Math.PI / 2 }],
    joints: [liftJoint()]
  }
  const drive = (k: number): ReturnType<typeof mecanum> => {
    if (k < 80) return mecanum(0.6, 0, 0)
    if (k < 160) return mecanum(0.2, -0.7, 0)
    if (k < 240) return mecanum(0.3, 0.2, 0.5)
    if (k < 320) return mecanum(-0.4, 0.3, -0.2)
    return mecanum(0, 0, 0)
  }
  const lift = (k: number): DeviceValues => {
    if (k < 120) return liftOut(1)
    if (k < 300) return liftOut(0.8, { mode: 'RUN_TO_POSITION', targetPosition: 300 })
    return liftOut(0, { zeroPower: 'FLOAT' })
  }
  return {
    spec,
    ticks: 400,
    time: uneven,
    out: (k) => ({
      ...outputs(drive(k), k >= 320 ? { zeroPower: 'FLOAT' } : {}),
      lift: lift(k),
      pinpoint: pinpointOut,
      otos: { offsetX: 0, offsetY: 0.1, offsetH: 0 }
    })
  }
}

// (2) 벽 밀기: +X 벽 앞에서 비스듬히(요 0.1) 전출력으로 박고, 민 채 옆으로 끌다가, 물러난다. 데드휠 둘.
function wallPush(): Scenario {
  const start = { x: WALL_INNER_HALF - HALF - 0.35, y: -0.4, yaw: 0.1 }
  const spec: WorldSpec = robotSpec(
    { start },
    {
      deadWheels: [
        {
          device: 'par',
          position: { x: 0, y: 0.1 },
          measures: 'forward',
          reversed: false,
          ticksPerMeter: 2000 / (Math.PI * 0.048)
        },
        {
          device: 'perp',
          position: { x: -0.1, y: 0 },
          measures: 'strafe',
          reversed: true,
          ticksPerMeter: 2000 / (Math.PI * 0.048)
        }
      ]
    }
  )
  const drive = (k: number): ReturnType<typeof mecanum> => {
    if (k < 200) return mecanum(1, 0, 0)
    if (k < 320) return mecanum(0.5, 0.5, 0)
    return mecanum(-0.6, 0, 0)
  }
  return { spec, ticks: 400, time: evenly, out: (k) => outputs(drive(k)) }
}

// (3) 관절만(바퀴 없음 = 고정 기저): 리프트(모터) 위에 팔(모터, 회전, 중력), 그 위에 손목(위치 서보), 팔에 인테이크(CR 서보).
// 위 리밋 스위치는 digital. 팔은 RUN_USING_ENCODER로 들고 RUN_TO_POSITION으로 돌아온다.
function jointsOnly(): Scenario {
  const base = robotSpec({ start: { x: 0, y: 0, yaw: 0 } })
  const servo = resolveServoParams('gobildaTorque', 'servo')
  const cr = resolveServoParams('gobildaSpeed', 'crServo')
  const lift = liftJoint()
  lift.switches.push({ device: 'liftUp', kind: 'digital', at: 'upper', within: 0.002 })
  const joints: SimJointSpec[] = [
    lift,
    {
      parent: 0,
      type: 'revolute',
      origin: { position: { x: 0.05, y: 0, z: 0.2 }, rotation: ZERO },
      axis: { x: 0, y: 1, z: 0 },
      limits: { lower: -2, upper: 0.3 },
      body: {
        mass: 0.6,
        centerOfMass: { x: 0.2, y: 0, z: 0 },
        inertia: [1e-4, 4e-3, 4e-3, 0, 0, 0]
      },
      friction: { coulomb: 0.02, viscous: 0.001 },
      spring: { kind: 'linear', stiffness: 0.5, rest: -0.5 },
      drive: {
        kind: 'motor',
        devices: ['arm'],
        ratio: -1 / 3,
        params: LIFT_PARAMS,
        rigging: { kind: 'direct' }
      },
      switches: []
    },
    {
      parent: 1,
      type: 'revolute',
      origin: { position: { x: 0.35, y: 0, z: 0 }, rotation: ZERO },
      axis: { x: 0, y: 1, z: 0 },
      limits: { lower: -1.5, upper: 1.5 },
      body: {
        mass: 0.15,
        centerOfMass: { x: 0.05, y: 0, z: 0 },
        inertia: [1e-5, 5e-5, 5e-5, 0, 0, 0]
      },
      friction: { coulomb: 0.02, viscous: 0.001 },
      spring: null,
      drive: {
        kind: 'servo',
        device: 'wrist',
        ratio: 1,
        params: servo,
        zeroPulseUs: 1500,
        direction: 1
      },
      switches: []
    },
    {
      parent: 1,
      type: 'revolute',
      origin: { position: { x: 0.3, y: 0, z: -0.03 }, rotation: { x: 0, y: 0, z: 0.2 } },
      axis: { x: 0, y: 1, z: 0 },
      limits: null,
      body: { mass: 0.05, centerOfMass: ZERO, inertia: [1e-5, 1e-5, 1e-5, 0, 0, 0] },
      friction: { coulomb: 0.02, viscous: 0.001 },
      spring: null,
      drive: { kind: 'crServo', device: 'intake', ratio: 1, params: cr, direction: -1 },
      switches: []
    }
  ]
  const spec: WorldSpec = {
    ...base,
    motors: [liftMotor('lift'), liftMotor('arm')],
    wheels: [],
    joints
  }
  return {
    spec,
    ticks: 400,
    time: evenly,
    out: (k) => ({
      lift: k < 150 ? liftOut(1) : liftOut(-0.6),
      arm:
        k < 200
          ? liftOut(0, { mode: 'RUN_USING_ENCODER', velocity: -400 * HUB_SIGN })
          : liftOut(0.7, { mode: 'RUN_TO_POSITION', targetPosition: 0 }),
      wrist: { position: 0.5, pulseUs: k < 100 ? 1500 : k < 300 ? 2100 : null, pwm: k < 300 },
      intake: { position: 0, power: 0, pulseUs: k < 250 ? 2400 : 1050, pwm: true }
    })
  }
}

// (4) 바퀴도 관절도 없음: 자유 모터(바퀴 없는 구동 모터)와 포트를 함께 쓰는 데드휠, Pinpoint·OTOS·IMU, 허브 둘.
// 로봇은 움직이지 않고 모터 엔코더만 돈다. 포드 포트 모터를 엔코더 모드로 돌려 sharedEncoderMode 알림도 낸다.
function motorsOnly(): Scenario {
  const base = robotSpec()
  const spec: WorldSpec = {
    ...base,
    hubs: ['Control Hub', 'Expansion Hub 2'],
    wheels: [],
    deadWheels: [
      {
        device: 'fl',
        position: { x: 0, y: 0.12 },
        measures: 'forward',
        reversed: false,
        ticksPerMeter: 8192 / (Math.PI * 0.035)
      }
    ],
    pinpoints: [
      {
        device: 'pinpoint',
        xPod: { x: 0, y: 0.1 },
        yPod: null,
        podTicksPerMm: 13.26291192,
        xReversed: false,
        yReversed: false
      }
    ],
    otos: [{ device: 'otos', position: ZERO, mountingAngle: 0 }],
    joints: []
  }
  return {
    spec,
    ticks: 300,
    time: evenly,
    out: (k) => ({
      fl: motorOut('fl', 0.5, k >= 100 ? { mode: 'RUN_USING_ENCODER', velocity: 600 } : {}),
      fr: motorOut('fr', k < 150 ? 1 : 0, { zeroPower: k < 150 ? 'BRAKE' : 'FLOAT' }),
      bl: motorOut('bl', 0.3, {
        mode: k < 120 ? 'RUN_WITHOUT_ENCODER' : 'RUN_TO_POSITION',
        targetPosition: 500
      }),
      br: motorOut(
        'br',
        -0.8,
        k >= 200 ? { mode: 'STOP_AND_RESET_ENCODER', encoderResets: 1 } : {}
      ),
      pinpoint: { ...pinpointOut, ticksPerMm: 13.26291192 }
    })
  }
}

// (5) BIOBUZZ 구조물 접촉(4ab 기준): redWallCenter 프리셋의 +X 끝(FLOWER <3> 옆 빨강 벽 모서리)에 스냅해 모서리로 비스듬히
// 밀고(벽 + FLOWER), 벽에서 물러나 +X로 FLOWER를 비켜 +Y로 올라간 뒤, −X로 HIVE 쪽에 와서 −Y로 물러나며 다리 (+X,−Y)의 안쪽
// 끝을 스친다. 데드휠 하나, 고르지 않은 틱.
function biobuzzContact(): Scenario {
  const field = resolveSeason('biobuzz')
  const preset = field.startPresets.find((p) => p.key === 'redWallCenter')
  if (!preset) throw new Error('redWallCenter')
  const footprint = robotSpec().robot.footprint
  const snap = snapRobotToStart(footprint, preset, field.perimeter.innerHalf, preset.along[1])
  if (!snap.ok) throw new Error('tooWide')
  const spec = robotSpec(
    { start: snap.pose },
    {
      field: { season: 'biobuzz', hiveTipped: [false, false] },
      deadWheels: [
        {
          device: 'par',
          position: { x: 0, y: 0.1 },
          measures: 'forward',
          reversed: false,
          ticksPerMeter: 2000 / (Math.PI * 0.048)
        }
      ]
    }
  )
  // 요 π/2(필드 +Y를 봄): 로봇 앞 = 필드 +Y, 로봇 오른쪽 = 필드 +X
  const drive = (k: number): ReturnType<typeof mecanum> => {
    if (k < 100) return mecanum(-0.4, 0.6, 0)
    if (k < 180) return mecanum(0.6, 0, 0)
    if (k < 300) return mecanum(0.1, 0.9, 0)
    if (k < 480) return mecanum(0.8, 0, 0)
    if (k < 605) return mecanum(0, -0.8, 0)
    if (k < 745) return mecanum(-0.6, 0, 0)
    return mecanum(0, 0, 0)
  }
  return { spec, ticks: 800, time: uneven, out: (k) => outputs(drive(k)) }
}

// (6) 4c 센서(BIOBUZZ): 빨강 벽을 향한(요 −π/2) 메카넘이 FLOWER <3> 쪽(필드 +X = 로봇 왼쪽)으로 비스듬히 벽에 다가가 민 뒤
// 물러난다. 거리 센서 둘(앞 가운데 h 0.14는 벽 판, 리프트 몸체 왼쪽 옆을 보는 것은 FLOWER 면), 컬러 센서 둘(섀시 앞 아래
// d 0.015는 타일, 리프트 몸체 아래를 보는 것은 리프트 높이에 따라). 리프트는 올린 뒤 RUN_TO_POSITION, 고르지 않은 틱, 잡음 끔.
function biobuzzSensors(): Scenario {
  const lift = liftJoint()
  const base = robotSpec(
    { start: { x: 0.05, y: -0.9, yaw: -Math.PI / 2 } },
    {
      field: { season: 'biobuzz', hiveTipped: [false, false] },
      joints: [lift],
      distanceSensors: [
        {
          device: 'front',
          mount: { body: -1, position: { x: HALF, y: 0, z: 0.14 }, rotation: ZERO }
        },
        {
          device: 'side',
          mount: {
            body: 0,
            position: { x: 0.15, y: HALF, z: 0.05 },
            rotation: { x: 0, y: 0, z: Math.PI / 2 }
          }
        }
      ],
      colorSensors: [
        {
          device: 'floor',
          mount: {
            body: -1,
            position: { x: HALF - 0.02, y: -0.1, z: 0.015 },
            rotation: { x: 0, y: Math.PI / 2, z: 0 }
          }
        },
        {
          device: 'liftFloor',
          mount: {
            body: 0,
            position: { x: 0.1, y: -0.15, z: -0.08 },
            rotation: { x: 0, y: Math.PI / 2, z: 0 }
          }
        }
      ]
    }
  )
  const spec: WorldSpec = { ...base, motors: [...base.motors, liftMotor('lift')] }
  // 요 −π/2: 로봇 앞 = 필드 −Y(빨강 벽), 로봇 왼쪽 = 필드 +X(FLOWER <3>)
  const drive = (k: number): ReturnType<typeof mecanum> => {
    if (k < 260) return mecanum(0.5, -0.2, 0)
    if (k < 380) return mecanum(0.6, -0.2, 0)
    if (k < 520) return mecanum(-0.5, 0.2, 0.1)
    return mecanum(0, 0, 0)
  }
  const liftDrive = (k: number): DeviceValues => {
    if (k < 120) return liftOut(1)
    if (k < 400) return liftOut(0.8, { mode: 'RUN_TO_POSITION', targetPosition: 200 })
    return liftOut(0, { zeroPower: 'FLOAT' })
  }
  return {
    spec,
    ticks: 600,
    time: uneven,
    out: (k) => ({ ...outputs(drive(k)), lift: liftDrive(k) })
  }
}

// (7) 4d 웹캠(BIOBUZZ, 잡음 끔): 빨강 관중석 벽 프리셋(요 π, 로봇 y −0.32385)의 메카넘 로봇 앞면 웹캠(높이 0.30 m, 위 30°)이
// 두 묶음을 보다가(RED AUDIENCE 34–37 전부, RED SCORING 30·31, 32·33은 다리) −X로 다가가 위 CELL이 화면 위로 벗어난다. 팬
// 관절(회전 +z, 로봇 앞 끝 위) 하위 웹캠(위 50°)은 팬이 돌면 보는 태그가 바뀐다. 웹캠 출력(스트리밍 640×480, 36h11, d 3)은
// 고정, 고르지 않은 틱.
const camOut: DeviceValues = {
  serialNumber: 'X',
  state: 'STREAMING',
  streaming: true,
  width: 640,
  height: 480,
  aprilTag: true,
  family: 'TAG_36h11',
  decimation: 3
}
function biobuzzCameras(): Scenario {
  const field = resolveSeason('biobuzz')
  const start = { x: field.perimeter.innerHalf - HALF, y: -0.32385, yaw: Math.PI }
  const pan: SimJointSpec = {
    parent: -1,
    type: 'revolute',
    origin: { position: { x: HALF - 0.05, y: 0, z: 0.25 }, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: { lower: -Math.PI / 2, upper: Math.PI / 2 },
    body: { mass: 0.2, centerOfMass: ZERO, inertia: [2e-4, 2e-4, 2e-4, 0, 0, 0] },
    friction: { coulomb: 0.02, viscous: 0.001 },
    spring: null,
    drive: {
      kind: 'motor',
      devices: ['pan'],
      ratio: 1 / 4,
      params: LIFT_PARAMS,
      rigging: { kind: 'direct' }
    },
    switches: []
  }
  const base = robotSpec(
    { start },
    {
      field: { season: 'biobuzz', hiveTipped: [false, false] },
      joints: [pan],
      cameras: [
        {
          device: 'front',
          mount: {
            body: -1,
            position: { x: HALF, y: 0, z: 0.3 },
            rotation: { x: 0, y: -Math.PI / 6, z: 0 }
          },
          model: 'logitechC920'
        },
        {
          device: 'turret',
          mount: {
            body: 0,
            position: { x: 0.05, y: 0, z: 0.05 },
            rotation: { x: 0, y: (-50 * Math.PI) / 180, z: 0 }
          },
          model: 'logitechC920'
        }
      ]
    }
  )
  const spec: WorldSpec = { ...base, motors: [...base.motors, liftMotor('pan')] }
  // 요 π: 로봇 앞 = 필드 −X(HIVE 쪽)
  const drive = (k: number): ReturnType<typeof mecanum> => {
    if (k < 60) return mecanum(0, 0, 0)
    if (k < 240) return mecanum(0.35, 0, 0)
    return mecanum(0, 0, 0)
  }
  const panDrive = (k: number): DeviceValues => liftOut(k < 120 ? 0 : k < 260 ? 0.3 : -0.3)
  return {
    spec,
    ticks: 400,
    time: uneven,
    out: (k) => ({ ...outputs(drive(k)), pan: panDrive(k), front: camOut, turret: camOut })
  }
}

// 시나리오가 덮으려는 것을 실제로 지나가는지(해시만으로는 시나리오가 아무 일도 하지 않아도 통과한다)
const seen = (ticks: Tick[], device: string, key: string, value: unknown): boolean =>
  ticks.some((t) => t.input[device]?.[key] === value)
const notified = (ticks: Tick[], code: string): boolean =>
  ticks.some((t) => t.notices.some((n) => n.code === code))

describe("시뮬레이터 기준 해시('none' 넷은 4단계 전 v3, 다섯째는 4ab BIOBUZZ, 여섯째는 4c 센서, 일곱째는 4d 웹캠)", () => {
  it('메카넘 + Pinpoint + 리프트', () => {
    const { ticks, hash } = trace(mecanumLift())
    const last = ticks[ticks.length - 1].pose
    expect(Math.hypot(last.x + 1.2, last.y - 0.3)).toBeGreaterThan(0.3)
    expect(ticks.some((t) => t.pose.blocked)).toBe(false)
    expect(seen(ticks, 'liftDown', 'pressed', false)).toBe(true)
    expect(Math.max(...ticks.map((t) => t.pose.joints?.[0] ?? 0))).toBeGreaterThan(0.05)
    expect(hash).toBe('dbc178916f49691b880c152d752e42ccb38269791ad667ad85e06bc7711edc79')
  })

  it('벽 밀기', () => {
    const { ticks, hash } = trace(wallPush())
    expect(ticks.filter((t) => t.pose.blocked).length).toBeGreaterThan(50)
    expect(ticks[ticks.length - 1].pose.blocked).toBe(false)
    expect(hash).toBe('cb015e6144f9861e3cf37452ee82c76f27a3831663480cf89889ff3b1fc9ff33')
  })

  it('관절만(고정 기저)', () => {
    const { ticks, hash } = trace(jointsOnly())
    expect(ticks.every((t) => t.pose.x === 0 && t.pose.y === 0 && t.pose.yaw === 0)).toBe(true)
    expect(seen(ticks, 'liftUp', 'state', false)).toBe(true)
    expect(ticks[ticks.length - 1].pose.joints).toHaveLength(4)
    expect(hash).toBe('cb55f15901ed1b46346dae4d24a787aaedb3e4ff3d3abcb2c56bfcd3a33fc4f7')
  })

  it('BIOBUZZ 구조물 접촉(4ab 기준, 같은 프로세스에서 두 번 바이트가 같다)', () => {
    // 한 번은 Articulation.step에 들어간 밖의 행 키를 모아 덮는 접촉을 확인한다(해시에는 들어가지 않는다)
    const keys = new Set<string>()
    const original = Articulation.prototype.step
    const spy = vi.spyOn(Articulation.prototype, 'step').mockImplementation(function (
      this: Articulation,
      h,
      drive,
      contacts
    ) {
      for (const row of contacts?.rows ?? []) keys.add(row.key)
      return original.call(this, h, drive, contacts)
    })
    const first = trace(biobuzzContact(), 'biobuzz')
    spy.mockRestore()
    const { ticks, hash } = trace(biobuzzContact(), 'biobuzz')
    expect(hash).toBe(first.hash)
    expect(ticks.filter((t) => t.pose.blocked).length).toBeGreaterThan(50)
    // 벽(빨강 벽 y−), FLOWER <3>(순번 11), 다리 (+X,−Y)(순번 5)의 법선 행이 모두 들어갔다
    const normals = [...keys].filter((k) => k.startsWith('n'))
    expect(normals.some((k) => k.startsWith('ny-'))).toBe(true)
    expect(normals.some((k) => k.startsWith('ns11.'))).toBe(true)
    expect(normals.some((k) => k.startsWith('ns5.'))).toBe(true)
    expect(ticks[ticks.length - 1].pose.blocked).toBe(false)
    expect(hash).toBe('ac93852541573361e073684b10d05900a5a35cd6ff928c4045d7f79bf4706f4f')
  })

  it('4c 거리·컬러 센서(BIOBUZZ, 같은 프로세스에서 두 번 바이트가 같다)', () => {
    const first = traceWith(biobuzzSensors(), 'biobuzz', (text) =>
      text.replaceAll('"distance":null', '')
    )
    const { ticks, hash } = traceWith(biobuzzSensors(), 'biobuzz', (text) =>
      text.replaceAll('"distance":null', '')
    )
    expect(hash).toBe(first.hash)
    // 덮으려는 것: 거리 센서가 범위 밖과 수를 오가고(앞은 벽 판, 옆은 FLOWER), 컬러 값이 바뀐다, 로봇이 벽·FLOWER에 막힌다
    for (const device of ['front', 'side']) {
      expect(seen(ticks, device, 'distance', null)).toBe(true)
      expect(ticks.some((t) => typeof t.input[device]?.distance === 'number')).toBe(true)
    }
    expect(
      new Set(ticks.map((t) => t.input.liftFloor?.red).filter((v) => v !== undefined)).size
    ).toBeGreaterThan(3)
    // 타일 위 컬러 센서는 첫 틱에 네 키를 보내고 그 뒤 값이 같아 다시 보내지 않는다
    expect(ticks[0].input.floor).toEqual({ red: 309, green: 331, blue: 213, proximity: 288 })
    expect(ticks.slice(1).every((t) => t.input.floor === undefined)).toBe(true)
    expect(ticks.filter((t) => t.pose.blocked).length).toBeGreaterThan(20)
    expect(hash).toBe('d73506bb7132142d9e74f547b281d680e8c955166f20f383a8987e1f8a6f2f2c')
  })

  it('4d 웹캠(BIOBUZZ, 잡음 끔, 같은 프로세스에서 두 번 바이트가 같다)', () => {
    const first = trace(biobuzzCameras(), 'biobuzz')
    const { ticks, hash } = trace(biobuzzCameras(), 'biobuzz')
    expect(hash).toBe(first.hash)
    const ids = (tags: unknown): string =>
      (tags as number[]).filter((_, i) => i % 9 === 0).join(',')
    // 덮으려는 것: 앞 웹캠이 두 묶음(30·31, 34–37)을 보다가 다가가면 위 CELL을 놓친다, 팬 웹캠의 태그가 바뀐다
    const front = ticks.flatMap((t) =>
      t.input.front?.tags !== undefined ? [ids(t.input.front.tags)] : []
    )
    expect(front[0]).toBe('30,31,34,35,36,37')
    expect(front.some((list) => !list.includes('34'))).toBe(true)
    const turret = new Set(
      ticks.flatMap((t) => (t.input.turret?.tags !== undefined ? [ids(t.input.turret.tags)] : []))
    )
    expect(turret.size).toBeGreaterThan(2)
    expect(ticks[0].input.front).toEqual({ model: 'logitechC920' })
    expect(hash).toBe('f6d7c14e8289b755b48818f7176b9baed885861069aa47afee722e7e98789b2c')
  })

  it('바퀴·관절 없음', () => {
    const { ticks, hash } = trace(motorsOnly())
    expect(notified(ticks, 'sharedEncoderMode')).toBe(true)
    expect(ticks.every((t) => t.pose.joints === undefined)).toBe(true)
    expect(hash).toBe('6e4336337367b6cc2ec80aa3faf4d0b4b24242de8d009ca8ae1acbec2649e97a')
  })
})
