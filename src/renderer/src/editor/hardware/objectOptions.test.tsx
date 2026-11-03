import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createComponent } from '../../hardware/components'
import ko from '../../i18n/locales/ko'
import { defaultJoint } from '../../scene/joint'
import type { HardwareComponent, SceneObject, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import HardwareComponentsSection from './HardwareComponentsSection'
import { objectOptions, objectPicksOf } from './objectOptions'

// 단위 스토어는 불러올 때 localStorage를 읽는다(Node 테스트에는 없다)
vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다(jointCardModel.test.tsx와 같은 방법)
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

const at = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number]
}

function sw(props: Record<string, string | number> = {}): HardwareComponent {
  const base = createComponent('touchSensor', [], () => 'sw')
  return { ...base, name: 'bottom', props: { ...base.props, ...props } }
}

// 로봇 R: 리프트(직선 관절) → 집게(회전 관절), 관절 없는 판, 스위치가 붙은 파트(Pinpoint 없음). 다른 로봇 R2의 관절.
function scene(switchProps: Record<string, string | number> = {}): SceneObjects {
  const object = (
    id: string,
    parentId: string | null,
    patch: Partial<SceneObject> = {}
  ): SceneObject => ({ id, name: id, kind: 'group', parentId, transform: at, ...patch })
  return {
    R: object('R', null, { name: 'Robot', kind: 'robot' }),
    lift: object('lift', 'R', { name: 'Lift', joint: defaultJoint('prismatic') }),
    claw: object('claw', 'lift', { name: 'Claw', joint: defaultJoint('revolute') }),
    plate: object('plate', 'R', { name: 'Plate', kind: 'part' }),
    switchPart: object('switchPart', 'R', {
      name: 'Switch',
      kind: 'part',
      components: [sw(switchProps)]
    }),
    R2: object('R2', null, { name: 'Other', kind: 'robot' }),
    otherJoint: object('otherJoint', 'R2', { name: 'Other joint', joint: defaultJoint() })
  }
}

describe('object 속성의 고르기 목록', () => {
  it("'joint'는 같은 로봇의 관절 오브젝트만, 'any'는 같은 로봇의 모든 오브젝트(들여 쓰기)", () => {
    const objects = scene()
    expect(objectOptions(objects, 'R', 'joint')).toEqual([
      { id: 'lift', label: 'Lift' },
      { id: 'claw', label: '  Claw' }
    ])
    expect(objectOptions(objects, 'R', 'any').map((o) => o.id)).toEqual([
      'lift',
      'claw',
      'plate',
      'switchPart'
    ])
    expect(objectOptions(objects, null, 'joint')).toEqual([])
    expect(objectPicksOf(['touchSensor', 'motor'])).toEqual(['joint'])
    expect(objectPicksOf(['pinpoint', 'digitalDevice'])).toEqual(['any', 'joint'])
  })

  it('리밋 스위치 카드는 Pinpoint가 없어도 관절을 고를 수 있고, 범위 칸의 단위는 한 번만 보인다', () => {
    setStore(useUnitStore, { lengthUnit: 'mm' })
    const render = (objects: SceneObjects): string => {
      setStore(useSceneStore, { objects })
      return renderToStaticMarkup(<HardwareComponentsSection object={objects.switchPart} />)
    }
    const empty = render(scene())
    expect(empty).toContain('<option value="lift">Lift</option>')
    expect(empty).toContain('<option value="claw">  Claw</option>')
    expect(empty).not.toContain('Plate')
    expect(empty).not.toContain('Other joint')
    // 직선 관절에 연결하면 거리 칸(표시 단위 한 번, 기본값은 도움말에)
    const linked = render(scene({ limitJoint: 'lift' }))
    expect(linked).toContain('<option value="lift" selected="">Lift</option>')
    expect(linked).toContain('<span class="hw-row-label">눌리는 거리 (mm)</span>')
    expect(linked).toContain('0이면 기본값 2 mm입니다.')
    expect(linked).not.toContain('눌리는 각도')
    const angle = render(scene({ limitJoint: 'claw' }))
    expect(angle).toContain('<span class="hw-row-label">눌리는 각도 (°)</span>')
    // 다른 로봇의 관절·지운 관절은 관절로 보지 않고(범위 칸 없음) 찾을 수 없다고 보인다
    const other = render(scene({ limitJoint: 'otherJoint' }))
    expect(other).toContain(
      '<option value="otherJoint" selected="">(찾을 수 없는 오브젝트)</option>'
    )
    expect(other).not.toContain('눌리는 끝')
  })
})
