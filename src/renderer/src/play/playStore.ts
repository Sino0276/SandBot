import type { Matrix4 } from 'three'
import { create } from 'zustand'
import type { DashConfigNode, DashOp } from '../../../shared/dashboard'
import type { LibraryProgress } from '../../../shared/libraries'
import type {
  ListRegisteredFailureCode,
  OpModeInfo,
  PlayEvent,
  PlayPhase,
  PlaySpeed,
  RegistrarInfo
} from '../../../shared/play'
import type { SeasonId } from '../../../shared/sim/seasons/fieldSpec'
import type { CameraModelId } from '../../../shared/sim/cameraData'
import type { SensorMount, SimCollider } from '../../../shared/sim/worldSpec'
import type { DeviceValues, TelemetryFrame } from '../../../shared/sidecarProtocol'
import { jointMotionMatrix } from '../scene/jointMotion'
import type { RootOverride, SceneObjects, Transform } from '../scene/model'
import {
  appendConsole,
  consoleLevel,
  CONSOLE_LIMIT,
  type ConsoleBody,
  type ConsoleEntry,
  type ConsoleFinishReason,
  type ConsoleLevel,
  type ConsoleNoticeKey
} from './consoleModel'
import { configPathKey, extendBaseline } from './dashConfigModel'
import type { PadSlots } from './gamepad'
import { libraryReportLines, linkWarningLines } from './libraryConsole'
import { compareOpModes } from './opModeList'
import {
  loadConsolePrefs,
  loadDockTab,
  loadPlaySettings,
  saveConsolePrefs,
  saveDockTab,
  savePlaySettings,
  type ConsolePrefs,
  type DockTab,
  type RendererPlaySettings
} from './playSettings'

// 실행(Play) 상태: OpMode 목록과 고른 것, 지금 실행(메인이 보내는 PlayEvent를 그대로 반영), Console 항목, 개인 설정.
// 씬 문서와 따로 둔다(실행은 저장·실행 취소·dirty와 관계없다). 이벤트는 지금 실행의 runId일 때만 받는다
// (다른 실행의 늦은 이벤트는 버린다).

export type OpModeListStatus = 'none' | 'loading' | 'ready' | 'failed'

// 등록기 OpMode 목록을 읽지 못했거나 일부만 읽은 이유(목록 아래 한 줄, Console에도 남긴다). 아직 동의하지 않은 것
// (needsConsent)은 문제가 아니라 RegisteredListState.needsConsent다.
export type RegisteredProblem =
  | { kind: 'failed'; code: ListRegisteredFailureCode; detail: string }
  // 컴파일 오류(등록기 OpMode가 없다)
  | { kind: 'compile'; errors: number }
  // 던진 등록기(그 등록기의 OpMode만 빠진다)
  | { kind: 'registrar'; registrars: string[] }

// @OpModeRegistrar가 등록한 OpMode(메인이 JVM에서 등록기를 실행해 읽는다, listRegisteredOpModes). 등록기가 없으면 none.
export type RegisteredListState = {
  status: OpModeListStatus
  opModes: OpModeInfo[]
  // 등록기가 클래스로 다시 등록한 annotated OpMode(실제 SDK처럼 등록 이름으로만 보인다, annotated 목록에서 뺀다)
  replaced: string[]
  problem: RegisteredProblem | null
  // 사용자가 이 프로젝트의 코드 실행을 아직 믿지 않아(메인 codeTrust.ts) 등록기를 실행하지 않았다. 고르기 목록이 오류 대신
  // '등록기 OpMode 읽기…' 줄을 보인다(누르면 묻고 기억한 뒤 읽는다).
  needsConsent: boolean
}

export const EMPTY_REGISTERED_LIST: RegisteredListState = {
  status: 'none',
  opModes: [],
  replaced: [],
  problem: null,
  needsConsent: false
}

