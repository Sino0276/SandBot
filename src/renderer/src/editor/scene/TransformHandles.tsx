import { TransformControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Matrix4, Object3D, Quaternion } from 'three'
import { frameMatrix, localTransformFromWorld, worldMatrix } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import {
  markHandleInteraction,
  setActiveGizmo,
  useEditorStore,
  type EditorTool
} from '../editorStore'
import { beginChange, endChange } from '../history'

// 내려간 핸들의 해제 예약(StrictMode가 곧바로 다시 붙이면 취소한다)
const pendingDispose = new WeakMap<object, ReturnType<typeof setTimeout>>()

type HandlesProps = {
  proxy: Object3D
  mode: Exclude<EditorTool, 'view'>
  isRobotRoot: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDrag: () => void
}

// 실제 TransformControls. 핸들을 숨길 때(손 도구, 선택 해제) 내려가며, drei가 해제하지 않는
// three-stdlib 인스턴스(캔버스·문서 이벤트 리스너, 기즈모 메시)를 여기서 해제한다.
function Handles({
  proxy,
  mode,
  isRobotRoot,
  onDragStart,
  onDragEnd,
  onDrag
}: HandlesProps): React.JSX.Element {
  const controls = useRef<ComponentRef<typeof TransformControls>>(null)

  useEffect(() => {
    const instance = controls.current
    // 개발 모드의 StrictMode는 effect를 정리했다가 같은 인스턴스로 곧바로 다시 실행한다.
    // 그 사이에 해제하면 핸들의 마우스 리스너가 사라져 보이기만 하고 끌리지 않으므로, 해제는 미뤘다가 취소한다.
    if (instance) {
      clearTimeout(pendingDispose.get(instance))
      pendingDispose.delete(instance)
    }
    // Alt+드래그(카메라 궤도)가 기즈모 위에서 시작해도 오브젝트를 움직이지 않게 카메라 조작이 잠시 끌 수 있게 한다
    // three-stdlib 타입은 enabled를 private으로 적었지만 실제로는 공개 필드다(drei도 prop으로 바꾼다)
    setActiveGizmo(instance as unknown as { enabled: boolean } | null)
    return () => {
      setActiveGizmo(null)
      if (!instance) return
      pendingDispose.set(
        instance,
        setTimeout(() => {
          pendingDispose.delete(instance)
          instance.dispose()
        }, 0)
      )
    }
  }, [])

  return (
    <TransformControls
      ref={controls}
      object={proxy}
      mode={mode}
      space="local"
      size={0.8}
      // 최상위 로봇은 바닥 평면 이동과 Z축 회전만 허용한다
      showZ={!(isRobotRoot && mode === 'translate')}
      showX={!(isRobotRoot && mode === 'rotate')}
      showY={!(isRobotRoot && mode === 'rotate')}
      onMouseDown={onDragStart}
      onMouseUp={onDragEnd}
      onObjectChange={onDrag}
    />
  )
}

// 이동·회전 핸들. 핸들 축을 보기 기준 좌표계(필드/로봇)에 맞추기 위해, 선택한 오브젝트 대신
// "오브젝트 위치 + 기준 좌표계 방향"을 가진 대리 객체에 TransformControls를 붙이고 변화량을 오브젝트에 옮긴다.
function TransformHandles(): React.JSX.Element | null {
  const selectedId = useEditorStore((state) => state.selectedId)
  const frame = useEditorStore((state) => state.frame)
  const tool = useEditorStore((state) => state.tool)
  const objects = useSceneStore((state) => state.objects)
  const setLocalTransform = useSceneStore((state) => state.setLocalTransform)
  const get = useThree((state) => state.get)

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

  // 드래그 도중 선택이나 도구가 바뀌거나 핸들이 사라지면(예: STEP 불러오기가 끝나 새 로봇을 선택) 드래그를 끝낸다.
  // TransformControls가 끈 카메라 조작을 다시 켜고, 실행 취소 묶음을 닫는다.
  useEffect(
    () => () => {
      if (!dragging.current) return
      dragging.current = false
      endChange()
      const controls = get().controls as { enabled?: boolean } | null
      if (controls) controls.enabled = true
      setSyncCount((count) => count + 1)
    },
    [selectedId, tool, get]
  )

  const object = selectedId ? objects[selectedId] : undefined
  // 손 도구(Q)에서는 핸들을 숨긴다
  if (!selectedId || !object || tool === 'view') return null

  return (
    <>
      {/* TransformControls는 씬 그래프에 있는 객체만 받는다. 씬 루트 바로 아래라 대리 객체의 matrix가 곧 필드 기준 행렬이다. */}
      <primitive object={proxy} />
      <Handles
        proxy={proxy}
        mode={tool}
        isRobotRoot={object.kind === 'robot' && object.parentId === null}
        onDragStart={() => {
          markHandleInteraction()
          // 드래그 한 번을 실행 취소 한 단계로 묶는다
          beginChange()
          dragging.current = true
          proxy.updateMatrix()
          proxyToObject.current = proxy.matrix
            .clone()
            .invert()
            .multiply(worldMatrix(useSceneStore.getState().objects, selectedId))
        }}
        onDragEnd={() => {
          markHandleInteraction()
          if (!dragging.current) return
          dragging.current = false
          endChange()
          setSyncCount((count) => count + 1)
        }}
        onDrag={() => {
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
