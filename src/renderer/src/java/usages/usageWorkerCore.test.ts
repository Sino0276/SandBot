import { describe, expect, it, vi } from 'vitest'
import type { FileFacts } from './usageFacts'
import type { FromWorker, ToWorker, UsageResult, UsageSymbols } from './usageTypes'
import { createUsageWorkerState, handleMessage, type UsageWorkerDeps } from './usageWorkerCore'

// 사실 만들기·맞추기는 주입한 가짜다(진짜는 usageFacts·usageResolve 테스트가 본다). 가짜 사실은 글자를 그대로 담는다.
type FakeFacts = { text: string }
const factsText = (facts: FileFacts): string => (facts as unknown as FakeFacts).text

const symbols: UsageSymbols = { robots: [], unavailable: [], lookupNames: [], signature: 's' }

function emptyResult(files: ReadonlyMap<string, FileFacts>): UsageResult {
  return {
    hits: new Map(),
    totals: new Map(),
    fileTotals: new Map(),
    unresolved: new Map(),
    unknownNames: new Map(),
    files: { scanned: files.size, tooLarge: [], unicodeEscape: [], failed: [] }
  }
}

function setup(overrides: Partial<UsageWorkerDeps> = {}): {
  state: ReturnType<typeof createUsageWorkerState>
  extractFacts: ReturnType<typeof vi.fn<UsageWorkerDeps['extractFacts']>>
  resolveUsages: ReturnType<typeof vi.fn<UsageWorkerDeps['resolveUsages']>>
} {
  const extractFacts = vi.fn<UsageWorkerDeps['extractFacts']>((text) => {
    if (text.includes('THROW')) throw new Error('bad file')
    return { text } as unknown as FileFacts
  })
  const resolveUsages = vi.fn<UsageWorkerDeps['resolveUsages']>(emptyResult)
  const state = createUsageWorkerState({ extractFacts, resolveUsages, ...overrides })
  return { state, extractFacts, resolveUsages }
}

const files = (
  upserts: Extract<ToWorker, { type: 'files' }>['upserts'],
  removes: string[] = [],
  batch = 1
): ToWorker => ({ type: 'files', batch, upserts, removes })
const matchMessage = (seq = 1): ToWorker => ({ type: 'match', seq, symbols })

function resultOf(reply: FromWorker): UsageResult {
  if (reply.type !== 'result') throw new Error(`expected result, got ${reply.type}`)
  return reply.result
}

