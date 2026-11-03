import { describe, expect, it } from 'vitest'
import {
  Articulation,
  bodyPoint,
  ldlFactor,
  ldlSolve,
  solveBoxLcp,
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
