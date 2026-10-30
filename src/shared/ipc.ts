// 메인 프로세스 ↔ preload ↔ 렌더러가 함께 쓰는 IPC 채널과 API 타입
import type { GeneratedFile, SyncGeneratedResult } from './generatedFiles'
import type {
  AndroidSdkChoice,
  AndroidSdkState,
  GamepadState,
  JdkChoice,
  JdkState,
  ListOpModesResult,
  ListRegisteredResult,
  PlayCommand,
  PlayEvent,
  PlayInitRequest,
  PlayInitResult
} from './play'

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
  listJavaFiles: 'teamcode:list-java-files',
  openJavaFile: 'teamcode:open-java-file',
  readJavaFile: 'teamcode:read-java-file',
  writeJavaLiterals: 'teamcode:write-java-literals',
  readJavaSources: 'teamcode:read-java-sources',
  getExternalEditor: 'editor:get-external-editor',
  setExternalEditor: 'editor:set-external-editor',
  getJdk: 'jdk:get',
  setJdk: 'jdk:set',
  getAndroidSdk: 'android-sdk:get',
  setAndroidSdk: 'android-sdk:set',
  listOpModes: 'play:list-opmodes',
  listRegisteredOpModes: 'play:list-registered-opmodes',
  readTeamCodeAsset: 'teamcode:read-asset',
  playInit: 'play:init',
  playCommand: 'play:command',
  playGamepads: 'play:gamepads',
  playEvent: 'play:event',
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

// TeamCode의 assets 파일 하나(Dashboard 그림 '/images/x.png' → TeamCode/src/main/assets/images/x.png). 그림만(png·jpeg·
// webp·gif), 열거나 저장한 루트, 경로 규칙, 크기 한도.
export type TeamCodeAssetMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
export type ReadTeamCodeAssetResult =
  | { ok: true; mime: TeamCodeAssetMime; bytes: Uint8Array }
  | { ok: false; code: 'notAllowed' | 'missing' | 'tooLarge' | 'failed'; detail: string }

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

// TeamCode의 Java 소스(TeamCode/src/main/java 아래). path는 TeamCode 기준 상대 경로('/' 구분, 예:
// 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'). 규칙은 src/shared/teamCodePaths.ts.
export type JavaFileEntry = { path: string; size: number; mtimeMs: number }

// truncated: 파일 수 한도를 넘어 일부만 담았다. hasTeamCode: 프로젝트에 TeamCode 폴더가 있다.
export type JavaFileList = { files: JavaFileEntry[]; truncated: boolean; hasTeamCode: boolean }

// 외부 스크립트 편집기(Unity Preferences > External Tools > External Script Editor).
// 설정은 실행 파일 경로를 담으므로 메인 프로세스가 userData에 갖고, 렌더러는 고르기만 한다(경로를 보내지 않는다).
// - system: 운영체제에서 .java에 연결된 앱(Unity의 Open by file extension). 줄 번호는 넘기지 못한다.
// - detected: 이 PC에서 찾은 편집기(Android Studio, IntelliJ IDEA, VS Code). 줄 번호로 연다.
// - custom: 찾아보기로 고른 실행 파일과 인자 템플릿($(File) $(Line) $(Column) $(ProjectPath)).
export type ExternalEditorKind = 'system' | 'detected' | 'custom'

// name은 제품 이름이라 번역하지 않는다
export type DetectedEditor = { id: string; name: string; exe: string }

export type ExternalEditorState = {
  kind: ExternalEditorKind
  // detected일 때 고른 편집기 id
  detectedId: string | null
  // detected·custom일 때 실행 파일(표시용)
  exe: string | null
  // custom일 때 인자 템플릿
  args: string | null
  // 기본 인자 템플릿(custom의 [초기화] 값)
  defaultArgs: string
  detected: DetectedEditor[]
  // setExternalEditor가 이번 선택을 받지 않은 이유(설정은 그대로다). 렌더러가 번역해 보여 준다.
  error?: ExternalEditorError
}

