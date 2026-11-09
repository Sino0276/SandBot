import { rotationMatrix } from './seasons/fieldGeometry'
import type { FieldMaterial, FieldShape, FieldSpec, FieldStructure } from './seasons/fieldSpec'
import type { Vec3 } from './worldSpec'

// 필드 기본형 광선(spec-4c §1.3, synthesis §4.5·§4.6, 순수·결정적, 배열 순서만 쓴다). 거리·컬러 센서(4c)와 4d 카메라
// 가림이 같이 쓴다. 바닥(타일 윗면 z = 0, 테이프 재질) → 벽(+x, −x, +y, −y: 레일·투명판 헤이즈) → 구조물(sensed이고
// carrier field, FieldSpec.structures 순번) 순서로 보고 더 작은 t만 바꾼다(같은 t면 앞의 것). 원점이 면 위나 공차
// 안쪽이어도 그 면을 본다(벽에 대고 민 로봇의 앞 센서, 바닥 높이 하우징, 명세 비평 X2). 그러지 않으면 면 너머를 보거나
// 신호 1/t²가 무한대가 된다.
//
// 필드 밖(투명판 너머, 위 레일 위, 판 이음)에는 형상이 없다. 벽은 모서리까지 이은 반평면이다(4ab 한계와 같다).
// 'none' 시즌도 같은 외곽 모델이다(레일·판 재질·이음은 BIOBUZZ 값, 반폭·높이만 field.ts 값, spec-4ab §1.2).

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

// 거울 반환 창의 반각: 거리 센서 원뿔 반각 TOF_HALF_ANGLE(rangeSensor.ts, DS §5.1 FOV 25°)과 같은 값이다. rangeSensor.ts가
// 이 모듈의 값을 import하므로 순환을 피해 여기서 같은 식으로 다시 만든다(rangeSensor.test.ts가 같음을 확인한다)
export const MIRROR_HALF_ANGLE = 12.5 * (Math.PI / 180)

// 방향 성분이 이보다 작으면 그 축과 나란하다고 본다(slab·벽·원기둥 옆면). 단위 방향의 성분이라 1e-12는 각 1e-12 rad이고,
// 그때 교차 거리는 1e12 m 넘게 멀어 MAX_RAY_RANGE 밖이다 [가정: 나란함 문턱]
const PARALLEL = 1e-12
// 넓은 단계 경계 구 반지름의 여유(m): 꼭짓점을 스치는 광선이 반올림으로 빠지지 않게 [가정: 경계 구 여유. 형상 m 단위
// 반올림 1e-16의 수천 배이고 넓은 단계라 크게 잡아도 결과는 같다]
const SPHERE_MARGIN = 1e-9

// 벽: 바깥 법선(필드 축)과 벽 방향 좌표 축. 순서 +x, −x, +y, −y가 계산 순서다
type Wall = { side: WallSide; normal: Vec3; along: 'x' | 'y' }
const WALLS: readonly Wall[] = [
  { side: 'plusX', normal: { x: 1, y: 0, z: 0 }, along: 'y' },
  { side: 'minusX', normal: { x: -1, y: 0, z: 0 }, along: 'y' },
  { side: 'plusY', normal: { x: 0, y: 1, z: 0 }, along: 'x' },
  { side: 'minusY', normal: { x: 0, y: -1, z: 0 }, along: 'x' }
]

const HAZE_RGB: readonly [number, number, number] = Object.freeze([
  PANEL_HAZE,
  PANEL_HAZE,
  PANEL_HAZE
]) as readonly [number, number, number]

// 생성자가 한 번 만든 구조물(field carrier만): 자기 틀 회전(행 우선, 열이 자기 축), 중심, 반 길이, 경계 구
type Solid = {
  index: number
  structure: FieldStructure
  kind: FieldShape['kind']
  rotation: number[]
  center: Vec3
  // 상자: 자기 축 반 길이, 원기둥: x = 반지름, z = 반 높이
  half: Vec3
  radius: number
}

