import { beforeEach, describe, expect, it } from 'vitest'
import type { OpModeInfo, PlayDiagnostic, PlayEvent } from '../../../shared/play'
import { CONSOLE_LIMIT } from './consoleModel'
import { DEFAULT_CONSOLE_PREFS, DEFAULT_PLAY_SETTINGS } from './playSettings'
import {
  applyPlayEvent,
  consoleEntry,
  EMPTY_OPMODE_LIST,
  isRunActive,
  newRun,
  withEntries,
  type PlayData
} from './playStore'

const TELEOP: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 7,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

function data(patch: Partial<PlayData> = {}): PlayData {
  return {
    opModeList: EMPTY_OPMODE_LIST,
    selectedClass: null,
    run: newRun({
      runId: 'r1',
      root: '/p',
      opMode: TELEOP,
      robotId: null,
      configPath: null,
      speed: 1,
      paused: false
    }),
    paused: false,
    entries: [],
    selectedEntryId: null,
    consoleQuery: '',
    consolePrefs: DEFAULT_CONSOLE_PREFS,
    settings: DEFAULT_PLAY_SETTINGS,
    gamepads: [null, null],
    dockTab: 'console',
    ...patch
  }
}

// 이벤트를 차례로 반영한다(스토어의 set처럼 얕게 합친다)
function apply(state: PlayData, ...events: PlayEvent[]): PlayData {
  return events.reduce(
    (current, event) => ({ ...current, ...applyPlayEvent(current, event) }),
    state
  )
}

const diagnostic = (kind: PlayDiagnostic['kind'], line: number): PlayDiagnostic => ({
  kind,
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  file: 'org/firstinspires/ftc/teamcode/Drive.java',
  line,
  column: 5,
  message: "';' expected",
  code: 'compiler.err.expected'
})

