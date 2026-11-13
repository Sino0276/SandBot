import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import { StrictMode } from 'react'
import * as THREE from 'three'
import { InstancedMesh, Matrix4, MeshStandardMaterial, Vector3, type Object3D } from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { resolveElementType } from '../../../../shared/sim/elements/elementData'
import { quantizeElements } from '../../../../shared/sim/elements/gameState'
import { elementSpawns } from '../../../../shared/sim/elements/spawn'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import type { SimElementState } from '../../../../shared/sim/worldSpec'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { newRun, usePlayStore, type PlayRun, type PlayRunElements } from '../../play/playStore'
import type { SceneObject, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { useSceneVisibilityStore } from '../sceneVisibility'
import ElementsView from './ElementsView'
import {
  editElementLayers,
  ghostElementBalls,
  posesToBalls,
  runElementBalls
} from './elementsViewModel'

// 씬 뷰 경기 요소(6a, spec-6a §5): 편집 중 시작 배치·프리로드(자동은 반투명), 실행 중 시뮬레이터 상태를 React 렌더 없이 쓰기,
// 끝난 실행의 잔상, 숨김·고립 보기, 클릭되지 않음, StrictMode 뒤에도 자원이 살아 있음. R3F를 WebGL 없이 그린다.

const BIOBUZZ = resolveSeason('biobuzz')
const POLLEN_R = resolveElementType(BIOBUZZ, 'pollen')!.radius

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
const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 5))

const mesh = (layer: string, kind = 'pollen'): InstancedMesh => {
  let found: InstancedMesh | null = null
  ;(store.getState().scene as Object3D).traverse((object) => {
    if (object instanceof InstancedMesh && object.name === `elements.${layer}.${kind}`)
      found = object
  })
  if (!found) throw new Error(`${layer}.${kind}`)
  return found
}
const instancePosition = (m: InstancedMesh, i: number): Vector3 => {
  const matrix = new Matrix4()
  m.getMatrixAt(i, matrix)
  return new Vector3().setFromMatrixPosition(matrix)
}

const object = (
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  position: [number, number, number],
  extra: Partial<SceneObject> = {}
): SceneObject => ({
  id,
  name: id,
  kind,
  parentId,
  transform: { position, rotation: [0, 0, 0] },
  ...extra
})
// 빈 타일의 로봇(자리 없음 → 자동 앞 넷)과 팀 자리 하나를 둔 로봇
const scene = (): SceneObjects => ({
  A: object('A', 'robot', null, [-0.9, -0.9, 0]),
  B: object('B', 'robot', null, [0.9, 0.9, 0]),
  hopper: object('hopper', 'group', 'B', [0, 0, 0.1], {
    preload: { kind: 'pollen', center: [0, 0, 0] }
  })
})

const TELEOP: OpModeInfo = {
  className: 'a.B',
  path: 'B.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'B',
  group: '',
  preselectTeleOp: ''
}
const spawns = elementSpawns(BIOBUZZ, { groups: ['garden'], preloads: [] }, { x: 0, y: 0, yaw: 0 })
const ELEMENTS: PlayRunElements = { kinds: spawns.map((s) => s.kind), spawns }
const running = (elements: PlayRunElements | null = ELEMENTS): PlayRun => ({
  ...newRun({
    runId: 'r',
    root: '/p',
    opMode: TELEOP,
    robotId: 'A',
    configPath: null,
    speed: 1,
    paused: false,
    field: { season: 'biobuzz', hiveTipped: [false, false], gameElements: true },
    elements
  }),
  phase: 'running' as const
})

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
  useSceneStore.setState({ objects: scene(), field: { season: 'biobuzz' } })
  useEditorStore.setState({ selectedId: null, selectedIds: [] })
  usePlayStore.setState({
    run: null,
    simGame: null,
    ghostGame: null,
    settings: DEFAULT_PLAY_SETTINGS
  })
  useSceneVisibilityStore.setState({ hidden: new Set(), isolated: null, fieldHidden: false })
  await newRoot()
  await act(async () => {
    store = root.render(<ElementsView />)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  await flush()
})