// - unsupportedFile: 찾아보기로 고른 파일을 실행할 수 없다(Windows는 .exe만. .bat·.cmd·.lnk·.ps1은 셸이 필요하다)
// - invalidArgs: 인자 템플릿에 $(File)이 없거나, 따옴표가 닫히지 않았거나, 줄바꿈 등 쓸 수 없는 글자가 있거나, 너무 길다
export type ExternalEditorError = 'unsupportedFile' | 'invalidArgs'

export type ExternalEditorChoice =
  | { kind: 'system' }
  | { kind: 'detected'; id: string }
  // 메인이 파일 대화상자를 띄운다(제목은 렌더러가 번역해서 넘김). 취소하면 바뀌지 않는다.
  | { kind: 'browse'; title: string }
  | { kind: 'customArgs'; args: string }
  | { kind: 'resetArgs' }

// 실패 이유
// - notAllowed: 열린 프로젝트가 아니거나 허용하지 않는 경로
// - missing: 파일이 없다
// - launchFailed: 편집기를 실행하지 못했다(detail에 이유)
// - openFailed: 운영체제가 파일을 열지 못했다(연결된 앱이 없는 등, detail에 이유)
// lineIgnored: 줄 번호를 넘겼지만 지금 편집기가 받지 못한다(확장자로 열기, $(Line)이 없는 인자 템플릿). 파일만 열었다.
export type OpenJavaFileResult =
  | { ok: true; lineIgnored?: true }
  | { ok: false; code: 'notAllowed' | 'missing' | 'launchFailed' | 'openFailed'; detail: string }

// 튜닝 값을 쓸 수 없는 파일 상태: encoding(UTF-8로 그대로 되돌릴 수 없음), generated(생성 표식),
// readOnly(읽기 전용: 쓰기 비트 없음, Windows 읽기 전용 속성, 이 사용자가 파일이나 그 폴더에 쓸 수 없음),
// tooLarge(1 MB 초과).
// 쓰기(writeJavaLiterals)의 refused reason도 같은 글자다(읽은 뒤 파일 상태가 바뀌었을 때).
export type JavaFileProblem = 'encoding' | 'generated' | 'readOnly' | 'tooLarge'

// TeamCode Java 파일 읽기(튜닝 값). 메인이 Buffer.toString('utf8')로 읽는다(BOM을 남겨 오프셋이 쓰기와 같다).
// editable이 false면 보여 주기만 하고 reason에 이유(JavaFileProblem)가 있다. tooLarge면 text·hash가 빈 글자다.
// hash는 디스크 바이트의 SHA-256(쓰기의 expectedHash).
export type ReadJavaFileResult =
  | {
      ok: true
      text: string
      hash: string
      editable: boolean
      reason?: JavaFileProblem
    }
  | { ok: false; code: 'notAllowed' | 'missing' | 'failed'; detail: string }

// 리터럴 한 곳 바꾸기. start·end는 text의 오프셋, expected는 지금 그 자리의 글자, text는 새 리터럴
// (src/shared/java/javaLiteral.ts의 isWritableLiteral에 맞아야 한다).
export type JavaLiteralEdit = { start: number; end: number; expected: string; text: string }

// written: 썼다(새 내용과 해시). changed: 읽은 뒤 파일이 바뀌었다(다시 읽고 한 번 더 해 본다).
// missing: 파일이 없다. refused: 확인에 걸려 쓰지 않았다(reason에 이유. 파일 상태면 JavaFileProblem 글자,
// 그 밖에는 'notAllowed: …'나 편집 확인 이유).
export type WriteJavaLiteralsResult =
  | { status: 'written'; text: string; hash: string }
  | { status: 'changed' }
  | { status: 'missing' }
  | { status: 'refused'; reason: string }

// 사용처(4단계)가 TeamCode Java를 한꺼번에 읽는 한도: 한 번에 경로 수, 돌려주는 글자 바이트(넘으면 나머지는
// deferred로 다시 묻게 한다), 파일 하나의 크기(넘으면 tooLarge, 렉서·추출이 너무 오래 걸린다).
export const MAX_SOURCE_PATHS = 256
export const MAX_SOURCE_BATCH_BYTES = 4 * 1024 * 1024
export const MAX_USAGE_FILE_BYTES = 256 * 1024

