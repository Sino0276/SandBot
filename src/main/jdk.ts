import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import path from 'path'
import { IPC } from '../shared/ipc'
import { MIN_JDK_MAJOR, type JdkChoice, type JdkInfo, type JdkState } from '../shared/play'
import {
  parseUninstallEntries,
  queryRegistry,
  registryCandidates,
  wellKnownCandidates
} from './externalEditor'

// 사이드카(JVM)가 쓸 JDK 찾기. 번들하지 않고 이 PC에 있는 것을 쓴다(Unity External Tools처럼 환경 설정에서 고른다).
// 찾는 순서: 사용자 설정(userData/jdk.json) → Android Studio의 jbr(FTC 팀은 거의 모두 설치했다) → JAVA_HOME → PATH의 java.
// JDK인지는 bin/java·bin/javac와 release 파일(JAVA_VERSION)로 확인한다. 사이드카가 javax.tools로 팀 코드를 컴파일하므로
// JRE(javac 없음)는 쓸 수 없다. MIN_JDK_MAJOR 미만도 찾은 목록(detected)에는 보이되 실행에는 쓰지 않는다.

type PathApi = typeof path.posix

export function pathApiOf(platform: NodeJS.Platform): PathApi {
  return platform === 'win32' ? path.win32 : path.posix
}

// 파일 시스템 접근(테스트에서 가짜 폴더 구조로 바꾼다). 실패는 모두 false·null·[]로 돌려준다.
export type JdkFs = {
  isFile: (target: string) => Promise<boolean>
  isDirectory: (target: string) => Promise<boolean>
  readText: (target: string) => Promise<string | null>
  readdir: (target: string) => Promise<string[]>
  // 링크를 모두 푼 실제 위치
  realpath: (target: string) => Promise<string | null>
}

export const nodeJdkFs: JdkFs = {
  isFile: async (target) => (await stat(target).catch(() => null))?.isFile() ?? false,
  isDirectory: async (target) => (await stat(target).catch(() => null))?.isDirectory() ?? false,
  readText: (target) => readFile(target, 'utf8').catch(() => null),
  readdir: (target) => readdir(target).catch(() => [] as string[]),
  realpath: (target) => realpath(target).catch(() => null)
}

export type JdkDetectDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  fs: JdkFs
  // Windows `reg query <키> /s`의 출력(externalEditor.ts와 같다). 실패하면 빈 문자열.
  queryRegistry: (key: string) => Promise<string>
}

// ───────────────────────── JDK 폴더 확인 ─────────────────────────

// release 파일의 JAVA_VERSION 값(JAVA_VERSION="17.0.2"). 따옴표는 없을 수도 있다.
export function parseReleaseVersion(text: string): string | null {
  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)) {
    const match = /^\s*JAVA_VERSION\s*=\s*(.*?)\s*$/.exec(raw)
    if (!match) continue
    const value = match[1].replace(/^"(.*)"$/, '$1').trim()
    return value === '' ? null : value
  }
  return null
}

// 주 버전. "1.8.0_392" → 8(9 전의 1.x 방식), "17.0.2" → 17, "21" → 21, "22-ea" → 22. 읽을 수 없으면 null.
export function javaMajor(version: string): number | null {
  const legacy = /^1\.(\d+)(?:[._-]|$)/.exec(version)
  const match = legacy ?? /^(\d+)(?:[.+_-]|$)/.exec(version)
  if (!match) return null
  const major = Number(match[1])
  return Number.isSafeInteger(major) && major > 0 ? major : null
}

export function javaTool(home: string, tool: 'java' | 'javac', platform: NodeJS.Platform): string {
  const api = pathApiOf(platform)
  return api.join(home, 'bin', platform === 'win32' ? `${tool}.exe` : tool)
}

