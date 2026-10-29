import { describe, expect, it } from 'vitest'
import type { GradleDiagnostic } from '../../shared/gradle'
import type { LibraryEntry } from '../../shared/libraries'
import type { CompileDiagnostic } from '../../shared/sidecarProtocol'
import { diagnosticHints } from './hints'

// 의존성 보고 항목. declared면 팀 Gradle의 선언 위치, 아니면 끌어온 쪽 사슬(requestedBy).
function entry(
  coordinate: string,
  status: LibraryEntry['status'],
  reason: LibraryEntry['reason'],
  from: 'declared' | string[] = 'declared'
): LibraryEntry {
  const [group, artifact, version] = coordinate.split(':')
  return {
    group,
    artifact,
    version,
    requested: [version],
    status,
    reason,
    detail: '',
    declaredAt: from === 'declared' ? { file: 'build.dependencies.gradle', line: 18 } : null,
    requestedBy: from === 'declared' ? [] : from,
    source: null,
    integrity: null
  }
}

const missing = (packageName: string): CompileDiagnostic => ({
  kind: 'error',
  file: '/x/Auto.java',
  line: 3,
  column: 1,
  message: `package ${packageName} does not exist`,
  code: 'compiler.err.doesnt.exist'
})

// 실제 Pedro 3.0.2 jar의 패키지(core-3.0.2.jar, revhub-3.0.2.aar의 classes.jar)
const PEDRO3_PACKAGES = new Set(
  [
    'algorithm',
    'api',
    'config',
    'controllers',
    'controllers.filters',
    'drivetrain',
    'follower',
    'localization',
    'math',
    'paths',
    'paths.curves',
    'paths.curves.bezier',
    'paths.interpolator',
    'utils',
    'revhub',
    'revhub.drivetrains',
    'revhub.localizers'
  ].map((name) => `com.pedropathing.${name}`)
)

// Pedro 3 quickstart: revhub·tuning을 선언하고 core는 revhub가 끌어온다
const PEDRO3_QUICKSTART = [
  entry('com.pedropathing:revhub:3.0.2', 'used', 'none'),
  entry('com.pedropathing:tuning:1.0.1', 'unsupported', 'pedroTuning'),
  entry('com.pedropathing:core:3.0.2', 'used', 'none', ['com.pedropathing:revhub:3.0.2'])
]

