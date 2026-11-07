import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { Articulation, type ContactSet } from './articulation'
import {
  HALF,
  HUB_SIGN,
  ideal,
  mecanum,
  outputs,
  perRad,
  RADIUS,
  robotSpec,
  Runner,
  TAG,
  TICK,
  ZERO,
  type Powers,
  type Robot
} from './driveTestkit'
import {
  circlePolygonSeparation,
  placeFootprint,
  polygonSeparation,
  solidFootprints
} from './seasons/fieldGeometry'
import type { FieldSpec, FieldStructure } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { presetWallFrame, snapRobotToStart } from './seasons/startPose'
import { TEST_ROBOT_HEIGHT, testMotorParams } from './testkit'
import { WALL_FRICTION } from './wheelData'
import type { PhysicsWorldOptions } from './world'
import type { Pose2, SimJointSpec, Vec2, WorldSpec } from './worldSpec'

// 4ab 고정 경기 요소 접촉의 세계 시험(spec-4ab §4 A의 A2–A4·A6–A12·A14·A15·A17). 기준 로봇은 driveTestkit(18 in 정사각
// 메카넘, 13.6 kg), 시즌은 BIOBUZZ(spec.field.season)다. 침투는 fieldGeometry의 SAT 분리 거리로 잰다.

const BIOBUZZ = resolveSeason('biobuzz')
const INNER = BIOBUZZ.perimeter.innerHalf
const DT = TICK / 1e9
const H18 = TEST_ROBOT_HEIGHT
// R105.A 최대 높이 29 in
const H29 = 0.7366
const FIELD: WorldSpec['field'] = { season: 'biobuzz', hiveTipped: [false, false] }
const FOOTPRINT: Vec2[] = robotSpec().robot.footprint

// 구조물 순번(spec-4ab §1.4 표)
const FOOT_BAR_RED = 0
const FOOT_BAR_BLUE = 1
const LEG_PX_PY = 2
const LEG_MX_PY = 3
const LEG_MX_MY = 4
const FLOWER_MX = 9
const FLOWER_PX = 10
const FLOWER_RED = 11
const FLOWER_BLUE = 12

function fieldSpec(start: Pose2, robot: Robot = {}, change: Partial<WorldSpec> = {}): WorldSpec {
  const spec = robotSpec({ ...robot, start }, { field: FIELD, ...change })
  return change.robot ? spec : { ...spec, robot: { ...spec.robot } }
}

// 높이 H의 solid 구조물 단면(다각형)
function hull(index: number, height = H18): Vec2[] {
  const solid = solidFootprints(BIOBUZZ, height).find((s) => s.index === index)
  if (!solid || solid.kind !== 'polygon') throw new Error(`no hull ${index}`)
  return solid.points
}

// 자세의 외곽과 구조물의 분리 거리(음수면 침투 깊이)
const separation = (pose: Pose2, index: number, height = H18): number =>
  polygonSeparation(placeFootprint(FOOTPRINT, pose), hull(index, height))
// 자세열의 최대 침투(m, 0 이상)
const worstPenetration = (poses: readonly Pose2[], index: number, height = H18): number =>
  Math.max(0, ...poses.map((p) => -separation(p, index, height)))
// 외곽 꼭짓점의 최대 벽 침투(m, 0 이상)
function wallPenetration(poses: readonly Pose2[], inner = INNER): number {
  let worst = 0
  for (const p of poses)
    for (const v of placeFootprint(FOOTPRINT, p))
      worst = Math.max(worst, Math.abs(v.x) - inner, Math.abs(v.y) - inner)
  return worst
}

