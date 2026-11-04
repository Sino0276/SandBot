import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { BoxGeometry } from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAVITY } from '../../../../shared/sim/physics'
import {
  DEFAULT_WHEEL_MASS,
  ROLLER_COULOMB,
  WHEEL_SPIN_INERTIA_FACTOR
} from '../../../../shared/sim/wheelData'
import { distributeWheelLoads } from '../../../../shared/sim/wheelLoads'
import { createComponent } from '../../hardware/components'
import en from '../../i18n/locales/en'
import ko from '../../i18n/locales/ko'
import { computeMassModel } from '../../mass/massModel'
import type { MassModel, ObjectMass, RobotMass } from '../../mass/types'
import { wheelTopSpeed } from '../../play/worldSpec'
import { disposeGeometry, registerGeometry } from '../../scene/geometryRegistry'
import type { SceneObject, SceneObjects, Transform, WheelSettings } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { defaultWheel, sanitizeWheel } from '../../scene/wheel'
import { useUnitStore } from '../../units/unitStore'
import { formatNumber } from '../../units/units'
import { clearHistory, initHistory, undo } from '../history'
import { REGISTRY_MASS_LOOKUP } from '../mass/useMassModel'
import HardwareComponentsSection from './HardwareComponentsSection'
import RobotHardwareSection from './RobotHardwareSection'
import {
  canAddWheel,
  drivetrainSummary,
  formatWheelFriction,
  newWheel,
  parseWheelFriction,
  robotStaticLoads,
  suggestWheelDiameter,
  wheelCardView,
  wheelKindPatch,
  wheelMass,
  wheelMotorOptions,
  wheelPhysicsView
} from './wheelCardModel'
import WheelCard from './WheelCard'

// 단위 스토어는 불러올 때 localStorage를 읽는다(Node 테스트에는 없다)
vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다(UsageSection.test.tsx와 같은 방법)
type TestStore<T> = { getInitialState: () => T; setState: (patch: Partial<T>) => void }
const restores: (() => void)[] = []
function setStore<T extends object>(store: TestStore<T>, patch: Partial<T>): void {
  const initial = store.getInitialState()
  const saved = { ...initial }
  restores.push(() => Object.assign(initial, saved))
  Object.assign(initial, patch)
  store.setState(patch)
}
afterEach(() => {
  while (restores.length > 0) restores.pop()!()
})

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

const DEG = Math.PI / 180

const at = (x: number, y: number, z = 0): Transform => ({
  position: [x, y, z],
  rotation: [0, 0, 0]
})

const driveMotor = { ...createComponent('motor', [], () => 'fl'), name: 'leftFront' }
const otherMotor = { ...createComponent('motor', [], () => 'other'), name: 'otherBot' }

function scene(): SceneObjects {
  return {
    R: {
      id: 'R',
      name: 'Robot',
      kind: 'robot',
      parentId: null,
      transform: at(0, 0)
    },
    cad: {
      id: 'cad',
      name: 'robot.step',
      kind: 'assembly',
      parentId: 'R',
      transform: at(0, 0),
      cad: {
        fileName: 'robot.step',
        absolutePath: '/robot.step',
        upAxis: '+Z',
        forwardAxis: '+X',
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        meshCount: 2,
        meshIndexing: 'source'
      }
    },
    flGroup: {
      id: 'flGroup',
      name: 'FL Wheel',
      kind: 'group',
      parentId: 'R',
      transform: at(0.15, 0.15)
    },
    flMotor: {
      id: 'flMotor',
      name: 'FL motor',
      kind: 'part',
      parentId: 'flGroup',
      transform: at(0, 0.03),
      components: [driveMotor]
    },
    flTire: {
      id: 'flTire',
      name: 'FL tire',
      kind: 'part',
      parentId: 'flGroup',
      transform: at(0, 0),
      visual: { type: 'mesh', geometryId: 'cad:0', color: [1, 1, 1] }
    },
    R2: {
      id: 'R2',
      name: 'Other',
      kind: 'robot',
      parentId: null,
      transform: at(1, 1)
    },
    otherPart: {
      id: 'otherPart',
      name: 'other',
      kind: 'part',
      parentId: 'R2',
      transform: at(0, 0),
      components: [otherMotor]
    }
  }
}

const withWheel = (objects: SceneObjects, id: string, patch = {}): SceneObjects => ({
  ...objects,
  [id]: { ...objects[id], wheel: { ...defaultWheel(), ...patch } }
})

