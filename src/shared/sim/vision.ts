// 시뮬레이터 비전(4d, spec-4d §1.4·§1.5): 웹캠의 필드 자세에서 시즌 AprilTag의 꼭짓점을 참 렌즈 값으로 투영하고 보이는
// 조건을 걸러 원시 검출(id·꼭짓점 4개)을 만든다. 기하만 한다(처리 시간·프레임 버퍼·자세 풀이는 사이드카 VisionPortal·
// AprilTagProcessor 손 구현). 순수·결정적: 배열 순서만 쓰고 벽시계·Math.random·Map 순서를 쓰지 않는다.
//
// 픽셀 좌표는 둘이다(spec-4d §0). 투영·판정·인스펙터·기즈모는 OpenCV 좌표(첫 픽셀 중심 (0, 0), x 오른쪽, y 아래, 보정
// XML의 cx·cy가 이 좌표)이고, 세계 입력 tags의 꼭짓점은 apriltag 3 좌표(왼쪽 위 픽셀의 왼쪽 위 모서리가 (0, 0))라 OpenCV
// 좌표 + APRILTAG_PIXEL_ORIGIN이다.

import { trueIntrinsics, type CameraModelId } from './cameraData'
import { raycasterFor, type FieldRaycaster } from './fieldRaycast'
import type { SensorPose } from './sensorFrame'
import { noiseGaussian } from './sensorNoise'
import { applyMatrix3 } from './seasons/fieldGeometry'
import type { FieldSpec } from './seasons/fieldSpec'
import { tagFieldPose, type FieldPose3 } from './seasons/tagPoses'
import { MAX_TAG_DETECTIONS, type DeviceValues } from '../sidecarProtocol'
import type { Vec3, WorldSpec } from './worldSpec'

// ---- 프레임 격자(spec-4d §1.4) ----

// g_k = floor(k·1e9/30) ns(정수, k ≥ 0) [가정: 30 fps 격자: 모든 모델·해상도·형식에서 프레임 격자는 30 fps]
export const FRAME_RATE = 30
const NANOS_PER_SECOND = 1_000_000_000

// 격자 시각 g_k(정수 ns). k·1e9가 2⁵³을 넘는 것은 약 3.5일 뒤라 정수 연산 문제가 없다
export function frameGridNanos(k: number): number {
  return Math.floor((k * NANOS_PER_SECOND) / FRAME_RATE)
}

// t 이하인 마지막 격자 번호(g_k ≤ t인 가장 큰 k, t < 0이면 −1)
function lastFrameIndex(t: number): number {
  if (t < 0) return -1
  // 나눗셈 반올림을 격자 정의로 바로잡는다(g_k 자체가 floor라 k 추정이 하나 어긋날 수 있다)
  let k = Math.floor((t * FRAME_RATE) / NANOS_PER_SECOND)
  while (frameGridNanos(k + 1) <= t) k++
  while (k >= 0 && frameGridNanos(k) > t) k--
  return k
}

// ∃k: tPrev < g_k ≤ t. 첫 step(tPrev null)에는 프레임이 없고, 같은 시각이 두 번 오면(dt 0) 거짓이다.
export function frameDue(tPrev: number | null, t: number): boolean {
  if (tPrev === null || !(t > tPrev)) return false
  return lastFrameIndex(t) > lastFrameIndex(tPrev)
}

// ---- 사이드카 웹캠 출력(spec-4d §1.5·§3.2) ----

// 세계가 읽는 웹캠 출력(그 틱 출력, 형식이 틀리면 프레임을 만들지 않는다)
export type CameraOutputs = {
  streaming: boolean
  width: number
  height: number
  aprilTag: boolean
  family: string | null
  decimation: number
}

// 해상도 한도 [결정: 웹캠 최대 해상도보다 넉넉한 한도, spec-4d §1.5]
export const MAX_CAMERA_DIMENSION = 4096
// 데시메이션이 없을 때(SDK AprilTagProcessor.Builder 기본 3, AprilTagProcessorImpl 생성자)
export const DEFAULT_DECIMATION = 3

const isDimension = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_CAMERA_DIMENSION

// streaming === true, width·height가 1–4096 정수, aprilTag boolean, family 문자열 또는 null, decimation 유한 수(1보다
// 작으면 1, 없으면 3)일 때만 값이고 아니면 null(그 틱에 프레임 없음)
export function readCameraOutputs(values: DeviceValues | undefined): CameraOutputs | null {
  if (!values || values.streaming !== true) return null
  const { width, height, aprilTag, family, decimation } = values
  if (!isDimension(width) || !isDimension(height)) return null
  if (typeof aprilTag !== 'boolean') return null
  if (family !== null && typeof family !== 'string') return null
  let d = DEFAULT_DECIMATION
  if (decimation !== undefined && decimation !== null) {
    if (typeof decimation !== 'number' || !Number.isFinite(decimation)) return null
    d = decimation < 1 ? 1 : decimation
  }
  return { streaming: true, width, height, aprilTag, family: family ?? null, decimation: d }
}

