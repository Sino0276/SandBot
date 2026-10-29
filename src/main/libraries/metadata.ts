import type { LibraryReason } from '../../shared/libraries'
import { ArchiveError } from './archive'
import { FileFetcher, IntegrityFailure, RepositoryFailure, type ExpectedHashes } from './fetcher'
import {
  availableAtInRepository,
  ModuleError,
  parseGradleModule,
  type ModuleFile,
  type ParsedModule
} from './gradleModule'
import { CancelledError, FetchFailure } from './http'
import { effectivePom, parseRawPom, PomError, type Exclusion, type RawPom } from './pom'
import { repositoryFor } from './repositories'
import { isValidArtifact, isValidGroup, isValidVersion } from './version'
import { XmlError } from './xml'

// 모듈 하나의 메타데이터: POM을 먼저 읽고, Gradle 메타데이터 표시가 있으면 .module을 쓴다(저장소에 없으면 POM으로).
// maven.brott.dev는 표시만 있고 .module이 없어 묻지 않는다(repositories.ts의 moduleMetadata). 결과는 해석기(resolver.ts)가
// 쓰는 의존성·제약·파일 하나. 확인할 해시가 없는(처음 받은) POM·.module은 읽을 수 있는지 본 뒤에만 기록·캐시한다
// (fetcher.ts의 check). 해시로 확인한 것은 캐시에 넣은 뒤 읽으므로, 읽지 못해도 다음 INIT은 네트워크 없이 같은 이유다.

export type Edge = {
  group: string
  artifact: string
  version: string
  scope: 'compile' | 'runtime'
  exclusions: Exclusion[]
}

export type ArtifactSpec = {
  file: string
  ext: 'jar' | 'aar'
  expected: ExpectedHashes | undefined
}

export type ModuleMetadata = {
  dependencies: Edge[]
  constraints: { group: string; artifact: string; version: string }[]
  // 파일이 없는 모듈(packaging pom, 다른 모듈로 옮긴 변형)은 null
  artifact: ArtifactSpec | null
  // .module에 적힌 파일 목록(분류자·확장자를 직접 고른 선언이 쓴다)
  files: ModuleFile[]
}

export type MetadataSource = (
  group: string,
  artifact: string,
  version: string
) => Promise<ModuleMetadata>

// 받지 못하거나 읽지 못한 이유(LibraryReason)
export class LibraryFailure extends Error {
  constructor(
    readonly reason: LibraryReason,
    message: string
  ) {
    super(message)
  }
}

// 오류를 보고의 이유로. 취소는 그대로 던진다.
export function failureOf(error: unknown): LibraryFailure {
  if (error instanceof CancelledError) throw error
  if (error instanceof LibraryFailure) return error
  if (error instanceof FetchFailure) return new LibraryFailure(error.code, error.message)
  if (error instanceof RepositoryFailure) return new LibraryFailure(error.code, error.message)
  if (error instanceof IntegrityFailure)
    return new LibraryFailure('checksumMismatch', error.message)
  if (error instanceof ArchiveError) return new LibraryFailure(error.code, error.message)
  if (error instanceof PomError || error instanceof ModuleError || error instanceof XmlError)
    return new LibraryFailure('badMetadata', error.message)
  return new LibraryFailure('badMetadata', error instanceof Error ? error.message : String(error))
}

function checkCoordinate(group: string, artifact: string, version: string): void {
  if (!isValidGroup(group) || !isValidArtifact(artifact) || !isValidVersion(version))
    throw new LibraryFailure('badMetadata', `invalid coordinate ${group}:${artifact}:${version}`)
}

function artifactFile(files: ModuleFile[]): ArtifactSpec | null {
  const file =
    files.find((candidate) => candidate.name.endsWith('.aar')) ??
    files.find((candidate) => candidate.name.endsWith('.jar'))
  if (!file) return null
  return {
    file: file.url,
    ext: file.url.endsWith('.aar') ? 'aar' : 'jar',
    expected: { sha256: file.sha256, sha512: file.sha512, sha1: file.sha1, size: file.size }
  }
}

