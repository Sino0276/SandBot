import { describe, expect, it } from 'vitest'
import { FieldRaycaster } from './fieldRaycast'
import { readRangeSensor, TOF_NOISE_OFFSET, tofNoiseSigma } from './rangeSensor'
import { noiseGaussian, noiseHash, noiseUniform, uniformFromHash } from './sensorNoise'
import { aimedPose, emptyField, material, sensedBox } from './testkit'

// 센서 잡음(4c, spec-4c §1.6 시험 A19)

const TICK = 5_000_000

describe('센서 잡음', () => {
  it('uniformFromHash는 (0, 1) 안이고 가우스는 유한하다', () => {
    expect(uniformFromHash(0)).toBeGreaterThan(0)
    expect(uniformFromHash(2 ** 32 - 1)).toBeLessThan(1)
    const extreme = Math.sqrt(-2 * Math.log(uniformFromHash(0)))
    expect(Number.isFinite(extreme)).toBe(true)
  })

  it('같은 입력은 같고, 시드·장치·흐름·순번이 다르면 다르다, 음수 시드·큰 순번이 정의된다', () => {
    const base = noiseUniform(7, 'front', 0, 0)
    expect(noiseUniform(7, 'front', 0, 0)).toBe(base)
    expect(noiseUniform(8, 'front', 0, 0)).not.toBe(base)
    expect(noiseUniform(7, 'frone', 0, 0)).not.toBe(base)
    expect(noiseUniform(7, 'front', 1, 0)).not.toBe(base)
    expect(noiseUniform(7, 'front', 0, 1)).not.toBe(base)
    // 이름 경계: ('ab', 흐름 0)과 ('a', …)가 섞이지 않는다
    expect(noiseHash(7, 'ab', 0, 0)).not.toBe(noiseHash(7, 'a', 0, 0))
    for (const seed of [-42, -(2 ** 31 - 1), 2 ** 31 - 1]) {
      const u = noiseUniform(seed, 'd', 0, 2 ** 40 + 5_000_000)
      expect(u).toBeGreaterThan(0)
      expect(u).toBeLessThan(1)
    }
    expect(noiseUniform(-42, 'd', 0, 0)).not.toBe(noiseUniform(42, 'd', 0, 0))
    // 32비트 넘는 순번의 위 반쪽도 섞인다
    expect(noiseUniform(1, 'd', 0, 2 ** 32)).not.toBe(noiseUniform(1, 'd', 0, 0))
  })

  it('가우스 표본: 평균 0·표준 편차 1(10000개)', () => {
    let sum = 0
    let sum2 = 0
    const n = 10000
    for (let i = 0; i < n; i++) {
      const z = noiseGaussian(3, 'front', 1, i * TICK)
      expect(Number.isFinite(z)).toBe(true)
      sum += z
      sum2 += z * z
    }
    const mean = sum / n
    expect(Math.abs(mean)).toBeLessThan(0.05)
    expect(Math.sqrt(sum2 / n - mean * mean)).toBeCloseTo(1, 1)
  })

  it('거리 잡음: 고정 오프셋 ±10 mm, 측정마다 σ가 식과 10% 안, null은 null', () => {
    const caster = new FieldRaycaster(
      emptyField({
        structures: [sensedBox({ x: 1.1, y: 0, z: 1 }, { x: 1, y: 4, z: 4 }, 0, material(0.3))]
      })
    )
    const pose = aimedPose({ x: 0, y: 0, z: 1 })
    const clean = readRangeSensor(caster, pose)
    const raw = clean.raw as number
    expect(raw).toBeCloseTo(0.6, 12)
    const sigma = tofNoiseSigma(raw, clean.reflectance)
    for (const seed of [1, 2, 3, -42]) {
      const samples: number[] = []
      for (let k = 0; k < 1000; k++) {
        const r = readRangeSensor(caster, pose, { seed, device: 'front', tNanos: k * TICK })
        // 잡음은 문턱 판정 뒤라 반사율·최대 거리는 그대로다
        expect(r.reflectance).toBe(clean.reflectance)
        samples.push(r.distance as number)
      }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length
      const std = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length)
      // 1 mm 반올림이 더하는 σ(1/√12 mm)를 빼고 비교한다
      expect(Math.sqrt(Math.max(0, std * std - 1e-6 / 12))).toBeGreaterThan(0.9 * sigma)
      expect(std).toBeLessThan(1.1 * sigma)
      const offset = mean - raw
      expect(Math.abs(offset)).toBeLessThanOrEqual(TOF_NOISE_OFFSET + (4 * sigma) / Math.sqrt(1000))
    }
    // 같은 시드·시각은 같다
    const a = readRangeSensor(caster, pose, { seed: 5, device: 'front', tNanos: 10 * TICK })
    expect(readRangeSensor(caster, pose, { seed: 5, device: 'front', tNanos: 10 * TICK })).toEqual(
      a
    )
    // 범위 밖은 잡음을 켜도 null
    const far = readRangeSensor(new FieldRaycaster(emptyField()), aimedPose({ x: 0, y: 0, z: 1 }), {
      seed: 5,
      device: 'front',
      tNanos: 0
    })
    expect(far.distance).toBeNull()
  })
})
