import { describe, expect, it } from 'vitest'
import { isTagsInput, TAG_INPUT_STRIDE } from '../sidecarProtocol'
import { raycasterFor } from './fieldRaycast'
import type { SensorPose } from './sensorFrame'
import { rotationMatrix } from './seasons/fieldGeometry'
import type { FieldSpec, FieldTag } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { clusterFieldPoses, tagFieldPose } from './seasons/tagPoses'
import {
  APRILTAG_PIXEL_ORIGIN,
  CV_FROM_SENSOR,
  FieldVision,
  frameDue,
  frameGridNanos,
  GRAZING_COS,
  OCCLUSION_SAMPLES,
  readCameraOutputs,
  tagsInput,
  type TagObservation,
  type TagRejection
} from './vision'
import type { Vec3 } from './worldSpec'

// 시뮬레이터 비전 시험(spec-4d A2–A5·A8·A9, K10). 장면 기준은 spec-4d §4 시험 장면 기준표와 부록 B(OpenCV 4.10.0
// pnp_ref.py). 시험 전용 FieldSpec은 checkFieldSpec을 거치지 않는 얕은 복사다.

const MS = 1_000_000

// 틱 간격 tick(ns)으로 1 s를 돌며 프레임이 있는 틱 시각들(첫 step은 tPrev null)
function frameTicks(tick: number, seconds = 1): number[] {
  const out: number[] = []
  let prev: number | null = null
  for (let t = 0; t <= seconds * 1e9; t += tick) {
    if (frameDue(prev, t)) out.push(t)
    prev = t
  }
  return out
}

describe('frameDue (A2)', () => {
  it('격자 g_k = floor(k·1e9/30)', () => {
    for (let k = 0; k <= 300; k++) expect(frameGridNanos(k)).toBe(Math.floor((k * 1e9) / 30))
    expect(frameGridNanos(1)).toBe(33_333_333)
    expect(frameGridNanos(30)).toBe(1e9)
  })

  it('틱 5 ms: 1 s에 30프레임, 간격 {30, 35} ms, 한 틱에 둘 이상 없음', () => {
    const ticks = frameTicks(5 * MS)
    expect(ticks).toHaveLength(30)
    const gaps = new Set(ticks.slice(1).map((t, i) => (t - ticks[i]) / MS))
    expect([...gaps].sort()).toEqual([30, 35])
    // 한 틱에 격자 점이 둘이면 그 틱 간격 안에 33.3 ms 넘는 점이 두 개라 불가능하다(틱 < 프레임 간격)
    expect(new Set(ticks).size).toBe(ticks.length)
  })

  it('첫 step·같은 t 두 번은 프레임 없음', () => {
    expect(frameDue(null, 0)).toBe(false)
    expect(frameDue(null, 40 * MS)).toBe(false)
    expect(frameDue(35 * MS, 35 * MS)).toBe(false)
    // g_0 = 0은 tPrev < 0일 때만 잡힌다
    expect(frameDue(-1, 0)).toBe(true)
    expect(frameDue(0, 33_333_332)).toBe(false)
    expect(frameDue(0, 33_333_333)).toBe(true)
    expect(frameDue(33_333_333, 66_666_665)).toBe(false)
    expect(frameDue(33_333_333, 66_666_666)).toBe(true)
  })

  it('틱 1 ms·10 ms에서도 1 s당 30개(10 ms는 간격 {30, 40})', () => {
    expect(frameTicks(1 * MS)).toHaveLength(30)
    const ten = frameTicks(10 * MS)
    expect(ten).toHaveLength(30)
    const gaps = new Set(ten.slice(1).map((t, i) => (t - ten[i]) / MS))
    expect([...gaps].sort()).toEqual([30, 40])
    expect(frameTicks(5 * MS, 10)).toHaveLength(300)
  })
})

