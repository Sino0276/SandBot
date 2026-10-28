import type { LibraryProgress } from '../../../shared/libraries'
import { dismissNotice, showNotice, updateNotice, type NoticeKey } from '../editor/noticeStore'
import { formatBytes } from './libraryConsole'
import { isRunActive, usePlayStore, type PlayData } from './playStore'

// INIT 중 라이브러리 받기 진행 알림(STEP 불러오기와 같은 진행 알림, 경과 시간·[취소]). 지금 실행의 libraryProgress를
// 따라 띄우고 바꾸고, 의존성 보고가 오거나(진행이 지워짐) 실행이 끝나면 닫는다. [취소]는 STOP과 같다(메인이 받기를 멈추고
// INIT을 cancelled로 끝낸다).

export function libraryNoticeText(progress: LibraryProgress): {
  key: NoticeKey
  params: Record<string, string | number>
} {
  const size = formatBytes(progress.bytes)
  return progress.phase === 'downloading'
    ? { key: 'libraryDownloading', params: { done: progress.done, total: progress.total, size } }
    : { key: 'libraryResolving', params: { done: progress.done, size } }
}

function progressOf(
  data: Pick<PlayData, 'run'>
): { runId: string; progress: LibraryProgress } | null {
  const { run } = data
  return isRunActive(run) && run.libraryProgress
    ? { runId: run.runId, progress: run.libraryProgress }
    : null
}

// 앱 시작 때 한 번(playActions.initPlaySession). 구독을 푸는 함수를 돌려준다.
export function installLibraryNotice(onCancel: () => void): () => void {
  let noticeId = 0
  let noticeRun: string | null = null
  return usePlayStore.subscribe((state, previous) => {
    const current = progressOf(state)
    const before = progressOf(previous)
    if (current?.progress === before?.progress && current?.runId === before?.runId) return
    if (!current) {
      if (noticeId) dismissNotice(noticeId)
      noticeId = 0
      noticeRun = null
      return
    }
    const { key, params } = libraryNoticeText(current.progress)
    if (noticeId && noticeRun === current.runId) {
      updateNotice(noticeId, key, params)
      return
    }
    if (noticeId) dismissNotice(noticeId)
    noticeRun = current.runId
    noticeId = showNotice('progress', key, params, { onCancel })
  })
}
