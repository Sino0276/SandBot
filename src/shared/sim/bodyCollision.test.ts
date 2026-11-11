import { afterEach, describe, expect, it, vi } from 'vitest'
import { Articulation, type ContactFrames, type ContactRow, type DriveForces } from './articulation'
import { BodyCollision, COLLISION_MARGIN } from './bodyCollision'
import {
  bodyShape,
  placeShape,
  SAT_COUNTERS,
  shapeSeparation,
  staticShapes,
  type Manifold
} from './collision3d'
import { wallRows } from './contact'
import { robotSpec, ZERO } from './driveTestkit'
import { resolveSeason } from './seasons/seasons'
import { planarFrame } from './sensorFrame'
import type { Pose2, SimCollider, SimJointSpec, Vec3, WorldSpec } from './worldSpec'

// BodyCollision 단위 시험(spec-5 §10 A5·A14·A17·A23·A24): 세계 없이 Articulation 상태를 직접 놓고 rows()를 부른다.

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const H = 1e-3
const NONE = resolveSeason('none')
const BIOBUZZ = resolveSeason('biobuzz')

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
const box = (center: Vec3, half: Vec3, rotation: number[] = I, friction = 0.4): SimCollider => ({
  kind: 'box',
  center,
  rotation,
  half,
  friction
})

// 고정 기저(바퀴 없음) 세계 설명과 그 Articulation(world.ts와 같은 옵션)
function fixed(
  joints: SimJointSpec[],
  change: Partial<WorldSpec> = {}
): {
  spec: WorldSpec
  art: Articulation
} {
  const spec = robotSpec(
    { start: { x: 0, y: 0, yaw: 0 } },
    { wheels: [], motors: [], joints, ...change }
  )
  return { spec, art: new Articulation(spec.joints) }
}
// 부유 기저(메카넘) 세계 설명과 그 Articulation(바퀴 회전 좌표는 빼고 기저 셋만)
function floating(
  start: Pose2,
  colliders: SimCollider[],
  joints: SimJointSpec[] = [],
  change: Partial<WorldSpec> = {}
): { spec: WorldSpec; art: Articulation } {
  const base = robotSpec({ start }, { joints, ...change })
  const spec: WorldSpec = { ...base, robot: { ...base.robot, colliders } }
  return {
    spec,
    art: new Articulation(spec.joints, { base: { body: spec.robot.body, start: spec.robot.start } })
  }
}
const rowsOf = (collision: BodyCollision, art: Articulation): ReturnType<BodyCollision['rows']> =>
  collision.rows(art, H, art.coordinates.length)

afterEach(() => {
  vi.restoreAllMocks()
  BodyCollision.manifoldHook = null
})

describe('A5 0 행 빼기', () => {
  it('A5 고정 기저면 섀시–정적 짝이 목록에 없다: 벽에 걸친 섀시 상자도 행·매니폴드·SAT 질의가 없다', () => {
    // 섀시 상자가 +x 벽에 1 cm 걸친다(고정 기저는 시작 자세 그대로)
    const inner = NONE.perimeter.innerHalf
    const { spec, art } = fixed(
      [joint({ origin: { position: { x: 0, y: 0, z: 0.5 }, rotation: ZERO } })],
      {
        robot: {
          ...robotSpec().robot,
          start: { x: inner - 0.2286 + 0.01, y: 0, yaw: 0 },
          colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: 0.2286, y: 0.2286, z: 0.1 })]
        }
      }
    )
    const collision = new BodyCollision(spec, NONE)
    expect((collision as unknown as { pairs: unknown[] }).pairs).toEqual([])
    const tokens: string[] = []
    BodyCollision.manifoldHook = (token) => tokens.push(token)
    const before = SAT_COUNTERS.edgeQueries
    const made = rowsOf(collision, art)
    expect(made.rows).toEqual([])
    expect(tokens).toEqual([])
    expect(SAT_COUNTERS.edgeQueries).toBe(before)
  })

  it('A5 부유 기저 섀시–정적 짝에는 수직 접선(ct2)·비틀림(cw) 행이 없고 LCP가 던지지 않는다', () => {
    const inner = NONE.perimeter.innerHalf
    const { spec, art } = floating({ x: inner - 0.2286 - 2e-4, y: 0.1, yaw: 0 }, [
      box({ x: 0, y: 0, z: 0.1 }, { x: 0.2286, y: 0.2286, z: 0.1 })
    ])
    const collision = new BodyCollision(spec, NONE)
    art.v[0] = 0.3
    const made = rowsOf(collision, art)
    const keys = made.rows.map((r) => r.key)
    expect(keys.filter((k) => k.startsWith('cn.rk0/w0.'))).toHaveLength(2)
    expect(keys.filter((k) => k.startsWith('ct1.rk0/w0.'))).toHaveLength(1)
    expect(keys.some((k) => k.startsWith('ct2.') || k.startsWith('cw.'))).toBe(false)
    // 모든 행의 ‖j‖² > 0(0 행은 넣지 않는다)
    for (const row of made.rows) expect(row.j.reduce((s, x) => s + x * x, 0)).toBeGreaterThan(1e-12)
    expect(made.blocking.map((r) => r.key)).toEqual(keys.filter((k) => k.startsWith('cn.')))
    const m = art.coordinates.length
    const zeros = new Array<number>(m).fill(0)
    const drive = (): DriveForces => ({
      force: zeros,
      damping: zeros,
      stiffness: zeros,
      boxLo: zeros,
      boxHi: zeros,
      regions: ''
    })
    expect(() => art.step(H, drive, { rows: made.rows, damping: [] })).not.toThrow()
  })
})

