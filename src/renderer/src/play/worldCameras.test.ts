import { describe, expect, it } from 'vitest'
import { Articulation } from '../../../shared/sim/articulation'
import { DEFAULT_CAMERA_MODEL } from '../../../shared/sim/cameraData'
import {
  composeFrames,
  planarFrame,
  sensorAxis,
  sensorPose,
  type Frame3
} from '../../../shared/sim/sensorFrame'
import {
  MAX_WORLD_CAMERAS,
  parseWorldSpec,
  type Vec3 as SimVec3
} from '../../../shared/sim/worldSpec'
import type { ComponentType } from '../hardware/catalog'
import { createComponent } from '../hardware/components'
import { cameraAimRotation, type LocalBoundsLookup } from '../hardware/mounting'
import { defaultJoint, defaultJointDrive } from '../scene/joint'
import type { HardwareComponent, SceneObject, SceneObjects, Vec3 } from '../scene/model'
import { defaultWheel } from '../scene/wheel'
import {
  cameraExclusions,
  cameraMountInRobot,
  runCamerasOf,
  withCameraWarnings,
  type CameraSelfHitCheck
} from './worldCameras'
import { buildWorldSpec, type WorldWarning } from './worldSpec'

// 세계 설명의 웹캠 목록(4d C, spec-4d §4 C 빌더·C2)

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
  const base = createComponent(type, [], () => `k${componentCount++}`)
  return { ...base, name, props: { ...base.props, ...props } }
}

// 시리얼이 있는(구성에 들어가는) 웹캠
const webcam = (name: string, props: Record<string, string | number> = {}): HardwareComponent =>
  component('webcam', name, { serialNumber: 'SN1', ...props })

const ROBOT_HARDWARE: SceneObject['hardware'] = {
  className: 'CameraBot',
  configName: 'Camera Bot',
  expansionHub: { enabled: false, address: 2 }
}

// 상자 형상(반폭 1 cm)
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

const robot = (): SceneObject =>
  object('R', 'robot', null, [1, -0.5, 0], [0, 0, 30 * DEG], { hardware: ROBOT_HARDWARE })

