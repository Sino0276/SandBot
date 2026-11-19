import { BoxGeometry, Group, Matrix4, Mesh, PlaneGeometry, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { applyMatrix3, matMul3, rotationMatrix } from '../../../../shared/sim/seasons/fieldGeometry'
import {
  FIELD_PART_KEYS,
  fieldPartOwner,
  type FieldSpec
} from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { tag36h11Image } from '../../../../shared/sim/seasons/tag36h11'
import type { Vec3 } from '../../../../shared/sim/worldSpec'
import { applyPlayEvent, initialPlayData, newRun, type PlayRun } from '../../play/playStore'
import {
  displayedField,
  documentField,
  documentSeasonId,
  lockedRunField,
  runLocksField
} from '../field/fieldDisplay'
import {
  CAD_TAG_FRONT_OFFSET,
  drawnParts,
  FIELD_PART_COLORS,
  fieldCompanionModel,
  isHiveBody,
  fieldOutlineMeshes,
  fieldViewModel,
  FIELD_RENDER_ORDER,
  POLYGON_OFFSET_UNITS,
  START_MARKER_ORDER_STEP,
  startMarkerCursor,
  startMarkerMaterialKey,
  startMarkersShown,
  startMarkerSpecs,
  TAG_FRONT_OFFSET,
  TAG_TOTAL_SCALE,
  usesNominalFloor,
  type FieldMeshSpec,
  type FieldViewModel
} from './fieldViewModel'
import { CELL_PLUS, FLOWER, FLOWER_MIRROR, partsSpec } from './fieldPartsTestkit'
import { markerOccluded } from './startMarkerHover'
import { tagPixels, tagTextureWhiteAt } from './tagTexture'

const BIOBUZZ = resolveSeason('biobuzz')
const START = fieldViewModel(BIOBUZZ, [false, false], false)

const ofRole = (model: FieldViewModel, role: FieldMeshSpec['role']): FieldMeshSpec[] =>
  model.meshes.filter((mesh) => mesh.role === role)

// carrier 틀 → 필드: T(pivot)·R_y(angle)
function carrierMatrix(model: FieldViewModel, carrier: FieldMeshSpec['carrier']): Matrix4 {
  if (carrier === 'field') return new Matrix4()
  const spec = model.carriers.find((candidate) => candidate.key === carrier)!
  return new Matrix4()
    .makeTranslation(spec.pivot.x, spec.pivot.y, spec.pivot.z)
    .multiply(new Matrix4().makeRotationY(spec.angle))
}

const worldOf = (model: FieldViewModel, mesh: FieldMeshSpec): Matrix4 =>
  carrierMatrix(model, mesh.carrier).multiply(new Matrix4().fromArray(mesh.matrix))

// 그리는 구조물 메시 수(6b): 부품이 없는 구조물은 봉투 상자 하나, 있으면 공이 닿는 부품, HIVE 몸체 부품(BIOBUZZ 부품 데이터
// 전후에 같은 시험이 맞게 시즌 데이터에서 센다)
function structureMeshCounts(spec: FieldSpec): { structure: number; part: number } {
  const plain = spec.structures.filter((structure) => !structure.parts).length
  const part =
    spec.structures.reduce((sum, structure) => sum + drawnParts(structure.parts).length, 0) +
    spec.hives.reduce((sum, hive) => sum + drawnParts(hive.parts).length, 0)
  return { structure: plain, part }
}

describe('fieldViewModel(C4)', () => {
  it('BIOBUZZ: 구조물 17(부품이 있으면 부품), 태그 16, 벽 라벨 4, 테이프 14', () => {
    expect(BIOBUZZ.structures).toHaveLength(17)
    const counts = structureMeshCounts(BIOBUZZ)
    expect(ofRole(START, 'structure')).toHaveLength(counts.structure)
    expect(ofRole(START, 'part')).toHaveLength(counts.part)
    expect(ofRole(START, 'tag')).toHaveLength(16)
    expect(ofRole(START, 'wallLabel')).toHaveLength(4)
    expect(ofRole(START, 'tape')).toHaveLength(14)
    expect(ofRole(START, 'floor')).toHaveLength(1)
    // 이음선은 X·Y 같은 좌표마다 둘
    expect(ofRole(START, 'seam')).toHaveLength(2 * BIOBUZZ.floor.seams.length)
  })

  it('HIVE CELL과 태그는 그 HIVE의 지금 각의 carrier 그룹 안에 있다', () => {
    const cells = START.meshes.filter(
      (mesh) =>
        mesh.structureIndex !== undefined &&
        BIOBUZZ.structures[mesh.structureIndex].key === 'hiveCell'
    )
    expect([...new Set(cells.map((mesh) => mesh.structureIndex))]).toEqual([13, 14, 15, 16])
    for (const mesh of cells)
      expect(mesh.carrier).toBe(BIOBUZZ.structures[mesh.structureIndex!].carrier)
    expect(BIOBUZZ.structures.slice(13).map((structure) => structure.carrier)).toEqual([
      'hiveRed',
      'hiveRed',
      'hiveBlue',
      'hiveBlue'
    ])
    expect(START.carriers).toEqual([
      { key: 'hiveRed', pivot: BIOBUZZ.hives[0].pivot, angle: BIOBUZZ.hives[0].startAngle },
      { key: 'hiveBlue', pivot: BIOBUZZ.hives[1].pivot, angle: BIOBUZZ.hives[1].startAngle }
    ])
    const tipped = fieldViewModel(BIOBUZZ, [true, false], false)
    expect(tipped.carriers.map((carrier) => carrier.angle)).toEqual([
      BIOBUZZ.hives[0].tippedAngle,
      BIOBUZZ.hives[1].startAngle
    ])
    // 고정 구조물은 필드 틀(구조물 13개)
    const fixed = START.meshes.filter(
      (mesh) => mesh.structureIndex !== undefined && mesh.carrier === 'field'
    )
    expect(new Set(fixed.map((mesh) => mesh.structureIndex)).size).toBe(13)
  })

  it('구조물 변환은 데이터의 중심·ZYX 회전 그대로다', () => {
    for (const mesh of ofRole(START, 'structure')) {
      const shape = BIOBUZZ.structures[mesh.structureIndex!].shape
      if (shape.kind !== 'box') continue
      const matrix = new Matrix4().fromArray(mesh.matrix)
      const position = new Vector3().setFromMatrixPosition(matrix)
      expect(position.x).toBeCloseTo(shape.center.x, 12)
      expect(position.y).toBeCloseTo(shape.center.y, 12)
      expect(position.z).toBeCloseTo(shape.center.z, 12)
      const expected = rotationMatrix(shape.rotation)
      const e = matrix.elements
      // Matrix4는 열 우선, rotationMatrix는 행 우선
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) expect(e[c * 4 + r]).toBeCloseTo(expected[r * 3 + c], 12)
    }
  })

  it('벽 라벨은 글자 아래가 필드 쪽(평면 +y가 바깥 법선)이고 바닥에서 위로 본다', () => {
    for (const label of ofRole(START, 'wallLabel')) {
      const matrix = new Matrix4().fromArray(label.matrix)
      const position = new Vector3().setFromMatrixPosition(matrix)
      const up = new Vector3(0, 1, 0).transformDirection(matrix)
      const normal = new Vector3(0, 0, 1).transformDirection(matrix)
      const outward = new Vector3(position.x, position.y, 0).normalize()
      expect(up.dot(outward)).toBeCloseTo(1, 12)
      expect(normal.z).toBeCloseTo(1, 12)
      // 벽 바깥(외곽 면 밖) 필드 밖 바닥
      expect(Math.max(Math.abs(position.x), Math.abs(position.y))).toBeGreaterThan(
        BIOBUZZ.perimeter.innerHalf + BIOBUZZ.perimeter.thickness
      )
    }
    expect(ofRole(START, 'wallLabel').map((label) => label.wall)).toEqual([
      'audience',
      'scoring',
      'blue',
      'red'
    ])
  })

  it('필드 요소 숨김(fieldHidden·고립 보기)이면 구조물·HIVE·태그·라벨이 빠지고 바닥·벽·테이프는 남는다', () => {
    const hidden = fieldViewModel(BIOBUZZ, [false, false], true)
    for (const role of ['structure', 'tag', 'wallLabel'] as const)
      expect(ofRole(hidden, role)).toEqual([])
    expect(hidden.carriers).toEqual([])
    for (const role of ['floor', 'seam', 'tape', 'rail', 'panel', 'panelSeam'] as const)
      expect(ofRole(hidden, role)).toEqual(ofRole(START, role))
    // 시작 표시도 그리지 않는다
    const base = { hasTarget: true, fieldSelected: false, locked: false, hasPresets: true }
    expect(startMarkersShown({ ...base, elementsHidden: false })).toBe(true)
    expect(startMarkersShown({ ...base, elementsHidden: true })).toBe(false)
  })

  it('겹 요소·반투명의 depthWrite·polygonOffset·renderOrder', () => {
    for (const mesh of [...ofRole(START, 'seam'), ...ofRole(START, 'tape')]) {
      expect(mesh.material.depthWrite).toBe(false)
      expect(mesh.material.polygonOffsetUnits).toBe(POLYGON_OFFSET_UNITS.overlay)
      expect(mesh.renderOrder).toBe(FIELD_RENDER_ORDER.overlay)
    }
    for (const mesh of ofRole(START, 'wallLabel')) {
      expect(mesh.material).toMatchObject({ depthWrite: false, transparent: true })
      expect(mesh.material.polygonOffsetUnits).toBe(-2)
      expect(mesh.renderOrder).toBe(FIELD_RENDER_ORDER.wallLabel)
    }
    for (const mesh of ofRole(START, 'panel')) {
      expect(mesh.material).toMatchObject({ depthWrite: false, transparent: true })
      expect(mesh.renderOrder).toBe(FIELD_RENDER_ORDER.wallPanel)
    }
    const cells = START.meshes.filter(
      (mesh) =>
        mesh.structureIndex !== undefined &&
        BIOBUZZ.structures[mesh.structureIndex].key === 'hiveCell'
    )
    expect(cells.length).toBeGreaterThan(0)
    for (const mesh of cells) {
      expect(mesh.material).toMatchObject({ depthWrite: false, transparent: true })
      expect(mesh.renderOrder).toBe(FIELD_RENDER_ORDER.hiveCell)
    }
    for (const mesh of ofRole(START, 'tag'))
      expect(mesh.material.polygonOffsetUnits).toBe(POLYGON_OFFSET_UNITS.tag)
    // 바닥 0 < 겹 요소 1 < 시작 표시 2 < 벽 판 3 < CELL 4 < 잔상 5
    expect(FIELD_RENDER_ORDER).toMatchObject({
      floor: 0,
      overlay: 1,
      startMarker: 2,
      wallPanel: 3,
      hiveCell: 4,
      ghost: 5
    })
    const markers = startMarkerSpecs(BIOBUZZ, new Set(['redWallCenter']))
    expect(markers).toHaveLength(12)
    markers.forEach((marker, index) => {
      expect(marker.renderOrder).toBeCloseTo(2 + index * START_MARKER_ORDER_STEP, 12)
      expect(marker.material).toMatchObject({ depthWrite: false, transparent: true })
      expect(marker.material.polygonOffsetUnits).toBe(POLYGON_OFFSET_UNITS.startMarker)
      expect(marker.renderOrder).toBeLessThan(FIELD_RENDER_ORDER.wallPanel)
    })
    // 흐린 표시는 더 투명하다
    expect(markers[1].material.opacity).toBeLessThan(markers[0].material.opacity)
  })

  it("'none'과 모르는 시즌은 FieldFloor 경로다", () => {
    expect(usesNominalFloor('none')).toBe(true)
    expect(usesNominalFloor('biobuzz')).toBe(false)
    expect(documentSeasonId({ season: 'decode2027' })).toBe('none')
    expect(usesNominalFloor(documentSeasonId({ season: 'decode2027' }))).toBe(true)
  })
})

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

