import { act, createRoot, extend, type ReconcilerRoot } from '@react-three/fiber'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { usePlayStore } from '../../play/playStore'
import type { FieldVisual } from '../../scene/fieldDoc'
import type { HardwareComponent, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import * as cameraReading from '../hardware/cameraReading'
import ComponentCard from '../hardware/ComponentCard'
import * as sensorReading from '../hardware/sensorReading'
import * as startPreset from '../field/startPresetModel'
import StartPresetSection from '../field/StartPresetSection'
import { resetSceneVisibility } from '../sceneVisibility'
import * as cameraGizmo from './cameraGizmoModel'
import CameraGizmos from './CameraGizmos'
import * as sensorGizmo from './sensorGizmoModel'
import SensorGizmos from './SensorGizmos'
import StartMarkers from './StartMarkers'

// B12(spec-4e §4.4): 시즌에 기대는 계산(센서 편집 자세 값·웹캠 observe·센서·카메라 기즈모·시작 표시·시작 위치)은 문서
// field 객체가 아니라 시즌 문자열만 구독한다. 4e부터 field는 필드 CAD 정렬·불러오기·경로 고침에도 바뀌므로, 그때 다시
// 계산하지 않는지(계산 함수 호출 수 그대로) 본다. 시즌을 바꾸면 다시 계산한다.
// DOM이 없으므로 R3F 루트에 DOM 태그를 빈 객체로 등록해 그린다(글자는 버린다, 훅·memo는 그대로 돈다).

vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

vi.mock('../hardware/sensorReading', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hardware/sensorReading')>()
  return { ...actual, sensorReadingModel: vi.fn(actual.sensorReadingModel) }
})
vi.mock('../hardware/cameraReading', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hardware/cameraReading')>()
  return { ...actual, cameraReadingModel: vi.fn(actual.cameraReadingModel) }
})
vi.mock('../field/startPresetModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../field/startPresetModel')>()
  return { ...actual, startPresetModel: vi.fn(actual.startPresetModel) }
})
vi.mock('./sensorGizmoModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sensorGizmoModel')>()
  return { ...actual, sensorGizmoPose: vi.fn(actual.sensorGizmoPose) }
})
vi.mock('./cameraGizmoModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cameraGizmoModel')>()
  return { ...actual, cameraGizmoPose: vi.fn(actual.cameraGizmoPose) }
})

const DISTANCE: HardwareComponent = {
  id: 'dist',
  type: 'distanceSensor',
  name: 'front',
  hub: 'controlHub',
  port: 1,
  props: { aimYaw: 0, aimPitch: 0 }
}
const WEBCAM: HardwareComponent = {
  id: 'cam',
  type: 'webcam',
  name: 'Webcam 1',
  hub: 'controlHub',
  port: 0,
  props: { serialNumber: 'SN1', cameraModel: 'logitechC920', aimYaw: 0, aimPitch: 0, aimRoll: 0 }
}

const SCENE: SceneObjects = {
  bot: {
    id: 'bot',
    name: 'Bot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, -1.4, 0], rotation: [0, 0, Math.PI / 2] }
  },
  front: {
    id: 'front',
    name: 'Front',
    kind: 'part',
    parentId: 'bot',
    transform: { position: [0.2, 0, 0.1], rotation: [0, 0, 0] },
    components: [DISTANCE, WEBCAM]
  }
}

const VISUAL: FieldVisual = {
  fileName: 'field.step',
  absolutePath: '/team/field.step',
  upAxis: '+Y',
  forwardAxis: '+Z'
}

function fakeRenderer(): object {
  return {
    render: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
    getPixelRatio: () => 1,
    dispose: () => {},
    domElement: { style: {} },
    shadowMap: { enabled: false, type: 0 },
    xr: {
      enabled: false,
      isPresenting: false,
      setAnimationLoop: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  }
}

// DOM 태그 자리(R3F는 Object3D가 아닌 인스턴스를 장면에 붙이지 않고 속성만 둔다)
class DomStub {
  id: unknown
}
const DOM_TAGS = [
  'a',
  'b',
  'bdi',
  'br',
  'button',
  'code',
  'details',
  'div',
  'em',
  'header',
  'hr',
  'i',
  'img',
  'input',
  'kbd',
  'label',
  'li',
  'optgroup',
  'option',
  'output',
  'p',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'summary',
  'textarea',
  'ul'
]

let root: ReconcilerRoot<HTMLCanvasElement>

beforeAll(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  extend(THREE as never)
  extend(
    Object.fromEntries(
      DOM_TAGS.map((tag) => [tag[0].toUpperCase() + tag.slice(1), DomStub])
    ) as never
  )
  const warn = console.warn
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes('THREE.Clock')) warn(...args)
  })
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

