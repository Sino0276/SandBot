import { create } from 'zustand'

type ProjectState = {
  // 열린 FtcRobotController 폴더. 없으면 아직 저장하지 않은 씬이다.
  root: string | null
  name: string | null
  dirty: boolean
  // 원본 STEP을 찾지 못한 CAD 루트 id
  missingCad: string[]
  // 열기·저장 중
  busy: boolean
}

export const useProjectStore = create<ProjectState>()(() => ({
  root: null,
  name: null,
  dirty: false,
  missingCad: [],
  busy: false
}))
