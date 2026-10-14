import i18n from 'i18next'
import {
  confirmLargeImport,
  fileNameOf,
  LARGE_STEP_BYTES,
  loadCadWithProgress,
  type CadLoadStatus
} from '../cad/importStep'
import { cancelAllImports, isImporting, useImportStore } from '../cad/importStore'
import { isImportedModel, MESH_CACHE_TAG } from '../cad/stepImport'
import { showDialog } from '../editor/dialogStore'
import { useEditorStore } from '../editor/editorStore'
import { dismissNotice, showNotice } from '../editor/noticeStore'
import { clearHistory, resumeHistory, rewriteHistory, suspendHistory } from '../editor/history'
import { generateTeamCodeFiles } from '../hardware/generate'
import { uniqueIssues } from '../hardware/validation'
import type { SceneObjects } from '../scene/model'
import { disposeAllGeometry } from '../scene/geometryRegistry'
import { isPlaceholderScene, useSceneStore, withCadFile } from '../scene/sceneStore'
import { parseProject, ProjectFileError, serializeProject } from './projectFile'
import { setCadStatus, useProjectStore, type GenerationResult } from './projectStore'

const LAST_PROJECT_KEY = 'sandbot:lastProject'

// 프로젝트를 여는 동안(씬 교체, CAD 경로 갱신)에는 변경으로 치지 않는다
let loading = false

// 마지막으로 저장하거나 연 씬. 실행 취소로 이 상태로 돌아오면 저장할 변경이 없는 것으로 본다.
let savedObjects: SceneObjects | null = null

// 열린 프로젝트에 딸린 알림(TeamCode 없음, CAD 못 찾음). 다른 프로젝트를 열면 지운다.
const projectNotices = { noTeamCode: 0, cadMissing: 0 }

function replaceProjectNotice(
  key: keyof typeof projectNotices,
  params: Record<string, string | number> | null
): void {
  dismissNotice(projectNotices[key])
  projectNotices[key] = params ? showNotice('warning', key, params) : 0
}

// 코드 생성 알림은 저장할 때마다 새로 띄운다(이전 저장의 알림을 지운다)
let generationNotices: number[] = []

function replaceGenerationNotices(notices: Parameters<typeof showNotice>[]): void {
  for (const id of generationNotices) dismissNotice(id)
  generationNotices = notices.map((notice) => showNotice(...notice))
}

const fileNames = (paths: string[]): string => paths.map(fileNameOf).join(', ')

