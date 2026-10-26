import { PerspectiveCamera, Quaternion, Vector3, type Camera } from 'three'
import type { OrbitControlsLike } from './frameHooks'

// 카메라를 순간 이동시키지 않고 부드럽게 옮긴다(Unity 씬 뷰처럼).
// - 포커스(F)·축 표시 클릭: 중심점과 거리는 이어서, 보는 방향은 구면으로 돌아가며 짧게 날아간다.
// - 휠 줌: 목표 거리를 정하고 매 프레임 그쪽으로 따라간다.
// - 마우스 드래그(둘러보기·궤도·팬·줌 드래그): 이벤트마다 움직일 양을 쌓아 두고, 매 프레임 남은 양의 일부를 적용한다
//   (짧은 감쇠, 약 50 ms). 이벤트가 오는 박자가 고르지 않아도 화면은 프레임마다 고르게 움직이고, 움직인 양의 합은
//   마우스를 그대로 따른다(놓은 뒤 남은 양만 짧게 마저 간다. 관성으로 더 미끄러지지 않는다).
// 사용자가 카메라를 직접 조작하면(누르기·휠·비행) 진행 중인 포커스·줌 이동은 멈추고 조작이 이긴다.
// 값은 EditorCameraControls의 useFrame이 stepCameraMotion으로 진행한다(frameloop="demand"라 움직이는 동안
// 다음 프레임을 요청한다).

export const FLIGHT_SECONDS = 0.35
// 휠 줌이 목표 거리를 따라가는 속도(1초에 남은 거리의 1 - e^-k 만큼)
const ZOOM_FOLLOW_RATE = 18
// 한 프레임에 진행할 최대 시간. demand 모드에서는 쉬다가 그린 첫 프레임의 delta가 크다.
const MAX_STEP_SECONDS = 1 / 30
const MIN_DISTANCE = 0.002
// 드래그 입력이 따라가는 속도(1초에 남은 양의 1 - e^-k 만큼). 약 50 ms에 대부분 붙는다.
export const INPUT_FOLLOW_RATE = 20
// 남은 드래그 양이 이보다 작으면(화소) 나머지를 한 번에 적용한다
const INPUT_SNAP_PIXELS = 0.5
// 둘러보기(제자리 회전) 화소당 각도
const LOOK_RADIANS_PER_PIXEL = 0.004
// 줌 드래그(Alt+오른쪽) 화소당 거리 비율(아래로 끌면 다가간다, OrbitControls와 같은 방향)
const DOLLY_PER_PIXEL = 0.01
// 바로 위·아래를 넘어가지 않게 남겨 두는 각도
const MIN_POLAR = 0.02
// 쉬다가 그린 첫 프레임(demand 모드)의 delta는 쉰 시간이라 이보다 크면 한 프레임으로 본다
const IDLE_DELTA = 0.1

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

// 드래그 종류: 둘러보기(우클릭, 제자리), 궤도(Alt+왼쪽, 중심점 둘레), 팬(가운데·손 도구), 줌(Alt+오른쪽)
export type DragMode = 'look' | 'orbit' | 'pan' | 'dolly'

// 아직 적용하지 않은 드래그 양(화소)
const pending = { lookX: 0, lookY: 0, orbitX: 0, orbitY: 0, panX: 0, panY: 0, dolly: 0 }

// 마우스가 움직인 화소를 쌓는다. 적용은 stepCameraInput이 프레임마다 한다.
export function addCameraInput(mode: DragMode, dx: number, dy: number): void {
  if (mode === 'look') {
    pending.lookX += dx
    pending.lookY += dy
  } else if (mode === 'orbit') {
    pending.orbitX += dx
    pending.orbitY += dy
  } else if (mode === 'pan') {
    pending.panX += dx
    pending.panY += dy
  } else {
    pending.dolly += dy
  }
}

function clearInput(): void {
  for (const key of Object.keys(pending) as (keyof typeof pending)[]) pending[key] = 0
}

function hasInput(): boolean {
  return Object.values(pending).some((value) => value !== 0)
}

// 쉬다가 그린 첫 프레임의 큰 delta를 한 프레임(1/60초)으로 바꾼다. 비행이 시작할 때 툭 튀지 않게 한다.
export function frameStep(delta: number): number {
  return delta > IDLE_DELTA || delta <= 0 ? 1 / 60 : delta
}

