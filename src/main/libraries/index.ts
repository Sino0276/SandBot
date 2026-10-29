import type { GradleDependency, GradleLocation } from '../../shared/gradle'
import type {
  LibraryEntry,
  LibraryIntegrity,
  LibraryReason,
  LibraryReport,
  LibrarySource
} from '../../shared/libraries'
import type { Failure, LibraryRequest, LibraryResolution } from '../sidecar/launch'
import { classpathJars } from './archive'
import { LibraryCache, MAX_LIBRARY_CACHE_BYTES, sha256Hex } from './cache'
import { FileFetcher, ProgressTracker, type ExpectedHashes } from './fetcher'
import { diagnosticHints } from './hints'
import { CancelledError, type HttpGet, type Sleep } from './http'
import {
  failureOf,
  LibraryFailure,
  metadataSource,
  type MetadataSource,
  type ModuleMetadata
} from './metadata'
import { classifyModule, POLICY_VERSION, type PolicyDecision } from './policy'
import { declaredRepositories } from './repositories'
import { resolveGraph, type ResolvedModule, type Root } from './resolver'
import {
  compareVersions,
  highestVersion,
  isDynamicVersion,
  isValidArtifact,
  isValidClassifier,
  isValidExtension,
  isValidGroup,
  isValidVersion
} from './version'

// 팀 Gradle의 라이브러리를 실행에 쓸 jar로(PlayController의 resolveLibraries). 순서:
// 1. 직접 선언을 정책(policy.ts)으로 나눈다: 제공·지원 안 함·동적 버전은 받지 않고, 지원 계열은 해석의 뿌리, 그 밖은 후보
//    (지원 계열이 끌어온 모듈이면 뿌리로 올리고, 아니면 notSupported). androidx를 선언했으면(FTC 템플릿의 appcompat)
//    androidx.annotation을 컴파일 클래스패스에 넣는다(Android Studio처럼).
// 2. 해석 잠금(resolutions/)과 그 jar가 모두 캐시에 있으면 네트워크·메타데이터 없이 끝낸다.
// 3. 아니면 메타데이터로 그래프를 풀고(resolver.ts) 파일을 얻는다(fetcher.ts: 캐시 → Gradle 캐시 → 받기, 무결성 확인).
//    AAR은 classes.jar·libs/*.jar만(archive.ts). 받지 못한 좌표는 그 좌표만 failed이고 실행은 계속한다(컴파일 진단에 안내).
// 4. 실패가 없으면 잠금을 쓴다. 캐시가 용량을 넘으면 오래 쓰지 않은 것부터 지운다(이번 jar는 남긴다).
// 결과의 순서(보고·클래스패스)는 직접 선언(파일·줄 순서) 다음 전이 의존성(group:artifact 순)이라 결정적이다.

export type LibraryDeps = {
  // userData/library-cache
  cacheDir: string
  // Gradle 사용자 폴더(gradleCache.ts의 gradleUserHome). null이면 Gradle 캐시를 보지 않는다.
  gradleHome: string | null
  http: HttpGet
  sleep?: Sleep
  now?: () => number
  maxCacheBytes?: number
}

const LOCK_FORMAT = 1
// androidx를 선언하면 Android Studio의 컴파일 클래스패스에 생기는 androidx.annotation(appcompat 1.2.0이 끌어오는 버전)
export const ANDROIDX_ANNOTATION = {
  group: 'androidx.annotation',
  artifact: 'annotation',
  version: '1.1.0'
}

type Declared = {
  group: string
  artifact: string
  declarations: GradleDependency[]
  at: GradleLocation
  // 직접 선언을 정책으로 나눈 것(뿌리·후보는 해석 결과로 바뀐다)
  decision:
    | { kind: 'root' }
    | { kind: 'candidate' }
    | { kind: 'fixed'; status: LibraryEntry['status']; reason: LibraryReason; detail: string }
}

type Jar = { path: string; sha256: string; packages: string[]; coordinate: string }

type Built = {
  entry: LibraryEntry
  jars: Jar[]
  compile: boolean
  runtime: boolean
}

