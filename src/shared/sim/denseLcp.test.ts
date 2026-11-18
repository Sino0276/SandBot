import { describe, expect, it } from 'vitest'
import {
  DENSE_LCP_COUNTERS,
  DENSE_LCP_DECOUPLED,
  DENSE_LCP_REGULARIZATION,
  solveDenseLcp
} from './denseLcp'

// 조밀 상자 LCP(6a)의 콜레스키 앞부분 다시 쓰기(성능, P6 쐐기)가 결과를 바꾸지 않는지: 다시 쓰기 전의 풀이(아래 referenceSolve,
// 그 판의 식을 그대로 옮긴 것: 반복마다 자유 행 부분 행렬을 처음부터 분해하고 A_FB·λ_B는 모든 행을 돈다)와 λ·상태가 비트로 같다.
// 같은 행렬을 다시 푸는 엇갈림 2회차, 앞부분만 같은 행렬, ±0만 다른 행렬, 작업 배열이 커지는 큰 행렬, 다른 풀이가 끼어든 순서를
// 모두 지나간다

const REGULARIZATION = DENSE_LCP_REGULARIZATION
const TOLERANCE = 1e-12
const MAX_ITERATIONS = 2000
const DECOUPLED = DENSE_LCP_DECOUPLED
const MURTY_AFTER = 200
const TRIES = 3

function referenceSolve(
  m: number,
  a: Float64Array,
  b: Float64Array,
  lo: readonly number[],
  hi: readonly number[],
  start: Uint8Array
): { lambda: Float64Array; states: Uint8Array } {
  const lambda = new Float64Array(m)
  const state = new Uint8Array(m)
  if (m === 0) return { lambda, states: state }
  let bScale = 1
  let lScale = 1
  for (let i = 0; i < m; i++) {
    if (!(a[i * m + i] > 0)) throw new Error('dense LCP: constraint row has no effect')
    bScale = Math.max(bScale, Math.abs(b[i]))
    if (Number.isFinite(lo[i])) lScale = Math.max(lScale, Math.abs(lo[i]))
    if (Number.isFinite(hi[i])) lScale = Math.max(lScale, Math.abs(hi[i]))
    const given = start[i]
    if (given === 0 && Number.isFinite(lo[i])) state[i] = 0
    else if (given === 2 && Number.isFinite(hi[i])) state[i] = 2
    else if (given === 1) state[i] = 1
    else state[i] = lo[i] === 0 ? 0 : hi[i] === 0 ? 2 : 1
  }
  // 행끼리 묶이지 않으면(비대각이 대각보다 DECOUPLED배 넘게 작음) 행마다 따로 자른다. 공 하나·접촉 하나(법선 n, 접선
  // t1 ⟂ t2 ⟂ n)는 공 질량이 대각이고 법선 행의 각 부분이 0이라 A가 대각이다(바닥에서 쉬거나 구르는 공, 가장 흔한 섬)
  let decoupled = true
  for (let i = 0; i < m && decoupled; i++)
    for (let j = 0; j < m; j++)
      if (
        i !== j &&
        !(Math.abs(a[i * m + j]) <= DECOUPLED * Math.sqrt(a[i * m + i] * a[j * m + j]))
      ) {
        decoupled = false
        break
      }
  if (decoupled) {
    for (let i = 0; i < m; i++) {
      const value = -b[i] / (a[i * m + i] * (1 + REGULARIZATION))
      if (value <= lo[i]) {
        lambda[i] = lo[i]
        state[i] = 0
      } else if (value >= hi[i]) {
        lambda[i] = hi[i]
        state[i] = 2
      } else {
        lambda[i] = value
        state[i] = 1
      }
    }
    return { lambda, states: state }
  }
  const tolW = TOLERANCE * bScale
  const tolL = TOLERANCE * lScale
  const free = new Float64Array(m)
  const chol = new Float64Array(m * m)
  const rhs = new Float64Array(m)
  const bad = new Float64Array(m)
  let best = m + 1
  let tries = TRIES
  for (let iteration = 0; ; iteration++) {
    if (iteration >= MAX_ITERATIONS) throw new Error('dense LCP: constraint solve did not converge')
    let f = 0
    for (let i = 0; i < m; i++) {
      if (state[i] === 1) free[f++] = i
      else lambda[i] = state[i] === 0 ? lo[i] : hi[i]
    }
    if (f > 0) {
      // (A + εD)_FF·λ_F = −(b_F + A_FB·λ_B), 콜레스키(LLᵀ, 양정치)
      for (let p = 0; p < f; p++) {
        const i = free[p]
        let s = -b[i]
        for (let j = 0; j < m; j++) if (state[j] !== 1) s -= a[i * m + j] * lambda[j]
        rhs[p] = s
        for (let q = 0; q <= p; q++) {
          const j = free[q]
          chol[p * f + q] = a[i * m + j] + (p === q ? REGULARIZATION * a[i * m + i] : 0)
        }
      }
      for (let p = 0; p < f; p++) {
        for (let q = 0; q <= p; q++) {
          let s = chol[p * f + q]
          for (let k = 0; k < q; k++) s -= chol[p * f + k] * chol[q * f + k]
          if (p === q) {
            if (!(s > 0)) throw new Error('dense LCP: matrix not positive definite')
            chol[p * f + p] = Math.sqrt(s)
          } else chol[p * f + q] = s / chol[q * f + q]
        }
      }
      for (let p = 0; p < f; p++) {
        let s = rhs[p]
        for (let k = 0; k < p; k++) s -= chol[p * f + k] * rhs[k]
        rhs[p] = s / chol[p * f + p]
      }
      for (let p = f - 1; p >= 0; p--) {
        let s = rhs[p]
        for (let k = p + 1; k < f; k++) s -= chol[k * f + p] * rhs[k]
        rhs[p] = s / chol[p * f + p]
      }
      for (let p = 0; p < f; p++) lambda[free[p]] = rhs[p]
    }
    let count = 0
    for (let i = 0; i < m; i++) {
      if (state[i] === 1) {
        if (lambda[i] < lo[i] - tolL || lambda[i] > hi[i] + tolL) bad[count++] = i
        continue
      }
      let w = b[i] + REGULARIZATION * a[i * m + i] * lambda[i]
      for (let j = 0; j < m; j++) w += a[i * m + j] * lambda[j]
      if ((state[i] === 0 && w < -tolW) || (state[i] === 2 && w > tolW)) bad[count++] = i
    }
    if (count === 0) break
    let from = 0
    if (iteration >= MURTY_AFTER) from = count - 1
    else if (count < best) {
      best = count
      tries = TRIES
    } else if (tries > 0) tries--
    else from = count - 1
    for (let k = from; k < count; k++) {
      const i = bad[k]
      if (state[i] === 1) state[i] = lambda[i] < lo[i] ? 0 : 2
      else state[i] = 1
    }
  }
  for (let i = 0; i < m; i++) lambda[i] = Math.min(hi[i], Math.max(lo[i], lambda[i]))
  return { lambda, states: state }
}

