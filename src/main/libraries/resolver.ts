import type { LibraryReason } from '../../shared/libraries'
import { failureOf, type MetadataSource, type ModuleMetadata } from './metadata'
import type { PolicyDecision } from './policy'
import type { Exclusion } from './pom'
import { compareVersions, highestVersion, isDynamicVersion } from './version'

// 의존성 그래프 해석(Gradle 규칙): 모든 요청(직접 선언과 전이 의존성) 중 가장 높은 버전이 이기고, 버전이 바뀌면 그 버전의
// 의존성으로 다시 펼쳐 고정점까지 반복한다. 제외(exclude)는 그 선언 아래 전체에, transitive = false는 그 모듈의 의존성을
// 펼치지 않는다. 클래스패스는 Gradle처럼 나눈다: 컴파일 = 컴파일에 보이는 선언(implementation·api·compileOnly)에서
// compile 범위로만 닿는 것, 실행 = 실행에 보이는 선언(implementation·api·runtimeOnly)에서 닿는 것. 버전은 둘이 같다
// (Android Gradle 플러그인이 컴파일을 실행 버전에 맞춘다). 정책(policy.ts)이 제공·지원 안 함으로 정한 모듈은 펼치지 않는다.
// 순서는 모두 선언·BFS 순서라 결과가 결정적이다.

export type Root = {
  group: string
  artifact: string
  version: string
  compile: boolean
  runtime: boolean
  transitive: boolean
  exclusions: Exclusion[]
}

export type Classify = (group: string, artifact: string, version: string) => PolicyDecision

export type ResolvedModule = {
  group: string
  artifact: string
  // 고른 버전
  version: string
  // 요청된 버전(처음 나온 순서, 중복 없음, 제약 제외)
  requested: string[]
  // 끌어온 쪽 사슬(뿌리부터 'g:a:v'). 뿌리 자신은 [].
  requestedBy: string[]
  policy: PolicyDecision
  compile: boolean
  runtime: boolean
  // 메타데이터(제공·지원 안 함·실패면 null)
  metadata: ModuleMetadata | null
  failure: { reason: LibraryReason; detail: string } | null
}

export type ResolveLimits = { maxModules: number; maxIterations: number; maxStates: number }

export const DEFAULT_LIMITS: ResolveLimits = { maxModules: 300, maxIterations: 20, maxStates: 5000 }

type Request = { version: string; chain: string[]; constraint: boolean }

type Pass = {
  requests: Map<string, Request[]>
  reached: Map<string, { group: string; artifact: string; compile: boolean; runtime: boolean }>
  truncated: boolean
}

function gaOf(group: string, artifact: string): string {
  return `${group}:${artifact}`
}

function excluded(group: string, artifact: string, exclusions: readonly Exclusion[]): boolean {
  return exclusions.some(
    (exclusion) =>
      (exclusion.group === null || exclusion.group === group) &&
      (exclusion.module === null || exclusion.module === artifact)
  )
}

function exclusionKey(exclusions: readonly Exclusion[]): string {
  return [...new Set(exclusions.map((e) => `${e.group ?? '*'}:${e.module ?? '*'}`))]
    .sort()
    .join(',')
}

// 고정 버전 요청 중 가장 높은 것(제약은 다른 요청이 있을 때만). 없으면 null.
function selectVersion(requests: readonly Request[]): string | null {
  const fixed = requests.filter((request) => !isDynamicVersion(request.version))
  if (!fixed.some((request) => !request.constraint)) return null
  return highestVersion(fixed.map((request) => request.version))
}

