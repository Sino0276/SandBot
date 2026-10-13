import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useShallow } from 'zustand/react/shallow'
import { ROBOT_SIZE } from '../../scene/coordinates'
import { childrenOf, type SceneObjectKind } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'

const SELECTED_COLOR = '#4c8dff'

type VisualProps = {
  selected: boolean
  onClick: (event: ThreeEvent<MouseEvent>) => void
}

// 임시 로봇: 18 in 상자. 윗면의 삼각형이 로봇 앞(+X)을 가리킨다.
function RobotVisual({ selected, onClick }: VisualProps): React.JSX.Element {
  return (
    <group onClick={onClick}>
      <mesh position={[0, 0, ROBOT_SIZE / 2]}>
        <boxGeometry args={[ROBOT_SIZE, ROBOT_SIZE, ROBOT_SIZE]} />
        <meshStandardMaterial color="#6b7280" transparent opacity={0.85} />
        <Edges color={selected ? SELECTED_COLOR : '#2b2e34'} />
      </mesh>
      <mesh position={[ROBOT_SIZE * 0.2, 0, ROBOT_SIZE + 0.002]}>
        <circleGeometry args={[ROBOT_SIZE * 0.22, 3]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
    </group>
  )
}

// 임시 파트: 작은 상자와 +X 방향 렌즈(웹캠 모양)
function PartVisual({ selected, onClick }: VisualProps): React.JSX.Element {
  return (
    <group onClick={onClick}>
      <mesh>
        <boxGeometry args={[0.03, 0.09, 0.03]} />
        <meshStandardMaterial color="#cbd5e1" />
        <Edges color={selected ? SELECTED_COLOR : '#2b2e34'} />
      </mesh>
      <mesh position={[0.02, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.011, 0.011, 0.012, 16]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
    </group>
  )
}

const VISUALS: Record<SceneObjectKind, (props: VisualProps) => React.JSX.Element> = {
  robot: RobotVisual,
  part: PartVisual
}

function ObjectNode({ id }: { id: string }): React.JSX.Element | null {
  const object = useSceneStore((state) => state.objects[id])
  const childIds = useSceneStore(
    useShallow((state) => childrenOf(state.objects, id).map((child) => child.id))
  )
  const selected = useEditorStore((state) => state.selectedId === id)
  const select = useEditorStore((state) => state.select)

  if (!object) return null
  const [rx, ry, rz] = object.transform.rotation
  const Visual = VISUALS[object.kind]

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    // 가장 안쪽(자식) 오브젝트만 선택되도록 전파를 막는다. 카메라를 끌어 돌린 클릭은 무시한다.
    event.stopPropagation()
    if (event.delta <= 2) select(id)
  }

  return (
    <group position={object.transform.position} rotation={[rx, ry, rz, 'ZYX']}>
      <Visual selected={selected} onClick={handleClick} />
      {childIds.map((childId) => (
        <ObjectNode key={childId} id={childId} />
      ))}
    </group>
  )
}

function SceneObjectsView(): React.JSX.Element {
  const rootIds = useSceneStore(
    useShallow((state) => childrenOf(state.objects, null).map((object) => object.id))
  )
  return (
    <>
      {rootIds.map((id) => (
        <ObjectNode key={id} id={id} />
      ))}
    </>
  )
}

export default SceneObjectsView
