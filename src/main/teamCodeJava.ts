import { createHash } from 'crypto'
import { ipcMain } from 'electron'
import { constants, type Dirent, type Stats } from 'fs'
import {
  lstat,
  open as openFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  type FileHandle
} from 'fs/promises'
import path, { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { generatedState } from '../shared/generatedFiles'
import {
  IPC,
  type JavaFileEntry,
  type JavaFileList,
  type JavaLiteralEdit,
  type OpenJavaFileResult,
  type ReadJavaFileResult,
  type WriteJavaLiteralsResult
} from '../shared/ipc'
import { isLiteralSpanText, isWritableLiteral, literalFitsType } from '../shared/java/javaLiteral'
import { parseTunables } from '../shared/java/tunables'
import type { TunableNode, TunableValueType } from '../shared/java/tunableTypes'
import {
  isLinkableJavaFolder,
  isLinkableJavaPath,
  JAVA_SOURCE_PREFIX,
  normalizeLinkPath,
  TEAMCODE_DIR
} from '../shared/teamCodePaths'
import { openInExternalEditor } from './externalEditor'
import { isTrustedRoot } from './projectRoots'

// 팀이 쓴 TeamCode Java 파일(오브젝트에 연결하는 스크립트)의 목록, 외부 편집기로 열기, 튜닝 값 읽기·쓰기.
// - 목록은 이름·크기·시각만 보고, 열기는 편집기에 경로만 넘긴다.
// - 튜닝 값(3단계): 읽기는 내용을 그대로 돌려주고, 쓰기는 저장(Ctrl+S) 때 렌더러가 고른 리터럴 자리만 바꾼다.
//   파일을 만들거나 지우거나 이름을 바꾸지 않는다(같은 폴더의 임시 파일 .<이름>.sandbot.tmp만 만들고 지운다).
// root는 열거나 저장한 프로젝트만 받고(projectRoots.ts), 경로는 src/shared/teamCodePaths.ts의 규칙으로 확인한다.

// 이보다 많으면 앞의 것만 담고 truncated로 알린다
export const MAX_JAVA_FILES = 5000
// 동시에 하는 파일 시스템 작업 수. libuv 스레드 풀(기본 4개)은 STEP·메시 캐시 읽기와 같이 쓴다.
const CONCURRENCY = 8
// 패키지 폴더 깊이 한도(링크는 따라가지 않으므로 순환은 없지만, 비정상적으로 깊은 폴더를 끝없이 훑지 않게)
const MAX_DEPTH = 40
// 줄 번호 한도(편집기 인자로만 쓴다)
const MAX_LINE = 10_000_000

const JAVA_DIR_SEGMENTS = JAVA_SOURCE_PREFIX.split('/').filter(Boolean)

type PathApi = Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'>

// realTarget이 realRoot 안(같은 폴더 자신은 아님)에 있는지. 둘 다 realpath 결과여야 한다.
// Windows에서 다른 드라이브면 relative가 절대 경로를 돌려주므로('D:\evil\X.java') '..'만 봐서는 안 된다.
export function containedIn(realRoot: string, realTarget: string, api: PathApi = path): boolean {
  const rel = api.relative(realRoot, realTarget)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel)
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return results
}

export type Classified = { name: string; kind: 'dir' | 'file'; stats: Stats | null }

