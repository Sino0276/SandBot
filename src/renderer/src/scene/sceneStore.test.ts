import type { Matrix4 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { cadRootTransform } from '../cad/alignment'
import { clearHistory, initHistory, undo, useHistoryStore } from '../editor/history'
import { childrenInDocument, worldMatrix, type SceneObjects, type Vec3 } from './model'
import { isPlaceholderScene, useSceneStore } from './sceneStore'
import { defaultWheel } from './wheel'

const BOUNDS: { min: Vec3; max: Vec3 } = { min: [-0.2, 0, -0.1], max: [0.2, 0.3, 0.1] }

// 로봇 아래 Y-up CAD 루트 C와 파트 두 개, 그룹 G
const objects: SceneObjects = {
  R: {
    id: 'R',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0.5, 0, 0], rotation: [0, 0, 0.4] }
  },
  C: {
    id: 'C',
    name: 'robot',
    kind: 'assembly',
    parentId: 'R',
    transform: cadRootTransform(BOUNDS, { upAxis: '+Y', forwardAxis: '+Z' }),
    cad: {
      fileName: 'robot.step',
      absolutePath: '/cad/robot.step',
      upAxis: '+Y',
      forwardAxis: '+Z',
      bounds: BOUNDS,
      meshCount: 2,
      meshIndexing: 'source'
    }
  },
  P1: {
    id: 'P1',
    name: 'P1',
    kind: 'part',
    parentId: 'C',
    transform: { position: [0.1, 0.05, 0], rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: 'C:0', color: [1, 1, 1] }
  },
  P2: {
    id: 'P2',
    name: 'P2',
    kind: 'part',
    parentId: 'C',
    transform: { position: [-0.1, 0.05, 0], rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: 'C:1', color: [1, 1, 1] }
  },
  G: {
    id: 'G',
    name: 'Lift',
    kind: 'group',
    parentId: 'R',
    transform: { position: [0, 0.1, 0.2], rotation: [0.1, 0, 0.3] }
  }
}

const state = (): ReturnType<typeof useSceneStore.getState> => useSceneStore.getState()

function maxDifference(a: Matrix4, b: Matrix4): number {
  return Math.max(...a.elements.map((value, i) => Math.abs(value - b.elements[i])))
}

// CAD 루트 기준 자세
function relativeToCad(scene: SceneObjects, id: string): Matrix4 {
  return worldMatrix(scene, 'C').invert().multiply(worldMatrix(scene, id))
}

describe('임시 씬 판정', () => {
  const placeholder = (): SceneObjects => {
    useSceneStore.setState({ objects: useSceneStore.getInitialState().objects })
    return state().objects
  }

  it('처음 씬과, 빈 그룹만 더한 씬은 임시 씬이다', () => {
    const initial = placeholder()
    expect(isPlaceholderScene(initial)).toBe(true)
    const id = state().createGroup({ parentId: 'robot' })
    expect(id).not.toBeNull()
    expect(state().moveObjects(['webcam'], id!)).toBe(true)
    expect(isPlaceholderScene(state().objects)).toBe(true)
  })

  it('그룹에 하드웨어를 붙이면 임시 씬이 아니다', () => {
    placeholder()
    const id = state().createGroup({ parentId: 'robot' })!
    state().addComponent(id, {
      id: 'm1',
      type: 'motor',
      name: 'lift',
      hub: 'controlHub',
      port: 0,
      props: {}
    })
    expect(isPlaceholderScene(state().objects)).toBe(false)
  })

  it('CAD 메시가 있으면 임시 씬이 아니다', () => {
    expect(isPlaceholderScene(objects)).toBe(false)
  })

  it('임시 씬의 빈 그룹은 첫 STEP 임포트 때 함께 사라진다', () => {
    placeholder()
    state().createGroup({ parentId: 'robot' })
    state().addObjects({ r: { ...objects.robot, id: 'r' } })
    expect(Object.keys(state().objects)).toEqual(['r'])
  })

  it('로봇을 모두 지운 뒤 만든 그룹은 STEP 임포트 때 지우지 않는다', () => {
    state().replaceObjects({})
    const group = state().createGroup({ parentId: null, name: 'Field Elements' })!
    expect(isPlaceholderScene(state().objects)).toBe(true)
    state().addObjects({ r: { ...objects.robot, id: 'r' } })
    expect(Object.keys(state().objects)).toEqual([group, 'r'])
  })
})

