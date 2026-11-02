import { describe, expect, it } from 'vitest'
import { HUB_VELOCITY_SCALE, HUB_VELOCITY_WINDOW_NANOS, HubVelocityWindow } from './encoderVelocity'

const MS = 1_000_000

function window(samples: [ms: number, raw: number][]): HubVelocityWindow {
  const w = new HubVelocityWindow()
  for (const [ms, raw] of samples) w.record(ms * MS, raw)
  return w
}

describe('HubVelocityWindow', () => {
  it('창은 50 ms, 틱 수 × 20이 틱/s', () => {
    expect(HUB_VELOCITY_WINDOW_NANOS).toBe(50 * MS)
    expect(HUB_VELOCITY_SCALE).toBe(20)
  })

  it('기록이 없거나 첫 기록뿐이면 0(시작 position이 0이 아니어도)', () => {
    expect(new HubVelocityWindow().ticksPerSecond()).toBe(0)
    expect(window([[0, 12.7]]).ticksPerSecond()).toBe(0)
  })

  it('지난 50 ms의 정수 엔코더 변화 × 20: 기록 사이는 선형 보간, 기록 시각이면 그 값', () => {
    // t − 50 ms = 10 ms는 0 ms(0)와 30 ms(31) 사이: 10.33 → 10, 지금 60 → (60 − 10) × 20
    expect(
      window([
        [0, 0],
        [30, 31],
        [60, 60.4]
      ]).ticksPerSecond()
    ).toBe(1000)
    // t − 50 ms가 기록 시각과 같다(50 ms의 7.9 → 7): (20 − 7) × 20
    expect(
      window([
        [0, 0],
        [50, 7.9],
        [100, 20.2]
      ]).ticksPerSecond()
    ).toBe(260)
    // 음수는 floor(−0.5 → −1)
    expect(
      window([
        [0, 0],
        [50, -0.5]
      ]).ticksPerSecond()
    ).toBe(-20)
    // 바뀐 정수가 없으면 −0이 아니라 0
    expect(
      Object.is(
        window([
          [0, -0.2],
          [50, -0.7]
        ]).ticksPerSecond(),
        0
      )
    ).toBe(true)
  })

  it('처음 50 ms는 시작 전에 멈춰 있었다고 보고 첫 기록부터 센다', () => {
    const w = window([
      [100, 3.5],
      [110, 5.2],
      [120, 9.9]
    ])
    // 120 − 50 = 70 ms는 첫 기록(100 ms) 앞: (9 − 3) × 20
    expect(w.ticksPerSecond()).toBe(120)
    w.record(150 * MS, 30)
    // 150 − 50 = 100 ms = 첫 기록: (30 − 3) × 20
    expect(w.ticksPerSecond()).toBe(540)
    w.record(160 * MS, 31)
    // 110 ms(5.2): (31 − 5) × 20
    expect(w.ticksPerSecond()).toBe(520)
  })

  it('하위 단계가 창보다 길어도(아주 긴 구간) 보간한다', () => {
    // 1초 동안 1000틱 고르게: 950 ms는 950 → (1000 − 950) × 20
    expect(
      window([
        [0, 0],
        [1000, 1000]
      ]).ticksPerSecond()
    ).toBe(1000)
  })

  it('시각이 앞으로 가지 않는 기록은 무시하고, 창 앞의 기록은 하나만 남긴다', () => {
    const w = window([
      [0, 0],
      [10, 4]
    ])
    w.record(10 * MS, 100)
    w.record(5 * MS, 100)
    expect(w.ticksPerSecond()).toBe(80)
    // 1 ms마다 10초: 늘 51~52개만 들고 있다
    const long = new HubVelocityWindow()
    for (let ms = 0; ms <= 10_000; ms++) long.record(ms * MS, ms * 2.345)
    const kept = (long as unknown as { times: number[] }).times.length
    expect(kept).toBeLessThanOrEqual(52)
    expect(long.ticksPerSecond()).toBe(
      (Math.floor(10_000 * 2.345) - Math.floor(9_950 * 2.345)) * 20
    )
  })

  it('정상 상태의 속도와 한 단계(20 틱/s) 안이고 늘 20의 배수, 같은 기록열이면 같은 값', () => {
    const rate = 1234.567
    const values: number[] = []
    const again: number[] = []
    const a = new HubVelocityWindow()
    const b = new HubVelocityWindow()
    for (let k = 0; k <= 2000; k++) {
      const t = k * 0.7 * MS
      a.record(t, 17.25 + (rate * t) / 1e9)
      b.record(t, 17.25 + (rate * t) / 1e9)
      if (k >= 80) {
        values.push(a.ticksPerSecond())
        again.push(b.ticksPerSecond())
      }
    }
    expect(again).toEqual(values)
    for (const v of values) {
      expect(Math.abs(v % 20)).toBe(0)
      expect(Math.abs(v - rate)).toBeLessThan(20)
    }
    // 1234.567을 20 단위로 재면 1220과 1240이 섞인다
    expect([...new Set(values)].sort()).toEqual([1220, 1240])
  })
})
