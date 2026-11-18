import { act, createRoot, extend, type ReconcilerRoot, type RootStore } from '@react-three/fiber'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { StrictMode } from 'react'
import * as THREE from 'three'
import {
  BoxGeometry,
  Color,
  Euler,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Texture
} from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { alignmentRotation } from '../../cad/alignment'
import {
  clearLoadedFieldVisual,
  setLoadedFieldVisual,
  type FieldVisualGroup
} from '../../field/fieldVisualStore'
import en from '../../i18n/locales/en'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { newRun, usePlayStore, type PlayRun } from '../../play/playStore'
import type { FieldVisual } from '../../scene/fieldDoc'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { resetSceneVisibility, useSceneVisibilityStore } from '../sceneVisibility'
import FieldView from './FieldView'
import {
  CAD_TAG_FRONT_OFFSET,
  FIELD_RENDER_ORDER,
  fieldOutlineMeshes,
  fieldViewModel
} from './fieldViewModel'

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
  clearLoadedFieldVisual()
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

// ---- 필드 CAD 층(spec-4e §1.6–1.9, B5·B6·B7·B9) ----

const CAD_PATH = '/team/field.step'
const VISUAL: FieldVisual = {
  fileName: 'field.step',
  absolutePath: CAD_PATH,
  upAxis: '+Y',
  forwardAxis: '+Z'
}

function group(
  key: string,
  patch: Partial<Omit<FieldVisualGroup, 'key' | 'geometry'>> = {}
): FieldVisualGroup {
  return {
    key,
    color: [0.7913, 0.7913, 0.7913],
    vertexColors: false,
    glass: false,
    decal: false,
    geometry: new BoxGeometry(),
    ...patch
  }
}

// 불투명·투명판·decal, 그리고 불투명과 같은 재질 키의 묶음 하나
function cadGroups(): FieldVisualGroup[] {
  return [
    group('opaque', { color: [0.2159, 0.2159, 0.2159] }),
    group('glass', { glass: true }),
    group('tape', { color: [1, 0, 0], decal: true }),
    group('opaqueTwin', { color: [0.2159, 0.2159, 0.2159] })
  ]
}

function loadCad(path = CAD_PATH, groups = cadGroups()): FieldVisualGroup[] {
  setLoadedFieldVisual(path, {
    groups,
    meshCount: groups.length,
    triangleCount: 12 * groups.length,
    glassMeshCount: 1,
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] }
  })
  return groups
}

const withCad = (season = 'biobuzz', visual: FieldVisual = VISUAL): void => {
  useSceneStore.setState({ field: { season, visual } })
}

const cadMesh = (key: string): Mesh => named(`fieldCad.${key}`) as Mesh
const outlines = (): LineSegments[] => {
  const found: LineSegments[] = []
  scene().traverse((object) => {
    if (object instanceof LineSegments && object.name.startsWith('outline.')) found.push(object)
  })
  return found
}

