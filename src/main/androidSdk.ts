import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { lstat, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import path from 'path'
import { IPC } from '../shared/ipc'
import type { AndroidSdkChoice, AndroidSdkInfo, AndroidSdkState } from '../shared/play'
import { pathApiOf } from './jdk'
import { ensurePlatformJar } from './platformJar'
import { isTrustedRoot } from './projectRoots'
import type { Failure, PlatformResolution } from './sidecar/launch'

// 팀 코드를 컴파일할 Android SDK 찾기(jdk.ts와 같은 구조). 사이드카는 Android Studio처럼 팀 프로젝트 compileSdk의
// 플랫폼 API(platforms/android-N(.M)/android.jar의 Java API, platformJar.ts)로 컴파일한다. SDK는 번들하지 않고 이 PC에
// 있는 것을 쓴다(Android Studio가 설치한다).
// 찾는 순서(Android Gradle 플러그인과 같은 차례): 사용자 설정(userData/android-sdk.json) → 프로젝트 local.properties의
// sdk.dir(열거나 저장한 프로젝트만) → ANDROID_HOME → ANDROID_SDK_ROOT → OS 기본 위치(Windows %LOCALAPPDATA%\Android\Sdk,
// macOS ~/Library/Android/sdk, Linux ~/Android/Sdk). SDK 폴더는 platforms 폴더가 있는 폴더다.
//
// 시험 전용: 환경 변수 SANDBOT_ANDROID_PLATFORM_JAR(파일 경로)가 있으면 SDK를 찾지 않고 그 jar를 그대로 부트 클래스패스로
// 쓴다(API는 SANDBOT_ANDROID_PLATFORM_API, 없으면 compileSdk, 그것도 없으면 0). CI·컨테이너에 Android SDK가 없어서다.

type PathApi = typeof path.posix

// 파일 시스템 접근(테스트에서 가짜 폴더 구조로 바꾼다). 실패는 모두 false·null·[]로 돌려준다.
export type AndroidSdkFs = {
  isFile: (target: string) => Promise<boolean>
  isDirectory: (target: string) => Promise<boolean>
  // 링크가 아닌 보통 파일이고 maxBytes 이하일 때만 내용(UTF-8)
  readSmallText: (target: string, maxBytes: number) => Promise<string | null>
  readdir: (target: string) => Promise<string[]>
  // 링크를 모두 푼 실제 위치
  realpath: (target: string) => Promise<string | null>
}

export const nodeAndroidSdkFs: AndroidSdkFs = {
  isFile: async (target) => (await stat(target).catch(() => null))?.isFile() ?? false,
  isDirectory: async (target) => (await stat(target).catch(() => null))?.isDirectory() ?? false,
  readSmallText: async (target, maxBytes) => {
    const info = await lstat(target).catch(() => null)
    if (!info?.isFile() || info.size > maxBytes) return null
    const bytes = await readFile(target).catch(() => null)
    return bytes && bytes.length <= maxBytes ? bytes.toString('utf8') : null
  },
  readdir: (target) => readdir(target).catch(() => [] as string[]),
  realpath: (target) => realpath(target).catch(() => null)
}

export type AndroidSdkDetectDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  fs: AndroidSdkFs
}

// ───────────────────────── local.properties ─────────────────────────

// local.properties는 Android Studio가 쓰는 작은 파일이다(sdk.dir 한 줄). 이보다 크면 읽지 않는다.
const MAX_PROPERTIES_BYTES = 64 * 1024

