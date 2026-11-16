import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { autoPreloadSlots, elementSpawns, restBodyFrames } from '../../../shared/sim/elements/spawn'
import { resolveElementType, SLOT_GAP } from '../../../shared/sim/elements/elementData'
import { resolveSeason } from '../../../shared/sim/seasons/seasons'
import { PhysicsWorld } from '../../../shared/sim/world'
import { MAX_PRELOADS, parseWorldSpec, type Vec3 as SimVec3 } from '../../../shared/sim/worldSpec'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import type { ColliderShapeLookup, ObjectHullPoints } from '../scene/meshHull'
import { defaultJoint } from '../scene/joint'
import type { SceneObject, SceneObjects, Vec3 } from '../scene/model'
import type { PreloadSettings } from '../scene/preload'
import type { PlayRunField } from './playStore'
import { preloadOverlaps, robotPreloads, runElementsOf, withElements } from './worldElements'
import {
  buildWorldSpec,
  runFieldOf,
  withRunField,
  type WorldSpecResult,
  type WorldWarning
} from './worldSpec'

// 세계 설명의 경기 요소(6a, spec-6a §3·§4): Preload Slot 자리(몸체 틀), 자동 배치(공유 autoPreloadSlots), 경고, INIT 조립.

const BIOBUZZ = resolveSeason('biobuzz')
const POLLEN_R = resolveElementType(BIOBUZZ, 'pollen')!.radius
const SETTINGS = { batteryVoltage: 12 }
// 번역 함수 대신 키를 그대로(경고 params 비교)
const keyT = ((key: string) => key) as unknown as TFunction
const ON: PlayRunField = { season: 'biobuzz', hiveTipped: [false, false], gameElements: true }

function object(
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  position: Vec3 = [0, 0, 0],
  rotation: Vec3 = [0, 0, 0],
  extra: Partial<SceneObject> = {}
): SceneObject {
  return { id, name: id, kind, parentId, transform: { position, rotation }, ...extra }
}
const preload = (center: Vec3, enabled = true): { preload: PreloadSettings } => ({
  preload: enabled ? { kind: 'pollen', center } : { kind: 'pollen', enabled: false, center }
})

// 빨강 쪽 빈 타일(구조물·GARDEN에서 먼 곳)에 요 90°로 둔 로봇: 호퍼 그룹(섀시) 자리 둘, 리프트(직선 z, 앵커 0) 아래 자리 하나
function hopperScene(yaw = Math.PI / 2): SceneObjects {
  return {
    R: object('R', 'robot', null, [-0.9, -0.9, 0], [0, 0, yaw]),
    hopper: object('hopper', 'group', 'R', [-0.05, 0, 0.1], [0, 0, 0], { name: 'Hopper' }),
    slotA: object('slotA', 'group', 'hopper', [0, 0.04, 0], [0, 0, 0], {
      name: 'Slot A',
      ...preload([0, 0, 0])
    }),
    slotB: object('slotB', 'group', 'hopper', [0, -0.04, 0], [0, 0, 0], {
      name: 'Slot B',
      ...preload([0, 0, 0])
    }),
    lift: object('lift', 'group', 'R', [0.1, 0, 0.05], [0, 0, Math.PI / 2], {
      name: 'Lift',
      joint: { ...defaultJoint('prismatic'), axis: 'z' }
    }),
    liftSlot: object('liftSlot', 'part', 'lift', [0.02, 0, 0.1], [0, 0, 0], {
      name: 'Lift Slot',
      ...preload([0.01, 0, 0])
    })
  }
}

const close = (a: SimVec3, b: SimVec3, digits = 12): void => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
  expect(a.z).toBeCloseTo(b.z, digits)
}

