import type { SimElementGroup, SimElementKind, Vec2, Vec3 } from '../worldSpec'
import {
  applyMatrix3,
  boxVertices,
  circlePolygonSeparation,
  isConvexCcwPolygon,
  matMul3,
  OVERLAP_TOLERANCE,
  partInsideShape,
  partVertices,
  polygonSeparation,
  rectPolygon,
  rotationMatrix,
  solidFootprints,
  sphereInsideShape,
  spherePartSeparation,
  sphereShapeSeparation
} from './fieldGeometry'
import { presetRect, START_DEPTH } from './startPose'
import {
  mirrorCarrier,
  mirrorElementKind,
  mirrorHive,
  mirrorPreset,
  mirrorRect,
  mirrorVec3,
  ROTATE_PI
} from './symmetry'
import { carrierAngle } from './tagPoses'

// 시즌 필드 데이터의 모양(spec-4ab §1.3). 시즌마다 코드 상수(seasons/<시즌>.ts)이고 resolveSeason이 깊게 얼린 값을 준다.
// 단위는 미터·라디안, 필드 좌표는 그 시즌의 FTC 공식 필드 좌표계(원점 필드 중앙 타일 윗면, Z 위, 반시계 +)다.
// 회전은 X(롤)·Y(피치)·Z(요) 라디안이고 적용 순서는 Three.js Euler 'ZYX'(R = Rz·Ry·Rx)다.
//
// 이 폴더(seasons/**)는 ../worldSpec에서 import type만 한다(worldSpec.ts가 seasons.ts의 값 isSeasonId를 import하므로
// 값 import는 순환이 된다).

export type SeasonId = 'none' | 'biobuzz'
export type Alliance = 'red' | 'blue'
export type FieldWallName = 'red' | 'blue' | 'audience' | 'scoring'
// 축 정렬 사각형 [x0, y0, x1, y1](x0 < x1, y0 < y1), 필드 좌표 바닥
export type FieldRect = [number, number, number, number]

export type FieldMaterial = {
  // 표시 색 '#rrggbb'. CAD 색은 재질 근거가 아니다(synthesis §4.6)
  display: string
  // 가시 반사율(4c 색 센서)
  rgb: [number, number, number]
  // 940–950 nm 반사율(4c ToF·근접)
  nir: number
  // 기본 diffuse
  optics?: 'diffuse' | 'polycarbonate'
}

export type FieldShape =
  // rotation ZYX, size는 자기 축 x·y·z 전체 길이
  | { kind: 'box'; center: Vec3; rotation: Vec3; size: Vec3 }
  // 자기 z가 축. 세운 원기둥만(rotation x·y = 0). 지금 데이터에는 없다
  | { kind: 'cylinder'; center: Vec3; rotation: Vec3; radius: number; height: number }

export type FieldCarrier = 'field' | 'hiveRed' | 'hiveBlue'
// HIVE 몸체 틀(carrier 중 HIVE)
export type FieldHiveKey = Exclude<FieldCarrier, 'field'>

export type FieldStructureKey = 'footBar' | 'leg' | 'topBar' | 'logoPlate' | 'flower' | 'hiveCell'

// ---- 구조물·HIVE 부품(6b, spec-6b §1.1) ----

// 부품 하나의 형상(그 주인의 carrier 틀). 계산 기본형이다: 상자(FieldShape box와 같은 뜻), 볼록 기둥(자기 x·y 평면의 볼록
// 반시계 다각형(점 셋 이상, center 기준)을 자기 z로 ±height/2 밀어낸 것), 세운 원기둥(rotation x = y = 0, 자기 z가 축).
// 시즌 데이터의 고리 조각 각은 k·22.5°이고 그 cos·sin은 정확한 제곱근 식으로 적는다(시즌 데이터에 새 Math.sin·cos를 넣지
// 않는다: 기준 해시가 Node를 올릴 때 다시 볼 것이 늘지 않게, spec-6b §1.1)
export type FieldPartShape =
  | { kind: 'box'; center: Vec3; rotation: Vec3; size: Vec3 }
  | { kind: 'prism'; center: Vec3; rotation: Vec3; polygon: readonly Vec2[]; height: number }
  | { kind: 'cylinder'; center: Vec3; rotation: Vec3; radius: number; height: number }

export type FieldPart = {
  shape: FieldPartShape
  // 로봇 3D 몸체 충돌(5 collision3d staticShapes)과 INIT 3D 시작 겹침(startOverlaps)이 쓴다. HIVE 부품은 늘 false(로봇은
  // HIVE에 닿지 않는다, 사용자 결정 11/19)
  robots: boolean
  // 공 접촉(6a ElementWorld)이 쓴다
  balls: boolean
  // 표시·디버그·데이터 시험용 이름(계산은 배열 순번만 쓴다). 봉투 밖으로 나가도 되는 부품은 PART_ENVELOPE_EXCEPTIONS에, CELL
  // 트레이의 밑판·Back Skin은 CELL_FLOOR_PART_KEY·CELL_BACK_SKIN_PART_KEY를 둔다
  key?: string
}

