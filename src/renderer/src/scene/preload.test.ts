import { describe, expect, it } from 'vitest'
import type { SceneObject, SceneObjects } from './model'
import {
  canAddPreload,
  canHavePreload,
  defaultPreload,
  isWellFormedPreload,
  MAX_ROBOT_PRELOADS,
  preloadEnabled,
  robotPreloadIds,
  samePreload,
  sanitizePreload
} from './preload'

// 6a 계약: 프리로드 자리(Preload Slot) 정리·비교·로봇마다 한도

const object = (id: string, kind: SceneObject['kind'], parentId: string | null): SceneObject => ({
  id,
  name: id,
  kind,
  parentId,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
})

describe('프리로드 자리', () => {
  it('group·assembly·part에만(로봇·CAD 루트는 아님)', () => {
    expect(canHavePreload(object('g', 'group', 'r'))).toBe(true)
    expect(canHavePreload(object('p', 'part', 'r'))).toBe(true)
    expect(canHavePreload(object('a', 'assembly', 'r'))).toBe(true)
    expect(canHavePreload(object('r', 'robot', null))).toBe(false)
    const cadRoot = {
      ...object('c', 'assembly', 'r'),
      cad: {
        fileName: 'a.step',
        absolutePath: '/a.step',
        upAxis: '+Y' as const,
        forwardAxis: '+Z' as const,
        bounds: {
          min: [0, 0, 0] as [number, number, number],
          max: [1, 1, 1] as [number, number, number]
        },
        meshCount: 1
      }
    }
    expect(canHavePreload(cadRoot)).toBe(false)
  })

  it('정리: center를 ±10 m로 자르고 −0을 없애며 키 순서 kind, enabled?, center', () => {
    const clean = sanitizePreload({ kind: 'pollen', enabled: false, center: [11, -0, -0.5] })
    expect(clean).toEqual({ kind: 'pollen', enabled: false, center: [10, 0, -0.5] })
    expect(Object.is(clean.center[1], -0)).toBe(false)
    expect(Object.keys(clean)).toEqual(['kind', 'enabled', 'center'])
    expect(Object.keys(sanitizePreload(defaultPreload()))).toEqual(['kind', 'center'])
  })

  it('형식·비교·켬', () => {
    expect(isWellFormedPreload(defaultPreload())).toBe(true)
    expect(isWellFormedPreload({ kind: 'pollen', center: [0, Infinity, 0] })).toBe(false)
    expect(isWellFormedPreload({ kind: 'pollen', center: [0, 0] as unknown as [0, 0, 0] })).toBe(
      false
    )
    expect(samePreload(undefined, undefined)).toBe(true)
    expect(samePreload(defaultPreload(), undefined)).toBe(false)
    expect(samePreload(defaultPreload(), { kind: 'pollen', center: [0, 0, 0] })).toBe(true)
    expect(
      samePreload(defaultPreload(), { kind: 'pollen', enabled: false, center: [0, 0, 0] })
    ).toBe(false)
    expect(preloadEnabled({ kind: 'pollen', enabled: false, center: [0, 0, 0] })).toBe(false)
  })

  it('로봇마다 MAX_ROBOT_PRELOADS개까지 Add Component, 순서는 하이어라키 순서', () => {
    expect(MAX_ROBOT_PRELOADS).toBe(4)
    const scene: SceneObjects = {
      r: object('r', 'robot', null),
      lone: object('lone', 'group', null)
    }
    for (let i = 0; i < 5; i++) scene[`g${i}`] = object(`g${i}`, 'group', 'r')
    scene.inner = object('inner', 'part', 'g0')
    const withPreload = (s: SceneObjects, id: string): SceneObjects => ({
      ...s,
      [id]: { ...s[id], preload: defaultPreload() }
    })
    let s = withPreload(withPreload(scene, 'g1'), 'inner')
    expect(robotPreloadIds(s, 'r')).toEqual(['inner', 'g1'])
    expect(canAddPreload(s, 'g1')).toBe(false)
    expect(canAddPreload(s, 'r')).toBe(false)
    expect(canAddPreload(s, 'g2')).toBe(true)
    s = withPreload(withPreload(s, 'g2'), 'g3')
    expect(canAddPreload(s, 'g4')).toBe(false)
    // 로봇 밖 오브젝트는 세지 않는다
    expect(canAddPreload(s, 'lone')).toBe(true)
  })
})
