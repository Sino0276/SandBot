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
  MESH_HULL_VERTEX_LIMIT,
  meshHullOf,
  meshGeometryIds,
  meshSourcePaths,
  type ImportedModel,
  type ImportedNode
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

describe('메시 볼록 껍질(spec-5 §5.3)', () => {
  // 닫힌 정육면체(꼭짓점 8, 삼각형 12)와 원기둥 옆면 점 구름
  const cube = (size: number): OcctResult['meshes'][number] => {
    const positions: number[] = []
    for (let i = 0; i < 8; i++) positions.push(i & 1 ? size : 0, i & 2 ? size : 0, i & 4 ? size : 0)
    // prettier-ignore
    const indices = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]
    return {
      name: 'cube',
      brep_faces: [{ first: 0, last: 11, color: null }],
      attributes: { position: { array: positions } },
      index: { array: indices }
    }
  }
  const resultOf = (meshes: OcctResult['meshes']): OcctResult => ({
    success: true,
    root: { name: '', meshes: meshes.map((_, i) => i), children: [] },
    meshes
  })

  it('B9 convertMesh가 피벗 기준 껍질 꼭짓점(≤ 64점)과 오차를 낸다', () => {
    const model = convertOcctResult(resultOf([cube(0.1)]), 'cube.step')!
    const { hull } = model.meshes[0]
    expect(hull.points).toHaveLength(8 * 3)
    // 피벗(경계 상자 중심) 기준: ±0.05
    expect(new Set(hull.points)).toEqual(new Set([-0.05, 0.05]))
    expect(hull.error).toBe(0)
    // 점이 많은 원기둥 옆면도 MESH_HULL_VERTEX_LIMIT(64)점까지
    const positions: number[] = []
    for (let k = 0; k < 400; k++) {
      const a = (2 * Math.PI * k) / 400
      positions.push(
        0.05 * Math.cos(a),
        0.05 * Math.sin(a),
        0,
        0.05 * Math.cos(a),
        0.05 * Math.sin(a),
        0.2
      )
    }
    const cylinder = convertOcctResult(
      resultOf([
        {
          name: 'cyl',
          brep_faces: [{ first: 0, last: 0, color: null }],
          attributes: { position: { array: positions } },
          index: { array: [0, 1, 2] }
        }
      ]),
      'cyl.step'
    )!.meshes[0].hull
    expect(cylinder.points.length / 3).toBeLessThanOrEqual(MESH_HULL_VERTEX_LIMIT)
    expect(cylinder.points.length / 3).toBeGreaterThan(8)
    expect(cylinder.error).toBeGreaterThan(0)
    expect(cylinder.error).toBeLessThan(1e-3)
  })

  it('B9 평평하거나 얇은 메시는 빈 껍질(points [], error 0)이다', () => {
    // synthetic의 삼각형 하나짜리 메시는 평면이다
    const model = convertOcctResult(synthetic, 'robot.step')!
    for (const mesh of model.meshes) expect(mesh.hull).toEqual({ points: [], error: 0 })
    expect(meshHullOf(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.0004]))).toEqual({
      points: [],
      error: 0
    })
  })

  it('B9 네이티브 결과(Float32·Uint32 배열)도 같은 경로라 같은 껍질이다', () => {
    const wasm = resultOf([cube(0.123)])
    const native: OcctResult = {
      ...wasm,
      meshes: [
        {
          ...wasm.meshes[0],
          attributes: {
            position: { array: Float32Array.from(wasm.meshes[0].attributes.position.array) }
          },
          index: { array: Uint32Array.from(wasm.meshes[0].index.array) }
        }
      ]
    }
    expect(convertOcctResult(native, 'c.step')!.meshes[0].hull).toEqual(
      convertOcctResult(wasm, 'c.step')!.meshes[0].hull
    )
  })
})

