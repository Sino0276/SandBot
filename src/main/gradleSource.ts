import { constants } from 'fs'
import { open as openFile, realpath, type FileHandle } from 'fs/promises'
import path from 'path'
import {
  isSafeProjectPath,
  MAX_GRADLE_FILE_BYTES,
  readGradleProject,
  type GradleFileProblem,
  type GradleFileSource,
  type GradleProject
} from '../shared/gradle'
import { isTrustedRoot } from './projectRoots'
import { containedIn } from './teamCodeJava'

// 실행(INIT) 전에 팀 Gradle 파일을 읽는다(src/shared/gradle가 해석한다). 파일 접근은 메인만 하고, 열거나 저장한 프로젝트
// 루트(projectRoots.ts) 안의 보통 파일만 준다:
// - 경로는 src/shared/gradle/paths.ts의 규칙(정규화한 상대 경로, Windows 장치 이름·':' 없음)으로 다시 확인한다.
// - 링크·정션은 풀어서 실제 위치가 프로젝트 루트 안일 때만 읽는다(teamCodeJava.ts의 containedIn, 다른 드라이브 포함).
//   밖을 가리키면 outsideProject.
// - 실제 위치를 링크를 따르지 않고(O_NOFOLLOW, 그사이 링크로 바뀌면 ELOOP) 열어 그 핸들로 크기와 내용을 읽는다.
//   256 KB를 넘으면 내용 없이 tooLarge(커지는 파일도 한도까지만 읽는다).
// Gradle 파일은 git에서 온 믿지 않는 입력이라 내용을 실행하지 않는다.

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

function unreadable(error: unknown): GradleFileProblem {
  return { problem: 'unreadable', detail: errnoCode(error) ?? 'read failed' }
}

// 한도+1바이트까지만 읽는다. 넘으면 null.
async function readBounded(handle: FileHandle, limit: number): Promise<Buffer | null> {
  const buffer = Buffer.alloc(limit + 1)
  let length = 0
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
    if (bytesRead === 0) break
    length += bytesRead
  }
  return length > limit ? null : buffer.subarray(0, length)
}

export function gradleFileSource(
  projectRoot: string,
  limit = MAX_GRADLE_FILE_BYTES
): GradleFileSource {
  const root = path.resolve(projectRoot)
  let realRoot: Promise<string | null> | null = null
  return {
    read: async (relPath) => {
      if (!isSafeProjectPath(relPath))
        return { problem: 'outsideProject', detail: 'not a project path' }
      realRoot ??= realpath(root).catch(() => null)
      const resolvedRoot = await realRoot
      if (resolvedRoot === null)
        return { problem: 'unreadable', detail: 'cannot resolve the project folder' }
      let real: string
      try {
        real = await realpath(path.join(root, ...relPath.split('/')))
      } catch (error) {
        const code = errnoCode(error)
        if (code === 'ENOENT' || code === 'ENOTDIR') return null
        return unreadable(error)
      }
      if (!containedIn(resolvedRoot, real)) return { problem: 'outsideProject' }
      const flags =
        constants.O_NOFOLLOW !== undefined
          ? constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
          : 'r'
      let handle: FileHandle
      try {
        handle = await openFile(real, flags)
      } catch (error) {
        const code = errnoCode(error)
        if (code === 'ENOENT' || code === 'ENOTDIR') return null
        if (code === 'ELOOP') return { problem: 'outsideProject', detail: 'became a link' }
        return unreadable(error)
      }
      try {
        const stats = await handle.stat()
        if (!stats.isFile()) return { problem: 'unreadable', detail: 'not a regular file' }
        if (stats.size > limit) return { problem: 'tooLarge' }
        const raw = await readBounded(handle, limit)
        if (raw === null) return { problem: 'tooLarge' }
        return raw.toString('utf8')
      } catch (error) {
        return unreadable(error)
      } finally {
        await handle.close().catch(() => undefined)
      }
    }
  }
}

function emptyProject(): GradleProject {
  return {
    dependencies: [],
    repositories: [],
    compileSdk: null,
    compileSdkMinor: null,
    diagnostics: [],
    files: []
  }
}

// 열거나 저장한 프로젝트가 아니면 읽지 않는다(빈 결과). 실행 준비(sidecar/launch.ts의 prepareRun)가 이미 확인하지만
// 이 함수만 따로 불러도 다른 폴더를 읽지 않게 한다. 읽기는 예외를 던지지 않지만, 혹시 던지면 INIT을 깨지 않고
// 진단 하나로 알린다(라이브러리 없이 실행된다).
export async function readProjectGradle(
  projectRoot: string,
  read: (source: GradleFileSource) => Promise<GradleProject> = readGradleProject
): Promise<GradleProject> {
  if (!isTrustedRoot(projectRoot)) return emptyProject()
  try {
    return await read(gradleFileSource(projectRoot))
  } catch (error) {
    const project = emptyProject()
    project.diagnostics.push({
      code: 'unsupportedSyntax',
      at: { file: 'TeamCode/build.gradle', line: 1 },
      detail: `Gradle files could not be read: ${error instanceof Error ? error.message : String(error)}`
    })
    return project
  }
}
