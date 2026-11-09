import { describe, expect, it } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { Articulation } from './articulation'
import { readColorSensor, COLOR_BACKGROUND_READING } from './colorSensor'
import {
  HALF,
  HUB_SIGN,
  mecanum,
  outputs,
  Runner,
  robotSpec,
  TAG,
  TICK,
  ZERO
} from './driveTestkit'
import { FieldRaycaster, raycasterFor } from './fieldRaycast'
import { FieldSensors, type SensorModels } from './fieldSensors'
import { readRangeSensor } from './rangeSensor'
import { snapRobotToStart } from './seasons/startPose'
import { resolveSeason } from './seasons/seasons'
import {
  composeFrames,
  planarFrame,
  sensorAxis,
  sensorPose,
  type Frame3,
  type SensorPose
} from './sensorFrame'
import { DEG, testChassis, testMotorParams } from './testkit'
import { PhysicsWorld } from './world'
import type {
  Pose2,
  SensorMount,
  SimColorSensorSpec,
  SimDistanceSensorSpec,
  SimJointSpec,
  SimMotorSpec,
  Vec3,
  WorldSpec
} from './worldSpec'

// 세계의 거리·컬러 센서 입력(4c, spec-4c §1.7 시험 A15–A18·A20–A24, 세계 쪽 A19). 'none' 시즌 기준 로봇은 driveTestkit
// robotSpec(메카넘 18 in)이다.

const NONE = resolveSeason('none')
const BIOBUZZ = resolveSeason('biobuzz')
const IH = NONE.perimeter.innerHalf
const INSET = NONE.perimeter.panelInset

type Outputs = Record<string, DeviceValues>

// 조준(요·올려본각)의 장착 회전(ZYX): (0, −pitch, yaw)
const mount = (body: number, position: Vec3, yaw = 0, pitch = 0): SensorMount => ({
  body,
  position,
  rotation: { x: 0, y: -pitch, z: yaw }
})
const distance = (device: string, m: SensorMount): SimDistanceSensorSpec => ({ device, mount: m })
const color = (device: string, m: SensorMount): SimColorSensorSpec => ({ device, mount: m })

