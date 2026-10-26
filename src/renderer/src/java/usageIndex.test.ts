import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_USAGE_FILE_BYTES,
  type JavaSourceRead,
  type ReadJavaSourcesResult
} from '../../../shared/ipc'
import { useNoticeStore } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { buildJavaIndex, useJavaIndexStore } from './javaIndex'
import {
  checkUsagesAfterSave,
  clearUsageNotices,
  initUsageIndex,
  resetUsageIndexState,
  setUsageWorkerFactory,
  SYMBOLS_DEBOUNCE_MS,
  usageSaveNotices,
  useUsageIndexStore,
  type UsageWorkerLike
} from './usageIndex'
import type { FileFacts } from './usages/usageFacts'
import type { FromWorker, ToWorker, UsageHit, UsageResult, UsageSymbols } from './usages/usageTypes'
import { createUsageWorkerState, handleMessage } from './usages/usageWorkerCore'

// 사용처 조율(스토어) 테스트. 핵심 순수 함수(기호표·사실·맞추기)는 가짜다: 기호표는 장치 이름만 담고, 사실은 줄마다
// 'field <이름>'·'lookup <이름>'을 읽고, 맞추기는 필드 이름이 기호에 있으면 사용처, 없으면 생성 코드에 없는 이름,
// 찾기 이름이 없으면 구성에 없는 이름으로 둔다. 가짜 워커는 진짜 워커 논리(usageWorkerCore)에 이 가짜를 넣어
// 같은 스레드에서 돌린다(답은 마이크로태스크로 보낸다).

const symbolsCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('./usages/usageSymbols', () => {
  type Device = { name: string; key: string }
  const devicesOf = (objects: SceneObjects): Device[] =>
    Object.values(objects).flatMap((object) =>
      (object.components ?? []).map((component) => ({
        name: component.name,
        key: `d:${object.id}\n${component.id}`
      }))
    )
  const memo = new WeakMap<SceneObjects, UsageSymbols>()
  return {
    usageSymbols: (objects: SceneObjects): UsageSymbols => {
      let symbols = memo.get(objects)
      if (!symbols) {
        symbolsCalls.count++
        const devices = devicesOf(objects)
        symbols = {
          robots: [
            {
              key: 'r:robot',
              name: 'RobotHardware',
              fields: devices.map(({ name, key }) => ({ name, key, group: null })),
              constants: []
            }
          ],
          unavailable: [],
          lookupNames: devices.map(({ name, key }) => ({ name: name.trim(), keys: [key] })),
          signature: JSON.stringify(devices)
        }
        memo.set(objects, symbols)
      }
      return symbols
    },
    lookupNamesOf: (objects: SceneObjects): Map<string, string[]> => {
      const names = new Map<string, string[]>()
      for (const { name, key } of devicesOf(objects))
        names.set(name.trim(), [...(names.get(name.trim()) ?? []), key])
      return names
    }
  }
})

type FakeUse = { kind: 'field' | 'lookup'; name: string; line: number }

function fakeExtractFacts(text: string): FileFacts {
  const uses: FakeUse[] = []
  text.split('\n').forEach((line, index) => {
    const [kind, name] = line.trim().split(' ')
    if ((kind === 'field' || kind === 'lookup') && name) uses.push({ kind, name, line: index + 1 })
  })
  return { uses } as unknown as FileFacts
}

function fakeResolveUsages(
  files: ReadonlyMap<string, FileFacts>,
  symbols: UsageSymbols
): UsageResult {
  const result: UsageResult = {
    hits: new Map(),
    totals: new Map(),
    unresolved: new Map(),
    unknownNames: new Map(),
    files: { scanned: files.size, tooLarge: [], unicodeEscape: [], failed: [] }
  }
  const push = <K>(map: Map<K, UsageHit[]>, key: K, hit: UsageHit): void => {
    map.set(key, [...(map.get(key) ?? []), hit])
  }
  const fields = new Map(
    symbols.robots.flatMap((robot) => robot.fields.map((f) => [f.name, f.key]))
  )
  const names = new Map(symbols.lookupNames.map(({ name, keys }) => [name, keys]))
  for (const [path, facts] of files) {
    for (const use of (facts as unknown as { uses: FakeUse[] }).uses) {
      const hit: UsageHit = {
        path,
        line: use.line,
        col: 1,
        kind: use.kind,
        snippet: use.name,
        mark: [0, use.name.length]
      }
      if (use.kind === 'field') {
        const key = fields.get(use.name)
        if (key) push(result.hits, key, hit)
        else push(result.unresolved, 'r:robot', { ...hit, kind: 'unresolved', member: use.name })
      } else {
        const keys = names.get(use.name)
        if (keys) for (const key of keys) push(result.hits, key, hit)
        else push(result.unknownNames, use.name, hit)
      }
    }
  }
  return result
}

