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

// 마지막 콜레스키 분해(자유 행 부분 행렬 (A + εD)_FF = LLᵀ). L의 p행은 자유 행 0..p의 부분 행렬 값만으로 정해지므로, 다음 분해의
// 앞 k행이 같은 값이면 그 L 행을 그대로 다시 쓴다(같은 값에 같은 연산이라 비트로 같다: 결과는 다시 쓰지 않은 풀이와 바이트까지
// 같다). 한 풀이 안에서는 행렬이 그대로라 자유 행 번호가 앞에서부터 같은 동안이 다시 쓸 수 있는 앞부분이다(Murty 단계는 가장 큰
// 첨자 하나만 바꾼다). 풀이가 바뀌면(엇갈림 2회차처럼 같은 행렬을 다시 푸는 호출) 저장한 부분 행렬 값과 지금 값을 Object.is로
// 비교해 같은 앞부분만 쓴다(성능, 6a P6 쐐기)
const factor = {
  // 행 간격(자유 행 수의 상한, 커지면 다시 만들고 비운다)
  stride: 0,
  // values[p·stride + q](q ≤ p): L을 만든 정칙화 부분 행렬 값, chol: 같은 자리의 L
  values: new Float64Array(0),
  chol: new Float64Array(0),
  // 자유 행 번호(owner 풀이의 행 번호)와 맞는 L 행 수
  rows: new Int32Array(0),
  length: 0,
  owner: 0
}
// 풀이 번호(factor.owner와 비교: 같은 풀이면 행렬이 같다)
let solveCount = 0
function factorCapacity(size: number): void {
  if (factor.stride >= size) return
  const stride = Math.max(size, 2 * factor.stride, 64)
  factor.stride = stride
  factor.values = new Float64Array(stride * stride)
  factor.chol = new Float64Array(stride * stride)
  factor.rows = new Int32Array(stride)
  factor.length = 0
}

// 정규화(행마다 대각에 이 비율 × A_ii) [결정: articulation.ts solveBoxLcp의 LCP_REGULARIZATION과 같은 크기. 공 행의 A는 순응·공
// 질량으로 거의 늘 양정치라 근접점 반복 없이 정칙화한 해를 쓴다: 충격 차이는 1e-9배라 보이지 않는다. 특이한 방향(같은 방향의 로봇
// 행)에서는 정칙화가 나눔을 정하고, 속도(w) 차이는 1e-9 × A_ii·λ 아래다]
export const DENSE_LCP_REGULARIZATION = 1e-9
// 상보성·경계 판정의 상대 허용 오차(solveBoxLcp와 같은 1e-12)와 Murty 규칙의 반복 상한, 블록 전환을 그만두고 Murty 규칙만 쓰는 반복
const DENSE_LCP_TOLERANCE = 1e-12
const DENSE_LCP_MAX_ITERATIONS = 2000
// Murty 상한을 넘은 뒤 대체 규칙(가장 크게 어긋난 행 하나만 뒤집기)의 반복 상한[결정: 6a 리뷰 3. Murty 최소 첨자 규칙은 끝나는 것이
// 보장되지만 주축 수가 많을 수 있다: E2E 손 씬 로봇이 GARDEN 공으로 달려들어 공이 섀시·롤러·벽·바닥·이웃 공 사이에 끼이는 하위
// 단계의 로봇 섬 LCP(85–102행) 열여섯이 2061–8744번이었다(상한에서 던지면 그 하위 단계의 로봇·로봇 섬 공 속도가 0이 된다). 같은
// 문제를 상한에서 대체 규칙으로 이으면 6–64번에 끝났다. 대체 규칙은 끝나는 것이 보장되지 않아(돌고 돌 수 있다) 상한을 둔다:
// Murty 상한에 걸린 조건이 나쁜 무작위 문제 144개(20–99행, 계수가 행 수의 1/2–1/4) 가운데 138개가 152번 안에 끝났고 나머지 여섯은
// 20000번에도 끝나지 않았다. Murty 상한 안에 끝나는 풀이는 대체 규칙에 닿지 않아 바이트 그대로다]
const DENSE_LCP_FALLBACK_ITERATIONS = 500
// 같은 규칙(가장 크게 어긋난 행 하나만 뒤집기)을 일찍도 한 번 쓴다: DENSE_LCP_SINGLE_AFTER번 안에 끝나지 않은 풀이는 그 뒤
// DENSE_LCP_SINGLE_ITERATIONS번 동안 이 규칙으로 돌고, 그래도 끝나지 않으면 그 상태에서 원래 차례(블록 전환 → Murty → 상한 뒤
// 대체 규칙)를 이어 간다(끝나는 것은 Murty가 보장한다)[결정: 6a 최종 확인 2. 답에서 행 상태 4–5개만 다른 시작(마찰 상자
// 엇갈림의 다른 회차 답, articulation.ts constrainedCoupled)에서도 블록 전환과 Murty가 100–750번을 돌았다(104행, 번마다 약
// 0.2 ms). 이 규칙은 그런 풀이를 몇 번에 끝낸다: E2E 손 씬 로봇이 인테이크를 켜고 출력 0.4로 6 s 미는 실행의 주축 반복이
// 5446–16667번에서 3221–6407번으로 줄고, 달려들기에서 Murty 상한에 걸리던 풀이(출력 0.7·1)도 상한 전에 끝난다.
// DENSE_LCP_SINGLE_AFTER번 안에 끝나는 풀이는 이 길에 닿지 않아 연산이 그대로다. 더 일찍(8·16번) 시작하면 E2E 손 씬 오프라인
// 출력이 바뀌거나 같은 실행이 4만–5만 번으로 늘었다]
const DENSE_LCP_SINGLE_AFTER = 32
const DENSE_LCP_SINGLE_ITERATIONS = 96
// 비대각이 이 비율 × √(A_ii·A_jj) 아래면 행이 묶이지 않았다고 본다 [결정: 수직인 법선·접선의 내적 반올림(1e-16)보다 크고 풀이에
// 보이는 결합보다 훨씬 작다]
export const DENSE_LCP_DECOUPLED = 1e-12
const DENSE_LCP_MURTY_AFTER = 200
const DENSE_LCP_TRIES = 3