describe('ElementsView 편집 중', () => {
  it('켠 BIOBUZZ는 GARDEN 여덟(불투명), 대상 로봇의 자동 자리는 반투명, 팀 자리는 불투명', async () => {
    expect(mesh('solid').count).toBe(8)
    expect(mesh('preview').count).toBe(0)
    expect(mesh('solid', 'nectarRed').count).toBe(0)
    const first = instancePosition(mesh('solid'), 0)
    // 인스턴스 행렬은 Float32
    expect(first.x).toBeCloseTo(spawns[0].position.x, 6)
    expect(first.z).toBeCloseTo(POLLEN_R, 6)
    await act(async () => useEditorStore.setState({ selectedId: 'A', selectedIds: ['A'] }))
    expect(mesh('preview').count).toBe(4)
    // 자동 자리: 로봇 앞(+X) 바닥 위
    expect(instancePosition(mesh('preview'), 0).x).toBeGreaterThan(-0.9 + 0.2)
    expect(instancePosition(mesh('preview'), 0).z).toBeCloseTo(POLLEN_R, 6)
    await act(async () =>
      useEditorStore.setState({ selectedId: 'hopper', selectedIds: ['hopper'] })
    )
    expect(mesh('preview').count).toBe(0)
    expect(mesh('solid').count).toBe(9)
    const slot = instancePosition(mesh('solid'), 8)
    expect(slot.x).toBeCloseTo(0.9, 6)
    expect(slot.y).toBeCloseTo(0.9, 6)
    expect(slot.z).toBeCloseTo(0.1, 6)
    // 반투명 층은 renderOrder 5·깊이 쓰기 끔
    expect(mesh('preview').renderOrder).toBe(5)
    expect((mesh('preview').material as MeshStandardMaterial).depthWrite).toBe(false)
    expect((mesh('solid').material as MeshStandardMaterial).color.getHexString()).toBe('f2d21b')
  })

  it('개인 설정을 끄거나 경기 요소 없는 시즌이면 그리지 않고, 숨김·고립 보기는 층을 감춘다', async () => {
    await act(async () =>
      usePlayStore.setState({ settings: { ...DEFAULT_PLAY_SETTINGS, gameElements: false } })
    )
    expect(mesh('solid').count).toBe(0)
    await act(async () => usePlayStore.setState({ settings: DEFAULT_PLAY_SETTINGS }))
    expect(mesh('solid').count).toBe(8)
    await act(async () => useSceneStore.setState({ field: { season: 'none' } }))
    expect(mesh('solid').count).toBe(0)
    await act(async () => useSceneStore.setState({ field: { season: 'biobuzz' } }))
    const group = mesh('solid').parent!
    expect(group.visible).toBe(true)
    await act(async () => useSceneVisibilityStore.setState({ fieldHidden: true }))
    expect(group.visible).toBe(false)
    await act(async () => useSceneVisibilityStore.setState({ fieldHidden: false, isolated: ['A'] }))
    expect(group.visible).toBe(false)
  })

  it('클릭되지 않는다', () => {
    const hits: unknown[] = []
    mesh('solid').raycast(new THREE.Raycaster(), hits as never)
    expect(hits).toEqual([])
  })
})

