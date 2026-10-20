import { describe, expect, it } from 'vitest'
import type { HardwareComponent, SceneObject, SceneObjects } from '../../scene/model'
import { propertyDefaults, type ComponentType } from '../../hardware/catalog'
import { lookupNamesOf, usageSymbols } from './usageSymbols'
import type { SymbolClass, UsageSymbols } from './usageTypes'

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

function robot(id: string, className?: string): SceneObject {
  return object(id, 'robot', null, {
    name: id,
    ...(className
      ? {
          hardware: {
            className,
            configName: id,
            expansionHub: { enabled: false, address: 2 }
          }
        }
      : {})
  })
}

const group = (
  id: string,
  parentId: string,
  name: string,
  extra: Partial<SceneObject> = {}
): SceneObject => object(id, 'group', parentId, { name, ...extra })
const part = (id: string, parentId: string, ...components: HardwareComponent[]): SceneObject =>
  object(id, 'part', parentId, { components })

function scene(...objects: SceneObject[]): SceneObjects {
  const result: SceneObjects = {}
  for (const o of objects) result[o.id] = o
  return result
}

// 로봇: 드라이브 모터 → Lift(모터, Claw 그룹(서보)) → Odometry(같은 포트 모터가 있는 데드휠, 없는 데드휠) → 빈 그룹
function liftScene(): SceneObjects {
  return scene(
    robot('bot', 'MyBotHardware'),
    part('drive', 'bot', component('fl', 'motor', 'frontLeft', 0)),
    group('lift', 'bot', 'Lift'),
    part('liftMotor', 'lift', component('ll', 'motor', 'liftLeft', 1)),
    group('claw', 'lift', 'Claw', { components: [component('cs', 'servo', 'claw', 0)] }),
    group('odometry', 'bot', 'Odometry'),
    part('parPart', 'odometry', component('pa', 'deadWheel', 'par', 0)),
    part('perpPart', 'odometry', component('pe', 'deadWheel', 'perp', 3)),
    group('empty', 'bot', 'Empty'),
    part('emptyPart', 'empty')
  )
}

function rename(objects: SceneObjects, id: string, patch: Partial<SceneObject>): SceneObjects {
  return { ...objects, [id]: { ...objects[id], ...patch } }
}

function renameComponent(
  objects: SceneObjects,
  objectId: string,
  componentId: string,
  name: string
): SceneObjects {
  const target = objects[objectId]
  return rename(objects, objectId, {
    components: target.components!.map((c) => (c.id === componentId ? { ...c, name } : c))
  })
}

function nested(cls: SymbolClass, field: string): SymbolClass {
  const found = cls.fields.find((f) => f.name === field)?.group
  if (!found) throw new Error(`no group field ${field}`)
  return found
}

function lookup(symbols: UsageSymbols, name: string): string[] | undefined {
  return symbols.lookupNames.find((entry) => entry.name === name)?.keys
}

