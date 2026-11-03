import { describe, expect, it } from 'vitest'
import { ROBOT_SIZE } from '../scene/coordinates'
import type { HardwareComponent, SceneObject, SceneObjects, Transform, Vec3 } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { defaultWheel } from '../scene/wheel'
import { computeMassModel as computeWithLookup } from './massModel'
import { PRINTED_SHELL_THICKNESS } from './materials'
import {
  DEFAULT_ROBOT_MASS,
  type MassLookup,
  type MeshMassProps,
  type SourceNode,
  type SymMatrix3
} from './types'

// 피벗 기준 직육면체(a × b × c, 무게중심 offset)의 단위 밀도 질량 성질(해석해)
function box(a: number, b: number, c: number, offset: Vec3 = [0, 0, 0]): MeshMassProps {
  const volume = a * b * c
  return {
    volume,
    centroid: offset,
    inertia: [
      (volume * (b * b + c * c)) / 12,
      (volume * (a * a + c * c)) / 12,
      (volume * (a * a + b * b)) / 12,
      0,
      0,
      0
    ],
    area: 2 * (a * b + b * c + c * a),
    closure: 0
  }
}

// 부피만 정한 메시(U-channel 표처럼 형상 대신 부피를 고정값으로 넣을 때)
function solid(volume: number): MeshMassProps {
  const side = Math.cbrt(volume)
  return box(side, side, side)
}

// 시험의 형상 정보: 메시 성질, 원래 파트 이름('' = 불러올 때 붙인 "노드 + 순번" 이름), 원래 이름 경로(정하지 않으면
// 지금 씬을 불러온 그대로라고 보고 만든다, sceneLookup)
type TestLookup = {
  props: Record<string, MeshMassProps>
  names: Record<string, string>
  paths: Record<string, SourceNode[]>
}

function lookupOf(
  props: Record<string, MeshMassProps>,
  names: Record<string, string> = {},
  paths: Record<string, SourceNode[]> = {}
): TestLookup {
  return { props, names, paths }
}

// 지금 씬을 불러온 계층으로 본 원래 이름 경로: 메시 파트부터 위로 CAD 오브젝트(그룹은 건너뜀)를 CAD 루트나 로봇 앞까지.
// 노드 키는 오브젝트 id, 이름은 오브젝트 이름(파트는 names에 있으면 그 이름, ''이면 붙인 이름)이다.
function sceneLookup(objects: SceneObjects, lookup: TestLookup): MassLookup {
  const derive = (geometryId: string): SourceNode[] | undefined => {
    const leaf = Object.values(objects).find(
      (object) => object.visual?.type === 'mesh' && object.visual.geometryId === geometryId
    )
    if (!leaf) return undefined
    const path: SourceNode[] = []
    for (let at: SceneObject | undefined = leaf; at && at.kind !== 'robot';) {
      if (at.kind !== 'group') {
        const source = at === leaf ? lookup.names[geometryId] : undefined
        path.unshift({
          key: at.id,
          name: source || at.name,
          ...(source === '' ? { generated: true as const } : {})
        })
      }
      if (at.cad) break
      at = at.parentId ? objects[at.parentId] : undefined
    }
    return path
  }
  return {
    props: (id) => lookup.props[id],
    sourcePath: (id) => lookup.paths[id] ?? derive(id)
  }
}

function computeMassModel(
  objects: SceneObjects,
  lookup: TestLookup
): ReturnType<typeof computeWithLookup> {
  return computeWithLookup(objects, sceneLookup(objects, lookup))
}

function robot(extra: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'R',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [1, -0.5, 0], rotation: [0, 0, 0.7] },
    ...extra
  }
}

function node(
  id: string,
  parentId: string,
  extra: Partial<SceneObject> = {},
  position: Vec3 = [0, 0, 0]
): SceneObject {
  return {
    id,
    name: id,
    kind: 'assembly',
    parentId,
    transform: { position, rotation: [0, 0, 0] },
    ...extra
  }
}

function part(
  id: string,
  parentId: string,
  position: Vec3 = [0, 0, 0],
  extra: Partial<SceneObject> = {}
): SceneObject {
  return {
    id,
    name: id,
    kind: 'part',
    parentId,
    transform: { position, rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: `g:${id}`, color: [1, 1, 1] },
    ...extra
  }
}

const scene = (...list: SceneObject[]): SceneObjects =>
  Object.fromEntries(list.map((object) => [object.id, object]))

const motor = (gearbox: number): HardwareComponent => ({
  id: `m${gearbox}`,
  type: 'motor',
  name: 'lift',
  hub: 'controlHub',
  port: 0,
  props: { motorModel: 'goBilda5202', gearbox }
})

const LITER = 1e-3
// 모터·서보 크기의 형상(30 × 30 × 60 mm, 54 cm³). COTS 컴포넌트는 하위가 그 부품 하나로 보일 때만 하위를 덮는다
// (알루미늄으로 쳐서 표 질량의 1.6배 이하, cotsRejection)
const MOTOR_SIZE = (): MeshMassProps => box(0.03, 0.03, 0.06)

describe('질량 추정: 재질', () => {
  it('재질이 없으면 로봇 기본 재질(없으면 알루미늄 6061)이고 출처는 default', () => {
    const objects = scene(robot(), part('P', 'R'))
    const model = computeMassModel(objects, lookupOf({ 'g:P': solid(0.1 * LITER) }))
    expect(model.objects.P).toMatchObject({
      source: 'default',
      detail: 'aluminum6061',
      inheritedFrom: 'R',
      scaled: false
    })
    expect(model.objects.P.mass).toBeCloseTo(0.27, 12)
    const steelBot = scene(robot({ rigidbody: { defaultMaterial: 'steel' } }), part('P', 'R'))
    expect(
      computeMassModel(steelBot, lookupOf({ 'g:P': solid(0.1 * LITER) })).objects.P.mass
    ).toBeCloseTo(0.785, 12)
  })

  it('재질은 하위로 상속하고, 하위가 다시 정하면 그것을 쓴다', () => {
    const objects = scene(
      robot(),
      node('A', 'R', { mass: { material: 'steel' } }),
      part('P1', 'A'),
      part('P2', 'A', [0, 0, 0], { mass: { material: 'brass' } }),
      node('B', 'A'),
      part('P3', 'B')
    )
    const props = { 'g:P1': solid(LITER), 'g:P2': solid(LITER), 'g:P3': solid(LITER) }
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.P1).toMatchObject({
      source: 'material',
      detail: 'steel',
      inheritedFrom: 'A'
    })
    expect(model.objects.P1.mass).toBeCloseTo(7.85, 12)
    expect(model.objects.P2).toMatchObject({
      source: 'material',
      detail: 'brass',
      inheritedFrom: null
    })
    expect(model.objects.P2.mass).toBeCloseTo(8.5, 12)
    expect(model.objects.P3).toMatchObject({ detail: 'steel', inheritedFrom: 'A' })
    // 어셈블리 A는 하위 합계이고, 출처는 하위 중 가장 큰 질량(같은 steel 둘 > brass 하나)이며 자기가 정했으니 상속이 아니다
    expect(model.objects.A.mass).toBeCloseTo(7.85 * 2 + 8.5, 12)
    expect(model.objects.A).toMatchObject({
      source: 'material',
      detail: 'steel',
      inheritedFrom: null
    })
    // 부모를 바꾸면(같은 문서에서 P3를 로봇 바로 아래로) 재질 상속도 새 부모 기준이다
    const moved = { ...objects, P3: { ...objects.P3, parentId: 'R' } }
    expect(computeMassModel(moved, lookupOf(props)).objects.P3).toMatchObject({
      source: 'default',
      detail: 'aluminum6061'
    })
  })

  it('출력 재질은 껍질 + 채움 비율로 유효 밀도를 줄인다(채움률은 상속, 기본 15 %)', () => {
    // 20 mm 정육면체: A·t/V = 6t/0.02 = 0.33
    const cube = box(0.02, 0.02, 0.02)
    const shell = (6 * PRINTED_SHELL_THICKNESS) / 0.02
    const fill = (infill: number): number => shell + (1 - shell) * infill
    const objects = scene(
      robot({ rigidbody: { defaultMaterial: 'pla' } }),
      part('P1', 'R'),
      node('A', 'R', { mass: { infill: 0.5 } }),
      part('P2', 'A'),
      // 출력 재질이 아니면 채움률을 쓰지 않는다
      part('P3', 'A', [0, 0, 0], { mass: { material: 'nylon' } })
    )
    const model = computeMassModel(objects, lookupOf({ 'g:P1': cube, 'g:P2': cube, 'g:P3': cube }))
    expect(model.objects.P1.mass).toBeCloseTo(1240 * fill(0.15) * cube.volume, 14)
    expect(model.objects.P2.mass).toBeCloseTo(1240 * fill(0.5) * cube.volume, 14)
    expect(model.objects.P3.mass).toBeCloseTo(1140 * cube.volume, 14)
    // 큰 파트는 껍질 비율이 1을 넘지 않는다(얇은 판은 껍질뿐)
    const plate = box(0.1, 0.1, 0.001)
    const thin = computeMassModel(
      scene(robot({ rigidbody: { defaultMaterial: 'petg' } }), part('P', 'R')),
      lookupOf({ 'g:P': plate })
    )
    expect(thin.objects.P.mass).toBeCloseTo(1270 * plate.volume, 14)
  })

  it('표면 메시(closure > 0.02 또는 부피 ≈ 0)는 질량 0, 열린 메시(근사)는 부피를 쓴다', () => {
    const objects = scene(robot(), part('S', 'R'), part('O', 'R'), part('Z', 'R'))
    const model = computeMassModel(
      objects,
      lookupOf({
        'g:S': { ...solid(LITER), closure: 0.021 },
        'g:O': { ...solid(LITER), closure: 0.015 },
        'g:Z': { ...solid(1e-13) }
      })
    )
    expect(model.objects.S).toMatchObject({ mass: 0, source: 'none' })
    expect(model.objects.Z).toMatchObject({ mass: 0, source: 'none' })
    expect(model.objects.O.mass).toBeCloseTo(2.7, 12)
  })
})