// 링크라고 나온 항목은 lstat로 다시 본다. Windows의 readdir는 모든 재분석 지점(OneDrive 주문형 파일 등)을 링크로
// 알려 주지만, lstat는 진짜 심볼릭 링크·정션만 링크로 보고 나머지는 보통 파일·폴더로 본다. 진짜 링크는 따라가지 않는다
// (TeamCode 밖을 가리킬 수 있고 순환할 수 있다).
export async function classifyEntry(
  dir: string,
  entry: Pick<Dirent, 'name' | 'isSymbolicLink' | 'isDirectory' | 'isFile'>
): Promise<Classified | null> {
  if (entry.isSymbolicLink()) {
    let stats: Stats
    try {
      stats = await lstat(join(dir, entry.name))
    } catch {
      return null
    }
    if (stats.isSymbolicLink()) return null
    if (stats.isDirectory()) return { name: entry.name, kind: 'dir', stats }
    if (stats.isFile()) return { name: entry.name, kind: 'file', stats }
    return null
  }
  if (entry.isDirectory()) return { name: entry.name, kind: 'dir', stats: null }
  if (entry.isFile()) return { name: entry.name, kind: 'file', stats: null }
  return null
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

// TeamCode/src/main/java 아래의 연결할 수 있는 .java 파일(경로 규칙은 teamCodePaths.ts). 점 폴더와 build는 건너뛴다.
export async function listJavaFiles(
  root: string,
  limit: number = MAX_JAVA_FILES
): Promise<JavaFileList> {
  const teamCode = join(resolve(root), TEAMCODE_DIR)
  const hasTeamCode = await isDirectory(teamCode)
  const files: JavaFileEntry[] = []
  let truncated = false
  if (!hasTeamCode) return { files, truncated, hasTeamCode }

  // dir은 디스크 경로, rel은 TeamCode 기준 경로(NFC, '/' 구분)
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // 읽을 수 없는 폴더(권한, 오프라인 클라우드 폴더 등)는 건너뛴다
      return
    }
    const childRel = (name: string): string => `${rel}/${normalizeLinkPath(name)}`
    // 이름으로 먼저 거른다(링크·재분석 지점은 하나마다 lstat가 필요하다). 점 폴더는 식별자가 아니라서 빠진다.
    // 식별자가 아닌 폴더(패키지가 될 수 없음), 생성 패키지 폴더, build로는 내려가지 않는다.
    const candidates = entries.filter(
      (entry) =>
        isLinkableJavaPath(childRel(entry.name)) ||
        (entry.name !== 'build' && isLinkableJavaFolder(childRel(entry.name)))
    )
    const classified = (await mapLimit(candidates, (entry) => classifyEntry(dir, entry)))
      .filter((item): item is Classified => item !== null)
      .sort(byName)

    const javaFiles = classified.filter(
      (item) => item.kind === 'file' && isLinkableJavaPath(childRel(item.name))
    )
    const stats = await mapLimit(javaFiles, async (item) => {
      try {
        return item.stats ?? (await lstat(join(dir, item.name)))
      } catch {
        return null
      }
    })
    for (let i = 0; i < javaFiles.length; i++) {
      const info = stats[i]
      if (!info || !info.isFile()) continue
      if (files.length >= limit) {
        truncated = true
        return
      }
      files.push({ path: childRel(javaFiles[i].name), size: info.size, mtimeMs: info.mtimeMs })
    }

    if (depth >= MAX_DEPTH) return
    for (const item of classified) {
      if (truncated) return
      if (
        item.kind !== 'dir' ||
        item.name === 'build' ||
        !isLinkableJavaFolder(childRel(item.name))
      )
        continue
      await walk(join(dir, item.name), childRel(item.name), depth + 1)
    }
  }

  await walk(join(teamCode, ...JAVA_DIR_SEGMENTS), JAVA_SOURCE_PREFIX.slice(0, -1), 0)
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, truncated, hasTeamCode }
}

export type EditorOpener = (
  file: string,
  projectRoot: string,
  line: number | undefined
) => Promise<OpenJavaFileResult>

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// NFC로 받은 경로의 디스크 이름을 찾는다. 목록은 디스크 이름을 NFC로 바꿔 주지만, NTFS·ext4는 이름을 정규화하지
// 않으므로 NFD로 저장된 이름(macOS에서 압축한 한글 폴더 등)은 NFC 경로로 열리지 않는다. 세그먼트마다 정확히 같은
// 이름이 없으면 NFC로 같은 이름 하나를 고른다(둘 이상이면 고를 수 없다).
async function resolveOnDisk(base: string, segments: readonly string[]): Promise<string | null> {
  let current = base
  for (const segment of segments) {
    let names: string[]
    try {
      names = await readdir(current)
    } catch {
      return null
    }
    if (names.includes(segment)) {
      current = join(current, segment)
      continue
    }
    const matches = names.filter((name) => name.normalize('NFC') === segment)
    if (matches.length !== 1) return null
    current = join(current, matches[0])
  }
  return current
}