// 상자·원기둥의 교차(자기 틀). inside: 원점이 형상 안(닫힌)일 때 가장 가까운 면까지 깊이와 그 면 법선(자기 틀)
type Local = { o: Vec3; d: Vec3 }
type Entry = { t: number; normal: Vec3 } | null
type Inside = { depth: number; normal: Vec3 } | null

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

// Rᵀ·v(행 우선 R의 열과의 내적)
function toLocal(r: readonly number[], v: Vec3): Vec3 {
  return {
    x: r[0] * v.x + r[3] * v.y + r[6] * v.z,
    y: r[1] * v.x + r[4] * v.y + r[7] * v.z,
    z: r[2] * v.x + r[5] * v.y + r[8] * v.z
  }
}

function toField(r: readonly number[], v: Vec3): Vec3 {
  return {
    x: r[0] * v.x + r[1] * v.y + r[2] * v.z,
    y: r[3] * v.x + r[4] * v.y + r[5] * v.z,
    z: r[6] * v.x + r[7] * v.y + r[8] * v.z
  }
}

const AXES = ['x', 'y', 'z'] as const
type Axis = (typeof AXES)[number]

function unit(axis: Axis, sign: number): Vec3 {
  return { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 }
}

// 상자 slab: 들어가는 면의 t(> 0)와 그 면 바깥 법선. 같은 t면 앞 축(x, y, z). 원점이 안이면 inside
function boxEntry(l: Local, half: Vec3): Entry {
  let tNear = -Infinity
  let tFar = Infinity
  let normal: Vec3 | null = null
  for (const axis of AXES) {
    const o = l.o[axis]
    const d = l.d[axis]
    const h = half[axis]
    if (Math.abs(d) < PARALLEL) {
      if (Math.abs(o) > h) return null
      continue
    }
    // d > 0이면 −h 면으로 들어가고(바깥 법선 −축), d < 0이면 +h 면으로 들어간다
    const enter = d > 0 ? (-h - o) / d : (h - o) / d
    const exit = d > 0 ? (h - o) / d : (-h - o) / d
    if (enter > tNear) {
      tNear = enter
      normal = unit(axis, d > 0 ? -1 : 1)
    }
    if (exit < tFar) tFar = exit
  }
  if (normal === null || tNear > tFar || tNear <= 0) return null
  return { t: tNear, normal }
}

// 원점이 상자 안(닫힌)이면 가장 가까운 면(같은 깊이면 +x, −x, +y, −y, +z, −z 순서)
function boxInside(o: Vec3, half: Vec3): Inside {
  if (Math.abs(o.x) > half.x || Math.abs(o.y) > half.y || Math.abs(o.z) > half.z) return null
  let best: Inside = null
  for (const axis of AXES) {
    for (const sign of [1, -1]) {
      const depth = half[axis] - sign * o[axis]
      if (best === null || depth < best.depth) best = { depth, normal: unit(axis, sign) }
    }
  }
  return best
}

// 세운 원기둥(자기 z 축, x = 반지름, z = 반 높이): 들어가는 옆면·뚜껑의 가장 작은 t(> 0)
function cylinderEntry(l: Local, half: Vec3): Entry {
  const { o, d } = l
  const r = half.x
  const hz = half.z
  let best: Entry = null
  const consider = (t: number, normal: Vec3): void => {
    if (t > 0 && (best === null || t < best.t)) best = { t, normal }
  }
  const c = o.x * o.x + o.y * o.y - r * r
  const a = d.x * d.x + d.y * d.y
  // 옆면: 반지름 밖에서 들어가는 근
  if (c > 0 && a > PARALLEL * PARALLEL) {
    const b = o.x * d.x + o.y * d.y
    const disc = b * b - a * c
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a
      const z = o.z + t * d.z
      if (Math.abs(z) <= hz) {
        const px = o.x + t * d.x
        const py = o.y + t * d.y
        const rho = Math.hypot(px, py)
        consider(t, { x: px / rho, y: py / rho, z: 0 })
      }
    }
  }
  // 뚜껑: 높이 밖에서 들어가는 면
  if (Math.abs(d.z) >= PARALLEL) {
    for (const sign of [1, -1]) {
      if (sign * o.z <= hz || sign * d.z >= 0) continue
      const t = (sign * hz - o.z) / d.z
      const px = o.x + t * d.x
      const py = o.y + t * d.y
      if (px * px + py * py <= r * r) consider(t, { x: 0, y: 0, z: sign })
    }
  }
  return best
}

