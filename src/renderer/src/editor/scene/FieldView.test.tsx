import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { StrictMode } from 'react'
import * as THREE from 'three'
import { Mesh, MeshBasicMaterial, Object3D, type Texture } from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import en from '../../i18n/locales/en'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { newRun, usePlayStore, type PlayRun } from '../../play/playStore'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { resetSceneVisibility, useSceneVisibilityStore } from '../sceneVisibility'
import FieldView from './FieldView'

// 씬 뷰 시즌 필드(FieldView)를 WebGL 없이 그린다(SceneObjectsView.test.tsx와 같은 가짜 렌더러). C5(실행 중 표시), C8(시작
// 표시 그리는 조건), C14(언어를 바꾸면 벽 라벨 텍스처를 다시 만듦), StrictMode 정리 → 재실행 뒤에도 텍스처가 남음.

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

const SCENE: SceneObjects = {
  bot: {
    id: 'bot',
    name: 'Bot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  },
  part: {
    id: 'part',
    name: 'Part',
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

// 벽 라벨이 쓰는 캔버스(글자를 그린 기록만 남긴다)
const drawn: string[] = []
function fakeDocument(): object {
  return {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        font: '',
        fillStyle: '',
        textAlign: '',
        textBaseline: '',
        fillText: (text: string) => drawn.push(text)
      })
    })
  }
}

let root: ReconcilerRoot<HTMLCanvasElement>
let store: RootStore

const scene = (): Object3D => store.getState().scene as Object3D
const named = (name: string): Object3D | undefined => scene().getObjectByName(name)
const meshesNamed = (prefix: string): Mesh[] => {
  const found: Mesh[] = []
  scene().traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith(prefix)) found.push(object)
  })
  return found
}
const labelTexture = (side: string): Texture | null =>
  ((named(`wallLabel.${side}`) as Mesh | undefined)?.material as MeshBasicMaterial | undefined)
    ?.map ?? null

async function mount(strict = false): Promise<void> {
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
          <FieldView />
        </StrictMode>
      ) : (
        <FieldView />
      )
    )
  })
}

// 미뤄 둔 해제(setTimeout 0)가 돌 때까지
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

function run(patch: Partial<PlayRun> = {}): PlayRun {
  return {
    ...newRun({
      runId: 'r',
      root: '/p',
      opMode: OP_MODE,
      robotId: 'bot',
      configPath: null,
      speed: 1,
      paused: false,
      field: { season: 'none', hiveTipped: [false, false] }
    }),
    phase: 'running',
    ...patch
  }
}

beforeAll(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  extend(THREE as never)
  const warn = console.warn
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes('THREE.Clock')) warn(...args)
  })
  vi.stubGlobal('document', fakeDocument())
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko }, en: { translation: en } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

afterAll(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  await i18n.changeLanguage('ko')
  drawn.length = 0
  useSceneStore.setState({ objects: SCENE, field: { season: 'biobuzz' } })
  useEditorStore.getState().select(null)
  usePlayStore.setState({ run: null, settings: DEFAULT_PLAY_SETTINGS })
  resetSceneVisibility()
})

afterEach(async () => {
  await act(async () => root.unmount())
  await settle()
})

const set = async (update: () => void): Promise<void> => {
  await act(async () => update())
}

