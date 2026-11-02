import { readFileSync } from 'fs'
import { createRequire } from 'module'
import type { Occt, OcctResult } from 'occt-import-js'
import { Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { worldMatrix, type SceneObjects } from '../scene/model'
import { ALIGNMENT_PRESETS, alignmentRotation, boundsCenter } from './alignment'
import { computeMeshMass } from './meshMass'
import {
  buildSceneObjects,
  cadGeometryId,
  cadRootIdOf,
  convertOcctResult,
  droppedMeshCount,
  emptyResultReason,
  isImportedModel,
  MESH_CACHE_TAG,
  meshGeometryIds,
  meshSourceNames,
  type ImportedModel
} from './stepImport'

function counterIds(): () => string {
  let next = 0
  return () => `id${next++}`
}

// 두 개의 파트를 가진 어셈블리 하나와, 루트 바로 아래의 단일 파트
const synthetic: OcctResult = {
  success: true,
  root: {
    name: '',
    meshes: [],
    children: [
      {
        name: 'ROBOT_ASM',
        meshes: [],
        children: [
          { name: 'PLATE', meshes: [0], children: [] },
          { name: 'WHEEL_ASM', meshes: [1, 2], children: [] }
        ]
      }
    ]
  },
  meshes: [
    mesh('Plate', [0, 0, 0], [2, 1, 0.1], [1, 0, 0]),
    mesh('', [0, 0, 0], [0.1, 0.1, 0.1]),
    mesh('Hub', [1, 1, 1], [1.2, 1.2, 1.2])
  ]
}

function mesh(
  name: string,
  min: [number, number, number],
  max: [number, number, number],
  color?: [number, number, number]
): OcctResult['meshes'][number] {
  return {
    name,
    color,
    brep_faces: [{ first: 0, last: 0, color: null }],
    attributes: { position: { array: [...min, ...max, min[0], max[1], min[2]] } },
    index: { array: [0, 1, 2] }
  }
}

describe('convertOcctResult', () => {
  const model = convertOcctResult(synthetic, 'robot.step')!

  it('최상위 형상을 루트로 쓰고 계층을 유지한다', () => {
    expect(model.root.name).toBe('ROBOT_ASM')
    expect(model.root.kind).toBe('assembly')
    expect(model.root.children.map((c) => [c.name, c.kind])).toEqual([
      ['PLATE', 'part'],
      ['WHEEL_ASM', 'assembly']
    ])
    // 이름 없는 메시는 노드 이름 + 순번
    expect(model.root.children[1].children.map((c) => c.name)).toEqual(['WHEEL_ASM 1', 'Hub'])
  })

  it('메시 정점을 경계 상자 중심 기준으로 옮기고 색을 유지한다', () => {
    const plate = model.meshes[model.root.children[0].meshIndex!]
    expect(Array.from(plate.positions.slice(0, 3))).toEqual([-1, -0.5, -0.05].map(Math.fround))
    expect(plate.color).toEqual([1, 0, 0])
    expect(model.root.bounds).toEqual({ min: [0, 0, 0], max: [2, 1.2, 1.2] })
  })
})

describe('메시 질량 성질', () => {
  it('변환할 때 피벗(경계 상자 중심) 기준으로 계산해 메시에 붙인다', () => {
    const model = convertOcctResult(synthetic, 'robot.step')!
    synthetic.meshes.forEach((source, index) => {
      const mesh = model.meshes.find((m) => m.sourceIndex === index)!
      // 변환 전 double 좌표 그대로 적분한다(Float32로 줄인 positions가 아니라)
      expect(mesh.mass).toEqual(
        computeMeshMass(source.attributes.position.array, source.index.array, mesh.bounds)
      )
    })
    // 삼각형 하나짜리 시험 메시는 부피가 없어 표면이다
    expect(model.meshes[0].mass).toMatchObject({ volume: 0, closure: Infinity })
  })

  it('네이티브 결과(parseNativeResult의 Float32·Uint32 배열)도 같은 경로라 같은 값이다', () => {
    // 닫힌 사면체 하나(좌표가 Float32로 정확한 값이라 두 경로가 같은 수를 본다)
    const positions = [0, 0, 0, 0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125]
    const indices = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]
    const wasm: OcctResult = {
      success: true,
      root: { name: '', meshes: [0], children: [] },
      meshes: [
        {
          name: 'tet',
          brep_faces: [{ first: 0, last: 3, color: null }],
          attributes: { position: { array: positions } },
          index: { array: indices }
        }
      ]
    }
    const native: OcctResult = {
      ...wasm,
      meshes: [
        {
          ...wasm.meshes[0],
          attributes: { position: { array: Float32Array.from(positions) } },
          index: { array: Uint32Array.from(indices) }
        }
      ]
    }
    const a = convertOcctResult(wasm, 'tet.step')!.meshes[0].mass
    const b = convertOcctResult(native, 'tet.step')!.meshes[0].mass
    expect(a).toEqual(b)
    expect(a.volume).toBeCloseTo((0.5 * 0.25 * 0.125) / 6, 15)
    expect(a.closure).toBeLessThan(1e-12)
  })
})

