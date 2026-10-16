import { describe, expect, it } from 'vitest'
import { cadRootTransform } from '../cad/alignment'
import { moveObjects } from '../scene/hierarchy'
import type { SceneObject, SceneObjects, Transform } from '../scene/model'
import { movedOutCadRoot, parentCadAxes } from './inspectorInfo'

const DEG = Math.PI / 180
const BOUNDS: { min: Transform['position']; max: Transform['position'] } = {
  min: [-0.2, 0, -0.1],
  max: [0.2, 0.3, 0.1]
}
const ALIGNMENT = { upAxis: '+Y', forwardAxis: '+Z' } as const

function node(
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  transform: Transform = { position: [0, 0, 0], rotation: [0, 0, 0] },
  extra: Partial<SceneObject> = {}
): SceneObject {
  return { id, name: id, kind, parentId, transform, ...extra }
}

// 로봇 R 아래 Y-up CAD 루트 C(정렬 회전), 그 아래 어셈블리 A·파트 P·CAD 안에 만든 그룹 CG와 그 파트 Q,
// 로봇 바로 아래 돌아간 그룹 G
function scene(): SceneObjects {
  return {
    R: node('R', 'robot', null, { position: [1, 2, 0], rotation: [0, 0, 30 * DEG] }),
    C: node('C', 'assembly', 'R', cadRootTransform(BOUNDS, ALIGNMENT), {
      cad: {
        fileName: 'robot.step',
        absolutePath: '/cad/robot.step',
        ...ALIGNMENT,
        bounds: BOUNDS,
        meshCount: 2,
        meshIndexing: 'source'
      }
    }),
    A: node('A', 'assembly', 'C', { position: [0.1, 0.05, 0], rotation: [0, 0, 0] }),
    P: node('P', 'part', 'A', { position: [0.02, 0, 0.01], rotation: [0, 0, 0] }),
    CG: node('CG', 'group', 'C'),
    Q: node('Q', 'part', 'CG', { position: [0, 0.1, 0], rotation: [0, 0, 0] }),
    G: node('G', 'group', 'R', { position: [0.05, -0.1, 0.1], rotation: [0.2, -0.3, 1.0] })
  }
}

describe('parentCadAxes(인스펙터의 CAD 축 안내)', () => {
  it('CAD 루트 아래 노드와 CAD 안에 만든 그룹·그 하위에 알린다', () => {
    const objects = scene()
    for (const id of ['A', 'P', 'CG', 'Q']) expect(parentCadAxes(objects, id)).toBe(objects.C.cad)
  })

  it('CAD 루트 자신, 로봇, 로봇 아래 그룹에는 알리지 않는다', () => {
    const objects = scene()
    for (const id of ['C', 'R', 'G', 'missing']) expect(parentCadAxes(objects, id)).toBeUndefined()
  })

  it('중간 노드를 돌렸으면 알리지 않는다', () => {
    const objects = scene()
    objects.A = { ...objects.A, transform: { ...objects.A.transform, rotation: [0, 0, 10 * DEG] } }
    expect(parentCadAxes(objects, 'A')).toBe(objects.C.cad)
    expect(parentCadAxes(objects, 'P')).toBeUndefined()
  })

  it('CAD 밖으로 옮긴 어셈블리 자신에는 알리지 않고, 그 하위에는 cadOrigin을 따라 알린다', () => {
    const objects = moveObjects(scene(), ['A'], 'G', null)
    expect(objects.A.cadOrigin).toBe('C')
    expect(parentCadAxes(objects, 'A')).toBeUndefined()
    expect(parentCadAxes(objects, 'P')).toBe(objects.C.cad)
  })
})

describe('movedOutCadRoot(옮겨 나간 CAD 파트의 원본)', () => {
  it('CAD 안에 있으면 null', () => {
    const objects = scene()
    for (const id of ['C', 'A', 'P', 'CG', 'Q', 'G', 'R'])
      expect(movedOutCadRoot(objects, id)).toBeNull()
  })

  it('밖으로 옮긴 노드와 그 하위는 원래 CAD 루트, 다시 들여오면 null', () => {
    const moved = moveObjects(scene(), ['A'], 'G', null)
    expect(movedOutCadRoot(moved, 'A')).toBe('C')
    expect(movedOutCadRoot(moved, 'P')).toBe('C')
    // 그룹은 CAD 출처가 없다
    const groupMoved = moveObjects(scene(), ['CG'], 'R', null)
    expect(movedOutCadRoot(groupMoved, 'CG')).toBeNull()
    const back = moveObjects(moved, ['A'], 'C', null)
    expect(movedOutCadRoot(back, 'A')).toBeNull()
    expect(movedOutCadRoot(back, 'P')).toBeNull()
  })
})
