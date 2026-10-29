// 팀 Gradle 파일에 선언한 라이브러리를 실행에 어떻게 썼는지(메인의 src/main/libraries가 INIT 전에 만든다).
// 지원: Road Runner 1.0(com.acmerobotics.roadrunner), Pedro Pathing 3.x 이상(com.pedropathing:core·revhub, Ivy
// com.pedropathing.ivy), FTCLib core(org.ftclib.ftclib:core)와 그 전이 의존성. FTC Dashboard(com.acmerobotics.dashboard)는
// 컴파일은 팀 버전의 실제 jar로, 실행은 SandBot 구현으로 한다(대체). 그 밖은 불러오지 않고 이유를 알린다.
import type { GradleDiagnostic, GradleLocation } from './gradle'

// - used: 받아서 컴파일·실행 클래스패스에 넣음(실행 때 시간 API를 패치)
// - replaced: 컴파일은 실제 jar, 실행은 SandBot 구현(FTC Dashboard)
// - provided: 가짜 FTC SDK에 이미 있다(FTC SDK, Gson, NanoHTTPD 등) 또는 Android 쪽이라 쓰지 않는다(androidx·com.android)
// - unsupported: 지원하지 않아 불러오지 않음(reason)
// - failed: 받지 못함(reason, detail)
export type LibraryStatus = 'used' | 'replaced' | 'provided' | 'unsupported' | 'failed'

// unsupported의 이유
// - pedroTuning: Pedro AutoTune(com.pedropathing:tuning, 웹 서버·자체 스레드) — 로봇에서만
// - pedro2: Pedro Pathing 2.x(com.pedropathing:ftc, 구 com.pedropathing:ivy) — 3.x 이상만 지원
// - panels: Panels(com.bylazar) — Pedro 2.x 도구
// - dairy: Sloth·Sinister(dev.frozenmilk) — 핫 리로드·앱 훅(Android 전용)
// - ftcLibVision: FTCLib vision(네이티브 OpenCV)
// - notSupported: 지원 목록과 그 전이 의존성 밖
// - dynamicVersion: '+'·latest·범위·SNAPSHOT(결정성을 위해 고정 버전만)
// - localModule: project(':x')·files()·flatDir(SandBot이 읽지 않음)
// - repositoryNotAllowed: 허용하지 않은 저장소에만 있다
// failed의 이유
// - notFound: 저장소·Gradle 캐시에 없다(404)
// - offline: 네트워크에 닿지 못했고 캐시에도 없다
// - rateLimited: 저장소가 요청을 막았다(429), 잠시 뒤 다시
// - checksumMismatch: 내용이 체크섬·기록한 해시와 다르다
// - tooLarge: 크기 한도를 넘음
// - badArchive: jar·AAR을 읽을 수 없다(손상, 압축 폭탄, jni 포함 등)
// - protectedPackage: java.*·org.sandbot.*·FTC SDK 패키지의 클래스를 담고 있다
// - badMetadata: POM·.module을 읽을 수 없다
// - cancelled: 사용자가 받기를 취소했다
export type LibraryReason =
  | 'none'
  | 'pedroTuning'
  | 'pedro2'
  | 'panels'
  | 'dairy'
  | 'ftcLibVision'
  | 'notSupported'
  | 'dynamicVersion'
  | 'localModule'
  | 'repositoryNotAllowed'
  | 'notFound'
  | 'offline'
  | 'rateLimited'
  | 'checksumMismatch'
  | 'tooLarge'
  | 'badArchive'
  | 'protectedPackage'
  | 'badMetadata'
  | 'cancelled'

// 받은 파일의 출처와 무결성 확인
// - gradleCache: Android Studio가 받아 둔 Gradle 캐시(폴더 이름 sha1과 내용 확인)
// - libraryCache: SandBot 라이브러리 캐시(전에 받은 것)
// - download: 이번에 허용 저장소에서 받음
export type LibrarySource = 'gradleCache' | 'libraryCache' | 'download'
// - checksum: 저장소의 .module·.sha256·.sha1과 맞음, pinned: SandBot이 아는 해시와 맞음,
//   firstUse: 저장소가 체크섬을 주지 않아 처음 받은 해시를 기록함(maven.brott.dev), gradleCache: Gradle 캐시의 sha1
export type LibraryIntegrity = 'checksum' | 'pinned' | 'firstUse' | 'gradleCache'

export type LibraryEntry = {
  group: string
  artifact: string
  // 고른 버전(충돌이면 가장 높은 것). 버전을 정하지 못했으면 선언한 글자.
  version: string
  // 요청된 버전들(선언과 전이 의존성, 중복 없이 처음 나온 순서)
  requested: string[]
  status: LibraryStatus
  reason: LibraryReason
  // 영어 세부(주소·HTTP 상태 등). 없으면 ''.
  detail: string
  // 팀 Gradle 파일에 직접 쓴 것이면 그 위치
  declaredAt: GradleLocation | null
  // 전이 의존성이면 끌어온 쪽 사슬('g:a:v', 직접 선언한 쪽부터)
  requestedBy: string[]
  source: LibrarySource | null
  integrity: LibraryIntegrity | null
}

export type LibraryReport = {
  // 직접 선언한 것(파일·줄 순서) 다음 전이 의존성(group:artifact 순)
  entries: LibraryEntry[]
  // Gradle 파일을 읽으며 풀지 못한 것
  gradle: GradleDiagnostic[]
  // Gradle 파일의 compileSdk(못 찾으면 null)와 그 부 버전(적지 않았으면 null, GradleProject.compileSdkMinor)
  compileSdk: number | null
  compileSdkMinor: number | null
  // 팀 코드를 컴파일한 Android 플랫폼 API. api·minor는 플랫폼의 주·부 버전(android-36.1이면 36·1, android-N이면 minor
  // null). guessed: compileSdk를 못 찾아 설치된 것 중 가장 높은 것을 씀(경고). 플랫폼 jar 없이 컴파일했으면 null(사이드카 시험만).
  platform: { api: number; minor: number | null; guessed: boolean } | null
}

// 받기 진행(INIT 중). bytes는 지금까지 받은 바이트.
export type LibraryProgress = {
  phase: 'reading' | 'resolving' | 'downloading'
  done: number
  total: number
  bytes: number
}

export function coordinateOf(entry: Pick<LibraryEntry, 'group' | 'artifact' | 'version'>): string {
  return `${entry.group}:${entry.artifact}:${entry.version}`
}
