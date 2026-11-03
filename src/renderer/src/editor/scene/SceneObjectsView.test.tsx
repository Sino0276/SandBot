import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import { StrictMode } from 'react'
import * as THREE from 'three'
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineSegments,
  Mesh,
  Object3D,
  Vector3
} from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { newRun, usePlayStore, type PlayData, type PlayRun } from '../../play/playStore'
import { disposeAllGeometry, registerGeometry } from '../../scene/geometryRegistry'
import type { JointSettings, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import {
  clearJointPreview,
  setJointPreview,
  useJointPreviewStore
} from '../joint/jointPreviewStore'
import { resetSceneVisibility, useSceneVisibilityStore } from '../sceneVisibility'
import { GHOST_MESH_LIMIT } from './poseDisplay'
import SceneObjectsView from './SceneObjectsView'

// 씬 뷰가 실행 중 로봇을 시뮬레이터 자세로 그리는지(R3F를 WebGL 없이 그린다: render가 아무것도 하지 않는 가짜 렌더러).
// 씬 문서는 바뀌지 않고, 끝나면 편집 위치로 돌아가며, 잔상이 남는다.

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

// 로봇은 필드 (1, 0)에서 앞을 보고, 파트는 로봇 앞 0.2 m 높이 0.1 m에 있다
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
    transform: { position: [0.2, 0, 0.1], rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: 'g-arm', color: [0.5, 0.5, 0.5] }
  }
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
// 최상위 노드(RootNode의 바깥 그룹)와 그 안의 로봇 노드
const outerGroups = (): Group[] => scene().children as Group[]
const worldOf = (object: Object3D): Vector3 => {
  scene().updateMatrixWorld(true)
  return new Vector3().setFromMatrixPosition(object.matrixWorld)
}
const meshes = (): Mesh[] => {
  const found: Mesh[] = []
  scene().traverse((object) => {
    if (object instanceof Mesh) found.push(object)
  })
  return found
}

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

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // <Canvas>가 하는 것처럼 Three.js 요소를 등록한다
  extend(THREE as never)
  // R3F가 만드는 THREE.Clock의 사용 중단 경고는 이 시험과 관계없다
  const warn = console.warn
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes('THREE.Clock')) warn(...args)
  })
})

afterAll(() => {
  vi.restoreAllMocks()
})

beforeEach(async () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
  registerGeometry('g-arm', geometry)
  useSceneStore.setState({ objects: SCENE })
  resetSceneVisibility()
  usePlayStore.setState({ run: null, simPose: null, ghostPose: null })
  useJointPreviewStore.setState({ values: {} })
  draws = 0
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
    store = root.render(<SceneObjectsView />)
  })
  const state = store.getState()
  const invalidate = state.invalidate
  state.set({
    invalidate: (...args: Parameters<typeof invalidate>) => {
      draws++
      invalidate(...args)
    }
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  disposeAllGeometry()
})

const setPlay = async (patch: Partial<PlayData>): Promise<void> => {
  await act(async () => {
    usePlayStore.setState(patch)
  })
}

const pose = (x: number, y: number, yaw: number, tNanos = 0): Partial<PlayData> => ({
  simPose: { robotId: 'bot', tNanos, x, y, yaw, blocked: false }
})

