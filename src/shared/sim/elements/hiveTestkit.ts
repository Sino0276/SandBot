import { applyMatrix3, rotationMatrix } from '../seasons/fieldGeometry'
import type { FieldSpec } from '../seasons/fieldSpec'
import { resolveSeason } from '../seasons/seasons'
import type { SimElementKind, SimElementState, Vec3 } from '../worldSpec'
import { ball } from './elementTestkit'

// HIVE 넘어감(6b) 시험의 도구(시험 전용, 제품 코드는 쓰지 않는다): HIVE 몸체 틀 ↔ 필드 변환, 보정표(EFG §12.3)의 짐을
// 빨강 HIVE의 위로 향한 CELL(+X CELL, 시작 −30°)에 놓는 자리, 던지기, massMoment를 바꾼 필드.

export const BIOBUZZ = resolveSeason('biobuzz')
export const POLLEN_R = 0.03555
export const NECTAR_R = 0.0457
// CELL 트레이 안쪽 면(몸체 틀, 부록 A.1): Back Skin 공 쪽 면, 밑판 안쪽 면, 옆벽 안쪽 면, 옆벽·지붕 접합과 지붕 꼭대기
export const BACK_SKIN_X = 0.239725
export const FLOOR_Z = -0.037287
export const SIDE_Y = 0.256007
export const ROOF_APEX_Z = 0.327137
export const ROOF_SLOPE = 0.6389
// 보정표의 가장 가까운 안정 자세(빨강 시작 각)
export const START_ANGLE = -Math.PI / 6

// 빨강(k = 0)·파랑(k = 1) HIVE의 몸체 틀 점 p의 필드 좌표(각 θ에서)
export function hivePoint(field: FieldSpec, k: number, theta: number, p: Vec3): Vec3 {
  const hive = field.hives[k]
  const q = applyMatrix3(rotationMatrix({ x: 0, y: theta, z: 0 }), p)
  return { x: hive.pivot.x + q.x, y: hive.pivot.y + q.y, z: hive.pivot.z + q.z }
}

// 몸체 틀 벡터(속도)의 필드 좌표
export function hiveVector(theta: number, v: Vec3): Vec3 {
  return applyMatrix3(rotationMatrix({ x: 0, y: theta, z: 0 }), v)
}

// 두 HIVE의 massMoment(또는 관성·축 마찰)를 바꾼 필드(시험 전용 얕은 복사)
export function withHiveDynamics(
  field: FieldSpec,
  change: Partial<{ massMoment: number; inertia: number; pivotFriction: number }>
): FieldSpec {
  return {
    ...field,
    hives: field.hives.map((hive) => ({
      ...hive,
      dynamics: hive.dynamics ? { ...hive.dynamics, ...change } : hive.dynamics
    }))
  }
}

// 보정표의 짐: 'N'은 NECTAR, 'P'는 POLLEN
export type CalibrationLoad = { nectar: number; pollen: number }

const radiusOf = (kind: SimElementKind): number => (kind === 'pollen' ? POLLEN_R : NECTAR_R)

// 짐을 Back Skin과 밑판에 닿게 빨강 벽(−y_b) 쪽 옆벽부터 한 줄로 놓은 몸체 틀 중심(NECTAR 먼저, 닿은 채). 8번째 POLLEN은 둘째
// 줄(x_b + √3·r, 첫 줄 두 공 사이 가운데)에 얹는다(부록 B)
export function loadPositions(load: CalibrationLoad): { kind: SimElementKind; local: Vec3 }[] {
  const out: { kind: SimElementKind; local: Vec3 }[] = []
  let y = -SIDE_Y
  const row = (kind: SimElementKind, count: number): void => {
    const r = radiusOf(kind)
    for (let k = 0; k < count; k++) {
      out.push({
        kind,
        local: { x: BACK_SKIN_X + r, y: y + r, z: FLOOR_Z + r }
      })
      y += 2 * r
    }
  }
  row('nectarRed', load.nectar)
  // 첫 줄에 들어가는 POLLEN 수(NECTAR 셋과 한 줄이면 셋, POLLEN만이면 일곱)
  const pollenRow = Math.min(load.pollen, load.nectar > 0 ? 3 : 7)
  row('pollen', pollenRow)
  for (let extra = pollenRow; extra < load.pollen; extra++) {
    // 첫 줄의 마지막 두 공 사이(둘째 줄)
    const a = out[out.length - 1].local
    const b = out[out.length - 2].local
    out.push({
      kind: 'pollen',
      local: { x: a.x + Math.sqrt(3) * POLLEN_R, y: (a.y + b.y) / 2, z: FLOOR_Z + POLLEN_R }
    })
  }
  return out
}

// 위로 향한 CELL 안 한 점 위에서 던지는 공의 높이(m): 0.3 m 또는 지붕 아래로 들어가는 만큼 [가정: 던지기 = 그 자리 위 0.3 m에서
// 1 m/s로 아래로(몸체 −z_b). 옆벽 쪽 자리는 지붕이 낮아 지붕 아래까지만]
export function tossHeight(local: Vec3, r: number): number {
  const roof = Math.min(ROOF_APEX_Z - ROOF_SLOPE * Math.abs(local.y), ROOF_APEX_Z)
  return Math.max(0.01, Math.min(0.3, roof - r - 0.01 - local.z))
}

// 짐 상태(필드 좌표, 깨어 있고 정지). 마지막 공을 던지려면 toss를 켠다. k = 1이면 파랑 HIVE의 위로 향한 CELL(−X CELL, 시작 +30°)에
// 빨강 짐의 Rz(π) 거울(몸체 틀 (x, y, z) → (−x, −y, z), NECTAR는 파랑)을 놓는다
export function loadStates(
  field: FieldSpec,
  load: CalibrationLoad,
  options: { theta?: number; toss?: boolean; k?: number } = {}
): SimElementState[] {
  const k = options.k ?? 0
  const theta = options.theta ?? field.hives[k].startAngle
  const sign = k === 0 ? 1 : -1
  const placed = loadPositions(load)
  return placed.map(({ kind, local }, i) => {
    const last = i === placed.length - 1
    const mirrored = { x: sign * local.x, y: sign * local.y, z: local.z }
    const colored: SimElementKind = k === 0 || kind === 'pollen' ? kind : 'nectarBlue'
    if (options.toss && last) {
      const h = tossHeight(local, radiusOf(kind))
      return ball(colored, hivePoint(field, k, theta, { ...mirrored, z: local.z + h }), {
        velocity: hiveVector(theta, { x: 0, y: 0, z: -1 })
      })
    }
    return ball(colored, hivePoint(field, k, theta, mirrored))
  })
}