describe('바퀴 카드 보기 계산', () => {
  it('Add Component의 바퀴: 로봇·CAD 루트·이미 있는 오브젝트는 비활성', () => {
    const objects = withWheel(scene(), 'flTire')
    expect(canAddWheel(objects.R)).toBe(false)
    expect(canAddWheel(objects.cad)).toBe(false)
    expect(canAddWheel(objects.flTire)).toBe(false)
    expect(canAddWheel(objects.flGroup)).toBe(true)
    expect(canAddWheel(objects.flMotor)).toBe(true)
  })

  it('새 바퀴는 같은 오브젝트·하위의 모터가 하나면 그것을 구동 모터로 제안한다', () => {
    const objects = scene()
    expect(newWheel(objects, 'flGroup')).toEqual({ ...defaultWheel(), motor: 'fl' })
    expect(newWheel(objects, 'flMotor').motor).toBe('fl')
    expect(newWheel(objects, 'flTire').motor).toBe('')
    const two: SceneObjects = {
      ...objects,
      flTire: { ...objects.flTire, components: [{ ...driveMotor, id: 'fl2', name: 'x' }] }
    }
    expect(newWheel(two, 'flGroup').motor).toBe('')
  })

  it('종류를 바꾸면 기본 지름은 그 종류의 기본값으로, 고친 지름은 그대로', () => {
    expect(wheelKindPatch(defaultWheel('mecanum'), 'traction')).toEqual({
      kind: 'traction',
      diameter: 0.096
    })
    expect(wheelKindPatch({ ...defaultWheel(), diameter: 0.075 }, 'omni')).toEqual({ kind: 'omni' })
  })

  it('구동 모터 목록은 같은 로봇의 모터만, 지운·다른 로봇의 모터는 missing', () => {
    const objects = scene()
    expect(wheelMotorOptions(objects, 'flTire')).toEqual([
      { id: 'fl', name: 'leftFront', objectName: 'FL motor' }
    ])
    expect(wheelCardView(withWheel(objects, 'flTire', { motor: 'fl' }), 'flTire')).toMatchObject({
      inRobot: true,
      motorState: 'ok',
      rollers: 'flbr'
    })
    expect(wheelCardView(withWheel(objects, 'flTire', { motor: 'other' }), 'flTire')).toMatchObject(
      {
        motorState: 'missing',
        motor: null
      }
    )
    expect(
      wheelCardView(withWheel(objects, 'flTire', { motor: 'gone' }), 'flTire').motorState
    ).toBe('missing')
    // 로봇 밖
    const orphan: SceneObjects = {
      ...objects,
      loose: { ...objects.flTire, id: 'loose', parentId: null, wheel: defaultWheel() }
    }
    expect(wheelCardView(orphan, 'loose')).toMatchObject({ inRobot: false, motorState: 'none' })
  })

  it('[파트 크기로]: 로봇 축으로 잰 경계 상자의 높이, 형상이 없으면 null', () => {
    const objects = scene()
    expect(suggestWheelDiameter(objects, 'flTire')).toBeNull()
    // 바퀴(지름 0.1 m, 폭 0.03 m)를 Y축 둘레로 둔 CAD 메시
    registerGeometry('cad:0', new BoxGeometry(0.1, 0.03, 0.1))
    try {
      // 형상 좌표는 float32
      expect(suggestWheelDiameter(objects, 'flTire')).toBeCloseTo(0.1, 6)
      // 그룹은 하위 형상 전체(모터 파트는 형상이 없다)
      expect(suggestWheelDiameter(objects, 'flGroup')).toBeCloseTo(0.1, 6)
      expect(suggestWheelDiameter(objects, 'flMotor')).toBeNull()
    } finally {
      disposeGeometry('cad:0')
    }
  })

  it('[파트 크기로]: X 드라이브처럼 45°로 둔 바퀴, Y-up CAD, 축 방향 샤프트에도 지름', () => {
    const objects: SceneObjects = {
      ...scene(),
      // 로봇이 필드에서 돌아가 있어도 로봇 축으로 잰다
      R: { ...scene().R, transform: { position: [0, 0, 0], rotation: [0, 0, 30 * DEG] } },
      // Y-up CAD의 파트: 메시 축은 Y가 위이고, 로봇 축으로는 X축 둘레로 90° 돌아가 있다
      yUp: {
        id: 'yUp',
        name: 'yup.step',
        kind: 'part',
        parentId: 'R',
        transform: { position: [-0.15, 0.15, 0.048], rotation: [90 * DEG, 0, 0] },
        visual: { type: 'mesh', geometryId: 'yup:0', color: [1, 1, 1] }
      },
      shaft: {
        id: 'shaft',
        name: 'shaft',
        kind: 'part',
        parentId: 'flGroup',
        transform: at(0, 0),
        visual: { type: 'mesh', geometryId: 'shaft:0', color: [1, 1, 1] }
      }
    }
    // 96 mm 옴니(폭 25 mm)를 CAD에서 45° 돌려 둔 메시(CAD 노드는 회전 없이 위치만 가진다).
    // CAD 파일 축으로 잰 상자는 0.0856 × 0.0856 × 0.096이라 둘째로 긴 변은 지름보다 11% 짧다.
    registerGeometry('cad:0', new BoxGeometry(0.096, 0.025, 0.096).rotateZ(Math.PI / 4))
    registerGeometry('yup:0', new BoxGeometry(0.096, 0.096, 0.025).rotateY(Math.PI / 4))
    // 바퀴 축(Y) 방향으로 긴 샤프트
    registerGeometry('shaft:0', new BoxGeometry(0.01, 0.2, 0.01))
    try {
      expect(suggestWheelDiameter(objects, 'flTire')).toBeCloseTo(0.096, 6)
      expect(suggestWheelDiameter(objects, 'yUp')).toBeCloseTo(0.096, 6)
      expect(suggestWheelDiameter(objects, 'flGroup')).toBeCloseTo(0.096, 6)
    } finally {
      disposeGeometry('cad:0')
      disposeGeometry('yup:0')
      disposeGeometry('shaft:0')
    }
  })

  it('로봇 카드 요약: 바퀴 수·종류와 실행 때의 경고', () => {
    let objects = withWheel(scene(), 'flGroup', { motor: 'fl' })
    objects = withWheel(objects, 'flMotor', { kind: 'omni', motor: '' })
    const summary = drivetrainSummary(objects, 'R', { batteryVoltage: 12 })
    expect(summary.count).toBe(2)
    expect(summary.kinds).toEqual([
      { kind: 'mecanum', count: 1 },
      { kind: 'omni', count: 1 }
    ])
    // 하이어라키 순서: 메카넘 하나는 중심 위에 있어 롤러가 모호하고, 그 아래 옴니는 구동 모터가 없다. 바퀴가 둘뿐이라
    // 하중을 나눌 수 없다(3c)
    expect(summary.warnings.map((warning) => warning.key)).toEqual([
      'worldRollersAmbiguous',
      'worldWheelNoMotor',
      'worldFewWheels'
    ])
    expect(drivetrainSummary(scene(), 'R', { batteryVoltage: 12 })).toMatchObject({
      count: 0,
      kinds: []
    })
  })
})