describe('ElementsView 실행 중·잔상', () => {
  it('상태를 받기 전에는 시작 상태, 받으면 React 렌더 없이 인스턴스만 바꾸고 필드 밖 공은 뺀다', async () => {
    await act(async () => usePlayStore.setState({ run: running() }))
    expect(mesh('solid').count).toBe(8)
    expect(mesh('preview').count).toBe(0)
    const moved: SimElementState[] = spawns.map((s, i) =>
      i === 0 ? { ...s, position: { x: 0.5, y: 0.25, z: 0.04 } } : s
    )
    const q = quantizeElements(moved)
    q.flags[7] = 2
    const solid = mesh('solid')
    // act 밖에서 바꿔도(React 렌더 없이) 구독이 쓴다
    usePlayStore.setState({
      simGame: { runId: 'r', tNanos: 5, revision: 1, poses: q.poses, flags: q.flags }
    })
    expect(solid.count).toBe(7)
    const p = instancePosition(solid, 0)
    expect(p.x).toBeCloseTo(0.5, 6)
    expect(p.y).toBeCloseTo(0.25, 6)
    expect(p.z).toBeCloseTo(0.04, 6)
    // 다른 실행의 상태는 그리지 않는다(시작 상태)
    usePlayStore.setState({
      simGame: { runId: 'old', tNanos: 6, revision: 2, poses: q.poses, flags: q.flags }
    })
    expect(solid.count).toBe(8)
    // 경기 요소 없이 실행한 것은 공이 없다(편집 배치도 그리지 않는다)
    await act(async () => usePlayStore.setState({ run: running(null), simGame: null }))
    expect(mesh('solid').count).toBe(0)
  })

  it('끝난 실행의 잔상은 반투명 층(필드 밖 제외)이고, 편집 배치와 함께 보인다', async () => {
    const q = quantizeElements(spawns)
    q.flags[0] = 2
    await act(async () =>
      usePlayStore.setState({
        run: { ...running(), phase: 'finished' },
        ghostGame: { kinds: ELEMENTS.kinds, poses: q.poses, flags: q.flags }
      })
    )
    expect(mesh('ghost').count).toBe(7)
    expect(mesh('ghost').renderOrder).toBe(5)
    expect(mesh('solid').count).toBe(8)
  })

  it('StrictMode의 정리 → 재실행 뒤에도 재질·형상을 해제하지 않고, 내려가면 해제한다', async () => {
    await act(async () => root.unmount())
    await flush()
    const material = vi.spyOn(MeshStandardMaterial.prototype, 'dispose')
    const geometry = vi.spyOn(THREE.SphereGeometry.prototype, 'dispose')
    try {
      await newRoot()
      await act(async () => {
        store = root.render(
          <StrictMode>
            <ElementsView />
          </StrictMode>
        )
      })
      await flush()
      expect(material).not.toHaveBeenCalled()
      expect(geometry).not.toHaveBeenCalled()
      expect(mesh('solid').count).toBe(8)
      await act(async () => root.unmount())
      await flush()
      expect(material).toHaveBeenCalled()
      expect(geometry).toHaveBeenCalled()
      await newRoot()
      await act(async () => {
        store = root.render(<ElementsView />)
      })
    } finally {
      material.mockRestore()
      geometry.mockRestore()
    }
  })
})

describe('elementsViewModel', () => {
  it('posesToBalls는 공 수가 다르면 빈 목록, 줄인 사원수를 단위로 맞춘다', () => {
    expect(posesToBalls(['pollen'], [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], undefined)).toEqual(
      []
    )
    const [ball] = posesToBalls(['pollen'], [10000, 0, 356, 0, 20000, 0, 0], [1])
    expect(ball.position).toEqual([1, 0, 0.0356])
    expect(ball.orientation).toEqual([0, 1, 0, 0])
  })

  it('runElementBalls는 표시 상태가 없으면 시작 상태(밖 표식 제외), ghost 없으면 빈 목록', () => {
    const out = { ...ELEMENTS, spawns: ELEMENTS.spawns.map((s, i) => ({ ...s, out: i === 1 })) }
    expect(runElementBalls(out, null)).toHaveLength(7)
    expect(ghostElementBalls(null)).toEqual([])
  })

  it("editElementLayers: 'none'은 비고, 대상 로봇이 없으면 배치만", () => {
    expect(editElementLayers(scene(), 'A', resolveSeason('none'))).toEqual({
      solid: [],
      preview: []
    })
    const layers = editElementLayers(scene(), null, BIOBUZZ)
    expect(layers.solid).toHaveLength(8)
    expect(layers.preview).toEqual([])
  })
})
