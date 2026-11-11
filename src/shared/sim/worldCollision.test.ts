import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { Articulation, bodyPoint, type ContactSet } from './articulation'
import { BodyCollision, frictionTangent } from './bodyCollision'
import {
  bodyShape,
  placeShape,
  shapeSeparation,
  staticShapes,
  type PlacedShape
} from './collision3d'
import {
  HALF,
  HUB_SIGN,
  mecanum,
  outputs,
  robotSpec,
  Runner,
  TAG,
  TICK,
  ZERO,
  type Powers,
  type Robot
} from './driveTestkit'
import { WALL_INNER_HALF } from './field'
import {
  placeFootprint,
  polygonSeparation,
  rotationMatrix,
  solidFootprints
} from './seasons/fieldGeometry'
import type { FieldSpec, FieldStructure } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { presetWallFrame, snapRobotToStart } from './seasons/startPose'
import { planarFrame } from './sensorFrame'
import { TEST_ROBOT_HEIGHT, testMotorParams } from './testkit'
import type { Pose2, SimCollider, SimJointSpec, Vec2, Vec3, WorldSpec } from './worldSpec'

// 5 메커니즘 충돌의 세계 시험(spec-5 §10 A1·A5·A7·A11–A18·A21·A24·A25). 섀시 3D 경로(A16)는 4ab worldField.test.ts의 시험을
// 섀시 상자 충돌체(= 외곽 × [0, H])로 다시 돌려 같은 수용 기준(침투 증가 < 1e-6 m)을 본다. 침투는 4ab처럼 평면 SAT 분리로 잰다
// (섀시 상자가 바닥에서 H까지인 수직 기둥이라 그 높이 슬랩의 단면 분리가 3D 침투의 수평 성분이다).

const BIOBUZZ = resolveSeason('biobuzz')
const INNER = BIOBUZZ.perimeter.innerHalf
const DT = TICK / 1e9
const H18 = TEST_ROBOT_HEIGHT
const H29 = 0.7366
const FIELD: WorldSpec['field'] = { season: 'biobuzz', hiveTipped: [false, false] }
const FOOTPRINT: Vec2[] = robotSpec().robot.footprint
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]

const FOOT_BAR_RED = 0
const LEG_MX_MY = 4
const FLOWER_MX = 9
const FLOWER_PX = 10
const FLOWER_RED = 11
const FLOWER_BLUE = 12

// 섀시 상자 충돌체: 외곽(18 in 정사각) × [0, height]
const chassisBox = (height = H18, friction = 0.4): SimCollider => ({
  kind: 'box',
  center: { x: 0, y: 0, z: height / 2 },
  rotation: I,
  half: { x: HALF, y: HALF, z: height / 2 },
  friction
})

// 4ab fieldSpec와 같고 섀시가 3D 경로(상자 충돌체)
function spec3d(
  start: Pose2,
  robot: Robot = {},
  change: Partial<WorldSpec> = {},
  height = H18
): WorldSpec {
  const spec = robotSpec({ ...robot, start }, { field: FIELD, ...change })
  return { ...spec, robot: { ...spec.robot, height, colliders: [chassisBox(height)] } }
}

function hull(index: number, height = H18): Vec2[] {
  const solid = solidFootprints(BIOBUZZ, height).find((s) => s.index === index)
  if (!solid || solid.kind !== 'polygon') throw new Error(`no hull ${index}`)
  return solid.points
}
const separation = (pose: Pose2, index: number, height = H18): number =>
  polygonSeparation(placeFootprint(FOOTPRINT, pose), hull(index, height))
const worstPenetration = (poses: readonly Pose2[], index: number, height = H18): number =>
  Math.max(0, ...poses.map((p) => -separation(p, index, height)))
function wallPenetration(poses: readonly Pose2[], inner = INNER): number {
  let worst = 0
  for (const p of poses)
    for (const v of placeFootprint(FOOTPRINT, p))
      worst = Math.max(worst, Math.abs(v.x) - inner, Math.abs(v.y) - inner)
  return worst
}

function approach(index: number, from: Pose2, direction: number, gap: number, height = H18): Pose2 {
  const at = (t: number): Pose2 => ({
    x: from.x + t * Math.cos(direction),
    y: from.y + t * Math.sin(direction),
    yaw: from.yaw
  })
  expect(separation(at(0), index, height)).toBeGreaterThan(gap)
  let hi = 0
  while (separation(at(hi), index, height) > gap) {
    hi += 1e-3
    if (hi > 3) throw new Error('no contact')
  }
  let lo = hi - 1e-3
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2
    if (separation(at(mid), index, height) > gap) lo = mid
    else hi = mid
  }
  return at(lo)
}

function toward(yaw: number, direction: number, power = 1, turn = 0): Powers {
  const a = direction - yaw
  const f = Math.cos(a)
  const left = Math.sin(a)
  const scale = power / Math.max(Math.abs(f) + Math.abs(left), 1e-12)
  return mecanum(f * scale, -left * scale, turn)
}

// Articulation.step에 들어간 밖의 행 키(하위 단계마다)
function recordRows(): string[][] {
  const steps: string[][] = []
  const original = Articulation.prototype.step
  vi.spyOn(Articulation.prototype, 'step').mockImplementation(function (
    this: Articulation,
    h: number,
    drive: Parameters<Articulation['step']>[1],
    contacts?: ContactSet
  ) {
    steps.push((contacts?.rows ?? []).map((r) => r.key))
    return original.call(this, h, drive, contacts)
  })
  return steps
}

// 섀시–구조물 법선 행 키(cn.rk0/s<i>.…)
const chassisStructureKeys = (keys: readonly string[], index?: number): string[] =>
  keys.filter((k) =>
    index === undefined ? /^cn\.rk0\/s\d/.test(k) : k.startsWith(`cn.rk0/s${index}.`)
  )
const worldErrors = (r: Runner): number =>
  r.world.drainNotices().filter((n) => n.code === 'worldError').length

afterEach(() => {
  vi.restoreAllMocks()
})

