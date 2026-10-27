import type { TFunction } from 'i18next'
import type { FinishReason, SimErrorKind } from '../../../shared/sidecarProtocol'
import type { PlayDiagnostic, PlayStackFrame } from '../../../shared/play'
import type { NoticeKey } from '../editor/noticeStore'
import type { Messages } from '../i18n/locales/ko'
import type { ConsoleLevel } from './playSettings'

// Console(Unity Console) 항목. 스토어에는 번역하지 않은 값만 두고, 글자는 그릴 때 번역한다(언어를 바꾸면 따라 바뀜).
// 팀 코드·javac·사이드카의 영어 문장은 그대로 두고 kind로 번역한 머리말만 붙인다.

export type { ConsoleLevel }

// 항목 수 한도. 넘치면 오래된 것부터 버린다.
export const CONSOLE_LIMIT = 2000

export type ConsoleFinishReason = FinishReason | 'killed' | 'crashed'

// 실행 흐름이 남기는 안내(console.notices.*)
export type ConsoleNoticeKey = keyof Messages['console']['notices']

export type ConsoleBody =
  | { type: 'log'; stream: 'out' | 'err' | 'robotLog'; text: string }
  | {
      type: 'error'
      kind: SimErrorKind
      message: string
      exception: string | null
      stack: PlayStackFrame[]
      thread: string
    }
  | { type: 'diagnostic'; diagnostic: PlayDiagnostic }
  | { type: 'compiled'; ok: boolean; millis: number; errors: number; warnings: number }
  // 실행 시작(INIT). config는 구성 XML 경로(없으면 null: 장치 없는 hardwareMap)
  | { type: 'run'; name: string; config: string | null }
  | { type: 'finished'; reason: ConsoleFinishReason; detail: string }
  | { type: 'notice'; key: ConsoleNoticeKey; params: Record<string, string | number> }
  // playInit이 실패했다(알림과 같은 문장, notice.play*)
  | { type: 'initFailed'; notice: NoticeKey; detail: string }

export type ConsoleEntry = ConsoleBody & {
  id: number
  level: ConsoleLevel
  // 가상 시간(실행 전 안내는 null)
  tNanos: number | null
  // 실행의 프로젝트 루트(진단·오류의 경로는 이 프로젝트의 TeamCode 기준이다). 없으면 프로젝트와 관계없는 항목.
  root?: string
}

const ERROR_FINISH: ReadonlySet<ConsoleFinishReason> = new Set([
  'exception',
  'compileFailed',
  'loadFailed',
  'stuck',
  'crashed'
])

// 항목의 수준(아이콘과 개수 토글). System.err는 Android logcat처럼 경고로 본다.
export function consoleLevel(
  body: ConsoleBody,
  noticeLevel: ConsoleLevel = 'warning'
): ConsoleLevel {
  switch (body.type) {
    case 'log':
      return body.stream === 'err' ? 'warning' : 'info'
    case 'error':
      // stall은 짐작(무한 루프일 수 있음)이고 OpMode는 계속 돈다
      return body.kind === 'stall' ? 'warning' : 'error'
    case 'diagnostic':
      return body.diagnostic.kind === 'error'
        ? 'error'
        : body.diagnostic.kind === 'warning'
          ? 'warning'
          : 'info'
    case 'compiled':
      return body.ok ? 'info' : 'error'
    case 'run':
      return 'info'
    case 'finished':
      return ERROR_FINISH.has(body.reason) ? 'error' : body.reason === 'killed' ? 'warning' : 'info'
    case 'notice':
    case 'initFailed':
      return noticeLevel
  }
}

// 새 항목을 뒤에 붙이고 한도를 넘으면 앞을 버린다(붙일 것이 없으면 같은 배열)
export function appendConsole(
  entries: readonly ConsoleEntry[],
  added: readonly ConsoleEntry[],
  limit: number = CONSOLE_LIMIT
): readonly ConsoleEntry[] {
  if (added.length === 0) return entries
  const next = entries.concat(added)
  return next.length > limit ? next.slice(next.length - limit) : next
}

export type ConsoleCounts = Record<ConsoleLevel, number>

export function consoleCounts(entries: readonly ConsoleEntry[]): ConsoleCounts {
  const counts: ConsoleCounts = { info: 0, warning: 0, error: 0 }
  for (const entry of entries) counts[entry.level]++
  return counts
}

// Unity처럼 999를 넘으면 999+
export function formatCount(count: number): string {
  return count > 999 ? '999+' : String(count)
}

// Java 스택 줄 모양: at org.foo.Lift.run(Lift.java:42)
export function frameText(frame: PlayStackFrame): string {
  const where = frame.file
    ? frame.line > 0
      ? `${frame.file}:${frame.line}`
      : frame.file
    : 'Unknown Source'
  return `at ${frame.className}.${frame.method}(${where})`
}

// javac·Unity처럼 file(line,column): message. 파일이 없는 진단(file '')은 위치가 없다.
export function diagnosticLocation(diagnostic: PlayDiagnostic): string {
  if (diagnostic.file === '' || diagnostic.line <= 0) return diagnostic.file
  return diagnostic.column > 0
    ? `${diagnostic.file}(${diagnostic.line},${diagnostic.column})`
    : `${diagnostic.file}(${diagnostic.line})`
}

// 목록 한 줄에 보이는 글자 수 한도. 팀 코드가 아주 긴 줄(로그는 64 KB까지 온다)을 찍어도 행마다 그 글자 전체를
// 배치하지 않게 자른다(전체는 고른 항목 아래와 검색에 그대로 있다).
export const SUMMARY_MAX_CHARS = 500