describe('사용처 워커', () => {
  it('파일마다 사실을 만들고, 맞추기에는 경로 순서로 사실이 있는 파일과 사실이 없는 파일의 경로를 넘긴다', () => {
    const { state, extractFacts, resolveUsages } = setup()
    expect(
      handleMessage(
        state,
        files([
          { path: 'b/B.java', stamp: '1:1', text: 'class B {}' },
          { path: 'a/A.java', stamp: '1:1', text: 'class A {}' },
          { path: 'c/Big.java', stamp: '9:1', text: null, problem: 'tooLarge' }
        ])
      )
    ).toEqual({ type: 'filesDone', batch: 1 })
    expect(extractFacts).toHaveBeenCalledTimes(2)
    const result = resultOf(handleMessage(state, matchMessage(7)))
    const passed = resolveUsages.mock.calls[0][0]
    expect([...passed.keys()]).toEqual(['a/A.java', 'b/B.java'])
    expect(factsText(passed.get('a/A.java')!)).toBe('class A {}')
    expect(resolveUsages.mock.calls[0][1]).toBe(symbols)
    // 사실이 없는 파일은 경로만 넘긴다(맞추기가 그 이름의 자리 클래스를 둔다)
    expect(resolveUsages.mock.calls[0][2]).toEqual(['c/Big.java'])
    expect(result.files).toEqual({
      scanned: 2,
      tooLarge: ['c/Big.java'],
      unicodeEscape: [],
      failed: []
    })
  })

  it('답에는 받은 묶음 번호와 맞추기 번호를 그대로 돌려준다', () => {
    const { state } = setup()
    expect(handleMessage(state, files([], [], 42))).toEqual({ type: 'filesDone', batch: 42 })
    const reply = handleMessage(state, matchMessage(9))
    expect(reply.type === 'result' && reply.seq).toBe(9)
  })

  it('한 파일이 예외를 던져도 그 파일만 failed로 두고 나머지는 계속한다', () => {
    const { state, resolveUsages } = setup()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    handleMessage(
      state,
      files([
        { path: 'A.java', stamp: '1:1', text: 'THROW' },
        { path: 'B.java', stamp: '1:1', text: 'ok' },
        // 메인이 읽지 못한 파일(글자 없음, 이유 없음)도 failed
        { path: 'C.java', stamp: '1:1', text: null }
      ])
    )
    error.mockRestore()
    const result = resultOf(handleMessage(state, matchMessage()))
    expect(result.files.failed).toEqual(['A.java', 'C.java'])
    expect(result.files.scanned).toBe(1)
    expect(resolveUsages.mock.calls[0][2]).toEqual(['A.java', 'C.java'])
  })

  it('지운 경로는 사실을 버리고, 다시 받은 파일은 새 사실로 바꾼다', () => {
    const { state, resolveUsages } = setup()
    handleMessage(
      state,
      files([
        { path: 'A.java', stamp: '1:1', text: 'v1' },
        { path: 'B.java', stamp: '1:1', text: 'b' },
        { path: 'C.java', stamp: '1:1', text: null, problem: 'tooLarge' }
      ])
    )
    handleMessage(
      state,
      files([{ path: 'A.java', stamp: '2:2', text: 'v2' }], ['B.java', 'C.java'])
    )
    const result = resultOf(handleMessage(state, matchMessage()))
    const passed = resolveUsages.mock.calls[0][0]
    expect([...passed.keys()]).toEqual(['A.java'])
    expect(factsText(passed.get('A.java')!)).toBe('v2')
    expect(state.files.get('A.java')?.stamp).toBe('2:2')
    expect(result.files.tooLarge).toEqual([])
  })

  it('파일이 그대로면 이름만 바꿔 맞출 때 같은 사실 목록을 다시 쓴다', () => {
    const { state, resolveUsages } = setup()
    handleMessage(state, files([{ path: 'A.java', stamp: '1:1', text: 'a' }]))
    handleMessage(state, matchMessage(1))
    handleMessage(state, matchMessage(2))
    expect(resolveUsages.mock.calls[1][0]).toBe(resolveUsages.mock.calls[0][0])
    handleMessage(state, files([{ path: 'B.java', stamp: '1:1', text: 'b' }]))
    handleMessage(state, matchMessage(3))
    expect(resolveUsages.mock.calls[2][0]).not.toBe(resolveUsages.mock.calls[0][0])
    expect([...resolveUsages.mock.calls[2][0].keys()]).toEqual(['A.java', 'B.java'])
  })

  it('맞추기가 예외를 던지면 error로 답한다(스토어가 워커를 새로 만든다)', () => {
    const { state } = setup({
      resolveUsages: () => {
        throw new Error('resolver bug')
      }
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(handleMessage(state, matchMessage())).toEqual({ type: 'error', detail: 'resolver bug' })
    expect(handleMessage(state, { type: 'nope' } as unknown as ToWorker).type).toBe('error')
    error.mockRestore()
  })

  it('사실 만들기에 글자 풀(intern)을 넘긴다: 같은 글자는 한 벌이고, 한도를 넘으면 풀을 새로 시작한다', () => {
    const seen: string[] = []
    const state = createUsageWorkerState(
      {
        extractFacts: (text, intern) => {
          for (const word of text.split(' ')) seen.push(intern(word))
          return {} as FileFacts
        },
        resolveUsages: emptyResult
      },
      { maxPoolEntries: 3 }
    )
    handleMessage(state, files([{ path: 'A.java', stamp: '1:1', text: 'lift lift arm claw' }]))
    expect(seen).toEqual(['lift', 'lift', 'arm', 'claw'])
    expect([...state.pool.keys()]).toEqual(['lift', 'arm', 'claw'])
    // 한도(3)는 묶음을 시작할 때 본다. 이 묶음 안에서는 넘어도 그대로 쓴다.
    handleMessage(state, files([{ path: 'B.java', stamp: '1:1', text: 'drive arm' }]))
    expect([...state.pool.keys()]).toEqual(['lift', 'arm', 'claw', 'drive'])
    handleMessage(state, files([{ path: 'C.java', stamp: '1:1', text: 'a arm' }]))
    expect([...state.pool.keys()]).toEqual(['a', 'arm'])
    expect(seen.slice(-2)).toEqual(['a', 'arm'])
  })

  it('기본 의존성은 진짜 사실 만들기·맞추기다', () => {
    const state = createUsageWorkerState()
    expect(state.deps.extractFacts.name).toBe('extractFacts')
    expect(state.deps.resolveUsages.name).toBe('resolveUsages')
  })
})
