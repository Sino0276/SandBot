import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crc32, deflateRawSync } from 'zlib'
import {
  ensurePlatformJar,
  filterPlatformJar,
  isSafeEntryName,
  KEEP_PLATFORM_JARS,
  readCentralDirectory,
  readEntry,
  resetPlatformJarMemo,
  writeZip,
  ZipError
} from './platformJar'

// 시험용 zip 쓰기(구현의 writeZip과 따로 둔다: 같은 실수가 서로를 가리지 않게). 엔트리마다 바꿀 수 있는 것:
// 압축 방식, 플래그, CRC 깨기, 지역 머리말의 이름(중앙 디렉터리와 다르게), 이름 바이트 그대로(raw).
type TestEntry = {
  name: string
  data?: Buffer | string
  method?: 0 | 8
  flags?: number
  badCrc?: boolean
  localName?: string
  rawName?: Buffer
  // 중앙 디렉터리에 적는 크기(실제와 다르게)
  declaredSize?: number
}

function makeZip(
  entries: TestEntry[],
  options: { zip64?: boolean; comment?: string } = {}
): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? 'x')
    const method = entry.method ?? 8
    const stored = method === 8 ? deflateRawSync(data) : data
    const name = entry.rawName ?? Buffer.from(entry.name, 'utf8')
    const localName = entry.localName === undefined ? name : Buffer.from(entry.localName, 'utf8')
    const crc = (crc32(data) ^ (entry.badCrc ? 1 : 0)) >>> 0
    const size = entry.declaredSize ?? data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.flags ?? 0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(localName.length, 26)
    parts.push(local, localName, stored)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(entry.flags ?? 0, 8)
    record.writeUInt16LE(method, 10)
    record.writeUInt32LE(crc, 16)
    record.writeUInt32LE(stored.length, 20)
    record.writeUInt32LE(size, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    offset += 30 + localName.length + stored.length
  }
  const cd = Buffer.concat(central)
  const comment = Buffer.from(options.comment ?? '')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(options.zip64 ? 0xffff : entries.length, 8)
  end.writeUInt16LE(options.zip64 ? 0xffff : entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(comment.length, 20)
  return Buffer.concat([...parts, cd, end, comment])
}

// android.jar 비슷한 것(고를 것과 버릴 것이 섞임)
function fakeAndroidJar(extra: TestEntry[] = []): Buffer {
  return makeZip([
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\n' },
    { name: 'android/app/Activity.class', data: 'activity' },
    { name: 'java/', data: '', method: 0 },
    { name: 'java/util/List.class', data: 'list' },
    { name: 'java/lang/Object.class', data: 'object' },
    { name: 'javax/net/SocketFactory.class', data: 'socket', method: 0 },
    { name: 'org/w3c/dom/Node.class', data: 'node' },
    { name: 'org/xml/sax/Parser.class', data: 'parser' },
    { name: 'org/json/JSONObject.class', data: 'json' },
    { name: 'android/annotation/SuppressLint.class', data: 'lint' },
    { name: 'android/annotation/NonNull.class', data: 'nonnull' },
    { name: 'java/lang/resource.properties', data: 'r=1' },
    { name: 'dalvik/system/DexFile.class', data: 'dex' },
    ...extra
  ])
}

function contents(jar: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readCentralDirectory(jar)) out[entry.name] = readEntry(jar, entry).toString()
  return out
}

