import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import { StrictMode } from 'react'
import * as THREE from 'three'
import { LineSegments, Mesh, Object3D, Raycaster, Vector3 } from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import type { MassModel, ObjectMass, RobotMass } from '../../mass/types'
import { newRun, usePlayStore, type PlayData, type PlayRun } from '../../play/playStore'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { beginChange, endChange } from '../history'
import CenterOfMassIndicator from './CenterOfMassIndicator'
import { comMarkers } from './comMarkers'
import { DRAG_REFRESH_MS } from './useMassModel'

// 씬 뷰 무게중심 표시(R3F를 WebGL 없이 그린다: render가 아무것도 하지 않는 가짜 렌더러, SceneObjectsView.test.tsx와
// 같은 방법). 질량 모델은 정해 둔 가짜 결과다(계산은 갈래 B).
const fake = vi.hoisted(() => ({ model: { objects: {}, robots: {} } as MassModel }))
vi.mock('../../mass/massModel', () => ({ computeMassModel: () => fake.model }))

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

// 로봇은 필드 (1, 0)에서 앞을 보고, 팔은 로봇 앞 0.2 m 높이 0.1 m, 상자는 로봇 밖
const SCENE: SceneObjects = {
  bot: {
    id: 'bot',
    name: 'Bot',
    kind: 'robot',
    parentId: null,
    transform: { position: [1, 0, 0], rotation: [0, 0, 0] }
  },
  arm: {
    id: 'arm',
    name: 'Arm',
    kind: 'part',
    parentId: 'bot',
    transform: { position: [0.2, 0, 0.1], rotation: [0, 0, 0] }
  },
  box: {
    id: 'box',
    name: 'Box',
    kind: 'part',
    parentId: null,
    transform: { position: [-2, 1, 0], rotation: [0, 0, 0] }
  }
}

const objectMass = (centerOfMass: [number, number, number], mass = 0.5): ObjectMass => ({
  mass,
  centerOfMass,
  source: 'material',
  detail: 'aluminum6061',
  inheritedFrom: null,
  scaled: false
})

const robotMass = (centerOfMass: [number, number, number], mass = 10): RobotMass => ({
  robotId: 'bot',
  mass,
  centerOfMass,
  inertia: [1, 1, 1, 0, 0, 0],
  principalMoments: [1, 1, 1],
  fixedMass: 0,
  estimatedMass: mass,
  scale: 1,
  warnings: []
})

const MODEL: MassModel = {
  objects: {
    arm: objectMass([0.2, 0, 0.12]),
    box: objectMass([-2, 1.1, 0.05])
  },
  robots: { bot: robotMass([0.05, 0, 0.08]) }
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

let root: ReconcilerRoot<HTMLCanvasElement>
let store: RootStore
let draws = 0

const scene = (): Object3D => store.getState().scene as Object3D
const worldOf = (object: Object3D): Vector3 => {
  scene().updateMatrixWorld(true)
  return new Vector3().setFromMatrixPosition(object.matrixWorld)
}
const markers = (): Object3D[] => {
  const found: Object3D[] = []
  scene().traverse((object) => {
    if (object instanceof Mesh) found.push(object)
  })
  return found
}
// 공 반지름으로 로봇 표시(큰 것)와 오브젝트 표시를 나눈다
const robotMarker = (): Object3D | undefined => markers().find((m) => m.scale.x > 0.015)
const objectMarker = (): Object3D | undefined => markers().find((m) => m.scale.x < 0.015)

function run(phase: PlayRun['phase'] = 'running'): PlayRun {
  const created = newRun({
    runId: 'r1',
    root: '/p',
    opMode: OP_MODE,
    robotId: 'bot',
    configPath: null,
    speed: 1,
    paused: false
  })
  return { ...created, phase }
}

const pose = (x: number, y: number, yaw: number, tNanos = 0): Partial<PlayData> => ({
  simPose: { robotId: 'bot', tNanos, x, y, yaw, blocked: false }
})

async function mount(strict: boolean): Promise<void> {
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
  await act(async () => {
    store = root.render(
      strict ? (
        <StrictMode>
          <CenterOfMassIndicator />
        </StrictMode>
      ) : (
        <CenterOfMassIndicator />
      )
    )
  })
  const state = store.getState()
  const invalidate = state.invalidate
  state.set({
    invalidate: (...args: Parameters<typeof invalidate>) => {
      draws++
      invalidate(...args)
    }
  })
}

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  extend(THREE as never)
  const warn = console.warn
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes('THREE.Clock')) warn(...args)
  })
})