function run(patch: Partial<PlayRun> = {}): PlayRun {
  return {
    ...newRun({
      runId: 'r',
      root: '/p',
      opMode: OP_MODE,
      robotId: 'bot',
      configPath: null,
      speed: 1,
      paused: false,
      field: { season: 'none', hiveTipped: [true, false] }
    }),
    phase: 'running',
    ...patch
  }
}

describe('실행 중 표시(C5)', () => {
  const doc = { season: 'biobuzz' }
  const hives = { red: 'start', blue: 'tipped' } as const

  it('실행이 잠그면 실행의 시즌·HIVE 상태로 그린다', () => {
    const active = run()
    expect(runLocksField(active)).toBe(true)
    expect(displayedField(active, doc, hives)).toEqual({
      season: 'none',
      hiveTipped: [true, false]
    })
    // INIT 중(preparing)도 잠근다
    expect(runLocksField(run({ phase: 'preparing' }))).toBe(true)
  })

  it('잠근 필드(lockedRunField)는 텔레메트리·장치마다 run이 새 객체가 되어도 같은 객체다(씬 뷰 필드가 다시 그리지 않음)', () => {
    const active = run()
    const data = { ...initialPlayData(), run: active }
    const frame = { lines: ['a'], log: [], format: 'classic' as const }
    const next = {
      ...data,
      ...applyPlayEvent(data, { type: 'telemetry', runId: 'r', tNanos: 5, frame })
    }
    const after = {
      ...next,
      ...applyPlayEvent(next, {
        type: 'devices',
        runId: 'r',
        tNanos: 9,
        outputs: {},
        inputs: {}
      })
    }
    expect(after.run).not.toBe(active)
    expect(lockedRunField(after.run)).toBe(lockedRunField(active))
    expect(lockedRunField(active)).toBe(active.field)
    expect(lockedRunField(run({ detached: true }))).toBeNull()
    expect(documentField(doc, hives)).toEqual({ season: 'biobuzz', hiveTipped: [false, true] })
  })

  it('떼어 놓은 실행·끝난 실행·실행 없음은 문서 시즌과 개인 실행 설정', () => {
    const expected = { season: 'biobuzz', hiveTipped: [false, true] }
    for (const other of [run({ detached: true }), run({ phase: 'finished' }), null]) {
      expect(runLocksField(other)).toBe(false)
      expect(displayedField(other, doc, hives)).toEqual(expected)
    }
    // 모르는 문서 시즌은 'none'
    expect(displayedField(null, { season: 'decode2027' }, hives).season).toBe('none')
  })
})

