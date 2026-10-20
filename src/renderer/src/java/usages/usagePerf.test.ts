// 사용처 성능 측정(spec §10.3). 평소에는 건너뛰고 SANDBOT_PERF=1일 때만 돈다(pnpm test는 돌리지 않는다).
// 시드가 고정된 생성기로 os.tmpdir()에 TeamCode를 만들고(300개·3 MB, 5000개·20 MB), 진짜 목록(listJavaFiles)·
// 일괄 읽기(readJavaSources)·사실·맞추기를 사용처 조율(usageIndex)로 돌린다. 공유 실행기에서 흔들리는 벽시계는
// 단정하지 않고 출력만 한다. 단정하는 것은 세는 값이다: 한 번에 읽는 경로·바이트 한도, 파일마다 한 번 읽기, 파일 하나를
// 고치면 한 번 읽기, 이름 바꾸기는 읽지 않고 맞추기만, 키마다의 한도와 자르기 전 개수.
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_PATHS,
  MAX_USAGE_FILE_BYTES,
  type ReadJavaSourcesResult
} from '../../../../shared/ipc'
import { listJavaFiles, readJavaSources } from '../../../../main/teamCodeJava'
import { trustRoot } from '../../../../main/projectRoots'
import { useProjectStore } from '../../project/projectStore'
import { useSceneStore } from '../../scene/sceneStore'
import { buildJavaIndex, useJavaIndexStore } from '../javaIndex'
import {
  initUsageIndex,
  setUsageWorkerFactory,
  SYMBOLS_DEBOUNCE_MS,
  useUsageIndexStore,
  type UsageWorkerLike
} from '../usageIndex'
import { corpusScene, renamedCorpusScene } from './__fixtures__/corpusScene'
import { extractFacts } from './usageFacts'
import { resolveUsages } from './usageResolve'
import { MAX_HITS_PER_KEY, type FromWorker, type ToWorker } from './usageTypes'
import { createUsageWorkerState, handleMessage } from './usageWorkerCore'

const PERF = !!process.env.SANDBOT_PERF
const PKG = 'src/main/java/org/firstinspires/ftc/teamcode'
const LIFT_LEFT = 'd:liftMotor\nll'

// mulberry32
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// FTC 식 OpMode 하나(대략 bytes 바이트). 코드 사용처·찾기·같은 글자·다른 파일 상속이 섞여 있다.
function opMode(k: number, bytes: number, next: () => number): string {
  const head = [
    `package org.firstinspires.ftc.teamcode.gen${k % 40};`,
    '',
    'import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;',
    'import com.qualcomm.robotcore.hardware.DcMotorEx;',
    'import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;',
    '',
    `public class Op${k} extends LinearOpMode {`,
    '    protected RobotHardware robot;',
    '    private static final String LIFT = "liftLeft";',
    '',
    '    @Override',
    '    public void runOpMode() {',
    '        robot = new RobotHardware(hardwareMap);',
    '        DcMotorEx lift = hardwareMap.get(DcMotorEx.class, LIFT);',
    '        waitForStart();',
    '    }'
  ]
  const steps: string[] = []
  let size = head.join('\n').length
  for (let i = 0; size < bytes; i++) {
    const n = Math.floor(next() * 1000)
    const step = [
      '',
      `    void step${i}(double power) {`,
      `        robot.lift.liftLeft.setPower(power * ${n});`,
      '        robot.leftFront.setPower(-power);',
      `        telemetry.addData("liftLeft", robot.lift.liftLeft.getCurrentPosition() + ${n});`,
      `        if (gamepad1.a) robot.lift.claw.grip.setPosition(0.${n % 10});`,
      `        for (int j = 0; j < ${n % 7}; j++) power += RobotHardware.PAR_X_MM + j;`,
      `        DcMotorEx extra = hardwareMap.get(DcMotorEx.class, "motor${n % 13}");`,
      '    }'
    ].join('\n')
    steps.push(step)
    size += step.length
  }
  return [...head, ...steps, '}', ''].join('\n')
}

