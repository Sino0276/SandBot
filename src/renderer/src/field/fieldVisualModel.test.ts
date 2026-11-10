import { readFileSync } from 'fs'
import { createRequire } from 'module'
import type { Occt } from 'occt-import-js'
import { Vector3 } from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { alignmentRotation, ALIGNMENT_PRESETS, boundsCenter } from '../cad/alignment'
import { computeMeshMass } from '../cad/meshMass'
import { convertOcctResult, type ImportedMesh, type ImportedModel } from '../cad/stepImport'
import { useNoticeStore } from '../editor/noticeStore'
import { DEFAULT_FIELD_VISUAL_ALIGNMENT } from '../scene/fieldDoc'
import type { Vec3 } from '../scene/model'
import { loadFieldVisualWithProgress } from './fieldVisualLoad'
import {
  buildFieldVisual,
  FIELD_CAD_DECAL_THICKNESS,
  fieldVisualGroupKey,
  isFieldDecalMesh,
  isFieldGlassMesh
} from './fieldVisualModel'
import { clearLoadedFieldVisual, fieldVisualGroups, useFieldVisualStore } from './fieldVisualStore'

// spec-4e §7 A10·A11: 필드 CAD 메시 묶기(입력 불변)와 정렬 회전

// 상자 메시(정점 8, 삼각형 12). 정점은 경계 상자 중심(피벗) 기준이다(ImportedMesh.positions 규칙).
function boxMesh(
  name: string,
  min: Vec3,
  max: Vec3,
  options: { color?: Vec3; colors?: boolean; normals?: boolean; sourceIndex?: number } = {}
): ImportedMesh {
  const bounds = { min, max }
  const c = boundsCenter(bounds)
  const corners: number[] = []
  for (let i = 0; i < 8; i++) {
    corners.push(
      (i & 1 ? max[0] : min[0]) - c[0],
      (i & 2 ? max[1] : min[1]) - c[1],
      (i & 4 ? max[2] : min[2]) - c[2]
    )
  }
  // prettier-ignore
  const indices = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]
  const positions = new Float32Array(corners)
  const normals = new Float32Array(corners.map((value) => Math.sign(value)))
  return {
    sourceIndex: options.sourceIndex ?? 0,
    name,
    positions,
    normals: options.normals === false ? null : normals,
    indices: new Uint32Array(indices),
    colors: options.colors ? new Float32Array(24).fill(0.25) : null,
    color: options.color ?? [0.5, 0.5, 0.5],
    bounds,
    mass: computeMeshMass(positions, indices, bounds)
  }
}

function modelOf(meshes: ImportedMesh[]): ImportedModel {
  meshes.forEach((mesh, index) => (mesh.sourceIndex = index))
  return {
    root: { name: 'field', kind: 'assembly', bounds: meshes[0].bounds, children: [] },
    meshes,
    sourceMeshCount: meshes.length
  }
}

// 합성 메시 여섯: 색 둘, 꼭짓점 색 하나, 투명판 하나, 법선 없음 하나, 두께 0.254 mm(테이프) 하나
function sixMeshes(): ImportedMesh[] {
  const red: Vec3 = [1, 0, 0]
  const grey: Vec3 = [0.7913, 0.7913, 0.7913]
  return [
    boxMesh('Rail', [0, 0, 0], [1, 0.1, 0.1], { color: grey }),
    boxMesh('Bar', [-1, 0.2, -0.5], [-0.5, 0.4, 0.5], { color: red }),
    boxMesh('Sticker', [0.1, 0.1, 0.1], [0.2, 0.3, 0.4], { color: grey, colors: true }),
    boxMesh('FTC Field Side Glass 11in', [1.79, 0, -1], [1.793, 0.27, 1], { color: grey }),
    boxMesh('Leg', [2, 0, 2], [2.5, 1, 2.2], { color: red, normals: false }),
    boxMesh('Gaffer Tape, Red, 1in Wide', [-0.5, 0, 0.3], [0, 0.000254, 0.3254], { color: red })
  ]
}

const snapshot = (model: ImportedModel): unknown[] =>
  model.meshes.map((mesh) => ({
    positions: mesh.positions.slice(),
    normals: mesh.normals ? mesh.normals.slice() : null,
    indices: mesh.indices.slice(),
    colors: mesh.colors ? mesh.colors.slice() : null
  }))

afterEach(() => clearLoadedFieldVisual())

