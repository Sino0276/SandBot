// 네이티브 STEP 변환기의 소스 식별과 실행 파일 확인. 빌드(build-step-converter.mjs), 받기(fetch-step-converter.mjs),
// CI(.github/workflows/step-converter.yml)가 같이 쓴다.
//
// 소스 해시: 변환기 결과를 바꿀 수 있는 파일(native/step-converter의 version.json·CMake·소스, 빌드 스크립트)의 내용
// 해시다. CI는 이 해시로 Release 태그(step-converter-<해시 16자리>)를 만들고, 받기 스크립트는 지금 작업 폴더의 해시로
// 같은 태그를 찾는다. 그래서 받은 실행 파일은 지금 소스로 빌드한 것과 같다. Windows에서 git이 줄 끝을 CRLF로 바꿔도
// 해시가 같도록 CR은 빼고 계산한다.
//
// 직접 실행하면 Release 태그를 출력한다: node scripts/step-converter-source.mjs [--root <저장소 폴더>]

import { createHash } from 'node:crypto'
import { closeSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 해시에 넣는 파일·폴더(저장소 기준). 폴더는 안의 파일을 모두 넣는다.
const SOURCE_PATHS = [
  'native/step-converter/version.json',
  'native/step-converter/CMakeLists.txt',
  'native/step-converter/cmake',
  'native/step-converter/src',
  'scripts/build-step-converter.mjs',
  'scripts/step-converter-source.mjs'
]

function listFiles(root, path) {
  const full = join(root, path)
  let entries
  try {
    entries = readdirSync(full, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOTDIR') return [path]
    throw error
  }
  return entries
    .flatMap((entry) => (entry.isDirectory() || entry.isFile() ? [entry] : []))
    .flatMap((entry) => listFiles(root, `${path}/${entry.name}`))
}

export function converterSourceFiles(root = repoRoot) {
  return SOURCE_PATHS.flatMap((path) => listFiles(root, path))
    .map((path) => relative(root, join(root, path)).split(sep).join('/'))
    .sort()
}

export function converterSourceHash(root = repoRoot) {
  const hash = createHash('sha256')
  for (const path of converterSourceFiles(root)) {
    const text = readFileSync(join(root, path)).toString('latin1').replace(/\r\n/g, '\n')
    hash.update(`${path}\0${text.length}\0`)
    hash.update(text, 'latin1')
  }
  return hash.digest('hex')
}

export function releaseTag(root = repoRoot) {
  return `step-converter-${converterSourceHash(root).slice(0, 16)}`
}

// 대상(<platform>-<arch>)의 실행 파일 이름과 Release 자산 이름
export function converterExe(target) {
  return target.startsWith('win32') ? 'sandbot-step-converter.exe' : 'sandbot-step-converter'
}

export function releaseAssetName(target) {
  return `sandbot-step-converter-${target}${target.startsWith('win32') ? '.exe' : ''}`
}

// 빌드·받기가 실행 파일 옆에 남기는 기록(어느 소스 해시의 것인지). 받기는 이것으로 이미 최신인지 안다.
export const PROVENANCE_FILE = 'source.json'

// 실행 파일 헤더의 형식과 CPU(PE·ELF·Mach-O). 다른 CPU·OS용 실행 파일을 그 이름의 폴더에 넣지 않게 확인한다.
export function binaryInfo(path) {
  const header = Buffer.alloc(4096)
  const fd = openSync(path, 'r')
  let length
  try {
    length = readSync(fd, header, 0, header.length, 0)
  } finally {
    closeSync(fd)
  }
  if (length >= 0x40 && header.toString('latin1', 0, 2) === 'MZ') {
    const pe = header.readUInt32LE(0x3c)
    if (pe + 6 > length || header.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null
    const machine = header.readUInt16LE(pe + 4)
    const arch = { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'ia32' }[machine]
    return { platform: 'win32', arch: arch ?? `pe-${machine.toString(16)}` }
  }
  if (length >= 20 && header.toString('latin1', 0, 4) === '\x7fELF') {
    const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18)
    const arch = { 0x3e: 'x64', 0xb7: 'arm64', 0x03: 'ia32', 0x28: 'arm' }[machine]
    return { platform: 'linux', arch: arch ?? `elf-${machine}` }
  }
  if (length >= 8 && header.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = header.readUInt32LE(4)
    const arch = { 0x01000007: 'x64', 0x0100000c: 'arm64' }[cpu]
    return { platform: 'darwin', arch: arch ?? `macho-${cpu.toString(16)}` }
  }
  // 여러 CPU를 묶은 Mach-O(universal)는 한 CPU 폴더에 넣지 않는다
  return null
}

// 실행 파일이 대상(<platform>-<arch>)용인지. 아니면 이유를, 맞으면 null을 돌려준다.
export function targetMismatch(path, target) {
  const info = binaryInfo(path)
  const expected = target.slice(target.lastIndexOf('-') + 1)
  const platform = target.slice(0, target.lastIndexOf('-'))
  if (!info) return 'not a single-CPU executable'
  if (info.platform !== platform || info.arch !== expected)
    return `built for ${info.platform}-${info.arch}, not ${target}`
  return null
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--root')
  console.log(releaseTag(index >= 0 ? resolve(process.argv[index + 1]) : repoRoot))
}
