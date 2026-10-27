// 사이드카 장치 테스트: 가짜 SDK의 장치 구현(sidecar/sdk/org/sandbot/sdk/devices와 실제 이름의 손 구현)을
// sandbot-sdk.jar로 시험한다. JDK가 없으면 건너뛴다.
//  - Java 단위 테스트(sidecar/tests/java/org/sandbot/sdk/devices): 구성 XML → hardwareMap, 허브 비용, 장치 의미, Color·Matrix
//  - 생성 코드: SandBot이 만드는 구성 XML·하드웨어 클래스(src/renderer/src/hardware)를 그대로 써서, 카탈로그의 모든 종류를
//    두 허브에 붙인 로봇의 생성 초기화 순서가 예외 없이 돌고 시뮬레이터 장치가 그 설정을 보이는지 본다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
})