function gaOf(group: string, artifact: string): string {
  return `${group}:${artifact}`
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const COMPILE: ReadonlySet<GradleDependency['configuration']> = new Set([
  'implementation',
  'api',
  'compileOnly'
])
const RUNTIME: ReadonlySet<GradleDependency['configuration']> = new Set([
  'implementation',
  'api',
  'runtimeOnly'
])

function declaredVersion(declarations: readonly GradleDependency[]): string {
  return (
    highestVersion(
      declarations.map((d) => d.version).filter((v) => !isDynamicVersion(v) && isValidVersion(v))
    ) ?? declarations[0].version
  )
}

function decide(
  group: string,
  artifact: string,
  declarations: GradleDependency[]
): Declared['decision'] {
  const fixed = (
    status: LibraryEntry['status'],
    reason: LibraryReason,
    detail = ''
  ): Declared['decision'] => ({
    kind: 'fixed',
    status,
    reason,
    detail
  })
  if (
    !isValidGroup(group) ||
    !isValidArtifact(artifact) ||
    declarations.some(
      (d) =>
        (d.classifier !== null && !isValidClassifier(d.classifier)) ||
        (d.extension !== null && !isValidExtension(d.extension))
    )
  )
    return fixed('unsupported', 'notSupported', 'invalid coordinate')
  const dynamic = declarations.find((d) => isDynamicVersion(d.version))
  if (dynamic)
    return fixed('unsupported', 'dynamicVersion', `version ${dynamic.version} is not fixed`)
  const invalid = declarations.find((d) => !isValidVersion(d.version))
  if (invalid) return fixed('unsupported', 'notSupported', `invalid version ${invalid.version}`)
  const policy = classifyModule(group, artifact, declaredVersion(declarations))
  switch (policy.kind) {
    case 'provided':
      return fixed('provided', 'none')
    case 'unsupported':
      return fixed('unsupported', policy.reason, policy.detail)
    case 'supported':
    case 'compileOnly':
      return { kind: 'root' }
    case 'other':
      return { kind: 'candidate' }
  }
}

function declaredModules(dependencies: readonly GradleDependency[]): Declared[] {
  const byKey = new Map<string, Declared>()
  for (const dependency of dependencies) {
    const key = gaOf(dependency.group, dependency.artifact)
    const known = byKey.get(key)
    if (known) known.declarations.push(dependency)
    else
      byKey.set(key, {
        group: dependency.group,
        artifact: dependency.artifact,
        declarations: [dependency],
        at: dependency.at,
        decision: { kind: 'candidate' }
      })
  }
  const declared = [...byKey.values()]
  for (const item of declared) item.decision = decide(item.group, item.artifact, item.declarations)
  return declared
}

function rootsOf(item: Declared): Root[] {
  return item.declarations.map((d) => ({
    group: item.group,
    artifact: item.artifact,
    version: d.version,
    compile: COMPILE.has(d.configuration),
    runtime:
      RUNTIME.has(d.configuration) &&
      classifyModule(item.group, item.artifact, d.version).kind !== 'compileOnly',
    // 'g:a:v@aar'은 Gradle에서 전이 의존성을 끄지 않는다(SandBot도 같게, transitive = false만 끈다)
    transitive: d.transitive,
    exclusions: d.excludes.map((e) => ({ group: e.group, module: e.module }))
  }))
}

function implicitAnnotationRoot(
  declared: readonly Declared[]
): { root: Root; requestedBy: string } | null {
  if (
    declared.some(
      (item) =>
        item.group === ANDROIDX_ANNOTATION.group && item.artifact === ANDROIDX_ANNOTATION.artifact
    )
  )
    return null
  const androidx = declared.find(
    (item) =>
      item.group.startsWith('androidx.') &&
      item.declarations.some((d) => COMPILE.has(d.configuration))
  )
  if (!androidx) return null
  return {
    root: {
      ...ANDROIDX_ANNOTATION,
      compile: true,
      runtime: false,
      transitive: true,
      exclusions: []
    },
    requestedBy: `${androidx.group}:${androidx.artifact}:${declaredVersion(androidx.declarations)}`
  }
}

// ---- 잠금 ----

type LockFile = {
  format: number
  entries: LibraryEntry[]
  jars: {
    coordinate: string
    sha256: string
    packages: string[]
    compile: boolean
    runtime: boolean
  }[]
}

function lockKey(request: LibraryRequest, implicit: boolean): string {
  const repositories = declaredRepositories(request.gradle.repositories)
  return sha256Hex(
    JSON.stringify({
      format: LOCK_FORMAT,
      policy: POLICY_VERSION,
      dependencies: request.gradle.dependencies,
      allowed: [...repositories.allowed].sort(),
      notAllowed: repositories.notAllowed,
      implicit
    })
  )
}

const STATUSES: ReadonlySet<string> = new Set([
  'used',
  'replaced',
  'provided',
  'unsupported',
  'failed'
])

function isEntry(value: unknown): value is LibraryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.group === 'string' &&
    typeof entry.artifact === 'string' &&
    typeof entry.version === 'string' &&
    typeof entry.status === 'string' &&
    STATUSES.has(entry.status) &&
    typeof entry.reason === 'string' &&
    typeof entry.detail === 'string' &&
    Array.isArray(entry.requested) &&
    Array.isArray(entry.requestedBy)
  )
}

