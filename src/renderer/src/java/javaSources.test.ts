import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadJavaFileResult } from '../../../shared/ipc'
import type { TunableFile } from '../../../shared/java/tunableTypes'
import { useProjectStore } from '../project/projectStore'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import {
  currentJavaSource,
  ensureJavaSources,
  linkedJavaPaths,
  putJavaSource,
  refreshJavaSources,
  sourceFromRead,
  useJavaSourcesStore
} from './javaSources'

// 파서는 내용마다 새 결과를 만든다(몇 번 불렸는지 센다)
const parseTunables = vi.hoisted(() =>
  vi.fn((text: string): TunableFile => ({
    blocks: [],
    unicodeEscapes: false,
    staticFieldsWithoutConfig: text.includes('static')
  }))
)
vi.mock('../../../shared/java/tunables', () => ({ parseTunables }))

const A = 'src/main/java/a/A.java'
const B = 'src/main/java/a/B.java'

const linked = (...paths: string[]): SceneObjects => ({
  r: {
    id: 'r',
    name: 'r',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    scripts: paths.map((path) => ({ path, className: 'a.X' }))
  },
  g: {
    id: 'g',
    name: 'g',
    kind: 'group',
    parentId: 'r',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    scripts: paths.slice(0, 1).map((path) => ({ path, className: 'a.X' }))
  }
})

const ok = (text: string): Extract<ReadJavaFileResult, { ok: true }> => ({
  ok: true,
  text,
  hash: `#${text}`,
  editable: true
})

let resolvers: Map<string, ((result: ReadJavaFileResult) => void)[]>
const readJavaFile = vi.fn(
  (_root: string, path: string) =>
    new Promise<ReadJavaFileResult>((resolve) => {
      const list = resolvers.get(path) ?? []
      list.push(resolve)
      resolvers.set(path, list)
    })
)
const resolveRead = (path: string, result: ReadJavaFileResult, index = 0): void =>
  resolvers.get(path)![index](result)
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const files = (): Record<string, unknown> => useJavaSourcesStore.getState().files

describe('연결한 Java 파일 내용', () => {
  beforeEach(() => {
    resolvers = new Map()
    readJavaFile.mockClear()
    parseTunables.mockClear()
    vi.stubGlobal('window', { api: { readJavaFile } })
    useProjectStore.setState({ root: '/p', session: 1, busy: false })
    useJavaSourcesStore.setState(useJavaSourcesStore.getInitialState())
    useSceneStore.getState().replaceObjects(linked(A, B))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
  })

  it('연결한 경로는 겹치지 않게 경로 순서로 모은다', () => {
    const objects = linked(B, A)
    expect(linkedJavaPaths(objects)).toEqual([A, B])
    expect(linkedJavaPaths(objects)).toBe(linkedJavaPaths(objects))
  })

  it('다시 읽기: 연결한 파일을 모두 읽고, 내용 해시가 같으면 이전 결과를 그대로 쓴다', async () => {
    const done = refreshJavaSources()
    expect(readJavaFile.mock.calls.map((call) => call[1])).toEqual([A, B])
    resolveRead(A, ok('static a'))
    resolveRead(B, { ok: false, code: 'missing', detail: '' })
    await done
    const first = files()[A]
    expect(first).toMatchObject({ status: 'ready', hash: '#static a', editable: true })
    expect(files()[B]).toEqual({ status: 'missing' })
    expect(parseTunables).toHaveBeenCalledTimes(1)

    const again = refreshJavaSources()
    resolveRead(A, ok('static a'), 1)
    resolveRead(B, ok('b'), 1)
    await again
    expect(files()[A]).toBe(first)
    expect(files()[B]).toMatchObject({ status: 'ready' })
    expect(parseTunables).toHaveBeenCalledTimes(2)
  })

  it('연결이 없어진 파일은 캐시에서 빼고, 새로 연결한 파일만 읽는다', async () => {
    const done = refreshJavaSources()
    resolveRead(A, ok('a'))
    resolveRead(B, ok('b'))
    await done
    useSceneStore.getState().replaceObjects(linked(A))
    const second = refreshJavaSources()
    expect(Object.keys(files())).toEqual([A])
    resolveRead(A, ok('a'), 1)
    await second
    readJavaFile.mockClear()
    useSceneStore.getState().replaceObjects(linked(A, B))
    ensureJavaSources()
    // 이미 읽는 중인 파일은 또 읽지 않는다
    ensureJavaSources()
    expect(readJavaFile.mock.calls.map((call) => call[1])).toEqual([B])
    resolveRead(B, ok('b2'), 1)
    await settle()
    expect(files()[B]).toMatchObject({ status: 'ready', hash: '#b2' })
  })

  it('읽는 사이 다른 프로젝트를 열었으면 결과를 버린다', async () => {
    const done = refreshJavaSources()
    useProjectStore.setState({ root: '/q', session: 2 })
    resolveRead(A, ok('old'))
    resolveRead(B, ok('old'))
    await done
    expect(files()).toEqual({})
    // 화면은 다른 프로젝트의 캐시를 쓰지 않는다
    const state = { root: '/p', session: 1, files: { [A]: { status: 'missing' as const } } }
    expect(currentJavaSource(state, { root: '/q', session: 2 }, A)).toBeUndefined()
    expect(currentJavaSource(state, { root: '/p', session: 1 }, A)).toEqual({ status: 'missing' })
  })

  it('늦게 끝난 이전 읽기는 저장이 넣은 새 내용을 덮지 않는다', async () => {
    void refreshJavaSources()
    putJavaSource('/p', 1, A, ok('written'))
    resolveRead(A, ok('stale'))
    await settle()
    expect(files()[A]).toMatchObject({ hash: '#written' })
  })

  it('열기·저장 중(busy)이나 프로젝트가 없으면 새 연결을 읽지 않는다', () => {
    useProjectStore.setState({ busy: true })
    ensureJavaSources()
    useProjectStore.setState({ busy: false, root: null })
    ensureJavaSources()
    expect(readJavaFile).not.toHaveBeenCalled()
  })

  it('읽기 결과 → 항목: 실패·파싱 오류는 failed', () => {
    expect(sourceFromRead({ ok: false, code: 'notAllowed', detail: '' })).toEqual({
      status: 'failed',
      detail: 'notAllowed'
    })
    parseTunables.mockImplementationOnce(() => {
      throw new Error('bug')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(sourceFromRead(ok('x'))).toEqual({ status: 'failed', detail: 'bug' })
    error.mockRestore()
    const readOnly = sourceFromRead({ ...ok('x'), editable: false, reason: 'generated' })
    expect(readOnly).toMatchObject({ status: 'ready', editable: false, reason: 'generated' })
    // 쓰기 가능 여부가 바뀌면 같은 해시여도 새 항목이다
    expect(sourceFromRead(ok('x'), readOnly)).toMatchObject({ editable: true })
  })
})
