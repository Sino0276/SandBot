import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import { StrictMode } from 'react'
import * as THREE from 'three'
import {
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Vector3,
  type Object3D
} from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { newRun, usePlayStore } from '../../play/playStore'
import type { ColliderSettings } from '../../scene/collider'
import { disposeAllGeometry } from '../../scene/geometryRegistry'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { useJointPreviewStore } from '../joint/jointPreviewStore'
import { useSceneVisibilityStore } from '../sceneVisibility'
import ColliderGizmos from './ColliderGizmos'
import {
  capsuleSegments,
  colliderGizmoTargets,
  CAPSULE_SEGMENTS,
  gizmoBodyNumbers
} from './colliderGizmoModel'
import { defaultJoint } from '../../scene/joint'
import { colliderScene, registerSceneMeshes, resetCollisionModels } from './colliderTestkit'
import { jointBodyFrames } from '../../play/worldJoints'

// 씬 뷰 Collider 기즈모(spec-5 §7, B14): 대상 규칙, Unity 충돌체 색 두 패스, 끈 것·대체 상자 모양, 실행 중 표시 자세, 숨김 규칙,
// StrictMode의 정리 → 재실행 뒤에도 재질이 살아 있음. R3F를 WebGL 없이 그린다(SensorGizmos.test.tsx와 같은 가짜 렌더러).

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

const canvas = (): HTMLCanvasElement =>
  ({
    style: {},
    width: 800,
    height: 600,
    addEventListener: () => {},
    removeEventListener: () => {}
  }) as unknown as HTMLCanvasElement

