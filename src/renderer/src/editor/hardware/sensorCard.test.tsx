import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import ko from '../../i18n/locales/ko'
import { newRun, usePlayStore } from '../../play/playStore'
import type { HardwareComponent, SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import ComponentCard from './ComponentCard'

// 거리·컬러 센서 카드(spec-4c §1.9, C8·C10b): 조준 칸, 편집 자세 값 줄, 실행 중인 로봇의 조준 칸 배지. 값 줄의 숫자는
// 광선 계산(A)이 정한다(스텁 동안은 물체 없음), 여기서는 줄이 있는지와 형식을 본다.

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

const distance: HardwareComponent = {
  id: 'dist',
  type: 'distanceSensor',
  name: 'front',
  hub: 'controlHub',
  port: 1,
  props: { aimYaw: Math.PI / 2, aimPitch: 0 }
}
const color: HardwareComponent = {
  id: 'col',
  type: 'colorSensor',
  name: 'floor',
  hub: 'controlHub',
  port: 2,
  props: { gain: 2, aimYaw: 0, aimPitch: -Math.PI / 2 }
}

const SCENE: SceneObjects = {
  bot: {
    id: 'bot',
    name: 'Bot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  },
  part: {
    id: 'part',
    name: 'Sensor',
    kind: 'part',
    parentId: 'bot',
    transform: { position: [0.2, 0, 0.1], rotation: [0, 0, 0] },
    components: [distance, color]
  }
}

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Auto',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Auto.java',
  line: 1,
  flavor: 'Autonomous',
  name: 'Auto',
  group: '',
  preselectTeleOp: ''
}

const render = (component: HardwareComponent): string => {
  setStore(useSceneStore, { objects: SCENE })
  setStore(useUnitStore, { lengthUnit: 'mm' })
  return renderToStaticMarkup(
    <ComponentCard
      objects={SCENE}
      objectId="part"
      component={component}
      siblings={[]}
      objectOptions={{}}
      expansionHubEnabled={false}
      issues={[]}
    />
  )
}

describe('센서 카드', () => {
  it('조준 칸(°)과 편집 자세 값 줄(도움말), 형상이 없으면 피벗 꼬리', () => {
    const html = render(distance)
    expect(html).toContain('조준 방향 (°)')
    expect(html).toContain('조준 높이각(위 +) (°)')
    // 요 90°가 °로 보인다
    expect(html).toContain('value="90.0"')
    expect(html).toContain('편집 자세 값')
    expect(html).toContain(
      `title="${i18n.t('hardware.sensorReading.hint').replace(/'/g, '&#x27;')}"`
    )
    expect(html).toContain(`⚠ ${i18n.t('hardware.sensorReading.tails.pivot')}`)
    expect(html).not.toContain('frame-badge is-running')
  })

  it('컬러 센서는 드라이버 값·정규화·alpha 줄과 getDistance 줄', () => {
    const html = render(color)
    expect(html).toMatch(
      /red \d+ · green \d+ · blue \d+ · 정규화\(게인 2\) [\d.]+·[\d.]+·[\d.]+ · alpha [\d.]+/
    )
    expect(html).toContain('value="-90.0"')
  })

  it('C10b: 실행 중인 로봇의 조준 칸에 "실행 중" 배지(편집은 막지 않음)', () => {
    const run = newRun({
      runId: 'r1',
      root: '/p',
      opMode: OP_MODE,
      robotId: 'bot',
      configPath: null,
      speed: 1,
      paused: false
    })
    setStore(usePlayStore, { run: { ...run, phase: 'running' } })
    const html = render(distance)
    const badges = html.match(/frame-badge is-running/g) ?? []
    expect(badges).toHaveLength(2)
    expect(html).toContain(`title="${i18n.t('hardware.aimRunningHint')}"`)
    expect(html).toContain(i18n.t('inspector.running'))
    // 칸은 그대로 입력할 수 있다
    expect(html).not.toMatch(/aria-label="조준 방향"[^>]*disabled/)
  })
})
