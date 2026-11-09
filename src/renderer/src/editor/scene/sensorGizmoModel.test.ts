import { Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import type { ColorReading } from '../../../../shared/sim/colorSensor'
import type { RayHit } from '../../../../shared/sim/fieldRaycast'
import { TOF_WHITE_RANGE, type RangeReading } from '../../../../shared/sim/rangeSensor'
import type { HardwareComponent, JointSettings, SceneObjects, Transform } from '../../scene/model'
import { newRun, type PlayData, type PlayRun } from '../../play/playStore'
import { ROBOT_COM_COLOR } from '../mass/CenterOfMassIndicator'
import { IMU_LOGO_COLOR, IMU_USB_COLOR } from './ImuIndicators'
import {
  COLOR_GIZMO_REACH,
  GIZMO_OUTER_THETA,
  SENSOR_COLOR_LINE_COLOR,
  SENSOR_DISTANCE_COLOR,
  SENSOR_EXCLUDED_COLOR,
  SENSOR_WARNING_COLOR,
  mountMatrix,
  predictedColor,
  sensorGizmoGeometry,
  sensorGizmoPose,
  sensorGizmoTargets,
  type SensorGizmoTarget
} from './sensorGizmoModel'

// 씬 뷰 거리·컬러 센서 기즈모의 순수 모델(spec-4c §1.9, C10·C10a·C10b). 광선은 시험용 바닥 평면(z = 0)이다(필드
// 광선 계산(A)과 관계없이 모선 자르기·발자국 규칙만 본다).

const DEG = Math.PI / 180
const at = (x: number, y: number, z: number, yaw = 0): Transform => ({
  position: [x, y, z],
  rotation: [0, 0, yaw]
})

const NO_VISIBILITY = { hidden: new Set<string>(), isolated: null, fieldHidden: false }
const NO_PREVIEW = { values: {} }
const IDLE: Pick<PlayData, 'run' | 'simPose'> = { run: null, simPose: null }

function sensorComponent(
  id: string,
  type: 'distanceSensor' | 'colorSensor',
  props: Record<string, number> = {}
): HardwareComponent {
  return {
    id,
    type,
    name: id,
    hub: 'controlHub',
    port: 1,
    props: { aimYaw: 0, aimPitch: type === 'colorSensor' ? -Math.PI / 2 : 0, ...props }
  }
}

const lift: JointSettings = {
  type: 'prismatic',
  anchor: [0, 0, 0],
  axis: 'z',
  axisSign: 1,
  limits: { lower: 0, upper: 0.5 },
  friction: { coulomb: 0, viscous: 0 },
  spring: null,
  drive: { kind: 'none' }
}

// 로봇(1, 0) 요 0. 앞 거리 센서 파트(0.2, 0, 0.1), 리프트 그룹 아래 아래를 보는 컬러 센서 파트(0.1, 0, 0.05)
function scene(): SceneObjects {
  return {
    bot: { id: 'bot', name: 'Bot', kind: 'robot', parentId: null, transform: at(1, 0, 0) },
    front: {
      id: 'front',
      name: 'Front',
      kind: 'part',
      parentId: 'bot',
      transform: at(0.2, 0, 0.1),
      components: [sensorComponent('dist', 'distanceSensor')]
    },
    lift: {
      id: 'lift',
      name: 'Lift',
      kind: 'group',
      parentId: 'bot',
      transform: at(0, 0, 0),
      joint: lift
    },
    floorSensor: {
      id: 'floorSensor',
      name: 'Floor',
      kind: 'part',
      parentId: 'lift',
      transform: at(0.1, 0, 0.05),
      components: [sensorComponent('col', 'colorSensor')]
    },
    plain: { id: 'plain', name: 'Plain', kind: 'part', parentId: 'bot', transform: at(0, 0, 0) }
  }
}

const target = (objects: SceneObjects, key: string): SensorGizmoTarget =>
  sensorGizmoTargets(objects, ['bot'], NO_VISIBILITY).find((t) => t.key === key)!

// 시험용 바닥(z = 0 평면) 광선
const floorCaster = {
  cast(
    o: { x: number; y: number; z: number },
    d: { x: number; y: number; z: number },
    maxT: number
  ): RayHit | null {
    if (!(d.z < 0) || o.z < 0) return null
    const t = o.z / -d.z
    if (t > maxT) return null
    return { t, cosIncidence: -d.z, rgb: [0.2, 0.2, 0.2], nir: 0.2, surface: { kind: 'floor' } }
  }
}

// 센서 틀: 원점 (0, 0, h), 조준 (yaw, pitch)
function matrixAt(h: number, pitch: number, yaw = 0): number[] {
  return mountMatrix({
    position: { x: 0, y: 0, z: h },
    rotation: { x: 0, y: -pitch, z: yaw }
  }).elements
}

const length = (s: {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
}): number => Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y, s.to.z - s.from.z)

