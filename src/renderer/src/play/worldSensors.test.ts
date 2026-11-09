import { describe, expect, it } from 'vitest'
import { Articulation } from '../../../shared/sim/articulation'
import {
  composeFrames,
  planarFrame,
  sensorAxis,
  sensorPose,
  type Frame3
} from '../../../shared/sim/sensorFrame'
import {
  MAX_WORLD_SENSORS,
  parseWorldSpec,
  type Vec3 as SimVec3
} from '../../../shared/sim/worldSpec'
import { propertyDefaults, type ComponentType } from '../hardware/catalog'
import { createComponent } from '../hardware/components'
import { sensorMountInRobot, type LocalBoundsLookup } from '../hardware/mounting'
import { parseProject, serializeProject } from '../project/projectFile'
import { defaultJoint, defaultJointDrive } from '../scene/joint'
import type { HardwareComponent, SceneObject, SceneObjects, Vec3 } from '../scene/model'
import { defaultWheel } from '../scene/wheel'
import { buildWorldSpec, type WorldWarning } from './worldSpec'
import {
  sensorExclusions,
  withSensorNoise,
  withSensorWarnings,
  type SensorSelfHitCheck
} from './worldSensors'

// 세계 설명의 거리·컬러 센서(4c B, spec-4c §1.2·§3 B1–B6·B10)

const DEG = Math.PI / 180
const SETTINGS = { batteryVoltage: 12 }
const keys = (warnings: readonly WorldWarning[]): string[] => warnings.map((w) => w.key)

function object(
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  position: Vec3 = [0, 0, 0],
  rotation: Vec3 = [0, 0, 0],
  extra: Partial<SceneObject> = {}
): SceneObject {
  return { id, name: id, kind, parentId, transform: { position, rotation }, ...extra }
}

const mesh = (geometryId: string): SceneObject['visual'] => ({
  type: 'mesh',
  geometryId,
  color: [1, 1, 1]
})

let componentCount = 0
function component(
  type: ComponentType,
  name: string,
  props: Record<string, string | number> = {}
): HardwareComponent {
  const base = createComponent(type, [], () => `c${componentCount++}`)
  return { ...base, name, props: { ...base.props, ...props } }
}

const ROBOT_HARDWARE: SceneObject['hardware'] = {
  className: 'SensorBot',
  configName: 'Sensor Bot',
  expansionHub: { enabled: false, address: 2 }
}

// 로봇은 필드에서 옮기고 돌려 둔다(로봇 좌표·시작 자세를 확인하려고). 센서는 하이어라키에서 거리·컬러가 섞여 있다.
function sensorRobot(): SceneObjects {
  return {
    R: object('R', 'robot', null, [1, -0.5, 0], [0, 0, 30 * DEG], { hardware: ROBOT_HARDWARE }),
    d1: object('d1', 'part', 'R', [0.2, 0.05, 0.1], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('distanceSensor', ' front ', { aimYaw: 0, aimPitch: 0 })]
    }),
    c1: object('c1', 'part', 'R', [0.1, -0.1, 0.03], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('colorSensor', 'floorLeft')]
    }),
    d2: object('d2', 'part', 'R', [-0.2, 0.1, 0.15], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('distanceSensor', 'side', { aimYaw: 90 * DEG, aimPitch: 10 * DEG })]
    }),
    c2: object('c2', 'part', 'R', [0.1, 0.1, 0.03], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('colorSensor', 'floorRight', { aimYaw: 45 * DEG })]
    })
  }
}

const BOXES: Record<string, { min: SimVec3; max: SimVec3 }> = {
  box: { min: { x: -0.01, y: -0.01, z: -0.01 }, max: { x: 0.01, y: 0.01, z: 0.01 } }
}
function lookup(objects: SceneObjects): LocalBoundsLookup {
  return (id) => {
    const visual = objects[id]?.visual
    return visual?.type === 'mesh' ? (BOXES[visual.geometryId] ?? null) : null
  }
}

const close = (a: SimVec3, b: SimVec3, digits = 12): void => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
  expect(a.z).toBeCloseTo(b.z, digits)
}

// 로봇 좌표 피벗(돌지 않은 로봇 하위의 파트는 위치가 곧 로봇 좌표)
const pivot = (objects: SceneObjects, id: string): SimVec3 => {
  const [x, y, z] = objects[id].transform.position
  return { x, y, z }
}

