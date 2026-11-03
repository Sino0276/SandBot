import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Group
} from 'three'
import { simPoseOf, usePlayStore } from '../../play/playStore'
import { worldMatrix, type SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { bindJointDisplacement, bindPoseDisplay } from '../scene/poseDisplay'
import { comMarkers, type ComMarkers } from './comMarkers'
import { useMassModel } from './useMassModel'

// 씬 뷰의 무게중심 표시(spec-3a §6, ImuIndicators와 같은 자리). 활성 오브젝트가 속한 로봇의 무게중심(큰 표시)과 활성
// 오브젝트 하위 전체의 무게중심(작은 표시)을 그린다. 축 색(빨강·초록·파랑)과 IMU 표시(보라·주황)와 겹치지 않는 색이다.
// 클릭되지 않고(raycast 없음), CAD 안쪽에 있어도 보이게 깊이 검사를 끈다. 실행 중에는 씬 뷰의 로봇처럼 시뮬레이터 자세를
// 따른다(poseDisplay.ts의 bindPoseDisplay, 자세마다 invalidate). 오브젝트 표시는 관절 자세도 따른다(그 오브젝트를 옮기는
// 관절들의 움직임, bindJointDisplacement). 로봇 표시는 편집 자세의 무게중심을 로봇 틀로만 옮긴다(관절이 움직여 바뀐 로봇
// 무게중심은 시뮬레이터가 보내지 않는다). 숨긴 오브젝트도 질량 계산에는 들어간다(숨김은 보기 상태).
export const ROBOT_COM_COLOR = '#2dd4bf'
export const OBJECT_COM_COLOR = '#f8fafc'

// 로봇 표시의 공 반지름과 십자 반 길이(m), 오브젝트 표시는 공만
const ROBOT_MARKER_RADIUS = 0.018
const ROBOT_CROSS_HALF = 0.06
const OBJECT_MARKER_RADIUS = 0.01

// 형상·재질은 모듈에서 함께 쓰고 해제하지 않는다(StrictMode가 붙였다 떼어도 안전하다, 잔상 재질과 같은 방식)
const SPHERE = new SphereGeometry(1, 16, 12)
const CROSS = new BufferGeometry().setAttribute(
  'position',
  new BufferAttribute(
    new Float32Array([-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1]),
    3
  )
)
const overlay = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false }
const ROBOT_MATERIAL = new MeshBasicMaterial({ color: ROBOT_COM_COLOR, ...overlay })
const ROBOT_LINE_MATERIAL = new LineBasicMaterial({ color: ROBOT_COM_COLOR, ...overlay })
const OBJECT_MATERIAL = new MeshBasicMaterial({ color: OBJECT_COM_COLOR, ...overlay })
// 반투명 파트보다 나중에 그린다(IMU 표시와 같은 단계)
const RENDER_ORDER = 11

const noRaycast = (): void => {}

// 로봇 틀 안에서 오브젝트를 옮긴 관절의 움직임만큼 따라가는 그룹(실행 중 그 로봇이 자세를 받았을 때만 묶는다)
function JointFollow({
  objectId,
  active,
  children
}: {
  objectId: string
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const group = useRef<Group>(null)
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    const target = group.current
    if (!active || !target) return
    return bindJointDisplacement(
      target,
      objectId,
      () => useSceneStore.getState().objects,
      usePlayStore,
      invalidate
    )
  }, [active, objectId, invalidate])
  return <group ref={group}>{children}</group>
}

function Markers({
  markers,
  objectId,
  posed
}: {
  markers: ComMarkers
  objectId: string
  posed: boolean
}): React.JSX.Element {
  return (
    <>
      {markers.robot && (
        <group position={markers.robot}>
          <mesh
            geometry={SPHERE}
            material={ROBOT_MATERIAL}
            scale={ROBOT_MARKER_RADIUS}
            renderOrder={RENDER_ORDER}
            raycast={noRaycast}
          />
          <lineSegments
            geometry={CROSS}
            material={ROBOT_LINE_MATERIAL}
            scale={ROBOT_CROSS_HALF}
            renderOrder={RENDER_ORDER}
            raycast={noRaycast}
          />
        </group>
      )}
      {markers.object && (
        <JointFollow objectId={objectId} active={posed}>
          <mesh
            position={markers.object}
            geometry={SPHERE}
            material={OBJECT_MATERIAL}
            scale={OBJECT_MARKER_RADIUS}
            renderOrder={RENDER_ORDER}
            raycast={noRaycast}
          />
        </JointFollow>
      )}
    </>
  )
}

const IDENTITY_POSITION = new Vector3()
const IDENTITY_QUATERNION = new Quaternion()

// 로봇 좌표계. 실행 중 그 로봇이 시뮬레이터 자세를 받으면 바깥 그룹을 그 자세로 명령형으로 움직이고 안쪽은 항등이다
// (SceneObjectsView의 RootNode와 같은 방식이라 표시가 로봇과 같은 프레임에 같이 움직인다).
function RobotFrame({
  objects,
  robotId,
  children
}: {
  objects: SceneObjects
  robotId: string
  children: React.ReactNode
}): React.JSX.Element {
  const outer = useRef<Group>(null)
  const invalidate = useThree((state) => state.invalidate)
  const posed = usePlayStore((state) => simPoseOf(state)?.robotId === robotId)
  useLayoutEffect(() => {
    const group = outer.current
    if (!posed || !group) return
    return bindPoseDisplay(group, robotId, usePlayStore, invalidate)
  }, [posed, robotId, invalidate])
  const frame = useMemo(() => {
    const position = new Vector3()
    const quaternion = new Quaternion()
    worldMatrix(objects, robotId).decompose(position, quaternion, new Vector3())
    return { position, quaternion }
  }, [objects, robotId])
  return (
    <group ref={outer}>
      <group
        position={posed ? IDENTITY_POSITION : frame.position}
        quaternion={posed ? IDENTITY_QUATERNION : frame.quaternion}
      >
        {children}
      </group>
    </group>
  )
}

// 고른 것이 있을 때만 질량 모델을 구독한다(아무것도 고르지 않았으면 씬을 고칠 때마다 계산하지 않는다)
function SelectedCenterOfMass({ selectedId }: { selectedId: string }): React.JSX.Element | null {
  const objects = useSceneStore((state) => state.objects)
  const model = useMassModel()
  const invalidate = useThree((state) => state.invalidate)
  const markers = useMemo(
    () => comMarkers(objects, model, selectedId),
    [objects, model, selectedId]
  )
  // 시작·끝에만 바뀐다(관절 따라가기를 묶을지)
  const posed = usePlayStore(
    (state) =>
      markers !== null && markers.frameId !== null && simPoseOf(state)?.robotId === markers.frameId
  )
  // frameloop demand: 표시가 바뀌거나 사라지면 다시 그린다(사라진 표시가 화면에 남지 않게)
  useEffect(() => {
    invalidate()
    return () => invalidate()
  }, [markers, invalidate])
  if (!markers) return null
  if (markers.frameId === null)
    return <Markers markers={markers} objectId={selectedId} posed={false} />
  return (
    <RobotFrame objects={objects} robotId={markers.frameId}>
      <Markers markers={markers} objectId={selectedId} posed={posed} />
    </RobotFrame>
  )
}

function CenterOfMassIndicator(): React.JSX.Element | null {
  const selectedId = useEditorStore((state) => state.selectedId)
  return selectedId === null ? null : <SelectedCenterOfMass selectedId={selectedId} />
}

export default CenterOfMassIndicator
