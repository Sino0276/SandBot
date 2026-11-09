import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  CAMERA_MODEL_IDS,
  CAMERA_MODELS,
  DEFAULT_CAMERA_MODEL,
  FALLBACK_FOCAL_LENGTH,
  isCameraModelId,
  sdkCalibration,
  trueIntrinsics,
  type CameraCalibrationEntry,
  type CameraModelId,
  type TrueIntrinsics
} from './cameraData'

// spec-4d 부록 A(scratchpad/p13field/s4d/calib.py가 XML로 계산한 표, 소수 여섯째까지): 모델, 해상도, 종류, 출처 해상도,
// fx, fy, cx, cy(px)
const TABLE: [
  CameraModelId,
  number,
  number,
  TrueIntrinsics['source'],
  [number, number],
  number,
  number,
  number,
  number
][] = [
  ['lifecamHd3000', 640, 480, 'exact', [640, 480], 678.153992, 678.169983, 318.13501, 228.373993],
  [
    'lifecamHd3000',
    640,
    360,
    'heightRatio',
    [640, 480],
    508.615494,
    508.627487,
    318.601257,
    171.280495
  ],
  ['lifecamHd3000', 800, 600, 'scaled', [640, 480], 847.692505, 847.712463, 397.668762, 285.467499],
  [
    'lifecamHd3000',
    1280,
    720,
    'heightRatio',
    [640, 480],
    1017.230988,
    1017.254974,
    637.202515,
    342.560989
  ],
  [
    'lifecamHd3000',
    1920,
    1080,
    'heightRatio',
    [640, 480],
    1525.846481,
    1525.882462,
    955.803772,
    513.841484
  ],
  ['lifecamHd3000', 320, 240, 'scaled', [640, 480], 339.076996, 339.084991, 159.067505, 114.186996],
  [
    'lifecamHd3000',
    1280,
    960,
    'scaled',
    [640, 480],
    1356.307983,
    1356.339966,
    636.27002,
    456.747986
  ],
  [
    'lifecamHd3000',
    800,
    448,
    'heightRatio',
    [640, 480],
    632.943726,
    632.958651,
    398.259342,
    213.14906
  ],
  ['logitechC310', 640, 480, 'exact', [640, 480], 821.992981, 821.992981, 330.489014, 248.996994],
  ['logitechC310', 640, 360, 'exact', [640, 360], 715.307007, 715.307007, 319.759003, 188.917007],
  [
    'logitechC310',
    800,
    600,
    'scaled',
    [640, 480],
    1027.491211,
    1027.491211,
    413.111267,
    311.246246
  ],
  [
    'logitechC310',
    1280,
    720,
    'scaled',
    [640, 360],
    1430.614014,
    1430.614014,
    639.518005,
    377.834015
  ],
  [
    'logitechC310',
    1920,
    1080,
    'scaled',
    [640, 360],
    2145.920898,
    2145.920898,
    959.276978,
    566.751038
  ],
  ['logitechC310', 320, 240, 'scaled', [640, 480], 410.99649, 410.99649, 165.244507, 124.498497],
  [
    'logitechC310',
    1280,
    960,
    'scaled',
    [640, 480],
    1643.985962,
    1643.985962,
    660.978027,
    497.993988
  ],
  [
    'logitechC310',
    800,
    448,
    'heightRatio',
    [640, 480],
    767.193449,
    767.193449,
    409.789746,
    232.397194
  ],
  ['logitechC920', 640, 480, 'exact', [640, 480], 622.000977, 622.000977, 319.803009, 241.251007],
  ['logitechC920', 640, 360, 'exact', [640, 360], 463.56601, 463.56601, 316.402008, 176.412003],
  ['logitechC920', 800, 600, 'exact', [800, 600], 775.789978, 775.789978, 400.89801, 300.790009],
  ['logitechC920', 1280, 720, 'scaled', [1920, 1080], 923.946716, 923.946716, 634.654663, 356.056],
  [
    'logitechC920',
    1920,
    1080,
    'exact',
    [1920, 1080],
    1385.920044,
    1385.920044,
    951.981995,
    534.083984
  ],
  ['logitechC920', 320, 240, 'scaled', [640, 480], 311.000488, 311.000488, 159.901505, 120.625504],
  [
    'logitechC920',
    1280,
    960,
    'scaled',
    [800, 600],
    1241.263916,
    1241.263916,
    641.436829,
    481.264008
  ],
  ['logitechC920', 800, 448, 'exact', [800, 448], 578.271973, 578.271973, 402.144989, 221.505997],
  ['logitechC270', 640, 480, 'exact', [640, 480], 822.317017, 822.317017, 319.494995, 242.501999],
  [
    'logitechC270',
    640,
    360,
    'heightRatio',
    [640, 480],
    616.737762,
    616.737762,
    319.621246,
    181.876499
  ],
  ['logitechC270', 800, 600, 'scaled', [640, 480], 1027.89624, 1027.89624, 399.368744, 303.127502],
  [
    'logitechC270',
    1280,
    720,
    'heightRatio',
    [640, 480],
    1233.475525,
    1233.475525,
    639.242493,
    363.752998
  ],
  [
    'logitechC270',
    1920,
    1080,
    'heightRatio',
    [640, 480],
    1850.213287,
    1850.213287,
    958.863739,
    545.629498
  ],
  ['logitechC270', 320, 240, 'scaled', [640, 480], 411.158508, 411.158508, 159.747498, 121.250999],
  [
    'logitechC270',
    1280,
    960,
    'scaled',
    [640, 480],
    1644.634033,
    1644.634033,
    638.98999,
    485.003998
  ],
  [
    'logitechC270',
    800,
    448,
    'heightRatio',
    [640, 480],
    767.495882,
    767.495882,
    399.528662,
    226.335199
  ],
  ['gobilda3122', 640, 480, 'exact', [640, 480], 481.984985, 481.984985, 334.203003, 241.947998],
  ['gobilda3122', 640, 360, 'scaled', [1280, 720], 482.072998, 482.072998, 318.550507, 184.672501],
  ['gobilda3122', 800, 600, 'exact', [800, 600], 602.426025, 602.426819, 416.25, 302.575989],
  ['gobilda3122', 1280, 720, 'exact', [1280, 720], 964.145996, 964.145996, 637.101013, 369.345001],
  [
    'gobilda3122',
    1920,
    1080,
    'exact',
    [1920, 1080],
    1432.031982,
    1432.031982,
    997.085022,
    535.890991
  ],
  ['gobilda3122', 320, 240, 'scaled', [640, 480], 240.992493, 240.992493, 167.101501, 120.973999],
  ['gobilda3122', 1280, 960, 'scaled', [800, 600], 963.881653, 963.882935, 666.0, 484.121582],
  ['gobilda3122', 800, 448, 'crop', [800, 600], 602.426025, 602.426819, 416.25, 226.575989]
]

