import i18n from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ColorReading } from '../../../../shared/sim/colorSensor'
import type { RangeReading } from '../../../../shared/sim/rangeSensor'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { sensorSurfaceLabel } from '../../field/fieldLabels'
import { createComponent } from '../../hardware/components'
import { SENSOR_HOUSING_WARN, type SensorMountInRobot } from '../../hardware/mounting'
import en from '../../i18n/locales/en'
import ko from '../../i18n/locales/ko'
import type { HardwareComponent, SceneObjects, Transform } from '../../scene/model'
import {
  colorDriverValues,
  sensorEditPose,
  sensorReadingModel,
  sensorReadingText,
  type SensorReadingModel
} from './sensorReading'

// 거리·컬러 센서 카드의 편집 자세 값 줄(spec-4c §1.9, C8). 광선 계산(A)은 이 갈래에서 스텁일 수 있어, 글자 시험은 읽기
// 값을 직접 만든 모델로, 꼬리 시험은 장착·자세만 본다(값이 첫 틱과 같은지(C9)는 통합 뒤 시험).

beforeAll(async () => {
  await i18n.init({
    resources: { ko: { translation: ko }, en: { translation: en } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

const t = (): typeof i18n.t => i18n.t.bind(i18n)
const BIOBUZZ = resolveSeason('biobuzz')
const NONE = resolveSeason('none')
const PI = Math.PI

const at = (x: number, y: number, z: number, yaw = 0): Transform => ({
  position: [x, y, z],
  rotation: [0, 0, yaw]
})

const FRONT_MOUNT: SensorMountInRobot = {
  position: { x: 0.2, y: 0, z: 0.1 },
  rotation: { x: 0, y: 0, z: 0 },
  housing: 'front',
  pivotOffset: 0.01
}

function rangeModel(reading: Partial<RangeReading>): SensorReadingModel {
  return {
    kind: 'distance',
    reading: {
      distance: null,
      raw: null,
      reflectance: 0,
      maxRange: 0,
      surface: null,
      rays: [],
      ...reading
    },
    mount: FRONT_MOUNT,
    pose: { origin: { x: 0, y: 0, z: 0.1 }, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    spec: BIOBUZZ,
    tails: []
  }
}

function colorModel(reading: Partial<ColorReading>, gain = 2): SensorReadingModel {
  return {
    kind: 'color',
    reading: {
      red: 79,
      green: 85,
      blue: 55,
      proximity: 27,
      distance: null,
      surface: null,
      footprint: [],
      ...reading
    },
    mount: FRONT_MOUNT,
    pose: { origin: { x: 0, y: 0, z: 0.015 }, rotation: [0, 0, -1, 0, 1, 0, 1, 0, 0] },
    spec: BIOBUZZ,
    gain,
    tails: []
  }
}

const tapeIndex = (key: string, alliance: 'red' | 'blue'): number =>
  BIOBUZZ.tape.findIndex((tape) => tape.key === key && tape.alliance === alliance)

describe('sensorSurfaceLabel', () => {
  it('바닥·얼라이언스 테이프·벽 이름 레일·투명판·구조물', () => {
    expect(sensorSurfaceLabel(BIOBUZZ, { kind: 'floor' }, t())).toBe('바닥 타일')
    expect(
      sensorSurfaceLabel(
        BIOBUZZ,
        { kind: 'tape', index: tapeIndex('loadingZoneFront', 'red') },
        t()
      )
    ).toBe('빨강 LOADING ZONE 앞 테이프')
    expect(
      sensorSurfaceLabel(BIOBUZZ, { kind: 'tape', index: tapeIndex('garden', 'blue') }, t())
    ).toBe('파랑 GARDEN 테이프')
    const plusX = BIOBUZZ.walls!.plusX
    expect(sensorSurfaceLabel(BIOBUZZ, { kind: 'rail', wall: 'plusX' }, t())).toBe(
      `${i18n.t(`field.walls.${plusX}` as never)} 레일`
    )
    expect(sensorSurfaceLabel(BIOBUZZ, { kind: 'panel', wall: 'minusY' }, t())).toMatch(/ 투명판$/)
    // 'none'은 벽 라벨이 없어 일반 이름
    expect(sensorSurfaceLabel(NONE, { kind: 'panel', wall: 'plusX' }, t())).toBe('필드 벽 투명판')
    const flower = BIOBUZZ.structures.findIndex((s) => s.key === 'flower')
    expect(sensorSurfaceLabel(BIOBUZZ, { kind: 'structure', index: flower }, t())).toBe('FLOWER')
    // 시즌 밖 순번은 빈 글자
    expect(sensorSurfaceLabel(NONE, { kind: 'structure', index: 3 }, t())).toBe('')
  })

  it('영어', async () => {
    await i18n.changeLanguage('en')
    try {
      expect(
        sensorSurfaceLabel(
          BIOBUZZ,
          { kind: 'tape', index: tapeIndex('loadingZoneFront', 'red') },
          t()
        )
      ).toMatch(/^Red /)
    } finally {
      await i18n.changeLanguage('ko')
    }
  })
})

describe('편집 자세 값 글자', () => {
  it('거리: 유효·범위 밖·신호 약함, 표시 단위', () => {
    const valid = rangeModel({ distance: 0.5, raw: 0.5, surface: { kind: 'floor' } })
    expect(sensorReadingText(valid, t(), 'mm', {}).lines).toEqual([
      '편집 자세 값: 500.0 mm (바닥 타일)'
    ])
    expect(sensorReadingText(valid, t(), 'in', {}).lines).toEqual([
      '편집 자세 값: 19.685 in (바닥 타일)'
    ])
    const out = rangeModel({})
    expect(sensorReadingText(out, t(), 'in', {}).lines).toEqual([
      '편집 자세 값: 범위 밖(getDistance가 322.441 in를 돌려줌)'
    ])
    expect(sensorReadingText(out, t(), 'mm', {}).lines[0]).toContain('8190.0 mm')
    const weak = rangeModel({ raw: 0.162, reflectance: 0.0064, maxRange: 0.1556 })
    expect(sensorReadingText(weak, t(), 'cm', {}).lines).toEqual([
      '편집 자세 값: 신호 약함(반사율 0.006, 최대 15.56 cm)'
    ])
  })

  it('컬러: 드라이버 값(1.07·1.55, 65535 자름)·정규화·alpha·getDistance와 실제 거리', () => {
    // 부록 A 타일 1.5 cm: 309·331·213, PS 288 → 330·331·330, 정규화 0.0101(게인 2), alpha 0.625, 3.007 cm
    const driver = colorDriverValues({ red: 309, green: 331, blue: 213, proximity: 288 }, 2)
    expect([driver.red, driver.green, driver.blue]).toEqual([330, 331, 330])
    expect(driver.normalized[0]).toBeCloseTo(0.0101, 4)
    expect(Math.abs(driver.alpha - 0.625)).toBeLessThan(1e-3)
    expect(Math.abs(driver.getDistance - 0.03007)).toBeLessThan(1e-4)
    // 포화와 PS ≤ 26.98(물체 없음)의 6 in 상한, 정규화 1 상한
    const bright = colorDriverValues({ red: 65000, green: 65535, blue: 50000, proximity: 27 }, 2)
    expect([bright.red, bright.blue]).toEqual([65535, 65535])
    expect(bright.normalized).toEqual([1, 1, 1])
    expect(colorDriverValues({ red: 0, green: 0, blue: 0, proximity: 26 }, 1).getDistance).toBe(
      6 * 0.0254
    )
    // 아주 가까우면(PS 큼) 공식 값 그대로(6 in 아래)
    expect(
      colorDriverValues({ red: 0, green: 0, blue: 0, proximity: 2047 }, 1).getDistance
    ).toBeLessThan(0.02)

    const tile = colorModel({
      red: 309,
      green: 331,
      blue: 213,
      proximity: 288,
      distance: 0.015,
      surface: { kind: 'floor' }
    })
    expect(sensorReadingText(tile, t(), 'cm', {}).lines).toEqual([
      'red 330 · green 331 · blue 330 · 정규화(게인 2) 0.0101·0.0101·0.0101 · alpha 0.625',
      'getDistance 3.01 cm (실제 1.50 cm, 바닥 타일)'
    ])
    expect(sensorReadingText(colorModel({}), t(), 'cm', {}).lines[1]).toBe(
      i18n.t('hardware.sensorReading.colorNothing')
    )
  })

  it('꼬리 글자와 빠진 센서', () => {
    const model = rangeModel({ distance: 0.5, raw: 0.5, surface: { kind: 'floor' } })
    if (model.kind !== 'distance') throw new Error('distance')
    model.tails = [
      { key: 'onRobot' },
      { key: 'pivotLoading' },
      { key: 'pivot' },
      { key: 'farHousing', distance: 0.06 },
      { key: 'belowFloor' },
      { key: 'outsideField' },
      { key: 'selfHit', partId: 'bumper', distance: 0.03 },
      { key: 'selfHitPartial' }
    ]
    const objects = { bumper: { name: '범퍼' } } as unknown as SceneObjects
    const text = sensorReadingText(model, t(), 'mm', objects)
    expect(text.tails).toEqual([
      i18n.t('hardware.sensorReading.tails.onRobot'),
      i18n.t('hardware.sensorReading.tails.pivotLoading'),
      i18n.t('hardware.sensorReading.tails.pivot'),
      i18n.t('hardware.sensorReading.tails.farHousing', { distance: '60.0 mm' }),
      i18n.t('hardware.sensorReading.tails.belowFloor'),
      i18n.t('hardware.sensorReading.tails.outsideField'),
      i18n.t('hardware.sensorReading.tails.selfHit', { part: '범퍼', distance: '30.0 mm' }),
      i18n.t('hardware.sensorReading.tails.selfHitPartial')
    ])
    for (const reason of ['emptyName', 'duplicateName', 'tooMany', 'outsideRobot'] as const) {
      const excluded = sensorReadingText(
        { kind: 'excluded', type: 'distanceSensor', reason },
        t(),
        'mm',
        {}
      )
      expect(excluded).toEqual({
        lines: [i18n.t(`hardware.sensorReading.excluded.${reason}`)],
        tails: []
      })
    }
  })
})

// ---- 모델: 장착·자세·꼬리 ----

function sensor(type: 'distanceSensor' | 'colorSensor', props = {}): HardwareComponent {
  const component = createComponent(type, [], () => 'c-' + type)
  return {
    ...component,
    name: type === 'distanceSensor' ? 'front' : 'floor',
    props: { ...component.props, ...props }
  }
}

function scene(robot: Transform, sensorAt: Transform, extra: SceneObjects = {}): SceneObjects {
  return {
    bot: { id: 'bot', name: 'Bot', kind: 'robot', parentId: null, transform: robot },
    part: {
      id: 'part',
      name: 'Sensor',
      kind: 'part',
      parentId: 'bot',
      transform: sensorAt,
      visual: { type: 'mesh', geometryId: 'g:sensor', color: [0.5, 0.5, 0.5] }
    },
    ...extra
  }
}

const box = (half: number) => () => ({
  min: { x: -half, y: -half, z: -half },
  max: { x: half, y: half, z: half }
})

describe('sensorReadingModel', () => {
  it('편집 자세: 로봇 시작 자세(요는 감음)의 섀시 틀에 장착', () => {
    const objects = scene(at(1, 0.5, 0, (3 * PI) / 2), at(0.2, 0, 0.1))
    const component = sensor('distanceSensor')
    const model = sensorReadingModel({
      objects,
      objectId: 'part',
      component,
      season: 'biobuzz',
      bounds: box(0.01),
      exclusion: null,
      loading: false
    })
    if (model?.kind !== 'distance') throw new Error('distance model')
    // 요 270° = −90°: 로봇 +X가 필드 −Y. 하우징 앞면은 피벗 + 0.01
    expect(model.pose.origin.x).toBeCloseTo(1, 12)
    expect(model.pose.origin.y).toBeCloseTo(0.5 - 0.21, 12)
    expect(model.pose.origin.z).toBeCloseTo(0.1, 12)
    expect(model.pose.rotation[3]).toBeCloseTo(-1, 12)
    expect(model.mount.pivotOffset).toBeCloseTo(0.01, 12)
    expect(model.tails).toEqual([])
    expect(model.reading.rays).toHaveLength(61)
    const pose = sensorEditPose(objects, 'bot', model.mount)
    expect(pose).toEqual(model.pose)
  })

  it('컬러 센서의 게인과 기본 아래 조준', () => {
    const model = sensorReadingModel({
      objects: scene(at(0, 0, 0), at(0.1, 0, 0.03)),
      objectId: 'part',
      component: sensor('colorSensor', { gain: 2 }),
      season: 'none',
      bounds: box(0.01),
      exclusion: null,
      loading: false
    })
    if (model?.kind !== 'color') throw new Error('color model')
    expect(model.gain).toBe(2)
    // 아래(−90°)를 보므로 앞면은 피벗 아래 0.01
    expect(model.pose.origin.z).toBeCloseTo(0.02, 12)
    expect(model.pose.rotation[6]).toBeCloseTo(-1, 12)
  })

  it('꼬리: 로봇에 붙음, 피벗(읽는 중), 하우징이 멂, 바닥 아래, 필드 밖, 자기 가림', () => {
    const base = {
      component: sensor('distanceSensor'),
      season: 'biobuzz' as const,
      exclusion: null,
      loading: false
    }
    const onRobot = sensorReadingModel({
      ...base,
      objects: scene(at(0, 0, 0), at(0, 0, 0)),
      objectId: 'bot',
      bounds: box(0.01)
    })
    expect(onRobot?.kind === 'distance' && onRobot.tails).toEqual([{ key: 'onRobot' }])
    const pivot = sensorReadingModel({
      ...base,
      objects: scene(at(0, 0, 0), at(0.1, 0, 0.1)),
      objectId: 'part',
      bounds: () => null
    })
    expect(pivot?.kind === 'distance' && pivot.tails).toEqual([{ key: 'pivot' }])
    const loading = sensorReadingModel({
      ...base,
      loading: true,
      objects: scene(at(0, 0, 0), at(0.1, 0, 0.1)),
      objectId: 'part',
      bounds: () => null
    })
    expect(loading?.kind === 'distance' && loading.tails).toEqual([{ key: 'pivotLoading' }])
    // 투영 0.06 m > 0.05 → farHousing
    const far = sensorReadingModel({
      ...base,
      objects: scene(at(0, 0, 0), at(0.1, 0, 0.1)),
      objectId: 'part',
      bounds: box(0.06)
    })
    expect(far?.kind === 'distance' && far.tails).toEqual([{ key: 'farHousing', distance: 0.06 }])
    expect(0.06).toBeGreaterThan(SENSOR_HOUSING_WARN)
    // 아래를 보는 센서의 앞면이 바닥 3 mm 아래
    const below = sensorReadingModel({
      ...base,
      component: sensor('distanceSensor', { aimPitch: -PI / 2 }),
      objects: scene(at(0, 0, 0), at(0.1, 0, 0.007)),
      objectId: 'part',
      bounds: box(0.01)
    })
    expect(below?.kind === 'distance' && below.tails).toEqual([{ key: 'belowFloor' }])
    // 로봇이 벽 밖(BIOBUZZ 반폭 1.79286 m)
    const outside = sensorReadingModel({
      ...base,
      objects: scene(at(1.9, 0, 0), at(0, 0, 0.1)),
      objectId: 'part',
      bounds: box(0.01)
    })
    expect(outside?.kind === 'distance' && outside.tails).toEqual([{ key: 'outsideField' }])
    // 자기 가림: reach는 값이 없으면 1.2 m(거리), 축이면 파트·거리, 바깥만이면 partial
    const reaches: number[] = []
    const hit = sensorReadingModel({
      ...base,
      objects: scene(at(0, 0, 0), at(0.1, 0, 0.1)),
      objectId: 'part',
      bounds: box(0.01),
      selfHit: (_mount, reach) => {
        reaches.push(reach)
        return { kind: 'axis', partId: 'bumper', distance: 0.03 }
      }
    })
    expect(hit?.kind === 'distance' && hit.tails).toEqual([
      { key: 'selfHit', partId: 'bumper', distance: 0.03 }
    ])
    const partial = sensorReadingModel({
      ...base,
      component: sensor('colorSensor'),
      objects: scene(at(0, 0, 0), at(0.1, 0, 0.1)),
      objectId: 'part',
      bounds: box(0.01),
      selfHit: (_mount, reach) => {
        reaches.push(reach)
        return { kind: 'partial' }
      }
    })
    expect(partial?.kind === 'color' && partial.tails).toEqual([{ key: 'selfHitPartial' }])
    // 스텁 동안은 값이 없어 기본 reach다(통합 뒤에는 값의 거리)
    expect(reaches[0] === 1.2 || reaches[0] > 0).toBe(true)
    expect(reaches[1] > 0).toBe(true)
  })

  it('빠진 센서와 로봇 밖', () => {
    const excluded = sensorReadingModel({
      objects: scene(at(0, 0, 0), at(0.1, 0, 0.1)),
      objectId: 'part',
      component: sensor('distanceSensor'),
      season: 'none',
      bounds: null,
      exclusion: 'duplicateName',
      loading: false
    })
    expect(excluded).toEqual({ kind: 'excluded', type: 'distanceSensor', reason: 'duplicateName' })
    const loose: SceneObjects = {
      loose: { id: 'loose', name: 'Loose', kind: 'group', parentId: null, transform: at(0, 0, 0) }
    }
    const outside = sensorReadingModel({
      objects: loose,
      objectId: 'loose',
      component: sensor('colorSensor'),
      season: 'none',
      bounds: null,
      exclusion: null,
      loading: false
    })
    expect(outside).toEqual({ kind: 'excluded', type: 'colorSensor', reason: 'outsideRobot' })
    // 센서가 아닌 컴포넌트는 값 줄이 없다
    expect(
      sensorReadingModel({
        objects: scene(at(0, 0, 0), at(0.1, 0, 0.1)),
        objectId: 'part',
        component: createComponent('touchSensor', [], () => 'touch'),
        season: 'none',
        bounds: null,
        exclusion: null,
        loading: false
      })
    ).toBeNull()
  })
})
