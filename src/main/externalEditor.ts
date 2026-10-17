import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { constants } from 'fs'
import { access, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { extname, join, posix, win32 } from 'path'
import {
  IPC,
  type DetectedEditor,
  type ExternalEditorChoice,
  type ExternalEditorError,
  type ExternalEditorState,
  type OpenJavaFileResult
} from '../shared/ipc'

// 외부 스크립트 편집기(Unity Preferences > External Tools > External Script Editor).
// 설정은 실행 파일 경로를 담으므로 렌더러 localStorage가 아니라 메인 프로세스가 userData에 갖는다.
// 렌더러는 편집기를 고르기만 하고 경로를 보내지 않는다(렌더러가 잘못돼도 아무 프로그램이나 실행하지 못하게).
// 실행은 셸 없이 실행 파일을 직접 띄운다. Windows에서 .bat·.cmd는 셸이 있어야 실행되므로(CVE-2024-27980 뒤로
// Node가 거부한다) .exe만 받는다.

// ───────────────────────── 편집기 종류와 인자 템플릿 ─────────────────────────

// jetbrains: Android Studio·IntelliJ IDEA(같은 명령줄), vscode: Visual Studio Code
export type EditorFamily = 'jetbrains' | 'vscode'

// name은 제품 이름이라 번역하지 않는다. id는 설정 파일에 저장하므로 바꾸지 않는다.
export const EDITOR_PRODUCTS = [
  { id: 'android-studio', name: 'Android Studio', family: 'jetbrains' },
  { id: 'intellij-idea', name: 'IntelliJ IDEA', family: 'jetbrains' },
  { id: 'vscode', name: 'Visual Studio Code', family: 'vscode' }
] as const satisfies readonly { id: string; name: string; family: EditorFamily }[]

export type EditorProductId = (typeof EDITOR_PRODUCTS)[number]['id']

function productOf(id: string): (typeof EDITOR_PRODUCTS)[number] | undefined {
  return EDITOR_PRODUCTS.find((product) => product.id === id)
}

// 찾아보기로 고른 편집기의 기본 인자(Unity와 같음)
export const DEFAULT_CUSTOM_ARGS = '"$(File)"'

// 찾은 편집기의 인자. 줄 번호가 없으면 줄 인자를 뺀다.
// - JetBrains: 프로젝트 폴더를 먼저 넘긴다. 파일만 넘기면 그 파일이 든 프로젝트가 열려 있지 않을 때 LightEdit 모드로 연다.
//   열은 넘기지 않는다(--column의 기준이 편집기 버전마다 다르다).
// - VS Code: -g 파일:줄
export function presetArgs(family: EditorFamily, hasLine: boolean): string {
  if (!hasLine) return '"$(ProjectPath)" "$(File)"'
  return family === 'jetbrains'
    ? '"$(ProjectPath)" --line $(Line) "$(File)"'
    : '"$(ProjectPath)" -g "$(File)":$(Line)'
}

export const MAX_ARGS_LENGTH = 1000

export type ArgsTemplateError = 'tooLong' | 'invalidChar' | 'unclosedQuote' | 'noFile'

// 인자 템플릿을 셸 없이 나눈다. 공백·탭이 인자를 나누고, 큰따옴표 안의 공백은 인자에 남는다. 따옴표는 지우고
// 붙어 있는 부분은 이어 붙인다("$(File)":$(Line) → 한 인자). 백슬래시는 이스케이프가 아니다(Windows 경로).
// 변수는 나눈 뒤에 인자 안에서 바꾸므로 경로에 공백·따옴표가 있어도 인자가 갈라지지 않는다.
export function parseArgsTemplate(
  template: string
): { ok: true; tokens: string[] } | { ok: false; error: ArgsTemplateError } {
  if (typeof template !== 'string' || template.length > MAX_ARGS_LENGTH)
    return { ok: false, error: 'tooLong' }
  if (/[\0\r\n]/.test(template)) return { ok: false, error: 'invalidChar' }
  const tokens: string[] = []
  let current = ''
  let started = false
  let quoted = false
  for (const ch of template) {
    if (ch === '"') {
      quoted = !quoted
      started = true
    } else if (!quoted && (ch === ' ' || ch === '\t')) {
      if (started) tokens.push(current)
      current = ''
      started = false
    } else {
      current += ch
      started = true
    }
  }
  if (quoted) return { ok: false, error: 'unclosedQuote' }
  if (started) tokens.push(current)
  if (!tokens.some((token) => token.includes('$(File)'))) return { ok: false, error: 'noFile' }
  return { ok: true, tokens }
}

// 셸 없이 실행해도 되는 실행 파일인지. Windows는 .exe만 받는다(.bat·.cmd는 셸이 필요하고, .lnk·.ps1은 실행 파일이
// 아니다). 다른 OS는 실행 권한으로 판단하지만(studio.sh 같은 스크립트도 셸 없이 실행된다) Windows용 파일은 받지 않는다.
const REFUSED_EXTENSIONS = new Set(['.bat', '.cmd', '.lnk', '.ps1'])

export function isLaunchableExePath(exe: string, platform: NodeJS.Platform): boolean {
  if (typeof exe !== 'string' || !exe || /[\0\r\n]/.test(exe)) return false
  if (platform === 'win32')
    return win32.isAbsolute(exe) && win32.extname(exe).toLowerCase() === '.exe'
  return posix.isAbsolute(exe) && !REFUSED_EXTENSIONS.has(posix.extname(exe).toLowerCase())
}

export type EditorTarget = {
  file: string
  // 1부터. 없으면 템플릿의 $(Line)·$(Column)은 1이 된다.
  line?: number
  column?: number
  projectPath: string
}

export type EditorCommand =
  | { ok: true; exe: string; argv: string[] }
  | { ok: false; error: ArgsTemplateError | 'unsupportedExe' }

// 실행할 명령(실행 파일 + 인자 배열). 셸을 거치지 않으므로 경로가 명령으로 해석되지 않는다.
export function buildEditorCommand(
  editor: { exe: string; args: string },
  target: EditorTarget,
  platform: NodeJS.Platform = process.platform
): EditorCommand {
  if (!isLaunchableExePath(editor.exe, platform)) return { ok: false, error: 'unsupportedExe' }
  const parsed = parseArgsTemplate(editor.args)
  if (!parsed.ok) return parsed
  const values: Record<string, string> = {
    File: target.file,
    Line: String(target.line ?? 1),
    Column: String(target.column ?? 1),
    ProjectPath: target.projectPath
  }
  // 바꿀 값에 $&·$1 같은 글자가 있어도 그대로 넣도록 함수로 바꾼다
  const argv = parsed.tokens.map((token) =>
    token.replace(/\$\((File|Line|Column|ProjectPath)\)/g, (_, name: string) => values[name])
  )
  return { ok: true, exe: editor.exe, argv }
}

// ───────────────────────── 설정 파일 ─────────────────────────

export type StoredEditor =
  | { kind: 'system' }
  | { kind: 'detected'; id: EditorProductId; exe: string }
  | { kind: 'custom'; exe: string; args: string }

const SYSTEM: StoredEditor = { kind: 'system' }

// 깨졌거나 알 수 없는 내용이면 system(확장자로 열기)으로 돌아간다
export function parseStoredEditor(text: string): StoredEditor {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return SYSTEM
  }
  if (typeof value !== 'object' || value === null) return SYSTEM
  const data = value as Record<string, unknown>
  const isText = (field: unknown): field is string => typeof field === 'string' && field !== ''
  if (data.kind === 'detected' && typeof data.id === 'string' && isText(data.exe)) {
    const product = productOf(data.id)
    if (product) return { kind: 'detected', id: product.id, exe: data.exe }
  }
  if (
    data.kind === 'custom' &&
    isText(data.exe) &&
    typeof data.args === 'string' &&
    data.args.length <= MAX_ARGS_LENGTH
  ) {
    return { kind: 'custom', exe: data.exe, args: data.args }
  }
  return SYSTEM
}

