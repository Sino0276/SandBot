// 시뮬레이터 비전(4d, spec-4d §1.4·§1.5): 웹캠의 필드 자세에서 시즌 AprilTag의 꼭짓점을 참 렌즈 값으로 투영하고 보이는
// 조건을 걸러 원시 검출(id·꼭짓점 4개)을 만든다. 기하만 한다(처리 시간·프레임 버퍼·자세 풀이는 사이드카 VisionPortal·
// AprilTagProcessor 손 구현). 순수·결정적: 배열 순서만 쓰고 벽시계·Math.random·Map 순서를 쓰지 않는다.
//
// 픽셀 좌표는 둘이다(spec-4d §0). 투영·판정·인스펙터·기즈모는 OpenCV 좌표(첫 픽셀 중심 (0, 0), x 오른쪽, y 아래, 보정
// XML의 cx·cy가 이 좌표)이고, 세계 입력 tags의 꼭짓점은 apriltag 3 좌표(왼쪽 위 픽셀의 왼쪽 위 모서리가 (0, 0))라 OpenCV
// 좌표 + APRILTAG_PIXEL_ORIGIN이다.
//
// 계약(4d 계약 커밋)은 형식·상수·frameDue·readCameraOutputs·tagsInput을 구현하고, FieldVision.observe는 "모든 태그 behind"
// 스텁이다. 4d A가 구현한다.

import type { CameraModelId } from './cameraData'
import type { SensorPose } from './sensorFrame'
import { noiseGaussian } from './sensorNoise'
import type { FieldSpec } from './seasons/fieldSpec'
import { tagFieldPose, type FieldPose3 } from './seasons/tagPoses'
import { MAX_TAG_DETECTIONS, type DeviceValues } from '../sidecarProtocol'
import type { WorldSpec } from './worldSpec'

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

export class FieldVision {
  // id 오름차순 태그와 그 필드 자세(생성자에서 hiveTipped로 한 번 푼다)
  protected readonly tags: readonly { id: number; size: number; pose: FieldPose3 }[]

  constructor(
    protected readonly field: FieldSpec,
    hiveTipped: readonly [boolean, boolean]
  ) {
    this.tags = [...field.aprilTags.tags]
      .sort((a, b) => a.id - b.id)
      .map((tag) => ({ id: tag.id, size: tag.size, pose: tagFieldPose(field, tag, hiveTipped) }))
  }

  // 카메라 필드 자세(센서 틀)와 해상도·데시메이션으로 모든 태그를 판정한다(id 오름차순, 보이지 않는 것도 rejection으로).
  // 계약 스텁: 모든 태그가 behind(4d A가 구현한다).
  observe(
    pose: SensorPose,
    model: CameraModelId,
    width: number,
    height: number,
    decimation: number
  ): TagObservation[] {
    void pose
    void model
    void width
    void height
    void decimation
    return this.tags.map((tag) => ({
      id: tag.id,
      corners: [0, 0, 0, 0, 0, 0, 0, 0],
      shortSide: 0,
      visible: false,
      rejection: 'behind'
    }))
  }
}

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
