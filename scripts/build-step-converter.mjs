// 네이티브 STEP 변환기(native/step-converter)를 빌드해 resources/step-converter/<platform>-<arch>/에 둔다.
// 필요한 것: git, CMake 3.19+, C++ 컴파일러(Windows는 Visual Studio Build Tools, macOS는 Xcode 명령행 도구).
// OCCT 전체를 컴파일하므로 처음 빌드는 오래 걸린다(4코어에서 2~3시간). 받은 소스와 빌드 폴더는 다시 쓴다.
//
// Windows x64용은 CI가 빌드해 Release에 올리므로 보통은 받아 쓴다(pnpm fetch:step-converter). 변환기 소스를 고쳤거나
// 다른 OS·CPU용이 필요할 때 직접 빌드한다.
//
// 사용법: node scripts/build-step-converter.mjs [--source <occt-import-js 폴더>] [--toolchain <cmake 툴체인>]
//                                              [--target <platform-arch>] [--jobs <n>]
//   --source    이미 받아 둔 occt-import-js(occt 하위 폴더 포함)를 쓴다. 커밋은 version.json과 같아야 한다.
//   --toolchain 교차 컴파일(예: MinGW로 Windows용). --target으로 출력 폴더 이름을 정한다(예: win32-x64)

import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  converterExe,
  PROVENANCE_FILE,
  releaseTag,
  repoRoot as root,
  targetMismatch
} from './step-converter-source.mjs'

const converterDir = join(root, 'native', 'step-converter')
const cacheDir = join(converterDir, '.cache')
// 렌더러의 occt-import-js와 같은 버전이어야 메시 순서가 같다(형상 id 호환). 앱도 같은 파일로 변환기를 확인한다.
const version = JSON.parse(readFileSync(join(converterDir, 'version.json'), 'utf8'))

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

function headCommit(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: 'pipe' }).toString().trim()
  } catch {
    return null
  }
}

// 태그를 얕게 받고 커밋 해시를 확인한다. 받다 끊긴 폴더나 다른 커밋이면 지우고 다시 받는다.
function checkout(source, dir) {
  if (existsSync(dir) && headCommit(dir) !== source.commit) {
    console.log(`removing incomplete or outdated checkout: ${dir}`)
    rmSync(dir, { recursive: true, force: true })
  }
  if (!existsSync(dir)) {
    mkdirSync(dirname(dir), { recursive: true })
    run('git', ['clone', '--depth', '1', '--branch', source.tag, source.url, dir])
  }
  const commit = headCommit(dir)
  if (commit !== source.commit) {
    throw new Error(`${dir} is at ${commit}, expected ${source.commit} (${source.tag})`)
  }
}

function verifySource(source, dir) {
  const commit = headCommit(dir)
  if (commit === null) {
    console.warn(`warning: cannot check the commit of ${dir} (not a git checkout)`)
  } else if (commit !== source.commit) {
    throw new Error(`${dir} is at ${commit}, expected ${source.commit} (${source.tag})`)
  }
}

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

// 64비트 x64·arm64만 만든다. 32비트(ia32, arm)는 주소 공간이 WASM의 2 GB 한도와 비슷해 변환기를 쓰는 이유가 없고,
// Node·electron-builder·CMake의 CPU 이름도 서로 달라(ia32/x86/Win32, arm/armv7l) 앱이 찾는 폴더와 맞지 않는다.
const target = option('target') ?? `${process.platform}-${process.arch}`
const targetArch = target.slice(target.lastIndexOf('-') + 1)
if (targetArch !== 'x64' && targetArch !== 'arm64') {
  throw new Error(`unsupported target ${target}: only x64 and arm64 are supported`)
}

let sourceDir
if (option('source')) {
  sourceDir = resolve(option('source'))
  verifySource(version.occtImportJs, sourceDir)
  verifySource(version.occt, join(sourceDir, 'occt'))
} else {
  sourceDir = join(cacheDir, 'occt-import-js')
  checkout(version.occtImportJs, sourceDir)
  checkout(version.occt, join(sourceDir, 'occt'))
}

