import { describe, expect, it, vi } from 'vitest'
import { isTagsInput, type DeviceValues } from '../sidecarProtocol'
import { Articulation } from './articulation'
import { HALF, HUB_SIGN, mecanum, outputs, robotSpec, TAG, TICK, ZERO } from './driveTestkit'
import { FieldCameras, type CameraPut } from './fieldCameras'
import { resolveSeason } from './seasons/seasons'
import { planarFrame, type Frame3 } from './sensorFrame'
import { testMotorParams } from './testkit'
import { FieldVision, tagsInput } from './vision'
import { PhysicsWorld } from './world'
import type {
  Pose2,
  SensorMount,
  SimCameraSpec,
  SimJointSpec,
  SimMotorSpec,
  WorldSpec
} from './worldSpec'

// 세계의 웹캠 입력(4d, spec-4d §1.7·§1.8, 시험 A10–A13). 기준 장면은 spec-4d §4 시험 장면 기준표: 빨강 관중석 벽 프리셋
// (요 π)의 18 in 로봇 앞면 웹캠(높이 0.30 m, 위 30°)이 RED AUDIENCE 34–37과 RED SCORING 30·31을 본다(32·33은 다리).

const BIOBUZZ = resolveSeason('biobuzz')
const MS = 1_000_000
type Outputs = Record<string, DeviceValues>

// 빨강 관중석 벽 프리셋: 18 in 로봇 앞면이 벽 안쪽 면(1.79286)에 닿고 요 π(−X를 봄)
const AUDIENCE_START: Pose2 = { x: BIOBUZZ.perimeter.innerHalf - HALF, y: -0.32385, yaw: Math.PI }

// 장착(로봇 좌표 또는 관절 틀): 위치와 조준(요, 올려본각, 롤) → ZYX (roll, −pitch, yaw)
const mount = (
  body: number,
  x: number,
  y: number,
  z: number,
  pitch: number,
  yaw = 0
): SensorMount => ({
  body,
  position: { x, y, z },
  rotation: { x: 0, y: -pitch, z: yaw }
})
const UP30 = Math.PI / 6
const UP50 = (50 * Math.PI) / 180
const FRONT_CAMERA: SimCameraSpec = {
  device: 'Webcam 1',
  mount: mount(-1, HALF, 0, 0.3, UP30),
  model: 'logitechC920'
}

// 사이드카 웹캠 출력(스트리밍, 640×480, AprilTag 36h11, d 3)
const camOut = (change: DeviceValues = {}): DeviceValues => ({
  serialNumber: 'X',
  state: 'STREAMING',
  streaming: true,
  width: 640,
  height: 480,
  aprilTag: true,
  family: 'TAG_36h11',
  decimation: 3,
  ...change
})

// 바퀴 로봇(메카넘 18 in) 정지 출력 + 웹캠 출력
const still = (cams: Outputs): Outputs => outputs(mecanum(0, 0, 0), {}, cams)

const tagIds = (tags: unknown): number[] => (tags as number[]).filter((_, i) => i % 9 === 0)

