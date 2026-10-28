import { readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GradleDependency, GradleProject, GradleRepository } from '../../shared/gradle'
import type { LibraryEntry, LibraryProgress } from '../../shared/libraries'
import type { CompileDiagnostic } from '../../shared/sidecarProtocol'
import type { LibraryRequest, LibraryResolution } from '../sidecar/launch'
import { resolveLibraries, type LibraryDeps } from './index'
import { DASHBOARD_DETAIL } from './policy'
import {
  artifactUrl,
  BROTT,
  CENTRAL,
  fakeHttp,
  GOOGLE,
  hex,
  makeAar,
  makeJar,
  moduleJson,
  pom,
  publish,
  putGradleCache,
  tempDir,
  type Route
} from './testkit'

// ---- 팀 Gradle(갈래 B가 읽은 결과 모양) ----

let line = 0
function dep(
  coordinate: string,
  extra: Partial<GradleDependency> = {},
  file = 'TeamCode/build.gradle'
): GradleDependency {
  const [group, artifact, version] = coordinate.split(':')
  return {
    configuration: 'implementation',
    group,
    artifact,
    version,
    classifier: null,
    extension: null,
    excludes: [],
    transitive: true,
    at: { file, line: ++line },
    ...extra
  }
}

const repo = (kind: GradleRepository['kind'], url: string | null = null): GradleRepository => ({
  kind,
  url,
  at: { file: 'build.dependencies.gradle', line: 1 }
})

const FTC_TEMPLATE = (): GradleDependency[] => [
  dep('org.firstinspires.ftc:RobotCore:12.0.0', {}, 'build.dependencies.gradle'),
  dep('androidx.appcompat:appcompat:1.2.0', {}, 'build.dependencies.gradle')
]

function project(
  dependencies: GradleDependency[],
  repositories: GradleRepository[] = [repo('mavenCentral'), repo('google')]
): GradleProject {
  return {
    dependencies,
    repositories,
    compileSdk: 30,
    diagnostics: [],
    files: ['TeamCode/build.gradle']
  }
}

// ---- 가짜 저장소 ----

const REVHUB_AAR = makeAar([
  'com/pedropathing/ftc/drivetrains/Mecanum',
  'com/pedropathing/ftc/localization/PinpointLocalizer'
])
const CORE_JAR = makeJar(['com/pedropathing/follower/Follower', 'com/pedropathing/geometry/Pose'])
const STDLIB_JAR = makeJar(['kotlin/Unit', 'kotlin/collections/CollectionsKt'])
const ANNOTATIONS_JAR = makeJar(['org/jetbrains/annotations/NotNull'])
const ANDROIDX_JAR = makeJar(['androidx/annotation/NonNull'])

function publishPedro(routes: Map<string, Route>): void {
  publish(
    routes,
    CENTRAL,
    'com.pedropathing:revhub:3.0.2',
    'revhub-3.0.2.pom',
    pom({ coordinate: 'com.pedropathing:revhub:3.0.2', packaging: 'aar', marker: true })
  )
  publish(
    routes,
    CENTRAL,
    'com.pedropathing:revhub:3.0.2',
    'revhub-3.0.2.module',
    moduleJson({
      coordinate: 'com.pedropathing:revhub:3.0.2',
      file: { name: 'revhub-3.0.2.aar', bytes: REVHUB_AAR },
      api: [
        { coordinate: 'com.pedropathing:core:3.0.2' },
        { coordinate: 'org.jetbrains.kotlin:kotlin-stdlib:2.3.21' }
      ]
    })
  )
  // .module에 해시가 있으니 .sha256은 없어도 된다
  routes.set(artifactUrl(CENTRAL, 'com.pedropathing:revhub:3.0.2', 'revhub-3.0.2.aar'), REVHUB_AAR)
  publish(
    routes,
    CENTRAL,
    'com.pedropathing:core:3.0.2',
    'core-3.0.2.pom',
    pom({ coordinate: 'com.pedropathing:core:3.0.2', marker: true })
  )
  publish(
    routes,
    CENTRAL,
    'com.pedropathing:core:3.0.2',
    'core-3.0.2.module',
    moduleJson({
      coordinate: 'com.pedropathing:core:3.0.2',
      file: { name: 'core-3.0.2.jar', bytes: CORE_JAR }
    })
  )
  routes.set(artifactUrl(CENTRAL, 'com.pedropathing:core:3.0.2', 'core-3.0.2.jar'), CORE_JAR)
  publish(
    routes,
    CENTRAL,
    'org.jetbrains.kotlin:kotlin-stdlib:2.3.21',
    'kotlin-stdlib-2.3.21.pom',
    pom({ coordinate: 'org.jetbrains.kotlin:kotlin-stdlib:2.3.21', marker: true })
  )
  publish(
    routes,
    CENTRAL,
    'org.jetbrains.kotlin:kotlin-stdlib:2.3.21',
    'kotlin-stdlib-2.3.21.module',
    moduleJson({
      coordinate: 'org.jetbrains.kotlin:kotlin-stdlib:2.3.21',
      file: { name: 'kotlin-stdlib-2.3.21.jar', bytes: STDLIB_JAR },
      api: [{ coordinate: 'org.jetbrains:annotations:13.0' }],
      constraints: ['org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.0']
    })
  )
  routes.set(
    artifactUrl(CENTRAL, 'org.jetbrains.kotlin:kotlin-stdlib:2.3.21', 'kotlin-stdlib-2.3.21.jar'),
    STDLIB_JAR
  )
  publish(
    routes,
    CENTRAL,
    'org.jetbrains:annotations:13.0',
    'annotations-13.0.pom',
    pom({ coordinate: 'org.jetbrains:annotations:13.0' })
  )
  publish(
    routes,
    CENTRAL,
    'org.jetbrains:annotations:13.0',
    'annotations-13.0.jar',
    ANNOTATIONS_JAR
  )
  publish(
    routes,
    GOOGLE,
    'androidx.annotation:annotation:1.1.0',
    'annotation-1.1.0.pom',
    pom({ coordinate: 'androidx.annotation:annotation:1.1.0' })
  )
  publish(
    routes,
    GOOGLE,
    'androidx.annotation:annotation:1.1.0',
    'annotation-1.1.0.jar',
    ANDROIDX_JAR
  )
}

