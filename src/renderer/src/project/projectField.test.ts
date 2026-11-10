import i18n from 'i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { WALL_INNER_HALF } from '../../../shared/sim/field'
import { resolveSeason } from '../../../shared/sim/seasons/seasons'
import { snapRobotToStart } from '../../../shared/sim/seasons/startPose'
import { useEditorStore } from '../editor/editorStore'
import { beginChange, endChange, initHistory, redo, undo } from '../editor/history'
import { runNoticeAction, useNoticeStore } from '../editor/noticeStore'
import { chooseFieldSeason } from '../field/fieldActions'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import { setUsageWorkerFactory, type UsageWorkerLike } from '../java/usageIndex'
import { robotOutline } from '../play/worldSpec'
import { DEFAULT_FIELD_DOC, type FieldDoc } from '../scene/fieldDoc'
import type { SceneObject, SceneObjects } from '../scene/model'
import { isPlaceholderScene, useSceneStore } from '../scene/sceneStore'
import { initProjectSession, openProjectAt, saveProject } from './projectActions'
import { serializeProject } from './projectFile'
import { useProjectStore } from './projectStore'

// 프로젝트 v10 필드(spec-4ab §2.1–2.4): 진짜 projectActions·history·fieldActions에 메모리 디스크로 window.api를 흉내 낸다.
// 열기·저장의 field, dirty(savedField), 열기·시즌 고르기의 필드 알림과 다시 계산(B3·B6·B10·B14·B15·B16).

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

const T0 = { position: [0, 0, 0], rotation: [0, 0, 0] } as SceneObject['transform']
const HALF = 0.2286 // 18 in 정사각형 외곽(CAD 없는 로봇, robotOutline)의 반폭

// 'none' 벽(안쪽 반폭 1.81630 m)에 +X 쪽으로 붙인 로봇: BIOBUZZ 벽(1.79286 m)에는 23 mm 걸친다(spec-4ab §1.8)
const robot = (id: string, name: string, x: number, y = 0): SceneObject => ({
  id,
  name,
  kind: 'robot',
  parentId: null,
  transform: { position: [x, y, 0], rotation: [0, 0, 0] }
})
const NONE_WALL_X = WALL_INNER_HALF - HALF

// 'none' 벽에 붙인 로봇 둘(+X 관중석 벽, −Y 빨강 벽)과 겹치지 않는 로봇 하나, 그리고 CAD를 못 찾는 로봇
function overlapScene(): SceneObjects {
  return {
    a: robot('a', 'Bot A', NONE_WALL_X),
    free: robot('free', 'Free', 0, 0),
    b: robot('b', 'Bot B', 0.9, -NONE_WALL_X)
  }
}

function withCad(objects: SceneObjects): SceneObjects {
  return {
    ...objects,
    cad: {
      id: 'cad',
      name: 'robot.step',
      kind: 'assembly',
      parentId: 'free',
      transform: T0,
      cad: {
        fileName: 'robot.step',
        absolutePath: '/cad/robot.step',
        upAxis: '+Z',
        forwardAxis: '+X',
        bounds: { min: [-0.2, -0.2, 0], max: [0.2, 0.2, 0.3] },
        meshCount: 0,
        meshIndexing: 'source'
      }
    }
  }
}

async function open(objects: SceneObjects, field: FieldDoc, version?: number): Promise<void> {
  const content = serializeProject(objects, field, (path) => path)
  if (version === undefined) projectJson = content
  else {
    const data = JSON.parse(content)
    data.version = version
    delete data.field
    projectJson = JSON.stringify(data)
  }
  await openProjectAt('/p')
  await settle()
}

const keys = (): string[] => useNoticeStore.getState().notices.map((notice) => notice.key)
const fieldKeys = (): string[] => keys().filter((key) => key.startsWith('field'))
const noticeOf = (key: string): ReturnType<typeof useNoticeStore.getState>['notices'][number] =>
  useNoticeStore.getState().notices.find((notice) => notice.key === key)!
const dirty = (): boolean => useProjectStore.getState().dirty
const season = (): string => useSceneStore.getState().field.season

