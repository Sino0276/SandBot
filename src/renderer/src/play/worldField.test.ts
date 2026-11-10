import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { WALL_INNER_HALF } from '../../../shared/sim/field'
import { resolveSeason } from '../../../shared/sim/seasons/seasons'
import { snapRobotToStart } from '../../../shared/sim/seasons/startPose'
import { parseWorldSpec } from '../../../shared/sim/worldSpec'
import { drivetrainSummary } from '../editor/hardware/wheelCardModel'
import { createComponent } from '../hardware/components'
import type { HardwareComponent, SceneObject, SceneObjects } from '../scene/model'
import { defaultWheel } from '../scene/wheel'
import { DEFAULT_PLAY_SETTINGS, type HiveState } from './playSettings'
import { newRun } from './playStore'
import {
  buildWorldSpec,
  robotOutline,
  runFieldOf,
  withRunField,
  type WorldSpecResult,
  type WorldWarning
} from './worldSpec'

// 세계 설명의 시즌·HIVE 상태와 필드 경고(spec-4ab §3 worldFor, §2.4 PlayRun.field): B3·B9·B11·B12·B13

const DEG = Math.PI / 180
const SETTINGS = { batteryVoltage: 12.5 }
// 대상 이름은 i18n 키 그대로(문구는 fieldLabels.test.ts가 본다)
const keyT = ((key: string) => key) as unknown as TFunction
const START: HiveState = { red: 'start', blue: 'start' }
const HALF = 0.2286 // CAD 없는 로봇 외곽(18 in 정사각형)의 반폭
const NONE_WALL_X = WALL_INNER_HALF - HALF // 'none' +X 벽에 붙인 로봇의 x

function motor(name: string, port: number): HardwareComponent {
  const base = createComponent('motor', [], () => `motor-${name}`)
  return { ...base, name, port }
}

function part(
  id: string,
  position: [number, number, number],
  extra: Partial<SceneObject>
): SceneObject {
  return {
    id,
    name: id,
    kind: 'part',
    parentId: 'R',
    transform: { position, rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: `g-${id}`, color: [1, 1, 1] },
    ...extra
  }
}

// 바퀴 넷(일반 바퀴, 모터 넷) 로봇. wheels가 false면 모터만 있고 바퀴가 없다(고정 기저).
function robot(x: number, y: number, yaw: number, wheels = true): SceneObjects {
  const objects: SceneObjects = {
    R: {
      id: 'R',
      name: 'Robot',
      kind: 'robot',
      parentId: null,
      transform: { position: [x, y, 0], rotation: [0, 0, yaw] },
      hardware: {
        className: 'RobotHardware',
        configName: 'Robot',
        expansionHub: { enabled: false, address: 2 }
      }
    },
    drive: part('drive', [0, 0, 0.05], {
      components: [motor('fl', 0), motor('fr', 1), motor('bl', 2), motor('br', 3)]
    })
  }
  if (!wheels) return objects
  const corners: [string, number, number][] = [
    ['fl', 0.15, 0.15],
    ['fr', 0.15, -0.15],
    ['bl', -0.15, 0.15],
    ['br', -0.15, -0.15]
  ]
  for (const [name, wx, wy] of corners)
    objects[`W${name}`] = part(`W${name}`, [wx, wy, 0.05], {
      wheel: { ...defaultWheel('traction'), motor: `motor-${name}` }
    })
  return objects
}

const keys = (warnings: WorldWarning[]): string[] => warnings.map((w) => w.key)

function world(objects: SceneObjects, season: string, hive: HiveState = START): WorldSpecResult {
  const doc = { season }
  return withRunField(buildWorldSpec(objects, 'R', SETTINGS), doc, runFieldOf(doc, hive), keyT)
}

describe('runFieldOf(B11·B13)', () => {
  it('문서 시즌(모르면 none)과 HIVE 상태 → hiveTipped [빨강, 파랑]', () => {
    expect(runFieldOf({ season: 'biobuzz' }, START)).toEqual({
      season: 'biobuzz',
      hiveTipped: [false, false]
    })
    expect(runFieldOf({ season: 'none' }, { red: 'tipped', blue: 'start' })).toEqual({
      season: 'none',
      hiveTipped: [true, false]
    })
    expect(runFieldOf({ season: 'decode2027' }, { red: 'start', blue: 'tipped' })).toEqual({
      season: 'none',
      hiveTipped: [false, true]
    })
    expect(runFieldOf({ season: 'biobuzz' }, DEFAULT_PLAY_SETTINGS.hiveState).hiveTipped).toEqual([
      false,
      false
    ])
  })

  it('B13: newRun을 field 없이 부르면 none, 넘기면 그 값', () => {
    const base = {
      runId: 'r',
      root: '/p',
      opMode: {
        className: 'A',
        path: 'A.java',
        line: 1,
        flavor: 'TeleOp' as const,
        name: 'A',
        group: '',
        preselectTeleOp: ''
      },
      robotId: null,
      configPath: null,
      speed: 1 as const,
      paused: false
    }
    expect(newRun(base).field).toEqual({ season: 'none', hiveTipped: [false, false] })
    const field = runFieldOf({ season: 'biobuzz' }, { red: 'tipped', blue: 'tipped' })
    expect(newRun({ ...base, field }).field).toBe(field)
  })
})

