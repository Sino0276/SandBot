// 사이드카 장치 테스트: 가짜 SDK의 장치 구현(sidecar/sdk/org/sandbot/sdk/devices와 실제 이름의 손 구현)을
// sandbot-sdk.jar로 시험한다. JDK가 없으면 건너뛴다.
//  - Java 단위 테스트(sidecar/tests/java/org/sandbot/sdk/devices): 구성 XML → hardwareMap, 허브 비용, 장치 의미, Color·Matrix
//  - 생성 코드: SandBot이 만드는 구성 XML·하드웨어 클래스(src/renderer/src/hardware)를 그대로 써서, 카탈로그의 모든 종류를
//    두 허브에 붙인 로봇의 생성 초기화 순서가 예외 없이 돌고 시뮬레이터 장치가 그 설정을 보이는지 본다.
//  - 런타임을 거쳐: 진짜 사이드카(org.sandbot.runtime.Main)에 생성 구성을 주고 그 하드웨어 클래스를 쓰는 OpMode
//    (sidecar/tests/opmodes-devices)를 돌려, 틱의 장치 출력·센서 입력·허브 비용(루프 시간)·구성 오류를 본다.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMPONENT_TYPE_KEYS,
  EMBEDDED_IMU_BUS,
  MOTOR_MODEL_TAGS,
  componentDef,
  type ComponentType
} from '../../src/renderer/src/hardware/catalog'
import { createComponent, isInConfiguration } from '../../src/renderer/src/hardware/components'
import { generateTeamCodeFiles } from '../../src/renderer/src/hardware/generate'
import { javaIdentifier } from '../../src/renderer/src/hardware/naming'
import { validateScene } from '../../src/renderer/src/hardware/validation'
import type { HardwareComponent, HubId, SceneObjects } from '../../src/renderer/src/scene/model'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type DeviceValues,
  type HostMessage,
  type RunRequest,
  type SidecarMessage
} from '../../src/shared/sidecarProtocol'
import {
  SIDECAR_TEST_TIMEOUT,
  compileJavaTests,
  runJavaTests,
  sidecarBuild,
  testTempDir,
  type SidecarBuild
} from './support'

const build = await sidecarBuild()

const JAVA_TESTS = 'sidecar/tests/java/org/sandbot/sdk'
const UNIT_TESTS = ['HardwareMapTest', 'HubCostTest', 'DeviceBehaviorTest', 'AndroidMathTest'].map(
  (name) => `org.sandbot.sdk.devices.${name}`
)

// 카탈로그 종류 → 시뮬레이터 장치 종류(SimDevice kind, org/sandbot/sdk/devices/package-info.java).
// 카탈로그에 종류를 더하면 여기서 타입 검사가 실패한다: 가짜 SDK도 그 장치를 지원해야 한다.
const SIM_KIND = {
  motor: 'motor',
  deadWheel: 'motor',
  servo: 'servo',
  crServo: 'crServo',
  sparkMini: 'sparkMini',
  blinkin: 'blinkin',
  imu: 'imu',
  distanceSensor: 'distance',
  colorSensor: 'color',
  touchSensor: 'touch',
  digitalDevice: 'digital',
  analogInput: 'analog',
  led: 'led',
  webcam: 'webcam',
  limelight: 'limelight',
  huskyLens: 'huskyLens',
  pinpoint: 'pinpoint',
  otos: 'otos',
  octoQuad: 'octoQuad'
} as const satisfies Record<ComponentType, string>

const WEBCAM_SERIAL = 'A1B2C3D4'
const LIMELIGHT_SERIAL = 'EthernetOverUsb:eth1:172.29.0.29'

type Expected = [device: string, key: string, value: string | number | boolean | null]

type Robot = {
  className: string
  objects: SceneObjects
  // 생성 초기화 뒤 시뮬레이터 출력
  expected: Expected[]
}

function robotObject(id: string, name: string, className: string): SceneObjects[string] {
  return {
    id,
    name,
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    hardware: { className, configName: name, expansionHub: { enabled: true, address: 2 } }
  }
}