describe('applyPlayEvent', () => {
  let state: PlayData
  beforeEach(() => {
    state = data()
  })

  it('다른 실행(runId)의 이벤트와 실행이 없을 때의 이벤트는 버린다', () => {
    const stale: PlayEvent = { type: 'phase', runId: 'old', phase: 'running' }
    expect(applyPlayEvent(state, stale)).toEqual({})
    expect(
      applyPlayEvent(state, {
        type: 'log',
        runId: 'old',
        entries: [{ tNanos: 0, stream: 'out', text: 'late' }]
      })
    ).toEqual({})
    expect(applyPlayEvent(data({ run: null }), { ...stale, runId: 'r1' })).toEqual({})
  })

  it('단계는 앞으로만 간다(늦게 온 이전 단계로 돌아가지 않는다)', () => {
    let next = apply(
      state,
      { type: 'phase', runId: 'r1', phase: 'compiling' },
      { type: 'phase', runId: 'r1', phase: 'init' }
    )
    expect(next.run!.phase).toBe('init')
    next = apply(next, { type: 'phase', runId: 'r1', phase: 'compiling' })
    expect(next.run!.phase).toBe('init')
    // running이 오면 START 요청은 끝난다
    next = apply(
      { ...next, run: { ...next.run!, startRequested: true } },
      { type: 'phase', runId: 'r1', phase: 'running' }
    )
    expect(next.run!.phase).toBe('running')
    expect(next.run!.startRequested).toBe(false)
    expect(isRunActive(next.run)).toBe(true)
    next = apply(next, { type: 'phase', runId: 'r1', phase: 'finished' })
    expect(isRunActive(next.run)).toBe(false)
  })

  it('status는 실행 상태와 일시 정지 토글에 그대로 들어간다', () => {
    const next = apply(state, {
      type: 'status',
      runId: 'r1',
      tNanos: 1_500_000_000,
      paused: true,
      speed: 2,
      realtime: 1.9,
      startedNanos: 500_000_000
    })
    expect(next.run!.status).toEqual({
      tNanos: 1_500_000_000,
      paused: true,
      speed: 2,
      realtime: 1.9,
      startedNanos: 500_000_000
    })
    expect(next.paused).toBe(true)
  })

  it('compiled: 요약 한 줄과 진단마다 한 줄(수준은 진단 종류)', () => {
    const next = apply(state, {
      type: 'compiled',
      runId: 'r1',
      ok: false,
      millis: 812,
      diagnostics: [diagnostic('error', 12), diagnostic('warning', 3), diagnostic('note', 3)]
    })
    expect(next.entries.map((entry) => [entry.type, entry.level])).toEqual([
      ['compiled', 'error'],
      ['diagnostic', 'error'],
      ['diagnostic', 'warning'],
      ['diagnostic', 'info']
    ])
    expect(next.entries[0]).toMatchObject({ ok: false, errors: 1, warnings: 1, millis: 812 })
  })

  it('로그는 묶음의 줄마다 항목이 되고 System.err는 경고다', () => {
    const next = apply(state, {
      type: 'log',
      runId: 'r1',
      entries: [
        { tNanos: 1, stream: 'out', text: 'hello' },
        { tNanos: 2, stream: 'err', text: 'oops' },
        { tNanos: 3, stream: 'robotLog', text: 'RobotLog' }
      ]
    })
    expect(next.entries.map((entry) => [entry.level, entry.tNanos])).toEqual([
      ['info', 1],
      ['warning', 2],
      ['info', 3]
    ])
  })

  it('오류는 kind를 지키고 stall만 경고다', () => {
    const error = (kind: 'exception' | 'stall'): PlayEvent => ({
      type: 'error',
      runId: 'r1',
      tNanos: 10,
      kind,
      message: 'boom',
      exception: kind === 'exception' ? 'java.lang.IllegalStateException' : null,
      stack: [],
      thread: 'OpModeThread'
    })
    const next = apply(state, error('exception'), error('stall'))
    expect(next.entries.map((entry) => entry.level)).toEqual(['error', 'warning'])
    expect(next.entries[0]).toMatchObject({ type: 'error', kind: 'exception', message: 'boom' })
  })

  it('텔레메트리·장치는 마지막 것만 둔다', () => {
    const frame = { lines: ['a'], log: [], format: 'classic' as const }
    const next = apply(
      state,
      { type: 'telemetry', runId: 'r1', tNanos: 5, frame },
      { type: 'telemetry', runId: 'r1', tNanos: 9, frame: { ...frame, lines: ['b'] } },
      { type: 'devices', runId: 'r1', tNanos: 9, outputs: { lift: { power: 0.5 } } }
    )
    expect(next.run!.telemetry).toEqual({ tNanos: 9, frame: { ...frame, lines: ['b'] } })
    expect(next.run!.devices).toEqual({ tNanos: 9, outputs: { lift: { power: 0.5 } } })
  })

  it('finished는 한 번만 반영하고 실행을 끝낸다(Console에 한 줄)', () => {
    const finished: PlayEvent = {
      type: 'finished',
      runId: 'r1',
      tNanos: 3_000_000_000,
      reason: 'stopped',
      detail: '',
      preselectTeleOp: ''
    }
    const once = apply(state, finished)
    expect(once.run!.phase).toBe('finished')
    expect(once.run!.finished).toEqual({ tNanos: 3_000_000_000, reason: 'stopped', detail: '' })
    expect(once.run!.status.tNanos).toBe(3_000_000_000)
    expect(once.entries).toHaveLength(1)
    const twice = apply(once, { ...finished, reason: 'killed' })
    expect(twice.entries).toHaveLength(1)
    expect(twice.run!.finished!.reason).toBe('stopped')
    // 끝난 뒤의 status는 받지 않는다
    expect(
      applyPlayEvent(twice, {
        type: 'status',
        runId: 'r1',
        tNanos: 0,
        paused: true,
        speed: 1,
        realtime: 1,
        startedNanos: null
      })
    ).toEqual({})
  })

  it('끝난 이유에 따라 Console 수준이 다르다', () => {
    const level = (reason: string): string =>
      apply(state, {
        type: 'finished',
        runId: 'r1',
        tNanos: 0,
        reason: reason as 'stopped',
        detail: '',
        preselectTeleOp: ''
      }).entries[0].level
    expect(level('stopped')).toBe('info')
    expect(level('returned')).toBe('info')
    expect(level('killed')).toBe('warning')
    expect(level('exception')).toBe('error')
    expect(level('crashed')).toBe('error')
    expect(level('compileFailed')).toBe('error')
  })
})

describe('Console 한도', () => {
  it(`${CONSOLE_LIMIT}개를 넘으면 오래된 것부터 버리고, 버려진 항목을 골랐으면 고르기를 푼다`, () => {
    const make = (n: number): ReturnType<typeof consoleEntry>[] =>
      Array.from({ length: n }, (_, i) =>
        consoleEntry({ type: 'log', stream: 'out', text: `line ${i}` }, i)
      )
    const first = make(CONSOLE_LIMIT)
    let state = withEntries({ entries: [], selectedEntryId: null }, first)
    expect(state.entries).toHaveLength(CONSOLE_LIMIT)
    state = { ...state, selectedEntryId: first[0].id }
    // 남는 항목을 골랐으면 그대로
    const kept = withEntries({ ...state, selectedEntryId: first[5].id }, make(3))
    expect(kept.entries).toHaveLength(CONSOLE_LIMIT)
    expect(kept.selectedEntryId).toBe(first[5].id)
    expect(kept.entries[0]).toBe(first[3])
    // 버려진 항목을 골랐으면 푼다
    const dropped = withEntries(state, make(1))
    expect(dropped.selectedEntryId).toBeNull()
    expect(dropped.entries[0]).toBe(first[1])
    // 붙일 것이 없으면 같은 배열
    expect(withEntries(state, []).entries).toBe(state.entries)
  })
})
