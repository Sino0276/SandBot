import type { SceneObject, WheelKind, WheelRollers, WheelSettings } from './model'

// 바퀴(SceneObject.wheel, PROJECT_VERSION 6)의 기본값과 범위. 시뮬레이터 전용 설정이라 생성 코드·구성 XML·검증과 관계없다.
// 내부 값은 미터·라디안이다(표시 단위 변환은 인스펙터에서만).

export const WHEEL_KINDS: readonly WheelKind[] = ['mecanum', 'omni', 'traction']
export const WHEEL_ROLLERS: readonly WheelRollers[] = ['auto', 'flbr', 'frbl']

// 종류별 기본 지름(m): goBILDA 104 mm 메카넘(3613-0001-0104), 96 mm 옴니·그립 바퀴
export const DEFAULT_WHEEL_DIAMETERS: Record<WheelKind, number> = {
  mecanum: 0.104,
  omni: 0.096,
  traction: 0.096
}

// 지름 범위(m). 세계 설명(src/shared/sim/worldSpec.ts)의 반지름 한도(0.001–1 m) 안에 있다.
export const MIN_WHEEL_DIAMETER = 0.005
export const MAX_WHEEL_DIAMETER = 1
// 모터 출력축 → 바퀴 외부 감속비 범위(세계 설명 한도 0.001–1000 안)
export const MIN_WHEEL_GEAR_RATIO = 0.01
export const MAX_WHEEL_GEAR_RATIO = 100

export function defaultWheel(kind: WheelKind = 'mecanum'): WheelSettings {
  return {
    kind,
    diameter: DEFAULT_WHEEL_DIAMETERS[kind],
    motor: '',
    gearRatio: 1,
    angle: 0,
    rollers: 'auto'
  }
}

export function isWheelKind(value: unknown): value is WheelKind {
  return typeof value === 'string' && (WHEEL_KINDS as readonly string[]).includes(value)
}

export function isWheelRollers(value: unknown): value is WheelRollers {
  return typeof value === 'string' && (WHEEL_ROLLERS as readonly string[]).includes(value)
}

// 바퀴를 붙일 수 있는 오브젝트: assembly·part·group(CAD 루트·로봇은 아님. CAD 루트 transform은 정렬이라 바퀴 자리가 아니다)
export function canHaveWheel(object: SceneObject): boolean {
  return object.kind !== 'robot' && !object.cad
}

// 각을 (−π, π]로 감는다
export function wrapAngle(radians: number): number {
  const turn = 2 * Math.PI
  const wrapped = radians - turn * Math.floor((radians + Math.PI) / turn)
  // floor 경계에서 −π가 나오면 π로 둔다
  return wrapped <= -Math.PI ? wrapped + turn : wrapped
}

const finiteIn = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max

// 범위 밖·유한하지 않은 수는 기본값으로, 각은 (−π, π]로 감는다(스토어와 프로젝트 파일 읽기가 같이 쓴다)
export function sanitizeWheel(wheel: WheelSettings): WheelSettings {
  const fallback = defaultWheel(wheel.kind)
  return {
    kind: wheel.kind,
    diameter: finiteIn(wheel.diameter, MIN_WHEEL_DIAMETER, MAX_WHEEL_DIAMETER)
      ? wheel.diameter
      : fallback.diameter,
    motor: wheel.motor,
    gearRatio: finiteIn(wheel.gearRatio, MIN_WHEEL_GEAR_RATIO, MAX_WHEEL_GEAR_RATIO)
      ? wheel.gearRatio
      : fallback.gearRatio,
    angle: Number.isFinite(wheel.angle) ? wrapAngle(wheel.angle) : fallback.angle,
    rollers: wheel.rollers
  }
}

export function sameWheel(a: WheelSettings | undefined, b: WheelSettings | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.kind === b.kind &&
    a.diameter === b.diameter &&
    a.motor === b.motor &&
    a.gearRatio === b.gearRatio &&
    a.angle === b.angle &&
    a.rollers === b.rollers
  )
}
