// 렌더러(코드 생성)와 메인 프로세스(TeamCode 쓰기)가 함께 쓰는 생성 파일 규칙

// 생성 파일 앞부분에 넣는 표식. 메인 프로세스는 이 표식이 있는 파일만 덮어쓰거나 지운다.
export const GENERATED_MARKER = '@sandbot-generated'

// TeamCode 폴더 기준 상대 경로, '/' 구분
export type GeneratedFile = { path: string; content: string }

export const GENERATED_JAVA_DIR = 'src/main/java/org/firstinspires/ftc/teamcode/sandbot'
export const GENERATED_XML_DIR = 'src/main/res/xml'

const JAVA_FILE = /^[A-Za-z_$][A-Za-z0-9_$]*\.java$/
const XML_FILE = /^sandbot_[a-z0-9_]+\.xml$/

// 도구가 쓸 수 있는 경로는 생성 패키지의 .java와 res/xml의 sandbot_*.xml뿐이다('..' 등은 정규식에서 걸러진다)
export function isAllowedGeneratedPath(path: string): boolean {
  const slash = path.lastIndexOf('/')
  const dir = path.slice(0, slash)
  const file = path.slice(slash + 1)
  return (
    (dir === GENERATED_JAVA_DIR && JAVA_FILE.test(file)) ||
    (dir === GENERATED_XML_DIR && XML_FILE.test(file))
  )
}

// 생성 표식은 파일 앞 몇 줄 안에 있다
export function hasGeneratedMarker(content: string): boolean {
  return content.slice(0, 400).includes(GENERATED_MARKER)
}

export type SyncGeneratedResult =
  // 프로젝트 폴더에 TeamCode가 없다(FtcRobotController 폴더가 아니다)
  | { status: 'noTeamCode' }
  | {
      status: 'synced'
      written: string[]
      unchanged: string[]
      deleted: string[]
      // 같은 경로에 사람이 만든(표식 없는) 파일이 있어 쓰지 않은 경로
      skipped: string[]
    }

export type GeneratedSyncPlan = {
  write: GeneratedFile[]
  unchanged: string[]
  skipped: string[]
  delete: string[]
}

// TeamCode에 이미 있는 생성 위치의 파일들(existing)과 이번에 만들 파일들(files)을 비교해 할 일을 정한다.
// - 표식 없는(사람이 만든) 파일은 덮어쓰지도 지우지도 않는다.
// - 내용이 같으면 쓰지 않는다(Android Studio가 불필요하게 다시 빌드하지 않게).
// - 이번에 만들지 않는 생성 파일(클래스 이름을 바꾼 이전 파일 등)은 지운다.
// - Windows·macOS 파일 시스템은 대소문자를 구분하지 않으므로 대소문자만 다른 경로는 같은 파일로 본다.
//   이름의 대소문자만 바뀌었으면 이전 파일을 지우고 새 이름으로 쓴다(지우기를 쓰기보다 먼저 한다).
export function planGeneratedSync(
  existing: GeneratedFile[],
  files: GeneratedFile[]
): GeneratedSyncPlan {
  for (const file of files) {
    if (!isAllowedGeneratedPath(file.path))
      throw new Error(`not a generated file path: ${file.path}`)
  }
  const byKey = new Map(existing.map((file) => [file.path.toLowerCase(), file]))
  const plan: GeneratedSyncPlan = { write: [], unchanged: [], skipped: [], delete: [] }
  for (const file of files) {
    const current = byKey.get(file.path.toLowerCase())
    if (!current) {
      plan.write.push(file)
    } else if (!hasGeneratedMarker(current.content)) {
      plan.skipped.push(file.path)
    } else if (current.path === file.path && current.content === file.content) {
      plan.unchanged.push(file.path)
    } else {
      if (current.path !== file.path) plan.delete.push(current.path)
      plan.write.push(file)
    }
  }
  const wanted = new Set(files.map((file) => file.path.toLowerCase()))
  for (const file of existing) {
    if (
      isAllowedGeneratedPath(file.path) &&
      hasGeneratedMarker(file.content) &&
      !wanted.has(file.path.toLowerCase())
    ) {
      plan.delete.push(file.path)
    }
  }
  return plan
}
