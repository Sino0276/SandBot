import i18next, { type TFunction } from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { trueIntrinsics, type TrueIntrinsics } from '../../../../shared/sim/cameraData'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { FieldVision, type TagObservation } from '../../../../shared/sim/vision'
import en from '../../i18n/locales/en'
import ko from '../../i18n/locales/ko'
import { cameraExclusions } from '../../play/worldCameras'
import { objectLocalBounds } from '../../scene/localBounds'
import type { HardwareComponent, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { snapRobotToPreset } from '../field/startPresetModel'
import {
  cameraReadingModel,
  cameraReadingText,
  fieldVisionFor,
  visibleTagGroups,
  type CameraReadingInput,
  type CameraReadingModel
} from './cameraReading'

// 웹캠 카드의 편집 자세 줄(spec-4d §1.15, C4). 형식과 묶음·꼬리 규칙은 observe를 이중으로 보고, 실제 판정 값은 C4 기준 장면으로 본다.

let t: TFunction
beforeAll(async () => {
  const instance = i18next.createInstance()
  await instance.init({
    lng: 'ko',
    resources: { ko: { translation: ko }, en: { translation: en } },
    interpolation: { escapeValue: false }
  })
  t = instance.t
})

afterEach(() => {
  vi.restoreAllMocks()
})

const WEBCAM: HardwareComponent = {
  id: 'w1',
  type: 'webcam',
  name: 'Webcam 1',
  hub: 'controlHub',
  port: 0,
  props: {
    serialNumber: 'SN1',
    cameraModel: 'logitechC920',
    aimYaw: 0,
    aimPitch: Math.PI / 6,
    aimRoll: 0
  }
}

// 임시 씬(18 in 상자 로봇과 웹캠 상자)에 웹캠 컴포넌트를 붙인 것
function placeholderWithWebcam(component: HardwareComponent = WEBCAM): SceneObjects {
  const objects = useSceneStore.getState().objects
  return { ...objects, webcam: { ...objects.webcam, components: [component] } }
}

function inputFor(
  objects: SceneObjects,
  patch: Partial<CameraReadingInput> = {}
): CameraReadingInput {
  return {
    objects,
    objectId: 'webcam',
    component: objects.webcam.components![0],
    season: 'biobuzz',
    hiveTipped: [false, false],
    bounds: (id) => objectLocalBounds(objects, id),
    exclusion: null,
    ...patch
  }
}

const observation = (
  id: number,
  visible: boolean,
  rejection: TagObservation['rejection'] = null
): TagObservation => ({
  id,
  corners: [0, 0, 0, 0, 0, 0, 0, 0],
  shortSide: visible ? 20 : 0,
  visible,
  rejection
})

describe('cameraReadingModel 형식(observe 이중)', () => {
  it('보이는 태그를 SDK 묶음으로 나누고 놓친 이유(가림·작음·스침)를 센다', () => {
    const observe = vi
      .spyOn(FieldVision.prototype, 'observe')
      .mockReturnValue([
        observation(30, true),
        observation(31, false, 'occluded'),
        observation(32, true),
        observation(33, false, 'tooSmall'),
        observation(34, true),
        observation(35, true),
        observation(36, false, 'grazing'),
        observation(37, false, 'outOfFrame'),
        observation(38, false, 'occluded')
      ])
    const objects = placeholderWithWebcam()
    const model = cameraReadingModel(inputFor(objects))!
    expect(model.kind).toBe('camera')
    if (model.kind !== 'camera') return
    // VisionPortal 기본 640×480, 데시메이션 3
    expect(observe.mock.calls[0].slice(1)).toEqual(['logitechC920', 640, 480, 3])
    expect(model.visible).toEqual([
      { cluster: 'RED SCORING', ids: [30, 32] },
      { cluster: 'RED AUDIENCE', ids: [34, 35] }
    ])
    expect(model.rejected).toEqual({ occluded: 2, tooSmall: 1, grazing: 1 })
    expect(model.lens).toEqual(trueIntrinsics('logitechC920', 640, 480))
    // 임시 웹캠 상자의 앞면이 렌즈(형상 있음 → 피벗 꼬리 없음)
    expect(model.mount.housing).toBe('front')
    expect(model.tails).toEqual([])
    const text = cameraReadingText(model, t, 'mm', objects)
    expect(text.lines).toEqual([
      '렌즈 640×480: fx 622.0 · cx 319.8 · cy 241.3 (내장 보정 그대로)',
      '보이는 태그: RED SCORING 30·32, RED AUDIENCE 34·35 (가려짐 2, 작음 1, 스침 1)'
    ])
  })

  it('보이는 태그가 없으면 "보이는 태그 없음", 놓친 이유가 없으면 꼬리 없음', () => {
    vi.spyOn(FieldVision.prototype, 'observe').mockReturnValue([observation(30, false, 'behind')])
    const objects = placeholderWithWebcam()
    const text = cameraReadingText(cameraReadingModel(inputFor(objects))!, t, 'mm', objects)
    expect(text.lines[1]).toBe('보이는 태그 없음')
  })

  it('렌즈 줄의 출처 네 가지(exact·scaled·heightRatio·crop)', () => {
    vi.spyOn(FieldVision.prototype, 'observe').mockReturnValue([])
    const objects = placeholderWithWebcam()
    const base = cameraReadingModel(inputFor(objects)) as Extract<
      CameraReadingModel,
      { kind: 'camera' }
    >
    const lineOf = (lens: TrueIntrinsics): string =>
      cameraReadingText({ ...base, lens }, t, 'mm', objects).lines[0]
    expect(lineOf(trueIntrinsics('logitechC920', 640, 480))).toContain('(내장 보정 그대로)')
    expect(lineOf(trueIntrinsics('logitechC920', 1280, 720))).toContain(
      '(1920×1080 보정을 줄임(SDK도 같음))'
    )
    expect(lineOf(trueIntrinsics('lifecamHd3000', 1280, 720))).toContain(
      '(640×480 보정에서 높이 비로 추정(SDK는 578.272를 씀))'
    )
    expect(lineOf(trueIntrinsics('gobilda3122', 800, 448))).toContain(
      '(800×600 보정을 잘라 추정(SDK는 578.272를 씀))'
    )
  })

  it('빠짐: duplicateName 등은 값 대신 한 줄, notConfigured는 값과 꼬리, 로봇 밖은 outsideRobot', () => {
    vi.spyOn(FieldVision.prototype, 'observe').mockReturnValue([observation(34, true)])
    const objects = placeholderWithWebcam()
    const dup = cameraReadingModel(inputFor(objects, { exclusion: 'duplicateName' }))!
    expect(cameraReadingText(dup, t, 'mm', objects)).toEqual({
      lines: ['시뮬레이터에서 빠짐: 장치 이름이 다른 장치와 겹칩니다.'],
      tails: []
    })
    const unconfigured = cameraReadingModel(inputFor(objects, { exclusion: 'notConfigured' }))!
    const text = cameraReadingText(unconfigured, t, 'mm', objects)
    expect(text.lines[1]).toBe('보이는 태그: RED AUDIENCE 34')
    expect(text.tails).toEqual([
      '시리얼이 없어 구성 XML에 들어가지 않으므로 시뮬레이터에서 빠집니다.'
    ])
    // 시리얼 없는 웹캠은 거르기가 notConfigured를 낸다
    const noSerial = placeholderWithWebcam({
      ...WEBCAM,
      props: { ...WEBCAM.props, serialNumber: '' }
    })
    expect(cameraExclusions(noSerial, 'robot').get('w1')).toBe('notConfigured')
    const loose: SceneObjects = { ...objects, webcam: { ...objects.webcam, parentId: null } }
    expect(cameraReadingModel(inputFor(loose))).toEqual({
      kind: 'excluded',
      reason: 'outsideRobot'
    })
    // 웹캠이 아니면 없음
    expect(
      cameraReadingModel(inputFor(objects, { component: { ...WEBCAM, type: 'imu' } }))
    ).toBeNull()
  })

  it('꼬리 순서: onRobot·pivot → farHousing → selfHit(axis·partial) → notConfigured', () => {
    vi.spyOn(FieldVision.prototype, 'observe').mockReturnValue([])
    const objects = placeholderWithWebcam()
    // 형상이 없는 웹캠: 피벗
    const noShape = cameraReadingModel(
      inputFor(objects, {
        bounds: () => null,
        exclusion: 'notConfigured',
        selfHit: () => ({ kind: 'axis', partId: 'robot', distance: 0.1 })
      })
    )!
    expect(cameraReadingText(noShape, t, 'mm', objects).tails).toEqual([
      '형상이 없거나 읽는 중이라 하우징 앞면 대신 피벗을 렌즈로 씁니다.',
      '자기 로봇의 Robot이(가) 시야 가운데를 가립니다(시뮬레이터는 자기 로봇을 보지 않습니다).',
      '시리얼이 없어 구성 XML에 들어가지 않으므로 시뮬레이터에서 빠집니다.'
    ])
    // 로봇에 붙은 웹캠
    const onRobot: SceneObjects = {
      ...objects,
      robot: { ...objects.robot, components: [WEBCAM] },
      webcam: { ...objects.webcam, components: [] }
    }
    const robotModel = cameraReadingModel(
      inputFor(onRobot, {
        objectId: 'robot',
        component: WEBCAM,
        selfHit: () => ({ kind: 'partial' })
      })
    )!
    expect(robotModel.kind === 'camera' && robotModel.tails.map((tail) => tail.key)).toEqual([
      'onRobot',
      'selfHitPartial'
    ])
  })

  it('영어 글자', async () => {
    vi.spyOn(FieldVision.prototype, 'observe').mockReturnValue([
      observation(34, true),
      observation(32, false, 'occluded')
    ])
    const instance = i18next.createInstance()
    await instance.init({
      lng: 'en',
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false }
    })
    const objects = placeholderWithWebcam()
    const text = cameraReadingText(
      cameraReadingModel(inputFor(objects))!,
      instance.t,
      'in',
      objects
    )
    expect(text.lines).toEqual([
      'Lens 640×480: fx 622.0 · cx 319.8 · cy 241.3 (built-in calibration)',
      'Visible tags: RED AUDIENCE 34 (occluded 1)'
    ])
  })
})

