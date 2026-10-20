import { create } from 'zustand'
import type { UsageCardKind, UsageSectionId } from './usageView'

// 사용처 부분을 펼쳤는지. 카드 종류(장치·그룹·로봇)마다 하나이고 메모리에만 둔다(저장·localStorage에 넣지 않는다).
// 다른 오브젝트를 골라도 같은 종류 카드는 같은 상태로 보인다(Unity 인스펙터의 접힌 컴포넌트와 같음).
// folded는 그 안의 접어 둔 부분(같은 글자의 다른 문자열, 구성에 없는 이름)이다.
type UsageOpenState = {
  open: Record<UsageCardKind, boolean>
  folded: Partial<Record<`${UsageCardKind}:${UsageSectionId}`, boolean>>
  setOpen: (kind: UsageCardKind, open: boolean) => void
  setFolded: (kind: UsageCardKind, section: UsageSectionId, open: boolean) => void
}

export const useUsageOpenStore = create<UsageOpenState>()((set) => ({
  open: { device: false, group: false, robot: false },
  folded: {},
  setOpen: (kind, open) => set((state) => ({ open: { ...state.open, [kind]: open } })),
  setFolded: (kind, section, open) =>
    set((state) => ({ folded: { ...state.folded, [`${kind}:${section}`]: open } }))
}))
