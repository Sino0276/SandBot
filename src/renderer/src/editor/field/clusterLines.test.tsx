import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { clusterFieldPoses } from '../../../../shared/sim/seasons/tagPoses'
import ko from '../../i18n/locales/ko'
import { DEFAULT_PLAY_SETTINGS } from '../../play/playSettings'
import { newRun, usePlayStore } from '../../play/playStore'
import { useSceneStore } from '../../scene/sceneStore'
import { clusterLines } from './clusterLines'
import FieldInspector from './FieldInspector'

// Field 인스펙터의 AprilTag 묶음 구역(spec-4d §1.15, C7)

vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

type TestStore<T> = { getInitialState: () => T; setState: (patch: Partial<T>) => void }
const restores: (() => void)[] = []
function setStore<T extends object>(store: TestStore<T>, patch: Partial<T>): void {
  const initial = store.getInitialState()
  const saved = { ...initial }
  restores.push(() => Object.assign(initial, saved))
  Object.assign(initial, patch)
  store.setState(patch)
}
afterEach(() => {
  while (restores.length > 0) restores.pop()!()
})

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Auto',
  path: '',
  line: 0,
  flavor: 'Autonomous',
  name: 'Auto',
  group: '',
  preselectTeleOp: ''
}

const BIOBUZZ = resolveSeason('biobuzz')

describe('clusterLines', () => {
  it('C7: 네 묶음 값이 clusterFieldPoses와 같다(in 소수 넷째, 사원수 일곱째), 복사 글자는 Java 인수', () => {
    for (const hive of [
      [false, false],
      [true, true]
    ] as const) {
      const lines = clusterLines(BIOBUZZ, hive)
      const poses = clusterFieldPoses(BIOBUZZ, hive)
      expect(lines.map((line) => line.name)).toEqual([
        'RED SCORING',
        'RED AUDIENCE',
        'BLUE AUDIENCE',
        'BLUE SCORING'
      ])
      lines.forEach((line, i) => {
        const pose = poses[i]
        expect(Number(line.params.x)).toBeCloseTo(pose.position.x / 0.0254, 4)
        expect(Number(line.params.y)).toBeCloseTo(pose.position.y / 0.0254, 4)
        expect(Number(line.params.z)).toBeCloseTo(pose.position.z / 0.0254, 4)
        expect(line.params.x).toMatch(/^-?\d+\.\d{4}$/)
        const q = [line.params.w, line.params.qx, line.params.qy, line.params.qz]
        q.forEach((value, k) => {
          expect(value).toMatch(/^-?\d\.\d{7}$/)
          expect(Number(value)).toBeCloseTo(pose.quaternion[k], 7)
        })
        // 음의 0을 쓰지 않는다
        for (const value of [...q, line.params.x, line.params.y, line.params.z])
          expect(value).not.toMatch(/^-0\.0+$/)
        expect(line.copyText).toBe(
          `new VectorF(${line.params.x}f, ${line.params.y}f, ${line.params.z}f), DistanceUnit.INCH, ` +
            `new Quaternion(${line.params.w}f, ${line.params.qx}f, ${line.params.qy}f, ${line.params.qz}f, 0)`
        )
      })
    }
    // HIVE 상태를 바꾸면 그 쪽 묶음 줄이 바뀐다
    const start = clusterLines(BIOBUZZ, [false, false])
    const redTipped = clusterLines(BIOBUZZ, [true, false])
    expect(redTipped[0].params).not.toEqual(start[0].params)
    expect(redTipped[3].params).toEqual(start[3].params)
    // 묶음이 없는 시즌
    expect(clusterLines(resolveSeason('none'), [false, false])).toEqual([])
  })
})

describe('Field 인스펙터 AprilTag 묶음 구역', () => {
  const render = (): string => renderToStaticMarkup(<FieldInspector />)

  it('BIOBUZZ: 네 줄과 [복사], 도움말에 INCH·allowOverwrite 문장', () => {
    setStore(useSceneStore, { field: { season: 'biobuzz' } })
    setStore(usePlayStore, { run: null, settings: DEFAULT_PLAY_SETTINGS })
    const html = render()
    expect(html).toContain('AprilTag 묶음(SDK 라이브러리용)')
    const lines = clusterLines(BIOBUZZ, [false, false])
    for (const line of lines)
      expect(html).toContain(i18n.t('field.inspector.clusters.line', line.params))
    expect(html.match(/>복사</g)).toHaveLength(4)
    const hint = i18n.t('field.inspector.clusters.hint')
    expect(hint).toContain('DistanceUnit.INCH')
    expect(hint).toContain('setAllowOverwrite(true)')
    expect(html).toContain(hint)
  })

  it('HIVE 상태(개인 실행 설정)를 따르고, 실행이 잠그면 실행의 상태, none이면 구역 없음', () => {
    setStore(useSceneStore, { field: { season: 'biobuzz' } })
    setStore(usePlayStore, {
      run: null,
      settings: { ...DEFAULT_PLAY_SETTINGS, hiveState: { red: 'tipped', blue: 'start' } }
    })
    const tipped = clusterLines(BIOBUZZ, [true, false])
    expect(render()).toContain(i18n.t('field.inspector.clusters.line', tipped[0].params))
    // 실행이 시작 상태로 잠갔으면 개인 설정이 넘어감이어도 시작 상태 값
    const run = newRun({
      runId: 'r',
      root: '/p',
      opMode: OP_MODE,
      robotId: null,
      configPath: null,
      speed: 1,
      paused: false,
      field: { season: 'biobuzz', hiveTipped: [false, false] }
    })
    setStore(usePlayStore, { run: { ...run, phase: 'running' } })
    const start = clusterLines(BIOBUZZ, [false, false])
    expect(render()).toContain(i18n.t('field.inspector.clusters.line', start[0].params))
    setStore(usePlayStore, { run: null })
    setStore(useSceneStore, { field: { season: 'none' } })
    expect(render()).not.toContain('AprilTag 묶음')
  })
})