function part(objects: SceneObjects, parentId: string, components: HardwareComponent[]): void {
  const id = `p${Object.keys(objects).length}`
  objects[id] = {
    id,
    name: `part ${id}`,
    kind: 'part',
    parentId,
    transform: { position: [0.01 * Object.keys(objects).length, 0.02, 0.03], rotation: [0, 0, 0] },
    components
  }
}

// 1. Control Hub에 카탈로그의 모든 종류(기본 속성), Expansion Hub의 장치는 메커니즘 그룹(Lift → Claw) 안에
function controlRobot(): Robot {
  const objects: SceneObjects = { robot: robotObject('robot', 'Control Bot', 'ControlBotHardware') }
  const all: HardwareComponent[] = []
  let n = 0
  const add = (type: ComponentType, change: Partial<HardwareComponent> = {}): HardwareComponent => {
    const component = { ...createComponent(type, all, () => `c${n++}`), ...change }
    all.push(component)
    return component
  }
  for (const type of COMPONENT_TYPE_KEYS) {
    const component = add(type)
    if (type === 'webcam') component.props = { ...component.props, serialNumber: WEBCAM_SERIAL }
    if (type === 'limelight')
      component.props = { ...component.props, serialNumber: LIMELIGHT_SERIAL }
    part(objects, 'robot', [component])
  }
  objects.lift = {
    id: 'lift',
    name: 'Lift',
    kind: 'group',
    parentId: 'robot',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  }
  part(objects, 'lift', [add('motor', { name: 'liftLeft', hub: 'expansionHub', port: 0 })])
  part(objects, 'lift', [add('motor', { name: 'liftRight', hub: 'expansionHub', port: 1 })])
  objects.claw = {
    id: 'claw',
    name: 'Claw',
    kind: 'group',
    parentId: 'lift',
    transform: { position: [0, 0, 0.2], rotation: [0, 0, 0] },
    components: [add('servo', { name: 'claw', hub: 'expansionHub', port: 0 })]
  }
  return {
    className: 'ControlBotHardware',
    objects,
    expected: [
      ['motor', 'mode', 'RUN_WITHOUT_ENCODER'],
      ['motor', 'zeroPower', 'BRAKE'],
      ['motor', 'motorType', 'goBILDA5202SeriesMotor'],
      ['servo', 'pwm', false],
      ['digital', 'mode', 'INPUT'],
      ['imu', 'chip', 'BHI260AP'],
      ['pinpoint', 'xDirection', 'FORWARD'],
      ['pinpoint', 'ticksPerMm', 19.89436789],
      ['otos', 'linearScalar', 1],
      ['Webcam 1', 'serialNumber', WEBCAM_SERIAL],
      ['limelight', 'running', false],
      ['Control Hub', 'bulkCachingMode', 'OFF'],
      ['Expansion Hub 2', 'bulkCachingMode', 'OFF']
    ]
  }
}