// 메인 프로세스에는 initProjectSession의 구독이 알린다(확정하지 않은 입력칸 초안도 포함)
function setDirty(dirty: boolean): void {
  if (useProjectStore.getState().dirty === dirty) return
  useProjectStore.setState({ dirty })
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withBusy<T>(work: () => Promise<T>): Promise<T> {
  useProjectStore.setState({ busy: true })
  try {
    return await work()
  } finally {
    useProjectStore.setState({ busy: false })
  }
}

// 저장한 씬으로 TeamCode의 생성 코드(하드웨어 클래스·구성 XML)를 맞춘다.
// 프로젝트 파일은 이미 저장했으므로, 여기서 실패해도 저장은 성공으로 친다.
async function syncTeamCode(root: string, objects: SceneObjects): Promise<void> {
  const { files, issues, blocked } = generateTeamCodeFiles(objects)
  let generation: GenerationResult
  if (blocked) {
    const errors = uniqueIssues(issues).filter((i) => i.severity === 'error').length
    generation = { status: 'blocked', errors }
    replaceGenerationNotices([['warning', 'codegenBlocked', { count: errors }]])
  } else {
    try {
      generation = await window.api.syncGeneratedFiles(root, files)
      const notices: Parameters<typeof showNotice>[] = []
      if (generation.status === 'noTeamCode') {
        // 만들 파일이 없으면(컴포넌트 없음) TeamCode가 없어도 알릴 것이 없다
        if (files.length > 0) notices.push(['warning', 'codegenNoTeamCode'])
      } else {
        if (generation.skipped.length > 0)
          notices.push(['warning', 'codegenSkipped', { files: fileNames(generation.skipped) }])
        if (generation.modified.length > 0)
          notices.push(['warning', 'codegenModified', { files: fileNames(generation.modified) }])
        if (generation.caseRenamed.length > 0) {
          const renames = generation.caseRenamed
            .map(({ from, to }) => `${fileNameOf(from)} → ${fileNameOf(to)}`)
            .join(', ')
          notices.push(['warning', 'codegenCaseRenamed', { files: renames }])
        }
      }
      replaceGenerationNotices(notices)
    } catch (error) {
      generation = { status: 'failed', detail: errorDetail(error) }
      replaceGenerationNotices([['error', 'codegenFailed', { detail: generation.detail }]])
    }
  }
  useProjectStore.setState({ generation })
}

// 저장 안 된 변경이 있으면 저장할지 묻는다. 계속 진행해도 되면 true.
export async function confirmDiscardChanges(): Promise<boolean> {
  if (!useProjectStore.getState().dirty) return true
  const answer = await showDialog({
    message: i18n.t('dialog.unsavedChanges'),
    buttons: [
      { id: 'save', label: i18n.t('dialog.save'), primary: true },
      { id: 'discard', label: i18n.t('dialog.discard') },
      { id: 'cancel', label: i18n.t('dialog.cancel') }
    ],
    cancelId: 'cancel'
  })
  if (answer === 'save') return saveProject()
  return answer === 'discard'
}

// Ctrl+S. 프로젝트가 없으면 저장할 FtcRobotController 폴더를 고르게 한다. 저장했으면 true.
export function saveProject(): Promise<boolean> {
  // 열기·저장 중에는 단축키로 또 시작하지 않는다
  if (useProjectStore.getState().busy) return Promise.resolve(false)
  return withBusy(async () => {
    let { root } = useProjectStore.getState()
    if (!root) {
      const chosen = await window.api.chooseProjectFolder(i18n.t('project.chooseFolderTitle'))
      if (!chosen) return false
      const info = await window.api.openProject(chosen)
      if (info.content !== null) {
        const answer = await showDialog({
          message: i18n.t('dialog.overwriteProject', { name: info.name }),
          buttons: [
            { id: 'overwrite', label: i18n.t('dialog.overwrite'), primary: true },
            { id: 'cancel', label: i18n.t('dialog.cancel') }
          ],
          cancelId: 'cancel'
        })
        if (answer !== 'overwrite') return false
      }
      replaceProjectNotice('noTeamCode', info.hasTeamCode ? null : { name: info.name })
      root = chosen
      useProjectStore.setState({ root, name: info.name })
    }

    const projectRoot = root
    // 저장하는 동안 바뀐 내용은 다음 저장 몫이다. 프로젝트 파일과 생성 코드는 같은 씬으로 만든다.
    const objects = useSceneStore.getState().objects
    const content = serializeProject(objects, (path) => window.api.relativePath(projectRoot, path))
    try {
      await window.api.saveProject(projectRoot, content)
    } catch (error) {
      showNotice('error', 'saveFailed', { detail: errorDetail(error) })
      return false
    }
    localStorage.setItem(LAST_PROJECT_KEY, projectRoot)
    savedObjects = objects
    setDirty(useSceneStore.getState().objects !== savedObjects)
    await syncTeamCode(projectRoot, objects)
    return true
  })
}

// Ctrl+O. 저장 안 된 변경을 확인한 뒤 폴더를 골라 연다.
export async function openProjectFolder(): Promise<void> {
  if (useProjectStore.getState().busy) return
  if (!(await confirmDiscardChanges())) return
  const root = await window.api.chooseProjectFolder(i18n.t('project.chooseFolderTitle'))
  if (root) await openProjectAt(root)
}

export function openProjectAt(root: string, options: { quiet?: boolean } = {}): Promise<void> {
  let cads: { id: string; path: string }[] = []
  let session = 0
  return withBusy(async () => {
    const progress = showNotice('progress', 'openingProject', { name: fileNameOf(root) })
    loading = true
    // 여는 동안(씬 교체, CAD 위치 찾기)의 변경은 기록하지 않고, 실행 취소도 막는다
    suspendHistory()
    let replaced = false
    try {
      const info = await window.api.openProject(root)
      const { objects, cadFiles } = info.content
        ? parseProject(info.content)
        : { objects: {}, cadFiles: new Map() }

      // 새 프로젝트를 읽었으니 이전 프로젝트의 불러오기(새 STEP, CAD 형상 읽기)를 멈춘다(열기에 실패하면 그대로 둔다).
      // 세션을 먼저 바꿔, 취소되어 끝나는 이전 작업이 결과·상태를 반영하거나 다음 CAD로 넘어가지 않게 한다.
      session = useProjectStore.getState().session + 1
      useProjectStore.setState({ session })
      cancelAllImports()

      useSceneStore.getState().replaceObjects(objects)
      replaced = true
      // 이전 씬의 형상을 버린다. 같은 프로젝트를 다시 열 때 이번에 읽지 못한 CAD가 예전 형상으로 보이지 않게 한다.
      disposeAllGeometry()
      useEditorStore.getState().select(null)
      useProjectStore.setState({
        root,
        name: info.name,
        missingCad: [],
        cadStatus: {},
        generation: null,
        session
      })
      replaceGenerationNotices([])
      localStorage.setItem(LAST_PROJECT_KEY, root)
      replaceProjectNotice('noTeamCode', info.hasTeamCode ? null : { name: info.name })

      // CAD 원본은 프로젝트 기준 상대 경로 → 저장 당시 절대 경로 순으로 찾는다. 여기서는 위치만 찾고(내용은 읽지 않음)
      // 경로를 고쳐 둔다. 고친 경로는 연 상태(savedObjects)에 들어가므로 변경으로 치지 않는다.
      const missing: string[] = []
      for (const [id, file] of cadFiles) {
        const candidates = [
          file.relativePath ? window.api.resolvePath(root, file.relativePath) : null,
          file.absolutePath || null
        ].filter((path): path is string => path !== null)
        let found: string | null = null
        for (const path of candidates) {
          if (await window.api.statStepFile(path)) {
            found = path
            break
          }
        }
        if (found) {
          useSceneStore.getState().setCadFile(id, found, fileNameOf(found))
          setCadStatus(id, 'loading')
          cads.push({ id, path: found })
        } else {
          missing.push(id)
        }
      }
      useProjectStore.setState({ missingCad: missing })
      replaceProjectNotice('cadMissing', missing.length > 0 ? { count: missing.length } : null)
      savedObjects = useSceneStore.getState().objects
      setDirty(false)
    } catch (error) {
      cads = []
      if (options.quiet) {
        localStorage.removeItem(LAST_PROJECT_KEY)
      } else {
        const detail = error instanceof ProjectFileError ? error.code : errorDetail(error)
        showNotice('error', 'openFailed', { detail })
      }
    } finally {
      loading = false
      resumeHistory()
      // 씬을 바꿨으면 이전 씬의 기록은 버린다. 열기에 실패해 씬이 그대로면 기록도 그대로 둔다.
      if (replaced) clearHistory()
      dismissNotice(progress)
    }
  }).then(() => {
    // CAD 형상은 열기가 끝난 뒤 하나씩 읽는다. 큰 STEP은 몇 분 걸리므로 그동안에도 편집·저장할 수 있다
    // (형상은 씬 문서를 바꾸지 않는다). 다른 프로젝트를 열면 멈춘다.
    void loadProjectCads(cads, session)
  })
}

async function loadProjectCads(
  cads: { id: string; path: string }[],
  session: number
): Promise<void> {
  for (const { id, path } of cads) {
    if (useProjectStore.getState().session !== session) return
    const status = await loadCadWithProgress(id, path)
    if (useProjectStore.getState().session !== session) return
    applyCadStatus(id, path, status)
  }
}

// 형상 읽기 결과를 CAD 상태와 알림에 반영한다
function applyCadStatus(id: string, path: string, status: CadLoadStatus): void {
  if (status === 'loaded') {
    setCadStatus(id, null)
    removeMissingCad(id)
  } else if (status === 'missing') {
    // 위치를 찾은 뒤에 파일이 사라졌다
    setCadStatus(id, null)
    const missing = [...new Set([...useProjectStore.getState().missingCad, id])]
    useProjectStore.setState({ missingCad: missing })
    replaceProjectNotice('cadMissing', { count: missing.length })
  } else {
    setCadStatus(id, status)
    if (status === 'cancelled')
      showNotice('warning', 'cadLoadCancelled', { fileName: fileNameOf(path) })
  }
}

function removeMissingCad(id: string): void {
  const missing = useProjectStore.getState().missingCad.filter((other) => other !== id)
  useProjectStore.setState({ missingCad: missing })
  replaceProjectNotice('cadMissing', missing.length > 0 ? { count: missing.length } : null)
}

// 불러오기를 시작해도 되는지(한 번에 하나, 열기·저장 중이 아닐 때)
function canStartImport(): boolean {
  return !isImporting() && !useProjectStore.getState().busy
}

// 인스펙터의 [다시 불러오기]. 취소했거나 실패한 CAD를 저장된 경로에서 다시 읽는다(파일 선택 없이).
export async function reloadCad(cadRootId: string): Promise<void> {
  const cad = useSceneStore.getState().objects[cadRootId]?.cad
  if (!cad?.absolutePath || !canStartImport()) return
  const session = useProjectStore.getState().session
  setCadStatus(cadRootId, 'loading')
  const status = await loadCadWithProgress(cadRootId, cad.absolutePath)
  if (useProjectStore.getState().session !== session) return
  applyCadStatus(cadRootId, cad.absolutePath, status)
}

// 인스펙터의 [파일 다시 찾기]. 찾지 못한 CAD를 연결하거나, 바뀐 CAD 파일로 바꿔 끼운다.
// 새 파일을 다 읽었을 때만 경로를 바꾼다. 실패하거나 취소하면 이전 파일과 형상을 그대로 둔다.
export async function relinkCad(cadRootId: string): Promise<void> {
  const cad = useSceneStore.getState().objects[cadRootId]?.cad
  if (!cad || !canStartImport()) return
  const path = await window.api.chooseStepFile(
    i18n.t('project.chooseStepTitle'),
    cad.absolutePath || undefined
  )
  if (!path || !canStartImport()) return
  const fileName = fileNameOf(path)
  const session = useProjectStore.getState().session
  // 캐시에 없는 큰 파일은 묻는다(크기는 메인 프로세스가 알려 줌, 내용은 받지 않음)
  let lookup
  try {
    lookup = await window.api.readStepCached(path, MESH_CACHE_TAG, false)
  } catch (error) {
    console.error('STEP 확인 실패', error)
    showNotice('error', 'importFailed', { fileName })
    return
  }
  if (!lookup) {
    showNotice('error', 'importReadFailed', { fileName })
    return
  }
  if (
    !isImportedModel(lookup.model) &&
    lookup.size > LARGE_STEP_BYTES &&
    !(await confirmLargeImport([{ name: fileName, size: lookup.size }]))
  )
    return
  if (useProjectStore.getState().session !== session || !canStartImport()) return
  const status = await loadCadWithProgress(cadRootId, path, lookup)
  if (useProjectStore.getState().session !== session) return
  if (status === 'loaded') {
    // 형상은 새 파일에서 읽었으므로, 실행 취소로 경로만 되돌아가지 않게 기록 전체에 적용한다
    rewriteHistory((objects) => withCadFile(objects, cadRootId, path, fileName))
    setCadStatus(cadRootId, null)
    removeMissingCad(cadRootId)
  } else if (status === 'missing') {
    showNotice('error', 'importReadFailed', { fileName })
  }
}

let initialized = false

// 앱 시작 시 한 번: 변경 추적, 창 제목, 닫기 확인, 마지막 프로젝트 다시 열기
export function initProjectSession(): void {
  if (initialized) return
  initialized = true

  useSceneStore.subscribe((state, previous) => {
    if (loading || state.objects === previous.objects) return
    // 프로젝트 없이 임시 씬만 만지는 것은 저장할 변경으로 치지 않는다
    if (!useProjectStore.getState().root && isPlaceholderScene(state.objects)) setDirty(false)
    else setDirty(state.objects !== savedObjects)
  })

  const updateTitle = (): void => {
    const { name, dirty } = useProjectStore.getState()
    document.title = name ? `${name}${dirty ? ' *' : ''} — SandBot` : 'SandBot'
  }
  useProjectStore.subscribe(updateTitle)
  updateTitle()

  // 창을 닫을 때 확인이 필요한지(저장 안 한 변경, 아직 확정하지 않은 입력칸 초안, 진행 중인 STEP 불러오기)
  let needsConfirm = false
  const updateCloseGuard = (): void => {
    const { dirty, pendingEdit } = useProjectStore.getState()
    const next = dirty || pendingEdit || isImporting()
    if (needsConfirm === next) return
    needsConfirm = next
    window.api.setDirty(needsConfirm)
  }
  useProjectStore.subscribe(updateCloseGuard)
  useImportStore.subscribe(updateCloseGuard)

  window.api.onCloseRequested(async () => {
    // 입력 중인 초안을 먼저 확정해 변경으로 반영한 뒤 묻는다
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (isImporting()) {
      const answer = await showDialog({
        message: i18n.t('dialog.closeWhileImporting'),
        buttons: [
          { id: 'close', label: i18n.t('dialog.close') },
          { id: 'cancel', label: i18n.t('dialog.cancel'), primary: true }
        ],
        cancelId: 'cancel'
      })
      if (answer !== 'close') return
    }
    if (!(await confirmDiscardChanges())) return
    cancelAllImports()
    window.api.confirmClose()
  })

  const last = localStorage.getItem(LAST_PROJECT_KEY)
  if (last) void openProjectAt(last, { quiet: true })
}