describe('플랫폼 jar 고르기', () => {
  it('Java API와 android.annotation의 .class만 이름순으로 새 jar에 담는다', () => {
    const jar = filterPlatformJar(fakeAndroidJar())
    const names = readCentralDirectory(jar).map((e) => e.name)
    expect(names).toEqual([
      'android/annotation/NonNull.class',
      'android/annotation/SuppressLint.class',
      'java/lang/Object.class',
      'java/util/List.class',
      'javax/net/SocketFactory.class',
      'org/w3c/dom/Node.class',
      'org/xml/sax/Parser.class'
    ])
    expect(contents(jar)).toMatchObject({
      'java/lang/Object.class': 'object',
      'javax/net/SocketFactory.class': 'socket',
      'android/annotation/SuppressLint.class': 'lint'
    })
  })

  it('같은 android.jar면 바이트가 같다(엔트리 순서가 달라도)', () => {
    const a = filterPlatformJar(fakeAndroidJar())
    const b = filterPlatformJar(
      makeZip([
        { name: 'java/util/List.class', data: 'list' },
        { name: 'org/xml/sax/Parser.class', data: 'parser', method: 0 },
        { name: 'android/annotation/NonNull.class', data: 'nonnull' },
        { name: 'java/lang/Object.class', data: 'object' },
        { name: 'org/w3c/dom/Node.class', data: 'node' },
        { name: 'javax/net/SocketFactory.class', data: 'socket', method: 0 },
        { name: 'android/annotation/SuppressLint.class', data: 'lint' }
      ])
    )
    expect(contents(b)).toEqual(contents(a))
    expect(filterPlatformJar(fakeAndroidJar()).equals(a)).toBe(true)
  })

  it('안전하지 않거나 믿을 수 없는 이름은 고르지 않는다', () => {
    const jar = filterPlatformJar(
      fakeAndroidJar([
        { name: 'java/../evil.class', data: 'e1' },
        { name: 'java//double.class', data: 'e2' },
        { name: 'java/./dot.class', data: 'e3' },
        { name: 'java\\back.class', data: 'e4' },
        { name: 'java/c:drive.class', data: 'e5' },
        { name: 'java/ctl\u0001.class', data: 'e6' },
        // UTF-8 표시 없이 ASCII 밖 바이트(이름을 정할 수 없다)
        {
          name: '',
          rawName: Buffer.from([
            0x6a, 0x61, 0x76, 0x61, 0x2f, 0xe9, 0x2e, 0x63, 0x6c, 0x61, 0x73, 0x73
          ])
        },
        // UTF-8 표시가 있으면 받는다
        { name: 'java/é.class', data: 'utf8', flags: 0x0800 }
      ])
    )
    const names = readCentralDirectory(jar).map((e) => e.name)
    expect(names).toContain('java/é.class')
    expect(names.filter((n) => !/^(android|java|javax|org)\/[\w/$.é]+\.class$/.test(n))).toEqual([])
    expect(names.some((n) => n.includes('..') || n.includes('//') || n.includes('\\'))).toBe(false)
    expect(names).toHaveLength(8)
  })

  it('이름 검사', () => {
    expect(isSafeEntryName('java/lang/Object.class')).toBe(true)
    expect(isSafeEntryName('java/lang/Map$Entry.class')).toBe(true)
    for (const bad of [
      '',
      '/java/A.class',
      'java/../A.class',
      'a//b',
      'a/./b',
      'a\\b',
      'C:a',
      'a\0b',
      'a/'
    ])
      expect(isSafeEntryName(bad)).toBe(false)
    expect(isSafeEntryName('a/'.repeat(600))).toBe(false)
  })

  it('zip이 아니거나 ZIP64·암호화·모르는 압축이면 실패한다', () => {
    expect(() => filterPlatformJar(Buffer.from('not a zip at all, just some text'))).toThrow(
      ZipError
    )
    expect(() => filterPlatformJar(Buffer.alloc(0))).toThrow(ZipError)
    expect(() => filterPlatformJar(fakeAndroidJar().subarray(0, 100))).toThrow(ZipError)
    expect(() =>
      filterPlatformJar(makeZip([{ name: 'java/lang/Object.class' }], { zip64: true }))
    ).toThrow(/ZIP64/)
    expect(() =>
      filterPlatformJar(makeZip([{ name: 'java/lang/Object.class', flags: 0x0001 }]))
    ).toThrow(/encrypted/)
    const bzip = makeZip([{ name: 'java/lang/Object.class', method: 0 }])
    // 중앙 디렉터리의 압축 방식을 12(bzip2)로 바꾼다
    const cd = bzip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    bzip.writeUInt16LE(12, cd + 10)
    expect(() => filterPlatformJar(bzip)).toThrow(/unsupported ZIP compression 12/)
  })

  it('CRC·크기·지역 머리말 이름이 맞지 않거나 같은 이름이 둘이면 실패한다', () => {
    expect(() =>
      filterPlatformJar(fakeAndroidJar([{ name: 'java/A.class', badCrc: true }]))
    ).toThrow(/wrong CRC/)
    expect(() =>
      filterPlatformJar(fakeAndroidJar([{ name: 'java/A.class', data: 'abc', declaredSize: 2 }]))
    ).toThrow(ZipError)
    expect(() =>
      filterPlatformJar(fakeAndroidJar([{ name: 'java/A.class', localName: 'java/B.class' }]))
    ).toThrow(/name mismatch/)
    expect(() =>
      filterPlatformJar(fakeAndroidJar([{ name: 'java/util/List.class', data: 'other' }]))
    ).toThrow(/duplicate ZIP entry java\/util\/List.class/)
    // 고르지 않는 엔트리의 CRC는 보지 않는다(풀지 않는다)
    expect(() =>
      filterPlatformJar(fakeAndroidJar([{ name: 'android/view/View.class', badCrc: true }]))
    ).not.toThrow()
  })

  it('java/lang/Object가 없으면 플랫폼 jar가 아니다', () => {
    expect(() => filterPlatformJar(makeZip([{ name: 'java/util/List.class' }]))).toThrow(
      /not an Android platform jar/
    )
  })

  it('지나치게 압축된 엔트리(압축 폭탄)는 풀지 않는다', () => {
    const zeros = Buffer.alloc(4 * 1024 * 1024)
    expect(() =>
      filterPlatformJar(fakeAndroidJar([{ name: 'java/Bomb.class', data: zeros }]))
    ).toThrow(/compressed too much/)
    // 적힌 크기보다 크게 풀리면 멈춘다
    expect(() =>
      filterPlatformJar(
        fakeAndroidJar([
          { name: 'java/Grow.class', data: Buffer.alloc(5000, 7), declaredSize: 100 }
        ])
      )
    ).toThrow(ZipError)
  })

  it('끝에 주석이 있어도 읽고, writeZip 결과는 다시 읽힌다', () => {
    const zip = makeZip([{ name: 'java/lang/Object.class', data: 'o' }], { comment: 'hello' })
    expect(readCentralDirectory(zip).map((e) => e.name)).toEqual(['java/lang/Object.class'])
    const data = Buffer.from('payload')
    const written = writeZip([
      { name: 'a/b.class', size: data.length, crc: crc32(data), method: 0, data },
      {
        name: 'a/é.class',
        size: data.length,
        crc: crc32(data),
        method: 8,
        data: deflateRawSync(data)
      }
    ])
    expect(contents(written)).toEqual({ 'a/b.class': 'payload', 'a/é.class': 'payload' })
  })
})