describe('하이어라키 편집 액션', () => {
  beforeEach(() => state().replaceObjects(objects))

  it('Create Empty: 기본 이름과 id를 정하고, 부모 원점에 둔다', () => {
    const first = state().createGroup({ parentId: 'R' })!
    const second = state().createGroup({ parentId: 'R', afterId: 'C' })!
    expect(state().objects[first].name).toBe('Group')
    expect(state().objects[second].name).toBe('Group (1)')
    expect(childrenInDocument(state().objects, 'R').map((o) => o.id)).toEqual([
      'C',
      second,
      'G',
      first
    ])
    expect(state().createGroup({ parentId: 'nope' })).toBeNull()
  })

  it('Create Empty Parent: 선택을 새 그룹으로 묶고 이름과 id를 돌려준다', () => {
    const id = state().createEmptyParent(['P2', 'P1'], 'P2')!
    const scene = state().objects
    expect(scene[id]).toMatchObject({ kind: 'group', name: 'Group', parentId: 'C' })
    expect(childrenInDocument(scene, id).map((o) => o.id)).toEqual(['P1', 'P2'])
    expect(state().createEmptyParent(['P1', 'G'], 'P1')).toBeNull()
  })

  it('옮기기·이름 바꾸기·여러 개 지우기', () => {
    expect(state().moveObjects(['P1'], 'G')).toBe(true)
    expect(state().objects.P1.cadOrigin).toBe('C')
    expect(state().moveObjects(['C'], 'G')).toBe(false)
    state().renameObject('G', ' Arm ')
    expect(state().objects.G.name).toBe('Arm')
    // CAD 루트를 지우면 밖으로 옮긴 파트도 지운다
    state().removeObjects(['C'])
    expect(Object.keys(state().objects)).toEqual(['R', 'G'])
    state().removeObject('G')
    expect(Object.keys(state().objects)).toEqual(['R'])
  })

  it('그룹의 Java 클래스 이름: 공백을 자르고, 비우면 필드를 지우며, 그룹에만 쓴다', () => {
    state().setCodeClassName('G', '  Lift ')
    expect(state().objects.G.codeClassName).toBe('Lift')
    const before = state().objects
    state().setCodeClassName('G', 'Lift')
    expect(state().objects).toBe(before)
    state().setCodeClassName('G', '   ')
    expect('codeClassName' in state().objects.G).toBe(false)
    state().setCodeClassName('G', 'Arm')
    state().setCodeClassName('G', null)
    expect('codeClassName' in state().objects.G).toBe(false)
    const unchanged = state().objects
    state().setCodeClassName('C', 'Lift')
    state().setCodeClassName('nope', 'Lift')
    expect(state().objects).toBe(unchanged)
  })

  it('정렬을 바꾸면 밖으로 옮긴 파트도 CAD 안 자리를 지키며 따라간다', () => {
    state().moveObjects(['P1'], 'G')
    const before = state().objects
    state().setCadAlignment('C', { upAxis: '+X', forwardAxis: '-Z' })
    const after = state().objects
    expect(maxDifference(relativeToCad(after, 'P1'), relativeToCad(before, 'P1'))).toBeLessThan(
      1e-9
    )
    expect(maxDifference(worldMatrix(after, 'P1'), worldMatrix(before, 'P1'))).toBeGreaterThan(1e-3)
    expect(after.G).toBe(before.G)
  })

  it('CAD 루트를 직접 옮겨도 따라가고, 다른 오브젝트를 옮길 때는 그대로다', () => {
    state().moveObjects(['P1'], 'G')
    const before = state().objects
    const { rotation } = before.C.transform
    state().setLocalTransform('C', { position: [0.3, 0.1, 0.2], rotation })
    const after = state().objects
    expect(maxDifference(relativeToCad(after, 'P1'), relativeToCad(before, 'P1'))).toBeLessThan(
      1e-9
    )
    state().setLocalTransform('G', { position: [0, 0, 0], rotation: [0, 0, 0] })
    expect(state().objects.C).toBe(after.C)
    // P1은 G의 자식이라 로컬 값이 그대로다
    expect(state().objects.P1).toBe(after.P1)
  })
})