export async function readEditorSettings(file: string): Promise<StoredEditor> {
  try {
    return parseStoredEditor(await readFile(file, 'utf8'))
  } catch {
    return SYSTEM
  }
}

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

// 쓰는 도중 꺼져도 이전 설정이 깨지지 않게 임시 파일에 쓴 뒤 바꿔 끼운다. Windows는 백신·색인기가 파일을 잡고 있으면
// 바꿔 끼우기가 잠깐 실패하므로 몇 번 다시 한다.
export async function writeEditorSettings(file: string, value: StoredEditor): Promise<void> {
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

// ───────────────────────── 편집기 찾기 ─────────────────────────

export type UninstallEntry = { displayName: string; installLocation?: string; displayIcon?: string }

// 프로그램 추가/제거 목록(Uninstall 키). HKCU는 사용자 설치(VS Code User 등), WOW6432Node는 32비트 설치 프로그램.
const UNINSTALL_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

// %VAR%를 환경 변수로 바꾼다(REG_EXPAND_SZ). Windows 환경 변수 이름은 대소문자를 구분하지 않는다.
export function expandWindowsEnv(value: string, env: NodeJS.ProcessEnv): string {
  const lookup = new Map(Object.entries(env).map(([name, v]) => [name.toUpperCase(), v]))
  return value.replace(
    /%([^%]+)%/g,
    (whole, name: string) => lookup.get(name.toUpperCase()) ?? whole
  )
}

// `reg query <키> /s` 출력. 키 줄(HKEY_…) 다음에 값 줄("    이름    REG_형식    데이터")이 온다.
// 이름에 공백이 있을 수 있으므로(Inno Setup: Setup Version) 네 칸 공백과 REG_ 형식으로 나눈다.
export function parseUninstallEntries(output: string, env: NodeJS.ProcessEnv): UninstallEntry[] {
  const entries: UninstallEntry[] = []
  let values: Map<string, string> | null = null
  const flush = (): void => {
    const displayName = values?.get('displayname')
    if (values && displayName) {
      entries.push({
        displayName,
        installLocation: values.get('installlocation'),
        displayIcon: values.get('displayicon')
      })
    }
  }
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      flush()
      values = new Map()
      continue
    }
    const match = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line)
    if (!match || !values) continue
    const [, name, type, data = ''] = match
    if (type !== 'REG_SZ' && type !== 'REG_EXPAND_SZ') continue
    values.set(name.toLowerCase(), type === 'REG_EXPAND_SZ' ? expandWindowsEnv(data, env) : data)
  }
  flush()
  return entries
}

