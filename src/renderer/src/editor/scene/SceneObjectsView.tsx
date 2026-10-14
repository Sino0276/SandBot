import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useMemo } from 'react'
import { Color, SRGBColorSpace } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { ROBOT_SIZE } from '../../scene/coordinates'
import { getGeometry } from '../../scene/geometryRegistry'
import { cadMeshRaycast } from '../../scene/meshBvh'
import { childrenInDocument, type ObjectVisual, type Vec3 } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'

const SELECTED_COLOR = '#4c8dff'
const HIGHLIGHT_EMISSIVE = new Color('#1d4ed8')
const NO_EMISSIVE = new Color('#000000')

type VisualProps = {
  // 이 오브젝트 또는 상위 오브젝트가 선택되었는지
  highlighted: boolean
  onClick: (event: ThreeEvent<MouseEvent>) => void
}

// 임시 로봇: 18 in 상자. 윗면의 삼각형이 로봇 앞(+X)을 가리킨다.
function PlaceholderRobot({ highlighted, onClick }: VisualProps): React.JSX.Element {
  return (
    <group onClick={onClick}>
      <mesh position={[0, 0, ROBOT_SIZE / 2]}>
        <boxGeometry args={[ROBOT_SIZE, ROBOT_SIZE, ROBOT_SIZE]} />
        <meshStandardMaterial color="#6b7280" transparent opacity={0.85} />
        <Edges color={highlighted ? SELECTED_COLOR : '#2b2e34'} />
      </mesh>
      <mesh position={[ROBOT_SIZE * 0.2, 0, ROBOT_SIZE + 0.002]}>
        <circleGeometry args={[ROBOT_SIZE * 0.22, 3]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
    </group>
  )
}

// 임시 웹캠: 작은 상자와 +X 방향 렌즈
function PlaceholderWebcam({ highlighted, onClick }: VisualProps): React.JSX.Element {
  return (
    <group onClick={onClick}>
      <mesh>
        <boxGeometry args={[0.03, 0.09, 0.03]} />
        <meshStandardMaterial color="#cbd5e1" />
        <Edges color={highlighted ? SELECTED_COLOR : '#2b2e34'} />
      </mesh>
      <mesh position={[0.02, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.011, 0.011, 0.012, 16]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
    </group>
  )
}

type CadMeshProps = VisualProps & { geometryId: string; color: Vec3 }

// CAD에서 불러온 파트 메시. 선택하면 파랗게 빛나게 한다.
function CadMesh({
  geometryId,
  color,
  highlighted,
  onClick
}: CadMeshProps): React.JSX.Element | null {
  // 형상은 프로젝트를 연 뒤 비동기로 등록되므로 등록될 때마다 다시 그린다
  useSceneStore((state) => state.geometryRevision)
  const geometry = getGeometry(geometryId)
  // CAD 색은 sRGB 값이다
  const baseColor = useMemo(() => new Color().setRGB(...color, SRGBColorSpace), [color])
  if (!geometry) return null
  return (
    <mesh geometry={geometry} raycast={cadMeshRaycast} onClick={onClick}>
      <meshStandardMaterial
        color={baseColor}
        vertexColors={geometry.hasAttribute('color')}
        emissive={highlighted ? HIGHLIGHT_EMISSIVE : NO_EMISSIVE}
        emissiveIntensity={0.35}
        metalness={0.1}
        roughness={0.7}
      />
    </mesh>
  )
}

function Visual({
  visual,
  ...props
}: VisualProps & { visual: ObjectVisual }): React.JSX.Element | null {
  if (visual.type === 'mesh') {
    return <CadMesh geometryId={visual.geometryId} color={visual.color} {...props} />
  }
  return visual.shape === 'robot' ? (
    <PlaceholderRobot {...props} />
  ) : (
    <PlaceholderWebcam {...props} />
  )
}

function ObjectNode({
  id,
  parentHighlighted
}: {
  id: string
  parentHighlighted: boolean
}): React.JSX.Element | null {
  const object = useSceneStore((state) => state.objects[id])
  const childIds = useSceneStore(
    useShallow((state) => childrenInDocument(state.objects, id).map((child) => child.id))
  )
  const selected = useEditorStore((state) => state.selectedId === id)
  const select = useEditorStore((state) => state.select)

  if (!object) return null
  const [rx, ry, rz] = object.transform.rotation
  const highlighted = parentHighlighted || selected

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    // 가장 안쪽(자식) 오브젝트만 선택되도록 전파를 막는다. 카메라를 끌어 돌린 클릭은 무시한다.
    event.stopPropagation()
    if (event.delta <= 2) select(id)
  }

  return (
    <group position={object.transform.position} rotation={[rx, ry, rz, 'ZYX']}>
      {object.visual && (
        <Visual visual={object.visual} highlighted={highlighted} onClick={handleClick} />
      )}
      {childIds.map((childId) => (
        <ObjectNode key={childId} id={childId} parentHighlighted={highlighted} />
      ))}
    </group>
  )
}

function SceneObjectsView(): React.JSX.Element {
  const rootIds = useSceneStore(
    useShallow((state) => childrenInDocument(state.objects, null).map((object) => object.id))
  )
  return (
    <>
      {rootIds.map((id) => (
        <ObjectNode key={id} id={id} parentHighlighted={false} />
      ))}
    </>
  )
}

export default SceneObjectsView
