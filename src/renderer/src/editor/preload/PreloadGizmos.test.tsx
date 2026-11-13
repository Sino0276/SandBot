import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import { StrictMode } from 'react'
import * as THREE from 'three'
import { LineBasicMaterial, LineSegments, type Object3D } from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { resolveElementType } from '../../../../shared/sim/elements/elementData'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { newRun, usePlayStore } from '../../play/playStore'
import { disposeAllGeometry } from '../../scene/geometryRegistry'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import {
  colliderScene,
  registerSceneMeshes,
  resetCollisionModels
} from '../collider/colliderTestkit'
import { useEditorStore } from '../editorStore'
import { useJointPreviewStore } from '../joint/jointPreviewStore'
import { useSceneVisibilityStore } from '../sceneVisibility'
import PreloadGizmos, { PRELOAD_GIZMO_COLOR, PRELOAD_GIZMO_EXCLUDED_COLOR } from './PreloadGizmos'
import { preloadGizmoItems } from './preloadGizmoModel'

// 씬 뷰 Preload Slot 기즈모(6a): 고른 오브젝트(와 하위)의 자리마다 큰 원 셋, 노랑(쓰임)·회색(빠짐), 두 패스, 클릭되지 않음, 숨김,
// 실행 중 표시 자세, StrictMode 뒤에도 재질이 살아 있음. R3F를 WebGL 없이 그린다(ColliderGizmos.test.tsx와 같은 가짜 렌더러).

const POLLEN_R = resolveElementType(resolveSeason('biobuzz'), 'pollen')!.radius

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

async function newRoot(): Promise<void> {
  root = createRoot({
    style: {},
    width: 800,
    height: 600,
    addEventListener: () => {},
    removeEventListener: () => {}
  } as unknown as HTMLCanvasElement)
  await root.configure({
    gl: fakeRenderer() as never,
    frameloop: 'never',
    size: { width: 800, height: 600, top: 0, left: 0 }
  })
}

const lines = (): LineSegments[] => {
  const found: LineSegments[] = []
  ;(store.getState().scene as Object3D).traverse((object) => {
    if (object instanceof LineSegments) found.push(object)
  })
  return found
}
const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 5))

const scene = (): SceneObjects => {
  const objects = colliderScene()
  return {
    ...objects,
    base: { ...objects.base, preload: { kind: 'pollen', center: [0, 0, 0.1] } },
    plate: { ...objects.plate, preload: { kind: 'pollen', enabled: false, center: [0, 0, 0] } }
  }
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
  resetCollisionModels()
  registerSceneMeshes()
  useSceneStore.setState({ objects: scene(), field: { season: 'biobuzz' }, geometryRevision: 1 })
  useEditorStore.setState({ selectedId: null, selectedIds: [] })
  usePlayStore.setState({ run: null, simPose: null, ghostPose: null })
  useJointPreviewStore.setState({ values: {} })
  useSceneVisibilityStore.setState({ hidden: new Set(), isolated: null, fieldHidden: false })
  await newRoot()
})

afterEach(async () => {
  await act(async () => root.unmount())
  await flush()
  disposeAllGeometry()
})

const select = async (id: string | null): Promise<void> => {
  await act(async () => {
    useEditorStore.setState({ selectedId: id, selectedIds: id ? [id] : [] })
  })
}
const hex = (line: LineSegments): string =>
  `#${(line.material as LineBasicMaterial).color.getHexString()}`