// 요 yaw의 자세를 방향 d(필드 각)로 옮겨 구조물과의 분리 거리가 gap이 되는 자세(이분법, from은 충분히 떨어진 자세)
function approach(index: number, from: Pose2, direction: number, gap: number, height = H18): Pose2 {
  const at = (t: number): Pose2 => ({
    x: from.x + t * Math.cos(direction),
    y: from.y + t * Math.sin(direction),
    yaw: from.yaw
  })
  expect(separation(at(0), index, height)).toBeGreaterThan(gap)
  // 얇은 구조물을 건너뛰지 않게 1 mm씩 나아가 처음 넘는 곳을 찾고 그 사이를 나눈다
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

// 필드 방향 direction(각)으로 가는 메카넘 명령(로봇 요 yaw, 바퀴 power 최대 |power|), 회전 turn(gm0 rx, 시계 +)
function toward(yaw: number, direction: number, power = 1, turn = 0): Powers {
  const a = direction - yaw
  const f = Math.cos(a)
  const left = Math.sin(a)
  const scale = power / Math.max(Math.abs(f) + Math.abs(left), 1e-12)
  return mecanum(f * scale, -left * scale, turn)
}

// Articulation.step에 들어간 밖의 행(하위 단계마다)을 모은다
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

// 구조물 법선 행 키(ns<i>.…)
const structureKeys = (keys: readonly string[], index?: number): string[] =>
  keys.filter((k) => (index === undefined ? /^ns\d/.test(k) : k.startsWith(`ns${index}.`)))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('4ab 구조물 접촉: 벽을 따라 FLOWER로', () => {
  // A3: 벽에 간격 0으로 붙은 18 in 로봇이 벽을 따라 FLOWER 옆면으로 간다. 프리셋 구간 끝이 FLOWER 옆면이라(redWallCenter의 +X
  // 끝 0.51867 = FLOWER <3>의 −X 면) 구간 끝 5 cm 앞에 스냅해 그쪽으로 몬다. 행 법선은 FLOWER 옆면(±along)이나 그 면을 보는
  // 로봇 면이고, FLOWER의 벽 쪽 면이나 로봇의 벽 쪽 면이 아니다(spec-4ab §7 ux §7.1을 받지 않은 근거의 회귀 시험).
  // 처음 닿을 때는 면 대 면이라 구조물 면이 기준이다(특징 q<면>.r<k>). 옆면 끝(벽 쪽 0.126 m)만 닿아 로봇이 돌면 FLOWER
  // 모서리가 로봇 면을 찌르므로 기준이 로봇 면(p<면>.c<k>)으로 바뀐다(기하가 맞는 기준, 명세 표는 로봇이 돌지 않는 경우만 적음).
  type Case = {
    preset: string
    end: 'lo' | 'hi'
    direction: number
    flower: number
    // FLOWER 껍질에서 로봇을 보는 면(반시계, (x0, y0)부터: 면 0 −Y, 1 +X, 2 +Y, 3 −X)
    face: number
  }
  const CASES: Case[] = [
    // FLOWER <3>(빨강 벽)
    { preset: 'redWallCenter', end: 'hi', direction: 0, flower: FLOWER_RED, face: 3 },
    { preset: 'redWallAudience', end: 'lo', direction: Math.PI, flower: FLOWER_RED, face: 1 },
    // FLOWER <4>(파랑 벽): redWallCenter의 Rz(π)
    { preset: 'blueWallCenter', end: 'lo', direction: Math.PI, flower: FLOWER_BLUE, face: 1 },
    // FLOWER <1>(−X 벽, Y−): scoringWallCenter의 −Y 끝 −0.51867이 +Y 면
    {
      preset: 'scoringWallCenter',
      end: 'lo',
      direction: -Math.PI / 2,
      flower: FLOWER_MX,
      face: 2
    },
    // FLOWER <2>(+X 벽, Y+): scoringWallCenter의 Rz(π)
    {
      preset: 'audienceWallCenter',
      end: 'hi',
      direction: Math.PI / 2,
      flower: FLOWER_PX,
      face: 0
    }
  ]

  function run(c: Case, slant: number): { start: Pose2; r: Runner; steps: string[][] } {
    const preset = BIOBUZZ.startPresets.find((p) => p.key === c.preset)
    if (!preset) throw new Error(c.preset)
    const end = c.end === 'hi' ? preset.along[1] - HALF - 0.05 : preset.along[0] + HALF + 0.05
    const snap = snapRobotToStart(FOOTPRINT, preset, INNER, end)
    if (!snap.ok) throw new Error('tooWide')
    const start = snap.pose
    expect(separation(start, c.flower)).toBeCloseTo(0.05, 9)
    // 벽에 간격 0으로 붙었다
    expect(Math.abs(wallPenetration([start]))).toBeLessThan(1e-12)
    // 30° 판은 벽 쪽(벽 바깥 법선 쪽)으로 30° 기울여 민다: 벽을 밀며 미끄러져 FLOWER로
    const { normal } = presetWallFrame(preset.wall)
    const side = Math.sign(Math.cos(c.direction) * normal.y - Math.sin(c.direction) * normal.x)
    const direction = c.direction + slant * side
    const steps = recordRows()
    const r = new Runner(fieldSpec(start)).run(3, () => outputs(toward(start.yaw, direction, 1)))
    vi.restoreAllMocks()
    return { start, r, steps }
  }

  for (const slant of [0, Math.PI / 6])
    it(`A3 벽에 붙어 FLOWER로 power 1, 3 s(벽 쪽 ${Math.round((slant * 180) / Math.PI)}°): 침투 없음, 법선은 FLOWER 옆면, blocked, 네 FLOWER 대칭`, () => {
      const ends: Pose2[] = []
      for (const c of CASES) {
        const { start, r, steps } = run(c, slant)
        const all = [start, ...r.poses]
        expect(worstPenetration(all, c.flower)).toBeLessThan(1e-6)
        expect(wallPenetration(all)).toBeLessThan(1e-6)
        expect(r.pose().blocked).toBe(true)
        // 로봇에서 FLOWER를 보는 면: 시작 요에서 바깥 법선이 진행 방향인 면(외곽 반시계 면 j의 로봇 법선 각 π/2·(j + 1))
        const robotFace = [0, 1, 2, 3].find(
          (j) => Math.cos(start.yaw + (Math.PI / 2) * (j + 1) - c.direction) > 0.99
        )
        const pattern = new RegExp(`^ns${c.flower}\\.(q${c.face}\\.r\\d|p${robotFace}\\.c\\d)$`)
        const touched = steps.map((keys) => structureKeys(keys)).filter((keys) => keys.length > 0)
        expect(touched.length).toBeGreaterThan(0)
        // 처음 닿을 때는 면 대 면: 구조물 면이 기준
        for (const key of touched[0])
          expect(key).toMatch(new RegExp(`^ns${c.flower}\\.q${c.face}\\.r\\d$`))
        for (const keys of touched) for (const key of keys) expect(key).toMatch(pattern)
        ends.push(r.pose())
      }
      // Rz(π) 짝(빨강 ↔ 파랑, scoring ↔ audience)은 끝 자세도 대칭이다. 1e-8: FLOWER 모서리를 중심으로 도는 동안 기준 면 행과
      // 참 분리 축 보충 행(polygonContact)이 거의 같은 자리·법선에 함께 들어가, 짝마다 다른 껍질 꼭짓점 순서·요의 반올림이
      // 정칙화한 LCP의 힘 나눔에서 1e-9 m 단위로 커진다(3 s 뒤 scoring ↔ audience 1.3e-9)
      const mirrored = (a: Pose2, b: Pose2): void => {
        expect(Math.abs(a.x + b.x)).toBeLessThan(1e-8)
        expect(Math.abs(a.y + b.y)).toBeLessThan(1e-8)
        expect(Math.abs(Math.sin(a.yaw - b.yaw))).toBeLessThan(1e-8)
        expect(Math.cos(a.yaw - b.yaw)).toBeLessThan(0)
      }
      mirrored(ends[0], ends[2])
      mirrored(ends[3], ends[4])
    })
})

// 외곽을 요 yaw로 두고 방향 yaw로 갈 때 구조물 껍질에서 가장 먼저 닿는 꼭짓점을 앞면 가운데에 둔 먼 자세
function facing(index: number, yaw: number, lateral = 0, height = H18): Pose2 {
  const d = { x: Math.cos(yaw), y: Math.sin(yaw) }
  const points = hull(index, height)
  let v = points[0]
  for (const p of points) if (p.x * d.x + p.y * d.y < v.x * d.x + v.y * d.y) v = p
  // 앞면 가운데 = 원점 + HALF·d, 옆으로 lateral(앞면 방향 ẑ × d)
  return {
    x: v.x - (HALF + 0.5) * d.x - lateral * -d.y,
    y: v.y - (HALF + 0.5) * d.y - lateral * d.x,
    yaw
  }
}

describe('4ab 구조물 접촉: 면·모서리·밀기', () => {
  it('A4 요 20° 로봇의 앞면이 다리 껍질 꼭짓점·FLOWER 모서리로 밀면 기준은 로봇 앞면(특징 p3.c<k>), 침투가 늘지 않는다', () => {
    const DEG = Math.PI / 180
    // 다리 (−X,−Y)는 필드 안쪽에서(요 −70°), FLOWER <1>은 +X 쪽에서(요 200°)
    for (const [index, yaw] of [
      [LEG_MX_MY, -70 * DEG],
      [FLOWER_MX, 200 * DEG],
      [LEG_PX_PY, 110 * DEG]
    ]) {
      const start = approach(index, facing(index, yaw), yaw, 0.03)
      const steps = recordRows()
      const r = new Runner(fieldSpec(start)).run(1, () => outputs(mecanum(0.5, 0, 0)))
      vi.restoreAllMocks()
      expect(worstPenetration([start, ...r.poses], index)).toBeLessThan(1e-6)
      const touched = steps.map((keys) => structureKeys(keys, index)).filter((k) => k.length > 0)
      expect(touched.length).toBeGreaterThan(20)
      for (const keys of touched)
        for (const key of keys) expect(key).toMatch(new RegExp(`^ns${index}\\.p3\\.c\\d$`))
      expect(r.pose().blocked).toBe(true)
    }
  })

  it('A6 발판 막대를 Y로 power 1, 5 s: 침투가 늘지 않고 자세가 유계이며 바퀴가 헛돈다(엔코더 거리 > 데드휠 거리)', () => {
    const start = approach(FOOT_BAR_RED, { x: 0, y: -1.3, yaw: Math.PI / 2 }, Math.PI / 2, 0.03)
    const pod = {
      device: 'par',
      position: { x: 0, y: 0.1 },
      measures: 'forward' as const,
      reversed: false,
      ticksPerMeter: 2000
    }
    const r = new Runner(fieldSpec(start, {}, { deadWheels: [pod] })).run(5, () =>
      outputs(mecanum(1, 0, 0))
    )
    expect(worstPenetration([start, ...r.poses], FOOT_BAR_RED)).toBeLessThan(1e-6)
    for (const p of r.poses) {
      expect(Math.abs(p.x)).toBeLessThan(1e-6)
      expect(Math.abs(p.yaw - Math.PI / 2)).toBeLessThan(1e-6)
      expect(p.y).toBeLessThan(start.y + 0.03 + 1e-6)
    }
    const podMeters = Math.abs(r.value('par', 'position')) / 2000
    expect(podMeters).toBeGreaterThan(0.029)
    expect(podMeters).toBeLessThan(0.031)
    const rolled = (Math.abs(r.value('fl', 'position')) / perRad(19.2)) * RADIUS
    expect(rolled).toBeGreaterThan(podMeters + 1)
    expect(r.poses.slice(-100).every((p) => p.blocked)).toBe(true)
  })

  it('A7 FLOWER 면을 면 법선 기준 15°로 밀면 미끄러지지 않고(tan 15° < μ 0.4), 30°로 밀면 면을 따라 미끄러진다', () => {
    // FLOWER <3>의 필드 쪽 면(+Y, y = −1.667)에 앞면을 가운데로 대고(간격 0) 민다. 바퀴 μ 2라 바퀴는 헛돌지 않고, 막힌 메카넘의
    // 앞·옆 힘 비 = 명령 비(3c T6과 같은 방법). 막힌 바퀴 좌표의 정지 마찰 상자(기어 손실·굴림 저항)와 옆걸음의 롤러 저항이
    // 옆 힘을 먹지 않게 이상 모터 판(효율 1, 마찰 0)과 굴림·롤러 저항 0을 쓴다(경계 tan 30° = 0.577이 μ 0.4에 가까워 T6처럼
    // 넉넉히 넘길 수 없다. 기본 값이면 롤러 쿨롱이 남는 옆 힘 대부분을 먹어 수 mm만 미끄러진다)
    const flower = hull(FLOWER_RED)
    const faceY = Math.max(...flower.map((p) => p.y))
    const centerX = (Math.min(...flower.map((p) => p.x)) + Math.max(...flower.map((p) => p.x))) / 2
    const start = { x: centerX, y: faceY + HALF, yaw: -Math.PI / 2 }
    expect(Math.abs(separation(start, FLOWER_RED))).toBeLessThan(1e-12)
    const push = (angle: number): { dx: number; blocked: boolean } => {
      const r = new Runner(fieldSpec(start, { friction: 2, params: ideal }), {
        rollingResistance: 0,
        rollerViscous: 0,
        rollerCoulomb: 0
      }).run(0.6, () => outputs(toward(start.yaw, -Math.PI / 2 + angle, 0.6)))
      expect(worstPenetration([start, ...r.poses], FLOWER_RED)).toBeLessThan(1e-6)
      return { dx: r.pose().x - start.x, blocked: r.poses.slice(5).every((p) => p.blocked) }
    }
    const DEG = Math.PI / 180
    const mu = BIOBUZZ.structures[FLOWER_RED].friction
    // [가정: 구조물 접선 μ] 3c 벽 마찰과 같은 값(spec-4ab §1.4)
    expect(mu).toBe(WALL_FRICTION)
    expect(Math.tan(15 * DEG)).toBeLessThan(mu)
    const stick = push(15 * DEG)
    expect(Math.abs(stick.dx)).toBeLessThan(1e-6)
    expect(stick.blocked).toBe(true)
    expect(Math.tan(30 * DEG)).toBeGreaterThan(mu)
    const slide = push(30 * DEG)
    expect(slide.dx).toBeGreaterThan(0.02)
    expect(slide.blocked).toBe(true)
  })

  it('A8 blocked: 구조물에 닿아 미는 틱에 true, 떨어진 틱에 false(벽과 같은 규칙)', () => {
    const start = approach(FOOT_BAR_RED, { x: 0, y: -1.3, yaw: Math.PI / 2 }, Math.PI / 2, 0.05)
    const r = new Runner(fieldSpec(start))
    r.run(0.03, () => outputs(mecanum(0.4, 0, 0)))
    // 닿기 전
    expect(r.poses.every((p) => !p.blocked)).toBe(true)
    r.run(1, () => outputs(mecanum(0.4, 0, 0)))
    const touching = r.poses.findIndex((p) => p.blocked)
    expect(touching).toBeGreaterThan(0)
    expect(r.poses.slice(touching + 5).every((p) => p.blocked)).toBe(true)
    r.run(1, () => outputs(mecanum(-0.4, 0, 0)))
    expect(r.poses.slice(-150).every((p) => !p.blocked)).toBe(true)
    expect(separation(r.pose(), FOOT_BAR_RED)).toBeGreaterThan(0.1)
  })
})

describe('4ab 구조물 접촉: 걸친 시작', () => {
  // 다리 (−X,−Y) 껍질에 −X 쪽에서 1 cm 걸친 자세(요 0, 발판 막대에 닿지 않는 높이 y −0.3)
  const overlapped = (): Pose2 => approach(LEG_MX_MY, { x: -1.2, y: -0.3, yaw: 0 }, 0, -0.01)

  it('A9 다리 껍질에 1 cm 걸쳐 시작해 정지하면 자세가 1e-9 안 그대로다(밀어내지 않음)', () => {
    const start = overlapped()
    expect(separation(start, LEG_MX_MY)).toBeCloseTo(-0.01, 9)
    const r = new Runner(fieldSpec(start)).run(1, () => outputs({}))
    for (const p of r.poses) {
      expect(Math.abs(p.x - start.x)).toBeLessThan(1e-9)
      expect(Math.abs(p.y - start.y)).toBeLessThan(1e-9)
      expect(Math.abs(p.yaw - start.yaw)).toBeLessThan(1e-9)
    }
  })

  it('A9b 걸친 채 바깥으로 몰면 막힘 없이 빠져나간다(빠져나가는 동안 blocked false)', () => {
    const start = overlapped()
    const r = new Runner(fieldSpec(start)).run(0.5, () => outputs(mecanum(-0.5, 0, 0)))
    expect(r.poses.every((p) => !p.blocked)).toBe(true)
    expect(separation(r.pose(), LEG_MX_MY)).toBeGreaterThan(0.05)
  })

  it('A9c 걸친 채 안쪽으로 몰면 침투가 늘지 않는다(1e-6 m)', () => {
    const start = overlapped()
    const r = new Runner(fieldSpec(start)).run(1, () => outputs(mecanum(0.7, 0, 0)))
    expect(worstPenetration(r.poses, LEG_MX_MY)).toBeLessThan(0.01 + 1e-6)
    expect(r.pose().blocked).toBe(true)
  })

  it('A9d 발판 막대를 외곽 가운데에 걸친 시작에서 몰아도 NaN·worldError 없이 자세가 유계다(통과는 허용, 한계)', () => {
    const start = { x: 0, y: BIOBUZZ.structures[FOOT_BAR_RED].shape.center.y, yaw: 0 }
    const r = new Runner(fieldSpec(start))
    r.run(1, () => outputs(mecanum(1, 0, 0)))
    r.run(1, () => outputs(mecanum(0, 1, 0)))
    r.run(1, () => outputs(mecanum(0, -1, 0)))
    r.run(1, () => outputs(mecanum(0, 0, 1)))
    r.run(1, () => outputs(mecanum(-0.7, 0.7, 0.3)))
    const notices = r.world.drainNotices()
    expect(notices.some((n) => n.code === 'worldError')).toBe(false)
    for (const p of r.poses) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.yaw)).toBe(true)
      expect(Math.abs(p.x)).toBeLessThan(INNER)
      expect(Math.abs(p.y)).toBeLessThan(INNER)
    }
    expect(JSON.stringify(r.inputs)).not.toContain('null')
  })
})