describe('readCameraOutputs', () => {
  const base = {
    streaming: true,
    width: 640,
    height: 480,
    aprilTag: true,
    family: 'TAG_36h11',
    decimation: 3
  }

  it('형식이 맞으면 값, decimation 1 아래는 1, 없으면 3', () => {
    expect(readCameraOutputs(base)).toEqual(base)
    expect(readCameraOutputs({ ...base, decimation: 0.5 })?.decimation).toBe(1)
    expect(readCameraOutputs({ ...base, decimation: 2.5 })?.decimation).toBe(2.5)
    expect(readCameraOutputs({ ...base, decimation: null })?.decimation).toBe(3)
    const { decimation, ...noDecimation } = base
    void decimation
    expect(readCameraOutputs(noDecimation)?.decimation).toBe(3)
    expect(readCameraOutputs({ ...base, family: null })?.family).toBeNull()
  })

  it('스트리밍이 아니거나 형식이 틀리면 null', () => {
    expect(readCameraOutputs(undefined)).toBeNull()
    expect(readCameraOutputs({ ...base, streaming: false })).toBeNull()
    expect(readCameraOutputs({ ...base, streaming: null })).toBeNull()
    expect(readCameraOutputs({ ...base, width: 0 })).toBeNull()
    expect(readCameraOutputs({ ...base, width: 640.5 })).toBeNull()
    expect(readCameraOutputs({ ...base, height: 4097 })).toBeNull()
    expect(readCameraOutputs({ ...base, height: null })).toBeNull()
    expect(readCameraOutputs({ ...base, aprilTag: 1 })).toBeNull()
    expect(readCameraOutputs({ ...base, family: 3 })).toBeNull()
    expect(readCameraOutputs({ ...base, decimation: Infinity })).toBeNull()
    expect(readCameraOutputs({ ...base, decimation: '3' })).toBeNull()
  })
})

describe('상수', () => {
  it('OpenCV 축 = (−Y, −Z, +X), 판정 점 9개(꼭짓점 4 → 변 가운데 4 → 중심)', () => {
    expect(CV_FROM_SENSOR).toEqual([0, -1, 0, 0, 0, -1, 1, 0, 0])
    expect(APRILTAG_PIXEL_ORIGIN).toBe(0.5)
    expect(OCCLUSION_SAMPLES).toHaveLength(9)
    expect(OCCLUSION_SAMPLES.slice(0, 4)).toEqual([
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1]
    ])
    expect(OCCLUSION_SAMPLES[8]).toEqual([0, 0])
  })
})

describe('tagsInput (K10·A5 형식)', () => {
  const observation = (id: number, visible: boolean, base: number): TagObservation => ({
    id,
    corners: [base, base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7],
    shortSide: 20,
    visible,
    rejection: visible ? null : 'occluded'
  })
  const off = { enabled: false, seed: 0 }

  it('보이는 것만, id 오름차순, 꼭짓점 + 0.5, 잡음 끔이면 그것뿐', () => {
    const input = tagsInput(
      [observation(35, true, 100), observation(31, false, 10), observation(30, true, 200.25)],
      'Webcam 1',
      33_333_333,
      off
    )
    expect(input).toEqual([
      30, 200.75, 201.75, 202.75, 203.75, 204.75, 205.75, 206.75, 207.75, 35, 100.5, 101.5, 102.5,
      103.5, 104.5, 105.5, 106.5, 107.5
    ])
    expect(input.length % TAG_INPUT_STRIDE).toBe(0)
    expect(isTagsInput('tags', input)).toBe(true)
    expect(tagsInput([], 'Webcam 1', 0, off)).toEqual([])
    expect(isTagsInput('tags', [])).toBe(true)
  })

  it('잡음 켬: 같은 시드 같음, 다른 시드 다름, 잡음은 +0.5 뒤', () => {
    const obs = [observation(34, true, 50)]
    const a = tagsInput(obs, 'Webcam 1', 1000, { enabled: true, seed: 7 })
    const b = tagsInput(obs, 'Webcam 1', 1000, { enabled: true, seed: 7 })
    const c = tagsInput(obs, 'Webcam 1', 1000, { enabled: true, seed: 8 })
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a[0]).toBe(34)
    for (let i = 1; i < 9; i++) expect(Math.abs(a[i] - (50 + i - 1 + 0.5))).toBeLessThan(3)
    expect(isTagsInput('tags', a)).toBe(true)
  })
})

// ---- 장면 ----

const biobuzz = resolveSeason('biobuzz')
const START: [boolean, boolean] = [false, false]
const INCH = 0.0254

// 카메라 필드 자세(센서 틀): 원점, 요(+Z 둘레), 올려본각(위 +), 롤. 회전은 ZYX(roll, −pitch, yaw)(mounting.ts cameraAimRotation)
function camera(origin: Vec3, yaw: number, pitch: number, roll = 0): SensorPose {
  return { origin, rotation: rotationMatrix({ x: roll, y: -pitch, z: yaw }) }
}

