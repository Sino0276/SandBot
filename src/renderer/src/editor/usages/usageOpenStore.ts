import { create } from 'zustand'
import type { UsageCardKind, UsageSectionId } from './usageView'

// 사용처를 펼쳤는지. 카드 종류(장치·그룹·로봇)마다 하나이고 메모리에만 둔다(project.json·localStorage에 넣지 않는다).
// 다른 오브젝트를 골라도 같은 종류 카드는 같은 상태로 보인다(Unity 인스펙터의 접힌 컴포넌트와 같음).
// parts는 그 안의 접어 두는 부분(같은 글자의 다른 문자열, 구성에 없는 이름)을 펼쳤는지다(처음에는 접혀 있다).
type UsageOpenState = {
  open: Record<UsageCardKind, boolean>
  parts: Partial<Record<`${UsageCardKind}:${UsageSectionId}`, boolean>>
  setOpen: (kind: UsageCardKind, open: boolean) => void
  setPartOpen: (kind: UsageCardKind, section: UsageSectionId, open: boolean) => void
}

export const INITIAL_USAGE_OPEN = {
  open: { device: false, group: false, robot: false },
  parts: {}
}

export const useUsageOpenStore = create<UsageOpenState>()((set) => ({
  ...INITIAL_USAGE_OPEN,
  setOpen: (kind, open) => set((state) => ({ open: { ...state.open, [kind]: open } })),
  setPartOpen: (kind, section, open) =>
    set((state) => ({ parts: { ...state.parts, [`${kind}:${section}`]: open } }))
}))
