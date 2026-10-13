import { mkdtemp, readdir, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pruneCache, readStepWithCache, storeMeshCache } from './meshCache'

const model = {
  root: { name: 'bot', kind: 'part', meshIndex: 0, children: [] },
  meshes: [
    {
      name: 'm',
      positions: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      normals: null,
      indices: new Uint32Array([0, 1, 2]),
      colors: null,
      color: [0.5, 0.5, 0.5]
    }
  ]
}

describe('메시 캐시', () => {
  let dir: string
  let step: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-cache-'))
    step = join(dir, 'robot.step')
    await writeFile(step, 'ISO-10303-21; robot')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('처음에는 파일 내용을, 저장한 뒤에는 변환 결과를 돌려준다', async () => {
    const cache = join(dir, 'cache')
    const first = await readStepWithCache(cache, step, 'model-v1')
    expect(first?.model).toBeNull()
    expect(new TextDecoder().decode(first!.bytes!)).toBe('ISO-10303-21; robot')

    await storeMeshCache(cache, first!.key, model)
    const second = await readStepWithCache(cache, step, 'model-v1')
    expect(second?.key).toBe(first!.key)
    expect(second?.bytes).toBeNull()
    expect(second?.model).toEqual(model)
    const mesh = (second!.model as typeof model).meshes[0]
    expect(mesh.positions).toBeInstanceOf(Float32Array)
    expect(mesh.indices).toBeInstanceOf(Uint32Array)
  })

  it('내용·형식 태그가 바뀌면 다른 키다', async () => {
    const cache = join(dir, 'cache')
    const first = await readStepWithCache(cache, step, 'model-v1')
    await storeMeshCache(cache, first!.key, model)
    expect((await readStepWithCache(cache, step, 'model-v2'))?.model).toBeNull()
    await writeFile(step, 'ISO-10303-21; robot changed')
    expect((await readStepWithCache(cache, step, 'model-v1'))?.model).toBeNull()
  })

  it('없는 파일은 null, STEP이 아닌 경로·잘못된 키는 거부한다', async () => {
    const cache = join(dir, 'cache')
    expect(await readStepWithCache(cache, join(dir, 'none.step'), 'model-v1')).toBeNull()
    await expect(readStepWithCache(cache, join(dir, 'secret.txt'), 'model-v1')).rejects.toThrow()
    await expect(storeMeshCache(cache, '../evil', model)).rejects.toThrow()
  })

  it('깨진 캐시는 지우고 다시 변환하게 한다', async () => {
    const cache = join(dir, 'cache')
    const first = await readStepWithCache(cache, step, 'model-v1')
    await storeMeshCache(cache, first!.key, model)
    await writeFile(join(cache, `${first!.key}.bin`), 'garbage')
    const read = await readStepWithCache(cache, step, 'model-v1')
    expect(read?.model).toBeNull()
    expect(read?.bytes).not.toBeNull()
    expect(await readdir(cache)).toEqual([])
  })

  it('용량을 넘으면 오래 쓰지 않은 캐시부터 지운다', async () => {
    const cache = join(dir, 'cache')
    await storeMeshCache(cache, 'a'.repeat(64), model)
    await storeMeshCache(cache, 'b'.repeat(64), model)
    const old = new Date(Date.now() - 60_000)
    await utimes(join(cache, `${'a'.repeat(64)}.bin`), old, old)
    await pruneCache(cache, 1)
    expect(await readdir(cache)).toEqual([`${'b'.repeat(64)}.bin`])
  })
})
