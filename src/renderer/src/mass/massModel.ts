import { Matrix4, Vector3 } from 'three'
import { symmetricEigen3 } from '../../../shared/sim/drivetrain'
import { ROBOT_SIZE } from '../scene/coordinates'
import {
  childrenInDocument,
  isInSubtree,
  transformToMatrix,
  type SceneObject,
  type SceneObjects,
  type Vec3
} from '../scene/model'
import {
  componentCotsKey,
  cotsEntry,
  pinpointPodCotsKey,
  skuCotsKey,
  wheelCotsKey
} from './cotsTable'
import { DEFAULT_MATERIAL, effectiveDensity } from './materials'
import { matchNameRule, type NameRule } from './nameRules'
import {
  DEFAULT_INFILL,
  DEFAULT_ROBOT_MASS,
  MASS_CLOSURE_LIMIT,
  type MassLookup,
  type MassModel,
  type MassSource,
  type MassWarning,
  type MaterialKey,
  type MeshMassProps,
  type ObjectMass,
  type RobotMass,
  type SymMatrix3
} from './types'

// 질량 추정(spec-3a §3). 순수 함수: 같은 문서와 같은 메시 성질이면 같은 결과다(objects 키 순서로 센다).
//
// 파트(메시 하나) 질량의 출처는 위가 먼저다.
// 1. 덮어쓰기(mass.mass): 그 오브젝트 하위 전체가 한 덩어리다. 하위 형상의 부피 비율로 나누고, 형상이 없으면
//    점질량(원점)이다. 덮어쓰기 안의 덮어쓰기는 안쪽 값을 고정하고 남은 질량(음수면 0)을 나머지에 나눈다.
// 2. 상용 부품(COTS, cotsTable.ts): 하드웨어 컴포넌트·바퀴·Pinpoint 포드, 없으면 원래 CAD 이름의 SKU. 덮는 범위와
//    나누는 방법은 1과 같고, 덩어리(덮어쓰기·COTS) 안의 COTS는 쓰지 않는다(두 번 세지 않게 위의 것을 쓴다).
// 3. 재질 × 부피: 위로 가장 가까운 mass.material, 없으면 이름 규칙(nameRules.ts), 없으면 로봇 기본 재질.
// 무게중심 덮어쓰기(mass.centerOfMass)는 질량을 정한 오브젝트(1·2)에서만 쓰고, 덩어리 전체의 무게중심을 그 점에 둔다
// (관성의 모양은 형상 그대로 옮긴다).
//
// 저울 무게(rigidbody.weighedMass)가 있으면 고정 질량(1·2)을 뺀 나머지로 3의 파트만 같은 비율로 늘이거나 줄인다.
// 위치는 로봇 좌표(로봇 밖은 필드 좌표)이고, 관성은 무게중심 기준 R·I·Rᵀ와 평행축 정리로 합친다(transform에 척도 없음).

// 이 부피(m³) 아래는 표면으로 본다(spec-3a §1)
const MIN_SOLID_VOLUME = 1e-12
// 저울 맞추기 비율이 이 범위 밖이면 scaleUnusual(spec-3a §3.2: CAD에 없는 전선·나사·허브는 보통 전체의 5–15 %라
// 그보다 큰 차이는 재질·채움률·빠진 부품을 확인하라는 뜻이다)
export const SCALE_USUAL_MIN = 0.6
export const SCALE_USUAL_MAX = 1.6
// 정보 없는 로봇의 무게중심 높이(외곽 높이에 대한 비율, spec-3a §3.3)
const DEFAULT_COM_HEIGHT = 0.35

type Block = {
  ownerId: string
  robotId: string | null
  kind: 'override' | 'cots'
  // 이 덩어리 전체의 질량(kg)
  mass: number
  detail: string
  // 덩어리 전체 무게중심 덮어쓰기(로봇 좌표), 없으면 null
  centerOfMass: Vec3 | null
  // 정한 오브젝트의 원점(로봇 좌표, 형상이 없을 때의 점질량 자리)
  origin: Vec3
  members: Part[]
  children: Block[]
  // 풀고 난 뒤의 질량·무게중심(안쪽 덩어리 포함)
  resolvedMass: number
  resolvedCom: Vec3
}

