import { useMemo } from 'react'
import { ArrowHelper, Matrix4, Quaternion, Vector3 } from 'three'
import { HUB_DIRECTION_VECTORS, type HubDirection } from '../../hardware/mounting'
import { ancestorIds, findRobotId, worldMatrix, type SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'

// 허브 내장 IMU의 방향(RevHubOrientationOnRobot)을 씬에 보여 준다. 축 색(X 빨강·Y 초록·Z 파랑)과 겹치지 않게
// 로고 방향은 보라, USB 방향은 주황 화살표로 그린다. 인스펙터의 IMU 카드 설명과 같은 색이다.
export const IMU_LOGO_COLOR = '#d946ef'
export const IMU_USB_COLOR = '#f59e0b'

const ARROW_LENGTH = 0.2
const PLATE_SIZE = 0.1
const PLATE_THICKNESS = 0.012

type Indicator = {
  key: string
  position: Vector3
  // 로봇 좌표계 방향(IMU 방향은 로봇 기준으로 정한다)
  robotRotation: Quaternion
  logo: Vector3
  usb: Vector3
}

// 선택한 오브젝트들과 그 하위에 붙은 IMU. 로봇을 고르면 로봇의 IMU가 모두 보인다.
function indicatorsFor(objects: SceneObjects, selectedIds: readonly string[]): Indicator[] {
  const selected = new Set(selectedIds.filter((id) => objects[id]))
  if (selected.size === 0) return []
  const indicators: Indicator[] = []
  for (const object of Object.values(objects)) {
    const imus = (object.components ?? []).filter((component) => component.type === 'imu')
    if (imus.length === 0) continue
    if (!selected.has(object.id) && !ancestorIds(objects, object.id).some((id) => selected.has(id)))
      continue
    const robotId = findRobotId(objects, object.id)
    if (!robotId) continue
    const robotRotation = new Quaternion().setFromRotationMatrix(worldMatrix(objects, robotId))
    const position = new Vector3().setFromMatrixPosition(worldMatrix(objects, object.id))
    for (const imu of imus) {
      const logo = HUB_DIRECTION_VECTORS[imu.props.logoFacing as HubDirection]
      const usb = HUB_DIRECTION_VECTORS[imu.props.usbFacing as HubDirection]
      if (!logo || !usb) continue
      indicators.push({
        key: imu.id,
        position,
        robotRotation,
        logo: new Vector3(...logo),
        usb: new Vector3(...usb)
      })
    }
  }
  return indicators
}

function Arrow({ direction, color }: { direction: Vector3; color: string }): React.JSX.Element {
  const arrow = useMemo(() => {
    const helper = new ArrowHelper(direction, new Vector3(), ARROW_LENGTH, color, 0.05, 0.03)
    // CAD 안쪽에 있어도 보이게 깊이 검사를 끄고 맨 위에 그린다. 반투명한 파트보다 나중에 그리도록
    // 투명 단계(transparent)에 넣는다(불투명 단계는 반투명 파트보다 먼저 그려져 흐려진다).
    for (const part of [helper.line, helper.cone]) {
      const material = part.material as {
        depthTest: boolean
        toneMapped: boolean
        transparent: boolean
      }
      material.depthTest = false
      material.toneMapped = false
      material.transparent = true
      part.renderOrder = 11
    }
    return helper
  }, [direction, color])
  return <primitive object={arrow} />
}

// 로고 면이 위를 보는 납작한 판(허브). 두 방향이 수직이 아니면(검증 오류) 판은 그리지 않는다.
function HubPlate({ logo, usb }: { logo: Vector3; usb: Vector3 }): React.JSX.Element | null {
  const quaternion = useMemo(() => {
    if (Math.abs(logo.dot(usb)) > 1e-6) return null
    const side = new Vector3().crossVectors(logo, usb)
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(usb, side, logo))
  }, [logo, usb])
  if (!quaternion) return null
  return (
    <mesh quaternion={quaternion} renderOrder={10}>
      <boxGeometry args={[PLATE_SIZE, PLATE_SIZE, PLATE_THICKNESS]} />
      <meshBasicMaterial color={IMU_LOGO_COLOR} transparent opacity={0.25} depthTest={false} />
    </mesh>
  )
}

function ImuIndicators(): React.JSX.Element {
  const objects = useSceneStore((state) => state.objects)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const indicators = useMemo(() => indicatorsFor(objects, selectedIds), [objects, selectedIds])
  return (
    <>
      {indicators.map((indicator) => (
        <group
          key={indicator.key}
          position={indicator.position}
          quaternion={indicator.robotRotation}
        >
          <HubPlate logo={indicator.logo} usb={indicator.usb} />
          <Arrow direction={indicator.logo} color={IMU_LOGO_COLOR} />
          <Arrow direction={indicator.usb} color={IMU_USB_COLOR} />
        </group>
      ))}
    </>
  )
}

export default ImuIndicators