describe('FieldCameras 잡음 (A10)', () => {
  const vision = new FieldVision(BIOBUZZ, [false, false])
  const pose = {
    origin: { x: 1.336, y: -0.32385, z: 0.3 },
    rotation: [-Math.cos(UP30), 0, Math.sin(UP30), 0, -1, 0, Math.sin(UP30), 0, Math.cos(UP30)]
  }
  // 위 rotation = Rz(π)·Ry(−30°)(시험의 독립 계산, ZYX)
  const observed = vision.observe(pose, 'logitechC920', 640, 480, 3)

  it('끔: 꼭짓점 + 0.5 그대로(잡음 경로 없음, 바이트 그대로)', () => {
    const off = tagsInput(observed, 'Webcam 1', 35 * MS, { enabled: false, seed: 9 })
    const visible = observed.filter((o) => o.visible)
    expect(tagIds(off)).toEqual([30, 31, 34, 35, 36, 37])
    visible.forEach((o, t) => {
      for (let i = 0; i < 8; i++) expect(off[t * 9 + 1 + i]).toBe(o.corners[i] + 0.5)
    })
  })

  it('켬: 같은 시드 같음, 다른 시드 다름, 1000프레임 σ가 0.3 px의 10% 안, 검출 집합은 잡음과 무관', () => {
    const clean = tagsInput(observed, 'Webcam 1', 0, { enabled: false, seed: 0 })
    const a = tagsInput(observed, 'Webcam 1', 35 * MS, { enabled: true, seed: 7 })
    expect(tagsInput(observed, 'Webcam 1', 35 * MS, { enabled: true, seed: 7 })).toEqual(a)
    expect(tagsInput(observed, 'Webcam 1', 35 * MS, { enabled: true, seed: 8 })).not.toEqual(a)
    // 다른 장치 이름은 다른 흐름
    expect(tagsInput(observed, 'Webcam 2', 35 * MS, { enabled: true, seed: 7 })).not.toEqual(a)
    expect(tagIds(a)).toEqual(tagIds(clean))
    expect(isTagsInput('tags', a)).toBe(true)
    let sum = 0
    let sum2 = 0
    let n = 0
    for (let k = 1; k <= 1000; k++) {
      const noisy = tagsInput(observed, 'Webcam 1', Math.floor((k * 1e9) / 30), {
        enabled: true,
        seed: 3
      })
      expect(tagIds(noisy)).toEqual(tagIds(clean))
      noisy.forEach((v, i) => {
        if (i % 9 === 0) return
        const e = v - clean[i]
        sum += e
        sum2 += e * e
        n++
      })
    }
    const mean = sum / n
    const sigma = Math.sqrt(sum2 / n - mean * mean)
    expect(Math.abs(sigma - 0.3)).toBeLessThan(0.03)
    expect(Math.abs(mean)).toBeLessThan(0.01)
  })
})

describe('FieldCameras.read (A11)', () => {
  const chassis = planarFrame(AUDIENCE_START)
  const frames = (): Frame3 => chassis

  function read(
    cameras: FieldCameras,
    tPrev: number | null,
    t: number,
    out: Outputs
  ): [string, string, unknown][] {
    const puts: [string, string, unknown][] = []
    const put: CameraPut = (device, key, value) => puts.push([device, key, value])
    cameras.read(frames, tPrev, t, out, put)
    return puts
  }

  it('model은 늘, 프레임 틱에 frameNanos·frameWidth·frameHeight·tags 순서', () => {
    const cameras = new FieldCameras(BIOBUZZ, [false, false], [FRONT_CAMERA], {
      enabled: false,
      seed: 0
    })
    const out = { 'Webcam 1': camOut() }
    // 첫 step(tPrev null)·프레임 아닌 틱: model만
    expect(read(cameras, null, 0, out)).toEqual([['Webcam 1', 'model', 'logitechC920']])
    expect(read(cameras, 25 * MS, 30 * MS, out)).toEqual([['Webcam 1', 'model', 'logitechC920']])
    const frame = read(cameras, 30 * MS, 35 * MS, out)
    expect(frame.map(([, key]) => key)).toEqual([
      'model',
      'frameNanos',
      'frameWidth',
      'frameHeight',
      'tags'
    ])
    expect(frame[1][2]).toBe(35 * MS)
    expect(frame[2][2]).toBe(640)
    expect(frame[3][2]).toBe(480)
    expect(tagIds(frame[4][2])).toEqual([30, 31, 34, 35, 36, 37])
    expect(isTagsInput('tags', frame[4][2])).toBe(true)
  })

  it('스트리밍이 아니거나 해상도가 틀리면 프레임 없음, 처리기 끔·다른 패밀리면 빈 tags', () => {
    const cameras = new FieldCameras(BIOBUZZ, [false, false], [FRONT_CAMERA], {
      enabled: false,
      seed: 0
    })
    const keys = (change: DeviceValues | null): string[] =>
      read(cameras, 30 * MS, 35 * MS, change === null ? {} : { 'Webcam 1': camOut(change) }).map(
        ([, key]) => key
      )
    expect(keys(null)).toEqual(['model'])
    expect(keys({ streaming: false })).toEqual(['model'])
    expect(keys({ width: 0 })).toEqual(['model'])
    expect(keys({ width: 640.5 })).toEqual(['model'])
    expect(keys({ height: undefined as unknown as number })).toEqual(['model'])
    const changes: DeviceValues[] = [{ aprilTag: false }, { family: 'TAG_25h9' }, { family: null }]
    for (const change of changes) {
      const puts = read(cameras, 30 * MS, 35 * MS, { 'Webcam 1': camOut(change) })
      expect(puts.map(([, key]) => key)).toEqual([
        'model',
        'frameNanos',
        'frameWidth',
        'frameHeight',
        'tags'
      ])
      expect(puts[4][2]).toEqual([])
    }
  })

  it('비유한 몸체 틀: 판정이 모두 실패해 빈 tags(비유한 수를 보내지 않음)', () => {
    // 카메라 원점이 NaN인 몸체 틀. 비유한 꼭짓점 방어(빈 tags + camera <장치> 알림)는 판정이 비유한 수를 통과시키지
    // 않아 이 길로는 닿지 않는다(세계의 changed()도 비유한 원소가 있는 배열은 보내지 않는다)
    const cameras = new FieldCameras(BIOBUZZ, [false, false], [FRONT_CAMERA], {
      enabled: false,
      seed: 0
    })
    const notes: string[] = []
    const puts: [string, string, unknown][] = []
    cameras.read(
      () => ({ rotation: chassis.rotation, origin: { x: NaN, y: 0, z: 0 } }),
      30 * MS,
      35 * MS,
      { 'Webcam 1': camOut() },
      (device, key, value) => puts.push([device, key, value]),
      (detail) => notes.push(detail)
    )
    expect(puts[4][2]).toEqual([])
    expect(notes).toEqual([])
  })
})

