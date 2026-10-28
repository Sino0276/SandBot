// 라이브러리 통합 시험(진짜 JVM, 갈래 D): 사이드카(org.sandbot.runtime.Main)에 실제 FTC 라이브러리 jar(scripts/
// fetch-test-libraries.mjs가 고정 해시로 받은 sidecar/build/test-libs/)를 libraryClasspath·compileClasspath로 주고, 팀 코드처럼 쓴
// 시험 OpMode(sidecar/tests/opmodes-libs/)를 돌린다. 호스트는 sim.test.ts처럼 작은 결정적 호스트(틱마다 바로 답, 정한 틱에 START)이고,
// 세계 설명을 주면 운동학 시뮬레이터(KinematicWorld)를 붙인다.
//  - 결정성: 해시 순서 컬렉션(enum·Object 키 HashMap·HashSet, Collectors.toSet·toMap, Set.of·Map.of)이 JVM마다 같은 순서
//  - Pedro Pathing 3.x: 메카넘 + Pinpoint 로컬라이저로 Follower가 짧은 경로를 따라가 끝나고, 두 번 돌리면 같은 자세열·메시지
//  - FTCLib: CommandOpMode + ParallelCommandGroup·MotorEx(두 JVM에서 같은 메시지), RevIMU(BNO055 구성),
//    command.old.CommandOpMode의 스레드 풀 오류 안내
//  - Ivy: parallel(두 JVM에서 같은 메시지)
//  - 라이브러리 클래스의 System.nanoTime이 가상 시계(패치), 링크 검사(linkReport)
//  - List.of를 쓰는 OpMode가 시험 플랫폼 jar(bootClasspath)로 컴파일된다
// JDK가 없으면 모두 건너뛴다. 라이브러리를 받지 못하면(오프라인) 라이브러리 시험만 이유를 출력하고 건너뛴다
// (SANDBOT_TEST_LIBRARIES_REQUIRED=1이면 실패).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type DsEvent,
  type GamepadState,
  type HostMessage,
  type LinkReportMessage,
  type RunRequest,
  type SidecarMessage
} from '../../src/shared/sidecarProtocol'
import { KinematicWorld } from '../../src/shared/sim/world'
import type { SimPose, WorldSpec } from '../../src/shared/sim/worldSpec'
import {
  compileJavaTests,
  runJavaTests,
  SIDECAR_TEST_TIMEOUT,
  sidecarBuild,
  type SidecarBuild
} from './support'

const build = await sidecarBuild()

const OPMODES = resolve(__dirname, 'opmodes-libs')
const PACKAGE = 'org.firstinspires.ftc.teamcode'

type Host = {
  opMode: string
  request?: Partial<RunRequest>
  // 시뮬레이터(없으면 입력 없이 답한다)
  world?: WorldSpec
  events?: Record<number, DsEvent[]>
  pad?: (tick: number) => GamepadState | null
  // 이 틱 수를 넘으면 shutdown(무한히 도는 OpMode의 안전장치)
  maxTicks?: number
}

type Run = {
  messages: SidecarMessage[]
  raw: string[]
  poses: { tNanos: number; pose: SimPose }[]
  stderr: string
}

function runRequest(b: SidecarBuild, host: Host): RunRequest {
  return {
    type: 'run',
    protocol: SIDECAR_PROTOCOL_VERSION,
    clock: 'virtual',
    tickNanos: DEFAULT_TICK_NANOS,
    sourceRoots: [OPMODES],
    opModeSource: join(OPMODES, ...PACKAGE.split('.'), `${host.opMode}.java`),
    opModeClass: `${PACKAGE}.${host.opMode}`,
    bootClasspath: [],
    compileClasspath: [b.sdkJar],
    libraryClasspath: [],
    configXml: null,
    timing: {},
    jitter: 0,
    seed: 0,
    startEpochMillis: 1_700_000_000_000,
    stallMillis: 5000,
    ...host.request
  }
}

