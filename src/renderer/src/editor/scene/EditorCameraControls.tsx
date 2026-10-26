import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ComponentRef } from 'react'
import { MOUSE, Vector3 } from 'three'
import { getActiveGizmo, useEditorStore } from '../editorStore'
import { MAX_FLY_SPEED, MIN_FLY_SPEED, useFlyStore } from '../flyStore'
import {
  addCameraInput,
  frameStep,
  stepCameraInput,
  stepCameraMotion,
  stopCameraMotion,
  zoomCamera,
  type DragMode
} from './cameraMotion'

// Unity 씬 뷰와 같은 카메라 조작.
// - 우클릭 드래그: 제자리에서 둘러보기. 누른 채 W/A/S/D(앞·왼쪽·뒤·오른쪽), Q/E(아래·위)로 비행,
//   Shift는 빠르게, 휠은 비행 속도.
// - 가운데 드래그: 화면 이동(팬). 손 도구(Q)에서는 왼쪽 드래그도 팬.
// - Alt+왼쪽 드래그: 중심점 기준 궤도 회전. Alt+오른쪽 드래그와 휠: 줌.
// 마우스 드래그(둘러보기·궤도·팬·줌)는 직접 받아 움직일 양을 cameraMotion에 쌓고, 프레임마다 짧은 감쇠(약 50 ms)로
// 적용한다(이벤트 박자가 고르지 않아도 고르게 움직이고, 움직인 양의 합은 마우스와 같다). 휠 줌은 목표 거리를
// 따라가고, 비행은 가속·감속한다. Unity는 감쇠 없이 마우스를 바로 따르지만, 프레임이 고르지 않은 큰 CAD에서
// 딱딱하게 보여 짧게 둔다.
// OrbitControls(three-stdlib)는 중심점(target)을 들고 있고 터치 조작만 한다(마우스 버튼은 모두 끈다). 다른 코드
// (포커스, 보기 기준 전환, 축 표시)는 계속 OrbitControls의 target을 중심점으로 쓴다.

// OrbitControls에서 아무 동작도 하지 않는 버튼 값(MOUSE에 없는 값이면 동작하지 않는다)
const NONE = -1 as MOUSE
const SHIFT_MULTIPLIER = 4
const WHEEL_SPEED_STEP = 1.2
// 휠 한 칸(약 100px)마다 거리 배율. OrbitControls 기본값(한 번에 0.95)과 같은 정도다.
const WHEEL_ZOOM_STEP = 1 / 0.95
// 비행 속도가 원하는 속도를 따라가는 빠르기(1초에 남은 차이의 1 - e^-k 만큼). 약 0.1초에 대부분 붙는다.
const FLY_ACCELERATION = 12
// PointerEvent.buttons의 비트(왼쪽·오른쪽·가운데)
const BUTTON_BITS = [1, 4, 2]

const UP = new Vector3(0, 0, 1)

// 키 위치(event.code)로 받는다. 한글 입력 상태나 다른 자판 배열에서도 같은 자리의 키가 움직인다.
const FLY_KEYS: Record<string, Vector3> = {
  KeyW: new Vector3(0, 0, -1),
  KeyS: new Vector3(0, 0, 1),
  KeyA: new Vector3(-1, 0, 0),
  KeyD: new Vector3(1, 0, 0),
  KeyQ: new Vector3(0, -1, 0),
  KeyE: new Vector3(0, 1, 0)
}

// 휠 한 칸(약 100px)마다 비행 속도를 WHEEL_SPEED_STEP배. 터치패드처럼 작은 값이 많이 오는 장치도 같은 비율로 바뀐다.
function wheelPixels(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * 100
  return event.deltaY
}

