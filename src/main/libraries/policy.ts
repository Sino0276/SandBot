import type { LibraryReason } from '../../shared/libraries'
import { majorVersion } from './version'

// 라이브러리 정책 표(한곳). 팀 Gradle의 좌표마다 받을지, 가짜 FTC SDK가 이미 제공하는지, 지원하지 않는지를 정한다.
// - 지원 계열(직접 선언하면 해석의 뿌리): Road Runner 1.0(com.acmerobotics.roadrunner core·actions 1.x, ftc),
//   Pedro Pathing 3.x 이상(com.pedropathing core·revhub 주 버전 3 이상, Ivy com.pedropathing.ivy 1.x 이상),
//   FTCLib core(org.ftclib.ftclib:core). 이것들이 끌어온 전이 의존성(kotlin-stdlib, jackson, ejml, jsr305 …)은 쓴다.
// - 제공(provided): FTC SDK, Android(androidx·com.android·com.google.android), 가짜 SDK에 든 Gson·NanoHTTPD·
//   threetenabp·OpenFTC·slf4j-api. 받지 않는다. 단 androidx.annotation은 Android Studio의 컴파일 클래스패스에 늘 있으므로
//   (appcompat이 compile 범위로 끌어온다) 받아서 컴파일 클래스패스에만 넣는다.
// - 지원하지 않음(안내): FTC Dashboard(L1: SandBot 대체가 생기기 전), Pedro AutoTune, Pedro 2.x, Panels, Sloth·Sinister,
//   FTCLib vision, 그 밖에 직접 선언했지만 지원 계열도 그 전이 의존성도 아닌 것(notSupported).
// 정책을 바꾸면 POLICY_VERSION을 올린다(해석 잠금 resolutions/의 키에 들어간다).

export const POLICY_VERSION = 1

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
  if (group === 'com.acmerobotics.dashboard') return unsupported('notSupported', DASHBOARD_DETAIL)
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
  if (group === 'com.bylazar') return unsupported('panels')
  if (group.startsWith('dev.frozenmilk')) return unsupported('dairy')
  return { kind: 'other' }
}

// ---- 진단 안내: 패키지 → 라이브러리 ----
// 팀 코드의 'package X does not exist'에서 X가 어느 라이브러리 것인지(가장 긴 접두가 이긴다). matches는 의존성 보고의
// 좌표가 그 라이브러리인지 본다.

export type KnownPackage = {
  prefix: string
  matches: (group: string, artifact: string) => boolean
}

export const KNOWN_PACKAGES: readonly KnownPackage[] = [
  {
    prefix: 'com.pedropathing.tuning',
    matches: (g, a) => g === 'com.pedropathing' && a === 'tuning'
  },
  {
    prefix: 'com.pedropathing.ivy',
    matches: (g, a) => g === 'com.pedropathing.ivy' || (g === 'com.pedropathing' && a === 'ivy')
  },
  { prefix: 'com.pedropathing', matches: (g) => g === 'com.pedropathing' },
  { prefix: 'com.bylazar', matches: (g) => g === 'com.bylazar' },
  {
    prefix: 'com.arcrobotics.ftclib.vision',
    matches: (g, a) => g === 'org.ftclib.ftclib' && a === 'vision'
  },
  { prefix: 'com.arcrobotics.ftclib', matches: (g) => g === 'org.ftclib.ftclib' },
  { prefix: 'com.acmerobotics.dashboard', matches: (g) => g === 'com.acmerobotics.dashboard' },
  { prefix: 'com.acmerobotics.roadrunner', matches: (g) => g === 'com.acmerobotics.roadrunner' },
  { prefix: 'dev.frozenmilk', matches: (g) => g.startsWith('dev.frozenmilk') },
  { prefix: 'org.ejml', matches: (g) => g === 'org.ejml' },
  { prefix: 'kotlin', matches: (g) => g === 'org.jetbrains.kotlin' }
]

export function knownPackageOf(packageName: string): KnownPackage | null {
  let best: KnownPackage | null = null
  for (const known of KNOWN_PACKAGES)
    if (
      (packageName === known.prefix || packageName.startsWith(`${known.prefix}.`)) &&
      (best === null || known.prefix.length > best.prefix.length)
    )
      best = known
  return best
}