describe('세계의 웹캠 입력 (A11)', () => {
  const spec = (change: Partial<WorldSpec> = {}): WorldSpec =>
    robotSpec(
      { start: AUDIENCE_START },
      {
        field: { season: 'biobuzz', hiveTipped: [false, false] },
        cameras: [FRONT_CAMERA],
        ...change
      }
    )

  it('첫 틱 model만, 프레임 틱에 넷, 같은 tags는 다시 보내지 않고 frameNanos만', () => {
    const world = new PhysicsWorld(spec())
    const inputs: Outputs[] = []
    for (let k = 0; k <= 30; k++) inputs.push(world.step(k * TICK, still({ 'Webcam 1': camOut() })))
    expect(inputs[0]['Webcam 1']).toEqual({ model: 'logitechC920' })
    // 프레임 틱: g_1 = 33.3 ms → 35 ms(k 7), g_2 = 66.7 ms → 70 ms(k 14), g_3 = 100 ms(k 20), g_4 = 133.3 → 135 ms(k 27)
    const frameTicks = inputs.flatMap((input, k) =>
      input['Webcam 1']?.frameNanos !== undefined ? [k] : []
    )
    expect(frameTicks).toEqual([7, 14, 20, 27])
    expect(Object.keys(inputs[7]['Webcam 1'])).toEqual([
      'frameNanos',
      'frameWidth',
      'frameHeight',
      'tags'
    ])
    expect(tagIds(inputs[7]['Webcam 1'].tags)).toEqual([30, 31, 34, 35, 36, 37])
    // 로봇이 서 있어 tags가 같으면 frameNanos만
    expect(inputs[14]['Webcam 1']).toEqual({ frameNanos: 70 * MS })
    // 프레임이 아닌 틱에는 웹캠 키가 없다
    expect(inputs[8]['Webcam 1']).toBeUndefined()
  })

  it('streaming false·width 0·비정수·누락이면 프레임 없음', () => {
    const changes: DeviceValues[] = [
      { streaming: false },
      { width: 0 },
      { width: 1.5 },
      { height: null }
    ]
    for (const change of changes) {
      const world = new PhysicsWorld(spec())
      const seen: Outputs[] = []
      for (let k = 0; k <= 10; k++)
        seen.push(world.step(k * TICK, still({ 'Webcam 1': camOut(change) })))
      expect(seen.every((input, k) => k === 0 || input['Webcam 1'] === undefined)).toBe(true)
    }
    // 출력이 아예 없어도
    const world = new PhysicsWorld(spec())
    for (let k = 0; k <= 10; k++) {
      const input = world.step(k * TICK, still({}))
      expect(input['Webcam 1']).toEqual(k === 0 ? { model: 'logitechC920' } : undefined)
    }
  })

  it('같은 시각 두 번(dt 0)이면 프레임 없음', () => {
    const world = new PhysicsWorld(spec())
    for (let k = 0; k <= 6; k++) world.step(k * TICK, still({ 'Webcam 1': camOut() }))
    expect(world.step(35 * MS, still({ 'Webcam 1': camOut() }))['Webcam 1']?.frameNanos).toBe(
      35 * MS
    )
    expect(world.step(35 * MS, still({ 'Webcam 1': camOut() }))['Webcam 1']).toBeUndefined()
  })

  it('카메라 없으면 입력이 바이트 그대로', () => {
    const run = (s: WorldSpec): string => {
      const world = new PhysicsWorld(s)
      const out: Outputs[] = []
      for (let k = 0; k <= 40; k++) out.push(world.step(k * TICK, still({ 'Webcam 1': camOut() })))
      return JSON.stringify(out)
    }
    const withCam = run(spec())
    const without = run(spec({ cameras: [] }))
    expect(without).not.toContain('Webcam 1')
    // 카메라 키를 뺀 나머지가 같다
    const strip = (text: string): unknown =>
      (JSON.parse(text) as Outputs[]).map((input) =>
        Object.fromEntries(Object.entries(input).filter(([device]) => device !== 'Webcam 1'))
      )
    expect(strip(withCam)).toEqual(JSON.parse(without))
  })

  it('센서와 카메라가 함께 있어도 관절 bodyPoses()는 틱마다 한 번', () => {
    const pan = panJoint()
    const s = spec({
      joints: [pan],
      motors: [...robotSpec().motors, panMotor],
      distanceSensors: [{ device: 'dist', mount: mount(0, 0.05, 0, 0.05, 0) }],
      cameras: [{ ...FRONT_CAMERA, mount: mount(0, 0.05, 0, 0.05, UP50) }]
    })
    const world = new PhysicsWorld(s)
    const spy = vi.spyOn(Articulation.prototype, 'bodyPoses')
    try {
      for (let k = 0; k <= 30; k++) {
        spy.mockClear()
        const input = world.step(k * TICK, { ...still({ 'Webcam 1': camOut() }), pan: panOut(0) })
        expect(spy).toHaveBeenCalledTimes(1)
        if (k === 7) expect(input['Webcam 1']?.frameNanos).toBe(35 * MS)
      }
    } finally {
      spy.mockRestore()
    }
  })
})