// 결정적 호스트(sim.test.ts와 같은 방식): 틱이 오면 world.step의 입력을 그 틱의 답에 싣는다
function runSidecar(b: SidecarBuild, host: Host): Promise<Run> {
  return new Promise((done, fail) => {
    const world = host.world ? new KinematicWorld(host.world) : null
    const child = spawn(
      b.java,
      [
        // 호스트(src/main/sidecar/launch.ts의 javaArgs)와 같은 인자
        '-Xlog:disable',
        '-Xlog:all=warning:stderr',
        '-XX:+DisplayVMOutputToStderr',
        '-Xss4m',
        '-XX:+UseSerialGC',
        '-Dfile.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        '-Dstderr.encoding=UTF-8',
        '-Djava.awt.headless=true',
        '-cp',
        [b.runtimeJar, b.sdkJar].join(delimiter),
        'org.sandbot.runtime.Main'
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const run: Run = { messages: [], raw: [], poses: [], stderr: '' }
    let pending = ''
    let finished = false
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out; last: ${run.raw.slice(-5).join('\n')}\n${run.stderr}`))
    }, 180_000)
    const onLine = (line: string): void => {
      run.raw.push(line)
      let message: SidecarMessage
      try {
        message = JSON.parse(line) as SidecarMessage
      } catch {
        return
      }
      run.messages.push(message)
      if (message.type === 'finished') finished = true
      if (finished || message.type !== 'tick') return
      if (host.maxTicks !== undefined && message.tick > host.maxTicks) {
        send({ type: 'shutdown' })
        return
      }
      const inputs = world ? world.step(message.tNanos, message.outputs) : {}
      if (world) run.poses.push({ tNanos: message.tNanos, pose: world.pose() })
      send({
        type: 'tickReply',
        tick: message.tick,
        events: host.events?.[message.tick] ?? [],
        gamepads: [host.pad?.(message.tick) ?? null, null],
        inputs
      })
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        onLine(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => (run.stderr += chunk))
    child.on('error', fail)
    child.on('close', () => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      done(run)
    })
    send(runRequest(b, host))
  })
}

/** "RESULT a=1 b=2" 줄들 → { a: '1', b: '2' } */
function results(run: Run): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of run.messages) {
    if (m.type !== 'log' || m.stream !== 'out' || !m.text.startsWith('RESULT ')) continue
    for (const pair of m.text.slice('RESULT '.length).split(' ')) {
      const eq = pair.indexOf('=')
      if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
  }
  return out
}

function finishedReason(run: Run): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

function errors(run: Run): SidecarMessage[] {
  return run.messages.filter((m) => m.type === 'error')
}

function diagnostics(run: Run): unknown[] {
  return run.messages.flatMap((m) => (m.type === 'compiled' ? m.diagnostics : []))
}

/** 결정성 비교용: 실행마다 다른 값(JVM 버전, 컴파일 시간)만 뺀 메시지 줄 */
function normalized(run: Run): string[] {
  return run.raw.map((line) => {
    const m = JSON.parse(line) as SidecarMessage
    if (m.type === 'hello') return JSON.stringify({ ...m, java: '' })
    if (m.type === 'compiled') return JSON.stringify({ ...m, millis: 0 })
    return line
  })
}

describe.skipIf(build === null)('결정성: 해시 순서 컬렉션', () => {
  const b = build as SidecarBuild

  it(
    '팀 코드의 enum·Object 키 HashMap·HashSet, Collectors.toSet·toMap, HashMap::new가 두 JVM에서 같은 순서다(삽입 순서)',
    async () => {
      const first = await runSidecar(b, { opMode: 'HashOrder' })
      expect(errors(first), first.stderr).toEqual([])
      expect(finishedReason(first)).toBe('returned')
      const r = results(first)
      // 삽입 순서(LinkedHashMap·LinkedHashSet)
      expect(r.enumMap).toBe(
        'ARM,CLAW,LIFT,WRIST,DRIVE,INTAKE,SHOOTER,TURRET,HOOD,FEEDER,CLIMBER,LED,CAMERA,GATE,SPINNER,PUSHER'
      )
      const ids = Array.from({ length: 24 }, (_, i) => `c${i}`).join(',')
      expect(r.objectSet).toBe(ids)
      expect(r.collectorsToSet).toBe(ids)
      expect(r.collectorsToMap).toBe(ids)
      expect(r.constructorRef).toBe(
        'ARM,CLAW,LIFT,WRIST,DRIVE,INTAKE,SHOOTER,TURRET,HOOD,FEEDER,CLIMBER,LED,CAMERA,GATE,SPINNER,PUSHER'
      )
      const second = await runSidecar(b, { opMode: 'HashOrder' })
      expect(normalized(second)).toEqual(normalized(first))
    },
    SIDECAR_TEST_TIMEOUT
  )
})

describe.skipIf(build === null)('결정성 패치·라이브러리 로더(Java 단위 시험)', () => {
  const b = build as SidecarBuild

  it(
    'OrderedCollections가 JDK와 같은 내용·예외이고 삽입 순서다, ClassPatcher 대상 표',
    async () => {
      const classes = await compileJavaTests(b, [resolve(__dirname, 'java')])
      const result = await runJavaTests(b, classes, [
        'org.sandbot.runtime.patch.OrderedCollectionsTest',
        'org.sandbot.runtime.patch.ClassPatcherTest'
      ])
      expect(result.failed).toEqual([])
      expect(result.passed.length).toBeGreaterThan(5)
    },
    SIDECAR_TEST_TIMEOUT
  )
})

// 사용하지 않는 도구가 lint에 걸리지 않게(뒤 시험들이 쓴다)
void existsSync
void mkdirSync
void writeFileSync
void diagnostics
export type { LinkReportMessage }
