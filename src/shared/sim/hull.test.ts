import { describe, expect, it } from 'vitest'
import {
  boxHull,
  buildHull,
  canonicalHull,
  HULL_DEFAULT_VERTEX_LIMIT,
  HULL_MERGE_DISTANCE,
  hullError,
  MAX_HULL_POINTS,
  prismHull,
  quantizePoints,
  transformHull,
  type Hull
} from './hull'
import type { Vec3 } from './worldSpec'

// 볼록 껍질(spec-5 §3.1) 시험: K3(껍질)·K9(정규 껍질 고정점). three ConvexHull 오라클은 렌더러 쪽 scene/hullOracle.test.ts다.

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

// 고정 시드 선형 합동(결정적 입력)
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const next = random(seed)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

// 위상·기하 불변 조건: Euler, 모서리 정렬과 좌우 면, 모든 꼭짓점이 모든 면 평면 안쪽, 면 목록이 가장 작은 번호부터·사전순
function expectValidHull(hull: Hull): void {
  const { vertices, faces, edges } = hull
  expect(vertices.length - edges.length + faces.length).toBe(2)
  // 한 번에 모아 확인한다(점마다 expect를 부르면 시험이 느리다)
  const problems: string[] = []
  faces.forEach((face, f) => {
    if (face.vertices.length < 3) problems.push(`face ${f} size`)
    if (face.vertices[0] !== Math.min(...face.vertices)) problems.push(`face ${f} rotation`)
    if (Math.abs(Math.hypot(face.normal.x, face.normal.y, face.normal.z) - 1) > 1e-12)
      problems.push(`face ${f} normal`)
    for (const p of vertices)
      if (dot(face.normal, p) - face.offset > HULL_MERGE_DISTANCE) problems.push(`face ${f} plane`)
    // offset = 면 꼭짓점의 n·v 최대
    if (Math.max(...face.vertices.map((i) => dot(face.normal, vertices[i]))) !== face.offset)
      problems.push(`face ${f} offset`)
    if (!(dot(face.normal, hull.centroid) < face.offset)) problems.push(`face ${f} centroid`)
    if (f > 0) {
      const a = faces[f - 1].vertices
      const b = face.vertices
      const k = a.findIndex((x, i) => x !== b[i])
      if (!(k < 0 ? a.length <= b.length : a[k] < b[k])) problems.push(`face ${f} order`)
    }
  })
  const has = (f: number, a: number, b: number): boolean => {
    const list = faces[f].vertices
    return list.some((x, i) => x === a && list[(i + 1) % list.length] === b)
  }
  edges.forEach((edge, i) => {
    if (!(edge.a < edge.b)) problems.push(`edge ${i} a < b`)
    const prev = edges[i - 1]
    if (prev && !(prev.a < edge.a || (prev.a === edge.a && prev.b < edge.b)))
      problems.push(`edge ${i} order`)
    if (!has(edge.left, edge.a, edge.b) || !has(edge.right, edge.b, edge.a))
      problems.push(`edge ${i} sides`)
  })
  expect(problems).toEqual([])
  expect(hull.volume).toBeGreaterThan(0)
}

// 메시처럼 생긴 고정 시드 점 구름: 축이 다른 타원체 겉면 + 상자 안 점, 크기 2–50 cm, 중심 1 m 안
function meshCloud(seed: number): Vec3[] {
  const next = random(seed)
  const center = v((next() - 0.5) * 2, (next() - 0.5) * 2, next())
  const size = v(0.02 + next() * 0.5, 0.02 + next() * 0.5, 0.02 + next() * 0.3)
  const count = 20 + Math.floor(next() * 380)
  const points: Vec3[] = []
  for (let i = 0; i < count; i++) {
    if (next() < 0.5) {
      const u = next() * 2 - 1
      const theta = next() * 2 * Math.PI
      const s = Math.sqrt(1 - u * u)
      points.push(
        v(
          center.x + (size.x / 2) * s * Math.cos(theta),
          center.y + (size.y / 2) * s * Math.sin(theta),
          center.z + (size.z / 2) * u
        )
      )
    } else
      points.push(
        v(
          center.x + (next() - 0.5) * size.x,
          center.y + (next() - 0.5) * size.y,
          center.z + (next() - 0.5) * size.z
        )
      )
  }
  return points
}

