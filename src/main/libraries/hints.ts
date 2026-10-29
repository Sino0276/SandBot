import type { GradleDiagnostic } from '../../shared/gradle'
import { coordinateOf, type LibraryEntry } from '../../shared/libraries'
import type { DiagnosticHint } from '../../shared/play'
import type { CompileDiagnostic } from '../../shared/sidecarProtocol'
import { isKnownLibrary, knownPackageOf } from './policy'

// 컴파일 진단에 붙이는 라이브러리 안내. 팀 코드가 'package X does not exist'(compiler.err.doesnt.exist)나
// 'cannot find symbol … location: package X'(compiler.err.cant.resolve*)로 실패했을 때, X가 알려진 라이브러리의 패키지면
// - X를 가진 좌표(policy.ts의 owns)를 불러오지 않았으면(지원 안 함·받기 실패) 그 좌표와 이유. 팀 Gradle에 선언한 것이
//   libraryNotLoaded, 선언한 라이브러리가 끌어온 의존성이면 dependencyNotLoaded(끌어온 쪽의 선언을 함께)
// - 어느 선언에도 없으면 undeclared(Android Studio에서도 컴파일되지 않는다). 단 SandBot이 읽지 못한 Gradle 내용(진단)이
//   있거나 담은 패키지를 모르는 좌표를 불러오지 않았으면 거기 있을 수 있으므로 단정하지 않는다(maybeUndeclared)
// 를 붙인다. 불러온 jar에 있는 패키지(그 jar의 API가 다른 것), 같은 라이브러리의 다른 버전 API(Pedro 3.x 프로젝트의 2.x
// 패키지 등)와 모르는 패키지(팀 자신의 패키지 등)는 안내하지 않는다.

const DOESNT_EXIST = /package ([\p{L}\p{N}_$.]+) does not exist/u
const LOCATION_PACKAGE = /location:\s+package ([\p{L}\p{N}_$.]+)/u
// 불러온 라이브러리의 클래스가 불러오지 않은 라이브러리를 참조할 때(Road Runner → FTC Dashboard 등)
const CLASS_FILE_NOT_FOUND = /class file for ([\p{L}\p{N}_$.]+) not found/u

export function missingPackage(diagnostic: CompileDiagnostic): string | null {
  if (diagnostic.kind !== 'error') return null
  if (diagnostic.code === 'compiler.err.doesnt.exist')
    return DOESNT_EXIST.exec(diagnostic.message)?.[1] ?? null
  if (diagnostic.code.startsWith('compiler.err.cant.resolve'))
    return LOCATION_PACKAGE.exec(diagnostic.message)?.[1] ?? null
  if (diagnostic.code === 'compiler.err.cant.access') {
    const className = CLASS_FILE_NOT_FOUND.exec(diagnostic.message)?.[1]
    const dot = className?.lastIndexOf('.') ?? -1
    return className && dot > 0 ? className.slice(0, dot) : null
  }
  return null
}

const NOT_LOADED: ReadonlySet<LibraryEntry['status']> = new Set(['unsupported', 'failed'])

export function diagnosticHints(
  entries: readonly LibraryEntry[],
  compilePackages: ReadonlySet<string>,
  gradleDiagnostics: readonly GradleDiagnostic[]
): (diagnostic: CompileDiagnostic) => DiagnosticHint | null {
  // 선언을 모두 읽었고, 불러오지 않은 좌표는 모두 담은 패키지를 안다
  const complete =
    gradleDiagnostics.length === 0 &&
    !entries.some(
      (entry) =>
        NOT_LOADED.has(entry.status) && !isKnownLibrary(entry.group, entry.artifact, entry.version)
    )
  return (diagnostic) => {
    const packageName = missingPackage(diagnostic)
    if (packageName === null || compilePackages.has(packageName)) return null
    const known = knownPackageOf(packageName)
    if (!known) return null
    const owners = entries.filter((entry) => known.owns(entry.group, entry.artifact, entry.version))
    const notLoaded = owners.filter((entry) => NOT_LOADED.has(entry.status))
    // 직접 선언한 것을 먼저
    const declared = notLoaded.find((entry) => entry.declaredAt !== null)
    if (declared)
      return {
        kind: 'libraryNotLoaded',
        coordinate: coordinateOf(declared),
        reason: declared.reason
      }
    const dependency = notLoaded.find((entry) => entry.requestedBy.length > 0)
    if (dependency)
      return {
        kind: 'dependencyNotLoaded',
        coordinate: coordinateOf(dependency),
        reason: dependency.reason,
        requestedBy: dependency.requestedBy[0]
      }
    // 그 패키지를 가진 좌표를 불러왔거나(실행 범위만인 것 등) 같은 라이브러리의 다른 버전·모듈을 선언했다: 좌표 안내가
    // 맞지 않다. 다른 라이브러리를 거쳐서만 오는 패키지(library null)는 선언했는지 말하지 않는다.
    if (
      owners.length > 0 ||
      known.library === null ||
      entries.some((entry) => known.library?.(entry.group, entry.artifact))
    )
      return null
    return complete ? { kind: 'undeclared', packageName } : { kind: 'maybeUndeclared', packageName }
  }
}
