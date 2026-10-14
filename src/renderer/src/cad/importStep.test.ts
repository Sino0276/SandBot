import i18n from 'i18next'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import converterVersion from '../../../../native/step-converter/version.json'
import ko from '../i18n/locales/ko'
import {
  cadStructureChanged,
  formatFileSize,
  importErrorNotice,
  largeImportMessage,
  reloadIndexing,
  StepImportError
} from './importStep'
import type { ImportedModel } from './stepImport'

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
