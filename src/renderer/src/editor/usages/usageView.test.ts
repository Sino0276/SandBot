import { describe, expect, it } from 'vitest'
import { propertyDefaults, type ComponentType } from '../../hardware/catalog'
import {
  deviceUsageKey,
  groupUsageKey,
  MISSING_GENERATED_TYPE,
  robotUsageKey,
  type UsageCounts,
  type UsageHit,
  type UsageKey,
  type UsageKind,
  type UsageResult
} from '../../java/usages/usageTypes'
import type { HardwareComponent, SceneObject, SceneObjects } from '../../scene/model'
import {
  canExpand,
  deviceUsageView,
  FILE_GROUP_CAPS,
  fileGroups,
  groupsStartOpen,
  groupUsageView,
  hasUsageSection,
  robotUsageView,
  scriptUsesHardware,
  searchedTerms,
  snippetWindow,
  usageFocusFallback,
  usageRowTarget,
  usageTreeKey,
  usageTreeRows,
  type UsageSectionView,
  type UsageView
} from './usageView'

// ---- 씬 ----

function component(
  id: string,
  type: ComponentType,
  name: string,
  port: number,
  props: Record<string, string | number> = {}
): HardwareComponent {
  return { id, type, name, hub: 'controlHub', port, props: { ...propertyDefaults(type), ...props } }
}

function object(
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  extra: Partial<SceneObject> = {}
): SceneObject {
  return {
    id,
    name: id,
    kind,
    parentId,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    ...extra
  }
}

const robot = (id: string, className: string): SceneObject =>
  object(id, 'robot', null, {
    name: `${className} 로봇`,
    hardware: { className, configName: className, expansionHub: { enabled: false, address: 2 } }
  })
const group = (
  id: string,
  parentId: string,
  name: string,
  extra: Partial<SceneObject> = {}
): SceneObject => object(id, 'group', parentId, { name, ...extra })
const part = (id: string, parentId: string, ...components: HardwareComponent[]): SceneObject =>
  object(id, 'part', parentId, { components })

// 키 순서 = 형제 순서
function scene(...objects: SceneObject[]): SceneObjects {
  const result: SceneObjects = {}
  for (const o of objects) result[o.id] = o
  return result
}

// MyBot 로봇: drive(frontLeft) → Lift 그룹(liftLeft, perp 데드휠)
function baseScene(
  overrides: { liftName?: string; liftClass?: string; className?: string } = {}
): SceneObject[] {
  return [
    robot('robot', overrides.className ?? 'MyBot'),
    part('drive', 'robot', component('fl', 'motor', 'frontLeft', 0)),
    group('lift', 'robot', overrides.liftName ?? 'Lift', {
      ...(overrides.liftClass ? { codeClassName: overrides.liftClass } : {})
    }),
    part('liftMotor', 'lift', component('ll', 'motor', 'liftLeft', 1)),
    part('perpPart', 'lift', component('pe', 'deadWheel', 'perp', 2))
  ]
}

const FL = deviceUsageKey('drive', 'fl')
const LL = deviceUsageKey('liftMotor', 'll')
const PE = deviceUsageKey('perpPart', 'pe')
const LIFT = groupUsageKey('lift')
const ROBOT = robotUsageKey('robot')

// 같은 오브젝트를 이름만 바꿔 새 문서로(불변 문서처럼)
function renamed(objects: SceneObjects, id: string, patch: Partial<SceneObject>): SceneObjects {
  return { ...objects, [id]: { ...objects[id], ...patch } }
}

function renameComponent(
  objects: SceneObjects,
  objectId: string,
  componentId: string,
  name: string
): SceneObjects {
  const target = objects[objectId]
  return renamed(objects, objectId, {
    components: target.components!.map((c) => (c.id === componentId ? { ...c, name } : c))
  })
}

// ---- 결과 ----

const PATH_A = 'src/main/java/org/firstinspires/ftc/teamcode/LiftOp.java'
const PATH_B = 'src/main/java/org/firstinspires/ftc/teamcode/sub/Drive.java'

function hit(path: string, line: number, kind: UsageKind, extra: Partial<UsageHit> = {}): UsageHit {
  return { path, line, col: 5, kind, snippet: 'robot.x', mark: [6, 7], ...extra }
}

const zero = (): UsageCounts => ({
  field: 0,
  constant: 0,
  type: 0,
  new: 0,
  lookup: 0,
  text: 0,
  unresolved: 0
})

function result(
  parts: {
    hits?: [UsageKey, UsageHit[]][]
    totals?: [UsageKey, Partial<UsageCounts>][]
    unresolved?: [UsageKey, UsageHit[]][]
    unknownNames?: [string, UsageHit[]][]
  } = {}
): UsageResult {
  const totals = new Map<UsageKey, UsageCounts>()
  for (const [key, hits] of parts.hits ?? []) {
    const counts = zero()
    for (const h of hits) counts[h.kind]++
    totals.set(key, counts)
  }
  for (const [key, hits] of parts.unresolved ?? [])
    totals.set(key, { ...(totals.get(key) ?? zero()), unresolved: hits.length })
  for (const [key, counts] of parts.totals ?? [])
    totals.set(key, { ...(totals.get(key) ?? zero()), ...counts })
  return {
    hits: new Map(parts.hits ?? []),
    totals,
    unresolved: new Map(parts.unresolved ?? []),
    unknownNames: new Map(parts.unknownNames ?? []),
    files: { scanned: 2, tooLarge: [], unicodeEscape: [], failed: [] }
  }
}

