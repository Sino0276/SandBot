import { describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../shared/play'
import type { JointSettings, SceneObjects, Transform } from '../scene/model'
import { jointRows } from './deviceRows'
import { newRun, type PlayRun } from './playStore'

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Lift',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Lift',
  group: '',
  preselectTeleOp: ''
}

const joint = (type: JointSettings['type']): JointSettings => ({
  type,
  anchor: [0, 0, 0],
  axis: 'z',
  axisSign: 1,
  limits: { lower: 0, upper: 0.5 },
  friction: { coulomb: 0, viscous: 0 },
  spring: null,
  drive: { kind: 'none' }
})

const at: Transform = { position: [0, 0, 0], rotation: [0, 0, 0] }

const SCENE: SceneObjects = {
  bot: { id: 'bot', name: 'Bot', kind: 'robot', parentId: null, transform: at },
  lift: {
    id: 'lift',
    name: 'Lift',
    kind: 'group',
    parentId: 'bot',
    transform: at,
    joint: joint('prismatic')
  },
  wrist: {
    id: 'wrist',
    name: 'Wrist',
    kind: 'part',
    parentId: 'lift',
    transform: at,
    joint: joint('revolute')
  }
}

function run(phase: PlayRun['phase'] = 'running'): PlayRun {
  const created = newRun({
    runId: 'r1',
    root: '/p',
    opMode: OP_MODE,
    robotId: 'bot',
    configPath: null,
    speed: 1,
    paused: false,
    joints: ['lift', 'wrist', 'gone']
  })
  return { ...created, phase }
}

describe('장치 탭의 관절 표', () => {
  it('세계 설명 순서로 관절 오브젝트와 지금 값, 지운 오브젝트는 뺀다', () => {
    const simPose = {
      robotId: 'bot',
      tNanos: 5,
      x: 0,
      y: 0,
      yaw: 0,
      blocked: false,
      joints: [0.2, -0.5, 1]
    }
    expect(jointRows(SCENE, { run: run(), simPose, ghostPose: null })).toEqual([
      { objectId: 'lift', name: 'Lift', type: 'prismatic', value: 0.2 },
      { objectId: 'wrist', name: 'Wrist', type: 'revolute', value: -0.5 }
    ])
    // 자세가 아직 없으면 값 없이 행만
    expect(jointRows(SCENE, { run: run('init'), simPose: null, ghostPose: null })).toMatchObject([
      { objectId: 'lift', value: null },
      { objectId: 'wrist', value: null }
    ])
  })

  it('끝난 실행은 잔상의 마지막 값, 관절이 없는 실행·실행 없음은 빈 표', () => {
    const ghostPose = { robotId: 'bot', x: 0, y: 0, yaw: 0, joints: { lift: 0.4, wrist: 0.1 } }
    expect(
      jointRows(SCENE, { run: run('finished'), simPose: null, ghostPose }).map((row) => row.value)
    ).toEqual([0.4, 0.1])
    expect(jointRows(SCENE, { run: null, simPose: null, ghostPose })).toEqual([])
    const plain = { ...run(), joints: [] }
    expect(jointRows(SCENE, { run: plain, simPose: null, ghostPose: null })).toEqual([])
  })
})
