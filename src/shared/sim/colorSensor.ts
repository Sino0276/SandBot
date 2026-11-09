import { MAX_RAY_RANGE, type FieldRaycaster, type RayHit, type SurfaceRef } from './fieldRaycast'
import { sensorAxis, type SensorPose } from './sensorFrame'
import type { Vec3 } from './worldSpec'

// REV Color Sensor V3(Broadcom APDS-9151) 모델(spec-4c §1.5, synthesis §4.7, 순수·결정적). SDK 드라이버의 칩 설정은
// 고정이다(BroadcomColorSensor$Parameters, BroadcomColorSensorImpl.initialize): LS 3×, 16비트·25 ms 적분, 100 ms 주기,
// PS 11비트·100 ms. 세계는 이 기준(3×·25 ms)의 칩 원래 값을 보내고, 팀이 LS 설정을 바꾸면 사이드카 칩이 척도를 바꾼다.
//
// 축 광선이 맞은 거리 d(0.25 in에서 자름)와 입사각, 발자국 7점(축 + atan(0.6) 기운 6광선)의 평균 반사율로
//   raw_c = clamp(round(wb_c·[ρ̄^L_c·K·cos τ·d_in^−1.3169 + ρ̄^A_c·E_a·s(d)/1.1834]), 0, 65535)
//   PS = clamp(round(26.98 + 325.961·(ρ̄^N/0.5)·cos τ·d_in^−1.3169), 0, 2047)
// LED 반사(ρ^L, 판이면 헤이즈, 빗나가면 0), 주변광(ρ^A, 빗나가거나 판이면 판 너머 배경 ρ_bg), 근적외(ρ^N, 판이면 헤이즈,
// 빗나가면 0). 축이 빗나가면 배경만이다. 컬러에는 거울 반환과 잡음이 없다(근거가 없다, spec-4c §1.5).

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

// 칩 원래 값의 범위: LS 16비트(SDK colorSaturation 65535), PS 11비트(proximitySaturation 2047)
const COLOR_MAX = 65535
const PROXIMITY_MAX = 2047

// 발자국의 바깥 6광선(센서 틀): 축에서 β = atan(0.6) 기울고 방위각 0°, 60°, …, 300°(센서 +Z부터 +Y 쪽). 정면 평면에서 반경
// 0.6·d의 6점이다. 모듈이 읽힐 때 한 번 만든다
const FOOTPRINT_DIRECTIONS: readonly Vec3[] = (() => {
  const beta = Math.atan(COLOR_FOOTPRINT_SPREAD)
  const dirs: Vec3[] = [{ x: 1, y: 0, z: 0 }]
  for (let k = 0; k < 6; k++) {
    const psi = (k * Math.PI) / 3
    dirs.push({
      x: Math.cos(beta),
      y: Math.sin(beta) * Math.sin(psi),
      z: Math.sin(beta) * Math.cos(psi)
    })
  }
  return Object.freeze(dirs.map((d) => Object.freeze(d)))
})()

// 발자국 7방향(센서 틀, 축이 먼저): 기즈모가 같은 방향을 그린다
export const COLOR_FOOTPRINT: readonly Vec3[] = FOOTPRINT_DIRECTIONS

const clampRound = (value: number, max: number): number =>
  Math.max(0, Math.min(max, Math.round(value)))

// 축 광선이 빗나갔을 때(배경만): round(wb_c·ρ_bg·E_a/1.1834) = (79, 85, 55), PS 27
function background(): ColorReading {
  const ambient = (c: number): number =>
    clampRound(
      (COLOR_WHITE_BALANCE[c] * COLOR_BACKGROUND * COLOR_AMBIENT_LUX) / COLOR_LUX_PER_COUNT,
      COLOR_MAX
    )
  return {
    red: ambient(0),
    green: ambient(1),
    blue: ambient(2),
    proximity: PROXIMITY_NONE,
    distance: null,
    surface: null,
    footprint: FOOTPRINT_DIRECTIONS.map(() => null)
  }
}

// 축 광선이 빗나간 값(인스펙터·방어 값이 같이 쓴다)
export const COLOR_BACKGROUND_READING: Readonly<ColorReading> = Object.freeze(background())

export function readColorSensor(caster: FieldRaycaster, pose: SensorPose): ColorReading {
  const o = pose.origin
  const axisHit = caster.cast(o, sensorAxis(pose), MAX_RAY_RANGE)
  if (!axisHit) return background()
  const r = pose.rotation
  const hits: (RayHit | null)[] = [axisHit]
  for (let k = 1; k < FOOTPRINT_DIRECTIONS.length; k++) {
    const d = FOOTPRINT_DIRECTIONS[k]
    const dir = {
      x: r[0] * d.x + r[1] * d.y + r[2] * d.z,
      y: r[3] * d.x + r[4] * d.y + r[5] * d.z,
      z: r[6] * d.x + r[7] * d.y + r[8] * d.z
    }
    hits.push(caster.cast(o, dir, MAX_RAY_RANGE))
  }
  const led = [0, 0, 0]
  const ambient = [0, 0, 0]
  let nir = 0
  for (const hit of hits) {
    const panel = hit !== null && hit.surface.kind === 'panel'
    for (let c = 0; c < 3; c++) {
      led[c] += hit ? hit.rgb[c] : 0
      ambient[c] += hit && !panel ? hit.rgb[c] : COLOR_BACKGROUND
    }
    nir += hit ? hit.nir : 0
  }
  const n = hits.length
  const d = Math.max(axisHit.t, COLOR_MIN_DISTANCE)
  const cos = axisHit.cosIncidence
  // 부록 A 기준 스크립트(s4c2/sim2.py)와 같은 곱 순서(정수 반올림 경계에서 같게)
  const falloff = (d / INCH) ** -COLOR_FALLOFF
  const shade = d / (d + COLOR_SHADE_LENGTH)
  const channel = (c: number): number =>
    clampRound(
      COLOR_WHITE_BALANCE[c] *
        ((led[c] / n) * COLOR_LED_GAIN * cos * falloff +
          ((ambient[c] / n) * COLOR_AMBIENT_LUX * shade) / COLOR_LUX_PER_COUNT),
      COLOR_MAX
    )
  return {
    red: channel(0),
    green: channel(1),
    blue: channel(2),
    proximity: clampRound(
      PROXIMITY_C + PROXIMITY_A * (nir / n / PROXIMITY_REFERENCE) * cos * falloff,
      PROXIMITY_MAX
    ),
    distance: axisHit.t,
    surface: axisHit.surface,
    footprint: hits.map((hit) => (hit ? hit.t : null))
  }
}
