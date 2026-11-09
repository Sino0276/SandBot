// 사이드카 비전 시험(명세 4d B1·B6·B9·B10·B13과 Java 단위 시험 B3–B5·B7·B8·B11·B12·B14–B16): 진짜 사이드카
// (org.sandbot.runtime.Main)를 띄우고, 틱마다 웹캠 입력(30 fps 격자의 원시 검출)을 보내는 작은 호스트를 이 파일 안에 둔다. 고치지 않은
// FTC 샘플(ConceptAprilTag·Easy·Localization·OptimizeExposure·MultiPortal)과 시험 OpMode(sidecar/tests/opmodes-vision)를 돌린다.
// 프레임은 부록 B 장면(빨강 관중석 묶음 34–37, C920 640×480)의 apriltag 3 좌표 꼭짓점(pnp-reference.json)이다. JDK가 없으면 건너뛴다.
import { spawn, execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { delimiter, dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureFtcSamples, FetchError, readZip } from '../../scripts/fetch-ftc-sdk.mjs'
import { sdkCameraPose } from '../../src/renderer/src/hardware/mounting'
import { CAMERA_MODELS, CAMERA_MODEL_IDS } from '../../src/shared/sim/cameraData'
import { clusterFieldPoses } from '../../src/shared/sim/seasons/tagPoses'
import { resolveSeason } from '../../src/shared/sim/seasons/seasons'
import {
  DEFAULT_TICK_NANOS,
  SIDECAR_PROTOCOL_VERSION,
  type DeviceValues,
  type HostMessage,
  type RunRequest,
  type SidecarMessage
} from '../../src/shared/sidecarProtocol'
import {
  compileJavaTests,
  repoRoot,
  runJavaTests,
  SIDECAR_TEST_TIMEOUT,
  sidecarBuild,
  sidecarReport,
  testTempDir,
  type SidecarBuild
} from './support'

const build = await sidecarBuild()

const VISION_OPMODES = resolve(__dirname, 'opmodes-vision')
const FIXTURE = join(repoRoot, 'sidecar', 'tests', 'fixtures', 'vision', 'pnp-reference.json')

type PnpCase = { name: string; image: number[] }
const pnpCases = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: PnpCase[] }).cases
// 부록 B 장면의 apriltag 3 좌표 꼭짓점(태그 34–37, 태그마다 4점)
const APPENDIX_CORNERS = pnpCases.find(
  (c) => c.name === 'appendixB apriltag cluster ITERATIVE'
)!.image

// 30 fps 정수 격자 g_k = floor(k·1e9/30)(spec-4d §1.4, src/shared/sim/vision.ts frameDue와 같은 규칙)
function grid(k: number): number {
  return Math.floor((k * 1e9) / 30)
}
function frameDue(prev: number | null, t: number): boolean {
  if (prev === null) return false
  let k = Math.floor((t * 30) / 1e9)
  while (grid(k + 1) <= t) k++
  while (k > 0 && grid(k) > t) k--
  return grid(k) > prev && grid(k) <= t
}

function tagsInput(ids: number[]): number[] {
  const out: number[] = []
  for (const id of ids) {
    const slot = id - 34
    out.push(id, ...APPENDIX_CORNERS.slice(slot * 8, slot * 8 + 8))
  }
  return out
}

type Webcam = { device: string; model: string | null; ids: (tNanos: number) => number[] }

type VisionRun = { messages: SidecarMessage[]; stderr: string }

