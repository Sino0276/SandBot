import { AUTONOMOUS_SECONDS, type OpModeFlavor } from '../../../shared/play'
import type { DeviceValues, TelemetryFrame } from '../../../shared/sidecarProtocol'

// 실행 화면(툴바 시간, Console 시각, 장치 표, 텔레메트리)에 보이는 값의 글자. 번역하지 않는 숫자·SDK 값만 다룬다.

const NANOS_PER_MILLI = 1_000_000

// 가상 시간 mm:ss.mmm(분은 60을 넘어도 그대로 센다). 음수는 0으로 본다.
export function formatVirtualTime(tNanos: number): string {
  const totalMillis = Math.max(0, Math.floor(tNanos / NANOS_PER_MILLI))
  const minutes = Math.floor(totalMillis / 60_000)
  const seconds = Math.floor((totalMillis % 60_000) / 1000)
  const millis = totalMillis % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

// Autonomous의 남은 시간(나노초). startedNanos는 START 뒤 흐른 가상 시간(아직 START 전이면 null: 30초 그대로).
export function autonomousRemainingNanos(startedNanos: number | null): number {
  const total = AUTONOMOUS_SECONDS * 1_000_000_000
  return startedNanos === null ? total : Math.max(0, total - startedNanos)
}

// 툴바 시간 칸에 보일 것: Autonomous는 DS처럼 30초에서 거꾸로, 아니면 가상 시간
export function toolbarClock(
  flavor: OpModeFlavor,
  tNanos: number,
  startedNanos: number | null
): { text: string; countdown: boolean } {
  if (flavor === 'Autonomous')
    return { text: formatVirtualTime(autonomousRemainingNanos(startedNanos)), countdown: true }
  return { text: formatVirtualTime(tNanos), countdown: false }
}

// 실제 속도가 설정한 속도의 이만큼 아래면 "느림"을 보인다(이 PC가 따라가지 못함)
export const SLOW_RATIO = 0.8

export function isRunningSlow(speed: number | 'max', realtime: number, paused: boolean): boolean {
  return typeof speed === 'number' && !paused && realtime > 0 && realtime < speed * SLOW_RATIO
}

// 0.25 → '0.25', 1 → '1', 0.6234 → '0.62'
export function formatRatio(value: number): string {
  return String(Math.round(value * 100) / 100)
}

// 장치 출력 값. 숫자는 소수 넷째 자리까지(뒤의 0은 뺀다), null은 값 없음(—).
export function formatDeviceValue(value: DeviceValues[string]): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    if (Number.isInteger(value)) return String(value)
    return String(Number(value.toFixed(4)))
  }
  return value
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

// DS의 HTML 텔레메트리(DisplayFormat.HTML)를 글자로 바꾼다. 태그를 해석해 그리지 않는다(팀 코드의 글자를 HTML로
// 넣지 않는다). <br>은 줄바꿈, 나머지 태그는 빼고, 흔한 문자 참조만 푼다.
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, name: string) => {
      if (name[0] === '#') {
        const code =
          name[1] === 'x' || name[1] === 'X'
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match
      }
      return ENTITIES[name.toLowerCase()] ?? match
    })
}

export function telemetryLines(frame: TelemetryFrame): { lines: string[]; log: string[] } {
  if (frame.format !== 'html') return { lines: frame.lines, log: frame.log }
  return { lines: frame.lines.map(htmlToText), log: frame.log.map(htmlToText) }
}
