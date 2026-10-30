import { DASHBOARD_GROUPS, type LibraryReason } from '../../shared/libraries'
import { majorVersion } from './version'

// 라이브러리 정책 표(한곳). 팀 Gradle의 좌표마다 받을지, 가짜 FTC SDK가 이미 제공하는지, 지원하지 않는지를 정한다.
// - 지원 계열(직접 선언하면 해석의 뿌리): Road Runner 1.0(com.acmerobotics.roadrunner core·actions 1.x, ftc),
//   Pedro Pathing 3.x 이상(com.pedropathing core·revhub 주 버전 3 이상, Ivy com.pedropathing.ivy 1.x 이상),
//   FTCLib core(org.ftclib.ftclib:core). 이것들이 끌어온 전이 의존성(kotlin-stdlib, jackson, ejml, jsr305 …)은 쓴다.
// - 제공(provided): FTC SDK, Android(androidx·com.android·com.google.android), 가짜 SDK에 든 Gson·NanoHTTPD·
//   threetenabp·OpenFTC·slf4j-api. 받지 않는다. 단 androidx.annotation은 Android Studio의 컴파일 클래스패스에 늘 있으므로
//   (appcompat이 compile 범위로 끌어온다) 받아서 컴파일 클래스패스에만 넣는다.
// - 지원하지 않음(안내): FTC Dashboard(L1: SandBot 대체가 생기기 전), Pedro AutoTune, Pedro 2.x, Panels, Sloth·Sinister,
//   FTCLib vision, 그 밖에 직접 선언했지만 지원 계열도 그 전이 의존성도 아닌 것(notSupported). Sloth용 대체판
//   (com.acmerobotics.slothboard:dashboard, com.bylazar.sloth:fullpanels)은 같은 패키지를 담으므로 원본과 같게 본다.
// 정책을 바꾸면 POLICY_VERSION을 올린다(해석 잠금 resolutions/의 키에 들어간다).

export const POLICY_VERSION = 2

export const DASHBOARD_DETAIL =
  'FTC Dashboard support arrives with the SandBot Dashboard replacement'

export type PolicyDecision =
  // 가짜 SDK·Android가 제공한다(받지 않음)
  | { kind: 'provided' }
  // 받아서 컴파일 클래스패스에만(androidx.annotation)
  | { kind: 'compileOnly' }
  | { kind: 'unsupported'; reason: LibraryReason; detail: string }
  // 지원 계열: 직접 선언하면 해석을 시작한다
  | { kind: 'supported' }
  // 지원 계열의 전이 의존성이면 쓰고, 직접 선언만 했으면 notSupported
  | { kind: 'other' }

const PROVIDED_MODULES: ReadonlySet<string> = new Set([
  'com.google.code.gson:gson',
  'org.nanohttpd:nanohttpd',
  'org.nanohttpd:nanohttpd-websocket',
  'org.slf4j:slf4j-api'
])

const PROVIDED_GROUPS: ReadonlySet<string> = new Set([
  'org.firstinspires.ftc',
  'com.jakewharton.threetenabp',
  'org.openftc'
])

function inGroup(group: string, prefix: string): boolean {
  return group === prefix || group.startsWith(`${prefix}.`)
}

function unsupported(reason: LibraryReason, detail = ''): PolicyDecision {
  return { kind: 'unsupported', reason, detail }
}

function atLeast(version: string, major: number): boolean {
  const value = majorVersion(version)
  return value !== null && value >= major
}

export function classifyModule(group: string, artifact: string, version: string): PolicyDecision {
  // ---- 제공 ----
  if (group === 'androidx.annotation') return { kind: 'compileOnly' }
  if (
    PROVIDED_GROUPS.has(group) ||
    inGroup(group, 'androidx') ||
    inGroup(group, 'com.android') ||
    group.startsWith('com.google.android') ||
    PROVIDED_MODULES.has(`${group}:${artifact}`)
  )
    return { kind: 'provided' }

  // ---- 지원 계열과 그 안내 ----
  if (DASHBOARD_GROUPS.has(group)) return unsupported('notSupported', DASHBOARD_DETAIL)
  if (group === 'com.acmerobotics.roadrunner') {
    if (artifact === 'ftc') return { kind: 'supported' }
    if (artifact === 'core' || artifact === 'actions')
      return atLeast(version, 1)
        ? { kind: 'supported' }
        : unsupported('notSupported', 'Road Runner before 1.0 is not supported')
    return unsupported('notSupported')
  }
  if (group === 'com.pedropathing') {
    if (artifact === 'tuning') return unsupported('pedroTuning')
    if (artifact === 'core' || artifact === 'revhub')
      return atLeast(version, 3) ? { kind: 'supported' } : unsupported('pedro2')
    // ftc·telemetry·ivy(0.0.1·1.0.0)는 2.x용
    if (artifact === 'ftc' || artifact === 'telemetry' || artifact === 'ivy')
      return unsupported('pedro2')
    return unsupported('notSupported')
  }
  if (group === 'com.pedropathing.ivy')
    return atLeast(version, 1) ? { kind: 'supported' } : unsupported('notSupported')
  if (group === 'org.ftclib.ftclib') {
    if (artifact === 'core') return { kind: 'supported' }
    if (artifact === 'vision') return unsupported('ftcLibVision')
    return unsupported('notSupported')
  }
  if (inGroup(group, 'com.bylazar')) return unsupported('panels')
  if (group.startsWith('dev.frozenmilk')) return unsupported('dairy')
  return { kind: 'other' }
}