// 원점이 원기둥 안(닫힌)이면 가장 가까운 면(같은 깊이면 옆면, 위, 아래 순서)
function cylinderInside(o: Vec3, half: Vec3): Inside {
  const rho = Math.hypot(o.x, o.y)
  if (rho > half.x || Math.abs(o.z) > half.z) return null
  // 축 위(rho 0)면 옆면 법선을 정할 수 없지만 그때 옆면 깊이는 반지름이라 공차 안이 아니다(+x로 둔다)
  let best: { depth: number; normal: Vec3 } = {
    depth: half.x - rho,
    normal: rho > 0 ? { x: o.x / rho, y: o.y / rho, z: 0 } : { x: 1, y: 0, z: 0 }
  }
  const top = half.z - o.z
  if (top < best.depth) best = { depth: top, normal: { x: 0, y: 0, z: 1 } }
  const bottom = half.z + o.z
  if (bottom < best.depth) best = { depth: bottom, normal: { x: 0, y: 0, z: -1 } }
  return best
}

export class FieldRaycaster {
  readonly field: FieldSpec
  private readonly innerHalf: number
  private readonly panelInner: number
  // 판 구간(열린): 첫 레일 띠 위 끝 < z < 둘째 띠 아래 끝
  private readonly panelLow: number
  private readonly panelHigh: number
  // 바닥 위 테이프(필드 밖 offField는 표시만이라 뺀다), FieldSpec.tape 순번을 지닌다
  private readonly tapes: { index: number; rect: readonly number[]; material: FieldMaterial }[]
  // field carrier 구조물(배열 순서). sensed는 cast, sensed·occludes는 blocked가 플래그로 고른다
  private readonly solids: Solid[]

  // 얼린 FieldSpec에서 배열 순서 그대로 한 번 만든다(구조물 경계 구 등)
  constructor(field: FieldSpec) {
    this.field = field
    const p = field.perimeter
    this.innerHalf = p.innerHalf
    this.panelInner = p.innerHalf + p.panelInset
    this.panelLow = p.railBands[0][1]
    this.panelHigh = p.railBands[1][0]
    this.tapes = []
    field.tape.forEach((tape, index) => {
      if (!tape.offField) this.tapes.push({ index, rect: tape.rect, material: tape.material })
    })
    this.solids = []
    field.structures.forEach((structure, index) => {
      if (structure.carrier !== 'field') return
      const shape = structure.shape
      const half =
        shape.kind === 'box'
          ? { x: shape.size.x / 2, y: shape.size.y / 2, z: shape.size.z / 2 }
          : { x: shape.radius, y: shape.radius, z: shape.height / 2 }
      const radius =
        (shape.kind === 'box'
          ? Math.hypot(half.x, half.y, half.z)
          : Math.hypot(shape.radius, half.z)) + SPHERE_MARGIN
      this.solids.push({
        index,
        structure,
        kind: shape.kind,
        rotation: rotationMatrix(shape.rotation),
        center: shape.center,
        half,
        radius
      })
    })
  }

  // origin에서 단위 방향 dir로 maxT 안의 가장 가까운 교차, 없으면 null
  cast(origin: Vec3, dir: Vec3, maxT: number): RayHit | null {
    let best: RayHit | null = this.floorHit(origin, dir, maxT)
    const wall = this.wallHit(origin, dir, maxT)
    if (wall && (best === null || wall.t < best.t)) best = wall
    for (const solid of this.solids) {
      if (!solid.structure.sensed) continue
      const limit = best === null ? maxT : best.t
      if (!this.mayHit(solid, origin, dir, limit)) continue
      const hit = this.solidHit(solid, origin, dir, limit)
      if (hit && (best === null || hit.t < best.t)) best = hit
    }
    return best
  }