// 결정적 의사 난수(mulberry32)
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Problem = {
  m: number
  a: Float64Array
  b: Float64Array
  lo: number[]
  hi: number[]
  start: Uint8Array
}

// A = G·Gᵀ + 대각(rank < m이면 대각이 작아 조건수가 나쁘다: 주축 전환이 길어진다), 행 상자는 법선꼴 [0, ∞), 마찰꼴 [−c, c], 자유
// (−∞, ∞), 시작 상태는 0–3 아무것이나
function problem(next: () => number, m: number, rank: number, diagonal: number): Problem {
  const g = Array.from({ length: m }, () => Array.from({ length: rank }, () => 2 * next() - 1))
  const a = new Float64Array(m * m)
  for (let i = 0; i < m; i++)
    for (let j = 0; j <= i; j++) {
      let s = i === j ? diagonal * (0.5 + next()) : 0
      for (let k = 0; k < rank; k++) s += g[i][k] * g[j][k]
      a[i * m + j] = s
      a[j * m + i] = s
    }
  const lo: number[] = []
  const hi: number[] = []
  for (let i = 0; i < m; i++) {
    const kind = next()
    if (kind < 0.5) {
      lo.push(0)
      hi.push(Infinity)
    } else if (kind < 0.9) {
      const c = next()
      lo.push(-c)
      hi.push(c)
    } else {
      lo.push(-Infinity)
      hi.push(Infinity)
    }
  }
  return {
    m,
    a,
    b: Float64Array.from({ length: m }, () => 2 * next() - 1),
    lo,
    hi,
    start: Uint8Array.from({ length: m }, () => Math.floor(4 * next()))
  }
}

const NOT_CONVERGED = 'dense LCP: constraint solve did not converge'

