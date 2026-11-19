import { describe, expect, it } from 'vitest'
import { resolveServoParams } from '../actuatorData'
import { ballStaticShapes, partHull, staticShapes, type BallStaticShape } from '../collision3d'
import { mecanum, outputs, robotSpec } from '../driveTestkit'
import { spherePartSeparation } from '../seasons/fieldGeometry'
import type { FieldPart } from '../seasons/fieldSpec'
import { resolveSeason } from '../seasons/seasons'
import type { SimCollider, SimJointSpec, Vec3, WorldSpec } from '../worldSpec'
import { sphereHull } from './ballContact'
import { ball, ballWorldSpec, BallRunner, TICK } from './elementTestkit'
import { elementSpawns, restBodyFrames } from './spawn'

// 6b FLOWER 케이지와 공(spec-6b §4·§10): 공은 케이지의 공 부품(고리 22.5° 조각, NECTAR 턱, 관, 압출재, 브래킷, 백스톱)에 닿는다.
// 시작 기둥 넷이 잠든 채 버티고, 위 입구로 떨어뜨린 POLLEN은 기둥 위로, 빈 FLOWER에서는 바닥까지 내려가고, NECTAR는 가운데 고리의
// 턱에 멈추며(FAC 2.9), POLLEN은 관 사이로 빠져나가지 못하고(FAC 2.11), 아래 회수 구멍으로 들어간 인테이크가 맨 아래 POLLEN을
// 꺼낸다. 정적 형상 수(로봇 부품·공 부품)와 공–볼록 기둥 좁은 단계(정확값 대조)도 본다.

const BIOBUZZ = resolveSeason('biobuzz')
const POLLEN_R = 0.03555
const NECTAR_R = 0.0457
// FLOWER 11(`<3>`, 빨강 벽) 축: 자기 u(필드 안쪽) = 필드 +Y, 자기 v = 필드 −X
const AXIS: Vec3 = { x: 0.59418, y: -1.728254, z: 0 }
const FLOWER_11 = 11
const ZERO = { x: 0, y: 0, z: 0 }
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const HALF = 0.2286

// 공 중심의 축에서 수평 거리와 자기 u
const offAxis = (p: Vec3): number => Math.hypot(p.x - AXIS.x, p.y - AXIS.y)
const localU = (p: Vec3): number => p.y - AXIS.y

const FLOWER_SPAWNS = elementSpawns(
  BIOBUZZ,
  { groups: ['flower'], preloads: [] },
  { x: 0, y: 0, yaw: 0 },
  restBodyFrames([]),
  [false, false]
)
// FLOWER 11 기둥은 flower 묶음의 8–11(9 → 10 → 11 → 12 순서)
const COLUMN_11 = [8, 9, 10, 11]
const flowerWorld = (): WorldSpec =>
  ballWorldSpec({ elements: { groups: ['flower'], preloads: [] } })
const emptyWorld = (): WorldSpec => ballWorldSpec({ elements: { groups: [], preloads: [] } })