describe('buildWorldSpec 센서 목록', () => {
  it('B1: 하이어라키 순서·장치 이름(trim)·body −1·하우징 앞면·rotation (0, −pitch, yaw), parse 통과', () => {
    const objects = sensorRobot()
    const result = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
    expect(result.warnings).toEqual([{ key: 'worldNoWheels', params: {} }])
    const spec = result.spec!
    expect(spec.distanceSensors.map((s) => s.device)).toEqual(['front', 'side'])
    expect(spec.colorSensors.map((s) => s.device)).toEqual(['floorLeft', 'floorRight'])
    for (const s of [...spec.distanceSensors, ...spec.colorSensors]) expect(s.mount.body).toBe(-1)
    // 앞을 보는 거리 센서: 피벗 + 0.01 m(상자 반폭)
    close(spec.distanceSensors[0].mount.position, { x: 0.21, y: 0.05, z: 0.1 })
    expect(spec.distanceSensors[0].mount.rotation).toEqual({ x: 0, y: 0, z: 0 })
    // 왼쪽(요 90°)을 보며 10° 올려봄
    expect(spec.distanceSensors[1].mount.rotation).toEqual({ x: 0, y: -10 * DEG, z: 90 * DEG })
    // 아래를 보는 컬러 센서(기본 −90°): 피벗 − 0.01 m z
    close(spec.colorSensors[0].mount.position, { x: 0.1, y: -0.1, z: 0.02 })
    expect(spec.colorSensors[0].mount.rotation).toEqual({ x: 0, y: Math.PI / 2, z: 0 })
    expect(spec.colorSensors[1].mount.rotation).toEqual({ x: 0, y: Math.PI / 2, z: 45 * DEG })
    // 메인과 같은 검사를 통과한다(JSON 왕복)
    expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(spec)))).toBe('object')
    // 실행 상태(run.sensors)가 쓰는 목록: 세계 설명 목록 순서(거리 다음 컬러), 오브젝트·컴포넌트 id
    expect(
      result.sensors.map((s) => [s.kind, s.objectId, s.componentId, s.device, s.body])
    ).toEqual([
      ['distance', 'd1', objects.d1.components![0].id, 'front', -1],
      ['distance', 'd2', objects.d2.components![0].id, 'side', -1],
      ['color', 'c1', objects.c1.components![0].id, 'floorLeft', -1],
      ['color', 'c2', objects.c2.components![0].id, 'floorRight', -1]
    ])
    expect(result.sensors.map((s) => s.mount)).toEqual([
      ...spec.distanceSensors.map((s) => s.mount),
      ...spec.colorSensors.map((s) => s.mount)
    ])
    expect(result.sensorExclusions.size).toBe(0)
    // 잡음은 빌더가 끔으로 둔다
    expect(spec.noise).toEqual({ enabled: false, seed: 0 })
  })

  it('B2: 조준 속성이 없거나 범위 밖이면 기본값(거리 (0, 0, 0), 컬러 (0, π/2, 0))', () => {
    const objects = sensorRobot()
    objects.d1 = { ...objects.d1, components: [{ ...objects.d1.components![0], props: {} }] }
    objects.c1 = { ...objects.c1, components: [{ ...objects.c1.components![0], props: {} }] }
    objects.d2 = {
      ...objects.d2,
      components: [{ ...objects.d2.components![0], props: { aimYaw: 7, aimPitch: -3 } }]
    }
    const spec = buildWorldSpec(objects, 'R', SETTINGS).spec!
    expect(spec.distanceSensors.map((s) => s.mount.rotation)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 }
    ])
    expect(spec.colorSensors[0].mount.rotation).toEqual({ x: 0, y: Math.PI / 2, z: 0 })
    // 형상 조회가 없으면 피벗이다
    close(spec.distanceSensors[0].mount.position, pivot(objects, 'd1'))
  })

  it('B3: 하우징 앞면(앞·아래·요 45°·그룹)과 형상 경고', () => {
    const base = sensorRobot()
    const objects: SceneObjects = {
      R: base.R,
      front: object('front', 'part', 'R', [0.1, 0, 0.1], [0, 0, 0], {
        visual: mesh('box'),
        components: [component('distanceSensor', 'front')]
      }),
      down: object('down', 'part', 'R', [0.1, 0.1, 0.1], [0, 0, 0], {
        visual: mesh('box'),
        components: [component('distanceSensor', 'down', { aimPitch: -90 * DEG })]
      }),
      diag: object('diag', 'part', 'R', [0.1, -0.1, 0.1], [0, 0, 0], {
        visual: mesh('box'),
        components: [component('distanceSensor', 'diag', { aimYaw: 45 * DEG })]
      }),
      // 자기 형상이 없는 그룹: 하위 형상들(앞으로 0.05 m 떨어진 상자 → 투영 0.06 m)
      big: object('big', 'group', 'R', [-0.1, 0, 0.1], [0, 0, 0], {
        components: [component('distanceSensor', 'big')]
      }),
      bigPart: object('bigPart', 'part', 'big', [0.05, 0, 0], [0, 0, 0], { visual: mesh('box') }),
      // 0.01 m 투영 그룹(경고 없음)
      small: object('small', 'group', 'R', [-0.1, 0.2, 0.1], [0, 0, 0], {
        components: [component('distanceSensor', 'small')]
      }),
      smallPart: object('smallPart', 'part', 'small', [0, 0, 0], [0, 0, 0], {
        visual: mesh('box')
      }),
      // 형상 없는 파트, 로봇에 붙은 센서, 바닥 아래 컬러 센서
      bare: object('bare', 'part', 'R', [0, -0.2, 0.1], [0, 0, 0], {
        components: [component('colorSensor', 'bare')]
      }),
      under: object('under', 'part', 'R', [0, 0.2, 0.007], [0, 0, 0], {
        visual: mesh('box'),
        components: [component('colorSensor', 'under')]
      })
    }
    objects.R = { ...objects.R, components: [component('colorSensor', 'onRobot')] }
    const bounds = lookup(objects)
    const built = buildWorldSpec(objects, 'R', SETTINGS, null, bounds)
    const byName = new Map(built.sensors.map((s) => [s.name, s]))
    close(byName.get('front')!.mount.position, { x: 0.11, y: 0, z: 0.1 })
    expect(byName.get('front')!.inRobot.pivotOffset).toBeCloseTo(0.01, 15)
    close(byName.get('down')!.mount.position, { x: 0.1, y: 0.1, z: 0.09 })
    // 요 45°: 상자 꼭짓점의 축 투영 최대 0.01·√2
    expect(byName.get('diag')!.inRobot.pivotOffset).toBeCloseTo(0.01 * Math.SQRT2, 15)
    close(byName.get('diag')!.mount.position, { x: 0.11, y: -0.09, z: 0.1 })
    expect(byName.get('big')!.inRobot.pivotOffset).toBeCloseTo(0.06, 15)
    expect(byName.get('small')!.inRobot.pivotOffset).toBeCloseTo(0.01, 15)
    expect(byName.get('bare')!.inRobot.housing).toBe('pivot')
    expect(byName.get('onRobot')!.inRobot.housing).toBe('pivot')
    // 0.007 − 0.01 = −0.003 m(바닥 공차 2 mm보다 아래)
    expect(byName.get('under')!.mount.position.z).toBeCloseTo(-0.003, 15)

    // 빌더는 형상 경고를 내지 않는다(INIT의 worldFor가 withSensorWarnings로 더한다)
    expect(keys(built.warnings)).toEqual(['worldNoWheels'])
    const noHit: SensorSelfHitCheck = () => null
    const warned = withSensorWarnings(built, objects, (m) => `${m.toFixed(3)} m`, noHit)
    // 센서 하이어라키 순서(로봇 자신이 먼저), 센서마다 정해진 순서
    expect(warned.warnings.slice(1)).toEqual([
      { key: 'worldSensorOnRobot', params: { name: 'onRobot' } },
      { key: 'worldSensorFarHousing', params: { name: 'big', distance: '0.060 m' } },
      { key: 'worldSensorNoHousing', params: { name: 'bare' } },
      { key: 'worldSensorBelowFloor', params: { name: 'under' } }
    ])
    // 형상 조회 없음: 모두 피벗, 경고 없음(로봇 카드 경로)
    const noLookup = buildWorldSpec(objects, 'R', SETTINGS)
    expect(noLookup.sensors.every((s) => s.inRobot.housing === 'pivot')).toBe(true)
    expect(keys(noLookup.warnings)).toEqual(['worldNoWheels'])
    // 형상 조회는 있지만 아무 형상도 모름(읽는 중): robot에 붙은 것 말고 모두 worldSensorNoHousing
    const loading = buildWorldSpec(objects, 'R', SETTINGS, null, () => null)
    const loadingWarned = withSensorWarnings(loading, objects, String, noHit)
    expect(keys(loadingWarned.warnings).filter((k) => k === 'worldSensorNoHousing')).toHaveLength(7)
  })

  it('B4: 관절 하위 센서는 관절 몸체에 붙고 q = 0 자세가 로봇 좌표 장착과 같다', () => {
    const base = sensorRobot()
    const lift: SceneObject = object('lift', 'group', 'R', [0.1, 0.05, 0.12], [0, 0, 20 * DEG], {
      joint: { ...defaultJoint('prismatic'), axis: 'z', anchor: [0.01, -0.02, 0] }
    })
    // 리프트 위에서 돌아간 팔(회전 관절)과 그 끝 센서
    const arm: SceneObject = object('arm', 'group', 'lift', [0.05, 0, 0.2], [0.3, -0.2, 0.4], {
      joint: { ...defaultJoint('revolute'), axis: 'y' }
    })
    const objects: SceneObjects = {
      R: base.R,
      lift,
      liftSensor: object('liftSensor', 'part', 'lift', [0.05, 0, 0.02], [0.1, 0.2, -0.3], {
        visual: mesh('box'),
        components: [component('distanceSensor', 'liftDist', { aimYaw: 45 * DEG, aimPitch: -0.3 })]
      }),
      arm,
      tip: object('tip', 'part', 'arm', [0.1, 0, 0], [0, 0, 0], {
        visual: mesh('box'),
        components: [component('colorSensor', 'tipColor')]
      }),
      chassisSensor: object('chassisSensor', 'part', 'R', [0.2, 0, 0.05], [0, 0, 0], {
        visual: mesh('box'),
        components: [component('distanceSensor', 'chassis')]
      })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
    const spec = result.spec!
    expect(result.jointObjectIds).toEqual(['lift', 'arm'])
    expect(spec.distanceSensors.map((s) => [s.device, s.mount.body])).toEqual([
      ['liftDist', 0],
      ['chassis', -1]
    ])
    expect(spec.colorSensors.map((s) => [s.device, s.mount.body])).toEqual([['tipColor', 1]])
    expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(spec)))).toBe('object')

    // 관절 몸체의 q = 0 자세(고정 기저, 로봇 좌표)를 시작 자세와 합성한 틀 위의 장착 = 로봇 좌표 장착을 시작 자세에 둔 것
    const articulation = new Articulation(spec.joints)
    const start = planarFrame(spec.robot.start)
    for (const sensor of result.sensors) {
      const body: Frame3 =
        sensor.body >= 0
          ? (() => {
              const pose = articulation.bodyPose(sensor.body)
              const [x, y, z] = pose.origin
              return { rotation: pose.rotation, origin: { x, y, z } }
            })()
          : { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: { x: 0, y: 0, z: 0 } }
      const actual = sensorPose(composeFrames(start, body), sensor.mount)
      const expected = sensorPose(start, { body: -1, ...sensor.inRobot })
      close(actual.origin, expected.origin)
      close(sensorAxis(actual), sensorAxis(expected))
    }
    // 아래를 보는 컬러 센서(짐벌)도 축이 정확히 −z
    const tip = result.sensors.find((s) => s.name === 'tipColor')!
    close(sensorAxis(sensorPose(start, { body: -1, ...tip.inRobot })), { x: 0, y: 0, z: -1 })
    // 장착 원점은 로봇 좌표 장착(sensorMountInRobot)과 같은 함수로 정해진다
    expect(tip.inRobot).toEqual(
      sensorMountInRobot(objects, 'tip', { yaw: 0, pitch: -Math.PI / 2 }, lookup(objects))
    )
  })

  it('B4: 한도로 뺀 관절의 하위 센서는 가까운 남은 관절 몸체에 붙는다', () => {
    const base = sensorRobot()
    const objects: SceneObjects = { R: base.R }
    // 관절 17개를 사슬로 잇는다(MAX_WORLD_JOINTS 16): 마지막 관절은 빠지고 그 하위 센서는 16번째(순번 15) 몸체
    let parent = 'R'
    for (let i = 0; i < 17; i++) {
      const id = `j${i}`
      objects[id] = object(id, 'group', parent, [0.01, 0, 0.01], [0, 0, 0], {
        joint: defaultJoint('revolute')
      })
      parent = id
    }
    objects.s = object('s', 'part', parent, [0.02, 0, 0], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('distanceSensor', 'deep')]
    })
    const result = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
    expect(result.spec!.joints).toHaveLength(16)
    expect(result.spec!.distanceSensors[0].mount.body).toBe(15)
    expect(keys(result.warnings)).toContain('worldTooManyJoints')
  })
})

