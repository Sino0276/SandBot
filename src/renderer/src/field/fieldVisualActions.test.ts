import { readFileSync } from 'fs'
import i18n from 'i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StepReadResult } from '../../../shared/ipc'
import { boundsCenter } from '../cad/alignment'
import { beginImport, endImport } from '../cad/importStore'
import { computeMeshMass } from '../cad/meshMass'
import type { ImportedMesh, ImportedModel } from '../cad/stepImport'
import { useDialogStore } from '../editor/dialogStore'
import { useEditorStore } from '../editor/editorStore'
import { initHistory, redo, undo } from '../editor/history'
import { cancelNotice, runNoticeAction, useNoticeStore } from '../editor/noticeStore'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import { setUsageWorkerFactory, type UsageWorkerLike } from '../java/usageIndex'
import { initProjectSession, openProjectAt, saveProject } from '../project/projectActions'
import { serializeProject, type StoredCadFile } from '../project/projectFile'
import { useProjectStore } from '../project/projectStore'
import { ALIGNMENT_PRESETS } from '../cad/alignment'
import type { FieldDoc, FieldVisual } from '../scene/fieldDoc'
import type { SceneObject, SceneObjects, Vec3 } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import {
  clearFieldVisual,
  importFieldVisual,
  relinkFieldVisual,
  reloadFieldVisual
} from './fieldVisualActions'
import { fieldVisualGroups, fieldVisualState, useFieldVisualStore } from './fieldVisualStore'

// spec-4e §7 A4–A9·A12–A15: 진짜 projectActions·history·fieldVisualActions·loadStepModel에 메모리 디스크로 window.api를
// 흉내 낸다. STEP 읽기(readStepCached)는 붙잡아 두었다가 차례로 끝낼 수 있다.

// 열기 실패(catch 경로)와 로봇 CAD 읽기 예외를 만들 때만 끼어든다(나머지는 진짜 함수)
const hooks = vi.hoisted(() => ({ failNotify: false, throwCadLoad: false }))
vi.mock('./fieldActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fieldActions')>()
  const notifyFieldState: typeof actual.notifyFieldState = (...args) => {
    if (hooks.failNotify) {
      hooks.failNotify = false
      throw new Error('열기 실패(시험)')
    }
    actual.notifyFieldState(...args)
  }
  return { ...actual, notifyFieldState }
})
vi.mock('../cad/importStep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cad/importStep')>()
  const loadCadWithProgress: typeof actual.loadCadWithProgress = (...args) => {
    if (hooks.throwCadLoad) {
      hooks.throwCadLoad = false
      return Promise.reject(new Error('CAD 읽기 예외(시험)'))
    }
    return actual.loadCadWithProgress(...args)
  }
  return { ...actual, loadCadWithProgress }
})

const ROOT = '/p'
const FIELD_PATH = '/p/field/field.step'
const T0 = { position: [0, 0, 0], rotation: [0, 0, 0] } as SceneObject['transform']

// ---- 메모리 디스크 ----

let projectJson: string | null = ''
// statStepFile이 찾는 파일
const existing = new Set<string>()
// readStepCached의 결과: 모델(캐시), 'native'(캐시 없음 → 네이티브 변환), 'big'(캐시 없는 200 MB), 'fail'(예외), 없으면 null
const disk = new Map<string, ImportedModel | 'native' | 'big' | 'fail'>()
// 붙잡아 둘 경로(끝내기 전까지 읽기가 기다린다)
const holdPaths = new Set<string>()
type PendingRead = { path: string; finish: () => void }
const pendingReads: PendingRead[] = []
const readPaths: string[] = []
// 네이티브 변환 결과(untranslated)와 워커가 돌려줄 모델
let nativeUntranslated = 0
let nativeFails = false
// 네이티브 변환을 붙잡아 둘지와 끝내는 함수
let holdConvert = false
let releaseConvert: (() => void) | null = null
let workerModel: ImportedModel | null = null
const chosen: (string | null)[] = []
const chooseCalls: unknown[][] = []
const storageCalls: string[] = []

function readResult(path: string): StepReadResult | null {
  const entry = disk.get(path)
  if (entry === undefined) return null
  if (entry === 'fail') throw new Error('EBUSY')
  if (entry === 'native') return { key: `k:${path}`, model: null, bytes: null, size: 1 }
  if (entry === 'big') return { key: `k:${path}`, model: null, bytes: null, size: 200e6 }
  return { key: `k:${path}`, model: entry, bytes: null, size: 1 }
}

