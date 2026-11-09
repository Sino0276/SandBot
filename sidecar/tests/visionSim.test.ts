// 비전 통합 시험(spec-4d §4 "통합 시험" I1–I8, 진짜 JVM): 사이드카(org.sandbot.runtime.Main)에 웹캠이 있는 구성
// (opmodes-vision-sim/sandbot_vision_bot.xml)과 팀 코드(고치지 않은 FTC 샘플, 시험 OpMode)를 주고, sim.test.ts와 같은
// 결정적 호스트(틱마다 바로 답, 정한 틱에 START·STOP, 정한 게임패드)에 PhysicsWorld(BIOBUZZ, 잡음 끔)를 붙인다. 세계가
// 30 fps 격자의 틱에 웹캠 입력(원시 검출, apriltag 3 좌표)을 내고, 사이드카의 VisionPortal·AprilTagProcessor 손 구현이 자세를
// 푼다. 참 ftcPose는 같은 세계 자세로 TS에서 계산한다(AprilTagProcessorImpl.rawPoseToFtcPose와 같은 식). JDK가 없으면 건너뛴다.
//
// 허용 오차는 0.1 in·0.1°다(spec-4d §4: 세계 입력이 apriltag 3 좌표라 실제처럼 +0.5 px 치우침, 부록 B 장면에서 약 0.04 in·
// 0.025°). 고치지 않은 샘플의 텔레메트리는 %6.1f로 반올림되므로 그 비교에는 반올림 0.05를 더한다.
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { ensureFtcSamples, FetchError } from '../../scripts/fetch-ftc-sdk.mjs'
import { cameraReadingModel } from '../../src/renderer/src/editor/hardware/cameraReading'
import { snapRobotToPreset } from '../../src/renderer/src/editor/field/startPresetModel'
import { sdkCameraPose } from '../../src/renderer/src/hardware/mounting'
import { cameraExclusions } from '../../src/renderer/src/play/worldCameras'
import { withSensorNoise } from '../../src/renderer/src/play/worldSensors'
import { buildWorldSpec, runFieldOf, withRunField } from '../../src/renderer/src/play/worldSpec'
import { objectLocalBounds } from '../../src/renderer/src/scene/localBounds'
import type { HardwareComponent, SceneObjects } from '../../src/renderer/src/scene/model'
import { useSceneStore } from '../../src/renderer/src/scene/sceneStore'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  TAG_INPUT_STRIDE,
  type GamepadState,
  type HostMessage,
  type SidecarMessage,
  type TickMessage
} from '../../src/shared/sidecarProtocol'
import { clusterFieldPoses, type ClusterFieldPose } from '../../src/shared/sim/seasons/tagPoses'
import { resolveSeason } from '../../src/shared/sim/seasons/seasons'
import { snapRobotToStart } from '../../src/shared/sim/seasons/startPose'
import { planarFrame, sensorPose } from '../../src/shared/sim/sensorFrame'
import { testChassis, testMotorParams, testWheelPhysics } from '../../src/shared/sim/testkit'
import { CV_FROM_SENSOR } from '../../src/shared/sim/vision'
import { PhysicsWorld } from '../../src/shared/sim/world'
import {
  parseWorldSpec,
  WORLD_SPEC_VERSION,
  type SensorMount,
  type SimPose,
  type Vec3,
  type WorldSpec
} from '../../src/shared/sim/worldSpec'
import { SIDECAR_TEST_TIMEOUT, sidecarBuild, testTempDir, type SidecarBuild } from './support'

const build = await sidecarBuild()

const OPMODES = resolve(__dirname, 'opmodes-vision-sim')
const VISION_OPMODES = resolve(__dirname, 'opmodes-vision')
const CONFIG = join(OPMODES, 'sandbot_vision_bot.xml')
const START_TICK = 4
const LX = 0.168
const LY = 0.18
const RADIUS = 0.052
const HALF = 0.2286
const METERS_PER_INCH = 0.0254
const DEG = 180 / Math.PI
// 비교 허용 오차(spec-4d §4)와 텔레메트리 %6.1f 반올림
const TOLERANCE = 0.1
const DISPLAY_ROUNDING = 0.05

const BIOBUZZ = resolveSeason('biobuzz')
const CLUSTERS = clusterFieldPoses(BIOBUZZ, [false, false])
const cluster = (name: string): ClusterFieldPose => CLUSTERS.find((c) => c.name === name)!

// 앞면 웹캠: 렌즈 = 로봇 앞면 가운데, 높이 0.30 m, 위 30°(spec-4d §4 시험 장면 기준표)
const CAMERA_HEIGHT = 0.3
const CAMERA_PITCH = Math.PI / 6
const CAMERA_MOUNT: SensorMount = {
  body: -1,
  position: { x: HALF, y: 0, z: CAMERA_HEIGHT },
  rotation: { x: 0, y: -CAMERA_PITCH, z: 0 }
}

