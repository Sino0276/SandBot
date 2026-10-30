import i18n from 'i18next'
import type {
  ListOpModesResult,
  ListRegisteredResult,
  PlayEvent,
  PlayInitResult,
  PlaySpeed
} from '../../../shared/play'
import { openPreferences, showDialog } from '../editor/dialogStore'
import { useEditorStore } from '../editor/editorStore'
import { dismissNotice, showNotice, type NoticeKey } from '../editor/noticeStore'
import { commitFocusedInput } from '../editor/useDraft'
import { ipcErrorDetail } from '../java/ipcError'
import { saveProject } from '../project/projectActions'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import type { ConsoleEntry } from './consoleModel'
import { configCommandFits } from './dashConfigModel'
import {
  browserGamepads,
  createGamepadPoller,
  padInfo,
  samePadSlots,
  type GamepadPair
} from './gamepad'
import {
  createKeyboardPad,
  focusSceneView,
  installKeyboardGamepad,
  keyboardPadActive,
  useKeyboardPadStore,
  type PadKeyEvent
} from './keyboardGamepad'
import { installLibraryNotice } from './libraryNotice'
import { compareOpModes, findOpMode, opModeKey, preselectedTeleOp } from './opModeList'
import { loadLastOpMode, saveLastOpMode } from './playSettings'
import {
  consoleEntry,
  EMPTY_OPMODE_LIST,
  EMPTY_REGISTERED_LIST,
  isRunActive,
  listedOpModes,
  newRun,
  usePlayStore,
  withEntries,
  withPendingConfig,
  type PlayData,
  type RegisteredListState,
  type RegisteredProblem
} from './playStore'
import { chooseRobotConfig, generationWarning } from './robotConfig'
import { buildWorldSpec, type WorldSpecResult } from './worldSpec'

// 실행 흐름: OpMode 목록 읽기, INIT(필요하면 저장) → START → STOP, 일시 정지·한 단계·속도, 게임패드,
// 그리고 메인의 PlayEvent를 스토어에 넣는 구독. JVM·컴파일·페이스는 메인(src/main/sidecar)이 맡는다.

// ---- OpMode 목록 ----

let opModeRequest = 0

// TeamCode의 OpMode를 다시 읽는다(프로젝트를 열 때, 선택 목록을 열 때, 창 포커스 때). 늦게 온 이전 결과는 버린다.
// 등록기(@OpModeRegistrar)가 있으면 그것이 등록하는 OpMode도 읽는다(refreshRegisteredOpModes).
export async function refreshOpModes(): Promise<void> {
  const root = useProjectStore.getState().root
  const request = ++opModeRequest
  if (!root) {
    usePlayStore.setState({ opModeList: EMPTY_OPMODE_LIST })
    return
  }
  const current = usePlayStore.getState().opModeList
  // 같은 프로젝트면 이전 목록을 보인 채로 읽는다
  if (current.root !== root)
    usePlayStore.setState({ opModeList: { ...EMPTY_OPMODE_LIST, root, status: 'loading' } })
  let result: ListOpModesResult
  try {
    result = await window.api.listOpModes(root)
  } catch (error) {
    result = { ok: false, code: 'notAllowed', detail: ipcErrorDetail(error) }
  }
  if (request !== opModeRequest || useProjectStore.getState().root !== root) return
  if (result.ok) {
    const previous = usePlayStore.getState().opModeList
    const registrars = result.registrars
    usePlayStore.setState({
      opModeList: {
        root,
        status: 'ready',
        opModes: [...result.opModes].sort(compareOpModes),
        registrars,
        // 등록기가 있으면 이전 등록 OpMode를 보인 채로 다시 읽는다(고른 것을 잃지 않게)
        registered:
          registrars.length > 0 && previous.root === root
            ? previous.registered
            : EMPTY_REGISTERED_LIST,
        truncated: result.truncated,
        hasTeamCode: result.hasTeamCode,
        detail: ''
      }
    })
    if (registrars.length > 0) await refreshRegisteredOpModes(root)
    return
  }
  // 읽지 못하면 이 프로젝트의 이전 목록은 그대로 두고(잠깐의 실패로 고른 OpMode를 잃지 않게) 이유만 보인다
  const previous = usePlayStore.getState().opModeList
  usePlayStore.setState({
    opModeList: {
      ...(previous.root === root ? previous : { ...EMPTY_OPMODE_LIST, root }),
      status: 'failed',
      detail: result.detail
    }
  })
}

