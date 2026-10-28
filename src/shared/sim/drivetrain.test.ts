import { describe, expect, it } from 'vitest'
import {
  applyTwist,
  compose,
  Drivetrain,
  inverse,
  twistBetween,
  wrapAngle,
  type Twist
} from './drivetrain'
import type { SimWheelSpec } from './worldSpec'

const LX = 0.16
const LY = 0.18

function wheel(
  x: number,
  y: number,
  kind: SimWheelSpec['kind'],
  extra: Partial<SimWheelSpec> = {}
): SimWheelSpec {
  return {
    position: { x, y },
    angle: 0,
    kind,
    rollers: kind === 'mecanum' ? (x > 0 === y > 0 ? 'flbr' : 'frbl') : null,
    radius: 0.048,
    gearRatio: 1,
    motor: 'm',
    ...extra
  }
}

// 앞왼·앞오른·뒤왼·뒤오른
const MECANUM = [
  wheel(LX, LY, 'mecanum'),
  wheel(LX, -LY, 'mecanum'),
  wheel(-LX, LY, 'mecanum'),
  wheel(-LX, -LY, 'mecanum')
]

// 표준 메카넘 역기구학(l = lx + ly)
function mecanumIk(vx: number, vy: number, w: number): number[] {
  const l = LX + LY
  return [vx - vy - l * w, vx + vy + l * w, vx + vy - l * w, vx - vy + l * w]
}

function expectTwist(actual: Twist, expected: Twist, digits = 9): void {
  expect(actual.dx).toBeCloseTo(expected.dx, digits)
  expect(actual.dy).toBeCloseTo(expected.dy, digits)
  expect(actual.dTheta).toBeCloseTo(expected.dTheta, digits)
}