type Candidate = { id: EditorProductId; exe: string }

// Windows 편집기의 실행 파일(설치 폴더 기준)과 DisplayName 규칙
const WINDOWS_PRODUCTS: { id: EditorProductId; displayName: RegExp; exe: string[] }[] = [
  { id: 'android-studio', displayName: /^Android Studio\b/i, exe: ['bin', 'studio64.exe'] },
  { id: 'intellij-idea', displayName: /^IntelliJ IDEA\b/i, exe: ['bin', 'idea64.exe'] },
  // Insiders는 실행 파일 이름이 다르다(Code - Insiders.exe)
  {
    id: 'vscode',
    displayName: /^Microsoft Visual Studio Code\b(?!.*Insiders)/i,
    exe: ['Code.exe']
  }
]

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed
}

// 레지스트리 항목에서 찾은 실행 파일 후보. InstallLocation 아래 실행 파일, 없으면 DisplayIcon("…\studio64.exe",0)이
// 같은 실행 파일을 가리킬 때 그 경로를 쓴다.
export function registryCandidates(entries: UninstallEntry[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const entry of entries) {
    const product = WINDOWS_PRODUCTS.find((p) => p.displayName.test(entry.displayName))
    if (!product) continue
    const location = entry.installLocation && stripQuotes(entry.installLocation)
    if (location && win32.isAbsolute(location))
      candidates.push({ id: product.id, exe: win32.join(location, ...product.exe) })
    const icon = entry.displayIcon && stripQuotes(entry.displayIcon.replace(/,\s*-?\d+$/, ''))
    const exeName = product.exe[product.exe.length - 1].toLowerCase()
    if (icon && win32.isAbsolute(icon) && win32.basename(icon).toLowerCase() === exeName)
      candidates.push({ id: product.id, exe: icon })
  }
  return candidates
}

