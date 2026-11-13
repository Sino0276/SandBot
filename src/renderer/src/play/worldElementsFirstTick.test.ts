import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import type { OpModeInfo, PlayEvent } from '../../../shared/play'
import { Articulation } from '../../../shared/sim/articulation'
import type { DeviceValues } from '../../../shared/sidecarProtocol'
import { DIRECTION, HALF, LX, LY, mecanum, outputs, RADIUS } from '../../../shared/sim/driveTestkit'
import { resolveElementType } from '../../../shared/sim/elements/elementData'
import { quantizeElements, type GameState } from '../../../shared/sim/elements/gameState'
import { elementSpawns, restBodyFrames } from '../../../shared/sim/elements/spawn'
import { resolveSeason } from '../../../shared/sim/seasons/seasons'
import { PhysicsWorld } from '../../../shared/sim/world'
import {
  parseWorldSpec,
  type SimElementState,
  type Vec3 as SimVec3,
  type WorldSpec
} from '../../../shared/sim/worldSpec'
import { ghostElementBalls, runElementBalls } from '../editor/scene/elementsViewModel'
import { createComponent } from '../hardware/components'
import { DEFAULT_FIELD_DOC } from '../scene/fieldDoc'
import { defaultJoint, defaultJointDrive } from '../scene/joint'
import { objectHullPoints } from '../scene/meshHull'
import type { ColliderSettings } from '../scene/collider'
import type { HardwareComponent, SceneObject, SceneObjects } from '../scene/model'
import { defaultWheel } from '../scene/wheel'
import {
  applyPlayEvent,
  initialPlayData,
  newRun,
  type PlayData,
  type PlayRunField
} from './playStore'
import { runElementsOf, withElements } from './worldElements'
import { buildWorldSpec, withRunField, type WorldSpecResult } from './worldSpec'

// 6a 통합(spec-6a §6): 렌더러가 손으로 만든 씬(바구니 안 빈 그룹의 Preload Slot 넷, Cylinder Collider 인테이크 롤러)에서
// buildWorldSpec + withRunField + withElements(INIT의 playActions.worldFor와 같은 순서) → JSON → 메인과 같은 parseWorldSpec →
// PhysicsWorld. 첫 틱 공 = 공유 elementSpawns(배치 GARDEN → 프리로드 자리 순서)이고, 렌더러의 실행 표시(runElementsOf·
// playStore simGame·잔상)가 시뮬레이터 상태와 같다. 짧게 돌리면 롤러가 빨강 GARDEN 공을 물어 끌고 나온다(아홉째 기준 해시와
// 같은 꼴의 장면을 렌더러 빌더로 만든 것).

const BIOBUZZ = resolveSeason('biobuzz')
const POLLEN_R = resolveElementType(BIOBUZZ, 'pollen')!.radius
const ROLLER_R = 0.03
// 롤러 아래 면과 공 윗면의 겹침(공이 섀시 앞면에 닿았을 때)
const SQUEEZE = 0.004
const START: [number, number, number] = [1.2, -1.55, 0]
const TICK = 5_000_000
const SETTINGS = { batteryVoltage: 12 }
const keyT = ((key: string) => key) as unknown as TFunction
const FIELD: PlayRunField = { season: 'biobuzz', hiveTipped: [false, false], gameElements: true }
const SLOT_PITCH = 2 * POLLEN_R + 0.003

type V3 = [number, number, number]
const object = (
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  position: V3,
  extra: Partial<SceneObject> = {}
): SceneObject => ({
  id,
  name: extra.name ?? id,
  kind,
  parentId,
  transform: { position, rotation: [0, 0, 0] },
  ...extra
})
const box = (id: string, center: V3, size: V3): ColliderSettings => ({
  id,
  kind: 'box',
  center,
  size
})
function motor(name: 'fl' | 'fr' | 'bl' | 'br', port: number): HardwareComponent {
  const base = createComponent('motor', [], () => `m-${name}`)
  return {
    ...base,
    name,
    port,
    props: {
      ...base.props,
      gearbox: 19.2,
      ...(DIRECTION[name] < 0 ? { direction: 'reverse' } : {})
    }
  }
}

