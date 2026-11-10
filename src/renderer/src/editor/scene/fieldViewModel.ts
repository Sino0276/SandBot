import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type {
  Alliance,
  FieldCarrier,
  FieldRect,
  FieldSpec,
  FieldWallName,
  SeasonId
} from '../../../../shared/sim/seasons/fieldSpec'
import { presetRect } from '../../../../shared/sim/seasons/startPose'
import type { Vec3 } from '../../../../shared/sim/worldSpec'

// 씬 뷰의 시즌 필드 메시 목록(spec-4ab §1.9, 순수 함수, 씬 문서 밖). FieldView.tsx가 이것을 그대로 그린다. 시즌 데이터(m·rad,
// 필드 좌표 = 원점 중앙 타일 윗면, Z 위)에서 변환·재질 키·renderOrder를 정한다. 계산·접촉과 관계없는 표시만이다.

// ---- 그리는 순서 ----
// 카메라 near 0.01·far 200(ScenePanel)이라 24비트 깊이 분해능이 15 m에서 약 1.3 mm다. 바닥 위 납작한 겹 요소(이음선·테이프·
// 시작 표시·벽 라벨)는 Z 차이에 기대지 않고 depthWrite false + polygonOffset + renderOrder로 그린다(Z 차이는 보조).
// 반투명(벽 판 < HIVE CELL)은 고정 순서이고, 실행 잔상(SceneObjectsView)은 그 뒤에 그려 벽 판·CELL 뒤에서도 보인다.
export const FIELD_RENDER_ORDER = {
  floor: 0,
  // 이음선·테이프
  overlay: 1,
  // 시작 표시(프리셋 순번 × 0.01을 더한다: 모서리에서 겹치는 사각형이 깜빡이지 않게)
  startMarker: 2,
  // 벽 라벨(바닥 밖, 시작 표시와 겹치지 않는다)
  wallLabel: 2,
  wallPanel: 3,
  hiveCell: 4,
  ghost: 5,
  // 필드 CAD 위에 겹치는 단순 형상 충돌체 윤곽선(spec-4e §1.8, 잔상 뒤·씬 뷰 기즈모 앞)
  colliderOutline: 6
} as const
// 시작 표시 순번마다 더하는 renderOrder
export const START_MARKER_ORDER_STEP = 0.01

// polygonOffset units(factor는 늘 −1): 이음선·테이프 −1, 시작 표시·라벨 −2, 태그(CELL 면 위) −1
export const POLYGON_OFFSET_UNITS = {
  overlay: -1,
  startMarker: -2,
  wallLabel: -2,
  tag: -1
} as const

// ---- 표시용 치수 [가정: 표시만, 계산과 무관] ----
// 바닥 위 겹 요소의 보조 높이(m): 이음선·테이프 0.3 mm, 시작 표시 0.6 mm
const OVERLAY_LIFT = 0.0003
export const START_MARKER_LIFT = 0.0006
// 타일 이음선 폭(m): 타일 톱니 띠(CAD 0.81 in)는 그리지 않고 가는 선으로만 보인다
const SEAM_WIDTH = 0.003
// 태그를 앞면 쪽으로 띄우는 거리(m, spec-4ab §1.9)
export const TAG_FRONT_OFFSET = 0.0005
// 필드 CAD와 함께 그릴 때 태그를 앞면 쪽으로 띄우는 거리(m, spec-4e §1.6) [가정: 표시만]. 공식 CAD의 태그 스티커(두께 약
// 0.254 mm)와 4ab 태그 참값(허용 0.508 mm)의 평면이 스티커 어디인지 몰라 0.5 mm로는 최악이면 스티커 앞면과 같은 평면이다.
// 3.25 in 태그에서 1.5 mm의 시차는 무시할 만하다.
export const CAD_TAG_FRONT_OFFSET = 0.0015
// 흰 고리를 포함한 태그 전체 변 = 1.25 × 검은 테두리 변(tag36h11 10칸 / 8칸)
export const TAG_TOTAL_SCALE = 1.25
// 벽 라벨 크기(m)와 벽 바깥 면에서 띄우는 거리
export const WALL_LABEL_WIDTH = 0.9
export const WALL_LABEL_HEIGHT = 0.15
const WALL_LABEL_GAP = 0.03
// 필드 밖 바닥 높이(m): 필드 밖 테이프(CAD Z −0.01496 = 아래 레일 띠 바닥)와 같은 바닥
export const OFF_FIELD_Z = -0.01496
// 라벨은 그 바닥 위 1 mm
const WALL_LABEL_Z = OFF_FIELD_Z + 0.001
// 반투명 정도 [가정: 표시만]: 벽 판, HIVE CELL, 시작 표시(보통·흐림)
const PANEL_OPACITY = 0.25
const HIVE_CELL_OPACITY = 0.45
export const START_MARKER_OPACITY = 0.32
export const START_MARKER_DIMMED_OPACITY = 0.1
// 판 이음 기둥·이음선 색 [가정: 표시만]
const SEAM_COLOR = '#4a4a4a'
// 시작 표시의 얼라이언스 색(테이프 표시 색과 같은 계열)
export const ALLIANCE_COLOR: Record<Alliance, string> = { red: '#c62828', blue: '#1565c0' }

