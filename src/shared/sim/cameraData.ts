// 웹캠 카메라 모델 표(4d, spec-4d §1.2). 렌즈 값은 FTC SDK 12.0 RobotCore AAR의 res/xml/builtinwebcamcalibrations.xml
// (sha256 43febb0ee76f4336242cc26ea79ca2fdb52943ff78bd4333e156b3bade1c5106)을 손으로 옮긴 상수다(렌더러·메인은 런타임에
// AAR이 없다). 왜곡 계수는 옮기지 않는다(시뮬레이터는 왜곡을 투영하지 않는다, spec-4d §1.5).
// 이 파일은 아무것도 import하지 않는다(worldSpec.ts가 값으로 import한다, 순환 없음).
//
// 사이드카 쪽 같은 표(SandbotCameraModels.java)와 XML 대조는 시험으로 묶는다(spec-4d A6·B13).

export type CameraModelId =
  'logitechC920' | 'logitechC270' | 'logitechC310' | 'lifecamHd3000' | 'gobilda3122'

// UI 순서(카탈로그 선택지). 기본 C920은 내장 보정이 가장 많은 모델이다 [결정, synthesis §5.1]
export const CAMERA_MODEL_IDS: readonly CameraModelId[] = [
  'logitechC920',
  'logitechC270',
  'logitechC310',
  'lifecamHd3000',
  'gobilda3122'
]
export const DEFAULT_CAMERA_MODEL: CameraModelId = 'logitechC920'

export function isCameraModelId(value: unknown): value is CameraModelId {
  return typeof value === 'string' && (CAMERA_MODEL_IDS as readonly string[]).includes(value)
}

// XML 한 줄. 값은 Math.fround로 float로 잘라 둔다(SDK CameraIntrinsics의 필드가 float, XML 글자는 Float.parseFloat)
export type CameraCalibrationEntry = {
  width: number
  height: number
  fx: number
  fy: number
  cx: number
  cy: number
}

export type CameraModelSpec = {
  // USB 제조사(RobotCore UsbConstants: Logitech 1133 = 0x046D, Microsoft 1118 = 0x045E, javap로 확인; goBILDA 카메라는
  // XML vid "0xBDA" = 3034, UsbConstants의 VENDOR_ID_AUSDOM과 같은 값)
  vid: number
  // 보정 식별자에 쓰는 pid(같은 값의 다른 pid는 aliases)
  pid: number
  // XML에서 같은 값을 가진 다른 pid(C920 0x08E5, LifeCam 0x0810)
  aliases: readonly number[]
  // XML 순서
  calibrations: readonly CameraCalibrationEntry[]
  // 다른 종횡비 해상도의 참 렌즈 값을 만드는 규칙 [가정: 다른 종횡비 참 렌즈 값]: 'crop' = 모든 모드가 같은 픽셀 축척
  // (센서를 자름), 'heightRatio' = 높이 비로 줄임. goBILDA만 'crop'(4:3과 16:9의 fx가 같은 크기에서 1.000배), 나머지
  // 'heightRatio'(C920은 0.745 ≈ 높이 비 0.75로 확인, C310은 0.870로 어느 쪽도 아니라 높이 비로 둠, C270·LifeCam은
  // 640×480 하나뿐이라 근거 없음, spec-4d §1.2)
  aspectRule: 'crop' | 'heightRatio'
}

const f = Math.fround

// XML 한 줄(글자 그대로의 값을 float로)
function cal(
  width: number,
  height: number,
  fx: number,
  fy: number,
  cx: number,
  cy: number
): CameraCalibrationEntry {
  return { width, height, fx: f(fx), fy: f(fy), cx: f(cx), cy: f(cy) }
}

export const CAMERA_MODELS: Readonly<Record<CameraModelId, CameraModelSpec>> = {
  // Logitech HD Pro Webcam C920(XML pid 0x082D, 같은 값의 0x08E5)
  logitechC920: {
    vid: 0x046d,
    pid: 0x082d,
    aliases: [0x08e5],
    calibrations: [
      cal(640, 480, 622.001, 622.001, 319.803, 241.251),
      cal(800, 600, 775.79, 775.79, 400.898, 300.79),
      cal(640, 360, 463.566, 463.566, 316.402, 176.412),
      cal(1920, 1080, 1385.92, 1385.92, 951.982, 534.084),
      cal(800, 448, 578.272, 578.272, 402.145, 221.506),
      cal(864, 480, 626.909, 626.909, 426.007, 236.834)
    ],
    aspectRule: 'heightRatio'
  },
  // Logitech HD Webcam C270(XML pid 0x0825)
  logitechC270: {
    vid: 0x046d,
    pid: 0x0825,
    aliases: [],
    calibrations: [cal(640, 480, 822.317, 822.317, 319.495, 242.502)],
    aspectRule: 'heightRatio'
  },
  // Logitech HD Webcam C310(XML pid 0x081B)
  logitechC310: {
    vid: 0x046d,
    pid: 0x081b,
    aliases: [],
    calibrations: [
      cal(640, 480, 821.993, 821.993, 330.489, 248.997),
      cal(640, 360, 715.307, 715.307, 319.759, 188.917)
    ],
    aspectRule: 'heightRatio'
  },
  // Microsoft LifeCam HD-3000(XML pid 0x0779, 같은 값의 0x0810)
  lifecamHd3000: {
    vid: 0x045e,
    pid: 0x0779,
    aliases: [0x0810],
    calibrations: [cal(640, 480, 678.154, 678.17, 318.135, 228.374)],
    aspectRule: 'heightRatio'
  },
  // goBILDA USB Camera SKU 3122-0003-0001(XML vid 0xBDA, pid 0x5805)
  gobilda3122: {
    vid: 0x0bda,
    pid: 0x5805,
    aliases: [],
    calibrations: [
      cal(1920, 1080, 1432.032, 1432.032, 997.085, 535.891),
      cal(1280, 720, 964.146, 964.146, 637.101, 369.345),
      cal(800, 600, 602.426, 602.4268, 416.25, 302.576),
      cal(640, 480, 481.985, 481.985, 334.203, 241.948)
    ],
    aspectRule: 'crop'
  }
}

