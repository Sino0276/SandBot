import i18n, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import ko from '../i18n/locales/ko'
import {
  consoleCounts,
  diagnosticLocation,
  entryDetailLines,
  entrySummary,
  finishDetail,
  entryTarget,
  formatCount,
  frameText,
  SUMMARY_MAX_CHARS,
  visibleEntries,
  type ConsoleEntry
} from './consoleModel'
import { consoleEntry } from './playStore'

let t: TFunction

beforeAll(async () => {
  const instance = i18n.createInstance()
  await instance.init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
  t = instance.t
})

const LIFT = 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'

const ALL = { info: true, warning: true, error: true }

function sample(): ConsoleEntry[] {
  return [
    consoleEntry({ type: 'log', stream: 'out', text: 'loop 1\nsecond line' }, 1_000_000),
    consoleEntry({ type: 'log', stream: 'err', text: 'careful' }, 2_000_000),
    consoleEntry(
      {
        type: 'error',
        kind: 'exception',
        message: 'java.lang.NullPointerException: lift is null',
        exception: 'java.lang.NullPointerException',
        stack: [
          {
            className: 'com.qualcomm.robotcore.eventloop.opmode.LinearOpMode',
            method: 'internalRunOpMode',
            file: 'LinearOpMode.java',
            line: 0,
            path: null
          },
          {
            className: 'org.firstinspires.ftc.teamcode.Lift',
            method: 'runOpMode',
            file: 'Lift.java',
            line: 42,
            path: LIFT
          }
        ],
        thread: 'OpModeThread'
      },
      3_000_000
    ),
    consoleEntry(
      {
        type: 'diagnostic',
        diagnostic: {
          kind: 'error',
          path: LIFT,
          file: 'org/firstinspires/ftc/teamcode/Lift.java',
          line: 12,
          column: 9,
          message: 'cannot find symbol',
          code: 'compiler.err.cant.resolve.location'
        }
      },
      null
    )
  ]
}

describe('Console 항목 글자', () => {
  it('요약은 첫 줄이고, 오류는 kind 머리말을 번역해 붙인다', () => {
    const [log, , error, diagnostic] = sample()
    expect(entrySummary(log, t)).toBe('loop 1')
    // 아주 긴 줄은 행에서 자른다
    const long = consoleEntry({ type: 'log', stream: 'out', text: 'x'.repeat(70_000) }, 0)
    expect(entrySummary(long, t)).toBe(`${'x'.repeat(SUMMARY_MAX_CHARS)}…`)
    expect(entrySummary(error, t)).toBe('예외: java.lang.NullPointerException: lift is null')
    expect(entrySummary(diagnostic, t)).toBe(
      'org/firstinspires/ftc/teamcode/Lift.java(12,9): 오류: cannot find symbol'
    )
  })

  it('stall의 전체 글자에는 무한 루프 안내가 붙는다', () => {
    const stall = consoleEntry(
      {
        type: 'error',
        kind: 'stall',
        message: 'no clock',
        exception: null,
        stack: [],
        thread: 'T'
      },
      0
    )
    expect(entryDetailLines(stall, t)).toContain(ko.play.stallHint)
    expect(stall.level).toBe('warning')
  })

  it('스택 줄은 Java 모양이다', () => {
    expect(
      frameText({ className: 'a.B', method: 'run', file: 'B.java', line: 3, path: null })
    ).toBe('at a.B.run(B.java:3)')
    expect(frameText({ className: 'a.B', method: 'run', file: null, line: -1, path: null })).toBe(
      'at a.B.run(Unknown Source)'
    )
    expect(
      diagnosticLocation({
        kind: 'error',
        path: null,
        file: 'X.java',
        line: 0,
        column: 0,
        message: '',
        code: ''
      })
    ).toBe('X.java')
  })
})

describe('Console 거르기', () => {
  it('수준 토글과 검색(대소문자 무시, 스택 포함)', () => {
    const entries = sample()
    expect(visibleEntries(entries, ALL, '', t)).toBe(entries)
    expect(visibleEntries(entries, { ...ALL, info: false }, '', t)).toHaveLength(3)
    expect(
      visibleEntries(entries, { info: false, warning: false, error: true }, '', t).map(
        (entry) => entry.type
      )
    ).toEqual(['error', 'diagnostic'])
    expect(visibleEntries(entries, ALL, 'CAREFUL', t)).toHaveLength(1)
    // 스택의 클래스 이름으로도 찾는다
    expect(visibleEntries(entries, ALL, 'teamcode.lift.runopmode', t)).toHaveLength(1)
    // 번역한 머리말로도 찾는다
    expect(visibleEntries(entries, ALL, '예외', t)).toHaveLength(1)
    expect(visibleEntries(entries, ALL, 'second line', t)).toHaveLength(1)
  })

  it('개수는 수준마다 세고 999를 넘으면 999+', () => {
    expect(consoleCounts(sample())).toEqual({ info: 1, warning: 1, error: 2 })
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1000)).toBe('999+')
  })
})

describe('외부 편집기로 열 곳', () => {
  it('진단은 그 줄, 오류는 첫 팀 코드 줄, 로그는 없음', () => {
    const [log, , error, diagnostic] = sample()
    expect(entryTarget(log)).toBeNull()
    expect(entryTarget(error)).toEqual({ path: LIFT, line: 42 })
    expect(entryTarget(diagnostic)).toEqual({ path: LIFT, line: 12 })
    // TeamCode 밖 파일의 진단은 열지 않는다
    const outside = consoleEntry(
      {
        type: 'diagnostic',
        diagnostic: {
          kind: 'error',
          path: null,
          file: 'Other.java',
          line: 1,
          column: 1,
          message: 'x',
          code: ''
        }
      },
      null
    )
    expect(entryTarget(outside)).toBeNull()
  })
})

describe('메인 이벤트의 모양(M)', () => {
  it("파일 없는 진단(file '')은 위치 없이 보인다", () => {
    const entry = consoleEntry(
      {
        type: 'diagnostic',
        diagnostic: {
          kind: 'warning',
          path: null,
          file: '',
          line: 0,
          column: 0,
          message: '[options] bootstrap class path not set',
          code: 'compiler.warn.source.no.bootclasspath'
        }
      },
      null
    )
    expect(entrySummary(entry, t)).toBe('경고: [options] bootstrap class path not set')
  })

  it('killed의 detail(기계용 키)은 번역하고, crashed의 detail은 그대로', () => {
    expect(finishDetail('killed', 'stalled', t)).toBe(ko.play.killedDetail.stalled)
    expect(finishDetail('killed', 'stopTimeout', t)).toBe(ko.play.killedDetail.stopTimeout)
    expect(finishDetail('crashed', 'Exception in thread "main"', t)).toBe(
      'Exception in thread "main"'
    )
    const entry = consoleEntry({ type: 'finished', reason: 'killed', detail: 'shutdownTimeout' }, 0)
    expect(entryDetailLines(entry, t)).toEqual([
      `OpMode 끝: ${ko.play.finishReason.killed}`,
      ko.play.killedDetail.shutdownTimeout
    ])
    expect(entry.level).toBe('warning')
  })
})