afterAll(() => {
  vi.restoreAllMocks()
})

beforeEach(async () => {
  fake.model = MODEL
  // 질량 모델은 objects가 바뀔 때 다시 계산하므로 시험마다 새 문서를 넣는다
  useSceneStore.setState({ objects: { ...SCENE } })
  useEditorStore.setState({ selectedId: null, selectedIds: [] })
  usePlayStore.setState({ run: null, simPose: null, ghostPose: null })
  draws = 0
  await mount(false)
})

afterEach(async () => {
  await act(async () => root.unmount())
})

const select = async (id: string | null): Promise<void> => {
  await act(async () => {
    useEditorStore.setState({ selectedId: id, selectedIds: id ? [id] : [] })
  })
}

const setPlay = async (patch: Partial<PlayData>): Promise<void> => {
  await act(async () => {
    usePlayStore.setState(patch)
  })
}

describe('무게중심 표시 대상', () => {
  it('오브젝트를 고르면 로봇과 오브젝트, 로봇이면 로봇만, 로봇 밖이면 필드 좌표의 오브젝트만', () => {
    expect(comMarkers(SCENE, MODEL, 'arm')).toEqual({
      frameId: 'bot',
      robot: [0.05, 0, 0.08],
      object: [0.2, 0, 0.12]
    })
    expect(comMarkers(SCENE, MODEL, 'bot')).toEqual({
      frameId: 'bot',
      robot: [0.05, 0, 0.08],
      object: null
    })
    expect(comMarkers(SCENE, MODEL, 'box')).toEqual({
      frameId: null,
      robot: null,
      object: [-2, 1.1, 0.05]
    })
    expect(comMarkers(SCENE, MODEL, null)).toBeNull()
    expect(comMarkers(SCENE, MODEL, 'gone')).toBeNull()
    // 질량이 0이거나 계산이 없으면 그리지 않는다
    const empty: MassModel = { objects: { arm: objectMass([0, 0, 0], 0) }, robots: {} }
    expect(comMarkers(SCENE, empty, 'arm')).toBeNull()
  })
})

