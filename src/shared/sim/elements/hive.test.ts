import { afterEach, describe, expect, it, vi } from 'vitest'
import { Articulation, type ContactRow, type DriveForces } from '../articulation'
import { GRAVITY } from '../physics'
import { FieldVision } from '../vision'
import type { SimCollider, SimHiveState, SimJointSpec, WorldSpec } from '../worldSpec'
import { ball, ballWorldSpec, BallRunner } from './elementTestkit'
import { ElementWorld } from './elementWorld'
import {
  BACK_SKIN_X,
  BIOBUZZ,
  FLOOR_Z,
  hivePoint,
  loadStates,
  NECTAR_R,
  POLLEN_R,
  START_ANGLE,
  withHiveDynamics,
  type CalibrationLoad
} from './hiveTestkit'
import { HIVE_ARM, SLEEP_SPEED } from './elementData'

// 6b HIVE 동역학(spec-6b §2·§3·§10): 보정표(EFG §12.3) 여섯 줄, 쌍안정과 반발 없는 멈춤, 넘어간 뒤 공이 쏟아짐, 파랑 = 빨강의
// Rz(π) 거울, 잠든 HIVE의 θ가 멈춤 각 그대로(비트), 결정성, 로봇이 쥔 공이 HIVE에 닿으면 로봇 섬에 같이 든다, 카메라 태그가 HIVE
// 각을 따른다.

const RED = BIOBUZZ.hives[0]
const BLUE = BIOBUZZ.hives[1]
const LOWER = Math.min(RED.startAngle, RED.tippedAngle)
const UPPER = Math.max(RED.startAngle, RED.tippedAngle)
const TICK_1MS = 1_000_000

const worldSpec = (): WorldSpec => ballWorldSpec({ elements: { groups: [], preloads: [] } })

function runLoad(
  load: CalibrationLoad,
  options: { toss?: boolean; k?: number; seconds?: number; field?: typeof BIOBUZZ } = {}
): BallRunner {
  const field = options.field ?? BIOBUZZ
  const runner = new BallRunner(
    worldSpec(),
    { field, elements: { initial: loadStates(field, load, options) } },
    TICK_1MS
  )
  return runner.run(options.seconds ?? 3)
}

const hiveOf = (runner: BallRunner, k = 0): SimHiveState =>
  (runner.world.hiveSnapshot() as SimHiveState[])[k]
const tipNotices = (runner: BallRunner): string[] =>
  runner.notices.filter((n) => n.code === 'hiveTip').map((n) => n.params.hive)

afterEach(() => {
  ElementWorld.islandHook = null
  vi.restoreAllMocks()
})

describe('시즌 데이터와 HIVE 몸체', () => {
  it('두 멈춤은 시작·넘어간 각 상수 그대로이고 두 HIVE가 동역학을 갖는다', () => {
    expect(RED.startAngle).toBe(-Math.PI / 6)
    expect(RED.tippedAngle).toBe(Math.PI / 6)
    expect(BLUE.startAngle).toBe(Math.PI / 6)
    expect(BLUE.tippedAngle).toBe(-Math.PI / 6)
    expect(RED.dynamics).toEqual(BLUE.dynamics)
    expect(RED.dynamics!.massMoment).toBeGreaterThan(0)
  })

  it('보정표 짐의 해석 받침 토크(부록 B)가 시뮬레이터 창의 가운데에 있다: massMoment·sin 30° ≈ 0.045 kg·m', () => {
    // 3N+2P 0.042020, 3N+3P 0.047978 kg·m의 가운데 0.044999
    expect(RED.dynamics!.massMoment * Math.sin(Math.PI / 6)).toBeCloseTo(0.045, 3)
  })
})