// 부품이 구조물 봉투(shape) 밖으로 나가도 되는 거리(m) [결정: spec-6b §1.1, CAD 측정 반올림보다 넉넉히]
export const PART_ENVELOPE_TOLERANCE = 1e-3
// 봉투 밖으로 나가도 되는 부품 이름(spec-6b §1.1·부록 A.2: FLOWER Field Wall Bracket이 벽 레일 위와 ±v로 넘는다). 데이터를
// 넣는 커밋이 그 이름을 여기 더한다
export const PART_ENVELOPE_EXCEPTIONS: ReadonlySet<string> = new Set<string>()
// CELL 트레이의 밑판·Back Skin 부품 이름: 데이터 시험이 hiveCell 시작 공이 둘에 닿는지 찾는다(spec-6b §1.2)
export const CELL_FLOOR_PART_KEY = 'cellFloor'
export const CELL_BACK_SKIN_PART_KEY = 'cellBackSkin'

export type FieldStructure = {
  // i18n field.structures.<key>. 유일하지 않다(다리 넷이 모두 leg). 계산은 배열 순번만 쓴다
  key: FieldStructureKey
  // carrier 틀 기준
  shape: FieldShape
  // 4b 구동계 접촉
  solid: boolean
  // 4d 가림
  occludes: boolean
  // 4c 광선
  sensed: boolean
  material: FieldMaterial
  // 접선 μ(구조물 면 대 로봇 외곽)
  friction: number
  // HIVE 몸체 틀에 달린 것은 표시만(solid·occludes·sensed 모두 false여야 한다)
  carrier: FieldCarrier
  // 계산 부품(6b, carrier 틀). 있으면 로봇 3D 충돌(robots 부품)과 공 접촉(balls 부품)은 shape 대신 이것을 쓴다. 다른 쓰임(평면
  // 경로·fieldOverlaps·시작 프리셋·4c 광선·4d 가림·자동 프리로드·열기 알림)은 늘 shape(봉투)를 쓴다. 부품은 봉투 안이다
  // (PART_ENVELOPE_TOLERANCE, 이름이 PART_ENVELOPE_EXCEPTIONS에 있는 것은 예외)
  parts?: readonly FieldPart[]
}

export type FieldTag = {
  id: number
  // 검은 테두리 바깥 변(m). 흰 고리 포함 전체 변은 1.25·size
  size: number
  carrier: FieldCarrier
  // carrier 틀 기준
  position: Vec3
  // ZYX. 태그 틀은 SDK 관례: x 보는 사람 오른쪽, y 그림 아래, z 안쪽(앞면 법선 = −z)
  rotation: Vec3
  // SDK 묶음 이름 'RED SCORING' 등
  cluster: string | null
}

export type FieldHive = {
  key: FieldHiveKey
  // 필드 좌표
  pivot: Vec3
  // +Y축 둘레 오른손 각(rad). 0 = 몸체 틀이 필드 축과 나란함
  startAngle: number
  tippedAngle: number
  // 한 축 동역학(6b, spec-6b §1.3·§2). 없으면 HIVE는 실행 동안 시작 상태로 고정이다(4ab·4d). 경기 요소(공)가 있는 실행에서만
  // 움직인다. massMoment: 질량 × 축에서 무게중심까지(kg·m, 무게중심은 몸체 z축 위라 중력 토크 = massMoment·g·sin θ),
  // inertia: 축 둘레 관성(kg·m²), pivotFriction: 축 쿨롱 마찰 토크(N·m). 파랑은 같은 값(mirrorHive)
  dynamics?: { massMoment: number; inertia: number; pivotFriction: number }
  // 움직이는 몸체 틀(이 HIVE carrier 틀)의 계산 부품(축 조립체). CELL 트레이는 carrier가 이 HIVE인 CELL 구조물의 parts다.
  // robots는 늘 false
  parts?: readonly FieldPart[]
}

export type FieldStartPreset = {
  // i18n field.startPresets.<key>. 시즌 안에서 유일
  key: string
  alliance: Alliance
  // 로봇 외곽이 닿을 벽
  wall: FieldWallName
  // 외곽이 들어가야 할 벽 방향 구간. red·blue 벽이면 X, audience·scoring 벽이면 Y
  along: [number, number]
  // 기본 요((−π, π]). 벽을 보는 면 'default'의 요
  yaw: number
}

export type FieldTape = {
  key: string
  alliance: Alliance
  rect: FieldRect
  material: FieldMaterial
  // 필드 밖 바닥(Z −0.01496, 표시만)
  offField?: true
}

export type FieldZone = { key: 'loadingZone' | 'garden'; alliance: Alliance; rect: FieldRect }

// ---- 움직이는 경기 요소(6a, spec-6a §4) ----

// 공 한 종류의 물리 값. 시뮬레이터(elements/)가 resolveSeason으로 읽고 렌더러 값은 받지 않는다. 길이 m, 질량 kg.
export type FieldElementType = {
  kind: SimElementKind
  // 바깥 반지름
  radius: number
  mass: number
  // 등방 관성(kg·m², 중심 기준). 속이 빈 껍질이라 0.4·m·r²보다 크다
  inertia: number
  // 표시 색과 반사율(6c 센서가 쓴다)
  material: FieldMaterial
  contact: {
    // 판 둘 사이에 끼운 공의 강성(N/m). 접촉점 하나의 스프링은 그 두 배(직렬 접촉 둘)
    plateStiffness: number
    // 이 깊이(반지름 비)를 넘으면 딱딱한 심(강체 행)
    coreDepthRatio: number
    // 공 표면의 쿨롱 μ(짝은 두 면의 평균, Unity Friction Combine Average)
    friction: number
    // 굴림 저항 계수(무차원, 굴림 감속 ≈ μ_rr·g/(1 + I/mr²))
    rollingResistance: number
    // 회전(법선 둘레) 저항의 접촉 반경(m)
    spinRadius: number
    // 반발 계수: 바닥(타일), 딱딱한 면(벽·구조물), 다른 공, 로봇
    restitution: { floor: number; hard: number; element: number; robot: number }
  }
  air: {
    // 항력 계수 C_d(면적 πr²)
    dragCoefficient: number
    // Magnus 양력 계수 = min(magnusMax, magnusSlope · r|ω|/|v|)
    magnusSlope: number
    magnusMax: number
  }
  // 필드 밖으로 나가면 경기 요원이 가까운 LOADING ZONE에 다시 넣는다(CM 10.8.2, POLLEN). false면 밖에 그대로 둔다
  // (NECTAR는 사람 선수 몫이라 6d)
  reentry: boolean
}

