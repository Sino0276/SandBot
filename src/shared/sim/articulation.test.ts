import { describe, expect, it } from 'vitest'
import {
  Articulation,
  bodyPoint,
  externalRows,
  ldlFactor,
  ldlSolve,
  solveBoxLcp,
  type ContactRow,
  type DriveForces,
  type LcpState,
  type DriveModel
} from './articulation'
import { GRAVITY } from './physics'
import type { SimInertia, SimJointSpec, Vec3 } from './worldSpec'

const ZERO: Vec3 = { x: 0, y: 0, z: 0 }

function jointSpec(change: Partial<SimJointSpec> = {}): SimJointSpec {
  return {
    parent: -1,
    type: 'revolute',
    origin: { position: ZERO, rotation: ZERO },
    axis: { x: 0, y: 1, z: 0 },
    limits: null,
    body: { mass: 1, centerOfMass: ZERO, inertia: [0, 0, 0, 0, 0, 0] },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: [],
    ...change
  }
}

// 가는 막대(질량 m, 길이 L)의 무게중심 기준 관성: 막대가 관절 틀 −Z로 매달려 있다
function rodInertia(m: number, length: number): SimInertia {
  const i = (m * length * length) / 12
  return [i, i, 0, 0, 0, 0]
}

function rod(m: number, length: number, change: Partial<SimJointSpec> = {}): SimJointSpec {
  return jointSpec({
    body: { mass: m, centerOfMass: { x: 0, y: 0, z: -length / 2 }, inertia: rodInertia(m, length) },
    ...change
  })
}

// 구동 없음(또는 좌표마다 고정 힘)
function forces(m: number, force: number[] = new Array<number>(m).fill(0)): DriveForces {
  const zeros = new Array<number>(m).fill(0)
  return {
    force,
    damping: zeros,
    stiffness: zeros,
    boxLo: zeros,
    boxHi: zeros,
    regions: ''
  }
}
const passive =
  (art: Articulation): DriveModel =>
  () =>
    forces(art.coordinates.length)

function energy(art: Articulation): number {
  return art.kineticEnergy() + art.potentialEnergy()
}

// q(t)가 +에서 −로 지나는 시각들(선형 보간)로 잰 평균 주기
function measuredPeriod(art: Articulation, h: number, seconds: number): number {
  const crossings: number[] = []
  let prev = art.q()[0]
  for (let k = 1; k <= Math.round(seconds / h); k++) {
    art.step(h, passive(art))
    const now = art.q()[0]
    if (prev > 0 && now <= 0) crossings.push((k - 1 + prev / (prev - now)) * h)
    prev = now
  }
  return (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1)
}

// 제1종 완전 타원 적분 K(k) = π / (2·AGM(1, √(1 − k²)))
function ellipticK(k: number): number {
  let a = 1
  let b = Math.sqrt(1 - k * k)
  for (let i = 0; i < 30; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]
  return Math.PI / (2 * a)
}

describe('LDLᵀ', () => {
  it('대칭 양정치 행렬을 풀고, 양정치가 아니면 예외', () => {
    const a = [
      [4, 1, 2],
      [1, 3, 0.5],
      [2, 0.5, 5]
    ]
    const x = ldlSolve(ldlFactor(a), [1, 2, 3])
    for (let i = 0; i < 3; i++)
      expect(a[i].reduce((s, v, j) => s + v * x[j], 0)).toBeCloseTo(i + 1, 12)
    expect(() =>
      ldlFactor([
        [1, 2],
        [2, 1]
      ])
    ).toThrow()
  })
})

