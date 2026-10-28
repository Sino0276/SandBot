import { coordinateOf, type LibraryEntry } from '../../shared/libraries'
import type { DiagnosticHint } from '../../shared/play'
import type { CompileDiagnostic } from '../../shared/sidecarProtocol'
import { knownPackageOf } from './policy'

// 컴파일 진단에 붙이는 라이브러리 안내. 팀 코드가 'package X does not exist'(compiler.err.doesnt.exist)나
// 'cannot find symbol … location: package X'(compiler.err.cant.resolve*)로 실패했을 때, X가 알려진 라이브러리의 패키지면
// - 팀 Gradle에 선언했지만 불러오지 않았으면(지원 안 함·받기 실패) 그 좌표와 이유(libraryNotLoaded)
// - 어느 선언에도 없으면 undeclared(Android Studio에서도 컴파일되지 않는다)
// 를 붙인다. 불러온 jar에 있는 패키지(그 jar의 API가 다른 것)와 모르는 패키지(팀 자신의 패키지 등)는 안내하지 않는다.

const DOESNT_EXIST = /package ([\p{L}\p{N}_$.]+) does not exist/u
const LOCATION_PACKAGE = /location:\s+package ([\p{L}\p{N}_$.]+)/u

export function missingPackage(diagnostic: CompileDiagnostic): string | null {
  if (diagnostic.kind !== 'error') return null
  if (diagnostic.code === 'compiler.err.doesnt.exist')
    return DOESNT_EXIST.exec(diagnostic.message)?.[1] ?? null
  if (diagnostic.code.startsWith('compiler.err.cant.resolve'))
    return LOCATION_PACKAGE.exec(diagnostic.message)?.[1] ?? null
  return null
}

const NOT_LOADED: ReadonlySet<LibraryEntry['status']> = new Set(['unsupported', 'failed'])

export function diagnosticHints(
  entries: readonly LibraryEntry[],
  compilePackages: ReadonlySet<string>
): (diagnostic: CompileDiagnostic) => DiagnosticHint | null {
  return (diagnostic) => {
    const packageName = missingPackage(diagnostic)
    if (packageName === null || compilePackages.has(packageName)) return null
    const known = knownPackageOf(packageName)
    if (!known) return null
    const matching = entries.filter((entry) => known.matches(entry.group, entry.artifact))
    const notLoaded = matching.filter((entry) => NOT_LOADED.has(entry.status))
    // 직접 선언한 것을 먼저
    const entry = notLoaded.find((candidate) => candidate.declaredAt !== null) ?? notLoaded[0]
    if (entry)
      return { kind: 'libraryNotLoaded', coordinate: coordinateOf(entry), reason: entry.reason }
    // 불러온 라이브러리의 다른 버전 API(예: Pedro 2.x 패키지를 3.x로)거나 실행 범위만인 것: 좌표 안내가 맞지 않다
    if (matching.length > 0) return null
    return { kind: 'undeclared', packageName }
  }
}
