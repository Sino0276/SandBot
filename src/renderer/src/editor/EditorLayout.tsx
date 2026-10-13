import { useEffect } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { importStepFile, isStepFileName } from '../cad/importStep'
import { openProjectFolder, saveProject } from '../project/projectActions'
import { useSceneStore } from '../scene/sceneStore'
import { useDialogStore } from './dialogStore'
import { useEditorStore } from './editorStore'
import HierarchyPanel from './panels/HierarchyPanel'
import InspectorPanel from './panels/InspectorPanel'
import ScenePanel from './panels/ScenePanel'
import Toolbar from './Toolbar'

const LAYOUT_ID = 'editor-main'

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

// 창 전체 단축키와 파일 드래그 앤 드롭
function useEditorShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (useDialogStore.getState().request) return
      const command = event.ctrlKey || event.metaKey
      // Ctrl/Cmd+S 저장, Ctrl/Cmd+O 열기. 입력 중인 숫자칸이 있으면 먼저 확정(blur)시킨다.
      if (command && !event.altKey && (event.key === 's' || event.key === 'o')) {
        event.preventDefault()
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        void (event.key === 's' ? saveProject() : openProjectFolder())
        return
      }
      if (isTextInput(event.target) || command || event.altKey) return
      // F: 선택한 오브젝트에 카메라 맞추기 (Unity와 같은 키)
      if (event.key === 'f' || event.key === 'F') {
        const { selectedId, focus } = useEditorStore.getState()
        if (selectedId) focus(selectedId)
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