// 2. Expansion Hub에 허브 포트를 쓰는 모든 종류(기본값이 아닌 속성), 시리얼 없는 웹캠(tryGet → null)
function expansionRobot(): Robot {
  const objects: SceneObjects = {
    robot: robotObject('robot', 'Expansion Bot', 'ExpansionBotHardware')
  }
  const props: Partial<Record<ComponentType, Record<string, string | number>>> = {
    motor: {
      motorModel: 'tetrix',
      direction: 'reverse',
      runMode: 'resetThenUsingEncoder',
      zeroPowerBehavior: 'float'
    },
    servo: { pulseRange: 'fullRange', direction: 'reverse', scaleMin: 0.2, scaleMax: 0.8 },
    crServo: { direction: 'reverse' },
    sparkMini: { direction: 'reverse' },
    imu: { chip: 'bno055', logoFacing: 'left', usbFacing: 'up' },
    colorSensor: { gain: 10 },
    digitalDevice: { mode: 'output' },
    pinpoint: { podType: 'swingarm', xDirection: 'reversed', yDirection: 'reversed' },
    otos: { mountingAngle: 90, linearScalar: 1.05, angularScalar: 0.98 },
    deadWheel: { measures: 'strafe', reversed: 'yes' }
  }
  // 포트: 종류 묶음마다 차례로(데드휠은 모터가 없는 엔코더 포트), I2C는 버스 1–3에 나눠서
  const ports: Record<string, number> = { motor: 0, encoder: 3, servo: 0, digital: 0, analog: 0 }
  let bus = 1
  let n = 0
  const all: HardwareComponent[] = []
  for (const type of COMPONENT_TYPE_KEYS) {
    const def = componentDef(type)
    const created = createComponent(type, all, () => `e${n++}`)
    const component: HardwareComponent = {
      ...created,
      props: { ...created.props, ...props[type] }
    }
    if (def.portKind === 'usb') {
      if (type !== 'webcam') continue // 시리얼 없는 웹캠 하나만
    } else {
      component.hub = 'expansionHub'
      if (type === 'imu') component.port = EMBEDDED_IMU_BUS
      else if (def.portKind === 'i2c') component.port = (bus++ % 3) + 1
      else if (type === 'touchSensor') component.port = 1
      else if (type === 'led') component.port = 2
      else if (type === 'digitalDevice') component.port = 0
      else component.port = ports[def.portKind]++
    }
    all.push(component)
    part(objects, 'robot', [component])
  }
  return {
    className: 'ExpansionBotHardware',
    objects,
    expected: [
      ['motor', 'mode', 'RUN_USING_ENCODER'],
      ['motor', 'zeroPower', 'FLOAT'],
      ['motor', 'motorType', 'TetrixMotor'],
      ['deadWheel', 'motorType', 'Motor'],
      ['servo', 'pwm', false],
      ['servo', 'position', null],
      ['digital', 'mode', 'OUTPUT'],
      ['imu', 'chip', 'BNO055'],
      ['pinpoint', 'xDirection', 'REVERSED'],
      ['pinpoint', 'yDirection', 'REVERSED'],
      ['pinpoint', 'ticksPerMm', 13.26291192],
      ['otos', 'linearScalar', 1.05],
      // 실제 드라이버는 (scalar - 1) * 1000 + 0.5를 byte로 자른다: 음수는 0 쪽으로(-19.5 → -19)
      ['otos', 'angularScalar', 0.981],
      ['otos', 'offsetH', Math.PI / 2],
      ['Expansion Hub 2', 'bulkCachingMode', 'OFF']
    ]
  }
}

// 3. 모든 모터 형식(구성 태그): 로봇마다 두 허브의 모터 포트 여덟 개
function motorRobots(): Robot[] {
  const models = Object.keys(MOTOR_MODEL_TAGS) as (keyof typeof MOTOR_MODEL_TAGS)[]
  const robots: Robot[] = []
  for (let start = 0; start < models.length; start += 8) {
    const index = robots.length + 1
    const className = `MotorBot${index}Hardware`
    const objects: SceneObjects = { robot: robotObject('robot', `Motor Bot ${index}`, className) }
    const expected: Expected[] = []
    models.slice(start, start + 8).forEach((model, i) => {
      const hub: HubId = i < 4 ? 'controlHub' : 'expansionHub'
      const name = `m_${model}`
      const component: HardwareComponent = {
        ...createComponent('motor', [], () => `m${i}`),
        name,
        hub,
        port: i % 4,
        props: {
          ...createComponent('motor', [], () => '').props,
          motorModel: model,
          runMode: 'usingEncoder'
        }
      }
      part(objects, 'robot', [component])
      expected.push(
        [name, 'motorType', MOTOR_MODEL_TAGS[model]],
        [name, 'mode', 'RUN_USING_ENCODER']
      )
    })
    robots.push({ className, objects, expected })
  }
  return robots
}

const robots: Robot[] = [controlRobot(), expansionRobot(), ...motorRobots()]

function javaLiteral(value: string | number | boolean | null): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return `Double.valueOf(${value})`
  return `Boolean.valueOf(${value})`
}

