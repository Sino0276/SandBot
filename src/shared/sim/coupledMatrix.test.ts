import { describe, expect, it } from 'vitest'
import {
  writeCoupledMatrix,
  type CoupledElements,
  type ElementPart,
  type Row
} from './articulation'

// 로봇 섬 행렬(6a constrainedCoupled의 A)을 빠르게 만드는 writeCoupledMatrix(성능, P6 쐐기)가 모든 짝을 도는 식(아래 reference:
// 그 판의 constrainedCoupled 행렬 반복을 그대로 옮긴 것)과 칸마다 비트로 같은지 본다. j가 0인 행, 공 둘을 가리키는 행, 같은 공을
// 두 번 가리키는 부분, −0·NaN 칸, 순응, 표 밖 공 번호(모든 짝으로 되돌아감), 공 묶음 없음을 지나간다

function elementBlock(
  k: readonly ElementPart[] | undefined,
  l: readonly ElementPart[] | undefined,
  coupled: CoupledElements
): number {
  if (k === undefined || l === undefined) return 0
  let sum = 0
  for (const p of k)
    for (const q of l) {
      if (p.element !== q.element) continue
      const im = coupled.invMass[p.element]
      const ii = coupled.invInertia[p.element]
      const a = p.a
      const b = q.a
      sum += im * (a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
      sum += ii * (a[3] * b[3] + a[4] * b[4] + a[5] * b[5])
    }
  return sum
}

function reference(
  rows: readonly Row[],
  y: readonly (readonly number[] | null)[],
  coupled: CoupledElements | undefined,
  m: number
): Float64Array {
  const dot = (j: readonly number[], x: readonly number[]): number => {
    let sum = 0
    for (let c = 0; c < m; c++) if (j[c] !== 0) sum += j[c] * x[c]
    return sum
  }
  const n = rows.length
  const a = new Float64Array(n * n)
  for (let k = 0; k < n; k++)
    for (let l = k; l < n; l++) {
      const col = y[l]
      let value = col ? dot(rows[k].j, col) : 0
      if (coupled) value += elementBlock(rows[k].elements, rows[l].elements, coupled)
      if (k === l) value += rows[k].compliance ?? 0
      a[k * n + l] = value
      a[l * n + k] = value
    }
  return a
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

function scene(
  next: () => number,
  options: { outOfRange?: boolean; coupled?: boolean; special?: boolean } = {}
): {
  rows: Row[]
  y: (number[] | null)[]
  nonzero: number[][]
  coupled?: CoupledElements
  m: number
} {
  const m = 11
  const balls = 12
  const n = 1 + Math.floor(next() * 90)
  const value = (): number => {
    const r = next()
    if (options.special && r < 0.03) return -0
    if (options.special && r < 0.04) return Number.NaN
    return 2 * next() - 1
  }
  const part = (): ElementPart => ({
    element: Math.floor(next() * balls),
    a: Array.from({ length: 6 }, value)
  })
  const rows: Row[] = []
  for (let k = 0; k < n; k++) {
    const j = new Array<number>(m).fill(0)
    // 행의 절반쯤은 j가 0이다(공끼리·정적 행), 나머지는 0이 아닌 열 1–5개(가끔 −0)
    if (next() < 0.55) {
      const count = 1 + Math.floor(next() * 5)
      for (let t = 0; t < count; t++) j[Math.floor(next() * m)] = value()
    }
    const row: Row = { key: `r${k}`, j, target: 0, lo: 0, hi: Infinity }
    const kind = next()
    if (kind < 0.7) {
      row.elements = next() < 0.3 ? [part(), part()] : [part()]
      // 같은 공을 두 번 가리키는 부분(만든 쪽은 하지 않지만 식은 받는다)
      if (next() < 0.05) row.elements = [...row.elements, { ...row.elements[0] }]
    }
    if (next() < 0.6) row.compliance = next() < 0.1 ? 0 : 1e-3 * next()
    rows.push(row)
  }
  if (options.outOfRange) {
    const k = Math.floor(next() * n)
    rows[k].elements = [{ element: balls + 3, a: [1, 0, 0, 0, 0, 0] }]
  }
  const y = rows.map((row) =>
    row.j.some((x) => x !== 0) ? Array.from({ length: m }, value) : null
  )
  const nonzero = rows.map((row) => {
    const out: number[] = []
    for (let c = 0; c < m; c++) if (row.j[c] !== 0) out.push(c)
    return out
  })
  const coupled: CoupledElements = {
    count: balls,
    invMass: Array.from({ length: balls }, () => 1 / (0.02 + 0.03 * next())),
    invInertia: Array.from({ length: balls }, () => 1 / (1e-5 + 1e-5 * next())),
    velocity: new Array<number>(6 * balls).fill(0)
  }
  return { rows, y, nonzero, m, ...(options.coupled === false ? {} : { coupled }) }
}

function check(s: ReturnType<typeof scene>): void {
  const n = s.rows.length
  const expected = reference(s.rows, s.y, s.coupled, s.m)
  // 다시 쓰는 버퍼처럼 더 긴 배열의 앞 n² 칸에 쓴다
  const actual = new Float64Array(n * n + 7)
  writeCoupledMatrix(s.rows, s.y, s.nonzero, s.coupled, actual)
  for (let i = 0; i < n * n; i++) expect(Object.is(actual[i], expected[i])).toBe(true)
}

describe('로봇 섬 행렬 writeCoupledMatrix(6a 성능)', () => {
  it('무작위 행(j가 0인 행·공 둘·순응)에서 모든 짝을 도는 식과 칸마다 비트로 같다', () => {
    const next = random(0x6a6)
    for (let round = 0; round < 200; round++) check(scene(next))
  })

  it('−0·NaN 칸, 같은 공을 두 번 가리키는 부분, 표 밖 공 번호, 공 묶음 없음에서도 같다', () => {
    const next = random(42)
    for (let round = 0; round < 60; round++) {
      check(scene(next, { special: true }))
      check(scene(next, { outOfRange: true }))
      check(scene(next, { coupled: false }))
    }
  })
})