type Part = {
  objectId: string
  robotId: string | null
  // 쓸 수 있는 부피(m³, 표면이면 0)
  volume: number
  // 로봇 좌표
  com: Vec3
  // 단위 밀도 관성(무게중심 기준, 로봇 좌표, m⁵)
  unitInertia: SymMatrix3
  mass: number
  source: MassSource
  detail: string
  // 출처를 정한 오브젝트(이 파트 자신이면 null)
  inheritedFrom: string | null
  // 추정 파트(저울 맞추기 대상)인지
  estimated: boolean
  scaled: boolean
}

// 추정 파트의 재질(null이면 질량 0인 이름 규칙)과 출처
type Estimate = Pick<Part, 'source' | 'detail' | 'inheritedFrom'> & { material: MaterialKey | null }

type Context = {
  robot: SceneObject | null
  matrix: Matrix4
  material: { key: MaterialKey; ownerId: string } | null
  infill: number | undefined
  block: Block | null
  // 이름 규칙에 쓸 상위 이름(가까운 것부터, CAD 루트까지)
  names: { id: string; names: string[] }[]
}

const ZERO_INERTIA: SymMatrix3 = [0, 0, 0, 0, 0, 0]

// 3×3 회전(행 우선) R·S·Rᵀ
function rotateInertia(r: number[][], s: SymMatrix3): SymMatrix3 {
  const [xx, yy, zz, xy, xz, yz] = s
  const m = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz]
  ]
  const rm = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => r[i][0] * m[0][j] + r[i][1] * m[1][j] + r[i][2] * m[2][j])
  )
  const out = (i: number, j: number): number =>
    rm[i][0] * r[j][0] + rm[i][1] * r[j][1] + rm[i][2] * r[j][2]
  return [out(0, 0), out(1, 1), out(2, 2), out(0, 1), out(0, 2), out(1, 2)]
}

function rotationOf(matrix: Matrix4): number[][] {
  const e = matrix.elements
  // 열 우선 배열
  return [
    [e[0], e[4], e[8]],
    [e[1], e[5], e[9]],
    [e[2], e[6], e[10]]
  ]
}

function applyPoint(matrix: Matrix4, point: Vec3): Vec3 {
  const v = new Vector3(point[0], point[1], point[2]).applyMatrix4(matrix)
  return [v.x, v.y, v.z]
}

const scaled3 = (inertia: SymMatrix3, k: number): SymMatrix3 =>
  inertia.map((value) => value * k) as SymMatrix3

// 평행축 정리: 무게중심 기준 관성 inertia에 점 d(무게중심에서 본 위치)의 질량 m을 더한다
function addParallelAxis(target: SymMatrix3, inertia: SymMatrix3, m: number, d: Vec3): void {
  const [dx, dy, dz] = d
  target[0] += inertia[0] + m * (dy * dy + dz * dz)
  target[1] += inertia[1] + m * (dx * dx + dz * dz)
  target[2] += inertia[2] + m * (dx * dx + dy * dy)
  target[3] += inertia[3] - m * dx * dy
  target[4] += inertia[4] - m * dx * dz
  target[5] += inertia[5] - m * dy * dz
}

// 쓸 수 있는 부피: 닫힌(closure ≤ MASS_CLOSURE_LIMIT) 솔리드만. 그 밖은 표면이라 질량 0이다.
function usableVolume(props: MeshMassProps): number {
  return props.closure <= MASS_CLOSURE_LIMIT && props.volume >= MIN_SOLID_VOLUME ? props.volume : 0
}

// 이 오브젝트의 이름 묶음(원래 CAD 메시 이름이 있으면 그것을 먼저, 지금 이름)
function ownNames(object: SceneObject, lookup: MassLookup): string[] {
  const source =
    object.visual?.type === 'mesh' ? lookup.sourceName(object.visual.geometryId) : undefined
  return source && source !== object.name ? [source, object.name] : [object.name]
}