  // origin에서 dir로 (0, maxT) 안에 flag가 참인 field carrier 구조물이 있는지. 원점이 안인 상자는 가리지 않는다.
  blocked(origin: Vec3, dir: Vec3, maxT: number, flag: BlockFlag): boolean {
    for (const solid of this.solids) {
      if (!solid.structure[flag]) continue
      if (!this.mayHit(solid, origin, dir, maxT)) continue
      const l = this.local(solid, origin, dir)
      const inside =
        solid.kind === 'box' ? boxInside(l.o, solid.half) : cylinderInside(l.o, solid.half)
      if (inside) continue
      const entry = solid.kind === 'box' ? boxEntry(l, solid.half) : cylinderEntry(l, solid.half)
      if (entry && entry.t < maxT) return true
    }
    return false
  }

  // 벽 투명판 거울 반환 후보(벽 순서 +x, −x, +y, −y): 축과 바깥 법선의 각 angle(≤ 12.5°), 판 안쪽 면까지 수직
  // 거리 distance(0 < D ≤ MAX_RAY_RANGE), 수선의 발이 판 구간·이음 밖이고 sensed 구조물이 수선을 가리지 않는 것
  panelMirrors(origin: Vec3, axis: Vec3): { wall: WallSide; distance: number; angle: number }[] {
    const out: { wall: WallSide; distance: number; angle: number }[] = []
    for (const wall of WALLS) {
      const n = wall.normal
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(axis, n))))
      if (angle > MIRROR_HALF_ANGLE) continue
      const distance = this.panelInner - dot(origin, n)
      if (!(distance > 0 && distance <= MAX_RAY_RANGE)) continue
      const foot = {
        x: origin.x + distance * n.x,
        y: origin.y + distance * n.y,
        z: origin.z + distance * n.z
      }
      if (!(foot.z > this.panelLow && foot.z < this.panelHigh)) continue
      const s = foot[wall.along]
      if (Math.abs(s) > this.innerHalf || this.inSeam(s)) continue
      if (this.blocked(origin, n, distance, 'sensed')) continue
      out.push({ wall: wall.side, distance, angle })
    }
    return out
  }

  // ---- 기본형 ----

  // 바닥(z = 0): 아래로 가고 원점이 공차 위면. 필드 안(|x|, |y| ≤ innerHalf)만, 재질은 처음 덮는 테이프(닫힌 사각형)
  private floorHit(o: Vec3, d: Vec3, maxT: number): RayHit | null {
    if (!(d.z < 0 && o.z > -SURFACE_TOLERANCE)) return null
    const t = Math.max(MIN_RAY_T, Math.max(o.z, 0) / -d.z)
    if (t > maxT) return null
    const x = o.x + t * d.x
    const y = o.y + t * d.y
    if (Math.abs(x) > this.innerHalf || Math.abs(y) > this.innerHalf) return null
    const cosIncidence = -d.z
    for (const tape of this.tapes) {
      const [x0, y0, x1, y1] = tape.rect
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1)
        return {
          t,
          cosIncidence,
          rgb: tape.material.rgb,
          nir: tape.material.nir,
          surface: { kind: 'tape', index: tape.index }
        }
    }
    const floor = this.field.floor.material
    return { t, cosIncidence, rgb: floor.rgb, nir: floor.nir, surface: { kind: 'floor' } }
  }

  // 벽: 가장 가까운 벽 평면(같은 t면 앞 벽)의 점 z로 레일·판·지나감을 가른다
  private wallHit(o: Vec3, d: Vec3, maxT: number): RayHit | null {
    let wall: Wall | null = null
    let t = Infinity
    let dn = 0
    let on = 0
    for (const candidate of WALLS) {
      const cdn = dot(d, candidate.normal)
      const con = dot(o, candidate.normal)
      if (!(cdn > PARALLEL && con < this.innerHalf + SURFACE_TOLERANCE)) continue
      const ct = Math.max(MIN_RAY_T, (this.innerHalf - con) / cdn)
      if (ct < t) {
        wall = candidate
        t = ct
        dn = cdn
        on = con
      }
    }
    if (wall === null) return null
    // 그 평면의 점(원점이 이미 면 밖이면 원점)
    const reach = Math.max(0, (this.innerHalf - on) / dn)
    const z = o.z + reach * d.z
    const s = o[wall.along] + reach * d[wall.along]
    if (this.field.perimeter.railBands.some(([lo, hi]) => z >= lo && z <= hi)) {
      if (t > maxT) return null
      const rail = this.field.perimeter.rail
      return {
        t,
        cosIncidence: dn,
        rgb: rail.rgb,
        nir: rail.nir,
        surface: { kind: 'rail', wall: wall.side }
      }
    }
    // 판: 분류는 레일 면의 z로 한다(판까지 2.3 mm 차이는 무시). 판 이음에서 레일은 이어지고 판 높이 광선은 지나간다
    if (z > this.panelLow && z < this.panelHigh && !this.inSeam(s)) {
      const tp = Math.max(MIN_RAY_T, (this.panelInner - on) / dn)
      if (tp > maxT) return null
      return {
        t: tp,
        cosIncidence: dn,
        rgb: HAZE_RGB,
        nir: PANEL_HAZE,
        surface: { kind: 'panel', wall: wall.side }
      }
    }
    return null
  }

  private inSeam(s: number): boolean {
    return this.field.perimeter.panelSeams.some(([lo, hi]) => s >= lo && s <= hi)
  }

  // 넓은 단계: 원점이 경계 구 안이면 늘 본다. 아니면 구가 광선 뒤에 있거나 광선과 중심의 수직 거리가 반지름보다 크거나
  // 구 전체가 maxT 밖이면 건너뛴다
  private mayHit(solid: Solid, o: Vec3, d: Vec3, maxT: number): boolean {
    const oc = { x: solid.center.x - o.x, y: solid.center.y - o.y, z: solid.center.z - o.z }
    const r2 = solid.radius * solid.radius
    const oc2 = dot(oc, oc)
    if (oc2 <= r2) return true
    const along = dot(oc, d)
    if (along < 0) return false
    if (oc2 - along * along > r2) return false
    return along - solid.radius <= maxT
  }

  private local(solid: Solid, o: Vec3, d: Vec3): Local {
    const c = solid.center
    return {
      o: toLocal(solid.rotation, { x: o.x - c.x, y: o.y - c.y, z: o.z - c.z }),
      d: toLocal(solid.rotation, d)
    }
  }

  // 구조물 하나: 원점이 안이면 가장 가까운 면까지 깊이가 공차 안이고 광선이 그 면에서 안쪽으로 갈 때만 그 면에 MIN_RAY_T로
  // 맞는다(더 깊으면 그 구조물을 무시한다: 걸친 시작을 밀어내지 않는 4ab 규칙과 같은 쪽). 밖이면 들어가는 면
  private solidHit(solid: Solid, o: Vec3, d: Vec3, maxT: number): RayHit | null {
    const l = this.local(solid, o, d)
    const inside =
      solid.kind === 'box' ? boxInside(l.o, solid.half) : cylinderInside(l.o, solid.half)
    let t: number
    let normal: Vec3
    if (inside) {
      if (!(inside.depth <= SURFACE_TOLERANCE && dot(l.d, inside.normal) < 0)) return null
      t = MIN_RAY_T
      normal = inside.normal
    } else {
      const entry = solid.kind === 'box' ? boxEntry(l, solid.half) : cylinderEntry(l, solid.half)
      if (entry === null) return null
      t = Math.max(MIN_RAY_T, entry.t)
      normal = entry.normal
    }
    if (t > maxT) return null
    const material = solid.structure.material
    return {
      t,
      cosIncidence: Math.abs(dot(d, toField(solid.rotation, normal))),
      rgb: material.rgb,
      nir: material.nir,
      surface: { kind: 'structure', index: solid.index }
    }
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
