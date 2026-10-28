import { describe, expect, it } from 'vitest'
import {
  MAX_APPLY_DEPTH,
  MAX_GRADLE_FILE_BYTES,
  MAX_GRADLE_FILES,
  readGradleProject,
  type GradleProject
} from '.'
import { memorySource, type MemoryFiles } from './testSupport'

const TEAMCODE = 'TeamCode/build.gradle'

function read(files: MemoryFiles): Promise<GradleProject> {
  return readGradleProject(memorySource(files))
}

// TeamCode/build.gradle의 dependencies { } 안에 lines를 넣어 읽는다
function readDeps(lines: string, extra: MemoryFiles = {}): Promise<GradleProject> {
  return read({ [TEAMCODE]: `dependencies {\n${lines}\n}\n`, ...extra })
}

function coords(project: GradleProject): string[] {
  return project.dependencies.map((d) => `${d.configuration} ${d.group}:${d.artifact}:${d.version}`)
}

function codes(project: GradleProject): string[] {
  return project.diagnostics.map((d) => d.code)
}

describe('파일 찾기', () => {
  it('Gradle 파일이 없으면 빈 결과이고 진단도 없다(시험 프로젝트)', async () => {
    const source = memorySource({})
    const project = await readGradleProject(source)
    expect(project).toEqual({
      dependencies: [],
      repositories: [],
      compileSdk: null,
      diagnostics: [],
      files: []
    })
    expect(source.requested).toEqual([
      'gradle.properties',
      'TeamCode/gradle.properties',
      'settings.gradle',
      'settings.gradle.kts',
      'gradle/libs.versions.toml',
      'build.gradle',
      'build.gradle.kts',
      'TeamCode/build.gradle',
      'TeamCode/build.gradle.kts'
    ])
  })

  it('.gradle과 .gradle.kts가 둘 다 있으면 .gradle만 읽는다', async () => {
    const project = await read({
      [TEAMCODE]: "dependencies { implementation 'a:groovy:1' }",
      'TeamCode/build.gradle.kts': 'dependencies { implementation("a:kotlin:1") }'
    })
    expect(coords(project)).toEqual(['implementation a:groovy:1'])
  })

  it('파일 문제: 큰 파일·밖을 가리키는 링크·읽기 오류는 진단으로 남기고 계속한다', async () => {
    const project = await read({
      'build.gradle': { problem: 'tooLarge' },
      'settings.gradle': { problem: 'outsideProject' },
      'gradle.properties': { problem: 'unreadable', detail: 'EACCES' },
      [TEAMCODE]: "dependencies { implementation 'a:b:1' }"
    })
    expect(coords(project)).toEqual(['implementation a:b:1'])
    expect(project.diagnostics).toEqual([
      {
        code: 'missingFile',
        at: { file: 'gradle.properties', line: 1 },
        detail: 'cannot read gradle.properties: EACCES'
      },
      {
        code: 'outsideProject',
        at: { file: 'settings.gradle', line: 1 },
        detail: 'settings.gradle links outside the project'
      },
      {
        code: 'tooLarge',
        at: { file: 'build.gradle', line: 1 },
        detail: 'build.gradle is larger than 256 KB'
      }
    ])
    // 문제가 있는 .gradle이 있으면 .gradle.kts로 넘어가지 않는다
    expect(project.files).toEqual([TEAMCODE])
  })

  it('소스가 준 글자도 한도를 넘으면 읽지 않는다', async () => {
    const big = `// ${'x'.repeat(MAX_GRADLE_FILE_BYTES)}\ndependencies { implementation 'a:b:1' }`
    const project = await read({ [TEAMCODE]: big })
    expect(project.dependencies).toEqual([])
    expect(codes(project)).toEqual(['tooLarge'])
  })

  it('읽기가 예외를 던져도 진단으로 남기고 계속한다', async () => {
    const project = await readGradleProject({
      read: (path) =>
        path === 'build.gradle'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(path === TEAMCODE ? "dependencies { implementation 'a:b:1' }" : null)
    })
    expect(coords(project)).toEqual(['implementation a:b:1'])
    expect(project.diagnostics).toEqual([
      {
        code: 'missingFile',
        at: { file: 'build.gradle', line: 1 },
        detail: 'cannot read build.gradle: boom'
      }
    ])
  })

  it('BOM과 CRLF 줄 끝에서도 줄 번호가 맞다', async () => {
    const project = await read({
      [TEAMCODE]:
        '\uFEFF// head\r\n\r\ndependencies {\r\n    implementation \'a:b:1\'\r\n\r\n    implementation "c:d:2"\r\n}\r\n'
    })
    expect(project.dependencies.map((d) => d.at.line)).toEqual([4, 6])
  })
})

