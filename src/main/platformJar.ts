import { createHash, randomBytes } from 'crypto'
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  utimes,
  writeFile
} from 'fs/promises'
import { join } from 'path'
import { crc32, inflateRawSync } from 'zlib'

// 팀 코드 컴파일 기준(javac -bootclasspath) jar 만들기. Android SDK의 platforms/android-N/android.jar에서 Java API
// (java.*·javax.*·org.w3c.*·org.xml.*)와 android.annotation만 골라 새 jar를 만든다. Android Studio가 팀 코드를 그 플랫폼의
// API로 컴파일하므로(List.of는 android-30부터 있다), 사이드카도 같은 API로 컴파일해야 같은 소스가 양쪽에서 같게 컴파일된다.
// android.*의 나머지는 가짜 SDK(sandbot-sdk.jar)가 준다(부트 클래스패스가 클래스패스보다 먼저라 넣으면 가린다).
//
// zip은 Node만으로 읽고 쓴다(zlib의 inflate·crc32, 중앙 디렉터리만 읽는 작은 구현, ZIP64·암호화·다중 디스크는 받지 않음).
// android.jar는 믿지 않는 입력으로 다룬다: 엔트리 수·크기·압축 비율 한도, 엔트리 이름 검사, 지역 머리말과 중앙 디렉터리의
// 이름·범위 대조, 압축을 풀어 크기·CRC 확인. 디스크에 이름대로 풀지 않고 메모리에서 새 zip을 쓴다(이름순, 고정 시각이라
// 같은 android.jar면 바이트가 같다). 결과는 userData/platform-cache/<android.jar의 SHA-256>.jar(원자적 쓰기, 있으면 다시
// 만들지 않음).

export class ZipError extends Error {}

// 받는 android.jar의 한도. android-34는 26 MB·엔트리 1만 4천 개, 고르는 클래스는 1500개·풀어서 약 10 MB다.
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
export const MAX_ENTRIES = 200_000
export const MAX_SELECTED_ENTRIES = 50_000
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024
export const MAX_SELECTED_BYTES = 256 * 1024 * 1024
// 이 크기를 넘는 엔트리는 압축 비율도 본다(압축 폭탄)
const RATIO_CHECK_BYTES = 1024 * 1024
const MAX_RATIO = 200
const MAX_NAME_BYTES = 1024

// 고르는 패키지(접두어). 이 밖은 버린다(android.*는 가짜 SDK, META-INF·리소스는 컴파일에 쓰지 않음).
export const PLATFORM_PREFIXES = ['java/', 'javax/', 'org/w3c/', 'org/xml/', 'android/annotation/']

export type ZipEntry = {
  name: string
  // 이름이 UTF-8 표시(비트 11) 없이 ASCII 밖 글자를 가졌다(이름을 믿을 수 없다)
  nameUnclear: boolean
  method: number
  flags: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
  // 중앙 디렉터리의 이름 바이트(지역 머리말과 대조)
  rawName: Buffer
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

function need(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ZipError(message)
}

// 중앙 디렉터리를 읽는다. 끝 레코드는 마지막 64 KiB(주석 한도) 안에서 찾는다.
export function readCentralDirectory(bytes: Buffer): ZipEntry[] {
  need(bytes.length >= 22, 'not a ZIP file')
  need(bytes.length <= MAX_ARCHIVE_BYTES, 'the archive is too large')
  const minEnd = Math.max(0, bytes.length - 22 - 0xffff)
  let end = -1
  for (let i = bytes.length - 22; i >= minEnd; i--) {
    if (bytes.readUInt32LE(i) === EOCD && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i
      break
    }
  }
  need(end >= 0, 'not a ZIP file')
  const disk = bytes.readUInt16LE(end + 4)
  const cdDisk = bytes.readUInt16LE(end + 6)
  const diskEntries = bytes.readUInt16LE(end + 8)
  const count = bytes.readUInt16LE(end + 10)
  const cdSize = bytes.readUInt32LE(end + 12)
  const cdOffset = bytes.readUInt32LE(end + 16)
  need(
    count !== 0xffff && cdSize !== 0xffffffff && cdOffset !== 0xffffffff,
    'ZIP64 is not supported'
  )
  need(disk === 0 && cdDisk === 0 && diskEntries === count, 'multi-disk ZIP is not supported')
  need(count <= MAX_ENTRIES, 'the archive has too many entries')
  need(cdOffset + cdSize <= end, 'bad ZIP central directory')

  const entries: ZipEntry[] = []
  let offset = cdOffset
  const cdEnd = cdOffset + cdSize
  for (let i = 0; i < count; i++) {
    need(offset + 46 <= cdEnd, 'bad ZIP central directory')
    need(bytes.readUInt32LE(offset) === CENTRAL, 'bad ZIP central directory')
    const flags = bytes.readUInt16LE(offset + 8)
    const method = bytes.readUInt16LE(offset + 10)
    const crc = bytes.readUInt32LE(offset + 16)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const size = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const startDisk = bytes.readUInt16LE(offset + 34)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const next = offset + 46 + nameLength + extraLength + commentLength
    need(next <= cdEnd, 'bad ZIP central directory')
    need(
      compressedSize !== 0xffffffff && size !== 0xffffffff && localOffset !== 0xffffffff,
      'ZIP64 is not supported'
    )
    need(startDisk === 0, 'multi-disk ZIP is not supported')
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength)
    const utf8 = (flags & 0x0800) !== 0
    const ascii = rawName.every((b) => b < 0x80)
    entries.push({
      name: rawName.toString(utf8 ? 'utf8' : 'latin1'),
      nameUnclear: !utf8 && !ascii,
      method,
      flags,
      crc,
      compressedSize,
      size,
      localOffset,
      rawName
    })
    offset = next
  }
  return entries
}