// ---- 보이는 조건과 꼭짓점(spec-4d §1.5) ----

// 첫 실패 이유(판정 순서): 카메라 뒤 → 뒷면 → 영상 밖 → 스침 → 작음 → 가림
export type TagRejection =
  'behind' | 'facingAway' | 'outOfFrame' | 'grazing' | 'tooSmall' | 'occluded'

export type TagObservation = {
  id: number
  // apriltag 순서 x0,y0..x3,y3(px, OpenCV 좌표, 잡음 전)
  corners: [number, number, number, number, number, number, number, number]
  // 가장 짧은 변(px)
  shortSide: number
  visible: boolean
  // 첫 실패 이유(위 순서), 보이면 null
  rejection: TagRejection | null
}

export type VisionCamera = { device: string; model: CameraModelId }

// apriltag 3 픽셀 좌표 = OpenCV 좌표 + 0.5(x·y 모두) [확인: apriltag.c:538–552 value_for_pixel의 floor(px − 0.5), :818
// refine_edges의 delta = 0.5, v3.4.2 apriltag_quad_thresh.c:634 "adjust for pixel center bias"]
export const APRILTAG_PIXEL_ORIGIN = 0.5

// 행 우선 3×3: 행 = OpenCV 카메라 축을 센서 틀로 쓴 것. x_cv = −Y_s, y_cv = −Z_s, z_cv = +X_s(센서 +X 광축, +Z 영상 위)
export const CV_FROM_SENSOR: readonly number[] = [0, -1, 0, 0, 0, -1, 1, 0, 0]

// 판정 광선을 쏘는 태그 틀 점 9개(×s/2): 꼭짓점 4(apriltag 순서) → 변 가운데 4 → 중심
// [가정: 태그 면 9점 중 하나라도 가리면 놓침]
export const OCCLUSION_SAMPLES: readonly (readonly [number, number])[] = [
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 0]
]

// 꼭짓점 잡음 σ(px) [가정: 꼭짓점 잡음 σ 0.3 px, 기본 끔(실행 설정 sensorNoise)]
export const TAG_CORNER_NOISE_PX = 0.3

// 카메라 앞 최소 거리(m): 태그 꼭짓점·흰 테두리 꼭짓점의 광축 깊이가 이 값 이하면 behind
// [가정: 카메라 앞 최소 거리 5 cm, synthesis §5.4-1: 렌즈 바로 앞의 점은 초점·투영이 의미 없다]
export const MIN_CAMERA_DEPTH = 0.05
// 흰 고리 바깥 꼭짓점의 태그 틀 반폭 비(검은 테두리 반폭 s/2의 1.25배 = ±0.625·s)
// [가정: 흰 테두리: 36h11의 흰 고리 1칸(검은 테두리 8칸 사각형 바깥) 끝까지 영상 안이어야 사각형을 찾는다, synthesis §5.4]
export const WHITE_BORDER_SCALE = 1.25
// 모서리 각 한도: 내각이 0°·180°에 10° 안이면 apriltag fit_quad가 버린다(apriltag.c:384 cos_critical_rad = cos(10°),
// apriltag_quad_thresh.c:966–968). apriltag은 이어진 변 벡터의 꺾임각으로 보는데 cos(내각) = −cos(꺾임각)이고 조건이
// ±대칭이라 내각으로 봐도 같은 조건이다. 같은 줄의 감김 검사는 앞면 태그의 볼록 투영에서 늘 통과한다.
export const GRAZING_COS = Math.cos((10 * Math.PI) / 180)
// 가장 짧은 변 한도(px): max(MIN_SIDE_PX, MIN_SIDE_PER_DECIMATION·d) [가정: 최소 변, spec-4d §1.5-8: 줄인 영상에서 검은
// 테두리 칸당 0.75 px. 샘플 주석 8.6·d와 Tech Tip 최악 해석 6.7·d 사이의 가장 큰 정수 계수 6, 데시메이션 1의 바닥 10 px]
export const MIN_SIDE_PX = 10
export const MIN_SIDE_PER_DECIMATION = 6
// 가림 광선을 판정 점 바로 앞에서 끊는 여유(m, spec-4d §1.5-9의 |S − O| − 1e-6): 판정 점이 구조물 면 위에 있어도 그 면을
// 가림으로 세지 않게 하는 수치 여유 [가정: 1 µm는 형상 오차보다 충분히 작고 반올림보다 충분히 크다]
const OCCLUSION_END_MARGIN = 1e-6

