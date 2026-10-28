import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { JdkInfo, PlayEvent, PlayInitRequest } from '../../shared/play'
import type { HostMessage } from '../../shared/sidecarProtocol'
import { WORLD_SPEC_VERSION, type WorldSpec } from '../../shared/sim/worldSpec'
import { clearTrustedRoots, trustRoot } from '../projectRoots'
import { parseCommand, PlayController, sanitizeGamepad, type ControllerDeps } from './controller'
import { javaArgs, type SidecarFiles } from './launch'
import { spawnSidecar, type SidecarProcess, type SpawnSidecar } from './process'
import { FAKE_SIDECAR_SCRIPT, FakeClock } from './testkit'
import { kinematicWorld } from './world'

// 진짜 프로세스(node로 돌리는 가짜 사이드카)와 파이프로 호스트 전체(확인 → spawn → 세션 → 이벤트)를 시험한다.

const PKG = 'src/main/java/org/firstinspires/ftc/teamcode'
const JDK: JdkInfo = { home: '/fake/jdk', version: '21.0.4', major: 21, source: 'path' }
const FILES: SidecarFiles = {
  dir: '/fake/sidecar',
  runtimeJar: '/fake/sidecar/sandbot-runtime.jar',
  sdkJar: '/fake/sidecar/sandbot-sdk.jar'
}

type Recorded = { sent: HostMessage[]; ticksSeen: number }

