import { Euler, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  cameraAim,
  cameraAimRotation,
  cameraModelOf,
  sdkCameraPose,
  type CameraAim
} from './mounting'

// 웹캠 장착(4d, spec-4d §1.3 K2·K3·K4)

const DEG = Math.PI / 180

// ZYX 회전 행렬(three Euler 'ZYX' = Rz·Ry·Rx)
function zyx(r: { x: number; y: number; z: number }): Matrix4 {
  return new Matrix4().makeRotationFromEuler(new Euler(r.x, r.y, r.z, 'ZYX'))
}

describe('cameraAim·cameraModelOf (K2)', () => {
  it('없음·NaN·범위 밖이면 기본(pitch 0 수평, spec-4e §1.1), 범위 안이면 그 값', () => {
    expect(cameraAim({})).toEqual({ yaw: 0, pitch: 0, roll: 0 })
    expect(cameraAim({ aimYaw: NaN, aimPitch: NaN, aimRoll: NaN })).toEqual({
      yaw: 0,
      pitch: 0,
      roll: 0
    })
    expect(cameraAim({ aimYaw: 4, aimPitch: 2, aimRoll: -4 })).toEqual({
      yaw: 0,
      pitch: 0,
      roll: 0
    })
    expect(cameraAim({ aimYaw: 'x', aimPitch: '0.1' })).toEqual({
      yaw: 0,
      pitch: 0,
      roll: 0
    })
    expect(cameraAim({ aimYaw: 0.5, aimPitch: -0.2, aimRoll: Math.PI })).toEqual({
      yaw: 0.5,
      pitch: -0.2,
      roll: Math.PI
    })
  })

  it('틀린 모델 문자열이면 C920', () => {
    expect(cameraModelOf({})).toBe('logitechC920')
    expect(cameraModelOf({ cameraModel: 'logitechC930' })).toBe('logitechC920')
    expect(cameraModelOf({ cameraModel: 3 })).toBe('logitechC920')
    expect(cameraModelOf({ cameraModel: 'gobilda3122' })).toBe('gobilda3122')
  })
})

describe('cameraAimRotation (K3)', () => {
  it('(roll, −pitch, yaw), −0 없음', () => {
    expect(cameraAimRotation({ yaw: 0.3, pitch: 0.5, roll: -0.2 })).toEqual({
      x: -0.2,
      y: -0.5,
      z: 0.3
    })
    const zero = cameraAimRotation({ yaw: 0, pitch: 0, roll: 0 })
    expect(Object.is(zero.x, 0) && Object.is(zero.y, 0) && Object.is(zero.z, 0)).toBe(true)
    const negZero = cameraAimRotation({ yaw: -0, pitch: -0, roll: -0 })
    expect(Object.is(negZero.x, 0) && Object.is(negZero.y, 0) && Object.is(negZero.z, 0)).toBe(true)
  })

  it('롤 +면 센서 +Z(영상 위)가 −Y 쪽으로(뒤에서 볼 때 시계 방향)', () => {
    const up = new Vector3(0, 0, 1).applyMatrix4(
      zyx(cameraAimRotation({ yaw: 0, pitch: 0, roll: 30 * DEG }))
    )
    expect(up.y).toBeLessThan(0)
    expect(up.z).toBeGreaterThan(0)
    expect(up.y).toBeCloseTo(-Math.sin(30 * DEG), 12)
    // 광축은 롤과 관계없다
    const axis = new Vector3(1, 0, 0).applyMatrix4(
      zyx(cameraAimRotation({ yaw: 0.4, pitch: 0.3, roll: 1 }))
    )
    const axis0 = new Vector3(1, 0, 0).applyMatrix4(
      zyx(cameraAimRotation({ yaw: 0.4, pitch: 0.3, roll: 0 }))
    )
    expect(axis.distanceTo(axis0)).toBeLessThan(1e-12)
  })
})

describe('sdkCameraPose (K4)', () => {
  // SDK R = Rz(yaw)·Rx(pitch)·Rz(roll)(AprilTagProcessor.java:246–260, INTRINSIC ZXZ, 도)
  function sdkRotation(yaw: number, pitch: number, roll: number): Matrix4 {
    return new Matrix4()
      .makeRotationZ(yaw * DEG)
      .multiply(new Matrix4().makeRotationX(pitch * DEG))
      .multiply(new Matrix4().makeRotationZ(roll * DEG))
  }
  // 장착의 OpenCV 카메라 축을 SDK 로봇 틀로: Rz(90°)(SandBot → SDK 로봇 틀)·R_aim·C(C의 열 = OpenCV x·y·z 축의 센서 틀
  // 좌표 −ŷ, −ẑ, x̂)
  function mountRotation(aim: CameraAim): Matrix4 {
    const c = new Matrix4().makeBasis(
      new Vector3(0, -1, 0),
      new Vector3(0, 0, -1),
      new Vector3(1, 0, 0)
    )
    return new Matrix4()
      .makeRotationZ(Math.PI / 2)
      .multiply(zyx(cameraAimRotation(aim)))
      .multiply(c)
  }

  it('위치 축 바꿈(x_sdk = −y, y_sdk = x, in)과 기본 조준(수평) (0, −90, 0)', () => {
    const pose = sdkCameraPose({ x: 0.254, y: -0.0508, z: 0.3048 }, cameraAim({}))
    expect(pose.x).toBeCloseTo(2, 12)
    expect(pose.y).toBeCloseTo(10, 12)
    expect(pose.z).toBeCloseTo(12, 12)
    expect(pose.yaw).toBe(0)
    expect(pose.pitch).toBe(-90)
    expect(pose.roll).toBe(0)
    // 위 30°(4d 기본이던 값, 저장된 프로젝트에 남아 있을 수 있다)는 (0, −60, 0)
    expect(
      sdkCameraPose({ x: 0, y: 0, z: 0 }, { yaw: 0, pitch: Math.PI / 6, roll: 0 }).pitch
    ).toBeCloseTo(-60, 12)
    // 수평 앞(샘플 ConceptAprilTagLocalization의 기본값)
    expect(sdkCameraPose({ x: 0, y: 0, z: 0 }, { yaw: 0, pitch: 0, roll: 0 })).toEqual({
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: -90,
      roll: 0
    })
    const zero = sdkCameraPose({ x: 0, y: 0, z: 0 }, { yaw: 0, pitch: 0, roll: 0 })
    expect(Object.is(zero.x, 0)).toBe(true)
  })

  it('ZXZ 행렬이 장착 OpenCV 축과 1e-12(요 −170–170°·피치 −85–85°·롤 −170–170° 격자)', () => {
    let worst = 0
    for (let yaw = -170; yaw <= 170; yaw += 34)
      for (let pitch = -85; pitch <= 85; pitch += 17)
        for (let roll = -170; roll <= 170; roll += 34) {
          const aim = { yaw: yaw * DEG, pitch: pitch * DEG, roll: roll * DEG }
          const pose = sdkCameraPose({ x: 0, y: 0, z: 0 }, aim)
          const a = sdkRotation(pose.yaw, pose.pitch, pose.roll).elements
          const b = mountRotation(aim).elements
          for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
        }
    expect(worst).toBeLessThan(1e-12)
  })
})