// 팬 관절(회전 +z, 로봇 앞 끝 위)과 그 모터. 웹캠은 관절 틀에서 위 50°(관절 각 0이면 로봇 앞)
const PAN_PARAMS = testMotorParams(TAG, 19.2)
const panMotor: SimMotorSpec = {
  device: 'pan',
  modelTag: TAG,
  gearbox: 19.2,
  directionSign: 1,
  params: PAN_PARAMS
}
function panJoint(): SimJointSpec {
  return {
    parent: -1,
    type: 'revolute',
    origin: { position: { x: HALF - 0.05, y: 0, z: 0.25 }, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: { lower: -Math.PI / 2, upper: Math.PI / 2 },
    body: { mass: 0.2, centerOfMass: ZERO, inertia: [2e-4, 2e-4, 2e-4, 0, 0, 0] },
    friction: { coulomb: 0.02, viscous: 0.001 },
    spring: null,
    drive: {
      kind: 'motor',
      devices: ['pan'],
      ratio: 1 / 4,
      params: PAN_PARAMS,
      rigging: { kind: 'direct' }
    },
    switches: []
  }
}
const panOut = (power: number): DeviceValues => ({
  mode: 'RUN_WITHOUT_ENCODER',
  power: power * HUB_SIGN,
  velocity: null,
  enabled: true,
  zeroPower: 'BRAKE',
  targetPosition: null,
  encoderOffset: 0
})

describe('관절 하위 카메라 (A12)', () => {
  // 팬을 power로 돌리며 프레임마다 보이는 태그 id 목록과 관절 각을 모은다
  function sweep(base: 'floating' | 'fixed'): { ids: number[][]; q: number[] } {
    const robot = robotSpec(
      { start: AUDIENCE_START },
      {
        field: { season: 'biobuzz', hiveTipped: [false, false] },
        joints: [panJoint()],
        cameras: [{ ...FRONT_CAMERA, mount: mount(0, 0.05, 0, 0.05, UP50) }]
      }
    )
    const s: WorldSpec =
      base === 'floating'
        ? { ...robot, motors: [...robot.motors, panMotor] }
        : { ...robot, wheels: [], motors: [panMotor] }
    const world = new PhysicsWorld(s)
    const ids: number[][] = []
    const q: number[] = []
    let last: number[] = []
    for (let k = 0; k <= 600; k++) {
      const drive = base === 'floating' ? still({}) : {}
      const input = world.step(k * TICK, {
        ...drive,
        'Webcam 1': camOut(),
        pan: panOut(k < 300 ? 0.25 : -0.25)
      })
      const cam = input['Webcam 1']
      if (cam?.tags !== undefined) last = tagIds(cam.tags)
      if (cam?.frameNanos !== undefined) {
        ids.push(last)
        q.push(world.pose().joints![0])
      }
    }
    return { ids, q }
  }

  for (const base of ['floating', 'fixed'] as const) {
    it(`${base === 'floating' ? '부유 기저' : '고정 기저(시작 자세와 합성)'}: 관절 각을 따라 보는 태그가 바뀐다`, () => {
      const { ids, q } = sweep(base)
      // 관절 각 0 근처(처음)는 기준표의 위 50°: 34–37
      expect(ids[0]).toEqual([34, 35, 36, 37])
      expect(Math.max(...q.map(Math.abs))).toBeGreaterThan(0.3)
      const distinct = new Set(ids.map((list) => list.join(',')))
      expect(distinct.size).toBeGreaterThan(2)
    })
  }
})

describe('성능 (A13)', () => {
  it('BIOBUZZ 16태그·웹캠 둘(9점 가림): 프레임 하나 중앙값 기록, CI 상한 5 ms', () => {
    const cams: SimCameraSpec[] = [
      FRONT_CAMERA,
      { device: 'Webcam 2', mount: mount(-1, HALF, 0.1, 0.25, UP30, 0.3), model: 'gobilda3122' }
    ]
    const cameras = new FieldCameras(BIOBUZZ, [false, false], cams, { enabled: false, seed: 0 })
    const chassis = planarFrame(AUDIENCE_START)
    const out = { 'Webcam 1': camOut(), 'Webcam 2': camOut() }
    const put: CameraPut = () => {}
    const times: number[] = []
    for (let i = 0; i < 1050; i++) {
      const start = performance.now()
      cameras.read(() => chassis, 30 * MS, 35 * MS, out, put)
      if (i >= 50) times.push((performance.now() - start) / cams.length)
    }
    times.sort((a, b) => a - b)
    const median = times[times.length >> 1]
    console.info(`4d 카메라 프레임 하나 중앙값 ${median.toFixed(4)} ms (목표 0.3 ms)`)
    expect(median).toBeLessThan(5)
  })
})