// 고르기 목록에 '등록기 OpMode 읽기…' 줄을 보이는가(등록기가 있고, 동의를 기다리고, 읽는 중이 아님)
export function showsRegisteredConsent(list: OpModeListState): boolean {
  return (
    list.registrars.length > 0 &&
    list.registered.needsConsent &&
    list.registered.status !== 'loading'
  )
}

export type OpModeListState = {
  // 이 목록을 읽은 프로젝트 루트
  root: string | null
  status: OpModeListStatus
  // @TeleOp·@Autonomous 클래스(소스 글자로 찾음)
  opModes: OpModeInfo[]
  // TeamCode의 @OpModeRegistrar 메서드(비어 있지 않으면 registered를 읽는다)
  registrars: RegistrarInfo[]
  registered: RegisteredListState
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
  // 메인이 playInit을 받았다(그 전의 STOP은 바로 보내고 받은 뒤 한 번 더 보낸다)
  accepted: boolean
  // STOP을 눌렀다(끝날 때까지 버튼을 막는다)
  stopRequested: boolean
  // START를 눌렀다(running이 올 때까지 두 번 보내지 않는다)
  startRequested: boolean
  status: RunStatus
  telemetry: { tNanos: number; frame: TelemetryFrame } | null
  // 장치 출력과 시뮬레이터가 보낸 센서 값(허브 원시 값, 누적)
  devices: {
    tNanos: number
    outputs: Record<string, DeviceValues>
    inputs: Record<string, DeviceValues>
  } | null
  finished: { tNanos: number; reason: ConsoleFinishReason; detail: string } | null
  // INIT 중 라이브러리 받기 진행(진행 알림이 보인다). 받는 동안만 두고, 의존성 보고가 오거나 준비를 벗어나면 지운다.
  libraryProgress: LibraryProgress | null
  // 의존성 보고를 받았다. 그 뒤에 온 진행(메인이 해석을 끝낸 뒤 늦게 끝난 미리 받기)은 받지 않는다: 실행 내내 남는 진행
  // 알림의 [취소]가 도는 OpMode를 멈추지 않게.
  libraryReported: boolean
  // 프로젝트를 다시 열어 새 씬과 떼어 놓은 실행(끝나기를 기다리는 중). Dashboard 오버레이·설정은 받지 않는다.
  detached: boolean
  // 세계 설명의 관절 순번 → 관절 오브젝트 id(INIT 때 정해짐, pose 이벤트 joints의 순서). 세계 설명이 없으면 비어 있다.
  joints: readonly string[]
  // 시뮬레이터가 쓰는 거리·컬러 센서(4c, INIT 때 세계 설명의 distanceSensors 다음 colorSensors 순서). 실행 중 씬 뷰
  // 기즈모가 문서 조준 대신 이 장착을 표시 자세 몸체 틀로 그린다. 세계 설명이 없으면 비어 있다.
  sensors: readonly PlayRunSensor[]
  // 시뮬레이터가 쓰는 웹캠(4d, INIT 때 세계 설명의 cameras 순서). 실행 중 씬 뷰 기즈모가 문서 조준 대신 이 장착을 표시
  // 자세 몸체 틀로 그린다(run.sensors와 같은 규칙). 세계 설명이 없으면 비어 있다.
  cameras: readonly PlayRunCamera[]
  // 시뮬레이터가 쓰는 충돌 몸체(5, INIT 때 세계 설명 그대로: 섀시 다음 관절 순번 순). 실행 중 씬 뷰 기즈모가 이 형상을 표시
  // 자세 몸체 틀로 그리고, Console의 collisionOverlap이 몸체 이름을 찾는다. 세계 설명이 없으면 비어 있다.
  colliders: readonly PlayRunCollider[]
  // 실행의 시즌과 HIVE 상태 [빨강, 파랑](INIT 때 문서 시즌(모르면 'none')과 실행 설정 hiveState로 정함). 실행하는 동안
  // 씬 뷰·Field 인스펙터·시작 표시가 문서 대신 이것을 쓴다(실행 중 실행 취소로 문서 시즌이 바뀌어도 그대로).
  field: PlayRunField
}

