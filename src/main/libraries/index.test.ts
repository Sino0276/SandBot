import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GradleDependency, GradleProject, GradleRepository } from '../../shared/gradle'
import type { LibraryEntry, LibraryProgress } from '../../shared/libraries'
import type { CompileDiagnostic } from '../../shared/sidecarProtocol'
import type { LibraryRequest, LibraryResolution } from '../sidecar/launch'
import { LibraryCache } from './cache'
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
  MIRROR,
  moduleJson,
  pom,
  publish,
  putGradleCache,
  tempDir,
  type Route
} from './testkit'

// first-use.json을 바꿔 넣을 수 없다(Windows에서 백신·색인기가 잡고 있음 등, 다시 해 봐도 EPERM). 시험이 켠다.
let blockFirstUseWrite = false
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      if (blockFirstUseWrite && to.endsWith('first-use.json')) {
        const error = new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`)
        throw Object.assign(error, { code: 'EPERM' })
      }
      return actual.rename(from, to)
    }
  }
})

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
    compileSdkMinor: null,
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
  // Maven Central의 annotations 13.0에는 .sha256이 없고 .sha1만 있다
  publish(
    routes,
    CENTRAL,
    'org.jetbrains:annotations:13.0',
    'annotations-13.0.jar',
    ANNOTATIONS_JAR,
    'sha1'
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
  blockFirstUseWrite = false
  vi.restoreAllMocks()
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

// 실제 POM(__fixtures__). git이 줄 끝을 바꿨어도 원래(LF) 글자로.
const fixture = async (name: string): Promise<Buffer> =>
  Buffer.from(
    (await readFile(join(__dirname, '__fixtures__', name), 'utf8')).replace(/\r\n/g, '\n')
  )

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
    // .module·체크섬 파일은 없다: POM에 Gradle 메타데이터 표시가 있어도 .module은 묻지 않고, 체크섬도 묻지 않는다
    expect(requests.some((url) => url.endsWith('.sha1') || url.endsWith('.module'))).toBe(false)
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

  it('진단 안내: Gradle 파일을 다 읽지 못했으면 선언하지 않았다고 단정하지 않는다', async () => {
    const remote: GradleProject['diagnostics'][number] = {
      code: 'remoteScript',
      at: { file: 'TeamCode/build.gradle', line: 3 },
      detail: 'https://raw.githubusercontent.com/our-team/ftc-shared/main/pedro.gradle'
    }
    const missing = (packageName: string): CompileDiagnostic => ({
      kind: 'error',
      file: '/x/Auto.java',
      line: 3,
      column: 1,
      message: `package ${packageName} does not exist`,
      code: 'compiler.err.doesnt.exist'
    })
    // 받을 것이 없음(선언을 원격 스크립트에 둠)
    const empty = await run({ ...project([]), diagnostics: [remote] }, {}, { http: noNetwork() })
    expect(empty.result.diagnosticHint(missing('com.pedropathing.follower'))).toEqual({
      kind: 'maybeUndeclared',
      packageName: 'com.pedropathing.follower'
    })
    // 해석한 결과와 잠금에서 읽은 결과
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const gradle = { ...project([dep('com.pedropathing:revhub:3.0.2')]), diagnostics: [remote] }
    const fresh = await run(gradle, routes)
    const locked = await run(gradle, {}, { http: noNetwork() })
    for (const { result } of [fresh, locked])
      expect(result.diagnosticHint(missing('com.bylazar.telemetry'))).toEqual({
        kind: 'maybeUndeclared',
        packageName: 'com.bylazar.telemetry'
      })
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

// ---- 오프라인·막힌 저장소·잘못된 응답·기록 실패 ----

// 실제 네트워크처럼 응답이 조금씩 늦게 온다(동시에 받는 파일이 겹치게)
const delayed =
  (http: LibraryDeps['http'], ms = 5): LibraryDeps['http'] =>
  async (url, options) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return http(url, options)
  }

// 응답 머리글 뒤 본문이 오지 않는다
const stalledBody = (): AsyncIterable<Uint8Array> => ({
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) })
})

const BROTT_REPOSITORY = repo('maven', 'https://maven.brott.dev/')

describe('라이브러리 가져오기: 오프라인·막힌 저장소·잘못된 응답·기록 실패', () => {
  it('maven.brott.dev는 .module을 묻지 않는다: Gradle 캐시만으로, 선언 줄이 바뀌어도 라이브러리 캐시로 네트워크 없이', async () => {
    const c = 'com.acmerobotics.roadrunner:core:1.0.0'
    const gradle = (at: number): GradleProject =>
      project([dep(c, { at: { file: 'TeamCode/build.gradle', line: at } })], [BROTT_REPOSITORY])
    // Android Studio로 빌드한 PC에서 처음 쓰는 SandBot, 네트워크 없음(Gradle도 .module이 없어 POM을 썼다)
    await putGradleCache(gradleHome, c, 'core-1.0.0.pom', pom({ coordinate: c, marker: true }))
    await putGradleCache(
      gradleHome,
      c,
      'core-1.0.0.jar',
      makeJar(['com/acmerobotics/roadrunner/Pose2d'])
    )
    const first = await run(gradle(3), {}, { http: noNetwork() })
    expect(statuses(first.result.report.entries)).toEqual([`${c} used`])
    expect(first.result.report.entries[0].source).toBe('gradleCache')
    // 선언 위에 한 줄을 넣었다(잠금 키가 바뀌어 새로 해석한다): 라이브러리 캐시의 POM·jar로
    await rm(gradleHome, { recursive: true, force: true })
    const moved = await run(gradle(4), {}, { http: noNetwork() })
    expect(statuses(moved.result.report.entries)).toEqual([`${c} used`])
    expect(moved.result.report.entries[0].source).toBe('libraryCache')
    expect(moved.result.compileClasspath).toEqual(first.result.compileClasspath)
  })

  it('maven.brott.dev에 나중에 .module이 생겨도 고정 해시·처음 받은 기록의 POM이 정한 파일과 의존성만 쓴다', async () => {
    const evilJar = makeJar(['com/acmerobotics/roadrunner/Pose2d', 'evil/Payload'])
    const evil = 'io.github.evil:helper:9.9.9'
    const routes = new Map<string, Route>()
    publish(routes, CENTRAL, evil, 'helper-9.9.9.pom', pom({ coordinate: evil }))
    publish(routes, CENTRAL, evil, 'helper-9.9.9.jar', makeJar(['evil/More']))
    const plant = (coordinate: string): void => {
      const [, artifact, version] = coordinate.split(':')
      const file = `${artifact}-${version}-x.jar`
      publish(
        routes,
        BROTT,
        coordinate,
        `${artifact}-${version}.module`,
        moduleJson({
          coordinate,
          file: { name: file, bytes: evilJar },
          runtime: [{ coordinate: evil }]
        })
      )
      publish(routes, BROTT, coordinate, file, evilJar)
    }
    const kotlin = 'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0'
    publish(routes, CENTRAL, kotlin, 'kotlin-stdlib-jdk8-1.9.0.pom', pom({ coordinate: kotlin }))
    publish(routes, CENTRAL, kotlin, 'kotlin-stdlib-jdk8-1.9.0.jar', makeJar(['kotlin/jdk7/X']))

    // 고정 해시가 있는 버전(실제 POM, Gradle 메타데이터 표시가 있다): jar도 고정 해시로만(여기 jar는 가짜라 거부)
    const pinned = 'com.acmerobotics.roadrunner:core:1.0.1'
    publish(routes, BROTT, pinned, 'core-1.0.1.pom', await fixture('core-1.0.1.pom'))
    publish(routes, BROTT, pinned, 'core-1.0.1.jar', evilJar)
    plant(pinned)
    const repositories = [repo('mavenCentral'), BROTT_REPOSITORY]
    const first = await run(project([dep(pinned)], repositories), routes)
    expect(statuses(first.result.report.entries)).toEqual([
      `${pinned} failed:checksumMismatch`,
      `${kotlin} used`
    ])
    expect(first.result.report.entries[0].detail).toContain('core-1.0.1.jar')
    expect(first.requests.some((url) => url.endsWith('.module') || url.includes('evil'))).toBe(
      false
    )

    // 고정 해시가 없는 버전: 처음 받을 때 .module이 없었고, 캐시를 지운 뒤 .module이 생겼다
    const unpinned = 'com.acmerobotics.roadrunner:core:1.0.0'
    const goodJar = makeJar(['com/acmerobotics/roadrunner/Pose2d'])
    publish(routes, BROTT, unpinned, 'core-1.0.0.pom', pom({ coordinate: unpinned, marker: true }))
    publish(routes, BROTT, unpinned, 'core-1.0.0.jar', goodJar)
    const gradle = project([dep(unpinned)], repositories)
    const before = await run(gradle, routes)
    expect(statuses(before.result.report.entries)).toEqual([`${unpinned} used`])
    await rm(join(cacheDir, 'index'), { recursive: true })
    await rm(join(cacheDir, 'resolutions'), { recursive: true })
    plant(unpinned)
    const after = await run(gradle, routes)
    expect(statuses(after.result.report.entries)).toEqual([`${unpinned} used`])
    expect(after.result.report.entries[0].integrity).toBe('firstUse')
    expect(after.requests.some((url) => url.endsWith('.module') || url.includes('evil'))).toBe(
      false
    )
    expect(await Promise.all(after.result.libraryClasspath.map((p) => readFile(p)))).toEqual([
      goodJar
    ])
  })

  it('한 저장소에 닿지 못하거나(연결 끊김) 서버 오류여도 다른 저장소의 파일은 받는다', async () => {
    const ftclib = 'org.ftclib.ftclib:core:2.1.1'
    const rr = 'com.acmerobotics.roadrunner:core:1.0.1'
    for (const failure of [new Error('net::ERR_CONNECTION_RESET'), { status: 503 }] as Route[]) {
      await rm(cacheDir, { recursive: true, force: true })
      const routes = new Map<string, Route>()
      publish(routes, CENTRAL, ftclib, 'core-2.1.1.pom', pom({ coordinate: ftclib }))
      publish(routes, CENTRAL, ftclib, 'core-2.1.1.jar', makeJar(['com/arcrobotics/ftclib/X']))
      routes.set(artifactUrl(BROTT, rr, 'core-1.0.1.pom'), failure)
      const { result } = await run(
        project([dep(rr), dep(ftclib)], [repo('mavenCentral'), BROTT_REPOSITORY]),
        routes
      )
      expect(statuses(result.report.entries)).toEqual([`${rr} failed:offline`, `${ftclib} used`])
      // 실패의 자세히는 그 저장소의 주소
      expect(result.report.entries[0].detail).toContain(BROTT)
    }
  })

  it('동시에 받은 maven.brott.dev 파일의 처음 받은 해시를 모두 기록한다', async () => {
    const routes = new Map<string, Route>()
    const coordinates = [
      'com.acmerobotics.roadrunner:core:1.0.0',
      'com.acmerobotics.roadrunner:actions:1.0.0',
      'com.acmerobotics.roadrunner:ftc:0.1.21'
    ]
    const expected: Record<string, string> = {}
    for (const coordinate of coordinates) {
      const [, artifact, version] = coordinate.split(':')
      for (const [file, bytes] of [
        [`${artifact}-${version}.pom`, Buffer.from(pom({ coordinate }))],
        [`${artifact}-${version}.jar`, makeJar([`com/acmerobotics/roadrunner/${artifact}/X`])]
      ] as const) {
        publish(routes, BROTT, coordinate, file, bytes)
        expected[`${coordinate}/${file}`] = hex('sha256', bytes)
      }
    }
    const { result } = await run(
      project(
        coordinates.map((c) => dep(c)),
        [BROTT_REPOSITORY]
      ),
      {},
      { http: delayed(fakeHttp(routes)) }
    )
    expect(result.report.entries.map((e) => `${e.status} ${e.integrity}`)).toEqual(
      coordinates.map(() => 'used firstUse')
    )
    expect(JSON.parse(await readFile(join(cacheDir, 'first-use.json'), 'utf8'))).toEqual(expected)
  })

  it('캐시 기록(색인·jar 목록·잠금)을 쓰지 못해도 받은 파일로 해석을 끝낸다', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const gradle = project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')])
    const first = await run(gradle, routes)
    // 잠금 자리에 바꿀 수 없는 폴더가 생겼다: 새로 해석하고(캐시로) 잠금은 쓰지 못한다
    const [lock] = await readdir(join(cacheDir, 'resolutions'))
    await rm(join(cacheDir, 'resolutions', lock))
    await mkdir(join(cacheDir, 'resolutions', lock, 'busy'), { recursive: true })
    const second = await run(gradle, {}, { http: noNetwork() })
    expect(statuses(second.result.report.entries)).toEqual(statuses(first.result.report.entries))
    expect(second.result.compileClasspath).toEqual(first.result.compileClasspath)
    // 색인·jar 목록 폴더 자리에 파일이 있다(쓸 수 없다)
    await rm(cacheDir, { recursive: true, force: true })
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'index'), '')
    await writeFile(join(cacheDir, 'jars'), '')
    const third = await run(gradle, routes)
    expect(statuses(third.result.report.entries)).toEqual(statuses(first.result.report.entries))
    expect(third.result.compileClasspath).toEqual(first.result.compileClasspath)
    for (const path of third.result.compileClasspath)
      expect((await readFile(path)).length).toBeGreaterThan(0)
  })

  it('200으로 온 잘못된 내용(차단 페이지)은 캐시에도 처음 받은 기록에도 넣지 않는다(고치면 다시 받는다)', async () => {
    const block = '<html>Blocked by the school web filter</html>'
    // maven.brott.dev(체크섬 없음)의 jar가 차단 페이지
    const rr = 'com.acmerobotics.roadrunner:core:1.0.0'
    const routes = new Map<string, Route>()
    publish(routes, BROTT, rr, 'core-1.0.0.pom', pom({ coordinate: rr }))
    publish(routes, BROTT, rr, 'core-1.0.0.jar', block)
    const brott = project([dep(rr)], [BROTT_REPOSITORY])
    expect(statuses((await run(brott, routes)).result.report.entries)).toEqual([
      `${rr} failed:badArchive`
    ])
    const recorded = async (): Promise<string[]> =>
      Object.keys(JSON.parse(await readFile(join(cacheDir, 'first-use.json'), 'utf8')))
    expect(await recorded()).toEqual([`${rr}/core-1.0.0.pom`])
    publish(routes, BROTT, rr, 'core-1.0.0.jar', makeJar(['com/acmerobotics/roadrunner/Pose2d']))
    const fixed = await run(brott, routes)
    expect(statuses(fixed.result.report.entries)).toEqual([`${rr} used`])
    expect(fixed.requests).toContain(artifactUrl(BROTT, rr, 'core-1.0.0.jar'))

    // Maven Central: POM과 그 .sha1이 모두 차단 페이지(확인하지 못한 파일은 처음 받은 것으로 보지 않는다)
    const ftclib = 'org.ftclib.ftclib:core:2.1.1'
    const central = new Map<string, Route>()
    central.set(artifactUrl(CENTRAL, ftclib, 'core-2.1.1.pom'), block)
    central.set(`${artifactUrl(CENTRAL, ftclib, 'core-2.1.1.pom')}.sha1`, block)
    const gradle = project([dep(ftclib)])
    expect(statuses((await run(gradle, central)).result.report.entries)).toEqual([
      `${ftclib} failed:checksumMismatch`
    ])
    publish(central, CENTRAL, ftclib, 'core-2.1.1.pom', pom({ coordinate: ftclib }))
    publish(central, CENTRAL, ftclib, 'core-2.1.1.jar', makeJar(['com/arcrobotics/ftclib/X']))
    expect(statuses((await run(gradle, central)).result.report.entries)).toEqual([`${ftclib} used`])
    expect(await recorded()).not.toContain(`${ftclib}/core-2.1.1.pom`)
  })

  it('체크섬 파일은 파일 이름이 붙은 꼴과 오래된 OpenSSL 꼴도 읽는다', async () => {
    const ftclib = 'org.ftclib.ftclib:core:2.1.1'
    const pomText = pom({ coordinate: ftclib })
    const jar = makeJar(['com/arcrobotics/ftclib/X'])
    const routes = new Map<string, Route>()
    const pomUrl = artifactUrl(CENTRAL, ftclib, 'core-2.1.1.pom')
    const jarUrl = artifactUrl(CENTRAL, ftclib, 'core-2.1.1.jar')
    routes.set(pomUrl, pomText)
    routes.set(`${pomUrl}.sha1`, `SHA1(core-2.1.1.pom)= ${hex('sha1', pomText)}\n`)
    routes.set(jarUrl, jar)
    routes.set(`${jarUrl}.sha1`, `${hex('sha1', jar).toUpperCase()}  core-2.1.1.jar\n`)
    const { result } = await run(project([dep(ftclib)]), routes)
    expect(statuses(result.report.entries)).toEqual([`${ftclib} used`])
    expect(result.report.entries[0].integrity).toBe('checksum')
  })

  it('응답이 멈추면 시간 제한 뒤 거울로, 거울이 없으면 그 좌표만 offline이고 INIT을 붙잡지 않는다', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const repository = fakeHttp(routes)
    const http: LibraryDeps['http'] = async (url, options) => {
      // Google(androidx.annotation)은 응답 머리글을 보내지 않는다
      if (url.startsWith(GOOGLE)) return new Promise<never>(() => undefined)
      // Maven Central 본 주소는 머리글 뒤 본문이 멈추고, 거울은 같은 내용을 준다
      if (url.startsWith(CENTRAL)) return { status: 200, header: () => null, body: stalledBody() }
      return repository(url.replace(MIRROR, CENTRAL), options)
    }
    const { result } = await run(
      project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')]),
      {},
      { http, timeouts: { requestMs: 20, idleMs: 20 } }
    )
    expect(statuses(result.report.entries)).toEqual([
      'org.firstinspires.ftc:RobotCore:12.0.0 provided',
      'androidx.appcompat:appcompat:1.2.0 provided',
      'com.pedropathing:revhub:3.0.2 used',
      'androidx.annotation:annotation:1.1.0 failed:offline',
      'com.pedropathing:core:3.0.2 used',
      'org.jetbrains.kotlin:kotlin-stdlib:2.3.21 used',
      'org.jetbrains:annotations:13.0 used'
    ])
    expect(result.report.entries[3].detail).toContain(GOOGLE)
  })

  it('Maven Central 본 주소가 429면 .sha256이 없는 파일(.sha1만)도 거울의 .sha1로 확인한다', async () => {
    const routes = new Map<string, Route>()
    publishPedro(routes)
    const repository = fakeHttp(routes)
    const http: LibraryDeps['http'] = async (url, options) => {
      if (url.startsWith(CENTRAL))
        return {
          status: 429,
          header: () => null,
          body: (async function* () {
            // 429는 본문을 보지 않는다
          })()
        }
      return repository(url.replace(MIRROR, CENTRAL), options)
    }
    const { result } = await run(
      project([...FTC_TEMPLATE(), dep('com.pedropathing:revhub:3.0.2')]),
      {},
      { http }
    )
    expect(statuses(result.report.entries)).toContain('org.jetbrains:annotations:13.0 used')
    const annotations = result.report.entries.find((e) => e.artifact === 'annotations')
    expect(annotations?.integrity).toBe('checksum')
  })

  it('처음 받은 해시를 기록하지 못하면 이번에는 쓰되 캐시·잠금에 넣지 않고 알리며, 다음 INIT에 다시 받아 기록한다', async () => {
    const rr = 'com.acmerobotics.roadrunner:core:1.0.0'
    const pomText = pom({ coordinate: rr })
    const jar = makeJar(['com/acmerobotics/roadrunner/Pose2d'])
    const routes = new Map<string, Route>()
    publish(routes, BROTT, rr, 'core-1.0.0.pom', pomText)
    publish(routes, BROTT, rr, 'core-1.0.0.jar', jar)
    const gradle = project([dep(rr)], [BROTT_REPOSITORY])
    const files = [
      artifactUrl(BROTT, rr, 'core-1.0.0.pom'),
      artifactUrl(BROTT, rr, 'core-1.0.0.jar')
    ]

    blockFirstUseWrite = true
    const blocked = await run(gradle, routes)
    const [entry] = blocked.result.report.entries
    // 기록했다고 하지 않는다(세부에 이유)
    expect(`${entry.status} ${entry.integrity}`).toBe('used firstUseUnrecorded')
    expect(entry.detail).toContain('first-use.json')
    expect(entry.detail).toContain('EPERM')
    expect(await Promise.all(blocked.result.libraryClasspath.map((p) => readFile(p)))).toEqual([
      jar
    ])
    await expect(readFile(join(cacheDir, 'first-use.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    // 믿는 캐시 항목(색인)도 잠금도 없다
    expect(await readdir(join(cacheDir, 'index')).catch(() => [])).toEqual([])
    expect(await readdir(join(cacheDir, 'resolutions')).catch(() => [])).toEqual([])

    // 다음 INIT: 다시 받아 기록한다
    blockFirstUseWrite = false
    const retried = await run(gradle, routes)
    expect(retried.requests).toEqual(expect.arrayContaining(files))
    expect(`${retried.result.report.entries[0].integrity}`).toBe('firstUse')
    expect(retried.result.report.entries[0].detail).toBe('')
    expect(JSON.parse(await readFile(join(cacheDir, 'first-use.json'), 'utf8'))).toEqual({
      [`${rr}/core-1.0.0.pom`]: hex('sha256', pomText),
      [`${rr}/core-1.0.0.jar`]: hex('sha256', jar)
    })
    expect(await readdir(join(cacheDir, 'resolutions'))).toHaveLength(1)
    // 그다음은 잠금으로 네트워크 없이
    expect((await run(gradle, {}, { http: noNetwork() })).result.report.entries[0].integrity).toBe(
      'firstUse'
    )
    // 이제 기록이 지킨다: 캐시를 지운 뒤 저장소가 다른 jar를 주면 거부
    await rm(join(cacheDir, 'index'), { recursive: true })
    await rm(join(cacheDir, 'resolutions'), { recursive: true })
    publish(routes, BROTT, rr, 'core-1.0.0.jar', makeJar(['evil/Payload']))
    expect(statuses((await run(gradle, routes)).result.report.entries)).toEqual([
      `${rr} failed:checksumMismatch`
    ])
  })

  it('기록하는 사이 다른 해시가 먼저 기록되었으면 checksumMismatch, 기록을 다시 읽지 못하면 기록하지 못한 것', async () => {
    const rr = 'com.acmerobotics.roadrunner:core:1.0.0'
    const routes = new Map<string, Route>()
    publish(routes, BROTT, rr, 'core-1.0.0.pom', pom({ coordinate: rr }))
    publish(routes, BROTT, rr, 'core-1.0.0.jar', makeJar(['com/acmerobotics/roadrunner/Pose2d']))
    const gradle = project([dep(rr)], [BROTT_REPOSITORY])
    const record = vi
      .spyOn(LibraryCache.prototype, 'recordFirstUse')
      .mockResolvedValue('0'.repeat(64))
    const conflict = await run(gradle, routes)
    expect(statuses(conflict.result.report.entries)).toEqual([`${rr} failed:checksumMismatch`])
    expect(await readdir(join(cacheDir, 'index')).catch(() => [])).toEqual([])
    // 기록 안에서 다시 읽다 잠김(EBUSY): 이번에는 쓰고 기록하지 못했다고 알린다
    record.mockRejectedValue(
      Object.assign(new Error('EBUSY: resource busy or locked, open first-use.json'), {
        code: 'EBUSY'
      })
    )
    const busy = await run(gradle, routes)
    expect(busy.result.report.entries.map((e) => `${e.status} ${e.integrity}`)).toEqual([
      'used firstUseUnrecorded'
    ])
    expect(busy.result.report.entries[0].detail).toContain('EBUSY')
    expect(await readdir(join(cacheDir, 'index')).catch(() => [])).toEqual([])
    expect(await readdir(join(cacheDir, 'resolutions')).catch(() => [])).toEqual([])
  })

  it('확인한 파일(체크섬·Gradle 캐시)과 내용을 확인한 처음 받은 파일은 정책·읽기가 거부해도 캐시에 넣는다: 다음 INIT은 네트워크 없이 같은 이유로', async () => {
    const routes = new Map<string, Route>()
    // Maven Central(체크섬과 맞음): jni가 든 AAR, 보호 패키지가 든 jar, 다른 좌표를 적은 POM
    const ftclib = 'org.ftclib.ftclib:core:2.1.1'
    publish(
      routes,
      CENTRAL,
      ftclib,
      'core-2.1.1.pom',
      pom({ coordinate: ftclib, packaging: 'aar' })
    )
    publish(
      routes,
      CENTRAL,
      ftclib,
      'core-2.1.1.aar',
      makeAar(['com/arcrobotics/ftclib/X'], [{ name: 'jni/arm64-v8a/libx.so', data: 'elf' }])
    )
    const pedro = 'com.pedropathing:core:3.0.0'
    publish(routes, CENTRAL, pedro, 'core-3.0.0.pom', pom({ coordinate: pedro }))
    publish(routes, CENTRAL, pedro, 'core-3.0.0.jar', makeJar(['com/qualcomm/robotcore/X']))
    const revhub = 'com.pedropathing:revhub:3.0.0'
    publish(
      routes,
      CENTRAL,
      revhub,
      'revhub-3.0.0.pom',
      pom({ coordinate: 'com.pedropathing:other:3.0.0' })
    )
    // maven.brott.dev(처음 받음): 읽을 수 있는 jar지만 보호 패키지가 들었다
    const rr = 'com.acmerobotics.roadrunner:core:1.0.0'
    publish(routes, BROTT, rr, 'core-1.0.0.pom', pom({ coordinate: rr }))
    publish(routes, BROTT, rr, 'core-1.0.0.jar', makeJar(['java/lang/Evil']))
    // Gradle 캐시에만 있다(Maven Central 것이라 Gradle이 확인함)
    const ivy = 'com.pedropathing.ivy:ivy:1.0.0'
    await putGradleCache(gradleHome, ivy, 'ivy-1.0.0.pom', pom({ coordinate: ivy }))
    await putGradleCache(gradleHome, ivy, 'ivy-1.0.0.jar', makeJar(['org/sandbot/sim/X']))
    const gradle = project(
      [dep(ftclib), dep(pedro), dep(revhub), dep(rr), dep(ivy)],
      [repo('mavenCentral'), BROTT_REPOSITORY]
    )
    const expected = [
      `${ftclib} failed:badArchive`,
      `${pedro} failed:protectedPackage`,
      `${revhub} failed:badMetadata`,
      `${rr} failed:protectedPackage`,
      `${ivy} failed:protectedPackage`
    ]
    const first = await run(gradle, routes)
    expect(statuses(first.result.report.entries)).toEqual(expected)
    expect(
      Object.keys(JSON.parse(await readFile(join(cacheDir, 'first-use.json'), 'utf8')))
    ).toEqual(expect.arrayContaining([`${rr}/core-1.0.0.pom`, `${rr}/core-1.0.0.jar`]))
    // 네트워크도 Gradle 캐시도 없이 같은 이유(offline이 아니다)
    await rm(gradleHome, { recursive: true, force: true })
    const again = await run(gradle, {}, { http: noNetwork() })
    expect(statuses(again.result.report.entries)).toEqual(expected)
    expect(again.result.report.entries[0].detail).toContain('jni')
  })

  it('체크섬을 주는 저장소에서 200으로 온 차단 페이지는 체크섬이 거부하고, 체크섬 파일도 없으면 읽어 보고 거부한다(남기지 않는다)', async () => {
    const block = '<html>Blocked by the school web filter</html>'
    const ftclib = 'org.ftclib.ftclib:core:2.1.1'
    const realJar = makeJar(['com/arcrobotics/ftclib/X'])
    const jarUrl = artifactUrl(CENTRAL, ftclib, 'core-2.1.1.jar')
    const routes = new Map<string, Route>()
    publish(routes, CENTRAL, ftclib, 'core-2.1.1.pom', pom({ coordinate: ftclib }))
    // 체크섬은 진짜 jar의 것, jar 주소만 차단 페이지
    publish(routes, CENTRAL, ftclib, 'core-2.1.1.jar', realJar)
    routes.set(jarUrl, block)
    const gradle = project([dep(ftclib)])
    expect(statuses((await run(gradle, routes)).result.report.entries)).toEqual([
      `${ftclib} failed:checksumMismatch`
    ])
    // 체크섬 파일이 없다(404): 처음 받은 것이지만 jar로 읽을 수 없어 기록·캐시하지 않는다
    routes.delete(`${jarUrl}.sha1`)
    routes.delete(`${jarUrl}.sha256`)
    expect(statuses((await run(gradle, routes)).result.report.entries)).toEqual([
      `${ftclib} failed:badArchive`
    ])
    const recorded = Object.keys(
      JSON.parse(await readFile(join(cacheDir, 'first-use.json'), 'utf8').catch(() => '{}'))
    )
    expect(recorded).not.toContain(`${ftclib}/core-2.1.1.jar`)
    // 고쳐지면 다시 받는다
    routes.set(jarUrl, realJar)
    const fixed = await run(gradle, routes)
    expect(statuses(fixed.result.report.entries)).toEqual([`${ftclib} used`])
    expect(fixed.requests).toContain(jarUrl)
  })
})