// 시작 배치 하나(공 중심, 쉬는 상태로 생긴다). carrier가 없으면 position은 필드 좌표다. carrier가 있으면 그 HIVE 몸체 틀
// 좌표이고(6b hiveCell), when이 있으면 그 HIVE의 시작 상태(세계 설명 field.hiveTipped)가 같을 때만 생긴다(넘어간 채 시작하면
// 그때 위를 보는 CELL에 둔다). when은 carrier와 함께만 쓴다(placementActive·placementFieldPosition)
export type FieldElementPlacement = {
  group: SimElementGroup
  kind: SimElementKind
  position: Vec3
  carrier?: FieldHiveKey
  when?: 'start' | 'tipped'
}

export type FieldElements = {
  // 종류마다 하나(kind 유일)
  types: FieldElementType[]
  // 배열 순서가 공 번호 순서다(묶음으로 거른 뒤 그 순서, elements/spawn.ts elementSpawns)
  layout: FieldElementPlacement[]
}

export type FieldSpec = {
  season: SeasonId
  // 벽 라벨(i18n field.walls.<값>). 'none'은 null(라벨 없음)
  walls: {
    plusX: FieldWallName
    minusX: FieldWallName
    plusY: FieldWallName
    minusY: FieldWallName
  } | null
  perimeter: {
    // 접촉 기준면 = 레일 안쪽 면의 반폭
    innerHalf: number
    // 타일 윗면부터 위 레일 윗면
    height: number
    thickness: number
    // 투명판 안쪽 면이 레일 안쪽 면보다 바깥인 거리(4c)
    panelInset: number
    // 레일이 있는 Z 구간
    railBands: [number, number][]
    // 판 이음의 벽 방향 구간(네 벽 같음, 대칭)
    panelSeams: [number, number][]
    rail: FieldMaterial
    // optics 'polycarbonate'
    panel: FieldMaterial
  }
  // seams: X·Y 같은 타일 이음 좌표(오름차순)
  floor: { seams: number[]; material: FieldMaterial }
  tape: FieldTape[]
  // 판정용(FAC). 4ab는 표시·시작 충돌(LZ)·데이터 시험
  zones: FieldZone[]
  hives: FieldHive[]
  structures: FieldStructure[]
  aprilTags: { family: 'tag36h11'; tags: FieldTag[] }
  // 프리셋만 피하는 곳(GARDEN POLLEN 자리, 규칙 아님 synthesis §9.6). 데이터 시험과 표시만 쓴다
  startKeepOut: { rect: FieldRect }[]
  startPresets: FieldStartPreset[]
  // 움직이는 경기 요소(6a). 없는 시즌('none')은 null. 다시 넣는 자리는 loadingZone 구역에서 만든다(elements/spawn.ts
  // reentrySlots)
  elements: FieldElements | null
}

// 깊게 얼린 같은 값(시즌 모듈 상수). 시험이 바꾼 판이 필요하면 얕은 복사를 쓴다(spec-4ab §1.3).
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

// ---- 시작 배치의 자리(6b, spec-6b §1.2). 세계 설명 검사(parseWorldSpec의 공 수)와 elementSpawns가 같은 규칙을 쓴다 ----

// 이 배치가 실행에 생기는지: carrier·when이 없으면 늘, 있으면 그 HIVE의 시작 상태(hiveTipped [빨강, 파랑])가 when과 같을 때
export function placementActive(
  p: FieldElementPlacement,
  hiveTipped: readonly [boolean, boolean]
): boolean {
  if (p.carrier === undefined || p.when === undefined) return true
  const tipped = p.carrier === 'hiveRed' ? hiveTipped[0] : hiveTipped[1]
  return (p.when === 'tipped') === tipped
}

// 배치의 시작 필드 좌표. carrier가 없으면 position의 복사본, 있으면 그 HIVE의 시작 각으로 T(pivot)·R_y(θ)·position
// (seasons/tagPoses.ts tagFieldPose와 같은 호출 순서: carrierAngle → rotationMatrix → applyMatrix3 → pivot 더하기)
export function placementFieldPosition(
  field: FieldSpec,
  p: FieldElementPlacement,
  hiveTipped: readonly [boolean, boolean]
): Vec3 {
  if (p.carrier === undefined) return { x: p.position.x, y: p.position.y, z: p.position.z }
  const hive = field.hives.find((h) => h.key === p.carrier)
  if (!hive) throw new Error(`carrier ${p.carrier}가 시즌 데이터에 없다`)
  const carrier = rotationMatrix({ x: 0, y: carrierAngle(field, p.carrier, hiveTipped), z: 0 })
  const q = applyMatrix3(carrier, p.position)
  return { x: hive.pivot.x + q.x, y: hive.pivot.y + q.y, z: hive.pivot.z + q.z }
}

// ---- 데이터 검사(데이터 시험만 부른다) ----