describe('질량 추정: 이름 규칙', () => {
  it('원래 이름 경로를 파트 노드부터 CAD 루트까지 본다(붙인 이름은 건너뛴다)', () => {
    const cadRoot = node('C', 'R', {
      name: 'Steel Kit',
      cad: {
        fileName: 'kit.step',
        absolutePath: '/kit.step',
        upAxis: '+Z',
        forwardAxis: '+X',
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        meshCount: 4
      }
    })
    const objects = scene(
      robot({ name: 'Steel Robot' }),
      cadRoot,
      node('B', 'C', { name: '1611-0514-0006' }),
      part('P1', 'B', [0, 0, 0], { name: 'Washer' }),
      // 붙인 "노드 + 순번" 이름은 CAD 이름이 아니라 부모(베어링 SKU 시리즈)로 간다
      part('P2', 'B', [0, 0, 0], { name: '1611-0514-0006 2' }),
      part('P3', 'B', [0, 0, 0], { name: 'IR' }),
      // CAD 루트 이름까지 본다(로봇 이름은 보지 않는다)
      part('P4', 'C', [0, 0, 0], { name: 'Thing' })
    )
    const props = Object.fromEntries(
      ['P1', 'P2', 'P3', 'P4'].map((id) => [`g:${id}`, solid(LITER)])
    )
    const model = computeMassModel(objects, lookupOf(props, { 'g:P2': '' }))
    expect(model.objects.P1).toMatchObject({
      source: 'nameRule',
      detail: 'washer',
      inheritedFrom: null
    })
    expect(model.objects.P1.mass).toBeCloseTo(7.85, 12)
    for (const id of ['P2', 'P3'])
      expect(model.objects[id]).toMatchObject({
        source: 'nameRule',
        detail: 'gobilda-1611',
        inheritedFrom: 'B'
      })
    expect(model.objects.P4).toMatchObject({
      source: 'nameRule',
      detail: 'steel',
      inheritedFrom: 'C'
    })
  })

  it('어셈블리 이름의 부품 종류 낱말은 그 아래 붙인 이름·이름 없는 솔리드에 내려가지 않는다(재질 낱말만)', () => {
    const cad = {
      fileName: 'robot.step',
      absolutePath: '/robot.step',
      upAxis: '+Z' as const,
      forwardAxis: '+X' as const,
      bounds: { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 },
      meshCount: 6
    }
    // 평탄화된 서브시스템: 최상위 컴포넌트 이름 아래 붙인 이름과 Onshape 기본 이름('Part 1')의 솔리드
    const subsystem = (id: string, name: string): SceneObject[] => [
      node(id, 'C', { name }),
      part(`${id}1`, id, [0, 0, 0], { name: `${name} 1` }),
      part(`${id}2`, id, [0, 0, 0], { name: 'Part 1' })
    ]
    const objects = scene(
      robot(),
      node('C', 'R', { name: 'Robot', cad }),
      ...subsystem('L', 'Chain Lift'),
      ...subsystem('I', 'Roller Intake'),
      ...subsystem('S', 'Steel Arm')
    )
    const ids = ['L1', 'L2', 'I1', 'I2', 'S1', 'S2']
    const props = Object.fromEntries(ids.map((id) => [`g:${id}`, box(0.3, 0.1, 0.004)]))
    const generated = { 'g:L1': '', 'g:I1': '', 'g:S1': '' }
    const model = computeMassModel(objects, lookupOf(props, generated))
    for (const id of ['L1', 'L2', 'I1', 'I2'])
      expect(model.objects[id], id).toMatchObject({ source: 'default', detail: 'aluminum6061' })
    for (const id of ['S1', 'S2'])
      expect(model.objects[id], id).toMatchObject({
        source: 'nameRule',
        detail: 'steel',
        inheritedFrom: 'S'
      })
  })

  it('가정한 일반 낱말(mount·block·hub)이 없어져 출력 재질 로봇의 마운트는 로봇 기본 재질이다', () => {
    const objects = scene(
      robot({ rigidbody: { defaultMaterial: 'petg' } }),
      part('M', 'R', [0, 0, 0], { name: 'Camera Mount' }),
      part('B', 'R', [0, 0, 0], { name: 'Sensor Block' }),
      part('H', 'R', [0, 0, 0], { name: 'Servo Hub' })
    )
    const props = Object.fromEntries(
      ['M', 'B', 'H'].map((id) => [`g:${id}`, box(0.06, 0.04, 0.02)])
    )
    const model = computeMassModel(objects, lookupOf(props))
    for (const id of ['M', 'B', 'H'])
      expect(model.objects[id], id).toMatchObject({ source: 'default', detail: 'petg' })
  })

  it('이름 규칙은 지금 이름·그룹 이름을 보지 않고, 옮기거나 이름을 바꿔도 원래 경로의 규칙이다', () => {
    const cad = {
      fileName: 'kit.step',
      absolutePath: '/kit.step',
      upAxis: '+Z' as const,
      forwardAxis: '+X' as const,
      bounds: { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 },
      meshCount: 3
    }
    const imported = scene(
      robot(),
      node('C', 'R', { name: 'Kit', cad }),
      node('B', 'C', { name: 'Steel Kit' }),
      part('P1', 'B', [0, 0, 0], { name: '1120-0010-0264' }),
      part('P2', 'B', [0, 0, 0], { name: 'Thing' }),
      part('P3', 'C', [0, 0, 0], { name: 'Thing 2' })
    )
    const props = Object.fromEntries(['P1', 'P2', 'P3'].map((id) => [`g:${id}`, solid(LITER)]))
    // 불러온 그대로의 경로를 고정한다(아래에서 이름을 바꾸고 옮겨도 등록된 경로는 그대로다)
    const paths = Object.fromEntries(
      ['P1', 'P2', 'P3'].map((id) => [
        `g:${id}`,
        sceneLookup(imported, lookupOf(props)).sourcePath(`g:${id}`) as SourceNode[]
      ])
    )
    const before = computeMassModel(imported, lookupOf(props, {}, paths))
    expect(before.objects.P1).toMatchObject({ source: 'nameRule', detail: 'gobilda-1120' })
    expect(before.objects.P2).toMatchObject({ source: 'nameRule', detail: 'steel' })
    expect(before.objects.P3).toMatchObject({ source: 'default' })
    const edited: SceneObjects = {
      ...imported,
      // 규칙 낱말이 든 새 이름(원래 SKU 규칙이 그대로 이긴다)
      P1: { ...imported.P1, name: 'steel bolt plate' },
      // 부모 어셈블리 이름을 바꿔도 원래 이름(steel)이다
      B: { ...imported.B, name: 'Intake Roller' },
      // 그룹(팀이 지은 메커니즘 이름)으로 옮긴 파트도 원래 경로다
      G: node('G', 'R', { kind: 'group', name: 'IntakeRoller' }),
      P3: { ...imported.P3, name: 'Steel Shaft', parentId: 'G', cadOrigin: 'C' }
    }
    const after = computeMassModel(edited, lookupOf(props, {}, paths))
    for (const id of ['P1', 'P2', 'P3']) {
      expect(after.objects[id].mass, id).toBeCloseTo(before.objects[id].mass, 12)
      expect(after.objects[id].detail, id).toBe(before.objects[id].detail)
    }
    expect(after.robots.R.mass).toBeCloseTo(before.robots.R.mass, 12)
  })

  it('이름 규칙의 상속 출처는 옮긴 뒤에도 그 원래 노드의 오브젝트다(옮긴 그룹·로봇이 아니다)', () => {
    const cad = {
      fileName: 'kit.step',
      absolutePath: '/kit.step',
      upAxis: '+Z' as const,
      forwardAxis: '+X' as const,
      bounds: { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 },
      meshCount: 3
    }
    const imported = scene(
      robot(),
      node('C', 'R', { name: 'Kit', cad }),
      node('B', 'C', { name: 'Steel Kit' }),
      part('P1', 'B', [0, 0, 0], { name: 'Thing' }),
      part('P2', 'B', [0, 0, 0], { name: 'Thing 2' }),
      part('P3', 'B', [0, 0, 0], { name: 'Thing 3' })
    )
    const props = Object.fromEntries(['P1', 'P2', 'P3'].map((id) => [`g:${id}`, solid(LITER)]))
    const paths = Object.fromEntries(
      ['P1', 'P2', 'P3'].map((id) => [
        `g:${id}`,
        sceneLookup(imported, lookupOf(props)).sourcePath(`g:${id}`) as SourceNode[]
      ])
    )
    const moved: SceneObjects = {
      ...imported,
      G: node('G', 'R', { kind: 'group', name: 'Intake' }),
      P3: { ...imported.P3, parentId: 'G', cadOrigin: 'C' }
    }
    const model = computeMassModel(moved, lookupOf(props, {}, paths))
    for (const id of ['P1', 'P2', 'P3'])
      expect(model.objects[id], id).toMatchObject({
        source: 'nameRule',
        detail: 'steel',
        inheritedFrom: 'B'
      })
  })

  it('그룹 이름의 SKU는 COTS로 보지 않는다', () => {
    const objects = scene(
      robot(),
      node('G', 'R', { kind: 'group', name: '3100-0012-0020' }),
      part('P', 'G')
    )
    const model = computeMassModel(objects, lookupOf({ 'g:P': solid(LITER) }))
    expect(model.objects.P).toMatchObject({ source: 'default', detail: 'aluminum6061' })
  })

  it('명시한 재질이 이름 규칙보다 먼저이고, 라벨 규칙은 질량 0이다', () => {
    const objects = scene(
      robot(),
      node('A', 'R', { mass: { material: 'pla' } }),
      part('P1', 'A', [0, 0, 0], { name: 'Steel Bolt' }),
      part('L', 'R', [0, 0, 0], { name: 'Top Label' })
    )
    const model = computeMassModel(objects, lookupOf({ 'g:P1': solid(LITER), 'g:L': solid(LITER) }))
    expect(model.objects.P1).toMatchObject({ source: 'material', detail: 'pla' })
    expect(model.objects.L).toMatchObject({ mass: 0, source: 'nameRule', detail: 'label' })
  })

  it('goBILDA U-channel 5종: CAD 부피 × 2.70이 공시 무게와 0–1.4 % 안(예제 STEP 부피를 고정값으로)', () => {
    // [SKU, goBILDA 예제 STEP(3200-2627-0004)을 occt-import-js로 읽은 CAD 부피 cm³, goBILDA 공시 무게 g]
    // 공시 무게: https://www.gobilda.com/1120-series-u-channel-<N>-hole-<L>mm-length/ (1-48, 2-72, 8-216, 10-264, 15-384)
    const channels: [string, number, number][] = [
      ['1120-0001-0048', 13.142, 35],
      ['1120-0002-0072', 18.907, 51],
      ['1120-0008-0216', 53.499, 144],
      ['1120-0010-0264', 65.029, 175],
      ['1120-0015-0384', 93.856, 253]
    ]
    // 기본 재질을 PLA로 둬도 SKU 시리즈 규칙(1120 → 알루미늄 6061)이 정한다
    const objects = scene(
      robot({ rigidbody: { defaultMaterial: 'pla' } }),
      ...channels.map(([sku]) => part(sku, 'R', [0, 0, 0], { name: sku }))
    )
    const model = computeMassModel(
      objects,
      lookupOf(Object.fromEntries(channels.map(([sku, cm3]) => [`g:${sku}`, solid(cm3 * 1e-6)])))
    )
    for (const [sku, , published] of channels) {
      expect(model.objects[sku]).toMatchObject({ source: 'nameRule', detail: 'gobilda-1120' })
      const grams = model.objects[sku].mass * 1000
      expect(Math.abs(grams - published) / published, sku).toBeLessThanOrEqual(0.014)
    }
  })
})