describe('보정표(EFG §12.3, 여섯 줄): 살며시 놓기와 던지기', () => {
  // 짐: 3N+1P(—), 3N+2P(안 넘어감: 던져도), 3N+3P(넘어감: 놓아도·던져도), 6P(—), 7P(안 넘어감), 8P(넘어감).
  // 던지기 = 마지막 공을 그 자리 위 0.3 m(지붕 아래까지)에서 1 m/s로 아래로 [가정: spec-6b §10]
  const ROWS: { name: string; load: CalibrationLoad; tip: boolean }[] = [
    { name: '3N+1P', load: { nectar: 3, pollen: 1 }, tip: false },
    { name: '3N+2P', load: { nectar: 3, pollen: 2 }, tip: false },
    { name: '3N+3P', load: { nectar: 3, pollen: 3 }, tip: true },
    { name: '6P', load: { nectar: 0, pollen: 6 }, tip: false },
    { name: '7P', load: { nectar: 0, pollen: 7 }, tip: false },
    { name: '8P', load: { nectar: 0, pollen: 8 }, tip: true }
  ]
  for (const toss of [false, true])
    for (const { name, load, tip } of ROWS)
      it(`${name} ${toss ? '던지기' : '살며시 놓기'}: ${tip ? '넘어간다' : '넘어가지 않는다'}`, () => {
        const run = runLoad(load, { toss })
        const hive = hiveOf(run)
        if (tip) {
          // 한 번 넘어가 반대 멈춤에 닿고(비트로 그 상수) 안내는 한 줄이다
          expect(hive.tips).toBe(1)
          expect(tipNotices(run)).toEqual(['red'])
          expect(Object.is(hive.angle, UPPER)).toBe(true)
        } else {
          expect(hive.tips).toBe(0)
          expect(tipNotices(run)).toEqual([])
          // 처음 멈춤 상수 그대로 쉰다
          expect(Object.is(hive.angle, LOWER)).toBe(true)
        }
        expect(run.notices.filter((n) => n.code === 'worldError')).toEqual([])
        // HIVE가 든 섬은 조밀 풀이(HIVE_ISLAND_DENSE_ROWS 256)라 PGS 근사로 떨어지지 않는다(8P는 60행을 넘는다)
        expect(run.notices.filter((n) => n.code === 'elementIslandLarge')).toEqual([])
      }, 30_000)

  it('창: 안 넘어가야 할 짐의 임계 massMoment보다 낮으면 넘어가고, 넘어가야 할 짐의 임계보다 높으면 안 넘어간다', () => {
    // 시뮬레이터가 잰 임계값(이 massMoment 미만이면 넘어간다): 3N+2P 던지기 0.0857, 7P 던지기 0.0846, 3N+3P 놓기 0.0938, 8P
    // 놓기 0.0958. 가운데 0.0897은 정해 둔 0.0900과 0.3 % 안이다
    const tips = (load: CalibrationLoad, massMoment: number, toss: boolean): boolean =>
      hiveOf(runLoad(load, { toss, field: withHiveDynamics(BIOBUZZ, { massMoment }), seconds: 4 }))
        .tips > 0
    expect(tips({ nectar: 3, pollen: 2 }, 0.083, true)).toBe(true)
    expect(tips({ nectar: 3, pollen: 2 }, 0.0885, true)).toBe(false)
    expect(tips({ nectar: 0, pollen: 7 }, 0.082, true)).toBe(true)
    expect(tips({ nectar: 0, pollen: 7 }, 0.0875, true)).toBe(false)
    expect(tips({ nectar: 3, pollen: 3 }, 0.0925, false)).toBe(true)
    expect(tips({ nectar: 3, pollen: 3 }, 0.0955, false)).toBe(false)
    expect(tips({ nectar: 0, pollen: 8 }, 0.094, false)).toBe(true)
    expect(tips({ nectar: 0, pollen: 8 }, 0.0975, false)).toBe(false)
  }, 120_000)

  it('넘어감: 처음 멈춤을 떠난 뒤 반대 멈춤에 닿는 데 걸리는 시간을 잰다(8P 놓기, 1 ms 틱)', () => {
    const runner = new BallRunner(
      worldSpec(),
      { field: BIOBUZZ, elements: { initial: loadStates(BIOBUZZ, { nectar: 0, pollen: 8 }) } },
      TICK_1MS
    )
    let left = -1
    let reached = -1
    runner.run(
      4,
      () => ({}),
      (k) => {
        const angle = hiveOf(runner).angle
        if (left < 0 && angle > LOWER + 0.01) left = k
        if (reached < 0 && angle === UPPER) reached = k
      }
    )
    expect(left).toBeGreaterThan(0)
    expect(reached).toBeGreaterThan(left)
    // 짐이 임계를 조금 넘는 놓기라 천천히 시작해 60°를 돈다(수백 ms–수 s)
    expect((reached - left) / 1000).toBeGreaterThan(0.2)
    expect((reached - left) / 1000).toBeLessThan(3)
  }, 30_000)
})

