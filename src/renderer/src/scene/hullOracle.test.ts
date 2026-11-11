import { Vector3 } from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'
import { describe, expect, it } from 'vitest'
import { buildHull, HULL_GRID, MAX_HULL_POINTS, quantizePoints } from '../../../shared/sim/hull'
import type { Vec3 } from '../../../shared/sim/worldSpec'

// 볼록 껍질 오라클(spec-5 K3, C-L13): three ConvexHull(quickhull3d 이식)과 대조한다. three는 같은 평면의 면을 합치지 않고 공차가
// 기계 오차 수준이라 충돌 위상에는 쓰지 않지만(M§3), 점 포함 판정의 기준으로는 충분하다. three를 쓰므로 렌더러 쪽 시험이다.

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function threeHull(points: readonly Vec3[]): ConvexHull {
  return new ConvexHull().setFromPoints(points.map((p) => new Vector3(p.x, p.y, p.z)))
}

// three 껍질 면 평면에서 점이 바깥으로 나간 거리의 최대
function outside(hull: ConvexHull, p: Vec3): number {
  const point = new Vector3(p.x, p.y, p.z)
  return Math.max(...hull.faces.map((face) => face.normal.dot(point) - face.constant))
}

// three 껍질의 꼭짓점(면의 반변 고리)
function threeVertices(hull: ConvexHull): Vec3[] {
  const out: Vec3[] = []
  for (const face of hull.faces) {
    const start = face.edge
    let edge = start
    do {
      const { x, y, z } = edge.head().point
      out.push({ x, y, z })
      edge = edge.next
    } while (edge !== start)
  }
  return out
}

describe('three ConvexHull 오라클', () => {
  it('고정 시드 구름 200개: 우리 껍질의 모든 꼭짓점이 (같은 양자화 점의) three 껍질 안(1e-9)', () => {
    const next = random(42)
    for (let k = 0; k < 200; k++) {
      const count = 8 + Math.floor(next() * 300)
      const scale = 0.05 + next() * 0.5
      const cloud: Vec3[] = Array.from({ length: count }, () => ({
        x: (next() - 0.5) * scale,
        y: (next() - 0.5) * scale * 0.7,
        z: (next() - 0.5) * scale * 0.4
      }))
      const ours = buildHull(cloud, 8 + (k % 57))
      expect(ours).not.toBeNull()
      const reference = threeHull(quantizePoints(cloud))
      const worst = Math.max(...ours!.vertices.map((v) => outside(reference, v)))
      expect(worst).toBeLessThanOrEqual(1e-9)
    }
  })

  it('꼭짓점 ≤ 60인 구 위 점 구름(한도 64)은 three 껍질 꼭짓점을 모두 품는다(격자 반 칸)', () => {
    const next = random(7)
    // 원래 점과 그 양자화 점의 거리 한도: 격자 반 칸의 대각선
    const tolerance = (HULL_GRID * Math.sqrt(3)) / 2 + 1e-9
    for (let k = 0; k < 200; k++) {
      const count = 4 + Math.floor(next() * 57)
      const radius = 0.05 + next() * 0.4
      const cloud: Vec3[] = Array.from({ length: count }, () => {
        const u = next() * 2 - 1
        const theta = next() * 2 * Math.PI
        const s = Math.sqrt(1 - u * u)
        return { x: radius * s * Math.cos(theta), y: radius * s * Math.sin(theta), z: radius * u }
      })
      const ours = buildHull(cloud, MAX_HULL_POINTS)
      // 점이 넷뿐이면 얇은 사면체일 수 있다(폭 1 mm 아래는 퇴화)
      if (!ours) continue
      expect(ours.error).toBe(0)
      let worst = 0
      for (const p of threeVertices(threeHull(cloud)))
        for (const face of ours.faces)
          worst = Math.max(
            worst,
            face.normal.x * p.x + face.normal.y * p.y + face.normal.z * p.z - face.offset
          )
      expect(worst).toBeLessThanOrEqual(tolerance)
    }
  })
})
