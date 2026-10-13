import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import HierarchyPanel from './panels/HierarchyPanel'
import InspectorPanel from './panels/InspectorPanel'
import ScenePanel from './panels/ScenePanel'
import Toolbar from './Toolbar'

const LAYOUT_ID = 'editor-main'

function EditorLayout(): React.JSX.Element {
  // 패널 크기는 개인 UI 설정이므로 localStorage에 저장한다.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: LAYOUT_ID,
    storage: localStorage
  })

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