describe('A16 섀시 3D 경로(4ab 시험을 섀시 상자로)', () => {
  function cornerStart(): Pose2 {
    const preset = BIOBUZZ.startPresets.find((p) => p.key === 'redWallCenter')
    if (!preset) throw new Error('redWallCenter')
    const snap = snapRobotToStart(FOOTPRINT, preset, INNER, preset.along[1])
    if (!snap.ok) throw new Error('tooWide')
    return snap.pose
  }

  it('A16 평면 행(n…·t… 벽·구조물)이 없고 섀시–정적 행은 cn.rk0/…다. blocked는 섀시–정적 법선 행만 센다', () => {
    const steps = recordRows()
    const r = new Runner(spec3d(cornerStart())).run(0.5, () =>
      outputs(toward(Math.PI / 2, -Math.PI / 4, 0.8))
    )
    vi.restoreAllMocks()
    const all = steps.flat()
    expect(all.some((k) => /^[nt][xys]/.test(k))).toBe(false)
    expect(all.some((k) => k.startsWith('cn.rk0/w3.'))).toBe(true)
    expect(all.some((k) => k.startsWith('cn.rk0/s11.'))).toBe(true)
    expect(r.poses.slice(-20).every((p) => p.blocked)).toBe(true)
    expect(worldErrors(r)).toBe(0)
  })

  type Case = { preset: string; end: 'lo' | 'hi'; direction: number; flower: number }
  const CASES: Case[] = [
    { preset: 'redWallCenter', end: 'hi', direction: 0, flower: FLOWER_RED },
    { preset: 'redWallAudience', end: 'lo', direction: Math.PI, flower: FLOWER_RED },
    { preset: 'blueWallCenter', end: 'lo', direction: Math.PI, flower: FLOWER_BLUE },
    { preset: 'scoringWallCenter', end: 'lo', direction: -Math.PI / 2, flower: FLOWER_MX },
    { preset: 'audienceWallCenter', end: 'hi', direction: Math.PI / 2, flower: FLOWER_PX }
  ]
  for (const slant of [0, Math.PI / 6])
    it(`A16 4ab A3 벽에 붙어 FLOWER로 power 1, 3 s(벽 쪽 ${Math.round((slant * 180) / Math.PI)}°): 침투 없음, blocked`, () => {
      for (const c of CASES) {
        const preset = BIOBUZZ.startPresets.find((p) => p.key === c.preset)!
        const end = c.end === 'hi' ? preset.along[1] - HALF - 0.05 : preset.along[0] + HALF + 0.05
        const snap = snapRobotToStart(FOOTPRINT, preset, INNER, end)
        if (!snap.ok) throw new Error('tooWide')
        const start = snap.pose
        const { normal } = presetWallFrame(preset.wall)
        const side = Math.sign(Math.cos(c.direction) * normal.y - Math.sin(c.direction) * normal.x)
        const direction = c.direction + slant * side
        const steps = recordRows()
        const r = new Runner(spec3d(start)).run(3, () => outputs(toward(start.yaw, direction, 1)))
        vi.restoreAllMocks()
        const all = [start, ...r.poses]
        expect(worstPenetration(all, c.flower)).toBeLessThan(1e-6)
        expect(wallPenetration(all)).toBeLessThan(1e-6)
        expect(r.pose().blocked).toBe(true)
        expect(steps.some((keys) => chassisStructureKeys(keys, c.flower).length > 0)).toBe(true)
        expect(worldErrors(r)).toBe(0)
      }
    }, 60_000)

  it('A16 4ab A10 HIVE 아래 통과: 18 in·29 in 섀시 상자 모두 구조물 행이 없고 blocked false', () => {
    for (const height of [H18, H29]) {
      const steps = recordRows()
      const r = new Runner(spec3d({ x: -1.3, y: 0, yaw: 0 }, {}, {}, height)).run(3.5, () =>
        outputs(mecanum(0.5, 0, 0))
      )
      vi.restoreAllMocks()
      expect(r.pose().x).toBeGreaterThan(0.75)
      expect(steps.flatMap((keys) => chassisStructureKeys(keys))).toEqual([])
      expect(r.poses.every((p) => !p.blocked)).toBe(true)
    }
  })

  it('A16 4ab A10c 다리 껍질에서 2 cm 떨어져 제자리 전출력 회전 2 s: 행이 생기고 침투가 늘지 않는다(곡률 보정)', () => {
    const top = hull(LEG_MX_MY).reduce((a, b) => (b.y > a.y ? b : a))
    const start = approach(LEG_MX_MY, { x: top.x, y: 0, yaw: -Math.PI / 2 }, -Math.PI / 2, 0.02)
    const steps = recordRows()
    const r = new Runner(spec3d(start)).run(2, () => outputs(mecanum(0, 0, 1)))
    vi.restoreAllMocks()
    expect(steps.flatMap((k) => chassisStructureKeys(k, LEG_MX_MY)).length).toBeGreaterThan(0)
    const all = [start, ...r.poses]
    for (const index of [FOOT_BAR_RED, LEG_MX_MY])
      expect(worstPenetration(all, index)).toBeLessThan(1e-6)
    expect(r.poses.some((p) => p.blocked)).toBe(true)
    expect(worldErrors(r)).toBe(0)
  })

  it('A16 4ab A17 모서리 대 모서리: 요 45° 섀시 모서리를 FLOWER 모서리에 곧게 몰면 침투가 늘지 않고 |ω| < 0.5 rad/s, 두 번 돌려 바이트가 같다', () => {
    const flower = hull(FLOWER_MX)
    const corner = flower.reduce((a, b) => (b.x >= a.x && b.y >= a.y ? b : a))
    const yaw = Math.PI / 4
    const lead = placeFootprint([FOOTPRINT[1]], { x: 0, y: 0, yaw })[0]
    const start = { x: corner.x + 0.03 - lead.x, y: corner.y - lead.y, yaw }
    const once = (): { text: string; omega: number; penetration: number } => {
      const r = new Runner(spec3d(start)).run(1, () => outputs(toward(yaw, Math.PI, 0.6)))
      let omega = 0
      for (let k = 1; k < r.poses.length; k++)
        omega = Math.max(omega, Math.abs(r.poses[k].yaw - r.poses[k - 1].yaw) / DT)
      return {
        text: JSON.stringify([r.inputs, r.poses, r.world.drainNotices()]),
        omega,
        penetration: worstPenetration([start, ...r.poses], FLOWER_MX)
      }
    }
    const a = once()
    expect(a.omega).toBeLessThan(0.5)
    expect(a.penetration).toBeLessThan(1e-6)
    expect(once().text).toBe(a.text)
  })

  const SOLIDS = solidFootprints(BIOBUZZ, H18)
  const worstAny = (poses: readonly Pose2[]): number => {
    let worst = 0
    for (const p of poses)
      for (const s of SOLIDS)
        if (s.kind === 'polygon')
          worst = Math.max(worst, -polygonSeparation(placeFootprint(FOOTPRINT, p), s.points))
    return worst
  }

  it('A16 4ab 리뷰 재현(A8 짧은 면 끝 걸침): 발판 막대 끝면에 거의 나란히 닿아 돌며 미끄러져도 침투가 늘지 않고 보충 점(+)이 생긴다', () => {
    const start = { x: 0.8237481154031969, y: -0.14912877470282265, yaw: 1.8086232700416973 }
    expect(worstAny([start])).toBe(0)
    const steps = recordRows()
    const r = new Runner(spec3d(start)).run(2, () =>
      outputs(mecanum(-0.1175384521484375, 0.18050765991210938, 0.5522994995117188))
    )
    vi.restoreAllMocks()
    expect(worstPenetration(r.poses, FOOT_BAR_RED)).toBeLessThan(1e-6)
    expect(worstAny(r.poses)).toBeLessThan(1e-6)
    expect(steps.flat().some((k) => /^cn\.rk0\/s0\.[^.]+\.\+/.test(k))).toBe(true)
    expect(worldErrors(r)).toBe(0)
  })

  it('A16 4ab 거의 나란한 면(1°·2.5°)으로 FLOWER·발판 막대 끝을 1 cm 넘어 미끄러지며 돌아도 침투 증가 < 1e-6 m', () => {
    type Target = {
      index: number
      face: [Vec2, Vec2]
      direction: number
      runs: { tilt: number; slide: number; turn: number }[]
    }
    const DEG = Math.PI / 180
    const flower = hull(FLOWER_RED)
    const bar = hull(FOOT_BAR_RED)
    const flowerTop = Math.max(...flower.map((p) => p.y))
    const barEnd = Math.max(...bar.map((p) => p.x))
    const targets: Target[] = [
      {
        index: FLOWER_RED,
        face: [
          { x: Math.min(...flower.map((p) => p.x)), y: flowerTop },
          { x: Math.max(...flower.map((p) => p.x)), y: flowerTop }
        ],
        direction: -Math.PI / 2,
        runs: [
          { tilt: 1 * DEG, slide: -0.5, turn: 0.2 },
          { tilt: 2.5 * DEG, slide: -0.5, turn: 0.2 }
        ]
      },
      {
        index: FOOT_BAR_RED,
        face: [
          { x: barEnd, y: Math.min(...bar.map((p) => p.y)) },
          { x: barEnd, y: Math.max(...bar.map((p) => p.y)) }
        ],
        direction: Math.PI,
        runs: [
          { tilt: -1 * DEG, slide: 0.5, turn: -0.2 },
          { tilt: -2.5 * DEG, slide: 0.5, turn: -0.2 }
        ]
      }
    ]
    for (const target of targets) {
      const [a, b] = target.face
      const along = { x: b.x - a.x, y: b.y - a.y }
      const length = Math.hypot(along.x, along.y)
      const u = { x: along.x / length, y: along.y / length }
      const back = { x: -Math.cos(target.direction), y: -Math.sin(target.direction) }
      for (const { tilt, slide, turn } of target.runs) {
        const shift = HALF - length / 2 - 0.01
        const mid = { x: (a.x + b.x) / 2 + shift * u.x, y: (a.y + b.y) / 2 + shift * u.y }
        const from = {
          x: mid.x + (HALF + 0.3) * back.x,
          y: mid.y + (HALF + 0.3) * back.y,
          yaw: target.direction + tilt
        }
        const start = approach(target.index, from, target.direction, 2e-3)
        const r = new Runner(spec3d(start)).run(1, () =>
          outputs(toward(start.yaw, target.direction + slide, 0.5, turn))
        )
        expect(worstAny(r.poses)).toBeLessThan(1e-6)
        expect(wallPenetration(r.poses)).toBeLessThan(1e-6)
        expect(worldErrors(r)).toBe(0)
      }
    }
  }, 30_000)

  const fuzzTrials = ((): { start: Pose2; command: Powers }[] => {
    const polygons = SOLIDS.filter((s) => s.kind === 'polygon')
    let seed = 12345
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const trials: { start: Pose2; command: Powers }[] = []
    while (trials.length < 48) {
      const s = polygons[Math.floor(random() * polygons.length)]
      const center = {
        x: s.points.reduce((a, p) => a + p.x, 0) / s.points.length,
        y: s.points.reduce((a, p) => a + p.y, 0) / s.points.length
      }
      const angle = random() * 2 * Math.PI
      const distance = 0.3 + random() * 0.3
      const start = {
        x: center.x + distance * Math.cos(angle),
        y: center.y + distance * Math.sin(angle),
        yaw: random() * 2 * Math.PI
      }
      const command = mecanum(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
      const placed = placeFootprint(FOOTPRINT, start)
      if (placed.some((v) => Math.max(Math.abs(v.x), Math.abs(v.y)) > INNER - 1e-3)) continue
      if (polygons.some((q) => polygonSeparation(placed, q.points) < 5e-3)) continue
      trials.push({ start, command })
    }
    return trials
  })()
  for (let part = 0; part < 4; part++)
    it(`A16 4ab 퍼즈 ${part + 1}/4: 구조물 근처 무작위 자세·명령 12개에서 침투 증가 < 1e-6 m, worldError 없음`, () => {
      for (const { start, command } of fuzzTrials.slice(part * 12, part * 12 + 12)) {
        const r = new Runner(spec3d(start)).run(1.5, () => outputs(command))
        expect(worstAny(r.poses)).toBeLessThan(1e-6)
        expect(wallPenetration(r.poses)).toBeLessThan(1e-6)
        expect(worldErrors(r)).toBe(0)
      }
    }, 30_000)

  // 자동 껍질과 같은 꼴의 섀시: 0.1 mm 격자 위 32점 둥근 상자(초타원체 |x/a|^p + |y/b|^p + |z/c|^p = 1, p = 1/0.3). 옆면이
  // 기울고 굽어 있어 기준 면에 자른 점들의 간격이 높이마다 다르다
  function roundedChassis(): SimCollider {
    const points: Vec3[] = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    const shape = (v: number): number => Math.sign(v) * Math.abs(v) ** 0.3
    const grid = (v: number): number => Math.round(v * 10000) / 10000
    for (let k = 0; k < 32; k++) {
      const z = 1 - (2 * (k + 0.5)) / 32
      const r = Math.sqrt(1 - z * z)
      const t = golden * k
      points.push({
        x: grid(HALF * shape(r * Math.cos(t))),
        y: grid(HALF * shape(r * Math.sin(t))),
        z: grid(0.12 + 0.12 * shape(z))
      })
    }
    return { kind: 'convex', points, friction: 0.4 }
  }
  const ROUNDED = roundedChassis()
  const ROUNDED_SHAPE = bodyShape(ROUNDED)!
  const CHASSIS_STATICS = staticShapes(BIOBUZZ).filter((s) => s.hull && s.chassis)
  // 둥근 섀시 껍질과 섀시가 닿는 정적 형상(벽·solid 구조물)의 3D 침투(SAT 최선 분리: 겹친 볼록의 정확한 깊이)
  const roundedPenetration = (poses: readonly Pose2[]): number => {
    let worst = 0
    for (const pose of poses) {
      const placed = placeShape(ROUNDED_SHAPE, planarFrame(pose))
      for (const st of CHASSIS_STATICS)
        worst = Math.max(worst, -shapeSeparation(placed, { kind: 'hull', hull: st.hull! }))
    }
    return worst
  }
  const roundedSpec = (start: Pose2): WorldSpec => {
    const spec = robotSpec({ start }, { field: FIELD })
    return { ...spec, robot: { ...spec.robot, colliders: [ROUNDED] } }
  }

  it('A16 둥근 섀시 껍질(32점, 기운 옆면): 발판 막대 면에 비스듬히 닿아 돌아도 가운데 s의 더 깊은 점에 행이 있어 침투 증가 < 1e-6 m', () => {
    // s의 두 끝만 남기면(§1.7 판 2) 가운데 점(v7.25)에 행이 없어 0.5 s에 1 mm 넘게 파고들던 자세·명령(고정 시드 퍼즈에서 찾음)
    const start = { x: -0.19481132016966754, y: -0.13566731870368753, yaw: 0.9915979881049569 }
    expect(roundedPenetration([start])).toBe(0)
    const command = {
      fl: 0.7677801251411438,
      bl: -0.6853687167167664,
      fr: -0.9296895861625671,
      br: 0.523459255695343
    }
    const steps = recordRows()
    const r = new Runner(roundedSpec(start)).run(1.5, () => outputs(command))
    vi.restoreAllMocks()
    expect(steps.some((keys) => chassisStructureKeys(keys, FOOT_BAR_RED).length >= 3)).toBe(true)
    expect(roundedPenetration(r.poses)).toBeLessThan(1e-6)
    expect(r.poses.some((p) => p.blocked)).toBe(true)
    expect(worldErrors(r)).toBe(0)
  })

  it('A16 둥근 섀시 껍질 퍼즈: 구조물 근처 무작위 자세·명령 12개에서 침투 증가 < 1e-6 m, worldError 없음', () => {
    let seed = 777
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let trials = 0
    while (trials < 12) {
      const s = CHASSIS_STATICS[Math.floor(random() * CHASSIS_STATICS.length)]
      const vs = s.hull!.vertices
      const cx = vs.reduce((a, v) => a + v.x, 0) / vs.length
      const cy = vs.reduce((a, v) => a + v.y, 0) / vs.length
      const angle = random() * 2 * Math.PI
      const distance = 0.35 + random() * 0.3
      const start = {
        x: cx + distance * Math.cos(angle),
        y: cy + distance * Math.sin(angle),
        yaw: random() * 2 * Math.PI
      }
      const placed = placeShape(ROUNDED_SHAPE, planarFrame(start))
      if (
        CHASSIS_STATICS.some(
          (st) => shapeSeparation(placed, { kind: 'hull', hull: st.hull! }) < 5e-3
        )
      )
        continue
      const command = mecanum(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
      const r = new Runner(roundedSpec(start)).run(1.5, () => outputs(command))
      expect(roundedPenetration(r.poses)).toBeLessThan(1e-6)
      expect(worldErrors(r)).toBe(0)
      trials++
    }
  }, 60_000)
})

// ---- 메커니즘(관절 몸체) 충돌 ----

const LIFT_PARAMS = testMotorParams(TAG, 19.2)
const motorSpec = (device: string): WorldSpec['motors'][number] => ({
  device,
  modelTag: TAG,
  gearbox: 19.2,
  directionSign: 1,
  params: LIFT_PARAMS
})
const motorOut = (power: number, change: DeviceValues = {}): DeviceValues => ({
  mode: 'RUN_WITHOUT_ENCODER',
  power: power * HUB_SIGN,
  velocity: null,
  enabled: true,
  zeroPower: 'BRAKE',
  targetPosition: null,
  encoderOffset: 0,
  ...change
})

function joint(change: Partial<SimJointSpec>): SimJointSpec {
  return {
    parent: -1,
    type: 'prismatic',
    origin: { position: ZERO, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: null,
    body: { mass: 0.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: [],
    ...change
  }
}
const box = (center: Vec3, half: Vec3, friction = 0.4, rotation: number[] = I): SimCollider => ({
  kind: 'box',
  center,
  rotation,
  half,
  friction
})
// 0.1 mm 격자 위 꼭짓점 8개의 볼록 충돌체(렌더러가 보내는 꼴)
const convexBox = (center: Vec3, half: Vec3, friction = 0.4): SimCollider => ({
  kind: 'convex',
  points: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({
    x: center.x + (k & 1 ? half.x : -half.x),
    y: center.y + (k & 2 ? half.y : -half.y),
    z: center.z + (k & 4 ? half.z : -half.z)
  })),
  friction
})
// 로봇 틀(고정 기저면 로봇 좌표, 부유 기저면 필드 좌표)의 관절 몸체 점
// (고정 기저 시험만 쓴다: 나무 관절 변위 = 세계 설명 관절 q)
const jointPoint = (r: Runner, spec: WorldSpec, i: number, local: Vec3): number[] =>
  bodyPoint(new Articulation(spec.joints).bodyPose(i, r.pose().joints ?? []), local)

// 고정 기저(바퀴 없음) 로봇: 관절과 그 모터만
function fixedSpec(
  joints: SimJointSpec[],
  motors: string[] = [],
  change: Partial<WorldSpec> = {},
  start: Pose2 = { x: 0, y: 0, yaw: 0 }
): WorldSpec {
  return robotSpec({ start }, { wheels: [], motors: motors.map(motorSpec), joints, ...change })
}

describe('A1 형상 없는 세계', () => {
  it('A1 형상이 없으면 BodyCollision을 쓰지 않고, 고정 기저의 art.step 셋째 인자는 undefined다', () => {
    const rows = vi.spyOn(BodyCollision.prototype, 'rows')
    const thirds: (ContactSet | undefined)[] = []
    const original = Articulation.prototype.step
    vi.spyOn(Articulation.prototype, 'step').mockImplementation(function (
      this: Articulation,
      h,
      drive,
      contacts
    ) {
      thirds.push(contacts)
      return original.call(this, h, drive, contacts)
    })
    const arm = joint({
      type: 'revolute',
      axis: { x: 0, y: 1, z: 0 },
      origin: { position: { x: 0.2, y: 0, z: 0.3 }, rotation: ZERO },
      body: {
        mass: 0.5,
        centerOfMass: { x: 0.15, y: 0, z: 0 },
        inertia: [1e-4, 4e-3, 4e-3, 0, 0, 0]
      }
    })
    new Runner(fixedSpec([arm])).run(0.1, () => ({}))
    expect(thirds.length).toBeGreaterThan(50)
    expect(thirds.every((c) => c === undefined)).toBe(true)
    const plain = new Runner(robotSpec()).run(0.1, () => outputs(mecanum(0.5, 0, 0)))
    expect(rows).not.toHaveBeenCalled()
    // bodyCollisionNeeded false인 세계는 BodyCollision을 만들지 않는다
    for (const world of [plain.world, new Runner(fixedSpec([arm])).world])
      expect((world as unknown as { bodyCollision: unknown }).bodyCollision).toBeNull()
  })
})

describe('관절 몸체와 바닥·벽·구조물', () => {
  // 회전 팔(축 로봇 +Y, 끝이 내려가는 쪽이 q > 0)과 볼록 상자 충돌체, 모터로 구동(FLOAT면 떨어진다)
  const arm = (colliders: SimCollider[], limits = { lower: -2, upper: 2 }): SimJointSpec =>
    joint({
      type: 'revolute',
      axis: { x: 0, y: 1, z: 0 },
      origin: { position: { x: 0.2, y: 0, z: 0.3 }, rotation: ZERO },
      limits,
      body: {
        mass: 0.5,
        centerOfMass: { x: 0.15, y: 0, z: 0 },
        inertia: [1e-4, 4e-3, 4e-3, 0, 0, 0]
      },
      friction: { coulomb: 0.01, viscous: 0 },
      drive: {
        kind: 'motor',
        devices: ['arm'],
        ratio: 1,
        params: LIFT_PARAMS,
        rigging: { kind: 'direct' }
      },
      colliders
    })
  const ARM_BOX = convexBox({ x: 0.15, y: 0, z: 0 }, { x: 0.15, y: 0.02, z: 0.02 })
  // 팔 상자 꼭짓점의 가장 낮은 z(로봇 좌표)
  const lowest = (r: Runner, spec: WorldSpec): number => {
    let low = Infinity
    for (const x of [0, 0.3])
      for (const z of [-0.02, 0.02]) low = Math.min(low, jointPoint(r, spec, 0, { x, y: 0, z })[2])
    return low
  }
  const floatOut = { arm: motorOut(0, { zeroPower: 'FLOAT' }) }

  it('A11 고정 기저 팔이 중력으로 떨어져 바닥에서 멈춘다: 침투 ≤ 1e-6 m, 0.5 s 뒤 속도 < 1e-6, 엔코더 정지', () => {
    const spec = fixedSpec([arm([ARM_BOX])], ['arm'])
    const steps = recordRows()
    const r = new Runner(spec).run(1, () => floatOut)
    vi.restoreAllMocks()
    expect(steps.flat().some((k) => k.startsWith('cn.j0k0/fl.fl.'))).toBe(true)
    const qs = r.poses.map((p) => p.joints![0])
    expect(qs[qs.length - 1]).toBeGreaterThan(0.5)
    expect(lowest(r, spec)).toBeGreaterThan(-1e-6)
    const tail = qs.slice(100)
    for (let k = 1; k < tail.length; k++)
      expect(Math.abs(tail[k] - tail[k - 1]) / DT).toBeLessThan(1e-6)
    const encoder = r.value('arm', 'position')
    r.run(0.2, () => floatOut)
    expect(r.value('arm', 'position')).toBe(encoder)
    expect(worldErrors(r)).toBe(0)
  })

  it('A11 부유 기저도 같고, 로봇 자세·바퀴 하중은 바닥 접촉과 관계없다(같은 각에서 한계로 멈춘 판과 1e-9)', () => {
    const mk = (colliders: SimCollider[], limits?: { lower: number; upper: number }): WorldSpec =>
      robotSpec(
        { start: { x: 0, y: 0, yaw: 0 } },
        { motors: [...robotSpec().motors, motorSpec('arm')], joints: [arm(colliders, limits)] }
      )
    const out = (): Record<string, DeviceValues> => ({ ...outputs({}), ...floatOut })
    const touching = new Runner(mk([ARM_BOX])).run(1.5, out)
    const q = touching.pose().joints![0]
    expect(q).toBeGreaterThan(0.5)
    // 같은 각에서 위 한계로 멈춘(형상 없는) 판
    const limited = new Runner(mk([], { lower: -2, upper: q })).run(1.5, out)
    expect(Math.abs(limited.pose().joints![0] - q)).toBeLessThan(1e-9)
    const a = touching.world.supportLoads()
    const b = limited.world.supportLoads()
    a.forEach((load, i) => expect(Math.abs(load - b[i])).toBeLessThan(1e-9))
  })

  // 벽 판·윗면: 빨강 벽(−y)을 보는 고정 기저 로봇(요 −π/2: 로봇 +X = 필드 −Y), 리프트(z) 위 앞 슬라이드(x)의 끝 상자
  function slideSpec(season: 'none' | 'biobuzz'): {
    spec: WorldSpec
    inner: number
    height: number
  } {
    const field = resolveSeason(season)
    const inner = field.perimeter.innerHalf
    const lift = joint({
      origin: { position: { x: 0, y: 0, z: 0.1 }, rotation: ZERO },
      limits: { lower: 0, upper: 0.4 },
      body: { mass: 1.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
      friction: { coulomb: 1, viscous: 0 },
      drive: {
        kind: 'motor',
        devices: ['lift'],
        ratio: 0.112 / (2 * Math.PI),
        params: LIFT_PARAMS,
        rigging: { kind: 'direct' }
      }
    })
    const slide = joint({
      parent: 0,
      axis: { x: 1, y: 0, z: 0 },
      origin: { position: { x: 0.2, y: 0, z: 0.1 }, rotation: ZERO },
      // 다 내밀면 끝 상자(0.1 m)가 벽 레일(두께 25–27 mm) 위에 걸친다
      limits: { lower: 0, upper: 0.25 },
      body: {
        mass: 0.5,
        centerOfMass: { x: 0.05, y: 0, z: 0 },
        inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0]
      },
      friction: { coulomb: 0.5, viscous: 0 },
      drive: {
        kind: 'motor',
        devices: ['slide'],
        ratio: 0.019,
        params: LIFT_PARAMS,
        rigging: { kind: 'direct' }
      },
      colliders: [box({ x: 0.1, y: 0, z: 0 }, { x: 0.05, y: 0.05, z: 0.02 })]
    })
    // 슬라이드 끝 면(편집 자세 로봇 x 0.35)이 벽에서 0.2 m
    const start = { x: 0, y: -(inner - 0.55), yaw: -Math.PI / 2 }
    const spec = fixedSpec(
      [lift, slide],
      ['lift', 'slide'],
      { field: { season, hiveTipped: [false, false] } },
      start
    )
    return { spec, inner, height: field.perimeter.height }
  }

  for (const season of ['none', 'biobuzz'] as const)
    it(`A12 벽 판과 윗면(${season}): 슬라이드가 벽 판에 막히고(법선 +y), 벽 높이 위로 올리면 넘어가고, 내리면 윗면(+z)에 얹힌다`, () => {
      const { spec, inner, height } = slideSpec(season)
      const normals: Vec3[] = []
      BodyCollision.manifoldHook = (token, m) => {
        // 고정 기저의 접촉 틀은 로봇 좌표라 필드 축으로 돌린다
        const yaw = spec.robot.start.yaw
        const n = m.normal
        if (token === 'j1k0/w3')
          normals.push({
            x: Math.cos(yaw) * n.x - Math.sin(yaw) * n.y,
            y: Math.sin(yaw) * n.x + Math.cos(yaw) * n.y,
            z: n.z
          })
      }
      // 끝 상자 필드 y의 가장 작은 값(벽 쪽): 로봇 x → 필드 −y
      const front = (r: Runner): number => {
        const p = jointPoint(r, spec, 1, { x: 0.15, y: 0, z: 0 })
        return spec.robot.start.y - p[0]
      }
      const bottom = (r: Runner): number => jointPoint(r, spec, 1, { x: 0.1, y: 0, z: -0.02 })[2]
      const r = new Runner(spec).run(1, () => ({ lift: motorOut(0), slide: motorOut(0.5) }))
      // 판에 막힘: 끝 면 = 벽 안쪽 면(1e-6 안에서 넘지 않음)
      expect(front(r)).toBeGreaterThan(-inner - 1e-6)
      expect(front(r)).toBeLessThan(-inner + 1e-3)
      expect(normals.some((n) => n.y > 0.999)).toBe(true)
      // 들어 올린 뒤 내밀면 넘어가고, 내리면 윗면에 얹힌다
      r.run(1.2, () => ({ lift: motorOut(0.8), slide: motorOut(-0.3) }))
      r.run(1, () => ({ lift: motorOut(0.2), slide: motorOut(0.5) }))
      expect(front(r)).toBeLessThan(-inner - 0.02)
      r.run(1.5, () => ({ lift: motorOut(-0.4), slide: motorOut(0.1) }))
      expect(bottom(r)).toBeGreaterThan(height - 1e-6)
      expect(bottom(r)).toBeLessThan(height + 1e-3)
      expect(normals.some((n) => n.z > 0.999)).toBe(true)
      BodyCollision.manifoldHook = null
      expect(worldErrors(r)).toBe(0)
    })

  it('A13 관절 몸체는 위 막대·로고 판에 막히고 섀시(29 in보다 높은 상자)는 막히지 않는다. HIVE CELL은 둘 다 통과', () => {
    // 섀시 높이 1.2 m(위 막대 1.04 m보다 높다)
    const tall = spec3d({ x: -1.3, y: 0, yaw: 0 }, {}, {}, 1.2)
    const steps = recordRows()
    const r = new Runner(tall).run(3.5, () => outputs(mecanum(0.5, 0, 0)))
    vi.restoreAllMocks()
    expect(r.pose().x).toBeGreaterThan(0.75)
    expect(steps.flat().filter((k) => /^cn\.rk0\/s[678]\./.test(k))).toEqual([])
    // 관절 몸체(위 막대 높이의 상자)는 막힌다
    const mast = joint({
      origin: { position: { x: 0, y: 0, z: 1.05 }, rotation: ZERO },
      limits: { lower: 0, upper: 0.01 },
      colliders: [box(ZERO, { x: 0.05, y: 0.2, z: 0.02 })]
    })
    const withMast = robotSpec(
      { start: { x: -1.3, y: 0, yaw: 0 } },
      { field: FIELD, joints: [mast] }
    )
    const mastSteps = recordRows()
    const m = new Runner(withMast).run(3.5, () => outputs(mecanum(0.5, 0, 0)))
    vi.restoreAllMocks()
    expect(mastSteps.flat().some((k) => /^cn\.j0k0\/s[678]\./.test(k))).toBe(true)
    expect(m.pose().x).toBeLessThan(0)
    // HIVE CELL(carrier hive)은 정적 형상이 아니다
    expect(mastSteps.flat().some((k) => /\/s(1[3-6])\./.test(k))).toBe(false)
    expect(m.poses.every((p) => !p.blocked)).toBe(true)
  })
})

describe('마찰(패치: 접선 둘 + 비틀림)', () => {
  // 바닥 위 상자: z 직선(자유, 중력) 위에 x 직선(일정한 힘) 또는 z 회전(일정한 토크). 바닥 법선 하중 N = 두 몸체 무게
  const MASS = 1
  const N = 2 * MASS * 9.80665
  function floorBlock(second: Partial<SimJointSpec>, friction = 0.4): WorldSpec {
    const lift = joint({
      origin: { position: { x: 0.4, y: 0, z: 0 }, rotation: ZERO },
      limits: { lower: -0.05, upper: 0.3 },
      body: { mass: MASS, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] }
    })
    const block = joint({
      parent: 0,
      body: { mass: MASS, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
      colliders: [box({ x: 0, y: 0, z: 0.02 }, { x: 0.05, y: 0.05, z: 0.02 }, friction)],
      ...second
    })
    return fixedSpec([lift, block])
  }
  const push = (force: number): Partial<SimJointSpec> => ({
    axis: { x: 1, y: 0, z: 0 },
    spring: { kind: 'constantForce', force }
  })

  it('A14 바닥 위 상자 끌기: tan 15° 밀기는 정지, 30°는 미끄러짐(μ 0.4), Collider μ 1.0 + 바닥 0.4 → 0.7', () => {
    const moved = (spec: WorldSpec): number => {
      const r = new Runner(spec).run(0.5, () => ({}))
      expect(worldErrors(r)).toBe(0)
      return Math.abs(r.pose().joints![1])
    }
    const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180)
    expect(moved(floorBlock(push(tan(15) * N)))).toBeLessThan(1e-6)
    expect(moved(floorBlock(push(tan(30) * N)))).toBeGreaterThan(0.01)
    // (1.0 + 0.4)/2 = 0.7: tan 30° = 0.577은 정지, tan 40° = 0.839는 미끄러짐
    expect(moved(floorBlock(push(tan(30) * N), 1))).toBeLessThan(1e-6)
    expect(moved(floorBlock(push(tan(40) * N), 1))).toBeGreaterThan(0.01)
  })

  it('A14 비틀림: 바닥에 누운 상자를 세로축으로 돌리는 토크가 μ·Σrλ 아래면 정지, 넘으면 돈다', () => {
    // 네 모서리 점이 N/4씩, 지렛대 = 반대각선
    const capacity = 0.4 * Math.hypot(0.05, 0.05) * N
    const twist = (torque: number): number => {
      const spec = floorBlock({
        type: 'revolute',
        axis: { x: 0, y: 0, z: 1 },
        spring: { kind: 'constantForce', force: torque }
      })
      const r = new Runner(spec).run(0.5, () => ({}))
      return Math.abs(r.pose().joints![1])
    }
    expect(twist(0.8 * capacity)).toBeLessThan(1e-6)
    expect(twist(1.2 * capacity)).toBeGreaterThan(0.01)
  })

  it('A14 정지 마찰의 t1은 법선 축 경계 근처에서 뛰지 않는다(지난 t1 투영), 미끄러지면 미끄럼 방향', () => {
    const unit = (v: [number, number, number]): [number, number, number] => {
      const l = Math.hypot(...v)
      return [v[0] / l, v[1] / l, v[2] / l]
    }
    const n1 = unit([0.3, 0.3001, 0.9])
    const n2 = unit([0.3001, 0.3, 0.9])
    const zero: [number, number, number] = [0, 0, 0]
    const a = frictionTangent(n1, zero, null)
    const fresh = frictionTangent(n2, zero, null)
    const kept = frictionTangent(n2, zero, a)
    const angle = (p: number[], q: number[]): number =>
      Math.acos(Math.min(1, Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2])))
    // 기억이 없으면 |n_k| 최소 축이 x → y로 바뀌어 크게 뛴다
    expect(angle(a, fresh)).toBeGreaterThan(0.5)
    // 지난 t1을 투영하면 연속
    expect(angle(a, kept)).toBeLessThan(1e-3)
    // 미끄러지면(> 1 mm/s) 미끄럼 방향
    const slid = frictionTangent(n2, [0.01, -0.02, 0], a)
    const wn = 0.01 * n2[0] - 0.02 * n2[1]
    const wt = unit([0.01 - wn * n2[0], -0.02 - wn * n2[1], -wn * n2[2]])
    expect(angle(slid, wt)).toBeLessThan(1e-12)
  })
})

