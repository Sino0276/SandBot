import { Edges } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  LineBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
  type Group
} from 'three'
import { useShallow } from 'zustand/react/shallow'
import { simPoseOf, usePlayStore } from '../../play/playStore'
import { ROBOT_SIZE } from '../../scene/coordinates'
import { getGeometry } from '../../scene/geometryRegistry'
import { cadMeshRaycast } from '../../scene/meshBvh'
import { childrenInDocument, type ObjectVisual, type Transform, type Vec3 } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { isHiddenInScene, useSceneVisibilityStore } from '../sceneVisibility'
import { objectWorldBounds } from './bounds'
import { bindPoseDisplay, GHOST_MESH_LIMIT, meshCount } from './poseDisplay'

const SELECTED_COLOR = '#4c8dff'
const HIGHLIGHT_EMISSIVE = new Color('#1d4ed8')
const NO_EMISSIVE = new Color('#000000')

// 선택 id 집합. 큰 CAD(노드 수천 개)에서 노드마다 선택 배열을 훑지 않게 선택 배열마다 한 번 만든다
// (editorStore는 선택이 바뀔 때만 새 배열을 만든다).
const selectionSets = new WeakMap<readonly string[], ReadonlySet<string>>()

function selectionSet(ids: readonly string[]): ReadonlySet<string> {
  let set = selectionSets.get(ids)
  if (!set) {
    set = new Set(ids)
    selectionSets.set(ids, set)
  }
  return set
}

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

// CAD 재질은 (색, 꼭짓점 색, 강조)마다 하나를 함께 쓴다. 큰 CAD(메시 1761개)도 색은 몇십 가지라, 메시마다 재질을
// 만들면 그릴 때마다 재질(uniform)을 1761번 바꾼다. 재질 수는 색 수에 묶여 있어 해제하지 않는다(형상은 따로 해제한다).
const cadMaterials = new Map<string, MeshStandardMaterial>()

function cadMaterial(
  color: Vec3,
  vertexColors: boolean,
  highlighted: boolean
): MeshStandardMaterial {
  const key = `${color.join(',')}|${vertexColors ? 1 : 0}|${highlighted ? 1 : 0}`
  let material = cadMaterials.get(key)
  if (!material) {
    material = new MeshStandardMaterial({
      // CAD 색은 sRGB 값이다
      color: new Color().setRGB(...color, SRGBColorSpace),
      vertexColors,
      emissive: highlighted ? HIGHLIGHT_EMISSIVE : NO_EMISSIVE,
      emissiveIntensity: 0.35,
      metalness: 0.1,
      roughness: 0.7
    })
    cadMaterials.set(key, material)
  }
  return material
}

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
  if (!geometry) return null
  return (
    <mesh
      geometry={geometry}
      material={cadMaterial(color, geometry.hasAttribute('color'), highlighted)}
      raycast={cadMeshRaycast}
      onClick={onClick}
    />
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

// 실행 중인 로봇의 안쪽 노드(자세는 바깥 그룹이 갖는다). 같은 배열을 계속 써서 R3F가 다시 적용하지 않게 한다.
const IDENTITY_POSITION: Vec3 = [0, 0, 0]
const IDENTITY_ROTATION: [number, number, number, 'ZYX'] = [0, 0, 0, 'ZYX']
const IDENTITY_TRANSFORM: Transform = { position: [0, 0, 0], rotation: [0, 0, 0] }

function ObjectNode({
  id,
  parentHighlighted,
  identity = false
}: {
  id: string
  parentHighlighted: boolean
  // 실행 중인 로봇: 문서 자세 대신 항등(바깥 그룹이 시뮬레이터 자세로 움직인다). 시작·끝에만 바뀐다.
  identity?: boolean
}): React.JSX.Element | null {
  const object = useSceneStore((state) => state.objects[id])
  const childIds = useSceneStore(
    useShallow((state) => childrenInDocument(state.objects, id).map((child) => child.id))
  )
  // 선택 전체를 같은 색으로 강조한다(Unity도 다중 선택을 모두 외곽선으로 보인다). 씬 뷰 클릭은 하나만 선택한다.
  const selected = useEditorStore((state) => selectionSet(state.selectedIds).has(id))
  const select = useEditorStore((state) => state.select)
  // 숨긴 오브젝트(하이어라키 눈 아이콘·H·고립 보기)는 그리지 않고 클릭되지도 않는다. 자식은 자기 값을 따른다.
  const hidden = useSceneVisibilityStore((state) =>
    isHiddenInScene(state, useSceneStore.getState().objects, id)
  )

  if (!object) return null
  const [rx, ry, rz] = object.transform.rotation
  const highlighted = parentHighlighted || selected

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    // 가장 안쪽(자식) 오브젝트만 선택되도록 전파를 막는다. 카메라를 끌어 돌린 클릭은 무시한다.
    event.stopPropagation()
    if (event.delta <= 2) select(id)
  }

  return (
    <group
      position={identity ? IDENTITY_POSITION : object.transform.position}
      rotation={identity ? IDENTITY_ROTATION : [rx, ry, rz, 'ZYX']}
    >
      {object.visual && !hidden && (
        <Visual visual={object.visual} highlighted={highlighted} onClick={handleClick} />
      )}
      {childIds.map((childId) => (
        <ObjectNode key={childId} id={childId} parentHighlighted={highlighted} />
      ))}
    </group>
  )
}

