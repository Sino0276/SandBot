import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceValues } from '../../sidecarProtocol'
import { HALF, mecanum, outputs, robotSpec, TICK } from '../driveTestkit'
import { resolveSeason } from '../seasons/seasons'
import { PhysicsWorld } from '../world'
import type { SimCollider, SimElementState, WorldSpec } from '../worldSpec'
import { ball, intakeWedge } from './elementTestkit'
import { ElementWorld } from './elementWorld'
import { loadStates } from './hiveTestkit'
import { elementSpawns, restBodyFrames } from './spawn'

// 6a 성능(spec-6a §2.7, plan.md 검증 표): 하위 단계 시간(5 ms 틱 ÷ 5)의 중앙값·p99를 로그로 남기고 CI 상한은 목표의 5배다(CI
// 기계가 느릴 수 있다, collisionPerf.test.ts와 같은 방식). 목표: P1 잠든 공 56 = 기준 + 0.02 ms, P2 바닥에서 깬 56 = 0.3 ms,
// P3 프리로드 4를 들고 주행 = 0.7 ms, P4 결합 8 = 1.5 ms(p99 4 ms), P5 구석 12 더미 = 0.4 ms, P6 쐐기(결합 한도를 넘음) =
// P4와 같은 1.5 ms(p99 4 ms).

const BIOBUZZ = resolveSeason('biobuzz')
const POLLEN = BIOBUZZ.elements!.types.find((t) => t.kind === 'pollen')!
const r = POLLEN.radius
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const ih = BIOBUZZ.perimeter.innerHalf

const box = (
  center: { x: number; y: number; z: number },
  half: { x: number; y: number; z: number }
): SimCollider => ({ kind: 'box', center, rotation: I3, half, friction: 0.4 })

const quantile = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

// BIOBUZZ 메카넘 로봇(18 in 상자 섀시 충돌체 + 위 바구니 옆벽), 필드 가운데 아래쪽에서 시작
function robot(extra: SimCollider[] = [], withElements = true): WorldSpec {
  return robotSpec(
    { start: { x: -0.6, y: -0.9, yaw: 0 } },
    {
      field: { season: 'biobuzz', hiveTipped: [false, false] },
      robot: {
        ...robotSpec().robot,
        start: { x: -0.6, y: -0.9, yaw: 0 },
        colliders: [box({ x: 0, y: 0, z: 0.1 }, { x: HALF, y: HALF, z: 0.1 }), ...extra]
      },
      ...(withElements ? { elements: { groups: ['garden'], preloads: [] } } : {})
    }
  )
}

function measure(
  spec: WorldSpec,
  initial: SimElementState[] | undefined,
  out: (k: number) => Record<string, DeviceValues>,
  ticks: number,
  sleep = true
): { median: number; p99: number; world: PhysicsWorld; notices: string[] } {
  const world = new PhysicsWorld(spec, {
    ...(initial ? { elements: { initial, sleep } } : { elements: { sleep } })
  })
  const times: number[] = []
  for (let k = 0; k < ticks; k++) {
    const start = performance.now()
    world.step(k * TICK, out(k))
    if (k > 0) times.push((performance.now() - start) / 5)
  }
  const notices = world.drainNotices()
  expect(notices.filter((n) => n.code === 'worldError')).toEqual([])
  times.sort((a, b) => a - b)
  return {
    median: quantile(times, 0.5),
    p99: quantile(times, 0.99),
    world,
    notices: notices.map((n) => n.code)
  }
}

// 바닥 격자의 공(필드 왼쪽 위 사분면, 로봇 경로 밖)
function floorGrid(count: number, asleep: boolean): SimElementState[] {
  const out: SimElementState[] = []
  for (let k = 0; out.length < count; k++)
    out.push(
      ball(
        'pollen',
        { x: -1.5 + (k % 8) * 0.12, y: 0.3 + Math.floor(k / 8) * 0.12, z: r },
        { asleep }
      )
    )
  return out
}

const drive = (k: number): Record<string, DeviceValues> =>
  outputs(k < 200 ? mecanum(0.3, 0, 0) : mecanum(0, 0, 0.3))

