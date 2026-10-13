import { TransformControls } from '@react-three/drei'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Matrix4, Object3D, Quaternion } from 'three'
import { frameMatrix, localTransformFromWorld, worldMatrix } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { markHandleInteraction, useEditorStore } from '../editorStore'

// 이동·회전 핸들. 핸들 축을 보기 기준 좌표계(필드/로봇)에 맞추기 위해, 선택한 오브젝트 대신
// "오브젝트 위치 + 기준 좌표계 방향"을 가진 대리 객체에 TransformControls를 붙이고 변화량을 오브젝트에 옮긴다.
function TransformHandles(): React.JSX.Element | null {
  const selectedId = useEditorStore((state) => state.selectedId)
  const frame = useEditorStore((state) => state.frame)
  const mode = useEditorStore((state) => state.transformMode)
  const objects = useSceneStore((state) => state.objects)
  const setLocalTransform = useSceneStore((state) => state.setLocalTransform)

  const proxy = useMemo(() => new Object3D(), [])
  const dragging = useRef(false)
  // 드래그 시작 시점의 (대리 객체 → 오브젝트) 상대 행렬
  const proxyToObject = useRef(new Matrix4())
  const [syncCount, setSyncCount] = useState(0)

  // 드래그 중이 아닐 때 대리 객체를 오브젝트 위치와 기준 좌표계 방향에 맞춘다
  useLayoutEffect(() => {
    if (!selectedId || !objects[selectedId] || dragging.current) return
    proxy.position.setFromMatrixPosition(worldMatrix(objects, selectedId))
    proxy.quaternion.copy(
      new Quaternion().setFromRotationMatrix(frameMatrix(objects, selectedId, frame))
    )
    proxy.updateMatrix()
  }, [objects, selectedId, frame, proxy, syncCount])

  const object = selectedId ? objects[selectedId] : undefined
  if (!selectedId || !object) return null

  const isRobotRoot = object.kind === 'robot' && object.parentId === null

  return (
    <>
      {/* TransformControls는 씬 그래프에 있는 객체만 받는다. 씬 루트 바로 아래라 대리 객체의 matrix가 곧 필드 기준 행렬이다. */}
      <primitive object={proxy} />
      <TransformControls
        object={proxy}
        mode={mode}
        space="local"
        size={0.8}
        // 최상위 로봇은 바닥 평면 이동과 Z축 회전만 허용한다
        showZ={!(isRobotRoot && mode === 'translate')}
        showX={!(isRobotRoot && mode === 'rotate')}
        showY={!(isRobotRoot && mode === 'rotate')}
        onMouseDown={() => {
          markHandleInteraction()
          dragging.current = true
          proxy.updateMatrix()
          proxyToObject.current = proxy.matrix
            .clone()
            .invert()
            .multiply(worldMatrix(useSceneStore.getState().objects, selectedId))
        }}
        onMouseUp={() => {
          markHandleInteraction()
          dragging.current = false
          setSyncCount((count) => count + 1)
        }}
        onObjectChange={() => {
          if (!dragging.current) return
          proxy.updateMatrix()
          const world = proxy.matrix.clone().multiply(proxyToObject.current)
          const current = useSceneStore.getState().objects
          setLocalTransform(selectedId, localTransformFromWorld(current, selectedId, world))
        }}
      />
    </>
  )
}

export default TransformHandles