describe('메시 캐시 형식', () => {
  it('질량 성질을 더해 형식 태그를 v3으로 올렸다(이전 캐시는 다시 변환한다)', () => {
    expect(MESH_CACHE_TAG).toBe('model-v3')
  })

  it('isImportedModel은 메시마다 질량 성질의 모양을 확인한다', () => {
    const model = convertOcctResult(synthetic, 'robot.step')!
    expect(isImportedModel(model)).toBe(true)
    const withMesh = (patch: Record<string, unknown>): unknown => ({
      ...model,
      meshes: [{ ...model.meshes[0], ...patch }, ...model.meshes.slice(1)]
    })
    // v2 캐시 모양(질량 없음)과 깨진 값은 받지 않는다
    expect(isImportedModel(withMesh({ mass: undefined }))).toBe(false)
    expect(isImportedModel(withMesh({ mass: { ...model.meshes[0].mass, volume: -1 } }))).toBe(false)
    expect(
      isImportedModel(withMesh({ mass: { ...model.meshes[0].mass, inertia: [0, 0, 0, 0, 0] } }))
    ).toBe(false)
    expect(isImportedModel(withMesh({ mass: { ...model.meshes[0].mass, area: NaN } }))).toBe(false)
  })
})

describe('형상 id와 원래 CAD 이름', () => {
  it('cadRootIdOf는 cadGeometryId의 거꾸로다', () => {
    const root = '0b6c1d2e-3f40-4a5b-8c7d-9e0f1a2b3c4d'
    expect(cadRootIdOf(cadGeometryId(root, 12))).toBe(root)
    expect(cadRootIdOf('cad:0')).toBe('cad')
    expect(cadRootIdOf('a:b:3')).toBe('a:b')
    expect(cadRootIdOf('g-arm')).toBeNull()
    expect(cadRootIdOf(':3')).toBeNull()
    expect(cadRootIdOf('cad:x')).toBeNull()
  })

  it('불러올 때 파트가 받은 이름이고, 이름 없는 메시에 붙인 "노드 + 순번"은 빈 글자다', () => {
    const model = convertOcctResult(synthetic, 'robot.step')!
    const names = meshSourceNames(model)
    const bySource = Object.fromEntries(model.meshes.map((m, i) => [m.sourceIndex, names[i]]))
    // 메시 하나뿐인 잎 노드는 노드(컴포넌트) 이름, 이름 있는 메시는 그 이름, 'WHEEL_ASM 1'은 CAD 이름이 아니다
    expect(bySource).toEqual({ 0: 'PLATE', 1: '', 2: 'Hub' })
  })

  it('하나만 남아 노드 자체가 파트가 되면 노드 이름이다', () => {
    const partial: OcctResult = {
      ...synthetic,
      meshes: [
        synthetic.meshes[0],
        { ...synthetic.meshes[1], attributes: { position: { array: [] } }, index: { array: [] } },
        synthetic.meshes[2]
      ]
    }
    const model = convertOcctResult(partial, 'robot.step')!
    expect(meshSourceNames(model)).toEqual(['PLATE', 'WHEEL_ASM'])
  })
})

describe('삼각형을 만들지 못한 메시', () => {
  const noTriangles = (source: OcctResult['meshes'][number]): OcctResult['meshes'][number] => ({
    ...source,
    attributes: { position: { array: [] } },
    index: { array: [] }
  })

  it('빠진 메시가 있어도 다른 파트의 형상 id는 원래 순번이라 밀리지 않는다', () => {
    const partial: OcctResult = {
      ...synthetic,
      meshes: [synthetic.meshes[0], noTriangles(synthetic.meshes[1]), synthetic.meshes[2]]
    }
    const model = convertOcctResult(partial, 'robot.step')!
    expect(model.meshes.map((m) => m.sourceIndex)).toEqual([0, 2])
    expect(model.sourceMeshCount).toBe(3)
    expect(droppedMeshCount(model)).toBe(1)
    // 하나만 남은 WHEEL_ASM 메시는 노드 자체가 파트가 된다
    expect(model.root.children.map((c) => c.name)).toEqual(['PLATE', 'WHEEL_ASM'])

    const { objects, cadRootId } = buildSceneObjects(model, {
      fileName: 'robot.step',
      absolutePath: '/cad/robot.step',
      alignment: ALIGNMENT_PRESETS.zUp,
      createId: counterIds()
    })
    const ids = Object.values(objects).flatMap((o) =>
      o.visual?.type === 'mesh' ? [o.visual.geometryId] : []
    )
    expect(ids).toEqual([cadGeometryId(cadRootId, 0), cadGeometryId(cadRootId, 2)])
    expect(objects[cadRootId].cad).toMatchObject({ meshCount: 3, meshIndexing: 'source' })

    // 예전 프로젝트(packed)는 빈 메시를 빼고 다시 매긴 순번으로 등록한다
    expect(meshGeometryIds('c', model, 'source')).toEqual(['c:0', 'c:2'])
    expect(meshGeometryIds('c', model, 'packed')).toEqual(['c:0', 'c:1'])
  })

  it('모델을 만들지 못한 이유: 메시가 없으면 empty, 모두 삼각형이 없으면 meshFailed', () => {
    const allEmpty: OcctResult = { ...synthetic, meshes: synthetic.meshes.map(noTriangles) }
    expect(convertOcctResult(allEmpty, 'robot.step')).toBeNull()
    expect(emptyResultReason(allEmpty)).toBe('meshFailed')
    const noMeshes: OcctResult = {
      success: true,
      root: { name: '', meshes: [], children: [] },
      meshes: []
    }
    expect(convertOcctResult(noMeshes, 'robot.step')).toBeNull()
    expect(emptyResultReason(noMeshes)).toBe('empty')
  })
})