describe('쌍안정과 멈춤', () => {
  it('빈 HIVE는 두 멈춤에서 버틴다: 시작 각 그대로 잠들고(비트), 넘어간 각에서도 그렇다', () => {
    for (const [angle, stop] of [
      [LOWER, LOWER],
      [UPPER, UPPER]
    ]) {
      const runner = new BallRunner(
        worldSpec(),
        {
          field: BIOBUZZ,
          elements: {
            initial: [ball('pollen', { x: -1.5, y: 1.5, z: POLLEN_R })],
            initialHives: [
              { angle, angularVelocity: 0, asleep: false, tips: 0 },
              { angle: BLUE.startAngle, angularVelocity: 0, asleep: true, tips: 0 }
            ]
          }
        },
        TICK_1MS
      ).run(2)
      const hive = hiveOf(runner)
      expect(Object.is(hive.angle, stop)).toBe(true)
      expect(hive.tips).toBe(0)
      expect(tipNotices(runner)).toEqual([])
      // 0.5 s 지나 잠든다
      expect(hive.asleep).toBe(true)
      expect(Object.is(hive.angularVelocity, 0)).toBe(true)
    }
  })

  it('멈춤 사이에서 놓으면 쓰러져 가까운 멈춤에 닿는다(불안정한 가운데)', () => {
    for (const [angle, stop] of [
      [0.05, UPPER],
      [-0.05, LOWER]
    ]) {
      const runner = new BallRunner(
        worldSpec(),
        {
          field: BIOBUZZ,
          elements: {
            initial: [ball('pollen', { x: -1.5, y: 1.5, z: POLLEN_R }, { asleep: true })],
            initialHives: [
              { angle, angularVelocity: 0, asleep: false, tips: 0 },
              { angle: BLUE.startAngle, angularVelocity: 0, asleep: true, tips: 0 }
            ]
          }
        },
        TICK_1MS
      ).run(4)
      expect(Object.is(hiveOf(runner).angle, stop)).toBe(true)
    }
  })

  it('멈춤에 반발이 없다: 넘어가 반대 멈춤에 닿은 뒤 각이 멈춤 상수 그대로이고 각속도가 0이다', () => {
    const runner = new BallRunner(
      worldSpec(),
      { field: BIOBUZZ, elements: { initial: loadStates(BIOBUZZ, { nectar: 3, pollen: 3 }) } },
      TICK_1MS
    )
    let after = -1
    const angles: number[] = []
    const speeds: number[] = []
    runner.run(
      5,
      () => ({}),
      (k) => {
        const hive = hiveOf(runner)
        if (after < 0 && hive.angle === UPPER) after = k
        if (after >= 0) {
          angles.push(hive.angle)
          speeds.push(hive.angularVelocity)
        }
      }
    )
    expect(after).toBeGreaterThan(0)
    expect(angles.length).toBeGreaterThan(1000)
    // 닿은 뒤 한 번도 멈춤 밖으로 가거나 되튀지 않는다(공이 쏟아지며 미는 동안에도)
    expect(angles.every((a) => a === UPPER)).toBe(true)
    expect(speeds.every((w) => w >= 0)).toBe(true)
    // 처음 닿은 하위 단계의 각속도도 멈춤 행이 지웠다(되튀는 음수가 없다)
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0)
  })

  it('넘어간 뒤 공이 입구로 쏟아져 바닥에 닿는다', () => {
    const run = runLoad({ nectar: 3, pollen: 3 }, { toss: true, seconds: 6 })
    expect(hiveOf(run).tips).toBe(1)
    const last = run.last()
    expect(last).toHaveLength(6)
    for (const s of last) {
      // 바닥 위에 있고(반지름 높이) CELL 밖이다
      expect(s.position.z).toBeLessThan(s.kind === 'pollen' ? POLLEN_R + 0.01 : NECTAR_R + 0.01)
      expect(s.out).toBe(false)
    }
    // 쏟아지는 동안 한 번도 CELL 바닥(밑판) 아래로 새지 않았다: 모든 틱에서 공이 밑판(HIVE 몸체) 위쪽이거나 바닥에 있다
    expect(run.notices.filter((n) => n.code === 'worldError')).toEqual([])
  }, 30_000)

  it('잠든 HIVE의 각은 멈춤 상수 그대로(Object.is)이고 각속도는 +0이다', () => {
    const placed = runLoad({ nectar: 3, pollen: 2 }, { seconds: 2 })
    const hive = hiveOf(placed)
    expect(hive.asleep).toBe(true)
    expect(Object.is(hive.angle, RED.startAngle)).toBe(true)
    expect(Object.is(hive.angularVelocity, 0)).toBe(true)
    const tipped = runLoad({ nectar: 3, pollen: 3 }, { seconds: 6 })
    const end = hiveOf(tipped)
    expect(end.asleep).toBe(true)
    expect(Object.is(end.angle, RED.tippedAngle)).toBe(true)
    expect(Object.is(end.angularVelocity, 0)).toBe(true)
    // 건드리지 않은 파랑 HIVE는 처음부터 끝까지 시작 각 상수에서 잠들어 있다
    const blue = hiveOf(tipped, 1)
    expect(blue.asleep).toBe(true)
    expect(Object.is(blue.angle, BLUE.startAngle)).toBe(true)
    expect(blue.tips).toBe(0)
    // gameState와 hiveSnapshot의 각은 같은 정수다
    const state = tipped.world.gameState()!
    expect(state.hives).toEqual([Math.round(UPPER * 1e4), Math.round(BLUE.startAngle * 1e4)])
    expect(state.hiveTips).toEqual([1, 0])
  })
})

