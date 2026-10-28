import type { GradleRepository } from '../../shared/gradle'

// 허용 저장소와 그룹 고정(Gradle exclusiveContent처럼). 팀 Gradle이 어떤 저장소를 먼저 쓰든 한 그룹은 늘 한 저장소에서만
// 받는다(의존성 혼동 막기): com.acmerobotics.* → maven.brott.dev, androidx.annotation → Google Maven, 나머지 → Maven Central.
// 받는 것은 https만이고, 리디렉트는 그 저장소에 허용한 호스트로만 따라간다(maven.brott.dev는 Azure 정적 사이트로 302).
// 팀이 선언한 저장소 중 허용 목록에 있는 것만 쓴다(Android Studio에서도 그 저장소가 없으면 받지 못한다).

export type RepositoryId = 'central' | 'google' | 'brott'

export type Repository = {
  id: RepositoryId
  // 끝이 '/'인 주소
  base: string
  // 429·5xx면 차례로 쓰는 같은 내용의 거울
  mirrors: readonly string[]
  // 리디렉트를 따라가도 되는 다른 호스트(https만)
  redirectHosts: readonly string[]
  // .sha1·.sha256 같은 체크섬 파일을 주는지(maven.brott.dev는 주지 않는다)
  checksums: boolean
  // 팀 Gradle에서 이 저장소를 가리키는 주소(정규화한 것)와 종류
  aliases: readonly string[]
  kinds: readonly GradleRepository['kind'][]
}

export const REPOSITORIES: Readonly<Record<RepositoryId, Repository>> = {
  central: {
    id: 'central',
    base: 'https://repo1.maven.org/maven2/',
    mirrors: ['https://maven-central.storage-download.googleapis.com/maven2/'],
    redirectHosts: [],
    checksums: true,
    aliases: ['https://repo1.maven.org/maven2', 'https://repo.maven.apache.org/maven2'],
    kinds: ['mavenCentral']
  },
  google: {
    id: 'google',
    // maven.google.com은 여기로 301한다
    base: 'https://dl.google.com/dl/android/maven2/',
    mirrors: [],
    redirectHosts: [],
    checksums: true,
    aliases: ['https://dl.google.com/dl/android/maven2', 'https://maven.google.com'],
    kinds: ['google']
  },
  brott: {
    id: 'brott',
    base: 'https://maven.brott.dev/',
    mirrors: [],
    redirectHosts: ['acmerobotics.z13.web.core.windows.net'],
    checksums: false,
    aliases: ['https://maven.brott.dev'],
    kinds: []
  }
}

// 그룹이 받는 저장소
export function repositoryFor(group: string): Repository {
  if (group === 'com.acmerobotics' || group.startsWith('com.acmerobotics.'))
    return REPOSITORIES.brott
  if (group === 'androidx.annotation') return REPOSITORIES.google
  return REPOSITORIES.central
}

// 비교용 주소: 앞뒤 공백·끝의 '/'를 빼고 scheme·호스트는 소문자
export function normalizeRepositoryUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const match = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/]*)(.*)$/.exec(trimmed)
  return match ? `${match[1].toLowerCase()}${match[2].toLowerCase()}${match[3]}` : trimmed
}

export type DeclaredRepositories = {
  // 팀이 선언한 허용 저장소
  allowed: ReadonlySet<RepositoryId>
  // 허용하지 않는 저장소(보고의 detail에 보인다, 선언 순서·중복 없이)
  notAllowed: readonly string[]
}

function describe(repository: GradleRepository): string {
  return repository.url ?? `${repository.kind}()`
}

export function declaredRepositories(
  repositories: readonly GradleRepository[]
): DeclaredRepositories {
  const allowed = new Set<RepositoryId>()
  const notAllowed: string[] = []
  for (const repository of repositories) {
    // 플러그인 저장소는 의존성과 관계없다
    if (repository.kind === 'gradlePluginPortal') continue
    const url = repository.url === null ? null : normalizeRepositoryUrl(repository.url)
    const match = Object.values(REPOSITORIES).find((candidate) =>
      url === null ? candidate.kinds.includes(repository.kind) : candidate.aliases.includes(url)
    )
    if (match && (url === null || repository.kind === 'maven')) allowed.add(match.id)
    else {
      const text = describe(repository)
      if (!notAllowed.includes(text)) notAllowed.push(text)
    }
  }
  return { allowed, notAllowed }
}

// 저장소 안 파일 경로(group의 '.'은 폴더). 좌표는 version.ts로 확인한 것이어야 한다.
export function modulePath(group: string, artifact: string, version: string, file: string): string {
  return `${group.split('.').join('/')}/${artifact}/${version}/${file}`
}

// 이 저장소에서 받을 때 닿아도 되는 호스트(기준 주소·거울·리디렉트 대상)
export function allowedHosts(repository: Repository): Set<string> {
  const hosts = new Set<string>(repository.redirectHosts)
  for (const base of [repository.base, ...repository.mirrors]) hosts.add(new URL(base).host)
  return hosts
}