describe('A23 섀시–정적 합치기', () => {
  it('A23 섀시 상자(격자 밖 외곽) 대 벽 면: 법선 행 2(z = 0·H 짝이 합쳐짐)·접선 1, 4ab wallRows의 같은 접촉과 J·g가 1e-12 안', () => {
    const a = 0.2287123
    const b = 0.1934567
    const height = 0.31
    const inner = BIOBUZZ.perimeter.innerHalf
    for (const [wall, start] of [
      ['w0', { x: inner - a - 3e-4, y: 0.1234567, yaw: 0 }],
      ['w3', { x: -0.4567, y: -inner + b + 1e-4, yaw: 0 }]
    ] as const) {
      const footprint = [
        { x: a, y: b },
        { x: -a, y: b },
        { x: -a, y: -b },
        { x: a, y: -b }
      ]
      const { spec, art } = floating(
        start,
        [box({ x: 0, y: 0, z: height / 2 }, { x: a, y: b, z: height / 2 })],
        [],
        {
          field: { season: 'biobuzz', hiveTipped: [false, false] }
        }
      )
      const velocity = { vx: 0.21, vy: -0.13, omega: 0 }
      art.v[0] = velocity.vx
      art.v[1] = velocity.vy
      const made = rowsOf(new BodyCollision(spec, BIOBUZZ), art)
      const normals = made.rows.filter((r) => r.key.startsWith(`cn.rk0/${wall}.`))
      const tangents = made.rows.filter((r) => r.key.startsWith(`ct1.rk0/${wall}.`))
      expect(normals).toHaveLength(2)
      expect(tangents).toHaveLength(1)
      expect(made.rows).toHaveLength(3)
      // 4ab 평면 경로의 같은 접촉: 꼭짓점 둘의 법선 행
      const planar = wallRows(footprint, start, velocity, H, 3, inner).filter((r) =>
        r.key.startsWith('n')
      )
      expect(planar).toHaveLength(2)
      const byLever = (rows: ContactRow[]): ContactRow[] =>
        [...rows].sort((p, q) => p.j[2] - q.j[2])
      const mine = byLever(normals)
      const theirs = byLever(planar)
      mine.forEach((row, i) => {
        row.j.forEach((x, c) => expect(Math.abs(x - theirs[i].j[c])).toBeLessThan(1e-12))
        expect(Math.abs(row.target * H - theirs[i].target * H)).toBeLessThan(1e-12)
      })
    }
  })

  it('A23 기운 다리 면(|n_h| ≈ 0.89)에서 행 간격은 g′ = g/|n_h|', () => {
    const leg = staticShapes(BIOBUZZ).find((shape) => shape.token === 's5')!.hull!
    const chassis = bodyShape(box({ x: 0, y: 0, z: 0.1 }, { x: 0.2286, y: 0.2286, z: 0.1 }))!
    // 다리 (+X, −Y)는 필드 중앙(−x) 쪽으로 기울어 −x 면의 법선이 (−0.914, 0, −0.407)이다. 섀시가 −x 쪽에서 다가가 윗모서리가
    // 그 면에서 2e-4 m인 자세
    const sep = (pose: Pose2): number =>
      shapeSeparation(placeShape(chassis, planarFrame(pose)), { kind: 'hull', hull: leg })
    const at = (t: number): Pose2 => ({ x: leg.centroid.x - 0.7 + t, y: leg.centroid.y, yaw: 0.05 })
    let lo = 0
    let hi = 0.7
    expect(sep(at(lo))).toBeGreaterThan(0)
    expect(sep(at(hi))).toBeLessThan(0)
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2
      if (sep(at(mid)) > 2e-4) lo = mid
      else hi = mid
    }
    const start = at(lo)
    const { spec, art } = floating(
      start,
      [box({ x: 0, y: 0, z: 0.1 }, { x: 0.2286, y: 0.2286, z: 0.1 })],
      [],
      { field: { season: 'biobuzz', hiveTipped: [false, false] } }
    )
    const manifolds: Manifold[] = []
    BodyCollision.manifoldHook = (token, m) => {
      if (token === 'rk0/s5') manifolds.push(m)
    }
    const made = rowsOf(new BodyCollision(spec, BIOBUZZ), art)
    expect(manifolds).toHaveLength(1)
    const m = manifolds[0]
    const normals = made.rows.filter((r) => r.key.startsWith('cn.rk0/s5.'))
    expect(normals.length).toBeGreaterThan(0)
    let tilted = 0
    for (const row of normals) {
      const point = m.points.find((p) => row.key.endsWith(`.${p.id}`))!
      expect(point).toBeDefined()
      const lh = Math.hypot(point.normal.x, point.normal.y)
      if (lh < 0.95) tilted++
      // 정지 상태라 곡률 보정 0: 목표 = −max(g′, 0)/h
      expect(Math.abs(-row.target * H - Math.max(point.separation / lh, 0))).toBeLessThan(1e-15)
      // 법선 j는 수평 단위 법선의 기저 열
      expect(Math.hypot(row.j[0], row.j[1])).toBeCloseTo(1, 12)
    }
    expect(tilted).toBeGreaterThan(0)
  })
})