// 태그 중심을 겨눈 카메라
function aimAt(field: FieldSpec, origin: Vec3, id: number, hive = START): SensorPose {
  const tag = field.aprilTags.tags.find((t) => t.id === id) as FieldTag
  const c = tagFieldPose(field, tag, hive).position
  const d = { x: c.x - origin.x, y: c.y - origin.y, z: c.z - origin.z }
  return camera(origin, Math.atan2(d.y, d.x), Math.atan2(d.z, Math.hypot(d.x, d.y)))
}

const ids = (observed: TagObservation[], rejection: TagRejection | null): number[] =>
  observed.filter((o) => o.rejection === rejection).map((o) => o.id)

// 태그 틀 점 (u, v)·s/2의 필드 좌표
function tagPoint(tag: FieldTag, hive: readonly [boolean, boolean], u: number, v: number): Vec3 {
  const tp = tagFieldPose(biobuzz, tag, hive)
  const r = tp.rotation
  const h = tag.size / 2
  return {
    x: tp.position.x + (r[0] * u + r[1] * v) * h,
    y: tp.position.y + (r[3] * u + r[4] * v) * h,
    z: tp.position.z + (r[6] * u + r[7] * v) * h
  }
}

// 필드 점 → OpenCV 카메라 좌표(시험의 독립 계산)
function toCv(pose: SensorPose, p: Vec3): [number, number, number] {
  const r = pose.rotation
  const d = { x: p.x - pose.origin.x, y: p.y - pose.origin.y, z: p.z - pose.origin.z }
  const s = [
    r[0] * d.x + r[3] * d.y + r[6] * d.z,
    r[1] * d.x + r[4] * d.y + r[7] * d.z,
    r[2] * d.x + r[5] * d.y + r[8] * d.z
  ]
  const m = CV_FROM_SENSOR
  return [0, 1, 2].map((i) => m[3 * i] * s[0] + m[3 * i + 1] * s[1] + m[3 * i + 2] * s[2]) as [
    number,
    number,
    number
  ]
}

// C920 640×480 보정(내장 XML 값의 float, 부록 A)
const C920 = { fx: Math.fround(622.001), cx: Math.fround(319.803), cy: Math.fround(241.251) }

// 부록 B 장면(빨강 관중석 묶음, C920 640×480, d 3): 카메라 (1.05, −0.30, 0.30), 묶음 중심을 겨눈 요·피치
const APPENDIX_B = camera({ x: 1.05, y: -0.3, z: 0.3 }, -3.108347822041822, 0.931289761986104)
// 부록 B의 영상 점(OpenCV 좌표, 태그 34–37 × 꼭짓점 4, scratchpad/p13field/s4d/pnp_ref.json image)
const APPENDIX_B_IMAGE: [number, number][] = [
  [214.4864967310536, 265.1243600053708],
  [256.7719492567386, 264.0244821567807],
  [255.04004777815948, 221.72035465297057],
  [212.42183599478747, 222.8865990480473],
  [263.2875680976287, 263.85500579068065],
  [305.70535346565754, 262.7516858608725],
  [304.3596678939275, 220.37072668594794],
  [261.6070216579231, 221.54064987045132],
  [335.1389634875339, 261.98609453493276],
  [377.7519635758123, 260.877696916849],
  [376.97714835956924, 218.3835543942496],
  [334.0261780296363, 219.55890470376056],
  [384.3180927171653, 260.70690673814227],
  [427.0649674319759, 259.5950269358221],
  [426.68242064993734, 217.02337308234797],
  [383.5954370694218, 218.20244538498144]
]

// 시험 전용 시즌: 태그 하나(field carrier)와 구조물 없음. 태그 앞면이 −X(원점의 카메라 쪽)를 보고 x_tag = −Y(영상 오른쪽),
// y_tag = −Z(영상 아래)다: ZYX (−π/2, 0, −π/2)
function oneTagField(position: Vec3, size = 0.08255): FieldSpec {
  const tag: FieldTag = {
    id: 7,
    size,
    carrier: 'field',
    position,
    rotation: { x: -Math.PI / 2, y: 0, z: -Math.PI / 2 },
    cluster: null
  }
  return { ...biobuzz, structures: [], aprilTags: { family: 'tag36h11', tags: [tag] } }
}
const ORIGIN_CAMERA = camera({ x: 0, y: 0, z: 0 }, 0, 0)

