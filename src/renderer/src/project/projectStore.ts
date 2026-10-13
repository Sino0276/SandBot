import { create } from 'zustand'
import type { SyncGeneratedResult } from '../../../shared/generatedFiles'

// 저장할 때 TeamCode에 생성 코드를 맞춘 결과
export type GenerationResult =
  // 하드웨어 설정에 오류가 있어 만들지 않았다(이전 생성 파일도 그대로 둔다)
  { status: 'blocked'; errors: number } | { status: 'failed'; detail: string } | SyncGeneratedResult

type ProjectState = {
  // 열린 FtcRobotController 폴더. 없으면 아직 저장하지 않은 씬이다.
  root: string | null
  name: string | null
  dirty: boolean
  // 원본 STEP을 찾지 못한 CAD 루트 id
  missingCad: string[]
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
  busy: false,
  generation: null,
  pendingEdit: false
}))