// Pinpoint 포드(Pinpoint 컴포넌트의 xPod·yPod가 가리키는 오브젝트) → 표 키. 같은 포드를 여러 Pinpoint가 가리키면 앞의 것.
function pinpointPods(objects: SceneObjects): Map<string, string> {
  const pods = new Map<string, string>()
  for (const object of Object.values(objects)) {
    for (const component of object.components ?? []) {
      if (component.type !== 'pinpoint') continue
      for (const key of ['xPod', 'yPod']) {
        const target = component.props[key]
        if (typeof target === 'string' && target && !pods.has(target))
          pods.set(target, pinpointPodCotsKey(component.props.podType))
      }
    }
  }
  return pods
}

// 오브젝트에 맞는 COTS 표 키들(컴포넌트·포드·바퀴는 모두 더하고, 없을 때만 이름의 SKU). 라벨 이름의 SKU는 쓰지 않는다
// (모터 STEP 안의 "5203-2402-0019 Label" 같은 장식 솔리드가 모터 질량을 받지 않게).
function cotsKeys(
  object: SceneObject,
  names: string[],
  pods: Map<string, string>,
  caches: NameCaches
): string[] {
  const keys: string[] = []
  for (const component of object.components ?? []) {
    const key = componentCotsKey(component)
    if (key) keys.push(key)
  }
  const pod = pods.get(object.id)
  if (pod) keys.push(pod)
  const wheel = object.wheel ? wheelCotsKey(object.wheel) : null
  if (wheel) keys.push(wheel)
  if (keys.length > 0) return keys
  for (const name of names) {
    if (caches.rule([name])?.material === null) continue
    const key = caches.sku(name)
    if (key) return [key]
  }
  return []
}

// 이름 규칙·SKU 찾기는 같은 이름이 되풀이되므로(goBILDA 키트의 PRODUCT 이름 374개 중 고유한 것 144개,
// research/materials.md §4.1) 한 번 계산 안에서 이름마다 한 번만 한다
type NameCaches = {
  rule: (names: readonly string[]) => NameRule | null
  sku: (name: string) => string | null
}

function nameCaches(): NameCaches {
  const rules = new Map<string, NameRule | null>()
  const skus = new Map<string, string | null>()
  return {
    rule: (names) => {
      const key = names.join('\u0000')
      let result = rules.get(key)
      if (result === undefined) {
        result = matchNameRule(names)
        rules.set(key, result)
      }
      return result
    },
    sku: (name) => {
      let result = skus.get(name)
      if (result === undefined) {
        result = skuCotsKey(name)
        skus.set(name, result)
      }
      return result
    }
  }
}

// 빈 질량 결과(오브젝트 원점)
const emptyObjectMass = (origin: Vec3): ObjectMass => ({
  mass: 0,
  centerOfMass: origin,
  source: 'none',
  detail: '',
  inheritedFrom: null,
  scaled: false
})

// 정보 없는 로봇의 외곽 상자(로봇 좌표): CAD 루트들의 cad.bounds 8꼭짓점, CAD가 없으면 18 in 정육면체(임시 씬의 상자)
function robotBox(
  objects: SceneObjects,
  robotId: string,
  matrices: Map<string, Matrix4>
): {
  min: Vec3
  max: Vec3
} {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const visit = (id: string): void => {
    const object = objects[id]
    const matrix = matrices.get(id)
    if (object.cad && matrix) {
      const { min: low, max: high } = object.cad.bounds
      const center = [0, 1, 2].map((i) => (low[i] + high[i]) / 2)
      for (const x of [low[0], high[0]])
        for (const y of [low[1], high[1]])
          for (const z of [low[2], high[2]]) {
            const corner = applyPoint(matrix, [x - center[0], y - center[1], z - center[2]])
            for (let i = 0; i < 3; i++) {
              min[i] = Math.min(min[i], corner[i])
              max[i] = Math.max(max[i], corner[i])
            }
          }
    }
    for (const child of childrenInDocument(objects, id)) visit(child.id)
  }
  visit(robotId)
  if (!(min[0] < max[0] && min[1] < max[1] && min[2] < max[2]))
    return {
      min: [-ROBOT_SIZE / 2, -ROBOT_SIZE / 2, 0],
      max: [ROBOT_SIZE / 2, ROBOT_SIZE / 2, ROBOT_SIZE]
    }
  return { min, max }
}