describe('Preload Slot 기즈모', () => {
  it('고른 오브젝트의 하위 자리만, 노랑(쓰임)·회색(끔) 두 패스, renderOrder 11, 클릭되지 않음', async () => {
    await act(async () => {
      store = root.render(<PreloadGizmos />)
    })
    expect(lines()).toHaveLength(0)
    await select('R')
    const all = lines()
    expect(all).toHaveLength(4)
    expect(all.map(hex).sort()).toEqual(
      [
        PRELOAD_GIZMO_COLOR,
        PRELOAD_GIZMO_COLOR,
        PRELOAD_GIZMO_EXCLUDED_COLOR,
        PRELOAD_GIZMO_EXCLUDED_COLOR
      ].sort()
    )
    for (const line of all) {
      expect(line.renderOrder).toBe(11)
      const hits: unknown[] = []
      line.raycast(new THREE.Raycaster(), hits as never)
      expect(hits).toEqual([])
    }
    const depth = all.map((line) => (line.material as LineBasicMaterial).depthTest).sort()
    expect(depth).toEqual([false, false, true, true])
    // 섀시 판 base(로봇 좌표 z 0.05) 위 0.1의 공 중심, 원 반지름 = POLLEN
    const used = all.find((line) => hex(line) === PRELOAD_GIZMO_COLOR)!
    expect(used.parent!.position.z).toBeCloseTo(0.15, 12)
    const positions = used.geometry.getAttribute('position')
    expect(Math.hypot(positions.getX(0), positions.getY(0), positions.getZ(0))).toBeCloseTo(
      POLLEN_R,
      6
    )
    // 리프트를 고르면 그 하위 자리(끈 plate)만
    await select('lift')
    expect(lines().map(hex)).toEqual([PRELOAD_GIZMO_EXCLUDED_COLOR, PRELOAD_GIZMO_EXCLUDED_COLOR])
  })

  it('숨긴 오브젝트의 자리는 그리지 않고, StrictMode의 정리 → 재실행 뒤에도 재질을 해제하지 않고 내려가면 해제한다', async () => {
    const dispose = vi.spyOn(LineBasicMaterial.prototype, 'dispose')
    try {
      await act(async () => {
        store = root.render(
          <StrictMode>
            <PreloadGizmos />
          </StrictMode>
        )
      })
      await select('base')
      await flush()
      expect(dispose).not.toHaveBeenCalled()
      expect(lines()).toHaveLength(2)
      await act(async () => {
        useSceneVisibilityStore.setState({ hidden: new Set(['base']) })
      })
      expect(lines()).toHaveLength(0)
      await act(async () => root.unmount())
      await flush()
      expect(dispose).toHaveBeenCalled()
      await newRoot()
    } finally {
      dispose.mockRestore()
    }
  })
})

describe('preloadGizmoItems', () => {
  const TELEOP: OpModeInfo = {
    className: 'a.B',
    path: 'B.java',
    line: 1,
    flavor: 'TeleOp',
    name: 'B',
    group: '',
    preselectTeleOp: ''
  }

  it('실행이 로봇을 잠그면 시뮬레이터 자세를 따른다', () => {
    const objects = scene()
    const run = {
      ...newRun({
        runId: 'r',
        root: '/p',
        opMode: TELEOP,
        robotId: 'R',
        configPath: null,
        speed: 1,
        paused: false
      }),
      phase: 'running' as const
    }
    const items = preloadGizmoItems({
      objects,
      selectedIds: ['base'],
      field: resolveSeason('biobuzz'),
      play: {
        run,
        simPose: { robotId: 'R', tNanos: 0, x: 1, y: 2, yaw: Math.PI / 2, blocked: false }
      },
      preview: { values: {} },
      visibility: { hidden: new Set(), isolated: null, fieldHidden: false }
    })
    expect(items).toHaveLength(1)
    expect(items[0].center[0]).toBeCloseTo(1, 12)
    expect(items[0].center[1]).toBeCloseTo(2, 12)
    expect(items[0].center[2]).toBeCloseTo(0.15, 12)
    // 경기 요소가 없는 시즌도 BIOBUZZ POLLEN 크기로 그리고 자리는 빠짐(회색)
    const none = preloadGizmoItems({
      objects,
      selectedIds: ['base'],
      field: resolveSeason('none'),
      play: { run: null, simPose: null },
      preview: { values: {} },
      visibility: { hidden: new Set(), isolated: null, fieldHidden: false }
    })
    expect(none).toMatchObject([{ style: 'excluded', radius: POLLEN_R }])
  })
})
