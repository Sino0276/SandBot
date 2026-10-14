import { useMemo } from 'react'
import { AxesHelper, LineBasicMaterial } from 'three'

// 필드 원점과 축(X 빨강, Y 초록, Z 파랑)을 씬에 그린다. 로봇 안에서도 보이도록 깊이 검사를 끈다.
function FrameAxes(): React.JSX.Element {
  const axes = useMemo(() => {
    const helper = new AxesHelper(0.5)
    const material = helper.material as LineBasicMaterial
    material.depthTest = false
    material.toneMapped = false
    helper.renderOrder = 10
    return helper
  }, [])

  return <primitive object={axes} />
}

export default FrameAxes
