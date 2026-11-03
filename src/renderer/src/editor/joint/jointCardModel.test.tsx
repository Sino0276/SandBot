import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createComponent } from '../../hardware/components'
import ko from '../../i18n/locales/ko'
import type { ObjectMass } from '../../mass/types'
import type {
  HardwareComponent,
  JointDrive,
  JointSettings,
  SceneObject,
  SceneObjects,
  Transform
} from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import HardwareComponentsSection from '../hardware/HardwareComponentsSection'
import JointCard from './JointCard'
import {
  canAddJoint,
  driveOptions,
  GRAVITY,
  jointCardView,
  nonNegativeJointValue,
  parentJointId,
  previewRange,
  robotAxisName,
  springRestValue,
  stageOptions,
  withLimit
} from './jointCardModel'
import { defaultJoint, defaultJointDrive, jointTypePatch } from './jointDefaults'
import { clearJointPreview, setJointPreview, useJointPreviewStore } from './jointPreviewStore'
import type { ActuatorRatings } from './jointRatings'

// 단위 스토어는 불러올 때 localStorage를 읽는다(Node 테스트에는 없다)
vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다(wheelCardModel.test.tsx와 같은 방법)
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

const at = (
  x: number,
  y: number,
  z = 0,
  rotation: Transform['rotation'] = [0, 0, 0]
): Transform => ({
  position: [x, y, z],
  rotation
})

const motor = (id: string, name: string): HardwareComponent => ({
  ...createComponent('motor', [], () => id),
  name
})
const servo = (id: string, name: string): HardwareComponent => ({
  ...createComponent('servo', [], () => id),
  name
})

// 로봇 R: 팔(arm, 회전 관절 후보, 로봇 앞 0.1 m 높이 0.3 m)과 리프트(lift → stage2, 직선 관절 후보), 모터 셋(하나는 바퀴),
// 서보 하나. 다른 로봇 R2의 모터 하나.
function scene(): SceneObjects {
  return {
    R: { id: 'R', name: 'Robot', kind: 'robot', parentId: null, transform: at(1, 0) },
    base: {
      id: 'base',
      name: 'Base',
      kind: 'part',
      parentId: 'R',
      transform: at(0, 0),
      components: [motor('armMotor', 'arm'), motor('liftMotor', 'lift'), servo('claw', 'claw')]
    },
    wheel: {
      id: 'wheel',
      name: 'Wheel',
      kind: 'part',
      parentId: 'R',
      transform: at(0.15, 0.15),
      components: [motor('fl', 'leftFront')],
      wheel: {
        kind: 'mecanum',
        diameter: 0.104,
        motor: 'fl',
        gearRatio: 1,
        angle: 0,
        rollers: 'auto'
      }
    },
    arm: { id: 'arm', name: 'Arm', kind: 'group', parentId: 'R', transform: at(0.1, 0, 0.3) },
    lift: { id: 'lift', name: 'Lift', kind: 'group', parentId: 'R', transform: at(-0.1, 0, 0.1) },
    stage2: {
      id: 'stage2',
      name: 'Stage 2',
      kind: 'group',
      parentId: 'lift',
      transform: at(0, 0, 0.05)
    },
    R2: { id: 'R2', name: 'Other', kind: 'robot', parentId: null, transform: at(3, 3) },
    other: {
      id: 'other',
      name: 'Other part',
      kind: 'part',
      parentId: 'R2',
      transform: at(0, 0),
      components: [motor('otherMotor', 'otherBot')]
    }
  }
}

const withJoint = (
  objects: SceneObjects,
  id: string,
  patch: Partial<JointSettings> = {}
): SceneObjects => ({
  ...objects,
  [id]: { ...objects[id], joint: { ...defaultJoint(patch.type), ...patch } }
})

const objectMass = (mass: number, centerOfMass: [number, number, number]): ObjectMass => ({
  mass,
  centerOfMass,
  source: 'override',
  detail: '',
  inheritedFrom: null,
  scaled: false,
  pendingMeshes: 0
})

