import { crc32, inflateRawSync } from 'zlib'

// jar·AAR(ZIP)을 메모리에서 읽는다. 받은 파일은 믿지 않는 입력이라 엔트리를 이름대로 디스크에 풀지 않고(zip slip),
// 엔트리 수·풀린 크기·압축 비율을 제한하고(압축 폭탄), 같은 이름이 두 번 있으면 거부한다. ZIP64·암호화는 받지 않는다
// (FTC 라이브러리는 작다). 이름은 중앙 디렉터리의 것을 쓴다.

export class ZipError extends Error {}

export type ZipEntry = {
  name: string
  method: number
  flags: number
  compressedSize: number
  size: number
  crc: number
  localOffset: number
}

export type ZipLimits = {
  maxEntries: number
  // 엔트리 하나를 풀었을 때 최대 크기
  maxEntrySize: number
  // 풀린 크기 ÷ 압축 크기의 최대(작은 엔트리는 보지 않는다)
  maxRatio: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 65_535,
  maxEntrySize: 64 * 1024 * 1024,
  maxRatio: 200
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const RATIO_FLOOR = 1024 * 1024

export type ZipReader = {
  entries: readonly ZipEntry[]
  // 이름으로 찾아 푼다(없으면 null)
  read: (name: string) => Buffer | null
}

export function readZip(bytes: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipReader {
  if (bytes.length < 22) throw new ZipError('not a ZIP file')
  const minEnd = Math.max(0, bytes.length - 65_557)
  let end = -1
  for (let i = bytes.length - 22; i >= minEnd; i--)
    if (bytes.readUInt32LE(i) === EOCD) {
      end = i
      break
    }
  if (end < 0) throw new ZipError('not a ZIP file')
  const disk = bytes.readUInt16LE(end + 4)
  const count = bytes.readUInt16LE(end + 10)
  const directorySize = bytes.readUInt32LE(end + 12)
  let offset = bytes.readUInt32LE(end + 16)
  if (disk !== 0) throw new ZipError('multi-disk ZIP files are not supported')
  if (count === 0xffff || offset === 0xffffffff || directorySize === 0xffffffff)
    throw new ZipError('ZIP64 files are not supported')
  if (count > limits.maxEntries) throw new ZipError(`too many ZIP entries (${count})`)
  if (offset + directorySize > end) throw new ZipError('bad ZIP central directory')
  const entries: ZipEntry[] = []
  const byName = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== CENTRAL)
      throw new ZipError('bad ZIP central directory')
    const flags = bytes.readUInt16LE(offset + 8)
    const method = bytes.readUInt16LE(offset + 10)
    const crc = bytes.readUInt32LE(offset + 16)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const size = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const localOffset = bytes.readUInt32LE(offset + 42)
    if (offset + 46 + nameLength > end) throw new ZipError('bad ZIP central directory')
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (name.includes('\0')) throw new ZipError('bad ZIP entry name')
    if (byName.has(name)) throw new ZipError(`duplicate ZIP entry ${name}`)
    const entry = { name, method, flags, compressedSize, size, crc, localOffset }
    entries.push(entry)
    byName.set(name, entry)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return {
    entries,
    read(name) {
      const entry = byName.get(name)
      return entry ? extract(bytes, entry, limits) : null
    }
  }
}

function extract(bytes: Buffer, entry: ZipEntry, limits: ZipLimits): Buffer {
  if (entry.flags & 1) throw new ZipError(`encrypted ZIP entry ${entry.name}`)
  if (entry.size > limits.maxEntrySize) throw new ZipError(`ZIP entry ${entry.name} is too large`)
  if (entry.size > RATIO_FLOOR && entry.size > entry.compressedSize * limits.maxRatio)
    throw new ZipError(`ZIP entry ${entry.name} is compressed suspiciously well`)
  const local = entry.localOffset
  if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== LOCAL)
    throw new ZipError(`bad ZIP entry ${entry.name}`)
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
  if (start + entry.compressedSize > bytes.length)
    throw new ZipError(`truncated ZIP entry ${entry.name}`)
  const data = bytes.subarray(start, start + entry.compressedSize)
  let out: Buffer
  if (entry.method === 0) out = Buffer.from(data)
  else if (entry.method === 8) {
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) })
    } catch (error) {
      throw new ZipError(
        `cannot inflate ${entry.name}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  } else throw new ZipError(`unsupported ZIP compression ${entry.method} for ${entry.name}`)
  if (out.length !== entry.size) throw new ZipError(`ZIP entry ${entry.name} has the wrong size`)
  if (crc32(out) >>> 0 !== entry.crc >>> 0)
    throw new ZipError(`ZIP entry ${entry.name} has a bad CRC`)
  return out
}
