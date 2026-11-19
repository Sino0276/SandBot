import type { Vec2 } from '../worldSpec'

// 시즌 데이터의 부품 다각형을 만드는 순수 도우미(6b, spec-6b §1.1·§1.3). FLOWER 고리를 22.5° 조각으로 나누고(공 조각),
// FLOWER 11을 FLOWER 9의 정확한 90° 상으로 만든다. 새 Math.sin·cos를 쓰지 않는다: 조각 각 k·22.5°의 cos·sin은 정확한 제곱근
// 식이고(collision3d.ts cylinderPrism과 같은 식), 90° 회전은 (x, y) → (−y, x)다(기준 해시가 Node를 올릴 때 다시 볼 것이 늘지
// 않게, spec-6b §1.1). 모듈이 읽힐 때 한 번 계산하는 시즌 데이터만 쓴다.

// 고리 조각 수 [가정: 22.5° 조각 16개, 안쪽 현이 구멍 원 안으로 들어오는 양 r_in·(1 − cos 11.25°) ≈ 0.7–0.9 mm, spec-6b §11]
export const RING_SECTORS = 16

const COS_22_5 = Math.sqrt(2 + Math.SQRT2) / 2
const COS_45 = Math.SQRT2 / 2
const COS_67_5 = Math.sqrt(2 - Math.SQRT2) / 2
const QUADRANT_COS = [1, COS_22_5, COS_45, COS_67_5]
const QUADRANT_SIN = [0, COS_67_5, COS_45, COS_22_5]

// k·22.5°(k = 0…15)의 단위 방향. 사분면마다 (x, y) → (−y, x)로 돌린다(정확한 부호 바꿈)
export function sectorDirection(k: number): Vec2 {
  const i = ((k % RING_SECTORS) + RING_SECTORS) % RING_SECTORS
  let x = QUADRANT_COS[i % 4]
  let y = QUADRANT_SIN[i % 4]
  for (let turn = 0; turn < Math.floor(i / 4); turn++) {
    const t = x
    x = y === 0 ? 0 : -y
    y = t
  }
  return { x, y }
}

// (x, y) → (−y, x): 원점 둘레 +90°(정확, −0 없음)
export function rotateQuarter(p: Vec2): Vec2 {
  return { x: p.y === 0 ? 0 : -p.y, y: p.x }
}

const crossOf = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

// 볼록 다각형을 반평면 {p : side(p) ≥ 0}으로 자른다(Sutherland–Hodgman 한 변). side는 선형 함수
function clip(polygon: readonly Vec2[], side: (p: Vec2) => number): Vec2[] {
  const out: Vec2[] = []
  for (let k = 0; k < polygon.length; k++) {
    const a = polygon[k]
    const b = polygon[(k + 1) % polygon.length]
    const fa = side(a)
    const fb = side(b)
    if (fa >= 0) out.push(a)
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb)
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
    }
  }
  return out
}

// 다각형 정리 공차(m): 이보다 가까운 점은 하나로, 넓이(×2)가 이것의 제곱보다 작은 꼭짓점은 일직선으로 보고 뺀다
// [결정: 시즌 데이터 반올림(1e-6 m)보다 작고 반올림 오차(1e-16)보다 크다]
const CLEAN_TOLERANCE = 1e-9

// 겹친 점·일직선 점을 뺀 볼록 반시계 다각형(fieldGeometry.ts isConvexCcwPolygon이 받는 꼴). 점이 셋보다 적으면 []
export function cleanPolygon(polygon: readonly Vec2[]): Vec2[] {
  let out = [...polygon]
  let changed = true
  while (changed && out.length >= 3) {
    changed = false
    for (let k = 0; k < out.length; k++) {
      const a = out[(k + out.length - 1) % out.length]
      const b = out[k]
      const c = out[(k + 1) % out.length]
      const near = Math.hypot(b.x - a.x, b.y - a.y) <= CLEAN_TOLERANCE
      if (near || crossOf(a, b, c) <= CLEAN_TOLERANCE * CLEAN_TOLERANCE) {
        out = [...out.slice(0, k), ...out.slice(k + 1)]
        changed = true
        break
      }
    }
  }
  return out.length >= 3 ? out : []
}

// 볼록 반시계 바깥 다각형(원점 둘레)을 안쪽 반지름 r_in의 구멍으로 뚫고 k·22.5° 조각으로 나눈 조각 다각형(반시계, 원점 기준).
// 조각 k = 광선 k·22.5°와 (k + 1)·22.5° 사이 ∩ 두 광선 위 r_in 점을 잇는 현의 바깥 ∩ 바깥 다각형. sectors: 만들 조각 번호
// (기본 0…15). 바깥 다각형과 만나지 않는 조각은 빈 배열 대신 뺀다(돌려주는 것은 [조각 번호, 다각형])
export function ringSectorPolygons(
  outer: readonly Vec2[],
  rInner: number,
  sectors: readonly number[] = Array.from({ length: RING_SECTORS }, (_, k) => k)
): [number, Vec2[]][] {
  const out: [number, Vec2[]][] = []
  for (const k of sectors) {
    const d0 = sectorDirection(k)
    const d1 = sectorDirection(k + 1)
    const a = { x: rInner * d0.x, y: rInner * d0.y }
    const b = { x: rInner * d1.x, y: rInner * d1.y }
    let polygon = clip(outer, (p) => d0.x * p.y - d0.y * p.x)
    polygon = clip(polygon, (p) => d1.y * p.x - d1.x * p.y)
    polygon = clip(polygon, (p) => crossOf(b, a, p))
    const cleaned = cleanPolygon(polygon)
    if (cleaned.length >= 3) out.push([k, cleaned])
  }
  return out
}