const range = (reading: Partial<RangeReading>): RangeReading => ({
  distance: null,
  raw: null,
  reflectance: 0,
  maxRange: 0,
  surface: null,
  rays: [],
  ...reading
})

describe('기즈모 대상', () => {
  it('고른 오브젝트·상위·다중 선택, 센서 자신의 숨김', () => {
    const objects = scene()
    const keys = (ids: string[], hidden: string[] = []): string[] =>
      sensorGizmoTargets(objects, ids, { ...NO_VISIBILITY, hidden: new Set(hidden) }).map(
        (t) => t.key
      )
    expect(keys([])).toEqual([])
    expect(keys(['bot'])).toEqual(['dist', 'col'])
    expect(keys(['lift'])).toEqual(['col'])
    expect(keys(['front'])).toEqual(['dist'])
    expect(keys(['plain'])).toEqual([])
    expect(keys(['front', 'lift'])).toEqual(['dist', 'col'])
    // 센서 오브젝트 자신을 숨기면 그리지 않는다(상위를 숨긴 것은 그 오브젝트의 숨김이 아니다)
    expect(keys(['bot'], ['front'])).toEqual(['col'])
    expect(keys(['bot'], ['lift'])).toEqual(['dist', 'col'])
    // 고립 보기 밖도 숨김이다
    expect(
      sensorGizmoTargets(objects, ['bot'], { ...NO_VISIBILITY, isolated: ['front'] }).map(
        (t) => t.key
      )
    ).toEqual(['dist'])
  })
})