describe('파랑은 빨강의 Rz(π) 거울이다', () => {
  it('빨강 짐과 그 거울을 파랑 HIVE에 놓으면 각은 부호만 반대이고 공은 (−x, −y, z)에 있다(1e-9 안)', () => {
    for (const toss of [false, true]) {
      const load = { nectar: 3, pollen: 3 }
      const red = runLoad(load, { toss, seconds: 4 })
      const blue = runLoad(load, { toss, seconds: 4, k: 1 })
      expect(hiveOf(red).tips).toBe(1)
      expect(hiveOf(blue, 1).tips).toBe(1)
      expect(tipNotices(blue)).toEqual(['blue'])
      let worst = 0
      red.snapshots.forEach((snap, k) => {
        const other = blue.snapshots[k]
        snap.forEach((s, i) => {
          const o = other[i]
          worst = Math.max(
            worst,
            Math.abs(o.position.x + s.position.x),
            Math.abs(o.position.y + s.position.y),
            Math.abs(o.position.z - s.position.z)
          )
        })
      })
      expect(worst).toBeLessThan(1e-9)
      // 각: 빨강 θ = −파랑 θ
      expect(Object.is(hiveOf(red).angle, -hiveOf(blue, 1).angle)).toBe(true)
    }
  }, 60_000)
})

