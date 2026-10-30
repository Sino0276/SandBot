import {
  MAX_DASH_CONFIG_DEPTH,
  MAX_DASH_CONFIG_NODES,
  MAX_DASH_DATA,
  MAX_DASH_LOG_LINES,
  MAX_DASH_OPS,
  MAX_DASH_POINTS,
  MAX_DASH_TEXT,
  type DashConfigChild,
  type DashConfigNode,
  type DashFieldSource,
  type DashOp,
  type DashOpType,
  type DashVariableType
} from '../../shared/dashboard'
import type {
  CompileDiagnostic,
  DeviceValues,
  FinishReason,
  LinkWarning,
  LinkWarningKind,
  OpModePhase,
  SidecarMessage,
  SidecarNoticeCode,
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

// ---- FTC Dashboard(dash·dashConfig, src/shared/dashboard.ts의 한도)와 사이드카 안내(notice) ----
// 사이드카의 Dashboard 대체가 한도로 자르고 보낸다. 넘으면 사이드카의 잘못이라 프로토콜 오류다.

function text(data: Json, key: string): string {
  const value = str(data, key)
  if (value.length > MAX_DASH_TEXT) fail(`${String(data.type)}.${key}`)
  return value
}

function bool(data: Json, key: string): boolean {
  const value = data[key]
  if (typeof value !== 'boolean') fail(`${String(data.type)}.${key}`)
  return value
}

function points(data: Json, key: string): number[] {
  const value = data[key]
  if (!Array.isArray(value) || value.length > MAX_DASH_POINTS) fail(`${String(data.type)}.${key}`)
  for (const v of value)
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${String(data.type)}.${key}`)
  return value as number[]
}

// op 하나의 필드(와이어 순서 그대로). num은 유한 수, int는 정수.
type OpField = 'num' | 'int' | 'bool' | 'text' | 'points'
const DASH_OP_FIELDS: Record<DashOpType, readonly [string, OpField][]> = {
  circle: [
    ['x', 'num'],
    ['y', 'num'],
    ['radius', 'num'],
    ['stroke', 'bool']
  ],
  polygon: [
    ['xPoints', 'points'],
    ['yPoints', 'points'],
    ['stroke', 'bool']
  ],
  polyline: [
    ['xPoints', 'points'],
    ['yPoints', 'points']
  ],
  spline: ['ax', 'bx', 'cx', 'dx', 'ex', 'fx', 'ay', 'by', 'cy', 'dy', 'ey', 'fy'].map(
    (name) => [name, 'num'] as [string, OpField]
  ),
  text: [
    ['text', 'text'],
    ['x', 'num'],
    ['y', 'num'],
    ['font', 'text'],
    ['theta', 'num'],
    ['stroke', 'bool'],
    ['usePageFrame', 'bool']
  ],
  image: [
    ['path', 'text'],
    ['x', 'num'],
    ['y', 'num'],
    ['width', 'num'],
    ['height', 'num'],
    ['theta', 'num'],
    ['pivotX', 'num'],
    ['pivotY', 'num'],
    ['usePageFrame', 'bool']
  ],
  grid: [
    ['x', 'num'],
    ['y', 'num'],
    ['width', 'num'],
    ['height', 'num'],
    ['numTicksX', 'int'],
    ['numTicksY', 'int'],
    ['theta', 'num'],
    ['pivotX', 'num'],
    ['pivotY', 'num'],
    ['usePageFrame', 'bool']
  ],
  translate: [
    ['x', 'num'],
    ['y', 'num']
  ],
  rotation: [['rotation', 'num']],
  scale: [
    ['scaleX', 'num'],
    ['scaleY', 'num']
  ],
  fill: [['color', 'text']],
  stroke: [['color', 'text']],
  strokeWidth: [['width', 'int']],
  alpha: [['alpha', 'num']]
}

function dashOp(value: unknown): DashOp {
  if (
    !isObject(value) ||
    typeof value.type !== 'string' ||
    !Object.hasOwn(DASH_OP_FIELDS, value.type)
  )
    fail('dash.ops')
  const type = value.type as DashOpType
  const data: Json = { ...value, type: `dash.op.${type}` }
  const op: Record<string, unknown> = { type }
  for (const [name, field] of DASH_OP_FIELDS[type]) {
    switch (field) {
      case 'num':
        op[name] = num(data, name)
        break
      case 'int':
        op[name] = int(data, name)
        break
      case 'bool':
        op[name] = bool(data, name)
        break
      case 'text':
        op[name] = text(data, name)
        break
      case 'points':
        op[name] = points(data, name)
        break
    }
  }
  return op as DashOp
}

// 다각형·선의 점 수(두 배열 중 긴 쪽, 사이드카와 같은 셈)
function opPoints(op: DashOp): number {
  return op.type === 'polygon' || op.type === 'polyline'
    ? Math.max(op.xPoints.length, op.yPoints.length)
    : 0
}

function dashOps(data: Json): DashOp[] | null {
  if (data.ops === null) return null
  if (!Array.isArray(data.ops) || data.ops.length > MAX_DASH_OPS) fail('dash.ops')
  const ops = data.ops.map(dashOp)
  if (ops.reduce((sum, op) => sum + opPoints(op), 0) > MAX_DASH_POINTS) fail('dash.ops')
  return ops
}

function dashData(data: Json): [string, string][] {
  if (!Array.isArray(data.data) || data.data.length > MAX_DASH_DATA) fail('dash.data')
  return data.data.map((pair): [string, string] => {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string' ||
      pair[0].length > MAX_DASH_TEXT ||
      pair[1].length > MAX_DASH_TEXT
    )
      fail('dash.data')
    return [pair[0], pair[1]]
  })
}

function dashLog(data: Json): string[] | null {
  if (data.log === null) return null
  if (!Array.isArray(data.log) || data.log.length > MAX_DASH_LOG_LINES) fail('dash.log')
  for (const line of data.log)
    if (typeof line !== 'string' || line.length > MAX_DASH_TEXT) fail('dash.log')
  return data.log as string[]
}

const DASH_VARIABLE_TYPES: readonly DashVariableType[] = [
  'boolean',
  'int',
  'long',
  'float',
  'double',
  'string',
  'readonlyString',
  'enum'
]

function fieldSource(value: unknown): DashFieldSource | null {
  if (value === null) return null
  if (!isObject(value)) fail('dashConfig.source')
  const data: Json = { ...value, type: 'dashConfig.source' }
  return { declaringClass: text(data, 'declaringClass'), field: text(data, 'field') }
}

// 설정 트리. 루트의 깊이는 0, 자식은 깊이 MAX_DASH_CONFIG_DEPTH까지(사이드카는 그보다 깊은 묶음의 자식을 보내지 않는다).
// budget.nodes: 지금까지 센 자식 수(트리 전체 MAX_DASH_CONFIG_NODES까지)
function configNode(value: unknown, depth: number, budget: { nodes: number }): DashConfigNode {
  if (!isObject(value) || depth > MAX_DASH_CONFIG_DEPTH) fail('dashConfig.root')
  const data: Json = { ...value, type: 'dashConfig.node' }
  if (data.kind === 'custom') {
    if (!Array.isArray(data.children)) fail('dashConfig.node.children')
    const children = data.children.map((child): DashConfigChild => {
      if (!isObject(child) || ++budget.nodes > MAX_DASH_CONFIG_NODES) fail('dashConfig.root')
      const entry: Json = { ...child, type: 'dashConfig.child' }
      return { name: text(entry, 'name'), node: configNode(child.node, depth + 1, budget) }
    })
    return { kind: 'custom', children }
  }
  if (data.kind !== 'value') fail('dashConfig.node.kind')
  // 이 노드의 type은 변수 형식이다(메시지 종류가 아니다)
  if (
    typeof value.type !== 'string' ||
    !(DASH_VARIABLE_TYPES as readonly string[]).includes(value.type)
  )
    fail('dashConfig.node.type')
  if (!Array.isArray(data.enumValues) || data.enumValues.length > MAX_DASH_CONFIG_NODES)
    fail('dashConfig.node.enumValues')
  for (const name of data.enumValues)
    if (typeof name !== 'string' || name.length > MAX_DASH_TEXT) fail('dashConfig.node.enumValues')
  return {
    kind: 'value',
    type: value.type as DashVariableType,
    value: text(data, 'value'),
    enumValues: data.enumValues as string[],
    source: fieldSource(data.source)
  }
}

const NOTICE_CODES: readonly SidecarNoticeCode[] = ['dashCamera', 'dashImage', 'rrTuningSaved']
// 안내 매개변수(경로 등) 수와 글자 수
const MAX_NOTICE_PARAMS = 16
const MAX_NOTICE_TEXT = 4096

function noticeParams(data: Json): Record<string, string> {
  const value = data.params
  if (!isObject(value)) fail('notice.params')
  const entries = Object.entries(value)
  if (entries.length > MAX_NOTICE_PARAMS) fail('notice.params')
  for (const [key, param] of entries)
    if (key.length > MAX_NOTICE_TEXT || typeof param !== 'string' || param.length > MAX_NOTICE_TEXT)
      fail('notice.params')
  return Object.fromEntries(entries) as Record<string, string>
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
    case 'dash':
      return {
        type: 'dash',
        tNanos: num(data, 'tNanos'),
        cleared: bool(data, 'cleared'),
        data: dashData(data),
        log: dashLog(data),
        ops: dashOps(data)
      }
    case 'dashConfig':
      return {
        type: 'dashConfig',
        tNanos: num(data, 'tNanos'),
        root: configNode(data.root, 0, { nodes: 0 })
      }
    case 'notice':
      return {
        type: 'notice',
        tNanos: num(data, 'tNanos'),
        code: oneOf(data, 'code', NOTICE_CODES),
        params: noticeParams(data)
      }
    default:
      return fail(`unknown message type ${JSON.stringify(data.type)?.slice(0, 40)}`)
  }
}
