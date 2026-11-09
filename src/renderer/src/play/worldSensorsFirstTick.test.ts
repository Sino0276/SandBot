import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { PhysicsWorld } from '../../../shared/sim/world'
import { parseWorldSpec, type Vec3 as SimVec3 } from '../../../shared/sim/worldSpec'
import { sensorReadingModel, type SensorReadingModel } from '../editor/hardware/sensorReading'
import type { ComponentType } from '../hardware/catalog'
import { createComponent } from '../hardware/components'
import type { LocalBoundsLookup } from '../hardware/mounting'
import { defaultJoint } from '../scene/joint'
import type { HardwareComponent, SceneObject, SceneObjects, Vec3 } from '../scene/model'
import { buildWorldSpec, runFieldOf, withRunField } from './worldSpec'
import { sensorExclusions, withSensorNoise } from './worldSensors'

// 4c 통합 시험 I3·C9(spec-4c §4): 렌더러 빌더 세계(buildWorldSpec + withRunField + withSensorNoise)를 메인과 같은
// parseWorldSpec(JSON 왕복) → PhysicsWorld에 넣은 첫 틱(t = 0) 입력이 인스펙터 "편집 자세 값"(sensorReadingModel)과 같다.
// 섀시 센서는 정확히, 관절 하위 센서는 1 mm·1 count 안(관절 몸체 틀을 거치는 합성 순서가 달라 ulp 차가 날 수 있다).
// 빠진 센서(이름 겹침)는 세계에 없고 인스펙터는 excluded다.

const DEG = Math.PI / 180
const SETTINGS = { batteryVoltage: 12 }
// 바퀴 없는 로봇이라 시작 겹침 경고(번역)를 내지 않는다
const keyT = ((key: string) => key) as unknown as TFunction

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

// 하우징 형상: 반폭 1 cm 상자(시험 값, 하우징 앞면 = 피벗 ± 0.01 m)
const BOX: { min: SimVec3; max: SimVec3 } = {
  min: { x: -0.01, y: -0.01, z: -0.01 },
  max: { x: 0.01, y: 0.01, z: 0.01 }
}
function lookup(objects: SceneObjects): LocalBoundsLookup {
  return (id) => (objects[id]?.visual?.type === 'mesh' ? BOX : null)
}

// BIOBUZZ 빨강 LOADING ZONE 앞 테이프(y [−1.53886, −1.51346], spec-4c A13) 위에 아래를 보는 컬러 센서가 오도록 둔 로봇.
// 거리 센서는 빨강 벽(−y)·앞(+x)·비스듬히 돌린 것, 리프트(직선 관절 +z) 하위에 아래를 보는 거리 센서와 컬러 센서, 같은 이름의
// 거리 센서 하나(빠짐). 로봇을 요 0이 아닌 자세로 두어 시작 자세 합성을 함께 본다.
function sensorScene(yaw: number): SceneObjects {
  const robotHardware: SceneObject['hardware'] = {
    className: 'SensorBot',
    configName: 'Sensor Bot',
    expansionHub: { enabled: false, address: 2 }
  }
  return {
    R: object('R', 'robot', null, [-0.9, -1.426, 0], [0, 0, yaw], { hardware: robotHardware }),
    floor: object('floor', 'part', 'R', [0, -0.1, 0.03], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('colorSensor', 'floorColor', { aimYaw: -yaw })]
    }),
    wall: object('wall', 'part', 'R', [0, -0.15, 0.14], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('distanceSensor', 'wallDist', { aimYaw: -90 * DEG - yaw })]
    }),
    front: object('front', 'part', 'R', [0.2, 0, 0.12], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('distanceSensor', 'frontDist', { aimPitch: -12 * DEG })]
    }),
    skew: object('skew', 'part', 'R', [-0.1, -0.12, 0.2], [0, 0, 0], {
      visual: mesh('box'),
      components: [
        component('distanceSensor', 'skewDist', { aimYaw: -120 * DEG, aimPitch: -25 * DEG })
      ]
    }),
    dup: object('dup', 'part', 'R', [-0.2, 0, 0.1], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('distanceSensor', 'wallDist')]
    }),
    lift: object('lift', 'group', 'R', [0.1, -0.05, 0.05], [0, 0, 0], {
      joint: { ...defaultJoint('prismatic'), axis: 'z' }
    }),
    liftDown: object('liftDown', 'part', 'lift', [0.05, -0.02, 0.15], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('distanceSensor', 'liftDist', { aimPitch: -90 * DEG })]
    }),
    liftColor: object('liftColor', 'part', 'lift', [0.02, -0.08, 0.0], [0, 0, 0], {
      visual: mesh('box'),
      components: [component('colorSensor', 'liftColor')]
    })
  }
}