// 로봇마다 생성 파일을 쓰고, 그 로봇의 초기화 순서를 돌리는 테스트 메서드를 만든다
function writeGenerated(dir: string): { testClass: string; methods: string[] } {
  const methods: string[] = []
  const lines: string[] = []
  for (const robot of robots) {
    const errors = validateScene(robot.objects).filter((issue) => issue.severity === 'error')
    expect(errors, robot.className).toEqual([])
    const { files, blocked } = generateTeamCodeFiles(robot.objects)
    expect(blocked).toBe(false)
    let xmlPath = ''
    for (const file of files) {
      const path = join(dir, 'TeamCode', ...file.path.split('/'))
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, file.content)
      if (file.path.endsWith('.xml')) xmlPath = path
    }
    expect(xmlPath).not.toBe('')
    const components = Object.values(robot.objects).flatMap((object) => object.components ?? [])
    const nullable = components
      .filter((component) => !isInConfiguration(component))
      .map((component) => javaIdentifier(component.name))
    // 같은 허브·포트의 모터가 있는 데드휠은 그 모터의 이름으로 엔코더를 읽는다(구성에 따로 없다)
    const sharesMotor = (c: HardwareComponent): boolean =>
      c.type === 'deadWheel' &&
      components.some((m) => m.type === 'motor' && m.hub === c.hub && m.port === c.port)
    const kinds = components
      .filter((component) => isInConfiguration(component) && !sharesMotor(component))
      .map(
        (component) =>
          `kinds.put(${JSON.stringify(component.name)}, ${JSON.stringify(SIM_KIND[component.type as ComponentType])});`
      )
    const method = `test${robot.className}`
    methods.push(method)
    lines.push(
      `    public static void ${method}() throws Throwable {`,
      `        GeneratedInit.construct(${JSON.stringify(xmlPath)}, "org.firstinspires.ftc.teamcode.sandbot.${robot.className}"${nullable.map((name) => `, ${JSON.stringify(name)}`).join('')});`,
      '        java.util.Map<String, String> kinds = new java.util.LinkedHashMap<>();',
      ...kinds.map((line) => `        ${line}`),
      '        GeneratedInit.expectDevices(kinds);',
      ...robot.expected.map(
        ([device, key, value]) =>
          `        GeneratedInit.expectOutput(${JSON.stringify(device)}, ${JSON.stringify(key)}, ${javaLiteral(value)});`
      ),
      '        GeneratedInit.stop();',
      '    }'
    )
  }
  const source = [
    'package org.sandbot.sdk.devices;',
    '',
    '/** devices.test.ts가 만든 시험: 생성 하드웨어 클래스의 초기화 순서 */',
    'public final class GeneratedInitTest {',
    ...lines,
    '}',
    ''
  ].join('\n')
  const testPath = join(dir, 'tests', 'org', 'sandbot', 'sdk', 'devices', 'GeneratedInitTest.java')
  mkdirSync(dirname(testPath), { recursive: true })
  writeFileSync(testPath, source)
  return { testClass: 'org.sandbot.sdk.devices.GeneratedInitTest', methods }
}

function failures(result: { failed: { id: string; detail: string }[] }): string[] {
  return result.failed.map((f) => `${f.id}\n${f.detail}`)
}

const DEVICE_OPMODES = resolve(__dirname, 'opmodes-devices')

type SidecarRun = { messages: SidecarMessage[]; stderr: string }