describe('실행 중 로봇 표시(SceneObjectsView)', () => {
  it('실행 전에는 문서 자세 그대로', () => {
    expect(outerGroups()).toHaveLength(1)
    const arm = meshes()[0]
    const world = worldOf(arm)
    expect(world.x).toBeCloseTo(1.2)
    expect(world.z).toBeCloseTo(0.1)
  })

  it('자세가 오면 바깥 그룹이 그 자세가 되고 안쪽은 항등, 끝나면 편집 위치로 돌아가고 잔상이 남는다', async () => {
    await setPlay({ run: run(), ...pose(-0.5, 0.75, Math.PI / 2) })
    const [outer] = outerGroups()
    const inner = outer.children[0] as Group
    expect(outer.position.toArray()).toEqual([-0.5, 0.75, 0])
    expect(outer.rotation.z).toBeCloseTo(Math.PI / 2)
    expect(inner.position.toArray()).toEqual([0, 0, 0])
    expect(inner.rotation.z).toBe(0)
    // 파트는 돌린 로봇의 앞(+Y)에
    let world = worldOf(meshes()[0])
    expect(world.x).toBeCloseTo(-0.5)
    expect(world.y).toBeCloseTo(0.95)
    expect(draws).toBeGreaterThan(0)

    // 자세가 올 때마다 명령형으로 적용하고 다시 그리기를 요청한다(문서는 그대로)
    const before = draws
    await setPlay(pose(0, 0, 0, 5))
    expect(outer.position.toArray()).toEqual([0, 0, 0])
    expect(draws).toBeGreaterThan(before)
    expect(useSceneStore.getState().objects).toBe(SCENE)

    // 실행 중 문서 자세가 바뀌어도(실행 취소 등) 표시 자세는 그대로
    await act(async () => {
      useSceneStore.setState({
        objects: {
          ...SCENE,
          bot: { ...SCENE.bot, transform: { position: [2, 2, 0], rotation: [0, 0, 1] } }
        }
      })
    })
    expect(outer.position.toArray()).toEqual([0, 0, 0])
    expect(inner.position.toArray()).toEqual([0, 0, 0])
    await act(async () => {
      useSceneStore.setState({ objects: SCENE })
    })

    // 끝: simPose를 지우고 잔상으로 옮긴다(playStore의 finished와 같다)
    await setPlay({
      run: { ...run(), phase: 'finished' },
      simPose: null,
      ghostPose: { robotId: 'bot', x: 0.3, y: 0.4, yaw: 0 }
    })
    expect(outer.position.toArray()).toEqual([0, 0, 0])
    expect(outer.rotation.z).toBe(0)
    expect(inner.position.toArray()).toEqual([1, 0, 0])
    world = worldOf(meshes()[0])
    expect(world.x).toBeCloseTo(1.2)
    // 잔상: 같은 파트를 끝난 자리에 한 번 더(클릭되지 않음)
    const all = meshes()
    expect(all).toHaveLength(2)
    const ghost = all[1]
    const ghostWorld = worldOf(ghost)
    expect(ghostWorld.x).toBeCloseTo(0.5)
    expect(ghostWorld.y).toBeCloseTo(0.4)
    expect(ghost.material).not.toBe(all[0].material)
    expect((ghost.material as { depthWrite: boolean }).depthWrite).toBe(false)
    const hits: unknown[] = []
    ghost.raycast({} as never, hits as never)
    expect(hits).toEqual([])
  })

  it('잔상은 씬 보이기 상태를 따르고, 다음 INIT에 지운다', async () => {
    await setPlay({ ghostPose: { robotId: 'bot', x: 0, y: 0, yaw: 0 } })
    expect(meshes()).toHaveLength(2)
    await act(async () => {
      useSceneVisibilityStore.setState({ hidden: new Set(['arm']) })
    })
    // 숨긴 파트는 원래 자리에도 잔상에도 그리지 않는다
    expect(meshes()).toHaveLength(0)
    await act(async () => {
      resetSceneVisibility()
    })
    expect(meshes()).toHaveLength(2)
    await setPlay({ ghostPose: null, run: run('preparing') })
    expect(meshes()).toHaveLength(1)
  })

  it('자세가 오기 전(INIT 직후)과 다른 로봇의 자세는 문서 자세 그대로', async () => {
    await setPlay({ run: run('init') })
    expect(outerGroups()[0].position.toArray()).toEqual([0, 0, 0])
    expect(worldOf(meshes()[0]).x).toBeCloseTo(1.2)
    await setPlay({ simPose: { robotId: 'other', tNanos: 0, x: 5, y: 5, yaw: 0, blocked: false } })
    expect(outerGroups()[0].position.toArray()).toEqual([0, 0, 0])
    expect(worldOf(meshes()[0]).x).toBeCloseTo(1.2)
  })
})

describe('StrictMode와 큰 CAD', () => {
  it('StrictMode가 effect를 정리했다 다시 붙여도 지금 자세가 그대로 보인다', async () => {
    await act(async () => root.unmount())
    usePlayStore.setState({ run: run(), ...pose(0.25, -0.5, 1) })
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
        <StrictMode>
          <SceneObjectsView />
        </StrictMode>
      )
    })
    const [outer] = outerGroups()
    expect(outer.position.toArray()).toEqual([0.25, -0.5, 0])
    expect(outer.rotation.z).toBe(1)
    expect((outer.children[0] as Group).position.toArray()).toEqual([0, 0, 0])
  })

  it(`메시가 ${GHOST_MESH_LIMIT}개를 넘는 로봇의 잔상은 외곽선 상자 하나`, async () => {
    const objects: SceneObjects = { bot: SCENE.bot }
    for (let i = 0; i <= GHOST_MESH_LIMIT; i++)
      objects[`p-${i}`] = {
        id: `p-${i}`,
        name: `P${i}`,
        kind: 'part',
        parentId: 'bot',
        transform: { position: [0.001 * i, 0, 0], rotation: [0, 0, 0] },
        visual: { type: 'mesh', geometryId: 'g-arm', color: [1, 1, 1] }
      }
    await act(async () => {
      useSceneStore.setState({ objects })
    })
    const before = meshes().length
    await setPlay({ ghostPose: { robotId: 'bot', x: 0, y: 0, yaw: 0 } })
    expect(meshes()).toHaveLength(before)
    const lines: LineSegments[] = []
    scene().traverse((object) => {
      if (object instanceof LineSegments) lines.push(object)
    })
    expect(lines).toHaveLength(1)
  })
})

