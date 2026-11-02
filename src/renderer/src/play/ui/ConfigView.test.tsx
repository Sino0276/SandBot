import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { LOCAL_DRAFT_ATTRIBUTE } from '../../editor/useDraft'
import ko from '../../i18n/locales/ko'
import { newRun, usePlayStore } from '../playStore'
import ConfigView from './ConfigView'

// 설정값(Config) 탭(renderToStaticMarkup, DOM 없음). 입력 흐름은 playActions·dashConfigApply 시험이 확인한다.

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다. 그 객체에도 같은 값을 넣고 끝나면 되돌린다.
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
  className: 'org.firstinspires.ftc.teamcode.Lift',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Lift',
  group: '',
  preselectTeleOp: ''
}

describe('설정값 탭', () => {
  it('실행 중 값 칸은 글자 입력칸이고, 글자를 바꾸기 전에는 초안 속성이 없다(Ctrl+Z는 씬의 것)', () => {
    const run = newRun({
      runId: 'r',
      root: '/p',
      opMode: OP_MODE,
      robotId: null,
      configPath: null,
      speed: 1,
      paused: false
    })
    setStore(usePlayStore, {
      run: { ...run, accepted: true, phase: 'running' },
      dashConfig: {
        runId: 'r',
        root: '/p',
        tNanos: 0,
        tree: {
          kind: 'custom',
          children: [
            {
              name: 'kP',
              node: { kind: 'value', type: 'double', value: '0.5', enumValues: [], source: null }
            }
          ]
        },
        baseline: new Map([['["kP"]', '0.5']]),
        pending: {}
      }
    })
    const html = renderToStaticMarkup(<ConfigView />)
    // EditorLayout의 hasPendingTextEdit는 type="text" 입력칸의 초안 속성을 본다
    expect(html).toMatch(/<input type="text"[^>]*aria-label="kP"[^>]*value="0.5"/)
    expect(html).not.toContain(LOCAL_DRAFT_ATTRIBUTE)
  })
})
