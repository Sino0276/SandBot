import { Matrix4, Vector3 } from 'three'
import {
  resolveMotorParams,
  resolveServoParams,
  type MotorOverrides
} from '../../../shared/sim/actuatorData'
import {
  MAX_WORLD_JOINTS,
  type SimInertia,
  type SimJointDriveSpec,
  type SimJointSpec,
  type SimMotorParams,
  type SimServoParams,
  type Vec3 as SimVec3
} from '../../../shared/sim/worldSpec'
import {
  isMotorModel,
  MAX_GEARBOX,
  MAX_LIMIT_WITHIN,
  MIN_GEARBOX,
  MOTOR_MODEL_TAGS
} from '../hardware/catalog'
import type { ComponentEntry } from '../hardware/components'
import { sidecarDeviceName } from '../hardware/naming'
import type { MassModel, SymMatrix3 } from '../mass/types'
import { canHaveJoint, DEFAULT_LIMIT_WITHIN, sanitizeJoint } from '../scene/joint'
import {
  ancestorIds,
  frameMatrix,
  matrixToTransform,
  subtreeIds,
  worldMatrix,
  type HardwareComponent,
  type JointSettings,
  type SceneObject,
  type SceneObjects
} from '../scene/model'
import type { WorldWarning } from './worldSpec'

// 세계 설명의 관절(spec-3b §4, src/shared/sim/worldSpec.ts의 SimJointSpec)을 씬의 관절 설정(SceneObject.joint)에서 만든다.
// 순수 함수(씬 문서와 질량 모델만으로 정해진다). 관절은 로봇 하위의 문서 순서(깊이 우선이라 부모가 먼저)이고, 관절 틀은
// 편집 자세(q = 0)에서 오브젝트의 자세에 앵커만큼 옮긴 것이다(축은 오브젝트 로컬 축 그대로라 관절 틀의 x·y·z 중 하나).
// 몸체는 관절 오브젝트 하위에서 안쪽 관절의 하위를 뺀 오브젝트들의 질량 모델 자기 몫(MassModel.own)이다.
// 끊긴 참조·쓸 수 없는 설정은 Console 경고(console.notices.world*)로 알리고 그 부분만 빼서 실행은 막지 않는다.

// 몸체 질량이 없을 때(형상 없음·읽는 중·정보 없는 로봇) 쓰는 질량(spec-3b §1-10: 1 g)
export const FALLBACK_BODY_MASS = 0.001
// 몸체 관성의 대각 하한(kg·m²): 1 g 질량을 반지름 1 cm 구로 본 관성(2/5 · 0.001 · 0.01²). 점질량 몸체(형상이 없는 그룹의
// 질량 덮어쓰기)가 관절 축 위에 있어도 질량 행렬이 특이하지 않게 한다(가정, 보통 몸체 관성 1e-4–1e-2보다 훨씬 작다).
export const MIN_BODY_INERTIA = 4e-8
// 관절 하나의 리밋 스위치 수와 구동 전달 비 |ratio| 범위. 세계 설명 검증(parseWorldSpec)의 한도와 같다(가정: 넉넉한 한도라
// 틀린 단위·폭주 값만 막는다). 직선 관절의 ratio는 스풀 반지름 ÷ 외부 감속이라 1 mm 스풀 × 1000:1이면 5e-7로 범위 밖이다.
export const MAX_JOINT_SWITCHES = 8
const MIN_DRIVE_RATIO = 1e-6
const MAX_DRIVE_RATIO = 1e3

export type JointBuildInput = {
  objects: SceneObjects
  robotId: string
  // 로봇의 하드웨어 컴포넌트(카탈로그에 있는 종류만, 하이어라키 순서)
  entries: ComponentEntry[]
  // 세계 설명에 들어간 모터의 컴포넌트 id → 장치 이름(이름이 겹치거나 한도를 넘어 뺀 모터는 없다)
  motorDevices: ReadonlyMap<string, string>
  // 바퀴를 구동하는 모터 컴포넌트 id(관절과 함께 구동할 수 없다)
  wheelMotorIds: ReadonlySet<string>
  // 바퀴 오브젝트(관절 하위면 경고)
  wheelObjects: readonly { objectId: string; name: string }[]
  // 질량 모델. null이면 몸체를 모두 대체 질량으로 두고 질량 경고를 내지 않는다(로봇 카드의 구동계 요약처럼 질량을 계산하지
  // 않는 곳)
  mass: MassModel | null
}