// 시험 훅(제품 코드는 쓰지 않는다): Murty 상한을 넘어 대체 규칙으로 넘어간 풀이 수, 같은 규칙을 일찍 쓴(DENSE_LCP_SINGLE_AFTER번
// 안에 끝나지 않은) 풀이 수, 행이 묶인 풀이들의 주축 반복 수 합
export const DENSE_LCP_COUNTERS = { fallback: 0, early: 0, iterations: 0 }

// 조밀 상자 LCP: w = (A + εD)·λ + b, lo ≤ λ ≤ hi(λ = lo면 w ≥ 0, hi면 w ≤ 0, 사이면 w = 0). A는 행 우선 m×m. 블록
// 주축 전환(Júdice–Pires)과 Murty 최소 첨자 규칙(articulation.ts solveBoxLcp와 같은 틀)이고, 정칙화한 행렬이 대칭 양정치라 끝난다.
// Murty 규칙이 상한(DENSE_LCP_MAX_ITERATIONS) 안에 끝나지 않으면 던지지 않고, 가장 크게 어긋난 행 하나만 뒤집는 규칙으로 이어
// 간다(DENSE_LCP_FALLBACK_ITERATIONS, 그래도 끝나지 않으면 던진다). 같은 규칙을 DENSE_LCP_SINGLE_AFTER번 안에 끝나지 않은
// 풀이에도 DENSE_LCP_SINGLE_ITERATIONS번 동안 일찍 쓴다. 답은 끝난 상태(자유·경계 나눔)로 정해지므로 어느 규칙으로
// 닿았든 같은 상태면 같은 λ다. 근접점 반복은 하지 않는다(DENSE_LCP_REGULARIZATION). start: 행마다 0 아래·1 자유·2 위·3 모름.
// 할당을 줄이려 타입 배열과 작업 배열(호출 사이에 다시 쓴다)만 쓴다. iterations: 시작 상태에서 답까지 상태를 바꾼 횟수(시작
// 상태가 답이면 0, 행이 묶이지 않은 풀이도 0. 부르는 쪽이 시작 상태를 고르는 데 쓴다: articulation.ts constrainedCoupled)
export function solveDenseLcp(
  m: number,
  a: Float64Array,
  b: Float64Array,
  lo: readonly number[],
  hi: readonly number[],
  start: Uint8Array
): { lambda: Float64Array; states: Uint8Array; iterations: number } {
  const lambda = new Float64Array(m)
  const state = new Uint8Array(m)
  if (m === 0) return { lambda, states: state, iterations: 0 }
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
    return { lambda, states: state, iterations: 0 }
  }
  const tolW = DENSE_LCP_TOLERANCE * bScale
  const tolL = DENSE_LCP_TOLERANCE * lScale
  const free = work(0, m)
  const rhs = work(2, m)
  const bad = work(3, m)
  const bounded = work(4, m)
  factorCapacity(m)
  const call = ++solveCount
  const stride = factor.stride
  const values = factor.values
  const chol = factor.chol
  const rows = factor.rows
  let best = m + 1
  let tries = DENSE_LCP_TRIES
  let iterations = 0
  for (let iteration = 0; ; iteration++) {
    // Murty 상한을 넘으면 대체 규칙(아래). 같은 규칙을 DENSE_LCP_SINGLE_AFTER번 뒤에도 잠깐 쓴다
    const fallback =
      iteration >= DENSE_LCP_MAX_ITERATIONS ||
      (iteration >= DENSE_LCP_SINGLE_AFTER &&
        iteration < DENSE_LCP_SINGLE_AFTER + DENSE_LCP_SINGLE_ITERATIONS)
    if (iteration >= DENSE_LCP_MAX_ITERATIONS + DENSE_LCP_FALLBACK_ITERATIONS)
      throw new Error('dense LCP: constraint solve did not converge')
    let f = 0
    let g = 0
    for (let i = 0; i < m; i++) {
      if (state[i] === 1) free[f++] = i
      else {
        lambda[i] = state[i] === 0 ? lo[i] : hi[i]
        bounded[g++] = i
      }
    }
    if (f > 0) {
      // (A + εD)_FF·λ_F = −(b_F + A_FB·λ_B), 콜레스키(LLᵀ, 양정치). A_FB·λ_B는 경계 행 오름차순(자유 행을 건너뛰고 모든 행을 도는
      // 것과 같은 순서의 같은 합)
      for (let p = 0; p < f; p++) {
        const i = free[p]
        let s = -b[i]
        for (let t = 0; t < g; t++) {
          const j = bounded[t]
          s -= a[i * m + j] * lambda[j]
        }
        rhs[p] = s
      }
      // 다시 쓸 수 있는 L 앞부분(factor 주석)
      let reuse = 0
      const limit = Math.min(f, factor.length)
      if (factor.owner === call) while (reuse < limit && rows[reuse] === free[reuse]) reuse++
      else {
        for (; reuse < limit; reuse++) {
          const i = free[reuse]
          let same = true
          for (let q = 0; q <= reuse && same; q++) {
            const j = free[q]
            const value = a[i * m + j] + (reuse === q ? DENSE_LCP_REGULARIZATION * a[i * m + i] : 0)
            same = Object.is(value, values[reuse * stride + q])
          }
          if (!same) break
          rows[reuse] = i
        }
        factor.owner = call
      }
      factor.length = reuse
      for (let p = reuse; p < f; p++) {
        const i = free[p]
        rows[p] = i
        for (let q = 0; q <= p; q++) {
          const j = free[q]
          const value = a[i * m + j] + (p === q ? DENSE_LCP_REGULARIZATION * a[i * m + i] : 0)
          values[p * stride + q] = value
          chol[p * stride + q] = value
        }
        for (let q = 0; q <= p; q++) {
          let s = chol[p * stride + q]
          for (let k = 0; k < q; k++) s -= chol[p * stride + k] * chol[q * stride + k]
          if (p === q) {
            if (!(s > 0)) throw new Error('dense LCP: matrix not positive definite')
            chol[p * stride + p] = Math.sqrt(s)
          } else chol[p * stride + q] = s / chol[q * stride + q]
        }
        factor.length = p + 1
      }
      for (let p = 0; p < f; p++) {
        let s = rhs[p]
        for (let k = 0; k < p; k++) s -= chol[p * stride + k] * rhs[k]
        rhs[p] = s / chol[p * stride + p]
      }
      for (let p = f - 1; p >= 0; p--) {
        let s = rhs[p]
        for (let k = p + 1; k < f; k++) s -= chol[k * stride + p] * rhs[k]
        rhs[p] = s / chol[p * stride + p]
      }
      for (let p = 0; p < f; p++) lambda[free[p]] = rhs[p]
    }
    let count = 0
    // 대체 규칙: 가장 크게 어긋난 행과 그 크기(w 단위: 자유 행이 상자를 벗어난 만큼은 대각을 곱한다). 같으면 앞 행
    let worst = -1
    let worstBy = 0
    for (let i = 0; i < m; i++) {
      if (state[i] === 1) {
        if (lambda[i] < lo[i] - tolL || lambda[i] > hi[i] + tolL) {
          bad[count++] = i
          if (fallback) {
            const by = (lambda[i] < lo[i] ? lo[i] - lambda[i] : lambda[i] - hi[i]) * a[i * m + i]
            if (by > worstBy) {
              worst = i
              worstBy = by
            }
          }
        }
        continue
      }
      let w = b[i] + DENSE_LCP_REGULARIZATION * a[i * m + i] * lambda[i]
      for (let j = 0; j < m; j++) w += a[i * m + j] * lambda[j]
      if ((state[i] === 0 && w < -tolW) || (state[i] === 2 && w > tolW)) {
        bad[count++] = i
        if (fallback && Math.abs(w) > worstBy) {
          worst = i
          worstBy = Math.abs(w)
        }
      }
    }
    if (count === 0) {
      iterations = iteration
      break
    }
    if (fallback) {
      if (iteration === DENSE_LCP_MAX_ITERATIONS) DENSE_LCP_COUNTERS.fallback++
      else if (iteration === DENSE_LCP_SINGLE_AFTER) DENSE_LCP_COUNTERS.early++
      const i = worst >= 0 ? worst : bad[count - 1]
      if (state[i] === 1) state[i] = lambda[i] < lo[i] ? 0 : 2
      else state[i] = 1
      continue
    }
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
  DENSE_LCP_COUNTERS.iterations += iterations
  return { lambda, states: state, iterations }
}