describe('6a 성능', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('P1: 잠든 공 56(GARDEN 8 + 바닥 48)은 공 없는 같은 세계보다 하위 단계 0.02 ms(목표) 안으로만 늘린다', () => {
    const spec = robot()
    const garden = elementSpawns(
      BIOBUZZ,
      spec.elements,
      spec.robot.start,
      restBodyFrames([]),
      spec.field.hiveTipped
    )
    const initial = [...garden, ...floorGrid(48, true)]
    expect(initial).toHaveLength(56)
    // 번갈아 세 번 재고 가장 작은 중앙값(기계 잡음)
    const base: number[] = []
    const balls: number[] = []
    for (let round = 0; round < 3; round++) {
      base.push(measure(robot([], false), undefined, drive, 400).median)
      balls.push(measure(spec, initial, drive, 400).median)
    }
    const baseline = Math.min(...base)
    const withBalls = Math.min(...balls)
    console.info(
      `6a 성능 P1: 잠든 공 56 하위 단계 중앙값 ${withBalls.toFixed(4)} ms, 공 없음 ${baseline.toFixed(4)} ms, 차 ${(withBalls - baseline).toFixed(4)} ms(목표 0.02)`
    )
    expect(withBalls - baseline).toBeLessThan(0.1)
  }, 60_000)

  it('P2: 바닥에서 깬 공 56(잠들기 끔)은 하위 단계 중앙값 0.3 ms(목표)', () => {
    const spec = robot()
    const initial = [
      ...elementSpawns(
        BIOBUZZ,
        spec.elements,
        spec.robot.start,
        restBodyFrames([]),
        spec.field.hiveTipped
      ).map((s) => ({
        ...s,
        asleep: false
      })),
      ...floorGrid(48, false).map((s, k) => ({
        ...s,
        velocity: { x: 0.05 * Math.sin(k), y: 0.05 * Math.cos(k), z: 0 }
      }))
    ]
    const { median, p99 } = measure(spec, initial, () => outputs({}), 300, false)
    console.info(
      `6a 성능 P2: 깬 공 56 하위 단계 중앙값 ${median.toFixed(4)} ms, p99 ${p99.toFixed(4)} ms(목표 0.3)`
    )
    expect(median).toBeLessThan(1.5)
  })

  it('P3: 프리로드 4를 위 바구니에 싣고 주행하면 하위 단계 중앙값 0.7 ms(목표)', () => {
    // 섀시 윗면(0.2 m) 위 바구니: 앞뒤·옆 벽
    const walls = [
      box({ x: 0, y: 2.2 * r, z: 0.25 }, { x: 4.5 * r, y: 0.005, z: 0.05 }),
      box({ x: 0, y: -2.2 * r, z: 0.25 }, { x: 4.5 * r, y: 0.005, z: 0.05 }),
      box({ x: 4.5 * r, y: 0, z: 0.25 }, { x: 0.005, y: 2.2 * r, z: 0.05 }),
      box({ x: -4.5 * r, y: 0, z: 0.25 }, { x: 0.005, y: 2.2 * r, z: 0.05 })
    ]
    const spec: WorldSpec = {
      ...robot(walls),
      elements: {
        groups: ['garden'],
        preloads: [0, 1, 2, 3].map((k) => ({
          kind: 'pollen' as const,
          body: -1,
          position: { x: (k - 1.5) * (2 * r + 0.002), y: 0, z: 0.2 + r }
        }))
      }
    }
    const { median, p99, world } = measure(spec, undefined, drive, 400, true)
    console.info(
      `6a 성능 P3: 프리로드 4 주행 하위 단계 중앙값 ${median.toFixed(4)} ms, p99 ${p99.toFixed(4)} ms(목표 0.7)`
    )
    // 공 넷은 바구니에 남았다
    const balls = world.elementSnapshot()!.slice(8)
    for (const s of balls) expect(s.position.z).toBeGreaterThan(0.2)
    expect(median).toBeLessThan(3.5)
  })

  it('P4: 섀시 앞에 결합된 공 8(두 줄, 66행)을 밀면 하위 단계 중앙값 1.5 ms·p99 4 ms(목표)', () => {
    const spec = robot()
    const front = -0.6 + HALF
    const initial: SimElementState[] = []
    for (const row of [0, 1])
      for (let k = 0; k < 4; k++)
        initial.push(
          ball('pollen', {
            x: front + r + 0.0005 + row * (2 * r + 0.0005),
            y: (k - 1.5) * (2 * r + 0.0005) - 0.9,
            z: r
          })
        )
    const { median, p99, notices } = measure(
      spec,
      initial,
      () => outputs(mecanum(0.2, 0, 0)),
      300,
      false
    )
    // 8개가 모두 로봇 섬에 들어간다(한도를 넘어 한쪽으로 푼 공이 없다: 6a 리뷰 전의 한도 48은 6개만 담았다)
    expect(notices).not.toContain('elementCouplingLimit')
    console.info(
      `6a 성능 P4: 결합 공 8 하위 단계 중앙값 ${median.toFixed(4)} ms, p99 ${p99.toFixed(4)} ms(목표 1.5·4)`
    )
    expect(median).toBeLessThan(7.5)
    expect(p99).toBeLessThan(20)
  })

  it('P5: 관중석·파랑 벽 구석에 떨어뜨린 공 12 더미는 하위 단계 중앙값 0.4 ms(목표)', () => {
    const spec = robot()
    const initial: SimElementState[] = []
    for (let k = 0; k < 12; k++)
      initial.push(
        ball('pollen', {
          x: ih - r - (k % 3) * 2.05 * r,
          y: ih - r - (Math.floor(k / 3) % 2) * 2.05 * r,
          z: r + Math.floor(k / 6) * 2.1 * r + 0.002
        })
      )
    const { median, p99 } = measure(spec, initial, () => outputs({}), 300, false)
    console.info(
      `6a 성능 P5: 구석 더미 12 하위 단계 중앙값 ${median.toFixed(4)} ms, p99 ${p99.toFixed(4)} ms(목표 0.4)`
    )
    expect(median).toBeLessThan(2)
  })

  it('P6: 인테이크를 켜고 GARDEN 공 두 줄(넷 + 그 앞 넷)을 관중석 벽에 밀어 끼우면서 프리로드 넷을 실으면(결합 한도를 넘는 쐐기) 하위 단계 중앙값 1.5 ms·p99 4 ms(목표)', () => {
    const { spec, initial, out } = intakeWedge()
    // 공 쪽 알림은 ElementWorld가 결합 한도를 넘은 하위 단계마다 내고 PhysicsWorld가 실행마다 하나로 줄이므로, 하위 단계마다
    // 비우는 drainNotices를 엿봐 틱마다 한도를 넘은 하위 단계 수를 센다(계산은 바꾸지 않는다)
    let limited = 0
    const drain = ElementWorld.prototype.drainNotices
    vi.spyOn(ElementWorld.prototype, 'drainNotices').mockImplementation(function (
      this: ElementWorld
    ) {
      const notices = drain.call(this)
      for (const notice of notices) if (notice.code === 'elementCouplingLimit') limited++
      return notices
    })
    // 같은 실행을 세 번 돌려 틱마다 가장 짧은 시간을 쓴다(결정적이라 같은 틱이 같은 일을 한다: 기계 잡음·GC를 뺀다)
    const ticks = 500
    const best = new Array<number>(ticks).fill(Infinity)
    let wedgeTicks: boolean[] = []
    let world = new PhysicsWorld(spec, { elements: { initial } })
    const codes = new Set<string>()
    for (let run = 0; run < 3; run++) {
      world = new PhysicsWorld(spec, { elements: { initial } })
      const over: boolean[] = []
      for (let k = 0; k < ticks; k++) {
        limited = 0
        const start = performance.now()
        world.step(k * TICK, out(k))
        best[k] = Math.min(best[k], (performance.now() - start) / 5)
        over.push(limited > 0)
        for (const notice of world.drainNotices()) codes.add(notice.code)
      }
      if (run === 0) wedgeTicks = over
      else expect(over).toEqual(wedgeTicks)
    }
    expect([...codes]).not.toContain('worldError')
    // 쐐기에 닿았다: 결합 한도를 넘은 틱이 0.5 s 넘게 이어지고, 빨강 GARDEN 넷(공 0–3)과 그 앞 한 줄(공 12–15)이 관중석 벽(+X)과
    // 섀시 앞면 사이에 있다
    expect([...codes]).toContain('elementCouplingLimit')
    const wedge = best.filter((_, k) => wedgeTicks[k])
    expect(wedge.length).toBeGreaterThan(100)
    const front = world.pose().x + HALF
    const snapshot = world.elementSnapshot()!
    for (const k of [0, 1, 2, 3, 12, 13, 14, 15]) {
      expect(snapshot[k].position.x).toBeGreaterThan(front)
      expect(snapshot[k].position.x).toBeLessThan(ih)
    }
    // 프리로드 넷은 바구니에 남았다
    for (const k of [8, 9, 10, 11]) expect(snapshot[k].position.z).toBeGreaterThan(0.2)
    wedge.sort((a, b) => a - b)
    const median = quantile(wedge, 0.5)
    const p99 = quantile(wedge, 0.99)
    console.info(
      `6a 성능 P6: 쐐기(결합 한도 넘음, 틱 ${wedge.length}개, 세 번 잰 틱마다 최솟값) 하위 단계 중앙값 ${median.toFixed(4)} ms, p99 ${p99.toFixed(4)} ms, 최악 ${wedge[wedge.length - 1].toFixed(3)} ms(목표 1.5·4)`
    )
    expect(median).toBeLessThan(7.5)
    expect(p99).toBeLessThan(20)
  }, 120_000)
})