export type JointBuildResult = {
  joints: SimJointSpec[]
  // 관절 순번 → 관절 오브젝트 id(씬 뷰가 실행 중 자세를 그릴 때, 세계 설명에는 씬 id를 넣지 않는다)
  objectIds: string[]
  warnings: WorldWarning[]
}

const AXES: Record<JointSettings['axis'], [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1]
}

// 축 성분 × 부호(0은 −0이 되지 않게)
const signed = (component: number, sign: 1 | -1): number => (component === 0 ? 0 : component * sign)

const vec3 = (v: { x: number; y: number; z: number }): SimVec3 => ({ x: v.x, y: v.y, z: v.z })

// 오브젝트의 로봇 좌표 행렬(편집 자세)
function robotFrame(objects: SceneObjects, id: string): Matrix4 {
  return frameMatrix(objects, id, 'robot').invert().multiply(worldMatrix(objects, id))
}

// 3×3 회전(행 우선, 열 우선 Matrix4에서)
function rotationRows(matrix: Matrix4): number[][] {
  const e = matrix.elements
  return [
    [e[0], e[4], e[8]],
    [e[1], e[5], e[9]],
    [e[2], e[6], e[10]]
  ]
}

// 로봇 좌표 관성 I를 관절 틀 축으로: Rᵀ·I·R(R은 관절 틀 → 로봇 회전)
function inertiaInFrame(r: number[][], s: SymMatrix3): SimInertia {
  const [xx, yy, zz, xy, xz, yz] = s
  const m = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz]
  ]
  // (Rᵀ M R)_ij = Σ_kl R_ki M_kl R_lj
  const out = (i: number, j: number): number => {
    let sum = 0
    for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) sum += r[k][i] * m[k][l] * r[l][j]
    return sum
  }
  return [out(0, 0), out(1, 1), out(2, 2), out(0, 1), out(0, 2), out(1, 2)]
}

// 대각이 하한보다 작은 관성에는 하한만큼의 등방 관성을 더한다(유효한 관성에 구 관성을 더해도 유효하다)
function withInertiaFloor(inertia: SimInertia): SimInertia {
  if (Math.min(inertia[0], inertia[1], inertia[2]) >= MIN_BODY_INERTIA) return inertia
  return [
    inertia[0] + MIN_BODY_INERTIA,
    inertia[1] + MIN_BODY_INERTIA,
    inertia[2] + MIN_BODY_INERTIA,
    inertia[3],
    inertia[4],
    inertia[5]
  ]
}

// 모터 컴포넌트의 기어모터 물리 값(형식·기어박스·덮어쓰기, src/shared/sim/actuatorData.ts)
export function motorComponentParams(props: HardwareComponent['props']): SimMotorParams {
  const model = isMotorModel(props.motorModel) ? props.motorModel : 'unspecified'
  const gearbox = Number(props.gearbox)
  const overrides: MotorOverrides = {
    stallTorque: Number(props.stallTorque) || 0,
    freeSpeedRpm: Number(props.freeSpeed) || 0
  }
  return resolveMotorParams(
    MOTOR_MODEL_TAGS[model],
    Number.isFinite(gearbox) && gearbox >= MIN_GEARBOX && gearbox <= MAX_GEARBOX
      ? gearbox
      : 'default',
    overrides
  )
}

const sameParams = (a: SimMotorParams, b: SimMotorParams): boolean =>
  (Object.keys(a) as (keyof SimMotorParams)[]).every((key) => a[key] === b[key])

