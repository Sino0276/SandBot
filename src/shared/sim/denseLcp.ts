// 6a 공 행이 있는 상자 LCP(공 섬과 로봇 섬의 Schur 보수 풀이, spec-6a §2.5·§2.6). 순수·결정적이고 아무것도 import하지 않는다.
// articulation.ts solveBoxLcp(3b–5의 기준 해시가 기대는 풀이)는 바꾸지 않고, 공 행이 있는 새 경로만 이 풀이를 쓴다: 같은 블록 주축
// 전환 + Murty 틀이지만 근접점 반복이 없고(정칙화한 해) 작업 배열을 다시 써서 행이 수십 개인 로봇 섬에서 빠르다.

// 작업 배열(번호마다 하나, 커지기만 한다: 값은 매번 덮어쓰므로 결과에 영향이 없다)
const buffers: Float64Array[] = []
function work(index: number, size: number): Float64Array {
  const found = buffers[index]
  if (found && found.length >= size) return found
  const made = new Float64Array(Math.max(size, 64))
  buffers[index] = made
  return made
}

// 정규화(행마다 대각에 이 비율 × A_ii) [결정: articulation.ts solveBoxLcp의 LCP_REGULARIZATION과 같은 크기. 공 행의 A는 순응·공
// 질량으로 거의 늘 양정치라 근접점 반복 없이 정칙화한 해를 쓴다: 충격 차이는 1e-9배라 보이지 않는다. 특이한 방향(같은 방향의 로봇
// 행)에서는 정칙화가 나눔을 정하고, 속도(w) 차이는 1e-9 × A_ii·λ 아래다]
const DENSE_LCP_REGULARIZATION = 1e-9
// 상보성·경계 판정의 상대 허용 오차(solveBoxLcp와 같은 1e-12)와 반복 상한, 블록 전환을 그만두고 Murty 규칙만 쓰는 반복
const DENSE_LCP_TOLERANCE = 1e-12
const DENSE_LCP_MAX_ITERATIONS = 2000
// 비대각이 이 비율 × √(A_ii·A_jj) 아래면 행이 묶이지 않았다고 본다 [결정: 수직인 법선·접선의 내적 반올림(1e-16)보다 크고 풀이에
// 보이는 결합보다 훨씬 작다]
const DENSE_LCP_DECOUPLED = 1e-12
const DENSE_LCP_MURTY_AFTER = 200
const DENSE_LCP_TRIES = 3

// 조밀 상자 LCP: w = (A + εD)·λ + b, lo ≤ λ ≤ hi(λ = lo면 w ≥ 0, hi면 w ≤ 0, 사이면 w = 0). A는 행 우선 m×m. 블록
// 주축 전환(Júdice–Pires)과 Murty 최소 첨자 규칙(articulation.ts solveBoxLcp와 같은 틀)이고, 정칙화한 행렬이 대칭 양정치라 끝난다.
// 근접점 반복은 하지 않는다(DENSE_LCP_REGULARIZATION). start: 행마다 0 아래·1 자유·2 위·3 모름. 할당을 줄이려 타입 배열과 작업
// 배열(호출 사이에 다시 쓴다)만 쓴다
export function solveDenseLcp(
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
  // 행끼리 묶이지 않으면(비대각이 대각보다 DENSE_LCP_DECOUPLED배 넘게 작음) 행마다 따로 자른다. 공 하나·접촉 하나(법선 n, 접선
  // t1 ⟂ t2 ⟂ n)는 공 질량이 대각이고 법선 행의 각 부분이 0이라 A가 대각이다(바닥에서 쉬거나 구르는 공, 가장 흔한 섬)
  let decoupled = true
  for (let i = 0; i < m && decoupled; i++)
    for (let j = 0; j < m; j++)
      if (
        i !== j &&
        !(Math.abs(a[i * m + j]) <= DENSE_LCP_DECOUPLED * Math.sqrt(a[i * m + i] * a[j * m + j]))
      ) {
        decoupled = false
        break
      }
  if (decoupled) {
    for (let i = 0; i < m; i++) {
      const value = -b[i] / (a[i * m + i] * (1 + DENSE_LCP_REGULARIZATION))
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
  const tolW = DENSE_LCP_TOLERANCE * bScale
  const tolL = DENSE_LCP_TOLERANCE * lScale
  const free = work(0, m)
  const chol = work(1, m * m)
  const rhs = work(2, m)
  const bad = work(3, m)
  let best = m + 1
  let tries = DENSE_LCP_TRIES
  for (let iteration = 0; ; iteration++) {
    if (iteration >= DENSE_LCP_MAX_ITERATIONS)
      throw new Error('dense LCP: constraint solve did not converge')
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
          chol[p * f + q] = a[i * m + j] + (p === q ? DENSE_LCP_REGULARIZATION * a[i * m + i] : 0)
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
      let w = b[i] + DENSE_LCP_REGULARIZATION * a[i * m + i] * lambda[i]
      for (let j = 0; j < m; j++) w += a[i * m + j] * lambda[j]
      if ((state[i] === 0 && w < -tolW) || (state[i] === 2 && w > tolW)) bad[count++] = i
    }
    if (count === 0) break
    let from = 0
    if (iteration >= DENSE_LCP_MURTY_AFTER) from = count - 1
    else if (count < best) {
      best = count
      tries = DENSE_LCP_TRIES
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