// 설치 프로그램의 기본 위치. 레지스트리에 없거나 읽지 못했을 때 쓴다.
export function wellKnownCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string
): Candidate[] {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA
    const programFiles = env.ProgramFiles ?? env.PROGRAMFILES
    const under = (base: string | undefined, ...parts: string[]): string[] =>
      base && win32.isAbsolute(base) ? [win32.join(base, ...parts)] : []
    return [
      ...under(local, 'Programs', 'Android Studio', 'bin', 'studio64.exe'),
      ...under(programFiles, 'Android', 'Android Studio', 'bin', 'studio64.exe')
    ]
      .map((exe): Candidate => ({ id: 'android-studio', exe }))
      .concat(
        // JetBrains Toolbox App 2는 %LOCALAPPDATA%\Programs에 설치한다
        [
          ...under(local, 'Programs', 'IntelliJ IDEA Ultimate', 'bin', 'idea64.exe'),
          ...under(local, 'Programs', 'IntelliJ IDEA Community Edition', 'bin', 'idea64.exe')
        ].map((exe): Candidate => ({ id: 'intellij-idea', exe })),
        [
          ...under(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
          ...under(programFiles, 'Microsoft VS Code', 'Code.exe')
        ].map((exe): Candidate => ({ id: 'vscode', exe }))
      )
  }
  if (platform === 'darwin') {
    const apps = ['/Applications', posix.join(home, 'Applications')]
    const inApps = (id: EditorProductId, ...paths: string[]): Candidate[] =>
      apps.flatMap((dir) => paths.map((path) => ({ id, exe: posix.join(dir, path) })))
    return [
      ...inApps('android-studio', 'Android Studio.app/Contents/MacOS/studio'),
      ...inApps(
        'intellij-idea',
        'IntelliJ IDEA.app/Contents/MacOS/idea',
        'IntelliJ IDEA CE.app/Contents/MacOS/idea',
        'IntelliJ IDEA Ultimate.app/Contents/MacOS/idea'
      ),
      ...inApps('vscode', 'Visual Studio Code.app/Contents/Resources/app/bin/code')
    ]
  }
  // Linux 등: 실행 스크립트(studio.sh)도 셸 없이 실행된다
  const toolbox = posix.join(home, '.local/share/JetBrains/Toolbox/scripts')
  return [
    ...[
      '/opt/android-studio/bin/studio.sh',
      posix.join(home, 'android-studio/bin/studio.sh'),
      '/usr/local/android-studio/bin/studio.sh',
      '/snap/bin/android-studio',
      posix.join(toolbox, 'studio')
    ].map((exe): Candidate => ({ id: 'android-studio', exe })),
    ...[
      '/snap/bin/intellij-idea-community',
      '/snap/bin/intellij-idea-ultimate',
      '/opt/idea/bin/idea.sh',
      posix.join(toolbox, 'idea')
    ].map((exe): Candidate => ({ id: 'intellij-idea', exe })),
    ...['/usr/bin/code', '/snap/bin/code'].map((exe): Candidate => ({ id: 'vscode', exe }))
  ]
}

export type DetectDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  isExecutable: (path: string) => Promise<boolean>
  // `reg query <키> /s`의 표준 출력. 실패하면 빈 문자열.
  queryRegistry: (key: string) => Promise<string>
}