beforeAll(async () => {
  await i18n.init({
    resources: { ko: { translation: ko }, en: { translation: en } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
  vi.stubGlobal('window', { api, addEventListener: () => {} })
  // 창 제목·입력칸 초안 확정(blur)이 쓰는 document
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

describe('앱 시작(프로젝트 없음)', () => {
  // 이 describe는 다른 시험이 프로젝트를 열기 전에 돈다(파일 안 순서)
  it('B14·B6: 임시 씬에는 필드 알림이 없고, 시즌만 바꿔도 dirty가 아니다', () => {
    expect(useProjectStore.getState().root).toBeNull()
    expect(isPlaceholderScene(useSceneStore.getState().objects)).toBe(true)
    expect(fieldKeys()).toEqual([])
    chooseFieldSeason('none')
    expect(season()).toBe('none')
    expect(dirty()).toBe(false)
    // 임시 상자 로봇은 BIOBUZZ에서도 겹치지 않는다(spec-4ab §1.8)
    chooseFieldSeason('biobuzz')
    expect(fieldKeys()).toEqual([])
    expect(dirty()).toBe(false)
  })
})

describe('열기·저장의 field와 dirty(B6)', () => {
  it('열면 파일 시즌이 문서 시즌이고 dirty가 아니다. 시즌만 바꾸면 dirty, 되돌려 고르면 아니다', async () => {
    await open({ free: robot('free', 'Free', 0) }, { season: 'none' })
    expect(season()).toBe('none')
    expect(dirty()).toBe(false)
    chooseFieldSeason('biobuzz')
    expect(dirty()).toBe(true)
    chooseFieldSeason('none')
    expect(dirty()).toBe(false)
    // 실행 취소로 돌아와도 같다(값으로 비교)
    chooseFieldSeason('biobuzz')
    undo()
    expect(season()).toBe('none')
    expect(dirty()).toBe(false)
    redo()
    expect(dirty()).toBe(true)
  })

  it('저장은 지금 시즌을 쓰고 savedField를 옮긴다', async () => {
    await open({ free: robot('free', 'Free', 0) }, { season: 'none' })
    chooseFieldSeason('biobuzz')
    expect(await saveProject()).toBe(true)
    await settle()
    expect(dirty()).toBe(false)
    expect(JSON.parse(projectJson!)).toMatchObject({ version: 12, field: { season: 'biobuzz' } })
    chooseFieldSeason('none')
    expect(dirty()).toBe(true)
  })

  it("'none' 프로젝트를 연 뒤 새 프로젝트(내용 없음)를 열면 시즌이 기본(biobuzz)이고 dirty가 아니다", async () => {
    await open({ free: robot('free', 'Free', 0) }, { season: 'none' })
    expect(season()).toBe('none')
    projectJson = null
    await openProjectAt('/new')
    await settle()
    expect(season()).toBe(DEFAULT_FIELD_DOC.season)
    expect(season()).toBe('biobuzz')
    expect(dirty()).toBe(false)
    expect(fieldKeys()).toEqual([])
  })

  it('B3: 모르는 시즌은 열면 fieldUnknownSeason, 저장해도 그 문자열 그대로', async () => {
    await open({ a: robot('a', 'Bot A', NONE_WALL_X) }, { season: 'decode2027' })
    expect(season()).toBe('decode2027')
    // 겹침은 모르는 시즌에서 보지 않는다
    expect(fieldKeys()).toEqual(['fieldUnknownSeason'])
    expect(noticeOf('fieldUnknownSeason').params).toEqual({ season: 'decode2027' })
    expect(dirty()).toBe(false)
    expect(await saveProject()).toBe(true)
    expect(JSON.parse(projectJson!).field).toEqual({ season: 'decode2027' })
    // 알려진 시즌을 고르면 모르는 시즌 알림이 사라지고 그 시즌으로 다시 계산한다
    chooseFieldSeason('biobuzz')
    expect(fieldKeys()).toEqual(['fieldStartOverlap'])
  })
})

describe('열기 알림(B10·B14·B16)', () => {
  it('B10: 겹친 로봇 둘이면 알림 하나에 두 항목(문서 순서), [로봇 고르기]는 첫 로봇', async () => {
    await open(overlapScene(), { season: 'biobuzz' })
    expect(fieldKeys()).toEqual(['fieldStartOverlap'])
    const notice = noticeOf('fieldStartOverlap')
    expect(notice.params).toEqual({ robots: 'Bot A (관중석 벽), Bot B (빨강 벽)' })
    expect(notice.action).toBe('selectRobot')
    runNoticeAction(notice.id)
    expect(useEditorStore.getState().selectedId).toBe('a')
    expect(fieldKeys()).toEqual([])
  })

  it("같은 씬을 'none'으로 열면 겹침 알림이 없다(벽에 붙였을 뿐)", async () => {
    await open(overlapScene(), { season: 'none' })
    expect(fieldKeys()).toEqual([])
  })

  it('B10: 실행 취소로 시즌을 바꾸면 새 알림은 없고, 있던 알림은 다시 계산해 지운다', async () => {
    await open(overlapScene(), { season: 'none' })
    chooseFieldSeason('biobuzz')
    expect(fieldKeys()).toEqual(['fieldStartOverlap'])
    expect(undo()).toBe(true)
    expect(season()).toBe('none')
    expect(fieldKeys()).toEqual([])
    // 다시 실행으로 BIOBUZZ가 되어도 새로 띄우지 않는다
    expect(redo()).toBe(true)
    expect(season()).toBe('biobuzz')
    expect(fieldKeys()).toEqual([])
  })

  it('B14: v9 파일은 fieldAssumedSeason 한 번, [Field 보기]가 Field 줄을 고른다. 저장 뒤 다시 열면 없다', async () => {
    await open({ free: robot('free', 'Free', 0) }, { season: 'none' }, 9)
    expect(season()).toBe('biobuzz')
    expect(fieldKeys()).toEqual(['fieldAssumedSeason'])
    const notice = noticeOf('fieldAssumedSeason')
    expect(notice.action).toBe('showField')
    expect(useEditorStore.getState().fieldSelected).toBe(false)
    runNoticeAction(notice.id)
    expect(useEditorStore.getState().fieldSelected).toBe(true)
    expect(useEditorStore.getState().selectedIds).toEqual([])
    expect(fieldKeys()).toEqual([])
    // v9에서 BIOBUZZ로 읽은 것은 변경이 아니다(연 그대로)
    expect(dirty()).toBe(false)
    expect(await saveProject()).toBe(true)
    await openProjectAt('/p')
    await settle()
    expect(fieldKeys()).toEqual([])
  })

  it('v9 파일을 다른 v10 프로젝트로 바꿔 열면 이전 기본 시즌 알림은 지운다', async () => {
    await open({ free: robot('free', 'Free', 0) }, { season: 'none' }, 9)
    expect(fieldKeys()).toEqual(['fieldAssumedSeason'])
    await open({ free: robot('free', 'Free', 0) }, { season: 'none' })
    expect(fieldKeys()).toEqual([])
  })

  it('B16: CAD 못 찾음 알림 다음에 필드 알림(v9 기본 시즌, 겹침)', async () => {
    await open(withCad(overlapScene()), { season: 'none' }, 9)
    const order = keys().filter((key) => key === 'cadMissing' || key.startsWith('field'))
    expect(order).toEqual(['cadMissing', 'fieldAssumedSeason', 'fieldStartOverlap'])
  })
})

describe('알림 다시 계산(B15)', () => {
  const snapA = (): void => {
    const spec = resolveSeason('biobuzz')
    const preset = spec.startPresets.find((p) => p.key === 'audienceWall')!
    const { footprint } = robotOutline(useSceneStore.getState().objects, 'a')
    const snap = snapRobotToStart(footprint, preset, spec.perimeter.innerHalf)
    if (!snap.ok) throw new Error('tooWide')
    useSceneStore.getState().setLocalTransform('a', {
      position: [snap.pose.x, snap.pose.y, 0],
      rotation: [0, 0, snap.pose.yaw]
    })
  }

  it('겹친 로봇을 프리셋으로 스냅하면 글자가 바뀌고, 모두 풀리면 알림이 사라진다', async () => {
    await open(overlapScene(), { season: 'biobuzz' })
    snapA()
    expect(noticeOf('fieldStartOverlap').params).toEqual({ robots: 'Bot B (빨강 벽)' })
    // [로봇 고르기]도 남은 첫 로봇을 고른다
    runNoticeAction(noticeOf('fieldStartOverlap').id)
    expect(useEditorStore.getState().selectedId).toBe('b')
  })

  it('UI 언어를 바꾸면 떠 있는 겹침 알림의 항목 글자도 새 언어다(띄울 때 번역한 글자를 남기지 않음)', async () => {
    await open(overlapScene(), { season: 'biobuzz' })
    expect(noticeOf('fieldStartOverlap').params).toEqual({
      robots: 'Bot A (관중석 벽), Bot B (빨강 벽)'
    })
    const id = noticeOf('fieldStartOverlap').id
    try {
      await i18n.changeLanguage('en')
      expect(noticeOf('fieldStartOverlap').id).toBe(id)
      expect(noticeOf('fieldStartOverlap').params).toEqual({
        robots: 'Bot A (Audience wall), Bot B (Red wall)'
      })
    } finally {
      await i18n.changeLanguage('ko')
    }
    expect(noticeOf('fieldStartOverlap').params.robots).toContain('빨강 벽')
    // 닫은 알림은 언어를 바꿔도 되살아나지 않는다
    useNoticeStore.getState().dismiss(id)
    await i18n.changeLanguage('en')
    await i18n.changeLanguage('ko')
    expect(fieldKeys()).toEqual([])
  })

  it('스냅으로 모두 풀리면 지운다', async () => {
    await open({ a: robot('a', 'Bot A', NONE_WALL_X) }, { season: 'biobuzz' })
    expect(fieldKeys()).toEqual(['fieldStartOverlap'])
    snapA()
    expect(fieldKeys()).toEqual([])
  })

  it('핸들 드래그 중에는 계산을 미루고 놓을 때 한 번 한다', async () => {
    await open({ a: robot('a', 'Bot A', NONE_WALL_X) }, { season: 'biobuzz' })
    beginChange()
    useSceneStore.getState().setLocalTransform('a', { position: [1.2, 0, 0], rotation: [0, 0, 0] })
    useSceneStore.getState().setLocalTransform('a', { position: [1.0, 0, 0], rotation: [0, 0, 0] })
    expect(fieldKeys()).toEqual(['fieldStartOverlap'])
    endChange()
    expect(fieldKeys()).toEqual([])
  })

  it('알림이 없을 때 objects를 바꿔 겹쳐도 새로 띄우지 않는다', async () => {
    await open({ a: robot('a', 'Bot A', 0) }, { season: 'biobuzz' })
    expect(fieldKeys()).toEqual([])
    useSceneStore
      .getState()
      .setLocalTransform('a', { position: [NONE_WALL_X, 0, 0], rotation: [0, 0, 0] })
    expect(fieldKeys()).toEqual([])
  })

  it('알림을 닫은 뒤에는 다시 계산하지 않는다(닫은 알림이 되살아나지 않는다)', async () => {
    await open({ a: robot('a', 'Bot A', NONE_WALL_X) }, { season: 'biobuzz' })
    useNoticeStore.getState().dismiss(noticeOf('fieldStartOverlap').id)
    useSceneStore
      .getState()
      .setLocalTransform('a', { position: [NONE_WALL_X, 0.1, 0], rotation: [0, 0, 0] })
    expect(fieldKeys()).toEqual([])
  })

  it('시즌을 모르는 것으로 되돌리면(실행 취소) 겹침 알림을 지운다', async () => {
    await open({ a: robot('a', 'Bot A', NONE_WALL_X) }, { season: 'decode2027' })
    chooseFieldSeason('biobuzz')
    expect(fieldKeys()).toEqual(['fieldStartOverlap'])
    expect(undo()).toBe(true)
    expect(season()).toBe('decode2027')
    expect(fieldKeys()).toEqual([])
  })
})