// 네 귀퉁이(±0.15 m)에 메카넘 바퀴 파트를 둔 로봇. 바퀴는 모두 모터 하나(fl)로 굴린다(요약 계산만 본다).
function fourWheels(patch: Partial<WheelSettings> = {}): SceneObjects {
  const objects: SceneObjects = {
    R: scene().R,
    mount: { ...scene().flMotor, id: 'mount', parentId: 'R', transform: at(0, 0) }
  }
  const corners: [string, number, number][] = [
    ['wfl', 0.15, 0.15],
    ['wfr', 0.15, -0.15],
    ['wbl', -0.15, 0.15],
    ['wbr', -0.15, -0.15]
  ]
  for (const [id, x, y] of corners)
    objects[id] = {
      id,
      name: id,
      kind: 'part',
      parentId: 'R',
      transform: at(x, y),
      visual: { type: 'mesh', geometryId: `${id}:0`, color: [1, 1, 1] },
      wheel: { ...defaultWheel(), motor: 'fl', ...patch }
    }
  return objects
}

const objectMass = (mass: number): ObjectMass => ({
  mass,
  centerOfMass: [0, 0, 0],
  source: 'material',
  detail: '',
  inheritedFrom: null,
  scaled: false,
  pendingMeshes: 0
})

const robotMass = (mass: number, x: number, y = 0): RobotMass => ({
  robotId: 'R',
  mass,
  centerOfMass: [x, y, 0.1],
  inertia: [0.3, 0.4, 0.5, 0, 0, 0],
  principalMoments: [0.3, 0.4, 0.5],
  fixedMass: 0,
  estimatedMass: mass,
  scale: 1,
  warnings: []
})

const massModel = (
  robot: RobotMass | null,
  objects: Record<string, ObjectMass> = {}
): MassModel => ({ objects, robots: robot ? { R: robot } : {} })