// 이 PC에 있는 편집기. 종류마다 처음 찾은 실행 파일 하나(레지스트리 → 기본 위치 순).
export async function detectEditors(deps: DetectDeps): Promise<DetectedEditor[]> {
  const candidates: Candidate[] = []
  if (deps.platform === 'win32') {
    for (const key of UNINSTALL_KEYS) {
      const output = await deps.queryRegistry(key)
      candidates.push(...registryCandidates(parseUninstallEntries(output, deps.env)))
    }
  }
  candidates.push(...wellKnownCandidates(deps.platform, deps.env, deps.home))
  const found = new Map<EditorProductId, string>()
  const checked = new Set<string>()
  for (const { id, exe } of candidates) {
    if (found.has(id) || !isLaunchableExePath(exe, deps.platform)) continue
    const key = deps.platform === 'win32' ? exe.toLowerCase() : exe
    if (checked.has(key)) continue
    checked.add(key)
    if (await deps.isExecutable(exe)) found.set(id, exe)
  }
  return EDITOR_PRODUCTS.flatMap(({ id, name }) => {
    const exe = found.get(id)
    return exe ? [{ id, name, exe }] : []
  })
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    if (process.platform !== 'win32') await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// 콘솔 코드 페이지 → TextDecoder 이름. 한국어 Windows의 OEM 코드 페이지는 949다(WHATWG의 euc-kr이 CP949를 담는다).
const CODE_PAGE_LABELS: Record<number, string> = {
  437: 'ibm866',
  866: 'ibm866',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  65001: 'utf-8'
}

// reg.exe 출력 바이트를 문자열로. 파이프로 받으면 OEM 코드 페이지로 쓰므로 UTF-8로 읽으면 한글 경로가 깨진다.
export function decodeConsoleOutput(bytes: Uint8Array, codePage: number | null): string {
  const label =
    codePage === null
      ? 'utf-8'
      : (CODE_PAGE_LABELS[codePage] ??
        (codePage >= 1250 && codePage <= 1258 ? `windows-${codePage}` : 'utf-8'))
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

// `reg query ...\CodePage /v OEMCP` 출력에서 코드 페이지 번호(숫자라 어느 코드 페이지로 읽어도 같다)
export function parseOemCodePage(output: string): number | null {
  const match = /OEMCP\s+REG_SZ\s+(\d+)/i.exec(output)
  return match ? Number(match[1]) : null
}

function runReg(args: string[]): Promise<Buffer | null> {
  // reg.exe는 PATH가 아니라 시스템 폴더에서 찾는다(현재 폴더의 reg.exe를 실행하지 않게). 콘솔 프로그램이라 창을 숨긴다.
  const reg = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
  return new Promise((resolve) => {
    execFile(
      reg,
      args,
      {
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'buffer'
      },
      (error, stdout) => resolve(error ? null : stdout)
    )
  })
}

let oemCodePage: Promise<number | null> | null = null

function consoleCodePage(): Promise<number | null> {
  oemCodePage ??= runReg([
    'query',
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage',
    '/v',
    'OEMCP'
  ]).then((out) => (out ? parseOemCodePage(out.toString('latin1')) : null))
  return oemCodePage
}

async function queryRegistry(key: string): Promise<string> {
  const [out, codePage] = await Promise.all([runReg(['query', key, '/s']), consoleCodePage()])
  return out ? decodeConsoleOutput(out, codePage) : ''
}

function defaultDetectDeps(): DetectDeps {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    isExecutable: isExecutableFile,
    queryRegistry
  }
}

// ───────────────────────── 실행 ─────────────────────────

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

// 편집기에 넘기지 않는 환경 변수. ELECTRON_RUN_AS_NODE가 있으면 VS Code(Electron 앱)가 편집기 대신 Node로 뜨고,
// NODE_OPTIONS는 Node·Electron 프로그램에 코드를 넣을 수 있다.
const DROPPED_ENV = new Set(['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'])

export function editorEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !DROPPED_ENV.has(name.toUpperCase()))
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 셸 없이 띄우고 SandBot과 떼어 놓는다(SandBot을 닫아도 편집기는 남는다). windowsHide는 쓰지 않는다(GUI 프로그램의
// 첫 창까지 숨긴다). 'spawn'이면 성공, 'error'(실행 파일 없음 등)면 실패다.
export function launchEditorProcess(
  command: { exe: string; argv: string[] },
  cwd: string,
  spawnFn: SpawnFn = spawn,
  env: NodeJS.ProcessEnv = process.env
): Promise<OpenJavaFileResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawnFn(command.exe, command.argv, {
        shell: false,
        detached: true,
        stdio: 'ignore',
        cwd,
        env: editorEnv(env)
      })
    } catch (error) {
      resolve({ ok: false, code: 'launchFailed', detail: errorText(error) })
      return
    }
    // 'error' 처리기는 떼지 않는다(나중에 오는 오류가 처리되지 않으면 메인 프로세스가 죽는다)
    child.on('error', (error) =>
      resolve({ ok: false, code: 'launchFailed', detail: errorText(error) })
    )
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}

export type EditorDeps = {
  settingsFile: string
  platform: NodeJS.Platform
  spawn: SpawnFn
  openPath: (path: string) => Promise<string>
  isExecutable: (path: string) => Promise<boolean>
  detect: () => Promise<DetectedEditor[]>
}

// 설정 읽기·쓰기는 차례로 한다(동시에 고르면 임시 파일이 겹친다)
let settingsQueue: Promise<unknown> = Promise.resolve()

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = settingsQueue.then(work, work)
  settingsQueue = result.catch(() => undefined)
  return result
}

// 마지막으로 찾은 편집기(설정 창을 열 때마다 새로 찾는다)
let lastDetected: DetectedEditor[] | null = null

async function detectFresh(deps: EditorDeps): Promise<DetectedEditor[]> {
  lastDetected = await deps.detect()
  return lastDetected
}

