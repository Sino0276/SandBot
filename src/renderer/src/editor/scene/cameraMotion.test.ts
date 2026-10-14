import { PerspectiveCamera, Vector3 } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import {
  directionRotation,
  FLIGHT_SECONDS,
  flyCameraTo,
  isCameraMoving,
  stepCameraMotion,
  stopCameraMotion,
  zoomCamera
} from './cameraMotion'

function setup(
  position: Vector3,
  target: Vector3
): {
  camera: PerspectiveCamera
  controls: { target: Vector3; update: () => void }
} {
  const camera = new PerspectiveCamera()
  camera.up.set(0, 0, 1)
  camera.position.copy(position)
  const controls = { target: target.clone(), update: () => camera.lookAt(controls.target) }
  return { camera, controls }
}

function run(
  camera: PerspectiveCamera,
  controls: { target: Vector3; update: () => void },
  frames: number,
  delta = 1 / 60
): void {
  for (let i = 0; i < frames; i++) stepCameraMotion(camera, controls, delta)
}

afterEach(stopCameraMotion)

describe('flyCameraTo', () => {
  it('순간 이동하지 않고 정해진 시간 뒤 정확히 도착한다', () => {
    const { camera, controls } = setup(new Vector3(5, 0, 1), new Vector3(0, 0, 0))
    const position = new Vector3(1, 2, 3)
    const target = new Vector3(1, 2, 0.5)
    flyCameraTo(camera, controls, position, target)

    stepCameraMotion(camera, controls, 1 / 60)
    // 첫 프레임은 아직 출발점 근처
    expect(camera.position.distanceTo(new Vector3(5, 0, 1))).toBeLessThan(0.5)
    expect(isCameraMoving()).toBe(true)

    run(camera, controls, Math.ceil(FLIGHT_SECONDS * 60) + 1)
    expect(isCameraMoving()).toBe(false)
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-9)
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-9)
  })

  it('정반대 방향으로 돌 때도 끝 방향이 맞고, 바로 위를 지나지 않는다', () => {
    const { camera, controls } = setup(new Vector3(3, 0, 0.2), new Vector3(0, 0, 0))
    const distance = camera.position.length()
    const end = new Vector3(3, 0, 0.2).negate()
    flyCameraTo(camera, controls, end, new Vector3())
    let maxZ = 0
    for (let i = 0; i < 40; i++) {
      stepCameraMotion(camera, controls, 1 / 60)
      maxZ = Math.max(maxZ, Math.abs(camera.position.z))
      expect(camera.position.length()).toBeCloseTo(distance, 9)
    }
    expect(camera.position.distanceTo(end)).toBeLessThan(1e-9)
    expect(maxZ).toBeLessThan(0.21)
  })

  it('쉬다가 그린 첫 프레임의 큰 delta로 끝까지 건너뛰지 않는다', () => {
    const { camera, controls } = setup(new Vector3(5, 0, 0), new Vector3())
    flyCameraTo(camera, controls, new Vector3(0, 5, 0), new Vector3())
    stepCameraMotion(camera, controls, 10)
    expect(isCameraMoving()).toBe(true)
  })
})

describe('directionRotation', () => {
  it('거의 수직인 정반대 방향도 정확히 돌린다', () => {
    const from = new Vector3(0.01, 0, 1).normalize()
    const to = from.clone().negate()
    expect(from.clone().applyQuaternion(directionRotation(from, to)).distanceTo(to)).toBeLessThan(
      1e-9
    )
  })
})

describe('zoomCamera', () => {
  it('목표 거리로 부드럽게 다가가 멈추고, 방향은 그대로다', () => {
    const { camera, controls } = setup(new Vector3(0, -4, 3), new Vector3())
    zoomCamera(camera, controls, 0.5)
    zoomCamera(camera, controls, 0.5)
    stepCameraMotion(camera, controls, 1 / 60)
    const first = camera.position.length()
    expect(first).toBeLessThan(5)
    expect(first).toBeGreaterThan(1.25)
    run(camera, controls, 120)
    expect(isCameraMoving()).toBe(false)
    expect(camera.position.length()).toBeCloseTo(1.25, 9)
    expect(
      camera.position
        .clone()
        .normalize()
        .distanceTo(new Vector3(0, -0.8, 0.6))
    ).toBeLessThan(1e-9)
  })

  it('날아가던 이동을 멈춘다', () => {
    const { camera, controls } = setup(new Vector3(5, 0, 0), new Vector3())
    flyCameraTo(camera, controls, new Vector3(0, 5, 0), new Vector3())
    stepCameraMotion(camera, controls, 1 / 60)
    zoomCamera(camera, controls, 2)
    run(camera, controls, 200)
    expect(camera.position.y).toBeLessThan(1)
  })
})
