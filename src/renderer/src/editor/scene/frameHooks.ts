import { useMemo } from 'react'
import { Matrix4, Vector3 } from 'three'
import { activeRobotId, worldMatrix } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'

const IDENTITY = new Matrix4()

// 필드 기준 기본 시점: 필드 모서리 위에서 필드 중앙을 본다
export const FIELD_VIEW_POSITION = new Vector3(-2.8, -3.6, 2.8)

// 로봇 기준 보기에서 따라갈 로봇의 필드 기준 행렬. 씬에 로봇이 없으면 null.
export function useActiveRobotMatrix(): Matrix4 | null {
  const objects = useSceneStore((state) => state.objects)
  const selectedId = useEditorStore((state) => state.selectedId)
  return useMemo(() => {
    const robotId = activeRobotId(objects, selectedId)
    return robotId ? worldMatrix(objects, robotId) : null
  }, [objects, selectedId])
}

// 현재 보기 기준 좌표계(필드 또는 로봇)의 필드 기준 행렬
export function useViewFrameMatrix(): Matrix4 {
  const frame = useEditorStore((state) => state.frame)
  const robotMatrix = useActiveRobotMatrix()
  return frame === 'robot' && robotMatrix ? robotMatrix : IDENTITY
}

// drei OrbitControls(three-stdlib) 중 여기서 쓰는 부분
export type OrbitControlsLike = {
  target: Vector3
  update: () => unknown
}

export function isOrbitControls(controls: unknown): controls is OrbitControlsLike {
  return typeof controls === 'object' && controls !== null && 'target' in controls
}
