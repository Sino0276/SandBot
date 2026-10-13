import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ComponentRef } from 'react'
import { MOUSE, Quaternion, Vector3 } from 'three'
import { useEditorStore } from '../editorStore'
import { MAX_FLY_SPEED, MIN_FLY_SPEED, useFlyStore } from '../flyStore'

// Unity 씬 뷰와 같은 카메라 조작.
// - 우클릭 드래그: 제자리에서 둘러보기. 누른 채 W/A/S/D(앞·왼쪽·뒤·오른쪽), Q/E(아래·위)로 비행,
//   Shift는 빠르게, 휠은 비행 속도.
// - 가운데 드래그: 화면 이동(팬). 손 도구(Q)에서는 왼쪽 드래그도 팬.
// - Alt+왼쪽 드래그: 중심점 기준 궤도 회전. Alt+오른쪽 드래그와 휠: 줌.
// 궤도·팬·줌은 OrbitControls(three-stdlib)의 버튼 배정을 누를 때마다 바꿔서 쓰고, 둘러보기·비행은 직접 처리한다.
// 다른 코드(포커스, 보기 기준 전환, 축 표시)는 계속 OrbitControls의 target을 중심점으로 쓴다.

// OrbitControls에서 아무 동작도 하지 않는 버튼 값(MOUSE에 없는 값이면 동작하지 않는다)
const NONE = -1 as MOUSE
const LOOK_RADIANS_PER_PIXEL = 0.004
const SHIFT_MULTIPLIER = 4
const WHEEL_SPEED_STEP = 1.2
// 둘러볼 때 바로 위·아래를 넘어가지 않게 남겨 두는 각도
const MIN_POLAR = 0.02

const UP = new Vector3(0, 0, 1)

const FLY_KEYS: Record<string, Vector3> = {
  w: new Vector3(0, 0, -1),
  s: new Vector3(0, 0, 1),
  a: new Vector3(-1, 0, 0),
  d: new Vector3(1, 0, 0),
  q: new Vector3(0, -1, 0),
  e: new Vector3(0, 1, 0)
}

