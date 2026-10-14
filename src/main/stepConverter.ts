import { spawn, type ChildProcess } from 'child_process'
import { app, ipcMain, type WebContents } from 'electron'
import { createReadStream } from 'fs'
import { mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { basename, join } from 'path'
import converterVersion from '../../native/step-converter/version.json'
import {
  IPC,
  STEP_CONVERT_PHASES,
  type StepConvertErrorCode,
  type StepConvertPhase,
  type StepConvertProgress,
  type StepConvertResult
} from '../shared/ipc'
import { cacheKeyHash, isStepPath, TAG_PATTERN } from './meshCache'

// 네이티브 STEP 변환기(native/step-converter) 실행. 렌더러 WASM(occt-import-js)과 같은 C++ 코드를 네이티브로 빌드한
// 것이라 결과(노드·메시 순서)가 같고, WASM의 2 GB 메모리 한도가 없다. 변환기는 별도 프로세스라 메인 프로세스를 막지 않는다.
// 변환기가 없거나 이 PC에서 실행되지 않거나 다른 소스로 빌드됐으면 unavailable을 돌려주고, 렌더러가 WASM으로 대신 읽는다.

const EXECUTABLE =
  process.platform === 'win32' ? 'sandbot-step-converter.exe' : 'sandbot-step-converter'
// Windows가 메모리 부족으로 프로세스를 끝낼 때의 코드(STATUS_NO_MEMORY)
const WINDOWS_STATUS_NO_MEMORY = 0xc0000017
const DETAIL_LIMIT = 500
const PROBE_TIMEOUT_MS = 15_000
const OUTPUT_DIR = 'step-convert'

// 배포된 앱은 electron-builder.yml의 extraResources가 이 OS용 변환기만 resources/step-converter에 넣는다.
// 개발 중에는 resources/step-converter/<platform>-<arch>/를 쓰고, SANDBOT_STEP_CONVERTER로 다른 빌드를 가리킬 수 있다.
export function stepConverterPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'step-converter', EXECUTABLE)
  if (process.env.SANDBOT_STEP_CONVERTER) return process.env.SANDBOT_STEP_CONVERTER
  return join(
    app.getAppPath(),
    'resources',
    'step-converter',
    `${process.platform}-${process.arch}`,
    EXECUTABLE
  )
}

// OCCT가 읽는 환경 변수. 있으면 STEP 형상 보정·삼각분할·메모리 관리 방식이 바뀌어 WASM과 결과가 달라질 수 있다
// (OCCT·FreeCAD 등을 설치한 PC). MMGT_*는 변환기의 main보다 먼저 읽히므로 여기서 뺀다.
const OCCT_ENV = /^(CSF_|MMGT_|CASROOT|DRAW|OCCT)/i

export function converterEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !OCCT_ENV.test(name)))
}

// 변환기가 이 PC에서 실행되고, 렌더러의 occt-import-js와 같은 소스로 빌드됐는지 확인한다(--version).
// 실행 파일이 있어도 라이브러리(glibc 등)가 맞지 않거나 서명 문제로 실행되지 않을 수 있다.
export function probeConverter(command: string, prefixArgs: string[] = []): Promise<boolean> {
  return new Promise((resolve) => {
    let output = ''
    let child: ChildProcess
    try {
      child = spawn(command, [...prefixArgs, '--version'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: converterEnv(process.env),
        windowsHide: true
      })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), PROBE_TIMEOUT_MS)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (output.length < 4096) output += chunk
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve(false)
      try {
        const identity = JSON.parse(output) as Record<string, unknown>
        resolve(
          identity.format === converterVersion.format &&
            identity.occtImportJs === converterVersion.occtImportJs.commit &&
            identity.occt === converterVersion.occt.commit
        )
      } catch {
        resolve(false)
      }
    })
  })
}

let availability: Promise<boolean> | null = null

// 앱을 실행하는 동안 한 번만 확인한다
export function isConverterAvailable(): Promise<boolean> {
  availability ??= probeConverter(stepConverterPath())
  return availability
}