describe('기즈모 형상', () => {
  it('아래를 보는 거리 센서(h 0.05): 모선 8개가 바닥에서 잘린다(길이 h/cos 11.1988°)', () => {
    const geometry = sensorGizmoGeometry({
      kind: 'distance',
      matrix: matrixAt(0.05, -90 * DEG),
      pivot: { x: 0, y: 0, z: 0.06 },
      caster: floorCaster,
      reading: range({ distance: 0.05, raw: 0.05 }),
      excluded: false,
      selfHitDistance: null
    })
    expect(GIZMO_OUTER_THETA / DEG).toBeCloseTo(11.1988, 4)
    const fromOrigin = geometry.solid.filter((s) => s.from === geometry.origin)
    // 축 1 + 모선 8
    expect(fromOrigin).toHaveLength(9)
    expect(length(fromOrigin[0])).toBeCloseTo(0.05, 12)
    for (const s of fromOrigin.slice(1))
      expect(Math.abs(length(s) - 0.05 / Math.cos(GIZMO_OUTER_THETA))).toBeLessThan(1e-9)
    // 끝점끼리 이은 폐곡선(발자국) 8개도 실선, 점선 없음
    expect(geometry.solid).toHaveLength(17)
    expect(geometry.dashed).toHaveLength(0)
    expect(geometry.value?.kind).toBe('sphere')
    expect(geometry.value!.at.z).toBeCloseTo(0, 12)
    expect(geometry.origin.z).toBeCloseTo(0.05, 12)
    expect(geometry.pivot).toEqual({ x: 0, y: 0, z: 0.06 })
  })

  it('빈 필드 수평 센서(h 0.2): 아래 모선만 바닥에서 잘리고 나머지는 1.2 m 점선', () => {
    const geometry = sensorGizmoGeometry({
      kind: 'distance',
      matrix: matrixAt(0.2, 0),
      pivot: { x: 0, y: 0, z: 0.2 },
      caster: floorCaster,
      reading: range({}),
      excluded: false,
      selfHitDistance: null
    })
    const solidRays = geometry.solid.filter((s) => s.from === geometry.origin)
    expect(solidRays).toHaveLength(1)
    // 아래 모선(ψ = 180°)은 바닥 z = 0에서 끝난다
    expect(solidRays[0].to.z).toBeCloseTo(0, 12)
    const dashedRays = geometry.dashed.filter((s) => s.from === geometry.origin)
    // 축 + 모선 7
    expect(dashedRays).toHaveLength(8)
    for (const s of dashedRays) expect(length(s)).toBeCloseTo(TOF_WHITE_RANGE, 12)
    // 신호가 없으면 값 표시 없음
    expect(geometry.value).toBeNull()
  })

  it('문턱 아래(신호 있음)는 속 빈 고리, 빠진 센서는 값이 없다', () => {
    const base = {
      kind: 'distance' as const,
      matrix: matrixAt(0.02, 0),
      pivot: { x: 0, y: 0, z: 0.02 },
      caster: floorCaster,
      selfHitDistance: null
    }
    const weak = sensorGizmoGeometry({
      ...base,
      reading: range({ raw: 0.162, reflectance: 0.0064 }),
      excluded: false
    })
    expect(weak.value?.kind).toBe('ring')
    expect(weak.value!.at.x).toBeCloseTo(0.162, 12)
    const excluded = sensorGizmoGeometry({
      ...base,
      reading: range({ distance: 0.15, raw: 0.15 }),
      excluded: true
    })
    expect(excluded.excluded).toBe(true)
    expect(excluded.value).toBeNull()
    // 원뿔은 그대로 그린다(회색)
    expect(excluded.solid.length + excluded.dashed.length).toBe(
      weak.solid.length + weak.dashed.length
    )
  })

  it('컬러: 축 교차에 반경 0.6·d 원과 예측 색, 6 in보다 멀면 점선·원 없음', () => {
    const reading: ColorReading = {
      red: 696,
      green: 281,
      blue: 139,
      proximity: 810,
      distance: 0.015,
      surface: { kind: 'floor' },
      footprint: []
    }
    const near = sensorGizmoGeometry({
      kind: 'color',
      matrix: matrixAt(0.015, -90 * DEG),
      pivot: { x: 0, y: 0, z: 0.03 },
      caster: floorCaster,
      reading,
      excluded: false,
      selfHitDistance: null
    })
    expect(near.solid).toHaveLength(1)
    expect(near.disc).not.toBeNull()
    expect(near.disc!.radius).toBeCloseTo(0.6 * 0.015, 12)
    expect(near.disc!.center.z).toBeCloseTo(0, 12)
    // 드라이버 값 744.72·281·215.45를 최댓값으로: 빨강
    expect(near.disc!.color).toBe(predictedColor(reading))
    expect(predictedColor(reading)).toBe('#ff604a')
    expect(predictedColor({ red: 309 / 1.07, green: 309, blue: 309 / 1.55 })).toBe('#ffffff')
    expect(predictedColor({ red: 0, green: 0, blue: 0 })).toBe('#000000')
    const far = sensorGizmoGeometry({
      kind: 'color',
      matrix: matrixAt(0.3, -90 * DEG),
      pivot: { x: 0, y: 0, z: 0.31 },
      caster: floorCaster,
      reading,
      excluded: false,
      selfHitDistance: null
    })
    expect(far.solid).toHaveLength(0)
    expect(far.dashed).toHaveLength(1)
    expect(length(far.dashed[0])).toBeCloseTo(COLOR_GIZMO_REACH, 12)
    expect(far.disc).toBeNull()
    // 값 표시를 숨기면(실행 중) 원이 없다
    expect(
      sensorGizmoGeometry({
        kind: 'color',
        matrix: matrixAt(0.015, -90 * DEG),
        pivot: { x: 0, y: 0, z: 0.03 },
        caster: floorCaster,
        reading: null,
        excluded: false,
        selfHitDistance: null
      }).disc
    ).toBeNull()
  })

  it('자기 가림: 그 거리부터 축 끝까지 경고 점선', () => {
    const geometry = sensorGizmoGeometry({
      kind: 'distance',
      matrix: matrixAt(0.2, 0),
      pivot: { x: 0, y: 0, z: 0.2 },
      caster: floorCaster,
      reading: null,
      excluded: false,
      selfHitDistance: 0.05
    })
    expect(geometry.warning).toHaveLength(1)
    expect(geometry.warning[0].from.x).toBeCloseTo(0.05, 12)
    expect(geometry.warning[0].to.x).toBeCloseTo(TOF_WHITE_RANGE, 12)
  })

  it('색: 거리·경고 색상각이 기존 표시 색과 25° 넘게 떨어진다(경고와 IMU USB는 점선 모양으로 구분)', () => {
    // sRGB 글자 그대로의 색상각(three Color는 선형 작업 공간이라 쓰지 않는다)
    const rgb = (hex: string): number[] =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const hue = (hex: string): number => {
      const [r, g, b] = rgb(hex)
      const max = Math.max(r, g, b)
      const d = max - Math.min(r, g, b)
      if (d === 0) return 0
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return (h * 60 + 360) % 360
    }
    const saturation = (hex: string): number => {
      const values = rgb(hex)
      const max = Math.max(...values)
      return max === 0 ? 0 : (max - Math.min(...values)) / max
    }
    const gap = (a: string, b: string): number => {
      const d = Math.abs(hue(a) - hue(b)) % 360
      return Math.min(d, 360 - d)
    }
    // 축 X·Y·Z(FrameAxes), 선택(SceneObjectsView), 로봇 무게중심, IMU, 관절(JointGizmo)
    const existing = [
      '#ff3653',
      '#8adb00',
      '#2c8fff',
      '#4c8dff',
      ROBOT_COM_COLOR,
      IMU_LOGO_COLOR,
      IMU_USB_COLOR,
      '#facc15'
    ]
    for (const color of existing)
      expect(gap(SENSOR_DISTANCE_COLOR, color)).toBeGreaterThanOrEqual(25)
    for (const color of existing.filter((c) => c !== IMU_USB_COLOR))
      expect(gap(SENSOR_WARNING_COLOR, color)).toBeGreaterThanOrEqual(25)
    expect(gap(SENSOR_DISTANCE_COLOR, SENSOR_WARNING_COLOR)).toBeGreaterThanOrEqual(25)
    // 컬러 선과 빠진 센서는 무채색에 가깝다
    for (const neutral of [SENSOR_COLOR_LINE_COLOR, SENSOR_EXCLUDED_COLOR])
      expect(saturation(neutral)).toBeLessThan(0.35)
  })
})