describe('apply from', () => {
  it('적용하는 스크립트의 폴더 기준으로 풀고, rootDir·rootProject.file·역슬래시도 받는다', async () => {
    const project = await read({
      [TEAMCODE]: [
        "apply from: '../gradle/a.gradle'",
        'apply from: "$rootDir/gradle/b.gradle"',
        "apply from: rootProject.file('gradle/c.gradle')",
        'apply from: "${project.rootDir}/gradle/d.gradle"',
        "apply from: '..\\\\gradle\\\\e.gradle'",
        "apply from: 'local.gradle'"
      ].join('\n'),
      'gradle/a.gradle': "dependencies { implementation 'g:a:1' }\napply from: 'nested.gradle'",
      'gradle/nested.gradle': "dependencies { implementation 'g:nested:1' }",
      'gradle/b.gradle': "dependencies { implementation 'g:b:1' }",
      'gradle/c.gradle': "dependencies { implementation 'g:c:1' }",
      'gradle/d.gradle': "dependencies { implementation 'g:d:1' }",
      'gradle/e.gradle': "dependencies { implementation 'g:e:1' }",
      'TeamCode/local.gradle': "dependencies { implementation 'g:local:1' }"
    })
    expect(coords(project)).toEqual([
      'implementation g:a:1',
      'implementation g:nested:1',
      'implementation g:b:1',
      'implementation g:c:1',
      'implementation g:d:1',
      'implementation g:e:1',
      'implementation g:local:1'
    ])
    expect(project.diagnostics).toEqual([])
    expect(project.dependencies[1].at).toEqual({ file: 'gradle/nested.gradle', line: 1 })
  })

  it('원격·프로젝트 밖·절대 경로·이상한 이름·풀 수 없는 경로는 읽지 않고 알린다', async () => {
    const project = await read({
      [TEAMCODE]: [
        "apply from: 'https://example.com/x.gradle'",
        "apply from: 'http://example.com/x.gradle'",
        "apply from: '../../x.gradle'",
        "apply from: '/etc/x.gradle'",
        "apply from: 'C:/x.gradle'",
        "apply from: 'file:///etc/x.gradle'",
        "apply from: 'con.gradle'",
        "apply from: 'a:b.gradle'",
        'apply from: "$somewhere/x.gradle"',
        "apply from: 'none.gradle'"
      ].join('\n')
    })
    expect(project.diagnostics.map((d) => `${d.code}:${d.at.line}`)).toEqual([
      'remoteScript:1',
      'remoteScript:2',
      'outsideProject:3',
      'outsideProject:4',
      'outsideProject:5',
      'unsupportedSyntax:6',
      'unsupportedSyntax:7',
      // Windows의 드라이브 기준 경로(A: 드라이브)
      'outsideProject:8',
      'unresolvedValue:9',
      'missingFile:10'
    ])
  })

  it('순환과 너무 깊은 사슬은 tooDeep', async () => {
    const cycle = await read({
      [TEAMCODE]: "apply from: '../a.gradle'",
      'a.gradle': "apply from: 'b.gradle'",
      'b.gradle': "apply from: 'a.gradle'"
    })
    expect(cycle.diagnostics).toEqual([
      {
        code: 'tooDeep',
        at: { file: 'b.gradle', line: 1 },
        detail: 'apply from cycle: TeamCode/build.gradle -> a.gradle -> b.gradle -> a.gradle'
      }
    ])
    const files: MemoryFiles = { [TEAMCODE]: "apply from: '../s1.gradle'" }
    for (let i = 1; i <= MAX_APPLY_DEPTH + 2; i++)
      files[`s${i}.gradle`] =
        `dependencies { implementation 'g:s${i}:1' }\napply from: 's${i + 1}.gradle'`
    const deep = await read(files)
    // TeamCode/build.gradle + s1…s7 = 8단계
    expect(deep.dependencies).toHaveLength(MAX_APPLY_DEPTH - 1)
    expect(codes(deep)).toEqual(['tooDeep'])
  })

  it('읽는 파일 수에 한도가 있다', async () => {
    const files: MemoryFiles = {
      [TEAMCODE]: Array.from(
        { length: MAX_GRADLE_FILES + 5 },
        (_, i) => `apply from: '../f${i}.gradle'`
      ).join('\n')
    }
    for (let i = 0; i < MAX_GRADLE_FILES + 5; i++)
      files[`f${i}.gradle`] = `dependencies { implementation 'g:f${i}:1' }`
    const project = await read(files)
    // 기본 파일 8번의 읽기(없는 것 포함: TeamCode/build.gradle이 있어 .kts는 찾지 않음) 뒤 남은 한도만큼
    expect(project.dependencies).toHaveLength(MAX_GRADLE_FILES - 8)
    expect(project.diagnostics.every((d) => d.code === 'tooDeep')).toBe(true)
  })

  it('apply plugin은 넘기고 apply from … to:는 알린다', async () => {
    const project = await read({
      [TEAMCODE]:
        "apply plugin: 'com.android.application'\napply from: '../x.gradle', to: buildscript",
      'x.gradle': "dependencies { implementation 'g:x:1' }"
    })
    expect(project.dependencies).toEqual([])
    expect(codes(project)).toEqual(['unsupportedSyntax'])
  })
})