// ---- 등록기 OpMode ----

// 루트마다 한 번에 하나만 읽는다(JVM에서 등록기를 실행한다. 메인이 결과를 캐시해 같으면 JVM을 띄우지 않는다). 읽는
// 동안 다시 부르면 끝난 뒤 한 번 더 읽는다(그사이 바뀐 파일을 놓치지 않게).
const registeredReads = new Map<string, { promise: Promise<void>; again: boolean }>()
// Console에 마지막으로 남긴 문제(같은 문제를 창 포커스마다 다시 남기지 않는다). 다른 프로젝트를 열면 지운다.
let loggedRegisteredProblem: { root: string; key: string } | null = null

function setRegistered(root: string, patch: Partial<RegisteredListState>): void {
  usePlayStore.setState((state) =>
    state.opModeList.root === root && state.opModeList.registrars.length > 0
      ? {
          opModeList: {
            ...state.opModeList,
            registered: { ...state.opModeList.registered, ...patch }
          }
        }
      : {}
  )
}

export function refreshRegisteredOpModes(root: string): Promise<void> {
  const running = registeredReads.get(root)
  if (running) {
    running.again = true
    return running.promise
  }
  const entry = { promise: Promise.resolve(), again: false }
  entry.promise = (async () => {
    try {
      do {
        entry.again = false
        await readRegistered(root)
      } while (entry.again && useProjectStore.getState().root === root)
    } finally {
      registeredReads.delete(root)
    }
  })()
  registeredReads.set(root, entry)
  return entry.promise
}

async function readRegistered(root: string): Promise<void> {
  const { session } = useProjectStore.getState()
  setRegistered(root, { status: 'loading' })
  let result: ListRegisteredResult
  try {
    result = await window.api.listRegisteredOpModes(root)
  } catch (error) {
    result = { ok: false, code: 'failed', detail: ipcErrorDetail(error) }
  }
  const project = useProjectStore.getState()
  if (project.root !== root || project.session !== session) return
  if (!result.ok) {
    // 읽지 못하면 이전 등록 OpMode는 그대로 둔다(annotated 목록과 같음)
    const problem: RegisteredProblem = { kind: 'failed', code: result.code, detail: result.detail }
    setRegistered(root, { status: 'failed', problem })
    logRegisteredProblem(root, problem, result)
    return
  }
  const errors = result.diagnostics.filter((d) => d.kind === 'error').length
  const problem: RegisteredProblem | null =
    errors > 0
      ? { kind: 'compile', errors }
      : result.errors.length > 0
        ? { kind: 'registrar', registrars: result.errors.map((error) => error.registrar) }
        : null
  setRegistered(root, {
    status: 'ready',
    opModes: [...result.opModes].sort(compareOpModes),
    problem
  })
  logRegisteredProblem(root, problem, result)
}