describe('visibleTagGroups', () => {
  it('묶음이 없는 태그는 id만, 묶음은 첫 보이는 id 순', () => {
    const spec = resolveSeason('biobuzz')
    expect(
      visibleTagGroups(spec, [observation(42, true), observation(38, true), observation(43, true)])
    ).toEqual([
      { cluster: 'BLUE AUDIENCE', ids: [38] },
      { cluster: 'BLUE SCORING', ids: [42, 43] }
    ])
    expect(visibleTagGroups(spec, [observation(99, true)])).toEqual([{ cluster: null, ids: [99] }])
  })

  it('fieldVisionFor: 시즌·HIVE 상태마다 하나', () => {
    const spec = resolveSeason('biobuzz')
    expect(fieldVisionFor(spec, [false, false])).toBe(fieldVisionFor(spec, [false, false]))
    expect(fieldVisionFor(spec, [true, false])).not.toBe(fieldVisionFor(spec, [false, false]))
  })
})

// ---- C4 값(observe 구현 뒤): 임시 상자 로봇을 빨강 audienceWall 프리셋에 스냅 ----

function snappedScene(): SceneObjects {
  const store = useSceneStore.getState()
  const saved = { objects: store.objects, field: store.field }
  useSceneStore.setState({ objects: placeholderWithWebcam(), field: { season: 'biobuzz' } })
  try {
    snapRobotToPreset('robot', 'audienceWall', 'default')
    return useSceneStore.getState().objects
  } finally {
    useSceneStore.setState(saved)
  }
}

