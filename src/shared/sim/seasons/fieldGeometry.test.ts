import { describe, expect, it } from 'vitest'
import {
  boxSlabHull,
  circlePolygonSeparation,
  convexHull,
  heightOverlaps,
  polygonSeparation,
  rectPolygon,
  solidFootprints,
  sphereShapeSeparation
} from './fieldGeometry'
import { resolveSeason } from './seasons'
import type { Vec3 } from '../worldSpec'

// K7(spec-4ab §5): 볼록 껍질과 높이 슬랩 단면

describe('K7 껍질', () => {
  it('convexHull: 반시계, 사전순 최소점에서 시작, 일직선·중복 점을 뺀다', () => {
    const hull = convexHull([
      { x: 1, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0.5 }
    ])
    expect(hull).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ])
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 }
      ])
    ).toEqual([])
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ])
    ).toEqual([])
  })

  it('heightOverlaps는 열린 구간(맞닿기만 하면 아님)', () => {
    expect(heightOverlaps(0, 0.1, 0, 0.5)).toBe(true)
    expect(heightOverlaps(0.5, 1, 0, 0.5)).toBe(false)
    expect(heightOverlaps(-1, 0, 0, 0.5)).toBe(false)
    expect(heightOverlaps(0.4999, 1, 0, 0.5)).toBe(true)
  })

  it('boxSlabHull: 축 정렬 상자는 사각형, 높이 밖·맞닿기만 하면 null', () => {
    const box = {
      kind: 'box' as const,
      center: { x: 1, y: 2, z: 0.5 },
      rotation: { x: 0, y: 0, z: 0 },
      size: { x: 0.4, y: 0.2, z: 1 }
    }
    const rect = [
      { x: 0.8, y: 1.9 },
      { x: 1.2, y: 1.9 },
      { x: 1.2, y: 2.1 },
      { x: 0.8, y: 2.1 }
    ]
    const close = (hull: { x: number; y: number }[] | null): void => {
      expect(hull).not.toBeNull()
      expect(hull).toHaveLength(4)
      hull!.forEach((p, i) => {
        expect(p.x).toBeCloseTo(rect[i].x, 12)
        expect(p.y).toBeCloseTo(rect[i].y, 12)
      })
    }
    close(boxSlabHull(box, 0, 0.3))
    close(boxSlabHull(box, 0.2, 2))
    expect(boxSlabHull(box, 1, 2)).toBeNull()
    expect(boxSlabHull(box, -1, 0)).toBeNull()
    expect(boxSlabHull(box, 2, 3)).toBeNull()
  })

  it('기운 상자의 단면은 슬랩에 따라 넓어진다(다리)', () => {
    const leg = resolveSeason('biobuzz').structures[2]
    if (leg.shape.kind !== 'box') throw new Error('box')
    const low = boxSlabHull(leg.shape, 0, 0.05)!
    const high = boxSlabHull(leg.shape, 0, 0.7366)!
    // 29 in 껍질이 낮은 껍질을 품는다
    expect(polygonSeparation(low, high)).toBeLessThan(0)
    for (const p of low)
      expect(
        polygonSeparation([p, { x: p.x + 1e-9, y: p.y }, { x: p.x, y: p.y + 1e-9 }], high)
      ).toBeLessThanOrEqual(1e-9)
    // solid 단면은 field carrier의 solid 구조물만(위 막대·로고 판·HIVE CELL 제외)
    expect(solidFootprints(resolveSeason('biobuzz'), 0.7366).map((s) => s.index)).toEqual([
      0, 1, 2, 3, 4, 5, 9, 10, 11, 12
    ])
    expect(solidFootprints(resolveSeason('none'), 0.7366)).toEqual([])
  })

  it('분리 거리: 다각형 둘, 원–다각형', () => {
    const a = rectPolygon([0, 0, 1, 1])
    expect(polygonSeparation(a, rectPolygon([2, 0, 3, 1]))).toBeCloseTo(1, 15)
    expect(polygonSeparation(a, rectPolygon([0.75, 0, 3, 1]))).toBeCloseTo(-0.25, 15)
    expect(circlePolygonSeparation({ x: 3, y: 0.5 }, 0.5, a)).toBeCloseTo(1.5, 15)
    expect(circlePolygonSeparation({ x: 2, y: 2 }, 0, a)).toBeCloseTo(Math.SQRT2, 15)
    expect(circlePolygonSeparation({ x: 0.5, y: 0.75 }, 0.1, a)).toBeCloseTo(-0.35, 15)
  })
})

// 6a: 경기 요소 데이터 검사의 구–구조물 분리
describe('sphereShapeSeparation', () => {
  const zero = { x: 0, y: 0, z: 0 }
  const box = {
    kind: 'box' as const,
    center: { x: 1, y: 0, z: 0.5 },
    rotation: zero,
    size: { x: 0.2, y: 0.4, z: 1 }
  }
  const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

  it('상자: 면·모서리 밖은 거리 − r, 안은 가장 가까운 면까지(음수)', () => {
    expect(sphereShapeSeparation(at(1.2, 0, 0.5), 0.05, box)).toBeCloseTo(0.1 - 0.05, 12)
    expect(sphereShapeSeparation(at(1.4, 0.5, 0.5), 0.1, box)).toBeCloseTo(
      Math.hypot(0.3, 0.3) - 0.1,
      12
    )
    expect(sphereShapeSeparation(at(1, 0, 0.5), 0.05, box)).toBeCloseTo(-0.1 - 0.05, 12)
    // 닿기만 하면 0
    expect(sphereShapeSeparation(at(1.15, 0, 0.5), 0.05, box)).toBeCloseTo(0, 12)
  })

  it('돌린 상자는 자기 틀에서 잰다(Rz 90°면 x·y 크기가 바뀐다)', () => {
    const turned = { ...box, rotation: { x: 0, y: 0, z: Math.PI / 2 } }
    expect(sphereShapeSeparation(at(1.3, 0, 0.5), 0.05, turned)).toBeCloseTo(0.1 - 0.05, 12)
  })

  it('세운 원기둥: 옆면·뚜껑·모서리·안', () => {
    const cylinder = {
      kind: 'cylinder' as const,
      center: { x: 0, y: 0, z: 0.5 },
      rotation: zero,
      radius: 0.2,
      height: 1
    }
    expect(sphereShapeSeparation(at(0.5, 0, 0.5), 0.1, cylinder)).toBeCloseTo(0.2, 12)
    expect(sphereShapeSeparation(at(0, 0, 1.3), 0.1, cylinder)).toBeCloseTo(0.2, 12)
    expect(sphereShapeSeparation(at(0.5, 0, 1.4), 0.1, cylinder)).toBeCloseTo(0.5 - 0.1, 12)
    expect(sphereShapeSeparation(at(0.1, 0, 0.5), 0.1, cylinder)).toBeCloseTo(-0.1 - 0.1, 12)
  })
})
