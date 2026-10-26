import { create } from 'zustand'
import type { JavaFileEntry } from '../../../shared/ipc'
import {
  foldCase,
  isLinkableJavaPath,
  JAVA_SOURCE_PREFIX,
  javaClassNameOfPath,
  normalizeLinkPath
} from '../../../shared/teamCodePaths'
import { useProjectStore } from '../project/projectStore'
import type { ScriptLink } from '../scene/model'
import { refreshJavaSources } from './javaSources'

// 열린 프로젝트의 TeamCode Java 파일 목록(스크립트 연결의 선택창·못 찾은 연결의 다시 연결에 쓴다).
// 파일 내용은 읽지 않는다. 클래스 이름은 파일 이름이다(public 최상위 클래스 이름 = 파일 이름, javac가 강제한다).
// 목록은 메인 프로세스(listJavaFiles)가 TeamCode/src/main/java만 훑어 준다. 프로젝트를 열 때, 저장한 뒤,
// 창이 포커스를 얻을 때(Android Studio에서 파일을 옮기고 돌아왔을 때) 다시 읽는다.

export type JavaIndexEntry = {
  // TeamCode 기준 상대 경로(NFC, '/' 구분)
  path: string
  // 패키지까지 붙인 클래스 이름(org.firstinspires.ftc.teamcode.Lift)
  className: string
  simpleName: string
  // 기본 패키지면 빈 문자열
  packageName: string
  size: number
  mtimeMs: number
}

// none: 프로젝트가 없다. loading: 이 프로젝트의 목록을 아직 한 번도 읽지 못했다.
// noTeamCode: 프로젝트에 TeamCode 폴더가 없다. failed: 목록을 읽지 못했다(이전 목록이 있으면 그대로 둔다).
export type JavaIndexStatus = 'none' | 'loading' | 'ready' | 'noTeamCode' | 'failed'

type JavaIndexState = {
  status: JavaIndexStatus
  // 이 목록을 읽은 프로젝트 폴더
  root: string | null
  // 경로 순서
  files: readonly JavaIndexEntry[]
  // 파일 수 한도를 넘어 일부만 담았다(목록에 없다고 해서 파일이 없는 것은 아니다)
  truncated: boolean
  // 목록이 바뀔 때마다 오른다
  revision: number
  // 목록을 읽을 때마다(바뀌지 않았어도) 오른다. 사용처가 읽기 오류 파일을 창 포커스 때 다시 읽는 데 쓴다.
  listedAt: number
}

const INITIAL: JavaIndexState = {
  status: 'none',
  root: null,
  files: [],
  truncated: false,
  revision: 0,
  listedAt: 0
}

export const useJavaIndexStore = create<JavaIndexState>()(() => INITIAL)

// 경로 하나를 인덱스 항목으로. 연결할 수 없는 경로(생성 파일 폴더, Java 식별자가 아닌 폴더 등)는 null.
export function indexEntry(file: JavaFileEntry): JavaIndexEntry | null {
  const path = normalizeLinkPath(file.path)
  if (!isLinkableJavaPath(path)) return null
  const className = javaClassNameOfPath(path)
  const dot = className.lastIndexOf('.')
  return {
    path,
    className,
    simpleName: className.slice(dot + 1),
    packageName: dot < 0 ? '' : className.slice(0, dot),
    size: file.size,
    mtimeMs: file.mtimeMs
  }
}

// 메인이 준 목록을 인덱스로(연결할 수 없는 경로는 빼고, 같은 경로는 한 번만, 경로 순서)
export function buildJavaIndex(files: readonly JavaFileEntry[]): JavaIndexEntry[] {
  const byPath = new Map<string, JavaIndexEntry>()
  for (const file of files) {
    const entry = indexEntry(file)
    if (entry && !byPath.has(entry.path)) byPath.set(entry.path, entry)
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function sameFiles(a: readonly JavaIndexEntry[], b: readonly JavaIndexEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, i) =>
        entry.path === b[i].path && entry.size === b[i].size && entry.mtimeMs === b[i].mtimeMs
    )
  )
}

// 목록마다 한 번 만드는 찾기 표(모듈 캐시). 목록은 바꾸지 않는 배열이라 배열을 키로 쓴다.
type JavaIndexLookup = {
  byPath: Map<string, JavaIndexEntry>
  byClassName: Map<string, JavaIndexEntry[]>
  byFileName: Map<string, JavaIndexEntry[]>
  // 대소문자를 무시한 경로(Windows에서 대소문자만 바꾼 이름 바꾸기·git mv)
  byFoldedPath: Map<string, JavaIndexEntry[]>
}