describe('A10 buildFieldVisual', () => {
  it('묶음은 처음 나온 순서이고 키는 색·꼭짓점 색·투명판·얇은 겹이다', () => {
    const model = modelOf(sixMeshes())
    const built = buildFieldVisual(model)
    expect(built.groups.map((group) => group.key)).toEqual([
      '0.7913,0.7913,0.7913|0|0|0',
      '1,0,0|0|0|0',
      '0.7913,0.7913,0.7913|1|0|0',
      '0.7913,0.7913,0.7913|0|1|0',
      '1,0,0|0|0|1'
    ])
    expect(built.groups.map((group) => [group.vertexColors, group.glass, group.decal])).toEqual([
      [false, false, false],
      [false, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true]
    ])
    expect(built.groups[1].color).toEqual([1, 0, 0])
    expect(built.meshCount).toBe(6)
    expect(built.triangleCount).toBe(6 * 12)
    expect(built.glassMeshCount).toBe(1)
    expect(built.groups.filter((group) => group.glass)).toHaveLength(1)
    expect(built.groups.filter((group) => group.decal)).toHaveLength(1)
    expect(fieldVisualGroupKey(model.meshes[3])).toBe('0.7913,0.7913,0.7913|0|1|0')
  })

  it('정점은 피벗 좌표 + 경계 상자 중심(CAD 좌표)이고 인덱스는 정점 오프셋만큼 밀린다', () => {
    const model = modelOf(sixMeshes())
    const built = buildFieldVisual(model)
    // 빨강 묶음: Bar(정점 0–7) 다음 Leg(정점 8–15, 법선 없음)
    const red = built.groups[1].geometry
    const position = red.getAttribute('position')
    expect(position.count).toBe(16)
    for (const [meshIndex, offset] of [
      [1, 0],
      [4, 8]
    ] as const) {
      const mesh = model.meshes[meshIndex]
      const center = boundsCenter(mesh.bounds)
      for (let v = 0; v < 8; v++) {
        for (let k = 0; k < 3; k++) {
          const expected = mesh.positions[v * 3 + k] + center[k]
          expect(Math.abs(position.getComponent(offset + v, k) - expected)).toBeLessThan(1e-6)
        }
      }
    }
    // 각 정점이 원래 경계 상자의 꼭짓점이다
    expect(position.getX(0)).toBeCloseTo(-1, 6)
    expect(position.getZ(15)).toBeCloseTo(2.2, 6)
    const index = red.getIndex()!
    expect(index.count).toBe(72)
    expect(Array.from(index.array.slice(36, 39))).toEqual(
      Array.from(model.meshes[4].indices.slice(0, 3)).map((value) => value + 8)
    )
    // 법선 없는 메시도 normal 속성이 있다(정점 수만큼, 단위 길이)
    const normal = red.getAttribute('normal')
    expect(normal.count).toBe(16)
    for (let v = 8; v < 16; v++) {
      const n = new Vector3(normal.getX(v), normal.getY(v), normal.getZ(v))
      expect(n.length()).toBeCloseTo(1, 5)
    }
    // 꼭짓점 색 묶음은 color 속성을 갖고 나머지는 없다
    expect(built.groups[2].geometry.getAttribute('color').count).toBe(8)
    expect(built.groups[0].geometry.getAttribute('color')).toBeUndefined()
    // 경계 구·상자를 계산해 둔다
    expect(red.boundingSphere).not.toBeNull()
    expect(red.boundingBox).not.toBeNull()
  })

  it('bounds는 모든 정점의 범위다', () => {
    const built = buildFieldVisual(modelOf(sixMeshes()))
    const expected = { min: [-1, 0, -1], max: [2.5, 1, 2.2] }
    for (let i = 0; i < 3; i++) {
      expect(built.bounds.min[i]).toBeCloseTo(expected.min[i], 6)
      expect(built.bounds.max[i]).toBeCloseTo(expected.max[i], 6)
    }
    expect(buildFieldVisual({ ...modelOf(sixMeshes()), meshes: [] }).bounds).toEqual({
      min: [0, 0, 0],
      max: [0, 0, 0]
    })
  })

  it('입력 모델을 바꾸지 않고(법선 null은 null 그대로), 두 번 빌드해도 결과 배열이 같다', () => {
    const model = modelOf(sixMeshes())
    const before = snapshot(model)
    const first = buildFieldVisual(model)
    expect(snapshot(model)).toEqual(before)
    expect(model.meshes[4].normals).toBeNull()
    const second = buildFieldVisual(model)
    expect(snapshot(model)).toEqual(before)
    expect(second.groups).toHaveLength(first.groups.length)
    first.groups.forEach((group, i) => {
      const other = second.groups[i].geometry
      for (const name of ['position', 'normal']) {
        expect(Array.from(other.getAttribute(name).array)).toEqual(
          Array.from(group.geometry.getAttribute(name).array)
        )
      }
      expect(Array.from(other.getIndex()!.array)).toEqual(
        Array.from(group.geometry.getIndex()!.array)
      )
      // 결과는 모델 배열을 참조하지 않는다
      for (const mesh of model.meshes) {
        expect(group.geometry.getAttribute('position').array.buffer).not.toBe(mesh.positions.buffer)
        expect(group.geometry.getIndex()!.array.buffer).not.toBe(mesh.indices.buffer)
      }
    })
  })

  it('투명판 이름 규칙과 얇은 겹 문턱', () => {
    for (const name of ['FTC Field Side Glass 11in', 'Polycarbonate panel', 'LEXAN 1/8'])
      expect(isFieldGlassMesh({ name })).toBe(true)
    for (const name of ['Rail', 'Gaffer Tape, Red', ''])
      expect(isFieldGlassMesh({ name })).toBe(false)
    // 같은 정규식을 거듭 써도 결과가 같다(g 깃발 없음)
    expect(isFieldGlassMesh({ name: 'glass' })).toBe(true)
    expect(isFieldGlassMesh({ name: 'glass' })).toBe(true)
    const slab = (t: number): boolean =>
      isFieldDecalMesh({ bounds: { min: [0, 0, 0], max: [1, 1, t] } })
    expect(slab(FIELD_CAD_DECAL_THICKNESS)).toBe(true)
    expect(slab(0.000254)).toBe(true)
    expect(slab(0.0006)).toBe(false)
    // 어느 축이든 얇으면 겹이다
    expect(isFieldDecalMesh({ bounds: { min: [0, 0, 0], max: [0.0001, 1, 1] } })).toBe(true)
  })
})

