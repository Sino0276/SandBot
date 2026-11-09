import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import { StrictMode } from 'react'
import * as THREE from 'three'
import { LineBasicMaterial, LineSegments, Mesh, type Object3D } from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayStore } from '../../play/playStore'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { useSceneVisibilityStore } from '../sceneVisibility'
import SensorGizmos from './SensorGizmos'

// 씬 뷰 센서 기즈모의 그리기(C11): 고른 로봇의 센서를 그리고 클릭되지 않으며, StrictMode의 정리 → 재실행 뒤에도 재질이
// 해제되지 않는다(R3F를 WebGL 없이 그린다, JointGizmo.test.tsx와 같은 가짜 렌더러)

const SCENE: SceneObjects = {
  bot: {
    id: 'bot',
    name: 'Bot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  },
  front: {
    id: 'front',
    name: 'Front',
    kind: 'part',
    parentId: 'bot',
    transform: { position: [0.2, 0, 0.1], rotation: [0, 0, 0] },
    components: [
      {
        id: 'dist',
        type: 'distanceSensor',
        name: 'front',
        hub: 'controlHub',
        port: 1,
        props: { aimYaw: 0, aimPitch: 0 }
      },
      {
        id: 'col',
        type: 'colorSensor',
        name: 'floor',
        hub: 'controlHub',
        port: 2,
        props: { gain: 2, aimYaw: 0, aimPitch: -Math.PI / 2 }
      }
    ]
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

const drawn = (): Object3D[] => {
  const found: Object3D[] = []
  ;(store.getState().scene as Object3D).traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) found.push(object)
  })
  return found
}

const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 5))

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
  useSceneVisibilityStore.setState({ hidden: new Set(), isolated: null, fieldHidden: false })
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
})

const select = async (id: string | null): Promise<void> => {
  await act(async () => {
    useEditorStore.setState({ selectedId: id, selectedIds: id ? [id] : [] })
  })
}

describe('씬 뷰 센서 기즈모', () => {
  it('고른 로봇의 센서를 그리고 클릭되지 않으며, 센서 오브젝트를 숨기면 사라진다', async () => {
    await act(async () => {
      store = root.render(<SensorGizmos />)
    })
    expect(drawn()).toHaveLength(0)
    await select('bot')
    const objects = drawn()
    expect(objects.length).toBeGreaterThan(0)
    for (const object of objects) {
      const hits: unknown[] = []
      object.raycast({} as never, hits as never)
      expect(hits).toEqual([])
      // 깊이 검사를 끈다(CAD 안에서도 보이게)
      const material = (object as Mesh).material as THREE.Material
      expect(material.depthTest).toBe(false)
    }
    await act(async () => {
      useSceneVisibilityStore.setState({ hidden: new Set(['front']) })
    })
    expect(drawn()).toHaveLength(0)
  })

  it('StrictMode의 정리 → 재실행 뒤에도 재질을 해제하지 않고, 내려가면 해제한다', async () => {
    const dispose = vi.spyOn(LineBasicMaterial.prototype, 'dispose')
    try {
      await act(async () => {
        store = root.render(
          <StrictMode>
            <SensorGizmos />
          </StrictMode>
        )
      })
      await select('bot')
      await flush()
      expect(dispose).not.toHaveBeenCalled()
      const lines = drawn().filter((object) => object instanceof LineSegments)
      expect(lines.length).toBeGreaterThan(0)
      await act(async () => root.unmount())
      await flush()
      expect(dispose).toHaveBeenCalled()
      // afterEach가 다시 내리지 않게 새 뿌리
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
    } finally {
      dispose.mockRestore()
    }
  })
})
