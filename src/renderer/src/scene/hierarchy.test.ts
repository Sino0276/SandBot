import type { Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'
import { cadRootTransform } from '../cad/alignment'
import {
  cadDependents,
  cadOriginOf,
  canCreateEmptyParent,
  canMoveObjects,
  carryCadDependents,
  createEmptyParent,
  createGroup,
  defaultGroupName,
  extraRemovalIds,
  moveObjects,
  moveRejection,
  removalIds,
  removeObjects,
  renameObject,
  selectionRoots
} from './hierarchy'
import {
  childrenInDocument,
  matrixToTransform,
  transformToMatrix,
  worldMatrix,
  type SceneObject,
  type SceneObjects,
  type Transform,
  type Vec3
} from './model'

const DEG = Math.PI / 180
const BOUNDS: { min: Vec3; max: Vec3 } = { min: [-0.2, 0, -0.1], max: [0.2, 0.3, 0.1] }

// 입력 문서를 고치면 바로 실패하도록 깊게 얼린다(불러온 CAD 노드들이 회전 배열을 함께 쓰는 것도 흉내 낸다)
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

const SHARED_ROTATION: Transform['rotation'] = [0, 0, 0]

function node(
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  position: Transform['position'],
  rotation: Transform['rotation'] = SHARED_ROTATION,
  extra: Partial<SceneObject> = {}
): SceneObject {
  return { id, name: id, kind, parentId, transform: { position, rotation }, ...extra }
}

function cad(fileName: string): SceneObject['cad'] {
  return {
    fileName,
    absolutePath: `/cad/${fileName}`,
    upAxis: '+Y',
    forwardAxis: '+Z',
    bounds: BOUNDS,
    meshCount: 3,
    meshIndexing: 'source'
  }
}

const mesh = (geometryId: string): SceneObject['visual'] => ({
  type: 'mesh',
  geometryId,
  color: [0.5, 0.5, 0.5]
})

const motor = {
  id: 'm1',
  type: 'motor',
  name: 'lift',
  hub: 'controlHub' as const,
  port: 0,
  props: {}
}

// 로봇 R(필드 위에서 30° 돌아 있음) 아래에 Y-up CAD 루트 C(정렬 회전)와 어셈블리 A, 파트들, 두 번째 CAD 루트 D,
// 회전한 그룹 G가 있다. 다른 로봇 R2와 로봇 밖 오브젝트 cone도 있다.
function scene(): SceneObjects {
  return deepFreeze({
    R: node('R', 'robot', null, [1, 2, 0], [0, 0, 30 * DEG]),
    C: node(
      'C',
      'assembly',
      'R',
      cadRootTransform(BOUNDS, { upAxis: '+Y', forwardAxis: '+Z' }).position,
      cadRootTransform(BOUNDS, { upAxis: '+Y', forwardAxis: '+Z' }).rotation,
      { cad: cad('robot.step') }
    ),
    A: node('A', 'assembly', 'C', [0.1, 0.05, 0]),
    P1: node('P1', 'part', 'A', [0.02, 0, 0.01], SHARED_ROTATION, { visual: mesh('C:0') }),
    P2: node('P2', 'part', 'A', [-0.02, 0, 0.01], SHARED_ROTATION, { visual: mesh('C:1') }),
    P3: node('P3', 'part', 'C', [0, 0.1, -0.05], SHARED_ROTATION, {
      visual: mesh('C:2'),
      components: [motor]
    }),
    D: node('D', 'assembly', 'R', [0, 0, 0.3], [0, 0, 0], { cad: cad('arm.step') }),
    B: node('B', 'assembly', 'D', [0.05, 0, 0]),
    Q1: node('Q1', 'part', 'B', [0, 0.01, 0], SHARED_ROTATION, { visual: mesh('D:0') }),
    G: node('G', 'group', 'R', [0.05, -0.1, 0.1], [0.2, -0.3, 1.0]),
    R2: node('R2', 'robot', null, [-1, 0, 0]),
    cone: node('cone', 'part', null, [0.5, 0.5, 0])
  })
}

function maxDifference(a: Matrix4, b: Matrix4): number {
  return Math.max(...a.elements.map((value, i) => Math.abs(value - b.elements[i])))
}

function expectSameWorld(before: SceneObjects, after: SceneObjects, ids: string[]): void {
  for (const id of ids) {
    expect(maxDifference(worldMatrix(after, id), worldMatrix(before, id))).toBeLessThan(1e-9)
  }
}

// CAD 루트 기준 자세(정렬이 바뀌어도 CAD 안 자리는 그대로여야 한다)
function relativeTo(objects: SceneObjects, rootId: string, id: string): Matrix4 {
  return worldMatrix(objects, rootId).invert().multiply(worldMatrix(objects, id))
}

const childIds = (objects: SceneObjects, parentId: string | null): string[] =>
  childrenInDocument(objects, parentId).map((object) => object.id)

describe('옮길 수 있는 곳', () => {
  const objects = scene()

  it('로봇은 최상위에서 순서만 바꾼다', () => {
    expect(moveRejection(objects, ['R'], 'G')).toBe('robot')
    expect(canMoveObjects(objects, ['R2'], null, 'R')).toBe(true)
  })

  it('CAD 루트는 지금 부모 안에서 순서만 바꾼다', () => {
    expect(moveRejection(objects, ['C'], 'G')).toBe('cadRoot')
    expect(moveRejection(objects, ['C'], 'D')).toBe('cadRoot')
    expect(canMoveObjects(objects, ['C'], 'R', 'G')).toBe(true)
  })

  it('자기 자신이나 하위 아래로는 옮기지 않는다', () => {
    expect(moveRejection(objects, ['A'], 'A')).toBe('descendant')
    expect(moveRejection(objects, ['A'], 'P1')).toBe('descendant')
  })

  it('소속 로봇이 바뀌는 곳으로는 옮기지 않는다(로봇 밖 오브젝트끼리는 루트도 된다)', () => {
    expect(moveRejection(objects, ['P1'], 'R2')).toBe('otherRobot')
    expect(moveRejection(objects, ['P1'], null)).toBe('otherRobot')
    expect(moveRejection(objects, ['cone'], 'R')).toBe('otherRobot')
    expect(canMoveObjects(objects, ['cone'], null, 'R')).toBe(true)
  })

  it('beforeId는 새 부모의 자식이고 옮기는 오브젝트가 아니어야 한다', () => {
    expect(moveRejection(objects, ['P1'], 'R', 'P2')).toBe('before')
    expect(moveRejection(objects, ['P1', 'P2'], 'A', 'P2')).toBe('before')
    expect(moveRejection(objects, ['P1'], 'R', 'nope')).toBe('missing')
    expect(moveRejection(objects, ['nope'], 'R')).toBe('missing')
    expect(moveRejection(objects, [], 'R')).toBe('empty')
  })

  it('다른 선택의 하위는 빼고, 하나라도 안 되면 전체를 거부한다', () => {
    expect(selectionRoots(objects, ['P1', 'C', 'P1', 'G'])).toEqual(['C', 'G'])
    // P1은 C의 하위라 빠지고, C는 G 아래로 갈 수 없다
    expect(moveRejection(objects, ['P1', 'C'], 'G')).toBe('cadRoot')
    expect(moveRejection(objects, ['P3', 'R'], 'G')).toBe('robot')
    expect(moveObjects(objects, ['P3', 'R'], 'G')).toBe(objects)
  })
})

describe('부모 바꾸기', () => {
  it('회전한 CAD 루트 밖으로 옮겨도 월드 자세가 그대로다', () => {
    const before = scene()
    const after = moveObjects(before, ['P1', 'A'], 'R')
    expect(after).not.toBe(before)
    expect(after.A.parentId).toBe('R')
    // P1은 A의 하위라 A와 함께 옮겨진다
    expect(after.P1.parentId).toBe('A')
    expectSameWorld(before, after, ['A', 'P1', 'P2'])
  })

  it('회전한 그룹 안으로 옮겨도 월드 자세가 그대로다', () => {
    const before = scene()
    const after = moveObjects(before, ['P3'], 'G')
    expect(after.P3.parentId).toBe('G')
    expectSameWorld(before, after, ['P3'])
    // 컴포넌트는 그대로 따라간다
    expect(after.P3.components).toEqual([motor])
  })

  it('피치 ±90° 근처를 지나도 월드 자세가 그대로다', () => {
    const base = scene()
    const tilted: Transform = { position: [0, 0, 0.1], rotation: [0.2, 0.1, -0.5] }
    // tilted 그룹 기준으로 피치가 90°에 아주 가까운 자세(Three.js 추출이 1e-4 틀리던 영역)
    const nearPole: Transform = {
      position: [0.05, 0.02, 0],
      rotation: [0.3, Math.PI / 2 - 2e-4, -0.4]
    }
    const before = deepFreeze({
      ...base,
      tilted: node('tilted', 'group', 'R', tilted.position, tilted.rotation),
      flat: {
        ...node('flat', 'part', 'R', [0, 0, 0]),
        transform: matrixToTransform(
          transformToMatrix(tilted).multiply(transformToMatrix(nearPole))
        )
      }
    })
    const inside = moveObjects(before, ['flat'], 'tilted')
    expect(inside.flat.transform.rotation[1]).toBeCloseTo(nearPole.rotation[1], 9)
    expectSameWorld(before, inside, ['flat'])
    const back = moveObjects(inside, ['flat'], 'R')
    expectSameWorld(before, back, ['flat'])
  })

  it('입력 문서와 공유 회전 배열을 고치지 않고, 아주 작은 값은 0으로 맞춘다', () => {
    const before = scene()
    const after = moveObjects(before, ['P3'], 'C', 'A')
    // 부모가 같으면 순서만 바뀌고 변환은 그대로다
    expect(after.P3).toBe(before.P3)
    expect(childIds(after, 'C')).toEqual(['P3', 'A'])
    const out = moveObjects(before, ['A'], 'R')
    for (const value of [...out.A.transform.position, ...out.A.transform.rotation]) {
      expect(value === 0 || Math.abs(value) >= 1e-12).toBe(true)
    }
    expect(SHARED_ROTATION).toEqual([0, 0, 0])
  })

  it('형제 순서는 키 순서이고, 받은 순서대로 beforeId 앞(없으면 끝)에 넣는다', () => {
    const before = scene()
    const after = moveObjects(before, ['P2', 'P1'], 'R', 'G')
    expect(childIds(after, 'R')).toEqual(['C', 'D', 'P2', 'P1', 'G'])
    const atEnd = moveObjects(before, ['P1'], 'R')
    expect(childIds(atEnd, 'R')).toEqual(['C', 'D', 'G', 'P1'])
    // 같은 자리로 옮기면 바뀐 것이 없다(실행 취소 단계가 생기지 않는다)
    expect(moveObjects(before, ['C'], 'R', 'D')).toBe(before)
  })
})

describe('cadOrigin', () => {
  it('CAD 밖으로 옮기면 생기고, 안으로 돌아오면 지운다', () => {
    const before = scene()
    const out = moveObjects(before, ['P1'], 'G')
    expect(out.P1.cadOrigin).toBe('C')
    const back = moveObjects(out, ['P1'], 'A')
    expect('cadOrigin' in back.P1).toBe(false)
    expect(cadOriginOf(back, 'P1')).toBe('C')
  })

  it('옮긴 어셈블리의 하위는 물려받는다', () => {
    const out = moveObjects(scene(), ['A'], 'R')
    expect(out.A.cadOrigin).toBe('C')
    expect(out.P1.cadOrigin).toBeUndefined()
    expect(cadOriginOf(out, 'P1')).toBe('C')
    // 다른 CAD의 노드 아래로 들어가면 물려받는 출처와 다르므로 자신에게 둔다
    const underB = moveObjects(out, ['P2'], 'B')
    expect(underB.P2.cadOrigin).toBe('C')
    expect(cadOriginOf(underB, 'Q1')).toBe('D')
  })

  it('그룹은 출처를 갖지 않는다: CAD 안에서 만든 그룹을 밖으로 옮겨도 CAD 루트를 지울 때 남는다', () => {
    let objects = createGroup(scene(), { id: 'H', parentId: 'C', name: 'Lift' })
    objects = { ...objects, H: { ...objects.H, components: [{ ...motor, id: 'm2' }] } }
    objects = moveObjects(objects, ['P3'], 'H')
    expect('cadOrigin' in objects.P3).toBe(false)
    objects = moveObjects(objects, ['H'], 'R')
    expect(objects.H.cadOrigin).toBeUndefined()
    expect(cadOriginOf(objects, 'H')).toBeNull()
    expect(objects.P3.cadOrigin).toBe('C')
    expect(cadDependents(objects, 'C')).toEqual(['P3'])

    const removed = removeObjects(objects, ['C'])
    expect(removed.H).toBeDefined()
    expect(removed.H.components).toEqual([{ ...motor, id: 'm2' }])
    expect(removed.P3).toBeUndefined()
    expect(removed.A).toBeUndefined()
  })

  it('옮긴 어셈블리 아래에 만든 그룹도 출처를 갖지 않는다', () => {
    let objects = moveObjects(scene(), ['A'], 'R')
    objects = createGroup(objects, { id: 'H', parentId: 'A', name: 'Claw' })
    objects = moveObjects(objects, ['H'], 'G')
    expect(objects.H.cadOrigin).toBeUndefined()
    expect(cadDependents(objects, 'C')).toEqual(['A', 'P1', 'P2'])
  })
})

describe('Create Empty·Create Empty Parent', () => {
  it('빈 그룹은 부모 원점에 놓이고, afterId 바로 뒤나 마지막에 들어간다', () => {
    const before = scene()
    const after = createGroup(before, { id: 'H', parentId: 'R', name: 'Lift', afterId: 'C' })
    expect(after.H).toEqual({
      id: 'H',
      name: 'Lift',
      kind: 'group',
      parentId: 'R',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
    })
    expect(childIds(after, 'R')).toEqual(['C', 'H', 'D', 'G'])
    expect(childIds(createGroup(before, { id: 'H', parentId: 'R', name: 'x' }), 'R')).toEqual([
      'C',
      'D',
      'G',
      'H'
    ])
    // 이미 있는 id나 없는 부모면 만들지 않는다
    expect(createGroup(before, { id: 'A', parentId: 'R', name: 'x' })).toBe(before)
    expect(createGroup(before, { id: 'H', parentId: 'nope', name: 'x' })).toBe(before)
  })

  it('Create Empty Parent: 공통 부모 원점의 새 그룹이 활성 오브젝트 자리에 들어가고, 선택이 형제 순서로 그 아래로 간다', () => {
    const base = scene()
    const before: SceneObjects = deepFreeze({
      ...base,
      P4: node('P4', 'part', 'A', [0, 0.03, 0], SHARED_ROTATION, { visual: mesh('C:3') })
    })
    // 형제 순서 P1, P2, P4. 선택은 P4, P1(순서 섞음), 활성은 P1
    const after = createEmptyParent(before, ['P4', 'P1'], 'P1', 'H', 'Group')
    expect(after.H.parentId).toBe('A')
    expect(after.H.transform).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0] })
    expect(childIds(after, 'A')).toEqual(['H', 'P2'])
    expect(childIds(after, 'H')).toEqual(['P1', 'P4'])
    expectSameWorld(before, after, ['P1', 'P4'])
    // 로컬 변환은 그대로다(그룹의 월드 행렬이 부모와 같다)
    expect(after.P1.transform).toBe(before.P1.transform)
    expect(cadOriginOf(after, 'P1')).toBe('C')
    expect(after.P1.cadOrigin).toBeUndefined()
  })

  it('Create Empty Parent는 같은 부모의 오브젝트만, 로봇·CAD 루트 없이 묶는다', () => {
    const objects = scene()
    expect(canCreateEmptyParent(objects, ['P1', 'P3'])).toBe(false)
    expect(canCreateEmptyParent(objects, ['C', 'G'])).toBe(false)
    expect(canCreateEmptyParent(objects, ['R', 'R2'])).toBe(false)
    expect(canCreateEmptyParent(objects, [])).toBe(false)
    expect(canCreateEmptyParent(objects, ['D', 'G'])).toBe(false)
    expect(canCreateEmptyParent(objects, ['G', 'P3'])).toBe(false)
    expect(canCreateEmptyParent(objects, ['G'])).toBe(true)
    expect(createEmptyParent(objects, ['P1', 'P3'], 'P1', 'H', 'Group')).toBe(objects)
  })

  it('이름 바꾸기는 앞뒤 공백을 자르고, 빈 이름은 무시한다', () => {
    const objects = scene()
    expect(renameObject(objects, 'G', '  Lift ').G.name).toBe('Lift')
    expect(renameObject(objects, 'G', '   ')).toBe(objects)
    expect(renameObject(objects, 'G', 'G')).toBe(objects)
    expect(renameObject(objects, 'nope', 'x')).toBe(objects)
  })
})

