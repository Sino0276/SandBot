import { describe, expect, it } from 'vitest'
import { parseWorldSpec } from '../../../shared/sim/worldSpec'
import { cadRootTransform } from '../cad/alignment'
import { createComponent } from '../hardware/components'
import type { HardwareComponent, SceneObject, SceneObjects, WheelSettings } from '../scene/model'
import { defaultWheel } from '../scene/wheel'
import {
  buildWorldSpec,
  robotFootprint,
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
    expect(spec!.motors).toEqual([
      { device: 'leftFront', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: -1 },
      { device: 'rightFront', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: 1 },
      { device: 'leftBack', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: -1 },
      // 이름은 사이드카처럼 앞뒤 공백을 뺀다
      { device: 'rightBack', modelTag: 'goBILDA5202SeriesMotor', gearbox: 99.5, directionSign: 1 }
    ])
    const wheels = spec!.wheels.map((w) => ({ ...w, position: rounded(w.position) }))
    expect(wheels).toEqual([
      {
        position: { x: 0.25, y: 0.15 },
        angle: 0,
        kind: 'mecanum',
        rollers: 'flbr',
        radius: 0.052,
        gearRatio: 1,
        motor: 'leftFront'
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
    expect(resolved.map((w) => [w.name, w.rollers, w.rollersAuto, w.rollersAmbiguous])).toEqual([
      // 직접 고른 형은 그대로
      ['FL', 'frbl', false, false],
      // 뒤로 굴리게(180°) 단 바퀴도 롤러 축이 같아 위치로 정한다
      ['FR', 'frbl', true, false],
      ['BL', 'flbr', true, true],
      ['BR', 'flbr', true, false]
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
    const kinds = robotWheels(mixed, 'R').map((w) => [w.name, w.rollers, w.rollersAmbiguous])
    // 메카넘 FR·BL의 중심은 (0.15, 0): FR 앞오른 → frbl, BL 뒤왼 → frbl
    expect(kinds).toEqual([
      ['FL', null, false],
      ['FR', 'frbl', false],
      ['BL', 'frbl', false],
      ['BR', null, false]
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
      directionSign: 1
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

  it('로봇이 아니거나 없으면 null, 메인이 받지 않을 값이면 null과 worldInvalid', () => {
    const objects = mecanumRobot()
    expect(buildWorldSpec(objects, 'FL', SETTINGS)).toEqual({ spec: null, warnings: [] })
    expect(buildWorldSpec(objects, 'nope', SETTINGS)).toEqual({ spec: null, warnings: [] })
    objects.R = { ...objects.R, transform: { position: [50, 0, 0], rotation: [0, 0, 0] } }
    const far = buildWorldSpec(objects, 'R', SETTINGS)
    expect(far.spec).toBeNull()
    expect(far.warnings).toEqual([{ key: 'worldInvalid', params: { detail: 'robot.start' } }])
  })

  it('최고 속도: goBILDA 5203 312 RPM(19.2:1), 104 mm 바퀴', () => {
    const props = motor('m', 0, { gearbox: 19.2 }).props
    // SDK 형식(60 RPM × 99.5)을 19.2:1로 바꾼 무부하 310.94 RPM
    const speed12 = wheelTopSpeed(wheel(), props, 12)
    expect(speed12).toBeCloseTo(((60 * 99.5) / 19.2 / 60) * Math.PI * 0.104, 10)
    expect(speed12).toBeCloseTo(1.6932, 4)
    expect(wheelTopSpeed(wheel(), props, 12.5)).toBeCloseTo((speed12 * 12.5) / 12, 10)
    expect(wheelTopSpeed(wheel({ gearRatio: 2 }), props, 12)).toBeCloseTo(speed12 / 2, 10)
  })
})

function rounded(point: { x: number; y: number }): { x: number; y: number } {
  const r = (value: number): number => Math.round(value * 1e9) / 1e9 + 0
  return { x: r(point.x), y: r(point.y) }
}
