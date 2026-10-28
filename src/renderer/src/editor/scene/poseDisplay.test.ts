import { Group, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { OpModeInfo } from '../../../../shared/play'
import { newRun, type PlayData } from '../../play/playStore'
import { transformToMatrix, type SceneObjects } from '../../scene/model'
import { applyPose, bindPoseDisplay, meshCount, resetPose } from './poseDisplay'

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

type PoseState = Pick<PlayData, 'run' | 'simPose'>

function playSource(): StoreApi<PoseState> {
  const run = newRun({
    runId: 'r1',
    root: '/p',
    opMode: OP_MODE,
    robotId: 'bot',
    configPath: null,
    speed: 1,
    paused: false
  })
  return createStore<PoseState>()(() => ({ run: { ...run, phase: 'running' }, simPose: null }))
}

const pose = (x: number, y: number, yaw: number): PoseState['simPose'] => ({
  robotId: 'bot',
  tNanos: 0,
  x,
  y,
  yaw,
  blocked: false
})

describe('실행 중 로봇 자세 적용(바깥 그룹)', () => {
  it('applyPose는 바닥 위 자세(요만)를 씬과 같은 ZYX 순서로 쓰고, 행렬이 문서 변환과 같다', () => {
    const group = new Group()
    applyPose(group, { x: 1, y: -0.5, yaw: 0.7 })
    group.updateMatrix()
    const expected = transformToMatrix({ position: [1, -0.5, 0], rotation: [0, 0, 0.7] })
    group.matrix.elements.forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i], 12))
    resetPose(group)
    group.updateMatrix()
    expect(group.matrix.equals(new Matrix4())).toBe(true)
  })

  it('붙자마자 지금 자세를 적용하고, 자세가 올 때마다 적용·다시 그리기, 떼면 항등으로 되돌린다', () => {
    const source = playSource()
    source.setState({ simPose: pose(0.2, 0.3, 0) })
    const group = new Group()
    let draws = 0
    const unbind = bindPoseDisplay(group, 'bot', source, () => draws++)
    expect(group.position.toArray()).toEqual([0.2, 0.3, 0])
    expect(draws).toBe(1)

    source.setState({ simPose: pose(1, 2, Math.PI / 2) })
    expect(group.position.toArray()).toEqual([1, 2, 0])
    expect(group.rotation.z).toBeCloseTo(Math.PI / 2)
    expect(group.rotation.order).toBe('ZYX')
    expect(draws).toBe(2)
    // 자세가 아닌 변경은 다시 그리지 않는다
    source.setState({ run: { ...source.getState().run! } })
    expect(draws).toBe(2)
    // 다른 로봇의 자세는 쓰지 않는다
    source.setState({ simPose: { ...pose(5, 5, 0)!, robotId: 'other' } })
    expect(group.position.toArray()).toEqual([1, 2, 0])

    unbind()
    expect(group.position.toArray()).toEqual([0, 0, 0])
    expect(group.rotation.z).toBe(0)
    expect(draws).toBe(3)
    // 뗀 뒤에는 따라가지 않는다
    source.setState({ simPose: pose(3, 3, 0) })
    expect(group.position.toArray()).toEqual([0, 0, 0])
  })

  it('StrictMode처럼 떼었다 곧바로 다시 붙여도 지금 자세가 그대로 보인다', () => {
    const source = playSource()
    source.setState({ simPose: pose(0.5, -1, 1) })
    const group = new Group()
    bindPoseDisplay(group, 'bot', source, () => {})()
    const unbind = bindPoseDisplay(group, 'bot', source, () => {})
    expect(group.position.toArray()).toEqual([0.5, -1, 0])
    expect(group.rotation.z).toBe(1)
    unbind()
  })

  it('바깥 그룹 × 항등 안쪽 노드 = 시뮬레이터 자세의 로봇(하위 파트는 그 자세를 따른다)', () => {
    const outer = new Group()
    const inner = new Group()
    const part = new Group()
    part.position.set(0.2, 0, 0.1)
    outer.add(inner)
    inner.add(part)
    applyPose(outer, { x: 1, y: 1, yaw: Math.PI / 2 })
    outer.updateMatrixWorld(true)
    const world = new Vector3().setFromMatrixPosition(part.matrixWorld)
    expect(world.x).toBeCloseTo(1)
    expect(world.y).toBeCloseTo(1.2)
    expect(world.z).toBeCloseTo(0.1)
  })
})

describe('잔상 메시 수', () => {
  it('하위 트리의 CAD 메시만 센다', () => {
    const objects: SceneObjects = {
      bot: {
        id: 'bot',
        name: 'Bot',
        kind: 'robot',
        parentId: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        visual: { type: 'placeholder', shape: 'robot' }
      },
      a: {
        id: 'a',
        name: 'A',
        kind: 'part',
        parentId: 'bot',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        visual: { type: 'mesh', geometryId: 'g1', color: [1, 1, 1] }
      },
      b: {
        id: 'b',
        name: 'B',
        kind: 'part',
        parentId: 'a',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        visual: { type: 'mesh', geometryId: 'g2', color: [1, 1, 1] }
      }
    }
    expect(meshCount(objects, 'bot')).toBe(2)
    expect(meshCount(objects, 'b')).toBe(1)
    expect(meshCount(objects, 'gone')).toBe(0)
  })
})
