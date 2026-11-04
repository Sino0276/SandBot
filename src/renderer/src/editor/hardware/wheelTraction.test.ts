import { describe, expect, it } from 'vitest'
import { ROLLER_COULOMB } from '../../../../shared/sim/wheelData'
import { wheelForwardTraction } from './wheelTraction'

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

  it('X 드라이브 옴니(±45°)는 μ·cos 45°에 롤러 쿨롱 몫 c_r·sin 45°를 더한다', () => {
    for (const angle of [45 * DEG, -45 * DEG, 135 * DEG])
      expect(wheelForwardTraction('omni', angle, null, 0.8)).toBeCloseTo(
        (0.8 + ROLLER_COULOMB) * Math.SQRT1_2,
        12
      )
    // 굴림 0°는 μ, 옆걸음(90°)은 μ 없이 롤러 몫만
    expect(wheelForwardTraction('omni', 0, null, 0.8)).toBeCloseTo(0.8, 12)
    expect(wheelForwardTraction('omni', 90 * DEG, null, 0.8)).toBeCloseTo(ROLLER_COULOMB, 12)
  })

  it('일반 바퀴는 팔각형 마찰 원: 굴림 방향과 옆 방향 모두 0.924·μ', () => {
    expect(wheelForwardTraction('traction', 0, null, 0.9)).toBeCloseTo(0.9 * OCTAGON_ALONG, 12)
    expect(wheelForwardTraction('traction', 90 * DEG, null, 0.9)).toBeCloseTo(
      0.9 * OCTAGON_ALONG,
      12
    )
    // 22.5°에서는 원에 닿는다(내접 팔각형의 꼭짓점)
    expect(wheelForwardTraction('traction', 22.5 * DEG, null, 0.9)).toBeCloseTo(0.9, 12)
  })
})