// 최상위 오브젝트. 실행 중 그 로봇이 시뮬레이터 자세를 받으면(playStore.simPose) 바깥 그룹을 명령형으로 움직이고
// 안쪽 노드는 항등으로 둔다(poseDisplay.ts). 씬 문서는 바뀌지 않는다(실행 취소해도 표시 자세는 그대로).
function RootNode({ id }: { id: string }): React.JSX.Element {
  const outer = useRef<Group>(null)
  const invalidate = useThree((state) => state.invalidate)
  // 시작(첫 자세)·끝에만 바뀌는 값이라 자세가 올 때마다 하위 트리를 다시 그리지 않는다
  const posed = usePlayStore((state) => simPoseOf(state)?.robotId === id)
  // 그리기 전에 바깥 그룹의 자세를 맞춘다(안쪽이 항등으로 바뀐 프레임에 문서 자세가 한 번 보이지 않게)
  useLayoutEffect(() => {
    const group = outer.current
    if (!posed || !group) return
    return bindPoseDisplay(group, id, usePlayStore, invalidate)
  }, [posed, id, invalidate])
  return (
    <group ref={outer}>
      <ObjectNode id={id} parentHighlighted={false} identity={posed} />
    </group>
  )
}

// ---- 잔상(끝난 실행의 마지막 자세) ----

// 잔상 재질은 모듈에서 함께 쓰고 해제하지 않는다(StrictMode가 붙였다 떼어도 안전하다). 깊이를 쓰지 않아 뒤의 로봇·필드를
// 가리지 않는다.
const GHOST_MATERIAL = new MeshStandardMaterial({
  color: '#93c5fd',
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
  metalness: 0,
  roughness: 0.9
})
const GHOST_LINE_MATERIAL = new LineBasicMaterial({
  color: '#93c5fd',
  transparent: true,
  opacity: 0.7,
  depthWrite: false
})
// 임시 모양(SceneObjectsView의 상자와 같은 크기)
const GHOST_ROBOT_BOX = new BoxGeometry(ROBOT_SIZE, ROBOT_SIZE, ROBOT_SIZE)
const GHOST_WEBCAM_BOX = new BoxGeometry(0.03, 0.09, 0.03)

// 잔상은 클릭되지 않는다(BVH도 만들지 않는다)
const noRaycast = (): void => {}

function GhostMesh({ geometryId }: { geometryId: string }): React.JSX.Element | null {
  useSceneStore((state) => state.geometryRevision)
  const invalidate = useThree((state) => state.invalidate)
  const geometry = getGeometry(geometryId)
  // 형상이 늦게 등록되면 메시가 새로 붙는다(붙기만 해서는 다시 그려지지 않는다)
  useEffect(() => invalidate(), [geometry, invalidate])
  if (!geometry) return null
  return <mesh geometry={geometry} material={GHOST_MATERIAL} raycast={noRaycast} />
}

function GhostVisual({ visual }: { visual: ObjectVisual }): React.JSX.Element {
  if (visual.type === 'mesh') return <GhostMesh geometryId={visual.geometryId} />
  return visual.shape === 'robot' ? (
    <mesh
      geometry={GHOST_ROBOT_BOX}
      material={GHOST_MATERIAL}
      position={[0, 0, ROBOT_SIZE / 2]}
      raycast={noRaycast}
    />
  ) : (
    <mesh geometry={GHOST_WEBCAM_BOX} material={GHOST_MATERIAL} raycast={noRaycast} />
  )
}