export type ConverterExit = {
  // 종료 코드. 신호로 끝났으면 null.
  code: number | null
  signal: NodeJS.Signals | null
  // 실행하지 못한 이유(ENOENT 등)
  spawnError: NodeJS.ErrnoException | null
  cancelled: boolean
  // 변환기가 끝나기 직전에 쓰는 "result <상태>" 줄. 없으면 비정상 종료다.
  result: string | null
  // 지나간 진행 단계
  phases: StepConvertPhase[]
  // OCCT가 예외로 건너뛴 STEP 엔티티 수("warning untranslated <n>")
  untranslated: number
  // 변환기가 stderr에 쓴 "error ..." 줄
  errors: string[]
}

// 종료 상태를 렌더러에 보낼 실패 이유로 바꾼다. 성공이면 null.
export function exitFailure(
  exit: ConverterExit,
  platform: NodeJS.Platform = process.platform
): { code: StepConvertErrorCode; detail: string } | null {
  const detail = exit.errors.join('; ').slice(0, DETAIL_LIMIT)
  if (exit.cancelled) return { code: 'cancelled', detail: '' }
  if (exit.spawnError) {
    const reason = String(exit.spawnError.code ?? exit.spawnError.message)
    // 실행 파일이 없거나 실행할 수 없으면 WASM으로 대신 읽는다
    const missing = ['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC', 'EBADARCH'].includes(reason)
    return { code: missing ? 'unavailable' : 'failed', detail: reason }
  }
  // 변환기가 직접 알린 결과가 기준이다(종료 코드는 OS·런타임이 쓰는 값과 겹칠 수 있다)
  if (exit.result === 'ok') return exit.code === 0 ? null : { code: 'failed', detail }
  if (exit.result === 'readFailed') return { code: 'readFailed', detail }
  if (exit.result === 'outOfMemory') return { code: 'outOfMemory', detail }
  if (exit.result !== null) return { code: 'failed', detail }
  // 결과 줄 없이 끝났다(비정상 종료)
  if (platform === 'win32' && exit.code === WINDOWS_STATUS_NO_MEMORY)
    return { code: 'outOfMemory', detail }
  // Linux의 메모리 부족 처리기(OOM killer)는 SIGKILL로 끝낸다. macOS는 서명 문제에도 SIGKILL을 보내므로
  // Linux에서, 실제로 변환을 시작한 뒤에 받은 SIGKILL만 메모리 부족으로 본다.
  const working = exit.phases.includes('transfer') || exit.phases.includes('mesh')
  if (platform === 'linux' && exit.signal === 'SIGKILL' && working)
    return { code: 'outOfMemory', detail: detail || 'SIGKILL' }
  return { code: 'failed', detail: detail || `exit ${exit.code ?? exit.signal}` }
}

function isPhase(value: string): value is StepConvertPhase {
  return (STEP_CONVERT_PHASES as readonly string[]).includes(value)
}

export type ConverterRun = {
  // 실행을 멈춘다(취소). 이미 끝났으면 아무 일도 하지 않는다.
  cancel: () => void
  done: Promise<ConverterExit>
}

// 진행 알림: 단계와 그 단계 안의 진행률(0~1, 모르면 null)
export type ConverterProgress = (phase: StepConvertPhase, fraction: number | null) => void

