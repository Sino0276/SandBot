import { describe, expect, it } from 'vitest'
import type { DeviceValues } from '../../sidecarProtocol'
import { HALF, mecanum, outputs, robotSpec, TICK } from '../driveTestkit'
import { resolveSeason } from '../seasons/seasons'
import { PhysicsWorld } from '../world'
import { parseWorldSpec, type SimCollider, type WorldSpec } from '../worldSpec'
import { ball, ballField, ballWorldSpec, BallRunner } from './elementTestkit'
import { GAME_POSE_STRIDE, isValidGameState, quantizeElements } from './gameState'
import { elementSpawns, restBodyFrames } from './spawn'

// PhysicsWorld의 경기 요소 연결(6a): 첫 틱 자리 = elementSpawns, gameState(줄인 자세·표식, 바뀔 때만 revision), 결정성(같은
// 입력 두 번, 세계 둘을 번갈아 돌려도 같음), 경기 요소가 없는 세계는 null.

const BIOBUZZ = resolveSeason('biobuzz')
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const chassis: SimCollider = {
  kind: 'box',
  center: { x: 0, y: 0, z: 0.1 },
  rotation: I3,
  half: { x: HALF, y: HALF, z: 0.1 },
  friction: 0.4
}

// 빨강 GARDEN 앞의 메카넘 로봇(상자 섀시)과 GARDEN 묶음 + 앞 면 자동 프리로드 자리 넷(로봇 좌표)
function scene(): WorldSpec {
  const start = { x: 1.0, y: -1.3, yaw: 0 }
  const base = robotSpec({ start }, { field: { season: 'biobuzz', hiveTipped: [false, false] } })
  const r = 0.03555
  return {
    ...base,
    robot: { ...base.robot, start, colliders: [chassis] },
    elements: {
      groups: ['garden'],
      preloads: [0, 1, 2, 3].map((k) => ({
        kind: 'pollen' as const,
        body: -1,
        position: { x: HALF + r + 0.0005, y: (k - 1.5) * (2 * r + 0.0005), z: r }
      }))
    }
  }
}

const drive = (k: number): Record<string, DeviceValues> =>
  outputs(k < 150 ? mecanum(0.4, 0, 0.1) : k < 250 ? mecanum(-0.3, 0.2, 0) : mecanum(0, 0, 0))

describe('PhysicsWorld 경기 요소(6a)', () => {
  it('세계 설명을 JSON으로 거친 뒤 첫 틱의 공 자리는 elementSpawns와 같다(배치 → 프리로드)', () => {
    const spec = parseWorldSpec(JSON.parse(JSON.stringify(scene())))
    if (typeof spec === 'string') throw new Error(spec)
    const world = new PhysicsWorld(spec)
    world.step(0, outputs({}))
    const expected = elementSpawns(
      BIOBUZZ,
      spec.elements,
      spec.robot.start,
      restBodyFrames(spec.joints)
    )
    expect(world.elementSnapshot()).toEqual(expected)
    expect(expected).toHaveLength(12)
    // 배치는 잠든 채, 프리로드는 깨어 있다
    expect(expected.slice(0, 8).every((s) => s.asleep)).toBe(true)
    expect(expected.slice(8).every((s) => !s.asleep)).toBe(true)
  })

  it('경기 요소가 없는 세계는 gameState·elementSnapshot이 null이다', () => {
    const world = new PhysicsWorld(robotSpec())
    world.step(0, outputs({}))
    world.step(TICK, outputs({}))
    expect(world.gameState()).toBeNull()
    expect(world.elementSnapshot()).toBeNull()
    expect(world.elementTickState()).toBeNull()
  })

  it('gameState는 줄인 자세·표식이고 바뀔 때만 revision이 는다', () => {
    const world = new PhysicsWorld(scene())
    let previous = world.gameState()
    expect(previous?.revision).toBe(0)
    let bumps = 0
    for (let k = 0; k < 300; k++) {
      world.step(k * TICK, drive(k))
      const state = world.gameState()
      if (!state || !previous) throw new Error('no game state')
      expect(isValidGameState(state, 12)).toBe(true)
      // 지금 공 상태를 줄인 값과 같다
      expect(state.poses).toEqual(quantizeElements(world.elementSnapshot() ?? []).poses)
      expect(state.flags).toEqual(quantizeElements(world.elementSnapshot() ?? []).flags)
      const changed =
        JSON.stringify([state.poses, state.flags]) !==
        JSON.stringify([previous.poses, previous.flags])
      expect(state.revision).toBe(previous.revision + (changed ? 1 : 0))
      if (changed) bumps++
      previous = state
    }
    expect(bumps).toBeGreaterThan(10)
    expect(previous?.poses).toHaveLength(12 * GAME_POSE_STRIDE)
  })

  it('모든 공이 잠들고 아무것도 닿지 않으면 revision이 늘지 않는다', () => {
    const world = new PhysicsWorld(
      ballWorldSpec({ elements: { groups: ['garden'], preloads: [] } })
    )
    for (let k = 0; k < 20; k++) world.step(k * TICK, {})
    expect(world.gameState()?.revision).toBe(0)
    expect(world.gameState()?.flags).toEqual(new Array(8).fill(1))
  })

  it('같은 입력이면 바이트까지 같고(공 상태 포함), 세계 둘을 번갈아 돌려도 같다', () => {
    const trace = (world: PhysicsWorld, k: number): string =>
      JSON.stringify([
        world.step(k * TICK, drive(k)),
        world.pose(),
        world.drainNotices(),
        world.elementSnapshot(),
        world.gameState()
      ])
    const alone = (): string[] => {
      const world = new PhysicsWorld(scene())
      return Array.from({ length: 300 }, (_, k) => trace(world, k))
    }
    const first = alone()
    expect(alone()).toEqual(first)
    // 번갈아(만드는 순서도 바꿔서)
    const b = new PhysicsWorld(scene())
    const a = new PhysicsWorld(scene())
    const ta: string[] = []
    const tb: string[] = []
    for (let k = 0; k < 300; k++) {
      tb.push(trace(b, k))
      ta.push(trace(a, k))
    }
    expect(ta).toEqual(first)
    expect(tb).toEqual(first)
  })

  it('동역학 없는 로봇(공만)도 하위 단계를 돌고 공은 정적 섀시에 막힌다', () => {
    // 로봇(18 in 외곽 프리즘, 충돌체 칸 없음)을 향해 굴러가는 공
    const spec = ballWorldSpec({
      robot: { ...ballWorldSpec().robot, start: { x: 0, y: 0, yaw: 0 }, colliders: undefined }
    })
    const run = new BallRunner(spec, {
      field: ballField(),
      elements: {
        initial: [ball('pollen', { x: 0.6, y: 0, z: 0.03555 }, { velocity: { x: -1, y: 0, z: 0 } })]
      }
    }).run(1.5)
    const s = run.last()[0]
    // 외곽 앞면(x = HALF)에서 튕겨 나갔고 들어가지 않았다
    for (const snap of run.snapshots)
      expect(snap[0].position.x - 0.03555).toBeGreaterThan(HALF - 1e-3)
    expect(s.velocity.x).toBeGreaterThanOrEqual(0)
  })
})
