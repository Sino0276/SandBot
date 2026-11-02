import type { Vec3 } from '../scene/model'
import {
  MASS_CLOSURE_LIMIT,
  MASS_CLOSURE_OPEN,
  type MeshMassProps,
  type SymMatrix3
} from '../mass/types'
import { boundsCenter } from './alignment'

// 메시 하나의 단위 밀도 질량 성질(spec-3a §1). 워커의 convertMesh가 변환할 때 한 번 계산하고 메시 캐시에 넣는다.
// 발산 정리로 삼각형마다 닫힌 형태의 부분식을 더한다(Eberly, "Polyhedral Mass Properties (Revisited)", Geometric
// Tools 2002/2009 — Mirtich 1996과 같은 결과). 10개 적분(1, x, y, z, x², y², z², xy, yz, zx)을 한 번 훑어 구한다.
// 원점은 피벗(경계 상자 중심)이고 double로 더한다. 사칙연산과 제곱근만 쓰고 삼각형 순서대로 더하므로 결정적이다.

// 이보다 작은 부피(m³)는 표면으로 본다(질량 0, spec-3a §1). 가장 작은 실제 파트(M3 나사)도 약 1e-8 m³다.
export const MASS_MIN_VOLUME = 1e-12

// 질량 계산에서 메시를 어떻게 쓰는지. closed는 그대로, open은 근사로 쓰고(CAD 루트마다 개수를 보임), surface는 질량 0.
export type MeshMassState = 'closed' | 'open' | 'surface'

export function meshMassState(props: MeshMassProps): MeshMassState {
  if (!(props.volume >= MASS_MIN_VOLUME) || !(props.closure <= MASS_CLOSURE_LIMIT)) {
    return 'surface'
  }
  return props.closure > MASS_CLOSURE_OPEN ? 'open' : 'closed'
}

function surfaceProps(area: number): MeshMassProps {
  return { volume: 0, centroid: [0, 0, 0], inertia: [0, 0, 0, 0, 0, 0], area, closure: Infinity }
}