// 문제를 Console에도 남긴다(컴파일 진단은 더블클릭하면 그 줄을 연다). 같은 결과는 한 번만 남긴다.
function logRegisteredProblem(
  root: string,
  problem: RegisteredProblem | null,
  result: ListRegisteredResult
): void {
  const key = problem === null ? '' : JSON.stringify(result)
  if (loggedRegisteredProblem?.root === root && loggedRegisteredProblem.key === key) return
  loggedRegisteredProblem = { root, key }
  if (problem === null) return
  const added: ConsoleEntry[] = []
  if (problem.kind === 'failed')
    added.push(
      consoleEntry(
        {
          type: 'notice',
          key: 'registeredFailed',
          params: {
            reason: i18n.t(`play.list.registeredFailure.${problem.code}`),
            detail: problem.detail
          }
        },
        null,
        'error'
      )
    )
  else if (result.ok) {
    if (problem.kind === 'compile')
      added.push(
        consoleEntry(
          { type: 'notice', key: 'registeredCompileFailed', params: { count: problem.errors } },
          null,
          'error'
        )
      )
    for (const diagnostic of result.diagnostics)
      added.push(consoleEntry({ type: 'diagnostic', diagnostic }, null, undefined, root))
    for (const error of result.errors)
      added.push(
        consoleEntry(
          {
            type: 'error',
            kind: 'registrar',
            message: `${error.registrar}: ${error.message}`,
            exception: null,
            stack: [],
            thread: ''
          },
          null,
          undefined,
          root
        )
      )
  }
  usePlayStore.setState((state) => withEntries(state, added))
}

// DS처럼 고른 OpMode는 프로젝트마다 기억한다(key는 opModeKey). 실행 중에는 바꾸지 않는다.
export function selectOpMode(key: string): void {
  const root = useProjectStore.getState().root
  if (!root || isRunActive(usePlayStore.getState().run)) return
  usePlayStore.setState({ selectedClass: key })
  saveLastOpMode(root, key)
}

// ---- INIT을 막는 이유 ----

export type InitBlock = 'noProject' | 'noTeamCode' | 'noOpMode' | 'busy' | 'running'

// INIT을 누를 수 없는 이유(누를 수 있으면 null). 툴바 버튼의 도움말이 쓴다.
export function initBlock(
  project: { root: string | null; busy: boolean },
  play: Pick<PlayData, 'opModeList' | 'selectedClass' | 'run'>
): InitBlock | null {
  if (isRunActive(play.run)) return 'running'
  if (!project.root) return 'noProject'
  const list = play.opModeList
  if (list.root === project.root && list.status === 'ready' && !list.hasTeamCode)
    return 'noTeamCode'
  if (list.root !== project.root || !findOpMode(listedOpModes(list), play.selectedClass))
    return 'noOpMode'
  if (project.busy) return 'busy'
  return null
}

function currentInitBlock(): InitBlock | null {
  return initBlock(useProjectStore.getState(), usePlayStore.getState())
}

// ---- 알림 ----

let lastPlayNotice = 0

function replacePlayNotice(...args: Parameters<typeof showNotice>): void {
  dismissNotice(lastPlayNotice)
  lastPlayNotice = showNotice(...args)
}

const INIT_FAILED_NOTICES: Record<
  Exclude<PlayInitResult, { ok: true }>['code'],
  { level: 'warning' | 'error'; key: NoticeKey }
> = {
  notAllowed: { level: 'error', key: 'playNotAllowed' },
  missing: { level: 'warning', key: 'playMissing' },
  noJdk: { level: 'error', key: 'playNoJdk' },
  noSidecar: { level: 'error', key: 'playNoSidecar' },
  busy: { level: 'warning', key: 'playBusy' },
  failed: { level: 'error', key: 'playFailed' },
  noAndroidSdk: { level: 'error', key: 'playNoAndroidSdk' },
  noAndroidPlatform: { level: 'error', key: 'playNoAndroidPlatform' },
  // 받기 진행 알림을 보인 뒤의 취소만. 그 전(Gradle 읽기·플랫폼 jar, 캐시만 쓴 해석)의 취소는 STOP처럼 끝난다(runInit)
  cancelled: { level: 'warning', key: 'playCancelled' }
}

// ---- 실행 ----

const command = (value: Parameters<typeof window.api.playCommand>[0]): void =>
  window.api.playCommand(value)

function updateRun(
  runId: string,
  patch: (run: NonNullable<PlayData['run']>) => Partial<NonNullable<PlayData['run']>>
): void {
  usePlayStore.setState((state) =>
    state.run && state.run.runId === runId ? { run: { ...state.run, ...patch(state.run) } } : {}
  )
}

