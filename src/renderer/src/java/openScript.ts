import { create } from 'zustand'
import { fileNameOf } from '../cad/importStep'
import { dismissNotice, showNotice } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import { ipcErrorDetail } from './ipcError'
import { refreshJavaIndex } from './javaIndex'

export { ipcErrorDetail }

// 지금 외부 스크립트 편집기가 줄 번호를 받는지. 줄을 넘겨 연 마지막 결과로 정하고, 모르면 unknown이다.
// 줄로 여는 행(사용처·튜닝 값)의 도움말이 읽는다(no면 파일만 연다고 덧붙인다).
export type LineSupport = 'unknown' | 'yes' | 'no'

export const useLineSupportStore = create<{ support: LineSupport }>()(() => ({
  support: 'unknown'
}))

// resetLineSupport마다 오른다. 열기를 보낸 뒤 편집기 설정이 바뀌었으면 그 열기의 답(이전 편집기의 것)은 쓰지 않는다.
let lineSupportEpoch = 0

// 편집기 설정을 바꾸면 다시 모른다(환경 설정 창이 부른다)
export function resetLineSupport(): void {
  lineSupportEpoch++
  useLineSupportStore.setState({ support: 'unknown' })
}

// 마지막 열기 실패 알림. 다시 열 때 지워 같은 알림이 쌓이지 않게 한다.
let lastNotice = 0
// 줄 번호를 넘기지 못했다는 알림은 앱을 켠 동안 한 번만 띄운다(그 뒤로는 행의 도움말이 알린다).
// 실패 알림과 달리 다음 열기에 지우지 않는다.
let lineIgnoredShown = false

// 테스트용: 한 번만 띄우는 알림과 줄 번호 지원을 처음 상태로 되돌린다
export function resetOpenScriptState(): void {
  lastNotice = 0
  lineIgnoredShown = false
  resetLineSupport()
}

// 연결한 Java 파일을 외부 스크립트 편집기(환경 설정 > External Tools)로 연다. 실패하면 이유를 알린다.
// 경로 확인·편집기 실행은 메인 프로세스가 한다(렌더러는 TeamCode 기준 경로만 보낸다).
export async function openScriptFile(path: string, line?: number): Promise<void> {
  const root = useProjectStore.getState().root
  if (!root) return
  const fileName = fileNameOf(path)
  dismissNotice(lastNotice)
  lastNotice = 0
  const epoch = lineSupportEpoch
  let result
  try {
    result = await window.api.openJavaFile(root, path, line)
  } catch (error) {
    lastNotice = showNotice('error', 'scriptOpenFailed', {
      fileName,
      detail: ipcErrorDetail(error)
    })
    return
  }
  if (result.ok) {
    // 줄을 넘기지 않았으면 편집기가 줄을 받는지 알 수 없다. 여는 사이 편집기를 바꿨으면 이 답은 이전 편집기의 것이다.
    if (line !== undefined && epoch === lineSupportEpoch)
      useLineSupportStore.setState({ support: result.lineIgnored ? 'no' : 'yes' })
    if (result.lineIgnored && !lineIgnoredShown) {
      lineIgnoredShown = true
      showNotice('warning', 'lineIgnored')
    }
    return
  }
  switch (result.code) {
    case 'missing':
      lastNotice = showNotice('warning', 'scriptMissing', { fileName })
      // 그사이 옮겨졌을 수 있으므로 목록을 다시 읽는다(카드가 [다시 연결]을 보인다)
      void refreshJavaIndex()
      return
    case 'notAllowed':
      lastNotice = showNotice('error', 'scriptNotAllowed', { fileName })
      return
    case 'launchFailed':
      lastNotice = showNotice('error', 'scriptLaunchFailed', { fileName, detail: result.detail })
      return
    case 'openFailed':
      lastNotice = showNotice('error', 'scriptOpenFailed', { fileName, detail: result.detail })
      return
  }
}