describe('withRunField(B3·B9·B12)', () => {
  it('B12: 빌더 v4는 parseWorldSpec을 통과하고 센서 []·noise 꺼짐·시즌 none(빌더 기본)', () => {
    const { spec } = buildWorldSpec(robot(0, 0, 0), 'R', SETTINGS)
    expect(spec).not.toBeNull()
    expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(spec)))).toBe('object')
    expect(spec!.field).toEqual({ season: 'none', hiveTipped: [false, false] })
    expect(spec!.distanceSensors).toEqual([])
    expect(spec!.colorSensors).toEqual([])
    expect(spec!.noise).toEqual({ enabled: false, seed: 0 })
  })

  it('문서 시즌과 HIVE 상태를 넣는다(빌더 결과는 바꾸지 않는다), 결과도 parseWorldSpec을 통과', () => {
    const built = buildWorldSpec(robot(0, 0, 0), 'R', SETTINGS)
    const doc = { season: 'biobuzz' }
    const result = withRunField(built, doc, runFieldOf(doc, { red: 'tipped', blue: 'start' }), keyT)
    expect(result.spec!.field).toEqual({ season: 'biobuzz', hiveTipped: [true, false] })
    expect(built.spec!.field.season).toBe('none')
    expect(result.warnings).toEqual(built.warnings)
    expect(typeof parseWorldSpec(JSON.parse(JSON.stringify(result.spec)))).toBe('object')
  })

  it('spec이 없으면 그대로 돌려준다', () => {
    const none = {
      spec: null,
      warnings: [],
      jointObjectIds: [],
      jointMotorIds: [],
      sensors: [],
      sensorExclusions: new Map(),
      cameras: [],
      cameraExclusions: new Map(),
      colliders: [],
      ignoredPairs: []
    }
    expect(withRunField(none, { season: 'x' }, runFieldOf({ season: 'x' }, START), keyT)).toBe(none)
  })

  it('B3: 모르는 시즌은 none으로 시뮬레이션하고 worldUnknownSeason', () => {
    const { spec, warnings } = world(robot(0, 0, 0), 'decode2027')
    expect(spec!.field.season).toBe('none')
    expect(warnings.at(-1)).toEqual({ key: 'worldUnknownSeason', params: { season: 'decode2027' } })
  })

  it("B9: 'none' 벽에 붙인 바퀴 로봇을 BIOBUZZ로 INIT하면 worldStartOverlap { targets }", () => {
    const objects = robot(NONE_WALL_X, 0, 0)
    expect(keys(world(objects, 'none').warnings)).not.toContain('worldStartOverlap')
    const { warnings } = world(objects, 'biobuzz')
    expect(warnings.at(-1)).toEqual({
      key: 'worldStartOverlap',
      params: { targets: 'field.walls.audience' }
    })
    // 빨강 벽(−Y)도
    const red = world(robot(0.9, -NONE_WALL_X, 0), 'biobuzz')
    expect(red.warnings.at(-1)!.params).toEqual({ targets: 'field.walls.red' })
    // 구조물이면 구조물 이름(structures 순서, 같은 이름은 한 번): (0.3, 0.5)의 18 in 외곽은 파랑 쪽 발판 막대와
    // 다리 (+X,+Y) 껍질에 걸친다
    const leg = world(robot(0.3, 0.5, 0), 'biobuzz')
    expect(leg.warnings.at(-1)).toEqual({
      key: 'worldStartOverlap',
      params: { targets: 'field.structures.footBar, field.structures.leg' }
    })
  })

  it('임시 상자 로봇 자리(−0.9144, −0.9144, 30°)는 겹치지 않는다', () => {
    expect(keys(world(robot(-0.9144, -0.9144, 30 * DEG), 'biobuzz').warnings)).not.toContain(
      'worldStartOverlap'
    )
  })

  it('프리셋으로 스냅한 로봇은 겹치지 않는다(모든 프리셋)', () => {
    const spec = resolveSeason('biobuzz')
    const { footprint } = robotOutline(robot(0, 0, 0), 'R')
    for (const preset of spec.startPresets) {
      const snap = snapRobotToStart(footprint, preset, spec.perimeter.innerHalf)
      if (!snap.ok) throw new Error(preset.key)
      const { warnings } = world(robot(snap.pose.x, snap.pose.y, snap.pose.yaw), 'biobuzz')
      expect(keys(warnings), preset.key).not.toContain('worldStartOverlap')
    }
  })

  it('바퀴 없는 로봇은 겹쳐도 내지 않는다(고정 기저라 접촉이 없다)', () => {
    const { spec, warnings } = world(robot(NONE_WALL_X, 0, 0, false), 'biobuzz')
    expect(spec!.wheels).toEqual([])
    expect(keys(warnings)).not.toContain('worldStartOverlap')
  })

  it('로봇 카드 경고(drivetrainSummary)는 시즌과 관계없이 그대로다(빌더는 새 경고를 내지 않는다)', () => {
    const objects = robot(NONE_WALL_X, 0, 0)
    const summary = drivetrainSummary(objects, 'R', SETTINGS)
    expect(summary.warnings).toEqual(buildWorldSpec(objects, 'R', SETTINGS).warnings)
    expect(keys(summary.warnings)).not.toContain('worldStartOverlap')
    expect(keys(summary.warnings)).not.toContain('worldUnknownSeason')
  })
})
