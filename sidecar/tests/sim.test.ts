// 시뮬레이터 통합 테스트(진짜 JVM): 사이드카(org.sandbot.runtime.Main)에 테스트 구성(opmodes-sim/sandbot_sim_bot.xml)과 팀 코드처럼
// 쓴 OpMode를 주고, 메인 프로세스의 SidecarSession 대신 작은 결정적 호스트(틱마다 바로 답, 정한 게임패드, 정한 틱에 START)에
// 운동학 시뮬레이터(src/shared/sim/world.ts의 PhysicsWorld)를 붙인다. 틱이 오면 world.step(그 틱의 시각·출력)의 입력을
// 그 답에 싣는다(SidecarSession과 같은 순서). JDK가 없으면 건너뛴다.
//  - 메카넘 TeleOp + 고정 게임패드(앞으로 1초, 그다음 왼쪽으로 회전) → 기대 방향 이동, 팀 코드가 읽은 IMU·엔코더·Pinpoint
//  - RUN_TO_POSITION Autonomous의 while (isBusy())가 정한 가상 시간 안에 끝나고 목표 허용 오차 안에 선다
//  - 같은 입력으로 두 번 → 같은 자세열(바이트까지)
//  - 4c 거리·컬러 센서(spec-4c I1·I2·I4): 벽으로 다가가는 메카넘의 거리 센서를 읽는 OpMode, 테이프를 가로지르는 컬러 센서
//    OpMode(속도·시작 위상별), 고치지 않은 SDK 샘플 RobotAutoDriveToLine_Linear(회색 타일 위 컬러 센서)
import { spawn } from 'node:child_process'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type GamepadState,
  type HostMessage,
  type SidecarMessage,
  type TickMessage
} from '../../src/shared/sidecarProtocol'
import { ensureFtcSamples, FetchError } from '../../scripts/fetch-ftc-sdk.mjs'
import { resolveSeason } from '../../src/shared/sim/seasons/seasons'
import { testChassis, testMotorParams, testWheelPhysics } from '../../src/shared/sim/testkit'
import { PhysicsWorld } from '../../src/shared/sim/world'
import { WORLD_SPEC_VERSION, type SimPose, type WorldSpec } from '../../src/shared/sim/worldSpec'
import { SIDECAR_TEST_TIMEOUT, sidecarBuild, testTempDir, type SidecarBuild } from './support'

const build = await sidecarBuild()

const OPMODES = resolve(__dirname, 'opmodes-sim')
const CONFIG = join(OPMODES, 'sandbot_sim_bot.xml')
const START_TICK = 4
const LX = 0.168
const LY = 0.18
const RADIUS = 0.052
const HALF = 0.2286

// opmodes-sim의 로봇: 왼쪽 모터는 인스펙터 REVERSE(팀 코드의 setDirection과 같음), Pinpoint X 포드는 왼쪽 100 mm,
// Y 포드는 뒤 80 mm(팀 코드의 setOffsets(100, -80))
const GOBILDA_19 = testMotorParams('goBILDA5202SeriesMotor', 19.2)

