import type { FieldRaycaster, SurfaceRef } from './fieldRaycast'
import type { SensorPose } from './sensorFrame'

// REV Color Sensor V3(Broadcom APDS-9151) 모델(spec-4c §1.5, synthesis §4.7, 순수·결정적). SDK 드라이버의 칩 설정은
// 고정이다(BroadcomColorSensor$Parameters, BroadcomColorSensorImpl.initialize): LS 3×, 16비트·25 ms 적분, 100 ms 주기,
// PS 11비트·100 ms. 세계는 이 기준(3×·25 ms)의 칩 원래 값을 보내고, 팀이 LS 설정을 바꾸면 사이드카 칩이 척도를 바꾼다.
//
// 계약 커밋: 상수·타입·시그니처와 "물체 없음" 스텁(배경 79·85·55, PS 27)이다. 4c A가 구현한다.

const INCH = 0.0254

// K: ρ 1, 정면 1 in에서 green counts(3×·25 ms) [가정: 색 K. 가장 큰 미지수]
export const COLOR_LED_GAIN = 700
// 주변광 조도 E_a(lux) [가정: 색 E_a 500 lux]
export const COLOR_AMBIENT_LUX = 500
// 3×·25 ms(16비트)의 lux/count(APDS-9151 DS p.9 표) [확인]
export const COLOR_LUX_PER_COUNT = 1.1834
// 주변광 그늘 s(d) = d/(d + 0.01 m)(센서가 면에 붙을수록 자기 그늘) [가정: 색 s(d)]
export const COLOR_SHADE_LENGTH = 0.01
// 칩 원래 값의 채널 비: 드라이버가 red에 1.07, blue에 1.55를 곱하는 보정을 되돌려, 보정 뒤 회색 면의 세 채널이 같게
// 둔다 [가정: 칩 분광 감도 대신 드라이버 보정을 그대로 쓴다, synthesis §4.7]
export const COLOR_WHITE_BALANCE: readonly [number, number, number] = [1 / 1.07, 1, 1 / 1.55]
// REV 근접 맞춤 지수 1/0.75934(RevColorSensorV3.java:75–77)
export const COLOR_FALLOFF = 1.3169
// REV getDistance 하한이자 PS 포화 거리(DS 그림 10) [가정: d ≥ 0.25 in]
export const COLOR_MIN_DISTANCE = 0.25 * INCH
// 발자국 고리 반경/거리: 축 + atan(0.6) 기운 6광선 [가정: 7점 발자국 반경 0.6·d]
export const COLOR_FOOTPRINT_SPREAD = 0.6
// ρ_bg: 축이 빗나가거나 판 너머일 때 주변광이 비친 먼 장면 [가정: 배경 ρ_bg 0.2. 0이면 HSV hue가 빨강이 된다, P14]
export const COLOR_BACKGROUND = 0.2
// RevColorSensorV3 근접 맞춤(card stock 정면): PS = C + A·d_in^−1.3169
export const PROXIMITY_A = 325.961
export const PROXIMITY_C = 26.98
// 근접 맞춤의 기준 NIR 반사율 [가정: ρ_ref 0.5, 근거 범위 0.2–0.8의 가운데]
export const PROXIMITY_REFERENCE = 0.5
// 물체 없음의 PS(round(26.98))
export const PROXIMITY_NONE = 27

export type ColorReading = {
  // 칩 원래 값(정수 0..65535, 3×·25 ms 기준)
  red: number
  green: number
  blue: number
  // 근접(정수 0..2047)
  proximity: number
  // 축 교차 거리(m, 자르기 전), 없으면 null(인스펙터 표시)
  distance: number | null
  // 축 광선이 맞은 면
  surface: SurfaceRef | null
  // 발자국 7광선 t(기즈모), 빗나가면 null
  footprint: readonly (number | null)[]
}

export function readColorSensor(caster: FieldRaycaster, pose: SensorPose): ColorReading {
  void caster
  void pose
  // 축이 빗나갔을 때의 배경: round(wb_c·ρ_bg·E_a/1.1834) = (79, 85, 55), PS 27
  return {
    red: 79,
    green: 85,
    blue: 55,
    proximity: PROXIMITY_NONE,
    distance: null,
    surface: null,
    footprint: [null, null, null, null, null, null, null]
  }
}