describe('A15 자기 충돌', () => {
  // 고정 기저: 섀시 상자(윗면 0.2) + 리프트(섀시의 자식, z 직선) + 팔(리프트의 자식, 축 y 회전, FLOAT 모터라 떨어진다)
  function selfSpec(change: Partial<WorldSpec> = {}, liftColliders: SimCollider[] = []): WorldSpec {
    const lift = joint({
      origin: { position: { x: 0, y: 0, z: 0.3 }, rotation: ZERO },
      limits: { lower: 0, upper: 0.001 },
      body: { mass: 1, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
      colliders: liftColliders
    })
    const arm = joint({
      parent: 0,
      type: 'revolute',
      axis: { x: 0, y: 1, z: 0 },
      origin: { position: { x: -0.1, y: 0, z: 0 }, rotation: ZERO },
      limits: { lower: -2, upper: 2 },
      body: {
        mass: 0.4,
        centerOfMass: { x: 0.12, y: 0, z: 0 },
        inertia: [1e-4, 3e-3, 3e-3, 0, 0, 0]
      },
      friction: { coulomb: 0.005, viscous: 0 },
      colliders: [box({ x: 0.12, y: 0, z: 0 }, { x: 0.12, y: 0.02, z: 0.02 })]
    })
    const base = fixedSpec([lift, arm], [], change)
    return {
      ...base,
      robot: {
        ...base.robot,
        colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: 0.2286, y: 0.2286, z: 0.1 })]
      }
    }
  }
  const armShape = (r: Runner, spec: WorldSpec): PlacedShape => {
    const pose = new Articulation(spec.joints).bodyPose(1, r.pose().joints ?? [])
    const shape = bodyShape(spec.joints[1].colliders![0])!
    return placeShape(shape, {
      rotation: pose.rotation,
      origin: { x: pose.origin[0], y: pose.origin[1], z: pose.origin[2] }
    })
  }
  const chassisShape = (spec: WorldSpec): PlacedShape =>
    placeShape(bodyShape(spec.robot.colliders![0])!, { rotation: I, origin: ZERO })

  it('A15 비인접(팔 ↔ 섀시)은 막히고(침투 증가 < 1e-6), 인접(리프트–팔, 섀시–리프트)과 한 몸체의 두 충돌체는 지나간다', () => {
    // 리프트에 섀시·팔과 겹치는 상자 둘(인접·같은 몸체라 짝이 아니다)
    const spec = selfSpec({}, [
      box({ x: 0, y: 0, z: -0.05 }, { x: 0.05, y: 0.05, z: 0.1 }),
      box({ x: 0, y: 0, z: 0 }, { x: 0.05, y: 0.05, z: 0.05 })
    ])
    const steps = recordRows()
    const r = new Runner(spec).run(1, () => ({}))
    vi.restoreAllMocks()
    const keys = steps.flat()
    expect(keys.some((k) => k.startsWith('cn.rk0/j1k0.'))).toBe(true)
    expect(keys.some((k) => /^c\w+\.rk0\/j0/.test(k))).toBe(false)
    expect(keys.some((k) => /^c\w+\.j0k\d\/j1/.test(k))).toBe(false)
    expect(keys.some((k) => /^c\w+\.j0k0\/j0k1/.test(k))).toBe(false)
    expect(shapeSeparation(armShape(r, spec), chassisShape(spec))).toBeGreaterThan(-1e-6)
    expect(r.pose().joints![1]).toBeGreaterThan(0.2)
    expect(worldErrors(r)).toBe(0)
  })

  it('A15 collisionIgnore의 짝은 지나간다', () => {
    const spec = selfSpec({ collisionIgnore: [[-1, 1]] })
    const steps = recordRows()
    const r = new Runner(spec).run(1, () => ({}))
    vi.restoreAllMocks()
    expect(steps.flat().some((k) => k.includes('rk0/j1'))).toBe(false)
    expect(shapeSeparation(armShape(r, spec), chassisShape(spec))).toBeLessThan(-0.01)
  })

  it('A15 1.5 m/s로 달려도 자기 짝 넓은 단계 여유가 기저 속도로 늘지 않는다(2 mm 위에 고정된 몸체는 짝을 만들지 않는다)', () => {
    const base = robotSpec({ start: { x: -1.2, y: 0, yaw: 0 } })
    const lid = joint({
      origin: { position: { x: 0, y: 0, z: 0.2 + 0.002 }, rotation: ZERO },
      limits: { lower: 0, upper: 0.001 },
      colliders: [box({ x: 0, y: 0, z: 0.01 }, { x: 0.1, y: 0.1, z: 0.01 })]
    })
    // 섀시와 바로 붙지 않게 중간 관절(형상 없음)의 자식
    const mid = joint({ limits: { lower: 0, upper: 0.001 } })
    const spec: WorldSpec = {
      ...base,
      joints: [mid, { ...lid, parent: 0 }],
      robot: {
        ...base.robot,
        colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 })]
      }
    }
    const tokens = new Set<string>()
    BodyCollision.manifoldHook = (token) => tokens.add(token)
    const r = new Runner(spec).run(1.2, () => outputs(mecanum(1, 0, 0)))
    BodyCollision.manifoldHook = null
    const speed = r.speed(r.poses.length - 21, r.poses.length - 1)
    expect(speed).toBeGreaterThan(1.3)
    expect([...tokens].filter((t) => t.includes('/j1') || t.startsWith('j1'))).toEqual([])
  })
})