// 6b 성능(spec-6b §10, 시험이 기록, CI 상한은 목표의 5배): P7 HIVE 섬 넘어감(3N+3P) = 1.0 ms, P8 깨어 있는 FLOWER 공 16(기둥 넷이
// 케이지 공 부품에 닿음) = 0.6 ms
describe('6b 성능', () => {
  it('P7: HIVE 섬 넘어감(3N+3P를 Back Skin에 놓고 CELL이 넘어가는 동안)은 하위 단계 1.0 ms(목표) 안팎', () => {
    const spec = robot()
    // 번갈아 세 번 재고 가장 작은 중앙값(기계 잡음): HIVE가 깨어 있는 틱만 센다
    const rounds = [0, 1, 2].map(() => {
      const world = new PhysicsWorld(spec, {
        elements: { initial: loadStates(BIOBUZZ, { nectar: 3, pollen: 3 }) }
      })
      const times: number[] = []
      let tips = 0
      for (let k = 0; k < 800; k++) {
        const start = performance.now()
        world.step(k * TICK, outputs(mecanum(0, 0, 0)))
        const elapsed = (performance.now() - start) / 5
        const hive = world.hiveSnapshot()![0]
        if (k > 0 && !hive.asleep) times.push(elapsed)
        tips = hive.tips
      }
      expect(world.drainNotices().filter((n) => n.code === 'worldError')).toEqual([])
      times.sort((a, b) => a - b)
      return { median: quantile(times, 0.5), p99: quantile(times, 0.99), ticks: times.length, tips }
    })
    const best = rounds.reduce((a, b) => (b.median < a.median ? b : a))
    // 넘어가는 동안 HIVE가 깨어 있었다(0.5 s 넘게)
    expect(best.tips).toBe(1)
    expect(best.ticks).toBeGreaterThan(100)
    console.info(
      `6b 성능 P7: HIVE 섬 넘어감 3N+3P(깨어 있는 ${best.ticks}틱) 하위 단계 중앙값 ${best.median.toFixed(4)} ms, p99 ${best.p99.toFixed(4)} ms(목표 1.0)`
    )
    expect(best.median).toBeLessThan(5)
  }, 120_000)

  it('P8: 깨어 있는 FLOWER 공 16(잠들지 않게)은 하위 단계 0.6 ms(목표) 안팎', () => {
    const spec = robot()
    const flower = elementSpawns(
      BIOBUZZ,
      { groups: ['flower'], preloads: [] },
      spec.robot.start,
      restBodyFrames([]),
      spec.field.hiveTipped
    ).map((s) => ({ ...s, asleep: false }))
    expect(flower).toHaveLength(16)
    // 번갈아 세 번 재고 가장 작은 중앙값(기계 잡음)
    const runs = [0, 1, 2].map(() => measure(spec, flower, drive, 400, false))
    const best = runs.reduce((a, b) => (b.median < a.median ? b : a))
    // 공은 케이지 안에 남았고(기둥이 무너져도 관·고리 조각 안) 깨어 있다
    for (const s of best.world.elementSnapshot()!) {
      expect(s.out).toBe(false)
      expect(s.asleep).toBe(false)
    }
    console.info(
      `6b 성능 P8: 깨어 있는 FLOWER 공 16 하위 단계 중앙값 ${best.median.toFixed(4)} ms, p99 ${best.p99.toFixed(4)} ms(목표 0.6)`
    )
    expect(best.median).toBeLessThan(3)
  }, 60_000)
})
