import { describe, expect, it } from 'vitest'
import { HALF, robotSpec, ZERO } from './driveTestkit'
import { WALL_INNER_HALF } from './field'
import {
  fieldCollision,
  REFERENCE_TOLERANCE,
  SUPPLEMENT_TOLERANCE,
  structureContactState,
  structureRows,
  type FieldCollision
} from './fieldContact'
import { boxSlabHull, placeFootprint } from './seasons/fieldGeometry'
import type { FieldSpec, FieldStructure } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { TEST_ROBOT_HEIGHT } from './testkit'
import type { Pose2, Vec2 } from './worldSpec'

// 고정 구조물 접촉 행(fieldContact.ts, spec-4ab §1.10)의 단위 시험: A1('none'은 행 없음), A4(로봇 면 기준 법선의 해석값),
// A5(다리 껍질과 프리즘 근사), 좁은 단계·히스테리시스·원기둥·넓은 단계

const BIOBUZZ = resolveSeason('biobuzz')
const NONE = resolveSeason('none')
const H18 = TEST_ROBOT_HEIGHT
const H29 = 0.7366
const H = 1e-3
const M = 7
const FOOTPRINT: Vec2[] = robotSpec().robot.footprint
const STILL = { vx: 0, vy: 0, omega: 0 }
const LEG_PX_PY = 2
const FLOWER_RED = 11

const rowsAt = (
  collision: FieldCollision,
  pose: Pose2,
  velocity = STILL,
  state = structureContactState(collision)
): ReturnType<typeof structureRows> =>
  structureRows(collision, FOOTPRINT, pose, velocity, H, M, state)

function polygonOf(collision: FieldCollision, index: number): Vec2[] {
  const solid = collision.solids.find((s) => s.index === index)
  if (!solid || solid.kind !== 'polygon') throw new Error(`${index}`)
  return solid.points
}

describe('4ab fieldContact: none 시즌', () => {
  it("A1 'none'은 벽 반폭이 field.ts 값 그대로이고 어떤 자세·속도에서도 구조물 행이 없다", () => {
    for (const height of [0.05, H18, H29, 3]) {
      const collision = fieldCollision(NONE, height)
      expect(collision.innerHalf).toBe(WALL_INNER_HALF)
      expect(collision.solids).toEqual([])
      expect(collision.structureCount).toBe(0)
      const state = structureContactState(collision)
      for (let x = -2; x <= 2; x += 0.25)
        for (let y = -2; y <= 2; y += 0.25)
          for (const yaw of [0, 0.3, -2, Math.PI])
            expect(
              structureRows(
                collision,
                FOOTPRINT,
                { x, y, yaw },
                { vx: 3, vy: -2, omega: 9 },
                H,
                M,
                state
              )
            ).toEqual([])
      expect(state.reference).toEqual([])
    }
  })

  it('BIOBUZZ의 접촉 준비: solid·field carrier만, 높이에 따라 고르고, μ는 구조물 값', () => {
    const at18 = fieldCollision(BIOBUZZ, H18)
    // 발판 막대 둘, 다리 넷, FLOWER 넷(위 막대·로고 판은 solid가 아니고 HIVE CELL은 HIVE carrier)
    expect(at18.solids.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 9, 10, 11, 12])
    expect(at18.friction).toEqual(at18.solids.map(() => 0.4))
    expect(at18.structureCount).toBe(BIOBUZZ.structures.length)
    expect(at18.innerHalf).toBe(1.79286)
    // 높이 1 cm여도 바닥(Z 0 이하)부터 서 있는 solid는 모두 걸린다
    expect(fieldCollision(BIOBUZZ, 0.01).solids.map((s) => s.index)).toEqual([
      0, 1, 2, 3, 4, 5, 9, 10, 11, 12
    ])
  })
})

