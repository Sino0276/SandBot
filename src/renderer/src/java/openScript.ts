import { fileNameOf } from '../cad/importStep'
import { dismissNotice, showNotice } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import { ipcErrorDetail } from './ipcError'
import { refreshJavaIndex } from './javaIndex'

export { ipcErrorDetail }

// 마지막 열기 실패 알림. 다시 열 때 지워 같은 알림이 쌓이지 않게 한다.
let lastNotice = 0

// 연결한 Java 파일을 외부 스크립트 편집기(환경 설정 > External Tools)로 연다. 실패하면 이유를 알린다.
// 경로 확인·편집기 실행은 메인 프로세스가 한다(렌더러는 TeamCode 기준 경로만 보낸다).
export async function openScriptFile(path: string, line?: number): Promise<void> {
  const root = useProjectStore.getState().root
  if (!root) return
  const fileName = fileNameOf(path)
  dismissNotice(lastNotice)
  lastNotice = 0
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
  if (result.ok) return
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
