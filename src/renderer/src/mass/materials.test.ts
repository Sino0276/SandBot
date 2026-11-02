import { describe, expect, it } from 'vitest'
import { PRINTED_SHELL_THICKNESS, printedFillFraction } from './materials'

describe('출력물 채움 비율', () => {
  it('주석의 예: 100×50×5 mm 판, 채움 25 %는 근사 0.63이고 정확한 안쪽 상자(벽 3)로는 0.53이다', () => {
    const [a, b, c] = [0.1, 0.05, 0.005]
    const volume = a * b * c
    const area = 2 * (a * b + b * c + c * a)
    expect(printedFillFraction(volume, area, 0.25)).toBeCloseTo(0.63, 2)
    // 벽 3겹(0.45 mm 선 × 3 ≈ 1.35 mm)과 위아래 0.8 mm로 깎은 안쪽 상자만 채움 비율로 찬다
    const inner = (a - 2 * 0.00135) * (b - 2 * 0.00135) * (c - 2 * 0.0008)
    const shell = 1 - inner / volume
    expect(shell + (1 - shell) * 0.25).toBeCloseTo(0.53, 2)
    expect(PRINTED_SHELL_THICKNESS).toBe(0.0011)
  })

  it('부피나 면적이 0이면 채움 비율만, 껍질은 1을 넘지 않는다', () => {
    expect(printedFillFraction(0, 1, 0.2)).toBe(0.2)
    expect(printedFillFraction(1, 0, 0.2)).toBe(0.2)
    expect(printedFillFraction(1e-9, 1, 0.2)).toBe(1)
  })
})