describe('관절 표시(3b)', () => {
  // 리프트(직선 관절, 로봇 +Z, 로봇 원점) 안에 팔 파트. 팔은 편집 자세에서 필드 (1.2, 0, 0.1)
  const slide: JointSettings = {
    type: 'prismatic',
    anchor: [0, 0, 0],
    axis: 'z',
    axisSign: 1,
    limits: { lower: 0, upper: 0.5 },
    friction: { coulomb: 1, viscous: 0.5 },
    spring: null,
    drive: { kind: 'none' }
  }
  const JOINT_SCENE: SceneObjects = {
    bot: SCENE.bot,
    lift: {
      id: 'lift',
      name: 'Lift',
      kind: 'group',
      parentId: 'bot',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      joint: slide
    },
    arm: { ...SCENE.arm, parentId: 'lift' }
  }
  const jointRun = (phase: PlayRun['phase'] = 'running'): PlayRun => ({
    ...run(phase),
    joints: ['lift']
  })

  beforeEach(async () => {
    await act(async () => {
      useSceneStore.setState({ objects: JOINT_SCENE })
    })
  })

  it('미리보기 값은 씬 뷰에만 그리고 씬 문서는 바꾸지 않는다(한계로 자르고, 지우면 편집 자세)', async () => {
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.1)
    const before = draws
    await act(async () => setJointPreview('lift', 0.3))
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.4)
    expect(draws).toBeGreaterThan(before)
    expect(useSceneStore.getState().objects).toBe(JOINT_SCENE)
    await act(async () => setJointPreview('lift', 2))
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.6)
    await act(async () => clearJointPreview('lift'))
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.1)
  })

  it('실행 중에는 시뮬레이터 관절 값을 따르고(미리보기는 쓰지 않음), 끝나면 편집 자세와 잔상의 마지막 관절 값', async () => {
    await act(async () => setJointPreview('lift', 0.45))
    // INIT 직후(자세 전): 실행 중인 로봇의 관절은 편집 자세
    await setPlay({ run: jointRun('init') })
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.1)
    await setPlay({ run: jointRun(), simPose: { ...pose(1, 0, 0).simPose!, joints: [0.25] } })
    let world = worldOf(meshes()[0])
    expect(world.x).toBeCloseTo(1.2)
    expect(world.z).toBeCloseTo(0.35)
    await setPlay({ simPose: { ...pose(1, 0, 0, 5).simPose!, joints: [0.1] } })
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.2)
    expect(useSceneStore.getState().objects).toBe(JOINT_SCENE)

    await setPlay({
      run: { ...jointRun(), phase: 'finished' },
      simPose: null,
      ghostPose: { robotId: 'bot', x: 0, y: 0, yaw: 0, joints: { lift: 0.25 } }
    })
    const [live, ghost] = meshes()
    // 실행이 끝났으므로 다시 미리보기 값(사용자가 아직 카드를 열어 둔 경우)
    expect(worldOf(live).z).toBeCloseTo(0.55)
    world = worldOf(ghost)
    expect(world.x).toBeCloseTo(0.2)
    expect(world.z).toBeCloseTo(0.35)
    await act(async () => clearJointPreview('lift'))
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.1)
  })

  it('StrictMode가 effect를 정리했다 다시 붙여도 지금 관절 값이 그대로 보인다', async () => {
    await act(async () => root.unmount())
    usePlayStore.setState({
      run: jointRun(),
      simPose: { ...pose(1, 0, 0).simPose!, joints: [0.2] }
    })
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
        <StrictMode>
          <SceneObjectsView />
        </StrictMode>
      )
    })
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.3)
  })

  it('관절 설정을 떼면 안쪽 그룹도 사라지고 편집 자세다', async () => {
    await act(async () => setJointPreview('lift', 0.3))
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.4)
    await act(async () => {
      useSceneStore.getState().setJoint('lift', null)
    })
    expect(worldOf(meshes()[0]).z).toBeCloseTo(0.1)
  })
})