describe('4ab fieldContact: 좁은 단계', () => {
  const collision = fieldCollision(BIOBUZZ, H18)
  const flower = (): Vec2[] => polygonOf(collision, FLOWER_RED)

  it('면 대 면(요 −90°, FLOWER 필드 쪽 면에 간격 0.5 mm): 구조물 면 기준, 점 둘은 FLOWER 폭으로 자른 로봇 변 위, 법선 +Y', () => {
    const top = Math.max(...flower().map((p) => p.y))
    const xs = flower().map((p) => p.x)
    const center = (Math.min(...xs) + Math.max(...xs)) / 2
    const pose = { x: center, y: top + HALF + 5e-4, yaw: -Math.PI / 2 }
    const rows = rowsAt(collision, pose)
    // 면 2(+Y)가 기준, 사건 변은 로봇 앞면(변 3: 꼭짓점 3 → 0), 자른 끝점은 그 꼭짓점 번호를 갖는다
    expect(rows.map((r) => r.key)).toEqual(['ns11.q2.r3', 'ts11.q2.r3', 'ns11.q2.r0', 'ts11.q2.r0'])
    const normal = rows[0]
    expect(normal.j.slice(0, 2)).toEqual([0, 1])
    expect(normal.target).toBeCloseTo(-5e-4 / H, 6)
    expect(normal.lo).toBe(0)
    expect(normal.hi).toBe(Infinity)
    // 점은 FLOWER 면의 양 끝(x 0.51867·0.66967): 토크 팔 r.x = 점 − 원점
    const arms = [rows[0], rows[2]].map((r) => r.j[2]).sort((a, b) => a - b)
    expect(arms[0]).toBeCloseTo(Math.min(...xs) - center, 9)
    expect(arms[1]).toBeCloseTo(Math.max(...xs) - center, 9)
    // 접선 행: t = ẑ × n = (−1, 0), 마찰 상자는 법선 행을 가리킨다
    expect(rows[1].j.slice(0, 2)).toEqual([-1, 0])
    expect(rows[1].friction).toEqual({ normal: 'ns11.q2.r3', mu: 0.4 })
  })

  it('A4 요 30° 로봇의 앞면이 FLOWER 모서리에 닿으면 기준은 로봇 앞면이고 행 법선은 −n′_3 = −(cos 30°, sin 30°)(필드 틀, 1e-12)', () => {
    // 앞면 변 3의 로봇 바깥 법선 (1, 0)을 요만큼 돌린 n′_3. 로봇이 −Y 쪽에서 오지 않게 요 −60°(−Y를 보며 +X로 30°)
    for (const yaw of [Math.PI / 6, -Math.PI / 3, (5 * Math.PI) / 6]) {
      const d = { x: Math.cos(yaw), y: Math.sin(yaw) }
      // 그 방향으로 갈 때 가장 먼저 닿는 FLOWER 꼭짓점
      const v = flower().reduce((a, b) => (b.x * d.x + b.y * d.y < a.x * d.x + a.y * d.y ? b : a))
      const pose = { x: v.x - (HALF + 2e-4) * d.x, y: v.y - (HALF + 2e-4) * d.y, yaw }
      const rows = rowsAt(collision, pose)
      expect(rows.length).toBe(2)
      expect(rows[0].key).toMatch(/^ns11\.p3\.c\d$/)
      const k = Number(rows[0].key.slice(-1))
      expect(flower()[k]).toEqual(v)
      const n = { x: -Math.cos(yaw), y: -Math.sin(yaw) }
      expect(Math.abs(rows[0].j[0] - n.x)).toBeLessThan(1e-12)
      expect(Math.abs(rows[0].j[1] - n.y)).toBeLessThan(1e-12)
      // 점은 구조물 꼭짓점 v, 토크 팔 −n.x·r.y + n.y·r.x
      const r = { x: v.x - pose.x, y: v.y - pose.y }
      expect(Math.abs(rows[0].j[2] - (-n.x * r.y + n.y * r.x))).toBeLessThan(1e-12)
      // 간격 2e-4 m(정지라 곡률 보정 없음)
      expect(rows[0].target).toBeCloseTo(-2e-4 / H, 6)
      // 접선 t = ẑ × n
      expect(Math.abs(rows[1].j[0] - -n.y)).toBeLessThan(1e-12)
      expect(Math.abs(rows[1].j[1] - n.x)).toBeLessThan(1e-12)
    }
  })

  it('넓은 단계·간격 거르기: 근방 밖이면 행이 없고 기억을 지운다. 다가오는 속도만큼 근방이 넓어진다', () => {
    const top = Math.max(...flower().map((p) => p.y))
    const state = structureContactState(collision)
    const near = { x: 0.594, y: top + HALF + 5e-4, yaw: -Math.PI / 2 }
    expect(rowsAt(collision, near, STILL, state).length).toBe(4)
    expect(state.reference[FLOWER_RED]).toEqual({ side: 'q', face: 2 })
    // 2 mm 떨어지면(근방 1 mm 밖) 정지면 행이 없고 기억을 지운다
    const far = { ...near, y: top + HALF + 2e-3 }
    expect(rowsAt(collision, far, STILL, state)).toEqual([])
    expect(state.reference[FLOWER_RED]).toBeNull()
    // −Y로 2 m/s면 하위 단계 1 ms에 2 mm를 오므로 행이 생긴다
    expect(rowsAt(collision, far, { vx: 0, vy: -2, omega: 0 }, state).length).toBe(4)
  })

  it('히스테리시스: 앞 기준 면이 지금 최대 분리에서 REFERENCE_TOLERANCE 안이면 그 면을 유지한다', () => {
    // FLOWER 모서리에 로봇 앞면이 닿은 자세(요 −60°)에서 기준은 로봇 면이다. 기억을 구조물 면으로 바꿔 넣어도 로봇 면 분리가
    // 구조물 면 분리를 크게 넘으므로 로봇 면이 된다. 반대로 앞 기준이 로봇 면이면 같은 자세에서 그대로다.
    const yaw = -Math.PI / 3
    const d = { x: Math.cos(yaw), y: Math.sin(yaw) }
    const v = flower().reduce((a, b) => (b.x * d.x + b.y * d.y < a.x * d.x + a.y * d.y ? b : a))
    const pose = { x: v.x - (HALF + 2e-4) * d.x, y: v.y - (HALF + 2e-4) * d.y, yaw }
    const state = structureContactState(collision)
    state.reference[FLOWER_RED] = { side: 'q', face: 0 }
    rowsAt(collision, pose, STILL, state)
    expect(state.reference[FLOWER_RED]).toEqual({ side: 'p', face: 3 })
    // 면 대 면에 가까운 자세(요가 −90°에서 조금 돈 것): 로봇 면과 구조물 면 분리 차가 REFERENCE_TOLERANCE 안이면 앞 기준을 따른다
    const top = Math.max(...flower().map((p) => p.y))
    const tilt = 1e-3
    const face = { x: 0.594, y: top + HALF + 3e-4, yaw: -Math.PI / 2 + tilt }
    const fromQ = structureContactState(collision)
    rowsAt(collision, face, STILL, fromQ)
    expect(fromQ.reference[FLOWER_RED]?.side).toBe('q')
    const fromP = structureContactState(collision)
    fromP.reference[FLOWER_RED] = { side: 'p', face: 3 }
    const keys = rowsAt(collision, face, STILL, fromP).map((r) => r.key)
    expect(fromP.reference[FLOWER_RED]).toEqual({ side: 'p', face: 3 })
    expect(keys.every((k) => /^[nt]s11\.p3\.c\d$/.test(k))).toBe(true)
    // 차가 REFERENCE_TOLERANCE를 넘게 돌면(약 1.5 mrad·0.33 m) 구조물 면 기억에서도 로봇 면이 된다
    expect(REFERENCE_TOLERANCE).toBe(5e-4)
    const turned = structureContactState(collision)
    turned.reference[FLOWER_RED] = { side: 'q', face: 2 }
    rowsAt(collision, { ...face, yaw: -Math.PI / 2 + 0.02 }, STILL, turned)
    expect(turned.reference[FLOWER_RED]?.side).toBe('p')
  })

  it('참 분리 축 보충: 구조물 면이 기준으로 남아도 로봇 면 분리가 SUPPLEMENT_TOLERANCE 넘게 크면 로봇 면 점을 더한다', () => {
    // FLOWER 필드 쪽 면에 로봇 앞면이 1 mrad 기울어(넘어 걸친 로봇 꼭짓점이 면 쪽으로 내려감) 0.3 mm 떨어진 자세: 로봇 면 분리가
    // 구조물 면 분리보다 크지만 REFERENCE_TOLERANCE 안이라 기준은 구조물 면 2다. 참 축(로봇 면 3)의 점(FLOWER 모서리)도 행이 된다
    const top = Math.max(...flower().map((p) => p.y))
    const tilt = 1e-3
    const face = { x: 0.594, y: top + HALF + 3e-4, yaw: -Math.PI / 2 + tilt }
    const state = structureContactState(collision)
    const rows = rowsAt(collision, face, STILL, state)
    expect(state.reference[FLOWER_RED]).toEqual({ side: 'q', face: 2 })
    const keys = rows.map((r) => r.key)
    expect(keys.filter((k) => /^ns11\.q2\.r\d$/.test(k)).length).toBe(2)
    const supplement = rows.filter((r) => /^ns11\.p3\.c\d$/.test(r.key))
    expect(supplement.length).toBeGreaterThan(0)
    // 보충 행 법선은 −n′_3(로봇 앞면 바깥 법선의 반대, 필드 틀)이고 기준 행 뒤에 온다
    for (const row of supplement) {
      expect(row.j[0]).toBeCloseTo(-Math.cos(face.yaw), 12)
      expect(row.j[1]).toBeCloseTo(-Math.sin(face.yaw), 12)
    }
    expect(keys.indexOf(supplement[0].key)).toBeGreaterThan(keys.lastIndexOf('ts11.q2.r0'))
    expect(SUPPLEMENT_TOLERANCE).toBe(1e-7)
    // 기울지 않은 면 대 면(분리가 같음)과 기울어 기준이 참 축인 자세(로봇 면 기억)에서는 더하지 않는다
    const flat = rowsAt(collision, { ...face, yaw: -Math.PI / 2 }).map((r) => r.key)
    expect(flat.every((k) => /^[nt]s11\.q2\.r\d$/.test(k))).toBe(true)
    const fromP = structureContactState(collision)
    fromP.reference[FLOWER_RED] = { side: 'p', face: 3 }
    const kept = rowsAt(collision, face, STILL, fromP).map((r) => r.key)
    expect(kept.every((k) => /^[nt]s11\.p3\.c\d$/.test(k))).toBe(true)
  })

  it('곡률 보정: 로봇 면 기준 점은 도는 로봇이 파고들지 않게 목표를 (h/2)·ω²·|n·r|만큼 조이고, 구조물 면 기준은 그대로다', () => {
    const yaw = -Math.PI / 3
    const d = { x: Math.cos(yaw), y: Math.sin(yaw) }
    const v = flower().reduce((a, b) => (b.x * d.x + b.y * d.y < a.x * d.x + a.y * d.y ? b : a))
    const pose = { x: v.x - (HALF + 2e-4) * d.x, y: v.y - (HALF + 2e-4) * d.y, yaw }
    const still = rowsAt(collision, pose)[0]
    const omega = 4
    const spinning = rowsAt(collision, pose, { vx: 0, vy: 0, omega })[0]
    // n·r = −(HALF + 간격): 점이 원점에서 법선 반대쪽
    const nr = -(HALF + 2e-4)
    expect(spinning.target - still.target).toBeCloseTo((omega * omega * -nr * H) / 2, 12)
    const top = Math.max(...flower().map((p) => p.y))
    const face = { x: 0.594, y: top + HALF + 5e-4, yaw: -Math.PI / 2 }
    expect(rowsAt(collision, face, { vx: 0, vy: 0, omega })[0].target).toBe(
      rowsAt(collision, face)[0].target
    )
  })
})