describe('buildHull(K3)', () => {
  const corners = Array.from({ length: 8 }, (_, k) =>
    v(k & 1 ? 0.1 : -0.1, k & 2 ? 0.25 : -0.25, k & 4 ? 0.05 : -0.05)
  )

  it('상자 8점은 섞은 순서와 관계없이 사각형 6면·모서리 12·꼭짓점 8이고 결과가 바이트 같다', () => {
    const hulls = [corners, shuffled(corners, 1), shuffled(corners, 2)].map((p) => buildHull(p)!)
    const text = hulls.map((h) => JSON.stringify(h))
    expect(new Set(text).size).toBe(1)
    const [hull] = hulls
    expect(hull.vertices).toHaveLength(8)
    expect(hull.faces).toHaveLength(6)
    expect(hull.faces.every((face) => face.vertices.length === 4)).toBe(true)
    expect(hull.edges).toHaveLength(12)
    expect(hull.volume).toBeCloseTo(0.2 * 0.5 * 0.1, 15)
    expect(hull.error).toBe(0)
    expectValidHull(hull)
  })

  it('Float32Array 입력은 같은 점의 Vec3 입력과 같다', () => {
    const cloud = meshCloud(7)
    const flat = new Float32Array(cloud.flatMap((p) => [p.x, p.y, p.z]))
    const asVec = Array.from({ length: cloud.length }, (_, i) =>
      v(flat[3 * i], flat[3 * i + 1], flat[3 * i + 2])
    )
    expect(buildHull(flat)).toEqual(buildHull(asVec))
    expect(quantizePoints(flat)).toEqual(quantizePoints(asVec))
  })

  it('원기둥 테셀레이션 1000점: 한도 32 이하, error ≤ hullError ≤ 해석 상한', () => {
    const r = 0.05
    const points: Vec3[] = []
    for (let i = 0; i < 50; i++)
      for (let j = 0; j < 20; j++) {
        const a = (i / 50) * 2 * Math.PI
        points.push(v(r * Math.cos(a), r * Math.sin(a), j * 0.01))
      }
    const hull = buildHull(points, HULL_DEFAULT_VERTEX_LIMIT)!
    expectValidHull(hull)
    expect(hull.vertices.length).toBeLessThanOrEqual(32)
    const full = hullError(points, hull)
    expect(hull.error).toBeLessThanOrEqual(full)
    // 둘레 점 100개를 꼭짓점 32개로 다 담을 수 없으니 0보다 크고, 안에 그린 껍질이 둘레를 육각형보다 거칠게 자르지 않는다:
    // 육각기둥 활꼴 높이 r(1 − cos 30°)
    expect(full).toBeGreaterThan(0)
    expect(full).toBeLessThanOrEqual(r * (1 - Math.sqrt(3) / 2))
    // 한도를 넉넉히 주면 모든 꼭짓점을 담아 오차가 0이다(25각 기둥 꼭짓점 50개 < 64)
    const ring = Array.from({ length: 50 }, (_, k) => {
      const a = ((k % 25) / 25) * 2 * Math.PI
      return v(r * Math.cos(a), r * Math.sin(a), k < 25 ? 0 : 0.19)
    })
    const small = buildHull(ring, MAX_HULL_POINTS)!
    expectValidHull(small)
    expect(small.vertices).toHaveLength(50)
    expect(small.faces).toHaveLength(27)
    expect(small.error).toBe(0)
    expect(hullError(ring, small)).toBe(0)
  })

  it('같은 직선·같은 평면·작은 부피·얇은 판·범위 밖·유한하지 않은 점은 null', () => {
    const line = Array.from({ length: 10 }, (_, i) => v(i * 0.01, 2 * i * 0.01, 0))
    expect(buildHull(line)).toBeNull()
    const plane = Array.from({ length: 20 }, (_, i) =>
      v((i % 5) * 0.01, Math.floor(i / 5) * 0.01, 0)
    )
    expect(buildHull(plane)).toBeNull()
    // 0.5 mm³: 1 mm × 1 mm × 0.5 mm
    const tiny = Array.from({ length: 8 }, (_, k) =>
      v(k & 1 ? 0.001 : 0, k & 2 ? 0.001 : 0, k & 4 ? 0.0005 : 0)
    )
    expect(buildHull(tiny)).toBeNull()
    // 10 cm × 10 cm × 0.5 mm 판: 부피는 넉넉하지만 폭 < 1 mm
    const thin = Array.from({ length: 8 }, (_, k) =>
      v(k & 1 ? 0.1 : 0, k & 2 ? 0.1 : 0, k & 4 ? 0.0005 : 0)
    )
    expect(buildHull(thin)).toBeNull()
    // 1 mm 판은 받는다
    const plate = thin.map((p) => v(p.x, p.y, p.z * 2))
    expect(buildHull(plate)).not.toBeNull()
    expect(buildHull([...corners, v(6.6, 0, 0)])).toBeNull()
    expect(buildHull([...corners, v(Number.NaN, 0, 0)])).toBeNull()
    expect(buildHull(corners.slice(0, 3))).toBeNull()
    expect(buildHull(new Float32Array(7))).toBeNull()
    expect(() => quantizePoints([v(7, 0, 0)])).toThrow(RangeError)
  })

  it('격자 한 칸 안의 두 점은 하나이고 −0을 만들지 않는다', () => {
    expect(quantizePoints([v(0.10001, 0.2, 0.3), v(0.10004, 0.20002, 0.29996)])).toEqual([
      v(0.1, 0.2, 0.3)
    ])
    const [zero] = quantizePoints([v(-0.00004, -0, -0.00002)])
    expect(Object.is(zero.x, 0)).toBe(true)
    expect(Object.is(zero.y, 0)).toBe(true)
    expect(Object.is(zero.z, 0)).toBe(true)
    // 사전식(x, y, z) 정렬
    expect(quantizePoints([v(0.1, 0, 0), v(-0.1, 0.2, 0), v(-0.1, 0.1, 0.3)])).toEqual([
      v(-0.1, 0.1, 0.3),
      v(-0.1, 0.2, 0),
      v(0.1, 0, 0)
    ])
  })

  it('무작위 메시 구름 200개: Euler·평면 안쪽·모서리 좌우, 한도, 결정성', () => {
    for (let seed = 0; seed < 200; seed++) {
      const cloud = meshCloud(seed)
      const limit = 8 + (seed % 57)
      const hull = buildHull(cloud, limit)
      expect(hull).not.toBeNull()
      expectValidHull(hull!)
      expect(hull!.vertices.length).toBeLessThanOrEqual(limit)
      expect(hull!.error).toBeLessThanOrEqual(hullError(cloud, hull!))
      expect(buildHull(shuffled(cloud, seed + 1000), limit)).toEqual(hull)
    }
  })
})

