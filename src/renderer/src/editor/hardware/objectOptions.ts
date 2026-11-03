import type { ComponentType, ObjectPick } from '../../hardware/catalog'
import { componentDef, isComponentType } from '../../hardware/catalog'
import { isJointObject } from '../../play/worldJoints'
import { ancestorIds, subtreeIds, type SceneObjects } from '../../scene/model'

export type ObjectOption = { id: string; label: string }

// 컴포넌트 카드의 object 속성(catalog PropertyDef kind 'object')이 고를 수 있는 오브젝트(문서 순서, 깊이만큼 들여 쓴다).
// 'any'는 같은 로봇의 오브젝트(로봇 자신 제외, Pinpoint 포드 파트), 'joint'는 같은 로봇의 관절 오브젝트(리밋 스위치의
// limitJoint, 세계 설명 빌더 play/worldJoints.ts가 관절로 보는 것과 같다). 로봇 밖이면 없다.
export function objectOptions(
  objects: SceneObjects,
  robotId: string | null,
  pick: ObjectPick
): ObjectOption[] {
  if (!robotId || !objects[robotId]) return []
  return subtreeIds(objects, robotId)
    .filter((id) => id !== robotId && (pick === 'any' || isJointObject(objects[id])))
    .map((id) => ({
      id,
      label: `${'  '.repeat(ancestorIds(objects, id).length - 1)}${objects[id].name}`
    }))
}

// 이 컴포넌트 종류들의 object 속성이 쓰는 고르기 종류
export function objectPicksOf(types: readonly string[]): ObjectPick[] {
  const picks = new Set<ObjectPick>()
  for (const type of types) {
    if (!isComponentType(type)) continue
    for (const property of componentDef(type as ComponentType).properties)
      if (property.kind === 'object') picks.add(property.pick ?? 'any')
  }
  return [...picks]
}
