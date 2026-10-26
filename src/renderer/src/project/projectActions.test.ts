import { createHash } from 'crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JavaSourceRead, ReadJavaSourcesResult } from '../../../shared/ipc'
import { deviceUsageView } from '../editor/usages/usageView'
import { useNoticeStore } from '../editor/noticeStore'
import { propertyDefaults } from '../hardware/catalog'
import { FOCUS_REFRESH_DELAY, scheduleFocusRefresh } from '../java/javaIndex'
import {
  initUsageIndex,
  resetUsageIndexState,
  setUsageWorkerFactory,
  SYMBOLS_DEBOUNCE_MS,
  useUsageIndexStore,
  type UsageWorkerLike
} from '../java/usageIndex'
import type { FromWorker, ToWorker } from '../java/usages/usageTypes'
import { createUsageWorkerState, handleMessage } from '../java/usages/usageWorkerCore'
import type { SceneObject, SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { openProjectAt, saveProject } from './projectActions'
import { serializeProject } from './projectFile'
import { useProjectStore } from './projectStore'

// 저장과 사용처(spec §7.4): 진짜 projectActions(열기·저장)·usageIndex·기호표·워커 논리(진짜 사실·맞추기)에 메모리
// 디스크로 window.api를 흉내 낸다. 생성 코드를 맞춘 저장만 기준 씬을 옮기고, 저장 뒤 파일로 판정하는지 본다.

const P = 'src/main/java/org/firstinspires/ftc/teamcode/'

type DiskFile = { text: string; mtimeMs: number }
const disk = new Map<string, DiskFile>()
let clock = 1000
const write = (name: string, text: string): void => {
  disk.set(P + name, { text, mtimeMs: ++clock })
}
const size = (text: string): number => Buffer.byteLength(text, 'utf8')
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

// 읽기를 붙잡아 둘지, 목록 읽기를 몇 번 실패시킬지
const hold = { reads: false, listFail: 0 }
const held: (() => void)[] = []
let projectJson = ''

const SYNCED = {
  status: 'synced' as const,
  written: [],
  unchanged: [],
  deleted: [],
  skipped: [],
  modified: [],
  caseRenamed: []
}

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
  statStepFile: async () => null,
  syncGeneratedFiles: vi.fn(async () => SYNCED),
  listJavaFiles: vi.fn(async () => {
    if (hold.listFail > 0) {
      hold.listFail--
      throw new Error('EBUSY')
    }
    return {
      hasTeamCode: true,
      truncated: false,
      files: [...disk].map(([path, file]) => ({
        path,
        size: size(file.text),
        mtimeMs: file.mtimeMs
      }))
    }
  }),
  readJavaSources: vi.fn(async (_root: string, paths: string[]): Promise<ReadJavaSourcesResult> => {
    const result: ReadJavaSourcesResult = {
      ok: true,
      files: paths.map((path): JavaSourceRead => {
        const file = disk.get(path)
        if (!file) return { path, status: 'missing' }
        return { path, status: 'ok', text: file.text, size: size(file.text), mtimeMs: file.mtimeMs }
      })
    }
    return hold.reads ? new Promise((resolve) => held.push(() => resolve(result))) : result
  }),
  readJavaFile: vi.fn(async (_root: string, path: string) => {
    const file = disk.get(path)
    if (!file) return { ok: false, code: 'missing', detail: '' }
    return { ok: true, text: file.text, hash: sha(file.text), editable: true }
  }),
  // 메인처럼 해시와 바꿀 자리의 글자를 확인하고 리터럴만 바꾼다
  writeJavaLiterals: vi.fn(
    async (
      _root: string,
      path: string,
      expectedHash: string,
      edits: { start: number; end: number; expected: string; text: string }[]
    ) => {
      const file = disk.get(path)
      if (!file) return { status: 'missing' }
      if (sha(file.text) !== expectedHash) return { status: 'changed' }
      let text = file.text
      for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        if (text.slice(edit.start, edit.end) !== edit.expected)
          return { status: 'refused', reason: 'expected' }
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
      }
      disk.set(path, { text, mtimeMs: ++clock })
      return { status: 'written', text, hash: sha(text) }
    }
  ),
  setDirty: () => {},
  onCloseRequested: () => {}
}

