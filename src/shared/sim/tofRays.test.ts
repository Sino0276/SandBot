import { describe, expect, it } from 'vitest'
import {
  TOF_BEAM_MEAN,
  TOF_BETA,
  TOF_BIAS,
  TOF_HALF_ANGLE,
  TOF_NORM,
  TOF_RAYS,
  TOF_RINGS,
  tofBeam
} from './rangeSensor'

// 거리 센서 광선 배치와 모듈 상수(4c, spec-4c §1.4-1 K5·A2). 기대값은 부록 A(scratchpad s4c2/sim2.py, Python)이고 Python과
// V8은 ulp 단위로 다를 수 있어 1e-14로 비교한다.

const DEG = Math.PI / 180

describe('거리 센서 광선', () => {
  it('61개 단위 벡터, 무게 합 1', () => {
    expect(TOF_RINGS.reduce((sum, n) => sum + n, 0)).toBe(61)
    expect(TOF_RAYS).toHaveLength(61)
    let total = 0
    for (const ray of TOF_RAYS) {
      const { x, y, z } = ray.dir
      expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(1e-15)
      expect(ray.weight).toBeGreaterThan(0)
      expect(ray.weight).toBeCloseTo(tofBeam(ray.theta) / (TOF_BEAM_MEAN * 61), 15)
      expect(ray.theta).toBeLessThan(TOF_HALF_ANGLE)
      total += ray.weight
    }
    expect(Math.abs(total - 1)).toBeLessThan(1e-15)
  })

  it('고리 각 3.1950°·5.7615°·8.4597°·11.1988°, 축은 θ 0', () => {
    expect(TOF_RAYS[0].theta).toBe(0)
    expect(TOF_RAYS[0].dir).toEqual({ x: 1, y: 0, z: 0 })
    const expected = [3.195, 5.7615, 8.4597, 11.1988]
    let start = 1
    TOF_RINGS.slice(1).forEach((n, k) => {
      const ring = TOF_RAYS.slice(start, start + n)
      for (const ray of ring) {
        expect(ray.theta).toBe(ring[0].theta)
        expect(Math.abs(ray.theta / DEG - expected[k])).toBeLessThan(1e-4)
      }
      start += n
    })
  })

  it('고리 1·3은 반 칸 엇갈리고 고리 2·4는 ψ 0(센서 +Z)부터', () => {
    let start = 1
    TOF_RINGS.slice(1).forEach((n, index) => {
      const k = index + 1
      const offset = k % 2 === 1 ? 0.5 : 0
      TOF_RAYS.slice(start, start + n).forEach((ray, j) => {
        expect(ray.psi).toBeCloseTo((2 * Math.PI * (j + offset)) / n, 15)
        const s = Math.sin(ray.theta)
        expect(ray.dir.y).toBeCloseTo(s * Math.sin(ray.psi), 15)
        expect(ray.dir.z).toBeCloseTo(s * Math.cos(ray.psi), 15)
      })
      start += n
    })
    // 고리 2의 첫 광선은 +Z 쪽
    const ring2 = TOF_RAYS[1 + 6]
    expect(ring2.psi).toBe(0)
    expect(ring2.dir.y).toBe(0)
    expect(ring2.dir.z).toBeGreaterThan(0)
  })

  it('빔과 모듈 상수가 부록 A 값과 같다', () => {
    expect(tofBeam(0)).toBe(2)
    expect(tofBeam(TOF_HALF_ANGLE)).toBe(0)
    expect(Math.abs(TOF_BEAM_MEAN - 1.0016551129101)).toBeLessThan(1e-13)
    expect(Math.abs(TOF_BIAS - 1.0082741271986795)).toBeLessThan(1e-14)
    expect(Math.abs(TOF_NORM - 0.9754822026109987)).toBeLessThan(1e-14)
    expect(Math.abs(TOF_BETA - 0.24661475576654543)).toBeLessThan(1e-14)
  })

  it('상수 배열은 얼어 있다', () => {
    expect(Object.isFrozen(TOF_RAYS)).toBe(true)
    expect(Object.isFrozen(TOF_RAYS[0])).toBe(true)
    expect(Object.isFrozen(TOF_RAYS[0].dir)).toBe(true)
  })
})