const buildDir = join(cacheDir, `build-${target}`)
const firstConfigure = !existsSync(join(buildDir, 'CMakeCache.txt'))
const configure = [
  '-S',
  converterDir,
  '-B',
  buildDir,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DOCCT_IMPORT_JS_DIR=${sourceDir}`
]
// Ninja는 PATH의 컴파일러를 쓴다. Windows에서는 대상 CPU용 Visual Studio 개발자 환경(cl.exe가 PATH에 있음)일
// 때만 쓴다. 시작 메뉴의 "Developer Command Prompt"는 기본이 x86(32비트, WASM과 같은 2 GB 한도)이므로,
// 대상 CPU가 다르면 Visual Studio 생성기에 CPU를 지정해 MSVC를 찾게 한다.
const windowsNative = process.platform === 'win32' && !option('toolchain')
const devShellArch = process.env.VSCMD_ARG_TGT_ARCH?.toLowerCase()
const useNinja = hasCommand('ninja') && (!windowsNative || devShellArch === targetArch)
if (firstConfigure && useNinja) configure.push('-G', 'Ninja')
if (firstConfigure && windowsNative && !useNinja) {
  configure.push('-A', targetArch === 'arm64' ? 'ARM64' : 'x64')
}
if (option('toolchain')) configure.push(`-DCMAKE_TOOLCHAIN_FILE=${resolve(option('toolchain'))}`)
if (process.platform === 'darwin' && !option('toolchain')) {
  configure.push(`-DCMAKE_OSX_ARCHITECTURES=${targetArch === 'arm64' ? 'arm64' : 'x86_64'}`)
}
run('cmake', configure, root)
run(
  'cmake',
  [
    '--build',
    buildDir,
    '--config',
    'Release',
    '--target',
    'sandbot-step-converter',
    '--parallel',
    option('jobs') ?? String(cpus().length)
  ],
  root
)

const exe = converterExe(target)
// 단일 구성 생성기(Ninja, Makefile)는 빌드 폴더에, 다중 구성(Visual Studio, Xcode)은 Release 아래에 만든다
const built = [join(buildDir, exe), join(buildDir, 'Release', exe)].find((path) => existsSync(path))
if (!built) throw new Error(`built converter not found in ${buildDir}`)
const mismatch = targetMismatch(built, target)
if (mismatch) {
  throw new Error(
    `${built} is ${mismatch}. ` +
      `Remove ${buildDir} and build again with a ${targetArch} compiler ` +
      `(on Windows: the "x64 Native Tools Command Prompt" or a plain shell)`
  )
}
const outDir = join(root, 'resources', 'step-converter', target)
mkdirSync(outDir, { recursive: true })
copyFileSync(built, join(outDir, exe))
if (!target.startsWith('win32')) chmodSync(join(outDir, exe), 0o755)
// 어느 소스로 만든 것인지 남긴다. 받기(fetch-step-converter.mjs)는 같은 소스의 것이면 덮어쓰지 않는다.
writeFileSync(
  join(outDir, PROVENANCE_FILE),
  `${JSON.stringify({ tag: releaseTag(), origin: 'build' }, null, 2)}\n`
)
console.log(`STEP converter: ${join(outDir, exe)}`)

// Linux 바이너리는 빌드한 PC의 glibc보다 오래된 배포판에서는 실행되지 않는다(앱은 그때 WASM으로 읽는다).
// 배포용은 오래된 glibc 환경(예: manylinux_2_28 컨테이너)에서 빌드한다.
if (target.startsWith('linux')) {
  try {
    const symbols = execFileSync('objdump', ['-T', join(outDir, exe)]).toString()
    const versions = [...symbols.matchAll(/GLIBC_(\d+)\.(\d+)/g)].map((m) => [+m[1], +m[2]])
    const [major, minor] = versions.sort((a, b) => a[0] - b[0] || a[1] - b[1]).pop() ?? [0, 0]
    console.log(`requires glibc ${major}.${minor} or newer`)
  } catch {
    console.warn('warning: could not check the required glibc version (objdump not found)')
  }
}