function GhostNode({ id, root }: { id: string; root: boolean }): React.JSX.Element | null {
  const object = useSceneStore((state) => state.objects[id])
  const childIds = useSceneStore(
    useShallow((state) => childrenInDocument(state.objects, id).map((child) => child.id))
  )
  // 씬 뷰에서 숨긴 오브젝트는 잔상에도 그리지 않는다
  const hidden = useSceneVisibilityStore((state) =>
    isHiddenInScene(state, useSceneStore.getState().objects, id)
  )
  if (!object) return null
  const [rx, ry, rz] = object.transform.rotation
  return (
    <group
      position={root ? IDENTITY_POSITION : object.transform.position}
      rotation={root ? IDENTITY_ROTATION : [rx, ry, rz, 'ZYX']}
    >
      {object.visual && !hidden && <GhostVisual visual={object.visual} />}
      {childIds.map((childId) => (
        <GhostNode key={childId} id={childId} root={false} />
      ))}
    </group>
  )
}

// 큰 CAD의 잔상: 보이는 오브젝트들의 로봇 기준 경계 상자 외곽선만
function GhostBox({ robotId }: { robotId: string }): React.JSX.Element | null {
  const objects = useSceneStore((state) => state.objects)
  useSceneStore((state) => state.geometryRevision)
  const visibility = useSceneVisibilityStore((state) => state)
  const box = objectWorldBounds(
    objects,
    robotId,
    { id: robotId, transform: IDENTITY_TRANSFORM },
    (id) => !isHiddenInScene(visibility, objects, id)
  )
  const size = box ? box.getSize(new Vector3()).toArray().join(',') : null
  const center = box ? box.getCenter(new Vector3()).toArray() : null
  const edges = useMemo(() => {
    if (!size) return null
    const [x, y, z] = size.split(',').map(Number)
    const cube = new BoxGeometry(x, y, z)
    const geometry = new EdgesGeometry(cube)
    cube.dispose()
    return geometry
  }, [size])
  useEffect(() => () => edges?.dispose(), [edges])
  if (!edges || !center) return null
  return (
    <lineSegments
      geometry={edges}
      material={GHOST_LINE_MATERIAL}
      position={center as Vec3}
      raycast={noRaycast}
    />
  )
}

// 끝난 실행의 로봇을 마지막 자세에 반투명하게 한 번 더 그린다(다음 INIT·프로젝트를 열 때까지)
function GhostRobot(): React.JSX.Element | null {
  const ghost = usePlayStore((state) => state.ghostPose)
  const exists = useSceneStore(
    (state) => ghost !== null && state.objects[ghost.robotId]?.parentId === null
  )
  const tooMany = useSceneStore(
    (state) => ghost !== null && meshCount(state.objects, ghost.robotId) > GHOST_MESH_LIMIT
  )
  const invalidate = useThree((state) => state.invalidate)
  // 붙거나 떼거나 자리가 바뀌면 다시 그린다(demand 모드는 붙이기·떼기만으로 다시 그리지 않는다)
  useEffect(() => {
    invalidate()
    return () => invalidate()
  }, [ghost, exists, tooMany, invalidate])
  if (!ghost || !exists) return null
  return (
    <group position={[ghost.x, ghost.y, 0]} rotation={[0, 0, ghost.yaw, 'ZYX']}>
      {tooMany ? <GhostBox robotId={ghost.robotId} /> : <GhostNode id={ghost.robotId} root />}
    </group>
  )
}

function SceneObjectsView(): React.JSX.Element {
  // 메시를 빼거나 다시 넣기만 해서는 demand 모드 캔버스가 다시 그려지지 않는다. 숨김·고립 보기가 바뀌면 요청한다.
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => useSceneVisibilityStore.subscribe(() => invalidate()), [invalidate])
  const rootIds = useSceneStore(
    useShallow((state) => childrenInDocument(state.objects, null).map((object) => object.id))
  )
  return (
    <>
      {rootIds.map((id) => (
        <RootNode key={id} id={id} />
      ))}
      <GhostRobot />
    </>
  )
}

export default SceneObjectsView
