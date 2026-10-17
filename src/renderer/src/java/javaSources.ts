import { create } from 'zustand'
import type { ReadJavaFileResult } from '../../../shared/ipc'
import { parseTunables } from '../../../shared/java/tunables'
import type { TunableFile } from '../../../shared/java/tunableTypes'
import { useProjectStore } from '../project/projectStore'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { ipcErrorDetail } from './ipcError'

// 연결한 TeamCode Java 파일의 내용에서 읽은 튜닝 값(인스펙터 스크립트 카드). 연결한 파일만 읽는다.
// 메인이 Buffer.toString('utf8')로 읽은 글자를 그대로 파싱한다(BOM이 남아 오프셋이 쓰기와 같다). 저장은 이 캐시를
// 믿지 않고 파일을 다시 읽는다(java/tunableSave.ts). 캐시는 화면 표시와 편집의 base(그때 본 디스크 값)에만 쓴다.
// 프로젝트를 열 때·저장한 뒤·창 포커스 때(Java 목록과 함께, javaIndex.refreshJavaIndex) 연결한 파일을 모두 다시
// 읽고, 연결을 새로 더하면 그 파일만 읽는다. 내용 해시가 같으면 이전 결과를 그대로 쓴다(다시 파싱하지 않음).

export type JavaSource =
  | {
      status: 'ready'
      hash: string
      // false면 보기만 한다(UTF-8로 그대로 되돌릴 수 없음, 생성 표식, 1 MB 초과)
      editable: boolean
      reason?: 'encoding' | 'generated' | 'tooLarge'
      tunables: TunableFile
    }
  | { status: 'missing' }
  | { status: 'failed'; detail: string }

type JavaSourcesState = {
  // 이 캐시를 읽은 프로젝트(다른 프로젝트·세션의 결과는 쓰지 않는다)
  root: string | null
  session: number
  // TeamCode 기준 경로 → 읽은 결과. 아직 읽지 못한 파일은 없다.
  files: Readonly<Record<string, JavaSource>>
}

export const useJavaSourcesStore = create<JavaSourcesState>()(() => ({
  root: null,
  session: 0,
  files: {}
}))

// 씬에서 연결한 Java 경로(겹치지 않게, 경로 순서). objects마다 한 번 만든다.
const linkedMemo = new WeakMap<SceneObjects, readonly string[]>()

export function linkedJavaPaths(objects: SceneObjects): readonly string[] {
  let paths = linkedMemo.get(objects)
  if (!paths) {
    const set = new Set<string>()
    for (const object of Object.values(objects))
      for (const script of object.scripts ?? []) set.add(script.path)
    paths = [...set].sort()
    linkedMemo.set(objects, paths)
  }
  return paths
}

// 읽은 결과 → 캐시 항목. 이전 항목과 해시·쓰기 가능 여부가 같으면 그 항목을 그대로 돌려준다(파싱하지 않음).
export function sourceFromRead(result: ReadJavaFileResult, previous?: JavaSource): JavaSource {
  if (!result.ok)
    return result.code === 'missing'
      ? { status: 'missing' }
      : { status: 'failed', detail: result.detail || result.code }
  if (
    previous?.status === 'ready' &&
    previous.hash === result.hash &&
    previous.editable === result.editable &&
    previous.reason === result.reason
  )
    return previous
  let tunables: TunableFile
  try {
    tunables = parseTunables(result.text)
  } catch (error) {
    console.error('튜닝 값을 읽지 못했다', error)
    return { status: 'failed', detail: ipcErrorDetail(error) }
  }
  const source: JavaSource = {
    status: 'ready',
    hash: result.hash,
    editable: result.editable,
    tunables
  }
  if (result.reason) source.reason = result.reason
  return source
}

// 경로마다 마지막으로 시작한 읽기 번호. 늦게 끝난 이전 읽기가 새 결과를 덮지 않게 한다.
let readSeq = 0
const latestRead = new Map<string, number>()
const inFlight = new Set<string>()

function currentProject(): { root: string | null; session: number } {
  const { root, session } = useProjectStore.getState()
  return { root, session }
}

