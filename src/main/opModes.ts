import { ipcMain } from 'electron'
import { resolve } from 'path'
import { IPC, MAX_SOURCE_PATHS, MAX_USAGE_FILE_BYTES, type JavaFileEntry } from '../shared/ipc'
import {
  compareOpModes,
  isTopLevelOfFile,
  parseOpModeSource,
  type ParsedOpMode,
  type ParsedRegistrar
} from '../shared/java/opModes'
import type { ListOpModesResult, OpModeInfo, RegistrarInfo } from '../shared/play'
import { isTrustedRoot } from './projectRoots'
import { listRegisteredOpModes } from './registeredOpModes'
import { readTeamCodeAsset } from './teamCodeAssets'
import { listJavaFiles, readJavaSources } from './teamCodeJava'

// TeamCode의 OpMode 목록(실행 툴바의 OpMode 고르기, Driver Station처럼)과 등록기(@OpModeRegistrar 메서드). teamCodeJava.ts의
// 목록(같은 경로 규칙·5000개 한도)과 읽기(readJavaSources: 경로·링크 확인, 256 KB 넘는 파일은 tooLarge, 동시 2개)를 그대로
// 쓰고, 파일마다 src/shared/java/opModes.ts로 애너테이션을 읽는다. 렌더러는 프로젝트를 열 때·드롭다운을 열 때·창 포커스 때
// 묻는다. 크기·수정 시각이 그대로인 파일은 다시 읽지 않는다(파싱 결과를 기억한다). 등록기가 등록하는 OpMode는 사이드카가
// 등록기를 실행해야 알 수 있어 따로 묻는다(registeredOpModes.ts, 이 목록의 registrars가 있을 때).

type CachedFile = {
  size: number
  mtimeMs: number
  opModes: ParsedOpMode[]
  registrars: ParsedRegistrar[]
}

// 루트 → 경로 → 마지막 결과. 다음 목록에 없는 파일은 지운다.
const cache = new Map<string, Map<string, CachedFile>>()

// 이름이 없는 파일은 읽을 필요가 없다(\u 이스케이프로 쓴 애너테이션은 javac처럼 읽어야 하므로 그런 파일도 읽는다)
const MAY_HAVE_OPMODE = /TeleOp|Autonomous|OpModeRegistrar|\\u/

function compareRegistrars(a: RegistrarInfo, b: RegistrarInfo): number {
  const text = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)
  return text(a.className, b.className) || text(a.path, b.path) || a.line - b.line
}

// 목록과 함께 그 바탕인 TeamCode Java 파일 목록(크기·수정 시각, 등록기 OpMode 목록의 캐시 키)을 준다
export async function scanOpModes(
  root: unknown
): Promise<{ result: ListOpModesResult; files: JavaFileEntry[] }> {
  if (!isTrustedRoot(root))
    return { result: { ok: false, code: 'notAllowed', detail: 'not an opened project' }, files: [] }
  const key = resolve(root)
  const list = await listJavaFiles(root)
  if (!list.hasTeamCode) {
    cache.delete(key)
    return {
      result: { ok: true, opModes: [], registrars: [], truncated: false, hasTeamCode: false },
      files: []
    }
  }
  const previous = cache.get(key) ?? new Map<string, CachedFile>()
  const next = new Map<string, CachedFile>()
  // 큰 파일은 건너뛴다(사용처와 같은 한도. OpMode는 보통 작다)
  const files = list.files.filter((file) => file.size <= MAX_USAGE_FILE_BYTES)
  const toRead: string[] = []
  for (const file of files) {
    const known = previous.get(file.path)
    if (known && known.size === file.size && known.mtimeMs === file.mtimeMs)
      next.set(file.path, known)
    else toRead.push(file.path)
  }

  // readJavaSources는 바이트 한도를 넘으면 뒤의 것을 deferred로 돌려준다(첫 파일은 늘 준다). 다시 묻는다.
  let pending = toRead
  while (pending.length > 0) {
    const batch = pending.slice(0, MAX_SOURCE_PATHS)
    const rest = pending.slice(MAX_SOURCE_PATHS)
    const result = await readJavaSources(root, batch)
    if (!result.ok) break
    const deferred: string[] = []
    for (const read of result.files) {
      if (read.status === 'deferred') deferred.push(read.path)
      else if (read.status === 'ok') {
        const parsed = MAY_HAVE_OPMODE.test(read.text)
          ? parseOpModeSource(read.text)
          : { opModes: [], registrars: [] }
        // 다른 이름의 최상위 형식 안의 것은 실행 요청이 그 파일의 것으로 받지 않는다(isTopLevelOfFile)
        const inFile = (found: { className: string }): boolean =>
          isTopLevelOfFile(found.className, read.path)
        next.set(read.path, {
          size: read.size,
          mtimeMs: read.mtimeMs,
          opModes: parsed.opModes.filter(inFile),
          registrars: parsed.registrars.filter(inFile)
        })
      }
      // 읽지 못한 파일(없어짐, 잠김, 허용하지 않는 링크)은 목록에서 빼고 다음에 다시 읽는다
    }
    pending = [...deferred, ...rest]
  }
  cache.set(key, next)

  const opModes: OpModeInfo[] = []
  const registrars: RegistrarInfo[] = []
  for (const [path, entry] of next) {
    for (const opMode of entry.opModes) opModes.push({ ...opMode, path })
    for (const registrar of entry.registrars) registrars.push({ ...registrar, path })
  }
  opModes.sort(compareOpModes)
  registrars.sort(compareRegistrars)
  return {
    result: { ok: true, opModes, registrars, truncated: list.truncated, hasTeamCode: true },
    files: list.files
  }
}

export async function listOpModes(root: unknown): Promise<ListOpModesResult> {
  return (await scanOpModes(root)).result
}

// 테스트용
export function clearOpModeCache(): void {
  cache.clear()
}

export function registerOpModesIpc(): void {
  ipcMain.handle(IPC.listOpModes, (_event, root: unknown) => listOpModes(root))
  ipcMain.handle(IPC.listRegisteredOpModes, (_event, root: unknown) => listRegisteredOpModes(root))
  ipcMain.handle(IPC.readTeamCodeAsset, (_event, root: unknown, path: unknown) =>
    readTeamCodeAsset(root, path)
  )
}
