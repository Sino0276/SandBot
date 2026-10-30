import { constants } from 'fs'
import { open as openFile, realpath, stat } from 'fs/promises'
import { join, resolve } from 'path'
import type { ReadTeamCodeAssetResult, TeamCodeAssetMime } from '../shared/ipc'
import {
  isImageExtension,
  isTeamCodeAssetPath,
  MAX_TEAMCODE_ASSET_BYTES,
  TEAMCODE_ASSETS_SEGMENTS
} from '../shared/teamCodeAssets'
import { isTrustedRoot } from './projectRoots'
import { containedIn } from './teamCodeJava'

// FTC Dashboard 오버레이 그림(drawImage '/images/…')을 TeamCode/src/main/assets에서 읽는다(라이브러리 L2).
// 읽기만 한다. root는 열거나 저장한 프로젝트만 받고(projectRoots.ts), 경로는 shared/teamCodeAssets.ts 규칙으로 확인하고,
// 링크를 풀어도 assets 안의 그림 파일이어야 한다. 내용은 PNG·JPEG·WebP·GIF 머리로 확인한다(확장자만 믿지 않는다).

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

// 파일 머리로 그림 형식을 정한다. 알 수 없으면 null.
export function imageMime(bytes: Uint8Array): TeamCodeAssetMime | null {
  const starts = (...values: number[]): boolean => values.every((value, i) => bytes[i] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  // GIF87a·GIF89a
  if (
    starts(0x47, 0x49, 0x46, 0x38) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
    return 'image/gif'
  // RIFF....WEBP
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp'
  return null
}

export async function readTeamCodeAsset(
  root: unknown,
  relPath: unknown
): Promise<ReadTeamCodeAssetResult> {
  if (!isTrustedRoot(root))
    return { ok: false, code: 'notAllowed', detail: 'not an opened project' }
  if (!isTeamCodeAssetPath(relPath))
    return { ok: false, code: 'notAllowed', detail: 'not a TeamCode image asset path' }
  const assetsRoot = join(resolve(root), ...TEAMCODE_ASSETS_SEGMENTS)
  const file = join(assetsRoot, ...relPath.split('/'))
  try {
    if (!(await stat(file)).isFile())
      return { ok: false, code: 'notAllowed', detail: 'not a regular file' }
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return { ok: false, code: 'missing', detail: relPath }
    return { ok: false, code: 'failed', detail: errorText(error) }
  }
  let realRoot: string
  let real: string
  try {
    ;[realRoot, real] = await Promise.all([realpath(assetsRoot), realpath(file)])
  } catch (error) {
    // 링크를 풀 수 없으면 assets 안인지 알 수 없으므로 읽지 않는다
    return { ok: false, code: 'notAllowed', detail: `cannot resolve path: ${errorText(error)}` }
  }
  if (!containedIn(realRoot, real) || !isImageExtension(real))
    return { ok: false, code: 'notAllowed', detail: 'outside TeamCode/src/main/assets' }

  // 링크를 따르지 않고 열어(POSIX O_NOFOLLOW) 그 핸들로 크기와 내용을 읽는다. O_NONBLOCK은 그사이 FIFO로 바뀐 경로에서
  // 멈추지 않게 한다.
  const flags =
    constants.O_NOFOLLOW !== undefined
      ? constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      : 'r'
  let raw: Buffer
  try {
    const handle = await openFile(real, flags)
    try {
      const info = await handle.stat()
      if (!info.isFile()) return { ok: false, code: 'notAllowed', detail: 'not a regular file' }
      if (info.size > MAX_TEAMCODE_ASSET_BYTES)
        return { ok: false, code: 'tooLarge', detail: `${info.size} bytes` }
      raw = await handle.readFile()
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return { ok: false, code: 'missing', detail: relPath }
    if (code === 'ELOOP') return { ok: false, code: 'notAllowed', detail: 'became a link' }
    return { ok: false, code: 'failed', detail: errorText(error) }
  }
  // stat한 뒤 커졌다
  if (raw.length > MAX_TEAMCODE_ASSET_BYTES)
    return { ok: false, code: 'tooLarge', detail: `${raw.length} bytes` }
  const mime = imageMime(raw)
  if (!mime) return { ok: false, code: 'failed', detail: 'not a PNG, JPEG, WebP or GIF image' }
  // Buffer는 풀의 큰 바탕 버퍼를 나눠 쓸 수 있다. IPC가 바탕 전체를 복사하지 않게 제 크기로 복사한다.
  return { ok: true, mime, bytes: new Uint8Array(raw) }
}
