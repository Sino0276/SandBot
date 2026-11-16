import { describe, expect, it } from 'vitest'
import { DENSE_LCP_DECOUPLED, DENSE_LCP_REGULARIZATION, solveDenseLcp } from './denseLcp'

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

// 다시 쓰기 전 풀이와 같은 λ·상태(던지면 같은 글자로 던진다). 던졌으면 null
function same(p: Problem): { lambda: Float64Array; states: Uint8Array } | null {
  let expected: { lambda: Float64Array; states: Uint8Array } | null = null
  let thrown: string | null = null
  try {
    expected = referenceSolve(p.m, p.a, p.b, p.lo, p.hi, p.start)
  } catch (error) {
    thrown = (error as Error).message
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
