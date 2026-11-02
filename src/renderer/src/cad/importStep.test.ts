import i18n from 'i18next'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import type { OcctResult } from 'occt-import-js'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import converterVersion from '../../../../native/step-converter/version.json'
import ko from '../i18n/locales/ko'
import {
  cadMassSummary,
  disposeAllGeometry,
  getGeometry,
  meshMassProps,
  meshSourceName
} from '../scene/geometryRegistry'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import {
  cadStructureChanged,
  formatFileSize,
  importErrorNotice,
  largeImportMessage,
  loadCadGeometry,
  registerModelGeometries,
  reloadIndexing,
  StepImportError
} from './importStep'
import { convertOcctResult, type ImportedModel } from './stepImport'

// 빈 메시 하나가 빠진 모델(occt-import-js 메시 4개 중 3개만 삼각형이 있음)
const model = {
  root: { name: 'bot', kind: 'assembly', bounds: { min: [0, 0, 0], max: [1, 1, 1] }, children: [] },
  meshes: [0, 1, 3].map((sourceIndex) => ({ sourceIndex })),
  sourceMeshCount: 4
} as unknown as ImportedModel

describe('다시 읽은 CAD의 형상 id 방식', () => {
  it('새 프로젝트는 원래 순번, 예전 프로젝트는 빠진 메시가 없었을 때만 원래 순번', () => {
    expect(reloadIndexing({ meshCount: 4, meshIndexing: 'source' }, model)).toBe('source')
    // 예전에 저장한 메시 수가 지금 전체 수와 같다 = 그때 빠진 메시가 없었다 = 두 순번이 같다
    expect(reloadIndexing({ meshCount: 4 }, model)).toBe('source')
    expect(reloadIndexing({ meshCount: 3 }, model)).toBe('packed')
  })

  it('파일 구조가 바뀌었는지는 방식에 맞는 메시 수로 본다(빠진 메시는 구조 변화가 아니다)', () => {
    expect(cadStructureChanged({ meshCount: 4, meshIndexing: 'source' }, model, 'source')).toBe(
      false
    )
    expect(cadStructureChanged({ meshCount: 5, meshIndexing: 'source' }, model, 'source')).toBe(
      true
    )
    expect(cadStructureChanged({ meshCount: 3 }, model, 'packed')).toBe(false)
  })
})

describe('불러오기 실패 알림', () => {
  it('취소는 알리지 않고, WASM의 메모리 실패는 파일이 너무 크다고 알린다', () => {
    const error = (code: StepImportError['code'], engine: 'native' | 'wasm'): StepImportError =>
      new StepImportError(code, '', engine)
    expect(importErrorNotice(error('cancelled', 'native'))).toBeNull()
    expect(importErrorNotice(error('readFailed', 'wasm'))).toBe('importReadFailed')
    expect(importErrorNotice(error('empty', 'native'))).toBe('importEmpty')
    expect(importErrorNotice(error('meshFailed', 'wasm'))).toBe('importTooLarge')
    expect(importErrorNotice(error('meshFailed', 'native'))).toBe('importMeshFailed')
    expect(importErrorNotice(error('outOfMemory', 'wasm'))).toBe('importTooLarge')
    expect(importErrorNotice(error('outOfMemory', 'native'))).toBe('importOutOfMemory')
    expect(importErrorNotice(error('unknown', 'native'))).toBe('importFailed')
    expect(importErrorNotice(new Error('EACCES'))).toBe('importFailed')
  })
})

describe('큰 파일 확인 문구', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'ko', resources: { ko: { translation: ko } }, initAsync: false })
  })

  it('파일 수와 변환기에 따라 문구를 고른다', () => {
    const big = { name: 'robot.step', size: 420_517_835 }
    expect(formatFileSize(big.size)).toBe('421 MB')
    expect(largeImportMessage([big], true)).toContain('robot.step')
    expect(largeImportMessage([big], true)).not.toContain('내장 변환기')
    expect(largeImportMessage([big], false)).toContain('내장 변환기')
    const many = largeImportMessage([big, { name: 'arm.step', size: 150_000_000 }], true)
    expect(many).toContain('2개')
    expect(many).toContain('571 MB')
  })
})

describe('네이티브 변환기 버전', () => {
  it('version.json의 occt-import-js 버전이 렌더러가 쓰는 패키지와 같다(메시 순서·형상 id 호환)', () => {
    const require = createRequire(import.meta.url)
    const pkg = JSON.parse(
      readFileSync(join(require.resolve('occt-import-js'), '..', '..', 'package.json'), 'utf8')
    )
    expect(pkg.version).toBe(converterVersion.occtImportJs.tag)
  })
})

