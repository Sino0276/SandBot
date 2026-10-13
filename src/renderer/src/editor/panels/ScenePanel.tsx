import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useTranslation } from 'react-i18next'
import type { ReferenceFrame } from '../../scene/model'
import { isRecentHandleInteraction, useEditorStore, type TransformMode } from '../editorStore'
import PanelFrame from '../PanelFrame'
import CameraRig from '../scene/CameraRig'
import FieldFloor from '../scene/FieldFloor'
import FocusController from '../scene/FocusController'
import FrameAxes from '../scene/FrameAxes'
import { FIELD_VIEW_POSITION } from '../scene/frameHooks'
import SceneObjectsView from '../scene/SceneObjectsView'
import TransformHandles from '../scene/TransformHandles'
import ViewGizmo from '../scene/ViewGizmo'
import SegmentedControl from '../SegmentedControl'

function ScenePanel(): React.JSX.Element {
  const { t } = useTranslation()
  const frame = useEditorStore((state) => state.frame)
  const setFrame = useEditorStore((state) => state.setFrame)
  const transformMode = useEditorStore((state) => state.transformMode)
  const setTransformMode = useEditorStore((state) => state.setTransformMode)
  const select = useEditorStore((state) => state.select)

  const actions = (
    <>
      <SegmentedControl<TransformMode>
        label={t('scene.transformMode')}
        value={transformMode}
        options={[
          { value: 'translate', label: t('scene.translate') },
          { value: 'rotate', label: t('scene.rotate') }
        ]}
        onChange={setTransformMode}
      />
      <SegmentedControl<ReferenceFrame>
        label={t('scene.frame')}
        value={frame}
        options={[
          { value: 'field', label: t('scene.field') },
          { value: 'robot', label: t('scene.robot') }
        ]}
        onChange={setFrame}
      />
    </>
  )

  return (
    <PanelFrame title={t('panels.scene')} actions={actions} fill>
      {/* 에디터는 대부분 정지 화면이므로 변경이 있을 때만 다시 그린다 */}
      <Canvas
        frameloop="demand"
        camera={{ position: FIELD_VIEW_POSITION, fov: 50, near: 0.01, far: 200 }}
        onPointerMissed={() => {
          if (!isRecentHandleInteraction()) select(null)
        }}
      >
        <color attach="background" args={['#1e1f22']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, -2, 5]} intensity={1.2} />
        <FieldFloor />
        <SceneObjectsView />
        <FrameAxes />
        <TransformHandles />
        <OrbitControls makeDefault />
        <CameraRig />
        <FocusController />
        <ViewGizmo />
      </Canvas>
    </PanelFrame>
  )
}

export default ScenePanel
