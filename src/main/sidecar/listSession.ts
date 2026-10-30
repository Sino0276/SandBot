import {
  SIDECAR_PROTOCOL_VERSION,
  type CompileDiagnostic,
  type ErrorMessage,
  type FinishReason,
  type ListRequest,
  type RegisteredOpMode,
  type SidecarMessage
} from '../../shared/sidecarProtocol'
import type { ProcessExit, SidecarProcess } from './process'
import { LineSplitter, parseSidecarLine, ProtocolError } from './protocol'
import { systemClock, type HostClock } from './session'

// 등록기 OpMode 목록 실행 하나(호스트 쪽, sidecarProtocol ListRequest). 사이드카는 컴파일하고 등록기를 모두 부른 뒤
// registered → finished listed로 끝난다(컴파일 오류면 compiled ok false → finished compileFailed). 틱을 주고받지 않으므로
// 실행 세션(session.ts)의 페이스·일시 정지·STOP은 없고, 렌더러로 보내는 이벤트도 없다: 출력을 모아 프로세스가 끝나면 결과
// 하나로 돌려준다(작업 폴더를 지우기 전에 JVM이 끝났다는 것이 보장된다). 로그·링크 검사는 버린다(INIT이 다시 보인다).
// 사이드카는 등록기가 시계를 쓰지 않고 멈추면 stall로 스스로 끝내지만, 가상 시계만 쓰며 끝없이 도는 등록기는 끝나지 않으므로
// 호스트가 전체 시간(실제)을 재서 JVM을 끝낸다.

export type ListOutcome =
  // errors: 던진 등록기(error registrar)들. 그 등록기가 던지기 전에 한 등록은 opModes에 있다.
  | { kind: 'listed'; opModes: RegisteredOpMode[]; errors: ErrorMessage[] }
  | { kind: 'compileFailed'; diagnostics: CompileDiagnostic[] }
  // 목록을 얻지 못했다(등록기의 System.exit·다른 스레드·멈춤, 사이드카 오류, 시간 초과, 프로토콜 오류). detail은 영어.
  | { kind: 'failed'; detail: string }

export type ListTimeouts = {
  // JVM이 hello를 보내기까지
  helloMs: number
  // 요청을 보낸 뒤 finished까지(컴파일 포함)
  totalMs: number
  // finished 뒤 프로세스가 스스로 끝나기를 기다리는 시간
  exitAfterFinishedMs: number
}

export const DEFAULT_LIST_TIMEOUTS: ListTimeouts = {
  helloMs: 30_000,
  totalMs: 120_000,
  exitAfterFinishedMs: 2000
}

// 오류 메시지 없이 끝난 이유의 설명(영어 detail)
const REASON_TEXT: Partial<Record<FinishReason, string>> = {
  terminated: 'an @OpModeRegistrar method called System.exit',
  shutdown: 'the sidecar was shut down'
}
const DETAIL_LIMIT = 2000
const STDERR_TAIL_LINES = 30
// 결과에 담는 오류 수(등록기마다 하나라 보통 몇 개다)
const MAX_ERRORS = 100

function clip(text: string): string {
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text
}