describe('센서 이름·한도와 sensorExclusions', () => {
  it('B5: 모터·허브와 같은 이름, 빈 이름, 같은 이름의 두 센서는 뒤의 것이 빠지고 worldDuplicateSensor', () => {
    const objects: SceneObjects = {
      R: object('R', 'robot', null, [0, 0, 0], [0, 0, 0], { hardware: ROBOT_HARDWARE }),
      m: object('m', 'part', 'R', [0, 0, 0.05], [0, 0, 0], {
        components: [component('motor', 'arm')]
      }),
      a: object('a', 'part', 'R', [0.1, 0, 0.1], [0, 0, 0], {
        components: [
          component('distanceSensor', 'arm'),
          component('distanceSensor', ' Control Hub '),
          component('colorSensor', '  '),
          component('distanceSensor', 'same'),
          component('colorSensor', ' same'),
          component('colorSensor', 'ok')
        ]
      })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS)
    const ids = objects.a.components!.map((c) => c.id)
    expect(result.spec!.hubs).toEqual(['Control Hub'])
    expect(result.spec!.distanceSensors.map((s) => s.device)).toEqual(['same'])
    expect(result.spec!.colorSensors.map((s) => s.device)).toEqual(['ok'])
    expect([...result.sensorExclusions]).toEqual([
      [ids[0], 'duplicateName'],
      [ids[1], 'duplicateName'],
      [ids[2], 'emptyName'],
      [ids[4], 'duplicateName']
    ])
    expect(result.warnings.filter((w) => w.key === 'worldDuplicateSensor')).toEqual([
      { key: 'worldDuplicateSensor', params: { name: 'arm' } },
      { key: 'worldDuplicateSensor', params: { name: ' Control Hub ' } },
      { key: 'worldDuplicateSensor', params: { name: '  ' } },
      { key: 'worldDuplicateSensor', params: { name: ' same' } }
    ])
    expect(sensorExclusions(objects, 'R')).toEqual(result.sensorExclusions)
  })

  it('B5: 목록마다 32개까지, 넘으면 worldTooMany*Sensors 한 번', () => {
    const many = (type: 'distanceSensor' | 'colorSensor', prefix: string): HardwareComponent[] =>
      Array.from({ length: MAX_WORLD_SENSORS + 1 }, (_, i) => component(type, `${prefix}${i}`))
    const objects: SceneObjects = {
      R: object('R', 'robot', null, [0, 0, 0], [0, 0, 0], { hardware: ROBOT_HARDWARE }),
      a: object('a', 'part', 'R', [0.1, 0, 0.1], [0, 0, 0], {
        components: [...many('distanceSensor', 'd'), ...many('colorSensor', 'c')]
      })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS)
    expect(result.spec!.distanceSensors).toHaveLength(MAX_WORLD_SENSORS)
    expect(result.spec!.colorSensors).toHaveLength(MAX_WORLD_SENSORS)
    expect(keys(result.warnings)).toEqual([
      'worldNoWheels',
      'worldTooManyDistanceSensors',
      'worldTooManyColorSensors'
    ])
    expect(result.warnings[1].params).toEqual({ max: MAX_WORLD_SENSORS })
    const components = objects.a.components!
    expect([...result.sensorExclusions]).toEqual([
      [components[MAX_WORLD_SENSORS].id, 'tooMany'],
      [components.at(-1)!.id, 'tooMany']
    ])
    expect(sensorExclusions(objects, 'R')).toEqual(result.sensorExclusions)
  })

  it('B5: 이름 퍼즈(고정 시드 200번): 바퀴·관절 로봇의 세계 설명이 늘 만들어지고 거르기가 빌더와 같다', () => {
    const POOL = ['a', 'b', ' a ', '', 'Control Hub']
    // 결정적 의사 난수(32비트 LCG, Numerical Recipes 상수)
    let seed = 20261109
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const pick = (): string => POOL[Math.floor(next() * POOL.length)]
    for (let round = 0; round < 200; round++) {
      const drive = component('motor', 'drive')
      const liftMotor = component('motor', pick())
      const servo = component('servo', pick())
      const cr = component('crServo', pick())
      const touch = component('touchSensor', pick(), { limitJoint: 'lift', limitAt: 'lower' })
      const sensors = [
        component('distanceSensor', pick()),
        component('colorSensor', pick()),
        component('distanceSensor', pick()),
        component('colorSensor', pick())
      ]
      const wheelAt = (id: string, x: number, y: number): SceneObject =>
        object(id, 'part', 'R', [x, y, 0.05], [0, 0, 0], {
          wheel: { ...defaultWheel('traction'), motor: drive.id }
        })
      const objects: SceneObjects = {
        R: object('R', 'robot', null, [0, 0, 0], [0, 0, 0], { hardware: ROBOT_HARDWARE }),
        body: object('body', 'part', 'R', [0, 0, 0.05], [0, 0, 0], {
          components: [
            drive,
            liftMotor,
            component('motor', pick()),
            component('deadWheel', pick(), { measures: 'forward' }),
            component('pinpoint', pick()),
            component('otos', pick()),
            component('imu', pick()),
            servo,
            cr,
            touch,
            sensors[0],
            sensors[1]
          ]
        }),
        w1: wheelAt('w1', 0.15, 0.15),
        w2: wheelAt('w2', 0.15, -0.15),
        w3: wheelAt('w3', -0.15, 0.15),
        w4: wheelAt('w4', -0.15, -0.15),
        lift: object('lift', 'group', 'R', [0, 0, 0.1], [0, 0, 0], {
          joint: {
            ...defaultJoint('prismatic'),
            axis: 'z',
            drive: { ...defaultJointDrive('motor'), motors: [liftMotor.id] }
          } as SceneObject['joint']
        }),
        liftPart: object('liftPart', 'part', 'lift', [0.05, 0, 0.1], [0, 0, 0], {
          components: [sensors[2]]
        }),
        arm: object('arm', 'group', 'R', [0.1, 0, 0.2], [0, 0, 0], {
          joint: {
            ...defaultJoint('revolute'),
            drive: { ...defaultJointDrive('servo'), servo: servo.id }
          } as SceneObject['joint']
        }),
        intake: object('intake', 'group', 'arm', [0.1, 0, 0], [0, 0, 0], {
          joint: {
            ...defaultJoint('revolute'),
            drive: { ...defaultJointDrive('crServo'), servo: cr.id }
          } as SceneObject['joint'],
          components: [sensors[3]]
        })
      }
      const result = buildWorldSpec(objects, 'R', SETTINGS)
      expect(result.spec, `round ${round}: ${JSON.stringify(result.warnings)}`).not.toBeNull()
      const spec = result.spec!
      // 센서 이름은 다른 장치·허브·서로와 겹치지 않는다
      const sensorNames = [...spec.distanceSensors, ...spec.colorSensors].map((s) => s.device)
      expect(new Set(sensorNames).size).toBe(sensorNames.length)
      for (const hub of spec.hubs) expect(sensorNames).not.toContain(hub)
      // 빠진 센서 = 세계 설명에 없는 센서 컴포넌트, 인스펙터 경로의 거르기와 같다
      const inSpec = new Set(result.sensors.map((s) => s.componentId))
      for (const sensor of sensors)
        expect(inSpec.has(sensor.id)).toBe(!result.sensorExclusions.has(sensor.id))
      expect(sensorExclusions(objects, 'R')).toEqual(result.sensorExclusions)
    }
  })

  it('B6: 로봇 카드 경로(형상 조회 없음)는 이름이 정상이면 센서가 있어도 4ab 경고와 같다', () => {
    const objects = sensorRobot()
    const { R, ...rest } = objects
    const withoutSensors: SceneObjects = { R }
    for (const [id, obj] of Object.entries(rest)) withoutSensors[id] = { ...obj, components: [] }
    expect(buildWorldSpec(objects, 'R', SETTINGS).warnings).toEqual(
      buildWorldSpec(withoutSensors, 'R', SETTINGS).warnings
    )
  })

  it('sensorExclusions: 로봇이 아니면 빈 Map, 문서마다 캐시하되 바꿀 수 있는 사본을 준다', () => {
    const objects = sensorRobot()
    expect(sensorExclusions(objects, 'd1').size).toBe(0)
    const first = sensorExclusions(objects, 'R')
    first.set('x', 'tooMany')
    expect(sensorExclusions(objects, 'R').size).toBe(0)
  })
})

