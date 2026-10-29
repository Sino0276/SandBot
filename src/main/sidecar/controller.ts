import type { GradleProject } from '../../shared/gradle'
import type {
  GamepadState,
  JdkInfo,
  PlayCommand,
  PlayEvent,
  PlayInitResult
} from '../../shared/play'
import { javaTool } from '../jdk'
import {
  buildRunRequest,
  javaArgs,
  prepareRun,
  sourceMapper,
  validateRequest,
  type Failure,
  type LibraryRequest,
  type LibraryResolution,
  type PlatformResolution,
  type SidecarFiles
} from './launch'
import type { SidecarProcess, SpawnSidecar } from './process'
import { isValidSpeed, SidecarSession, type HostClock, type SessionTimeouts } from './session'
import type { WorldFactory } from './world'

// 실행(Play) 관리: 한 번에 사이드카 하나. playInit은 확인(루트 → OpMode 소스 → 로봇 구성 → 사이드카 → JDK → 바쁨) 뒤
// 팀 Gradle 파일을 읽어 컴파일 기준(Android 플랫폼 API)과 라이브러리를 정하고(받는 동안 STOP으로 취소),
// JVM을 띄우고 SidecarSession을 만든다. 명령·게임패드는 그 실행을 시작한 창의 것만 받는다. 아직 끝나지 않은 실행이
// 있으면 busy. 끝났지만(finished) 프로세스가 남아 있으면 새 실행 전에 정리한다(shutdown → 잠깐 기다림 → kill).

// 이벤트를 받을 창(Electron은 WebContents, 테스트는 가짜). 같은 창은 같은 객체여야 한다.
export type PlayOwner = { send: (event: PlayEvent) => void }

export type ControllerDeps = {
  resolveJdk: () => Promise<JdkInfo | null>
  locateSidecar: () => Promise<SidecarFiles | Failure>
  spawn: SpawnSidecar
  // 사이드카의 작업 폴더(빈 폴더)를 만들고, 실행이 끝나면 지운다
  makeRunDir: () => Promise<string>
  removeRunDir: (dir: string) => Promise<void>
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  clock?: HostClock
  timeouts?: Partial<SessionTimeouts>
  // 실행마다 새 세계(요청의 world로 만든다). 없으면 EMPTY_WORLD.
  world?: WorldFactory
  // 팀 코드의 currentTimeMillis 시작값
  epochMillis?: () => number
  // 팀 Gradle 파일 읽기(프로젝트 루트 안만). 없으면 빈 프로젝트.
  readGradle?: (projectRoot: string) => Promise<GradleProject>
  // compileSdk(부 버전 compileSdkMinor)의 플랫폼 API jar(javac 부트 클래스패스). 없으면 [](--release 8, 시험만).
  resolvePlatform?: (
    projectRoot: string,
    compileSdk: number | null,
    compileSdkMinor: number | null
  ) => Promise<PlatformResolution | Failure>
  // 라이브러리 받기·캐시. 없으면 라이브러리 없음.
  resolveLibraries?: (request: LibraryRequest) => Promise<LibraryResolution | Failure>
}

const EMPTY_GRADLE: GradleProject = {
  dependencies: [],
  repositories: [],
  compileSdk: null,
  compileSdkMinor: null,
  diagnostics: [],
  files: []
}

function noLibraries(request: LibraryRequest): Promise<LibraryResolution> {
  return Promise.resolve({
    ok: true,
    report: {
      entries: [],
      gradle: request.gradle.diagnostics,
      compileSdk: request.gradle.compileSdk,
      compileSdkMinor: request.gradle.compileSdkMinor,
      platform: null
    },
    compileClasspath: [],
    libraryClasspath: [],
    jarCoordinates: {},
    diagnosticHint: () => null
  })
}

type Active = { session: SidecarSession; owner: PlayOwner }

function isFailure(value: object): value is Failure {
  return 'ok' in value && value.ok === false
}

