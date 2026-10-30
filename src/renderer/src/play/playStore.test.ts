import { beforeEach, describe, expect, it } from 'vitest'
import type { DashConfigNode, DashOp } from '../../../shared/dashboard'
import type { OpModeInfo, PlayDiagnostic, PlayEvent } from '../../../shared/play'
import { CONSOLE_LIMIT } from './consoleModel'
import { DEFAULT_CONSOLE_PREFS, DEFAULT_PLAY_SETTINGS } from './playSettings'
import {
  applyPlayEvent,
  consoleEntry,
  dashTelemetryRows,
  displayRootOverride,
  EMPTY_OPMODE_LIST,
  isRunActive,
  listedOpModes,
  MAX_DASH_KEYS,
  newRun,
  runningRobotId,
  simPoseOf,
  withEntries,
  withPendingConfig,
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
    simPose: null,
    ghostPose: null,
    dash: null,
    dashOverlay: null,
    dashConfig: null,
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
  code: 'compiler.err.expected',
  hint: null
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
    state = { ...state, run: { ...state.run!, accepted: true } }
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

  it('playInit 응답 전의 status는 렌더러의 일시 정지·속도를 바꾸지 않는다', () => {
    state = data({
      paused: true,
      run: { ...state.run!, status: { ...state.run!.status, paused: true, speed: 4 } }
    })
    const next = apply(state, {
      type: 'status',
      runId: 'r1',
      tNanos: 0,
      paused: false,
      speed: 1,
      realtime: 0,
      startedNanos: null
    })
    expect(next.paused).toBe(true)
    expect(next.run!.status).toMatchObject({ paused: true, speed: 4 })
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
    // 진단은 실행한 프로젝트를 기억한다(다른 프로젝트를 연 뒤에는 열지 않는다)
    expect(next.entries[1].root).toBe('/p')
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
      { type: 'devices', runId: 'r1', tNanos: 9, outputs: { lift: { power: 0.5 } }, inputs: {} }
    )
    expect(next.run!.telemetry).toEqual({ tNanos: 9, frame: { ...frame, lines: ['b'] } })
    expect(next.run!.devices).toEqual({ tNanos: 9, outputs: { lift: { power: 0.5 } }, inputs: {} })
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

describe('시뮬레이터 자세·잔상·센서 값·안내', () => {
  // 로봇이 있는 실행
  const withRobot = (patch: Partial<PlayData> = {}): PlayData => {
    const base = data()
    return { ...base, run: { ...base.run!, robotId: 'bot', phase: 'running' }, ...patch }
  }
  const pose = (tNanos: number, x: number, extra: Partial<PlayEvent> = {}): PlayEvent =>
    ({
      type: 'pose',
      runId: 'r1',
      tNanos,
      x,
      y: 0.5,
      yaw: 0.25,
      blocked: false,
      ...extra
    }) as PlayEvent

  it('pose는 run이 아니라 simPose만 바꾼다(실행 상태를 구독하는 화면이 60 Hz로 다시 그리지 않게)', () => {
    const state = withRobot()
    const patch = applyPlayEvent(state, pose(5_000_000, 1))
    expect(Object.keys(patch)).toEqual(['simPose'])
    expect(patch.simPose).toEqual({
      robotId: 'bot',
      tNanos: 5_000_000,
      x: 1,
      y: 0.5,
      yaw: 0.25,
      blocked: false
    })
    const next = apply(state, pose(5_000_000, 1), pose(10_000_000, 2, { blocked: true }))
    expect(next.run).toBe(state.run)
    expect(next.simPose).toMatchObject({ x: 2, blocked: true })
    // 늦게 온 이전 자세로 되돌아가지 않는다
    expect(applyPlayEvent(next, pose(5_000_000, 9))).toEqual({})
  })

  it('다른 실행·로봇 없는 실행·끝난 실행의 자세는 버린다', () => {
    const state = withRobot()
    expect(applyPlayEvent(state, { ...pose(1, 1), runId: 'old' } as PlayEvent)).toEqual({})
    expect(applyPlayEvent(data(), pose(1, 1))).toEqual({})
    const finished = withRobot({ run: { ...withRobot().run!, phase: 'finished' } })
    expect(applyPlayEvent(finished, pose(1, 1))).toEqual({})
  })

  it('finished 때 마지막 자세를 잔상으로 옮기고 simPose를 지운다', () => {
    const next = apply(withRobot(), pose(5, 1), pose(9, 1.5), {
      type: 'finished',
      runId: 'r1',
      tNanos: 9,
      reason: 'stopped',
      detail: '',
      preselectTeleOp: ''
    })
    expect(next.simPose).toBeNull()
    expect(next.ghostPose).toEqual({ robotId: 'bot', x: 1.5, y: 0.5, yaw: 0.25 })
    expect(next.run!.phase).toBe('finished')
    // 자세가 오기 전에 끝나면 잔상도 없다
    const early = apply(withRobot(), {
      type: 'finished',
      runId: 'r1',
      tNanos: 0,
      reason: 'compileFailed',
      detail: '',
      preselectTeleOp: ''
    })
    expect(early.ghostPose).toBeNull()
  })

  it('호스트 순서(phase finished → finished)에서도 잔상이 남는다', () => {
    const finished = {
      type: 'finished',
      runId: 'r1',
      tNanos: 9,
      reason: 'stopped',
      detail: '',
      preselectTeleOp: ''
    } as PlayEvent
    const phase = { type: 'phase', runId: 'r1', phase: 'finished' } as PlayEvent
    const afterPhase = apply(withRobot(), pose(5, 1), pose(9, 1.5), phase)
    expect(afterPhase.simPose).toBeNull()
    expect(afterPhase.ghostPose).toEqual({ robotId: 'bot', x: 1.5, y: 0.5, yaw: 0.25 })
    const next = apply(afterPhase, finished)
    expect(next.ghostPose).toEqual({ robotId: 'bot', x: 1.5, y: 0.5, yaw: 0.25 })
    expect(next.run!.finished).not.toBeNull()
  })

  it('표시 자세는 실행이 활성이고 그 로봇의 자세일 때만 쓴다', () => {
    const state = apply(withRobot(), pose(5, 1))
    expect(simPoseOf(state)).toBe(state.simPose)
    expect(displayRootOverride(state)).toEqual({
      id: 'bot',
      transform: { position: [1, 0.5, 0], rotation: [0, 0, 0.25] }
    })
    expect(runningRobotId(state)).toBe('bot')
    // 실행이 지워졌거나 다른 로봇이면 문서 자세
    expect(simPoseOf({ ...state, run: null })).toBeNull()
    expect(simPoseOf({ ...state, run: { ...state.run!, robotId: 'other' } })).toBeNull()
    expect(displayRootOverride({ ...state, run: null })).toBeNull()
    expect(runningRobotId({ run: { ...state.run!, phase: 'finished' } })).toBeNull()
    // INIT부터(자세 전에도) 실행 중인 로봇이다
    expect(runningRobotId({ run: { ...state.run!, phase: 'init' } })).toBe('bot')
  })

  it('devices의 센서 값(inputs)을 함께 둔다', () => {
    const next = apply(withRobot(), {
      type: 'devices',
      runId: 'r1',
      tNanos: 3,
      outputs: { fl: { power: 1 } },
      inputs: { fl: { position: 120, velocity: 2400 }, imu: { yaw: 0.1 } }
    })
    expect(next.run!.devices).toEqual({
      tNanos: 3,
      outputs: { fl: { power: 1 } },
      inputs: { fl: { position: 120, velocity: 2400 }, imu: { yaw: 0.1 } }
    })
  })

  it('simNotice는 Console 경고 한 줄(console.notices.sim.<code>)', () => {
    const next = apply(withRobot(), {
      type: 'simNotice',
      runId: 'r1',
      tNanos: 7,
      code: 'sharedEncoderMode',
      params: { device: 'leftFront' }
    })
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0]).toMatchObject({
      type: 'notice',
      key: 'sim.sharedEncoderMode',
      params: { device: 'leftFront' },
      level: 'warning',
      tNanos: 7
    })
    expect(
      applyPlayEvent(withRobot(), {
        type: 'simNotice',
        runId: 'old',
        tNanos: 7,
        code: 'worldError',
        params: { detail: 'x' }
      })
    ).toEqual({})
  })
})

