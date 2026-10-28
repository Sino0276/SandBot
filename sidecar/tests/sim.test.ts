// 시뮬레이터 통합 테스트(진짜 JVM): 사이드카(org.sandbot.runtime.Main)에 테스트 구성(opmodes-sim/sandbot_sim_bot.xml)과 팀 코드처럼
// 쓴 OpMode를 주고, 메인 프로세스의 SidecarSession 대신 작은 결정적 호스트(틱마다 바로 답, 정한 게임패드, 정한 틱에 START)에
// 운동학 시뮬레이터(src/shared/sim/world.ts의 KinematicWorld)를 붙인다. 틱이 오면 world.step(그 틱의 시각·출력)의 입력을
// 그 답에 싣는다(SidecarSession과 같은 순서). JDK가 없으면 건너뛴다.
//  - 메카넘 TeleOp + 고정 게임패드(앞으로 1초, 그다음 왼쪽으로 회전) → 기대 방향 이동, 팀 코드가 읽은 IMU·엔코더·Pinpoint
//  - RUN_TO_POSITION Autonomous의 while (isBusy())가 정한 가상 시간 안에 끝나고 목표 허용 오차 안에 선다
//  - 같은 입력으로 두 번 → 같은 자세열(바이트까지)
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
import { KinematicWorld } from '../../src/shared/sim/world'
import { WORLD_SPEC_VERSION, type SimPose, type WorldSpec } from '../../src/shared/sim/worldSpec'
import { SIDECAR_TEST_TIMEOUT, sidecarBuild, type SidecarBuild } from './support'

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
const SPEC: WorldSpec = {
  version: WORLD_SPEC_VERSION,
  robot: {
    start: { x: -0.5, y: 0.2, yaw: 0 },
    footprint: [
      { x: HALF, y: HALF },
      { x: -HALF, y: HALF },
      { x: -HALF, y: -HALF },
      { x: HALF, y: -HALF }
    ]
  },
  batteryVoltage: 12.5,
  hubs: ['Control Hub'],
  motors: [
    { device: 'frontLeft', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: -1 },
    { device: 'frontRight', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: 1 },
    { device: 'backLeft', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: -1 },
    { device: 'backRight', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: 1 }
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
    motor
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
  imus: [{ device: 'imu' }]
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
  // 틱마다 step 뒤의 자세와 모터 엔코더(허브 원시 틱, 사이드카가 그 틱부터 보는 값)
  poses: { tNanos: number; pose: SimPose }[]
  encoders: { tNanos: number; position: Record<string, number> }[]
  ticks: TickMessage[]
  stderr: string
}

// 결정적 호스트: 틱마다 바로 답하고, START_TICK에 START, 게임패드는 틱 번호로 정한다
function runSim(
  b: SidecarBuild,
  opMode: string,
  pad: (tick: number) => GamepadState | null
): Promise<SimRun> {
  return new Promise((done, fail) => {
    const world = new KinematicWorld(SPEC)
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
    const run: SimRun = { messages: [], poses: [], encoders: [], ticks: [], stderr: '' }
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
      for (const motor of SPEC.motors) {
        const value = inputs[motor.device]?.position
        if (typeof value === 'number') position[motor.device] = value
      }
      run.encoders.push({ tNanos: message.tNanos, position: { ...position } })
      send({
        type: 'tickReply',
        tick: message.tick,
        events: message.tick === START_TICK ? ['start'] : [],
        gamepads: [pad(message.tick), null],
        inputs
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
      sourceRoots: [OPMODES],
      opModeSource: join(OPMODES, 'org', 'firstinspires', 'ftc', 'teamcode', `${opMode}.java`),
      opModeClass: `org.firstinspires.ftc.teamcode.${opMode}`,
      sdkClasspath: [b.sdkJar],
      configXml: CONFIG,
      timing: {},
      jitter: 0,
      seed: 0,
      startEpochMillis: 1_700_000_000_000,
      stallMillis: 5000
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
      // 엔코더(팀 코드 기준, 앞으로 구르면 +): 평균은 앞으로 간 만큼 이상(곡선 길이), 왼쪽 회전에서 오른쪽 바퀴가 더 갔다
      const ticksPerMeter = 537.6 / (2 * Math.PI * RADIUS)
      const mean = (values.fl + values.fr + values.bl + values.br) / 4
      expect(mean).toBeGreaterThan((end.x - start.x) * ticksPerMeter * 0.99)
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
      // 1000틱 = 1000 / 537.6 바퀴 × 둘레
      const travel = (1000 / 537.6) * 2 * Math.PI * RADIUS
      const end = poseAt(run, tNanos)
      expect(end.x - SPEC.robot.start.x).toBeCloseTo(travel, 2)
      // 모터가 차례로 출발해 잠깐 틀어지지만 같은 굴림으로 끝나므로 거의 돌아온다(허용 오차 5틱 안)
      expect(Math.abs(end.yaw)).toBeLessThan(0.01)
      // 넘침 없이: 로봇이 목표 거리를 넘지 않았고, 팀 코드 기준 엔코더(오른쪽 = −(허브 − 리셋 오프셋))도 넘지 않았다
      const positions = run.poses.map((p) => p.pose.x - SPEC.robot.start.x)
      expect(Math.max(...positions)).toBeLessThanOrEqual(travel + 1e-6)
      const reset = run.ticks.at(-1)?.outputs.frontRight.encoderOffset as number
      expect(typeof reset).toBe('number')
      // 리셋 횟수는 늘 보내고, 리셋 한 번이면 1(데드휠과 포트를 함께 쓰면 시뮬레이터가 이것으로 축 기준을 잡는다)
      expect(run.ticks[0].outputs.frontRight.encoderResets).toBe(0)
      expect(run.ticks.at(-1)?.outputs.frontRight.encoderResets).toBe(1)
      const counted = run.encoders.map((e) => -(e.position.frontRight - reset))
      expect(Math.max(...counted)).toBeLessThanOrEqual(1000)
    },
    SIDECAR_TEST_TIMEOUT
  )
})
