import { describe, expect, it } from 'vitest'
import { readGradleProject, type GradleProject } from '.'
import { fixtureSource } from './testSupport'

// 말뭉치(__fixtures__): FTC 12.0 템플릿(FtcRobotController v12.0, e14c2aeb), Road Runner quickstart(master),
// Pedro Pathing 3 quickstart(master 9dc8978)의 실제 Gradle 파일, FTCLib 설치 안내 줄, 팀 변형.

function deps(project: GradleProject): string[] {
  return project.dependencies.map((d) => {
    const extra = [
      d.classifier ? `classifier=${d.classifier}` : '',
      d.extension ? `@${d.extension}` : '',
      d.transitive ? '' : 'intransitive',
      ...d.excludes.map((x) => `exclude ${x.group ?? '*'}:${x.module ?? '*'}`)
    ].filter(Boolean)
    return `${d.configuration} ${d.group}:${d.artifact}:${d.version}${extra.length ? ` [${extra.join(', ')}]` : ''} @${d.at.file}:${d.at.line}`
  })
}

function repos(project: GradleProject): string[] {
  return project.repositories.map(
    (r) => `${r.kind}${r.url ? ` ${r.url}` : ''} @${r.at.file}:${r.at.line}`
  )
}

function diags(project: GradleProject): string[] {
  return project.diagnostics.map((d) => `${d.code} @${d.at.file}:${d.at.line}`)
}

const FTC_SDK = (version: string, file: string, first: number): string[] =>
  [
    'Inspection',
    'Blocks',
    'RobotCore',
    'RobotServer',
    'OnBotJava',
    'Hardware',
    'FtcCommon',
    'Vision'
  ]
    .map(
      (name, i) => `implementation org.firstinspires.ftc:${name}:${version} @${file}:${first + i}`
    )
    .concat(`implementation androidx.appcompat:appcompat:1.2.0 @${file}:${first + 8}`)

describe('FTC 템플릿과 quickstart', () => {
  it('FTC 12.0 템플릿: TeamCode가 apply from 하는 build.dependencies.gradle의 SDK 의존성과 build.common.gradle의 compileSdk', async () => {
    const project = await readGradleProject(fixtureSource('ftc12'))
    expect(deps(project)).toEqual(FTC_SDK('12.0.0', 'build.dependencies.gradle', 7))
    // 루트의 allprojects 저장소는 TeamCode에 적용되고, buildscript·루트 자신의 repositories는 아니다
    expect(repos(project)).toEqual([
      'mavenCentral @build.gradle:24',
      'google @build.gradle:25',
      'mavenCentral @build.dependencies.gradle:2',
      'google @build.dependencies.gradle:3'
    ])
    expect(project.compileSdk).toBe(30)
    // project(':FtcRobotController')는 조용히 넘기고, build.common.gradle의 Groovy 코드(서명 설정 등)는 보지 않는다
    expect(project.diagnostics).toEqual([])
    expect(project.files).toEqual([
      'gradle.properties',
      'settings.gradle',
      'build.gradle',
      'TeamCode/build.gradle',
      'build.common.gradle',
      'build.dependencies.gradle'
    ])
  })

  it('Road Runner quickstart: TeamCode/build.gradle의 brott 저장소와 네 줄', async () => {
    const project = await readGradleProject(fixtureSource('rr-quickstart'))
    expect(deps(project)).toEqual([
      ...FTC_SDK('11.0.0', 'build.dependencies.gradle', 7),
      'implementation com.acmerobotics.roadrunner:ftc:0.1.25 @TeamCode/build.gradle:35',
      'implementation com.acmerobotics.roadrunner:core:1.0.1 @TeamCode/build.gradle:36',
      'implementation com.acmerobotics.roadrunner:actions:1.0.1 @TeamCode/build.gradle:37',
      'implementation com.acmerobotics.dashboard:dashboard:0.5.1 @TeamCode/build.gradle:38'
    ])
    expect(repos(project)).toContain('maven https://maven.brott.dev/ @TeamCode/build.gradle:28')
    expect(project.compileSdk).toBe(30)
    expect(project.diagnostics).toEqual([])
  })

  it('Pedro Pathing 3 quickstart: build.dependencies.gradle의 dairy 저장소와 revhub·tuning, compileSdk 34', async () => {
    const project = await readGradleProject(fixtureSource('pedro3-quickstart'))
    expect(deps(project)).toEqual([
      ...FTC_SDK('12.0.0', 'build.dependencies.gradle', 8),
      'implementation com.pedropathing:revhub:3.0.2 @build.dependencies.gradle:18',
      'implementation com.pedropathing:tuning:1.0.1 @build.dependencies.gradle:19'
    ])
    expect(repos(project)).toEqual([
      'mavenCentral @build.gradle:24',
      'google @build.gradle:25',
      'mavenCentral @build.dependencies.gradle:2',
      'maven https://repo.dairy.foundation/releases/ @build.dependencies.gradle:3',
      'google @build.dependencies.gradle:4'
    ])
    expect(project.compileSdk).toBe(34)
    expect(project.diagnostics).toEqual([])
  })

  it('FTCLib 안내 줄(TeamCode/build.gradle)', async () => {
    const project = await readGradleProject(fixtureSource('ftclib'))
    expect(deps(project).slice(-2)).toEqual([
      'implementation org.ftclib.ftclib:core:2.1.1 @TeamCode/build.gradle:22',
      'implementation org.ftclib.ftclib:vision:2.1.0 @TeamCode/build.gradle:23'
    ])
    expect(project.diagnostics).toEqual([])
  })
})