// file은 확인을 마친 TeamCode의 .java 절대 경로(teamCodeJava.ts), projectRoot는 프로젝트 폴더.
export async function openInExternalEditor(
  file: string,
  projectRoot: string,
  line: number | undefined,
  deps: EditorDeps = defaultEditorDeps()
): Promise<OpenJavaFileResult> {
  const settings = await serialized(() => readEditorSettings(deps.settingsFile))
  if (settings.kind === 'system') {
    // 연결된 앱으로 연다. 확장자가 .java가 아니면 실행 파일이 실행될 수 있으므로 열지 않는다.
    if (extname(file) !== '.java')
      return { ok: false, code: 'notAllowed', detail: 'not a .java file' }
    const error = await deps.openPath(file)
    return error ? { ok: false, code: 'openFailed', detail: error } : { ok: true }
  }

  let exe = settings.exe
  let args: string
  if (settings.kind === 'detected') {
    const product = productOf(settings.id)
    if (!product)
      return { ok: false, code: 'launchFailed', detail: `unknown editor ${settings.id}` }
    if (!(await deps.isExecutable(exe))) {
      // 업데이트로 설치 위치가 바뀌었을 수 있다. 같은 편집기를 다시 찾는다.
      const found = (await detectFresh(deps)).find((editor) => editor.id === settings.id)
      if (!found) return { ok: false, code: 'launchFailed', detail: `${product.name}: ${exe}` }
      exe = found.exe
      const stale = settings.exe
      const moved = found.exe
      // 새 위치를 기억한다. 찾는 동안 설정 창에서 다른 편집기를 골랐으면 덮어쓰지 않는다.
      await serialized(async () => {
        const current = await readEditorSettings(deps.settingsFile)
        if (current.kind === 'detected' && current.id === product.id && current.exe === stale)
          await writeEditorSettings(deps.settingsFile, {
            kind: 'detected',
            id: product.id,
            exe: moved
          })
      }).catch(() => undefined)
    }
    args = presetArgs(product.family, line !== undefined)
  } else {
    if (!(await deps.isExecutable(exe))) return { ok: false, code: 'launchFailed', detail: exe }
    args = settings.args
  }

  const command = buildEditorCommand(
    { exe, args },
    { file, line, projectPath: projectRoot },
    deps.platform
  )
  if (!command.ok) return { ok: false, code: 'launchFailed', detail: command.error }
  return launchEditorProcess(command, projectRoot, deps.spawn)
}

// ───────────────────────── 설정 창(IPC) ─────────────────────────

// storedRunnable: 저장한 실행 파일이 아직 있다(그러면 실행도 그것으로 하므로 그것을 보여 준다. 없으면 실행할 때
// 같은 id로 다시 찾으므로 지금 찾은 것을 보여 준다)
function toState(
  settings: StoredEditor,
  detected: DetectedEditor[],
  error?: ExternalEditorError,
  storedRunnable = true
): ExternalEditorState {
  const current =
    settings.kind === 'detected' ? detected.find((editor) => editor.id === settings.id) : undefined
  return {
    kind: settings.kind,
    detectedId: settings.kind === 'detected' ? settings.id : null,
    exe:
      settings.kind === 'system'
        ? null
        : settings.kind === 'detected' && !storedRunnable
          ? (current?.exe ?? settings.exe)
          : settings.exe,
    args: settings.kind === 'custom' ? settings.args : null,
    defaultArgs: DEFAULT_CUSTOM_ARGS,
    detected,
    ...(error ? { error } : {})
  }
}

export async function getEditorState(deps: EditorDeps): Promise<ExternalEditorState> {
  const detected = await detectFresh(deps)
  const settings = await serialized(() => readEditorSettings(deps.settingsFile))
  const storedRunnable = settings.kind !== 'detected' || (await deps.isExecutable(settings.exe))
  return toState(settings, detected, undefined, storedRunnable)
}

// macOS 앱 번들(.app)을 고르면 그 안의 실행 파일을 쓴다(Info.plist의 CFBundleExecutable)
async function resolveMacAppBundle(path: string): Promise<string | null> {
  try {
    const plist = await readFile(join(path, 'Contents', 'Info.plist'), 'utf8')
    const name = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]
    if (name && !name.includes('/')) return join(path, 'Contents', 'MacOS', name)
  } catch {
    // XML이 아닌 plist 등은 MacOS 폴더의 하나뿐인 파일로 정한다
  }
  try {
    const names = await readdir(join(path, 'Contents', 'MacOS'))
    return names.length === 1 ? join(path, 'Contents', 'MacOS', names[0]) : null
  } catch {
    return null
  }
}

