// 사이드카 센서 시험(명세 4c C6·C7): 진짜 사이드카(org.sandbot.runtime.Main)를 띄우고, 틱마다 센서 입력을 보내는 작은 호스트를
// 이 파일 안에 둔다(support.ts는 고치지 않는다). 칩 흉내(VL53L0X·APDS-9151)가 런타임의 틱 경계 입력 훅을 거쳐 측정 시각대로
// 잡은 값이 팀 코드(고치지 않은 SDK 샘플, 팀 코드 같은 시험 OpMode)에 닿는지 본다. JDK가 없으면 건너뛴다.
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureFtcSamples, FetchError } from '../../scripts/fetch-ftc-sdk.mjs'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type DeviceValues,
  type HostMessage,
  type RunRequest,
  type SidecarMessage
} from '../../src/shared/sidecarProtocol'
import { SIDECAR_TEST_TIMEOUT, sidecarBuild, testTempDir, type SidecarBuild } from './support'

const build = await sidecarBuild()

const SENSOR_OPMODES = resolve(__dirname, 'opmodes-sensors')

// configXml.ts가 만드는 모양의 구성: Control Hub I2C 버스 1에 거리 센서, 버스 2에 컬러 센서
const CONFIG_XML = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  '<Robot type="FirstInspires-FTC" name="Sensor Bot">',
  '    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">',
  '        <LynxModule name="Control Hub" port="173">',
  '            <REV_VL53L0X_RANGE_SENSOR name="sensor_distance" port="0" bus="1" />',
  '            <RevColorSensorV3 name="sensor_color" port="0" bus="2" />',
  '        </LynxModule>',
  '    </LynxUsbDevice>',
  '</Robot>',
  ''
].join('\n')

type Inputs = (tick: number, tNanos: number) => Record<string, DeviceValues>

type SensorRun = { messages: SidecarMessage[]; stderr: string }

