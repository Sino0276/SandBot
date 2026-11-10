import i18n from 'i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../editor/editorStore'
import { initHistory, redo, undo, useHistoryStore } from '../editor/history'
import { useNoticeStore } from '../editor/noticeStore'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import { setUsageWorkerFactory, useUsageIndexStore, type UsageWorkerLike } from '../java/usageIndex'
import { createComponent } from '../hardware/components'
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings } from '../scene/projectSettings'
import type { SceneObject, SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { initProjectSession, openProjectAt, saveProject } from './projectActions'
import { serializeProject } from './projectFile'
import { useProjectStore } from './projectStore'

// 프로젝트 v12 프로젝트 설정(코드 단위): 진짜 projectActions·history에 메모리 디스크로 window.api를 흉내 낸다.
// 열기·저장의 settings, dirty(savedSettings), 실행 취소, 생성 코드의 단위, 사용처 기준의 단위.

let projectJson: string | null = ''

const api = {
  openProject: vi.fn(async (root: string) => ({
    root,
    name: 'p',
    hasTeamCode: true,
    content: projectJson
  })),
  saveProject: vi.fn(async (_root: string, content: string) => {
    projectJson = content
  }),
  relativePath: (_root: string, path: string) => path,
  resolvePath: (_root: string, path: string) => path,
  // CAD 원본을 찾지 못한다(cadMissing 알림)
  statStepFile: async () => null,
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
  confirmClose: () => {}
}

// 사용처 워커(이 시험은 Java 파일이 없어 쓰지 않는다)
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
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

const robotWithPinpoint = (): SceneObjects => {
  const pod = (id: string, x: number, y: number): SceneObject => ({
    id,
    name: id,
    kind: 'part',
    parentId: 'bot',
    transform: { position: [x, y, 0], rotation: [0, 0, 0] }
  })
  return {
    bot: {
      id: 'bot',
      name: 'Bot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
    },
    xPod: pod('xPod', 0, 0.1),
    yPod: pod('yPod', 0.05, 0),
    pp: {
      ...pod('pp', 0, 0),
      components: [
        {
          ...createComponent('pinpoint', [], () => 'c1'),
          name: 'pinpoint',
          port: 1,
          props: { ...createComponent('pinpoint', [], () => '').props, xPod: 'xPod', yPod: 'yPod' }
        }
      ]
    }
  }
}

async function open(
  objects: SceneObjects,
  settings?: ProjectSettings | unknown,
  version?: number
): Promise<void> {
  const data = JSON.parse(
    serializeProject(objects, { season: 'none' }, (path) => path, {
      settings: DEFAULT_PROJECT_SETTINGS
    })
  )
  if (settings !== undefined) data.settings = settings
  if (version !== undefined) {
    data.version = version
    if (version < 12) delete data.settings
  }
  projectJson = JSON.stringify(data)
  await openProjectAt('/p')
  await settle()
}

const keys = (): string[] => useNoticeStore.getState().notices.map((notice) => notice.key)
const dirty = (): boolean => useProjectStore.getState().dirty
const units = (): ProjectSettings['codeUnits'] => useSceneStore.getState().settings.codeUnits
const CM_RAD = { length: 'cm', angle: 'rad' } as const

beforeAll(async () => {
  await i18n.init({
    resources: { ko: { translation: ko }, en: { translation: en } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
  vi.stubGlobal('window', { api, addEventListener: () => {} })
  vi.stubGlobal('document', { title: '', activeElement: null })
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  })
  setUsageWorkerFactory(() => new IdleWorker())
  initHistory()
  initProjectSession()
})

beforeEach(() => {
  useNoticeStore.setState({ notices: [] })
  useEditorStore.getState().select(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('프로젝트 설정(코드 단위)의 열기·저장·dirty·실행 취소', () => {
  it('v11 파일은 기본값(sdk)으로 열고 dirty가 아니며 알리지 않는다', async () => {
    await open(robotWithPinpoint(), undefined, 11)
    expect(units()).toEqual({ length: 'sdk', angle: 'sdk' })
    expect(dirty()).toBe(false)
    expect(keys()).not.toContain('settingsDropped')
  })

  it('고르면 dirty, 실행 취소하면 돌아오고, 같은 값을 다시 고르면 dirty가 꺼진다', async () => {
    await open(robotWithPinpoint())
    const before = useHistoryStore.getState().canUndo
    useSceneStore.getState().setCodeUnits(CM_RAD)
    expect(units()).toEqual(CM_RAD)
    expect(dirty()).toBe(true)
    undo()
    expect(units()).toEqual({ length: 'sdk', angle: 'sdk' })
    expect(dirty()).toBe(false)
    redo()
    expect(units()).toEqual(CM_RAD)
    expect(dirty()).toBe(true)
    // 값으로 비교한다(새 객체여도 연 값과 같으면 변경이 없다)
    useSceneStore.getState().setCodeUnits({ length: 'sdk', angle: 'sdk' })
    expect(dirty()).toBe(false)
    expect(before).toBe(false)
  })

  it('같은 값·틀린 값은 실행 취소 단계를 만들지 않는다', async () => {
    await open(robotWithPinpoint())
    const settings = useSceneStore.getState().settings
    useSceneStore.getState().setCodeUnits({ length: 'sdk', angle: 'sdk' })
    useSceneStore.getState().setCodeUnits({ length: 'ft', angle: 'deg' } as never)
    expect(useSceneStore.getState().settings).toBe(settings)
    expect(useHistoryStore.getState().canUndo).toBe(false)
  })

  it('저장은 settings와 그 단위의 생성 코드를 쓰고, 사용처 기준에 그 단위를 둔다. 다시 열면 같다', async () => {
    await open(robotWithPinpoint())
    useSceneStore.getState().setCodeUnits(CM_RAD)
    api.syncGeneratedFiles.mockClear()
    expect(await saveProject()).toBe(true)
    await settle()
    expect(dirty()).toBe(false)
    expect(JSON.parse(projectJson!).settings).toEqual({ codeUnits: CM_RAD })
    const files = (api.syncGeneratedFiles.mock.calls[0] as unknown[])[1] as {
      path: string
      content: string
    }[]
    const java = files.find((file) => file.path.endsWith('.java'))!.content
    expect(java).toContain('public static final double PINPOINT_X_OFFSET_CM = 10.0;')
    expect(java).toContain('public static final double PINPOINT_Y_OFFSET_CM = 5.0;')
    expect(java).toContain('DistanceUnit.CM);')
    expect(useUsageIndexStore.getState().baseline?.units).toEqual(CM_RAD)
    await openProjectAt('/p')
    await settle()
    expect(units()).toEqual(CM_RAD)
    expect(dirty()).toBe(false)
    expect(useUsageIndexStore.getState().baseline?.units).toEqual(CM_RAD)
  })

  it('틀린 settings는 기본값으로 열고 settingsDropped를 알린다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await open(robotWithPinpoint(), { codeUnits: { length: 'yard', angle: 'deg' } })
    warn.mockRestore()
    expect(units()).toEqual({ length: 'sdk', angle: 'sdk' })
    expect(keys()).toContain('settingsDropped')
    expect(dirty()).toBe(false)
  })
})