export async function resolveGraph(
  roots: readonly Root[],
  load: MetadataSource,
  classify: Classify,
  limits: ResolveLimits = DEFAULT_LIMITS
): Promise<ResolvedModule[]> {
  type Loaded = ModuleMetadata | { failure: LibraryFailureInfo }
  const metadata = new Map<string, Promise<Loaded>>()
  const fetchMetadata = (group: string, artifact: string, version: string): Promise<Loaded> => {
    const key = `${group}:${artifact}:${version}`
    let pending = metadata.get(key)
    if (!pending) {
      pending = load(group, artifact, version).catch((error: unknown) => {
        const failure = failureOf(error)
        return { failure: { reason: failure.reason, detail: failure.message } }
      })
      // 취소는 failureOf가 다시 던진다: 그 거부는 해석 전체를 멈춘다
      pending.catch(() => undefined)
      metadata.set(key, pending)
    }
    return pending
  }

  const rootKeys = new Set(roots.map((root) => gaOf(root.group, root.artifact)))

  async function pass(selected: ReadonlyMap<string, string>): Promise<Pass> {
    const requests = new Map<string, Request[]>()
    const reached: Pass['reached'] = new Map()
    const visited = new Set<string>()
    let truncated = false
    const addRequest = (ga: string, request: Request): void => {
      const list = requests.get(ga)
      if (list) list.push(request)
      else requests.set(ga, [request])
    }
    type Node = {
      group: string
      artifact: string
      exclusions: Exclusion[]
      compile: boolean
      runtime: boolean
      transitive: boolean
      chain: string[]
    }
    const queue: Node[] = []
    for (const root of roots) {
      addRequest(gaOf(root.group, root.artifact), {
        version: root.version,
        chain: [],
        constraint: false
      })
      queue.push({ ...root, chain: [] })
    }
    const versionOf = (ga: string): string | null =>
      selected.get(ga) ?? selectVersion(requests.get(ga) ?? [])

    // 다음에 펼칠 것들의 메타데이터를 미리 받기 시작한다(처리는 차례대로라 결과 순서는 그대로)
    const prefetch = (node: Node): void => {
      const ga = gaOf(node.group, node.artifact)
      const version = versionOf(ga)
      if (version === null || !node.transitive) return
      const policy = classify(node.group, node.artifact, version)
      if (policy.kind === 'provided' || policy.kind === 'unsupported') return
      void fetchMetadata(node.group, node.artifact, version)
    }
    queue.forEach(prefetch)

    for (let index = 0; index < queue.length; index++) {
      const node = queue[index]
      const ga = gaOf(node.group, node.artifact)
      const stateKey = `${ga}|${node.compile}|${node.runtime}|${node.transitive}|${exclusionKey(node.exclusions)}`
      if (visited.has(stateKey)) continue
      if (visited.size >= limits.maxStates) {
        truncated = true
        break
      }
      visited.add(stateKey)
      const seen = reached.get(ga)
      if (!seen && reached.size >= limits.maxModules) {
        truncated = true
        continue
      }
      reached.set(ga, {
        group: node.group,
        artifact: node.artifact,
        compile: (seen?.compile ?? false) || node.compile,
        runtime: (seen?.runtime ?? false) || node.runtime
      })
      const version = versionOf(ga)
      if (version === null || !node.transitive) continue
      // 제공·지원 안 함은 펼치지 않는다(뿌리도: 고른 버전이 정책 밖일 수 있다)
      const policy = classify(node.group, node.artifact, version)
      if (policy.kind === 'provided' || policy.kind === 'unsupported') continue
      const meta = await fetchMetadata(node.group, node.artifact, version)
      if ('failure' in meta) continue
      const chain = [...node.chain, `${ga}:${version}`]
      for (const dep of meta.dependencies) {
        if (excluded(dep.group, dep.artifact, node.exclusions)) continue
        const compile = node.compile && dep.scope === 'compile'
        const runtime = node.runtime
        if (!compile && !runtime) continue
        const depGa = gaOf(dep.group, dep.artifact)
        // 자기 자신 의존성은 무시한다
        if (depGa === ga) continue
        addRequest(depGa, { version: dep.version, chain, constraint: false })
        const child: Node = {
          group: dep.group,
          artifact: dep.artifact,
          exclusions: [...node.exclusions, ...dep.exclusions],
          compile,
          runtime,
          transitive: true,
          chain
        }
        queue.push(child)
        prefetch(child)
      }
      for (const constraint of meta.constraints)
        addRequest(gaOf(constraint.group, constraint.artifact), {
          version: constraint.version,
          chain,
          constraint: true
        })
    }
    return { requests, reached, truncated }
  }

  let selected = new Map<string, string>()
  let last: Pass | null = null
  for (let iteration = 0; iteration < limits.maxIterations; iteration++) {
    last = await pass(selected)
    const next = new Map<string, string>()
    for (const [ga, requests] of last.requests) {
      if (!last.reached.has(ga)) continue
      const version = selectVersion(requests)
      if (version !== null) next.set(ga, version)
    }
    const stable =
      next.size === selected.size && [...next].every(([ga, v]) => selected.get(ga) === v)
    selected = next
    if (stable) break
  }
  const final = last!

  const modules: ResolvedModule[] = []
  for (const [ga, info] of final.reached) {
    const requests = final.requests.get(ga) ?? []
    const plain = requests.filter((request) => !request.constraint)
    const requested = [...new Set(plain.map((request) => request.version))]
    const version = selected.get(ga) ?? null
    const chosen = version === null ? null : plain.find((request) => request.version === version)
    const requestedBy = (chosen ?? plain[0])?.chain ?? []
    if (version === null) {
      modules.push({
        group: info.group,
        artifact: info.artifact,
        version: requested[0] ?? '',
        requested,
        requestedBy,
        policy: classify(info.group, info.artifact, requested[0] ?? ''),
        compile: info.compile,
        runtime: info.runtime,
        metadata: null,
        failure: {
          reason: 'badMetadata',
          detail: `no fixed version requested (${requested.join(', ')})`
        }
      })
      continue
    }
    const policy: PolicyDecision = rootKeys.has(ga)
      ? classifyRoot(classify(info.group, info.artifact, version))
      : classify(info.group, info.artifact, version)
    let meta: ModuleMetadata | null = null
    let failure: ResolvedModule['failure'] = null
    if (policy.kind !== 'provided' && policy.kind !== 'unsupported') {
      const result = await fetchMetadata(info.group, info.artifact, version)
      if ('failure' in result) failure = result.failure
      else meta = result
    }
    modules.push({
      group: info.group,
      artifact: info.artifact,
      version,
      requested,
      requestedBy,
      policy,
      compile: info.compile,
      runtime: info.runtime,
      metadata: meta,
      failure
    })
  }
  if (final.truncated)
    for (const [ga, requests] of final.requests) {
      if (final.reached.has(ga)) continue
      const [group, artifact] = ga.split(':')
      modules.push({
        group,
        artifact,
        version: requests[0].version,
        requested: [...new Set(requests.map((request) => request.version))],
        requestedBy: requests[0].chain,
        policy: classify(group, artifact, requests[0].version),
        compile: false,
        runtime: false,
        metadata: null,
        failure: { reason: 'badMetadata', detail: 'the dependency graph is too large' }
      })
    }
  return modules
}

type LibraryFailureInfo = { reason: LibraryReason; detail: string }

// 뿌리는 해석기를 부른 쪽이 이미 받기로 정했다(지원 계열, androidx.annotation, 지원 계열이 끌어온 것을 직접 선언한 것).
// 고른 버전이 정책 밖이 되면(예: Pedro core를 2.x로 직접 선언했지만 3.x가 이김 → 지원) 그 결정을 쓴다.
function classifyRoot(policy: PolicyDecision): PolicyDecision {
  return policy.kind === 'other' ? { kind: 'supported' } : policy
}

// 시험·정렬용
export function compareModules(a: ResolvedModule, b: ResolvedModule): number {
  const left = gaOf(a.group, a.artifact)
  const right = gaOf(b.group, b.artifact)
  return left < right ? -1 : left > right ? 1 : compareVersions(a.version, b.version)
}
