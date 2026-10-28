import { describe, expect, it } from 'vitest'
import { propertyDefaults } from '../hardware/catalog'
import type { SceneObject, SceneObjects } from '../scene/model'
import { deviceRows } from './deviceRows'
import { chooseRobotConfig, generationWarning } from './robotConfig'

const T0 = { position: [0, 0, 0], rotation: [0, 0, 0] } as SceneObject['transform']

function robot(id: string, className: string): SceneObject {
  return {
    id,
    name: id,
    kind: 'robot',
    parentId: null,
    transform: T0,
    hardware: { className, configName: id, expansionHub: { enabled: false, address: 2 } }
  }
}

function part(id: string, parentId: string, motors: [string, string, number][] = []): SceneObject {
  return {
    id,
    name: id,
    kind: 'part',
    parentId,
    transform: T0,
    components: motors.map(([componentId, name, port]) => ({
      id: componentId,
      type: 'motor',
      name,
      hub: 'controlHub',
      port,
      props: propertyDefaults('motor')
    }))
  }
}

// 하드웨어 없는 로봇(empty), 하드웨어 있는 로봇 둘(alpha, beta)
const SCENE: SceneObjects = {
  empty: robot('empty', 'EmptyHardware'),
  emptyPart: part('emptyPart', 'empty'),
  alpha: robot('alpha', 'AlphaHardware'),
  alphaLift: part('alphaLift', 'alpha', [['m1', 'lift', 0]]),
  beta: robot('beta', 'BetaBot'),
  betaArm: part('betaArm', 'beta', [['m2', 'arm', 1]]),
  betaClaw: part('betaClaw', 'beta', [
    ['m3', 'claw', 2],
    ['m4', 'wrist', 3]
  ])
}

describe('실행할 로봇 구성 고르기', () => {
  it('활성 오브젝트의 로봇에 하드웨어가 있으면 그 로봇', () => {
    expect(chooseRobotConfig(SCENE, 'betaClaw')).toEqual({
      robotId: 'beta',
      configPath: 'src/main/res/xml/sandbot_beta_bot.xml'
    })
    expect(chooseRobotConfig(SCENE, 'beta')?.robotId).toBe('beta')
  })

  it('활성 로봇에 하드웨어가 없거나 선택이 없으면 하드웨어가 있는 첫 로봇', () => {
    expect(chooseRobotConfig(SCENE, 'emptyPart')).toEqual({
      robotId: 'alpha',
      configPath: 'src/main/res/xml/sandbot_alpha_hardware.xml'
    })
    expect(chooseRobotConfig(SCENE, null)?.robotId).toBe('alpha')
    expect(chooseRobotConfig(SCENE, 'gone')?.robotId).toBe('alpha')
  })

  it('하드웨어가 있는 로봇이 없으면 null(장치 없는 hardwareMap)', () => {
    expect(
      chooseRobotConfig({ empty: SCENE.empty, emptyPart: SCENE.emptyPart }, 'empty')
    ).toBeNull()
    expect(chooseRobotConfig({}, null)).toBeNull()
  })
})

describe('마지막 저장의 생성 결과 경고', () => {
  const synced = {
    status: 'synced' as const,
    written: [],
    unchanged: [],
    deleted: [],
    skipped: [],
    modified: [],
    caseRenamed: []
  }
  const path = 'src/main/res/xml/sandbot_alpha_hardware.xml'

  it('막힘·실패는 경고, 맞췄으면 그 구성 파일을 건너뛴 경우만', () => {
    expect(generationWarning(null, path)).toBeNull()
    expect(generationWarning({ status: 'blocked', errors: 2 }, path)).toEqual({
      key: 'generationBlocked',
      params: { count: 2 }
    })
    expect(generationWarning({ status: 'failed', detail: 'EACCES' }, null)).toEqual({
      key: 'generationFailed',
      params: { detail: 'EACCES' }
    })
    expect(generationWarning(synced, path)).toBeNull()
    expect(generationWarning({ ...synced, modified: [path] }, path)).toEqual({
      key: 'configNotGenerated',
      params: { file: path }
    })
    expect(generationWarning({ ...synced, skipped: [path] }, null)).toBeNull()
    expect(generationWarning({ status: 'noTeamCode' }, path)).toBeNull()
  })
})

describe('장치 표', () => {
  it('씬의 컴포넌트 순서로 놓고 씬에 없는 이름은 뒤에 이름 순', () => {
    const rows = deviceRows(SCENE, 'beta', {
      wrist: { power: 0 },
      'Control Hub': { voltage: 12.5 },
      arm: { power: 0.25, mode: 'RUN_USING_ENCODER' },
      Alpha: {},
      claw: { power: null }
    })
    expect(rows.map((row) => [row.name, row.objectId, row.type])).toEqual([
      ['arm', 'betaArm', 'motor'],
      ['claw', 'betaClaw', 'motor'],
      ['wrist', 'betaClaw', 'motor'],
      ['Alpha', null, null],
      ['Control Hub', null, null]
    ])
    expect(rows[0].values).toEqual([
      ['power', 0.25],
      ['mode', 'RUN_USING_ENCODER']
    ])
    // 구성 로봇이 없거나 지워졌으면 이름 순
    expect(deviceRows(SCENE, null, { b: {}, a: {} }).map((row) => row.name)).toEqual(['a', 'b'])
    expect(deviceRows(SCENE, 'deleted', { lift: {} })[0].objectId).toBeNull()
  })

  it('센서 값(허브 원시 값) 열: 키 이름 순, 출력이 없는 장치도 행이 된다', () => {
    const rows = deviceRows(
      SCENE,
      'beta',
      { arm: { power: 0.5 } },
      {
        arm: { velocity: 2400, position: 120 },
        imu: { yaw: 0.1 },
        'Control Hub': { voltage: 12.5 }
      }
    )
    expect(rows.map((row) => [row.name, row.values, row.inputs])).toEqual([
      [
        'arm',
        [['power', 0.5]],
        [
          ['position', 120],
          ['velocity', 2400]
        ]
      ],
      ['Control Hub', [], [['voltage', 12.5]]],
      ['imu', [], [['yaw', 0.1]]]
    ])
    expect(deviceRows(SCENE, 'beta', { arm: { power: 0 } })[0].inputs).toEqual([])
  })

  it('이름은 사이드카처럼 Java trim으로 맞춘다(NBSP·전각 공백은 사이드카 장치 이름에 남는다)', () => {
    const scene: SceneObjects = {
      ...SCENE,
      betaArm: part('betaArm', 'beta', [
        ['m2', ' arm\u00a0', 1],
        ['m5', '\u3000elbow\t', 2]
      ])
    }
    const rows = deviceRows(scene, 'beta', { 'arm\u00a0': { power: 0.5 } }, { '\u3000elbow': {} })
    expect(rows.map((row) => [row.name, row.objectId])).toEqual([
      ['arm\u00a0', 'betaArm'],
      ['\u3000elbow', 'betaArm']
    ])
  })
})
