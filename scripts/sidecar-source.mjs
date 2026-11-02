// JVM 사이드카의 소스 식별과 빌드용 JDK 찾기. 빌드(build-sidecar.mjs)와 테스트(sidecar/tests/support.ts)가 같이 쓴다.
//
// 소스 해시: 사이드카 결과(sandbot-sdk.jar·sandbot-runtime.jar·sandbot-dashboard.jar·sidecar.json)를 바꿀 수 있는 파일
// (sidecar/{sim,sdk,runtime,tools,libs}, 빌드·받기 스크립트, NOTICE, 프로토콜 번호가 있는 src/shared/sidecarProtocol.ts)의
// 내용 해시다. 빌드는 이 값을 sidecar.json과 runtime jar(org/sandbot/runtime/source-hash.txt, 사이드카가 hello.runtime으로
// 보냄)에 넣고, --if-stale은 같으면 건너뛴다.
// Windows에서 git이 줄 끝을 CRLF로 바꿔도 같도록 CR은 빼고 계산한다(step-converter-source.mjs와 같은 방식).
//
// 직접 실행: node scripts/sidecar-source.mjs [--json]
//   기본은 소스 해시, --json은 { sourceHash, jdk }(jdk는 찾은 JDK 또는 null)를 출력한다.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 해시에 넣는 파일·폴더(저장소 기준). 폴더는 안의 파일을 모두 넣는다.
const SOURCE_PATHS = [
  'sidecar/sim',
  'sidecar/sdk',
  'sidecar/runtime',
  'sidecar/tools',
  'sidecar/libs',
  'sidecar/NOTICE.txt',
  'scripts/build-sidecar.mjs',
  'scripts/fetch-ftc-sdk.mjs',
  'scripts/sidecar-source.mjs',
  'src/shared/sidecarProtocol.ts'
]

// 빌드에 필요한 최소 JDK(runtime이 --release 17)
export const MIN_JDK = 17

function listFiles(root, path) {
  const full = join(root, path)
  let entries
  try {
    entries = readdirSync(full, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOTDIR') return [path]
    if (error.code === 'ENOENT') return []
    throw error
  }
  return entries
    .flatMap((entry) => (entry.isDirectory() || entry.isFile() ? [entry] : []))
    .flatMap((entry) => listFiles(root, `${path}/${entry.name}`))
}

export function sidecarSourceFiles(root = repoRoot) {
  return SOURCE_PATHS.flatMap((path) => listFiles(root, path))
    .map((path) => relative(root, join(root, path)).split(sep).join('/'))
    .sort()
}

export function sidecarSourceHash(root = repoRoot) {
  const hash = createHash('sha256')
  for (const path of sidecarSourceFiles(root)) {
    const text = readFileSync(join(root, path)).toString('latin1').replace(/\r\n/g, '\n')
    hash.update(`${path}\0${text.length}\0`)
    hash.update(text, 'latin1')
  }
  return hash.digest('hex')
}

// 사이드카 프로토콜 번호(sidecar.json의 protocol). 메인 프로세스가 같은 상수로 확인한다.
export function sidecarProtocol(root = repoRoot) {
  const text = readFileSync(join(root, 'src/shared/sidecarProtocol.ts'), 'utf8')
  const match = /export const SIDECAR_PROTOCOL_VERSION = (\d+)/.exec(text)
  if (!match) throw new Error('SIDECAR_PROTOCOL_VERSION not found in src/shared/sidecarProtocol.ts')
  return Number(match[1])
}

// ---- JDK

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name)

// release 파일의 JAVA_VERSION("1.8.0_402" → 8, "17.0.2" → 17, "21" → 21)
export function jdkMajor(home) {
  let text
  try {
    text = readFileSync(join(home, 'release'), 'utf8')
  } catch {
    return null
  }
  const match = /^JAVA_VERSION="?([^"\r\n]+)"?/m.exec(text)
  if (!match) return null
  const parts = match[1].split(/[.+_-]/).map(Number)
  if (parts[0] === 1 && parts.length > 1) return parts[1]
  return Number.isFinite(parts[0]) ? parts[0] : null
}

