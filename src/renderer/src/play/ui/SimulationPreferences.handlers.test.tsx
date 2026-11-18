import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAY_SETTINGS, type RendererPlaySettings } from '../playSettings'

// 환경 설정 › 시뮬레이션의 처리기(B8, spec-4c §1.6). DOM이 없으므로 훅을 가짜로 바꾸고 컴포넌트를 함수로 불러 나온 요소
// 나무에서 센서 잡음 체크 칸을 찾아 onChange를 부른다(NumberField 같은 자식 컴포넌트는 부르지 않는다).

const state = vi.hoisted(() => ({
  settings: null as RendererPlaySettings | null,
  updateSettings: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('../playStore', () => ({
  usePlayStore: <T,>(selector: (s: typeof state) => T): T => selector(state)
}))

const { default: SimulationPreferences } = await import('./SimulationPreferences')

type Element = ReactElement<Record<string, unknown>>

// 요소 나무를 깊이 우선으로 훑는다(함수 컴포넌트는 펼치지 않는다)
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

// 자식 글자에 text가 바로 있는 label
const labelWith = (tree: ReactNode, text: string): Element | undefined =>
  elements(tree).find((element) => {
    const children = element.props.children
    return element.type === 'label' && Array.isArray(children) && children.includes(text)
  })

describe('SimulationPreferences 처리기', () => {
  it('B8: 센서 잡음 체크가 updateSettings({ sensorNoise })를 부르고 도움말이 있다', () => {
    for (const checked of [true, false]) {
      state.settings = { ...DEFAULT_PLAY_SETTINGS, sensorNoise: !checked }
      state.updateSettings.mockClear()
      const label = labelWith(SimulationPreferences(), 'preferences.simulation.sensorNoise')
      expect(label).toBeDefined()
      expect(label!.props.title).toBe('preferences.simulation.sensorNoiseHint')
      const input = elements(label!.props.children as ReactNode).find((e) => e.type === 'input')!
      expect(input.props.checked).toBe(!checked)
      ;(input.props.onChange as (event: unknown) => void)({ target: { checked } })
      expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({ sensorNoise: checked })
    }
    // 도움말 줄 하나
    const notes = elements(SimulationPreferences()).filter(
      (element) => element.props.children === 'preferences.simulation.sensorNoiseHint'
    )
    expect(notes).toHaveLength(1)
  })

  it('6a: 경기 요소 체크가 updateSettings({ gameElements })를 부르고 도움말이 있다', () => {
    for (const checked of [true, false]) {
      state.settings = { ...DEFAULT_PLAY_SETTINGS, gameElements: !checked }
      state.updateSettings.mockClear()
      const label = labelWith(SimulationPreferences(), 'preferences.simulation.gameElements')
      expect(label).toBeDefined()
      expect(label!.props.title).toBe('preferences.simulation.gameElementsHint')
      const input = elements(label!.props.children as ReactNode).find((e) => e.type === 'input')!
      expect(input.props.checked).toBe(!checked)
      ;(input.props.onChange as (event: unknown) => void)({ target: { checked } })
      expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({ gameElements: checked })
    }
  })
})