class FakeWorker implements UsageWorkerLike {
  onmessage: ((event: { data: FromWorker }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  messages: ToWorker[] = []
  terminated = false
  // 맞추기를 받으면 답 대신 멈춘다(onerror)
  crashOnMatch = false
  // 답을 모아 두었다가 flush로 보낸다(끝낸 뒤에도 보내는 워커를 흉내 낸다)
  holdReplies = false
  private heldReplies: ToWorker[] = []
  state = createUsageWorkerState({
    extractFacts: fakeExtractFacts,
    resolveUsages: fakeResolveUsages
  })
  postMessage(message: ToWorker): void {
    this.messages.push(message)
    if (this.holdReplies) {
      this.heldReplies.push(message)
      return
    }
    queueMicrotask(() => {
      if (this.terminated) return
      this.reply(message)
    })
  }
  flush(): void {
    const messages = this.heldReplies
    this.heldReplies = []
    for (const message of messages) this.reply(message)
  }
  private reply(message: ToWorker): void {
    if (message.type === 'match' && this.crashOnMatch) {
      this.onerror?.({ message: 'boom' })
      return
    }
    this.onmessage?.({ data: handleMessage(this.state, message) })
  }
  terminate(): void {
    this.terminated = true
  }
  get matches(): Extract<ToWorker, { type: 'match' }>[] {
    return this.messages.filter(
      (m): m is Extract<ToWorker, { type: 'match' }> => m.type === 'match'
    )
  }
  get fileMessages(): Extract<ToWorker, { type: 'files' }>[] {
    return this.messages.filter(
      (m): m is Extract<ToWorker, { type: 'files' }> => m.type === 'files'
    )
  }
}

const P = 'src/main/java/org/firstinspires/ftc/teamcode/'
const T0 = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number]
}

// 로봇 하나와 장치 이름마다 파트 하나(키는 순번으로 지어 이름을 바꿔도 같다)
function scene(names: string[], x = 0): SceneObjects {
  const objects: SceneObjects = {
    robot: { id: 'robot', name: 'Robot', kind: 'robot', parentId: null, transform: T0 }
  }
  names.forEach((name, i) => {
    objects[`part${i}`] = {
      id: `part${i}`,
      name: `Part ${i}`,
      kind: 'part',
      parentId: 'robot',
      transform: { position: [x, 0, 0], rotation: [0, 0, 0] },
      components: [{ id: `c${i}`, type: 'dcMotorEx', name, hub: 'controlHub', port: i, props: {} }]
    }
  })
  return objects
}

const SYNCED = {
  status: 'synced' as const,
  written: [],
  unchanged: [],
  deleted: [],
  skipped: [],
  modified: [],
  caseRenamed: []
}

// 디스크(경로 → 내용·크기·시각). 크기를 정하지 않으면 글자 수.
type DiskFile = { text: string; size: number; mtimeMs: number }
let disk: Map<string, DiskFile>
let workers: FakeWorker[]
let held: { paths: string[]; release: () => void }[]
let holdReads: boolean

const answer = (paths: string[]): ReadJavaSourcesResult => ({
  ok: true,
  files: paths.map((path): JavaSourceRead => {
    const file = disk.get(path)
    if (!file) return { path, status: 'missing' }
    // 메인처럼 256 KB를 넘으면 글자 없이 크기·시각만
    if (file.size > MAX_USAGE_FILE_BYTES)
      return { path, status: 'tooLarge', size: file.size, mtimeMs: file.mtimeMs }
    return { path, status: 'ok', text: file.text, size: file.size, mtimeMs: file.mtimeMs }
  })
})

const defaultRead = (_root: string, paths: string[]): Promise<ReadJavaSourcesResult> => {
  // 읽은 때의 디스크 내용(풀어 주기 전에 바뀌어도 그때 것)
  const result = answer(paths)
  return holdReads
    ? new Promise((resolve) => held.push({ paths, release: () => resolve(result) }))
    : Promise.resolve(result)
}
const readJavaSources = vi.fn(defaultRead)

function write(name: string, text: string, mtimeMs = 1, size = text.length): void {
  disk.set(P + name, { text, size, mtimeMs })
}

