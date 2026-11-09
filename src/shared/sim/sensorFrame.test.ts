import { describe, expect, it } from 'vitest'
import {
  composeFrames,
  planarFrame,
  sensorAxis,
  sensorPose,
  sensorPoseFromMatrix,
  type Frame3
} from './sensorFrame'
import type { Vec3 } from './worldSpec'

// 센서의 필드 자세(4c, spec-4c §1.2 K4)

const DEG = Math.PI / 180

function expectVec(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 12)
  expect(actual.y).toBeCloseTo(expected.y, 12)
  expect(actual.z).toBeCloseTo(expected.z, 12)
}

function expectMatrix(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(9)
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 12))
}

describe('sensorFrame', () => {
  it('planarFrame은 Rz(yaw)와 바닥 위 원점', () => {
    const frame = planarFrame({ x: 1, y: -2, yaw: 30 * DEG })
    const c = Math.cos(30 * DEG)
    const s = Math.sin(30 * DEG)
    expectMatrix(frame.rotation, [c, -s, 0, s, c, 0, 0, 0, 1])
    expect(frame.origin).toEqual({ x: 1, y: -2, z: 0 })
  })

  it('composeFrames는 a ∘ b(점을 b 틀에서 a 틀 밖으로)', () => {
    const a = planarFrame({ x: 1, y: 2, yaw: 90 * DEG })
    // x축으로 90° 돈 관절 틀, 로봇 좌표 (0.5, 0, 0.3)
    const b: Frame3 = { rotation: [1, 0, 0, 0, 0, -1, 0, 1, 0], origin: { x: 0.5, y: 0, z: 0.3 } }
    const ab = composeFrames(a, b)
    // b 원점 (0.5, 0, 0.3)을 z로 90° 돌리면 (0, 0.5, 0.3), 옮기면 (1, 2.5, 0.3)
    expectVec(ab.origin, { x: 1, y: 2.5, z: 0.3 })
    // Rz(90°)·Rx(90°)
    expectMatrix(ab.rotation, [0, 0, 1, 1, 0, 0, 0, 1, 0])
  })

  it('요 30° 로봇의 섀시 센서: 원점과 축', () => {
    const body = planarFrame({ x: 0.5, y: 0.25, yaw: 30 * DEG })
    const pose = sensorPose(body, {
      body: -1,
      position: { x: 0.2, y: 0, z: 0.1 },
      rotation: { x: 0, y: 0, z: 0 }
    })
    expectVec(pose.origin, {
      x: 0.5 + 0.2 * Math.cos(30 * DEG),
      y: 0.25 + 0.2 * Math.sin(30 * DEG),
      z: 0.1
    })
    expectVec(sensorAxis(pose), { x: Math.cos(30 * DEG), y: Math.sin(30 * DEG), z: 0 })
  })

  it('피치 −90°(아래) 장착은 축이 −z이고 +Z(방위각 기준)가 로봇 +X', () => {
    const pose = sensorPose(planarFrame({ x: 0, y: 0, yaw: 0 }), {
      body: -1,
      position: { x: 0, y: 0, z: 0.015 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 }
    })
    expectVec(sensorAxis(pose), { x: 0, y: 0, z: -1 })
    // 센서 +Z = rotation의 셋째 열
    expectVec(
      { x: pose.rotation[2], y: pose.rotation[5], z: pose.rotation[8] },
      { x: 1, y: 0, z: 0 }
    )
  })

  it('관절 틀이 돈 몸체: 장착 회전이 관절 틀 뒤에 곱해진다', () => {
    // 로봇 좌표 (0, 0, 0.4)에서 y축으로 −45° 든 팔(관절 틀) 위의 센서, 관절 틀 +X로 0.3 m, 장착 요 0
    const c = Math.cos(-45 * DEG)
    const s = Math.sin(-45 * DEG)
    const joint: Frame3 = { rotation: [c, 0, s, 0, 1, 0, -s, 0, c], origin: { x: 0, y: 0, z: 0.4 } }
    const body = composeFrames(planarFrame({ x: 1, y: 0, yaw: 0 }), joint)
    const pose = sensorPose(body, {
      body: 0,
      position: { x: 0.3, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }
    })
    // Ry(−45°)·x̂ = (cos 45°, 0, sin 45°): 위로 든 방향
    const r = Math.SQRT1_2
    expectVec(sensorAxis(pose), { x: r, y: 0, z: r })
    expectVec(pose.origin, { x: 1 + 0.3 * r, y: 0, z: 0.4 + 0.3 * r })
  })

  it('sensorPoseFromMatrix는 열 우선 4×4에서 행 우선 회전과 원점을 꺼낸다', () => {
    const body = planarFrame({ x: 0.7, y: -0.3, yaw: 30 * DEG })
    const expected = sensorPose(body, {
      body: -1,
      position: { x: 0.1, y: 0.05, z: 0.2 },
      rotation: { x: 0, y: Math.PI / 4, z: 20 * DEG }
    })
    const R = expected.rotation
    const o = expected.origin
    // three Matrix4.elements(열 우선)
    // prettier-ignore
    const elements = [
      R[0], R[3], R[6], 0,
      R[1], R[4], R[7], 0,
      R[2], R[5], R[8], 0,
      o.x, o.y, o.z, 1
    ]
    const pose = sensorPoseFromMatrix(elements)
    expectMatrix(pose.rotation, R)
    expectVec(pose.origin, o)
  })
})
