import { Group, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { OpModeInfo } from '../../../../shared/play'
import { newRun, type PlayData } from '../../play/playStore'
import { jointMotionMatrix } from '../../scene/jointMotion'
import { transformToMatrix, type JointSettings, type SceneObjects } from '../../scene/model'
import { type JointPreviewState } from '../joint/jointPreviewStore'
import {
  applyPose,
  bindJointDisplacement,
  bindJointDisplay,
  bindPoseDisplay,
  ghostJointMatrix,
  jointDisplacement,
  jointValueSource,
  meshCount,
  resetPose
} from './poseDisplay'

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

describe('관절 표시(안쪽 그룹, 3b)', () => {
  const hinge: JointSettings = {
    type: 'revolute',
    anchor: [0.1, 0, 0],
    axis: 'z',
    axisSign: 1,
    limits: { lower: -1, upper: 1 },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' }
  }
  const jointRun = (): StoreApi<PoseState> => {
    const source = playSource()
    source.setState({ run: { ...source.getState().run!, joints: ['arm'] } })
    return source
  }
  const previewSource = (): StoreApi<JointPreviewState> =>
    createStore<JointPreviewState>()(() => ({ values: {} }))
  const expectMatrix = (group: Group, expected: Matrix4): void => {
    group.updateMatrix()
    group.matrix.elements.forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i], 12))
  }

  it('값의 우선순위: 실행 중 시뮬레이터 값 > (실행 중인 로봇이면) 편집 자세 > 미리보기(한계로 자름)', () => {
    const play = jointRun()
    const preview = previewSource()
    const source = jointValueSource('arm', 'bot', hinge, play, preview)
    // 실행 중이지만 자세가 아직 없으면(INIT 직후) 미리보기를 쓰지 않는다
    preview.setState({ values: { arm: 5 } })
    expect(source.get()).toBeNull()
    play.setState({ simPose: { ...pose(0, 0, 0)!, joints: [0.4] } })
    expect(source.get()).toBe(0.4)
    // 다른 로봇의 관절은 실행과 관계없이 미리보기, 한계 안으로 자른다
    preview.setState({ values: { arm: 5, claw: -3 } })
    expect(jointValueSource('claw', 'other', hinge, play, preview).get()).toBe(-1)
    // 실행이 없으면 미리보기
    play.setState({ run: null, simPose: null })
    expect(source.get()).toBe(1)
    preview.setState({ values: {} })
    expect(source.get()).toBeNull()
  })

  it('붙자마자 지금 값을 적용하고, 값이 바뀔 때만 다시 그리고, 떼면 항등이다(StrictMode처럼 다시 붙여도 같다)', () => {
    const play = jointRun()
    const preview = previewSource()
    play.setState({ simPose: { ...pose(0, 0, 0)!, joints: [0.5] } })
    const group = new Group()
    let draws = 0
    const bind = (): (() => void) =>
      bindJointDisplay(
        group,
        hinge,
        jointValueSource('arm', 'bot', hinge, play, preview),
        () => draws++
      )
    // StrictMode: 붙였다 곧바로 떼고 다시 붙인다
    bind()()
    const unbind = bind()
    expectMatrix(group, jointMotionMatrix(hinge, 0.5))
    draws = 0
    // 같은 값의 새 자세(로봇만 움직임)는 관절 그룹을 다시 그리지 않는다(바깥 그룹이 따로 그린다)
    play.setState({ simPose: { ...pose(1, 0, 0)!, joints: [0.5] } })
    expect(draws).toBe(0)
    play.setState({ simPose: { ...pose(1, 0, 0)!, joints: [-0.25] } })
    expectMatrix(group, jointMotionMatrix(hinge, -0.25))
    expect(draws).toBe(1)
    // 실행이 끝나면 편집 자세
    play.setState({ run: { ...play.getState().run!, phase: 'finished' } })
    expectMatrix(group, new Matrix4())
    expect(draws).toBe(2)
    unbind()
    expectMatrix(group, new Matrix4())
    expect(draws).toBe(3)
    play.setState({ run: { ...play.getState().run!, phase: 'running' } })
    expectMatrix(group, new Matrix4())
  })

  it('무게중심 표시는 관절이 오브젝트를 옮긴 만큼(로봇 좌표) 따라간다', () => {
    const objects: SceneObjects = {
      bot: {
        id: 'bot',
        name: 'Bot',
        kind: 'robot',
        parentId: null,
        transform: { position: [1, 2, 0], rotation: [0, 0, 0.5] }
      },
      arm: {
        id: 'arm',
        name: 'Arm',
        kind: 'group',
        parentId: 'bot',
        transform: { position: [0.2, 0, 0.3], rotation: [0, 0, 0] },
        joint: hinge
      },
      hand: {
        id: 'hand',
        name: 'Hand',
        kind: 'part',
        parentId: 'arm',
        transform: { position: [0.3, 0, 0], rotation: [0, 0, 0] }
      }
    }
    const play = jointRun()
    // 자세가 없으면 움직임 없음
    expect(jointDisplacement(objects, 'hand', play.getState())).toBeNull()
    play.setState({ simPose: { ...pose(5, 5, 1)!, joints: [Math.PI / 2] } })
    // 앵커(로봇 좌표 (0.3, 0, 0.3)) 둘레 +Z 90°: 손의 무게중심(로봇 좌표 (0.5, 0, 0.3))은 (0.3, 0.2, 0.3)으로 간다
    const moved = new Vector3(0.5, 0, 0.3).applyMatrix4(
      jointDisplacement(objects, 'hand', play.getState())!
    )
    expect(moved.x).toBeCloseTo(0.3, 12)
    expect(moved.y).toBeCloseTo(0.2, 12)
    expect(moved.z).toBeCloseTo(0.3, 12)
    // 관절 밖의 오브젝트(로봇)는 그대로
    const still = jointDisplacement(objects, 'bot', play.getState())!
    expect(still.equals(new Matrix4())).toBe(true)

    const group = new Group()
    let draws = 0
    const unbind = bindJointDisplacement(
      group,
      'hand',
      () => objects,
      play,
      () => draws++
    )
    group.updateMatrix()
    const position = new Vector3(0.5, 0, 0.3).applyMatrix4(group.matrix)
    expect(position.y).toBeCloseTo(0.2, 12)
    expect(draws).toBe(1)
    unbind()
    group.updateMatrix()
    expect(group.matrix.equals(new Matrix4())).toBe(true)
  })

  it('잔상의 관절 자세는 마지막 값, 값이 없으면 편집 자세', () => {
    expect(ghostJointMatrix(hinge, 0.2)!.equals(jointMotionMatrix(hinge, 0.2))).toBe(true)
    expect(ghostJointMatrix(hinge, undefined)).toBeNull()
    expect(ghostJointMatrix(undefined, 0.2)).toBeNull()
    expect(ghostJointMatrix(hinge, NaN)).toBeNull()
  })
})
