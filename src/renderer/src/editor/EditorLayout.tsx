import { useEffect } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { importStepFiles, isStepFileName } from '../cad/importStep'
import { isImporting } from '../cad/importStore'
import { openProjectFolder, saveProject } from '../project/projectActions'
import { useProjectStore } from '../project/projectStore'
import {
  initPlaySession,
  isKeyboardPadInput,
  playButton,
  stepPlay,
  togglePause
} from '../play/playActions'
import PlayDock from '../play/ui/PlayDock'
import ContextMenu from './ContextMenu'
import { isModalOpen } from './dialogStore'
import { useEditorStore, type EditorTool } from './editorStore'
import { isFlying } from './flyStore'
import { OBJECT_DRAG_TYPE } from './hierarchyDnd'
import { isChangeOpen, redo, undo } from './history'
import HierarchyPanel from './panels/HierarchyPanel'
import InspectorPanel from './panels/InspectorPanel'
import ScenePanel from './panels/ScenePanel'
import PreferencesWindow from './PreferencesWindow'
import ScriptPicker from './scripts/ScriptPicker'
import {
  createEmpty,
  createEmptyChild,
  createEmptyParent,
  cutSelection,
  deleteSelection,
  pasteCut,
  renameSelection,
  selectAll,
  toggleSelectedIsolation,
  toggleSelectedVisibility
} from './sceneCommands'
import { shortcutCommand, type ShortcutCommand } from './shortcuts'
import Toolbar from './Toolbar'
import { commitFocusedInput } from './useDraft'

const LAYOUT_ID = 'editor-main'
// 씬 뷰와 그 아래 패널(Console·텔레메트리·장치)
const SCENE_LAYOUT_ID = 'editor-scene'

const TOOLS: Partial<Record<ShortcutCommand, EditorTool>> = {
  toolView: 'view',
  toolTranslate: 'translate',
  toolRotate: 'rotate'
}

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'TEXTAREA' ||
      (target instanceof HTMLInputElement && target.type === 'text'))
  )
}

// 입력칸이나 인스펙터처럼 키를 직접 쓰는 곳에 포커스가 있으면 씬 단축키를 쓰지 않는다
function handlesOwnKeys(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
      target.closest('[data-local-keys]') !== null)
  )
}

// 단축키 명령 실행(키 → 명령 대응은 editor/shortcuts.ts의 shortcutCommand)
function runShortcut(command: ShortcutCommand): void {
  const editor = useEditorStore.getState()
  const tool = TOOLS[command]
  if (tool) {
    editor.setTool(tool)
    return
  }
  switch (command) {
    case 'save':
    case 'open':
      // 입력 중인 칸이 있으면 먼저 확정(blur)시킨다(씬 뷰의 포커스는 그대로: 키보드 게임패드가 꺼지지 않게)
      commitFocusedInput()
      void (command === 'save' ? saveProject() : openProjectFolder())
      return
    case 'undo':
      undo()
      return
    case 'redo':
      redo()
      return
    case 'createEmpty':
      createEmpty()
      return
    case 'createEmptyChild':
      createEmptyChild()
      return
    case 'createEmptyParent':
      createEmptyParent()
      return
    case 'rename':
      renameSelection()
      return
    case 'focus':
      // F: 선택 전체에 카메라 맞추기 (Unity와 같은 키)
      editor.focusSelection()
      return
    case 'toggleHandleSpace':
      editor.setHandleSpace(editor.handleSpace === 'global' ? 'local' : 'global')
      return
    case 'delete':
      void deleteSelection()
      return
    case 'selectAll':
      selectAll()
      return
    case 'cut':
      cutSelection()
      return
    case 'paste':
    case 'pasteAsChild':
      pasteCut(command === 'pasteAsChild')
      return
    case 'search': {
      // 하이어라키 검색칸(HierarchyPanel)으로 옮기고 글자를 고른다(Unity Ctrl+F)
      const input = document.querySelector<HTMLInputElement>('[data-hierarchy-search]')
      input?.focus()
      input?.select()
      return
    }
    case 'toggleVisibility':
      toggleSelectedVisibility()
      return
    case 'isolate':
      toggleSelectedIsolation()
      return
    case 'play':
      // INIT은 저장을 물을 수 있으므로 입력 중인 칸은 playActions가 먼저 확정한다
      playButton()
      return
    case 'pause':
      togglePause()
      return
    case 'step':
      stepPlay()
      return
  }
}

