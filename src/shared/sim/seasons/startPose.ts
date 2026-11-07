import type { Pose2, Vec2 } from '../worldSpec'
import {
  fieldOverlaps,
  OVERLAP_TOLERANCE,
  placeFootprint,
  polygonSeparation,
  rectPolygon,
  type FieldOverlap
} from './fieldGeometry'
import type { FieldRect, FieldSpec, FieldStartPreset, FieldWallName } from './fieldSpec'
import { wrapPi } from './symmetry'

// 시작 위치 프리셋과 스냅(spec-4ab §1.7, 순수·결정적). 규칙은 G304(자기 진영, 벽에 닿음, FLOWER·득점 부피·LOADING ZONE 밖,
// 18 in 정육면체 안)이고 헤딩 조건은 없다. 이것은 G304 전체 검사가 아니다: 프리셋은 18 in 외곽이면 만들 때부터 합법이고
// (checkFieldSpec), 더 큰 외곽은 스냅 결과를 startConflicts로 다시 확인한다.

// 18 in(R102 시작 크기): 시작 표시·데이터 시험의 벽에서의 깊이
export const START_DEPTH = 0.4572

// 벽을 보는 면 [결정: crit-ux §4.4. G304에 헤딩 조건이 없고 팀은 인테이크·카메라 때문에 반대로 서기도 한다]
export type StartFacing = 'default' | 'reverse' | 'left' | 'right'
export const START_FACINGS: readonly StartFacing[] = ['default', 'reverse', 'left', 'right']

const FACING_OFFSET: Record<StartFacing, number> = {
  default: 0,
  reverse: Math.PI,
  left: Math.PI / 2,
  right: -Math.PI / 2
}

export function facingYaw(preset: FieldStartPreset, facing: StartFacing): number {
  return wrapPi(preset.yaw + FACING_OFFSET[facing])
}

const FRAMES: Record<FieldWallName, { normal: Vec2; along: Vec2 }> = {
  red: { normal: { x: 0, y: -1 }, along: { x: 1, y: 0 } },
  blue: { normal: { x: 0, y: 1 }, along: { x: 1, y: 0 } },
  audience: { normal: { x: 1, y: 0 }, along: { x: 0, y: 1 } },
  scoring: { normal: { x: -1, y: 0 }, along: { x: 0, y: 1 } }
}

// 벽의 바깥 법선 n(필드 축)과 along 축 u(+X 또는 +Y)
export function presetWallFrame(wall: FieldWallName): { normal: Vec2; along: Vec2 } {
  const frame = FRAMES[wall]
  return { normal: { ...frame.normal }, along: { ...frame.along } }
}

// 시작 표시·데이터 시험의 사각형: along × 벽에서 START_DEPTH
export function presetRect(preset: FieldStartPreset, innerHalf: number): FieldRect {
  const [a0, a1] = preset.along
  const inner = innerHalf - START_DEPTH
  switch (preset.wall) {
    case 'red':
      return [a0, -innerHalf, a1, -inner]
    case 'blue':
      return [a0, inner, a1, innerHalf]
    case 'audience':
      return [inner, a0, innerHalf, a1]
    case 'scoring':
      return [-innerHalf, a0, -inner, a1]
  }
}

export type StartSnap =
  { ok: true; pose: Pose2 } | { ok: false; reason: 'tooWide'; width: number; available: number }

// 폭이 구간과 같은 외곽의 허용(m)
const FIT_TOLERANCE = 1e-9

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y

