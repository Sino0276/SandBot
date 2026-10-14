import { useEffect } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { importStepFile, isStepFileName } from '../cad/importStep'
import { openProjectFolder, saveProject } from '../project/projectActions'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import { useDialogStore } from './dialogStore'
import { useEditorStore, type EditorTool } from './editorStore'
import { isFlying } from './flyStore'
import { isChangeOpen, redo, undo } from './history'
import HierarchyPanel from './panels/HierarchyPanel'
import InspectorPanel from './panels/InspectorPanel'
import ScenePanel from './panels/ScenePanel'
import Toolbar from './Toolbar'

const LAYOUT_ID = 'editor-main'

const TOOL_KEYS: Partial<Record<string, EditorTool>> = {
  KeyQ: 'view',
  KeyW: 'translate',
  KeyE: 'rotate'
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

// 창 전체 단축키와 파일 드래그 앤 드롭
function useEditorShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 대화상자가 떠 있거나 씬 뷰에서 비행 중(우클릭+WASD/QE)이면 편집기 단축키를 쓰지 않는다
      if (useDialogStore.getState().request || isFlying()) return
      const command = event.ctrlKey || event.metaKey
      // 문자 단축키는 키 위치(event.code)로 받는다. 한글 입력 상태에서도 같은 키로 동작한다.
      const code = event.code
      // Ctrl/Cmd+S 저장, Ctrl/Cmd+O 열기. 입력 중인 숫자칸이 있으면 먼저 확정(blur)시킨다.
      if (command && !event.altKey && (code === 'KeyS' || code === 'KeyO')) {
        event.preventDefault()
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        void (code === 'KeyS' ? saveProject() : openProjectFolder())
        return
      }
      // 핸들을 드래그하는 중에는 실행 취소·삭제·도구 전환을 하지 않는다(드래그가 어긋난다)
      const dragging = isChangeOpen()
      // Ctrl/Cmd+Z 실행 취소, Ctrl/Cmd+Shift+Z·Ctrl+Y 다시 실행.
      // 입력칸에 확정하지 않은 글자가 있을 때만 입력칸 자체의 실행 취소에 맡긴다.
      if (command && !event.altKey && (code === 'KeyZ' || code === 'KeyY')) {
        if (isTextInput(event.target) && useProjectStore.getState().pendingEdit) return
        event.preventDefault()
        if (dragging) return
        if (code === 'KeyY' || event.shiftKey) redo()
        else undo()
        return
      }
      if (handlesOwnKeys(event.target) || command || event.altKey || dragging) return
      // 키를 누르고 있어 반복되는 입력(예: 비행 중 Q를 누른 채 우클릭을 먼저 놓은 경우)은 도구를 바꾸지 않는다
      if (event.repeat && code !== 'Delete' && code !== 'Backspace') return
      // F: 선택한 오브젝트에 카메라 맞추기 (Unity와 같은 키)
      if (code === 'KeyF') {
        const { selectedId, focus } = useEditorStore.getState()
        if (selectedId) focus(selectedId)
        return
      }
      // Q 손, W 이동, E 회전 (Unity와 같은 키)
      const tool = TOOL_KEYS[code]
      if (tool && !event.shiftKey) {
        useEditorStore.getState().setTool(tool)
        return
      }
      // X: 핸들 축 전역/로컬 전환 (Unity와 같은 키)
      if (code === 'KeyX' && !event.shiftKey) {
        const { handleSpace, setHandleSpace } = useEditorStore.getState()
        setHandleSpace(handleSpace === 'global' ? 'local' : 'global')
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const { selectedId, select } = useEditorStore.getState()
        if (!selectedId) return
        event.preventDefault()
        select(null)
        useSceneStore.getState().removeObject(selectedId)
      }
    }
    // 파일을 창에 놓으면 Electron은 기본으로 그 파일로 페이지를 이동하므로 막는다
    const onDragOver = (event: DragEvent): void => event.preventDefault()
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        isStepFileName(file.name)
      )
      for (const file of files) void importStepFile(file)
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
  useEditorShortcuts()

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
          <ScenePanel />
        </Panel>
        <Separator className="panel-separator" />
        <Panel id="inspector" defaultSize="25%" minSize={220}>
          <InspectorPanel />
        </Panel>
      </Group>
    </div>
  )
}

export default EditorLayout
