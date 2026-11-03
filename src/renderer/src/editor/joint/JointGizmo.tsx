import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  ConeGeometry,
  LineBasicMaterial,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3
} from 'three'
import { displayRootOverride, simPoseOf, usePlayStore } from '../../play/playStore'
import { jointAxisVector } from '../../scene/jointMotion'
import { findRobotId } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { jointFrameMatrix, jointGizmoLines } from './jointGizmoModel'

// 씬 뷰의 관절 표시(Unity가 ArticulationBody를 고르면 앵커·축을 그리는 것과 같은 자리). 활성 오브젝트에 관절이 있으면
// 앵커(점), 축(+ 방향 화살표), 한계(회전은 앵커 둘레 호와 0 자리 눈금, 직선은 아래–위 한계 선분)를 그린다. 관절 틀은
// 그 관절 자신의 움직임을 뺀 오브젝트 틀이라(부모 · 로컬) 미리보기·실행 중에도 표시가 관절과 같이 돌지 않는다.
// 실행 중인 로봇이면 표시 자세(루트·바깥 관절)를 따른다. 클릭되지 않고 깊이 검사를 끈다. 색은 축(빨강·초록·파랑)·IMU
// (보라·주황)·무게중심(청록·흰색)과 겹치지 않는 노랑이다.
const JOINT_GIZMO_COLOR = '#facc15'
const JOINT_LIMIT_COLOR = '#fde68a'

// 점 크기(m, 가정: FTC 메커니즘 크기에 보기 좋은 값, 선 크기는 jointGizmoModel.ts)
const ANCHOR_RADIUS = 0.008
const END_RADIUS = 0.005

const overlay = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false }
const AXIS_MATERIAL = new LineBasicMaterial({ color: JOINT_GIZMO_COLOR, ...overlay })
const LIMIT_MATERIAL = new LineBasicMaterial({ color: JOINT_LIMIT_COLOR, ...overlay })
const POINT_MATERIAL = new MeshBasicMaterial({ color: JOINT_GIZMO_COLOR, ...overlay })
const LIMIT_POINT_MATERIAL = new MeshBasicMaterial({ color: JOINT_LIMIT_COLOR, ...overlay })
// 형상은 모듈에서 함께 쓰고 해제하지 않는다(무게중심 표시와 같은 방식). 원뿔은 +Y를 향한다.
const SPHERE = new SphereGeometry(1, 12, 8)
const CONE = new ConeGeometry(0.008, 0.02, 12)
const RENDER_ORDER = 11
const UP = new Vector3(0, 1, 0)

const noRaycast = (): void => {}

function SelectedJointGizmo({ id }: { id: string }): React.JSX.Element | null {
  const objects = useSceneStore((state) => state.objects)
  const joint = objects[id]?.joint
  const invalidate = useThree((state) => state.invalidate)
  const robotId = findRobotId(objects, id)
  // 그 로봇이 실행 중 자세를 받을 때만 자세를 구독한다(약 60 Hz, 그 밖에는 다시 그리지 않는다)
  const pose = usePlayStore((state) => {
    const current = simPoseOf(state)
    return current && current.robotId === robotId ? current : null
  })
  const lines = useMemo(() => (joint ? jointGizmoLines(joint) : null), [joint])
  // 관절 설정이 바뀌어 새 선을 만들면 이전 형상을 해제한다(StrictMode 재실행에도 메모는 그대로라 안전하다)
  useEffect(() => {
    if (!lines) return
    return () => {
      lines.axis.dispose()
      lines.limits.dispose()
    }
  }, [lines])
  const frame = useMemo(
    () =>
      objects[id]
        ? jointFrameMatrix(
            objects,
            id,
            // 관절 순번(run.joints)은 실행 동안 바뀌지 않으므로 자세가 올 때 지금 상태에서 읽는다
            pose
              ? displayRootOverride({ ...usePlayStore.getState(), simPose: pose }, objects)
              : null
          )
        : null,
    [objects, id, pose]
  )
  useEffect(() => {
    invalidate()
    return () => invalidate()
  }, [lines, frame, invalidate])
  if (!joint || !lines || !frame) return null
  const axis = jointAxisVector(joint)
  return (
    <group position={frame.position} quaternion={frame.quaternion}>
      <mesh
        position={joint.anchor}
        geometry={SPHERE}
        material={POINT_MATERIAL}
        scale={ANCHOR_RADIUS}
        renderOrder={RENDER_ORDER}
        raycast={noRaycast}
      />
      <lineSegments
        geometry={lines.axis}
        material={AXIS_MATERIAL}
        renderOrder={RENDER_ORDER}
        raycast={noRaycast}
      />
      <mesh
        position={lines.cone}
        quaternion={new Quaternion().setFromUnitVectors(UP, axis)}
        geometry={CONE}
        material={POINT_MATERIAL}
        renderOrder={RENDER_ORDER}
        raycast={noRaycast}
      />
      <lineSegments
        geometry={lines.limits}
        material={LIMIT_MATERIAL}
        renderOrder={RENDER_ORDER}
        raycast={noRaycast}
      />
      {lines.ends.map((end, index) => (
        <mesh
          key={index}
          position={end}
          geometry={SPHERE}
          material={LIMIT_POINT_MATERIAL}
          scale={END_RADIUS}
          renderOrder={RENDER_ORDER}
          raycast={noRaycast}
        />
      ))}
    </group>
  )
}

function JointGizmo(): React.JSX.Element | null {
  const selectedId = useEditorStore((state) => state.selectedId)
  const hasJoint = useSceneStore(
    (state) => selectedId !== null && state.objects[selectedId]?.joint !== undefined
  )
  return selectedId !== null && hasJoint ? <SelectedJointGizmo id={selectedId} /> : null
}

export default JointGizmo