// 구조물 가림 플래그를 고른 판(순번 목록만 occludes)
function occludersOnly(keep: readonly number[]): FieldSpec {
  return {
    ...biobuzz,
    structures: biobuzz.structures.map((s, i) => ({
      ...s,
      occludes: s.occludes && keep.includes(i)
    }))
  }
}
// BIOBUZZ 구조물 순번(biobuzz.ts STRUCTURES): 다리 2–5(5는 빨강 관중석 쪽), 위 막대 6, 로고 판 7·8
const LEG_RED_AUDIENCE = 5
const TOP_BAR = 6
const LOGO_PLATES = [7, 8]

// 꼭짓점의 네 내각(°)
function interiorAngles(corners: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    const p = [corners[2 * i], corners[2 * i + 1]]
    const j = (i + 3) % 4
    const k = (i + 1) % 4
    const a = [corners[2 * j] - p[0], corners[2 * j + 1] - p[1]]
    const b = [corners[2 * k] - p[0], corners[2 * k + 1] - p[1]]
    const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]))
    out.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI)
  }
  return out
}
// 0°·180°에서 가장 가까운 내각까지(°)
const grazingMargin = (corners: readonly number[]): number =>
  Math.min(...interiorAngles(corners).map((a) => Math.min(a, 180 - a)))

const see = (vision: FieldVision, pose: SensorPose, w = 640, h = 480, d = 3): TagObservation[] =>
  vision.observe(pose, 'logitechC920', w, h, d)

describe('FieldVision 투영 (A3)', () => {
  it('부록 B 장면: 꼭짓점이 OpenCV 기준값과 1e-9 px, tagsInput은 + 0.5', () => {
    const observed = see(new FieldVision(biobuzz, START), APPENDIX_B)
    const visible = observed.filter((o) => o.visible)
    expect(visible.map((o) => o.id)).toEqual([34, 35, 36, 37])
    visible.forEach((o, t) => {
      for (let k = 0; k < 4; k++) {
        const [u, v] = APPENDIX_B_IMAGE[t * 4 + k]
        expect(Math.abs(o.corners[2 * k] - u)).toBeLessThan(1e-9)
        expect(Math.abs(o.corners[2 * k + 1] - v)).toBeLessThan(1e-9)
      }
    })
    // 짧은 변 42.3 px(부록 B)
    expect(Math.min(...visible.map((o) => o.shortSide))).toBeCloseTo(42.3, 1)
    const input = tagsInput(observed, 'Webcam 1', 1000, { enabled: false, seed: 0 })
    expect(input).toHaveLength(4 * TAG_INPUT_STRIDE)
    for (let t = 0; t < 4; t++) {
      expect(input[t * 9]).toBe(34 + t)
      for (let k = 0; k < 4; k++) {
        const [u, v] = APPENDIX_B_IMAGE[t * 4 + k]
        expect(Math.abs(input[t * 9 + 1 + 2 * k] - (u + APRILTAG_PIXEL_ORIGIN))).toBeLessThan(1e-9)
        expect(Math.abs(input[t * 9 + 2 + 2 * k] - (v + APRILTAG_PIXEL_ORIGIN))).toBeLessThan(1e-9)
      }
    }
  })

  it('부록 B 장면의 묶음 참값 t = (−0.11346, −7.78784, 52.08915) in(A9)', () => {
    const cluster = clusterFieldPoses(biobuzz, START).find((c) => c.name === 'RED AUDIENCE')!
    const t = toCv(APPENDIX_B, cluster.position).map((v) => v / INCH)
    const expected = [-0.11346, -7.78784, 52.08915]
    t.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(1e-5))
  })

  it('정면 태그: 변 = fx·s/D, 가운데 = 주점, 꼭짓점은 apriltag 순서(영상 왼쪽 아래부터)', () => {
    const D = 0.5
    const [o] = see(new FieldVision(oneTagField({ x: D, y: 0, z: 0 }), START), ORIGIN_CAMERA)
    const h = (C920.fx * 0.08255) / D / 2
    const { cx, cy } = C920
    const expected = [cx - h, cy + h, cx + h, cy + h, cx + h, cy - h, cx - h, cy - h]
    o.corners.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(1e-9))
    expect(Math.abs(o.shortSide - 2 * h)).toBeLessThan(1e-9)
    expect(o).toMatchObject({ visible: true, rejection: null })
  })
})

