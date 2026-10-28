import { child, childrenNamed, childText, parseXml, XmlError, type XmlElement } from './xml'

// Maven POM 읽기(Gradle의 POM 처리와 같은 규칙):
// - 부모 POM(최대 10단계)에서 groupId·version·properties·dependencyManagement·dependencies를 물려받는다(자식이 이긴다).
// - ${…} 속성 보간(최대 10번, project.*·pom.*·parent.* 포함). 풀지 못한 속성이 버전에 남으면 실패.
// - dependencyManagement와 BOM import(scope import, type pom)는 빠진 버전·범위를 채우는 데만 쓴다(제약이 아니다).
// - 범위: compile → 컴파일+실행, runtime → 실행만. optional·test·provided·system은 건너뛴다. 자기 자신 의존성은 무시.
// - packaging → 파일 확장자(aar → aar, pom → 파일 없음, 그 밖(jar·bundle …) → jar).
// - <relocation>은 실패(옮긴 좌표를 따라가지 않는다). <repositories>는 무시한다(그룹 고정 저장소만 쓴다).
// - 'published-with-gradle-metadata' 표시가 있으면 Gradle 모듈 메타데이터(.module)를 먼저 쓴다(gradleModule.ts).

export class PomError extends Error {}

export type Exclusion = { group: string | null; module: string | null }

type RawDependency = {
  group: string | null
  artifact: string | null
  version: string | null
  scope: string | null
  type: string | null
  classifier: string | null
  optional: string | null
  exclusions: Exclusion[]
}

export type RawPom = {
  group: string | null
  artifact: string | null
  version: string | null
  packaging: string | null
  parent: { group: string; artifact: string; version: string } | null
  properties: Map<string, string>
  dependencyManagement: RawDependency[]
  dependencies: RawDependency[]
  relocated: boolean
  gradleMetadata: boolean
}

export const GRADLE_METADATA_MARKER = 'published-with-gradle-metadata'

function wildcard(value: string | null): string | null {
  return value === null || value === '*' ? null : value
}

function rawDependency(element: XmlElement): RawDependency {
  return {
    group: childText(element, 'groupId'),
    artifact: childText(element, 'artifactId'),
    version: childText(element, 'version'),
    scope: childText(element, 'scope'),
    type: childText(element, 'type'),
    classifier: childText(element, 'classifier'),
    optional: childText(element, 'optional'),
    exclusions: childrenNamed(child(element, 'exclusions'), 'exclusion').map((exclusion) => ({
      group: wildcard(childText(exclusion, 'groupId')),
      module: wildcard(childText(exclusion, 'artifactId'))
    }))
  }
}

export function parseRawPom(text: string): RawPom {
  let root: XmlElement
  try {
    root = parseXml(text)
  } catch (error) {
    throw new PomError(error instanceof XmlError ? error.message : String(error))
  }
  if (root.name !== 'project') throw new PomError('not a POM (root element is not <project>)')
  const parentElement = child(root, 'parent')
  let parent: RawPom['parent'] = null
  if (parentElement) {
    const group = childText(parentElement, 'groupId')
    const artifact = childText(parentElement, 'artifactId')
    const version = childText(parentElement, 'version')
    if (!group || !artifact || !version) throw new PomError('incomplete <parent>')
    parent = { group, artifact, version }
  }
  const properties = new Map<string, string>()
  for (const property of child(root, 'properties')?.children ?? [])
    if (!properties.has(property.name)) properties.set(property.name, property.text.trim())
  return {
    group: childText(root, 'groupId'),
    artifact: childText(root, 'artifactId'),
    version: childText(root, 'version'),
    packaging: childText(root, 'packaging'),
    parent,
    properties,
    dependencyManagement: childrenNamed(
      child(child(root, 'dependencyManagement'), 'dependencies'),
      'dependency'
    ).map(rawDependency),
    dependencies: childrenNamed(child(root, 'dependencies'), 'dependency').map(rawDependency),
    relocated: child(child(root, 'distributionManagement'), 'relocation') !== null,
    gradleMetadata: text.includes(GRADLE_METADATA_MARKER)
  }
}

// ---- 유효 POM ----

export type PomDependency = {
  group: string
  artifact: string
  version: string
  scope: 'compile' | 'runtime'
  // POM의 <type>(jar가 아니면, 예: aar)·<classifier>
  type: string | null
  classifier: string | null
  exclusions: Exclusion[]
}

export type EffectivePom = {
  group: string
  artifact: string
  version: string
  // 'jar' | 'aar' | null(packaging pom: 파일 없음)
  extension: 'jar' | 'aar' | null
  dependencies: PomDependency[]
  gradleMetadata: boolean
}

// 좌표의 POM 글자(없거나 받지 못하면 던진다)
export type PomLoader = (group: string, artifact: string, version: string) => Promise<RawPom>

const MAX_PARENTS = 10
const MAX_PASSES = 10
const MAX_IMPORTS = 20

function interpolate(value: string, properties: Map<string, string>): string {
  let current = value
  for (let pass = 0; pass < MAX_PASSES && current.includes('${'); pass++) {
    const next = current.replace(
      /\$\{([^}]{1,128})\}/g,
      (whole, key: string) => properties.get(key) ?? whole
    )
    if (next === current) break
    current = next
  }
  return current
}

function interpolateOrNull(value: string | null, properties: Map<string, string>): string | null {
  return value === null ? null : interpolate(value, properties)
}

type Chain = RawPom[]

