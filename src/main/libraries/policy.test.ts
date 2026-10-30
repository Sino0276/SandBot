import { describe, expect, it } from 'vitest'
import { classifyModule, DASHBOARD_DETAIL, isKnownLibrary, knownPackageOf } from './policy'

const kind = (coordinate: string): string => {
  const [g, a, v] = coordinate.split(':')
  const decision = classifyModule(g, a, v)
  return decision.kind === 'unsupported' ? `unsupported:${decision.reason}` : decision.kind
}

describe('라이브러리 정책', () => {
  it('지원 계열', () => {
    expect(kind('com.acmerobotics.roadrunner:core:1.0.1')).toBe('supported')
    expect(kind('com.acmerobotics.roadrunner:actions:1.0.1')).toBe('supported')
    expect(kind('com.acmerobotics.roadrunner:ftc:0.1.25')).toBe('supported')
    expect(kind('com.pedropathing:revhub:3.0.2')).toBe('supported')
    expect(kind('com.pedropathing:core:3.0.0')).toBe('supported')
    expect(kind('com.pedropathing:core:4.0.0')).toBe('supported')
    expect(kind('com.pedropathing.ivy:pedro:1.1.1')).toBe('supported')
    expect(kind('com.pedropathing.ivy:core:1.1.1')).toBe('supported')
    expect(kind('org.ftclib.ftclib:core:2.1.1')).toBe('supported')
  })

  it('안내 후 제외', () => {
    expect(kind('com.pedropathing:tuning:1.0.1')).toBe('unsupported:pedroTuning')
    expect(kind('com.pedropathing:ftc:2.1.1')).toBe('unsupported:pedro2')
    expect(kind('com.pedropathing:core:2.1.2')).toBe('unsupported:pedro2')
    expect(kind('com.pedropathing:ivy:1.0.0')).toBe('unsupported:pedro2')
    expect(kind('com.pedropathing:telemetry:1.0.0')).toBe('unsupported:pedro2')
    expect(kind('com.bylazar:fullpanels:1.0.12')).toBe('unsupported:panels')
    expect(kind('dev.frozenmilk.sinister:Sloth:0.3.2')).toBe('unsupported:dairy')
    expect(kind('dev.frozenmilk:Sinister:2.3.0')).toBe('unsupported:dairy')
    expect(kind('dev.frozenmilk.dairy:Util:1.2.2')).toBe('unsupported:dairy')
    expect(kind('org.ftclib.ftclib:vision:2.1.0')).toBe('unsupported:ftcLibVision')
    expect(kind('com.acmerobotics.roadrunner:core:0.5.6')).toBe('unsupported:notSupported')
  })

  it('FTC Dashboard는 L1에서 지원하지 않는다(대체 안내)', () => {
    const decision = classifyModule('com.acmerobotics.dashboard', 'dashboard', '0.6.0')
    expect(decision).toEqual({
      kind: 'unsupported',
      reason: 'notSupported',
      detail: DASHBOARD_DETAIL
    })
    expect(kind('com.acmerobotics.dashboard:core:0.4.7')).toBe('unsupported:notSupported')
  })

  it('Sloth용 대체판은 원본(FTC Dashboard·Panels)과 같다', () => {
    expect(classifyModule('com.acmerobotics.slothboard', 'dashboard', '0.3.2+0.6.0')).toEqual({
      kind: 'unsupported',
      reason: 'notSupported',
      detail: DASHBOARD_DETAIL
    })
    expect(kind('com.bylazar.sloth:fullpanels:0.3.2+1.0.13')).toBe('unsupported:panels')
    expect(kind('com.bylazarx:y:1.0')).toBe('other')
  })

  it('제공(받지 않음)', () => {
    for (const c of [
      'org.firstinspires.ftc:RobotCore:12.0.0',
      'androidx.appcompat:appcompat:1.2.0',
      'androidx.core:core-ktx:1.6.0',
      'com.android.tools:r8:8.0.0',
      'com.google.android.material:material:1.12.0',
      'com.google.code.gson:gson:2.8.0',
      'org.nanohttpd:nanohttpd:2.3.1',
      'org.nanohttpd:nanohttpd-websocket:2.3.1',
      'com.jakewharton.threetenabp:threetenabp:1.3.1',
      'org.openftc:easyopencv:1.7.3',
      'org.slf4j:slf4j-api:1.7.26'
    ])
      expect(kind(c), c).toBe('provided')
    expect(kind('androidx.annotation:annotation:1.1.0')).toBe('compileOnly')
  })

  it('그 밖(전이 의존성이면 쓰고 직접 선언만이면 notSupported)', () => {
    expect(kind('org.jetbrains.kotlin:kotlin-stdlib:2.3.21')).toBe('other')
    expect(kind('org.ejml:ejml-simple:0.39')).toBe('other')
    expect(kind('com.github.x:y:1.0')).toBe('other')
  })

  it('패키지 → 라이브러리(가장 긴 접두)', () => {
    expect(knownPackageOf('com.pedropathing.tuning.autotune')?.prefix).toBe(
      'com.pedropathing.tuning'
    )
    expect(knownPackageOf('com.pedropathing.follower')?.prefix).toBe('com.pedropathing.follower')
    expect(knownPackageOf('com.pedropathing.paths.curves')?.prefix).toBe('com.pedropathing.paths')
    expect(knownPackageOf('com.pedropathing.example')?.prefix).toBe('com.pedropathing')
    expect(knownPackageOf('com.pedropathing.example')?.exact).toBeUndefined()
    // 최상위 패키지 자신은 그 패키지만 맞는 항목
    expect(knownPackageOf('com.pedropathing')?.exact).toBe(true)
    expect(knownPackageOf('com.pedropathing.ivy.pedro')?.prefix).toBe('com.pedropathing.ivy')
    expect(knownPackageOf('com.arcrobotics.ftclib.vision')?.prefix).toBe(
      'com.arcrobotics.ftclib.vision'
    )
    expect(knownPackageOf('com.arcrobotics.ftclib.command')?.prefix).toBe('com.arcrobotics.ftclib')
    expect(knownPackageOf('com.pedropathingx')).toBeNull()
    expect(knownPackageOf('org.firstinspires.ftc.teamcode')).toBeNull()
  })

  it('패키지를 가진 좌표(버전마다 다른 Pedro 패키지는 실제 jar 기준)', () => {
    const owns = (packageName: string, coordinate: string): boolean => {
      const [g, a, v] = coordinate.split(':')
      return knownPackageOf(packageName)?.owns(g, a, v) ?? false
    }
    // core 2.1.2(ftc 2.x가 compile 범위로 끌어옴)와 core 3.0.2·revhub 3.0.2
    expect(owns('com.pedropathing.geometry', 'com.pedropathing:core:2.1.2')).toBe(true)
    expect(owns('com.pedropathing.geometry', 'com.pedropathing:ftc:2.1.2')).toBe(true)
    expect(owns('com.pedropathing.geometry', 'com.pedropathing:core:3.0.2')).toBe(false)
    expect(owns('com.pedropathing.geometry', 'com.pedropathing:revhub:3.0.2')).toBe(false)
    expect(owns('com.pedropathing.controllers', 'com.pedropathing:revhub:3.0.2')).toBe(true)
    expect(owns('com.pedropathing.controllers', 'com.pedropathing:core:2.1.2')).toBe(false)
    expect(owns('com.pedropathing.follower', 'com.pedropathing:core:2.1.2')).toBe(true)
    expect(owns('com.pedropathing.follower', 'com.pedropathing:core:3.0.2')).toBe(true)
    // tuning 1.x는 자기 패키지만(revhub는 runtime 범위)
    expect(owns('com.pedropathing.follower', 'com.pedropathing:tuning:1.0.1')).toBe(false)
    expect(owns('com.pedropathing.tuning.autotune', 'com.pedropathing:tuning:1.0.1')).toBe(true)
    expect(owns('com.pedropathing.ftc', 'com.pedropathing:revhub:3.0.2')).toBe(false)
    expect(owns('com.pedropathing.pathgen', 'com.pedropathing:core:2.1.2')).toBe(false)
    // 1.x(com.pedropathing:pedro 1.0.9)
    expect(owns('com.pedropathing.pathgen', 'com.pedropathing:pedro:1.0.9')).toBe(true)
    expect(owns('com.pedropathing.localization.constants', 'com.pedropathing:pedro:1.0.9')).toBe(
      true
    )
    expect(owns('com.pedropathing.geometry', 'com.pedropathing:pedro:1.0.9')).toBe(false)
    // 최상위 패키지 자신의 클래스는 core 2.x에만(ftc 2.x가 끌어옴)
    expect(owns('com.pedropathing', 'com.pedropathing:core:2.1.2')).toBe(true)
    expect(owns('com.pedropathing', 'com.pedropathing:ftc:2.1.2')).toBe(true)
    expect(owns('com.pedropathing', 'com.pedropathing:core:3.0.2')).toBe(false)
    expect(owns('com.pedropathing', 'com.pedropathing:revhub:3.0.2')).toBe(false)
    expect(owns('com.pedropathing', 'com.pedropathing:pedro:1.0.9')).toBe(false)
    // 주 버전을 알 수 없는 core는 두 판 모두
    for (const version of ['+', 'latest.release', '[3.0,4.0)']) {
      expect(owns('com.pedropathing.geometry', `com.pedropathing:core:${version}`)).toBe(true)
      expect(owns('com.pedropathing.controllers', `com.pedropathing:core:${version}`)).toBe(true)
    }
    expect(owns('com.pedropathing.geometry', 'com.pedropathing:core:3.+')).toBe(false)
    expect(
      owns('com.acmerobotics.dashboard.config', 'com.acmerobotics.slothboard:dashboard:0.3.2+0.6.0')
    ).toBe(true)
    expect(owns('com.bylazar.telemetry', 'com.bylazar.sloth:fullpanels:0.3.2+1.0.13')).toBe(true)
    // Road Runner ftc·actions는 Dashboard를 compile 범위로 끌어오고 core는 끌어오지 않는다(POM)
    expect(owns('com.acmerobotics.dashboard', 'com.acmerobotics.roadrunner:ftc:0.1.25')).toBe(true)
    expect(
      owns('com.acmerobotics.dashboard.telemetry', 'com.acmerobotics.roadrunner:actions:1.0.1')
    ).toBe(true)
    expect(owns('com.acmerobotics.dashboard', 'com.acmerobotics.roadrunner:core:1.0.1')).toBe(false)
    expect(owns('com.acmerobotics.dashboard', 'com.acmerobotics.roadrunner:core:0.5.6')).toBe(false)
    expect(owns('com.acmerobotics.roadrunner.ftc', 'com.acmerobotics.roadrunner:core:1.0.1')).toBe(
      false
    )
    expect(owns('com.acmerobotics.roadrunner', 'com.acmerobotics.roadrunner:actions:1.0.1')).toBe(
      true
    )
    expect(owns('com.arcrobotics.ftclib.vision', 'org.ftclib.ftclib:core:2.1.1')).toBe(false)
    expect(owns('com.arcrobotics.ftclib.command', 'org.ftclib.ftclib:vision:2.1.0')).toBe(false)
  })

  it('담은 패키지를 아는 좌표', () => {
    expect(isKnownLibrary('com.pedropathing', 'pedro', '1.0.9')).toBe(true)
    expect(isKnownLibrary('com.acmerobotics.slothboard', 'dashboard', '0.3.2+0.6.0')).toBe(true)
    expect(isKnownLibrary('org.jetbrains.kotlin', 'kotlin-stdlib', '2.3.21')).toBe(true)
    expect(isKnownLibrary('com.github.someteam', 'pedro-fork', '3.0.2')).toBe(false)
    expect(isKnownLibrary('com.fasterxml.jackson.core', 'jackson-databind', '2.12.7')).toBe(false)
  })
})