// 같은 스레드에서 도는 워커(진짜 워커 논리, 메시지는 structuredClone을 거친다)
class InThreadWorker implements UsageWorkerLike {
  onmessage: ((event: { data: FromWorker }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  private terminated = false
  private readonly state = createUsageWorkerState()
  postMessage(message: ToWorker): void {
    const copy = structuredClone(message)
    queueMicrotask(() => {
      if (this.terminated) return
      this.onmessage?.({ data: structuredClone(handleMessage(this.state, copy)) })
    })
  }
  terminate(): void {
    this.terminated = true
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 600; i++) await Promise.resolve()
}

const T0 = { position: [0, 0, 0], rotation: [0, 0, 0] } as SceneObject['transform']

// 로봇 하나: Lift 그룹의 모터(liftName, 포트 1)와 drive 모터(drivePort). 포트가 겹치면 검증 오류라 생성이 막힌다.
function botScene(liftName: string, drivePort = 0): SceneObjects {
  const motor = (id: string, name: string, port: number): SceneObject['components'] => [
    { id, type: 'motor', name, hub: 'controlHub', port, props: propertyDefaults('motor') }
  ]
  return {
    bot: {
      id: 'bot',
      name: 'Bot',
      kind: 'robot',
      parentId: null,
      transform: T0,
      hardware: {
        className: 'RobotHardware',
        configName: 'Bot',
        expansionHub: { enabled: false, address: 2 }
      }
    },
    lift: { id: 'lift', name: 'Lift', kind: 'group', parentId: 'bot', transform: T0 },
    lm: {
      id: 'lm',
      name: 'lm',
      kind: 'part',
      parentId: 'lift',
      transform: T0,
      components: motor('ll', liftName, 1)
    },
    dm: {
      id: 'dm',
      name: 'dm',
      kind: 'part',
      parentId: 'bot',
      transform: T0,
      components: motor('dr', 'drive', drivePort)
    }
  }
}

const HEADER = `package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotorEx;
`

// 이름으로만 찾는 팀(FTC에서 가장 흔하다)
const byName = (name: string): string => `${HEADER}
public class Teleop extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotorEx lift = hardwareMap.get(DcMotorEx.class, "${name}");
    }
}
`

const ROBOT_IMPORT = 'import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;\n'

// 생성 클래스로 쓰고 이름으로도 찾는다
const auto = (name: string): string => `${HEADER}${ROBOT_IMPORT}
public class Auto extends LinearOpMode {
    @Override
    public void runOpMode() {
        RobotHardware robot = new RobotHardware(hardwareMap);
        robot.lift.${name}.setPower(1);
        DcMotorEx m = hardwareMap.get(DcMotorEx.class, "${name}");
    }
}
`

const usage = (): ReturnType<typeof useUsageIndexStore.getState> => useUsageIndexStore.getState()
const usageNotices = (): string[] =>
  useNoticeStore
    .getState()
    .notices.map((notice) => notice.key)
    .filter((key) => key.startsWith('usages'))
const generation = (): string | undefined => useProjectStore.getState().generation?.status

function liftView(): ReturnType<typeof deviceUsageView> {
  const { result, baseline } = usage()
  return deviceUsageView(useSceneStore.getState().objects, result!, baseline, 'lm', 'll')
}

async function edit(objects: SceneObjects): Promise<void> {
  useSceneStore.setState({ objects })
  vi.advanceTimersByTime(SYMBOLS_DEBOUNCE_MS)
  await settle()
}

async function open(objects: SceneObjects): Promise<void> {
  projectJson = serializeProject(objects, (path) => path)
  await openProjectAt('/p')
  await settle()
  expect(usage().status).toBe('ready')
}

async function save(): Promise<void> {
  await saveProject()
  await settle()
}

describe('저장과 사용처', () => {
  beforeAll(() => {
    initUsageIndex()
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('window', { api, addEventListener: () => {} })
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    })
    disk.clear()
    hold.reads = false
    hold.listFail = 0
    held.length = 0
    api.syncGeneratedFiles.mockReset()
    useNoticeStore.setState({ notices: [] })
    useSceneStore.setState({ tunables: {} })
    resetUsageIndexState()
    setUsageWorkerFactory(() => new InThreadWorker())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('생성이 막힌 저장은 기준 씬을 옮기지 않고, 다음에 생성 코드를 맞춘 저장이 없앤 이름을 알린다', async () => {
    write('Teleop.java', byName('liftLeft'))
    await open(botScene('liftLeft'))
    // 이름을 바꾸고 drive를 같은 포트에 둬 검증 오류(생성이 막힌다)
    await edit(botScene('liftMain', 1))
    expect(liftView()!.sections.map((s) => s.id)).toContain('renamedName')
    await save()
    expect(generation()).toBe('blocked')
    // 디스크의 구성은 그대로(liftLeft)라 장치 카드의 이전 이름 ⚠도 그대로다
    expect(liftView()!.sections.map((s) => s.id)).toContain('renamedName')
    expect(liftView()!.counts.warnings).toBe(1)
    expect(usageNotices()).toEqual([])

    // 포트를 고쳐 저장: 이 저장이 처음으로 구성에서 liftLeft를 없앤다
    await edit(botScene('liftMain', 0))
    await save()
    expect(generation()).toBe('synced')
    expect(usageNotices()).toEqual(['usagesBrokenByName'])
    expect(useNoticeStore.getState().notices.at(-1)!.params).toEqual({
      count: 1,
      files: 'Teleop.java'
    })
    // 이제 기준 씬이 옮겨 가 장치 카드의 이전 이름은 없다
    expect(liftView()!.sections.map((s) => s.id)).not.toContain('renamedName')
  })

  it('생성에 실패한 저장도 기준 씬을 옮기지 않는다(다시 저장해 맞추면 알린다)', async () => {
    write('Teleop.java', byName('liftLeft'))
    await open(botScene('liftLeft'))
    await edit(botScene('liftMain'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.syncGeneratedFiles.mockRejectedValueOnce(new Error('EPERM'))
    await save()
    expect(generation()).toBe('failed')
    expect(usageNotices()).toEqual([])
    expect(liftView()!.sections.map((s) => s.id)).toContain('renamedName')
    api.syncGeneratedFiles.mockResolvedValueOnce(SYNCED)
    await save()
    expect(generation()).toBe('synced')
    expect(usageNotices()).toEqual(['usagesBrokenByName'])
    error.mockRestore()
  })

  it('저장이 쓴 튜닝 값으로 판정한다(장치 이름과 같은 이름의 @Config 문자열을 함께 고친 저장)', async () => {
    write(
      'Constants.java',
      `package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.config.Config;

@Config
public class Constants {
    public static String LIFT = "liftLeft";
}
`
    )
    write('Teleop.java', byName('x').replace('"x"', 'Constants.LIFT'))
    await open(botScene('liftLeft'))
    await edit(botScene('liftMain'))
    useSceneStore.setState({
      tunables: {
        [P + 'Constants.java']: {
          'Constants#LIFT': { value: '"liftMain"', base: '"liftLeft"' }
        }
      }
    })
    await save()
    expect(generation()).toBe('synced')
    expect(disk.get(P + 'Constants.java')!.text).toContain('"liftMain"')
    expect([...usage().result!.unknownNames.keys()]).toEqual([])
    expect(usageNotices()).toEqual([])
  })

  it('다른 편집기에서 고치고 돌아와 포커스 읽기 전에 저장해도 저장 뒤 파일로 판정한다', async () => {
    write('Auto.java', auto('liftLeft'))
    await open(botScene('liftLeft'))
    await edit(botScene('liftMain'))
    expect(usage().result!.unresolved.size).toBeGreaterThan(0)
    // Android Studio에서 새 이름으로 고치고 돌아와(포커스) 묶음 시간 안에 Ctrl+S
    write('Auto.java', auto('liftMain'))
    scheduleFocusRefresh()
    vi.advanceTimersByTime(FOCUS_REFRESH_DELAY - 100)
    await save()
    expect(generation()).toBe('synced')
    expect(usage().result!.unresolved.size).toBe(0)
    expect(usageNotices()).toEqual([])
    vi.advanceTimersByTime(FOCUS_REFRESH_DELAY)
    await settle()
    expect(usageNotices()).toEqual([])
  })

  it('저장할 때 사용처가 failed여도(포커스 때 목록 읽기 실패) 저장 뒤 다시 읽어 알린다', async () => {
    write('Teleop.java', byName('liftLeft'))
    await open(botScene('liftLeft'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    hold.listFail = 1
    scheduleFocusRefresh()
    vi.advanceTimersByTime(FOCUS_REFRESH_DELAY)
    await settle()
    expect(usage().status).toBe('failed')
    await edit(botScene('liftMain'))
    await save()
    expect(generation()).toBe('synced')
    expect(usage().status).toBe('ready')
    expect(usageNotices()).toEqual(['usagesBrokenByName'])
    error.mockRestore()
  })

  it('처음 읽는 중에 저장하고 끝나기 전에 또 이름을 바꿔도 저장한 씬으로 알린다', async () => {
    projectJson = serializeProject(botScene('liftLeft'), (path) => path)
    write('Teleop.java', byName('liftLeft'))
    for (let i = 0; i < 20; i++)
      write(`F${i}.java`, `package org.firstinspires.ftc.teamcode;\nclass F${i} {}\n`)
    hold.reads = true
    await openProjectAt('/p')
    await settle()
    expect(usage().status).toBe('scanning')
    await edit(botScene('liftMain'))
    await save()
    expect(generation()).toBe('synced')
    // 다른 이름으로 또 바꾼다(스토어에는 저장한 씬의 결과가 오지 않는다)
    const renamed = botScene('liftMain')
    renamed.dm = {
      ...renamed.dm,
      components: [{ ...renamed.dm.components![0], name: 'driveMotor' }]
    }
    await edit(renamed)
    hold.reads = false
    while (held.length > 0) {
      held.shift()!()
      await settle()
    }
    expect(usage().status).toBe('ready')
    expect(usageNotices()).toEqual(['usagesBrokenByName'])
  })
})