describe('4ab 구조물 접촉: HIVE 아래', () => {
  // 필드 X를 따라 y에서 가는 18 in(또는 높이 height) 로봇의 구조물 행과 blocked
  function pass(y: number, height = H18): { steps: string[][]; r: Runner } {
    const start = { x: -1.3, y, yaw: 0 }
    const spec = fieldSpec(start)
    const steps = recordRows()
    const r = new Runner({ ...spec, robot: { ...spec.robot, height } }).run(3.5, () =>
      outputs(mecanum(0.5, 0, 0))
    )
    vi.restoreAllMocks()
    return { steps, r }
  }

  it('A10 18 in 로봇이 y = 0을 따라 HIVE 아래를 지나가면 구조물 행이 없고 blocked false다. 29 in 로봇도 위 막대·로고 판(비고체)에 막히지 않는다', () => {
    for (const height of [H18, H29]) {
      const { steps, r } = pass(0, height)
      expect(r.pose().x).toBeGreaterThan(0.75)
      expect(steps.flatMap((keys) => structureKeys(keys))).toEqual([])
      expect(r.poses.every((p) => !p.blocked)).toBe(true)
    }
  })

  it('A10b 통로 경계: y = 0.2(다리 껍질까지 3.8 cm)면 행이 없고, y = 0.25면 다리에 막힌다', () => {
    // 외곽 모서리 |y| 0.4286, 다리 껍질 안쪽 |Y| 0.46682(H 18 in, spec-4ab §1.10 표)
    expect(0.2 + HALF).toBeCloseTo(0.4286, 12)
    const clear = pass(0.2)
    expect(clear.r.pose().x).toBeGreaterThan(0.75)
    expect(clear.steps.flatMap((keys) => structureKeys(keys))).toEqual([])
    expect(clear.r.poses.every((p) => !p.blocked)).toBe(true)
    const hit = pass(0.25)
    expect(hit.r.poses.some((p) => p.blocked)).toBe(true)
    const keys = hit.steps.flatMap((k) => structureKeys(k))
    expect(keys.length).toBeGreaterThan(0)
    // 다리 아래쪽 끝(1 cm 남짓)만 걸려 비스듬한 변이 로봇을 −Y로 밀어 비켜 가게 할 수 있다(다리 둘 모두에 스칠 수 있음)
    expect(keys.some((k) => k.startsWith(`ns${LEG_MX_PY}.`))).toBe(true)
    expect(
      keys.every((k) => k.startsWith(`ns${LEG_MX_PY}.`) || k.startsWith(`ns${LEG_PX_PY}.`))
    ).toBe(true)
    for (const index of [LEG_MX_PY, LEG_PX_PY])
      expect(worstPenetration(hit.r.poses, index)).toBeLessThan(1e-6)
    expect(hit.r.poses.filter((p) => p.blocked).length).toBeGreaterThan(50)
  })

  it('A10c 다리 껍질에서 2 cm 떨어져 제자리 전출력 회전 2 s: 행이 생기고(넓은 단계 |ω|·r_max) 침투가 늘지 않는다', () => {
    // 다리 꼭대기(안쪽 끝)를 앞면 가운데 아래에 두고 필드 안쪽에서 −Y로 다가간 자세: 회전하는 모서리 반지름 0.323 m가 0.249 m
    // 떨어진 다리에는 닿고 발판 막대(y −0.578)에는 닿지 않는다
    const top = hull(LEG_MX_MY).reduce((a, b) => (b.y > a.y ? b : a))
    const start = approach(LEG_MX_MY, { x: top.x, y: 0, yaw: -Math.PI / 2 }, -Math.PI / 2, 0.02)
    const steps = recordRows()
    const r = new Runner(fieldSpec(start)).run(2, () => outputs(mecanum(0, 0, 1)))
    vi.restoreAllMocks()
    expect(steps.flatMap((k) => structureKeys(k, LEG_MX_MY)).length).toBeGreaterThan(0)
    const all = [start, ...r.poses]
    // 도는 로봇 면이 고정 꼭짓점을 파고드는 2차 항은 곡률 보정이 막는다(fieldContact.ts)
    for (const index of [FOOT_BAR_RED, LEG_MX_MY])
      expect(worstPenetration(all, index)).toBeLessThan(1e-6)
    expect(r.poses.some((p) => p.blocked)).toBe(true)
  })
})

