import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bodyShape,
  collideHulls,
  collideShapes,
  cylinderPrism,
  CYLINDER_SIDES,
  editPoseOverlaps,
  EDIT_OVERLAP_TOLERANCE,
  gjkDistance,
  placeShape,
  SAT_COUNTERS,
  shapeSeparation,
  startOverlaps,
  staticShapes,
  type EditPoseBody,
  type PlacedShape,
  type SatCache
} from './collision3d'
import { robotSpec } from './driveTestkit'
import { boxHull, prismHull, type Hull } from './hull'
import { resolveSeason } from './seasons/seasons'
import { rotationMatrix } from './seasons/fieldGeometry'
import type { SimCollider, Vec3, WorldSpec } from './worldSpec'

// 3D 좁은 단계·형상 시험(spec-5 §10 A6–A10·A18·A19). 순수 함수만 쓴다(세계 시험은 worldCollision.test.ts).

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const ZERO: Vec3 = { x: 0, y: 0, z: 0 }

// 고정 시드 선형 합동(결정적 입력)
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

// 축 k 둘레 각 θ의 회전(행 우선 9개)
function axisAngle(axis: Vec3, theta: number): number[] {
  const l = Math.hypot(axis.x, axis.y, axis.z)
  const [x, y, z] = [axis.x / l, axis.y / l, axis.z / l]
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const t = 1 - c
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c
  ]
}

// v를 t로 돌리는 회전(Rodrigues)
function turnTo(v: Vec3, t: Vec3): number[] {
  const axis = { x: v.y * t.z - v.z * t.y, y: v.z * t.x - v.x * t.z, z: v.x * t.y - v.y * t.x }
  const dot = v.x * t.x + v.y * t.y + v.z * t.z
  return axisAngle(axis, Math.acos(dot / (Math.hypot(v.x, v.y, v.z) * Math.hypot(t.x, t.y, t.z))))
}

const cube = (center: Vec3, rotation: number[], half: number): Hull =>
  boxHull(center, rotation, { x: half, y: half, z: half })
