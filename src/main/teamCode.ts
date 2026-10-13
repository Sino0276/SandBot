import { ipcMain } from 'electron'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import {
  GENERATED_JAVA_DIR,
  GENERATED_XML_DIR,
  isAllowedGeneratedPath,
  planGeneratedSync,
  type GeneratedFile,
  type SyncGeneratedResult
} from '../shared/generatedFiles'
import { IPC } from '../shared/ipc'

// 렌더러가 만든 생성 코드를 팀의 TeamCode 폴더에 쓴다. 경로는 generatedFiles의 규칙으로만 허용하고,
// 도구가 쓴 그대로인(표식과 해시가 맞는) 파일만 덮어쓰거나 지운다.

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function resolve(teamCode: string, relativePath: string): string {
  return join(teamCode, ...relativePath.split('/'))
}

// 생성 위치(패키지 폴더, res/xml)에 이미 있는 후보 파일들
async function readExisting(teamCode: string): Promise<GeneratedFile[]> {
  const existing: GeneratedFile[] = []
  for (const dir of [GENERATED_JAVA_DIR, GENERATED_XML_DIR]) {
    let names: string[]
    try {
      names = await readdir(resolve(teamCode, dir))
    } catch {
      continue
    }
    for (const name of names) {
      const path = `${dir}/${name}`
      if (!isAllowedGeneratedPath(path)) continue
      existing.push({ path, content: await readFile(resolve(teamCode, path), 'utf8') })
    }
  }
  return existing
}

export async function syncGeneratedFiles(
  root: string,
  files: GeneratedFile[]
): Promise<SyncGeneratedResult> {
  const teamCode = join(root, 'TeamCode')
  if (!(await isDirectory(teamCode))) return { status: 'noTeamCode' }
  const plan = planGeneratedSync(await readExisting(teamCode), files)
  // 대소문자만 바뀐 이전 파일을 먼저 지워야 새 이름으로 쓸 수 있다(대소문자를 구분하지 않는 파일 시스템)
  for (const path of plan.delete) await unlink(resolve(teamCode, path))
  for (const file of plan.write) {
    const target = resolve(teamCode, file.path)
    await mkdir(dirname(target), { recursive: true })
    // 빌드 도구가 반쯤 쓴 파일을 읽지 않게 임시 파일에 쓴 뒤 바꿔치기한다.
    // 임시 파일은 점으로 시작해야 Android 리소스 병합(res/xml)이 무시한다.
    const temp = join(dirname(target), `.${basename(target)}.tmp`)
    try {
      await writeFile(temp, file.content, 'utf8')
      await rename(temp, target)
    } catch (error) {
      await unlink(temp).catch(() => undefined)
      throw error
    }
  }
  return {
    status: 'synced',
    written: plan.write.map((file) => file.path),
    unchanged: plan.unchanged,
    deleted: plan.delete,
    skipped: plan.skipped,
    modified: plan.modified,
    caseRenamed: plan.caseRenamed
  }
}

export function registerTeamCodeIpc(): void {
  ipcMain.handle(IPC.syncGeneratedFiles, (_event, root: string, files: GeneratedFile[]) =>
    syncGeneratedFiles(root, files)
  )
}
