import { Matrix4, Vector3 } from 'three'
import { symmetricEigen3 } from '../../../shared/sim/drivetrain'
import { ROBOT_SIZE } from '../scene/coordinates'
import {
  ancestorIds,
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
import { matchAncestorRule, matchNameRule, type NameRule } from './nameRules'
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
  type CotsIgnoredReason,
  type RobotMass,
  type SourceNode,
  type SymMatrix3
} from './types'

// 질량 추정. 순수 함수: 같은 문서와 같은 메시 성질이면 같은 결과다(objects 키 순서로 센다).
//
// 파트(메시 하나) 질량의 출처는 위가 먼저다.
// 1. 덮어쓰기(mass.mass): 그 오브젝트 하위 전체가 한 덩어리다. 하위 형상의 부피 비율로 나누고, 형상이 없으면
//    점질량(원점)이다. 덮어쓰기 안의 덮어쓰기는 안쪽 값을 고정하고 남은 질량을 나머지에 나눈다. 안쪽 합이 바깥 값보다
//    크면 안쪽 값을 그대로 쓰고(바깥 하위 합계가 바깥 값보다 커진다) notices의 innerMassExceeds로 알린다.
// 2. 상용 부품(COTS, cotsTable.ts): 하드웨어 컴포넌트·바퀴·Pinpoint 포드는 붙은 오브젝트(지금 계층) 하위 전체를 덮고,
//    나누는 방법은 1과 같다. 덩어리(덮어쓰기·COTS) 안의 COTS는 쓰지 않는다(두 번 세지 않게 위의 것을 쓴다).
//    하위 전체를 데이터시트 질량으로 바꾸므로, 그 하위를 그 부품 하나로 볼 수 없으면(다른 COTS나 CAD 루트를 품음, 형상이
//    너무 큼, 포드면 Pinpoint 자신·상위이거나 다른 로봇) 쓰지 않고 notices의 cotsIgnored로 알린다(cotsRejection).
//    로봇 전체 CAD 루트나 서브시스템 어셈블리에 붙인 Pinpoint·서보 컴포넌트가 그 하위 질량을 지우지 않게 한다.
//    SKU 제품: 그 밖의 메시는 원래 이름 경로(MassLookup.sourcePath, 불러올 때의 CAD 노드)에서 가장 바깥의 SKU 노드가
//    제품이다. 제품의 데이터시트 질량은 그 노드를 경로에 가진 메시에 부피 비율로 나눈다(지금 계층의 어디로 옮겼든,
//    노드 이름을 바꿨든). 제품의 메시 일부가 1·2의 덩어리 안에 있으면, 같은 부품의 컴포넌트 COTS(sameCotsItem) 덩어리면
//    나머지 메시도 그 덩어리에 넣고, 아니면 덩어리 안 몫(부피 비율)을 제품 질량에서 뺀다(두 번 세지 않게).
// 3. 재질 × 부피: 위로 가장 가까운 mass.material(지금 계층), 없으면 이름 규칙(nameRules.ts), 없으면 로봇 기본 재질.
//    이름 규칙은 메시의 원래 이름 경로만 본다(파트 노드부터 CAD 루트 쪽으로 가장 가까운 규칙, 상위 노드는 재질 낱말과
//    SKU 시리즈만이고 부품 종류 낱말은 파트 노드 자신의 이름에서만 쓴다). 지금 오브젝트 이름과
//    그룹(팀이 지은 메커니즘 이름, 생성 Java 클래스)은 보지 않는다(이름을 바꾸거나 IntakeRoller 그룹으로 옮긴 파트의
//    재질이 바뀌지 않게). 붙인 "노드 + 순번" 이름은 CAD 이름이 아니라 건너뛴다.
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
// COTS 하나로 보기에 너무 큰 형상: 하위의 닫힌 부피를 알루미늄 6061로 쳐서 표 질량(키마다 그 종류의 배수를 곱한 합)을
// 넘으면 그 부품 하나가 아니다(cotsSizeFactor). 판단값이다. 실제 상용 부품 CAD(scratchpad CAD 실측: goBILDA 5204 모터
// 0.4, REV Core Hex 0.49, Limelight 3A 0.52, Pinpoint 0.78, REV Smart Robot Servo 1.12, 4-Bar 포드 1.10, Swingarm 포드
// 1.04, Axon MAX 1.02, 메카넘 96 mm 1.17)는 부피 × 2.70 / 표 질량이 1.2 이하이므로 모터·서보·Pinpoint·포드·Limelight는
// 1.6배까지 받는다. 몸체를 속이 찬 솔리드로 그린 서보(1.4쯤)는 받고, 서브시스템 어셈블리(인테이크의 옆판·롤러, 집게의
// 판)에 붙인 컴포넌트는 걸린다. 바퀴는 팀 CAD가 속이 찬 원기둥으로 그리기도 해서(GripForce 104 × 38 mm 원기둥 3.7배)
// 4배까지다.
const COTS_SIZE_FACTOR = 1.6
const WHEEL_SIZE_FACTOR = 4