const hull = (h: Hull): PlacedShape => ({ kind: 'hull', hull: h })
const capsule = (a: Vec3, b: Vec3, r: number): PlacedShape => ({
  kind: 'capsule',
  a,
  b,
  r,
  sphere: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 1e-6
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SAT 껍질–껍질', () => {
  it('A6 상자–상자 면 위 쉼: 점 4·법선·분리 해석값, 1000 하위 단계 동안 키가 바뀌지 않고 닿은 동안 모서리 질의를 건너뛴다', () => {
    const gap = 3e-4
    const floor = boxHull({ x: 0, y: 0, z: -0.5 }, I, { x: 0.5, y: 0.5, z: 0.5 })
    const at = (dx: number, dy: number, dz: number): Hull =>
      cube({ x: 0.03 + dx, y: -0.02 + dy, z: 0.1 + gap + dz }, I, 0.1)
    const first = collideHulls(at(0, 0, 0), floor, 2e-3, null)
    const m = first.manifold
    expect(m).not.toBeNull()
    if (!m) return
    expect(m.points).toHaveLength(4)
    expect(Math.abs(m.normal.x)).toBeLessThan(1e-12)
    expect(Math.abs(m.normal.y)).toBeLessThan(1e-12)
    expect(Math.abs(m.normal.z - 1)).toBeLessThan(1e-12)
    for (const p of m.points) {
      expect(Math.abs(p.separation - gap)).toBeLessThan(1e-12)
      // 자리는 두 표면의 가운데
      expect(Math.abs(p.position.z - gap / 2)).toBeLessThan(1e-12)
    }
    expect(first.separation).toBeCloseTo(gap, 12)
    const ids = m.points.map((p) => p.id).join(',')
    const next = lcg(7)
    let cache: SatCache = first.cache
    const before = SAT_COUNTERS.edgeQueries
    for (let k = 0; k < 1000; k++) {
      const jitter = (): number => (next() - 0.5) * 2e-6
      const r = collideHulls(at(jitter(), jitter(), jitter()), floor, 2e-3, cache)
      cache = r.cache
      expect(r.manifold?.reference).toBe(m.reference)
      expect(r.manifold?.points.map((p) => p.id).join(',')).toBe(ids)
    }
    // 기억이 맞는 동안은 면 질의만(모서리 전체 질의 0번)
    expect(SAT_COUNTERS.edgeQueries - before).toBe(0)
  })

  it('A7 비틀린 상자 모서리 대 모서리: reference ee…, 점 1, 법선 = −u(B → A)', () => {
    const gap = 5e-4
    const h = 0.1
    // B: x축 둘레 45°(윗면이 x 방향 모서리), A: y축 둘레 45°(밑면이 y 방향 모서리)
    const b = cube(ZERO, axisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4), h)
    const a = cube(
      { x: 0, y: 0, z: 2 * h * Math.SQRT2 + gap },
      axisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4),
      h
    )
    const r = collideHulls(a, b, 2e-3, null)
    const m = r.manifold
    expect(m?.reference).toMatch(/^ee\d+\.\d+$/)
    expect(m?.points).toHaveLength(1)
    const p = m!.points[0]
    expect(p.id).toBe('e')
    expect(Math.abs(p.separation - gap)).toBeLessThan(1e-12)
    expect(Math.abs(m!.normal.z - 1)).toBeLessThan(1e-12)
    expect(Math.abs(p.position.z - (h * Math.SQRT2 + gap / 2))).toBeLessThan(1e-12)
    expect(Math.abs(p.position.x) + Math.abs(p.position.y)).toBeLessThan(1e-12)
    expect(r.cache?.kind).toBe('edge')
  })

  it('A7 꼭짓점 대 꼭짓점: GJK 대체 점(gv/g, 법선 = 꼭짓점 차 방향), 닿은 꼭짓점(d = 0)에서 NaN 없음', () => {
    const h = 0.1
    const diagonal = { x: 1, y: 1, z: 1 }
    const down = turnTo(diagonal, { x: 0, y: 0, z: -1 })
    const up = turnTo(diagonal, { x: 0, y: 0, z: 1 })
    const b = cube(ZERO, up, h)
    for (const gap of [8e-4, 0]) {
      const a = cube({ x: 0, y: 0, z: 2 * h * Math.sqrt(3) + gap }, down, h)
      const r = collideHulls(a, b, 2e-3, null)
      const m = r.manifold
      expect(m).not.toBeNull()
      for (const p of m!.points) {
        expect(Number.isFinite(p.separation)).toBe(true)
        expect(
          [p.position.x, p.position.y, p.position.z, p.normal.x, p.normal.y, p.normal.z].every(
            Number.isFinite
          )
        ).toBe(true)
      }
      if (gap > 0) {
        expect(m!.reference).toBe('gv')
        expect(m!.points.map((p) => p.id)).toEqual(['g'])
        expect(Math.abs(m!.points[0].separation - gap)).toBeLessThan(1e-9)
        expect(Math.abs(m!.normal.z - 1)).toBeLessThan(1e-9)
      }
    }
  })

  it('A8 거의 나란한 면(0.01°)을 1000번 흔들어도 기준 바뀜 ≤ 2', () => {
    const floor = boxHull({ x: 0, y: 0, z: -0.5 }, I, { x: 0.5, y: 0.5, z: 0.5 })
    const next = lcg(13)
    let cache: SatCache = null
    let switches = 0
    let last = ''
    const tilt = (0.01 * Math.PI) / 180
    for (let k = 0; k < 1000; k++) {
      const angle = tilt * (next() < 0.5 ? 1 : -1)
      const rotation = axisAngle({ x: 1, y: 0.3, z: 0 }, angle)
      const a = boxHull({ x: 0, y: 0, z: 0.1 + 2e-4 + (next() - 0.5) * 1e-5 }, rotation, {
        x: 0.2,
        y: 0.1,
        z: 0.1
      })
      const r = collideHulls(a, floor, 2e-3, cache)
      cache = r.cache
      const reference = r.manifold?.reference ?? ''
      if (k > 0 && reference !== last) switches++
      last = reference
    }
    expect(switches).toBeLessThanOrEqual(2)
  })

  it('A8 기준 면이 참 분리 축보다 덜 떨어지면(A 면 우선·히스테리시스) 참 축 면의 점을 +로 더한다', () => {
    // 위쪽 상자(A)가 아래 큰 상자(B) 위에 4e-4 rad 기울어 있다. B 윗면 분리가 A 밑면 분리보다 크지만 FEATURE_TOLERANCE 안이라
    // A 면이 기준이고, 참 축(B 윗면)의 점을 '+fb<면>.'으로 보충한다
    const floor = boxHull({ x: 0, y: 0, z: -0.5 }, I, { x: 0.5, y: 0.5, z: 0.5 })
    const a = boxHull({ x: 0, y: 0, z: 0.1 + 1e-4 }, axisAngle({ x: 1, y: 0, z: 0 }, 4e-4), {
      x: 0.1,
      y: 0.1,
      z: 0.1
    })
    const bottom = a.faces.findIndex((f) => f.normal.z < -0.99)
    const top = floor.faces.findIndex((f) => f.normal.z > 0.99)
    const r = collideHulls(a, floor, 2e-3, null)
    expect(r.manifold?.reference).toBe(`fa${bottom}`)
    expect(r.manifold?.points.some((p) => p.id.startsWith(`+fb${top}.`))).toBe(true)
    expect(r.manifold!.points.length).toBeLessThanOrEqual(4)
    // 기억은 고른 특징 그대로
    expect(r.cache).toMatchObject({ kind: 'faceA', a: bottom, touching: true })
    // 참 축이 같은 면이면 보충하지 않는다(나란한 면)
    const flat = collideHulls(cube({ x: 0, y: 0, z: 0.1 + 1e-4 }, I, 0.1), floor, 2e-3, null)
    expect(flat.manifold?.points.every((p) => !p.id.startsWith('+'))).toBe(true)
  })
})