// 목록 한 줄에 보이는 요약(여러 줄 글자는 첫 줄, 길면 자름)
export function entrySummary(entry: ConsoleEntry, t: TFunction): string {
  const line = firstLine(entryHeadline(entry, t))
  return line.length > SUMMARY_MAX_CHARS ? `${line.slice(0, SUMMARY_MAX_CHARS)}…` : line
}

function firstLine(text: string): string {
  const end = text.search(/\r?\n/)
  return end < 0 ? text : text.slice(0, end)
}

// 항목의 머리 문장(번역한 머리말 + 원문)
export function entryHeadline(entry: ConsoleEntry, t: TFunction): string {
  switch (entry.type) {
    case 'log':
      return entry.text
    case 'error':
      return `${t(`play.errorKind.${entry.kind}`)}: ${entry.message}`
    case 'diagnostic': {
      const { diagnostic } = entry
      const location = diagnosticLocation(diagnostic)
      const message = `${t(`console.diagnosticKind.${diagnostic.kind}`)}: ${diagnostic.message}`
      return location ? `${location}: ${message}` : message
    }
    case 'compiled':
      return entry.ok
        ? entry.warnings > 0
          ? t('console.compiledWithWarnings', { millis: entry.millis, count: entry.warnings })
          : t('console.compiled', { millis: entry.millis })
        : t('console.compileFailed', { millis: entry.millis, count: entry.errors })
    case 'run':
      return entry.config === null
        ? t('console.runStartedNoConfig', { name: entry.name })
        : t('console.runStarted', { name: entry.name, config: entry.config })
    case 'finished':
      return t('console.finished', { reason: t(`play.finishReason.${entry.reason}`) })
    case 'notice':
      return t(`console.notices.${entry.key}`, entry.params)
    case 'initFailed':
      return t(`notice.${entry.notice}`, { detail: entry.detail })
  }
}

// 메인이 JVM을 끝낸 이유(finished killed의 detail, 기계용 키). 그 밖의 detail(crashed의 stderr 끝부분 등)은 그대로 보인다.
export const KILLED_DETAILS = ['stopTimeout', 'stalled', 'shutdownTimeout'] as const
type KilledDetail = (typeof KILLED_DETAILS)[number]

export function finishDetail(reason: ConsoleFinishReason, detail: string, t: TFunction): string {
  if (reason === 'killed' && (KILLED_DETAILS as readonly string[]).includes(detail))
    return t(`play.killedDetail.${detail as KilledDetail}`)
  return detail
}

// 고른 항목 아래에 보이는 전체 글자(검색도 이 글자로 한다). 스택 줄은 UI가 따로 그린다(팀 코드 줄은 누를 수 있게).
export function entryDetailLines(entry: ConsoleEntry, t: TFunction): string[] {
  switch (entry.type) {
    case 'error': {
      const lines = [entryHeadline(entry, t)]
      if (entry.exception) lines.push(`${t('console.exception')}: ${entry.exception}`)
      if (entry.thread) lines.push(`${t('console.thread')}: ${entry.thread}`)
      if (entry.kind === 'stall') lines.push(t('play.stallHint'))
      return lines
    }
    case 'diagnostic': {
      const lines = [entryHeadline(entry, t)]
      if (entry.diagnostic.code) lines.push(`${t('console.code')}: ${entry.diagnostic.code}`)
      return lines
    }
    case 'finished':
      return entry.detail
        ? [entryHeadline(entry, t), finishDetail(entry.reason, entry.detail, t)]
        : [entryHeadline(entry, t)]
    default:
      return [entryHeadline(entry, t)]
  }
}

export function entrySearchText(entry: ConsoleEntry, t: TFunction): string {
  const lines = entryDetailLines(entry, t)
  if (entry.type === 'error') lines.push(...entry.stack.map(frameText))
  return lines.join('\n').toLowerCase()
}

export function visibleEntries(
  entries: readonly ConsoleEntry[],
  show: Record<ConsoleLevel, boolean>,
  query: string,
  t: TFunction
): readonly ConsoleEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '' && show.info && show.warning && show.error) return entries
  return entries.filter(
    (entry) => show[entry.level] && (needle === '' || entrySearchText(entry, t).includes(needle))
  )
}

export type ConsoleTarget = { path: string; line: number }

// 항목의 경로를 지금 프로젝트에서 열 수 있는지. 다른 프로젝트의 실행이 남긴 항목은 열지 않는다(같은 상대 경로의
// 다른 파일, 예를 들어 시즌별 사본의 같은 OpMode를 여는 일이 없게).
export function entryInProject(entry: ConsoleEntry, root: string | null | undefined): boolean {
  return root === undefined || entry.root === undefined || entry.root === root
}

// 더블클릭·Enter로 외부 편집기에서 열 곳: 컴파일 진단의 줄, 오류 스택의 첫 팀 코드 줄. TeamCode 밖이거나
// 다른 프로젝트(root를 주면 비교한다)의 항목이면 없다.
export function entryTarget(entry: ConsoleEntry, root?: string | null): ConsoleTarget | null {
  if (!entryInProject(entry, root)) return null
  if (entry.type === 'diagnostic') {
    const { path, line } = entry.diagnostic
    return path ? { path, line: Math.max(1, line) } : null
  }
  if (entry.type === 'error') {
    const frame = entry.stack.find((candidate) => candidate.path !== null)
    return frame?.path ? { path: frame.path, line: Math.max(1, frame.line) } : null
  }
  return null
}
