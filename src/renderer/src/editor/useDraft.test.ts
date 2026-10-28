import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../shared/play'
import {
  createKeyboardPad,
  installKeyboardGamepad,
  keyboardPadActive,
  SCENE_VIEW_ATTRIBUTE,
  useKeyboardPadStore
} from '../play/keyboardGamepad'
import { newRun, usePlayStore } from '../play/playStore'
import { commitFocusedInput } from './useDraft'

// 저장·열기·INIT 전의 입력칸 확정(commitFocusedInput). Node에는 DOM이 없어 요소와 창은 가짜다.

type FakeElement = {
  tagName: string
  isContentEditable: boolean
  blur: ReturnType<typeof vi.fn>
  hasAttribute: (name: string) => boolean
}

function element(
  tagName: string,
  options: { editable?: boolean; sceneView?: boolean } = {}
): FakeElement {
  return {
    tagName,
    isContentEditable: options.editable ?? false,
    blur: vi.fn(),
    hasAttribute: (name: string) => options.sceneView === true && name === SCENE_VIEW_ATTRIBUTE
  }
}

const commit = (target: FakeElement | null): void =>
  commitFocusedInput(target as unknown as Element | null)

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

describe('commitFocusedInput', () => {
  afterEach(() => {
    usePlayStore.setState({ run: null })
    useKeyboardPadStore.setState({ slot: null, focused: false })
  })

  it('입력칸(input·textarea·contentEditable)만 blur해 확정하고, 다른 요소는 포커스를 그대로 둔다', () => {
    for (const target of [
      element('INPUT'),
      element('TEXTAREA'),
      element('DIV', { editable: true })
    ]) {
      commit(target)
      expect(target.blur).toHaveBeenCalledTimes(1)
    }
    for (const target of [element('BUTTON'), element('DIV'), element('DIV', { sceneView: true })]) {
      commit(target)
      expect(target.blur).not.toHaveBeenCalled()
    }
    expect(() => commit(null)).not.toThrow()
  })

  it('W를 누른 채 Ctrl+S: 씬 뷰의 포커스를 빼지 않아 키보드 게임패드가 꺼지지 않는다', () => {
    usePlayStore.setState({
      run: newRun({
        runId: 'r1',
        root: '/p',
        opMode: OP_MODE,
        robotId: null,
        configPath: null,
        speed: 1,
        paused: false
      })
    })
    useKeyboardPadStore.setState({ slot: 0, focused: true })
    const listeners = new Map<string, ((event: never) => void)[]>()
    const fire = (type: string, event: object): void => {
      for (const listener of listeners.get(type) ?? [])
        listener({ preventDefault: () => {}, ...event } as never)
    }
    const pad = createKeyboardPad(keyboardPadActive)
    installKeyboardGamepad(pad, {
      addEventListener: ((type: string, listener: (event: never) => void) =>
        listeners.set(type, [
          ...(listeners.get(type) ?? []),
          listener
        ])) as unknown as Window['addEventListener']
    })
    // 씬 뷰를 blur하면 브라우저처럼 focusout이 창까지 올라간다
    const sceneView = element('DIV', { sceneView: true })
    sceneView.blur.mockImplementation(() => fire('focusout', { target: sceneView }))
    fire('keydown', {
      code: 'KeyW',
      key: 'w',
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false
    })

    commit(sceneView)
    expect(sceneView.blur).not.toHaveBeenCalled()
    expect(useKeyboardPadStore.getState().focused).toBe(true)
    expect(keyboardPadActive()).toBe(true)
    expect(pad.state().left_stick_y).toBe(-1)
  })
})
