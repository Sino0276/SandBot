import i18n, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import type { LibraryEntry, LibraryReason, LibraryReport } from '../../../shared/libraries'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import { entryDetailLines, entrySummary, entryTarget, hintText, libraryText } from './consoleModel'
import { formatBytes, libraryReportLines, linkWarningLines } from './libraryConsole'
import { consoleEntry } from './playStore'

let t: TFunction
let tEn: TFunction

beforeAll(async () => {
  const make = async (lng: 'ko' | 'en'): Promise<TFunction> => {
    const instance = i18n.createInstance()
    await instance.init({
      resources: { [lng]: { translation: lng === 'ko' ? ko : en } },
      lng,
      initAsync: false,
      interpolation: { escapeValue: false }
    })
    return instance.t
  }
  t = await make('ko')
  tEn = await make('en')
})

function entry(coordinate: string, patch: Partial<LibraryEntry> = {}): LibraryEntry {
  const [group, artifact, version] = coordinate.split(':')
  return {
    group,
    artifact,
    version,
    requested: [version],
    status: 'used',
    reason: 'none',
    detail: '',
    declaredAt: null,
    requestedBy: [],
    source: 'download',
    integrity: 'checksum',
    ...patch
  }
}

const REPORT: LibraryReport = {
  entries: [
    entry('org.firstinspires.ftc:RobotCore:12.0.0', {
      status: 'provided',
      source: null,
      integrity: null,
      declaredAt: { file: 'build.dependencies.gradle', line: 5 }
    }),
    entry('com.pedropathing:revhub:3.0.2', {
      declaredAt: { file: 'TeamCode/build.gradle', line: 28 }
    }),
    entry('com.pedropathing:tuning:1.0.1', {
      status: 'unsupported',
      reason: 'pedroTuning',
      source: null,
      integrity: null,
      declaredAt: { file: 'build.dependencies.gradle', line: 12 }
    }),
    entry('com.acmerobotics.roadrunner:core:1.0.0', { integrity: 'firstUse' }),
    entry('org.ejml:ejml-core:0.39', {
      status: 'failed',
      reason: 'offline',
      detail: 'https://repo1.maven.org/...: getaddrinfo ENOTFOUND',
      requestedBy: ['org.ftclib.ftclib:core:2.1.1', 'org.ejml:ejml-simple:0.39'],
      requested: ['0.39', '0.38'],
      source: null,
      integrity: null
    })
  ],
  gradle: [
    {
      code: 'remoteScript',
      at: { file: 'build.gradle', line: 3 },
      detail: 'https://example.com/x.gradle'
    }
  ],
  compileSdk: null,
  compileSdkMinor: null,
  platform: { api: 34, minor: null, guessed: true }
}