describe('A7 꼭짓점 대 꼭짓점(세계)', () => {
  it('A7 꼭짓점이 아래인 정육면체가 꼭짓점이 위인 고정 정육면체에 떨어져 1 s 동안 침투 증가 < 1e-6 m, gv 점', () => {
    const h = 0.05
    const beta = -Math.atan(1 / Math.SQRT2)
    // 고정 정육면체: R = Ry(β)·Rx(45°)가 (1, 1, 1)/√3을 +z로
    const up = rotationMatrix({ x: Math.PI / 4, y: beta, z: 0 })
    const cube: FieldStructure = {
      ...BIOBUZZ.structures[FLOWER_RED],
      shape: {
        kind: 'box',
        center: { x: 0.5, y: 0, z: 0.2 },
        rotation: { x: Math.PI / 4, y: beta, z: 0 },
        size: { x: 2 * h, y: 2 * h, z: 2 * h }
      }
    }
    const field: FieldSpec = { ...resolveSeason('none'), structures: [cube] }
    // 몸체 정육면체: Rx(π)·up이라 꼭짓점이 아래
    const down = [up[0], up[1], up[2], -up[3], -up[4], -up[5], -up[6], -up[7], -up[8]]
    const top = 0.2 + h * Math.sqrt(3)
    const body = joint({
      origin: { position: { x: 0.5, y: 0, z: top + h * Math.sqrt(3) + 5e-3 }, rotation: ZERO },
      limits: { lower: -0.2, upper: 0.2 },
      colliders: [
        { kind: 'box', center: ZERO, rotation: down, half: { x: h, y: h, z: h }, friction: 0.4 }
      ]
    })
    const spec = fixedSpec([body])
    const references = new Set<string>()
    BodyCollision.manifoldHook = (_, m) => references.add(m.reference)
    const r = new Runner(spec, { field }).run(1, () => ({}))
    BodyCollision.manifoldHook = null
    const pose = new Articulation(spec.joints).bodyPose(0, r.pose().joints ?? [])
    const placed = placeShape(bodyShape(spec.joints[0].colliders![0])!, {
      rotation: pose.rotation,
      origin: { x: pose.origin[0], y: pose.origin[1], z: pose.origin[2] }
    })
    const fixedCube = staticShapes(field).find((s) => s.token === 's0')!.hull!
    expect(shapeSeparation(placed, { kind: 'hull', hull: fixedCube })).toBeGreaterThan(-1e-6)
    expect(references.has('gv')).toBe(true)
    // 멈췄다(떨어지지 않았다)
    expect(r.pose().joints![0]).toBeGreaterThan(-6e-3)
    expect(worldErrors(r)).toBe(0)
  })
})

