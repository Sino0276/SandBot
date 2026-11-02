import { BufferGeometry } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import type { MeshMassProps } from '../mass/types'
import type { SceneObjects } from './model'
import { useSceneStore } from './sceneStore'
import {
  beginCadLoad,
  cadMassSummary,
  disposeAllGeometry,
  disposeGeometry,
  getGeometry,
  meshMassProps,
  meshSourceName,
  registerGeometry
} from './geometryRegistry'

function mass(volume: number, closure: number): MeshMassProps {
  return { volume, centroid: [0, 0, 0], inertia: [1, 1, 1, 0, 0, 0], area: 1, closure }
}

// 형상 id마다 그 형상을 쓰는 파트 오브젝트 하나(CAD 루트 오브젝트는 요약에 필요 없다)
function partsUsing(geometryIds: string[]): SceneObjects {
  const objects: SceneObjects = {}
  geometryIds.forEach((geometryId, i) => {
    const id = `part-${i}`
    objects[id] = {
      id,
      name: id,
      kind: 'part',
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      visual: { type: 'mesh', geometryId, color: [0.5, 0.5, 0.5] }
    }
  })
  return objects
}

afterEach(() => disposeAllGeometry())

describe('메시 정보(질량 성질·원래 이름)', () => {
  it('형상과 같은 id로 등록하고 함께 해제한다', () => {
    const props = mass(2e-6, 0)
    registerGeometry('cad:0', new BufferGeometry(), { mass: props, sourceName: '1120-0015-0384' })
    expect(meshMassProps('cad:0')).toBe(props)
    expect(meshSourceName('cad:0')).toBe('1120-0015-0384')

    // 정보 없이 다시 등록하면 이전 정보가 남지 않는다
    registerGeometry('cad:0', new BufferGeometry())
    expect(meshMassProps('cad:0')).toBeUndefined()
    expect(meshSourceName('cad:0')).toBeUndefined()

    registerGeometry('cad:1', new BufferGeometry(), { mass: props, sourceName: '' })
    expect(meshSourceName('cad:1')).toBe('')
    disposeGeometry('cad:1')
    expect(getGeometry('cad:1')).toBeUndefined()
    expect(meshMassProps('cad:1')).toBeUndefined()
    expect(meshSourceName('cad:1')).toBeUndefined()
  })

  it('프로젝트를 새로 열면(disposeAllGeometry) 모두 지운다', () => {
    registerGeometry('cad:0', new BufferGeometry(), { mass: mass(1e-6, 0), sourceName: 'a' })
    disposeAllGeometry()
    expect(meshMassProps('cad:0')).toBeUndefined()
    expect(cadMassSummary('cad', partsUsing(['cad:0']))).toMatchObject({ meshes: 0 })
  })
})