// 변환기 프로세스를 실행한다. STEP 내용(input)은 표준 입력으로 흘려보낸다(메모리에 다 올리지 않음).
// command 앞에 붙일 인자(prefixArgs)는 테스트에서 가짜 변환기를 node로 돌릴 때 쓴다.
export function runConverter(
  command: string,
  input: NodeJS.ReadableStream & { destroy: () => void },
  output: string,
  onProgress: ConverterProgress,
  prefixArgs: string[] = []
): ConverterRun {
  let child: ChildProcess | null = null
  let cancelled = false
  let finished = false
  let result: string | null = null
  let untranslated = 0
  const phases: StepConvertPhase[] = []
  const errors: string[] = []

  const done = new Promise<ConverterExit>((resolve) => {
    const finish = (exit: Pick<ConverterExit, 'code' | 'signal' | 'spawnError'>): void => {
      if (finished) return
      finished = true
      input.destroy()
      resolve({ ...exit, cancelled, result, phases, untranslated, errors })
    }
    let started: ChildProcess
    try {
      started = spawn(command, [...prefixArgs, '-', output], {
        stdio: ['pipe', 'ignore', 'pipe'],
        env: converterEnv(process.env),
        windowsHide: true
      })
    } catch (error) {
      finish({ code: null, signal: null, spawnError: error as NodeJS.ErrnoException })
      return
    }
    child = started
    let spawnError: NodeJS.ErrnoException | null = null
    started.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = error
      // 실행하지 못했으면(pid 없음) 'close'가 오지 않을 수 있다
      if (started.pid === undefined) finish({ code: null, signal: null, spawnError })
    })
    started.on('close', (code, signal) => finish({ code, signal, spawnError }))
    // 변환기가 다 읽기 전에 끝나면(취소, 오류) 쓰기가 EPIPE로 실패한다. 결과는 결과 줄과 종료 상태로 판단한다.
    started.stdin?.on('error', () => input.destroy())
    input.on('error', () => started.stdin?.destroy())
    if (started.stdin) input.pipe(started.stdin)
    let pending = ''
    started.stderr?.setEncoding('utf8')
    started.stderr?.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const space = line.indexOf(' ')
        const kind = space < 0 ? line : line.slice(0, space)
        const value = space < 0 ? '' : line.slice(space + 1)
        if (kind === 'phase' && isPhase(value)) {
          phases.push(value)
          onProgress(value, null)
        } else if (kind === 'progress') {
          const fraction = Number(value)
          const phase = phases[phases.length - 1]
          if (phase && Number.isFinite(fraction))
            onProgress(phase, Math.min(1, Math.max(0, fraction)))
        } else if (kind === 'warning') {
          const [what, count] = value.split(' ')
          if (what === 'untranslated' && Number.isSafeInteger(Number(count)))
            untranslated = Number(count)
        } else if (kind === 'result') {
          result = value.split(' ')[0]
        } else if (kind === 'error' && errors.length < 20) {
          errors.push(value)
        }
      }
    })
  })

  return {
    cancel: () => {
      if (finished || cancelled) return
      cancelled = true
      // Windows에서는 TerminateProcess로 바로 끝난다
      child?.kill('SIGKILL')
    },
    done
  }
}

