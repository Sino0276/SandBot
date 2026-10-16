import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { PerspectiveCamera, Sphere } from 'three'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { selectionWorldBounds } from './bounds'
import { flyCameraTo } from './cameraMotion'
import { isOrbitControls } from './frameHooks'

const MIN_RADIUS = 0.05

// 포커스 요청(F 키, 하이어라키 더블클릭, 임포트 직후)이 오면 지금 보는 방향을 유지한 채 대상이 화면에 꽉 차게
// 카메라를 옮긴다. 여러 오브젝트면(F로 선택 전체) Unity처럼 합친 경계에 맞춘다.
function FocusController(): null {
  const get = useThree((state) => state.get)
  const request = useEditorStore((state) => state.focusRequest)

  useEffect(() => {
    if (!request) return
    const { camera, controls, invalidate } = get()
    if (!isOrbitControls(controls)) return
    const bounds = selectionWorldBounds(useSceneStore.getState().objects, request.ids)
    if (!bounds) return

    const sphere = bounds.getBoundingSphere(new Sphere())
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