describe('컴파일 진단의 라이브러리 안내', () => {
  it('Pedro 3.x 프로젝트의 2.x 패키지는 AutoTune(tuning) 탓으로 돌리지 않는다', () => {
    const hint = diagnosticHints(PEDRO3_QUICKSTART, PEDRO3_PACKAGES, [])
    for (const name of [
      'com.pedropathing.geometry',
      'com.pedropathing.ftc',
      'com.pedropathing.ftc.drivetrains',
      'com.pedropathing.util',
      'com.pedropathing.control',
      'com.pedropathing.pathgen',
      'com.pedropathing'
    ])
      expect(hint(missing(name)), name).toBeNull()
    // tuning 자신의 패키지는 그대로 tuning
    expect(hint(missing('com.pedropathing.tuning.autotune'))).toEqual({
      kind: 'libraryNotLoaded',
      coordinate: 'com.pedropathing:tuning:1.0.1',
      reason: 'pedroTuning'
    })
  })

  it('패키지를 가진 좌표만 이름을 댄다(선언 순서와 관계없이)', () => {
    // tuning을 먼저 선언했고 revhub는 받지 못함(core는 닿지 못함)
    const offline = diagnosticHints(
      [
        entry('com.pedropathing:tuning:1.0.1', 'unsupported', 'pedroTuning'),
        entry('com.pedropathing:revhub:3.0.2', 'failed', 'offline')
      ],
      new Set(),
      []
    )
    for (const name of ['com.pedropathing.follower', 'com.pedropathing.revhub.localizers'])
      expect(offline(missing(name)), name).toEqual({
        kind: 'libraryNotLoaded',
        coordinate: 'com.pedropathing:revhub:3.0.2',
        reason: 'offline'
      })
    // revhub 3.x에 없는 2.x 패키지는 revhub 탓도 아니다
    expect(offline(missing('com.pedropathing.geometry'))).toBeNull()
    // Pedro 2.x(ftc 2.x가 core 2.x를 compile 범위로 끌어온다)
    const pedro2 = diagnosticHints(
      [entry('com.pedropathing:ftc:2.1.2', 'unsupported', 'pedro2')],
      new Set(),
      []
    )
    for (const name of [
      'com.pedropathing.geometry',
      'com.pedropathing.follower',
      'com.pedropathing.ftc.localization.constants'
    ])
      expect(pedro2(missing(name)), name).toEqual({
        kind: 'libraryNotLoaded',
        coordinate: 'com.pedropathing:ftc:2.1.2',
        reason: 'pedro2'
      })
    expect(pedro2(missing('com.pedropathing.config'))).toBeNull()
    // Pedro 1.x(com.pedropathing:pedro)
    const pedro1 = diagnosticHints(
      [entry('com.pedropathing:pedro:1.0.9', 'unsupported', 'notSupported')],
      new Set(),
      []
    )
    expect(pedro1(missing('com.pedropathing.pathgen'))).toEqual({
      kind: 'libraryNotLoaded',
      coordinate: 'com.pedropathing:pedro:1.0.9',
      reason: 'notSupported'
    })
    expect(pedro1(missing('com.pedropathing.geometry'))).toBeNull()
  })

  it('전이 의존성만이면 선언했다고 하지 않고 끌어온 쪽을 댄다', () => {
    // Road Runner 1.0만 선언: actions가 dashboard:core를, ftc가 dashboard:dashboard를 끌어온다
    const roadRunner = diagnosticHints(
      [
        entry('com.acmerobotics.roadrunner:ftc:0.1.25', 'used', 'none'),
        entry('com.acmerobotics.roadrunner:core:1.0.1', 'used', 'none'),
        entry('com.acmerobotics.roadrunner:actions:1.0.1', 'used', 'none'),
        entry('com.acmerobotics.dashboard:core:0.4.7', 'unsupported', 'notSupported', [
          'com.acmerobotics.roadrunner:actions:1.0.1'
        ]),
        entry('com.acmerobotics.dashboard:dashboard:0.4.10', 'unsupported', 'notSupported', [
          'com.acmerobotics.roadrunner:ftc:0.1.25'
        ])
      ],
      new Set(['com.acmerobotics.roadrunner', 'com.acmerobotics.roadrunner.ftc']),
      []
    )
    expect(roadRunner(missing('com.acmerobotics.dashboard.telemetry'))).toEqual({
      kind: 'dependencyNotLoaded',
      coordinate: 'com.acmerobotics.dashboard:core:0.4.7',
      reason: 'notSupported',
      requestedBy: 'com.acmerobotics.roadrunner:actions:1.0.1'
    })
    // 직접 선언한 것이 있으면 그것을 먼저
    const declared = diagnosticHints(
      [
        entry('com.acmerobotics.dashboard:dashboard:0.6.0', 'unsupported', 'notSupported'),
        entry('com.acmerobotics.dashboard:core:0.6.0', 'unsupported', 'notSupported', [
          'com.acmerobotics.dashboard:dashboard:0.6.0'
        ])
      ],
      new Set(),
      []
    )
    expect(declared(missing('com.acmerobotics.dashboard.config'))).toEqual({
      kind: 'libraryNotLoaded',
      coordinate: 'com.acmerobotics.dashboard:dashboard:0.6.0',
      reason: 'notSupported'
    })
    // 받지 못한 전이 의존성(revhub는 받았고 core는 오프라인)
    const offlineCore = diagnosticHints(
      [
        entry('com.pedropathing:revhub:3.0.2', 'used', 'none'),
        entry('com.pedropathing:core:3.0.2', 'failed', 'offline', ['com.pedropathing:revhub:3.0.2'])
      ],
      new Set(['com.pedropathing.revhub', 'com.pedropathing.revhub.drivetrains']),
      []
    )
    expect(offlineCore(missing('com.pedropathing.follower'))).toEqual({
      kind: 'dependencyNotLoaded',
      coordinate: 'com.pedropathing:core:3.0.2',
      reason: 'offline',
      requestedBy: 'com.pedropathing:revhub:3.0.2'
    })
  })

  it('Sloth용 대체판(slothboard·com.bylazar.sloth)의 패키지는 그 선언을 댄다', () => {
    const hint = diagnosticHints(
      [
        entry('com.pedropathing:revhub:3.0.2', 'used', 'none'),
        entry('dev.frozenmilk.sinister:Sloth:0.3.2', 'unsupported', 'dairy'),
        entry('com.acmerobotics.slothboard:dashboard:0.3.2+0.6.0', 'unsupported', 'notSupported'),
        entry('com.bylazar.sloth:fullpanels:0.3.2+1.0.13', 'unsupported', 'panels')
      ],
      new Set(['com.pedropathing.revhub']),
      []
    )
    expect(hint(missing('com.acmerobotics.dashboard.config'))).toEqual({
      kind: 'libraryNotLoaded',
      coordinate: 'com.acmerobotics.slothboard:dashboard:0.3.2+0.6.0',
      reason: 'notSupported'
    })
    expect(hint(missing('com.bylazar.telemetry'))).toEqual({
      kind: 'libraryNotLoaded',
      coordinate: 'com.bylazar.sloth:fullpanels:0.3.2+1.0.13',
      reason: 'panels'
    })
  })

  it('선언에 없다고 단정하는 것은 Gradle을 모두 읽었고 패키지를 모르는 라이브러리를 빼지 않았을 때만', () => {
    // 모두 읽었고 어느 선언에도 없다
    expect(diagnosticHints([], new Set(), [])(missing('com.pedropathing.follower'))).toEqual({
      kind: 'undeclared',
      packageName: 'com.pedropathing.follower'
    })
    expect(
      diagnosticHints(PEDRO3_QUICKSTART, PEDRO3_PACKAGES, [])(missing('com.bylazar.telemetry'))
    ).toEqual({ kind: 'undeclared', packageName: 'com.bylazar.telemetry' })
    // 원격 apply from·풀지 못한 버전 등으로 읽지 못한 선언이 있다
    const remote: GradleDiagnostic = {
      code: 'remoteScript',
      at: { file: 'TeamCode/build.gradle', line: 3 },
      detail: 'https://raw.githubusercontent.com/our-team/ftc-shared/main/pedro.gradle'
    }
    for (const code of ['remoteScript', 'unresolvedValue', 'localDependency'] as const)
      expect(
        diagnosticHints([], new Set(), [{ ...remote, code }])(missing('com.pedropathing.follower')),
        code
      ).toEqual({ kind: 'maybeUndeclared', packageName: 'com.pedropathing.follower' })
    // 패키지를 모르는 라이브러리(포크 등)를 불러오지 않았다
    const fork = diagnosticHints(
      [entry('com.github.someteam:pedro-fork:3.0.2', 'unsupported', 'notSupported')],
      new Set(),
      []
    )
    expect(fork(missing('com.pedropathing.follower'))).toEqual({
      kind: 'maybeUndeclared',
      packageName: 'com.pedropathing.follower'
    })
    // 받지 못한 전이 의존성(패키지를 모름)이 있어도 같다
    const failedTransitive = diagnosticHints(
      [
        entry('com.acmerobotics.roadrunner:core:1.0.1', 'used', 'none'),
        entry('com.fasterxml.jackson.core:jackson-databind:2.12.7', 'failed', 'offline', [
          'com.acmerobotics.roadrunner:ftc:0.1.25'
        ])
      ],
      new Set(['com.acmerobotics.roadrunner']),
      []
    )
    expect(failedTransitive(missing('com.arcrobotics.ftclib.command'))).toEqual({
      kind: 'maybeUndeclared',
      packageName: 'com.arcrobotics.ftclib.command'
    })
  })

  it('다른 라이브러리를 통해서만 오는 패키지(kotlin·ejml)는 선언 여부를 말하지 않는다', () => {
    const hint = diagnosticHints([], new Set(), [])
    expect(hint(missing('kotlin.collections'))).toBeNull()
    expect(hint(missing('org.ejml.simple'))).toBeNull()
    expect(
      diagnosticHints(
        [
          entry('org.ftclib.ftclib:core:2.1.1', 'used', 'none'),
          entry('org.ejml:ejml-simple:0.39', 'failed', 'notFound', ['org.ftclib.ftclib:core:2.1.1'])
        ],
        new Set(['com.arcrobotics.ftclib']),
        []
      )(missing('org.ejml.simple'))
    ).toEqual({
      kind: 'dependencyNotLoaded',
      coordinate: 'org.ejml:ejml-simple:0.39',
      reason: 'notFound',
      requestedBy: 'org.ftclib.ftclib:core:2.1.1'
    })
  })

  it('FTCLib vision은 vision 선언만, core 패키지는 core만', () => {
    const coreOnly = diagnosticHints(
      [entry('org.ftclib.ftclib:core:2.1.1', 'failed', 'offline')],
      new Set(),
      []
    )
    expect(coreOnly(missing('com.arcrobotics.ftclib.command'))).toEqual({
      kind: 'libraryNotLoaded',
      coordinate: 'org.ftclib.ftclib:core:2.1.1',
      reason: 'offline'
    })
    expect(coreOnly(missing('com.arcrobotics.ftclib.vision'))).toEqual({
      kind: 'undeclared',
      packageName: 'com.arcrobotics.ftclib.vision'
    })
    const vision = diagnosticHints(
      [
        entry('org.ftclib.ftclib:core:2.1.1', 'used', 'none'),
        entry('org.ftclib.ftclib:vision:2.1.0', 'unsupported', 'ftcLibVision')
      ],
      new Set(['com.arcrobotics.ftclib', 'com.arcrobotics.ftclib.command']),
      []
    )
    expect(vision(missing('com.arcrobotics.ftclib.vision'))).toEqual({
      kind: 'libraryNotLoaded',
      coordinate: 'org.ftclib.ftclib:vision:2.1.0',
      reason: 'ftcLibVision'
    })
  })
})