// home이 JDK 폴더면 그 정보, 아니면 null(bin/java·bin/javac·release의 JAVA_VERSION 중 하나라도 없음)
export async function inspectJdk(
  home: string,
  source: JdkInfo['source'],
  deps: Pick<JdkDetectDeps, 'platform' | 'fs'>
): Promise<JdkInfo | null> {
  const api = pathApiOf(deps.platform)
  if (!home || !api.isAbsolute(home)) return null
  const [hasJava, hasJavac, release] = await Promise.all([
    deps.fs.isFile(javaTool(home, 'java', deps.platform)),
    deps.fs.isFile(javaTool(home, 'javac', deps.platform)),
    deps.fs.readText(api.join(home, 'release'))
  ])
  if (!hasJava || !hasJavac || release === null) return null
  const version = parseReleaseVersion(release)
  const major = version === null ? null : javaMajor(version)
  if (version === null || major === null) return null
  return { home, version, major, source }
}

// ───────────────────────── 후보 위치 ─────────────────────────

// 이름에 든 숫자 묶음을 수로 비교해 큰 것(새 버전)부터
function newestFirst(names: string[]): string[] {
  return [...names].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
}

// JetBrains Toolbox App 1.x의 apps/AndroidStudio/ch-<n>/<빌드>/ 폴더들(새 빌드부터)
async function toolboxBuilds(appsDir: string, deps: JdkDetectDeps): Promise<string[]> {
  const api = pathApiOf(deps.platform)
  const product = api.join(appsDir, 'AndroidStudio')
  const channels = (await deps.fs.readdir(product)).filter((name) => /^ch-\d+$/.test(name))
  const builds: string[] = []
  for (const channel of channels.sort()) {
    const dir = api.join(product, channel)
    const names = (await deps.fs.readdir(dir)).filter((name) => /^\d/.test(name))
    builds.push(...newestFirst(names).map((name) => api.join(dir, name)))
  }
  return builds
}

// 설치 폴더(bin/studio64.exe·bin/studio.sh가 있는 폴더의 부모)의 JDK. 4.2 이전은 jre 폴더였다.
function installJdks(install: string, api: PathApi): string[] {
  return [api.join(install, 'jbr'), api.join(install, 'jre')]
}

// macOS 앱 번들 안의 JDK(Contents/Home이 JAVA_HOME)
function bundleJdks(app: string): string[] {
  return [
    path.posix.join(app, 'Contents/jbr/Contents/Home'),
    path.posix.join(app, 'Contents/jre/Contents/Home'),
    path.posix.join(app, 'Contents/jre/jdk/Contents/Home')
  ]
}

async function macAndroidStudioApps(dir: string, deps: JdkDetectDeps): Promise<string[]> {
  const names = (await deps.fs.readdir(dir)).filter((name) => /^Android Studio.*\.app$/.test(name))
  // 'Android Studio.app'(정식)을 미리보기보다 먼저
  return names
    .sort((a, b) => (a === 'Android Studio.app' ? -1 : b === 'Android Studio.app' ? 1 : 0))
    .map((name) => path.posix.join(dir, name))
}

