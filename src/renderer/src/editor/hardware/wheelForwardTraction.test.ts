import { describe, expect, it } from 'vitest'
import { ROLLER_COULOMB } from '../../../../shared/sim/wheelData'
import { wheelForwardTraction } from '../../../../shared/sim/contact'

const DEG = Math.PI / 180
// 일반 바퀴 팔각형의 굴림 방향 지지: (1 + 2 cos 45°) / (2(cos 22.5° + sin 22.5°)) = cos 22.5° = 0.924
const OCTAGON_ALONG = Math.cos(Math.PI / 8)

describe('바퀴 하나의 앞 방향 견인(하중 1 N당)', () => {
  it('굴림 0°(또는 180°)의 메카넘은 두 롤러 형 모두 잠근 바퀴의 겉보기 μ 그대로', () => {
    for (const mu of [0.3, 0.6, 1.2])
      for (const rollers of ['flbr', 'frbl'] as const)
        for (const angle of [0, 180 * DEG])
          expect(wheelForwardTraction('mecanum', angle, rollers, mu)).toBeCloseTo(mu, 12)
    // 롤러를 모르면 flbr(시뮬레이터와 같다)
    expect(wheelForwardTraction('mecanum', 0, null, 0.6)).toBeCloseTo(0.6, 12)
  })

  it('X 드라이브 옴니(±45°)는 축 방향 롤러 쿨롱이 차대 운동을 거슬러 (μ − c_r)·cos 45°', () => {
    for (const angle of [45 * DEG, -45 * DEG, 135 * DEG])
      expect(wheelForwardTraction('omni', angle, null, 0.8)).toBeCloseTo(
        (0.8 - ROLLER_COULOMB) * Math.SQRT1_2,
        12
      )
    // 리뷰 탐침(review/renderer-r1/traction.test.ts)이 시뮬레이터에서 잰 X 드라이브 가속 0.634–0.639·μ·g
    const ratio = wheelForwardTraction('omni', 45 * DEG, null, 0.8) / 0.8
    expect(ratio).toBeGreaterThan(0.63)
    expect(ratio).toBeLessThan(0.645)
    // 굴림 0°는 μ
    expect(wheelForwardTraction('omni', 0, null, 0.8)).toBeCloseTo(0.8, 12)
  })

  it('H 드라이브 옆 바퀴(굴림 90°)는 앞으로 밀지 못해 0(옴니·일반 바퀴)', () => {
    for (const angle of [90 * DEG, -90 * DEG]) {
      expect(wheelForwardTraction('omni', angle, null, 0.8)).toBe(0)
      expect(wheelForwardTraction('traction', angle, null, 0.9)).toBe(0)
    }
  })

  it('일반 바퀴 굴림 0°는 팔각형의 굴림 방향 지지 0.924·μ', () => {
    expect(wheelForwardTraction('traction', 0, null, 0.9)).toBeCloseTo(0.9 * OCTAGON_ALONG, 12)
    expect(wheelForwardTraction('traction', 180 * DEG, null, 0.9)).toBeCloseTo(
      0.9 * OCTAGON_ALONG,
      12
    )
  })
})