// positions: CAD 좌표 정점(미터, xyz 반복), indices: 삼각형. bounds는 positions의 경계 상자이고 그 중심이 피벗이다.
// 감김은 바깥에서 볼 때 반시계(occt-import-js는 REVERSED 면을 뒤집어 맞춘다)라고 보고, 전체가 반대면(부호 있는
// 부피 < 0) 모든 적분의 부호를 바꾼다(적분이 모두 면적 벡터에 선형이라 정확하다).
export function computeMeshMass(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  bounds: { min: Vec3; max: Vec3 }
): MeshMassProps {
  const [ox, oy, oz] = boundsCenter(bounds)
  // 부피는 세 축 형식(∫1을 x·y·z 법선 성분으로 구한 것)을 모두 더해 평균한다
  let vx = 0
  let vy = 0
  let vz = 0
  let ix = 0
  let iy = 0
  let iz = 0
  let ixx = 0
  let iyy = 0
  let izz = 0
  let ixy = 0
  let iyz = 0
  let izx = 0
  // 면적 벡터 합(2배)과 면적 합(2배)
  let sx = 0
  let sy = 0
  let sz = 0
  let area2 = 0

  const count = indices.length - (indices.length % 3)
  for (let t = 0; t < count; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const x0 = positions[a] - ox
    const y0 = positions[a + 1] - oy
    const z0 = positions[a + 2] - oz
    const x1 = positions[b] - ox
    const y1 = positions[b + 1] - oy
    const z1 = positions[b + 2] - oz
    const x2 = positions[c] - ox
    const y2 = positions[c + 1] - oy
    const z2 = positions[c + 2] - oz

    // d = (p1 − p0) × (p2 − p0): 면적 벡터의 2배
    const ux = x1 - x0
    const uy = y1 - y0
    const uz = z1 - z0
    const wx = x2 - x0
    const wy = y2 - y0
    const wz = z2 - z0
    const dx = uy * wz - uz * wy
    const dy = uz * wx - ux * wz
    const dz = ux * wy - uy * wx

    // 성분마다 Eberly 부분식 f1·f2·f3과 g0·g1·g2
    let s0 = x0 + x1
    const f1x = s0 + x2
    let s1 = x0 * x0
    let s2 = s1 + x1 * s0
    const f2x = s2 + x2 * f1x
    const f3x = x0 * s1 + x1 * s2 + x2 * f2x
    s0 = y0 + y1
    const f1y = s0 + y2
    s1 = y0 * y0
    s2 = s1 + y1 * s0
    const f2y = s2 + y2 * f1y
    const f3y = y0 * s1 + y1 * s2 + y2 * f2y
    s0 = z0 + z1
    const f1z = s0 + z2
    s1 = z0 * z0
    s2 = s1 + z1 * s0
    const f2z = s2 + z2 * f1z
    const f3z = z0 * s1 + z1 * s2 + z2 * f2z

    vx += dx * f1x
    vy += dy * f1y
    vz += dz * f1z
    ix += dx * f2x
    iy += dy * f2y
    iz += dz * f2z
    ixx += dx * f3x
    iyy += dy * f3y
    izz += dz * f3z
    // ∫xy는 x 성분의 g와 y, ∫yz는 y의 g와 z, ∫zx는 z의 g와 x로 구한다
    ixy +=
      dx *
      (y0 * (f2x + x0 * (f1x + x0)) + y1 * (f2x + x1 * (f1x + x1)) + y2 * (f2x + x2 * (f1x + x2)))
    iyz +=
      dy *
      (z0 * (f2y + y0 * (f1y + y0)) + z1 * (f2y + y1 * (f1y + y1)) + z2 * (f2y + y2 * (f1y + y2)))
    izx +=
      dz *
      (x0 * (f2z + z0 * (f1z + z0)) + x1 * (f2z + z1 * (f1z + z1)) + x2 * (f2z + z2 * (f1z + z2)))

    sx += dx
    sy += dy
    sz += dz
    area2 += Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  // 원점(피벗)을 꼭짓점으로 하는 사면체 부피의 합과 같은 값(V = (Vx + Vy + Vz) / 3)이다. 닫히면 세 값이 같다.
  // 열리면 축마다 다른데, 사면체 합은 원점을 o만큼 옮길 때 o·S/3만 바뀌므로 아래 closure가 그 오차의 상한이다.
  let volume = (vx + vy + vz) / 18
  // 좌표가 유한하지 않은 깨진 입력이어도 결과는 유한한 수로 둔다(캐시 확인과 질량 합성이 NaN을 받지 않게)
  const area = Number.isFinite(area2) ? area2 / 2 : 0
  const vectorArea = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2
  // 부피가 없는 메시(면만 있는 판, 스티커 등)는 무게중심이 정해지지 않는다. 피벗을 두고 질량 0으로 쓴다.
  if (!(Math.abs(volume) >= MASS_MIN_VOLUME)) return surfaceProps(area)
  // 뒤집힌 메시: 모든 적분의 부호를 바꾼다
  const sign = volume < 0 ? -1 : 1
  volume *= sign
  const cx = (sign * ix) / 24 / volume
  const cy = (sign * iy) / 24 / volume
  const cz = (sign * iz) / 24 / volume
  const xx = (sign * ixx) / 60
  const yy = (sign * iyy) / 60
  const zz = (sign * izz) / 60
  const xy = (sign * ixy) / 120
  const yz = (sign * iyz) / 120
  const zx = (sign * izx) / 120

  // 무게중심 기준으로 옮긴다. 비대각은 행렬 값(곱관성의 음수)이다.
  const inertia: SymMatrix3 = [
    yy + zz - volume * (cy * cy + cz * cz),
    zz + xx - volume * (cz * cz + cx * cx),
    xx + yy - volume * (cx * cx + cy * cy),
    -(xy - volume * cx * cy),
    -(zx - volume * cz * cx),
    -(yz - volume * cy * cz)
  ]

  // 닫힘 지표: 원점을 경계 상자 안에서 옮길 때 부피가 바뀌는 상한(|S|·R/3)을 부피로 나눈 것. 닫히면 0이다.
  const hx = (bounds.max[0] - bounds.min[0]) / 2
  const hy = (bounds.max[1] - bounds.min[1]) / 2
  const hz = (bounds.max[2] - bounds.min[2]) / 2
  const closure = (vectorArea * Math.sqrt(hx * hx + hy * hy + hz * hz)) / (3 * volume)
  const centroid: Vec3 = [cx, cy, cz]
  if (![...centroid, ...inertia, volume].every(Number.isFinite) || !(closure >= 0)) {
    return surfaceProps(area)
  }
  return { volume, centroid, inertia, area, closure }
}

// 메시 캐시에서 읽은 값의 모양 확인(isImportedModel)
export function isMeshMassProps(value: unknown): value is MeshMassProps {
  if (!value || typeof value !== 'object') return false
  const props = value as Partial<MeshMassProps>
  const finite = (list: unknown, length: number): boolean =>
    Array.isArray(list) &&
    list.length === length &&
    list.every((item) => typeof item === 'number' && Number.isFinite(item))
  return (
    typeof props.volume === 'number' &&
    Number.isFinite(props.volume) &&
    props.volume >= 0 &&
    typeof props.area === 'number' &&
    Number.isFinite(props.area) &&
    props.area >= 0 &&
    typeof props.closure === 'number' &&
    props.closure >= 0 &&
    finite(props.centroid, 3) &&
    finite(props.inertia, 6)
  )
}