describe('FieldVision 보이는 조건 (A4)', () => {
  const S = 0.08255

  it('behind: 카메라 뒤 / facingAway: 태그 뒷면', () => {
    const vision = new FieldVision(biobuzz, START)
    // 관중석 쪽에서 +X(관중석 벽)를 보면 빨강 HIVE 태그는 모두 카메라 뒤
    const away = see(vision, camera({ x: 1.336, y: -0.32385, z: 0.3 }, 0, Math.PI / 6))
    expect(ids(away, 'behind').filter((id) => id < 38)).toEqual([30, 31, 32, 33, 34, 35, 36, 37])
    // 기준표 (1.6, −0.32): 파랑 HIVE 태그는 뒷면
    const r6 = see(vision, camera({ x: 1.6, y: -0.32, z: 0.3 }, -3.1386, 0.6507))
    expect(ids(r6, 'facingAway')).toEqual([38, 39, 40, 41, 42, 43, 44, 45])
    // 태그 뒤에서 앞면과 같은 쪽을 봄
    const backside = new FieldVision(oneTagField({ x: -0.5, y: 0, z: 0 }), START)
    expect(see(backside, camera({ x: 0, y: 0, z: 0 }, Math.PI, 0))[0].rejection).toBe('facingAway')
    // 카메라 앞 5 cm 안이면 behind [가정: 카메라 앞 최소 거리 5 cm]
    const near = new FieldVision(oneTagField({ x: 0.05, y: 0, z: 0 }, 0.01), START)
    expect(see(near, ORIGIN_CAMERA)[0].rejection).toBe('behind')
  })

  it('outOfFrame: 흰 테두리 꼭짓점이 화면 가장자리를 1 px 넘으면 놓침, 안쪽 1 px면 보임', () => {
    const D = 0.5
    // 흰 고리 오른쪽 끝 u = cx + fx·(y0 + 0.625·S)/D(태그 중심을 −Y로 y0 옮김), 왼쪽 끝은 y0 − 0.625·S
    const right = (u: number): TagObservation => {
      const y0 = ((u - C920.cx) * D) / C920.fx - 0.625 * S
      return see(new FieldVision(oneTagField({ x: D, y: -y0, z: 0 }), START), ORIGIN_CAMERA)[0]
    }
    const left = (u: number): TagObservation => {
      const y0 = ((u - C920.cx) * D) / C920.fx + 0.625 * S
      return see(new FieldVision(oneTagField({ x: D, y: -y0, z: 0 }), START), ORIGIN_CAMERA)[0]
    }
    // 영상 범위는 [0, w − 1](OpenCV 좌표)
    expect(right(640).rejection).toBe('outOfFrame')
    expect(right(638)).toMatchObject({ visible: true, rejection: null })
    expect(left(-1).rejection).toBe('outOfFrame')
    expect(left(1)).toMatchObject({ visible: true, rejection: null })
  })

  it('grazing: 0°·180°에서 9.9°인 내각이 있으면 놓침, 10.1°면 보임', () => {
    expect(GRAZING_COS).toBe(Math.cos((10 * Math.PI) / 180))
    // 태그를 원점에 두고 카메라를 반지름 R 원 위(태그 높이)에서 태그 법선과 φ만큼 돌려 태그 중심을 겨눈다
    // (C920 1280×720, d 1: 스치는 각에서도 화면 안이고 짧은 변이 한도보다 크다)
    const R = 0.3
    const vision = new FieldVision(oneTagField({ x: 0, y: 0, z: 0 }), START)
    const at = (phi: number): TagObservation =>
      see(
        vision,
        camera({ x: -R * Math.cos(phi), y: R * Math.sin(phi), z: 0 }, -phi, 0),
        1280,
        720,
        1
      )[0]
    // φ가 커질수록 스친다: 여유각이 target이 되는 φ를 이분법으로
    const phiFor = (target: number): number => {
      let lo = (30 * Math.PI) / 180
      let hi = (89 * Math.PI) / 180
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2
        if (grazingMargin(at(mid).corners) > target) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    }
    const wide = at(phiFor(10.1))
    const tight = at(phiFor(9.9))
    expect(grazingMargin(wide.corners)).toBeCloseTo(10.1, 6)
    expect(grazingMargin(tight.corners)).toBeCloseTo(9.9, 6)
    expect(wide).toMatchObject({ visible: true, rejection: null })
    expect(tight.rejection).toBe('grazing')
  })

  it('tooSmall: 짧은 변 < max(10, 6·d) px(d 3: 18, d 2: 12, d 1: 10, d 0.5는 1로)', () => {
    // 정면 태그의 변 = fx·S/D
    const side = (px: number, d: number): TagObservation =>
      see(
        new FieldVision(oneTagField({ x: (C920.fx * S) / px, y: 0, z: 0 }), START),
        ORIGIN_CAMERA,
        640,
        480,
        d
      )[0]
    for (const [d, limit] of [
      [3, 18],
      [2, 12],
      [1, 10],
      [0.5, 10]
    ]) {
      const small = side(limit - 0.1, d)
      const big = side(limit + 0.1, d)
      expect(Math.abs(small.shortSide - (limit - 0.1))).toBeLessThan(1e-9)
      expect(small.rejection, `d ${d}`).toBe('tooSmall')
      expect(big, `d ${d}`).toMatchObject({ visible: true, rejection: null })
    }
  })

  it('기준표 장면(빨강 관중석 프리셋, C920 640×480, d 3)', () => {
    const vision = new FieldVision(biobuzz, START)
    const up30 = Math.PI / 6
    const up50 = (50 * Math.PI) / 180
    // 첫 줄: 30·31(23.4 px)·34–37(37.4 px) 보임, 32·33 다리
    const row1 = see(vision, camera({ x: 1.336, y: -0.32385, z: 0.3 }, Math.PI, up30))
    expect(ids(row1, null)).toEqual([30, 31, 34, 35, 36, 37])
    expect(ids(row1, 'occluded')).toEqual([32, 33])
    expect(row1.find((o) => o.id === 30)!.shortSide).toBeCloseTo(23.4, 1)
    expect(row1.find((o) => o.id === 34)!.shortSide).toBeCloseTo(37.4, 1)
    const row2 = see(vision, camera({ x: 1.336, y: -0.5, z: 0.3 }, Math.PI, up30))
    expect(ids(row2, null)).toEqual([30, 31, 33, 34, 35, 36, 37])
    expect(ids(row2, 'occluded')).toEqual([32])
    const row3 = see(vision, camera({ x: 1.336, y: -0.75, z: 0.3 }, Math.PI, up30))
    expect(ids(row3, null)).toEqual([30, 33, 34, 35, 36, 37])
    expect(ids(row3, 'occluded')).toEqual([31, 32])
    for (const y of [-0.32, -0.5, -0.75]) {
      const row4 = see(vision, camera({ x: 1.336, y, z: 0.3 }, Math.PI, up50))
      expect(ids(row4, null)).toEqual([34, 35, 36, 37])
      expect(ids(row4, 'outOfFrame').slice(0, 4)).toEqual([30, 31, 32, 33])
    }
    // 앞으로 0.2 m: 위 CELL이 화면 위로 벗어남
    const row5 = see(vision, camera({ x: 1.136, y: -0.32385, z: 0.3 }, Math.PI, up30))
    expect(ids(row5, null)).toEqual([30, 31])
    expect(ids(row5, 'occluded')).toEqual([32, 33])
    expect(ids(row5, 'outOfFrame').slice(0, 4)).toEqual([34, 35, 36, 37])
    // 묶음 중심 조준: 30·31 로고 판, 32 다리 + 로고, 33 다리
    const r6 = camera({ x: 1.6, y: -0.32, z: 0.3 }, -3.1386, 0.6507)
    const row6 = see(vision, r6)
    expect(ids(row6, null)).toEqual([34, 35, 36, 37])
    expect(ids(row6, 'occluded')).toEqual([30, 31, 32, 33])
    expect(ids(see(new FieldVision(occludersOnly(LOGO_PLATES), START), r6), 'occluded')).toEqual([
      30, 31, 32
    ])
    expect(
      ids(see(new FieldVision(occludersOnly([LEG_RED_AUDIENCE]), START), r6), 'occluded')
    ).toEqual([32, 33])
    // 부록 B 조준: 34–37만(42.3 px)
    expect(ids(see(vision, APPENDIX_B), null)).toEqual([34, 35, 36, 37])
  })

  it('occluded: 꼭짓점 넷은 비고 변 가운데·중심만 다리에 걸려도 놓친다', () => {
    const origin = { x: 0.1, y: -0.5, z: 0.15 }
    const tag = biobuzz.aprilTags.tags.find((t) => t.id === 32)!
    const caster = raycasterFor(biobuzz)
    const blocked = OCCLUSION_SAMPLES.map(([u, v]) => {
      const p = tagPoint(tag, START, u, v)
      const d = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }
      const L = Math.hypot(d.x, d.y, d.z)
      return caster.blocked(origin, { x: d.x / L, y: d.y / L, z: d.z / L }, L - 1e-6, 'occludes')
    })
    // 꼭짓점 넷은 비었고 위·아래 변 가운데와 중심이 걸린다
    expect(blocked).toEqual([false, false, false, false, true, false, true, false, true])
    const observed = see(new FieldVision(biobuzz, START), aimAt(biobuzz, origin, 32))
    expect(observed.find((o) => o.id === 32)!.rejection).toBe('occluded')
  })

  it('위 막대만 가리는 시험 판에서도 가린다(1280×720, d 1)', () => {
    const pose = aimAt(biobuzz, { x: -1.1, y: 0.1, z: 0.3 }, 35)
    const topOnly = see(new FieldVision(occludersOnly([TOP_BAR]), START), pose, 1280, 720, 1)
    expect(topOnly.find((o) => o.id === 35)!.rejection).toBe('occluded')
    const none = see(new FieldVision(occludersOnly([]), START), pose, 1280, 720, 1)
    expect(none.find((o) => o.id === 35)).toMatchObject({ visible: true })
  })

  it('HIVE 몸체·CELL은 가리지 않는다(occludes를 켜도 carrier HIVE는 보지 않음)', () => {
    expect(biobuzz.structures.filter((s) => s.carrier !== 'field' && s.occludes)).toEqual([])
    const cellsOcclude: FieldSpec = {
      ...biobuzz,
      structures: biobuzz.structures.map((s) =>
        s.carrier === 'field' ? s : { ...s, occludes: true }
      )
    }
    const vision = new FieldVision(biobuzz, START)
    const withCells = new FieldVision(cellsOcclude, START)
    for (const pose of [
      APPENDIX_B,
      camera({ x: 1.336, y: -0.32385, z: 0.3 }, Math.PI, Math.PI / 6),
      aimAt(biobuzz, { x: -1.1, y: 0.1, z: 0.3 }, 35)
    ])
      expect(see(withCells, pose)).toEqual(see(vision, pose))
  })

  it('카메라 원점이 구조물 안이면 그 구조물은 가리지 않는다', () => {
    const legOnly = new FieldVision(occludersOnly([LEG_RED_AUDIENCE]), START)
    // 밖에서는 이 다리가 32·33을 가린다(기준표 첫 줄)
    const outside = see(legOnly, camera({ x: 1.336, y: -0.32385, z: 0.3 }, Math.PI, Math.PI / 6))
    expect(ids(outside, 'occluded')).toEqual([32, 33])
    // 다리 상자 중심에서 보면 그 다리는 없는 것과 같다
    const shape = biobuzz.structures[LEG_RED_AUDIENCE].shape
    if (shape.kind !== 'box') throw new Error('다리는 상자다')
    for (const id of [30, 32, 34]) {
      const inside = aimAt(biobuzz, shape.center, id)
      expect(see(legOnly, inside)).toEqual(see(new FieldVision(occludersOnly([]), START), inside))
    }
  })
})

