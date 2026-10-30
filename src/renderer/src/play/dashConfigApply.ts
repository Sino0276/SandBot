import { create } from 'zustand'
import type { DashConfigNode } from '../../../shared/dashboard'
import type { ReadJavaFileResult } from '../../../shared/ipc'
import { ipcErrorDetail } from '../java/ipcError'
import {
  currentJavaSource,
  putJavaSource,
  sourceFromRead,
  useJavaSourcesStore,
  type JavaSource
} from '../java/javaSources'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import { checkApply, tunableTarget, type ApplyCheck } from './dashConfigModel'

// Config 탭의 [파일에 반영](라이브러리 L2): Dashboard 값 칸을 TeamCode 튜닝 값(저장하지 않은 변경)으로 옮긴다.
// 인스펙터 튜닝 값 칸(TunablesList.tsx ValueRow.commit)과 같은 길이다: 파일 내용 → tunableNodes → isEditableValue →
// tunableEditValue·diskLiteralKey → sceneStore.setTunable. 그래서 저장(Ctrl+S)·실행 취소·충돌 처리가 인스펙터와 같다.
// 파일 내용은 연결한 파일이면 javaSources 캐시를, 아니면 여기서 읽어 둔 것을 쓴다(열린 루트·경로 규칙은 메인이 본다).
// 누르면 파일을 다시 읽어 그 내용으로 다시 판정한다(그사이 밖에서 바뀐 값을 base로 삼지 않게).

type ConfigSourcesState = {
  root: string | null
  session: number
  // 이 파일들을 읽은 실행(실행마다 새로 읽는다)
  runId: string | null
  // TeamCode 기준 경로 → 읽은 결과(연결하지 않은 파일)
  files: Readonly<Record<string, JavaSource>>
}

export const useConfigSourcesStore = create<ConfigSourcesState>()(() => ({
  root: null,
  session: 0,
  runId: null,
  files: {}
}))

const inFlight = new Set<string>()

function enterScope(root: string, session: number): void {
  const state = useConfigSourcesStore.getState()
  if (state.root === root && state.session === session) return
  inFlight.clear()
  useConfigSourcesStore.setState({ root, session, files: {} })
}

// 실행마다 파일을 새로 읽는다(새 실행의 트리를 처음 보일 때)
export function syncConfigSourcesRun(runId: string): void {
  if (useConfigSourcesStore.getState().runId === runId) return
  inFlight.clear()
  useConfigSourcesStore.setState({ runId, files: {} })
}

async function readFile(root: string, path: string): Promise<ReadJavaFileResult> {
  try {
    return await window.api.readJavaFile(root, path)
  } catch (error) {
    return { ok: false, code: 'failed', detail: ipcErrorDetail(error) }
  }
}

function isCurrent(root: string, session: number): boolean {
  const project = useProjectStore.getState()
  return project.root === root && project.session === session
}

// 여기서 읽어 둔 파일 내용(지금 프로젝트의 것만)
export function localConfigSource(
  state: ConfigSourcesState,
  project: { root: string | null; session: number },
  path: string
): JavaSource | undefined {
  if (!project.root || state.root !== project.root || state.session !== project.session)
    return undefined
  return state.files[path]
}

// 지금 쓸 파일 내용: 연결한 파일의 캐시가 먼저, 없으면 여기서 읽은 것
function configSource(
  project: { root: string; session: number },
  path: string
): JavaSource | undefined {
  return (
    currentJavaSource(useJavaSourcesStore.getState(), project, path) ??
    localConfigSource(useConfigSourcesStore.getState(), project, path)
  )
}

// 아직 읽지 않은 파일을 읽는다(칸이 보일 때)
export function ensureConfigSource(path: string): void {
  const { root, session, busy } = useProjectStore.getState()
  if (!root || busy) return
  enterScope(root, session)
  if (configSource({ root, session }, path) || inFlight.has(path)) return
  inFlight.add(path)
  void readFile(root, path).then((result) => {
    if (!inFlight.delete(path) || !isCurrent(root, session)) return
    const state = useConfigSourcesStore.getState()
    useConfigSourcesStore.setState({
      files: { ...state.files, [path]: sourceFromRead(result, state.files[path]) }
    })
  })
}

// 값 칸의 판정(그리기용, 지금 캐시로)
export function applyCheckFor(
  node: Extract<DashConfigNode, { kind: 'value' }>,
  source: JavaSource | undefined
): ApplyCheck {
  const target = node.source ? tunableTarget(node.source) : null
  const pending = target
    ? useSceneStore.getState().tunables[target.path]?.[target.fieldId]
    : undefined
  return checkApply(node, target, source, pending)
}

// [파일에 반영]: 파일을 다시 읽고 판정해 통과하면 튜닝 값으로 옮긴다(실행 취소 한 단계). 옮겼으면 true.
export async function applyConfigValue(
  node: Extract<DashConfigNode, { kind: 'value' }>
): Promise<boolean> {
  const { root, session } = useProjectStore.getState()
  const target = node.source ? tunableTarget(node.source) : null
  if (!root || !target) return false
  const result = await readFile(root, target.path)
  if (!isCurrent(root, session)) return false
  const project = { root, session }
  const linked = currentJavaSource(useJavaSourcesStore.getState(), project, target.path)
  let source: JavaSource
  if (linked) {
    // 인스펙터 카드도 같은 내용을 보이게 연결 캐시에 넣는다
    putJavaSource(root, session, target.path, result)
    source =
      currentJavaSource(useJavaSourcesStore.getState(), project, target.path) ??
      sourceFromRead(result)
  } else {
    enterScope(root, session)
    const state = useConfigSourcesStore.getState()
    source = sourceFromRead(result, state.files[target.path])
    useConfigSourcesStore.setState({ files: { ...state.files, [target.path]: source } })
  }
  const check = applyCheckFor(node, source)
  if (!check.ok) return false
  useSceneStore.getState().setTunable(check.path, check.fieldId, check.value, check.base)
  return true
}