function expectPivotsMatchCad(
  model: ImportedModel,
  objects: SceneObjects,
  cadRootId: string
): void {
  // 로봇이 원점에 있으면, 각 파트의 피벗은 "정렬 회전 × CAD 중심 + 평행이동"이어야 한다
  const rotation = alignmentRotation(ALIGNMENT_PRESETS.zUp)
  const root = new Vector3().setFromMatrixPosition(worldMatrix(objects, cadRootId))
  const translation = root.sub(
    new Vector3(...boundsCenter(model.root.bounds)).applyMatrix4(rotation)
  )
  for (let meshIndex = 0; meshIndex < model.meshes.length; meshIndex++) {
    const geometryId = cadGeometryId(cadRootId, model.meshes[meshIndex].sourceIndex)
    const object = Object.values(objects).find(
      (o) => o.visual?.type === 'mesh' && o.visual.geometryId === geometryId
    )!
    const actual = new Vector3().setFromMatrixPosition(worldMatrix(objects, object.id))
    const expected = new Vector3(...boundsCenter(model.meshes[meshIndex].bounds))
      .applyMatrix4(rotation)
      .add(translation)
    expect(actual.distanceTo(expected)).toBeLessThan(1e-9)
  }
}

describe('buildSceneObjects', () => {
  it('로봇 → CAD 루트 → 어셈블리·파트 순으로 만들고 피벗 위치를 보존한다', () => {
    const model = convertOcctResult(synthetic, 'robot.step')!
    const { objects, robotId, cadRootId } = buildSceneObjects(model, {
      fileName: 'robot.step',
      absolutePath: '/cad/robot.step',
      alignment: ALIGNMENT_PRESETS.zUp,
      createId: counterIds()
    })
    expect(objects[robotId]).toMatchObject({ name: 'robot', kind: 'robot', parentId: null })
    const cadRoot = objects[cadRootId]
    expect(cadRoot).toMatchObject({ name: 'ROBOT_ASM', parentId: robotId })
    expect(cadRoot.cad).toMatchObject({
      fileName: 'robot.step',
      absolutePath: '/cad/robot.step',
      upAxis: '+Z',
      forwardAxis: '-Y',
      meshCount: 3
    })
    expectPivotsMatchCad(model, objects, cadRootId)
  })
})

// 실제 STEP 파일: occt-import-js 패키지에 들어 있는 CAx-IF 테스트 어셈블리(판, L 브래킷 2개, 봉)
describe('실제 STEP 파일 (CAx-IF as1_pe_203)', () => {
  let occt: Occt
  const require = createRequire(import.meta.url)
  const file = require.resolve('occt-import-js/test/testfiles/cax-if/as1_pe_203.stp')

  beforeAll(async () => {
    occt = await (require('occt-import-js') as () => Promise<Occt>)()
  })

  it('미터 단위로 읽어 어셈블리 계층과 파트를 만든다', () => {
    const result = occt.ReadStepFile(new Uint8Array(readFileSync(file)), { linearUnit: 'meter' })
    const model = convertOcctResult(result, 'as1_pe_203.stp')!
    expect(model.root.name).toBe('AS1_PE_ASM')
    expect(model.root.children.map((c) => c.name)).toEqual([
      'PLATE',
      'L_BRACKET_ASSEMBLY_ASM',
      'L_BRACKET_ASSEMBLY_ASM',
      'ROD_ASM'
    ])
    expect(model.meshes).toHaveLength(18)

    const { objects, cadRootId } = buildSceneObjects(model, {
      fileName: 'as1_pe_203.stp',
      absolutePath: file,
      alignment: ALIGNMENT_PRESETS.zUp,
      createId: counterIds()
    })
    expectPivotsMatchCad(model, objects, cadRootId)
  })
})