// Android Studio의 JDK 후보(확인 전). externalEditor.ts가 찾는 Android Studio 실행 파일에서 설치 폴더를 정한다
// (Windows: 레지스트리 → Program Files·LOCALAPPDATA\Programs, Linux: 흔한 위치). macOS는 /Applications·
// ~/Applications의 'Android Studio*.app'. 그 뒤 JetBrains Toolbox(1.x는 apps/AndroidStudio/ch-*/<빌드>, 2.x는
// Windows·macOS가 위의 기본 위치, Linux는 apps/android-studio)와 Linux snap.
export async function androidStudioJdkCandidates(deps: JdkDetectDeps): Promise<string[]> {
  const api = pathApiOf(deps.platform)
  const homes: string[] = []
  if (deps.platform === 'darwin') {
    for (const dir of ['/Applications', path.posix.join(deps.home, 'Applications')]) {
      for (const bundle of await macAndroidStudioApps(dir, deps)) homes.push(...bundleJdks(bundle))
    }
    const toolbox = path.posix.join(deps.home, 'Library/Application Support/JetBrains/Toolbox/apps')
    for (const build of await toolboxBuilds(toolbox, deps)) {
      for (const bundle of await macAndroidStudioApps(build, deps))
        homes.push(...bundleJdks(bundle))
    }
    return homes
  }

  const executables: string[] = []
  if (deps.platform === 'win32') {
    for (const key of [
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    ]) {
      const output = await deps.queryRegistry(key)
      for (const candidate of registryCandidates(parseUninstallEntries(output, deps.env)))
        if (candidate.id === 'android-studio') executables.push(candidate.exe)
    }
  }
  for (const candidate of wellKnownCandidates(deps.platform, deps.env, deps.home))
    if (candidate.id === 'android-studio') executables.push(candidate.exe)
  for (const exe of executables) {
    const bin = api.dirname(exe)
    // 설치 폴더의 bin/studio64.exe·bin/studio.sh만 설치 폴더를 알려 준다(snap·Toolbox 실행 스크립트는 아니다)
    const name = api.basename(exe).toLowerCase()
    if (
      (name === 'studio64.exe' || name === 'studio.sh') &&
      api.basename(bin).toLowerCase() === 'bin'
    )
      homes.push(...installJdks(api.dirname(bin), api))
  }

  if (deps.platform === 'win32') {
    const local = deps.env.LOCALAPPDATA
    if (local && api.isAbsolute(local)) {
      const apps = api.join(local, 'JetBrains', 'Toolbox', 'apps')
      for (const build of await toolboxBuilds(apps, deps)) homes.push(...installJdks(build, api))
    }
  } else {
    const apps = api.join(deps.home, '.local/share/JetBrains/Toolbox/apps')
    homes.push(...installJdks(api.join(apps, 'android-studio'), api))
    for (const build of await toolboxBuilds(apps, deps)) homes.push(...installJdks(build, api))
    homes.push('/snap/android-studio/current/jbr')
  }
  return homes
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed
}

// JAVA_HOME. 끝에 bin을 붙여 둔 설정(흔한 실수)도 받는다.
export function javaHomeCandidates(deps: Pick<JdkDetectDeps, 'platform' | 'env'>): string[] {
  const api = pathApiOf(deps.platform)
  const value = stripQuotes(deps.env.JAVA_HOME ?? '')
  if (!value || !api.isAbsolute(value)) return []
  const home = api.normalize(value).replace(/[\\/]+$/, '') || value
  return api.basename(home).toLowerCase() === 'bin' ? [home, api.dirname(home)] : [home]
}

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return env[name] ?? ''
  // Windows 환경 변수 이름은 대소문자를 구분하지 않는다(Path)
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key ? (env[key] ?? '') : ''
}

// PATH의 java들(순서대로). 링크를 따라가 실제 실행 파일의 bin 폴더 부모를 JDK 폴더로 본다
// (/usr/bin/java → /etc/alternatives/java → /usr/lib/jvm/java-21-openjdk-amd64/bin/java). 상대 경로 항목은
// 보지 않는다(현재 폴더의 java를 실행하지 않게).
export async function pathJdkCandidates(deps: JdkDetectDeps): Promise<string[]> {
  const api = pathApiOf(deps.platform)
  const delimiter = deps.platform === 'win32' ? ';' : ':'
  const exe = deps.platform === 'win32' ? 'java.exe' : 'java'
  const homes: string[] = []
  for (const entry of envValue(deps.env, 'PATH', deps.platform).split(delimiter)) {
    const dir = stripQuotes(entry)
    if (!dir || !api.isAbsolute(dir)) continue
    const java = api.join(dir, exe)
    if (!(await deps.fs.isFile(java))) continue
    const real = (await deps.fs.realpath(java)) ?? java
    const bin = api.dirname(real)
    if (api.basename(bin).toLowerCase() === 'bin') homes.push(api.dirname(bin))
  }
  return homes
}

