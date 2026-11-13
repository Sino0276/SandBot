import type { LcpState } from '../articulation'
import { solveDenseLcp } from '../denseLcp'
import { PGS_SWEEPS } from './elementData'

// 공 섬(6a, spec-6a §2.6): union-find(뿌리 = 가장 작은 번호)와 로봇에 닿지 않은 공 섬의 풀이. 섬 하나는 공 몇 개와 그 행(정적·
// 공끼리·한쪽으로만 푸는 로봇 행)이고, 공은 대각 질량이라 A = Σ aᵀW a + γ를 바로 만든다. 행이 ISLAND_DENSE_ROWS 이하면
// 조밀 상자 LCP(denseLcp.ts solveDenseLcp: solveBoxLcp와 같은 주축 전환 틀, 마찰 상자 엇갈림 2회, 앞 하위 단계 상태로 시작), 넘으면 고정 횟수
// PGS다.
// 순수·결정적이다(배열 순서만 쓴다. Map은 키로 찾기만 한다).

export class UnionFind {
  private readonly parent: Int32Array

  constructor(n: number) {
    this.parent = new Int32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
  }

  find(i: number): number {
    let root = i
    while (this.parent[root] !== root) root = this.parent[root]
    // 경로 압축(결과 뿌리는 같다)
    while (this.parent[i] !== root) {
      const next = this.parent[i]
      this.parent[i] = root
      i = next
    }
    return root
  }

  // 뿌리는 둘 가운데 작은 번호
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    if (ra < rb) this.parent[rb] = ra
    else this.parent[ra] = rb
  }
}

// 섬 풀이의 행 하나. parts: 섬 안 공(slot = 섬 안 순번)의 6-벡터 a, fixed: 섬 밖에서 정해진 속도 몫(한쪽으로만 푸는 로봇·섬
// 밖 공의 a·u, 행 속도에 더한다). friction이 있으면 상자는 ±μ·λ_법선(lo·hi 무시)이고 normalRow는 그 법선 행의 섬 행 순번(같은
// 짝이라 같은 섬에 있다)
export type IslandRow = {
  key: string
  parts: readonly { slot: number; a: readonly number[] }[]
  fixed: number
  target: number
  lo: number
  hi: number
  compliance: number
  friction?: { normal: string; mu: number }
  normalRow?: number
}

export type IslandBodies = {
  invMass: readonly number[]
  invInertia: readonly number[]
}

// 두 행의 Σ_{같은 slot} aᵀW a
function block(k: IslandRow, l: IslandRow, bodies: IslandBodies): number {
  let sum = 0
  for (const p of k.parts)
    for (const q of l.parts) {
      if (p.slot !== q.slot) continue
      const im = bodies.invMass[p.slot]
      const ii = bodies.invInertia[p.slot]
      sum += im * (p.a[0] * q.a[0] + p.a[1] * q.a[1] + p.a[2] * q.a[2])
      sum += ii * (p.a[3] * q.a[3] + p.a[4] * q.a[4] + p.a[5] * q.a[5])
    }
  return sum
}

function rate(row: IslandRow, u: ArrayLike<number>): number {
  let sum = row.fixed
  for (const p of row.parts) {
    const o = 6 * p.slot
    const a = p.a
    sum +=
      a[0] * u[o] +
      a[1] * u[o + 1] +
      a[2] * u[o + 2] +
      a[3] * u[o + 3] +
      a[4] * u[o + 4] +
      a[5] * u[o + 5]
  }
  return sum
}

function apply(row: IslandRow, lambda: number, bodies: IslandBodies, u: number[]): void {
  if (lambda === 0) return
  for (const p of row.parts) {
    const o = 6 * p.slot
    const im = bodies.invMass[p.slot] * lambda
    const ii = bodies.invInertia[p.slot] * lambda
    for (let i = 0; i < 3; i++) {
      u[o + i] += im * p.a[i]
      u[o + 3 + i] += ii * p.a[3 + i]
    }
  }
}

// 행의 상자(마찰 행은 normal(키) 충격 × μ, 0이면 행을 넣지 않는다: articulation.ts externalRows와 같은 규칙, PGS가 쓴다)
function bounds(
  row: IslandRow,
  normal: (key: string) => number
): { lo: number; hi: number } | null {
  if (!row.friction) return { lo: row.lo, hi: row.hi }
  const bound = row.friction.mu * Math.max(0, normal(row.friction.normal))
  return bound > 0 ? { lo: -bound, hi: bound } : null
}

