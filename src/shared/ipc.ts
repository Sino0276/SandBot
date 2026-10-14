// 메인 프로세스 ↔ preload ↔ 렌더러가 함께 쓰는 IPC 채널과 API 타입
import type { GeneratedFile, SyncGeneratedResult } from './generatedFiles'

export const IPC = {
  chooseProjectFolder: 'project:choose-folder',
  chooseStepFile: 'cad:choose-step-file',
  openProject: 'project:open',
  saveProject: 'project:save',
  readStepCached: 'cad:read-step-cached',
  statStepFile: 'cad:stat-step-file',
  storeMeshCache: 'cad:store-mesh-cache',
  hasStepConverter: 'cad:has-step-converter',
  convertStep: 'cad:convert-step',
  cancelStepConversion: 'cad:cancel-step-conversion',
  stepConvertProgress: 'cad:step-convert-progress',
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

// STEP 읽기 결과. 캐시가 있으면 model(변환 결과, 렌더러의 ImportedModel)을, 없으면 파일 내용을 준다.
// 캐시가 없을 때 렌더러가 변환한 뒤 key로 storeMeshCache를 부른다.
// size는 파일 크기(바이트). 큰 파일을 불러오기 전에 확인하는 데 쓴다.
export type StepReadResult = {
  key: string
  model: unknown | null
  bytes: Uint8Array | null
  size: number
}

// 네이티브 STEP 변환기(native/step-converter)의 진행 단계: 파일 읽기 → 형상 변환 → 삼각형 만들기 → 결과 쓰기
export const STEP_CONVERT_PHASES = ['read', 'transfer', 'mesh', 'write'] as const
export type StepConvertPhase = (typeof STEP_CONVERT_PHASES)[number]
// 진행 이벤트: 변환기 단계, 또는 다른 변환이 끝나기를 기다리는 중(queued). 변환은 한 번에 하나씩 한다.
export type StepConvertProgress = StepConvertPhase | 'queued'

// 변환 실패 이유
// - unavailable: 이 PC에 변환기가 없거나 실행할 수 없다(렌더러는 WASM으로 대신 읽는다)
// - readFailed: STEP으로 읽지 못했다
// - outOfMemory: 메모리가 부족했다
// - cancelled: 사용자가 취소했다
// - failed: 그 밖의 오류(변환기 비정상 종료 등)
export type StepConvertErrorCode =
  'unavailable' | 'readFailed' | 'outOfMemory' | 'cancelled' | 'failed'

// 성공하면 SBSTEP01 바이트(렌더러의 cad/nativeResult.ts가 읽는다)와, 변환한 바로 그 내용의 메시 캐시 키.
// untranslated는 OCCT가 예외로 건너뛴 STEP 엔티티 수(0보다 크면 일부 형상이 빠졌을 수 있어 캐시하지 않는다).
export type StepConvertResult =
  | { ok: true; key: string; bytes: Uint8Array; untranslated: number }
  | { ok: false; code: StepConvertErrorCode; detail: string }

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
  // STEP 파일을 읽고 메시 캐시를 찾는다(tag는 변환 형식 버전). 파일이 없으면 null.
  // includeBytes가 false면 캐시가 없어도 파일 내용을 보내지 않는다(네이티브 변환기가 파일을 직접 읽을 때).
  readStepCached: (
    path: string,
    tag: string,
    includeBytes: boolean
  ) => Promise<StepReadResult | null>
  storeMeshCache: (key: string, model: unknown) => Promise<void>
  // STEP 파일이 있는지와 크기. 없거나 파일이 아니면 null(프로젝트를 열 때 내용을 읽지 않고 위치만 찾는다).
  statStepFile: (path: string) => Promise<{ size: number } | null>
  // 네이티브 STEP 변환기. requestId는 렌더러가 정하고, 진행 이벤트와 취소에 쓴다.
  hasStepConverter: () => Promise<boolean>
  convertStep: (path: string, tag: string, requestId: string) => Promise<StepConvertResult>
  cancelStepConversion: (requestId: string) => void
  // fraction은 단계 안의 진행률(0~1, 형상 변환 단계만). 모르면 null.
  onStepConvertProgress: (
    callback: (requestId: string, progress: StepConvertProgress, fraction: number | null) => void
  ) => () => void
  // 생성 코드(하드웨어 클래스·구성 XML)를 <root>/TeamCode에 맞춘다. 이번에 만들지 않은 이전 생성 파일은 지운다.
  syncGeneratedFiles: (root: string, files: GeneratedFile[]) => Promise<SyncGeneratedResult>
  // 저장 안 된 변경이 있으면 창을 닫을 때 렌더러에게 먼저 묻는다
  setDirty: (dirty: boolean) => void
  onCloseRequested: (callback: () => void) => () => void
  confirmClose: () => void
}