describe('solveBoxLcp', () => {
  // 모든 상태 조합(아래·자유·위)을 풀어 맞는 것을 찾는 기준 해(작은 문제)
  function bruteForce(a: number[][], b: number[], lo: number[], hi: number[]): number[] | null {
    const n = b.length
    for (let code = 0; code < 3 ** n; code++) {
      const state = Array.from({ length: n }, (_, i) => Math.floor(code / 3 ** i) % 3)
      if (
        state.some(
          (s, i) => (s === 0 && !Number.isFinite(lo[i])) || (s === 2 && !Number.isFinite(hi[i]))
        )
      )
        continue
      const lambda = state.map((s, i) => (s === 0 ? lo[i] : s === 2 ? hi[i] : 0))
      const free = state.flatMap((s, i) => (s === 1 ? [i] : []))
      if (free.length > 0) {
        const sub = free.map((i) => free.map((j) => a[i][j]))
        const rhs = free.map(
          (i) => -b[i] - state.reduce((s, st, j) => (st === 1 ? s : s + a[i][j] * lambda[j]), 0)
        )
        let x: number[]
        try {
          x = ldlSolve(ldlFactor(sub), rhs)
        } catch {
          continue
        }
        free.forEach((i, k) => (lambda[i] = x[k]))
      }
      const ok = state.every((s, i) => {
        const w = b[i] + a[i].reduce((sum, v, j) => sum + v * lambda[j], 0)
        if (s === 1) return lambda[i] >= lo[i] - 1e-12 && lambda[i] <= hi[i] + 1e-12
        return s === 0 ? w >= -1e-12 : w <= 1e-12
      })
      if (ok) return lambda
    }
    return null
  }

  it('작은 양정치 문제에서 모든 조합을 본 해와 같다', () => {
    // 결정적인 의사 난수(선형 합동)로 만든 문제들
    let seed = 12345
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + (trial % 4)
      const g = Array.from({ length: n }, () => Array.from({ length: n }, () => rand() * 2 - 1))
      const a = g.map((_, i) =>
        g.map((__, j) => g[i].reduce((s, v, k) => s + v * g[j][k], 0) + (i === j ? 0.1 : 0))
      )
      const b = Array.from({ length: n }, () => rand() * 4 - 2)
      const lo = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0 : -rand()))
      const hi = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? Infinity : rand()))
      const expected = bruteForce(a, b, lo, hi)
      expect(expected).not.toBeNull()
      const got = solveBoxLcp(a, b, lo, hi).lambda
      got.forEach((x, i) => expect(x).toBeCloseTo((expected as number[])[i], 6))
    }
  })

  it('같은 방향의 행이 겹쳐도(특이 A) 속도 조건을 지킨다', () => {
    // 행 둘이 같은 J: 마찰 상자 [−1, 1]과 한계(λ ≥ 0, 목표 −0.5). b = Jv* − 목표
    const a = [
      [2, 2],
      [2, 2]
    ]
    const { lambda } = solveBoxLcp(a, [3, 3.5], [-1, 0], [1, Infinity])
    // w = A·λ + b: 마찰은 아래 경계(−1)에 차서 w ≥ 0, 한계는 w = 0 또는 λ = 0
    const w = [0, 1].map((i) => 3 + (i === 1 ? 0.5 : 0) + a[i][0] * lambda[0] + a[i][1] * lambda[1])
    expect(lambda[0]).toBeCloseTo(-1, 9)
    expect(w[1]).toBeGreaterThanOrEqual(-1e-9)
  })

  it('평행한 행이 여럿인 특이 양반정치 문제도 끝나고 원래 A에서 상보성을 지킨다', () => {
    // 관절 구속처럼 만든다: A = J·M⁻¹·Jᵀ(M⁻¹ 양정치), 마찰 행(상자)과 한계 행(λ ≥ 0, 목표 −간격/h ≤ 0이라 v = 0이
    // 가능한 해)이 같은 방향이거나 반대 방향(continuous 리깅의 [1, −r]·[−r, 1]처럼)이다. λ는 하나가 아니므로 해를 대조하지
    // 않고 원래 A에서 상보성만 본다.
    let seed = 2024
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let trial = 0; trial < 300; trial++) {
      const m = 1 + (trial % 3)
      const g = Array.from({ length: m }, () => Array.from({ length: m }, () => rand() * 2 - 1))
      const minv = g.map((_, i) =>
        g.map((__, j) => g[i].reduce((s, v, k) => s + v * g[j][k], 0) + (i === j ? 0.05 : 0))
      )
      const rows: { j: number[]; lo: number; hi: number; target: number }[] = []
      const nBase = 1 + (trial % 3)
      for (let r = 0; r < nBase; r++) {
        const j = Array.from({ length: m }, () => rand() * 2 - 1)
        const f = rand() * 0.01
        rows.push({ j, lo: -f, hi: f, target: 0 })
        // 같은 J의 아래 한계와 반대 J의 위 한계(간격은 가끔 0)
        const gap = trial % 4 === 0 ? 0 : rand() * 0.002
        rows.push({ j: j.map((x) => x * (0.5 + rand())), lo: 0, hi: Infinity, target: -gap })
        if (trial % 2 === 0)
          rows.push({
            j: j.map((x) => -x * (0.5 + rand())),
            lo: 0,
            hi: Infinity,
            target: -rand() * 0.002
          })
      }
      const vStar = Array.from({ length: m }, () => rand() * 2 - 1)
      const dot = (x: number[], y: number[]): number => x.reduce((s, v, k) => s + v * y[k], 0)
      const mj = rows.map((r) => minv.map((row) => dot(row, r.j)))
      const a = rows.map((r) => mj.map((col) => dot(r.j, col)))
      const b = rows.map((r) => dot(r.j, vStar) - r.target)
      const lo = rows.map((r) => r.lo)
      const hi = rows.map((r) => r.hi)
      const { lambda, states } = solveBoxLcp(a, b, lo, hi)
      rows.forEach((_, i) => {
        const w = b[i] + dot(a[i], lambda)
        expect(lambda[i]).toBeGreaterThanOrEqual(lo[i])
        expect(lambda[i]).toBeLessThanOrEqual(hi[i])
        if (states[i] === 'free') expect(Math.abs(w)).toBeLessThan(1e-9)
        else if (states[i] === 'lower') expect(w).toBeGreaterThan(-1e-9)
        else expect(w).toBeLessThan(1e-9)
      })
    }
  })

  it('continuous 리깅에서 잡은 순환 사례(마찰·손실 상자·한계 행이 평행)를 풀고 상보성을 지킨다', () => {
    // 2단 continuous 리프트(쿨롱 1 N)가 위 한계에서 BRAKE로 바꾼 뒤의 하위 단계 문제(시험 기록). 행 0과 3은 정확히 반대
    // 방향(같은 단의 마찰 상자와 한계)이라 A가 특이하다. 예전 풀이는 이 시작 상태에서 두 상태 사이를 오가며 상한(2000번)까지
    // 돌았고, 자유 행의 w가 −0.002였다(맨 위 단이 위 한계를 넘었다).
    const a = [
      [
        3.3222603792896015, -186.33601734159214, 0.04235410284807764, -3.3222603792896015,
        3.3215054024288104
      ],
      [
        -186.33601734159217, 11881.437960681182, 1428.0118324753562, 186.33601734159217,
        -211.79083323799503
      ],
      [
        0.04235410284807764, 1428.0118324753562, 1430.3878920888724, -0.04235410284807764,
        -25.45481589640287
      ],
      [
        -3.3222603792896015, 186.33601734159214, -0.04235410284807764, 3.3222603792896015,
        -3.3215054024288104
      ],
      [
        3.32150540242881, -211.790833237995, -25.45481589640287, -3.32150540242881,
        3.775246497274358
      ]
    ]
    const b = [
      -0.01811614673533502, 0.4996788046232623, -0.516634650646081, 0.058012356706942166,
      -0.008906951392000413
    ]
    const lo = [-0.001, -1.7825353626292277e-5, -3.3348663526946834e-5, 0, 0]
    const hi = [0.001, 1.7825353626292277e-5, 3.1509999999999995e-5, Infinity, Infinity]
    const start: LcpState[] = ['upper', 'lower', 'upper', 'lower', 'free']
    const { lambda, states } = solveBoxLcp(a, b, lo, hi, start)
    b.forEach((bi, i) => {
      const w = bi + a[i].reduce((s, x, j) => s + x * lambda[j], 0)
      if (states[i] === 'free') expect(Math.abs(w)).toBeLessThan(1e-12)
      else if (states[i] === 'lower') expect(w).toBeGreaterThan(-1e-12)
      else expect(w).toBeLessThan(1e-12)
    })
  })

  it('효과가 없는 행(대각 0)은 조용히 풀지 않고 던진다', () => {
    expect(() => solveBoxLcp([[0]], [1], [0], [Infinity])).toThrow()
  })
})

