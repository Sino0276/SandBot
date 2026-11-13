import { describe, expect, it } from 'vitest'
import type { DeviceValues } from '../../sidecarProtocol'
import { HALF, mecanum, outputs, robotSpec, TICK } from '../driveTestkit'
import { resolveSeason } from '../seasons/seasons'
import { PhysicsWorld } from '../world'
import type { SimCollider, SimElementState, WorldSpec } from '../worldSpec'
import { ball } from './elementTestkit'
import { elementSpawns } from './spawn'

// 6a 성능(spec-6a §2.7, plan.md 검증 표): 하위 단계 시간(5 ms 틱 ÷ 5)의 중앙값·p99를 로그로 남기고 CI 상한은 목표의 5배다(CI
// 기계가 느릴 수 있다, collisionPerf.test.ts와 같은 방식). 목표: P1 잠든 공 56 = 기준 + 0.02 ms, P2 바닥에서 깬 56 = 0.3 ms,
// P3 프리로드 4를 들고 주행 = 0.7 ms, P4 결합 8 = 1.5 ms(p99 4 ms), P5 구석 12 더미 = 0.4 ms.

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
): { median: number; p99: number; world: PhysicsWorld } {
  const world = new PhysicsWorld(spec, {
    ...(initial ? { elements: { initial, sleep } } : { elements: { sleep } })
  })
  const times: number[] = []
  for (let k = 0; k < ticks; k++) {
    const start = performance.now()
    world.step(k * TICK, out(k))
    if (k > 0) times.push((performance.now() - start) / 5)
  }
  expect(world.drainNotices().filter((n) => n.code === 'worldError')).toEqual([])
  times.sort((a, b) => a - b)
  return { median: quantile(times, 0.5), p99: quantile(times, 0.99), world }
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
  it('P1: 잠든 공 56(GARDEN 8 + 바닥 48)은 공 없는 같은 세계보다 하위 단계 0.02 ms(목표) 안으로만 늘린다', () => {
    const spec = robot()
    const garden = elementSpawns(BIOBUZZ, spec.elements, spec.robot.start)
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
      ...elementSpawns(BIOBUZZ, spec.elements, spec.robot.start).map((s) => ({
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

  it('P4: 섀시 앞에 결합된 공 8(두 줄)을 밀면 하위 단계 중앙값 1.5 ms·p99 4 ms(목표)', () => {
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
    const { median, p99 } = measure(spec, initial, () => outputs(mecanum(0.2, 0, 0)), 300, false)
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
})
