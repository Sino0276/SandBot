import type { JointDrive, JointSettings, JointType, SceneObject } from '../../scene/model'

// 관절 카드가 쓰는 기본값·범위·붙일 곳(spec-3b §2). 갈래 C의 scene/joint.ts가 같은 이름으로 정한다. 통합 때 이 파일을
// 지우고 import를 '../../scene/joint'로 바꾼다(값은 spec §2와 같게 두었다). 그때까지 스토어 setJoint는 정리(sanitize)를
// 하지 않으므로 카드가 범위 안의 값만 넣는다.

// 앵커 성분 한도(m, |x| ≤ 10, spec §2)
export const MAX_JOINT_ANCHOR = 10
// 한계 한도: 회전 ±4π rad, 직선 ±10 m(세계 설명의 각·위치 한도와 같게, 가정)
export const MAX_REVOLUTE_LIMIT = 4 * Math.PI
export const MAX_PRISMATIC_LIMIT = 10
// 장치 출력축 → 관절 외부 감속비 범위(spec §2)
export const MIN_JOINT_GEAR_RATIO = 0.01
export const MAX_JOINT_GEAR_RATIO = 1000
// 스풀(풀리) 지름 범위(m, 1 mm–0.5 m, spec §2)
export const MIN_SPOOL_DIAMETER = 0.001
export const MAX_SPOOL_DIAMETER = 0.5
// 기본 스풀 지름(m): goBILDA 2단 Viper-Slide 키트의 Hub-Mount Winch Pulley 둘레 112 mm(= 지름 35.65 mm,
// https://www.gobilda.com/2-stage-viper-slide-kit/, spec-3b data §5.1)
export const DEFAULT_SPOOL_DIAMETER = 0.112 / Math.PI
// 마찰·스프링 한도(spec §2: 유한·≥ 0). 상한은 세계 설명 검증(parseWorldSpec)·갈래 C의 정리와 같은 값(가정: FTC
// 메커니즘보다 넉넉히 두고 틀린 단위·폭주 값만 막는다). 쿨롱 마찰·정전력 스프링 N 또는 N·m, 점성 N·s/m 또는
// N·m·s/rad, 강성 N/m 또는 N·m/rad
export const MAX_JOINT_FORCE = 1e4
export const MAX_JOINT_DAMPING = 1e4
export const MAX_JOINT_STIFFNESS = 1e6

// 종류별 기본 한계·마찰(spec-3b §2): 회전은 ±90°·쿨롱 0.02 N·m·점성 0.001 N·m·s/rad(가정: 베어링 축 하나),
// 직선은 0–0.5 m·쿨롱 1 N(가정: 볼 서랍 슬라이드)·점성 0.5 N·s/m(가정)
const DEFAULTS: Record<JointType, Pick<JointSettings, 'limits' | 'friction'>> = {
  revolute: {
    limits: { lower: -Math.PI / 2, upper: Math.PI / 2 },
    friction: { coulomb: 0.02, viscous: 0.001 }
  },
  prismatic: {
    limits: { lower: 0, upper: 0.5 },
    friction: { coulomb: 1, viscous: 0.5 }
  }
}

// 새 관절: 축은 Unity ArticulationBody처럼 X, 구동·스프링 없음
export function defaultJoint(type: JointType = 'revolute'): JointSettings {
  const { limits, friction } = DEFAULTS[type]
  return {
    type,
    anchor: [0, 0, 0],
    axis: 'x',
    axisSign: 1,
    limits: limits && { ...limits },
    friction: { ...friction },
    spring: null,
    drive: { kind: 'none' }
  }
}

export function defaultJointDrive(kind: JointDrive['kind']): JointDrive {
  switch (kind) {
    case 'motor':
      return {
        kind,
        motors: [],
        gearRatio: 1,
        spoolDiameter: DEFAULT_SPOOL_DIAMETER,
        rigging: { kind: 'direct' }
      }
    case 'servo':
      return { kind, servo: '', gearRatio: 1 }
    case 'crServo':
      return { kind, servo: '', gearRatio: 1, spoolDiameter: DEFAULT_SPOOL_DIAMETER }
    case 'none':
    case 'stage':
      return { kind }
  }
}

const sameLimits = (a: JointSettings['limits'], b: JointSettings['limits']): boolean =>
  a === b || (a !== null && b !== null && a.lower === b.lower && a.upper === b.upper)

// 종류를 바꿀 때: 한계·마찰이 이전 종류의 기본값 그대로면 새 종류의 기본값으로(고친 값은 그대로, 바퀴 지름과 같은 규칙).
// 직선 관절은 한계가 꼭 있어야 하므로 제한 없는 회전 관절에서 바꾸면 기본 한계를 넣는다. 고친 회전 한계(rad)는 직선
// 한도(m) 안으로 자른다.
export function jointTypePatch(joint: JointSettings, type: JointType): JointSettings {
  if (type === joint.type) return joint
  const before = DEFAULTS[joint.type]
  const after = DEFAULTS[type]
  let limits = sameLimits(joint.limits, before.limits) ? after.limits : joint.limits
  if (type === 'prismatic') {
    limits = limits ?? after.limits
    const clip = (x: number): number =>
      Math.min(MAX_PRISMATIC_LIMIT, Math.max(-MAX_PRISMATIC_LIMIT, x))
    limits = limits && { lower: clip(limits.lower), upper: clip(limits.upper) }
  }
  const friction =
    joint.friction.coulomb === before.friction.coulomb &&
    joint.friction.viscous === before.friction.viscous
      ? after.friction
      : joint.friction
  // 위치 서보는 회전 관절만 구동한다(세계 설명 빌더도 그렇게 본다). 직선으로 바꾸면 구동 종류는 그대로 두고 카드가 알린다.
  return {
    ...joint,
    type,
    limits: limits && { ...limits },
    friction: { ...friction },
    // 스프링 값의 단위(N·m ↔ N, rad ↔ m)가 바뀌므로 뗀다
    spring: null
  }
}

// 관절을 붙일 수 있는 오브젝트: group·assembly·part·CAD 루트(로봇은 움직이지 않는 뿌리), 바퀴가 있는 오브젝트는 아님
export function canHaveJoint(object: SceneObject): boolean {
  return object.kind !== 'robot' && !object.wheel
}