export function metadataSource(
  fetcher: FileFetcher,
  onFile?: () => void,
  onDone?: () => void
): MetadataSource {
  const raws = new Map<string, Promise<RawPom>>()

  const loadRaw = (group: string, artifact: string, version: string): Promise<RawPom> => {
    const key = `${group}:${artifact}:${version}`
    let pending = raws.get(key)
    if (!pending) {
      pending = (async () => {
        checkCoordinate(group, artifact, version)
        onFile?.()
        const read = (bytes: Buffer): RawPom => {
          const raw = parseRawPom(bytes.toString('utf8'))
          if (raw.artifact !== artifact || (raw.group ?? raw.parent?.group) !== group)
            throw new PomError(
              `the POM describes ${raw.group ?? raw.parent?.group}:${raw.artifact}`
            )
          return raw
        }
        // 처음 받은 POM은 기록·캐시하기 전에 읽어 보고 그 결과를 쓴다(확인한 것·캐시의 것은 받은 뒤 읽는다)
        const checked: { raw?: RawPom } = {}
        try {
          const pom = await fetcher.fetch({
            group,
            artifact,
            version,
            file: `${artifact}-${version}.pom`,
            kind: 'metadata',
            ext: 'pom',
            check: (bytes) => {
              checked.raw = read(bytes)
            }
          })
          return checked.raw ?? read(pom.bytes)
        } finally {
          onDone?.()
        }
      })()
      raws.set(key, pending)
    }
    return pending
  }

  const loadModule = async (
    group: string,
    artifact: string,
    version: string
  ): Promise<ParsedModule | null> => {
    onFile?.()
    const checked: { parsed?: ParsedModule } = {}
    try {
      const module = await fetcher.fetch({
        group,
        artifact,
        version,
        file: `${artifact}-${version}.module`,
        kind: 'metadata',
        ext: 'module',
        check: (bytes) => {
          checked.parsed = parseGradleModule(bytes.toString('utf8'))
        }
      })
      return checked.parsed ?? parseGradleModule(module.bytes.toString('utf8'))
    } catch (error) {
      // POM에 표시는 있지만 저장소에 .module이 없다
      if (error instanceof FetchFailure && error.code === 'notFound') return null
      throw error
    } finally {
      onDone?.()
    }
  }

  return async (group, artifact, version) => {
    const raw = await loadRaw(group, artifact, version)
    if (raw.gradleMetadata && repositoryFor(group).moduleMetadata) {
      const parsed = await loadModule(group, artifact, version)
      if (parsed !== null) {
        if (parsed.kind === 'availableAt') {
          const { target } = parsed
          checkCoordinate(target.group, target.artifact, target.version)
          if (
            !availableAtInRepository({ group, artifact, version }, target) ||
            repositoryFor(target.group).id !== repositoryFor(group).id
          )
            throw new ModuleError(`available-at points outside the repository (${target.url})`)
          return {
            dependencies: [
              {
                group: target.group,
                artifact: target.artifact,
                version: target.version,
                scope: 'compile',
                exclusions: []
              }
            ],
            constraints: [],
            artifact: null,
            files: []
          }
        }
        return {
          dependencies: parsed.module.dependencies,
          constraints: parsed.module.constraints,
          artifact: artifactFile(parsed.module.files),
          files: parsed.module.files
        }
      }
    }
    const pom = await effectivePom(raw, loadRaw)
    return {
      // type pom 의존성(묶음 모듈)도 따라간다: 그 모듈은 packaging pom이라 파일 없이 의존성만 있다
      dependencies: pom.dependencies.map((dep) => ({
        group: dep.group,
        artifact: dep.artifact,
        version: dep.version,
        scope: dep.scope,
        exclusions: dep.exclusions
      })),
      constraints: [],
      artifact: pom.extension
        ? {
            file: `${artifact}-${version}.${pom.extension}`,
            ext: pom.extension,
            expected: undefined
          }
        : null,
      files: []
    }
  }
}