afterAll(() => {
  vi.restoreAllMocks()
})

beforeEach(async () => {
  useSceneStore.setState({ objects: SCENE, field: { season: 'biobuzz' } })
  useEditorStore.setState({ selectedId: 'bot', selectedIds: ['bot'], fieldSelected: false })
  usePlayStore.setState({
    run: null,
    simPose: null,
    ghostPose: null,
    settings: DEFAULT_PLAY_SETTINGS
  })
  resetSceneVisibility()
  const canvas = {
    style: {},
    width: 800,
    height: 600,
    addEventListener: () => {},
    removeEventListener: () => {}
  } as unknown as HTMLCanvasElement
  root = createRoot(canvas)
  await root.configure({
    gl: fakeRenderer() as never,
    frameloop: 'never',
    size: { width: 800, height: 600, top: 0, left: 0 }
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  await new Promise((done) => setTimeout(done, 5))
})

const step = async (update: () => void): Promise<void> => {
  await act(async () => update())
}

// field 객체만 바꾸는 편집 셋(시즌은 그대로) 뒤에는 호출 수가 그대로이고, 시즌을 바꾸면 는다
async function expectSeasonOnly(element: ReactNode, calls: () => number): Promise<void> {
  await act(async () => {
    root.render(element)
  })
  const first = calls()
  expect(first).toBeGreaterThan(0)
  const store = useSceneStore.getState()
  await step(() => store.setFieldVisual(VISUAL))
  expect(useSceneStore.getState().field.visual).toEqual(VISUAL)
  await step(() =>
    useSceneStore.getState().setFieldVisualAlignment({ upAxis: '+Z', forwardAxis: '-Y' })
  )
  await step(() => useSceneStore.getState().setFieldVisual(null))
  expect(calls()).toBe(first)
  // 시즌을 바꿨다 되돌리면 다시 계산한다(시작 표시는 'none'에서 그리지 않아 되돌릴 때 계산한다)
  await step(() => useSceneStore.getState().setFieldSeason('none'))
  await step(() => useSceneStore.getState().setFieldSeason('biobuzz'))
  expect(calls()).toBeGreaterThan(first)
}

const count = (fn: unknown): number => (fn as ReturnType<typeof vi.fn>).mock.calls.length

describe('시즌 문자열 구독(B12)', () => {
  it('센서 카드의 편집 자세 값(sensorReadingModel)', async () => {
    vi.mocked(sensorReading.sensorReadingModel).mockClear()
    await expectSeasonOnly(
      <ComponentCard
        objects={SCENE}
        objectId="front"
        component={DISTANCE}
        siblings={[]}
        objectOptions={{}}
        expansionHubEnabled={false}
        issues={[]}
      />,
      () => count(sensorReading.sensorReadingModel)
    )
  })

  it('웹캠 카드의 편집 자세 값(cameraReadingModel)', async () => {
    vi.mocked(cameraReading.cameraReadingModel).mockClear()
    await expectSeasonOnly(
      <ComponentCard
        objects={SCENE}
        objectId="front"
        component={WEBCAM}
        siblings={[]}
        objectOptions={{}}
        expansionHubEnabled={false}
        issues={[]}
      />,
      () => count(cameraReading.cameraReadingModel)
    )
  })

  it('센서 기즈모(sensorGizmoPose)', async () => {
    vi.mocked(sensorGizmo.sensorGizmoPose).mockClear()
    await expectSeasonOnly(<SensorGizmos />, () => count(sensorGizmo.sensorGizmoPose))
  })

  it('카메라 기즈모(cameraGizmoPose)', async () => {
    vi.mocked(cameraGizmo.cameraGizmoPose).mockClear()
    await expectSeasonOnly(<CameraGizmos />, () => count(cameraGizmo.cameraGizmoPose))
  })

  it('시작 표시(startPresetModel)', async () => {
    vi.mocked(startPreset.startPresetModel).mockClear()
    await expectSeasonOnly(<StartMarkers />, () => count(startPreset.startPresetModel))
  })

  it('로봇 "시작 위치"(startPresetModel)', async () => {
    vi.mocked(startPreset.startPresetModel).mockClear()
    await expectSeasonOnly(<StartPresetSection robot={SCENE.bot} />, () =>
      count(startPreset.startPresetModel)
    )
  })
})