function newRunId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

let initInFlight = false

// INIT: 저장하지 않은 변경이 있으면 묻고 저장한 뒤(사이드카는 디스크의 TeamCode와 생성한 구성 XML을 컴파일·읽는다)
// 로봇 구성을 골라 playInit을 보낸다. 진행은 PlayEvent로 온다.
export async function initPlay(): Promise<void> {
  if (initInFlight) return
  initInFlight = true
  try {
    await runInit()
  } finally {
    initInFlight = false
  }
}

async function runInit(): Promise<void> {
  // 입력 중인 칸을 먼저 확정해 변경으로 반영한다(Ctrl+S와 같음). 입력칸이 아니면 포커스를 그대로 둔다
  // (Console 목록 등에서 Ctrl+P를 눌러도 포커스가 <body>로 떨어져 다음 Delete·F가 씬에 가지 않게).
  commitFocusedInput()
  if (currentInitBlock()) return
  if (useProjectStore.getState().dirty) {
    const answer = await showDialog({
      message: i18n.t('play.saveBeforeRun'),
      buttons: [
        { id: 'save', label: i18n.t('play.saveAndRun'), primary: true },
        { id: 'cancel', label: i18n.t('dialog.cancel') }
      ],
      cancelId: 'cancel'
    })
    if (answer !== 'save') return
    if (!(await saveProject())) return
  }
  // 묻고 저장하는 사이 바뀌었을 수 있다(프로젝트를 닫음, 목록이 바뀜)
  if (currentInitBlock()) return
  const { root, generation } = useProjectStore.getState()
  const play = usePlayStore.getState()
  const opMode = findOpMode(listedOpModes(play.opModeList), play.selectedClass)
  if (!root || !opMode) return

  const config = chooseRobotConfig(
    useSceneStore.getState().objects,
    useEditorStore.getState().selectedId
  )
  const configPath = config?.configPath ?? null
  const warning = generationWarning(generation, configPath)
  // 운동학 시뮬레이터의 세계(구성과 같은 로봇). 저장한 뒤의 씬이라 디스크의 생성 구성과 장치 이름이 같다
  // (생성이 막혔거나 팀이 고친 구성이면 다를 수 있어 알린다).
  const world = config ? worldFor(config.robotId, play.settings) : null
  const runId = newRunId()
  if (play.consolePrefs.clearOnPlay) play.clearConsole()
  // 이전 실행의 잔상·Dashboard 오버레이·설정은 다음 INIT에 지운다(Unity처럼 로봇은 편집 위치에서 다시 시작한다)
  usePlayStore.setState({
    simPose: null,
    ghostPose: null,
    dash: null,
    dashOverlay: null,
    dashConfig: null,
    run: newRun({
      runId,
      root,
      opMode,
      robotId: config?.robotId ?? null,
      configPath,
      speed: play.settings.speed,
      paused: play.paused
    })
  })
  const { addConsole } = usePlayStore.getState()
  addConsole({ type: 'run', name: opMode.name, config: configPath })
  if (warning) addConsole({ type: 'notice', ...warning }, null, 'warning')
  if (warning && world?.spec && world.spec.wheels.length > 0)
    addConsole({ type: 'notice', key: 'worldGenerationStale', params: {} }, null, 'warning')
  for (const notice of world?.warnings ?? [])
    addConsole({ type: 'notice', ...notice }, null, 'warning')
  dismissNotice(lastPlayNotice)
  lastPlayNotice = 0

  let result: PlayInitResult
  try {
    result = await window.api.playInit({
      runId,
      root,
      // 등록기 OpMode: className·path는 그것을 등록한 등록기 클래스와 소스다
      opMode: opMode.registered
        ? {
            className: opMode.registered.registrar,
            path: opMode.path,
            flavor: opMode.flavor,
            registeredName: opMode.name
          }
        : { className: opMode.className, path: opMode.path, flavor: opMode.flavor },
      configPath,
      settings: play.settings,
      world: world?.spec ?? null
    })
  } catch (error) {
    failRun(runId, 'error', 'playInitFailed', ipcErrorDetail(error))
    return
  }
  const run = usePlayStore.getState().run
  if (!run || run.runId !== runId) return
  if (!result.ok) {
    // 받기 진행(네트워크에 닿을 때부터 온다)이 오기 전에 STOP이 멈춘 INIT은 받던 것이 없다: 받기 취소로 알리지 않고 JVM을
    // 띄운 뒤의 STOP처럼 끝낸다(라이브러리가 없는 프로젝트의 빠른 STOP·두 번 누름·다른 프로젝트 열기)
    if (result.code === 'cancelled' && !run.libraryProgress) {
      endStoppedBeforeLaunch(runId, run.status.tNanos)
      return
    }
    const notice = INIT_FAILED_NOTICES[result.code]
    failRun(runId, notice.level, notice.key, result.detail)
    // 그사이 OpMode 파일을 옮기거나 지웠을 수 있다
    if (result.code === 'missing') void refreshOpModes()
    return
  }
  updateRun(runId, () => ({ accepted: true }))
  if (result.configMissing && run.configPath)
    usePlayStore
      .getState()
      .addConsole(
        { type: 'notice', key: 'configMissing', params: { file: run.configPath } },
        null,
        'warning'
      )
  if (run.stopRequested) {
    command({ type: 'stop' })
    return
  }
  // Unity처럼 일시 정지를 켜 둔 채 시작하면 init에서 바로 멈춘다
  if (usePlayStore.getState().paused) command({ type: 'pause', paused: true })
  // 응답을 기다리는 동안 바꾼 속도
  const { speed } = usePlayStore.getState().settings
  if (speed !== play.settings.speed) command({ type: 'speed', speed })
  if (isRunActive(usePlayStore.getState().run)) startGamepads()
}