// 창 전체 단축키와 파일 드래그 앤 드롭
function useEditorShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const result = shortcutCommand(event, {
        // 대화상자·우클릭 메뉴가 떠 있거나 씬 뷰에서 비행 중(우클릭+WASD/QE)이면 편집기 단축키를 쓰지 않는다
        blocked: isModalOpen() || isFlying(),
        handlesOwnKeys: handlesOwnKeys(event.target),
        pendingTextEdit: isTextInput(event.target) && useProjectStore.getState().pendingEdit,
        // 핸들을 드래그하는 중에는 실행 취소·삭제·도구 전환·만들기를 하지 않는다(드래그가 어긋난다)
        dragging: isChangeOpen(),
        // 실행 중 씬 뷰에 포커스가 있으면 키보드가 게임패드다(키보드 패드 리스너도 같은 판단을 쓴다). 게임패드로 누른
        // 키의 반복 입력도 뗄 때까지 게임패드의 것이다
        keyboardGamepad: isKeyboardPadInput(event)
      })
      if (result.preventDefault) event.preventDefault()
      if (result.command) runShortcut(result.command)
    }
    // 파일을 창에 놓으면 Electron은 기본으로 그 파일로 페이지를 이동하므로 막는다.
    // 하이어라키 행 드래그(내부 형식)는 하이어라키만 받는다. 다른 곳에서는 놓을 수 없게 둔다.
    const isObjectDrag = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes(OBJECT_DRAG_TYPE) ?? false
    const onDragOver = (event: DragEvent): void => {
      if (!isObjectDrag(event)) event.preventDefault()
    }
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      if (isObjectDrag(event)) return
      // 대화상자·메뉴가 떠 있거나 다른 STEP을 불러오는 중이면(큰 STEP은 메모리를 많이 쓴다) 받지 않는다.
      // [STEP 불러오기] 버튼도 같은 조건으로 막힌다.
      if (isModalOpen() || isImporting() || useProjectStore.getState().busy) return
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        isStepFileName(file.name)
      )
      void importStepFiles(files)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
}

function EditorLayout(): React.JSX.Element {
  // 패널 크기는 개인 UI 설정이므로 localStorage에 저장한다.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: LAYOUT_ID,
    storage: localStorage
  })
  const sceneLayout = useDefaultLayout({ id: SCENE_LAYOUT_ID, storage: localStorage })
  useEditorShortcuts()
  // 실행(Play): 메인의 PlayEvent 구독, 프로젝트를 바꾸면 STOP, OpMode 목록(한 번만, StrictMode 재실행에도 그대로)
  useEffect(() => {
    initPlaySession()
  }, [])

  return (
    <div className="editor">
      <Toolbar />
      <Group
        id={LAYOUT_ID}
        className="editor-panels"
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel id="hierarchy" defaultSize="20%" minSize={160}>
          <HierarchyPanel />
        </Panel>
        <Separator className="panel-separator" />
        <Panel id="scene" minSize={320}>
          <Group
            id={SCENE_LAYOUT_ID}
            className="editor-scene-column"
            orientation="vertical"
            defaultLayout={sceneLayout.defaultLayout}
            onLayoutChanged={sceneLayout.onLayoutChanged}
          >
            <Panel id="scene-view" minSize={160}>
              <ScenePanel />
            </Panel>
            <Separator className="panel-separator panel-separator--row" />
            <Panel id="play-dock" defaultSize="28%" minSize={90}>
              <PlayDock />
            </Panel>
          </Group>
        </Panel>
        <Separator className="panel-separator" />
        <Panel id="inspector" defaultSize="25%" minSize={220}>
          <InspectorPanel />
        </Panel>
      </Group>
      <ContextMenu />
      <ScriptPicker />
      <PreferencesWindow />
    </div>
  )
}

export default EditorLayout
