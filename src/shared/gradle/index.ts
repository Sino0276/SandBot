import type { GradleFileSource, GradleProject } from './types'

export type {
  GradleConfiguration,
  GradleDependency,
  GradleDiagnostic,
  GradleDiagnosticCode,
  GradleExclude,
  GradleFileSource,
  GradleLocation,
  GradleProject,
  GradleRepository,
  GradleRepositoryKind
} from './types'

// 팀 프로젝트의 Gradle 파일을 읽는다(계약: 구현은 이 폴더의 읽기 모듈이 채운다).
export async function readGradleProject(source: GradleFileSource): Promise<GradleProject> {
  void source
  return { dependencies: [], repositories: [], compileSdk: null, diagnostics: [], files: [] }
}