describe('경고 키(6a)', () => {
  it('ko·en에 문장이 있다', () => {
    for (const key of [
      'worldTooManyPreloads',
      'worldPreloadOverlap',
      'worldPreloadEmbedded',
      'worldPreloadSqueezed',
      'worldPreloadBelowFloor',
      'worldPreloadNoRoom'
    ] as const) {
      expect(ko.console.notices[key].length).toBeGreaterThan(0)
      expect(en.console.notices[key].length).toBeGreaterThan(0)
    }
  })
})

describe('겹침 문구(6a 리뷰 2)', () => {
  it('심 문턱은 충돌체와 반지름의 30 %, 공끼리 두 공을 합쳐 60 %라고 말한다(공끼리 0.3–0.6·r 겹침을 30 %보다 얕다고 했다)', () => {
    for (const messages of [ko, en])
      for (const text of [
        messages.console.notices.worldPreloadOverlap,
        messages.console.notices.worldPreloadEmbedded,
        messages.preload.overlap,
        messages.preload.embedded
      ]) {
        expect(text).toContain('30 %')
        expect(text).toContain('60 %')
      }
  })
})

describe('robotPreloads: Preload Slot 자리', () => {
  it('하이어라키 순서, 몸체(섀시 −1·관절 순번)와 몸체 틀 위치, 편집 자세 로봇 좌표', () => {
    const objects = hopperScene()
    const result = robotPreloads(objects, 'R', BIOBUZZ)
    expect(result.source).toBe('slots')
    expect(result.face).toBeNull()
    expect(result.radius).toBe(POLLEN_R)
    expect(result.slots.map((slot) => [slot.objectId, slot.name, slot.body])).toEqual([
      ['slotA', 'Slot A', -1],
      ['slotB', 'Slot B', -1],
      ['liftSlot', 'Lift Slot', 0]
    ])
    close(result.slots[0].inRobot, { x: -0.05, y: 0.04, z: 0.1 })
    // 섀시 자리는 몸체 틀 = 로봇 좌표
    expect(result.slots[0].position).toEqual(result.slots[0].inRobot)
    // 리프트 하위: 로봇 좌표 = 리프트(0.1, 0, 0.05, 요 90°) ∘ (0.02 + 0.01, 0, 0.1) = (0.1, 0.03, 0.15)
    close(result.slots[2].inRobot, { x: 0.1, y: 0.03, z: 0.15 })
    // 관절 틀(앵커 0 = 리프트 오브젝트 틀)에서는 (0.03, 0, 0.1)
    close(result.slots[2].position, { x: 0.03, y: 0, z: 0.1 })
    // 같은 문서·시즌이면 같은 결과(인스펙터·로봇 카드·씬 뷰가 함께 쓴다)
    expect(robotPreloads(objects, 'R', BIOBUZZ)).toBe(result)
  })

  it('끈 자리·한도(4) 뒤의 자리·바닥 아래 자리는 빼고 이유를 남긴다(자동 배치로 바뀌지 않는다)', () => {
    const objects: SceneObjects = { ...hopperScene() }
    for (let k = 0; k < 3; k++)
      objects[`extra${k}`] = object(
        `extra${k}`,
        'group',
        'hopper',
        [0, 0, 0.2 + 0.08 * k],
        [0, 0, 0],
        {
          ...preload([0, 0, 0])
        }
      )
    objects.off = object('off', 'group', 'R', [0, 0, 0.3], [0, 0, 0], preload([0, 0, 0], false))
    // 바닥 아래(공 바닥이 1 mm 넘게 아래)
    objects.low = object('low', 'group', 'R', [0, 0.2, 0], [0, 0, 0], {
      name: 'Low',
      ...preload([0, 0, POLLEN_R - 0.002])
    })
    const result = robotPreloads(objects, 'R', BIOBUZZ)
    expect(result.slots).toHaveLength(MAX_PRELOADS)
    expect(result.tooMany).toBe(true)
    expect([...result.exclusions]).toEqual([
      ['extra2', 'tooMany'],
      ['liftSlot', 'tooMany'],
      ['off', 'disabled'],
      ['low', 'tooMany']
    ])
    // 한도 안이면 바닥 아래가 이유다. 닿기만 한(1 mm 안) 공은 쓴다
    const fewer: SceneObjects = {
      R: objects.R,
      low: objects.low,
      touch: object('touch', 'group', 'R', [0, -0.2, 0], [0, 0, 0], {
        ...preload([0, 0, POLLEN_R - 0.0009])
      }),
      off: objects.off
    }
    const second = robotPreloads(fewer, 'R', BIOBUZZ)
    expect(second.source).toBe('slots')
    expect(second.slots.map((slot) => slot.objectId)).toEqual(['touch'])
    expect(second.exclusions.get('low')).toBe('belowFloor')
    expect(second.exclusions.get('off')).toBe('disabled')
    // 모두 끈 로봇: 팀이 자리를 두었으니 자동 배치하지 않는다
    const allOff = robotPreloads({ R: objects.R, off: objects.off }, 'R', BIOBUZZ)
    expect(allOff).toMatchObject({ source: 'slots', slots: [] })
  })

  it("경기 요소가 없는 시즌('none')은 season", () => {
    expect(robotPreloads(hopperScene(), 'R', resolveSeason('none'))).toMatchObject({
      source: 'season',
      slots: []
    })
  })
})

