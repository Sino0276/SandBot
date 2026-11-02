import { Matrix4, Vector3 } from 'three'
import { symmetricEigen3 } from '../../../shared/sim/drivetrain'
import { ROBOT_SIZE } from '../scene/coordinates'
import {
  childrenInDocument,
  findRobotId,
  isInSubtree,
  subtreeIds,
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
import { DEFAULT_MATERIAL, effectiveDensity, MATERIALS } from './materials'
import { matchNameRule, type NameRule } from './nameRules'
import {
  DEFAULT_INFILL,
  DEFAULT_ROBOT_MASS,
  MASS_CLOSURE_LIMIT,
  type MassLookup,
  type MassModel,
  type MassNotice,
  type MassSource,
  type MassWarning,
  type MaterialKey,
  type MeshMassProps,
  type ObjectMass,
  type PodIgnoredReason,
  type RobotMass,
  type SymMatrix3
} from './types'

// 질량 추정. 순수 함수: 같은 문서와 같은 메시 성질이면 같은 결과다(objects 키 순서로 센다).
//
// 파트(메시 하나) 질량의 출처는 위가 먼저다.
// 1. 덮어쓰기(mass.mass): 그 오브젝트 하위 전체가 한 덩어리다. 하위 형상의 부피 비율로 나누고, 형상이 없으면
//    점질량(원점)이다. 덮어쓰기 안의 덮어쓰기는 안쪽 값을 고정하고 남은 질량을 나머지에 나눈다. 안쪽 합이 바깥 값보다
//    크면 안쪽 값을 그대로 쓰고(바깥 하위 합계가 바깥 값보다 커진다) notices의 innerMassExceeds로 알린다.
// 2. 상용 부품(COTS, cotsTable.ts): 하드웨어 컴포넌트·바퀴·Pinpoint 포드, 없으면 원래 CAD 이름의 SKU. 덮는 범위와
//    나누는 방법은 1과 같고, 덩어리(덮어쓰기·COTS) 안의 COTS는 쓰지 않는다(두 번 세지 않게 위의 것을 쓴다).
//    Pinpoint 포드는 하위 전체를 포드 질량으로 바꾸므로, 포드일 수 없는 오브젝트(Pinpoint 자신과 상위, 다른 COTS를
//    품은 것, 너무 큰 형상)는 포드로 보지 않고 notices의 podIgnored로 알린다(podRejection).
// 3. 재질 × 부피: 위로 가장 가까운 mass.material, 없으면 이름 규칙(nameRules.ts), 없으면 로봇 기본 재질. 이름 규칙은
//    원래 CAD 메시 이름과 상위 CAD 오브젝트 이름(CAD 루트까지)만 본다. 그룹 이름은 팀이 지은 메커니즘 이름(생성 Java
//    클래스)이라 재질을 말하지 않으므로 건너뛴다(IntakeRoller 그룹에 옮긴 파트가 roller → 고무가 되지 않게).
// 무게중심 덮어쓰기(mass.centerOfMass)는 질량을 정한 오브젝트(1·2)에서만 쓰고, 덩어리 전체의 무게중심을 그 점에 둔다
// (관성의 모양은 형상 그대로 옮긴다). 안쪽 덮어쓰기는 옮기지 않으므로, 안쪽이 질량을 다 쓰면 옮길 몫이 없어 쓰지 못한다.
// 이것과, 덩어리를 정하지 않은 오브젝트(덮어쓰기·COTS가 없거나 COTS가 다른 덩어리 안)의 무게중심 덮어쓰기는 notices의
// centerOfMassIgnored로 알린다.
//
// 저울 무게(rigidbody.weighedMass)가 있으면 고정 질량(1·2)을 뺀 나머지로 3의 파트만 같은 비율로 늘이거나 줄인다.
// 위치는 로봇 좌표(로봇 밖은 필드 좌표)이고, 관성은 무게중심 기준 R·I·Rᵀ와 평행축 정리로 합친다(transform에 척도 없음).

// 이 부피(m³, 1 mm³의 1/1000) 아래는 표면으로 본다(부피 0인 판·선 메시의 반올림 오차)
const MIN_SOLID_VOLUME = 1e-12
// 저울 맞추기 비율이 이 범위 밖이면 scaleUnusual. 판단값이다: CAD에 없는 전선·나사·허브는 보통 전체의 5–15 %이고
// 알루미늄 구조재는 부피 × 밀도가 공시 무게와 1.4 % 안에서 맞으므로(goBILDA U-channel), 그보다 큰 차이는
// 재질·채움률·빠진 부품을 확인하라는 뜻이다.
export const SCALE_USUAL_MIN = 0.6
export const SCALE_USUAL_MAX = 1.6
// 정보 없는 로봇의 무게중심 높이(외곽 높이에 대한 비율). 구동계·배터리·허브가 아래에 몰린 FTC 로봇을 가정한 판단값이다.
const DEFAULT_COM_HEIGHT = 0.35
// 포드로 보기에 너무 큰 형상: 하위의 닫힌 부피를 알루미늄 6061로 쳐서 포드 표 질량의 이 배를 넘으면 포드 하나가 아니다.
// 판단값이다: 포드는 알루미늄·플라스틱·강철 부품이고, 가장 가벼운 플라스틱(materials.ts의 ABS 1.04)을 알루미늄(2.70)으로
// 쳐도 2.6배이므로, 엔코더 몸체를 속이 찬 솔리드로 그린 CAD까지 넉넉히 받는다.
const POD_GEOMETRY_FACTOR = 4

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
  // 안쪽 덮어쓰기 합이 이 덩어리 질량보다 컸는지(그 합, 아니면 null)
  exceededBy: number | null
  // 무게중심 덮어쓰기를 옮길 자기 몫이 없어 쓰지 못했는지
  centerOfMassIgnored: boolean
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

type PodRequest = { pinpointId: string; target: string; key: string }

// Pinpoint 포드(Pinpoint 컴포넌트의 xPod·yPod가 가리키는 오브젝트) → 표 키. 같은 포드를 여러 Pinpoint가 가리키면 앞의 것.
// 없는 오브젝트는 건너뛰고(하드웨어 검증이 알린다), 포드일 수 없는 오브젝트는 그 Pinpoint의 로봇에 podIgnored로 알린다.
function pinpointPods(
  objects: SceneObjects,
  lookup: MassLookup,
  caches: NameCaches
): { pods: Map<string, string>; notices: { robotId: string; notice: MassNotice }[] } {
  const requests: PodRequest[] = []
  for (const object of Object.values(objects)) {
    for (const component of object.components ?? []) {
      if (component.type !== 'pinpoint') continue
      for (const prop of ['xPod', 'yPod']) {
        const target = component.props[prop]
        if (typeof target === 'string' && target && objects[target])
          requests.push({
            pinpointId: object.id,
            target,
            key: pinpointPodCotsKey(component.props.podType)
          })
      }
    }
  }
  const targets = new Set(requests.map((request) => request.target))
  const pods = new Map<string, string>()
  const notices: { robotId: string; notice: MassNotice }[] = []
  const reported = new Set<string>()
  for (const request of requests) {
    if (pods.has(request.target)) continue
    const reason = podRejection(objects, lookup, caches, request, targets)
    if (reason === null) {
      pods.set(request.target, request.key)
      continue
    }
    // xPod·yPod가 같은 오브젝트를 가리켜도 한 번만 알린다
    const seen = `${request.pinpointId}\u0000${request.target}`
    const robotId = findRobotId(objects, request.pinpointId)
    if (!robotId || reported.has(seen)) continue
    reported.add(seen)
    notices.push({
      robotId,
      notice: {
        kind: 'podIgnored',
        objectId: request.target,
        pinpointId: request.pinpointId,
        reason
      }
    })
  }
  return { pods, notices }
}

// 포드로 볼 수 없는 이유(볼 수 있으면 null). 포드 질량은 하위 전체를 덮으므로(인스펙터는 로봇 안 아무 오브젝트나 고르게
// 한다) 상위·큰 어셈블리를 고르면 그 형상과 안의 모터·Pinpoint 질량이 포드 질량으로 바뀐다. CAD 루트는 따로 거르지
// 않는다: 로봇 전체 CAD는 Pinpoint를 품거나(containsPinpoint) 너무 커서(tooLarge) 걸리고, 포드만 따로 불러온 작은
// STEP은 포드다.
function podRejection(
  objects: SceneObjects,
  lookup: MassLookup,
  caches: NameCaches,
  request: PodRequest,
  targets: ReadonlySet<string>
): PodIgnoredReason | null {
  const robotId = findRobotId(objects, request.pinpointId)
  if (robotId === null || findRobotId(objects, request.target) !== robotId) return 'otherRobot'
  if (isInSubtree(objects, request.pinpointId, request.target)) return 'containsPinpoint'
  let volume = 0
  for (const id of subtreeIds(objects, request.target)) {
    const object = objects[id]
    // 하위의 이름 SKU(배터리 등)도 COTS다. 대상 자신의 이름 SKU는 포드 키가 먼저라 쓰이지 않는다(cotsKeys).
    const hasCots =
      (object.components ?? []).some((component) => componentCotsKey(component) !== null) ||
      (object.wheel !== undefined && wheelCotsKey(object.wheel) !== null) ||
      (id !== request.target && (targets.has(id) || skuKeyOf(object, lookup, caches) !== null))
    if (hasCots) return 'containsCots'
    if (object.visual?.type === 'mesh') {
      const props = lookup.props(object.visual.geometryId)
      if (props) volume += usableVolume(props)
    }
  }
  const podMass = cotsEntry(request.key)?.mass ?? 0
  return volume * MATERIALS.aluminum6061.density > POD_GEOMETRY_FACTOR * podMass ? 'tooLarge' : null
}

// 포드 대상 하위의 이름 SKU 키(라벨 이름은 빼고, 그룹·로봇은 CAD 이름이 아니라 없음). 메시 파트는 원래 CAD 이름만 본다:
// 불러올 때 붙인 "노드 + 순번" 이름(원래 이름 '')과 아직 읽지 않은 형상의 이름은 위 노드의 SKU를 되풀이하므로
// ("3110-0001-0002 Pod 1") 포드 어셈블리 자신의 솔리드를 다른 COTS로 보지 않게 한다.
function skuKeyOf(object: SceneObject, lookup: MassLookup, caches: NameCaches): string | null {
  if (object.kind === 'robot' || object.kind === 'group') return null
  if (object.visual?.type !== 'mesh') return skuFromNames([object.name], caches)
  const source = lookup.sourceName(object.visual.geometryId)
  return source ? skuFromNames([source], caches) : null
}

function skuFromNames(names: string[], caches: NameCaches): string | null {
  for (const name of names) {
    if (caches.rule([name])?.material === null) continue
    const key = caches.sku(name)
    if (key) return key
  }
  return null
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
  const sku = skuFromNames(names, caches)
  return sku ? [sku] : []
}

// 이름 규칙·SKU 찾기는 같은 이름이 되풀이되므로(goBILDA 예제 STEP의 PRODUCT 이름 374개 중 고유한 것 144개)
// 한 번 계산 안에서 이름마다 한 번만 한다
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
  const caches = nameCaches()
  const { pods, notices: podNotices } = pinpointPods(objects, lookup, caches)
  const parts: Part[] = []
  const partsByObject = new Map<string, Part[]>()
  const blocks: Block[] = []
  // 오브젝트마다 알릴 것의 차례(문서 순서): 덩어리(푼 뒤 innerMassExceeds·centerOfMassIgnored)와, 덩어리를 정하지 않아
  // 무게중심 덮어쓰기를 쓰지 못한 오브젝트
  const noticeOrder: ({ block: Block } | { unusedCenter: string; robotId: string | null })[] = []
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
    resolvedCom: origin,
    exceededBy: null,
    centerOfMassIgnored: false
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
    // 이름 규칙·SKU에 쓰는 이름은 CAD 오브젝트(어셈블리·파트·CAD 루트)의 것뿐이다. 로봇 이름은 파일 이름이고, 그룹
    // 이름은 팀이 지은 메커니즘 이름이다.
    const cadNamed = !isRobot && object.kind !== 'group'
    const names = cadNamed ? ownNames(object, lookup) : []
    const settings = object.mass

    const context: Context = {
      robot: isRobot ? object : (parent?.robot ?? null),
      matrix,
      material: settings?.material
        ? { key: settings.material, ownerId: object.id }
        : (parent?.material ?? null),
      infill: settings?.infill ?? parent?.infill,
      block: parent?.block ?? null,
      // CAD 루트 위의 이름은 보지 않는다(CAD 루트에서 다시 시작한다). 그룹은 건너뛰어 위 CAD 이름을 그대로 넘긴다.
      names: isRobot || object.cad ? [] : (parent?.names ?? [])
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
        noticeOrder.push({ block })
        context.block = block
      } else if (settings?.centerOfMass) {
        // 질량을 정하지 않았거나(덮어쓰기·COTS 없음) COTS가 다른 덩어리 안이라 쓰이지 않아, 무게중심을 옮길 덩어리가 없다
        noticeOrder.push({ unusedCenter: object.id, robotId: context.robot?.id ?? null })
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

    if (cadNamed) context.names = [{ id: object.id, names }, ...context.names]
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
    const notices: MassNotice[] = []
    for (const entry of podNotices) if (entry.robotId === robotId) notices.push(entry.notice)
    for (const entry of noticeOrder) {
      if (!('block' in entry)) {
        if (entry.robotId === robotId)
          notices.push({ kind: 'centerOfMassIgnored', objectId: entry.unusedCenter })
        continue
      }
      const { block } = entry
      if (block.robotId !== robotId) continue
      if (block.exceededBy !== null)
        notices.push({
          kind: 'innerMassExceeds',
          objectId: block.ownerId,
          mass: block.mass,
          inner: block.exceededBy
        })
      if (block.centerOfMassIgnored)
        notices.push({ kind: 'centerOfMassIgnored', objectId: block.ownerId })
    }
    const meshes = pending.get(robotId) ?? 0
    let fixed = 0
    let estimated = 0
    for (const part of list) {
      if (part.estimated) estimated += part.mass
      else fixed += part.mass
    }
    let scale = 1
    const weighed = objects[robotId].rigidbody?.weighedMass
    const total = fixed + estimated
    // 저울 무게가 있는데 추정할 질량이 아직 없으면(형상을 모두 읽는 중이거나 형상이 없음) 고정 질량(덮어쓰기·COTS)은
    // 그대로 두고 나머지(저울 무게 − 고정)를 외곽 상자에 고르게 둔다(질량 모델 §3.3의 대체값). 고정 질량이 이미 저울
    // 무게 이상이면 나머지가 없으므로 scaleImpossible이다. 형상이 있는데 모두 질량 0이면(라벨 규칙 등) 맞출 것이
    // 없다는 뜻이라 이것도 scaleImpossible이다.
    const boxRest =
      weighed !== undefined && estimated === 0 && fixed < weighed && (meshes > 0 || total === 0)
    if (weighed !== undefined && total > 0 && !boxRest) {
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
    if (!boxRest && (total > 0 || (meshes > 0 && weighed === undefined))) {
      // 읽는 중인 메시는 빼고 계산한다(모두 읽는 중이면 0 kg). 기본값으로 바꾸지 않는다: 그러면 CAD를 다 읽을 때
      // 질량이 13.6 kg에서 실제 값으로 뛰고, 읽지 못한 CAD가 기본값으로 굳는다. 저울 무게가 있으면 그 질량은 알므로
      // 아래 상자 대체값을 쓴다(pending 경고도 함께).
      mass = fixed + estimated
      const moment: Vec3 = [0, 0, 0]
      for (const part of list) for (let k = 0; k < 3; k++) moment[k] += part.mass * part.com[k]
      centerOfMass = mass > 0 ? [moment[0] / mass, moment[1] / mass, moment[2] / mass] : [0, 0, 0]
      inertia = [0, 0, 0, 0, 0, 0]
      for (const part of list) {
        if (part.mass === 0) continue
        const own =
          part.volume > 0 ? scaled3(part.unitInertia, part.mass / part.volume) : ZERO_INERTIA
        const d: Vec3 = [0, 1, 2].map((k) => part.com[k] - centerOfMass[k]) as Vec3
        addParallelAxis(inertia, own, part.mass, d)
      }
    } else {
      // 질량 정보 없음(형상이 없거나 모두 질량 0이거나 모두 읽는 중, 덮어쓰기·COTS 없음): 외곽 상자의 균일 직육면체.
      // 저울 무게가 있으면 그 질량을 쓰고(분포는 그래도 기본값이다), 고정 질량이 있으면(boxRest) 그것은 제자리에 두고
      // 나머지만 상자에 둔다. 저울 무게 없이 읽는 중이면 위 갈래(0 kg)다.
      mass = weighed ?? DEFAULT_ROBOT_MASS
      const rest = mass - fixed
      const { min, max } = robotBox(objects, robotId, matrices)
      const [a, b, c] = [0, 1, 2].map((k) => max[k] - min[k])
      const boxCenter: Vec3 = [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        min[2] + DEFAULT_COM_HEIGHT * c
      ]
      const boxInertia: SymMatrix3 = [
        (rest * (b * b + c * c)) / 12,
        (rest * (a * a + c * c)) / 12,
        (rest * (a * a + b * b)) / 12,
        0,
        0,
        0
      ]
      if (fixed > 0) {
        const moment: Vec3 = [0, 1, 2].map((k) => rest * boxCenter[k]) as Vec3
        for (const part of list) for (let k = 0; k < 3; k++) moment[k] += part.mass * part.com[k]
        centerOfMass = [moment[0] / mass, moment[1] / mass, moment[2] / mass]
        inertia = [0, 0, 0, 0, 0, 0]
        const toCenter = (point: Vec3): Vec3 =>
          [0, 1, 2].map((k) => point[k] - centerOfMass[k]) as Vec3
        addParallelAxis(inertia, boxInertia, rest, toCenter(boxCenter))
        for (const part of list) {
          if (part.mass === 0) continue
          const own =
            part.volume > 0 ? scaled3(part.unitInertia, part.mass / part.volume) : ZERO_INERTIA
          addParallelAxis(inertia, own, part.mass, toCenter(part.com))
        }
      } else {
        centerOfMass = boxCenter
        inertia = boxInertia
      }
      estimated = rest
      warnings.push({ kind: 'defaultMass' })
      defaultRobots.set(robotId, { mass, com: centerOfMass })
    }
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
      warnings,
      notices
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
  if (inner > block.mass) block.exceededBy = inner
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
  // 무게중심 덮어쓰기: 안쪽 덩어리는 그대로 두고 자기 몫을 옮겨 덩어리 전체 무게중심을 맞춘다. 안쪽이 질량을 다 쓰면
  // 옮길 몫이 없다(안쪽 값이 먼저라 안쪽을 옮기지 않는다).
  if (block.centerOfMass && rest === 0) block.centerOfMassIgnored = true
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