type Inputs = Record<string, Record<string, unknown>>

// INIT과 같은 조립(playActions.worldFor의 순서): 빌더 → 센서 잡음 끔 → 실행의 시즌. 메인처럼 JSON 왕복 뒤 parseWorldSpec
function firstTick(objects: SceneObjects): { inputs: Inputs; bodies: Map<string, number> } {
  const doc = { season: 'biobuzz' }
  const built = buildWorldSpec(objects, 'R', SETTINGS, null, lookup(objects))
  const runField = runFieldOf(doc, { red: 'start', blue: 'start' })
  const result = withSensorNoise(withRunField(built, doc, runField, keyT), {
    sensorNoise: false,
    seed: 0
  })
  const parsed = parseWorldSpec(JSON.parse(JSON.stringify(result.spec)))
  if (typeof parsed === 'string') throw new Error(parsed)
  expect(parsed.field.season).toBe('biobuzz')
  const world = new PhysicsWorld(parsed)
  const inputs = world.step(0, {}) as Inputs
  const bodies = new Map(result.sensors.map((s) => [s.name, s.body]))
  return { inputs, bodies }
}

function inspector(objects: SceneObjects, objectId: string): SensorReadingModel {
  const component = objects[objectId].components![0]
  return sensorReadingModel({
    objects,
    objectId,
    component,
    season: 'biobuzz',
    bounds: lookup(objects),
    exclusion: sensorExclusions(objects, 'R').get(component.id) ?? null,
    loading: false
  })!
}

describe('4c 통합 I3·C9: 인스펙터 편집 자세 값 = 렌더러 → 메인 세계의 첫 틱 입력', () => {
  for (const yaw of [0, 17 * DEG]) {
    it(`BIOBUZZ, 로봇 요 ${Math.round(yaw / DEG)}°: 거리·컬러 센서(섀시는 정확히, 리프트 하위는 1 mm·1 count)`, () => {
      const objects = sensorScene(yaw)
      const { inputs, bodies } = firstTick(objects)
      expect(bodies.get('liftDist')).toBe(0)
      expect(bodies.get('liftColor')).toBe(0)
      expect(bodies.get('wallDist')).toBe(-1)

      let measured = 0
      for (const id of ['floor', 'wall', 'front', 'skew', 'liftDown', 'liftColor']) {
        const model = inspector(objects, id)
        const device = objects[id].components![0].name
        const input = inputs[device]
        expect(input, device).toBeDefined()
        const exact = bodies.get(device) === -1
        if (model.kind === 'distance') {
          const sent = input.distance as number | null
          expect(sent === null, device).toBe(model.reading.distance === null)
          if (sent !== null && model.reading.distance !== null) {
            measured++
            if (exact) expect(sent, device).toBe(model.reading.distance)
            else expect(Math.abs(sent - model.reading.distance), device).toBeLessThanOrEqual(0.001)
          }
        } else if (model.kind === 'color') {
          for (const key of ['red', 'green', 'blue', 'proximity'] as const) {
            const sent = input[key] as number
            if (exact) expect(sent, `${device}.${key}`).toBe(model.reading[key])
            else
              expect(Math.abs(sent - model.reading[key]), `${device}.${key}`).toBeLessThanOrEqual(1)
          }
        } else throw new Error(`${device}가 빠졌다`)
      }
      // 의미 있는 값을 본다: 벽·바닥 거리 센서가 수를 내고, 아래를 보는 컬러 센서가 빨강 테이프를 본다
      expect(measured).toBeGreaterThanOrEqual(2)
      expect(inputs.wallDist.distance).not.toBeNull()
      expect(inputs.liftDist.distance).not.toBeNull()
      const floor = inspector(objects, 'floor')
      expect(floor.kind === 'color' && floor.reading.surface?.kind).toBe('tape')
      expect(inputs.floorColor.red as number).toBeGreaterThan(inputs.floorColor.blue as number)

      // 이름이 겹친 거리 센서는 세계에 하나만 있고(앞의 것), 인스펙터는 빠졌다고 보인다
      expect(inspector(objects, 'dup')).toMatchObject({ kind: 'excluded', reason: 'duplicateName' })
    })
  }
})
