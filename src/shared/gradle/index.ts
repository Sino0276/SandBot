import { readGradle } from './reader'
import type { GradleFileSource, GradleProject } from './types'

export type {
  GradleConfiguration,
  GradleDependency,
  GradleDiagnostic,
  GradleDiagnosticCode,
  GradleExclude,
  GradleFileProblem,
  GradleFileSource,
  GradleLocation,
  GradleProject,
  GradleRepository,
  GradleRepositoryKind
} from './types'
export { MAX_GRADLE_FILE_BYTES, isSafeProjectPath } from './paths'
export { MAX_APPLIED_SCRIPTS, MAX_APPLY_DEPTH, MAX_GRADLE_FILES, MAX_GRADLE_WORK } from './reader'

// 팀 프로젝트의 Gradle 파일을 읽는다(src/shared/gradle/reader.ts). Gradle·Groovy를 실행하지 않고 글자로만 읽으며,
// 풀 수 없는 것은 추측하지 않고 진단으로 남긴다. 어떤 파일 내용에도 예외를 던지지 않는다.
export function readGradleProject(source: GradleFileSource): Promise<GradleProject> {
  return readGradle(source)
}