// 빨강 GARDEN 앞에서 관중석 벽(+X)을 보는 메카넘 로봇(형상 없음 → 18 in 외곽). 섀시 Box Collider, 섀시 위 바구니 벽 Box
// Collider 넷과 그 안 빈 그룹 넷의 Preload Slot, 앞 아래의 원기둥 롤러(회전 관절 y, CR 서보 goBILDA Speed, μ 1.0)
function intakeScene(): SceneObjects {
  const intake = createComponent('crServo', [], () => 'c-intake')
  const objects: SceneObjects = {
    R: object('R', 'robot', null, START, {
      name: 'Robot',
      hardware: {
        className: 'IntakeBot',
        configName: 'Intake Bot',
        expansionHub: { enabled: false, address: 2 }
      }
    }),
    drive: object('drive', 'group', 'R', [0, 0, 0.05], {
      name: 'Drive',
      components: [
        motor('fl', 0),
        motor('fr', 1),
        motor('bl', 2),
        motor('br', 3),
        {
          ...intake,
          name: 'intake',
          port: 0,
          props: { ...intake.props, servoModel: 'gobildaSpeed' }
        }
      ]
    }),
    chassis: object('chassis', 'group', 'R', [0, 0, 0], {
      name: 'Chassis',
      colliders: [box('cb', [0, 0, 0.1], [2 * HALF, 2 * HALF, 0.2])]
    }),
    hopper: object('hopper', 'group', 'R', [-0.1, 0, 0.25], {
      name: 'Hopper',
      colliders: [
        box('h1', [0, 0.165, 0], [0.22, 0.01, 0.1]),
        box('h2', [0, -0.165, 0], [0.22, 0.01, 0.1]),
        box('h3', [0.115, 0, 0], [0.01, 0.34, 0.1]),
        box('h4', [-0.115, 0, 0], [0.01, 0.34, 0.1])
      ]
    }),
    roller: object(
      'roller',
      'group',
      'R',
      [HALF + ROLLER_R + 0.002, 0, 2 * POLLEN_R + ROLLER_R - SQUEEZE],
      {
        name: 'Roller',
        joint: {
          ...defaultJoint('revolute'),
          axis: 'y',
          limits: null,
          friction: { coulomb: 0.02, viscous: 0.001 },
          drive: { ...defaultJointDrive('crServo'), servo: 'c-intake' }
        } as SceneObject['joint'],
        colliders: [
          {
            id: 'rc',
            kind: 'cylinder',
            center: [0, 0, 0],
            radius: ROLLER_R,
            height: 0.4,
            direction: 'y',
            friction: 1
          }
        ]
      }
    )
  }
  // 바구니 바닥(섀시 윗면 0.2 m) 위 1 mm에 공이 쉬도록 빈 그룹 넷(y 방향 한 줄)
  for (let k = 0; k < 4; k++)
    objects[`slot${k}`] = object(
      `slot${k}`,
      'group',
      'hopper',
      [0, (k - 1.5) * SLOT_PITCH, 0.2 + POLLEN_R + 0.001 - 0.25],
      { name: `Slot ${k}`, preload: { kind: 'pollen', center: [0, 0, 0] } }
    )
  const wheels: [string, number, number][] = [
    ['fl', LX, LY],
    ['fr', LX, -LY],
    ['bl', -LX, LY],
    ['br', -LX, -LY]
  ]
  for (const [name, x, y] of wheels)
    objects[`w-${name}`] = object(`w-${name}`, 'part', 'R', [x, y, RADIUS], {
      name: `Wheel ${name}`,
      visual: { type: 'mesh', geometryId: `g:i:w-${name}`, color: [1, 1, 1] },
      wheel: { ...defaultWheel('mecanum'), diameter: 2 * RADIUS, motor: `m-${name}` }
    })
  return objects
}

// INIT(playActions.worldFor)과 같은 순서: 빌더(형상 조회 포함) → 실행의 시즌 → 경기 요소
function build(objects: SceneObjects): WorldSpecResult {
  const built = buildWorldSpec(objects, 'R', SETTINGS, null, null, (id) =>
    objectHullPoints(objects, id)
  )
  return withElements(
    withRunField(built, DEFAULT_FIELD_DOC, FIELD, keyT),
    objects,
    'R',
    FIELD,
    keyT
  )
}

function reparse(spec: WorldSpec): WorldSpec {
  const parsed = parseWorldSpec(JSON.parse(JSON.stringify(spec)))
  if (typeof parsed === 'string') throw new Error(parsed)
  return parsed
}

const close = (a: SimVec3, b: SimVec3, digits = 12): void => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
  expect(a.z).toBeCloseTo(b.z, digits)
}

const OPMODE: OpModeInfo = {
  className: 'a.Intake',
  path: 'Intake.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Intake',
  group: '',
  preselectTeleOp: ''
}

type GameStateEvent = Extract<PlayEvent, { type: 'gameState' }>
const gameEvent = (tNanos: number, game: GameState, final?: SimElementState[]): GameStateEvent => ({
  type: 'gameState',
  runId: 'run-1',
  tNanos,
  revision: game.revision,
  poses: game.poses,
  flags: game.flags,
  ...(final ? { final } : {})
})