describe('C4 장면', () => {
  it('인스펙터 경로 스냅: 구간 가운데(로봇 y −0.752), 요 π, 웹캠 렌즈는 필드 x > 0 쪽에서 −X를 본다', () => {
    const objects = snappedScene()
    expect(objects.robot.transform.position[1]).toBeCloseTo(-0.752, 3)
    expect(Math.abs(objects.robot.transform.rotation[2])).toBeCloseTo(Math.PI, 9)
    const model = cameraReadingModel(inputFor(objects))!
    if (model.kind !== 'camera') throw new Error('camera')
    expect(model.pose.origin.x).toBeGreaterThan(1)
    expect(model.pose.rotation[0]).toBeLessThan(-0.8)
  })
})

describe('C4: 편집 자세 값(빨강 관중석 벽 프리셋, 위 30°)', () => {
  it('두 묶음이 보이고 가림 꼬리가 있다, 높이각 0이면 없음, 로봇을 돌리면 없음, none 시즌이면 없음, HIVE 넘어감이면 다름', () => {
    const objects = snappedScene()
    // 인스펙터 경로 스냅: 구간 가운데(로봇 y −0.752)
    expect(objects.robot.transform.position[1]).toBeCloseTo(-0.752, 3)
    const model = cameraReadingModel(inputFor(objects))!
    if (model.kind !== 'camera') throw new Error('camera')
    expect(model.visible.map((g) => g.cluster).sort()).toEqual(['RED AUDIENCE', 'RED SCORING'])
    expect(model.rejected.occluded).toBeGreaterThan(0)
    const level = cameraReadingModel(
      inputFor(objects, {
        component: { ...WEBCAM, props: { ...WEBCAM.props, aimPitch: 0 } }
      })
    )!
    expect(level.kind === 'camera' && level.visible).toEqual([])
    const turned: SceneObjects = {
      ...objects,
      robot: {
        ...objects.robot,
        transform: { ...objects.robot.transform, rotation: [0, 0, 0] }
      }
    }
    const away = cameraReadingModel(inputFor(turned))!
    expect(away.kind === 'camera' && away.visible).toEqual([])
    const none = cameraReadingModel(inputFor(objects, { season: 'none' }))!
    expect(none.kind === 'camera' && none.visible).toEqual([])
    const tipped = cameraReadingModel(inputFor(objects, { hiveTipped: [true, false] }))!
    expect(tipped.kind === 'camera' && tipped.visible).not.toEqual(model.visible)
  })
})
