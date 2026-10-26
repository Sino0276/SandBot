import { PerspectiveCamera, Vector3 } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addCameraInput,
  directionRotation,
  frameStep,
  resetCameraMotion,
  stepCameraInput,
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
  // 앱에서처럼 카메라는 처음부터 중심점을 본다
  controls.update()
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

describe('드래그 입력(짧은 감쇠)', () => {
  afterEach(resetCameraMotion)

  const settle = (
    camera: PerspectiveCamera,
    controls: { target: Vector3; update: () => void }
  ): number => {
    let frames = 0
    while (stepCameraInput(camera, controls, 1 / 60, 600) && frames < 1000) frames++
    return frames
  }

  it('한 번에 다 가지 않고, 짧게(0.3초 안) 따라가 마우스가 움직인 만큼 정확히 간다', () => {
    const { camera, controls } = setup(new Vector3(5, 0, 0), new Vector3(0, 0, 0))
    addCameraInput('orbit', 150, 0)
    stepCameraInput(camera, controls, 1 / 60, 600)
    const angle = (): number => Math.atan2(camera.position.y, camera.position.x)
    // 첫 프레임에는 일부만
    expect(Math.abs(angle())).toBeGreaterThan(0)
    expect(Math.abs(angle())).toBeLessThan(Math.PI / 2 - 0.1)
    expect(settle(camera, controls)).toBeLessThan(18)
    // 화면 높이(600)의 1/4을 끌면 OrbitControls처럼 1/4바퀴(오른쪽으로 끌면 시계 방향)
    expect(angle()).toBeCloseTo(-Math.PI / 2, 4)
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(5, 6)
    expect(isCameraMoving()).toBe(false)
  })

  it('나눠서 들어온 입력도 합은 같다(이벤트 박자와 관계없다)', () => {
    const a = setup(new Vector3(3, 1, 2), new Vector3(0, 0, 0))
    addCameraInput('pan', 40, -25)
    settle(a.camera, a.controls)
    const b = setup(new Vector3(3, 1, 2), new Vector3(0, 0, 0))
    for (let i = 0; i < 5; i++) {
      addCameraInput('pan', 8, -5)
      stepCameraInput(b.camera, b.controls, 1 / 144, 600)
    }
    settle(b.camera, b.controls)
    expect(b.camera.position.distanceTo(a.camera.position)).toBeLessThan(1e-3)
    expect(b.controls.target.distanceTo(a.controls.target)).toBeLessThan(1e-3)
  })

  it('둘러보기: 아래로 끌면 아래를 보고, 카메라는 그 자리에 있다. 위·아래 끝은 넘지 않는다', () => {
    const { camera, controls } = setup(new Vector3(0, 0, 1), new Vector3(1, 0, 1))
    addCameraInput('look', 0, 50)
    settle(camera, controls)
    expect(camera.position.toArray()).toEqual([0, 0, 1])
    expect(controls.target.z).toBeLessThan(1)
    addCameraInput('look', 0, 10000)
    settle(camera, controls)
    const direction = controls.target.clone().sub(camera.position).normalize()
    expect(direction.z).toBeGreaterThan(-1)
  })

  it('팬은 카메라와 중심점을 함께, 줌 드래그는 아래로 끌면 다가간다', () => {
    const { camera, controls } = setup(new Vector3(5, 0, 0), new Vector3(0, 0, 0))
    addCameraInput('dolly', 0, 30)
    settle(camera, controls)
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(5 * Math.exp(-0.3), 6)
    const offset = camera.position.clone().sub(controls.target)
    addCameraInput('pan', 20, 0)
    settle(camera, controls)
    expect(camera.position.clone().sub(controls.target).distanceTo(offset)).toBeLessThan(1e-9)
  })

  it('포커스 이동(F)이 시작하면 남은 드래그 양은 버린다', () => {
    const { camera, controls } = setup(new Vector3(5, 0, 0), new Vector3(0, 0, 0))
    addCameraInput('orbit', 300, 0)
    flyCameraTo(camera, controls, new Vector3(0, 5, 0), new Vector3(0, 0, 0))
    expect(stepCameraInput(camera, controls, 1 / 60, 600)).toBe(false)
  })

  it('쉬다가 그린 첫 프레임의 큰 delta는 한 프레임으로 본다', () => {
    expect(frameStep(3)).toBeCloseTo(1 / 60)
    expect(frameStep(0)).toBeCloseTo(1 / 60)
    expect(frameStep(0.02)).toBe(0.02)
  })
})