const FOOTPRINT = [
  { x: HALF, y: HALF },
  { x: -HALF, y: HALF },
  { x: -HALF, y: -HALF },
  { x: HALF, y: -HALF }
]

// 빨강 관중석 벽 프리셋(요 π)에 18 in 로봇을 로봇 y −0.32385로 붙인다(앞면 카메라 필드 x 1.336 m)
function presetStart(y = -0.32385): { x: number; y: number; yaw: number } {
  const preset = BIOBUZZ.startPresets.find((p) => p.key === 'audienceWall')!
  const snap = snapRobotToStart(FOOTPRINT, preset, BIOBUZZ.perimeter.innerHalf, y)
  if (!snap.ok) throw new Error('tooWide')
  return snap.pose
}

const GOBILDA_19 = testMotorParams('goBILDA5202SeriesMotor', 19.2)

function spec(start: { x: number; y: number; yaw: number }): WorldSpec {
  return {
    version: WORLD_SPEC_VERSION,
    field: { season: 'biobuzz', hiveTipped: [false, false] },
    distanceSensors: [],
    colorSensors: [],
    noise: { enabled: false, seed: 0 },
    cameras: [{ device: 'Webcam 1', mount: CAMERA_MOUNT, model: 'logitechC920' }],
    robot: { start, footprint: FOOTPRINT, height: 0.4572, body: testChassis() },
    batteryVoltage: 12.5,
    hubs: ['Control Hub'],
    motors: (
      [
        ['frontLeft', -1],
        ['frontRight', 1],
        ['backLeft', -1],
        ['backRight', 1]
      ] as const
    ).map(([device, directionSign]) => ({
      device,
      modelTag: 'goBILDA5202SeriesMotor',
      gearbox: 19.2,
      directionSign,
      params: GOBILDA_19
    })),
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
    pinpoints: [],
    otos: [],
    imus: [{ device: 'imu' }],
    joints: []
  }
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

function gamepad(state: Partial<GamepadState>): GamepadState {
  return {
    left_stick_x: 0,
    left_stick_y: 0,
    right_stick_x: 0,
    right_stick_y: 0,
    left_trigger: 0,
    right_trigger: 0,
    ...Object.fromEntries(BUTTONS.map((name) => [name, false])),
    ...state
  } as GamepadState
}

type Setup = {
  spec: WorldSpec
  config: string
  sourceRoots: string[]
  opModeSource: string
  opModeClass: string
}

type VisionSimRun = {
  messages: SidecarMessage[]
  // 틱마다 step 뒤의 자세(사이드카가 그 틱부터 보는 값)
  poses: { tNanos: number; pose: SimPose }[]
  // 세계가 낸 웹캠 프레임(그 틱 시각과 보이는 id)
  frames: { tNanos: number; ids: number[] }[]
  ticks: TickMessage[]
  stderr: string
}

// 결정적 호스트(sim.test.ts runSim과 같은 순서): 틱이 오면 world.step(그 틱의 시각·출력)의 입력을 그 답에 싣는다
function runVisionSim(
  b: SidecarBuild,
  setup: Setup,
  stopTick: number | null,
  pad: (tick: number) => GamepadState | null = () => null
): Promise<VisionSimRun> {
  return new Promise((done, fail) => {
    const world = new PhysicsWorld(setup.spec)
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
    const run: VisionSimRun = { messages: [], poses: [], frames: [], ticks: [], stderr: '' }
    let pending = ''
    let finished = false
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out\n${run.stderr}`))
    }, 240_000)
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
      const inputs = world.step(message.tNanos, message.outputs)
      run.poses.push({ tNanos: message.tNanos, pose: world.pose() })
      const tags = inputs['Webcam 1']?.tags
      if (Array.isArray(tags)) {
        const ids: number[] = []
        for (let i = 0; i < tags.length; i += TAG_INPUT_STRIDE) ids.push(tags[i] as number)
        run.frames.push({ tNanos: message.tNanos, ids })
      } else if (typeof inputs['Webcam 1']?.frameNanos === 'number') {
        // 같은 태그 배열이 이어지면 frameNanos만 간다(세계 changed 규칙): 앞 프레임의 id 그대로
        const last = run.frames[run.frames.length - 1]
        run.frames.push({ tNanos: message.tNanos, ids: last ? [...last.ids] : [] })
      }
      const events: ('start' | 'stop')[] = []
      if (message.tick === START_TICK) events.push('start')
      if (message.tick === stopTick) events.push('stop')
      send({
        type: 'tickReply',
        tick: message.tick,
        events,
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

// 고치지 않은 FTC 샘플을 임시 폴더의 원래 패키지 자리에 둔다(받지 못하면 null: 건너뜀). edit는 사본을 고칠 때만
async function sampleSetup(
  name: string,
  worldSpec: WorldSpec,
  config = CONFIG,
  edit: (source: string) => string = (source) => source
): Promise<Setup | null> {
  let samples: { dir: string; files: string[] }
  try {
    samples = await ensureFtcSamples({ log: () => {} })
  } catch (error) {
    if (error instanceof FetchError && !/SHA-256/.test((error as Error).message)) return null
    throw error
  }
  const sample = samples.files.find((file) => file.endsWith(`${name}.java`))
  if (!sample) throw new Error(`${name}.java is not among the samples`)
  const root = testTempDir(`vision-sim-${name}`)
  const dir = join(root, 'org', 'firstinspires', 'ftc', 'robotcontroller', 'external', 'samples')
  mkdirSync(dir, { recursive: true })
  const opModeSource = join(dir, `${name}.java`)
  const original = readFileSync(sample, 'utf8')
  const edited = edit(original)
  if (edited === original) copyFileSync(sample, opModeSource)
  else writeFileSync(opModeSource, edited)
  return {
    spec: worldSpec,
    config,
    sourceRoots: [root],
    opModeSource,
    opModeClass: `org.firstinspires.ftc.robotcontroller.external.samples.${name}`
  }
}

function teamSetup(dir: string, opMode: string, worldSpec: WorldSpec, config = CONFIG): Setup {
  return {
    spec: worldSpec,
    config,
    sourceRoots: [dir],
    opModeSource: join(dir, 'org', 'firstinspires', 'ftc', 'teamcode', `${opMode}.java`),
    opModeClass: `org.firstinspires.ftc.teamcode.${opMode}`
  }
}

function errors(run: VisionSimRun): SidecarMessage[] {
  return run.messages.filter((m) => m.type === 'error')
}

function finishedReason(run: VisionSimRun): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

// 결정성 비교: hello·compiled(호스트 경로·컴파일 시간)를 뺀 사이드카 메시지열
function deterministic(run: VisionSimRun): string {
  return run.messages
    .filter((m) => m.type !== 'hello' && m.type !== 'compiled')
    .map((m) => JSON.stringify(m))
    .join('\n')
}

function telemetryFrames(run: VisionSimRun): string[][] {
  return run.messages.flatMap((m) => (m.type === 'telemetry' ? [m.frame.lines] : []))
}

function numbers(line: string): number[] {
  return (line.match(/-?\d+\.\d+|-?\d+/g) ?? []).map(Number)
}

type ShownCluster = {
  percent: number
  xyz: number[]
  pry: number[]
  rbe: number[]
}

// 고치지 않은 ConceptAprilTag 텔레메트리 한 화면의 묶음 줄(머리 줄 다음 Percent·XYZ·PRY·RBE)
function shownClusters(lines: string[]): Map<string, ShownCluster> {
  const out = new Map<string, ShownCluster>()
  lines.forEach((line, i) => {
    const m = /==== Tag Cluster \((.+)\)/.exec(line)
    if (!m) return
    const after = lines.slice(i + 1, i + 5)
    const find = (prefix: string): number[] =>
      numbers(after.find((l) => l.trim().startsWith(prefix))!.replace(prefix, ''))
    out.set(m[1], {
      percent: numbers(after.find((l) => l.startsWith('Percent tags found'))!)[0],
      xyz: find('XYZ'),
      pry: find('PRY'),
      rbe: find('RBE')
    })
  })
  return out
}

// 참 ftcPose(AprilTagProcessorImpl.rawPoseToFtcPose와 같은 식): 묶음 원점의 OpenCV 카메라 좌표 t(in)와 묶음 → 카메라
// 회전 R. x = t.x, y = t.z, z = −t.y, range = hypot(t.x, t.z), bearing = atan2(−t.x, t.z), elevation = atan2(−t.y, t.z),
// Orientation INTRINSIC YXZ(R = Ry(a)·Rx(b)·Rz(c))에서 yaw = −a, pitch = b, roll = c
type FtcPose = {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  range: number
  bearing: number
  elevation: number
}

function truthFtcPose(robot: { x: number; y: number; yaw: number }, c: ClusterFieldPose): FtcPose {
  const cam = sensorPose(planarFrame(robot), CAMERA_MOUNT)
  const r = cam.rotation
  const m = CV_FROM_SENSOR
  // 필드 벡터 → OpenCV 카메라 좌표(c = CV·Rᵀ·v)
  const toCv = (v: Vec3): Vec3 => {
    const sx = r[0] * v.x + r[3] * v.y + r[6] * v.z
    const sy = r[1] * v.x + r[4] * v.y + r[7] * v.z
    const sz = r[2] * v.x + r[5] * v.y + r[8] * v.z
    return {
      x: m[0] * sx + m[1] * sy + m[2] * sz,
      y: m[3] * sx + m[4] * sy + m[5] * sz,
      z: m[6] * sx + m[7] * sy + m[8] * sz
    }
  }
  const p = c.position
  const o = cam.origin
  const tm = toCv({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z })
  const t = { x: tm.x / METERS_PER_INCH, y: tm.y / METERS_PER_INCH, z: tm.z / METERS_PER_INCH }
  const q = c.rotation
  const cols = [0, 1, 2].map((k) => toCv({ x: q[k], y: q[3 + k], z: q[6 + k] }))
  const R = (i: number, k: number): number => [cols[k].x, cols[k].y, cols[k].z][i]
  const a = Math.atan2(R(0, 2), R(2, 2))
  const b = Math.asin(-R(1, 2))
  const cc = Math.atan2(R(1, 0), R(1, 1))
  return {
    x: t.x,
    y: t.z,
    z: -t.y,
    yaw: -a * DEG,
    pitch: b * DEG,
    roll: cc * DEG,
    range: Math.hypot(t.x, t.z),
    bearing: Math.atan2(-t.x, t.z) * DEG,
    elevation: Math.atan2(-t.y, t.z) * DEG
  }
}

// 각도 차(°, (−180, 180])
function angleDiff(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180
}

function expectShownMatchesTruth(shown: ShownCluster, truth: FtcPose): void {
  const limit = TOLERANCE + DISPLAY_ROUNDING
  const pairs: [number, number][] = [
    [shown.xyz[0], truth.x],
    [shown.xyz[1], truth.y],
    [shown.xyz[2], truth.z],
    [shown.rbe[0], truth.range]
  ]
  for (const [got, want] of pairs) expect(Math.abs(got - want)).toBeLessThan(limit)
  const angles: [number, number][] = [
    [shown.pry[0], truth.pitch],
    [shown.pry[1], truth.roll],
    [shown.pry[2], truth.yaw],
    [shown.rbe[1], truth.bearing],
    [shown.rbe[2], truth.elevation]
  ]
  for (const [got, want] of angles) expect(Math.abs(angleDiff(got, want))).toBeLessThan(limit)
}

// 마지막 텔레메트리 화면(STOP 전)
function lastFrame(run: VisionSimRun): string[] {
  const frames = telemetryFrames(run).filter((lines) =>
    lines.some((l) => l.startsWith('# AprilTags Detected'))
  )
  return frames[frames.length - 1]
}

// 팀 코드가 tNanos에 본 자세 = 그 앞 틱 경계(그 틱의 답)의 자세
function poseAt(run: VisionSimRun, tNanos: number): SimPose {
  const before = run.poses.filter((p) => p.tNanos <= tNanos)
  return before[before.length - 1].pose
}

function results(run: VisionSimRun): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of run.messages) {
    if (m.type !== 'log' || m.stream !== 'out' || !m.text.startsWith('RESULT ')) continue
    const r: Record<string, string> = {}
    for (const pair of m.text.slice('RESULT '.length).trim().split(' ')) {
      const eq = pair.indexOf('=')
      if (eq > 0) r[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
    out.push(r)
  }
  return out
}

// STOP 바로 앞 틱의 웹캠 출력(STOP 뒤에는 postStop이 포털을 닫는다)
function outputBefore(run: VisionSimRun, stopTick: number, key: string): unknown {
  const tick = run.ticks.find((t) => t.tick === stopTick - 1)!
  return tick.outputs['Webcam 1']?.[key]
}

// I2: clusterFieldPoses(시작 상태)로 BIOBUZZ 없는 라이브러리를 만들고 sdkCameraPose를 넣은 OpMode. 1.5 s 서 있다가 앞으로
// 0.25 power로 0.6 s 간 뒤 선다. 모든 묶음 검출의 robotPose와 프레임 시각을 쓴다
function fieldPoseLibrarySource(): string {
  const pose = sdkCameraPose(CAMERA_MOUNT.position, {
    yaw: 0,
    pitch: CAMERA_PITCH,
    roll: 0
  })
  const f = (v: number): string => `${v}f`
  const clusterLines = CLUSTERS.map((c) => {
    const members = [-6.5, -2.75, 2.75, 6.5]
      .map(
        (x, k) =>
          `        m.add(new AprilTagClusterMemberMetadata(${c.firstId + k}, new VectorF(${f(x)}, 7.1874f, -5.622f), 3.25));`
      )
      .join('\n')
    const p = c.position
    const q = c.quaternion
    return [
      '        m = new ArrayList<>();',
      members,
      `        builder.addCluster(new AprilTagClusterMetadata(m, "${c.name}", "${c.name}", new VectorF(${f(p.x / METERS_PER_INCH)}, ${f(p.y / METERS_PER_INCH)}, ${f(p.z / METERS_PER_INCH)}), DistanceUnit.INCH, new Quaternion(${f(q[0])}, ${f(q[1])}, ${f(q[2])}, ${f(q[3])}, 0)));`
    ].join('\n')
  }).join('\n')
  return [
    'package org.firstinspires.ftc.teamcode;',
    '',
    'import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;',
    'import com.qualcomm.robotcore.eventloop.opmode.TeleOp;',
    'import com.qualcomm.robotcore.hardware.DcMotor;',
    'import com.qualcomm.robotcore.hardware.DcMotorSimple;',
    'import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;',
    'import org.firstinspires.ftc.robotcore.external.matrices.VectorF;',
    'import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;',
    'import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;',
    'import org.firstinspires.ftc.robotcore.external.navigation.Position;',
    'import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;',
    'import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;',
    'import org.firstinspires.ftc.vision.VisionPortal;',
    'import org.firstinspires.ftc.vision.apriltag.*;',
    'import java.util.ArrayList;',
    'import java.util.Locale;',
    '',
    '// 시험이 만든 소스(visionSim.test.ts I2): BIOBUZZ 묶음을 필드 자세로 둔 라이브러리, 서 있다가 앞으로 간다',
    '@TeleOp(name = "VisionSimFieldPose")',
    'public class VisionSimFieldPose extends LinearOpMode {',
    '    @Override public void runOpMode() {',
    '        DcMotor[] motors = {',
    '            hardwareMap.get(DcMotor.class, "frontLeft"), hardwareMap.get(DcMotor.class, "frontRight"),',
    '            hardwareMap.get(DcMotor.class, "backLeft"), hardwareMap.get(DcMotor.class, "backRight") };',
    '        motors[0].setDirection(DcMotorSimple.Direction.REVERSE);',
    '        motors[2].setDirection(DcMotorSimple.Direction.REVERSE);',
    '        AprilTagLibrary.Builder builder = new AprilTagLibrary.Builder();',
    '        ArrayList<AprilTagClusterMemberMetadata> m;',
    clusterLines,
    '        AprilTagProcessor tag = new AprilTagProcessor.Builder()',
    '            .setTagLibrary(builder.build())',
    `            .setCameraPose(new Position(DistanceUnit.INCH, ${pose.x}, ${pose.y}, ${pose.z}, 0),`,
    `                new YawPitchRollAngles(AngleUnit.DEGREES, ${pose.yaw}, ${pose.pitch}, ${pose.roll}, 0))`,
    '            .build();',
    '        new VisionPortal.Builder()',
    '            .setCamera(hardwareMap.get(WebcamName.class, "Webcam 1")).addProcessor(tag).build();',
    '        waitForStart();',
    '        long start = System.nanoTime();',
    '        while (opModeIsActive()) {',
    '            double elapsed = (System.nanoTime() - start) / 1e9;',
    '            double power = elapsed > 1.5 && elapsed < 2.1 ? 0.25 : 0;',
    '            for (DcMotor motor : motors) motor.setPower(power);',
    '            java.util.List<AprilTagDetection> fresh = tag.getFreshDetections();',
    '            if (fresh == null) fresh = new ArrayList<>();',
    '            for (AprilTagDetection d : fresh) {',
    '                if (d.robotPose == null || !(d instanceof AprilTagClusterDetection)) continue;',
    '                System.out.println(String.format(Locale.ROOT, "RESULT x=%.5f y=%.5f z=%.5f yaw=%.5f t=%d",',
    '                    d.robotPose.getPosition().x, d.robotPose.getPosition().y, d.robotPose.getPosition().z,',
    '                    d.robotPose.getOrientation().getYaw(AngleUnit.DEGREES), d.frameAcquisitionNanoTime));',
    '            }',
    '            sleep(10);',
    '        }',
    '    }',
    '}',
    ''
  ].join('\n')
}

function fieldPoseSetup(): Setup {
  const root = testTempDir('vision-sim-fieldpose')
  const dir = join(root, 'org', 'firstinspires', 'ftc', 'teamcode')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'VisionSimFieldPose.java'), fieldPoseLibrarySource())
  return teamSetup(root, 'VisionSimFieldPose', spec(presetStart()))
}

// I7: 렌더러 임시 상자 로봇 + 웹캠 컴포넌트를 빨강 관중석 벽 프리셋에(인스펙터 경로, C4·C9와 같은 장면)
const RENDERER_WEBCAM: HardwareComponent = {
  id: 'w1',
  type: 'webcam',
  name: 'Webcam 1',
  hub: 'controlHub',
  port: 0,
  props: {
    serialNumber: 'SN1',
    cameraModel: 'logitechC920',
    aimYaw: 0,
    aimPitch: CAMERA_PITCH,
    aimRoll: 0
  }
}

function rendererScene(): SceneObjects {
  const store = useSceneStore.getState()
  const saved = { objects: store.objects, field: store.field }
  const objects = store.objects
  useSceneStore.setState({
    objects: { ...objects, webcam: { ...objects.webcam, components: [RENDERER_WEBCAM] } },
    field: { season: 'biobuzz' }
  })
  try {
    snapRobotToPreset('robot', 'audienceWall', 'default')
    return useSceneStore.getState().objects
  } finally {
    useSceneStore.setState(saved)
  }
}

// 렌더러 빌더 → JSON → parseWorldSpec(메인과 같은 경로)
function rendererWorld(objects: SceneObjects): WorldSpec {
  const doc = { season: 'biobuzz' }
  const keyT = ((key: string) => key) as unknown as TFunction
  const built = buildWorldSpec(objects, 'robot', { batteryVoltage: 12 }, null, (id) =>
    objectLocalBounds(objects, id)
  )
  const result = withSensorNoise(
    withRunField(built, doc, runFieldOf(doc, { red: 'start', blue: 'start' }), keyT),
    { sensorNoise: false, seed: 0 }
  )
  const parsed = parseWorldSpec(JSON.parse(JSON.stringify(result.spec)))
  if (typeof parsed === 'string') throw new Error(parsed)
  return parsed
}

const WEBCAM_ONLY_CONFIG = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  '<Robot type="FirstInspires-FTC" name="Vision Box">',
  '    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">',
  '        <LynxModule name="Control Hub" port="173">',
  '        </LynxModule>',
  '    </LynxUsbDevice>',
  '    <Webcam name="Webcam 1" serialNumber="SN1" />',
  '</Robot>',
  ''
].join('\n')

// 2.5 s 동안 돈 뒤 STOP(START 4틱 + 열기 1 s + 시작 0.5 s + 처음 프레임들)
const STOP_TICK = 500

describe.skipIf(build === null)('비전 통합(사이드카 + 시뮬레이터)', () => {
  it(
    'I1·I3·I4: 고치지 않은 ConceptAprilTag가 빨강 관중석 벽에서 두 묶음(100 %·50 %)과 참 ftcPose를 보이고, 두 번 바이트 같다',
    async (ctx) => {
      const start = presetStart()
      const setup = await sampleSetup('ConceptAprilTag', spec(start))
      if (!setup) {
        ctx.skip()
        return
      }
      // 카메라는 필드 x 1.336 m(spec-4d §4 기준표)
      expect(start.x + Math.cos(start.yaw) * HALF).toBeCloseTo(1.336, 3)
      const run = await runVisionSim(build!, setup, STOP_TICK)
      expect(errors(run), run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('stopped')
      // 세계 프레임: 30·31, 34–37이 보이고 32·33은 다리에 가린다
      const lastFrameIds = run.frames[run.frames.length - 1].ids
      expect(lastFrameIds).toEqual([30, 31, 34, 35, 36, 37])
      // 두 묶음이 START 뒤 곧 보인다: 열기 1.0 s + 시작 0.5 s(INIT에 만든 포털) 뒤 첫 프레임(격자 ≤ 35 ms) + 처리 22 ms +
      // 루프 sleep 20 ms, 텔레메트리는 DS 전송 간격(250 ms)마다라 화면에는 2 s 안에 나온다(spec-4d §4 I1의 "1.5 s 안"은
      // 스트림 시작 시각 기준이고 화면 전송 간격을 넣지 않은 값)
      const startNanos = run.ticks.find((t) => t.tick === START_TICK)!.tNanos
      const firstBoth = run.messages.find(
        (m) =>
          m.type === 'telemetry' &&
          m.frame.lines.some((l) => l.includes('==== Tag Cluster (RED AUDIENCE)')) &&
          m.frame.lines.some((l) => l.includes('==== Tag Cluster (RED SCORING)'))
      )
      expect(firstBoth).toBeDefined()
      expect(firstBoth!.type === 'telemetry' && firstBoth!.tNanos - startNanos).toBeLessThan(2e9)
      const lines = lastFrame(run)
      expect(lines).toContain('# AprilTags Detected : 2')
      const shown = shownClusters(lines)
      expect(shown.get('RED AUDIENCE')!.percent).toBe(100)
      expect(shown.get('RED SCORING')!.percent).toBe(50)
      for (const name of ['RED AUDIENCE', 'RED SCORING'])
        expectShownMatchesTruth(shown.get(name)!, truthFtcPose(start, cluster(name)))
      // I3: 관중석 쪽에서 −X를 보면 위 CELL(빨강 관중석) roll ≈ 0, 아래 CELL(빨강 득점) ≈ ±180
      expect(Math.abs(shown.get('RED AUDIENCE')!.pry[1])).toBeLessThan(90)
      expect(Math.abs(truthFtcPose(start, cluster('RED AUDIENCE')).roll)).toBeLessThan(0.01)
      expect(Math.abs(shown.get('RED SCORING')!.pry[1])).toBeGreaterThan(90)
      expect(Math.abs(truthFtcPose(start, cluster('RED SCORING')).roll)).toBeCloseTo(180, 2)
      // 장치 출력: STREAMING, 데시메이션 3, FPS는 낮게 시작해 차오른다(첫 표본 기준이 STARTING_STREAM 시작)
      expect(outputBefore(run, STOP_TICK, 'state')).toBe('STREAMING')
      expect(outputBefore(run, STOP_TICK, 'decimation')).toBe(3)
      const fps = outputBefore(run, STOP_TICK, 'fps') as number
      expect(fps).toBeGreaterThan(5)
      expect(fps).toBeLessThan(30.5)
      // I4: 같은 입력으로 두 번 → 사이드카 메시지열 바이트 같음, thread 오류 없음
      const again = await runVisionSim(build!, setup, STOP_TICK)
      expect(deterministic(again)).toBe(deterministic(run))

      // I1 뒷부분: −X로 0.2 m(HIVE 쪽) 가면 RED SCORING range가 줄고 RED AUDIENCE는 화면 위로 벗어난다
      const near = { ...start, x: start.x - 0.2 }
      const nearRun = await runVisionSim(build!, { ...setup, spec: spec(near) }, STOP_TICK)
      expect(errors(nearRun), nearRun.stderr).toEqual([])
      const nearShown = shownClusters(lastFrame(nearRun))
      expect(nearShown.has('RED AUDIENCE')).toBe(false)
      expect(nearShown.get('RED SCORING')!.rbe[0]).toBeLessThan(shown.get('RED SCORING')!.rbe[0])
      expectShownMatchesTruth(
        nearShown.get('RED SCORING')!,
        truthFtcPose(near, cluster('RED SCORING'))
      )
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'I2·I4: 필드 자세 라이브러리의 robotPose가 서 있을 때와 움직일 때 프레임 시각의 로봇 필드 자세와 같다',
    async () => {
      const setup = fieldPoseSetup()
      const run = await runVisionSim(build!, setup, 700)
      expect(errors(run), run.stderr).toEqual([])
      const r = results(run)
      expect(r.length).toBeGreaterThan(20)
      let moving = 0
      for (const row of r) {
        const t = Number(row.t)
        // acquisitionTime = 프레임 시각(세계가 프레임을 낸 틱 경계)
        expect(run.frames.some((f) => f.tNanos === t)).toBe(true)
        const pose = poseAt(run, t)
        if (Math.abs(pose.x - setup.spec.robot.start.x) > 0.01) moving++
        expect(Math.abs(Number(row.x) - pose.x / METERS_PER_INCH)).toBeLessThan(TOLERANCE)
        expect(Math.abs(Number(row.y) - pose.y / METERS_PER_INCH)).toBeLessThan(TOLERANCE)
        expect(Math.abs(Number(row.z))).toBeLessThan(TOLERANCE)
        // SDK 로봇 요 = SandBot 요 − 90°(감은 차)
        expect(Math.abs(angleDiff(Number(row.yaw), pose.yaw * DEG - 90))).toBeLessThan(TOLERANCE)
      }
      // 움직이는 동안의 검출도 있다
      expect(moving).toBeGreaterThan(3)
      // 필드 자세가 있는 라이브러리라 aprilTagNoFieldPose가 없다
      expect(
        run.messages.some((m) => m.type === 'notice' && m.code === 'aprilTagNoFieldPose')
      ).toBe(false)
      const again = await runVisionSim(build!, setup, 700)
      expect(deterministic(again)).toBe(deterministic(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'I5: 데시메이션 2·1·3의 getFps()가 약 22·10·30',
    async () => {
      const run = await runVisionSim(
        build!,
        teamSetup(OPMODES, 'VisionDecimationFps', spec(presetStart())),
        null
      )
      expect(errors(run), run.stderr).toEqual([])
      const fps = new Map(results(run).map((row) => [Number(row.d), Number(row.fps)]))
      // 처리 시간 T₀(d)(가정: d 1 100 ms, 2 45 ms, 3 22 ms)와 30 fps 격자(5 ms 틱에 맞춰 30·35 ms)로 정해지는 값
      expect(Math.abs(fps.get(2)! - 22)).toBeLessThan(1.5)
      expect(Math.abs(fps.get(1)! - 10)).toBeLessThan(1)
      expect(Math.abs(fps.get(3)! - 30)).toBeLessThan(1.5)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'I6: APRILTAG_BUILTIN은 묶음을 처음 본 프레임의 결과 시각에 notice → 오류 → finished exception',
    async () => {
      const run = await runVisionSim(
        build!,
        teamSetup(VISION_OPMODES, 'VisionSolverStop', spec(presetStart())),
        null
      )
      const index = (pred: (m: SidecarMessage) => boolean): number => run.messages.findIndex(pred)
      const noticeAt = index((m) => m.type === 'notice' && m.code === 'visionSolverStop')
      const errorAt = index((m) => m.type === 'error')
      expect(noticeAt, run.stderr).toBeGreaterThanOrEqual(0)
      expect(errorAt).toBe(noticeAt + 1)
      expect(run.messages[errorAt]).toMatchObject({
        kind: 'exception',
        exception: 'org.opencv.core.CvException',
        thread: 'VisionPortal'
      })
      expect(finishedReason(run)).toBe('exception')
      // 첫 프레임(묶음이 보임) f의 처리가 끝나는 e = f + 22 ms(d 3, 640×480) 이후 첫 틱 경계
      const first = run.frames.find((f) => f.ids.length > 0)!
      const notice = run.messages[noticeAt]
      const due = first.tNanos + 22_000_000
      expect(notice.type === 'notice' && notice.tNanos).toBe(
        Math.ceil(due / DEFAULT_TICK_NANOS) * DEFAULT_TICK_NANOS
      )
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'I7: 렌더러 빌더 세계를 사이드카까지 → 텔레메트리 묶음 이름·Percent = 인스펙터 편집 자세 줄',
    async (ctx) => {
      const objects = rendererScene()
      const reading = cameraReadingModel({
        objects,
        objectId: 'webcam',
        component: RENDERER_WEBCAM,
        season: 'biobuzz',
        hiveTipped: [false, false],
        bounds: (id) => objectLocalBounds(objects, id),
        exclusion: cameraExclusions(objects, 'robot').get(RENDERER_WEBCAM.id) ?? null
      })
      if (reading?.kind !== 'camera') throw new Error('camera')
      const expected = new Map(
        reading.visible.map((group) => [group.cluster!, (group.ids.length / 4) * 100])
      )
      expect(expected.size).toBeGreaterThan(0)
      const config = join(testTempDir('vision-sim-renderer'), 'sandbot_VisionBox.xml')
      writeFileSync(config, WEBCAM_ONLY_CONFIG)
      const setup = await sampleSetup('ConceptAprilTag', rendererWorld(objects), config)
      if (!setup) {
        ctx.skip()
        return
      }
      const run = await runVisionSim(build!, setup, STOP_TICK)
      expect(errors(run), run.stderr).toEqual([])
      const shown = shownClusters(lastFrame(run))
      expect(new Map([...shown].map(([name, c]) => [name, c.percent]))).toEqual(expected)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'I8: 형식 없는 resume은 STARTING_STREAM에 머물고(notice 한 번), setStreamFormat(YUY2) 사본은 STREAMING으로 돌아온다',
    async (ctx) => {
      // dpad_down 1.6–1.7 s, dpad_up 2.4–2.5 s(START 뒤, 처음 스트림은 1.5 s에 STREAMING)
      const pad = (tick: number): GamepadState =>
        gamepad({
          dpad_down: tick >= 320 && tick < 340,
          dpad_up: tick >= 480 && tick < 500
        })
      const setup = await sampleSetup('ConceptAprilTag', spec(presetStart()))
      if (!setup) {
        ctx.skip()
        return
      }
      const states = (run: VisionSimRun): string[] => {
        const out: string[] = []
        // STOP(틱 800) 뒤의 닫기(postStop)는 보지 않는다
        for (const tick of run.ticks.filter((t) => t.tick < 800)) {
          const state = tick.outputs['Webcam 1']?.state
          if (typeof state === 'string' && out[out.length - 1] !== state) out.push(state)
        }
        return out
      }
      const run = await runVisionSim(build!, setup, 800, pad)
      expect(errors(run), run.stderr).toEqual([])
      expect(states(run)).toEqual([
        'OPENING_CAMERA_DEVICE',
        'STARTING_STREAM',
        'STREAMING',
        'STOPPING_STREAM',
        'CAMERA_DEVICE_READY',
        'STARTING_STREAM'
      ])
      expect(
        run.messages.filter((m) => m.type === 'notice' && m.code === 'visionResumeNullFormat')
      ).toHaveLength(1)
      // 멈춘 뒤 프레임이 더 오지 않아 검출이 바뀌지 않는다
      const stopNanos = run.ticks.find((t) => t.tick === 340)!.tNanos
      expect(run.frames.filter((f) => f.tNanos > stopNanos)).toEqual([])

      const yuy2 = (await sampleSetup('ConceptAprilTag', spec(presetStart()), CONFIG, (source) => {
        const line = '//builder.setStreamFormat(VisionPortal.StreamFormat.YUY2);'
        if (!source.includes(line)) throw new Error('setStreamFormat line not found')
        return source.replace(line, line.slice(2))
      }))!
      const yuy2Run = await runVisionSim(build!, yuy2, 800, pad)
      expect(errors(yuy2Run), yuy2Run.stderr).toEqual([])
      expect(states(yuy2Run)).toEqual([
        'OPENING_CAMERA_DEVICE',
        'STARTING_STREAM',
        'STREAMING',
        'STOPPING_STREAM',
        'CAMERA_DEVICE_READY',
        'STARTING_STREAM',
        'STREAMING'
      ])
      expect(
        yuy2Run.messages.some((m) => m.type === 'notice' && m.code === 'visionResumeNullFormat')
      ).toBe(false)
    },
    SIDECAR_TEST_TIMEOUT
  )
})