// 시험 정격: 모터마다 정지 토크 2 N·m·무부하 10 rad/s, 서보 1 N·m·5 rad/s
const RATINGS: ActuatorRatings = {
  motor: () => ({ stallTorque: 2, freeSpeed: 10 }),
  servo: () => ({ stallTorque: 1, freeSpeed: 5 })
}

const motorDrive = (patch: Partial<Extract<JointDrive, { kind: 'motor' }>> = {}): JointDrive => ({
  ...(defaultJointDrive('motor') as Extract<JointDrive, { kind: 'motor' }>),
  ...patch
})

describe('관절 카드 보기 계산', () => {
  it('Add Component의 관절: 로봇·바퀴 오브젝트·이미 있는 오브젝트는 비활성, CAD 루트·그룹·파트는 된다', () => {
    const objects = withJoint(scene(), 'arm')
    expect(canAddJoint(objects.R)).toBe(false)
    expect(canAddJoint(objects.wheel)).toBe(false)
    expect(canAddJoint(objects.arm)).toBe(false)
    expect(canAddJoint(objects.lift)).toBe(true)
    expect(canAddJoint(objects.base)).toBe(true)
    const cadRoot: SceneObject = {
      ...objects.lift,
      kind: 'assembly',
      cad: {
        fileName: 'arm.step',
        absolutePath: '/arm.step',
        upAxis: '+Z',
        forwardAxis: '+X',
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        meshCount: 1,
        meshIndexing: 'source'
      }
    }
    expect(canAddJoint(cadRoot)).toBe(true)
  })

  it('구동 장치 후보는 같은 로봇의 그 종류 컴포넌트, 위 단 후보는 하위 직선 관절', () => {
    let objects = withJoint(scene(), 'lift', { type: 'prismatic' })
    objects = withJoint(objects, 'stage2', { type: 'prismatic', drive: { kind: 'stage' } })
    expect(driveOptions(objects, 'arm', 'motor').map((o) => o.name)).toEqual([
      'arm',
      'lift',
      'leftFront'
    ])
    expect(driveOptions(objects, 'arm', 'servo')).toEqual([
      { id: 'claw', name: 'claw', objectName: 'Base' }
    ])
    expect(driveOptions(objects, 'arm', 'crServo')).toEqual([])
    expect(stageOptions(objects, 'lift')).toEqual([{ id: 'stage2', name: 'Stage 2' }])
    expect(stageOptions(objects, 'arm')).toEqual([])
    expect(parentJointId(objects, 'stage2')).toBe('lift')
    expect(parentJointId(objects, 'lift')).toBeNull()
  })

  it('회전 관절: 중력 토크(앵커 둘레), 정지 토크(감속비·배터리 전압), 여유, 최고 속도', () => {
    // 팔 축 +Y(로봇 +Y, 오른손: +q면 팔 끝이 내려간다), 앵커는 팔 원점. 무게중심은 앵커 앞 0.3 m
    const objects = withJoint(scene(), 'arm', {
      axis: 'y',
      drive: motorDrive({ motors: ['armMotor'], gearRatio: 5 })
    })
    const masses = { arm: objectMass(2, [0.4, 0, 0.3]) }
    const view = jointCardView(objects, 'arm', masses, RATINGS, 12)!
    expect(view.inRobot).toBe(true)
    expect(view.robotAxis).toEqual([0, 1, 0])
    // |u · ((c − p) × m·g)| = 0.3 × 2 × g
    expect(view.load).toBeCloseTo(0.3 * 2 * GRAVITY, 9)
    expect(view.capacity).toBeCloseTo(2 * 5, 9)
    expect(view.margin).toBeCloseTo(10 / (0.6 * GRAVITY), 9)
    expect(view.maxSpeed).toBeCloseTo(10 / 5, 9)
    expect(view.endSpeed).toBeNull()
    expect(view.warnings).toEqual([])
    // 배터리 전압에 비례한다(바퀴 최고 속도와 같은 가정)
    const low = jointCardView(objects, 'arm', masses, RATINGS, 9)!
    expect(low.maxSpeed).toBeCloseTo(2 * 0.75, 9)
    expect(low.capacity).toBeCloseTo(10 * 0.75, 9)
    // 무게중심이 축 위에 있으면 부하가 없다(여유 없음)
    const balanced = jointCardView(
      objects,
      'arm',
      { arm: objectMass(2, [0.1, 0, 0.6]) },
      RATINGS,
      12
    )!
    expect(balanced.load).toBeCloseTo(0, 12)
    expect(balanced.margin).toBeNull()
  })

  it('직선 관절: 스풀 반지름으로 힘과 속도를 옮기고, 버티지 못하면 경고', () => {
    const objects = withJoint(scene(), 'lift', {
      type: 'prismatic',
      axis: 'z',
      drive: motorDrive({ motors: ['liftMotor'], gearRatio: 1, spoolDiameter: 0.04 })
    })
    const light = jointCardView(objects, 'lift', { lift: objectMass(3, [0, 0, 0.2]) }, RATINGS, 12)!
    expect(light.load).toBeCloseTo(3 * GRAVITY, 9)
    expect(light.capacity).toBeCloseTo(2 / 0.02, 9)
    expect(light.maxSpeed).toBeCloseTo(10 * 0.02, 9)
    expect(light.warnings).toEqual([])
    const heavy = jointCardView(
      objects,
      'lift',
      { lift: objectMass(20, [0, 0, 0.2]) },
      RATINGS,
      12
    )!
    expect(heavy.margin).toBeLessThan(1)
    expect(heavy.warnings).toEqual([{ key: 'cannotHold' }])
    // 모터를 둘 묶으면 정지 토크가 두 배, 속도는 같다
    const both = withJoint(objects, 'lift', {
      type: 'prismatic',
      axis: 'z',
      drive: motorDrive({ motors: ['liftMotor', 'armMotor'], spoolDiameter: 0.04 })
    })
    const view = jointCardView(both, 'lift', { lift: objectMass(3, [0, 0, 0.2]) }, RATINGS, 12)!
    expect(view.capacity).toBeCloseTo(200, 9)
    expect(view.maxSpeed).toBeCloseTo(0.2, 9)
  })

  it('정하중 스프링은 중력 부하를 덜고, 선형 스프링은 편집 자세에서 k × 기준 위치', () => {
    const base = withJoint(scene(), 'lift', {
      type: 'prismatic',
      axis: 'z',
      spring: { kind: 'constantForce', force: 3 * GRAVITY }
    })
    const masses = { lift: objectMass(3, [0, 0, 0.2]) }
    expect(jointCardView(base, 'lift', masses, RATINGS, 12)!.load).toBeCloseTo(0, 9)
    const linear = withJoint(scene(), 'lift', {
      type: 'prismatic',
      axis: 'z',
      spring: { kind: 'linear', stiffness: 100, rest: 0.1 }
    })
    expect(jointCardView(linear, 'lift', masses, RATINGS, 12)!.load).toBeCloseTo(
      3 * GRAVITY - 10,
      9
    )
  })

  it('다단 슬라이드: 캐스케이드는 단 짐의 합·끝 단 속도 ×(단 수 + 1), 연속은 가장 무거운 단·속도 그대로', () => {
    const slide = (rigging: 'cascade' | 'continuous'): SceneObjects => {
      const objects = withJoint(scene(), 'lift', {
        type: 'prismatic',
        axis: 'z',
        drive: motorDrive({
          motors: ['liftMotor'],
          spoolDiameter: 0.04,
          rigging: { kind: rigging, stages: ['stage2'] }
        })
      })
      return withJoint(objects, 'stage2', {
        type: 'prismatic',
        axis: 'z',
        drive: { kind: 'stage' }
      })
    }
    // 첫 단의 하위 전체 3 kg(위 단 1 kg 포함)
    const masses = {
      lift: objectMass(3, [0, 0, 0.3]),
      stage2: objectMass(1, [0, 0, 0.4])
    }
    const cascade = jointCardView(slide('cascade'), 'lift', masses, RATINGS, 12)!
    expect(cascade.load).toBeCloseTo(4 * GRAVITY, 9)
    expect(cascade.endSpeed).toBeCloseTo(2 * 0.2, 9)
    const continuous = jointCardView(slide('continuous'), 'lift', masses, RATINGS, 12)!
    expect(continuous.load).toBeCloseTo(3 * GRAVITY, 9)
    expect(continuous.endSpeed).toBeCloseTo(0.2, 9)
    // 위 단 카드는 아래 단을 가리킨다
    const stage = jointCardView(slide('cascade'), 'stage2', masses, RATINGS, 12)!
    expect(stage.stageOf).toBe('lift')
    expect(stage.warnings).toEqual([])
  })

  it('경고: 모터 없음·없는 모터·바퀴 모터·앞 관절이 쓰는 모터·서보 직선·잘못된 단·떨어진 단·질량 없음', () => {
    let objects = withJoint(scene(), 'arm', { drive: motorDrive({ motors: ['armMotor'] }) })
    objects = withJoint(objects, 'lift', {
      type: 'prismatic',
      drive: motorDrive({ motors: ['armMotor', 'fl', 'otherMotor', 'gone'] })
    })
    const masses = { arm: objectMass(1, [0.2, 0, 0.3]), lift: objectMass(1, [0, 0, 0]) }
    expect(jointCardView(objects, 'lift', masses, RATINGS, 12)!.warnings).toEqual([
      { key: 'motorShared', motor: 'arm', joint: 'Arm' },
      { key: 'motorOnWheel', motor: 'leftFront' },
      { key: 'motorMissing' },
      { key: 'motorMissing' }
    ])
    const none = withJoint(scene(), 'arm', { drive: motorDrive() })
    expect(jointCardView(none, 'arm', {}, RATINGS, 12)!.warnings).toEqual([
      { key: 'noMass' },
      { key: 'noMotor' }
    ])
    const slideServo = withJoint(scene(), 'lift', {
      type: 'prismatic',
      drive: { kind: 'servo', servo: 'claw', gearRatio: 1 }
    })
    expect(jointCardView(slideServo, 'lift', masses, RATINGS, 12)!.warnings).toEqual([
      { key: 'servoOnSlide' }
    ])
    const missingServo = withJoint(scene(), 'arm', {
      drive: { kind: 'crServo', servo: 'claw', gearRatio: 1, spoolDiameter: 0.04 }
    })
    expect(jointCardView(missingServo, 'arm', masses, RATINGS, 12)!.warnings).toEqual([
      { key: 'servoMissing' }
    ])
    // 위 단의 구동이 '위 단'이 아니면 그 단부터 묶지 않고, 그 단은 어느 슬라이드에도 들지 않는다
    let slide = withJoint(scene(), 'lift', {
      type: 'prismatic',
      drive: motorDrive({ rigging: { kind: 'cascade', stages: ['stage2'] }, motors: ['liftMotor'] })
    })
    slide = withJoint(slide, 'stage2', { type: 'prismatic' })
    expect(
      jointCardView(slide, 'lift', { ...masses, stage2: objectMass(1, [0, 0, 0]) }, RATINGS, 12)!
        .warnings
    ).toEqual([{ key: 'stageInvalid', stage: 'Stage 2' }])
    slide = withJoint(slide, 'stage2', { type: 'prismatic', drive: { kind: 'stage' } })
    const orphan = withJoint(slide, 'lift', { type: 'prismatic' })
    expect(
      jointCardView(orphan, 'stage2', { stage2: objectMass(1, [0, 0, 0]) }, RATINGS, 12)!.warnings
    ).toEqual([{ key: 'stageOrphan' }])
    // 읽는 중인 메시
    const pending = { arm: { ...objectMass(1, [0.2, 0, 0.3]), pendingMeshes: 4 } }
    const arm = withJoint(scene(), 'arm')
    expect(jointCardView(arm, 'arm', pending, RATINGS, 12)!.warnings).toEqual([
      { key: 'massPending', count: 4 }
    ])
  })

  it('정격을 모르면 속도·정지 토크·여유는 null(서보는 배터리 전압과 관계없다)', () => {
    const objects = withJoint(scene(), 'arm', {
      drive: { kind: 'servo', servo: 'claw', gearRatio: 2 }
    })
    const masses = { arm: objectMass(1, [0.2, 0, 0.3]) }
    const unknown: ActuatorRatings = {
      motor: () => ({ stallTorque: null, freeSpeed: null }),
      servo: () => ({ stallTorque: null, freeSpeed: null })
    }
    expect(jointCardView(objects, 'arm', masses, unknown, 12)).toMatchObject({
      maxSpeed: null,
      capacity: null,
      margin: null
    })
    const known = jointCardView(objects, 'arm', masses, RATINGS, 9)!
    expect(known.maxSpeed).toBeCloseTo(2.5, 9)
    expect(known.capacity).toBeCloseTo(2, 9)
  })

  it('축의 로봇 방향: CAD 파일 축(Y-up)으로 돌아간 오브젝트의 로컬 Y는 로봇 +Z', () => {
    const objects = withJoint(
      {
        ...scene(),
        arm: { ...scene().arm, transform: at(0.1, 0, 0.3, [Math.PI / 2, 0, 0]) }
      },
      'arm',
      { axis: 'y' }
    )
    const view = jointCardView(objects, 'arm', {}, RATINGS, 12)!
    expect(robotAxisName(view.robotAxis)).toBe('+z')
    expect(robotAxisName([0, 0, -1])).toBe('-z')
    expect(robotAxisName([Math.SQRT1_2, Math.SQRT1_2, 0])).toBeNull()
  })

  it('한계 칸은 아래 ≤ 위를 지키고, 미리보기 범위는 한계(한계 없으면 ±180°)', () => {
    expect(withLimit({ lower: 0, upper: 0.5 }, 'lower', 0.7)).toEqual({ lower: 0.5, upper: 0.5 })
    expect(withLimit({ lower: 0, upper: 0.5 }, 'upper', -1)).toEqual({ lower: 0, upper: 0 })
    expect(previewRange({ limits: { lower: -1, upper: 2 } })).toEqual({ min: -1, max: 2 })
    expect(previewRange({ limits: null })).toEqual({ min: -Math.PI, max: Math.PI })
  })

  it('마찰·스프링 칸은 0 이상·한도 이하, 기준 위치는 관절 값 한도 안(세계 설명 검증이 받는 값)', () => {
    // 음수 정전력은 0으로 자른다(− 방향은 축 부호로). 그대로 두면 스토어 정리가 스프링을 통째로 뗀다
    expect(nonNegativeJointValue('springForce', -5)).toBe(0)
    expect(Object.is(nonNegativeJointValue('springForce', -0), 0)).toBe(true)
    expect(nonNegativeJointValue('springForce', 12.5)).toBe(12.5)
    expect(nonNegativeJointValue('springForce', 1e9)).toBe(1e4)
    expect(nonNegativeJointValue('coulomb', -1)).toBe(0)
    expect(nonNegativeJointValue('viscous', 2e4)).toBe(1e4)
    expect(nonNegativeJointValue('stiffness', 5e6)).toBe(1e6)
    expect(nonNegativeJointValue('stiffness', Number.NaN)).toBe(0)
    expect(springRestValue('revolute', 20)).toBe(4 * Math.PI)
    expect(springRestValue('revolute', -20)).toBe(-4 * Math.PI)
    expect(springRestValue('prismatic', 12)).toBe(10)
    expect(springRestValue('prismatic', -0.2)).toBe(-0.2)
  })

  it('종류를 바꾸면 기본값 그대로인 한계·마찰을 새 종류의 기본값으로, 스프링은 뗀다', () => {
    const revolute = { ...defaultJoint('revolute'), spring: { kind: 'constantForce', force: 1 } }
    const prismatic = jointTypePatch(revolute as JointSettings, 'prismatic')
    expect(prismatic).toMatchObject({
      type: 'prismatic',
      limits: { lower: 0, upper: 0.5 },
      friction: { coulomb: 1, viscous: 0.5 },
      spring: null
    })
    // 고친 값은 그대로, 제한 없는 회전 관절은 직선의 기본 한계
    const custom = { ...defaultJoint('revolute'), limits: { lower: -0.2, upper: 0.3 } }
    expect(jointTypePatch(custom, 'prismatic').limits).toEqual({ lower: -0.2, upper: 0.3 })
    const free = { ...defaultJoint('revolute'), limits: null }
    expect(jointTypePatch(free, 'prismatic').limits).toEqual({ lower: 0, upper: 0.5 })
  })
})