describe('스크립트 연결', () => {
  beforeEach(() => state().replaceObjects(objects))

  const LIFT = {
    path: 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java',
    className: 'org.firstinspires.ftc.teamcode.Lift'
  }
  const ARM = {
    path: 'src/main/java/org/firstinspires/ftc/teamcode/Arm.java',
    className: 'org.firstinspires.ftc.teamcode.Arm'
  }
  const MOVED = {
    path: 'src/main/java/org/firstinspires/ftc/teamcode/mech/Lift.java',
    className: 'org.firstinspires.ftc.teamcode.mech.Lift'
  }

  it('한 오브젝트에 여럿을 연결하고, 같은 경로는 한 번만 둔다', () => {
    state().addScriptLink('G', LIFT)
    state().addScriptLink('G', ARM)
    const before = state().objects
    state().addScriptLink('G', { ...LIFT })
    state().addScriptLink('nope', LIFT)
    expect(state().objects).toBe(before)
    expect(state().objects.G.scripts).toEqual([LIFT, ARM])
    // 다른 오브젝트는 같은 파일을 따로 연결할 수 있다
    state().addScriptLink('P1', LIFT)
    expect(state().objects.P1.scripts).toEqual([LIFT])
    expect(state().objects.G).toBe(before.G)
  })

  it('지우면 그 연결만 빠지고, 마지막 연결을 지우면 필드를 지운다', () => {
    state().addScriptLink('G', LIFT)
    state().addScriptLink('G', ARM)
    state().removeScriptLink('G', LIFT.path)
    expect(state().objects.G.scripts).toEqual([ARM])
    const before = state().objects
    state().removeScriptLink('G', LIFT.path)
    expect(state().objects).toBe(before)
    state().removeScriptLink('G', ARM.path)
    expect('scripts' in state().objects.G).toBe(false)
  })

  it('다시 연결은 같은 자리에서 바꾸고, 새 경로가 이미 있으면 이전 연결만 지운다', () => {
    state().addScriptLink('G', LIFT)
    state().addScriptLink('G', ARM)
    state().relinkScript('G', LIFT.path, MOVED)
    expect(state().objects.G.scripts).toEqual([MOVED, ARM])
    const before = state().objects
    state().relinkScript('G', MOVED.path, MOVED)
    state().relinkScript('G', LIFT.path, MOVED)
    expect(state().objects).toBe(before)
    state().relinkScript('G', MOVED.path, ARM)
    expect(state().objects.G.scripts).toEqual([ARM])
  })

  it('연결할 수 없는 경로는 연결하지 않고, 경로는 NFC로 둔다', () => {
    state().addScriptLink('G', LIFT)
    const before = state().objects
    for (const path of [
      '../Lift.java',
      'src/main/java/org/firstinspires/ftc/teamcode/sandbot/RobotHardware.java',
      'src/main/java/org/firstinspires/ftc/teamcode/CON.java',
      'src/main/java/Lift.txt'
    ]) {
      state().addScriptLink('G', { path, className: 'X' })
      state().relinkScript('G', LIFT.path, { path, className: 'X' })
    }
    expect(state().objects).toBe(before)
    state().removeScriptLink('G', LIFT.path)
    const korean = 'src/main/java/org/firstinspires/ftc/teamcode/리프트.java'.normalize('NFC')
    state().addScriptLink('G', { path: korean.normalize('NFD'), className: 'x.리프트' })
    expect(state().objects.G.scripts).toEqual([{ path: korean, className: 'x.리프트' }])
    // 이미 있는 경로는 NFD로 와도 같은 경로다
    const linked = state().objects
    state().addScriptLink('G', { path: korean.normalize('NFD'), className: 'x.리프트' })
    expect(state().objects).toBe(linked)
  })

  it('하이어라키로 옮기거나 묶어도 연결은 오브젝트를 따라간다', () => {
    state().addScriptLink('P1', LIFT)
    state().moveObjects(['P1'], 'G')
    expect(state().objects.P1.scripts).toEqual([LIFT])
    const group = state().createEmptyParent(['P1'], 'P1')!
    expect(state().objects[group].scripts).toBeUndefined()
    expect(state().objects.P1.scripts).toEqual([LIFT])
  })

  it('스크립트를 연결한 씬은 임시 씬이 아니다', () => {
    useSceneStore.setState({ objects: useSceneStore.getInitialState().objects })
    expect(isPlaceholderScene(state().objects)).toBe(true)
    state().addScriptLink('webcam', LIFT)
    expect(isPlaceholderScene(state().objects)).toBe(false)
    const group = state().createGroup({ parentId: 'robot' })!
    state().removeScriptLink('webcam', LIFT.path)
    state().addScriptLink(group, LIFT)
    expect(isPlaceholderScene(state().objects)).toBe(false)
    state().removeScriptLink(group, LIFT.path)
    expect(isPlaceholderScene(state().objects)).toBe(true)
  })
})