describe('robotPreloads: 자동 배치(공유 autoPreloadSlots)', () => {
  it('자리가 없으면 시뮬레이터와 같은 함수의 앞 면 자리(로봇 좌표, 섀시)', () => {
    const objects: SceneObjects = { R: hopperScene().R }
    const result = robotPreloads(objects, 'R', BIOBUZZ)
    const shared = autoPreloadSlots(
      [
        { x: 0.2286, y: -0.2286 },
        { x: 0.2286, y: 0.2286 },
        { x: -0.2286, y: 0.2286 },
        { x: -0.2286, y: -0.2286 }
      ],
      BIOBUZZ,
      { x: -0.9, y: -0.9, yaw: Math.PI / 2 },
      ['garden']
    )!
    expect(result.source).toBe('auto')
    expect(result.face).toBe(shared.face)
    expect(result.face).toBe('front')
    expect(result.slots).toHaveLength(MAX_PRELOADS)
    result.slots.forEach((slot, i) => {
      expect(slot).toMatchObject({ objectId: null, name: '', body: -1 })
      close(slot.position, shared.slots[i])
      expect(slot.position.x).toBeCloseTo(0.2286 + POLLEN_R + SLOT_GAP, 12)
    })
  })

  it('앞이 벽에 막히면 뒤, 모든 면이 막히면 noRoom', () => {
    // 빨강 벽(−Y)을 보고 붙은 로봇: 앞(−Y)이 막힘
    const facingWall: SceneObjects = {
      R: object('R', 'robot', null, [-0.9, -1.79286 + 0.2286 + 0.001, 0], [0, 0, -Math.PI / 2])
    }
    expect(robotPreloads(facingWall, 'R', BIOBUZZ).face).toBe('back')
    // 필드보다 넓은 외곽(CAD 경계 3.6 m)
    const huge: SceneObjects = {
      R: object('R', 'robot', null, [0, 0, 0]),
      C: object('C', 'assembly', 'R', [0, 0, 0.1], [0, 0, 0], {
        cad: {
          fileName: 'big.step',
          absolutePath: '/big.step',
          upAxis: '+Z',
          forwardAxis: '+X',
          bounds: { min: [-1.8, -1.8, -0.1], max: [1.8, 1.8, 0.1] },
          meshCount: 1,
          meshIndexing: 'source'
        }
      })
    }
    expect(robotPreloads(huge, 'R', BIOBUZZ)).toMatchObject({ source: 'noRoom', slots: [] })
  })
})