function isCurrent(root: string, session: number): boolean {
  const project = useProjectStore.getState()
  return project.root === root && project.session === session
}

// 캐시를 이 프로젝트 것으로 맞춘다(다른 프로젝트·세션이면 비운다)
function enterScope(root: string | null, session: number): void {
  const state = useJavaSourcesStore.getState()
  if (state.root === root && state.session === session) return
  latestRead.clear()
  inFlight.clear()
  useJavaSourcesStore.setState({ root, session, files: {} })
}

function put(root: string, session: number, path: string, source: JavaSource): void {
  const state = useJavaSourcesStore.getState()
  if (state.root !== root || state.session !== session || state.files[path] === source) return
  useJavaSourcesStore.setState({ files: { ...state.files, [path]: source } })
}

async function readSource(root: string, session: number, path: string): Promise<void> {
  const id = ++readSeq
  latestRead.set(path, id)
  inFlight.add(path)
  let result: ReadJavaFileResult
  try {
    result = await window.api.readJavaFile(root, path)
  } catch (error) {
    result = { ok: false, code: 'failed', detail: ipcErrorDetail(error) }
  }
  if (latestRead.get(path) !== id) return
  inFlight.delete(path)
  if (!isCurrent(root, session)) return
  put(root, session, path, sourceFromRead(result, useJavaSourcesStore.getState().files[path]))
}

// 연결한 파일을 모두 다시 읽는다(창 포커스: Android Studio에서 고친 값을 보이고, 편집의 base와 다르면 ⚠).
// 연결이 없어진 파일은 캐시에서 뺀다.
export async function refreshJavaSources(): Promise<void> {
  const { root, session } = currentProject()
  enterScope(root, session)
  if (!root) return
  const paths = linkedJavaPaths(useSceneStore.getState().objects)
  const linked = new Set(paths)
  const { files } = useJavaSourcesStore.getState()
  const unlinked = Object.keys(files).filter((path) => !linked.has(path))
  if (unlinked.length > 0) {
    const next = { ...files }
    for (const path of unlinked) {
      delete next[path]
      latestRead.delete(path)
      inFlight.delete(path)
    }
    useJavaSourcesStore.setState({ files: next })
  }
  await Promise.all(paths.map((path) => readSource(root, session, path)))
}

// 아직 읽지 않은 연결 파일만 읽는다(연결을 더했거나 실행 취소로 되살아났을 때). 열기·저장 중에는 건너뛴다
// (끝나면 모두 다시 읽는다).
export function ensureJavaSources(): void {
  const { root, session, busy } = useProjectStore.getState()
  if (!root || busy) return
  enterScope(root, session)
  const { files } = useJavaSourcesStore.getState()
  for (const path of linkedJavaPaths(useSceneStore.getState().objects))
    if (!(path in files) && !inFlight.has(path)) void readSource(root, session, path)
}

// 저장이 쓰거나 다시 읽은 내용을 캐시에 넣는다(진행 중인 이전 읽기 결과는 버린다)
export function putJavaSource(
  root: string,
  session: number,
  path: string,
  result: ReadJavaFileResult
): void {
  if (!isCurrent(root, session)) return
  enterScope(root, session)
  latestRead.set(path, ++readSeq)
  inFlight.delete(path)
  put(root, session, path, sourceFromRead(result, useJavaSourcesStore.getState().files[path]))
}

// 화면이 쓰는 지금 프로젝트의 항목(다른 프로젝트·세션의 캐시면 undefined)
export function currentJavaSource(
  state: JavaSourcesState,
  project: { root: string | null; session: number },
  path: string
): JavaSource | undefined {
  if (!project.root || state.root !== project.root || state.session !== project.session)
    return undefined
  return state.files[path]
}

let initialized = false

// 앱 시작 때 한 번: 연결을 더하면 그 파일을 읽는다
export function initJavaSources(): void {
  if (initialized) return
  initialized = true
  useSceneStore.subscribe((state, previous) => {
    if (state.objects !== previous.objects) ensureJavaSources()
  })
}
