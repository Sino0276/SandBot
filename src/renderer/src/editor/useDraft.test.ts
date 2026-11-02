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
import { shortcutCommand, type ShortcutState } from './shortcuts'
import {
  commitFocusedInput,
  hasPendingTextEdit,
  LOCAL_DRAFT_ATTRIBUTE,
  localDraftProps
} from './useDraft'

// 저장·열기·INIT 전의 입력칸 확정(commitFocusedInput)과 Ctrl+Z를 입력칸에 맡길지(hasPendingTextEdit). Node에는 DOM이
// 없어 요소와 창은 가짜다.

type FakeElement = {
  tagName: string
  type?: string
  isContentEditable: boolean
  blur: ReturnType<typeof vi.fn>
  hasAttribute: (name: string) => boolean
}

function element(
  tagName: string,
  options: { editable?: boolean; sceneView?: boolean; type?: string; localDraft?: boolean } = {}
): FakeElement {
  return {
    tagName,
    type: options.type,
    isContentEditable: options.editable ?? false,
    blur: vi.fn(),
    hasAttribute: (name: string) =>
      (options.sceneView === true && name === SCENE_VIEW_ATTRIBUTE) ||
      (options.localDraft === true && name === LOCAL_DRAFT_ATTRIBUTE)
  }
}

describe('hasPendingTextEdit(Ctrl+Z를 입력칸에 맡길지)', () => {
  const pending = (target: FakeElement | null, pendingEdit: boolean): boolean =>
    hasPendingTextEdit(target as unknown as EventTarget | null, pendingEdit)
  const ctrlZ = {
    code: 'KeyZ',
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false
  }
  const state = (pendingTextEdit: boolean): ShortcutState => ({
    blocked: false,
    handlesOwnKeys: true,
    pendingTextEdit,
    dragging: false,
    keyboardGamepad: false
  })

  it('인스펙터 입력칸의 문서 초안(useDraft → pendingEdit)이 있으면 입력칸의 실행 취소다', () => {
    expect(pending(element('INPUT', { type: 'text' }), true)).toBe(true)
    expect(pending(element('TEXTAREA'), true)).toBe(true)
    expect(pending(element('DIV', { editable: true }), true)).toBe(true)
    // 글자 입력칸이 아니거나 초안이 없으면 씬의 실행 취소다
    expect(pending(element('INPUT', { type: 'checkbox' }), true)).toBe(false)
    expect(pending(element('BUTTON'), true)).toBe(false)
    expect(pending(element('INPUT', { type: 'text' }), false)).toBe(false)
    expect(pending(null, true)).toBe(false)
  })

  it('Config 탭 값처럼 문서 밖 값의 초안(속성)도 입력칸의 실행 취소다(창 닫기 확인은 켜지 않는다)', () => {
    const typing = element('INPUT', { type: 'text', localDraft: true })
    expect(pending(typing, false)).toBe(true)
    expect(shortcutCommand(ctrlZ, state(pending(typing, false)))).toEqual({
      command: null,
      preventDefault: false
    })
    // 아직 글자를 바꾸지 않았으면 Unity처럼 씬의 실행 취소다
    const idle = element('INPUT', { type: 'text' })
    expect(shortcutCommand(ctrlZ, state(pending(idle, false)))).toEqual({
      command: 'undo',
      preventDefault: true
    })
    expect(localDraftProps('0.75')).toEqual({ [LOCAL_DRAFT_ATTRIBUTE]: '' })
    expect(localDraftProps(null)).toEqual({})
  })
})

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