const ids = (view: UsageView | null): string[] => view?.sections.map((s) => s.id) ?? []
const section = (view: UsageView | null, id: string): UsageSectionView | undefined =>
  view?.sections.find((s) => s.id === id)

describe('장치 카드', () => {
  it('머리줄: 코드는 필드·상수, 이름은 찾기 문자열. 같은 글자의 다른 문자열은 접고 세지 않는다', () => {
    const objects = scene(...baseScene())
    const view = deviceUsageView(
      objects,
      result({
        hits: [
          [
            LL,
            [
              hit(PATH_A, 3, 'field'),
              hit(PATH_A, 9, 'field'),
              hit(PATH_B, 2, 'lookup'),
              hit(PATH_B, 4, 'text'),
              hit(PATH_B, 5, 'text')
            ]
          ]
        ]
      }),
      null,
      'liftMotor',
      'll'
    )!
    expect(view.counts).toEqual({ code: 2, byName: 1, descendants: 0, warnings: 0 })
    expect(ids(view)).toEqual(['code', 'byName', 'sameText'])
    expect(section(view, 'sameText')).toMatchObject({ tone: 'folded', total: 2 })
    expect(section(view, 'code')!.defaultKind).toBe('field')
    expect(view.name).toBe('liftLeft')
    expect(view.empty).toBe(false)
    expect(view.unavailable).toBe(false)
  })

  it('한도로 자른 사용처는 totals의 개수로 센다', () => {
    const objects = scene(...baseScene())
    const view = deviceUsageView(
      objects,
      result({
        hits: [[LL, [hit(PATH_A, 3, 'field'), hit(PATH_A, 4, 'constant')]]],
        totals: [[LL, { field: 250, constant: 10 }]]
      }),
      null,
      'liftMotor',
      'll'
    )!
    expect(view.counts.code).toBe(260)
    expect(section(view, 'code')).toMatchObject({ total: 260 })
    expect(section(view, 'code')!.hits).toHaveLength(2)
    // 남은 행의 마지막 파일은 뒤가 잘렸을 수 있다
    expect(section(view, 'code')!.cut).toEqual([PATH_A])
  })

  it('찾은 것이 없으면 빈 보기이고, 찾은 이름은 생성 필드·상수·구성 이름이다', () => {
    const objects = scene(...baseScene())
    const empty = deviceUsageView(objects, result(), null, 'liftMotor', 'll')!
    expect(empty.empty).toBe(true)
    expect(empty.sections).toEqual([])
    expect(searchedTerms(empty)).toBe('robot.lift.liftLeft, "liftLeft"')
    const perp = deviceUsageView(objects, result(), null, 'perpPart', 'pe')!
    expect(perp.terms).toEqual([
      'robot.lift.perp',
      'MyBot.Lift.PERP_X_MM',
      'MyBot.Lift.PERP_Y_MM',
      'MyBot.Lift.PERP_X_IN',
      'MyBot.Lift.PERP_Y_IN',
      'MyBot.Lift.PERP_MEASURES_FORWARD',
      'MyBot.Lift.PERP_REVERSED',
      '"perp"'
    ])
  })

  it('데드휠은 같은 포트 모터의 구성 이름으로 찾는다', () => {
    const objects = scene(
      robot('robot', 'MyBot'),
      part('m', 'robot', component('mm', 'motor', 'leftFront', 2)),
      part('w', 'robot', component('dw', 'deadWheel', 'par', 2))
    )
    const view = deviceUsageView(objects, result(), null, 'w', 'dw')!
    expect(view.terms.at(-1)).toBe('"leftFront"')
    // 같은 이름을 같은 포트의 모터와 데드휠이 함께 쓴다(로봇은 하나라 다른 로봇 안내가 아니다)
    expect(view).toMatchObject({ sharedName: false, samePortName: true })
    expect(deviceUsageView(objects, result(), null, 'm', 'mm')).toMatchObject({
      sharedName: false,
      samePortName: true
    })
  })

  it('다른 로봇에 같은 구성 이름이 있으면 sharedName', () => {
    const objects = scene(
      ...baseScene(),
      robot('other', 'OtherBot'),
      part('otherPart', 'other', component('ol', 'motor', 'liftLeft', 0))
    )
    expect(deviceUsageView(objects, result(), null, 'liftMotor', 'll')).toMatchObject({
      sharedName: true,
      samePortName: false
    })
    expect(deviceUsageView(objects, result(), null, 'drive', 'fl')!.sharedName).toBe(false)
  })

  it('데드휠 쌍과 다른 로봇이 함께 이름을 쓰면 둘 다, 같은 로봇의 겹친 이름(검증 오류)은 둘 다 아니다', () => {
    const objects = scene(
      robot('robot', 'MyBot'),
      part('m', 'robot', component('mm', 'motor', 'leftFront', 2)),
      part('w', 'robot', component('dw', 'deadWheel', 'par', 2)),
      part(
        'dup',
        'robot',
        component('d1', 'servo', 'claw', 0),
        component('d2', 'servo', 'claw', 1)
      ),
      robot('other', 'OtherBot'),
      part('otherPart', 'other', component('ol', 'motor', 'leftFront', 0))
    )
    expect(deviceUsageView(objects, result(), null, 'w', 'dw')).toMatchObject({
      sharedName: true,
      samePortName: true
    })
    expect(deviceUsageView(objects, result(), null, 'dup', 'd1')).toMatchObject({
      sharedName: false,
      samePortName: false
    })
  })

  it('로봇 밖 장치와 카탈로그에 없는 종류는 사용처가 없다', () => {
    const objects = scene(
      ...baseScene(),
      part('loose', 'nowhere', component('lo', 'motor', 'loose', 0))
    )
    expect(deviceUsageView(objects, result(), null, 'loose', 'lo')).toBeNull()
    expect(deviceUsageView(objects, result(), null, 'liftMotor', 'nope')).toBeNull()
    expect(hasUsageSection(objects, { kind: 'device', objectId: 'loose', componentId: 'lo' })).toBe(
      false
    )
    expect(
      hasUsageSection(objects, { kind: 'device', objectId: 'liftMotor', componentId: 'll' })
    ).toBe(true)
  })

  it('두 로봇이 같은 클래스 이름이면 코드 사용처를 찾을 수 없다고 알린다(빈 보기가 아니다)', () => {
    const objects = scene(
      ...baseScene({ className: 'RobotHardware' }),
      robot('other', 'RobotHardware'),
      part('otherPart', 'other', component('ol', 'motor', 'x', 0))
    )
    const view = deviceUsageView(objects, result(), null, 'liftMotor', 'll')!
    expect(view.unavailable).toBe(true)
    expect(view.empty).toBe(false)
    expect(robotUsageView(objects, result(), null, 'robot')!.unavailable).toBe(true)
  })
})