async function parentChain(pom: RawPom, load: PomLoader): Promise<Chain> {
  const chain: Chain = [pom]
  const seen = new Set<string>()
  let current = pom
  while (current.parent) {
    if (chain.length > MAX_PARENTS) throw new PomError('parent POM chain is too long')
    const { group, artifact, version } = current.parent
    const key = `${group}:${artifact}:${version}`
    if (seen.has(key)) throw new PomError(`parent POM cycle at ${key}`)
    seen.add(key)
    current = await load(group, artifact, version)
    chain.push(current)
  }
  return chain
}

function chainProperties(chain: Chain): Map<string, string> {
  const properties = new Map<string, string>()
  // 먼 조상부터 넣고 자식이 덮어쓴다
  for (const pom of [...chain].reverse())
    for (const [key, value] of pom.properties) properties.set(key, value)
  const self = chain[0]
  const group = self.group ?? self.parent?.group ?? null
  const version = self.version ?? self.parent?.version ?? null
  const builtins: Record<string, string | null> = {
    'project.groupId': group,
    'pom.groupId': group,
    groupId: group,
    'project.artifactId': self.artifact,
    'pom.artifactId': self.artifact,
    artifactId: self.artifact,
    'project.version': version,
    'pom.version': version,
    version,
    'project.parent.groupId': self.parent?.group ?? null,
    'parent.groupId': self.parent?.group ?? null,
    'project.parent.version': self.parent?.version ?? null,
    'parent.version': self.parent?.version ?? null
  }
  for (const [key, value] of Object.entries(builtins))
    if (value !== null) properties.set(key, value)
  return properties
}

type Managed = { version: string | null; scope: string | null }

async function managedVersions(
  chain: Chain,
  properties: Map<string, string>,
  load: PomLoader,
  budget: { imports: number },
  depth: number
): Promise<Map<string, Managed>> {
  const managed = new Map<string, Managed>()
  const imports: { group: string; artifact: string; version: string }[] = []
  for (const pom of chain)
    for (const entry of pom.dependencyManagement) {
      const group = interpolateOrNull(entry.group, properties)
      const artifact = interpolateOrNull(entry.artifact, properties)
      const version = interpolateOrNull(entry.version, properties)
      if (!group || !artifact) continue
      if (entry.scope === 'import' && entry.type === 'pom') {
        if (version) imports.push({ group, artifact, version })
        continue
      }
      const key = `${group}:${artifact}`
      if (!managed.has(key)) managed.set(key, { version, scope: entry.scope })
    }
  for (const bom of imports) {
    if (++budget.imports > MAX_IMPORTS || depth > MAX_PARENTS)
      throw new PomError('too many BOM imports')
    const bomPom = await load(bom.group, bom.artifact, bom.version)
    const bomChain = await parentChain(bomPom, load)
    const bomManaged = await managedVersions(
      bomChain,
      chainProperties(bomChain),
      load,
      budget,
      depth + 1
    )
    for (const [key, value] of bomManaged) if (!managed.has(key)) managed.set(key, value)
  }
  return managed
}

function extensionOf(packaging: string | null): EffectivePom['extension'] {
  if (packaging === 'pom') return null
  if (packaging === 'aar') return 'aar'
  return 'jar'
}

export async function effectivePom(raw: RawPom, load: PomLoader): Promise<EffectivePom> {
  if (raw.relocated)
    throw new PomError('the POM is relocated (<relocation>), which SandBot does not follow')
  const chain = await parentChain(raw, load)
  const properties = chainProperties(chain)
  const group = properties.get('project.groupId')
  const version = properties.get('project.version')
  if (!group || !raw.artifact || !version)
    throw new PomError('the POM has no groupId, artifactId or version')
  const managed = await managedVersions(chain, properties, load, { imports: 0 }, 0)

  const dependencies: PomDependency[] = []
  const seen = new Set<string>()
  for (const pom of chain)
    for (const entry of pom.dependencies) {
      const depGroup = interpolateOrNull(entry.group, properties)
      const depArtifact = interpolateOrNull(entry.artifact, properties)
      if (!depGroup || !depArtifact) throw new PomError('a dependency has no groupId or artifactId')
      const type = interpolateOrNull(entry.type, properties)
      const classifier = interpolateOrNull(entry.classifier, properties)
      const key = `${depGroup}:${depArtifact}:${type ?? 'jar'}:${classifier ?? ''}`
      // 자식의 선언이 이긴다
      if (seen.has(key)) continue
      seen.add(key)
      const fill = managed.get(`${depGroup}:${depArtifact}`)
      const scope = interpolateOrNull(entry.scope, properties) ?? fill?.scope ?? 'compile'
      const optional = interpolateOrNull(entry.optional, properties) === 'true'
      if (optional || (scope !== 'compile' && scope !== 'runtime')) continue
      if (type === 'test-jar' || classifier === 'tests') continue
      // 자기 자신(Road Runner core 1.0.1이 optional로 자기를 선언한다)
      if (depGroup === group && depArtifact === raw.artifact) continue
      const depVersion = interpolateOrNull(entry.version, properties) ?? fill?.version ?? null
      if (!depVersion) throw new PomError(`no version for ${depGroup}:${depArtifact}`)
      if (depVersion.includes('${'))
        throw new PomError(`unresolved property in ${depGroup}:${depArtifact}:${depVersion}`)
      dependencies.push({
        group: depGroup,
        artifact: depArtifact,
        version: depVersion,
        scope,
        type: type === 'jar' ? null : type,
        classifier,
        exclusions: entry.exclusions
      })
    }
  return {
    group,
    artifact: raw.artifact,
    version,
    extension: extensionOf(interpolateOrNull(raw.packaging, properties)),
    dependencies,
    gradleMetadata: raw.gradleMetadata
  }
}
