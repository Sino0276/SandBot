// Unity 충돌체 기즈모 색(spec-4e §1.8 단순 형상 윤곽과 spec-5 §7 Collider 기즈모가 같이 쓴다). Unity Handles.s_ColliderHandleColor
// (145, 244, 139, 210)/255와 끈 Collider 색(84, 200, 77, 140)/255 [가정: 표시만]
export const COLLIDER_OUTLINE_COLOR = '#91f48b'
export const COLLIDER_DISABLED_COLOR = '#54c84d'
// 앞 패스(깊이 검사 켬)·가려진 패스(깊이 검사 끔) 불투명도 [가정: 표시만]. 가려진 선은 흐리게 보인다(로봇 하부를 가로지르지
// 않게, spec-4e 비평 U8)
export const COLLIDER_OUTLINE_OPACITY = 0.9
export const COLLIDER_OUTLINE_HIDDEN_OPACITY = 0.2