// 실행의 웹캠 하나(4d): 붙은 오브젝트·컴포넌트, 몸체(−1 섀시, ≥ 0 세계 설명 관절 순번), 세계 설명 장착·모델 그대로
export type PlayRunCamera = {
  objectId: string
  componentId: string
  body: number
  mount: SensorMount
  model: CameraModelId
}

// 실행의 충돌 몸체 하나(5, INIT 때 세계 설명 그대로): 몸체 번호(−1 섀시, ≥ 0 세계 설명 관절 순번), 몸체 오브젝트(섀시 = 로봇,
// 관절 = 관절 오브젝트), 이름(Console), 충돌체(몸체 틀)
export type PlayRunCollider = {
  body: number
  objectId: string
  name: string
  colliders: readonly SimCollider[]
}

// 실행의 센서 하나: 붙은 오브젝트·컴포넌트, 종류, 몸체(−1 섀시, ≥ 0 세계 설명 관절 순번), 세계 설명 장착 그대로
export type PlayRunSensor = {
  objectId: string
  componentId: string
  kind: 'distance' | 'color'
  body: number
  mount: SensorMount
}

export type PlayRunField = { season: SeasonId; hiveTipped: readonly [boolean, boolean] }

// newRun에 field를 넘기지 않으면 쓰는 값('none' 시즌, HIVE 시작 상태)
const DEFAULT_RUN_FIELD: PlayRunField = Object.freeze({
  season: 'none',
  hiveTipped: Object.freeze([false, false] as const)
})

// 시뮬레이터가 보낸 지금 로봇 자세(필드 좌표, pose 이벤트). 약 60 Hz로 바뀌므로 run과 따로 둔다(run을 구독하는
// 툴바·장치 탭이 그때마다 다시 그리지 않게). 씬 문서는 바꾸지 않고 씬 뷰가 이 자세로 그린다.
export type SimPoseState = {
  robotId: string
  tNanos: number
  x: number
  y: number
  yaw: number
  // 벽에 막혔다
  blocked: boolean
  // 관절 값(rad 또는 m, run.joints의 순서). 관절이 없는 세계·모양이 맞지 않는 값이면 키가 없다(관절은 편집 자세로 그린다).
  joints?: readonly number[]
}

// 끝난 실행의 마지막 자세(씬 뷰의 반투명 잔상). 다음 INIT이나 프로젝트를 열 때 지운다. joints는 관절 오브젝트 id →
// 마지막 관절 값(끝날 때 run.joints로 풀어 둔다, 다음 실행의 순번과 섞이지 않게). 관절 값이 없었으면 키가 없다.
export type GhostPose = {
  robotId: string
  x: number
  y: number
  yaw: number
  joints?: Readonly<Record<string, number>>
}

// ---- FTC Dashboard(라이브러리 L2) ----
// 패킷은 약 30 Hz로 오므로 run과 따로 둔다(run을 구독하는 툴바·장치 탭이 그때마다 다시 그리지 않게).

// Dashboard 텔레메트리(웹 클라이언트 TelemetryView처럼): 키마다 마지막 값과 마지막 비어 있지 않은 로그. clearTelemetry
// (cleared)는 둘 다 비운다. values는 최근에 바뀐 키가 뒤에 오는 순서다(한도를 넘으면 오래 바뀌지 않은 키부터 버린다).
// 화면은 키 정렬로 보인다(dashTelemetryRows). INIT에서 비운다.
export type DashTelemetry = {
  runId: string
  tNanos: number
  values: ReadonlyMap<string, string>
  log: readonly string[]
}

// 텔레메트리 키 수 한도(팀 코드가 바뀌는 키를 계속 넣어도 화면이 끝없이 커지지 않게)
export const MAX_DASH_KEYS = 1000