describe('장치 이름 바꾸기(기준 씬과 비교)', () => {
  const baseline = scene(...baseScene())

  it('필드 이름을 바꾸면 저장한 범위의 없는 이름 중 이전 필드를 이 카드에 붙인다', () => {
    const objects = renameComponent(baseline, 'liftMotor', 'll', 'liftL')
    const res = result({
      unresolved: [
        [
          LIFT,
          [
            hit(PATH_A, 3, 'unresolved', { member: 'liftLeft' }),
            hit(PATH_B, 7, 'unresolved', { member: 'liftLeft' }),
            hit(PATH_B, 8, 'unresolved', { member: 'other' })
          ]
        ]
      ],
      unknownNames: [['liftLeft', [hit(PATH_B, 1, 'lookup')]]]
    })
    const view = deviceUsageView(objects, res, baseline, 'liftMotor', 'll')!
    expect(ids(view)).toEqual(['renamedCode', 'renamedName'])
    expect(section(view, 'renamedCode')).toMatchObject({
      tone: 'warning',
      old: 'robot.lift.liftLeft',
      total: 2
    })
    // 구성 이름도 바뀌었다(실행할 때 장치를 찾지 못한다)
    expect(section(view, 'renamedName')).toMatchObject({ old: 'liftLeft', total: 1 })
    expect(view.counts.warnings).toBe(3)
    expect(view.terms[0]).toBe('robot.lift.liftL')
  })

  it('저장한 이름으로 되돌리면(Ctrl+Z) 붙이지 않는다', () => {
    const res = result({
      unresolved: [[LIFT, [hit(PATH_A, 3, 'unresolved', { member: 'liftLeft' })]]],
      unknownNames: [['liftLeft', [hit(PATH_B, 1, 'lookup')]]]
    })
    const view = deviceUsageView(scene(...baseScene()), res, baseline, 'liftMotor', 'll')!
    expect(ids(view)).toEqual([])
    expect(deviceUsageView(scene(...baseScene()), res, null, 'liftMotor', 'll')!.sections).toEqual(
      []
    )
  })

  it('그룹 밖으로 옮긴 장치: 이전 범위(Lift)에 없는 이름', () => {
    const objects = renamed(baseline, 'liftMotor', { parentId: 'robot' })
    const res = result({
      unresolved: [
        [LIFT, [hit(PATH_A, 3, 'unresolved', { member: 'liftLeft' })]],
        [ROBOT, [hit(PATH_A, 4, 'unresolved', { member: 'liftLeft' })]]
      ]
    })
    const view = deviceUsageView(objects, res, baseline, 'liftMotor', 'll')!
    expect(section(view, 'renamedCode')).toMatchObject({ old: 'robot.lift.liftLeft', total: 1 })
    expect(section(view, 'renamedCode')!.hits[0].line).toBe(3)
  })

  it('그룹 안으로 옮긴 장치: 이전 범위(로봇 클래스)에 없는 이름', () => {
    const objects = renamed(baseline, 'drive', { parentId: 'lift' })
    const res = result({
      unresolved: [[ROBOT, [hit(PATH_B, 2, 'unresolved', { member: 'frontLeft' })]]]
    })
    const view = deviceUsageView(objects, res, baseline, 'drive', 'fl')!
    expect(section(view, 'renamedCode')).toMatchObject({ old: 'robot.frontLeft', total: 1 })
  })

  it('장치가 하나뿐인 그룹에서 꺼낸 장치: 그룹이 클래스를 잃어 로봇 클래스에 없는 lift·Lift', () => {
    const start = scene(
      robot('robot', 'MyBot'),
      group('lift', 'robot', 'Lift'),
      part('liftMotor', 'lift', component('ll', 'motor', 'liftLeft', 1)),
      group('wrist', 'robot', 'Wrist'),
      part('wristPart', 'wrist', component('ws', 'servo', 'wristServo', 0))
    )
    // javac는 robot.lift.liftLeft의 lift와 MyBot.Lift.X의 Lift에서 멈춘다(맞추기도 r:robot에 둔다)
    const res = result({
      unresolved: [
        [
          ROBOT,
          [
            hit(PATH_A, 5, 'unresolved', { member: 'lift' }),
            hit(PATH_A, 6, 'unresolved', { member: 'Lift' }),
            hit(PATH_B, 2, 'unresolved', { member: 'frontRight' })
          ]
        ]
      ]
    })
    // 다른 그룹 안으로, 로봇 바로 아래로
    for (const parentId of ['wrist', 'robot']) {
      const moved = renamed(start, 'liftMotor', { parentId })
      expect(groupUsageView(moved, res, start, 'lift')).toBeNull()
      const view = deviceUsageView(moved, res, start, 'liftMotor', 'll')!
      expect(section(view, 'renamedCode')).toMatchObject({
        old: 'robot.lift, MyBot.Lift',
        total: 2
      })
      expect(view.counts.warnings).toBe(2)
      expect(view.empty).toBe(false)
    }
  })

  it('클래스를 잃은 그룹이 여럿이면 지금도 있는 범위 바로 아래의 사라진 그룹 이름', () => {
    const start = scene(
      robot('robot', 'MyBot'),
      part('drive', 'robot', component('fl', 'motor', 'frontLeft', 0)),
      group('arm', 'robot', 'Arm'),
      group('lift', 'arm', 'Lift'),
      part('liftMotor', 'lift', component('ll', 'motor', 'liftLeft', 1))
    )
    const moved = renamed(start, 'liftMotor', { parentId: 'robot' })
    const res = result({
      unresolved: [
        [
          ROBOT,
          [
            hit(PATH_A, 5, 'unresolved', { member: 'arm' }),
            // 기준 씬에서도 컴파일되지 않던 이름(robot.lift)은 붙이지 않는다
            hit(PATH_A, 6, 'unresolved', { member: 'lift' })
          ]
        ]
      ]
    })
    expect(
      section(deviceUsageView(moved, res, start, 'liftMotor', 'll'), 'renamedCode')
    ).toMatchObject({ old: 'robot.arm', total: 1 })

    // Arm에 장치가 있으면 Arm은 남고 Arm 안에서 lift·Lift를 찾지 못한다
    const withArm = scene(
      ...Object.values(start),
      part('armMotor', 'arm', component('am', 'motor', 'arm', 2))
    )
    const armRes = result({
      unresolved: [[groupUsageKey('arm'), [hit(PATH_A, 5, 'unresolved', { member: 'lift' })]]]
    })
    expect(
      section(
        deviceUsageView(
          renamed(withArm, 'liftMotor', { parentId: 'robot' }),
          armRes,
          withArm,
          'liftMotor',
          'll'
        ),
        'renamedCode'
      )
    ).toMatchObject({ old: 'robot.arm.lift', total: 1 })
  })

  it('상수도 이전 이름이다(제목에는 사용처가 쓰는 이전 이름만)', () => {
    const objects = renameComponent(baseline, 'perpPart', 'pe', 'perp2')
    const onlyConstant = result({
      unresolved: [[LIFT, [hit(PATH_A, 5, 'unresolved', { member: 'PERP_X_MM' })]]]
    })
    expect(
      section(deviceUsageView(objects, onlyConstant, baseline, 'perpPart', 'pe'), 'renamedCode')
    ).toMatchObject({ old: 'MyBot.Lift.PERP_X_MM', total: 1 })
    const both = result({
      unresolved: [
        [
          LIFT,
          [
            hit(PATH_A, 5, 'unresolved', { member: 'PERP_X_MM' }),
            hit(PATH_A, 6, 'unresolved', { member: 'perp' })
          ]
        ]
      ]
    })
    expect(
      section(deviceUsageView(objects, both, baseline, 'perpPart', 'pe'), 'renamedCode')!.old
    ).toBe('robot.lift.perp, MyBot.Lift.PERP_X_MM')
  })

  it('구성 이름만 남은 다른 장치가 쓰면 구성에 없는 이름이 아니라 붙이지 않는다', () => {
    const objects = renameComponent(baseline, 'liftMotor', 'll', 'liftL')
    const view = deviceUsageView(objects, result(), baseline, 'liftMotor', 'll')!
    expect(view.sections).toEqual([])
  })
})

