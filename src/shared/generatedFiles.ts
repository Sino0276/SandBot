// 렌더러(코드 생성)와 메인 프로세스(TeamCode 쓰기)가 함께 쓰는 생성 파일 규칙

// 생성 파일 앞부분에 넣는 표식. 뒤에 파일 내용의 해시가 붙는다(`@sandbot-generated 1a2b…`).
// 메인 프로세스는 표식과 해시가 맞는(도구가 쓴 그대로인) 파일만 덮어쓰거나 지운다.
// 팀이 생성 파일을 고치거나 복사·이름 변경하면 해시가 맞지 않으므로 사람이 만든 파일로 보고 건드리지 않는다.
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

// 53비트 문자열 해시(cyrb53). 보안용이 아니라 도구가 쓴 내용이 그대로인지 확인하는 데 쓴다.
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

// git의 autocrlf가 줄바꿈을 바꿔도 같은 내용으로 본다
function normalize(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

const STAMP = new RegExp(`${GENERATED_MARKER}( [0-9a-f]{14})?`)

// 표식은 파일 앞 몇 줄 안에 있다
function findStamp(content: string): RegExpExecArray | null {
  const match = STAMP.exec(content.slice(0, 400))
  return match
}

// 생성 내용(표식 하나를 포함)에 해시를 붙인다
export function stampGenerated(content: string): string {
  if (!content.slice(0, 400).includes(GENERATED_MARKER))
    throw new Error('generated content has no marker')
  return content.replace(GENERATED_MARKER, `${GENERATED_MARKER} ${cyrb53(normalize(content))}`)
}

// - none: 표식 없음(사람이 만든 파일)
// - pristine: 도구가 쓴 그대로
// - modified: 표식은 있지만 내용이 바뀌었다(팀이 고쳤거나 복사·이름 변경). 해시 없는 이전 형식도 여기에 든다.
export type GeneratedState = 'none' | 'pristine' | 'modified'

export function generatedState(content: string): GeneratedState {
  const match = findStamp(content)
  if (!match) return 'none'
  if (!match[1]) return 'modified'
  const unstamped =
    content.slice(0, match.index) + GENERATED_MARKER + content.slice(match.index + match[0].length)
  return cyrb53(normalize(unstamped)) === match[1].trim() ? 'pristine' : 'modified'
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
      // 같은 경로의 생성 파일을 팀이 고쳐서(해시 불일치) 덮어쓰지 않은 경로
      modified: string[]
      // 대소문자만 바뀐 이름(Windows·macOS의 git은 이 변경을 기록하지 않으므로 git mv가 필요하다)
      caseRenamed: { from: string; to: string }[]
    }

export type GeneratedSyncPlan = {
  write: GeneratedFile[]
  unchanged: string[]
  skipped: string[]
  modified: string[]
  delete: string[]
  caseRenamed: { from: string; to: string }[]
}

// TeamCode에 이미 있는 생성 위치의 파일들(existing)과 이번에 만들 파일들(files)을 비교해 할 일을 정한다.
// - 사람이 만든 파일과 팀이 고친 생성 파일은 덮어쓰지도 지우지도 않는다.
// - 내용이 같으면 쓰지 않는다(Android Studio가 불필요하게 다시 빌드하지 않게).
// - 이번에 만들지 않는, 도구가 쓴 그대로인 생성 파일(클래스 이름을 바꾼 이전 파일 등)은 지운다.
// - Windows·macOS 파일 시스템은 대소문자를 구분하지 않으므로 대소문자만 다른 경로는 같은 파일로 본다.
//   이름의 대소문자만 바뀌었으면 이전 파일을 지우고 새 이름으로 쓴다(메인 프로세스는 지우기를 쓰기보다 먼저 한다).
export function planGeneratedSync(
  existing: GeneratedFile[],
  files: GeneratedFile[]
): GeneratedSyncPlan {
  for (const file of files) {
    if (!isAllowedGeneratedPath(file.path))
      throw new Error(`not a generated file path: ${file.path}`)
    if (generatedState(file.content) !== 'pristine')
      throw new Error(`generated file is not stamped: ${file.path}`)
  }
  const byKey = new Map<string, GeneratedFile[]>()
  for (const file of existing) {
    const key = file.path.toLowerCase()
    byKey.set(key, [...(byKey.get(key) ?? []), file])
  }
  const plan: GeneratedSyncPlan = {
    write: [],
    unchanged: [],
    skipped: [],
    modified: [],
    delete: [],
    caseRenamed: []
  }
  for (const file of files) {
    const group = byKey.get(file.path.toLowerCase()) ?? []
    const states = group.map((current) => generatedState(current.content))
    if (states.includes('none')) {
      plan.skipped.push(file.path)
    } else if (states.includes('modified')) {
      plan.modified.push(file.path)
    } else if (
      group.length === 1 &&
      group[0].path === file.path &&
      group[0].content === file.content
    ) {
      plan.unchanged.push(file.path)
    } else {
      for (const current of group) {
        if (current.path === file.path) continue
        plan.delete.push(current.path)
        plan.caseRenamed.push({ from: current.path, to: file.path })
      }
      plan.write.push(file)
    }
  }
  const wanted = new Set(files.map((file) => file.path.toLowerCase()))
  for (const file of existing) {
    if (
      isAllowedGeneratedPath(file.path) &&
      generatedState(file.content) === 'pristine' &&
      !wanted.has(file.path.toLowerCase())
    ) {
      plan.delete.push(file.path)
    }
  }
  return plan
}
