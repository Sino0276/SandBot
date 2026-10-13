import { BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { IPC, type OpenProjectResult } from '../shared/ipc'

// 프로젝트 = 팀의 FtcRobotController 폴더. 도구 데이터는 그 안의 sandbot/project.json에 둔다.
const DATA_DIR = 'sandbot'
const PROJECT_FILE = 'project.json'

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function isStepPath(path: string): boolean {
  return /\.(step|stp)$/i.test(path)
}

// 선택한 경로 하나를 돌려준다. 취소하면 null.
async function showOpenDialog(
  sender: Electron.WebContents,
  options: Electron.OpenDialogOptions
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender)
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

export function registerProjectIpc(): void {
  ipcMain.handle(IPC.chooseProjectFolder, (event, title: string) =>
    showOpenDialog(event.sender, { title, properties: ['openDirectory', 'createDirectory'] })
  )

  ipcMain.handle(IPC.chooseStepFile, (event, title: string, defaultPath?: string) =>
    showOpenDialog(event.sender, {
      title,
      defaultPath,
      properties: ['openFile'],
      filters: [{ name: 'STEP', extensions: ['step', 'stp'] }]
    })
  )

  ipcMain.handle(IPC.openProject, async (_event, root: string): Promise<OpenProjectResult> => {
    if (!(await isDirectory(root))) throw new Error(`not a folder: ${root}`)
    return {
      root,
      name: basename(root),
      hasTeamCode: await isDirectory(join(root, 'TeamCode')),
      content: await readTextIfExists(join(root, DATA_DIR, PROJECT_FILE))
    }
  })

  ipcMain.handle(IPC.saveProject, async (_event, root: string, content: string) => {
    if (!(await isDirectory(root))) throw new Error(`not a folder: ${root}`)
    const dir = join(root, DATA_DIR)
    await mkdir(dir, { recursive: true })
    // 쓰는 도중 앱이 꺼져도 기존 파일이 깨지지 않도록 임시 파일에 쓴 뒤 바꿔 끼운다
    const target = join(dir, PROJECT_FILE)
    const temp = `${target}.tmp`
    await writeFile(temp, content, 'utf8')
    await rename(temp, target)
  })

  // 렌더러가 임의 파일을 읽지 못하도록 STEP 확장자만 허용한다
  ipcMain.handle(IPC.readStepFile, async (_event, path: string) => {
    if (!isStepPath(path)) throw new Error(`not a STEP file: ${path}`)
    try {
      return new Uint8Array(await readFile(path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  })
}

// 저장 안 된 변경이 있으면 창을 바로 닫지 않고 렌더러에게 묻는다(대화상자 문구는 렌더러가 번역한다).
export function guardUnsavedChanges(window: BrowserWindow): void {
  let dirty = false
  let confirmed = false
  const onSetDirty = (event: Electron.IpcMainEvent, value: boolean): void => {
    if (event.sender === window.webContents) dirty = value
  }
  const onConfirmClose = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== window.webContents) return
    confirmed = true
    window.close()
  }
  ipcMain.on(IPC.setDirty, onSetDirty)
  ipcMain.on(IPC.confirmClose, onConfirmClose)
  window.on('close', (event) => {
    if (!dirty || confirmed) return
    event.preventDefault()
    window.webContents.send(IPC.closeRequested)
  })
  window.on('closed', () => {
    ipcMain.removeListener(IPC.setDirty, onSetDirty)
    ipcMain.removeListener(IPC.confirmClose, onConfirmClose)
  })
}
