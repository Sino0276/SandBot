import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import { buildCollisionModel } from './worldColliders'
import { jointBodyFrames } from './worldJoints'
import type { WorldWarning, WorldWarningKey } from './worldSpec'

// 계약(spec-5 §5.4, K7): 새 경고 키가 WorldWarningKey로 받아지고 ko·en에 문장이 있다. buildCollisionModel은 빈 모델이다
// (5 B가 구현한다).

// 타입 검사: 아래 키가 WorldWarningKey가 아니면 pnpm typecheck가 실패한다
const COLLIDER_WARNINGS: WorldWarningKey[] = [
  'worldColliderPending',
  'worldColliderDegenerate',
  'worldTooManyColliders',
  'worldTooManyWorldColliders',
  'worldJointStartOverlap'
]

describe('충돌 경고 키', () => {
  it('ko·en에 비어 있지 않은 문장이 있다', () => {
    for (const key of COLLIDER_WARNINGS) {
      expect(ko.console.notices[key].length).toBeGreaterThan(0)
      expect(en.console.notices[key].length).toBeGreaterThan(0)
    }
    for (const code of ['collisionOverlap', 'collisionLimit', 'collisionLift'] as const) {
      expect(ko.console.notices.sim[code].length).toBeGreaterThan(0)
      expect(en.console.notices.sim[code].length).toBeGreaterThan(0)
    }
    const warning: WorldWarning = { key: 'worldColliderPending', params: { name: 'Arm', count: 2 } }
    expect(warning.key).toBe('worldColliderPending')
  })
})

describe('buildCollisionModel(계약)', () => {
  it('빈 모델을 돌려준다', () => {
    const objects = {
      R: {
        id: 'R',
        name: 'Robot',
        kind: 'robot' as const,
        parentId: null,
        transform: {
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number]
        }
      }
    }
    expect(
      buildCollisionModel({
        objects,
        robotId: 'R',
        joints: jointBodyFrames(objects, 'R'),
        shapes: () => ({ kind: 'none' }),
        outline: { footprint: [], height: 0.4572 }
      })
    ).toEqual({ bodies: [], pairs: [], staleForced: 0, warnings: [] })
  })
})