describe('FieldVision 순서·형식 (A5)', () => {
  it('id 오름차순, tags 길이 9의 배수, 원소 유한, isTagsInput, 같은 장면 두 번 같은 배열', () => {
    const pose = camera({ x: 1.336, y: -0.32385, z: 0.3 }, Math.PI, Math.PI / 6)
    const observed = see(new FieldVision(biobuzz, START), pose)
    expect(observed.map((o) => o.id)).toEqual(Array.from({ length: 16 }, (_, i) => 30 + i))
    const off = { enabled: false, seed: 0 }
    const input = tagsInput(observed, 'Webcam 1', 33_333_333, off)
    expect(input.length % TAG_INPUT_STRIDE).toBe(0)
    expect(input.filter((_, i) => i % TAG_INPUT_STRIDE === 0)).toEqual([30, 31, 34, 35, 36, 37])
    expect(input.every((v) => Number.isFinite(v))).toBe(true)
    expect(isTagsInput('tags', input)).toBe(true)
    const again = tagsInput(see(new FieldVision(biobuzz, START), pose), 'Webcam 1', 33_333_333, off)
    expect(again).toEqual(input)
    // 'none' 시즌은 태그가 없다
    expect(see(new FieldVision(resolveSeason('none'), START), pose)).toEqual([])
  })
})