// 사용처를 찾으려고 읽은 파일 하나. ok·tooLarge의 size·mtimeMs는 읽은 핸들의 stat이다(목록의 것과 비교해 다시
// 읽을지 정한다). 쓰지 않으므로 인코딩·생성 표식은 따지지 않는다(Buffer.toString('utf8')).
export type JavaSourceRead =
  | { path: string; status: 'ok'; text: string; size: number; mtimeMs: number }
  | { path: string; status: 'tooLarge'; size: number; mtimeMs: number }
  | { path: string; status: 'missing' | 'notAllowed' | 'failed' }
  // 이번 묶음의 바이트 한도를 다 써서 읽지 않았다(다시 묻는다)
  | { path: string; status: 'deferred' }

export type ReadJavaSourcesResult =
  { ok: true; files: JavaSourceRead[] } | { ok: false; code: 'notAllowed'; detail: string }

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
  // TeamCode Java 목록. root는 열거나 저장한 프로젝트여야 한다(메인이 확인한다).
  listJavaFiles: (root: string) => Promise<JavaFileList>
  // 외부 편집기로 연다. line은 1부터(없으면 파일만 연다).
  openJavaFile: (root: string, path: string, line?: number) => Promise<OpenJavaFileResult>
  // 튜닝 값: 연결한 Java 파일을 읽고, 저장(Ctrl+S) 때 리터럴만 바꿔 쓴다
  readJavaFile: (root: string, path: string) => Promise<ReadJavaFileResult>
  writeJavaLiterals: (
    root: string,
    path: string,
    expectedHash: string,
    edits: JavaLiteralEdit[]
  ) => Promise<WriteJavaLiteralsResult>
  // 사용처: 목록(listJavaFiles)의 경로를 한꺼번에 읽는다. root는 열거나 저장한 프로젝트, 경로는 MAX_SOURCE_PATHS개까지.
  readJavaSources: (root: string, paths: string[]) => Promise<ReadJavaSourcesResult>
  getExternalEditor: () => Promise<ExternalEditorState>
  setExternalEditor: (choice: ExternalEditorChoice) => Promise<ExternalEditorState>
  // 사이드카가 쓸 JDK(Unity External Tools처럼 환경 설정에서 고름). 설정은 메인의 userData/jdk.json.
  getJdk: () => Promise<JdkState>
  setJdk: (choice: JdkChoice) => Promise<JdkState>
  // 팀 코드를 컴파일할 Android SDK(플랫폼 API). 설정은 메인의 userData/android-sdk.json. root가 있으면 그 프로젝트의
  // local.properties(sdk.dir)도 찾는다(열거나 저장한 프로젝트만).
  getAndroidSdk: (root: string | null) => Promise<AndroidSdkState>
  setAndroidSdk: (choice: AndroidSdkChoice, root: string | null) => Promise<AndroidSdkState>
  // 실행(Play). root는 열거나 저장한 프로젝트여야 한다(메인이 확인한다).
  listOpModes: (root: string) => Promise<ListOpModesResult>
  // TeamCode의 @OpModeRegistrar가 등록하는 OpMode(JVM에서 등록기를 실행, 결과는 캐시). listOpModes의 registrars가 있을 때.
  listRegisteredOpModes: (root: string) => Promise<ListRegisteredResult>
  // Dashboard 오버레이 그림('/images/…'를 TeamCode/src/main/assets 기준 경로로 바꾼 'images/…')
  readTeamCodeAsset: (root: string, path: string) => Promise<ReadTeamCodeAssetResult>
  // JDK·사이드카를 확인하고 JVM을 띄워 컴파일·INIT까지 시작한다. 진행은 onPlayEvent로 온다.
  playInit: (request: PlayInitRequest) => Promise<PlayInitResult>
  // 지금 실행에 보내는 명령(실행이 없으면 무시)
  playCommand: (command: PlayCommand) => void
  // 게임패드 1·2의 지금 상태(바뀔 때만). 다음 틱 경계에 사이드카로 간다.
  playGamepads: (gamepads: [GamepadState | null, GamepadState | null]) => void
  onPlayEvent: (callback: (event: PlayEvent) => void) => () => void
  // 저장 안 된 변경이 있으면 창을 닫을 때 렌더러에게 먼저 묻는다
  setDirty: (dirty: boolean) => void
  onCloseRequested: (callback: () => void) => () => void
  confirmClose: () => void
}