export type FieldMaterialSpec = {
  color: string
  // 1이면 불투명
  opacity: number
  transparent: boolean
  depthWrite: boolean
  // polygonOffset units(0이면 끔, factor는 −1)
  polygonOffsetUnits: number
}

export type FieldGeometrySpec =
  | { kind: 'plane'; width: number; height: number }
  | { kind: 'box'; size: Vec3 }
  // 자기 z가 축(Three.js CylinderGeometry는 y축이라 matrix가 돌린다)
  | { kind: 'cylinder'; radius: number; height: number }

export type FieldMeshRole =
  'floor' | 'seam' | 'tape' | 'rail' | 'panel' | 'panelSeam' | 'structure' | 'tag' | 'wallLabel'

export type FieldMeshSpec = {
  key: string
  role: FieldMeshRole
  // 놓이는 틀: 'field'는 필드 좌표, HIVE는 그 carrier 그룹 안
  carrier: FieldCarrier
  geometry: FieldGeometrySpec
  // carrier 틀에서의 변환(Three.js Matrix4.elements, 열 우선)
  matrix: number[]
  material: FieldMaterialSpec
  renderOrder: number
  // role 'tag'면 태그 id(텍스처), 'wallLabel'이면 벽 이름(i18n field.walls.<값>), 'structure'면 순번
  tagId?: number
  wall?: FieldWallName
  structureIndex?: number
}

// HIVE carrier 그룹: 위치 pivot, 회전 R_y(angle)
export type FieldCarrierSpec = { key: 'hiveRed' | 'hiveBlue'; pivot: Vec3; angle: number }

export type FieldViewModel = { carriers: FieldCarrierSpec[]; meshes: FieldMeshSpec[] }

// 'none'(공칭 12 ft 근사)은 지금 FieldFloor를 그대로 그리고, 시즌 필드만 FieldView 메시다
export function usesNominalFloor(season: SeasonId): boolean {
  return season === 'none'
}

const opaque = (color: string): FieldMaterialSpec => ({
  color,
  opacity: 1,
  transparent: false,
  depthWrite: true,
  polygonOffsetUnits: 0
})

const translucent = (color: string, opacity: number): FieldMaterialSpec => ({
  color,
  opacity,
  transparent: true,
  depthWrite: false,
  polygonOffsetUnits: 0
})

// 바닥 위 납작한 겹 요소(깊이를 쓰지 않음)
const overlay = (color: string, units: number, opacity = 1): FieldMaterialSpec => ({
  color,
  opacity,
  transparent: opacity < 1,
  depthWrite: false,
  polygonOffsetUnits: units
})

function compose(position: Vec3, rotation: Vec3 = { x: 0, y: 0, z: 0 }): Matrix4 {
  return new Matrix4().compose(
    new Vector3(position.x, position.y, position.z),
    new Quaternion().setFromEuler(new Euler(rotation.x, rotation.y, rotation.z, 'ZYX')),
    new Vector3(1, 1, 1)
  )
}

// 벽 라벨 재질: 바닥 위 겹 요소이고, 글자 밖은 투명한 텍스처라 늘 transparent
export const WALL_LABEL_MATERIAL: FieldMaterialSpec = Object.freeze({
  ...overlay('#ffffff', POLYGON_OFFSET_UNITS.wallLabel),
  transparent: true
})

