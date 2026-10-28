// 팀 Gradle 파일을 읽은 결과(src/shared/gradle). Gradle·Groovy를 실행하지 않고 글자로만 읽는다. 풀 수 없는 것(변수·메서드
// 호출·조건문 등)은 추측하지 않고 진단으로 남긴다. 경로는 프로젝트 루트 기준('/' 구분).

export type GradleLocation = { file: string; line: number }

// 팀 코드가 보는 구성. compileOnly는 컴파일 클래스패스에만, runtimeOnly는 실행 클래스패스에만 들어간다.
export type GradleConfiguration = 'implementation' | 'api' | 'compileOnly' | 'runtimeOnly'

export type GradleExclude = { group: string | null; module: string | null }

export type GradleDependency = {
  configuration: GradleConfiguration
  group: string
  artifact: string
  // 선언한 버전 글자 그대로(동적 버전 '+'·'latest.release'·범위·SNAPSHOT도 그대로 두고 해석기가 거부한다)
  version: string
  classifier: string | null
  // 'g:a:v@aar'의 확장자(Gradle은 이때 전이 의존성을 끄지 않지만 해석기가 정한다)
  extension: string | null
  excludes: GradleExclude[]
  // { transitive = false }
  transitive: boolean
  at: GradleLocation
}

export type GradleRepositoryKind =
  'mavenCentral' | 'google' | 'maven' | 'mavenLocal' | 'jcenter' | 'gradlePluginPortal' | 'flatDir'

export type GradleRepository = {
  kind: GradleRepositoryKind
  // maven { url … }의 주소(다른 종류는 null)
  url: string | null
  at: GradleLocation
}

// - unresolvedValue: 변수·식을 리터럴로 풀 수 없다(ext에 없는 이름, 메서드 호출 등)
// - unsupportedSyntax: 읽지 못하는 문법(조건문 안의 선언 등)
// - remoteScript: apply from: 'https://…'(읽지 않음)
// - outsideProject: 프로젝트 밖 파일을 apply from 함(읽지 않음)
// - missingFile: apply from 대상이 없다
// - tooLarge: 파일이 너무 크다(읽지 않음)
// - tooDeep: 중첩·apply from이 너무 깊다
// - localDependency: project(':x')·files()·fileTree·flatDir 이름 의존성(SandBot이 쓰지 않음, :FtcRobotController 제외)
// - versionCatalogEntry: libs.x를 libs.versions.toml에서 찾지 못함
export type GradleDiagnosticCode =
  | 'unresolvedValue'
  | 'unsupportedSyntax'
  | 'remoteScript'
  | 'outsideProject'
  | 'missingFile'
  | 'tooLarge'
  | 'tooDeep'
  | 'localDependency'
  | 'versionCatalogEntry'

export type GradleDiagnostic = {
  code: GradleDiagnosticCode
  at: GradleLocation
  // 영어 설명(그 글자 일부 등). 렌더러는 code로 번역한 문장과 함께 보인다.
  detail: string
}

export type GradleProject = {
  // TeamCode 모듈이 보는 의존성(TeamCode/build.gradle과 거기서 apply from 한 파일), 파일·줄 순서
  dependencies: GradleDependency[]
  // 저장소(settings의 dependencyResolutionManagement, 루트 allprojects, TeamCode·apply from 파일), 선언 순서
  repositories: GradleRepository[]
  // android { compileSdkVersion N } / compileSdk N (build.common.gradle 등). 못 찾으면 null.
  compileSdk: number | null
  diagnostics: GradleDiagnostic[]
  // 읽은 파일(프로젝트 기준 경로, 읽은 순서)
  files: string[]
}

// 프로젝트 파일 읽기(메인이 열거나 저장한 프로젝트 루트 안의 보통 파일만 준다). 없거나 읽을 수 없으면 null.
export type GradleFileSource = {
  read: (relPath: string) => Promise<string | null>
}