const api = {
  openProject: vi.fn(async (root: string) => ({
    root,
    name: root,
    hasTeamCode: true,
    content: projectJson
  })),
  saveProject: vi.fn(async (_root: string, content: string) => {
    projectJson = content
  }),
  relativePath: (_root: string, path: string) =>
    path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path,
  resolvePath: (root: string, relative: string) =>
    relative.startsWith('/') ? relative : `${root}/${relative}`,
  statStepFile: async (path: string) => (existing.has(path) ? { size: 1 } : null),
  syncGeneratedFiles: vi.fn(async () => ({
    status: 'synced' as const,
    written: [],
    unchanged: [],
    deleted: [],
    skipped: [],
    modified: [],
    caseRenamed: []
  })),
  listJavaFiles: vi.fn(async () => ({ hasTeamCode: true, truncated: false, files: [] })),
  readJavaSources: vi.fn(async () => ({ ok: true, files: [] })),
  setDirty: () => {},
  onCloseRequested: () => {},
  confirmClose: () => {},
  // 네이티브 변환기가 있다(캐시에 있으면 캐시, 없으면 convertStep)
  hasStepConverter: async () => true,
  readStepCached: vi.fn((path: string) => {
    readPaths.push(path)
    if (!holdPaths.has(path)) return Promise.resolve().then(() => readResult(path))
    return new Promise<StepReadResult | null>((resolve, reject) =>
      pendingReads.push({
        path,
        finish: () => {
          try {
            resolve(readResult(path))
          } catch (error) {
            reject(error)
          }
        }
      })
    )
  }),
  convertStep: vi.fn(() => {
    const result = nativeFails
      ? { ok: false as const, code: 'failed' as const, detail: 'boom' }
      : {
          ok: true as const,
          key: 'native',
          bytes: new Uint8Array(4),
          untranslated: nativeUntranslated
        }
    if (!holdConvert) return Promise.resolve(result)
    return new Promise<typeof result>((resolve) => (releaseConvert = () => resolve(result)))
  }),
  cancelStepConversion: () => {},
  onStepConvertProgress: () => () => {},
  storeMeshCache: vi.fn(async () => {}),
  chooseStepFile: vi.fn(async (...args: unknown[]) => {
    chooseCalls.push(args)
    return chosen.shift() ?? null
  })
}

// 네이티브 결과를 워커가 모델로 바꾸는 것을 흉내 낸다
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: unknown = null
  postMessage(): void {
    queueMicrotask(() => this.onmessage?.({ data: { ok: true, model: workerModel } }))
  }
  terminate(): void {
    // 끝낼 것이 없다
  }
}

class IdleWorker implements UsageWorkerLike {
  onmessage: UsageWorkerLike['onmessage'] = null
  onerror: UsageWorkerLike['onerror'] = null
  postMessage(): void {
    // 받은 메시지는 버린다
  }
  terminate(): void {
    // 끝낼 것이 없다
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 300; i++) await Promise.resolve()
}

// 붙잡아 둔 읽기 중 그 경로의 첫 것을 끝낸다
async function finishRead(path: string): Promise<void> {
  const index = pendingReads.findIndex((read) => read.path === path)
  if (index < 0) throw new Error(`붙잡은 읽기 없음: ${path}`)
  const [read] = pendingReads.splice(index, 1)
  read.finish()
  await settle()
}

// ---- 모델·씬 ----

function boxMesh(index: number, min: Vec3, max: Vec3): ImportedMesh {
  const bounds = { min, max }
  const c = boundsCenter(bounds)
  const corners: number[] = []
  for (let i = 0; i < 8; i++)
    corners.push(
      (i & 1 ? max[0] : min[0]) - c[0],
      (i & 2 ? max[1] : min[1]) - c[1],
      (i & 4 ? max[2] : min[2]) - c[2]
    )
  // prettier-ignore
  const indices = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]
  const positions = new Float32Array(corners)
  return {
    sourceIndex: index,
    name: `Mesh ${index}`,
    positions,
    normals: null,
    indices: new Uint32Array(indices),
    colors: null,
    color: [0.5, 0.5, 0.5],
    bounds,
    mass: computeMeshMass(positions, indices, bounds)
  }
}

// 상자 메시 count개의 필드 모델. extraSource는 삼각형을 만들지 못해 빠진 메시 수.
function fieldModel(count = 2, extraSource = 0): ImportedModel {
  const meshes = Array.from({ length: count }, (_, i) => boxMesh(i, [i, 0, 0], [i + 0.5, 0.1, 1]))
  return {
    root: { name: 'Field', kind: 'assembly', bounds: meshes[0].bounds, children: [] },
    meshes,
    sourceMeshCount: count + extraSource
  }
}

const robot: SceneObject = { id: 'bot', name: 'Bot', kind: 'robot', parentId: null, transform: T0 }

function cadRoot(id: string): SceneObject {
  return {
    id,
    name: id,
    kind: 'assembly',
    parentId: 'bot',
    transform: T0,
    cad: {
      fileName: `${id}.step`,
      absolutePath: `/cad/${id}.step`,
      upAxis: '+Z',
      forwardAxis: '+X',
      bounds: { min: [0, 0, 0], max: [0.1, 0.1, 0.1] },
      meshCount: 0,
      meshIndexing: 'source'
    }
  }
}

const visualAt = (absolutePath: string, fileName = 'field.step'): FieldVisual => ({
  fileName,
  absolutePath,
  upAxis: '+Y',
  forwardAxis: '+Z'
})