// 상자 8꼭짓점(오브젝트 로컬, 반 크기)
function box(hx: number, hy: number, hz: number): ObjectHullPoints {
  const points: SimVec3[] = []
  for (let k = 0; k < 8; k++)
    points.push({ x: k & 1 ? hx : -hx, y: k & 2 ? hy : -hy, z: k & 4 ? hz : -hz })
  return { kind: 'points', points, error: 0 }
}

describe('withElements(INIT)', () => {
  const keys = (warnings: readonly WorldWarning[]): string[] => warnings.map((w) => w.key)
  const build = (
    objects: SceneObjects,
    shapes: ColliderShapeLookup | null = null
  ): WorldSpecResult => {
    const doc = { season: 'biobuzz' }
    return withRunField(
      buildWorldSpec(objects, 'R', SETTINGS, null, null, shapes),
      doc,
      runFieldOf(doc, { red: 'start', blue: 'start' }),
      keyT
    )
  }

  it('개인 설정을 끄거나 시즌에 경기 요소가 없으면 그대로(elements 키 없음)', () => {
    const built = build(hopperScene())
    expect(withElements(built, hopperScene(), 'R', { ...ON, gameElements: false }, keyT)).toBe(
      built
    )
    expect(withElements(built, hopperScene(), 'R', { ...ON, gameElements: undefined }, keyT)).toBe(
      built
    )
    const none = withRunField(
      buildWorldSpec(hopperScene(), 'R', SETTINGS),
      { season: 'none' },
      { season: 'none', hiveTipped: [false, false] },
      keyT
    )
    expect(
      withElements(none, hopperScene(), 'R', { ...ON, season: 'none' }, keyT).spec
    ).not.toHaveProperty('elements')
  })

  it('GARDEN 묶음과 자리 순서의 프리로드(몸체 틀)를 넣고, 메인과 같은 검사를 지난다', () => {
    const objects = hopperScene()
    const result = withElements(build(objects), objects, 'R', ON, keyT)
    expect(result.spec?.elements?.groups).toEqual(['garden'])
    expect(result.spec?.elements?.preloads.map((p) => [p.kind, p.body])).toEqual([
      ['pollen', -1],
      ['pollen', -1],
      ['pollen', 0]
    ])
    close(result.spec!.elements!.preloads[2].position, { x: 0.03, y: 0, z: 0.1 })
    expect(keys(result.warnings).filter((key) => key.startsWith('worldPreload'))).toEqual([])
    const parsed = parseWorldSpec(JSON.parse(JSON.stringify(result.spec)))
    expect(typeof parsed).not.toBe('string')
  })

  it('경고: 한도 → 바닥 아래 → 겹침(충돌 몸체·앞 자리) 순, 겹친 자리도 쓴다', () => {
    const objects: SceneObjects = {
      ...hopperScene(),
      base: object('base', 'part', 'R', [0.15, 0, 0.05], [0, 0, 0], {
        name: 'Base',
        visual: { type: 'mesh', geometryId: 'g:base', color: [1, 1, 1] }
      }),
      // 섀시 상자(x 0.1–0.2, z 0–0.1) 안의 자리
      inBase: object('inBase', 'group', 'R', [0.15, -0.15, 0.05], [0, 0, 0], {
        name: 'In Base',
        ...preload([0, 0.15, 0])
      }),
      low: object('low', 'group', 'R', [-0.2, 0.2, 0], [0, 0, 0], {
        name: 'Low',
        ...preload([0, 0, 0])
      })
    }
    // slotB를 slotA에 5 mm 겹치게(두 공의 심 합 2 × 0.3·r보다 얕다: 밀려난다)
    objects.slotB = {
      ...objects.slotB,
      transform: { position: [0, 0.04 - (2 * POLLEN_R - 0.005), 0], rotation: [0, 0, 0] }
    }
    const shapes: ColliderShapeLookup = (id) =>
      id === 'base' ? box(0.05, 0.05, 0.05) : { kind: 'none' }
    const result = withElements(build(objects, shapes), objects, 'R', ON, keyT)
    const preloadWarnings = result.warnings.filter(
      (w) => w.key.startsWith('worldPreload') || w.key === 'worldTooManyPreloads'
    )
    expect(preloadWarnings).toEqual([
      { key: 'worldTooManyPreloads', params: { max: MAX_PRELOADS } },
      { key: 'worldPreloadOverlap', params: { name: 'Slot B', target: 'Slot A' } },
      // 섀시 상자 한가운데(심보다 깊다): 시작해도 밀려나지 않고 박힌 채 남는다고 알린다
      { key: 'worldPreloadEmbedded', params: { name: 'In Base', target: 'R' } }
    ])
    // low는 한도 뒤라 바닥 아래 경고가 없다. 한도 안이면 경고한다
    const few: SceneObjects = { R: objects.R, low: objects.low }
    expect(withElements(build(few), few, 'R', ON, keyT).warnings).toContainEqual({
      key: 'worldPreloadBelowFloor',
      params: { name: 'Low' }
    })
    expect(result.spec?.elements?.preloads).toHaveLength(MAX_PRELOADS)
  })

  it('자동 배치를 못 찾으면 worldPreloadNoRoom과 프리로드 없이(GARDEN은 그대로)', () => {
    const huge: SceneObjects = {
      R: object('R', 'robot', null, [0, 0, 0]),
      C: object('C', 'assembly', 'R', [0, 0, 0.1], [0, 0, 0], {
        cad: {
          fileName: 'big.step',
          absolutePath: '/big.step',
          upAxis: '+Z',
          forwardAxis: '+X',
          bounds: { min: [-1.8, -1.8, -0.1], max: [1.8, 1.8, 0.1] },
          meshCount: 1,
          meshIndexing: 'source'
        }
      })
    }
    const result = withElements(build(huge), huge, 'R', ON, keyT)
    expect(keys(result.warnings)).toContain('worldPreloadNoRoom')
    expect(result.spec?.elements).toEqual({ groups: ['garden'], preloads: [] })
  })

  it('preloadOverlaps: 자동 자리도 충돌 몸체와 겹치면 이름 없이(번역은 withElements)', () => {
    const objects: SceneObjects = { R: hopperScene().R }
    const preloads = robotPreloads(objects, 'R', BIOBUZZ)
    const frames = restBodyFrames([])
    const far = preloadOverlaps(preloads, [], frames)
    expect(far.size).toBe(0)
    const wide = preloadOverlaps(
      preloads,
      [
        {
          body: -1,
          objectId: 'R',
          name: 'Robot',
          parent: null,
          source: 'colliders',
          colliders: [
            {
              objectId: 'R',
              colliderId: 'b',
              collider: {
                kind: 'box',
                center: { x: 0, y: 0, z: 0.1 },
                rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                half: { x: 0.4, y: 0.4, z: 0.1 },
                friction: 0.4
              },
              hullPoints: null,
              error: 0,
              hull: null
            }
          ],
          pendingMeshes: 0,
          degenerate: 0,
          outOfRange: 0,
          noMeshes: 0,
          floorGap: null,
          states: []
        }
      ],
      frames
    )
    // 자동 자리(z = r)가 상자(z 0–0.2) 안: 모두 심보다 깊다
    expect([...wide.values()]).toEqual(
      Array.from({ length: 4 }, () => ({ target: 'Robot', outcome: 'embedded' }))
    )
  })
})