const elements = (matrix: Matrix4): number[] => [...matrix.elements]

// 축 정렬 사각형을 바닥(Z = z) 평면으로
function rectPlane(rect: FieldRect, z: number): { geometry: FieldGeometrySpec; matrix: number[] } {
  const [x0, y0, x1, y1] = rect
  return {
    geometry: { kind: 'plane', width: x1 - x0, height: y1 - y0 },
    matrix: elements(compose({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z }))
  }
}

type WallSide = { name: 'plusX' | 'minusX' | 'plusY' | 'minusY'; normal: { x: number; y: number } }
const WALL_SIDES: readonly WallSide[] = [
  { name: 'plusX', normal: { x: 1, y: 0 } },
  { name: 'minusX', normal: { x: -1, y: 0 } },
  { name: 'plusY', normal: { x: 0, y: 1 } },
  { name: 'minusY', normal: { x: 0, y: -1 } }
]

// 벽 하나의 띠(Z 구간 [z0, z1], 벽 방향 [a0, a1], 바깥으로 [d0, d1]) 상자
function wallBox(
  side: WallSide,
  along: [number, number],
  out: [number, number],
  z: [number, number]
): { geometry: FieldGeometrySpec; matrix: number[] } {
  const alongLength = along[1] - along[0]
  const depth = out[1] - out[0]
  const alongCenter = (along[0] + along[1]) / 2
  const outCenter = (out[0] + out[1]) / 2
  const xWall = side.normal.x !== 0
  const position: Vec3 = xWall
    ? { x: side.normal.x * outCenter, y: alongCenter, z: (z[0] + z[1]) / 2 }
    : { x: alongCenter, y: side.normal.y * outCenter, z: (z[0] + z[1]) / 2 }
  const size: Vec3 = xWall
    ? { x: depth, y: alongLength, z: z[1] - z[0] }
    : { x: alongLength, y: depth, z: z[1] - z[0] }
  return { geometry: { kind: 'box', size }, matrix: elements(compose(position)) }
}

// 벽 라벨 평면의 회전: 글자 위(평면 +y)가 바깥 법선, 글자 오른쪽(평면 +x) = 위 × 바닥 법선. 바닥에서 위로 본다(평면 +z = 필드 +Z).
export function wallLabelYaw(normal: { x: number; y: number }): number {
  return Math.atan2(normal.y, normal.x) - Math.PI / 2
}

function hiveIndex(key: 'hiveRed' | 'hiveBlue'): 0 | 1 {
  return key === 'hiveRed' ? 0 : 1
}