// Java .properties 형식(java.util.Properties.load와 같은 규칙): 주석(# !), 키와 값 사이 = : 공백, 줄 끝 \로 다음 줄 이어
// 붙이기(이은 줄의 앞 공백은 버림), 이스케이프 \t \n \r \f \uXXXX와 그 밖의 \x → x(\: \\ \= 등). 같은 키는 뒤의 것.
export function parseProperties(text: string): Map<string, string> {
  const result = new Map<string, string>()
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rawLines = source.split(/\r\n|\r|\n/)
  // 논리 줄로 잇는다(끝의 \ 개수가 홀수면 이어진다)
  const lines: string[] = []
  let current: string | null = null
  for (const raw of rawLines) {
    // 줄 앞 공백은 논리 줄의 첫 줄이든 이어진 줄이든 버린다
    const line = raw.replace(/^[ \t\f]+/, '')
    // 주석과 빈 줄은 논리 줄의 첫 줄일 때만(이어진 줄은 값의 일부)
    if (current === null && (line === '' || line[0] === '#' || line[0] === '!')) continue
    const trailing = /\\*$/.exec(line)?.[0].length ?? 0
    const continued = trailing % 2 === 1
    const body = continued ? line.slice(0, -1) : line
    current = (current ?? '') + body
    if (!continued) {
      lines.push(current)
      current = null
    }
  }
  if (current !== null) lines.push(current)

  for (const line of lines) {
    // 키 끝: 이스케이프되지 않은 = : 또는 공백
    let i = 0
    let key = ''
    while (i < line.length) {
      const c = line[i]
      if (c === '\\' && i + 1 < line.length) {
        key += line.slice(i, i + 2)
        i += 2
        continue
      }
      if (c === '=' || c === ':' || c === ' ' || c === '\t' || c === '\f') break
      key += c
      i++
    }
    // 구분자: 공백들, 그다음 = 또는 : 하나, 다시 공백들
    while (i < line.length && /[ \t\f]/.test(line[i])) i++
    if (i < line.length && (line[i] === '=' || line[i] === ':')) i++
    while (i < line.length && /[ \t\f]/.test(line[i])) i++
    result.set(unescapeProperty(key), unescapeProperty(line.slice(i)))
  }
  return result
}

function unescapeProperty(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== '\\' || i + 1 >= text.length) {
      out += c
      continue
    }
    const next = text[++i]
    switch (next) {
      case 't':
        out += '\t'
        break
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 'f':
        out += '\f'
        break
      case 'u': {
        const hex = text.slice(i + 1, i + 5)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else {
          // java.util.Properties는 잘못된 \u에 예외를 던진다. 그 값은 쓰지 않도록 글자를 남긴다(절대 경로가 아니게 된다).
          out += '\\u'
        }
        break
      }
      default:
        out += next
    }
  }
  return out
}

// local.properties의 sdk.dir(절대 경로만, 따옴표·끝의 구분자 정리). 없거나 상대 경로면 null.
export function localPropertiesSdkDir(text: string, platform: NodeJS.Platform): string | null {
  const value = parseProperties(text).get('sdk.dir')?.trim()
  if (!value) return null
  const api = pathApiOf(platform)
  const unquoted = stripQuotes(value)
  if (!api.isAbsolute(unquoted)) return null
  return trimSeparators(api.normalize(unquoted), api)
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed
}

// 끝의 / \는 뗀다(루트 'C:\'·'/'는 그대로)
function trimSeparators(value: string, api: PathApi): string {
  const trimmed = value.replace(/[\\/]+$/, '')
  return trimmed === '' || api.parse(value).root === value ? value : trimmed
}

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return env[name] ?? ''
  // Windows 환경 변수 이름은 대소문자를 구분하지 않는다
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key ? (env[key] ?? '') : ''
}

// ───────────────────────── SDK 폴더 확인 ─────────────────────────

// 플랫폼 폴더 이름: android-N(API 수준) 또는 부 버전이 붙은 android-N.M. Google은 API 36부터 부 버전 플랫폼(android-36.1)을
// 내고, API 37부터는 부 버전이 없는 플랫폼도 .0을 붙여 낸다(platforms;android-37.0, android-37은 없음). 미리보기
// (android-VanillaIceCream, android-37.2-beta1)·확장(android-34-ext7)·앞에 0이 붙은 이름은 무시한다.
const PLATFORM_NAME = /^android-([1-9]\d{0,3})(?:\.(0|[1-9]\d{0,2}))?$/

// 폴더 이름의 버전(api는 주 버전, minor는 부 버전이고 android-N이면 null). 플랫폼 폴더 이름이 아니면 null.
function platformVersion(name: string): { api: number; minor: number | null } | null {
  const match = PLATFORM_NAME.exec(name)
  if (!match) return null
  return { api: Number(match[1]), minor: match[2] === undefined ? null : Number(match[2]) }
}

// platforms 아래 android.jar가 있는 플랫폼 폴더 이름(android-30, android-36.1 …). 주 버전 → 부 버전 순이고 android-N은
// android-N.0 앞이다(이름마다 버전이 하나라 순서가 늘 같다).
export async function installedPlatforms(
  home: string,
  deps: Pick<AndroidSdkDetectDeps, 'platform' | 'fs'>
): Promise<string[]> {
  const api = pathApiOf(deps.platform)
  const dir = api.join(home, 'platforms')
  const found: { name: string; api: number; minor: number }[] = []
  for (const name of await deps.fs.readdir(dir)) {
    const version = platformVersion(name)
    if (!version) continue
    if (await deps.fs.isFile(api.join(dir, name, 'android.jar')))
      found.push({ name, api: version.api, minor: version.minor ?? -1 })
  }
  return found.sort((a, b) => a.api - b.api || a.minor - b.minor).map((entry) => entry.name)
}

