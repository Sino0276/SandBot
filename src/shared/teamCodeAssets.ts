// TeamCode의 assets 파일 경로 규칙(FTC Dashboard 오버레이 그림, 라이브러리 L2). Dashboard는 drawImage의 '/images/…'를
// 로봇 앱의 assets에서 내준다. SandBot은 TeamCode/src/main/assets/images 아래의 그림만 읽는다(메인 teamCodeAssets.ts가
// 열거나 저장한 루트에서만, 이 규칙으로 다시 확인한다). 경로는 팀 코드가 보낸 글자라 믿을 수 없는 입력이다.
import { isWindowsReservedName } from './windowsNames'

// 프로젝트 기준 assets 폴더(TeamCode 모듈의 src/main/assets)
export const TEAMCODE_ASSETS_SEGMENTS = ['TeamCode', 'src', 'main', 'assets'] as const
// Dashboard 그림 경로의 앞부분과 그에 맞는 assets 기준 폴더
export const DASH_IMAGE_PREFIX = '/images/'
export const ASSET_IMAGE_PREFIX = 'images/'

// 그림 하나의 크기 한도(필드 그림은 4096² WebP도 몇 MB다)
export const MAX_TEAMCODE_ASSET_BYTES = 16 * 1024 * 1024

const MAX_ASSET_PATH_LENGTH = 1024
const MAX_SEGMENTS = 16
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
// 제어 문자와 Windows가 파일 이름에 받지 않는 글자(드라이브·대체 데이터 스트림의 ':', 와일드카드 등)
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f\\:*?"<>|]/

function isSegment(name: string): boolean {
  if (name === '' || name.startsWith('.') || FORBIDDEN.test(name)) return false
  // Windows는 끝의 점·공백을 지워 다른 파일을 연다
  if (/[ .]$/.test(name) || name.startsWith(' ')) return false
  return !isWindowsReservedName(name)
}

export function assetExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isImageExtension(name: string): boolean {
  return IMAGE_EXTENSIONS.has(assetExtension(name))
}

// assets 기준 그림 경로인지('images/field.png'처럼 '/'로 나눈 NFC 글자). 점·빈 세그먼트, '..', 숨김 이름, 제어 문자,
// Windows 장치 이름은 받지 않는다. 확장자는 png·jpg·jpeg·webp·gif다(대소문자 무시).
export function isTeamCodeAssetPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > MAX_ASSET_PATH_LENGTH) return false
  if (path !== path.normalize('NFC') || !path.startsWith(ASSET_IMAGE_PREFIX)) return false
  const segments = path.split('/')
  if (segments.length > MAX_SEGMENTS || !segments.every(isSegment)) return false
  return isImageExtension(segments[segments.length - 1])
}

// Dashboard op의 그림 경로 → assets 기준 경로. 브라우저처럼 '?'·'#' 뒤를 버리고 퍼센트 인코딩을 푼다. '/images/' 밖
// (기본 필드 그림 '/dash/…', 외부 URL 등)이나 규칙에 맞지 않으면 null(그리지 않는다).
export function dashImageAssetPath(dashPath: string): string | null {
  const end = dashPath.search(/[?#]/)
  const raw = end < 0 ? dashPath : dashPath.slice(0, end)
  if (!raw.startsWith(DASH_IMAGE_PREFIX)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw.slice(DASH_IMAGE_PREFIX.length))
  } catch {
    return null
  }
  const path = `${ASSET_IMAGE_PREFIX}${decoded}`.normalize('NFC')
  return isTeamCodeAssetPath(path) ? path : null
}