const lookups = new WeakMap<readonly JavaIndexEntry[], JavaIndexLookup>()

function push(map: Map<string, JavaIndexEntry[]>, key: string, entry: JavaIndexEntry): void {
  const list = map.get(key)
  if (list) list.push(entry)
  else map.set(key, [entry])
}

export function javaIndexLookup(files: readonly JavaIndexEntry[]): JavaIndexLookup {
  let lookup = lookups.get(files)
  if (!lookup) {
    lookup = {
      byPath: new Map(),
      byClassName: new Map(),
      byFileName: new Map(),
      byFoldedPath: new Map()
    }
    for (const entry of files) {
      lookup.byPath.set(entry.path, entry)
      push(lookup.byFoldedPath, foldCase(entry.path), entry)
      push(lookup.byClassName, entry.className, entry)
      push(lookup.byFileName, entry.simpleName, entry)
    }
    lookups.set(files, lookup)
  }
  return lookup
}

// 경로의 파일 이름에서 확장자를 뺀 것(= 단순 클래스 이름)
export function simpleNameOfPath(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.endsWith('.java') ? file.slice(0, -'.java'.length) : file
}

// 화면에 보이는 짧은 경로(TeamCode/src/main/java 아래 경로)
export function displayJavaPath(path: string): string {
  return path.startsWith(JAVA_SOURCE_PREFIX) ? path.slice(JAVA_SOURCE_PREFIX.length) : path
}

// 경로를 못 찾은 연결의 새 위치 후보. 대소문자만 다른 경로(Android Studio에서 대소문자만 바꾼 이름)가 하나뿐이면 그것,
// 아니면 같은 클래스 이름(패키지 포함)의 파일이 하나뿐이면 그것, 아니면 같은 파일 이름이 하나뿐이면 그것이다. 둘 이상이거나 없으면 null(어느 것인지 모르므로 고르지 않는다). 자동으로 바꾸지는 않는다.
export function relinkCandidate(
  files: readonly JavaIndexEntry[],
  link: ScriptLink
): JavaIndexEntry | null {
  const lookup = javaIndexLookup(files)
  const path = normalizeLinkPath(link.path)
  if (lookup.byPath.has(path)) return null
  const sameFolded = lookup.byFoldedPath.get(foldCase(path)) ?? []
  if (sameFolded.length === 1) return sameFolded[0]
  const sameClass = lookup.byClassName.get(link.className) ?? []
  if (sameClass.length === 1) return sameClass[0]
  const sameName = lookup.byFileName.get(simpleNameOfPath(link.path)) ?? []
  return sameName.length === 1 ? sameName[0] : null
}

// 연결 카드의 상태
export type ScriptLinkStatus =
  | { kind: 'found' }
  | { kind: 'missing'; candidate: JavaIndexEntry | null }
  // 프로젝트 없음, TeamCode 없음, 아직 목록을 읽는 중, 목록을 다 읽지 못해(실패·한도 넘음) 있는지 모름
  | { kind: 'noProject' | 'noTeamCode' | 'checking' | 'unknown' }

export function scriptLinkStatus(
  index: Pick<JavaIndexState, 'status' | 'root' | 'files' | 'truncated'>,
  projectRoot: string | null,
  link: ScriptLink
): ScriptLinkStatus {
  if (!projectRoot) return { kind: 'noProject' }
  if (index.root !== projectRoot || index.status === 'loading' || index.status === 'none')
    return { kind: 'checking' }
  if (index.status === 'noTeamCode') return { kind: 'noTeamCode' }
  if (javaIndexLookup(index.files).byPath.has(normalizeLinkPath(link.path)))
    return { kind: 'found' }
  if (index.status === 'failed' || index.truncated) return { kind: 'unknown' }
  return { kind: 'missing', candidate: relinkCandidate(index.files, link) }
}

// 모든 파일에 공통인 앞쪽 패키지 세그먼트 수(예: org.firstinspires.ftc.teamcode → 4)
function commonPackageSegments(files: readonly JavaIndexEntry[]): number {
  if (files.length === 0) return 0
  const first = files[0].packageName.split('.')
  let count = first.length
  for (const entry of files) {
    const parts = entry.packageName.split('.')
    let i = 0
    while (i < count && i < parts.length && parts[i] === first[i]) i++
    count = i
  }
  return count
}