describe('바퀴 카드 마찰·질량·하중 계산', () => {
  it('마찰 칸: 0은 종류 기본, 범위 안의 수만 받고 틀린 글자는 null', () => {
    expect(parseWheelFriction('0.75')).toBe(0.75)
    expect(parseWheelFriction(' 1.2 ')).toBe(1.2)
    expect(parseWheelFriction('.5')).toBe(0.5)
    expect(parseWheelFriction('3')).toBe(3)
    expect(parseWheelFriction('0.05')).toBe(0.05)
    expect(parseWheelFriction('0')).toBe(0)
    for (const text of ['0.04', '3.01', '-0.5', 'abc', '1e1', '0.6 μ', ''])
      expect(parseWheelFriction(text)).toBeNull()
    expect(formatWheelFriction(0.6)).toBe('0.60')
  })

  it('바퀴 질량: 질량 모델의 하위 질량을 0.01–2 kg로 자르고, 없거나 0이면 종류 기본', () => {
    expect(wheelMass({ kind: 'mecanum' }, 0.3)).toEqual({
      mass: 0.3,
      fromModel: true,
      clipped: false
    })
    expect(wheelMass({ kind: 'mecanum' }, 5)).toEqual({ mass: 2, fromModel: true, clipped: true })
    expect(wheelMass({ kind: 'mecanum' }, 0.001)).toEqual({
      mass: 0.01,
      fromModel: true,
      clipped: true
    })
    // 범위 끝은 자른 것이 아니다
    expect(wheelMass({ kind: 'mecanum' }, 2).clipped).toBe(false)
    expect(wheelMass({ kind: 'omni' }, 0)).toEqual({
      mass: DEFAULT_WHEEL_MASS.omni,
      fromModel: false,
      clipped: false
    })
    expect(wheelMass({ kind: 'traction' }, undefined).mass).toBe(DEFAULT_WHEEL_MASS.traction)
    expect(wheelMass({ kind: 'traction' }, NaN).fromModel).toBe(false)
  })

  it('정지 하중: 무게중심이 앞이면 앞바퀴가 더 받고(평면 처짐 해), 합은 무게', () => {
    const objects = fourWheels()
    // 10 kg, 무게중심 x = 0.05 m: 최소 노름 해는 N = mg/4 + mg·x·xᵢ/Σx² → 앞 mg/3, 뒤 mg/6
    const loads = robotStaticLoads(objects, 'R', massModel(robotMass(10, 0.05)))!
    const weight = 10 * GRAVITY
    expect(loads.weight).toBeCloseTo(weight, 12)
    expect(loads.unsupported).toBe(0)
    const byId = Object.fromEntries(loads.wheels.map((w) => [w.objectId, w.load]))
    expect(byId.wfl).toBeCloseTo(weight / 3, 9)
    expect(byId.wfr).toBeCloseTo(weight / 3, 9)
    expect(byId.wbl).toBeCloseTo(weight / 6, 9)
    expect(byId.wbr).toBeCloseTo(weight / 6, 9)
    // 시뮬레이터와 같은 분배 함수(로봇 원점 둘레 M_x = F_z·y, M_y = −F_z·x)
    const points = [
      { x: 0.15, y: 0.15 },
      { x: 0.15, y: -0.15 },
      { x: -0.15, y: 0.15 },
      { x: -0.15, y: -0.15 }
    ]
    expect(loads.wheels.map((w) => w.load)).toEqual(
      distributeWheelLoads(points, weight, 0, -weight * 0.05).loads
    )
    // 무게중심이 왼쪽이면 왼쪽 바퀴가 더 받는다
    const left = robotStaticLoads(objects, 'R', massModel(robotMass(10, 0, 0.05)))!
    expect(left.wheels[0].load).toBeGreaterThan(left.wheels[1].load)
    // 무게중심이 바퀴 밖이면 받쳐지지 않은 모멘트(시뮬레이터의 tipping과 같은 판단)
    expect(robotStaticLoads(objects, 'R', massModel(robotMass(10, 0.25)))!.unsupported).toBeCloseTo(
      weight * 0.1,
      9
    )
    // 로봇 질량을 모르면 null
    expect(robotStaticLoads(objects, 'R', null)).toBeNull()
    expect(robotStaticLoads(objects, 'R', massModel(null))).toBeNull()
    expect(robotStaticLoads(objects, 'R', massModel(robotMass(0, 0)))).toBeNull()
  })

  it('바퀴 하나: 쓰는 μ(설정 또는 종류 기본), 회전 관성 0.53·m·R², 견인 한계 μ·N', () => {
    const objects = fourWheels()
    const model = massModel(robotMass(10, 0.05), { wfl: objectMass(0.3) })
    // 104 mm 메카넘은 표의 제품(goBILDA GripForce)이라 세계 설명처럼 데이터시트 질량 236 g이 도는 질량이다
    // (play/worldSpec.ts wheelSpinMass)
    const fl = wheelPhysicsView(objects, 'wfl', model)!
    expect(fl).toMatchObject({
      friction: 0.6,
      defaultFriction: 0.6,
      massFromModel: true,
      clippedFrom: null
    })
    expect(fl.mass).toBeCloseTo(0.236, 12)
    expect(fl.spinInertia).toBeCloseTo(WHEEL_SPIN_INERTIA_FACTOR * 0.236 * 0.052 ** 2, 15)
    // 표에 없는 지름이면 질량 모델의 하위 질량
    const plain = withWheel(objects, 'wfl', { diameter: 0.09 })
    expect(wheelPhysicsView(plain, 'wfl', model)!.mass).toBeCloseTo(0.3, 12)
    expect(fl.load).toBeCloseTo((10 * GRAVITY) / 3, 9)
    expect(fl.tractionLimit).toBeCloseTo((0.6 * 10 * GRAVITY) / 3, 9)
    // 마찰을 정하면 그 값, 질량 모델에 바퀴가 없으면 기본 질량
    const set = withWheel(objects, 'wbr', { motor: 'fl', friction: 1.1 })
    const br = wheelPhysicsView(set, 'wbr', model)!
    expect(br).toMatchObject({
      friction: 1.1,
      defaultFriction: 0.6,
      massFromModel: false,
      clippedFrom: null
    })
    // 질량 모델의 바퀴 질량이 범위 밖이면 자르기 전 값을 함께 준다
    const heavy = withWheel(objects, 'wfl', { diameter: 0.09 })
    const clipped = wheelPhysicsView(
      heavy,
      'wfl',
      massModel(robotMass(10, 0.05), { wfl: objectMass(5) })
    )!
    expect(clipped).toMatchObject({ mass: 2, massFromModel: true, clippedFrom: 5 })
    expect(br.mass).toBe(DEFAULT_WHEEL_MASS.mecanum)
    expect(br.tractionLimit).toBeCloseTo(1.1 * br.load!, 12)
    // 로봇 질량을 모르면 하중·견인 한계 없음, 바퀴가 없으면 null
    expect(wheelPhysicsView(objects, 'wfl', null)).toMatchObject({
      load: null,
      tractionLimit: null
    })
    expect(wheelPhysicsView(objects, 'mount', model)).toBeNull()
  })

  it('로봇 요약: 앞 방향 견인 한계 가속은 구동하는 바퀴의 Σ N·(앞 방향 견인) ÷ 질량, 최고 속도는 wheelTopSpeed', () => {
    const model = massModel(robotMass(10, 0.05))
    const settings = { batteryVoltage: 12 }
    // 모두 같은 μ면 무게중심과 관계없이 μ·g
    const objects = fourWheels()
    const all = drivetrainSummary(objects, 'R', settings, model)
    expect(all.tractionAcceleration).toBeCloseTo(0.6 * GRAVITY, 12)
    const speed = wheelTopSpeed(objects.wfl.wheel!, objects.mount.components![0].props, 12)
    expect(all.topSpeed).toEqual({ min: speed, max: speed })
    // 앞은 일반 바퀴(μ 0.9, 팔각형이라 굴림 방향은 0.924·μ)로 구동, 뒤는 구동하지 않는 옴니: 앞 하중(2/3)만 견인한다
    let mixed = fourWheels()
    for (const id of ['wfl', 'wfr'])
      mixed = withWheel(mixed, id, { kind: 'traction', diameter: 0.096, motor: 'fl' })
    for (const id of ['wbl', 'wbr']) mixed = withWheel(mixed, id, { kind: 'omni', motor: '' })
    expect(drivetrainSummary(mixed, 'R', settings, model).tractionAcceleration).toBeCloseTo(
      0.9 * Math.cos(Math.PI / 8) * GRAVITY * (2 / 3),
      9
    )
    // X 드라이브(옴니 넷, 굴림 ±45°): μ·g가 아니라 (μ − 롤러 쿨롱)·cos 45°·g(시뮬레이터 약 0.64·μ·g)
    let xDrive = fourWheels({ kind: 'omni', diameter: 0.096 })
    for (const [id, angle] of [
      ['wfl', -45],
      ['wfr', 45],
      ['wbl', 45],
      ['wbr', -45]
    ] as const)
      xDrive = withWheel(xDrive, id, {
        kind: 'omni',
        diameter: 0.096,
        motor: 'fl',
        angle: angle * DEG
      })
    expect(drivetrainSummary(xDrive, 'R', settings, model).tractionAcceleration).toBeCloseTo(
      (0.8 - ROLLER_COULOMB) * Math.SQRT1_2 * GRAVITY,
      9
    )
    // H 드라이브: 옴니 넷(굴림 0°)과 가운데 옆걸음 옴니(90°). 옆걸음 바퀴는 하중을 가져가지만 앞으로는 밀지 못한다(0)
    const hDrive: SceneObjects = {
      ...fourWheels({ kind: 'omni', diameter: 0.096 }),
      strafe: {
        id: 'strafe',
        name: 'strafe',
        kind: 'part',
        parentId: 'R',
        transform: at(0, 0),
        visual: { type: 'mesh', geometryId: 'strafe:0', color: [1, 1, 1] },
        wheel: { ...defaultWheel('omni'), motor: 'fl', angle: 90 * DEG }
      }
    }
    const loads = robotStaticLoads(hDrive, 'R', model)!
    const strafeLoad = loads.wheels.find((w) => w.objectId === 'strafe')!.load
    expect(strafeLoad).toBeGreaterThan(0)
    const corners = loads.weight - strafeLoad
    expect(drivetrainSummary(hDrive, 'R', settings, model).tractionAcceleration).toBeCloseTo(
      (GRAVITY * 0.8 * corners) / loads.weight,
      9
    )
    // 옆걸음 바퀴를 구동하든 안 하든 앞 견인은 같다
    const undriven = withWheel(hDrive, 'strafe', { kind: 'omni', diameter: 0.096, angle: 90 * DEG })
    expect(drivetrainSummary(undriven, 'R', settings, model).tractionAcceleration).toBeCloseTo(
      drivetrainSummary(hDrive, 'R', settings, model).tractionAcceleration!,
      12
    )
    // 외부 감속비가 다른 바퀴가 있으면 최고 속도는 범위다
    const geared = withWheel(objects, 'wbr', { motor: 'fl', gearRatio: 2 })
    const range = drivetrainSummary(geared, 'R', settings, model).topSpeed!
    expect(range.min).toBeCloseTo(range.max / 2, 12)
    // 질량을 모르거나 구동하는 바퀴가 없으면 견인 한계 가속 없음
    expect(drivetrainSummary(objects, 'R', settings).tractionAcceleration).toBeNull()
    expect(drivetrainSummary(fourWheels({ motor: '' }), 'R', settings, model)).toMatchObject({
      tractionAcceleration: null,
      topSpeed: null
    })
  })
})