describe('4ab fieldContact: 원기둥', () => {
  const cylinder: FieldStructure = {
    ...BIOBUZZ.structures[FLOWER_RED],
    shape: {
      kind: 'cylinder',
      center: { x: 0.6, y: 0, z: 0.3 },
      rotation: ZERO,
      radius: 0.1,
      height: 0.6
    }
  }
  const field: FieldSpec = { ...NONE, structures: [cylinder] }
  const collision = fieldCollision(field, H18)

  it('높이 규칙(열린 구간)과 꼭짓점·변 특징', () => {
    expect(collision.solids.map((s) => s.kind)).toEqual(['circle'])
    // 원기둥 Z [0.5, 1.1]과 로봇 높이 0.5는 맞닿기만 해서 겹치지 않는다(열린 구간)
    expect(
      fieldCollision(
        {
          ...NONE,
          structures: [
            { ...cylinder, shape: { ...cylinder.shape, center: { x: 0.6, y: 0, z: 0.8 } } }
          ]
        },
        0.5
      ).solids
    ).toEqual([])
    // 꼭짓점: 요 45°의 꼭짓점 3 (H, −H)이 +X를 본다
    const corner = { x: 0.5 - HALF * Math.SQRT2 - 5e-4, y: 0, yaw: Math.PI / 4 }
    const vertex = rowsAt(collision, corner)
    expect(vertex.map((r) => r.key)).toEqual(['ns0.q0.r3', 'ts0.q0.r3'])
    expect(vertex[0].j[0]).toBeCloseTo(-1, 12)
    expect(vertex[0].target).toBeCloseTo(-5e-4 / H, 6)
    // 변: 요 0의 앞면(변 3)
    const face = { x: 0.5 - HALF - 5e-4, y: 0.05, yaw: 0 }
    const edge = rowsAt(collision, face)
    expect(edge.map((r) => r.key)).toEqual(['ns0.p3.c0', 'ts0.p3.c0'])
    expect(edge[0].j[0]).toBe(-1)
    expect(Math.abs(edge[0].j[1])).toBe(0)
    // 점은 C − ρ·n′: 토크 팔은 (0.5, 0) − 원점의 y 성분
    expect(edge[0].j[2]).toBeCloseTo(-(-1) * (0 - 0.05), 12)
    // 히스테리시스 기억은 쓰지 않는다
    const state = structureContactState(collision)
    rowsAt(collision, face, STILL, state)
    expect(state.reference).toEqual([null])
  })
})

