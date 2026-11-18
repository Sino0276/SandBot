import { describe, expect, it } from 'vitest'
import { HALF, mecanum, outputs, robotSpec } from '../driveTestkit'
import { resolveSeason } from '../seasons/seasons'
import type { SimElementState, WorldSpec } from '../worldSpec'
import { REENTRY_DELAY_NANOS, SLOT_GAP } from './elementData'
import { ball, ballField, ballWorldSpec, BallRunner, TICK } from './elementTestkit'
import { reentryZones } from './spawn'

// 필드 밖과 다시 넣기(6a, spec-6a §2.8, 사용자 결정 11/13): 벽 너머로 날아간 POLLEN은 물리에서 빠지고(나감 알림), 3 s 뒤 나간
// 자리에서 가까운 LOADING ZONE 벽 자리에 쉬는 상태로 다시 들어온다. 자리가 로봇에 막히면 빌 때까지 틱마다 다시 본다.

const BIOBUZZ = resolveSeason('biobuzz')
const POLLEN = BIOBUZZ.elements!.types.find((t) => t.kind === 'pollen')!
const r = POLLEN.radius
const ih = BIOBUZZ.perimeter.innerHalf
const FIELD = ballField()

// 빨강 벽(−y) 너머로 던진 공(x = 기준 위치)
const thrown = (x: number, kind: SimElementState['kind'] = 'pollen'): SimElementState =>
  ball(kind, { x, y: -1.6, z: 0.25 }, { velocity: { x: 0, y: -3, z: 2.5 } })

function outTick(run: BallRunner): number {
  return run.snapshots.findIndex((s) => s[0].out)
}

describe('필드 밖과 다시 넣기(6a)', () => {
  it('빨강 벽 너머로 던진 POLLEN은 나가고 3 s 뒤 빨강 LOADING ZONE 가운데 벽 자리에 쉬는 채로 들어온다', () => {
    const run = new BallRunner(ballWorldSpec(), {
      field: FIELD,
      elements: { initial: [thrown(-0.4)], sleep: false }
    }).run(4)
    const out = outTick(run)
    expect(out).toBeGreaterThan(0)
    expect(out).toBeLessThan(40)
    const back = run.snapshots.findIndex((s, k) => k > out && !s[0].out)
    // 나간 하위 단계 끝 + 3 s 뒤 첫 틱 경계
    expect((back - out) * TICK).toBeGreaterThanOrEqual(REENTRY_DELAY_NANOS - TICK)
    expect((back - out) * TICK).toBeLessThanOrEqual(REENTRY_DELAY_NANOS + TICK)
    const zone = reentryZones(BIOBUZZ, 'pollen').find((z) => z.alliance === 'red')!
    const placed = run.snapshots[back][0]
    expect(placed.position.x).toBeCloseTo(zone.slots[0].x, 3)
    expect(placed.position.y).toBeCloseTo(-ih + r + SLOT_GAP, 3)
    expect(placed.position.z).toBeCloseTo(r, 3)
    expect(Math.hypot(placed.velocity.x, placed.velocity.y)).toBeLessThan(1e-3)
    const codes = run.notices.map((n) => n.code)
    expect(codes.filter((c) => c === 'elementOutOfField')).toHaveLength(1)
    expect(codes.filter((c) => c === 'elementReentered')).toHaveLength(1)
    expect(run.notices.find((n) => n.code === 'elementOutOfField')?.params).toEqual({
      kind: 'pollen'
    })
    // 나가 있는 동안 상태는 바뀌지 않는다(숨김)
    expect(run.snapshots[out + 10][0]).toEqual(run.snapshots[out][0])
  })

  it('파랑 벽 쪽으로 나간 공은 파랑 LOADING ZONE으로 들어온다', () => {
    const run = new BallRunner(ballWorldSpec(), {
      field: FIELD,
      elements: {
        initial: [
          ball('pollen', { x: 0.4, y: 1.6, z: 0.25 }, { velocity: { x: 0, y: 3, z: 2.5 } })
        ],
        sleep: false
      }
    }).run(4)
    const placed = run.last()[0]
    expect(placed.out).toBe(false)
    expect(placed.position.y).toBeCloseTo(ih - r - SLOT_GAP, 3)
    expect(placed.position.x).toBeGreaterThan(0.59)
  })

  it('NECTAR는 다시 넣지 않는다(사람 선수 몫, 6d)', () => {
    const run = new BallRunner(ballWorldSpec(), {
      field: FIELD,
      elements: { initial: [thrown(-0.4, 'nectarRed')], sleep: false }
    }).run(5)
    expect(run.last()[0].out).toBe(true)
    expect(run.notices.map((n) => n.code)).toEqual(['elementOutOfField'])
  })

  it('다시 넣을 자리가 로봇에 막혀 있으면 로봇이 떠날 때까지 기다린다', () => {
    // 빨강 LOADING ZONE 위에 선 메카넘 로봇(앞이 +y)이 5 s에 앞으로 떠난다
    const zone = reentryZones(BIOBUZZ, 'pollen').find((z) => z.alliance === 'red')!
    const start = { x: zone.center.x, y: -ih + HALF + 0.01, yaw: Math.PI / 2 }
    const spec: WorldSpec = robotSpec(
      { start },
      {
        field: { season: 'biobuzz', hiveTipped: [false, false] },
        elements: { groups: [], preloads: [] }
      }
    )
    const run = new BallRunner(spec, {
      field: FIELD,
      elements: { initial: [thrown(-0.4)], sleep: false }
    })
    const leave = 5
    run.run(8, (k) => (k * TICK < leave * 1e9 ? outputs({}) : outputs(mecanum(0.5, 0, 0))))
    const out = outTick(run)
    const back = run.snapshots.findIndex((s, k) => k > out && !s[0].out)
    // 3 s가 지나도 로봇이 자리를 막아 기다리다가 떠난 뒤에 들어온다
    expect((back - out) * TICK).toBeGreaterThan(REENTRY_DELAY_NANOS + TICK)
    expect(back * TICK).toBeGreaterThan(leave * 1e9)
    const placed = run.snapshots[back][0]
    const pose = run.world.pose()
    expect(placed.position.y).toBeCloseTo(-ih + r + SLOT_GAP, 3)
    // 들어온 자리는 그때 로봇 외곽 밖이다
    expect(Math.abs(placed.position.y - pose.y)).toBeGreaterThan(HALF)
  })

  it('같은 입력이면 나감·다시 넣기도 바이트까지 같다', () => {
    const once = (): string => {
      const run = new BallRunner(ballWorldSpec(), {
        field: FIELD,
        elements: { initial: [thrown(-0.4), thrown(0.3)] }
      }).run(4)
      return JSON.stringify([run.snapshots, run.notices])
    }
    expect(once()).toBe(once())
  })
})