describe('Articulation 운동학·질량 행렬', () => {
  // 직선 리프트(Z) → 회전 팔(Y) → 회전 손목(X, 기울어진 틀) + 따로 있는 수평 직선 관절
  const tree: SimJointSpec[] = [
    jointSpec({
      type: 'prismatic',
      axis: { x: 0, y: 0, z: 1 },
      origin: { position: { x: 0.1, y: 0.02, z: 0.05 }, rotation: ZERO },
      limits: { lower: 0, upper: 1 },
      body: {
        mass: 0.8,
        centerOfMass: { x: 0.01, y: 0, z: 0.2 },
        inertia: [0.01, 0.012, 0.004, 0.001, 0, 0.0005]
      }
    }),
    jointSpec({
      parent: 0,
      origin: { position: { x: 0.02, y: 0, z: 0.4 }, rotation: { x: 0, y: 0, z: 0.3 } },
      body: {
        mass: 0.5,
        centerOfMass: { x: 0.15, y: 0.01, z: 0 },
        inertia: [0.0004, 0.004, 0.004, 0, 0.0002, 0]
      }
    }),
    jointSpec({
      parent: 1,
      axis: { x: 1, y: 0, z: 0 },
      origin: { position: { x: 0.3, y: 0, z: 0 }, rotation: { x: 0.2, y: -0.4, z: 0.1 } },
      body: {
        mass: 0.2,
        centerOfMass: { x: 0.03, y: 0.02, z: -0.01 },
        inertia: [0.0001, 0.0002, 0.00015, 0.00001, 0, 0]
      }
    }),
    jointSpec({
      type: 'prismatic',
      axis: { x: 1, y: 0, z: 0 },
      limits: { lower: -0.2, upper: 0.2 },
      body: {
        mass: 0.3,
        centerOfMass: { x: 0, y: 0.1, z: 0 },
        inertia: [0.0002, 0.0002, 0.0002, 0, 0, 0]
      }
    })
  ]
  const q0 = [0.17, 0.6, -1.1, 0.05]

  // 몸체 무게중심·회전을 q로 미분해(중앙 차분) 운동 에너지를 직접 계산한다(CRBA와 따로)
  function kineticByDifference(art: Articulation, q: number[], qd: number[]): number {
    const eps = 1e-6
    const plus = q.map((x, i) => x + eps * qd[i])
    const minus = q.map((x, i) => x - eps * qd[i])
    let total = 0
    art.joints.forEach((joint, i) => {
      const a = art.bodyPose(i, plus)
      const b = art.bodyPose(i, minus)
      const now = art.bodyPose(i, q)
      const c = joint.body.centerOfMass
      const pa = bodyPoint(a, c)
      const pb = bodyPoint(b, c)
      const v = pa.map((x, k) => (x - pb[k]) / (2 * eps))
      // Ṙ·Rᵀ = [ω]×
      const r = now.rotation
      const rd = a.rotation.map((x, k) => (x - b.rotation[k]) / (2 * eps))
      const w = (row: number, col: number): number =>
        rd[row * 3] * r[col * 3] +
        rd[row * 3 + 1] * r[col * 3 + 1] +
        rd[row * 3 + 2] * r[col * 3 + 2]
      const omega = [w(2, 1), w(0, 2), w(1, 0)]
      // 몸체 축 관성 → 로봇 축: ωᵀ(R I Rᵀ)ω = (Rᵀω)ᵀ I (Rᵀω)
      const local = [0, 1, 2].map(
        (k) => r[k] * omega[0] + r[3 + k] * omega[1] + r[6 + k] * omega[2]
      )
      const [ixx, iyy, izz, ixy, ixz, iyz] = joint.body.inertia
      const im = [
        [ixx, ixy, ixz],
        [ixy, iyy, iyz],
        [ixz, iyz, izz]
      ]
      let rot = 0
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) rot += local[x] * im[x][y] * local[y]
      total += 0.5 * joint.body.mass * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) + 0.5 * rot
    })
    return total
  }

  it('CRBA 질량 행렬은 대칭 양정치이고 몸체 속도로 잰 운동 에너지와 같다', () => {
    const art = new Articulation(tree)
    const m = art.massMatrix(q0)
    const n = tree.length
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) expect(m[i][j]).toBeCloseTo(m[j][i], 14)
    expect(() => ldlFactor(m)).not.toThrow()
    const dirs = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0.3, -0.7, 1.1, 0.4],
      [-0.5, 0.2, 0.9, -1.3]
    ]
    for (const qd of dirs) {
      const quad =
        0.5 * qd.reduce((s, x, i) => s + x * m[i].reduce((t, y, j) => t + y * qd[j], 0), 0)
      expect(quad).toBeCloseTo(kineticByDifference(art, q0, qd), 7)
    }
  })

  it('RNEA 바이어스는 라그랑주 식(질량 행렬·위치 에너지의 수치 미분)과 같다', () => {
    const art = new Articulation(tree)
    const qd = [0.4, -1.3, 2.2, 0.7]
    const n = tree.length
    const eps = 1e-6
    const dM = Array.from({ length: n }, (_, k) => {
      const plus = q0.slice()
      const minus = q0.slice()
      plus[k] += eps
      minus[k] -= eps
      const a = art.massMatrix(plus)
      const b = art.massMatrix(minus)
      return a.map((row, i) => row.map((x, j) => (x - b[i][j]) / (2 * eps)))
    })
    const expected = Array.from({ length: n }, (_, i) => {
      let c = 0
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) c += (dM[k][i][j] - 0.5 * dM[i][j][k]) * qd[j] * qd[k]
      const plus = q0.slice()
      const minus = q0.slice()
      plus[i] += eps
      minus[i] -= eps
      return c + (art.potentialEnergy(plus) - art.potentialEnergy(minus)) / (2 * eps)
    })
    const bias = art.bias(q0, qd)
    bias.forEach((x, i) => expect(x).toBeCloseTo(expected[i], 6))
  })

  it('정지 중력 항은 손 계산식과 같다(직선 = 하위 질량·g·축, 회전 = 축 × 팔 길이)', () => {
    // 수직 리프트(0.8 kg) 위 수평 팔(0.5 kg, 무게중심 0.15 m 앞): 팔이 θ만큼 들리면 중력 토크 m·g·0.15·cos θ
    const art = new Articulation([
      jointSpec({
        type: 'prismatic',
        axis: { x: 0, y: 0, z: 1 },
        limits: { lower: 0, upper: 1 },
        body: { mass: 0.8, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] }
      }),
      jointSpec({
        parent: 0,
        axis: { x: 0, y: -1, z: 0 },
        origin: { position: { x: 0, y: 0, z: 0.3 }, rotation: ZERO },
        body: {
          mass: 0.5,
          centerOfMass: { x: 0.15, y: 0, z: 0 },
          inertia: [0, 0.001, 0.001, 0, 0, 0]
        }
      })
    ])
    const theta = 0.4
    const bias = art.bias([0.2, theta], [0, 0])
    expect(bias[0]).toBeCloseTo(1.3 * GRAVITY, 12)
    expect(bias[1]).toBeCloseTo(0.5 * GRAVITY * 0.15 * Math.cos(theta), 12)
  })
})