describe('cadMassSummary', () => {
  it('CAD 루트마다 형상 id 접두어로 묶어 열린·표면 메시를 센다', () => {
    const root = '0b6c1d2e-3f40-4a5b-8c7d-9e0f1a2b3c4d'
    registerGeometry(`${root}:0`, new BufferGeometry(), { mass: mass(6e-6, 1e-15) })
    registerGeometry(`${root}:1`, new BufferGeometry(), { mass: mass(2e-6, 4.2e-3) })
    // 경계(0.001·0.02)는 닫힘·열림 쪽에 든다
    registerGeometry(`${root}:2`, new BufferGeometry(), { mass: mass(1e-6, 0.001) })
    registerGeometry(`${root}:3`, new BufferGeometry(), { mass: mass(1e-6, 0.02) })
    registerGeometry(`${root}:4`, new BufferGeometry(), { mass: mass(1e-9, 0.3) })
    registerGeometry(`${root}:5`, new BufferGeometry(), { mass: mass(0, Infinity) })
    // 다른 CAD와 CAD 형상이 아닌 id는 섞이지 않는다
    registerGeometry('other:0', new BufferGeometry(), { mass: mass(1, 0.5) })
    registerGeometry('g-arm', new BufferGeometry(), { mass: mass(1, 0.5) })
    const ids = [0, 1, 2, 3, 4, 5].map((i) => `${root}:${i}`)
    const objects = partsUsing([...ids, 'other:0', 'g-arm'])

    expect(cadMassSummary(root, objects)).toEqual({
      meshes: 6,
      openMeshes: 2,
      // 질량에 쓰는 부피 10e-6 가운데 열린 메시 3e-6
      openVolumeFraction: expect.closeTo(0.3, 12),
      surfaceMeshes: 2,
      pendingMeshes: 0
    })
    expect(cadMassSummary('other', objects)).toMatchObject({ meshes: 1, surfaceMeshes: 1 })
    expect(cadMassSummary('g-arm', objects)).toBeUndefined()
    expect(cadMassSummary('missing', objects)).toBeUndefined()

    disposeGeometry(`${root}:1`)
    expect(cadMassSummary(root, objects)).toMatchObject({ meshes: 5, openMeshes: 1 })
  })

  it('씬이 쓰지 않는 형상은 세지 않는다(지운 파트, 다시 연 STEP의 남은 메시)', () => {
    // 지운 파트의 형상은 실행 취소 기록이 들고 있고, 저장 뒤 다시 열면 STEP의 메시를 모두 등록하므로 남는다
    registerGeometry('cad:0', new BufferGeometry(), { mass: mass(6e-6, 0) })
    registerGeometry('cad:1', new BufferGeometry(), { mass: mass(0, Infinity) })
    registerGeometry('cad:2', new BufferGeometry(), { mass: mass(2e-6, 4.2e-3) })
    const all = partsUsing(['cad:0', 'cad:1', 'cad:2'])
    expect(cadMassSummary('cad', all)).toMatchObject({
      meshes: 3,
      openMeshes: 1,
      surfaceMeshes: 1
    })

    // 표면·열린 파트를 지운 씬
    const { 'part-1': surface, 'part-2': open, ...kept } = all
    void surface
    void open
    expect(cadMassSummary('cad', kept)).toEqual({
      meshes: 1,
      openMeshes: 0,
      openVolumeFraction: 0,
      surfaceMeshes: 0,
      pendingMeshes: 0
    })
    expect(getGeometry('cad:1')).toBeDefined()
    // 그 CAD의 파트를 모두 지우면 요약이 없다
    expect(cadMassSummary('cad', {})).toBeUndefined()
  })

  it('씬을 주지 않으면 지금 sceneStore의 문서로 센다', () => {
    registerGeometry('cad:0', new BufferGeometry(), { mass: mass(1e-6, 0) })
    registerGeometry('cad:1', new BufferGeometry(), { mass: mass(0, Infinity) })
    const previous = useSceneStore.getState().objects
    try {
      useSceneStore.setState({ objects: partsUsing(['cad:1']) })
      expect(cadMassSummary('cad')).toMatchObject({ meshes: 1, surfaceMeshes: 1 })
      useSceneStore.setState({ objects: partsUsing(['cad:0']) })
      expect(cadMassSummary('cad')).toMatchObject({ meshes: 1, surfaceMeshes: 0 })
    } finally {
      useSceneStore.setState({ objects: previous })
    }
  })

  it('질량에 쓰는 메시가 없으면 열린 비율은 0이다', () => {
    registerGeometry('cad:0', new BufferGeometry(), { mass: mass(0, Infinity) })
    registerGeometry('cad:1', new BufferGeometry())
    expect(cadMassSummary('cad', partsUsing(['cad:0', 'cad:1']))).toEqual({
      meshes: 2,
      openMeshes: 0,
      openVolumeFraction: 0,
      surfaceMeshes: 1,
      pendingMeshes: 0
    })
  })

  it('읽는 동안 이번 읽기에서 아직 등록하지 않은 메시를 pendingMeshes로 센다', () => {
    const objects = partsUsing(['cad:0', 'cad:1', 'cad:2'])
    const end = beginCadLoad('cad')
    expect(cadMassSummary('cad', objects)).toEqual({
      meshes: 0,
      openMeshes: 0,
      openVolumeFraction: 0,
      surfaceMeshes: 0,
      pendingMeshes: 3
    })
    registerGeometry('cad:0', new BufferGeometry(), { mass: mass(1e-6, 0) })
    expect(cadMassSummary('cad', objects)).toMatchObject({ meshes: 1, pendingMeshes: 2 })
    // 이번 읽기가 만들지 않은 다른 CAD의 형상은 이 CAD의 읽기와 관계없다
    registerGeometry('other:0', new BufferGeometry())
    end()
    expect(cadMassSummary('cad', objects)).toMatchObject({ meshes: 1, pendingMeshes: 0 })

    // 다시 읽는 동안에는 이전 형상이 남아 있지만(meshes) 이번 읽기에서 등록할 때까지 읽는 중으로 센다
    registerGeometry('cad:1', new BufferGeometry())
    registerGeometry('cad:2', new BufferGeometry())
    const reload = beginCadLoad('cad')
    expect(cadMassSummary('cad', objects)).toMatchObject({ meshes: 3, pendingMeshes: 3 })
    reload()
    expect(cadMassSummary('cad', objects)).toMatchObject({ meshes: 3, pendingMeshes: 0 })
  })

  it('늦게 끝난 이전 읽기는 새 읽기의 상태를 지우지 않는다', () => {
    const objects = partsUsing(['cad:0', 'cad:1'])
    const first = beginCadLoad('cad')
    const second = beginCadLoad('cad')
    first()
    expect(cadMassSummary('cad', objects)?.pendingMeshes).toBe(2)
    second()
    expect(cadMassSummary('cad', objects)?.pendingMeshes).toBe(0)

    // 프로젝트를 새로 열면 읽던 것도 버린다
    const stale = beginCadLoad('cad')
    disposeAllGeometry()
    const fresh = beginCadLoad('cad')
    stale()
    expect(cadMassSummary('cad', objects)?.pendingMeshes).toBe(2)
    fresh()
  })
})