function EditorCameraControls(): React.JSX.Element {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const events = useThree((state) => state.events)
  const invalidate = useThree((state) => state.invalidate)
  const pressed = useRef(new Set<string>())
  // 누를 때마다 바꾸는 버튼 배정(OrbitControls가 이 객체를 그대로 쓴다)
  const mouseButtons = useMemo(() => ({ LEFT: NONE, MIDDLE: MOUSE.PAN, RIGHT: NONE }), [])
  const shift = useRef(false)

  useEffect(() => {
    const element = (events.connected ?? gl.domElement) as HTMLElement
    const fly = useFlyStore
    let flyPointer: number | null = null

    const stopFlying = (): void => {
      if (flyPointer !== null && element.hasPointerCapture(flyPointer))
        element.releasePointerCapture(flyPointer)
      flyPointer = null
      pressed.current.clear()
      if (fly.getState().flying) fly.setState({ flying: false })
    }

    // OrbitControls보다 먼저(캡처 단계) 이번 드래그의 버튼 배정을 정한다
    const onPointerDown = (event: PointerEvent): void => {
      const orbit = controls.current
      if (!orbit || event.pointerType === 'touch') return
      const hand = useEditorStore.getState().tool === 'view'
      orbit.mouseButtons.LEFT = event.altKey ? MOUSE.ROTATE : hand ? MOUSE.PAN : NONE
      orbit.mouseButtons.MIDDLE = MOUSE.PAN
      orbit.mouseButtons.RIGHT = event.altKey ? MOUSE.DOLLY : NONE
      if (event.button === 2 && !event.altKey) {
        flyPointer = event.pointerId
        element.setPointerCapture(event.pointerId)
        shift.current = event.shiftKey
        fly.setState({ flying: true })
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const orbit = controls.current
      if (!orbit || flyPointer !== event.pointerId) return
      const offset = orbit.target.clone().sub(camera.position)
      const distance = offset.length() || 1
      const direction = offset.divideScalar(distance)
      // 좌우: 위(Z)축 둘레로, 상하: 카메라 오른쪽 축 둘레로 돈다
      direction.applyQuaternion(
        new Quaternion().setFromAxisAngle(UP, -event.movementX * LOOK_RADIANS_PER_PIXEL)
      )
      const right = new Vector3().crossVectors(direction, UP).normalize()
      const pitched = direction
        .clone()
        .applyQuaternion(
          new Quaternion().setFromAxisAngle(right, -event.movementY * LOOK_RADIANS_PER_PIXEL)
        )
      const polar = pitched.angleTo(UP)
      if (polar > MIN_POLAR && polar < Math.PI - MIN_POLAR) direction.copy(pitched)
      orbit.target.copy(camera.position).addScaledVector(direction, distance)
      camera.lookAt(orbit.target)
      orbit.update()
      invalidate()
    }

    // 여러 버튼을 같이 누르면 마지막 버튼을 놓을 때만 pointerup이 온다
    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId === flyPointer) stopFlying()
    }

    // 비행 중 휠은 줌 대신 비행 속도를 바꾼다
    const onWheel = (event: WheelEvent): void => {
      if (!fly.getState().flying) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const factor = event.deltaY < 0 ? WHEEL_SPEED_STEP : 1 / WHEEL_SPEED_STEP
      const speed = Math.min(MAX_FLY_SPEED, Math.max(MIN_FLY_SPEED, fly.getState().speed * factor))
      fly.setState({ speed })
    }

    const onKey = (event: KeyboardEvent): void => {
      shift.current = event.shiftKey
      if (!fly.getState().flying) return
      const key = event.key.toLowerCase()
      if (!(key in FLY_KEYS)) return
      event.preventDefault()
      if (event.type === 'keydown') pressed.current.add(key)
      else pressed.current.delete(key)
      invalidate()
    }

    element.addEventListener('pointerdown', onPointerDown, { capture: true })
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('lostpointercapture', stopFlying)
    element.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', stopFlying)
    return () => {
      stopFlying()
      element.removeEventListener('pointerdown', onPointerDown, { capture: true })
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('lostpointercapture', stopFlying)
      element.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', stopFlying)
    }
  }, [camera, events.connected, gl.domElement, invalidate])

  // 비행: 누르고 있는 키 방향으로 카메라와 중심점을 함께 옮긴다. 움직이는 동안 다음 프레임을 요청한다.
  useFrame((_, delta) => {
    const orbit = controls.current
    if (!orbit || !useFlyStore.getState().flying || pressed.current.size === 0) return
    const local = new Vector3()
    for (const key of pressed.current) local.add(FLY_KEYS[key])
    if (local.lengthSq() === 0) {
      invalidate()
      return
    }
    // 앞뒤·좌우는 카메라 기준, Q/E는 필드 위아래
    const forward = camera.getWorldDirection(new Vector3())
    const right = new Vector3().crossVectors(forward, UP).normalize()
    const move = new Vector3()
      .addScaledVector(forward, -local.z)
      .addScaledVector(right, local.x)
      .addScaledVector(UP, local.y)
      .normalize()
    const speed = useFlyStore.getState().speed * (shift.current ? SHIFT_MULTIPLIER : 1)
    // 창이 잠시 멈췄다 돌아와도 크게 튀지 않게 한 프레임 이동량을 제한한다
    move.multiplyScalar(speed * Math.min(delta, 0.1))
    camera.position.add(move)
    orbit.target.add(move)
    orbit.update()
    invalidate()
  })

  return (
    // Unity처럼 놓으면 바로 멈추게 관성(damping)은 끈다
    <OrbitControls ref={controls} makeDefault enableDamping={false} mouseButtons={mouseButtons} />
  )
}

export default EditorCameraControls