describe('정적 형상 수(로봇 부품·공 부품)', () => {
  it('staticShapes: 벽 넷 + 부품 없는 구조물(0–8) + FLOWER마다 로봇 부품 15 + 바닥, 부품 구조물은 그 자리', () => {
    const shapes = staticShapes(BIOBUZZ)
    expect(shapes).toHaveLength(4 + 9 + 4 * 15 + 1)
    expect(shapes.map((s) => s.token).slice(0, 13)).toEqual([
      'w0',
      'w1',
      'w2',
      'w3',
      ...Array.from({ length: 9 }, (_, i) => `s${i}`)
    ])
    const flower = shapes.filter((s) => s.token.startsWith('s11p'))
    expect(flower).toHaveLength(15)
    const parts = BIOBUZZ.structures[FLOWER_11].parts!
    expect(flower.map((s) => s.token)).toEqual(
      parts.flatMap((p, j) => (p.robots ? [`s11p${j}`] : []))
    )
    expect(flower.every((s) => s.chassis && s.joints && s.friction === 0.4)).toBe(true)
    // 'none' 시즌은 벽 넷과 바닥(6a와 같다)
    expect(staticShapes(resolveSeason('none')).map((s) => s.token)).toEqual([
      'w0',
      'w1',
      'w2',
      'w3',
      'fl'
    ])
  })

  it('ballStaticShapes: 벽(상자) → 부품 없는 구조물(staticShapes의 같은 껍질) → FLOWER 묶음(공 부품 66) → 바닥', () => {
    const shapes = ballStaticShapes(BIOBUZZ)
    expect(ballStaticShapes(BIOBUZZ)).toBe(shapes)
    expect(Object.isFrozen(shapes)).toBe(true)
    expect(shapes.map((s) => s.kind)).toEqual([
      ...Array(4).fill('box'),
      ...Array(9).fill('hull'),
      ...Array(4).fill('group'),
      'floor'
    ])
    const robots = staticShapes(BIOBUZZ)
    shapes.forEach((s) => {
      if (s.kind === 'box' || s.kind === 'hull')
        expect(s.hull).toBe(robots.find((r) => r.token === s.token)!.hull)
    })
    const groups = shapes.filter(
      (s): s is Extract<BallStaticShape, { kind: 'group' }> => s.kind === 'group'
    )
    groups.forEach((g, n) => {
      const index = 9 + n
      expect(g.target).toEqual({ kind: 'structure', index })
      const parts = BIOBUZZ.structures[index].parts!
      expect(g.pieces.map((p) => p.token)).toEqual(
        parts.flatMap((p, j) => (p.balls ? [`s${index}p${j}`] : []))
      )
      expect(g.pieces).toHaveLength(66)
      // 관·받침은 정확한 원기둥, 나머지는 껍질
      expect(g.pieces.filter((p) => p.cylinder !== null)).toHaveLength(4 + 2)
      // 묶음 상자는 조각 상자를 모두 덮는다(봉투 밖으로 나가는 브래킷 조각도)
      for (const p of g.pieces)
        for (let k = 0; k < 3; k++) {
          expect(p.min[k]).toBeGreaterThanOrEqual(g.min[k])
          expect(p.max[k]).toBeLessThanOrEqual(g.max[k])
        }
    })
    // 'none' 시즌은 6a와 같은 벽 넷과 바닥
    expect(ballStaticShapes(resolveSeason('none')).map((s) => s.kind)).toEqual([
      'box',
      'box',
      'box',
      'box',
      'floor'
    ])
  })

  it('공–볼록 기둥 좁은 단계(sphereHull, partHull 껍질)는 정확한 분리(spherePartSeparation)와 같다(1e-9)', () => {
    // FLOWER 11(90° 돌린 다각형)과 그 거울 12(Rz(π) 회전 행렬)의 볼록 기둥 공 조각마다, 조각 둘레 무작위 구 중심
    let seed = 2026
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let compared = 0
    for (const index of [11, 12]) {
      const prisms = BIOBUZZ.structures[index].parts!.filter(
        (p): p is FieldPart & { shape: { kind: 'prism' } } => p.balls && p.shape.kind === 'prism'
      )
      for (const part of prisms) {
        const hull = partHull(part.shape)
        const c = part.shape.center
        for (let k = 0; k < 3; k++) {
          const at: [number, number, number] = [
            c.x + (random() - 0.5) * 0.2,
            c.y + (random() - 0.5) * 0.2,
            c.z + (random() - 0.5) * 0.12
          ]
          const exact = spherePartSeparation({ x: at[0], y: at[1], z: at[2] }, POLLEN_R, part.shape)
          if (exact < -POLLEN_R / 2 || exact > 0.05) continue
          const found = sphereHull(at, POLLEN_R, hull, 1)
          expect(found).not.toBeNull()
          expect(Math.abs(found!.separation - exact)).toBeLessThan(1e-9)
          compared++
        }
      }
    }
    expect(compared).toBeGreaterThan(100)
  })
})

