import { dismissNotice, showNotice } from '../editor/noticeStore'
import { ipcErrorDetail } from '../java/ipcError'

// 실행이 모의 저장소(userData/sim-files/<프로젝트>/FIRST)에 남긴 파일(Road Runner 튜닝 결과 JSON)을 파일 관리자에서
// 보인다(Console의 그 줄, Unity Console의 Show in Explorer처럼). 경로 확인과 열기는 메인이 한다(revealSimFile).

// 마지막 실패 알림. 다시 보일 때 지워 같은 알림이 쌓이지 않게 한다.
let lastNotice = 0

const fileNameOf = (file: string): string =>
  file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1)

export async function revealSimFile(root: string, file: string): Promise<void> {
  dismissNotice(lastNotice)
  lastNotice = 0
  const fileName = fileNameOf(file)
  let result
  try {
    result = await window.api.revealSimFile(root, file)
  } catch (error) {
    lastNotice = showNotice('error', 'simFileRevealFailed', {
      fileName,
      detail: ipcErrorDetail(error)
    })
    return
  }
  if (result.ok) return
  lastNotice =
    result.code === 'missing'
      ? showNotice('warning', 'simFileMissing', { fileName })
      : showNotice('error', 'simFileRevealFailed', { fileName, detail: result.detail })
}
