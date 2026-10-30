import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryCache, sha256Hex, writeAtomic } from './cache'
import { tempDir } from './testkit'

// Windows의 rename(MoveFileExW)은 백신·색인기가 막 쓴 파일을 잡고 있으면 EPERM·EACCES·EBUSY로 실패한다. 그 실패를
// 흉내 낸다(before: 실패하기 전에 할 일, 예: 다른 창이 같은 파일을 먼저 써 둠).
type RenameFailure = { code: string; count: number; before?: (to: string) => Promise<void> }
const renameFailures: RenameFailure[] = []
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      const failure = renameFailures[0]
      if (failure && failure.count > 0) {
        if (--failure.count === 0) renameFailures.shift()
        await failure.before?.(to)
        throw Object.assign(new Error(`${failure.code}: rename '${from}' -> '${to}'`), {
          code: failure.code
        })
      }
      return actual.rename(from, to)
    }
  }
})

let dir: string

beforeEach(async () => {
  dir = await tempDir()
  renameFailures.length = 0
})

afterEach(async () => {
  renameFailures.length = 0
  await rm(dir, { recursive: true, force: true })
})

describe('라이브러리 캐시 쓰기', () => {
  it('rename이 EPERM·EACCES·EBUSY로 실패하면 잠시 뒤 다시 한다(임시 파일을 남기지 않는다)', async () => {
    renameFailures.push({ code: 'EPERM', count: 1 }, { code: 'EBUSY', count: 2 })
    const target = join(dir, 'x.json')
    await writeAtomic(target, '{"a":1}')
    expect(await readFile(target, 'utf8')).toBe('{"a":1}')
    expect(renameFailures).toEqual([])
    expect(await readdir(dir)).toEqual(['x.json'])
  })

  it('다른 오류나 끝내 풀리지 않는 잠김은 던지고, 있던 파일은 그대로 둔다(임시 파일은 지운다)', async () => {
    renameFailures.push({ code: 'ENOSPC', count: 1 })
    await expect(writeAtomic(join(dir, 'a.json'), 'x')).rejects.toMatchObject({ code: 'ENOSPC' })
    await writeFile(join(dir, 'b.json'), 'old')
    renameFailures.push({ code: 'EPERM', count: 100 })
    await expect(writeAtomic(join(dir, 'b.json'), 'new')).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readdir(dir)).toEqual(['b.json'])
    expect(await readFile(join(dir, 'b.json'), 'utf8')).toBe('old')
  })

  it('내용 주소 blob: 바꿔치기가 막혀도 다른 창이 같은 내용을 먼저 써 두었으면 그것을 쓴다', async () => {
    const cache = new LibraryCache(dir)
    const bytes = Buffer.from('jar bytes')
    const path = cache.blobPath(sha256Hex(bytes), 'jar')
    // 다른 창이 같은 blob을 먼저 바꿔 넣었고, 그 파일이 열려 있어 바꿀 수 없다
    renameFailures.push({ code: 'EPERM', count: 100, before: (to) => writeFile(to, bytes) })
    expect((await cache.storeBlob(bytes, 'jar')).path).toBe(path)
    expect(await readdir(join(dir, 'blobs'))).toEqual([basename(path)])
    // 같은 이름에 다른 내용(깨진 파일)이면 받아들이지 않는다
    renameFailures.length = 0
    renameFailures.push({ code: 'EPERM', count: 100, before: (to) => writeFile(to, 'broken') })
    await expect(cache.storeBlob(Buffer.from('other bytes'), 'jar')).rejects.toMatchObject({
      code: 'EPERM'
    })
  })

  it('처음 받은 해시: 동시에 기록해도 모두 남고, 다른 해시로 덮지 않는다', async () => {
    const cache = new LibraryCache(dir)
    const keys = Array.from({ length: 24 }, (_, i) => `com.acmerobotics.roadrunner:core:1.0.${i}/f`)
    const hashes = keys.map((key) => sha256Hex(key))
    expect(await Promise.all(keys.map((key, i) => cache.recordFirstUse(key, hashes[i])))).toEqual(
      keys.map(() => null)
    )
    for (const [i, key] of keys.entries()) expect(await cache.firstUse(key)).toBe(hashes[i])
    // 같은 해시는 그대로, 다른 해시는 기록한 것을 돌려준다(덮지 않는다)
    expect(await cache.recordFirstUse(keys[0], hashes[0])).toBeNull()
    expect(await cache.recordFirstUse(keys[0], hashes[1])).toBe(hashes[0])
    expect(await cache.firstUse(keys[0])).toBe(hashes[0])
    const file = JSON.parse(await readFile(join(dir, 'first-use.json'), 'utf8'))
    expect(Object.keys(file).sort()).toEqual([...keys].sort())
  })

  it('처음 받은 해시 기록을 읽지 못하면 기록이 없는 것으로 보지 않는다(깨진 파일은 처음부터)', async () => {
    const cache = new LibraryCache(dir)
    // 읽기 오류(EISDIR): 기록이 있는지 모른다
    await mkdir(join(dir, 'first-use.json'))
    await expect(cache.firstUse('g:a:1/a-1.jar')).rejects.toThrow()
    await rm(join(dir, 'first-use.json'), { recursive: true })
    await writeFile(join(dir, 'first-use.json'), '{not json')
    expect(await cache.firstUse('g:a:1/a-1.jar')).toBeNull()
  })
})
