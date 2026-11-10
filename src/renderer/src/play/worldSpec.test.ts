import { describe, expect, it } from 'vitest'
import { resolveMotorParams } from '../../../shared/sim/actuatorData'
import {
  DEFAULT_WHEEL_FRICTION,
  DEFAULT_WHEEL_MASS,
  WHEEL_SPIN_INERTIA_FACTOR
} from '../../../shared/sim/wheelData'
import { parseWorldSpec, type Vec2 } from '../../../shared/sim/worldSpec'
import { cadRootTransform } from '../cad/alignment'
import { createComponent } from '../hardware/components'
import { generateConfigXml } from '../hardware/configXml'
import { componentCotsKey, cotsEntry, wheelCotsKey } from '../mass/cotsTable'
import { computeMassModel } from '../mass/massModel'
import { DEFAULT_ROBOT_MASS, type MassLookup, type MassModel } from '../mass/types'
import { defaultJoint } from '../scene/joint'
import type { HardwareComponent, SceneObject, SceneObjects, WheelSettings } from '../scene/model'
import { defaultWheel } from '../scene/wheel'
import {
  buildWorldSpec,
  fewWheelContacts,
  MIN_CHASSIS_INERTIA,
  placeholderChassisBody,
  robotFootprint,
  robotOutline,
  robotNeedsMassModel,
  robotWheels,
  wheelPosition,
  wheelTopSpeed,
  type WorldWarning
} from './worldSpec'

const DEG = Math.PI / 180
const SETTINGS = { batteryVoltage: 12.5 }

let nextId = 0
function motor(
  name: string,
  port: number,
  props: Record<string, string | number> = {}
): HardwareComponent {
  const base = createComponent('motor', [], () => `motor-${name}`)
  return { ...base, name, port, props: { ...base.props, ...props } }
}

function part(
  id: string,
  parentId: string,
  position: [number, number, number],
  extra: Partial<SceneObject> = {}
): SceneObject {
  return {
    id,
    name: id,
    kind: 'part',
    parentId,
    transform: { position, rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: `g${nextId++}`, color: [1, 1, 1] },
    ...extra
  }
}

const wheel = (patch: Partial<WheelSettings> = {}): WheelSettings => ({
  ...defaultWheel(),
  ...patch
})

// 메카넘 4륜 로봇. 바퀴 배치는 로봇 중심에서 앞으로 0.1 m 치우쳐 있다(자동 롤러가 메카넘 중심을 기준으로 하는지 보려고).
// 모터는 drive 파트에 모았다.
function mecanumRobot(): SceneObjects {
  const motors: HardwareComponent[] = [
    motor('leftFront', 0, { direction: 'reverse', gearbox: 19.2 }),
    motor('rightFront', 1, { gearbox: 19.2 }),
    motor('leftBack', 2, { direction: 'reverse', gearbox: 19.2 }),
    // 감속비 0 = 모델 기본(SDK 5202 계열 99.5)
    motor(' rightBack ', 3)
  ]
  return {
    R: {
      id: 'R',
      name: 'Robot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0.5, -0.3, 0], rotation: [0, 0, 30 * DEG] },
      hardware: {
        className: 'MecanumBot',
        configName: 'Mecanum Bot',
        expansionHub: { enabled: true, address: 2 }
      }
    },
    drive: part('drive', 'R', [0, 0, 0.05], { components: motors }),
    FL: part('FL', 'R', [0.25, 0.15, 0.05], { wheel: wheel({ motor: 'motor-leftFront' }) }),
    FR: part('FR', 'R', [0.25, -0.15, 0.05], { wheel: wheel({ motor: 'motor-rightFront' }) }),
    BL: part('BL', 'R', [0.05, 0.15, 0.05], { wheel: wheel({ motor: 'motor-leftBack' }) }),
    BR: part('BR', 'R', [0.05, -0.15, 0.05], { wheel: wheel({ motor: 'motor- rightBack ' }) })
  }
}

const GOBILDA = 'goBILDA5202SeriesMotor'

const keys = (warnings: WorldWarning[]): string[] => warnings.map((w) => w.key)

