import { act, createRoot, extend, type ReconcilerRoot } from '@react-three/fiber'
import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { useSceneStore } from '../../scene/sceneStore'
import { useComponentGeometryRevision } from './geometryRevision'

// 하드웨어 카드의 형상 판 구독(4d 리뷰): 웹캠 카드는 CAD 형상을 읽거나 다시 찾으면(objects는 그대로, geometryRevision만
// 오름) 다시 그려져 setCameraPose 줄이 하우징 앞면을 따른다. 다른 카드는 다시 그리지 않는다. DOM이 없어 R3F 재조정기로
// 훅만 그린다(CameraGizmos.test.tsx와 같은 가짜 렌더러).

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

describe('하드웨어 카드의 형상 판 구독', () => {
  it('웹캠만 형상 판이 오를 때 다시 그린다', async () => {
    const renders: Record<string, number> = { webcam: 0, motor: 0 }
    function Probe({ type }: { type: string }): null {
      useComponentGeometryRevision(type)
      renders[type]++
      return null
    }
    const canvas = {
      style: {},
      width: 8,
      height: 6,
      addEventListener: () => {},
      removeEventListener: () => {}
    } as unknown as HTMLCanvasElement
    const root: ReconcilerRoot<HTMLCanvasElement> = createRoot(canvas)
    await root.configure({
      gl: fakeRenderer() as never,
      frameloop: 'never',
      size: { width: 8, height: 6, top: 0, left: 0 }
    })
    await act(async () => {
      root.render(
        <>
          <Probe type="webcam" />
          <Probe type="motor" />
        </>
      )
    })
    const before = { ...renders }
    await act(async () => {
      useSceneStore.getState().bumpGeometryRevision()
    })
    expect(renders.webcam).toBe(before.webcam + 1)
    expect(renders.motor).toBe(before.motor)
    await act(async () => root.unmount())
  })
})
