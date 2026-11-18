import { Vector3 } from 'three'
import { resolveElementType } from '../../../../shared/sim/elements/elementData'
import type { FieldSpec } from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import type { PlayData } from '../../play/playStore'
import { robotPreloads } from '../../play/worldElements'
import { findRobotId, subtreeIds, worldMatrix, type SceneObjects } from '../../scene/model'
import type { JointPreviewState } from '../joint/jointPreviewStore'
import { sensorDisplayOverride } from '../scene/sensorGizmoModel'
import { isHiddenInScene } from '../sceneVisibility'

type VisibilityState = Parameters<typeof isHiddenInScene>[0]

// 씬 뷰 Preload Slot 기즈모(6a, spec-6a §3)의 순수 모델. Unity의 생성 지점 컴포넌트가 OnDrawGizmosSelected로 와이어 구를 그리듯,
// 고른 오브젝트들(과 그 하위)의 Preload Slot마다 POLLEN 크기의 큰 원 셋을 그린다. 자세는 그 오브젝트의 표시 행렬(실행이 그 로봇을
// 잠그면 시뮬레이터 자세, 아니면 관절 미리보기 값, sensorDisplayOverride)로 옮긴 공 중심이다. 세계 설명에 들어가는 자리는 노랑,
// 빠지는 자리(끔·한도 뒤·바닥 아래·로봇 밖·시즌에 없음)는 회색이다.

export type PreloadGizmoStyle = 'used' | 'excluded'

export type PreloadGizmoItem = {
  key: string
  objectId: string
  style: PreloadGizmoStyle
  // 공 중심(필드 좌표 표시 자세)
  center: [number, number, number]
  radius: number
}

// 시즌에 POLLEN이 없으면(경기 요소 없는 시즌) BIOBUZZ POLLEN 크기로 그린다(Preload Slot의 종류가 POLLEN이다)
function pollenRadius(field: FieldSpec): number {
  return (
    resolveElementType(field, 'pollen')?.radius ??
    resolveElementType(resolveSeason('biobuzz'), 'pollen')!.radius
  )
}

export function preloadGizmoItems(input: {
  objects: SceneObjects
  selectedIds: readonly string[]
  field: FieldSpec
  play: Pick<PlayData, 'run' | 'simPose'>
  preview: JointPreviewState
  visibility: VisibilityState
}): PreloadGizmoItem[] {
  const { objects, selectedIds, field, play, preview, visibility } = input
  const radius = pollenRadius(field)
  const seen = new Set<string>()
  const out: PreloadGizmoItem[] = []
  for (const selected of selectedIds) {
    if (!objects[selected]) continue
    for (const id of subtreeIds(objects, selected)) {
      const preload = objects[id].preload
      if (!preload || seen.has(id)) continue
      seen.add(id)
      if (isHiddenInScene(visibility, objects, id)) continue
      const robotId = findRobotId(objects, id)
      const used =
        robotId !== null &&
        robotId !== id &&
        robotPreloads(objects, robotId, field).slots.some((slot) => slot.objectId === id)
      const override = robotId ? sensorDisplayOverride(objects, robotId, play, preview) : null
      const [cx, cy, cz] = preload.center
      const p = new Vector3(cx, cy, cz).applyMatrix4(worldMatrix(objects, id, override))
      out.push({
        key: id,
        objectId: id,
        style: used ? 'used' : 'excluded',
        center: [p.x, p.y, p.z],
        radius
      })
    }
  }
  return out
}
