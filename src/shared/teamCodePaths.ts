// 오브젝트에 연결하는 TeamCode Java 파일의 경로 규칙. 렌더러(프로젝트 파일 읽기)와 메인 프로세스(IPC마다)가
// 같이 검사한다. project.json은 git에서 오므로 경로는 믿을 수 없는 입력이다.
import { GENERATED_JAVA_DIR } from './generatedFiles'
import { isWindowsReservedName } from './windowsNames'

export { isWindowsReservedName, WINDOWS_RESERVED_NAMES } from './windowsNames'

// 프로젝트(FtcRobotController 폴더) 안의 TeamCode 모듈 폴더
export const TEAMCODE_DIR = 'TeamCode'
// 연결 경로는 TeamCode 기준 상대 경로이고 '/'로 나눈다. Java 소스는 이 폴더 아래에만 있다.
export const JAVA_SOURCE_PREFIX = 'src/main/java/'

const JAVA_EXTENSION = '.java'
// 패키지 폴더와 파일 이름(확장자 앞)은 Java 식별자여야 한다(그래야 컴파일된다). 이 규칙만으로 '~'(8.3 짧은 이름),
// 끝의 점·공백(Windows가 지운다), ':'(대체 데이터 스트림·드라이브 문자), '\', UNC, 제어 문자가 빠진다.
const SEGMENT = /^[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]*$/u
// 프로젝트 파일에서 온 아주 긴 문자열을 검사하지 않는다
const MAX_PATH_LENGTH = 1024

// 대소문자를 구분하지 않는 파일 시스템(Windows·macOS)에서 같은 이름인지 볼 때 쓴다. 대문자로 바꾼 뒤
// 소문자로 바꾸면 'ſ'(→ S)·'K'(켈빈 기호, → k)처럼 한쪽으로만 바뀌는 글자도 같은 글자로 모인다.
function foldCase(text: string): string {
  return text.toUpperCase().toLowerCase()
}

// 저장·비교하는 경로는 NFC다(macOS는 파일 이름을 NFD로 줄 수 있다)
export function normalizeLinkPath(path: string): string {
  return path.normalize('NFC')
}

function isSegment(name: string): boolean {
  return SEGMENT.test(name) && !isWindowsReservedName(name)
}

// 생성 패키지 폴더 자신이나 그 안(대소문자 무시)
function isInGeneratedFolder(path: string): boolean {
  const generated = foldCase(GENERATED_JAVA_DIR)
  const folded = foldCase(path)
  return folded === generated || folded.startsWith(`${generated}/`)
}

// 연결할 수 있는 Java 파일 경로인지(TeamCode 기준, NFC). 생성 패키지 폴더(대소문자 무시)의 파일은 받지 않는다.
export function isLinkableJavaPath(path: string): boolean {
  if (typeof path !== 'string' || path.length > MAX_PATH_LENGTH) return false
  if (path !== normalizeLinkPath(path) || !path.startsWith(JAVA_SOURCE_PREFIX)) return false
  const segments = path.slice(JAVA_SOURCE_PREFIX.length).split('/')
  const file = segments.pop() ?? ''
  if (!file.endsWith(JAVA_EXTENSION)) return false
  if (!isSegment(file.slice(0, -JAVA_EXTENSION.length))) return false
  if (!segments.every(isSegment)) return false
  return !isInGeneratedFolder(path)
}

// 연결할 파일이 들어 있을 수 있는 패키지 폴더인지('src/main/java/org/x'처럼 끝에 '/' 없이). 메인 프로세스가
// TeamCode를 훑을 때 이 규칙에 맞지 않는 폴더(생성 패키지, build, 식별자가 아닌 이름)로는 내려가지 않는다.
export function isLinkableJavaFolder(path: string): boolean {
  if (typeof path !== 'string' || path.length > MAX_PATH_LENGTH) return false
  if (path !== normalizeLinkPath(path) || !path.startsWith(JAVA_SOURCE_PREFIX)) return false
  return (
    path.slice(JAVA_SOURCE_PREFIX.length).split('/').every(isSegment) && !isInGeneratedFolder(path)
  )
}

// 폴더와 파일 이름으로 만든 패키지까지 붙인 클래스 이름. 'src/main/java/org/x/Lift.java' → 'org.x.Lift'.
// public 최상위 클래스의 이름은 파일 이름과 같아야 하므로(javac) 파일을 읽지 않고 정한다.
// isLinkableJavaPath를 통과한 경로에 쓴다.
export function javaClassNameOfPath(path: string): string {
  const inner = path.startsWith(JAVA_SOURCE_PREFIX) ? path.slice(JAVA_SOURCE_PREFIX.length) : path
  const stem = inner.endsWith(JAVA_EXTENSION) ? inner.slice(0, -JAVA_EXTENSION.length) : inner
  return stem.split('/').join('.')
}