describe('태그 텍스처·방향(C6)', () => {
  const s = BIOBUZZ.aprilTags.tags[0].size
  const tag30 = BIOBUZZ.aprilTags.tags.find((tag) => tag.id === 30)!
  const mesh = ofRole(START, 'tag').find((candidate) => candidate.tagId === 30)!

  it('id 30 텍스처의 칸 색이 tag36h11Image(30)과 같다', () => {
    const data = tagPixels(30)!
    const image = tag36h11Image(30)!
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++) {
        // 칸 중심의 텍스처 좌표: 위 행이 v = 1
        const u = (c + 0.5) / 10
        const v = 1 - (r + 0.5) / 10
        expect(tagTextureWhiteAt(data, u, v)).toBe(image[r][c])
      }
    expect(tagPixels(29)).toBeNull()
  })

  it('칸의 월드 중심이 태그 틀 ((c − 4.5)·s/8, (r − 4.5)·s/8)을 태그 필드 자세로 옮긴 값이고 앞면 법선이 태그 −z다', () => {
    expect(mesh.carrier).toBe('hiveRed')
    const side = s * TAG_TOTAL_SCALE
    expect(mesh.geometry).toEqual({ kind: 'plane', width: side, height: side })
    // 평면의 UV → 자기 좌표(PlaneGeometry 그대로 읽는다)
    const plane = new PlaneGeometry(side, side)
    const uv = plane.getAttribute('uv')
    const position = plane.getAttribute('position')
    const local = (u: number, v: number): Vector3 => {
      // PlaneGeometry는 u·v에 선형이다: 꼭짓점 (0, 1)·(1, 0)에서 원점과 축을 읽는다
      const corner = (cu: number, cv: number): Vector3 => {
        for (let i = 0; i < uv.count; i++)
          if (uv.getX(i) === cu && uv.getY(i) === cv)
            return new Vector3(position.getX(i), position.getY(i), position.getZ(i))
        throw new Error('corner')
      }
      const p00 = corner(0, 0)
      const p10 = corner(1, 0)
      const p01 = corner(0, 1)
      return p00
        .clone()
        .add(p10.clone().sub(p00).multiplyScalar(u))
        .add(p01.clone().sub(p00).multiplyScalar(v))
    }
    plane.dispose()
    const world = worldOf(START, mesh)

    // 기대값: T(pivot)·R_y(θ)·T(position)·R_zyx(rotation)을 행렬 곱으로(Euler 덧셈 아님)
    const hive = BIOBUZZ.hives[0]
    const ry = rotationMatrix({ x: 0, y: hive.startAngle, z: 0 })
    const rotation = matMul3(ry, rotationMatrix(tag30.rotation))
    const origin = applyMatrix3(ry, tag30.position)
    const toField = (p: Vec3): Vec3 => {
      const r = applyMatrix3(rotation, p)
      return {
        x: hive.pivot.x + origin.x + r.x,
        y: hive.pivot.y + origin.y + r.y,
        z: hive.pivot.z + origin.z + r.z
      }
    }
    const cells: [number, number][] = [
      [2, 2],
      [2, 7]
    ]
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) cells.push([r, c])
    for (const [r, c] of cells) {
      const point = local((c + 0.5) / 10, 1 - (r + 0.5) / 10).applyMatrix4(world)
      // 앞면 쪽으로 TAG_FRONT_OFFSET 띄운다(태그 틀 −z)
      const expected = toField({
        x: ((c - 4.5) * s) / 8,
        y: ((r - 4.5) * s) / 8,
        z: -TAG_FRONT_OFFSET
      })
      expect(Math.abs(point.x - expected.x)).toBeLessThan(1e-9)
      expect(Math.abs(point.y - expected.y)).toBeLessThan(1e-9)
      expect(Math.abs(point.z - expected.z)).toBeLessThan(1e-9)
    }
    // 앞면 법선(평면 +z) = 태그 −z
    const front = new Vector3(0, 0, 1).transformDirection(world)
    const minusZ = applyMatrix3(rotation, { x: 0, y: 0, z: -1 })
    expect(front.x).toBeCloseTo(minusZ.x, 12)
    expect(front.y).toBeCloseTo(minusZ.y, 12)
    expect(front.z).toBeCloseTo(minusZ.z, 12)
    // spec-4ab §1.6 표본: 태그 30 시작 상태 앞면 (0.5, 0, −0.866)
    expect(front.x).toBeCloseTo(0.5, 9)
    expect(front.y).toBeCloseTo(0, 9)
    expect(front.z).toBeCloseTo(-Math.sqrt(3) / 2, 9)
  })
})