// 세계 설명을 만들다 예상하지 못한 오류가 나도 실행은 시뮬레이터 없이 계속한다(Console에 알림)
function worldFor(robotId: string, settings: PlayData['settings']): WorldSpecResult {
  try {
    return buildWorldSpec(useSceneStore.getState().objects, robotId, settings)
  } catch (error) {
    return {
      spec: null,
      warnings: [{ key: 'worldInvalid', params: { detail: ipcErrorDetail(error) } }]
    }
  }
}

// 실패 알림의 행동 버튼: 고칠 곳(환경 설정의 JDK·Android SDK 칸)을 연다
function failedNoticeAction(key: NoticeKey): Parameters<typeof showNotice>[3] {
  if (key === 'playNoJdk')
    return { action: { label: 'openJdkPreferences', run: () => openPreferences('jdk') } }
  if (key === 'playNoAndroidSdk' || key === 'playNoAndroidPlatform')
    return {
      action: { label: 'openAndroidSdkPreferences', run: () => openPreferences('androidSdk') }
    }
  return {}
}

function failRun(runId: string, level: 'warning' | 'error', key: NoticeKey, detail: string): void {
  const run = usePlayStore.getState().run
  if (!run || run.runId !== runId) return
  usePlayStore.setState({ run: null, simPose: null })
  usePlayStore.getState().addConsole({ type: 'initFailed', notice: key, detail }, null, level)
  replacePlayNotice(level, key, { detail }, failedNoticeAction(key))
}

// JVM을 띄우기 전에 STOP으로 멈춘 실행은 메인이 보내는 끝(finished stopped)과 같은 길로 끝낸다: 알림 없이 Console에 정보
// 줄, 그사이 다른 프로젝트를 열었으면 실행을 지운다(handlePlayEvent). OpMode를 돌리지 않았으므로 preselectTeleOp은 없다.
function endStoppedBeforeLaunch(runId: string, tNanos: number): void {
  handlePlayEvent({
    type: 'finished',
    runId,
    tNanos,
    reason: 'stopped',
    detail: '',
    preselectTeleOp: ''
  })
}