describe('값 풀기', () => {
  it('ext의 여러 표기와 gradle.properties, 우선순위(TeamCode의 ext > TeamCode/gradle.properties > 루트)', async () => {
    const project = await read({
      'gradle.properties': 'p1=root-props\np2=root-props\np3=root-props\np4=root-props',
      'TeamCode/gradle.properties': 'p2=module-props',
      'build.gradle':
        "ext.p3 = 'root-ext'\next { e1 = 'root-block' }\next.set('e2', 'root-set')\nproject.ext.e3 = 'root-project-ext'",
      [TEAMCODE]: [
        "ext.p4 = 'module-ext'",
        "rootProject.ext.e4 = 'from-module'",
        "ext['e5'] = 'indexed'",
        'dependencies {',
        '  implementation "g:a:$p1"',
        '  implementation "g:b:$p2"',
        '  implementation "g:c:$p3"',
        '  implementation "g:d:$p4"',
        '  implementation "g:e:$e1-$e2-$e3"',
        '  implementation "g:f:${rootProject.ext.e4}"',
        '  implementation "g:g:$rootProject.e1"',
        '  implementation "g:h:${ext.e5}"',
        "  implementation 'g:i:' + project.p1",
        '  implementation "g:j:${findProperty(\'p2\')}"',
        '  implementation "g:k:${property(\'p3\')}"',
        '}'
      ].join('\n')
    })
    expect(coords(project)).toEqual([
      'implementation g:a:root-props',
      'implementation g:b:module-props',
      'implementation g:c:root-ext',
      'implementation g:d:module-ext',
      'implementation g:e:root-block-root-set-root-project-ext',
      'implementation g:f:from-module',
      'implementation g:g:root-block',
      'implementation g:h:indexed',
      'implementation g:i:root-props',
      'implementation g:j:module-props',
      'implementation g:k:root-ext'
    ])
    expect(project.diagnostics).toEqual([])
  })

  it('def·val은 그 파일과 블록 안에서만 보인다', async () => {
    const project = await read({
      'build.gradle': "def rootLocal = '1'",
      [TEAMCODE]: [
        "def fileLocal = '2'",
        "apply from: '../other.gradle'",
        'android {',
        "  def blockLocal = '3'",
        '}',
        'dependencies {',
        '  implementation "g:a:$fileLocal"',
        '  implementation "g:b:$rootLocal"',
        '  implementation "g:c:$blockLocal"',
        '}'
      ].join('\n'),
      'other.gradle': 'dependencies { implementation "g:other:$fileLocal" }'
    })
    expect(coords(project)).toEqual(['implementation g:a:2'])
    expect(project.diagnostics.map((d) => `${d.code} ${d.at.file}:${d.at.line}`)).toEqual([
      'unresolvedValue other.gradle:1',
      'unresolvedValue TeamCode/build.gradle:8',
      'unresolvedValue TeamCode/build.gradle:9'
    ])
  })

  it('맵 ext와 속성 대입, + 이어 붙이기, toString·toInteger', async () => {
    const project = await read({
      'build.gradle':
        "ext.versions = [:]\nversions.rr = '1.0.1'\next.deps = [pedro: 'com.pedropathing:core:' + '3.0.2']",
      [TEAMCODE]: [
        'dependencies {',
        '  implementation "com.acmerobotics.roadrunner:core:${versions.rr}"',
        '  implementation deps.pedro',
        '  implementation rootProject.ext.deps["pedro"]',
        '}'
      ].join('\n')
    })
    expect(coords(project)).toEqual([
      'implementation com.acmerobotics.roadrunner:core:1.0.1',
      'implementation com.pedropathing:core:3.0.2',
      'implementation com.pedropathing:core:3.0.2'
    ])
    expect(project.diagnostics).toEqual([])
  })

  it('?:는 정의되지 않은 속성(findProperty가 null)일 때만 오른쪽을 쓴다', async () => {
    const project = await read({
      'gradle.properties': 'defined=9.9',
      [TEAMCODE]: [
        "def a = findProperty('missing') ?: '1.0'",
        "def b = findProperty('defined') ?: '1.0'",
        "def c = project.hasProperty('x') ? 'x' : 'y'",
        'dependencies {',
        '  implementation "g:a:$a"',
        '  implementation "g:b:$b"',
        '  implementation "g:c:$c"',
        '}'
      ].join('\n')
    })
    expect(coords(project)).toEqual(['implementation g:a:1.0', 'implementation g:b:9.9'])
    // 삼항은 풀지 않는다
    expect(project.diagnostics.map((d) => d.code)).toEqual(['unresolvedValue'])
  })

  it('providers.gradleProperty(…).get()은 gradle.properties만 본다', async () => {
    const project = await read({
      'gradle.properties': 'pedro=3.0.2',
      'TeamCode/build.gradle.kts': [
        'val pedro = providers.gradleProperty("pedro").get()',
        'val other = providers.gradleProperty("nope").getOrElse("1.0")',
        'dependencies {',
        '    implementation("com.pedropathing:core:$pedro")',
        '    implementation("g:other:$other")',
        '    implementation("g:missing:${providers.gradleProperty("nope").get()}")',
        '}'
      ].join('\n')
    })
    expect(coords(project)).toEqual([
      'implementation com.pedropathing:core:3.0.2',
      'implementation g:other:1.0'
    ])
    expect(codes(project)).toEqual(['unresolvedValue'])
  })

  it('환경 변수·메서드 호출·알 수 없는 이름은 추측하지 않는다', async () => {
    const project = await readDeps(
      [
        '  implementation "g:a:${System.getenv(\'V\')}"',
        '  implementation "g:b:${v.toUpperCase()}"',
        '  implementation "g:c:$nope"',
        '  implementation someList[0]'
      ].join('\n')
    )
    expect(project.dependencies).toEqual([])
    expect(codes(project)).toEqual([
      'unresolvedValue',
      'unresolvedValue',
      'unresolvedValue',
      'unresolvedValue'
    ])
    expect(project.diagnostics[2].detail).toBe(`"g:c:$nope": unknown name 'nope'`)
  })

  it('buildscript는 ext만 읽고 저장소·classpath는 읽지 않는다', async () => {
    const project = await read({
      'build.gradle': [
        'buildscript {',
        "  ext.kotlin_version = '1.9.0'",
        "  ext { other = '2' }",
        '  repositories { maven { url "https://plugins.example.com/" } }',
        '  dependencies { classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version" }',
        '}'
      ].join('\n'),
      [TEAMCODE]:
        'dependencies { implementation "org.jetbrains.kotlin:kotlin-stdlib:$kotlin_version:$other" }'
    })
    expect(project.repositories).toEqual([])
    expect(project.dependencies).toMatchObject([
      {
        group: 'org.jetbrains.kotlin',
        artifact: 'kotlin-stdlib',
        version: '1.9.0',
        classifier: '2'
      }
    ])
  })

  it("루트의 allprojects·subprojects·project(':TeamCode')는 TeamCode에, 다른 project(…)와 루트 자신의 블록은 아니다", async () => {
    const project = await read({
      'build.gradle': [
        "allprojects { ext.shared = '1'; repositories { mavenCentral() } }",
        "subprojects { dependencies { implementation 'g:sub:1' } }",
        'project(\':TeamCode\') { dependencies { implementation "g:team:$shared" } }',
        "project(':FtcRobotController') { dependencies { implementation 'g:robot:1' } }",
        'repositories { google() }',
        "dependencies { implementation 'g:root:1' }",
        'android { compileSdkVersion 99 }'
      ].join('\n'),
      [TEAMCODE]: 'dependencies { implementation "g:own:$shared" }'
    })
    expect(coords(project)).toEqual([
      'implementation g:sub:1',
      'implementation g:team:1',
      'implementation g:own:1'
    ])
    expect(project.repositories.map((r) => r.kind)).toEqual(['mavenCentral'])
    expect(project.compileSdk).toBeNull()
  })
})