type Located =
  | { ok: true; projectRoot: string; file: string; real: string; realJavaRoot: string }
  | { ok: false; code: 'notAllowed' | 'missing' | 'failed'; detail: string }

// 렌더러가 보낸 root·경로(믿지 않는 입력)를 확인하고 디스크 위치를 찾는다.
// 열린 프로젝트이고, 연결 경로 규칙에 맞고, 보통 파일이고, 링크를 풀어도 TeamCode/src/main/java 안의 .java여야 한다.
// file은 받은 경로의 디스크 위치(NFD 이름이면 그 이름), real은 링크를 푼 실제 위치다.
async function locateJavaFile(root: unknown, relPath: unknown): Promise<Located> {
  if (!isTrustedRoot(root))
    return { ok: false, code: 'notAllowed', detail: 'not an opened project' }
  if (typeof relPath !== 'string' || !isLinkableJavaPath(relPath))
    return { ok: false, code: 'notAllowed', detail: 'not a TeamCode Java source path' }
  const projectRoot = resolve(root)
  const javaRoot = join(projectRoot, TEAMCODE_DIR, ...JAVA_DIR_SEGMENTS)
  let file = join(projectRoot, TEAMCODE_DIR, ...relPath.split('/'))

  let info: Stats
  try {
    info = await stat(file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR')
      return { ok: false, code: 'failed', detail: errorText(error) }
    const onDisk = await resolveOnDisk(join(projectRoot, TEAMCODE_DIR), relPath.split('/'))
    const found = onDisk ? await stat(onDisk).catch(() => null) : null
    if (!onDisk || !found) return { ok: false, code: 'missing', detail: relPath }
    file = onDisk
    info = found
  }
  if (!info.isFile()) return { ok: false, code: 'notAllowed', detail: 'not a regular file' }

  let realJavaRoot: string
  let real: string
  try {
    ;[realJavaRoot, real] = await Promise.all([realpath(javaRoot), realpath(file)])
  } catch (error) {
    // 링크를 풀 수 없으면(일부 가상 드라이브) 안에 있는지 알 수 없으므로 열지 않는다
    return { ok: false, code: 'notAllowed', detail: `cannot resolve path: ${errorText(error)}` }
  }
  // 링크가 다른 확장자 파일을 가리키면 연결된 앱으로 열 때 실행될 수 있다
  if (!containedIn(realJavaRoot, real) || extname(real).toLowerCase() !== '.java')
    return { ok: false, code: 'notAllowed', detail: 'outside TeamCode/src/main/java' }
  return { ok: true, projectRoot, file, real, realJavaRoot }
}

// 렌더러가 보낸 값(믿지 않는 입력)을 확인한 뒤 외부 편집기로 연다(확인은 locateJavaFile).
export async function openJavaFile(
  root: unknown,
  relPath: unknown,
  line: unknown,
  open: EditorOpener = openInExternalEditor
): Promise<OpenJavaFileResult> {
  const located = await locateJavaFile(root, relPath)
  if (!located.ok) {
    if (located.code === 'failed') return { ok: false, code: 'openFailed', detail: located.detail }
    return { ok: false, code: located.code, detail: located.detail }
  }
  const validLine =
    typeof line === 'number' && Number.isSafeInteger(line) && line >= 1 && line <= MAX_LINE
      ? line
      : undefined
  return open(located.file, located.projectRoot, validLine)
}

// --- 튜닝 값: 읽기와 리터럴 쓰기 ---

// 이보다 큰 파일은 읽지 않는다(편집할 수 없음, tooLarge)
export const MAX_JAVA_FILE_BYTES = 1024 * 1024
// 한 번에 받는 편집 수 한도
const MAX_EDITS = 10_000
// Windows에서 백신·색인기가 막 쓴 파일을 잡고 있으면 rename이 이 오류로 실패한다. 잠시 뒤 다시 한다.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRY_BUDGET_MS = 2000

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// 링크를 푼 실제 위치도 연결 경로 규칙(식별자 폴더, 생성 패키지 밖)에 맞아야 쓴다. 쓰기는 실제 파일에 한다
// (링크 자신을 보통 파일로 바꾸지 않는다).
function isLinkableRealPath(realJavaRoot: string, real: string): boolean {
  const rel = relative(realJavaRoot, real).split(sep).join('/')
  return isLinkableJavaPath(normalizeLinkPath(`${JAVA_SOURCE_PREFIX}${rel}`))
}

type Snapshot = { raw: Buffer; stats: Stats } | 'tooLarge' | 'notFile'

// 링크를 따르지 않고(POSIX의 O_NOFOLLOW) 열어 그 핸들로 stat과 내용을 읽는다(둘이 같은 파일이다).
// O_NONBLOCK은 그사이 FIFO로 바뀐 경로를 여는 데서 멈추지 않게 한다(보통 파일에는 영향이 없다).
async function readSnapshot(real: string): Promise<Snapshot> {
  const flags =
    constants.O_NOFOLLOW !== undefined
      ? constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      : 'r'
  const handle = await openFile(real, flags)
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) return 'notFile'
    if (stats.size > MAX_JAVA_FILE_BYTES) return 'tooLarge'
    const raw = await handle.readFile()
    if (raw.length > MAX_JAVA_FILE_BYTES) return 'tooLarge'
    return { raw, stats }
  } finally {
    await handle.close()
  }
}

