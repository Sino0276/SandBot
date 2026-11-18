import { describe, expect, it } from 'vitest'
import { solveBoxLcp } from '../articulation'
import { solveDenseLcp } from '../denseLcp'
import { solveIsland, UnionFind, type IslandRow } from './islands'

// 공 섬 풀이(6a, spec-6a §2.6): union-find 뿌리, 조밀 상자 LCP(denseLcp.ts)가 기존 solveBoxLcp와 같은 해, 엇갈림, PGS

// 결정적 의사 난수(시험 전용, xorshift32)
function random(seed: number): () => number {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
}

describe('공 섬(6a)', () => {
  it('union-find 뿌리는 가장 작은 번호다(합치는 순서와 관계없다)', () => {
    const uf = new UnionFind(6)
    uf.union(5, 3)
    uf.union(3, 4)
    uf.union(2, 5)
    expect([2, 3, 4, 5].map((i) => uf.find(i))).toEqual([2, 2, 2, 2])
    expect(uf.find(0)).toBe(0)
    expect(uf.find(1)).toBe(1)
  })

  it('조밀 상자 LCP는 무작위 양정치 상자 문제에서 solveBoxLcp와 같은 해다(1e-7)', () => {
    const next = random(12345)
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(next() * 12)
      // A = BᵀB + 대각(공 섬처럼 순응 있는 양정치)
      const rank = 1 + Math.floor(next() * 6)
      const bmat = Array.from({ length: rank }, () => Array.from({ length: n }, () => next() - 0.5))
      const a = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => {
          let s = 0
          for (const row of bmat) s += row[i] * row[j]
          return s + (i === j ? 0.01 + next() * 0.1 : 0)
        })
      )
      const b = Array.from({ length: n }, () => next() * 2 - 1)
      const lo = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 0 : -next()))
      const hi = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? Infinity : next()))
      const reference = solveBoxLcp(a, b, lo, hi)
      const flat = Float64Array.from(a.flat())
      const dense = solveDenseLcp(n, flat, Float64Array.from(b), lo, hi, new Uint8Array(n).fill(3))
      for (let i = 0; i < n; i++)
        expect(Math.abs(dense.lambda[i] - reference.lambda[i])).toBeLessThan(
          1e-7 * Math.max(1, Math.abs(reference.lambda[i]))
        )
      // 앞 답에서 시작해도 같은 해
      const warm = solveDenseLcp(
        n,
        flat,
        Float64Array.from(b),
        lo,
        hi,
        Uint8Array.from(dense.states)
      )
      expect(Array.from(warm.lambda)).toEqual(Array.from(dense.lambda))
    }
  })

  it('대각 문제(공 하나·접촉 하나)는 행마다 자른 값이다', () => {
    const a = Float64Array.from([2, 0, 0, 0, 4, 0, 0, 0, 5])
    const b = Float64Array.from([-1, -10, 1])
    const out = solveDenseLcp(3, a, b, [0, -1, -1], [Infinity, 1, 1], new Uint8Array(3).fill(3))
    expect(out.lambda[0]).toBeCloseTo(0.5, 8)
    expect(out.lambda[1]).toBe(1)
    expect(out.lambda[2]).toBeCloseTo(-0.2, 8)
    expect(Array.from(out.states)).toEqual([1, 2, 1])
  })

  // 공 하나가 바닥에 쉬는 섬(법선 + 접선 둘): 엇갈림 2회차를 건너뛰어도(정지 마찰) 1회차와 같은 해
  function restingRows(mu: number): IslandRow[] {
    const n = [0, 0, 1]
    const t1 = [1, 0, 0]
    const t2 = [0, 1, 0]
    const s = 0.0355
    const part = (d: number[], normal: boolean): { slot: number; a: number[] } => ({
      slot: 0,
      a: normal ? [...d, 0, 0, 0] : [...d, ...cross([-s * n[0], -s * n[1], -s * n[2]], d)]
    })
    return [
      {
        key: 'gn',
        parts: [part(n, true)],
        fixed: 0,
        target: 0.01,
        lo: 0,
        hi: Infinity,
        compliance: 30
      },
      {
        key: 'gt1',
        parts: [part(t1, false)],
        fixed: 0,
        target: 0,
        lo: 0,
        hi: 0,
        compliance: 0.4,
        friction: { normal: 'gn', mu },
        normalRow: 0
      },
      {
        key: 'gt2',
        parts: [part(t2, false)],
        fixed: 0,
        target: 0,
        lo: 0,
        hi: 0,
        compliance: 0.4,
        friction: { normal: 'gn', mu },
        normalRow: 0
      }
    ]
  }
  const cross = (a: number[], b: number[]): number[] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
  const bodies = { invMass: [1 / 0.0249], invInertia: [1 / 2e-5] }

  it('미끄러지는 공은 마찰 상자 경계(μ·λₙ)에 걸리고 쉬는 공은 정지 마찰이다', () => {
    const impulses = new Map<string, number>()
    // 옆으로 미끄러지며(1 m/s) 떨어지는 공
    const sliding = solveIsland(
      restingRows(0.45),
      bodies,
      [1, 0, -0.01, 0, 0, 0],
      () => 0.000244,
      new Map(),
      new Map(),
      true,
      impulses
    )
    const normal = impulses.get('gn')!
    expect(normal).toBeGreaterThan(0)
    expect(Math.abs(impulses.get('gt1')!)).toBeCloseTo(0.45 * normal, 12)
    expect(sliding[0]).toBeLessThan(1)
    const still = new Map<string, number>()
    solveIsland(
      restingRows(0.45),
      bodies,
      [0, 0, -0.01, 0, 0, 0],
      () => 0.000244,
      new Map(),
      new Map(),
      true,
      still
    )
    expect(Math.abs(still.get('gt1')!)).toBeLessThan(1e-12)
  })

  it('PGS(큰 섬)는 조밀 풀이에 가깝다', () => {
    const rows = restingRows(0.45)
    const dense = new Map<string, number>()
    const pgs = new Map<string, number>()
    const u = [0.3, 0, -0.01, 0, 0, 0]
    const a = solveIsland(rows, bodies, u, () => 0.000244, new Map(), new Map(), true, dense)
    const b = solveIsland(rows, bodies, u, () => 0.000244, new Map(), new Map(), false, pgs)
    for (let i = 0; i < 6; i++) expect(b[i]).toBeCloseTo(a[i], 3)
    expect(pgs.get('gn')).toBeCloseTo(dense.get('gn')!, 6)
  })
})