describe('cameraData (spec-4d K5)', () => {
  it('모델 목록·기본·형식 확인', () => {
    expect(CAMERA_MODEL_IDS).toEqual([
      'logitechC920',
      'logitechC270',
      'logitechC310',
      'lifecamHd3000',
      'gobilda3122'
    ])
    expect(DEFAULT_CAMERA_MODEL).toBe('logitechC920')
    expect(isCameraModelId('gobilda3122')).toBe(true)
    expect(isCameraModelId('logitechC930')).toBe(false)
    expect(isCameraModelId(3)).toBe(false)
    expect(Object.keys(CAMERA_MODELS)).toEqual(CAMERA_MODEL_IDS)
    for (const id of CAMERA_MODEL_IDS)
      for (const c of CAMERA_MODELS[id].calibrations)
        for (const v of [c.fx, c.fy, c.cx, c.cy]) expect(Math.fround(v)).toBe(v)
  })

  it('부록 A 표 전부(1e-6)', () => {
    for (const [model, w, h, source, from, fx, fy, cx, cy] of TABLE) {
      const t = trueIntrinsics(model, w, h)
      const where = `${model} ${w}×${h}`
      expect(t.source, where).toBe(source)
      expect(t.from, where).toEqual(from)
      expect(Math.abs(t.fx - fx), where).toBeLessThan(1e-6)
      expect(Math.abs(t.fy - fy), where).toBeLessThan(1e-6)
      expect(Math.abs(t.cx - cx), where).toBeLessThan(1e-6)
      expect(Math.abs(t.cy - cy), where).toBeLessThan(1e-6)
      const sdk = sdkCalibration(model, w, h)
      if (source === 'exact' || source === 'scaled') {
        // SDK와 참값이 같은 float 값
        expect(sdk, where).toEqual({ kind: source, fx: t.fx, fy: t.fy, cx: t.cx, cy: t.cy, from })
        for (const v of [t.fx, t.fy, t.cx, t.cy]) expect(Math.fround(v)).toBe(v)
      } else {
        // 다른 종횡비뿐이면 SDK는 Placeholder(578.272)를 쓴다
        expect(sdk, where).toEqual({ kind: 'placeholder' })
      }
    }
  })

  it('C920 1280×720은 대각선 차가 같은 두 보정 중 double로 앞서는 1920×1080을 줄인다', () => {
    expect(sdkCalibration('logitechC920', 1280, 720)).toMatchObject({
      kind: 'scaled',
      from: [1920, 1080]
    })
  })
})

