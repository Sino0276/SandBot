import { useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { ROBOT_SIZE } from '../../scene/coordinates'
import { useEditorStore } from '../editorStore'
import { FIELD_VIEW_POSITION, isOrbitControls, useActiveRobotMatrix } from './frameHooks'

// 로봇 기준 시점: 로봇 뒤쪽 위에서 로봇 중심을 본다 (로봇 좌표계 값)
const ROBOT_VIEW_POSITION = new Vector3(-1.8, 0, 1.2)
const ROBOT_VIEW_TARGET = new Vector3(0, 0, ROBOT_SIZE / 2)

// 보기 기준(필드/로봇)에 따라 카메라를 배치하고, 로봇 기준일 때는 로봇이 움직인 만큼 카메라도 따라간다.
function CameraRig(): null {
  const get = useThree((state) => state.get)
  const controls = useThree((state) => state.controls)
  const frame = useEditorStore((state) => state.frame)
  const robotMatrix = useActiveRobotMatrix()
  const lastRobotMatrix = useRef(robotMatrix)

  useLayoutEffect(() => {
    const { camera, controls, invalidate } = get()
    if (!isOrbitControls(controls)) return
    const robot = lastRobotMatrix.current
    if (frame === 'robot' && robot) {
      camera.position.copy(ROBOT_VIEW_POSITION).applyMatrix4(robot)
      controls.target.copy(ROBOT_VIEW_TARGET).applyMatrix4(robot)
    } else {
      camera.position.copy(FIELD_VIEW_POSITION)
      controls.target.set(0, 0, 0)
    }
    controls.update()
    invalidate()
  }, [frame, controls, get])

  useLayoutEffect(() => {
    const previous = lastRobotMatrix.current
    lastRobotMatrix.current = robotMatrix
    const { camera, controls, invalidate } = get()
    if (frame !== 'robot' || !previous || !robotMatrix || !isOrbitControls(controls)) return
    const delta = robotMatrix.clone().multiply(previous.clone().invert())
    camera.position.applyMatrix4(delta)
    controls.target.applyMatrix4(delta)
    controls.update()
    invalidate()
  }, [robotMatrix, frame, get])

  return null
}

export default CameraRig