// 답이 정칙화한 상자 LCP의 조건을 만족하는지: λ는 상자 안, 아래 경계 행은 w ≥ 0, 위 경계 행은 w ≤ 0, 자유 행은 w = 0
// (w = (A + εD)·λ + b). 경계 행의 부호는 풀이의 판정(1e-12·|b|)보다 넉넉히, 자유 행은 조건이 나쁜 행렬의 콜레스키 잔차(잰 값
// 1.3e-9·|b| 아래)보다 넉넉히 본다
function expectSolved(p: Problem, out: { lambda: Float64Array; states: Uint8Array }): void {
  const { m, a, b, lo, hi } = p
  let bScale = 1
  for (let i = 0; i < m; i++) bScale = Math.max(bScale, Math.abs(b[i]))
  for (let i = 0; i < m; i++) {
    expect(out.lambda[i]).toBeGreaterThanOrEqual(lo[i])
    expect(out.lambda[i]).toBeLessThanOrEqual(hi[i])
    let w = b[i] + REGULARIZATION * a[i * m + i] * out.lambda[i]
    for (let j = 0; j < m; j++) w += a[i * m + j] * out.lambda[j]
    if (out.states[i] === 0) expect(w).toBeGreaterThan(-1e-9 * bScale)
    else if (out.states[i] === 2) expect(w).toBeLessThan(1e-9 * bScale)
    else expect(Math.abs(w)).toBeLessThan(1e-7 * bScale)
  }
}

// 다시 쓰기 전 풀이와 같은 λ·상태(던지면 같은 글자로 던진다). 던졌으면 null. 다시 쓰기 전 풀이가 Murty 상한에서 던진 문제는
// 지금 풀이가 대체 규칙으로 풀 수 있다(6a 리뷰 3): 그때는 답이 상자 LCP 조건을 만족하는지 본다
function same(p: Problem): { lambda: Float64Array; states: Uint8Array } | null {
  let expected: { lambda: Float64Array; states: Uint8Array } | null = null
  let thrown: string | null = null
  try {
    expected = referenceSolve(p.m, p.a, p.b, p.lo, p.hi, p.start)
  } catch (error) {
    thrown = (error as Error).message
  }
  if (thrown === NOT_CONVERGED) {
    let solved: { lambda: Float64Array; states: Uint8Array } | null = null
    try {
      solved = solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)
    } catch (error) {
      expect((error as Error).message).toBe(NOT_CONVERGED)
    }
    if (solved) expectSolved(p, solved)
    return null
  }
  if (thrown !== null) {
    expect(() => solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)).toThrow(thrown)
    return null
  }
  const actual = solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)
  for (let i = 0; i < p.m; i++) {
    expect(Object.is(actual.lambda[i], expected?.lambda[i])).toBe(true)
    expect(actual.states[i]).toBe(expected?.states[i])
  }
  return actual
}