// target: 외곽 중심(벽 방향)의 목표 좌표. 없으면 구간 가운데. 가장 바깥 꼭짓점이 벽 면에 정확히 닿는다(간격 0, 여유 없음).
// 벽 행 목표가 −max(gap, 0)/h라 1 ulp 걸쳐도 밀어내지 않는다.
export function snapRobotToStart(
  footprint: readonly Vec2[],
  preset: FieldStartPreset,
  innerHalf: number,
  target?: number,
  facing: StartFacing = 'default'
): StartSnap {
  const yaw = facingYaw(preset, facing)
  // 로봇 원점이 외곽 중심이라는 보장은 없다(CAD 경계 상자): 원점에 둔 외곽을 돌린 꼭짓점 w_k
  const turned = placeFootprint(footprint, { x: 0, y: 0, yaw })
  const { normal, along } = presetWallFrame(preset.wall)
  const us = turned.map((w) => dot(w, along))
  const uMin = Math.min(...us)
  const uMax = Math.max(...us)
  const [a0, a1] = preset.along
  const width = uMax - uMin
  const available = a1 - a0
  if (width > available + FIT_TOLERANCE) return { ok: false, reason: 'tooWide', width, available }
  const center = target ?? (a0 + a1) / 2
  const lo = a0 - uMin
  const hi = a1 - uMax
  const s = lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, center - (uMin + uMax) / 2))
  const d = innerHalf - Math.max(...turned.map((w) => dot(w, normal)))
  return {
    ok: true,
    pose: { x: d * normal.x + s * along.x, y: d * normal.y + s * along.y, yaw }
  }
}

// 인스펙터 "시작 위치"·시작 표시가 쓰는 target: 지금 자세의 외곽이 그 프리셋 사각형 안(모든 꼭짓점, 1e-6)이면 그 축 정렬
// 상자 중심의 벽 방향 좌표, 아니면 undefined(구간 가운데) [결정: synthesis §2.7 "지금 로봇의 벽 방향 좌표"의 해석]
export function presetTarget(
  preset: FieldStartPreset,
  innerHalf: number,
  footprint: readonly Vec2[],
  pose: Pose2
): number | undefined {
  const placed = placeFootprint(footprint, pose)
  const [x0, y0, x1, y1] = presetRect(preset, innerHalf)
  const tol = OVERLAP_TOLERANCE
  const inside = placed.every(
    (p) => p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol
  )
  if (!inside) return undefined
  const xs = placed.map((p) => p.x)
  const ys = placed.map((p) => p.y)
  const { along } = presetWallFrame(preset.wall)
  return along.x !== 0
    ? (Math.min(...xs) + Math.max(...xs)) / 2
    : (Math.min(...ys) + Math.max(...ys)) / 2
}

// 감은 각 차(−π, π]
function angleDifference(a: number, b: number): number {
  const d = a - b
  return d - 2 * Math.PI * Math.round(d / (2 * Math.PI))
}

// 같다고 보는 자세 차(인스펙터 표시용): 위치 1e-6 m, 요 1e-9 rad
const MATCH_POSITION = 1e-6
const MATCH_YAW = 1e-9

// 지금 자세가 어느 프리셋·면의 스냅 결과와 같은지(프리셋 순서 × START_FACINGS 순서의 처음 것). 같은 것이 없으면 null
export function matchingPreset(
  spec: FieldSpec,
  footprint: readonly Vec2[],
  pose: Pose2
): { key: string; facing: StartFacing } | null {
  const innerHalf = spec.perimeter.innerHalf
  for (const preset of spec.startPresets) {
    const target = presetTarget(preset, innerHalf, footprint, pose)
    for (const facing of START_FACINGS) {
      const snap = snapRobotToStart(footprint, preset, innerHalf, target, facing)
      if (
        snap.ok &&
        Math.abs(snap.pose.x - pose.x) <= MATCH_POSITION &&
        Math.abs(snap.pose.y - pose.y) <= MATCH_POSITION &&
        Math.abs(angleDifference(snap.pose.yaw, pose.yaw)) <= MATCH_YAW
      )
        return { key: preset.key, facing }
    }
  }
  return null
}

// 스냅 결과의 충돌: fieldOverlaps(벽·solid 구조물) 다음에 loadingZone(두 얼라이언스, zones 순서)과 1e-6 넘게 겹치는 것
export type StartConflict = FieldOverlap | { kind: 'zone'; index: number }

export function startConflicts(
  spec: FieldSpec,
  footprint: readonly Vec2[],
  pose: Pose2,
  height: number
): StartConflict[] {
  const out: StartConflict[] = fieldOverlaps(spec, footprint, pose, height)
  const placed = placeFootprint(footprint, pose)
  spec.zones.forEach((zone, index) => {
    if (
      zone.key === 'loadingZone' &&
      polygonSeparation(placed, rectPolygon(zone.rect)) < -OVERLAP_TOLERANCE
    )
      out.push({ kind: 'zone', index })
  })
  return out
}
