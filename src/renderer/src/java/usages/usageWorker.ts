// 사용처 워커(ES 모듈 워커, java/usageIndex.ts가 만든다). UI 스레드를 막지 않도록 파일마다 사실을 만들고 씬
// 기호표와 맞추는 일을 여기서 한다. 논리는 usageWorkerCore.ts에 있고, 여기서는 메시지를 넘기고 답을 보낸다.
// 메시지는 받은 순서대로 처리하므로, 파일을 모두 보낸 뒤 보낸 맞추기는 그 파일들의 사실로 맞춘다.
import { createUsageWorkerState, handleMessage } from './usageWorkerCore'
import type { FromWorker, ToWorker } from './usageTypes'

const scope = self as unknown as {
  onmessage: (event: MessageEvent<ToWorker>) => void
  postMessage: (message: FromWorker) => void
}

const state = createUsageWorkerState()

scope.onmessage = (event) => {
  let reply: FromWorker
  try {
    reply = handleMessage(state, event.data)
  } catch (error) {
    reply = { type: 'error', detail: error instanceof Error ? error.message : String(error) }
  }
  scope.postMessage(reply)
}