describe('조밀 상자 LCP 콜레스키 다시 쓰기(6a 성능)', () => {
  it('무작위 문제·엇갈림 2회차·앞부분만 같은 행렬·끼어든 풀이에서 다시 쓰기 전 풀이와 비트로 같다', () => {
    const next = random(0x6a)
    let solved = 0
    for (let round = 0; round < 120; round++) {
      const m = 2 + Math.floor(next() * (round < 100 ? 40 : 95))
      const wellConditioned = next() < 0.6
      const p = problem(
        next,
        m,
        wellConditioned ? m : Math.max(1, Math.floor(m / 3)),
        wellConditioned ? 1 : 1e-6
      )
      const first = same(p)
      if (!first) continue
      solved++
      // 엇갈림 2회차: 같은 행렬, 다른 상자·b, 앞 답에서 시작
      same({
        ...p,
        b: p.b.map((x) => x + 0.1 * (2 * next() - 1)),
        lo: p.lo.map((x) => (Number.isFinite(x) && x < 0 ? x * (0.5 + next()) : x)),
        hi: p.hi.map((x, i) => (Number.isFinite(x) && p.lo[i] < 0 ? -p.lo[i] * (0.5 + next()) : x)),
        start: first.states
      })
      // 앞 k행만 같은 행렬(그 뒤 값을 조금 바꾼다): 저장한 값과 비교해 앞부분만 다시 쓴다
      const k = Math.floor(next() * m)
      const a = Float64Array.from(p.a)
      for (let i = k; i < m; i++)
        for (let j = 0; j <= i; j++) {
          const v = a[i * m + j] * (1 + 1e-3 * next())
          a[i * m + j] = v
          a[j * m + i] = v
        }
      same({ ...p, a, start: first.states })
      // 다른 풀이가 끼어든 뒤 처음 행렬로 돌아온다
      same(problem(next, 1 + Math.floor(next() * 6), 3, 1))
      same({ ...p, start: first.states })
    }
    // 대부분은 풀리는 문제다(조건수가 나쁜 행렬은 반올림으로 양정치가 아니라고 던질 수 있다: 그때도 같은 곳에서 던진다)
    expect(solved).toBeGreaterThan(90)
  })

  it('A의 칸이 +0·−0만 다른 행렬을 번갈아 풀어도 다시 쓰기 전과 같다(저장 값은 +0을 더한 값이라 0의 부호가 지워진다)', () => {
    const next = random(7)
    for (let round = 0; round < 20; round++) {
      const p = problem(next, 12, 12, 1)
      // 행 1·0 칸을 +0, −0으로(대칭)
      const plus = Float64Array.from(p.a)
      plus[1 * 12 + 0] = 0
      plus[0 * 12 + 1] = 0
      const minus = Float64Array.from(plus)
      minus[1 * 12 + 0] = -0
      minus[0 * 12 + 1] = -0
      const all = new Uint8Array(12).fill(1)
      same({ ...p, a: plus, start: all })
      same({ ...p, a: minus, start: all })
      same({ ...p, a: plus, start: all })
    }
  })

  it('양정치가 아닌 행렬은 다시 쓰기 전과 같은 곳에서 던지고, 다음 풀이는 그 반쪽 분해를 쓰지 않는다', () => {
    const m = 4
    const a = new Float64Array([1, 0.5, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 2, 0, 0, 2, 1])
    const p: Problem = {
      m,
      a,
      b: new Float64Array([-1, -1, -1, -1]),
      lo: [-Infinity, -Infinity, -Infinity, -Infinity],
      hi: [Infinity, Infinity, Infinity, Infinity],
      start: new Uint8Array(m).fill(1)
    }
    expect(() => referenceSolve(p.m, p.a, p.b, p.lo, p.hi, p.start)).toThrow(
      'dense LCP: matrix not positive definite'
    )
    expect(() => solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)).toThrow(
      'dense LCP: matrix not positive definite'
    )
    // 같은 앞부분(행 0–1)에 양정치인 뒤를 붙인 행렬
    const fixed = Float64Array.from(a)
    fixed[2 * m + 3] = 0.25
    fixed[3 * m + 2] = 0.25
    same({ ...p, a: fixed })
  })
})