describe('의존성 표기', () => {
  it('구성 네 가지와 한 줄에 여러 개, 여러 줄로 이은 인자', async () => {
    const project = await readDeps(
      [
        "  implementation 'g:a:1', 'g:b:1'",
        "  api 'g:c:1'",
        "  compileOnly('g:d:1')",
        "  runtimeOnly 'g:e:1',",
        "      'g:f:1'"
      ].join('\n')
    )
    expect(coords(project)).toEqual([
      'implementation g:a:1',
      'implementation g:b:1',
      'api g:c:1',
      'compileOnly g:d:1',
      'runtimeOnly g:e:1',
      'runtimeOnly g:f:1'
    ])
    expect(project.dependencies.map((d) => d.at.line)).toEqual([2, 2, 3, 4, 5, 6])
  })

  it('동적 버전·범위·SNAPSHOT·classifier·확장자는 글자 그대로', async () => {
    const project = await readDeps(
      [
        "  implementation 'g:a:1.+'",
        "  implementation 'g:b:latest.release'",
        "  implementation 'g:c:[1.0,2.0)'",
        "  implementation 'g:d:1.0-SNAPSHOT'",
        "  implementation 'g:e:1:sources@jar'"
      ].join('\n')
    )
    expect(project.dependencies.map((d) => [d.version, d.classifier, d.extension])).toEqual([
      ['1.+', null, null],
      ['latest.release', null, null],
      ['[1.0,2.0)', null, null],
      ['1.0-SNAPSHOT', null, null],
      ['1', 'sources', 'jar']
    ])
  })

  it('틀린 표기는 진단', async () => {
    const project = await readDeps(
      [
        "  implementation 'g:a'",
        "  implementation 'g:a:'",
        "  implementation 'g a:b:1'",
        "  implementation 'g:a:1:c:x'",
        "  implementation 'g:a:1@'",
        "  implementation '../evil:a:1'",
        "  implementation group: 'g', name: 'a'",
        "  implementation group: 'g', name: 'a', version: 1"
      ].join('\n')
    )
    expect(project.dependencies).toEqual([])
    expect(codes(project)).toEqual(Array(8).fill('unsupportedSyntax'))
    expect(project.diagnostics[0].detail).toBe("dependency 'g:a' has no version")
  })

  it('map 형식과 classifier·ext, Kotlin 이름 붙은 인자', async () => {
    const groovy = await readDeps(
      "  implementation group: 'g', name: 'a', version: '1', classifier: 'c', ext: 'aar'\n  implementation(group: 'g', name: 'b', version: '2')"
    )
    expect(
      groovy.dependencies.map((d) => [d.artifact, d.version, d.classifier, d.extension])
    ).toEqual([
      ['a', '1', 'c', 'aar'],
      ['b', '2', null, null]
    ])
    const kotlin = await read({
      'TeamCode/build.gradle.kts':
        'dependencies {\n    implementation(group = "g", name = "a", version = "1")\n}'
    })
    expect(coords(kotlin)).toEqual(['implementation g:a:1'])
  })

  it('exclude·transitive 여러 표기, 읽지 못하는 설정은 진단', async () => {
    const project = await readDeps(
      [
        "  implementation('g:a:1') {",
        "    exclude group: 'x'",
        "    exclude(module: 'y')",
        "    exclude group: 'z', module: 'w'",
        '    transitive false',
        "    because 'reason'",
        '  }',
        "  implementation('g:b:1') { setTransitive(false) }",
        "  implementation('g:c:1') {",
        "    version { strictly '1.0' }",
        "    exclude foo: 'bar'",
        '    exclude group: unknownName',
        '    transitive = maybe',
        '  }'
      ].join('\n')
    )
    expect(project.dependencies.map((d) => [d.artifact, d.transitive, d.excludes])).toEqual([
      [
        'a',
        false,
        [
          { group: 'x', module: null },
          { group: null, module: 'y' },
          { group: 'z', module: 'w' }
        ]
      ],
      ['b', false, []],
      ['c', true, []]
    ])
    expect(codes(project)).toEqual([
      'unsupportedSyntax',
      'unsupportedSyntax',
      'unresolvedValue',
      'unresolvedValue'
    ])
  })

  it("project(':FtcRobotController')만 조용히 넘기고 다른 로컬 의존성은 localDependency", async () => {
    const project = await readDeps(
      [
        "  implementation project(':FtcRobotController')",
        "  implementation project(path: ':FtcRobotController')",
        "  implementation project(':lib')",
        "  implementation files('libs/a.jar')",
        "  implementation fileTree(dir: 'libs', include: ['*.jar'])",
        "  implementation(name: 'navx', ext: 'aar')",
        '  implementation gradleApi()'
      ].join('\n')
    )
    expect(project.dependencies).toEqual([])
    expect(codes(project)).toEqual(Array(5).fill('localDependency'))
  })

  it('무시하는 구성, 알리는 구성', async () => {
    const project = await readDeps(
      [
        "  testImplementation 'junit:junit:4.13.2'",
        "  androidTestImplementation 'g:t:1'",
        "  coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.0.4'",
        "  umlDoclet 'nl.talsmasoftware:umldoclet:1.1.4'",
        "  annotationProcessor 'g:p:1'",
        "  kapt 'g:k:1'",
        "  debugImplementation 'g:d:1'",
        "  implementation platform('g:bom:1')",
        "  constraints { implementation 'g:c:1' }",
        "  add('implementation', 'g:a:1')"
      ].join('\n')
    )
    expect(project.dependencies).toEqual([])
    expect(project.diagnostics.map((d) => `${d.code}:${d.at.line}`)).toEqual([
      'unsupportedSyntax:6',
      'unsupportedSyntax:7',
      'unsupportedSyntax:8',
      'unsupportedSyntax:9',
      'unsupportedSyntax:10',
      'unsupportedSyntax:11'
    ])
  })

  it('조건문·반복문 안의 선언과 configurations 규칙, dependencies.add는 알린다', async () => {
    const project = await read({
      [TEAMCODE]: [
        "if (true) { dependencies { implementation 'g:a:1' } }",
        "if (true) { println 'not relevant' }",
        "configurations.all { exclude group: 'x' }",
        "configurations { all*.exclude group: 'y' }",
        "dependencies.add('implementation', 'g:b:1')",
        'dependencies {',
        "  ['g:c:1', 'g:d:1'].each { implementation it }",
        "  for (x in ['a']) { implementation x }",
        '}'
      ].join('\n')
    })
    expect(project.dependencies).toEqual([])
    expect(project.diagnostics.map((d) => `${d.code}:${d.at.line}`)).toEqual([
      'unsupportedSyntax:1',
      'unsupportedSyntax:3',
      'unsupportedSyntax:4',
      'unsupportedSyntax:5',
      'unsupportedSyntax:7',
      'unsupportedSyntax:8'
    ])
  })

  it('주석 안의 선언은 읽지 않고, 문자열 안의 괄호·주석 글자에 흔들리지 않는다', async () => {
    const project = await readDeps(
      [
        "  // implementation 'g:commented:1'",
        "  /* implementation 'g:block:1' } */",
        "  implementation '''g:triple:1'''",
        '  def v = "2"',
        '  implementation """g:gstring:$v"""',
        "  implementation 'g:brace:1' // } {",
        '  def re = /a{2}\\/b/',
        "  implementation 'g:after:1'"
      ].join('\n')
    )
    expect(coords(project)).toEqual([
      'implementation g:triple:1',
      'implementation g:gstring:2',
      'implementation g:brace:1',
      'implementation g:after:1'
    ])
    expect(project.diagnostics).toEqual([])
  })

  it('같은 자리를 두 번 적용하면 한 번만 남긴다', async () => {
    const project = await read({
      'build.gradle': 'allprojects { apply from: "$rootDir/deps.gradle" }',
      [TEAMCODE]: "apply from: '../deps.gradle'",
      'deps.gradle': "dependencies { implementation 'g:a:1' }"
    })
    expect(coords(project)).toEqual(['implementation g:a:1'])
  })

  it('Kotlin: kotlin(…)은 버전이 있어야 하고 libs 없이 libs.x는 versionCatalogEntry', async () => {
    const project = await read({
      'TeamCode/build.gradle.kts': [
        'dependencies {',
        '    implementation(kotlin("stdlib"))',
        '    implementation(kotlin("reflect", "2.1.20"))',
        '    implementation(libs.pedro.core)',
        '}'
      ].join('\n')
    })
    expect(coords(project)).toEqual(['implementation org.jetbrains.kotlin:kotlin-reflect:2.1.20'])
    expect(codes(project)).toEqual(['unsupportedSyntax', 'versionCatalogEntry'])
  })
})

