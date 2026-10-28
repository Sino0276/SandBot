import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKeyboardPadStore } from '../../play/keyboardGamepad'
import { isRunActive, usePlayStore } from '../../play/playStore'
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

// 배치 도움말의 줄(scene.keyboardPad.layout.*)
const PAD_LAYOUT = [
  'leftStick',
  'rightStick',
  'buttons',
  'bumpers',
  'triggers',
  'dpad',
  'startBack'
] as const

// 실행 중 키보드 게임패드 표시: 씬 뷰에 포커스가 있으면 "키보드 → 게임패드 N"과 테두리, 없으면 누르라는 안내.
// [?]는 배치 도움말을 연다(마우스를 올려도 보인다). 누를 때 씬 뷰의 포커스를 뺏지 않는다(뺏으면 키를 모두 뗀다).
function KeyboardPadBadge(): React.JSX.Element | null {
  const { t } = useTranslation()
  const slot = useKeyboardPadStore((state) => state.slot)
  const focused = useKeyboardPadStore((state) => state.focused)
  const running = usePlayStore((state) => isRunActive(state.run))
  const [helpOpen, setHelpOpen] = useState(false)
  if (!running || slot === null) return null
  const label = focused
    ? t('scene.keyboardPad.active', { slot: slot + 1 })
    : t('scene.keyboardPad.inactive', { slot: slot + 1 })
  return (
    <>
      {focused && <div className="keyboard-pad-frame" aria-hidden />}
      <div
        className={focused ? 'keyboard-pad is-active' : 'keyboard-pad'}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span className="keyboard-pad-label" role="status">
          {label}
        </span>
        <button
          type="button"
          className="keyboard-pad-help-button"
          aria-expanded={helpOpen}
          aria-controls="keyboard-pad-help"
          title={t('scene.keyboardPad.helpTitle')}
          onClick={() => setHelpOpen((open) => !open)}
        >
          ?
        </button>
        <div
          id="keyboard-pad-help"
          className={helpOpen ? 'keyboard-pad-help is-open' : 'keyboard-pad-help'}
          role="tooltip"
        >
          <strong className="keyboard-pad-help-title">{t('scene.keyboardPad.helpTitle')}</strong>
          <dl className="keyboard-pad-layout">
            {PAD_LAYOUT.map((row) => (
              <div key={row} className="keyboard-pad-row">
                <dt>
                  <kbd>{t(`scene.keyboardPad.layout.${row}.keys`)}</kbd>
                </dt>
                <dd>{t(`scene.keyboardPad.layout.${row}.field`)}</dd>
              </div>
            ))}
          </dl>
          <p className="keyboard-pad-hint">{t('scene.keyboardPad.hint')}</p>
        </div>
      </div>
    </>
  )
}

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
        // 키보드 게임패드(play/keyboardGamepad.ts): 씬 뷰는 포커스를 받을 수 있고(SCENE_VIEW_ATTRIBUTE), 누르면 포커스가
        // 온다. 실행 중 포커스가 있는 동안만 키보드가 게임패드다. OrbitControls의 키 조작(keyEvents)은 켜지 않는다
        // (EditorCameraControls, 방향키가 카메라 대신 오른쪽 스틱이 되게).
        tabIndex={0}
        data-scene-view=""
        className="scene-canvas"
        onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
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
      <KeyboardPadBadge />
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