// 프리셋 사각형이 피해야 할 solid 껍질의 높이: 29 in(R105.A 확장 높이 상한)
const PRESET_CHECK_HEIGHT = 0.7366
// 짝 비교 허용(형상): 대칭 생성은 정확한 부호 반전이고, 회전 행렬은 cos·sin 반올림만큼 다르다
const SYMMETRY_TOLERANCE = 1e-12
// 진영 경계 허용(m)
const HALF_TOLERANCE = 1e-6

type Path = string

// 모든 수가 유한하고 −0이 없는지(대칭 생성은 −0을 만들지 않는다)
function checkNumbers(value: unknown, path: Path, errors: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${path}: not finite`)
    else if (Object.is(value, -0)) errors.push(`${path}: -0`)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) checkNumbers(child, `${path}.${key}`, errors)
}

function checkRect(rect: FieldRect, path: Path, errors: string[]): void {
  if (!(rect[0] < rect[2] && rect[1] < rect[3])) errors.push(`${path}: empty rect`)
}

// 상자의 8꼭짓점 집합이 같은지(각 꼭짓점의 최근접이 tol 안)
function sameVertexSet(a: readonly Vec3[], b: readonly Vec3[]): boolean {
  const near = (p: Vec3, set: readonly Vec3[]): boolean =>
    set.some(
      (q) =>
        Math.abs(p.x - q.x) <= SYMMETRY_TOLERANCE &&
        Math.abs(p.y - q.y) <= SYMMETRY_TOLERANCE &&
        Math.abs(p.z - q.z) <= SYMMETRY_TOLERANCE
    )
  return a.every((p) => near(p, b)) && b.every((p) => near(p, a))
}

// carrier 데이터 틀에서 Rz(π)를 왼쪽에서 곱한 상자의 꼭짓점(정확한 부호 반전: 회전 없이 x·y만 바꾼다)
function mirroredVertices(shape: Extract<FieldShape, { kind: 'box' }>): Vec3[] {
  return boxVertices(shape).map(mirrorVec3)
}

// 원기둥(형상·부품)의 Rz(π) 상이 다른 원기둥과 같은지: 중심은 부호 반전, 반지름·높이는 그대로(세운 원기둥은 요가 뜻이 없다)
function sameMirroredCylinder(
  a: { center: Vec3; radius: number; height: number },
  b: { center: Vec3; radius: number; height: number }
): boolean {
  const c = mirrorVec3(a.center)
  return (
    Math.abs(c.x - b.center.x) <= SYMMETRY_TOLERANCE &&
    Math.abs(c.y - b.center.y) <= SYMMETRY_TOLERANCE &&
    Math.abs(c.z - b.center.z) <= SYMMETRY_TOLERANCE &&
    a.radius === b.radius &&
    a.height === b.height
  )
}

// 부품 형상의 Rz(π) 상이 다른 부품 형상과 같은지(6b): 상자·볼록 기둥은 꼭짓점 집합(볼록 다면체는 꼭짓점이 정한다), 원기둥은
// 중심·크기
function sameMirroredPart(original: FieldPartShape, candidate: FieldPartShape): boolean {
  if (original.kind === 'cylinder' || candidate.kind === 'cylinder')
    return (
      original.kind === 'cylinder' &&
      candidate.kind === 'cylinder' &&
      sameMirroredCylinder(original, candidate)
    )
  if (original.kind !== candidate.kind) return false
  if (
    original.kind === 'prism' &&
    candidate.kind === 'prism' &&
    (original.polygon.length !== candidate.polygon.length || original.height !== candidate.height)
  )
    return false
  return sameVertexSet(partVertices(original)!.map(mirrorVec3), partVertices(candidate)!)
}

// 부품 목록의 Rz(π) 짝(6b): 둘 다 없거나, 같은 길이이고 순번마다 쓰임(robots·balls)·이름·형상이 짝이다(mirrorStructure·
// mirrorHive는 순서를 지킨다)
function sameMirroredParts(
  original: readonly FieldPart[] | undefined,
  candidate: readonly FieldPart[] | undefined
): boolean {
  if (original === undefined || candidate === undefined) return original === candidate
  return (
    original.length === candidate.length &&
    original.every((p, i) => {
      const c = candidate[i]
      return (
        p.robots === c.robots &&
        p.balls === c.balls &&
        p.key === c.key &&
        sameMirroredPart(p.shape, c.shape)
      )
    })
  )
}

function sameShape(mirrored: FieldStructure, candidate: FieldStructure): boolean {
  const a = mirrored.shape
  const b = candidate.shape
  if (!sameMirroredParts(mirrored.parts, candidate.parts)) return false
  if (a.kind === 'box' && b.kind === 'box')
    return sameVertexSet(mirroredVertices(a), boxVertices(b))
  if (a.kind === 'cylinder' && b.kind === 'cylinder') return sameMirroredCylinder(a, b)
  return false
}

// 부품 하나의 모양(6b): 크기 양수, 볼록 기둥은 볼록 반시계 다각형(점 셋 이상), 원기둥은 세운 것, 쓰임이 하나 이상, HIVE 몸체 틀
// 부품은 로봇이 쓰지 않는다
function checkPart(part: FieldPart, what: string, carrier: FieldCarrier, errors: string[]): void {
  const shape = part.shape
  if (shape.kind === 'box') {
    if (!(shape.size.x > 0 && shape.size.y > 0 && shape.size.z > 0)) errors.push(`${what}: size`)
  } else if (shape.kind === 'prism') {
    if (!(shape.height > 0)) errors.push(`${what}: size`)
    if (!isConvexCcwPolygon(shape.polygon)) errors.push(`${what}: polygon not convex CCW`)
  } else {
    if (!(shape.radius > 0 && shape.height > 0)) errors.push(`${what}: size`)
    if (shape.rotation.x !== 0 || shape.rotation.y !== 0) errors.push(`${what}: tilted cylinder`)
  }
  if (!part.robots && !part.balls) errors.push(`${what}: unused`)
  if (carrier !== 'field' && part.robots) errors.push(`${what}: robots on carrier ${carrier}`)
}

const sameMaterial = (a: FieldMaterial, b: FieldMaterial): boolean =>
  a.display === b.display &&
  a.nir === b.nir &&
  a.rgb.every((v, i) => v === b.rgb[i]) &&
  (a.optics ?? 'diffuse') === (b.optics ?? 'diffuse')

const sameRectExact = (a: FieldRect, b: FieldRect): boolean => a.every((v, i) => v === b[i])

// 태그 자세(carrier 데이터 틀)의 Rz(π) 상이 다른 태그의 자세와 같은지(태그 틀은 대칭이 없어 행렬이 그대로 같아야 한다)
function sameMirroredTag(tag: FieldTag, candidate: FieldTag): boolean {
  if (candidate.carrier !== mirrorCarrier(tag.carrier) || candidate.size !== tag.size) return false
  const p = mirrorVec3(tag.position)
  if (
    Math.abs(p.x - candidate.position.x) > SYMMETRY_TOLERANCE ||
    Math.abs(p.y - candidate.position.y) > SYMMETRY_TOLERANCE ||
    Math.abs(p.z - candidate.position.z) > SYMMETRY_TOLERANCE
  )
    return false
  const expected = matMul3(ROTATE_PI, rotationMatrix(tag.rotation))
  const actual = rotationMatrix(candidate.rotation)
  return expected.every((v, i) => Math.abs(v - actual[i]) <= SYMMETRY_TOLERANCE)
}

// 프리셋 사각형과 다각형(반시계 볼록)이 1e-6 넘게 겹치는지
function presetOverlaps(rect: FieldRect, polygon: readonly Vec2[]): boolean {
  return polygonSeparation(rectPolygon(rect), polygon) < -OVERLAP_TOLERANCE
}

// 빈 배열이면 통과. 시험이 일부러 깬 판도 잡는다(spec-4ab §1.3 checkFieldSpec).
// 대칭은 표의 짝 대신 형상으로 본다: 모든 요소에 대해 Rz(π) 상이 되는 요소(자기 자신 포함)가 있어야 한다. 그래서 짝 하나를
// 옮기면 그 짝과 원본 둘 다 상대를 잃는다(짝 순번이 §1.4 표와 같은지는 seasons 시험이 따로 확인한다).
export function checkFieldSpec(spec: FieldSpec): string[] {
  const errors: string[] = []
  checkNumbers(spec, 'spec', errors)

  const { perimeter, floor } = spec
  if (!(perimeter.innerHalf > 0 && perimeter.height > 0 && perimeter.thickness > 0))
    errors.push('perimeter: size')
  for (let i = 1; i < floor.seams.length; i++)
    if (!(floor.seams[i - 1] < floor.seams[i])) errors.push(`floor.seams[${i}]: not ascending`)

  spec.tape.forEach((t, i) => checkRect(t.rect, `tape[${i}]`, errors))
  spec.zones.forEach((z, i) => checkRect(z.rect, `zones[${i}]`, errors))
  spec.startKeepOut.forEach((k, i) => checkRect(k.rect, `startKeepOut[${i}]`, errors))

  spec.structures.forEach((s, i) => {
    const what = `structures[${i}]`
    const shape = s.shape
    if (shape.kind === 'box') {
      if (!(shape.size.x > 0 && shape.size.y > 0 && shape.size.z > 0)) errors.push(`${what}: size`)
    } else {
      if (!(shape.radius > 0 && shape.height > 0)) errors.push(`${what}: size`)
      if (shape.rotation.x !== 0 || shape.rotation.y !== 0) errors.push(`${what}: tilted cylinder`)
    }
    if (s.carrier !== 'field' && (s.solid || s.occludes || s.sensed))
      errors.push(`${what}: carrier ${s.carrier} must be display only`)
    // 부품(6b): 모양과 봉투(shape) 안(PART_ENVELOPE_TOLERANCE, 예외 이름은 빼고)
    s.parts?.forEach((part, k) => {
      const partWhat = `${what}.parts[${k}]`
      checkPart(part, partWhat, s.carrier, errors)
      const exempt = part.key !== undefined && PART_ENVELOPE_EXCEPTIONS.has(part.key)
      if (!exempt && !partInsideShape(part.shape, s.shape, PART_ENVELOPE_TOLERANCE))
        errors.push(`${partWhat}: outside envelope`)
    })
  })

  // HIVE(6b): 동역학 값은 양수(축 마찰은 0 이상: 마찰 없는 축), 부품 모양
  spec.hives.forEach((h, i) => {
    const what = `hives[${i}]`
    const d = h.dynamics
    if (d && !(d.massMoment > 0 && d.inertia > 0 && d.pivotFriction >= 0))
      errors.push(`${what}: dynamics`)
    h.parts?.forEach((part, k) => checkPart(part, `${what}.parts[${k}]`, h.key, errors))
  })

  const tagIds = new Set<number>()
  spec.aprilTags.tags.forEach((tag, i) => {
    if (!(tag.size > 0)) errors.push(`aprilTags.tags[${i}]: size`)
    if (tagIds.has(tag.id)) errors.push(`aprilTags.tags[${i}]: duplicate id ${tag.id}`)
    tagIds.add(tag.id)
  })

  // 프리셋: key 유일, 구간 폭 ≥ 18 in, 사각형이 막힌 곳·상대 진영 밖
  const presetKeys = new Set<string>()
  const solids = solidFootprints(spec, PRESET_CHECK_HEIGHT)
  spec.startPresets.forEach((p, i) => {
    const what = `startPresets[${i}]`
    if (presetKeys.has(p.key)) errors.push(`${what}: duplicate key ${p.key}`)
    presetKeys.add(p.key)
    if (!(p.along[1] - p.along[0] >= START_DEPTH)) errors.push(`${what}: along narrower than 18 in`)
    const rect = presetRect(p, perimeter.innerHalf)
    spec.startKeepOut.forEach((k, j) => {
      if (presetOverlaps(rect, rectPolygon(k.rect))) errors.push(`${what}: startKeepOut[${j}]`)
    })
    spec.zones.forEach((z, j) => {
      if (z.key === 'loadingZone' && presetOverlaps(rect, rectPolygon(z.rect)))
        errors.push(`${what}: zones[${j}]`)
    })
    for (const solid of solids) {
      const overlaps =
        solid.kind === 'polygon'
          ? presetOverlaps(rect, solid.points)
          : circlePolygonSeparation(solid.center, solid.radius, rectPolygon(rect)) <
            -OVERLAP_TOLERANCE
      if (overlaps) errors.push(`${what}: structures[${solid.index}]`)
    }
    if (p.alliance === 'red' ? rect[3] > HALF_TOLERANCE : rect[1] < -HALF_TOLERANCE)
      errors.push(`${what}: outside own half`)
  })

  if (spec.elements) checkElements(spec, spec.elements, errors)

  // 대칭(Rz(π), 형상으로 비교)
  spec.structures.forEach((s, i) => {
    const mirroredCarrier = mirrorCarrier(s.carrier)
    const found = spec.structures.some(
      (c) =>
        c.carrier === mirroredCarrier &&
        c.key === s.key &&
        c.solid === s.solid &&
        c.occludes === s.occludes &&
        c.sensed === s.sensed &&
        c.friction === s.friction &&
        sameMaterial(c.material, s.material) &&
        sameShape(s, c)
    )
    if (!found) errors.push(`structures[${i}]: no Rz(pi) counterpart`)
  })
  const mirroredCluster = (cluster: string | null): string | null =>
    cluster === null ? null : (CLUSTER_MIRROR[cluster] ?? cluster)
  spec.aprilTags.tags.forEach((tag, i) => {
    const found = spec.aprilTags.tags.some(
      (c) => sameMirroredTag(tag, c) && c.cluster === mirroredCluster(tag.cluster)
    )
    if (!found) errors.push(`aprilTags.tags[${i}]: no Rz(pi) counterpart`)
  })
  const swap = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red')
  spec.tape.forEach((t, i) => {
    const r = mirrorRect(t.rect)
    if (
      !spec.tape.some(
        (c) =>
          c.key === t.key &&
          c.alliance === swap(t.alliance) &&
          c.offField === t.offField &&
          sameRectExact(c.rect, r)
      )
    )
      errors.push(`tape[${i}]: no Rz(pi) counterpart`)
  })
  spec.zones.forEach((z, i) => {
    const r = mirrorRect(z.rect)
    if (
      !spec.zones.some(
        (c) => c.key === z.key && c.alliance === swap(z.alliance) && sameRectExact(c.rect, r)
      )
    )
      errors.push(`zones[${i}]: no Rz(pi) counterpart`)
  })
  spec.startKeepOut.forEach((k, i) => {
    const r = mirrorRect(k.rect)
    if (!spec.startKeepOut.some((c) => sameRectExact(c.rect, r)))
      errors.push(`startKeepOut[${i}]: no Rz(pi) counterpart`)
  })
  spec.hives.forEach((h, i) => {
    const m = mirrorHive(h)
    if (!spec.hives.some((c) => sameHive(m, c) && sameMirroredParts(h.parts, c.parts)))
      errors.push(`hives[${i}]: no Rz(pi) counterpart`)
  })
  spec.startPresets.forEach((p, i) => {
    const found = spec.startPresets.some((c) => {
      const m = mirrorPreset(p, c.key)
      return (
        c.alliance === m.alliance &&
        c.wall === m.wall &&
        c.along[0] === m.along[0] &&
        c.along[1] === m.along[1] &&
        c.yaw === m.yaw
      )
    })
    if (!found) errors.push(`startPresets[${i}]: no Rz(pi) counterpart`)
  })
  return errors
}

// 경기 요소 배치 허용(m): 벽·서로·바닥에 닿게 놓은 공은 반올림만큼만 겹친다
const ELEMENT_TOLERANCE = 1e-9
// 속이 찬 구(0.4·m·r²)와 얇은 껍질(2/3·m·r²) 사이여야 한다
const SOLID_SPHERE_INERTIA = 0.4
const THIN_SHELL_INERTIA = 2 / 3

// 경기 요소(6a, spec-6a §4; 6b 묶음별, spec-6b §1.2): 종류는 kind 유일·값 범위. 배치는 아는 종류이고 Rz(π) 짝이 있으며(같은
// 묶음·when, 상대 carrier, 색 있는 종류는 상대 색), 같은 틀(필드, 또는 같은 carrier·when의 HIVE 몸체 틀)의 공끼리 겹치지 않는다.
// 묶음마다:
// - garden: 바닥에 놓이고(z = r) 필드 안이며 벽·구조물(carrier field이고 solid ∨ occludes: 공이 부딪히는 것, collision3d.ts
//   staticShapes와 같은 집합)·시작 프리셋 사각형과 겹치지 않는다
// - flower: 필드 안, 한 FLOWER 봉투 안(공 통째로)이고 그 FLOWER의 공 부품과 겹치지 않으며 다른 구조물·시작 프리셋과도 겹치지
//   않는다. FLOWER마다 가장 낮은 공은 바닥에 놓이고(z = r) 나머지는 바로 아래 공에 닿는다(중심 거리 r + r′)
// - hiveCell: carrier·when이 있고, 그 HIVE 몸체 틀에서 공 부품(CELL 트레이·HIVE 부품)과 겹치지 않으며 CELL 밑판
//   (CELL_FLOOR_PART_KEY)과 Back Skin(CELL_BACK_SKIN_PART_KEY)에 닿는다
// carrier·when은 hiveCell만 쓴다
function checkElements(spec: FieldSpec, elements: FieldElements, errors: string[]): void {
  const kinds = new Set<string>()
  elements.types.forEach((t, i) => {
    const what = `elements.types[${i}]`
    if (kinds.has(t.kind)) errors.push(`${what}: duplicate kind ${t.kind}`)
    kinds.add(t.kind)
    if (!(t.radius > 0 && t.mass > 0)) errors.push(`${what}: size`)
    const solid = SOLID_SPHERE_INERTIA * t.mass * t.radius * t.radius
    const shell = THIN_SHELL_INERTIA * t.mass * t.radius * t.radius
    if (!(t.inertia >= solid && t.inertia <= shell)) errors.push(`${what}: inertia`)
    const c = t.contact
    if (!(c.plateStiffness > 0)) errors.push(`${what}: plateStiffness`)
    if (!(c.coreDepthRatio > 0 && c.coreDepthRatio < 1)) errors.push(`${what}: coreDepthRatio`)
    if (!(c.friction >= 0 && c.rollingResistance >= 0 && c.spinRadius >= 0))
      errors.push(`${what}: friction`)
    const e = c.restitution
    if (![e.floor, e.hard, e.element, e.robot].every((v) => v >= 0 && v <= 1))
      errors.push(`${what}: restitution`)
    const a = t.air
    if (!(a.dragCoefficient >= 0 && a.magnusSlope >= 0 && a.magnusMax >= 0))
      errors.push(`${what}: air`)
    const mirrored = elements.types.find((u) => u.kind === mirrorElementKind(t.kind))
    if (!mirrored || mirrored.radius !== t.radius || mirrored.mass !== t.mass)
      errors.push(`${what}: no Rz(pi) counterpart`)
  })

  const { innerHalf } = spec.perimeter
  const radiusOf = (kind: string): number | null =>
    elements.types.find((t) => t.kind === kind)?.radius ?? null
  const insideField = (c: Vec3, r: number): boolean =>
    Math.abs(c.x) + r <= innerHalf + ELEMENT_TOLERANCE &&
    Math.abs(c.y) + r <= innerHalf + ELEMENT_TOLERANCE
  // 공이 부딪히는 필드 구조물(collision3d.ts staticShapes와 같은 집합)과 겹치는지. skip: 그 순번은 보지 않는다(자기 FLOWER)
  const structureOverlaps = (c: Vec3, r: number, what: string, skip: number): void =>
    spec.structures.forEach((s, i) => {
      if (i === skip || s.carrier !== 'field' || !(s.solid || s.occludes)) return
      if (sphereShapeSeparation(c, r, s.shape) < -ELEMENT_TOLERANCE)
        errors.push(`${what}: structures[${i}]`)
    })
  const presetOverlapsBall = (c: Vec3, r: number, what: string): void =>
    spec.startPresets.forEach((preset, i) => {
      const rect = presetRect(preset, innerHalf)
      if (circlePolygonSeparation(c, r, rectPolygon(rect)) < -OVERLAP_TOLERANCE)
        errors.push(`startPresets[${i}]: ${what}`)
    })
  // FLOWER 순번 → 그 안의 공(배치 순번, 반지름)
  const flowerBalls = new Map<number, { index: number; r: number }[]>()

  elements.layout.forEach((p, j) => {
    const what = `elements.layout[${j}]`
    const r = radiusOf(p.kind)
    if (r === null) {
      errors.push(`${what}: unknown kind ${p.kind}`)
      return
    }
    const c = p.position
    if (p.group === 'hiveCell') {
      if (p.carrier === undefined || p.when === undefined)
        errors.push(`${what}: hiveCell needs carrier and when`)
    } else if (p.carrier !== undefined || p.when !== undefined) errors.push(`${what}: carrier`)
    if (p.carrier !== undefined && !spec.hives.some((h) => h.key === p.carrier))
      errors.push(`${what}: unknown carrier ${p.carrier}`)

    if (p.group === 'garden') {
      if (!(Math.abs(c.z - r) <= ELEMENT_TOLERANCE)) errors.push(`${what}: not resting on floor`)
      if (!insideField(c, r)) errors.push(`${what}: outside field`)
      structureOverlaps(c, r, what, -1)
      presetOverlapsBall(c, r, what)
    } else if (p.group === 'flower') {
      if (!insideField(c, r)) errors.push(`${what}: outside field`)
      const flower = spec.structures.findIndex(
        (s) =>
          s.key === 'flower' &&
          s.carrier === 'field' &&
          sphereInsideShape(c, r, s.shape, ELEMENT_TOLERANCE)
      )
      if (flower < 0) errors.push(`${what}: not inside a FLOWER`)
      else {
        spec.structures[flower].parts?.forEach((part, k) => {
          if (part.balls && spherePartSeparation(c, r, part.shape) < -ELEMENT_TOLERANCE)
            errors.push(`${what}: structures[${flower}].parts[${k}]`)
        })
        const list = flowerBalls.get(flower) ?? []
        list.push({ index: j, r })
        flowerBalls.set(flower, list)
      }
      structureOverlaps(c, r, what, flower)
      presetOverlapsBall(c, r, what)
    } else if (p.carrier !== undefined) {
      // hiveCell: 그 HIVE 몸체 틀의 공 부품(CELL 트레이와 HIVE 부품)
      let floor = false
      let backSkin = false
      const check = (part: FieldPart, where: string): void => {
        if (!part.balls) return
        const gap = spherePartSeparation(c, r, part.shape)
        if (gap < -ELEMENT_TOLERANCE) errors.push(`${what}: ${where}`)
        if (Math.abs(gap) <= ELEMENT_TOLERANCE) {
          if (part.key === CELL_FLOOR_PART_KEY) floor = true
          if (part.key === CELL_BACK_SKIN_PART_KEY) backSkin = true
        }
      }
      spec.structures.forEach((s, i) => {
        if (s.carrier === p.carrier)
          s.parts?.forEach((part, k) => check(part, `structures[${i}].parts[${k}]`))
      })
      spec.hives.forEach((h, i) => {
        if (h.key === p.carrier)
          h.parts?.forEach((part, k) => check(part, `hives[${i}].parts[${k}]`))
      })
      if (!floor) errors.push(`${what}: not resting on a CELL floor`)
      if (!backSkin) errors.push(`${what}: not against a CELL Back Skin`)
    }

    // 같은 틀의 공끼리(필드 좌표끼리, 같은 carrier·when의 몸체 틀끼리)
    for (let k = j + 1; k < elements.layout.length; k++) {
      const q = elements.layout[k]
      const rq = radiusOf(q.kind)
      if (rq === null || q.carrier !== p.carrier || q.when !== p.when) continue
      const gap = Math.hypot(q.position.x - c.x, q.position.y - c.y, q.position.z - c.z) - r - rq
      if (gap < -ELEMENT_TOLERANCE) errors.push(`${what}: elements.layout[${k}]`)
    }

    const m = mirrorVec3(c)
    const mirroredCarrier = p.carrier === undefined ? undefined : mirrorCarrier(p.carrier)
    const found = elements.layout.some(
      (q) =>
        q.group === p.group &&
        q.kind === mirrorElementKind(p.kind) &&
        q.carrier === mirroredCarrier &&
        q.when === p.when &&
        Math.abs(q.position.x - m.x) <= SYMMETRY_TOLERANCE &&
        Math.abs(q.position.y - m.y) <= SYMMETRY_TOLERANCE &&
        Math.abs(q.position.z - m.z) <= SYMMETRY_TOLERANCE
    )
    if (!found) errors.push(`${what}: no Rz(pi) counterpart`)
  })

  // FLOWER 기둥: 가장 낮은 공은 바닥에, 나머지는 바로 아래 공에 닿는다(높이 순, 같은 높이는 배치 순서)
  for (const list of flowerBalls.values()) {
    const sorted = [...list].sort(
      (a, b) =>
        elements.layout[a.index].position.z - elements.layout[b.index].position.z ||
        a.index - b.index
    )
    sorted.forEach((ball, n) => {
      const what = `elements.layout[${ball.index}]`
      const c = elements.layout[ball.index].position
      if (n === 0) {
        if (!(Math.abs(c.z - ball.r) <= ELEMENT_TOLERANCE))
          errors.push(`${what}: not resting on floor`)
        return
      }
      const below = sorted[n - 1]
      const b = elements.layout[below.index].position
      const distance = Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z)
      if (!(Math.abs(distance - (ball.r + below.r)) <= ELEMENT_TOLERANCE))
        errors.push(`${what}: not touching the ball below`)
    })
  }
}

// SDK 묶음 이름의 Rz(π) 짝(빨강 득점 ↔ 파랑 관중석)
const CLUSTER_MIRROR: Record<string, string> = {
  'RED SCORING': 'BLUE AUDIENCE',
  'RED AUDIENCE': 'BLUE SCORING',
  'BLUE AUDIENCE': 'RED SCORING',
  'BLUE SCORING': 'RED AUDIENCE'
}

// a: Rz(π) 상(mirrorHive), b: 후보. 부품은 원본으로 따로 비교한다(sameMirroredParts)
function sameHive(a: FieldHive, b: FieldHive): boolean {
  const da = a.dynamics
  const db = b.dynamics
  return (
    a.key === b.key &&
    a.pivot.x === b.pivot.x &&
    a.pivot.y === b.pivot.y &&
    a.pivot.z === b.pivot.z &&
    a.startAngle === b.startAngle &&
    a.tippedAngle === b.tippedAngle &&
    (da === undefined || db === undefined
      ? da === db
      : da.massMoment === db.massMoment &&
        da.inertia === db.inertia &&
        da.pivotFriction === db.pivotFriction)
  )
}