describe('바퀴', () => {
  beforeEach(() => {
    initHistory()
    state().replaceObjects(objects)
    clearHistory()
  })

  it('파트·그룹에 붙이고 바꾸고 떼며, 각 변경은 실행 취소 한 단계다', () => {
    const before = state().objects
    state().setWheel('P1', defaultWheel())
    expect(state().objects.P1.wheel).toEqual(defaultWheel())
    // 다른 오브젝트는 그대로(불변 문서)
    expect(state().objects.P2).toBe(before.P2)
    expect(before.P1.wheel).toBeUndefined()
    state().setWheel('P1', { ...defaultWheel(), motor: 'm', gearRatio: 2 })
    state().setWheel('G', defaultWheel('omni'))
    expect(state().objects.G.wheel?.diameter).toBe(0.096)
    state().setWheel('P1', null)
    expect(state().objects.P1).not.toHaveProperty('wheel')

    expect(undo()).toBe(true)
    expect(state().objects.P1.wheel).toMatchObject({ motor: 'm', gearRatio: 2 })
    expect(undo()).toBe(true)
    expect(state().objects.G.wheel).toBeUndefined()
    expect(undo()).toBe(true)
    expect(state().objects.P1.wheel).toEqual(defaultWheel())
    expect(undo()).toBe(true)
    expect(state().objects).toBe(before)
  })

  it('로봇·CAD 루트·없는 오브젝트는 거부하고, 바뀐 것이 없으면 씬을 그대로 둔다', () => {
    const before = state().objects
    state().setWheel('R', defaultWheel())
    state().setWheel('C', defaultWheel())
    state().setWheel('nope', defaultWheel())
    state().setWheel('P1', null)
    expect(state().objects).toBe(before)
    state().setWheel('P1', defaultWheel())
    const withWheel = state().objects
    state().setWheel('P1', { ...defaultWheel() })
    expect(state().objects).toBe(withWheel)
    expect(useHistoryStore.getState().canUndo).toBe(true)
    expect(undo()).toBe(true)
    expect(undo()).toBe(false)
  })

  it('범위 밖 수는 기본값으로 바꾸고 각은 감아 둔다', () => {
    state().setWheel('P1', {
      ...defaultWheel('traction'),
      diameter: 0,
      gearRatio: Number.NaN,
      angle: (3 * Math.PI) / 2
    })
    expect(state().objects.P1.wheel).toMatchObject({
      diameter: 0.096,
      gearRatio: 1,
      angle: -Math.PI / 2
    })
  })

  it('바퀴를 붙인 씬은 임시 씬이 아니다', () => {
    state().replaceObjects({ G: { ...objects.G, parentId: null } })
    expect(isPlaceholderScene(state().objects)).toBe(true)
    state().setWheel('G', defaultWheel())
    expect(isPlaceholderScene(state().objects)).toBe(false)
  })
})