describe('Articulation 적분', () => {
  const length = 0.3
  const mass = 0.2

  it('작은 진폭 진자 주기 = 2π√(I/(m·g·d))(±0.2 %)', () => {
    const art = new Articulation([rod(mass, length)])
    art.z[0] = (2 * Math.PI) / 180
    const inertia = (mass * length * length) / 3
    const expected = 2 * Math.PI * Math.sqrt(inertia / (mass * GRAVITY * (length / 2)))
    const period = measuredPeriod(art, 1e-3, 10)
    expect(Math.abs(period / expected - 1)).toBeLessThan(0.002)
  })

  it('90° 진자 주기는 타원 적분과 같고(±0.3 %) 에너지는 1 % 안에 묶인다', () => {
    const art = new Articulation([rod(mass, length)])
    const theta0 = Math.PI / 2
    art.z[0] = theta0
    const inertia = (mass * length * length) / 3
    const expected =
      4 * Math.sqrt(inertia / (mass * GRAVITY * (length / 2))) * ellipticK(Math.sin(theta0 / 2))
    const e0 = energy(art)
    const period = measuredPeriod(art, 1e-3, 11)
    expect(Math.abs(period / expected - 1)).toBeLessThan(0.003)
    const fresh = new Articulation([rod(mass, length)])
    fresh.z[0] = theta0
    let worst = 0
    for (let k = 0; k < 11000; k++) {
      fresh.step(1e-3, passive(fresh))
      worst = Math.max(worst, Math.abs(energy(fresh) - e0))
    }
    // 위치 에너지의 크기(m·g·d)에 대한 비율
    expect(worst / (mass * GRAVITY * (length / 2))).toBeLessThan(0.01)
  })

  // 이중 진자(팔 0.3 kg·0.3 m, 손목 0.2 kg·0.25 m, 3b 비평 dpend.py와 같은 크기): 두 막대가 수직에서 θ(손목 관절은 상대각 0)
  function doublePendulum(theta: number): Articulation {
    const art = new Articulation([
      rod(0.3, 0.3),
      rod(0.2, 0.25, { parent: 0, origin: { position: { x: 0, y: 0, z: -0.3 }, rotation: ZERO } })
    ])
    art.z[0] = theta
    return art
  }

  it('작은 진폭(30°) 이중 진자는 10 s 동안 에너지 오차가 흔들림 에너지의 2 % 아래다', () => {
    const art = doublePendulum(Math.PI / 6)
    const e0 = energy(art)
    // 흔들림 에너지(맨 아래 자세 대비)
    const scale = e0 - art.potentialEnergy([0, 0])
    let worst = 0
    for (let k = 0; k < 10000; k++) {
      art.step(1e-3, passive(art))
      worst = Math.max(worst, Math.abs(energy(art) - e0))
    }
    expect(worst / scale).toBeLessThan(0.02)
  })

  it('큰 진폭(120°) 이중 진자는 하위 단계를 반으로 줄이면 1차로 수렴한다', () => {
    // 1 s 뒤의 각을 h/8 기준해와 비교(혼돈 전 구간)
    const final = (h: number): number[] => {
      const art = doublePendulum((2 * Math.PI) / 3)
      for (let k = 0; k < Math.round(0.5 / h); k++) art.step(h, passive(art))
      return art.q()
    }
    const reference = final(1e-3 / 16)
    const error = (h: number): number => {
      const q = final(h)
      return Math.hypot(q[0] - reference[0], q[1] - reference[1])
    }
    const e1 = error(1e-3)
    const e2 = error(5e-4)
    const e4 = error(2.5e-4)
    expect(e2).toBeLessThan(e1)
    expect(e4).toBeLessThan(e2)
    expect(e1 / e2).toBeGreaterThan(1.6)
    expect(e1 / e2).toBeLessThan(2.6)
  })

  it('떨어져 한계에 닿으면 반발 없이 한계에 멈춘다(침투 0)', () => {
    const art = new Articulation([
      jointSpec({
        type: 'prismatic',
        axis: { x: 0, y: 0, z: 1 },
        limits: { lower: -0.1, upper: 0.5 },
        body: { mass: 1.5, centerOfMass: ZERO, inertia: [0, 0, 0, 0, 0, 0] }
      })
    ])
    let touched = -1
    for (let k = 0; k < 400; k++) {
      art.step(1e-3, passive(art))
      const q = art.q()[0]
      expect(q).toBeGreaterThanOrEqual(-0.1)
      if (touched < 0 && q === -0.1) touched = k
      if (touched >= 0) {
        expect(q).toBe(-0.1)
        expect(art.v[0]).toBe(0)
      }
    }
    expect(touched).toBeGreaterThan(0)
  })

  it('한계에 닿은 단이 멈출 때 자식 관절의 일반화 운동량을 지킨다(결합 충격, 팔을 실은 리프트 단)', () => {
    // 수평 리프트 단(x 축 직선, 1 kg, 위 한계 0.1 m)이 수직 축(z) 둘레로 자유롭게 도는 팔(0.3 kg, 무게중심 y 0.2 m)을
    // 싣고 일정한 속도로 움직인다(중력 토크 없음, 팔은 단에 대해 멈춰 있다). 단이 한계에 닿으면 충격은 단 좌표에만 걸리므로
    // 팔의 일반화 운동량 M_cp·v₀ + M_cc·v_c가 그대로이고 팔은 v_c = M_cp·v₀/M_cc로 돈다(반발 0).
    const stage = jointSpec({
      type: 'prismatic',
      axis: { x: 1, y: 0, z: 0 },
      limits: { lower: -1, upper: 0.1 },
      body: { mass: 1, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] }
    })
    const arm = jointSpec({
      parent: 0,
      axis: { x: 0, y: 0, z: 1 },
      body: {
        mass: 0.3,
        centerOfMass: { x: 0, y: 0.2, z: 0 },
        inertia: [1e-4, 1e-4, 1e-4, 0, 0, 0]
      }
    })
    const ratios: number[] = []
    for (let trial = 0; trial < 12; trial++) {
      const art = new Articulation([stage, arm])
      const v0 = 0.5 + trial * 0.0731
      art.v = [v0, 0]
      let expected = NaN
      for (let k = 0; k < 2000; k++) {
        const before = art.q()
        const m = art.massMatrix(before)
        const momentum = m[1][0] * art.v[0] + m[1][1] * art.v[1]
        art.step(1e-3, passive(art))
        if (art.q()[0] >= 0.1) {
          expected = momentum / m[1][1]
          break
        }
      }
      expect(art.q()[0]).toBe(0.1)
      expect(art.v[0]).toBe(0)
      ratios.push(art.v[1] / expected)
    }
    for (const ratio of ratios) expect(Math.abs(ratio - 1)).toBeLessThan(0.01)
  })

  it('한계에 멈춰 있던 자식은 결합 충격이 안쪽으로 밀면 떨어지고, 바깥으로 밀면 그대로 멈춘다(한쪽 구속)', () => {
    // 위 시험의 단과 팔인데 팔이 한계 0에 속도 0으로 멈춰 있다. 단이 하위 단계 끝에 정확히 한계에 닿는 경우(v₀ = 0.5,
    // 1 ms 200번)도 넣는다. 충격이 팔을 음의 방향으로 민다: 한계가 [−1, 0]이면 팔은 한계에서 떨어져 v_c = M_cp·v₀/M_cc로
    // 돌고, [0, 1]이면 한계로 밀려 들어가므로 0에 멈춘 채다(예전에는 앞의 경우도 두 방향 구속으로 묶여 운동량을 모두 잃었다).
    const stage = jointSpec({
      type: 'prismatic',
      axis: { x: 1, y: 0, z: 0 },
      limits: { lower: -1, upper: 0.1 },
      body: { mass: 1, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] }
    })
    const armWith = (limits: { lower: number; upper: number }): SimJointSpec =>
      jointSpec({
        parent: 0,
        axis: { x: 0, y: 0, z: 1 },
        limits,
        body: {
          mass: 0.3,
          centerOfMass: { x: 0, y: 0.2, z: 0 },
          inertia: [1e-4, 1e-4, 1e-4, 0, 0, 0]
        }
      })
    for (const v0 of [0.5, 0.5731, 0.6462, 0.83]) {
      for (const separating of [true, false]) {
        const art = new Articulation([
          stage,
          armWith(separating ? { lower: -1, upper: 0 } : { lower: 0, upper: 1 })
        ])
        art.v = [v0, 0]
        let expected = NaN
        for (let k = 0; k < 2000; k++) {
          const m = art.massMatrix(art.q())
          const momentum = m[1][0] * art.v[0] + m[1][1] * art.v[1]
          art.step(1e-3, passive(art))
          if (art.q()[0] >= 0.1) {
            expected = momentum / m[1][1]
            break
          }
        }
        expect(art.q()[0]).toBe(0.1)
        expect(art.v[0]).toBe(0)
        expect(expected).toBeLessThan(-0.5)
        if (separating) {
          expect(Math.abs(art.v[1] / expected - 1)).toBeLessThan(0.01)
          for (let k = 0; k < 20; k++) art.step(1e-3, passive(art))
          expect(art.q()[1]).toBeLessThan(-0.02)
        } else {
          expect(art.q()[1]).toBe(0)
          expect(art.v[1]).toBe(0)
          for (let k = 0; k < 20; k++) art.step(1e-3, passive(art))
          expect(art.q()[1]).toBe(0)
          expect(art.v[1]).toBe(0)
        }
      }
    }
  })

  it('정지 마찰이 미는 힘보다 크면 정확히 멈춰 있고, 작으면 차이만큼 가속한다', () => {
    const slide = (push: number): Articulation => {
      const art = new Articulation([
        jointSpec({
          type: 'prismatic',
          axis: { x: 1, y: 0, z: 0 },
          limits: { lower: -1, upper: 1 },
          friction: { coulomb: 2, viscous: 0 },
          spring: { kind: 'constantForce', force: push },
          body: { mass: 0.5, centerOfMass: ZERO, inertia: [0, 0, 0, 0, 0, 0] }
        })
      ])
      for (let k = 0; k < 200; k++) art.step(1e-3, passive(art))
      return art
    }
    const held = slide(1.5)
    expect(held.q()[0]).toBe(0)
    expect(held.v[0]).toBe(0)
    const moving = slide(2.5)
    // v = (2.5 − 2)/0.5 · 0.2 s
    expect(moving.v[0]).toBeCloseTo(0.2, 6)
  })

  // 2단 리깅(단마다 0.3 kg, 이동 0.244 m: goBILDA Viper 336, data §5.1), 위로 미는 모터 좌표 힘
  function twoStage(kind: 'cascade' | 'continuous'): Articulation {
    const stage = (parent: number): SimJointSpec =>
      jointSpec({
        parent,
        type: 'prismatic',
        axis: { x: 0, y: 0, z: 1 },
        limits: { lower: 0, upper: 0.244 },
        body: { mass: 0.3, centerOfMass: ZERO, inertia: [0, 0, 0, 0, 0, 0] }
      })
    return new Articulation([
      {
        ...stage(-1),
        drive: {
          kind: 'motor',
          devices: ['lift'],
          ratio: 0.112 / (2 * Math.PI),
          params: {
            stallTorque: 1.834,
            freeSpeed: (435 * 2 * Math.PI) / 60,
            stallCurrent: 9.2,
            freeCurrent: 0.25,
            gearbox: 13.7336,
            efficiency: 0.9025,
            rotorInertia: 3e-6,
            backdriveFriction: 0
          },
          rigging: { kind, stages: [1] }
        }
      },
      { ...stage(0), drive: { kind: 'stage' } }
    ])
  }
  const push =
    (force: number): ((art: Articulation) => DriveModel) =>
    (art) =>
    () => {
      const f = forces(art.coordinates.length)
      f.force[0] = force
      return f
    }

  it('cascade 리깅은 두 단이 같은 상대 이동을 한다', () => {
    const art = twoStage('cascade')
    expect(art.coordinates.length).toBe(1)
    for (let k = 0; k < 300; k++) {
      art.step(1e-3, push(0.5)(art))
      const [q1, q2] = art.q()
      expect(q2).toBe(q1)
    }
    expect(art.q()[0]).toBeGreaterThan(0.05)
  })

  it('continuous 리깅은 줄 길이를 지키고 가벼운 위 단이 먼저 펴지며, 위 한계에서 떨지 않는다', () => {
    const art = twoStage('continuous')
    const r = 0.112 / (2 * Math.PI)
    let firstStageMovedAt = -1
    let topAtLimit = -1
    for (let k = 0; k < 1500; k++) {
      art.step(1e-3, push(0.5)(art))
      const [q1, q2] = art.q()
      expect(q1 + q2).toBeCloseTo(r * art.z[0], 12)
      expect(q1).toBeLessThanOrEqual(0.244 + 1e-9)
      expect(q2).toBeLessThanOrEqual(0.244 + 1e-9)
      if (firstStageMovedAt < 0 && q1 > 1e-4) firstStageMovedAt = k
      if (topAtLimit < 0 && q2 > 0.244 - 1e-6) topAtLimit = k
    }
    expect(topAtLimit).toBeGreaterThan(0)
    expect(firstStageMovedAt).toBeGreaterThanOrEqual(topAtLimit)
    // 두 단이 위 한계에 닿은 뒤 모터는 계속 민다: 속도 0, 부호가 바뀌지 않음
    const [q1, q2] = art.q()
    expect(q1).toBeCloseTo(0.244, 9)
    expect(q2).toBeCloseTo(0.244, 9)
    const before = art.z.slice()
    for (let k = 0; k < 200; k++) {
      art.step(1e-3, push(0.5)(art))
      for (const v of art.v) expect(Math.abs(v)).toBeLessThan(1e-9)
    }
    art.z.forEach((z, c) => expect(Math.abs(z - before[c])).toBeLessThan(1e-9))
  })

  // continuous 2단 리프트(단 0.4·0.3 kg, 이동 0.244 m)와 단 하나에 실은 자유 팔(회전, 무게중심 x 쪽). 수직(z)·수평(x) 둘 다
  function liftWithArm(
    axis: Vec3,
    armParent: number,
    arm: {
      mass: number
      centerOfMass: Vec3
      axis: Vec3
      limits: { lower: number; upper: number }
    }
  ): Articulation {
    const stage = (parent: number, mass: number): SimJointSpec =>
      jointSpec({
        parent,
        type: 'prismatic',
        axis,
        limits: { lower: 0, upper: 0.244 },
        body: { mass, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] }
      })
    return new Articulation([
      {
        ...stage(-1, 0.4),
        drive: {
          kind: 'motor',
          devices: ['lift'],
          ratio: 0.112 / (2 * Math.PI),
          params: {
            stallTorque: 1.834,
            freeSpeed: (435 * 2 * Math.PI) / 60,
            stallCurrent: 9.2,
            freeCurrent: 0.25,
            gearbox: 13.7336,
            efficiency: 0.9025,
            rotorInertia: 3e-6,
            backdriveFriction: 0
          },
          rigging: { kind: 'continuous', stages: [1] }
        }
      },
      { ...stage(0, 0.3), drive: { kind: 'stage' } },
      jointSpec({
        parent: armParent,
        axis: arm.axis,
        limits: arm.limits,
        body: {
          mass: arm.mass,
          centerOfMass: arm.centerOfMass,
          inertia: [1e-4, 1e-4, 1e-4, 0, 0, 0]
        }
      })
    ])
  }

  it('continuous 리깅 맨 위 단(여러 성분 S 행)의 한계도 결합 충격에 넣는다: 바닥에 둔 리프트의 캐리지 팔이 멈춰도 단이 꺼지거나 뜨지 않는다', () => {
    // 리프트가 바닥(두 단 모두 아래 한계 0)에 있고, 맨 위 단(캐리지)에 실은 팔이 중력으로 떨어져 위 한계에 닿는다. 팔을
    // 멈추는 충격이 M̂로 묶인 φ를 바꾸므로 맨 위 단 q = r·φ − q₀의 한계 행이 없으면 단이 한계 아래로 꺼졌다가 다음 하위 단계의
    // 간격 항으로 튀어 오른다(예전: 0.07–0.2 mm 꺼지고 0.25–4 mm 뜸).
    const cases = [
      { mass: 0.5, reach: 0.2, upper: 0.6 },
      { mass: 0.5, reach: 0.2, upper: 1.0 },
      { mass: 0.5, reach: 0.2, upper: 1.4 },
      { mass: 1.2, reach: 0.3, upper: 1.0 }
    ]
    for (const c of cases) {
      const art = liftWithArm({ x: 0, y: 0, z: 1 }, 1, {
        mass: c.mass,
        centerOfMass: { x: c.reach, y: 0, z: 0 },
        axis: { x: 0, y: 1, z: 0 },
        limits: { lower: -1.5, upper: c.upper }
      })
      let hit = false
      for (let k = 0; k < 1500; k++) {
        art.step(1e-3, passive(art))
        const [q0, q1, q2] = art.q()
        expect(Math.abs(q0)).toBeLessThan(1e-9)
        expect(Math.abs(q1)).toBeLessThan(1e-9)
        if (q2 >= c.upper) hit = true
      }
      expect(hit).toBe(true)
      expect(art.q()[2]).toBe(c.upper)
    }
  })

  it('맨 위 단이 한계에 있을 때 팔이 멈추는 충격은 정확한 비탄성 충돌보다 에너지를 늘리지 않고 단을 한계 밖으로 밀지 않는다', () => {
    // 수평 continuous 리프트(중력이 단·팔 좌표에 일하지 않음)의 맨 위 단이 위 한계, 첫 단은 중간이다. 첫 단에 실은 팔이
    // z 축 둘레로 w₀로 돌아 위 한계 0.5에 닿는다. 기준은 닿기 전 상태에서 팔 위 한계와 맨 위 단 위 한계 두 행으로 푼 정확한
    // 비탄성 충돌이다(예전: 맨 위 단이 −0.07–−0.54 m/s로 튀고 운동 에너지가 기준의 2.4배까지).
    const r = 0.112 / (2 * Math.PI)
    for (const w0 of [3, 5.1234, 8]) {
      const lift = liftWithArm({ x: 1, y: 0, z: 0 }, 0, {
        mass: 0.4,
        centerOfMass: { x: 0, y: 0.2, z: 0 },
        axis: { x: 0, y: 0, z: 1 },
        limits: { lower: -1, upper: 0.5 }
      })
      lift.z = [(0.1 + 0.244) / r, 0.1, 0]
      lift.v = [0, 0, w0]
      let exactEnergy = NaN
      let exactQd: number[] = []
      for (let k = 0; k < 400 && Number.isNaN(exactEnergy); k++) {
        const v = lift.v.slice()
        const mq = lift.massMatrix(lift.q())
        lift.step(1e-3, passive(lift))
        if (lift.q()[2] < 0.5) continue
        const s = lift.s
        const mz = [0, 1, 2].map((a) =>
          [0, 1, 2].map((b) => {
            let sum = 0
            for (let i = 0; i < 3; i++)
              for (let j = 0; j < 3; j++) sum += s[i][a] * mq[i][j] * s[j][b]
            return sum + (a === b ? lift.armature[a] + 1e-9 : 0)
          })
        )
        const f = ldlFactor(mz)
        const rows = [
          [0, 0, -1],
          [-r, 1, 0]
        ]
        const y = rows.map((row) => ldlSolve(f, row))
        const a = rows.map((row) => y.map((col) => row.reduce((sum, x, c) => sum + x * col[c], 0)))
        const b = rows.map((row) => row.reduce((sum, x, c) => sum + x * v[c], 0))
        const { lambda } = solveBoxLcp(a, b, [0, 0], [Infinity, Infinity])
        const after = v.slice()
        y.forEach((col, k2) => col.forEach((x, c) => (after[c] += x * lambda[k2])))
        exactQd = lift.qd(after)
        exactEnergy = 0
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) exactEnergy += 0.5 * after[i] * mz[i][j] * after[j]
      }
      expect(Number.isNaN(exactEnergy)).toBe(false)
      for (let k = 0; k < 100; k++) {
        lift.step(1e-3, passive(lift))
        expect(lift.q()[1]).toBeLessThanOrEqual(0.244 + 1e-9)
      }
      expect(lift.kineticEnergy()).toBeLessThanOrEqual(exactEnergy * 1.02)
      const qd = lift.qd()
      for (let i = 0; i < 3; i++)
        expect(Math.abs(qd[i] - exactQd[i])).toBeLessThan(0.02 * Math.abs(exactQd[0]) + 1e-6)
    }
  })

  it('같은 입력이면 같은 프로세스에서 비트까지 같은 상태다', () => {
    const run = (): string => {
      const art = twoStage('continuous')
      const states: number[][] = []
      for (let k = 0; k < 800; k++) {
        art.step(1e-3, push(k < 400 ? 0.5 : -0.1)(art))
        states.push([...art.z, ...art.v])
      }
      return JSON.stringify(states)
    }
    expect(run()).toBe(run())
  })
})