describe('그룹 카드', () => {
  const baseline = scene(...baseScene())

  it('코드(필드·형식·생성)와 하위 장치 개수, 이 클래스에 없는 이름', () => {
    const res = result({
      hits: [
        [LIFT, [hit(PATH_A, 1, 'field'), hit(PATH_A, 2, 'type'), hit(PATH_B, 3, 'new')]],
        [LL, [hit(PATH_A, 4, 'field'), hit(PATH_A, 5, 'lookup'), hit(PATH_A, 6, 'text')]],
        [PE, [hit(PATH_B, 7, 'constant')]],
        [FL, [hit(PATH_B, 8, 'field')]]
      ],
      unresolved: [[LIFT, [hit(PATH_A, 9, 'unresolved', { member: 'gone' })]]]
    })
    const view = groupUsageView(baseline, res, baseline, 'lift')!
    expect(ids(view)).toEqual(['unresolvedInClass', 'code'])
    // 하위 장치: liftLeft 필드·찾기 2 + perp 상수 1(같은 글자의 다른 문자열과 다른 그룹 밖 장치는 넣지 않는다)
    expect(view.counts).toEqual({ code: 3, byName: 0, descendants: 3, warnings: 1 })
    expect(view.terms).toEqual(['robot.lift', 'MyBot.Lift'])
  })

  it('그룹 이름을 바꾸면 저장한 부모 범위의 없는 이름 중 이전 필드·클래스 이름을 붙인다', () => {
    const objects = renamed(baseline, 'lift', { name: 'Elevator' })
    const res = result({
      unresolved: [
        [
          ROBOT,
          [
            hit(PATH_A, 1, 'unresolved', { member: 'lift' }),
            hit(PATH_A, 2, 'unresolved', { member: 'Lift' }),
            hit(PATH_B, 3, 'unresolved', { member: 'frontRight' })
          ]
        ]
      ]
    })
    const view = groupUsageView(objects, res, baseline, 'lift')!
    expect(section(view, 'renamedCode')).toMatchObject({
      old: 'robot.lift, MyBot.Lift',
      total: 2
    })
    expect(view.counts.warnings).toBe(2)
  })

  it('클래스 이름 덮어쓰기도 이름 바꾸기다', () => {
    const objects = renamed(baseline, 'lift', { codeClassName: 'Elevator' })
    const res = result({
      unresolved: [[ROBOT, [hit(PATH_A, 2, 'unresolved', { member: 'Lift' })]]]
    })
    expect(section(groupUsageView(objects, res, baseline, 'lift'), 'renamedCode')).toMatchObject({
      old: 'MyBot.Lift',
      total: 1
    })
  })

  it('다른 그룹 안으로 옮긴 그룹: 이전 부모(로봇 클래스)의 없는 이름', () => {
    const start = scene(
      ...baseScene(),
      group('arm', 'robot', 'Arm'),
      part('armMotor', 'arm', component('am', 'motor', 'arm', 3))
    )
    const moved = renamed(start, 'lift', { parentId: 'arm' })
    const res = result({
      unresolved: [[ROBOT, [hit(PATH_A, 1, 'unresolved', { member: 'lift' })]]]
    })
    expect(section(groupUsageView(moved, res, start, 'lift'), 'renamedCode')).toMatchObject({
      old: 'robot.lift',
      total: 1
    })
  })

  it('장치 없는 부모(Arm)에서 꺼낸 그룹: 부모가 클래스를 잃어 로봇 클래스에 없는 arm·Arm', () => {
    const start = scene(
      robot('robot', 'MyBot'),
      part('drive', 'robot', component('fl', 'motor', 'frontLeft', 0)),
      group('arm', 'robot', 'Arm'),
      group('wrist', 'arm', 'Wrist'),
      part('clawPart', 'wrist', component('cl', 'servo', 'claw', 0))
    )
    const moved = renamed(start, 'wrist', { parentId: 'robot' })
    // robot.arm.wrist.claw, MyBot.Arm.Wrist w = robot.arm.wrist
    const res = result({
      unresolved: [
        [
          ROBOT,
          [
            hit(PATH_A, 5, 'unresolved', { member: 'arm' }),
            hit(PATH_A, 6, 'unresolved', { member: 'Arm' }),
            hit(PATH_A, 6, 'unresolved', { member: 'arm', col: 30 })
          ]
        ]
      ]
    })
    const view = groupUsageView(moved, res, start, 'wrist')!
    expect(section(view, 'renamedCode')).toMatchObject({
      old: 'robot.arm, MyBot.Arm',
      total: 3
    })
    expect(view.empty).toBe(false)
  })

  it('장치가 없어 클래스를 만들지 않는 그룹과 로봇 밖 그룹은 사용처가 없다', () => {
    const objects = scene(
      ...baseScene(),
      group('empty', 'robot', 'Empty'),
      group('free', 'nowhere', 'Free')
    )
    expect(groupUsageView(objects, result(), null, 'empty')).toBeNull()
    expect(groupUsageView(objects, result(), null, 'free')).toBeNull()
    expect(hasUsageSection(objects, { kind: 'group', groupId: 'empty' })).toBe(false)
    expect(hasUsageSection(objects, { kind: 'group', groupId: 'lift' })).toBe(true)
  })
})

