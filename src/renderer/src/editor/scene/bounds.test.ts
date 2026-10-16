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