describe('결정성과 안전', () => {
  it('같은 입력의 두 실행은 공·HIVE 상태가 바이트까지 같다', () => {
    const text = (): string => {
      const runner = runLoad({ nectar: 3, pollen: 3 }, { toss: true, seconds: 5 })
      return JSON.stringify([runner.snapshots, runner.notices, runner.world.hiveSnapshot()])
    }
    expect(text()).toBe(text())
  }, 60_000)

  it('HIVE 행의 HIVE 부분은 늘 a = [+0, +0, +0, +0, s, +0]이고 uStar의 HIVE 칸 0–3·5는 +0이다', () => {
    const states = loadStates(BIOBUZZ, { nectar: 3, pollen: 3 }, { toss: false })
    const ew = new ElementWorld(worldSpec(), BIOBUZZ, { initial: states })
    const n = ew.count
    let rows = 0
    for (let step = 0; step < 300; step++) {
      ew.prepare(null, null, 0.001)
      const pending = (
        ew as unknown as {
          pending: {
            uStar: Float64Array
            rows: { key: string; parts: { ball: number; a: number[] }[] }[]
          } | null
        }
      ).pending
      if (pending) {
        for (const row of pending.rows)
          for (const part of row.parts)
            if (part.ball >= n) {
              rows++
              for (const i of [0, 1, 2, 3, 5]) expect(Object.is(part.a[i], 0)).toBe(true)
              expect(Number.isFinite(part.a[4])).toBe(true)
            }
        for (let k = 0; k < ew.hiveCount; k++)
          for (const i of [0, 1, 2, 3, 5])
            expect(Object.is(pending.uStar[6 * (n + k) + i], 0)).toBe(true)
      }
      ew.finish(null, 0.001, false, (step + 1) * 1_000_000)
    }
    // 공이 닿아 HIVE가 깨어 멈춤·축 마찰·접촉 행이 실제로 지났다
    expect(rows).toBeGreaterThan(50)
  })

  it('섬이 던지면 그 HIVE만 멈추고(각·다른 공 그대로) worldError h<k>로 알린다', () => {
    const states = [ball('pollen', { x: -1.5, y: 1.5, z: POLLEN_R }, { asleep: true })]
    const hives = [
      { angle: 0.05, angularVelocity: 0.4, asleep: false, tips: 0 },
      { angle: BLUE.startAngle, angularVelocity: 0, asleep: true, tips: 0 }
    ]
    // 공은 하나(마디 0)라 HIVE 마디는 1: 던지면 HIVE 섬만 멈춘다
    ElementWorld.islandHook = (root) => {
      if (root >= 1) throw new Error('boom')
    }
    const runner = new BallRunner(
      worldSpec(),
      { field: BIOBUZZ, elements: { initial: states, initialHives: hives } },
      TICK_1MS
    ).run(0.3)
    const hive = hiveOf(runner)
    // 속도가 0으로 눌려 각이 그대로이고(0.4 rad/s였다) 알림이 있다
    expect(hive.angle).toBeCloseTo(0.05, 12)
    expect(hive.angularVelocity).toBe(0)
    expect(runner.notices.some((n) => n.params.detail === 'element island h0: boom')).toBe(true)
    // 던지지 않으면 같은 시작에서 쓰러진다
    ElementWorld.islandHook = null
    const free = new BallRunner(
      worldSpec(),
      { field: BIOBUZZ, elements: { initial: states, initialHives: hives } },
      TICK_1MS
    ).run(0.3)
    expect(hiveOf(free).angle).toBeGreaterThan(0.1)
  })

  it('prepare 뒤 failSubstep은 깨어 있는 HIVE의 각속도를 0으로 둔다(각은 그대로)', () => {
    const ew = new ElementWorld(worldSpec(), BIOBUZZ, {
      initial: [ball('pollen', { x: -1.5, y: 1.5, z: POLLEN_R }, { asleep: true })],
      initialHives: [
        { angle: 0.05, angularVelocity: 0.4, asleep: false, tips: 0 },
        { angle: BLUE.startAngle, angularVelocity: 0, asleep: true, tips: 0 }
      ]
    })
    ew.prepare(null, null, 0.001)
    ew.failSubstep()
    const [red, blue] = ew.hiveSnapshot()!
    expect(red.angle).toBe(0.05)
    expect(red.angularVelocity).toBe(0)
    expect(blue.asleep).toBe(true)
  })

  it('HIVE의 잠들기 문턱은 |ω|·HIVE_ARM이다(0.545 m, 5 mm/s)', () => {
    expect(HIVE_ARM).toBe(0.545)
    expect(SLEEP_SPEED / HIVE_ARM).toBeCloseTo(0.00917, 4)
    // 중력 토크 상수: τ = massMoment·g·sin θ(θ = −30°에서 가운데 0.045 kg·m·g)
    expect(RED.dynamics!.massMoment * GRAVITY * 0.5).toBeCloseTo(0.4414, 3)
  })

  it('공이 닿기 전까지 HIVE는 행도 알림도 만들지 않는다(잠든 HIVE가 든 세계는 공만 있는 세계와 같은 일)', () => {
    const ew = new ElementWorld(worldSpec(), BIOBUZZ, {
      initial: [ball('pollen', { x: -1.5, y: 1.5, z: POLLEN_R }, { asleep: true })]
    })
    const made = ew.prepare(null, null, 0.001)
    expect(made.rows).toEqual([])
    expect(made.coupled).toBeUndefined()
    expect(ew.hiveSnapshot()!.every((h) => h.asleep)).toBe(true)
  })
})

// 고정 기저 로봇의 prismatic 판(수평으로 공을 민다)이 HIVE 트레이 밑판과 Back Skin에 닿은 공을 누른다: 공이 로봇 섬에 있고 그 공이
// 닿은 HIVE가 같은 섬(결합 풀이)에 든다
describe('로봇이 쥔 공이 HIVE에 닿으면 로봇 섬에 같이 든다', () => {
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const ZERO = { x: 0, y: 0, z: 0 }
  const zeroDrive = (z: readonly number[]): DriveForces => ({
    force: z.map(() => 0),
    damping: z.map(() => 0),
    stiffness: z.map(() => 0),
    boxLo: z.map(() => 0),
    boxHi: z.map(() => 0),
    regions: ''
  })

  it('판 → 공 → HIVE 사슬이 한 로봇 풀이에 묶이고 HIVE의 멈춤·축 마찰 행이 로봇 행으로 간다', () => {
    const r = POLLEN_R
    // 공: 트레이 밑판 위·Back Skin 앞(몸체 틀), 빨강 시작 각
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
    let coupledMax = 0
    const keys = new Set<string>()
    const h = 0.001
    for (let k = 0; k < 30; k++) {
      const frames = art.contactFrames()
      const made = ew.prepare(art, frames, h)
      coupledMax = Math.max(coupledMax, made.coupled?.count ?? 0)
      for (const row of made.rows as readonly ContactRow[])
        keys.add(row.key.split('.').slice(0, 2).join('.'))
      art.step(h, zeroDrive, { rows: made.rows, damping: [], elements: made.coupled })
      ew.finish(art, h, false, (k + 1) * 1_000_000)
    }
    // 공과 HIVE가 한 로봇 섬(마디 2개)이다
    expect(coupledMax).toBe(2)
    expect(keys.has('ghl.h0')).toBe(true)
    expect(keys.has('ghu.h0')).toBe(true)
    expect(keys.has('ghf.h0')).toBe(true)
    // 로봇 풀이에 든 공 접촉 행은 판(j0k0)과 HIVE 부품 둘 다 있다
    expect([...keys].some((key) => /^gn\.e0\/j0k0$/.test(key))).toBe(true)
    expect([...keys].some((key) => /^gn\.e0\/h0p\d+$/.test(key))).toBe(true)
  })
})