describe('로봇 카드', () => {
  const baseline = scene(...baseScene())

  it('만드는 곳·코드(형식, CONFIGURATION_NAME), 하위 장치, 접어 둔 구성에 없는 이름', () => {
    const res = result({
      hits: [
        [
          ROBOT,
          [
            hit(PATH_A, 1, 'new'),
            hit(PATH_A, 2, 'type'),
            hit(PATH_B, 3, 'type'),
            hit(PATH_B, 4, 'constant')
          ]
        ],
        [FL, [hit(PATH_B, 5, 'field')]],
        [LL, [hit(PATH_A, 6, 'lookup')]]
      ],
      unknownNames: [
        ['ghost', [hit(PATH_B, 9, 'lookup'), hit(PATH_A, 8, 'lookup')]],
        ['spare', [hit(PATH_A, 7, 'lookup')]]
      ]
    })
    const view = robotUsageView(baseline, res, null, 'robot')!
    expect(ids(view)).toEqual(['constructs', 'code', 'unknownNames'])
    expect(view.counts).toEqual({ code: 4, byName: 0, descendants: 2, warnings: 0 })
    const unknown = section(view, 'unknownNames')!
    expect(unknown).toMatchObject({ tone: 'folded', total: 3 })
    expect(unknown.hits.map((h) => [h.path, h.line])).toEqual([
      [PATH_A, 7],
      [PATH_A, 8],
      [PATH_B, 9]
    ])
    expect(section(view, 'code')!.defaultKind).toBe('type')
    expect(view.terms).toEqual(['MyBot', 'MyBot.CONFIGURATION_NAME'])
  })

  it('생성 코드에 없는 이름: 이 로봇의 모든 범위와 생성 패키지에 없는 형식(*)을 모은다', () => {
    const objects = scene(
      ...baseScene(),
      robot('other', 'OtherBot'),
      group('otherGroup', 'other', 'Arm'),
      part('otherPart', 'otherGroup', component('ol', 'motor', 'arm', 0))
    )
    const res = result({
      unresolved: [
        [LIFT, [hit(PATH_A, 3, 'unresolved', { member: 'gone' })]],
        [ROBOT, [hit(PATH_B, 1, 'unresolved', { member: 'missing' })]],
        [groupUsageKey('otherGroup'), [hit(PATH_B, 5, 'unresolved', { member: 'x' })]],
        [MISSING_GENERATED_TYPE, [hit(PATH_A, 1, 'unresolved', { member: 'Ghost' })]]
      ],
      totals: [[ROBOT, { unresolved: 40 }]]
    })
    const view = robotUsageView(objects, res, null, 'robot')!
    const unresolved = section(view, 'unresolved')!
    expect(unresolved.hits.map((h) => [h.path, h.line])).toEqual([
      [PATH_A, 1],
      [PATH_A, 3],
      [PATH_B, 1]
    ])
    // 로봇 키는 한도로 잘려 40개였다(남은 마지막 행의 파일은 뒤가 잘렸을 수 있다)
    expect(unresolved.total).toBe(42)
    expect(unresolved.cut).toEqual([PATH_B])
    expect(view.counts.warnings).toBe(42)
    // 다른 로봇 카드는 자기 범위와 *만
    const other = section(robotUsageView(objects, res, null, 'other'), 'unresolved')!
    expect(other.hits.map((h) => h.member)).toEqual(['Ghost', 'x'])
  })

  it('클래스 이름을 바꾸면 *의 이전 클래스 이름을 이 카드에 붙이고 생성 코드에 없는 이름에서는 뺀다', () => {
    const objects = renamed(baseline, 'robot', {
      hardware: { ...baseline.robot.hardware!, className: 'NewBot' }
    })
    const res = result({
      unresolved: [
        [
          MISSING_GENERATED_TYPE,
          [
            hit(PATH_A, 1, 'unresolved', { member: 'MyBot' }),
            hit(PATH_B, 2, 'unresolved', { member: 'MyBot' }),
            hit(PATH_B, 3, 'unresolved', { member: 'Ghost' })
          ]
        ]
      ]
    })
    const view = robotUsageView(objects, res, baseline, 'robot')!
    expect(ids(view)).toEqual(['renamedCode', 'unresolved'])
    expect(section(view, 'renamedCode')).toMatchObject({ old: 'MyBot', total: 2 })
    expect(section(view, 'unresolved')!.hits.map((h) => h.member)).toEqual(['Ghost'])
    expect(section(view, 'unresolved')!.total).toBe(1)
    expect(view.counts.warnings).toBe(3)
  })

  it('하위 장치 수는 자리 수다: 같은 포트의 모터·데드휠이 함께 가진 찾기 문자열은 한 번, 한도로 잘린 것은 더한다', () => {
    const objects = scene(
      robot('robot', 'MyBot'),
      part('m', 'robot', component('mm', 'motor', 'leftFront', 2)),
      part('w', 'robot', component('dw', 'deadWheel', 'par', 2))
    )
    const motor = deviceUsageKey('m', 'mm')
    const wheel = deviceUsageKey('w', 'dw')
    // hardwareMap.get(DcMotorEx.class, "leftFront") 하나를 두 키가 가진다
    const shared = hit(PATH_A, 6, 'lookup', { col: 60 })
    const res = result({
      hits: [
        [motor, [hit(PATH_A, 3, 'field'), shared]],
        [wheel, [{ ...shared }, hit(PATH_B, 1, 'constant'), hit(PATH_B, 2, 'text')]]
      ]
    })
    expect(robotUsageView(objects, res, null, 'robot')!.counts.descendants).toBe(3)
    const capped = result({
      hits: [
        [motor, [shared]],
        [wheel, [{ ...shared }]]
      ],
      totals: [[motor, { lookup: 250 }]]
    })
    expect(robotUsageView(objects, capped, null, 'robot')!.counts.descendants).toBe(250)
  })

  it('장치가 없는 로봇도 보인다(*가 남는다)', () => {
    const objects = scene(robot('robot', 'MyBot'))
    const res = result({
      unresolved: [[MISSING_GENERATED_TYPE, [hit(PATH_A, 1, 'unresolved', { member: 'MyBot' })]]]
    })
    const view = robotUsageView(objects, res, null, 'robot')!
    expect(section(view, 'unresolved')!.total).toBe(1)
    expect(hasUsageSection(objects, { kind: 'robot', robotId: 'robot' })).toBe(true)
    expect(robotUsageView(objects, res, null, 'nope')).toBeNull()
  })
})