describe('A17 밀어내지 않음·알림·행 한도', () => {
  it('A17 바닥에 1 cm 겹쳐 시작한 몸체는 자세 그대로이고 collisionOverlap이 없다', () => {
    const block = joint({
      origin: { position: { x: 0.3, y: 0, z: 0 }, rotation: ZERO },
      limits: { lower: -0.2, upper: 0.2 },
      colliders: [box({ x: 0, y: 0, z: 0.01 }, { x: 0.05, y: 0.05, z: 0.02 })]
    })
    const r = new Runner(fixedSpec([block])).run(0.5, () => ({}))
    for (const p of r.poses) expect(Math.abs(p.joints![0])).toBeLessThan(1e-9)
    expect(r.world.drainNotices().filter((n) => n.code === 'collisionOverlap')).toEqual([])
  })

  it('A17 빠른 회전 팔(한 하위 단계에 10 rad/s 가까이 붙는 토크)이 벽에 1 mm 넘게 파고들면 collisionOverlap { body: 0, target: wall:y- }이 한 번', () => {
    // 고정 기저(요 0, 섀시 형상 없음) 로봇. 팔(z 축 회전, 길이 0.35, 반폭 0.02)의 −y 면이 빨강 벽(−y)에서 2.5 mm. 정지에서
    // −150 N·m가 걸려 첫 하위 단계에 ω ≈ 12 rad/s(끝 4 mm/하위 단계)가 붙는데, 넓은 단계 여유는 지난 속도 0의
    // COLLISION_MARGIN 1 mm뿐이라 짝을 놓치고 1 mm 넘게 들어간다(그 뒤로는 막혀 밀어내지 않는다)
    const inner = BIOBUZZ.perimeter.innerHalf
    const arm = joint({
      type: 'revolute',
      axis: { x: 0, y: 0, z: 1 },
      origin: { position: { x: 0, y: 0, z: 0.25 }, rotation: ZERO },
      body: {
        mass: 0.3,
        centerOfMass: { x: 0.175, y: 0, z: 0 },
        inertia: [1e-4, 3e-3, 3e-3, 0, 0, 0]
      },
      spring: { kind: 'constantForce', force: -150 },
      colliders: [box({ x: 0.175, y: 0, z: 0 }, { x: 0.175, y: 0.02, z: 0.02 })]
    })
    const spec = fixedSpec([arm], [], { field: FIELD }, { x: 0, y: -inner + 0.02 + 0.0025, yaw: 0 })
    const r = new Runner(spec).run(0.4, () => ({}))
    const notices = r.world.drainNotices().filter((n) => n.code === 'collisionOverlap')
    expect(notices).toEqual([
      { code: 'collisionOverlap', params: { body: '0', target: 'wall:y-' } }
    ])
  })

  it('A17 행 한도: 섀시가 벽에 닿고 관절 몸체 여섯이 바닥에 놓이면 collisionLimit 한 번, 섀시–벽 짝은 남고 충돌 행 ≤ 28', () => {
    const start = { x: WALL_INNER_HALF - HALF, y: 0, yaw: 0 }
    const feet = Array.from({ length: 6 }, (_, i) =>
      joint({
        origin: { position: { x: -0.15 + 0.06 * i, y: 0.1, z: 0 }, rotation: ZERO },
        limits: { lower: -0.05, upper: 0.1 },
        body: { mass: 0.3, centerOfMass: ZERO, inertia: [1e-4, 1e-4, 1e-4, 0, 0, 0] },
        colliders: [box({ x: 0, y: 0, z: 0.02 }, { x: 0.02, y: 0.02, z: 0.02 })]
      })
    )
    const base = robotSpec({ start }, { joints: feet })
    const spec: WorldSpec = { ...base, robot: { ...base.robot, colliders: [chassisBox(0.2)] } }
    const steps = recordRows()
    const r = new Runner(spec).run(0.3, () => outputs(mecanum(0.5, 0, 0)))
    vi.restoreAllMocks()
    const collisionRows = steps.map((keys) => keys.filter((k) => k.startsWith('c')))
    expect(collisionRows.every((keys) => keys.length <= 28)).toBe(true)
    expect(
      collisionRows.slice(10).every((keys) => keys.some((k) => k.startsWith('cn.rk0/w0.')))
    ).toBe(true)
    const limits = r.world.drainNotices().filter((n) => n.code === 'collisionLimit')
    expect(limits).toEqual([{ code: 'collisionLimit', params: {} }])
  })
})