const cotsSizeFactor = (key: string): number =>
  key.startsWith('wheel:') ? WHEEL_SIZE_FACTOR : COTS_SIZE_FACTOR

type Block = {
  ownerId: string
  robotId: string | null
  kind: 'override' | 'cots'
  // 이 덩어리 전체의 질량(kg)
  mass: number
  detail: string
  // COTS 표 키(덮어쓰기는 빈 목록)
  keys: string[]
  // 이 덩어리를 품은 덩어리(지금 계층), 없으면 null
  parent: Block | null
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
  // 이 파트를 품은 가장 안쪽 덩어리(지금 계층), 없으면 null
  block: Block | null
}

// 추정 파트의 재질(null이면 질량 0인 이름 규칙)과 출처
type Estimate = Pick<Part, 'source' | 'detail' | 'inheritedFrom'> & { material: MaterialKey | null }

type Context = {
  robot: SceneObject | null
  matrix: Matrix4
  material: { key: MaterialKey; ownerId: string } | null
  infill: number | undefined
  block: Block | null
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

// 원래 이름 경로의 SKU 제품: 메시마다 경로에서 가장 바깥의 SKU 노드(라벨 이름·붙인 이름 제외)가 그 메시의 제품이다.
type Product = {
  nodeKey: string
  // COTS 표 키
  cotsKey: string
  // 이 제품의 메시 오브젝트(문서 순서)
  meshIds: string[]
}

// 메시마다 원래 이름 경로와 제품, 노드마다 그 노드를 경로에 가진 메시(문서 순서)
type SourceIndex = {
  paths: Map<string, readonly SourceNode[]>
  productOf: Map<string, Product>
  products: Product[]
  nodeMeshes: Map<string, string[]>
}

function sourceIndex(objects: SceneObjects, lookup: MassLookup, caches: NameCaches): SourceIndex {
  const index: SourceIndex = {
    paths: new Map(),
    productOf: new Map(),
    products: [],
    nodeMeshes: new Map()
  }
  const byNode = new Map<string, Product>()
  for (const object of Object.values(objects)) {
    if (object.visual?.type !== 'mesh' || object.kind === 'robot' || object.kind === 'group')
      continue
    const path = lookup.sourcePath(object.visual.geometryId)
    if (!path) continue
    index.paths.set(object.id, path)
    let product: Product | null = null
    for (const node of path) {
      const meshes = index.nodeMeshes.get(node.key)
      if (meshes) meshes.push(object.id)
      else index.nodeMeshes.set(node.key, [object.id])
      if (product || node.generated) continue
      // 라벨 이름의 SKU는 쓰지 않는다(모터 STEP 안의 "5203-2402-0019 Label" 같은 장식 솔리드가 모터 질량을 받지 않게)
      if (caches.rule(node.name)?.material === null) continue
      const cotsKey = caches.sku(node.name)
      if (!cotsKey) continue
      product = byNode.get(node.key) ?? null
      if (!product) {
        product = { nodeKey: node.key, cotsKey, meshIds: [] }
        byNode.set(node.key, product)
        index.products.push(product)
      }
    }
    if (product) {
      product.meshIds.push(object.id)
      index.productOf.set(object.id, product)
    }
  }
  return index
}

// 원래 노드 → 지금 계층에서 그 노드를 대표하는 오브젝트. 그 노드의 메시(source.nodeMeshes)마다 위로 그 노드의 메시만 품은
// (다른 메시가 없는) 오브젝트를 따라 올라가며 후보를 모은다(로봇은 고르지 않는다).
// 1. 후보 중 그 노드에서 만든 CAD 오브젝트(그룹이 아님, madeFrom)가 있으면 그것이다(여럿이면 노드 메시를 가장 많이 품은
//    것, 같으면 먼저 본 것). 메시 일부를 지우거나 다른 어셈블리·그룹으로 옮겨 원래 어셈블리에 메시가 하나만 남아도 원래
//    어셈블리이고, 노드를 그룹으로 감싸도 그 그룹이 아니다.
// 2. 없으면(그 노드의 CAD 오브젝트를 지움) 메시마다 노드 메시를 더 많이 품게 되는 가장 아래 후보를 고르고(더 품지 않는
//    상위는 감싼 그룹이나 나머지를 옮겨 낸 CAD 루트다), 그중 노드 메시를 가장 많이 품은 것(같으면 문서 순서로 앞 메시의
//    것)이다. 노드 메시를 모두 품은 그룹이 여기서 주인이 된다.
// 메시가 없는 노드는 null.
function nodeHomes(objects: SceneObjects, source: SourceIndex): (key: string) => string | null {
  // 오브젝트마다 하위(자신 포함)의 메시 수. 처음 쓸 때 한 번 센다.
  let meshCounts: Map<string, number> | null = null
  const countUp = (counts: Map<string, number>, id: string): void => {
    for (const at of [id, ...ancestorIds(objects, id)]) counts.set(at, (counts.get(at) ?? 0) + 1)
  }
  // 오브젝트를 만든 원래 노드(오브젝트 계층 = 불러온 노드 계층, buildSceneObjects): 메시 파트는 경로의 마지막 노드, CAD
  // 루트는 첫 노드, 어셈블리는 하위 메시 경로의 공통 앞부분에서 가장 깊은 중간 노드(CAD 루트·파트 노드가 아닌 것)다.
  // 어셈블리는 하위에 메시가 하나만 남아도 그 메시 경로의 부모 노드라 그대로다.
  const madeFrom = new Map<string, string | null>()
  const nodeOf = (id: string): string | null => {
    const cached = madeFrom.get(id)
    if (cached !== undefined) return cached
    const object = objects[id]
    let result: string | null = null
    if (object.visual?.type === 'mesh') result = source.paths.get(id)?.at(-1)?.key ?? null
    else {
      // 하위 메시 경로의 공통 앞부분
      let common: readonly SourceNode[] | null = null
      let single = true
      for (const at of subtreeIds(objects, id)) {
        const path = source.paths.get(at)
        if (!path) continue
        if (!common) {
          common = path
          continue
        }
        single = false
        let n = 0
        while (n < common.length && n < path.length && common[n].key === path[n].key) n++
        common = common.slice(0, n)
      }
      if (common && object.cad) result = common[0]?.key ?? null
      else if (common) {
        // 메시가 하나면 공통 앞부분의 끝은 그 파트 노드라 뺀다. 첫 칸은 CAD 루트 노드다.
        const interior = single ? common.slice(0, -1) : common
        result = interior.length >= 2 ? interior[interior.length - 1].key : null
      }
    }
    madeFrom.set(id, result)
    return result
  }
  const homes = new Map<string, string | null>()
  return (key) => {
    const cached = homes.get(key)
    if (cached !== undefined) return cached
    if (!meshCounts) {
      meshCounts = new Map()
      for (const object of Object.values(objects))
        if (object.visual?.type === 'mesh') countUp(meshCounts, object.id)
    }
    const totals = meshCounts
    const nodeCounts = new Map<string, number>()
    const meshes = source.nodeMeshes.get(key) ?? []
    for (const id of meshes) countUp(nodeCounts, id)
    let made: string | null = null
    let madeCount = 0
    let home: string | null = null
    let best = 0
    for (const id of meshes) {
      let candidate = id
      let count = nodeCounts.get(id) ?? 0
      for (const at of [id, ...ancestorIds(objects, id)]) {
        if (objects[at].kind === 'robot') break
        const inside = nodeCounts.get(at) ?? 0
        if (inside !== totals.get(at)) break
        if (objects[at].kind !== 'group' && inside > madeCount && nodeOf(at) === key) {
          made = at
          madeCount = inside
        }
        if (inside > count) {
          candidate = at
          count = inside
        }
      }
      if (count > best) {
        best = count
        home = candidate
      }
    }
    const result = made ?? home
    homes.set(key, result)
    return result
  }
}

// 같은 부품으로 볼 COTS 키: 키가 같거나, 둘 다 모터이거나 둘 다 서보(컴포넌트의 모델·감속비와 CAD SKU가 조금 달라도 그
// 부품 하나다)
function sameCotsItem(a: string, b: string): boolean {
  if (a === b) return true
  const kind = (key: string): string => key.slice(0, key.indexOf(':') + 1)
  const prefix = kind(a)
  return (prefix === 'motor:' || prefix === 'servo:') && prefix === kind(b)
}

type PodRequest = { pinpointId: string; target: string; key: string }

type CotsNotice = { robotId: string; notice: MassNotice }

// Pinpoint 포드(Pinpoint 컴포넌트의 xPod·yPod가 가리키는 오브젝트) → 그 요청. 같은 포드를 여러 Pinpoint가 가리키면 앞의
// 것. 없는 오브젝트는 건너뛰고(하드웨어 검증이 알린다), Pinpoint와 다른 로봇·Pinpoint 자신과 상위는 포드로 보지 않고 그
// Pinpoint의 로봇에 알린다. 남은 포드는 오브젝트의 다른 COTS와 함께 cotsRejection으로 본다(computeMassModel).
function pinpointPods(objects: SceneObjects): {
  pods: Map<string, PodRequest>
  targets: Set<string>
  notices: CotsNotice[]
} {
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
  const pods = new Map<string, PodRequest>()
  const notices: CotsNotice[] = []
  const reported = new Set<string>()
  for (const request of requests) {
    if (pods.has(request.target)) continue
    const robotId = findRobotId(objects, request.pinpointId)
    let reason: CotsIgnoredReason | null = null
    if (robotId === null || findRobotId(objects, request.target) !== robotId) reason = 'otherRobot'
    else if (isInSubtree(objects, request.pinpointId, request.target)) reason = 'containsPinpoint'
    if (reason === null) {
      pods.set(request.target, request)
      continue
    }
    // xPod·yPod가 같은 오브젝트를 가리켜도 한 번만 알린다
    const seen = `${request.pinpointId}\u0000${request.target}`
    if (!robotId || reported.has(seen)) continue
    reported.add(seen)
    notices.push({
      robotId,
      notice: cotsIgnored(request.target, [request.key], reason, request.pinpointId)
    })
  }
  return { pods, targets, notices }
}

const cotsIgnored = (
  objectId: string,
  keys: string[],
  reason: CotsIgnoredReason,
  pinpointId?: string
): MassNotice => ({
  kind: 'cotsIgnored',
  objectId,
  keys,
  reason,
  ...(pinpointId !== undefined ? { pinpointId } : {})
})

// 오브젝트에 붙은 COTS 표 키들(컴포넌트·포드·바퀴, 모두 더한다). 이름의 SKU는 원래 이름 경로의 제품이다(sourceIndex).
function ownCotsKeys(object: SceneObject, pod: PodRequest | undefined): string[] {
  const keys: string[] = []
  for (const component of object.components ?? []) {
    const key = componentCotsKey(component)
    if (key) keys.push(key)
  }
  if (pod) keys.push(pod.key)
  const wheel = object.wheel ? wheelCotsKey(object.wheel) : null
  if (wheel) keys.push(wheel)
  return keys
}

// 오브젝트(ownerId) 하위를 COTS 키들(ownKeys)의 부품 하나로 볼 수 없는 이유(볼 수 있으면 null). COTS 질량은 하위 전체를
// 덮으므로(인스펙터는 아무 오브젝트에나 컴포넌트를 붙이고 포드를 고르게 한다) 상위·큰 어셈블리면 그 형상과 안의 모터·
// Pinpoint 질량이 데이터시트 질량으로 바뀐다. 하위 메시의 SKU 제품은 같은 부품(sameCotsItem)이면 키마다 하나까지 그 부품
// 자신이다(포드 어셈블리의 포드 SKU, 모터 어셈블리의 모터 SKU). 둘 이상이면 여럿을 품은 상위 어셈블리("Odometry")다.
// 오브젝트 자신이 CAD 루트인 것은 거르지 않는다: 로봇 전체 CAD는 다른 COTS를 품거나 너무 커서 걸리고, 부품만 따로
// 불러온 작은 STEP은 그 부품이다.
function cotsRejection(
  objects: SceneObjects,
  lookup: MassLookup,
  source: SourceIndex,
  ownerId: string,
  ownKeys: readonly string[],
  podTargets: ReadonlySet<string>
): CotsIgnoredReason | null {
  let volume = 0
  let containsCad = false
  const products = new Map<string, string>()
  for (const id of subtreeIds(objects, ownerId)) {
    const object = objects[id]
    if (id !== ownerId) {
      const hasCots =
        (object.components ?? []).some((component) => componentCotsKey(component) !== null) ||
        (object.wheel !== undefined && wheelCotsKey(object.wheel) !== null) ||
        podTargets.has(id)
      if (hasCots) return 'containsCots'
      if (object.cad) containsCad = true
    }
    const product = source.productOf.get(id)
    if (product) products.set(product.nodeKey, product.cotsKey)
    if (object.visual?.type === 'mesh') {
      const props = lookup.props(object.visual.geometryId)
      if (props) volume += usableVolume(props)
    }
  }
  const remaining = [...ownKeys]
  for (const cotsKey of products.values()) {
    const at = remaining.findIndex((key) => sameCotsItem(key, cotsKey))
    if (at < 0) return 'containsCots'
    remaining.splice(at, 1)
  }
  if (containsCad) return 'containsCad'
  const limit = ownKeys.reduce(
    (sum, key) => sum + cotsSizeFactor(key) * (cotsEntry(key)?.mass ?? 0),
    0
  )
  return volume * MATERIALS.aluminum6061.density > limit ? 'tooLarge' : null
}

// 이름 규칙·SKU 찾기는 같은 이름이 되풀이되므로(goBILDA 예제 STEP의 PRODUCT 이름 374개 중 고유한 것 144개)
// 한 번 계산 안에서 이름마다 한 번만 한다
type NameCaches = {
  // 파트 노드 이름의 규칙(matchNameRule)
  rule: (name: string) => NameRule | null
  // 상위 노드 이름의 규칙(matchAncestorRule: 부품 종류 낱말을 보지 않는다)
  ancestorRule: (name: string) => NameRule | null
  sku: (name: string) => string | null
}

function memo<T>(compute: (name: string) => T): (name: string) => T {
  const results = new Map<string, T>()
  return (name) => {
    if (results.has(name)) return results.get(name) as T
    const result = compute(name)
    results.set(name, result)
    return result
  }
}

function nameCaches(): NameCaches {
  return {
    rule: memo((name) => matchNameRule([name])),
    ancestorRule: memo(matchAncestorRule),
    sku: memo(skuCotsKey)
  }
}

// 빈 질량 결과(오브젝트 원점)
const emptyObjectMass = (origin: Vec3): ObjectMass => ({
  mass: 0,
  centerOfMass: origin,
  source: 'none',
  detail: '',
  inheritedFrom: null,
  scaled: false,
  pendingMeshes: 0
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
  const source = sourceIndex(objects, lookup, caches)
  const { pods, targets: podTargets, notices: cotsNotices } = pinpointPods(objects)
  const parts: Part[] = []
  const partsByObject = new Map<string, Part[]>()
  const blocks: Block[] = []
  // 오브젝트마다 알릴 것의 차례(문서 순서): 덩어리(푼 뒤 innerMassExceeds·centerOfMassIgnored)와, 덩어리를 정하지 않아
  // 무게중심 덮어쓰기를 쓰지 못한 오브젝트
  const noticeOrder: ({ block: Block } | { unusedCenter: string; robotId: string | null })[] = []
  const matrices = new Map<string, Matrix4>()
  // 형상 정보가 없는 메시(읽는 중·못 읽음). 덩어리 안(inBlock)이거나 읽은 메시가 있는 SKU 제품이면 질량이 들어간다.
  const unloaded: {
    objectId: string
    robotId: string | null
    inBlock: boolean
    product: Product | null
  }[] = []
  // 로봇마다 메시 형상 수(읽었든 읽는 중이든, 덩어리 안이든). 0이면 CAD가 없는 로봇이다(정보 없음 대체값).
  const shapes = new Map<string, number>()
  // 오브젝트마다 질량에 들어가지 않은 읽는 중 메시(덩어리 밖, ObjectMass.pendingMeshes). SKU 제품 덩어리를 만든 뒤 센다.
  const uncounted = new Map<string, number>()
  // 덩어리를 만든(읽은 메시가 있는) SKU 제품: 그 제품의 읽는 중 메시도 제품 질량에 들어 있다
  const coveredProducts = new Set<Product>()
  // 덩어리 밖의 SKU 제품 파트(지금 계층을 다 본 뒤 제품 덩어리로 묶는다)
  const productParts = new Map<Product, Part[]>()
  // 원래 노드 → 지금 계층에서 그 노드를 대표하는 오브젝트(출처 표시의 상속 오브젝트, 제품 덩어리의 주인)
  const nodeHome = nodeHomes(objects, source)

  const addPart = (part: Part): void => {
    parts.push(part)
    const list = partsByObject.get(part.objectId)
    if (list) list.push(part)
    else partsByObject.set(part.objectId, [part])
  }

  const newBlock = (
    ownerId: string,
    robotId: string | null,
    kind: Block['kind'],
    mass: number,
    keys: string[],
    centerOfMass: Vec3 | null,
    origin: Vec3,
    parent: Block | null
  ): Block => ({
    ownerId,
    robotId,
    kind,
    mass,
    detail: keys.join('+'),
    keys,
    parent,
    centerOfMass,
    origin,
    members: [],
    children: [],
    resolvedMass: 0,
    resolvedCom: origin,
    exceededBy: null,
    centerOfMassIgnored: false
  })

  // 추정 파트의 재질·출처. 이름 규칙은 원래 이름 경로에서 파트 노드부터 위로 가장 가까운 규칙이다.
  const estimate = (object: SceneObject, context: Context): Estimate => {
    if (context.material) {
      const { key, ownerId } = context.material
      return {
        material: key,
        source: 'material',
        detail: key,
        inheritedFrom: ownerId === object.id ? null : ownerId
      }
    }
    const path = source.paths.get(object.id) ?? []
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i]
      if (node.generated) continue
      const leaf = i === path.length - 1
      // 상위 노드(어셈블리·CAD 루트) 이름의 부품 종류 낱말은 그 아래 솔리드에 내려가지 않는다(재질 낱말·SKU 시리즈만)
      const matched = leaf ? caches.rule(node.name) : caches.ancestorRule(node.name)
      if (!matched) continue
      const owner = leaf ? null : nodeHome(node.key)
      return {
        material: matched.material,
        source: 'nameRule',
        detail: matched.name,
        inheritedFrom: owner === object.id ? null : owner
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
    const settings = object.mass

    const context: Context = {
      robot: isRobot ? object : (parent?.robot ?? null),
      matrix,
      material: settings?.material
        ? { key: settings.material, ownerId: object.id }
        : (parent?.material ?? null),
      infill: settings?.infill ?? parent?.infill,
      block: parent?.block ?? null
    }

    // 질량을 정하는 덩어리
    if (!isRobot) {
      const origin = applyPoint(matrix, [0, 0, 0])
      const centerOfMass = settings?.centerOfMass ? applyPoint(matrix, settings.centerOfMass) : null
      const robotId = context.robot?.id ?? null
      let block: Block | null = null
      if (settings?.mass !== undefined) {
        block = newBlock(
          object.id,
          robotId,
          'override',
          settings.mass,
          [],
          centerOfMass,
          origin,
          context.block
        )
      } else if (context.block === null) {
        const pod = pods.get(object.id)
        const keys = ownCotsKeys(object, pod)
        const reason =
          keys.length > 0
            ? cotsRejection(objects, lookup, source, object.id, keys, podTargets)
            : null
        if (keys.length > 0 && reason === null) {
          const mass = keys.reduce((sum, key) => sum + (cotsEntry(key)?.mass ?? 0), 0)
          block = newBlock(object.id, robotId, 'cots', mass, keys, centerOfMass, origin, null)
        } else if (reason !== null) {
          // 포드면 그 Pinpoint의 로봇에(포드와 같은 로봇이다), 아니면 이 오브젝트의 로봇에 알린다
          if (robotId)
            cotsNotices.push({
              robotId,
              notice: cotsIgnored(object.id, keys, reason, pod?.pinpointId)
            })
        }
      }
      if (block) {
        context.block?.children.push(block)
        blocks.push(block)
        noticeOrder.push({ block })
        context.block = block
      } else if (settings?.centerOfMass) {
        // 질량을 정하지 않았거나(덮어쓰기·COTS 없음) COTS가 다른 덩어리 안이라 쓰이지 않아, 무게중심을 옮길 덩어리가
        // 없다(SKU 제품의 주인이면 제품 덩어리가 쓴다, 아래)
        noticeOrder.push({ unusedCenter: object.id, robotId: context.robot?.id ?? null })
      }
    }

    if (object.visual?.type === 'mesh') {
      const props = lookup.props(object.visual.geometryId)
      const shapeRobot = context.robot?.id
      if (shapeRobot) shapes.set(shapeRobot, (shapes.get(shapeRobot) ?? 0) + 1)
      if (!props) {
        unloaded.push({
          objectId: object.id,
          robotId: context.robot?.id ?? null,
          inBlock: context.block !== null,
          product: source.productOf.get(object.id) ?? null
        })
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
          scaled: false,
          block: context.block
        }
        const product = source.productOf.get(object.id)
        if (context.block) {
          context.block.members.push(part)
        } else if (product) {
          const list = productParts.get(product)
          if (list) list.push(part)
          else productParts.set(product, [part])
        } else if (volume > 0) {
          const { material, ...estimated } = estimate(object, context)
          Object.assign(part, estimated)
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

    for (const child of childrenInDocument(objects, object.id)) visit(child, context)
  }

  for (const root of childrenInDocument(objects, null)) visit(root, null)

  // SKU 제품 덩어리: 덩어리 밖에 남은 제품 파트를 묶는다(제품마다 첫 메시의 문서 순서). 제품 메시 일부가 같은 부품의
  // COTS 덩어리(모터 어셈블리에 붙인 모터 컴포넌트 등) 안에 있으면 나머지도 그 덩어리에 넣는다. 아니면 덩어리 안 몫을
  // 뺀 질량으로 제품 덩어리를 만든다.
  const productBlocks: Block[] = []
  for (const product of source.products) {
    const free = productParts.get(product)
    if (!free) continue
    coveredProducts.add(product)
    const all = product.meshIds.flatMap((id) => partsByObject.get(id) ?? [])
    let joined: Block | null = null
    for (const part of all) {
      for (let block = part.block; block && !joined; block = block.parent) {
        if (block.kind === 'cots' && block.keys.some((key) => sameCotsItem(key, product.cotsKey)))
          joined = block
      }
      if (joined) break
    }
    if (joined) {
      for (const part of free) {
        part.block = joined
        joined.members.push(part)
      }
      continue
    }
    const freeVolume = free.reduce((sum, part) => sum + part.volume, 0)
    const allVolume = all.reduce((sum, part) => sum + part.volume, 0)
    const share = allVolume > 0 ? freeVolume / allVolume : free.length / all.length
    // 주인은 제품 메시만 품은 오브젝트(nodeHomes)라, 제품 솔리드를 옮겨도 다른 것을 품은 상위(CAD 루트·그룹)의 무게중심
    // 덮어쓰기를 가져가지 않고 원래 제품 어셈블리의 것을 계속 쓴다
    const ownerId = nodeHome(product.nodeKey) ?? free[0].objectId
    const owner = objects[ownerId]
    const matrix = matrices.get(ownerId) ?? new Matrix4()
    // 주인이 덩어리를 정하지 않아 쓰이지 않던 무게중심 덮어쓰기는 제품 덩어리가 쓴다(주인 하위의 제품 메시가 모두 다른
    // 덩어리 안이면 그 덮어쓰기는 이 덩어리의 것이 아니다)
    const center =
      owner.kind !== 'robot' && free.some((part) => isInSubtree(objects, part.objectId, ownerId))
        ? owner.mass?.centerOfMass
        : undefined
    const unused = center
      ? noticeOrder.findIndex((entry) => 'unusedCenter' in entry && entry.unusedCenter === ownerId)
      : -1
    const block = newBlock(
      ownerId,
      free[0].robotId,
      'cots',
      (cotsEntry(product.cotsKey)?.mass ?? 0) * share,
      [product.cotsKey],
      unused >= 0 && center ? applyPoint(matrix, center) : null,
      applyPoint(matrix, [0, 0, 0]),
      null
    )
    for (const part of free) {
      part.block = block
      block.members.push(part)
    }
    if (unused >= 0) noticeOrder[unused] = { block }
    productBlocks.push(block)
  }

  // 형상 정보가 없는 메시: 질량이 빠진 것(덩어리 밖, 제품 덩어리도 없음)과 덩어리가 질량을 정한 것을 로봇마다 센다
  const missingMeshes = new Map<string, number>()
  const coveredMeshes = new Map<string, number>()
  for (const entry of unloaded) {
    const covered = entry.inBlock || (entry.product !== null && coveredProducts.has(entry.product))
    if (!covered) uncounted.set(entry.objectId, (uncounted.get(entry.objectId) ?? 0) + 1)
    if (!entry.robotId) continue
    const counts = covered ? coveredMeshes : missingMeshes
    counts.set(entry.robotId, (counts.get(entry.robotId) ?? 0) + 1)
  }

  // 덩어리 풀기: 안쪽 덩어리가 먼저(만든 순서의 반대가 곧 안쪽부터다)
  for (let i = blocks.length - 1; i >= 0; i--) resolveBlock(blocks[i], parts, partsByObject)
  for (const block of productBlocks) resolveBlock(block, parts, partsByObject)

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
    for (const entry of cotsNotices) if (entry.robotId === robotId) notices.push(entry.notice)
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
    const meshes = missingMeshes.get(robotId) ?? 0
    const covered = coveredMeshes.get(robotId) ?? 0
    let fixed = 0
    let estimated = 0
    for (const part of list) {
      if (part.estimated) estimated += part.mass
      else fixed += part.mass
    }
    let scale = 1
    const weighed = objects[robotId].rigidbody?.weighedMass
    const total = fixed + estimated
    // 정보 없음 대체값(§3.3): 질량을 셀 수 있는 형상(질량이 0이 아닌 추정 파트)이 없고, 질량을 모르는 부분이 있을 때다.
    // 질량을 모르는 부분은 CAD가 없음(메시 형상이 하나도 없음), 덩어리(덮어쓰기·COTS·SKU 제품) 밖의 형상 정보가 없는
    // 메시(읽는 중·못 읽음)나 표면 메시, 또는 아무 질량도 없음이다. 덩어리가 덮은 메시는 고정 질량이 이미 셌으므로 상자를
    // 더하지 않는다(CAD 전체를 덮은 직접 입력은 CAD를 못 찾아도 같은 질량). 그 나머지(저울 무게 − 고정, 없으면
    // max(0, DEFAULT_ROBOT_MASS − 고정))를 외곽 상자에 고르게 둔다. 저울 무게의 나머지가 0 이하면 scaleImpossible이고
    // 고정 질량만 쓴다. 질량을 셀 수 있는 형상이 하나라도 있으면 읽은 만큼으로 계산하고 맞춘다(pending 경고).
    const estimable = list.some((part) => part.estimated && part.mass > 0)
    const surfaces = list.some((part) => part.block === null && part.volume === 0)
    const unknown = meshes > 0 || surfaces || (shapes.get(robotId) ?? 0) === 0 || total === 0
    let rest = 0
    let defaultBox = false
    if (!estimable && unknown) {
      rest = weighed !== undefined ? weighed - fixed : Math.max(0, DEFAULT_ROBOT_MASS - fixed)
      if (weighed !== undefined && rest <= 0) {
        rest = 0
        warnings.push({ kind: 'scaleImpossible', fixed, weighed })
      } else {
        warnings.push({ kind: 'defaultMass', weighed: weighed !== undefined, fixed, rest })
        defaultBox = rest > 0
      }
    } else if (weighed !== undefined && total > 0) {
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
    if (!defaultBox) {
      // 읽는 중인 메시는 빼고 계산한다(일부만 읽었으면 읽은 만큼)
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
      // 질량을 모르는 나머지(rest): 외곽 상자의 균일 직육면체. 고정 질량은 제자리에 둔다.
      mass = fixed + rest
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
      defaultRobots.set(robotId, { mass, com: centerOfMass })
    }
    if (meshes > 0 || covered > 0)
      warnings.push({ kind: 'pending', meshes, ...(covered > 0 ? { covered } : {}) })
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
    objects: objectMasses(objects, matrices, partsByObject, defaultRobots, uncounted),
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
      scaled: false,
      block
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
  defaultRobots: Map<string, { mass: number; com: Vec3 }>,
  uncounted: Map<string, number>
): Record<string, ObjectMass> {
  type Group = { source: MassSource; detail: string; inheritedFrom: string | null; mass: number }
  type Aggregate = {
    mass: number
    moment: Vec3
    groups: Map<string, Group>
    scaled: boolean
    pending: number
  }
  const results = new Map<string, ObjectMass>()

  const addGroup = (groups: Map<string, Group>, group: Group): void => {
    const key = `${group.source}\u0000${group.detail}`
    const existing = groups.get(key)
    if (existing) existing.mass += group.mass
    else groups.set(key, { ...group })
  }

  const visit = (object: SceneObject): Aggregate => {
    const aggregate: Aggregate = {
      mass: 0,
      moment: [0, 0, 0],
      groups: new Map(),
      scaled: false,
      pending: uncounted.get(object.id) ?? 0
    }
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
      aggregate.pending += sub.pending
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
        scaled: false,
        // 대체값의 질량(저울 무게·기본값)은 읽는 중인 메시와 관계없이 전체다
        pendingMeshes: 0
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
    result.pendingMeshes = aggregate.pending
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