describe('파일 묶음', () => {
  it('경로 순서로 묶고 파일 안은 줄·열 순서다', () => {
    const groups = fileGroups([
      hit(PATH_B, 2, 'field'),
      hit(PATH_A, 9, 'field', { col: 2 }),
      hit(PATH_A, 9, 'field', { col: 1 }),
      hit(PATH_A, 3, 'field')
    ])
    expect(groups.map((g) => [g.path, g.count, g.more])).toEqual([
      [PATH_A, 3, 0],
      [PATH_B, 1, 0]
    ])
    expect(groups[0].rows.map((h) => [h.line, h.col])).toEqual([
      [3, 5],
      [9, 1],
      [9, 2]
    ])
    expect(groups[0].first.line).toBe(3)
  })

  it('파일마다·부분마다 한도. 파일 머리줄은 전체 수이고 첫 사용처는 늘 있다', () => {
    const many = (path: string, n: number): UsageHit[] =>
      Array.from({ length: n }, (_, i) => hit(path, i + 1, 'field'))
    const groups = fileGroups([...many(PATH_A, 60), ...many(PATH_B, 5)], {
      perFile: 50,
      perSection: 52
    })
    expect(groups.map((g) => [g.count, g.rows.length, g.more])).toEqual([
      [60, 50, 10],
      [5, 2, 3]
    ])
    const starved = fileGroups([...many(PATH_A, 3), ...many(PATH_B, 3)], {
      perFile: 50,
      perSection: 3
    })
    expect(starved[1].rows).toEqual([])
    expect(starved[1].first.line).toBe(1)
    expect(canExpand(starved[1])).toBe(false)
  })

  it('결과 한도로 잘린 부분은 마지막으로 남은 파일의 개수가 그 아래 수(N+)다', () => {
    const many = (path: string, n: number): UsageHit[] =>
      Array.from({ length: n }, (_, i) => hit(path, i + 1, 'field'))
    const objects = scene(...baseScene())
    // A 150곳, B 110곳 중 앞의 50곳만 남고(키마다 200곳) C 30곳은 없다
    const res = result({
      hits: [[LL, [...many(PATH_A, 150), ...many(PATH_B, 50)]]],
      totals: [[LL, { field: 290 }]]
    })
    const code = section(deviceUsageView(objects, res, null, 'liftMotor', 'll'), 'code')!
    expect(code).toMatchObject({ total: 290, cut: [PATH_B] })
    expect(
      fileGroups(code.hits, FILE_GROUP_CAPS, code.cut).map((g) => [g.path, g.count, g.atLeast])
    ).toEqual([
      [PATH_A, 150, false],
      [PATH_B, 50, true]
    ])
    // 자르지 않았으면 모두 전체 수다
    const whole = section(
      deviceUsageView(objects, result({ hits: [[LL, many(PATH_A, 3)]] }), null, 'liftMotor', 'll'),
      'code'
    )!
    expect(whole.cut).toEqual([])
    expect(fileGroups(whole.hits).every((g) => !g.atLeast)).toBe(true)
  })

  it('행이 20개 이하면 펼쳐서 시작한다', () => {
    expect(groupsStartOpen(0)).toBe(true)
    expect(groupsStartOpen(20)).toBe(true)
    expect(groupsStartOpen(21)).toBe(false)
  })
})

