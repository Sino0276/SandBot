import { describe, expect, it } from 'vitest'
import {
  CAMERA_MODEL_IDS,
  CAMERA_MODELS,
  DEFAULT_CAMERA_MODEL,
  isCameraModelId,
  sdkCalibration,
  trueIntrinsics,
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