export function startPlay(): void {
  const { run } = usePlayStore.getState()
  if (!run || run.phase !== 'init' || !run.accepted || run.startRequested || run.stopRequested)
    return
  updateRun(run.runId, () => ({ startRequested: true }))
  command({ type: 'start' })
  // Unity의 Play Focused: 씬 뷰에 포커스를 줘 키보드 게임패드가 바로 받고, 툴바 버튼에 남은 포커스로 Enter(start)가
  // STOP을 누르지 않게 한다
  focusSceneView()
}

// STOP(INIT 중의 작은 ■도 같다). playInit 응답 전에도 바로 보낸다: 메인이 INIT을 준비하는 중(Gradle 읽기~라이브러리
// 받기)이면 그것을 멈추고 INIT을 cancelled로 끝낸다(라이브러리 진행 알림의 [취소]도 이것이다). 그 전 단계(확인·JDK)면
// 메인이 버리므로 받기가 시작될 때(첫 진행, handlePlayEvent)와 응답을 받은 뒤(runInit) 한 번 더 보낸다. 받기 진행 전에
// 멈춘 INIT은 경고 없이 STOP처럼 끝난다(받기 취소 알림은 진행 알림을 보인 뒤만).
export function stopPlay(): void {
  const { run } = usePlayStore.getState()
  if (!isRunActive(run) || run.stopRequested) return
  updateRun(run.runId, () => ({ stopRequested: true }))
  command({ type: 'stop' })
}

// 툴바의 한 버튼과 Ctrl+P: INIT → START → STOP 순서
export function playButton(): void {
  const { run } = usePlayStore.getState()
  if (!isRunActive(run)) {
    void initPlay()
    return
  }
  if (run.phase === 'init' && !run.startRequested) startPlay()
  else stopPlay()
}

// 일시 정지 토글. 실행 전에도 켤 수 있다(다음 INIT이 init에서 멈춘다).
export function togglePause(): void {
  const { run, paused } = usePlayStore.getState()
  const next = !paused
  usePlayStore.setState({ paused: next })
  if (!isRunActive(run)) return
  updateRun(run.runId, (current) => ({ status: { ...current.status, paused: next } }))
  if (run.accepted) command({ type: 'pause', paused: next })
}

export function canStep(data: Pick<PlayData, 'run' | 'paused'>): boolean {
  const { run } = data
  return (
    isRunActive(run) &&
    run.accepted &&
    data.paused &&
    !run.stopRequested &&
    (run.phase === 'init' || run.phase === 'running')
  )
}

// Unity의 Step: 일시 정지 중에 루프 하나만 진행한다
export function stepPlay(): void {
  if (canStep(usePlayStore.getState())) command({ type: 'step' })
}

// playInit 응답 전이면 받은 뒤 보낸다(runInit)
export function setPlaySpeed(speed: PlaySpeed): void {
  usePlayStore.getState().updateSettings({ speed })
  const { run } = usePlayStore.getState()
  if (!isRunActive(run)) return
  updateRun(run.runId, (current) => ({ status: { ...current.status, speed } }))
  if (run.accepted) command({ type: 'speed', speed })
}

// ---- 게임패드 ----

// 키보드 게임패드(실행 중 씬 뷰에 포커스가 있을 때만, keyboardGamepad.ts). 포커스를 잃는 등으로 모두 떼면 다음 읽기를
// 기다리지 않고 바로 보낸다(창을 내리면 interval이 1초에 한 번으로 늦어져 그동안 눌린 값으로 달린다).
const keyboardPad = createKeyboardPad(keyboardPadActive, () => poller.pollNow())

// 단축키 리스너(EditorLayout)의 keyboardGamepad: 키보드가 지금 게임패드이거나, 게임패드로 누른 키의 반복 입력이다
// (그 키를 뗄 때까지. Backspace(back)를 누른 채 실행이 끝나도 반복 입력이 편집기의 Delete가 되지 않게)
export function isKeyboardPadInput(event: PadKeyEvent): boolean {
  return keyboardPadActive() || keyboardPad.isPadRepeat(event)
}