describe('씬 뷰 무게중심 표시', () => {
  it('고르기 전에는 없고, 고르면 로봇 좌표의 무게중심을 필드에 그리고, 풀면 사라지며 다시 그린다', async () => {
    expect(markers()).toHaveLength(0)
    await select('arm')
    const robot = worldOf(robotMarker()!)
    expect(robot.x).toBeCloseTo(1.05)
    expect(robot.z).toBeCloseTo(0.08)
    const object = worldOf(objectMarker()!)
    expect(object.x).toBeCloseTo(1.2)
    expect(object.z).toBeCloseTo(0.12)
    // 로봇 표시는 공과 십자
    let lines = 0
    scene().traverse((node) => {
      if (node instanceof LineSegments) lines++
    })
    expect(lines).toBe(1)
    expect(draws).toBeGreaterThan(0)

    const before = draws
    await select(null)
    expect(markers()).toHaveLength(0)
    expect(draws).toBeGreaterThan(before)
  })

  it('클릭되지 않는다(raycast가 아무것도 맞히지 않는다)', async () => {
    await select('arm')
    const raycaster = new Raycaster(new Vector3(1.05, 0, 2), new Vector3(0, 0, -1))
    expect(raycaster.intersectObject(scene(), true)).toEqual([])
  })

  it('로봇 밖 오브젝트는 필드 좌표 그대로', async () => {
    await select('box')
    expect(markers()).toHaveLength(1)
    const object = worldOf(objectMarker()!)
    expect(object.toArray().map((v) => Number(v.toFixed(9)))).toEqual([-2, 1.1, 0.05])
  })

  it('실행 중에는 시뮬레이터 자세를 따르고 끝나면 문서 자세로 돌아간다(문서는 그대로)', async () => {
    await select('arm')
    const objects = useSceneStore.getState().objects
    await setPlay({ run: run(), ...pose(-0.5, 0.75, Math.PI / 2) })
    // 로봇이 90° 돌았으므로 로봇 앞 0.05 m는 필드 +Y
    let robot = worldOf(robotMarker()!)
    expect(robot.x).toBeCloseTo(-0.5)
    expect(robot.y).toBeCloseTo(0.8)
    let object = worldOf(objectMarker()!)
    expect(object.y).toBeCloseTo(0.95)

    const before = draws
    await setPlay(pose(0, 0, 0, 5))
    robot = worldOf(robotMarker()!)
    expect(robot.x).toBeCloseTo(0.05)
    expect(robot.y).toBeCloseTo(0)
    expect(draws).toBeGreaterThan(before)
    expect(useSceneStore.getState().objects).toBe(objects)

    await setPlay({ run: run('finished'), simPose: null })
    robot = worldOf(robotMarker()!)
    expect(robot.x).toBeCloseTo(1.05)
    object = worldOf(objectMarker()!)
    expect(object.x).toBeCloseTo(1.2)
  })

  it('형상이 등록돼 질량 모델이 바뀌면 다시 계산한 자리로 옮긴다', async () => {
    await select('arm')
    fake.model = { ...MODEL, robots: { bot: robotMass([-0.1, 0, 0.05]) } }
    await act(async () => {
      useSceneStore.setState((state) => ({ geometryRevision: state.geometryRevision + 1 }))
    })
    expect(worldOf(robotMarker()!).x).toBeCloseTo(0.9)
  })

  it('핸들을 끄는 동안에는 간격마다만 다시 계산하고, 놓으면 마지막 문서의 자리로 옮긴다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    try {
      vi.advanceTimersByTime(10 * DRAG_REFRESH_MS)
      await select('arm')
      const moved = (x: number): MassModel => ({
        ...MODEL,
        robots: { bot: robotMass([x, 0, 0.08]) }
      })
      const drag = async (x: number): Promise<void> => {
        fake.model = moved(x)
        await act(async () => {
          useSceneStore.setState((state) => ({ objects: { ...state.objects } }))
        })
      }
      beginChange()
      vi.advanceTimersByTime(DRAG_REFRESH_MS)
      // 첫 프레임은 계산한다
      await drag(-0.1)
      expect(worldOf(robotMarker()!).x).toBeCloseTo(0.9)
      // 간격 안의 프레임은 이전 결과
      vi.advanceTimersByTime(16)
      await drag(-0.2)
      expect(worldOf(robotMarker()!).x).toBeCloseTo(0.9)
      // 간격이 지나면 미룬 계산을 새로 고친다(문서가 더 바뀌지 않아도)
      await act(async () => {
        vi.advanceTimersByTime(DRAG_REFRESH_MS)
      })
      expect(worldOf(robotMarker()!).x).toBeCloseTo(0.8)
      vi.advanceTimersByTime(16)
      await drag(-0.3)
      expect(worldOf(robotMarker()!).x).toBeCloseTo(0.8)
      // 놓으면 묶음이 닫힌 뒤 새로 고침에서 마지막 문서로 계산한다
      endChange()
      await act(async () => {
        vi.advanceTimersByTime(DRAG_REFRESH_MS)
      })
      expect(worldOf(robotMarker()!).x).toBeCloseTo(0.7)
    } finally {
      endChange()
      vi.useRealTimers()
    }
  })
})

describe('StrictMode와 정리', () => {
  it('StrictMode가 effect를 정리했다 다시 붙여도 지금 자세가 그대로 보이고, 떼면 표시가 남지 않는다', async () => {
    await act(async () => root.unmount())
    usePlayStore.setState({ run: run(), ...pose(0.25, -0.5, 0) })
    useEditorStore.setState({ selectedId: 'arm', selectedIds: ['arm'] })
    await mount(true)
    const robot = worldOf(robotMarker()!)
    expect(robot.x).toBeCloseTo(0.3)
    expect(robot.y).toBeCloseTo(-0.5)
    // 끝나면 문서 자세로(묶음을 푼 뒤 안쪽이 다시 로봇 자세를 갖는다)
    await setPlay({ run: run('finished'), simPose: null })
    expect(worldOf(robotMarker()!).x).toBeCloseTo(1.05)

    // 공유 형상·재질은 해제하지 않으므로 다시 붙여도 같은 것을 쓴다
    const geometry = (robotMarker() as Mesh).geometry
    await act(async () => root.unmount())
    await mount(true)
    expect(markers()).toHaveLength(2)
    expect((robotMarker() as Mesh).geometry).toBe(geometry)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
  })
})