describe('의존성 보고 → Console', () => {
  it('요약·플랫폼 짐작·문제 좌표·처음 받은 해시·Gradle 진단', () => {
    const lines = libraryReportLines(REPORT)
    expect(lines.map((l) => `${l.level} ${l.body.type}`)).toEqual([
      'warning notice',
      'warning notice',
      'warning library',
      'info library',
      'warning library',
      'warning gradle'
    ])
    const entries = lines.map((line) => consoleEntry(line.body, null, line.level, '/p'))
    expect(entrySummary(entries[0], t)).toBe(
      '팀 Gradle의 라이브러리 5개: 사용 2 · 제공 1 · 불러오지 않음 1 · 받지 못함 1'
    )
    expect(entrySummary(entries[1], t)).toContain('API 34')
    expect(entrySummary(entries[2], t)).toMatch(
      /^build\.dependencies\.gradle:12: com\.pedropathing:tuning:1\.0\.1: Pedro AutoTune/
    )
    expect(entrySummary(entries[3], tEn)).toContain('first download was recorded')
    expect(entrySummary(entries[5], t)).toBe(
      'build.gradle:3: 원격 스크립트(apply from: https://…)는 읽지 않습니다 (https://example.com/x.gradle)'
    )
    // 자세히: 세부·끌어온 쪽·요청된 버전
    expect(entryDetailLines(entries[4], t)).toEqual([
      expect.stringContaining('org.ejml:ejml-core:0.39: 네트워크에 닿지 못했고'),
      '세부: https://repo1.maven.org/...: getaddrinfo ENOTFOUND',
      '끌어온 쪽: org.ftclib.ftclib:core:2.1.1 → org.ejml:ejml-simple:0.39',
      '요청된 버전: 0.39, 0.38'
    ])
    // Gradle 파일은 외부 편집기 대상(TeamCode Java)이 아니라 열지 않는다
    expect(entryTarget(entries[2], '/p')).toBeNull()
  })

  it('처음 받은 해시를 기록하지 못한 좌표는 경고이고, 기록했다고 하지 않는다', () => {
    const detail =
      'could not record the SHA-256 of the first download of core-1.0.0.jar in first-use.json (EPERM); trust on first use is not in effect until it is recorded'
    const lines = libraryReportLines({
      entries: [
        entry('com.acmerobotics.roadrunner:core:1.0.0', {
          integrity: 'firstUseUnrecorded',
          detail
        })
      ],
      gradle: [],
      compileSdk: 30,
      compileSdkMinor: null,
      platform: null
    })
    expect(lines.map((l) => `${l.level} ${l.body.type}`)).toEqual([
      'info notice',
      'warning library'
    ])
    const unrecorded = consoleEntry(lines[1].body, null, lines[1].level, '/p')
    expect(entrySummary(unrecorded, t)).toContain('해시를 기록하지 못했습니다')
    expect(entrySummary(unrecorded, tEn)).not.toContain('was recorded')
    expect(entryDetailLines(unrecorded, t)).toEqual([
      expect.stringContaining('com.acmerobotics.roadrunner:core:1.0.0: 저장소가 체크섬을'),
      `세부: ${detail}`,
      '출처: 저장소에서 받음',
      '무결성: 처음 받은 해시를 기록하지 못함(저장소에 체크섬 없음, 다음 INIT에 다시 기록)'
    ])
    expect(entryDetailLines(unrecorded, tEn).at(-1)).not.toContain('console.')
  })

  it('좌표가 없으면 요약을 쓰지 않고, 플랫폼을 알면 요약에 넣는다', () => {
    expect(
      libraryReportLines({
        entries: [],
        gradle: [],
        compileSdk: 30,
        compileSdkMinor: null,
        platform: { api: 30, minor: null, guessed: false }
      })
    ).toEqual([])
    const lines = libraryReportLines({
      entries: [entry('com.pedropathing:revhub:3.0.2')],
      gradle: [],
      compileSdk: 30,
      compileSdkMinor: null,
      platform: { api: 30, minor: null, guessed: false }
    })
    expect(lines).toHaveLength(1)
    expect(entrySummary(consoleEntry(lines[0].body, null, lines[0].level), tEn)).toBe(
      '1 libraries in the team Gradle files: 1 used · 0 provided · 0 not loaded · 0 not downloaded · compiled against Android API 30'
    )
    expect(lines[0].level).toBe('info')
  })

  it('부 버전 플랫폼은 부 버전까지 보인다(android-36.1은 36.1, android-37.0은 37.0)', () => {
    const summary = (platform: NonNullable<LibraryReport['platform']>, translate = t): string[] =>
      libraryReportLines({
        entries: [entry('com.pedropathing:revhub:3.0.2')],
        gradle: [],
        compileSdk: platform.guessed ? null : platform.api,
        compileSdkMinor: platform.guessed ? null : platform.minor,
        platform
      }).map((line) => entrySummary(consoleEntry(line.body, null, line.level), translate))
    // compileSdk를 몰라 android-36과 android-36.1 중 36.1로 컴파일했으면 짐작 경고도 36.1이다
    const guessed = summary({ api: 36, minor: 1, guessed: true })
    expect(guessed[1]).toContain('(API 36.1)')
    expect(summary({ api: 36, minor: 1, guessed: true }, tEn)[1]).toContain('(API 36.1)')
    expect(summary({ api: 37, minor: 0, guessed: false }, tEn)[0]).toMatch(
      /compiled against Android API 37\.0$/
    )
    expect(summary({ api: 36, minor: null, guessed: false })[0]).toMatch(/Android API 36로 컴파일$/)
    // compileSdk { version = release(36) { minorApiLevel = 1 } }로 android-36.1을 골랐다
    expect(summary({ api: 36, minor: 1, guessed: false })[0]).toMatch(/Android API 36\.1로 컴파일$/)
  })

  it('모든 이유에 문장이 있다(ko·en), FTC Dashboard는 대체 안내', () => {
    const reasons: LibraryReason[] = [
      'pedroTuning',
      'pedro2',
      'panels',
      'dairy',
      'ftcLibVision',
      'notSupported',
      'dynamicVersion',
      'localModule',
      'repositoryNotAllowed',
      'notFound',
      'offline',
      'rateLimited',
      'checksumMismatch',
      'tooLarge',
      'badArchive',
      'protectedPackage',
      'badMetadata',
      'cancelled'
    ]
    for (const reason of reasons)
      for (const translate of [t, tEn]) {
        const text = libraryText(entry('x:y:1', { status: 'failed', reason }), translate)
        expect(text, reason).toMatch(/^x:y:1: ./)
        expect(text).not.toContain('console.')
      }
    expect(
      libraryText(
        entry('com.acmerobotics.dashboard:dashboard:0.6.0', {
          status: 'unsupported',
          reason: 'notSupported'
        }),
        tEn
      )
    ).toContain('SandBot Dashboard replacement')
  })

  it('컴파일 진단의 안내', () => {
    expect(
      hintText(
        {
          kind: 'libraryNotLoaded',
          coordinate: 'com.pedropathing:tuning:1.0.1',
          reason: 'pedroTuning'
        },
        t
      )
    ).toContain('com.pedropathing:tuning:1.0.1의 것이지만')
    expect(hintText({ kind: 'undeclared', packageName: 'com.bylazar.telemetry' }, tEn)).toContain(
      'com.bylazar.telemetry'
    )
    const diagnostic = consoleEntry(
      {
        type: 'diagnostic',
        diagnostic: {
          kind: 'error',
          path: 'src/main/java/org/firstinspires/ftc/teamcode/Tuning.java',
          file: 'Tuning.java',
          line: 3,
          column: 1,
          message: 'package com.pedropathing.tuning does not exist',
          code: 'compiler.err.doesnt.exist',
          hint: { kind: 'undeclared', packageName: 'com.pedropathing.tuning' }
        }
      },
      null
    )
    expect(entryDetailLines(diagnostic, t)[1]).toContain('선언하지 않았습니다')
  })

  it('전이 의존성은 선언했다고 하지 않고, 다 읽지 못했으면 Android Studio 실패를 단정하지 않는다', () => {
    const dependency = {
      kind: 'dependencyNotLoaded',
      coordinate: 'com.acmerobotics.dashboard:core:0.4.7',
      reason: 'notSupported',
      requestedBy: 'com.acmerobotics.roadrunner:actions:1.0.1'
    } as const
    for (const translate of [t, tEn]) {
      const text = hintText(dependency, translate)
      expect(text).toContain('com.acmerobotics.roadrunner:actions:1.0.1')
      expect(text).toContain('com.acmerobotics.dashboard:core:0.4.7')
      expect(text).not.toContain('console.')
      const maybe = hintText(
        { kind: 'maybeUndeclared', packageName: 'com.pedropathing.follower' },
        translate
      )
      expect(maybe).toContain('com.pedropathing.follower')
      expect(maybe).not.toContain('Android Studio')
      expect(maybe).not.toContain('console.')
    }
    expect(hintText(dependency, t)).toContain(
      '팀 Gradle에 선언한 com.acmerobotics.roadrunner:actions:1.0.1이(가) 끌어오는 com.acmerobotics.dashboard:core:0.4.7의 것이지만'
    )
    expect(hintText(dependency, tEn)).toContain(
      'belongs to com.acmerobotics.dashboard:core:0.4.7, a dependency of com.acmerobotics.roadrunner:actions:1.0.1 declared'
    )
    // FTC Dashboard 안내(Sloth용 대체판 slothboard도)
    expect(hintText(dependency, tEn)).toContain('SandBot Dashboard replacement')
    const slothboard = entry('com.acmerobotics.slothboard:dashboard:0.3.2+0.6.0', {
      status: 'unsupported',
      reason: 'notSupported'
    })
    expect(libraryText(slothboard, tEn)).toContain('SandBot Dashboard replacement')
    expect(
      hintText(
        {
          kind: 'libraryNotLoaded',
          coordinate: 'com.acmerobotics.slothboard:dashboard:0.3.2+0.6.0',
          reason: 'notSupported'
        },
        tEn
      )
    ).toContain('SandBot Dashboard replacement')
  })

  it('링크 검사 경고는 라이브러리별로 묶는다', () => {
    const lines = linkWarningLines([
      { library: 'a:b:1', kind: 'missingClass', from: 'a.X', target: 'android.os.Foo' },
      { library: 'c:d:2', kind: 'unsupported', from: 'c.Y', target: 'com.qualcomm.Z#run()V' },
      { library: 'a:b:1', kind: 'missingMember', from: 'a.X', target: 'q.R#f(I)V' }
    ])
    expect(
      lines.map(
        (l) => l.body.type === 'linkWarnings' && `${l.body.library}:${l.body.warnings.length}`
      )
    ).toEqual(['a:b:1:2', 'c:d:2:1'])
    const first = consoleEntry(lines[0].body, null, lines[0].level)
    expect(entrySummary(first, t)).toContain('a:b:1: 링크 검사에서 문제 2개')
    expect(entryDetailLines(first, t).slice(1)).toEqual([
      '없는 클래스: a.X → android.os.Foo',
      '없는 멤버: a.X → q.R#f(I)V'
    ])
  })

  it('바이트 형식', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
})