describe('4ab 구조물 접촉: 원기둥·고정 기저', () => {
  // 시험용 시즌: 'none' 벽 + 세운 원기둥 하나(중심 (0.6, 0), r 0.1, 높이 0.6)
  const cylinder: FieldStructure = {
    ...BIOBUZZ.structures[FLOWER_RED],
    shape: {
      kind: 'cylinder',
      center: { x: 0.6, y: 0, z: 0.3 },
      rotation: ZERO,
      radius: 0.1,
      height: 0.6
    }
  }
  const CYLINDER_FIELD: FieldSpec = { ...resolveSeason('none'), structures: [cylinder] }
  const cylinderOptions: PhysicsWorldOptions = { field: CYLINDER_FIELD }
  const cylinderSeparation = (pose: Pose2): number =>
    circlePolygonSeparation({ x: 0.6, y: 0 }, 0.1, placeFootprint(FOOTPRINT, pose))

  it('A11 원–다각형: 꼭짓점(q0.r<k>)·변(p<j>.c0) 접촉 모두 침투가 늘지 않는다', () => {
    // 꼭짓점: 요 45°면 외곽 꼭짓점 3 (H, −H)이 +X를 본다. 변: 요 0의 앞면(변 3)
    for (const [yaw, pattern] of [
      [Math.PI / 4, /^ns0\.q0\.r3$/],
      [0, /^ns0\.p3\.c0$/]
    ] as const) {
      const reach = yaw === 0 ? HALF : HALF * Math.SQRT2
      const start = { x: 0.6 - 0.1 - reach - 0.03, y: 0, yaw }
      expect(cylinderSeparation(start)).toBeCloseTo(0.03, 9)
      const steps = recordRows()
      const r = new Runner(robotSpec({ start }), cylinderOptions).run(1, () =>
        outputs(toward(yaw, 0, 0.6))
      )
      vi.restoreAllMocks()
      const keys = steps.flatMap((k) => structureKeys(k))
      expect(keys.length).toBeGreaterThan(20)
      for (const key of keys) expect(key).toMatch(pattern)
      expect(Math.max(0, ...r.poses.map((p) => -cylinderSeparation(p)))).toBeLessThan(1e-6)
      expect(r.pose().blocked).toBe(true)
    }
  })

  it('A12 바퀴 없는 로봇(고정 기저)은 구조물과 겹쳐도 행이 없고 자세가 그대로다', () => {
    const start = approach(LEG_MX_MY, { x: -1.2, y: -0.3, yaw: 0 }, 0, -0.05)
    const steps = recordRows()
    const r = new Runner(fieldSpec(start, {}, { wheels: [] })).run(0.5, () =>
      outputs(mecanum(1, 0, 0.5))
    )
    vi.restoreAllMocks()
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.every((keys) => keys.length === 0)).toBe(true)
    for (const p of r.poses) {
      expect(p).toEqual({ x: start.x, y: start.y, yaw: start.yaw, blocked: false })
    }
  })
})

