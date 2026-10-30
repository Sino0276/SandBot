import { createHash } from 'crypto'
import { lstat, readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

// Android Studio(Gradle)가 받아 둔 파일 찾기: <GRADLE_USER_HOME 또는 ~/.gradle>/caches/modules-2/files-2.1/
// <group>/<artifact>/<version>/<sha1>/<파일>. 폴더 이름이 내용의 SHA-1이라(앞의 0을 빼고 쓴 Gradle 버전도 있다) 읽은 내용과
// 맞는 것만 쓴다. 팀이 실제로 빌드한 그 파일이고, 네트워크 없이 된다. 링크·보통 파일이 아닌 것은 건너뛴다.

export function gradleUserHome(env: NodeJS.ProcessEnv, home: string = homedir()): string {
  const configured = env.GRADLE_USER_HOME?.trim()
  return configured ? configured : join(home, '.gradle')
}

const SHA1_FOLDER = /^[0-9a-f]{1,40}$/

export type GradleCacheHit = { bytes: Buffer; sha1: string; path: string }

// 좌표·파일 이름은 version.ts로 확인한 것(경로 글자가 안전한 것)이어야 한다
export async function findInGradleCache(
  gradleHome: string,
  group: string,
  artifact: string,
  version: string,
  fileName: string,
  limit: number
): Promise<GradleCacheHit | null> {
  const dir = join(gradleHome, 'caches', 'modules-2', 'files-2.1', group, artifact, version)
  const folders = (await readdir(dir).catch(() => [] as string[]))
    .filter((name) => SHA1_FOLDER.test(name))
    .sort()
  for (const folder of folders) {
    const path = join(dir, folder, fileName)
    const info = await lstat(path).catch(() => null)
    if (!info || !info.isFile() || info.size > limit) continue
    const bytes = await readFile(path).catch(() => null)
    if (!bytes) continue
    const sha1 = createHash('sha1').update(bytes).digest('hex')
    if (sha1 === folder.padStart(40, '0')) return { bytes, sha1, path }
  }
  return null
}
