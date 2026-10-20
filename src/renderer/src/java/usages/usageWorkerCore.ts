// 사용처 워커의 논리(spec §7). 워커 진입점(usageWorker.ts)은 메시지를 이 함수에 넘기기만 한다.
// 순수 모듈이라 테스트와 가짜 워커가 같은 스레드에서 돌릴 수 있다(사실 만들기·맞추기 함수는 주입한다).
// - files: 파일마다 씬과 관계없는 사실을 만들어 경로 → {stamp, 사실, 문제}로 갖는다. 한 파일이 예외를 던져도
//   그 파일만 failed로 두고 계속한다.
// - match: 가진 사실을 지금 씬의 기호표로 맞춘다(파일을 다시 읽지 않는다). 너무 큰 파일·읽지 못한 파일은 여기서 채운다.
import { extractFacts, type FileFacts } from './usageFacts'
import { resolveUsages } from './usageResolve'
import type { FromWorker, ToWorker, UsageResult, UsageSymbols } from './usageTypes'

export type UsageWorkerDeps = {
  // intern은 워커의 글자 풀이다. 사실에 넣는 식별자·조각 글자를 이것으로 복사하면 파일 글자 전체를 붙잡지 않는다.
  // 받지 않는 구현(자기 풀을 쓰는 것)도 이 타입에 들어간다.
  extractFacts: (text: string, intern: (text: string) => string) => FileFacts
  resolveUsages: (files: ReadonlyMap<string, FileFacts>, symbols: UsageSymbols) => UsageResult
}

// 파일 하나. facts가 null이면 사실이 없다(problem이 이유: 너무 큼, 읽기·추출 실패).
type FileEntry = {
  stamp: string
  facts: FileFacts | null
  problem: 'tooLarge' | 'failed' | null
}

export type UsageWorkerState = {
  files: Map<string, FileEntry>
  // 글자 풀(같은 글자는 한 벌). 풀이 이만큼을 넘으면 새로 시작한다(사실이 쓰는 글자는 그대로 살아 있고, 겹친 글자를
  // 한 벌로 묶는 것만 처음부터 다시 한다). 파일을 고칠 때마다 조각 글자가 쌓여 끝없이 커지지 않게 한다.
  pool: Map<string, string>
  maxPoolEntries: number
  intern: (text: string) => string
  deps: UsageWorkerDeps
  // 경로 순서로 늘어놓은 사실(맞추기에 넘긴다). 파일이 바뀌면 다시 만든다. 이름만 바꿔 맞출 때는 그대로 쓴다.
  ordered: Map<string, FileFacts> | null
}

export const MAX_INTERN_ENTRIES = 500_000

export function createUsageWorkerState(
  deps: Partial<UsageWorkerDeps> = {},
  options: { maxPoolEntries?: number } = {}
): UsageWorkerState {
  const state: UsageWorkerState = {
    files: new Map(),
    pool: new Map(),
    maxPoolEntries: options.maxPoolEntries ?? MAX_INTERN_ENTRIES,
    intern: (text) => text,
    deps: { extractFacts, resolveUsages, ...deps },
    ordered: null
  }
  state.intern = (text) => {
    const pooled = state.pool.get(text)
    if (pooled !== undefined) return pooled
    // V8은 잘라 낸 글자가 원래 글자(파일 전체)를 붙잡는다. JSON을 거쳐 새 글자로 복사하고, 키도 복사본으로 둔다
    // (받은 글자를 키로 두면 키가 파일 글자를 붙잡는다).
    const copy = JSON.parse(JSON.stringify(text)) as string
    state.pool.set(copy, copy)
    return copy
  }
  return state
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function applyFiles(state: UsageWorkerState, message: Extract<ToWorker, { type: 'files' }>): void {
  if (state.pool.size > state.maxPoolEntries) state.pool = new Map()
  for (const path of message.removes) state.files.delete(path)
  for (const { path, stamp, text, problem } of message.upserts) {
    if (text === null) {
      state.files.set(path, { stamp, facts: null, problem: problem ?? 'failed' })
      continue
    }
    try {
      const facts = state.deps.extractFacts(text, state.intern)
      state.files.set(path, { stamp, facts, problem: null })
    } catch (error) {
      // 사실 만들기는 예외를 던지지 않아야 하지만, 던지면 그 파일만 읽지 못한 것으로 친다
      console.error('사용처: 파일의 사실을 만들지 못했다', path, error)
      state.files.set(path, { stamp, facts: null, problem: 'failed' })
    }
  }
  if (message.removes.length > 0 || message.upserts.length > 0) state.ordered = null
}

function orderedFacts(state: UsageWorkerState): Map<string, FileFacts> {
  if (!state.ordered) {
    state.ordered = new Map()
    for (const path of [...state.files.keys()].sort(compare)) {
      const facts = state.files.get(path)!.facts
      if (facts) state.ordered.set(path, facts)
    }
  }
  return state.ordered
}

function match(state: UsageWorkerState, symbols: UsageSymbols): UsageResult {
  const result = state.deps.resolveUsages(orderedFacts(state), symbols)
  // 맞추기가 돌려준 tooLarge는 사실의 한도를 넘은 파일(capped)이다. 읽기 결과의 너무 큰 파일과 합친다.
  const tooLarge: string[] = [...result.files.tooLarge]
  const failed: string[] = []
  for (const path of [...state.files.keys()].sort(compare)) {
    const { problem } = state.files.get(path)!
    if (problem === 'tooLarge') tooLarge.push(path)
    else if (problem === 'failed') failed.push(path)
  }
  return { ...result, files: { ...result.files, tooLarge: tooLarge.sort(compare), failed } }
}

// 메시지 하나를 처리하고 돌려줄 답을 만든다. 맞추기가 예외를 던지면 error로 답한다(스토어가 워커를 새로 만든다).
export function handleMessage(state: UsageWorkerState, message: ToWorker): FromWorker {
  switch (message.type) {
    case 'files':
      applyFiles(state, message)
      return { type: 'filesDone', batch: message.batch }
    case 'match':
      try {
        return { type: 'result', seq: message.seq, result: match(state, message.symbols) }
      } catch (error) {
        console.error('사용처: 맞추지 못했다', error)
        return { type: 'error', detail: errorText(error) }
      }
    default:
      return {
        type: 'error',
        detail: `unknown message: ${String((message as { type?: unknown }).type)}`
      }
  }
}