describe('바퀴 마찰 설정(스토어)', () => {
  beforeEach(() => {
    initHistory()
    useSceneStore.getState().replaceObjects(fourWheels())
    clearHistory()
  })
  const friction = (): number => useSceneStore.getState().objects.wfl.wheel!.friction

  it('setWheel은 sanitizeWheel을 거쳐 범위 밖 마찰을 기본(0)으로 두고, 바꾸기는 실행 취소 한 단계다', () => {
    const wheel = useSceneStore.getState().objects.wfl.wheel!
    useSceneStore.getState().setWheel('wfl', { ...wheel, friction: 0.75 })
    expect(friction()).toBe(0.75)
    useSceneStore.getState().setWheel('wfl', { ...wheel, friction: 5 })
    expect(friction()).toBe(0)
    useSceneStore.getState().setWheel('wfl', { ...wheel, friction: 1.2 })
    // 같은 값은 단계를 만들지 않는다
    useSceneStore.getState().setWheel('wfl', { ...wheel, friction: 1.2 })
    expect(undo()).toBe(true)
    expect(friction()).toBe(0)
    expect(undo()).toBe(true)
    expect(friction()).toBe(0.75)
    expect(undo()).toBe(true)
    expect(friction()).toBe(0)
    expect(undo()).toBe(false)
  })

  it('sanitizeWheel 왕복: 받는 값은 그대로, 두 번 거쳐도 같다', () => {
    for (const value of [0, 0.05, 0.6, 3, 0.049, 3.5, -1, NaN, Infinity]) {
      const once = sanitizeWheel({ ...defaultWheel(), friction: value })
      expect(sanitizeWheel(once)).toEqual(once)
      expect(once.friction).toBe(value === 0 || (value >= 0.05 && value <= 3) ? value : 0)
      // 칸 글자로 보였다 다시 읽어도 같은 설정(0은 빈 칸 = 기본)
      if (once.friction !== 0)
        expect(parseWheelFriction(formatWheelFriction(once.friction))).toBe(once.friction)
    }
  })
})

