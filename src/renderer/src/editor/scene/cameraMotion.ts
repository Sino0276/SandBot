import { Quaternion, Vector3, type Camera } from 'three'
import type { OrbitControlsLike } from './frameHooks'

// 카메라를 순간 이동시키지 않고 부드럽게 옮긴다(Unity 씬 뷰처럼).
// - 포커스(F)·축 표시 클릭: 중심점과 거리는 이어서, 보는 방향은 구면으로 돌아가며 짧게 날아간다.
// - 휠 줌: 목표 거리를 정하고 매 프레임 그쪽으로 따라간다.
// 사용자가 카메라를 직접 조작하면(누르기·휠·비행) 진행 중인 이동은 멈추고 조작이 이긴다.
// 값은 EditorCameraControls의 useFrame이 stepCameraMotion으로 진행한다(frameloop="demand"라 움직이는 동안
// 다음 프레임을 요청한다).

export const FLIGHT_SECONDS = 0.35
// 휠 줌이 목표 거리를 따라가는 속도(1초에 남은 거리의 1 - e^-k 만큼)
const ZOOM_FOLLOW_RATE = 18
// 한 프레임에 진행할 최대 시간. demand 모드에서는 쉬다가 그린 첫 프레임의 delta가 크다.
const MAX_STEP_SECONDS = 1 / 30
const MIN_DISTANCE = 0.002

const UP = new Vector3(0, 0, 1)

type Flight = {
  fromTarget: Vector3
  toTarget: Vector3
  fromDistance: number
  toDistance: number
  // 보는 방향(중심점 → 카메라)의 시작·끝
  fromDirection: Vector3
  rotation: Quaternion
  elapsed: number
}

let flight: Flight | null = null
let zoomDistance: number | null = null

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// from 방향을 to 방향으로 돌리는 회전. 정반대면 from에 수직이면서 위축(Z)에 가장 가까운 축 둘레로 돈다
// (바로 위·아래를 지나 lookAt이 꼬이지 않게, 수평으로 돌아가게).
export function directionRotation(from: Vector3, to: Vector3): Quaternion {
  if (from.dot(to) > -0.9999) return new Quaternion().setFromUnitVectors(from, to)
  const reference = Math.abs(from.z) < 0.9 ? UP : new Vector3(1, 0, 0)
  const axis = reference.clone().addScaledVector(from, -from.dot(reference)).normalize()
  return new Quaternion().setFromAxisAngle(axis, Math.PI)
}

// 카메라를 position에서 target을 보는 상태로 부드럽게 옮긴다
export function flyCameraTo(
  camera: Camera,
  controls: OrbitControlsLike,
  position: Vector3,
  target: Vector3
): void {
  const fromOffset = camera.position.clone().sub(controls.target)
  const toOffset = position.clone().sub(target)
  const fromDistance = Math.max(fromOffset.length(), MIN_DISTANCE)
  const toDistance = Math.max(toOffset.length(), MIN_DISTANCE)
  const fromDirection = fromOffset.divideScalar(fromDistance)
  const toDirection = toOffset.divideScalar(toDistance)
  zoomDistance = null
  flight = {
    fromTarget: controls.target.clone(),
    toTarget: target.clone(),
    fromDistance,
    toDistance,
    fromDirection,
    rotation: directionRotation(fromDirection, toDirection),
    elapsed: 0
  }
}

// 휠 한 번: 목표 거리에 factor를 곱한다(1보다 작으면 다가감). 날아가는 중이면 멈추고 줌한다.
export function zoomCamera(camera: Camera, controls: OrbitControlsLike, factor: number): void {
  flight = null
  const current = camera.position.distanceTo(controls.target)
  zoomDistance = Math.max((zoomDistance ?? current) * factor, MIN_DISTANCE)
}

export function stopCameraMotion(): void {
  flight = null
  zoomDistance = null
}

export function isCameraMoving(): boolean {
  return flight !== null || zoomDistance !== null
}

// 한 프레임 진행한다. 아직 움직이는 중이면 true.
export function stepCameraMotion(
  camera: Camera,
  controls: OrbitControlsLike,
  delta: number
): boolean {
  const step = Math.min(delta, MAX_STEP_SECONDS)
  if (flight) {
    flight.elapsed += step
    const t = Math.min(flight.elapsed / FLIGHT_SECONDS, 1)
    const k = easeInOut(t)
    const direction = flight.fromDirection
      .clone()
      .applyQuaternion(new Quaternion().slerp(flight.rotation, k))
    // 거리는 비율로 이어서 가까운 물체와 먼 시점 사이도 고르게 움직인다
    const distance = flight.fromDistance * Math.pow(flight.toDistance / flight.fromDistance, k)
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k)
    camera.position.copy(controls.target).addScaledVector(direction, distance)
    controls.update()
    if (t >= 1) flight = null
    return flight !== null
  }
  if (zoomDistance !== null) {
    const offset = camera.position.clone().sub(controls.target)
    const current = offset.length()
    const next = zoomDistance + (current - zoomDistance) * Math.exp(-ZOOM_FOLLOW_RATE * step)
    const done = Math.abs(next - zoomDistance) <= zoomDistance * 1e-3
    camera.position
      .copy(controls.target)
      .addScaledVector(offset.divideScalar(current || 1), done ? zoomDistance : next)
    controls.update()
    if (done) zoomDistance = null
    return zoomDistance !== null
  }
  return false
}
