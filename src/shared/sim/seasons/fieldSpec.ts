import type { Vec2, Vec3 } from '../worldSpec'
import {
  boxVertices,
  circlePolygonSeparation,
  matMul3,
  OVERLAP_TOLERANCE,
  polygonSeparation,
  rectPolygon,
  rotationMatrix,
  solidFootprints
} from './fieldGeometry'
import { presetRect, START_DEPTH } from './startPose'
import {
  mirrorCarrier,
  mirrorHive,
  mirrorPreset,
  mirrorRect,
  mirrorVec3,
  ROTATE_PI
} from './symmetry'

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

export type FieldStructureKey = 'footBar' | 'leg' | 'topBar' | 'logoPlate' | 'flower' | 'hiveCell'

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
  key: 'hiveRed' | 'hiveBlue'
  // 필드 좌표
  pivot: Vec3
  // +Y축 둘레 오른손 각(rad). 0 = 몸체 틀이 필드 축과 나란함
  startAngle: number
  tippedAngle: number
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
}

// 깊게 얼린 같은 값(시즌 모듈 상수). 시험이 바꾼 판이 필요하면 얕은 복사를 쓴다(spec-4ab §1.3).
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
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

function sameShape(mirrored: FieldStructure, candidate: FieldStructure): boolean {
  const a = mirrored.shape
  const b = candidate.shape
  if (a.kind === 'box' && b.kind === 'box')
    return sameVertexSet(mirroredVertices(a), boxVertices(b))
  if (a.kind === 'cylinder' && b.kind === 'cylinder') {
    const c = mirrorVec3(a.center)
    return (
      Math.abs(c.x - b.center.x) <= SYMMETRY_TOLERANCE &&
      Math.abs(c.y - b.center.y) <= SYMMETRY_TOLERANCE &&
      Math.abs(c.z - b.center.z) <= SYMMETRY_TOLERANCE &&
      a.radius === b.radius &&
      a.height === b.height
    )
  }
  return false
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
    if (!spec.hives.some((c) => sameHive(m, c))) errors.push(`hives[${i}]: no Rz(pi) counterpart`)
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

// SDK 묶음 이름의 Rz(π) 짝(빨강 득점 ↔ 파랑 관중석)
const CLUSTER_MIRROR: Record<string, string> = {
  'RED SCORING': 'BLUE AUDIENCE',
  'RED AUDIENCE': 'BLUE SCORING',
  'BLUE AUDIENCE': 'RED SCORING',
  'BLUE SCORING': 'RED AUDIENCE'
}

function sameHive(a: FieldHive, b: FieldHive): boolean {
  return (
    a.key === b.key &&
    a.pivot.x === b.pivot.x &&
    a.pivot.y === b.pivot.y &&
    a.pivot.z === b.pivot.z &&
    a.startAngle === b.startAngle &&
    a.tippedAngle === b.tippedAngle
  )
}