describe('runElementsOf와 첫 틱(통합)', () => {
  it('실행의 공 = 공유 elementSpawns(배치 GARDEN 8 → 프리로드 자리 순서), JSON 왕복 뒤에도 같다', () => {
    const objects = hopperScene()
    const result = withElements(
      withRunField(
        buildWorldSpec(objects, 'R', SETTINGS),
        { season: 'biobuzz' },
        { season: 'biobuzz', hiveTipped: [false, false] },
        keyT
      ),
      objects,
      'R',
      ON,
      keyT
    )
    const run = runElementsOf(result.spec)!
    expect(run.kinds).toEqual([...Array(8).fill('pollen'), 'pollen', 'pollen', 'pollen'])
    expect(run.spawns.slice(0, 8).every((s) => s.asleep)).toBe(true)
    expect(run.spawns.slice(8).every((s) => !s.asleep)).toBe(true)
    // 프리로드 필드 좌표 = 시작 자세(요 90°) ∘ 로봇 좌표 자리
    const slotA = robotPreloads(objects, 'R', BIOBUZZ).slots[0].inRobot
    close(run.spawns[8].position, { x: -0.9 - slotA.y, y: -0.9 + slotA.x, z: slotA.z })
    const lift = robotPreloads(objects, 'R', BIOBUZZ).slots[2].inRobot
    close(run.spawns[10].position, { x: -0.9 - lift.y, y: -0.9 + lift.x, z: lift.z }, 9)
    const parsed = parseWorldSpec(JSON.parse(JSON.stringify(result.spec)))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(
      elementSpawns(BIOBUZZ, parsed.elements, parsed.robot.start, restBodyFrames(parsed.joints))
    ).toEqual(run.spawns)
    // 시뮬레이터의 첫 틱 공: elementSnapshot이 이 시작 상태와 바이트로 같다(t = 0은 상태만 만든다)
    const world = new PhysicsWorld(parsed)
    world.step(0, {})
    expect(world.elementSnapshot()).toEqual(run.spawns)
  })

  it('경기 요소가 없는 세계 설명은 null', () => {
    expect(runElementsOf(null)).toBeNull()
    expect(runElementsOf(buildWorldSpec(hopperScene(), 'R', SETTINGS).spec)).toBeNull()
  })
})

