// 메인 프로세스 ↔ preload ↔ 렌더러가 함께 쓰는 IPC 채널과 API 타입
import type { GeneratedFile, SyncGeneratedResult } from './generatedFiles'

export const IPC = {
  chooseProjectFolder: 'project:choose-folder',
  chooseStepFile: 'cad:choose-step-file',
  openProject: 'project:open',
  saveProject: 'project:save',
  readStepFile: 'cad:read-step-file',
  syncGeneratedFiles: 'teamcode:sync-generated-files',
  setDirty: 'app:set-dirty',
  closeRequested: 'app:close-requested',
  confirmClose: 'app:confirm-close'
} as const

export type OpenProjectResult = {
  root: string
  // 폴더 이름. 창 제목과 툴바에 쓴다.
  name: string
  // FtcRobotController 폴더라면 TeamCode가 있어야 한다
  hasTeamCode: boolean
  // sandbot/project.json 내용. 없으면 새 프로젝트다.
  content: string | null
}

// 렌더러에서 window.api로 쓰는 API (preload가 노출)
export type SandbotApi = {
  // 드래그 앤 드롭이나 <input type="file">로 받은 파일의 디스크 경로. 디스크 파일이 아니면 빈 문자열.
  getPathForFile: (file: File) => string
  // 경로 계산(Node path). 상대 경로는 운영체제와 관계없이 '/'로 구분한다.
  relativePath: (from: string, to: string) => string
  resolvePath: (base: string, target: string) => string
  // 대화상자 제목은 렌더러가 번역해서 넘긴다
  chooseProjectFolder: (title: string) => Promise<string | null>
  chooseStepFile: (title: string, defaultPath?: string) => Promise<string | null>
  openProject: (root: string) => Promise<OpenProjectResult>
  saveProject: (root: string, content: string) => Promise<void>
  // STEP 파일 내용. 파일이 없으면 null.
  readStepFile: (path: string) => Promise<Uint8Array | null>
  // 생성 코드(하드웨어 클래스·구성 XML)를 <root>/TeamCode에 맞춘다. 이번에 만들지 않은 이전 생성 파일은 지운다.
  syncGeneratedFiles: (root: string, files: GeneratedFile[]) => Promise<SyncGeneratedResult>
  // 저장 안 된 변경이 있으면 창을 닫을 때 렌더러에게 먼저 묻는다
  setDirty: (dirty: boolean) => void
  onCloseRequested: (callback: () => void) => () => void
  confirmClose: () => void
}
