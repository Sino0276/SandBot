import { ipcMain } from 'electron'
import type { Dirent, Stats } from 'fs'
import { lstat, readdir, realpath, stat } from 'fs/promises'
import path, { extname, join, resolve } from 'path'
import { IPC, type JavaFileEntry, type JavaFileList, type OpenJavaFileResult } from '../shared/ipc'
import {
  isLinkableJavaFolder,
  isLinkableJavaPath,
  JAVA_SOURCE_PREFIX,
  normalizeLinkPath,
  TEAMCODE_DIR
} from '../shared/teamCodePaths'
import { openInExternalEditor } from './externalEditor'
import { isTrustedRoot } from './projectRoots'

// 팀이 쓴 TeamCode Java 파일(오브젝트에 연결하는 스크립트)의 목록과 외부 편집기로 열기.
// 이 모듈은 사용자 파일을 읽지도 쓰지도 않는다(목록은 이름·크기·시각만, 열기는 편집기에 경로만 넘긴다).
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

type Classified = { name: string; kind: 'dir' | 'file'; stats: Stats | null }

// 링크라고 나온 항목은 lstat로 다시 본다. Windows의 readdir는 모든 재분석 지점(OneDrive 주문형 파일 등)을 링크로
// 알려 주지만, lstat는 진짜 심볼릭 링크·정션만 링크로 보고 나머지는 보통 파일·폴더로 본다. 진짜 링크는 따라가지 않는다
// (TeamCode 밖을 가리킬 수 있고 순환할 수 있다).
async function classify(dir: string, entry: Dirent): Promise<Classified | null> {
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
    const classified = (await mapLimit(candidates, (entry) => classify(dir, entry)))
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

function notAllowed(detail: string): OpenJavaFileResult {
  return { ok: false, code: 'notAllowed', detail }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 렌더러가 보낸 값(믿지 않는 입력)을 확인한 뒤 외부 편집기로 연다.
// 열린 프로젝트이고, 연결 경로 규칙에 맞고, 보통 파일이고, 링크를 풀어도 TeamCode/src/main/java 안의 .java여야 한다.
export async function openJavaFile(
  root: unknown,
  relPath: unknown,
  line: unknown,
  open: EditorOpener = openInExternalEditor
): Promise<OpenJavaFileResult> {
  if (!isTrustedRoot(root)) return notAllowed('not an opened project')
  if (typeof relPath !== 'string' || !isLinkableJavaPath(relPath))
    return notAllowed('not a TeamCode Java source path')
  const projectRoot = resolve(root)
  const javaRoot = join(projectRoot, TEAMCODE_DIR, ...JAVA_DIR_SEGMENTS)
  const file = join(projectRoot, TEAMCODE_DIR, ...relPath.split('/'))

  let info: Stats
  try {
    info = await stat(file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return { ok: false, code: 'missing', detail: relPath }
    return { ok: false, code: 'openFailed', detail: errorText(error) }
  }
  if (!info.isFile()) return notAllowed('not a regular file')

  let realJavaRoot: string
  let realFile: string
  try {
    ;[realJavaRoot, realFile] = await Promise.all([realpath(javaRoot), realpath(file)])
  } catch (error) {
    // 링크를 풀 수 없으면(일부 가상 드라이브) 안에 있는지 알 수 없으므로 열지 않는다
    return notAllowed(`cannot resolve path: ${errorText(error)}`)
  }
  // 링크가 다른 확장자 파일을 가리키면 연결된 앱으로 열 때 실행될 수 있다
  if (!containedIn(realJavaRoot, realFile) || extname(realFile).toLowerCase() !== '.java')
    return notAllowed('outside TeamCode/src/main/java')

  const validLine =
    typeof line === 'number' && Number.isSafeInteger(line) && line >= 1 && line <= MAX_LINE
      ? line
      : undefined
  return open(file, projectRoot, validLine)
}

export function registerTeamCodeJavaIpc(): void {
  ipcMain.handle(IPC.listJavaFiles, (_event, root: unknown) => {
    if (!isTrustedRoot(root)) throw new Error(`notAllowed: not an opened project: ${String(root)}`)
    return listJavaFiles(root)
  })
  ipcMain.handle(IPC.openJavaFile, (_event, root: unknown, relPath: unknown, line: unknown) =>
    openJavaFile(root, relPath, line)
  )
}
