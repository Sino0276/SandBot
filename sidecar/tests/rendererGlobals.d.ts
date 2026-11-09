// 사이드카 시험(tsconfig.node.json)이 렌더러 모듈을 들여올 때의 전역 형식. visionSim.test.ts(I7)가 렌더러 세계 빌더·임시 씬
// 스토어를 쓰면 그 의존이 window.api(preload)를 참조하는데, node 쪽 타입 검사에서는 src/preload/index.ts가 있어 같은 이름의
// index.d.ts(전역 Window 선언)가 읽히지 않는다. 시험은 IPC를 부르지 않는다(형식만).
import type { SandbotApi } from '../../src/shared/ipc'

declare global {
  interface Window {
    api: SandbotApi
  }
}