function principalMoments(inertia: SymMatrix3): Vec3 {
  const [xx, yy, zz, xy, xz, yz] = inertia
  const { values } = symmetricEigen3([
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz]
  ])
  const sorted = [...values].sort((a, b) => a - b)
  return [sorted[0], sorted[1], sorted[2]]
}

export function computeMassModel(objects: SceneObjects, lookup: MassLookup): MassModel {
  const pods = pinpointPods(objects)
  const caches = nameCaches()
  const parts: Part[] = []
  const partsByObject = new Map<string, Part[]>()
  const blocks: Block[] = []
  const matrices = new Map<string, Matrix4>()
  const pending = new Map<string, number>()

  const addPart = (part: Part): void => {
    parts.push(part)
    const list = partsByObject.get(part.objectId)
    if (list) list.push(part)
    else partsByObject.set(part.objectId, [part])
  }

  const newBlock = (
    ownerId: string,
    context: Context,
    kind: Block['kind'],
    mass: number,
    detail: string,
    centerOfMass: Vec3 | null,
    origin: Vec3
  ): Block => ({
    ownerId,
    robotId: context.robot?.id ?? null,
    kind,
    mass,
    detail,
    centerOfMass,
    origin,
    members: [],
    children: [],
    resolvedMass: 0,
    resolvedCom: origin
  })

  // 추정 파트의 재질·출처
  const estimate = (object: SceneObject, context: Context, names: string[]): Estimate => {
    if (context.material) {
      const { key, ownerId } = context.material
      return {
        material: key,
        source: 'material',
        detail: key,
        inheritedFrom: ownerId === object.id ? null : ownerId
      }
    }
    const levels = [{ id: object.id, names }, ...context.names]
    for (const level of levels) {
      const matched = caches.rule(level.names)
      if (matched)
        return {
          material: matched.material,
          source: 'nameRule',
          detail: matched.name,
          inheritedFrom: level.id === object.id ? null : level.id
        }
    }
    const key = context.robot?.rigidbody?.defaultMaterial ?? DEFAULT_MATERIAL
    return {
      material: key,
      source: 'default',
      detail: key,
      inheritedFrom: context.robot?.id ?? null
    }
  }

  const visit = (object: SceneObject, parent: Context | null): void => {
    const isRobot = object.kind === 'robot'
    const local = transformToMatrix(object.transform)
    // 로봇은 자기 좌표가 기준이라 단위 행렬, 로봇 밖 최상위는 필드 좌표
    const matrix = isRobot ? new Matrix4() : parent ? parent.matrix.clone().multiply(local) : local
    matrices.set(object.id, matrix)
    const names = isRobot ? [] : ownNames(object, lookup)
    const settings = object.mass

    const context: Context = {
      robot: isRobot ? object : (parent?.robot ?? null),
      matrix,
      material: settings?.material
        ? { key: settings.material, ownerId: object.id }
        : (parent?.material ?? null),
      infill: settings?.infill ?? parent?.infill,
      block: parent?.block ?? null,
      // CAD 루트 위(로봇)의 이름은 보지 않는다. 로봇 이름은 파일 이름이라 재질을 말하지 않는다.
      names: isRobot ? [] : object.cad ? [] : (parent?.names ?? [])
    }

    // 질량을 정하는 덩어리
    if (!isRobot) {
      const origin = applyPoint(matrix, [0, 0, 0])
      const centerOfMass = settings?.centerOfMass ? applyPoint(matrix, settings.centerOfMass) : null
      let block: Block | null = null
      if (settings?.mass !== undefined) {
        block = newBlock(object.id, context, 'override', settings.mass, '', centerOfMass, origin)
      } else if (context.block === null) {
        const keys = cotsKeys(object, names, pods, caches)
        if (keys.length > 0) {
          const mass = keys.reduce((sum, key) => sum + (cotsEntry(key)?.mass ?? 0), 0)
          block = newBlock(object.id, context, 'cots', mass, keys.join('+'), centerOfMass, origin)
        }
      }
      if (block) {
        context.block?.children.push(block)
        blocks.push(block)
        context.block = block
      }
    }

    if (object.visual?.type === 'mesh') {
      const props = lookup.props(object.visual.geometryId)
      if (!props) {
        const robotId = context.robot?.id
        if (robotId) pending.set(robotId, (pending.get(robotId) ?? 0) + 1)
      } else {
        const volume = usableVolume(props)
        const part: Part = {
          objectId: object.id,
          robotId: context.robot?.id ?? null,
          volume,
          com: applyPoint(matrix, props.centroid),
          unitInertia: volume > 0 ? rotateInertia(rotationOf(matrix), props.inertia) : ZERO_INERTIA,
          mass: 0,
          source: 'none',
          detail: '',
          inheritedFrom: null,
          estimated: false,
          scaled: false
        }
        if (context.block) {
          context.block.members.push(part)
        } else if (volume > 0) {
          const { material, ...source } = estimate(object, context, names)
          Object.assign(part, source)
          part.estimated = true
          part.mass =
            material === null
              ? 0
              : effectiveDensity(material, volume, props.area, context.infill ?? DEFAULT_INFILL) *
                volume
        }
        addPart(part)
      }
    }

    if (!isRobot) context.names = [{ id: object.id, names }, ...context.names]
    for (const child of childrenInDocument(objects, object.id)) visit(child, context)
  }

  for (const root of childrenInDocument(objects, null)) visit(root, null)

  // 덩어리 풀기: 안쪽 덩어리가 먼저(만든 순서의 반대가 곧 안쪽부터다)
  for (let i = blocks.length - 1; i >= 0; i--) resolveBlock(blocks[i], parts, partsByObject)

  // 저울 맞추기와 로봇 합계
  const robots: Record<string, RobotMass> = {}
  const robotIds = Object.keys(objects).filter(
    (id) => objects[id].kind === 'robot' && matrices.has(id)
  )
  const robotParts = new Map<string, Part[]>(robotIds.map((id) => [id, []]))
  for (const part of parts) if (part.robotId) robotParts.get(part.robotId)?.push(part)
  const defaultRobots = new Map<string, { mass: number; com: Vec3 }>()

  for (const robotId of robotIds) {
    const list = robotParts.get(robotId) ?? []
    const warnings: MassWarning[] = []
    let fixed = 0
    let estimated = 0
    for (const part of list) {
      if (part.estimated) estimated += part.mass
      else fixed += part.mass
    }
    let scale = 1
    const weighed = objects[robotId].rigidbody?.weighedMass
    const total = fixed + estimated
    if (weighed !== undefined && total > 0) {
      if (fixed >= weighed || estimated === 0) {
        warnings.push({ kind: 'scaleImpossible', fixed, weighed })
      } else {
        scale = (weighed - fixed) / estimated
        if (scale < SCALE_USUAL_MIN || scale > SCALE_USUAL_MAX)
          warnings.push({ kind: 'scaleUnusual', scale })
        for (const part of list) {
          if (!part.estimated || part.mass === 0) continue
          part.mass *= scale
          part.scaled = true
        }
        estimated *= scale
      }
    }

    let mass: number
    let centerOfMass: Vec3
    let inertia: SymMatrix3
    if (total > 0) {
      mass = fixed + estimated
      const moment: Vec3 = [0, 0, 0]
      for (const part of list) for (let k = 0; k < 3; k++) moment[k] += part.mass * part.com[k]
      centerOfMass = [moment[0] / mass, moment[1] / mass, moment[2] / mass]
      inertia = [0, 0, 0, 0, 0, 0]
      for (const part of list) {
        if (part.mass === 0) continue
        const own =
          part.volume > 0 ? scaled3(part.unitInertia, part.mass / part.volume) : ZERO_INERTIA
        const d: Vec3 = [0, 1, 2].map((k) => part.com[k] - centerOfMass[k]) as Vec3
        addParallelAxis(inertia, own, part.mass, d)
      }
    } else {
      // 질량 정보 없음: 외곽 상자의 균일 직육면체. 저울 무게가 있으면 그 질량을 쓴다(분포는 그래도 기본값이다).
      mass = weighed ?? DEFAULT_ROBOT_MASS
      const { min, max } = robotBox(objects, robotId, matrices)
      const [a, b, c] = [0, 1, 2].map((k) => max[k] - min[k])
      centerOfMass = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2] + DEFAULT_COM_HEIGHT * c]
      inertia = [
        (mass * (b * b + c * c)) / 12,
        (mass * (a * a + c * c)) / 12,
        (mass * (a * a + b * b)) / 12,
        0,
        0,
        0
      ]
      fixed = 0
      estimated = mass
      warnings.push({ kind: 'defaultMass' })
      defaultRobots.set(robotId, { mass, com: centerOfMass })
    }
    const meshes = pending.get(robotId) ?? 0
    if (meshes > 0) warnings.push({ kind: 'pending', meshes })
    robots[robotId] = {
      robotId,
      mass,
      centerOfMass,
      inertia,
      principalMoments: principalMoments(inertia),
      fixedMass: fixed,
      estimatedMass: estimated,
      scale,
      warnings
    }
  }

  return {
    objects: objectMasses(objects, matrices, partsByObject, defaultRobots),
    robots
  }
}

