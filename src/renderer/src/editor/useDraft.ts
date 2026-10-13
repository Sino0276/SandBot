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
