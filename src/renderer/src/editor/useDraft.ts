import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../project/projectStore'

// 입력칸의 확정하지 않은 초안(Enter·포커스 이동 전). 초안이 있는 동안에는 창을 닫을 때
// 저장 확인을 거치도록 projectStore.pendingEdit를 켠다(projectActions가 메인 프로세스에 알린다).
export function useDraft(): [string | null, (draft: string | null) => void] {
  const [draft, setDraftState] = useState<string | null>(null)
  const pending = useRef(false)

  const setDraft = (next: string | null): void => {
    setDraftState(next)
    const isPending = next !== null
    if (pending.current !== isPending) {
      pending.current = isPending
      useProjectStore.setState({ pendingEdit: isPending })
    }
  }

  // 선택이 바뀌어 입력칸이 사라지면 초안도 버린다
  useEffect(
    () => () => {
      if (pending.current) useProjectStore.setState({ pendingEdit: false })
    },
    []
  )
  return [draft, setDraft]
}

// 입력 중인 칸을 확정한다(blur하면 입력칸이 초안을 확정한다). 저장·열기·INIT 전에 부른다.
// 입력칸이 아니면 포커스를 그대로 둔다: 씬 뷰를 blur하면 키보드 게임패드가 모든 키를 떼고 꺼지고(W를 누른 채
// Ctrl+S), 다른 곳(Console 목록 등)도 포커스가 <body>로 떨어져 다음 Delete·F가 씬에 간다.
export function commitFocusedInput(
  active: Element | null = typeof document === 'undefined' ? null : document.activeElement
): void {
  const element = active as HTMLElement | null
  if (
    element &&
    (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)
  )
    element.blur()
}