// compileSdk N의 플랫폼 폴더: android-N, 없으면 android-N.0(Android Gradle 플러그인은 API 37부터 compileSdk N을
// android-N.0으로 찾는다). android-36.1 같은 부 버전은 compileSdk의 minorApiLevel로만 고르므로 compileSdk 36이 아니다.
function compileSdkPlatform(platforms: string[], compileSdk: number): string | null {
  return (
    [`android-${compileSdk}`, `android-${compileSdk}.0`].find((name) => platforms.includes(name)) ??
    null
  )
}

export function platformJarPath(home: string, name: string, platform: NodeJS.Platform): string {
  return pathApiOf(platform).join(home, 'platforms', name, 'android.jar')
}

// home이 Android SDK 폴더(platforms 폴더가 있음)면 그 정보, 아니면 null
export async function inspectAndroidSdk(
  home: string,
  source: AndroidSdkInfo['source'],
  deps: Pick<AndroidSdkDetectDeps, 'platform' | 'fs'>
): Promise<AndroidSdkInfo | null> {
  const api = pathApiOf(deps.platform)
  if (!home || home.length > 4096 || !api.isAbsolute(home)) return null
  if (!(await deps.fs.isDirectory(api.join(home, 'platforms')))) return null
  return { home, platforms: await installedPlatforms(home, deps), source }
}

// 자동으로 찾는 후보(우선순위 순, 확인 전). root는 확인된 프로젝트 루트(없으면 local.properties를 보지 않는다).
export async function androidSdkCandidates(
  deps: AndroidSdkDetectDeps,
  root: string | null
): Promise<[AndroidSdkInfo['source'], string][]> {
  const api = pathApiOf(deps.platform)
  const candidates: [AndroidSdkInfo['source'], string][] = []
  if (root) {
    const text = await deps.fs.readSmallText(
      api.join(root, 'local.properties'),
      MAX_PROPERTIES_BYTES
    )
    const dir = text === null ? null : localPropertiesSdkDir(text, deps.platform)
    if (dir) candidates.push(['localProperties', dir])
  }
  for (const name of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const value = stripQuotes(envValue(deps.env, name, deps.platform))
    if (value && api.isAbsolute(value))
      candidates.push(['env', trimSeparators(api.normalize(value), api)])
  }
  if (deps.platform === 'win32') {
    const local = stripQuotes(envValue(deps.env, 'LOCALAPPDATA', deps.platform))
    if (local && api.isAbsolute(local))
      candidates.push(['default', api.join(local, 'Android', 'Sdk')])
  } else if (deps.platform === 'darwin') {
    candidates.push(['default', api.join(deps.home, 'Library', 'Android', 'sdk')])
  } else {
    candidates.push(['default', api.join(deps.home, 'Android', 'Sdk')])
  }
  return candidates
}

// 이 PC의 Android SDK들(우선순위 순). 같은 폴더(링크를 푼 위치가 같음)는 한 번만.
export async function detectAndroidSdks(
  deps: AndroidSdkDetectDeps,
  root: string | null
): Promise<AndroidSdkInfo[]> {
  const seen = new Set<string>()
  const found: AndroidSdkInfo[] = []
  for (const [source, home] of await androidSdkCandidates(deps, root)) {
    const real = (await deps.fs.realpath(home)) ?? home
    const key = deps.platform === 'win32' ? real.toLowerCase() : real
    if (seen.has(key)) continue
    const info = await inspectAndroidSdk(home, source, deps)
    if (!info) continue
    seen.add(key)
    found.push(info)
  }
  return found
}

// ───────────────────────── 설정과 상태 ─────────────────────────

export type StoredAndroidSdk = { kind: 'auto' } | { kind: 'custom'; home: string }

const AUTO: StoredAndroidSdk = { kind: 'auto' }

