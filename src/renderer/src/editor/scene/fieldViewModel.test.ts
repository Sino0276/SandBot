import { BoxGeometry, Group, Matrix4, Mesh, PlaneGeometry, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { applyMatrix3, matMul3, rotationMatrix } from '../../../../shared/sim/seasons/fieldGeometry'
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

describe('fieldViewModel(C4)', () => {
  it('BIOBUZZ: 구조물 17, 태그 16, 벽 라벨 4, 테이프 14', () => {
    expect(ofRole(START, 'structure')).toHaveLength(17)
    expect(ofRole(START, 'tag')).toHaveLength(16)
    expect(ofRole(START, 'wallLabel')).toHaveLength(4)
    expect(ofRole(START, 'tape')).toHaveLength(14)
    expect(ofRole(START, 'floor')).toHaveLength(1)
    // 이음선은 X·Y 같은 좌표마다 둘
    expect(ofRole(START, 'seam')).toHaveLength(2 * BIOBUZZ.floor.seams.length)
  })

  it('HIVE CELL과 태그는 그 HIVE의 지금 각의 carrier 그룹 안에 있다', () => {
    const cells = ofRole(START, 'structure').filter(
      (mesh) => BIOBUZZ.structures[mesh.structureIndex!].key === 'hiveCell'
    )
    expect(cells.map((mesh) => mesh.carrier)).toEqual([
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
    // 고정 구조물은 필드 틀
    const fixed = ofRole(START, 'structure').filter((mesh) => mesh.carrier === 'field')
    expect(fixed).toHaveLength(13)
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
    const cells = ofRole(START, 'structure').filter(
      (mesh) => BIOBUZZ.structures[mesh.structureIndex!].key === 'hiveCell'
    )
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