// 찾아보기로 고른 파일을 실행할 수 있으면 그 경로, 아니면 null
export async function checkBrowsedExecutable(
  path: string,
  platform: NodeJS.Platform,
  isExecutable: (path: string) => Promise<boolean>
): Promise<string | null> {
  let exe = path
  if (platform === 'darwin' && extname(path).toLowerCase() === '.app') {
    const inner = await resolveMacAppBundle(path)
    if (!inner) return null
    exe = inner
  }
  if (!isLaunchableExePath(exe, platform)) return null
  return (await isExecutable(exe)) ? exe : null
}

async function browseEditor(sender: WebContents, title: string): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender)
  const options: Electron.OpenDialogOptions = {
    title,
    properties: ['openFile'],
    // 형식 이름은 STEP처럼 번역하지 않는다
    filters: process.platform === 'win32' ? [{ name: 'EXE', extensions: ['exe'] }] : undefined
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

// 렌더러가 보낸 선택(믿지 않는 입력)을 확인해 설정을 바꾼다. 받지 않으면 설정은 그대로 두고 error를 붙인다.
export async function setEditor(
  choice: ExternalEditorChoice,
  deps: EditorDeps,
  browse: (title: string) => Promise<string | null>
): Promise<ExternalEditorState> {
  const input = (typeof choice === 'object' && choice !== null ? choice : {}) as Record<
    string,
    unknown
  >
  const kind = input.kind
  // 대화상자는 설정 차례 밖에서 띄운다(사용자가 고르는 동안 다른 설정 읽기를 막지 않게)
  let browsed: string | null = null
  if (kind === 'browse') {
    browsed = await browse(typeof input.title === 'string' ? input.title.slice(0, 200) : '')
  }
  const detected = lastDetected ?? (await detectFresh(deps))
  return serialized(async () => {
    const settings = await readEditorSettings(deps.settingsFile)
    const save = async (next: StoredEditor): Promise<ExternalEditorState> => {
      await writeEditorSettings(deps.settingsFile, next)
      return toState(next, detected)
    }
    switch (kind) {
      case 'system':
        return save(SYSTEM)
      case 'detected': {
        const found = detected.find((editor) => editor.id === input.id)
        const product = found && productOf(found.id)
        return found && product
          ? save({ kind: 'detected', id: product.id, exe: found.exe })
          : toState(settings, detected)
      }
      case 'browse': {
        if (browsed === null) return toState(settings, detected)
        const exe = await checkBrowsedExecutable(browsed, deps.platform, deps.isExecutable)
        if (!exe) return toState(settings, detected, 'unsupportedFile')
        return save({ kind: 'custom', exe, args: DEFAULT_CUSTOM_ARGS })
      }
      case 'customArgs': {
        if (settings.kind !== 'custom') return toState(settings, detected)
        const args = input.args
        if (typeof args !== 'string' || !parseArgsTemplate(args).ok)
          return toState(settings, detected, 'invalidArgs')
        return save({ ...settings, args })
      }
      case 'resetArgs':
        return settings.kind === 'custom'
          ? save({ ...settings, args: DEFAULT_CUSTOM_ARGS })
          : toState(settings, detected)
      default:
        return toState(settings, detected)
    }
  })
}

function defaultEditorDeps(): EditorDeps {
  return {
    settingsFile: join(app.getPath('userData'), 'external-editor.json'),
    platform: process.platform,
    spawn,
    openPath: (path) => shell.openPath(path),
    isExecutable: isExecutableFile,
    detect: () => detectEditors(defaultDetectDeps())
  }
}

export function registerExternalEditorIpc(): void {
  ipcMain.handle(IPC.getExternalEditor, () => getEditorState(defaultEditorDeps()))
  ipcMain.handle(IPC.setExternalEditor, (event, choice: ExternalEditorChoice) =>
    setEditor(choice, defaultEditorDeps(), (title) => browseEditor(event.sender, title))
  )
}

// 테스트용: 마지막으로 찾은 편집기를 잊는다
export function resetDetectedEditors(): void {
  lastDetected = null
}
