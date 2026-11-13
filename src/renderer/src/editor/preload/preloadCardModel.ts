import type { FieldSpec, SeasonId } from '../../../../shared/sim/seasons/fieldSpec'
import { resolveElementType } from '../../../../shared/sim/elements/elementData'
import type { Frame3 } from '../../../../shared/sim/sensorFrame'
import type { CollisionModel } from '../../play/worldColliders'
import {
  frameOfMatrix,
  preloadOverlaps,
  robotPreloads,
  type PreloadExclusion,
  type PreloadSource,
  type RobotPreloads
} from '../../play/worldElements'
import type { JointBodyFrames } from '../../play/worldJoints'
import { findRobotId, type SceneObjects } from '../../scene/model'
import { canHavePreload, MAX_ROBOT_PRELOADS, robotPreloadIds } from '../../scene/preload'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'

// Preload Slot 카드·Add Component·로봇 카드의 순수 모델(6a, spec-6a §3). 자리 규칙은 세계 설명 빌더와 같은 robotPreloads
// (play/worldElements.ts)라 카드가 보이는 "자리 n/4"·제외 이유·겹침이 INIT의 세계 설명·Console 경고와 같다.

// Add Component의 Preload Slot을 붙일 수 없는 이유(붙일 수 있으면 null): 로봇·CAD 루트, 이미 있음, 로봇 한도
export type PreloadAddBlock = 'notAllowed' | 'exists' | 'limit'

export function preloadAddBlock(objects: SceneObjects, id: string): PreloadAddBlock | null {
  const object = objects[id]
  if (!object || !canHavePreload(object)) return 'notAllowed'
  if (object.preload) return 'exists'
  const robotId = findRobotId(objects, id)
  if (robotId !== null && robotPreloadIds(objects, robotId).length >= MAX_ROBOT_PRELOADS)
    return 'limit'
  return null
}

const IDENTITY: Frame3 = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: { x: 0, y: 0, z: 0 } }

// 충돌 모델의 몸체 번호 → 로봇 좌표 몸체 틀(관절 q = 0)
export function bodyFrameOf(joints: JointBodyFrames): (body: number) => Frame3 {
  return (body) =>
    body < 0 || !joints.frames[body] ? IDENTITY : frameOfMatrix(joints.frames[body])
}

// 카드 하나의 상태:
// - orphan: 로봇 밖(시뮬레이터가 쓰지 않음)
// - season: 문서 시즌에 경기 요소가 없음('none'·모르는 시즌)
// - used: 세계 설명에 들어감(index는 자리 순서 1부터, body는 섀시 또는 관절 이름, overlap은 편집 자세 겹침 대상)
// - excluded: 빠짐(exclusion 이유)
export type PreloadCardView =
  | { status: 'orphan' }
  | { status: 'season' }
  | {
      status: 'used'
      robotId: string
      index: number
      body: { kind: 'chassis' } | { kind: 'joint'; name: string }
      overlap: string | null
    }
  | { status: 'excluded'; robotId: string; exclusion: PreloadExclusion }

export function preloadCardView(
  objects: SceneObjects,
  objectId: string,
  field: FieldSpec,
  collision: { model: CollisionModel; joints: JointBodyFrames } | null
): PreloadCardView {
  const robotId = findRobotId(objects, objectId)
  if (robotId === null || robotId === objectId) return { status: 'orphan' }
  if (!field.elements || !resolveElementType(field, 'pollen')) return { status: 'season' }
  const preloads = robotPreloads(objects, robotId, field, collision?.joints)
  const index = preloads.slots.findIndex((slot) => slot.objectId === objectId)
  if (index < 0)
    return {
      status: 'excluded',
      robotId,
      exclusion: preloads.exclusions.get(objectId) ?? 'disabled'
    }
  const slot = preloads.slots[index]
  const jointId = collision?.joints.objectIds[slot.body]
  const body =
    slot.body < 0 || jointId === undefined
      ? ({ kind: 'chassis' } as const)
      : ({ kind: 'joint', name: objects[jointId]?.name ?? '' } as const)
  const overlap = collision
    ? (preloadOverlaps(preloads, collision.model.bodies, bodyFrameOf(collision.joints)).get(
        index
      ) ?? null)
    : null
  return { status: 'used', robotId, index: index + 1, body, overlap }
}

// 로봇 카드·Field 인스펙터의 프리로드 출처 한 줄(문서 시즌으로). 시즌이 경기 요소를 모르면 season
export function robotPreloadSource(
  objects: SceneObjects,
  robotId: string,
  season: SeasonId
): { source: PreloadSource; count: number; preloads: RobotPreloads } {
  const preloads = robotPreloads(objects, robotId, resolveSeason(season))
  return { source: preloads.source, count: preloads.slots.length, preloads }
}