export function parseStoredAndroidSdk(text: string): StoredAndroidSdk {
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

export async function readAndroidSdkSettings(file: string): Promise<StoredAndroidSdk> {
  try {
    return parseStoredAndroidSdk(await readFile(file, 'utf8'))
  } catch {
    return AUTO
  }
}

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

// 쓰는 도중 꺼져도 이전 설정이 깨지지 않게 임시 파일에 쓴 뒤 바꿔 끼운다(jdk.ts와 같은 방식)
export async function writeAndroidSdkSettings(
  file: string,
  value: StoredAndroidSdk
): Promise<void> {
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

export type AndroidSdkDeps = AndroidSdkDetectDeps & {
  settingsFile: string
  // 컴파일 기준 jar를 두는 폴더(userData/platform-cache)
  cacheDir: string
}

// 실행에 쓸 SDK. 고른 폴더는 매번 다시 확인한다(지웠거나 옮겼을 수 있다). 고른 폴더를 쓸 수 없으면 자동으로 넘어가지 않는다.
async function activeOf(
  stored: StoredAndroidSdk,
  detected: AndroidSdkInfo[],
  deps: AndroidSdkDeps
): Promise<AndroidSdkInfo | null> {
  if (stored.kind === 'custom') return inspectAndroidSdk(stored.home, 'setting', deps)
  return detected[0] ?? null
}

async function stateOf(
  stored: StoredAndroidSdk,
  detected: AndroidSdkInfo[],
  deps: AndroidSdkDeps,
  error?: AndroidSdkState['error']
): Promise<AndroidSdkState> {
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

// root는 확인된 프로젝트 루트(아니면 null)
export async function getAndroidSdkState(
  root: string | null,
  deps: AndroidSdkDeps
): Promise<AndroidSdkState> {
  const detected = await detectAndroidSdks(deps, root)
  const stored = await serialized(() => readAndroidSdkSettings(deps.settingsFile))
  return stateOf(stored, detected, deps)
}

// 실행에 쓸 SDK(없으면 null)
export async function resolveActiveAndroidSdk(
  root: string | null,
  deps: AndroidSdkDeps
): Promise<AndroidSdkInfo | null> {
  const stored = await serialized(() => readAndroidSdkSettings(deps.settingsFile))
  return activeOf(stored, stored.kind === 'auto' ? await detectAndroidSdks(deps, root) : [], deps)
}

// 찾아보기로 고른 폴더. platforms 폴더나 platforms/android-N(.M) 폴더를 골랐으면 그 위의 SDK 폴더를 본다.
async function inspectBrowsed(
  picked: string,
  deps: AndroidSdkDeps
): Promise<AndroidSdkInfo | null> {
  const api = pathApiOf(deps.platform)
  const candidates = [picked]
  const parent = api.dirname(picked)
  if (api.basename(picked).toLowerCase() === 'platforms') candidates.push(parent)
  if (api.basename(parent).toLowerCase() === 'platforms') candidates.push(api.dirname(parent))
  for (const home of candidates) {
    const info = await inspectAndroidSdk(home, 'setting', deps)
    if (info) return info
  }
  return null
}

// 렌더러가 보낸 선택(믿지 않는 입력)을 확인해 설정을 바꾼다. 받지 않으면 설정은 그대로 두고 error를 붙인다.
// detected는 이번에 찾은 목록에 있는 폴더만 받는다(렌더러가 아무 폴더나 넘기지 못하게, 찾아보기는 대화상자로만).
export async function setAndroidSdkChoice(
  choice: unknown,
  root: string | null,
  deps: AndroidSdkDeps,
  browse: (title: string) => Promise<string | null>
): Promise<AndroidSdkState> {
  const input = (typeof choice === 'object' && choice !== null ? choice : {}) as Record<
    string,
    unknown
  >
  const kind = input.kind as AndroidSdkChoice['kind'] | undefined
  // 대화상자는 설정 차례 밖에서 띄운다(고르는 동안 다른 설정 읽기를 막지 않게)
  const picked =
    kind === 'browse'
      ? await browse(typeof input.title === 'string' ? input.title.slice(0, 200) : '')
      : null
  const detected = await detectAndroidSdks(deps, root)
  return serialized(async () => {
    const stored = await readAndroidSdkSettings(deps.settingsFile)
    const save = async (next: StoredAndroidSdk): Promise<AndroidSdkState> => {
      await writeAndroidSdkSettings(deps.settingsFile, next)
      return stateOf(next, detected, deps)
    }
    switch (kind) {
      case 'auto':
        return save(AUTO)
      case 'detected': {
        const found = detected.find((info) => info.home === input.home)
        if (!found) return stateOf(stored, detected, deps)
        const info = await inspectAndroidSdk(found.home, 'setting', deps)
        return info ? save({ kind: 'custom', home: info.home }) : stateOf(stored, detected, deps)
      }
      case 'browse': {
        if (picked === null) return stateOf(stored, detected, deps)
        const info = await inspectBrowsed(picked, deps)
        if (!info) return stateOf(stored, detected, deps, 'notSdk')
        return save({ kind: 'custom', home: info.home })
      }
      default:
        return stateOf(stored, detected, deps)
    }
  })
}

// ───────────────────────── 컴파일 기준(플랫폼 jar) ─────────────────────────

// 시험 전용 덮어쓰기(위 머리말). 값이 없으면 null.
export async function platformOverride(
  env: NodeJS.ProcessEnv,
  compileSdk: number | null,
  fs: Pick<AndroidSdkFs, 'isFile'>
): Promise<PlatformResolution | Failure | null> {
  const jar = env.SANDBOT_ANDROID_PLATFORM_JAR
  if (!jar) return null
  if (!path.isAbsolute(jar) || !(await fs.isFile(jar)))
    return {
      ok: false,
      code: 'failed',
      detail: `SANDBOT_ANDROID_PLATFORM_JAR is not a file: ${jar}`
    }
  const level = Number(env.SANDBOT_ANDROID_PLATFORM_API)
  const api =
    env.SANDBOT_ANDROID_PLATFORM_API && Number.isSafeInteger(level) && level >= 0
      ? level
      : (compileSdk ?? 0)
  return { ok: true, bootClasspath: [jar], api, guessed: false }
}

// 팀 프로젝트 compileSdk의 컴파일 기준. SDK가 없으면(고른 폴더를 쓸 수 없게 된 것 포함) noAndroidSdk, 그 플랫폼이 없으면
// noAndroidPlatform(detail 'android-N'). compileSdk를 모르면(Gradle에서 읽지 못함) 설치된 가장 높은 플랫폼(부 버전 포함)을
// 쓰고 guessed. api는 고른 플랫폼의 주 버전이다. projectRoot는 controller가 확인한 프로젝트 루트다(local.properties를 본다).
export async function resolveAndroidPlatform(
  projectRoot: string,
  compileSdk: number | null,
  deps: AndroidSdkDeps = defaultAndroidSdkDeps()
): Promise<PlatformResolution | Failure> {
  const override = await platformOverride(deps.env, compileSdk, deps.fs)
  if (override) return override
  const sdk = await resolveActiveAndroidSdk(isTrustedRoot(projectRoot) ? projectRoot : null, deps)
  if (!sdk) return { ok: false, code: 'noAndroidSdk', detail: '' }
  const name =
    compileSdk === null
      ? (sdk.platforms[sdk.platforms.length - 1] ?? null)
      : compileSdkPlatform(sdk.platforms, compileSdk)
  const version = name === null ? null : platformVersion(name)
  if (name === null || !version)
    return {
      ok: false,
      code: 'noAndroidPlatform',
      detail: compileSdk === null ? 'android-*' : `android-${compileSdk}`
    }
  const androidJar = platformJarPath(sdk.home, name, deps.platform)
  try {
    const jar = await ensurePlatformJar(androidJar, deps.cacheDir)
    return { ok: true, bootClasspath: [jar], api: version.api, guessed: compileSdk === null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: 'failed',
      detail: `cannot read the Android platform ${name} (${androidJar}): ${message}`
    }
  }
}

// ───────────────────────── IPC ─────────────────────────

export function defaultAndroidSdkDeps(): AndroidSdkDeps {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    fs: nodeAndroidSdkFs,
    settingsFile: path.join(app.getPath('userData'), 'android-sdk.json'),
    cacheDir: path.join(app.getPath('userData'), 'platform-cache')
  }
}

async function browseAndroidSdk(sender: WebContents, title: string): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender)
  const options: Electron.OpenDialogOptions = { title, properties: ['openDirectory'] }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

// 렌더러가 넘긴 root는 열거나 저장한 프로젝트일 때만 쓴다(그 프로젝트의 local.properties를 본다)
function trustedRootOrNull(root: unknown): string | null {
  return isTrustedRoot(root) ? path.resolve(root) : null
}

export function registerAndroidSdkIpc(): void {
  ipcMain.handle(IPC.getAndroidSdk, (_event, root: unknown) =>
    getAndroidSdkState(trustedRootOrNull(root), defaultAndroidSdkDeps())
  )
  ipcMain.handle(IPC.setAndroidSdk, (event, choice: unknown, root: unknown) =>
    setAndroidSdkChoice(choice, trustedRootOrNull(root), defaultAndroidSdkDeps(), (title) =>
      browseAndroidSdk(event.sender, title)
    )
  )
}
