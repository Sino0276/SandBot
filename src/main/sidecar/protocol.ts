import type {
  CompileDiagnostic,
  DeviceValues,
  FinishReason,
  LinkWarning,
  LinkWarningKind,
  OpModePhase,
  SidecarMessage,
  SimErrorKind,
  StackFrame
} from '../../shared/sidecarProtocol'

// 사이드카 stdout(JSON 줄) 읽기. 사이드카는 우리가 빌드한 것이지만 팀 코드가 같은 JVM에서 돈다(System.out은
// 사이드카가 가로채지만, 네이티브 코드·JNI 등 예상하지 못한 출력이 섞일 수 있다). 그래서 모양을 모두 확인하고,
// 맞지 않으면 프로토콜 오류로 실행을 끝낸다(crashed). 줄 길이에도 한도를 둔다(끝없는 출력으로 메모리를 다 쓰지 않게).

// 한 줄 한도. 틱(장치 출력)·텔레메트리·오류 스택이 가장 큰데 보통 수 KB다.
export const MAX_LINE_CHARS = 4 * 1024 * 1024

export class ProtocolError extends Error {}

// 조각으로 오는 stdout을 줄로 나눈다. 끝의 '\r'(Windows)은 지운다.
export class LineSplitter {
  private pending = ''

  // 완성된 줄들. 한도를 넘는 줄이면 ProtocolError.
  push(chunk: string): string[] {
    const text = this.pending + chunk
    const lines = text.split('\n')
    this.pending = lines.pop() ?? ''
    if (this.pending.length > MAX_LINE_CHARS) throw new ProtocolError('line too long')
    const out: string[] = []
    for (const line of lines) {
      if (line.length > MAX_LINE_CHARS) throw new ProtocolError('line too long')
      out.push(line.endsWith('\r') ? line.slice(0, -1) : line)
    }
    return out
  }

  // 끝나지 않은 줄이 남았는지(프로세스가 줄 중간에 끝남)
  get hasPartial(): boolean {
    return this.pending.length > 0
  }
}

type Json = Record<string, unknown>