// 6a 리뷰 3: Murty 최소 첨자 규칙은 끝나는 것이 보장되지만 주축 수가 많을 수 있다. 상한(2000)에서 던지면 그 하위 단계의 로봇·
// 로봇 섬 공 속도가 0이 되었다(E2E 손 씬 로봇이 GARDEN 공으로 달려들 때, coupling.test.ts). 상한 뒤에는 가장 크게 어긋난 행
// 하나만 뒤집는 규칙으로 이어 간다
describe('조밀 상자 LCP: Murty 상한 뒤 대체 규칙(6a 리뷰 3)', () => {
  // 조건이 나쁜 문제(계수가 행 수의 1/2–1/4, 작은 대각)의 흐름. round번째 문제만 돌려준다(앞 문제도 만들어 난수를 같게 쓴다)
  function illConditioned(seed: number, round: number): Problem {
    const next = random(seed)
    let made: Problem | null = null
    for (let k = 0; k <= round; k++) {
      const m = 20 + Math.floor(next() * 80)
      const kind = Math.floor(next() * 3)
      const rank = kind === 0 ? m : Math.max(1, Math.floor(m / (2 + Math.floor(next() * 3))))
      made = problem(next, m, rank, kind === 0 ? 1 : kind === 1 ? 1e-3 : 1e-6)
    }
    return made as Problem
  }

  // 6a 최종 확인 2: 같은 규칙을 32번 뒤 96번 동안 일찍도 쓴다(DENSE_LCP_SINGLE_AFTER·DENSE_LCP_SINGLE_ITERATIONS). 6a 리뷰 3에서
  // Murty 상한(2000번)에 걸리던 흐름 1의 문제 여섯은 이제 상한 전에(79–120번) 끝난다
  it('32번 안에 끝나지 않은 풀이는 가장 크게 어긋난 행 규칙을 일찍 써서, Murty로는 2000번 안에 끝나지 않던 문제를 128번 안에 끝낸다', () => {
    const before = DENSE_LCP_COUNTERS.fallback
    for (const round of [9, 26, 33, 34, 40, 42]) {
      const p = illConditioned(1, round)
      // 일찍 쓰는 규칙이 없는 풀이(다시 쓰기 전 식)는 상한에서 던진다
      expect(() => referenceSolve(p.m, p.a, p.b, p.lo, p.hi, p.start)).toThrow(NOT_CONVERGED)
      const solved = solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)
      expect(solved.iterations).toBeGreaterThan(32)
      expect(solved.iterations).toBeLessThan(128)
      expectSolved(p, solved)
      // 같은 문제를 다시 풀면 같은 답이다(결정적, 앞 분해를 다시 써도)
      const again = solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)
      expect(again.states).toEqual(solved.states)
      for (let i = 0; i < p.m; i++) expect(Object.is(again.lambda[i], solved.lambda[i])).toBe(true)
      // 답에서 다시 시작하면 주축 없이 같은 답이다
      const warm = solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, solved.states)
      expect(warm.iterations).toBe(0)
      for (let i = 0; i < p.m; i++) expect(Object.is(warm.lambda[i], solved.lambda[i])).toBe(true)
    }
    // 상한 뒤 대체 규칙에는 닿지 않았다
    expect(DENSE_LCP_COUNTERS.fallback).toBe(before)
  })

  it('일찍 쓴 규칙으로도 Murty 상한 안에 끝나지 않는 문제를 상한 뒤 대체 규칙으로 이어 풀고 답은 상자 LCP 조건을 만족한다', () => {
    const before = DENSE_LCP_COUNTERS.fallback
    // 흐름 3·4·5의 78–99행 문제 다섯(상한 뒤 15–101번 더 돈다)
    const hard: [number, number][] = [
      [3, 38],
      [4, 84],
      [4, 117],
      [4, 135],
      [5, 129]
    ]
    for (const [seed, round] of hard) {
      const p = illConditioned(seed, round)
      const solved = solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)
      expect(solved.iterations).toBeGreaterThan(2000)
      expectSolved(p, solved)
      // 같은 문제를 다시 풀면 같은 답이다(결정적, 앞 분해를 다시 써도)
      const again = solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)
      expect(again.states).toEqual(solved.states)
      for (let i = 0; i < p.m; i++) expect(Object.is(again.lambda[i], solved.lambda[i])).toBe(true)
      // 답에서 다시 시작하면 주축 없이 같은 답이다
      const warm = solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, solved.states)
      for (let i = 0; i < p.m; i++) expect(Object.is(warm.lambda[i], solved.lambda[i])).toBe(true)
    }
    // 풀이마다 한 번씩 상한 뒤 대체 규칙으로 넘어갔다(답에서 다시 시작한 풀이는 넘어가지 않는다)
    expect(DENSE_LCP_COUNTERS.fallback - before).toBe(2 * hard.length)
  })

  it('32번 안에 끝나는 문제는 연산이 그대로이고(다시 쓰기 전 풀이와 비트로 같다), 일찍 쓴 규칙을 지나 끝난 문제도 답이 같다', () => {
    const before = DENSE_LCP_COUNTERS.fallback
    let solved = 0
    let early = 0
    // 흐름 1의 앞 아홉: 여섯은 5–9번, 셋(2·7·8번째)은 일찍 쓴 규칙을 지나 45–73번에 끝난다
    for (const round of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const out = same(illConditioned(1, round))
      if (!out) continue
      solved++
      const p = illConditioned(1, round)
      if (solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start).iterations > 32) early++
    }
    expect(solved).toBe(9)
    expect(early).toBe(3)
    expect(DENSE_LCP_COUNTERS.fallback).toBe(before)
  })

  it('상한 뒤 대체 규칙도 끝나지 않으면 전처럼 던진다', () => {
    // 흐름 5의 33번째(84행): 가장 크게 어긋난 행 규칙이 돌고 돈다
    const p = illConditioned(5, 33)
    expect(() => solveDenseLcp(p.m, p.a, p.b, p.lo, p.hi, p.start)).toThrow(NOT_CONVERGED)
  })
})