describe('buildWorldSpec', () => {
  it('메카넘 로봇: 시작 자세·허브·모터·바퀴', () => {
    const { spec, warnings } = buildWorldSpec(mecanumRobot(), 'R', SETTINGS)
    expect(warnings).toEqual([])
    expect(spec).not.toBeNull()
    expect(spec!.robot.start).toEqual({ x: 0.5, y: -0.3, yaw: 30 * DEG })
    expect(spec!.batteryVoltage).toBe(12.5)
    // 구성 XML의 LynxModule 이름(같은 순서)
    expect(spec!.hubs).toEqual(['Expansion Hub 2', 'Control Hub'])
    const params = expect.any(Object) as unknown
    expect(spec!.motors).toEqual([
      { device: 'leftFront', modelTag: GOBILDA, gearbox: 19.2, directionSign: -1, params },
      { device: 'rightFront', modelTag: GOBILDA, gearbox: 19.2, directionSign: 1, params },
      { device: 'leftBack', modelTag: GOBILDA, gearbox: 19.2, directionSign: -1, params },
      // 이름은 사이드카처럼 앞뒤 공백을 뺀다
      { device: 'rightBack', modelTag: GOBILDA, gearbox: 99.5, directionSign: 1, params }
    ])
    // 기어모터 값은 실제 감속비로 푼 데이터시트 값(감속비 칸 0 = 모델의 실제 감속비, 엔코더의 SDK gearbox와 따로)
    expect(spec!.motors[0].params).toEqual(resolveMotorParams(GOBILDA, 19.2))
    expect(spec!.motors[3].params).toEqual(resolveMotorParams(GOBILDA, 'default'))
    const wheels = spec!.wheels.map((w) => ({ ...w, position: rounded(w.position) }))
    expect(wheels).toEqual([
      {
        position: { x: 0.25, y: 0.15 },
        angle: 0,
        kind: 'mecanum',
        rollers: 'flbr',
        radius: 0.052,
        gearRatio: 1,
        motor: 'leftFront',
        // 종류 기본 질량(goBILDA GripForce 236 g)의 회전 관성, 종류 기본 마찰(3c)
        spinInertia: WHEEL_SPIN_INERTIA_FACTOR * 0.236 * 0.052 * 0.052,
        friction: DEFAULT_WHEEL_FRICTION.mecanum
      },
      expect.objectContaining({ position: { x: 0.25, y: -0.15 }, rollers: 'frbl' }),
      // 로봇 중심으로는 앞쪽이지만 메카넘 중심(x = 0.15)으로는 뒤쪽
      expect.objectContaining({ position: { x: 0.05, y: 0.15 }, rollers: 'frbl' }),
      expect.objectContaining({
        position: { x: 0.05, y: -0.15 },
        rollers: 'flbr',
        motor: 'rightBack'
      })
    ])
    // 메인과 같은 검증을 통과하고 다른 키가 없다
    expect(parseWorldSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec)
  })

  it('같은 씬이면 바이트 단위로 같은 세계 설명', () => {
    const a = JSON.stringify(buildWorldSpec(mecanumRobot(), 'R', SETTINGS))
    const b = JSON.stringify(buildWorldSpec(mecanumRobot(), 'R', SETTINGS))
    expect(a).toBe(b)
  })

  it('그룹 바퀴의 위치는 하위 메시 피벗들의 경계 중심(평균이 아님)', () => {
    const objects = mecanumRobot()
    delete objects.FL.wheel
    objects.flGroup = {
      id: 'flGroup',
      name: 'FL Wheel',
      kind: 'group',
      parentId: 'R',
      // 그룹이 돌아가 있어도 위치는 로봇 좌표로 구한다
      transform: { position: [0.2, 0.1, 0], rotation: [0, 0, 90 * DEG] },
      wheel: wheel({ motor: 'motor-leftFront' })
    }
    // 그룹 좌표 (0.1, 0)·(0, 0.1)·(0.02, -0.05)·(0.05, 0.03) → 로봇 좌표 (0.2, 0.2)·(0.1, 0.1)·(0.25, 0.12)·(0.17, 0.15)
    objects.hub = part('hub', 'flGroup', [0.1, 0, 0])
    objects.roller1 = part('roller1', 'flGroup', [0, 0.1, 0])
    objects.roller2 = part('roller2', 'flGroup', [0.02, -0.05, 0])
    objects.roller3 = part('roller3', 'flGroup', [0.05, 0.03, 0])
    // 형상 없는 하위 그룹의 피벗은 넣지 않는다
    objects.empty = { ...part('empty', 'flGroup', [3, 3, 0]), visual: undefined, kind: 'group' }
    expect(rounded(wheelPosition(objects, 'flGroup')!)).toEqual({ x: 0.175, y: 0.15 })
    const { spec } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(spec!.wheels.map((w) => rounded(w.position))).toContainEqual({ x: 0.175, y: 0.15 })
  })

  it('형상 있는 오브젝트는 자기 피벗, 형상도 하위도 없는 그룹은 자기 위치', () => {
    const objects = mecanumRobot()
    objects.FL.parentId = 'drive'
    objects.lonely = {
      id: 'lonely',
      name: 'lonely',
      kind: 'group',
      parentId: 'R',
      transform: { position: [-0.1, 0.2, 0], rotation: [0, 0, 0] }
    }
    expect(rounded(wheelPosition(objects, 'FL')!)).toEqual({ x: 0.25, y: 0.15 })
    expect(rounded(wheelPosition(objects, 'lonely')!)).toEqual({ x: -0.1, y: 0.2 })
  })

  it('메카넘 자동 롤러: 중심선 위·한 개·옆으로 구르는 바퀴는 모호하다고 알리고 flbr', () => {
    const objects = mecanumRobot()
    objects.FL.wheel = wheel({ motor: 'motor-leftFront', rollers: 'frbl' })
    objects.FR.wheel = wheel({ motor: 'motor-rightFront', angle: 180 * DEG })
    objects.BL.wheel = wheel({ motor: 'motor-leftBack', angle: 90 * DEG })
    const resolved = robotWheels(objects, 'R')
    expect(
      resolved.map((w) => [w.name, w.rollers, w.autoRollers, w.rollersAuto, w.rollersAmbiguous])
    ).toEqual([
      // 직접 고른 형은 그대로 쓰고, 자동이라면 고를 형(앞왼 자리 → flbr)은 따로 둔다
      ['FL', 'frbl', 'flbr', false, false],
      // 뒤로 굴리게(180°) 단 바퀴도 롤러 축이 같아 위치로 정한다
      ['FR', 'frbl', 'frbl', true, false],
      ['BL', 'flbr', 'flbr', true, true],
      ['BR', 'flbr', 'flbr', true, false]
    ])
    const { warnings } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(warnings).toEqual([{ key: 'worldRollersAmbiguous', params: { name: 'BL' } }])

    // 메카넘 바퀴 하나는 중심 위에 있다
    const single = mecanumRobot()
    for (const id of ['FR', 'BL', 'BR']) delete single[id].wheel
    expect(robotWheels(single, 'R')[0]).toMatchObject({ rollers: 'flbr', rollersAmbiguous: true })
    // 옴니·일반 바퀴는 롤러가 없고 메카넘 중심에 넣지 않는다
    const mixed = mecanumRobot()
    mixed.FL.wheel = wheel({ kind: 'omni', motor: 'motor-leftFront' })
    mixed.BR.wheel = wheel({ kind: 'traction', motor: 'motor- rightBack ' })
    const kinds = robotWheels(mixed, 'R').map((w) => [
      w.name,
      w.rollers,
      w.autoRollers,
      w.rollersAmbiguous
    ])
    // 메카넘 FR·BL의 중심은 (0.15, 0): FR 앞오른 → frbl, BL 뒤왼 → frbl
    expect(kinds).toEqual([
      ['FL', null, null, false],
      ['FR', 'frbl', 'frbl', false],
      ['BL', 'frbl', 'frbl', false],
      ['BR', null, null, false]
    ])
  })

  it('구동 모터: 없음·지움·다른 로봇은 null과 경고(참조는 씬에 남음)', () => {
    const objects = mecanumRobot()
    objects.R2 = {
      id: 'R2',
      name: 'Other',
      kind: 'robot',
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
    }
    objects.other = part('other', 'R2', [0, 0, 0], { components: [motor('otherMotor', 0)] })
    objects.FL.wheel = wheel({ motor: '' })
    objects.FR.wheel = wheel({ motor: 'deleted' })
    objects.BL.wheel = wheel({ motor: 'motor-otherMotor' })
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(spec!.wheels.map((w) => w.motor)).toEqual([null, null, null, 'rightBack'])
    expect(warnings).toEqual([
      { key: 'worldWheelNoMotor', params: { name: 'FL' } },
      { key: 'worldWheelMotorMissing', params: { name: 'FR' } },
      { key: 'worldWheelMotorMissing', params: { name: 'BL' } }
    ])
    expect(objects.FR.wheel.motor).toBe('deleted')
    // 다른 로봇의 세계에는 이 로봇의 바퀴가 없다
    expect(buildWorldSpec(objects, 'R2', SETTINGS).spec!.wheels).toEqual([])
    expect(keys(buildWorldSpec(objects, 'R2', SETTINGS).warnings)).toEqual(['worldNoWheels'])
  })

  it('이름이 비었거나 겹친 모터는 쓰지 않고, 그 모터의 바퀴는 구동하지 않는다', () => {
    const objects = mecanumRobot()
    objects.drive = {
      ...objects.drive,
      components: [
        ...objects.drive.components!,
        { ...motor('leftFront', 0), id: 'dup' },
        { ...motor('   ', 1), id: 'blank' }
      ]
    }
    objects.BR.wheel = wheel({ motor: 'dup' })
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(spec!.motors.map((m) => m.device)).toEqual([
      'leftFront',
      'rightFront',
      'leftBack',
      'rightBack'
    ])
    expect(spec!.wheels[3].motor).toBeNull()
    expect(warnings).toEqual([
      { key: 'worldDuplicateMotor', params: { name: 'leftFront' } },
      { key: 'worldDuplicateMotor', params: { name: '   ' } }
    ])
  })

  it('장치 이름은 사이드카처럼 Java trim(U+0020 이하만 뺀다): NBSP·U+3000이 남은 이름도 구성 XML과 같다', () => {
    const objects = mecanumRobot()
    const motors = objects.drive.components!
    // 웹 문서에서 붙여 넣은 NBSP, IME의 전각 공백. 탭·공백은 Java trim도 뺀다.
    motors[0] = { ...motors[0], name: 'leftFront\u00a0' }
    motors[1] = { ...motors[1], name: '\t\u3000rightFront ' }
    const imu = createComponent('imu', [], () => 'imu')
    objects.sensors = part('sensors', 'R', [0, 0, 0.1], {
      components: [{ ...imu, name: ' imu\u00a0' }]
    })
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(warnings).toEqual([])
    expect(spec!.motors.map((m) => m.device).slice(0, 2)).toEqual([
      'leftFront\u00a0',
      '\u3000rightFront'
    ])
    expect(spec!.wheels.map((w) => w.motor).slice(0, 2)).toEqual([
      'leftFront\u00a0',
      '\u3000rightFront'
    ])
    expect(spec!.imus).toEqual([{ device: 'imu\u00a0' }])
    // 구성 XML은 이름을 그대로 쓰고 사이드카가 Java trim한다(SandbotHardware.name)
    const xml = generateConfigXml(objects, 'R')
    expect(xml).toContain('name="leftFront\u00a0"')
    expect(xml).toContain('name="\t\u3000rightFront "')
  })

  it('한도를 넘는 목록은 앞의 것만 쓰고 목록마다 다른 경고(번역할 이름을 params에 넣지 않는다)', () => {
    const objects = mecanumRobot()
    const many = (type: 'imu' | 'otos' | 'pinpoint' | 'deadWheel'): HardwareComponent[] =>
      Array.from({ length: 33 }, (_, i) => ({
        ...createComponent(type, [], () => `${type}-${i}`),
        name: `${type}${i}`
      }))
    objects.sensors = part('sensors', 'R', [0, 0, 0.1], {
      components: [
        ...many('imu'),
        ...many('otos'),
        ...many('pinpoint'),
        // 모터가 없는 포트라 데드휠마다 자기 이름
        ...many('deadWheel').map((pod) => ({ ...pod, hub: 'expansionHub' as const, port: 3 }))
      ]
    })
    objects.motors = part('motors', 'R', [0, 0, 0.2], {
      components: Array.from({ length: 61 }, (_, i) => ({
        ...motor(`m${i}`, 0),
        id: `extra-${i}`
      }))
    })
    for (let i = 0; i < 29; i++)
      objects[`w${i}`] = part(`w${i}`, 'R', [-0.2, 0.01 * i - 0.15, 0], {
        wheel: wheel({ kind: 'omni' })
      })
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(spec!.motors).toHaveLength(64)
    expect(spec!.wheels).toHaveLength(32)
    expect(spec!.imus).toHaveLength(32)
    expect(spec!.otos).toHaveLength(32)
    expect(spec!.pinpoints).toHaveLength(32)
    expect(spec!.deadWheels.map((pod) => pod.device).at(-1)).toBe('deadWheel31')
    expect(warnings.filter((w) => w.key.startsWith('worldTooMany'))).toEqual([
      { key: 'worldTooManyMotors', params: { max: 64 } },
      { key: 'worldTooManyWheels', params: { max: 32 } },
      { key: 'worldTooManyDeadWheels', params: { max: 32 } },
      { key: 'worldTooManyPinpoints', params: { max: 32 } },
      { key: 'worldTooManyOtos', params: { max: 32 } },
      { key: 'worldTooManyImus', params: { max: 32 } }
    ])
  })

  it('바퀴가 없으면 경고하고, 메커니즘 모터도 세계에 넣는다', () => {
    const objects = mecanumRobot()
    for (const id of ['FL', 'FR', 'BL', 'BR']) delete objects[id].wheel
    objects.lift = part('lift', 'R', [0, 0, 0.3], {
      components: [motor('lift', 0, { motorModel: 'revUltraPlanetary' })]
    })
    objects.lift.components![0].hub = 'expansionHub'
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(keys(warnings)).toEqual(['worldNoWheels'])
    expect(spec!.wheels).toEqual([])
    expect(spec!.motors.at(-1)).toEqual({
      device: 'lift',
      modelTag: 'RevRoboticsUltraplanetaryHDHexMotor',
      gearbox: 20,
      directionSign: 1,
      params: resolveMotorParams('RevRoboticsUltraplanetaryHDHexMotor', 'default')
    })
  })

  it('데드휠: 같은 포트 모터의 이름을 쓰고, 그 모터가 엔코더 모드면 경고한다', () => {
    const objects = mecanumRobot()
    const par = createComponent('deadWheel', [], () => 'par')
    const perp = createComponent('deadWheel', [], () => 'perp')
    const extra = createComponent('deadWheel', [], () => 'extra')
    objects.parPod = part('parPod', 'R', [0, 0.12, 0], {
      // rightFront(포트 1)와 엔코더 포트를 함께 쓴다
      components: [{ ...par, name: 'par', port: 1, props: { ...par.props, reversed: 'yes' } }]
    })
    objects.perpPod = part('perpPod', 'R', [-0.08, 0, 0], {
      components: [
        {
          ...perp,
          name: 'perp',
          port: 2,
          props: { ...perp.props, measures: 'strafe', podType: 'swingarm' }
        }
      ]
    })
    objects.extraPod = part('extraPod', 'R', [0.1, -0.1, 0], {
      // 모터가 없는 Expansion Hub 포트 3: 자기 이름, REV Through Bore 35 mm
      components: [
        {
          ...extra,
          name: 'extra',
          hub: 'expansionHub',
          port: 3,
          props: { ...extra.props, podType: 'revThroughBore', podDiameter: 0.035 }
        }
      ]
    })
    objects.drive.components![1].props.runMode = 'usingEncoder'
    // leftBack(포트 2)은 엔코더 없이 돌리므로 경고하지 않는다
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(
      spec!.deadWheels.map((d) => ({
        ...d,
        position: rounded(d.position),
        ticksPerMeter: Math.round(d.ticksPerMeter * 1e6) / 1e6
      }))
    ).toEqual([
      {
        device: 'rightFront',
        position: { x: 0, y: 0.12 },
        measures: 'forward',
        reversed: true,
        // goBILDA 4-Bar: 19.89436789 틱/mm
        ticksPerMeter: 19894.36789
      },
      {
        device: 'leftBack',
        position: { x: -0.08, y: 0 },
        measures: 'strafe',
        reversed: false,
        ticksPerMeter: 13262.91192
      },
      {
        device: 'extra',
        position: { x: 0.1, y: -0.1 },
        measures: 'forward',
        reversed: false,
        ticksPerMeter: Math.round((8192 / (Math.PI * 0.035)) * 1e6) / 1e6
      }
    ])
    expect(warnings).toEqual([
      { key: 'worldSharedEncoder', params: { deadWheel: 'par', motor: 'rightFront' } }
    ])
  })

  it('Pinpoint·OTOS·IMU', () => {
    const objects = mecanumRobot()
    const pinpoint = createComponent('pinpoint', [], () => 'pp')
    const otos = createComponent('otos', [], () => 'otos')
    const imu = createComponent('imu', [], () => 'imu')
    objects.xPod = part('xPod', 'R', [0.02, 0.1, 0])
    objects.yPod = part('yPod', 'R', [-0.12, 0.01, 0])
    objects.sensors = part('sensors', 'R', [0.1, -0.05, 0.1], {
      components: [
        {
          ...pinpoint,
          props: {
            ...pinpoint.props,
            podType: 'swingarm',
            xPod: 'xPod',
            // 다른 로봇·없는 파트는 null
            yPod: 'nope',
            xDirection: 'reversed'
          }
        },
        { ...otos, props: { ...otos.props, mountingAngle: -90 } },
        imu
      ]
    })
    const { spec } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(spec!.pinpoints).toEqual([
      {
        device: 'pinpoint',
        xPod: expect.objectContaining({}),
        yPod: null,
        podTicksPerMm: 13.26291192,
        xReversed: true,
        yReversed: false
      }
    ])
    expect(rounded(spec!.pinpoints[0].xPod!)).toEqual({ x: 0.02, y: 0.1 })
    expect(spec!.otos).toEqual([
      { device: 'otos', position: expect.objectContaining({}), mountingAngle: expect.any(Number) }
    ])
    expect(spec!.otos[0].mountingAngle).toBeCloseTo(-Math.PI / 2, 12)
    expect(rounded(spec!.otos[0].position)).toEqual({ x: 0.1, y: -0.05 })
    expect(spec!.imus).toEqual([{ device: 'imu' }])
  })

  it('외곽: CAD 루트들의 경계 상자를 로봇 좌표 바닥 사각형으로, 없으면 18 in 정사각형', () => {
    const objects = mecanumRobot()
    const half = (18 * 0.0254) / 2
    expect(robotFootprint(objects, 'R').map(rounded)).toEqual(
      [
        { x: half, y: -half },
        { x: half, y: half },
        { x: -half, y: half },
        { x: -half, y: -half }
      ].map(rounded)
    )
    // Y-up CAD(앞 = +Z): 로봇 X = CAD Z, 로봇 Y = CAD X. 형상은 로딩하지 않아도 된다.
    const bounds = { min: [-0.2, 0, -0.15], max: [0.2, 0.3, 0.17] } as {
      min: [number, number, number]
      max: [number, number, number]
    }
    // 씬 문서는 불변이다(childrenInDocument가 문서마다 자식 목록을 기억한다)
    const cadRoot: SceneObject = {
      id: 'cad',
      name: 'robot.step',
      kind: 'assembly',
      parentId: 'R',
      transform: cadRootTransform(bounds, { upAxis: '+Y', forwardAxis: '+Z' }),
      cad: {
        fileName: 'robot.step',
        absolutePath: '/cad/robot.step',
        upAxis: '+Y',
        forwardAxis: '+Z',
        bounds,
        meshCount: 0,
        meshIndexing: 'source'
      }
    }
    const withCad: SceneObjects = { ...objects, cad: cadRoot }
    expect(robotFootprint(withCad, 'R').map(rounded)).toEqual([
      { x: 0.16, y: -0.2 },
      { x: 0.16, y: 0.2 },
      { x: -0.16, y: 0.2 },
      { x: -0.16, y: -0.2 }
    ])
    // CAD 루트를 옮기면(정렬 직접 편집) 외곽도 따라간다
    const [px, py, pz] = cadRoot.transform.position
    const moved: SceneObjects = {
      ...withCad,
      cad: { ...cadRoot, transform: { ...cadRoot.transform, position: [px + 0.05, py, pz] } }
    }
    expect(robotFootprint(moved, 'R').map(rounded)[0]).toEqual({ x: 0.21, y: -0.2 })
    expect(buildWorldSpec(moved, 'R', SETTINGS).spec!.robot.footprint.map(rounded)[0]).toEqual({
      x: 0.21,
      y: -0.2
    })
  })

  // spec-4ab §3: 높이는 편집 자세 CAD 경계 상자 꼭짓점 z의 최대값, CAD가 없으면 18 in. 빌더는 v4 기본 칸을 채운다
  it('robotOutline 높이와 세계 설명 v4 기본 칸', () => {
    const objects = mecanumRobot()
    expect(robotOutline(objects, 'R').height).toBeCloseTo(0.4572, 12)
    const bounds = { min: [-0.2, 0, -0.15], max: [0.2, 0.3, 0.17] } as {
      min: [number, number, number]
      max: [number, number, number]
    }
    const withCad: SceneObjects = {
      ...objects,
      cad: {
        id: 'cad',
        name: 'robot.step',
        kind: 'assembly',
        parentId: 'R',
        transform: cadRootTransform(bounds, { upAxis: '+Y', forwardAxis: '+Z' }),
        cad: {
          fileName: 'robot.step',
          absolutePath: '/cad/robot.step',
          upAxis: '+Y',
          forwardAxis: '+Z',
          bounds,
          meshCount: 0,
          meshIndexing: 'source'
        }
      }
    }
    // Y-up CAD의 높이 0.3 m(바닥 면이 로봇 원점 높이)
    expect(robotOutline(withCad, 'R').height).toBeCloseTo(0.3, 12)
    expect(robotOutline(withCad, 'R').footprint).toEqual(robotFootprint(withCad, 'R'))
    const spec = buildWorldSpec(withCad, 'R', SETTINGS).spec!
    expect(spec.robot.height).toBeCloseTo(0.3, 12)
    expect(spec.field).toEqual({ season: 'none', hiveTipped: [false, false] })
    expect(spec.distanceSensors).toEqual([])
    expect(spec.colorSensors).toEqual([])
    expect(spec.noise).toEqual({ enabled: false, seed: 0 })
  })

  it('로봇이 아니거나 없으면 null, 메인이 받지 않을 값이면 null과 worldInvalid', () => {
    const objects = mecanumRobot()
    const none = {
      spec: null,
      warnings: [],
      jointObjectIds: [],
      jointMotorIds: [],
      sensors: [],
      sensorExclusions: new Map(),
      cameras: [],
      cameraExclusions: new Map(),
      colliders: [],
      ignoredPairs: []
    }
    expect(buildWorldSpec(objects, 'FL', SETTINGS)).toEqual(none)
    expect(buildWorldSpec(objects, 'nope', SETTINGS)).toEqual(none)
    objects.R = { ...objects.R, transform: { position: [50, 0, 0], rotation: [0, 0, 0] } }
    const far = buildWorldSpec(objects, 'R', SETTINGS)
    expect(far.spec).toBeNull()
    expect(far.warnings).toEqual([{ key: 'worldInvalid', params: { detail: 'robot.start' } }])
  })

  it('최고 속도: 데이터시트 무부하 속도(goBILDA 5203 19.2:1 312 RPM), 104 mm 바퀴', () => {
    const props = motor('m', 0, { gearbox: 19.2 }).props
    // 제조사 표의 무부하 312 RPM(SDK 형식 60 RPM × 99.5 ÷ 19.2 = 310.94 RPM이 아니다): 312/60 × π × 0.104 m
    const speed12 = wheelTopSpeed(wheel(), props, 12)
    expect(speed12).toBeCloseTo((312 / 60) * Math.PI * 0.104, 10)
    expect(speed12).toBeCloseTo(1.699, 3)
    // 세계 설명의 바퀴 모터가 쓰는 값과 같다(rad/s × 반지름)
    expect(speed12).toBeCloseTo(resolveMotorParams(GOBILDA, 19.2).freeSpeed * 0.052, 12)
    expect(wheelTopSpeed(wheel(), props, 12.5)).toBeCloseTo((speed12 * 12.5) / 12, 10)
    expect(wheelTopSpeed(wheel({ gearRatio: 2 }), props, 12)).toBeCloseTo(speed12 / 2, 10)
    // 감속비 칸 0 = 모델의 실제 감속비(5202 계열 기본 99.5:1 근처의 표 행), 무부하 속도 덮어쓰기(RPM)도 따른다
    const defaultProps = motor('m', 0).props
    expect(wheelTopSpeed(wheel(), defaultProps, 12)).toBeCloseTo(
      resolveMotorParams(GOBILDA, 'default').freeSpeed * 0.052,
      12
    )
    const fast = motor('m', 0, { gearbox: 19.2, freeSpeed: 400 }).props
    expect(wheelTopSpeed(wheel(), fast, 12)).toBeCloseTo((400 / 60) * Math.PI * 0.104, 10)
  })
})