// 폴더가 쓸 수 있는 JDK인지. 맞으면 { home, java, javac, version }, 아니면 { home, problem }.
export function checkJdk(home) {
  const java = join(home, 'bin', exe('java'))
  const javac = join(home, 'bin', exe('javac'))
  if (!existsSync(java)) return { home, problem: 'no bin/java' }
  if (!existsSync(javac)) return { home, problem: 'no bin/javac (a JRE, not a JDK)' }
  const version = jdkMajor(home)
  if (version === null) return { home, problem: 'no readable release file' }
  if (version < MIN_JDK) return { home, problem: `JDK ${version} (needs ${MIN_JDK} or newer)` }
  return { home, java, javac, version }
}

// PATH의 java에서 JDK 폴더(심볼릭 링크를 따라간다: /usr/bin/java → …/jvm/x/bin/java)
function homeFromPath() {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const java = join(dir, exe('java'))
    if (!existsSync(java)) continue
    try {
      return dirname(dirname(realpathSync(java)))
    } catch {
      continue
    }
  }
  return null
}

// macOS의 /usr/bin/java는 링크가 아니라 감싸개라서 java_home으로 묻는다
function macJavaHome() {
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('/usr/libexec/java_home', ['-v', `${MIN_JDK}+`], { stdio: 'pipe' })
      .toString()
      .trim()
  } catch {
    return null
  }
}

// 흔한 Android Studio 설치 위치의 jbr(JetBrains Runtime, JDK 17 이상을 담고 있다)
function androidStudioJbrs() {
  const home = homedir()
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA
    ]
    return [
      ...roots
        .filter(Boolean)
        .flatMap((root) => [
          join(root, 'Android', 'Android Studio', 'jbr'),
          join(root, 'Programs', 'Android Studio', 'jbr')
        ])
    ]
  }
  if (process.platform === 'darwin') {
    let apps = []
    try {
      apps = readdirSync('/Applications').filter((name) => /^Android Studio.*\.app$/.test(name))
    } catch {
      // 없음
    }
    return apps.map((app) => join('/Applications', app, 'Contents', 'jbr', 'Contents', 'Home'))
  }
  return [
    '/opt/android-studio/jbr',
    '/usr/local/android-studio/jbr',
    join(home, 'android-studio', 'jbr'),
    '/snap/android-studio/current/jbr'
  ]
}

/**
 * 빌드에 쓸 JDK를 찾는다: SANDBOT_JDK → JAVA_HOME → PATH의 java → 흔한 Android Studio jbr 위치. 17 이상.
 * @returns {{ jdk: { home: string, java: string, javac: string, version: number } | null, rejected: { home: string, problem: string }[] }}
 */
export function findJdk() {
  // SANDBOT_JDK를 정했으면 그것만 쓴다(틀렸을 때 다른 JDK로 몰래 빌드하지 않게)
  if (process.env.SANDBOT_JDK) {
    const result = checkJdk(resolve(process.env.SANDBOT_JDK))
    return result.problem ? { jdk: null, rejected: [result] } : { jdk: result, rejected: [] }
  }
  const candidates = [
    process.env.JAVA_HOME,
    homeFromPath(),
    macJavaHome(),
    ...androidStudioJbrs()
  ].filter(Boolean)
  const rejected = []
  const seen = new Set()
  for (const home of candidates) {
    const resolved = resolve(home)
    if (seen.has(resolved) || !existsSync(resolved)) continue
    seen.add(resolved)
    const result = checkJdk(resolved)
    if (result.problem) rejected.push(result)
    else return { jdk: result, rejected }
  }
  return { jdk: null, rejected }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ sourceHash: sidecarSourceHash(), jdk: findJdk().jdk }))
  } else {
    console.log(sidecarSourceHash())
  }
}