// 리프트(직선 관절 위로, 1.5 kg, 0–0.3 m)를 구동하는 goBILDA 312 모터(worldDrive.test.ts와 같은 기구)
const LIFT_PARAMS = testMotorParams(TAG, 19.2)
function liftJoints(): Pick<WorldSpec, 'motors' | 'joints'> {
  const base = robotSpec()
  const stage: SimJointSpec = {
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
  const arm: SimJointSpec = {
    parent: 1,
    type: 'revolute',
    origin: { position: { x: 0.1, y: 0, z: 0.05 }, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: null,
    body: { mass: 2, centerOfMass: { x: 0.25, y: 0, z: 0 }, inertia: [1e-4, 0.01, 0.01, 0, 0, 0] },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: []
  }
  return {
    motors: [
      ...base.motors,
      { device: 'lift', modelTag: TAG, gearbox: 19.2, directionSign: 1, params: LIFT_PARAMS }
    ],
    joints: [
      stage,
      { ...stage, parent: 0, drive: { kind: 'none' }, limits: { lower: 0, upper: 0.25 } },
      arm
    ]
  }
}
const liftOut = (power: number): DeviceValues => ({
  mode: 'RUN_WITHOUT_ENCODER',
  power: power * HUB_SIGN,
  enabled: true,
  zeroPower: 'BRAKE',
  encoderOffset: 0
})

// FLOWER <3> 옆 빨강 벽 모서리(redWallCenter의 +X 끝)에 붙은 자세
function cornerStart(): Pose2 {
  const preset = BIOBUZZ.startPresets.find((p) => p.key === 'redWallCenter')
  if (!preset) throw new Error('redWallCenter')
  const snap = snapRobotToStart(FOOTPRINT, preset, INNER, preset.along[1])
  if (!snap.ok) throw new Error('tooWide')
  return snap.pose
}

describe('4ab 구조물 접촉: 거의 나란한 면(참 분리 축 보충)', () => {
  // 위치 보정이 없어(목표 −max(gap, 0)/h) 기준 면이 SAT의 참 분리 축이 아니면, 거의 나란한 로봇 변이 짧은 구조물 면 끝을 넘어
  // 걸친 채 미끄러지거나 돌 때 구조물 모서리가 로봇 변으로 들어가고(L·sin θ ≤ REFERENCE_TOLERANCE까지) 되돌아오지 않았다.
  // polygonContact가 참 축의 점을 더해 막는다(리뷰가 찾은 회귀 시험). 침투는 모든 solid 구조물과 벽에서 잰다.
  const SOLIDS = solidFootprints(BIOBUZZ, H18)
  const worstAny = (poses: readonly Pose2[]): number => {
    let worst = 0
    for (const p of poses)
      for (const s of SOLIDS)
        if (s.kind === 'polygon')
          worst = Math.max(worst, -polygonSeparation(placeFootprint(FOOTPRINT, p), s.points))
    return worst
  }
  const worldErrors = (r: Runner): number =>
    r.world.drainNotices().filter((n) => n.code === 'worldError').length

  it('리뷰 재현: 발판 막대 <0>의 +X 끝면에 로봇 면이 약 2.3° 기울어 닿은 채 돌며 미끄러져도 침투가 늘지 않는다', () => {
    const start = { x: 0.8237481154031969, y: -0.14912877470282265, yaw: 1.8086232700416973 }
    expect(worstAny([start])).toBe(0)
    const r = new Runner(fieldSpec(start)).run(2, () =>
      outputs(mecanum(-0.1175384521484375, 0.18050765991210938, 0.5522994995117188))
    )
    // 고치기 전에는 발판 막대에 0.34 mm 들어간 채 남았다
    expect(worstPenetration(r.poses, FOOT_BAR_RED)).toBeLessThan(1e-6)
    expect(worstAny(r.poses)).toBeLessThan(1e-6)
    expect(worldErrors(r)).toBe(0)
  })

  it('FLOWER <3> 필드 쪽 면·발판 막대 <0> 끝면 끝을 1 cm 넘어 거의 나란히(1°·2.5°) 닿아 미끄러지며 돌아도 침투 증가 < 1e-6 m', () => {
    // 로봇 앞면(요 = 진행 방향 + tilt)이 구조물 면 한 끝을 1 cm 넘어 걸치게 두고 면 쪽으로 다가가 2 mm 앞에서 시작한다.
    // L·sin θ(1 cm × sin 1°–2.5° = 0.17–0.44 mm)가 REFERENCE_TOLERANCE 안이라 구조물 면이 기준으로 남는 경우다
    // tilt·slide·turn은 고치기 전 침투가 가장 컸던 조합(FLOWER 0.52–0.67 µm, 발판 막대 0.58–0.62 µm, 지금은 0.12 µm 아래)
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
      // FLOWER <3>의 +Y 면(x 0.5187–0.6697)에 +Y에서 −Y로
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
      // 발판 막대 <0>의 +X 끝면(y −0.6282–−0.5778)에 +X에서 −X로
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
        // 앞면이 면의 a 쪽 끝을 1 cm 넘게 앞면 가운데를 옮기고, 면에서 30 cm 뒤에 둔다
        const shift = HALF - length / 2 - 0.01
        const mid = { x: (a.x + b.x) / 2 + shift * u.x, y: (a.y + b.y) / 2 + shift * u.y }
        const from = {
          x: mid.x + (HALF + 0.3) * back.x,
          y: mid.y + (HALF + 0.3) * back.y,
          yaw: target.direction + tilt
        }
        const start = approach(target.index, from, target.direction, 2e-3)
        expect(worstAny([start])).toBe(0)
        const r = new Runner(fieldSpec(start)).run(1, () =>
          outputs(toward(start.yaw, target.direction + slide, 0.5, turn))
        )
        expect(worstAny(r.poses)).toBeLessThan(1e-6)
        expect(wallPenetration(r.poses)).toBeLessThan(1e-6)
        expect(worldErrors(r)).toBe(0)
      }
    }
  })

  // 퍼즈: solid 구조물 근처의 무작위 자세·명령 48개(고정 시드). 한 시험이 5 s 기본 제한을 넘지 않게 12개씩 넷으로 나눈다
  const fuzzTrials = ((): { start: Pose2; command: Powers }[] => {
    const polygons = SOLIDS.filter((s) => s.kind === 'polygon')
    // 선형 합동 생성기(glibc 상수, 결정적)
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
      // 벽에 1 mm 안이나 구조물에 5 mm 안으로 시작하는 자세는 버린다
      const placed = placeFootprint(FOOTPRINT, start)
      if (placed.some((v) => Math.max(Math.abs(v.x), Math.abs(v.y)) > INNER - 1e-3)) continue
      if (polygons.some((q) => polygonSeparation(placed, q.points) < 5e-3)) continue
      trials.push({ start, command })
    }
    return trials
  })()
  for (let part = 0; part < 4; part++)
    it(`퍼즈 ${part + 1}/4: 구조물 근처 무작위 자세·명령 12개에서 침투 증가 < 1e-6 m, worldError 없음`, () => {
      for (const { start, command } of fuzzTrials.slice(part * 12, part * 12 + 12)) {
        const r = new Runner(fieldSpec(start)).run(1.5, () => outputs(command))
        expect(worstAny(r.poses)).toBeLessThan(1e-6)
        expect(worldErrors(r)).toBe(0)
      }
    })
})

