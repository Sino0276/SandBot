import { describe, expect, it } from 'vitest'
import { WALL_INNER_HALF } from '../field'
import type { Pose2, Vec2 } from '../worldSpec'
import {
  fieldOverlaps,
  placeFootprint,
  polygonSeparation,
  rectPolygon,
  solidFootprints
} from './fieldGeometry'
import { resolveSeason } from './seasons'
import {
  facingYaw,
  matchingPreset,
  presetRect,
  presetTarget,
  presetWallFrame,
  snapRobotToStart,
  START_DEPTH,
  START_FACINGS,
  startConflicts,
  type StartSnap
} from './startPose'

// K5·K6(spec-4ab §5): 시작 프리셋 스냅과 겹침 판정

const biobuzz = resolveSeason('biobuzz')
const INNER = biobuzz.perimeter.innerHalf
const H18 = 0.4572

function rectangle(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 }
  ]
}

// 18 in 정사각형(원점 중심)과 원점이 중심이 아닌 비대칭 사각형
const SQUARE = rectangle(-H18 / 2, -H18 / 2, H18 / 2, H18 / 2)
const OFFSET = rectangle(-0.1, -0.15, 0.3, 0.2)

// 떨어진 볼록 다각형 둘의 유클리드 거리(꼭짓점과 상대 변 사이 거리의 최솟값)
function polygonDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  const pointSegment = (p: Vec2, s: Vec2, e: Vec2): number => {
    const dx = e.x - s.x
    const dy = e.y - s.y
    const t = Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(p.x - (s.x + t * dx), p.y - (s.y + t * dy))
  }
  let best = Infinity
  for (const [p, q] of [
    [a, b],
    [b, a]
  ])
    for (const v of p)
      for (let i = 0; i < q.length; i++)
        best = Math.min(best, pointSegment(v, q[i], q[(i + 1) % q.length]))
  return best
}

function poseOf(snap: StartSnap): Pose2 {
  if (!snap.ok) throw new Error(`snap failed: ${JSON.stringify(snap)}`)
  return snap.pose
}

describe('K5 스냅', () => {
  it.each([
    ['18 in 정사각형', SQUARE],
    ['비대칭 사각형', OFFSET]
  ])(
    '%s: 12 프리셋 × 4 면에서 간격 0, 구간 안, 요가 facingYaw, matchingPreset이 알아본다',
    (_, footprint) => {
      expect(biobuzz.startPresets).toHaveLength(12)
      for (const preset of biobuzz.startPresets)
        for (const facing of START_FACINGS) {
          const pose = poseOf(snapRobotToStart(footprint, preset, INNER, undefined, facing))
          expect(pose.yaw).toBe(facingYaw(preset, facing))
          const placed = placeFootprint(footprint, pose)
          const { normal, along } = presetWallFrame(preset.wall)
          const outward = Math.max(...placed.map((p) => p.x * normal.x + p.y * normal.y))
          expect(Math.abs(outward - INNER)).toBeLessThanOrEqual(1e-12)
          const us = placed.map((p) => p.x * along.x + p.y * along.y)
          expect(Math.min(...us)).toBeGreaterThanOrEqual(preset.along[0] - 1e-12)
          expect(Math.max(...us)).toBeLessThanOrEqual(preset.along[1] + 1e-12)
          // 구간 가운데에 외곽 중심
          expect((Math.min(...us) + Math.max(...us)) / 2).toBeCloseTo(
            (preset.along[0] + preset.along[1]) / 2,
            12
          )
          expect(matchingPreset(biobuzz, footprint, pose)).toEqual({ key: preset.key, facing })
        }
    }
  )

  it('target을 구간 안으로 자르고, 폭이 구간보다 넓으면 tooWide(90° 돌린 면은 들어간다)', () => {
    const preset = biobuzz.startPresets.find((p) => p.key === 'scoringWallCenter')!
    // 앞 0.55 m, 옆 0.3 m: 요 0(default)이면 벽 방향 폭이 0.3, left면 0.55 > 0.51867
    const long = rectangle(-0.275, -0.15, 0.275, 0.15)
    expect(snapRobotToStart(long, preset, INNER, undefined, 'default').ok).toBe(true)
    const wide = snapRobotToStart(long, preset, INNER, undefined, 'left')
    expect(wide.ok).toBe(false)
    if (!wide.ok) {
      expect(wide.reason).toBe('tooWide')
      expect(wide.width).toBeCloseTo(0.55, 12)
      expect(wide.available).toBeCloseTo(0.51867, 12)
    }
    // target이 구간 밖이면 끝에 붙는다
    const pose = poseOf(snapRobotToStart(SQUARE, preset, INNER, 5))
    expect(pose.y + H18 / 2).toBeCloseTo(preset.along[1], 12)
  })

  it('1e-9 안에서 구간보다 넓으면 구간 가운데(lo > hi)', () => {
    const preset = biobuzz.startPresets.find((p) => p.key === 'redWallCenter')!
    const span = preset.along[1] - preset.along[0]
    // 빨강 벽 요 +π/2: 로봇 Y가 벽 방향(−X)
    const footprint = rectangle(-0.2, -(span + 5e-10) / 2, 0.2, (span + 5e-10) / 2)
    const pose = poseOf(snapRobotToStart(footprint, preset, INNER, preset.along[0]))
    const us = placeFootprint(footprint, pose).map((p) => p.x)
    expect((Math.min(...us) + Math.max(...us)) / 2).toBeCloseTo(
      (preset.along[0] + preset.along[1]) / 2,
      12
    )
  })

  it('presetTarget: 사각형 안이면 지금 외곽 중심, 아니면 undefined', () => {
    const preset = biobuzz.startPresets.find((p) => p.key === 'redWallAudience')!
    const pose = poseOf(snapRobotToStart(SQUARE, preset, INNER, 1.0))
    expect(presetTarget(preset, INNER, SQUARE, pose)).toBeCloseTo(1.0, 12)
    expect(presetTarget(preset, INNER, SQUARE, { x: 0, y: 0, yaw: 0 })).toBeUndefined()
    // 요 30°로 돌린 로봇은 사각형 밖이라 undefined(구간 가운데로 스냅)
    expect(presetTarget(preset, INNER, SQUARE, { ...pose, yaw: Math.PI / 6 })).toBeUndefined()
    expect(presetRect(preset, INNER)).toEqual([0.66967, -INNER, 1.7241, -(INNER - START_DEPTH)])
  })
})