function fail(what: string): never {
  throw new ProtocolError(what)
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(data: Json, key: string): number {
  const value = data[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${String(data.type)}.${key}`)
  return value
}

function int(data: Json, key: string): number {
  const value = num(data, key)
  if (!Number.isSafeInteger(value)) fail(`${String(data.type)}.${key}`)
  return value
}

function str(data: Json, key: string): string {
  const value = data[key]
  if (typeof value !== 'string') fail(`${String(data.type)}.${key}`)
  return value
}

function strOrNull(data: Json, key: string): string | null {
  const value = data[key]
  if (value !== null && typeof value !== 'string') fail(`${String(data.type)}.${key}`)
  return value
}

function oneOf<T extends string>(data: Json, key: string, values: readonly T[]): T {
  const value = data[key]
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value))
    fail(`${String(data.type)}.${key}`)
  return value as T
}

function list<T>(data: Json, key: string, item: (value: unknown) => T): T[] {
  const value = data[key]
  if (!Array.isArray(value)) fail(`${String(data.type)}.${key}`)
  return value.map(item)
}

const PHASES: readonly OpModePhase[] = ['init', 'running', 'stopping']
const ERROR_KINDS: readonly SimErrorKind[] = [
  'exception',
  'unsupported',
  'thread',
  'stall',
  'stuckInStop',
  'load',
  'config',
  'internal'
]
const FINISH_REASONS: readonly FinishReason[] = [
  'stopped',
  'returned',
  'terminated',
  'exception',
  'compileFailed',
  'loadFailed',
  'stuck',
  'shutdown'
]

function diagnostic(value: unknown): CompileDiagnostic {
  if (!isObject(value)) fail('compiled.diagnostics')
  const data = { ...value, type: 'compiled.diagnostic' }
  return {
    kind: oneOf(data, 'kind', ['error', 'warning', 'note'] as const),
    file: strOrNull(data, 'file'),
    line: int(data, 'line'),
    column: int(data, 'column'),
    message: str(data, 'message'),
    code: str(data, 'code')
  }
}

const LINK_WARNING_KINDS: readonly LinkWarningKind[] = [
  'missingClass',
  'missingMember',
  'unsupported'
]

function linkWarning(value: unknown): LinkWarning {
  if (!isObject(value)) fail('linkReport.warnings')
  const data = { ...value, type: 'linkReport.warning' }
  return {
    jar: str(data, 'jar'),
    kind: oneOf(data, 'kind', LINK_WARNING_KINDS),
    from: str(data, 'from'),
    target: str(data, 'target')
  }
}

function frame(value: unknown): StackFrame {
  if (!isObject(value)) fail('error.stack')
  const data = { ...value, type: 'error.frame' }
  return {
    className: str(data, 'className'),
    method: str(data, 'method'),
    file: strOrNull(data, 'file'),
    line: int(data, 'line'),
    source: strOrNull(data, 'source')
  }
}

function deviceValues(value: unknown): DeviceValues {
  if (!isObject(value)) fail('tick.outputs')
  const out: DeviceValues = {}
  for (const [key, field] of Object.entries(value)) {
    if (
      field !== null &&
      typeof field !== 'boolean' &&
      typeof field !== 'string' &&
      !(typeof field === 'number' && Number.isFinite(field))
    )
      fail('tick.outputs')
    out[key] = field
  }
  return out
}

function outputs(data: Json): Record<string, DeviceValues> {
  const value = data.outputs
  if (!isObject(value)) fail('tick.outputs')
  const out: Record<string, DeviceValues> = {}
  for (const [name, values] of Object.entries(value)) out[name] = deviceValues(values)
  return out
}

function strings(value: unknown): string {
  if (typeof value !== 'string') fail('telemetry.frame')
  return value
}

// 한 줄 → 메시지. 모양이 틀리면 ProtocolError(무엇이 틀렸는지).
export function parseSidecarLine(line: string): SidecarMessage {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    fail('invalid JSON')
  }
  if (!isObject(value)) fail('not an object')
  const data = value
  switch (data.type) {
    case 'hello':
      return {
        type: 'hello',
        protocol: num(data, 'protocol'),
        runtime: str(data, 'runtime'),
        java: str(data, 'java')
      }
    case 'compiled':
      return {
        type: 'compiled',
        ok: typeof data.ok === 'boolean' ? data.ok : fail('compiled.ok'),
        diagnostics: list(data, 'diagnostics', diagnostic),
        millis: num(data, 'millis')
      }
    case 'state':
      return { type: 'state', tNanos: num(data, 'tNanos'), phase: oneOf(data, 'phase', PHASES) }
    case 'tick':
      return {
        type: 'tick',
        tick: int(data, 'tick'),
        tNanos: num(data, 'tNanos'),
        phase: oneOf(data, 'phase', PHASES),
        loops: num(data, 'loops'),
        outputs: outputs(data)
      }
    case 'telemetry': {
      const frameValue = data.frame
      if (
        !isObject(frameValue) ||
        !Array.isArray(frameValue.lines) ||
        !Array.isArray(frameValue.log)
      )
        fail('telemetry.frame')
      return {
        type: 'telemetry',
        tNanos: num(data, 'tNanos'),
        frame: {
          lines: frameValue.lines.map(strings),
          log: frameValue.log.map(strings),
          format: oneOf({ ...frameValue, type: 'telemetry.frame' }, 'format', [
            'classic',
            'monospace',
            'html'
          ] as const)
        }
      }
    }
    case 'log':
      return {
        type: 'log',
        tNanos: num(data, 'tNanos'),
        stream: oneOf(data, 'stream', ['out', 'err', 'robotLog'] as const),
        text: str(data, 'text')
      }
    case 'error':
      return {
        type: 'error',
        tNanos: num(data, 'tNanos'),
        kind: oneOf(data, 'kind', ERROR_KINDS),
        message: str(data, 'message'),
        exception: strOrNull(data, 'exception'),
        stack: list(data, 'stack', frame),
        thread: str(data, 'thread')
      }
    case 'linkReport':
      return { type: 'linkReport', warnings: list(data, 'warnings', linkWarning) }
    case 'finished':
      return {
        type: 'finished',
        tNanos: num(data, 'tNanos'),
        reason: oneOf(data, 'reason', FINISH_REASONS)
      }
    default:
      return fail(`unknown message type ${JSON.stringify(data.type)?.slice(0, 40)}`)
  }
}