describe('6a 통합: Preload Slot·Cylinder Collider 씬 → 빌더 → JSON → parseWorldSpec → PhysicsWorld', () => {
  it('첫 틱 공 = 공유 elementSpawns(GARDEN 8 → 바구니 자리 넷), 원기둥 끝점, 렌더러 실행 표시 = 시뮬레이터 상태', () => {
    const objects = intakeScene()
    const result = build(objects)
    const spec = result.spec!
    expect(spec).not.toBeNull()
    expect(result.warnings.map((w) => w.key)).toEqual([])
    // 원기둥: 몸체 틀(관절 틀, 앵커 0 = 롤러 오브젝트) 뚜껑 중심 둘과 반지름
    expect(spec.joints).toHaveLength(1)
    // (오브젝트 → 관절 틀 행렬을 곱해 나오므로 0 자리에 반올림 찌꺼기가 남을 수 있다)
    const [cylinder] = spec.joints[0].colliders!
    expect(spec.joints[0].colliders).toHaveLength(1)
    if (cylinder.kind !== 'cylinder') throw new Error(cylinder.kind)
    close(cylinder.a, { x: 0, y: -0.2, z: 0 })
    close(cylinder.b, { x: 0, y: 0.2, z: 0 })
    expect([cylinder.radius, cylinder.friction]).toEqual([ROLLER_R, 1])
    expect(spec.joints[0].drive).toMatchObject({ kind: 'crServo', device: 'intake' })
    // 섀시 충돌체: 섀시 상자 다음 바구니 벽 넷(소속 오브젝트 문서 순서)
    expect(spec.robot.colliders!.map((c) => c.kind)).toEqual(['box', 'box', 'box', 'box', 'box'])
    // 프리로드: 섀시 몸체(−1)의 로봇 좌표 자리, 하이어라키 순서
    expect(spec.elements!.groups).toEqual(['garden'])
    expect(spec.elements!.preloads.map((p) => [p.kind, p.body])).toEqual(
      Array.from({ length: 4 }, () => ['pollen', -1])
    )
    spec.elements!.preloads.forEach((p, k) =>
      close(p.position, { x: -0.1, y: (k - 1.5) * SLOT_PITCH, z: 0.2 + POLLEN_R + 0.001 })
    )

    const parsed = reparse(spec)
    expect(parsed.elements).toEqual(spec.elements)
    const spawns = elementSpawns(
      BIOBUZZ,
      parsed.elements,
      parsed.robot.start,
      restBodyFrames(parsed.joints)
    )
    expect(spawns.map((s) => s.kind)).toEqual(Array.from({ length: 12 }, () => 'pollen'))
    // 렌더러의 실행 공(run.elements)이 시뮬레이터가 쓰는 것과 같은 공유 함수 결과다
    const run = runElementsOf(spec)!
    expect(run.spawns).toEqual(spawns)

    const world = new PhysicsWorld(parsed)
    world.step(0, {})
    expect(world.elementSnapshot()).toEqual(spawns)
    // 프리로드 필드 좌표 = 시작 자세(요 0) ∘ 자리
    spawns.slice(8).forEach((s, k) =>
      close(s.position, {
        x: START[0] - 0.1,
        y: START[1] + (k - 1.5) * SLOT_PITCH,
        z: 0.2 + POLLEN_R + 0.001
      })
    )

    // 메인이 보낼 첫 gameState → playStore simGame → 씬 뷰 실행 공(elementsViewModel)이 시작 상태와 같은 자리
    const game = world.gameState()!
    expect(game.poses).toEqual(quantizeElements(spawns).poses)
    const data: PlayData = {
      ...initialPlayData(),
      run: newRun({
        runId: 'run-1',
        root: '/p',
        opMode: OPMODE,
        robotId: 'R',
        configPath: null,
        speed: 1,
        paused: false,
        field: FIELD,
        elements: run
      })
    }
    const next = { ...data, ...applyPlayEvent(data, gameEvent(0, game)) }
    expect(next.simGame?.revision).toBe(game.revision)
    const balls = runElementBalls(run, next.simGame)
    expect(balls).toHaveLength(12)
    const shown = (v: number): number => Math.round(v * 1e4) / 1e4
    balls.forEach((ball, i) => {
      const { x, y, z } = spawns[i].position
      expect(ball.position).toEqual([shown(x), shown(y), shown(z)])
    })
  })

  it('짧게 돌리면 롤러가 빨강 GARDEN 공을 물어 끌고 나오고, 프리로드는 바구니에, 파랑 GARDEN은 잠든 채다', () => {
    const objects = intakeScene()
    const result = build(objects)
    const spec = reparse(result.spec!)
    const world = new PhysicsWorld(spec)
    const run = runElementsOf(result.spec)!
    let data: PlayData = {
      ...initialPlayData(),
      run: newRun({
        runId: 'run-1',
        root: '/p',
        opMode: OPMODE,
        robotId: 'R',
        configPath: null,
        speed: 1,
        paused: false,
        field: FIELD,
        elements: run
      })
    }
    const apply = (event: PlayEvent): void => {
      data = { ...data, ...applyPlayEvent(data, event) }
    }
    // 롤러 아래 면이 섀시 쪽(−X)으로 도는 CR 서보 전진(펄스 2400 µs)
    const intake: DeviceValues = { position: 0, power: 0, pulseUs: 2400, pwm: true }
    const out = (k: number): Record<string, DeviceValues> => {
      if (k < 500) return outputs(mecanum(0.3, 0, 0), {}, { intake })
      if (k < 600) return outputs(mecanum(-0.2, 0, 0), {}, { intake })
      return outputs({}, {}, { intake: { ...intake, pwm: false } })
    }
    // 로봇 풀이(art.step)에 들어간 공 행의 짝(앞 두 토막, 예: gn.e0/j0k0 = 공 0과 관절 0의 충돌체 0)
    const coupled = new Set<string>()
    const original = Articulation.prototype.step
    const spy = vi.spyOn(Articulation.prototype, 'step').mockImplementation(function (
      this: Articulation,
      h,
      drive,
      contacts
    ) {
      for (const row of contacts?.rows ?? [])
        if (row.key.startsWith('g')) coupled.add(row.key.split('.').slice(0, 2).join('.'))
      return original.call(this, h, drive, contacts)
    })
    const notices: ReturnType<PhysicsWorld['drainNotices']> = []
    let lastRevision = -1
    try {
      for (let k = 0; k < 640; k++) {
        world.step(k * TICK, out(k))
        notices.push(...world.drainNotices())
        const game = world.gameState()!
        if (game.revision !== lastRevision) {
          lastRevision = game.revision
          apply(gameEvent(k * TICK, game))
        }
      }
    } finally {
      spy.mockRestore()
    }
    const spawn = run.spawns
    const last = world.elementSnapshot()!
    expect(notices.filter((n) => n.code === 'worldError')).toEqual([])
    expect(notices.some((n) => n.code === 'elementOutOfField')).toBe(false)
    // 렌더러가 만든 원기둥(관절 0의 충돌체 0)과 섀시가 빨강 GARDEN 공과 로봇 풀이로 함께 풀렸다
    for (const key of ['gn.e0/j0k0', 'gt1.e0/j0k0', 'gn.e0/rk0'])
      expect(coupled.has(key)).toBe(true)
    // 롤러가 문 빨강 GARDEN 공 넷(관중석 벽에 붙어 있던 것)을 벽에서 5 cm 넘게 끌고 나와 롤러 아래(섀시 앞면과 롤러 중심 사이
    // 앞뒤 공 반지름 안)에 쥐고 있다
    const pose = world.pose()
    const rollerX = pose.x + Math.cos(pose.yaw) * (HALF + ROLLER_R + 0.002)
    for (const k of [0, 1, 2, 3]) {
      expect(last[k].position.x).toBeLessThan(spawn[k].position.x - 0.05)
      expect(Math.abs(last[k].position.x - rollerX)).toBeLessThan(POLLEN_R)
    }
    // 파랑 GARDEN 넷은 처음 자리에서 잠든 채
    for (const k of [4, 5, 6, 7]) {
      expect(last[k].asleep).toBe(true)
      expect(last[k].position).toEqual(spawn[k].position)
    }
    // 프리로드 넷은 바구니(섀시 윗면 위)에 남았다
    for (const k of [8, 9, 10, 11]) expect(last[k].position.z).toBeGreaterThan(0.2)

    // 렌더러: 마지막 simGame = 시뮬레이터의 마지막 표시 상태, 끝(final + phase finished) → 잔상과 6d 이어 가기 상태
    expect(data.simGame?.poses).toEqual(world.gameState()!.poses)
    apply(gameEvent(640 * TICK, world.gameState()!, last))
    expect(data.lastRunElements?.states).toEqual(last)
    apply({ type: 'phase', runId: 'run-1', phase: 'finished' })
    expect(data.simGame).toBeNull()
    const ghost = ghostElementBalls(data.ghostGame)
    expect(ghost).toHaveLength(12)
    // 잔상 = 끝 상태를 1e-4 m로 줄인 자리
    const shown = (v: number): number => Math.round(v * 1e4) / 1e4
    ghost.forEach((ball, i) => {
      const { x, y, z } = last[i].position
      expect(ball.position).toEqual([shown(x), shown(y), shown(z)])
    })
  }, 60_000)
})