// ---- 진단 안내: 패키지 → 라이브러리 ----
// 팀 코드의 'package X does not exist'에서 X가 어느 라이브러리 것인지(X 자신만 맞는 exact 항목, 아니면 가장 긴 접두가 이긴다).
// - owns: 그 패키지를 Android Studio의 컴파일 클래스패스에 두는 좌표. 모듈 자신의 패키지이거나 compile 범위 의존성으로
//   끌어오는 것이다(Pedro ftc 2.x → core 2.x, revhub 3.x → core 3.x, Road Runner ftc·actions → FTC Dashboard). 버전마다
//   패키지가 다르면 버전도 본다(실제 jar·POM으로 확인).
// - holds: owns 가운데 자기 jar에 그 패키지를 가진 좌표(없으면 owns 전부). 안내는 끌어오기만 하는 좌표보다 이것을 먼저
//   댄다(Road Runner ftc를 받지 못했어도 Dashboard 패키지는 Dashboard를 불러와야 생긴다).
// - library: 같은 라이브러리의 좌표(다른 버전·모듈). 이것이 있는데 owns인 좌표가 없으면 다른 버전의 API(Pedro 3.x
//   프로젝트의 2.x 패키지 등)라 좌표를 대지 않는다. null이면 다른 라이브러리를 거쳐서만 오는 패키지(kotlin·ejml)라
//   선언했는지 말하지 않는다.

export type KnownPackage = {
  prefix: string
  // prefix 패키지 자신에만 맞는다(하위 패키지는 아님)
  exact?: true
  owns: (group: string, artifact: string, version: string) => boolean
  holds?: (group: string, artifact: string, version: string) => boolean
  library: ((group: string, artifact: string) => boolean) | null
}

type Owns = KnownPackage['owns']

// core는 주 버전으로 판을 나눈다(2.x·3.x). 주 버전을 알 수 없는 버전('+'·latest.release·범위 등 동적 버전)은 어느 판일 수도
// 있어 둘 다로 본다.
function pedroCoreLine(version: string, line: 2 | 3): boolean {
  const major = majorVersion(version)
  if (major === null) return true
  return line === 3 ? major >= 3 : major < 3
}

const PEDRO = 'com.pedropathing'
// 따로 쓰는 도구 모듈. 본체 패키지를 compile 범위로 끌어오지 않는다(tuning 1.x의 revhub는 runtime 범위).
const PEDRO_TOOLS: ReadonlySet<string> = new Set(['tuning', 'telemetry', 'ivy'])
const pedroModule =
  (artifact: string) =>
  (g: string, a: string): boolean =>
    g === PEDRO && a === artifact
const pedroLibrary = (g: string, a: string): boolean => g === PEDRO && !PEDRO_TOOLS.has(a)
// 본체의 판: 1.x는 pedro, 2.x는 core 2.x와 그것을 compile 범위로 끌어오는 ftc 2.x, 3.x는 core 3.x와 revhub 3.x
const PEDRO_LINES: Record<1 | 2 | 3, Owns> = {
  1: (g, a) => g === PEDRO && a === 'pedro',
  2: (g, a, v) => g === PEDRO && (a === 'ftc' || (a === 'core' && pedroCoreLine(v, 2))),
  3: (g, a, v) => g === PEDRO && (a === 'revhub' || (a === 'core' && pedroCoreLine(v, 3)))
}
// 그 판의 본체 패키지를 자기 jar에 가진 좌표(ftc 2.x·revhub 3.x는 core를 끌어올 뿐이다)
const PEDRO_HOLDERS: Record<1 | 2 | 3, Owns> = {
  1: PEDRO_LINES[1],
  2: (g, a, v) => g === PEDRO && a === 'core' && pedroCoreLine(v, 2),
  3: (g, a, v) => g === PEDRO && a === 'core' && pedroCoreLine(v, 3)
}
// 본체 패키지와 그것이 있는 판(pedro 1.0.9, core 2.1.2, core 3.0.2 jar로 확인)
const PEDRO_PACKAGES: readonly (readonly [string, readonly (1 | 2 | 3)[]])[] = [
  ['follower', [1, 2, 3]],
  ['localization', [1, 2, 3]],
  ['util', [1, 2]],
  ['pathgen', [1]],
  ['control', [2]],
  ['geometry', [2]],
  ['drivetrain', [2, 3]],
  ['math', [2, 3]],
  ['paths', [2, 3]],
  ['algorithm', [3]],
  ['api', [3]],
  ['config', [3]],
  ['controllers', [3]],
  ['utils', [3]]
]
const ivy = (g: string, a: string): boolean =>
  inGroup(g, 'com.pedropathing.ivy') || (g === PEDRO && a === 'ivy')