describe('시작 표시 재질·커서(4ab 리뷰 수정)', () => {
  it('재질 키는 (얼라이언스 색, 불투명도, offset 종류)마다 하나다: 흐린 묶음이 어떻든 많아야 4개', () => {
    const keys = new Set<string>()
    const presets = BIOBUZZ.startPresets.map((preset) => preset.key)
    for (const dimmed of [[], presets, presets.slice(0, 4), ['redWallCenter']])
      for (const marker of startMarkerSpecs(BIOBUZZ, new Set(dimmed)))
        keys.add(startMarkerMaterialKey(marker.material))
    expect(keys.size).toBe(4)
    // 같은 프리셋의 흐린·보통 재질은 키가 다르다
    const [plain] = startMarkerSpecs(BIOBUZZ, new Set())
    const [dim] = startMarkerSpecs(BIOBUZZ, new Set([plain.key]))
    expect(startMarkerMaterialKey(plain.material)).not.toBe(startMarkerMaterialKey(dim.material))
  })

  it('커서: 앞에 누를 수 있는 오브젝트가 있거나 누를 수 없으면 기본, 흐리면 not-allowed, 아니면 손가락', () => {
    const base = { clickable: true, dimmed: false, occluded: false }
    expect(startMarkerCursor(base)).toBe('pointer')
    expect(startMarkerCursor({ ...base, dimmed: true })).toBe('not-allowed')
    expect(startMarkerCursor({ ...base, occluded: true })).toBe('')
    expect(startMarkerCursor({ ...base, occluded: true, dimmed: true })).toBe('')
    expect(startMarkerCursor({ ...base, clickable: false })).toBe('')
  })

  it('가림: 표시 묶음 밖의 사건 오브젝트가 표시보다 가까우면 가린 것이고, 표시 자신·더 먼 것·빗나간 것은 아니다', () => {
    // 광선은 (0, 0, 2)에서 −z. 표시는 z = 0.002, 로봇 파트는 z 0.1–0.3 상자
    const raycaster = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1))
    const markers = new Group()
    const marker = new Mesh(new PlaneGeometry(1, 1))
    marker.position.z = 0.002
    markers.add(marker)
    const part = new Mesh(new BoxGeometry(0.2, 0.2, 0.2))
    part.position.z = 0.2
    const aside = new Mesh(new BoxGeometry(0.2, 0.2, 0.2))
    aside.position.set(1, 0, 0.2)
    const below = new Mesh(new BoxGeometry(0.2, 0.2, 0.002))
    below.position.z = -0.1
    // 클릭 처리기를 그룹에 둔 오브젝트(임시 로봇)도 하위 메시로 맞춘다
    const holder = new Group()
    holder.add(part)
    for (const object of [markers, holder, aside, below]) object.updateMatrixWorld(true)
    const distance = 2 - 0.002
    expect(markerOccluded(raycaster, [marker, aside, below], markers, distance)).toBe(false)
    expect(markerOccluded(raycaster, [marker, holder], markers, distance)).toBe(true)
    expect(markerOccluded(raycaster, [part], markers, distance)).toBe(true)
  })
})