// 작은 호스트: 틱마다 바로 답하고 그 틱의 입력을 싣는다. startTick에 START, stopTick에 STOP(없으면 OpMode가 끝날 때까지).
function runSensorSidecar(
  b: SidecarBuild,
  request: Partial<RunRequest>,
  inputs: Inputs,
  startTick = 3,
  stopTick: number | null = null
): Promise<SensorRun> {
  return new Promise((done, fail) => {
    const child = spawn(
      b.java,
      [
        '-Xss4m',
        '-Dfile.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        '-cp',
        [b.runtimeJar, b.sdkJar].join(delimiter),
        'org.sandbot.runtime.Main'
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const messages: SidecarMessage[] = []
    let stderr = ''
    let pending = ''
    let finished = false
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out\n${stderr}`))
    }, 120_000)
    const onLine = (line: string): void => {
      let message: SidecarMessage
      try {
        message = JSON.parse(line) as SidecarMessage
      } catch {
        return
      }
      messages.push(message)
      if (message.type === 'finished') finished = true
      if (finished || message.type !== 'tick') return
      const events: ('start' | 'stop')[] = []
      if (message.tick === startTick) events.push('start')
      if (message.tick === stopTick) events.push('stop')
      send({
        type: 'tickReply',
        tick: message.tick,
        events,
        gamepads: [null, null],
        inputs: inputs(message.tick, message.tNanos),
        configSet: []
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
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', fail)
    child.on('close', () => {
      clearTimeout(timer)
      if (pending) onLine(pending)
      done({ messages, stderr })
    })
    send({
      type: 'run',
      protocol: SIDECAR_PROTOCOL_VERSION,
      clock: 'virtual',
      tickNanos: DEFAULT_TICK_NANOS,
      sourceRoots: [SENSOR_OPMODES],
      opModeSource: join(
        SENSOR_OPMODES,
        'org',
        'firstinspires',
        'ftc',
        'teamcode',
        'SimColorProbe.java'
      ),
      opModeClass: 'org.firstinspires.ftc.teamcode.SimColorProbe',
      registeredName: null,
      registrars: [],
      firstFolder: testTempDir('first'),
      bootClasspath: [],
      compileClasspath: [b.sdkJar],
      libraryClasspath: [],
      configXml: null,
      timing: {},
      jitter: 0,
      seed: 0,
      startEpochMillis: 1_700_000_000_000,
      stallMillis: 5000,
      teamCalibrations: null,
      ...request
    })
  })
}

function writeConfig(): string {
  const path = join(testTempDir('sensors-config'), 'sandbot_SensorBot.xml')
  writeFileSync(path, CONFIG_XML)
  return path
}

function results(run: SensorRun): Record<string, string> {
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

function finishedReason(run: SensorRun): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

// 결정성 비교: 실행마다 달라지는 것(컴파일 시간, JVM 버전)을 뺀 메시지
function deterministic(run: SensorRun): string {
  return run.messages
    .filter((m) => m.type !== 'hello' && m.type !== 'compiled')
    .map((m) => JSON.stringify(m))
    .join('\n')
}

describe.skipIf(build === null)('사이드카 센서 칩', () => {
  const sidecar = build as SidecarBuild

  it(
    'C6: 고치지 않은 SensorREV2mDistance가 33 ms 측정 끝마다 호스트의 distance를 읽는다(범위 밖은 8190)',
    async (ctx) => {
      let samples: { dir: string; files: string[] }
      try {
        samples = await ensureFtcSamples({ log: () => {} })
      } catch (error) {
        // 받지 못하면(오프라인) 건너뛴다. 해시가 다른 것은 실패다.
        if (error instanceof FetchError && !/SHA-256/.test((error as Error).message)) {
          ctx.skip()
          return
        }
        throw error
      }
      const sample = samples.files.find((file) => file.endsWith('SensorREV2mDistance.java'))
      if (!sample) throw new Error('SensorREV2mDistance.java is not among the samples')
      // 샘플을 패키지 폴더에 그대로 복사한다(@Disabled는 런타임이 보지 않는다)
      const root = testTempDir('sensors-sample')
      const dir = join(
        root,
        'org',
        'firstinspires',
        'ftc',
        'robotcontroller',
        'external',
        'samples'
      )
      mkdirSync(dir, { recursive: true })
      const opModeSource = join(dir, 'SensorREV2mDistance.java')
      copyFileSync(sample, opModeSource)
      const configXml = writeConfig()
      // 0.5 m를 3 s(가상) 동안, 그 뒤 범위 밖(null)을 명시해 보낸다(입력은 합쳐지므로 키를 빼면 이전 값이 남는다)
      const switchNanos = 3_000_000_000
      const inputs: Inputs = (_tick, tNanos) => ({
        sensor_distance: { distance: tNanos < switchNanos ? 0.5 : null }
      })
      const request: Partial<RunRequest> = {
        sourceRoots: [root],
        opModeSource,
        opModeClass: 'org.firstinspires.ftc.robotcontroller.external.samples.SensorREV2mDistance',
        configXml
      }
      const run = await runSensorSidecar(sidecar, request, inputs, 3, 1200)
      const errors = run.messages.filter((m) => m.type === 'error')
      expect(errors, run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('stopped')
      const frames = run.messages.flatMap((m) => (m.type === 'telemetry' ? [m] : []))
      const ranges = frames.flatMap((m) => {
        const line = m.frame.lines.find((l) => / mm$/.test(l))
        return line ? [{ tNanos: m.tNanos, line }] : []
      })
      // DS 텔레메트리는 250 ms마다 보낸다(Telemetry.msTransmissionInterval)
      expect(ranges.length).toBeGreaterThan(20)
      // 입력을 바꾼 뒤 처음 끝나는 측정(경계 뒤 33 ms 안)까지는 500, 그 뒤는 8190
      const before = ranges.filter((r) => r.tNanos < switchNanos)
      const after = ranges.filter((r) => r.tNanos >= switchNanos + 100_000_000)
      expect(before.length).toBeGreaterThan(5)
      expect(after.length).toBeGreaterThan(5)
      for (const r of before) expect(r.line).toMatch(/range.*500\.0 mm$/)
      for (const r of after) expect(r.line).toMatch(/range.*8190\.0 mm$/)
      // 바뀌는 자리: 500 다음에 8190, 되돌아가지 않는다
      const values = ranges.map((r) => (/ 500\.0 mm$/.test(r.line) ? 500 : 8190))
      expect(values.indexOf(8190)).toBeGreaterThan(0)
      expect(values.slice(values.indexOf(8190)).every((v) => v === 8190)).toBe(true)
      const ids = frames.flatMap((m) => m.frame.lines.filter((l) => /^ID/.test(l)))
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) expect(id).toMatch(/ee$/)
      // 같은 입력이면 바이트 단위로 같은 메시지
      const again = await runSensorSidecar(sidecar, request, inputs, 3, 1200)
      expect(deterministic(again)).toBe(deterministic(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'C7: 팀 코드 같은 컬러 OpMode가 타일 1.5 cm 칩 값을 드라이버 값·정규화·alpha·getDistance로 본다',
    async () => {
      // 부록 A 타일(ρ 0.2, NIR 0.2) 1.5 cm: 칩 원래 값 309·331·213, PS 288
      const inputs: Inputs = () => ({
        sensor_color: { red: 309, green: 331, blue: 213, proximity: 288 }
      })
      const run = await runSensorSidecar(sidecar, { configXml: writeConfig() }, inputs)
      const errors = run.messages.filter((m) => m.type === 'error')
      expect(errors, run.stderr).toEqual([])
      expect(finishedReason(run)).toBe('returned')
      const r = results(run)
      // 드라이버: red = int(1.07 · 309) = 330, blue = int(1.55 · 213) = 330 (BroadcomColorSensorImpl.updateColors)
      expect(r.red).toBe('330')
      expect(r.green).toBe('331')
      expect(r.blue).toBe('330')
      expect(r.raw).toBe('288')
      // 정규화 = 값 · gain(2) / 65535
      expect(Number(r.nred)).toBeCloseTo(0.0101, 4)
      // alpha = 1 − 65535 / (avg² + 65535), avg = (330 + 331 + 330)/3
      expect(Math.abs(Number(r.alpha) - 0.625)).toBeLessThan(1e-3)
      // getDistance = ((288 − 26.98)/325.961)^(−0.75934) in = 3.007 cm(타일은 흰 카드보다 어두워 실제 1.5 cm의 약 2배)
      expect(Math.abs(Number(r.distanceCm) - 3.007)).toBeLessThan(0.01)
    },
    SIDECAR_TEST_TIMEOUT
  )
})
