import { MAX_PRELOADS } from '../../../shared/sim/worldSpec'
import {
  findRobotId,
  subtreeIds,
  type SceneObject,
  type SceneObjects,
  type Vec3 as Vec3T
} from './model'

// 프리로드 자리(Preload Slot, 6a, PROJECT_VERSION 14). 로봇이 싣고 시작하는 경기 요소 하나의 자리를 그 오브젝트의 로컬 틀(피벗,
// 자기 축)에 둔다(Unity의 빈 GameObject에 붙인 생성 지점 MonoBehaviour와 OnDrawGizmos 와이어 구). 시뮬레이터 설정이라 생성
// 코드·구성 XML·하드웨어 검증·사용처와 관계없다(바퀴·관절·충돌체와 같은 원칙). 길이는 m다(표시 단위 변환은 인스펙터에서만).
// 로봇마다 MAX_PRELOADS개까지 쓰고(넘으면 세계 설명 빌더가 하이어라키 순서로 앞의 것만 쓰고 알린다), 로봇에 자리가 없으면
// 시뮬레이터 공유 함수 autoPreloadSlots(src/shared/sim/elements/spawn.ts)가 로봇 앞 → 뒤 → 왼쪽 → 오른쪽에 둔다.

// 지금은 POLLEN만(BIOBUZZ 프리로드 규칙)
export type PreloadKind = 'pollen'
export const PRELOAD_KINDS: readonly PreloadKind[] = ['pollen']

export type PreloadSettings = {
  kind: PreloadKind
  // Unity Behaviour.enabled 자리. 끈 것만 false(키 없음 = 켬). 끈 자리는 세계 설명에 넣지 않는다
  enabled?: false
  // 공 중심(오브젝트 로컬, m)
  center: Vec3T
}

// 로봇 하나의 자리 수 한도(세계 설명 MAX_PRELOADS와 같다)
export const MAX_ROBOT_PRELOADS = MAX_PRELOADS
// center 성분 |c|의 한도(m, 세계 설명 MAX_COORD·Collider MAX_COLLIDER_EXTENT와 같다)
export const MAX_PRELOAD_EXTENT = 10

// 자리를 둘 수 있는 오브젝트: group·assembly·part(로봇·CAD 루트는 아님: CAD 루트 transform은 정렬이다, 바퀴와 같은 규칙)
export function canHavePreload(object: SceneObject): boolean {
  return object.kind !== 'robot' && !object.cad
}

export function isPreloadKind(value: unknown): value is PreloadKind {
  return typeof value === 'string' && (PRELOAD_KINDS as readonly string[]).includes(value)
}

// 스토어가 받는 값의 형식: 아는 종류, 유한한 수 셋의 center, enabled는 없거나 boolean(true는 정리가 지운다)
export function isWellFormedPreload(p: PreloadSettings): boolean {
  const { kind, center, enabled } = p as { kind: unknown; center: unknown; enabled?: unknown }
  return (
    isPreloadKind(kind) &&
    Array.isArray(center) &&
    center.length === 3 &&
    center.every((x) => Number.isFinite(x)) &&
    (enabled === undefined || typeof enabled === 'boolean')
  )
}

export function defaultPreload(): PreloadSettings {
  return { kind: 'pollen', center: [0, 0, 0] }
}

export function preloadEnabled(p: PreloadSettings): boolean {
  return p.enabled !== false
}

const clamp = (value: number): number =>
  Math.min(MAX_PRELOAD_EXTENT, Math.max(-MAX_PRELOAD_EXTENT, value)) + 0

// 범위를 자른 새 값(−0 없이). 키 순서는 kind, enabled?, center(직렬화·실행 취소 비교가 바이트로 안정하다). 형식 검사는
// 스토어·파일이 먼저 한다(isWellFormedPreload)
export function sanitizePreload(p: PreloadSettings): PreloadSettings {
  const center: Vec3T = [clamp(p.center[0]), clamp(p.center[1]), clamp(p.center[2])]
  return p.enabled === false ? { kind: p.kind, enabled: false, center } : { kind: p.kind, center }
}

// 값 비교(없음은 없음끼리만 같다)
export function samePreload(
  a: PreloadSettings | undefined,
  b: PreloadSettings | undefined
): boolean {
  if (!a || !b) return a === b
  return (
    a.kind === b.kind &&
    preloadEnabled(a) === preloadEnabled(b) &&
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    a.center[2] === b.center[2]
  )
}

// 로봇 하위의 자리가 있는 오브젝트(하이어라키 순서 = 문서 형제 순서의 깊이 우선, 끈 자리 포함)
export function robotPreloadIds(objects: SceneObjects, robotId: string): string[] {
  return subtreeIds(objects, robotId).filter((id) => id !== robotId && objects[id]?.preload)
}

// Add Component의 Preload Slot을 붙일 수 있는지: 둘 수 있는 오브젝트이고 아직 없고, 로봇 하위면 그 로봇의 자리(끈 것 포함)가
// MAX_ROBOT_PRELOADS보다 적다(로봇 밖 오브젝트는 세지 않는다: 인스펙터가 로봇 밖이라 쓰지 않는다고 알린다)
export function canAddPreload(objects: SceneObjects, id: string): boolean {
  const object = objects[id]
  if (!object || !canHavePreload(object) || object.preload) return false
  const robotId = findRobotId(objects, id)
  return robotId === null || robotPreloadIds(objects, robotId).length < MAX_ROBOT_PRELOADS
}