describe('팀 변형', () => {
  it('Groovy: 큰따옴표, ext·gradle.properties·def 값, map 형식, exclude 클로저, 동적 버전, 로컬 모듈, 원격·밖 스크립트', async () => {
    const project = await readGradleProject(fixtureSource('team-groovy'))
    expect(deps(project)).toEqual([
      'implementation org.firstinspires.ftc:RobotCore:12.0.0 @build.dependencies.gradle:7',
      'implementation org.firstinspires.ftc:Hardware:12.0.0 @build.dependencies.gradle:8',
      'implementation org.firstinspires.ftc:FtcCommon:12.0.0 @build.dependencies.gradle:9',
      'implementation androidx.appcompat:appcompat:1.2.0 @build.dependencies.gradle:10',
      // gradle.properties
      'implementation com.pedropathing:core:3.0.2 @TeamCode/build.gradle:32',
      // 루트 ext { }
      'implementation com.acmerobotics.roadrunner:core:1.0.1 @TeamCode/build.gradle:33',
      // 루트 buildscript { ext.kotlin_version }
      'implementation org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0 @TeamCode/build.gradle:34',
      // "$versions.dash"(Groovy 점 경로 보간, ext의 맵)
      'implementation com.acmerobotics.dashboard:dashboard:0.4.16 @TeamCode/build.gradle:35',
      'implementation org.ejml:ejml-simple:0.39 @TeamCode/build.gradle:36',
      'implementation org.ftclib.ftclib:core:2.1.1 [intransitive, exclude org.firstinspires.ftc:*, exclude *:core-ktx] @TeamCode/build.gradle:37',
      // 같은 파일의 def
      'implementation com.example:local:1.2.0 @TeamCode/build.gradle:42',
      // 확장자가 있으면 Gradle처럼 전이 의존성을 끈다
      'compileOnly com.example:annotations:1.0 [@jar, intransitive] @TeamCode/build.gradle:43',
      'runtimeOnly com.example:native:2.0 [classifier=linux-x86_64, @zip, intransitive] @TeamCode/build.gradle:44',
      // 동적 버전은 글자 그대로(해석기가 거부한다)
      'implementation com.acmerobotics.roadrunner:actions:+ @TeamCode/build.gradle:45'
    ])
    expect(repos(project)).toEqual([
      'mavenCentral @settings.gradle:12',
      'maven https://jitpack.io @settings.gradle:13',
      'mavenCentral @build.gradle:28',
      'google @build.gradle:29',
      'maven https://maven.brott.dev/ @build.gradle:30',
      'mavenCentral @build.dependencies.gradle:2',
      'google @build.dependencies.gradle:3',
      'maven https://maven.pedropathing.com/ @TeamCode/build.gradle:20',
      'maven https://mymaven.bylazar.com/releases @TeamCode/build.gradle:22',
      'flatDir @TeamCode/build.gradle:24',
      'jcenter @TeamCode/build.gradle:25'
    ])
    expect(diags(project)).toEqual([
      'remoteScript @TeamCode/build.gradle:9',
      'outsideProject @TeamCode/build.gradle:10',
      'missingFile @TeamCode/build.gradle:11',
      // annotationProcessor는 실행하지 않는다
      'unsupportedSyntax @TeamCode/build.gradle:30',
      'unresolvedValue @TeamCode/build.gradle:46',
      'localDependency @TeamCode/build.gradle:47',
      'localDependency @TeamCode/build.gradle:48',
      'localDependency @TeamCode/build.gradle:49',
      // debugImplementation
      'unsupportedSyntax @TeamCode/build.gradle:51',
      // if 안의 의존성
      'unsupportedSyntax @TeamCode/build.gradle:52'
    ])
    expect(project.diagnostics[0].detail).toBe(
      'https://raw.githubusercontent.com/example/ftc/main/shared.gradle'
    )
    expect(project.diagnostics[4].detail).toBe(
      `"com.example:mystery:$unknownVersion": unknown name 'unknownVersion'`
    )
    expect(project.diagnostics[9].detail).toMatch(/^declarations inside 'if' are not read/)
    expect(project.compileSdk).toBe(30)
  })

  it('버전 카탈로그: libs.x·libs.bundles.x·libs.versions.x.get(), 없는 별칭·ref·strictly는 진단', async () => {
    const project = await readGradleProject(fixtureSource('team-catalog'))
    expect(deps(project)).toEqual([
      'implementation com.pedropathing:core:3.0.2 @TeamCode/build.gradle:10',
      'implementation com.pedropathing:revhub:3.0.2 @TeamCode/build.gradle:10',
      'implementation org.ftclib.ftclib:core:2.1.1 @TeamCode/build.gradle:11',
      'implementation com.pedropathing.ivy:core:1.1.1 @TeamCode/build.gradle:12',
      'implementation com.pedropathing.ivy:pedro:1.1.1 @TeamCode/build.gradle:13'
    ])
    expect(diags(project)).toEqual([
      'versionCatalogEntry @TeamCode/build.gradle:14',
      'versionCatalogEntry @TeamCode/build.gradle:15',
      'versionCatalogEntry @TeamCode/build.gradle:16'
    ])
    // build.common.gradle의 30을 TeamCode의 android { compileSdk libs.versions.compileSdk.get().toInteger() }가 덮는다
    expect(project.compileSdk).toBe(34)
    expect(project.files).toContain('gradle/libs.versions.toml')
  })

  it('Kotlin DSL: settings.gradle.kts의 저장소, val·extra, exclude(group =), kotlin(…), "implementation"(…)', async () => {
    const project = await readGradleProject(fixtureSource('team-kts'))
    expect(deps(project)).toEqual([
      'implementation com.pedropathing.ivy:core:1.1.1 @deps.gradle.kts:3',
      'implementation com.acmerobotics.roadrunner:core:1.0.1 @TeamCode/build.gradle.kts:28',
      'implementation com.pedropathing:revhub:3.0.2 @TeamCode/build.gradle.kts:29',
      'implementation org.ftclib.ftclib:core:2.1.1 [intransitive, exclude org.firstinspires.ftc:*] @TeamCode/build.gradle.kts:30',
      'implementation org.ejml:ejml-simple:0.39 @TeamCode/build.gradle.kts:34',
      'compileOnly org.jetbrains.kotlin:kotlin-stdlib:1.9.0 @TeamCode/build.gradle.kts:35'
    ])
    expect(repos(project)).toEqual([
      'mavenCentral @settings.gradle.kts:11',
      'google @settings.gradle.kts:12',
      'maven https://repo.dairy.foundation/releases/ @settings.gradle.kts:13',
      'maven https://maven.brott.dev/ @TeamCode/build.gradle.kts:18',
      'maven https://mymaven.bylazar.com/releases @TeamCode/build.gradle.kts:20'
    ])
    expect(diags(project)).toEqual(['localDependency @TeamCode/build.gradle.kts:36'])
    expect(project.compileSdk).toBe(34)
  })

  it('같은 입력이면 결과가 같다(결정적)', async () => {
    for (const name of ['ftc12', 'team-groovy', 'team-catalog', 'team-kts']) {
      const first = JSON.stringify(await readGradleProject(fixtureSource(name)))
      const second = JSON.stringify(await readGradleProject(fixtureSource(name)))
      expect(second).toBe(first)
    }
  })
})