describe('저장소', () => {
  it('maven 저장소의 여러 표기', async () => {
    const project = await read({
      [TEAMCODE]: [
        'repositories {',
        "  maven { url 'https://a.example/' }",
        "  maven { url = 'https://b.example/' }",
        "  maven { url uri('https://c.example/') }",
        "  maven { setUrl('https://d.example/') }",
        '  maven {',
        "    name = 'E'",
        '    url "https://e.example/"',
        "    credentials { username 'x' }",
        "    content { includeGroup 'g' }",
        '  }',
        '  mavenLocal()',
        '  gradlePluginPortal()',
        '  google { content { includeGroupByRegex "androidx.*" } }',
        '  exclusiveContent {',
        "    forRepository { maven { url 'https://f.example/' } }",
        "    filter { includeGroup 'f' }",
        '  }',
        '}'
      ].join('\n'),
      'TeamCode/x.gradle.kts': '',
      'build.gradle.kts':
        'allprojects { repositories { maven("https://k1.example/"); maven(url = "https://k2.example/"); maven { url = uri("https://k3.example/") } } }'
    })
    expect(
      project.repositories.map((r) => `${r.kind} ${r.url ?? ''} ${r.at.file}:${r.at.line}`)
    ).toEqual([
      'maven https://k1.example/ build.gradle.kts:1',
      'maven https://k2.example/ build.gradle.kts:1',
      'maven https://k3.example/ build.gradle.kts:1',
      'maven https://a.example/ TeamCode/build.gradle:2',
      'maven https://b.example/ TeamCode/build.gradle:3',
      'maven https://c.example/ TeamCode/build.gradle:4',
      'maven https://d.example/ TeamCode/build.gradle:5',
      'maven https://e.example/ TeamCode/build.gradle:8',
      'mavenLocal  TeamCode/build.gradle:12',
      'gradlePluginPortal  TeamCode/build.gradle:13',
      'google  TeamCode/build.gradle:14',
      'maven https://f.example/ TeamCode/build.gradle:16'
    ])
    expect(project.diagnostics).toEqual([])
  })

  it('url 없는 maven·ivy·로컬 폴더·풀 수 없는 주소는 알린다', async () => {
    const project = await read({
      [TEAMCODE]: [
        'repositories {',
        "  maven { name = 'x' }",
        "  ivy { url 'https://ivy.example/' }",
        '  maven { url "${rootDir}/libs/repo" }',
        '  maven { url repoUrl }',
        '  if (x) { mavenCentral() }',
        '}'
      ].join('\n')
    })
    expect(project.repositories).toEqual([])
    expect(project.diagnostics.map((d) => `${d.code}:${d.at.line}`)).toEqual([
      'unsupportedSyntax:2',
      'unsupportedSyntax:3',
      'unsupportedSyntax:4',
      'unresolvedValue:5',
      'unsupportedSyntax:6'
    ])
  })
})

