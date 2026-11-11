import { BufferAttribute, BufferGeometry } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { meshHullOf } from '../cad/stepImport'
import { disposeAllGeometry, disposeGeometry, meshHull, registerGeometry } from './geometryRegistry'
import { PLACEHOLDER_BOUNDS } from './localBounds'
import { objectHullPoints } from './meshHull'
import type { SceneObjects } from './model'

// 오브젝트의 충돌 형상 점(spec-5 §5.3, B9): 메시는 STEP 워커가 만든 메시 껍질을 읽기만 하고(렌더러 메인 스레드는 position을
// 훑지 않는다), 임시 모양은 상자 8꼭짓점, 형상이 없으면 읽는 중이다.

afterEach(() => disposeAllGeometry())

const SCENE: SceneObjects = {
  R: {
    id: 'R',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    visual: { type: 'placeholder', shape: 'robot' }
  },
  cam: {
    id: 'cam',
    name: 'Webcam',
    kind: 'part',
    parentId: 'R',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    visual: { type: 'placeholder', shape: 'webcam' }
  },
  part: {
    id: 'part',
    name: 'Part',
    kind: 'part',
    parentId: 'R',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: 'g:part', color: [1, 1, 1] }
  },
  group: {
    id: 'group',
    name: 'Group',
    kind: 'group',
    parentId: 'R',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  }
}

// position 읽기를 세는 형상(정육면체 꼭짓점 8): 속성 배열과 getAttribute 접근을 센다
function watchedGeometry(): { geometry: BufferGeometry; reads: () => number } {
  const positions = new Float32Array(24)
  for (let k = 0; k < 8; k++) {
    positions[3 * k] = k & 1 ? 0.05 : -0.05
    positions[3 * k + 1] = k & 2 ? 0.05 : -0.05
    positions[3 * k + 2] = k & 4 ? 0.05 : -0.05
  }
  let count = 0
  const attribute = new BufferAttribute(positions, 3)
  Object.defineProperty(attribute, 'array', {
    get: () => {
      count++
      return positions
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', attribute)
  const getAttribute = geometry.getAttribute.bind(geometry)
  geometry.getAttribute = ((name: string) => {
    count++
    return getAttribute(name)
  }) as typeof geometry.getAttribute
  return { geometry, reads: () => count }
}

describe('objectHullPoints(B9)', () => {
  it('B9 등록된 메시 껍질을 읽기만 한다(position 접근 0), 같은 껍질이면 같은 결과 객체', () => {
    const { geometry, reads } = watchedGeometry()
    const hull = meshHullOf(
      new Float32Array(
        [...Array(8).keys()].flatMap((k) => [
          k & 1 ? 0.05 : -0.05,
          k & 2 ? 0.05 : -0.05,
          k & 4 ? 0.05 : -0.05
        ])
      )
    )
    hull.error = 0.0004
    registerGeometry('g:part', geometry, { hull })
    const before = reads()
    const result = objectHullPoints(SCENE, 'part')
    expect(reads()).toBe(before)
    expect(result.kind).toBe('points')
    if (result.kind !== 'points') return
    expect(result.points).toHaveLength(8)
    expect(result.error).toBe(0.0004)
    expect(objectHullPoints(SCENE, 'part')).toBe(result)
    expect(meshHull('g:part')).toBe(hull)
  })

  it('B9 형상이 없으면 읽는 중, 껍질이 퇴화면 degenerate, 모양이 없으면 none', () => {
    expect(objectHullPoints(SCENE, 'part')).toEqual({ kind: 'pending' })
    registerGeometry('g:part', new BufferGeometry(), { hull: { points: [], error: 0 } })
    expect(objectHullPoints(SCENE, 'part')).toEqual({ kind: 'degenerate' })
    // 형상을 지우면 껍질도 같이 지워진다(같은 id·수명)
    disposeGeometry('g:part')
    expect(meshHull('g:part')).toBeUndefined()
    expect(objectHullPoints(SCENE, 'part')).toEqual({ kind: 'pending' })
    expect(objectHullPoints(SCENE, 'group')).toEqual({ kind: 'none' })
    expect(objectHullPoints(SCENE, 'nope')).toEqual({ kind: 'none' })
  })

  it('B9 임시 모양은 PLACEHOLDER_BOUNDS 상자 8꼭짓점(오차 0)', () => {
    for (const [id, shape] of [
      ['R', 'robot'],
      ['cam', 'webcam']
    ] as const) {
      const result = objectHullPoints(SCENE, id)
      if (result.kind !== 'points') throw new Error(id)
      const { min, max } = PLACEHOLDER_BOUNDS[shape]
      expect(result.error).toBe(0)
      expect(result.points).toHaveLength(8)
      expect(Math.min(...result.points.map((p) => p.x))).toBe(min.x)
      expect(Math.max(...result.points.map((p) => p.z))).toBe(max.z)
    }
  })
})
