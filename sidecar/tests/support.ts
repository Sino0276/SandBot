// 사이드카 테스트 도구(R·D·M·T의 테스트가 같이 쓴다): 지금 소스로 빌드한 사이드카 jar를 찾거나 만들고,
// Java 테스트(sidecar/tests/java, org.sandbot.testing.TestMain)를 컴파일·실행한다.
//
// 빌드는 scripts/build-sidecar.mjs를 그대로 부른다(--if-stale, 출력은 sidecar/build/test-out/<소스 해시>/). 빌드 스크립트가
// sidecar/build/.lock으로 하나씩 하고, 이미 같은 소스로 만든 출력이면 건너뛰므로 여러 vitest 워커가 동시에 불러도 한 번만 빌드한다.
// 빌드는 수십 초 걸릴 수 있으니 테스트는 시간 제한을 넉넉히 준다(SIDECAR_TEST_TIMEOUT).
//
// 환경 변수 SANDBOT_SIDECAR_LENIENT=1이면 --allow-missing으로 빌드한다(손 구현·runtime이 아직 없는 작업 폴더에서 개발할 때).
// 그 빌드는 반드시 있어야 할 클래스가 stub이고 들여온 클래스를 패치하지 않았을 수 있다(sidecar.json의 incomplete).
import { execFile, execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type SidecarBuild = {
  jdkHome: string
  java: string
  javac: string
  sdkJar: string
  runtimeJar: string
  dir: string
}

/** 빌드·Java 테스트가 들어 있는 vitest 테스트의 시간 제한(밀리초) */
export const SIDECAR_TEST_TIMEOUT = 600_000

export const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const buildDir = join(repoRoot, 'sidecar', 'build')
const testingSources = join(repoRoot, 'sidecar', 'tests', 'java', 'org', 'sandbot', 'testing')

/** 명령 실행 결과. output은 stdout+stderr(받은 순서), JAVA_TOOL_OPTIONS 안내 줄은 뺀다. */
export type ProcessResult = { code: number; output: string; stdout: string }

// JVM의 JAVA_TOOL_OPTIONS 안내 줄은 버린다
function cleanOutput(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('Picked up JAVA_TOOL_OPTIONS'))
    .join('\n')
}

export function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<ProcessResult> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const all: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
      all.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => all.push(chunk))
    child.on('error', fail)
    child.on('close', (code) =>
      done({
        code: code ?? -1,
        stdout: cleanOutput(Buffer.concat(stdout).toString('utf8')),
        output: cleanOutput(Buffer.concat(all).toString('utf8'))
      })
    )
  })
}

type JdkInfo = { home: string; java: string; javac: string; version: number }

// scripts/sidecar-source.mjs가 소스 해시와 JDK를 정한다(빌드 스크립트와 같은 규칙)
function sidecarInfo(): Promise<{ sourceHash: string; jdk: JdkInfo | null }> {
  return new Promise((done, fail) => {
    execFile(
      process.execPath,
      [join(repoRoot, 'scripts', 'sidecar-source.mjs'), '--json'],
      { cwd: repoRoot },
      (error, stdout) => {
        if (error) fail(error)
        else done(JSON.parse(stdout))
      }
    )
  })
}

let jdkFound: boolean | undefined

/** 빌드할 JDK가 있는가(동기, describe.skipIf에 쓴다). 규칙은 빌드 스크립트와 같다(scripts/sidecar-source.mjs). */
export function hasJdk(): boolean {
  if (jdkFound === undefined) {
    const stdout = execFileSync(
      process.execPath,
      [join(repoRoot, 'scripts', 'sidecar-source.mjs'), '--json'],
      { cwd: repoRoot }
    ).toString('utf8')
    jdkFound = JSON.parse(stdout).jdk !== null
  }
  return jdkFound
}

/** SANDBOT_SIDECAR_LENIENT=1(--allow-missing 빌드)인가 */
export const lenientBuild = process.env.SANDBOT_SIDECAR_LENIENT === '1'

/**
 * 빌드 보고(scripts/build-sidecar.mjs --report): counts(손 구현·들여옴·stub 수), mustProvide(이름 → hand·lifted·stub·
 * missing), hand·lifted(최상위 이름), stubs(최상위 → 들여오지 못한 이유), topBlockers, incomplete, warnings.
 */
export type SidecarReport = {
  ok: boolean
  counts: Record<string, number>
  mustProvide: Record<string, string>
  hand: string[]
  lifted: string[]
  stubs: Record<string, string>
  missingTypes: string[]
  topBlockers: { name: string; kind: string; unlocks: number; liftedAfter: number; reason?: string }[]
  incomplete: string[]
  warnings: string[]
}

export function sidecarReport(build: SidecarBuild): SidecarReport {
  return JSON.parse(readFileSync(join(build.dir, 'build-report.json'), 'utf8'))
}

function tail(text: string, lines = 80): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n')
}