describe('관절 카드 그리기', () => {
  const render = (objects: SceneObjects, id: string): string => {
    setStore(useSceneStore, { objects })
    setStore(useUnitStore, { lengthUnit: 'mm' })
    return renderToStaticMarkup(<JointCard object={objects[id]} />)
  }

  it('Unity 칸 이름·표시 단위·구동 장치 고르기와 계산값', () => {
    const objects = withJoint(scene(), 'lift', {
      type: 'prismatic',
      axis: 'z',
      anchor: [0.01, 0, 0],
      drive: motorDrive({ motors: ['liftMotor', 'gone'] })
    })
    const html = render(objects, 'lift')
    expect(html).toContain('Articulation Body')
    expect(html).toContain('<option value="prismatic" selected="">직선 (Prismatic)</option>')
    // 앵커·한계는 표시 단위(mm)
    expect(html).toContain('앵커 <span class="vector-row-unit">mm</span>')
    expect(html).toContain('value="10.0"')
    expect(html).toContain('위 한계 (mm)')
    expect(html).toContain('value="500.0"')
    expect(html).toContain('로봇 기준 축: +Z (위)')
    expect(html).toContain('마찰 (Joint Friction) (N)')
    // 모터 체크 상자(지운 모터 참조는 남긴 채 뗄 수 있게), 바퀴 모터도 후보지만 경고
    expect(html).toMatch(/<input type="checkbox" checked=""\/>lift/)
    expect(html).toContain('(찾을 수 없는 모터)')
    expect(html).toContain('리깅')
    expect(html).toContain('미리보기')
    expect(html).toContain('구동 모터를 이 로봇에서 찾을 수 없습니다')
  })

  it('회전 관절은 한계 끄기 칸과 ° 단위, 위치 서보 구동', () => {
    const objects = withJoint(scene(), 'arm', {
      limits: null,
      drive: { kind: 'servo', servo: 'claw', gearRatio: 1 }
    })
    const html = render(objects, 'arm')
    expect(html).toContain('한계 있음')
    expect(html).not.toContain('위 한계')
    expect(html).toContain('<option value="claw" selected="">claw</option>')
    expect(html).not.toContain('리깅')
    expect(html).not.toContain('스풀 지름')
  })

  it('Add Component에 관절이 있고, 로봇·이미 관절이 있는 오브젝트는 비활성', () => {
    const objects = withJoint(scene(), 'arm')
    setStore(useSceneStore, { objects })
    const option = (html: string): string => html.match(/<option value="#joint"[^>]*>/)![0]
    expect(option(renderToStaticMarkup(<HardwareComponentsSection object={objects.lift} />))).toBe(
      '<option value="#joint">'
    )
    expect(
      option(renderToStaticMarkup(<HardwareComponentsSection object={objects.R} />))
    ).toContain('disabled')
    const withCard = renderToStaticMarkup(<HardwareComponentsSection object={objects.arm} />)
    expect(option(withCard)).toContain('disabled')
    expect(withCard).toContain('data-component-type="joint"')
    expect(withCard).not.toContain('컴포넌트가 없습니다')
    // 관절이 있는 오브젝트에는 바퀴를 붙이지 않는다
    expect(withCard.match(/<option value="#wheel"[^>]*>/)![0]).toContain('disabled')
  })
})

describe('관절 미리보기(보기 상태)', () => {
  it('씬 문서·실행 취소와 관계없이 값만 바꾸고, 지우면 사라진다', () => {
    const objects = withJoint(scene(), 'arm')
    useSceneStore.setState({ objects })
    setJointPreview('arm', 0.5)
    setJointPreview('arm', NaN)
    expect(useJointPreviewStore.getState().values).toEqual({ arm: 0.5 })
    expect(useSceneStore.getState().objects).toBe(objects)
    const values = useJointPreviewStore.getState().values
    // 같은 값이면 상태를 바꾸지 않는다(구독자가 다시 그리지 않게)
    setJointPreview('arm', 0.5)
    expect(useJointPreviewStore.getState().values).toBe(values)
    clearJointPreview('arm')
    expect(useJointPreviewStore.getState().values).toEqual({})
    expect(useSceneStore.getState().objects).toBe(objects)
  })
})