function EditorCameraControls(): React.JSX.Element {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const events = useThree((state) => state.events)
  const invalidate = useThree((state) => state.invalidate)
  const pressed = useRef(new Set<string>())
  // 마우스는 직접 처리하므로 OrbitControls의 버튼 배정은 모두 끈다(터치는 OrbitControls가 한다)
  const mouseButtons = useMemo(() => ({ LEFT: NONE, MIDDLE: NONE, RIGHT: NONE }), [])
  const shift = useRef(false)
  // 비행 속도(월드, m/s). 키를 누르면 원하는 속도로 붙고, 떼면 줄어든다.
  const velocity = useRef(new Vector3())

  useEffect(() => {
    const element = (events.connected ?? gl.domElement) as HTMLElement
    const fly = useFlyStore
    let flyPointer: number | null = null
    // 지금 드래그 중인 카메라 조작(둘러보기는 비행과 같은 포인터)
    // 이동량은 창 좌표(clientX)의 차이로 센다. movementX는 HiDPI Windows에서 물리 화소로 오고, 합성 이벤트에서는
    // movementX·screenX가 0이다. 포인터를 잡고 있어 창 밖으로 나가도 clientX는 계속 온다.
    let drag: {
      pointerId: number
      mode: DragMode
      button: number
      lastX: number
      lastY: number
    } | null = null

    const endDrag = (): void => {
      if (drag && drag.mode !== 'look' && element.hasPointerCapture(drag.pointerId))
        element.releasePointerCapture(drag.pointerId)
      drag = null
    }
    // Alt+드래그 동안 잠시 끈 변환 핸들
    let suppressedGizmo: { enabled: boolean } | null = null

    const restoreGizmo = (): void => {
      if (suppressedGizmo) suppressedGizmo.enabled = true
      suppressedGizmo = null
    }

    const stopFlying = (): void => {
      if (flyPointer !== null && element.hasPointerCapture(flyPointer))
        element.releasePointerCapture(flyPointer)
      flyPointer = null
      pressed.current.clear()
      if (drag?.mode === 'look') drag = null
      // Unity처럼 오른쪽 버튼을 놓으면 비행은 바로 멈춘다
      velocity.current.set(0, 0, 0)
      if (fly.getState().flying) fly.setState({ flying: false })
    }

    // 핸들·R3F보다 먼저(캡처 단계) 이번 드래그의 조작을 정한다
    const onPointerDown = (event: PointerEvent): void => {
      const orbit = controls.current
      if (!orbit || event.pointerType === 'touch') return
      // 직접 조작이 날아가던 이동·줌보다 우선한다. 축 표시 클릭은 이 다음에 새 이동을 시작한다.
      stopCameraMotion()
      const hand = useEditorStore.getState().tool === 'view'
      // 왼쪽: Alt면 궤도, 손 도구면 팬(아니면 선택·핸들). 가운데: 팬. 오른쪽: Alt면 줌, 아니면 둘러보기·비행.
      const mode: DragMode | null =
        event.button === 0
          ? event.altKey
            ? 'orbit'
            : hand
              ? 'pan'
              : null
          : event.button === 1
            ? 'pan'
            : event.button === 2
              ? event.altKey
                ? 'dolly'
                : 'look'
              : null
      if (mode && !drag) {
        drag = {
          pointerId: event.pointerId,
          mode,
          button: event.button,
          lastX: event.clientX,
          lastY: event.clientY
        }
        if (mode !== 'look') element.setPointerCapture(event.pointerId)
        // 가운데 버튼의 자동 스크롤을 막는다
        if (event.button === 1) event.preventDefault()
      }
      // Unity처럼 Alt+드래그는 기즈모 위에서 시작해도 카메라만 움직인다. 핸들은 같은 pointerdown을
      // 이 리스너 다음에 받으므로, 그 전에 끄고 버튼을 놓으면 다시 켠다.
      const gizmo = getActiveGizmo()
      if (event.altKey && gizmo?.enabled) {
        gizmo.enabled = false
        suppressedGizmo = gizmo
      }
      if (event.button === 2 && !event.altKey) {
        flyPointer = event.pointerId
        element.setPointerCapture(event.pointerId)
        shift.current = event.shiftKey
        fly.setState({ flying: true })
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!drag || drag.pointerId !== event.pointerId) return
      // 여러 버튼을 함께 누르면 그 버튼을 놓아도 pointerup 없이 pointermove만 온다
      if ((event.buttons & BUTTON_BITS[drag.button]) === 0) {
        if (drag.mode === 'look') stopFlying()
        else endDrag()
        return
      }
      const dx = event.clientX - drag.lastX
      const dy = event.clientY - drag.lastY
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      if (dx === 0 && dy === 0) return
      addCameraInput(drag.mode, dx, dy)
      invalidate()
    }

    // 여러 버튼을 같이 누르면 마지막 버튼을 놓을 때만 pointerup이 온다
    const onPointerUp = (event: PointerEvent): void => {
      restoreGizmo()
      if (event.pointerId === flyPointer) stopFlying()
      if (drag && drag.pointerId === event.pointerId) endDrag()
    }

    // 휠: 평소에는 부드러운 줌, 비행 중에는 비행 속도. OrbitControls의 휠 줌(한 번에 툭 움직임)은 쓰지 않는다.
    const onWheel = (event: WheelEvent): void => {
      const orbit = controls.current
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!fly.getState().flying) {
        if (!orbit) return
        zoomCamera(camera, orbit, Math.pow(WHEEL_ZOOM_STEP, wheelPixels(event) / 100))
        invalidate()
        return
      }
      const factor = Math.pow(WHEEL_SPEED_STEP, -wheelPixels(event) / 100)
      const speed = Math.min(MAX_FLY_SPEED, Math.max(MIN_FLY_SPEED, fly.getState().speed * factor))
      fly.setState({ speed })
    }

    const onKey = (event: KeyboardEvent): void => {
      shift.current = event.shiftKey
      if (!fly.getState().flying) return
      if (!(event.code in FLY_KEYS)) return
      event.preventDefault()
      if (event.type === 'keydown') pressed.current.add(event.code)
      else pressed.current.delete(event.code)
      invalidate()
    }

    element.addEventListener('pointerdown', onPointerDown, { capture: true })
    element.addEventListener('pointermove', onPointerMove)
    // 핸들을 다시 켜는 것은 캔버스 밖에서 놓아도 해야 하므로 창에서 받는다
    window.addEventListener('pointerup', onPointerUp)
    element.addEventListener('lostpointercapture', stopFlying)
    element.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', stopFlying)
    window.addEventListener('blur', endDrag)
    return () => {
      stopFlying()
      endDrag()
      window.removeEventListener('blur', endDrag)
      element.removeEventListener('pointerdown', onPointerDown, { capture: true })
      element.removeEventListener('pointermove', onPointerMove)
      restoreGizmo()
      window.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('lostpointercapture', stopFlying)
      element.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', stopFlying)
    }
  }, [camera, events.connected, gl.domElement, invalidate])

  // 포커스·축 표시 이동과 휠 줌을 진행하고, 비행 중이면 누르고 있는 키 방향으로 카메라와 중심점을 함께 옮긴다.
  // 움직이는 동안 다음 프레임을 요청한다.
  useFrame((_, delta) => {
    const orbit = controls.current
    if (!orbit) return
    // 쉬다가 그린 첫 프레임의 큰 delta(쉰 시간)는 한 프레임으로 본다. 비행·드래그가 시작할 때 툭 튀지 않는다.
    const step = frameStep(delta)
    if (stepCameraInput(camera, orbit, step, gl.domElement.clientHeight)) invalidate()
    if (stepCameraMotion(camera, orbit, step)) invalidate()
    const vel = velocity.current
    if (!useFlyStore.getState().flying || (pressed.current.size === 0 && vel.lengthSq() === 0))
      return
    const local = new Vector3()
    for (const key of pressed.current) local.add(FLY_KEYS[key])
    const speed = useFlyStore.getState().speed * (shift.current ? SHIFT_MULTIPLIER : 1)
    // 앞뒤·좌우는 카메라 기준, Q/E는 필드 위아래
    const desired = new Vector3()
    if (local.lengthSq() > 0) {
      const forward = camera.getWorldDirection(new Vector3())
      const right = new Vector3().crossVectors(forward, UP).normalize()
      desired
        .addScaledVector(forward, -local.z)
        .addScaledVector(right, local.x)
        .addScaledVector(UP, local.y)
        .normalize()
        .multiplyScalar(speed)
    }
    vel.lerp(desired, 1 - Math.exp(-FLY_ACCELERATION * step))
    // 거의 멈췄으면 멈춘다
    if (desired.lengthSq() === 0 && vel.length() < speed * 0.01) vel.set(0, 0, 0)
    const move = vel.clone().multiplyScalar(step)
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