const poller = createGamepadPoller({
  getGamepads: browserGamepads,
  send: (pair: GamepadPair) => window.api.playGamepads(pair),
  onSlots: (gamepads) => usePlayStore.setState({ gamepads }),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  keyboard: {
    state: () => keyboardPad.state(),
    releaseAll: () => keyboardPad.releaseAll(),
    setSlot: (slot) => useKeyboardPadStore.setState({ slot })
  }
})

function startGamepads(): void {
  poller.start()
}

function stopGamepads(): void {
  poller.stop()
}

// 실행 중에는 폴러가 자리(키보드 포함)를 보인다
function updateGamepadSlots(): void {
  if (poller.running()) return
  const slots = padInfo(browserGamepads())
  if (!samePadSlots(slots, usePlayStore.getState().gamepads))
    usePlayStore.setState({ gamepads: slots })
}

// ---- 이벤트 ----

export function handlePlayEvent(event: PlayEvent): void {
  const before = usePlayStore.getState().run
  if (!before || before.runId !== event.runId) return
  usePlayStore.getState().applyEvent(event)
  const after = usePlayStore.getState().run
  if (!isRunActive(after)) stopGamepads()
  // 메인이 준비를 시작하기 전에 누른 STOP은 버려졌을 수 있다(stopPlay): 받기가 시작되면 다시 보내 받기를 멈춘다
  if (
    event.type === 'libraryProgress' &&
    before.stopRequested &&
    !before.libraryProgress &&
    after?.libraryProgress
  )
    command({ type: 'stop' })
  // Autonomous가 끝나면 DS처럼 preselectTeleOp으로 정한 TeleOp을 고른다. 그사이 다른 프로젝트를 열었으면
  // (STOP을 보내고 끝을 기다리는 중) 그 프로젝트의 같은 이름 OpMode를 고르지 않는다.
  if (
    event.type === 'finished' &&
    before.opMode.flavor === 'Autonomous' &&
    before.root === useProjectStore.getState().root &&
    usePlayStore.getState().opModeList.root === before.root
  ) {
    const teleOp = preselectedTeleOp(
      listedOpModes(usePlayStore.getState().opModeList),
      event.preselectTeleOp
    )
    if (teleOp) selectOpMode(opModeKey(teleOp))
  }
  // 다른 프로젝트를 연 뒤 끝난 실행은 지운다(그 프로젝트의 텔레메트리·장치·시간이 남지 않게, Console은 그대로)
  if (!isRunActive(after) && before.root !== useProjectStore.getState().root)
    usePlayStore.setState({
      run: null,
      simPose: null,
      ghostPose: null,
      dash: null,
      dashOverlay: null,
      dashConfig: null
    })
}

// 프로젝트를 바꾸면(다른 프로젝트를 열거나 같은 것을 다시 염) 지금 실행을 멈추고 그 프로젝트의 목록·선택을 읽는다
function onProjectChanged(root: string | null, rootChanged: boolean): void {
  const { run } = usePlayStore.getState()
  // 끝난 실행은 바로 지운다(아직 도는 실행은 끝날 때 handlePlayEvent가 지운다)
  if (run && run.phase === 'finished' && run.root !== root) usePlayStore.setState({ run: null })
  // 잔상·Dashboard 오버레이·설정은 프로젝트를 열 때 지운다(다른 씬이거나 다시 읽은 씬이다. 설정의 [파일에 반영]은 그
  // 실행의 TeamCode를 가리킨다)
  usePlayStore.setState({ ghostPose: null, dashOverlay: null, dashConfig: null })
  if (rootChanged) loggedRegisteredProblem = null
  if (isRunActive(run)) {
    // 아직 도는 실행은 새로 연 씬과 떼어 놓는다: 그 로봇을 시뮬레이터 자세로 그리거나 잠그지 않고, 끝나도 잔상을 남기지
    // 않는다(같은 프로젝트를 다시 열면 오브젝트 id가 같다). Dashboard 오버레이·설정도 더 받지 않는다.
    usePlayStore.setState((state) =>
      state.run?.runId === run.runId
        ? { run: { ...state.run, robotId: null, detached: true }, simPose: null }
        : {}
    )
    stopPlay()
  }
  if (rootChanged)
    usePlayStore.setState({
      selectedClass: root ? loadLastOpMode(root) : null,
      opModeList: EMPTY_OPMODE_LIST
    })
  void refreshOpModes()
}