describe('라이브러리 진행·보고·링크 검사', () => {
  const progress: PlayEvent = {
    type: 'libraryProgress',
    runId: 'r1',
    phase: 'downloading',
    done: 1,
    total: 4,
    bytes: 2048
  }

  it('진행은 준비 중에만 run에 두고, 보고가 오면 지운다', () => {
    const state = data()
    const next = apply(state, progress)
    expect(next.run!.libraryProgress).toEqual({
      phase: 'downloading',
      done: 1,
      total: 4,
      bytes: 2048
    })
    const reported = apply(next, {
      type: 'libraryReport',
      runId: 'r1',
      report: { entries: [], gradle: [], compileSdk: null, compileSdkMinor: null, platform: null }
    })
    expect(reported.run!.libraryProgress).toBeNull()
    // 좌표가 없으면 Console에 아무것도 쓰지 않는다
    expect(reported.entries).toEqual([])
    const compiling = apply(data(), { type: 'phase', runId: 'r1', phase: 'compiling' }, progress)
    expect(compiling.run!.libraryProgress).toBeNull()
  })

  it('보고 뒤에 온 진행(쓰지 않게 된 버전의 늦은 미리 받기)은 받지 않고, 준비를 벗어나면 진행을 지운다', () => {
    const report: PlayEvent = {
      type: 'libraryReport',
      runId: 'r1',
      report: { entries: [], gradle: [], compileSdk: null, compileSdkMinor: null, platform: null }
    }
    // 보고 뒤 hello 전(아직 preparing)
    const late = apply(data(), progress, report, { ...progress, done: 4, total: 4 })
    expect(late.run!.phase).toBe('preparing')
    expect(late.run!.libraryProgress).toBeNull()
    const compiling = apply(data(), progress, { type: 'phase', runId: 'r1', phase: 'compiling' })
    expect(compiling.run!.libraryProgress).toBeNull()
  })

  it('보고는 요약과 문제 좌표를 Console에(실행의 프로젝트 루트와 함께)', () => {
    const next = apply(data(), {
      type: 'libraryReport',
      runId: 'r1',
      report: {
        entries: [
          {
            group: 'com.pedropathing',
            artifact: 'tuning',
            version: '1.0.1',
            requested: ['1.0.1'],
            status: 'unsupported',
            reason: 'pedroTuning',
            detail: '',
            declaredAt: { file: 'build.dependencies.gradle', line: 12 },
            requestedBy: [],
            source: null,
            integrity: null
          }
        ],
        gradle: [],
        compileSdk: 30,
        compileSdkMinor: null,
        platform: { api: 30, minor: null, guessed: false }
      }
    })
    expect(next.entries.map((e) => `${e.level} ${e.type}`)).toEqual([
      'warning notice',
      'warning library'
    ])
    expect(next.entries.every((e) => e.root === '/p')).toBe(true)
  })

  it('링크 검사 경고는 라이브러리별 한 줄', () => {
    const next = apply(data(), {
      type: 'linkWarnings',
      runId: 'r1',
      warnings: [
        { library: 'a:b:1', kind: 'missingClass', from: 'a.X', target: 'q.Y' },
        { library: 'a:b:1', kind: 'missingMember', from: 'a.X', target: 'q.Y#f()V' }
      ]
    })
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0]).toMatchObject({
      type: 'linkWarnings',
      library: 'a:b:1',
      level: 'warning'
    })
  })
})