describe('섀시 몸체·바퀴 질량·접점(3c)', () => {
  const NO_GEOMETRY: MassLookup = { props: () => undefined, sourcePath: () => undefined }
  // 아래 로봇의 바퀴는 구동 모터가 없다(모터 컴포넌트의 COTS 질량이 점질량 합을 바꾸지 않게): 그 경고는 빼고 본다
  const chassisWarnings = (warnings: WorldWarning[]): WorldWarning[] =>
    warnings.filter((warning) => warning.key !== 'worldWheelNoMotor')

  const pointGroup = (
    id: string,
    parentId: string,
    position: [number, number, number],
    extra: Partial<SceneObject> = {}
  ): SceneObject => ({
    id,
    name: id,
    kind: 'group',
    parentId,
    transform: { position, rotation: [0, 0, 0] },
    ...extra
  })

  // 형상 없는 그룹(점질량 덮어쓰기)만으로 된 로봇: 질량 모델의 로봇 전체가 점질량의 합 그대로다(저울 무게 = 고정 질량이라
  // 정보 없는 로봇의 외곽 상자를 두지 않는다). 바퀴 넷(앞 둘은 0.3 kg 덮어쓰기), 배터리 5 kg, 판 3 kg, 팔(회전 관절) 2 kg.
  function pointRobot(): SceneObjects {
    return {
      R: {
        id: 'R',
        name: 'Robot',
        kind: 'robot',
        parentId: null,
        transform: { position: [0.2, 0.1, 0], rotation: [0, 0, 0.4] },
        rigidbody: { weighedMass: 10.6 }
      },
      battery: pointGroup('battery', 'R', [-0.1, 0, 0.05], { mass: { mass: 5 } }),
      plate: pointGroup('plate', 'R', [0.05, 0.02, 0.03], { mass: { mass: 3 } }),
      FL: pointGroup('FL', 'R', [0.15, 0.15, 0.05], {
        wheel: defaultWheel('traction'),
        mass: { mass: 0.3 }
      }),
      FR: pointGroup('FR', 'R', [0.15, -0.15, 0.05], {
        wheel: defaultWheel('traction'),
        mass: { mass: 0.3 }
      }),
      BL: pointGroup('BL', 'R', [-0.15, 0.15, 0.05], { wheel: defaultWheel('traction') }),
      BR: pointGroup('BR', 'R', [-0.15, -0.15, 0.05], { wheel: defaultWheel('traction') }),
      arm: pointGroup('arm', 'R', [0.15, 0, 0.2], {
        joint: { ...defaultJoint('revolute'), axis: 'y' }
      }),
      armMass: pointGroup('armMass', 'arm', [0.2, 0, 0], { mass: { mass: 2 } })
    }
  }

  // 점질량들의 질량 성질(로봇 좌표, 무게중심 기준 관성)
  function pointMasses(points: { m: number; p: [number, number, number] }[]): {
    mass: number
    com: number[]
    inertia: number[]
  } {
    const mass = points.reduce((sum, { m }) => sum + m, 0)
    const com = [0, 1, 2].map((k) => points.reduce((sum, { m, p }) => sum + m * p[k], 0) / mass)
    const inertia = [0, 0, 0, 0, 0, 0]
    for (const { m, p } of points) {
      const [dx, dy, dz] = [0, 1, 2].map((k) => p[k] - com[k])
      inertia[0] += m * (dy * dy + dz * dz)
      inertia[1] += m * (dx * dx + dz * dz)
      inertia[2] += m * (dx * dx + dy * dy)
      inertia[3] -= m * dx * dy
      inertia[4] -= m * dx * dz
      inertia[5] -= m * dy * dz
    }
    return { mass, com, inertia }
  }

  it('섀시 = 로봇 전체 − 관절 몸체(평행축, 로봇 좌표, 무게중심 기준 관성), 바퀴 질량은 섀시에 들어간다', () => {
    const objects = pointRobot()
    const mass = computeMassModel(objects, NO_GEOMETRY)
    expect(mass.robots.R.mass).toBeCloseTo(10.6, 12)
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS, mass)
    expect(chassisWarnings(warnings)).toEqual([])
    const expected = pointMasses([
      { m: 5, p: [-0.1, 0, 0.05] },
      { m: 3, p: [0.05, 0.02, 0.03] },
      { m: 0.3, p: [0.15, 0.15, 0.05] },
      { m: 0.3, p: [0.15, -0.15, 0.05] }
    ])
    const body = spec!.robot.body
    expect(body.mass).toBeCloseTo(expected.mass, 12)
    expect(body.centerOfMass.x).toBeCloseTo(expected.com[0], 12)
    expect(body.centerOfMass.y).toBeCloseTo(expected.com[1], 12)
    expect(body.centerOfMass.z).toBeCloseTo(expected.com[2], 12)
    body.inertia.forEach((value, i) => expect(value).toBeCloseTo(expected.inertia[i], 12))
    // 관절 몸체는 팔 2 kg(관절 틀 기준)
    expect(spec!.joints[0].body.mass).toBeCloseTo(2, 12)
    // 메인과 같은 검증을 통과한다(IPC가 나르는 JSON 모양: 관절 틀의 −0은 0이 된다)
    const wire: unknown = JSON.parse(JSON.stringify(spec))
    expect(parseWorldSpec(wire)).toEqual(wire)
  })

  it('바퀴 회전 관성은 질량 모델의 바퀴 하위 질량, 모르거나 0이면 종류 기본 질량', () => {
    const objects = pointRobot()
    const r = defaultWheel('traction').diameter / 2
    const own = (m: number): number => WHEEL_SPIN_INERTIA_FACTOR * m * r * r
    const { spec } = buildWorldSpec(objects, 'R', SETTINGS, computeMassModel(objects, NO_GEOMETRY))
    const spins = spec!.wheels.map((w) => w.spinInertia)
    ;[0.3, 0.3, DEFAULT_WHEEL_MASS.traction, DEFAULT_WHEEL_MASS.traction].forEach((m, i) =>
      expect(spins[i]).toBeCloseTo(own(m), 15)
    )
    // 질량 모델 없이(인스펙터 경로)는 모두 종류 기본
    const plain = buildWorldSpec(objects, 'R', SETTINGS).spec!
    for (const w of plain.wheels)
      expect(w.spinInertia).toBeCloseTo(own(DEFAULT_WHEEL_MASS.traction), 15)
    // 질량 모델의 바퀴 질량이 터무니없이 크면 2 kg로 자른다(wheelData MAX_WHEEL_MASS)
    const heavy: SceneObjects = {
      ...objects,
      R: { ...objects.R, rigidbody: { weighedMass: 60.3 } },
      FL: { ...objects.FL, mass: { mass: 50 } }
    }
    const clipped = buildWorldSpec(heavy, 'R', SETTINGS, computeMassModel(heavy, NO_GEOMETRY))
    expect(clipped.spec!.wheels[0].spinInertia).toBeCloseTo(own(2), 15)
  })

  it('바퀴로 도는 질량: 바퀴 하위의 모터 등 하드웨어 데이터시트 질량은 빼고, 표의 메카넘 바퀴는 데이터시트 질량', () => {
    // 모터를 바퀴 그룹마다 붙인 메카넘 104 mm 4륜(형상 없음): 질량 모델의 바퀴 하위 질량은 모터 + 바퀴 COTS다
    const motors = ['lf', 'rf', 'lb', 'rb'].map((name, port) =>
      motor(name, port, { gearbox: 19.2 })
    )
    const corners: [number, number][] = [
      [0.15, 0.17],
      [0.15, -0.17],
      [-0.15, 0.17],
      [-0.15, -0.17]
    ]
    const objects: SceneObjects = {
      R: {
        id: 'R',
        name: 'Robot',
        kind: 'robot',
        parentId: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
      }
    }
    corners.forEach(([x, y], i) => {
      objects[`w${i}`] = pointGroup(`w${i}`, 'R', [x, y, 0.052], {
        wheel: wheel({ motor: motors[i].id }),
        components: [motors[i]]
      })
    })
    const r = defaultWheel('mecanum').diameter / 2
    const own = (m: number): number => WHEEL_SPIN_INERTIA_FACTOR * m * r * r
    const motorMass = cotsEntry(componentCotsKey(motors[0])!)!.mass
    const wheelMass = cotsEntry(wheelCotsKey(objects.w0.wheel!)!)!.mass
    const mass = computeMassModel(objects, NO_GEOMETRY)
    expect(mass.objects.w0.mass).toBeCloseTo(motorMass + wheelMass, 12)
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS, mass)
    expect(keys(warnings)).toEqual([])
    for (const w of spec!.wheels) expect(w.spinInertia).toBeCloseTo(own(wheelMass), 15)
    // 바퀴 오브젝트에 질량을 덮어쓰면 그 값에서 하위 하드웨어를 뺀다
    const weighed = { ...objects, w0: { ...objects.w0, mass: { mass: motorMass + 0.3 } } }
    const overridden = buildWorldSpec(
      weighed,
      'R',
      SETTINGS,
      computeMassModel(weighed, NO_GEOMETRY)
    )
    expect(overridden.spec!.wheels[0].spinInertia).toBeCloseTo(own(0.3), 12)
    // 표에 없는 바퀴(일반 바퀴)는 하위 질량 − 하드웨어, 남는 것이 없으면 종류 기본 질량
    const traction = (patch: Partial<SceneObject>): SceneObjects => ({
      ...objects,
      w1: {
        ...objects.w1,
        wheel: wheel({ kind: 'traction', diameter: 0.104, motor: motors[1].id }),
        ...patch
      }
    })
    const plainWheel = traction({ mass: { mass: motorMass + 0.2 } })
    const plain = buildWorldSpec(
      plainWheel,
      'R',
      SETTINGS,
      computeMassModel(plainWheel, NO_GEOMETRY)
    )
    expect(plain.spec!.wheels[1].spinInertia).toBeCloseTo(own(0.2), 12)
    const onlyMotor = traction({})
    const fallback = buildWorldSpec(
      onlyMotor,
      'R',
      SETTINGS,
      computeMassModel(onlyMotor, NO_GEOMETRY)
    )
    expect(fallback.spec!.wheels[1].spinInertia).toBeCloseTo(own(DEFAULT_WHEEL_MASS.traction), 15)
  })

  it('바퀴가 없는 로봇(고정 기저의 관절 실험대)은 섀시가 기본 상자로 바뀌어도 알리지 않는다', () => {
    // 저울 무게를 관절 몸체(팔 14 kg)가 다 가져간다: 바퀴가 있으면 worldChassisMass인 상황
    const objects: SceneObjects = {
      R: {
        id: 'R',
        name: 'Robot',
        kind: 'robot',
        parentId: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
      },
      arm: pointGroup('arm', 'R', [0, 0, 0.3], { joint: defaultJoint('revolute') }),
      armMass: pointGroup('armMass', 'arm', [0.2, 0, 0], { mass: { mass: 14 } })
    }
    const mass = computeMassModel(objects, NO_GEOMETRY)
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS, mass)
    expect(keys(warnings)).toEqual(['worldNoWheels'])
    expect(spec!.robot.body).toEqual(placeholderChassisBody(spec!.robot.footprint))
    expect(spec!.joints[0].body.mass).toBeCloseTo(14, 12)
    // 같은 로봇에 바퀴 넷을 달면 알린다
    const wheeled: SceneObjects = { ...objects }
    ;[
      [0.15, 0.15],
      [0.15, -0.15],
      [-0.15, 0.15],
      [-0.15, -0.15]
    ].forEach(([x, y], i) => {
      wheeled[`w${i}`] = pointGroup(`w${i}`, 'R', [x, y, 0.05], { wheel: defaultWheel('traction') })
    })
    const withWheels = buildWorldSpec(
      wheeled,
      'R',
      SETTINGS,
      computeMassModel(wheeled, NO_GEOMETRY)
    )
    expect(keys(chassisWarnings(withWheels.warnings))).toContain('worldChassisMass')
  })

  it('남은 질량이 0.1 kg보다 작으면 기본 상자와 경고, 질량 모델이 없거나 그 로봇이 없으면 경고 없이 기본 상자', () => {
    // 관절 몸체(팔 2 kg)가 저울 무게를 거의 다 가져간다: 남는 것은 배터리 자리의 50 g
    const objects = pointRobot()
    for (const id of ['plate', 'FL', 'FR']) delete objects[id].mass
    objects.battery = { ...objects.battery, mass: { mass: 0.05 } }
    objects.R = { ...objects.R, rigidbody: { weighedMass: 2.05 } }
    const mass = computeMassModel(objects, NO_GEOMETRY)
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS, mass)
    const placeholder = placeholderChassisBody(spec!.robot.footprint)
    expect(placeholder.mass).toBe(DEFAULT_ROBOT_MASS)
    expect(spec!.robot.body).toEqual(placeholder)
    expect(chassisWarnings(warnings)).toEqual([
      { key: 'worldChassisMass', params: { mass: 0.05, fallback: DEFAULT_ROBOT_MASS } }
    ])
    // 질량 모델이 없으면(로봇 카드·모터 카드) 같은 상자를 경고 없이
    const plain = buildWorldSpec(objects, 'R', SETTINGS)
    expect(plain.spec!.robot.body).toEqual(placeholder)
    expect(chassisWarnings(plain.warnings)).toEqual([])
    const empty: MassModel = { objects: {}, robots: {} }
    const missing = buildWorldSpec(objects, 'R', SETTINGS, empty)
    expect(missing.spec!.robot.body).toEqual(placeholder)
    expect(keys(missing.warnings)).not.toContain('worldChassisMass')
  })

  it('섀시에 형상을 읽는 중·못 읽은 메시가 남으면 경고(관절 몸체의 것은 빼고 센다), 다 읽었거나 바퀴가 없으면 경고 없음', () => {
    // 한 변 0.1 m 정육면체 메시(닫힘 0)
    const s = 0.1
    const cube = {
      volume: s ** 3,
      centroid: [0, 0, 0] as [number, number, number],
      inertia: [s ** 5 / 6, s ** 5 / 6, s ** 5 / 6, 0, 0, 0] as [
        number,
        number,
        number,
        number,
        number,
        number
      ],
      area: 6 * s * s,
      closure: 0
    }
    const objects = mecanumRobot()
    objects.frameB = part('frameB', 'R', [-0.1, 0, 0.05])
    objects.frameC = part('frameC', 'R', [0, 0.1, 0.05])
    // 관절(팔) 몸체의 메시 하나
    objects.arm = pointGroup('arm', 'R', [0.15, 0, 0.2], { joint: defaultJoint('revolute') })
    objects.armPart = part('armPart', 'arm', [0.1, 0, 0])
    const loading = (ids: string[]): MassLookup => {
      const pending = new Set(
        ids.map((id) => (objects[id].visual as { geometryId: string }).geometryId)
      )
      return {
        props: (geometryId) => (pending.has(geometryId) ? undefined : cube),
        sourcePath: () => undefined
      }
    }
    const build = (scene: SceneObjects, lookup: MassLookup): WorldWarning[] =>
      buildWorldSpec(scene, 'R', SETTINGS, computeMassModel(scene, lookup)).warnings.filter(
        (warning) => warning.key.includes('MassPending')
      )
    // 다 읽음: 경고 없음
    expect(build(objects, loading([]))).toEqual([])
    // 섀시 메시 둘이 읽는 중
    const partial = computeMassModel(objects, loading(['frameB', 'frameC']))
    expect(partial.robots.R.warnings).toContainEqual({ kind: 'pending', meshes: 2 })
    expect(build(objects, loading(['frameB', 'frameC']))).toEqual([
      { key: 'worldChassisMassPending', params: { count: 2 } }
    ])
    // 관절 몸체의 메시는 관절이 알리고 섀시 수에 넣지 않는다
    expect(build(objects, loading(['frameB', 'armPart']))).toEqual([
      { key: 'worldJointMassPending', params: { name: 'arm', count: 1 } },
      { key: 'worldChassisMassPending', params: { count: 1 } }
    ])
    expect(build(objects, loading(['armPart']))).toEqual([
      { key: 'worldJointMassPending', params: { name: 'arm', count: 1 } }
    ])
    // 아무 메시도 읽지 못했으면 질량 모델이 외곽 상자(defaultMass)로 대신한 것이라 섀시는 알리지 않는다
    const all = Object.keys(objects).filter((id) => objects[id].visual?.type === 'mesh')
    const none = computeMassModel(objects, loading(all))
    expect(none.robots.R.warnings.map((warning) => warning.kind)).toContain('defaultMass')
    expect(build(objects, loading(all))).toEqual([
      { key: 'worldJointMassPending', params: { name: 'arm', count: 1 } }
    ])
    // 바퀴가 없으면 섀시는 쓰이지 않아 알리지 않는다
    const wheelless: SceneObjects = { ...objects }
    for (const id of ['FL', 'FR', 'BL', 'BR']) wheelless[id] = { ...objects[id], wheel: undefined }
    expect(build(wheelless, loading(['frameB', 'frameC']))).toEqual([])
  })

  it('섀시 관성의 주관성 값은 1e-6 이상(점질량 둘이면 선을 따라 0인 축을 올린다)', () => {
    const objects = pointRobot()
    for (const id of ['plate', 'FL', 'FR']) delete objects[id].mass
    // 섀시는 배터리 5 kg와 뒤왼 바퀴 자리의 1 kg뿐: 두 점을 잇는 선 방향 관성이 0이다
    objects.BL = { ...objects.BL, mass: { mass: 1 } }
    objects.R = { ...objects.R, rigidbody: { weighedMass: 8 } }
    const { spec, warnings } = buildWorldSpec(
      objects,
      'R',
      SETTINGS,
      computeMassModel(objects, NO_GEOMETRY)
    )
    expect(chassisWarnings(warnings)).toEqual([])
    const [xx, yy, zz, xy, xz, yz] = spec!.robot.body.inertia
    // 선 방향 u = (−0.05, 0.15, 0)/|·|: uᵀIu = 하한
    const length = Math.hypot(0.05, 0.15)
    const u = [-0.05 / length, 0.15 / length, 0]
    const along =
      u[0] * u[0] * xx +
      u[1] * u[1] * yy +
      u[2] * u[2] * zz +
      2 * (u[0] * u[1] * xy + u[0] * u[2] * xz + u[1] * u[2] * yz)
    expect(along).toBeCloseTo(MIN_CHASSIS_INERTIA, 12)
    // 나머지는 하한 u uᵀ만큼만 더해진다
    const expected = pointMasses([
      { m: 5, p: [-0.1, 0, 0.05] },
      { m: 1, p: [-0.15, 0.15, 0.05] }
    ])
    const lifted = [
      u[0] * u[0],
      u[1] * u[1],
      u[2] * u[2],
      u[0] * u[1],
      u[0] * u[2],
      u[1] * u[2]
    ].map((v, i) => expected.inertia[i] + MIN_CHASSIS_INERTIA * v)
    spec!.robot.body.inertia.forEach((value, i) => expect(value).toBeCloseTo(lifted[i], 12))
    const wire: unknown = JSON.parse(JSON.stringify(spec))
    expect(parseWorldSpec(wire)).toEqual(wire)
  })

  it('바퀴 접점이 셋보다 적거나 일직선이면 경고한다(바퀴가 없으면 기저가 고정이라 따로 경고하지 않는다)', () => {
    expect(keys(buildWorldSpec(mecanumRobot(), 'R', SETTINGS).warnings)).toEqual([])
    // 바퀴 둘
    const two = mecanumRobot()
    for (const id of ['BL', 'BR']) delete two[id].wheel
    expect(keys(buildWorldSpec(two, 'R', SETTINGS).warnings)).toContain('worldFewWheels')
    // 바퀴 셋(삼각형)은 받친다
    const three = mecanumRobot()
    delete three.BR.wheel
    expect(keys(buildWorldSpec(three, 'R', SETTINGS).warnings)).not.toContain('worldFewWheels')
    // 바퀴가 없으면 worldNoWheels만
    const none = mecanumRobot()
    for (const id of ['FL', 'FR', 'BL', 'BR']) delete none[id].wheel
    expect(keys(buildWorldSpec(none, 'R', SETTINGS).warnings)).toEqual(['worldNoWheels'])
  })

  it('접점 판정: 같은 자리·일직선·1 cm보다 좁은 받침', () => {
    const p = (x: number, y: number): Vec2 => ({ x, y })
    expect(fewWheelContacts([p(0.15, 0.15), p(0.15, -0.15), p(-0.15, 0.15), p(-0.15, -0.15)])).toBe(
      false
    )
    expect(fewWheelContacts([])).toBe(true)
    expect(fewWheelContacts([p(0, 0)])).toBe(true)
    // 같은 자리 넷(한 점)
    expect(fewWheelContacts([p(0.1, 0), p(0.1, 0), p(0.1, 0), p(0.1, 0)])).toBe(true)
    // 가운데 줄의 바퀴 셋
    expect(fewWheelContacts([p(0, 0.2), p(0, 0), p(0, -0.2)])).toBe(true)
    // 거의 일직선(5 mm 폭)은 받치지 못하고, 2 cm 폭은 받친다
    expect(fewWheelContacts([p(0.2, 0), p(-0.2, 0), p(0, 0.005)])).toBe(true)
    expect(fewWheelContacts([p(0.2, 0), p(-0.2, 0), p(0, 0.02)])).toBe(false)
    // 6륜(두 줄)
    const sixWheels = [0.15, 0, -0.15].flatMap((x) => [p(x, 0.2), p(x, -0.2)])
    expect(fewWheelContacts(sixWheels)).toBe(false)
  })

  it('질량 모델은 관절이나 바퀴가 있는 로봇만 계산한다', () => {
    const objects = mecanumRobot()
    expect(robotNeedsMassModel(objects, 'R')).toBe(true)
    const none = mecanumRobot()
    for (const id of ['FL', 'FR', 'BL', 'BR']) delete none[id].wheel
    expect(robotNeedsMassModel(none, 'R')).toBe(false)
    // 로봇 자신에 남은 바퀴 설정은 바퀴가 아니다(canHaveWheel)
    expect(robotNeedsMassModel({ ...none, R: { ...none.R, wheel: wheel() } }, 'R')).toBe(false)
    const withJoint = { ...none, BL: { ...none.BL, joint: defaultJoint('revolute') } }
    expect(robotNeedsMassModel(withJoint, 'R')).toBe(true)
    expect(robotNeedsMassModel(objects, 'nope')).toBe(false)
  })
})

function rounded(point: { x: number; y: number }): { x: number; y: number } {
  const r = (value: number): number => Math.round(value * 1e9) / 1e9 + 0
  return { x: r(point.x), y: r(point.y) }
}

// 5: 충돌 형상 칸(spec-5 §5.5, K8). 계약 커밋에서는 형상 조회를 받아도 넣지 않는다(5 B가 넣는다)
describe('buildWorldSpec 충돌 형상(K8)', () => {
  it('형상 조회가 없으면 세계 설명에 충돌 키가 없고 colliders·ignoredPairs가 빈 목록이다', () => {
    const result = buildWorldSpec(mecanumRobot(), 'R', SETTINGS, null, null, null)
    expect(result.spec).not.toBeNull()
    expect('colliders' in result.spec!.robot).toBe(false)
    expect('collisionIgnore' in result.spec!).toBe(false)
    expect(result.spec!.joints.every((j) => !('colliders' in j))).toBe(true)
    expect(result.colliders).toEqual([])
    expect(result.ignoredPairs).toEqual([])
    // 여섯째 인자를 주지 않은 것과 같다
    expect(buildWorldSpec(mecanumRobot(), 'R', SETTINGS)).toEqual(result)
  })
})