type Tree = { root: string; files: number; bytes: number; changed: string }

function writeTree(files: number, totalBytes: number, seed: number): Tree {
  const root = mkdtempSync(join(tmpdir(), 'sandbot-usage-perf-'))
  const next = random(seed)
  let bytes = 0
  for (let k = 0; k < files; k++) {
    const dir = join(root, 'TeamCode', PKG, `gen${k % 40}`)
    mkdirSync(dir, { recursive: true })
    // 크기는 평균 주변으로 흩는다
    const text = opMode(k, (totalBytes / files) * (0.5 + next()), next)
    writeFileSync(join(dir, `Op${k}.java`), text)
    bytes += text.length
  }
  // 256 KB를 넘는 파일 둘(읽지 않고 tooLarge)
  for (let k = 0; k < 2; k++) {
    const dir = join(root, 'TeamCode', PKG, 'big')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `Big${k}.java`),
      opMode(1_000_000 + k, MAX_USAGE_FILE_BYTES + 4096, next)
    )
  }
  return { root, files, bytes, changed: join(root, 'TeamCode', PKG, 'gen0', 'Op0.java') }
}

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > 600_000) throw new Error(`기다리다 멈춤: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

describe.skipIf(!PERF)('사용처 성능(SANDBOT_PERF=1)', () => {
  for (const [files, bytes] of [
    [300, 3_000_000],
    [5000, 20_000_000]
  ] as const) {
    it(`파일 ${files}개·${bytes / 1e6} MB`, async () => {
      const tree = writeTree(files, bytes, files)
      roots.push(tree.root)
      trustRoot(tree.root)

      // 읽기 호출마다 경로 수·돌려준 바이트를 센다
      const calls: {
        paths: number
        bytes: number
        ok: number
        tooLarge: number
        deferred: number
      }[] = []
      const read = async (root: string, paths: string[]): Promise<ReadJavaSourcesResult> => {
        const result = await readJavaSources(root, paths)
        if (result.ok) {
          let returned = 0
          const count = { ok: 0, tooLarge: 0, deferred: 0 }
          for (const file of result.files) {
            if (file.status === 'ok') {
              returned += Buffer.byteLength(file.text)
              count.ok++
            } else if (file.status === 'tooLarge') count.tooLarge++
            else if (file.status === 'deferred') count.deferred++
          }
          calls.push({ paths: paths.length, bytes: returned, ...count })
        }
        return result
      }
      vi.stubGlobal('window', { api: { readJavaSources: read } })

      // 같은 스레드의 워커(진짜 사실·맞추기). 사실 만들기와 맞추기 시간을 따로 잰다.
      const timing = { extract: 0, match: 0, matches: 0, fileMessages: 0 }
      const state = createUsageWorkerState({
        extractFacts: (text, intern) => {
          const start = performance.now()
          const facts = extractFacts(text, intern)
          timing.extract += performance.now() - start
          return facts
        },
        resolveUsages: (facts, symbols) => {
          const start = performance.now()
          const result = resolveUsages(facts, symbols)
          timing.match += performance.now() - start
          timing.matches++
          return result
        }
      })
      const worker: UsageWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage: (message: ToWorker) => {
          if (message.type === 'files') timing.fileMessages++
          queueMicrotask(() => {
            const reply: FromWorker = handleMessage(state, message)
            worker.onmessage?.({ data: reply })
          })
        },
        terminate: () => {}
      }
      setUsageWorkerFactory(() => worker)
      initUsageIndex()
      useSceneStore.setState({ objects: corpusScene() })

      // 처음 다 읽기
      const listStart = performance.now()
      const listing = await listJavaFiles(tree.root)
      const listMs = performance.now() - listStart
      const scanStart = performance.now()
      useProjectStore.setState({ root: tree.root, session: 1, busy: false })
      useJavaIndexStore.setState({
        status: 'ready',
        root: tree.root,
        files: buildJavaIndex(listing.files),
        truncated: listing.truncated,
        revision: 1
      })
      await waitFor(() => useUsageIndexStore.getState().status === 'ready', '처음 읽기')
      const scanMs = performance.now() - scanStart
      const firstCalls = [...calls]
      for (const call of firstCalls) {
        expect(call.paths).toBeLessThanOrEqual(MAX_SOURCE_PATHS)
        expect(call.bytes).toBeLessThanOrEqual(MAX_SOURCE_BATCH_BYTES)
      }
      // 목록의 파일마다 한 번(미뤄진 것은 다시 받아 한 번). 5000개 한도를 넘으면 목록이 뒤쪽 패키지(big)를 버린다.
      const listed = buildJavaIndex(listing.files)
      const big = listed.filter((file) => file.path.includes('/big/')).length
      expect(firstCalls.reduce((sum, call) => sum + call.ok, 0)).toBe(listed.length - big)
      expect(firstCalls.reduce((sum, call) => sum + call.tooLarge, 0)).toBe(big)
      const result = useUsageIndexStore.getState().result!
      expect(result.files.tooLarge).toHaveLength(big)
      expect(result.hits.get(LIFT_LEFT)!.length).toBeLessThanOrEqual(MAX_HITS_PER_KEY)
      expect(result.totals.get(LIFT_LEFT)!.field).toBeGreaterThan(MAX_HITS_PER_KEY)
      const extractMs = timing.extract
      const firstMatchMs = timing.match
      const heap = process.memoryUsage().heapUsed

      // 파일 하나를 고치면 그 파일만 읽는다
      calls.length = 0
      writeFileSync(tree.changed, opMode(0, 2000, random(1)))
      utimesSync(tree.changed, new Date(), new Date(Date.now() + 5000))
      const changedListing = await listJavaFiles(tree.root)
      const incrementalStart = performance.now()
      useJavaIndexStore.setState({ files: buildJavaIndex(changedListing.files), revision: 2 })
      await waitFor(
        () => calls.length > 0 && useUsageIndexStore.getState().status === 'ready',
        '바뀐 파일 읽기'
      )
      const incrementalMs = performance.now() - incrementalStart
      expect(calls.map((call) => call.paths)).toEqual([1])

      // 이름 바꾸기는 읽지 않고 맞추기만
      calls.length = 0
      const matchesBefore = timing.matches
      const matchMsBefore = timing.match
      useSceneStore.setState({ objects: renamedCorpusScene() })
      await new Promise((resolve) => setTimeout(resolve, SYMBOLS_DEBOUNCE_MS + 20))
      await waitFor(
        () => timing.matches > matchesBefore && useUsageIndexStore.getState().status === 'ready',
        '이름 바꾸기 맞추기'
      )
      expect(calls).toEqual([])
      expect(timing.matches - matchesBefore).toBe(1)
      expect(useUsageIndexStore.getState().result!.unresolved.get('g:lift')!.length).toBe(
        MAX_HITS_PER_KEY
      )
      const renameMs = timing.match - matchMsBefore

      console.log(
        [
          `사용처 성능: 파일 ${files}개, ${(tree.bytes / 1e6).toFixed(1)} MB`,
          `  목록 ${listMs.toFixed(0)} ms(${listed.length}개${listing.truncated ? ', 한도로 잘림' : ''}), 처음 읽기 ${scanMs.toFixed(0)} ms(읽기 호출 ${firstCalls.length}번)`,
          `  사실 만들기 ${extractMs.toFixed(0)} ms, 첫 맞추기 ${firstMatchMs.toFixed(0)} ms`,
          `  파일 하나 고친 뒤 ${incrementalMs.toFixed(0)} ms, 이름 바꾼 맞추기 ${renameMs.toFixed(0)} ms`,
          `  힙 ${(heap / 1e6).toFixed(0)} MB(참고)`
        ].join('\n')
      )
      vi.unstubAllGlobals()
      useProjectStore.setState({ root: null, session: 2, busy: false })
    }, 600_000)
  }
})