// ---- 자세 원천 ----

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Auto',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Auto.java',
  line: 1,
  flavor: 'Autonomous',
  name: 'Auto',
  group: '',
  preselectTeleOp: ''
}

function runOf(
  patch: Partial<PlayRun>,
  sensors: PlayRun['sensors'],
  joints: string[] = []
): PlayRun {
  const run = newRun({
    runId: 'r1',
    root: '/p',
    opMode: OP_MODE,
    robotId: 'bot',
    configPath: null,
    speed: 1,
    paused: false,
    joints,
    sensors
  })
  return { ...run, phase: 'running', ...patch }
}

const axisOf = (m: Matrix4): Vector3 => new Vector3(1, 0, 0).transformDirection(m)

describe('기즈모 자세 원천', () => {
  it('문서: 로봇 좌표 장착을 표시 행렬로(형상이 없으면 피벗)', () => {
    const objects = scene()
    const pose = sensorGizmoPose(objects, target(objects, 'dist'), IDLE, NO_PREVIEW, null)!
    expect(pose.source).toBe('document')
    expect(pose.showValues).toBe(true)
    const origin = new Vector3().setFromMatrixPosition(pose.matrix)
    expect(origin.toArray().map((v) => Number(v.toFixed(12)))).toEqual([1.2, 0, 0.1])
    expect(axisOf(pose.matrix).x).toBeCloseTo(1, 12)
    expect(pose.pivot.toArray().map((v) => Number(v.toFixed(12)))).toEqual([1.2, 0, 0.1])
  })

  it('C10a: 미리보기 q = 0.2 m인 리프트 하위 센서는 +0.2 m z, 실행 중인 로봇은 미리보기를 무시', () => {
    const objects = scene()
    const preview = { values: { lift: 0.2 } }
    const rest = sensorGizmoPose(objects, target(objects, 'col'), IDLE, NO_PREVIEW, null)!
    const moved = sensorGizmoPose(objects, target(objects, 'col'), IDLE, preview, null)!
    const z = (m: Matrix4): number => new Vector3().setFromMatrixPosition(m).z
    expect(z(moved.matrix) - z(rest.matrix)).toBeCloseTo(0.2, 12)
    // 한계(0.5)로 자른다
    const clamped = sensorGizmoPose(
      objects,
      target(objects, 'col'),
      IDLE,
      { values: { lift: 2 } },
      null
    )!
    expect(z(clamped.matrix) - z(rest.matrix)).toBeCloseTo(0.5, 12)
    // 실행 중(자세를 아직 받지 않음): 미리보기를 쓰지 않고 값 표시를 숨긴다
    const running = { run: runOf({}, []), simPose: null }
    const live = sensorGizmoPose(objects, target(objects, 'col'), running, preview, null)!
    expect(z(live.matrix)).toBeCloseTo(z(rest.matrix), 12)
    expect(live.showValues).toBe(false)
  })

  it('C10b: 실행 중에는 run.sensors 장착(문서 조준을 바꿔도), 떼어 놓은 실행이면 문서, 지운 오브젝트는 없음', () => {
    const objects = scene()
    // 실행 장착: 요 90°(로봇 +Y를 봄)
    const runMount = {
      body: -1,
      position: { x: 0.2, y: 0, z: 0.1 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 }
    }
    const sensors: PlayRun['sensors'] = [
      { objectId: 'front', componentId: 'dist', kind: 'distance', body: -1, mount: runMount }
    ]
    const run = runOf({}, sensors)
    const simPose = { robotId: 'bot', tNanos: 0, x: -1, y: 2, yaw: 0, blocked: false }
    const play = { run, simPose }
    // 문서 조준을 0으로 둔 채(실행 장착과 다름)
    const pose = sensorGizmoPose(objects, target(objects, 'dist'), play, NO_PREVIEW, null)!
    expect(pose.source).toBe('run')
    expect(pose.showValues).toBe(false)
    const expected = new Matrix4().makeTranslation(-1, 2, 0).multiply(mountMatrix(runMount))
    pose.matrix.elements.forEach((v, i) =>
      expect(Math.abs(v - expected.elements[i])).toBeLessThan(1e-12)
    )
    expect(axisOf(pose.matrix).y).toBeCloseTo(1, 12)
    // 떼어 놓은 실행이면 문서 조준
    const detached = sensorGizmoPose(
      objects,
      target(objects, 'dist'),
      { run: { ...run, detached: true }, simPose },
      NO_PREVIEW,
      null
    )!
    expect(detached.source).toBe('document')
    expect(axisOf(detached.matrix).x).toBeCloseTo(1, 12)
    // 실행 중 지운 오브젝트: 대상이 없고, 남은 대상으로 불러도 그리지 않는다
    const removed = { ...objects }
    const stale = target(objects, 'dist')
    delete removed.front
    expect(sensorGizmoTargets(removed, ['bot'], NO_VISIBILITY).map((t) => t.key)).toEqual(['col'])
    expect(sensorGizmoPose(removed, stale, play, NO_PREVIEW, null)).toBeNull()
  })

  it('실행 장착의 관절 몸체: run.joints[j] 표시 행렬 · 앵커', () => {
    const objects = scene()
    const mount = {
      body: 0,
      position: { x: 0.1, y: 0, z: 0.03 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 }
    }
    const run = runOf(
      {},
      [{ objectId: 'floorSensor', componentId: 'col', kind: 'color', body: 0, mount }],
      ['lift']
    )
    const simPose = { robotId: 'bot', tNanos: 0, x: 1, y: 0, yaw: 0, blocked: false, joints: [0.1] }
    const pose = sensorGizmoPose(
      objects,
      target(objects, 'col'),
      { run, simPose },
      NO_PREVIEW,
      null
    )!
    expect(pose.source).toBe('run')
    const origin = new Vector3().setFromMatrixPosition(pose.matrix)
    // 섀시(1, 0, 0) · 리프트 q 0.1(+z) · 장착(0.1, 0, 0.03)
    expect(origin.x).toBeCloseTo(1.1, 12)
    expect(origin.z).toBeCloseTo(0.13, 12)
    expect(axisOf(pose.matrix).z).toBeCloseTo(-1, 12)
  })
})