// 작은 호스트: 틱마다 바로 답하고, 웹캠 출력이 streaming이면 30 fps 격자의 틱에 프레임을 싣는다(세계 대신)
function runVisionSidecar(
  b: SidecarBuild,
  request: Partial<RunRequest>,
  webcams: Webcam[],
  startTick: number | null = 3,
  stopTick: number | null = null
): Promise<VisionRun> {
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
    let prev: number | null = null
    const modelSent = new Set<string>()
    const send = (message: HostMessage): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdin.on('error', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`sidecar timed out\n${stderr}`))
    }, 240_000)
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
      const t = message.tNanos
      const inputs: Record<string, DeviceValues> = {}
      for (const cam of webcams) {
        const values: DeviceValues = {}
        if (cam.model !== null && !modelSent.has(cam.device)) {
          values.model = cam.model
          modelSent.add(cam.device)
        }
        const out = message.outputs[cam.device]
        if (out && out.streaming === true && frameDue(prev, t)) {
          values.frameNanos = t
          values.frameWidth = out.width as number
          values.frameHeight = out.height as number
          values.tags =
            out.aprilTag === true && out.family === 'TAG_36h11' ? tagsInput(cam.ids(t)) : []
        }
        if (Object.keys(values).length > 0) inputs[cam.device] = values
      }
      prev = t
      const events: ('start' | 'stop')[] = []
      if (message.tick === startTick) events.push('start')
      if (message.tick === stopTick) events.push('stop')
      send({
        type: 'tickReply',
        tick: message.tick,
        events,
        gamepads: [null, null],
        inputs,
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
      sourceRoots: [VISION_OPMODES],
      opModeSource: join(
        VISION_OPMODES,
        'org',
        'firstinspires',
        'ftc',
        'teamcode',
        'VisionSolverStop.java'
      ),
      opModeClass: 'org.firstinspires.ftc.teamcode.VisionSolverStop',
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

// configXml.ts가 만드는 모양의 구성: 웹캠 둘(시리얼이 있어야 구성에 들어간다)
const CONFIG_XML = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  '<Robot type="FirstInspires-FTC" name="Vision Bot">',
  '    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">',
  '        <LynxModule name="Control Hub" port="173">',
  '        </LynxModule>',
  '    </LynxUsbDevice>',
  '    <Webcam name="Webcam 1" serialNumber="SN1" />',
  '    <Webcam name="Webcam 2" serialNumber="SN2" />',
  '</Robot>',
  ''
].join('\n')

function writeConfig(): string {
  const path = join(testTempDir('vision-config'), 'sandbot_VisionBot.xml')
  writeFileSync(path, CONFIG_XML)
  return path
}

const ALL = (): number[] => [34, 35, 36, 37]
const WEBCAMS: Webcam[] = [
  { device: 'Webcam 1', model: 'logitechC920', ids: ALL },
  { device: 'Webcam 2', model: 'logitechC920', ids: () => [35, 36] }
]

function finishedReason(run: VisionRun): string | undefined {
  const last = run.messages[run.messages.length - 1]
  return last?.type === 'finished' ? last.reason : undefined
}

function deterministic(run: VisionRun): string {
  return run.messages
    .filter((m) => m.type !== 'hello' && m.type !== 'compiled')
    .map((m) => JSON.stringify(m))
    .join('\n')
}

function telemetryLines(run: VisionRun): string[][] {
  return run.messages.flatMap((m) => (m.type === 'telemetry' ? [m.frame.lines] : []))
}

function results(run: VisionRun): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of run.messages) {
    if (m.type !== 'log' || m.stream !== 'out' || !m.text.startsWith('RESULT ')) continue
    const r: Record<string, string> = {}
    for (const pair of m.text.slice('RESULT '.length).split(' ')) {
      const eq = pair.indexOf('=')
      if (eq > 0) r[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
    out.push(r)
  }
  return out
}

async function sampleRequest(name: string): Promise<Partial<RunRequest> | null> {
  let samples: { dir: string; files: string[] }
  try {
    samples = await ensureFtcSamples({ log: () => {} })
  } catch (error) {
    if (error instanceof FetchError && !/SHA-256/.test((error as Error).message)) return null
    throw error
  }
  const sample = samples.files.find((file) => file.endsWith(`${name}.java`))
  if (!sample) throw new Error(`${name}.java is not among the samples`)
  const root = testTempDir(`vision-${name}`)
  const dir = join(root, 'org', 'firstinspires', 'ftc', 'robotcontroller', 'external', 'samples')
  mkdirSync(dir, { recursive: true })
  const opModeSource = join(dir, `${name}.java`)
  copyFileSync(sample, opModeSource)
  return {
    sourceRoots: [root],
    opModeSource,
    opModeClass: `org.firstinspires.ftc.robotcontroller.external.samples.${name}`,
    configXml: writeConfig()
  }
}

function numbers(line: string): number[] {
  return (line.match(/-?\d+\.\d+|-?\d+/g) ?? []).map(Number)
}

describe.skipIf(build === null)('사이드카 비전', () => {
  const sidecar = build as SidecarBuild

  it('B1: OpenCV 원천(들여옴·stub·거름)·손 구현·자원 XML·NOTICE', () => {
    const report = sidecarReport(sidecar) as ReturnType<typeof sidecarReport> & {
      realExcluded: string[]
      opaqueTypes: string[]
    }
    const lifted = new Set(report.lifted)
    const hand = new Set(report.hand)
    for (const name of ['Point', 'Point3', 'Rect', 'Size', 'CvException'])
      expect(lifted.has(`org.opencv.core.${name}`), name).toBe(true)
    expect(report.stubs['org.opencv.core.Mat']).toMatch(/native/)
    expect(
      report.opaqueTypes.filter((t) => t.startsWith('org.opencv.') && t !== 'org.opencv.R')
    ).toEqual([])
    const all = [...report.lifted, ...Object.keys(report.stubs)]
    expect(
      all.filter((n) => n.startsWith('org.openftc.') || n.startsWith('org.opencv.osgi.'))
    ).toEqual([])
    expect(report.realExcluded).toEqual(['org/openftc/', 'org/opencv/osgi/'])
    for (const name of [
      'org.firstinspires.ftc.vision.VisionPortal',
      'org.firstinspires.ftc.vision.VisionPortalImpl',
      'org.firstinspires.ftc.vision.VisionProcessor',
      'org.firstinspires.ftc.vision.VisionProcessorInternal',
      'org.firstinspires.ftc.vision.apriltag.AprilTagProcessor',
      'org.firstinspires.ftc.vision.apriltag.AprilTagProcessorImpl',
      'org.firstinspires.ftc.robotcore.internal.ftdi.VendorAndProductIds'
    ])
      expect(hand.has(name), name).toBe(true)
    for (const name of [
      'org.firstinspires.ftc.robotcore.external.hardware.camera.CameraCompatibilityManager',
      'org.firstinspires.ftc.robotcore.internal.camera.CameraCompatibilityManagerImpl'
    ])
      expect(lifted.has(name), name).toBe(true)
    // 내장 보정 XML이 자원으로 그대로(sha256 고정, spec-4d §1.13)
    const xml = readZip(readFileSync(sidecar.sdkJar)).read(
      'org/sandbot/sdk/devices/builtinwebcamcalibrations.xml'
    )
    expect(createHash('sha256').update(xml).digest('hex')).toBe(
      '43febb0ee76f4336242cc26ea79ca2fdb52943ff78bd4333e156b3bade1c5106'
    )
    // DEFAULT_VIEW_CONTAINER_ID는 ConstantValue가 없다(실제와 같음, 상수식이면 case 라벨이 SandBot에서만 컴파일된다)
    const javap = join(dirname(sidecar.javac), process.platform === 'win32' ? 'javap.exe' : 'javap')
    const out = execFileSync(
      javap,
      ['-v', '-cp', sidecar.sdkJar, 'org.firstinspires.ftc.vision.VisionPortal'],
      { encoding: 'utf8' }
    )
    const field = out.slice(out.indexOf('DEFAULT_VIEW_CONTAINER_ID'))
    expect(field.slice(0, field.indexOf('\n\n'))).not.toMatch(/ConstantValue/)
    const notice = readFileSync(join(sidecar.dir, 'NOTICE.txt'), 'utf8')
    expect(notice).toContain('opencv-repackaged-bundled-dylibs:4.10.0-A')
    expect(notice).toContain('Apache License, Version 2.0')
    expect(notice).toContain('ippe.cpp')
    expect(notice).toContain('Toby Collins')
  })

  it('B13: SandbotCameraModels의 id·vid·pid가 TS CAMERA_MODELS와 같다', () => {
    const source = readFileSync(
      join(
        repoRoot,
        'sidecar',
        'sdk',
        'org',
        'sandbot',
        'sdk',
        'devices',
        'SandbotCameraModels.java'
      ),
      'utf8'
    )
    const rows = [...source.matchAll(/model\("(\w+)", (0x[0-9A-Fa-f]+), (0x[0-9A-Fa-f]+)\)/g)].map(
      (m) => [m[1], Number(m[2]), Number(m[3])]
    )
    expect(rows).toEqual(
      CAMERA_MODEL_IDS.map((id) => [id, CAMERA_MODELS[id].vid, CAMERA_MODELS[id].pid])
    )
  })

  it(
    'Java 단위 시험: PnP 대 OpenCV 기준값, 포털 상태 기계·처리 시간·FPS, 렌즈 값 대체, 묶음·값, 정지, 팀 보정',
    async () => {
      const classes = await compileJavaTests(sidecar, ['sidecar/tests/java/org/sandbot/sdk/vision'])
      const result = await runJavaTests(sidecar, classes, [
        'org.sandbot.sdk.vision.PnpTest',
        'org.sandbot.sdk.vision.VisionPortalTest',
        'org.sandbot.sdk.vision.AprilTagTest'
      ])
      expect(result.failed.map((f) => `${f.id}\n${f.detail}`)).toEqual([])
      expect(result.passed.length).toBeGreaterThanOrEqual(15)
      const perf = /RESULT perfIterative16Ms=(\S+) perfEpnp4Ms=(\S+)/.exec(result.output)
      expect(perf).not.toBeNull()
      // B16: 기록(1 ms 목표)
      console.log(`PnP median: ITERATIVE 16 points ${perf![1]} ms, EPNP 4 points ${perf![2]} ms`)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'B10: 고치지 않은 ConceptAprilTag가 묶음 줄·Percent·XYZ·PRY·RBE를 보이고 두 번 바이트 같다',
    async (ctx) => {
      const request = await sampleRequest('ConceptAprilTag')
      if (!request) {
        ctx.skip()
        return
      }
      const run = await runVisionSidecar(sidecar, request, WEBCAMS, 3, 800)
      expect(
        run.messages.filter((m) => m.type === 'error'),
        run.stderr
      ).toEqual([])
      expect(finishedReason(run)).toBe('stopped')
      const frames = telemetryLines(run)
      const withCluster = frames.filter((lines) =>
        lines.some((l) => l.includes('==== Tag Cluster (RED AUDIENCE)'))
      )
      expect(withCluster.length).toBeGreaterThan(5)
      const lines = withCluster[withCluster.length - 1]
      expect(lines).toContain('# AprilTags Detected : 1')
      expect(lines.some((l) => l.includes('Percent tags found: 100'))).toBe(true)
      // 부록 B 참값(묶음 틀 → 카메라, OpenCV): t = (−0.11346, −7.78784, 52.08915) in → ftcPose x = −0.11, y = 52.09, z = 7.79
      // (+0.5 px apriltag 3 치우침은 약 0.04 in)
      const xyz = numbers(lines.find((l) => l.startsWith('XYZ'))!)
      expect(Math.abs(xyz[0] - -0.11)).toBeLessThan(0.15)
      expect(Math.abs(xyz[1] - 52.09)).toBeLessThan(0.15)
      expect(Math.abs(xyz[2] - 7.79)).toBeLessThan(0.15)
      const rbe = numbers(lines.find((l) => l.startsWith('RBE'))!)
      expect(Math.abs(rbe[0] - Math.hypot(xyz[0], xyz[1]))).toBeLessThan(0.15)
      expect(lines.some((l) => l.startsWith('PRY'))).toBe(true)
      // aprilTagNoFieldPose 안내가 묶음당 한 번
      const notices = run.messages.flatMap((m) => (m.type === 'notice' ? [m] : []))
      expect(notices.filter((n) => n.code === 'aprilTagNoFieldPose')).toEqual([
        expect.objectContaining({ params: { cluster: 'RED AUDIENCE' } })
      ])
      const again = await runVisionSidecar(sidecar, request, WEBCAMS, 3, 800)
      expect(deterministic(again)).toBe(deterministic(run))
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'B10: Easy·Localization·OptimizeExposure·MultiPortal 샘플이 고치지 않고 돈다',
    async (ctx) => {
      const easy = await sampleRequest('ConceptAprilTagEasy')
      if (!easy) {
        ctx.skip()
        return
      }
      const easyRun = await runVisionSidecar(sidecar, easy, WEBCAMS, 3, 700)
      expect(
        easyRun.messages.filter((m) => m.type === 'error'),
        easyRun.stderr
      ).toEqual([])
      expect(
        telemetryLines(easyRun).some((lines) =>
          lines.some((l) => l.includes('==== Tag Cluster (RED AUDIENCE)'))
        )
      ).toBe(true)

      const local = (await sampleRequest('ConceptAprilTagLocalization'))!
      const localRun = await runVisionSidecar(sidecar, local, WEBCAMS, 3, 700)
      expect(
        localRun.messages.filter((m) => m.type === 'error'),
        localRun.stderr
      ).toEqual([])
      expect(
        telemetryLines(localRun).some((lines) => lines.includes('# AprilTags Detected : 1'))
      ).toBe(true)

      const exposure = (await sampleRequest('ConceptAprilTagOptimizeExposure'))!
      const exposureRun = await runVisionSidecar(sidecar, exposure, WEBCAMS, 600, 900)
      expect(
        exposureRun.messages.filter((m) => m.type === 'error'),
        exposureRun.stderr
      ).toEqual([])
      const exposureLines = telemetryLines(exposureRun).flat()
      // getMinExposure(MILLISECONDS) = 0(버림) + 1, 최대 204 ms, 게인 0–255(최대로 둔다)
      expect(exposureLines).toContain('Exposure : 1  (1 - 204)')
      expect(exposureLines).toContain('Gain : 255  (0 - 255)')
      const lastTick = [...exposureRun.messages].reverse().find((m) => m.type === 'tick')
      expect(lastTick?.type === 'tick' && lastTick.outputs['Webcam 1']).toMatchObject({
        exposureMs: 1,
        gain: 255
      })

      const multi = (await sampleRequest('ConceptAprilTagMultiPortal'))!
      const multiRun = await runVisionSidecar(sidecar, multi, WEBCAMS, 3, 700)
      expect(
        multiRun.messages.filter((m) => m.type === 'error'),
        multiRun.stderr
      ).toEqual([])
      const multiLines = telemetryLines(multiRun).flat()
      expect(multiLines).toContain('Number of tags in Camera 1 : 1')
      expect(multiLines).toContain('Number of tags in Camera 2 : 1')
      const multiTick = [...multiRun.messages].reverse().find((m) => m.type === 'tick')
      expect(multiTick?.type === 'tick' && multiTick.outputs['Webcam 2']?.state).toBe('STREAMING')
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    'B6: APRILTAG_BUILTIN + 묶음은 결과 시각에 visionSolverStop → 오류(CvException) → STOP → finished exception(INIT 중에도)',
    async () => {
      for (const startTick of [3, null]) {
        const run = await runVisionSidecar(
          sidecar,
          { configXml: writeConfig() },
          WEBCAMS,
          startTick,
          null
        )
        const index = (pred: (m: SidecarMessage) => boolean): number => run.messages.findIndex(pred)
        const notice = index((m) => m.type === 'notice' && m.code === 'visionSolverStop')
        const error = index((m) => m.type === 'error')
        expect(notice, run.stderr).toBeGreaterThanOrEqual(0)
        expect(error).toBe(notice + 1)
        const e = run.messages[error]
        expect(e).toMatchObject({
          kind: 'exception',
          exception: 'org.opencv.core.CvException',
          thread: 'VisionPortal',
          stack: [],
          message:
            "cv::Exception: OpenCV(4.10.0) /home/ci/opencv/modules/calib3d/src/solvepnp.cpp:1044: error: (-5:Bad argument) The flags argument must be one of SOLVEPNP_ITERATIVE, SOLVEPNP_P3P, SOLVEPNP_EPNP, SOLVEPNP_DLS, SOLVEPNP_UPNP, SOLVEPNP_AP3P, SOLVEPNP_IPPE, SOLVEPNP_IPPE_SQUARE or SOLVEPNP_SQPNP in function 'solvePnPGeneric'\n"
        })
        expect(finishedReason(run)).toBe('exception')
        expect(run.messages.filter((m) => m.type === 'error')).toHaveLength(1)
      }
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '필드 자세 라이브러리(BIOBUZZ 없는 Builder + clusterFieldPoses, INCH) + sdkCameraPose → robotPose가 로봇 필드 자세',
    async () => {
      // 부록 B 장면: 카메라(렌즈) 필드 (1.05, −0.30, 0.30) m, 요 −3.108348, 위로 0.931290 rad. 로봇 중심을 렌즈 바로 아래(같은 요)에
      // 두면 렌즈의 로봇 좌표는 (0, 0, 0.30), 조준은 요 0·높이 0.931290
      const yaw = -3.108348
      const pitch = 0.93129
      const pose = sdkCameraPose({ x: 0, y: 0, z: 0.3 }, { yaw: 0, pitch, roll: 0 })
      const clusters = clusterFieldPoses(resolveSeason('biobuzz'), [false, false])
      const f = (v: number): string => `${v}f`
      const clusterLines = clusters
        .map((c) => {
          const members = [-6.5, -2.75, 2.75, 6.5]
            .map(
              (x, k) =>
                `        m.add(new AprilTagClusterMemberMetadata(${c.firstId + k}, new VectorF(${f(x)}, 7.1874f, -5.622f), 3.25));`
            )
            .join('\n')
          const p = c.position
          const q = c.quaternion
          return [
            '        m = new ArrayList<>();',
            members,
            `        builder.addCluster(new AprilTagClusterMetadata(m, "${c.name}", "${c.name}", new VectorF(${f(p.x / 0.0254)}, ${f(p.y / 0.0254)}, ${f(p.z / 0.0254)}), DistanceUnit.INCH, new Quaternion(${f(q[0])}, ${f(q[1])}, ${f(q[2])}, ${f(q[3])}, 0)));`
          ].join('\n')
        })
        .join('\n')
      const source = [
        'package org.firstinspires.ftc.teamcode;',
        '',
        'import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;',
        'import com.qualcomm.robotcore.eventloop.opmode.TeleOp;',
        'import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;',
        'import org.firstinspires.ftc.robotcore.external.matrices.VectorF;',
        'import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;',
        'import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;',
        'import org.firstinspires.ftc.robotcore.external.navigation.Position;',
        'import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;',
        'import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;',
        'import org.firstinspires.ftc.vision.VisionPortal;',
        'import org.firstinspires.ftc.vision.apriltag.*;',
        'import java.util.ArrayList;',
        'import java.util.Locale;',
        '',
        '// 시험이 만든 소스(vision.test.ts): BIOBUZZ 묶음을 필드 자세로 둔 라이브러리',
        '@TeleOp(name = "VisionFieldPoseLibrary")',
        'public class VisionFieldPoseLibrary extends LinearOpMode {',
        '    @Override public void runOpMode() {',
        '        AprilTagLibrary.Builder builder = new AprilTagLibrary.Builder();',
        '        ArrayList<AprilTagClusterMemberMetadata> m;',
        clusterLines,
        '        AprilTagProcessor tag = new AprilTagProcessor.Builder()',
        '            .setTagLibrary(builder.build())',
        `            .setCameraPose(new Position(DistanceUnit.INCH, ${pose.x}, ${pose.y}, ${pose.z}, 0),`,
        `                new YawPitchRollAngles(AngleUnit.DEGREES, ${pose.yaw}, ${pose.pitch}, ${pose.roll}, 0))`,
        '            .build();',
        '        VisionPortal portal = new VisionPortal.Builder()',
        '            .setCamera(hardwareMap.get(WebcamName.class, "Webcam 1")).addProcessor(tag).build();',
        '        waitForStart();',
        '        while (opModeIsActive()) {',
        '            for (AprilTagDetection d : tag.getDetections()) {',
        '                if (d.robotPose == null) continue;',
        '                System.out.println(String.format(Locale.ROOT, "RESULT x=%.4f y=%.4f z=%.4f yaw=%.4f t=%d",',
        '                    d.robotPose.getPosition().x, d.robotPose.getPosition().y, d.robotPose.getPosition().z,',
        '                    d.robotPose.getOrientation().getYaw(AngleUnit.DEGREES), d.frameAcquisitionNanoTime));',
        '            }',
        '            sleep(100);',
        '        }',
        '    }',
        '}',
        ''
      ].join('\n')
      const root = testTempDir('vision-fieldpose')
      const dir = join(root, 'org', 'firstinspires', 'ftc', 'teamcode')
      mkdirSync(dir, { recursive: true })
      const opModeSource = join(dir, 'VisionFieldPoseLibrary.java')
      writeFileSync(opModeSource, source)
      const run = await runVisionSidecar(
        sidecar,
        {
          sourceRoots: [root],
          opModeSource,
          opModeClass: 'org.firstinspires.ftc.teamcode.VisionFieldPoseLibrary',
          configXml: writeConfig()
        },
        WEBCAMS,
        3,
        700
      )
      expect(
        run.messages.filter((m) => m.type === 'error'),
        run.stderr
      ).toEqual([])
      const r = results(run)
      expect(r.length).toBeGreaterThan(5)
      const last = r[r.length - 1]
      // 위치 = SandBot 필드 (x, y)(in), z ≈ 0, 요 = SandBot 요 − 90°(감음). +0.5 px 치우침(약 0.04 in·0.025°)과 CAD 반올림을 넉넉히
      expect(Math.abs(Number(last.x) - 1.05 / 0.0254)).toBeLessThan(0.2)
      expect(Math.abs(Number(last.y) - -0.3 / 0.0254)).toBeLessThan(0.2)
      expect(Math.abs(Number(last.z))).toBeLessThan(0.2)
      const expectedYaw = (((yaw * 180) / Math.PI - 90 + 540) % 360) - 180
      const dyaw = ((Number(last.yaw) - expectedYaw + 540) % 360) - 180
      expect(Math.abs(dyaw)).toBeLessThan(0.2)
      // acquisitionTime = 프레임 시각(틱 경계, 30 fps 격자)
      expect(Number(last.t) % DEFAULT_TICK_NANOS).toBe(0)
      // 필드 자세가 있는 라이브러리라 aprilTagNoFieldPose가 없다
      expect(
        run.messages.some((m) => m.type === 'notice' && m.code === 'aprilTagNoFieldPose')
      ).toBe(false)
    },
    SIDECAR_TEST_TIMEOUT
  )
})
