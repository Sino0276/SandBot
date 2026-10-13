import { createHash } from 'crypto'
import { app, ipcMain } from 'electron'
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { deserialize, serialize } from 'v8'
import { IPC, type StepReadResult } from '../shared/ipc'

// STEP 변환 결과(메시·계층) 캐시. 큰 CAD를 프로젝트를 열 때마다 다시 변환하지 않도록 앱 데이터 폴더에 둔다
// (개인 PC 캐시라 프로젝트 폴더·git에는 들어가지 않는다). 키는 STEP 내용·파일 이름·변환 형식 태그의 해시라서
// 파일 내용이 바뀌면 저절로 다시 변환한다.

const CACHE_DIR = 'mesh-cache'
// 이 크기를 넘으면 오래 쓰지 않은 캐시부터 지운다
export const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024
const KEY_PATTERN = /^[0-9a-f]{64}$/
const TAG_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

export function isStepPath(path: string): boolean {
  return /\.(step|stp)$/i.test(path)
}

function cacheFile(dir: string, key: string): string {
  return join(dir, `${key}.bin`)
}

export function cacheKey(bytes: Uint8Array, fileName: string, tag: string): string {
  return createHash('sha256')
    .update(tag)
    .update('\0')
    .update(fileName)
    .update('\0')
    .update(bytes)
    .digest('hex')
}

// STEP을 읽고 캐시를 찾는다. 파일이 없으면 null. 캐시가 있으면 변환 결과를, 없으면 파일 내용을 돌려준다.
export async function readStepWithCache(
  dir: string,
  path: string,
  tag: string
): Promise<StepReadResult | null> {
  if (!isStepPath(path)) throw new Error(`not a STEP file: ${path}`)
  if (!TAG_PATTERN.test(tag)) throw new Error(`invalid cache tag: ${tag}`)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const key = cacheKey(bytes, basename(path), tag)
  const file = cacheFile(dir, key)
  try {
    const model = ownBuffers(deserialize(await readFile(file)))
    // 최근에 쓴 캐시로 표시한다(용량을 넘으면 오래된 것부터 지운다)
    const now = new Date()
    await utimes(file, now, now).catch(() => undefined)
    return { key, model, bytes: null }
  } catch (error) {
    // 없거나 깨진 캐시는 다시 변환한다
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      await unlink(file).catch(() => undefined)
    return {
      key,
      model: null,
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    }
  }
}

// v8.deserialize는 타입 배열을 캐시 파일 전체 버퍼를 가리키는 뷰로 돌려준다. 그대로 렌더러로 보내면
// contextBridge가 배열마다 그 전체 버퍼를 복사하므로(메시 수 × 파일 크기), 배열마다 제 크기 버퍼로 복사한다.
function ownBuffers(value: unknown, depth = 0): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const view = value as unknown as {
      slice: () => unknown
      byteLength: number
      buffer: ArrayBufferLike
    }
    return view.byteLength === view.buffer.byteLength ? value : view.slice()
  }
  if (depth > 64 || !value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => ownBuffers(item, depth + 1))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, ownBuffers(item, depth + 1)])
  )
}

export async function storeMeshCache(
  dir: string,
  key: string,
  model: unknown,
  maxBytes = MAX_CACHE_BYTES
): Promise<void> {
  if (!KEY_PATTERN.test(key)) throw new Error(`invalid cache key: ${key}`)
  await mkdir(dir, { recursive: true })
  const target = cacheFile(dir, key)
  const temp = `${target}.${process.pid}.tmp`
  try {
    await writeFile(temp, serialize(model))
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
  await pruneCache(dir, maxBytes)
}

// 쓰다 멈춘 임시 파일(앱이 쓰는 도중 꺼진 경우)은 이 시간이 지나면 지운다
const STALE_TEMP_MS = 10 * 60 * 1000

// 용량을 넘으면 가장 오래 쓰지 않은 캐시부터 지운다(가장 최근 하나는 남긴다)
export async function pruneCache(dir: string, maxBytes: number): Promise<void> {
  const names = await readdir(dir)
  const now = Date.now()
  for (const name of names.filter((n) => n.endsWith('.tmp'))) {
    const info = await stat(join(dir, name)).catch(() => null)
    if (info && now - info.mtimeMs > STALE_TEMP_MS)
      await unlink(join(dir, name)).catch(() => undefined)
  }
  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith('.bin'))
      .map(async (name) => {
        const info = await stat(join(dir, name)).catch(() => null)
        return info ? { name, size: info.size, time: info.mtimeMs } : null
      })
  )
  let total = 0
  let kept = 0
  for (const entry of entries
    .filter((e): e is { name: string; size: number; time: number } => e !== null)
    .sort((a, b) => b.time - a.time)) {
    total += entry.size
    // 방금 쓴 가장 최근 캐시는 용량과 관계없이 남긴다
    if (total > maxBytes && kept > 0) await unlink(join(dir, entry.name)).catch(() => undefined)
    else kept++
  }
}

export function registerMeshCacheIpc(): void {
  const dir = join(app.getPath('userData'), CACHE_DIR)
  ipcMain.handle(IPC.readStepCached, (_event, path: string, tag: string) =>
    readStepWithCache(dir, path, tag)
  )
  ipcMain.handle(IPC.storeMeshCache, (_event, key: string, model: unknown) =>
    storeMeshCache(dir, key, model)
  )
}
