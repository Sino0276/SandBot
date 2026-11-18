import { describe, expect, it } from 'vitest'
import { GRAVITY } from '../physics'
import { resolveSeason } from '../seasons/seasons'
import type { SimElementState } from '../worldSpec'
import { CONTACT_STIFFNESS_PER_PLATE } from './elementData'
import {
  ball,
  ballField,
  ballWorldSpec,
  BallRunner,
  speed,
  withElementType
} from './elementTestkit'

// 공 하나·몇 개의 해석 시험(6a, spec-6a §6): 로봇 없이(동역학 없는 로봇은 구석에 서 있고 충돌체가 없다) 넓은 빈 바닥(구조물 없음,
// 반폭 10 m)에서 공기·잠들기를 끄고(따로 볼 때만 켠다) 판 강성·반발·마찰·굴림 저항이 낸 값을 해석해와 비교한다.

const POLLEN = resolveSeason('biobuzz').elements!.types.find((t) => t.kind === 'pollen')!
const r = POLLEN.radius
const m = POLLEN.mass
const K = CONTACT_STIFFNESS_PER_PLATE * POLLEN.contact.plateStiffness
// I/(m·r²)
const SHELL = POLLEN.inertia / (m * r * r)
const WIDE = ballField({}, 10)

function runner(
  initial: SimElementState[],
  change: { air?: boolean; sleep?: boolean } = {},
  field = WIDE,
  tick?: number
): BallRunner {
  return new BallRunner(
    ballWorldSpec(),
    { field, elements: { initial, air: change.air ?? false, sleep: change.sleep ?? false } },
    tick
  )
}

// 운동 + 위치 에너지(공들). innerHalf를 주면 바닥·벽·공끼리 접촉 스프링의 ½kδ²도 더한다(부드러운 법선이 잠깐 담는 에너지)
function energy(states: readonly SimElementState[], innerHalf?: number): number {
  let sum = 0
  if (innerHalf !== undefined) {
    const spring = (k: number, depth: number): number => (depth > 0 ? 0.5 * k * depth * depth : 0)
    states.forEach((s, i) => {
      const p = s.position
      sum += spring(K, r - p.z)
      sum += spring(K, p.x + r - innerHalf) + spring(K, -innerHalf - (p.x - r))
      sum += spring(K, p.y + r - innerHalf) + spring(K, -innerHalf - (p.y - r))
      for (const o of states.slice(i + 1)) {
        const q = o.position
        sum += spring(K / 2, 2 * r - Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))
      }
    })
  }
  for (const s of states) {
    const w = s.angularVelocity
    sum +=
      0.5 * m * speed(s.velocity) ** 2 +
      0.5 * POLLEN.inertia * (w.x * w.x + w.y * w.y + w.z * w.z) +
      m * GRAVITY * s.position.z
  }
  return sum
}

