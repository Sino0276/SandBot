import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import ko from '../../i18n/locales/ko'
import { newRun, usePlayStore } from '../playStore'
import TelemetryView from './TelemetryView'

// 텔레메트리 탭(renderToStaticMarkup, DOM 없음): DS 화면과 그 아래 FTC Dashboard 텔레메트리. 팀 코드의 HTML은 그리지
// 않고 글자로 보인다.

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

const DEBUGGER: OpModeInfo = {
  className: 'MecanumMotorDirectionDebugger',
  path: '',
  line: 0,
  flavor: 'TeleOp',
  name: 'MecanumMotorDirectionDebugger',
  group: '',
  preselectTeleOp: ''
}

// Road Runner quickstart의 MecanumMotorDirectionDebugger: MultipleTelemetry(DS + Dashboard)에 HTML 형식으로 쓴다
const LINES = [
  'Press each button to turn on its respective motor',
  '<font face="monospace">Xbox/PS4 Button - Motor</font>',
  '<font face="monospace">&nbsp;&nbsp;X / ▢&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- Front Left</font>'
]

function render(): string {
  const run = newRun({
    runId: 'r',
    root: '/p',
    opMode: DEBUGGER,
    robotId: null,
    configPath: null,
    speed: 1,
    paused: false
  })
  setStore(usePlayStore, {
    run: {
      ...run,
      phase: 'running',
      telemetry: { tNanos: 0, frame: { lines: LINES, log: [], format: 'html' } }
    },
    dash: {
      runId: 'r',
      tNanos: 0,
      values: new Map([['<b>x</b> &lt; 5', '1 &amp; <i>2</i>']]),
      log: LINES
    }
  })
  return renderToStaticMarkup(<TelemetryView />)
}

const NBSP = '\u00a0'

const sections = (html: string): { ds: string; dashboard: string } => {
  const at = html.indexOf('telemetry-dashboard')
  expect(at).toBeGreaterThan(0)
  return { ds: html.slice(0, at), dashboard: html.slice(at) }
}

describe('텔레메트리 탭', () => {
  it('Dashboard 텔레메트리도 DS 화면처럼 팀 HTML을 글자로 보인다(그리지 않는다)', () => {
    const { ds, dashboard } = sections(render())
    // &nbsp;는 줄바꿈 없는 공백(U+00A0)
    const readable = `${NBSP.repeat(2)}X / ▢${NBSP.repeat(8)}- Front Left`
    expect(ds).toContain(readable)
    // Dashboard 웹 클라이언트는 값과 로그를 늘 HTML로 읽는다
    expect(dashboard).toContain(readable)
    expect(dashboard).toContain('Xbox/PS4 Button - Motor')
    expect(dashboard).not.toContain('&amp;nbsp;')
    expect(dashboard).not.toContain('&lt;font')
    // 키도 HTML로 읽는다(`${key}: ${value}<br />`)
    expect(dashboard).toContain('x &lt; 5: </span>1 &amp; 2')
    // 팀의 태그가 HTML 요소로 들어가지 않는다
    expect(dashboard).not.toContain('<font')
    expect(dashboard).not.toContain('<i>')
  })
})