// 덩어리 하나를 푼다(안쪽 덩어리는 이미 풀렸다). 남은 질량을 자기 형상에 부피 비율로 나누고, 형상이 없으면 점질량을 둔다.
function resolveBlock(block: Block, parts: Part[], partsByObject: Map<string, Part[]>): void {
  let inner = 0
  const innerMoment: Vec3 = [0, 0, 0]
  for (const child of block.children) {
    inner += child.resolvedMass
    for (let k = 0; k < 3; k++) innerMoment[k] += child.resolvedMass * child.resolvedCom[k]
  }
  const rest = Math.max(0, block.mass - inner)
  const total = inner + rest
  const volume = block.members.reduce((sum, part) => sum + part.volume, 0)
  const own: Part[] = block.members.slice()
  if (rest > 0 && volume === 0) {
    const point: Part = {
      objectId: block.ownerId,
      robotId: block.robotId,
      volume: 0,
      com: block.origin,
      unitInertia: ZERO_INERTIA,
      mass: rest,
      source: block.kind,
      detail: block.detail,
      inheritedFrom: null,
      estimated: false,
      scaled: false
    }
    // 점질량은 정한 오브젝트의 파트로 센다
    own.push(point)
    parts.push(point)
    const list = partsByObject.get(block.ownerId)
    if (list) list.push(point)
    else partsByObject.set(block.ownerId, [point])
  }
  for (const part of block.members) {
    part.mass = rest > 0 && volume > 0 ? (rest * part.volume) / volume : 0
    part.source = block.kind
    part.detail = block.detail
    part.inheritedFrom = part.objectId === block.ownerId ? null : block.ownerId
  }
  const restMoment: Vec3 = [0, 0, 0]
  for (const part of own) for (let k = 0; k < 3; k++) restMoment[k] += part.mass * part.com[k]
  // 무게중심 덮어쓰기: 안쪽 덩어리는 그대로 두고 자기 몫을 옮겨 덩어리 전체 무게중심을 맞춘다
  if (block.centerOfMass && rest > 0) {
    const target = block.centerOfMass
    const delta = [0, 1, 2].map((k) => (total * target[k] - innerMoment[k] - restMoment[k]) / rest)
    for (const part of own) part.com = [0, 1, 2].map((k) => part.com[k] + delta[k]) as Vec3
    for (let k = 0; k < 3; k++) restMoment[k] += rest * delta[k]
  }
  block.resolvedMass = total
  block.resolvedCom =
    total > 0
      ? ([0, 1, 2].map((k) => (innerMoment[k] + restMoment[k]) / total) as Vec3)
      : block.origin
}