describe('FieldView', () => {
  it('BIOBUZZ: 구조물·태그·벽 라벨과 HIVE carrier 그룹, 필드 메시는 클릭되지 않는다', async () => {
    await mount()
    expect(named('seasonField')).toBeDefined()
    expect(meshesNamed('structure')).toHaveLength(17)
    expect(meshesNamed('tag')).toHaveLength(16)
    expect(meshesNamed('wallLabel')).toHaveLength(4)
    const hive = resolveSeason('biobuzz').hives[0]
    expect(named('hiveRed')!.rotation.y).toBeCloseTo(hive.startAngle, 12)
    // 태그는 HIVE carrier 그룹 안
    expect(named('tag30')!.parent!.name).toBe('hiveRed')
    // 클릭되지 않는다
    const hits: THREE.Intersection[] = []
    named('structure0')!.raycast(new THREE.Raycaster(), hits)
    expect(hits).toEqual([])
    // HIVE 상태를 바꾸면 그 그룹이 따른다
    await set(() =>
      usePlayStore.getState().updateSettings({ hiveState: { red: 'tipped', blue: 'start' } })
    )
    expect(named('hiveRed')!.rotation.y).toBeCloseTo(hive.tippedAngle, 12)
  })

  it('필드 요소 숨김·고립이면 구조물·태그·라벨이 빠지고 바닥·벽·테이프는 남는다', async () => {
    await mount()
    await set(() => useSceneVisibilityStore.setState({ fieldHidden: true }))
    expect(meshesNamed('structure')).toHaveLength(0)
    expect(meshesNamed('tag')).toHaveLength(0)
    expect(meshesNamed('wallLabel')).toHaveLength(0)
    expect(meshesNamed('tape')).toHaveLength(14)
    expect(named('floor')).toBeDefined()
    await set(() => useSceneVisibilityStore.setState({ fieldHidden: false, isolated: ['bot'] }))
    expect(meshesNamed('structure')).toHaveLength(0)
    expect(meshesNamed('rail')).not.toHaveLength(0)
  })

  it("실행이 잠그면 실행의 시즌, 떼어 놓은 실행은 문서 시즌(C5). 'none'은 FieldFloor", async () => {
    await mount()
    await set(() => usePlayStore.setState({ run: run() }))
    expect(named('seasonField')).toBeUndefined()
    await set(() => usePlayStore.setState({ run: run({ detached: true }) }))
    expect(named('seasonField')).toBeDefined()
    await set(() => usePlayStore.setState({ run: null }))
    await set(() => useSceneStore.setState({ field: { season: 'decode2027' } }))
    expect(named('seasonField')).toBeUndefined()
  })

  it('언어를 바꾸면 벽 라벨 텍스처를 다시 만들고 이전 것은 해제한다(C14)', async () => {
    await mount()
    const before = labelTexture('minusY')!
    expect(before).not.toBeNull()
    expect(drawn).toContain('빨강 벽')
    const dispose = vi.spyOn(before, 'dispose')
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    const after = labelTexture('minusY')!
    expect(after).not.toBe(before)
    expect(drawn).toContain('Red wall')
    await settle()
    expect(dispose).toHaveBeenCalled()
  })

  it('StrictMode 정리 → 재실행 뒤에도 라벨·태그 텍스처가 남는다', async () => {
    await mount(true)
    await settle()
    const label = labelTexture('plusY')!
    const tag = ((named('tag30') as Mesh).material as MeshBasicMaterial).map!
    const labelDispose = vi.spyOn(label, 'dispose')
    const tagDispose = vi.spyOn(tag, 'dispose')
    await settle()
    expect(labelDispose).not.toHaveBeenCalled()
    expect(tagDispose).not.toHaveBeenCalled()
    // 내려가면 해제한다
    await act(async () => root.unmount())
    await settle()
    expect(labelDispose).toHaveBeenCalled()
    expect(tagDispose).toHaveBeenCalled()
    await mount()
  })
})

describe('시작 표시 그리는 조건(C8)', () => {
  const markers = (): Mesh[] => meshesNamed('start.')

  it('대상 로봇(하위 파트가 활성이어도)이 있거나 Field 선택일 때만', async () => {
    await mount()
    expect(markers()).toHaveLength(0)
    await set(() => useEditorStore.getState().select('part'))
    expect(markers()).toHaveLength(12)
    await set(() => useEditorStore.getState().selectField())
    expect(markers()).toHaveLength(12)
  })

  it('실행 중·fieldHidden·고립 중·프리셋 없는 시즌에는 없다', async () => {
    await mount()
    await set(() => useEditorStore.getState().select('bot'))
    expect(markers()).toHaveLength(12)
    await set(() => usePlayStore.setState({ run: run() }))
    expect(markers()).toHaveLength(0)
    await set(() => usePlayStore.setState({ run: null }))
    await set(() => useSceneVisibilityStore.setState({ fieldHidden: true }))
    expect(markers()).toHaveLength(0)
    await set(() => useSceneVisibilityStore.setState({ fieldHidden: false, isolated: ['bot'] }))
    expect(markers()).toHaveLength(0)
    await set(() => useSceneVisibilityStore.setState({ isolated: null }))
    expect(markers()).toHaveLength(12)
    await set(() => useSceneStore.setState({ field: { season: 'none' } }))
    expect(markers()).toHaveLength(0)
  })

  it('가림은 사건 때의 internal.interaction으로 본다(R3F가 내린 오브젝트를 빼며 배열을 바꿔도 다시 그리지 않음)', async () => {
    await mount()
    await set(() => useEditorStore.getState().select('bot'))
    scene().updateMatrixWorld(true)
    const marker = markers()[0]
    const at = marker.getWorldPosition(new THREE.Vector3())
    // 표시 위 2 m에서 아래로 보는 광선과, 그 사이(표시 0.2 m 위)의 클릭되는 로봇 파트
    const state = store.getState()
    state.raycaster.set(at.clone().setZ(at.z + 2), new THREE.Vector3(0, 0, -1))
    const occluder = new Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1))
    occluder.position.set(at.x, at.y, at.z + 0.2)
    occluder.updateMatrixWorld(true)
    state.internal.interaction.push(occluder)
    const cursor = (): string => (state.gl.domElement.style as { cursor?: string }).cursor ?? ''
    const move = async (): Promise<void> => {
      const handlers = (marker as unknown as { __r3f: { handlers: Record<string, unknown> } }).__r3f
        .handlers
      const onPointerMove = handlers.onPointerMove as (event: object) => void
      await act(async () => onPointerMove({ stopPropagation: () => {}, distance: 2 }))
    }
    await move()
    expect(cursor()).toBe('')
    // H로 로봇을 숨긴 것처럼 R3F removeInteractivity가 배열을 바꾼다(store.set 없음, 아무것도 다시 그리지 않음)
    const live = store.getState().internal
    live.interaction = live.interaction.filter((object) => object !== occluder)
    await move()
    expect(cursor()).not.toBe('')
  })
})