// 엔트리 이름이 jar 안의 평범한 상대 경로인가(절대 경로·드라이브·역슬래시·'..'·빈 조각·제어 문자 없음)
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) return false
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || name[i] === '\\' || name[i] === ':') return false
  }
  if (name.startsWith('/')) return false
  return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

// 엔트리 하나의 압축 데이터(지역 머리말 뒤). 범위와 이름을 중앙 디렉터리와 대조한다.
function compressedData(bytes: Buffer, entry: ZipEntry): Buffer {
  const local = entry.localOffset
  need(local + 30 <= bytes.length, `bad ZIP entry ${entry.name}`)
  need(bytes.readUInt32LE(local) === LOCAL, `bad ZIP entry ${entry.name}`)
  const nameLength = bytes.readUInt16LE(local + 26)
  const extraLength = bytes.readUInt16LE(local + 28)
  need(
    local + 30 + nameLength <= bytes.length &&
      bytes.subarray(local + 30, local + 30 + nameLength).equals(entry.rawName),
    `ZIP entry name mismatch for ${entry.name}`
  )
  const start = local + 30 + nameLength + extraLength
  need(start + entry.compressedSize <= bytes.length, `bad ZIP entry ${entry.name}`)
  return bytes.subarray(start, start + entry.compressedSize)
}

// 엔트리를 풀어 크기·CRC를 확인한다(크기 한도를 넘게 풀리면 멈춘다)
export function readEntry(bytes: Buffer, entry: ZipEntry): Buffer {
  need((entry.flags & 0x0001) === 0, `encrypted ZIP entry ${entry.name}`)
  need(entry.size <= MAX_ENTRY_BYTES, `ZIP entry ${entry.name} is too large`)
  need(
    entry.size <= RATIO_CHECK_BYTES || entry.size <= entry.compressedSize * MAX_RATIO,
    `ZIP entry ${entry.name} is compressed too much`
  )
  const data = compressedData(bytes, entry)
  let out: Buffer
  if (entry.method === 0) {
    need(data.length === entry.size, `ZIP entry ${entry.name} has the wrong size`)
    out = data
  } else if (entry.method === 8) {
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) })
    } catch {
      throw new ZipError(`cannot inflate ZIP entry ${entry.name}`)
    }
  } else {
    throw new ZipError(`unsupported ZIP compression ${entry.method} for ${entry.name}`)
  }
  need(out.length === entry.size, `ZIP entry ${entry.name} has the wrong size`)
  need(crc32(out) >>> 0 === entry.crc >>> 0, `ZIP entry ${entry.name} has the wrong CRC`)
  return out
}

export type ZipOutputEntry = {
  name: string
  // 압축하지 않은 크기와 CRC
  size: number
  crc: number
  // 0: 저장, 8: deflate(data는 그 방식의 바이트)
  method: 0 | 8
  data: Buffer
}

// 고정 시각(1980-01-01 00:00, DOS 형식의 가장 이른 값). 같은 입력 → 같은 바이트.
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1