// 섬 하나를 푼다: uStar(slot마다 [v; ω] 6개, 자유 예측)에서 u⁺를 돌려주고 행 키 → 충격을 impulses에 넣는다. previous(키)는 앞
// 하위 단계의 법선 충격(이번 h로 바꾼 것, 엇갈림 1회차), states는 키 → 앞 LCP 상태, nextStates에 이 섬 행의 상태를 넣는다.
// dense면 마찰 상자 엇갈림 2회(1회차는 앞 하위 단계 법선, 2회차는 1회차 법선: articulation.ts와 같은 규칙)의 조밀 상자 LCP
// (solveDenseLcp), 아니면 PGS_SWEEPS번 Gauss–Seidel(행 순서, 앞 충격으로 시작, 마찰 상자는 그때의 법선 충격)이다
export function solveIsland(
  rows: readonly IslandRow[],
  bodies: IslandBodies,
  uStar: readonly number[],
  previous: (key: string) => number,
  states: ReadonlyMap<string, LcpState>,
  nextStates: Map<string, LcpState>,
  dense: boolean,
  impulses: Map<string, number>
): number[] {
  if (rows.length === 0) return uStar.slice()
  if (!dense) return solvePgs(rows, bodies, uStar, previous, impulses)
  const n = rows.length
  // 전체 A(행 순서)와 b, 앞 상태는 한 번만 만든다
  const full = scratch.full(n * n)
  for (let k = 0; k < n; k++)
    for (let l = k; l < n; l++) {
      const value = block(rows[k], rows[l], bodies) + (k === l ? rows[k].compliance : 0)
      full[k * n + l] = value
      full[l * n + k] = value
    }
  const bFull = scratch.bFull(n)
  const startFull = scratch.startFull(n)
  let staggered = false
  for (let k = 0; k < n; k++) {
    const row = rows[k]
    bFull[k] = rate(row, uStar) - row.target
    const given = states.get(row.key)
    startFull[k] = given === 'lower' ? 0 : given === 'upper' ? 2 : given === 'free' ? 1 : 3
    if (row.friction) staggered = true
  }
  const lambdaFull = new Float64Array(n)
  const stateFull = new Uint8Array(n)
  const used = scratch.used(n)
  const lo: number[] = []
  const hi: number[] = []
  // 마찰 상자를 normal(행 순번)로 정한 한 번의 풀이(상자가 0인 마찰 행은 넣지 않는다)
  const pass = (normal: (k: number) => number): void => {
    let m = 0
    lo.length = 0
    hi.length = 0
    for (let k = 0; k < n; k++) {
      const row = rows[k]
      if (!row.friction) {
        used[m++] = k
        lo.push(row.lo)
        hi.push(row.hi)
        continue
      }
      const bound = row.friction.mu * Math.max(0, normal(k))
      if (!(bound > 0)) continue
      used[m++] = k
      lo.push(-bound)
      hi.push(bound)
    }
    const a = scratch.a(m * m)
    const b = scratch.b(m)
    const start = scratch.start(m)
    for (let i = 0; i < m; i++) {
      const row = used[i]
      b[i] = bFull[row]
      start[i] = startFull[row]
      for (let j = 0; j < m; j++) a[i * m + j] = full[row * n + used[j]]
    }
    const solved = solveDenseLcp(m, a, b, lo, hi, start)
    lambdaFull.fill(0)
    stateFull.fill(3)
    for (let i = 0; i < m; i++) {
      lambdaFull[used[i]] = solved.lambda[i]
      stateFull[used[i]] = solved.states[i]
    }
  }
  pass((k) => previous(rows[rows[k].normalRow ?? -1]?.key ?? ''))
  // 2회차는 1회차 해가 2회차 문제의 해이기도 하면 건너뛴다: 모든 마찰 행이 1회차에 들어가 자유(상자 경계가 아님)였고 새 상자
  // ±μ·λ₁_법선 안이면 같은 해다(정칙화한 행렬이 양정치라 해가 하나). 쉬거나 구르는 공(정지 마찰)이 대부분 그렇다
  if (staggered && !sameSecondPass(rows, lambdaFull, stateFull)) {
    const first = Float64Array.from(lambdaFull)
    pass((k) => {
      const normal = rows[k].normalRow ?? -1
      return normal >= 0 ? first[normal] : 0
    })
  }
  const u = uStar.slice()
  for (let k = 0; k < n; k++) {
    const row = rows[k]
    apply(row, lambdaFull[k], bodies, u)
    impulses.set(row.key, lambdaFull[k])
    if (stateFull[k] !== 3) nextStates.set(row.key, STATE_NAMES[stateFull[k]])
  }
  return u
}