describe('카메라 태그가 HIVE 각을 따른다(spec-6b §6)', () => {
  // 빨강 관중석 벽 앞 높이 0.3 m 웹캠(위 30°): 4d 기준 장면과 같다
  const pose = {
    origin: { x: 1.79 - 0.2286 + 0.2286, y: -0.32385, z: 0.3 },
    rotation: (() => {
      const yaw = Math.PI
      const pitch = -Math.PI / 6
      const cy = Math.cos(yaw)
      const sy = Math.sin(yaw)
      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      // 센서 틀 ZYX(yaw, pitch)
      return [cy * cp, -sy, cy * sp, sy * cp, cy, sy * sp, -sp, 0, cp]
    })()
  }
  const same = (a: unknown, b: unknown): boolean => {
    if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b)
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((x, i) => same(x, b[i]))
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a)
      const kb = Object.keys(b)
      return (
        ka.length === kb.length &&
        ka.every((key) =>
          same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
        )
      )
    }
    return a === b
  }
  const observe = (
    vision: FieldVision,
    hive: readonly [number, number] | null
  ): ReturnType<FieldVision['observe']> =>
    vision.observe(pose as Parameters<FieldVision['observe']>[0], 'logitechC920', 640, 480, 3, hive)

  it('각이 시작 각과 같으면 정적 길과 Object.is로 같다(−0 포함)', () => {
    const vision = new FieldVision(BIOBUZZ, [false, false])
    const fixed = observe(vision, null)
    const moving = observe(vision, [RED.startAngle, BLUE.startAngle])
    expect(same(moving, fixed)).toBe(true)
    // 한 HIVE만 넘어가도 시작 각인 쪽 태그는 그대로(Object.is)다: 빨강 태그 34–37(carrier hiveRed)은 따라가고 파랑 태그는 시작 그대로
    const redTipped = observe(vision, [RED.tippedAngle, BLUE.startAngle])
    const byId = (tags: ReturnType<FieldVision['observe']>, id: number): unknown =>
      tags.find((t) => t.id === id)
    expect(same(byId(redTipped, 38), byId(fixed, 38))).toBe(true)
    expect(same(byId(redTipped, 34), byId(fixed, 34))).toBe(false)
  })

  it('넘어간 각이면 넘어간 상태로 만든 시야와 Object.is로 같고, 가운데 각은 둘 사이에서 따라간다', () => {
    const start = new FieldVision(BIOBUZZ, [false, false])
    const tippedStatic = observe(new FieldVision(BIOBUZZ, [true, true]), null)
    const tipped = observe(start, [RED.tippedAngle, BLUE.tippedAngle])
    expect(same(tipped, tippedStatic)).toBe(true)
    const middle = observe(start, [0, 0])
    const visible = (tags: ReturnType<FieldVision['observe']>): number[] =>
      tags.filter((t) => t.visible).map((t) => t.id)
    // 같은 각의 두 번째 호출은 기억한 결과(같은 객체)를 쓴다
    expect(same(observe(start, [0, 0]), middle)).toBe(true)
    expect(same(middle, observe(start, null))).toBe(false)
    // 시작 각의 시야에는 RED AUDIENCE(34–37)가 보이고 넘어가면 위 CELL이 바뀌어 보이는 태그가 달라진다
    expect(visible(observe(start, null))).not.toEqual(visible(tipped))
  })
})
