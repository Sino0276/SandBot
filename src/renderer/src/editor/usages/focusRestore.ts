// 사용처 트리·칸이 지운 노드에서 떨어진 포커스를 되돌리는 도우미(UsageTree·UsageSection).
// 다시 찾아 포커스한 행이 지워지면 브라우저는 포커스를 <body>로 옮기고, React는 커밋 중에 생긴 그 blur를 onBlur로
// 넘기지 않는다. 그대로 두면 인스펙터(localKeys) 밖이라 다음 Delete·F·Q/W/E가 씬에 간다. 그래서 onFocus로 기억해
// 두었다가 사용자가 다른 곳으로 옮긴 때만 잊고, 렌더 뒤(layout effect) 포커스가 떨어졌으면 되돌린다.
// focus()는 같은 요소에 다시 불러도 그대로라 StrictMode의 effect 정리→재실행에도 같다.
import type React from 'react'

// onBlur에서: 포커스가 이 요소 밖으로 옮겨 갔다(잊는다). 창이 포커스를 잃은 것(외부 편집기로 엶)은 아니다.
// 그때는 활성 요소가 그대로 남고, 창이 돌아오면 같은 요소에 onFocus가 다시 온다.
export function focusMovedOut(event: React.FocusEvent<HTMLElement>): boolean {
  if (!document.hasFocus()) return false
  const next = event.relatedTarget
  return !(next instanceof Node && event.currentTarget.contains(next))
}

// 포커스가 아무 데도 없다(지운 노드에서 <body>로 떨어졌다)
export function focusDropped(): boolean {
  const active = document.activeElement
  return active === null || active === document.body
}
