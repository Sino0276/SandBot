import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { BoxGeometry } from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createComponent } from '../../hardware/components'
import ko from '../../i18n/locales/ko'
import { disposeGeometry, registerGeometry } from '../../scene/geometryRegistry'
import type { SceneObject, SceneObjects, Transform } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { defaultWheel } from '../../scene/wheel'
import { useUnitStore } from '../../units/unitStore'
import HardwareComponentsSection from './HardwareComponentsSection'
import RobotHardwareSection from './RobotHardwareSection'
import {
  canAddWheel,
  drivetrainSummary,
  newWheel,
  suggestWheelDiameter,
  wheelCardView,
  wheelKindPatch,
  wheelMotorOptions
} from './wheelCard'
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

  it('[파트 크기로]: 오브젝트 축으로 잰 경계 상자의 둘째로 긴 변, 형상이 없으면 null', () => {
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

  it('로봇 카드 요약: 바퀴 수·종류와 실행 때의 경고', () => {
    let objects = withWheel(scene(), 'flGroup', { motor: 'fl' })
    objects = withWheel(objects, 'flMotor', { kind: 'omni', motor: '' })
    const summary = drivetrainSummary(objects, 'R', { batteryVoltage: 12 })
    expect(summary.count).toBe(2)
    expect(summary.kinds).toEqual([
      { kind: 'mecanum', count: 1 },
      { kind: 'omni', count: 1 }
    ])
    // 하이어라키 순서: 메카넘 하나는 중심 위에 있어 롤러가 모호하고, 그 아래 옴니는 구동 모터가 없다
    expect(summary.warnings.map((warning) => warning.key)).toEqual([
      'worldRollersAmbiguous',
      'worldWheelNoMotor'
    ])
    expect(drivetrainSummary(scene(), 'R', { batteryVoltage: 12 })).toMatchObject({
      count: 0,
      kinds: []
    })
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
  })

  it('지운 모터는 참조를 남긴 채 경고하고, 일반 바퀴에는 롤러 칸이 없다', () => {
    const objects = withWheel(scene(), 'flTire', { kind: 'traction', motor: 'gone' })
    const html = render(objects, 'flTire')
    expect(html).toContain('<option value="gone" selected="">(찾을 수 없는 모터)</option>')
    expect(html).toContain('구동 모터를 이 로봇에서 찾을 수 없습니다')
    expect(html).not.toContain('롤러')
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
    setStore(useSceneStore, { objects: scene() })
    expect(renderToStaticMarkup(<RobotHardwareSection robot={objects.R} />)).toContain(
      '바퀴가 없습니다.'
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