// offset(중심점 → 카메라)을 위축 둘레로 yaw, 극각을 pitch만큼 바꾼다(위·아래 끝은 넘지 않는다)
function rotateOffset(offset: Vector3, yaw: number, pitch: number): void {
  offset.applyQuaternion(new Quaternion().setFromAxisAngle(UP, yaw))
  const length = offset.length()
  if (length === 0 || pitch === 0) return
  const polar = Math.acos(Math.min(1, Math.max(-1, offset.z / length)))
  const next = Math.min(Math.PI - MIN_POLAR, Math.max(MIN_POLAR, polar + pitch))
  const horizontal = new Vector3(offset.x, offset.y, 0)
  if (horizontal.lengthSq() < 1e-18) return
  horizontal.normalize()
  offset.copy(horizontal.multiplyScalar(Math.sin(next) * length)).setZ(Math.cos(next) * length)
}

// 쌓인 드래그 양의 일부를 적용한다. viewportHeight는 캔버스 높이(화소, 궤도·팬 크기). 아직 남았으면 true.
export function stepCameraInput(
  camera: Camera,
  controls: OrbitControlsLike,
  delta: number,
  viewportHeight: number
): boolean {
  if (!hasInput()) return false
  const fraction = 1 - Math.exp(-INPUT_FOLLOW_RATE * Math.min(delta, IDLE_DELTA))
  // 남은 양이 반 화소 아래면 나머지를 한 번에(보이지 않는 꼬리를 그리느라 큰 CAD를 계속 다시 그리지 않게)
  const take = (key: keyof typeof pending, epsilon: number): number => {
    const value = pending[key]
    const amount = Math.abs(value) <= epsilon ? value : value * fraction
    pending[key] = value - amount
    return amount
  }
  const height = Math.max(viewportHeight, 1)
  const lookX = take('lookX', INPUT_SNAP_PIXELS)
  const lookY = take('lookY', INPUT_SNAP_PIXELS)
  const orbitX = take('orbitX', INPUT_SNAP_PIXELS)
  const orbitY = take('orbitY', INPUT_SNAP_PIXELS)
  const panX = take('panX', INPUT_SNAP_PIXELS)
  const panY = take('panY', INPUT_SNAP_PIXELS)
  const dolly = take('dolly', INPUT_SNAP_PIXELS)

  // 둘러보기: 카메라 자리에서 보는 방향만 돈다(중심점이 카메라 앞에서 함께 돈다)
  if (lookX !== 0 || lookY !== 0) {
    const offset = controls.target.clone().sub(camera.position).negate()
    // 아래로 끌면 아래를 본다(보는 방향의 극각이 커지고, 반대 방향인 offset의 극각은 작아진다)
    rotateOffset(offset, -lookX * LOOK_RADIANS_PER_PIXEL, -lookY * LOOK_RADIANS_PER_PIXEL)
    controls.target.copy(camera.position).sub(offset)
  }
  // 궤도: 중심점 둘레로 돈다(OrbitControls와 같은 크기, 화면 높이만큼 끌면 한 바퀴)
  if (orbitX !== 0 || orbitY !== 0) {
    const offset = camera.position.clone().sub(controls.target)
    rotateOffset(offset, (-2 * Math.PI * orbitX) / height, (-2 * Math.PI * orbitY) / height)
    camera.position.copy(controls.target).add(offset)
  }
  // 팬: 중심점 거리에서 커서 아래 점이 마우스를 따라간다(OrbitControls의 화면 평면 팬과 같다)
  if (panX !== 0 || panY !== 0) {
    const distance = camera.position.distanceTo(controls.target)
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50
    const perPixel = (2 * distance * Math.tan(((fov / 2) * Math.PI) / 180)) / height
    camera.updateMatrixWorld()
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    const move = right.multiplyScalar(-panX * perPixel).addScaledVector(up, panY * perPixel)
    camera.position.add(move)
    controls.target.add(move)
  }
  // 줌 드래그: 거리 비율
  if (dolly !== 0) {
    const offset = camera.position.clone().sub(controls.target)
    const distance = Math.max(offset.length() * Math.exp(-dolly * DOLLY_PER_PIXEL), MIN_DISTANCE)
    camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance)
  }
  controls.update()
  return hasInput()
}

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
  // 날아가는 동안 남은 드래그 양이 끼어들지 않게 버린다
  clearInput()
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
  return flight !== null || zoomDistance !== null || hasInput()
}

// 테스트용: 쌓인 드래그 양까지 모두 버린다
export function resetCameraMotion(): void {
  stopCameraMotion()
  clearInput()
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