describe('4ab 구조물 접촉: 행 키·모서리·성능', () => {
  it('A2 행 키 유일: FLOWER 옆 벽 모서리, 다리 둘 사이, 발판 막대 끝에서 한 풀이의 밖의 행 키가 서로·내부 키(f·l·u)와 다르다', () => {
    // structures: 묶음마다 그 가운데 하나 이상에 닿는다. together: 한 풀이에 구조물 둘 이상
    const scenarios: {
      start: Pose2
      command: Powers
      structures: number[][]
      together?: boolean
    }[] = [
      // 벽 모서리에 붙어 FLOWER와 벽 쪽으로 민다
      {
        start: cornerStart(),
        command: toward(Math.PI / 2, -Math.PI / 4, 1, 0.3),
        structures: [[FLOWER_RED]]
      },
      // 다리 둘(+Y) 사이: 안쪽 끝(|x| ≥ 0.26) 사이 3 cm 틈에 두고 돌며 민다. 돌아가는 모서리(반지름 0.323 m)가 다리 끝과
      // 발판 막대(+Y)에 닿는다
      {
        start: { x: 0, y: 0.3, yaw: 0 },
        command: mecanum(0.3, 0, 1),
        structures: [[LEG_PX_PY, LEG_MX_PY], [FOOT_BAR_BLUE]],
        together: true
      },
      // 발판 막대(−Y) 끝(+X): 모서리를 비스듬히 민다
      {
        start: { x: 0.65, y: -0.95, yaw: 0.4 },
        command: toward(0.4, 2, 1, -0.4),
        structures: [[FOOT_BAR_RED]]
      }
    ]
    for (const scenario of scenarios) {
      const steps = recordRows()
      new Runner(fieldSpec(scenario.start, {}, liftJoints())).run(1.5, () => ({
        ...outputs(scenario.command),
        lift: liftOut(1)
      }))
      vi.restoreAllMocks()
      const touched = new Set<number>()
      for (const keys of steps) {
        expect(new Set(keys).size).toBe(keys.length)
        for (const key of keys) {
          // 밖의 행: 바퀴 w…, 벽 n|t + x±·y±, 구조물 n|t + s<i>. 내부 행 f…·l<i>·u<i>와 첫 글자가 다르다
          expect(key).toMatch(/^(w\d+[aof]\d*|[nt][xy][+-]\d+|[nt]s\d+\.(q\d+\.r\d+|p\d+\.c\d+))$/)
          const m = /^ns(\d+)\./.exec(key)
          if (m) touched.add(Number(m[1]))
        }
      }
      // 같은 풀이에 여러 구조물의 행이 함께 들어간 하위 단계가 있다(구조물 순번이 키에 있어 겹치지 않는다)
      for (const anyOf of scenario.structures)
        expect(anyOf.some((index) => touched.has(index))).toBe(true)
      if (scenario.together)
        expect(
          steps.some((keys) => new Set(structureKeys(keys).map((k) => k.split('.')[0])).size >= 2)
        ).toBe(true)
    }
  })

  it('A17 모서리 대 모서리: 요 45° 로봇의 모서리를 FLOWER 모서리에 곧게 몰면 침투가 늘지 않고, 1 s 동안 기준 전환 ≤ 2, |ω| < 0.5 rad/s, 두 번 돌려 바이트가 같다', () => {
    // FLOWER <1>(−X 벽)의 필드 쪽 위 모서리 (−1.667, −0.51867)를 요 45° 외곽의 −X 모서리(꼭짓점 1 (−H, H))가 같은 y에서 −X로 친다
    const flower = hull(FLOWER_MX)
    const corner = flower.reduce((a, b) => (b.x >= a.x && b.y >= a.y ? b : a))
    const yaw = Math.PI / 4
    const lead = placeFootprint([FOOTPRINT[1]], { x: 0, y: 0, yaw })[0]
    expect(lead.x).toBeCloseTo(-HALF * Math.SQRT2, 12)
    expect(lead.y).toBeCloseTo(0, 12)
    const start = { x: corner.x + 0.03 - lead.x, y: corner.y - lead.y, yaw }
    const once = (): { text: string; switches: number; omega: number; penetration: number } => {
      const steps = recordRows()
      const r = new Runner(fieldSpec(start)).run(1, () => outputs(toward(yaw, Math.PI, 0.6)))
      vi.restoreAllMocks()
      const references: string[] = []
      for (const keys of steps) {
        const reference = structureKeys(keys, FLOWER_MX)[0]?.split('.')[1]
        if (reference && references[references.length - 1] !== reference) references.push(reference)
      }
      let omega = 0
      for (let k = 1; k < r.poses.length; k++)
        omega = Math.max(omega, Math.abs(r.poses[k].yaw - r.poses[k - 1].yaw) / DT)
      return {
        text: JSON.stringify([r.inputs, r.poses, r.world.drainNotices()]),
        switches: references.length - 1,
        omega,
        penetration: worstPenetration([start, ...r.poses], FLOWER_MX)
      }
    }
    const a = once()
    expect(a.switches).toBeGreaterThanOrEqual(0)
    expect(a.switches).toBeLessThanOrEqual(2)
    expect(a.omega).toBeLessThan(0.5)
    expect(a.penetration).toBeLessThan(1e-6)
    expect(once().text).toBe(a.text)
  })

  it('A14 성능: 메카넘 4 + 관절 3이 벽 모서리 + FLOWER + 벽에 닿은 하위 단계당 중앙값(로그, 예산 0.3 ms, CI 상한 5 ms)', () => {
    const steps = recordRows()
    const r = new Runner(fieldSpec(cornerStart(), {}, liftJoints()))
    const times: number[] = []
    for (let k = 0; k < 400; k++) {
      const start = performance.now()
      r.run(DT, () => ({
        ...outputs(toward(Math.PI / 2, -Math.PI / 4, 0.8, 0.05)),
        lift: liftOut(k < 200 ? 1 : -0.3)
      }))
      if (k > 0) times.push((performance.now() - start) / 5)
    }
    vi.restoreAllMocks()
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]
    console.info(
      `4ab 성능: 하위 단계당 중앙값 ${median.toFixed(3)} ms (메카넘 4 + 관절 3 + 벽 모서리 + FLOWER)`
    )
    // 벽과 FLOWER에 함께 닿은 하위 단계가 대부분이다
    const both = steps.filter(
      (keys) => keys.some((k) => /^ny-\d/.test(k)) && structureKeys(keys, FLOWER_RED).length > 0
    )
    expect(both.length).toBeGreaterThan(steps.length / 2)
    expect(r.poses.slice(-100).every((p) => p.blocked)).toBe(true)
    expect(median).toBeLessThan(5)
  })
})

