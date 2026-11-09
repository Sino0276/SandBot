import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import ko from '../../i18n/locales/ko'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { tagsInputSummary } from '../playFormat'
import { newRun, usePlayStore } from '../playStore'
import DevicesView from './DevicesView'

// 장치 탭의 웹캠 입력 tags 요약(spec-4d §1.15, C6): 원소 대신 "태그 N장: id…", 빈 배열은 "태그 없음", 다른 배열(PIDF)은
// 그대로

// 단위 스토어는 불러올 때 localStorage를 읽는다(Node 테스트에는 없다)
vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

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

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.ConceptAprilTag',
  path: '',
  line: 0,
  flavor: 'TeleOp',
  name: 'Concept: AprilTag',
  group: '',
  preselectTeleOp: ''
}

// 태그 하나의 입력 칸 9개(id, 꼭짓점 넷 px)
const tag = (id: number): number[] => [id, 10.5, 20.5, 30.5, 20.5, 30.5, 40.5, 10.5, 40.5]

const SCENE: SceneObjects = {
  bot: {
    id: 'bot',
    name: 'Bot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  },
  cam: {
    id: 'cam',
    name: 'Cam',
    kind: 'part',
    parentId: 'bot',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    components: [
      {
        id: 'w',
        type: 'webcam',
        name: 'Webcam 1',
        hub: 'controlHub',
        port: 0,
        props: { serialNumber: 'SN' }
      },
      { id: 'm', type: 'motor', name: 'arm', hub: 'controlHub', port: 0, props: {} }
    ]
  }
}

function render(tags: number[]): string {
  const run = newRun({
    runId: 'r',
    root: '/p',
    opMode: OP_MODE,
    robotId: 'bot',
    configPath: '/p/x.xml',
    speed: 1,
    paused: false
  })
  setStore(useSceneStore, { objects: SCENE })
  setStore(usePlayStore, {
    run: {
      ...run,
      phase: 'running',
      devices: {
        tNanos: 0,
        outputs: {
          'Webcam 1': { state: 'STREAMING', fps: 30 },
          arm: { velocityPidf: [10, 3, 0, 0] }
        },
        inputs: { 'Webcam 1': { model: 'logitechC920', frameNanos: 33333333, tags } }
      }
    }
  })
  return renderToStaticMarkup(<DevicesView />)
}

describe('장치 탭 웹캠 tags 요약', () => {
  it('C6: "태그 4장: 34, 35, 36, 37", 빈 배열은 "태그 없음", PIDF 배열은 그대로', () => {
    const html = render([...tag(34), ...tag(35), ...tag(36), ...tag(37)])
    expect(html).toContain('태그 4장: 34, 35, 36, 37')
    expect(html).not.toContain('10.5')
    expect(html).toContain('[10, 3, 0, 0]')
    expect(html).toContain('logitechC920')
    expect(render([])).toContain('태그 없음')
  })

  it('tagsInputSummary: tags 규칙에 맞을 때만(다른 키의 배열·어긋난 길이는 null)', () => {
    expect(tagsInputSummary('tags', [...tag(30), ...tag(31)])).toEqual({ count: 2, ids: '30, 31' })
    expect(tagsInputSummary('tags', [])).toEqual({ count: 0, ids: '' })
    expect(tagsInputSummary('velocityPidf', [10, 3, 0, 0])).toBeNull()
    expect(tagsInputSummary('tags', [1, 2, 3])).toBeNull()
    expect(tagsInputSummary('tags', 5)).toBeNull()
  })
})