describe('FLOWER 케이지와 공', () => {
  it('시작 기둥 넷(FLOWER 넷 × 4)은 잠든 채 버틴다(2 s 뒤 자세가 비트로 같다)', () => {
    const run = new BallRunner(flowerWorld()).run(2)
    const last = run.last()
    expect(last).toHaveLength(16)
    last.forEach((b, i) => {
      expect(b.asleep).toBe(true)
      expect(b.position).toEqual(FLOWER_SPAWNS[i].position)
    })
    expect(run.notices).toEqual([])
  })

  it('위 입구로 떨어뜨린 POLLEN은 기둥 위에 쌓이고, 빈 FLOWER에서는 바닥(아래 고리 구멍)까지 내려간다', () => {
    const dropped = new BallRunner(flowerWorld(), {
      elements: {
        initial: [...FLOWER_SPAWNS, ball('pollen', { x: AXIS.x, y: AXIS.y, z: 0.65 })]
      }
    }).run(4)
    const last = dropped.last()
    const top = last[16]
    // 기둥 맨 위 공(넷째) 위에 닿아 쉰다(위 고리 0.514 m 아래, 케이지 안)
    expect(top.asleep).toBe(true)
    expect(offAxis(top.position)).toBeLessThan(0.023)
    expect(top.position.z).toBeGreaterThan(last[11].position.z + POLLEN_R)
    expect(top.position.z).toBeLessThan(0.514452)
    for (const k of COLUMN_11) expect(offAxis(last[k].position)).toBeLessThan(0.023)
    expect(dropped.notices.filter((n) => n.code === 'worldError')).toEqual([])

    const empty = new BallRunner(emptyWorld(), {
      elements: { initial: [ball('pollen', { x: AXIS.x, y: AXIS.y, z: 0.65 })] }
    }).run(3)
    const alone = empty.last()[0]
    // NECTAR 턱(r_eq 0.044097)을 지나 바닥에 쉰다
    expect(alone.position.z).toBeCloseTo(POLLEN_R, 3)
    expect(offAxis(alone.position)).toBeLessThan(0.004)
  })

  it('NECTAR는 가운데 고리의 턱 셋에 멈춘다(FAC 2.9): 살며시 놓으면 설계 높이 0.119947, 떨어뜨려도 바닥에 닿지 않는다', () => {
    const gentle = new BallRunner(emptyWorld(), {
      elements: { initial: [ball('nectarRed', { x: AXIS.x, y: AXIS.y, z: 0.1205 })] }
    }).run(2)
    const rest = gentle.last()[0]
    expect(rest.asleep).toBe(true)
    // 턱 셋의 안쪽 현에 쉰다: 수직 면 r_eq의 위 모서리(w 0.10795)에서 중심 0.119947, 접촉 스프링 처짐 0.2 mm
    expect(Math.abs(rest.position.z - 0.119947)).toBeLessThan(5e-4)
    expect(offAxis(rest.position)).toBeLessThan(1e-3)
    for (const z0 of [0.3, 0.65]) {
      const dropped = new BallRunner(emptyWorld(), {
        elements: { initial: [ball('nectarRed', { x: AXIS.x, y: AXIS.y, z: z0 })] }
      }).run(3)
      const lowest = Math.min(...dropped.snapshots.map((s) => s[0].position.z))
      // 세게 떨어지면 끼인 접촉의 이력 스프링이 조금 더 깊게 눌린 채 둔다(6a 규칙, 0.65 m에서 약 2.7 mm)
      expect(lowest).toBeGreaterThan(0.115)
      expect(dropped.last()[0].position.z).toBeGreaterThan(0.115)
      expect(offAxis(dropped.last()[0].position)).toBeLessThan(0.005)
      expect(dropped.notices.filter((n) => n.code === 'worldError')).toEqual([])
    }
    // POLLEN은 같은 턱을 지나간다(위 시험) — NECTAR 지름(0.0914)은 턱 사이(2·0.044097)보다 크다
    expect(2 * NECTAR_R).toBeGreaterThan(2 * 0.044097)
  })

  it('관 사이로 POLLEN이 빠져나가지 못한다(FAC 2.11): 케이지 안 0.3 m에서 관 쪽·관 사이로 3 m/s로 던져도 안에 남는다', () => {
    // 관 사이 틈(2·(0.043815 − 0.013343) = 0.0609 m) < POLLEN 지름 0.0711 m
    for (const [vx, vy] of [
      [3, 0],
      [0, 3],
      [-3, 0],
      [2.1, 2.1],
      [-2.1, -2.1]
    ]) {
      const run = new BallRunner(emptyWorld(), {
        elements: {
          initial: [
            ball('pollen', { x: AXIS.x, y: AXIS.y, z: 0.3 }, { velocity: { x: vx, y: vy, z: 0 } })
          ]
        }
      }).run(1.5)
      const farthest = Math.max(...run.snapshots.map((s) => offAxis(s[0].position)))
      // 관 쪽 0.0131·관 사이 0.0221(자유 반지름 0.048621 − r)에 접촉 눌림 몇 mm
      expect(farthest).toBeLessThan(0.03)
      const last = run.last()[0]
      expect(last.out).toBe(false)
      expect(last.position.z).toBeCloseTo(POLLEN_R, 3)
      expect(offAxis(last.position)).toBeLessThan(0.02)
    }
  })

  // 인테이크: 섀시 앞(로봇 x)에 세운 원기둥 롤러 둘(CR 서보, μ 1)을 좌우에 두어 공을 옆에서 물고 돌려 로봇 쪽으로 끈다. 롤러는
  // 아래 고리(w ≤ 0.009) 위·가운데 고리(w ≥ 0.099) 아래(z 0.015–0.06)라 회수 구멍으로 들어간다. 메카넘 로봇이 FLOWER 11(빨강 벽)
  // 쪽으로 다가가 롤러가 맨 아래 공 옆에 오면 멈췄다가 물러난다. 섀시 앞면은 롤러보다 0.07 m 뒤라 케이지(바깥 0.0612)에 닿지 않는다
  function retrievalRobot(direction: 1 | -1): WorldSpec {
    const R = 0.015
    const squeeze = 0.004
    const ahead = 0.07
    const params = resolveServoParams('gobildaSpeed', 'crServo')
    const lateral = POLLEN_R + R - squeeze
    const roller = (side: 1 | -1): SimJointSpec => ({
      parent: -1,
      type: 'revolute',
      origin: { position: { x: HALF + ahead, y: side * lateral, z: 0.0375 }, rotation: ZERO },
      axis: { x: 0, y: 0, z: 1 },
      limits: null,
      body: { mass: 0.05, centerOfMass: ZERO, inertia: [2e-5, 2e-5, 2e-5, 0, 0, 0] },
      friction: { coulomb: 0.02, viscous: 0.001 },
      spring: null,
      drive: {
        kind: 'crServo',
        device: side > 0 ? 'left' : 'right',
        ratio: 1,
        params,
        direction: direction === side ? 1 : -1
      },
      switches: [],
      colliders: [
        {
          kind: 'cylinder',
          a: { x: 0, y: 0, z: -0.0225 },
          b: { x: 0, y: 0, z: 0.0225 },
          radius: R,
          friction: 1
        }
      ]
    })
    // 로봇은 −Y(FLOWER 쪽)를 본다. 롤러 중심의 자기 u = 0.08에서 시작
    const start = { x: AXIS.x, y: AXIS.y + 0.08 + HALF + ahead, yaw: -Math.PI / 2 }
    const base = robotSpec({ start }, { field: { season: 'biobuzz', hiveTipped: [false, false] } })
    const chassis: SimCollider = {
      kind: 'box',
      center: { x: 0, y: 0, z: 0.1 },
      rotation: I3,
      half: { x: HALF, y: HALF, z: 0.1 },
      friction: 0.4
    }
    return {
      ...base,
      robot: { ...base.robot, start, colliders: [chassis] },
      joints: [roller(1), roller(-1)],
      elements: { groups: ['flower'], preloads: [] }
    }
  }
  const retrieve = (direction: 1 | -1): BallRunner => {
    const servo = { position: 0, power: 0, pulseUs: 2400, pwm: true }
    return new BallRunner(retrievalRobot(direction)).run(3.5, (k) => {
      const t = (k * TICK) / 1e9
      const drive =
        t < 0.8 ? mecanum(0.15, 0, 0) : t < 1.1 ? mecanum(0, 0, 0) : mecanum(-0.15, 0, 0)
      return { ...outputs(drive), left: servo, right: servo }
    })
  }

  it('아래 회수 구멍으로 들어간 인테이크가 맨 아래 POLLEN을 꺼내고 위 공이 바닥으로 내려온다(롤러를 거꾸로 돌리면 안에 남는다)', () => {
    const run = retrieve(-1)
    const last = run.last()
    const [bottom, second, third, fourth] = COLUMN_11.map((k) => last[k])
    // 맨 아래 공: 아래 고리 바깥(자기 u > 바깥 0.0606 + r) 바닥에 있다
    expect(localU(bottom.position)).toBeGreaterThan(0.0606 + POLLEN_R)
    expect(bottom.position.z).toBeCloseTo(POLLEN_R, 3)
    expect(bottom.out).toBe(false)
    // 둘째 공이 아래 고리 구멍 안 바닥으로 내려왔고, 나머지는 케이지 안
    expect(second.position.z).toBeCloseTo(POLLEN_R, 3)
    expect(offAxis(second.position)).toBeLessThan(0.0387 - 0.02)
    for (const b of [third, fourth]) expect(offAxis(b.position)).toBeLessThan(0.023)
    // 다른 FLOWER 공은 잠든 채
    for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15]) expect(last[k].asleep).toBe(true)
    expect(run.notices.filter((n) => n.code === 'worldError')).toEqual([])

    // 롤러를 반대로 돌리면 공을 안쪽(압출재 쪽)으로 밀 뿐 꺼내지 못한다
    const wrong = retrieve(1).last()
    expect(localU(wrong[8].position)).toBeLessThan(0.0387)
  }, 30_000)
})