function isLock(value: unknown): value is LockFile {
  if (typeof value !== 'object' || value === null) return false
  const lock = value as Partial<LockFile>
  return (
    lock.format === LOCK_FORMAT &&
    Array.isArray(lock.entries) &&
    lock.entries.every(isEntry) &&
    Array.isArray(lock.jars) &&
    lock.jars.every(
      (jar) =>
        typeof jar === 'object' &&
        jar !== null &&
        typeof jar.coordinate === 'string' &&
        typeof jar.sha256 === 'string' &&
        /^[0-9a-f]{64}$/.test(jar.sha256) &&
        Array.isArray(jar.packages) &&
        typeof jar.compile === 'boolean' &&
        typeof jar.runtime === 'boolean'
    )
  )
}

// ---- 결과 ----

function resolution(
  request: LibraryRequest,
  cache: LibraryCache,
  entries: LibraryEntry[],
  jars: { jar: Jar; compile: boolean; runtime: boolean }[]
): LibraryResolution {
  const compileClasspath: string[] = []
  const libraryClasspath: string[] = []
  const jarCoordinates: Record<string, string> = {}
  const compilePackages = new Set<string>()
  for (const { jar, compile, runtime } of jars) {
    const path = cache.blobPath(jar.sha256, 'jar')
    if (jarCoordinates[path] !== undefined) continue
    jarCoordinates[path] = jar.coordinate
    if (compile) {
      compileClasspath.push(path)
      for (const name of jar.packages) compilePackages.add(name)
    }
    if (runtime) libraryClasspath.push(path)
  }
  const report: LibraryReport = {
    entries,
    gradle: request.gradle.diagnostics,
    compileSdk: request.gradle.compileSdk,
    compileSdkMinor: request.gradle.compileSdkMinor,
    platform: null
  }
  return {
    ok: true,
    report,
    compileClasspath,
    libraryClasspath,
    jarCoordinates,
    diagnosticHint: diagnosticHints(entries, compilePackages)
  }
}

async function fromLock(
  cache: LibraryCache,
  key: string,
  request: LibraryRequest
): Promise<LibraryResolution | null> {
  const lock = await cache.readLock(key)
  if (!isLock(lock)) return null
  // 내용 해시까지 확인한다(깨진 jar는 지우고 새로 해석한다). 몇 MB라 INIT마다 해도 빠르다.
  for (const jar of lock.jars) if (!(await cache.readBlob(jar.sha256, 'jar'))) return null
  const entries = lock.entries.map((entry) =>
    entry.source === null ? entry : { ...entry, source: 'libraryCache' as LibrarySource }
  )
  return resolution(
    request,
    cache,
    entries,
    lock.jars.map((jar) => ({
      jar: { path: '', sha256: jar.sha256, packages: jar.packages, coordinate: jar.coordinate },
      compile: jar.compile,
      runtime: jar.runtime
    }))
  )
}