// ---- 실행 ----

let dir: string
let cacheDir: string
let gradleHome: string

beforeEach(async () => {
  dir = await tempDir()
  cacheDir = join(dir, 'library-cache')
  gradleHome = join(dir, 'gradle-home')
  line = 0
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

type Run = { result: LibraryResolution; progress: LibraryProgress[] }

async function run(
  gradle: GradleProject,
  routes: Map<string, Route> | Record<string, Route>,
  extra: Partial<LibraryDeps> & { signal?: AbortSignal } = {}
): Promise<Run & { requests: string[] }> {
  const http = fakeHttp(routes)
  const progress: LibraryProgress[] = []
  let clock = 0
  const request: LibraryRequest = {
    projectRoot: dir,
    gradle,
    signal: extra.signal ?? new AbortController().signal,
    progress: (p) => progress.push(p)
  }
  const result = await resolveLibraries(request, {
    cacheDir,
    gradleHome,
    http,
    sleep: async () => undefined,
    now: () => (clock += 30),
    ...extra
  })
  if (!result.ok) throw new Error(`resolution failed: ${result.code} ${result.detail}`)
  return { result, progress, requests: http.requests }
}

const offlineHttp: LibraryDeps['http'] = async () => {
  throw new Error('getaddrinfo ENOTFOUND repo1.maven.org')
}
const noNetwork = (): LibraryDeps['http'] => {
  return async (url) => {
    throw new Error(`no network allowed: ${url}`)
  }
}

const statuses = (entries: readonly LibraryEntry[]): string[] =>
  entries.map(
    (e) =>
      `${e.group}:${e.artifact}:${e.version} ${e.status}${e.reason === 'none' ? '' : `:${e.reason}`}`
  )

const coordinatesOf = (result: LibraryResolution, paths: string[]): string[] =>
  paths.map((p) => result.jarCoordinates[p])

describe('라이브러리 해석(가짜 저장소)', () => {
  it('Pedro 3.x: 받기, 보고 순서, 클래스패스, androidx.annotation(컴파일만), 무결성', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const { result, progress } = await run(
      project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')]),
      routes
    )
    expect(statuses(result.report.entries)).toEqual([
      'org.firstinspires.ftc:RobotCore:12.0.0 provided',
      'androidx.appcompat:appcompat:1.2.0 provided',
      'com.pedropathing:revhub:3.0.2 used',
      'androidx.annotation:annotation:1.1.0 used',
      'com.pedropathing:core:3.0.2 used',
      'org.jetbrains.kotlin:kotlin-stdlib:2.3.21 used',
      'org.jetbrains:annotations:13.0 used'
    ])
    const byArtifact = Object.fromEntries(result.report.entries.map((e) => [e.artifact, e]))
    expect(byArtifact.revhub.declaredAt).toEqual({ file: 'TeamCode/build.gradle', line: 3 })
    expect(byArtifact.annotation.requestedBy).toEqual(['androidx.appcompat:appcompat:1.2.0'])
    expect(byArtifact['kotlin-stdlib'].requestedBy).toEqual(['com.pedropathing:revhub:3.0.2'])
    expect(byArtifact.revhub.source).toBe('download')
    expect(byArtifact.revhub.integrity).toBe('checksum')
    expect(byArtifact.annotations.integrity).toBe('checksum')
    expect(byArtifact.RobotCore.source).toBeNull()
    expect(coordinatesOf(result, result.compileClasspath)).toEqual([
      'com.pedropathing:revhub:3.0.2',
      'androidx.annotation:annotation:1.1.0',
      'com.pedropathing:core:3.0.2',
      'org.jetbrains.kotlin:kotlin-stdlib:2.3.21',
      'org.jetbrains:annotations:13.0'
    ])
    expect(coordinatesOf(result, result.libraryClasspath)).toEqual([
      'com.pedropathing:revhub:3.0.2',
      'com.pedropathing:core:3.0.2',
      'org.jetbrains.kotlin:kotlin-stdlib:2.3.21',
      'org.jetbrains:annotations:13.0'
    ])
    // 클래스패스는 라이브러리 캐시 안의 jar
    for (const path of result.compileClasspath) {
      expect(path.startsWith(join(cacheDir, 'blobs'))).toBe(true)
      expect(path.endsWith('.jar')).toBe(true)
    }
    // AAR에서 꺼낸 classes.jar
    expect(await readFile(result.compileClasspath[0])).toEqual(
      makeJar([
        'com/pedropathing/ftc/drivetrains/Mecanum',
        'com/pedropathing/ftc/localization/PinpointLocalizer'
      ])
    )
    expect(result.report.compileSdk).toBe(30)
    // 진행(가짜 시계 30 ms마다 → 100 ms 간격 이하로 줄여 보냄)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.some((p) => p.phase === 'downloading' && p.bytes > 0)).toBe(true)
  })

  it('두 번째 실행은 잠금과 캐시로 네트워크 없이, 진행 알림 없이', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const gradle = project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')])
    const first = await run(gradle, routes)
    const second = await run(gradle, {}, { http: noNetwork() })
    expect(second.result.compileClasspath).toEqual(first.result.compileClasspath)
    expect(second.result.libraryClasspath).toEqual(first.result.libraryClasspath)
    expect(statuses(second.result.report.entries)).toEqual(statuses(first.result.report.entries))
    expect(second.result.report.entries.find((e) => e.artifact === 'revhub')?.source).toBe(
      'libraryCache'
    )
    expect(second.progress).toEqual([])
    // 잠금이 없어도(선언 줄이 바뀜) 캐시의 메타데이터·파일로 네트워크 없이
    line = 10
    const moved = project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')])
    const third = await run(moved, {}, { http: noNetwork() })
    expect(third.result.compileClasspath).toEqual(first.result.compileClasspath)
    expect(third.result.report.entries.find((e) => e.artifact === 'revhub')?.declaredAt?.line).toBe(
      13
    )
  })

  it('Gradle 캐시(폴더 이름 = sha1)를 쓰면 네트워크 없이 된다', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    // 저장소의 모든 파일을 Gradle 캐시에 넣는다(체크섬 파일 제외)
    for (const [url, value] of routes) {
      if (/\.(sha1|sha256)$/.test(url) || !Buffer.isBuffer(value)) continue
      const base = [CENTRAL, GOOGLE].find((b) => url.startsWith(b))!
      const parts = url.slice(base.length).split('/')
      const file = parts.pop()!
      const version = parts.pop()!
      const artifact = parts.pop()!
      await putGradleCache(gradleHome, `${parts.join('.')}:${artifact}:${version}`, file, value)
    }
    // 내용과 폴더 이름이 다른 것은 쓰지 않는다
    await putGradleCache(
      gradleHome,
      'com.pedropathing:core:3.0.2',
      'core-3.0.2.jar',
      'tampered',
      '0'.repeat(40)
    )
    const { result } = await run(
      project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')]),
      {},
      { http: noNetwork() }
    )
    const revhub = result.report.entries.find((e) => e.artifact === 'revhub')!
    expect(revhub.status).toBe('used')
    expect(revhub.source).toBe('gradleCache')
    // .module의 sha256으로 확인했다
    expect(revhub.integrity).toBe('checksum')
    expect(result.report.entries.find((e) => e.artifact === 'annotations')?.integrity).toBe(
      'gradleCache'
    )
    expect(result.compileClasspath).toHaveLength(5)
  })

  it('오프라인이고 캐시도 없으면 그 좌표만 failed offline, 실행은 계속(잠금 없음)', async () => {
    const { result } = await run(
      project([dep('com.pedropathing:revhub:3.0.2')]),
      {},
      { http: offlineHttp }
    )
    expect(statuses(result.report.entries)).toEqual([
      'com.pedropathing:revhub:3.0.2 failed:offline'
    ])
    expect(result.compileClasspath).toEqual([])
    expect(await readdir(join(cacheDir, 'resolutions')).catch(() => [])).toEqual([])
  })

  it('정책: AutoTune·Pedro 2.x·Panels·Dashboard·동적 버전·지원 밖, 그리고 지원 계열이 끌어온 것을 직접 선언', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const gradle = project(
      [
        ...FTC_TEMPLATE(),
        dep('com.pedropathing:revhub:3.0.2'),
        dep('com.pedropathing:tuning:1.0.1'),
        dep('com.pedropathing:ftc:2.1.1'),
        dep('com.bylazar:fullpanels:1.0.12'),
        dep('com.acmerobotics.dashboard:dashboard:0.6.0'),
        dep('org.ftclib.ftclib:core:+'),
        dep('com.github.someone:lib:1.0'),
        dep('org.jetbrains.kotlin:kotlin-stdlib:2.3.21')
      ],
      [
        repo('mavenCentral'),
        repo('google'),
        repo('maven', 'https://repo.dairy.foundation/releases/'),
        repo('maven', 'https://jitpack.io')
      ]
    )
    const { result } = await run(gradle, routes)
    expect(statuses(result.report.entries)).toEqual([
      'org.firstinspires.ftc:RobotCore:12.0.0 provided',
      'androidx.appcompat:appcompat:1.2.0 provided',
      'com.pedropathing:revhub:3.0.2 used',
      'com.pedropathing:tuning:1.0.1 unsupported:pedroTuning',
      'com.pedropathing:ftc:2.1.1 unsupported:pedro2',
      'com.bylazar:fullpanels:1.0.12 unsupported:panels',
      'com.acmerobotics.dashboard:dashboard:0.6.0 unsupported:notSupported',
      'org.ftclib.ftclib:core:+ unsupported:dynamicVersion',
      'com.github.someone:lib:1.0 unsupported:notSupported',
      'org.jetbrains.kotlin:kotlin-stdlib:2.3.21 used',
      'androidx.annotation:annotation:1.1.0 used',
      'com.pedropathing:core:3.0.2 used',
      'org.jetbrains:annotations:13.0 used'
    ])
    const dashboard = result.report.entries.find((e) => e.group === 'com.acmerobotics.dashboard')!
    expect(dashboard.detail).toBe(DASHBOARD_DETAIL)
    expect(
      result.report.entries.find((e) => e.artifact === 'kotlin-stdlib')?.declaredAt
    ).not.toBeNull()
  })

  it('maven.brott.dev: 302를 따라가고, 체크섬이 없어 처음 받은 해시를 기록하고, 다음에 다르면 거부한다', async () => {
    const azure = 'https://acmerobotics.z13.web.core.windows.net/'
    const routes = new Map<string, Route>()
    const coreJar = makeJar(['com/acmerobotics/roadrunner/Pose2d'])
    const files: [string, Buffer | string][] = [
      [
        'core-1.0.0.pom',
        pom({ coordinate: 'com.acmerobotics.roadrunner:core:1.0.0', marker: true })
      ],
      ['core-1.0.0.jar', coreJar]
    ]
    for (const [file, bytes] of files) {
      const path = artifactUrl('', 'com.acmerobotics.roadrunner:core:1.0.0', file)
      routes.set(`${BROTT}${path}`, { status: 302, headers: { location: `${azure}${path}` } })
      routes.set(`${azure}${path}`, Buffer.from(bytes))
    }
    const gradle = project(
      [dep('com.acmerobotics.roadrunner:core:1.0.0')],
      [repo('mavenCentral'), repo('maven', 'https://maven.brott.dev/')]
    )
    const { result, requests } = await run(gradle, routes)
    const core = result.report.entries[0]
    expect(core.status).toBe('used')
    expect(core.integrity).toBe('firstUse')
    // .module·체크섬 파일은 없다(404도 받아 넘긴다), 체크섬은 묻지 않는다
    expect(requests.some((url) => url.endsWith('.sha1'))).toBe(false)
    const firstUse = JSON.parse(await readFile(join(cacheDir, 'first-use.json'), 'utf8'))
    expect(firstUse['com.acmerobotics.roadrunner:core:1.0.0/core-1.0.0.jar']).toBe(
      hex('sha256', coreJar)
    )

    // 저장소의 파일이 바뀌었다: 캐시를 지우고 다시 받으면 기록과 달라 거부
    await rm(join(cacheDir, 'index'), { recursive: true })
    await rm(join(cacheDir, 'resolutions'), { recursive: true })
    routes.set(
      `${azure}${artifactUrl('', 'com.acmerobotics.roadrunner:core:1.0.0', 'core-1.0.0.jar')}`,
      makeJar(['evil/X'])
    )
    const again = await run(gradle, routes)
    expect(statuses(again.result.report.entries)).toEqual([
      'com.acmerobotics.roadrunner:core:1.0.0 failed:checksumMismatch'
    ])
  })

  it('SandBot이 아는 해시(pins)와 다르면 거부한다(Road Runner core 1.0.1)', async () => {
    const routes = new Map<string, Route>()
    publish(
      routes,
      BROTT,
      'com.acmerobotics.roadrunner:core:1.0.1',
      'core-1.0.1.pom',
      pom({ coordinate: 'com.acmerobotics.roadrunner:core:1.0.1' })
    )
    const gradle = project(
      [dep('com.acmerobotics.roadrunner:core:1.0.1')],
      [repo('maven', 'https://maven.brott.dev')]
    )
    const { result } = await run(gradle, routes)
    expect(result.report.entries[0].status).toBe('failed')
    expect(result.report.entries[0].reason).toBe('checksumMismatch')
  })

  it('Road Runner quickstart(실제 POM): 대시보드는 지원 안 함, RobotCore는 제공, jackson은 실행 범위, POM은 고정 해시로 확인', async () => {
    const fixture = async (name: string): Promise<Buffer> =>
      // git이 줄 끝을 바꿨어도 원래(LF) 글자로
      Buffer.from(
        (await readFile(join(__dirname, '__fixtures__', name), 'utf8')).replace(/\r\n/g, '\n')
      )
    const routes = new Map<string, Route>()
    publish(
      routes,
      BROTT,
      'com.acmerobotics.roadrunner:ftc:0.1.25',
      'ftc-0.1.25.pom',
      await fixture('ftc-0.1.25.pom')
    )
    publish(
      routes,
      BROTT,
      'com.acmerobotics.roadrunner:core:1.0.1',
      'core-1.0.1.pom',
      await fixture('core-1.0.1.pom')
    )
    publish(
      routes,
      BROTT,
      'com.acmerobotics.roadrunner:actions:1.0.1',
      'actions-1.0.1.pom',
      await fixture('actions-1.0.1.pom')
    )
    // 실제 jar가 아니라 고정 해시와 다르다
    publish(
      routes,
      BROTT,
      'com.acmerobotics.roadrunner:core:1.0.1',
      'core-1.0.1.jar',
      makeJar(['x/Fake'])
    )
    for (const [coordinate, deps] of [
      [
        'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0',
        ['org.jetbrains.kotlin:kotlin-stdlib:1.9.0']
      ],
      ['org.jetbrains.kotlin:kotlin-stdlib:1.9.0', []],
      [
        'com.fasterxml.jackson.core:jackson-databind:2.12.7',
        ['com.fasterxml.jackson.core:jackson-core:2.12.7']
      ],
      ['com.fasterxml.jackson.core:jackson-core:2.12.7', []]
    ] as const) {
      const [, artifact, version] = coordinate.split(':')
      publish(
        routes,
        CENTRAL,
        coordinate,
        `${artifact}-${version}.pom`,
        pom({ coordinate, dependencies: deps.map((d) => ({ coordinate: d })) })
      )
      publish(routes, CENTRAL, coordinate, `${artifact}-${version}.jar`, makeJar([`${artifact}/X`]))
    }
    const gradle = project(
      [
        dep('com.acmerobotics.roadrunner:ftc:0.1.25'),
        dep('com.acmerobotics.roadrunner:core:1.0.1'),
        dep('com.acmerobotics.roadrunner:actions:1.0.1'),
        dep('com.acmerobotics.dashboard:dashboard:0.5.1')
      ],
      [repo('mavenCentral'), repo('google'), repo('maven', 'https://maven.brott.dev/')]
    )
    const { result } = await run(gradle, routes)
    expect(statuses(result.report.entries)).toEqual([
      'com.acmerobotics.roadrunner:ftc:0.1.25 failed:notFound',
      'com.acmerobotics.roadrunner:core:1.0.1 failed:checksumMismatch',
      'com.acmerobotics.roadrunner:actions:1.0.1 failed:notFound',
      'com.acmerobotics.dashboard:dashboard:0.5.1 unsupported:notSupported',
      'com.acmerobotics.dashboard:core:0.4.7 unsupported:notSupported',
      'com.fasterxml.jackson.core:jackson-core:2.12.7 used',
      'com.fasterxml.jackson.core:jackson-databind:2.12.7 used',
      'org.firstinspires.ftc:RobotCore:10.0.0 provided',
      'org.jetbrains.kotlin:kotlin-stdlib:1.9.0 used',
      'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0 used'
    ])
    const byArtifact = Object.fromEntries(result.report.entries.map((e) => [e.artifact, e]))
    expect(byArtifact.dashboard.requested).toEqual(['0.5.1', '0.4.10'])
    expect(byArtifact.dashboard.detail).toBe(DASHBOARD_DETAIL)
    // 고정 해시와 다른 jar(가짜): ftc·actions의 jar는 저장소에 없어 404이고, core의 jar는 해시가 다르다
    const rrCore = result.report.entries.find(
      (e) => e.group === 'com.acmerobotics.roadrunner' && e.artifact === 'core'
    )
    expect(rrCore?.detail).toContain('is not the known')
    // jackson은 실행 클래스패스에만
    expect(coordinatesOf(result, result.libraryClasspath)).toContain(
      'com.fasterxml.jackson.core:jackson-databind:2.12.7'
    )
    expect(coordinatesOf(result, result.compileClasspath)).not.toContain(
      'com.fasterxml.jackson.core:jackson-databind:2.12.7'
    )
    expect(coordinatesOf(result, result.compileClasspath)).toContain(
      'org.jetbrains.kotlin:kotlin-stdlib:1.9.0'
    )
    // POM은 고정 해시로 확인했으니 처음 받은 해시로 기록하지 않는다
    const firstUse = await readFile(join(cacheDir, 'first-use.json'), 'utf8').catch(() => '{}')
    expect(Object.keys(JSON.parse(firstUse)).filter((k) => k.endsWith('.pom'))).toEqual([])
  })

  it('FTCLib core 2.1.1(실제 POM): androidx.core는 제공, ejml-all은 제외, JSR 305(javax.annotation)는 쓴다', async () => {
    const routes = new Map<string, Route>()
    const ftclibPom = (
      await readFile(join(__dirname, '__fixtures__', 'ftclib-core-2.1.1.pom'), 'utf8')
    ).replace(/\r\n/g, '\n')
    publish(routes, CENTRAL, 'org.ftclib.ftclib:core:2.1.1', 'core-2.1.1.pom', ftclibPom)
    publish(
      routes,
      CENTRAL,
      'org.ftclib.ftclib:core:2.1.1',
      'core-2.1.1.aar',
      makeAar(['com/arcrobotics/ftclib/command/CommandOpMode'])
    )
    const simple = 'org.ejml:ejml-simple:0.39'
    publish(
      routes,
      CENTRAL,
      simple,
      'ejml-simple-0.39.pom',
      pom({
        coordinate: simple,
        dependencies: [
          { coordinate: 'com.google.code.findbugs:jsr305:3.0.2' },
          { coordinate: 'org.ejml:ejml-core:0.39' },
          { coordinate: 'org.ejml:ejml-all:0.39' },
          { coordinate: 'org.ejml:ejml-experimental:0.39', scope: 'test' }
        ]
      })
    )
    publish(
      routes,
      CENTRAL,
      simple,
      'ejml-simple-0.39.jar',
      makeJar(['org/ejml/simple/SimpleMatrix'])
    )
    for (const [coordinate, classes] of [
      ['com.google.code.findbugs:jsr305:3.0.2', ['javax/annotation/Nonnull']],
      ['org.ejml:ejml-core:0.39', ['org/ejml/data/DMatrix']],
      ['org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.6.10', ['kotlin/jdk7/AutoCloseableKt']]
    ] as const) {
      const [, artifact, version] = coordinate.split(':')
      publish(routes, CENTRAL, coordinate, `${artifact}-${version}.pom`, pom({ coordinate }))
      publish(routes, CENTRAL, coordinate, `${artifact}-${version}.jar`, makeJar([...classes]))
    }
    const { result, requests } = await run(project([dep('org.ftclib.ftclib:core:2.1.1')]), routes)
    expect(statuses(result.report.entries)).toEqual([
      'org.ftclib.ftclib:core:2.1.1 used',
      'androidx.core:core-ktx:1.6.0 provided',
      'com.google.code.findbugs:jsr305:3.0.2 used',
      'org.ejml:ejml-core:0.39 used',
      'org.ejml:ejml-simple:0.39 used',
      'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.6.10 used'
    ])
    // 제외한 것·제공·시험 범위는 묻지도 않는다
    expect(requests.some((url) => /ejml-all|ejml-experimental|androidx/.test(url))).toBe(false)
    expect(coordinatesOf(result, result.compileClasspath)).toEqual([
      'org.ftclib.ftclib:core:2.1.1',
      'com.google.code.findbugs:jsr305:3.0.2',
      'org.ejml:ejml-core:0.39',
      'org.ejml:ejml-simple:0.39',
      'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.6.10'
    ])
  })

  it('그룹의 저장소를 선언하지 않았으면: 허용하지 않은 저장소만 있으면 repositoryNotAllowed, 없으면 notFound', async () => {
    const notAllowed = await run(
      project(
        [dep('com.acmerobotics.roadrunner:core:1.0.0')],
        [repo('maven', 'https://jitpack.io')]
      ),
      {}
    )
    expect(statuses(notAllowed.result.report.entries)).toEqual([
      'com.acmerobotics.roadrunner:core:1.0.0 unsupported:repositoryNotAllowed'
    ])
    expect(notAllowed.result.report.entries[0].detail).toContain('https://jitpack.io')
    const missing = await run(
      project([dep('com.acmerobotics.roadrunner:core:1.0.0')], [repo('mavenCentral')]),
      {}
    )
    expect(statuses(missing.result.report.entries)).toEqual([
      'com.acmerobotics.roadrunner:core:1.0.0 failed:notFound'
    ])
    expect(missing.requests).toEqual([])
  })

  it('AAR의 네이티브 코드·보호 패키지는 그 좌표만 실패', async () => {
    const routes = new Map<string, Route>()
    const nativeAar = makeAar(
      ['com/arcrobotics/ftclib/X'],
      [{ name: 'jni/arm64-v8a/libx.so', data: 'elf' }]
    )
    publish(
      routes,
      CENTRAL,
      'org.ftclib.ftclib:core:2.1.1',
      'core-2.1.1.pom',
      pom({ coordinate: 'org.ftclib.ftclib:core:2.1.1', packaging: 'aar' })
    )
    publish(routes, CENTRAL, 'org.ftclib.ftclib:core:2.1.1', 'core-2.1.1.aar', nativeAar)
    publish(
      routes,
      CENTRAL,
      'com.pedropathing:core:3.0.0',
      'core-3.0.0.pom',
      pom({ coordinate: 'com.pedropathing:core:3.0.0' })
    )
    publish(
      routes,
      CENTRAL,
      'com.pedropathing:core:3.0.0',
      'core-3.0.0.jar',
      makeJar(['com/qualcomm/robotcore/hardware/DcMotor'])
    )
    const { result } = await run(
      project([dep('org.ftclib.ftclib:core:2.1.1'), dep('com.pedropathing:core:3.0.0')]),
      routes
    )
    expect(statuses(result.report.entries)).toEqual([
      'org.ftclib.ftclib:core:2.1.1 failed:badArchive',
      'com.pedropathing:core:3.0.0 failed:protectedPackage'
    ])
    expect(result.compileClasspath).toEqual([])
  })

  it('체크섬 파일과 다르면 checksumMismatch', async () => {
    const routes = new Map<string, Route>()
    publish(
      routes,
      CENTRAL,
      'org.ftclib.ftclib:core:2.1.1',
      'core-2.1.1.pom',
      pom({ coordinate: 'org.ftclib.ftclib:core:2.1.1' })
    )
    publish(
      routes,
      CENTRAL,
      'org.ftclib.ftclib:core:2.1.1',
      'core-2.1.1.jar',
      makeJar(['com/arcrobotics/ftclib/X'])
    )
    routes.set(
      `${artifactUrl(CENTRAL, 'org.ftclib.ftclib:core:2.1.1', 'core-2.1.1.jar')}.sha256`,
      '0'.repeat(64)
    )
    const { result } = await run(project([dep('org.ftclib.ftclib:core:2.1.1')]), routes)
    expect(statuses(result.report.entries)).toEqual([
      'org.ftclib.ftclib:core:2.1.1 failed:checksumMismatch'
    ])
  })

  it('받는 중 취소하면 cancelled', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const abort = new AbortController()
    routes.set(artifactUrl(CENTRAL, 'com.pedropathing:revhub:3.0.2', 'revhub-3.0.2.module'), () => {
      abort.abort()
      return { status: 500 }
    })
    const result = await resolveLibraries(
      {
        projectRoot: dir,
        gradle: project([dep('com.pedropathing:revhub:3.0.2')]),
        signal: abort.signal,
        progress: () => undefined
      },
      { cacheDir, gradleHome, http: fakeHttp(routes), sleep: async () => undefined }
    )
    expect(result).toEqual({ ok: false, code: 'cancelled', detail: '' })
  })

  it('선언이 없거나 받을 것이 없으면 네트워크도 진행도 없다', async () => {
    const empty = await run(project([]), {}, { http: noNetwork() })
    expect(empty.result.report.entries).toEqual([])
    const sdkOnly = await run(
      project([dep('org.firstinspires.ftc:RobotCore:12.0.0')], []),
      {},
      { http: noNetwork() }
    )
    expect(statuses(sdkOnly.result.report.entries)).toEqual([
      'org.firstinspires.ftc:RobotCore:12.0.0 provided'
    ])
    expect(sdkOnly.progress).toEqual([])
  })

  it('진단 안내: 불러오지 않은 라이브러리·선언하지 않은 라이브러리·불러온 패키지', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const { result } = await run(
      project([
        ...FTC_TEMPLATE(),
        dep('com.pedropathing:revhub:3.0.2'),
        dep('com.pedropathing:tuning:1.0.1')
      ]),
      routes
    )
    const diagnostic = (
      message: string,
      code = 'compiler.err.doesnt.exist'
    ): CompileDiagnostic => ({
      kind: 'error',
      file: '/x/Tuning.java',
      line: 3,
      column: 1,
      message,
      code
    })
    expect(
      result.diagnosticHint(diagnostic('package com.pedropathing.tuning.autotune does not exist'))
    ).toEqual({
      kind: 'libraryNotLoaded',
      coordinate: 'com.pedropathing:tuning:1.0.1',
      reason: 'pedroTuning'
    })
    expect(
      result.diagnosticHint(diagnostic('package com.bylazar.telemetry does not exist'))
    ).toEqual({
      kind: 'undeclared',
      packageName: 'com.bylazar.telemetry'
    })
    expect(
      result.diagnosticHint(
        diagnostic(
          'cannot find symbol\n  symbol:   class FollowerBuilder\n  location: package com.pedropathing.follower',
          'compiler.err.cant.resolve.location'
        )
      )
    ).toBeNull()
    // 팀 자신의 패키지는 안내하지 않는다
    expect(
      result.diagnosticHint(
        diagnostic('package org.firstinspires.ftc.teamcode.subsytems does not exist')
      )
    ).toBeNull()
    // 불러온 라이브러리 클래스가 불러오지 않은 라이브러리를 참조(cannot access … class file not found)
    expect(
      result.diagnosticHint(
        diagnostic(
          'cannot access com.pedropathing.tuning.Procedure\n  class file for com.pedropathing.tuning.Procedure not found',
          'compiler.err.cant.access'
        )
      )
    ).toMatchObject({ kind: 'libraryNotLoaded', reason: 'pedroTuning' })
    // 경고·참고에는 붙이지 않는다
    expect(
      result.diagnosticHint({
        ...diagnostic('package com.bylazar.telemetry does not exist'),
        kind: 'warning'
      })
    ).toBeNull()
  })

  it('잠금의 jar가 깨졌으면 새로 해석해 캐시의 원본에서 다시 만든다(네트워크 없이)', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const gradle = project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')])
    const first = await run(gradle, routes)
    const classes = first.result.compileClasspath[0]
    await writeFile(classes, 'broken')
    const second = await run(gradle, {}, { http: noNetwork() })
    expect(second.result.compileClasspath).toEqual(first.result.compileClasspath)
    expect(await readFile(classes)).toEqual(
      makeJar([
        'com/pedropathing/ftc/drivetrains/Mecanum',
        'com/pedropathing/ftc/localization/PinpointLocalizer'
      ])
    )
  })

  it('캐시가 용량을 넘으면 이번 jar는 남기고 오래된 것부터 지운다', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    await run(project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')]), routes)
    const stale = join(cacheDir, 'blobs', `${'a'.repeat(64)}.jar`)
    await writeFile(stale, Buffer.alloc(4096))
    line = 0
    const { result } = await run(
      project([
        ...FTC_TEMPLATE(),
        dep('com.pedropathing:revhub:3.0.2', { at: { file: 'x', line: 99 } })
      ]),
      routes,
      {
        maxCacheBytes: 1
      }
    )
    for (const path of result.compileClasspath)
      expect((await readFile(path)).length).toBeGreaterThan(0)
    expect(await readFile(stale).catch(() => null)).toBeNull()
  })
})