describe('질량 추정: 덮어쓰기와 COTS', () => {
  it('덮어쓰기는 하위 전체를 한 덩어리로 보고 부피 비율로 나눈다(무게중심은 부피 무게중심)', () => {
    const objects = scene(
      robot(),
      node('A', 'R', { mass: { mass: 1 } }),
      part('P1', 'A', [0.1, 0, 0], { mass: { material: 'steel' } }),
      part('P2', 'A', [-0.1, 0, 0])
    )
    const model = computeMassModel(
      objects,
      lookupOf({ 'g:P1': solid(LITER), 'g:P2': solid(3 * LITER) })
    )
    expect(model.objects.P1).toMatchObject({ mass: 0.25, source: 'override', inheritedFrom: 'A' })
    expect(model.objects.P2.mass).toBeCloseTo(0.75, 15)
    expect(model.objects.A).toMatchObject({ mass: 1, source: 'override', inheritedFrom: null })
    expect(model.objects.A.centerOfMass[0]).toBeCloseTo(0.25 * 0.1 - 0.75 * 0.1, 15)
    expect(model.robots.R).toMatchObject({ mass: 1, fixedMass: 1, estimatedMass: 0 })
  })

  it('무게중심 덮어쓰기는 덩어리 전체의 무게중심을 그 점(오브젝트 로컬)에 둔다', () => {
    const objects = scene(
      robot(),
      node('A', 'R', {
        mass: { mass: 2, centerOfMass: [0, 0, 0.05] },
        transform: { position: [0.2, 0, 0.1], rotation: [0, 0, Math.PI / 2] }
      }),
      part('P1', 'A', [0.1, 0, 0]),
      part('P2', 'A', [-0.1, 0, 0])
    )
    const model = computeMassModel(
      objects,
      lookupOf({ 'g:P1': solid(LITER), 'g:P2': solid(LITER) })
    )
    const com = model.robots.R.centerOfMass
    expect(com[0]).toBeCloseTo(0.2, 14)
    expect(com[1]).toBeCloseTo(0, 14)
    expect(com[2]).toBeCloseTo(0.15, 14)
    // 관성의 모양은 형상 그대로(두 파트가 무게중심에서 ±0.1 m, 로컬 X가 로봇 Y로 돌았다)
    const I = model.robots.R.inertia
    const cubeI = solid(LITER).inertia[0] * (1 / LITER)
    expect(I[0]).toBeCloseTo(2 * cubeI + 2 * 0.01, 12)
    expect(I[1]).toBeCloseTo(2 * cubeI, 12)
  })

  it('형상이 없는 그룹의 덮어쓰기는 점질량(원점 + 무게중심)이다', () => {
    const objects = scene(
      robot(),
      part('Body', 'R', [0, 0, 0.1]),
      node('Battery', 'R', { kind: 'group', mass: { mass: 0.6 } }, [-0.1, 0.05, 0.03]),
      node(
        'Hub',
        'R',
        { kind: 'group', mass: { mass: 0.2, centerOfMass: [0, 0, 0.01] } },
        [0.1, 0, 0.05]
      )
    )
    const model = computeMassModel(objects, lookupOf({ 'g:Body': solid(LITER) }))
    expect(model.objects.Battery).toMatchObject({
      mass: 0.6,
      source: 'override',
      centerOfMass: [-0.1, 0.05, 0.03]
    })
    expect(model.objects.Hub.centerOfMass[2]).toBeCloseTo(0.06, 15)
    expect(model.robots.R.mass).toBeCloseTo(2.7 + 0.8, 12)
    expect(model.robots.R.fixedMass).toBeCloseTo(0.8, 15)
    expect(model.robots.R.estimatedMass).toBeCloseTo(2.7, 12)
  })

  it('덮어쓰기 안의 덮어쓰기는 안쪽 값을 고정하고 남은 질량을 나머지에 나눈다', () => {
    const objects = scene(
      robot(),
      node('A', 'R', { mass: { mass: 1 } }),
      node('B', 'A', { mass: { mass: 0.3 } }),
      part('P1', 'B'),
      part('P2', 'A'),
      node('X', 'R', { mass: { mass: 0.2 } }),
      part('Q1', 'X', [0, 0, 0], { mass: { mass: 0.5 } }),
      part('Q2', 'X')
    )
    const props = Object.fromEntries(
      ['P1', 'P2', 'Q1', 'Q2'].map((id) => [`g:${id}`, solid(LITER)])
    )
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.P1.mass).toBeCloseTo(0.3, 15)
    expect(model.objects.P2.mass).toBeCloseTo(0.7, 15)
    expect(model.objects.A.mass).toBeCloseTo(1, 15)
    // 안쪽이 바깥보다 크면 안쪽 값을 쓰고 바깥의 나머지는 0이며, 바깥 값을 쓰지 못한 것을 알린다
    expect(model.objects.Q1.mass).toBeCloseTo(0.5, 15)
    expect(model.objects.Q2.mass).toBe(0)
    expect(model.objects.X.mass).toBeCloseTo(0.5, 15)
    // 계약의 경고(warnings)가 아니라 notices로 알린다
    expect(model.robots.R.warnings).toEqual([])
    expect(model.robots.R.notices).toEqual([
      { kind: 'innerMassExceeds', objectId: 'X', mass: 0.2, inner: 0.5 }
    ])
    expect(model.robots.R.mass).toBeCloseTo(1.5, 15)
  })

  it('안쪽 덮어쓰기 합이 바깥 값과 같으면 알리지 않고, COTS 덩어리 안의 덮어쓰기도 같은 규칙이다', () => {
    const objects = scene(
      robot(),
      node('A', 'R', { mass: { mass: 1 } }),
      part('P1', 'A', [0, 0, 0], { mass: { mass: 0.6 } }),
      part('P2', 'A', [0, 0, 0], { mass: { mass: 0.4 } }),
      part('P3', 'A'),
      // 모터(goBILDA 5203 19.2:1, 437 g) 안의 1 kg 덮어쓰기
      node('M', 'R', { components: [motor(19.2)] }),
      part('Q', 'M', [0, 0, 0], { mass: { mass: 1 } })
    )
    const props = {
      ...Object.fromEntries(['P1', 'P2', 'P3'].map((id) => [`g:${id}`, solid(LITER)])),
      'g:Q': MOTOR_SIZE()
    }
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.P3.mass).toBe(0)
    expect(model.objects.A.mass).toBeCloseTo(1, 15)
    expect(model.robots.R.notices).toEqual([
      { kind: 'innerMassExceeds', objectId: 'M', mass: 0.437, inner: 1 }
    ])
  })

  it('안쪽 덮어쓰기가 질량을 다 쓰면 무게중심 덮어쓰기를 쓰지 못하고 알린다', () => {
    const objects = scene(
      robot(),
      // 안쪽이 바깥과 같음(남은 몫 0)
      node('M', 'R', { kind: 'group', mass: { mass: 1, centerOfMass: [0.5, 0, 0] } }),
      part('A', 'M', [0, 0, 0], { mass: { mass: 1 } }),
      // 안쪽이 바깥보다 큼
      node('N', 'R', { kind: 'group', mass: { mass: 0.2, centerOfMass: [0, 0.5, 0] } }),
      part('B', 'N', [0, 0, 0], { mass: { mass: 0.3 } }),
      // 남은 몫이 있으면 쓰고 알리지 않는다
      node('K', 'R', { kind: 'group', mass: { mass: 1, centerOfMass: [0, 0, 0.5] } }),
      part('C', 'K', [0, 0, 0], { mass: { mass: 0.5 } }),
      part('D', 'K')
    )
    const props = Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [`g:${id}`, solid(LITER)]))
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.M.centerOfMass).toEqual([0, 0, 0])
    expect(model.objects.K.centerOfMass[2]).toBeCloseTo(0.5, 14)
    expect(model.robots.R.notices).toEqual([
      { kind: 'centerOfMassIgnored', objectId: 'M' },
      { kind: 'innerMassExceeds', objectId: 'N', mass: 0.2, inner: 0.3 },
      { kind: 'centerOfMassIgnored', objectId: 'N' }
    ])
    expect(model.robots.R.warnings).toEqual([])
  })

  it('덩어리를 정하지 않은 오브젝트(질량·COTS 없음, 다른 덩어리 안의 COTS)의 무게중심 덮어쓰기도 알린다', () => {
    const objects = scene(
      robot(),
      // 재질만 정하고 무게중심을 넣은 어셈블리: 질량을 정하지 않아 쓰이지 않는다
      node('A', 'R', { mass: { material: 'steel', centerOfMass: [0.5, 0, 0] } }),
      part('A1', 'A'),
      // 덮어쓴 덩어리 안의 모터: 위 덩어리가 먼저라 모터 COTS가 덩어리를 만들지 않는다
      node('O', 'R', { mass: { mass: 2 } }),
      part('M', 'O', [0, 0, 0], {
        components: [motor(19.2)],
        mass: { centerOfMass: [0, 0.5, 0] }
      }),
      // 쓰이는 무게중심(COTS를 정한 오브젝트)은 알리지 않는다
      part('N', 'R', [0, 0, 0], { components: [motor(19.2)], mass: { centerOfMass: [0, 0, 0.1] } })
    )
    const props = { 'g:A1': solid(LITER), 'g:M': solid(LITER), 'g:N': MOTOR_SIZE() }
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.A.centerOfMass).toEqual(model.objects.A1.centerOfMass)
    expect(model.objects.N.centerOfMass[2]).toBeCloseTo(0.1, 14)
    // 문서 순서: A(덩어리 없음) → O(덩어리, 알릴 것 없음) → M(덩어리 없음)
    expect(model.robots.R.notices).toEqual([
      { kind: 'centerOfMassIgnored', objectId: 'A' },
      { kind: 'centerOfMassIgnored', objectId: 'M' }
    ])
    // 로봇 밖 오브젝트는 알릴 로봇이 없다
    const loose = {
      ...objects,
      L: { ...node('L', 'R', { mass: { centerOfMass: [0, 0, 0] } }), parentId: null }
    }
    expect(computeMassModel(loose, lookupOf(props)).robots.R.notices).toHaveLength(2)
  })

  it('컴포넌트 COTS는 붙은 오브젝트 하위 전체를 부피 비율로 덮는다', () => {
    const objects = scene(
      robot(),
      node('M', 'R', { components: [motor(19.2)] }),
      part('M1', 'M'),
      part('M2', 'M'),
      part('M3', 'M')
    )
    const props = Object.fromEntries(['M1', 'M2', 'M3'].map((id) => [`g:${id}`, MOTOR_SIZE()]))
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.M).toMatchObject({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
    expect(model.objects.M.mass).toBeCloseTo(0.437, 15)
    expect(model.objects.M3).toMatchObject({ source: 'cots', inheritedFrom: 'M' })
    expect(model.objects.M3.mass).toBeCloseTo(0.437 / 3, 15)
    expect(model.robots.R.notices).toEqual([])
  })

  it('덮어쓰기는 COTS보다 먼저이고, 한 오브젝트의 컴포넌트·바퀴 COTS는 더한다', () => {
    const objects = scene(
      robot(),
      node('M', 'R', { components: [motor(19.2)], mass: { mass: 0.5 } }),
      part('M1', 'M'),
      node('W', 'R', { components: [motor(19.2)], wheel: defaultWheel() }),
      part('W1', 'W')
    )
    const props = { 'g:M1': solid(LITER), 'g:W1': MOTOR_SIZE() }
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.M).toMatchObject({ mass: 0.5, source: 'override' })
    expect(model.objects.W).toMatchObject({
      source: 'cots',
      detail: 'motor:goBilda5203:19.2+wheel:gripForce104'
    })
    expect(model.objects.W.mass).toBeCloseTo(0.437 + 0.236, 15)
  })

  it('SKU 이름 COTS(배터리·바퀴), 라벨 이름의 SKU는 쓰지 않는다, Pinpoint 포드', () => {
    const objects = scene(
      robot(),
      node('B', 'R', { name: '3100-0012-0020' }),
      part('B1', 'B', [0, 0, 0], { name: 'Body' }),
      part('L', 'R', [0, 0, 0], { name: '5203-2402-0019 Label' }),
      part('Pin', 'R', [0, 0, 0], {
        name: 'Pinpoint',
        components: [
          {
            id: 'pp',
            type: 'pinpoint',
            name: 'pinpoint',
            hub: 'controlHub',
            port: 1,
            props: { podType: 'swingarm', xPod: 'X', yPod: 'missing' }
          }
        ]
      }),
      part('X', 'R', [0, 0, 0], { name: 'Pod' })
    )
    const props = {
      ...Object.fromEntries(['B1', 'L'].map((id) => [`g:${id}`, solid(LITER)])),
      'g:Pin': box(0.03, 0.03, 0.01),
      // 포드 크기의 형상(20 mm 정육면체). 1 L처럼 큰 형상은 포드로 보지 않는다(아래 tooLarge)
      'g:X': box(0.02, 0.02, 0.02)
    }
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.B).toMatchObject({ source: 'cots', detail: 'battery:gobilda' })
    expect(model.objects.B.mass).toBeCloseTo(0.597, 15)
    expect(model.objects.L).toMatchObject({ mass: 0, source: 'nameRule', detail: 'label' })
    expect(model.objects.Pin.mass).toBeCloseTo(0.04, 15)
    expect(model.objects.X).toMatchObject({ source: 'cots', detail: 'pod:swingarm' })
    expect(model.objects.X.mass).toBeCloseTo(0.121, 15)
    expect(model.robots.R.notices).toEqual([])
  })

  describe('SKU 제품은 원래 이름 경로로 정하고 이름을 바꾸거나 옮겨도 질량이 같다', () => {
    const cad = {
      fileName: 'kit.step',
      absolutePath: '/kit.step',
      upAxis: '+Z' as const,
      forwardAxis: '+X' as const,
      bounds: { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 },
      meshCount: 6
    }
    // CAD 루트 C 안에 모터 어셈블리(SKU, 이름 없는 솔리드 셋에 붙인 이름)와 배터리 어셈블리(SKU, 셀 둘), 판 하나
    const imported = scene(
      robot(),
      node('C', 'R', { name: 'Kit', cad }),
      node('M', 'C', { name: '5203-2402-0019' }),
      part('M1', 'M', [0, 0, 0], { name: '5203-2402-0019 1' }),
      part('M2', 'M', [0.01, 0, 0], { name: '5203-2402-0019 2' }),
      part('M3', 'M', [0.02, 0, 0], { name: '5203-2402-0019 3' }),
      node('B', 'C', { name: '3100-0012-0020' }),
      part('B1', 'B', [0, 0.1, 0], { name: '3100-0012-0020 1' }),
      part('B2', 'B', [0, 0.2, 0], { name: '3100-0012-0020 2' }),
      part('Plate', 'C', [0, 0, 0], { name: 'Plate' })
    )
    const ids = ['M1', 'M2', 'M3', 'B1', 'B2', 'Plate']
    const props = Object.fromEntries(ids.map((id) => [`g:${id}`, box(0.02, 0.02, 0.02)]))
    const generated = Object.fromEntries(
      ids.filter((id) => id !== 'Plate').map((id) => [`g:${id}`, ''])
    )
    const paths = Object.fromEntries(
      ids.map((id) => [
        `g:${id}`,
        sceneLookup(imported, lookupOf(props, generated)).sourcePath(`g:${id}`) as SourceNode[]
      ])
    )
    const lookup = lookupOf(props, generated, paths)
    const plate = 8e-6 * 2700
    const total = 0.437 + 0.597 + plate

    it('불러온 그대로: 제품마다 데이터시트 질량 한 번', () => {
      const model = computeMassModel(imported, lookup)
      expect(model.objects.M).toMatchObject({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
      expect(model.objects.M.mass).toBeCloseTo(0.437, 12)
      expect(model.objects.M2).toMatchObject({ source: 'cots', inheritedFrom: 'M' })
      expect(model.objects.B.mass).toBeCloseTo(0.597, 12)
      expect(model.robots.R.mass).toBeCloseTo(total, 12)
    })

    it('SKU 어셈블리·CAD 루트 이름을 바꿔도 붙인 이름의 솔리드마다 제품 질량을 받지 않는다', () => {
      const renamed: SceneObjects = {
        ...imported,
        M: { ...imported.M, name: 'Left Front Motor' },
        B: { ...imported.B, name: 'Battery' },
        C: { ...imported.C, name: 'Robot' }
      }
      const model = computeMassModel(renamed, lookup)
      expect(model.objects.M).toMatchObject({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
      expect(model.objects.M.mass).toBeCloseTo(0.437, 12)
      expect(model.objects.B.mass).toBeCloseTo(0.597, 12)
      expect(model.robots.R.mass).toBeCloseTo(total, 12)
    })

    it('제품 솔리드 하나를 그룹으로 옮겨도 제품 질량은 한 번이고 옮긴 솔리드도 제품 몫을 받는다', () => {
      const moved: SceneObjects = {
        ...imported,
        G: node('G', 'R', { kind: 'group', name: 'Lift' }),
        M3: { ...imported.M3, parentId: 'G', cadOrigin: 'C' }
      }
      const model = computeMassModel(moved, lookup)
      expect(model.robots.R.mass).toBeCloseTo(total, 12)
      expect(model.objects.M3).toMatchObject({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
      expect(model.objects.M3.mass).toBeCloseTo(0.437 / 3, 12)
      expect(model.objects.M.mass).toBeCloseTo((2 * 0.437) / 3, 12)
      // 출처의 주인은 제품 메시만 품은 오브젝트 중 가장 많이 품은 것(원래 모터 어셈블리)이다. 옮긴 그룹·로봇이 아니다
      expect(model.objects.M3.inheritedFrom).toBe('M')
      expect(model.objects.M2.inheritedFrom).toBe('M')
    })

    it('제품 솔리드를 옮겨도 다른 것을 품은 상위의 무게중심 덮어쓰기를 제품이 가져가지 않는다', () => {
      // CAD 루트에 질량 없이 무게중심만 둔다(쓰이지 않아 알린다)
      const centered: SceneObjects = {
        ...imported,
        C: { ...imported.C, mass: { centerOfMass: [0, 0, 0.3] } }
      }
      // 모터 솔리드 하나를 같은 CAD 루트 안 배터리 어셈블리로 옮긴다(모터 메시를 모두 품은 것은 CAD 루트가 된다)
      const moved: SceneObjects = { ...centered, M1: { ...centered.M1, parentId: 'B' } }
      const before = computeMassModel(centered, lookup)
      const after = computeMassModel(moved, lookup)
      expect(before.robots.R.notices).toEqual([{ kind: 'centerOfMassIgnored', objectId: 'C' }])
      expect(after.robots.R.notices).toEqual(before.robots.R.notices)
      expect(after.robots.R.mass).toBeCloseTo(before.robots.R.mass, 12)
      for (let k = 0; k < 3; k++)
        expect(after.robots.R.centerOfMass[k], `com ${k}`).toBeCloseTo(
          before.robots.R.centerOfMass[k],
          12
        )
    })

    it('제품 솔리드 하나를 옮겨도 원래 제품 어셈블리의 무게중심 덮어쓰기를 계속 쓴다', () => {
      const centered: SceneObjects = {
        ...imported,
        M: { ...imported.M, mass: { centerOfMass: [0, 0, 0.3] } }
      }
      const moved: SceneObjects = {
        ...centered,
        G: node('G', 'R', { kind: 'group', name: 'Lift' }),
        M3: { ...centered.M3, parentId: 'G', cadOrigin: 'C' }
      }
      const before = computeMassModel(centered, lookup)
      const after = computeMassModel(moved, lookup)
      expect(before.robots.R.notices).toEqual([])
      expect(after.robots.R.notices).toEqual([])
      for (let k = 0; k < 3; k++)
        expect(after.robots.R.centerOfMass[k], `com ${k}`).toBeCloseTo(
          before.robots.R.centerOfMass[k],
          12
        )
    })

    it('같은 부품의 컴포넌트 COTS가 제품 일부를 덮으면 나머지 제품 메시도 그 덩어리에 든다', () => {
      const withMotor: SceneObjects = {
        ...imported,
        M: { ...imported.M, components: [motor(13.7)] },
        G: node('G', 'R', { kind: 'group', name: 'Lift' }),
        M3: { ...imported.M3, parentId: 'G', cadOrigin: 'C' }
      }
      const model = computeMassModel(withMotor, lookup)
      // 컴포넌트(사용자 설정, 13.7:1 438 g)가 이긴다. 옮긴 솔리드도 그 모터의 몫이다
      expect(model.objects.M3).toMatchObject({
        source: 'cots',
        detail: 'motor:goBilda5203:13.7',
        inheritedFrom: 'M'
      })
      expect(model.robots.R.mass).toBeCloseTo(0.438 + 0.597 + plate, 12)
    })

    it('덮어쓰기가 제품 일부를 덮으면 그 몫(부피 비율)을 제품 질량에서 뺀다', () => {
      const overridden: SceneObjects = {
        ...imported,
        B2: { ...imported.B2, mass: { mass: 0.1 } }
      }
      const model = computeMassModel(overridden, lookup)
      expect(model.objects.B2.mass).toBeCloseTo(0.1, 12)
      expect(model.objects.B1.mass).toBeCloseTo(0.597 / 2, 12)
      expect(model.robots.R.mass).toBeCloseTo(0.437 + 0.597 / 2 + 0.1 + plate, 12)
    })

    it('제품의 주인에 둔 무게중심 덮어쓰기를 쓴다', () => {
      const centered: SceneObjects = {
        ...imported,
        B: { ...imported.B, mass: { centerOfMass: [0, 0, 0.3] } }
      }
      const model = computeMassModel(centered, lookup)
      expect(model.robots.R.notices).toEqual([])
      const origin = computeMassModel(imported, lookup).objects.B.centerOfMass
      expect(model.objects.B.centerOfMass[2] - origin[2]).toBeCloseTo(0.3, 9)
    })

    describe('제품 솔리드를 지우거나 옮겨 원래 어셈블리에 하나만 남아도 그 어셈블리가 주인이다', () => {
      const centered: SceneObjects = {
        ...imported,
        B: { ...imported.B, mass: { centerOfMass: [0, 0, 0.3] } },
        M: { ...imported.M, mass: { centerOfMass: [0, 0, 0.3] } }
      }
      const before = computeMassModel(centered, lookup)
      const group = node('G', 'R', { kind: 'group', name: 'Lift' })
      const expectSameCenter = (objects: SceneObjects): void => {
        const after = computeMassModel(objects, lookup)
        expect(after.robots.R.notices).toEqual([])
        expect(after.robots.R.mass).toBeCloseTo(before.robots.R.mass, 12)
        for (let k = 0; k < 3; k++)
          expect(after.robots.R.centerOfMass[k], `com ${k}`).toBeCloseTo(
            before.robots.R.centerOfMass[k],
            12
          )
      }

      it('배터리 셀 하나를 그룹으로 옮겨도 배터리 어셈블리의 무게중심 덮어쓰기를 쓴다', () => {
        expect(before.robots.R.notices).toEqual([])
        const moved: SceneObjects = {
          ...centered,
          G: group,
          B1: { ...centered.B1, parentId: 'G', cadOrigin: 'C' }
        }
        expect(computeMassModel(moved, lookup).objects.B1.inheritedFrom).toBe('B')
        expectSameCenter(moved)
      })

      it('배터리 셀 하나를 지워도 남은 셀이 아니라 배터리 어셈블리가 주인이다', () => {
        const deleted: SceneObjects = { ...centered }
        delete deleted.B1
        const model = computeMassModel(deleted, lookup)
        expect(model.robots.R.notices).toEqual([])
        expect(model.objects.B2).toMatchObject({ source: 'cots', inheritedFrom: 'B' })
        expect(model.objects.B.mass).toBeCloseTo(0.597, 12)
        const origin = computeMassModel(imported, lookup).objects.B.centerOfMass
        expect(model.objects.B.centerOfMass[2] - origin[2]).toBeCloseTo(0.3, 9)
      })

      it('모터 솔리드 셋 중 둘을 그룹으로 옮겨도 모터 어셈블리가 주인이다(그룹이 아니다)', () => {
        const moved: SceneObjects = {
          ...centered,
          G: group,
          M1: { ...centered.M1, parentId: 'G', cadOrigin: 'C' },
          M2: { ...centered.M2, parentId: 'G', cadOrigin: 'C' }
        }
        expect(computeMassModel(moved, lookup).objects.M1.inheritedFrom).toBe('M')
        expectSameCenter(moved)
      })

      it('제품의 CAD 오브젝트가 모두 사라지면 제품 메시를 모두 품은 그룹이 주인이다', () => {
        const regrouped: SceneObjects = {
          ...imported,
          G: node('G', 'R', {
            kind: 'group',
            name: 'Battery',
            mass: { centerOfMass: [0, 0, 0.3] }
          }),
          B1: { ...imported.B1, parentId: 'G', cadOrigin: 'C' },
          B2: { ...imported.B2, parentId: 'G', cadOrigin: 'C' }
        }
        delete regrouped.B
        const model = computeMassModel(regrouped, lookup)
        expect(model.robots.R.notices).toEqual([])
        expect(model.objects.B1).toMatchObject({ source: 'cots', inheritedFrom: 'G' })
        expect(model.objects.G.mass).toBeCloseTo(0.597, 12)
      })
    })
  })

  describe('컴포넌트·바퀴 COTS도 하위가 그 부품 하나로 볼 수 있을 때만 하위를 덮는다', () => {
    const cad = {
      fileName: 'r.step',
      absolutePath: '/r.step',
      upAxis: '+Z' as const,
      forwardAxis: '+X' as const,
      bounds: { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 },
      meshCount: 3
    }
    const pinpointComponent: HardwareComponent = {
      id: 'pp',
      type: 'pinpoint',
      name: 'pinpoint',
      hub: 'controlHub',
      port: 1,
      props: { podType: 'fourBar', xPod: '', yPod: '' }
    }
    // 알루미늄 판(0.4 × 0.4 × 0.01 m, 4.32 kg)과 작은 모터 몸체를 품은 CAD 루트
    const base = scene(
      robot(),
      node('C', 'R', { name: 'Robot CAD', cad }),
      node('Chassis', 'C', { name: 'Chassis' }),
      part('Plate', 'Chassis', [0, 0, 0], { name: 'Chassis Plate' }),
      node('Drive', 'C', { name: 'Drive' }),
      part('Mot', 'Drive', [0, 0, 0], { name: 'Motor body' })
    )
    const props = { 'g:Plate': box(0.4, 0.4, 0.01), 'g:Mot': box(0.03, 0.03, 0.06) }
    const plain = computeMassModel(base, lookupOf(props))
    const ignored = (objectId: string, keys: string[], reason: string): object => ({
      kind: 'cotsIgnored',
      objectId,
      keys,
      reason
    })

    it('부품 크기의 형상이면 데이터시트 질량이 하위를 덮는다', () => {
      const model = computeMassModel(
        { ...base, Mot: { ...base.Mot, components: [motor(19.2)] } },
        lookupOf(props)
      )
      expect(model.objects.Mot).toMatchObject({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
      expect(model.robots.R.notices).toEqual([])
    })

    it('큰 형상(알루미늄으로 쳐서 표 질량의 1.6배 넘음, 바퀴는 4배)이면 추정하고 tooLarge로 알린다', () => {
      const model = computeMassModel(
        { ...base, Chassis: { ...base.Chassis, components: [pinpointComponent] } },
        lookupOf(props)
      )
      expect(model.objects.Chassis.source).not.toBe('cots')
      expect(model.robots.R.mass).toBeCloseTo(plain.robots.R.mass, 12)
      expect(model.robots.R.notices).toEqual([ignored('Chassis', ['pinpoint'], 'tooLarge')])
    })

    describe('크기 한도는 부품 종류마다 다르다(모터·서보·Pinpoint·포드·Limelight 1.6배, 바퀴 4배)', () => {
      const servo: HardwareComponent = { ...motor(1), id: 's', type: 'servo', props: {} }
      // 평탄화된 서브시스템: 최상위 컴포넌트 아래에 솔리드가 바로 있고 모터·서보 SKU 노드가 없다
      const subsystem = (
        name: string,
        component: HardwareComponent,
        solids: Record<string, MeshMassProps>
      ): { objects: SceneObjects; props: Record<string, MeshMassProps> } => ({
        objects: {
          ...scene(robot(), node('C', 'R', { name: 'Robot CAD', cad }), node('S', 'C', { name })),
          ...Object.fromEntries(
            Object.keys(solids).map((id) => [
              id,
              part(id, 'S', [0, 0, 0], { name: `${name} ${id}` })
            ])
          ),
          S: { ...node('S', 'C', { name }), components: [component] }
        },
        props: Object.fromEntries(Object.entries(solids).map(([id, p]) => [`g:${id}`, p]))
      })
      const generated = (ids: string[]): Record<string, string> =>
        Object.fromEntries(ids.map((id) => [`g:${id}`, '']))
      const run = (
        input: ReturnType<typeof subsystem>,
        withComponent = true
      ): ReturnType<typeof computeMassModel> => {
        const objects = withComponent
          ? input.objects
          : { ...input.objects, S: { ...input.objects.S, components: [] } }
        return computeMassModel(
          objects,
          lookupOf(input.props, generated(Object.keys(input.props).map((g) => g.slice(2))))
        )
      }

      it('인테이크(옆판 둘·롤러 관·모터 몸체)에 붙인 모터 컴포넌트는 서브시스템 질량을 지우지 않는다', () => {
        const intake = subsystem('Intake', motor(19.2), {
          L: box(0.2, 0.004, 0.12),
          Rt: box(0.2, 0.004, 0.12),
          T: box(0.3, 0.03, 0.03),
          Mb: box(0.037, 0.1, 0.037)
        })
        const estimated = run(intake, false)
        const model = run(intake)
        // 알루미늄으로 쳐서 0.96 kg: 4배 한도(1.75 kg)는 받았지만 1.6배(0.70 kg)는 넘는다
        expect(model.objects.S.source).not.toBe('cots')
        expect(model.robots.R.mass).toBeCloseTo(estimated.robots.R.mass, 12)
        expect(model.robots.R.notices).toEqual([
          ignored('S', ['motor:goBilda5203:19.2'], 'tooLarge')
        ])
      })

      it('집게(판 + 서보 몸체)에 붙인 서보 컴포넌트는 판 질량을 지우지 않고, 서보 몸체만이면 서보다', () => {
        const claw = subsystem('Claw', servo, {
          P: box(0.1, 0.05, 0.003),
          Sv: box(0.04, 0.02, 0.038)
        })
        const model = run(claw)
        expect(model.objects.S.source).not.toBe('cots')
        expect(model.robots.R.mass).toBeCloseTo(run(claw, false).robots.R.mass, 12)
        expect(model.robots.R.notices).toEqual([ignored('S', ['servo:gobildaTorque'], 'tooLarge')])
        const body = run(subsystem('Claw', servo, { Sv: box(0.04, 0.02, 0.038) }))
        expect(body.objects.S).toMatchObject({ source: 'cots', detail: 'servo:gobildaTorque' })
        expect(body.robots.R.notices).toEqual([])
      })

      it('실제 상용 부품 CAD 부피(× 2.70이 표 질량의 1.2배 이하)는 그 부품으로 본다', () => {
        // scratchpad CAD 실측: REV Smart Robot Servo 25.75 cm³(표 60 g), 4-Bar 포드 34.2 cm³(84 g),
        // Pinpoint 11.59 cm³(40 g), Limelight 3A 17.92 cm³(93 g)
        const cases: [HardwareComponent, number][] = [
          [servo, 25.75e-6],
          [pinpointComponent, 11.59e-6],
          [{ ...servo, type: 'limelight', props: {} }, 17.92e-6]
        ]
        for (const [component, volume] of cases) {
          const model = run(subsystem('Part', component, { V: solid(volume) }))
          expect(model.objects.S.source, component.type).toBe('cots')
          expect(model.robots.R.notices, component.type).toEqual([])
        }
      })

      it('속이 찬 원기둥으로 그린 바퀴(104 × 38 mm, 표의 3.7배)도 바퀴로 본다', () => {
        const wheel = { ...defaultWheel(), kind: 'mecanum' as const, diameter: 0.104 }
        const cylinder = solid(Math.PI * 0.052 ** 2 * 0.038)
        const objects: SceneObjects = {
          ...scene(robot(), node('C', 'R', { name: 'Robot CAD', cad })),
          W: node('W', 'C', { name: 'Wheel', wheel }),
          W1: part('W1', 'W', [0, 0, 0], { name: 'Wheel 1' })
        }
        const model = computeMassModel(objects, lookupOf({ 'g:W1': cylinder }, { 'g:W1': '' }))
        expect(model.objects.W).toMatchObject({ source: 'cots', detail: 'wheel:gripForce104' })
        expect(model.robots.R.notices).toEqual([])
      })
    })

    it('CAD 루트를 품으면 containsCad, 다른 COTS를 품으면 containsCots이고 안의 COTS는 그대로 쓴다', () => {
      const group: SceneObjects = {
        ...scene(robot(), node('G', 'R', { kind: 'group', components: [motor(19.2)] })),
        ...Object.fromEntries(Object.entries(base).filter(([id]) => id !== 'R')),
        C: { ...base.C, parentId: 'G' }
      }
      const inGroup = computeMassModel(group, lookupOf(props))
      expect(inGroup.robots.R.notices).toEqual([
        ignored('G', ['motor:goBilda5203:19.2'], 'containsCad')
      ])
      expect(inGroup.robots.R.mass).toBeCloseTo(plain.robots.R.mass, 12)
      // 구동계 어셈블리에 붙인 모터 컴포넌트 넷: 안의 서보가 다른 COTS다
      const drive = computeMassModel(
        {
          ...base,
          Drive: { ...base.Drive, components: [motor(19.2), motor(19.2)] },
          Mot: { ...base.Mot, components: [{ ...motor(1), type: 'servo', props: {} }] }
        },
        // 서보 크기의 몸체(40 × 20 × 38 mm)
        lookupOf({ ...props, 'g:Mot': box(0.04, 0.02, 0.038) })
      )
      expect(drive.robots.R.notices).toEqual([
        ignored('Drive', ['motor:goBilda5203:19.2', 'motor:goBilda5203:19.2'], 'containsCots')
      ])
      expect(drive.objects.Mot).toMatchObject({ source: 'cots', detail: 'servo:gobildaTorque' })
    })

    it('바퀴 COTS도 같은 규칙이고, 바퀴의 SKU 제품은 같은 부품이라 품어도 된다', () => {
      const wheel = { ...defaultWheel(), kind: 'mecanum' as const, diameter: 0.104 }
      // 팀 CAD의 바퀴 모듈 어셈블리(SKU 아님) 안의 바퀴 SKU 어셈블리
      const withWheel: SceneObjects = {
        ...base,
        W: node('W', 'C', { name: 'Wheel Module', wheel }),
        WS: node('WS', 'W', { name: '3625-0100-0104' }),
        W1: part('W1', 'WS', [0, 0, 0], { name: '3625-0100-0104 1' })
      }
      const small = { ...props, 'g:W1': box(0.05, 0.05, 0.03) }
      const model = computeMassModel(withWheel, lookupOf(small, { 'g:W1': '' }))
      expect(model.objects.W).toMatchObject({ source: 'cots', detail: 'wheel:gripForce104' })
      expect(model.objects.W.mass).toBeCloseTo(0.236, 12)
      expect(model.robots.R.notices).toEqual([])
      // 모터 SKU 제품도 품은 바퀴 모듈은 바퀴 하나가 아니다
      const motorInside = computeMassModel(
        {
          ...withWheel,
          WM: node('WM', 'W', { name: '5203-2402-0019' }),
          WM1: part('WM1', 'WM', [0, 0, 0], { name: 'Can' })
        },
        lookupOf({ ...small, 'g:WM1': box(0.01, 0.01, 0.01) }, { 'g:W1': '' })
      )
      expect(motorInside.robots.R.notices).toEqual([
        ignored('W', ['wheel:gripForce104'], 'containsCots')
      ])
      expect(motorInside.objects.WM).toMatchObject({
        source: 'cots',
        detail: 'motor:goBilda5203:19.2'
      })
      expect(motorInside.objects.W1.source).toBe('cots')
    })
  })

  describe('Pinpoint 포드로 볼 수 없는 오브젝트는 포드 질량을 쓰지 않고 알린다', () => {
    const pinpoint = (xPod: string, yPod = ''): HardwareComponent => ({
      id: 'pp',
      type: 'pinpoint',
      name: 'pinpoint',
      hub: 'controlHub',
      port: 1,
      props: { podType: 'fourBar', xPod, yPod }
    })
    // CAD 루트 C 안에 Pinpoint 파트와 큰 판(0.5 × 0.5 × 0.1 m 알루미늄, 67.5 kg), 따로 포드 파트·모터 어셈블리
    const base = (xPod: string, yPod = ''): SceneObjects =>
      scene(
        robot(),
        node('C', 'R', {
          name: 'Robot CAD',
          cad: {
            fileName: 'r.step',
            absolutePath: '/r.step',
            upAxis: '+Z',
            forwardAxis: '+X',
            bounds: { min: [0, 0, 0], max: [1, 1, 1] },
            meshCount: 6
          }
        }),
        part('Pin', 'C', [0, 0, 0], { name: 'Pinpoint', components: [pinpoint(xPod, yPod)] }),
        part('Big', 'C', [0, 0, 0], { name: 'Plate' }),
        part('Pod', 'C', [0.1, 0, 0], { name: 'Pod' }),
        node('Drive', 'C', { name: 'Drive' }),
        part('Mot', 'Drive', [0, 0, 0], { name: 'Motor', components: [motor(19.2)] }),
        node('Arm', 'C', { name: 'Arm' }),
        part('Arm1', 'Arm', [0, 0, 0], { name: 'Arm Plate' }),
        node('Other', 'R', { kind: 'group' }),
        part('Far', 'Other', [0, 0, 0], { name: 'Far' })
      )
    const props = {
      'g:Pin': box(0.03, 0.03, 0.01),
      'g:Big': box(0.5, 0.5, 0.1),
      'g:Pod': box(0.02, 0.02, 0.02),
      'g:Mot': box(0.04, 0.04, 0.1),
      'g:Arm1': box(0.3, 0.05, 0.01),
      'g:Far': box(0.02, 0.02, 0.02)
    }
    const run = (xPod: string, yPod = ''): ReturnType<typeof computeMassModel> =>
      computeMassModel(base(xPod, yPod), lookupOf(props))
    const ignored = (objectId: string, reason: string): object => ({
      kind: 'cotsIgnored',
      objectId,
      keys: ['pod:fourBar'],
      reason,
      pinpointId: 'Pin'
    })

    it('작은 포드 파트는 포드 질량(84 g)이다', () => {
      const model = run('Pod')
      expect(model.objects.Pod).toMatchObject({ source: 'cots', detail: 'pod:fourBar' })
      expect(model.objects.Pod.mass).toBeCloseTo(0.084, 15)
      expect(model.robots.R.notices).toEqual([])
    })

    it('Pinpoint 자신·상위(CAD 루트, 로봇)는 containsPinpoint, 하위 형상은 그대로 추정한다', () => {
      const plain = run('')
      for (const target of ['Pin', 'C', 'R']) {
        const model = run(target)
        expect(model.robots.R.notices).toEqual([ignored(target, 'containsPinpoint')])
        expect(model.robots.R.mass).toBeCloseTo(plain.robots.R.mass, 12)
        expect(model.objects.Pin).toMatchObject({ source: 'cots', detail: 'pinpoint' })
        expect(model.objects.Big.mass).toBeCloseTo(0.025 * 2700, 9)
      }
    })

    it('다른 COTS를 품은 것은 containsCots, 큰 형상은 tooLarge, 로봇 밖은 otherRobot', () => {
      expect(run('Drive').robots.R.notices).toEqual([ignored('Drive', 'containsCots')])
      expect(run('Drive').objects.Mot).toMatchObject({
        source: 'cots',
        detail: 'motor:goBilda5203:19.2'
      })
      // 0.3 × 0.05 × 0.01 m = 150 cm³ → 405 g > 1.6 × 84 g
      expect(run('Arm').robots.R.notices).toEqual([ignored('Arm', 'tooLarge')])
      expect(run('Arm').objects.Arm1.source).not.toBe('cots')
      expect(run('Big').robots.R.notices).toEqual([ignored('Big', 'tooLarge')])
      // 포드 둘을 품은 어셈블리는 두 번째 포드를 덮으므로 containsCots
      const both = computeMassModel(
        {
          ...base('Arm', 'Pod2'),
          Pod2: part('Pod2', 'Arm', [0, 0, 0], { name: 'Pod 2' })
        },
        lookupOf({ ...props, 'g:Arm1': box(0.01, 0.01, 0.01), 'g:Pod2': box(0.01, 0.01, 0.01) })
      )
      expect(both.robots.R.notices).toEqual([ignored('Arm', 'containsCots')])
      expect(both.objects.Pod2).toMatchObject({ source: 'cots', detail: 'pod:fourBar' })
      // 로봇 CAD 루트를 품은 그룹(Pinpoint는 그 밖의 그룹 Other로 옮김)은 안의 모터로 containsCots, 모터가 없어도
      // CAD 루트를 품어 containsCad다
      const wrapped = base('G')
      const withGroup: SceneObjects = {
        ...scene(robot(), node('G', 'R', { kind: 'group' })),
        ...Object.fromEntries(Object.entries(wrapped).filter(([id]) => id !== 'R')),
        C: { ...wrapped.C, parentId: 'G' },
        Pin: { ...wrapped.Pin, parentId: 'Other' }
      }
      expect(computeMassModel(withGroup, lookupOf(props)).robots.R.notices).toEqual([
        ignored('G', 'containsCots')
      ])
      const withoutMotor = Object.fromEntries(
        Object.entries(withGroup).filter(([id]) => id !== 'Mot')
      )
      expect(computeMassModel(withoutMotor, lookupOf(props)).robots.R.notices).toEqual([
        ignored('G', 'containsCad')
      ])
      // 로봇 밖 오브젝트
      const outside = {
        ...base('Loose'),
        Loose: { ...part('Loose', 'R', [0, 0, 0]), parentId: null }
      }
      expect(computeMassModel(outside, lookupOf(props)).robots.R.notices).toEqual([
        ignored('Loose', 'otherRobot')
      ])
    })

    it('하위의 이름 SKU(배터리 등)도 containsCots, 포드 어셈블리의 붙인 이름 솔리드는 아니다', () => {
      const withBattery = {
        ...base('Arm'),
        Bat: part('Bat', 'Arm', [0, 0, 0], { name: '3100-0012-0020 Battery' })
      }
      const small = { ...props, 'g:Arm1': box(0.01, 0.01, 0.01), 'g:Bat': box(0.01, 0.01, 0.01) }
      // 원래 CAD 이름이 SKU
      const named = computeMassModel(
        withBattery,
        lookupOf(small, { 'g:Bat': '3100-0012-0020 Battery' })
      )
      expect(named.robots.R.notices).toEqual([ignored('Arm', 'containsCots')])
      expect(named.objects.Bat).toMatchObject({ source: 'cots', detail: 'battery:gobilda' })
      // 어셈블리 이름 SKU도 센다
      const assembly = {
        ...base('Arm'),
        Sub: node('Sub', 'Arm', { name: 'REV-31-1302 Slim Battery' }),
        Cell: part('Cell', 'Sub', [0, 0, 0], { name: 'Cell' })
      }
      const cell = { ...small, 'g:Cell': box(0.01, 0.01, 0.01) }
      expect(computeMassModel(assembly, lookupOf(cell)).robots.R.notices).toEqual([
        ignored('Arm', 'containsCots')
      ])
      // 불러올 때 붙인 이름(원래 이름 '')은 위 노드 이름을 되풀이할 뿐이라 세지 않는다
      const generated = {
        ...base('PodAsm'),
        PodAsm: node('PodAsm', 'C', { name: '3110-0001-0002 4-Bar Pod' }),
        PodA: part('PodA', 'PodAsm', [0, 0, 0], { name: '3110-0001-0002 4-Bar Pod 1' })
      }
      const model = computeMassModel(
        generated,
        lookupOf({ ...props, 'g:PodA': box(0.02, 0.02, 0.02) }, { 'g:PodA': '' })
      )
      expect(model.robots.R.notices).toEqual([])
      expect(model.objects.PodAsm).toMatchObject({ source: 'cots', detail: 'pod:fourBar' })
    })

    it('포드만 따로 불러온 작은 CAD 루트는 포드다', () => {
      const podCad = {
        ...base('PodCad'),
        PodCad: node('PodCad', 'R', {
          name: 'Pod CAD',
          cad: {
            fileName: 'pod.step',
            absolutePath: '/pod.step',
            upAxis: '+Z',
            forwardAxis: '+X',
            bounds: { min: [0, 0, 0], max: [0.03, 0.03, 0.03] },
            meshCount: 1
          }
        }),
        PodPart: part('PodPart', 'PodCad', [0, 0, 0], { name: 'Pod body' })
      }
      const model = computeMassModel(
        podCad,
        lookupOf({ ...props, 'g:PodPart': box(0.02, 0.02, 0.02) })
      )
      expect(model.robots.R.notices).toEqual([])
      expect(model.objects.PodCad.mass).toBeCloseTo(0.084, 15)
    })

    it('실제 goBILDA 포드 STEP 이름("<SKU>-V1.0 …" 낱개, 포드 SKU 어셈블리)이어도 포드 CAD 루트는 포드다', () => {
      const cad = {
        fileName: '3110-0001-0002.step',
        absolutePath: '/3110-0001-0002.step',
        upAxis: '+Z' as const,
        forwardAxis: '+X' as const,
        bounds: { min: [0, 0, 0] as Vec3, max: [0.05, 0.05, 0.05] as Vec3 },
        meshCount: 4
      }
      // 실제 3110-0001-0002 STEP의 최상위 이름들(낱개 부품, 나사, 포드 SKU 그대로인 어셈블리)
      const names: Record<string, string> = {
        'g:Body': '3110-0001-0002-V1.0 main body v2',
        'g:Ctl': '3110-0001-0002-V1.0 control arm v2',
        'g:Screw': '1601-0408-0003 v1',
        'g:Inner': ''
      }
      const scenePod = (xPod: string): SceneObjects => ({
        ...base(xPod),
        // 실제 파일의 CAD 루트 이름(STEP 최상위 PRODUCT)
        PodCad: node('PodCad', 'R', { name: '(Unsaved)', cad }),
        Body: part('Body', 'PodCad', [0, 0, 0], { name: names['g:Body'] }),
        Ctl: part('Ctl', 'PodCad', [0, 0, 0], { name: names['g:Ctl'] }),
        Screw: part('Screw', 'PodCad', [0, 0, 0], { name: names['g:Screw'] }),
        Asm: node('Asm', 'PodCad', { name: '3110-0001-0002 (0°)' }),
        Inner: part('Inner', 'Asm', [0, 0, 0], { name: '3110-0001-0002 (0°) 1' })
      })
      const podProps = {
        ...props,
        'g:Body': box(0.02, 0.02, 0.02),
        'g:Ctl': box(0.03, 0.01, 0.005),
        'g:Screw': box(0.003, 0.003, 0.01),
        'g:Inner': box(0.01, 0.01, 0.01)
      }
      const model = computeMassModel(scenePod('PodCad'), lookupOf(podProps, names))
      expect(model.robots.R.notices).toEqual([])
      expect(model.objects.PodCad).toMatchObject({ source: 'cots', detail: 'pod:fourBar' })
      expect(model.objects.PodCad.mass).toBeCloseTo(0.084, 15)
      // 포드로 가리키지 않으면 낱개 부품은 포드 질량을 하나씩 받지 않고 추정한다(포드 SKU 어셈블리 하나만 포드)
      const loose = computeMassModel(scenePod(''), lookupOf(podProps, names))
      expect(loose.objects.Body.source).not.toBe('cots')
      expect(loose.objects.Ctl.source).not.toBe('cots')
      expect(loose.objects.Asm).toMatchObject({ source: 'cots', detail: 'pod:fourBar' })
      expect(loose.objects.Asm.mass).toBeCloseTo(0.084, 15)
      // 다른 포드 SKU(Swingarm)를 품으면 포드 둘이라 containsCots
      const twoPods = {
        ...scenePod('PodCad'),
        Asm: node('Asm', 'PodCad', { name: '3110-0001-0001 Swingarm' })
      }
      expect(computeMassModel(twoPods, lookupOf(podProps, names)).robots.R.notices).toEqual([
        ignored('PodCad', 'containsCots')
      ])
      // 같은 포드 SKU를 서로 품은 것(포드 어셈블리 안의 같은 SKU 어셈블리)은 포드 하나다
      const nested = {
        ...scenePod('PodCad'),
        Sub: node('Sub', 'Asm', { name: '3110-0001-0002 (0°) inner' }),
        Inner: part('Inner', 'Sub', [0, 0, 0], { name: '3110-0001-0002 (0°) 1' })
      }
      const nestedModel = computeMassModel(nested, lookupOf(podProps, names))
      expect(nestedModel.robots.R.notices).toEqual([])
      expect(nestedModel.objects.PodCad).toMatchObject({ source: 'cots', detail: 'pod:fourBar' })
    })

    it('같은 포드 SKU를 둘 이상 품은 상위 어셈블리는 포드 하나로 보지 않는다(containsCots)', () => {
      // CAD 루트 C 안에 Pinpoint와, 포드 둘을 품은 "Odometry" 어셈블리
      const odometry: SceneObjects = {
        Odo: node('Odo', 'C', { name: 'Odometry' }),
        Pod1: node('Pod1', 'Odo', { name: '3110-0001-0002 (0°)' }),
        P1: part('P1', 'Pod1'),
        Pod2: node('Pod2', 'Odo', { name: '3110-0001-0002 (0°) (1)' }),
        P2: part('P2', 'Pod2')
      }
      const lookup = lookupOf({ ...props, 'g:P1': solid(15e-6), 'g:P2': solid(15e-6) })
      for (const yPod of ['Odo', '']) {
        const model = computeMassModel({ ...base('Odo', yPod), ...odometry }, lookup)
        expect(model.robots.R.notices).toEqual([ignored('Odo', 'containsCots')])
        // 포드 질량으로 덮지 않으므로 두 포드 어셈블리가 각자 포드 질량을 받는다
        expect(model.objects.Pod1).toMatchObject({ source: 'cots', detail: 'pod:fourBar' })
        expect(model.objects.Pod2).toMatchObject({ source: 'cots', detail: 'pod:fourBar' })
        expect(model.objects.Odo.mass).toBeCloseTo(2 * 0.084, 12)
      }
    })

    it('xPod·yPod가 같은 오브젝트면 한 번만 알리고, 같은 포드는 한 번만 센다', () => {
      expect(run('C', 'C').robots.R.notices).toEqual([ignored('C', 'containsPinpoint')])
      const model = run('Pod', 'Pod')
      expect(model.objects.Pod.mass).toBeCloseTo(0.084, 15)
    })
  })
})

describe('질량 추정: 저울 무게', () => {
  // 고정 1 kg(덮어쓰기) + 추정 2.7 kg(알루미늄 1 L)
  const base = (weighedMass?: number): SceneObjects =>
    scene(
      robot(weighedMass === undefined ? {} : { rigidbody: { weighedMass } }),
      node('F', 'R', { mass: { mass: 1 } }),
      part('F1', 'F'),
      part('E', 'R', [0.1, 0, 0])
    )
  const props = { 'g:F1': solid(LITER), 'g:E': box(0.1, 0.1, 0.1) }

  it('추정 파트에만 비율을 곱하고(관성도), 고정 질량은 그대로다', () => {
    const plain = computeMassModel(base(), lookupOf(props)).robots.R
    const model = computeMassModel(base(4.5), lookupOf(props))
    const s = (4.5 - 1) / 2.7
    expect(model.robots.R.scale).toBeCloseTo(s, 14)
    expect(model.robots.R.mass).toBeCloseTo(4.5, 14)
    expect(model.robots.R.fixedMass).toBe(1)
    expect(model.robots.R.estimatedMass).toBeCloseTo(3.5, 14)
    expect(model.robots.R.warnings).toEqual([])
    expect(model.objects.E).toMatchObject({ scaled: true })
    expect(model.objects.E.mass).toBeCloseTo(2.7 * s, 14)
    expect(model.objects.F1).toMatchObject({ scaled: false, mass: 1 })
    expect(model.objects.R.scaled).toBe(true)
    expect(plain.scale).toBe(1)
    // 두 파트가 같은 자리에 있으면(F1 원점, E는 x 0.1) 관성은 질량에 비례해 늘어난 몫만큼 바뀐다
    expect(model.robots.R.inertia[2]).toBeGreaterThan(plain.inertia[2])
  })

  it('비율이 [0.6, 1.6] 밖이면 scaleUnusual, 고정 ≥ 저울이거나 추정이 0이면 scaleImpossible', () => {
    const big = computeMassModel(base(20), lookupOf(props)).robots.R
    expect(big.warnings).toEqual([
      { kind: 'scaleUnusual', scale: expect.closeTo((20 - 1) / 2.7, 12) }
    ])
    expect(big.mass).toBeCloseTo(20, 13)
    const small = computeMassModel(base(0.5), lookupOf(props)).robots.R
    expect(small.warnings).toEqual([{ kind: 'scaleImpossible', fixed: 1, weighed: 0.5 }])
    expect(small.scale).toBe(1)
    expect(small.mass).toBeCloseTo(3.7, 13)
    const fixedOnly = scene(
      robot({ rigidbody: { weighedMass: 3 } }),
      node('F', 'R', { mass: { mass: 1 } }),
      part('F1', 'F')
    )
    expect(computeMassModel(fixedOnly, lookupOf(props)).robots.R.warnings).toEqual([
      { kind: 'scaleImpossible', fixed: 1, weighed: 3 }
    ])
  })
})

describe('질량 추정: 합성(평행축 정리)', () => {
  // 단위 정육면체(변 1 m, 단위 밀도 관성 1/6), 질량 1 kg 덮어쓰기
  const unit = box(1, 1, 1)
  const cubeAt = (id: string, x: number, yaw = 0): SceneObject =>
    part(id, 'R', [x, 0, 0], {
      mass: { mass: 1 },
      transform: { position: [x, 0, 0], rotation: [0, 0, yaw] }
    })

  it('x = ±1의 단위 정육면체 둘: M 2, C 0, Ixx 2/6, Iyy = Izz = 2/6 + 2', () => {
    const objects = scene(robot(), cubeAt('A', 1), cubeAt('B', -1, Math.PI / 6))
    const r = computeMassModel(objects, lookupOf({ 'g:A': unit, 'g:B': unit })).robots.R
    expect(r.mass).toBe(2)
    for (const value of r.centerOfMass) expect(value).toBeCloseTo(0, 15)
    const expected: SymMatrix3 = [2 / 6, 2 / 6 + 2, 2 / 6 + 2, 0, 0, 0]
    r.inertia.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 13))
    expect(r.principalMoments[0]).toBeCloseTo(2 / 6, 13)
    expect(r.principalMoments[2]).toBeCloseTo(2 / 6 + 2, 13)
  })

  it('돌린 1×2×3 직육면체: 회전한 관성의 대각합은 같고 주관성 값은 {5, 10, 13}/12', () => {
    const objects = scene(
      robot(),
      part('P', 'R', [0, 0, 0], {
        mass: { mass: 1 },
        transform: { position: [0.3, -0.2, 0.5], rotation: [0.4, -0.7, 1.1] }
      })
    )
    const r = computeMassModel(objects, lookupOf({ 'g:P': box(1, 2, 3) })).robots.R
    const [xx, yy, zz, xy, xz, yz] = r.inertia
    expect(xx + yy + zz).toBeCloseTo((13 + 10 + 5) / 12, 13)
    expect(Math.abs(xy) + Math.abs(xz) + Math.abs(yz)).toBeGreaterThan(0.01)
    const expected = [5 / 12, 10 / 12, 13 / 12]
    r.principalMoments.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 12))
    expect(r.centerOfMass).toEqual([0.3, -0.2, 0.5].map((v) => expect.closeTo(v, 14)))
  })

  it('비대각 성분은 행렬 값 그대로다(Ixy = −Σ m x y)', () => {
    // 점질량 둘을 (1, 1)·(−1, −1)에: Ixy = −2. 형상이 없는 로봇은 기본값 상자를 더하므로 저울 무게를 점질량 합과 같게
    // 둬서 상자 없이 합친다(맞출 추정이 없어 scaleImpossible)
    const objects = scene(
      robot({ rigidbody: { weighedMass: 2 } }),
      node('A', 'R', { kind: 'group', mass: { mass: 1 } }, [1, 1, 0]),
      node('B', 'R', { kind: 'group', mass: { mass: 1 } }, [-1, -1, 0])
    )
    const r = computeMassModel(objects, lookupOf({})).robots.R
    expect(r.inertia).toEqual([2, 2, 4, -2, 0, 0].map((v) => expect.closeTo(v, 14)))
  })

  it('로봇 자세와 관계없이 로봇 좌표로 같고, 그룹으로 묶어도 같다(재귀 = 평탄)', () => {
    const flat = scene(robot(), cubeAt('A', 1), cubeAt('B', -0.5))
    const turned = {
      ...flat,
      R: robot({ transform: { position: [-1, 1, 0], rotation: [0, 0, -2] } })
    }
    const grouped = {
      ...scene(robot(), node('G', 'R', { kind: 'group' }, [0.2, 0, 0])),
      A: {
        ...flat.A,
        parentId: 'G',
        transform: { position: [0.8, 0, 0], rotation: [0, 0, 0] } as Transform
      },
      B: {
        ...flat.B,
        parentId: 'G',
        transform: { position: [-0.7, 0, 0], rotation: [0, 0, 0] } as Transform
      }
    }
    const lookup = lookupOf({ 'g:A': unit, 'g:B': unit })
    const a = computeMassModel(flat, lookup).robots.R
    const b = computeMassModel(turned, lookup).robots.R
    const c = computeMassModel(grouped, lookup).robots.R
    expect(b).toEqual(a)
    expect(c.mass).toBe(a.mass)
    c.inertia.forEach((value, i) => expect(value).toBeCloseTo(a.inertia[i], 13))
  })
})

describe('질량 추정: 정보 없음·읽는 중·결정성', () => {
  it('형상·질량 정보가 없는 로봇(임시 씬)은 13.6 kg 상자로 둔다', () => {
    const placeholder = useSceneStore.getInitialState().objects
    const model = computeMassModel(placeholder, lookupOf({}))
    const r = model.robots.robot
    expect(r.mass).toBe(DEFAULT_ROBOT_MASS)
    expect(r.warnings).toEqual([{ kind: 'defaultMass' }])
    expect(r.centerOfMass[0]).toBeCloseTo(0, 15)
    expect(r.centerOfMass[2]).toBeCloseTo(0.35 * ROBOT_SIZE, 15)
    const side = (DEFAULT_ROBOT_MASS * 2 * ROBOT_SIZE * ROBOT_SIZE) / 12
    expect(r.inertia).toEqual([side, side, side, 0, 0, 0].map((v) => expect.closeTo(v, 12)))
    expect(model.objects.robot).toMatchObject({ mass: DEFAULT_ROBOT_MASS, source: 'default' })
    expect(model.objects.webcam).toMatchObject({ mass: 0, source: 'none' })
    // 저울 무게가 있으면 그 질량(분포는 기본 상자)
    const weighed = {
      ...placeholder,
      robot: { ...placeholder.robot, rigidbody: { weighedMass: 15 } }
    }
    expect(computeMassModel(weighed, lookupOf({})).robots.robot).toMatchObject({
      mass: 15,
      warnings: [{ kind: 'defaultMass' }]
    })
  })

  it('형상을 읽는 중인 메시는 pending으로 세고 빼고 계산한다', () => {
    const objects = scene(robot(), part('P1', 'R'), part('P2', 'R'), part('P3', 'R'))
    const model = computeMassModel(objects, lookupOf({ 'g:P1': solid(LITER) }))
    expect(model.robots.R.mass).toBeCloseTo(2.7, 12)
    expect(model.robots.R.warnings).toEqual([{ kind: 'pending', meshes: 2 }])
  })

  it('오브젝트마다 질량에 들어가지 않은 읽는 중 메시를 센다(데이터시트·직접 입력 덩어리 안은 세지 않는다)', () => {
    const objects = scene(
      robot(),
      node('A', 'R'),
      part('P1', 'A'),
      part('P2', 'A'),
      part('Mot', 'A', [0, 0, 0], { components: [motor(19.2)] }),
      node('F', 'R', { mass: { mass: 1 } }),
      part('F1', 'F')
    )
    const model = computeMassModel(objects, lookupOf({ 'g:P1': solid(LITER) }))
    expect(model.objects.P1.pendingMeshes).toBe(0)
    expect(model.objects.P2.pendingMeshes).toBe(1)
    expect(model.objects.Mot).toMatchObject({ source: 'cots', pendingMeshes: 0 })
    expect(model.objects.A.pendingMeshes).toBe(1)
    expect(model.objects.F).toMatchObject({ source: 'override', mass: 1, pendingMeshes: 0 })
    expect(model.objects.R.pendingMeshes).toBe(1)
    // 로봇 경고는 읽는 중인 메시를 모두 센다
    expect(model.robots.R.warnings).toEqual([{ kind: 'pending', meshes: 3 }])
  })

  it('형상이 하나도 없으면(모두 읽는 중·읽지 못함·표면뿐) 저울 무게가 없어도 기본값(13.6 kg) 상자이고 경고를 함께 낸다', () => {
    const plain = scene(robot(), part('P1', 'R'), part('P2', 'R'))
    const model = computeMassModel(plain, lookupOf({}))
    const side = (DEFAULT_ROBOT_MASS * 2 * ROBOT_SIZE * ROBOT_SIZE) / 12
    expect(model.robots.R).toMatchObject({
      mass: DEFAULT_ROBOT_MASS,
      centerOfMass: [
        expect.closeTo(0, 15),
        expect.closeTo(0, 15),
        expect.closeTo(0.35 * ROBOT_SIZE, 15)
      ],
      inertia: [side, side, side, 0, 0, 0].map((v) => expect.closeTo(v, 12)),
      fixedMass: 0,
      estimatedMass: DEFAULT_ROBOT_MASS,
      scale: 1,
      warnings: [{ kind: 'defaultMass' }, { kind: 'pending', meshes: 2 }]
    })
    expect(model.objects.R).toMatchObject({ mass: DEFAULT_ROBOT_MASS, source: 'default' })
    // 읽은 형상이 모두 표면 메시(질량 0)여도 셈할 것이 없다
    const surfaces = {
      'g:P1': { ...solid(LITER), closure: 1 },
      'g:P2': { ...solid(LITER), closure: 1 }
    }
    expect(computeMassModel(plain, lookupOf(surfaces)).robots.R).toMatchObject({
      mass: DEFAULT_ROBOT_MASS,
      warnings: [{ kind: 'defaultMass' }]
    })
    // 하나라도 읽으면 형상으로 계산한다
    expect(computeMassModel(plain, lookupOf({ 'g:P1': solid(LITER) })).robots.R).toMatchObject({
      mass: expect.closeTo(2.7, 12),
      warnings: [{ kind: 'pending', meshes: 1 }]
    })
  })

  it('저울 무게가 있으면 모두 읽는 중이어도 그 무게를 기본 상자로 두고 읽는 중 경고를 함께 낸다', () => {
    const objects = scene(
      robot({ rigidbody: { weighedMass: 10 } }),
      part('P1', 'R'),
      part('P2', 'R')
    )
    const model = computeMassModel(objects, lookupOf({}))
    const r = model.robots.R
    expect(r).toMatchObject({
      mass: 10,
      fixedMass: 0,
      estimatedMass: 10,
      scale: 1,
      warnings: [{ kind: 'defaultMass' }, { kind: 'pending', meshes: 2 }]
    })
    // CAD가 없으면 18 in 상자(정보 없음 대체값과 같은 분포)
    expect(r.centerOfMass[0]).toBeCloseTo(0, 15)
    expect(r.centerOfMass[2]).toBeCloseTo(0.35 * ROBOT_SIZE, 15)
    const side = (10 * 2 * ROBOT_SIZE * ROBOT_SIZE) / 12
    expect(r.inertia).toEqual([side, side, side, 0, 0, 0].map((v) => expect.closeTo(v, 12)))
    expect(model.objects.R).toMatchObject({ mass: 10, source: 'default' })
    // 하나라도 읽으면 형상으로 나누고 맞춘다(기본값 경고 없음)
    const loaded = computeMassModel(objects, lookupOf({ 'g:P1': solid(LITER) })).robots.R
    expect(loaded.mass).toBeCloseTo(10, 12)
    expect(loaded.warnings).toEqual([
      { kind: 'scaleUnusual', scale: expect.closeTo(10 / 2.7, 12) },
      { kind: 'pending', meshes: 1 }
    ])
    // 읽는 중인 메시와 덮어쓴 그룹(형상 없음, 원점의 점질량)만 있으면 덮어쓰기는 제자리에 두고 나머지를 상자에 둔다
    const withOverride = {
      ...objects,
      G: { ...node('G', 'R', { kind: 'group', mass: { mass: 0.6 } }, [0.1, 0, 0]) }
    }
    const mixed = computeMassModel(withOverride, lookupOf({}))
    expect(mixed.robots.R).toMatchObject({
      mass: 10,
      fixedMass: 0.6,
      estimatedMass: expect.closeTo(9.4, 12),
      scale: 1,
      warnings: [{ kind: 'defaultMass' }, { kind: 'pending', meshes: 2 }]
    })
    const boxZ = 0.35 * ROBOT_SIZE
    const com = mixed.robots.R.centerOfMass
    expect(com[0]).toBeCloseTo((0.6 * 0.1) / 10, 12)
    expect(com[2]).toBeCloseTo((9.4 * boxZ) / 10, 12)
    // 관성: 상자(나머지 질량)와 점질량을 합친 무게중심 기준
    const sideRest = (9.4 * 2 * ROBOT_SIZE * ROBOT_SIZE) / 12
    const dBox: Vec3 = [0 - com[0], 0 - com[1], boxZ - com[2]]
    const dPoint: Vec3 = [0.1 - com[0], 0 - com[1], 0 - com[2]]
    const ixx =
      sideRest + 9.4 * (dBox[1] ** 2 + dBox[2] ** 2) + 0.6 * (dPoint[1] ** 2 + dPoint[2] ** 2)
    const izz =
      sideRest + 9.4 * (dBox[0] ** 2 + dBox[1] ** 2) + 0.6 * (dPoint[0] ** 2 + dPoint[1] ** 2)
    const ixz = -9.4 * dBox[0] * dBox[2] - 0.6 * dPoint[0] * dPoint[2]
    expect(mixed.robots.R.inertia[0]).toBeCloseTo(ixx, 12)
    expect(mixed.robots.R.inertia[2]).toBeCloseTo(izz, 12)
    expect(mixed.robots.R.inertia[4]).toBeCloseTo(ixz, 12)
    expect(mixed.objects.R).toMatchObject({ mass: 10, source: 'default' })
    expect(mixed.objects.G).toMatchObject({ mass: 0.6, source: 'override' })
    // 고정 질량이 저울 무게 이상이면 나머지가 없어 맞추지 않는다(읽는 중이어도)
    const heavy = {
      ...withOverride,
      R: robot({ rigidbody: { weighedMass: 0.5 } })
    }
    expect(computeMassModel(heavy, lookupOf({})).robots.R).toMatchObject({
      mass: 0.6,
      warnings: [
        { kind: 'scaleImpossible', fixed: 0.6, weighed: 0.5 },
        { kind: 'pending', meshes: 2 }
      ]
    })
  })

  it('하드웨어 컴포넌트(데이터시트 질량)가 붙은 파트를 읽는 중이어도 저울 무게를 쓴다', () => {
    // 모터의 COTS 질량은 형상과 관계없이 정해지므로, 형상을 모두 읽는 중이면 그것만 있는 로봇이 된다
    const objects = scene(
      robot({ rigidbody: { weighedMass: 15 } }),
      part('P1', 'R', [0.1, 0, 0.05], { components: [motor(19.2)] }),
      part('P2', 'R'),
      part('P3', 'R')
    )
    const loading = computeMassModel(objects, lookupOf({}))
    const fixed = loading.robots.R.fixedMass
    expect(fixed).toBeGreaterThan(0)
    expect(loading.robots.R).toMatchObject({
      mass: 15,
      estimatedMass: expect.closeTo(15 - fixed, 12),
      warnings: [{ kind: 'defaultMass' }, { kind: 'pending', meshes: 3 }]
    })
    expect(loading.robots.R.warnings.some((w) => w.kind === 'scaleImpossible')).toBe(false)
    // 다 읽으면 형상으로 나누고 맞춘다(기본값 경고 없음)
    const props = { 'g:P1': MOTOR_SIZE(), 'g:P2': solid(LITER), 'g:P3': solid(LITER) }
    const loaded = computeMassModel(objects, lookupOf(props)).robots.R
    expect(loaded.mass).toBeCloseTo(15, 12)
    expect(loaded.fixedMass).toBe(fixed)
    expect(loaded.warnings.map((w) => w.kind)).toEqual(['scaleUnusual'])
    // 저울 무게가 없으면 기본값(13.6 kg)에서 모터 질량을 제자리에 두고 나머지를 상자에 둔다(모터만 있는 로봇이 아니다)
    const unweighed = { ...objects, R: robot() }
    expect(computeMassModel(unweighed, lookupOf({})).robots.R).toMatchObject({
      mass: DEFAULT_ROBOT_MASS,
      fixedMass: fixed,
      estimatedMass: expect.closeTo(DEFAULT_ROBOT_MASS - fixed, 12),
      warnings: [{ kind: 'defaultMass' }, { kind: 'pending', meshes: 3 }]
    })
  })

  it('CAD가 없는 로봇(메시 형상 없음)도 고정 질량은 제자리에 두고 저울 무게(없으면 기본값)의 나머지를 상자에 둔다', () => {
    // 임시 씬처럼 형상이 없고(웹캠 자리 표시 오브젝트에 모터), 배터리 점질량(덮어쓴 그룹)이 있다
    const placeholder = (id: string, extra: Partial<SceneObject>): SceneObject => ({
      ...node(id, 'R', {}, [0.1, 0, 0.05]),
      kind: 'part',
      visual: { type: 'placeholder', shape: 'webcam' },
      ...extra
    })
    const objects = scene(
      robot({ rigidbody: { weighedMass: 15 } }),
      placeholder('Cam', { components: [motor(19.2)] }),
      node('Bat', 'R', { kind: 'group', mass: { mass: 0.6 } }, [-0.1, 0, 0.03])
    )
    const model = computeMassModel(objects, lookupOf({}))
    const fixed = model.robots.R.fixedMass
    expect(fixed).toBeGreaterThan(0.6)
    expect(model.robots.R).toMatchObject({
      mass: 15,
      estimatedMass: expect.closeTo(15 - fixed, 12),
      scale: 1,
      warnings: [{ kind: 'defaultMass' }]
    })
    expect(model.objects.R).toMatchObject({ mass: 15, source: 'default', pendingMeshes: 0 })
    expect(model.objects.Cam.source).toBe('cots')
    expect(model.objects.Bat).toMatchObject({ mass: 0.6, source: 'override' })
    // 무게중심은 상자 중심(높이 0.35배)과 고정 질량의 가중 평균
    const com = model.robots.R.centerOfMass
    const motorX = (fixed - 0.6) * 0.1
    expect(com[0]).toBeCloseTo((motorX - 0.6 * 0.1) / 15, 12)
    // 고정 질량이 저울 무게 이상이면 나머지가 없어 scaleImpossible(형상이 없어도)
    const heavy = { ...objects, R: robot({ rigidbody: { weighedMass: 0.5 } }) }
    expect(computeMassModel(heavy, lookupOf({})).robots.R).toMatchObject({
      mass: fixed,
      warnings: [{ kind: 'scaleImpossible', fixed, weighed: 0.5 }]
    })
    // 저울 무게가 없으면 기본값(13.6 kg)의 나머지를 상자에 둔다(데이터시트·직접 입력 몇 개는 로봇 전체가 아니다)
    const unweighed = { ...objects, R: robot() }
    const fallback = computeMassModel(unweighed, lookupOf({})).robots.R
    expect(fallback).toMatchObject({
      mass: expect.closeTo(DEFAULT_ROBOT_MASS, 12),
      fixedMass: expect.closeTo(fixed, 12),
      estimatedMass: expect.closeTo(DEFAULT_ROBOT_MASS - fixed, 12),
      warnings: [{ kind: 'defaultMass' }]
    })
    expect(fallback.centerOfMass[2]).toBeGreaterThan(0.1)
  })

  it('같은 입력이면 같은 결과이고, 결과 키는 objects 키 순서다', () => {
    const objects = scene(
      robot(),
      node('A', 'R', { mass: { material: 'steel' } }),
      part('P2', 'A', [0.1, 0.2, 0.3]),
      part('P1', 'R', [-0.1, 0, 0.05])
    )
    const lookup = lookupOf({ 'g:P1': box(0.1, 0.2, 0.05), 'g:P2': box(0.02, 0.02, 0.3) })
    const a = computeMassModel(objects, lookup)
    expect(computeMassModel(objects, lookup)).toEqual(a)
    expect(Object.keys(a.objects)).toEqual(['R', 'A', 'P2', 'P1'])
  })

  it('로봇 밖 오브젝트는 필드 좌표로 계산하고 로봇 합계에 넣지 않는다', () => {
    const objects = scene(robot(), part('P', 'R'), part('F', 'G', [0, 0, 0]), {
      ...node('G', 'R'),
      parentId: null,
      kind: 'group',
      transform: { position: [1, 2, 0], rotation: [0, 0, 0] }
    })
    const model = computeMassModel(objects, lookupOf({ 'g:P': solid(LITER), 'g:F': solid(LITER) }))
    expect(model.objects.F.centerOfMass).toEqual([1, 2, 0])
    expect(model.objects.F.inheritedFrom).toBeNull()
    expect(model.robots.R.mass).toBeCloseTo(2.7, 12)
    expect(Object.keys(model.robots)).toEqual(['R'])
  })
})
