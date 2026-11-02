import type { Vec3 } from '../scene/model'

// 질량 모델(3a)의 타입. 내부 단위는 kg·m·kg·m²다. 질량 설정은 바퀴처럼 시뮬레이터 전용이라 생성 코드·구성 XML·검증과
// 관계없다. 메시의 질량 성질은 형상과 함께 문서 밖(geometryRegistry)에 두고, 씬 문서에는 사용자 설정만 둔다.

// 관성 행렬 I = ∫(|r|²E − r rᵀ) dm의 성분 [Ixx, Iyy, Izz, Ixy, Ixz, Iyz]. 비대각은 행렬 값 그대로(Ixy = −∫xy dm).
export type SymMatrix3 = [number, number, number, number, number, number]

// 메시 하나(STEP 솔리드 하나)의 단위 밀도(1 kg/m³) 질량 성질. 좌표는 피벗(이 메시를 쓰는 파트 오브젝트의 원점) 기준,
// CAD 파일 축, 미터. 질량 = 밀도 × volume, 관성 = 밀도 × inertia.
export type MeshMassProps = {
  // m³, ≥ 0(감김이 반대면 부호를 바로잡은 값)
  volume: number
  // m, 피벗 기준
  centroid: Vec3
  // 무게중심 기준, m⁵
  inertia: SymMatrix3
  // m²
  area: number
  // |Σ n·dA| × 경계 상자 반대각선 / (3|V|)와 축별 부피의 퍼짐 max_k |V_k − V| / V 가운데 큰 값(cad/meshMass.ts).
  // 닫히면 0, 부피가 0이면 Infinity. MASS_CLOSURE_LIMIT를 넘으면 표면(질량 0)이다.
  closure: number
}

// 이 값 이하면 부피를 쓴다(그보다 크면 표면으로 보고 질량 0)
export const MASS_CLOSURE_LIMIT = 0.02
// 이 값을 넘고 MASS_CLOSURE_LIMIT 이하면 "열린 메시(근사)"로 센다
export const MASS_CLOSURE_OPEN = 0.001

export const MATERIAL_KEYS = [
  'aluminum6061',
  'aluminum7075',
  'steel',
  'stainless',
  'brass',
  'polycarbonate',
  'acetal',
  'hdpe',
  'nylon',
  'carbonFiber',
  'plywood',
  'rubber',
  'foam',
  'pla',
  'petg',
  'abs',
  'tpu'
] as const
export type MaterialKey = (typeof MATERIAL_KEYS)[number]

// assembly·part·group·CAD 루트의 질량 설정(SceneObject.mass, PROJECT_VERSION 7)
export type MassSettings = {
  // 이 오브젝트 하위로 상속한다. 하위가 다시 정하면 그것을 쓴다
  material?: MaterialKey
  // 0–1, 출력 재질에서만 쓴다(없으면 DEFAULT_INFILL)
  infill?: number
  // kg. 이 오브젝트 하위 전체의 질량을 덮어쓴다
  mass?: number
  // m, 이 오브젝트 로컬. 덮어쓴 질량의 무게중심(없으면 형상 무게중심, 형상이 없으면 원점)
  centerOfMass?: Vec3
}

// robot의 질량 설정(SceneObject.rigidbody, Unity Rigidbody)
export type RigidbodySettings = {
  // kg, 저울에 단 전체 무게. 없으면 추정 그대로
  weighedMass?: number
  // 없으면 aluminum6061
  defaultMaterial?: MaterialKey
}

export const DEFAULT_INFILL = 0.15
// 형상·질량 정보가 없는 로봇(임시 씬의 상자 로봇 등)의 질량. FTC 대회 로봇은 대개 25–35 lb다.
export const DEFAULT_ROBOT_MASS = 13.6

// 질량이 어디서 왔는지
export type MassSource = 'override' | 'cots' | 'material' | 'nameRule' | 'default' | 'none'

export type MassWarning =
  // 저울 맞추기 비율이 [0.6, 1.6] 밖
  | { kind: 'scaleUnusual'; scale: number }
  // 고정 질량(덮어쓰기·COTS) ≥ 저울 무게이거나 추정 질량이 0이라 맞추지 않음
  | { kind: 'scaleImpossible'; fixed: number; weighed: number }
  // 질량 정보가 없어 기본값을 씀
  | { kind: 'defaultMass' }
  // 형상을 읽는 중인 메시가 있어 그 부분이 빠짐
  | { kind: 'pending'; meshes: number }

export type ObjectMass = {
  // kg, 이 오브젝트 하위 전체
  mass: number
  // m, 로봇 좌표(로봇 밖 오브젝트는 필드 좌표). 질량이 0이면 오브젝트 원점
  centerOfMass: Vec3
  // 이 오브젝트 자신의 출처(하위가 섞여 있으면 하위 중 가장 큰 질량의 출처)
  source: MassSource
  // 출처를 설명하는 것: COTS 표 키, 이름 규칙 이름, 재질 키(상속이면 상속한 오브젝트 id) 등
  detail: string
  inheritedFrom: string | null
  // 저울 맞추기 비율이 곱해졌는지
  scaled: boolean
}

export type RobotMass = {
  robotId: string
  mass: number
  // 로봇 좌표
  centerOfMass: Vec3
  // 무게중심 기준, 로봇 좌표, kg·m²
  inertia: SymMatrix3
  principalMoments: Vec3
  // 출처별 합계(kg)
  fixedMass: number
  estimatedMass: number
  // 저울 맞추기 비율(맞추지 않았으면 1)
  scale: number
  warnings: MassWarning[]
}

export type MassModel = {
  objects: Record<string, ObjectMass>
  robots: Record<string, RobotMass>
}

// computeMassModel이 문서 밖 형상 정보를 읽는 길(시험에서 바꿀 수 있게 인자로 받는다)
export type MassLookup = {
  props: (geometryId: string) => MeshMassProps | undefined
  // 원래 CAD 메시 이름(오브젝트 이름을 바꿔도 이름 규칙이 원래 이름으로 맞추게)
  sourceName: (geometryId: string) => string | undefined
}

// CAD 루트마다 메시 상태 요약(인스펙터)
export type CadMassSummary = {
  meshes: number
  openMeshes: number
  openVolumeFraction: number
  surfaceMeshes: number
  pendingMeshes: number
}
