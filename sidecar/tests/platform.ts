// 시험 플랫폼 jar(사이드카 시험의 bootClasspath). CI·컨테이너에는 Android SDK가 없으므로, 호스트 JDK의 java.base에서
// java.*·javax.*만 담은 jar를 만들어 Android 플랫폼 API(android.jar) 대신 쓴다(sidecar/tools/org/sandbot/tools/PlatformJar.java,
// 소스 파일 하나로 바로 실행). 기본 결과는 sidecar/build/test-platform.jar이고, JDK·도구 소스·옵션이 같으면 다시 만들지 않는다.
// 실제 android.jar처럼 java.net.http 같은 java.base 밖 API는 없다. 이 JDK의 java.base에는 LambdaMetafactory가 있어 람다를
// 채울 필요가 없다(실제 android.jar에는 없다: exclude로 빼서 시험한다).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, runProcess, type SidecarBuild } from './support'

const TOOL = join(repoRoot, 'sidecar', 'tools', 'org', 'sandbot', 'tools', 'PlatformJar.java')
const buildDir = join(repoRoot, 'sidecar', 'build')

export type TestPlatformOptions = {
  // 빼는 엔트리 이름 접두어(예: 'java/lang/invoke/LambdaMetafactory.class')
  exclude?: string[]
}

const pending = new Map<string, Promise<string>>()

/** 시험 플랫폼 jar 경로(없거나 낡았으면 만든다). exclude가 있으면 sidecar/build/test-platform-<해시>.jar. */
export function testPlatformJar(
  build: SidecarBuild,
  options: TestPlatformOptions = {}
): Promise<string> {
  const exclude = [...(options.exclude ?? [])].sort()
  const key = createHash('sha256')
    .update(`${build.jdkHome}\0${build.java}\0`)
    .update(readFileSync(TOOL))
    .update(`\0${exclude.join('\0')}`)
    .digest('hex')
  const name = exclude.length === 0 ? 'test-platform' : `test-platform-${key.slice(0, 12)}`
  const jar = join(buildDir, `${name}.jar`)
  let work = pending.get(jar)
  if (!work) {
    work = make(build, jar, key, exclude)
    pending.set(jar, work)
  }
  return work
}

async function make(
  build: SidecarBuild,
  jar: string,
  key: string,
  exclude: string[]
): Promise<string> {
  const stamp = `${jar}.key`
  if (existsSync(jar) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key) return jar
  const result = await runProcess(build.java, [
    TOOL,
    '--out',
    jar,
    ...exclude.flatMap((prefix) => ['--exclude', prefix])
  ])
  if (result.code !== 0)
    throw new Error(`PlatformJar failed (exit ${result.code}):\n${result.output}`)
  const temp = `${stamp}.${process.pid}.tmp`
  writeFileSync(temp, key)
  renameSync(temp, stamp)
  return jar
}
