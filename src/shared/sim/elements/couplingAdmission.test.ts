import { describe, expect, it, vi } from 'vitest'
import { Articulation, type DriveForces } from '../articulation'
import { GRAVITY } from '../physics'
import { resolveSeason } from '../seasons/seasons'
import type { SimCollider, SimJointSpec } from '../worldSpec'
import { ball, ballField, ballWorldSpec } from './elementTestkit'
import { ElementWorld } from './elementWorld'

// 결합 한도에 들어가는 공 고르기(6a 리뷰): 한도를 작게(9행) 바꿔 로봇에 닿은 공 셋 가운데 비싼 공이 들어가지 않을 때 뒤의 더 싼
// 공은 계속 들어가는지 본다(한도 값은 이 파일만 바꾼다)
vi.mock('./elementData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./elementData')>()),
  MAX_COUPLED_ROWS: 9
}))

const POLLEN = resolveSeason('biobuzz').elements!.types.find((t) => t.kind === 'pollen')!
const r = POLLEN.radius
const ZERO = { x: 0, y: 0, z: 0 }
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

const zeroDrive = (z: readonly number[]): DriveForces => ({
  force: z.map(() => 0),
  damping: z.map(() => 0),
  stiffness: z.map(() => 0),
  boxLo: z.map(() => 0),
  boxHi: z.map(() => 0),
  regions: ''
})

describe('결합 한도에 들어가는 공', () => {
  it('들어가지 않는 공은 건너뛰고 뒤의 더 싼 공(로봇 위에 얹힌 공)은 넣는다', () => {
    // 판(직선 관절 몸체): 앞면 x = 0, 윗면 z = 0.2
    const plate: SimCollider = {
      kind: 'box',
      center: { x: -0.05, y: 0, z: 0.1 },
      rotation: I3,
      half: { x: 0.05, y: 0.2, z: 0.1 },
      friction: 0.4
    }
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: 2, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [plate]
    }
    const base = ballWorldSpec()
    const spec = ballWorldSpec({
      robot: { ...base.robot, start: { x: 0, y: 0, yaw: 0 }, colliders: [] },
      joints: [pusher]
    })
    // 우선순위(로봇에 닿음 → 깊은 짝): 0(앞면에 2 mm, 바닥 짝도 있어 6행) → 1(앞면에 1 mm, 6행) → 2(윗면에 0.1 mm, 로봇 짝만 3행)
    const initial = [
      ball('pollen', { x: r - 0.002, y: -0.1, z: r }),
      ball('pollen', { x: r - 0.001, y: 0.1, z: r }),
      ball('pollen', { x: -0.05, y: 0, z: 0.2 + r - 0.0001 })
    ]
    const art = new Articulation(spec.joints, { gravity: GRAVITY })
    const ew = new ElementWorld(spec, ballField({}, 10), { initial, air: false, sleep: false })
    const made = ew.prepare(art, art.contactFrames(), 0.001)
    art.step(0.001, zeroDrive, { rows: made.rows, damping: [], elements: made.coupled })
    ew.finish(art, 0.001, false, 1e6)
    const coupled = new Set(made.rows.map((row) => /^g[nt][12]?\.e(\d+)\//.exec(row.key)?.[1]))
    // 0(6행)이 들어가고 1(6행 더: 12 > 9)은 빠지고 2(3행: 9)는 들어간다. 1에서 멈추면 2도 한쪽 섬이 된다
    expect([...coupled].sort()).toEqual(['0', '2'])
    expect(made.rows).toHaveLength(9)
    expect(made.coupled?.count).toBe(2)
    expect(ew.drainNotices().some((n) => n.code === 'elementCouplingLimit')).toBe(true)
  })

  it('건너뛴 공 너머의 공(로봇에도 넣은 공에도 닿지 않음)은 넣지 않는다: 건너뛴 공과 한 섬으로 풀려 미는 힘이 이어진다', () => {
    // 무거운 판(13.6 kg)이 0.5 m/s로 민다. C(판에 2 mm, 6행)가 들어가고 A(판에 1 mm, 6행 더: 12 > 9)는 빠진다. B(A 앞 바닥, A와
    // 0.5 mm 겹침, 바닥 3행)는 로봇에 닿지 않고 A만 닿는다
    const plate: SimCollider = {
      kind: 'box',
      center: { x: -0.05, y: 0, z: 0.1 },
      rotation: I3,
      half: { x: 0.05, y: 0.3, z: 0.1 },
      friction: 0.4
    }
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: ZERO, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: 13.6, centerOfMass: ZERO, inertia: [0.1, 0.1, 0.1, 0, 0, 0] },
      friction: { coulomb: 0, viscous: 0 },
      spring: null,
      drive: { kind: 'none' },
      switches: [],
      colliders: [plate]
    }
    const base = ballWorldSpec()
    const spec = ballWorldSpec({
      robot: { ...base.robot, start: { x: 0, y: 0, yaw: 0 }, colliders: [] },
      joints: [pusher]
    })
    const initial = [
      ball('pollen', { x: r - 0.002, y: -0.2, z: r }),
      ball('pollen', { x: r - 0.001, y: 0, z: r }),
      ball('pollen', { x: 3 * r - 0.0015, y: 0, z: r })
    ]
    const art = new Articulation(spec.joints, { gravity: GRAVITY })
    const ew = new ElementWorld(spec, ballField({}, 10), { initial, air: false, sleep: false })
    const h = 0.001
    let overlap = 0
    let fastest = 0
    for (let k = 0; k < 200; k++) {
      art.v[0] = 0.5
      const made = ew.prepare(art, art.contactFrames(), h)
      if (k === 0) {
        const coupled = new Set(made.rows.map((row) => /^g[nt][12]?\.e(\d+)\//.exec(row.key)?.[1]))
        // C만 로봇 섬이다(B를 넣으면 B는 바닥 행만 들고 들어가 A를 느끼지 못했다)
        expect([...coupled]).toEqual(['0'])
        expect(made.coupled?.count).toBe(1)
      }
      art.step(h, zeroDrive, { rows: made.rows, damping: [], elements: made.coupled })
      ew.finish(art, h, false, (k + 1) * 1e6)
      const [, a, b] = ew.snapshot()
      const d = Math.hypot(
        b.position.x - a.position.x,
        b.position.y - a.position.y,
        b.position.z - a.position.z
      )
      overlap = Math.max(overlap, 2 * r - d)
      fastest = Math.max(fastest, Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z))
    }
    // B가 A를 느껴 A와 함께 밀린다(넣었을 때는 A–B 겹침 1.9 mm, B가 0.92 m/s로 튕겨 나갔다. 결합 한도가 없으면 0.91 mm·0.74 m/s)
    expect(overlap).toBeLessThan(1.2e-3)
    expect(fastest).toBeLessThan(0.85)
  })
})