describe('기본 그룹 이름', () => {
  const withGroups = (groups: SceneObject[]): SceneObjects => {
    const objects: SceneObjects = { ...scene() }
    for (const group of groups) objects[group.id] = group
    return deepFreeze(objects)
  }
  const group = (id: string, name: string, parentId: string, extra = {}): SceneObject => ({
    ...node(id, 'group', parentId, [0, 0, 0]),
    name,
    ...extra
  })

  it('형제와 겹치면 Unity처럼 (1), (2)를 붙인다(대소문자·기호 무시)', () => {
    expect(defaultGroupName(scene(), 'R')).toBe('Group')
    expect(defaultGroupName(withGroups([group('g1', 'group', 'R')]), 'R')).toBe('Group (1)')
    expect(
      defaultGroupName(withGroups([group('g1', 'Group', 'R'), group('g2', 'Group1', 'R')]), 'R')
    ).toBe('Group (2)')
  })

  it('감싸는 그룹과 로봇 클래스와도 겹치지 않는다(Java 중첩 클래스 이름 규칙)', () => {
    const nested = withGroups([
      group('outer', 'Group (1)', 'R'),
      group('inner', 'Group', 'outer'),
      group('named', 'Lift', 'R', { codeClassName: 'Group' })
    ])
    expect(defaultGroupName(nested, 'inner')).toBe('Group (2)')
    expect(defaultGroupName(nested, 'named')).toBe('Group (1)')
    const robotClass = deepFreeze({
      ...scene(),
      R: {
        ...scene().R,
        hardware: {
          className: 'Group',
          configName: 'R',
          expansionHub: { enabled: false, address: 2 }
        }
      }
    })
    expect(defaultGroupName(robotClass, 'G')).toBe('Group (1)')
    // Create Empty Parent: 새 그룹 아래로 들어갈 그룹과도 겹치지 않는다
    expect(defaultGroupName(withGroups([group('g1', 'Group', 'G')]), 'R', 'Group', ['G'])).toBe(
      'Group (1)'
    )
  })
})