describe('withSensorNoise', () => {
  it('B7: 실행 설정의 sensorNoise·seed를 세계 설명 noise에 넣는다(spec이 없으면 그대로)', () => {
    const built = buildWorldSpec(sensorRobot(), 'R', SETTINGS)
    expect(withSensorNoise(built, { sensorNoise: true, seed: -42 }).spec!.noise).toEqual({
      enabled: true,
      seed: -42
    })
    expect(withSensorNoise(built, { sensorNoise: false, seed: 7 }).spec!.noise).toEqual({
      enabled: false,
      seed: 7
    })
    expect(built.spec!.noise).toEqual({ enabled: false, seed: 0 })
    const none = buildWorldSpec(sensorRobot(), 'nope', SETTINGS)
    expect(withSensorNoise(none, { sensorNoise: true, seed: 1 })).toBe(none)
  })
})

describe('withSensorWarnings 자기 가림', () => {
  it('B11: axis면 worldSensorSelfHit { name, part }, partial·null이면 없음', () => {
    const objects: SceneObjects = {
      ...sensorRobot(),
      bumper: object('bumper', 'part', 'R', [0.3, 0, 0.1], [0, 0, 0], { visual: mesh('box') })
    }
    objects.bumper = { ...objects.bumper, name: 'Front Bumper' }
    const built = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
    const reaches: number[] = []
    const check: SensorSelfHitCheck = (sensor, reach) => {
      reaches.push(reach)
      if (sensor.name === ' front ') return { kind: 'axis', partId: 'bumper', distance: 0.08 }
      if (sensor.name === 'side') return { kind: 'partial' }
      return null
    }
    const warned = withSensorWarnings(built, objects, String, check)
    expect(warned.warnings.filter((w) => w.key === 'worldSensorSelfHit')).toEqual([
      { key: 'worldSensorSelfHit', params: { name: ' front ', part: 'Front Bumper' } }
    ])
    // reach는 편집 자세 값의 거리이고, 없으면 거리 센서 1.2 m·컬러 센서 6 in(센서 하이어라키 순서)
    expect(reaches).toHaveLength(4)
    for (const reach of reaches) expect(reach).toBeGreaterThan(0)
  })
})