type Intrinsics = { fx: number; fy: number; cx: number; cy: number }
type TagEntry = {
  id: number
  size: number
  center: Vec3
  // 앞면 법선(필드) = −z_tag
  normal: Vec3
  // 검은 테두리 꼭짓점 4개(apriltag 순서), 흰 고리 바깥 꼭짓점 4개, 가림 판정 점 9개(필드 좌표)
  corners: readonly Vec3[]
  outer: readonly Vec3[]
  samples: readonly Vec3[]
}

// 태그 틀 (u, v, 0)(×s/2)의 필드 좌표
function tagPoint(pose: FieldPose3, half: number, u: number, v: number): Vec3 {
  const p = applyMatrix3(pose.rotation, { x: u * half, y: v * half, z: 0 })
  return { x: pose.position.x + p.x, y: pose.position.y + p.y, z: pose.position.z + p.z }
}

export class FieldVision {
  // id 오름차순 태그와 그 필드 자세(생성자에서 hiveTipped로 한 번 푼다)
  protected readonly tags: readonly TagEntry[]
  private readonly caster: FieldRaycaster
  // (모델, w, h)마다 참 렌즈 값(배열 순서로 찾는다: Map 순서에 기대지 않게)
  private readonly intrinsics: { model: CameraModelId; w: number; h: number; k: Intrinsics }[] = []

  constructor(
    protected readonly field: FieldSpec,
    hiveTipped: readonly [boolean, boolean]
  ) {
    this.caster = raycasterFor(field)
    this.tags = [...field.aprilTags.tags]
      .sort((a, b) => a.id - b.id)
      .map((tag) => {
        const pose = tagFieldPose(field, tag, hiveTipped)
        const half = tag.size / 2
        const r = pose.rotation
        return {
          id: tag.id,
          size: tag.size,
          center: { ...pose.position },
          normal: { x: -r[2], y: -r[5], z: -r[8] },
          corners: OCCLUSION_SAMPLES.slice(0, 4).map(([u, v]) => tagPoint(pose, half, u, v)),
          outer: OCCLUSION_SAMPLES.slice(0, 4).map(([u, v]) =>
            tagPoint(pose, half * WHITE_BORDER_SCALE, u, v)
          ),
          samples: OCCLUSION_SAMPLES.map(([u, v]) => tagPoint(pose, half, u, v))
        }
      })
  }

  // 참 렌즈 값(cameraData.trueIntrinsics, (모델, w, h)마다 한 번)
  lens(model: CameraModelId, width: number, height: number): Intrinsics {
    for (const e of this.intrinsics)
      if (e.model === model && e.w === width && e.h === height) return e.k
    const t = trueIntrinsics(model, width, height)
    const k = { fx: t.fx, fy: t.fy, cx: t.cx, cy: t.cy }
    this.intrinsics.push({ model, w: width, h: height, k })
    return k
  }

