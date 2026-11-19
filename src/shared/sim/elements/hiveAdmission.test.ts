import { describe, expect, it, vi } from 'vitest'
import { Articulation, type DriveForces } from '../articulation'
import type { SimCollider, SimJointSpec } from '../worldSpec'
import { ball, ballWorldSpec } from './elementTestkit'
import { ElementWorld } from './elementWorld'
import { BACK_SKIN_X, BIOBUZZ, FLOOR_Z, hivePoint, POLLEN_R, START_ANGLE } from './hiveTestkit'

// 결합 한도(MAX_COUPLED_ROWS)를 작게(9행) 바꿔 HIVE가 로봇 섬에 들어가지 못하는 경우를 본다(6b, spec-6b §2 로봇 승인: HIVE 마디는
// 공 뒤에 붙고 멈춤·축 마찰 행과 공의 HIVE 접촉 행이 한도에 센다). 한도 값은 이 파일만 바꾼다
vi.mock('./elementData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./elementData')>()),
  MAX_COUPLED_ROWS: 9
}))

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

describe('결합 한도에서 HIVE는 공 뒤에 붙는 마디다', () => {
  it('판 → 공 → HIVE 사슬이 한도를 넘으면 공만 로봇 섬이고 HIVE는 한쪽으로만 푸는 섬이다(NaN·폭주 없음)', () => {
    const r = POLLEN_R
    const local = { x: BACK_SKIN_X + r, y: 0.1, z: FLOOR_Z + r }
    const center = hivePoint(BIOBUZZ, 0, START_ANGLE, local)
    const plate: SimCollider = {
      kind: 'box',
      center: { x: 0.02 + 0.0005 + r, y: 0, z: 0 },
      rotation: I3,
      half: { x: 0.02, y: 0.1, z: 0.1 },
      friction: 0.4
    }
    const pusher: SimJointSpec = {
      parent: -1,
      type: 'prismatic',
      origin: { position: { x: center.x, y: center.y, z: center.z }, rotation: ZERO },
      axis: { x: 1, y: 0, z: 0 },
      limits: null,
      body: { mass: 5, centerOfMass: ZERO, inertia: [0.01, 0.01, 0.01, 0, 0, 0] },
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
    const art = new Articulation(spec.joints, { gravity: 0 })
    const ew = new ElementWorld(spec, BIOBUZZ, {
      initial: [ball('pollen', center)],
      air: false,
      sleep: false
    })
    const h = 0.001
    let limited = 0
    let coupledMax = 0
    let fastest = 0
    for (let k = 0; k < 60; k++) {
      const made = ew.prepare(art, art.contactFrames(), h)
      coupledMax = Math.max(coupledMax, made.coupled?.count ?? 0)
      art.step(h, zeroDrive, { rows: made.rows, damping: [], elements: made.coupled })
      ew.finish(art, h, false, (k + 1) * 1_000_000)
      for (const notice of ew.drainNotices()) {
        if (notice.code === 'elementCouplingLimit') limited++
        expect(notice.code).not.toBe('worldError')
      }
      const s = ew.snapshot()[0]
      fastest = Math.max(fastest, Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z))
      expect(Number.isFinite(s.position.x + s.position.y + s.position.z)).toBe(true)
    }
    // 공(6행: 판 3 + 한도에 안 세는 HIVE 접촉)만 들어가고 HIVE(멈춤·축 마찰 3 + 접촉 6 = 9)는 들어가지 못한다
    expect(limited).toBeGreaterThan(0)
    expect(coupledMax).toBe(1)
    const hive = ew.hiveSnapshot()![0]
    expect(Number.isFinite(hive.angle)).toBe(true)
    expect(Number.isFinite(hive.angularVelocity)).toBe(true)
    // 정해진 속도의 몸체(로봇·공)에 밀려도 폭주하지 않는다
    expect(fastest).toBeLessThan(2)
  })
})
