import { create } from 'zustand'
import type {
  OpModeInfo,
  PlayEvent,
  PlayPhase,
  PlaySettings,
  PlaySpeed
} from '../../../shared/play'
import type { DeviceValues, TelemetryFrame } from '../../../shared/sidecarProtocol'
import {
  appendConsole,
  consoleLevel,
  CONSOLE_LIMIT,
  type ConsoleBody,
  type ConsoleEntry,
  type ConsoleFinishReason,
  type ConsoleLevel
} from './consoleModel'
import type { PadSlots } from './gamepad'
import {
  loadConsolePrefs,
  loadDockTab,
  loadPlaySettings,
  saveConsolePrefs,
  saveDockTab,
  savePlaySettings,
  type ConsolePrefs,
  type DockTab
} from './playSettings'

// 실행(Play) 상태: OpMode 목록과 고른 것, 지금 실행(메인이 보내는 PlayEvent를 그대로 반영), Console 항목, 개인 설정.
// 씬 문서와 따로 둔다(실행은 저장·실행 취소·dirty와 관계없다). 이벤트는 지금 실행의 runId일 때만 받는다
// (다른 실행의 늦은 이벤트는 버린다).

export type OpModeListStatus = 'none' | 'loading' | 'ready' | 'failed'

export type OpModeListState = {
  // 이 목록을 읽은 프로젝트 루트
  root: string | null
  status: OpModeListStatus
  opModes: OpModeInfo[]
  truncated: boolean
  hasTeamCode: boolean
  // 읽지 못한 이유(failed)
  detail: string
}

export type RunStatus = {
  tNanos: number
  paused: boolean
  speed: PlaySpeed
  // 최근 실제 속도(가상 ÷ 실제). 아직 모르면 0.
  realtime: number
  // START 뒤 흐른 가상 시간(START 전이면 null)
  startedNanos: number | null
}

export type PlayRun = {
  runId: string
  root: string
  // 실행한 OpMode(실행하는 동안 목록이 바뀌어도 그대로)
  opMode: OpModeInfo
  // 구성 XML을 고른 로봇(장치 탭의 순서·오브젝트 고르기)과 그 구성 경로. 없으면 null.
  robotId: string | null
  configPath: string | null
  phase: PlayPhase
  // 메인이 playInit을 받았다(그 전의 STOP은 받은 뒤 보낸다)
  accepted: boolean
  // STOP을 눌렀다(끝날 때까지 버튼을 막는다)
  stopRequested: boolean
  // START를 눌렀다(running이 올 때까지 두 번 보내지 않는다)
  startRequested: boolean
  status: RunStatus
  telemetry: { tNanos: number; frame: TelemetryFrame } | null
  devices: { tNanos: number; outputs: Record<string, DeviceValues> } | null
  finished: { tNanos: number; reason: ConsoleFinishReason; detail: string } | null
}

export type PlayData = {
  opModeList: OpModeListState
  // 고른 OpMode의 클래스(프로젝트 루트마다 localStorage에 기억). 목록에 없으면 고른 것이 없는 것으로 보인다.
  selectedClass: string | null
  run: PlayRun | null
  // 일시 정지 토글(Unity처럼 실행 전에도 켤 수 있다. 켜고 INIT하면 init에서 바로 멈춘다)
  paused: boolean
  entries: readonly ConsoleEntry[]
  selectedEntryId: number | null
  consoleQuery: string
  consolePrefs: ConsolePrefs
  settings: PlaySettings
  gamepads: PadSlots
  dockTab: DockTab
}

export const EMPTY_OPMODE_LIST: OpModeListState = {
  root: null,
  status: 'none',
  opModes: [],
  truncated: false,
  hasTeamCode: false,
  detail: ''
}

let nextEntryId = 1

export function consoleEntry(
  body: ConsoleBody,
  tNanos: number | null,
  level: ConsoleLevel = consoleLevel(body),
  root?: string
): ConsoleEntry {
  const entry = { ...body, id: nextEntryId++, level, tNanos } as ConsoleEntry
  if (root !== undefined) entry.root = root
  return entry
}

// 항목을 붙이고, 한도로 버려진 항목을 골라 두었으면 고르기를 푼다
export function withEntries(
  data: Pick<PlayData, 'entries' | 'selectedEntryId'>,
  added: readonly ConsoleEntry[],
  limit: number = CONSOLE_LIMIT
): Pick<PlayData, 'entries' | 'selectedEntryId'> {
  const entries = appendConsole(data.entries, added, limit)
  const selectedEntryId =
    data.selectedEntryId !== null && entries.length > 0 && entries[0].id > data.selectedEntryId
      ? null
      : data.selectedEntryId
  return { entries, selectedEntryId }
}

export function isRunActive(run: PlayRun | null): run is PlayRun {
  return run !== null && run.phase !== 'finished'
}

export function newRun(options: {
  runId: string
  root: string
  opMode: OpModeInfo
  robotId: string | null
  configPath: string | null
  speed: PlaySpeed
  paused: boolean
}): PlayRun {
  return {
    runId: options.runId,
    root: options.root,
    opMode: options.opMode,
    robotId: options.robotId,
    configPath: options.configPath,
    phase: 'preparing',
    accepted: false,
    stopRequested: false,
    startRequested: false,
    status: {
      tNanos: 0,
      paused: options.paused,
      speed: options.speed,
      realtime: 0,
      startedNanos: null
    },
    telemetry: null,
    devices: null,
    finished: null
  }
}

const PHASE_ORDER: readonly PlayPhase[] = [
  'preparing',
  'compiling',
  'init',
  'running',
  'stopping',
  'finished'
]

