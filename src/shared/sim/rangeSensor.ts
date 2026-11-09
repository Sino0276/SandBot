import { MAX_RAY_RANGE, MIN_RAY_T, type FieldRaycaster, type SurfaceRef } from './fieldRaycast'
import { sensorAxis, type SensorPose } from './sensorFrame'
import { noiseGaussian, noiseUniform } from './sensorNoise'
import type { Vec3 } from './worldSpec'

// REV 2m 거리 센서(ST VL53L0X) 모델(spec-4c §1.4, synthesis §4.4·§4.5, 순수·결정적). 25° 원뿔의 61광선을 필드 기본형에
// 쏘고(fieldRaycast.ts) 신호 가중 평균 거리와 신호 문턱으로 칩 거리를 만든다. 투명판은 거울 반환으로 더한다.
//
// 광선 k의 확산 신호 s = w_k·ρ_nir·cos τ/t²(τ 입사각), 투명판 거울은 s = C·0.514·g(φ)/D²(φ 축과 벽 법선의 각, D 판 안쪽 면까지
// 수직 거리, g = P(φ)/P̄). 보고 거리 d = (Σ확산 s·t/B + Σ거울 s·D)/Σs(B는 확산 광선에만, spec-4c §7.1-1), 유효 반사율
// ρ_eff = Σs·d²/C, 문턱 d_max(ρ_eff)를 넘으면 범위 밖(null)이다. 정면 램버트 평면·정면 판·둘이 섞인 것 모두 정확히 D다.

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

// 회 17% 아래 가지의 지수: 칩 신호율 문턱(0.25 MCPS)은 신호에 선형이라 d_max ∝ ρ^0.5(REV 드라이버는 호스트 sigma 검사를
// 하지 않는다, critique §3.1) [가정: 신호 가중 평균, 문턱 β, 흰색 1.2 m]
const LOW_REFLECTANCE_EXPONENT = 0.5
// 흰 88%·회 17%(DS Table 11·13의 표적 반사율)
const WHITE_REFLECTANCE = 0.88
const GREY_REFLECTANCE = 0.17

// 최대 거리 d_max(ρ_eff): ρ ≥ 0.17이면 0.8·(min(ρ, 0.88)/0.17)^β(흰 88% 1.2 m와 회 17% 0.8 m를 정확히 지나고 0.17에서
// 연속, ρ에 단조 비감소), 아래면 0.8·(ρ/0.17)^0.5
export function tofMaxRange(reflectance: number): number {
  if (reflectance >= GREY_REFLECTANCE)
    return (
      TOF_GREY_RANGE * (Math.min(reflectance, WHITE_REFLECTANCE) / GREY_REFLECTANCE) ** TOF_BETA
    )
  return TOF_GREY_RANGE * (reflectance / GREY_REFLECTANCE) ** LOW_REFLECTANCE_EXPONENT
}

// 장치 고정 오프셋의 크기(m): DS Table 14 오프셋 ±10 mm [가정: 잡음 분리(고정 ±10 mm, 측정마다 σ/√2)]
export const TOF_NOISE_OFFSET = 0.01
// 측정마다 잡음 σ = max(0.002, 0.0244·d³/ρ_eff)/√2(m): 흰 1.2 m 47.9 mm(4.0%), 회 0.7 m 49.2 mm(7.0%)로 DS Table 12의
// 반복 정확도와 맞춘 식이고, 고정 오프셋과 나눠 √2로 나눈다 [가정: 잡음 분리]
export const TOF_NOISE_FLOOR = 0.002
export const TOF_NOISE_SCALE = 0.0244
// 잡음 해시 흐름: 고정 오프셋은 균등 흐름 0(순번 0), 측정마다는 가우스 k = 1(균등 흐름 2·3, 순번 = 틱 시각 tNanos)
const OFFSET_STREAM = 0
const MEASUREMENT_GAUSSIAN = 1

// 측정마다 잡음의 표준 편차(m)
export function tofNoiseSigma(distance: number, reflectance: number): number {
  return Math.max(TOF_NOISE_FLOOR, (TOF_NOISE_SCALE * distance ** 3) / reflectance) / Math.SQRT2
}

// 신호를 낸 면의 키(같은 면끼리 더한다)
function surfaceKey(surface: SurfaceRef): string {
  switch (surface.kind) {
    case 'floor':
      return 'floor'
    case 'tape':
    case 'structure':
      return `${surface.kind}:${surface.index}`
    case 'rail':
    case 'panel':
      return `${surface.kind}:${surface.wall}`
  }
}

export function readRangeSensor(
  caster: FieldRaycaster,
  pose: SensorPose,
  noise?: RangeNoise
): RangeReading {
  const o = pose.origin
  const r = pose.rotation
  const rays: (number | null)[] = []
  // 면별 신호(처음 나온 순서: 축 광선부터 광선 순서, 거울은 마지막)
  const bySurface = new Map<string, { surface: SurfaceRef; signal: number }>()
  const addSignal = (surface: SurfaceRef, signal: number): void => {
    const key = surfaceKey(surface)
    const entry = bySurface.get(key)
    if (entry) entry.signal += signal
    else bySurface.set(key, { surface, signal })
  }
  let diffuse = 0
  let diffuseT = 0
  for (const ray of TOF_RAYS) {
    const d = ray.dir
    const dir = {
      x: r[0] * d.x + r[1] * d.y + r[2] * d.z,
      y: r[3] * d.x + r[4] * d.y + r[5] * d.z,
      z: r[6] * d.x + r[7] * d.y + r[8] * d.z
    }
    const hit = caster.cast(o, dir, MAX_RAY_RANGE)
    rays.push(hit ? hit.t : null)
    if (!hit) continue
    const t = Math.max(hit.t, MIN_RAY_T)
    const signal = (ray.weight * hit.nir * hit.cosIncidence) / (t * t)
    diffuse += signal
    diffuseT += signal * t
    addSignal(hit.surface, signal)
  }
  let mirror = 0
  let mirrorT = 0
  for (const candidate of caster.panelMirrors(o, sensorAxis(pose))) {
    const D = candidate.distance
    const gain = tofBeam(candidate.angle) / TOF_BEAM_MEAN
    const signal = (TOF_NORM * PANEL_MIRROR * gain) / (D * D)
    mirror += signal
    mirrorT += signal * D
    addSignal({ kind: 'panel', wall: candidate.wall }, signal)
  }
  const total = diffuse + mirror
  if (!(total > 0))
    return { distance: null, raw: null, reflectance: 0, maxRange: 0, surface: null, rays }
  const raw = (diffuseT / TOF_BIAS + mirrorT) / total
  const reflectance = (total * raw * raw) / TOF_NORM
  const maxRange = tofMaxRange(reflectance)
  let surface: SurfaceRef | null = null
  let strongest = 0
  for (const entry of bySurface.values())
    if (surface === null || entry.signal > strongest) {
      surface = entry.surface
      strongest = entry.signal
    }
  let distance: number | null = null
  if (raw <= maxRange) {
    let value = raw
    if (noise) {
      const offset =
        (2 * noiseUniform(noise.seed, noise.device, OFFSET_STREAM, 0) - 1) * TOF_NOISE_OFFSET
      const z = noiseGaussian(noise.seed, noise.device, MEASUREMENT_GAUSSIAN, noise.tNanos)
      value = Math.max(0, raw + offset + tofNoiseSigma(raw, reflectance) * z)
    }
    distance = Math.round(value * 1000) / 1000
  }
  return { distance, raw, reflectance, maxRange, surface, rays }
}
