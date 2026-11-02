import { createHash } from 'crypto'
import { realpath, stat } from 'fs/promises'
import path from 'path'
import type { RevealSimFileResult } from '../../shared/ipc'
import { isTrustedRoot } from '../projectRoots'
import { containedIn } from '../teamCodeJava'

// 프로젝트마다의 모의 저장소(AppUtil.ROOT_FOLDER, 로봇의 /sdcard/FIRST, 라이브러리 L2)의 경로와, 그 안의 파일(Road
// Runner 튜닝 결과 JSON)을 운영체제 파일 관리자로 보이기. 폴더는 userData/sim-files 아래라 TeamCode·프로젝트 밖이다.

type PathApi = Pick<typeof path, 'join' | 'isAbsolute' | 'relative' | 'sep'>

// <simRoot>/<sha256(링크를 푼 프로젝트 루트) 앞 16자>/FIRST(만들지 않는다, launch.ts simFirstFolder가 만든다)
export async function simFirstFolderPath(simRoot: string, projectRoot: string): Promise<string> {
  const real = await realpath(projectRoot).catch(() => path.resolve(projectRoot))
  const key = createHash('sha256').update(real, 'utf8').digest('hex').slice(0, 16)
  return path.join(simRoot, key, 'FIRST')
}

const MAX_SIM_PATH = 4096

// 사이드카가 알린 모의 저장소 기준 경로('/'로 나눔, RrTuning.relative) → 절대 경로. 빈 세그먼트·'.'·'..', 역슬래시·
// 드라이브(':')·NUL이 있거나 절대 경로면 null(모의 저장소 밖을 가리키지 않게). 사이드카 출력은 팀 코드와 같은 JVM에서
// 오므로 그대로 믿지 않는다(보일 때 메인이 revealSimFile로 다시 확인한다).
export function simFilePath(
  firstFolder: string,
  relative: string,
  api: PathApi = path
): string | null {
  if (
    relative === '' ||
    relative.length > MAX_SIM_PATH ||
    relative.includes('\u0000') ||
    /[\\:]/.test(relative)
  )
    return null
  if (relative.startsWith('/') || api.isAbsolute(relative)) return null
  const segments = relative.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return api.join(firstFolder, ...segments)
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 모의 저장소의 파일을 파일 관리자에서 보인다(Console의 Road Runner 튜닝 결과 줄). root는 열거나 저장한 프로젝트만 받고,
// file은 링크를 풀어도 그 프로젝트의 모의 저장소(simRoot/<해시>/FIRST) 안의 보통 파일이어야 한다(렌더러가 보낸 경로를
// 믿지 않는다). reveal은 shell.showItemInFolder(시험은 가짜).
export async function revealSimFile(
  simRoot: string,
  root: unknown,
  file: unknown,
  reveal: (file: string) => void
): Promise<RevealSimFileResult> {
  if (!isTrustedRoot(root))
    return { ok: false, code: 'notAllowed', detail: 'not an opened project' }
  if (
    typeof file !== 'string' ||
    file.length > MAX_SIM_PATH ||
    file.includes('\u0000') ||
    !path.isAbsolute(file)
  )
    return { ok: false, code: 'notAllowed', detail: 'not an absolute path' }
  const folder = await simFirstFolderPath(simRoot, root)
  // 글자로 먼저 본다(없는 파일이어도 밖이면 notAllowed). 메인이 알린 경로는 이 폴더 글자로 만든 것이다.
  if (!containedIn(path.resolve(folder), path.resolve(file)))
    return { ok: false, code: 'notAllowed', detail: 'outside the simulated storage' }
  let realFolder: string
  let real: string
  try {
    realFolder = await realpath(folder)
    real = await realpath(file)
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, code: 'missing', detail: file }
    return { ok: false, code: 'failed', detail: errorText(error) }
  }
  // 링크를 풀어도 그 안이어야 한다
  if (!containedIn(realFolder, real))
    return { ok: false, code: 'notAllowed', detail: 'outside the simulated storage' }
  try {
    if (!(await stat(real)).isFile())
      return { ok: false, code: 'notAllowed', detail: 'not a regular file' }
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, code: 'missing', detail: file }
    return { ok: false, code: 'failed', detail: errorText(error) }
  }
  reveal(real)
  return { ok: true }
}