describe('settings', () => {
  it('dependencyResolutionManagement 저장소, versionCatalogs 블록, TeamCode 위치 변경', async () => {
    const project = await read({
      'settings.gradle': [
        'dependencyResolutionManagement {',
        '  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)',
        '  repositories { mavenCentral() }',
        "  versionCatalogs { deps { from(files('gradle/deps.toml')) } }",
        '}',
        "include ':FtcRobotController'",
        "include ':TeamCode'",
        "project(':TeamCode').projectDir = file('Team')"
      ].join('\n')
    })
    expect(project.repositories).toEqual([
      { kind: 'mavenCentral', url: null, at: { file: 'settings.gradle', line: 3 } }
    ])
    expect(project.diagnostics.map((d) => `${d.code}:${d.at.line}`)).toEqual([
      'unsupportedSyntax:4',
      'unsupportedSyntax:8'
    ])
  })

  it('settings가 TeamCode를 include하지 않으면 알린다(include를 다 풀 수 있을 때만)', async () => {
    expect(codes(await read({ 'settings.gradle': "include ':FtcRobotController'" }))).toEqual([
      'unsupportedSyntax'
    ])
    expect(
      codes(await read({ 'settings.gradle': "include 'TeamCode', 'FtcRobotController'" }))
    ).toEqual([])
    expect(
      codes(await read({ 'settings.gradle': "include ':FtcRobotController', modules" }))
    ).toEqual([])
  })
})

