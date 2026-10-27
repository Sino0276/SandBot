// JVM 사이드카(가짜 FTC SDK + 런타임)를 빌드해 resources/sidecar/에 둔다(pnpm build:sidecar).
//   sandbot-sdk.jar     sim + 손 구현(sidecar/sdk) + 들여온 실제 SDK 클래스(시간 API 패치) + 껍데기(stub)
//   sandbot-runtime.jar runtime(sidecar/runtime, Main-Class org.sandbot.runtime.Main)
//   sidecar.json        { sourceHash, sdkVersion, protocol, javaRelease }(--allow-missing으로 빠진 것이 있으면 incomplete)
//   NOTICE.txt          FTC SDK의 BSD 고지(들여온 바이너리를 배포하므로)
// 순서: JDK 찾기 → SDK 받기(scripts/fetch-ftc-sdk.mjs) → 빌드 도구(sidecar/tools) 컴파일 → org.sandbot.tools.SdkBuild
// (stub 생성·컴파일·들여오기·패치·링크 확인·API 대조·jar). 자세한 단계는 SdkBuild.java.
//
// 사용법: node scripts/build-sidecar.mjs [--if-stale] [--optional] [--allow-missing] [--out <dir>] [--report <file>]
//   --if-stale      출력 폴더의 sidecar.json의 sourceHash가 지금 소스와 같으면 건너뛴다(scripts/sidecar-source.mjs)
//   --optional      JDK가 없거나 SDK를 받지 못하면 경고만 하고 0으로 끝난다(pnpm dev). 빌드 오류는 그대로 실패한다
//   --allow-missing 아직 없는 것(반드시 있어야 할 클래스가 stub, runtime Main·PatchTool 없음)을 경고로 낮춘다.
//                   패치하지 않은 들여온 클래스는 진짜 시계를 쓰므로 개발용이다. sidecar.json에 incomplete로 남는다
//   --out           출력 폴더(기본 resources/sidecar)
//   --report        빌드 보고 JSON(기본 sidecar/build/report.json): 손 구현·들여옴·stub 수, 들여오기를 막는 클래스 순서 등
// 종료 코드: 0 성공(또는 건너뜀), 1 빌드 실패, 2 JDK 없음
// JDK: SANDBOT_JDK → JAVA_HOME → PATH → 흔한 Android Studio jbr 위치(17 이상)
// 여러 빌드가 동시에 돌면(예: vitest 워커들) sidecar/build/.lock으로 하나씩 한다.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { ensureFtcSdk, FetchError, SDK_VERSION } from './fetch-ftc-sdk.mjs'
import {
  MIN_JDK,
  findJdk,
  repoRoot,
  sidecarProtocol,
  sidecarSourceHash
} from './sidecar-source.mjs'

const JAVA_RELEASE = 8
const buildDir = join(repoRoot, 'sidecar', 'build')

// 들여오기·stub의 대상: SDK의 classes.jar 넷과, RobotCore AAR이 함께 싣는 Gson(SDK가 쓰고 팀 코드도 쓸 수 있다,
// Apache 2.0). 같은 AAR의 slf4j는 SDK 클래스가 쓰지 않으므로 넣지 않는다.
function liftableJars(sdk) {
  return [...sdk.jars, ...sdk.libs.filter((path) => /[\\/]gson(-extras)?-[\d.]+\.jar$/.test(path))]
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const flag = (name) => process.argv.includes(`--${name}`)

const out = resolve(option('out') ?? join(repoRoot, 'resources', 'sidecar'))
const report = resolve(option('report') ?? join(buildDir, 'report.json'))
const allowMissing = flag('allow-missing')
const optional = flag('optional')

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// 출력이 지금 소스로 만든 것인가. --allow-missing 없이 부르면 빠진 것이 있는 빌드는 낡은 것으로 본다.
function isFresh(dir, hash, lenient) {
  const info = readJson(join(dir, 'sidecar.json'))
  if (!info || info.sourceHash !== hash) return false
  if (!lenient && Array.isArray(info.incomplete) && info.incomplete.length > 0) return false
  return ['sandbot-sdk.jar', 'sandbot-runtime.jar', 'NOTICE.txt'].every((f) =>
    existsSync(join(dir, f))
  )
}

// ---- 잠금(폴더 만들기는 원자적이다). 잡은 프로세스가 죽었으면 풀린 것으로 본다.

const lockDir = join(buildDir, '.lock')

function lockOwnerAlive() {
  const owner = readJson(join(lockDir, 'owner.json'))
  if (!owner) {
    // 막 만든 잠금(owner를 쓰기 전)일 수 있다: 오래됐을 때만 버린다
    try {
      return Date.now() - statSync(lockDir).mtimeMs < 30000
    } catch {
      return false
    }
  }
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

async function acquireLock() {
  mkdirSync(buildDir, { recursive: true })
  let announced = false
  for (;;) {
    try {
      mkdirSync(lockDir)
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, out }))
      return () => rmSync(lockDir, { recursive: true, force: true })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    if (!lockOwnerAlive()) {
      rmSync(lockDir, { recursive: true, force: true })
      continue
    }
    if (!announced) {
      console.log('another sidecar build is running; waiting…')
      announced = true
    }
    await new Promise((done) => setTimeout(done, 300))
  }
}

// ---- 실행

