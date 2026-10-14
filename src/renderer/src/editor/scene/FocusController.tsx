import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { PerspectiveCamera, Sphere, Vector3 } from 'three'
import { worldMatrix } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { objectWorldBounds } from './bounds'
import { flyCameraTo } from './cameraMotion'
import { isOrbitControls } from './frameHooks'

const MIN_RADIUS = 0.05

// 포커스 요청(F 키, 하이어라키 더블클릭, 임포트 직후)이 오면 지금 보는 방향을 유지한 채 오브젝트가 화면에 꽉 차게
// 카메라를 옮긴다.
function FocusController(): null {
  const get = useThree((state) => state.get)
  const request = useEditorStore((state) => state.focusRequest)

  useEffect(() => {
    if (!request) return
    const { camera, controls, invalidate } = get()
    const objects = useSceneStore.getState().objects
    if (!isOrbitControls(controls) || !objects[request.id]) return

    const sphere =
      objectWorldBounds(objects, request.id)?.getBoundingSphere(new Sphere()) ??
      new Sphere(new Vector3().setFromMatrixPosition(worldMatrix(objects, request.id)), 0)
    const radius = Math.max(sphere.radius, MIN_RADIUS)
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50
    const distance = (radius / Math.sin(((fov / 2) * Math.PI) / 180)) * 1.1

    // Unity처럼 순간 이동하지 않고 짧게 날아간다(cameraMotion)
    const direction = camera.position.clone().sub(controls.target).normalize()
    const position = sphere.center.clone().addScaledVector(direction, distance)
    flyCameraTo(camera, controls, position, sphere.center)
    invalidate()
  }, [request, get])

  return null
}

export default FocusController