describe('정규 껍질(K9)', () => {
  it('canonicalHull(V)는 JSON 왕복·점 순서와 관계없이 같다(고정 시드 메시 구름 200개)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const built = buildHull(meshCloud(seed), HULL_DEFAULT_VERTEX_LIMIT)
      expect(built).not.toBeNull()
      const points = built!.vertices
      const hull = canonicalHull(points)
      expect(hull).not.toBeNull()
      const sent = JSON.parse(JSON.stringify(points)) as Vec3[]
      expect(canonicalHull(sent)).toEqual(hull)
      expect(canonicalHull(shuffled(sent, seed))).toEqual(hull)
      // V는 격자 위라 다시 양자화해도 같은 값이다
      expect(quantizePoints(points)).toEqual(points)
    }
  })

  it('boxHull: 꼭짓점은 boxVertices 비트 순서, 면 6·모서리 12, 축 정렬 면은 정확한 평면', () => {
    const hull = boxHull(v(1.8, -0.5, 0.1), [1, 0, 0, 0, 1, 0, 0, 0, 1], v(0.0135, 1.8, 0.2))
    expect(hull.vertices[0]).toEqual(v(1.8 - 0.0135, -0.5 - 1.8, 0.1 - 0.2))
    expect(hull.vertices[7]).toEqual(v(1.8 + 0.0135, -0.5 + 1.8, 0.1 + 0.2))
    expect(hull.faces).toHaveLength(6)
    expect(hull.edges).toHaveLength(12)
    expectValidHull(hull)
    const minusX = hull.faces.find((face) => face.normal.x === -1)!
    expect(minusX.normal).toEqual(v(-1, 0, 0))
    expect(minusX.offset).toBe(-(1.8 - 0.0135))
    expect(hull.error).toBe(0)
    // 회전한 상자도 위상이 같다(Rz 30°)
    const c = Math.sqrt(3) / 2
    const turned = boxHull(v(0, 0, 0), [c, -0.5, 0, 0.5, c, 0, 0, 0, 1], v(0.1, 0.2, 0.3))
    expectValidHull(turned)
    expect(turned.faces.map((face) => face.vertices)).toEqual(
      hull.faces.map((face) => face.vertices)
    )
    expect(turned.volume).toBeCloseTo(0.2 * 0.4 * 0.6, 14)
  })

  it('prismHull: 16각 기둥은 면 18·모서리 48·꼭짓점 32(입력 순서), 시계 방향 입력도 바깥 법선', () => {
    const ring = (z: number): Vec3[] =>
      Array.from({ length: 16 }, (_, k) =>
        v(0.075 * Math.cos((k * Math.PI) / 8), 0.075 * Math.sin((k * Math.PI) / 8), z)
      )
    const points = [...ring(0), ...ring(0.3)]
    const hull = prismHull(points)
    expect(hull.faces).toHaveLength(18)
    expect(hull.edges).toHaveLength(48)
    expect(hull.vertices).toEqual(points.map((p) => v(p.x + 0, p.y + 0, p.z + 0)))
    expectValidHull(hull)
    const reversed = [...ring(0).reverse(), ...ring(0.3).reverse()]
    const back = prismHull(reversed)
    expectValidHull(back)
    expect(back.volume).toBeCloseTo(hull.volume, 15)
  })

  it('transformHull은 입력을 바꾸지 않고 offset = d + n′·t다', () => {
    const hull = Object.freeze(buildHull(meshCloud(3))!)
    const before = JSON.stringify(hull)
    const c = Math.cos(0.7)
    const s = Math.sin(0.7)
    const rotation = [c, 0, s, 0, 1, 0, -s, 0, c]
    const t = v(0.3, -1.2, 0.05)
    const moved = transformHull(hull, rotation, t)
    expect(JSON.stringify(hull)).toBe(before)
    expect(moved).not.toBe(hull)
    expect(moved.edges).toBe(hull.edges)
    moved.faces.forEach((face, f) => {
      expect(face.vertices).toBe(hull.faces[f].vertices)
      expect(face.offset).toBe(hull.faces[f].offset + dot(face.normal, t))
      // 면 꼭짓점의 n·v 최대가 평면 위다(합친 면의 다른 꼭짓점은 HULL_MERGE_DISTANCE 안쪽까지)
      const top = Math.max(...face.vertices.map((i) => dot(face.normal, moved.vertices[i])))
      expect(top).toBeCloseTo(face.offset, 12)
    })
    expect(moved.volume).toBe(hull.volume)
  })
})
