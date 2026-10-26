import { Canvas } from '@react-three/fiber'
import { useTranslation } from 'react-i18next'
import { isRecentHandleInteraction, useEditorStore, type HandleSpace } from '../editorStore'
import { useFlyStore } from '../flyStore'
import { exitIsolation, useSceneVisibilityStore } from '../sceneVisibility'
import { shortcutLabel } from '../shortcuts'
import PanelFrame from '../PanelFrame'
import FieldFloor from '../scene/FieldFloor'
import EditorCameraControls from '../scene/EditorCameraControls'
import FocusController from '../scene/FocusController'
import FrameAxes from '../scene/FrameAxes'
import ImuIndicators from '../scene/ImuIndicators'
import { FIELD_VIEW_POSITION } from '../scene/frameHooks'
import SceneObjectsView from '../scene/SceneObjectsView'
import TransformHandles from '../scene/TransformHandles'
import ViewGizmo from '../scene/ViewGizmo'
import SegmentedControl from '../SegmentedControl'
import ToolButtons from '../ToolButtons'
import { useUnitStore } from '../../units/unitStore'
import { formatLength } from '../../units/units'

function ScenePanel(): React.JSX.Element {
  const { t } = useTranslation()
  const handleSpace = useEditorStore((state) => state.handleSpace)
  const setHandleSpace = useEditorStore((state) => state.setHandleSpace)
  const tool = useEditorStore((state) => state.tool)
  const flying = useFlyStore((state) => state.flying)
  const flySpeed = useFlyStore((state) => state.speed)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const select = useEditorStore((state) => state.select)
  const isolated = useSceneVisibilityStore((state) => state.isolated !== null)

  const actions = (
    <>
      <ToolButtons />
      <SegmentedControl<HandleSpace>
        label={t('scene.handleSpace')}
        value={handleSpace}
        options={[
          { value: 'global', label: t('scene.global') },
          { value: 'local', label: t('scene.local') }
        ]}
        onChange={setHandleSpace}
      />
    </>
  )

  return (
    <PanelFrame title={t('panels.scene')} actions={actions} fill>
      {/* 에디터는 대부분 정지 화면이므로 변경이 있을 때만 다시 그린다 */}
      <Canvas
        frameloop="demand"
        // 손 도구(Q)에서는 손 모양 커서
        style={{ cursor: tool === 'view' ? 'grab' : undefined }}
        camera={{ position: FIELD_VIEW_POSITION, fov: 50, near: 0.01, far: 200 }}
        onPointerMissed={(event) => {
          // 우클릭(둘러보기)을 놓을 때의 contextmenu는 빗나간 클릭으로 치지 않는다
          if (event.type === 'click' && !isRecentHandleInteraction()) select(null)
        }}
      >
        <color attach="background" args={['#1e1f22']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, -2, 5]} intensity={1.2} />
        <FieldFloor />
        <SceneObjectsView />
        <FrameAxes />
        <ImuIndicators />
        <TransformHandles />
        <EditorCameraControls />
        <FocusController />
        <ViewGizmo />
      </Canvas>
      {isolated && (
        <div className="isolation-banner" role="status">
          {t('scene.isolation')}
          <button type="button" className="status-dismiss" onClick={exitIsolation}>
            {t('scene.exitIsolation', { shortcut: shortcutLabel('isolate') })}
          </button>
        </div>
      )}
      {flying && (
        <div className="fly-hud" aria-live="polite">
          {t('scene.flySpeed', {
            speed: formatLength(flySpeed, lengthUnit),
            unit: t(`units.symbols.${lengthUnit}`)
          })}
        </div>
      )}
    </PanelFrame>
  )
}

export default ScenePanel
