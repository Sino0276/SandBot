import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import ko from '../../i18n/locales/ko'
import { sourceFromRead, useJavaSourcesStore } from '../../java/javaSources'
import { useLineSupportStore, type LineSupport } from '../../java/openScript'
import { useProjectStore } from '../../project/projectStore'
import TunablesList from './TunablesList'

// 튜닝 값 칸 이름의 도움말(renderToStaticMarkup, DOM 없음). 값 편집 규칙은 java/tunableEdits.test.ts가 확인한다.

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다. 그 객체에도 같은 값을 넣고 끝나면 되돌린다.
type TestStore<T> = {
  getInitialState: () => T
  setState: (patch: Partial<T>) => void
}
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

const PATH = 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'
const TEXT = `package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.config.Config;

@Config
public class Lift {
    public static double KP = 0.5;
}
`

function render(support: LineSupport): string {
  setStore(useProjectStore, { root: '/p', session: 1 })
  setStore(useJavaSourcesStore, {
    root: '/p',
    session: 1,
    files: { [PATH]: sourceFromRead({ ok: true, text: TEXT, hash: 'h', editable: true }) }
  })
  setStore(useLineSupportStore, { support })
  return renderToStaticMarkup(<TunablesList path={PATH} />)
}

describe('튜닝 값 칸 이름의 도움말', () => {
  it('더블클릭하면 그 줄을 연다고 알리고, 지금 편집기가 줄 번호를 받지 않으면 파일만 연다고 덧붙인다', () => {
    const fieldHint = 'double KP · 7번째 줄. 더블클릭하면 이 줄을 외부 스크립트 편집기로 엽니다.'
    for (const support of ['unknown', 'yes'] as const) {
      const html = render(support)
      expect(html).toContain(`title="${fieldHint}"`)
      expect(html).not.toContain(ko.usages.noLineHint)
    }
    expect(render('no')).toContain(`title="${fieldHint}\n${ko.usages.noLineHint}"`)
  })
})