describe('FTC Dashboard 패킷·설정', () => {
  type DashEvent = Extract<PlayEvent, { type: 'dash' }>
  const dash = (patch: Partial<DashEvent> = {}): DashEvent => ({
    type: 'dash',
    runId: 'r1',
    tNanos: 1,
    cleared: false,
    data: [],
    log: null,
    ops: null,
    ...patch
  })
  const OPS_A: DashOp[] = [{ type: 'stroke', color: 'red' }]
  const OPS_B: DashOp[] = [{ type: 'circle', x: 1, y: 2, radius: 3, stroke: true }]
  const leaf = (value: string): DashConfigNode => ({
    kind: 'value',
    type: 'double',
    value,
    enumValues: [],
    source: null
  })
  const tree = (...entries: [string, string][]): DashConfigNode => ({
    kind: 'custom',
    children: [
      {
        name: 'Lift',
        node: {
          kind: 'custom',
          children: entries.map(([name, value]) => ({ name, node: leaf(value) }))
        }
      }
    ]
  })

  it('텔레메트리는 키마다 마지막 값을 합치고 키 정렬로 보인다', () => {
    const next = apply(
      data(),
      dash({
        data: [
          ['b', '1'],
          ['a', '2']
        ]
      }),
      dash({ tNanos: 2, data: [['b', '3']], log: ['first'] })
    )
    expect(dashTelemetryRows(next.dash!)).toEqual([
      ['a', '2'],
      ['b', '3']
    ])
    expect(next.dash).toMatchObject({ runId: 'r1', tNanos: 2, log: ['first'] })
  })

  it('로그는 비어 있지 않은 것이 오면 바꾸고, cleared는 data와 로그를 비운다(Dashboard 웹 클라이언트처럼)', () => {
    const before = apply(data(), dash({ data: [['a', '1']], log: ['x'] }), dash({ log: [] }))
    expect(before.dash!.log).toEqual(['x'])
    const cleared = apply(before, dash({ cleared: true, data: [['c', '5']] }))
    expect(dashTelemetryRows(cleared.dash!)).toEqual([['c', '5']])
    expect(cleared.dash!.log).toEqual([])
    // 키 정렬은 Java TreeMap처럼 UTF-16 순서다(대문자가 먼저)
    const sorted = apply(
      data(),
      dash({
        data: [
          ['b', '1'],
          ['B', '2'],
          ['a', '3']
        ]
      })
    )
    expect(dashTelemetryRows(sorted.dash!).map(([key]) => key)).toEqual(['B', 'a', 'b'])
  })

  it('키 수 한도를 넘으면 오래 바뀌지 않은 키부터 버린다', () => {
    const many: [string, string][] = Array.from({ length: MAX_DASH_KEYS }, (_, i) => [`k${i}`, '0'])
    const next = apply(
      data(),
      dash({ data: many }),
      dash({
        data: [
          ['k0', '1'],
          ['new', '2']
        ]
      })
    )
    const keys = [...next.dash!.values.keys()]
    expect(keys).toHaveLength(MAX_DASH_KEYS)
    expect(keys).not.toContain('k1')
    expect(keys.slice(-2)).toEqual(['k0', 'new'])
  })

  it('오버레이는 ops가 있는 패킷만 바꾸고(null이면 그대로), 다른 실행의 것은 받지 않는다', () => {
    let next = apply(data(), dash({ ops: OPS_A }), dash({ ops: null }))
    expect(next.dashOverlay).toEqual({ runId: 'r1', tNanos: 1, ops: OPS_A })
    next = apply(next, dash({ tNanos: 3, ops: OPS_B }), dash({ runId: 'other', ops: OPS_A }))
    expect(next.dashOverlay).toEqual({ runId: 'r1', tNanos: 3, ops: OPS_B })
  })

  it('새 씬과 떼어 놓은 실행의 오버레이·설정은 받지 않는다(텔레메트리는 받는다)', () => {
    const detached = data()
    detached.run = { ...detached.run!, detached: true }
    const next = apply(detached, dash({ data: [['a', '1']], ops: OPS_A }), {
      type: 'dashConfig',
      runId: 'r1',
      tNanos: 1,
      root: tree(['kP', '1'])
    })
    expect(next.dashOverlay).toBeNull()
    expect(next.dashConfig).toBeNull()
    expect(dashTelemetryRows(next.dash!)).toEqual([['a', '1']])
  })

  it('설정 트리: 시작 값은 처음 받은 값이고, 새 트리가 오면 보낸 값을 지운다', () => {
    let next = apply(data(), {
      type: 'dashConfig',
      runId: 'r1',
      tNanos: 0,
      root: tree(['kP', '0.5'])
    })
    expect(next.dashConfig).toMatchObject({ runId: 'r1', root: '/p', tNanos: 0, pending: {} })
    next = { ...next, dashConfig: withPendingConfig(next.dashConfig!, ['Lift', 'kP'], '0.9') }
    expect(next.dashConfig!.pending).toEqual({ '["Lift","kP"]': '0.9' })
    next = apply(next, {
      type: 'dashConfig',
      runId: 'r1',
      tNanos: 5,
      root: tree(['kP', '0.9'], ['kD', '2'])
    })
    expect(next.dashConfig!.pending).toEqual({})
    expect(next.dashConfig!.baseline.get('["Lift","kP"]')).toBe('0.5')
    expect(next.dashConfig!.baseline.get('["Lift","kD"]')).toBe('2')
    expect(next.dashConfig!.tree).toEqual(tree(['kP', '0.9'], ['kD', '2']))
  })
})

describe('고를 수 있는 OpMode 목록', () => {
  const registered: OpModeInfo = {
    ...TELEOP,
    className: 'com.acmerobotics.roadrunner.ftc.ForwardRampLogger',
    name: 'Ramp',
    registered: { registrar: 'org.firstinspires.ftc.teamcode.TuningOpModes' }
  }

  it('annotated와 등록기 OpMode를 DS 순서로 합치고 목록마다 한 번 만든다', () => {
    const list = {
      ...EMPTY_OPMODE_LIST,
      opModes: [TELEOP],
      registered: { status: 'ready' as const, opModes: [registered], problem: null }
    }
    expect(listedOpModes(list)).toEqual([TELEOP, registered])
    expect(listedOpModes(list)).toBe(listedOpModes(list))
    // 등록기 OpMode가 없으면 annotated 목록 그대로
    const plain = { ...EMPTY_OPMODE_LIST, opModes: [TELEOP] }
    expect(listedOpModes(plain)).toBe(plain.opModes)
  })
})
