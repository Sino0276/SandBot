import i18n from 'i18next'
import { fileNameOf, loadCadGeometry } from '../cad/importStep'
import { showDialog } from '../editor/dialogStore'
import { useEditorStore } from '../editor/editorStore'
import { dismissNotice, showNotice } from '../editor/noticeStore'
import { isPlaceholderScene, useSceneStore } from '../scene/sceneStore'
import { parseProject, ProjectFileError, serializeProject } from './projectFile'
import { useProjectStore } from './projectStore'

const LAST_PROJECT_KEY = 'sandbot:lastProject'

// 프로젝트를 여는 동안(씬 교체, CAD 경로 갱신)에는 변경으로 치지 않는다
let loading = false

// 열린 프로젝트에 딸린 알림(TeamCode 없음, CAD 못 찾음). 다른 프로젝트를 열면 지운다.
const projectNotices = { noTeamCode: 0, cadMissing: 0 }

function replaceProjectNotice(
  key: keyof typeof projectNotices,
  params: Record<string, string | number> | null
): void {
  dismissNotice(projectNotices[key])
  projectNotices[key] = params ? showNotice('warning', key, params) : 0
}

function setDirty(dirty: boolean): void {
  if (useProjectStore.getState().dirty === dirty) return
  useProjectStore.setState({ dirty })
  window.api.setDirty(dirty)
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
    const content = serializeProject(useSceneStore.getState().objects, (path) =>
      window.api.relativePath(projectRoot, path)
    )
    try {
      await window.api.saveProject(projectRoot, content)
    } catch (error) {
      showNotice('error', 'saveFailed', { detail: errorDetail(error) })
      return false
    }
    localStorage.setItem(LAST_PROJECT_KEY, projectRoot)
    setDirty(false)
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
  return withBusy(async () => {
    const progress = showNotice('progress', 'openingProject', { name: fileNameOf(root) })
    loading = true
    try {
      const info = await window.api.openProject(root)
      const { objects, cadFiles } = info.content
        ? parseProject(info.content)
        : { objects: {}, cadFiles: new Map() }

      useSceneStore.getState().replaceObjects(objects)
      useEditorStore.getState().select(null)
      useProjectStore.setState({ root, name: info.name, missingCad: [] })
      localStorage.setItem(LAST_PROJECT_KEY, root)
      replaceProjectNotice('noTeamCode', info.hasTeamCode ? null : { name: info.name })

      // CAD 원본은 프로젝트 기준 상대 경로 → 저장 당시 절대 경로 순으로 찾는다
      const missing: string[] = []
      for (const [id, file] of cadFiles) {
        const candidates = [
          file.relativePath ? window.api.resolvePath(root, file.relativePath) : null,
          file.absolutePath || null
        ].filter((path): path is string => path !== null)
        let found: string | null = null
        for (const path of candidates) {
          if (await loadCadGeometry(id, path)) {
            found = path
            break
          }
        }
        if (found) useSceneStore.getState().setCadFile(id, found, fileNameOf(found))
        else missing.push(id)
      }
      useProjectStore.setState({ missingCad: missing })
      replaceProjectNotice('cadMissing', missing.length > 0 ? { count: missing.length } : null)
      setDirty(false)
    } catch (error) {
      if (options.quiet) {
        localStorage.removeItem(LAST_PROJECT_KEY)
      } else {
        const detail = error instanceof ProjectFileError ? error.code : errorDetail(error)
        showNotice('error', 'openFailed', { detail })
      }
    } finally {
      loading = false
      dismissNotice(progress)
    }
  })
}

// 인스펙터의 [파일 다시 찾기]. 찾지 못한 CAD를 연결하거나, 바뀐 CAD 파일로 바꿔 끼운다.
export async function relinkCad(cadRootId: string): Promise<void> {
  const cad = useSceneStore.getState().objects[cadRootId]?.cad
  if (!cad) return
  const path = await window.api.chooseStepFile(
    i18n.t('project.chooseStepTitle'),
    cad.absolutePath || undefined
  )
  if (!path) return
  const fileName = fileNameOf(path)
  const progress = showNotice('progress', 'importing', { fileName })
  try {
    if (!(await loadCadGeometry(cadRootId, path))) {
      showNotice('error', 'importReadFailed', { fileName })
      return
    }
    useSceneStore.getState().setCadFile(cadRootId, path, fileName)
    const missing = useProjectStore.getState().missingCad.filter((id) => id !== cadRootId)
    useProjectStore.setState({ missingCad: missing })
    replaceProjectNotice('cadMissing', missing.length > 0 ? { count: missing.length } : null)
  } finally {
    dismissNotice(progress)
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
    if (!useProjectStore.getState().root && isPlaceholderScene(state.objects)) return
    setDirty(true)
  })

  const updateTitle = (): void => {
    const { name, dirty } = useProjectStore.getState()
    document.title = name ? `${name}${dirty ? ' *' : ''} — SandBot` : 'SandBot'
  }
  useProjectStore.subscribe(updateTitle)
  updateTitle()

  window.api.onCloseRequested(async () => {
    if (await confirmDiscardChanges()) window.api.confirmClose()
  })

  const last = localStorage.getItem(LAST_PROJECT_KEY)
  if (last) void openProjectAt(last, { quiet: true })
}