// 프로젝트 파일을 쓴다. file을 주면 field.visual.file을 그 값으로 바꾼다(다른 PC에서 저장한 파일).
function writeProject(objects: SceneObjects, field: FieldDoc, file?: StoredCadFile): void {
  const data = JSON.parse(serializeProject(objects, field, (path) => api.relativePath(ROOT, path)))
  if (file) data.field.visual.file = file
  projectJson = JSON.stringify(data, null, 2) + '\n'
}

async function open(root = ROOT): Promise<void> {
  await openProjectAt(root)
  await settle()
}

const doc = (): FieldDoc => useSceneStore.getState().field
const status = (): ReturnType<typeof useProjectStore.getState>['fieldVisualStatus'] =>
  useProjectStore.getState().fieldVisualStatus
const loaded = (): ReturnType<typeof useFieldVisualStore.getState>['loaded'] =>
  useFieldVisualStore.getState().loaded
const state = (): string => fieldVisualState(doc().visual, status(), loaded())
const dirty = (): boolean => useProjectStore.getState().dirty
const keys = (): string[] => useNoticeStore.getState().notices.map((notice) => notice.key)
const noticesOf = (key: string): ReturnType<typeof useNoticeStore.getState>['notices'] =>
  useNoticeStore.getState().notices.filter((notice) => notice.key === key)

