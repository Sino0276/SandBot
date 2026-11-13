import type { SimElementKind, Vec3 } from '../worldSpec'
import type {
  Alliance,
  FieldCarrier,
  FieldElementPlacement,
  FieldHive,
  FieldMaterial,
  FieldRect,
  FieldStartPreset,
  FieldStructure,
  FieldTag,
  FieldTape,
  FieldWallName,
  FieldZone
} from './fieldSpec'

// 필드의 Z축 180° 회전 대칭(spec-4ab §1.3 "대칭 생성"). 시즌 데이터는 짝마다 한쪽만 적고 다른 쪽은 이 함수들로 만든다.
// [가정: 파랑 = 빨강의 180° 회전] CAD 비대칭(≤ 0.016 in)은 버리고 공칭 대칭값을 쓴다.
//
// cos·sin 행렬로 돌리지 않고 정확한 부호 반전(neg)과 각 감기(wrapPi)만 쓴다. 그래서 생성값은 원본과 비트까지 대칭이고 −0을
// 만들지 않는다. carrier 데이터 틀에서도 같은 규칙이다: 파랑 carrier 데이터 = Rz(π)·빨강 carrier 데이터이고,
// Rz(π)·T(p)·R_y(θ) = T(Rz(π)p)·R_y(−θ)·Rz(π)라 파랑 HIVE 각은 빨강 각의 부호를 바꾼 것이다(spec-4ab §1.3, synthesis §2.5).

// 부호 반전(−0을 만들지 않는다)
export const neg = (v: number): number => (v === 0 ? 0 : -v)

// (−π, π]로 감는다(한 번만: 입력은 (−3π, 3π])
export function wrapPi(a: number): number {
  if (a > Math.PI) return a - 2 * Math.PI
  if (a <= -Math.PI) return a + 2 * Math.PI
  return a
}

// Rz(π)의 3×3 행렬(행 우선). 데이터 시험이 회전 행렬을 비교할 때 쓴다
export const ROTATE_PI: readonly number[] = [-1, 0, 0, 0, -1, 0, 0, 0, 1]

export function mirrorVec3(v: Vec3): Vec3 {
  return { x: neg(v.x), y: neg(v.y), z: v.z }
}

// Rz(π)·Rz(c)Ry(b)Rx(a) = Rz(c + π)Ry(b)Rx(a)라 정확하다
export function mirrorRotation(r: Vec3): Vec3 {
  return { x: r.x, y: r.y, z: wrapPi(r.z + Math.PI) }
}

export function mirrorCarrier(carrier: FieldCarrier): FieldCarrier {
  if (carrier === 'hiveRed') return 'hiveBlue'
  if (carrier === 'hiveBlue') return 'hiveRed'
  return 'field'
}

export const mirrorAlliance = (alliance: Alliance): Alliance =>
  alliance === 'red' ? 'blue' : 'red'

export function mirrorStructure(s: FieldStructure): FieldStructure {
  const shape = s.shape
  return {
    ...s,
    shape:
      shape.kind === 'box'
        ? {
            kind: 'box',
            center: mirrorVec3(shape.center),
            rotation: mirrorRotation(shape.rotation),
            size: shape.size
          }
        : {
            kind: 'cylinder',
            center: mirrorVec3(shape.center),
            rotation: mirrorRotation(shape.rotation),
            radius: shape.radius,
            height: shape.height
          },
    carrier: mirrorCarrier(s.carrier)
  }
}

// SDK getBioBuzzTagLibrary 묶음 이름의 짝(빨강 득점 CELL ↔ 파랑 관중석 CELL)
const TAG_CLUSTER_MIRROR: Record<string, string> = {
  'RED SCORING': 'BLUE AUDIENCE',
  'RED AUDIENCE': 'BLUE SCORING'
}

// id + 8: 빨강 30–37 → 파랑 38–45(FAC 1.11, synthesis §2.6)
export const TAG_ID_MIRROR_OFFSET = 8

export function mirrorTag(t: FieldTag): FieldTag {
  return {
    id: t.id + TAG_ID_MIRROR_OFFSET,
    size: t.size,
    carrier: mirrorCarrier(t.carrier),
    position: mirrorVec3(t.position),
    rotation: mirrorRotation(t.rotation),
    cluster: t.cluster === null ? null : (TAG_CLUSTER_MIRROR[t.cluster] ?? t.cluster)
  }
}

export function mirrorRect([x0, y0, x1, y1]: FieldRect): FieldRect {
  return [neg(x1), neg(y1), neg(x0), neg(y0)]
}

// material: 상대 얼라이언스의 테이프 재질(빨강 ProGaff → electric blue)
export function mirrorTape(t: FieldTape, material: FieldMaterial): FieldTape {
  const tape: FieldTape = {
    key: t.key,
    alliance: mirrorAlliance(t.alliance),
    rect: mirrorRect(t.rect),
    material
  }
  if (t.offField) tape.offField = true
  return tape
}

export function mirrorZone(z: FieldZone): FieldZone {
  return { key: z.key, alliance: mirrorAlliance(z.alliance), rect: mirrorRect(z.rect) }
}

export function mirrorKeepOut(k: { rect: FieldRect }): { rect: FieldRect } {
  return { rect: mirrorRect(k.rect) }
}

export function mirrorHive(h: FieldHive): FieldHive {
  return {
    key: h.key === 'hiveRed' ? 'hiveBlue' : 'hiveRed',
    pivot: mirrorVec3(h.pivot),
    startAngle: neg(h.startAngle),
    tippedAngle: neg(h.tippedAngle)
  }
}

const WALL_MIRROR: Record<FieldWallName, FieldWallName> = {
  red: 'blue',
  blue: 'red',
  audience: 'scoring',
  scoring: 'audience'
}

export function mirrorWall(wall: FieldWallName): FieldWallName {
  return WALL_MIRROR[wall]
}

// key: 짝 프리셋의 이름(라벨이 위치를 말하므로 빨강과 다르다, spec-4ab §1.7 표)
export function mirrorPreset(p: FieldStartPreset, key: string): FieldStartPreset {
  return {
    key,
    alliance: mirrorAlliance(p.alliance),
    wall: mirrorWall(p.wall),
    along: [neg(p.along[1]), neg(p.along[0])],
    yaw: wrapPi(p.yaw + Math.PI)
  }
}

// 공 종류의 Rz(π) 짝: 얼라이언스 색이 있는 NECTAR는 색을 바꾸고, POLLEN은 그대로
export function mirrorElementKind(kind: SimElementKind): SimElementKind {
  if (kind === 'nectarRed') return 'nectarBlue'
  if (kind === 'nectarBlue') return 'nectarRed'
  return kind
}

// 시작 배치 하나(6a): 위치는 정확한 부호 반전, 묶음은 그대로, 색 있는 종류는 상대 얼라이언스
export function mirrorElementPlacement(p: FieldElementPlacement): FieldElementPlacement {
  return { group: p.group, kind: mirrorElementKind(p.kind), position: mirrorVec3(p.position) }
}