// B8(spec-4e §1.6·§1.8): 필드 CAD와 함께 그리는 단순 형상과 충돌체 윤곽
describe('fieldCompanionModel·fieldOutlineMeshes (B8)', () => {
  const roles = (model: FieldViewModel): string[] => model.meshes.map((mesh) => mesh.role)

  it('companion: 태그·벽 라벨과 HIVE 몸체(보이기는 씬 뷰가 각으로), carriers는 입력 그대로, 순서는 model.meshes', () => {
    const companion = fieldCompanionModel(START)
    expect(companion.carriers).toBe(START.carriers)
    expect(ofRole(companion, 'tag')).toHaveLength(16)
    expect(ofRole(companion, 'wallLabel')).toHaveLength(4)
    const bodies = START.meshes.filter(isHiveBody)
    // HIVE 몸체: CELL(부품이 있으면 트레이 부품)과 HIVE 축 조립체 부품, 모두 HIVE carrier
    expect(bodies.length).toBeGreaterThanOrEqual(4)
    expect(bodies.every((mesh) => mesh.carrier !== 'field' && mesh.role !== 'tag')).toBe(true)
    expect(companion.meshes).toHaveLength(20 + bodies.length)
    expect(new Set(roles(companion))).toEqual(
      new Set(['tag', 'wallLabel', ...bodies.map((mesh) => mesh.role)])
    )
    const order = START.meshes.map((mesh) => mesh.key)
    const keys = companion.meshes.map((mesh) => mesh.key)
    expect(keys).toEqual(order.filter((key) => keys.includes(key)))
    // 벽 라벨·HIVE 몸체는 같은 객체, 태그는 새 사본(입력을 바꾸지 않는다)
    const label = ofRole(companion, 'wallLabel')[0]
    expect(START.meshes).toContain(label)
    for (const body of bodies) expect(companion.meshes).toContain(body)
    const tag = ofRole(companion, 'tag')[0]
    expect(START.meshes).not.toContain(tag)
  })

  it('companion 태그는 태그 평면 +z(앞면 법선 = 태그 −z)로 CAD_TAG_FRONT_OFFSET만큼 앞(1e-9)', () => {
    const companion = fieldCompanionModel(START)
    const before = ofRole(START, 'tag')
    const after = ofRole(companion, 'tag')
    after.forEach((mesh, index) => {
      const original = before[index]
      expect(mesh.tagId).toBe(original.tagId)
      // 원래 태그 중심(평면 원점에서 TAG_FRONT_OFFSET 뒤)
      const at = (spec: FieldMeshSpec, z: number): Vector3 =>
        new Vector3(0, 0, z).applyMatrix4(new Matrix4().fromArray(spec.matrix))
      const centre = at(original, -TAG_FRONT_OFFSET)
      const moved = at(mesh, 0)
      // 앞면 법선(평면 +z)
      const normal = at(original, 1 - TAG_FRONT_OFFSET).sub(centre)
      expect(normal.length()).toBeCloseTo(1, 12)
      const offset = moved.clone().sub(centre)
      expect(offset.dot(normal)).toBeCloseTo(CAD_TAG_FRONT_OFFSET, 9)
      expect(
        offset
          .clone()
          .sub(normal.clone().multiplyScalar(offset.dot(normal)))
          .length()
      ).toBeLessThan(1e-9)
    })
  })

  it('넘어간 상태와 관계없이 HIVE 몸체를 같은 모양으로 넣고, 고정 구조물(발판 막대·다리·FLOWER)은 넣지 않는다', () => {
    const tipped = fieldViewModel(BIOBUZZ, [true, false], false)
    const companion = fieldCompanionModel(tipped)
    const bodies = companion.meshes.filter(isHiveBody)
    expect(bodies.map((mesh) => mesh.key)).toEqual(
      fieldCompanionModel(START)
        .meshes.filter(isHiveBody)
        .map((mesh) => mesh.key)
    )
    expect(
      new Set(
        bodies
          .filter((mesh) => mesh.structureIndex !== undefined)
          .map((mesh) => BIOBUZZ.structures[mesh.structureIndex!].key)
      )
    ).toEqual(new Set(['hiveCell']))
    expect(
      companion.meshes.every((mesh) => mesh.carrier !== 'field' || mesh.role === 'wallLabel')
    ).toBe(true)
  })

  it("'none' 시즌의 companion은 비어 있다", () => {
    const none = fieldViewModel(resolveSeason('none'), [false, false], false)
    expect(fieldCompanionModel(none).meshes).toEqual([])
  })

  it('윤곽: 바닥 1 + 테이프 14 + 레일 8 + 판 12 + 판 이음 8 + 계산 구조물 13 = 56(부품이 있으면 부품 + 흐린 봉투), 표시 전용 CELL 상자 없음', () => {
    const outline = fieldOutlineMeshes(START, BIOBUZZ)
    expect(ofRole(outline, 'floor')).toHaveLength(1)
    expect(ofRole(outline, 'tape')).toHaveLength(14)
    expect(ofRole(outline, 'rail')).toHaveLength(8)
    expect(ofRole(outline, 'panel')).toHaveLength(12)
    expect(ofRole(outline, 'panelSeam')).toHaveLength(8)
    // 계산 구조물 13개: 부품이 없으면 그 상자, 있으면 흐린 봉투(그리는 부품은 모두 윤곽)
    const computed = BIOBUZZ.structures.filter((s) => s.solid || s.sensed || s.occludes)
    expect(computed).toHaveLength(13)
    expect(ofRole(outline, 'structure')).toHaveLength(13)
    expect(ofRole(outline, 'structure').filter((mesh) => mesh.outline === 'dim')).toHaveLength(
      computed.filter((s) => s.parts).length
    )
    expect(ofRole(outline, 'part')).toEqual(ofRole(START, 'part'))
    expect(outline.meshes).toHaveLength(56 + ofRole(START, 'part').length)
    expect(ofRole(outline, 'seam')).toHaveLength(0)
    expect(ofRole(outline, 'tag')).toHaveLength(0)
    expect(ofRole(outline, 'wallLabel')).toHaveLength(0)
    for (const mesh of ofRole(outline, 'structure')) {
      const structure = BIOBUZZ.structures[mesh.structureIndex!]
      expect(structure.solid || structure.sensed || structure.occludes).toBe(true)
      expect(structure.key).not.toBe('hiveCell')
      expect(mesh.outline === 'dim').toBe(structure.parts !== undefined)
    }
    // HIVE carrier 그룹은 그 안에 윤곽(CELL 트레이·축 조립체 부품)이 있을 때만
    expect(outline.carriers.map((carrier) => carrier.key)).toEqual(
      START.carriers
        .filter((carrier) => ofRole(START, 'part').some((mesh) => mesh.carrier === carrier.key))
        .map((carrier) => carrier.key)
    )
    // 순서는 model.meshes 순서(흐린 봉투는 모델에 없다)
    const order = START.meshes.map((mesh) => mesh.key)
    const keys = outline.meshes.filter((mesh) => mesh.outline !== 'dim').map((mesh) => mesh.key)
    expect(keys).toEqual(order.filter((key) => keys.includes(key)))
    // 위 막대·로고 판(solid 아님, 가림·광선에 씀)은 남긴다
    const kept = new Set(ofRole(outline, 'structure').map((m) => m.structureIndex))
    BIOBUZZ.structures.forEach((structure, index) => {
      expect(kept.has(index)).toBe(structure.solid || structure.sensed || structure.occludes)
    })
  })

  it('윤곽은 carrier를 지킨다(계산에 쓰는 carrier 구조물이 있으면 그 그룹을 남긴다)', () => {
    const spec = {
      ...BIOBUZZ,
      structures: BIOBUZZ.structures.map((structure) =>
        structure.key === 'hiveCell' && structure.carrier === 'hiveRed'
          ? { ...structure, solid: true }
          : structure
      )
    }
    const model = fieldViewModel(spec, [false, false], false)
    const outline = fieldOutlineMeshes(model, spec)
    const blueParts = ofRole(model, 'part').some((mesh) => mesh.carrier === 'hiveBlue')
    expect(outline.carriers.map((carrier) => carrier.key)).toEqual(
      blueParts ? ['hiveRed', 'hiveBlue'] : ['hiveRed']
    )
    // 빨강 CELL 둘(부품이 있으면 흐린 봉투)
    expect(ofRole(outline, 'structure').filter((mesh) => mesh.carrier === 'hiveRed')).toHaveLength(
      2
    )
  })

  it("'none' 시즌 윤곽: 바닥·레일·판(구조물·테이프 없음)", () => {
    const none = resolveSeason('none')
    const outline = fieldOutlineMeshes(fieldViewModel(none, [false, false], false), none)
    expect(ofRole(outline, 'floor')).toHaveLength(1)
    expect(ofRole(outline, 'structure')).toHaveLength(0)
    expect(outline.meshes.length).toBeGreaterThan(1)
  })
})