// 선택창 항목: 이미 연결한 경로는 빼고, 검색어(대소문자 무시)가 클래스 이름에 있는 것을 먼저, 그다음 패키지에 있는 것을
// 보인다. 패키지는 모든 파일에 공통인 앞부분(org.firstinspires.ftc.teamcode 등)과 'src/main/java/'·'.java'를 빼고 본다
// (그대로 보면 짧은 검색어가 모든 파일에 맞는다). 같은 무리 안에서는 클래스 이름으로 시작하는 것을 먼저, 그다음
// 클래스 이름·경로 순이다.
export function scriptChoices(
  files: readonly JavaIndexEntry[],
  excludedPaths: ReadonlySet<string>,
  query: string
): JavaIndexEntry[] {
  const needle = query.trim().toLowerCase()
  const common = needle ? commonPackageSegments(files) : 0
  const ranked: { entry: JavaIndexEntry; rank: number }[] = []
  for (const entry of files) {
    if (excludedPaths.has(entry.path)) continue
    const name = entry.simpleName.toLowerCase()
    let rank: number
    if (!needle) rank = 0
    else if (name.startsWith(needle)) rank = 0
    else if (name.includes(needle)) rank = 1
    else if (
      entry.packageName
        .split('.')
        .slice(common)
        .some((segment) => segment.toLowerCase().includes(needle))
    )
      rank = 2
    else continue
    ranked.push({ entry, rank })
  }
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        compare(a.entry.simpleName.toLowerCase(), b.entry.simpleName.toLowerCase()) ||
        compare(a.entry.path, b.entry.path)
    )
    .map(({ entry }) => entry)
}

// ---- 다시 읽기 ----

let inFlight: Promise<void> | null = null
// 읽는 중에 다시 요청이 왔다(끝나면 한 번 더 읽는다)
let again = false

// 열린 프로젝트의 목록을 다시 읽는다. 이미 읽는 중이면 그것이 끝난 뒤 한 번 더 읽고(요청을 모은다), 같은 약속을 돌려준다.
// 읽는 사이 다른 프로젝트를 열었으면(projectStore.session·root) 결과를 버린다.
// 연결한 파일의 내용(튜닝 값, java/javaSources.ts)도 함께 다시 읽는다. 크기·수정 시각이 같아도 값이 바뀌었을 수 있다.
export function refreshJavaIndex(): Promise<void> {
  if (inFlight) {
    again = true
    return inFlight
  }
  inFlight = (async () => {
    try {
      do {
        again = false
        await Promise.all([refreshOnce(), refreshJavaSources()])
      } while (again)
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

async function refreshOnce(): Promise<void> {
  const { root, session } = useProjectStore.getState()
  const before = useJavaIndexStore.getState()
  if (!root) {
    if (before.status !== 'none')
      useJavaIndexStore.setState({ ...INITIAL, revision: before.revision + 1 })
    return
  }
  // 다른 프로젝트의 목록은 바로 버린다(읽는 동안 이전 프로젝트 파일로 다시 연결하지 않게)
  if (before.root !== root) {
    useJavaIndexStore.setState({
      status: 'loading',
      root,
      files: [],
      truncated: false,
      revision: before.revision + 1
    })
  }
  const stale = (): boolean => {
    const project = useProjectStore.getState()
    return project.session !== session || project.root !== root
  }
  let list
  try {
    list = await window.api.listJavaFiles(root)
  } catch (error) {
    if (stale()) return
    console.error('TeamCode Java 목록을 읽지 못했다', error)
    useJavaIndexStore.setState({ status: 'failed' })
    return
  }
  if (stale()) return
  const current = useJavaIndexStore.getState()
  if (!list.hasTeamCode) {
    if (current.status === 'noTeamCode') return
    useJavaIndexStore.setState({
      status: 'noTeamCode',
      files: [],
      truncated: false,
      revision: current.revision + 1
    })
    return
  }
  const files = buildJavaIndex(list.files)
  if (
    current.status === 'ready' &&
    current.truncated === list.truncated &&
    sameFiles(current.files, files)
  ) {
    useJavaIndexStore.setState({ listedAt: current.listedAt + 1 })
    return
  }
  useJavaIndexStore.setState({
    status: 'ready',
    files,
    truncated: list.truncated,
    revision: current.revision + 1
  })
}

// 창 포커스로 다시 읽기. 포커스는 짧은 사이에 여러 번 올 수 있으므로(네이티브 대화상자가 닫힐 때 등) 모아서
// 마지막 뒤 이만큼(ms) 지나 한 번 읽는다. 열기·저장 중(busy)이면 건너뛴다(끝나면 그쪽이 다시 읽는다).
export const FOCUS_REFRESH_DELAY = 300

let focusTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleFocusRefresh(): void {
  if (focusTimer) clearTimeout(focusTimer)
  focusTimer = setTimeout(() => {
    focusTimer = null
    if (useProjectStore.getState().busy) return
    void refreshJavaIndex()
  }, FOCUS_REFRESH_DELAY)
}