// 한 관절을 같이 구동하는 모터들의 기어모터 값(세계 설명과 인스펙터 관절 카드가 같이 쓰는 한 규칙). 세계 설명의 모터 구동은
// 값 하나(SimJointDriveSpec.params)를 모든 장치에 쓰고 시뮬레이터는 장치마다 그 토크를 더하므로, 첫 모터(목록 순서)의 값을
// 쓴다. 형식·감속비·덮어쓰기가 달라 값이 다르면 differ(Console·카드 경고 worldJointMotorsDiffer·motorsDiffer). 모터가
// 없으면 null.
export function jointMotorParams(
  components: readonly Pick<HardwareComponent, 'props'>[]
): { params: SimMotorParams; differ: boolean } | null {
  if (components.length === 0) return null
  const params = motorComponentParams(components[0].props)
  const differ = components
    .slice(1)
    .some((component) => !sameParams(params, motorComponentParams(component.props)))
  return { params, differ }
}

// 서보·CR 서보 컴포넌트의 서보 값(servoModel, src/shared/sim/actuatorData.ts)
export function servoComponentParams(
  props: HardwareComponent['props'],
  kind: 'servo' | 'crServo'
): SimServoParams {
  return resolveServoParams(props.servoModel, kind)
}

// 서보 컴포넌트의 펄스 범위(µs): 구성 XML 태그 Servo·ServoFullRange(configXml.ts deviceTag)의 @ServoType PwmRange와 같다
// (사이드카 SandbotHardware.SERVO_TYPES).
const SERVO_PULSE_RANGES = { standard: [600, 2400], fullRange: [500, 2500] } as const

// 팀 코드가 setPosition(position)을 주었을 때 허브가 내는 펄스(µs). 생성 하드웨어 클래스가 인스펙터 값으로 setDirection·
// scaleRange를 부르고 구성 XML이 펄스 범위를 정하므로, SDK ServoImpl.setPosition과 같은 순서로 거친다: 0..1로 자르고,
// REVERSE면 1 − p, Range.scale(p, 0, 1, scaleMin, scaleMax), 그다음 PwmRange(lo + p·(hi − lo), ServoImplEx). 팀 코드가
// 실행 중 다른 방향·범위를 쓰는 것은 인스펙터 기준이라 따르지 않는다(모터 방향과 같은 규칙). 범위 비율이 맞지 않으면
// (min ≥ max: 하드웨어 검증 오류라 생성이 막힌다) 비율 없이 센다.
export function servoEditPulseUs(position: number, props: HardwareComponent['props']): number {
  let p = Math.min(1, Math.max(0, position))
  if (props.direction === 'reverse') p = 1 - p
  const unit = (value: unknown, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
  }
  const min = unit(props.scaleMin, 0)
  const max = unit(props.scaleMax, 1)
  if (min < max) p = min + p * (max - min)
  const [lo, hi] =
    props.pulseRange === 'fullRange' ? SERVO_PULSE_RANGES.fullRange : SERVO_PULSE_RANGES.standard
  return lo + p * (hi - lo)
}

// 관절 오브젝트로 보는 것: 관절 설정이 있고 관절을 둘 수 있는 오브젝트(로봇·바퀴 오브젝트에 남은 설정은 쓰지 않는다)
export const isJointObject = (object: SceneObject | undefined): boolean =>
  !!object?.joint && canHaveJoint(object)

// 관절 몸체의 오브젝트(문서 순서): 관절 오브젝트 하위에서 안쪽 관절의 하위를 뺀 것(spec-3b §1-10). 세계 설명의 몸체와 같다
// (관절이 MAX_WORLD_JOINTS를 넘어 뺀 관절의 하위만 다르다: 세계 설명은 그것을 가까운 남은 관절의 몸체로 센다).
export function jointBodyIds(objects: SceneObjects, jointId: string): string[] {
  if (!objects[jointId]) return []
  return subtreeIds(objects, jointId).filter(
    (id) =>
      id === jointId ||
      (!isJointObject(objects[id]) &&
        ancestorIds(objects, id).find((a) => isJointObject(objects[a])) === jointId)
  )
}

