import { useMemo } from 'react'
import { AxesHelper, LineBasicMaterial, Quaternion, Vector3 } from 'three'
import { ROBOT_SIZE } from '../../scene/coordinates'
import { useEditorStore } from '../editorStore'
import { useViewFrameMatrix } from './frameHooks'

// 보기 기준 좌표계의 원점과 축(X 빨강, Y 초록, Z 파랑)을 씬에 그린다. 로봇 안에서도 보이도록 깊이 검사를 끈다.
function FrameAxes(): React.JSX.Element {
  const frame = useEditorStore((state) => state.frame)
  const matrix = useViewFrameMatrix()

  const axes = useMemo(() => {
    const helper = new AxesHelper(1)
    const material = helper.material as LineBasicMaterial
    material.depthTest = false
    material.toneMapped = false
    helper.renderOrder = 10
    return helper
  }, [])

  const { position, quaternion } = useMemo(() => {
    const position = new Vector3()
    const quaternion = new Quaternion()
    matrix.decompose(position, quaternion, new Vector3())
    return { position, quaternion }
  }, [matrix])

  return (
    <group position={position} quaternion={quaternion}>
      <primitive object={axes} scale={frame === 'robot' ? ROBOT_SIZE : 0.5} />
    </group>
  )
}

export default FrameAxes