// 6b(spec-6b §8): 부품이 있는 구조물·HIVE 몸체 부품(시험 판 fieldPartsTestkit: BIOBUZZ 부품 데이터 전후에 같은 규칙을 본다)
describe('부품 그리기·색·윤곽·companion (6b)', () => {
  const SPEC = partsSpec()
  const MODEL = fieldViewModel(SPEC, [false, false], false)
  const partsOf = (model: FieldViewModel, index: number): FieldMeshSpec[] =>
    ofRole(model, 'part').filter((mesh) => mesh.structureIndex === index)

  it('부품 색 표는 모든 부품 이름을 덮고, CELL 트레이만 주인 재질(null)이다', () => {
    expect(Object.keys(FIELD_PART_COLORS).sort()).toEqual([...FIELD_PART_KEYS].sort())
    for (const key of FIELD_PART_KEYS) {
      const color = FIELD_PART_COLORS[key]
      if (fieldPartOwner(key) === 'hiveCell') expect(color).toBeNull()
      else expect(color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(FIELD_PART_COLORS).toMatchObject({
      flowerPipe: '#3fae49',
      flowerRingBottom: '#202020',
      flowerRingMiddle: '#202020',
      flowerRingTop: '#f2c200',
      flowerBackstop: '#8e44ad',
      flowerUpright: '#303030',
      flowerWallBracket: '#303030'
    })
  })

  it('부품이 있는 구조물은 봉투 대신 공이 닿는 부품(로봇 전용 조각은 뺌)을 그리고, 색은 이름으로 정한다', () => {
    expect(ofRole(MODEL, 'structure').map((mesh) => mesh.structureIndex)).not.toContain(FLOWER)
    expect(ofRole(MODEL, 'structure').map((mesh) => mesh.structureIndex)).not.toContain(CELL_PLUS)
    const flower = partsOf(MODEL, FLOWER)
    // 1번(구멍을 채운 로봇 판)은 그리지 않는다. 키의 부품 순번은 주인의 parts 순번(행 토큰 s<i>p<j>와 같다)
    expect(flower.map((mesh) => mesh.key)).toEqual([
      'structure9.part0',
      'structure9.part2',
      'structure9.part3'
    ])
    expect(flower.map((mesh) => [mesh.partIndex, mesh.partKey, mesh.geometry.kind])).toEqual([
      [0, 'flowerRingBottom', 'prism'],
      [2, 'flowerPipe', 'cylinder'],
      [3, 'flowerBackstop', 'box']
    ])
    expect(flower.map((mesh) => mesh.material.color)).toEqual(['#202020', '#3fae49', '#8e44ad'])
    for (const mesh of flower) {
      expect(mesh.carrier).toBe('field')
      expect(mesh.material).toMatchObject({ opacity: 1, transparent: false, depthWrite: true })
      expect(mesh.renderOrder).toBe(FIELD_RENDER_ORDER.floor)
    }
    // 거울 짝(FLOWER 10)도 같은 수
    expect(partsOf(MODEL, FLOWER_MIRROR)).toHaveLength(3)
    // 숨기면 부품도 없다
    expect(ofRole(fieldViewModel(SPEC, [false, false], true), 'part')).toEqual([])
  })

  it('부품 변환: 볼록 기둥·상자는 중심·ZYX 그대로, 원기둥은 CylinderGeometry 축(y)을 자기 z로', () => {
    const [prism, cylinder, box] = partsOf(MODEL, FLOWER)
    const parts = SPEC.structures[FLOWER].parts!
    for (const [mesh, part] of [
      [prism, parts[0]],
      [box, parts[3]]
    ] as const) {
      const matrix = new Matrix4().fromArray(mesh.matrix)
      const position = new Vector3().setFromMatrixPosition(matrix)
      const { x, y, z } = part.shape.center
      expect(position.distanceTo(new Vector3(x, y, z))).toBeLessThan(1e-12)
      const expected = rotationMatrix(part.shape.rotation)
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          expect(matrix.elements[c * 4 + r]).toBeCloseTo(expected[r * 3 + c], 12)
    }
    if (prism.geometry.kind !== 'prism' || parts[0].shape.kind !== 'prism') throw new Error('prism')
    expect(prism.geometry.polygon).toEqual(parts[0].shape.polygon)
    expect(prism.geometry.height).toBe(parts[0].shape.height)
    // CylinderGeometry의 +y가 필드 +Z
    const axis = new Vector3(0, 1, 0).transformDirection(new Matrix4().fromArray(cylinder.matrix))
    expect(axis.z).toBeCloseTo(1, 12)
  })

  it('CELL 트레이 부품은 그 HIVE carrier 안의 반투명 HIVE CELL 재질(renderOrder 4), 축 조립체는 HIVE carrier의 불투명 #303030', () => {
    const cell = partsOf(MODEL, CELL_PLUS)
    expect(cell.map((mesh) => mesh.partKey)).toEqual(['cellFloor', 'cellBackSkin'])
    for (const mesh of cell) {
      expect(mesh.carrier).toBe('hiveRed')
      expect(mesh.material).toMatchObject({
        color: SPEC.structures[CELL_PLUS].material.display,
        transparent: true,
        depthWrite: false
      })
      expect(mesh.renderOrder).toBe(FIELD_RENDER_ORDER.hiveCell)
    }
    expect(partsOf(MODEL, CELL_PLUS + 2).every((mesh) => mesh.carrier === 'hiveBlue')).toBe(true)
    const pivots = ofRole(MODEL, 'part').filter((mesh) => mesh.structureIndex === undefined)
    expect(pivots.map((mesh) => [mesh.key, mesh.carrier, mesh.partKey])).toEqual([
      ['hiveRed.part0', 'hiveRed', 'hivePivot'],
      ['hiveBlue.part0', 'hiveBlue', 'hivePivot']
    ])
    expect(pivots.every((mesh) => mesh.material.color === '#303030')).toBe(true)
  })

  it('윤곽: 부품은 보통 색, 부품이 있는 계산 구조물의 봉투는 첫 부품 바로 앞에 흐리게(표시 전용 CELL 봉투는 없음), carrier는 둘 다', () => {
    const outline = fieldOutlineMeshes(MODEL, SPEC)
    const keys = outline.meshes.map((mesh) => mesh.key)
    const at = keys.indexOf('structure9')
    expect(at).toBeGreaterThan(-1)
    expect(keys[at + 1]).toBe('structure9.part0')
    expect(outline.meshes[at].outline).toBe('dim')
    const envelope = SPEC.structures[FLOWER].shape
    if (envelope.kind !== 'box') throw new Error('box')
    expect(outline.meshes[at].geometry).toEqual({ kind: 'box', size: envelope.size })
    expect(keys[keys.indexOf('structure10') + 1]).toBe('structure10.part0')
    // CELL은 계산 구조물이 아니라 봉투가 없고 트레이 부품만 보통 윤곽이다
    expect(keys).not.toContain('structure14')
    expect(keys).toContain('structure14.part0')
    expect(ofRole(outline, 'part').every((mesh) => mesh.outline === undefined)).toBe(true)
    expect(outline.meshes.filter((mesh) => mesh.outline === 'dim')).toHaveLength(
      SPEC.structures.filter((s) => s.parts && (s.solid || s.sensed || s.occludes)).length
    )
    expect(outline.carriers.map((carrier) => carrier.key)).toEqual(['hiveRed', 'hiveBlue'])
    // 그려진 공 부품이 없는 계산 구조물의 봉투는 끝에 흐리게 둔다
    const robotsOnly: FieldSpec = {
      ...SPEC,
      structures: SPEC.structures.map((structure, index) =>
        index === FLOWER
          ? {
              ...structure,
              parts: structure.parts!.map((part) => ({ ...part, balls: false, robots: true }))
            }
          : structure
      )
    }
    const last = fieldOutlineMeshes(fieldViewModel(robotsOnly, [false, false], false), robotsOnly)
    expect(last.meshes.at(-1)).toMatchObject({ key: 'structure9', outline: 'dim' })
    // 숨김 모델에는 봉투도 없다
    const hidden = fieldOutlineMeshes(fieldViewModel(SPEC, [false, false], true), SPEC)
    expect(hidden.meshes.some((mesh) => mesh.outline === 'dim')).toBe(false)
  })

  it('companion: CELL 트레이·축 조립체 부품은 HIVE 몸체, FLOWER 부품은 CAD가 그려 넣지 않는다', () => {
    const companion = fieldCompanionModel(MODEL)
    const bodies = companion.meshes.filter(isHiveBody)
    expect(bodies.map((mesh) => mesh.key)).toEqual([
      'structure13.part0',
      'structure13.part1',
      'structure14.part0',
      'structure14.part1',
      'structure15.part0',
      'structure15.part1',
      'structure16.part0',
      'structure16.part1',
      'hiveRed.part0',
      'hiveBlue.part0'
    ])
    expect(companion.meshes.some((mesh) => mesh.carrier === 'field' && mesh.role === 'part')).toBe(
      false
    )
  })
})
