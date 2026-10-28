import { app, ipcMain, type WebContents } from 'electron'
import { mkdir, mkdtemp, readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import type { PlayEvent } from '../../shared/play'
import { resolveAndroidPlatform } from '../androidSdk'
import { resolveActiveJdk } from '../jdk'
import { PlayController, type PlayOwner } from './controller'
import { readSidecarFiles } from './launch'
import { spawnSidecar } from './process'
import { kinematicWorld } from './world'

// 실행(Play) IPC: playInit·playCommand·playGamepads와 렌더러로 가는 playEvent. 사이드카 빌드 결과는 배포 앱이면
// resources/sidecar(electron-builder의 extraResources), 개발 중이면 저장소의 resources/sidecar(pnpm build:sidecar가
// 쓴다)이고, SANDBOT_SIDECAR_DIR로 다른 빌드를 가리킬 수 있다(stepConverter.ts와 같은 방식).

export function sidecarDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'sidecar')
  if (process.env.SANDBOT_SIDECAR_DIR) return process.env.SANDBOT_SIDECAR_DIR
  return join(app.getAppPath(), 'resources', 'sidecar')
}

// 사이드카의 작업 폴더(팀 코드가 상대 경로로 파일을 쓰면 여기에 남는다). 실행마다 빈 폴더를 만들고 끝나면 지운다.
const RUN_DIR = 'sidecar-run'
// 비정상 종료로 남은 폴더는 하루가 지나면 지운다(다른 SandBot 창이 실행 중일 수 있다)
const STALE_RUN_MS = 24 * 60 * 60 * 1000

async function sweepRunDirs(root: string): Promise<void> {
  const names = await readdir(root).catch(() => [] as string[])
  const now = Date.now()
  for (const name of names.filter((n) => n.startsWith('run-'))) {
    const path = join(root, name)
    const info = await stat(path).catch(() => null)
    if (info && now - info.mtimeMs > STALE_RUN_MS)
      await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
}

// 앱을 끝낼 때 사이드카를 정리하는 데 기다리는 최대 시간
const QUIT_WAIT_MS = 3000

export function registerPlayIpc(): void {
  const runRoot = join(app.getPath('userData'), RUN_DIR)
  void sweepRunDirs(runRoot)

  const controller = new PlayController({
    resolveJdk: () => resolveActiveJdk(),
    locateSidecar: () => readSidecarFiles(sidecarDir()),
    spawn: spawnSidecar,
    makeRunDir: async () => {
      await mkdir(runRoot, { recursive: true })
      return mkdtemp(join(runRoot, 'run-'))
    },
    removeRunDir: (dir) => rm(dir, { recursive: true, force: true }),
    platform: process.platform,
    env: process.env,
    world: kinematicWorld,
    resolvePlatform: (projectRoot, compileSdk) => resolveAndroidPlatform(projectRoot, compileSdk)
  })

  // 창마다 같은 owner 객체(명령이 실행을 시작한 창의 것인지 본다)
  const owners = new WeakMap<WebContents, PlayOwner>()
  const ownerOf = (contents: WebContents): PlayOwner => {
    const known = owners.get(contents)
    if (known) return known
    const owner: PlayOwner = {
      send: (event: PlayEvent) => {
        if (!contents.isDestroyed()) contents.send(IPC.playEvent, event)
      }
    }
    owners.set(contents, owner)
    // 창이 닫히거나 렌더러가 죽거나 새로고침되면 그 창의 실행을 정리한다
    const dispose = (): void => void controller.disposeOwner(owner)
    contents.once('destroyed', dispose)
    contents.on('render-process-gone', dispose)
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) dispose()
    })
    return owner
  }

  ipcMain.handle(IPC.playInit, (event, request: unknown) =>
    controller.init(request, ownerOf(event.sender))
  )
  ipcMain.on(IPC.playCommand, (event, command: unknown) =>
    controller.command(command, ownerOf(event.sender))
  )
  ipcMain.on(IPC.playGamepads, (event, gamepads: unknown) =>
    controller.gamepads(gamepads, ownerOf(event.sender))
  )

  // 앱을 끝내기 전에 사이드카를 정리한다(shutdown → 잠깐 기다림 → kill). 남은 JVM이 없으면 바로 끝난다.
  let quitting = false
  app.on('will-quit', (event) => {
    if (quitting || !controller.hasProcess) return
    quitting = true
    event.preventDefault()
    const wait = new Promise<void>((resolve) => setTimeout(resolve, QUIT_WAIT_MS))
    void Promise.race([controller.disposeAll(), wait]).finally(() => app.quit())
  })
}
