import i18n, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { createComponent } from '../hardware/components'
import en from '../i18n/locales/en'
import ko from '../i18n/locales/ko'
import type { SceneObjects } from '../scene/model'
import {
  consoleCounts,
  entryHeadline,
  diagnosticLocation,
  entryDetailLines,
  entrySummary,
  finishDetail,
  entryRevealFile,
  entryTarget,
  formatCount,
  frameText,
  SUMMARY_MAX_CHARS,
  visibleEntries,
  type ConsoleEntry,
  type ConsoleNoticeKey
} from './consoleModel'
import { consoleEntry } from './playStore'
import { buildWorldSpec } from './worldSpec'

let t: TFunction
let tEn: TFunction

beforeAll(async () => {
  const instance = i18n.createInstance()
  await instance.init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
  t = instance.t
  const english = i18n.createInstance()
  await english.init({
    resources: { en: { translation: en } },
    lng: 'en',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
  tEn = english.t
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
          code: 'compiler.err.cant.resolve.location',
          hint: null
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

  it('등록기 목록 실패는 이유 코드를 두고 그릴 때 번역한다(언어를 바꾸면 따라 바뀜)', () => {
    const entry = consoleEntry(
      { type: 'registeredFailed', code: 'noJdk', detail: 'no java' },
      null,
      'error'
    )
    expect(entry.level).toBe('error')
    expect(entrySummary(entry, t)).toBe(
      `등록기 OpMode 목록을 읽지 못했습니다: ${ko.play.list.registeredFailure.noJdk} (no java)`
    )
    expect(entrySummary(entry, tEn)).toBe(
      `Could not read the registrar OpMode list: ${en.play.list.registeredFailure.noJdk} (no java)`
    )
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
        code: '',
        hint: null
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
    // 다른 프로젝트의 실행이 남긴 항목은 지금 프로젝트에서 열지 않는다
    const other = { ...error, root: '/season-2024' }
    expect(entryTarget(other, '/season-2025')).toBeNull()
    expect(entryTarget(other, '/season-2024')).toEqual({ path: LIFT, line: 42 })
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
          code: '',
          hint: null
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
          code: 'compiler.warn.source.no.bootclasspath',
          hint: null
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

describe('시뮬레이터 안내(console.notices.sim.*)', () => {
  it('code마다 번역한 경고 한 줄과 params', () => {
    const shared = consoleEntry(
      { type: 'notice', key: 'sim.sharedEncoderMode', params: { device: 'leftFront' } },
      5,
      'warning'
    )
    expect(entrySummary(shared, t)).toContain('leftFront')
    expect(entrySummary(shared, t)).not.toContain('console.notices')
    const failed = consoleEntry(
      { type: 'notice', key: 'sim.worldError', params: { detail: 'NaN pose' } },
      5,
      'warning'
    )
    expect(entryDetailLines(failed, t)).toEqual([
      t('console.notices.sim.worldError', { detail: 'NaN pose' })
    ])
    expect(entryDetailLines(failed, t)[0]).toContain('NaN pose')
  })
})

describe('Road Runner 튜닝 결과(rrTuningSaved)', () => {
  const FILE = '/u/sim-files/abc/FIRST/RoadRunner/tuning/forward-ramp/1793363559542.json'
  const saved = (file: string | null, root = '/p'): ConsoleEntry =>
    consoleEntry(
      { type: 'rrTuning', path: 'RoadRunner/tuning/forward-ramp/1793363559542.json', file },
      9,
      undefined,
      root
    )

  it('성공 안내(정보)이고, 파일의 절대 경로와 그 파일로 할 수 있는 일을 보인다', () => {
    const entry = saved(FILE)
    expect(entry.level).toBe('info')
    for (const translate of [t, tEn]) {
      expect(entrySummary(entry, translate)).toContain(FILE)
      const lines = entryDetailLines(entry, translate)
      expect(lines[0]).toBe(entrySummary(entry, translate))
      // SandBot은 회귀 페이지를 제공하지 않고, 로봇이 내주는 튜닝 페이지의 [Browse]로 연다
      expect(lines[1]).toContain('Browse')
      expect(lines[1]).toContain('/tuning/')
      expect(lines.join('\n')).not.toContain('console.')
    }
  })

  it('더블클릭·Enter로 지금 프로젝트의 파일만 파일 관리자에서 보인다(외부 편집기로 열 곳은 아니다)', () => {
    expect(entryRevealFile(saved(FILE), '/p')).toBe(FILE)
    expect(entryTarget(saved(FILE), '/p')).toBeNull()
    // 다른 프로젝트의 실행이 남긴 항목, 프로젝트가 없을 때, 절대 경로를 모를 때는 없다
    expect(entryRevealFile(saved(FILE), '/other')).toBeNull()
    expect(entryRevealFile(saved(FILE), null)).toBeNull()
    expect(entryRevealFile(saved(null), '/p')).toBeNull()
    // 절대 경로를 모르면 모의 저장소 기준 경로를 보인다
    expect(entrySummary(saved(null), t)).toContain(
      'RoadRunner/tuning/forward-ramp/1793363559542.json'
    )
    const notice = consoleEntry(
      { type: 'notice', key: 'sim.dashCamera', params: {} },
      1,
      'warning',
      '/p'
    )
    expect(entryRevealFile(notice, '/p')).toBeNull()
  })
})

describe('세계 설명 경고(console.notices.world*)', () => {
  it('한도를 넘은 목록도 번역한 이름으로 보인다(코드 식별자를 문장에 넣지 않는다)', () => {
    // 데드휠 33개(시뮬레이터 한도 32)
    const objects: SceneObjects = {
      R: {
        id: 'R',
        name: 'Robot',
        kind: 'robot',
        parentId: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
      },
      pods: {
        id: 'pods',
        name: 'pods',
        kind: 'part',
        parentId: 'R',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        components: Array.from({ length: 33 }, (_, i) => ({
          ...createComponent('deadWheel', [], () => `pod-${i}`),
          name: `pod${i}`
        }))
      }
    }
    const notices = buildWorldSpec(objects, 'R', { batteryVoltage: 12 })
      .warnings.filter((warning) => warning.key !== 'worldNoWheels')
      .map((warning) => consoleEntry({ type: 'notice', ...warning }, null, 'warning'))
    expect(notices.map((entry) => entrySummary(entry, t))).toEqual([
      '데드휠 수가 시뮬레이터 한도(32개)를 넘어 앞의 32개만 씁니다.'
    ])
    expect(notices.map((entry) => entrySummary(entry, tEn))).toEqual([
      'There are more dead wheels than the simulator limit (32); only the first 32 are used.'
    ])
  })

  it('목록마다의 한도 문장은 ko·en에 같이 있고 한도만 받는다(몸체 충돌체 한도는 몸체 이름도)', () => {
    const keys = Object.keys(ko.console.notices).filter((key) => key.startsWith('worldTooMany'))
    expect(keys).toEqual([
      'worldTooManyMotors',
      'worldTooManyWheels',
      'worldTooManyDeadWheels',
      'worldTooManyPinpoints',
      'worldTooManyOtos',
      'worldTooManyImus',
      'worldTooManyJoints',
      'worldTooManyDistanceSensors',
      'worldTooManyColorSensors',
      'worldTooManyCameras',
      'worldTooManyColliders',
      'worldTooManyWorldColliders',
      'worldTooManyPreloads'
    ])
    for (const key of keys) {
      const params: Record<string, string | number> =
        key === 'worldTooManyColliders' ? { name: 'Arm', max: 32 } : { max: 32 }
      const entry = consoleEntry(
        { type: 'notice', key: key as ConsoleNoticeKey, params },
        null,
        'warning'
      )
      for (const translate of [t, tEn]) {
        const text = entrySummary(entry, translate)
        expect(text).toContain('32')
        expect(text).not.toMatch(/\{\{|console\.notices/)
      }
    }
  })
})

// 5: 몸체 충돌 겹침(simNotice collisionOverlap)의 Console 본문(spec-5 §5.7, K11)
describe('collisionOverlap 본문', () => {
  const overlap = (
    body: string,
    target: Extract<ConsoleEntry, { type: 'collisionOverlap' }>['target'],
    season: 'biobuzz' | 'none' = 'biobuzz'
  ): ConsoleEntry => consoleEntry({ type: 'collisionOverlap', body, target, season }, 5_000_000)

  it('벽·구조물·바닥·몸체·원래 글자를 ko·en으로 번역하고 수준은 경고다', () => {
    const wall = overlap('Arm', { kind: 'wall', wall: 'y-' })
    expect(wall.level).toBe('warning')
    expect(entryHeadline(wall, t)).toBe(
      t('console.notices.sim.collisionOverlap', { body: 'Arm', target: '빨강 벽' })
    )
    expect(entryHeadline(wall, t)).toContain('Arm이(가) 빨강 벽에 1 mm 넘게')
    expect(entryHeadline(wall, tEn)).toContain('Arm penetrated Red wall by more than 1 mm')
    expect(entryHeadline(overlap('Arm', { kind: 'structure', index: 11 }), t)).toContain('FLOWER에')
    expect(entryHeadline(overlap('Arm', { kind: 'floor' }), tEn)).toContain('penetrated Floor')
    expect(entryHeadline(overlap('Arm', { kind: 'body', name: 'Lift' }), t)).toContain('Lift에')
    expect(entryHeadline(overlap('Arm', { kind: 'raw', text: 'wall:q' }), t)).toContain('wall:q에')
    // 'none' 시즌의 벽은 일반 이름, 몸체 이름이 비면 로봇 몸체
    expect(entryHeadline(overlap('', { kind: 'wall', wall: 'x+' }, 'none'), tEn)).toContain(
      'Robot body penetrated Field wall'
    )
  })

  it('같은 항목을 언어만 바꿔 다시 번역한다(스토어에는 번역하지 않은 값)', () => {
    const entry = overlap('Arm', { kind: 'floor' })
    expect(entryHeadline(entry, t)).toContain('바닥')
    expect(entryHeadline(entry, tEn)).toContain('Floor')
    expect(JSON.stringify(entry)).not.toContain('바닥')
  })
})