describe('4ab BIOBUZZ 반폭 벽(구조물 없음)', () => {
  // 3c 벽 시험(worldDrive.test.ts T6·T6b·T6c·T6d)을 BIOBUZZ 레일 안쪽 면 1.79286 m로: 구조물에 걸리지 않게 구조물을 뺀 판
  const LIMIT = INNER
  const options: PhysicsWorldOptions = { field: { ...BIOBUZZ, structures: [] } }
  const touching = { x: LIMIT - HALF, y: 0, yaw: 0 }
  const POD = {
    device: 'par',
    position: { x: 0, y: 0.1 },
    measures: 'forward' as const,
    reversed: false,
    ticksPerMeter: 2000
  }

  it('A15 벽 밀기: 침투 없음·blocked, 전출력이면 헛돌아 바퀴 엔코더가 늘고 데드휠은 0', () => {
    expect(LIMIT).toBe(1.79286)
    const spec = fieldSpec(touching, {}, { deadWheels: [POD] })
    const r = new Runner(spec, options).run(0.5, () => outputs(mecanum(1, 0.3, 0)))
    const ticks = r.value('fl', 'position')
    r.run(0.5, () => outputs(mecanum(1, 0.3, 0)))
    expect(Math.abs(r.value('fl', 'position') - ticks)).toBeGreaterThan(500)
    expect(r.value('par', 'position')).toBe(0)
    expect(wallPenetration(r.poses, LIMIT)).toBeLessThan(1e-6)
    expect(r.poses.slice(5).every((p) => p.blocked)).toBe(true)
    // 'none'의 반폭(1.81630)이었다면 이 자세는 벽에서 23.44 mm 떨어져 막히지 않는다
    expect(
      new Runner(fieldSpec(touching, {}, { field: { season: 'none', hiveTipped: [false, false] } }))
        .run(0.02, () => outputs(mecanum(0.3, 0, 0)))
        .pose().blocked
    ).toBe(false)
  })

  it('A15 걸친 시작: 꼭짓점이 1 cm 침투한 채 정지하면 자세가 1e-9 안 그대로이고, 밀어도 더 들어가지 않는다', () => {
    const yaw = 0.1
    const reach = HALF * (Math.cos(yaw) + Math.sin(yaw))
    const start = { x: LIMIT + 0.01 - reach, y: 0.3, yaw }
    const r = new Runner(fieldSpec(start), options).run(1, () => outputs({}))
    const pose = r.pose()
    expect(Math.abs(pose.x - start.x)).toBeLessThan(1e-9)
    expect(Math.abs(pose.y - start.y)).toBeLessThan(1e-9)
    expect(Math.abs(pose.yaw - start.yaw)).toBeLessThan(1e-9)
    r.run(0.5, () => outputs(mecanum(0.5, 0, 0)))
    expect(wallPenetration(r.poses, LIMIT)).toBeLessThan(0.01 + 1e-6)
  })

  it('A15 벽에 붙어 미는 채 앞 슬라이드를 위 한계에 거듭 박아도 침투가 늘지 않는다', () => {
    const params = testMotorParams(TAG, 3.7)
    const slide: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: { x: 0, y: 0, z: 0.15 }, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: { lower: 0, upper: 0.3 },
      body: { mass: 3, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] },
      friction: { coulomb: 0.5, viscous: 0 },
      spring: null,
      drive: {
        kind: 'motor',
        devices: ['slide'],
        ratio: 0.019,
        params,
        rigging: { kind: 'direct' }
      },
      switches: []
    }
    const base = robotSpec()
    const spec = fieldSpec(
      touching,
      {},
      {
        motors: [
          ...base.motors,
          { device: 'slide', modelTag: TAG, gearbox: 3.7, directionSign: 1, params }
        ],
        joints: [slide]
      }
    )
    const slideOut = (power: number): DeviceValues => ({ ...liftOut(power), power })
    const r = new Runner(spec, options)
    for (let k = 0; k < 12; k++) {
      r.run(0.4, () => ({ ...outputs(mecanum(0.5, 0, 0)), slide: slideOut(-1) }))
      r.run(0.12, () => ({ ...outputs(mecanum(0.5, 0, 0)), slide: slideOut(0.6) }))
    }
    expect(r.poses.some((p) => Math.abs((p.joints?.[0] ?? 0) - 0.3) < 1e-9)).toBe(true)
    expect(wallPenetration(r.poses, LIMIT)).toBeLessThan(1e-6)
  })
})