// ---- 해석 ----

function memoize(load: MetadataSource): MetadataSource {
  const cache = new Map<string, Promise<ModuleMetadata>>()
  return (group, artifact, version) => {
    const key = `${group}:${artifact}:${version}`
    let pending = cache.get(key)
    if (!pending) {
      pending = load(group, artifact, version)
      pending.catch(() => undefined)
      cache.set(key, pending)
    }
    return pending
  }
}

function statusOf(module: ResolvedModule): Pick<LibraryEntry, 'status' | 'reason' | 'detail'> {
  const { policy } = module
  if (policy.kind === 'provided') return { status: 'provided', reason: 'none', detail: '' }
  if (policy.kind === 'unsupported')
    return { status: 'unsupported', reason: policy.reason, detail: policy.detail }
  if (module.failure)
    return {
      status: module.failure.reason === 'repositoryNotAllowed' ? 'unsupported' : 'failed',
      reason: module.failure.reason,
      detail: module.failure.detail
    }
  return { status: 'used', reason: 'none', detail: '' }
}

type ArtifactPlan = { file: string; ext: 'jar' | 'aar'; expected: ExpectedHashes | undefined }

// 직접 선언의 분류자·확장자(g:a:v:classifier@ext)가 고른 파일
function artifactPlan(
  module: ResolvedModule,
  declarations: readonly GradleDependency[]
): ArtifactPlan | LibraryFailure | null {
  const meta = module.metadata
  if (!meta) return null
  const declaration = declarations.find((d) => d.classifier !== null || d.extension !== null)
  if (!declaration) return meta.artifact
  const ext = declaration.extension ?? meta.artifact?.ext ?? 'jar'
  if (ext !== 'jar' && ext !== 'aar')
    return new LibraryFailure('badArchive', `unsupported artifact type ${ext}`)
  const file = `${module.artifact}-${module.version}${declaration.classifier ? `-${declaration.classifier}` : ''}.${ext}`
  const listed = meta.files.find((candidate) => candidate.url === file || candidate.name === file)
  return {
    file,
    ext,
    expected: listed
      ? { sha256: listed.sha256, sha512: listed.sha512, sha1: listed.sha1, size: listed.size }
      : meta.artifact?.file === file
        ? meta.artifact.expected
        : undefined
  }
}