describe('A17 알림 기준(t = 0만)', () => {
  // 고정 기저: z 직선 몸체의 상자(바닥 위 0.05 m가 q = 0)
  const setup = (): { collision: BodyCollision; art: Articulation } => {
    const { spec, art } = fixed([
      joint({
        origin: { position: { x: 0.3, y: 0, z: 0.07 }, rotation: ZERO },
        colliders: [box(ZERO, { x: 0.05, y: 0.05, z: 0.02 })]
      })
    ])
    return { collision: new BodyCollision(spec, NONE), art }
  }
  const overlap = (collision: BodyCollision, art: Articulation, depth: number): string[] => {
    // 몸체 아래면 z = 0.05 + q → q = −0.05 − depth
    art.z[0] = -0.05 - depth
    return rowsOf(collision, art).notices.map((n) => `${n.code} ${JSON.stringify(n.params)}`)
  }

  it('A17 t = 0에 떨어져 있던 짝이 2 mm 걸쳐 들어오면 알림 한 번(기준 0)', () => {
    const { collision, art } = setup()
    expect(overlap(collision, art, -0.005)).toEqual([])
    expect(overlap(collision, art, 0.002)).toEqual([
      'collisionOverlap {"body":"0","target":"floor"}'
    ])
    // 실행마다 한 번
    expect(overlap(collision, art, 0.004)).toEqual([])
  })

  it('A17 t = 0에 2 mm 걸친 짝은 빠졌다 다시 들어와도 기준이 2 mm다(넓은 단계·기억과 무관)', () => {
    const { collision, art } = setup()
    expect(overlap(collision, art, 0.002)).toEqual([])
    // 넓은 단계 밖으로(기억이 지워진다)
    expect(overlap(collision, art, -0.01)).toEqual([])
    expect(overlap(collision, art, 0.0025)).toEqual([])
    expect(overlap(collision, art, 0.0032)).toEqual([
      'collisionOverlap {"body":"0","target":"floor"}'
    ])
  })
})