// 씬 뷰 필드 오버레이: 마지막으로 받은 op 목록(Dashboard처럼 fieldOverlay가 빈 패킷은 그림을 바꾸지 않는다). 실행이 끝나도
// 다음 INIT·프로젝트 열기까지 남는다(잔상처럼).
export type DashOverlayState = { runId: string; tNanos: number; ops: readonly DashOp[] }

// Config 탭: 마지막 설정 트리, 실행의 시작 값(값 칸마다 처음 받은 값, [파일에 반영]을 둘 칸), 보냈지만 아직 새 트리를 받지
// 못한 값(일시 정지 중에는 다음 틱 답까지 적용되지 않는다). 다음 INIT까지 남는다(STOP하면 값은 되돌아간다).
export type DashConfigState = {
  runId: string
  // 실행의 프로젝트 루트([파일에 반영]이 그 TeamCode를 읽는다)
  root: string
  tNanos: number
  tree: DashConfigNode
  baseline: ReadonlyMap<string, string>
  pending: Readonly<Record<string, string>>
}

export type PlayData = {
  opModeList: OpModeListState
  // 고른 OpMode의 키(opModeList.ts opModeKey: annotated는 클래스 이름, 등록기 OpMode는 'registered:' + 이름. 프로젝트
  // 루트마다 localStorage에 기억). 목록에 없으면 고른 것이 없는 것으로 보인다.
  selectedClass: string | null
  run: PlayRun | null
  // 일시 정지 토글(Unity처럼 실행 전에도 켤 수 있다. 켜고 INIT하면 init에서 바로 멈춘다)
  paused: boolean
  entries: readonly ConsoleEntry[]
  selectedEntryId: number | null
  consoleQuery: string
  consolePrefs: ConsolePrefs
  settings: RendererPlaySettings
  gamepads: PadSlots
  dockTab: DockTab
  simPose: SimPoseState | null
  ghostPose: GhostPose | null
  dash: DashTelemetry | null
  dashOverlay: DashOverlayState | null
  dashConfig: DashConfigState | null
}

export const EMPTY_OPMODE_LIST: OpModeListState = {
  root: null,
  status: 'none',
  opModes: [],
  registrars: [],
  registered: EMPTY_REGISTERED_LIST,
  truncated: false,
  hasTeamCode: false,
  detail: ''
}

// 고를 수 있는 OpMode 전부(annotated — 등록기가 다시 등록한 것은 빼고 — + 등록기, DS처럼 flavor·group·이름 순). 목록
// 상태마다 한 번 만든다.
const listedMemo = new WeakMap<OpModeListState, readonly OpModeInfo[]>()

