import { describe, expect, it } from 'vitest'
import { isTagsInput, TAG_INPUT_STRIDE } from '../sidecarProtocol'
import { resolveSeason } from './seasons/seasons'
import {
  APRILTAG_PIXEL_ORIGIN,
  CV_FROM_SENSOR,
  FieldVision,
  frameDue,
  frameGridNanos,
  OCCLUSION_SAMPLES,
  readCameraOutputs,
  tagsInput,
  type TagObservation
} from './vision'

// 4d 계약 시험(spec-4d A2·A5 형식 부분·K10). 투영·판정 값 시험은 4d A가 더한다.

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

describe('FieldVision 계약 스텁', () => {
  it('BIOBUZZ 16태그를 id 오름차순으로 낸다(계약은 모두 behind)', () => {
    const vision = new FieldVision(resolveSeason('biobuzz'), [false, false])
    const pose = {
      origin: { x: 1.336, y: -0.32385, z: 0.3 },
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1]
    }
    const observed = vision.observe(pose, 'logitechC920', 640, 480, 3)
    expect(observed.map((o) => o.id)).toEqual(Array.from({ length: 16 }, (_, i) => 30 + i))
    expect(observed.every((o) => !o.visible && o.rejection === 'behind')).toBe(true)
    expect(
      new FieldVision(resolveSeason('none'), [false, false]).observe(
        pose,
        'logitechC920',
        640,
        480,
        3
      )
    ).toEqual([])
  })
})