const bylazar = (g: string): boolean => inGroup(g, 'com.bylazar')
const FTCLIB = 'org.ftclib.ftclib'
const ftcLibVision = (g: string, a: string): boolean => g === FTCLIB && a === 'vision'
const ROAD_RUNNER = 'com.acmerobotics.roadrunner'
// FTC Dashboard를 compile 범위로 끌어오는 Road Runner 모듈(ftc 0.1.x → dashboard, actions 1.x → dashboard:core).
// core(0.5.x·1.x)는 끌어오지 않는다(POM으로 확인).
const roadRunnerWithDashboard = (g: string, a: string): boolean =>
  g === ROAD_RUNNER && (a === 'ftc' || a === 'actions')
const frozenMilk = (g: string): boolean => inGroup(g, 'dev.frozenmilk')

export const KNOWN_PACKAGES: readonly KnownPackage[] = [
  { prefix: `${PEDRO}.tuning`, owns: pedroModule('tuning'), library: pedroModule('tuning') },
  {
    prefix: `${PEDRO}.telemetry`,
    owns: pedroModule('telemetry'),
    library: pedroModule('telemetry')
  },
  { prefix: `${PEDRO}.ivy`, owns: ivy, library: ivy },
  { prefix: `${PEDRO}.ftc`, owns: pedroModule('ftc'), library: pedroLibrary },
  { prefix: `${PEDRO}.revhub`, owns: pedroModule('revhub'), library: pedroLibrary },
  ...PEDRO_PACKAGES.map(([name, lines]): KnownPackage => ({
    prefix: `${PEDRO}.${name}`,
    owns: (g, a, v) => lines.some((line) => PEDRO_LINES[line](g, a, v)),
    holds: (g, a, v) => lines.some((line) => PEDRO_HOLDERS[line](g, a, v)),
    library: pedroLibrary
  })),
  // 최상위 패키지 자신의 클래스는 2.x core에만 있다(VectorCalculator·ErrorCalculator, 1.0.9·3.0.2에는 없음)
  {
    prefix: PEDRO,
    exact: true,
    owns: PEDRO_LINES[2],
    holds: PEDRO_HOLDERS[2],
    library: pedroLibrary
  },
  // 그 밖의 하위 패키지: 어느 좌표의 것인지 모른다
  { prefix: PEDRO, owns: () => false, library: pedroLibrary },
  { prefix: 'com.bylazar', owns: bylazar, library: bylazar },
  { prefix: 'com.arcrobotics.ftclib.vision', owns: ftcLibVision, library: ftcLibVision },
  {
    prefix: 'com.arcrobotics.ftclib',
    owns: (g, a) => g === FTCLIB && a !== 'vision',
    library: (g) => g === FTCLIB
  },
  {
    prefix: 'com.acmerobotics.dashboard',
    owns: (g, a) => DASHBOARD_GROUPS.has(g) || roadRunnerWithDashboard(g, a),
    holds: (g) => DASHBOARD_GROUPS.has(g),
    library: (g) => DASHBOARD_GROUPS.has(g)
  },
  {
    prefix: `${ROAD_RUNNER}.ftc`,
    owns: (g, a) => g === ROAD_RUNNER && a === 'ftc',
    library: (g) => g === ROAD_RUNNER
  },
  { prefix: ROAD_RUNNER, owns: (g) => g === ROAD_RUNNER, library: (g) => g === ROAD_RUNNER },
  { prefix: 'dev.frozenmilk', owns: frozenMilk, library: frozenMilk },
  { prefix: 'org.ejml', owns: (g) => g === 'org.ejml', library: null },
  { prefix: 'kotlin', owns: (g) => g === 'org.jetbrains.kotlin', library: null }
]

export function knownPackageOf(packageName: string): KnownPackage | null {
  let best: KnownPackage | null = null
  for (const known of KNOWN_PACKAGES) {
    if (known.exact) {
      if (packageName === known.prefix) return known
      continue
    }
    if (
      (packageName === known.prefix || packageName.startsWith(`${known.prefix}.`)) &&
      (best === null || known.prefix.length > best.prefix.length)
    )
      best = known
  }
  return best
}

// 이 좌표가 담는 패키지를 아는지(표의 어느 라이브러리인지). 모르는 좌표를 불러오지 않았으면 그 안에 어떤 패키지든 있을 수 있다.
export function isKnownLibrary(group: string, artifact: string, version: string): boolean {
  return KNOWN_PACKAGES.some(
    (known) => known.owns(group, artifact, version) || (known.library?.(group, artifact) ?? false)
  )
}
