import { create } from 'zustand'
import type { SyncGeneratedResult } from '../../../shared/generatedFiles'

// 저장할 때 TeamCode에 생성 코드를 맞춘 결과
export type GenerationResult =
  // 하드웨어 설정에 오류가 있어 만들지 않았다(이전 생성 파일도 그대로 둔다)
  { status: 'blocked'; errors: number } | { status: 'failed'; detail: string } | SyncGeneratedResult

// 프로젝트를 열 때 CAD 형상을 읽은 결과(원본을 찾지 못한 CAD는 missingCad). 형상이 있으면 항목이 없다.
export type CadGeometryStatus = 'loading' | 'failed' | 'cancelled'

type ProjectState = {
  // 열린 FtcRobotController 폴더. 없으면 아직 저장하지 않은 씬이다.
  root: string | null
  name: string | null
  dirty: boolean
  // 원본 STEP을 찾지 못한 CAD 루트 id
  missingCad: string[]
  // CAD 루트 id → 형상 읽기 상태(읽는 중, 실패, 취소). 인스펙터가 보여 주고 [다시 불러오기]를 띄운다.
  cadStatus: Record<string, CadGeometryStatus>
  // 프로젝트를 열(씬을 바꿀) 때마다 늘어난다. 오래 걸린 불러오기가 끝났을 때 그 사이 프로젝트가 바뀌었으면 결과를 버린다.
  session: number
  // 열기·저장 중
  busy: boolean
  // 이 프로젝트에서 마지막으로 저장했을 때의 코드 생성 결과. 아직 저장하지 않았으면 null.
  generation: GenerationResult | null
  // 입력칸에 확정하지 않은 초안이 있다(창을 닫을 때 저장 확인을 거친다)
  pendingEdit: boolean
}

export const useProjectStore = create<ProjectState>()(() => ({
  root: null,
  name: null,
  dirty: false,
  missingCad: [],
  cadStatus: {},
  session: 0,
  busy: false,
  generation: null,
  pendingEdit: false
}))

export function setCadStatus(id: string, status: CadGeometryStatus | null): void {
  useProjectStore.setState((state) => {
    const next = { ...state.cadStatus }
    if (status) next[id] = status
    else delete next[id]
    return { cadStatus: next }
  })
}