describe('플랫폼 jar 캐시', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-platform-'))
    resetPlatformJarMemo()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('cacheDir/<android.jar의 SHA-256>.jar를 만들고, 있으면 다시 만들지 않는다', async () => {
    const androidJar = join(dir, 'android.jar')
    const cache = join(dir, 'cache')
    await writeFile(androidJar, fakeAndroidJar())
    const first = await ensurePlatformJar(androidJar, cache)
    expect(first).toMatch(/[\\/]cache[\\/][0-9a-f]{64}\.jar$/)
    expect(Object.keys(contents(await readFile(first)))).toContain('java/util/List.class')
    // 다시 부르면 같은 파일(내용을 바꿔 두면 그대로 남는다 = 다시 쓰지 않았다)
    await writeFile(first, 'marker')
    expect(await ensurePlatformJar(androidJar, cache)).toBe(first)
    expect(await readFile(first, 'utf8')).toBe('marker')
    resetPlatformJarMemo()
    expect(await ensurePlatformJar(androidJar, cache)).toBe(first)
    expect((await readdir(cache)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('android.jar가 바뀌면 다른 jar를 만든다', async () => {
    const androidJar = join(dir, 'android.jar')
    const cache = join(dir, 'cache')
    await writeFile(androidJar, fakeAndroidJar())
    const first = await ensurePlatformJar(androidJar, cache)
    await writeFile(androidJar, fakeAndroidJar([{ name: 'java/util/Set.class', data: 'set' }]))
    const second = await ensurePlatformJar(androidJar, cache)
    expect(second).not.toBe(first)
    expect(Object.keys(contents(await readFile(second)))).toContain('java/util/Set.class')
  })

  it('동시에 불러도 한 번만 만든다', async () => {
    const androidJar = join(dir, 'android.jar')
    await writeFile(androidJar, fakeAndroidJar())
    const results = await Promise.all([1, 2, 3].map(() => ensurePlatformJar(androidJar, dir)))
    expect(new Set(results).size).toBe(1)
  })

  it('오래 쓰지 않은 jar와 남은 임시 파일을 지운다', async () => {
    const cache = join(dir, 'cache')
    const old = new Date(Date.now() - 2 * 3600 * 1000)
    const names: string[] = []
    await mkdir(cache, { recursive: true })
    for (let i = 0; i < KEEP_PLATFORM_JARS + 2; i++) {
      const name = `${String(i).padStart(64, '0')}.jar`
      names.push(name)
      await writeFile(join(cache, name), 'x')
      const time = new Date(Date.now() - (i + 10) * 60_000)
      await utimes(join(cache, name), time, time)
    }
    await writeFile(join(cache, 'stale.jar.1.tmp'), 'x')
    await utimes(join(cache, 'stale.jar.1.tmp'), old, old)
    await writeFile(join(cache, 'fresh.jar.2.tmp'), 'x')
    await writeFile(join(cache, 'notes.txt'), 'kept')
    const androidJar = join(dir, 'android.jar')
    await writeFile(androidJar, fakeAndroidJar())
    const made = await ensurePlatformJar(androidJar, cache)
    const left = (await readdir(cache)).sort()
    const jars = left.filter((n) => n.endsWith('.jar'))
    expect(jars).toHaveLength(KEEP_PLATFORM_JARS)
    expect(jars).toContain(made.slice(cache.length + 1))
    // 가장 최근 것들이 남는다
    expect(jars).toContain(names[0])
    expect(jars).not.toContain(names[names.length - 1])
    expect(left).not.toContain('stale.jar.1.tmp')
    expect(left).toContain('fresh.jar.2.tmp')
    expect(left).toContain('notes.txt')
  })

  it('파일이 아니거나 zip이 아니면 실패한다', async () => {
    await expect(ensurePlatformJar(join(dir, 'missing.jar'), dir)).rejects.toThrow()
    await expect(ensurePlatformJar(dir, join(dir, 'cache'))).rejects.toThrow(ZipError)
    const broken = join(dir, 'android.jar')
    await writeFile(broken, 'not a zip')
    await expect(ensurePlatformJar(broken, join(dir, 'cache'))).rejects.toThrow(ZipError)
    expect(await stat(join(dir, 'cache')).catch(() => null)).toBeNull()
  })
})