async function newRoot(): Promise<void> {
  root = createRoot(canvas())
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
  useSceneStore.setState({ objects: colliderScene(), geometryRevision: 1 })
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
const setObjects = async (objects: SceneObjects): Promise<void> => {
  await act(async () => {
    useSceneStore.setState({
      objects,
      geometryRevision: useSceneStore.getState().geometryRevision + 1
    })
  })
}
const withColliders = (
  objects: SceneObjects,
  id: string,
  colliders: ColliderSettings[]
): SceneObjects => ({
  ...objects,
  [id]: { ...objects[id], colliders }
})
const BOX: ColliderSettings = { id: 'b', kind: 'box', center: [0, 0, 0], size: [0.1, 0.1, 0.1] }
const hex = (line: LineSegments): string =>
  `#${(line.material as LineBasicMaterial).color.getHexString()}`

describe('B14 대상 규칙', () => {
  it('B14 고른 오브젝트의 몸체, 그 하위 관절 몸체, 로봇이면 모든 몸체', () => {
    const objects = colliderScene()
    const bodies = (id: string): number[] =>
      colliderGizmoTargets(objects, [id], () => jointBodyFrames(objects, 'R')).get('R') ?? []
    expect(bodies('R')).toEqual([-1, 0, 1])
    expect(bodies('base')).toEqual([-1])
    expect(bodies('plate')).toEqual([0])
    // 관절 아닌 그룹 mech(섀시 몸체) 하위에 팔 관절
    expect(bodies('mech')).toEqual([-1, 1])
    expect(colliderGizmoTargets(objects, ['loose'], () => jointBodyFrames(objects, 'R')).size).toBe(
      0
    )
    expect(colliderGizmoTargets(objects, [], () => jointBodyFrames(objects, 'R')).size).toBe(0)
  })

  it('B14 캡슐은 끝 원 둘·옆선 넷·반원 넷(각 32분할), 구는 큰 원 셋', () => {
    const capsule = capsuleSegments({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }, 0.02)
    expect(capsule.length / 6).toBe(2 * CAPSULE_SEGMENTS + 4 + 4 * CAPSULE_SEGMENTS)
    const sphere = capsuleSegments({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.02)
    expect(sphere.length / 6).toBe(3 * CAPSULE_SEGMENTS)
    // 모든 점이 선분에서 반지름 거리 안
    for (let i = 0; i < capsule.length; i += 3) {
      const x = Math.min(0.2, Math.max(0, capsule[i]))
      expect(Math.hypot(capsule[i] - x, capsule[i + 1], capsule[i + 2])).toBeCloseTo(0.02, 9)
    }
  })
})

describe('B14 그리기', () => {
  it('B14 Unity 충돌체 초록 두 패스(깊이 검사 켬 0.9·끔 0.2), renderOrder 11, 클릭되지 않음', async () => {
    await act(async () => {
      store = root.render(<ColliderGizmos />)
    })
    expect(lines()).toHaveLength(0)
    await select('R')
    const drawn = lines()
    // 몸체 셋의 자동 껍질 하나씩 × 두 패스
    expect(drawn).toHaveLength(6)
    for (const line of drawn) {
      expect(hex(line)).toBe('#91f48b')
      expect(line.renderOrder).toBe(11)
      const hits: unknown[] = []
      line.raycast({} as never, hits as never)
      expect(hits).toEqual([])
      const material = line.material as LineBasicMaterial
      expect(material.toneMapped).toBe(false)
      expect(material instanceof LineDashedMaterial).toBe(false)
    }
    const passes = drawn.map((line) => {
      const material = line.material as LineBasicMaterial
      return [material.depthTest, material.opacity]
    })
    expect(passes.filter(([depth]) => depth === true).every(([, o]) => o === 0.9)).toBe(true)
    expect(passes.filter(([depth]) => depth === false).every(([, o]) => o === 0.2)).toBe(true)
  })

  it('B14 끈 Collider는 #54c84d, 활성 오브젝트의 Collider는 불투명도 1, 섀시 대체 상자는 점선', async () => {
    await act(async () => {
      store = root.render(<ColliderGizmos />)
    })
    await setObjects(
      withColliders(withColliders(colliderScene(), 'base', [{ ...BOX, enabled: false }]), 'plate', [
        BOX
      ])
    )
    await select('plate')
    // 판을 고르면 리프트 몸체만: 활성 오브젝트의 Collider라 앞 패스 불투명도 1
    const plate = lines()
    expect(plate).toHaveLength(2)
    expect(plate.map((line) => (line.material as LineBasicMaterial).opacity).sort()).toEqual(
      [0.2 / 0.9, 1].sort()
    )
    await select('base')
    const base = lines()
    expect(base).toHaveLength(2)
    expect(base.every((line) => hex(line) === '#54c84d')).toBe(true)
    // 섀시 메시를 읽지 않았으면 외곽 대체 상자(점선)
    disposeAllGeometry()
    await setObjects(colliderScene())
    await select('base')
    const fallback = lines()
    expect(fallback).toHaveLength(2)
    expect(fallback.every((line) => line.material instanceof LineDashedMaterial)).toBe(true)
  })

  it('B14 숨김: 사용자 Collider는 붙인 오브젝트가, 자동 껍질은 몸체 오브젝트가 숨었을 때만 그리지 않는다', async () => {
    await act(async () => {
      store = root.render(<ColliderGizmos />)
    })
    await setObjects(withColliders(colliderScene(), 'plate', [BOX]))
    await select('R')
    expect(lines()).toHaveLength(6)
    // 판(사용자 Collider의 주인)을 숨기면 리프트의 상자가 빠진다
    await act(async () => {
      useSceneVisibilityStore.setState({ hidden: new Set(['plate']) })
    })
    expect(lines()).toHaveLength(4)
    // 섀시 판을 숨겨도 섀시 자동 껍질은 그대로, 로봇(몸체 오브젝트)을 숨기면 빠진다
    await act(async () => {
      useSceneVisibilityStore.setState({ hidden: new Set(['base']) })
    })
    expect(lines()).toHaveLength(6)
    await act(async () => {
      useSceneVisibilityStore.setState({ hidden: new Set(['R']) })
    })
    expect(lines()).toHaveLength(4)
  })

  it('B14 실행이 그 로봇을 잠그면 run.colliders를 표시 자세 몸체 틀로 그린다(실행 중 바꾼 문서 Collider는 그리지 않음)', async () => {
    const op: OpModeInfo = {
      className: 'a.B',
      path: 'src/main/java/a/B.java',
      line: 1,
      flavor: 'TeleOp',
      name: 'B',
      group: '',
      preselectTeleOp: ''
    }
    const run = newRun({
      runId: 'r',
      root: '/p',
      opMode: op,
      robotId: 'R',
      configPath: null,
      speed: 1,
      paused: false,
      joints: ['lift', 'arm'],
      colliders: [
        {
          body: -1,
          objectId: 'R',
          name: 'Robot',
          colliders: [
            {
              kind: 'box',
              center: { x: 0, y: 0, z: 0.1 },
              rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
              half: { x: 0.2, y: 0.2, z: 0.1 },
              friction: 0.4
            }
          ]
        }
      ]
    })
    await act(async () => {
      store = root.render(<ColliderGizmos />)
    })
    await act(async () => {
      usePlayStore.setState({
        run: { ...run, phase: 'running' },
        simPose: { robotId: 'R', tNanos: 1, x: 1, y: 2, yaw: Math.PI / 2, blocked: false }
      })
    })
    await select('R')
    const drawn = lines()
    // 실행의 섀시 상자 하나 × 두 패스(문서의 관절 몸체 자동 껍질은 실행에 없어 그리지 않는다)
    expect(drawn).toHaveLength(2)
    const group = drawn[0].parent as Group
    const position = new Vector3().setFromMatrixPosition(group.matrix)
    expect(position.x).toBeCloseTo(1, 12)
    expect(position.y).toBeCloseTo(2, 12)
    const x = new Vector3(1, 0, 0).transformDirection(new Matrix4().copy(group.matrix))
    expect(x.y).toBeCloseTo(1, 12)
    // 실행 중 문서에 Collider를 붙여도 실행의 형상 그대로
    await setObjects(withColliders(colliderScene(), 'base', [BOX, { ...BOX, id: 'b2' }]))
    expect(lines()).toHaveLength(2)
  })

  it('5 리뷰: 실행 중 관절을 붙이거나 떼도 고른 오브젝트의 INIT 몸체를 그린다(실행의 몸체 번호)', async () => {
    const op: OpModeInfo = {
      className: 'a.B',
      path: 'src/main/java/a/B.java',
      line: 1,
      flavor: 'TeleOp',
      name: 'B',
      group: '',
      preselectTeleOp: ''
    }
    // INIT 때 관절은 lift(0)·arm(1). 리프트 몸체는 상자(모서리 12), 팔 몸체는 캡슐(선분이 많다)
    const liftBox = {
      kind: 'box' as const,
      center: { x: 0, y: 0, z: 0.05 },
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      half: { x: 0.05, y: 0.1, z: 0.005 },
      friction: 0.4
    }
    const armCapsule = {
      kind: 'capsule' as const,
      a: { x: 0, y: 0, z: 0 },
      b: { x: 0.2, y: 0, z: 0 },
      radius: 0.01,
      friction: 0.4
    }
    const run = newRun({
      runId: 'r',
      root: '/p',
      opMode: op,
      robotId: 'R',
      configPath: null,
      speed: 1,
      paused: false,
      joints: ['lift', 'arm'],
      colliders: [
        { body: 0, objectId: 'lift', name: 'Lift', colliders: [liftBox] },
        { body: 1, objectId: 'arm', name: 'Arm', colliders: [armCapsule] }
      ]
    })
    const locked = { ...run, phase: 'running' as const }
    // 실행 중 문서 순서로 앞인 base에 관절을 붙이면 문서 번호는 base 0·lift 1·arm 2가 된다
    const added: SceneObjects = {
      ...colliderScene(),
      base: { ...colliderScene().base, joint: defaultJoint('revolute') }
    }
    expect(jointBodyFrames(added, 'R').objectIds).toEqual(['base', 'lift', 'arm'])
    const targets = (objects: SceneObjects, id: string): number[] =>
      colliderGizmoTargets(objects, [id], (robotId) =>
        gizmoBodyNumbers(objects, robotId, locked, jointBodyFrames(objects, robotId))
      ).get('R') ?? []
    expect(targets(added, 'plate')).toEqual([0])
    expect(targets(added, 'tube')).toEqual([1])
    expect(targets(added, 'base')).toEqual([-1])
    expect(targets(added, 'R')).toEqual([-1, 0, 1])
    // 리프트 관절을 떼어도 팔은 실행의 1번
    const removed: SceneObjects = {
      ...colliderScene(),
      lift: { ...colliderScene().lift, joint: undefined }
    }
    expect(targets(removed, 'tube')).toEqual([1])
    // 잠그지 않으면 문서 번호
    expect(
      colliderGizmoTargets(added, ['plate'], (robotId) =>
        gizmoBodyNumbers(added, robotId, null, jointBodyFrames(added, robotId))
      ).get('R')
    ).toEqual([1])
    // 그리기: plate를 고르면 리프트의 INIT 상자(모서리 12 × 두 패스), tube를 고르면 팔의 캡슐
    await act(async () => {
      store = root.render(<ColliderGizmos />)
    })
    await act(async () => {
      usePlayStore.setState({
        run: locked,
        simPose: { robotId: 'R', tNanos: 1, x: 0, y: 0, yaw: 0, blocked: false }
      })
    })
    await setObjects(added)
    await select('plate')
    const plate = lines()
    expect(plate).toHaveLength(2)
    expect(plate[0].geometry.getAttribute('position').count).toBe(24)
    await select('tube')
    const tube = lines()
    expect(tube).toHaveLength(2)
    expect(tube[0].geometry.getAttribute('position').count).toBe(
      capsuleSegments(armCapsule.a, armCapsule.b, armCapsule.radius).length / 3
    )
  })

  it('B14 StrictMode의 정리 → 재실행 뒤에도 재질을 해제하지 않고, 내려가면 해제한다', async () => {
    const dispose = vi.spyOn(LineBasicMaterial.prototype, 'dispose')
    try {
      await act(async () => {
        store = root.render(
          <StrictMode>
            <ColliderGizmos />
          </StrictMode>
        )
      })
      await select('R')
      await flush()
      expect(dispose).not.toHaveBeenCalled()
      expect(lines().length).toBeGreaterThan(0)
      await act(async () => root.unmount())
      await flush()
      expect(dispose).toHaveBeenCalled()
      await newRoot()
    } finally {
      dispose.mockRestore()
    }
  })
})