  // 카메라 필드 자세(센서 틀)와 해상도·데시메이션으로 모든 태그를 판정한다(id 오름차순, 보이지 않는 것도 rejection으로).
  // 판정 순서(처음 실패한 것이 rejection): behind → facingAway → outOfFrame → grazing → tooSmall → occluded
  observe(
    pose: SensorPose,
    model: CameraModelId,
    width: number,
    height: number,
    decimation: number
  ): TagObservation[] {
    const k = this.lens(model, width, height)
    const o = pose.origin
    const r = pose.rotation
    // 필드 점 → OpenCV 카메라 좌표: c = CV_FROM_SENSOR·Rᵀ·(P − O). Rᵀ·d의 성분은 센서 축(R의 열)과의 내적이다
    const toCamera = (p: Vec3): Vec3 => {
      const dx = p.x - o.x
      const dy = p.y - o.y
      const dz = p.z - o.z
      const sx = r[0] * dx + r[3] * dy + r[6] * dz
      const sy = r[1] * dx + r[4] * dy + r[7] * dz
      const sz = r[2] * dx + r[5] * dy + r[8] * dz
      const m = CV_FROM_SENSOR
      return {
        x: m[0] * sx + m[1] * sy + m[2] * sz,
        y: m[3] * sx + m[4] * sy + m[5] * sz,
        z: m[6] * sx + m[7] * sy + m[8] * sz
      }
    }
    // 핀홀 투영(왜곡 없음 [결정: spec-4d §7, 참 렌즈 값으로 투영하고 왜곡은 넣지 않는다])
    const project = (c: Vec3): [number, number] => [
      (k.fx * c.x) / c.z + k.cx,
      (k.fy * c.y) / c.z + k.cy
    ]
    const d = decimation < 1 ? 1 : decimation
    const minSide = Math.max(MIN_SIDE_PX, MIN_SIDE_PER_DECIMATION * d)
    const out: TagObservation[] = []
    for (const tag of this.tags) {
      const reject = (
        rejection: TagRejection,
        corners: TagObservation['corners'] = [0, 0, 0, 0, 0, 0, 0, 0],
        shortSide = 0
      ): void => {
        out.push({ id: tag.id, corners, shortSide, visible: false, rejection })
      }
      const cornersCam = tag.corners.map(toCamera)
      const outerCam = tag.outer.map(toCamera)
      if (
        cornersCam.some((c) => !(c.z > MIN_CAMERA_DEPTH)) ||
        outerCam.some((c) => !(c.z > MIN_CAMERA_DEPTH))
      ) {
        reject('behind')
        continue
      }
      const pixels = cornersCam.map(project)
      const corners = pixels.flat() as TagObservation['corners']
      let shortSide = Infinity
      for (let i = 0; i < 4; i++) {
        const a = pixels[i]
        const b = pixels[(i + 1) % 4]
        shortSide = Math.min(shortSide, Math.hypot(b[0] - a[0], b[1] - a[1]))
      }
      const toward = { x: o.x - tag.center.x, y: o.y - tag.center.y, z: o.z - tag.center.z }
      if (!(dot(toward, tag.normal) > 0)) {
        reject('facingAway', corners, shortSide)
        continue
      }
      const inFrame = (p: [number, number]): boolean =>
        p[0] >= 0 && p[0] <= width - 1 && p[1] >= 0 && p[1] <= height - 1
      if (!outerCam.map(project).every(inFrame)) {
        reject('outOfFrame', corners, shortSide)
        continue
      }
      let grazing = false
      for (let i = 0; i < 4; i++) {
        const p = pixels[i]
        const prev = pixels[(i + 3) % 4]
        const next = pixels[(i + 1) % 4]
        const ax = prev[0] - p[0]
        const ay = prev[1] - p[1]
        const bx = next[0] - p[0]
        const by = next[1] - p[1]
        const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))
        // 길이 0인 변은 cos가 NaN이라 스침으로 본다(사각형이 아니다)
        if (!(Math.abs(cos) <= GRAZING_COS)) grazing = true
      }
      if (grazing) {
        reject('grazing', corners, shortSide)
        continue
      }
      if (shortSide < minSide) {
        reject('tooSmall', corners, shortSide)
        continue
      }
      const occluded = tag.samples.some((s) => {
        const v = { x: s.x - o.x, y: s.y - o.y, z: s.z - o.z }
        const length = Math.hypot(v.x, v.y, v.z)
        const dir = { x: v.x / length, y: v.y / length, z: v.z / length }
        return this.caster.blocked(o, dir, length - OCCLUSION_END_MARGIN, 'occludes')
      })
      if (occluded) {
        reject('occluded', corners, shortSide)
        continue
      }
      out.push({ id: tag.id, corners, shortSide, visible: true, rejection: null })
    }
    return out
  }
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

// 세계 입력 tags(평평한 배열, 보이는 것만, id 오름차순, MAX_TAG_DETECTIONS까지): 태그마다 [id, x0, y0, …, x3, y3].
// 꼭짓점 = corners + APRILTAG_PIXEL_ORIGIN(apriltag 3 좌표)이고, noise가 켜져 있으면 그 뒤 꼭짓점 좌표마다 σ 0.3 px 가우스
// noiseGaussian(seed, device, id·8 + 꼭짓점·2 + 축, frameNanos)를 더한다(판정은 잡음 전이라 검출 여부가 바뀌지 않는다).
export function tagsInput(
  observations: readonly TagObservation[],
  device: string,
  frameNanos: number,
  noise: WorldSpec['noise']
): number[] {
  const visible = observations.filter((o) => o.visible).sort((a, b) => a.id - b.id)
  const out: number[] = []
  for (const o of visible.slice(0, MAX_TAG_DETECTIONS)) {
    out.push(o.id)
    for (let i = 0; i < 8; i++) {
      let value = o.corners[i] + APRILTAG_PIXEL_ORIGIN
      if (noise.enabled)
        value += TAG_CORNER_NOISE_PX * noiseGaussian(noise.seed, device, o.id * 8 + i, frameNanos)
      out.push(value)
    }
  }
  return out
}
