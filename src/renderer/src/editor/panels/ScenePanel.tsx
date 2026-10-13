import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useTranslation } from 'react-i18next'
import PanelFrame from '../PanelFrame'

// 내부 단위는 미터. 좌표계 규약(Y-up/Z-up)은 미결정이라 지금은 Three.js 기본값(Y-up)으로 렌더링만 한다.
function ScenePanel(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <PanelFrame title={t('panels.scene')} fill>
      {/* 에디터는 대부분 정지 화면이므로 변경이 있을 때만 다시 그린다 */}
      <Canvas
        frameloop="demand"
        camera={{ position: [2.5, 2, 2.5], fov: 50, near: 0.01, far: 200 }}
      >
        <color attach="background" args={['#1e1f22']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1} />
        <Grid
          infiniteGrid
          cellSize={0.1}
          cellThickness={0.6}
          cellColor="#3a3c42"
          sectionSize={1}
          sectionThickness={1}
          sectionColor="#5a5d66"
          fadeDistance={25}
        />
        <OrbitControls makeDefault />
        <GizmoHelper alignment="top-right" margin={[64, 64]}>
          <GizmoViewport labelColor="white" />
        </GizmoHelper>
      </Canvas>
    </PanelFrame>
  )
}

export default ScenePanel
