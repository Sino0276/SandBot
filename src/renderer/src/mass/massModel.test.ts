import { describe, expect, it } from 'vitest'
import { ROBOT_SIZE } from '../scene/coordinates'
import type { HardwareComponent, SceneObject, SceneObjects, Transform, Vec3 } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { defaultWheel } from '../scene/wheel'
import { computeMassModel } from './massModel'
import { PRINTED_SHELL_THICKNESS } from './materials'
import { DEFAULT_ROBOT_MASS, type MassLookup, type MeshMassProps, type SymMatrix3 } from './types'

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

function lookupOf(
  props: Record<string, MeshMassProps>,
  names: Record<string, string> = {}
): MassLookup {
  return { props: (id) => props[id], sourceName: (id) => names[id] }
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
  it('원래 CAD 메시 이름, 지금 이름, 상위 이름(CAD 루트까지) 순으로 본다', () => {
    const cadRoot = node('C', 'R', {
      name: 'Screw Kit',
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
      // 사용자가 이름을 바꿨어도 원래 메시 이름(Washer)으로 맞춘다
      part('P1', 'B', [0, 0, 0], { name: 'Renamed' }),
      // 메시 이름이 비면 지금 이름 → 부모(베어링 SKU 시리즈)
      part('P2', 'B', [0, 0, 0], { name: '1611-0514-0006 2' }),
      part('P3', 'B', [0, 0, 0], { name: 'IR' }),
      // CAD 루트 이름까지 본다(로봇 이름은 보지 않는다)
      part('P4', 'C', [0, 0, 0], { name: 'Thing' }),
      // 그룹 이름(팀이 지은 메커니즘 이름)은 보지 않는다: CAD 밖으로 옮긴 파트는 기본 재질이고,
      node('G', 'R', { kind: 'group', name: 'IntakeRoller' }),
      part('P5', 'G', [0, 0, 0], { name: 'Part 12', cadOrigin: 'C' }),
      // CAD 안의 그룹은 건너뛰고 그 위 CAD 이름을 본다
      node('H', 'C', { kind: 'group', name: 'Belt Tensioner' }),
      part('P6', 'H', [0, 0, 0], { name: 'Thing' })
    )
    const props = Object.fromEntries(
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((id) => [`g:${id}`, solid(LITER)])
    )
    const model = computeMassModel(
      objects,
      lookupOf(props, { 'g:P1': 'Washer', 'g:P2': '', 'g:P3': 'IR' })
    )
    expect(model.objects.P1).toMatchObject({
      source: 'nameRule',
      detail: 'washer',
      inheritedFrom: null
    })
    expect(model.objects.P1.mass).toBeCloseTo(7.85, 12)
    expect(model.objects.P2).toMatchObject({
      source: 'nameRule',
      detail: 'gobilda-1611',
      inheritedFrom: null
    })
    expect(model.objects.P3).toMatchObject({
      source: 'nameRule',
      detail: 'gobilda-1611',
      inheritedFrom: 'B'
    })
    expect(model.objects.P4).toMatchObject({
      source: 'nameRule',
      detail: 'screw',
      inheritedFrom: 'C'
    })
    expect(model.objects.P5).toMatchObject({ source: 'default', detail: 'aluminum6061' })
    expect(model.objects.P5.mass).toBeCloseTo(2.7, 12)
    expect(model.objects.P6).toMatchObject({
      source: 'nameRule',
      detail: 'screw',
      inheritedFrom: 'C'
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
    const props = Object.fromEntries(['P1', 'P2', 'P3', 'Q'].map((id) => [`g:${id}`, solid(LITER)]))
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
    const props = Object.fromEntries(['A1', 'M', 'N'].map((id) => [`g:${id}`, solid(LITER)]))
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

  it('컴포넌트 COTS는 붙은 오브젝트 하위 전체를 덮고, 안쪽 COTS는 쓰지 않는다', () => {
    const objects = scene(
      robot(),
      node('M', 'R', { components: [motor(19.2)] }),
      part('M1', 'M'),
      part('M2', 'M'),
      // 모터 안의 서보 컴포넌트(이중 계산을 막아 위의 것을 쓴다)
      part('M3', 'M', [0, 0, 0], { components: [{ ...motor(1), type: 'servo', props: {} }] })
    )
    const props = Object.fromEntries(['M1', 'M2', 'M3'].map((id) => [`g:${id}`, solid(LITER)]))
    const model = computeMassModel(objects, lookupOf(props))
    expect(model.objects.M).toMatchObject({ source: 'cots', detail: 'motor:goBilda5203:19.2' })
    expect(model.objects.M.mass).toBeCloseTo(0.437, 15)
    expect(model.objects.M3).toMatchObject({ source: 'cots', inheritedFrom: 'M' })
    expect(model.objects.M3.mass).toBeCloseTo(0.437 / 3, 15)
  })

  it('덮어쓰기는 COTS보다 먼저이고, 한 오브젝트의 컴포넌트·바퀴 COTS는 더한다', () => {
    const objects = scene(
      robot(),
      node('M', 'R', { components: [motor(19.2)], mass: { mass: 0.5 } }),
      part('M1', 'M'),
      node('W', 'R', { components: [motor(19.2)], wheel: defaultWheel() }),
      part('W1', 'W')
    )
    const props = { 'g:M1': solid(LITER), 'g:W1': solid(LITER) }
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
      ...Object.fromEntries(['B1', 'L', 'Pin'].map((id) => [`g:${id}`, solid(LITER)])),
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
      kind: 'podIgnored',
      objectId,
      pinpointId: 'Pin',
      reason
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
      // 0.3 × 0.05 × 0.01 m = 150 cm³ → 405 g > 4 × 84 g
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
      // 형상이 커서 tooLarge다(CAD 루트를 따로 거르지 않는다)
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
        ignored('G', 'tooLarge')
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
        Sub: node('Sub', 'Arm', { name: 'REV-31-1302 Slim Battery' })
      }
      expect(computeMassModel(assembly, lookupOf(small)).robots.R.notices).toEqual([
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
    // 점질량 둘을 (1, 1)·(−1, −1)에: Ixy = −2
    const objects = scene(
      robot(),
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

  it('모든 메시를 읽는 중이면 기본값(13.6 kg)이 아니라 읽은 만큼(0 kg)이다', () => {
    const objects = scene(
      robot({ rigidbody: { weighedMass: 10 } }),
      part('P1', 'R'),
      part('P2', 'R')
    )
    const r = computeMassModel(objects, lookupOf({})).robots.R
    expect(r).toMatchObject({
      mass: 0,
      centerOfMass: [0, 0, 0],
      inertia: [0, 0, 0, 0, 0, 0],
      fixedMass: 0,
      estimatedMass: 0,
      scale: 1,
      warnings: [{ kind: 'pending', meshes: 2 }]
    })
    // 읽는 중인 메시와 덮어쓴 그룹만 있으면 그 덮어쓰기만 센다
    const withOverride = {
      ...objects,
      G: { ...node('G', 'R', { kind: 'group', mass: { mass: 0.6 } }) }
    }
    expect(computeMassModel(withOverride, lookupOf({})).robots.R).toMatchObject({
      mass: 0.6,
      warnings: [
        { kind: 'scaleImpossible', fixed: 0.6, weighed: 10 },
        { kind: 'pending', meshes: 2 }
      ]
    })
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