// SDK 내장 보정 XML(RobotCore 12.0 AAR res/xml, pnpm fetch:ftc-sdk가 꺼냄). 없으면 A6의 XML 대조만 건너뛴다
const XML_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'sidecar',
  'build',
  'ftc-sdk',
  '12.0.0',
  'builtinwebcamcalibrations.xml'
)
const XML_SHA256 = '43febb0ee76f4336242cc26ea79ca2fdb52943ff78bd4333e156b3bade1c5106'

// UsbConstants의 vid 이름(내장 XML이 쓰는 것만, javap로 확인: Logitech 1133 = 0x046D, Microsoft 1118 = 0x045E)
const VENDOR_IDS: Record<string, number> = { LOGITECH: 0x046d, MICROSOFT: 0x045e }

// Java Integer.decode(10진·0x·#·앞의 0은 8진)
function decode(text: string): number {
  if (/^0x/i.test(text)) return parseInt(text.slice(2), 16)
  if (text.startsWith('#')) return parseInt(text.slice(1), 16)
  if (/^0[0-7]+$/.test(text)) return parseInt(text, 8)
  if (/^-?\d+$/.test(text)) return parseInt(text, 10)
  throw new Error(`Integer.decode ${text}`)
}

// CameraCalibrationManager 규칙의 TS판(내장 XML이 쓰는 꼴만): 쉼표 → 공백, \s+로 나눔, 정수는 decode, 실수는
// Float.parseFloat(f 접미사)
const numbers = (text: string): string[] => text.replace(/,/g, ' ').trim().split(/\s+/)
const floats = (text: string): number[] =>
  numbers(text).map((v) => Math.fround(parseFloat(v.replace(/[fF]$/, ''))))

type XmlCamera = { vid: number; pid: number; calibrations: CameraCalibrationEntry[] }

function parseCalibrationXml(xml: string): XmlCamera[] {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '')
  const cameras: XmlCamera[] = []
  for (const camera of body.matchAll(/<Camera\s+([^>]*)>([\s\S]*?)<\/Camera>/g)) {
    const attr = (text: string, name: string): string =>
      (new RegExp(`${name}="([^"]*)"`).exec(text) as RegExpExecArray)[1]
    const vidText = attr(camera[1], 'vid')
    const vid = VENDOR_IDS[vidText.toUpperCase()] ?? decode(vidText)
    const pid = decode(attr(camera[1], 'pid'))
    const calibrations: CameraCalibrationEntry[] = []
    for (const c of camera[2].matchAll(/<Calibration\s+([\s\S]*?)\/>/g)) {
      const [width, height] = numbers(attr(c[1], 'size')).map(decode)
      const [fx, fy] = floats(attr(c[1], 'focalLength'))
      const [cx, cy] = floats(attr(c[1], 'principalPoint'))
      // 왜곡 계수는 옮기지 않지만 8개인지는 본다(SDK가 8개가 아니면 그 보정을 버린다)
      expect(floats(attr(c[1], 'distortionCoefficients'))).toHaveLength(8)
      calibrations.push({ width, height, fx, fy, cx, cy })
    }
    cameras.push({ vid, pid, calibrations })
  }
  return cameras
}