const AXES = ['left_stick_x', 'left_stick_y', 'right_stick_x', 'right_stick_y'] as const
const TRIGGERS = ['left_trigger', 'right_trigger'] as const
const BUTTONS = [
  'dpad_up',
  'dpad_down',
  'dpad_left',
  'dpad_right',
  'a',
  'b',
  'x',
  'y',
  'guide',
  'start',
  'back',
  'left_bumper',
  'right_bumper',
  'left_stick_button',
  'right_stick_button',
  'touchpad'
] as const

function clampNumber(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : 0
}

// 렌더러가 보낸 게임패드(믿지 않는 입력)를 정해진 필드만 담은 값으로. 객체가 아니면 연결되지 않은 것(null).
export function sanitizeGamepad(value: unknown): GamepadState | null {
  if (typeof value !== 'object' || value === null) return null
  const data = value as Record<string, unknown>
  const state = {} as Record<string, number | boolean>
  for (const key of AXES) state[key] = clampNumber(data[key], -1, 1)
  for (const key of TRIGGERS) state[key] = clampNumber(data[key], 0, 1)
  for (const key of BUTTONS) state[key] = data[key] === true
  return state as GamepadState
}

export function parseCommand(value: unknown): PlayCommand | null {
  if (typeof value !== 'object' || value === null) return null
  const data = value as Record<string, unknown>
  switch (data.type) {
    case 'start':
    case 'stop':
    case 'step':
      return { type: data.type }
    case 'pause':
      return typeof data.paused === 'boolean' ? { type: 'pause', paused: data.paused } : null
    case 'speed':
      return isValidSpeed(data.speed) ? { type: 'speed', speed: data.speed } : null
    default:
      return null
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PlayController {
  private active: Active | null = null
  private starting = false
  // 라이브러리를 받는 중인 INIT(그 창의 STOP이 취소한다)
  private preparing: { owner: PlayOwner; abort: AbortController } | null = null
  // 창마다 disposeOwner를 부른 횟수. 준비(await) 중에 그 창이 닫히거나 새로고침되면 띄운 실행을 바로 정리한다
  // (아니면 받을 창이 없는 JVM이 남아 다른 실행을 busy로 막는다).
  private readonly disposals = new WeakMap<PlayOwner, number>()

  constructor(private readonly deps: ControllerDeps) {}

  // 프로세스가 아직 살아 있는지(앱을 끝내기 전에 정리할 것이 있는지)
  get hasProcess(): boolean {
    return this.active !== null && !this.active.session.exited
  }

  async init(input: unknown, owner: PlayOwner): Promise<PlayInitResult> {
    const generation = this.disposals.get(owner) ?? 0
    const ownerGone = (): boolean => (this.disposals.get(owner) ?? 0) !== generation
    const request = validateRequest(input)
    if (isFailure(request)) return request
    const prepared = await prepareRun(request)
    if (isFailure(prepared)) return prepared
    const files = await this.deps.locateSidecar()
    if (isFailure(files)) return files
    const jdk = await this.deps.resolveJdk()
    if (!jdk) return { ok: false, code: 'noJdk', detail: '' }
    if (ownerGone()) return { ok: false, code: 'failed', detail: 'the window was closed' }
    // 확인과 표시를 같은 동기 구간에서 한다(동시에 온 playInit 둘이 같이 통과하지 않게)
    if (this.starting || (this.active && !this.active.session.finished))
      return { ok: false, code: 'busy', detail: '' }
    this.starting = true
    try {
      const gradle = await (this.deps.readGradle?.(prepared.projectRoot) ??
        Promise.resolve(EMPTY_GRADLE))
      const platform = await (this.deps.resolvePlatform?.(
        prepared.projectRoot,
        gradle.compileSdk,
        gradle.compileSdkMinor
      ) ??
        Promise.resolve<PlatformResolution>({
          ok: true,
          bootClasspath: [],
          api: null,
          minor: null,
          guessed: false
        }))
      if (isFailure(platform)) return platform
      const abort = new AbortController()
      this.preparing = { owner, abort }
      let libraries: LibraryResolution | Failure
      try {
        libraries = await (this.deps.resolveLibraries ?? noLibraries)({
          projectRoot: prepared.projectRoot,
          gradle,
          signal: abort.signal,
          progress: (progress) =>
            owner.send({ type: 'libraryProgress', runId: request.runId, ...progress })
        })
      } finally {
        this.preparing = null
      }
      if (abort.signal.aborted) return { ok: false, code: 'cancelled', detail: '' }
      if (isFailure(libraries)) return libraries
      owner.send({
        type: 'libraryReport',
        runId: request.runId,
        report: {
          ...libraries.report,
          platform:
            platform.api === null
              ? null
              : { api: platform.api, minor: platform.minor, guessed: platform.guessed }
        }
      })
      if (ownerGone()) return { ok: false, code: 'failed', detail: 'the window was closed' }
      if (this.active) await this.active.session.dispose()
      const runDir = await this.deps.makeRunDir()
      let process: SidecarProcess
      try {
        process = await this.deps.spawn(
          javaTool(jdk.home, 'java', this.deps.platform),
          javaArgs(files, this.deps.platform),
          { cwd: runDir, env: this.deps.env }
        )
      } catch (error) {
        await this.deps.removeRunDir(runDir).catch(() => undefined)
        return { ok: false, code: 'failed', detail: errorText(error) }
      }
      const session = new SidecarSession(
        process,
        buildRunRequest(
          prepared,
          request,
          {
            bootClasspath: platform.bootClasspath,
            compileClasspath: [files.sdkJar, ...libraries.compileClasspath],
            libraryClasspath: libraries.libraryClasspath
          },
          (this.deps.epochMillis ?? Date.now)()
        ),
        {
          runId: request.runId,
          flavor: request.opMode.flavor,
          speed: request.settings.speed,
          autoStopAutonomous: request.settings.autoStopAutonomous,
          preselectTeleOp: prepared.preselectTeleOp,
          mapSource: sourceMapper(prepared.projectRoot),
          jarCoordinates: libraries.jarCoordinates,
          diagnosticHint: libraries.diagnosticHint,
          emit: (event) => owner.send(event),
          clock: this.deps.clock,
          world: this.deps.world?.(request.world),
          timeouts: this.deps.timeouts
        }
      )
      const active: Active = { session, owner }
      this.active = active
      void session.done.then(async () => {
        await this.deps.removeRunDir(runDir).catch(() => undefined)
        if (this.active === active) this.active = null
      })
      if (ownerGone()) {
        void session.dispose()
        return { ok: false, code: 'failed', detail: 'the window was closed' }
      }
      return prepared.configMissing ? { ok: true, configMissing: true } : { ok: true }
    } finally {
      this.starting = false
    }
  }

  // 실행이 없거나 다른 창의 명령이면 무시한다. 라이브러리를 받는 중이면 그 창의 STOP이 INIT을 취소한다.
  command(input: unknown, owner: PlayOwner): void {
    const command = parseCommand(input)
    if (!command) return
    const preparing = this.preparing
    if (preparing && preparing.owner === owner && command.type === 'stop') {
      preparing.abort.abort()
      return
    }
    const active = this.active
    if (!active || active.owner !== owner) return
    active.session.command(command)
  }

  gamepads(input: unknown, owner: PlayOwner): void {
    const active = this.active
    if (!active || active.owner !== owner || !Array.isArray(input) || input.length !== 2) return
    active.session.setGamepads([sanitizeGamepad(input[0]), sanitizeGamepad(input[1])])
  }

  // 창이 닫히거나 새로고침되면 그 창의 실행을 정리한다(받는 중인 라이브러리도 멈춘다)
  disposeOwner(owner: PlayOwner): Promise<void> {
    this.disposals.set(owner, (this.disposals.get(owner) ?? 0) + 1)
    if (this.preparing?.owner === owner) this.preparing.abort.abort()
    const active = this.active
    if (!active || active.owner !== owner) return Promise.resolve()
    return active.session.dispose()
  }

  disposeAll(): Promise<void> {
    return this.active ? this.active.session.dispose() : Promise.resolve()
  }
}
