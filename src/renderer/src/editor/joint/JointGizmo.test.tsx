import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments, Mesh, Vector3, type Object3D } from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { newRun, usePlayStore } from '../../play/playStore'
import type { JointSettings, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import JointGizmo from './JointGizmo'

// 씬 뷰 관절 표시가 고른 관절의 앵커에 그려지고, 실행 중이면 로봇 표시 자세를 따르는지(R3F를 WebGL 없이 그린다,
// SceneObjectsView.test.tsx와 같은 가짜 렌더러)

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Arm',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Arm.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Arm',
  group: '',
  preselectTeleOp: ''
}

const hinge: JointSettings = {
  type: 'revolute',
  anchor: [-0.05, 0, 0],
  axis: 'y',
  axisSign: 1,
  limits: { lower: -1, upper: 1 },
  friction: { coulomb: 0, viscous: 0 },
  spring: null,
  drive: { kind: 'none' }
}

// 로봇은 필드 (1, 0), 팔은 로봇 앞 0.2 m 높이 0.3 m, 앵커는 팔 원점 뒤 5 cm
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
    kind: 'group',
    parentId: 'bot',
    transform: { position: [0.2, 0, 0.3], rotation: [0, 0, 0] },
    joint: hinge
  },
  plain: {
    id: 'plain',
    name: 'Plain',
    kind: 'part',
    parentId: 'bot',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
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

const scene = (): Object3D => store.getState().scene as Object3D
const drawn = (): Object3D[] => {
  const found: Object3D[] = []
  scene().traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) found.push(object)
  })
  return found
}
// 앵커 점: 반지름(scale) 8 mm인 공
const anchorWorld = (): Vector3 => {
  scene().updateMatrixWorld(true)
  const anchor = drawn().find((object) => object instanceof Mesh && object.scale.x === 0.008)!
  return new Vector3().setFromMatrixPosition(anchor.matrixWorld)
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
  useSceneStore.setState({ objects: SCENE })
  useEditorStore.setState({ selectedId: null, selectedIds: [] })
  usePlayStore.setState({ run: null, simPose: null, ghostPose: null })
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
    store = root.render(<JointGizmo />)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
})

const select = async (id: string | null): Promise<void> => {
  await act(async () => {
    useEditorStore.setState({ selectedId: id, selectedIds: id ? [id] : [] })
  })
}

describe('씬 뷰 관절 표시', () => {
  it('관절이 있는 활성 오브젝트만 그리고, 앵커는 오브젝트 로컬 좌표의 그 자리', async () => {
    expect(drawn()).toHaveLength(0)
    await select('plain')
    expect(drawn()).toHaveLength(0)
    await select('arm')
    // 앵커 점, 축 선, 축 끝 원뿔, 한계 호, 한계 끝점 둘
    expect(drawn()).toHaveLength(6)
    const anchor = anchorWorld()
    expect(anchor.x).toBeCloseTo(1.15)
    expect(anchor.z).toBeCloseTo(0.3)
    // 클릭되지 않는다
    for (const object of drawn()) {
      const hits: unknown[] = []
      object.raycast({} as never, hits as never)
      expect(hits).toEqual([])
    }
  })

  it('실행 중이면 로봇 표시 자세를 따른다(자기 관절의 움직임은 넣지 않는다)', async () => {
    await select('arm')
    const run = newRun({
      runId: 'r1',
      root: '/p',
      opMode: OP_MODE,
      robotId: 'bot',
      configPath: null,
      speed: 1,
      paused: false,
      joints: ['arm']
    })
    await act(async () => {
      usePlayStore.setState({
        run: { ...run, phase: 'running' },
        simPose: { robotId: 'bot', tNanos: 0, x: -1, y: 2, yaw: 0, blocked: false, joints: [0.8] }
      })
    })
    const anchor = anchorWorld()
    expect(anchor.x).toBeCloseTo(-0.85)
    expect(anchor.y).toBeCloseTo(2)
    expect(anchor.z).toBeCloseTo(0.3)
  })
})