// PlayEvent 하나를 상태에 반영한다(순수 함수). 지금 실행이 아니면(runId가 다르거나 실행이 없음) 아무것도 바꾸지 않는다.
// 단계는 앞으로만 간다(늦게 온 이전 단계로 되돌아가지 않는다).
export function applyPlayEvent(data: PlayData, event: PlayEvent): Partial<PlayData> {
  const { run } = data
  if (!run || event.runId !== run.runId) return {}
  switch (event.type) {
    case 'phase': {
      if (PHASE_ORDER.indexOf(event.phase) <= PHASE_ORDER.indexOf(run.phase)) return {}
      return {
        run: {
          ...run,
          phase: event.phase,
          startRequested: event.phase === 'running' ? false : run.startRequested
        }
      }
    }
    case 'status': {
      if (run.phase === 'finished') return {}
      // 메인은 playInit을 받자마자(응답보다 먼저) 처음 상태(일시 정지 아님, 요청의 속도)를 보낸다. 응답을 받기 전에는
      // 일시 정지·속도를 렌더러의 것으로 둔다(실행 전에 켜 둔 일시 정지와 그사이 바꾼 속도는 받은 뒤 보낸다).
      const accepted = run.accepted
      const status: RunStatus = {
        tNanos: event.tNanos,
        paused: accepted ? event.paused : run.status.paused,
        speed: accepted ? event.speed : run.status.speed,
        realtime: event.realtime,
        startedNanos: event.startedNanos
      }
      return accepted
        ? { run: { ...run, status }, paused: event.paused }
        : { run: { ...run, status } }
    }
    case 'compiled': {
      const errors = event.diagnostics.filter((d) => d.kind === 'error').length
      const warnings = event.diagnostics.filter((d) => d.kind === 'warning').length
      const added = [
        consoleEntry(
          { type: 'compiled', ok: event.ok, millis: event.millis, errors, warnings },
          null
        ),
        ...event.diagnostics.map((diagnostic) =>
          consoleEntry({ type: 'diagnostic', diagnostic }, null, undefined, run.root)
        )
      ]
      return withEntries(data, added)
    }
    case 'telemetry':
      return { run: { ...run, telemetry: { tNanos: event.tNanos, frame: event.frame } } }
    case 'devices':
      return { run: { ...run, devices: { tNanos: event.tNanos, outputs: event.outputs } } }
    // 2단계(C): 시뮬레이터 자세·안내
    case 'pose':
    case 'simNotice':
      return {}
    case 'log':
      return withEntries(
        data,
        event.entries.map((entry) =>
          consoleEntry({ type: 'log', stream: entry.stream, text: entry.text }, entry.tNanos)
        )
      )
    case 'error':
      return withEntries(data, [
        consoleEntry(
          {
            type: 'error',
            kind: event.kind,
            message: event.message,
            exception: event.exception,
            stack: event.stack,
            thread: event.thread
          },
          event.tNanos,
          undefined,
          run.root
        )
      ])
    case 'finished': {
      if (run.finished) return {}
      const finished = { tNanos: event.tNanos, reason: event.reason, detail: event.detail }
      return {
        run: {
          ...run,
          phase: 'finished',
          finished,
          status: { ...run.status, tNanos: Math.max(run.status.tNanos, event.tNanos) }
        },
        ...withEntries(data, [
          consoleEntry(
            { type: 'finished', reason: event.reason, detail: event.detail },
            event.tNanos
          )
        ])
      }
    }
  }
}

type PlayStoreActions = {
  applyEvent: (event: PlayEvent) => void
  addConsole: (body: ConsoleBody, tNanos?: number | null, level?: ConsoleLevel) => void
  clearConsole: () => void
  selectEntry: (id: number | null) => void
  setConsoleQuery: (query: string) => void
  toggleLevel: (level: ConsoleLevel) => void
  setClearOnPlay: (clearOnPlay: boolean) => void
  updateSettings: (patch: Partial<PlaySettings>) => void
  setDockTab: (tab: DockTab) => void
}

export type PlayState = PlayData & PlayStoreActions

export function initialPlayData(): PlayData {
  return {
    opModeList: EMPTY_OPMODE_LIST,
    selectedClass: null,
    run: null,
    paused: false,
    entries: [],
    selectedEntryId: null,
    consoleQuery: '',
    consolePrefs: loadConsolePrefs(),
    settings: loadPlaySettings(),
    gamepads: [null, null],
    dockTab: loadDockTab()
  }
}

export const usePlayStore = create<PlayState>()((set) => ({
  ...initialPlayData(),
  applyEvent: (event) => set((state) => applyPlayEvent(state, event)),
  addConsole: (body, tNanos = null, level) =>
    set((state) => withEntries(state, [consoleEntry(body, tNanos, level)])),
  clearConsole: () => set({ entries: [], selectedEntryId: null }),
  selectEntry: (selectedEntryId) => set({ selectedEntryId }),
  setConsoleQuery: (consoleQuery) => set({ consoleQuery }),
  toggleLevel: (level) =>
    set((state) => {
      const consolePrefs = {
        ...state.consolePrefs,
        show: { ...state.consolePrefs.show, [level]: !state.consolePrefs.show[level] }
      }
      saveConsolePrefs(consolePrefs)
      return { consolePrefs }
    }),
  setClearOnPlay: (clearOnPlay) =>
    set((state) => {
      const consolePrefs = { ...state.consolePrefs, clearOnPlay }
      saveConsolePrefs(consolePrefs)
      return { consolePrefs }
    }),
  updateSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch }
      savePlaySettings(settings)
      return { settings }
    }),
  setDockTab: (dockTab) => {
    saveDockTab(dockTab)
    set({ dockTab })
  }
}))