// SDK가 보정이 없을 때 쓰는 대체 초점거리(Vision 12.0 AprilTagProcessorImpl.java:220–223, cx = w/2, cy = h/2)
export const FALLBACK_FOCAL_LENGTH = 578.272

// SDK가 고를 보정(RobotCore 12.0 CameraCalibrationManager.internalGetCalibration을 옮김, spec-4d §1.13): 같은 크기 →
// 같은 종횡비 중 대각선 차가 가장 작은 것의 scaledTo(폭 비) → 다른 종횡비만 있으면 placeholder
export type SdkCalibration =
  | {
      kind: 'exact' | 'scaled'
      fx: number
      fy: number
      cx: number
      cy: number
      from: [number, number]
    }
  | { kind: 'placeholder' }

// Misc.approximatelyEquals(RobotCore Misc.java:253–263): 같으면 참, 아니면 상대 오차(b가 0이면 |a|) < 1e-9
function approximatelyEquals(a: number, b: number): boolean {
  if (a === b) return true
  const error = b === 0 ? Math.abs(a) : Math.abs(a / b - 1)
  return error < 1e-9
}

// 대각선(CameraCalibrationManager: Math.sqrt(w*w + h*h), double)
function diagonal(width: number, height: number): number {
  return Math.sqrt(width * width + height * height)
}

// 대각선 차로 안정 정렬한 첫 항목(Arrays.sort의 객체 정렬은 안정이라 같은 차면 XML 순서). 비면 null
function nearestByDiagonal(
  entries: readonly CameraCalibrationEntry[],
  width: number,
  height: number
): CameraCalibrationEntry | null {
  const target = diagonal(width, height)
  let best: CameraCalibrationEntry | null = null
  let bestDiff = Infinity
  for (const e of entries) {
    const diff = Math.abs(diagonal(e.width, e.height) - target)
    // 엄격히 작을 때만 바꾼다(앞의 것이 이김 = 안정 정렬의 첫 항목)
    if (diff < bestDiff) {
      best = e
      bestDiff = diff
    }
  }
  return best
}

export function sdkCalibration(
  model: CameraModelId,
  width: number,
  height: number
): SdkCalibration {
  const entries = CAMERA_MODELS[model].calibrations
  for (const e of entries)
    if (e.width === width && e.height === height)
      return { kind: 'exact', fx: e.fx, fy: e.fy, cx: e.cx, cy: e.cy, from: [e.width, e.height] }
  // 종횡비는 double w/h(CameraCalibration.getAspectRatio)
  const aspect = width / height
  const sameAspect = entries.filter((e) => approximatelyEquals(e.width / e.height, aspect))
  const ref = nearestByDiagonal(sameAspect, width, height)
  if (ref === null) return { kind: 'placeholder' }
  // CameraCalibration.scaledTo(CameraCalibration.java:141–154): factor = newW / oldW(double), float 필드에 *=
  const factor = width / ref.width
  return {
    kind: 'scaled',
    fx: f(ref.fx * factor),
    fy: f(ref.fy * factor),
    cx: f(ref.cx * factor),
    cy: f(ref.cy * factor),
    from: [ref.width, ref.height]
  }
}

// 세계의 참 렌즈 값: sdkCalibration이 exact·scaled면 그 float 값, placeholder면 대각선이 가장 가까운 보정을 모델의
// aspectRule로 만든다(double, float로 자르지 않음) [가정: 다른 종횡비 참 렌즈 값, synthesis §5.8]
export type TrueIntrinsics = {
  fx: number
  fy: number
  cx: number
  cy: number
  source: 'exact' | 'scaled' | 'heightRatio' | 'crop'
  from: [number, number]
}

export function trueIntrinsics(
  model: CameraModelId,
  width: number,
  height: number
): TrueIntrinsics {
  const sdk = sdkCalibration(model, width, height)
  if (sdk.kind !== 'placeholder')
    return { fx: sdk.fx, fy: sdk.fy, cx: sdk.cx, cy: sdk.cy, source: sdk.kind, from: sdk.from }
  const spec = CAMERA_MODELS[model]
  // 모델마다 보정이 하나 이상 있으므로 null이 아니다
  const ref = nearestByDiagonal(spec.calibrations, width, height) as CameraCalibrationEntry
  const from: [number, number] = [ref.width, ref.height]
  if (spec.aspectRule === 'heightRatio') {
    // 높이 비: 같은 세로 시야(16:9 센서에서 4:3을 옆으로 자른 꼴의 거꾸로), 주점은 가운데에서의 차를 같은 비로
    const s = height / ref.height
    return {
      fx: ref.fx * s,
      fy: ref.fy * s,
      cx: width / 2 + (ref.cx - ref.width / 2) * s,
      cy: height / 2 + (ref.cy - ref.height / 2) * s,
      source: 'heightRatio',
      from
    }
  }
  // 자르기: 폭 비로 줄인 영상의 가운데를 잘라낸 것(모든 모드가 같은 픽셀 축척인 센서)
  const s = width / ref.width
  return {
    fx: ref.fx * s,
    fy: ref.fy * s,
    cx: ref.cx * s + (width - ref.width * s) / 2,
    cy: ref.cy * s + (height - ref.height * s) / 2,
    source: 'crop',
    from
  }
}
