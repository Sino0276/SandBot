import i18n from 'i18next'
import type { ListOpModesResult, PlayEvent, PlayInitResult, PlaySpeed } from '../../../shared/play'
import { openPreferences, showDialog } from '../editor/dialogStore'
import { useEditorStore } from '../editor/editorStore'
import { dismissNotice, showNotice, type NoticeKey } from '../editor/noticeStore'
import { ipcErrorDetail } from '../java/ipcError'
import { saveProject } from '../project/projectActions'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import {
  browserGamepads,
  createGamepadPoller,
  padInfo,
  samePadSlots,
  type GamepadPair
} from './gamepad'
import { compareOpModes, findOpMode, preselectedTeleOp } from './opModeList'
import { loadLastOpMode, saveLastOpMode } from './playSettings'
import { EMPTY_OPMODE_LIST, isRunActive, newRun, usePlayStore, type PlayData } from './playStore'
import { chooseRobotConfig, generationWarning } from './robotConfig'

// 실행 흐름: OpMode 목록 읽기, INIT(필요하면 저장) → START → STOP, 일시 정지·한 단계·속도, 게임패드,
// 그리고 메인의 PlayEvent를 스토어에 넣는 구독. JVM·컴파일·페이스는 메인(src/main/sidecar)이 맡는다.

// ---- OpMode 목록 ----

let opModeRequest = 0

// TeamCode의 OpMode를 다시 읽는다(프로젝트를 열 때, 선택 목록을 열 때, 창 포커스 때). 늦게 온 이전 결과는 버린다.
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
    usePlayStore.setState({
      opModeList: {
        root,
        status: 'ready',
        opModes: [...result.opModes].sort(compareOpModes),
        truncated: result.truncated,
        hasTeamCode: result.hasTeamCode,
        detail: ''
      }
    })
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

// DS처럼 고른 OpMode는 프로젝트마다 기억한다. 실행 중에는 바꾸지 않는다.
export function selectOpMode(className: string): void {
  const root = useProjectStore.getState().root
  if (!root || isRunActive(usePlayStore.getState().run)) return
  usePlayStore.setState({ selectedClass: className })
  saveLastOpMode(root, className)
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
  if (list.root !== project.root || !findOpMode(list.opModes, play.selectedClass)) return 'noOpMode'
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
  failed: { level: 'error', key: 'playFailed' }
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
  if (typeof document !== 'undefined') {
    const active = document.activeElement
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    )
      active.blur()
  }
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
  const opMode = findOpMode(play.opModeList.opModes, play.selectedClass)
  if (!root || !opMode) return

  const config = chooseRobotConfig(
    useSceneStore.getState().objects,
    useEditorStore.getState().selectedId
  )
  const configPath = config?.configPath ?? null
  const warning = generationWarning(generation, configPath)
  const runId = newRunId()
  if (play.consolePrefs.clearOnPlay) play.clearConsole()
  usePlayStore.setState({
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
  dismissNotice(lastPlayNotice)
  lastPlayNotice = 0

  let result: PlayInitResult
  try {
    result = await window.api.playInit({
      runId,
      root,
      opMode: { className: opMode.className, path: opMode.path, flavor: opMode.flavor },
      configPath,
      settings: play.settings
    })
  } catch (error) {
    failRun(runId, 'error', 'playInitFailed', ipcErrorDetail(error))
    return
  }
  const run = usePlayStore.getState().run
  if (!run || run.runId !== runId) return
  if (!result.ok) {
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

function failRun(runId: string, level: 'warning' | 'error', key: NoticeKey, detail: string): void {
  const run = usePlayStore.getState().run
  if (!run || run.runId !== runId) return
  usePlayStore.setState({ run: null })
  usePlayStore.getState().addConsole({ type: 'initFailed', notice: key, detail }, null, level)
  replacePlayNotice(
    level,
    key,
    { detail },
    key === 'playNoJdk'
      ? { action: { label: 'openJdkPreferences', run: () => openPreferences('jdk') } }
      : {}
  )
}

export function startPlay(): void {
  const { run } = usePlayStore.getState()
  if (!run || run.phase !== 'init' || !run.accepted || run.startRequested || run.stopRequested)
    return
  updateRun(run.runId, () => ({ startRequested: true }))
  command({ type: 'start' })
}

// STOP(INIT 중의 작은 ■도 같다). playInit 응답 전이면 받은 뒤 보낸다.
export function stopPlay(): void {
  const { run } = usePlayStore.getState()
  if (!isRunActive(run) || run.stopRequested) return
  updateRun(run.runId, () => ({ stopRequested: true }))
  if (run.accepted) command({ type: 'stop' })
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

const poller = createGamepadPoller({
  getGamepads: browserGamepads,
  send: (pair: GamepadPair) => window.api.playGamepads(pair),
  onSlots: (gamepads) => usePlayStore.setState({ gamepads }),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
})

function startGamepads(): void {
  poller.start()
}

function stopGamepads(): void {
  poller.stop()
}

function updateGamepadSlots(): void {
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
  // Autonomous가 끝나면 DS처럼 preselectTeleOp으로 정한 TeleOp을 고른다. 그사이 다른 프로젝트를 열었으면
  // (STOP을 보내고 끝을 기다리는 중) 그 프로젝트의 같은 이름 OpMode를 고르지 않는다.
  if (
    event.type === 'finished' &&
    before.opMode.flavor === 'Autonomous' &&
    before.root === useProjectStore.getState().root &&
    usePlayStore.getState().opModeList.root === before.root
  ) {
    const teleOp = preselectedTeleOp(
      usePlayStore.getState().opModeList.opModes,
      event.preselectTeleOp
    )
    if (teleOp) selectOpMode(teleOp.className)
  }
  // 다른 프로젝트를 연 뒤 끝난 실행은 지운다(그 프로젝트의 텔레메트리·장치·시간이 남지 않게, Console은 그대로)
  if (!isRunActive(after) && before.root !== useProjectStore.getState().root)
    usePlayStore.setState({ run: null })
}

// 프로젝트를 바꾸면(다른 프로젝트를 열거나 같은 것을 다시 염) 지금 실행을 멈추고 그 프로젝트의 목록·선택을 읽는다
function onProjectChanged(root: string | null, rootChanged: boolean): void {
  const { run } = usePlayStore.getState()
  // 끝난 실행은 바로 지운다(아직 도는 실행은 끝날 때 handlePlayEvent가 지운다)
  if (run && run.phase === 'finished' && run.root !== root) usePlayStore.setState({ run: null })
  if (isRunActive(run)) stopPlay()
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
  const { root } = useProjectStore.getState()
  if (root) onProjectChanged(root, true)
}

// 테스트용: 모듈 상태를 처음으로 되돌린다
export function resetPlayActionsState(): void {
  initInFlight = false
  opModeRequest = 0
  lastPlayNotice = 0
  poller.stop()
}