// 리프트(직선 +z, 0–0.3 m, 1.5 kg, 원점 로봇 z 0.1)와 그 위 회전 팔(로봇 y축, 0.35 m)
const LIFT_PARAMS = testMotorParams(TAG, 19.2)
const liftMotor = (device: string): SimMotorSpec => ({
  device,
  modelTag: TAG,
  gearbox: 19.2,
  directionSign: 1,
  params: LIFT_PARAMS
})
function liftJoint(): SimJointSpec {
  return {
    parent: -1,
    type: 'prismatic',
    origin: { position: { x: 0, y: 0, z: 0.1 }, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: { lower: 0, upper: 0.3 },
    body: { mass: 1.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
    friction: { coulomb: 1, viscous: 0 },
    spring: null,
    drive: {
      kind: 'motor',
      devices: ['lift'],
      ratio: 0.112 / (2 * Math.PI),
      params: LIFT_PARAMS,
      rigging: { kind: 'direct' }
    },
    switches: []
  }
}
function armJoint(): SimJointSpec {
  return {
    parent: 0,
    type: 'revolute',
    origin: { position: { x: 0.05, y: 0, z: 0.2 }, rotation: { x: 0, y: 0, z: 0.4 } },
    axis: { x: 0, y: 1, z: 0 },
    limits: { lower: -1.5, upper: 1.5 },
    body: {
      mass: 0.6,
      centerOfMass: { x: 0.2, y: 0, z: 0 },
      inertia: [1e-4, 4e-3, 4e-3, 0, 0, 0]
    },
    friction: { coulomb: 0.02, viscous: 0.001 },
    spring: null,
    drive: {
      kind: 'motor',
      devices: ['arm'],
      ratio: -1 / 3,
      params: LIFT_PARAMS,
      rigging: { kind: 'direct' }
    },
    switches: []
  }
}
const liftOut = (power: number, change: DeviceValues = {}): DeviceValues => ({
  mode: 'RUN_WITHOUT_ENCODER',
  power: power * HUB_SIGN,
  velocity: null,
  enabled: true,
  zeroPower: 'BRAKE',
  targetPosition: null,
  encoderOffset: 0,
  ...change
})

// 센서 모델을 감싸 부를 때마다 자세를 남긴다(값은 진짜 모델)
function recording(): { models: SensorModels; range: SensorPose[]; color: SensorPose[] } {
  const range: SensorPose[] = []
  const colorPoses: SensorPose[] = []
  return {
    range,
    color: colorPoses,
    models: {
      range: (caster, pose, noise) => {
        range.push(pose)
        return readRangeSensor(caster, pose, noise)
      },
      color: (caster, pose) => {
        colorPoses.push(pose)
        return readColorSensor(caster, pose)
      }
    }
  }
}

// 바퀴 없는 로봇(고정 기저)에 관절과 센서
function fixedBase(start: Pose2, change: Partial<WorldSpec>): WorldSpec {
  return robotSpec(
    { start },
    { wheels: [], motors: [liftMotor('lift'), liftMotor('arm')], ...change }
  )
}

function expectVec(actual: Vec3, expected: Vec3, digits = 12): void {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}

// 벽 접근 시나리오: 'none' +X 벽을 향해 앞 거리 센서(h)와 아래 컬러 센서를 단 메카넘 로봇이 power로 다가가 벽을 민 뒤
// back이면 물러난다
function wallApproach(h: number, power = 0.3): { spec: WorldSpec; out: (k: number) => Outputs } {
  const spec = robotSpec(
    { start: { x: IH + INSET - HALF - 1.35, y: 0, yaw: 0 } },
    {
      distanceSensors: [distance('front', mount(-1, { x: HALF, y: 0, z: h }))],
      colorSensors: [color('floor', mount(-1, { x: HALF - 0.02, y: 0.1, z: 0.015 }, 0, -90 * DEG))]
    }
  )
  return { spec, out: () => outputs(mecanum(power, 0, 0)) }
}

describe('세계의 거리·컬러 센서', () => {
  it('A22 bodyPoses = bodyPose(i)를 Frame3로(부유·고정 기저)', () => {
    const joints = [liftJoint(), armJoint()]
    for (const base of [{ body: testChassis(), start: { x: 0.3, y: -0.2, yaw: 0.7 } }, undefined]) {
      const art = new Articulation(joints, base ? { base } : {})
      art.z.forEach((_, i) => (art.z[i] = 0.1 * (i + 1) * (i % 2 === 0 ? 1 : -1)))
      const poses = art.bodyPoses()
      expect(poses).toHaveLength(2)
      poses.forEach((pose, i) => {
        const old = art.bodyPose(i)
        expect(pose).toEqual({
          rotation: old.rotation,
          origin: { x: old.origin[0], y: old.origin[1], z: old.origin[2] }
        })
      })
    }
  })

  it('A15 입력: 첫 틱에 distance null, 같은 null은 다시 보내지 않고 null↔수 전환은 보낸다, 컬러는 정수', () => {
    const { spec } = wallApproach(0.14)
    const world = new PhysicsWorld(spec)
    const ticks: Outputs[] = []
    for (let k = 0; k < 800; k++) {
      const power = k < 300 ? 0.3 : -0.6
      ticks.push(world.step(k * TICK, outputs(mecanum(power, 0, 0))))
    }
    expect(ticks[0].front).toEqual({ distance: null })
    expect(Object.keys(ticks[0].floor)).toEqual(['red', 'green', 'blue', 'proximity'])
    const sent = ticks.map((t) => (t.front && 'distance' in t.front ? t.front.distance : undefined))
    // 뒤따르는 같은 null은 보내지 않는다
    expect(sent[1]).toBeUndefined()
    const changes = sent.filter((v) => v !== undefined)
    const firstNumber = changes.findIndex((v) => typeof v === 'number')
    expect(firstNumber).toBeGreaterThan(0)
    // 물러나면 다시 null을 보낸다
    expect(changes.slice(firstNumber).includes(null)).toBe(true)
    for (const t of ticks)
      for (const key of ['red', 'green', 'blue', 'proximity'])
        if (t.floor && key in t.floor) expect(Number.isInteger(t.floor[key])).toBe(true)
  })

  it('A15 센서가 없으면 다른 장치 입력이 바이트 그대로', () => {
    const run = (withSensors: boolean): string => {
      const { spec } = wallApproach(0.14)
      const s = withSensors ? spec : { ...spec, distanceSensors: [], colorSensors: [] }
      const r = new Runner(s).run(1, () => outputs(mecanum(0.4, 0.1, 0.05)))
      return JSON.stringify(
        r.inputs.map((input) => {
          const copy = { ...input }
          delete copy.front
          delete copy.floor
          return copy
        })
      )
    }
    expect(run(true)).toBe(run(false))
  })

  it('A17 벽으로 다가가며: 단조 비증가, D_p와 1 mm(≤ 0.8 m)·7 mm(≤ 1.19 m), 민 뒤에도 0.01 m 이하', () => {
    for (const h of [0.1, 0.14, 0.2]) {
      const { spec, out } = wallApproach(h)
      const r = new Runner(spec)
      let previous = Infinity
      let numbers = 0
      let touched = -1
      while (r.k < 2000 && (touched < 0 || r.k <= touched + 200)) {
        r.run(TICK / 1e9, out)
        const value = r.value('front', 'distance') as number | null
        const pose = r.pose()
        if (touched < 0 && pose.blocked) touched = r.k
        if (touched >= 0) {
          // 벽에 닿은 뒤 1 s(200틱) 더 밀어도 null이 아닌 수이고 0.01 m 이하
          expect(typeof value).toBe('number')
          expect(value as number).toBeLessThanOrEqual(0.01)
        }
        if (value === null) {
          expect(numbers).toBe(0)
          continue
        }
        numbers++
        expect(value).toBeLessThanOrEqual(previous)
        previous = value
        // 판 안쪽 면 − 센서 앞면 수평 거리(요 0으로 곧게 간다)
        const Dp = IH + INSET - (pose.x + HALF * Math.cos(pose.yaw))
        // 기준은 반올림 전 값의 1 mm·7 mm이고 보낸 값은 1 mm로 반올림했다(+0.5 mm)
        if (Dp <= 0.8) expect(Math.abs(value - Dp)).toBeLessThanOrEqual(0.0015)
        else if (Dp <= 1.19) expect(Math.abs(value - Dp)).toBeLessThanOrEqual(0.0075)
      }
      expect(touched).toBeGreaterThan(0)
      expect(numbers).toBeGreaterThan(100)
    }
  })

  it('A16 리프트 하위 센서: distance = 편집 높이 + q, 팔 끝 센서는 팔 각 방향', () => {
    const rec = recording()
    const spec = fixedBase(
      { x: 0, y: 0, yaw: 0 },
      {
        joints: [liftJoint(), armJoint()],
        // 리프트 몸체(관절 틀 원점 로봇 z 0.1)의 아래를 보는 거리 센서, 팔 끝(관절 틀 x 0.35)의 팔을 따라 보는 컬러 센서
        distanceSensors: [distance('liftDown', mount(0, { x: 0.3, y: 0, z: 0 }, 0, -90 * DEG))],
        colorSensors: [color('armTip', mount(1, { x: 0.35, y: 0, z: 0 }))]
      }
    )
    const world = new PhysicsWorld(spec, { sensorModels: rec.models })
    let seen = 0
    let distanceNow: number | null = null
    for (let k = 0; k < 400; k++) {
      const input = world.step(k * TICK, {
        lift: k < 150 ? liftOut(1) : liftOut(0.8, { mode: 'RUN_TO_POSITION', targetPosition: 300 }),
        arm: liftOut(k < 200 ? 0.5 : -0.5)
      })
      if (input.liftDown && 'distance' in input.liftDown)
        distanceNow = input.liftDown.distance as number | null
      const q = world.pose().joints as number[]
      expect(distanceNow).not.toBeNull()
      expect(Math.abs((distanceNow as number) - (0.1 + q[0]))).toBeLessThanOrEqual(0.0005 + 1e-9)
      // 팔 몸체 회전 = Rz(0.4)·Ry(q1): 축 = (cos 0.4·cos q1, sin 0.4·cos q1, −sin q1)
      const axis = sensorAxis(rec.color[rec.color.length - 1])
      expectVec(axis, {
        x: Math.cos(0.4) * Math.cos(q[1]),
        y: Math.sin(0.4) * Math.cos(q[1]),
        z: -Math.sin(q[1])
      })
      if (q[0] > 0.05 && Math.abs(q[1]) > 0.2) seen++
    }
    expect(seen).toBeGreaterThan(10)
  })

  it('A18 고정 기저: 관절 몸체 틀을 시작 자세와 합성한다(로봇을 옮겨 시작하면 값이 바뀜)', () => {
    const run = (start: Pose2): { pose: SensorPose } => {
      const rec = recording()
      const spec = fixedBase(start, {
        joints: [liftJoint()],
        colorSensors: [color('c', mount(0, { x: 0.2, y: 0.1, z: -0.085 }, 0.3, -90 * DEG))]
      })
      const world = new PhysicsWorld(spec, { sensorModels: rec.models })
      world.step(0, { lift: liftOut(0) })
      return { pose: rec.color[0] }
    }
    // 빨강 LOADING ZONE 앞 테이프 위와 타일 위
    const onTape: Pose2 = {
      x: -0.9 - 0.2 * Math.cos(0.5) + 0.1 * Math.sin(0.5),
      y: -1.526 - 0.2 * Math.sin(0.5) - 0.1 * Math.cos(0.5),
      yaw: 0.5
    }
    const art = new Articulation([liftJoint()])
    const expected = sensorPose(
      composeFrames(planarFrame(onTape), art.bodyPoses()[0]),
      mount(0, { x: 0.2, y: 0.1, z: -0.085 }, 0.3, -90 * DEG)
    )
    const a = run(onTape)
    expectVec(a.pose.origin, expected.origin)
    a.pose.rotation.forEach((v, i) => expect(v).toBeCloseTo(expected.rotation[i], 12))
    expect(a.pose.origin.x).toBeCloseTo(-0.9, 12)
    expect(a.pose.origin.y).toBeCloseTo(-1.526, 12)
    expect(a.pose.origin.z).toBeCloseTo(0.015, 12)
    expect(run({ x: 0.3, y: 0.3, yaw: 0 }).pose.origin.x).toBeCloseTo(0.5, 12)
    // 'none'은 테이프가 없으니 BIOBUZZ에서: 테이프 위(빨강)와 타일 위
    const biobuzz = (start: Pose2): number => {
      const spec = fixedBase(start, {
        field: { season: 'biobuzz', hiveTipped: [false, false] },
        joints: [liftJoint()],
        colorSensors: [color('c', mount(0, { x: 0.2, y: 0.1, z: -0.085 }, 0.3, -90 * DEG))]
      })
      return new PhysicsWorld(spec).step(0, { lift: liftOut(0) }).c.red as number
    }
    expect(biobuzz(onTape)).toBe(696)
    expect(biobuzz({ x: 0.3, y: 0.3, yaw: 0 })).toBe(309)
  })

  it('A19 잡음: 끔이면 부르지 않음, 같은 시드는 같고 다른 시드는 다름, 음수 시드', () => {
    const run = (noise: WorldSpec['noise']): string => {
      const { spec, out } = wallApproach(0.14)
      return JSON.stringify(new Runner({ ...spec, noise }).run(3, out).inputs)
    }
    const off = run({ enabled: false, seed: 7 })
    expect(off).toBe(run({ enabled: false, seed: 99 }))
    const on = run({ enabled: true, seed: 7 })
    expect(on).toBe(run({ enabled: true, seed: 7 }))
    expect(on).not.toBe(off)
    expect(on).not.toBe(run({ enabled: true, seed: 8 }))
    expect(run({ enabled: true, seed: -42 })).not.toBe(on)
    // 꺼져 있으면 모델이 잡음 인자를 받지 않는다
    const seen: unknown[] = []
    const { spec } = wallApproach(0.14)
    const world = new PhysicsWorld(spec, {
      sensorModels: {
        range: (caster, pose, noise) => {
          seen.push(noise)
          return readRangeSensor(caster, pose, noise)
        },
        color: readColorSensor
      }
    })
    world.step(0, outputs({}))
    world.step(TICK, outputs({}))
    expect(seen).toEqual([undefined, undefined])
  })

  it('A20 결정성: 같은 프로세스에서 두 번 바이트가 같다', () => {
    const run = (): string => {
      const { spec, out } = wallApproach(0.1)
      return JSON.stringify(
        new Runner({ ...spec, noise: { enabled: true, seed: 3 } }).run(2, out).inputs
      )
    }
    expect(run()).toBe(run())
  })

  it('A24 비유한 값 방어: null·배경 값과 worldError 한 번', () => {
    const { spec } = wallApproach(0.14)
    const world = new PhysicsWorld(spec, {
      sensorModels: {
        range: (caster, pose) => ({ ...readRangeSensor(caster, pose), distance: Number.NaN }),
        color: (caster, pose) => ({ ...readColorSensor(caster, pose), red: Infinity })
      }
    })
    const first = world.step(0, outputs({}))
    expect(first.front).toEqual({ distance: null })
    expect(first.floor).toEqual({ red: 79, green: 85, blue: 55, proximity: 27 })
    world.step(TICK, outputs({}))
    const notices = world.drainNotices()
    expect(notices).toEqual([
      { code: 'worldError', params: { detail: 'sensor front' } },
      { code: 'worldError', params: { detail: 'sensor floor' } }
    ])
  })

  it('A24 put된 모든 수가 유한하다(BIOBUZZ 무작위 자세 2000개, 고정 시드)', () => {
    // 선형 합동 난수(Numerical Recipes 상수), 시험 전용
    let state = 12345
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
    const ih = BIOBUZZ.perimeter.innerHalf
    for (let i = 0; i < 2000; i++) {
      const sensors = new FieldSensors(
        BIOBUZZ,
        [
          distance(
            'd',
            mount(
              -1,
              { x: 0, y: 0, z: next() * 0.4 - 0.004 },
              next() * 2 * Math.PI,
              (next() - 0.5) * Math.PI
            )
          )
        ],
        [
          color(
            'c',
            mount(
              -1,
              { x: 0, y: 0, z: next() * 0.4 - 0.004 },
              next() * 2 * Math.PI,
              (next() - 0.5) * Math.PI
            )
          )
        ],
        { enabled: i % 2 === 0, seed: i - 1000 }
      )
      const frame = planarFrame({
        x: (next() * 2 - 1) * (ih + 0.003),
        y: (next() * 2 - 1) * (ih + 0.003),
        yaw: next() * 6
      })
      const values: (number | null)[] = []
      let notes = 0
      sensors.read(
        () => frame,
        i * TICK,
        (_d, _k, v) => values.push(v),
        () => notes++
      )
      expect(notes).toBe(0)
      for (const v of values) if (v !== null) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('A21 성능: BIOBUZZ 벽 모서리·FLOWER 옆, 거리 2(하나는 관절) + 컬러 2', () => {
    const preset = BIOBUZZ.startPresets.find((p) => p.key === 'redWallCenter')
    if (!preset) throw new Error('redWallCenter')
    const snap = snapRobotToStart(
      robotSpec().robot.footprint,
      preset,
      BIOBUZZ.perimeter.innerHalf,
      preset.along[1]
    )
    if (!snap.ok) throw new Error('tooWide')
    const sensors = new FieldSensors(
      BIOBUZZ,
      [
        distance('d0', mount(-1, { x: -HALF, y: 0, z: 0.14 }, Math.PI)),
        distance('d1', mount(0, { x: -0.15, y: -HALF, z: -0.1 }, -Math.PI / 2))
      ],
      [
        color('c0', mount(-1, { x: HALF - 0.02, y: 0.1, z: 0.015 }, 0, -90 * DEG)),
        color('c1', mount(-1, { x: 0, y: HALF, z: 0.1 }, Math.PI / 2))
      ],
      { enabled: false, seed: 0 }
    )
    const chassis = planarFrame(snap.pose)
    const lift: Frame3 = composeFrames(chassis, {
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      origin: { x: 0, y: 0, z: 0.25 }
    })
    const frames = (body: number): Frame3 => (body < 0 ? chassis : lift)
    const values: (number | null)[] = []
    const put = (_d: string, _k: string, v: number | null): void => {
      values.push(v)
    }
    const times: number[] = []
    for (let i = 0; i < 1050; i++) {
      values.length = 0
      const t0 = performance.now()
      sensors.read(frames, i * TICK, put)
      const dt = performance.now() - t0
      if (i >= 50) times.push(dt)
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]
    console.log(
      `4c 센서 읽기(거리 2 + 컬러 2, BIOBUZZ 모서리): 중앙값 ${median.toFixed(4)} ms, 최대 ${times[times.length - 1].toFixed(4)} ms`
    )
    expect(median).toBeLessThan(5)
    // 시험이 실제로 무언가를 본다: 뒤를 보는 거리 센서가 빨강 벽(판), 관절 거리 센서가 FLOWER를 본다
    expect(values[0]).not.toBeNull()
    expect(values[1]).not.toBeNull()
    expect(raycasterFor(BIOBUZZ)).toBeInstanceOf(FieldRaycaster)
  })

  it('컬러 배경 값은 세계 방어 값과 같다', () => {
    expect(COLOR_BACKGROUND_READING).toMatchObject({ red: 79, green: 85, blue: 55, proximity: 27 })
  })
})
