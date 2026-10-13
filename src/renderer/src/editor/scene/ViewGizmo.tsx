import { GizmoHelper } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo } from 'react'
import { CanvasTexture, Quaternion, Vector3 } from 'three'
import { isOrbitControls, useViewFrameMatrix } from './frameHooks'

const AXES = [
  { label: 'X', color: '#ff3653', direction: new Vector3(1, 0, 0) },
  { label: 'Y', color: '#8adb00', direction: new Vector3(0, 1, 0) },
  { label: 'Z', color: '#2c8fff', direction: new Vector3(0, 0, 1) }
]

type AxisHeadProps = {
  color: string
  label?: string
  position: Vector3
  onSelect: () => void
}

function AxisHead({ color, label, position, onSelect }: AxisHeadProps): React.JSX.Element {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (context) {
      context.beginPath()
      context.arc(32, 32, 16, 0, 2 * Math.PI)
      context.fillStyle = color
      context.fill()
      if (label) {
        context.font = 'bold 18px Arial, sans-serif'
        context.textAlign = 'center'
        context.fillStyle = '#111'
        context.fillText(label, 32, 39)
      }
    }
    return new CanvasTexture(canvas)
  }, [color, label])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <sprite
      position={position}
      scale={label ? 1 : 0.75}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <spriteMaterial map={texture} alphaTest={0.3} opacity={label ? 1 : 0.6} toneMapped={false} />
    </sprite>
  )
}

// 오른쪽 위 축 표시. 보기 기준 좌표계(필드/로봇)의 축 방향을 보여 주고, 축을 클릭하면 그 축 방향에서 보는 시점으로 바꾼다.
// drei GizmoViewport는 회전된 축을 클릭했을 때 방향을 잘못 계산하므로 축은 직접 그린다.
function ViewGizmo(): React.JSX.Element {
  const get = useThree((state) => state.get)
  const matrix = useViewFrameMatrix()
  const frameQuaternion = useMemo(() => new Quaternion().setFromRotationMatrix(matrix), [matrix])

  const lookFrom = useCallback(
    (localDirection: Vector3) => {
      const { camera, controls, invalidate } = get()
      if (!isOrbitControls(controls)) return
      const direction = localDirection.clone().applyQuaternion(frameQuaternion)
      const distance = camera.position.distanceTo(controls.target)
      const offset = direction.multiplyScalar(distance)
      // 바로 위·아래에서 볼 때 시선이 위 방향(Z)과 평행해지지 않도록 기준 좌표계의 -X 쪽으로 살짝 비켜 둔다(화면 위쪽이 +X)
      if (Math.abs(offset.z) > distance * 0.999) {
        offset.add(new Vector3(-distance * 1e-3, 0, 0).applyQuaternion(frameQuaternion))
      }
      camera.position.copy(controls.target).add(offset)
      controls.update()
      invalidate()
    },
    [get, frameQuaternion]
  )

  return (
    <GizmoHelper alignment="top-right" margin={[64, 64]}>
      <group scale={40} quaternion={frameQuaternion}>
        {AXES.map(({ label, color, direction }) => (
          <group key={label}>
            <mesh position={direction.clone().multiplyScalar(0.4)}>
              <boxGeometry
                args={[
                  direction.x ? 0.8 : 0.05,
                  direction.y ? 0.8 : 0.05,
                  direction.z ? 0.8 : 0.05
                ]}
              />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <AxisHead
              color={color}
              label={label}
              position={direction}
              onSelect={() => lookFrom(direction)}
            />
            <AxisHead
              color={color}
              position={direction.clone().negate()}
              onSelect={() => lookFrom(direction.clone().negate())}
            />
          </group>
        ))}
      </group>
    </GizmoHelper>
  )
}

export default ViewGizmo
