import { MAX_JOINT_MOTORS, MAX_WORLD_JOINTS } from '../../../shared/sim/worldSpec'
import {
  type JointAxis,
  type JointDrive,
  type JointSettings,
  type JointType,
  type SceneObject,
  type Vec3
} from './model'

// 관절(SceneObject.joint, PROJECT_VERSION 8, Unity ArticulationBody)의 기본값과 범위. 바퀴(scene/wheel.ts)처럼
// 시뮬레이터 전용 설정이라 생성 코드·구성 XML·검증·사용처와 관계없다. 스토어·프로젝트 파일 읽기·Add Component가 같이 쓴다.
// 내부 값은 미터·라디안·N·N·m다(표시 단위 변환은 인스펙터에서만).

export const JOINT_TYPES: readonly JointType[] = ['revolute', 'prismatic']
export const JOINT_AXES: readonly JointAxis[] = ['x', 'y', 'z']
export const JOINT_DRIVE_KINDS: readonly JointDrive['kind'][] = [
  'none',
  'motor',
  'servo',
  'crServo',
  'stage'
]
export const JOINT_RIGGING_KINDS = ['direct', 'cascade', 'continuous'] as const

// 앵커 성분 한도(m, |x| ≤ 10). 세계 설명의 위치 한도(MAX_COORD)와 같다.
export const MAX_JOINT_ANCHOR = 10
// 한계 한도: 회전은 ±4π rad(세계 설명의 각 한도와 같음), 직선은 ±10 m(위치 한도)
export const MAX_REVOLUTE_LIMIT = 4 * Math.PI
export const MAX_PRISMATIC_LIMIT = 10
// 장치 출력축 → 관절 외부 감속비 범위
export const MIN_JOINT_GEAR_RATIO = 0.01
export const MAX_JOINT_GEAR_RATIO = 1000
// 스풀(풀리) 지름 범위(m, 1 mm–0.5 m)
export const MIN_SPOOL_DIAMETER = 0.001
export const MAX_SPOOL_DIAMETER = 0.5
// 다단 슬라이드의 위 단 수(관절 한도에서 아래 단 하나를 뺀 것)
export const MAX_JOINT_STAGES = MAX_WORLD_JOINTS - 1
// 마찰·스프링 한도. 세계 설명 검증(parseWorldSpec)의 한도와 같다(가정: FTC 메커니즘보다 넉넉히 두고 틀린 단위·폭주 값만
// 막는다). 쿨롱 마찰·정전력 스프링 N 또는 N·m, 점성 N·s/m 또는 N·m·s/rad, 강성 N/m 또는 N·m/rad
export const MAX_JOINT_FORCE = 1e4
export const MAX_JOINT_DAMPING = 1e4
export const MAX_JOINT_STIFFNESS = 1e6

// 서보 구동의 편집 자세 서보 위치(0..1) 기본값: SDK 기본 PWM 범위의 가운데(1500 µs). 서보 혼을 가운데에서 끼우는 것이 흔한
// 조립 방법이지만 팀마다 다르므로 관절 카드에서 고친다.
export const DEFAULT_SERVO_EDIT_POSITION = 0.5

// 기본 스풀 지름(m): goBILDA 2단 Viper-Slide 키트의 Hub-Mount Winch Pulley 둘레 112 mm(= 지름 35.65 mm)
// (https://www.gobilda.com/2-stage-viper-slide-kit/ "each rotation of the pulley will cause the slide kit to move
// that amount", spec-3b data §5.1)
export const DEFAULT_SPOOL_DIAMETER = 0.112 / Math.PI

// 종류별 기본 한계·마찰(spec-3b §2).
// - 회전: 한계 ±90°(가정: 편집 자세에서 위아래로 접는 팔), 쿨롱 0.02 N·m·점성 0.001 N·m·s/rad(가정: 베어링 축 하나)
// - 직선: 한계 0–0.5 m(가정: goBILDA 2단 키트 이동 488 mm에 가까운 수), 쿨롱 1 N(가정: 볼 서랍 슬라이드, μ 0.01 × 옆
//   하중 ~100 N 수준, data §5.4), 점성 0.5 N·s/m(가정)
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

// 리밋 스위치가 눌리는 거리 기본값(touch·digital 컴포넌트의 limitDistance·limitAngle이 0일 때): 직선 2 mm, 회전 1°(spec-3b §1-12, 가정)
export const DEFAULT_LIMIT_WITHIN: Record<JointType, number> = {
  prismatic: 0.002,
  revolute: Math.PI / 180
}

// 새 관절. 축은 Unity ArticulationBody처럼 앵커의 X(회전은 X 둘레, 직선은 X 방향), 구동 없음, 스프링 없음.
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

// 새 구동(인스펙터가 구동 종류를 바꿀 때)
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
      return {
        kind,
        servo: '',
        gearRatio: 1,
        editPosition: DEFAULT_SERVO_EDIT_POSITION,
        direction: 1
      }
    case 'crServo':
      return { kind, servo: '', gearRatio: 1, spoolDiameter: DEFAULT_SPOOL_DIAMETER, direction: 1 }
    case 'none':
    case 'stage':
      return { kind }
  }
}