const SPEC: WorldSpec = {
  version: WORLD_SPEC_VERSION,
  // 'none' 시즌: (−0.5, 0.2)에서 도는 이 로봇은 BIOBUZZ HIVE 터널 안이라 다리·발판 막대에 걸린다(3c와 바이트까지 같은 벽)
  field: { season: 'none', hiveTipped: [false, false] },
  distanceSensors: [],
  colorSensors: [],
  noise: { enabled: false, seed: 0 },
  cameras: [],
  robot: {
    start: { x: -0.5, y: 0.2, yaw: 0 },
    footprint: [
      { x: HALF, y: HALF },
      { x: -HALF, y: HALF },
      { x: -HALF, y: -HALF },
      { x: HALF, y: -HALF }
    ],
    // 18 in(공칭 시작 크기)
    height: 0.4572,
    body: testChassis()
  },
  batteryVoltage: 12.5,
  hubs: ['Control Hub'],
  motors: [
    {
      device: 'frontLeft',
      modelTag: 'goBILDA5202SeriesMotor',
      gearbox: 19.2,
      directionSign: -1,
      params: GOBILDA_19
    },
    {
      device: 'frontRight',
      modelTag: 'goBILDA5202SeriesMotor',
      gearbox: 19.2,
      directionSign: 1,
      params: GOBILDA_19
    },
    {
      device: 'backLeft',
      modelTag: 'goBILDA5202SeriesMotor',
      gearbox: 19.2,
      directionSign: -1,
      params: GOBILDA_19
    },
    {
      device: 'backRight',
      modelTag: 'goBILDA5202SeriesMotor',
      gearbox: 19.2,
      directionSign: 1,
      params: GOBILDA_19
    }
  ],
  wheels: (
    [
      ['frontLeft', LX, LY, 'flbr'],
      ['frontRight', LX, -LY, 'frbl'],
      ['backLeft', -LX, LY, 'frbl'],
      ['backRight', -LX, -LY, 'flbr']
    ] as const
  ).map(([motor, x, y, rollers]) => ({
    position: { x, y },
    angle: 0,
    kind: 'mecanum' as const,
    rollers,
    radius: RADIUS,
    gearRatio: 1,
    motor,
    ...testWheelPhysics('mecanum', RADIUS)
  })),
  deadWheels: [],
  pinpoints: [
    {
      device: 'pinpoint',
      xPod: { x: 0.03, y: 0.1 },
      yPod: { x: -0.08, y: -0.02 },
      podTicksPerMm: 19.89436789,
      xReversed: false,
      yReversed: false
    }
  ],
  otos: [],
  imus: [{ device: 'imu' }],
  joints: []
}

const BUTTONS = [
  'dpad_up',
  'dpad_down',
  'dpad_left',
  'dpad_right',
  'a',
  'b',
  'x',
  'y',
  'guide',
  'start',
  'back',
  'left_bumper',
  'right_bumper',
  'left_stick_button',
  'right_stick_button',
  'touchpad'
] as const

function gamepad(sticks: Partial<GamepadState>): GamepadState {
  return {
    left_stick_x: 0,
    left_stick_y: 0,
    right_stick_x: 0,
    right_stick_y: 0,
    left_trigger: 0,
    right_trigger: 0,
    ...Object.fromEntries(BUTTONS.map((name) => [name, false])),
    ...sticks
  } as GamepadState
}

type SimRun = {
  messages: SidecarMessage[]
  // 틱마다 step 뒤에 합친 입력(장치 → 키 → 값, 사이드카가 그 틱부터 보는 값)
  states: { tNanos: number; state: Record<string, Record<string, unknown>> }[]
  // 틱마다 step 뒤의 자세와 모터 엔코더(허브 원시 틱, 사이드카가 그 틱부터 보는 값)
  poses: { tNanos: number; pose: SimPose }[]
  encoders: { tNanos: number; position: Record<string, number> }[]
  ticks: TickMessage[]
  stderr: string
}

// 실행 설정: 세계 설명·구성 XML·OpMode 소스(기본은 opmodes-sim의 Sim Bot과 teamcode 패키지)
type SimSetup = {
  spec: WorldSpec
  config: string
  sourceRoots: string[]
  opModeSource: string
  opModeClass: string
}

function teamOpMode(opMode: string, spec = SPEC, config = CONFIG): SimSetup {
  return {
    spec,
    config,
    sourceRoots: [OPMODES],
    opModeSource: join(OPMODES, 'org', 'firstinspires', 'ftc', 'teamcode', `${opMode}.java`),
    opModeClass: `org.firstinspires.ftc.teamcode.${opMode}`
  }
}

