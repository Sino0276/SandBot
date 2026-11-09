import type { FieldRaycaster, SurfaceRef } from './fieldRaycast'
import type { SensorPose } from './sensorFrame'
import type { Vec3 } from './worldSpec'

// REV 2m 거리 센서(ST VL53L0X) 모델(spec-4c §1.4, synthesis §4.4·§4.5, 순수·결정적). 25° 원뿔의 61광선을 필드 기본형에
// 쏘고(fieldRaycast.ts) 신호 가중 평균 거리와 신호 문턱으로 칩 거리를 만든다. 투명판은 거울 반환으로 더한다.
//
// 계약 커밋: 광선 배치·빔·상수는 구현했고(기즈모·시험이 쓰는 순수 계산), readRangeSensor는 "물체 없음" 스텁이다.
// 4c A가 구현한다.

const DEG = Math.PI / 180

// 원뿔 반각: DS §5.1 FOV 25°
export const TOF_HALF_ANGLE = 12.5 * DEG
// 고리마다 광선 수: 축 1 + 6 + 12 + 18 + 24 = 61(같은 입체각 배치, synthesis §4.4-1)
export const TOF_RINGS = [1, 6, 12, 18, 24] as const

// 방출 세기 × 수광 감도 P(θ) = 2(1 − (θ/α)²) [가정: 포물선 빔 P(θ) 61광선. 확산 무게와 거울 창이 같은 함수]
export function tofBeam(theta: number): number {
  const u = theta / TOF_HALF_ANGLE
  return 2 * (1 - u * u)
}

export type TofRay = { theta: number; psi: number; weight: number; dir: Vec3 }

// 광선 배치(센서 틀): 고리 0은 축 하나, 고리 k ≥ 1의 중심각 θ_k = acos(1 − (1 − cos α)·m_k/61), m_k = 앞 고리 칸 수의
// 합 + n_k/2. 방위각 ψ_j = 2π·(j + o_k)/n_k이고 고리 1·3(k 홀수)은 반 칸(o_k = 0.5) 엇갈린다. 방향
// (cos θ, sin θ·sin ψ, sin θ·cos ψ)(ψ = 0이 센서 +Z, +Y 쪽으로 감). 무게 w = P(θ)/ΣP(합은 광선 순서).
// 모듈이 읽힐 때 계산한다(리터럴로 두면 Python 값과 V8 값이 ulp 단위로 다르다, 명세 비평 P1).
function buildRays(): { rays: TofRay[]; beamSum: number } {
  const total = TOF_RINGS.reduce((sum, n) => sum + n, 0)
  const cap = 1 - Math.cos(TOF_HALF_ANGLE)
  const raw: { theta: number; psi: number; beam: number }[] = [
    { theta: 0, psi: 0, beam: tofBeam(0) }
  ]
  let before = TOF_RINGS[0]
  for (let k = 1; k < TOF_RINGS.length; k++) {
    const n = TOF_RINGS[k]
    const theta = Math.acos(1 - (cap * (before + n / 2)) / total)
    const offset = k % 2 === 1 ? 0.5 : 0
    for (let j = 0; j < n; j++)
      raw.push({ theta, psi: (2 * Math.PI * (j + offset)) / n, beam: tofBeam(theta) })
    before += n
  }
  let beamSum = 0
  for (const ray of raw) beamSum += ray.beam
  const rays = raw.map(({ theta, psi, beam }) => {
    const s = Math.sin(theta)
    return {
      theta,
      psi,
      weight: beam / beamSum,
      dir: { x: Math.cos(theta), y: s * Math.sin(psi), z: s * Math.cos(psi) }
    }
  })
  return { rays, beamSum }
}

const built = buildRays()

export const TOF_RAYS: readonly Readonly<TofRay>[] = Object.freeze(
  built.rays.map((ray) => Object.freeze({ ...ray, dir: Object.freeze(ray.dir) }))
)
// P̄ = ΣP(θ_k)/61 ≈ 1.0016551129101(부록 A)
export const TOF_BEAM_MEAN = built.beamSum / TOF_RAYS.length

function weightedCosSum(power: number): number {
  let sum = 0
  for (const ray of TOF_RAYS) sum += ray.weight * Math.cos(ray.theta) ** power
  return sum
}

// B = Σw·cos²θ/Σw·cos³θ ≈ 1.0082741271986795: 정면 램버트 평면의 확산 가중 평균 t를 D로 되돌린다(확산 광선에만 나눈다)
export const TOF_BIAS = weightedCosSum(2) / weightedCosSum(3)
// C = Σw·cos³θ ≈ 0.9754822026109987: 정면 꽉 찬 평면의 Σs·D²(ρ_eff = Σs·d²/C가 정확히 ρ가 되게)
export const TOF_NORM = weightedCosSum(3)
// 신호 문턱 지수 β = ln(1.2/0.8)/ln(0.88/0.17) ≈ 0.24661475576654543: 흰 88% 1.2 m와 회 17% 0.8 m를 정확히 지난다
// [가정: 신호 가중 평균, 문턱 β, 흰색 1.2 m]
export const TOF_BETA = Math.log(1.2 / 0.8) / Math.log(0.88 / 0.17)
// 투명판 거울 반환의 램버트 등가 반사율: 프레넬 n = 1.585 두 면(R_tot 9.744%)의 π·R_tot/(4Ω)
// [가정: 폴리카보네이트 거울 0.514·g(φ), synthesis §4.5]
export const PANEL_MIRROR = 0.514
// 흰 88%의 최대 거리(m): DS Table 13 Default·Table 11 Minimum / REV "default profile range is 120cm"
export const TOF_WHITE_RANGE = 1.2
// 회 17%의 최대 거리(m): DS Table 11 Typical(기본 프로필의 회색 값이 따로 없어 쓴다)
export const TOF_GREY_RANGE = 0.8

export type RangeReading = {
  // 보낼 값(m, 1 mm 반올림) 또는 범위 밖(null, 칩 8190 mm)
  distance: number | null
  // 문턱·반올림 전 d(신호가 없으면 null)
  raw: number | null
  // ρ_eff
  reflectance: number
  // d_max(ρ_eff)
  maxRange: number
  // 신호를 가장 많이 낸 면(인스펙터 표시)
  surface: SurfaceRef | null
  // 광선마다 맞은 t(기즈모 모선, TOF_RAYS 순서), 빗나가면 null
  rays: readonly (number | null)[]
}

// 거리 센서 잡음(spec-4c §1.6, 켰을 때만 넘긴다): 시드, 장치 이름(장치 고정 오프셋과 측정마다 잡음의 해시 입력),
// 측정 번호로 쓰는 틱 시각(tNanos) [가정: 잡음 분리(고정 ±10 mm, 측정마다 σ/√2)]
export type RangeNoise = { seed: number; device: string; tNanos: number }

export function readRangeSensor(
  caster: FieldRaycaster,
  pose: SensorPose,
  noise?: RangeNoise
): RangeReading {
  void caster
  void pose
  void noise
  return {
    distance: null,
    raw: null,
    reflectance: 0,
    maxRange: 0,
    surface: null,
    rays: TOF_RAYS.map(() => null)
  }
}
