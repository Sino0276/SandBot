import { MeshStandardMaterial } from 'three'

// 끝난 실행의 잔상 재질(로봇 잔상 SceneObjectsView와 HIVE 잔상 FieldView, 6b). 모듈에서 함께 쓰고 해제하지 않는다(StrictMode가
// 붙였다 떼어도 안전하다). 깊이를 쓰지 않아 뒤의 로봇·필드를 가리지 않는다. 겹 순서는 FIELD_RENDER_ORDER.ghost(5)
export const GHOST_MATERIAL = new MeshStandardMaterial({
  color: '#93c5fd',
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
  metalness: 0,
  roughness: 0.9
})