// 결정적 호스트: 틱마다 바로 답하고, START_TICK에 START, 게임패드는 틱 번호로 정한다
function runSim(
  b: SidecarBuild,
  opMode: string | SimSetup,
  pad: (tick: number) => GamepadState | null
): Promise<SimRun> {
  const setup = typeof opMode === 'string' ? teamOpMode(opMode) : opMode
  const spec = setup.spec
  return new Promise((done, fail) => {
    const world = new PhysicsWorld(spec)
    const child = spawn(
      b.java,
      [
        '-Xss4m',
        '-Dfile.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        '-cp',
        [b.runtimeJar, b.sdkJar].join(delimiter),
        'org.sandbot.runtime.Main'
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const run: SimRun = {
      messages: [],
      states: [],
      poses: [],
      encoders: [],
      ticks: [],
      stderr: ''
    }
    const state: Record<string, Record<string, unknown>> = {}
    const position: Record<string, number> = {}
    let pending = ''
    let finished = false
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out\n${run.stderr}`))
    }, 120_000)
    const onLine = (line: string): void => {
      let message: SidecarMessage
      try {
        message = JSON.parse(line) as SidecarMessage
      } catch {
        return
      }
      run.messages.push(message)
      if (message.type === 'finished') finished = true
      if (finished || message.type !== 'tick') return
      run.ticks.push(message)
      // SidecarSession과 같다: 틱이 도착하면 그 틱까지 적분하고, 그 입력을 이 틱의 답에 싣는다
      const inputs = world.step(message.tNanos, message.outputs)
      run.poses.push({ tNanos: message.tNanos, pose: world.pose() })
      for (const [device, values] of Object.entries(inputs))
        state[device] = { ...state[device], ...values }
      run.states.push({ tNanos: message.tNanos, state: { ...state } })
      for (const motor of spec.motors) {
        const value = inputs[motor.device]?.position
        if (typeof value === 'number') position[motor.device] = value
      }
      run.encoders.push({ tNanos: message.tNanos, position: { ...position } })
      send({
        type: 'tickReply',
        tick: message.tick,
        events: message.tick === START_TICK ? ['start'] : [],
        gamepads: [pad(message.tick), null],
        inputs,
        configSet: []
      })
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        onLine(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => (run.stderr += chunk))
    child.on('error', fail)
    child.on('close', () => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      done(run)
    })
    send({
      type: 'run',
      protocol: SIDECAR_PROTOCOL_VERSION,
      clock: 'virtual',
      tickNanos: DEFAULT_TICK_NANOS,
      sourceRoots: setup.sourceRoots,
      opModeSource: setup.opModeSource,
      opModeClass: setup.opModeClass,
      registeredName: null,
      registrars: [],
      firstFolder: testTempDir('first'),
      bootClasspath: [],
      compileClasspath: [b.sdkJar],
      libraryClasspath: [],
      configXml: setup.config,
      timing: {},
      jitter: 0,
      seed: 0,
      startEpochMillis: 1_700_000_000_000,
      stallMillis: 5000,
      teamCalibrations: null
    })
  })
}

// RESULT 줄(키=값)과 그 줄을 쓴 가상 시각
function result(run: SimRun): { values: Record<string, number>; tNanos: number } {
  for (const m of run.messages) {
    if (m.type !== 'log' || m.stream !== 'out' || !m.text.startsWith('RESULT ')) continue
    const values: Record<string, number> = {}
    for (const pair of m.text.slice('RESULT '.length).trim().split(' ')) {
      const [key, value] = pair.split('=')
      values[key] = value === 'true' ? 1 : value === 'false' ? 0 : Number(value)
    }
    return { values, tNanos: m.tNanos }
  }
  throw new Error(`no RESULT line\n${JSON.stringify(run.messages.slice(-5))}`)
}

function finishedReason(run: SimRun): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

function errors(run: SimRun): SidecarMessage[] {
  return run.messages.filter((m) => m.type === 'error')
}

// 팀 코드가 tNanos에 읽은 값은 그 앞 틱 경계(그 틱의 답)의 입력이다
function poseAt(run: SimRun, tNanos: number): SimPose {
  const before = run.poses.filter((p) => p.tNanos <= tNanos)
  return before[before.length - 1].pose
}

// 팀 코드는 RESULT를 쓰기 조금 전에 읽었다(그 사이 틱 경계가 있을 수 있다): 그 앞 몇 틱 중 하나와 맞아야 한다
const RECENT_TICKS = 4

function recent<T extends { tNanos: number }>(list: T[], tNanos: number): T[] {
  return list.filter((p) => p.tNanos <= tNanos).slice(-RECENT_TICKS)
}

function closest(values: number[], target: number): number {
  return Math.min(...values.map((v) => Math.abs(v - target)))
}

// ---- 4c 거리·컬러 센서(spec-4c I1·I2·I4) ----

const NONE_FIELD = resolveSeason('none')
// I1: Sim Bot에서 Pinpoint를 빼고 앞 가운데(h 0.14)에 거리 센서. 'none' +X 벽 판 안쪽 면에서 1.4 m(범위 밖)부터 다가간다
const DISTANCE_SPEC: WorldSpec = {
  ...SPEC,
  robot: {
    ...SPEC.robot,
    start: {
      x: NONE_FIELD.perimeter.innerHalf + NONE_FIELD.perimeter.panelInset - HALF - 1.4,
      y: 0,
      yaw: 0
    }
  },
  pinpoints: [],
  distanceSensors: [
    {
      device: 'sensor_distance',
      mount: { body: -1, position: { x: HALF, y: 0, z: 0.14 }, rotation: { x: 0, y: 0, z: 0 } }
    }
  ]
}

// I4: SDK 샘플 RobotAutoDriveToLine_Linear의 2륜(left_drive REVERSE·right_drive FORWARD, 일반 바퀴)과 뒤 옴니 둘(구동 안 함),
// 앞 아래를 보는 컬러 센서(하우징 앞면 높이 1.5 cm). BIOBUZZ 회색 타일 위(테이프·구조물에서 먼 자리)에서 시작한다
const LINE_WHEEL_Y = 0.18
const LINE_SPEC: WorldSpec = {
  ...SPEC,
  field: { season: 'biobuzz', hiveTipped: [false, false] },
  robot: { ...SPEC.robot, start: { x: 1.0, y: 0.3, yaw: 0 } },
  motors: [
    {
      device: 'left_drive',
      modelTag: 'goBILDA5202SeriesMotor',
      gearbox: 19.2,
      directionSign: -1,
      params: GOBILDA_19
    },
    {
      device: 'right_drive',
      modelTag: 'goBILDA5202SeriesMotor',
      gearbox: 19.2,
      directionSign: 1,
      params: GOBILDA_19
    }
  ],
  wheels: (
    [
      ['left_drive', LX, LINE_WHEEL_Y, 'traction'],
      ['right_drive', LX, -LINE_WHEEL_Y, 'traction'],
      [null, -LX, LINE_WHEEL_Y, 'omni'],
      [null, -LX, -LINE_WHEEL_Y, 'omni']
    ] as const
  ).map(([motor, x, y, kind]) => ({
    position: { x, y },
    angle: 0,
    kind,
    rollers: null,
    radius: RADIUS,
    gearRatio: 1,
    motor,
    ...testWheelPhysics(kind, RADIUS)
  })),
  pinpoints: [],
  colorSensors: [
    {
      device: 'sensor_color',
      mount: {
        body: -1,
        position: { x: HALF - 0.02, y: 0, z: 0.015 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 }
      }
    }
  ]
}

// I2: I4와 같은 2륜 로봇이 BIOBUZZ 빨강 LOADING ZONE 앞 테이프(y [−1.53886, −1.51346], x −0.9)를 직각으로 가로지른다(요 −90°,
// 필드 −y로 감). 컬러 센서(아래 1.5 cm, 로봇 앞 HALF − 0.02)가 테이프 가까운 가장자리에서 runUp만큼 떨어진 자리에서 시작하고,
// 시작 위치를 속도 × 12.5 ms씩 앞으로 옮겨 테이프를 지나는 때를 LS 측정 격자(100 ms)에 대해 12.5 ms씩 당긴다(8개)
const CROSS_TAPE_NEAR_Y = -1.51346
const CROSS_TAPE_FAR_Y = -1.53886
const CROSS_SENSOR_AHEAD = HALF - 0.02
const CROSS_PHASE_NANOS = 12_500_000
function crossSpec(speed: number, runUp: number, phase: number): WorldSpec {
  const y =
    CROSS_TAPE_NEAR_Y + CROSS_SENSOR_AHEAD + runUp - (phase * speed * CROSS_PHASE_NANOS) / 1e9
  return { ...LINE_SPEC, robot: { ...LINE_SPEC.robot, start: { x: -0.9, y, yaw: -Math.PI / 2 } } }
}

// VL53L0X 연속 측정 주기(VL53L0XChip.MEASUREMENT_MS 33 ms)
const VL53L0X_MEASUREMENT_NANOS = 33_000_000

// 실행마다 같아야 하는 메시지 전부(컴파일 벽시계 시간 compiled.millis만 뺀다)
function deterministicMessages(run: SimRun): string {
  return JSON.stringify(run.messages.map((m) => (m.type === 'compiled' ? { ...m, millis: 0 } : m)))
}

// 칩 연속 측정의 위상 φ(연속 시작 시각 mod 33 ms, ns) 구간 [a, b)의 합집합. 위상은 사이드카 안(드라이버가 SYSRANGE_START를 쓴
// 가상 시각)이라 바깥에서 모르므로, 읽기마다 값이 맞는 φ를 모두 구해 모든 읽기에 공통인 φ가 있는지 본다.
type PhaseSet = [number, number][]

// 팀 코드가 r에 읽은 값 mm와 맞는 φ: 칩은 r 이하 마지막 측정 끝 e = r − ((r − φ) mod 33 ms)에서, e 이하 마지막 틱 경계의
// 입력을 잡는다(VL53L0XChip: 훅은 경계 b 전(e < b)에 끝난 측정을 옛 입력으로, 읽기는 e ≤ 지금인 측정을 지금 입력으로 잡는다).
// 드라이버 readRangeContinuousMillimeters는 새 측정을 기다린 뒤 RESULT_RANGE를 읽고 곧 줄을 쓰므로 r은 줄의 시각이다
// (그 사이 다음 측정 끝(33 ms 뒤)이 오지 않는다). 범위 밖(null)은 칩 8190 mm다.
function phasesFor(rangeAt: Map<number, number>, r: number, mm: number): PhaseSet {
  const period = VL53L0X_MEASUREMENT_NANOS
  const tick = DEFAULT_TICK_NANOS
  const out: PhaseSet = []
  for (let b = Math.floor(r / tick) * tick; b > r - period - tick; b -= tick) {
    // 경계 b의 입력을 잡는 측정 끝 e ∈ [lo, hi)
    const lo = Math.max(b, r - period + 1)
    const hi = Math.min(b + tick, r + 1)
    if (lo >= hi || rangeAt.get(b) !== mm) continue
    const a = ((lo % period) + period) % period
    const end = a + (hi - lo)
    if (end <= period) out.push([a, end])
    else out.push([a, period], [0, end - period])
  }
  return out
}

function intersectPhases(a: PhaseSet, b: PhaseSet): PhaseSet {
  const out: PhaseSet = []
  for (const [a0, a1] of a)
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0)
      const hi = Math.min(a1, b1)
      if (lo < hi) out.push([lo, hi])
    }
  return out
}

// 앞으로 1초(왼쪽 스틱 위 0.6), 그다음 왼쪽(반시계)으로 회전(오른쪽 스틱 왼쪽 0.5)
const TELEOP_PAD = (tick: number): GamepadState =>
  tick < START_TICK + 200 ? gamepad({ left_stick_y: -0.6 }) : gamepad({ right_stick_x: -0.5 })

describe.skipIf(build === null)('시뮬레이터 + 진짜 사이드카', () => {
  const sidecar = build as SidecarBuild

  it(
    '메카넘 TeleOp: 고정 게임패드로 앞으로 가고 왼쪽으로 돌며, 팀 코드의 IMU·엔코더·Pinpoint가 시뮬레이터와 맞다. 두 번 돌리면 같은 자세열',
    async () => {
      const run = await runSim(sidecar, 'SimMecanumTeleOp', TELEOP_PAD)
      expect(errors(run), run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      const { values, tNanos } = result(run)
      expect(values.loops).toBeGreaterThan(100)
      const start = SPEC.robot.start
      const end = poseAt(run, tNanos)
      // 앞(+x)으로 갔고 왼쪽으로(반시계) 돌았다
      expect(end.x - start.x).toBeGreaterThan(0.6)
      expect(Math.abs(end.y - start.y)).toBeLessThan(0.1)
      expect(end.yaw).toBeGreaterThan(1)
      expect(end.blocked).toBe(false)
      // 팀 코드가 읽은 IMU 요(float 쿼터니언)는 그때의 시뮬레이터 요
      const poses = recent(run.poses, tNanos).map((p) => p.pose)
      expect(
        closest(
          poses.map((p) => p.yaw),
          values.yaw
        )
      ).toBeLessThan(1e-4)
      // 엔코더(팀 코드 기준, 앞으로 구르면 +): 평균은 몸체 앞 성분의 굴림(곡선 길이, ≥ 필드 앞 이동)이고, 왼쪽 회전에서 오른쪽
      // 바퀴가 더 갔다. 동역학(3c)이라 바퀴는 출발에서 헛돌아 더 세고, 서는 동안(BRAKE) 바퀴가 먼저 서고 몸체가 미끄러져 덜 센다:
      // 그 몫은 몇 cm다(비평 §3.4: 1.6 m/s BRAKE 정지에서 −3.4 cm)
      const ticksPerMeter = 537.6 / (2 * Math.PI * RADIUS)
      const mean = (values.fl + values.fr + values.bl + values.br) / 4
      expect(mean).toBeGreaterThan((end.x - start.x - 0.05) * ticksPerMeter)
      expect(values.fr - values.fl).toBeGreaterThan(1000)
      expect(values.br - values.bl).toBeGreaterThan(1000)
      // 시뮬레이터 입력은 허브 부호: 오른쪽(FORWARD, CCW 형식)은 팀 코드에서 부호가 바뀌고 왼쪽(REVERSE)은 그대로다.
      // RESULT를 쓰기 조금 전에 읽었으므로(바퀴가 서는 중) 몇 틱 차이는 둔다.
      const hub = recent(run.encoders, tNanos).map((e) => e.position)
      expect(
        closest(
          hub.map((h) => -h.frontRight),
          values.fr
        )
      ).toBe(0)
      expect(
        closest(
          hub.map((h) => -h.backRight),
          values.br
        )
      ).toBe(0)
      expect(
        closest(
          hub.map((h) => h.frontLeft),
          values.fl
        )
      ).toBe(0)
      expect(
        closest(
          hub.map((h) => h.backLeft),
          values.bl
        )
      ).toBe(0)
      // Pinpoint(펌웨어처럼 포드 틱·팀 오프셋·IMU로 적분, mm): 시작 틀의 이동과 같다
      // 포드 틱 양자화·중간 각 적분 오차는 1 mm 안쪽
      expect(
        closest(
          poses.map((p) => (p.x - start.x) * 1000),
          values.px
        )
      ).toBeLessThan(1)
      expect(
        closest(
          poses.map((p) => (p.y - start.y) * 1000),
          values.py
        )
      ).toBeLessThan(1)
      expect(
        closest(
          poses.map((p) => p.yaw),
          values.ph
        )
      ).toBeLessThan(1e-5)

      const again = await runSim(sidecar, 'SimMecanumTeleOp', TELEOP_PAD)
      expect(JSON.stringify(again.poses)).toBe(JSON.stringify(run.poses))
      expect(result(again).values).toEqual(values)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'RUN_TO_POSITION Autonomous: while (isBusy())가 정한 가상 시간 안에 끝나고 목표 허용 오차 안에 선다',
    async () => {
      const run = await runSim(sidecar, 'SimRunToPosition', () => null)
      expect(errors(run), run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      const { values, tNanos } = result(run)
      expect(values.active).toBe(1)
      expect(values.millis).toBeGreaterThan(500)
      expect(values.millis).toBeLessThan(4000)
      for (const key of ['fl', 'fr', 'bl', 'br'])
        expect(Math.abs(values[key] - 1000)).toBeLessThanOrEqual(5)
      // 1000틱 = 1000 / 537.6 바퀴 × 둘레. 동역학(3c): 몸체 이동은 엔코더 거리 ± 1 cm(서는 동안 바퀴가 먼저 서고 몸체가 조금
      // 미끄러진다, spec-3c T11)
      const travel = (1000 / 537.6) * 2 * Math.PI * RADIUS
      const end = poseAt(run, tNanos)
      expect(Math.abs(end.x - SPEC.robot.start.x - travel)).toBeLessThan(0.01)
      // 모터가 차례로 출발해 잠깐 틀어지지만 같은 굴림으로 끝나므로 거의 돌아온다(허용 오차 5틱 안)
      expect(Math.abs(end.yaw)).toBeLessThan(0.01)
      // 유계: 허브 기본 PIDF(위치 P10·속도 PIDF)는 무거운 구동계에서 조금 넘칠 수 있다(실제 펌웨어도 같다, 3b 리프트와 같은
      // 기준). 로봇은 목표 거리를 1 cm 넘게, 팀 코드 기준 엔코더(오른쪽 = −(허브 − 리셋 오프셋))는 60틱 넘게 넘지 않는다
      const positions = run.poses.map((p) => p.pose.x - SPEC.robot.start.x)
      expect(Math.max(...positions)).toBeLessThan(travel + 0.01)
      const reset = run.ticks.at(-1)?.outputs.frontRight.encoderOffset as number
      expect(typeof reset).toBe('number')
      // 리셋 횟수는 늘 보내고, 리셋 한 번이면 1(데드휠과 포트를 함께 쓰면 시뮬레이터가 이것으로 축 기준을 잡는다)
      expect(run.ticks[0].outputs.frontRight.encoderResets).toBe(0)
      expect(run.ticks.at(-1)?.outputs.frontRight.encoderResets).toBe(1)
      const counted = run.encoders.map((e) => -(e.position.frontRight - reset))
      expect(Math.max(...counted)).toBeLessThan(1000 + 60)
    },
    SIDECAR_TEST_TIMEOUT
  )
  it(
    'I1 거리 센서: 벽으로 다가가며 팀 코드의 getDistance가 단조 비증가이고 각 값이 33 ms 측정 끝 틱의 세계 값과 같다. 두 번 바이트가 같다',
    async () => {
      const run = await runSim(
        sidecar,
        teamOpMode('SimDistanceApproach', DISTANCE_SPEC, join(OPMODES, 'sandbot_sim_distance.xml')),
        () => null
      )
      expect(errors(run), run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      expect(result(run).values.stopped).toBe(1)
      const ranges = run.messages.flatMap((m) =>
        m.type === 'log' && m.stream === 'out' && m.text.startsWith('RANGE ')
          ? [{ tNanos: m.tNanos, mm: Number(m.text.slice('RANGE '.length)) }]
          : []
      )
      // 처음은 범위 밖(1.4 m, 칩 8190 mm), 그다음 숫자가 줄어들고 150 mm 아래에서 선다
      expect(ranges[0].mm).toBe(8190)
      expect(ranges.length).toBeGreaterThan(20)
      expect(ranges[ranges.length - 1].mm).toBeLessThan(150)
      for (let i = 1; i < ranges.length; i++)
        expect(ranges[i].mm).toBeLessThanOrEqual(ranges[i - 1].mm)
      // 각 값이 그 측정 끝(33 ms 격자) 틱의 세계 값과 같다: 모든 읽기에 공통인 측정 위상이 있다(통합 뒤 C의 칩 측정 시각으로 조임)
      const rangeAt = new Map(
        run.states.map((s) => {
          const d = s.state.sensor_distance?.distance
          return [s.tNanos, typeof d === 'number' ? Math.round(d * 1000) : 8190] as const
        })
      )
      let phases: PhaseSet = [[0, VL53L0X_MEASUREMENT_NANOS]]
      for (const r of ranges) {
        phases = intersectPhases(phases, phasesFor(rangeAt, r.tNanos, r.mm))
        expect(phases, `RANGE ${r.mm} @ ${r.tNanos}`).not.toEqual([])
      }
      // 시뮬레이터가 보낸 값도 줄어들기만 한다(벽 판 거울 + 확산)
      const world = run.states
        .map((s) => s.state.sensor_distance?.distance)
        .filter((d): d is number => typeof d === 'number')
      for (let i = 1; i < world.length; i++) expect(world[i]).toBeLessThanOrEqual(world[i - 1])

      const again = await runSim(
        sidecar,
        teamOpMode('SimDistanceApproach', DISTANCE_SPEC, join(OPMODES, 'sandbot_sim_distance.xml')),
        () => null
      )
      expect(deterministicMessages(again)).toBe(deterministicMessages(run))
      expect(JSON.stringify(again.states)).toBe(JSON.stringify(run.states))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'I2 컬러 센서: 0.15 m/s로 테이프를 가로지르면 시작 위상 8개 모두 문턱을 넘고, 1.5 m/s면 잡는 위상과 놓치는 위상이 모두 있다',
    async () => {
      // 허브 속도 루프(적분 I)가 목표 속도에 다가가는 데 시간이 걸려 충분히 달린 뒤 지난다: 느림은 테이프 앞 0.3 m에서 시작해
      // 엔코더 0.45 m에서, 빠름은 1.0 m에서 시작해 1.25 m에서 선다(SimColorCrossSlow·Fast의 travel. 출발 헛돎으로 엔코더가 앞선다)
      const cases = [
        { opMode: 'SimColorCrossSlow', speed: 0.15, runUp: 0.3 },
        { opMode: 'SimColorCrossFast', speed: 1.5, runUp: 1.0 }
      ]
      const caught: Record<string, boolean[]> = {}
      for (const c of cases) {
        const runs = await Promise.all(
          Array.from({ length: 8 }, (_, phase) =>
            runSim(
              sidecar,
              teamOpMode(
                c.opMode,
                crossSpec(c.speed, c.runUp, phase),
                join(OPMODES, 'sandbot_sim_line.xml')
              ),
              () => null
            )
          )
        )
        caught[c.opMode] = runs.map((run) => {
          expect(errors(run), run.stderr).toEqual([])
          expect(finishedReason(run)).toBe('returned')
          const values = result(run).values
          // 값은 기록한다(spec-4c I2)
          console.info(`${c.opMode} maxRed=${values.maxRed} reads=${values.reads}`)
          // 센서가 테이프를 다 지났고(빠른 실행은 제동하다 빨강 벽에 닿기도 한다), 테이프 가운데를 지날 때 바닥 속도(앞뒤 100 ms,
          // 200 ms 구간 평균: 허브 속도 루프가 50 ms 측정 속도로 제어해 낮은 속도에서는 100 ms 안에서도 흔들린다)가 목표의 10% 안이다
          // (정상 상태에서 가로지름)
          const sensorY = (p: SimPose): number => p.y - CROSS_SENSOR_AHEAD
          expect(sensorY(run.poses[run.poses.length - 1].pose)).toBeLessThan(
            CROSS_TAPE_FAR_Y - 0.02
          )
          const k = run.poses.findIndex((p) => sensorY(p.pose) < CROSS_TAPE_NEAR_Y - 0.0127)
          const [a, b] = [run.poses[k - 20], run.poses[k + 20]]
          const speed = ((a.pose.y - b.pose.y) * 1e9) / (b.tNanos - a.tNanos)
          expect(Math.abs(speed - c.speed)).toBeLessThan(0.1 * c.speed)
          return values.caught === 1
        })
      }
      expect(caught.SimColorCrossSlow).toEqual(Array(8).fill(true))
      expect(caught.SimColorCrossFast).toContain(true)
      expect(caught.SimColorCrossFast).toContain(false)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'I4 SDK 샘플 RobotAutoDriveToLine_Linear(고치지 않음): 회색 타일 1.5 cm 위 Light Level 0.62–0.63이 문턱 0.5를 넘어 START 직후 끝난다',
    async (ctx) => {
      let samples: { dir: string; files: string[] }
      try {
        samples = await ensureFtcSamples({ log: () => {} })
      } catch (error) {
        // 받지 못하면(오프라인) 건너뛴다. 해시가 다른 것은 실패다(compat.test.ts와 같다)
        if (error instanceof FetchError && !/SHA-256/.test((error as Error).message)) {
          ctx.skip()
          return
        }
        throw error
      }
      const setup: SimSetup = {
        spec: LINE_SPEC,
        config: join(OPMODES, 'sandbot_sim_line.xml'),
        sourceRoots: [samples.dir],
        opModeSource: join(samples.dir, 'RobotAutoDriveToLine_Linear.java'),
        opModeClass:
          'org.firstinspires.ftc.robotcontroller.external.samples.RobotAutoDriveToLine_Linear'
      }
      const run = await runSim(sidecar, setup, () => null)
      expect(errors(run), run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      const levels = run.messages.flatMap((m) =>
        m.type === 'telemetry'
          ? m.frame.lines.filter((line) => line.startsWith('Light Level (0 to 1) : '))
          : []
      )
      expect(levels.length).toBeGreaterThan(0)
      for (const line of levels) expect(line).toMatch(/^Light Level \(0 to 1\) : 0\.6[23]$/)
      // 시뮬레이터가 보낸 칩 원래 값은 부록 A 타일 1.5 cm(309, 331, 213, PS 288)
      expect(run.states[0].state.sensor_color).toEqual({
        red: 309,
        green: 331,
        blue: 213,
        proximity: 288
      })
      // START 직후 루프가 끝나 거의 움직이지 않는다(critique E9: 실물도 그렇다)
      const finished = run.messages[run.messages.length - 1]
      const startNanos = START_TICK * DEFAULT_TICK_NANOS
      expect(finished.type === 'finished' && finished.tNanos - startNanos).toBeLessThan(200_000_000)
      const end = run.poses[run.poses.length - 1].pose
      expect(Math.hypot(end.x - 1.0, end.y - 0.3)).toBeLessThan(0.02)

      const again = await runSim(sidecar, setup, () => null)
      expect(deterministicMessages(again)).toBe(deterministicMessages(run))
      expect(JSON.stringify(again.states)).toBe(JSON.stringify(run.states))
    },
    SIDECAR_TEST_TIMEOUT
  )
})