describe('필드 CAD 층(B5)', () => {
  it('BIOBUZZ + CAD: CAD 그룹(yUp quaternion), 단순 형상은 태그 16·벽 라벨 4뿐', async () => {
    loadCad()
    withCad()
    await mount()
    const cad = named('fieldCad')!
    expect(cad.visible).toBe(true)
    const expected = new Quaternion().setFromRotationMatrix(alignmentRotation(VISUAL))
    expect(cad.quaternion.angleTo(expected)).toBeLessThan(1e-12)
    // CAD (1, 2, 3) → 필드 (3, 1, 2)
    const moved = new Vector3(1, 2, 3).applyQuaternion(cad.quaternion)
    expect(moved.distanceTo(new Vector3(3, 1, 2))).toBeLessThan(1e-12)
    expect(cad.position.length()).toBe(0)
    expect(named('seasonField')).toBeDefined()
    expect(meshesNamed('tag')).toHaveLength(16)
    expect(meshesNamed('wallLabel')).toHaveLength(4)
    expect(meshesNamed('structure')).toHaveLength(0)
    expect(meshesNamed('tape')).toHaveLength(0)
    expect(meshesNamed('rail')).toHaveLength(0)
    expect(meshesNamed('panel')).toHaveLength(0)
    expect(meshesNamed('seam')).toHaveLength(0)
    expect(named('floor')).toBeUndefined()
    // 그린 메시는 companion 메시 수만큼(바닥·레일 형상을 만들지 않는다)
    const geometries = new Set<unknown>()
    named('seasonField')!.traverse((object) => {
      if (object instanceof Mesh) geometries.add(object.geometry)
    })
    expect(geometries.size).toBe(20)
  })

  it('companion 태그 평면은 태그 틀 −z로 CAD_TAG_FRONT_OFFSET(1e-9)', async () => {
    loadCad()
    withCad()
    await mount()
    const spec = resolveSeason('biobuzz')
    for (const tag of spec.aprilTags.tags) {
      const mesh = named(`tag${tag.id}`)!
      const front = new Vector3(0, 0, -1).applyMatrix4(
        new Matrix4().makeRotationFromEuler(
          new Euler(tag.rotation.x, tag.rotation.y, tag.rotation.z, 'ZYX')
        )
      )
      const offset = mesh.position
        .clone()
        .sub(new Vector3(tag.position.x, tag.position.y, tag.position.z))
      expect(offset.dot(front)).toBeCloseTo(CAD_TAG_FRONT_OFFSET, 9)
      expect(
        offset
          .clone()
          .sub(front.multiplyScalar(offset.dot(front)))
          .length()
      ).toBeLessThan(1e-9)
    }
  })

  it('빨강 HIVE 넘어감이면 빨강 CELL 2가 더해지고 hiveRed 각 = π/6', async () => {
    loadCad()
    withCad()
    usePlayStore.setState({
      settings: { ...DEFAULT_PLAY_SETTINGS, hiveState: { red: 'tipped', blue: 'start' } }
    })
    await mount()
    const cells = meshesNamed('structure')
    expect(cells).toHaveLength(2)
    expect(cells.every((mesh) => mesh.parent!.name === 'hiveRed')).toBe(true)
    expect(named('hiveRed')!.rotation.y).toBeCloseTo(Math.PI / 6, 12)
  })

  it('fieldHidden·고립이면 CAD 그룹 visible false(내려가지 않음), 바닥·벽·테이프는 지금 그대로', async () => {
    loadCad()
    withCad()
    await mount()
    const cad = named('fieldCad')!
    await set(() => useSceneVisibilityStore.setState({ fieldHidden: true }))
    expect(named('fieldCad')).toBe(cad)
    expect(cad.visible).toBe(false)
    expect(named('floor')).toBeDefined()
    expect(meshesNamed('tape')).toHaveLength(14)
    expect(meshesNamed('rail')).not.toHaveLength(0)
    expect(meshesNamed('structure')).toHaveLength(0)
    await set(() => useSceneVisibilityStore.setState({ fieldHidden: false, isolated: ['bot'] }))
    expect(named('fieldCad')).toBe(cad)
    expect(cad.visible).toBe(false)
    expect(named('floor')).toBeDefined()
    await set(() => useSceneVisibilityStore.setState({ isolated: null }))
    expect(cad.visible).toBe(true)
    expect(named('floor')).toBeUndefined()
  })

  it("'none'·모르는 시즌 + CAD면 FieldFloor도 없다(CAD 메시만)", async () => {
    loadCad()
    for (const season of ['none', 'decode2027']) {
      withCad(season)
      await mount()
      const meshes: Mesh[] = []
      scene().traverse((object) => {
        // 경기 요소 층(6a ElementsView)은 늘 붙어 있고 이 시즌에는 공이 없다(인스턴스 0)
        if (object instanceof InstancedMesh && object.name.startsWith('elements.')) {
          expect(object.count).toBe(0)
          return
        }
        if (object instanceof Mesh) meshes.push(object)
      })
      expect(meshes.length).toBe(4)
      expect(meshes.every((mesh) => mesh.name.startsWith('fieldCad.'))).toBe(true)
      await act(async () => root.unmount())
    }
    // CAD가 없으면 FieldFloor(이름 없는 메시)
    useSceneStore.setState({ field: { season: 'none' } })
    await mount()
    let unnamed = 0
    scene().traverse((object) => {
      if (object instanceof Mesh && object.name === '') unnamed += 1
    })
    expect(unnamed).toBeGreaterThan(0)
  })

  it('visual 경로 ≠ 칸의 경로면 지금 그대로(CAD 없음, 구조물 17)', async () => {
    loadCad('/other.step')
    withCad()
    await mount()
    expect(named('fieldCad')).toBeUndefined()
    expect(meshesNamed('structure')).toHaveLength(17)
    expect(named('floor')).toBeDefined()
  })
})