describe('compileSdk', () => {
  async function sdk(android: string, extra: MemoryFiles = {}): Promise<GradleProject> {
    return read({ [TEAMCODE]: `android {\n${android}\n}`, ...extra })
  }

  it('여러 표기를 읽고, 나중 것이 앞의 것을 덮는다', async () => {
    expect((await sdk('compileSdkVersion 30')).compileSdk).toBe(30)
    expect((await sdk("compileSdkVersion 'android-33'")).compileSdk).toBe(33)
    expect((await sdk('compileSdk 34')).compileSdk).toBe(34)
    expect((await sdk('compileSdk = 35')).compileSdk).toBe(35)
    expect((await sdk('compileSdkVersion(31)')).compileSdk).toBe(31)
    expect((await sdk('compileSdk { version = release(36) }')).compileSdk).toBe(36)
    expect(
      (await sdk('compileSdk rootProject.ext.sdk', { 'build.gradle': 'ext.sdk = 32' })).compileSdk
    ).toBe(32)
    expect(
      (await sdk('compileSdk sdkVersion.toInteger()', { 'gradle.properties': 'sdkVersion=29' }))
        .compileSdk
    ).toBe(29)
    expect((await read({ [TEAMCODE]: 'android.compileSdkVersion = 28' })).compileSdk).toBe(28)
    expect(
      (
        await read({
          [TEAMCODE]: "apply from: '../common.gradle'\nandroid { compileSdk 34 }",
          'common.gradle': 'android { compileSdkVersion 30 }'
        })
      ).compileSdk
    ).toBe(34)
    expect(
      (await read({ 'TeamCode/build.gradle.kts': 'android {\n    compileSdk = 34\n}' })).compileSdk
    ).toBe(34)
  })

  it('풀 수 없거나 API 번호가 아니면 진단이고 compileSdk는 그대로', async () => {
    const cases: Array<[string, string]> = [
      ["compileSdk System.getenv('SDK')", 'unresolvedValue'],
      ["compileSdkVersion 'Google Inc.:Google APIs:30'", 'unsupportedSyntax'],
      ['compileSdkPreview "VanillaIceCream"', 'unsupportedSyntax'],
      ['compileSdk { version = preview("Baklava") }', 'unsupportedSyntax'],
      ['compileSdk 0', 'unsupportedSyntax'],
      ['if (x) { compileSdk 34 }', 'unsupportedSyntax']
    ]
    for (const [line, code] of cases) {
      const project = await sdk(line)
      expect(project.compileSdk, line).toBeNull()
      expect(codes(project), line).toEqual([code])
    }
  })

  it('android 블록의 다른 내용(서명 설정의 if, 환경 변수)은 보지 않는다', async () => {
    const project = await sdk(
      [
        '  compileSdkVersion 30',
        '  signingConfigs { release {',
        '    def f = System.getenv("X")',
        '    if (f != null) { storeFile file(f) } else { storeFile rootProject.file("libs/x") }',
        '  } }',
        '  defaultConfig { minSdkVersion 24 }'
      ].join('\n')
    )
    expect(project.compileSdk).toBe(30)
    expect(project.diagnostics).toEqual([])
  })
})