describe('buildWorldSpec 웹캠 목록', () => {
  it('C2: 하이어라키 순서·장치 이름(trim)·렌즈 = 하우징 앞면·회전 (roll, −pitch, yaw)·모델, parse 통과', () => {
    const objects: SceneObjects = {
      R: robot(),
      front: object('front', 'part', 'R', [0.2, 0, 0.3], [0, 0, 0], {
        visual: mesh('box'),
        components: [webcam(' Webcam 1 ', { aimPitch: 0 })]
      }),
      back: object('back', 'part', 'R', [-0.2, 0.05, 0.25], [0, 0, 0], {
        visual: mesh('box'),
        components: [
          webcam('Webcam 2', {
            aimYaw: Math.PI,
            aimPitch: 20 * DEG,
            aimRoll: 10 * DEG,
            cameraModel: 'gobilda3122'
          })
        ]
      }),
      // 모델 속성이 틀리면 기본 C920
      odd: object('odd', 'part', 'R', [0, 0.2, 0.2], [0, 0, 0], {
        visual: mesh('box'),
        components: [webcam('Webcam 3', { cameraModel: 'nope' })]
      })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
    expect(keys(result.warnings)).toEqual(['worldNoWheels'])
    const spec = result.spec!
    expect(spec.cameras.map((c) => [c.device, c.model, c.mount.body])).toEqual([
      ['Webcam 1', 'logitechC920', -1],
      ['Webcam 2', 'gobilda3122', -1],
      ['Webcam 3', DEFAULT_CAMERA_MODEL, -1]
    ])
    // 앞을 보는 웹캠: 피벗 + 0.01 m(상자 반폭)
    close(spec.cameras[0].mount.position, { x: 0.21, y: 0, z: 0.3 })
    expect(spec.cameras[0].mount.rotation).toEqual({ x: 0, y: 0, z: 0 })
    expect(spec.cameras[1].mount.rotation).toEqual(
      cameraAimRotation({ yaw: Math.PI, pitch: 20 * DEG, roll: 10 * DEG })
    )
    // 기본 조준(수평, spec-4e §1.1): 회전 (0, 0, 0)이고 −0이 없다
    const level = spec.cameras[2].mount.rotation
    expect(level).toEqual({ x: 0, y: 0, z: 0 })
    expect(Object.is(level.x, 0) && Object.is(level.y, 0) && Object.is(level.z, 0)).toBe(true)
    expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(spec)))).toBe('object')
    // 실행 상태 run.cameras(세계 설명 cameras 순서)
    expect(runCamerasOf(result)).toEqual(
      result.cameras.map((c) => ({
        objectId: c.objectId,
        componentId: c.componentId,
        body: -1,
        mount: c.mount,
        model: c.model
      }))
    )
    expect(result.cameras.map((c) => c.objectId)).toEqual(['front', 'back', 'odd'])
    expect(result.cameraExclusions.size).toBe(0)
    // 렌즈 위치는 로봇 좌표 장착과 같은 함수(cameraMountInRobot)로 정해진다
    expect(result.cameras[1].inRobot).toEqual(
      cameraMountInRobot(objects, 'back', objects.back.components![0].props, lookup(objects))
    )
  })

  it('C2: 시리얼이 없는 웹캠은 notConfigured + worldCameraNotConfigured, 이름을 차지하지 않는다', () => {
    const objects: SceneObjects = {
      R: robot(),
      a: object('a', 'part', 'R', [0.2, 0, 0.3], [0, 0, 0], {
        visual: mesh('box'),
        components: [component('webcam', 'Webcam 1')]
      }),
      b: object('b', 'part', 'R', [0.2, 0.1, 0.3], [0, 0, 0], {
        visual: mesh('box'),
        components: [webcam('Webcam 1')]
      })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS)
    expect(result.spec!.cameras.map((c) => c.device)).toEqual(['Webcam 1'])
    expect(result.cameras.map((c) => c.objectId)).toEqual(['b'])
    const idA = objects.a.components![0].id
    expect([...result.cameraExclusions]).toEqual([[idA, 'notConfigured']])
    expect(result.warnings).toContainEqual({
      key: 'worldCameraNotConfigured',
      params: { name: 'Webcam 1' }
    })
  })

  it('C2: 모터·거리 센서·허브와 같은 이름, 빈 이름, 같은 이름의 두 웹캠은 빠지고 worldDuplicateCamera', () => {
    const motor = component('motor', 'cam')
    const sensor = component('distanceSensor', 'eye')
    const cams = [
      webcam('cam'),
      webcam('eye'),
      webcam('Control Hub'),
      webcam('  '),
      webcam('front'),
      webcam(' front')
    ]
    const objects: SceneObjects = {
      R: robot(),
      body: object('body', 'part', 'R', [0, 0, 0.1], [0, 0, 0], {
        components: [motor, sensor, ...cams]
      })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS)
    expect(result.spec!.cameras.map((c) => c.device)).toEqual(['front'])
    expect([...result.cameraExclusions]).toEqual([
      [cams[0].id, 'duplicateName'],
      [cams[1].id, 'duplicateName'],
      [cams[2].id, 'duplicateName'],
      [cams[3].id, 'emptyName'],
      [cams[5].id, 'duplicateName']
    ])
    expect(
      result.warnings.filter((w) => w.key === 'worldDuplicateCamera').map((w) => w.params.name)
    ).toEqual(['cam', 'eye', 'Control Hub', '  ', ' front'])
    expect(cameraExclusions(objects, 'R')).toEqual(result.cameraExclusions)
  })

  it(`C2: ${MAX_WORLD_CAMERAS}개까지, 다섯째는 tooMany와 worldTooManyCameras 한 번`, () => {
    const cams = Array.from({ length: MAX_WORLD_CAMERAS + 2 }, (_, i) => webcam(`cam${i}`))
    const objects: SceneObjects = {
      R: robot(),
      body: object('body', 'part', 'R', [0, 0, 0.3], [0, 0, 0], { components: cams })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS)
    expect(result.spec!.cameras).toHaveLength(MAX_WORLD_CAMERAS)
    expect(result.cameraExclusions.get(cams[MAX_WORLD_CAMERAS].id)).toBe('tooMany')
    expect(result.cameraExclusions.get(cams[MAX_WORLD_CAMERAS + 1].id)).toBe('tooMany')
    expect(result.warnings.filter((w) => w.key === 'worldTooManyCameras')).toEqual([
      { key: 'worldTooManyCameras', params: { max: MAX_WORLD_CAMERAS } }
    ])
  })

  it('C2: 관절 하위 웹캠(팬 터렛)은 관절 몸체에 붙고 q = 0 자세가 로봇 좌표 장착과 같다', () => {
    const objects: SceneObjects = {
      R: robot(),
      pan: object('pan', 'group', 'R', [0.1, 0.05, 0.3], [0, 0, 20 * DEG], {
        joint: { ...defaultJoint('revolute'), axis: 'z', anchor: [0.01, -0.02, 0] }
      }),
      cam: object('cam', 'part', 'pan', [0.05, 0, 0.02], [0.1, 0.2, -0.3], {
        visual: mesh('box'),
        components: [webcam('turret', { aimYaw: 45 * DEG, aimPitch: 50 * DEG, aimRoll: 5 * DEG })]
      }),
      fixed: object('fixed', 'part', 'R', [0.2, 0, 0.2], [0, 0, 0], {
        visual: mesh('box'),
        components: [webcam('fixed')]
      })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
    const spec = result.spec!
    expect(spec.cameras.map((c) => [c.device, c.mount.body])).toEqual([
      ['turret', 0],
      ['fixed', -1]
    ])
    expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(spec)))).toBe('object')
    const articulation = new Articulation(spec.joints)
    const start = planarFrame(spec.robot.start)
    for (const camera of result.cameras) {
      const body: Frame3 =
        camera.body >= 0
          ? (() => {
              const pose = articulation.bodyPose(camera.body)
              const [x, y, z] = pose.origin
              return { rotation: pose.rotation, origin: { x, y, z } }
            })()
          : { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: { x: 0, y: 0, z: 0 } }
      const actual = sensorPose(composeFrames(start, body), camera.mount)
      const expected = sensorPose(start, { body: -1, ...camera.inRobot })
      close(actual.origin, expected.origin)
      close(sensorAxis(actual), sensorAxis(expected))
      // 롤까지(영상 위 = 센서 +Z 열)
      for (const i of [2, 5, 8]) expect(actual.rotation[i]).toBeCloseTo(expected.rotation[i], 12)
    }
  })

  it('C2: 로봇 카드 경로(형상 조회 없음)는 피벗을 렌즈로 쓰고 형상 경고를 내지 않는다', () => {
    const objects: SceneObjects = {
      R: robot(),
      cam: object('cam', 'part', 'R', [0.2, 0, 0.3], [0, 0, 0], {
        visual: mesh('box'),
        components: [webcam('cam')]
      })
    }
    const result = buildWorldSpec(objects, 'R', SETTINGS)
    expect(keys(result.warnings)).toEqual(['worldNoWheels'])
    close(result.spec!.cameras[0].mount.position, { x: 0.2, y: 0, z: 0.3 })
    expect(result.cameras[0].inRobot.housing).toBe('pivot')
  })

  it('C2: 퍼즈(고정 시드 300번): 무작위 씬의 빌더 결과가 늘 parseWorldSpec을 통과하고 거르기가 빌더와 같다', () => {
    const POOL = ['a', 'b', ' a ', '', 'Control Hub', 'cam', 'eye']
    const MODELS = ['logitechC920', 'logitechC270', 'gobilda3122', 'bad', '']
    // 결정적 의사 난수(32비트 LCG, Numerical Recipes 상수)
    let seed = 20261109
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const pick = <T>(pool: readonly T[]): T => pool[Math.floor(next() * pool.length)]
    const angle = (range: number): number => (next() * 2 - 1) * range
    for (let round = 0; round < 300; round++) {
      const drive = component('motor', 'drive')
      const panMotor = component('motor', pick(POOL))
      const cams = Array.from({ length: 1 + Math.floor(next() * 6) }, () =>
        component('webcam', pick(POOL), {
          serialNumber: next() < 0.8 ? 'SN' : '',
          cameraModel: pick(MODELS),
          aimYaw: angle(4),
          aimPitch: angle(2),
          aimRoll: angle(4)
        })
      )
      const wheelAt = (id: string, x: number, y: number): SceneObject =>
        object(id, 'part', 'R', [x, y, 0.05], [0, 0, 0], {
          wheel: { ...defaultWheel('traction'), motor: drive.id }
        })
      const objects: SceneObjects = {
        R: object('R', 'robot', null, [angle(1.5), angle(1.5), 0], [0, 0, angle(3)], {
          hardware: ROBOT_HARDWARE
        }),
        body: object('body', 'part', 'R', [0, 0, 0.05], [0, 0, 0], {
          visual: mesh('box'),
          components: [
            drive,
            panMotor,
            component('distanceSensor', pick(POOL)),
            component('imu', pick(POOL)),
            cams[0]
          ]
        }),
        w1: wheelAt('w1', 0.15, 0.15),
        w2: wheelAt('w2', 0.15, -0.15),
        w3: wheelAt('w3', -0.15, 0.15),
        w4: wheelAt('w4', -0.15, -0.15),
        pan: object('pan', 'group', 'R', [0.1, 0, 0.3], [angle(0.5), angle(0.5), angle(3)], {
          joint: {
            ...defaultJoint('revolute'),
            axis: 'z',
            drive: { ...defaultJointDrive('motor'), motors: [panMotor.id] }
          } as SceneObject['joint'],
          components: cams.slice(1, 3)
        }),
        tip: object('tip', 'part', 'pan', [0.05, 0, 0.05], [angle(1), angle(1), angle(1)], {
          visual: mesh('box'),
          components: cams.slice(3)
        })
      }
      const result = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
      expect(result.spec, `round ${round}: ${JSON.stringify(result.warnings)}`).not.toBeNull()
      const spec = result.spec!
      expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(spec)))).toBe('object')
      const names = [...spec.distanceSensors, ...spec.colorSensors, ...spec.cameras].map(
        (s) => s.device
      )
      expect(new Set(names).size).toBe(names.length)
      const inSpec = new Set(result.cameras.map((c) => c.componentId))
      for (const cam of cams) expect(inSpec.has(cam.id)).toBe(!result.cameraExclusions.has(cam.id))
      expect(cameraExclusions(objects, 'R')).toEqual(
        buildWorldSpec(objects, 'R', SETTINGS).cameraExclusions
      )
    }
  })
})