describe('충돌체 윤곽(B6)', () => {
  it('fieldShapesShown이면 메시마다 LineSegments 둘(같은 EdgesGeometry), 56 × 2, HIVE CELL·carrier 없음', async () => {
    loadCad()
    withCad()
    useSceneVisibilityStore.setState({ fieldShapesShown: true })
    await mount()
    const spec = resolveSeason('biobuzz')
    const expected = fieldOutlineMeshes(fieldViewModel(spec, [false, false], false), spec)
    expect(expected.meshes).toHaveLength(56)
    const lines = outlines()
    expect(lines).toHaveLength(2 * 56)
    const front = lines.filter((line) => line.name.endsWith('.front'))
    const hidden = lines.filter((line) => line.name.endsWith('.hidden'))
    expect(front).toHaveLength(56)
    expect(hidden).toHaveLength(56)
    front.forEach((line, index) => {
      const pair = hidden[index]
      expect(pair.name.replace('.hidden', '')).toBe(line.name.replace('.front', ''))
      expect(pair.geometry).toBe(line.geometry)
      expect(line.renderOrder).toBe(FIELD_RENDER_ORDER.colliderOutline)
      expect(pair.renderOrder).toBe(6)
      const a = line.material as LineBasicMaterial
      const b = pair.material as LineBasicMaterial
      expect(a.depthTest).toBe(true)
      expect(a.opacity).toBe(0.9)
      expect(b.depthTest).toBe(false)
      expect(b.opacity).toBe(0.2)
      for (const material of [a, b]) {
        expect(material.color.getHexString()).toBe(new Color('#91f48b').getHexString())
        expect(material.depthWrite).toBe(false)
        expect(material.transparent).toBe(true)
      }
      const hits: THREE.Intersection[] = []
      line.raycast(new THREE.Raycaster(), hits)
      expect(hits).toEqual([])
    })
    expect(named('outline.hiveRed')).toBeUndefined()
    expect(named('outline.hiveBlue')).toBeUndefined()
    expect(lines.some((line) => line.name.startsWith('outline.seam'))).toBe(false)
    // 끄면 사라진다
    await set(() => useSceneVisibilityStore.setState({ fieldShapesShown: false }))
    expect(outlines()).toHaveLength(0)
  })

  it('CAD가 없으면 플래그가 켜져도 그리지 않는다', async () => {
    useSceneVisibilityStore.setState({ fieldShapesShown: true })
    await mount()
    expect(outlines()).toHaveLength(0)
    await act(async () => root.unmount())
    loadCad()
    withCad()
    useSceneVisibilityStore.setState({ fieldShapesShown: true, fieldHidden: true })
    await mount()
    expect(outlines()).toHaveLength(0)
  })

  it('내려가면 재질 둘과 형상을 해제한다', async () => {
    loadCad()
    withCad()
    useSceneVisibilityStore.setState({ fieldShapesShown: true })
    await mount()
    const lines = outlines()
    const front = vi.spyOn(lines[0].material as LineBasicMaterial, 'dispose')
    const hidden = vi.spyOn(lines[1].material as LineBasicMaterial, 'dispose')
    const geometry = vi.spyOn(lines[0].geometry, 'dispose')
    await set(() => useSceneVisibilityStore.setState({ fieldShapesShown: false }))
    await settle()
    expect(front).toHaveBeenCalled()
    expect(hidden).toHaveBeenCalled()
    expect(geometry).toHaveBeenCalled()
  })
})