// 작은 호스트: 틱마다 바로 답하고, startTick에 START, 센서 입력·게임패드는 늘 같은 값
function runSidecar(
  b: SidecarBuild,
  request: Partial<RunRequest>,
  inputs: Record<string, DeviceValues>,
  leftStickY: number,
  startTick = 3
): Promise<SidecarRun> {
  return new Promise((done, fail) => {
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
    const messages: SidecarMessage[] = []
    let stderr = ''
    let pending = ''
    let finished = false
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out\n${stderr}`))
    }, 120_000)
    const pad = {
      left_stick_x: 0,
      left_stick_y: leftStickY,
      right_stick_x: 0,
      right_stick_y: 0,
      left_trigger: 0,
      right_trigger: 0
    }
    const buttons = [
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
    ]
    const gamepad = { ...pad, ...Object.fromEntries(buttons.map((name) => [name, false])) } as never
    const onLine = (line: string): void => {
      let message: SidecarMessage
      try {
        message = JSON.parse(line) as SidecarMessage
      } catch {
        return
      }
      messages.push(message)
      if (message.type === 'finished') finished = true
      if (finished || message.type !== 'tick') return
      send({
        type: 'tickReply',
        tick: message.tick,
        events: message.tick === startTick ? ['start'] : [],
        gamepads: [gamepad, null],
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
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', fail)
    child.on('close', () => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      done({ messages, stderr })
    })
    send({
      type: 'run',
      protocol: SIDECAR_PROTOCOL_VERSION,
      clock: 'virtual',
      tickNanos: DEFAULT_TICK_NANOS,
      sourceRoots: [DEVICE_OPMODES],
      opModeSource: join(
        DEVICE_OPMODES,
        'org',
        'firstinspires',
        'ftc',
        'teamcode',
        'DevicesDrive.java'
      ),
      opModeClass: 'org.firstinspires.ftc.teamcode.DevicesDrive',
      registeredName: null,
      registrars: [],
      firstFolder: testTempDir('first'),
      bootClasspath: [],
      compileClasspath: [b.sdkJar],
      libraryClasspath: [],
      configXml: null,
      timing: {},
      jitter: 0,
      seed: 0,
      startEpochMillis: 1_700_000_000_000,
      stallMillis: 5000,
      ...request
    })
  })
}

function results(run: SidecarRun): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of run.messages) {
    if (m.type !== 'log' || m.stream !== 'out' || !m.text.startsWith('RESULT ')) continue
    for (const pair of m.text.slice('RESULT '.length).split(' ')) {
      const eq = pair.indexOf('=')
      if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
  }
  return out
}

function finishedReason(run: SidecarRun): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

describe.skipIf(build === null)('사이드카 장치', () => {
  const sidecar = build as SidecarBuild

  it(
    '장치 Java 단위 테스트(구성 XML, 허브 비용, 장치 의미, Color·Matrix)',
    async () => {
      const classes = await compileJavaTests(sidecar, [JAVA_TESTS])
      const result = await runJavaTests(sidecar, classes, UNIT_TESTS)
      expect(failures(result)).toEqual([])
      expect(result.passed.length).toBeGreaterThanOrEqual(30)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '생성한 구성·하드웨어 클래스: 카탈로그의 모든 종류를 두 허브에 붙인 초기화 순서가 예외 없이 돈다',
    async () => {
      const dir = testTempDir('devices-generated')
      const { testClass, methods } = writeGenerated(dir)
      const classes = await compileJavaTests(sidecar, [
        JAVA_TESTS,
        join(dir, 'TeamCode', 'src', 'main', 'java'),
        join(dir, 'tests')
      ])
      // 시뮬레이터 장치 목록은 JVM에 하나라 로봇마다 따로 돌린다(장치 이름이 겹친다)
      const results = await Promise.all(
        methods.map((method) => runJavaTests(sidecar, classes, [`${testClass}#${method}`]))
      )
      expect(results.flatMap(failures)).toEqual([])
      expect(results.flatMap((result) => result.passed)).toHaveLength(methods.length)
    },
    SIDECAR_TEST_TIMEOUT
  )
  it(
    '런타임을 거쳐: 생성 구성으로 hardwareMap을 만들고, 틱 출력·센서 입력·허브 비용이 OpMode에 닿는다',
    async () => {
      const dir = testTempDir('devices-runtime')
      const robot = controlRobot()
      const { files } = generateTeamCodeFiles(robot.objects)
      let configXml = ''
      for (const file of files) {
        const path = join(dir, 'TeamCode', ...file.path.split('/'))
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, file.content)
        if (file.path.endsWith('.xml')) configXml = path
      }
      const run = await runSidecar(
        sidecar,
        { sourceRoots: [DEVICE_OPMODES, join(dir, 'TeamCode', 'src', 'main', 'java')], configXml },
        { motor: { position: 1234 }, imu: { yaw: Math.PI / 4 } },
        -0.5
      )
      const errors = run.messages.filter((m) => m.type === 'error')
      expect(errors, run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      const result = results(run)
      expect(result.loops).toBe('200')
      // goBILDA(CCW) FORWARD: SDK가 허브 엔코더의 부호를 바꾼다
      expect(result.position).toBe('-1234')
      expect(result.yaw).toBe('45')
      // MANUAL 루프 하나 = Control Hub bulk read 2.0 ms(+ 가끔 LastKnown이 끝나 다시 보내는 명령, 텔레메트리, 시계 읽기)
      const loopMillis = Number(result.loopNanos) / 1e6
      expect(loopMillis).toBeGreaterThan(1.99)
      expect(loopMillis).toBeLessThan(2.2)
      // 마지막으로 running이던 틱(끝난 뒤의 틱은 fail safe가 모터를 멈춘 뒤다)
      const ticks = run.messages.flatMap((m) => (m.type === 'tick' ? [m] : []))
      const last = ticks.filter((tick) => tick.phase === 'running').pop()
      if (!last) throw new Error('no running tick')
      expect(ticks[ticks.length - 1].outputs.motor.power).toBe(0)
      expect(ticks[ticks.length - 1].outputs.motor.apiPower).toBe(0)
      expect(ticks[ticks.length - 1].outputs.motor.enabled).toBe(false)
      // 팀 코드는 setPower(0.5): 장치 표의 apiPower는 그 값, 허브 값 power는 goBILDA(CCW) FORWARD라 부호가 반대
      expect(Object.keys(last.outputs.motor)[0]).toBe('apiPower')
      expect(last.outputs.motor.apiPower).toBeCloseTo(0.5, 3)
      expect(last.outputs.motor.power).toBeCloseTo(-0.5, 3)
      expect(last.outputs.motor.mode).toBe('RUN_WITHOUT_ENCODER')
      expect(last.outputs.claw.position).toBeCloseTo(0.75, 9)
      expect(last.outputs.claw.pwm).toBe(true)
      expect(last.outputs['Control Hub'].bulkCachingMode).toBe('MANUAL')
      // 다른 장치도 모두 틱 출력에 있다
      for (const name of ['servo', 'imu', 'pinpoint', 'otos', 'Webcam 1', 'limelight', 'liftLeft'])
        expect(Object.keys(last.outputs)).toContain(name)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '런타임을 거쳐: 읽을 수 없는 구성은 config 오류와 loadFailed',
    async () => {
      const dir = testTempDir('devices-config')
      const configXml = join(dir, 'broken.xml')
      writeFileSync(
        configXml,
        '<Robot type="FirstInspires-FTC"><LynxUsbDevice name="Portal" serialNumber="(embedded)" parentModuleAddress="173">' +
          '<LynxModule name="Control Hub" port="173"><FancyMotor name="motor" port="0" /></LynxModule></LynxUsbDevice></Robot>'
      )
      // 구성은 OpMode를 컴파일한 뒤 읽으므로 생성 코드가 필요 없는 OpMode로(sidecar/tests/opmodes, R의 테스트 OpMode)
      const opmodes = resolve(__dirname, 'opmodes')
      const run = await runSidecar(
        sidecar,
        {
          configXml,
          sourceRoots: [opmodes],
          opModeSource: join(
            opmodes,
            'org',
            'firstinspires',
            'ftc',
            'teamcode',
            'ReturnsEarly.java'
          ),
          opModeClass: 'org.firstinspires.ftc.teamcode.ReturnsEarly'
        },
        {},
        0
      )
      const errors = run.messages.filter((m) => m.type === 'error')
      expect(errors.map((e) => e.type === 'error' && e.kind)).toEqual(['config'])
      expect(errors[0].type === 'error' && errors[0].message).toMatch(/FancyMotor/)
      expect(finishedReason(run)).toBe('loadFailed')
    },
    SIDECAR_TEST_TIMEOUT
  )
})
