import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { LOCAL_DRAFT_ATTRIBUTE } from '../../editor/useDraft'
import ko from '../../i18n/locales/ko'
import { newRun, usePlayStore, type PlayRun } from '../playStore'
import ConfigView from './ConfigView'

// 설정값(Config) 탭(renderToStaticMarkup, DOM 없음): 빈 화면 문구와 값 칸. 트리와 [파일에 반영]은 dashConfigModel.test.ts,
// 입력 흐름은 playActions·dashConfigApply 시험이 확인한다.

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

const TELEOP: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 3,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

function run(patch: Partial<PlayRun>): PlayRun {
  return {
    ...newRun({
      runId: 'r',
      root: '/p',
      opMode: TELEOP,
      robotId: null,
      configPath: null,
      speed: 1,
      paused: false
    }),
    accepted: true,
    ...patch
  }
}

describe('Config 탭의 빈 화면', () => {
  it('실행이 없으면 실행하라는 안내', () => {
    setStore(usePlayStore, { run: null, dashConfig: null })
    expect(renderToStaticMarkup(<ConfigView />)).toContain(ko.config.noRun)
  })

  it('실행 중 트리가 아직 오지 않았으면(INIT에서 일시 정지 등) 변수가 없다고 하지 않고 기다린다', () => {
    for (const phase of ['compiling', 'init', 'running'] as const) {
      setStore(usePlayStore, { run: run({ phase }), dashConfig: null })
      const html = renderToStaticMarkup(<ConfigView />)
      expect(html, phase).toContain(ko.config.waiting)
      expect(html, phase).not.toContain(ko.config.empty)
    }
  })

  it('트리 없이 끝난 실행은 변수가 없던 실행이다', () => {
    setStore(usePlayStore, { run: run({ phase: 'finished' }), dashConfig: null })
    expect(renderToStaticMarkup(<ConfigView />)).toContain(ko.config.empty)
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

describe('설정값 탭의 값 칸', () => {
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