describe('A14 패치 중심', () => {
  it('A14 패치 중심은 들린 예측 점 쪽으로 끌리지 않는다(분리 무게 평균): 닿은 점의 비틀림 지렛대가 더 짧다', () => {
    // y 축으로 기운 상자(아래면 한쪽 모서리 둘이 바닥에 닿고 반대쪽 둘은 1.8 mm 위)가 1 m/s로 내려온다
    const theta = Math.asin(0.0018 / 0.1)
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    const rotation = [c, 0, s, 0, 1, 0, -s, 0, c]
    // 아래 꼭짓점 (±0.05, ±0.05, −0.02)의 회전 뒤 가장 낮은 z
    const low = Math.min(-0.05 * -s + -0.02 * c, 0.05 * -s + -0.02 * c)
    // 세로축 회전(비틀림 행의 J가 0이 아니게) 위 z 직선 몸체
    const { spec, art } = fixed([
      joint({
        type: 'revolute',
        origin: { position: { x: 0.3, y: 0, z: -low }, rotation: ZERO }
      }),
      joint({ parent: 0, colliders: [box(ZERO, { x: 0.05, y: 0.05, z: 0.02 }, rotation)] })
    ])
    art.v[1] = -1
    const made = rowsOf(new BodyCollision(spec, NONE), art)
    const normals = made.rows.filter((r) => r.key.startsWith('cn.j1k0/fl.'))
    expect(normals).toHaveLength(4)
    const twist = made.rows.find((r) => r.key.startsWith('cw.j1k0/fl.'))!
    const levers = (twist.friction as { patch: readonly { normal: string; weight: number }[] })
      .patch
    // 아래 꼭짓점 높이(행 목표 = −g/h)로 닿은 점과 들린 점을 가른다
    const gap = new Map(normals.map((r) => [r.key, -r.target * H]))
    const touching = levers.filter((p) => gap.get(p.normal)! < 1e-9).map((p) => p.weight)
    const lifted = levers.filter((p) => gap.get(p.normal)! > 1.5e-3).map((p) => p.weight)
    expect(touching).toHaveLength(2)
    expect(lifted).toHaveLength(2)
    // 무게(닿은 점 1, 들린 점 2 − 1.8/1 = 0.2) 평균이라 중심이 닿은 쪽으로: 지렛대 x 차 0.1·(1 − 0.2)/(2·1.2) = 0.0333
    expect(Math.max(...touching)).toBeLessThan(Math.min(...lifted) - 0.02)
    expect(COLLISION_MARGIN).toBe(1e-3)
  })
})

describe('A24 비유한 짝 빼기', () => {
  it('A24 한 짝의 j가 비유한이면 그 짝의 행만 빠지고 worldError collision <짝>', () => {
    const { spec, art } = fixed([
      joint({
        origin: { position: { x: 0.3, y: 0, z: 0.02 }, rotation: ZERO },
        colliders: [box(ZERO, { x: 0.05, y: 0.05, z: 0.02 })]
      }),
      joint({
        origin: { position: { x: -0.3, y: 0, z: 0.02 }, rotation: ZERO },
        colliders: [box(ZERO, { x: 0.05, y: 0.05, z: 0.02 })]
      })
    ])
    const original = Articulation.prototype.relativeJacobian
    vi.spyOn(Articulation.prototype, 'relativeJacobian').mockImplementation(function (
      this: Articulation,
      frames: ContactFrames,
      a: number,
      b: number | null,
      p: Vec3,
      d: Vec3
    ) {
      const j = original.call(this, frames, a, b, p, d)
      return a === 1 ? j.map(() => NaN) : j
    })
    const made = rowsOf(new BodyCollision(spec, NONE), art)
    expect(made.rows.some((r) => r.key.includes('j0k0/fl'))).toBe(true)
    expect(made.rows.some((r) => r.key.includes('j1k0/'))).toBe(false)
    expect(made.rows.every((r) => r.j.every(Number.isFinite) && Number.isFinite(r.target))).toBe(
      true
    )
    expect(made.notices).toEqual([{ code: 'worldError', params: { detail: 'collision j1k0/fl' } }])
  })
})