// 새 zip을 쓴다(주어진 순서대로, 디렉터리 엔트리 없음)
export function writeZip(entries: ZipOutputEntry[]): Buffer {
  need(entries.length < 0xffff, 'too many ZIP entries')
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const flags = name.every((b) => b < 0x80) ? 0 : 0x0800
    const version = entry.method === 8 ? 20 : 10
    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL, 0)
    local.writeUInt16LE(version, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(entry.method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(entry.crc >>> 0, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.size, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL, 0)
    central.writeUInt16LE(version, 4)
    central.writeUInt16LE(version, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(entry.method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(entry.crc >>> 0, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, entry.data)
    centrals.push(central, name)
    offset += 30 + name.length + entry.data.length
    need(offset < 0xffffffff, 'the ZIP output is too large')
  }
  const cdSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

function selected(name: string): boolean {
  return name.endsWith('.class') && PLATFORM_PREFIXES.some((prefix) => name.startsWith(prefix))
}

// android.jar → 컴파일 기준 jar. 고른 엔트리마다 풀어 확인한 뒤 원래 압축 바이트를 그대로 옮긴다(다시 압축하지 않음).
// 이름이 믿을 수 없거나 안전하지 않은 엔트리는 고르지 않는다. 같은 이름이 둘이면 어느 쪽인지 정할 수 없어 실패한다.
export function filterPlatformJar(source: Buffer): Buffer {
  const entries = readCentralDirectory(source)
  const chosen = entries.filter(
    (e) => !e.nameUnclear && isSafeEntryName(e.name) && selected(e.name)
  )
  need(chosen.length <= MAX_SELECTED_ENTRIES, 'the archive has too many classes')
  const names = new Set<string>()
  let total = 0
  for (const entry of chosen) {
    need(!names.has(entry.name), `duplicate ZIP entry ${entry.name}`)
    names.add(entry.name)
    total += entry.size
    need(total <= MAX_SELECTED_BYTES, 'the archive is too large when uncompressed')
  }
  need(names.has('java/lang/Object.class'), 'not an Android platform jar (no java/lang/Object)')
  chosen.sort((a, b) => Buffer.compare(Buffer.from(a.name, 'utf8'), Buffer.from(b.name, 'utf8')))
  return writeZip(
    chosen.map((entry) => {
      readEntry(source, entry)
      return {
        name: entry.name,
        size: entry.size,
        crc: entry.crc,
        method: entry.method as 0 | 8,
        data: compressedData(source, entry)
      }
    })
  )
}

// ───────────────────────── 캐시 ─────────────────────────

// android.jar의 SHA-256을 파일 상태(실제 위치·크기·수정 시각)로 기억한다(INIT마다 수십 MB를 다시 해시하지 않게)
const hashMemo = new Map<string, string>()
const building = new Map<string, Promise<string>>()

// 테스트용
export function resetPlatformJarMemo(): void {
  hashMemo.clear()
}

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
// 남은 임시 파일은 이만큼 지나면 지운다(다른 SandBot 창이 쓰는 중일 수 있다)
const STALE_TEMP_MS = 60 * 60 * 1000
// 캐시에 남기는 플랫폼 jar 수(최근에 쓴 것부터, 하나에 10 MB 안팎)
export const KEEP_PLATFORM_JARS = 6

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

async function writeAtomic(target: string, bytes: Buffer): Promise<void> {
  const temp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, bytes)
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      // Windows: 다른 창이 같은 파일을 먼저 만들었으면(열려 있어 바꿀 수 없음) 그것을 쓴다(내용이 같다)
      const exists = (await stat(target).catch(() => null))?.isFile() ?? false
      if (exists || attempt >= 5 || !RETRY_CODES.has(code)) {
        await unlink(temp).catch(() => undefined)
        if (exists) return
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
}

// 오래 쓰지 않은 플랫폼 jar와 남은 임시 파일을 지운다(keep은 남긴다)
async function prune(dir: string, keep: string, now: number): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[])
  const jars: { path: string; mtime: number }[] = []
  for (const name of names) {
    const path = join(dir, name)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) continue
    if (name.endsWith('.tmp')) {
      if (now - info.mtimeMs > STALE_TEMP_MS) await unlink(path).catch(() => undefined)
    } else if (/^[0-9a-f]{64}\.jar$/.test(name) && path !== keep) {
      jars.push({ path, mtime: info.mtimeMs })
    }
  }
  jars.sort((a, b) => b.mtime - a.mtime)
  for (const old of jars.slice(KEEP_PLATFORM_JARS - 1))
    await unlink(old.path).catch(() => undefined)
}

// android.jar의 컴파일 기준 jar 경로(cacheDir/<SHA-256>.jar). 없으면 만든다. 읽거나 만들지 못하면 ZipError나 파일 오류.
export async function ensurePlatformJar(androidJar: string, cacheDir: string): Promise<string> {
  const info = await stat(androidJar)
  if (!info.isFile()) throw new ZipError(`not a file: ${androidJar}`)
  if (info.size > MAX_ARCHIVE_BYTES) throw new ZipError('the archive is too large')
  const real = await realpath(androidJar)
  const memoKey = `${real}\0${info.size}\0${info.mtimeMs}\0${info.ino}`
  let bytes: Buffer | null = null
  let hash = hashMemo.get(memoKey)
  if (!hash) {
    bytes = await readFile(real)
    hash = sha256(bytes)
    hashMemo.set(memoKey, hash)
  }
  const target = join(cacheDir, `${hash}.jar`)
  const existing = await stat(target).catch(() => null)
  if (existing?.isFile() && existing.size > 0) {
    // 최근에 쓴 것으로 표시한다(지우기 순서)
    const now = new Date()
    await utimes(target, now, now).catch(() => undefined)
    return target
  }
  const pending = building.get(target)
  if (pending) return pending
  const work = (async () => {
    const source = bytes ?? (await readFile(real))
    // 해시를 기억한 뒤 파일이 바뀌었으면 다른 내용을 그 이름으로 두지 않는다
    if (bytes === null && sha256(source) !== hash) {
      hashMemo.delete(memoKey)
      throw new ZipError(`${androidJar} changed while reading it`)
    }
    const jar = filterPlatformJar(source)
    await mkdir(cacheDir, { recursive: true })
    await writeAtomic(target, jar)
    await prune(cacheDir, target, Date.now())
    return target
  })()
  building.set(target, work)
  try {
    return await work
  } finally {
    building.delete(target)
  }
}