// STEP 하나를 변환한다. 파일을 한 번만 읽어 그 내용으로 캐시 키를 만들면서 변환기에 넘긴다(두 번 읽는 사이에 파일이
// 바뀌어 다른 내용의 결과가 그 키로 캐시되는 일이 없게). 결과는 outputRoot 아래 임시 폴더에 쓰고 읽은 뒤 지운다.
export async function convertStepFile(
  command: string,
  path: string,
  tag: string,
  outputRoot: string,
  onProgress: ConverterProgress,
  onStart: (run: ConverterRun) => void,
  prefixArgs: string[] = []
): Promise<StepConvertResult> {
  let dir: string | null = null
  try {
    await mkdir(outputRoot, { recursive: true })
    dir = await mkdtemp(join(outputRoot, 'sandbot-step-'))
    const output = join(dir, 'result.bin')
    const hash = cacheKeyHash(basename(path), tag)
    let readAll = false
    const input = createReadStream(path)
    input.on('data', (chunk) => hash.update(chunk as Buffer))
    input.on('end', () => {
      readAll = true
    })
    const run = runConverter(command, input, output, onProgress, prefixArgs)
    onStart(run)
    const exit = await run.done
    const failure = exitFailure(exit)
    if (failure) return { ok: false, ...failure }
    // 변환기가 입력을 끝까지 읽었어야 키가 결과와 맞다
    if (!readAll) return { ok: false, code: 'failed', detail: 'input not fully read' }
    const bytes = await readFile(output)
    return {
      ok: true,
      key: hash.digest('hex'),
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      untranslated: exit.untranslated
    }
  } catch (error) {
    return { ok: false, code: 'failed', detail: String(error).slice(0, DETAIL_LIMIT) }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/

// 변환 요청. 큰 STEP 하나에 메모리를 수 GB 쓰므로 한 번에 하나씩 실행하고, 나머지는 기다린다(queued).
// 창이 사라지거나 새로고침되거나 앱이 끝나면 그 창의 요청을 모두 멈춘다.
type Conversion = {
  owner: WebContents
  run: ConverterRun | null
  cancelled: boolean
  // 차례가 되면 실행을 시작한다
  start: () => void
}
const conversions = new Map<string, Conversion>()
const waiting: Conversion[] = []
let active: Conversion | null = null

function startNext(): void {
  while (!active && waiting.length > 0) {
    const next = waiting.shift()!
    if (next.cancelled) continue
    active = next
    next.start()
  }
}

function cancelConversion(conversion: Conversion): void {
  conversion.cancelled = true
  conversion.run?.cancel()
  // 기다리던 요청은 바로 끝낸다
  const index = waiting.indexOf(conversion)
  if (index >= 0) {
    waiting.splice(index, 1)
    conversion.start()
  }
}

function cancelOwnedBy(owner: WebContents): void {
  for (const conversion of conversions.values()) {
    if (conversion.owner === owner) cancelConversion(conversion)
  }
}

export function cancelAllConversions(): void {
  for (const conversion of conversions.values()) cancelConversion(conversion)
}

// 지난 실행이 비정상 종료로 남긴 출력 폴더를 지운다(앱 시작 때는 실행 중인 변환이 없다)
async function sweepOutputs(outputRoot: string): Promise<void> {
  await rm(outputRoot, { recursive: true, force: true }).catch(() => undefined)
}

export function registerStepConverterIpc(): void {
  const outputRoot = join(app.getPath('userData'), OUTPUT_DIR)
  void sweepOutputs(outputRoot)

  ipcMain.handle(IPC.hasStepConverter, () => isConverterAvailable())

  ipcMain.handle(
    IPC.convertStep,
    async (event, path: unknown, tag: unknown, requestId: unknown): Promise<StepConvertResult> => {
      if (typeof path !== 'string' || !isStepPath(path)) throw new Error('not a STEP file')
      if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) throw new Error('invalid cache tag')
      if (
        typeof requestId !== 'string' ||
        !REQUEST_ID.test(requestId) ||
        conversions.has(requestId)
      )
        throw new Error('invalid request id')
      if (!(await isConverterAvailable())) return { ok: false, code: 'unavailable', detail: '' }

      const owner = event.sender
      const send = (phase: StepConvertProgress, fraction: number | null = null): void => {
        if (!owner.isDestroyed()) owner.send(IPC.stepConvertProgress, requestId, phase, fraction)
      }
      // 창이 닫히거나 렌더러가 죽거나 새로고침되면 그 창의 변환을 멈춘다
      const stopOnGone = (): void => cancelOwnedBy(owner)
      const stopOnNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
        if (details.isMainFrame && !details.isSameDocument) cancelOwnedBy(owner)
      }
      owner.once('destroyed', stopOnGone)
      owner.once('render-process-gone', stopOnGone)
      owner.on('did-start-navigation', stopOnNavigate)

      let turn: () => void = () => {}
      const conversion: Conversion = {
        owner,
        run: null,
        cancelled: false,
        start: () => turn()
      }
      conversions.set(requestId, conversion)
      try {
        // 차례를 기다린다(취소되면 바로 깨운다)
        await new Promise<void>((resolve) => {
          turn = resolve
          waiting.push(conversion)
          if (active || waiting.length > 1) send('queued')
          startNext()
        })
        if (conversion.cancelled) return { ok: false, code: 'cancelled', detail: '' }
        return await convertStepFile(stepConverterPath(), path, tag, outputRoot, send, (run) => {
          conversion.run = run
          if (conversion.cancelled) run.cancel()
        })
      } finally {
        conversions.delete(requestId)
        if (active === conversion) active = null
        startNext()
        owner.removeListener('destroyed', stopOnGone)
        owner.removeListener('render-process-gone', stopOnGone)
        owner.removeListener('did-start-navigation', stopOnNavigate)
      }
    }
  )

  ipcMain.on(IPC.cancelStepConversion, (event, requestId: unknown) => {
    if (typeof requestId !== 'string') return
    const conversion = conversions.get(requestId)
    if (conversion && conversion.owner === event.sender) cancelConversion(conversion)
  })

  app.on('will-quit', cancelAllConversions)
}
