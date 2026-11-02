import { BufferGeometry } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import type { MeshMassProps } from '../mass/types'
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
    expect(cadMassSummary('cad')).toBeUndefined()
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

    expect(cadMassSummary(root)).toEqual({
      meshes: 6,
      openMeshes: 2,
      // 질량에 쓰는 부피 10e-6 가운데 열린 메시 3e-6
      openVolumeFraction: expect.closeTo(0.3, 12),
      surfaceMeshes: 2,
      pendingMeshes: 0
    })
    expect(cadMassSummary('other')).toMatchObject({ meshes: 1, surfaceMeshes: 1 })
    expect(cadMassSummary('g-arm')).toBeUndefined()
    expect(cadMassSummary('missing')).toBeUndefined()

    disposeGeometry(`${root}:1`)
    expect(cadMassSummary(root)).toMatchObject({ meshes: 5, openMeshes: 1 })
  })

  it('질량에 쓰는 메시가 없으면 열린 비율은 0이다', () => {
    registerGeometry('cad:0', new BufferGeometry(), { mass: mass(0, Infinity) })
    registerGeometry('cad:1', new BufferGeometry())
    expect(cadMassSummary('cad')).toEqual({
      meshes: 2,
      openMeshes: 0,
      openVolumeFraction: 0,
      surfaceMeshes: 1,
      pendingMeshes: 0
    })
  })

  it('읽는 동안 아직 등록하지 않은 메시를 pendingMeshes로 센다', () => {
    const end = beginCadLoad('cad', 3)
    expect(cadMassSummary('cad')).toEqual({
      meshes: 0,
      openMeshes: 0,
      openVolumeFraction: 0,
      surfaceMeshes: 0,
      pendingMeshes: 3
    })
    // 다시 읽는 동안에는 이전 형상이 남아 있어 그만큼 빠진다
    registerGeometry('cad:0', new BufferGeometry(), { mass: mass(1e-6, 0) })
    expect(cadMassSummary('cad')?.pendingMeshes).toBe(2)
    end()
    expect(cadMassSummary('cad')?.pendingMeshes).toBe(0)
  })

  it('늦게 끝난 이전 읽기는 새 읽기의 상태를 지우지 않는다', () => {
    const first = beginCadLoad('cad', 2)
    const second = beginCadLoad('cad', 4)
    first()
    expect(cadMassSummary('cad')?.pendingMeshes).toBe(4)
    second()
    expect(cadMassSummary('cad')).toBeUndefined()

    // 프로젝트를 새로 열면 읽던 것도 버린다
    const stale = beginCadLoad('cad', 2)
    disposeAllGeometry()
    const fresh = beginCadLoad('cad', 5)
    stale()
    expect(cadMassSummary('cad')?.pendingMeshes).toBe(5)
    fresh()
  })
})