describe('A18 결정성·행 키', () => {
  // 섀시 상자 + 떨어지는 팔(볼록 상자)이 바닥에 닿고, 로봇이 왼쪽(+y 벽)으로 옆걸음해 막힌다
  function scene(): WorldSpec {
    const base = spec3d({ x: INNER - HALF - 0.15, y: INNER - HALF - 0.2, yaw: 0.3 })
    const arm = joint({
      type: 'revolute',
      axis: { x: 0, y: 1, z: 0 },
      origin: { position: { x: 0.1, y: 0, z: 0.3 }, rotation: ZERO },
      limits: { lower: -2, upper: 2 },
      body: {
        mass: 0.5,
        centerOfMass: { x: 0.15, y: 0, z: 0 },
        inertia: [1e-4, 4e-3, 4e-3, 0, 0, 0]
      },
      friction: { coulomb: 0.01, viscous: 0 },
      colliders: [convexBox({ x: 0.15, y: 0, z: 0 }, { x: 0.15, y: 0.02, z: 0.02 })]
    })
    return { ...base, joints: [arm] }
  }
  const run = (): { text: string; steps: string[][] } => {
    const steps = recordRows()
    const r = new Runner(scene()).run(1.5, (k) => outputs(mecanum(0, k < 150 ? -0.6 : 0, 0)))
    vi.restoreAllMocks()
    return { text: JSON.stringify([r.inputs, r.poses, r.world.drainNotices()]), steps }
  }

  it('A18 같은 세계 두 번 바이트 같음, 행 키가 하위 단계마다 유일하고 새 키는 c로 시작한다(지금 접두어 w·n·t·f·l·u와 다름)', () => {
    const first = staticShapes(BIOBUZZ)
    const snapshot = structuredClone(first)
    const a = run()
    // 다른 세계를 사이에 만든다
    new Runner(robotSpec({}, { joints: [] })).run(0.05, () => outputs(mecanum(0.2, 0, 0)))
    const b = run()
    expect(b.text).toBe(a.text)
    const collisionKeys = a.steps.flat().filter((k) => k.startsWith('c'))
    expect(collisionKeys.length).toBeGreaterThan(100)
    for (const keys of a.steps) expect(new Set(keys).size).toBe(keys.length)
    for (const key of collisionKeys) expect(/^(cn|ct1|ct2|cw)\./.test(key)).toBe(true)
    // 3D 섀시라 평면 벽 행(n·t + 벽 이름)은 없고 섀시–벽은 c 행이다
    expect(a.steps.flat().some((k) => /^[nt][xy][+-]/.test(k))).toBe(false)
    expect(a.steps.flat().some((k) => k.startsWith('cn.rk0/w'))).toBe(true)
    expect(a.steps.flat().some((k) => k.startsWith('cn.j0k0/fl.'))).toBe(true)
    // 얼린 정적 형상은 처음 값 그대로
    expect(staticShapes(BIOBUZZ)).toBe(first)
    expect(staticShapes(BIOBUZZ)).toEqual(snapshot)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first[0].hull!.vertices[0])).toBe(true)
    expect(Object.isFrozen(first[0].hull!.faces)).toBe(true)
  })
})