describe('구동계 최소제곱', () => {
  it('메카넘: 표준 역기구학으로 만든 굴림에서 같은 변위를 되찾는다', () => {
    const drive = new Drivetrain(MECANUM)
    for (const [vx, vy, w] of [
      [0.01, 0, 0],
      [0, 0.01, 0],
      [0, 0, 0.05],
      [0.003, -0.007, 0.02]
    ])
      expectTwist(drive.twist(mecanumIk(vx, vy, w)), { dx: vx, dy: vy, dTheta: w }, 8)
  })

  it('메카넘 왼쪽 옆 이동: 앞왼 −, 앞오른 +, 뒤왼 +, 뒤오른 −', () => {
    const drive = new Drivetrain(MECANUM)
    const t = drive.twist([-0.01, 0.01, 0.01, -0.01])
    expect(t.dy).toBeCloseTo(0.01, 9)
    expect(t.dx).toBeCloseTo(0, 12)
    expect(t.dTheta).toBeCloseTo(0, 12)
    expect(mecanumIk(0, 1, 0).map(Math.sign)).toEqual([-1, 1, 1, -1])
  })

  it('옴니 X 배치(바퀴가 대각 45°): 네 바퀴 같은 굴림의 앞뒤 부호로 앞으로 간다', () => {
    const r = 0.2
    const at = (deg: number, roll: number): SimWheelSpec =>
      wheel(r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), 'omni', {
        angle: ((deg + roll) * Math.PI) / 180
      })
    // 바퀴 굴림 방향은 중심에서 바깥을 향한 방향의 수직(반시계 접선)
    const wheels = [at(45, 90), at(135, 90), at(225, 90), at(315, 90)]
    const drive = new Drivetrain(wheels)
    // 앞으로 0.01: 각 바퀴 굴림 = u_i · (0.01, 0)
    const rolls = wheels.map((w) => Math.cos(w.angle) * 0.01)
    expectTwist(drive.twist(rolls), { dx: 0.01, dy: 0, dTheta: 0 })
    // 제자리 회전: 접선 바퀴는 모두 r·Δθ
    expectTwist(drive.twist(wheels.map(() => r * 0.05)), { dx: 0, dy: 0, dTheta: 0.05 })
  })

  it('4륜 탱크 제자리 회전: ω = Δ·ly/(lx² + ly²)', () => {
    const wheels = [
      wheel(LX, LY, 'traction'),
      wheel(LX, -LY, 'traction'),
      wheel(-LX, LY, 'traction'),
      wheel(-LX, -LY, 'traction')
    ]
    const drive = new Drivetrain(wheels)
    const d = 0.004
    // 왼쪽 뒤로, 오른쪽 앞으로 → 반시계(+)
    const t = drive.twist([-d, d, -d, d])
    expect(t.dTheta).toBeCloseTo((d * LY) / (LX * LX + LY * LY), 9)
    expect(t.dx).toBeCloseTo(0, 12)
    expect(t.dy).toBeCloseTo(0, 12)
    // 바퀴가 옆으로 붙어 있으면(lx = 0) 미끄럼 없는 회전 Δ/ly
    const narrow = new Drivetrain([wheel(0, LY, 'traction'), wheel(0, -LY, 'traction')])
    expect(narrow.twist([-d, d]).dTheta).toBeCloseTo(d / LY, 9)
  })

  it('구동하지 않는 일반 바퀴는 옆 미끄럼만 막고, 메카넘·옴니는 행이 없다', () => {
    // 뒤 두 바퀴만 구동하는 일반 바퀴 + 앞 캐스터 같은 옴니(구동 없음): 앞 옴니는 아무것도 막지 않는다
    const drive = new Drivetrain([
      wheel(-LX, LY, 'traction'),
      wheel(-LX, -LY, 'traction'),
      wheel(LX, 0, 'omni', { motor: null })
    ])
    expectTwist(drive.twist([0.01, 0.01, 0]), { dx: 0.01, dy: 0, dTheta: 0 })
    // 구동 없는 일반 바퀴 하나뿐이면 옆으로만 막히고 움직이지 않는다
    const idle = new Drivetrain([wheel(0, 0, 'traction', { motor: null })])
    expectTwist(idle.twist([0]), { dx: 0, dy: 0, dTheta: 0 }, 15)
    expectTwist(new Drivetrain([]).twist([]), { dx: 0, dy: 0, dTheta: 0 }, 15)
    expectTwist(new Drivetrain([wheel(0, 0, 'mecanum', { motor: null })]).twist([1]), {
      dx: 0,
      dy: 0,
      dTheta: 0
    })
  })

  it('특이 배치는 최소 노름 해: 바퀴 하나, 평행한 옴니', () => {
    // 가운데 옴니 하나: 앞으로만(옆·회전 0)
    expectTwist(new Drivetrain([wheel(0.1, 0, 'omni')]).twist([0.02]), {
      dx: 0.02,
      dy: 0,
      dTheta: 0
    })
    // 옆에 붙은 옴니 하나(L = 0.2): 행 [1, 0, −1]·(vx, vy, ωL) = s의 최소 노름 → vx = s/2, ωL = −s/2
    const t = new Drivetrain([wheel(0, 0.2, 'omni')]).twist([0.02])
    expect(t.dx).toBeCloseTo(0.01, 9)
    expect(t.dy).toBeCloseTo(0, 12)
    expect(t.dTheta * 0.2).toBeCloseTo(-0.01, 9)
    // 평행한 옴니 두 개: 옆 성분은 정할 수 없어 0
    const parallel = new Drivetrain([wheel(0, 0.2, 'omni'), wheel(0, -0.2, 'omni')])
    expectTwist(parallel.twist([0.01, 0.01]), { dx: 0.01, dy: 0, dTheta: 0 })
    expectTwist(parallel.twist([-0.004, 0.004]), { dx: 0, dy: 0, dTheta: 0.004 / 0.2 })
  })
})

describe('SE(2)', () => {
  it('변위 적용과 되찾기, 합성·역, 각 감기', () => {
    const start = { x: 0.3, y: -0.2, yaw: 2.5 }
    for (const twist of [
      { dx: 0.1, dy: 0.02, dTheta: 0.5 },
      { dx: -0.05, dy: 0.01, dTheta: 1e-8 },
      { dx: 0, dy: 0, dTheta: -3 }
    ]) {
      const end = applyTwist(start, twist)
      expectTwist(twistBetween(start, end), twist, 12)
    }
    // 반 바퀴를 돌며 앞으로 가면 반원: 지름 2·dx/π만큼 왼쪽
    const arc = applyTwist({ x: 0, y: 0, yaw: 0 }, { dx: Math.PI, dy: 0, dTheta: Math.PI })
    expect(arc.x).toBeCloseTo(0, 12)
    expect(arc.y).toBeCloseTo(2, 12)
    const p = { x: 1, y: 2, yaw: 0.7 }
    const identity = compose(p, inverse(p))
    expect(identity.x).toBeCloseTo(0, 12)
    expect(identity.y).toBeCloseTo(0, 12)
    expect(identity.yaw).toBeCloseTo(0, 12)
    expect(wrapAngle(Math.PI)).toBe(Math.PI)
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12)
    expect(wrapAngle(3 * Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12)
    expect(wrapAngle(-0.25)).toBe(-0.25)
  })
})