describe('코드 조각', () => {
  it('맞은 토큰 앞을 12자까지 남기고 앞을 잘랐으면 lead', () => {
    expect(snippetWindow('lift.liftLeft.setPower(1)', [5, 13])).toEqual({
      lead: false,
      before: 'lift.',
      mark: 'liftLeft',
      after: '.setPower(1)'
    })
    const long = 'robot.hardware.mechanisms.lift.liftLeft.setPower(1)'
    const start = long.indexOf('liftLeft')
    const window = snippetWindow(long, [start, start + 8])
    expect(window.lead).toBe(true)
    expect(window.before).toBe('anisms.lift.')
    expect(window.mark).toBe('liftLeft')
  })

  it('서로게이트 쌍 가운데에서 자르지 않고, 어긋난 범위에도 던지지 않는다', () => {
    const text = `x😀${'a'.repeat(11)}TARGET`
    const start = text.indexOf('TARGET')
    // 12자 앞이 😀의 뒤쪽 반이면 한 칸 뒤에서 자른다
    expect(snippetWindow(text, [start, start + 6]).before).toBe('a'.repeat(11))
    expect(snippetWindow('abc', [5, 99])).toEqual({
      lead: false,
      before: 'abc',
      mark: '',
      after: ''
    })
    expect(snippetWindow('abc', [2, 1])).toEqual({
      lead: false,
      before: 'ab',
      mark: '',
      after: 'c'
    })
    expect(snippetWindow('abc', [Number.NaN, 2]).mark).toBe('ab')
  })
})

describe('스크립트가 쓰는 하드웨어', () => {
  it('이 파일에 코드·찾기 사용처가 있는 키를 하이어라키 순서로 한 번씩(같은 글자 문자열은 뺀다)', () => {
    const objects = scene(
      ...baseScene(),
      part(
        'twoPart',
        'robot',
        component('a', 'servo', 'clawA', 0),
        component('b', 'servo', 'clawB', 1)
      )
    )
    const res = result({
      hits: [
        [LL, [hit(PATH_A, 1, 'field'), hit(PATH_A, 2, 'field')]],
        [deviceUsageKey('twoPart', 'b'), [hit(PATH_A, 3, 'lookup')]],
        [deviceUsageKey('twoPart', 'a'), [hit(PATH_A, 4, 'field')]],
        [LIFT, [hit(PATH_A, 5, 'type')]],
        [FL, [hit(PATH_A, 6, 'text')]],
        [PE, [hit(PATH_B, 7, 'field')]],
        [ROBOT, [hit(PATH_A, 8, 'new')]],
        [deviceUsageKey('gone', 'x'), [hit(PATH_A, 9, 'field')]],
        [deviceUsageKey('liftMotor', 'removed'), [hit(PATH_A, 10, 'field')]]
      ]
    })
    expect(scriptUsesHardware(res, PATH_A, objects)).toEqual([
      { key: ROBOT, objectId: 'robot', label: 'MyBot 로봇' },
      { key: LIFT, objectId: 'lift', label: 'Lift' },
      { key: LL, objectId: 'liftMotor', label: 'liftLeft' },
      { key: deviceUsageKey('twoPart', 'a'), objectId: 'twoPart', label: 'clawA' },
      { key: deviceUsageKey('twoPart', 'b'), objectId: 'twoPart', label: 'clawB' }
    ])
    expect(scriptUsesHardware(res, PATH_B, objects).map((c) => c.label)).toEqual(['perp'])
    expect(scriptUsesHardware(result(), PATH_A, objects)).toEqual([])
  })
})