describe('CAD 재질(B7)', () => {
  it('불투명·투명판·decal 재질, 같은 키는 같은 재질, 클릭되지 않음', async () => {
    const groups = loadCad()
    withCad()
    await mount()
    const opaque = cadMesh('opaque')
    const material = opaque.material as MeshStandardMaterial
    expect(material).toBeInstanceOf(MeshStandardMaterial)
    expect(material.color.equals(new Color().setRGB(0.2159, 0.2159, 0.2159, SRGBColorSpace))).toBe(
      true
    )
    expect(material.metalness).toBe(0.1)
    expect(material.roughness).toBe(0.7)
    expect(material.transparent).toBe(false)
    expect(opaque.renderOrder).toBe(0)
    expect(opaque.geometry).toBe(groups[0].geometry)
    expect(cadMesh('opaqueTwin').material).toBe(material)
    const glass = cadMesh('glass')
    const glassMaterial = glass.material as MeshStandardMaterial
    expect(glassMaterial.transparent).toBe(true)
    expect(glassMaterial.opacity).toBe(0.25)
    expect(glassMaterial.depthWrite).toBe(false)
    expect(glass.renderOrder).toBe(3)
    const tape = cadMesh('tape')
    const tapeMaterial = tape.material as MeshStandardMaterial
    expect(tapeMaterial.polygonOffset).toBe(true)
    expect(tapeMaterial.polygonOffsetFactor).toBe(-1)
    expect(tapeMaterial.polygonOffsetUnits).toBe(-1)
    expect(tapeMaterial.depthWrite).toBe(true)
    expect(tapeMaterial.transparent).toBe(false)
    expect(tape.renderOrder).toBe(0)
    for (const key of ['opaque', 'glass', 'tape', 'opaqueTwin']) {
      const hits: THREE.Intersection[] = []
      cadMesh(key).raycast(new THREE.Raycaster(), hits)
      expect(hits).toEqual([])
    }
  })

  it('StrictMode 정리 → 재실행·숨김 켜고 끄기에도 재질을 해제하지 않고, visual을 지우면 해제한다', async () => {
    const groups = loadCad()
    withCad()
    await mount(true)
    await settle()
    const material = cadMesh('opaque').material as MeshStandardMaterial
    const dispose = vi.spyOn(material, 'dispose')
    const geometryDispose = vi.spyOn(groups[0].geometry, 'dispose')
    await set(() => useSceneVisibilityStore.setState({ fieldHidden: true }))
    await settle()
    await set(() => useSceneVisibilityStore.setState({ fieldHidden: false }))
    await settle()
    expect(dispose).not.toHaveBeenCalled()
    expect(cadMesh('opaque').material).toBe(material)
    // 지우면(cadReady false) 내려가 재질을 해제한다. 형상은 저장소가 맡는다(지우기는 해제하지 않음)
    await set(() => useSceneStore.setState({ field: { season: 'biobuzz' } }))
    await settle()
    expect(named('fieldCad')).toBeUndefined()
    expect(dispose).toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
  })

  it('정렬을 바꾸면 그룹 quaternion만 바뀐다(같은 메시·재질)', async () => {
    loadCad()
    withCad()
    await mount()
    const mesh = cadMesh('opaque')
    const material = mesh.material
    await set(() =>
      useSceneStore.getState().setFieldVisualAlignment({ upAxis: '+Z', forwardAxis: '-Y' })
    )
    const expected = new Quaternion().setFromRotationMatrix(
      alignmentRotation({ upAxis: '+Z', forwardAxis: '-Y' })
    )
    expect(named('fieldCad')!.quaternion.angleTo(expected)).toBeLessThan(1e-12)
    expect(cadMesh('opaque')).toBe(mesh)
    expect(cadMesh('opaque').material).toBe(material)
  })

  it('다른 형상으로 바꿔 끼우면(revision) 새 묶음을 그린다', async () => {
    loadCad()
    withCad()
    await mount()
    expect(cadMesh('opaque')).toBeDefined()
    await set(() => {
      loadCad(CAD_PATH, [group('fresh')])
    })
    expect(named('fieldCad.opaque')).toBeUndefined()
    expect(cadMesh('fresh')).toBeDefined()
  })
})

describe('실행 중(B9)', () => {
  it('잠근 실행이면 companion·윤곽의 HIVE 각과 시즌은 run.field, CAD는 그대로', async () => {
    loadCad()
    withCad('none')
    useSceneVisibilityStore.setState({ fieldShapesShown: true })
    await mount()
    // 문서 'none': companion 없음, 윤곽은 공칭 벽(구조물 없음)
    expect(named('seasonField')).toBeUndefined()
    expect(outlines().some((line) => line.name.startsWith('outline.structure'))).toBe(false)
    await set(() =>
      usePlayStore.setState({
        run: run({ field: { season: 'biobuzz', hiveTipped: [true, false] } })
      })
    )
    expect(named('fieldCad')!.visible).toBe(true)
    expect(meshesNamed('tag')).toHaveLength(16)
    expect(meshesNamed('structure')).toHaveLength(2)
    expect(named('hiveRed')!.rotation.y).toBeCloseTo(Math.PI / 6, 12)
    expect(outlines()).toHaveLength(2 * 56)
    // 떼어 놓은 실행은 문서 시즌
    await set(() =>
      usePlayStore.setState({
        run: run({ detached: true, field: { season: 'biobuzz', hiveTipped: [true, false] } })
      })
    )
    expect(named('seasonField')).toBeUndefined()
    expect(named('fieldCad')!.visible).toBe(true)
  })
})