export function listedOpModes(list: OpModeListState): readonly OpModeInfo[] {
  let listed = listedMemo.get(list)
  if (!listed) {
    const replaced = new Set(list.registered.replaced)
    const annotated =
      replaced.size === 0 ? list.opModes : list.opModes.filter((o) => !replaced.has(o.className))
    listed =
      list.registered.opModes.length === 0
        ? annotated
        : [...annotated, ...list.registered.opModes].sort(compareOpModes)
    listedMemo.set(list, listed)
  }
  return listed
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

// 실행이 활성인 동안(INIT부터 끝까지) 그 실행의 로봇 id. 핸들 숨김·인스펙터 읽기 전용이 쓴다.
export function runningRobotId(data: Pick<PlayData, 'run'>): string | null {
  return isRunActive(data.run) ? data.run.robotId : null
}

// 씬 뷰가 시뮬레이터 자세로 그리는 로봇(실행 중이고 자세를 받았을 때). 아니면 null(문서 자세).
export function simPoseOf(data: Pick<PlayData, 'run' | 'simPose'>): SimPoseState | null {
  const { run, simPose } = data
  if (!isRunActive(run) || !simPose || simPose.robotId !== run.robotId) return null
  return simPose
}

// 실행이 끝날 때: Unity처럼 로봇은 편집 위치로 돌아가고, 그 실행 로봇의 마지막 자세는 다음 INIT까지 잔상으로 남는다.
// 끝을 알리는 이벤트가 둘(phase finished, finished)이라 두 번째는 첫 번째가 남긴 잔상을 그대로 둔다(INIT이 잔상을 지운다).
function endPose(data: PlayData, run: PlayRun): Pick<PlayData, 'simPose' | 'ghostPose'> {
  const pose = data.simPose
  if (!pose || pose.robotId !== run.robotId) return { simPose: null, ghostPose: data.ghostPose }
  const ghostPose: GhostPose = { robotId: pose.robotId, x: pose.x, y: pose.y, yaw: pose.yaw }
  if (pose.joints) {
    const joints: Record<string, number> = {}
    run.joints.forEach((id, index) => (joints[id] = pose.joints![index]))
    ghostPose.joints = joints
  }
  return { simPose: null, ghostPose }
}

// pose 이벤트의 관절 값: 실행의 관절 수와 같은 길이의 유한 수 목록만 받는다(메인이 확인하지만 렌더러도 모양이 다른 값으로
// 다른 관절을 움직이지 않게)
function poseJoints(
  run: PlayRun,
  joints: readonly number[] | undefined
): { joints?: readonly number[] } {
  if (!Array.isArray(joints) || run.joints.length === 0 || joints.length !== run.joints.length)
    return {}
  return joints.every((q) => typeof q === 'number' && Number.isFinite(q))
    ? { joints: [...joints] }
    : {}
}

// 씬 뷰가 이 관절 오브젝트를 그릴 시뮬레이터 관절 값(실행 중이고 자세를 받았을 때). 아니면 null(편집 자세나 미리보기).
// 관절은 많아야 MAX_WORLD_JOINTS(16)개라 순번을 그때마다 찾는다.
export function simJointValue(
  data: Pick<PlayData, 'run' | 'simPose'>,
  objectId: string
): number | null {
  const pose = simPoseOf(data)
  if (!pose?.joints) return null
  const index = data.run!.joints.indexOf(objectId)
  return index < 0 ? null : (pose.joints[index] ?? null)
}

// 필드 자세 → 최상위 로봇의 transform(바닥 위, 요만)
export function poseTransform(pose: { x: number; y: number; yaw: number }): Transform {
  return { position: [pose.x, pose.y, 0], rotation: [0, 0, pose.yaw] }
}

// simNotice collisionOverlap의 params(src/shared/play.ts SimNoticeCode 주석)를 Console 본문으로: 몸체 이름은 run.colliders에서
// (없으면 '' → 번역할 때 로봇 몸체), 대상은 벽·구조물·바닥·몸체 이름, 풀지 못하면 원래 글자다. 시즌은 실행의 시즌이다.
const OVERLAP_WALLS = ['x+', 'x-', 'y+', 'y-'] as const
export function collisionOverlapBody(
  run: Pick<PlayRun, 'colliders' | 'field'>,
  params: Record<string, string>
): Extract<ConsoleBody, { type: 'collisionOverlap' }> {
  const bodyName = (text: string | undefined): string | null => {
    if (text === undefined || !/^-?\d+$/.test(text)) return null
    const index = Number(text)
    return run.colliders.find((entry) => entry.body === index)?.name ?? null
  }
  const raw = params.target ?? ''
  let target: Extract<ConsoleBody, { type: 'collisionOverlap' }>['target'] = {
    kind: 'raw',
    text: raw
  }
  const wall = OVERLAP_WALLS.find((side) => raw === `wall:${side}`)
  const structure = /^structure:(\d+)$/.exec(raw)
  if (wall) target = { kind: 'wall', wall }
  else if (structure) target = { kind: 'structure', index: Number(structure[1]) }
  else if (raw === 'floor') target = { kind: 'floor' }
  else if (raw.startsWith('body:')) {
    const name = bodyName(raw.slice('body:'.length))
    if (name !== null) target = { kind: 'body', name }
  }
  return {
    type: 'collisionOverlap',
    body: bodyName(params.body) ?? '',
    target,
    season: run.field.season
  }
}

// 씬 뷰 표시용 worldMatrix 덮어쓰기(scene/model.ts). F 포커스·IMU·무게중심 표시가 실행 중 로봇을 표시 자세로 계산한다.
// objects를 주면 관절 값도 넣는다(관절의 앵커·축은 지금 문서의 관절 설정, 씬 뷰가 그리는 것과 같다).
export function displayRootOverride(
  data: Pick<PlayData, 'run' | 'simPose'>,
  objects?: SceneObjects
): RootOverride | null {
  const pose = simPoseOf(data)
  if (!pose) return null
  const override: RootOverride = { id: pose.robotId, transform: poseTransform(pose) }
  if (objects && pose.joints) {
    const joints = new Map<string, Matrix4>()
    data.run!.joints.forEach((id, index) => {
      const joint = objects[id]?.joint
      if (joint) joints.set(id, jointMotionMatrix(joint, pose.joints![index]))
    })
    if (joints.size > 0) override.joints = joints
  }
  return override
}

export function newRun(options: {
  runId: string
  root: string
  opMode: OpModeInfo
  robotId: string | null
  configPath: string | null
  speed: PlaySpeed
  paused: boolean
  joints?: readonly string[]
  sensors?: readonly PlayRunSensor[]
  cameras?: readonly PlayRunCamera[]
  colliders?: readonly PlayRunCollider[]
  field?: PlayRunField
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
    finished: null,
    libraryProgress: null,
    libraryReported: false,
    detached: false,
    joints: options.joints ?? [],
    sensors: options.sensors ?? [],
    cameras: options.cameras ?? [],
    colliders: options.colliders ?? [],
    field: options.field ?? DEFAULT_RUN_FIELD
  }
}

// Dashboard 패킷 묶음 하나를 텔레메트리에 합친다(웹 클라이언트 TelemetryView와 같다): cleared면 data·로그를 비우고,
// data는 키마다 마지막 값, 로그는 비어 있지 않은 것이 오면 바꾼다.
export function mergeDashTelemetry(
  previous: DashTelemetry | null,
  event: Extract<PlayEvent, { type: 'dash' }>
): DashTelemetry {
  const values = new Map(event.cleared || !previous ? [] : previous.values)
  for (const [key, value] of event.data) {
    // 최근에 바뀐 키를 뒤로(한도를 넘으면 앞에서 버린다)
    values.delete(key)
    values.set(key, value)
  }
  for (const key of values.keys()) {
    if (values.size <= MAX_DASH_KEYS) break
    values.delete(key)
  }
  const log =
    event.log !== null && event.log.length > 0
      ? event.log
      : event.cleared || !previous
        ? []
        : previous.log
  return { runId: event.runId, tNanos: event.tNanos, values, log }
}

// 텔레메트리 탭에 보이는 줄(키 정렬, Java TreeMap처럼 UTF-16 순서)
export function dashTelemetryRows(dash: DashTelemetry): [string, string][] {
  return [...dash.values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

// Config 탭에서 보낸 값(새 트리를 받을 때까지 그 칸에 보인다)
export function withPendingConfig(
  config: DashConfigState,
  path: readonly string[],
  value: string
): DashConfigState {
  return { ...config, pending: { ...config.pending, [configPathKey(path)]: value } }
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
        // 호스트는 phase finished를 finished 이벤트보다 먼저 보낸다(session.finish). 먼저 오는 쪽이 잔상을 남긴다.
        ...(event.phase === 'finished' ? endPose(data, run) : {}),
        run: {
          ...run,
          phase: event.phase,
          startRequested: event.phase === 'running' ? false : run.startRequested,
          // 단계는 앞으로만 가므로 준비 단계를 벗어났다
          libraryProgress: null
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
    case 'dash': {
      const dash = mergeDashTelemetry(data.dash?.runId === run.runId ? data.dash : null, event)
      // 오버레이는 fieldOverlay가 비어 있지 않은 패킷이 있을 때만 바뀐다(ops null이면 그대로). 새 씬과 떼어 놓은 실행의
      // 그림은 받지 않는다.
      if (event.ops === null || run.detached) return { dash }
      return { dash, dashOverlay: { runId: run.runId, tNanos: event.tNanos, ops: event.ops } }
    }
    case 'dashConfig': {
      if (run.detached) return {}
      const previous = data.dashConfig?.runId === run.runId ? data.dashConfig : null
      return {
        dashConfig: {
          runId: run.runId,
          root: run.root,
          tNanos: event.tNanos,
          tree: event.root,
          baseline: extendBaseline(previous?.baseline ?? null, event.root),
          // 사이드카가 지금 값을 다시 보냈다(보낸 값을 받았거나 거부했다)
          pending: {}
        }
      }
    }
    case 'devices':
      return {
        run: {
          ...run,
          devices: { tNanos: event.tNanos, outputs: event.outputs, inputs: event.inputs }
        }
      }
    case 'pose': {
      // 로봇이 없는 실행(세계 없음)과 끝난 실행의 자세는 받지 않는다. 늦게 온 이전 자세로 되돌아가지 않는다.
      if (run.phase === 'finished' || run.robotId === null) return {}
      const previous = data.simPose
      if (previous && previous.robotId === run.robotId && previous.tNanos > event.tNanos) return {}
      return {
        simPose: {
          robotId: run.robotId,
          tNanos: event.tNanos,
          x: event.x,
          y: event.y,
          yaw: event.yaw,
          blocked: event.blocked,
          ...poseJoints(run, event.joints)
        }
      }
    }
    case 'libraryProgress': {
      if (run.phase !== 'preparing' || run.libraryReported) return {}
      const { phase, done, total, bytes } = event
      return { run: { ...run, libraryProgress: { phase, done, total, bytes } } }
    }
    case 'libraryReport':
      return {
        run: { ...run, libraryProgress: null, libraryReported: true },
        ...withEntries(
          data,
          libraryReportLines(event.report).map((line) =>
            consoleEntry(line.body, null, line.level, run.root)
          )
        )
      }
    case 'linkWarnings':
      return withEntries(
        data,
        linkWarningLines(event.warnings).map((line) => consoleEntry(line.body, null, line.level))
      )
    case 'simNotice': {
      // Road Runner 튜닝 결과는 성공 안내이고 파일 관리자에서 보일 수 있다(그 실행의 프로젝트에서만)
      if (event.code === 'rrTuningSaved')
        return withEntries(data, [
          consoleEntry(
            {
              type: 'rrTuning',
              path: event.params.path ?? '',
              file: event.params.file ?? null
            },
            event.tNanos,
            'info',
            run.root
          )
        ])
      // 몸체 충돌 겹침(5)은 몸체·대상을 풀어 둔다(번역은 그릴 때 consoleModel.entryHeadline, 언어를 바꾸면 따라 바뀐다)
      if (event.code === 'collisionOverlap')
        return withEntries(data, [
          consoleEntry(collisionOverlapBody(run, event.params), event.tNanos, 'warning')
        ])
      // 번역 키는 console.notices.sim.<code>다(SimNoticeCode가 바뀌면 이 대입이 타입 검사에서 막힌다). 대체 자세 풀이
      // 안내(4d)는 params.solver로 문구를 고른다(spec-4d §1.14)
      const key: ConsoleNoticeKey =
        event.code === 'visionSolverSubstituted'
          ? `sim.visionSolverSubstituted.${event.params.solver === 'APRILTAG_BUILTIN' ? 'builtin' : 'sqpnp'}`
          : `sim.${event.code}`
      return withEntries(data, [
        consoleEntry({ type: 'notice', key, params: { ...event.params } }, event.tNanos, 'warning')
      ])
    }
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
        ...endPose(data, run),
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
  updateSettings: (patch: Partial<RendererPlaySettings>) => void
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
    dockTab: loadDockTab(),
    simPose: null,
    ghostPose: null,
    dash: null,
    dashOverlay: null,
    dashConfig: null
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
