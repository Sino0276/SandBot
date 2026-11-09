import type { FieldSpec } from './seasons/fieldSpec'
import type { Vec3 } from './worldSpec'

// 필드 기본형 광선(spec-4c §1.3, synthesis §4.5·§4.6, 순수·결정적, 배열 순서만 쓴다). 거리·컬러 센서(4c)와 4d 카메라
// 가림이 같이 쓴다. 바닥(타일 윗면 z = 0, 테이프 재질) → 벽(+x, −x, +y, −y: 레일·투명판 헤이즈) → 구조물(sensed이고
// carrier field, FieldSpec.structures 순번) 순서로 보고 더 작은 t만 바꾼다(같은 t면 앞의 것). 원점이 면 위나 공차
// 안쪽이어도 그 면을 본다(벽에 대고 민 로봇의 앞 센서, 바닥 높이 하우징).
//
// 계약 커밋: 타입·상수·시그니처와 "물체 없음" 스텁이다(cast null, blocked false, panelMirrors []). 4c A가 구현한다.

export type WallSide = 'plusX' | 'minusX' | 'plusY' | 'minusY'

// 광선이 맞은 면
export type SurfaceRef =
  | { kind: 'floor' }
  // FieldSpec.tape 순번
  | { kind: 'tape'; index: number }
  | { kind: 'rail'; wall: WallSide }
  // 투명판 헤이즈
  | { kind: 'panel'; wall: WallSide }
  // FieldSpec.structures 순번
  | { kind: 'structure'; index: number }

export type RayHit = {
  // 교차 거리(m, ≥ MIN_RAY_T)
  t: number
  // |d·n| ∈ (0, 1]
  cosIncidence: number
  // 맞은 면 재질의 가시 반사율(FieldMaterial.rgb, 판이면 PANEL_HAZE)
  rgb: readonly [number, number, number]
  // 근적외 반사율(FieldMaterial.nir, 판이면 PANEL_HAZE)
  nir: number
  surface: SurfaceRef
}

// 이보다 먼 교차는 반환이 0이다(m, synthesis §4.4-2: 흰 88% 1.2 m의 두 배 남짓이라 어떤 재질도 문턱을 넘지 못한다)
export const MAX_RAY_RANGE = 2.5
// 판에 닿은 광선의 램버트 반사율(모든 채널) [가정: 헤이즈 0.01, synthesis §6]
export const PANEL_HAZE = 0.01
// 원점이 면 위·살짝 안이어도 그 면을 보는 공차(m) [가정: 표면 공차. 4ab 접촉의 µm 침투·CAD 경계 오차보다 크고 실제
// 센서가 닿는 거리보다 작다]
export const SURFACE_TOLERANCE = 0.002
// 면 위·살짝 안 원점의 교차 거리(m) [가정: 최소 광선 거리. 신호 1/t²가 무한대가 되지 않게]
export const MIN_RAY_T = 0.0005

// blocked가 보는 구조물 플래그: 'sensed'는 4c 거울 반환 가림, 'occludes'는 4d 카메라 가림(fieldSpec.ts FieldStructure)
export type BlockFlag = 'sensed' | 'occludes'

export class FieldRaycaster {
  readonly field: FieldSpec

  // 얼린 FieldSpec에서 배열 순서 그대로 한 번 만든다(구조물 경계 구 등)
  constructor(field: FieldSpec) {
    this.field = field
  }

  // origin에서 단위 방향 dir로 maxT 안의 가장 가까운 교차, 없으면 null
  cast(origin: Vec3, dir: Vec3, maxT: number): RayHit | null {
    void origin
    void dir
    void maxT
    return null
  }

  // origin에서 dir로 (0, maxT) 안에 flag가 참인 field carrier 구조물이 있는지. 원점이 안인 상자는 가리지 않는다.
  blocked(origin: Vec3, dir: Vec3, maxT: number, flag: BlockFlag): boolean {
    void origin
    void dir
    void maxT
    void flag
    return false
  }

  // 벽 투명판 거울 반환 후보(벽 순서 +x, −x, +y, −y): 축과 바깥 법선의 각 angle(≤ 12.5°), 판 안쪽 면까지 수직
  // 거리 distance(0 < D ≤ MAX_RAY_RANGE), 수선의 발이 판 구간·이음 밖이고 sensed 구조물이 수선을 가리지 않는 것
  panelMirrors(origin: Vec3, axis: Vec3): { wall: WallSide; distance: number; angle: number }[] {
    void origin
    void axis
    return []
  }
}

// 얼린 FieldSpec(모듈 상수)마다 하나를 둔다(인스펙터가 카드·문서 변경마다 다시 만들지 않게)
const raycasters = new WeakMap<FieldSpec, FieldRaycaster>()

export function raycasterFor(field: FieldSpec): FieldRaycaster {
  let caster = raycasters.get(field)
  if (!caster) {
    caster = new FieldRaycaster(field)
    raycasters.set(field, caster)
  }
  return caster
}
