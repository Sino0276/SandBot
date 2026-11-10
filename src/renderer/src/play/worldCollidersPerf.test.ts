import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../shared/sim/worldSpec'
import { meshHullOf } from '../cad/stepImport'
import type { ObjectHullPoints } from '../scene/meshHull'
import type { SceneObjects } from '../scene/model'
import { defaultJoint } from '../scene/joint'
import {
  buildCollisionModel,
  createCollisionModelCache,
  type CollisionModel,
  type CollisionModelCache
} from './worldColliders'
import { jointBodyFrames } from './worldJoints'

// 성능(spec-5 §12): 큰 CAD(goBILDA 예제 키트 크기, 메시 1761개)의 INIT 몸체 모델(섀시 1761 × 64점 껍질), 무관 편집 뒤 다시
// 계산(몸체 단위 기억), STEP 워커의 메시별 껍질. 값은 console.info로 남기고 CI 상한만 확인한다(worldField.test.ts A14 꼴).

const MESHES = 1761
// 결정적 의사 난수(시드 고정, 메시마다 다른 모양)
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

// 메시마다 64점 껍질(작은 볼록 덩어리의 꼭짓점, 피벗 기준)
function meshPoints(index: number): ObjectHullPoints {
  const next = random(index + 1)
  const size = 0.005 + 0.03 * next()
  const positions: number[] = []
  for (let k = 0; k < 400; k++) {
    // 구 위 점(껍질 꼭짓점이 한도 64까지 찬다)
    const u = 2 * next() - 1
    const a = 2 * Math.PI * next()
    const r = Math.sqrt(1 - u * u)
    positions.push(size * r * Math.cos(a), size * r * Math.sin(a), size * u)
  }
  const hull = meshHullOf(positions)
  const points: Vec3[] = []
  for (let i = 0; i < hull.points.length; i += 3)
    points.push({ x: hull.points[i], y: hull.points[i + 1], z: hull.points[i + 2] })
  return { kind: 'points', points, error: hull.error }
}

function bigRobot(): { objects: SceneObjects; shapes: Map<string, ObjectHullPoints> } {
  const objects: SceneObjects = {
    R: {
      id: 'R',
      name: 'Robot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
    },
    cad: {
      id: 'cad',
      name: 'CAD',
      kind: 'assembly',
      parentId: 'R',
      transform: { position: [0, 0, 0.15], rotation: [Math.PI / 2, 0, 0] }
    },
    lift: {
      id: 'lift',
      name: 'Lift',
      kind: 'group',
      parentId: 'R',
      transform: { position: [0.1, 0, 0.1], rotation: [0, 0, 0] },
      joint: { ...defaultJoint('prismatic'), axis: 'z' }
    }
  }
  const shapes = new Map<string, ObjectHullPoints>()
  const next = random(7)
  for (let i = 0; i < MESHES; i++) {
    const id = `m${i}`
    // 섀시(대부분)와 리프트 몸체(일부)
    const parentId = i % 10 === 0 ? 'lift' : 'cad'
    objects[id] = {
      id,
      name: `Part ${i}`,
      kind: 'part',
      parentId,
      transform: {
        position: [0.4 * next() - 0.2, 0.4 * next() - 0.2, 0.3 * next()],
        rotation: [0, 0, 0]
      },
      visual: { type: 'mesh', geometryId: `g:${id}`, color: [1, 1, 1] }
    }
    shapes.set(id, meshPoints(i))
  }
  return { objects, shapes }
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const OUTLINE = {
  footprint: [
    { x: 0.23, y: -0.23 },
    { x: 0.23, y: 0.23 },
    { x: -0.23, y: 0.23 },
    { x: -0.23, y: -0.23 }
  ],
  height: 0.45
}

describe('충돌 모델 성능(§12)', () => {
  const { objects, shapes } = bigRobot()
  const lookup = (id: string): ObjectHullPoints => shapes.get(id) ?? { kind: 'none' }
  const build = (doc: SceneObjects, cache?: CollisionModelCache): CollisionModel =>
    buildCollisionModel({
      objects: doc,
      robotId: 'R',
      joints: jointBodyFrames(doc, 'R'),
      shapes: lookup,
      outline: OUTLINE,
      cache
    })

  it('INIT 몸체 모델(섀시 1761 × 64점 껍질): 목표 ≤ 150 ms, CI 상한 1.5 s', () => {
    const times: number[] = []
    let model = build(objects)
    for (let k = 0; k < 5; k++) {
      const start = performance.now()
      model = build(objects)
      times.push(performance.now() - start)
    }
    console.info(`충돌 모델(INIT, 메시 ${MESHES}개): 중앙값 ${median(times).toFixed(1)} ms`)
    expect(model.bodies[0].source).toBe('auto')
    expect(model.bodies[0].colliders[0].hullPoints).toBeLessThanOrEqual(32)
    expect(median(times)).toBeLessThan(1500)
  })

  it('무관 편집(이름 바꾸기) 뒤 다시 계산: 목표 ≤ 5 ms, CI 상한 50 ms', () => {
    const cache = createCollisionModelCache()
    const first = build(objects, cache)
    const times: number[] = []
    let doc = objects
    for (let k = 0; k < 9; k++) {
      doc = { ...doc, m5: { ...doc.m5, name: `Part 5 (${k})` } }
      const start = performance.now()
      const model = build(doc, cache)
      times.push(performance.now() - start)
      expect(model.bodies[0]).toBe(first.bodies[0])
    }
    console.info(`충돌 모델(무관 편집 뒤, 메시 ${MESHES}개): 중앙값 ${median(times).toFixed(2)} ms`)
    expect(median(times)).toBeLessThan(50)
  })

  it('STEP 워커의 메시별 껍질(메시 200개 × 꼭짓점 2400개, 기록)', () => {
    const next = random(11)
    const meshes = Array.from({ length: 200 }, () => {
      const positions = new Float32Array(2400 * 3)
      for (let i = 0; i < positions.length; i++) positions[i] = 0.05 * (next() - 0.5)
      return positions
    })
    const start = performance.now()
    for (const positions of meshes) meshHullOf(positions)
    const elapsed = performance.now() - start
    console.info(
      `메시 껍질: 메시 200개(꼭짓점 48만) ${elapsed.toFixed(0)} ms → 1761개 어림 ${((elapsed * MESHES) / 200 / 1000).toFixed(1)} s`
    )
    expect(elapsed).toBeGreaterThan(0)
  })
})
