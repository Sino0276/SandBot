import type { Exclusion } from './pom'

// Gradle 모듈 메타데이터(.module, formatVersion 1.x) 읽기. Android 앱(TeamCode)이 고르는 것처럼 category library이고
// usage java-api(컴파일)·java-runtime(실행)인 변형을 고른다. Kotlin 멀티플랫폼의 비JVM 변형(js·wasm·native·common)과
// 문서 변형(sources·javadoc)은 건너뛴다. available-at(다른 모듈로 옮겨 둔 변형)은 그 모듈로 가는 의존성 하나로 본다
// (같은 저장소 안의 상대 주소만). strictly·rejects 버전 제약은 SandBot이 풀지 않으므로 실패로 알린다.
// dependencyConstraints는 다른 곳에서 그 모듈을 쓸 때만 버전 후보가 된다(Gradle과 같다).

export class ModuleError extends Error {}

export type ModuleFile = {
  name: string
  url: string
  size: number | null
  sha256: string | null
  sha512: string | null
  sha1: string | null
}

export type ModuleDependency = {
  group: string
  artifact: string
  version: string
  scope: 'compile' | 'runtime'
  exclusions: Exclusion[]
}

export type GradleModule = {
  dependencies: ModuleDependency[]
  // 버전 후보만(그 모듈이 다른 곳에서 쓰일 때)
  constraints: { group: string; artifact: string; version: string }[]
  files: ModuleFile[]
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

type Variant = {
  name: string
  attributes: Json
  dependencies: unknown[]
  constraints: unknown[]
  files: unknown[]
  availableAt: Json | null
}

function variants(document: Json): Variant[] {
  return list(document.variants).flatMap((value) => {
    if (!isObject(value)) return []
    return [
      {
        name: str(value.name) ?? '',
        attributes: isObject(value.attributes) ? value.attributes : {},
        dependencies: list(value.dependencies),
        constraints: list(value.dependencyConstraints),
        files: list(value.files),
        availableAt: isObject(value['available-at']) ? value['available-at'] : null
      }
    ]
  })
}

// JVM·Android 라이브러리 변형인지(category library, 플랫폼이 jvm·androidJvm이거나 없음)
function isJvmLibrary(variant: Variant, usage: string): boolean {
  const a = variant.attributes
  if (a['org.gradle.category'] !== undefined && a['org.gradle.category'] !== 'library') return false
  if (a['org.gradle.usage'] !== usage) return false
  const platform = a['org.jetbrains.kotlin.platform.type']
  if (platform !== undefined && platform !== 'jvm' && platform !== 'androidJvm') return false
  const environment = a['org.gradle.jvm.environment']
  if (environment !== undefined && environment !== 'standard-jvm' && environment !== 'android')
    return false
  return true
}

// 같은 usage의 변형이 여럿이면 Android 환경을 먼저, 그다음 선언 순서
function pick(all: Variant[], usage: string): Variant | null {
  const candidates = all.filter((variant) => isJvmLibrary(variant, usage))
  return (
    candidates.find((variant) => variant.attributes['org.gradle.jvm.environment'] === 'android') ??
    candidates[0] ??
    null
  )
}

function versionOf(value: unknown, where: string): string | null {
  if (!isObject(value)) return null
  if (value.strictly !== undefined || value.rejects !== undefined)
    throw new ModuleError(`${where}: strictly/rejects version constraints are not supported`)
  return str(value.requires) ?? str(value.prefers)
}

function exclusionsOf(value: unknown): Exclusion[] {
  return list(value).flatMap((entry) => {
    if (!isObject(entry)) return []
    const group = str(entry.group)
    const module = str(entry.module)
    return [{ group: group === '*' ? null : group, module: module === '*' ? null : module }]
  })
}

type Dep = { group: string; artifact: string; version: string; exclusions: Exclusion[] }

function dependenciesOf(variant: Variant): Dep[] {
  const out: Dep[] = []
  for (const value of variant.dependencies) {
    if (!isObject(value)) continue
    const group = str(value.group)
    const artifact = str(value.module)
    if (!group || !artifact)
      throw new ModuleError(`${variant.name}: a dependency has no group or module`)
    // 플랫폼(BOM)·enforced-platform 의존성은 버전 후보일 뿐 파일이 없다: 제약으로 다룬다
    const category = isObject(value.attributes)
      ? value.attributes['org.gradle.category']
      : undefined
    if (category === 'platform' || category === 'enforced-platform') continue
    const version = versionOf(value.version, `${group}:${artifact}`)
    if (!version) throw new ModuleError(`${variant.name}: no version for ${group}:${artifact}`)
    out.push({ group, artifact, version, exclusions: exclusionsOf(value.excludes) })
  }
  return out
}

function constraintsOf(variant: Variant): GradleModule['constraints'] {
  const out: GradleModule['constraints'] = []
  for (const value of variant.constraints) {
    if (!isObject(value)) continue
    const group = str(value.group)
    const artifact = str(value.module)
    const version = versionOf(value.version, `${group}:${artifact}`)
    if (group && artifact && version) out.push({ group, artifact, version })
  }
  return out
}

const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/
const HEX = /^[0-9a-f]+$/

function hash(value: unknown, length: number): string | null {
  const text = str(value)?.toLowerCase() ?? null
  return text !== null && text.length === length && HEX.test(text) ? text : null
}

function filesOf(variant: Variant): ModuleFile[] {
  return variant.files.flatMap((value) => {
    if (!isObject(value)) return []
    const name = str(value.name)
    const url = str(value.url)
    if (!name || !url) return []
    // 같은 폴더의 파일만(상대 경로로 저장소 밖을 가리키지 않게)
    if (!FILE_NAME.test(name) || !FILE_NAME.test(url) || name.includes('..') || url.includes('..'))
      throw new ModuleError(`${variant.name}: file ${url} is not in the module folder`)
    const size =
      typeof value.size === 'number' && Number.isSafeInteger(value.size) ? value.size : null
    return [
      {
        name,
        url,
        size,
        sha256: hash(value.sha256, 64),
        sha512: hash(value.sha512, 128),
        sha1: hash(value.sha1, 40)
      }
    ]
  })
}

export type AvailableAt = { group: string; artifact: string; version: string; url: string }

export type ParsedModule =
  | { kind: 'module'; module: GradleModule }
  // 변형이 다른 모듈에 있다(Kotlin 멀티플랫폼의 -jvm·-android 모듈)
  | { kind: 'availableAt'; target: AvailableAt }

function availableAtOf(value: Json): AvailableAt {
  const group = str(value.group)
  const artifact = str(value.module)
  const version = str(value.version)
  const url = str(value.url)
  if (!group || !artifact || !version || !url) throw new ModuleError('incomplete available-at')
  return { group, artifact, version, url }
}

export function parseGradleModule(text: string): ParsedModule {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw new ModuleError(`not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isObject(document)) throw new ModuleError('not a module document')
  const format = str(document.formatVersion)
  if (!format || !format.startsWith('1.'))
    throw new ModuleError(`unsupported formatVersion ${String(format)}`)
  const all = variants(document)
  const runtime = pick(all, 'java-runtime')
  const api = pick(all, 'java-api')
  const main = runtime ?? api
  if (!main) throw new ModuleError('no JVM library variant')
  if (main.availableAt) return { kind: 'availableAt', target: availableAtOf(main.availableAt) }
  const runtimeDeps = dependenciesOf(main)
  const apiDeps = api && api !== main && !api.availableAt ? dependenciesOf(api) : null
  const apiKeys = new Set((apiDeps ?? runtimeDeps).map((dep) => `${dep.group}:${dep.artifact}`))
  const dependencies: ModuleDependency[] = runtimeDeps.map((dep) => ({
    ...dep,
    scope: apiKeys.has(`${dep.group}:${dep.artifact}`) ? 'compile' : 'runtime'
  }))
  // api 변형에만 있는 의존성(드묾)도 컴파일에 넣는다
  for (const dep of apiDeps ?? [])
    if (!runtimeDeps.some((other) => other.group === dep.group && other.artifact === dep.artifact))
      dependencies.push({ ...dep, scope: 'compile' })
  return {
    kind: 'module',
    module: {
      dependencies,
      constraints: [...constraintsOf(main), ...(api && api !== main ? constraintsOf(api) : [])],
      files: filesOf(main)
    }
  }
}

// available-at의 상대 주소가 같은 저장소의 그 좌표 .module을 가리키는지(../../x/1.0/x-1.0.module 꼴)
export function availableAtInRepository(
  from: { group: string; artifact: string; version: string },
  target: AvailableAt
): boolean {
  const base = `https://repo.invalid/${from.group.split('.').join('/')}/${from.artifact}/${from.version}/`
  let resolved: string
  try {
    resolved = new URL(target.url, base).toString()
  } catch {
    return false
  }
  const expected = `https://repo.invalid/${target.group.split('.').join('/')}/${target.artifact}/${target.version}/${target.artifact}-${target.version}.module`
  return resolved === expected
}