describe('K6 겹침', () => {
  it("'none' 벽에 붙인 로봇은 BIOBUZZ 벽과 겹친다", () => {
    const pose = { x: WALL_INNER_HALF - H18 / 2, y: 0, yaw: 0 }
    expect(fieldOverlaps(resolveSeason('none'), SQUARE, pose, H18)).toEqual([])
    expect(fieldOverlaps(biobuzz, SQUARE, pose, H18)).toEqual([{ kind: 'wall', wall: 'x+' }])
  })

  it('프리셋 스냅 결과(18 in)는 겹침·충돌이 없다', () => {
    for (const preset of biobuzz.startPresets)
      for (const facing of START_FACINGS) {
        const pose = poseOf(snapRobotToStart(SQUARE, preset, INNER, undefined, facing))
        expect(startConflicts(biobuzz, SQUARE, pose, H18)).toEqual([])
      }
  })

  it('임시 상자 로봇은 겹치지 않는다(§1.8 거리)', () => {
    const pose = { x: -0.9144, y: -0.9144, yaw: Math.PI / 6 }
    expect(startConflicts(biobuzz, SQUARE, pose, H18)).toEqual([])
    const placed = placeFootprint(SQUARE, pose)
    const solids = solidFootprints(biobuzz, H18)
    // §1.8의 거리는 다각형 사이 유클리드 거리다(SAT 분리 거리는 꼭짓점–꼭짓점일 때 그보다 작다)
    const distanceTo = (index: number): number => {
      const solid = solids.find((s) => s.index === index)!
      if (solid.kind !== 'polygon') throw new Error('polygon')
      expect(polygonSeparation(placed, solid.points)).toBeGreaterThan(0)
      return polygonDistance(placed, solid.points)
    }
    expect(distanceTo(0)).toBeCloseTo(0.278, 3)
    expect(distanceTo(4)).toBeCloseTo(0.293, 3)
    expect(distanceTo(9)).toBeCloseTo(0.469, 3)
    expect(polygonDistance(placed, rectPolygon(biobuzz.zones[0].rect))).toBeCloseTo(0.287, 3)
    expect(INNER - Math.max(...placed.map((p) => Math.max(-p.x, -p.y)))).toBeCloseTo(0.566, 3)
  })

  it('다리 껍질 안 로봇은 그 순번', () => {
    const small = rectangle(-0.03, -0.03, 0.03, 0.03)
    expect(fieldOverlaps(biobuzz, small, { x: -0.3, y: -0.5, yaw: 0 }, H18)).toEqual([
      { kind: 'structure', index: 4 }
    ])
  })

  it('24 in 깊이 로봇을 scoringWallCorner로 스냅하면 빨강 LOADING ZONE과 충돌한다', () => {
    const deep = rectangle(-0.3048, -H18 / 2, 0.3048, H18 / 2)
    const preset = biobuzz.startPresets.find((p) => p.key === 'scoringWallCorner')!
    const pose = poseOf(snapRobotToStart(deep, preset, INNER, preset.along[0]))
    expect(startConflicts(biobuzz, deep, pose, H18)).toEqual([{ kind: 'zone', index: 0 }])
  })
})
