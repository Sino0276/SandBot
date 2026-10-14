import { create } from 'zustand'

// 진행 중인 STEP 불러오기(새로 불러오기, 파일 다시 찾기, 프로젝트를 열 때 CAD 형상 읽기).
// 큰 STEP 하나에 메모리를 수 GB 쓰므로 한 번에 하나만 하도록 버튼·드롭을 막고, 창을 닫을 때 확인한다.
type ImportState = { running: number }

export const useImportStore = create<ImportState>()(() => ({ running: 0 }))

const controllers = new Set<AbortController>()

// 불러오기를 시작한다. 돌려준 컨트롤러로 취소하고, 끝나면 endImport를 부른다.
export function beginImport(): AbortController {
  const controller = new AbortController()
  controllers.add(controller)
  useImportStore.setState((state) => ({ running: state.running + 1 }))
  return controller
}

export function endImport(controller: AbortController): void {
  if (!controllers.delete(controller)) return
  useImportStore.setState((state) => ({ running: state.running - 1 }))
}

// 다른 프로젝트를 열거나 창을 닫을 때 진행 중인 불러오기를 모두 멈춘다
export function cancelAllImports(): void {
  for (const controller of controllers) controller.abort()
}

export function isImporting(): boolean {
  return useImportStore.getState().running > 0
}