describe('공 물리 해석 시험(6a)', () => {
  it('바닥에 쉬는 공은 10 s 동안 떨지 않고 mg/k만큼 가라앉는다(잠들기 끔)', () => {
    const run = runner([ball('pollen', { x: 0.3, y: -0.2, z: r })]).run(10)
    const late = run.snapshots.slice(200)
    for (const [s] of late) {
      expect(speed(s.velocity)).toBeLessThan(1e-5)
      expect(Math.hypot(s.position.x - 0.3, s.position.y + 0.2)).toBeLessThan(1e-6)
    }
    const sink = r - run.last()[0].position.z
    expect(sink / ((m * GRAVITY) / K)).toBeCloseTo(1, 2)
    expect(Math.abs(sink / ((m * GRAVITY) / K) - 1)).toBeLessThan(0.01)
  })

  it('쉬는 공은 SLEEP_TIME 뒤 잠들고 속도가 정확히 0이다', () => {
    const run = runner([ball('pollen', { x: 0, y: 0, z: r })], { sleep: true }).run(1)
    const first = run.snapshots.findIndex((s) => s[0].asleep)
    // 가라앉는 몇 ms 뒤부터 0.5 s
    expect(first * 0.005).toBeGreaterThan(0.5)
    expect(first * 0.005).toBeLessThan(0.6)
    const last = run.last()[0]
    expect(last.asleep).toBe(true)
    expect(last.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(last.angularVelocity).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('0.5 m에서 떨어진 공은 e²·h₀만큼 튄다(±2%)', () => {
    const h0 = 0.5
    const run = runner([ball('pollen', { x: 0, y: 0, z: h0 + r })], {}, WIDE, 1_000_000)
    let bounced = false
    let apex = 0
    run.run(1.3, undefined, () => {
      const s = run.last()[0]
      if (s.velocity.z > 0) bounced = true
      if (bounced && s.velocity.z > -1e-9) apex = Math.max(apex, s.position.z - r)
      if (bounced && s.velocity.z < 0 && s.position.z - r < apex / 2) bounced = false
    })
    const e = POLLEN.contact.restitution.floor
    expect(Math.abs(apex / (e * e * h0) - 1)).toBeLessThan(0.02)
  })

  it('미끄러지던 공은 v₀/(1 + I/mr²)로 구른다(±2%, 굴림 저항 0)', () => {
    const field = withElementType(WIDE, 'pollen', (t) => ({
      ...t,
      contact: { ...t.contact, rollingResistance: 0, spinRadius: 0 }
    }))
    const v0 = 2
    const run = runner(
      [ball('pollen', { x: -5, y: 0, z: r }, { velocity: { x: v0, y: 0, z: 0 } })],
      {},
      field
    ).run(1)
    const s = run.last()[0]
    expect(Math.abs(s.velocity.x / (v0 / (1 + SHELL)) - 1)).toBeLessThan(0.02)
    // 구름: ω = v/r(오른손: +x로 구르면 +y 둘레)
    expect(Math.abs(s.angularVelocity.y / (s.velocity.x / r) - 1)).toBeLessThan(0.01)
    expect(Math.abs(s.velocity.y)).toBeLessThan(1e-9)
  })

  it('구르는 공은 μ_rr·g/(1 + I/mr²)로 느려진다(±2%)', () => {
    const v0 = 1.5
    const run = runner([
      ball(
        'pollen',
        { x: -5, y: 0, z: r },
        { velocity: { x: v0, y: 0, z: 0 }, angularVelocity: { x: 0, y: v0 / r, z: 0 } }
      )
    ]).run(3)
    const a = 100
    const b = 500
    const decel =
      (run.snapshots[a][0].velocity.x - run.snapshots[b][0].velocity.x) / ((b - a) * 0.005)
    const expected = (POLLEN.contact.rollingResistance * GRAVITY) / (1 + SHELL)
    expect(Math.abs(decel / expected - 1)).toBeLessThan(0.02)
  })

  it('5 m/s로 벽에 부딪힌 공은 딱딱한 면 반발로 튀고 벽을 지나가지 않는다', () => {
    const field = ballField()
    const innerHalf = field.perimeter.innerHalf
    const run = runner(
      [ball('pollen', { x: innerHalf - 0.3, y: 0, z: 0.15 }, { velocity: { x: 5, y: 0, z: 0 } })],
      {},
      field,
      1_000_000
    )
    let deepest = Infinity
    run.run(0.15, undefined, () => {
      const s = run.last()[0]
      deepest = Math.min(deepest, innerHalf - (s.position.x + r))
    })
    const s = run.last()[0]
    expect(s.out).toBe(false)
    // 반발 속도 ≈ e_hard·5(공기 끔, 접촉 중 중력·마찰만큼)
    expect(-s.velocity.x / 5).toBeGreaterThan(POLLEN.contact.restitution.hard * 0.97)
    expect(-s.velocity.x / 5).toBeLessThan(POLLEN.contact.restitution.hard * 1.01)
    // 침투는 심보다 얕다(강체 반발 행이라 1 mm 아래)
    expect(deepest).toBeGreaterThan(-1e-3)
  })

  it('벽에 기댄 한 줄 넷과 피라미드는 5 s 동안 그대로이고 에너지가 늘지 않고 심까지 눌리지 않는다', () => {
    const field = ballField()
    const ih = field.perimeter.innerHalf
    const d = 2 * r
    // 빨강 벽(−y) 앞 한 줄 넷(서로 닿음) + 관중석 벽(+x) 구석에 셋 피라미드(바닥 둘 + 위 하나)
    const row = [0, 1, 2, 3].map((k) => ball('pollen', { x: -0.5 + k * d, y: -ih + r, z: r }))
    const base = [
      ball('pollen', { x: ih - r, y: 0, z: r }),
      ball('pollen', { x: ih - r - d, y: 0, z: r })
    ]
    const top = ball('pollen', { x: ih - r - r, y: 0, z: r + Math.sqrt(3) * r + 1e-4 })
    const initial = [...row, ...base, top]
    const run = runner(initial, {}, field)
    let previous = energy(initial, ih)
    let core = Infinity
    run.run(5, undefined, () => {
      const states = run.last()
      const e = energy(states, ih)
      expect(e).toBeLessThanOrEqual(previous + 1e-9)
      previous = e
      for (const s of states) core = Math.min(core, s.position.z - r)
    })
    const last = run.last()
    last.forEach((s, i) => {
      expect(
        Math.hypot(s.position.x - initial[i].position.x, s.position.y - initial[i].position.y)
      ).toBeLessThan(2e-3)
      expect(speed(s.velocity)).toBeLessThan(1e-3)
    })
    // 위 공은 아래 둘 위에 남는다
    expect(last[6].position.z).toBeGreaterThan(r + 1.6 * r)
    expect(-core).toBeLessThan(POLLEN.contact.coreDepthRatio * r)
  })

  it('항력은 날아가는 공을 늦추고 Magnus는 회전축 × 속도 쪽으로 휜다', () => {
    const field = ballField({}, 10)
    const flying = (spin: number): SimElementState =>
      ball(
        'pollen',
        { x: -5, y: 0, z: 2 },
        { velocity: { x: 8, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: spin } }
      )
    const plain = runner([flying(0)], { air: true }, field)
      .run(0.2)
      .last()[0]
    const vacuum = runner([flying(0)], { air: false }, field)
      .run(0.2)
      .last()[0]
    const spun = runner([flying(100)], { air: true }, field)
      .run(0.2)
      .last()[0]
    expect(plain.velocity.x).toBeLessThan(vacuum.velocity.x - 0.05)
    // ω = +z, v = +x → ω × v = +y
    expect(spun.velocity.y).toBeGreaterThan(0.05)
    expect(plain.velocity.y).toBe(0)
  })
})