// 6a 리뷰 2: 겹친 대상을 모두 보고(뒤의 더 깊은 대상, 반대쪽 겹침, 깊이 겹친 앞 자리 공), 결과가 시뮬레이터와 같다
describe('preloadOverlaps: 결과 = 시뮬레이터(6a 리뷰 2)', () => {
  const core = resolveElementType(BIOBUZZ, 'pollen')!.contact.coreDepthRatio * POLLEN_R
  const r = POLLEN_R
  type Box = { id: string; center: Vec3; size: Vec3 }
  // 빨강 쪽 빈 타일의 바퀴 없는 로봇(고정 기저), 섀시 그룹 hopper(로봇 좌표 높이 z)에 Box Collider들과 Preload Slot들
  function scene(z: number, boxes: Box[], slots: Vec3[]): SceneObjects {
    const objects: SceneObjects = {
      R: object('R', 'robot', null, [-0.9, -0.9, 0]),
      hopper: object('hopper', 'group', 'R', [0, 0, z], [0, 0, 0], {
        name: 'Hopper',
        colliders: boxes.map((b) => ({ id: b.id, kind: 'box', center: b.center, size: b.size }))
      })
    }
    slots.forEach((center, i) => {
      objects[`s${i}`] = object(`s${i}`, 'group', 'hopper', [0, 0, 0], [0, 0, 0], {
        name: `Slot ${i}`,
        ...preload(center)
      })
    })
    return objects
  }
  // 경고와 2 s 실행 뒤 자리 공의 로봇 좌표 중심(공 0–7은 GARDEN)
  function run(objects: SceneObjects): { warnings: WorldWarning[]; balls: Vec3[] } {
    const doc = { season: 'biobuzz' }
    const built = withRunField(
      buildWorldSpec(objects, 'R', SETTINGS, null, null, () => ({ kind: 'none' })),
      doc,
      runFieldOf(doc, { red: 'start', blue: 'start' }),
      keyT
    )
    const result = withElements(built, objects, 'R', ON, keyT)
    const world = new PhysicsWorld(result.spec!)
    for (let k = 0; k <= 400; k++) world.step(k * 5_000_000, {})
    const balls = world
      .elementSnapshot()!
      .slice(8)
      .map((b): Vec3 => [b.position.x + 0.9, b.position.y + 0.9, b.position.z])
    return {
      warnings: result.warnings.filter((w) => w.key.startsWith('worldPreload')),
      balls
    }
  }
  // 옆판(y 방향으로 두께 1 cm, 바닥부터 높이 0.2 m): 안쪽 면이 y = face
  const side = (id: string, face: number, z: number): Box => ({
    id,
    center: [0, face + Math.sign(face) * 0.005, 0.1 - z],
    size: [0.2, 0.01, 0.2]
  })
  // 먼 곳의 상자(섀시 몸체에 Collider가 있어 외곽 대체 상자가 공을 삼키지 않게)
  const far: Box = { id: 'far', center: [-0.5, 0, 0], size: [0.02, 0.02, 0.02] }

  it('앞에 적은 옆면과 3 mm, 뒤에 적은 바닥판과 15 mm(심 이상) 겹치면 embedded: 바닥판에 박힌 채 남는다', () => {
    const objects = scene(
      0.2,
      [
        { id: 'wall', center: [r - 0.003 + 0.005, 0, 0], size: [0.01, 0.2, 0.2] },
        { id: 'floor', center: [-0.05, 0, -r + 0.015 - 0.02], size: [0.2, 0.2, 0.04] }
      ],
      [[0, 0, 0]]
    )
    const { warnings, balls } = run(objects)
    // 첫 대상(옆면)만 보면 '밀려납니다'(worldPreloadOverlap)였다
    expect(warnings).toEqual([
      { key: 'worldPreloadEmbedded', params: { name: 'Slot 0', target: 'R' } }
    ])
    expect(0.2 - r + 0.015 - (balls[0][2] - r)).toBeGreaterThan(core)
  })

  it('마주 본 두 옆판과 8 mm씩(심보다 얕다) 겹치면 squeezed: 빠져나가지 못하고 눌린 채 남는다', () => {
    const objects = scene(r, [side('a', r - 0.008, r), side('b', -(r - 0.008), r)], [[0, 0, 0]])
    const { warnings, balls } = run(objects)
    expect(warnings).toEqual([
      { key: 'worldPreloadSqueezed', params: { name: 'Slot 0', target: 'R' } }
    ])
    expect(r - 0.008 - (balls[0][1] - r)).toBeGreaterThan(0.005)
    expect(balls[0][1] + r - -(r - 0.008)).toBeGreaterThan(0.005)
  })

  it('한쪽 옆판과만 3 mm 겹치면 pushedOut: 밀려난다', () => {
    const objects = scene(r, [side('a', r - 0.003, r), far], [[0, 0, 0]])
    const { warnings, balls } = run(objects)
    expect(warnings).toEqual([
      { key: 'worldPreloadOverlap', params: { name: 'Slot 0', target: 'R' } }
    ])
    expect(balls[0][1] + r).toBeLessThan(r - 0.003 + 1e-3)
  })

  it('앞 자리 공과 0.45·r(두 공의 심 합 0.6·r보다 얕다) 겹치면 pushedOut, 0.7·r이면 옆판과 얕게 먼저 겹쳐도 embedded', () => {
    const shallow = scene(
      r,
      [far],
      [
        [0, 0, 0],
        [2 * r - 0.45 * r, 0, 0]
      ]
    )
    const pushed = run(shallow)
    expect(pushed.warnings).toEqual([
      { key: 'worldPreloadOverlap', params: { name: 'Slot 1', target: 'Slot 0' } }
    ])
    const [a, b] = pushed.balls
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 2 * r).toBeGreaterThan(-1e-3)
    // Slot 1은 +y 옆판(충돌체, 대상 순서 앞)과 3 mm, Slot 0과 0.7·r 겹친다(첫 대상만 보면 '밀려납니다'였다). Slot 0 뒤(−y)의
    // 뒤판(0.5 mm 띄움)이 옆판에 밀린 두 공을 받친다: 받치지 않으면 옆판이 탄성으로 민 두 공이 굴러가며 조금씩 벌어져 심 아래로
    // 풀릴 수 있다(박힌 짝은 움직이지 않을 때 박힌 채 남는다)
    const y1 = 2 * r - 0.7 * r
    const deep = scene(
      r,
      [side('a', y1 + r - 0.003, r), side('back', -(r + 0.0005), r)],
      [
        [0, 0, 0],
        [0, y1, 0]
      ]
    )
    const embedded = run(deep)
    expect(embedded.warnings).toContainEqual({
      key: 'worldPreloadEmbedded',
      params: { name: 'Slot 1', target: 'Slot 0' }
    })
    const [c, d] = embedded.balls
    expect(Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]) - 2 * r).toBeLessThan(-2 * core)
  })

  // 6a 최종 확인: 시작 겹침은 눌린 이력이 아니다. 전에는 첫 하위 단계의 겹침을 끼인 행 이력 스프링의 최대 깊이로 적어, 풀림 선의
  // 쉼 깊이(로봇 반발 0.5면 시작 겹침의 0.75배)까지만 밀어냈다(실제 앱 E2E: 플라이휠–후드 쐐기 자리 공이 '밀려납니다'라는 결과와
  // 달리 시작 겹침의 0.75배로 박힌 채 남음). 바닥에 놓인 자리 위를 천장 판이 3 mm 누르면 공은 판과 바닥 사이에 끼여 두 탄성
  // 접촉이 3 mm를 나눈다(바닥 쪽이 공 무게만큼 더): 판 쪽 약 1.48 mm, 바닥 쪽 약 1.52 mm(전에는 판 2.39 mm, 바닥 0.61 mm)
  it('바닥에 놓인 자리를 천장 판이 3 mm 누르면 squeezed: 판과 바닥이 탄성으로 겹침을 나눈다', () => {
    const objects = scene(
      r,
      [{ id: 'ceiling', center: [0, 0, r - 0.003 + 0.005], size: [0.2, 0.2, 0.01] }],
      [[0, 0, 0]]
    )
    const { warnings, balls } = run(objects)
    expect(warnings).toEqual([
      { key: 'worldPreloadSqueezed', params: { name: 'Slot 0', target: 'R' } }
    ])
    const k = 2 * resolveElementType(BIOBUZZ, 'pollen')!.contact.plateStiffness
    const weight = (resolveElementType(BIOBUZZ, 'pollen')!.mass * 9.80665) / k
    const floor = r - balls[0][2]
    const ceiling = balls[0][2] + r - (2 * r - 0.003)
    expect(floor + ceiling).toBeCloseTo(0.003, 6)
    expect(floor - ceiling).toBeCloseTo(weight, 5)
  })

  it('뒤판에 붙은 자리가 앞 자리 공과 얕게 겹치면 앞 공이 비켜 pushedOut이다(앞 공도 움직인다)', () => {
    // Slot 1은 −y 옆판 바로 앞(닿기만), Slot 0은 그 +y 쪽에 5 mm 겹침
    const objects = scene(
      r,
      [side('back', -(r + 0.0005), r)],
      [
        [0, 2 * r - 0.005, 0],
        [0, 0, 0]
      ]
    )
    const { warnings, balls } = run(objects)
    expect(warnings).toEqual([
      { key: 'worldPreloadOverlap', params: { name: 'Slot 1', target: 'Slot 0' } }
    ])
    const [a, b] = balls
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 2 * r).toBeGreaterThan(-1e-3)
  })
})
