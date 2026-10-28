// Gradle 파일 경로 규칙. 경로는 프로젝트 루트 기준 상대 경로이고 '/'로 나눈다. apply from 대상은 git에서 온 글자라
// 믿지 않는 입력이다: 프로젝트 밖(.. 로 벗어남, 절대 경로, 다른 드라이브)과 원격(https://)은 읽지 않고, Windows에서 다른
// 파일을 가리킬 수 있는 이름(':' 대체 데이터 스트림, 장치 이름, 끝의 점·공백)도 받지 않는다. 메인의 파일 읽기
// (src/main/gradleSource.ts)도 같은 규칙으로 다시 확인한다.
import { isWindowsReservedName } from '../windowsNames'

// 이보다 큰 Gradle 파일은 읽지 않는다(tooLarge)
export const MAX_GRADLE_FILE_BYTES = 256 * 1024
const MAX_PATH_LENGTH = 512
const MAX_SEGMENTS = 32

export type ProjectPathResult =
  | { ok: true; path: string }
  | { ok: false; code: 'outsideProject' | 'remoteScript' | 'unsupportedSyntax'; detail: string }

// 이름 하나. 제어 문자, Windows가 받지 않거나 다르게 읽는 글자(: * ? " < > |), 끝의 점·공백, 장치 이름은 안 된다.
function isSafeSegment(name: string): boolean {
  if (name === '' || name === '.' || name === '..' || name.length > 255) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f:*?"<>|\\/]/.test(name)) return false
  if (/[ .]$/.test(name)) return false
  return !isWindowsReservedName(name)
}

// 정규화한 프로젝트 기준 경로인지('a/b.gradle'처럼, '.'·'..'·빈 이름 없음)
export function isSafeProjectPath(path: string): boolean {
  if (typeof path !== 'string' || path === '' || path.length > MAX_PATH_LENGTH) return false
  const segments = path.split('/')
  return segments.length <= MAX_SEGMENTS && segments.every(isSafeSegment)
}

// dir(프로젝트 기준 폴더, 루트는 '') 기준으로 target을 풀어 프로젝트 기준 경로로. '\'는 '/'로 본다(Windows에서 쓴 경로).
export function resolveProjectPath(dir: string, target: string): ProjectPathResult {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(target)) {
    return /^https?:/i.test(target)
      ? { ok: false, code: 'remoteScript', detail: target }
      : { ok: false, code: 'unsupportedSyntax', detail: `unsupported URI ${target}` }
  }
  const slashed = target.replace(/\\/g, '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed))
    return { ok: false, code: 'outsideProject', detail: target }
  const segments = dir === '' ? [] : dir.split('/')
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return { ok: false, code: 'outsideProject', detail: target }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  const path = segments.join('/')
  if (!isSafeProjectPath(path))
    return { ok: false, code: 'unsupportedSyntax', detail: `unsupported file name ${target}` }
  return { ok: true, path }
}

export function dirnameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}
