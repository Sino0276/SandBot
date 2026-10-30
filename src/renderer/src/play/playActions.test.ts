import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_DASH_TEXT, type DashConfigNode } from '../../../shared/dashboard'
import type {
  ListOpModesResult,
  ListRegisteredResult,
  OpModeInfo,
  PlayCommand,
  PlayEvent,
  PlayInitRequest,
  PlayInitResult
} from '../../../shared/play'
import { useDialogStore, usePreferencesStore } from '../editor/dialogStore'
import { useEditorStore } from '../editor/editorStore'
import { cancelNotice, runNoticeAction, useNoticeStore } from '../editor/noticeStore'
import { propertyDefaults } from '../hardware/catalog'
import { saveProject } from '../project/projectActions'
import { useProjectStore } from '../project/projectStore'
import type { SceneObject, SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { defaultWheel } from '../scene/wheel'
import {
  handlePlayEvent,
  initBlock,
  initPlay,
  initPlaySession,
  isKeyboardPadInput,
  playButton,
  refreshOpModes,
  refreshRegisteredOpModes,
  resetPlayActionsState,
  selectOpMode,
  sendDashConfig,
  startPlay,
  setPlaySpeed,
  stepPlay,
  stopPlay,
  togglePause
} from './playActions'
import { shortcutCommand } from '../editor/shortcuts'
import { emptyGamepadState } from './gamepad'
import { SCENE_VIEW_ATTRIBUTE, useKeyboardPadStore } from './keyboardGamepad'
import { opModeKey } from './opModeList'
import { EMPTY_OPMODE_LIST, initialPlayData, listedOpModes, usePlayStore } from './playStore'

// 실행 흐름(playActions)을 window.api 모의로 시험한다. 저장(projectActions)은 모의로 바꾼다.
vi.mock('../project/projectActions', () => ({ saveProject: vi.fn(async () => true) }))

const P = 'src/main/java/org/firstinspires/ftc/teamcode/'

function opMode(name: string, flavor: OpModeInfo['flavor'], preselectTeleOp = ''): OpModeInfo {
  return {
    className: `org.firstinspires.ftc.teamcode.${name}`,
    path: `${P}${name}.java`,
    line: 5,
    flavor,
    name,
    group: '',
    preselectTeleOp
  }
}

const DRIVE = opMode('Drive', 'TeleOp')
const AUTO = opMode('RedAuto', 'Autonomous', 'Drive')
const LIST: ListOpModesResult = {
  ok: true,
  opModes: [AUTO, DRIVE],
  registrars: [],
  truncated: false,
  hasTeamCode: true
}

const T0 = { position: [0, 0, 0], rotation: [0, 0, 0] } as SceneObject['transform']
const SCENE: SceneObjects = {
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
  arm: {
    id: 'arm',
    name: 'Arm',
    kind: 'part',
    parentId: 'bot',
    transform: T0,
    components: [
      {
        id: 'm',
        type: 'motor',
        name: 'arm',
        hub: 'controlHub',
        port: 0,
        props: propertyDefaults('motor')
      }
    ]
  }
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const commands: PlayCommand[] = []
const gamepads: unknown[] = []
const listeners = new Map<string, (() => void)[]>()
let playEventListener: ((event: PlayEvent) => void) | null = null
let initResult: () => Promise<PlayInitResult> = async () => ({ ok: true })
let listResult: () => Promise<ListOpModesResult> = async () => LIST
let registeredResult: () => Promise<ListRegisteredResult> = async () => ({
  ok: true,
  opModes: [],
  diagnostics: [],
  errors: []
})

const api = {
  listOpModes: vi.fn<(root: string) => Promise<ListOpModesResult>>(() => listResult()),
  listRegisteredOpModes: vi.fn<(root: string) => Promise<ListRegisteredResult>>(() =>
    registeredResult()
  ),
  playInit: vi.fn<(request: PlayInitRequest) => Promise<PlayInitResult>>(() => initResult()),
  playCommand: (command: PlayCommand) => void commands.push(command),
  playGamepads: (pair: unknown) => void gamepads.push(pair),
  onPlayEvent: (callback: (event: PlayEvent) => void) => {
    playEventListener = callback
    return () => {}
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const lastRequest = (): PlayInitRequest => api.playInit.mock.calls.at(-1)![0]
const runId = (): string => usePlayStore.getState().run!.runId
// 지금 실행의 이벤트(runId를 채운다)
type WithoutRunId<E> = E extends PlayEvent ? Omit<E, 'runId'> : never
const event = (patch: WithoutRunId<PlayEvent>): PlayEvent =>
  ({ runId: runId(), ...patch }) as PlayEvent

beforeAll(() => {
  vi.stubGlobal('window', {
    api,
    addEventListener: (type: string, listener: () => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
  })
  useProjectStore.setState({ root: null })
  initPlaySession()
})

beforeEach(async () => {
  commands.length = 0
  gamepads.length = 0
  initResult = async () => ({ ok: true })
  listResult = async () => LIST
  registeredResult = async () => ({ ok: true, opModes: [], diagnostics: [], errors: [] })
  api.playInit.mockClear()
  api.listOpModes.mockClear()
  api.listRegisteredOpModes.mockClear()
  vi.mocked(saveProject).mockClear()
  vi.mocked(saveProject).mockImplementation(async () => true)
  resetPlayActionsState()
  usePlayStore.setState({ ...initialPlayData() })
  useNoticeStore.setState({ notices: [] })
  useDialogStore.setState({ request: null })
  usePreferencesStore.setState({ open: false, target: null })
  useSceneStore.setState({ objects: SCENE })
  useEditorStore.getState().select(null)
  useProjectStore.setState({ root: '/p', busy: false, dirty: false, generation: null })
  await settle()
  await refreshOpModes()
  selectOpMode(DRIVE.className)
})

afterEach(() => {
  resetPlayActionsState()
})

describe('INIT → START → STOP', () => {
  it('한 버튼으로 INIT, init에서 START, running에서 STOP을 보낸다', async () => {
    playButton()
    await settle()
    expect(api.playInit).toHaveBeenCalledTimes(1)
    const request = lastRequest()
    expect(request).toMatchObject({
      root: '/p',
      opMode: { className: DRIVE.className, path: DRIVE.path, flavor: 'TeleOp' },
      configPath: 'src/main/res/xml/sandbot_robot_hardware.xml',
      settings: usePlayStore.getState().settings
    })
    expect(request.runId).toBe(runId())
    expect(usePlayStore.getState().run!.accepted).toBe(true)
    // 실행을 받으면 게임패드를 읽기 시작해 지금 상태를 한 번 보낸다(패드가 없으면 키보드가 gamepad1, 모두 뗀 상태)
    expect(gamepads).toEqual([[emptyGamepadState(), null]])

    handlePlayEvent(event({ type: 'phase', phase: 'init' }))
    playButton()
    expect(commands).toEqual([{ type: 'start' }])
    // running이 오기 전에 다시 누르면 STOP
    handlePlayEvent(event({ type: 'phase', phase: 'running' }))
    playButton()
    expect(commands).toEqual([{ type: 'start' }, { type: 'stop' }])
    // STOP을 보낸 뒤에는 다시 보내지 않는다
    playButton()
    expect(commands).toHaveLength(2)
    handlePlayEvent(
      event({ type: 'finished', tNanos: 1, reason: 'stopped', detail: '', preselectTeleOp: '' })
    )
    expect(usePlayStore.getState().run!.phase).toBe('finished')
    // 끝난 뒤 누르면 다시 INIT
    playButton()
    await settle()
    expect(api.playInit).toHaveBeenCalledTimes(2)
  })

  it('INIT 중의 작은 ■(START하지 않고 STOP)', async () => {
    await initPlay()
    handlePlayEvent(event({ type: 'phase', phase: 'init' }))
    stopPlay()
    expect(commands).toEqual([{ type: 'stop' }])
  })

  it('playInit 응답 전의 STOP은 바로 보내고(메인이 준비 중이면 INIT을 취소한다) 받은 뒤 한 번 더 보낸다', async () => {
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    stopPlay()
    expect(commands).toEqual([{ type: 'stop' }])
    // 메인이 아직 준비를 시작하지 않아 버렸을 수 있다
    pending.resolve({ ok: true })
    await settle()
    expect(commands).toEqual([{ type: 'stop' }, { type: 'stop' }])
  })

  it('첫 라이브러리 진행 전에 누른 STOP도 받기를 취소한다(진행이 오면 한 번 더 보낸다)', async () => {
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    // 메인이 아직 Gradle·플랫폼 jar·JDK를 보는 중(진행 알림 전)에 STOP
    playButton()
    expect(commands).toEqual([{ type: 'stop' }])
    // 메인이 그 STOP을 받기 전 단계였으면 버렸다: 받기가 시작되면 다시 보낸다(한 번만)
    handlePlayEvent(
      event({ type: 'libraryProgress', phase: 'downloading', done: 0, total: 5, bytes: 0 })
    )
    expect(commands).toEqual([{ type: 'stop' }, { type: 'stop' }])
    handlePlayEvent(
      event({ type: 'libraryProgress', phase: 'downloading', done: 1, total: 5, bytes: 10 })
    )
    expect(commands).toHaveLength(2)
    pending.resolve({ ok: false, code: 'cancelled', detail: '' })
    await settle()
    expect(usePlayStore.getState().run).toBeNull()
    expect(useNoticeStore.getState().notices.map((n) => n.key)).toEqual(['playCancelled'])
  })

  it('받기 진행 전에 STOP이 멈춘 INIT은 받기 취소 경고 없이 보통 STOP처럼 끝난다', async () => {
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    // 라이브러리가 없는 프로젝트에서 실행 버튼을 두 번 누름(두 번째가 STOP). 메인은 Gradle 읽기·플랫폼 jar 뒤에 멈춘다.
    playButton()
    expect(commands).toEqual([{ type: 'stop' }])
    pending.resolve({ ok: false, code: 'cancelled', detail: '' })
    await settle()
    // 받던 것이 없으므로 알림·실패 줄이 없고, JVM을 띄운 뒤의 STOP과 같은 끝(정보 줄)이다
    expect(useNoticeStore.getState().notices).toEqual([])
    const entries = usePlayStore.getState().entries
    expect(entries.some((entry) => entry.type === 'initFailed')).toBe(false)
    expect(entries.at(-1)).toMatchObject({ type: 'finished', reason: 'stopped', level: 'info' })
    expect(usePlayStore.getState().run).toMatchObject({
      phase: 'finished',
      finished: { reason: 'stopped' }
    })
    expect(commands).toEqual([{ type: 'stop' }])
    // 버튼은 다시 INIT이다
    initResult = async () => ({ ok: true })
    playButton()
    await settle()
    expect(api.playInit).toHaveBeenCalledTimes(2)
    expect(usePlayStore.getState().run!.accepted).toBe(true)
  })

  it('받기 진행 전에 멈춘 Autonomous는 OpMode를 돌리지 않았으므로 preselectTeleOp을 고르지 않는다', async () => {
    selectOpMode(AUTO.className)
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    stopPlay()
    pending.resolve({ ok: false, code: 'cancelled', detail: '' })
    await settle()
    expect(usePlayStore.getState().selectedClass).toBe(AUTO.className)
    expect(useNoticeStore.getState().notices).toEqual([])
  })

  it('라이브러리를 받는 중(playInit 응답 전)의 STOP·[취소]는 바로 보내 INIT을 취소한다', async () => {
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    handlePlayEvent(
      event({ type: 'libraryProgress', phase: 'downloading', done: 1, total: 3, bytes: 10 })
    )
    const progress = useNoticeStore.getState().notices.find((n) => n.level === 'progress')
    expect(progress).toMatchObject({ key: 'libraryDownloading', cancellable: true })
    cancelNotice(progress!.id)
    expect(commands).toEqual([{ type: 'stop' }])
    // 두 번 보내지 않는다
    stopPlay()
    expect(commands).toHaveLength(1)
    pending.resolve({ ok: false, code: 'cancelled', detail: '' })
    await settle()
    expect(usePlayStore.getState().run).toBeNull()
    const notices = useNoticeStore.getState().notices
    expect(notices.map((n) => n.key)).toEqual(['playCancelled'])
    expect(commands).toHaveLength(1)
  })

  it('다른 실행의 이벤트는 버린다', async () => {
    await initPlay()
    const before = usePlayStore.getState().run
    handlePlayEvent({ type: 'phase', runId: 'other', phase: 'running' })
    handlePlayEvent({
      type: 'log',
      runId: 'other',
      entries: [{ tNanos: 0, stream: 'out', text: 'x' }]
    })
    expect(usePlayStore.getState().run).toBe(before)
    expect(usePlayStore.getState().entries.some((entry) => entry.type === 'log')).toBe(false)
  })

  it('실행할 때 지우기를 켜 두면 Console을 지우고 실행 줄을 남긴다', async () => {
    usePlayStore.getState().addConsole({ type: 'log', stream: 'out', text: 'old' })
    // 실행 안내(바퀴 없음 경고 등)는 빼고 본다
    const types = (): string[] =>
      usePlayStore
        .getState()
        .entries.filter((entry) => entry.type !== 'notice')
        .map((entry) => entry.type)
    await initPlay()
    expect(types()).toEqual(['run'])
    usePlayStore.getState().setClearOnPlay(false)
    usePlayStore.setState({ run: null })
    await initPlay()
    expect(types()).toEqual(['run', 'run'])
  })

  it('마지막 저장의 생성이 막혔으면 Console에 경고 한 줄', async () => {
    useProjectStore.setState({ generation: { status: 'blocked', errors: 3 } })
    await initPlay()
    const entries = usePlayStore.getState().entries
    expect(entries[1]).toMatchObject({
      type: 'notice',
      key: 'generationBlocked',
      level: 'warning'
    })
  })

  it('메인이 구성 XML이 없다고 하면 Console에 경고 한 줄', async () => {
    initResult = async () => ({ ok: true, configMissing: true })
    await initPlay()
    await settle()
    const configPath = lastRequest().configPath
    expect(configPath).not.toBeNull()
    expect(usePlayStore.getState().entries.at(-1)).toMatchObject({
      type: 'notice',
      key: 'configMissing',
      params: { file: configPath },
      level: 'warning'
    })
  })
})

describe('INIT의 세계 설명(운동학 시뮬레이터)', () => {
  // SCENE의 로봇에 구동 바퀴 하나(arm 모터)
  const withWheel = (): SceneObjects => ({
    ...SCENE,
    wheel: {
      id: 'wheel',
      name: 'Wheel',
      kind: 'part',
      parentId: 'bot',
      transform: { position: [0.1, 0.2, 0.05], rotation: [0, 0, 0] },
      visual: { type: 'mesh', geometryId: 'g:0', color: [1, 1, 1] },
      wheel: { ...defaultWheel('traction'), motor: 'm' }
    }
  })
  const notices = (): unknown[] =>
    usePlayStore
      .getState()
      .entries.filter((entry) => entry.type === 'notice')
      .map((entry) => (entry.type === 'notice' ? entry.key : null))

  it('구성과 같은 로봇의 세계 설명을 보낸다', async () => {
    useSceneStore.setState({ objects: withWheel() })
    await initPlay()
    const { world } = lastRequest()
    expect(world).toMatchObject({
      version: 1,
      robot: { start: { x: 0, y: 0, yaw: 0 } },
      batteryVoltage: usePlayStore.getState().settings.batteryVoltage,
      hubs: ['Control Hub'],
      motors: [{ device: 'arm', modelTag: 'goBILDA5202SeriesMotor', gearbox: 99.5 }],
      wheels: [{ kind: 'traction', motor: 'arm', radius: 0.048, rollers: null }]
    })
    expect(world!.wheels[0].position.x).toBeCloseTo(0.1, 12)
    expect(notices()).toEqual([])
  })

  it('바퀴가 없으면 세계는 보내되 Console에 경고한다', async () => {
    await initPlay()
    expect(lastRequest().world?.wheels).toEqual([])
    expect(usePlayStore.getState().entries.at(-1)).toMatchObject({
      type: 'notice',
      key: 'worldNoWheels',
      level: 'warning'
    })
  })

  it('생성이 막혔으면 장치 이름이 다를 수 있다고 한 줄 더 알린다', async () => {
    useSceneStore.setState({ objects: withWheel() })
    useProjectStore.setState({ generation: { status: 'blocked', errors: 1 } })
    await initPlay()
    expect(notices()).toEqual(['generationBlocked', 'worldGenerationStale'])
  })

  it('하드웨어가 있는 로봇이 없으면 세계도 없다', async () => {
    useSceneStore.setState({
      objects: { bot: { ...SCENE.bot }, wheel: { ...withWheel().wheel } }
    })
    await initPlay()
    expect(lastRequest()).toMatchObject({ configPath: null, world: null })
    expect(notices()).toEqual([])
  })
})

describe('INIT 전 저장', () => {
  it('저장하지 않은 변경이 있으면 묻고, 취소하면 실행하지 않는다', async () => {
    useProjectStore.setState({ dirty: true })
    const run = initPlay()
    await settle()
    expect(useDialogStore.getState().request?.buttons.map((button) => button.id)).toEqual([
      'save',
      'cancel'
    ])
    useDialogStore.getState().answer('cancel')
    await run
    expect(saveProject).not.toHaveBeenCalled()
    expect(api.playInit).not.toHaveBeenCalled()
  })

  it('저장하고 실행: 저장이 실패하면 멈추고, 성공하면 실행한다', async () => {
    useProjectStore.setState({ dirty: true })
    vi.mocked(saveProject).mockImplementation(async () => false)
    let run = initPlay()
    await settle()
    useDialogStore.getState().answer('save')
    await run
    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(api.playInit).not.toHaveBeenCalled()

    vi.mocked(saveProject).mockImplementation(async () => {
      useProjectStore.setState({ dirty: false })
      return true
    })
    run = initPlay()
    await settle()
    useDialogStore.getState().answer('save')
    await run
    expect(api.playInit).toHaveBeenCalledTimes(1)
  })
})

describe('INIT을 막는 이유', () => {
  it('프로젝트 없음, TeamCode 없음, OpMode 없음, 바쁨, 실행 중', () => {
    const play = usePlayStore.getState()
    expect(initBlock({ root: '/p', busy: false }, play)).toBeNull()
    expect(initBlock({ root: null, busy: false }, play)).toBe('noProject')
    expect(initBlock({ root: '/p', busy: true }, play)).toBe('busy')
    expect(initBlock({ root: '/q', busy: false }, play)).toBe('noOpMode')
    expect(initBlock({ root: '/p', busy: false }, { ...play, selectedClass: 'gone' })).toBe(
      'noOpMode'
    )
    expect(
      initBlock(
        { root: '/p', busy: false },
        { ...play, opModeList: { ...play.opModeList, hasTeamCode: false, opModes: [] } }
      )
    ).toBe('noTeamCode')
  })
})

describe('playInit 실패', () => {
  it('JDK가 없으면 실행을 지우고, 환경 설정 JDK 칸을 여는 버튼이 있는 알림을 띄운다', async () => {
    initResult = async () => ({ ok: false, code: 'noJdk', detail: '' })
    await initPlay()
    expect(usePlayStore.getState().run).toBeNull()
    const notice = useNoticeStore.getState().notices.at(-1)!
    expect(notice).toMatchObject({ level: 'error', key: 'playNoJdk', action: 'openJdkPreferences' })
    expect(usePlayStore.getState().entries.at(-1)).toMatchObject({
      type: 'initFailed',
      notice: 'playNoJdk'
    })
    runNoticeAction(notice.id)
    expect(usePreferencesStore.getState()).toEqual({ open: true, target: 'jdk' })
    expect(useNoticeStore.getState().notices).toEqual([])
  })

  it('Android SDK·플랫폼이 없으면 환경 설정의 Android SDK 칸을 여는 버튼이 있는 알림을 띄운다', async () => {
    for (const [code, key, detail] of [
      ['noAndroidSdk', 'playNoAndroidSdk', ''],
      ['noAndroidPlatform', 'playNoAndroidPlatform', 'android-30']
    ] as const) {
      usePreferencesStore.setState({ open: false, target: null })
      initResult = async () => ({ ok: false, code, detail })
      await initPlay()
      expect(usePlayStore.getState().run).toBeNull()
      const notice = useNoticeStore.getState().notices.at(-1)!
      expect(notice).toMatchObject({
        level: 'error',
        key,
        params: { detail },
        action: 'openAndroidSdkPreferences'
      })
      runNoticeAction(notice.id)
      expect(usePreferencesStore.getState()).toEqual({ open: true, target: 'androidSdk' })
    }
    // 라이브러리 받기를 취소한 것(받기 진행 알림을 보인 뒤)은 행동 버튼이 없는 경고다
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    handlePlayEvent(
      event({ type: 'libraryProgress', phase: 'downloading', done: 0, total: 2, bytes: 0 })
    )
    stopPlay()
    pending.resolve({ ok: false, code: 'cancelled', detail: '' })
    await settle()
    const cancelled = useNoticeStore.getState().notices.at(-1)!
    expect(cancelled).toMatchObject({ level: 'warning', key: 'playCancelled' })
    expect(cancelled.action).toBeUndefined()
  })

  it('다시 실패하면 이전 알림을 바꾸고, missing이면 목록을 다시 읽는다', async () => {
    initResult = async () => ({ ok: false, code: 'noSidecar', detail: 'no sidecar.json' })
    await initPlay()
    initResult = async () => ({ ok: false, code: 'missing', detail: 'gone' })
    api.listOpModes.mockClear()
    await initPlay()
    expect(useNoticeStore.getState().notices.map((notice) => notice.key)).toEqual(['playMissing'])
    expect(api.listOpModes).toHaveBeenCalled()
  })

  it('IPC가 던지면(메인 처리기 없음) 실행을 지우고 알린다', async () => {
    initResult = async () => {
      throw new Error("Error invoking remote method 'play:init': Error: No handler registered")
    }
    await initPlay()
    expect(usePlayStore.getState().run).toBeNull()
    expect(useNoticeStore.getState().notices.at(-1)).toMatchObject({
      key: 'playInitFailed',
      params: { detail: 'No handler registered' }
    })
  })
})

describe('일시 정지·한 단계', () => {
  it('실행 전에 켜 둔 일시 정지는 INIT을 받은 뒤 보낸다', async () => {
    togglePause()
    expect(commands).toEqual([])
    await initPlay()
    expect(commands).toEqual([{ type: 'pause', paused: true }])
  })

  it('응답 전에 메인이 보낸 처음 status(일시 정지 아님)가 켜 둔 일시 정지를 지우지 않는다', async () => {
    togglePause()
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    handlePlayEvent(
      event({
        type: 'status',
        tNanos: 0,
        paused: false,
        speed: 1,
        realtime: 0,
        startedNanos: null
      })
    )
    expect(usePlayStore.getState().paused).toBe(true)
    pending.resolve({ ok: true })
    await settle()
    expect(commands).toEqual([{ type: 'pause', paused: true }])
  })

  it('응답을 기다리는 동안 바꾼 속도는 받은 뒤 보낸다', async () => {
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    expect(lastRequest().settings.speed).toBe(1)
    setPlaySpeed(4)
    expect(commands).toEqual([])
    expect(usePlayStore.getState().run!.status.speed).toBe(4)
    pending.resolve({ ok: true })
    await settle()
    expect(commands).toEqual([{ type: 'speed', speed: 4 }])
  })

  it('한 단계는 일시 정지 중에만 보낸다', async () => {
    await initPlay()
    handlePlayEvent(event({ type: 'phase', phase: 'running' }))
    stepPlay()
    expect(commands).toEqual([])
    togglePause()
    stepPlay()
    expect(commands).toEqual([{ type: 'pause', paused: true }, { type: 'step' }])
  })
})

describe('끝난 뒤와 프로젝트 바꾸기', () => {
  it('Autonomous가 끝나면 preselectTeleOp의 TeleOp을 고른다', async () => {
    selectOpMode(AUTO.className)
    await initPlay()
    handlePlayEvent(
      event({
        type: 'finished',
        tNanos: 30_000_000_000,
        reason: 'stopped',
        detail: '',
        preselectTeleOp: 'Drive'
      })
    )
    expect(usePlayStore.getState().selectedClass).toBe(DRIVE.className)
  })

  it('다른 프로젝트를 연 뒤 끝난 Autonomous는 새 프로젝트의 TeleOp을 고르지 않는다', async () => {
    selectOpMode(AUTO.className)
    await initPlay()
    useProjectStore.setState({ root: '/other', session: useProjectStore.getState().session + 1 })
    await settle()
    expect(usePlayStore.getState().opModeList.root).toBe('/other')
    handlePlayEvent(
      event({
        type: 'finished',
        tNanos: 1,
        reason: 'stopped',
        detail: '',
        preselectTeleOp: 'Drive'
      })
    )
    expect(usePlayStore.getState().selectedClass).toBeNull()
    // 그 실행(텔레메트리·장치·시간)은 지운다
    expect(usePlayStore.getState().run).toBeNull()
  })

  it('끝난 실행은 다른 프로젝트를 열 때 지우고, Console은 남긴다', async () => {
    await initPlay()
    handlePlayEvent(
      event({ type: 'finished', tNanos: 1, reason: 'stopped', detail: '', preselectTeleOp: '' })
    )
    expect(usePlayStore.getState().run).not.toBeNull()
    const entries = usePlayStore.getState().entries
    useProjectStore.setState({ root: '/other', session: useProjectStore.getState().session + 1 })
    expect(usePlayStore.getState().run).toBeNull()
    expect(usePlayStore.getState().entries).toBe(entries)
  })

  it('다른 프로젝트를 열면 지금 실행에 STOP을 보내고 그 프로젝트의 목록을 읽는다', async () => {
    await initPlay()
    api.listOpModes.mockClear()
    useProjectStore.setState({ root: '/other', session: useProjectStore.getState().session + 1 })
    expect(commands).toEqual([{ type: 'stop' }])
    expect(usePlayStore.getState().selectedClass).toBeNull()
    await settle()
    expect(api.listOpModes).toHaveBeenCalledWith('/other')
  })

  it('INIT을 준비하는 중에 다른 프로젝트를 열면 그 INIT을 멈추고, 새 프로젝트에 받기 취소 경고를 띄우지 않는다', async () => {
    const pending = deferred<PlayInitResult>()
    initResult = () => pending.promise
    void initPlay()
    await settle()
    useProjectStore.setState({ root: '/other', session: useProjectStore.getState().session + 1 })
    expect(commands).toEqual([{ type: 'stop' }])
    pending.resolve({ ok: false, code: 'cancelled', detail: '' })
    await settle()
    expect(useNoticeStore.getState().notices).toEqual([])
    // 다른 프로젝트를 연 뒤 끝난 실행처럼 실행은 지우고 Console에는 끝난 줄을 남긴다
    expect(usePlayStore.getState().run).toBeNull()
    expect(usePlayStore.getState().entries.at(-1)).toMatchObject({
      type: 'finished',
      reason: 'stopped',
      level: 'info'
    })
  })

  it('창을 닫거나 새로 고치면 STOP', async () => {
    await initPlay()
    for (const listener of listeners.get('beforeunload') ?? []) listener()
    expect(commands).toEqual([{ type: 'stop' }])
  })

  it('PlayEvent 구독은 메인 이벤트를 스토어에 넣는다', async () => {
    await initPlay()
    playEventListener!(event({ type: 'phase', phase: 'compiling' }))
    expect(usePlayStore.getState().run!.phase).toBe('compiling')
  })
})

describe('OpMode 목록 읽기', () => {
  it('늦게 온 이전 결과는 버리고, 실패하면 같은 프로젝트의 이전 목록을 둔다', async () => {
    const slow = deferred<ListOpModesResult>()
    listResult = () => slow.promise
    const first = refreshOpModes()
    listResult = async () => ({ ...LIST, opModes: [DRIVE] })
    await refreshOpModes()
    slow.resolve(LIST)
    await first
    expect(usePlayStore.getState().opModeList.opModes).toEqual([DRIVE])

    listResult = async () => ({ ok: false, code: 'notAllowed', detail: 'nope' })
    await refreshOpModes()
    expect(usePlayStore.getState().opModeList).toMatchObject({
      status: 'failed',
      detail: 'nope',
      opModes: [DRIVE]
    })
  })

  it('정렬해서 두고(TeleOp 먼저), 프로젝트가 없으면 비운다', async () => {
    await refreshOpModes()
    expect(usePlayStore.getState().opModeList.opModes).toEqual([DRIVE, AUTO])
    useProjectStore.setState({ root: null })
    await refreshOpModes()
    expect(usePlayStore.getState().opModeList).toEqual(EMPTY_OPMODE_LIST)
  })

  it('실행 중에는 OpMode를 바꾸지 않는다', async () => {
    await initPlay()
    selectOpMode(AUTO.className)
    expect(usePlayStore.getState().selectedClass).toBe(DRIVE.className)
  })
})

describe('시뮬레이터 자세·잔상·키보드 게임패드', () => {
  const fire = (type: string, payload: object): void => {
    for (const listener of listeners.get(type) ?? [])
      (listener as (event: unknown) => void)({ ...payload, preventDefault: () => {} })
  }
  const keyEvent = (code: string): object => ({
    code,
    key: code,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', {
      api,
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
    })
    useKeyboardPadStore.setState({ focused: false })
  })

  it('자세를 받고, 끝나면 잔상으로 남고, 다음 INIT에 지운다', async () => {
    await initPlay()
    expect(usePlayStore.getState().run!.robotId).toBe('bot')
    handlePlayEvent(
      event({ type: 'pose', tNanos: 5_000_000, x: 0.4, y: -0.1, yaw: 0.2, blocked: false })
    )
    expect(usePlayStore.getState().simPose).toMatchObject({ robotId: 'bot', x: 0.4 })
    handlePlayEvent(
      event({ type: 'finished', tNanos: 6, reason: 'stopped', detail: '', preselectTeleOp: '' })
    )
    expect(usePlayStore.getState().simPose).toBeNull()
    expect(usePlayStore.getState().ghostPose).toEqual({ robotId: 'bot', x: 0.4, y: -0.1, yaw: 0.2 })
    // 씬 문서는 바뀌지 않는다
    expect(useSceneStore.getState().objects).toBe(SCENE)
    await initPlay()
    expect(usePlayStore.getState().ghostPose).toBeNull()
  })

  it('프로젝트를 열면 잔상을 지운다', async () => {
    usePlayStore.setState({ ghostPose: { robotId: 'bot', x: 1, y: 1, yaw: 0 } })
    useProjectStore.setState({ session: useProjectStore.getState().session + 1 })
    expect(usePlayStore.getState().ghostPose).toBeNull()
  })

  it('실행 중 같은 프로젝트를 다시 열면 그 실행을 새 씬과 떼어 놓는다(자세·잠금·잔상 없음)', async () => {
    await initPlay()
    handlePlayEvent(event({ type: 'pose', tNanos: 1, x: 0.4, y: 0, yaw: 0, blocked: false }))
    expect(usePlayStore.getState().simPose).not.toBeNull()
    useProjectStore.setState({ session: useProjectStore.getState().session + 1 })
    expect(commands).toContainEqual({ type: 'stop' })
    expect(usePlayStore.getState().run!.robotId).toBeNull()
    expect(usePlayStore.getState().simPose).toBeNull()
    // STOP 뒤 끝날 때까지 온 자세와 끝은 잔상을 남기지 않는다
    handlePlayEvent(event({ type: 'pose', tNanos: 2, x: 0.5, y: 0, yaw: 0, blocked: false }))
    expect(usePlayStore.getState().simPose).toBeNull()
    handlePlayEvent(
      event({ type: 'finished', tNanos: 3, reason: 'stopped', detail: '', preselectTeleOp: '' })
    )
    expect(usePlayStore.getState().ghostPose).toBeNull()
  })

  it('START하면 씬 뷰에 포커스를 준다(Unity Play Focused)', async () => {
    const focus = vi.fn()
    await initPlay()
    handlePlayEvent(event({ type: 'phase', phase: 'init' }))
    vi.stubGlobal('document', {
      querySelector: (selector: string) => (selector === '[data-scene-view]' ? { focus } : null)
    })
    startPlay()
    expect(commands).toContainEqual({ type: 'start' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('씬 뷰에 포커스가 있으면 키보드가 gamepad1이 되고, 실행이 끝나면 뗀 상태를 보낸다', async () => {
    vi.useFakeTimers()
    await initPlay()
    expect(useKeyboardPadStore.getState().slot).toBe(0)
    expect(usePlayStore.getState().gamepads[0]).toMatchObject({ keyboard: true })
    // 포커스가 없으면 받지 않는다
    fire('keydown', keyEvent('KeyW'))
    vi.advanceTimersByTime(20)
    expect(gamepads).toHaveLength(1)
    useKeyboardPadStore.setState({ focused: true })
    fire('keydown', keyEvent('KeyW'))
    vi.advanceTimersByTime(20)
    expect(gamepads.at(-1)).toEqual([{ ...emptyGamepadState(), left_stick_y: -1 }, null])
    handlePlayEvent(
      event({ type: 'finished', tNanos: 1, reason: 'stopped', detail: '', preselectTeleOp: '' })
    )
    expect(gamepads.at(-1)).toEqual([emptyGamepadState(), null])
    expect(useKeyboardPadStore.getState().slot).toBeNull()
    expect(usePlayStore.getState().gamepads).toEqual([null, null])
  })

  it('씬 뷰에서 포커스가 나가거나 창이 포커스를 잃으면 다음 읽기를 기다리지 않고 뗀 상태를 보낸다', async () => {
    vi.useFakeTimers()
    await initPlay()
    const sceneView = { hasAttribute: (name: string) => name === SCENE_VIEW_ATTRIBUTE }
    const pressW = (): void => {
      fire('focusin', { target: sceneView })
      fire('keydown', keyEvent('KeyW'))
      vi.advanceTimersByTime(20)
      expect(gamepads.at(-1)).toEqual([{ ...emptyGamepadState(), left_stick_y: -1 }, null])
    }
    // 창을 내리면 interval이 1초에 한 번으로 늦어진다: 타이머를 진행하지 않아도 보내야 한다
    pressW()
    fire('focusout', { target: sceneView })
    expect(gamepads.at(-1)).toEqual([emptyGamepadState(), null])
    pressW()
    fire('blur', {})
    expect(gamepads.at(-1)).toEqual([emptyGamepadState(), null])
    const sent = gamepads.length
    // 뗄 키가 없으면 보내지 않는다
    fire('blur', {})
    expect(gamepads).toHaveLength(sent)
  })

  it('게임패드 back(Backspace)을 누른 채 실행이 끝나도 반복 입력이 편집기의 Delete가 되지 않는다', async () => {
    await initPlay()
    useKeyboardPadStore.setState({ focused: true })
    const backspace = keyEvent('Backspace') as Parameters<typeof shortcutCommand>[0]
    const repeat = { ...backspace, repeat: true }
    fire('keydown', backspace)
    handlePlayEvent(
      event({ type: 'finished', tNanos: 1, reason: 'stopped', detail: '', preselectTeleOp: '' })
    )
    // EditorLayout의 단축키 리스너와 같은 판단
    const shortcut = (): ReturnType<typeof shortcutCommand> =>
      shortcutCommand(repeat, {
        blocked: false,
        handlesOwnKeys: false,
        pendingTextEdit: false,
        dragging: false,
        keyboardGamepad: isKeyboardPadInput(repeat)
      })
    expect(isKeyboardPadInput(repeat)).toBe(true)
    expect(shortcut().command).toBeNull()
    // 떼면 다시 편집기의 키다(Delete를 누르고 있으면 반복해 지운다)
    fire('keyup', backspace)
    expect(isKeyboardPadInput(repeat)).toBe(false)
    expect(shortcut().command).toBe('delete')
  })
})

describe('등록기(@OpModeRegistrar) OpMode', () => {
  const TUNING = 'org.firstinspires.ftc.teamcode.tuning.TuningOpModes'
  const TUNING_PATH = `${P}tuning/TuningOpModes.java`
  const registered = (name: string, flavor: OpModeInfo['flavor'] = 'TeleOp'): OpModeInfo => ({
    className: `com.acmerobotics.roadrunner.ftc.${name.replace(/\s/g, '')}`,
    path: TUNING_PATH,
    line: 40,
    flavor,
    name,
    group: 'tuning',
    preselectTeleOp: '',
    registered: { registrar: TUNING }
  })
  const RAMP = registered('ForwardRampLogger')
  const WITH_REGISTRARS: ListOpModesResult = {
    ...LIST,
    registrars: [{ className: TUNING, path: TUNING_PATH, line: 39 }]
  }

  beforeEach(() => {
    listResult = async () => WITH_REGISTRARS
    registeredResult = async () => ({ ok: true, opModes: [RAMP], diagnostics: [], errors: [] })
  })

  it('등록기가 있을 때만 읽고, 등록 OpMode를 같은 목록에 넣는다', async () => {
    listResult = async () => LIST
    await refreshOpModes()
    expect(api.listRegisteredOpModes).not.toHaveBeenCalled()

    listResult = async () => WITH_REGISTRARS
    await refreshOpModes()
    expect(api.listRegisteredOpModes).toHaveBeenCalledWith('/p')
    const list = usePlayStore.getState().opModeList
    expect(list.registered).toEqual({ status: 'ready', opModes: [RAMP], problem: null })
    expect(listedOpModes(list)).toEqual([DRIVE, RAMP, AUTO])
  })

  it('고르는 키는 registered:이름이고, INIT은 등록기 클래스·소스와 DS 이름을 보낸다', async () => {
    await refreshOpModes()
    selectOpMode(opModeKey(RAMP))
    expect(usePlayStore.getState().selectedClass).toBe('registered:ForwardRampLogger')
    expect(initBlock({ root: '/p', busy: false }, usePlayStore.getState())).toBeNull()
    await initPlay()
    expect(lastRequest().opMode).toEqual({
      className: TUNING,
      path: TUNING_PATH,
      flavor: 'TeleOp',
      registeredName: 'ForwardRampLogger'
    })
    expect(usePlayStore.getState().run!.opMode).toBe(RAMP)
  })

  it('예전에 기억한 클래스 이름은 annotated OpMode에 그대로 맞는다', async () => {
    await refreshOpModes()
    selectOpMode(DRIVE.className)
    await initPlay()
    expect(lastRequest().opMode).toEqual({
      className: DRIVE.className,
      path: DRIVE.path,
      flavor: 'TeleOp'
    })
  })

  it('읽는 동안 다시 부르면 하나만 돌고, 끝난 뒤 한 번 더 읽는다', async () => {
    const slow = deferred<ListRegisteredResult>()
    registeredResult = () => slow.promise
    const first = refreshRegisteredOpModes('/p')
    usePlayStore.setState({
      opModeList: { ...usePlayStore.getState().opModeList, registrars: WITH_REGISTRARS.registrars }
    })
    const second = refreshRegisteredOpModes('/p')
    const third = refreshRegisteredOpModes('/p')
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(api.listRegisteredOpModes).toHaveBeenCalledTimes(1)
    registeredResult = async () => ({ ok: true, opModes: [RAMP], diagnostics: [], errors: [] })
    slow.resolve({ ok: true, opModes: [], diagnostics: [], errors: [] })
    await first
    expect(api.listRegisteredOpModes).toHaveBeenCalledTimes(2)
    expect(usePlayStore.getState().opModeList.registered.opModes).toEqual([RAMP])
  })

  it('읽지 못하면 이전 등록 OpMode를 두고 한 줄로 알리며, Console에는 같은 문제를 한 번만 남긴다', async () => {
    await refreshOpModes()
    registeredResult = async () => ({ ok: false, code: 'noJdk', detail: 'no java' })
    await refreshOpModes()
    await refreshOpModes()
    const list = usePlayStore.getState().opModeList
    expect(list.registered).toEqual({
      status: 'failed',
      opModes: [RAMP],
      problem: { kind: 'failed', code: 'noJdk', detail: 'no java' }
    })
    const notices = usePlayStore
      .getState()
      .entries.filter((entry) => entry.type === 'notice' && entry.key === 'registeredFailed')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ level: 'error', params: { detail: 'no java' } })
  })

  it('컴파일 오류·던진 등록기는 목록 아래 한 줄과 Console(진단은 그 줄을 연다)로 알린다', async () => {
    registeredResult = async () => ({
      ok: true,
      opModes: [],
      diagnostics: [
        {
          kind: 'error',
          file: 'TuningOpModes.java',
          path: TUNING_PATH,
          line: 12,
          column: 3,
          message: 'cannot find symbol',
          code: 'compiler.err.cant.resolve',
          hint: null
        }
      ],
      errors: []
    })
    await refreshOpModes()
    expect(usePlayStore.getState().opModeList.registered.problem).toEqual({
      kind: 'compile',
      errors: 1
    })
    const entries = usePlayStore.getState().entries
    expect(entries.map((entry) => entry.type)).toEqual(['notice', 'diagnostic'])
    expect(entries[1].root).toBe('/p')

    registeredResult = async () => ({
      ok: true,
      opModes: [RAMP],
      diagnostics: [],
      errors: [{ registrar: TUNING, message: 'java.lang.IllegalStateException: boom' }]
    })
    await refreshOpModes()
    expect(usePlayStore.getState().opModeList.registered.problem).toEqual({
      kind: 'registrar',
      registrars: [TUNING]
    })
    expect(usePlayStore.getState().entries.at(-1)).toMatchObject({
      type: 'error',
      kind: 'registrar',
      message: `${TUNING}: java.lang.IllegalStateException: boom`
    })
  })

  it('같은 프로젝트를 다시 연 뒤 온 이전 결과는 버리고 새로 읽는다', async () => {
    const slow = deferred<ListRegisteredResult>()
    registeredResult = () => slow.promise
    const done = refreshOpModes()
    await settle()
    // 다시 열면 목록을 다시 읽는다(읽는 중인 등록기 목록은 끝난 뒤 한 번 더)
    registeredResult = async () => ({ ok: true, opModes: [], diagnostics: [], errors: [] })
    useProjectStore.setState({ session: useProjectStore.getState().session + 1 })
    slow.resolve({ ok: true, opModes: [RAMP], diagnostics: [], errors: [] })
    await done
    await settle()
    expect(api.listRegisteredOpModes).toHaveBeenCalledTimes(2)
    expect(usePlayStore.getState().opModeList.registered).toMatchObject({
      status: 'ready',
      opModes: []
    })
  })
})

describe('FTC Dashboard 상태', () => {
  const TREE: DashConfigNode = {
    kind: 'custom',
    children: [
      {
        name: 'Lift',
        node: {
          kind: 'custom',
          children: [
            {
              name: 'kP',
              node: {
                kind: 'value',
                type: 'double',
                value: '0.5',
                enumValues: [],
                source: { declaringClass: 'org.firstinspires.ftc.teamcode.Lift', field: 'kP' }
              }
            }
          ]
        }
      }
    ]
  }
  const OPS = [{ type: 'circle' as const, x: 0, y: 0, radius: 9, stroke: true }]

  it('Config 탭 값은 INIT·실행 중에만 보내고, 새 트리를 받을 때까지 보낸 값을 둔다', async () => {
    await initPlay()
    handlePlayEvent(event({ type: 'phase', phase: 'init' }))
    handlePlayEvent(event({ type: 'dashConfig', tNanos: 0, root: TREE }))
    sendDashConfig(['Lift', 'kP'], '0.75')
    expect(commands).toContainEqual({ type: 'config', path: ['Lift', 'kP'], value: '0.75' })
    expect(usePlayStore.getState().dashConfig!.pending).toEqual({ '["Lift","kP"]': '0.75' })
    handlePlayEvent(event({ type: 'dashConfig', tNanos: 5, root: TREE }))
    expect(usePlayStore.getState().dashConfig!.pending).toEqual({})

    // 메인이 버릴 명령(너무 긴 글자)은 보내지 않고 보낸 값으로도 두지 않는다
    commands.length = 0
    sendDashConfig(['Lift', 'kP'], 'x'.repeat(MAX_DASH_TEXT + 1))
    expect(commands).toEqual([])
    expect(usePlayStore.getState().dashConfig!.pending).toEqual({})

    stopPlay()
    commands.length = 0
    sendDashConfig(['Lift', 'kP'], '0.9')
    expect(commands).toEqual([])
  })

  it('INIT은 이전 실행의 Dashboard 텔레메트리·오버레이·설정을 지운다', async () => {
    await initPlay()
    handlePlayEvent(
      event({ type: 'dash', tNanos: 1, cleared: false, data: [['x', '1']], log: null, ops: OPS })
    )
    handlePlayEvent(event({ type: 'dashConfig', tNanos: 1, root: TREE }))
    handlePlayEvent(
      event({ type: 'finished', tNanos: 2, reason: 'stopped', detail: '', preselectTeleOp: '' })
    )
    // 끝나도 다음 INIT까지 남는다
    expect(usePlayStore.getState().dashOverlay).not.toBeNull()
    expect(usePlayStore.getState().dashConfig).not.toBeNull()
    await initPlay()
    expect(usePlayStore.getState()).toMatchObject({
      dash: null,
      dashOverlay: null,
      dashConfig: null
    })
  })

  it('프로젝트를 열면 오버레이·설정을 지우고, 아직 도는 실행의 것은 더 받지 않는다', async () => {
    await initPlay()
    handlePlayEvent(
      event({ type: 'dash', tNanos: 1, cleared: false, data: [], log: null, ops: OPS })
    )
    useProjectStore.setState({ session: useProjectStore.getState().session + 1 })
    expect(usePlayStore.getState().dashOverlay).toBeNull()
    expect(usePlayStore.getState().run!.detached).toBe(true)
    handlePlayEvent(
      event({ type: 'dash', tNanos: 2, cleared: false, data: [['y', '2']], log: null, ops: OPS })
    )
    handlePlayEvent(event({ type: 'dashConfig', tNanos: 2, root: TREE }))
    expect(usePlayStore.getState().dashOverlay).toBeNull()
    expect(usePlayStore.getState().dashConfig).toBeNull()
  })
})