// ---- 3c: 부유 기저·자유 좌표·밖에서 주는 행 ----

const CHASSIS = {
  mass: 12,
  centerOfMass: { x: 0.03, y: -0.02, z: 0.1 },
  inertia: [0.3, 0.35, 0.4, 0, 0, 0] as SimInertia
}

function floating(
  joints: SimJointSpec[] = [],
  start = { x: 0.5, y: -0.25, yaw: 0.7 },
  change: { free?: number[]; loadFilterTau?: number; body?: typeof CHASSIS } = {}
): Articulation {
  const { body = CHASSIS, ...rest } = change
  return new Articulation(joints, { base: { body, start }, ...rest })
}

// 좌표마다 일정한 힘을 주는 구동
const pushing =
  (art: Articulation, force: Record<number, number>): DriveModel =>
  () => {
    const f = new Array<number>(art.coordinates.length).fill(0)
    for (const [c, value] of Object.entries(force)) f[Number(c)] = value
    return forces(art.coordinates.length, f)
  }

// 무게중심이 로봇 원점 바로 위인 섀시(힘이 요를 돌리지 않는다)
const CENTERED = { ...CHASSIS, centerOfMass: { x: 0, y: 0, z: 0.1 } }

describe('Articulation 3c 확장', () => {
  it('자유 좌표를 더해도 관절 좌표의 연산은 3b와 같다(바이트)', () => {
    const plain = new Articulation([rod(0.4, 0.3)])
    const extended = new Articulation([rod(0.4, 0.3)], { free: [2e-4, 5e-4] })
    plain.z[0] = 0.8
    extended.z[0] = 0.8
    for (let k = 0; k < 500; k++) {
      plain.step(0.001, passive(plain))
      extended.step(0.001, passive(extended))
    }
    expect(extended.coordinates.map((c) => c.kind)).toEqual(['joint', 'free', 'free'])
    expect(extended.freeCoordinates).toEqual([1, 2])
    expect(extended.z[0]).toBe(plain.z[0])
    expect(extended.v[0]).toBe(plain.v[0])
    expect(extended.z.slice(1)).toEqual([0, 0])
  })

  it('기저 질량 행렬은 평면 강체의 해석식(필드 축, 무게중심 d = R·c)', () => {
    const start = { x: 0.5, y: -0.25, yaw: 0.7 }
    const art = floating([], start)
    expect(art.baseCoordinates).toEqual([0, 1, 2])
    expect(art.basePose()).toEqual(start)
    const m = art.massMatrix()
    const c = Math.cos(start.yaw)
    const s = Math.sin(start.yaw)
    const dx = c * CHASSIS.centerOfMass.x - s * CHASSIS.centerOfMass.y
    const dy = s * CHASSIS.centerOfMass.x + c * CHASSIS.centerOfMass.y
    const mass = CHASSIS.mass
    const expected = [
      [mass, 0, -mass * dy],
      [0, mass, mass * dx],
      [-mass * dy, mass * dx, CHASSIS.inertia[2] + mass * (dx * dx + dy * dy)]
    ]
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) expect(m[a][b]).toBeCloseTo(expected[a][b], 12)
  })

  it('정지 렌치: F_z = m·g, M_x = m·g·c_y, M_y = −m·g·c_x(로봇 축, 자세와 관계없음)', () => {
    const art = floating([], { x: 1, y: 0.4, yaw: 2.1 }, { loadFilterTau: 0.02 })
    const w = art.baseWrench()
    if (!w) throw new Error('wrench')
    const weight = CHASSIS.mass * GRAVITY
    expect(w.fz).toBeCloseTo(weight, 10)
    expect(w.mx).toBeCloseTo(weight * CHASSIS.centerOfMass.y, 10)
    expect(w.my).toBeCloseTo(-weight * CHASSIS.centerOfMass.x, 10)
    expect(new Articulation([rod(1, 1)]).baseWrench()).toBeNull()
  })

  it('일정하게 가속하면 걸러진 가속이 F/m에 닿아 피치 모멘트에 m·a·h가 더해진다(하중 이동)', () => {
    const art = floating([], { x: 0, y: 0, yaw: 0 }, { loadFilterTau: 0.02, body: CENTERED })
    const force = 24
    // 0.3 s = 15τ: 1차 지연의 남은 차이는 e^(−15) ≈ 3e-7 아래
    for (let k = 0; k < 300; k++) art.step(0.001, pushing(art, { 0: force }))
    const w = art.baseWrench()
    if (!w) throw new Error('wrench')
    const a = force / CENTERED.mass
    expect(art.basePose()?.yaw).toBe(0)
    expect(w.fz).toBeCloseTo(CENTERED.mass * GRAVITY, 9)
    expect(w.my).toBeCloseTo(CENTERED.centerOfMass.z * CENTERED.mass * a, 5)
    expect(w.mx).toBeCloseTo(0, 12)
  })

  it('팔을 휘둘러도 접촉이 없으면 계의 무게중심이 거의 그대로다(속도 암시 오일러의 O(h), T7)', () => {
    // 속도 암시 오일러는 M(q_k)로 운동량을 갱신해서 선운동량 보존이 정확하지 않다: 하위 단계마다 h²·Ṁ·Δv, 전체로 O(h)다
    // (변분 적분기가 아니다). 그래서 1e-6 m 대신 h를 반으로 하면 어긋남이 반이 되는지(1차 수렴)와 크기를 본다.
    const armMass = 1.5
    const arm = jointSpec({
      origin: { position: { x: 0.1, y: 0, z: 0.3 }, rotation: ZERO },
      axis: { x: 0, y: 0, z: 1 },
      body: {
        mass: armMass,
        centerOfMass: { x: 0.2, y: 0, z: 0 },
        inertia: [1e-4, 0.02, 0.02, 0, 0, 0]
      }
    })
    const drift = (h: number, torque: number): { drift: number; momentum: number } => {
      const art = floating([arm], { x: 0, y: 0, yaw: 0 })
      const comXY = (): number[] => {
        const pose = art.basePose() as { x: number; y: number; yaw: number }
        const c = Math.cos(pose.yaw)
        const s = Math.sin(pose.yaw)
        const chassis = [
          pose.x + c * CHASSIS.centerOfMass.x - s * CHASSIS.centerOfMass.y,
          pose.y + s * CHASSIS.centerOfMass.x + c * CHASSIS.centerOfMass.y
        ]
        const p = bodyPoint(art.bodyPose(0), { x: 0.2, y: 0, z: 0 })
        const total = CHASSIS.mass + armMass
        return [0, 1].map((k) => (CHASSIS.mass * chassis[k] + armMass * p[k]) / total)
      }
      const before = comXY()
      // 팔 관절 토크(내력): 0.5 s 밀고 0.5 s 당긴다
      const steps = Math.round(1 / h)
      for (let k = 0; k < steps; k++)
        art.step(h, pushing(art, { 3: k < steps / 2 ? torque : -torque }))
      const after = comXY()
      // 선운동량 = (M·v)의 기저 x·y 성분
      const p = art.massMatrix().map((row) => row.reduce((sum, x, c) => sum + x * art.v[c], 0))
      return {
        drift: Math.hypot(after[0] - before[0], after[1] - before[1]),
        momentum: Math.hypot(p[0], p[1])
      }
    }
    // 서보 팔 정도(최고 약 1.5 rad/s): 1 ms에서 무게중심 어긋남 1e-6 m 아래
    expect(drift(0.001, 0.02).drift).toBeLessThan(1e-6)
    // 세게 휘두르면(여러 바퀴) 어긋남이 h에 비례한다
    const coarse = drift(0.001, 2)
    const fine = drift(0.0005, 2)
    expect(coarse.drift / fine.drift).toBeCloseTo(2, 1)
    expect(coarse.momentum / fine.momentum).toBeCloseTo(2, 1)
    expect(coarse.drift).toBeLessThan(2e-3)
  })

  it('기저가 일정하게 가속하면 매달린 자유 팔의 평형각은 atan(a/g)(T7b)', () => {
    // 피벗 높이 0.5 m에 매달린 막대(축 로봇 Y), 점성으로 흔들림을 끈다. 요는 막아 x 가속만 본다(요 좌표의 큰 관성 대신 힘 0과
    // 무게중심 위 섀시: 팔이 xz 평면에서만 움직여 요 토크가 없다)
    const pendulum = rod(0.5, 0.3, {
      origin: { position: { x: 0, y: 0, z: 0.5 }, rotation: ZERO },
      friction: { coulomb: 0, viscous: 0.2 }
    })
    const art = floating([pendulum], { x: 0, y: 0, yaw: 0 }, { body: CENTERED })
    const total = CENTERED.mass + 0.5
    const a = 3
    for (let k = 0; k < 4000; k++) art.step(0.001, pushing(art, { 0: total * a }))
    // R_y(q)·(0, 0, −L/2) = (−L/2·sin q, 0, −L/2·cos q): +X로 가속하면 무게중심이 −X로 처지므로 q > 0
    expect(art.basePose()?.yaw).toBe(0)
    expect(art.v[0]).toBeCloseTo(a * 4, 1)
    expect(art.q()[0]).toBeCloseTo(Math.atan(a / GRAVITY), 4)
  })

  it('T8 에너지: 접촉·마찰이 없으면 섀시 + 진자 팔의 에너지가 O(h) 안에서 일정하다', () => {
    const drift = (h: number): number => {
      const pendulum = rod(0.8, 0.4, {
        origin: { position: { x: 0.1, y: 0, z: 0.5 }, rotation: ZERO }
      })
      const art = floating([pendulum], { x: 0, y: 0, yaw: 0 })
      art.v[0] = 1.2
      art.v[2] = 0.8
      art.z[3] = 0.6
      const start = energy(art)
      let worst = 0
      for (let k = 0; k < Math.round(2 / h); k++) {
        art.step(h, passive(art))
        worst = Math.max(worst, Math.abs(energy(art) - start) / start)
      }
      return worst
    }
    const coarse = drift(0.001)
    expect(coarse).toBeLessThan(5e-3)
    expect(coarse / drift(0.0005)).toBeGreaterThan(1.6)
  })

  it('행 점성 감쇠: 힘 −c·v를 암시로 푼다(v⁺ = v / (1 + h·c/m))', () => {
    const art = floating([], { x: 0, y: 0, yaw: 0 }, { body: CENTERED })
    art.v[1] = 1
    const c = 30
    const h = 0.001
    let expected = 1
    for (let k = 0; k < 50; k++) {
      art.step(h, passive(art), { rows: [], damping: [{ j: [0, 1, 0], c }] })
      expected /= 1 + (h * c) / (CENTERED.mass + 1e-9)
    }
    expect(art.v[1]).toBeCloseTo(expected, 12)
    expect(art.v[0]).toBe(0)
  })

  it('밖에서 준 한쪽 행과 마찰 행(엇갈림 2회): 옆 힘이 μ·N 아래면 붙고, 넘으면 μ·N만큼 덜 가속한다', () => {
    const push = 50
    const mu = 0.4
    const h = 0.001
    const run = (side: number): number => {
      const art = floating([], { x: 0, y: 0, yaw: 0 }, { body: CENTERED })
      for (let k = 0; k < 200; k++)
        art.step(h, pushing(art, { 0: push, 1: side }), {
          rows: [
            // +x 벽(안쪽 법선 −x, 간격 0)과 그 접선
            { key: 'n', j: [-1, 0, 0], target: 0, lo: 0, hi: Infinity },
            { key: 't', j: [0, 1, 0], target: 0, lo: 0, hi: 0, friction: { normal: 'n', mu } }
          ],
          damping: []
        })
      expect(art.v[0]).toBeCloseTo(0, 12)
      expect(art.contactImpulse('n') / h).toBeCloseTo(push, 9)
      return art.v[1]
    }
    expect(run(15)).toBeCloseTo(0, 12)
    // 넘으면 하위 단계마다 2회차가 이번 법선으로 상자를 정하므로 정확한 쿨롱이다
    expect(run(30)).toBeCloseTo(((30 - mu * push) / (CENTERED.mass + 1e-9)) * 200 * h, 9)
  })
})