// 관절 몸체의 질량 합과 아직 읽는 중인 메시 수(질량 모델 자기 몫 MassModel.own의 합, 세계 설명의 몸체 질량과 같은 값)
export function jointBodyMass(
  objects: SceneObjects,
  jointId: string,
  own: MassModel['own']
): { mass: number; pendingMeshes: number } {
  let mass = 0
  let pendingMeshes = 0
  for (const id of jointBodyIds(objects, jointId)) {
    const part = own?.[id]
    if (!part) continue
    mass += part.mass
    pendingMeshes += part.pendingMeshes
  }
  return { mass, pendingMeshes }
}

type Candidate = { objectId: string; name: string; joint: JointSettings }

export function buildWorldJoints(input: JointBuildInput): JointBuildResult {
  const { objects, robotId, entries, motorDevices, wheelMotorIds, mass } = input
  const warnings: WorldWarning[] = []
  const robotTree = subtreeIds(objects, robotId)

  // 관절 오브젝트(문서 순서 = 부모가 먼저). 한도를 넘는 관절은 쓰지 않는다: 깊이 우선 순서의 앞 N개라 남은 관절의 부모
  // 관절은 늘 남는다. 뺀 관절의 하위는 가장 가까운 남은 관절(또는 로봇)의 몸체로 계산한다.
  const candidates: Candidate[] = []
  for (const id of robotTree) {
    const object = objects[id]
    if (id === robotId || !object.joint || !isJointObject(object)) continue
    // 문서의 관절은 스토어·프로젝트 파일이 이미 정리했지만, 세계 설명이 검증을 통과하도록 한 번 더 정리한다(같은 값이면 그대로)
    candidates.push({ objectId: id, name: object.name, joint: sanitizeJoint(object.joint) })
  }
  if (candidates.length > MAX_WORLD_JOINTS)
    warnings.push({ key: 'worldTooManyJoints', params: { max: MAX_WORLD_JOINTS } })
  const kept = candidates.slice(0, MAX_WORLD_JOINTS)
  const indexOf = new Map(kept.map((candidate, i) => [candidate.objectId, i]))

  // 오브젝트마다 몸체(가장 가까운 자신·상위 관절 순번, 로봇 몸체는 −1)
  const bodyOf = new Map<string, number>([[robotId, -1]])
  for (const id of robotTree) {
    if (id === robotId) continue
    const own = indexOf.get(id)
    const parentId = objects[id].parentId
    bodyOf.set(id, own ?? (parentId !== null ? (bodyOf.get(parentId) ?? -1) : -1))
  }
  const parentOf = (i: number): number => {
    const parentId = objects[kept[i].objectId].parentId
    return parentId !== null ? (bodyOf.get(parentId) ?? -1) : -1
  }

  // 관절 틀(로봇 좌표, q = 0): 오브젝트 자세에 앵커만큼 옮긴 것
  const frames = kept.map(({ objectId, joint }) =>
    robotFrame(objects, objectId).multiply(
      new Matrix4().makeTranslation(joint.anchor[0], joint.anchor[1], joint.anchor[2])
    )
  )

  // 몸체의 질량 성질(로봇 좌표에서 합친 뒤 관절 틀로)
  const bodyParts = kept.map(() => [] as string[])
  for (const id of robotTree) {
    const body = bodyOf.get(id) ?? -1
    if (body >= 0) bodyParts[body].push(id)
  }
  const bodies = kept.map((candidate, i): SimJointSpec['body'] => {
    let total = 0
    let pending = 0
    const moment = [0, 0, 0]
    const owns = bodyParts[i].map((id) => mass?.own?.[id]).filter((own) => own !== undefined)
    for (const own of owns) {
      total += own.mass
      pending += own.pendingMeshes
      for (let k = 0; k < 3; k++) moment[k] += own.mass * own.centerOfMass[k]
    }
    if (mass && pending > 0)
      warnings.push({
        key: 'worldJointMassPending',
        params: { name: candidate.name, count: pending }
      })
    if (!(total > 0) || !Number.isFinite(total)) {
      if (mass) warnings.push({ key: 'worldJointNoMass', params: { name: candidate.name } })
      return {
        mass: FALLBACK_BODY_MASS,
        centerOfMass: { x: 0, y: 0, z: 0 },
        inertia: withInertiaFloor([0, 0, 0, 0, 0, 0])
      }
    }
    const com = moment.map((m) => m / total)
    const inertia: SymMatrix3 = [0, 0, 0, 0, 0, 0]
    for (const own of owns) {
      const [dx, dy, dz] = [0, 1, 2].map((k) => own.centerOfMass[k] - com[k])
      const m = own.mass
      inertia[0] += own.inertia[0] + m * (dy * dy + dz * dz)
      inertia[1] += own.inertia[1] + m * (dx * dx + dz * dz)
      inertia[2] += own.inertia[2] + m * (dx * dx + dy * dy)
      inertia[3] += own.inertia[3] - m * dx * dy
      inertia[4] += own.inertia[4] - m * dx * dz
      inertia[5] += own.inertia[5] - m * dy * dz
    }
    const toJoint = frames[i].clone().invert()
    return {
      mass: total,
      centerOfMass: vec3(new Vector3(com[0], com[1], com[2]).applyMatrix4(toJoint)),
      inertia: withInertiaFloor(inertiaInFrame(rotationRows(frames[i]), inertia))
    }
  })

  // 구동. 컴포넌트 id → 같은 로봇의 컴포넌트
  const components = new Map(entries.map((entry) => [entry.component.id, entry.component]))
  // 이미 한 관절이 쓰는 모터(두 관절이 한 모터를 쓰지 않는다)
  const usedMotors = new Set<string>()
  // 이미 쓴 서보·리밋 스위치 장치 이름(세계 설명에서 장치 하나는 한 관절의 서보나 스위치 하나다. 모터 이름과도 겹치지 않는다)
  const motorNames = new Set(motorDevices.values())
  const usedDevices = new Set<string>()
  // 전달 비가 세계 설명 범위 밖이면 구동하지 않는다
  const ratioInRange = (ratio: number): boolean =>
    Number.isFinite(ratio) && ratio >= MIN_DRIVE_RATIO && ratio <= MAX_DRIVE_RATIO
  // 다단 슬라이드 위 단으로 쓰인 관절
  const claimedStages = new Set<number>()
  const drives = kept.map((candidate, i): SimJointDriveSpec => {
    const { joint, name } = candidate
    const drive = joint.drive
    switch (drive.kind) {
      // 위 단('stage')이 어느 다단 슬라이드에 드는지는 아래 단의 rigging이 정한다(아래에서 확인)
      case 'none':
      case 'stage':
        return { kind: drive.kind }
      case 'motor': {
        // 회전: 출력축 rad당 관절 rad, 직선: 출력축 rad당 m(스풀 반지름 ÷ 외부 감속). 부호는 + 그대로다(+power면 관절 +
        // 방향, 방향은 모터의 인스펙터 방향과 관절 축 부호가 정한다). 범위 밖이면 모터를 차지하기 전에 뺀다.
        const ratio =
          joint.type === 'revolute'
            ? 1 / drive.gearRatio
            : drive.spoolDiameter / 2 / drive.gearRatio
        if (!ratioInRange(ratio)) {
          warnings.push({ key: 'worldJointRatioRange', params: { name } })
          return { kind: 'none' }
        }
        const devices: string[] = []
        const driving: HardwareComponent[] = []
        if (drive.motors.length === 0) warnings.push({ key: 'worldJointNoMotor', params: { name } })
        for (const id of drive.motors) {
          const component = components.get(id)
          const device = motorDevices.get(id)
          if (!component || component.type !== 'motor' || !device) {
            warnings.push({ key: 'worldJointMotorMissing', params: { name } })
            continue
          }
          if (wheelMotorIds.has(id)) {
            warnings.push({
              key: 'worldJointMotorOnWheel',
              params: { name, motor: component.name }
            })
            continue
          }
          if (usedMotors.has(id)) {
            warnings.push({ key: 'worldJointMotorShared', params: { name, motor: component.name } })
            continue
          }
          usedMotors.add(id)
          devices.push(device)
          driving.push(component)
        }
        const motorParams = jointMotorParams(driving)
        if (motorParams?.differ) warnings.push({ key: 'worldJointMotorsDiffer', params: { name } })
        if (!motorParams) return { kind: 'none' }
        return {
          kind: 'motor',
          devices,
          ratio,
          params: motorParams.params,
          rigging: rigging(i, candidate)
        }
      }
      case 'servo':
      case 'crServo': {
        const component = components.get(drive.servo)
        const device = component ? sidecarDeviceName(component.name) : ''
        if (!component || component.type !== drive.kind || !device) {
          warnings.push({ key: 'worldJointServoMissing', params: { name } })
          return { kind: 'none' }
        }
        // 위치 서보는 감속 뒤 각을 정하므로 회전 관절만이다(직선 관절은 스풀이 있는 CR 서보로)
        if (drive.kind === 'servo' && joint.type !== 'revolute') {
          warnings.push({ key: 'worldJointServoOnSlide', params: { name } })
          return { kind: 'none' }
        }
        const ratio =
          drive.kind === 'crServo' && joint.type === 'prismatic'
            ? drive.spoolDiameter / 2 / drive.gearRatio
            : 1 / drive.gearRatio
        if (!ratioInRange(ratio)) {
          warnings.push({ key: 'worldJointRatioRange', params: { name } })
          return { kind: 'none' }
        }
        // 한 서보는 관절 하나만 구동한다(서보 하나로 집게 두 손가락을 움직이는 것은 한 관절과 기어로 나타낸다)
        if (usedDevices.has(device) || motorNames.has(device)) {
          warnings.push({ key: 'worldJointServoShared', params: { name, servo: component.name } })
          return { kind: 'none' }
        }
        usedDevices.add(device)
        const params = servoComponentParams(component.props, drive.kind)
        if (drive.kind === 'crServo')
          return { kind: 'crServo', device, ratio, params, direction: drive.direction }
        // 편집 자세의 서보 위치(팀 코드의 setPosition 값)를 그 컴포넌트 설정을 거친 펄스로
        return {
          kind: 'servo',
          device,
          ratio,
          params,
          zeroPulseUs: servoEditPulseUs(drive.editPosition, component.props),
          direction: drive.direction
        }
      }
    }
  })

  // 다단 슬라이드(직선 관절의 모터 구동만): 위 단은 아래에서 위 순서로, 단마다 앞 단(첫 단은 이 관절)을 부모로 둔 직선
  // 관절이고 구동이 'stage'여야 한다. 맞지 않는 단에서 멈추고 그 뒤 단은 쓰지 않는다(경고).
  function rigging(
    bottom: number,
    candidate: Candidate
  ): Extract<SimJointDriveSpec, { kind: 'motor' }>['rigging'] {
    const drive = candidate.joint.drive
    if (
      drive.kind !== 'motor' ||
      candidate.joint.type !== 'prismatic' ||
      drive.rigging.kind === 'direct'
    )
      return { kind: 'direct' }
    const stages: number[] = []
    let below = bottom
    for (const stageId of drive.rigging.stages) {
      const s = indexOf.get(stageId)
      const stage = s === undefined ? null : kept[s]
      if (
        s === undefined ||
        !stage ||
        stage.joint.type !== 'prismatic' ||
        stage.joint.drive.kind !== 'stage' ||
        parentOf(s) !== below ||
        claimedStages.has(s)
      ) {
        warnings.push({
          key: 'worldJointStageInvalid',
          params: { name: candidate.name, stage: objects[stageId]?.name ?? stageId }
        })
        break
      }
      claimedStages.add(s)
      stages.push(s)
      below = s
    }
    return stages.length > 0 ? { kind: drive.rigging.kind, stages } : { kind: 'direct' }
  }

  // 어느 다단 슬라이드에도 들지 않은 위 단은 구동 없음
  drives.forEach((drive, i) => {
    if (drive.kind !== 'stage' || claimedStages.has(i)) return
    warnings.push({ key: 'worldJointStageOrphan', params: { name: kept[i].name } })
    drives[i] = { kind: 'none' }
  })

  // 리밋 스위치(touch·digital 컴포넌트의 limitJoint)
  const switches = kept.map((): SimJointSpec['switches'] => [])
  for (const { component } of entries) {
    if (component.type !== 'touchSensor' && component.type !== 'digitalDevice') continue
    const target = component.props.limitJoint
    if (typeof target !== 'string' || target === '') continue
    const i = indexOf.get(target)
    if (i === undefined) {
      warnings.push({ key: 'worldLimitSwitchJointMissing', params: { name: component.name } })
      continue
    }
    const joint = kept[i].joint
    if (!joint.limits) {
      warnings.push({
        key: 'worldLimitSwitchNoLimit',
        params: { name: component.name, joint: kept[i].name }
      })
      continue
    }
    const device = sidecarDeviceName(component.name)
    if (!device) continue
    // 같은 이름의 장치(이름이 겹쳐 생성이 막힌 구성)는 한 번만 쓴다
    if (usedDevices.has(device) || motorNames.has(device)) {
      warnings.push({ key: 'worldLimitSwitchDuplicate', params: { name: component.name } })
      continue
    }
    if (switches[i].length === MAX_JOINT_SWITCHES) {
      warnings.push({
        key: 'worldLimitSwitchTooMany',
        params: { name: component.name, joint: kept[i].name, max: MAX_JOINT_SWITCHES }
      })
      continue
    }
    usedDevices.add(device)
    // 직선 관절은 limitDistance(m), 회전 관절은 limitAngle(rad)
    const within = Number(
      joint.type === 'prismatic' ? component.props.limitDistance : component.props.limitAngle
    )
    switches[i].push({
      device,
      kind: component.type === 'touchSensor' ? 'touch' : 'digital',
      at: component.props.limitAt === 'upper' ? 'upper' : 'lower',
      within:
        Number.isFinite(within) && within > 0
          ? Math.min(within, MAX_LIMIT_WITHIN)
          : DEFAULT_LIMIT_WITHIN[joint.type]
    })
  }

  // 관절 하위의 센서·바퀴: 3b는 로봇 몸체에 붙은 것으로 계산한다(편집 자세)
  const jointNameOf = (objectId: string): string | null => {
    const body = bodyOf.get(objectId) ?? -1
    return body >= 0 ? kept[body].name : null
  }
  for (const { objectId, component } of entries) {
    const onJoint = (id: string): void => {
      const joint = jointNameOf(id)
      if (joint)
        warnings.push({ key: 'worldSensorOnJoint', params: { name: component.name, joint } })
    }
    if (
      component.type === 'imu' ||
      component.type === 'otos' ||
      component.type === 'deadWheel' ||
      component.type === 'pinpoint'
    )
      onJoint(objectId)
    if (component.type === 'pinpoint')
      for (const pod of [component.props.xPod, component.props.yPod])
        if (typeof pod === 'string' && pod !== objectId && bodyOf.has(pod)) onJoint(pod)
  }
  for (const wheel of input.wheelObjects) {
    const joint = jointNameOf(wheel.objectId)
    if (joint) warnings.push({ key: 'worldWheelOnJoint', params: { name: wheel.name, joint } })
  }

  const joints = kept.map((candidate, i): SimJointSpec => {
    const { joint } = candidate
    const parent = parentOf(i)
    const relative =
      parent >= 0 ? frames[parent].clone().invert().multiply(frames[i]) : frames[i].clone()
    const { position, rotation } = matrixToTransform(relative)
    const [ax, ay, az] = AXES[joint.axis]
    const sign = joint.axisSign
    return {
      parent,
      type: joint.type,
      origin: {
        position: { x: position[0], y: position[1], z: position[2] },
        rotation: { x: rotation[0], y: rotation[1], z: rotation[2] }
      },
      axis: { x: signed(ax, sign), y: signed(ay, sign), z: signed(az, sign) },
      limits: joint.limits && { lower: joint.limits.lower, upper: joint.limits.upper },
      body: bodies[i],
      friction: { coulomb: joint.friction.coulomb, viscous: joint.friction.viscous },
      spring: joint.spring && { ...joint.spring },
      drive: drives[i],
      switches: switches[i]
    }
  })
  return { joints, objectIds: kept.map((candidate) => candidate.objectId), warnings }
}