describe('usageSymbols', () => {
  it('codeScopes의 클래스·필드·상수를 키와 함께 옮긴다', () => {
    const symbols = usageSymbols(liftScene())
    expect(symbols.unavailable).toEqual([])
    expect(symbols.robots).toHaveLength(1)
    const root = symbols.robots[0]
    expect(root.key).toBe('r:bot')
    expect(root.name).toBe('MyBotHardware')
    expect(root.fields.map((f) => [f.name, f.key, f.group?.key ?? null])).toEqual([
      ['frontLeft', 'd:drive\nfl', null],
      ['lift', 'g:lift', 'g:lift'],
      ['odometry', 'g:odometry', 'g:odometry']
    ])
    // 로봇 클래스에만 CONFIGURATION_NAME(로봇 키)이 먼저 있다
    expect(root.constants[0]).toEqual({ name: 'CONFIGURATION_NAME', key: 'r:bot' })
    const lift = nested(root, 'lift')
    expect(lift.name).toBe('Lift')
    expect(lift.constants.some((c) => c.name === 'CONFIGURATION_NAME')).toBe(false)
    expect(lift.fields.map((f) => f.name)).toEqual(['liftLeft', 'claw'])
    // 그룹 자신의 컴포넌트는 그 그룹 클래스의 필드다(Claw 그룹의 서보 claw는 Claw 안에 있다)
    const claw = nested(lift, 'claw')
    expect(claw.key).toBe('g:claw')
    expect(claw.fields).toEqual([{ name: 'claw', key: 'd:claw\ncs', group: null }])
    // 데드휠 상수(오프셋)는 그 장치 키로 간다
    const odometry = nested(root, 'odometry')
    expect(odometry.constants.length).toBeGreaterThan(0)
    for (const c of odometry.constants) expect(['d:parPart\npa', 'd:perpPart\npe']).toContain(c.key)
  })

  it('장치가 없는 그룹은 클래스가 없다', () => {
    const symbols = usageSymbols(liftScene())
    expect(symbols.robots[0].fields.some((f) => f.key === 'g:empty')).toBe(false)
    expect(symbols.signature).not.toContain('g:empty')
  })

  it('같은 문서면 같은 결과(WeakMap), 다른 문서면 다시 만든다', () => {
    const objects = liftScene()
    expect(usageSymbols(objects)).toBe(usageSymbols(objects))
    expect(lookupNamesOf(objects)).toBe(lookupNamesOf(objects))
    const copy = { ...objects }
    expect(usageSymbols(copy)).not.toBe(usageSymbols(objects))
    expect(usageSymbols(copy).signature).toBe(usageSymbols(objects).signature)
  })

  it('이름을 바꿔도 키는 그대로다(장치·그룹·클래스)', () => {
    const before = usageSymbols(liftScene())
    let objects = renameComponent(liftScene(), 'liftMotor', 'll', 'liftL')
    objects = rename(objects, 'lift', { name: 'Elevator' })
    objects = rename(objects, 'bot', {
      hardware: { ...objects.bot.hardware!, className: 'OtherHardware' }
    })
    const after = usageSymbols(objects)
    expect(after.robots[0].key).toBe(before.robots[0].key)
    expect(after.robots[0].name).toBe('OtherHardware')
    const elevator = nested(after.robots[0], 'elevator')
    expect(elevator.key).toBe('g:lift')
    expect(elevator.name).toBe('Elevator')
    expect(elevator.fields[0]).toEqual({ name: 'liftL', key: 'd:liftMotor\nll', group: null })
    expect(lookup(after, 'liftL')).toEqual(['d:liftMotor\nll'])
    expect(lookup(after, 'liftLeft')).toBeUndefined()
  })

  it('signature: 옮기기만 하면 그대로, 이름·소속 그룹·클래스 이름을 바꾸면 달라진다', () => {
    const base = liftScene()
    const signature = usageSymbols(base).signature
    const moved = rename(base, 'liftMotor', {
      transform: { position: [0.1, 0.2, 0.3], rotation: [0, 0, 1] }
    })
    expect(usageSymbols(moved).signature).toBe(signature)

    expect(usageSymbols(renameComponent(base, 'drive', 'fl', 'leftFront')).signature).not.toBe(
      signature
    )
    expect(usageSymbols(rename(base, 'claw', { name: 'Gripper' })).signature).not.toBe(signature)
    expect(
      usageSymbols(
        rename(base, 'bot', { hardware: { ...base.bot.hardware!, className: 'BotHardware' } })
      ).signature
    ).not.toBe(signature)
    // 장치를 Lift에서 로봇 바로 아래로 옮기면 필드가 다른 클래스에 생긴다
    expect(usageSymbols(rename(base, 'liftMotor', { parentId: 'bot' })).signature).not.toBe(
      signature
    )
  })

  it('codeClassName 덮어쓰기가 클래스 이름과 필드 이름이 된다', () => {
    const objects = rename(liftScene(), 'lift', { name: '리프트', codeClassName: 'Elevator' })
    const root = usageSymbols(objects).robots[0]
    const elevator = nested(root, 'elevator')
    expect(elevator.name).toBe('Elevator')
    expect(elevator.key).toBe('g:lift')
  })

  it('한글 장치 이름은 그대로 필드 이름이다', () => {
    const objects = scene(
      robot('bot', 'MyBotHardware'),
      part('p', 'bot', component('m', 'motor', '왼쪽모터', 0))
    )
    const symbols = usageSymbols(objects)
    expect(symbols.robots[0].fields[0]).toEqual({ name: '왼쪽모터', key: 'd:p\nm', group: null })
    expect(lookup(symbols, '왼쪽모터')).toEqual(['d:p\nm'])
  })

  it('데드휠은 같은 포트 모터의 이름으로 찾고, 모터가 없으면 자기 이름이다', () => {
    const symbols = usageSymbols(liftScene())
    // par(포트 0)는 frontLeft(포트 0)의 엔코더를 읽는다
    expect(lookup(symbols, 'frontLeft')).toEqual(['d:drive\nfl', 'd:parPart\npa'])
    expect(lookup(symbols, 'par')).toBeUndefined()
    expect(lookup(symbols, 'perp')).toEqual(['d:perpPart\npe'])
    expect(lookupNamesOf(liftScene()).get('frontLeft')).toEqual(['d:drive\nfl', 'd:parPart\npa'])
  })

  it('찾기 이름은 앞뒤 공백을 빼고, 빈 이름은 넣지 않는다', () => {
    const objects = scene(
      robot('bot', 'MyBotHardware'),
      part('p', 'bot', component('a', 'motor', ' arm ', 0), component('b', 'servo', '   ', 0))
    )
    const names = lookupNamesOf(objects)
    expect([...names.keys()]).toEqual(['arm'])
  })

  it('클래스 이름이 다른 두 로봇은 둘 다 기호표에 있다', () => {
    const objects = scene(
      robot('a', 'AlphaHardware'),
      part('pa', 'a', component('m', 'motor', 'arm', 0)),
      robot('b', 'BetaHardware'),
      part('pb', 'b', component('m', 'motor', 'arm', 0))
    )
    const symbols = usageSymbols(objects)
    expect(symbols.robots.map((r) => [r.key, r.name])).toEqual([
      ['r:a', 'AlphaHardware'],
      ['r:b', 'BetaHardware']
    ])
    // 같은 구성 이름은 두 로봇의 장치 모두로 간다
    expect(lookup(symbols, 'arm')).toEqual(['d:pa\nm', 'd:pb\nm'])
  })

  it('두 로봇이 모두 RobotHardware면 클래스는 쓸 수 없고 찾기 이름은 남는다', () => {
    const objects = scene(
      robot('a'),
      part('pa', 'a', component('m', 'motor', 'arm', 0)),
      robot('b'),
      part('pb', 'b', component('m', 'motor', 'lift', 0))
    )
    const symbols = usageSymbols(objects)
    expect(symbols.robots).toEqual([])
    expect(symbols.unavailable).toEqual([
      { key: 'r:a', className: 'RobotHardware', reason: 'duplicateClassName' },
      { key: 'r:b', className: 'RobotHardware', reason: 'duplicateClassName' }
    ])
    expect(lookup(symbols, 'arm')).toEqual(['d:pa\nm'])
    expect(lookup(symbols, 'lift')).toEqual(['d:pb\nm'])
  })

  it('잘못된 클래스 이름의 로봇은 invalidClassName으로 쓸 수 없다', () => {
    const objects = scene(
      robot('bot', 'my bot'),
      part('p', 'bot', component('m', 'motor', 'arm', 0))
    )
    const symbols = usageSymbols(objects)
    expect(symbols.robots).toEqual([])
    expect(symbols.unavailable).toEqual([
      { key: 'r:bot', className: 'my bot', reason: 'invalidClassName' }
    ])
    expect(lookup(symbols, 'arm')).toEqual(['d:p\nm'])
  })

  it('컴포넌트가 없는 로봇은 클래스가 없다', () => {
    const objects = scene(robot('bot', 'MyBotHardware'), part('p', 'bot'), group('g', 'bot', 'G'))
    const symbols = usageSymbols(objects)
    expect(symbols).toMatchObject({ robots: [], unavailable: [], lookupNames: [] })
  })

  it('로봇 밖의 컴포넌트는 기호표에 없다', () => {
    const objects = scene(
      robot('bot', 'MyBotHardware'),
      part('p', 'bot', component('m', 'motor', 'arm', 0)),
      object('loose', 'part', null, { components: [component('x', 'servo', 'stray', 0)] })
    )
    const symbols = usageSymbols(objects)
    expect(symbols.signature).not.toContain('stray')
    expect(lookupNamesOf(objects).has('stray')).toBe(false)
  })

  it('한 범위의 겹치는 필드 이름은 따로 남는다(검증 오류지만 둘 다 사용처)', () => {
    const objects = scene(
      robot('bot', 'MyBotHardware'),
      part('p', 'bot', component('a', 'motor', 'arm', 0)),
      part('q', 'bot', component('b', 'servo', 'arm', 0))
    )
    const fields = usageSymbols(objects).robots[0].fields
    expect(fields.map((f) => [f.name, f.key])).toEqual([
      ['arm', 'd:p\na'],
      ['arm', 'd:q\nb']
    ])
  })
})