describe('FieldVision HIVE 상태 (A8)', () => {
  it('넘어간 HIVE에서 같은 카메라가 보는 태그가 다르고, 투영은 넘어간 태그 자세(tagPoses)를 쓴다', () => {
    const pose = camera({ x: 1.336, y: -0.32385, z: 0.3 }, Math.PI, Math.PI / 6)
    const start = see(new FieldVision(biobuzz, START), pose)
    const tippedState: [boolean, boolean] = [true, false]
    const tipped = see(new FieldVision(biobuzz, tippedState), pose)
    expect(ids(tipped, null)).not.toEqual(ids(start, null))
    // 넘어간 빨강 태그는 이 카메라에서 거의 옆으로 보인다(스침)
    expect(ids(tipped, 'grazing').filter((id) => id < 38)).toEqual([30, 31, 32, 33, 34, 35, 36, 37])
    // 파랑 HIVE는 그대로
    expect(tipped.filter((o) => o.id >= 38)).toEqual(start.filter((o) => o.id >= 38))
    // 투영 = tagFieldPose(넘어감) 꼭짓점의 핀홀 투영
    const tag = biobuzz.aprilTags.tags.find((t) => t.id === 34)!
    const [x, y, z] = toCv(pose, tagPoint(tag, tippedState, -1, 1))
    const t34 = tipped.find((o) => o.id === 34)!
    expect(Math.abs(t34.corners[0] - ((C920.fx * x) / z + C920.cx))).toBeLessThan(1e-9)
    expect(Math.abs(t34.corners[1] - ((C920.fx * y) / z + C920.cy))).toBeLessThan(1e-9)
  })
})