function run(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    // JVM이 JAVA_TOOL_OPTIONS 안내 줄을 쓰면 버린다
    const pass = (stream, target) => {
      let rest = ''
      stream.on('data', (chunk) => {
        const lines = (rest + chunk.toString('utf8')).split('\n')
        rest = lines.pop()
        for (const line of lines)
          if (!line.startsWith('Picked up JAVA_TOOL_OPTIONS')) target.write(`${line}\n`)
      })
      stream.on('end', () => {
        if (rest && !rest.startsWith('Picked up JAVA_TOOL_OPTIONS')) target.write(`${rest}\n`)
      })
    }
    pass(child.stdout, process.stdout)
    pass(child.stderr, process.stderr)
    child.on('error', fail)
    child.on('close', (code) => done(code))
  })
}

function javaFiles(dir) {
  const result = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...javaFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.java')) result.push(path)
  }
  return result.sort()
}

// 빌드 도구(sidecar/tools)를 컴파일한다. 소스와 JDK가 같으면 다시 하지 않는다.
async function compileTools(jdk) {
  const sources = javaFiles(join(repoRoot, 'sidecar', 'tools'))
  const hash = createHash('sha256').update(`jdk ${jdk.home} ${jdk.version}\n`)
  for (const file of sources) hash.update(`${file}\0`).update(readFileSync(file))
  const key = hash.digest('hex')
  const dir = join(buildDir, 'tools-classes')
  if (readText(join(dir, '.hash')) === key) return dir
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const code = await run(jdk.javac, [
    '--release',
    '17',
    '-encoding',
    'UTF-8',
    '-d',
    dir,
    ...sources
  ])
  if (code !== 0) throw new Error('cannot compile the sidecar build tools (sidecar/tools)')
  writeFileSync(join(dir, '.hash'), key)
  return dir
}

async function main() {
  const hash = sidecarSourceHash()
  if (flag('if-stale') && isFresh(out, hash, allowMissing)) {
    console.log(`sidecar is up to date (${hash.slice(0, 12)}): ${out}`)
    return 0
  }
  const { jdk, rejected } = findJdk()
  if (!jdk) {
    const detail = rejected.map((r) => `\n  ${r.home}: ${r.problem}`).join('')
    const message =
      `no JDK ${MIN_JDK} or newer found (SANDBOT_JDK, JAVA_HOME, PATH, Android Studio's jbr)${detail}\n` +
      'Install Android Studio or a JDK 17+, or set SANDBOT_JDK to its folder'
    if (optional) {
      console.warn(`warning: ${message}\nwarning: skipping the sidecar build (OpModes cannot run)`)
      return 0
    }
    console.error(`error: ${message}`)
    return 2
  }

  const release = await acquireLock()
  try {
    // 기다리는 동안 다른 빌드가 같은 출력을 만들었을 수 있다
    if (flag('if-stale') && isFresh(out, hash, allowMissing)) {
      console.log(`sidecar is up to date (${hash.slice(0, 12)}): ${out}`)
      return 0
    }
    let sdk
    try {
      sdk = await ensureFtcSdk()
    } catch (error) {
      if (!(error instanceof FetchError)) throw error
      if (optional) {
        console.warn(`warning: ${error.message}\nwarning: skipping the sidecar build`)
        return 0
      }
      console.error(`error: ${error.message}`)
      return 1
    }
    console.log(`building the sidecar with JDK ${jdk.version} (${jdk.home})`)
    const tools = await compileTools(jdk)
    // 실패한 빌드가 이전 sidecar.json으로 최신처럼 보이지 않게 먼저 지운다
    mkdirSync(out, { recursive: true })
    rmSync(join(out, 'sidecar.json'), { force: true })
    const code = await run(jdk.java, [
      '-Xss8m',
      '-cp',
      tools,
      'org.sandbot.tools.SdkBuild',
      '--work',
      join(buildDir, 'work'),
      '--real',
      liftableJars(sdk).join(delimiter),
      '--android',
      sdk.androidJar,
      '--sim',
      join(repoRoot, 'sidecar', 'sim'),
      '--sdk',
      join(repoRoot, 'sidecar', 'sdk'),
      '--runtime',
      join(repoRoot, 'sidecar', 'runtime'),
      '--must-provide',
      join(repoRoot, 'sidecar', 'tools', 'must-provide.txt'),
      '--source-hash',
      hash,
      '--java',
      jdk.java,
      '--out',
      out,
      '--report',
      report,
      ...(allowMissing ? ['--allow-missing'] : [])
    ])
    if (code !== 0) {
      console.error(`error: sidecar build failed (report: ${report})`)
      return 1
    }
    const result = readJson(report)
    copyFileSync(join(repoRoot, 'sidecar', 'NOTICE.txt'), join(out, 'NOTICE.txt'))
    const info = {
      sourceHash: hash,
      sdkVersion: SDK_VERSION,
      protocol: sidecarProtocol(),
      javaRelease: JAVA_RELEASE,
      ...(result?.incomplete?.length ? { incomplete: result.incomplete } : {})
    }
    writeFileSync(join(out, 'sidecar.json'), `${JSON.stringify(info, null, 2)}\n`)
    if (info.incomplete) {
      console.warn(
        `warning: the sidecar is incomplete (--allow-missing): ${info.incomplete.length} problem(s)`
      )
    }
    console.log(`sidecar: ${out}`)
    return 0
  } finally {
    release()
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
}
