import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ROBOT_SIZE } from '../../scene/coordinates'
import type { SceneObjects } from '../../scene/model'
import { objectWorldBounds, selectionWorldBounds } from './bounds'

// 임시 모양(로봇 상자·웹캠)과 모양 없는 그룹 둘
const objects: SceneObjects = {
  robot: {
    id: 'robot',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [1, 0, 0], rotation: [0, 0, 0] },
    visual: { type: 'placeholder', shape: 'robot' }
  },
  webcam: {
    id: 'webcam',
    name: 'Webcam',
    kind: 'part',
    parentId: 'robot',
    transform: { position: [0.2, 0, 0.3], rotation: [0, 0, 0] },
    visual: { type: 'placeholder', shape: 'webcam' }
  },
  far: {
    id: 'far',
    name: 'Far',
    kind: 'group',
    parentId: null,
    transform: { position: [-2, 0, 0], rotation: [0, 0, 0] }
  },
  near: {
    id: 'near',
    name: 'Near',
    kind: 'group',
    parentId: null,
    transform: { position: [0, 3, 0], rotation: [0, 0, 0] }
  }
}

describe('selectionWorldBounds(F 키의 선택 전체)', () => {
  it('하나면 그 오브젝트의 경계와 같다', () => {
    expect(selectionWorldBounds(objects, ['robot'])).toEqual(objectWorldBounds(objects, 'robot'))
  })

  it('여러 오브젝트의 경계를 합치고, 모양이 없는 오브젝트는 위치 한 점으로 넣는다', () => {
    const bounds = selectionWorldBounds(objects, ['webcam', 'far', 'near'])!
    const webcam = objectWorldBounds(objects, 'webcam')!
    expect(bounds.min.x).toBeCloseTo(-2)
    expect(bounds.max.x).toBeCloseTo(webcam.max.x)
    expect(bounds.max.y).toBeCloseTo(3)
    expect(bounds.min.z).toBeCloseTo(0)
    expect(bounds.max.z).toBeCloseTo(webcam.max.z)
  })

  it('하위가 함께 선택되어도 결과가 같고, 없는 id는 빼며, 하나도 없으면 null이다', () => {
    const robot = objectWorldBounds(objects, 'robot')!
    expect(robot.max.z).toBeCloseTo(ROBOT_SIZE)
    expect(selectionWorldBounds(objects, ['webcam', 'robot', 'gone'])).toEqual(robot)
    expect(selectionWorldBounds(objects, ['gone'])).toBeNull()
    expect(selectionWorldBounds(objects, [])).toBeNull()
  })
})

describe('실행 중 표시 자세(rootOverride)', () => {
  // 로봇을 필드 (−1, 2)에서 왼쪽(+Y)을 보게 그린다
  const override = {
    id: 'robot',
    transform: {
      position: [-1, 2, 0] as [number, number, number],
      rotation: [0, 0, Math.PI / 2] as [number, number, number]
    }
  }

  it('F는 문서 자세가 아니라 표시 자세로 간다(하위 포함)', () => {
    const shown = selectionWorldBounds(objects, ['webcam'], override)!
    const center = shown.getCenter(new Vector3())
    // 웹캠은 로봇 앞 0.2 m(돌린 로봇에서는 +Y), 높이 0.3 m
    expect(center.x).toBeCloseTo(-1, 2)
    expect(center.y).toBeGreaterThan(2.15)
    expect(center.z).toBeCloseTo(0.3, 2)
    // 덮어쓰기와 관계없는 오브젝트는 그대로
    expect(selectionWorldBounds(objects, ['far'], override)).toEqual(
      selectionWorldBounds(objects, ['far'])
    )
  })

  it('include로 고른 오브젝트만 넣는다', () => {
    const robotOnly = objectWorldBounds(objects, 'robot', null, (id) => id === 'robot')!
    expect(robotOnly.max.x).toBeCloseTo(1 + ROBOT_SIZE / 2)
    expect(objectWorldBounds(objects, 'robot', null, () => false)).toBeNull()
  })
})