describe('트리 행과 키보드', () => {
  const groups = fileGroups([
    hit(PATH_A, 1, 'field'),
    hit(PATH_A, 2, 'field'),
    hit(PATH_B, 3, 'field')
  ])
  const openAll = usageTreeRows(groups, () => true)

  it('펼친 파일만 줄 행을 보이고, 파일 행은 첫 사용처를 연다', () => {
    expect(openAll.map((r) => r.type)).toEqual(['file', 'line', 'line', 'file', 'line'])
    const closedB = usageTreeRows(groups, (path) => path === PATH_A)
    expect(closedB.map((r) => r.type)).toEqual(['file', 'line', 'line', 'file'])
    expect(usageRowTarget(closedB[3]).line).toBe(3)
    expect(usageRowTarget(closedB[2]).line).toBe(2)
  })

  it('위/아래·Home/End는 보이는 행으로, 처음 키는 첫 행으로', () => {
    expect(usageTreeKey(openAll, null, 'ArrowDown')).toEqual({ type: 'focus', id: openAll[0].id })
    expect(usageTreeKey(openAll, openAll[1].id, 'ArrowDown')).toEqual({
      type: 'focus',
      id: openAll[2].id
    })
    expect(usageTreeKey(openAll, openAll[1].id, 'ArrowUp')).toEqual({
      type: 'focus',
      id: openAll[0].id
    })
    expect(usageTreeKey(openAll, openAll[4].id, 'ArrowDown')).toBeNull()
    expect(usageTreeKey(openAll, openAll[2].id, 'End')).toEqual({
      type: 'focus',
      id: openAll[4].id
    })
    expect(usageTreeKey(openAll, openAll[2].id, 'Home')).toEqual({
      type: 'focus',
      id: openAll[0].id
    })
    expect(usageTreeKey([], null, 'ArrowDown')).toBeNull()
  })

  it('오른쪽은 펼치기·첫 줄로, 왼쪽은 접기·파일로, Enter는 열기', () => {
    const closed = usageTreeRows(groups, () => false)
    expect(usageTreeKey(closed, closed[0].id, 'ArrowRight')).toEqual({
      type: 'setOpen',
      path: PATH_A,
      open: true
    })
    expect(usageTreeKey(openAll, openAll[0].id, 'ArrowRight')).toEqual({
      type: 'focus',
      id: openAll[1].id
    })
    expect(usageTreeKey(openAll, openAll[1].id, 'ArrowRight')).toBeNull()
    expect(usageTreeKey(openAll, openAll[2].id, 'ArrowLeft')).toEqual({
      type: 'focus',
      id: openAll[0].id
    })
    expect(usageTreeKey(openAll, openAll[0].id, 'ArrowLeft')).toEqual({
      type: 'setOpen',
      path: PATH_A,
      open: false
    })
    expect(usageTreeKey(closed, closed[0].id, 'ArrowLeft')).toBeNull()
    expect(usageTreeKey(openAll, openAll[2].id, 'Enter')).toEqual({
      type: 'open',
      hit: openAll[2].type === 'line' ? openAll[2].hit : null
    })
    expect(usageTreeKey(closed, closed[1].id, 'Enter')).toMatchObject({
      type: 'open',
      hit: { path: PATH_B, line: 3 }
    })
    expect(usageTreeKey(openAll, openAll[0].id, 'x')).toBeNull()
  })

  it('그릴 행이 없는 파일(부분 한도)은 펼치지 않는다', () => {
    const starved = fileGroups([hit(PATH_A, 1, 'field'), hit(PATH_B, 2, 'field')], {
      perFile: 50,
      perSection: 1
    })
    const rows = usageTreeRows(starved, () => true)
    expect(rows.map((r) => r.type)).toEqual(['file', 'line', 'file'])
    expect(rows[2].type === 'file' && rows[2].open).toBe(false)
    expect(usageTreeKey(rows, rows[2].id, 'ArrowRight')).toBeNull()
    expect(usageTreeKey(rows, rows[2].id, 'Enter')).toMatchObject({ hit: { path: PATH_B } })
  })

  it('포커스한 행이 사라지면 같은 파일의 남은 줄, 그 파일, 같은 순번의 파일로 옮긴다', () => {
    // openAll: [A 파일, A 1줄, A 2줄, B 파일, B 3줄]
    const [fileA, , lastA, fileB] = openAll
    // 같은 id가 남았으면 그 행
    expect(usageFocusFallback(openAll, lastA)).toBe(lastA.id)
    // A의 마지막 줄을 고쳤다: A의 남은 마지막 줄
    const fewer = usageTreeRows(
      fileGroups([hit(PATH_A, 1, 'field'), hit(PATH_B, 3, 'field')]),
      () => true
    )
    expect(usageFocusFallback(fewer, lastA)).toBe(fewer[1].id)
    // 행이 20개를 넘어 파일을 접었다: 그 파일 행
    const closed = usageTreeRows(groups, () => false)
    expect(usageFocusFallback(closed, lastA)).toBe(fileA.id)
    // A가 통째로 사라졌다: 같은 순번의 파일(B)
    const onlyB = usageTreeRows(fileGroups([hit(PATH_B, 3, 'field')]), () => true)
    expect(usageFocusFallback(onlyB, lastA)).toBe(onlyB[0].id)
    expect(usageFocusFallback(onlyB, fileA)).toBe(onlyB[0].id)
    // 마지막 파일이 사라졌다: 이제 마지막 파일
    const onlyA = usageTreeRows(fileGroups([hit(PATH_A, 1, 'field')]), () => true)
    expect(usageFocusFallback(onlyA, fileB)).toBe(onlyA[0].id)
    expect(usageFocusFallback([], fileB)).toBeNull()
  })
})