describe('둥근 짝과 GJK', () => {
  const box = boxHull(ZERO, I, { x: 0.2, y: 0.2, z: 0.1 })
  const top = box.faces.findIndex((f) => f.normal.z > 0.99)

  it('A9 캡슐–껍질 면(2점 c0·c1)·모서리 근처(1점 gc/g)·깊음(SAT 면 2점) 해석값', () => {
    const r = 0.02
    const g = 3e-4
    const z = 0.1 + r + g
    const lying = collideShapes(
      capsule({ x: -0.05, y: 0, z }, { x: 0.05, y: 0.01, z }, r),
      hull(box),
      2e-3,
      null
    )
    expect(lying.manifold?.reference).toBe(`fb${top}`)
    expect(lying.manifold?.points.map((p) => p.id)).toEqual(['c0', 'c1'])
    for (const p of lying.manifold!.points) {
      expect(Math.abs(p.separation - g)).toBeLessThan(1e-12)
      expect(Math.abs(p.normal.z - 1)).toBeLessThan(1e-12)
      expect(Math.abs(p.position.z - (0.1 + g / 2))).toBeLessThan(1e-12)
    }
    // 껍질이 A면 법선이 뒤집히고 fa가 된다
    const flipped = collideShapes(
      hull(box),
      capsule({ x: -0.05, y: 0, z }, { x: 0.05, y: 0, z }, r),
      2e-3,
      null
    )
    expect(flipped.manifold?.reference).toBe(`fa${top}`)
    expect(Math.abs(flipped.manifold!.normal.z + 1)).toBeLessThan(1e-12)
    // 모서리 너머 비스듬히(가장 가까운 점이 윗면 +x 모서리): 점 하나, 법선은 모서리에서 캡슐 축으로
    const corner = { x: 0.2, z: 0.1 }
    const dir = { x: Math.SQRT1_2, z: Math.SQRT1_2 }
    const c = { x: corner.x + (r + g) * dir.x, z: corner.z + (r + g) * dir.z }
    const edge = collideShapes(
      capsule({ x: c.x, y: -0.05, z: c.z }, { x: c.x + 0.05, y: 0.05, z: c.z + 0.05 }, r),
      hull(box),
      2e-3,
      null
    )
    expect(edge.manifold?.reference).toBe('gc')
    expect(edge.manifold?.points.map((p) => p.id)).toEqual(['g'])
    expect(Math.abs(edge.manifold!.points[0].separation - g)).toBeLessThan(1e-9)
    expect(Math.abs(edge.manifold!.normal.x - dir.x)).toBeLessThan(1e-9)
    expect(Math.abs(edge.manifold!.normal.z - dir.z)).toBeLessThan(1e-9)
    // 깊음: 선분이 상자 안(윗면 아래 1 cm)
    const deep = collideShapes(
      capsule({ x: -0.05, y: 0, z: 0.09 }, { x: 0.05, y: 0, z: 0.09 }, r),
      hull(box),
      2e-3,
      null
    )
    expect(deep.manifold?.reference).toBe(`fb${top}`)
    expect(deep.manifold?.points).toHaveLength(2)
    for (const p of deep.manifold!.points) expect(p.separation).toBeCloseTo(-0.01 - r, 12)
  })

  it('A9 캡슐–캡슐 교차(1점 c)·나란함(2점 c0·c1), 캡슐–바닥 0–2점 해석값', () => {
    const ra = 0.02
    const rb = 0.015
    const g = 4e-4
    const zb = ra + rb + g
    const cross = collideShapes(
      capsule({ x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, ra),
      capsule({ x: 0.03, y: -0.1, z: zb }, { x: 0.03, y: 0.1, z: zb }, rb),
      2e-3,
      null
    )
    expect(cross.manifold?.reference).toBe('cc')
    expect(cross.manifold?.points.map((p) => p.id)).toEqual(['c'])
    expect(cross.manifold!.points[0].separation).toBeCloseTo(g, 12)
    // B가 위라 B → A 법선은 아래
    expect(cross.manifold!.normal.z).toBeCloseTo(-1, 12)
    const parallel = collideShapes(
      capsule({ x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, ra),
      capsule({ x: -0.05, y: 0, z: zb }, { x: 0.25, y: 0, z: zb }, rb),
      2e-3,
      null
    )
    expect(parallel.manifold?.points.map((p) => p.id)).toEqual(['c0', 'c1'])
    for (const p of parallel.manifold!.points) expect(p.separation).toBeCloseTo(g, 12)
    // 잘린 끝(c1)은 A 끝 평면 x = 0.1에 있다
    expect(parallel.manifold!.points[1].position.x).toBeCloseTo(0.1, 12)
    // 바닥: 낮은 끝만 띠 안이면 1점(e0), 둘 다면 2점
    const r = 0.02
    const one = collideShapes(
      capsule({ x: 0, y: 0, z: r + 5e-4 }, { x: 0.2, y: 0, z: r + 0.05 }, r),
      null,
      2e-3,
      null
    )
    expect(one.manifold?.reference).toBe('fl')
    expect(one.manifold?.points.map((p) => p.id)).toEqual(['e0'])
    expect(one.manifold!.points[0].separation).toBeCloseTo(5e-4, 12)
    expect(one.manifold!.points[0].position.z).toBeCloseTo(2.5e-4, 12)
    const both = collideShapes(
      capsule({ x: 0, y: 0, z: r - 1e-3 }, { x: 0.2, y: 0, z: r + 1e-3 }, r),
      null,
      2e-3,
      null
    )
    expect(both.manifold?.points.map((p) => p.separation)).toEqual([
      expect.closeTo(-1e-3, 12),
      expect.closeTo(1e-3, 12)
    ])
    expect(
      collideShapes(capsule({ x: 0, y: 0, z: 0.1 }, { x: 0.2, y: 0, z: 0.1 }, r), null, 2e-3, null)
        .manifold
    ).toBeNull()
  })

  it('A9 캡슐이 상자 모서리 위를 굴러 넘음: 법선이 모서리 반지름 방향이고 간격이 해석값(1e-9), 법선이 뛰지 않음', () => {
    const r = 0.02
    const g = 2e-4
    // 윗면 +x 모서리(x = 0.2, z = 0.1, y 방향)와 나란한 캡슐이 모서리 둘레를 0 → 90° 돈다
    let previous: Vec3 | null = null
    const steps = 360
    for (let k = 0; k <= steps; k++) {
      const phi = ((Math.PI / 2) * k) / steps
      const cx = 0.2 + (r + g) * Math.sin(phi)
      const cz = 0.1 + (r + g) * Math.cos(phi)
      const result = collideShapes(
        capsule({ x: cx, y: -0.05, z: cz }, { x: cx, y: 0.05, z: cz }, r),
        hull(box),
        2e-3,
        null
      )
      const m = result.manifold
      expect(m).not.toBeNull()
      const n = m!.normal
      for (const p of m!.points) expect(Math.abs(p.separation - g)).toBeLessThan(1e-9)
      if (k > 0 && k < steps) {
        expect(Math.abs(n.x - Math.sin(phi))).toBeLessThan(1e-9)
        expect(Math.abs(n.z - Math.cos(phi))).toBeLessThan(1e-9)
      }
      if (previous) {
        const jump = Math.hypot(n.x - previous.x, n.y - previous.y, n.z - previous.z)
        expect(jump).toBeLessThan((Math.PI / 2 / steps) * 1.01)
      }
      previous = n
    }
  })

  it('A9 구(a = b) 대 껍질 모서리: 닿음·모서리 위 중심(깊음)에서 NaN 없음', () => {
    const r = 0.03
    const edge = { x: 0.2, y: 0, z: 0.1 }
    for (const offset of [r, r + 1e-4, 0, 1e-12]) {
      const c = { x: edge.x + offset * Math.SQRT1_2, y: 0, z: edge.z + offset * Math.SQRT1_2 }
      const result = collideShapes(capsule(c, c, r), hull(box), 2e-3, null)
      const m = result.manifold
      expect(m).not.toBeNull()
      for (const p of m!.points)
        expect(
          [
            p.separation,
            p.position.x,
            p.position.y,
            p.position.z,
            p.normal.x,
            p.normal.y,
            p.normal.z
          ].every(Number.isFinite)
        ).toBe(true)
      expect(Number.isFinite(shapeSeparation(capsule(c, c, r), hull(box)))).toBe(true)
    }
  })

  it('gjkDistance: 떨어진 상자 둘의 거리와 가장 가까운 점, 겹치면 0', () => {
    const a = boxHull({ x: 0.5, y: 0.1, z: 0.2 }, axisAngle({ x: 0.2, y: 1, z: 0.3 }, 0.7), {
      x: 0.1,
      y: 0.05,
      z: 0.08
    })
    const b = boxHull(ZERO, I, { x: 0.2, y: 0.2, z: 0.2 })
    const result = gjkDistance(a.vertices, b.vertices)
    // 가장 가까운 점 차의 길이 = 거리, A 점은 A의 면 평면 안쪽
    const d = Math.hypot(
      result.pointA.x - result.pointB.x,
      result.pointA.y - result.pointB.y,
      result.pointA.z - result.pointB.z
    )
    expect(Math.abs(d - result.distance)).toBeLessThan(1e-12)
    expect(result.distance).toBeGreaterThan(0)
    // SAT 최선 분리(하한) ≤ 거리
    expect(shapeSeparation(hull(a), hull(b))).toBeLessThanOrEqual(result.distance + 1e-12)
    // 겹치면 0(반올림 수준)
    expect(
      gjkDistance(b.vertices, cube({ x: 0.1, y: 0, z: 0 }, I, 0.1).vertices).distance
    ).toBeLessThan(1e-12)
  })
})

describe('정적 형상·원기둥', () => {
  it('A10 cylinderPrism: Math.sin·cos는 회전 성분으로만 부르고, 꼭짓점은 반지름 R 원 위(1e-15), 변 가운데는 r(1e-15), prismHull 위상', () => {
    const sin = vi.spyOn(Math, 'sin')
    const cos = vi.spyOn(Math, 'cos')
    const rotation = { x: 0, y: 0, z: 0.4 }
    const points = cylinderPrism({ x: 0.5, y: -0.2, z: 0.3 }, rotation, 0.1, 0.6)
    const args = [...sin.mock.calls, ...cos.mock.calls].map((c) => c[0])
    sin.mockRestore()
    cos.mockRestore()
    for (const a of args) expect([rotation.x, rotation.y, rotation.z]).toContain(a)
    expect(points).toHaveLength(2 * CYLINDER_SIDES)
    const big = 0.1 / Math.cos(Math.PI / 16)
    for (let k = 0; k < CYLINDER_SIDES; k++) {
      const p = points[k]
      const q = points[(k + 1) % CYLINDER_SIDES]
      expect(Math.abs(Math.hypot(p.x - 0.5, p.y + 0.2) - big)).toBeLessThan(1e-15)
      expect(p.z).toBeCloseTo(0, 15)
      expect(points[k + CYLINDER_SIDES].z).toBeCloseTo(0.6, 15)
      const mid = Math.hypot((p.x + q.x) / 2 - 0.5, (p.y + q.y) / 2 + 0.2)
      expect(Math.abs(mid - 0.1)).toBeLessThan(1e-15)
    }
    const h = prismHull(points)
    expect(h.faces).toHaveLength(18)
    expect(h.edges).toHaveLength(48)
    expect(h.vertices).toHaveLength(32)
  })

  it('A12 벽 상자의 안쪽 면은 정확히 innerHalf(양자화 없음), 높이는 perimeter.height', () => {
    for (const season of ['none', 'biobuzz'] as const) {
      const field = resolveSeason(season)
      const shapes = staticShapes(field)
      expect(shapes.slice(0, 4).map((s) => s.token)).toEqual(['w0', 'w1', 'w2', 'w3'])
      const inner = field.perimeter.innerHalf
      const faceOf = (k: number, n: Vec3): number =>
        shapes[k].hull!.faces.find(
          (f) => f.normal.x === n.x && f.normal.y === n.y && f.normal.z === n.z
        )!.offset
      expect(faceOf(0, { x: -1, y: 0, z: 0 })).toBe(-inner)
      expect(faceOf(1, { x: 1, y: 0, z: 0 })).toBe(-inner)
      expect(faceOf(2, { x: 0, y: -1, z: 0 })).toBe(-inner)
      expect(faceOf(3, { x: 0, y: 1, z: 0 })).toBe(-inner)
      for (let k = 0; k < 4; k++)
        expect(faceOf(k, { x: 0, y: 0, z: 1 })).toBe(field.perimeter.height)
      expect(shapes[shapes.length - 1].token).toBe('fl')
    }
  })

  it('A13 구조물 규칙: 섀시는 solid만, 관절 몸체는 solid ∨ occludes, HIVE carrier는 둘 다 빠진다', () => {
    const field = resolveSeason('biobuzz')
    const shapes = staticShapes(field)
    const byIndex = new Map(
      shapes
        .filter((s) => s.target.kind === 'structure')
        .map((s) => [(s.target as { index: number }).index, s])
    )
    field.structures.forEach((s, i) => {
      const shape = byIndex.get(i)
      if (s.carrier !== 'field') expect(shape).toBeUndefined()
      else if (!s.solid && !s.occludes) expect(shape).toBeUndefined()
      else {
        expect(shape?.chassis).toBe(s.solid)
        expect(shape?.joints).toBe(true)
        expect(shape?.token).toBe(`s${i}`)
      }
    })
    // 위 막대(6)·로고 판(7, 8)은 관절 몸체만
    for (const i of [6, 7, 8])
      expect(byIndex.get(i)).toMatchObject({ chassis: false, joints: true })
  })

  it('A18 staticShapes는 얼린 FieldSpec마다 하나이고 깊게 얼어 있다', () => {
    const field = resolveSeason('biobuzz')
    const a = staticShapes(field)
    expect(staticShapes(field)).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
    expect(Object.isFrozen(a[0].hull)).toBe(true)
    expect(Object.isFrozen(a[0].hull!.vertices[0])).toBe(true)
    expect(Object.isFrozen(a[0].hull!.faces[0].vertices)).toBe(true)
  })
})

describe('편집 자세 겹침·시작 겹침', () => {
  const box = (center: Vec3, half: Vec3): SimCollider => ({
    kind: 'box',
    center,
    rotation: I,
    half,
    friction: 0.4
  })
  const frame = (origin: Vec3 = ZERO): EditPoseBody['frame'] => ({ rotation: I, origin })

  it('A19 editPoseOverlaps: 0.5 mm 겹침은 무시 안 함, 2 mm는 무시(depth 2e-3), 인접 짝 없음, 사전순, 떨어진 짝은 분리를 재지 않는다', () => {
    const chassis = box({ x: 0, y: 0, z: 0.1 }, { x: 0.2, y: 0.2, z: 0.1 })
    const bodies: EditPoseBody[] = [
      { body: -1, parent: -2, frame: frame(), colliders: [chassis] },
      // 관절 0(섀시의 자식)은 섀시와 깊게 겹쳐도 인접이라 짝이 아니다
      {
        body: 0,
        parent: -1,
        frame: frame({ x: 0, y: 0, z: 0.15 }),
        colliders: [box(ZERO, { x: 0.05, y: 0.05, z: 0.05 })]
      },
      // 관절 1(관절 0의 자식): 섀시 윗면과 2 mm 겹침
      {
        body: 1,
        parent: 0,
        frame: frame({ x: 0.1, y: 0, z: 0.2 + 0.03 - 2e-3 }),
        colliders: [box(ZERO, { x: 0.03, y: 0.03, z: 0.03 })]
      },
      // 관절 2(관절 0의 자식): 섀시 윗면과 0.5 mm 겹침
      {
        body: 2,
        parent: 0,
        frame: frame({ x: -0.1, y: 0, z: 0.2 + 0.03 - 5e-4 }),
        colliders: [box(ZERO, { x: 0.03, y: 0.03, z: 0.03 })]
      },
      // 관절 3: 멀리 떨어짐
      {
        body: 3,
        parent: -1,
        frame: frame({ x: 2, y: 2, z: 2 }),
        colliders: [box(ZERO, { x: 0.03, y: 0.03, z: 0.03 })]
      }
    ]
    const overlaps = editPoseOverlaps(bodies)
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0].a).toBe(-1)
    expect(overlaps[0].b).toBe(1)
    expect(Math.abs(overlaps[0].depth - 2e-3)).toBeLessThan(1e-12)
    // 순서: 거꾸로 줘도 (a, b) 사전순(관절 2를 3 mm 겹치게)
    const both = editPoseOverlaps([
      { ...bodies[3], frame: frame({ x: -0.1, y: 0, z: 0.2 + 0.03 - 3e-3 }) },
      bodies[2],
      bodies[1],
      bodies[0]
    ])
    expect(both.map((o) => [o.a, o.b])).toEqual([
      [-1, 1],
      [-1, 2]
    ])
    expect(both[1].depth).toBeCloseTo(3e-3, 12)
    // 떨어진 짝(관절 3 ↔ 나머지)은 분리를 재지 않는다(모서리 질의 0번)
    const before = SAT_COUNTERS.edgeQueries
    editPoseOverlaps([bodies[0], bodies[4]])
    expect(SAT_COUNTERS.edgeQueries).toBe(before)
    expect(EDIT_OVERLAP_TOLERANCE).toBe(1e-3)
  })

  function withShapes(change: Partial<WorldSpec>, chassis?: SimCollider[]): WorldSpec {
    const base = robotSpec({ start: { x: 0, y: -1.3, yaw: -Math.PI / 2 } }, change)
    return chassis ? { ...base, robot: { ...base.robot, colliders: chassis } } : base
  }

  it('A19 startOverlaps: 벽·구조물·바닥 대상, 섀시는 바퀴 있을 때만, 형상이 없으면 []', () => {
    const field = resolveSeason('biobuzz')
    expect(startOverlaps(robotSpec(), field)).toEqual([])
    // 빨강 벽(−y)에 2 cm 걸친 섀시 상자: 로봇 (0, −1.3), 요 −π/2(앞 = −Y), 반 깊이 0.5126(FLOWER와는 떨어짐)
    const chassis = [box({ x: 0, y: 0, z: 0.1 }, { x: 0.5126, y: 0.2, z: 0.1 })]
    const wall = startOverlaps(withShapes({}, chassis), field)
    expect(wall).toEqual([{ body: -1, targets: [{ kind: 'wall', wall: 'y-' }] }])
    // 바퀴가 없으면 섀시는 보지 않는다
    expect(startOverlaps(withShapes({ wheels: [] }, chassis), field)).toEqual([])
    // 관절 몸체: 바닥 아래로 2 cm, FLOWER <3>(순번 11)에 겹침
    const joint = (position: Vec3, colliders: SimCollider[]): WorldSpec['joints'][number] => ({
      parent: -1,
      type: 'prismatic',
      origin: { position, rotation: ZERO },
      axis: { x: 0, y: 0, z: 1 },
      limits: { lower: 0, upper: 0.3 },
      body: { mass: 0.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders
    })
    const spec = withShapes({
      wheels: [],
      joints: [
        joint({ x: 0, y: 0, z: 0.01 }, [box(ZERO, { x: 0.05, y: 0.05, z: 0.03 })]),
        // 로봇 (0, −1.3), 요 −π/2: 로봇 (x, y) → 필드 (y, −x)만큼. FLOWER <3>는 필드 x [0.519, 0.670], y [−1.793, −1.667]이라
        // 로봇 (0.43, 0.594) → 필드 (0.594, −1.73)
        joint({ x: 0.43, y: 0.594, z: 0.2 }, [box(ZERO, { x: 0.05, y: 0.05, z: 0.05 })])
      ]
    })
    expect(startOverlaps(spec, field)).toEqual([
      { body: 0, targets: [{ kind: 'floor' }] },
      { body: 1, targets: [{ kind: 'structure', index: 11 }] }
    ])
  })

  it('bodyShape·placeShape: 상자는 정확한 위상, 캡슐 끝점은 R·v + o, 짧은 선분은 구', () => {
    const shape = bodyShape({
      kind: 'capsule',
      a: ZERO,
      b: { x: 0.2, y: 0, z: 0 },
      radius: 0.02,
      friction: 0.4
    })
    expect(shape).toMatchObject({ kind: 'capsule', sphere: false, r: 0.02 })
    expect(shape!.radius).toBeCloseTo(0.22, 15)
    const placed = placeShape(shape!, {
      rotation: rotationMatrix({ x: 0, y: 0, z: Math.PI / 2 }),
      origin: { x: 1, y: 2, z: 3 }
    })
    expect(placed.kind).toBe('capsule')
    if (placed.kind === 'capsule') {
      expect(placed.b.x).toBeCloseTo(1, 15)
      expect(placed.b.y).toBeCloseTo(2.2, 15)
    }
    expect(
      bodyShape({
        kind: 'capsule',
        a: ZERO,
        b: { x: 5e-7, y: 0, z: 0 },
        radius: 0.02,
        friction: 0.4
      })
    ).toMatchObject({ sphere: true })
    const boxShape = bodyShape({
      kind: 'box',
      center: ZERO,
      rotation: I,
      half: { x: 0.1, y: 0.2, z: 0.3 },
      friction: 0.1
    })
    expect(boxShape?.kind === 'hull' && boxShape.hull.faces.length).toBe(6)
  })
})