describe('CAD 루트 정렬이 바뀌면 옮긴 노드가 따라간다', () => {
  const realigned = (objects: SceneObjects, rootId: string, transform: Transform): SceneObjects =>
    deepFreeze({ ...objects, [rootId]: { ...objects[rootId], transform } })

  it('CAD 안 자리를 그대로 두고 한 번만 움직인다', () => {
    let before = moveObjects(scene(), ['A'], 'G')
    before = moveObjects(before, ['P3'], 'R')
    deepFreeze(before)
    // 앞축을 X로(피치 -90°) 바꾼 정렬
    const changed = realigned(
      before,
      'C',
      cadRootTransform(BOUNDS, { upAxis: '+X', forwardAxis: '+Z' })
    )
    const after = carryCadDependents(before, changed, 'C')
    for (const id of ['A', 'P1', 'P2', 'P3']) {
      expect(maxDifference(relativeTo(after, 'C', id), relativeTo(before, 'C', id))).toBeLessThan(
        1e-9
      )
    }
    // A의 하위는 A와 함께 움직이므로 로컬 값이 그대로다
    expect(after.P1).toBe(before.P1)
    // 다른 CAD(D)와 그룹은 움직이지 않는다
    expect(after.G).toBe(before.G)
    expect(after.D).toBe(before.D)
  })

  it('하위에 cadOrigin이 또 있어도(파일에서 읽은 경우) 두 번 움직이지 않는다', () => {
    const moved = moveObjects(scene(), ['A'], 'G')
    const before = deepFreeze({ ...moved, P1: { ...moved.P1, cadOrigin: 'C' } })
    const changed = realigned(before, 'C', {
      position: [0, 0, 0.5],
      rotation: [0, 0, 0.7]
    })
    const after = carryCadDependents(before, changed, 'C')
    expect(after.P1).toBe(before.P1)
    expect(maxDifference(relativeTo(after, 'C', 'P1'), relativeTo(before, 'C', 'P1'))).toBeLessThan(
      1e-9
    )
  })

  it('CAD 루트가 그대로면 아무것도 바꾸지 않는다', () => {
    const before = moveObjects(scene(), ['A'], 'G')
    const same = { ...before }
    expect(carryCadDependents(before, same, 'C')).toBe(same)
  })
})

describe('삭제', () => {
  it('CAD 루트를 지우면 밖으로 옮긴 그 CAD의 노드와 하위도 지우고, 그 수를 따로 알려 준다', () => {
    let objects = moveObjects(scene(), ['A'], 'G')
    objects = createGroup(objects, { id: 'H', parentId: 'A', name: 'Claw' })
    objects = moveObjects(objects, ['B'], 'G')
    expect(objects.B.cadOrigin).toBe('D')
    expect(new Set(removalIds(objects, ['C']))).toEqual(new Set(['C', 'P3', 'A', 'P1', 'P2', 'H']))
    expect(new Set(extraRemovalIds(objects, ['C']))).toEqual(new Set(['A', 'P1', 'P2', 'H']))
    // 로봇을 지우면 모두 그 subtree 안이라 더 지워지는 것이 없다
    expect(extraRemovalIds(objects, ['R'])).toEqual([])
    // 여러 개를 한 번에 지운다
    const removed = removeObjects(objects, ['C', 'D'])
    expect(Object.keys(removed).sort()).toEqual(['G', 'R', 'R2', 'cone'])
    expect(removeObjects(objects, ['nope'])).toBe(objects)
  })
})
