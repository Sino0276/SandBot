import {
  MATERIAL_KEYS,
  type MassSettings,
  type MaterialKey,
  type RigidbodySettings
} from '../mass/types'
import type { SceneObject, Vec3 } from './model'

// 질량 설정(SceneObject.mass·rigidbody, PROJECT_VERSION 7)의 범위와 정리. 바퀴(scene/wheel.ts)처럼 시뮬레이터 전용
// 설정이라 생성 코드·구성 XML·검증·사용처와 관계없다. 스토어·프로젝트 파일 읽기·Add Component가 같이 쓴다.
// 내부 값은 kg·m다(표시 단위 변환은 인스펙터에서만).

// 질량 덮어쓰기 범위(kg, 0 < m ≤ 100). FTC 로봇 하나(대개 25–35 lb)를 넉넉히 넘는다.
export const MAX_OVERRIDE_MASS = 100
// 저울 무게 범위(kg, 0 < m ≤ 200)
export const MAX_WEIGHED_MASS = 200
// 무게중심 덮어쓰기의 성분 한도(m, |x| ≤ 10). 세계 설명의 위치 한도(MAX_COORD)와 같다.
export const MAX_CENTER_OF_MASS = 10

export function isMaterialKey(value: unknown): value is MaterialKey {
  return typeof value === 'string' && (MATERIAL_KEYS as readonly string[]).includes(value)
}

// 질량 설정을 붙일 수 있는 오브젝트: assembly·part·group·CAD 루트(로봇은 rigidbody)
export function canHaveMass(object: SceneObject): boolean {
  return object.kind !== 'robot'
}

export function canHaveRigidbody(object: SceneObject): boolean {
  return object.kind === 'robot'
}

// 정리할 입력: 스토어는 MassSettings를, 프로젝트 파일은 형식을 모르는 값을 넘긴다
type Unchecked<T> = { [K in keyof T]?: unknown }

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

const positiveUpTo = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max

const isCenterOfMass = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((x) => inRange(x, -MAX_CENTER_OF_MASS, MAX_CENTER_OF_MASS))

// 모르는 재질 키, 범위 밖·유한하지 않은 수, 형식이 틀린 값은 그 필드만 버린다(바퀴와 달리 기본값으로 바꾸지 않는다:
// 비어 있으면 "추정"이라는 뜻이다). 빈 설정 {}도 그대로 둔다(질량 카드만 붙이고 아직 아무것도 정하지 않은 상태).
// 키 순서는 늘 같다(material, infill, mass, centerOfMass): 저장한 파일이 바이트 단위로 같게 다시 써진다.
export function sanitizeMass(settings: Unchecked<MassSettings>): MassSettings {
  const result: MassSettings = {}
  if (isMaterialKey(settings.material)) result.material = settings.material
  if (inRange(settings.infill, 0, 1)) result.infill = settings.infill
  if (positiveUpTo(settings.mass, MAX_OVERRIDE_MASS)) result.mass = settings.mass
  if (isCenterOfMass(settings.centerOfMass)) {
    const [x, y, z] = settings.centerOfMass
    result.centerOfMass = [x, y, z]
  }
  return result
}

// 로봇 Rigidbody. 정한 것이 없으면 null(카드는 로봇이면 늘 보이므로 빈 설정은 두지 않는다)
export function sanitizeRigidbody(
  settings: Unchecked<RigidbodySettings>
): RigidbodySettings | null {
  const result: RigidbodySettings = {}
  if (positiveUpTo(settings.weighedMass, MAX_WEIGHED_MASS))
    result.weighedMass = settings.weighedMass
  if (isMaterialKey(settings.defaultMaterial)) result.defaultMaterial = settings.defaultMaterial
  return result.weighedMass === undefined && result.defaultMaterial === undefined ? null : result
}

const sameVec3 = (a: Vec3 | undefined, b: Vec3 | undefined): boolean =>
  a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2])

export function sameMass(a: MassSettings | undefined, b: MassSettings | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.material === b.material &&
    a.infill === b.infill &&
    a.mass === b.mass &&
    sameVec3(a.centerOfMass, b.centerOfMass)
  )
}

export function sameRigidbody(
  a: RigidbodySettings | undefined,
  b: RigidbodySettings | undefined
): boolean {
  if (!a || !b) return a === b
  return a.weighedMass === b.weighedMass && a.defaultMaterial === b.defaultMaterial
}