describe('바퀴 카드 문구', () => {
  // 카드가 쓰는 3c 키가 ko·en 모두에 있고 같은 자리 표시자를 쓴다
  const lookup = (messages: unknown, key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        messages
      )
  const placeholders = (text: unknown): string[] =>
    [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
  it.each([
    'hardware.wheel.friction',
    'hardware.wheel.frictionDefault',
    'hardware.wheel.frictionHint',
    'hardware.wheel.frictionRejected',
    'hardware.wheel.wheelMass',
    'hardware.wheel.wheelMassDefault',
    'hardware.wheel.wheelMassDefaultHint',
    'hardware.wheel.wheelMassClipped',
    'hardware.wheel.wheelMassClippedHint',
    'hardware.wheel.staticLoad',
    'hardware.wheel.staticLoadUnknown',
    'hardware.drivetrain.traction',
    'hardware.drivetrain.tractionHint',
    'hardware.drivetrain.topSpeed',
    'hardware.drivetrain.topSpeedRange',
    'hardware.derived.motorOutputRatio'
  ])('%s', (key) => {
    expect(typeof lookup(ko, key)).toBe('string')
    expect(typeof lookup(en, key)).toBe('string')
    expect(placeholders(lookup(en, key))).toEqual(placeholders(lookup(ko, key)))
  })
})

describe('바퀴 카드 그리기', () => {
  const render = (objects: SceneObjects, id: string): string => {
    setStore(useSceneStore, { objects })
    setStore(useUnitStore, { lengthUnit: 'mm' })
    return renderToStaticMarkup(<WheelCard object={objects[id]} />)
  }

  it('지름(표시 단위)·구동 모터·자동 롤러가 푼 형·최고 속도', () => {
    // 메카넘 바퀴 넷: FL 자리의 그룹 바퀴는 앞왼·뒤오른형
    let objects = withWheel(scene(), 'flGroup', { motor: 'fl' })
    const corner = (id: string, x: number, y: number): SceneObject => ({
      id,
      name: id,
      kind: 'part',
      parentId: 'R',
      transform: at(x, y),
      visual: { type: 'mesh', geometryId: `${id}:0`, color: [1, 1, 1] },
      wheel: defaultWheel()
    })
    objects = {
      ...objects,
      fr: corner('fr', 0.15, -0.15),
      bl: corner('bl', -0.15, 0.15),
      br: corner('br', -0.15, -0.15)
    }
    const html = render(objects, 'flGroup')
    expect(html).toContain('value="104.0"')
    expect(html).toContain('지름 (mm)')
    expect(html).toContain('<option value="fl" selected="">leftFront</option>')
    expect(html).toContain('자동 (앞왼·뒤오른형)')
    expect(html).toMatch(/최고 속도 ≈ [\d.]+ mm\/s \(무부하, 12\.5 V\)/)
    expect(html).not.toContain('hw-issue')
    // 모터가 없는 바퀴는 최고 속도 대신 안내, 오른쪽 앞 자리는 앞오른·뒤왼형
    const fr = render(objects, 'fr')
    expect(fr).toContain('구동 모터를 고르면 최고 속도를 보입니다.')
    expect(fr).toContain('자동 (앞오른·뒤왼형)')
    // 롤러를 직접 (위치와 다르게) 골라도 [자동]은 자동이 고를 형을 보인다
    const manual = withWheel(objects, 'fr', { rollers: 'flbr' })
    expect(wheelCardView(manual, 'fr')).toMatchObject({ rollers: 'flbr', autoRollers: 'frbl' })
    const frManual = render(manual, 'fr')
    expect(frManual).toContain('<option value="flbr" selected="">앞왼·뒤오른형</option>')
    expect(frManual).toContain('<option value="auto">자동 (앞오른·뒤왼형)</option>')
  })

  it('지운 모터는 참조를 남긴 채 경고하고, 일반 바퀴에는 롤러 칸이 없다', () => {
    const objects = withWheel(scene(), 'flTire', { kind: 'traction', motor: 'gone' })
    const html = render(objects, 'flTire')
    expect(html).toContain('<option value="gone" selected="">(찾을 수 없는 모터)</option>')
    expect(html).toContain('구동 모터를 이 로봇에서 찾을 수 없습니다')
    expect(html).not.toContain('aria-label="롤러"')
  })

  it('Add Component에 바퀴가 있고, 로봇·이미 바퀴가 있는 오브젝트는 비활성', () => {
    const objects = withWheel(scene(), 'flTire')
    setStore(useSceneStore, { objects })
    const option = (html: string): string => html.match(/<option value="#wheel"[^>]*>/)![0]
    expect(
      option(renderToStaticMarkup(<HardwareComponentsSection object={objects.flGroup} />))
    ).toBe('<option value="#wheel">')
    expect(
      option(renderToStaticMarkup(<HardwareComponentsSection object={objects.R} />))
    ).toContain('disabled')
    const withCard = renderToStaticMarkup(<HardwareComponentsSection object={objects.flTire} />)
    expect(option(withCard)).toContain('disabled')
    // 컴포넌트가 없어도 바퀴 카드가 보인다
    expect(withCard).toContain('data-component-type="wheel"')
    expect(withCard).not.toContain('컴포넌트가 없습니다')
  })

  it('로봇 카드에 구동계 요약과 경고', () => {
    const objects = withWheel(scene(), 'flTire', { motor: 'other' })
    setStore(useSceneStore, { objects })
    const html = renderToStaticMarkup(<RobotHardwareSection robot={objects.R} />)
    expect(html).toContain('구동계 (시뮬레이터)')
    expect(html).toContain('바퀴 1개 · 메카넘 1')
    expect(html).toContain('바퀴 FL tire의 구동 모터를 이 로봇에서 찾을 수 없어')
    // 구동하는 바퀴가 없으면 최고 속도·견인 한계 가속도 없다
    expect(html).not.toContain('최고 속도')
    expect(html).not.toContain('견인 한계 가속')
    setStore(useSceneStore, { objects: scene() })
    expect(renderToStaticMarkup(<RobotHardwareSection robot={objects.R} />)).toContain(
      '바퀴가 없습니다.'
    )
  })

  it('바퀴 카드: 마찰 칸(빈 칸은 흐린 종류 기본)·바퀴 질량·회전 관성·정지 하중·견인 한계', () => {
    const objects = withWheel(fourWheels(), 'wbr', { motor: 'fl', friction: 1.25 })
    // 하중은 인스펙터와 같은 질량 모델의 로봇 질량(여기서는 바퀴·모터 데이터시트 질량)을 대칭인 네 바퀴가 똑같이 나눈다
    const robot = computeMassModel(objects, REGISTRY_MASS_LOOKUP).robots.R
    const load = (robot.mass * GRAVITY) / 4
    const fl = render(objects, 'wfl')
    expect(fl).toContain('마찰 계수')
    expect(fl).toContain('placeholder="종류 기본 (0.60)" value=""')
    // 바퀴 파트의 질량은 goBILDA 104 mm 메카넘 데이터시트 236 g, J = 0.53·0.236·0.052²
    expect(fl).toContain('바퀴 질량 236 g · 회전 관성 0.000338 kg·m²')
    expect(fl).toContain(
      `정지 하중 ≈ ${formatNumber(load, 1)} N · 견인 한계 ≈ ${formatNumber(0.6 * load, 1)} N`
    )
    const br = render(objects, 'wbr')
    expect(br).toContain('aria-label="마찰 계수"')
    expect(br).toMatch(/placeholder="종류 기본 \(0\.60\)" value="1\.25"/)
    expect(br).toContain(`견인 한계 ≈ ${formatNumber(1.25 * load, 1)} N`)
    // 로봇 밖 바퀴는 하중 줄이 없다
    const orphan: SceneObjects = {
      ...objects,
      loose: { ...objects.wfl, id: 'loose', parentId: null }
    }
    const loose = render(orphan, 'loose')
    expect(loose).toContain('바퀴 질량')
    expect(loose).not.toContain('정지 하중')
  })

  it('바퀴 카드: 질량 모델이 모르는 바퀴는 종류 기본, 범위 밖 질량은 자른 값임을 보인다', () => {
    // 표에 없는 일반 바퀴(형상 미등록: 하위 질량 0)
    const base = fourWheels({ kind: 'traction', diameter: 0.096 })
    const unknown = render(base, 'wfl')
    expect(unknown).toContain('바퀴 질량 82 g(종류 기본, 질량 모름) · 회전 관성')
    expect(unknown).toContain('title="질량 모델이 이 바퀴의 질량을 알지 못해')
    // 바퀴에 5 kg를 덮어쓰면 회전 관성에는 2 kg
    const heavy: SceneObjects = { ...base, wfl: { ...base.wfl, mass: { mass: 5 } } }
    const clipped = render(heavy, 'wfl')
    expect(clipped).toContain('(질량 모델 값 5')
    expect(clipped).toMatch(/바퀴 질량 2[.0]* kg\(질량 모델 값 5[.0]* kg에서 자름\) · 회전 관성/)
    expect(clipped).toContain('title="이 바퀴 하위의 질량이 바퀴 하나로 보기에 너무 크거나 작아서')
    // 범위 안이면 계산값 그대로(종류 기본·자름 문구 없음)
    const known: SceneObjects = { ...base, wfl: { ...base.wfl, mass: { mass: 0.3 } } }
    const plain = render(known, 'wfl')
    expect(plain).toContain('바퀴 질량 300 g · 회전 관성')
    expect(plain).not.toContain('종류 기본, 질량 모름')
    expect(plain).not.toContain('에서 자름')
  })

  it('로봇 카드: 최고 속도와 앞 방향 견인 한계 가속(표시 단위, 굴림 0° 메카넘은 바퀴 μ의 하중 가중 평균 × g)', () => {
    const objects = fourWheels()
    setStore(useSceneStore, { objects })
    setStore(useUnitStore, { lengthUnit: 'mm' })
    const speed = wheelTopSpeed(objects.wfl.wheel!, objects.mount.components![0].props, 12.5)
    const html = renderToStaticMarkup(<RobotHardwareSection robot={objects.R} />)
    expect(html).toContain(`최고 속도 ≈ ${(speed * 1000).toFixed(1)} mm/s (무부하, 12.5 V)`)
    // 견인 한계 가속도 표시 길이 단위(0.6·g = 5.884 m/s²)
    expect(html).toContain('앞 방향 견인 한계 가속 ≈ 5884.0 mm/s² (0.60 g)')
    setStore(useUnitStore, { lengthUnit: 'in' })
    expect(renderToStaticMarkup(<RobotHardwareSection robot={objects.R} />)).toContain(
      '앞 방향 견인 한계 가속 ≈ 231.7 in/s² (0.60 g)'
    )
    setStore(useUnitStore, { lengthUnit: 'mm' })
    // 바퀴마다 최고 속도가 다르면 범위
    setStore(useSceneStore, { objects: withWheel(objects, 'wbr', { motor: 'fl', gearRatio: 2 }) })
    expect(renderToStaticMarkup(<RobotHardwareSection robot={objects.R} />)).toContain(
      `최고 속도 ≈ ${((speed / 2) * 1000).toFixed(1)}–${(speed * 1000).toFixed(1)} mm/s (바퀴마다 다름`
    )
  })

  it('하드웨어 카드의 시뮬레이터 속성: 모터 감속비(모델 기본)·출력축 RPM, 데드휠 포드 칸', () => {
    const objects = scene()
    setStore(useSceneStore, { objects })
    setStore(useUnitStore, { lengthUnit: 'mm' })
    const motor = renderToStaticMarkup(<HardwareComponentsSection object={objects.flMotor} />)
    expect(motor).toContain('기어박스 감속비')
    // 0 = 모델 기본(goBILDA 5202 계열 SDK 99.5:1)
    expect(motor).toContain('value="99.50"')
    expect(motor).toContain('모델 기본')
    expect(motor).toContain('출력축 60 RPM (무부하, 12 V) · 2786.0 틱/회전')

    const dead = (podType: string): string => {
      const pod = createComponent('deadWheel', [], () => 'dw')
      const scene2: SceneObjects = {
        ...objects,
        flTire: { ...objects.flTire, components: [{ ...pod, props: { ...pod.props, podType } }] }
      }
      setStore(useSceneStore, { objects: scene2 })
      return renderToStaticMarkup(<HardwareComponentsSection object={scene2.flTire} />)
    }
    expect(dead('fourBar')).not.toContain('포드 바퀴 지름')
    expect(dead('fourBar')).toContain('포드 해상도: 19.894 틱/mm')
    expect(dead('revThroughBore')).toContain('포드 바퀴 지름 (mm)')
    expect(dead('revThroughBore')).toContain('value="35.0"')
    expect(dead('revThroughBore')).not.toContain('엔코더 CPR')
    expect(dead('custom')).toContain('엔코더 CPR')
  })
})
