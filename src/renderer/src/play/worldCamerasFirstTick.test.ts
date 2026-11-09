import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { TAG_INPUT_STRIDE } from '../../../shared/sidecarProtocol'
import { frameGridNanos } from '../../../shared/sim/vision'
import { PhysicsWorld } from '../../../shared/sim/world'
import { parseWorldSpec } from '../../../shared/sim/worldSpec'
import { cameraReadingModel } from '../editor/hardware/cameraReading'
import { objectLocalBounds } from '../scene/localBounds'
import type { HardwareComponent, SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { snapRobotToPreset } from '../editor/field/startPresetModel'
import { cameraExclusions } from './worldCameras'
import { withSensorNoise } from './worldSensors'
import { buildWorldSpec, runFieldOf, withRunField } from './worldSpec'

// 4d C9(spec-4d §4 C): 렌더러 빌더 세계(buildWorldSpec + withRunField + 잡음 끔)를 메인과 같은 parseWorldSpec(JSON 왕복) →
// PhysicsWorld에 넣고 스트리밍 출력을 준 첫 프레임의 tags id 집합 = 인스펙터 편집 자세 줄의 보이는 태그(640×480, d 3).
// 세계의 카메라(4d A fieldCameras)와 판정(FieldVision.observe)이 들어오기 전에는 건너뛴다(통합 뒤 돈다).

const SETTINGS = { batteryVoltage: 12 }
const keyT = ((key: string) => key) as unknown as TFunction

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

// 임시 상자 로봇 + 웹캠 컴포넌트를 빨강 관중석 벽 프리셋에(인스펙터 경로, C4와 같은 장면)
function scene(): SceneObjects {
  const store = useSceneStore.getState()
  const saved = { objects: store.objects, field: store.field }
  const objects = store.objects
  useSceneStore.setState({
    objects: { ...objects, webcam: { ...objects.webcam, components: [WEBCAM] } },
    field: { season: 'biobuzz' }
  })
  try {
    snapRobotToPreset('robot', 'audienceWall', 'default')
    return useSceneStore.getState().objects
  } finally {
    useSceneStore.setState(saved)
  }
}

const OUTPUTS = {
  'Webcam 1': {
    streaming: true,
    width: 640,
    height: 480,
    aprilTag: true,
    family: 'TAG_36h11',
    decimation: 3
  }
}

function firstFrameIds(objects: SceneObjects): number[] | null {
  const doc = { season: 'biobuzz' }
  const bounds = (id: string): ReturnType<typeof objectLocalBounds> =>
    objectLocalBounds(objects, id)
  const built = buildWorldSpec(objects, 'robot', SETTINGS, null, bounds)
  const runField = runFieldOf(doc, { red: 'start', blue: 'start' })
  const result = withSensorNoise(withRunField(built, doc, runField, keyT), {
    sensorNoise: false,
    seed: 0
  })
  const parsed = parseWorldSpec(JSON.parse(JSON.stringify(result.spec)))
  if (typeof parsed === 'string') throw new Error(parsed)
  const world = new PhysicsWorld(parsed)
  world.step(0, OUTPUTS)
  // 첫 프레임 격자 시각 g_1을 넘는 5 ms 틱
  const tick = Math.ceil(frameGridNanos(1) / 5_000_000) * 5_000_000
  for (let t = 5_000_000; t <= tick; t += 5_000_000) {
    const inputs = world.step(t, OUTPUTS) as Record<string, Record<string, unknown>>
    const tags = inputs['Webcam 1']?.tags
    if (Array.isArray(tags)) {
      const ids: number[] = []
      for (let i = 0; i < tags.length; i += TAG_INPUT_STRIDE) ids.push(tags[i] as number)
      return ids
    }
  }
  return null
}

const OBJECTS = scene()
const READING = cameraReadingModel({
  objects: OBJECTS,
  objectId: 'webcam',
  component: WEBCAM,
  season: 'biobuzz',
  hiveTipped: [false, false],
  bounds: (id) => objectLocalBounds(OBJECTS, id),
  exclusion: cameraExclusions(OBJECTS, 'robot').get(WEBCAM.id) ?? null
})
const OBSERVE_IS_STUB =
  READING?.kind === 'camera' && READING.observations.every((o) => o.rejection === 'behind')

describe.skipIf(OBSERVE_IS_STUB)('4d C9: 첫 프레임 tags = 인스펙터 편집 자세 줄', () => {
  it('렌더러 빌더 → parseWorldSpec → PhysicsWorld의 첫 프레임 id 집합이 보이는 태그와 같다', () => {
    if (READING?.kind !== 'camera') throw new Error('camera')
    const visible = READING.visible.flatMap((group) => group.ids).sort((a, b) => a - b)
    expect(visible.length).toBeGreaterThan(0)
    expect(firstFrameIds(OBJECTS)).toEqual(visible)
  })
})

describe('4d C9 장면', () => {
  it('세계 설명에 웹캠 하나(렌즈 = 임시 웹캠 상자 앞면)가 들어가고 메인 검사를 통과한다', () => {
    const bounds = (id: string): ReturnType<typeof objectLocalBounds> =>
      objectLocalBounds(OBJECTS, id)
    const built = buildWorldSpec(OBJECTS, 'robot', SETTINGS, null, bounds)
    expect(built.spec!.cameras.map((c) => [c.device, c.model, c.mount.body])).toEqual([
      ['Webcam 1', 'logitechC920', -1]
    ])
    expect(built.cameras[0].inRobot.housing).toBe('front')
    expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(built.spec)))).toBe('object')
  })
})