// 닫힌 정육면체(변 0.1 m) 메시 하나와 이름 없는 메시 둘을 가진 어셈블리
function cube(name: string, offset: number): OcctResult['meshes'][number] {
  const p = (x: number, y: number, z: number): number[] => [offset + x * 0.1, y * 0.1, z * 0.1]
  const quads = [
    [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)],
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)],
    [p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)],
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)],
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]
  ]
  return {
    name,
    brep_faces: [{ first: 0, last: 11, color: null }],
    attributes: { position: { array: quads.flat(2) } },
    index: {
      array: quads.flatMap((_, q) => [0, 1, 2, 0, 2, 3].map((corner) => q * 4 + corner))
    }
  }
}

const cubes = convertOcctResult(
  {
    success: true,
    root: {
      name: '',
      meshes: [],
      children: [
        {
          name: 'bot',
          meshes: [],
          children: [
            { name: '1120-0001-0048', meshes: [0], children: [] },
            { name: 'motor', meshes: [1, 2], children: [] }
          ]
        }
      ]
    },
    meshes: [cube('', 0), cube('', 0.2), cube('Gearbox', 0.4)]
  },
  'bot.step'
)!

describe('형상 등록과 질량 성질', () => {
  // CAD 루트 'cad'와 형상 cad:0..2를 쓰는 파트 셋
  const scene: SceneObjects = {
    cad: {
      id: 'cad',
      name: 'bot',
      kind: 'assembly',
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      cad: {
        fileName: 'bot.step',
        absolutePath: '/cad/bot.step',
        upAxis: '+Z',
        forwardAxis: '-Y',
        bounds: cubes.root.bounds,
        meshCount: 3,
        meshIndexing: 'source'
      }
    }
  }
  for (const i of [0, 1, 2]) {
    scene[`part-${i}`] = {
      id: `part-${i}`,
      name: `part-${i}`,
      kind: 'part',
      parentId: 'cad',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      visual: { type: 'mesh', geometryId: `cad:${i}`, color: [0.5, 0.5, 0.5] }
    }
  }

  afterEach(() => {
    disposeAllGeometry()
    vi.unstubAllGlobals()
  })

  it('형상과 같은 id로 질량 성질과 원래 CAD 이름을 둔다', () => {
    registerModelGeometries('cad', cubes, 'source')
    expect(getGeometry('cad:0')).toBeDefined()
    expect(meshMassProps('cad:0')?.volume).toBeCloseTo(1e-3, 15)
    expect(meshMassProps('cad:2')).toBe(cubes.meshes[2].mass)
    expect([0, 1, 2].map((i) => meshSourceName(`cad:${i}`))).toEqual([
      '1120-0001-0048',
      '',
      'Gearbox'
    ])
    expect(cadMassSummary('cad', scene)).toMatchObject({
      meshes: 3,
      openMeshes: 0,
      pendingMeshes: 0
    })
  })

  it('CAD를 읽는 동안 질량 요약이 그 CAD의 메시를 읽는 중으로 세고, 끝나면 형상 revision을 올린다', async () => {
    useSceneStore.setState({ objects: scene })
    let finish: (result: unknown) => void = () => {}
    const readStepCached = vi.fn(() => new Promise((resolve) => (finish = resolve)))
    vi.stubGlobal('window', {
      api: { hasStepConverter: () => Promise.resolve(false), readStepCached }
    })
    const revision = (): number => useSceneStore.getState().geometryRevision

    const before = revision()
    const loading = loadCadGeometry('cad', '/cad/bot.step')
    expect(revision()).toBe(before + 1)
    expect(cadMassSummary('cad')?.pendingMeshes).toBe(3)
    await vi.waitFor(() => expect(readStepCached).toHaveBeenCalled())
    finish({ key: 'k', model: cubes, bytes: null, size: 1 })
    expect(await loading).toBe('loaded')
    expect(cadMassSummary('cad')).toMatchObject({ meshes: 3, pendingMeshes: 0 })
    // 읽기 끝 + 등록
    expect(revision()).toBe(before + 3)

    // 파일이 없으면 등록하지 않고 끝나도 요약이 바뀌었으므로 다시 계산하게 한다
    disposeAllGeometry()
    const missing = loadCadGeometry('cad', '/cad/bot.step')
    expect(cadMassSummary('cad')?.pendingMeshes).toBe(3)
    await vi.waitFor(() => expect(readStepCached).toHaveBeenCalledTimes(2))
    const beforeEnd = revision()
    finish(null)
    expect(await missing).toBe('missing')
    // 형상 없이 끝났다(못 찾은 상태는 projectStore.cadStatus가 알린다)
    expect(cadMassSummary('cad')).toMatchObject({ meshes: 0, pendingMeshes: 0 })
    expect(revision()).toBe(beforeEnd + 1)
  })
})
