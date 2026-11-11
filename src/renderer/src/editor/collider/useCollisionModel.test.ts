import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disposeAllGeometry } from '../../scene/geometryRegistry'
import type { SceneObjects } from '../../scene/model'
import { beginChange, endChange } from '../history'
import {
  colliderScene,
  registerBox,
  registerSceneMeshes,
  resetCollisionModels
} from './colliderTestkit'
import { collisionModelEntry, collisionModelFor } from './useCollisionModel'

// 인스펙터·기즈모가 같이 쓰는 충돌 모델 기억(spec-5 §5.4, B16): 같은 문서·형상 판에 한 번, 핸들 드래그 중에는 다시 계산하지
// 않고 닫힐 때 한 번, 무관 편집 뒤 바뀌지 않은 몸체 결과는 같은 객체(몸체 단위 기억은 worldColliders.test.ts가 감시로 본다)

beforeEach(() => {
  resetCollisionModels()
  registerSceneMeshes()
})
afterEach(() => disposeAllGeometry())

describe('collisionModelFor(B16)', () => {
  it('B16 같은 문서·revision이면 같은 모델, 로봇이 아니면 null', () => {
    const objects = colliderScene()
    const first = collisionModelFor(objects, 1, 'R')!
    expect(first).not.toBeNull()
    expect(collisionModelFor(objects, 1, 'R')).toBe(first)
    expect(collisionModelFor(objects, 1, 'base')).toBeNull()
    expect(collisionModelFor(objects, 1, 'nope')).toBeNull()
    // 이름 바꾸기 뒤: 모델은 새 객체지만 몸체 결과는 같은 객체
    const renamed: SceneObjects = { ...objects, base: { ...objects.base, name: 'Base' } }
    const second = collisionModelFor(renamed, 1, 'R')!
    expect(second).not.toBe(first)
    second.bodies.forEach((body, i) => expect(body).toBe(first.bodies[i]))
  })

  it('B16 형상 revision이 바뀌면 다시 계산한다(메시 껍질 등록)', () => {
    const objects = colliderScene()
    disposeAllGeometry()
    const pending = collisionModelFor(objects, 1, 'R')!
    expect(pending.bodies[0].source).toBe('fallback')
    registerSceneMeshes()
    expect(collisionModelFor(objects, 1, 'R')).toBe(pending)
    expect(collisionModelFor(objects, 2, 'R')!.bodies[0].source).toBe('auto')
  })

  it('B16 핸들 드래그 중에는 다시 계산하지 않고(마지막 결과), 닫히면 한 번 계산한다', () => {
    const objects = colliderScene()
    const before = collisionModelEntry(objects, 1, 'R')!
    beginChange()
    try {
      const dragged: SceneObjects = {
        ...objects,
        base: { ...objects.base, transform: { position: [0.3, 0, 0.05], rotation: [0, 0, 0] } }
      }
      expect(collisionModelEntry(dragged, 1, 'R')).toBe(before)
      registerBox('g:base', [0.5, 0.5, 0.1])
      expect(collisionModelEntry(dragged, 2, 'R')).toBe(before)
      endChange()
      const after = collisionModelEntry(dragged, 2, 'R')!
      expect(after).not.toBe(before)
      expect(after.model.bodies[0]).not.toBe(before.model.bodies[0])
    } finally {
      endChange()
    }
  })
})
