// 사용처 스토어와 조율(spec §7): 언제 읽고, 무엇을 워커에 넘기고, 결과를 어떻게 두는지.
// - 프로젝트를 열고 TeamCode Java 목록(javaIndex)이 준비되면 모든 파일을, 그 뒤로는 목록의 크기·수정 시각(stamp)이
//   워커가 가진 것과 다른 파일만 메인(readJavaSources)에서 읽어 워커(usages/usageWorker.ts)에 넘긴다. 목록에서 빠진
//   파일은 워커에서도 뺀다. 워커는 파일마다 씬과 관계없는 사실을 가지므로, 씬에서 이름을 바꾸면 파일을 읽지 않고
//   기호표(usageSymbols)로 맞추기만 한다(씬 변경 뒤 200 ms 묶음, 끌기 중에는 기호표를 만들지 않는다).
// - refreshJavaIndex의 묶음에 넣지 않고 javaIndex 스토어를 구독한다(튜닝 값 다시 읽기가 이것을 기다리지 않게).
//   읽는 중에 온 요청은 모아서 끝난 뒤 한 번 더 한다(inFlight·again).
// - 다른 프로젝트를 열면(projectStore.session·root) 워커를 끝내고 처음부터 다시 읽는다. 늦게 온 읽기·결과는 버린다.
// - 저장해 생성 코드를 맞춘 뒤 저장 뒤의 파일을 저장한 씬으로 맞춘 결과에서 깨지는 곳을 찾아 경고 알림 하나(교체)를 띄운다.
import { create } from 'zustand'
import {
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_PATHS,
  MAX_USAGE_FILE_BYTES,
  type JavaSourceRead,
  type ReadJavaSourcesResult
} from '../../../shared/ipc'
import { dismissNotice, showNotice } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { ipcErrorDetail } from './ipcError'
import { useJavaIndexStore, type JavaIndexEntry } from './javaIndex'
import { lookupNamesOf, usageSymbols } from './usages/usageSymbols'
import type { FromWorker, ToWorker, UsageHit, UsageResult, UsageSymbols } from './usages/usageTypes'

// none: 프로젝트가 없다(임시 씬). noTeamCode: TeamCode 폴더가 없다. scanning: 찾는 중(이전 결과를 그대로 보인다).
// ready: 결과가 지금 씬·파일과 맞다. failed: 읽기·워커 실패(이전 결과를 흐리게 보인다).
export type UsageStatus = 'none' | 'noTeamCode' | 'scanning' | 'ready' | 'failed'

export type UsageIndexState = {
  status: UsageStatus
  root: string | null
  session: number
  result: UsageResult | null
  // result를 맞춘 기호표의 signature(지금 씬의 것과 같으면 최신)
  resultSignature: string | null
  // 찾을 때의 javaIndex.truncated(목록이 5000개 한도를 넘어 일부만 찾음)
  truncated: boolean
  // 마지막으로 열거나 생성 코드를 맞춘(synced) 저장의 씬(projectActions의 generatedObjects). 이름 바꾸기를 그 카드에
  // "이전 이름"으로 붙인다. 생성이 막히거나 실패한 저장은 디스크의 생성 코드·구성을 바꾸지 않으므로 옮기지 않는다.
  baseline: SceneObjects | null
  detail: string | null
}

export const INITIAL_USAGE_INDEX: UsageIndexState = {
  status: 'none',
  root: null,
  session: 0,
  result: null,
  resultSignature: null,
  truncated: false,
  baseline: null,
  detail: null
}

export const useUsageIndexStore = create<UsageIndexState>()(() => INITIAL_USAGE_INDEX)

// 씬이 바뀐 뒤 기호표를 만들기까지 기다리는 시간(ms). 이 사이에 또 바뀌면 다시 센다.
export const SYMBOLS_DEBOUNCE_MS = 200