async function waitFor(check: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('PlayController + 가짜 사이드카', () => {
  let dir: string
  let root: string
  let script: string
  let events: PlayEvent[]
  let spawned: { command: string; args: string[]; cwd: string }[]
  let recorded: Recorded[]
  let controller: PlayController
  const owner = { send: (event: PlayEvent): void => void events.push(event) }

  const of = <T extends PlayEvent['type']>(
    type: T,
    runId?: string
  ): Extract<PlayEvent, { type: T }>[] =>
    events.filter(
      (event): event is Extract<PlayEvent, { type: T }> =>
        event.type === type && (runId === undefined || event.runId === runId)
    )

  const finished = (runId: string): Extract<PlayEvent, { type: 'finished' }> | undefined =>
    of('finished', runId)[0]

  const make = (overrides: Partial<ControllerDeps> = {}): PlayController => {
    // 진짜 spawn 앞에 node와 가짜 스크립트를 붙이고, 보낸 메시지와 받은 틱을 센다
    const spawn: SpawnSidecar = async (command, args, options) => {
      spawned.push({ command, args, cwd: options.cwd })
      const process = await spawnSidecar(globalThis.process.execPath, [script, ...args], options)
      const record: Recorded = { sent: [], ticksSeen: 0 }
      recorded.push(record)
      const wrapped: SidecarProcess = {
        send: (message) => {
          record.sent.push(message)
          process.send(message)
        },
        kill: () => process.kill(),
        onStdout: (listener) =>
          process.onStdout((chunk) => {
            record.ticksSeen += chunk.split('"type":"tick"').length - 1
            listener(chunk)
          }),
        onStderr: (listener) => process.onStderr(listener),
        onExit: (listener) => process.onExit(listener)
      }
      return wrapped
    }
    return new PlayController({
      resolveJdk: async () => JDK,
      locateSidecar: async () => FILES,
      spawn,
      makeRunDir: () => mkdtemp(join(dir, 'run-')),
      removeRunDir: (path) => rm(path, { recursive: true, force: true }),
      platform: 'linux',
      env: { ...process.env },
      timeouts: { stopKillMs: 300, shutdownGraceMs: 300 },
      epochMillis: () => 1000,
      ...overrides
    })
  }

  const opModeRequest = (
    name: string,
    overrides: Partial<PlayInitRequest> = {}
  ): PlayInitRequest => ({
    runId: `run-${name}-${Math.random().toString(36).slice(2, 8)}`,
    root,
    opMode: {
      className: `org.firstinspires.ftc.teamcode.${name}`,
      path: `${PKG}/${name}.java`,
      flavor: 'TeleOp'
    },
    configPath: null,
    settings: { speed: 1, jitter: 0, seed: 7, autoStopAutonomous: true, batteryVoltage: 12.5 },
    world: null,
    ...overrides
  })

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-controller-'))
    script = join(dir, 'fake-sidecar.cjs')
    await writeFile(script, FAKE_SIDECAR_SCRIPT)
    root = join(dir, 'project')
    for (const name of [
      'Normal',
      'SlowLoop',
      'Crash',
      'Stall',
      'NeverStop',
      'Garbage',
      'Truncated',
      'CompileError',
      'Returns',
      'Errors',
      'IgnoreShutdown'
    ]) {
      const file = join(root, 'TeamCode', PKG, `${name}.java`)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(
        file,
        [
          'package org.firstinspires.ftc.teamcode;',
          'import com.qualcomm.robotcore.eventloop.opmode.*;',
          name === 'Returns' ? '@Autonomous(preselectTeleOp = "Normal")' : '@TeleOp',
          `public class ${name} extends LinearOpMode {}`,
          ''
        ].join('\n')
      )
    }
    const config = join(root, 'TeamCode', 'src/main/res/xml/sandbot_robot.xml')
    await mkdir(dirname(config), { recursive: true })
    await writeFile(config, '<Robot/>')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    clearTrustedRoots()
    trustRoot(root)
    events = []
    spawned = []
    recorded = []
    controller = make()
  })

  afterEach(async () => {
    await controller.disposeAll()
  })

  it('INIT → START → STOP: 단계·텔레메트리·장치·로그, RunRequest와 JVM 명령, 모든 이벤트에 runId', async () => {
    const request = opModeRequest('Normal', { configPath: 'src/main/res/xml/sandbot_robot.xml' })
    expect(await controller.init(request, owner)).toEqual({ ok: true })
    await waitFor(() => of('telemetry').length > 0 && of('devices').length > 0)
    expect(of('phase').map((event) => event.phase)).toEqual(['preparing', 'compiling', 'init'])
    expect(spawned[0].command).toBe('/fake/jdk/bin/java')
    expect(spawned[0].args).toEqual(javaArgs(FILES, 'linux'))
    expect(spawned[0].cwd.startsWith(join(dir, 'run-'))).toBe(true)

    await waitFor(() => of('log').length > 0)
    const robotLog = of('log')
      .flatMap((event) => event.entries)
      .filter((entry) => entry.stream === 'robotLog')
      .map((entry) => entry.text)
    const run = JSON.parse(robotLog.find((text) => text.startsWith('request '))!.slice(8))
    expect(run).toMatchObject({
      type: 'run',
      protocol: 1,
      clock: 'virtual',
      opModeClass: 'org.firstinspires.ftc.teamcode.Normal',
      opModeSource: join(root, 'TeamCode', PKG, 'Normal.java'),
      sourceRoots: [join(root, 'TeamCode', 'src', 'main', 'java')],
      sdkClasspath: [FILES.sdkJar],
      configXml: join(root, 'TeamCode', 'src', 'main', 'res', 'xml', 'sandbot_robot.xml'),
      seed: 7,
      startEpochMillis: 1000
    })

    controller.command({ type: 'start' }, owner)
    await waitFor(() => of('phase').some((event) => event.phase === 'running'))
    await waitFor(() => of('devices').some((event) => event.outputs.motor?.power === 0.5))
    controller.command({ type: 'stop' }, owner)
    await waitFor(() => finished(request.runId) !== undefined)
    expect(finished(request.runId)).toMatchObject({ reason: 'stopped', detail: '' })
    expect(of('phase').map((event) => event.phase)).toEqual([
      'preparing',
      'compiling',
      'init',
      'running',
      'stopping',
      'finished'
    ])
    expect(events.every((event) => event.runId === request.runId)).toBe(true)
    const telemetry = of('telemetry')
    expect(telemetry.at(-1)?.frame.lines[0]).toMatch(/^tick : \d+$/)
    // 1×라 틱(5 ms)마다 보내는 텔레메트리를 다 보내지 않는다(30 Hz 이하)
    expect(telemetry.length).toBeLessThan(recorded[0].ticksSeen)
  })

  it('실행 중에는 busy, 끝난 뒤에는 새 실행을 받는다', async () => {
    const first = opModeRequest('Normal')
    expect(await controller.init(first, owner)).toEqual({ ok: true })
    expect(await controller.init(opModeRequest('Normal'), owner)).toMatchObject({
      ok: false,
      code: 'busy'
    })
    controller.command({ type: 'stop' }, owner)
    await waitFor(() => finished(first.runId) !== undefined)
    const second = opModeRequest('Normal')
    expect(await controller.init(second, owner)).toEqual({ ok: true })
    await waitFor(() => of('phase', second.runId).some((event) => event.phase === 'init'))
  })

  it('다른 창의 명령·게임패드는 무시한다', async () => {
    const request = opModeRequest('Normal')
    await controller.init(request, owner)
    await waitFor(() => of('phase').some((event) => event.phase === 'init'))
    const stranger = { send: (): void => undefined }
    controller.command({ type: 'start' }, stranger)
    controller.gamepads([{ a: true }, null], stranger)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(of('phase').some((event) => event.phase === 'running')).toBe(false)
    controller.gamepads([{ a: true, left_stick_y: -2 }, null], owner)
    await waitFor(() =>
      recorded[0].sent.some(
        (message) => message.type === 'tickReply' && message.gamepads[0]?.a === true
      )
    )
    const reply = recorded[0].sent.find(
      (message) => message.type === 'tickReply' && message.gamepads[0]?.a === true
    )
    expect(reply?.type === 'tickReply' && reply.gamepads[0]?.left_stick_y).toBe(-1)
  })

  it('finished 없이 끝나면 crashed(stderr, JVM 안내 줄은 뺀다)', async () => {
    const request = opModeRequest('Crash')
    await controller.init(request, owner)
    await waitFor(() => finished(request.runId) !== undefined)
    const event = finished(request.runId)!
    expect(event.reason).toBe('crashed')
    expect(event.detail).toBe(
      'exit code 1\nException in thread "main" java.lang.OutOfMemoryError: Java heap space'
    )
  })

  it('JSON이 아닌 출력과 잘린 줄은 crashed', async () => {
    const garbage = opModeRequest('Garbage')
    await controller.init(garbage, owner)
    await waitFor(() => finished(garbage.runId) !== undefined)
    expect(finished(garbage.runId)).toMatchObject({ reason: 'crashed' })
    expect(finished(garbage.runId)!.detail).toMatch(/^protocol error: invalid JSON/)

    const truncated = opModeRequest('Truncated')
    await controller.init(truncated, owner)
    await waitFor(() => finished(truncated.runId) !== undefined)
    expect(finished(truncated.runId)).toMatchObject({
      reason: 'crashed',
      detail: 'exit code 0; truncated output'
    })
  })

  it('STOP 뒤 끝나지 않으면 kill(killed stopTimeout)', async () => {
    const request = opModeRequest('NeverStop')
    await controller.init(request, owner)
    await waitFor(() => of('phase').some((event) => event.phase === 'init'))
    controller.command({ type: 'stop' }, owner)
    await waitFor(() => of('phase').some((event) => event.phase === 'stopping'))
    await waitFor(() => finished(request.runId) !== undefined)
    expect(finished(request.runId)).toMatchObject({ reason: 'killed', detail: 'stopTimeout' })
  })

  it('stall을 받은 뒤 STOP이면 바로 kill(killed stalled)', async () => {
    const request = opModeRequest('Stall')
    await controller.init(request, owner)
    await waitFor(() => of('phase').some((event) => event.phase === 'init'))
    controller.command({ type: 'start' }, owner)
    await waitFor(() => of('error').some((event) => event.kind === 'stall'))
    const before = Date.now()
    controller.command({ type: 'stop' }, owner)
    await waitFor(() => finished(request.runId) !== undefined)
    expect(Date.now() - before).toBeLessThan(250)
    expect(finished(request.runId)).toMatchObject({ reason: 'killed', detail: 'stalled' })
  })

  it('컴파일 오류의 진단 경로는 TeamCode 기준이다', async () => {
    const request = opModeRequest('CompileError')
    await controller.init(request, owner)
    await waitFor(() => finished(request.runId) !== undefined)
    expect(of('compiled')).toMatchObject([
      {
        ok: false,
        diagnostics: [
          {
            kind: 'error',
            path: `${PKG}/CompileError.java`,
            file: `${PKG}/CompileError.java`,
            line: 3,
            column: 9
          }
        ]
      }
    ])
    expect(finished(request.runId)).toMatchObject({ reason: 'compileFailed' })
  })

  it('오류 스택의 팀 코드 줄은 TeamCode 기준 경로를 갖는다', async () => {
    const request = opModeRequest('Errors', {
      settings: { speed: 'max', jitter: 0, seed: 0, autoStopAutonomous: true, batteryVoltage: 12.5 }
    })
    await controller.init(request, owner)
    await waitFor(() => finished(request.runId) !== undefined)
    expect(of('error')[0].stack.map((frame) => frame.path)).toEqual([`${PKG}/Errors.java`, null])
    expect(finished(request.runId)).toMatchObject({ reason: 'exception' })
  })

  it('스스로 끝난 Autonomous는 preselectTeleOp를 준다', async () => {
    const request = opModeRequest('Returns', {
      opMode: {
        className: 'org.firstinspires.ftc.teamcode.Returns',
        path: `${PKG}/Returns.java`,
        flavor: 'Autonomous'
      },
      settings: { speed: 'max', jitter: 0, seed: 0, autoStopAutonomous: true, batteryVoltage: 12.5 }
    })
    await controller.init(request, owner)
    await waitFor(() => finished(request.runId) !== undefined)
    expect(finished(request.runId)).toMatchObject({ reason: 'returned', preselectTeleOp: 'Normal' })
  })

  it('창을 닫으면 shutdown, 답하지 않으면 kill', async () => {
    const polite = opModeRequest('Normal')
    await controller.init(polite, owner)
    await waitFor(() => of('phase').some((event) => event.phase === 'init'))
    await controller.disposeOwner(owner)
    expect(finished(polite.runId)).toMatchObject({ reason: 'shutdown' })
    expect(controller.hasProcess).toBe(false)

    const rude = opModeRequest('IgnoreShutdown')
    await controller.init(rude, owner)
    await waitFor(() => of('phase', rude.runId).some((event) => event.phase === 'init'))
    await controller.disposeOwner(owner)
    expect(finished(rude.runId)).toMatchObject({ reason: 'killed', detail: 'shutdownTimeout' })
  })

  it('준비 중(JVM을 띄우기 전)에 창이 닫히면 띄운 실행을 바로 정리하고 다른 창의 실행을 막지 않는다', async () => {
    let releaseJdk: () => void = () => undefined
    const jdkGate = new Promise<void>((resolve) => (releaseJdk = resolve))
    controller = make({ resolveJdk: () => jdkGate.then(() => JDK) })
    const closing = opModeRequest('Normal')
    const pending = controller.init(closing, owner)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await controller.disposeOwner(owner)
    releaseJdk()
    expect(await pending).toMatchObject({ ok: false, code: 'failed' })
    await waitFor(() => !controller.hasProcess)

    const other = { send: (event: PlayEvent): void => void events.push(event) }
    const next = opModeRequest('Normal')
    expect(await controller.init(next, other)).toEqual({ ok: true })
    await waitFor(() => of('phase', next.runId).some((event) => event.phase === 'init'))
  })

  it('확인 실패: 열지 않은 루트, TeamCode 밖 경로, 잘못된 구성 경로, 없는 파일, JDK·사이드카 없음, 실행 실패', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'sandbot-controller-outside-'))
    try {
      expect(
        await controller.init(opModeRequest('Normal', { root: outside }), owner)
      ).toMatchObject({ ok: false, code: 'notAllowed' })
      expect(
        await controller.init(
          opModeRequest('Normal', {
            opMode: { className: 'x.Evil', path: 'src/main/java/../../Evil.java', flavor: 'TeleOp' }
          }),
          owner
        )
      ).toMatchObject({ ok: false, code: 'notAllowed' })
      expect(
        await controller.init(
          opModeRequest('Normal', { configPath: 'src/main/res/xml/robot.xml' }),
          owner
        )
      ).toMatchObject({ ok: false, code: 'notAllowed' })
      expect(await controller.init(opModeRequest('Missing'), owner)).toMatchObject({
        ok: false,
        code: 'missing'
      })
      const noJdk = make({ resolveJdk: async () => null })
      expect(await noJdk.init(opModeRequest('Normal'), owner)).toMatchObject({
        ok: false,
        code: 'noJdk'
      })
      const noSidecar = make({
        locateSidecar: async () => ({ ok: false, code: 'noSidecar', detail: 'not built' })
      })
      expect(await noSidecar.init(opModeRequest('Normal'), owner)).toEqual({
        ok: false,
        code: 'noSidecar',
        detail: 'not built'
      })
      const cannotSpawn = make({
        spawn: (_command, args, options) => spawnSidecar(join(dir, 'no-such-java'), args, options)
      })
      expect(await cannotSpawn.init(opModeRequest('Normal'), owner)).toMatchObject({
        ok: false,
        code: 'failed'
      })
      expect(events).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('진짜 파이프에서도 가짜 시계로 페이스·일시 정지·Step이 맞다', async () => {
    const clock = new FakeClock()
    controller = make({ clock })
    const request = opModeRequest('SlowLoop')
    await controller.init(request, owner)
    const record = (): Recorded => recorded[0]
    const replies = (): number[] =>
      record()
        .sent.filter((message) => message.type === 'tickReply')
        .map((message) => (message.type === 'tickReply' ? message.tick : -1))
    // 틱 0은 바로(기준점), 틱 1은 가상 5 ms = 실제 5 ms 뒤
    await waitFor(() => replies().length === 1)
    await waitFor(() => record().ticksSeen === 2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(replies()).toEqual([0])
    clock.advance(5)
    expect(replies()).toEqual([0, 1])
    // 일시 정지: 틱 2를 둔다
    controller.command({ type: 'pause', paused: true }, owner)
    await waitFor(() => record().ticksSeen === 3)
    clock.advance(1000)
    expect(replies()).toEqual([0, 1])
    // Step: SlowLoop는 4틱마다 loops가 는다(틱 0·4·8…). 틱 2부터 틱 4(loops 증가)까지 진행하고 멈춘다.
    controller.command({ type: 'step' }, owner)
    await waitFor(() => record().ticksSeen === 5)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(replies()).toEqual([0, 1, 2, 3])
    // START는 일시 정지를 풀고 다음 답에 실린다
    controller.command({ type: 'start' }, owner)
    clock.advance(5)
    const last = record()
      .sent.filter((message) => message.type === 'tickReply')
      .at(-1)
    expect(last).toMatchObject({ tick: 4, events: ['start'] })
    controller.command({ type: 'stop' }, owner)
    for (let i = 0; i < 400 && finished(request.runId) === undefined; i++) {
      clock.advance(5)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    expect(finished(request.runId)).toMatchObject({ reason: 'stopped' })
  })

  it('요청의 세계 설명으로 실행마다 운동학 시뮬레이터를 만든다(없으면 빈 세계)', async () => {
    controller = make({ world: kinematicWorld })
    const world: WorldSpec = {
      version: WORLD_SPEC_VERSION,
      robot: {
        start: { x: 0.25, y: -0.5, yaw: 0.5 },
        footprint: [
          { x: 0.2, y: 0.2 },
          { x: -0.2, y: 0.2 },
          { x: -0.2, y: -0.2 }
        ]
      },
      batteryVoltage: 11.5,
      hubs: ['Control Hub'],
      motors: [{ device: 'motor', modelTag: 'TetrixMotor', gearbox: 52, directionSign: 1 }],
      wheels: [],
      deadWheels: [],
      pinpoints: [],
      otos: [],
      imus: []
    }
    const request = opModeRequest('Normal', { world })
    expect(await controller.init(request, owner)).toEqual({ ok: true })
    await waitFor(() => of('pose', request.runId).length > 0)
    expect(of('pose', request.runId)[0]).toMatchObject({
      x: 0.25,
      y: -0.5,
      yaw: 0.5,
      blocked: false
    })
    await waitFor(() => of('devices', request.runId).length > 0)
    expect(of('devices', request.runId)[0].inputs).toEqual({
      'Control Hub': { voltage: 11.5 },
      motor: { position: 0, velocity: 0 }
    })
    const firstReply = recorded[0].sent.find((message) => message.type === 'tickReply')
    expect(firstReply).toMatchObject({
      inputs: { 'Control Hub': { voltage: 11.5 }, motor: { position: 0, velocity: 0 } }
    })
    controller.command({ type: 'stop' }, owner)
    await waitFor(() => finished(request.runId) !== undefined)

    // 세계 설명이 없으면 자세·입력이 없다
    const empty = opModeRequest('Normal')
    expect(await controller.init(empty, owner)).toEqual({ ok: true })
    await waitFor(() => of('devices', empty.runId).length > 0)
    expect(of('devices', empty.runId)[0].inputs).toEqual({})
    controller.command({ type: 'stop' }, owner)
    await waitFor(() => finished(empty.runId) !== undefined)
    expect(of('pose', empty.runId)).toEqual([])
  })

  it('틀린 세계 설명은 실행 전에 거부한다', async () => {
    const request = opModeRequest('Normal', {
      world: { version: WORLD_SPEC_VERSION } as unknown as WorldSpec
    })
    expect(await controller.init(request, owner)).toMatchObject({
      ok: false,
      code: 'notAllowed',
      detail: 'invalid request: world: robot'
    })
    expect(spawned).toEqual([])
  })
})

describe('렌더러 입력 확인', () => {
  it('명령 모양', () => {
    expect(parseCommand({ type: 'start' })).toEqual({ type: 'start' })
    expect(parseCommand({ type: 'pause', paused: true })).toEqual({ type: 'pause', paused: true })
    expect(parseCommand({ type: 'pause' })).toBeNull()
    expect(parseCommand({ type: 'speed', speed: 'max' })).toEqual({ type: 'speed', speed: 'max' })
    expect(parseCommand({ type: 'speed', speed: -1 })).toBeNull()
    expect(parseCommand({ type: 'speed', speed: Number.NaN })).toBeNull()
    expect(parseCommand({ type: 'reboot' })).toBeNull()
    expect(parseCommand(null)).toBeNull()
  })

  it('게임패드는 정해진 필드만, 범위 안으로', () => {
    expect(sanitizeGamepad(null)).toBeNull()
    const pad = sanitizeGamepad({ a: true, b: 'yes', left_stick_x: 3, right_trigger: -1, evil: 1 })
    expect(pad).toMatchObject({ a: true, b: false, left_stick_x: 1, right_trigger: 0 })
    expect(pad && 'evil' in pad).toBe(false)
    expect(Object.keys(pad!).length).toBe(22)
  })
})
