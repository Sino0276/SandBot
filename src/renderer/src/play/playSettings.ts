import {
  DEFAULT_BATTERY_VOLTAGE,
  MAX_BATTERY_VOLTAGE,
  MIN_BATTERY_VOLTAGE,
  PLAY_SPEEDS,
  type PlaySettings,
  type PlaySpeed
} from '../../../shared/play'

// 실행(Play)의 개인 설정. 모두 렌더러 localStorage에 둔다(프로젝트 파일·생성 코드와 관계없다).
// localStorage는 테스트(Node)에 없거나 막혀 있을 수 있으므로 읽기·쓰기는 모두 try/catch로 감싼다.

export const PLAY_SETTINGS_KEY = 'sandbot:playSettings'
// 프로젝트 루트 → 마지막으로 고른 OpMode 클래스(바이너리 이름)
export const LAST_OPMODE_KEY = 'sandbot:lastOpMode'
// Console의 실행할 때 지우기·개수 토글(Unity Console처럼 기억한다)
export const CONSOLE_PREFS_KEY = 'sandbot:console'
// 아래 패널의 고른 탭
export const DOCK_TAB_KEY = 'sandbot:playDock'

export const DEFAULT_PLAY_SETTINGS: PlaySettings = {
  speed: 1,
  jitter: 0,
  seed: 1,
  autoStopAutonomous: true,
  batteryVoltage: DEFAULT_BATTERY_VOLTAGE
}

// Hub 타이밍 오차의 상한(±50%). 이보다 크면 결과가 실제 허브와 너무 달라진다.
export const MAX_JITTER = 0.5
// 환경 설정의 Hub 타이밍 오차 선택지(±%). 0은 끔(같은 코드 → 같은 루프 시간). 켜면 seed가 같을 때 같은 결과다.
export const JITTER_CHOICES: readonly number[] = [0, 0.02, 0.05, 0.1, 0.2]
// 시드는 Java long이지만 JSON 숫자로 정확히 보낼 수 있는 범위로 둔다
const MAX_SEED = 2 ** 31 - 1

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem'>

// 브라우저 localStorage. 없거나 접근이 막혔으면 null.
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readJson(storage: ReadStorage | null, key: string): unknown {
  if (!storage) return null
  try {
    return JSON.parse(storage.getItem(key) ?? 'null')
  } catch {
    // 깨진 값은 없는 것으로 본다
    return null
  }
}

function writeJson(storage: WriteStorage | null, key: string, value: unknown): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 이번 실행 동안만 기억한다
  }
}

export function isPlaySpeed(value: unknown): value is PlaySpeed {
  return PLAY_SPEEDS.includes(value as PlaySpeed)
}

export function clampJitter(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_JITTER, Math.max(0, value)) : 0
}

export function clampSeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAY_SETTINGS.seed
  return Math.min(MAX_SEED, Math.max(-MAX_SEED, Math.trunc(value)))
}

// 저장된 값을 확인해 읽는다. 맞지 않는 항목만 기본값으로 바꾼다.
export function parsePlaySettings(value: unknown): PlaySettings {
  const saved =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    speed: isPlaySpeed(saved.speed) ? saved.speed : DEFAULT_PLAY_SETTINGS.speed,
    jitter: typeof saved.jitter === 'number' ? clampJitter(saved.jitter) : 0,
    seed: typeof saved.seed === 'number' ? clampSeed(saved.seed) : DEFAULT_PLAY_SETTINGS.seed,
    autoStopAutonomous:
      typeof saved.autoStopAutonomous === 'boolean'
        ? saved.autoStopAutonomous
        : DEFAULT_PLAY_SETTINGS.autoStopAutonomous,
    batteryVoltage:
      typeof saved.batteryVoltage === 'number' &&
      saved.batteryVoltage >= MIN_BATTERY_VOLTAGE &&
      saved.batteryVoltage <= MAX_BATTERY_VOLTAGE
        ? saved.batteryVoltage
        : DEFAULT_BATTERY_VOLTAGE
  }
}

export function loadPlaySettings(storage: ReadStorage | null = browserStorage()): PlaySettings {
  return parsePlaySettings(readJson(storage, PLAY_SETTINGS_KEY))
}

export function savePlaySettings(
  settings: PlaySettings,
  storage: WriteStorage | null = browserStorage()
): void {
  writeJson(storage, PLAY_SETTINGS_KEY, settings)
}

function lastOpModes(storage: ReadStorage | null): Record<string, string> {
  const saved = readJson(storage, LAST_OPMODE_KEY)
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return {}
  return Object.fromEntries(
    Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

// 이 프로젝트에서 마지막으로 고른 OpMode(DS처럼 다음에 열어도 그대로)
export function loadLastOpMode(
  root: string,
  storage: ReadStorage | null = browserStorage()
): string | null {
  return lastOpModes(storage)[root] ?? null
}

export function saveLastOpMode(
  root: string,
  className: string | null,
  storage: Storage | null = browserStorage()
): void {
  const all = lastOpModes(storage)
  if (className === null) delete all[root]
  else all[root] = className
  writeJson(storage, LAST_OPMODE_KEY, all)
}

export type ConsoleLevel = 'info' | 'warning' | 'error'

export type ConsolePrefs = {
  // 실행(INIT)할 때 지우기. Unity의 Clear on Play처럼 기본은 켬.
  clearOnPlay: boolean
  // 머리줄의 로그·경고·오류 토글(켠 수준만 보인다)
  show: Record<ConsoleLevel, boolean>
}

export const DEFAULT_CONSOLE_PREFS: ConsolePrefs = {
  clearOnPlay: true,
  show: { info: true, warning: true, error: true }
}

export function parseConsolePrefs(value: unknown): ConsolePrefs {
  const saved =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const show =
    saved.show !== null && typeof saved.show === 'object'
      ? (saved.show as Record<string, unknown>)
      : {}
  const flag = (raw: unknown, fallback: boolean): boolean =>
    typeof raw === 'boolean' ? raw : fallback
  return {
    clearOnPlay: flag(saved.clearOnPlay, DEFAULT_CONSOLE_PREFS.clearOnPlay),
    show: {
      info: flag(show.info, true),
      warning: flag(show.warning, true),
      error: flag(show.error, true)
    }
  }
}

export function loadConsolePrefs(storage: ReadStorage | null = browserStorage()): ConsolePrefs {
  return parseConsolePrefs(readJson(storage, CONSOLE_PREFS_KEY))
}

export function saveConsolePrefs(
  prefs: ConsolePrefs,
  storage: WriteStorage | null = browserStorage()
): void {
  writeJson(storage, CONSOLE_PREFS_KEY, prefs)
}

export const DOCK_TABS = ['console', 'telemetry', 'devices'] as const
export type DockTab = (typeof DOCK_TABS)[number]

export function loadDockTab(storage: ReadStorage | null = browserStorage()): DockTab {
  const saved = readJson(storage, DOCK_TAB_KEY)
  return DOCK_TABS.includes(saved as DockTab) ? (saved as DockTab) : 'console'
}

export function saveDockTab(tab: DockTab, storage: WriteStorage | null = browserStorage()): void {
  writeJson(storage, DOCK_TAB_KEY, tab)
}