// 시즌 필드 메시 목록. elementsHidden(필드 요소 숨김·고립 보기)이면 구조물·HIVE·태그·벽 라벨을 빼고 바닥·벽·테이프만 남긴다.
// hiveTipped는 [빨강, 파랑] HIVE가 넘어간 상태인지다.
export function fieldViewModel(
  spec: FieldSpec,
  hiveTipped: readonly [boolean, boolean],
  elementsHidden: boolean
): FieldViewModel {
  const meshes: FieldMeshSpec[] = []
  const { innerHalf, thickness, railBands, panelSeams, panelInset } = spec.perimeter

  // 바닥: 벽 안쪽(레일 안쪽 면까지). 필드 밖 바닥 판은 그리지 않는다
  meshes.push({
    key: 'floor',
    role: 'floor',
    carrier: 'field',
    ...rectPlane([-innerHalf, -innerHalf, innerHalf, innerHalf], 0),
    material: opaque(spec.floor.material.display),
    renderOrder: FIELD_RENDER_ORDER.floor
  })

  // 타일 이음선(X·Y 같은 좌표)
  spec.floor.seams.forEach((c, index) => {
    const half = SEAM_WIDTH / 2
    const lines: [string, FieldRect][] = [
      [`seamX${index}`, [c - half, -innerHalf, c + half, innerHalf]],
      [`seamY${index}`, [-innerHalf, c - half, innerHalf, c + half]]
    ]
    for (const [key, rect] of lines)
      meshes.push({
        key,
        role: 'seam',
        carrier: 'field',
        ...rectPlane(rect, OVERLAY_LIFT),
        material: overlay(SEAM_COLOR, POLYGON_OFFSET_UNITS.overlay),
        renderOrder: FIELD_RENDER_ORDER.overlay
      })
  })

  // 테이프(필드 밖 ALLIANCE AREA는 필드 밖 바닥 높이)
  spec.tape.forEach((tape, index) => {
    meshes.push({
      key: `tape${index}`,
      role: 'tape',
      carrier: 'field',
      ...rectPlane(tape.rect, (tape.offField ? OFF_FIELD_Z : 0) + OVERLAY_LIFT),
      material: overlay(tape.material.display, POLYGON_OFFSET_UNITS.overlay),
      renderOrder: FIELD_RENDER_ORDER.overlay
    })
  })

  // 벽: 레일 띠는 불투명, 띠 사이는 판 이음(레일 끝)으로 나눈 반투명 판. 두께는 레일 안쪽 면에서 바깥으로 thickness.
  // ±X 벽은 모서리까지, ±Y 벽은 그 사이만(모서리 상자가 겹치지 않게)
  const outer = innerHalf + thickness
  const panelZ: [number, number] = [railBands[0][1], railBands[railBands.length - 1][0]]
  for (const side of WALL_SIDES) {
    const xWall = side.normal.x !== 0
    const span: [number, number] = xWall ? [-outer, outer] : [-innerHalf, innerHalf]
    railBands.forEach((band, index) => {
      meshes.push({
        key: `rail.${side.name}.${index}`,
        role: 'rail',
        carrier: 'field',
        ...wallBox(side, span, [innerHalf, outer], band),
        material: opaque(spec.perimeter.rail.display),
        renderOrder: FIELD_RENDER_ORDER.floor
      })
    })
    // 판 구간: 이음 사이(이음은 레일 색 기둥)
    const cuts = [span[0], ...panelSeams.flat(), span[1]]
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      if (!(cuts[k + 1] > cuts[k])) continue
      meshes.push({
        key: `panel.${side.name}.${k / 2}`,
        role: 'panel',
        carrier: 'field',
        ...wallBox(side, [cuts[k], cuts[k + 1]], [innerHalf + panelInset, outer], panelZ),
        material: translucent(spec.perimeter.panel.display, PANEL_OPACITY),
        renderOrder: FIELD_RENDER_ORDER.wallPanel
      })
    }
    panelSeams.forEach((seam, index) => {
      meshes.push({
        key: `panelSeam.${side.name}.${index}`,
        role: 'panelSeam',
        carrier: 'field',
        ...wallBox(side, seam, [innerHalf, outer], panelZ),
        material: opaque(spec.perimeter.rail.display),
        renderOrder: FIELD_RENDER_ORDER.floor
      })
    })
  }

  const carriers: FieldCarrierSpec[] = []
  if (!elementsHidden) {
    for (const hive of spec.hives)
      carriers.push({
        key: hive.key,
        pivot: hive.pivot,
        angle: hiveTipped[hiveIndex(hive.key)] ? hive.tippedAngle : hive.startAngle
      })

    // 구조물: 모양 그대로(ZYX). HIVE CELL은 반투명
    spec.structures.forEach((structure, index) => {
      const { shape } = structure
      const cell = structure.key === 'hiveCell'
      const material = cell
        ? translucent(structure.material.display, HIVE_CELL_OPACITY)
        : opaque(structure.material.display)
      const renderOrder = cell ? FIELD_RENDER_ORDER.hiveCell : FIELD_RENDER_ORDER.floor
      let geometry: FieldGeometrySpec
      let matrix = compose(shape.center, shape.rotation)
      if (shape.kind === 'box') geometry = { kind: 'box', size: shape.size }
      else {
        geometry = { kind: 'cylinder', radius: shape.radius, height: shape.height }
        // CylinderGeometry의 축(y)을 자기 z로
        matrix = matrix.multiply(new Matrix4().makeRotationX(Math.PI / 2))
      }
      meshes.push({
        key: `structure${index}`,
        role: 'structure',
        carrier: structure.carrier,
        geometry,
        matrix: elements(matrix),
        material,
        renderOrder,
        structureIndex: index
      })
    })

    // AprilTag: 흰 고리 포함 1.25·size 정사각형. 평면의 +x = 태그 +x, 평면 +y = 태그 −y(텍스처 위 행 = 태그 −y),
    // 평면 +z(앞면 법선) = 태그 −z. 태그 틀 → 평면 = Rx(π), 앞면 쪽으로 TAG_FRONT_OFFSET 띄운다
    for (const tag of spec.aprilTags.tags) {
      const side = tag.size * TAG_TOTAL_SCALE
      const matrix = compose(tag.position, tag.rotation)
        .multiply(new Matrix4().makeRotationX(Math.PI))
        .multiply(new Matrix4().makeTranslation(0, 0, TAG_FRONT_OFFSET))
      meshes.push({
        key: `tag${tag.id}`,
        role: 'tag',
        carrier: tag.carrier,
        geometry: { kind: 'plane', width: side, height: side },
        matrix: elements(matrix),
        material: { ...opaque('#ffffff'), polygonOffsetUnits: POLYGON_OFFSET_UNITS.tag },
        renderOrder: FIELD_RENDER_ORDER.floor,
        tagId: tag.id
      })
    }

    // 벽 라벨: 벽 바깥 바닥, 글자 아래가 필드 쪽
    if (spec.walls) {
      const distance = outer + WALL_LABEL_GAP + WALL_LABEL_HEIGHT / 2
      for (const side of WALL_SIDES) {
        const position: Vec3 = {
          x: side.normal.x * distance,
          y: side.normal.y * distance,
          z: WALL_LABEL_Z
        }
        meshes.push({
          key: `wallLabel.${side.name}`,
          role: 'wallLabel',
          carrier: 'field',
          geometry: { kind: 'plane', width: WALL_LABEL_WIDTH, height: WALL_LABEL_HEIGHT },
          matrix: elements(compose(position, { x: 0, y: 0, z: wallLabelYaw(side.normal) })),
          material: WALL_LABEL_MATERIAL,
          renderOrder: FIELD_RENDER_ORDER.wallLabel,
          wall: spec.walls[side.name]
        })
      }
    }
  }

  return { carriers, meshes }
}