describe('4ab fieldContact: 다리 껍질(프리즘 근사)', () => {
  const leg = BIOBUZZ.structures[LEG_PX_PY].shape
  if (leg.kind !== 'box') throw new Error('leg')
  const slab = (height: number): Vec2[] => {
    const hull = boxSlabHull(leg, 0, height)
    if (!hull) throw new Error('no hull')
    return hull
  }

  it('A5 boxSlabHull(다리 (+X,+Y), 0, H)의 안쪽 극값이 spec-4ab §1.10 표와 1e-4 안', () => {
    const table: [number, number, number][] = [
      [0.05, 0.4413, 0.57992],
      [0.2, 0.37452, 0.53826],
      [0.4572, 0.26001, 0.46682],
      [0.7366, 0.13561, 0.38922]
    ]
    for (const [height, x, y] of table) {
      const hull = slab(height)
      expect(Math.abs(Math.min(...hull.map((p) => p.x)) - x)).toBeLessThan(1e-4)
      expect(Math.abs(Math.min(...hull.map((p) => p.y)) - y)).toBeLessThan(1e-4)
    }
  })

  it('A5 OBB 껍질이 메시 단면(18 in: |Y| 0.46884–0.46924)을 품고 안쪽으로 2.5 mm 이내, 29 in 껍질이 18 in 껍질을 품는다', () => {
    const at18 = slab(H18)
    const inner = Math.min(...at18.map((p) => p.y))
    // 메시 단면의 안쪽 |Y| 최소 0.46884(spec-4ab §4 A5, CAD 메시)를 품는다
    expect(inner).toBeLessThanOrEqual(0.46884)
    expect(0.46884 - inner).toBeLessThan(0.0025)
    const at29 = slab(H29)
    for (const p of at18)
      for (let i = 0; i < at29.length; i++) {
        const a = at29[i]
        const b = at29[(i + 1) % at29.length]
        // 반시계 껍질의 안쪽(왼쪽) 또는 변 위
        expect((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)).toBeGreaterThan(-1e-12)
      }
  })

  it('프리즘 근사: 외곽은 placeFootprint로 놓고, 껍질 꼭짓점 번호는 convexHull 순서다', () => {
    const placed = placeFootprint(FOOTPRINT, { x: 0, y: 0, yaw: 0 })
    expect(placed).toEqual(FOOTPRINT.map((p) => ({ x: p.x + 0, y: p.y + 0 })))
    const collision = fieldCollision(BIOBUZZ, H18)
    expect(polygonOf(collision, LEG_PX_PY)).toEqual(slab(H18))
  })
})