// 다른 소스 해시로 만든 지 하루 넘은 테스트 출력은 지운다(소스를 고칠 때마다 쌓이지 않게)
function removeOldOutputs(root: string, keep: string): void {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const name of entries) {
    const path = join(root, name)
    if (path === keep) continue
    try {
      if (Date.now() - statSync(path).mtimeMs > 24 * 3600 * 1000)
        rmSync(path, { recursive: true, force: true })
    } catch {
      // 다른 워커가 지웠다
    }
  }
}

let pending: Promise<SidecarBuild | null> | undefined

/**
 * 지금 소스로 빌드한 사이드카(없거나 낡았으면 sidecar/build/test-out/<sourceHash>/에 빌드, 여러 vitest 워커가 동시에 불러도
 * 한 번만). JDK가 없으면 null(테스트는 건너뛴다). 빌드가 실패하면 빌드 출력의 끝부분으로 예외를 던진다.
 */
export function sidecarBuild(): Promise<SidecarBuild | null> {
  pending ??= buildOnce()
  return pending
}

async function buildOnce(): Promise<SidecarBuild | null> {
  const { sourceHash, jdk } = await sidecarInfo()
  if (!jdk) return null
  const lenient = lenientBuild
  const outRoot = join(buildDir, 'test-out')
  const dir = join(outRoot, `${sourceHash.slice(0, 16)}${lenient ? '-lenient' : ''}`)
  removeOldOutputs(outRoot, dir)
  const args = [
    join(repoRoot, 'scripts', 'build-sidecar.mjs'),
    '--if-stale',
    '--out',
    dir,
    '--report',
    join(dir, 'build-report.json'),
    ...(lenient ? ['--allow-missing'] : [])
  ]
  const result = await runProcess(process.execPath, args, { ...process.env, SANDBOT_JDK: jdk.home })
  if (result.code !== 0) {
    throw new Error(`sidecar build failed (exit ${result.code}):\n${tail(result.output)}`)
  }
  return {
    jdkHome: jdk.home,
    java: jdk.java,
    javac: jdk.javac,
    sdkJar: join(dir, 'sandbot-sdk.jar'),
    runtimeJar: join(dir, 'sandbot-runtime.jar'),
    dir
  }
}

function javaFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...javaFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.java')) result.push(path)
  }
  return result
}

/**
 * Java 테스트 소스 폴더들을 컴파일해(클래스 경로: sdk+runtime+testing) 그 폴더를 돌려준다.
 * org.sandbot.testing(Check·TestMain)은 늘 함께 컴파일한다. --release 17(런타임 클래스를 쓸 수 있게).
 */
export async function compileJavaTests(build: SidecarBuild, sourceDirs: string[]): Promise<string> {
  const files = new Set<string>(javaFiles(testingSources))
  for (const dir of sourceDirs)
    for (const file of javaFiles(resolve(repoRoot, dir))) files.add(file)
  const root = join(buildDir, 'test-classes')
  mkdirSync(root, { recursive: true })
  const out = mkdtempSync(join(root, 'run-'))
  const result = await runProcess(build.javac, [
    '--release',
    '17',
    '-g',
    '-encoding',
    'UTF-8',
    '-proc:none',
    '-cp',
    [build.sdkJar, build.runtimeJar].join(delimiter),
    '-d',
    out,
    ...[...files].sort()
  ])
  if (result.code !== 0)
    throw new Error(`javac failed for the Java tests:\n${tail(result.output, 200)}`)
  return out
}

/** TestMain으로 돌리고 PASS/FAIL 줄을 파싱한다. 실행기가 끝까지 가지 못하면 failed에 "(runner)"를 넣는다. */
export async function runJavaTests(
  build: SidecarBuild,
  classesDir: string,
  classNames: string[]
): Promise<{ passed: string[]; failed: { id: string; detail: string }[]; output: string }> {
  if (!existsSync(classesDir)) throw new Error(`no such classes folder: ${classesDir}`)
  const result = await runProcess(build.java, [
    '-Dfile.encoding=UTF-8',
    '-Dstdout.encoding=UTF-8',
    '-Dstderr.encoding=UTF-8',
    '-Djava.awt.headless=true',
    '-cp',
    [classesDir, build.runtimeJar, build.sdkJar].join(delimiter),
    'org.sandbot.testing.TestMain',
    ...classNames
  ])
  const passed: string[] = []
  const failed: { id: string; detail: string }[] = []
  let current: { id: string; detail: string } | null = null
  let done = false
  for (const line of result.stdout.split('\n')) {
    if (current && line.startsWith('    ')) {
      current.detail += `\n${line.slice(4)}`
      continue
    }
    current = null
    if (line.startsWith('PASS ')) {
      passed.push(line.slice(5).trim())
    } else if (line.startsWith('FAIL ')) {
      const rest = line.slice(5)
      const space = rest.indexOf(' ')
      current = {
        id: space < 0 ? rest : rest.slice(0, space),
        detail: space < 0 ? '' : rest.slice(space + 1)
      }
      failed.push(current)
    } else if (line.startsWith('DONE ')) {
      done = true
    }
  }
  if (!done)
    failed.push({
      id: '(runner)',
      detail: `TestMain exited with ${result.code}:\n${tail(result.output)}`
    })
  return { passed, failed, output: result.output }
}