// ---- 필드 CAD와 함께 그리는 단순 형상(spec-4e §1.6·§1.8) ----

// CAD와 함께 그리는 단순 형상(companion): 태그(앞면 쪽으로 CAD_TAG_FRONT_OFFSET, 새 사본)·벽 라벨, 그리고 넘어간 HIVE의
// carrier 구조물(HIVE CELL. CAD의 HIVE는 시작 상태라 넘어간 자리를 보인다). 나머지(바닥·이음선·테이프·벽·구조물·시작 상태
// CELL)는 CAD가 그리므로 뺀다. 순서는 model.meshes 순서, carriers는 입력 그대로다. hiveTipped는 model을 만들 때 넘긴 값과
// 같아야 한다(모델에는 넘어감 여부가 각으로만 있다).
export function fieldCompanionModel(
  model: FieldViewModel,
  hiveTipped: readonly [boolean, boolean]
): FieldViewModel {
  // 태그 평면 +z(앞면 법선)로 더 옮기는 거리
  const lift = new Matrix4().makeTranslation(0, 0, CAD_TAG_FRONT_OFFSET - TAG_FRONT_OFFSET)
  const meshes: FieldMeshSpec[] = []
  for (const mesh of model.meshes) {
    if (mesh.role === 'tag')
      meshes.push({
        ...mesh,
        matrix: elements(new Matrix4().fromArray(mesh.matrix).multiply(lift))
      })
    else if (mesh.role === 'wallLabel') meshes.push(mesh)
    else if (
      mesh.role === 'structure' &&
      mesh.carrier !== 'field' &&
      hiveTipped[hiveIndex(mesh.carrier)]
    )
      meshes.push(mesh)
  }
  return { carriers: model.carriers, meshes }
}