describe('A10 CAx-IF 샘플', () => {
  let occt: Occt
  const require = createRequire(import.meta.url)

  beforeAll(async () => {
    occt = await (require('occt-import-js') as () => Promise<Occt>)()
  })

  it('as1-oc-214: triangleCount = 메시 삼각형 합, meshCount = 메시 수, 입력 불변', () => {
    const file = require.resolve('occt-import-js/test/testfiles/cax-if/as1-oc-214.stp')
    const result = occt.ReadStepFile(new Uint8Array(readFileSync(file)), { linearUnit: 'meter' })
    const model = convertOcctResult(result, 'as1-oc-214.stp')!
    const before = snapshot(model)
    const built = buildFieldVisual(model)
    expect(built.meshCount).toBe(model.meshes.length)
    expect(built.triangleCount).toBe(
      model.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0)
    )
    expect(built.groups.reduce((sum, g) => sum + g.geometry.getIndex()!.count / 3, 0)).toBe(
      built.triangleCount
    )
    expect(snapshot(model)).toEqual(before)
  })
})

describe('A10 메시 캐시에 쓰는 모델', () => {
  // 처음 변환한 결과를 500 ms 뒤 같은 객체로 캐시에 쓴다(importStep storeCacheLater). 합치기가 그 배열을 바꾸면 캐시가
  // 망가진다(비평 H1·U1).
  it('필드 CAD로 불러온 뒤 캐시에 쓰는 모델의 위치가 변환 직후 값과 같다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const model = modelOf(sixMeshes())
    const converted = snapshot(model)
    const stored: { key: string; model: ImportedModel }[] = []
    // 워커(WASM 변환)를 흉내 낸다: 받은 요청에 모델을 돌려준다
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null
      onerror: unknown = null
      postMessage(): void {
        queueMicrotask(() => this.onmessage?.({ data: { ok: true, model } }))
      }
      terminate(): void {
        // 끝낼 것이 없다
      }
    }
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('window', {
      api: {
        hasStepConverter: async () => false,
        readStepCached: async () => ({
          key: 'key-1',
          model: null,
          bytes: new Uint8Array([1, 2, 3]),
          size: 3
        }),
        storeMeshCache: async (key: string, value: ImportedModel) => {
          stored.push({ key, model: value })
        }
      }
    })
    try {
      expect(await loadFieldVisualWithProgress('/f/field.step')).toBe('loaded')
      expect(fieldVisualGroups()).toHaveLength(5)
      expect(useFieldVisualStore.getState().loaded?.path).toBe('/f/field.step')
      expect(stored).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(500)
      expect(stored).toHaveLength(1)
      expect(stored[0].key).toBe('key-1')
      expect(stored[0].model).toBe(model)
      expect(snapshot(stored[0].model)).toEqual(converted)
      // 진행 알림은 끝나면 닫힌다
      expect(useNoticeStore.getState().notices.filter((n) => n.level === 'progress')).toEqual([])
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})

describe('A11 정렬 회전', () => {
  const apply = (alignment: Parameters<typeof alignmentRotation>[0]): number[] =>
    new Vector3(1, 2, 3).applyMatrix4(alignmentRotation(alignment)).toArray()

  it('기본 Y-up은 CAD (1, 2, 3) → 필드 (3, 1, 2)이고 원소가 정확히 0·±1, det 1', () => {
    expect(apply(DEFAULT_FIELD_VISUAL_ALIGNMENT)).toEqual([3, 1, 2])
    const matrix = alignmentRotation(DEFAULT_FIELD_VISUAL_ALIGNMENT)
    for (const value of matrix.elements) expect([0, 1, -1]).toContain(value)
    expect(matrix.determinant()).toBe(1)
  })

  it('Z-up은 (−2, 1, 3)', () => {
    expect(apply(ALIGNMENT_PRESETS.zUp)).toEqual([-2, 1, 3])
  })
})