// 종류를 바꿀 때: 한계·마찰이 이전 종류의 기본값 그대로면 새 종류의 기본값으로 바꾼다(고친 값은 그대로, 바퀴 지름과 같은 규칙)
export function jointTypePatch(joint: JointSettings, type: JointType): JointSettings {
  const before = DEFAULTS[joint.type]
  const after = DEFAULTS[type]
  return sanitizeJoint({
    ...joint,
    type,
    limits: sameLimits(joint.limits, before.limits) ? after.limits : joint.limits,
    friction:
      joint.friction.coulomb === before.friction.coulomb &&
      joint.friction.viscous === before.friction.viscous
        ? { ...after.friction }
        : joint.friction
  })
}

export function isJointType(value: unknown): value is JointType {
  return typeof value === 'string' && (JOINT_TYPES as readonly string[]).includes(value)
}

export function isJointAxis(value: unknown): value is JointAxis {
  return typeof value === 'string' && (JOINT_AXES as readonly string[]).includes(value)
}

// 관절을 붙일 수 있는 오브젝트: group·assembly·part·CAD 루트(로봇은 아님, 움직이지 않는 뿌리다). 바퀴가 있는 오브젝트에는
// 두지 않는다(바퀴는 로봇 몸체에 붙은 것으로 계산한다).
export function canHaveJoint(object: SceneObject): boolean {
  return object.kind !== 'robot' && !object.wheel
}

const finiteIn = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max
const nonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0
// 유한한 0 이상이면 한도로 자르고, 아니면 null
const clampedNonNegative = (value: number, max: number): number | null =>
  nonNegative(value) ? Math.min(value, max) : null

function sanitizeAnchor(anchor: Vec3): Vec3 {
  return anchor.length === 3 &&
    anchor.every((x) => finiteIn(x, -MAX_JOINT_ANCHOR, MAX_JOINT_ANCHOR))
    ? [anchor[0], anchor[1], anchor[2]]
    : [0, 0, 0]
}

// 한계: 회전은 null(제한 없음)도 받고, 직선은 늘 있어야 한다. 범위 밖·유한하지 않음·lower > upper면 그 종류의 기본값이다.
// 한계는 편집 자세(q = 0) 기준이라 0을 품어야 한다(시작 자세가 한계 밖이면 첫 틱에 튄다, 세계 설명 검증도 받지 않는다).
// 0을 품지 않으면 가까운 끝을 0으로 넓힌다([0.1, 0.5] → [0, 0.5], −0은 0).
function sanitizeLimits(type: JointType, limits: JointSettings['limits']): JointSettings['limits'] {
  if (limits === null && type === 'revolute') return null
  const max = type === 'revolute' ? MAX_REVOLUTE_LIMIT : MAX_PRISMATIC_LIMIT
  if (
    limits &&
    finiteIn(limits.lower, -max, max) &&
    finiteIn(limits.upper, -max, max) &&
    limits.lower <= limits.upper
  )
    return { lower: Math.min(limits.lower, 0) || 0, upper: Math.max(limits.upper, 0) || 0 }
  const fallback = DEFAULTS[type].limits
  return fallback && { ...fallback }
}

function sanitizeSpring(type: JointType, spring: JointSettings['spring']): JointSettings['spring'] {
  if (!spring) return null
  if (spring.kind === 'constantForce') {
    const force = clampedNonNegative(spring.force, MAX_JOINT_FORCE)
    return force === null ? null : { kind: 'constantForce', force }
  }
  const stiffness = clampedNonNegative(spring.stiffness, MAX_JOINT_STIFFNESS)
  const max = type === 'revolute' ? MAX_REVOLUTE_LIMIT : MAX_PRISMATIC_LIMIT
  return stiffness !== null && finiteIn(spring.rest, -max, max)
    ? { kind: 'linear', stiffness, rest: spring.rest }
    : null
}

const gearRatio = (value: number): number =>
  finiteIn(value, MIN_JOINT_GEAR_RATIO, MAX_JOINT_GEAR_RATIO) ? value : 1
const spoolDiameter = (value: number): number =>
  finiteIn(value, MIN_SPOOL_DIAMETER, MAX_SPOOL_DIAMETER) ? value : DEFAULT_SPOOL_DIAMETER
const servoPosition = (value: number): number =>
  finiteIn(value, 0, 1) ? value : DEFAULT_SERVO_EDIT_POSITION
const direction = (value: number): 1 | -1 => (value === -1 ? -1 : 1)

// 빈 id·겹치는 id를 빼고 앞의 max개만 둔다(지운 장치·관절을 가리키는 id는 남긴다: 세계 설명을 만들 때 경고한다)
function idList(ids: readonly string[], max: number): string[] {
  const result: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || id === '' || result.includes(id)) continue
    if (result.length === max) break
    result.push(id)
  }
  return result
}