export function runListSidecar(
  process: SidecarProcess,
  request: ListRequest,
  options: { clock?: HostClock; timeouts?: Partial<ListTimeouts> } = {}
): Promise<ListOutcome> {
  const clock = options.clock ?? systemClock
  const timeouts = { ...DEFAULT_LIST_TIMEOUTS, ...options.timeouts }
  const splitter = new LineSplitter()
  const errors: ErrorMessage[] = []
  const stderr: string[] = []
  let stderrPending = ''
  let helloSeen = false
  let compiled: { ok: boolean; diagnostics: CompileDiagnostic[] } | null = null
  let registered: RegisteredOpMode[] | null = null
  let finished: FinishReason | null = null
  let failure: string | null = null
  const timers: unknown[] = []

  const after = (ms: number, fn: () => void): void => {
    timers.push(clock.setTimeout(fn, ms))
  }
  // 이유를 남기고 JVM을 끝낸다(결과는 프로세스가 끝날 때 정한다)
  const abort = (reason: string): void => {
    if (failure !== null || finished !== null) return
    failure = reason
    process.kill()
  }

  const handle = (message: SidecarMessage): void => {
    if (!helloSeen && message.type !== 'hello') throw new ProtocolError('message before hello')
    switch (message.type) {
      case 'hello':
        if (helloSeen) throw new ProtocolError('second hello')
        helloSeen = true
        if (message.protocol !== SIDECAR_PROTOCOL_VERSION)
          throw new ProtocolError(
            `protocol ${message.protocol} (host speaks ${SIDECAR_PROTOCOL_VERSION})`
          )
        break
      case 'compiled':
        compiled = { ok: message.ok, diagnostics: message.diagnostics }
        break
      case 'error':
        if (errors.length < MAX_ERRORS) errors.push(message)
        break
      case 'registered':
        if (registered !== null) throw new ProtocolError('second registered')
        registered = message.opModes
        break
      case 'finished':
        finished = message.reason
        after(timeouts.exitAfterFinishedMs, () => process.kill())
        break
      case 'log':
      case 'linkReport':
        break
      default:
        // 목록에는 틱·상태·텔레메트리가 없다(틱을 보내면 답을 기다리며 멈춘다)
        throw new ProtocolError(`unexpected ${message.type} while listing`)
    }
  }

  const pushStderr = (line: string): void => {
    if (line.trim() === '') return
    stderr.push(line.slice(0, DETAIL_LIMIT))
    if (stderr.length > STDERR_TAIL_LINES) stderr.shift()
  }

  const outcome = (exit: ProcessExit): ListOutcome => {
    const withStderr = (head: string): string => clip([head, ...stderr].join('\n'))
    if (failure !== null) return { kind: 'failed', detail: withStderr(failure) }
    const errorText = errors.map((error) => error.message).join('\n')
    switch (finished) {
      case 'listed':
        if (registered === null) return { kind: 'failed', detail: 'no registered message' }
        return {
          kind: 'listed',
          opModes: registered,
          errors: errors.filter((error) => error.kind === 'registrar')
        }
      case 'compileFailed':
        // javac를 찾지 못한 것(compiled 없이 끝남)은 컴파일 오류가 아니다
        if (compiled !== null && !compiled.ok)
          return { kind: 'compileFailed', diagnostics: compiled.diagnostics }
        return { kind: 'failed', detail: clip(errorText || 'compileFailed') }
      case null: {
        const how = exit.code !== null ? `exit code ${exit.code}` : `signal ${exit.signal ?? '?'}`
        return {
          kind: 'failed',
          detail: withStderr(splitter.hasPartial ? `${how}; truncated output` : how)
        }
      }
      default:
        return { kind: 'failed', detail: clip(errorText || (REASON_TEXT[finished] ?? finished)) }
    }
  }

  return new Promise((resolve) => {
    process.onStdout((chunk) => {
      if (failure !== null || finished !== null) return
      try {
        for (const line of splitter.push(chunk)) {
          if (line.trim() === '') continue
          handle(parseSidecarLine(line))
          if (finished !== null) return
        }
      } catch (error) {
        abort(`protocol error: ${error instanceof ProtocolError ? error.message : String(error)}`)
      }
    })
    process.onStderr((chunk) => {
      const lines = (stderrPending + chunk).split(/\r?\n/)
      stderrPending = (lines.pop() ?? '').slice(-DETAIL_LIMIT)
      for (const line of lines) pushStderr(line)
    })
    process.onExit((exit) => {
      for (const timer of timers) clock.clearTimeout(timer)
      if (stderrPending) pushStderr(stderrPending)
      resolve(outcome(exit))
    })
    after(timeouts.helloMs, () => {
      if (!helloSeen) abort('no hello from the sidecar')
    })
    after(timeouts.totalMs, () =>
      abort(`listing did not finish in ${Math.round(timeouts.totalMs / 1000)} s`)
    )
    // 사이드카는 hello를 보낸 뒤 stdin에서 첫 메시지를 읽는다(먼저 보내도 쌓여 있다)
    process.send(request)
  })
}