describe('A24 던짐 복구', () => {
  it('A24 rows가 던지면 worldError 한 번, 그 하위 단계 속도 0, PhysicsWorld.step이 끝까지 돈다', () => {
    const arm = joint({
      type: 'revolute',
      axis: { x: 0, y: 1, z: 0 },
      origin: { position: { x: 0.2, y: 0, z: 0.3 }, rotation: ZERO },
      limits: { lower: -2, upper: 2 },
      body: {
        mass: 0.5,
        centerOfMass: { x: 0.15, y: 0, z: 0 },
        inertia: [1e-4, 4e-3, 4e-3, 0, 0, 0]
      },
      colliders: [convexBox({ x: 0.15, y: 0, z: 0 }, { x: 0.15, y: 0.02, z: 0.02 })]
    })
    const r = new Runner(fixedSpec([arm]))
    r.run(0.1, () => ({}))
    // 다음 틱(하위 단계 다섯)은 모두 던진다
    const original = BodyCollision.prototype.rows
    let calls = 0
    vi.spyOn(BodyCollision.prototype, 'rows').mockImplementation(function (
      this: BodyCollision,
      ...args: Parameters<BodyCollision['rows']>
    ) {
      calls++
      if (calls <= 5) throw new Error('degenerate hull')
      return original.apply(this, args)
    })
    const before = r.pose().joints![0]
    expect(() => r.run(DT, () => ({}))).not.toThrow()
    const art = (r.world as unknown as { articulation: Articulation }).articulation
    expect(r.pose().joints![0]).toBe(before)
    expect(art.v.every((x) => x === 0)).toBe(true)
    r.run(0.2, () => ({}))
    vi.restoreAllMocks()
    expect(calls).toBeGreaterThan(5)
    expect(r.pose().joints![0]).toBeGreaterThan(before)
    expect(r.world.drainNotices().filter((n) => n.code === 'worldError')).toEqual([
      { code: 'worldError', params: { detail: 'degenerate hull' } }
    ])
  })
})