function sanitizeDrive(drive: JointDrive): JointDrive {
  switch (drive.kind) {
    case 'motor':
      return {
        kind: 'motor',
        motors: idList(drive.motors, MAX_JOINT_MOTORS),
        gearRatio: gearRatio(drive.gearRatio),
        spoolDiameter: spoolDiameter(drive.spoolDiameter),
        rigging:
          drive.rigging.kind === 'direct'
            ? { kind: 'direct' }
            : { kind: drive.rigging.kind, stages: idList(drive.rigging.stages, MAX_JOINT_STAGES) }
      }
    case 'servo':
      return {
        kind: 'servo',
        servo: drive.servo,
        gearRatio: gearRatio(drive.gearRatio),
        editPosition: servoPosition(drive.editPosition),
        direction: direction(drive.direction)
      }
    case 'crServo':
      return {
        kind: 'crServo',
        servo: drive.servo,
        gearRatio: gearRatio(drive.gearRatio),
        spoolDiameter: spoolDiameter(drive.spoolDiameter),
        direction: direction(drive.direction)
      }
    case 'none':
    case 'stage':
      return { kind: drive.kind }
  }
}

// 범위 밖·유한하지 않은 수는 기본값으로 바꾸고 새 객체를 만든다(스토어와 프로젝트 파일 읽기가 같이 쓴다). 키 순서는 늘 같다
// (저장한 파일이 바이트 단위로 같게 다시 써진다). 장치·관절 id는 남긴다(바퀴의 motor와 같다).
// 마찰은 유한한 0 이상(한도를 넘으면 한도로 자름, 음수·유한하지 않음은 기본값), 스프링은 힘·강성이 0 이상(한도로 자름)이고
// 쉬는 자리가 한도 안이어야 하고 아니면 스프링을 뗀다. 그래서 정리한 설정은 늘 세계 설명 검증의 한도 안이다.
export function sanitizeJoint(joint: JointSettings): JointSettings {
  const fallback = DEFAULTS[joint.type].friction
  const coulomb = clampedNonNegative(joint.friction.coulomb, MAX_JOINT_FORCE)
  const viscous = clampedNonNegative(joint.friction.viscous, MAX_JOINT_DAMPING)
  return {
    type: joint.type,
    anchor: sanitizeAnchor(joint.anchor),
    axis: joint.axis,
    axisSign: joint.axisSign === -1 ? -1 : 1,
    limits: sanitizeLimits(joint.type, joint.limits),
    friction: {
      coulomb: coulomb ?? fallback.coulomb,
      viscous: viscous ?? fallback.viscous
    },
    spring: sanitizeSpring(joint.type, joint.spring),
    drive: sanitizeDrive(joint.drive)
  }
}

function sameLimits(a: JointSettings['limits'], b: JointSettings['limits']): boolean {
  if (!a || !b) return a === b
  return a.lower === b.lower && a.upper === b.upper
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i])

function sameSpring(a: JointSettings['spring'], b: JointSettings['spring']): boolean {
  if (!a || !b) return a === b
  if (a.kind === 'constantForce') return b.kind === 'constantForce' && a.force === b.force
  return b.kind === 'linear' && a.stiffness === b.stiffness && a.rest === b.rest
}

function sameDrive(a: JointDrive, b: JointDrive): boolean {
  switch (a.kind) {
    case 'motor': {
      if (b.kind !== 'motor') return false
      const ar = a.rigging
      const br = b.rigging
      return (
        sameIds(a.motors, b.motors) &&
        a.gearRatio === b.gearRatio &&
        a.spoolDiameter === b.spoolDiameter &&
        ar.kind === br.kind &&
        (ar.kind === 'direct' || sameIds(ar.stages, (br as typeof ar).stages))
      )
    }
    case 'servo':
      return (
        b.kind === 'servo' &&
        a.servo === b.servo &&
        a.gearRatio === b.gearRatio &&
        a.editPosition === b.editPosition &&
        a.direction === b.direction
      )
    case 'crServo':
      return (
        b.kind === 'crServo' &&
        a.servo === b.servo &&
        a.gearRatio === b.gearRatio &&
        a.spoolDiameter === b.spoolDiameter &&
        a.direction === b.direction
      )
    case 'none':
    case 'stage':
      return a.kind === b.kind
  }
}

export function sameJoint(a: JointSettings | undefined, b: JointSettings | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.type === b.type &&
    a.anchor[0] === b.anchor[0] &&
    a.anchor[1] === b.anchor[1] &&
    a.anchor[2] === b.anchor[2] &&
    a.axis === b.axis &&
    a.axisSign === b.axisSign &&
    sameLimits(a.limits, b.limits) &&
    a.friction.coulomb === b.friction.coulomb &&
    a.friction.viscous === b.friction.viscous &&
    sameSpring(a.spring, b.spring) &&
    sameDrive(a.drive, b.drive)
  )
}