describe('B10: 프로젝트 파일의 조준 속성', () => {
  it('없으면 기본값, 범위 밖이면 기본값, 있으면 그대로 왕복', () => {
    const objects = sensorRobot()
    const content = JSON.parse(serializeProject(objects, { season: 'none' }, (p) => p))
    const props = (id: string): Record<string, unknown> =>
      content.objects.find((o: { id: string }) => o.id === id).components[0].props
    delete props('c1').aimYaw
    delete props('c1').aimPitch
    props('d1').aimYaw = 9
    props('d1').aimPitch = 'up'
    const loaded = parseProject(JSON.stringify(content)).objects
    expect(loaded.c1.components![0].props).toMatchObject({ aimYaw: 0, aimPitch: -Math.PI / 2 })
    expect(loaded.d1.components![0].props).toMatchObject({ aimYaw: 0, aimPitch: 0 })
    expect(loaded.d2.components![0].props).toMatchObject({ aimYaw: 90 * DEG, aimPitch: 10 * DEG })
    expect(loaded.c2.components![0].props).toEqual(objects.c2.components![0].props)
    // 기본 조준 속성 목록(파일에 없던 키도 채운다)
    expect(Object.keys(loaded.c1.components![0].props).sort()).toEqual(
      Object.keys(propertyDefaults('colorSensor')).sort()
    )
  })
})