// 충돌체 윤곽으로 그릴 단순 형상(spec-4e §1.8, Unity 충돌체 기즈모): fieldViewModel(spec, hiveTipped, false)의 바닥·테이프·
// 레일·판·판 이음과, 시뮬레이터가 계산에 쓰는 구조물(solid ∨ sensed ∨ occludes). 이음선·태그·벽 라벨·표시 전용 구조물
// (HIVE CELL)은 뺀다(막거나 가린다고 오해하지 않게). carriers는 남은 메시가 쓰는 것만 둔다(BIOBUZZ에는 남는 HIVE 구조물이
// 없어 비어 있다). 순서는 model.meshes 순서다.
const OUTLINE_ROLES: ReadonlySet<FieldMeshRole> = new Set([
  'floor',
  'tape',
  'rail',
  'panel',
  'panelSeam'
])

export function fieldOutlineMeshes(model: FieldViewModel, spec: FieldSpec): FieldViewModel {
  const meshes = model.meshes.filter((mesh) => {
    if (OUTLINE_ROLES.has(mesh.role)) return true
    if (mesh.role !== 'structure' || mesh.structureIndex === undefined) return false
    const structure = spec.structures[mesh.structureIndex]
    return !!structure && (structure.solid || structure.sensed || structure.occludes)
  })
  const used = new Set(meshes.map((mesh) => mesh.carrier))
  return { carriers: model.carriers.filter((carrier) => used.has(carrier.key)), meshes }
}

// ---- 시작 표시(StartMarkers.tsx) ----

export type StartMarkerSpec = {
  key: string
  alliance: Alliance
  rect: FieldRect
  matrix: number[]
  width: number
  height: number
  renderOrder: number
  material: FieldMaterialSpec
}

// 프리셋마다 presetRect 반투명 사각형(얼라이언스 색). dimmed는 흐리게 그릴 프리셋 key
export function startMarkerSpecs(spec: FieldSpec, dimmed: ReadonlySet<string>): StartMarkerSpec[] {
  return spec.startPresets.map((preset, index) => {
    const rect = presetRect(preset, spec.perimeter.innerHalf)
    const plane = rectPlane(rect, START_MARKER_LIFT)
    const size = plane.geometry as { width: number; height: number }
    return {
      key: preset.key,
      alliance: preset.alliance,
      rect,
      matrix: plane.matrix,
      width: size.width,
      height: size.height,
      renderOrder: FIELD_RENDER_ORDER.startMarker + index * START_MARKER_ORDER_STEP,
      material: overlay(
        ALLIANCE_COLOR[preset.alliance],
        POLYGON_OFFSET_UNITS.startMarker,
        dimmed.has(preset.key) ? START_MARKER_DIMMED_OPACITY : START_MARKER_OPACITY
      )
    }
  })
}

// 시작 표시를 그리는가(spec-4ab §1.9): (대상 로봇이 있거나 Field 선택) 그리고 실행이 잠그지 않음 그리고 필드 요소를 숨기지
// 않음(fieldHidden·고립 보기) 그리고 문서 시즌이 프리셋을 가진 알려진 시즌
export function startMarkersShown(options: {
  hasTarget: boolean
  fieldSelected: boolean
  locked: boolean
  elementsHidden: boolean
  hasPresets: boolean
}): boolean {
  return (
    (options.hasTarget || options.fieldSelected) &&
    !options.locked &&
    !options.elementsHidden &&
    options.hasPresets
  )
}

// 시작 표시 재질 키: (얼라이언스 색, 불투명도, offset 종류)마다 하나라 컴포넌트 수명 동안 같은 재질을 함께 쓴다(spec-4ab §1.9,
// 많아야 색 2 × 불투명도 2). 흐린 묶음이 바뀌어도 재질을 다시 만들지 않는다
export function startMarkerMaterialKey(material: FieldMaterialSpec): string {
  return JSON.stringify([
    material.color,
    material.opacity,
    material.transparent,
    material.depthWrite,
    material.polygonOffsetUnits
  ])
}

// 시작 표시 위 커서(캔버스): 앞에 다른 누를 수 있는 오브젝트가 있으면(그것이 클릭을 받는다) 또는 누를 수 없으면(Field만 고름)
// 기본, 흐린 표시는 not-allowed, 아니면 손가락
export function startMarkerCursor(options: {
  clickable: boolean
  dimmed: boolean
  occluded: boolean
}): string {
  if (options.occluded || !options.clickable) return ''
  return options.dimmed ? 'not-allowed' : 'pointer'
}