// 5: 마찰 행 상자 모양 넓히기(spec-5 §2.4, K4)
describe('externalRows 마찰 상자', () => {
  // 고정 시드 선형 합동(결정적 입력)
  const random = (seed: number): (() => number) => {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  it('지금 모양(법선 하나)은 바뀌기 전 식과 같은 비트다(고정 입력 100개)', () => {
    const next = random(5)
    const rows: ContactRow[] = []
    const impulses = new Map<string, number>()
    for (let k = 0; k < 100; k++) {
      // 법선 충격은 음수·0·양수가 섞이게
      impulses.set(`n${k}`, (next() - 0.3) * 10)
      rows.push({
        key: `t${k}`,
        j: [next(), next()],
        target: next() - 0.5,
        lo: 0,
        hi: 0,
        friction: { normal: `n${k}`, mu: next() * 2 }
      })
    }
    const normal = (key: string): number => impulses.get(key) ?? 0
    const out = externalRows(rows, normal)
    // 바뀌기 전: bound = mu · max(0, λ), 0이면 넣지 않는다
    const expected = rows.flatMap((row) => {
      const f = row.friction as { normal: string; mu: number }
      const bound = f.mu * Math.max(0, normal(f.normal))
      return bound > 0
        ? [{ key: row.key, j: row.j, target: row.target, lo: -bound, hi: bound }]
        : []
    })
    expect(out.length).toBeGreaterThan(50)
    expect(out.length).toBeLessThan(100)
    expect(out).toEqual(expected)
    out.forEach((row, i) => {
      expect(Object.is(row.lo, expected[i].lo)).toBe(true)
      expect(Object.is(row.hi, expected[i].hi)).toBe(true)
    })
  })

  it('패치 모양은 Σ weight·max(0, λ)·μ이고 cap이 있으면 min(합, cap)·μ다', () => {
    const impulses = new Map([
      ['a', 2],
      ['b', -1],
      ['c', 0.5]
    ])
    const normal = (key: string): number => impulses.get(key) ?? 0
    const patch = [
      { normal: 'a', weight: 1 },
      { normal: 'b', weight: 1 },
      { normal: 'c', weight: 0.4 }
    ]
    const row = (friction: ContactRow['friction']): ContactRow => ({
      key: 'ct1',
      j: [1, 0],
      target: 0,
      lo: 0,
      hi: 0,
      friction
    })
    // 2 + 0(음수는 0) + 0.4·0.5 = 2.2
    const [plain] = externalRows([row({ patch, mu: 0.5 })], normal)
    expect(plain.hi).toBeCloseTo(1.1, 15)
    expect(plain.lo).toBe(-plain.hi)
    const [capped] = externalRows([row({ patch, mu: 0.5, cap: 1.5 })], normal)
    expect(capped.hi).toBe(0.75)
    const [loose] = externalRows([row({ patch, mu: 0.5, cap: 10 })], normal)
    expect(loose.hi).toBe(plain.hi)
    // 모두 음수거나 비면 상자 0이라 넣지 않는다
    expect(externalRows([row({ patch: [{ normal: 'b', weight: 1 }], mu: 1 })], normal)).toEqual([])
    expect(externalRows([row({ patch: [], mu: 1 })], normal)).toEqual([])
    // 마찰 없는 행은 lo·hi 그대로
    expect(externalRows([{ key: 'n', j: [1], target: 0.1, lo: 0, hi: Infinity }], normal)).toEqual([
      { key: 'n', j: [1], target: 0.1, lo: 0, hi: Infinity }
    ])
  })
})