describe('A25 마찰 하중 상한', () => {
  // 부유 기저(메카넘, 13.6 kg) + 리프트(z 직선, 모터 둘, 아래 발 상자). 발이 바닥 위 5 mm에서 내려와 누른다
  function pressSpec(): WorldSpec {
    const base = robotSpec({ start: { x: -0.8, y: 0, yaw: 0 } })
    const lift = joint({
      origin: { position: { x: 0.1, y: 0, z: 0.1 }, rotation: ZERO },
      limits: { lower: -0.05, upper: 0.1 },
      body: { mass: 0.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
      drive: {
        kind: 'motor',
        devices: ['liftA', 'liftB'],
        ratio: 0.112 / (2 * Math.PI),
        params: LIFT_PARAMS,
        rigging: { kind: 'direct' }
      },
      colliders: [box({ x: 0, y: 0, z: -0.075 }, { x: 0.03, y: 0.03, z: 0.02 })]
    })
    return {
      ...base,
      motors: [...base.motors, motorSpec('liftA'), motorSpec('liftB')],
      joints: [lift]
    }
  }
  const weightOf = (spec: WorldSpec): number =>
    (spec.robot.body.mass + spec.joints.reduce((s, j) => s + j.body.mass, 0)) * 9.80665

  function press(power: number): {
    r: Runner
    caps: number[]
    worstRatio: number
    normalOverW: number
    liftAt: number | null
  } {
    const spec = pressSpec()
    const weight = weightOf(spec)
    const caps: number[] = []
    let worstRatio = 0
    let normalOverW = 0
    const original = Articulation.prototype.step
    vi.spyOn(Articulation.prototype, 'step').mockImplementation(function (
      this: Articulation,
      h: number,
      drive: Parameters<Articulation['step']>[1],
      contacts?: ContactSet
    ) {
      const result = original.call(this, h, drive, contacts)
      let normal = 0
      for (const row of contacts?.rows ?? []) {
        if (!row.key.includes('j0k0/fl')) continue
        if (row.key.startsWith('cn.')) normal += this.contactImpulse(row.key)
        if (row.key.startsWith('ct1.') || row.key.startsWith('ct2.')) {
          const f = row.friction as { mu: number; cap?: number }
          caps.push((f.cap ?? Infinity) / (h * weight))
          worstRatio = Math.max(
            worstRatio,
            Math.abs(this.contactImpulse(row.key)) / (f.mu * h * weight)
          )
        }
      }
      normalOverW = Math.max(normalOverW, normal / (h * weight))
      return result
    })
    const r = new Runner(spec)
    let liftAt: number | null = null
    for (let k = 0; k < 300; k++) {
      const pressing = k >= 40
      r.run(DT, () => ({
        ...outputs(mecanum(k >= 100 ? 1 : 0, 0, 0)),
        liftA: motorOut(pressing ? power : 0, { zeroPower: 'FLOAT' }),
        liftB: motorOut(pressing ? power : 0, { zeroPower: 'FLOAT' })
      }))
      if (r.world.drainNotices().some((n) => n.code === 'collisionLift') && liftAt === null)
        liftAt = (k + 1) * DT
    }
    vi.restoreAllMocks()
    return { r, caps, worstRatio, normalOverW, liftAt }
  }

  it('A25 모터 둘로 발을 바닥에 누르면 마찰 상자 ≤ μ·h·W, 로봇이 붙들리지 않고, collisionLift 한 번(0.1 s 뒤)', () => {
    const { r, caps, worstRatio, normalOverW, liftAt } = press(-1)
    // 누르는 힘이 로봇 무게를 넘는다(상한이 걸리는 장면)
    expect(normalOverW).toBeGreaterThan(1.5)
    expect(caps.length).toBeGreaterThan(100)
    for (const cap of caps) expect(Math.abs(cap - 1)).toBeLessThan(1e-12)
    expect(worstRatio).toBeLessThan(1 + 1e-9)
    // 누르는 동안(0.5 s부터) 앞으로 간다: 발 마찰 ≤ μ·W라 바퀴 견인을 다 막지 못한다
    const x0 = r.poses[99].x
    expect(r.pose().x - x0).toBeGreaterThan(0.05)
    // 누르기 시작(0.2 s) 뒤 내려오고(5 mm) 0.1 s 넘게 눌러야 알린다
    expect(liftAt).not.toBeNull()
    expect(liftAt!).toBeGreaterThan(0.2 + 0.1)
  })

  it('A25 누르지 않으면(발이 제 무게로 놓임) collisionLift가 없다', () => {
    const { liftAt, normalOverW } = press(0)
    expect(normalOverW).toBeLessThan(1)
    expect(liftAt).toBeNull()
  })
})

describe('A16 섀시 3D 경로: 3c·4ab 벽 성질(구조물 없는 BIOBUZZ 반폭)', () => {
  // worldField.test.ts '4ab BIOBUZZ 반폭 벽'의 A15 시험을 섀시 상자 충돌체로
  const options = { field: { ...BIOBUZZ, structures: [] } }
  const touching = { x: INNER - HALF, y: 0, yaw: 0 }
  const POD = {
    device: 'par',
    position: { x: 0, y: 0.1 },
    measures: 'forward' as const,
    reversed: false,
    ticksPerMeter: 2000
  }

  it('A16 벽 밀기: 침투 없음·blocked, 전출력이면 헛돌아 바퀴 엔코더가 늘고 데드휠은 0', () => {
    const r = new Runner(spec3d(touching, {}, { deadWheels: [POD] }), options).run(0.5, () =>
      outputs(mecanum(1, 0.3, 0))
    )
    const ticks = r.value('fl', 'position')
    r.run(0.5, () => outputs(mecanum(1, 0.3, 0)))
    expect(Math.abs(r.value('fl', 'position') - ticks)).toBeGreaterThan(500)
    expect(r.value('par', 'position')).toBe(0)
    expect(wallPenetration(r.poses)).toBeLessThan(1e-6)
    expect(r.poses.slice(5).every((p) => p.blocked)).toBe(true)
    expect(worldErrors(r)).toBe(0)
  })

  it('A16 걸친 시작: 꼭짓점이 1 cm 침투한 채 정지하면 자세가 1e-9 안 그대로이고, 밀어도 더 들어가지 않고, 물러나면 빠져나간다', () => {
    const yaw = 0.1
    const reach = HALF * (Math.cos(yaw) + Math.sin(yaw))
    const start = { x: INNER + 0.01 - reach, y: 0.3, yaw }
    const r = new Runner(spec3d(start), options).run(1, () => outputs({}))
    const pose = r.pose()
    expect(Math.abs(pose.x - start.x)).toBeLessThan(1e-9)
    expect(Math.abs(pose.y - start.y)).toBeLessThan(1e-9)
    expect(Math.abs(pose.yaw - start.yaw)).toBeLessThan(1e-9)
    r.run(0.5, () => outputs(mecanum(0.5, 0, 0)))
    expect(wallPenetration(r.poses)).toBeLessThan(0.01 + 1e-6)
    r.run(0.5, () => outputs(mecanum(-0.5, 0, 0)))
    expect(wallPenetration([r.pose()])).toBe(0)
    expect(worldErrors(r)).toBe(0)
  })
})