describe('withCameraWarnings', () => {
  it('웹캠마다 onRobot·noHousing → farHousing → selfHit(axis만), 하이어라키 순서', () => {
    const objects: SceneObjects = {
      R: object('R', 'robot', null, [0, 0, 0], [0, 0, 0], {
        hardware: ROBOT_HARDWARE,
        components: [webcam('onRobot')]
      }),
      bare: object('bare', 'part', 'R', [0.1, 0, 0.3], [0, 0, 0], {
        components: [webcam('bare')]
      }),
      // 자기 형상이 없는 그룹: 앞으로 0.1 m 떨어진 하위 상자 → 렌즈 0.11 m(멂)
      big: object('big', 'group', 'R', [-0.1, 0, 0.3], [0, 0, 0], {
        components: [webcam('big', { aimPitch: 0 })]
      }),
      bigPart: object('bigPart', 'part', 'big', [0.1, 0, 0], [0, 0, 0], { visual: mesh('box') }),
      hit: object('hit', 'part', 'R', [0.2, 0.1, 0.3], [0, 0, 0], {
        visual: mesh('box'),
        components: [webcam('hit')]
      }),
      partial: object('partial', 'part', 'R', [0.2, -0.1, 0.3], [0, 0, 0], {
        visual: mesh('box'),
        components: [webcam('partial')]
      })
    }
    const built = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
    const selfHit: CameraSelfHitCheck = (camera) =>
      camera.name === 'hit'
        ? { kind: 'axis', partId: 'bigPart', distance: 0.1 }
        : camera.name === 'partial'
          ? { kind: 'partial' }
          : null
    const result = withCameraWarnings(built, objects, (m) => `${m.toFixed(3)} m`, selfHit)
    expect(result.warnings.slice(built.warnings.length)).toEqual([
      { key: 'worldCameraOnRobot', params: { name: 'onRobot' } },
      { key: 'worldCameraNoHousing', params: { name: 'bare' } },
      { key: 'worldCameraFarHousing', params: { name: 'big', distance: '0.110 m' } },
      { key: 'worldCameraSelfHit', params: { name: 'hit', part: 'bigPart' } }
    ])
    // spec이 없으면 그대로
    const empty = { ...built, spec: null }
    expect(withCameraWarnings(empty, objects, String, selfHit)).toBe(empty)
  })
})