beforeAll(async () => {
  await i18n.init({
    resources: { ko: { translation: ko }, en: { translation: en } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
  vi.stubGlobal('window', { api, addEventListener: () => {} })
  vi.stubGlobal('document', { title: '', activeElement: null })
  vi.stubGlobal('Worker', FakeWorker)
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => {
      storageCalls.push(`get:${key}`)
      return storage.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      storageCalls.push(`set:${key}`)
      storage.set(key, value)
    },
    removeItem: (key: string) => storage.delete(key)
  })
  setUsageWorkerFactory(() => new IdleWorker())
  initHistory()
  initProjectSession()
})

beforeEach(() => {
  useNoticeStore.setState({ notices: [] })
  useEditorStore.getState().select(null)
  existing.clear()
  disk.clear()
  holdPaths.clear()
  pendingReads.length = 0
  readPaths.length = 0
  chosen.length = 0
  chooseCalls.length = 0
  storageCalls.length = 0
  nativeUntranslated = 0
  nativeFails = false
  holdConvert = false
  releaseConvert = null
  workerModel = null
  hooks.failNotify = false
  hooks.throwCadLoad = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

// 찾을 수 있는 필드 CAD가 있는 프로젝트를 열고 형상까지 읽는다
async function openWithField(objects: SceneObjects = { bot: robot }): Promise<void> {
  existing.add(FIELD_PATH)
  disk.set(FIELD_PATH, fieldModel())
  writeProject(objects, { season: 'biobuzz', visual: visualAt(FIELD_PATH) })
  await open()
  expect(state()).toBe('shown')
}

describe('A5 임시 씬(프로젝트 없음)', () => {
  // 이 describe는 다른 시험이 프로젝트를 열기 전에 돈다(파일 안 순서)
  it('프로젝트 없이 불러오면 dirty가 아니다', async () => {
    expect(useProjectStore.getState().root).toBeNull()
    chosen.push('/f/field.step')
    disk.set('/f/field.step', fieldModel())
    await importFieldVisual()
    await settle()
    expect(doc().visual).toEqual(visualAt('/f/field.step'))
    expect(state()).toBe('shown')
    expect(dirty()).toBe(false)
  })
})

describe('A12 불러오기 흐름', () => {
  beforeEach(async () => {
    writeProject({ bot: robot }, { season: 'biobuzz' })
    await open()
  })

  it('고르기를 취소하면 아무 일도 없다', async () => {
    await importFieldVisual()
    await settle()
    expect(chooseCalls).toHaveLength(1)
    expect(chooseCalls[0][0]).toBe(ko.field.inspector.cad.chooseTitle)
    expect(readPaths).toEqual([])
    expect('visual' in doc()).toBe(false)
  })

  it('불러오는 중·busy면 시작하지 않는다', async () => {
    chosen.push(FIELD_PATH)
    const controller = beginImport()
    await importFieldVisual()
    endImport(controller)
    useProjectStore.setState({ busy: true })
    await importFieldVisual()
    useProjectStore.setState({ busy: false })
    expect(chooseCalls).toEqual([])
    expect('visual' in doc()).toBe(false)
  })

  it('캐시에 없는 100 MB 넘는 파일은 묻고, 취소하면 없다', async () => {
    chosen.push(FIELD_PATH)
    disk.set(FIELD_PATH, 'big')
    const done = importFieldVisual()
    await settle()
    expect(useDialogStore.getState().request).not.toBeNull()
    useDialogStore.getState().answer('cancel')
    await done
    await settle()
    expect(api.convertStep).not.toHaveBeenCalled()
    expect('visual' in doc()).toBe(false)
  })

  it('큰 파일을 불러오겠다고 하면 읽는다', async () => {
    chosen.push(FIELD_PATH)
    disk.set(FIELD_PATH, 'big')
    workerModel = fieldModel()
    const done = importFieldVisual()
    await settle()
    useDialogStore.getState().answer('import')
    await done
    await settle()
    expect(doc().visual).toEqual(visualAt(FIELD_PATH))
  })

  it('실패면 오류 알림(행동 showField)이고 visual 없음', async () => {
    chosen.push(FIELD_PATH)
    disk.set(FIELD_PATH, 'native')
    nativeFails = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await importFieldVisual()
    await settle()
    expect('visual' in doc()).toBe(false)
    const [notice] = noticesOf('importFailed')
    expect(notice.level).toBe('error')
    expect(notice.action).toBe('showField')
    runNoticeAction(notice.id)
    expect(useEditorStore.getState().fieldSelected).toBe(true)
  })

  it('파일 확인이 실패하거나 없으면 알린다', async () => {
    chosen.push(FIELD_PATH, '/p/none.step')
    disk.set(FIELD_PATH, 'fail')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await importFieldVisual()
    await importFieldVisual()
    await settle()
    expect(keys()).toEqual(['importFailed', 'importReadFailed'])
    expect('visual' in doc()).toBe(false)
  })

  it('성공이면 visual = 고른 파일 + Y-up, sandbot:cadAlignment를 읽거나 쓰지 않는다', async () => {
    chosen.push(FIELD_PATH)
    disk.set(FIELD_PATH, fieldModel(3))
    storageCalls.length = 0
    await importFieldVisual()
    await settle()
    expect(doc().visual).toEqual({
      fileName: 'field.step',
      absolutePath: FIELD_PATH,
      ...ALIGNMENT_PRESETS.yUp
    })
    expect(loaded()).toMatchObject({ path: FIELD_PATH, meshCount: 3, triangleCount: 36 })
    expect(status()).toBeNull()
    expect(storageCalls.filter((call) => call.includes('cadAlignment'))).toEqual([])
    // 진행 알림은 닫혔다
    expect(useNoticeStore.getState().notices.filter((n) => n.level === 'progress')).toEqual([])
  })
})

describe('A4 실행 취소', () => {
  it('정하기·지우기·정렬 바꾸기가 각각 한 단계이고 undo·redo로 돌아온다', async () => {
    writeProject({ bot: robot }, { season: 'biobuzz' })
    await open()
    chosen.push(FIELD_PATH)
    disk.set(FIELD_PATH, fieldModel())
    await importFieldVisual()
    await settle()
    const set = doc()
    useSceneStore.getState().setFieldVisualAlignment(ALIGNMENT_PRESETS.zUp)
    const aligned = doc()
    expect(aligned.visual).toMatchObject({ upAxis: '+Z', forwardAxis: '-Y' })
    clearFieldVisual()
    expect('visual' in doc()).toBe(false)
    // 지운 뒤 되살리면 형상이 해제되지 않아 바로 보인다
    expect(undo()).toBe(true)
    expect(doc()).toBe(aligned)
    expect(state()).toBe('shown')
    expect(fieldVisualGroups()).toHaveLength(1)
    expect(undo()).toBe(true)
    expect(doc()).toBe(set)
    expect(undo()).toBe(true)
    expect('visual' in doc()).toBe(false)
    expect(redo()).toBe(true)
    expect(doc()).toBe(set)
    expect(redo()).toBe(true)
    expect(redo()).toBe(true)
    expect('visual' in doc()).toBe(false)
  })

  it('시즌을 바꿨다 되돌려도 visual이 남는다', async () => {
    await openWithField()
    const before = doc().visual
    useSceneStore.getState().setFieldSeason('none')
    expect(doc().visual).toBe(before)
    undo()
    expect(doc()).toMatchObject({ season: 'biobuzz', visual: before })
  })

  it('못 찾은 상태에서 지우기 → undo면 missing 그대로', async () => {
    writeProject({ bot: robot }, { season: 'biobuzz', visual: visualAt('/gone/field.step') })
    await open()
    expect(state()).toBe('missing')
    clearFieldVisual()
    expect(state()).toBe('none')
    undo()
    expect(state()).toBe('missing')
  })
})

describe('A5 dirty', () => {
  it('프로젝트에서 불러오면 dirty, undo하면 아니다. 정렬을 원래 프리셋으로 다시 고르면 아니다', async () => {
    writeProject({ bot: robot }, { season: 'biobuzz' })
    await open()
    chosen.push(FIELD_PATH)
    disk.set(FIELD_PATH, fieldModel())
    await importFieldVisual()
    await settle()
    expect(dirty()).toBe(true)
    undo()
    expect(dirty()).toBe(false)
    redo()
    expect(await saveProject()).toBe(true)
    await settle()
    expect(dirty()).toBe(false)
    useSceneStore.getState().setFieldVisualAlignment(ALIGNMENT_PRESETS.zUp)
    expect(dirty()).toBe(true)
    useSceneStore.getState().setFieldVisualAlignment(ALIGNMENT_PRESETS.yUp)
    expect(dirty()).toBe(false)
  })
})

describe('A7 열기', () => {
  const objects = { bot: robot }

  it('상대 경로 → 절대 경로 순으로 찾고, 찾은 경로는 변경이 아니다', async () => {
    existing.add(FIELD_PATH).add('/elsewhere/field.step')
    disk.set(FIELD_PATH, fieldModel())
    holdPaths.add(FIELD_PATH)
    writeProject(
      objects,
      { season: 'biobuzz', visual: visualAt('/elsewhere/field.step') },
      { relativePath: 'field/field.step', absolutePath: '/elsewhere/field.step' }
    )
    await open()
    expect(doc().visual?.absolutePath).toBe(FIELD_PATH)
    expect(status()).toEqual({ path: FIELD_PATH, status: 'loading' })
    expect(state()).toBe('loading')
    expect(dirty()).toBe(false)
    await finishRead(FIELD_PATH)
    expect(status()).toBeNull()
    expect(state()).toBe('shown')
    expect(dirty()).toBe(false)

    // 상대 경로에 없으면 절대 경로
    existing.delete(FIELD_PATH)
    disk.set('/elsewhere/field.step', fieldModel())
    await open()
    expect(doc().visual?.absolutePath).toBe('/elsewhere/field.step')
    expect(state()).toBe('shown')
    expect(dirty()).toBe(false)
  })

  it('못 찾으면 missing과 알림 하나(행동이 Field 줄을 고름), 경로는 파일 값', async () => {
    const file = { relativePath: 'field/gone.step', absolutePath: 'C:\\Users\\alice\\gone.step' }
    writeProject(
      objects,
      { season: 'biobuzz', visual: visualAt(file.absolutePath, 'gone.step') },
      file
    )
    await open()
    expect(doc().visual?.absolutePath).toBe(file.absolutePath)
    expect(status()).toEqual({ path: file.absolutePath, status: 'missing' })
    expect(state()).toBe('missing')
    expect(dirty()).toBe(false)
    const missing = noticesOf('fieldCadMissing')
    expect(missing).toHaveLength(1)
    expect(missing[0].params).toEqual({ fileName: 'gone.step' })
    expect(missing[0].action).toBe('showField')
    // 필드 CAD 파일은 읽지 않는다
    expect(readPaths).toEqual([])
    runNoticeAction(missing[0].id)
    expect(useEditorStore.getState().fieldSelected).toBe(true)
  })

  it('못 찾은 채 저장하면 file이 열 때 읽은 것과 바이트 같고, 다시 찾은 뒤 저장하면 새 경로다', async () => {
    const file = {
      relativePath: '../shared/field.step',
      absolutePath: 'C:\\Users\\alice\\field.step'
    }
    writeProject(objects, { season: 'biobuzz', visual: visualAt(file.absolutePath) }, file)
    const before = JSON.stringify(JSON.parse(projectJson!).field.visual.file)
    await open()
    // 다른 일로 저장(시즌 바꾸기)
    useSceneStore.getState().setFieldSeason('none')
    expect(await saveProject()).toBe(true)
    await settle()
    expect(JSON.stringify(JSON.parse(projectJson!).field.visual.file)).toBe(before)

    existing.add('/p/new/field.step')
    disk.set('/p/new/field.step', fieldModel())
    chosen.push('/p/new/field.step')
    await relinkFieldVisual()
    await settle()
    // 다시 찾기의 기본 위치는 지금 경로(파일 값)
    expect(chooseCalls[0]).toEqual([ko.field.inspector.cad.chooseTitle, file.absolutePath])
    expect(state()).toBe('shown')
    expect(noticesOf('fieldCadMissing')).toEqual([])
    expect(await saveProject()).toBe(true)
    await settle()
    expect(JSON.parse(projectJson!).field.visual.file).toEqual({
      relativePath: 'new/field.step',
      absolutePath: '/p/new/field.step'
    })
  })

  it('새 프로젝트(내용 없음)는 visual 없음, 다른 프로젝트를 열면 형상·상태·알림을 지운다', async () => {
    writeProject(objects, { season: 'biobuzz', visual: visualAt('/gone.step') })
    await open()
    expect(noticesOf('fieldCadMissing')).toHaveLength(1)
    await openWithField()
    expect(noticesOf('fieldCadMissing')).toEqual([])
    expect(loaded()?.path).toBe(FIELD_PATH)
    projectJson = null
    await open('/new')
    expect('visual' in doc()).toBe(false)
    expect(loaded()).toBeNull()
    expect(fieldVisualGroups()).toEqual([])
    expect(status()).toBeNull()
    expect(dirty()).toBe(false)
  })

  it('필드 CAD 위치를 찾은 뒤 열기가 실패하면 loading이 남지 않고 읽지 않는다', async () => {
    existing.add(FIELD_PATH)
    disk.set(FIELD_PATH, fieldModel())
    writeProject(objects, { season: 'biobuzz', visual: visualAt(FIELD_PATH) })
    hooks.failNotify = true
    await open()
    expect(keys()).toContain('openFailed')
    expect(status()).toBeNull()
    expect(readPaths).toEqual([])
    expect(loaded()).toBeNull()
  })

  it('틀린 visual은 버리고 열고 fieldCadDropped를 띄운다', async () => {
    writeProject(objects, { season: 'biobuzz', visual: visualAt(FIELD_PATH) })
    const data = JSON.parse(projectJson!)
    data.field.visual.upAxis = 'Y'
    projectJson = JSON.stringify(data)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await open()
    expect('visual' in doc()).toBe(false)
    expect(useSceneStore.getState().objects.bot).toBeDefined()
    expect(noticesOf('fieldCadDropped')).toHaveLength(1)
    expect(noticesOf('fieldCadDropped')[0].action).toBeUndefined()
    expect(dirty()).toBe(false)
  })
})

describe('A8 읽기 순서·세션', () => {
  const objects = (): SceneObjects => ({ bot: robot, A: cadRoot('A'), B: cadRoot('B') })

  function prepare(): void {
    existing.add('/cad/A.step').add('/cad/B.step').add(FIELD_PATH)
    disk.set(FIELD_PATH, fieldModel())
    for (const path of ['/cad/A.step', '/cad/B.step', FIELD_PATH]) holdPaths.add(path)
    writeProject(objects(), { season: 'biobuzz', visual: visualAt(FIELD_PATH) })
  }

  it('로봇 CAD 둘 다음에 필드 CAD를 읽는다', async () => {
    prepare()
    await open()
    expect(readPaths).toEqual(['/cad/A.step'])
    await finishRead('/cad/A.step')
    expect(readPaths).toEqual(['/cad/A.step', '/cad/B.step'])
    await finishRead('/cad/B.step')
    expect(readPaths).toEqual(['/cad/A.step', '/cad/B.step', FIELD_PATH])
    expect(state()).toBe('loading')
    await finishRead(FIELD_PATH)
    expect(state()).toBe('shown')
  })

  it('로봇 CAD 읽기가 던져도 필드를 읽는다', async () => {
    prepare()
    holdPaths.delete(FIELD_PATH)
    hooks.throwCadLoad = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await open()
    expect(error).toHaveBeenCalled()
    expect(readPaths).toEqual([FIELD_PATH])
    expect(state()).toBe('shown')
  })

  it('읽는 중 다른 프로젝트를 열면 결과를 버린다', async () => {
    prepare()
    holdPaths.delete('/cad/A.step')
    holdPaths.delete('/cad/B.step')
    await open()
    expect(readPaths).toEqual(['/cad/A.step', '/cad/B.step', FIELD_PATH])
    projectJson = null
    await open('/other')
    await finishRead(FIELD_PATH)
    expect(loaded()).toBeNull()
    expect(status()).toBeNull()
    expect(keys()).not.toContain('cadLoadCancelled')
  })

  it('[다시 불러오기] 도중 같은 프로젝트를 다시 열면 옛 결과가 새 상태를 덮지 않는다(비평 H3)', async () => {
    await openWithField()
    holdPaths.add(FIELD_PATH)
    void reloadFieldVisual()
    await settle()
    expect(status()).toEqual({ path: FIELD_PATH, status: 'loading' })
    // 같은 프로젝트를 다시 연다: 이전 읽기는 취소되고 새 열기가 같은 경로를 읽는다
    await open()
    expect(status()).toEqual({ path: FIELD_PATH, status: 'loading' })
    expect(pendingReads.map((read) => read.path)).toEqual([FIELD_PATH, FIELD_PATH])
    await finishRead(FIELD_PATH)
    expect(status()).toEqual({ path: FIELD_PATH, status: 'loading' })
    expect(keys()).not.toContain('cadLoadCancelled')
    await finishRead(FIELD_PATH)
    expect(status()).toBeNull()
    expect(state()).toBe('shown')
  })

  it('취소하면 cancelled와 cadLoadCancelled(행동 showField)', async () => {
    existing.add(FIELD_PATH)
    disk.set(FIELD_PATH, fieldModel())
    holdPaths.add(FIELD_PATH)
    writeProject({ bot: robot }, { season: 'biobuzz', visual: visualAt(FIELD_PATH) })
    await open()
    const progress = useNoticeStore.getState().notices.find((n) => n.key === 'importing')!
    expect(progress.cancellable).toBe(true)
    cancelNotice(progress.id)
    await finishRead(FIELD_PATH)
    expect(status()).toEqual({ path: FIELD_PATH, status: 'cancelled' })
    expect(state()).toBe('cancelled')
    expect(loaded()).toBeNull()
    const [notice] = noticesOf('cadLoadCancelled')
    expect(notice.params).toEqual({ fileName: 'field.step' })
    expect(notice.action).toBe('showField')
  })
})

describe('A9 일부 빠진 결과', () => {
  it('엔티티를 건너뛴 결과도 받아 그리고 importIncomplete, 빈 메시가 있으면 importPartial', async () => {
    writeProject({ bot: robot }, { season: 'biobuzz' })
    await open()
    disk.set(FIELD_PATH, 'native')
    nativeUntranslated = 3
    workerModel = fieldModel(2, 4)
    chosen.push(FIELD_PATH)
    await importFieldVisual()
    await settle()
    expect(state()).toBe('shown')
    expect(loaded()?.meshCount).toBe(2)
    expect(keys()).toEqual(expect.arrayContaining(['importPartial', 'importIncomplete']))
    expect(noticesOf('importPartial')[0].params).toEqual({ fileName: 'field.step', count: 4 })
    // 이런 결과는 메시 캐시에 넣지 않는다
    expect(api.storeMeshCache).not.toHaveBeenCalled()
  })

  it('로봇 CAD는 지금처럼 거부한다', async () => {
    existing.add('/cad/A.step')
    disk.set('/cad/A.step', 'native')
    nativeUntranslated = 3
    workerModel = fieldModel(1)
    writeProject({ bot: robot, A: cadRoot('A') }, { season: 'biobuzz' })
    await open()
    expect(useProjectStore.getState().cadStatus).toEqual({ A: 'failed' })
    expect(keys()).toContain('cadLoadIncomplete')
  })
})

describe('A6 다시 찾기', () => {
  it('기록 전체에서 이전 경로인 visual만 새 경로로 바뀌고 undo로 경로가 돌아가지 않는다', async () => {
    await openWithField()
    // 기록: [A yUp] → 지우기 → [없음] → 다른 파일 B → [B] 정렬 바꾸기 → 지금 B zUp
    const fileA = doc().visual!
    clearFieldVisual()
    disk.set('/p/b.step', fieldModel())
    chosen.push('/p/b.step')
    await importFieldVisual()
    await settle()
    useSceneStore.getState().setFieldVisualAlignment(ALIGNMENT_PRESETS.zUp)
    expect(await saveProject()).toBe(true)
    await settle()
    expect(dirty()).toBe(false)

    disk.set('/p/c.step', fieldModel(3))
    chosen.push('/p/c.step')
    await relinkFieldVisual()
    await settle()
    expect(doc().visual).toEqual({ ...visualAt('/p/c.step', 'c.step'), ...ALIGNMENT_PRESETS.zUp })
    expect(dirty()).toBe(true)
    expect(status()).toBeNull()
    expect(loaded()).toMatchObject({ path: '/p/c.step', meshCount: 3 })
    // 실행 취소: 정렬만 돌아가고 경로는 C 그대로
    undo()
    expect(doc().visual).toEqual(visualAt('/p/c.step', 'c.step'))
    undo()
    expect('visual' in doc()).toBe(false)
    // 다른 경로(A)를 가리킨 옛 스냅샷은 그대로
    undo()
    expect(doc().visual).toEqual(fileA)
  })

  it('실패·취소·없음이면 경로·형상·상태가 그대로이고 알림만', async () => {
    await openWithField()
    const before = { visual: doc().visual, loaded: loaded(), status: status() }
    const unchanged = (): void => {
      expect(doc().visual).toEqual(before.visual)
      expect(loaded()).toBe(before.loaded)
      expect(status()).toEqual(before.status)
    }
    // 없음
    chosen.push('/p/none.step')
    await relinkFieldVisual()
    await settle()
    unchanged()
    expect(keys()).toEqual(['importReadFailed'])
    // 실패
    vi.spyOn(console, 'error').mockImplementation(() => {})
    disk.set('/p/bad.step', 'native')
    nativeFails = true
    chosen.push('/p/bad.step')
    await relinkFieldVisual()
    await settle()
    unchanged()
    expect(keys()).toEqual(['importReadFailed', 'importFailed'])
    // 취소(네이티브 변환 중)
    nativeFails = false
    workerModel = fieldModel()
    disk.set('/p/held.step', 'native')
    holdConvert = true
    chosen.push('/p/held.step')
    const done = relinkFieldVisual()
    await settle()
    cancelNotice(useNoticeStore.getState().notices.find((n) => n.key === 'importing')!.id)
    releaseConvert!()
    await done
    await settle()
    unchanged()
    expect(keys()).toEqual(['importReadFailed', 'importFailed'])
  })
})

describe('A13 다시 불러오기', () => {
  it('loading → 성공 null, 없음 missing + 알림 하나, 실패 failed', async () => {
    writeProject({ bot: robot }, { season: 'biobuzz', visual: visualAt('/gone/field.step') })
    await open()
    expect(noticesOf('fieldCadMissing')).toHaveLength(1)
    // 여전히 없음: 알림이 겹치지 않는다
    await reloadFieldVisual()
    await settle()
    expect(status()).toEqual({ path: '/gone/field.step', status: 'missing' })
    expect(noticesOf('fieldCadMissing')).toHaveLength(1)
    // 생김: 붙잡아 loading을 본 뒤 성공
    disk.set('/gone/field.step', fieldModel())
    holdPaths.add('/gone/field.step')
    const done = reloadFieldVisual()
    await settle()
    expect(status()).toEqual({ path: '/gone/field.step', status: 'loading' })
    await finishRead('/gone/field.step')
    await done
    expect(status()).toBeNull()
    expect(noticesOf('fieldCadMissing')).toEqual([])
    expect(state()).toBe('shown')
  })

  it('그려져 있던 파일을 다시 읽어 성공하면 revision이 오르고, 실패·취소면 그대로', async () => {
    await openWithField()
    const first = loaded()!
    const groups = fieldVisualGroups()
    disk.set(FIELD_PATH, fieldModel(4))
    await reloadFieldVisual()
    await settle()
    expect(loaded()!.revision).toBe(first.revision + 1)
    expect(loaded()!.meshCount).toBe(4)
    expect(fieldVisualGroups()).not.toBe(groups)

    const second = loaded()
    const secondGroups = fieldVisualGroups()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    disk.set(FIELD_PATH, 'native')
    nativeFails = true
    await reloadFieldVisual()
    await settle()
    expect(status()).toEqual({ path: FIELD_PATH, status: 'failed' })
    expect(state()).toBe('shown')
    expect(loaded()).toBe(second)
    expect(fieldVisualGroups()).toBe(secondGroups)
    expect(noticesOf('importFailed')[0].action).toBe('showField')

    disk.set(FIELD_PATH, fieldModel())
    holdPaths.add(FIELD_PATH)
    void reloadFieldVisual()
    await settle()
    cancelNotice(useNoticeStore.getState().notices.find((n) => n.key === 'importing')!.id)
    await finishRead(FIELD_PATH)
    expect(status()).toEqual({ path: FIELD_PATH, status: 'cancelled' })
    expect(loaded()).toBe(second)
    expect(noticesOf('cadLoadCancelled')).toHaveLength(1)
  })
})

describe('A14 읽는 중 지우기', () => {
  it('열기에서 로봇 CAD를 읽는 동안 지우면 필드 CAD를 읽지 않는다', async () => {
    existing.add('/cad/A.step').add(FIELD_PATH)
    disk.set(FIELD_PATH, fieldModel())
    holdPaths.add('/cad/A.step')
    writeProject(
      { bot: robot, A: cadRoot('A') },
      { season: 'biobuzz', visual: visualAt(FIELD_PATH) }
    )
    await open()
    expect(status()).toEqual({ path: FIELD_PATH, status: 'loading' })
    clearFieldVisual()
    await finishRead('/cad/A.step')
    expect(readPaths).toEqual(['/cad/A.step'])
    expect(status()).toBeNull()
    // 실행 취소로 되살리면 읽지 않은 것이다([다시 불러오기])
    undo()
    expect(state()).toBe('unloaded')
  })

  it('필드 CAD를 읽는 도중 지우면 결과는 칸에 들어가고 알림은 없다(되살리면 바로 보인다)', async () => {
    existing.add(FIELD_PATH)
    disk.set(FIELD_PATH, fieldModel())
    holdPaths.add(FIELD_PATH)
    writeProject({ bot: robot }, { season: 'biobuzz', visual: visualAt(FIELD_PATH) })
    await open()
    clearFieldVisual()
    await finishRead(FIELD_PATH)
    expect(loaded()?.path).toBe(FIELD_PATH)
    // 상태 칸은 그 경로의 것이라 결과로 고친다(읽는 중이 남지 않게, 명세와 다른 점: 보고 참고)
    expect(status()).toBeNull()
    expect(noticesOf('fieldCadMissing')).toEqual([])
    undo()
    expect(state()).toBe('shown')
  })
})

describe('A15 알림·모듈', () => {
  it('fieldCadMissing은 하나만 뜨고 지우기·불러오기 성공에서 지워진다', async () => {
    writeProject({ bot: robot }, { season: 'biobuzz', visual: visualAt('/gone.step') })
    await open()
    expect(noticesOf('fieldCadMissing')).toHaveLength(1)
    clearFieldVisual()
    expect(noticesOf('fieldCadMissing')).toEqual([])

    await open()
    expect(noticesOf('fieldCadMissing')).toHaveLength(1)
    disk.set(FIELD_PATH, fieldModel())
    chosen.push(FIELD_PATH)
    await importFieldVisual()
    await settle()
    expect(noticesOf('fieldCadMissing')).toEqual([])
  })

  it('fieldVisualLoad·fieldVisualActions는 projectActions를 import하지 않는다', () => {
    for (const name of ['fieldVisualLoad.ts', 'fieldVisualActions.ts']) {
      const text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
      expect(text, name).not.toMatch(/from '[^']*project\/projectActions'/)
    }
  })
})