// 이 PC의 JDK들(우선순위 순: Android Studio → JAVA_HOME → PATH). 같은 폴더(링크를 푼 위치가 같음)는 한 번만.
export async function detectJdks(deps: JdkDetectDeps): Promise<JdkInfo[]> {
  const groups: [JdkInfo['source'], string[]][] = [
    ['androidStudio', await androidStudioJdkCandidates(deps)],
    ['javaHome', javaHomeCandidates(deps)],
    ['path', await pathJdkCandidates(deps)]
  ]
  const seen = new Set<string>()
  const found: JdkInfo[] = []
  for (const [source, homes] of groups) {
    for (const home of homes) {
      const real = (await deps.fs.realpath(home)) ?? home
      const key = deps.platform === 'win32' ? real.toLowerCase() : real
      if (seen.has(key)) continue
      const info = await inspectJdk(home, source, deps)
      if (!info) continue
      seen.add(key)
      found.push(info)
    }
  }
  return found
}

// ───────────────────────── 설정과 상태 ─────────────────────────

export type StoredJdk = { kind: 'auto' } | { kind: 'custom'; home: string }

const AUTO: StoredJdk = { kind: 'auto' }

export function parseStoredJdk(text: string): StoredJdk {
  try {
    const value = JSON.parse(text) as Record<string, unknown> | null
    if (
      value &&
      value.kind === 'custom' &&
      typeof value.home === 'string' &&
      value.home !== '' &&
      value.home.length <= 4096
    )
      return { kind: 'custom', home: value.home }
  } catch {
    // 깨진 설정은 자동으로 돌아간다
  }
  return AUTO
}

export async function readJdkSettings(file: string): Promise<StoredJdk> {
  try {
    return parseStoredJdk(await readFile(file, 'utf8'))
  } catch {
    return AUTO
  }
}

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

