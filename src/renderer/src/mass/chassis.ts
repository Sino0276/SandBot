import { symmetricEigen3 } from '../../../shared/sim/drivetrain'
import type { Vec3 } from '../scene/model'
import type { SymMatrix3 } from './types'

// 섀시 몸체(3c, spec-3c §1.7): 질량 모델의 로봇 전체(RobotMass)에서 관절 몸체들을 평행축 정리로 뺀 것. 바퀴가 있는 로봇의
// 부유 기저가 이 몸체를 싣는다(세계 설명 robot.body, play/worldSpec.ts). 순수 함수이고 사칙연산과 symmetricEigen3만 써서
// 결정적이다.

// 강체 하나의 질량 성질: kg, 로봇 좌표 무게중심(m), 무게중심 기준 관성(로봇 축, kg·m², 비대각은 행렬 값 그대로)
export type MassProps = { mass: number; centerOfMass: Vec3; inertia: SymMatrix3 }

// 무게중심 c에 있는 질량 m의 관성 I를 점 p 기준으로 옮긴 것(평행축 정리: I + m(|d|²E − d dᵀ), d = c − p)
function inertiaAbout(props: MassProps, point: Vec3): SymMatrix3 {
  const { mass: m, inertia: s } = props
  const [dx, dy, dz] = [0, 1, 2].map((k) => props.centerOfMass[k] - point[k])
  return [
    s[0] + m * (dy * dy + dz * dz),
    s[1] + m * (dx * dx + dz * dz),
    s[2] + m * (dx * dx + dy * dy),
    s[3] - m * dx * dy,
    s[4] - m * dx * dz,
    s[5] - m * dy * dz
  ]
}

// 전체에서 부분들을 뺀 나머지. 나머지 질량이 양수가 아니면 무게중심은 전체의 것, 관성은 0이다(호출하는 쪽이 질량 하한으로
// 대체한다). 관성은 나머지의 무게중심 기준으로 전체·부분을 옮겨 뺀다(원점 기준으로 빼고 옮기는 것보다 반올림이 작다).
export function subtractMassProps(total: MassProps, parts: readonly MassProps[]): MassProps {
  let mass = total.mass
  const moment = [0, 1, 2].map((k) => total.mass * total.centerOfMass[k])
  for (const part of parts) {
    mass -= part.mass
    for (let k = 0; k < 3; k++) moment[k] -= part.mass * part.centerOfMass[k]
  }
  if (!(mass > 0))
    return {
      mass,
      centerOfMass: [...total.centerOfMass] as Vec3,
      inertia: [0, 0, 0, 0, 0, 0]
    }
  const centerOfMass = moment.map((value) => value / mass) as Vec3
  const inertia = inertiaAbout(total, centerOfMass)
  for (const part of parts) {
    const own = inertiaAbout(part, centerOfMass)
    for (let k = 0; k < 6; k++) inertia[k] -= own[k]
  }
  return { mass, centerOfMass, inertia }
}

// 관성의 주관성 값을 하한 floor 이상으로 올린다(spec-3c §1.7: 빼기의 반올림·점질량으로 0이나 음수가 된 축). 올린 뒤 삼각
// 부등식(I1 + I2 ≥ I3, 실제 질량 분포의 관성은 늘 지킨다)이 반올림으로 깨졌으면 작은 두 값을 같은 만큼 올려 맞춘다. 고칠
// 것이 없으면 값을 그대로 돌려준다(고유 분해로 다시 만들면 반올림이 바뀌므로). 반올림 차는 대각 합의 1e-12배까지 둔다.
export function floorInertia(inertia: SymMatrix3, floor: number): SymMatrix3 {
  const [xx, yy, zz, xy, xz, yz] = inertia
  const { values, vectors } = symmetricEigen3([
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz]
  ])
  const order = [0, 1, 2].sort((a, b) => values[a] - values[b] || a - b)
  const lifted = values.map((value) => Math.max(value, floor))
  const [small, middle, large] = order.map((k) => lifted[k])
  const tol = 1e-12 * (Math.abs(xx) + Math.abs(yy) + Math.abs(zz))
  const gap = large - small - middle
  if (gap > tol) {
    lifted[order[0]] += gap / 2
    lifted[order[1]] += gap / 2
  }
  if (lifted.every((value, k) => value === values[k])) return inertia
  // V·Λ·Vᵀ(vectors의 k열이 values[k]의 고유 벡터)
  const at = (i: number, j: number): number =>
    lifted.reduce((sum, value, k) => sum + value * vectors[i][k] * vectors[j][k], 0)
  return [at(0, 0), at(1, 1), at(2, 2), at(0, 1), at(0, 2), at(1, 2)]
}