// 쓸 수 없는 파일의 이유. 내용은 Buffer.toString('utf8')로 읽는다(TextDecoder는 BOM을 지워 오프셋이 한 칸 밀린다).
// UTF-8로 읽어 그대로 되돌릴 수 없으면(CP949 등) 쓰지 않는다. 생성 표식이 있는 파일은 도구가 만든 파일이다.
function fileProblem(raw: Buffer, text: string): 'encoding' | 'generated' | null {
  if (!Buffer.from(text, 'utf8').equals(raw)) return 'encoding'
  if (generatedState(text) !== 'none') return 'generated'
  return null
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

// 튜닝 값을 보이려고 연결 파일을 읽는다. 1 MB를 넘으면 내용을 읽지 않고 text·hash를 빈 글자로, editable false·
// reason tooLarge로 돌려준다(렌더러는 "파일이 너무 크다"만 보인다). UTF-8로 그대로 되돌릴 수 없거나 생성 표식이
// 있으면 내용은 주되(보여 주기용) editable이 false다.
export async function readJavaFile(root: unknown, relPath: unknown): Promise<ReadJavaFileResult> {
  const located = await locateJavaFile(root, relPath)
  if (!located.ok) return located
  if (!isLinkableRealPath(located.realJavaRoot, located.real))
    return { ok: false, code: 'notAllowed', detail: 'link target is not a linkable Java path' }
  let snapshot: Snapshot
  try {
    snapshot = await readSnapshot(located.real)
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return { ok: false, code: 'missing', detail: String(relPath) }
    // 그사이 링크로 바뀌었다(O_NOFOLLOW)
    if (code === 'ELOOP') return { ok: false, code: 'notAllowed', detail: 'became a link' }
    return { ok: false, code: 'failed', detail: errorText(error) }
  }
  if (snapshot === 'notFile') return { ok: false, code: 'notAllowed', detail: 'not a regular file' }
  if (snapshot === 'tooLarge')
    return { ok: true, text: '', hash: '', editable: false, reason: 'tooLarge' }
  const text = snapshot.raw.toString('utf8')
  const hash = sha256(snapshot.raw)
  const problem = fileProblem(snapshot.raw, text)
  return problem
    ? { ok: true, text, hash, editable: false, reason: problem }
    : { ok: true, text, hash, editable: true }
}

function refused(reason: string): WriteJavaLiteralsResult {
  return { status: 'refused', reason }
}

// 렌더러가 보낸 편집 목록의 모양(정수 위치, 글자)
function parseEdits(edits: unknown): JavaLiteralEdit[] | null {
  if (!Array.isArray(edits) || edits.length > MAX_EDITS) return null
  const parsed: JavaLiteralEdit[] = []
  for (const edit of edits) {
    if (typeof edit !== 'object' || edit === null) return null
    const { start, end, expected, text } = edit as Record<string, unknown>
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
    if (typeof expected !== 'string' || typeof text !== 'string') return null
    parsed.push({ start: start as number, end: end as number, expected, text })
  }
  return parsed
}

// 지금 파일에서 고칠 수 있는 값 노드의 자리 → 형식(박싱 여부 포함)
function editableSpans(text: string): Map<string, { type: TunableValueType; boxed: boolean }> {
  const spans = new Map<string, { type: TunableValueType; boxed: boolean }>()
  const visit = (node: TunableNode): void => {
    if (node.kind === 'object') node.children.forEach(visit)
    else if (node.kind === 'value' && node.editable && node.span)
      spans.set(`${node.span.start}:${node.span.end}`, { type: node.type, boxed: node.boxed })
  }
  for (const block of parseTunables(text).blocks) block.fields.forEach(visit)
  return spans
}

// 편집이 안전한지. 문제가 있으면 그 이유.
// - 위치 순서이고 겹치지 않고 글자 범위 안이다.
// - 그 자리의 글자가 expected와 같고, expected는 부호가 붙을 수 있는 리터럴 하나다(isLiteralSpanText).
// - 새 글자는 리터럴 토큰 하나다(isWritableLiteral: 식·주석·줄바꿈·\u 없음).
// - 그 자리가 지금 파일에서 고칠 수 있는 튜닝 값의 초기값이고, 새 글자가 그 필드 형식(박싱 포함)에 컴파일된다
//   (literalFitsType).
//   렌더러가 같은 파서로 같은 글자에서 자리를 정하므로 맞아야 한다(메서드 안 리터럴 등 다른 곳을 바꾸지 않게).
export function checkLiteralEdits(text: string, edits: readonly JavaLiteralEdit[]): string | null {
  const spans = editableSpans(text)
  let previousEnd = 0
  for (const edit of edits) {
    if (edit.start < previousEnd) return 'edits are not sorted or overlap'
    if (edit.end <= edit.start || edit.end > text.length) return 'edit is out of range'
    if (text.slice(edit.start, edit.end) !== edit.expected) return 'expected text does not match'
    if (!isLiteralSpanText(edit.expected)) return 'expected text is not a literal'
    if (!isWritableLiteral(edit.text)) return 'new text is not a writable literal'
    const field = spans.get(`${edit.start}:${edit.end}`)
    if (!field) return 'not an editable tunable literal'
    if (!literalFitsType(field.type, edit.text, field.boxed))
      return `new text does not fit ${field.boxed ? 'boxed ' : ''}${field.type}`
    previousEnd = edit.end
  }
  return null
}

// 뒤에서부터 바꾼다(앞 편집이 뒤 위치를 밀지 않게)
export function applyLiteralEdits(text: string, edits: readonly JavaLiteralEdit[]): string {
  let out = text
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i]
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

export type RenameOptions = {
  rename?: (from: string, to: string) => Promise<void>
  platform?: NodeJS.Platform
  sleep?: (ms: number) => Promise<void>
}

// Windows의 rename(MoveFileExW)은 백신·색인기가 파일을 잡고 있으면 EPERM·EACCES·EBUSY로 실패한다.
// 10 ms부터 늘려 가며(최대 100 ms 간격) 2초쯤 다시 한다(graceful-fs와 같은 방식). 다른 OS는 바로 실패한다.
export async function renameWithRetry(
  from: string,
  to: string,
  options: RenameOptions = {}
): Promise<void> {
  const doRename = options.rename ?? rename
  const platform = options.platform ?? process.platform
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  let waited = 0
  let delay = 10
  for (;;) {
    try {
      await doRename(from, to)
      return
    } catch (error) {
      const code = errnoCode(error)
      if (platform !== 'win32' || !code || !RENAME_RETRY_CODES.has(code)) throw error
      if (waited >= RENAME_RETRY_BUDGET_MS) throw error
      await sleep(delay)
      waited += delay
      delay = Math.min(delay * 2, 100)
    }
  }
}

// 테스트에서 다른 편집기의 저장이나 rename 실패를 흉내 낸다
export type WriteHooks = {
  // 임시 파일을 다 쓴 뒤, 다시 stat하기 전
  afterTempWrite?: () => Promise<void>
  rename?: (from: string, to: string) => Promise<void>
}

// 임시 파일을 'wx'(이미 있으면 실패, 링크를 따라가지 않음)로 연다. 이전 실행이 남긴 임시 파일이 있으면 지우고
// 한 번 더 한다(쓰기는 루트마다 한 줄로 하므로 이 앱이 쓰는 중인 파일은 아니다).
async function openTemp(temp: string): Promise<FileHandle> {
  try {
    return await openFile(temp, 'wx')
  } catch (error) {
    if (errnoCode(error) !== 'EEXIST') throw error
    const leftover = await lstat(temp)
    if (leftover.isDirectory()) throw error
    await unlink(temp)
    return openFile(temp, 'wx')
  }
}

// 같은 폴더의 임시 파일에 쓰고, 원래 파일이 읽은 뒤 바뀌지 않았는지 다시 확인한 뒤 바꿔치기한다. 확인은 stat
// (크기·수정 시각·inode)과 내용 해시 둘 다 본다(수정 시각의 단위가 거친 파일 시스템에서 같은 크기로 고친 것도 잡게).
// 다시 확인과 rename 사이(밀리초)에 다른 편집기가 쓰면 그 변경은 덮인다(파일 시스템에 비교 후 교환이 없다).
async function replaceFile(
  real: string,
  bytes: Buffer,
  before: { stats: Stats; hash: string },
  hooks: WriteHooks
): Promise<'written' | 'changed'> {
  const temp = join(dirname(real), `.${basename(real)}.sandbot.tmp`)
  const handle = await openTemp(temp)
  try {
    try {
      await handle.writeFile(bytes)
      // 원래 권한을 옮긴다(Windows는 읽기 전용 비트뿐이고, 읽기 전용 파일은 앞에서 거부했다)
      if (process.platform !== 'win32') await handle.chmod(before.stats.mode & 0o777)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await hooks.afterTempWrite?.()
    const now = await readSnapshot(real).catch(() => null)
    if (
      now === null ||
      typeof now === 'string' ||
      now.stats.size !== before.stats.size ||
      now.stats.mtimeMs !== before.stats.mtimeMs ||
      now.stats.ino !== before.stats.ino ||
      sha256(now.raw) !== before.hash
    ) {
      await unlink(temp).catch(() => undefined)
      return 'changed'
    }
    await renameWithRetry(temp, real, { rename: hooks.rename })
    return 'written'
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

// 쓰기는 프로젝트 루트마다 한 줄로 한다(같은 파일을 두 번 고칠 때 둘째가 첫째의 결과를 보고 해시를 비교하게)
const writeQueues = new Map<string, Promise<void>>()

function serializeWrites<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const result = previous.then(task)
  const settled = result.then(
    () => undefined,
    () => undefined
  )
  writeQueues.set(key, settled)
  void settled.then(() => {
    if (writeQueues.get(key) === settled) writeQueues.delete(key)
  })
  return result
}

// 저장(Ctrl+S) 때 튜닝 값 리터럴을 바꿔 쓴다. 렌더러가 readJavaFile로 읽은 내용(expectedHash)에서 자리를 정한다.
// - changed: 디스크 내용의 해시가 다르거나, 임시 파일을 쓰는 동안 파일이 바뀌었다(렌더러가 다시 읽고 한 번 더 한다).
// - refused: 경로·파일·편집 확인에 걸렸다. 입출력 오류는 예외로 알린다(렌더러는 실패로 본다).
export async function writeJavaLiterals(
  root: unknown,
  relPath: unknown,
  expectedHash: unknown,
  edits: unknown,
  hooks: WriteHooks = {}
): Promise<WriteJavaLiteralsResult> {
  if (!isTrustedRoot(root)) return refused('notAllowed: not an opened project')
  if (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash))
    return refused('invalid hash')
  const parsed = parseEdits(edits)
  if (!parsed) return refused('invalid edits')
  return serializeWrites(resolve(root), () =>
    writeLocked(root, relPath, expectedHash, parsed, hooks)
  )
}

async function writeLocked(
  root: string,
  relPath: unknown,
  expectedHash: string,
  edits: JavaLiteralEdit[],
  hooks: WriteHooks
): Promise<WriteJavaLiteralsResult> {
  const located = await locateJavaFile(root, relPath)
  if (!located.ok) {
    if (located.code === 'missing') return { status: 'missing' }
    if (located.code === 'notAllowed') return refused(`notAllowed: ${located.detail}`)
    throw new Error(located.detail)
  }
  if (!isLinkableRealPath(located.realJavaRoot, located.real))
    return refused('notAllowed: link target is not a linkable Java path')
  let snapshot: Snapshot
  try {
    snapshot = await readSnapshot(located.real)
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'missing' }
    if (code === 'ELOOP') return refused('notAllowed: became a link')
    throw error
  }
  if (snapshot === 'notFile') return refused('notAllowed: not a regular file')
  if (snapshot === 'tooLarge') return refused('tooLarge')
  const { raw, stats } = snapshot
  if (sha256(raw) !== expectedHash) return { status: 'changed' }
  const text = raw.toString('utf8')
  const problem = fileProblem(raw, text)
  if (problem) return refused(problem)
  // 읽기 전용 파일은 바꿔치기하지 않는다(Windows rename은 늘 실패하고, 팀이 일부러 막은 것일 수 있다)
  if ((stats.mode & 0o200) === 0) return refused('readOnly')
  const editProblem = checkLiteralEdits(text, edits)
  if (editProblem) return refused(editProblem)
  const next = applyLiteralEdits(text, edits)
  const bytes = Buffer.from(next, 'utf8')
  if (bytes.equals(raw)) return { status: 'written', text, hash: expectedHash }
  const outcome = await replaceFile(located.real, bytes, { stats, hash: expectedHash }, hooks)
  if (outcome === 'changed') return { status: 'changed' }
  return { status: 'written', text: next, hash: sha256(bytes) }
}

// 렌더러가 보낸 root(믿지 않는 입력)의 목록. 열거나 저장한 프로젝트가 아니면 거부한다(JavaFileList에는 실패를 담을
// 자리가 없으므로 예외로 알린다).
export async function listTrustedJavaFiles(root: unknown): Promise<JavaFileList> {
  if (!isTrustedRoot(root)) throw new Error(`notAllowed: not an opened project: ${String(root)}`)
  return listJavaFiles(root)
}

export function registerTeamCodeJavaIpc(): void {
  ipcMain.handle(IPC.listJavaFiles, (_event, root: unknown) => listTrustedJavaFiles(root))
  ipcMain.handle(IPC.openJavaFile, (_event, root: unknown, relPath: unknown, line: unknown) =>
    openJavaFile(root, relPath, line)
  )
  ipcMain.handle(IPC.readJavaFile, (_event, root: unknown, relPath: unknown) =>
    readJavaFile(root, relPath)
  )
  // 핸들러가 정한 인자만 넘긴다(hooks는 테스트용)
  ipcMain.handle(
    IPC.writeJavaLiterals,
    (_event, root: unknown, relPath: unknown, expectedHash: unknown, edits: unknown) =>
      writeJavaLiterals(root, relPath, expectedHash, edits)
  )
}