describe('cameraData 대 SDK 내장 보정 XML (A6)', () => {
  it.skipIf(!existsSync(XML_PATH))('모델·vid·pid·크기·fx·fy·cx·cy(float)가 XML과 같다', () => {
    const xml = readFileSync(XML_PATH)
    expect(createHash('sha256').update(xml).digest('hex')).toBe(XML_SHA256)
    const cameras = parseCalibrationXml(xml.toString('utf8'))
    // XML의 카메라는 모두 모델 하나의 pid나 alias다(같은 값인 두 pid는 한 모델)
    const seen = new Set<CameraModelId>()
    for (const camera of cameras) {
      const id = CAMERA_MODEL_IDS.find(
        (m) =>
          CAMERA_MODELS[m].vid === camera.vid &&
          (CAMERA_MODELS[m].pid === camera.pid || CAMERA_MODELS[m].aliases.includes(camera.pid))
      )
      expect(id, `vid ${camera.vid} pid ${camera.pid}`).toBeDefined()
      expect(CAMERA_MODELS[id as CameraModelId].calibrations).toEqual(camera.calibrations)
      seen.add(id as CameraModelId)
    }
    expect([...seen].sort()).toEqual([...CAMERA_MODEL_IDS].sort())
    // alias까지 XML 카메라 수와 같다(LifeCam 둘, C310, C920 둘, C270, goBILDA)
    expect(cameras).toHaveLength(7)
  })
})

describe('참 렌즈 값 규칙 (A6·A7)', () => {
  it('C920 1280×720 = 1920×1080 scaled(923.946716·634.654663·356.056000), 800×448 exact(578.271973)', () => {
    const c = sdkCalibration('logitechC920', 1280, 720)
    if (c.kind === 'placeholder') throw new Error('scaled여야 한다')
    expect(Math.abs(c.fx - 923.946716)).toBeLessThan(1e-6)
    expect(Math.abs(c.cx - 634.654663)).toBeLessThan(1e-6)
    expect(Math.abs(c.cy - 356.056)).toBeLessThan(1e-6)
    const exact = sdkCalibration('logitechC920', 800, 448)
    expect(exact).toMatchObject({ kind: 'exact', from: [800, 448] })
    if (exact.kind === 'placeholder') throw new Error('exact여야 한다')
    expect(Math.abs(exact.fx - 578.271973)).toBeLessThan(1e-6)
    // SDK 대체값(578.272)과 float로 우연히 같다
    expect(exact.fx).toBe(Math.fround(FALLBACK_FOCAL_LENGTH))
  })

  it('LifeCam 1280×720 heightRatio, goBILDA 800×448 crop', () => {
    const lifecam = trueIntrinsics('lifecamHd3000', 1280, 720)
    expect(lifecam).toMatchObject({ source: 'heightRatio', from: [640, 480] })
    expect(Math.abs(lifecam.fx - 1017.230988)).toBeLessThan(1e-6)
    expect(Math.abs(lifecam.cx - 637.202515)).toBeLessThan(1e-6)
    expect(Math.abs(lifecam.cy - 342.560989)).toBeLessThan(1e-6)
    expect(sdkCalibration('lifecamHd3000', 1280, 720)).toEqual({ kind: 'placeholder' })
    const gobilda = trueIntrinsics('gobilda3122', 800, 448)
    expect(gobilda).toMatchObject({ source: 'crop', from: [800, 600] })
    expect(Math.abs(gobilda.fx - 602.426025)).toBeLessThan(1e-6)
    expect(Math.abs(gobilda.fy - 602.426819)).toBeLessThan(1e-6)
    expect(Math.abs(gobilda.cx - 416.25)).toBeLessThan(1e-6)
    expect(Math.abs(gobilda.cy - 226.575989)).toBeLessThan(1e-6)
  })
})