describe('한도', () => {
  it('진단 수에 한도가 있다', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `  implementation "g:a$i:$v${i}"`).join(
      '\n'
    )
    const project = await readDeps(lines)
    expect(project.diagnostics).toHaveLength(200)
  })

  it('의존성 수에 한도가 있다', async () => {
    const lines = Array.from({ length: 1005 }, (_, i) => `  implementation 'g:a${i}:1'`).join('\n')
    const project = await readDeps(lines)
    expect(project.dependencies).toHaveLength(1000)
    expect(project.diagnostics).toEqual([
      {
        code: 'tooLarge',
        at: { file: TEAMCODE, line: 1002 },
        detail: 'more than 1000 dependencies'
      }
    ])
  })

  it('블록이 너무 깊으면 그 파일을 읽지 않는다(tooDeep)', async () => {
    const deep = `${'a {\n'.repeat(200)}${'}\n'.repeat(200)}`
    const project = await read({
      [TEAMCODE]: `${deep}\ndependencies { implementation 'g:a:1' }`,
      'build.gradle': "allprojects { dependencies { implementation 'g:root:1' } }"
    })
    expect(coords(project)).toEqual(['implementation g:root:1'])
    expect(codes(project)).toEqual(['tooDeep'])
    const interpolation = `dependencies { implementation "${'${"'.repeat(40)}x${'"}'.repeat(40)}" }`
    expect(codes(await read({ [TEAMCODE]: interpolation }))).toEqual(['tooDeep'])
  })

  it('닫히지 않은 문자열은 알리고 다음 줄부터 계속 읽는다', async () => {
    const project = await readDeps("  implementation 'g:a:1\n  implementation 'g:b:1'")
    expect(coords(project)).toEqual(['implementation g:b:1'])
    expect(project.diagnostics.map((d) => `${d.code}:${d.at.line}`)).toEqual([
      'unsupportedSyntax:2',
      'unsupportedSyntax:2'
    ])
  })
})