// 워커 하나(테스트는 순수 함수로 만든 가짜를 넣는다)
export type UsageWorkerLike = {
  postMessage: (message: ToWorker) => void
  terminate: () => void
  onmessage: ((event: { data: FromWorker }) => void) | null
  onerror: ((event: unknown) => void) | null
}

function createBrowserWorker(): UsageWorkerLike {
  // Worker의 onmessage는 MessageEvent를 받는다(이쪽은 data만 쓴다)
  return new Worker(new URL('./usages/usageWorker.ts', import.meta.url), {
    type: 'module'
  }) as unknown as UsageWorkerLike
}

let createWorker: () => UsageWorkerLike = createBrowserWorker

// 테스트용: 워커를 만드는 함수를 바꾼다(지금 워커는 끝내고, 다음 읽기가 새로 만든다)
export function setUsageWorkerFactory(factory: () => UsageWorkerLike): void {
  createWorker = factory
  stopWorker()
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const stampOf = (file: { size: number; mtimeMs: number }): string => `${file.size}:${file.mtimeMs}`
const fileNameOfPath = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---- 워커 ----

let worker: UsageWorkerLike | null = null
// 워커가 가진 파일의 stamp(경로 → 'size:mtimeMs'). 워커를 끝내면 비운다(새 워커는 처음부터 다 읽는다).
const known = new Map<string, string>()

// 읽기 오류(failed)로 둔 파일이 있는가(그 stamp는 'failed:'로 시작해 목록과 같아지지 않는다)
function hasFailedReads(): boolean {
  for (const stamp of known.values()) if (stamp.startsWith('failed:')) return true
  return false
}
// 마지막 읽기가 목록의 파일을 끝까지 워커에 넘겼다. 아니면 이름을 바꿔도 맞추지 않는다(일부 사실로 맞추지 않게).
let complete = false
// 파일을 읽어 넘기는 중(그동안 온 맞추기 결과는 scanning으로 둔다)
let reading = false
// 이 javaIndex revision의 목록으로는 다시 읽지 않는다(읽기 실패, 한 번의 다시 읽기에서 워커가 두 번 멈춤).
// 목록이 바뀌거나(새 revision) 열기·저장이 끝나면 다시 해 본다. 그사이 이름을 바꿔도 다시 읽지 않는다.
let blockedRevision: number | null = null
// 워커에 보낸 파일 묶음의 순번(워커의 사실이 바뀔 때마다 오른다)
let batchSeq = 0
let matchSeq = 0
let appliedSeq = 0
// 스토어의 결과를 맞출 때의 batchSeq(지금 batchSeq와 같으면 결과가 워커의 지금 사실로 맞춘 것이다). 워커를 끝내면 -1.
let resultBatch = -1
// 마지막으로 보낸 맞추기의 기호 signature(같으면 다시 맞추지 않는다)
let postedSignature: string | null = null
// 답을 기다리는 맞추기: seq → 그 기호의 signature, 보낼 때의 batchSeq, 결과를 스토어에 둘지(저장 확인의 맞추기는
// 받기만 한다), 끝났을 때(결과, 워커가 끝났으면 null)
type PendingMatch = {
  signature: string
  batch: number
  store: boolean
  finish: (result: UsageResult | null) => void
}
const pendingMatches = new Map<number, PendingMatch>()
// 결과와 함께 두는 목록의 truncated(마지막으로 읽을 때의 것)
let scanTruncated = false

// 스토어에 둘 맞추기의 답을 기다린다(그동안은 scanning)
function storeMatchPending(): boolean {
  for (const pending of pendingMatches.values()) if (pending.store) return true
  return false
}

function stopWorker(): void {
  worker?.terminate()
  worker = null
  known.clear()
  complete = false
  postedSignature = null
  resultBatch = -1
  const pending = [...pendingMatches.values()]
  pendingMatches.clear()
  for (const { finish } of pending) finish(null)
}

function eventDetail(event: unknown): string {
  if (event && typeof event === 'object' && 'message' in event && typeof event.message === 'string')
    return event.message || 'worker error'
  return 'worker error'
}

function ensureWorker(): UsageWorkerLike {
  if (worker) return worker
  const created = createWorker()
  worker = created
  // 끝낸 워커가 늦게 보낸 답은 받지 않는다
  created.onmessage = (event) => {
    if (worker === created) onWorkerMessage(event.data)
  }
  created.onerror = (event) => {
    if (worker === created) workerFailed(eventDetail(event))
  }
  return created
}

// 워커가 멈췄다(error 답 또는 onerror). 끝내고 처음부터 다시 읽게 한다. 이전 결과는 흐리게 남긴다.
function workerFailed(detail: string): void {
  console.error('사용처 워커가 멈췄다', detail)
  stopWorker()
  useUsageIndexStore.setState({ status: 'failed', detail })
}

function onWorkerMessage(message: FromWorker): void {
  if (message.type === 'filesDone') return
  if (message.type === 'error') {
    workerFailed(message.detail)
    return
  }
  const pending = pendingMatches.get(message.seq)
  pendingMatches.delete(message.seq)
  // 워커는 받은 순서대로 답하지만, 더 새 결과를 이미 반영했으면 버린다
  if (pending?.store && message.seq > appliedSeq) {
    appliedSeq = message.seq
    resultBatch = pending.batch
    const current = useUsageIndexStore.getState()
    useUsageIndexStore.setState({
      result: message.result,
      resultSignature: pending.signature,
      truncated: scanTruncated,
      // 아직 읽는 중이거나 더 새 맞추기를 기다리면 scanning. 읽기가 끝까지 가지 못했으면(실패) 그 상태를 둔다.
      status: reading || storeMatchPending() ? 'scanning' : complete ? 'ready' : current.status,
      detail: complete ? null : current.detail
    })
  }
  pending?.finish(message.result)
}

// 지금 씬의 기호표. 만들지 못하면(코드 생성 쪽 버그) failed로 두고 null.
function currentSymbols(): UsageSymbols | null {
  try {
    return usageSymbols(useSceneStore.getState().objects)
  } catch (error) {
    console.error('사용처 기호표를 만들지 못했다', error)
    useUsageIndexStore.setState({ status: 'failed', detail: errorText(error) })
    return null
  }
}

// 지금 씬의 기호로 맞춘다. 워커는 메시지를 순서대로 처리하므로 그 전에 보낸 파일의 사실로 맞춘다.
function postMatch(): Promise<boolean> {
  const target = worker
  if (!target) return Promise.resolve(false)
  const symbols = currentSymbols()
  if (!symbols) return Promise.resolve(false)
  const seq = ++matchSeq
  postedSignature = symbols.signature
  useUsageIndexStore.setState({ status: 'scanning' })
  return new Promise((resolve) => {
    pendingMatches.set(seq, {
      signature: symbols.signature,
      batch: batchSeq,
      store: true,
      finish: (result) => resolve(result !== null)
    })
    target.postMessage({ type: 'match', seq, symbols })
  })
}

// 파일은 그대로이고 기호만 바뀌었으면 맞추기만 한다(읽지 않는다)
function rematchIfChanged(): void {
  if (!complete || !worker || inFlight) return
  const symbols = currentSymbols()
  if (symbols && symbols.signature !== postedSignature) void postMatch()
}

// ---- 프로젝트 ----

// 저장 뒤 확인의 순번. 새로 생성 코드를 맞춘 저장과 다른 프로젝트 열기가 올려, 기다리던 이전 확인을 멈춘다.
let saveToken = 0
// 생성 코드를 맞춘 저장들이 디스크 구성에서 없앤 찾기 이름(이 프로젝트를 연 뒤로). 다음 저장이 그 이름을 다시 넣으면
// 뺀다. 바꾼 것 없이 다시 저장해도 아직 깨진 이름 알림을 지우지 않게 한다(이번 저장만 비교하면 없앤 이름이 없다).
let removedLookupNames = new Set<string>()

// 스토어를 이 프로젝트(root·session) 것으로 맞춘다. 바뀌었으면 워커를 끝내고 결과를 비운다(기준 씬도 비운다.
// projectActions가 경로를 고친 뒤 다시 넣는다).
function syncScope(root: string | null, session: number): void {
  const state = useUsageIndexStore.getState()
  if (state.root === root && state.session === session) return
  stopWorker()
  blockedRevision = null
  saveToken++
  removedLookupNames = new Set()
  useUsageIndexStore.setState({
    ...INITIAL_USAGE_INDEX,
    root,
    session,
    status: root ? 'scanning' : 'none'
  })
}

// ---- 읽기 ----

let inFlight: Promise<void> | null = null
// 읽는 중에 다시 요청이 왔다(끝나면 한 번 더 한다)
let again = false
// 읽는 중에 씬 기호가 바뀌었을 수 있다(끝나면 기호를 비교해 맞춘다)
let matchAgain = false

// 목록과 워커가 가진 파일을 맞추고 결과를 다시 만든다. 이미 하는 중이면 그것이 끝난 뒤 한 번 더 하고 같은 약속을
// 돌려준다(요청을 모은다).
export function refreshUsages(): Promise<void> {
  if (inFlight) {
    again = true
    return inFlight
  }
  inFlight = (async () => {
    try {
      do {
        again = false
        try {
          await refreshOnce()
        } catch (error) {
          console.error('사용처를 찾지 못했다', error)
          useUsageIndexStore.setState({ status: 'failed', detail: errorText(error) })
        }
      } while (again)
    } finally {
      inFlight = null
    }
    if (matchAgain) {
      matchAgain = false
      rematchIfChanged()
    }
  })()
  return inFlight
}

async function refreshOnce(): Promise<void> {
  const { root, session } = useProjectStore.getState()
  syncScope(root, session)
  if (!root) return
  const index = useJavaIndexStore.getState()
  // 이 프로젝트의 목록을 아직 읽지 못했다(읽으면 javaIndex 구독이 다시 부른다)
  if (index.root !== root || index.status === 'none' || index.status === 'loading') return
  if (index.status === 'noTeamCode' || index.status === 'failed') {
    // 워커의 사실은 두지만 목록과 맞는지 모르므로, 다시 목록이 생길 때까지 이름을 바꿔도 맞추지 않는다
    complete = false
    useUsageIndexStore.setState({ status: index.status, detail: null })
    return
  }
  if (blockedRevision === index.revision) return
  // 워커가 멈추면 새 워커로 처음부터 한 번 더 읽는다. 같은 다시 읽기에서 또 멈추면 다음 revision까지 기다린다.
  for (let attempt = 0; attempt < 2; attempt++) {
    const outcome = await scan(root, session, index)
    if (outcome !== 'crashed') return
  }
  blockedRevision = index.revision
}

type ScanOutcome = 'done' | 'stale' | 'failed' | 'crashed'
type Upsert = Extract<ToWorker, { type: 'files' }>['upserts'][number]

async function scan(
  root: string,
  session: number,
  index: { files: readonly JavaIndexEntry[]; truncated: boolean; revision: number }
): Promise<ScanOutcome> {
  const { files: listing, truncated } = index
  const target = ensureWorker()
  const stale = (): boolean => {
    const project = useProjectStore.getState()
    return project.root !== root || project.session !== session
  }
  const crashed = (): boolean => worker !== target
  const readFailed = (detail: string): ScanOutcome => {
    console.error('사용처: TeamCode Java를 읽지 못했다', detail)
    blockedRevision = index.revision
    useUsageIndexStore.setState({ status: 'failed', detail })
    return 'failed'
  }

  const listed = new Map<string, JavaIndexEntry>()
  for (const entry of listing) listed.set(entry.path, entry)
  let queue = listing.filter((entry) => known.get(entry.path) !== stampOf(entry)).map((e) => e.path)
  let removes = [...known.keys()].filter((path) => !listed.has(path))
  scanTruncated = truncated

  if (queue.length === 0 && removes.length === 0 && complete) {
    // 파일이 그대로면 기호가 바뀌었을 때만 맞춘다
    const symbols = currentSymbols()
    if (!symbols) return 'failed'
    if (symbols.signature === postedSignature) {
      if (!storeMatchPending())
        useUsageIndexStore.setState({ status: 'ready', truncated, detail: null })
      return 'done'
    }
  } else {
    complete = false
    reading = true
    useUsageIndexStore.setState({ status: 'scanning' })
    try {
      let next = 0
      while (next < queue.length) {
        // 한 번에 MAX_SOURCE_PATHS개, 목록 크기로 MAX_SOURCE_BATCH_BYTES까지(너무 큰 파일은 글자 없이 온다)
        const batch: string[] = []
        let bytes = 0
        while (next < queue.length && batch.length < MAX_SOURCE_PATHS) {
          const size = listed.get(queue[next])?.size ?? 0
          const counted = size > MAX_USAGE_FILE_BYTES ? 0 : size
          if (batch.length > 0 && bytes + counted > MAX_SOURCE_BATCH_BYTES) break
          batch.push(queue[next++])
          bytes += counted
        }
        let response: ReadJavaSourcesResult
        try {
          response = await window.api.readJavaSources(root, batch)
        } catch (error) {
          if (stale()) return 'stale'
          return readFailed(ipcErrorDetail(error))
        }
        if (stale()) return 'stale'
        if (crashed()) return 'crashed'
        if (!response.ok) return readFailed(response.detail || response.code)

        const answered = new Map<string, JavaSourceRead>()
        for (const file of response.files) answered.set(file.path, file)
        const upserts: Upsert[] = []
        const missing: string[] = []
        const deferred: string[] = []
        // 워커에 넘긴 뒤 known에 둘 stamp(null: 지운다)
        const stamps = new Map<string, string | null>()
        for (const path of batch) {
          const file = answered.get(path)
          switch (file?.status) {
            case 'ok':
              upserts.push({ path, stamp: stampOf(file), text: file.text })
              stamps.set(path, stampOf(file))
              break
            case 'tooLarge':
              // 크기·시각은 읽은 핸들의 것이다(ok와 같이 다음 목록과 비교한다)
              upserts.push({ path, stamp: stampOf(file), text: null, problem: 'tooLarge' })
              stamps.set(path, stampOf(file))
              break
            case 'missing':
              // 목록을 읽은 뒤 지워졌다. 워커에서도 빼고, 다음 목록에 있으면 다시 읽는다.
              missing.push(path)
              stamps.set(path, null)
              break
            case 'notAllowed': {
              // 받지 않는 경로가 된 파일(밖을 가리키게 된 링크 등)은 목록의 stamp로 둔다(바뀌기 전에는 다시 읽지 않는다)
              const stamp = stampOf(listed.get(path)!)
              upserts.push({ path, stamp, text: null, problem: 'failed' })
              stamps.set(path, stamp)
              break
            }
            case 'failed': {
              // 읽기 오류(잠금, 오프라인 OneDrive 파일, 권한 등)는 원인이 풀려도 크기·시각이 그대로일 수 있다. 목록의
              // stamp와 같아질 수 없는 값으로 두어 다음 읽기(새 revision, 열기·저장 끝)에 그 파일만 다시 읽는다.
              // known에서 지우지는 않는다(목록에서 빠지면 removes로 워커에서도 빼야 한다).
              const stamp = stampOf(listed.get(path)!)
              upserts.push({ path, stamp, text: null, problem: 'failed' })
              stamps.set(path, `failed:${stamp}`)
              break
            }
            default:
              // deferred(이번 묶음의 바이트 한도), 또는 답이 없는 경로
              deferred.push(path)
          }
        }
        // 메인은 한 번에 적어도 하나를 읽는다. 하나도 못 읽었으면 같은 묶음을 계속 묻지 않는다.
        if (deferred.length === batch.length) return readFailed('deferred')
        target.postMessage({
          type: 'files',
          batch: ++batchSeq,
          upserts,
          removes: [...removes, ...missing]
        })
        for (const path of removes) known.delete(path)
        removes = []
        for (const [path, stamp] of stamps) {
          if (stamp === null) known.delete(path)
          else known.set(path, stamp)
        }
        // 미룬 경로는 앞에 다시 둔다
        if (deferred.length > 0) {
          queue = [...deferred, ...queue.slice(next)]
          next = 0
        }
      }
      if (removes.length > 0) {
        target.postMessage({ type: 'files', batch: ++batchSeq, upserts: [], removes })
        for (const path of removes) known.delete(path)
      }
      complete = true
    } finally {
      reading = false
    }
  }
  const matched = await postMatch()
  if (stale()) return 'stale'
  if (crashed()) return 'crashed'
  return matched ? 'done' : 'failed'
}

// ---- 씬 변경 ----

let symbolsTimer: ReturnType<typeof setTimeout> | null = null

// 씬이 바뀐 뒤 묶음 시간이 지났다. 기호가 바뀌었으면 맞추기만 한다(파일을 읽지 않는다).
function modelChanged(): void {
  symbolsTimer = null
  const { root, session } = useProjectStore.getState()
  const state = useUsageIndexStore.getState()
  if (!root || state.root !== root || state.session !== session) return
  // 읽는 중이면 그 마지막 맞추기가 지금 기호를 쓰고, 끝난 뒤 한 번 더 비교한다
  if (inFlight) {
    matchAgain = true
    return
  }
  if (complete) rematchIfChanged()
  // 워커가 멈춘 뒤에는 처음부터 다시 읽는다(읽기 실패는 refreshOnce가 다음 revision까지 막는다)
  else void refreshUsages()
}

let initialized = false

// 프로젝트 세션을 시작할 때 한 번(initProjectSession). javaIndex·sceneStore·projectStore를 구독한다.
export function initUsageIndex(): void {
  if (initialized) return
  initialized = true

  useProjectStore.subscribe((state, previous) => {
    const scopeChanged = state.root !== previous.root || state.session !== previous.session
    if (scopeChanged) syncScope(state.root, state.session)
    // 열기·저장 중에는 읽지 않는다(여는 동안 세션이 루트보다 먼저 바뀐다). 끝나면 읽는다: 같은 프로젝트를 다시
    // 열어 목록이 그대로면 javaIndex revision이 오르지 않는다. 열기·저장이 끝나면 읽기 실패도 다시 해 본다.
    if (state.busy) return
    if (previous.busy) blockedRevision = null
    if (scopeChanged || previous.busy) void refreshUsages()
  })

  useJavaIndexStore.subscribe((state, previous) => {
    if (
      state.revision === previous.revision &&
      state.status === previous.status &&
      state.root === previous.root
    ) {
      // 목록은 그대로지만 다시 읽었다(창 포커스 등). 읽기 오류가 난 파일(잠금이 풀림 등)만 다시 읽어 본다.
      if (state.listedAt !== previous.listedAt && hasFailedReads()) void refreshUsages()
      return
    }
    void refreshUsages()
  })

  // 핸들을 끄는 동안에도 문서는 프레임마다 바뀌므로, 기호표는 바뀐 뒤 묶음 시간이 지나서야 만든다
  useSceneStore.subscribe((state, previous) => {
    if (state.objects === previous.objects) return
    if (symbolsTimer) clearTimeout(symbolsTimer)
    symbolsTimer = setTimeout(modelChanged, SYMBOLS_DEBOUNCE_MS)
  })
}

// 이름 바꾸기를 붙일 기준 씬(열 때 경로를 고친 뒤, 생성 코드를 맞춘 저장 뒤)
export function setUsageBaseline(objects: SceneObjects | null): void {
  useUsageIndexStore.setState({ baseline: objects })
}

// ---- 저장 뒤 확인 ----

// 저장할 때마다 바꾸는 알림 자리(쌓이지 않게). 다른 프로젝트를 열면 비운다.
let usageNotices: number[] = []

export function replaceUsageNotices(notices: Parameters<typeof showNotice>[]): void {
  for (const id of usageNotices) dismissNotice(id)
  usageNotices = notices.map((notice) => showNotice(...notice))
}

export function clearUsageNotices(): void {
  replaceUsageNotices([])
}

const MAX_NOTICE_FILES = 3

// 알림에 넣는 파일 이름(경로 순서로 3개까지, 더 있으면 …)
function noticeFiles(hits: readonly UsageHit[]): string {
  const paths = [...new Set(hits.map((hit) => hit.path))].sort(compare)
  const names = paths.slice(0, MAX_NOTICE_FILES).map(fileNameOfPath)
  if (paths.length > MAX_NOTICE_FILES) names.push('…')
  return names.join(', ')
}

// 저장한 씬으로 맞춘 결과 → 알림. 생성 코드에 없는 이름(javac가 다음 빌드에서 알릴 것)은 모두 세고,
// 구성에 없는 찾기 이름은 이번 저장이 없앤 이름만 센다(SandBot에 넣지 않은 장치의 이름은 알리지 않는다).
export function usageSaveNotices(
  result: UsageResult,
  removedNames: ReadonlySet<string>
): Parameters<typeof showNotice>[] {
  const notices: Parameters<typeof showNotice>[] = []
  const typedHits: UsageHit[] = []
  let typed = 0
  for (const [key, hits] of result.unresolved) {
    typedHits.push(...hits)
    // 한도로 잘랐으면 자르기 전의 개수
    typed += Math.max(hits.length, result.totals.get(key)?.unresolved ?? 0)
  }
  if (typed > 0)
    notices.push(['warning', 'usagesBroken', { count: typed, files: noticeFiles(typedHits) }])
  const byNameHits: UsageHit[] = []
  for (const [name, hits] of result.unknownNames)
    if (removedNames.has(name)) byNameHits.push(...hits)
  if (byNameHits.length > 0)
    notices.push([
      'warning',
      'usagesBrokenByName',
      { count: byNameHits.length, files: noticeFiles(byNameHits) }
    ])
  return notices
}

// 워커의 지금 사실을 이 기호로 맞춘 결과. 읽는 중이면 끝나기를 기다린다. 스토어의 결과가 이미 그것이면(같은 기호,
// 그 뒤로 넘긴 파일 없음) 그대로 쓰고, 아니면 따로 맞춰 받기만 한다(스토어는 지금 씬의 결과로 둔다).
// 워커가 목록의 파일을 끝까지 갖고 있지 않으면(읽기 실패, TeamCode 없음, 워커 멈춤) null.
async function matchFor(symbols: UsageSymbols): Promise<UsageResult | null> {
  while (inFlight) await inFlight
  const target = worker
  if (!target || !complete) return null
  const { result, resultSignature } = useUsageIndexStore.getState()
  if (result && resultSignature === symbols.signature && resultBatch === batchSeq) return result
  const seq = ++matchSeq
  return new Promise((resolve) => {
    pendingMatches.set(seq, {
      signature: symbols.signature,
      batch: batchSeq,
      store: false,
      finish: resolve
    })
    target.postMessage({ type: 'match', seq, symbols })
  })
}

// 저장해 생성 코드를 맞춘 뒤(generation synced): 저장 뒤 파일을 저장한 씬으로 맞춘 결과에서 깨지는 곳이 있으면
// 경고 알림 하나.
// - previous는 그 전에 생성 코드를 맞춘(또는 연) 씬(없으면 null)이다. 이번 저장이 없앤 구성 이름을 그것과 비교해 찾고,
//   이 프로젝트를 연 뒤 앞선 저장이 없앤 이름(removedLookupNames, 다시 넣은 것은 뺌)도 함께 센다.
// - listed는 저장 뒤 TeamCode Java 목록을 다시 읽는 약속(projectActions의 refreshJavaIndex)이다. 그 목록으로 바뀐
//   파일(저장이 쓴 튜닝 값, 저장 직전 다른 편집기에서 고친 파일)을 워커에 넘긴 뒤 맞춘다. 저장 전 사실로 판정하지 않는다.
// - 스토어의 지금 상태(failed 등)는 보지 않는다. 그 뒤 읽기가 끝까지 가지 못했을 때만(TeamCode 없음, 읽기 실패, 워커
//   멈춤) 알리지 않고 이전 알림을 둔다. 그사이 이름을 또 바꿔도 저장한 씬의 기호로 맞춘다.
// - 새로 생성 코드를 맞춘 저장이나 다른 프로젝트 열기가 기다리는 확인을 멈춘다.
// 생성이 막혔거나 실패했으면 하지 않는다(projectActions도 synced일 때만 부른다). 디스크에는 이전 클래스가 그대로라
// 이전 알림·기다리는 확인도 그대로 둔다.
export async function checkUsagesAfterSave(
  previous: SceneObjects | null,
  saved: SceneObjects,
  listed: Promise<unknown>
): Promise<void> {
  if (useProjectStore.getState().generation?.status !== 'synced') return
  const token = ++saveToken
  const { root, session } = useProjectStore.getState()
  if (!root) return
  const current = (): boolean => {
    const project = useProjectStore.getState()
    return token === saveToken && project.root === root && project.session === session
  }
  let removedNames: Set<string>
  let symbols: UsageSymbols
  try {
    const savedNames = lookupNamesOf(saved)
    // 이전 저장들이 없앤 이름 + 이번 저장이 없앤 이름, 이번에 다시 넣은 이름은 뺀다
    removedNames = new Set(
      [...removedLookupNames, ...(previous ? lookupNamesOf(previous).keys() : [])].filter(
        (name) => !savedNames.has(name)
      )
    )
    removedLookupNames = removedNames
    symbols = usageSymbols(saved)
  } catch (error) {
    console.error('사용처: 저장한 씬의 기호표를 만들지 못했다', error)
    return
  }
  try {
    await listed
  } catch (error) {
    // 목록을 읽지 못했으면 javaIndex가 failed로 둔다(아래 읽기가 끝까지 가지 못해 알리지 않는다)
    console.error('사용처: 저장 뒤 TeamCode Java 목록을 읽지 못했다', error)
  }
  if (!current()) return
  // 목록이 바뀌었으면 javaIndex 구독이 이미 읽기 시작했다. 아니면 지금 목록과 한 번 맞춰 본다(읽기 실패한 파일 등).
  await (inFlight ?? refreshUsages())
  if (!current()) return
  const result = await matchFor(symbols)
  if (!result || !current()) return
  // 이전 저장의 알림을 바꾼다(깨지는 곳이 없으면 지운다). 확인을 멈추면 이전 알림은 그대로 둔다.
  replaceUsageNotices(usageSaveNotices(result, removedNames))
}

// 테스트용: 모듈 상태(워커, 읽은 stamp, 기다리는 확인, 알림 자리)와 스토어를 처음으로 되돌린다
export function resetUsageIndexState(): void {
  if (symbolsTimer) clearTimeout(symbolsTimer)
  symbolsTimer = null
  stopWorker()
  saveToken++
  removedLookupNames = new Set()
  blockedRevision = null
  reading = false
  inFlight = null
  again = false
  matchAgain = false
  batchSeq = 0
  matchSeq = 0
  appliedSeq = 0
  usageNotices = []
  useUsageIndexStore.setState(INITIAL_USAGE_INDEX, true)
}
