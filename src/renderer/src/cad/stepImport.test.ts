import { readFileSync } from 'fs'
import { createRequire } from 'module'
import type { Occt, OcctResult } from 'occt-import-js'
import { Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { worldMatrix, type SceneObjects } from '../scene/model'
import { ALIGNMENT_PRESETS, alignmentRotation, boundsCenter } from './alignment'
import {
  buildSceneObjects,
  cadGeometryId,
  convertOcctResult,
  droppedMeshCount,
  emptyResultReason,
  meshGeometryIds,
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