describe('메시 캐시 형식', () => {
  it('B9 메시 볼록 껍질을 더해 형식 태그를 v4로 올렸다(이전 캐시는 다시 변환한다)', () => {
    expect(MESH_CACHE_TAG).toBe('model-v4')
  })

  it('B9 isImportedModel은 메시마다 껍질의 모양을 확인한다(hull 없는 v3 값은 받지 않는다)', () => {
    const model = convertOcctResult(synthetic, 'robot.step')!
    const withMesh = (patch: Record<string, unknown>): unknown => ({
      ...model,
      meshes: [{ ...model.meshes[0], ...patch }, ...model.meshes.slice(1)]
    })
    expect(isImportedModel(withMesh({ hull: undefined }))).toBe(false)
    expect(isImportedModel(withMesh({ hull: { points: [0, 0], error: 0 } }))).toBe(false)
    expect(isImportedModel(withMesh({ hull: { points: [0, 0, NaN], error: 0 } }))).toBe(false)
    expect(isImportedModel(withMesh({ hull: { points: [], error: -1 } }))).toBe(false)
    expect(
      isImportedModel(withMesh({ hull: { points: new Array(3 * 65).fill(0), error: 0 } }))
    ).toBe(false)
    expect(isImportedModel(withMesh({ hull: { points: [0, 0, 0], error: 0.001 } }))).toBe(true)
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

describe('형상 id와 원래 이름 경로', () => {
  it('cadRootIdOf는 cadGeometryId의 거꾸로다', () => {
    const root = '0b6c1d2e-3f40-4a5b-8c7d-9e0f1a2b3c4d'
    expect(cadRootIdOf(cadGeometryId(root, 12))).toBe(root)
    expect(cadRootIdOf('cad:0')).toBe('cad')
    expect(cadRootIdOf('a:b:3')).toBe('a:b')
    expect(cadRootIdOf('g-arm')).toBeNull()
    expect(cadRootIdOf(':3')).toBeNull()
    expect(cadRootIdOf('cad:x')).toBeNull()
  })

  // 메시마다 원래 이름 경로의 이름들(붙인 이름은 '*'를 붙여 보인다)
  const pathNames = (model: ImportedModel): string[][] =>
    meshSourcePaths('c', model).map((path) =>
      path.map((node) => (node.generated ? `*${node.name}` : node.name))
    )

  it('원래 이름 경로는 CAD 루트부터 파트까지 불러올 때의 이름이고, 붙인 "노드 + 순번"을 표시한다', () => {
    const model = convertOcctResult(synthetic, 'robot.step')!
    const paths = meshSourcePaths('c', model)
    const bySource = Object.fromEntries(
      model.meshes.map((m, i) => [m.sourceIndex, pathNames(model)[i]])
    )
    // 메시 하나뿐인 잎 노드는 노드(컴포넌트) 이름, 이름 있는 메시는 그 이름, 'WHEEL_ASM 1'은 붙인 이름이다
    expect(bySource).toEqual({
      0: ['ROBOT_ASM', 'PLATE'],
      1: ['ROBOT_ASM', 'WHEEL_ASM', '*WHEEL_ASM 1'],
      2: ['ROBOT_ASM', 'WHEEL_ASM', 'Hub']
    })
    // 같은 노드는 메시끼리 같은 키(CAD 루트 id + 순번 경로)이고 CAD가 다르면 키도 다르다
    const keys = paths.map((path) => path.map((node) => node.key))
    expect(keys).toEqual([
      ['c/', 'c/0'],
      ['c/', 'c/1', 'c/1.0'],
      ['c/', 'c/1', 'c/1.1']
    ])
    expect(meshSourcePaths('d', model)[0][0].key).toBe('d/')
    // 변환은 결정적이라 같은 파일을 다시 읽으면 같은 경로다(프로젝트를 다시 열 때)
    expect(meshSourcePaths('c', convertOcctResult(synthetic, 'robot.step')!)).toEqual(paths)
  })

  it('원래 이름 경로는 buildSceneObjects의 오브젝트 계층·이름과 같다', () => {
    const model = convertOcctResult(synthetic, 'robot.step')!
    const { objects } = buildSceneObjects(model, {
      fileName: 'robot.step',
      absolutePath: '/cad/robot.step',
      alignment: ALIGNMENT_PRESETS.zUp,
      createId: counterIds()
    })
    const meshes = Object.values(objects).filter((o) => o.visual?.type === 'mesh')
    const objectPaths = meshes.map((o) => {
      const names: string[] = []
      for (let at = objects[o.id]; at.kind !== 'robot'; at = objects[at.parentId!])
        names.unshift(at.name)
      return names
    })
    expect(objectPaths).toEqual(
      meshSourcePaths('c', model).map((path) => path.map((node) => node.name))
    )
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
    expect(pathNames(model)).toEqual([
      ['ROBOT_ASM', 'PLATE'],
      ['ROBOT_ASM', 'WHEEL_ASM']
    ])
  })

  it('"부모 이름 + 숫자"인 진짜 CAD 이름은 남긴다(붙인 이름인지는 변환할 때 기록한다)', () => {
    const named: OcctResult = {
      success: true,
      root: {
        name: '',
        meshes: [],
        children: [
          {
            name: 'Bracket',
            meshes: [],
            children: [
              // 메시 이름이 없는 잎 컴포넌트의 이름이 우연히 부모 이름 + 숫자
              { name: 'Bracket 2', meshes: [0], children: [] },
              // 이름 없는 노드의 이름 없는 메시 둘: 붙인 이름 ' 1'·' 2'
              { name: '', meshes: [1, 2], children: [] }
            ]
          }
        ]
      },
      meshes: [
        mesh('', [0, 0, 0], [1, 1, 1]),
        mesh('', [0, 0, 0], [1, 1, 1]),
        mesh('', [0, 0, 0], [1, 1, 1])
      ]
    }
    const model = convertOcctResult(named, 'bracket.step')!
    expect(pathNames(model)).toEqual([
      ['Bracket', 'Bracket 2'],
      ['Bracket', '', '* 1'],
      ['Bracket', '', '* 2']
    ])
    // 오브젝트 이름은 전과 같다
    const names = (node: ImportedNode): string[] => [node.name, ...node.children.flatMap(names)]
    expect(names(model.root)).toEqual(['Bracket', 'Bracket 2', '', ' 1', ' 2'])
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