describe('묶음 원점 (A9)', () => {
  // CAD 고정물 origin30/34/38/42(scratchpad/p13field/cad/tags.json: 위치 in·사원수 [w, x, y, z], 두 HIVE 상태)
  const CAD: [string, boolean, [number, number, number], [number, number, number, number]][] = [
    ['RED SCORING', false, [-20.647, -12.742, 36.796], [0.68301, 0.18301, -0.18301, -0.68301]],
    ['RED SCORING', true, [-16.518, -12.742, 58.254], [0.68301, -0.18301, 0.18301, -0.68301]],
    ['RED AUDIENCE', false, [16.518, -12.742, 58.254], [0.68301, -0.18301, -0.18301, 0.68301]],
    ['RED AUDIENCE', true, [20.647, -12.742, 36.796], [0.68301, 0.18301, 0.18301, 0.68301]],
    ['BLUE AUDIENCE', false, [20.647, 12.758, 36.796], [0.68301, 0.18301, 0.18301, 0.68301]],
    ['BLUE AUDIENCE', true, [16.518, 12.758, 58.254], [0.68301, -0.18301, -0.18301, 0.68301]],
    ['BLUE SCORING', false, [-16.518, 12.758, 58.254], [0.68301, -0.18301, 0.18301, -0.68301]],
    ['BLUE SCORING', true, [-20.647, 12.758, 36.796], [0.68301, 0.18301, -0.18301, -0.68301]]
  ]

  it('CAD 고정물과 위치 0.02 in·사원수 1e-4(식 대조·멤버 원점은 tags.test.ts K6)', () => {
    for (const [name, tipped, position, quaternion] of CAD) {
      const pose = clusterFieldPoses(biobuzz, [tipped, tipped]).find((c) => c.name === name)!
      const p = [pose.position.x, pose.position.y, pose.position.z].map((v) => v / INCH)
      p.forEach((v, i) => expect(Math.abs(v - position[i]), name).toBeLessThan(0.02))
      pose.quaternion.forEach((v, i) =>
        expect(Math.abs(v - quaternion[i]), name).toBeLessThan(1e-4)
      )
    }
  })
})