async function resolveFresh(
  request: LibraryRequest,
  deps: LibraryDeps,
  cache: LibraryCache,
  declared: Declared[],
  implicit: ReturnType<typeof implicitAnnotationRoot>,
  key: string
): Promise<LibraryResolution> {
  const progress = new ProgressTracker(request.progress, deps.now)
  const fetcher = new FileFetcher({
    cache,
    gradleHome: deps.gradleHome,
    http: deps.http,
    signal: request.signal,
    declared: declaredRepositories(request.gradle.repositories),
    progress,
    sleep: deps.sleep
  })
  const load = memoize(
    metadataSource(
      fetcher,
      () => progress.begin(),
      () => progress.step()
    )
  )
  const classify = (group: string, artifact: string, version: string): PolicyDecision =>
    classifyModule(group, artifact, version)

  progress.setPhase('resolving', 0)
  const roots: Root[] = declared.filter((item) => item.decision.kind === 'root').flatMap(rootsOf)
  if (implicit) roots.push(implicit.root)
  const promoted = new Set<string>()
  let modules = roots.length > 0 ? await resolveGraph(roots, load, classify) : []
  // 지원 계열이 끌어온 모듈을 직접 선언했으면 그 선언도 뿌리로(그 버전이 충돌에 들어간다)
  for (let round = 0; round < 5; round++) {
    const reached = new Set(modules.map((m) => gaOf(m.group, m.artifact)))
    const promote = declared.filter(
      (item) =>
        item.decision.kind === 'candidate' &&
        !promoted.has(gaOf(item.group, item.artifact)) &&
        reached.has(gaOf(item.group, item.artifact))
    )
    if (promote.length === 0) break
    for (const item of promote) {
      promoted.add(gaOf(item.group, item.artifact))
      roots.push(...rootsOf(item))
    }
    modules = await resolveGraph(roots, load, classify)
  }
  if (request.signal.aborted) throw new CancelledError()

  const byKey = new Map(modules.map((m) => [gaOf(m.group, m.artifact), m]))
  const declaredKeys = new Set(declared.map((item) => gaOf(item.group, item.artifact)))

  // 파일 받기
  const wanted = modules.filter((m) => statusOf(m).status === 'used' && m.metadata !== null)
  progress.setPhase('downloading', wanted.length)
  const built = new Map<string, Built>()
  const outcomes = await Promise.all(
    wanted.map(async (module) => {
      const ga = gaOf(module.group, module.artifact)
      const item = declared.find((d) => gaOf(d.group, d.artifact) === ga)
      const plan = artifactPlan(module, item?.declarations ?? [])
      try {
        if (plan instanceof LibraryFailure) throw plan
        if (plan === null) return { ga, jars: [] as Jar[], source: null, integrity: null }
        const fetched = await fetcher.fetch({
          group: module.group,
          artifact: module.artifact,
          version: module.version,
          file: plan.file,
          kind: 'artifact',
          ext: plan.ext,
          expected: plan.expected
        })
        let set = await cache.readJarSet(fetched.sha256)
        if (!set) {
          const jars = classpathJars(plan.file, fetched.bytes)
          const stored: { name: string; sha256: string; packages: string[] }[] = []
          for (const jar of jars) {
            const { sha256 } = await cache.storeBlob(jar.bytes, 'jar')
            stored.push({ name: jar.name, sha256, packages: jar.packages })
          }
          set = { jars: stored }
          await cache.writeJarSet(fetched.sha256, set)
        }
        const coordinate = `${ga}:${module.version}`
        return {
          ga,
          jars: set.jars.map((jar) => ({
            path: cache.blobPath(jar.sha256, 'jar'),
            sha256: jar.sha256,
            packages: jar.packages,
            coordinate
          })),
          source: fetched.source,
          integrity: fetched.integrity
        }
      } catch (error) {
        const failure = failureOf(error)
        return { ga, failure }
      } finally {
        progress.step()
      }
    })
  )
  const artifacts = new Map(outcomes.map((outcome) => [outcome.ga, outcome]))
  if (request.signal.aborted) throw new CancelledError()

  const entryFor = (module: ResolvedModule | undefined, item: Declared | undefined): Built => {
    const group = (module ?? item)!.group
    const artifact = (module ?? item)!.artifact
    const ga = gaOf(group, artifact)
    const declaredVersions = item?.declarations.map((d) => d.version) ?? []
    const requested = [...new Set([...declaredVersions, ...(module?.requested ?? [])])]
    const base = {
      group,
      artifact,
      requested,
      declaredAt: item ? item.at : null,
      requestedBy: item ? [] : (module?.requestedBy ?? []),
      source: null as LibrarySource | null,
      integrity: null as LibraryIntegrity | null
    }
    // 정책이 정한 직접 선언(제공·지원 안 함·동적 버전), 또는 지원 계열에 닿지 않은 후보
    if (
      item &&
      (item.decision.kind === 'fixed' || (item.decision.kind === 'candidate' && !promoted.has(ga)))
    ) {
      const decision =
        item.decision.kind === 'fixed'
          ? item.decision
          : { status: 'unsupported' as const, reason: 'notSupported' as const, detail: '' }
      // 동적 버전으로 선언했지만 지원 계열이 고정 버전을 끌어와 쓴다: 그 결과를 따른다
      if (!(decision.reason === 'dynamicVersion' && module && statusOf(module).status === 'used'))
        return {
          entry: {
            ...base,
            version: declaredVersion(item.declarations),
            status: decision.status,
            reason: decision.reason,
            detail: decision.detail
          },
          jars: [],
          compile: false,
          runtime: false
        }
    }
    // 뿌리는 늘 그래프에 있지만(큐의 앞), 한도로 잘린 그래프 등에서 빠지면 실패로 보인다
    if (!module)
      return {
        entry: {
          ...base,
          version: item ? declaredVersion(item.declarations) : '',
          status: 'failed',
          reason: 'badMetadata',
          detail: 'not resolved'
        },
        jars: [],
        compile: false,
        runtime: false
      }
    const status = statusOf(module)
    const outcome = artifacts.get(ga)
    let entry: LibraryEntry = { ...base, version: module.version, ...status }
    let jars: Jar[] = []
    if (outcome && 'failure' in outcome && outcome.failure) {
      entry = {
        ...entry,
        status: 'failed',
        reason: outcome.failure.reason,
        detail: outcome.failure.message
      }
    } else if (outcome && 'jars' in outcome) {
      jars = outcome.jars
      entry = { ...entry, source: outcome.source, integrity: outcome.integrity }
    }
    if (implicit && ga === gaOf(implicit.root.group, implicit.root.artifact) && !item)
      entry = { ...entry, requestedBy: [implicit.requestedBy] }
    return {
      entry,
      jars,
      compile: module.compile,
      runtime: module.runtime && module.policy.kind !== 'compileOnly'
    }
  }

  for (const item of declared) {
    const ga = gaOf(item.group, item.artifact)
    built.set(ga, entryFor(byKey.get(ga), item))
  }
  const transitive = modules
    .filter((m) => !declaredKeys.has(gaOf(m.group, m.artifact)))
    .sort(
      (a, b) =>
        compareText(gaOf(a.group, a.artifact), gaOf(b.group, b.artifact)) ||
        compareVersions(a.version, b.version)
    )
  for (const module of transitive)
    built.set(gaOf(module.group, module.artifact), entryFor(module, undefined))

  const ordered = [...built.values()]
  const entries = ordered.map((b) => b.entry)
  const jars = ordered.flatMap((b) =>
    b.entry.status === 'used'
      ? b.jars.map((jar) => ({ jar, compile: b.compile, runtime: b.runtime }))
      : []
  )
  if (!entries.some((entry) => entry.status === 'failed')) {
    const lock: LockFile = {
      format: LOCK_FORMAT,
      entries,
      jars: jars.map(({ jar, compile, runtime }) => ({
        coordinate: jar.coordinate,
        sha256: jar.sha256,
        packages: jar.packages,
        compile,
        runtime
      }))
    }
    await cache.writeLock(key, lock)
  }
  await cache.prune(
    new Set(jars.map(({ jar }) => jar.path)),
    deps.maxCacheBytes ?? MAX_LIBRARY_CACHE_BYTES
  )
  return resolution(request, cache, entries, jars)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function resolveLibraries(
  request: LibraryRequest,
  deps: LibraryDeps
): Promise<LibraryResolution | Failure> {
  const cache = new LibraryCache(deps.cacheDir)
  try {
    const declared = declaredModules(request.gradle.dependencies)
    const implicit = implicitAnnotationRoot(declared)
    const needsWork = declared.some((item) => item.decision.kind !== 'fixed') || implicit !== null
    if (!needsWork)
      return resolution(
        request,
        cache,
        declared.map((item) => {
          const decision = item.decision as Extract<Declared['decision'], { kind: 'fixed' }>
          return {
            group: item.group,
            artifact: item.artifact,
            version: declaredVersion(item.declarations),
            requested: [...new Set(item.declarations.map((d) => d.version))],
            status: decision.status,
            reason: decision.reason,
            detail: decision.detail,
            declaredAt: item.at,
            requestedBy: [],
            source: null,
            integrity: null
          }
        }),
        []
      )
    const key = lockKey(request, implicit !== null)
    const locked = await fromLock(cache, key, request)
    if (locked) return locked
    return await resolveFresh(request, deps, cache, declared, implicit, key)
  } catch (error) {
    if (error instanceof CancelledError || request.signal.aborted)
      return { ok: false, code: 'cancelled', detail: '' }
    return { ok: false, code: 'failed', detail: `library resolution: ${errorText(error)}` }
  }
}

// PlayController의 resolveLibraries
export function createLibraryResolver(
  deps: LibraryDeps
): (request: LibraryRequest) => Promise<LibraryResolution | Failure> {
  return (request) => resolveLibraries(request, deps)
}
