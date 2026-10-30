import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import ko from '../../i18n/locales/ko'
import { useProjectStore } from '../../project/projectStore'
import { EMPTY_REGISTERED_LIST, newRun, usePlayStore, type PlayRun } from '../playStore'
import PlayControls from './PlayControls'

// 툴바 실행 버튼의 글자·도움말·막힘(renderToStaticMarkup, DOM 없음). 흐름은 playActions.test.ts가 확인한다.

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

const AUTO: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.RedAuto',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/RedAuto.java',
  line: 3,
  flavor: 'Autonomous',
  name: 'Red Auto',
  group: '',
  preselectTeleOp: ''
}

function withList(): void {
  setStore(useProjectStore, { root: '/p', busy: false })
  setStore(usePlayStore, {
    opModeList: {
      root: '/p',
      status: 'ready',
      opModes: [AUTO],
      registrars: [],
      registered: EMPTY_REGISTERED_LIST,
      truncated: false,
      hasTeamCode: true,
      detail: ''
    },
    selectedClass: AUTO.className,
    run: null,
    paused: false
  })
}

function run(patch: Partial<PlayRun>): PlayRun {
  return {
    ...newRun({
      runId: 'r',
      root: '/p',
      opMode: AUTO,
      robotId: null,
      configPath: null,
      speed: 1,
      paused: false
    }),
    accepted: true,
    ...patch
  }
}

describe('툴바 실행 버튼', () => {
  it('프로젝트가 없으면 INIT을 막고 이유를 도움말로 보인다', () => {
    setStore(useProjectStore, { root: null })
    const html = renderToStaticMarkup(<PlayControls />)
    expect(html).toContain('>INIT</span>')
    expect(html).toContain(`title="${ko.play.disabled.noProject}"`)
    expect(html).toMatch(/aria-label="INIT"[^>]*disabled=""/)
  })

  it('고른 OpMode가 있으면 INIT(단축키 Ctrl+P), Autonomous는 30초부터', () => {
    withList()
    const html = renderToStaticMarkup(<PlayControls />)
    expect(html).toContain(
      'title="INIT: 저장한 TeamCode를 컴파일해 OpMode를 초기화합니다 (Ctrl+P)"'
    )
    expect(html).toContain('Red Auto')
    expect(html).toContain('00:30.000')
    // 일시 정지 중이 아니면 한 단계는 막힌다
    expect(html).toMatch(/aria-label="한 단계"[^>]*disabled=""/)
  })

  it('init이면 START와 작은 STOP, running이면 STOP, 일시 정지 중이면 한 단계를 쓸 수 있다', () => {
    withList()
    setStore(usePlayStore, { run: run({ phase: 'init' }) })
    let html = renderToStaticMarkup(<PlayControls />)
    expect(html).toContain('>START</span>')
    expect(html).toContain(`aria-label="${ko.play.stopInit}"`)
    expect(html).toContain('is-active')

    setStore(usePlayStore, {
      run: run({
        phase: 'running',
        status: { tNanos: 5e9, paused: true, speed: 1, realtime: 0, startedNanos: 2e9 }
      }),
      paused: true
    })
    html = renderToStaticMarkup(<PlayControls />)
    expect(html).toContain('>STOP</span>')
    expect(html).not.toContain(`aria-label="${ko.play.stopInit}"`)
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toMatch(/aria-label="한 단계"[^>]*disabled=""/)
    // START 뒤 2초: 28초 남음
    expect(html).toContain('00:28.000')
  })

  it('컴파일 중에는 단계를, 따라가지 못하면 느림을 보인다', () => {
    withList()
    setStore(usePlayStore, { run: run({ phase: 'compiling' }) })
    expect(renderToStaticMarkup(<PlayControls />)).toContain(ko.play.phase.compiling)
    setStore(usePlayStore, {
      run: run({
        phase: 'running',
        status: { tNanos: 1e9, paused: false, speed: 1, realtime: 0.5, startedNanos: 0 }
      })
    })
    expect(renderToStaticMarkup(<PlayControls />)).toContain('느림 0.5×')
  })
})