// 디스크 내용으로 Java 목록을 바꾼다(revision이 오른다)
function publishListing(root = '/p'): void {
  const files = buildJavaIndex(
    [...disk].map(([path, { size, mtimeMs }]) => ({ path, size, mtimeMs }))
  )
  const { revision } = useJavaIndexStore.getState()
  useJavaIndexStore.setState({
    status: 'ready',
    root,
    files,
    truncated: false,
    revision: revision + 1
  })
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

const worker = (): FakeWorker => workers[workers.length - 1]
const readPaths = (): string[][] => readJavaSources.mock.calls.map(([, paths]) => paths)
const usage = (): ReturnType<typeof useUsageIndexStore.getState> => useUsageIndexStore.getState()
const hitsOf = (key: string): UsageHit[] => usage().result?.hits.get(key) ?? []
const LIFT = 'd:part0\nc0'
const noticeKeys = (): string[] => useNoticeStore.getState().notices.map((notice) => notice.key)

async function rename(names: string[]): Promise<void> {
  useSceneStore.setState({ objects: scene(names) })
  vi.advanceTimersByTime(SYMBOLS_DEBOUNCE_MS)
  await settle()
}

// 프로젝트를 열고(세션) 목록을 준비해 처음 다 읽는다
async function openProject(root = '/p', session = 1): Promise<void> {
  useProjectStore.setState({ root, session, busy: false })
  publishListing(root)
  await settle()
}

describe('사용처 조율', () => {
  beforeAll(() => {
    initUsageIndex()
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    disk = new Map()
    workers = []
    held = []
    holdReads = false
    symbolsCalls.count = 0
    // 앞 테스트가 바꾼 구현도 처음 구현(defaultRead)으로 되돌린다
    readJavaSources.mockReset()
    vi.stubGlobal('window', { api: { readJavaSources } })
    useSceneStore.setState({ objects: scene(['liftLeft']) })
    useProjectStore.setState(useProjectStore.getInitialState())
    useJavaIndexStore.setState(useJavaIndexStore.getInitialState())
    useNoticeStore.setState({ notices: [] })
    resetUsageIndexState()
    setUsageWorkerFactory(() => {
      const created = new FakeWorker()
      workers.push(created)
      return created
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetUsageIndexState()
  })

  it('프로젝트를 열고 목록이 준비되면 모든 파일을 한 번 읽고 맞춘다', async () => {
    write('A.java', 'field liftLeft\nlookup liftLeft')
    write('B.java', 'nothing')
    useProjectStore.setState({ root: '/p', session: 1, busy: false })
    await settle()
    // 목록을 아직 읽지 못했다
    expect(readJavaSources).not.toHaveBeenCalled()
    expect(usage()).toMatchObject({ status: 'scanning', root: '/p', session: 1 })
    publishListing()
    await settle()
    expect(readPaths()).toEqual([[P + 'A.java', P + 'B.java']])
    expect(worker().messages.map((m) => m.type)).toEqual(['files', 'match'])
    expect(usage().status).toBe('ready')
    expect(hitsOf(LIFT).map((hit) => [hit.path, hit.line, hit.kind])).toEqual([
      [P + 'A.java', 1, 'field'],
      [P + 'A.java', 2, 'lookup']
    ])
    expect(usage().resultSignature).toBe(worker().matches[0].symbols.signature)
  })

  it('프로젝트가 없으면 none, TeamCode가 없으면 noTeamCode다', async () => {
    expect(usage().status).toBe('none')
    useProjectStore.setState({ root: '/p', session: 1, busy: false })
    useJavaIndexStore.setState({ status: 'noTeamCode', root: '/p', files: [], revision: 5 })
    await settle()
    expect(usage().status).toBe('noTeamCode')
    expect(readJavaSources).not.toHaveBeenCalled()
  })

  it('파일 하나가 바뀌면 그 경로만 읽고, 목록에서 빠진 파일은 읽지 않고 워커에서 뺀다', async () => {
    write('A.java', 'field liftLeft')
    write('B.java', 'field liftLeft')
    write('C.java', 'lookup liftLeft')
    await openProject()
    readJavaSources.mockClear()

    write('B.java', 'nothing here', 2)
    disk.delete(P + 'C.java')
    publishListing()
    await settle()
    expect(readPaths()).toEqual([[P + 'B.java']])
    const last = worker().fileMessages.at(-1)!
    expect(last.upserts.map((u) => u.path)).toEqual([P + 'B.java'])
    expect(last.removes).toEqual([P + 'C.java'])
    expect(hitsOf(LIFT).map((hit) => hit.path)).toEqual([P + 'A.java'])

    // 목록이 그대로면(포커스) 읽지도 맞추지도 않는다
    readJavaSources.mockClear()
    const matches = worker().matches.length
    publishListing()
    await settle()
    expect(readJavaSources).not.toHaveBeenCalled()
    expect(worker().matches).toHaveLength(matches)
  })

  it('이름을 바꾸면 읽지 않고 한 번만 맞춘다. 옮기기만 하면 기호표를 묶음 뒤 한 번 만들고 맞추지 않는다', async () => {
    write('A.java', 'field liftLeft\nfield liftL')
    await openProject()
    readJavaSources.mockClear()
    const matches = worker().matches.length

    await rename(['liftL'])
    expect(readJavaSources).not.toHaveBeenCalled()
    expect(worker().matches).toHaveLength(matches + 1)
    expect(hitsOf(LIFT).map((hit) => hit.line)).toEqual([2])
    expect(
      usage()
        .result?.unresolved.get('r:robot')
        ?.map((hit) => hit.member)
    ).toEqual(['liftLeft'])

    // 끄는 동안 프레임마다 바뀌는 문서: 묶음 시간 안에서는 기호표를 만들지 않는다
    const calls = symbolsCalls.count
    for (let i = 1; i <= 10; i++) {
      useSceneStore.setState({ objects: scene(['liftL'], i) })
      vi.advanceTimersByTime(SYMBOLS_DEBOUNCE_MS / 4)
    }
    expect(symbolsCalls.count).toBe(calls)
    vi.advanceTimersByTime(SYMBOLS_DEBOUNCE_MS)
    await settle()
    expect(symbolsCalls.count).toBe(calls + 1)
    expect(worker().matches).toHaveLength(matches + 1)
    expect(readJavaSources).not.toHaveBeenCalled()
  })

  it('처음 읽는 중에 이름을 바꾸면 모든 파일을 넘긴 뒤에야 새 이름으로 한 번 맞춘다', async () => {
    holdReads = true
    for (let i = 0; i < 300; i++) write(`F${String(i).padStart(3, '0')}.java`, 'field liftLeft')
    await openProject()
    // 256개씩 나눠 읽는다
    expect(held).toHaveLength(1)
    expect(held[0].paths).toHaveLength(256)

    await rename(['liftL'])
    expect(worker().matches).toHaveLength(0)
    held[0].release()
    await settle()
    expect(worker().matches).toHaveLength(0)
    expect(held).toHaveLength(2)
    expect(held[1].paths).toHaveLength(44)
    held[1].release()
    await settle()
    expect(worker().messages.map((m) => m.type)).toEqual(['files', 'files', 'match'])
    expect(worker().matches[0].symbols.signature).toContain('liftL"')
    expect(usage().status).toBe('ready')
    expect(usage().result?.unresolved.get('r:robot')).toHaveLength(300)
  })

  it('묶음은 목록 크기로 4 MB까지 나눈다(너무 커서 글자 없이 오는 파일은 세지 않는다)', async () => {
    // 200 KB 25개: 20개(4,000 KB)까지 한 묶음. 사이의 9 MB 파일은 tooLarge로 오므로 세지 않는다.
    for (let i = 0; i < 25; i++)
      write(`F${String(i).padStart(2, '0')}.java`, 'field liftLeft', 1, 200 * 1024)
    write('F10Big.java', 'x', 1, 9 * 1024 * 1024)
    await openProject()
    const batches = readPaths()
    expect(batches.map((batch) => batch.length)).toEqual([21, 5])
    expect(batches[0]).toContain(P + 'F10Big.java')
    expect(usage().result?.files.tooLarge).toEqual([P + 'F10Big.java'])
    expect(hitsOf(LIFT)).toHaveLength(25)
  })

  it('미룬 경로는 다음 묶음 앞에서 다시 묻는다', async () => {
    write('A.java', 'field liftLeft')
    write('B.java', 'field liftLeft')
    write('C.java', 'field liftLeft')
    readJavaSources.mockImplementationOnce(async (_root, paths) => ({
      ok: true,
      files: paths.map((path, i): JavaSourceRead =>
        i === 0
          ? { path, status: 'ok', text: 'field liftLeft', size: 14, mtimeMs: 1 }
          : { path, status: 'deferred' }
      )
    }))
    await openProject()
    expect(readPaths()).toEqual([
      [P + 'A.java', P + 'B.java', P + 'C.java'],
      [P + 'B.java', P + 'C.java']
    ])
    expect(hitsOf(LIFT)).toHaveLength(3)
    expect(usage().status).toBe('ready')
  })

  it('미룬 경로는 아직 묻지 않은 경로보다 먼저 묻는다', async () => {
    for (let i = 0; i < 258; i++) write(`F${String(i).padStart(3, '0')}.java`, 'field liftLeft')
    readJavaSources.mockImplementationOnce(async (_root, paths) => ({
      ok: true,
      files: paths.map((path, i): JavaSourceRead =>
        i === 0
          ? { path, status: 'ok', text: 'field liftLeft', size: 14, mtimeMs: 1 }
          : { path, status: 'deferred' }
      )
    }))
    await openProject()
    const batches = readPaths()
    expect(batches.map((batch) => batch.length)).toEqual([256, 256, 1])
    expect(batches[1][0]).toBe(P + 'F001.java')
    expect(batches[1][255]).toBe(P + 'F256.java')
    expect(batches[2]).toEqual([P + 'F257.java'])
    expect(hitsOf(LIFT)).toHaveLength(258)
  })

  it('너무 큰 파일·읽지 못한 파일은 사실 없이 넘기고 결과의 files에 남긴다', async () => {
    write('A.java', 'field liftLeft')
    write('Big.java', 'field liftLeft')
    write('Bad.java', 'field liftLeft')
    write('Link.java', 'field liftLeft')
    readJavaSources.mockImplementationOnce(async (_root, paths) => ({
      ok: true,
      files: paths.map((path): JavaSourceRead =>
        path.endsWith('Big.java')
          ? { path, status: 'tooLarge', size: 300_000, mtimeMs: 1 }
          : path.endsWith('Bad.java')
            ? { path, status: 'failed' }
            : path.endsWith('Link.java')
              ? { path, status: 'notAllowed' }
              : { path, status: 'ok', text: 'field liftLeft', size: 14, mtimeMs: 1 }
      )
    }))
    await openProject()
    expect(usage().result?.files).toMatchObject({
      scanned: 1,
      tooLarge: [P + 'Big.java'],
      failed: [P + 'Bad.java', P + 'Link.java']
    })
    // 다음 목록에서 Big은 읽은 핸들의 stamp(목록 뒤에 커졌다)를, Link(받지 않는 경로)는 목록의 stamp를 기억하므로
    // 새 목록이 그 크기를 보이면 읽지 않는다. 읽기 오류(Bad)는 크기·시각이 그대로여도(잠금이 풀린 파일 등) 그 파일만
    // 다시 읽는다.
    readJavaSources.mockClear()
    disk.set(P + 'Big.java', { text: 'x', size: 300_000, mtimeMs: 1 })
    publishListing()
    await settle()
    expect(readPaths()).toEqual([[P + 'Bad.java']])
    expect(usage().result?.files).toMatchObject({
      scanned: 2,
      tooLarge: [P + 'Big.java'],
      failed: [P + 'Link.java']
    })
    expect(hitsOf(LIFT).map((hit) => hit.path)).toEqual([P + 'A.java', P + 'Bad.java'])
    // 읽었으니 그 뒤로는 바뀌기 전에 다시 읽지 않는다
    readJavaSources.mockClear()
    publishListing()
    await settle()
    expect(readJavaSources).not.toHaveBeenCalled()
  })

  it('읽기 오류가 난 파일은 열기·저장이 끝날 때도 다시 읽는다(한 번의 읽기 안에서는 다시 묻지 않는다)', async () => {
    write('A.java', 'field liftLeft')
    write('Bad.java', 'field liftLeft')
    const failBad = async (_root: string, paths: string[]): Promise<ReadJavaSourcesResult> => {
      const result = answer(paths)
      if (!result.ok) return result
      return {
        ok: true,
        files: result.files.map((file) =>
          file.path.endsWith('Bad.java') ? { path: file.path, status: 'failed' } : file
        )
      }
    }
    readJavaSources.mockImplementation(failBad)
    await openProject()
    expect(readJavaSources).toHaveBeenCalledTimes(1)
    expect(usage().result?.files.failed).toEqual([P + 'Bad.java'])
    // 원인이 그대로면 저장이 끝날 때 그 파일만 한 번 묻고 다시 failed로 둔다
    useProjectStore.setState({ busy: true })
    useProjectStore.setState({ busy: false })
    await settle()
    expect(readPaths()).toEqual([[P + 'A.java', P + 'Bad.java'], [P + 'Bad.java']])
    expect(usage()).toMatchObject({ status: 'ready' })
    expect(usage().result?.files.failed).toEqual([P + 'Bad.java'])
    // 원인이 풀리면(목록의 크기·시각은 그대로) 다음 저장 끝에 읽어 사용처에 넣는다
    readJavaSources.mockReset()
    useProjectStore.setState({ busy: true })
    useProjectStore.setState({ busy: false })
    await settle()
    expect(readPaths().at(-1)).toEqual([P + 'Bad.java'])
    expect(usage().result?.files.failed).toEqual([])
    expect(hitsOf(LIFT)).toHaveLength(2)
  })

  it('다른 프로젝트를 열면 워커를 끝내고, 늦게 끝난 이전 읽기는 버리고 새로 읽는다', async () => {
    write('A.java', 'field liftLeft')
    holdReads = true
    await openProject('/p', 1)
    expect(held).toHaveLength(1)
    const first = worker()

    // 열기: 세션이 먼저 바뀌고(busy) 루트가 바뀐다. 끝나면 새 목록을 읽는다.
    useProjectStore.setState({ session: 2, busy: true })
    expect(first.terminated).toBe(true)
    useProjectStore.setState({ root: '/q' })
    expect(usage()).toMatchObject({ root: '/q', session: 2, status: 'scanning', result: null })
    useProjectStore.setState({ busy: false })
    held[0].release()
    await settle()
    // 이전 프로젝트의 읽기 결과는 어느 워커에도 넘기지 않는다
    expect(first.fileMessages).toHaveLength(0)
    expect(workers).toHaveLength(1)

    holdReads = false
    publishListing('/q')
    await settle()
    expect(workers).toHaveLength(2)
    expect(readJavaSources.mock.calls.at(-1)).toEqual(['/q', [P + 'A.java']])
    expect(usage()).toMatchObject({ root: '/q', session: 2, status: 'ready' })
  })

  it('같은 프로젝트를 다시 열어 목록이 그대로여도 열기가 끝나면 처음부터 다시 읽는다', async () => {
    write('A.java', 'field liftLeft')
    await openProject('/p', 1)
    readJavaSources.mockClear()
    useProjectStore.setState({ session: 2, busy: true })
    await settle()
    expect(readJavaSources).not.toHaveBeenCalled()
    useProjectStore.setState({ busy: false })
    await settle()
    expect(readPaths()).toEqual([[P + 'A.java']])
    expect(workers).toHaveLength(2)
    expect(usage()).toMatchObject({ session: 2, status: 'ready' })
  })

  it('워커가 멈추면 failed로 두고, 다음 변경에 새 워커로 처음부터 다시 읽는다', async () => {
    write('A.java', 'field liftLeft')
    write('B.java', 'field liftLeft')
    await openProject()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    worker().onerror?.({ message: 'out of memory' })
    expect(usage()).toMatchObject({ status: 'failed', detail: 'out of memory' })
    // 이전 결과는 흐리게 남는다
    expect(hitsOf(LIFT)).toHaveLength(2)
    expect(workers[0].terminated).toBe(true)

    readJavaSources.mockClear()
    await rename(['liftL'])
    expect(workers).toHaveLength(2)
    expect(readPaths()).toEqual([[P + 'A.java', P + 'B.java']])
    expect(usage().status).toBe('ready')
    error.mockRestore()
  })

  it('한 번의 다시 읽기에서 워커가 두 번 멈추면 다음 revision까지 다시 읽지 않는다', async () => {
    write('A.java', 'field liftLeft')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    setUsageWorkerFactory(() => {
      const created = new FakeWorker()
      created.crashOnMatch = true
      workers.push(created)
      return created
    })
    await openProject()
    // 처음 + 다시 한 번
    expect(workers).toHaveLength(2)
    expect(readJavaSources).toHaveBeenCalledTimes(2)
    expect(usage().status).toBe('failed')

    await rename(['liftL'])
    expect(workers).toHaveLength(2)
    expect(readJavaSources).toHaveBeenCalledTimes(2)

    setUsageWorkerFactory(() => {
      const created = new FakeWorker()
      workers.push(created)
      return created
    })
    write('A.java', 'field liftL', 2)
    publishListing()
    await settle()
    expect(usage().status).toBe('ready')
    expect(hitsOf(LIFT)).toHaveLength(1)
    error.mockRestore()
  })

  it('읽기에 실패하면 failed와 이유를 두고, 이름을 바꿔도 다시 읽지 않다가 다음 revision에 다시 읽는다', async () => {
    write('A.java', 'field liftLeft')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    readJavaSources.mockImplementationOnce(async () => ({
      ok: false,
      code: 'notAllowed',
      detail: 'untrusted root'
    }))
    await openProject()
    expect(usage()).toMatchObject({ status: 'failed', detail: 'untrusted root' })
    await rename(['liftL'])
    expect(readJavaSources).toHaveBeenCalledTimes(1)

    readJavaSources.mockImplementationOnce(() => Promise.reject(new Error('ipc down')))
    write('A.java', 'field liftL', 2)
    publishListing()
    await settle()
    expect(usage()).toMatchObject({ status: 'failed', detail: 'ipc down' })

    write('A.java', 'field liftL', 3)
    publishListing()
    await settle()
    expect(usage()).toMatchObject({ status: 'ready', detail: null })
    expect(hitsOf(LIFT)).toHaveLength(1)
    error.mockRestore()
  })

  it('읽는 중에 목록이 또 바뀌면 끝난 뒤 바뀐 파일만 한 번 더 읽는다', async () => {
    write('A.java', 'field liftLeft')
    write('B.java', 'field liftLeft')
    holdReads = true
    await openProject()
    write('B.java', 'nothing', 2)
    publishListing()
    publishListing()
    await settle()
    expect(held).toHaveLength(1)
    holdReads = false
    held[0].release()
    await settle()
    expect(readPaths()).toEqual([[P + 'A.java', P + 'B.java'], [P + 'B.java']])
    expect(hitsOf(LIFT).map((hit) => hit.path)).toEqual([P + 'A.java'])
  })

  it('다른 프로젝트를 연 뒤 끝낸 워커가 늦게 보낸 결과는 버린다', async () => {
    write('A.java', 'field liftLeft')
    await openProject('/p', 1)
    const first = worker()
    first.holdReplies = true
    await rename(['liftL'])
    expect(usage().status).toBe('scanning')
    useProjectStore.setState({ session: 2, busy: true })
    first.flush()
    // 끝낸 워커의 늦은 오류도 지금 상태를 바꾸지 않는다
    first.onerror?.({ message: 'late' })
    await settle()
    expect(usage()).toMatchObject({
      session: 2,
      status: 'scanning',
      result: null,
      resultSignature: null
    })
    useProjectStore.setState({ busy: false })
    await settle()
    expect(usage()).toMatchObject({ session: 2, status: 'ready' })
    expect(workers).toHaveLength(2)
  })

  it('마지막 맞추기의 답을 기다리는 사이 이름을 바꾸면 끝난 뒤 새 이름으로 한 번 더 맞춘다', async () => {
    write('A.java', 'field liftLeft')
    useProjectStore.setState({ root: '/p', session: 1, busy: false })
    await settle()
    setUsageWorkerFactory(() => {
      const created = new FakeWorker()
      created.holdReplies = true
      workers.push(created)
      return created
    })
    publishListing()
    await settle()
    expect(worker().matches).toHaveLength(1)
    await rename(['liftL'])
    expect(worker().matches).toHaveLength(1)
    worker().holdReplies = false
    worker().flush()
    await settle()
    expect(worker().matches).toHaveLength(2)
    expect(worker().matches[1].symbols.signature).toContain('liftL"')
    expect(usage().status).toBe('ready')
    expect(usage().resultSignature).toBe(worker().matches[1].symbols.signature)
  })

  it('TeamCode가 없어지면 noTeamCode로 두고, 이름을 바꿔도 이전 사실로 맞추지 않는다', async () => {
    write('A.java', 'field liftLeft')
    await openProject()
    const matches = worker().matches.length
    const { revision } = useJavaIndexStore.getState()
    useJavaIndexStore.setState({ status: 'noTeamCode', files: [], revision: revision + 1 })
    await settle()
    expect(usage().status).toBe('noTeamCode')
    await rename(['liftL'])
    expect(worker().matches).toHaveLength(matches)
    expect(usage().status).toBe('noTeamCode')

    // 다시 생기면 바뀐 것만 읽고 맞춘다
    readJavaSources.mockClear()
    publishListing()
    await settle()
    expect(readJavaSources).not.toHaveBeenCalled()
    expect(worker().matches).toHaveLength(matches + 1)
    expect(usage().status).toBe('ready')
  })

  it('읽는 사이에 새 목록이 오면 그 읽기가 실패해도 새 목록으로 다시 읽는다. 저장이 끝나도 다시 해 본다', async () => {
    write('A.java', 'field liftLeft')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail: (() => void) | null = null
    readJavaSources.mockImplementationOnce(
      () =>
        new Promise<ReadJavaSourcesResult>((resolve) => {
          fail = () => resolve({ ok: false, code: 'notAllowed', detail: 'busy' })
        })
    )
    await openProject()
    write('A.java', 'field liftLeft\nfield liftLeft', 2)
    publishListing()
    fail!()
    await settle()
    expect(readJavaSources).toHaveBeenCalledTimes(2)
    expect(usage().status).toBe('ready')
    expect(hitsOf(LIFT)).toHaveLength(2)

    // 실패한 revision 그대로면 막혀 있다가, 저장(busy)이 끝나면 다시 읽는다
    readJavaSources.mockImplementationOnce(async () => ({
      ok: false,
      code: 'notAllowed',
      detail: 'x'
    }))
    write('A.java', 'field liftLeft', 3)
    publishListing()
    await settle()
    expect(usage().status).toBe('failed')
    await rename(['liftLeft', 'arm'])
    expect(readJavaSources).toHaveBeenCalledTimes(3)
    useProjectStore.setState({ busy: true })
    useProjectStore.setState({ busy: false })
    await settle()
    expect(readJavaSources).toHaveBeenCalledTimes(4)
    expect(usage().status).toBe('ready')
    error.mockRestore()
  })

  describe('저장 뒤 확인', () => {
    it('저장한 씬의 기호로 맞춘 결과를 기다렸다가, 없는 이름·없앤 구성 이름을 알림 하나씩으로 띄운다', async () => {
      write('A.java', 'field liftLeft\nlookup liftLeft')
      write('B.java', 'lookup ghost\nlookup arm')
      useSceneStore.setState({ objects: scene(['liftLeft', 'arm']) })
      await openProject()
      const previous = useSceneStore.getState().objects

      // 이름을 바꾸고 묶음 시간 안에 저장했다(결과는 아직 이전 기호의 것)
      const saved = scene(['liftL', 'arm'])
      useSceneStore.setState({ objects: saved })
      useProjectStore.setState({ generation: SYNCED })
      const done = checkUsagesAfterSave(previous, saved)
      await settle()
      expect(noticeKeys()).toEqual([])

      vi.advanceTimersByTime(SYMBOLS_DEBOUNCE_MS)
      await done
      const notices = useNoticeStore.getState().notices
      expect(notices.map((n) => [n.level, n.key, n.params])).toEqual([
        ['warning', 'usagesBroken', { count: 1, files: 'A.java' }],
        // ghost는 이번 저장이 없앤 이름이 아니라 알리지 않는다
        ['warning', 'usagesBrokenByName', { count: 1, files: 'A.java' }]
      ])

      // 다시 저장하면 알림을 바꾼다(쌓지 않는다). 이름을 되돌리면 알림이 없다.
      const restored = scene(['liftLeft', 'arm'])
      useSceneStore.setState({ objects: restored })
      vi.advanceTimersByTime(SYMBOLS_DEBOUNCE_MS)
      await settle()
      await checkUsagesAfterSave(saved, restored)
      expect(noticeKeys()).toEqual([])
    })

    it('결과가 이미 저장한 씬의 것이면 다시 맞추지 않는다. 새 저장이 시작되면 이전 확인은 멈춘다', async () => {
      write('A.java', 'field liftLeft\nlookup liftL')
      await openProject()
      await rename(['liftL'])
      useProjectStore.setState({ generation: SYNCED })
      const saved = useSceneStore.getState().objects
      const matches = worker().matches.length
      await checkUsagesAfterSave(null, saved)
      expect(noticeKeys()).toEqual(['usagesBroken'])
      expect(worker().matches).toHaveLength(matches)

      // 아직 맞추지 않은 기호를 기다리는 확인은 다음 저장이 멈춘다(그 뒤 그 기호로 맞춰도 알리지 않는다)
      const first = checkUsagesAfterSave(saved, scene(['liftLL']))
      await settle()
      const second = checkUsagesAfterSave(saved, saved)
      await Promise.all([first, second])
      await rename(['liftLL'])
      expect(useNoticeStore.getState().notices.map((n) => [n.key, n.params])).toEqual([
        ['usagesBroken', { count: 1, files: 'A.java' }]
      ])
    })

    it('생성이 막히거나 실패한 저장은 확인하지 않고 이전 알림을 둔다', async () => {
      write('A.java', 'field liftLeft')
      await openProject()
      await rename(['liftL'])
      const saved = useSceneStore.getState().objects
      useProjectStore.setState({ generation: SYNCED })
      await checkUsagesAfterSave(null, saved)
      expect(noticeKeys()).toEqual(['usagesBroken'])

      useProjectStore.setState({ generation: { status: 'blocked', errors: 2 } })
      await checkUsagesAfterSave(saved, scene(['other']))
      expect(noticeKeys()).toEqual(['usagesBroken'])
      useProjectStore.setState({ generation: { status: 'failed', detail: 'x' } })
      await checkUsagesAfterSave(saved, scene(['other']))
      expect(noticeKeys()).toEqual(['usagesBroken'])

      // 프로젝트를 열면 알림 자리를 비운다(projectActions가 부른다)
      clearUsageNotices()
      expect(noticeKeys()).toEqual([])
    })

    it('기다리는 동안 다른 프로젝트를 열거나 찾을 수 없는 상태가 되면 알리지 않는다', async () => {
      write('A.java', 'field liftLeft')
      await openProject()
      useProjectStore.setState({ generation: SYNCED })
      const waiting = checkUsagesAfterSave(null, scene(['liftL']))
      useProjectStore.setState({ session: 2, busy: true })
      await waiting
      useProjectStore.setState({ busy: false })
      await rename(['liftL'])
      expect(noticeKeys()).toEqual([])

      await openProject('/p', 3)
      useProjectStore.setState({ generation: SYNCED })
      const failing = checkUsagesAfterSave(null, scene(['liftLL']))
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      worker().onerror?.({ message: 'boom' })
      await failing
      expect(noticeKeys()).toEqual([])
      error.mockRestore()
    })

    it('알림의 개수는 자르기 전 개수를 쓰고, 파일 이름은 3개까지 보인다', () => {
      const hit = (path: string): UsageHit => ({
        path,
        line: 1,
        col: 1,
        kind: 'unresolved',
        snippet: 'x',
        mark: [0, 1],
        member: 'x'
      })
      const result: UsageResult = {
        hits: new Map(),
        totals: new Map([
          [
            'r:robot',
            { field: 0, constant: 0, type: 0, new: 0, lookup: 0, text: 0, unresolved: 250 }
          ]
        ]),
        unresolved: new Map([
          ['r:robot', [hit('a/D.java'), hit('a/B.java'), hit('a/A.java'), hit('a/C.java')]],
          ['*', [hit('a/A.java')]]
        ]),
        unknownNames: new Map([['old', [hit('a/E.java'), hit('a/E.java')]]]),
        files: { scanned: 5, tooLarge: [], unicodeEscape: [], failed: [] }
      }
      expect(usageSaveNotices(result, new Set(['old']))).toEqual([
        ['warning', 'usagesBroken', { count: 251, files: 'A.java, B.java, C.java, …' }],
        ['warning', 'usagesBrokenByName', { count: 2, files: 'E.java' }]
      ])
      expect(usageSaveNotices(result, new Set())).toHaveLength(1)
    })
  })
})