const FOCUS_REFRESH_DELAY = 300
let focusTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFocusRefresh(): void {
  if (focusTimer !== null) clearTimeout(focusTimer)
  focusTimer = setTimeout(() => {
    focusTimer = null
    const { root, busy } = useProjectStore.getState()
    if (root && !busy) void refreshOpModes()
  }, FOCUS_REFRESH_DELAY)
}

let initialized = false

// 앱 시작 때 한 번(EditorLayout): PlayEvent 구독, 프로젝트 변경, 창 포커스, 창 닫기·새로 고침 때 STOP, 게임패드 연결
export function initPlaySession(): void {
  if (initialized) return
  initialized = true
  window.api.onPlayEvent(handlePlayEvent)
  useProjectStore.subscribe((state, previous) => {
    if (state.root !== previous.root || state.session !== previous.session)
      onProjectChanged(state.root, state.root !== previous.root)
  })
  window.addEventListener('focus', scheduleFocusRefresh)
  // 창을 닫거나 새로 고치면 JVM을 멈추게 한다(메인도 창이 닫히면 사이드카를 정리한다)
  window.addEventListener('beforeunload', () => {
    if (isRunActive(usePlayStore.getState().run)) command({ type: 'stop' })
  })
  window.addEventListener('gamepadconnected', updateGamepadSlots)
  window.addEventListener('gamepaddisconnected', updateGamepadSlots)
  installKeyboardGamepad(keyboardPad, window)
  installLibraryNotice(stopPlay)
  const { root } = useProjectStore.getState()
  if (root) onProjectChanged(root, true)
}

// ---- Dashboard 설정(Config 탭) ----

// Config 탭 값을 고칠 수 있는지: 그 실행이 받아들여졌고 INIT·실행 중이다(정지 중·끝난 뒤는 읽기 전용)
export function canEditDashConfig(data: Pick<PlayData, 'run' | 'dashConfig'>): boolean {
  const { run, dashConfig } = data
  return (
    isRunActive(run) &&
    run.accepted &&
    !run.stopRequested &&
    !run.detached &&
    (run.phase === 'init' || run.phase === 'running') &&
    dashConfig?.runId === run.runId
  )
}

// 실행 중 Config 탭에서 확정한 값 하나를 보낸다(다음 틱 경계에서 사이드카가 적용하고 트리를 다시 보낸다). 일시 정지
// 중이면 다음 틱 답에 실려 간다. 새 트리를 받을 때까지 칸은 보낸 값을 보인다. 메인이 받지 않을 명령(너무 긴 글자 등,
// configCommandFits)은 보내지 않는다(입력칸이 먼저 막는다).
export function sendDashConfig(path: readonly string[], value: string): void {
  const state = usePlayStore.getState()
  if (!canEditDashConfig(state) || !state.dashConfig || !configCommandFits(path, value)) return
  usePlayStore.setState({ dashConfig: withPendingConfig(state.dashConfig, path, value) })
  command({ type: 'config', path: [...path], value })
}

// 테스트용: 모듈 상태를 처음으로 되돌린다
export function resetPlayActionsState(): void {
  initInFlight = false
  opModeRequest = 0
  lastPlayNotice = 0
  registeredReads.clear()
  loggedRegisteredProblem = null
  poller.stop()
  keyboardPad.releaseAll()
}
