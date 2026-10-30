import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import { StrictMode } from 'react'
import * as THREE from 'three'
import {
  LineSegments,
  Mesh,
  Object3D,
  Raycaster,
  Vector3,
  type BufferGeometry,
  type Material
} from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashOp } from '../../../../shared/dashboard'
import { INCH, OVERLAY_Z } from '../../play/dashOverlay'
import { usePlayStore } from '../../play/playStore'
import DashboardOverlay from './DashboardOverlay'

// 씬 뷰의 FTC Dashboard 오버레이: op 묶음마다 메시·선을 그리기 순서대로 두고, 클릭되지 않으며, 오버레이가 바뀌거나
// 지워지면 이전 것을 떼어 해제한다(StrictMode가 붙였다 떼어도). WebGL 없이 그린다(가짜 렌더러).

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

const drawn = (): (Mesh | LineSegments)[] => {
  const found: (Mesh | LineSegments)[] = []
  ;(store.getState().scene as Object3D).traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) found.push(object)
  })
  return found
}

const OPS: DashOp[] = [
  { type: 'fill', color: '#ff0000' },
  { type: 'polygon', xPoints: [0, 10, 10, 0], yPoints: [0, 0, 10, 10], stroke: false },
  {
    type: 'grid',
    x: 0,
    y: 0,
    width: 24,
    height: 24,
    numTicksX: 2,
    numTicksY: 2,
    theta: 0,
    pivotX: 0,
    pivotY: 0,
    usePageFrame: false
  },
  { type: 'stroke', color: 'blue' },
  { type: 'polyline', xPoints: [0, 20], yPoints: [0, 0] }
]

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

const fakeCanvas = (): HTMLCanvasElement =>
  ({
    style: {},
    width: 800,
    height: 600,
    addEventListener: () => {},
    removeEventListener: () => {}
  }) as unknown as HTMLCanvasElement

beforeEach(async () => {
  usePlayStore.setState({ dashOverlay: null })
  root = createRoot(fakeCanvas())
  await root.configure({
    gl: fakeRenderer() as never,
    frameloop: 'never',
    size: { width: 800, height: 600, top: 0, left: 0 }
  })
  await act(async () => {
    store = root.render(
      <StrictMode>
        <DashboardOverlay />
      </StrictMode>
    )
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
})

describe('Dashboard 오버레이(씬 뷰)', () => {
  it('op 묶음을 그리기 순서대로 두고, 필드 미터 바닥 바로 위에 놓는다', async () => {
    expect(drawn()).toHaveLength(0)
    await act(async () => {
      usePlayStore.setState({ dashOverlay: { runId: 'r', tNanos: 0, ops: OPS } })
    })
    const objects = drawn()
    // 채움, 격자 선, 선 띠
    expect(objects.map((object) => object.constructor.name)).toEqual([
      'Mesh',
      'LineSegments',
      'Mesh'
    ])
    const orders = objects.map((object) => object.renderOrder)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
    expect(new Set(orders).size).toBe(3)
    const fill = objects[0].geometry.getAttribute('position')
    const xs = Array.from({ length: fill.count }, (_, i) => fill.getX(i))
    expect(Math.max(...xs)).toBeCloseTo(10 * INCH)
    expect(fill.getZ(0)).toBeCloseTo(OVERLAY_Z, 6)
    // 꼭짓점 색은 선형(빨강 = 1, 0, 0)과 alpha
    const color = objects[0].geometry.getAttribute('color')
    expect([color.getX(0), color.getY(0), color.getZ(0), color.getW(0)]).toEqual([1, 0, 0, 1])
  })

  it('클릭되지 않는다', async () => {
    await act(async () => {
      usePlayStore.setState({ dashOverlay: { runId: 'r', tNanos: 0, ops: OPS } })
    })
    const raycaster = new Raycaster(new Vector3(0.05, 0.05, 1), new Vector3(0, 0, -1))
    expect(raycaster.intersectObjects(drawn(), true)).toEqual([])
  })

  it('바뀌거나 지워지면 이전 것을 떼고 해제한다', async () => {
    await act(async () => {
      usePlayStore.setState({ dashOverlay: { runId: 'r', tNanos: 0, ops: OPS } })
    })
    const before = drawn()
    const disposed = vi.fn()
    for (const object of before)
      (object.geometry as BufferGeometry).addEventListener('dispose', disposed)
    await act(async () => {
      usePlayStore.setState({ dashOverlay: { runId: 'r', tNanos: 1, ops: OPS.slice(0, 2) } })
    })
    expect(disposed).toHaveBeenCalledTimes(3)
    expect(drawn()).toHaveLength(1)
    await act(async () => {
      usePlayStore.setState({ dashOverlay: null })
    })
    expect(drawn()).toHaveLength(0)
  })

  it('패킷이 바뀌어도 재질은 이어 쓰고(셰이더를 다시 컴파일하지 않게) 내려갈 때 해제한다', async () => {
    await act(async () => {
      usePlayStore.setState({ dashOverlay: { runId: 'r', tNanos: 0, ops: OPS } })
    })
    const materials = new Set(drawn().map((object) => object.material as Material))
    // 채움과 선 띠는 한 재질, 격자 선은 다른 재질
    expect(materials.size).toBe(2)
    const disposed = vi.fn()
    for (const material of materials) material.addEventListener('dispose', disposed)
    const moved = OPS.map((op) =>
      op.type === 'polyline' ? { ...op, xPoints: [0, 30], yPoints: [5, 5] } : op
    )
    await act(async () => {
      usePlayStore.setState({ dashOverlay: { runId: 'r', tNanos: 1, ops: moved } })
    })
    await act(async () => {
      usePlayStore.setState({ dashOverlay: null })
    })
    await act(async () => {
      usePlayStore.setState({ dashOverlay: { runId: 'r', tNanos: 2, ops: OPS } })
    })
    expect(disposed).not.toHaveBeenCalled()
    expect(new Set(drawn().map((object) => object.material as Material))).toEqual(materials)
    await act(async () => root.unmount())
    expect(disposed).toHaveBeenCalledTimes(2)
  })
})
