import { app, ipcMain } from 'electron'
import { readFile, realpath, rename, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { IPC } from '../shared/ipc'
import type { GrantCodeTrustResult } from '../shared/play'
import { foldCase } from '../shared/teamCodePaths'
import { isTrustedRoot } from './projectRoots'

// 프로젝트 코드 실행 동의(Android Studio의 Trust Project, VS Code의 Workspace Trust처럼). 등록기 OpMode 목록은 등록기
// (@OpModeRegistrar 메서드와 그것이 건드리는 정적 초기화)를 이 PC의 JVM에서 실행해야 알 수 있으므로, 사용자가 이 프로젝트의
// 코드를 실행해도 된다고 한 뒤에만 읽는다(registeredOpModes.ts가 그 전에는 needsConsent로 답하고 아무것도 받거나 띄우지
// 않는다). 동의는 OpMode 고르기의 '등록기 OpMode 읽기…' 확인(IPC grantCodeTrust)이나 INIT(같은 코드를 실행한다,
// sidecar/controller.ts)이고, 처음 한 번 묻고 프로젝트마다 userData/code-trust.json에 기억한다. 프로젝트를 열기만 해서는
// 코드를 실행하지 않는다(L1처럼 INIT을 눌러야 실행한다).
// - 키: 프로젝트 루트의 실제 경로(링크를 푼 realpath)를 NFC로, Windows는 대소문자를 접어(foldCase) 같은 폴더를 한 키로 본다.
//   폴더를 옮기거나 지우면 맞지 않아 다시 묻는다. 루트를 받는 IPC는 열거나 저장한 루트만 받는다(projectRoots.ts).
// - 파일: {version: 1, projects: [키…]}(믿은 차례). MAX_TRUSTED_PROJECTS개를 넘으면 먼저 믿은 것부터 버린다. 깨졌거나 너무
//   크거나 모양이 다르면 빈 것으로 본다(다시 묻는다). 처음 쓸 때 한 번 읽어 기억하고, 새로 믿을 때만 파일을 다시 읽어 그 키를
//   더해 쓴다(임시 파일에 쓴 뒤 바꿔 끼움, jdk.ts와 같음, 차례로). 쓰지 못해도 앱이 도는 동안은 기억한다.

export const CODE_TRUST_FILE = 'code-trust.json'
const VERSION = 1
// 기억하는 프로젝트 수와 파일 한도(4096자 경로 256개가 UTF-8로 들어가는 크기)
export const MAX_TRUSTED_PROJECTS = 256
const MAX_KEY_LENGTH = 4096
const MAX_FILE_BYTES = 4 * 1024 * 1024
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

// 실제 경로 → 저장 키
export function codeTrustKey(realPath: string, platform: NodeJS.Platform): string {
  const normalized = realPath.normalize('NFC')
  return platform === 'win32' ? foldCase(normalized) : normalized
}

// 파일 내용 → 믿은 차례의 키(같은 키는 뒤의 것 하나). 모양이 다르면 [].
export function parseCodeTrust(text: string): string[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof value !== 'object' || value === null) return []
  const { version, projects } = value as Record<string, unknown>
  if (version !== VERSION || !Array.isArray(projects)) return []
  const keys = new Set<string>()
  for (const key of projects) {
    if (typeof key !== 'string' || key === '' || key.length > MAX_KEY_LENGTH) continue
    keys.delete(key)
    keys.add(key)
  }
  return [...keys].slice(-MAX_TRUSTED_PROJECTS)
}

export type CodeTrustDeps = {
  // userData/code-trust.json
  file: string
  platform: NodeJS.Platform
  // 링크를 모두 푼 실제 위치(없으면 던진다). 테스트가 바꾼다.
  realpath?: (target: string) => Promise<string>
}

async function readKeys(file: string): Promise<string[]> {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return []
    return parseCodeTrust(await readFile(file, 'utf8'))
  } catch {
    return []
  }
}

// 쓰는 도중 꺼져도 이전 파일이 깨지지 않게 임시 파일에 쓴 뒤 바꿔 끼운다(Windows는 잠깐 잠긴 파일에 다시 해 본다)
async function writeKeys(file: string, keys: readonly string[]): Promise<void> {
  const temp = `${file}.tmp`
  await writeFile(
    temp,
    `${JSON.stringify({ version: VERSION, projects: keys }, null, 2)}\n`,
    'utf8'
  )
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

export class CodeTrustStore {
  // 믿은 차례의 키(처음 쓸 때 파일에서 읽는다)
  private keys: Promise<string[]> | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly deps: CodeTrustDeps) {}

  // 이 프로젝트의 코드를 실행해도 된다고 했는가(폴더가 없으면 false)
  async isTrusted(root: string): Promise<boolean> {
    const key = await this.keyOf(root)
    return key !== null && (await this.load()).includes(key)
  }

  // 믿는다고 기억한다. 폴더가 없어 키를 만들지 못하면 false. 이미 믿은 프로젝트면 파일을 쓰지 않는다.
  async grant(root: string): Promise<boolean> {
    const key = await this.keyOf(root)
    if (key === null) return false
    const keys = await this.load()
    if (keys.includes(key)) return true
    keys.push(key)
    if (keys.length > MAX_TRUSTED_PROJECTS) keys.splice(0, keys.length - MAX_TRUSTED_PROJECTS)
    // 쓰기 직전에 파일을 다시 읽어 합친다(다른 SandBot 창·실행이 그사이 기억한 프로젝트를 지우지 않게). 쓰지 못해도(읽기
    // 전용 폴더 등) 이 실행 동안은 기억한다.
    this.writing = this.writing
      .then(async () => {
        const merged = await readKeys(this.deps.file)
        if (merged.includes(key)) return
        merged.push(key)
        await writeKeys(this.deps.file, merged.slice(-MAX_TRUSTED_PROJECTS))
      })
      .catch(() => undefined)
    await this.writing
    return true
  }

  private load(): Promise<string[]> {
    this.keys ??= readKeys(this.deps.file)
    return this.keys
  }

  private async keyOf(root: string): Promise<string | null> {
    if (root === '') return null
    try {
      const real = await (this.deps.realpath ?? realpath)(path.resolve(root))
      return real.length > MAX_KEY_LENGTH ? null : codeTrustKey(real, this.deps.platform)
    } catch {
      return null
    }
  }
}

// IPC grantCodeTrust: 열거나 저장한 루트만 받는다(렌더러가 넘긴 경로를 그대로 믿지 않는다)
export async function grantCodeTrustFor(
  store: CodeTrustStore,
  root: unknown
): Promise<GrantCodeTrustResult> {
  if (!isTrustedRoot(root))
    return { ok: false, code: 'notAllowed', detail: 'not an opened project' }
  return (await store.grant(root))
    ? { ok: true }
    : { ok: false, code: 'failed', detail: 'the project folder was not found' }
}

export function defaultCodeTrustStore(): CodeTrustStore {
  return new CodeTrustStore({
    file: path.join(app.getPath('userData'), CODE_TRUST_FILE),
    platform: process.platform
  })
}

export function registerCodeTrustIpc(store: CodeTrustStore): void {
  ipcMain.handle(IPC.grantCodeTrust, (_event, root: unknown) => grantCodeTrustFor(store, root))
}