// 오브젝트마다 하위 전체의 질량·무게중심·출처(objects 키 순서로 낸다)
function objectMasses(
  objects: SceneObjects,
  matrices: Map<string, Matrix4>,
  partsByObject: Map<string, Part[]>,
  defaultRobots: Map<string, { mass: number; com: Vec3 }>
): Record<string, ObjectMass> {
  type Group = { source: MassSource; detail: string; inheritedFrom: string | null; mass: number }
  type Aggregate = { mass: number; moment: Vec3; groups: Map<string, Group>; scaled: boolean }
  const results = new Map<string, ObjectMass>()

  const addGroup = (groups: Map<string, Group>, group: Group): void => {
    const key = `${group.source}\u0000${group.detail}`
    const existing = groups.get(key)
    if (existing) existing.mass += group.mass
    else groups.set(key, { ...group })
  }

  const visit = (object: SceneObject): Aggregate => {
    const aggregate: Aggregate = { mass: 0, moment: [0, 0, 0], groups: new Map(), scaled: false }
    for (const part of partsByObject.get(object.id) ?? []) {
      aggregate.mass += part.mass
      for (let k = 0; k < 3; k++) aggregate.moment[k] += part.mass * part.com[k]
      aggregate.scaled ||= part.scaled
      addGroup(aggregate.groups, {
        source: part.source,
        detail: part.detail,
        inheritedFrom: part.inheritedFrom,
        mass: part.mass
      })
    }
    for (const child of childrenInDocument(objects, object.id)) {
      const sub = visit(child)
      aggregate.mass += sub.mass
      for (let k = 0; k < 3; k++) aggregate.moment[k] += sub.moment[k]
      aggregate.scaled ||= sub.scaled
      for (const group of sub.groups.values()) addGroup(aggregate.groups, group)
    }

    const fallback = defaultRobots.get(object.id)
    const origin = applyPoint(matrices.get(object.id) ?? new Matrix4(), [0, 0, 0])
    if (fallback) {
      results.set(object.id, {
        mass: fallback.mass,
        centerOfMass: fallback.com,
        source: 'default',
        detail: '',
        inheritedFrom: null,
        scaled: false
      })
      return aggregate
    }
    // 가장 큰 질량의 출처(같으면 먼저 나온 것). 질량이 0이면 처음 나온 출처(라벨 규칙처럼 0을 정한 것)
    let dominant: Group | null = null
    for (const group of aggregate.groups.values()) {
      if (!dominant || group.mass > dominant.mass) dominant = group
    }
    const result = emptyObjectMass(origin)
    if (aggregate.mass > 0) {
      const m = aggregate.mass
      result.mass = m
      result.centerOfMass = [
        aggregate.moment[0] / m,
        aggregate.moment[1] / m,
        aggregate.moment[2] / m
      ]
    }
    if (dominant) {
      result.source = dominant.source
      result.detail = dominant.detail
      // 이 오브젝트나 그 하위가 정한 출처는 상속이 아니다
      const from = dominant.inheritedFrom
      result.inheritedFrom = from !== null && !isInSubtree(objects, from, object.id) ? from : null
    }
    result.scaled = aggregate.scaled
    results.set(object.id, result)
    return aggregate
  }

  for (const root of childrenInDocument(objects, null)) visit(root)
  const ordered: Record<string, ObjectMass> = {}
  for (const id of Object.keys(objects)) {
    const result = results.get(id)
    if (result) ordered[id] = result
  }
  return ordered
}