// 쓰는 도중 꺼져도 이전 설정이 깨지지 않게 임시 파일에 쓴 뒤 바꿔 끼운다(externalEditor.ts와 같은 방식)
export async function writeJdkSettings(file: string, value: StoredJdk): Promise<void> {
  const temp = `${file}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= 5 || !RETRY_CODES.has(code)) {
        await unlink(temp).catch(() => undefined)
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
}

export type JdkDeps = JdkDetectDeps & {
  settingsFile: string
  now: () => number
}

// 찾은 결과를 짧게 기억한다(실행마다 다시 찾지 않게). 환경 설정 창을 열 때(getJdk)는 늘 다시 찾는다.
const DETECT_CACHE_MS = 60_000
let detectCache: { at: number; list: JdkInfo[] } | null = null

async function detectFresh(deps: JdkDeps): Promise<JdkInfo[]> {
  const list = await detectJdks(deps)
  detectCache = { at: deps.now(), list }
  return list
}

async function detectCached(deps: JdkDeps): Promise<JdkInfo[]> {
  if (detectCache && deps.now() - detectCache.at < DETECT_CACHE_MS) return detectCache.list
  return detectFresh(deps)
}

// 테스트용
export function resetJdkCache(): void {
  detectCache = null
}

// 실행에 쓸 JDK. 고른 폴더는 매번 다시 확인한다(지웠거나 업데이트로 바뀌었을 수 있다).
async function activeOf(
  stored: StoredJdk,
  detected: JdkInfo[],
  deps: JdkDeps
): Promise<JdkInfo | null> {
  if (stored.kind === 'custom') {
    const info = await inspectJdk(stored.home, 'setting', deps)
    return info && info.major >= MIN_JDK_MAJOR ? info : null
  }
  return detected.find((info) => info.major >= MIN_JDK_MAJOR) ?? null
}

async function stateOf(
  stored: StoredJdk,
  detected: JdkInfo[],
  deps: JdkDeps,
  error?: JdkState['error']
): Promise<JdkState> {
  return {
    choice: stored.kind === 'custom' ? { kind: 'custom', home: stored.home } : { kind: 'auto' },
    active: await activeOf(stored, detected, deps),
    detected,
    ...(error ? { error } : {})
  }
}

// 설정 읽기·쓰기는 차례로 한다(동시에 고르면 임시 파일이 겹친다)
let settingsQueue: Promise<unknown> = Promise.resolve()

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = settingsQueue.then(work, work)
  settingsQueue = result.catch(() => undefined)
  return result
}

export async function getJdkState(deps: JdkDeps): Promise<JdkState> {
  const detected = await detectFresh(deps)
  const stored = await serialized(() => readJdkSettings(deps.settingsFile))
  return stateOf(stored, detected, deps)
}

// 사이드카를 띄울 때 쓰는 JDK(없으면 null)
export async function resolveActiveJdk(deps: JdkDeps = defaultJdkDeps()): Promise<JdkInfo | null> {
  const stored = await serialized(() => readJdkSettings(deps.settingsFile))
  return activeOf(stored, stored.kind === 'auto' ? await detectCached(deps) : [], deps)
}

// 찾아보기로 고른 폴더. macOS의 .jdk·.app 번들을 고르면 그 안의 Contents/Home도 본다.
async function inspectBrowsed(picked: string, deps: JdkDeps): Promise<JdkInfo | null> {
  const api = pathApiOf(deps.platform)
  const candidates = [picked]
  if (deps.platform === 'darwin') candidates.push(api.join(picked, 'Contents', 'Home'))
  if (api.basename(picked).toLowerCase() === 'bin') candidates.push(api.dirname(picked))
  for (const home of candidates) {
    const info = await inspectJdk(home, 'setting', deps)
    if (info) return info
  }
  return null
}

// 렌더러가 보낸 선택(믿지 않는 입력)을 확인해 설정을 바꾼다. 받지 않으면 설정은 그대로 두고 error를 붙인다.
// detected는 이번에 찾은 목록에 있는 폴더만 받는다(렌더러가 아무 폴더나 넘기지 못하게, 찾아보기는 대화상자로만).
export async function setJdkChoice(
  choice: unknown,
  deps: JdkDeps,
  browse: (title: string) => Promise<string | null>
): Promise<JdkState> {
  const input = (typeof choice === 'object' && choice !== null ? choice : {}) as Record<
    string,
    unknown
  >
  const kind = input.kind as JdkChoice['kind'] | undefined
  // 대화상자는 설정 차례 밖에서 띄운다(고르는 동안 다른 설정 읽기를 막지 않게)
  const picked =
    kind === 'browse'
      ? await browse(typeof input.title === 'string' ? input.title.slice(0, 200) : '')
      : null
  const detected = detectCache?.list ?? (await detectFresh(deps))
  return serialized(async () => {
    const stored = await readJdkSettings(deps.settingsFile)
    const save = async (next: StoredJdk): Promise<JdkState> => {
      await writeJdkSettings(deps.settingsFile, next)
      return stateOf(next, detected, deps)
    }
    const accept = async (info: JdkInfo | null): Promise<JdkState> => {
      if (!info) return stateOf(stored, detected, deps, 'notJdk')
      if (info.major < MIN_JDK_MAJOR) return stateOf(stored, detected, deps, 'tooOld')
      return save({ kind: 'custom', home: info.home })
    }
    switch (kind) {
      case 'auto':
        return save(AUTO)
      case 'detected': {
        const found = detected.find((info) => info.home === input.home)
        if (!found) return stateOf(stored, detected, deps)
        return accept(await inspectJdk(found.home, 'setting', deps))
      }
      case 'browse':
        if (picked === null) return stateOf(stored, detected, deps)
        return accept(await inspectBrowsed(picked, deps))
      default:
        return stateOf(stored, detected, deps)
    }
  })
}

// ───────────────────────── IPC ─────────────────────────

function defaultJdkDeps(): JdkDeps {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    fs: nodeJdkFs,
    queryRegistry,
    settingsFile: path.join(app.getPath('userData'), 'jdk.json'),
    now: () => Date.now()
  }
}

async function browseJdk(sender: WebContents, title: string): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender)
  const options: Electron.OpenDialogOptions = { title, properties: ['openDirectory'] }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

export function registerJdkIpc(): void {
  ipcMain.handle(IPC.getJdk, () => getJdkState(defaultJdkDeps()))
  ipcMain.handle(IPC.setJdk, (event, choice: unknown) =>
    setJdkChoice(choice, defaultJdkDeps(), (title) => browseJdk(event.sender, title))
  )
}
