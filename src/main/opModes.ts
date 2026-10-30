import { ipcMain } from 'electron'
import { resolve } from 'path'
import {
  IPC,
  MAX_SOURCE_PATHS,
  MAX_USAGE_FILE_BYTES,
  type ReadTeamCodeAssetResult
} from '../shared/ipc'
import { compareOpModes, parseOpModes, type ParsedOpMode } from '../shared/java/opModes'
import type { ListOpModesResult, ListRegisteredResult, OpModeInfo } from '../shared/play'
import { isTrustedRoot } from './projectRoots'
import { listJavaFiles, readJavaSources } from './teamCodeJava'

// TeamCode의 OpMode 목록(실행 툴바의 OpMode 고르기, Driver Station처럼). teamCodeJava.ts의 목록(같은 경로 규칙·5000개
// 한도)과 읽기(readJavaSources: 경로·링크 확인, 256 KB 넘는 파일은 tooLarge, 동시 2개)를 그대로 쓰고, 파일마다
// src/shared/java/opModes.ts로 애너테이션을 읽는다. 렌더러는 프로젝트를 열 때·드롭다운을 열 때·창 포커스 때 묻는다.
// 크기·수정 시각이 그대로인 파일은 다시 읽지 않는다(파싱 결과를 기억한다).

type CachedFile = { size: number; mtimeMs: number; opModes: ParsedOpMode[] }

// 루트 → 경로 → 마지막 결과. 다음 목록에 없는 파일은 지운다.
const cache = new Map<string, Map<string, CachedFile>>()

// 이름이 없는 파일은 읽을 필요가 없다(\u 이스케이프로 쓴 애너테이션은 javac처럼 읽어야 하므로 그런 파일도 읽는다)
const MAY_HAVE_OPMODE = /TeleOp|Autonomous|\\u/

export async function listOpModes(root: unknown): Promise<ListOpModesResult> {
  if (!isTrustedRoot(root))
    return { ok: false, code: 'notAllowed', detail: 'not an opened project' }
  const key = resolve(root)
  const list = await listJavaFiles(root)
  if (!list.hasTeamCode) {
    cache.delete(key)
    return { ok: true, opModes: [], registrars: [], truncated: false, hasTeamCode: false }
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
      else if (read.status === 'ok')
        next.set(read.path, {
          size: read.size,
          mtimeMs: read.mtimeMs,
          opModes: MAY_HAVE_OPMODE.test(read.text) ? parseOpModes(read.text) : []
        })
      // 읽지 못한 파일(없어짐, 잠김, 허용하지 않는 링크)은 목록에서 빼고 다음에 다시 읽는다
    }
    pending = [...deferred, ...rest]
  }
  cache.set(key, next)

  const opModes: OpModeInfo[] = []
  for (const [path, entry] of next) {
    for (const opMode of entry.opModes) opModes.push({ ...opMode, path })
  }
  opModes.sort(compareOpModes)
  // 라이브러리 L2 갈래 A: @OpModeRegistrar 메서드를 글자로 찾아 채운다
  return { ok: true, opModes, registrars: [], truncated: list.truncated, hasTeamCode: true }
}

// 테스트용
export function clearOpModeCache(): void {
  cache.clear()
}

export function registerOpModesIpc(): void {
  ipcMain.handle(IPC.listOpModes, (_event, root: unknown) => listOpModes(root))
  // 라이브러리 L2 갈래 A(src/main/registeredOpModes.ts)·C(src/main/teamCodeAssets.ts)가 바꾼다
  ipcMain.handle(IPC.listRegisteredOpModes, (): ListRegisteredResult => ({
    ok: false,
    code: 'failed',
    detail: 'not implemented'
  }))
  ipcMain.handle(IPC.readTeamCodeAsset, (): ReadTeamCodeAssetResult => ({
    ok: false,
    code: 'failed',
    detail: 'not implemented'
  }))
}