// 섬 풀이의 작업 배열(호출 사이에 다시 쓴다: 값은 매번 덮어쓰므로 결과에 영향이 없다)
class Scratch {
  private buffers = new Map<string, Float64Array | Uint8Array | Int32Array>()
  private get<T extends Float64Array | Uint8Array | Int32Array>(
    name: string,
    size: number,
    make: (size: number) => T
  ): T {
    const found = this.buffers.get(name) as T | undefined
    if (found && found.length >= size) return found
    const made = make(Math.max(size, 16))
    this.buffers.set(name, made)
    return made
  }
  full = (size: number): Float64Array => this.get('full', size, (k) => new Float64Array(k))
  bFull = (size: number): Float64Array => this.get('bFull', size, (k) => new Float64Array(k))
  startFull = (size: number): Uint8Array => this.get('startFull', size, (k) => new Uint8Array(k))
  used = (size: number): Int32Array => this.get('used', size, (k) => new Int32Array(k))
  a = (size: number): Float64Array => this.get('a', size, (k) => new Float64Array(k))
  b = (size: number): Float64Array => this.get('b', size, (k) => new Float64Array(k))
  start = (size: number): Uint8Array => this.get('start', size, (k) => new Uint8Array(k))
}
const scratch = new Scratch()

const STATE_NAMES: readonly LcpState[] = ['lower', 'free', 'upper']

// 엇갈림 2회차가 1회차와 같은 해를 낼지(위 주석): 마찰 행마다 1회차 상태가 자유(1)이고 |λ| ≤ μ·max(0, λ₁_법선)
function sameSecondPass(
  rows: readonly IslandRow[],
  lambda: Float64Array,
  state: Uint8Array
): boolean {
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k]
    if (!row.friction) continue
    if (state[k] !== 1) return false
    const normal = row.normalRow ?? -1
    const bound = row.friction.mu * Math.max(0, normal >= 0 ? lambda[normal] : 0)
    if (!(Math.abs(lambda[k]) <= bound)) return false
  }
  return true
}

// 고정 횟수 PGS(큰 섬). 행 순서대로 λ_k ← proj(λ_k − w_k/A_kk), w_k = 행 속도 + γλ − 목표. 앞 하위 단계 충격으로 시작한다
function solvePgs(
  rows: readonly IslandRow[],
  bodies: IslandBodies,
  uStar: readonly number[],
  previous: (key: string) => number,
  impulses: Map<string, number>
): number[] {
  const u = uStar.slice()
  const n = rows.length
  const diag = rows.map((row) => block(row, row, bodies) + row.compliance)
  const lambda = new Array<number>(n).fill(0)
  const index = new Map<string, number>()
  rows.forEach((row, k) => index.set(row.key, k))
  // 앞 충격으로 시작(마찰은 법선 상자 안으로)
  rows.forEach((row, k) => {
    const start = previous(row.key)
    if (!(start !== 0 && Number.isFinite(start))) return
    const box = bounds(row, previous) ?? { lo: 0, hi: 0 }
    lambda[k] = Math.min(box.hi, Math.max(box.lo, start))
    apply(row, lambda[k], bodies, u)
  })
  const current = (key: string): number => {
    const k = index.get(key)
    return k === undefined ? 0 : lambda[k]
  }
  for (let sweep = 0; sweep < PGS_SWEEPS; sweep++) {
    rows.forEach((row, k) => {
      if (!(diag[k] > 0)) return
      const box = bounds(row, current) ?? { lo: 0, hi: 0 }
      const w = rate(row, u) + row.compliance * lambda[k] - row.target
      const next = Math.min(box.hi, Math.max(box.lo, lambda[k] - w / diag[k]))
      const delta = next - lambda[k]
      if (delta === 0) return
      lambda[k] = next
      apply(row, delta, bodies, u)
    })
  }
  rows.forEach((row, k) => impulses.set(row.key, lambda[k]))
  return u
}
