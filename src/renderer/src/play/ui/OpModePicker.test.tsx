import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import ko from '../../i18n/locales/ko'
import { useProjectStore } from '../../project/projectStore'
import { EMPTY_REGISTERED_LIST, usePlayStore, type RegisteredListState } from '../playStore'
import OpModePicker, { OpModePopup } from './OpModePicker'

// OpMode 고르기 목록의 '등록기 OpMode 읽기…' 줄(renderToStaticMarkup, DOM 없음). 고른 뒤의 흐름(대화상자·기억·다시 읽기)은
// playActions.test.ts가 확인한다.

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

const DRIVE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 3,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

const WAITING: RegisteredListState = {
  ...EMPTY_REGISTERED_LIST,
  status: 'ready',
  needsConsent: true
}

function withList(opModes: OpModeInfo[], registered: RegisteredListState): void {
  setStore(useProjectStore, { root: '/p', busy: false })
  setStore(usePlayStore, {
    opModeList: {
      root: '/p',
      status: 'ready',
      opModes,
      registrars: [
        {
          className: 'org.firstinspires.ftc.teamcode.TuningOpModes',
          path: 'src/main/java/org/firstinspires/ftc/teamcode/TuningOpModes.java',
          line: 9
        }
      ],
      registered,
      truncated: false,
      hasTeamCode: true,
      detail: ''
    },
    selectedClass: null,
    run: null
  })
}

const popup = (): string =>
  renderToStaticMarkup(
    <OpModePopup anchor={{ left: 0, top: 0, bottom: 20, width: 200 }} onClose={() => {}} />
  )

describe("OpMode 고르기의 '등록기 OpMode 읽기…' 줄", () => {
  it('동의를 기다리면 OpMode 줄 뒤에 같은 목록 줄(option)로 보이고, 이 PC에서 코드를 실행한다고 알린다', () => {
    withList([DRIVE], WAITING)
    const html = popup()
    expect(html).toContain(ko.play.list.registeredConsent)
    expect(html).toContain(ko.play.list.registeredConsentHint)
    // 키보드로 가는 줄: Drive(0) 다음 읽기 줄(1)
    expect(html).toMatch(
      /id="opmode-option-1"[^>]*role="option"[^>]*class="opmode-option opmode-action"/
    )
    expect(html).toContain('aria-activedescendant="opmode-option-0"')
    // 오류·문제 줄이 아니다
    expect(html).not.toContain('opmode-problem')
    expect(html).not.toContain(ko.play.list.registeredLoading)
  })

  it('OpMode가 없어도 비었다고 하지 않고 읽기 줄이 첫 줄이다', () => {
    withList([], WAITING)
    const html = popup()
    expect(html).not.toContain(ko.play.list.empty)
    expect(html).toMatch(/id="opmode-option-0"[^>]*class="opmode-option opmode-action is-active"/)
    expect(html).toContain('aria-activedescendant="opmode-option-0"')
    // 툴바 버튼도 'OpMode 없음'이 아니다
    const button = renderToStaticMarkup(<OpModePicker />)
    expect(button).toContain(ko.play.chooseOpMode)
    expect(button).not.toContain(ko.play.noOpModes)
  })

  it('믿은 프로젝트(동의를 기다리지 않음)·읽는 중에는 줄이 없다', () => {
    withList([DRIVE], { ...EMPTY_REGISTERED_LIST, status: 'ready' })
    expect(popup()).not.toContain(ko.play.list.registeredConsent)
    withList([DRIVE], { ...WAITING, status: 'loading' })
    const loading = popup()
    expect(loading).not.toContain(ko.play.list.registeredConsent)
    expect(loading).toContain(ko.play.list.registeredLoading)
    withList([], { ...EMPTY_REGISTERED_LIST, status: 'ready' })
    expect(renderToStaticMarkup(<OpModePicker />)).toContain(ko.play.noOpModes)
  })

  it('기억하지 못한 이유는 줄과 함께 목록 아래 한 줄로 보인다', () => {
    withList([DRIVE], {
      ...WAITING,
      status: 'failed',
      problem: { kind: 'failed', code: 'failed', detail: 'gone' }
    })
    const html = popup()
    expect(html).toContain(ko.play.list.registeredConsent)
    expect(html).toContain('opmode-problem')
  })
})
